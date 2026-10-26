import { messages, projects, unitPrices, units, unitSources, waGroups } from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { seed } from '@reb/db/seed-runner';
import { DEFAULT_TOLERANCES } from '@reb/dedup';
import type { Unit } from '@reb/schema';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyExtraction, markStale, type ApplyInput } from '../src/index.ts';

/**
 * Phase 4 acceptance, on a real database:
 * - the same unit posted in three groups yields one unit with three sources;
 * - a reply with a new price adds a price row instead of a new unit;
 * plus sold notices, reprocessing, late messages and the stale job.
 */
describe.skipIf(!testDatabaseUrl)('dedup and price history (real Postgres)', () => {
  let testDb: TestDatabase;
  let mivida: { id: number; developerId: number; cityId: number };
  const groups: number[] = [];

  const unit = (overrides: Partial<Unit> = {}): Unit => ({
    category: 'Residential',
    developerId: mivida.developerId,
    projectId: mivida.id,
    cityId: mivida.cityId,
    unitType: 'Apartment',
    unitCode: null,
    floor: null,
    finishingSpecs: null,
    minArea: 150,
    maxArea: 150,
    landArea: null,
    gardenArea: null,
    outdoorArea: null,
    minPrice: 950_000_000,
    maxPrice: 950_000_000,
    deliveryYear: null,
    maintenance: null,
    maintenanceCurrency: null,
    cashDiscount: null,
    cashDiscountCurrency: null,
    cashDiscountType: null,
    downPayment: null,
    installmentsCount: null,
    bedrooms: 3,
    bathrooms: null,
    notes: null,
    priceCurrency: 'EGP',
    downPaymentAmount: null,
    installmentYears: null,
    installmentFrequency: null,
    readyToMove: false,
    confidence: 1,
    needsReview: false,
    reviewReasons: [],
    extras: {},
    ...overrides,
  });

  let counter = 0;
  const post = async (
    group: number,
    sentAt: string,
    extra: Partial<typeof messages.$inferInsert> = {},
  ) => {
    counter += 1;
    const [row] = await testDb.database.db
      .insert(messages)
      .values({
        groupId: group,
        waMessageId: extra.waMessageId ?? `M${counter}`,
        senderHash: 'h'.repeat(64),
        sentAt: new Date(sentAt),
        text: 'x',
        ...extra,
      })
      .returning();
    if (!row) throw new Error('insert failed');
    return row;
  };

  const apply = (
    message: typeof messages.$inferSelect,
    intent: ApplyInput['intent'],
    found: Unit[],
  ) =>
    testDb.database.transaction((tx) =>
      applyExtraction(tx, {
        message,
        intent,
        units: found,
        extractionRunId: null,
        tolerances: DEFAULT_TOLERANCES,
      }),
    );

  const allUnits = () => testDb.database.db.select().from(units).orderBy(asc(units.id));
  const sourcesOf = async (unitId: number) =>
    (await testDb.database.db.select().from(unitSources).where(eq(unitSources.unitId, unitId))).map(
      (s) => s.role,
    );
  const pricesOf = async (unitId: number) =>
    (
      await testDb.database.db
        .select()
        .from(unitPrices)
        .where(eq(unitPrices.unitId, unitId))
        .orderBy(asc(unitPrices.observedAt))
    ).map((p) => [p.minPrice, p.maxPrice]);

  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
    await seed(testDb.database.db);
    const [project] = await testDb.database.db
      .select({ id: projects.id, developerId: projects.developerId, cityId: projects.cityId })
      .from(projects)
      .where(eq(projects.nameEn, 'Mivida'));
    if (!project) throw new Error('seed missing Mivida');
    mivida = project;
    for (const jid of ['a@g.us', 'b@g.us', 'c@g.us']) {
      const [g] = await testDb.database.db
        .insert(waGroups)
        .values({ jid, watched: true })
        .returning({ id: waGroups.id });
      groups.push(g?.id ?? 0);
    }
  });
  afterAll(async () => {
    await testDb.drop();
  });
  beforeEach(async () => {
    await testDb.database.pool.query(
      'truncate unit_prices, unit_sources, units, messages restart identity cascade',
    );
  });

  it('the same unit posted in three groups yields one unit with three sources', async () => {
    const [g1, g2, g3] = groups as [number, number, number];
    const a = await post(g1, '2026-10-20T10:00:00Z');
    const b = await post(g2, '2026-10-20T10:05:00Z');
    const c = await post(g3, '2026-10-21T09:00:00Z');
    expect((await apply(a, 'listing', [unit()])).created).toHaveLength(1);
    // reposts: slightly different area, unknown bedrooms, extra details
    expect(
      (await apply(b, 'listing', [unit({ minArea: 152, maxArea: 152, bedrooms: null })])).merged,
    ).toHaveLength(1);
    expect(
      (await apply(c, 'listing', [unit({ finishingSpecs: 'Semi-finished', deliveryYear: 2028 })]))
        .merged,
    ).toHaveLength(1);

    const [only, ...rest] = await allUnits();
    expect(rest).toEqual([]);
    expect(await sourcesOf(only?.id ?? 0)).toEqual(['listing', 'listing', 'listing']);
    expect(only).toMatchObject({
      minArea: 150, // first post's details are kept
      finishingSpecs: 'Semi-finished', // details missing before are filled in
      deliveryYear: 2028,
      firstSeenAt: new Date('2026-10-20T10:00:00Z'),
      lastSeenAt: new Date('2026-10-21T09:00:00Z'),
    });
    // same price everywhere: one price row, not three
    expect(await pricesOf(only?.id ?? 0)).toEqual([[950_000_000, 950_000_000]]);
  });

  it('keeps different units apart (other bedrooms, other type, far area, named unit)', async () => {
    const [g1] = groups as [number];
    await apply(await post(g1, '2026-10-20T10:00:00Z'), 'listing', [unit()]);
    const second = await apply(await post(g1, '2026-10-20T11:00:00Z'), 'listing', [
      unit({ bedrooms: 2, minArea: 120, maxArea: 120 }),
      unit({ unitType: 'Duplex' }),
      unit({ minArea: 200, maxArea: 200 }),
      unit({ unitCode: 'B12-305' }),
    ]);
    expect(second.created).toHaveLength(4);
    expect(await allUnits()).toHaveLength(5);
  });

  it('a reply with a new price adds a price row instead of a new unit', async () => {
    const [g1] = groups as [number];
    const listing = await post(g1, '2026-10-20T10:00:00Z', { waMessageId: 'ORIG' });
    await apply(listing, 'listing', [unit({ downPayment: 10, installmentsCount: 32 })]);
    const reply = await post(g1, '2026-10-22T10:00:00Z', { quotedWaMessageId: 'ORIG' });
    const result = await apply(reply, 'price_update', [
      unit({
        projectId: null,
        unitType: null,
        minArea: null,
        maxArea: null,
        bedrooms: null,
        minPrice: 900_000_000,
        maxPrice: null,
        downPayment: null,
      }),
    ]);

    expect(result.priceChanged).toHaveLength(1);
    const [only, ...rest] = await allUnits();
    expect(rest).toEqual([]);
    expect(only).toMatchObject({
      minPrice: 900_000_000,
      maxPrice: null,
      downPayment: 10, // payment plan kept: the update didn't mention it
      installmentsCount: 32,
      lastSeenAt: new Date('2026-10-22T10:00:00Z'),
    });
    expect(await pricesOf(only?.id ?? 0)).toEqual([
      [950_000_000, 950_000_000],
      [900_000_000, null],
    ]);
    expect(await sourcesOf(only?.id ?? 0)).toEqual(['listing', 'price_update']);
  });

  it('a repost at a new price also records the change', async () => {
    const [g1, g2] = groups as [number, number];
    await apply(await post(g1, '2026-10-20T10:00:00Z'), 'listing', [unit()]);
    const repost = await apply(await post(g2, '2026-10-25T10:00:00Z'), 'listing', [
      unit({ minPrice: 990_000_000, maxPrice: 990_000_000 }),
    ]);
    expect(repost.priceChanged).toHaveLength(1);
    const [only] = await allUnits();
    expect(only?.minPrice).toBe(990_000_000);
    expect(await pricesOf(only?.id ?? 0)).toHaveLength(2);
  });

  it('an older message processed late adds history but does not overwrite the current price', async () => {
    const [g1, g2] = groups as [number, number];
    await apply(await post(g1, '2026-10-25T10:00:00Z'), 'listing', [
      unit({ minPrice: 990_000_000, maxPrice: 990_000_000 }),
    ]);
    await apply(await post(g2, '2026-10-01T10:00:00Z'), 'listing', [unit()]);
    const [only] = await allUnits();
    expect(only?.minPrice).toBe(990_000_000);
    expect(only?.firstSeenAt).toEqual(new Date('2026-10-01T10:00:00Z'));
    expect(await pricesOf(only?.id ?? 0)).toEqual([
      [950_000_000, 950_000_000],
      [990_000_000, 990_000_000],
    ]);
  });

  it('a sold reply marks the unit sold; reprocessing it changes nothing more', async () => {
    const [g1] = groups as [number];
    const listing = await post(g1, '2026-10-20T10:00:00Z', { waMessageId: 'ORIG' });
    await apply(listing, 'listing', [unit()]);
    const sold = await post(g1, '2026-10-23T10:00:00Z', { quotedWaMessageId: 'ORIG' });
    expect((await apply(sold, 'sold', [])).sold).toHaveLength(1);
    expect((await apply(sold, 'sold', [])).sold).toHaveLength(1);
    const [only] = await allUnits();
    expect(only).toMatchObject({ status: 'sold', soldByMessageId: sold.id });
    expect(await sourcesOf(only?.id ?? 0)).toEqual(['listing', 'sold']);
  });

  it('a reply that does not say which of several units is flagged, not guessed', async () => {
    const [g1] = groups as [number];
    const listing = await post(g1, '2026-10-20T10:00:00Z', { waMessageId: 'ORIG' });
    await apply(listing, 'listing', [unit({ bedrooms: 2, minArea: 120, maxArea: 120 }), unit()]);
    const reply = await post(g1, '2026-10-22T10:00:00Z', { quotedWaMessageId: 'ORIG' });
    const result = await apply(reply, 'price_update', [
      unit({
        projectId: null,
        unitType: null,
        bedrooms: null,
        minArea: null,
        maxArea: null,
        minPrice: 800_000_000,
      }),
    ]);
    expect(result.priceChanged).toEqual([]);
    expect(result.notes[0]).toMatch(/has 2 units and this one does not say which/);
    for (const u of await allUnits()) {
      expect(u.minPrice).not.toBe(800_000_000);
      expect(u.needsReview).toBe(true);
    }
  });

  it('a reply that names the unit type and bedrooms updates only that unit', async () => {
    const [g1] = groups as [number];
    const listing = await post(g1, '2026-10-20T10:00:00Z', { waMessageId: 'ORIG' });
    await apply(listing, 'listing', [unit({ bedrooms: 2, minArea: 120, maxArea: 120 }), unit()]);
    const reply = await post(g1, '2026-10-22T10:00:00Z', { quotedWaMessageId: 'ORIG' });
    await apply(reply, 'price_update', [
      unit({
        projectId: null,
        minArea: null,
        maxArea: null,
        bedrooms: 3,
        minPrice: 800_000_000,
        maxPrice: 800_000_000,
      }),
    ]);
    expect((await allUnits()).map((u) => [u.bedrooms, u.minPrice])).toEqual([
      [2, 950_000_000],
      [3, 800_000_000],
    ]);
  });

  it('reprocessing messages never duplicates, and retracting the only source removes the unit', async () => {
    const [g1, g2] = groups as [number, number];
    const a = await post(g1, '2026-10-20T10:00:00Z');
    const b = await post(g2, '2026-10-21T10:00:00Z');
    await apply(a, 'listing', [unit()]);
    await apply(b, 'listing', [unit({ minPrice: 990_000_000, maxPrice: 990_000_000 })]);
    await apply(a, 'listing', [unit()]);
    await apply(b, 'listing', [unit({ minPrice: 990_000_000, maxPrice: 990_000_000 })]);
    const [only, ...rest] = await allUnits();
    expect(rest).toEqual([]);
    expect(await sourcesOf(only?.id ?? 0)).toHaveLength(2);
    expect(await pricesOf(only?.id ?? 0)).toHaveLength(2);
    expect(only?.minPrice).toBe(990_000_000);

    // b re-extracted as no longer a listing of this unit: its price row goes,
    // and the unit falls back to a's price
    await apply(b, 'listing', []);
    const [after] = await allUnits();
    expect(after?.minPrice).toBe(950_000_000);
    expect(after?.lastSeenAt).toEqual(new Date('2026-10-20T10:00:00Z'));
    // and with a gone too, nothing is left
    await apply(a, 'listing', []);
    expect(await allUnits()).toEqual([]);
  });

  it('never matches listings without a known project', async () => {
    const [g1, g2] = groups as [number, number];
    await apply(await post(g1, '2026-10-20T10:00:00Z'), 'listing', [unit({ projectId: null })]);
    await apply(await post(g2, '2026-10-20T11:00:00Z'), 'listing', [unit({ projectId: null })]);
    expect(await allUnits()).toHaveLength(2);
  });

  it('marks units stale after the configured days, and a repost revives them', async () => {
    const [g1, g2] = groups as [number, number];
    await apply(await post(g1, '2026-08-01T10:00:00Z'), 'listing', [unit()]);
    await apply(await post(g1, '2026-10-20T10:00:00Z'), 'listing', [unit({ unitType: 'Villa' })]);
    expect(await markStale(testDb.database.db, 45, new Date('2026-10-26T00:00:00Z'))).toBe(1);
    expect((await allUnits()).map((u) => u.status)).toEqual(['stale', 'active']);
    await apply(await post(g2, '2026-10-26T10:00:00Z'), 'listing', [unit()]);
    expect((await allUnits()).map((u) => u.status)).toEqual(['active', 'active']);
  });
});
