import { addAlias, createEntity, removeAlias } from '@reb/admin';
import {
  developers,
  entityAliases,
  messages,
  projects,
  reviewCorrections,
  units,
  waGroups,
} from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { seed } from '@reb/db/seed-runner';
import { DEFAULT_TOLERANCES } from '@reb/dedup';
import { normalizeUnit } from '@reb/normalize';
import type { RawUnit } from '@reb/schema';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyExtraction, matchEntities, recheckWaitingUnits } from '../src/index.ts';

/**
 * Re-checking waiting units when the bot learns a name: a unit that was
 * waiting only because its project was unknown is fixed in place once the
 * project (or its spelling) is known, and goes back to waiting if the
 * spelling is removed. Units Hassan already reviewed are never touched.
 */
describe.skipIf(!testDatabaseUrl)('re-checking waiting units (real Postgres)', () => {
  let testDb: TestDatabase;
  let mivida: { id: number; developerId: number; cityId: number };

  const unknown = (name: string) => `project "${name}" is not in the known list`;

  /** A unit as the pipeline leaves it when its project name was not known. */
  const waiting = async (overrides: Partial<typeof units.$inferInsert> = {}) => {
    const [row] = await testDb.database.db
      .insert(units)
      .values({
        unitType: 'Apartment',
        minArea: 150,
        maxArea: 150,
        minPrice: 950_000_000,
        maxPrice: 950_000_000,
        confidence: 0.35,
        needsReview: true,
        flaggedOnArrival: true,
        reviewReasons: [unknown('Jamila')],
        extras: {
          written: { developer: [], project: ['Jamila'], city: [] },
          unmatched: { project: 'Jamila' },
          priceFactor: 1,
        },
        firstSeenAt: new Date('2026-11-01T10:00:00Z'),
        lastSeenAt: new Date('2026-11-01T10:00:00Z'),
        ...overrides,
      })
      .returning();
    if (!row) throw new Error('insert failed');
    return row;
  };
  const unitRow = async (id: number) =>
    (await testDb.database.db.select().from(units).where(eq(units.id, id)))[0];
  const allUnits = () => testDb.database.db.select().from(units).orderBy(asc(units.id));
  const makeProject = (nameEn: string, nameAr: string) =>
    createEntity(testDb.database.db, 'project', {
      nameEn,
      nameAr,
      developerId: mivida.developerId,
      cityId: mivida.cityId,
    });
  const correct = (unitId: number, action: 'edit' | 'approve') =>
    testDb.database.db.insert(reviewCorrections).values({
      unitId,
      action,
      ...(action === 'edit' ? { field: 'notes', before: null, after: 'checked' } : {}),
    });

  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
    await seed(testDb.database.db);
    const [p] = await testDb.database.db
      .select({ id: projects.id, developerId: projects.developerId, cityId: projects.cityId })
      .from(projects)
      .where(eq(projects.nameEn, 'Mivida'));
    if (!p) throw new Error('seed missing');
    mivida = p;
  });
  afterAll(async () => {
    await testDb.drop();
  });
  beforeEach(async () => {
    await testDb.database.pool.query(
      'truncate review_corrections, unit_prices, unit_sources, units restart identity cascade',
    );
    // Projects are not truncated (the seed lives there), so remove the ones these tests add.
    await testDb.database.pool.query(
      "delete from entity_aliases where project_id in (select id from projects where name_en in ('Jamila', 'Zomra East Residence'))",
    );
    await testDb.database.pool.query(
      "delete from projects where name_en in ('Jamila', 'Zomra East Residence')",
    );
  });

  it('clears a unit once its project is learned', async () => {
    const unit = await waiting();
    const jamila = await makeProject('Jamila', 'جميلة');
    expect(await recheckWaitingUnits(testDb.database)).toEqual({ checked: 1, cleared: 1 });
    const after = await unitRow(unit.id);
    expect(after).toMatchObject({
      id: unit.id,
      projectId: jamila,
      developerId: mivida.developerId,
      cityId: mivida.cityId,
      needsReview: false,
      reviewReasons: [],
      confidence: 1,
      flaggedOnArrival: true,
    });
    expect(after?.extras).toEqual({
      written: { developer: [], project: ['Jamila'], city: [] },
      priceFactor: 1,
    });
    expect(await allUnits()).toHaveLength(1);
  });

  it('keeps other reasons', async () => {
    const unit = await waiting({
      minArea: null,
      maxArea: null,
      reviewReasons: [unknown('Jamila'), 'No area'],
    });
    const jamila = await makeProject('Jamila', 'جميلة');
    expect(await recheckWaitingUnits(testDb.database)).toEqual({ checked: 1, cleared: 0 });
    expect(await unitRow(unit.id)).toMatchObject({
      projectId: jamila,
      reviewReasons: ['No area'],
      needsReview: true,
      confidence: 0.8,
    });
  });

  it('never touches a unit Hassan reviewed', async () => {
    const unit = await waiting();
    await correct(unit.id, 'edit');
    await makeProject('Jamila', 'جميلة');
    const before = await unitRow(unit.id);
    expect(await recheckWaitingUnits(testDb.database)).toEqual({ checked: 0, cleared: 0 });
    expect(await unitRow(unit.id)).toEqual(before);
  });

  it('does not merge into an existing unit', async () => {
    const jamila = await makeProject('Jamila', 'جميلة');
    const approved = await waiting({
      projectId: jamila,
      developerId: mivida.developerId,
      cityId: mivida.cityId,
      needsReview: false,
      reviewReasons: [],
      confidence: 1,
    });
    await correct(approved.id, 'approve');
    const unit = await waiting();
    await recheckWaitingUnits(testDb.database);
    const rows = await allUnits();
    expect(rows.map((r) => r.id)).toEqual([approved.id, unit.id]);
    expect(rows.every((r) => r.projectId === jamila && r.status === 'active')).toBe(true);
  });

  describe('price check once the project is learned', () => {
    /** Three approved Jamila apartments at 40,000 / 41,000 / 45,000 EGP per m2. */
    const approveThree = async (jamila: number) => {
      for (const perMetre of [40_000, 41_000, 45_000]) {
        const unit = await waiting({
          projectId: jamila,
          developerId: mivida.developerId,
          cityId: mivida.cityId,
          minArea: 100,
          maxArea: 100,
          minPrice: perMetre * 100 * 100,
          maxPrice: perMetre * 100 * 100,
          needsReview: false,
          flaggedOnArrival: false,
          reviewReasons: [],
          confidence: 1,
        });
        await correct(unit.id, 'approve');
      }
    };

    it('stays waiting with the learned price reason when far off', async () => {
      const unit = await waiting({ minPrice: 100_000_000, maxPrice: 100_000_000 });
      const jamila = await makeProject('Jamila', 'جميلة');
      await approveThree(jamila);
      expect(await recheckWaitingUnits(testDb.database)).toEqual({ checked: 1, cleared: 0 });
      expect(await unitRow(unit.id)).toMatchObject({
        projectId: jamila,
        needsReview: true,
        reviewReasons: [
          'Price per m² 6,667 EGP is far from the usual 41,000 for Jamila apartments',
        ],
      });
    });

    it('clears when the price is within range', async () => {
      const unit = await waiting({ minPrice: 600_000_000, maxPrice: 600_000_000 });
      const jamila = await makeProject('Jamila', 'جميلة');
      await approveThree(jamila);
      expect(await recheckWaitingUnits(testDb.database)).toEqual({ checked: 1, cleared: 1 });
      expect(await unitRow(unit.id)).toMatchObject({
        projectId: jamila,
        needsReview: false,
        reviewReasons: [],
      });
    });
  });

  it('reverts when a learned spelling is removed', async () => {
    const zomra = await makeProject('Zomra East Residence', 'زمرة ايست ريزيدنس');
    const written = { developer: [], project: ['Zomra East'], city: [] };
    const unit = await waiting({
      reviewReasons: [unknown('Zomra East')],
      extras: { written, unmatched: { project: 'Zomra East' }, priceFactor: 1 },
    });
    // Hassan already answered this one by hand: it keeps his answer throughout.
    const reviewed = await waiting({
      projectId: zomra,
      developerId: mivida.developerId,
      cityId: mivida.cityId,
      reviewReasons: [unknown('Zomra East')],
      extras: { written },
    });
    await correct(reviewed.id, 'edit');
    const reviewedBefore = await unitRow(reviewed.id);

    // Before learning: still unknown, now with the closest project as a hint.
    await recheckWaitingUnits(testDb.database);
    const hinted = await unitRow(unit.id);
    expect(hinted?.projectId).toBeNull();
    expect(hinted?.reviewReasons[0]).toMatch(
      /^project "Zomra East" is not in the known list \(closest: Zomra East Residence, 0\.\d\d\)$/,
    );

    await addAlias(testDb.database.db, 'project', zomra, 'Zomra East');
    expect(await recheckWaitingUnits(testDb.database)).toEqual({ checked: 1, cleared: 1 });
    expect(await unitRow(unit.id)).toMatchObject({ projectId: zomra, needsReview: false });

    const [alias] = await testDb.database.db
      .select({ id: entityAliases.id })
      .from(entityAliases)
      .where(and(eq(entityAliases.projectId, zomra), eq(entityAliases.alias, 'Zomra East')));
    await removeAlias(testDb.database.db, alias?.id ?? 0);
    expect(await recheckWaitingUnits(testDb.database)).toEqual({ checked: 1, cleared: 0 });
    const reverted = await unitRow(unit.id);
    expect(reverted).toMatchObject({
      projectId: null,
      developerId: null,
      cityId: null,
      needsReview: true,
      reviewReasons: hinted?.reviewReasons,
      extras: hinted?.extras,
    });
    expect((reverted?.extras as { suggested?: unknown }).suggested).toMatchObject({
      project: { id: zomra, name: 'Zomra East Residence' },
    });
    expect(await unitRow(reviewed.id)).toEqual(reviewedBefore);
  });

  it('is idempotent', async () => {
    await waiting();
    await waiting({ reviewReasons: [unknown('Jamila'), 'No price'], minPrice: null });
    await makeProject('Jamila', 'جميلة');
    expect(await recheckWaitingUnits(testDb.database)).toEqual({ checked: 2, cleared: 1 });
    const once = await allUnits();
    expect(await recheckWaitingUnits(testDb.database)).toEqual({ checked: 2, cleared: 0 });
    expect(await allUnits()).toEqual(once);
  });

  it('also re-checks units saved before names as written were kept', async () => {
    // Older units have no `written` names: they are read back from the
    // unmatched names and the quoted name in the old reason.
    const unit = await waiting({ confidence: 0.6, extras: { unmatched: { project: 'Jamila' } } });
    const jamila = await makeProject('Jamila', 'جميلة');
    expect(await recheckWaitingUnits(testDb.database)).toEqual({ checked: 1, cleared: 1 });
    const after = await unitRow(unit.id);
    // No stored price score: the old score keeps its price part, the name parts are swapped.
    expect(after).toMatchObject({
      projectId: jamila,
      needsReview: false,
      reviewReasons: [],
      confidence: 1,
    });
    expect(after?.extras).toEqual({ written: { developer: [], project: ['Jamila'], city: [] } });
  });

  it('keeps the price score a unit got when it arrived', async () => {
    // Through the real path: exact developer, no project, a plain-digit price.
    // normalizeUnit scores such a price 0.6 without recording a reason.
    const [developer] = await testDb.database.db
      .select({ name: developers.nameEn })
      .from(developers)
      .where(eq(developers.id, mivida.developerId));
    const developerName = developer?.name ?? '';
    const text = `${developerName} شقة 150 متر السعر 6500000`;
    const raw: RawUnit = {
      category: null,
      developer: developerName,
      project: null,
      city: null,
      unit_type: 'Apartment',
      unit_code: null,
      floor: null,
      finishing: null,
      bedrooms: null,
      bathrooms: null,
      area: '150 متر',
      land_area: null,
      garden_area: null,
      outdoor_area: null,
      price: 'السعر 6500000',
      delivery: null,
      maintenance: null,
      down_payment: null,
      installments: null,
      cash_discount: null,
      notes: null,
      evidence: { project: null, unit_type: null, area: null, price: null },
    };
    const found = await matchEntities(testDb.database.db, raw);
    expect(found.developer?.similarity).toBe(1);
    const sentAt = new Date('2026-11-01T10:00:00Z');
    const normalized = normalizeUnit(raw, { sourceText: text, sentAt, ...found });
    expect(normalized).toMatchObject({ confidence: 0.65, needsReview: true, reviewReasons: [] });

    const [group] = await testDb.database.db
      .insert(waGroups)
      .values({ jid: `g${Math.random()}@g.us`, name: 'Brokers', watched: true })
      .returning();
    const [message] = await testDb.database.db
      .insert(messages)
      .values({
        groupId: group?.id ?? 0,
        waMessageId: `R${Math.random()}`,
        senderHash: 'h'.repeat(64),
        sentAt,
        text,
      })
      .returning();
    if (!message) throw new Error('insert failed');
    await testDb.database.transaction((tx) =>
      applyExtraction(tx, {
        message,
        intent: 'listing',
        units: [normalized],
        extractionRunId: null,
        tolerances: DEFAULT_TOLERANCES,
      }),
    );

    // An unrelated change: a new spelling for another project.
    await addAlias(testDb.database.db, 'project', mivida.id, 'Mivida Gardens test');
    expect(await recheckWaitingUnits(testDb.database)).toEqual({ checked: 1, cleared: 0 });
    const [row] = await allUnits();
    expect(row).toMatchObject({
      confidence: normalized.confidence,
      needsReview: normalized.needsReview,
      reviewReasons: [],
    });
  });

  it('swaps only the name parts of an older score', async () => {
    // An older unit: no written names, no stored price score, and the name
    // only in a "matched by similarity" reason.
    const jamila = await makeProject('Jamila', 'جميلة');
    const unit = await waiting({
      projectId: jamila,
      developerId: mivida.developerId,
      cityId: mivida.cityId,
      confidence: 0.7,
      reviewReasons: ['project "Jamla" matched "Jamila" by similarity (0.82)'],
      extras: {},
    });
    await addAlias(testDb.database.db, 'project', jamila, 'Jamla');
    expect(await recheckWaitingUnits(testDb.database)).toEqual({ checked: 1, cleared: 1 });
    const after = await unitRow(unit.id);
    // Old name parts: 0.25 x 0.82 + 0.15 x 1; new: 0.25 x 1 + 0.15 x 1.
    const expected =
      Math.round((0.7 - (0.25 * 0.82 + 0.15 * 1) + (0.25 * 1 + 0.15 * 1)) * 100) / 100;
    expect(after).toMatchObject({
      projectId: jamila,
      reviewReasons: [],
      needsReview: false,
      confidence: expected,
    });
    expect((after?.extras as { written: { project: string[] } }).written.project).toEqual([
      'Jamla',
    ]);
  });
});
