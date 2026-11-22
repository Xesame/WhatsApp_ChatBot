import { messages, projects, unitPaymentPlans, units, waGroups } from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { seed } from '@reb/db/seed-runner';
import { DEFAULT_TOLERANCES } from '@reb/dedup';
import type { PaymentPlan, Unit } from '@reb/schema';
import { asc, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyExtraction,
  currentPlans,
  currentPlansFor,
  exportUnits,
  PLANS_CHECK_REASON,
  retract,
  type ApplyInput,
} from '../src/index.ts';

/**
 * Payment plans on a real database: every plan of a message is stored, the
 * newest message (by sent time) that stated plans decides a unit's plans, and
 * retracting or reprocessing a message gives back the earlier plans.
 */
describe.skipIf(!testDatabaseUrl)('payment plans (real Postgres)', () => {
  let testDb: TestDatabase;
  let mivida: { id: number; developerId: number; cityId: number };
  let group = 0;

  const plan = (overrides: Partial<PaymentPlan> = {}): PaymentPlan => ({
    position: 0,
    label: null,
    downPaymentPercent: 10,
    downPaymentAmount: null,
    installmentAmount: 10_461_200,
    installmentFrequency: 'quarterly',
    installmentsCount: 32,
    installmentYears: 8,
    planPrice: null,
    cash: false,
    notes: null,
    currency: 'EGP',
    ...overrides,
  });

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
    paymentPlans: [],
    readyToMove: false,
    confidence: 1,
    needsReview: false,
    reviewReasons: [],
    extras: {},
    ...overrides,
  });

  let counter = 0;
  const post = async (sentAt: string, extra: Partial<typeof messages.$inferInsert> = {}) => {
    counter += 1;
    const [row] = await testDb.database.db
      .insert(messages)
      .values({
        groupId: group,
        waMessageId: extra.waMessageId ?? `P${counter}`,
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
  const plansOf = async (unitId: number) =>
    (await currentPlans(testDb.database.db, unitId)).map((p) => p.downPaymentPercent);

  const veloria = [
    plan({ position: 0, downPaymentPercent: 0, installmentAmount: 15_200_000 }),
    plan({ position: 1, downPaymentPercent: 10, installmentAmount: 10_461_200 }),
    plan({ position: 2, downPaymentPercent: 15, installmentAmount: 8_840_000 }),
  ];

  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
    await seed(testDb.database.db);
    const [project] = await testDb.database.db
      .select({ id: projects.id, developerId: projects.developerId, cityId: projects.cityId })
      .from(projects)
      .where(eq(projects.nameEn, 'Mivida'));
    if (!project) throw new Error('seed missing Mivida');
    mivida = project;
    const [g] = await testDb.database.db
      .insert(waGroups)
      .values({ jid: 'plans@g.us', watched: true })
      .returning({ id: waGroups.id });
    group = g?.id ?? 0;
  });
  afterAll(async () => {
    await testDb.drop();
  });
  beforeEach(async () => {
    await testDb.database.pool.query(
      'truncate unit_payment_plans, unit_prices, unit_sources, units, messages restart identity cascade',
    );
  });

  it('stores every plan of a message', async () => {
    const message = await post('2026-11-01T10:00:00Z');
    const { created } = await apply(message, 'listing', [unit({ paymentPlans: veloria })]);
    const id = created[0] ?? 0;
    expect(await currentPlans(testDb.database.db, id)).toEqual(veloria);
    const rows = await testDb.database.db
      .select()
      .from(unitPaymentPlans)
      .where(eq(unitPaymentPlans.unitId, id));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.source === 'message' && r.sourceMessageId === message.id)).toBe(
      true,
    );
    expect(rows[0]?.observedAt).toEqual(new Date('2026-11-01T10:00:00Z'));

    // Reprocessing the same message does not duplicate the rows.
    await apply(message, 'listing', [unit({ paymentPlans: veloria })]);
    const [only] = await allUnits();
    expect(
      await testDb.database.db
        .select()
        .from(unitPaymentPlans)
        .where(eq(unitPaymentPlans.unitId, only?.id ?? 0)),
    ).toHaveLength(3);
  });

  it('the newest message with plans wins', async () => {
    const older = await post('2026-11-01T10:00:00Z');
    const newer = await post('2026-11-05T10:00:00Z');
    // The newer message is processed first; the older one arrives late.
    await apply(newer, 'listing', [unit({ paymentPlans: [plan({ downPaymentPercent: 20 })] })]);
    await apply(older, 'listing', [unit({ paymentPlans: veloria })]);
    const [only, ...rest] = await allUnits();
    expect(rest).toEqual([]);
    expect(await plansOf(only?.id ?? 0)).toEqual([20]);

    // Reprocessing the older message again still leaves the newer plans.
    await apply(older, 'listing', [unit({ paymentPlans: veloria })]);
    expect(await plansOf(only?.id ?? 0)).toEqual([20]);
  });

  it('a message without plans keeps them', async () => {
    await apply(await post('2026-11-01T10:00:00Z'), 'listing', [unit({ paymentPlans: veloria })]);
    await apply(await post('2026-11-05T10:00:00Z'), 'listing', [unit()]);
    const [only] = await allUnits();
    expect(await plansOf(only?.id ?? 0)).toEqual([0, 10, 15]);
    // Same price, no plans: nothing to check.
    expect(only?.reviewReasons).toEqual([]);
  });

  it('retracting a message brings back the previous plans', async () => {
    await apply(await post('2026-11-01T10:00:00Z'), 'listing', [unit({ paymentPlans: veloria })]);
    const newer = await post('2026-11-05T10:00:00Z');
    await apply(newer, 'listing', [unit({ paymentPlans: [plan({ downPaymentPercent: 20 })] })]);
    const [only] = await allUnits();
    expect(await plansOf(only?.id ?? 0)).toEqual([20]);

    await testDb.database.transaction((tx) => retract(tx, newer.id));
    expect(await plansOf(only?.id ?? 0)).toEqual([0, 10, 15]);
  });

  it('gives each unit of a price list the shared plans', async () => {
    const message = await post('2026-11-01T10:00:00Z');
    const { created } = await apply(message, 'listing', [
      unit({ unitType: 'Apartment', paymentPlans: veloria }),
      unit({ unitType: 'Duplex', paymentPlans: veloria }),
      unit({ unitType: 'Penthouse', paymentPlans: veloria }),
    ]);
    expect(created).toHaveLength(3);
    for (const id of created) {
      expect(await currentPlans(testDb.database.db, id)).toEqual(veloria);
    }
  });

  it('asks for a check when only the price changes', async () => {
    await apply(await post('2026-11-01T10:00:00Z', { waMessageId: 'ORIG' }), 'listing', [
      unit({ paymentPlans: veloria }),
    ]);
    const reply = await post('2026-11-05T10:00:00Z', { quotedWaMessageId: 'ORIG' });
    await apply(reply, 'price_update', [
      unit({
        projectId: null,
        unitType: null,
        minArea: null,
        maxArea: null,
        bedrooms: null,
        minPrice: 990_000_000,
        maxPrice: 990_000_000,
      }),
    ]);
    const [only] = await allUnits();
    expect(only?.minPrice).toBe(990_000_000);
    expect(only?.needsReview).toBe(true);
    expect(only?.reviewReasons).toEqual([PLANS_CHECK_REASON]);
    expect(PLANS_CHECK_REASON).toBe('Price changed; check the payment plans');
    // The plans stay visible.
    expect(await plansOf(only?.id ?? 0)).toEqual([0, 10, 15]);
  });

  it('does not ask for a check when the new price comes with its plans, or the plans have no amounts', async () => {
    await apply(await post('2026-11-01T10:00:00Z'), 'listing', [unit({ paymentPlans: veloria })]);
    await apply(await post('2026-11-05T10:00:00Z'), 'listing', [
      unit({ minPrice: 990_000_000, maxPrice: 990_000_000, paymentPlans: veloria }),
    ]);
    const [first] = await allUnits();
    expect(first?.reviewReasons).toEqual([]);

    await testDb.database.pool.query(
      'truncate unit_payment_plans, unit_prices, unit_sources, units, messages restart identity cascade',
    );
    const percentOnly = [plan({ installmentAmount: null, planPrice: null })];
    await apply(await post('2026-11-01T10:00:00Z'), 'listing', [
      unit({ paymentPlans: percentOnly }),
    ]);
    await apply(await post('2026-11-05T10:00:00Z'), 'listing', [
      unit({ minPrice: 990_000_000, maxPrice: 990_000_000 }),
    ]);
    const [second] = await allUnits();
    expect(second?.reviewReasons).toEqual([]);
  });

  it('replaces plans Hassan corrected when a newer post has plans', async () => {
    await apply(await post('2026-11-01T10:00:00Z'), 'listing', [unit({ paymentPlans: veloria })]);
    const [only] = await allUnits();
    const unitId = only?.id ?? 0;
    // Hassan corrects the plans in Review on 3 Nov.
    const { position, ...corrected } = plan({ downPaymentPercent: 5 });
    await testDb.database.db.insert(unitPaymentPlans).values({
      ...corrected,
      position,
      unitId,
      source: 'review',
      sourceMessageId: null,
      observedAt: new Date('2026-11-03T10:00:00Z'),
    });
    expect(await plansOf(unitId)).toEqual([5]);

    // An older message reprocessed later does not undo his correction...
    const late = await post('2026-11-02T10:00:00Z');
    await apply(late, 'listing', [unit({ paymentPlans: [plan({ downPaymentPercent: 25 })] })]);
    expect(await plansOf(unitId)).toEqual([5]);

    // ...but a newer post with plans replaces it.
    await apply(await post('2026-11-05T10:00:00Z'), 'listing', [
      unit({ paymentPlans: [plan({ downPaymentPercent: 30 })] }),
    ]);
    expect(await plansOf(unitId)).toEqual([30]);
  });

  it('reads the current plans of many units at once, by the same rule', async () => {
    await apply(await post('2026-11-01T10:00:00Z'), 'listing', [
      unit({ paymentPlans: veloria }),
      unit({ minArea: 90, maxArea: 90, bedrooms: 1, paymentPlans: veloria }),
      unit({ minArea: 300, maxArea: 300, bedrooms: 5 }),
    ]);
    const [a, b, c] = (await allUnits()).map((u) => u.id);
    if (a === undefined || b === undefined || c === undefined) throw new Error('units missing');
    const db = testDb.database.db;
    const review = (unitId: number, cleared: boolean, percent: number | null) =>
      db.insert(unitPaymentPlans).values({
        ...plan({ downPaymentPercent: percent }),
        unitId,
        source: 'review',
        sourceMessageId: null,
        observedAt: new Date('2026-11-03T10:00:00Z'),
        cleared,
      });
    await review(a, false, 5); // a: corrected in Review (newest source wins)
    await review(b, true, null); // b: cleared in Review ("no plans")
    // A newer post for a only, with plans.
    await apply(await post('2026-11-04T10:00:00Z'), 'listing', [
      unit({ paymentPlans: [plan({ downPaymentPercent: 30 })] }),
    ]);

    const found = await currentPlansFor(db, [a, b, c]);
    for (const id of [a, b, c]) expect(found.get(id) ?? []).toEqual(await currentPlans(db, id));
    expect(found.get(a)?.map((p) => p.downPaymentPercent)).toEqual([30]);
    expect(found.has(b)).toBe(false);
    expect(found.has(c)).toBe(false);
    expect(await currentPlansFor(db, [])).toEqual(new Map());
  });

  it('exports a Payment plans sheet pointing at the unit row', async () => {
    await apply(await post('2026-11-01T10:00:00Z'), 'listing', [
      unit({ paymentPlans: [plan(), plan({ position: 1, downPaymentPercent: 20 })] }),
    ]);
    const { file } = await exportUnits(testDb.database, { usdToEgp: undefined });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      'Primary Units Template',
      'Payment plans',
    ]);
    const sheet = workbook.worksheets[1];
    expect(sheet?.rowCount).toBe(3);
    expect(sheet?.getRow(2).getCell(1).value).toBe(2);
    expect(sheet?.getRow(3).getCell(6).value).toBe(20);
  });
});
