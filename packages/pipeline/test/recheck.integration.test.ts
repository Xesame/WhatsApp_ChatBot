import { addAlias, createEntity, removeAlias } from '@reb/admin';
import { entityAliases, projects, reviewCorrections, units } from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { seed } from '@reb/db/seed-runner';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recheckWaitingUnits } from '../src/index.ts';

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
    expect(after?.extras).toEqual({ written: { developer: [], project: ['Jamila'], city: [] } });
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

  it('reverts when a learned spelling is removed', async () => {
    const zomra = await makeProject('Zomra East Residence', 'زمرة ايست ريزيدنس');
    const written = { developer: [], project: ['Zomra East'], city: [] };
    const unit = await waiting({
      reviewReasons: [unknown('Zomra East')],
      extras: { written, unmatched: { project: 'Zomra East' } },
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
    const unit = await waiting({ extras: { unmatched: { project: 'Jamila' } } });
    const jamila = await makeProject('Jamila', 'جميلة');
    expect(await recheckWaitingUnits(testDb.database)).toEqual({ checked: 1, cleared: 1 });
    const after = await unitRow(unit.id);
    expect(after).toMatchObject({ projectId: jamila, needsReview: false, reviewReasons: [] });
    expect(after?.extras).toEqual({ written: { developer: [], project: ['Jamila'], city: [] } });
  });
});
