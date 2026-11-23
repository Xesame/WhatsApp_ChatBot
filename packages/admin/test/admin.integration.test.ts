import {
  cities,
  developers,
  entityAliases,
  auditLog,
  extractionRuns,
  messages,
  nameLookups,
  projects,
  reviewCorrections,
  unitPaymentPlans,
  unitPrices,
  units,
  unitSources,
  waConnections,
  waGroups,
} from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { seed } from '@reb/db/seed-runner';
import { currentPlans, matchEntities, retract } from '@reb/pipeline';
import { searchListings } from '@reb/search';
import { asc, eq, ne } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addAlias,
  connectionStatus,
  createEntity,
  getSetting,
  listEntities,
  mergeEntities,
  renameEntity,
  reviewCases,
  reviewQueue,
  reviewUnit,
  reviewUnitDetailed,
  setSetting,
  stats,
  unitView,
  usdToEgpRate,
} from '../src/index.ts';

describe.skipIf(!testDatabaseUrl)('admin (real Postgres)', () => {
  let testDb: TestDatabase;
  let mivida: { id: number; developerId: number; cityId: number };
  let groupId: number;

  /** One listing message with one unit and its first price row, as the pipeline leaves it. */
  const listing = async (overrides: Partial<typeof units.$inferInsert> = {}) => {
    const { db } = testDb.database;
    const [message] = await db
      .insert(messages)
      .values({
        groupId,
        waMessageId: `W${Math.random()}`,
        senderHash: 's'.repeat(64),
        sentAt: new Date('2026-10-20T10:00:00Z'),
        text: 'شقة 3 غرف ميفيدا 165 متر 9.8 مليون',
        status: 'processed',
      })
      .returning();
    const [unit] = await db
      .insert(units)
      .values({
        projectId: mivida.id,
        developerId: mivida.developerId,
        cityId: mivida.cityId,
        unitType: 'Apartment',
        bedrooms: 3,
        minArea: 165,
        maxArea: 165,
        minPrice: 98_000_000, // misread: should be 9.8M = 980,000,000 piastres
        maxPrice: 98_000_000,
        priceCurrency: 'EGP',
        confidence: 0.6,
        needsReview: true,
        reviewReasons: ['Price per m² (5939 EGP) looks wrong'],
        firstSeenAt: new Date('2026-10-20T10:00:00Z'),
        lastSeenAt: new Date('2026-10-20T10:00:00Z'),
        ...overrides,
      })
      .returning();
    if (!message || !unit) throw new Error('insert failed');
    await db
      .insert(unitSources)
      .values({ unitId: unit.id, messageId: message.id, role: 'listing' });
    await db.insert(unitPrices).values({
      unitId: unit.id,
      minPrice: unit.minPrice,
      maxPrice: unit.maxPrice,
      priceCurrency: 'EGP',
      observedAt: message.sentAt,
      sourceMessageId: message.id,
    });
    return { message, unit };
  };

  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
    await seed(testDb.database.db);
    const [p] = await testDb.database.db
      .select({ id: projects.id, developerId: projects.developerId, cityId: projects.cityId })
      .from(projects)
      .where(eq(projects.nameEn, 'Mivida'));
    if (!p) throw new Error('seed missing');
    mivida = p;
    const [g] = await testDb.database.db
      .insert(waGroups)
      .values({ jid: 'g@g.us', name: 'Brokers', watched: true })
      .returning();
    groupId = g?.id ?? 0;
  });
  afterAll(async () => {
    await testDb.drop();
  });
  beforeEach(async () => {
    await testDb.database.pool.query(
      'truncate review_corrections, unit_prices, unit_sources, units, extraction_runs, media_files, messages, settings, wa_connections restart identity cascade',
    );
  });

  describe('review queue', () => {
    it('lists units waiting for review with their source message, but never the sender', async () => {
      await listing();
      await listing({ needsReview: false });
      const queue = await reviewQueue(testDb.database.db, { limit: 10 });
      expect(queue.remaining).toBe(1);
      expect(queue.items).toHaveLength(1);
      const [item] = queue.items;
      expect(item?.names).toEqual({
        developer: 'Emaar Misr',
        project: 'Mivida',
        city: 'New Cairo',
      });
      expect(item?.sources[0]).toMatchObject({
        role: 'listing',
        groupName: 'Brokers',
        text: 'شقة 3 غرف ميفيدا 165 متر 9.8 مليون',
        media: null,
      });
      expect(JSON.stringify(item)).not.toContain('s'.repeat(64));
    });

    it('a correction updates the unit, records each changed field, and fixes the price history', async () => {
      const { unit, message } = await listing();
      const saved = await reviewUnit(
        testDb.database,
        unit.id,
        {
          action: 'approve',
          changes: { minPrice: 980_000_000, maxPrice: 980_000_000, bedrooms: 3 },
        },
        null,
      );
      expect(saved).toMatchObject({
        minPrice: 980_000_000,
        needsReview: false,
        reviewReasons: [],
        confidence: 1,
      });
      const corrections = await testDb.database.db
        .select()
        .from(reviewCorrections)
        .orderBy(asc(reviewCorrections.id));
      expect(corrections.map((c) => [c.action, c.field, c.before, c.after, c.messageId])).toEqual([
        ['edit', 'minPrice', 98_000_000, 980_000_000, message.id],
        ['edit', 'maxPrice', 98_000_000, 980_000_000, message.id],
        ['approve', null, null, null, message.id],
      ]); // bedrooms was unchanged, so not recorded
      const prices = await testDb.database.db
        .select()
        .from(unitPrices)
        .where(eq(unitPrices.unitId, unit.id));
      expect(prices.map((p) => p.minPrice)).toEqual([980_000_000]); // fixed, not a new row
      expect((await reviewQueue(testDb.database.db, { limit: 10 })).remaining).toBe(0);
    });

    it('rejecting withdraws the unit', async () => {
      const { unit } = await listing();
      expect((await reviewUnit(testDb.database, unit.id, { action: 'reject' }, null)).status).toBe(
        'withdrawn',
      );
    });

    it('refuses impossible values and unknown fields', async () => {
      const { unit } = await listing();
      await expect(
        reviewUnit(
          testDb.database,
          unit.id,
          { action: 'save', changes: { downPayment: 150 } },
          null,
        ),
      ).rejects.toThrow();
      await expect(
        reviewUnit(testDb.database, unit.id, { action: 'save', changes: { status: 'sold' } }, null),
      ).rejects.toThrow();
      await expect(
        reviewUnit(testDb.database, 999_999, { action: 'approve' }, null),
      ).rejects.toThrow(/not found/);
    });
  });

  describe('other listings from the same message (siblings)', () => {
    const NAME_REASON = 'project "Villatique" is not in the known list';
    /** One price list message with many units, as the pipeline leaves it: one unit per line. */
    const priceList = async (unitsWanted: Partial<typeof units.$inferInsert>[]) => {
      const { db } = testDb.database;
      const [message] = await db
        .insert(messages)
        .values({
          groupId,
          waMessageId: `W${Math.random()}`,
          senderHash: 's'.repeat(64),
          sentAt: new Date('2026-11-20T10:00:00Z'),
          text: 'DEFAF LAST UPDATE - Villatique\nFirst Floor\n175m - 7,901,250',
          status: 'processed',
        })
        .returning();
      if (!message) throw new Error('insert failed');
      const made = [];
      for (const [i, over] of unitsWanted.entries()) {
        const [unit] = await db
          .insert(units)
          .values({
            unitType: 'Apartment',
            minArea: 175,
            maxArea: 175,
            minPrice: 790_125_000 + i,
            maxPrice: 790_125_000 + i,
            priceCurrency: 'EGP',
            confidence: 0.5,
            needsReview: true,
            reviewReasons: [NAME_REASON],
            extras: { written: { developer: [], project: ['Villatique'], city: [] } },
            firstSeenAt: message.sentAt,
            lastSeenAt: message.sentAt,
            ...over,
          })
          .returning();
        if (!unit) throw new Error('insert failed');
        await db
          .insert(unitSources)
          .values({ unitId: unit.id, messageId: message.id, role: 'listing' });
        made.push(unit);
      }
      return { message, units: made };
    };
    const names = () => ({
      projectId: mivida.id,
      developerId: mivida.developerId,
      cityId: mivida.cityId,
    });
    const unitById = async (id: number) => {
      const [row] = await testDb.database.db.select().from(units).where(eq(units.id, id));
      return row;
    };

    it('counts only waiting siblings with the same project name as written', async () => {
      const {
        units: [first],
      } = await priceList([
        {},
        {},
        // Same name, other spelling of spaces and case: still the same written name.
        { extras: { written: { developer: [], project: [' villatique '], city: [] } } },
        { extras: { written: { developer: [], project: ['Taj City'], city: [] } } },
        { needsReview: false },
        { status: 'withdrawn' },
      ]);
      const view = await unitView(testDb.database.db, first?.id ?? 0);
      expect(view?.siblings).toEqual({ count: 2 });
      // A listing alone in its message has none.
      const alone = await listing();
      expect((await unitView(testDb.database.db, alone.unit.id))?.siblings).toEqual({ count: 0 });
    });

    it('gives the names to waiting siblings, records each change, and trims their name reasons', async () => {
      const {
        message,
        units: [first, plain, withOtherReason, otherName, approved],
      } = await priceList([
        {},
        {},
        { reviewReasons: [NAME_REASON, 'No bedrooms'] },
        { extras: { written: { developer: [], project: ['Taj City'], city: [] } } },
        { needsReview: false, reviewReasons: [] },
      ]);
      const result = await reviewUnitDetailed(
        testDb.database,
        first?.id ?? 0,
        { action: 'save', changes: names(), siblings: { apply: true, approve: false } },
        null,
      );
      expect(result.siblings).toBe(2);
      expect(result.unit).toMatchObject(names());

      const sibling = await unitById(plain?.id ?? 0);
      expect(sibling).toMatchObject({ ...names(), needsReview: false, reviewReasons: [] });
      expect(sibling?.minPrice).toBe(plain?.minPrice); // nothing else touched
      expect(sibling?.confidence).toBe(0.5);
      const kept = await unitById(withOtherReason?.id ?? 0);
      expect(kept).toMatchObject({ ...names(), needsReview: true, reviewReasons: ['No bedrooms'] });

      // A different project name as written, and an already approved unit: untouched.
      expect(await unitById(otherName?.id ?? 0)).toMatchObject({
        projectId: null,
        needsReview: true,
      });
      expect(await unitById(approved?.id ?? 0)).toMatchObject({ projectId: null });

      const corrections = await testDb.database.db
        .select()
        .from(reviewCorrections)
        .where(eq(reviewCorrections.unitId, plain?.id ?? 0))
        .orderBy(asc(reviewCorrections.id));
      expect(corrections.map((c) => [c.action, c.field, c.before, c.after, c.messageId])).toEqual([
        ['edit', 'developerId', null, mivida.developerId, message.id],
        ['edit', 'projectId', null, mivida.id, message.id],
        ['edit', 'cityId', null, mivida.cityId, message.id],
      ]);
    });

    it('approves the siblings too when asked, only with Approve', async () => {
      const {
        units: [first, second],
      } = await priceList([{}, { reviewReasons: [NAME_REASON, 'No bedrooms'] }]);
      // "Approve them too" with a plain save is ignored.
      await reviewUnitDetailed(
        testDb.database,
        first?.id ?? 0,
        { action: 'save', changes: names(), siblings: { apply: true, approve: true } },
        null,
      );
      expect(await unitById(second?.id ?? 0)).toMatchObject({ needsReview: true });

      const result = await reviewUnitDetailed(
        testDb.database,
        first?.id ?? 0,
        { action: 'approve', siblings: { apply: true, approve: true } },
        null,
      );
      expect(result.siblings).toBe(1);
      expect(await unitById(second?.id ?? 0)).toMatchObject({
        needsReview: false,
        reviewReasons: [],
        confidence: 1,
      });
      const actions = await testDb.database.db
        .select({ action: reviewCorrections.action })
        .from(reviewCorrections)
        .where(eq(reviewCorrections.unitId, second?.id ?? 0));
      expect(actions.map((a) => a.action)).toContain('approve');
    });

    it('leaves siblings alone unless asked, and doing it twice changes nothing more', async () => {
      const {
        units: [first, second, third],
      } = await priceList([{}, {}, { reviewReasons: [NAME_REASON, 'No bedrooms'] }]);
      await reviewUnit(testDb.database, first?.id ?? 0, { action: 'save', changes: names() }, null);
      expect(await unitById(second?.id ?? 0)).toMatchObject({ projectId: null });

      const input = {
        action: 'save' as const,
        changes: names(),
        siblings: { apply: true, approve: false },
      };
      expect(
        (await reviewUnitDetailed(testDb.database, first?.id ?? 0, input, null)).siblings,
      ).toBe(2);
      const count = async () => (await testDb.database.db.select().from(reviewCorrections)).length;
      const before = await count();
      expect(
        (await reviewUnitDetailed(testDb.database, first?.id ?? 0, input, null)).siblings,
      ).toBe(0);
      expect(await count()).toBe(before);
      expect(await unitById(third?.id ?? 0)).toMatchObject({ reviewReasons: ['No bedrooms'] });
    });
  });

  describe('payment plans in review', () => {
    const plan = (over: Record<string, unknown> = {}) => ({
      position: 0,
      label: '10% down',
      downPaymentPercent: 10,
      downPaymentAmount: null,
      installmentAmount: null,
      installmentFrequency: null,
      installmentsCount: null,
      installmentYears: 8,
      planPrice: null,
      cash: false,
      notes: null,
      currency: 'EGP',
      ...over,
    });
    const storedPlans = (unitId: number) =>
      testDb.database.db
        .select()
        .from(unitPaymentPlans)
        .where(eq(unitPaymentPlans.unitId, unitId))
        .orderBy(asc(unitPaymentPlans.id));
    const messagePlan = (unitId: number, messageId: number, sentAt: Date, over = {}) =>
      testDb.database.db.insert(unitPaymentPlans).values({
        ...plan(over),
        unitId,
        sourceMessageId: messageId,
        source: 'message',
        observedAt: sentAt,
      } as typeof unitPaymentPlans.$inferInsert);

    it("corrects a unit's plans", async () => {
      const { unit, message } = await listing();
      await messagePlan(unit.id, message.id, message.sentAt, {
        label: 'misread',
        downPaymentPercent: 5,
      });
      expect((await unitView(testDb.database.db, unit.id))?.plans).toHaveLength(1);

      await reviewUnit(
        testDb.database,
        unit.id,
        {
          action: 'save',
          paymentPlans: [plan(), plan({ position: 5, label: 'cash', cash: true })],
        },
        null,
      );

      const rows = await storedPlans(unit.id);
      expect(rows.map((r) => r.source)).toEqual(['message', 'review', 'review']); // message row kept
      expect(rows.slice(1).map((r) => [r.sourceMessageId, r.position])).toEqual([
        [null, 0],
        [null, 1],
      ]);
      const view = await unitView(testDb.database.db, unit.id);
      expect(view?.plans.map((p) => p.label)).toEqual(['10% down', 'cash']);
      const [c] = await testDb.database.db
        .select()
        .from(reviewCorrections)
        .where(eq(reviewCorrections.field, 'paymentPlans'));
      expect(c).toMatchObject({ unitId: unit.id, action: 'edit', messageId: message.id });
      expect((c?.before as { label: string }[]).map((p) => p.label)).toEqual(['misread']);
      expect((c?.after as { label: string }[]).map((p) => p.label)).toEqual(['10% down', 'cash']);

      // Sending the same plans again changes nothing and records nothing.
      await reviewUnit(
        testDb.database,
        unit.id,
        { action: 'save', paymentPlans: view?.plans },
        null,
      );
      expect(await storedPlans(unit.id)).toHaveLength(3);
    });

    const edits = (unitId: number) =>
      testDb.database.db
        .select()
        .from(reviewCorrections)
        .where(eq(reviewCorrections.unitId, unitId))
        .orderBy(asc(reviewCorrections.id));

    it("moves the unit's own columns to the first plan, like a price correction", async () => {
      const { unit, message } = await listing({
        downPayment: 10,
        installmentYears: 8,
        cashDiscount: 15,
        cashDiscountType: 'Percentage',
      });
      await messagePlan(unit.id, message.id, message.sentAt);
      await reviewUnit(
        testDb.database,
        unit.id,
        {
          action: 'save',
          paymentPlans: [
            plan({
              downPaymentPercent: 20,
              installmentFrequency: 'quarterly',
              installmentYears: 5,
            }),
            plan({ position: 1, downPaymentPercent: 0 }),
          ],
        },
        null,
      );
      const db = testDb.database.db;
      const [saved] = await db.select().from(units).where(eq(units.id, unit.id));
      expect(saved).toMatchObject({
        downPayment: 20,
        installmentYears: 5,
        installmentFrequency: 'quarterly',
        // Plans do not carry a cash discount, so a plan edit leaves it as it was.
        cashDiscount: 15,
        cashDiscountType: 'Percentage',
      });
      const fixes = (await edits(unit.id)).filter((c) => c.field !== 'paymentPlans');
      expect(fixes.map((c) => [c.field, c.before, c.after])).toEqual([
        ['downPayment', 10, 20],
        ['installmentYears', 8, 5],
        ['installmentFrequency', null, 'quarterly'],
      ]);
      // The latest price-history row follows (a misread, not a market change).
      const [price] = await db.select().from(unitPrices).where(eq(unitPrices.unitId, unit.id));
      expect(price).toMatchObject({ downPayment: 20, installmentYears: 5 });
    });

    it('works a percent out from a down payment amount and the price', async () => {
      const { unit } = await listing({ minPrice: 980_000_000, maxPrice: 980_000_000 });
      await reviewUnit(
        testDb.database,
        unit.id,
        {
          action: 'save',
          paymentPlans: [plan({ downPaymentPercent: null, downPaymentAmount: 98_000_000 })],
        },
        null,
      );
      const [saved] = await testDb.database.db.select().from(units).where(eq(units.id, unit.id));
      expect(saved).toMatchObject({ downPayment: 10, downPaymentAmount: 98_000_000 });
    });

    it('clears the columns when the plans are cleared, so search stops matching them', async () => {
      const { unit, message } = await listing({
        downPayment: 10,
        installmentYears: 8,
        cashDiscount: 15,
        cashDiscountType: 'Percentage',
        cashDiscountCurrency: null,
      });
      await messagePlan(unit.id, message.id, message.sentAt);
      const db = testDb.database.db;
      const found = async () =>
        (await searchListings(db, { downPaymentMax: 10 }, { usdEgpRate: undefined })).items.map(
          (i) => i.id,
        );
      expect(await found()).toEqual([unit.id]);

      await reviewUnit(testDb.database, unit.id, { action: 'save', paymentPlans: [] }, null);
      const [saved] = await db.select().from(units).where(eq(units.id, unit.id));
      expect(saved).toMatchObject({
        downPayment: null,
        downPaymentAmount: null,
        installmentYears: null,
        installmentsCount: null,
        installmentFrequency: null,
        cashDiscount: null,
        cashDiscountType: null,
        cashDiscountCurrency: null,
      });
      expect(await found()).toEqual([]);
    });

    it("keeps the reviewer's own value for a column edited in the same save", async () => {
      const { unit, message } = await listing({ downPayment: 10 });
      await messagePlan(unit.id, message.id, message.sentAt);
      await reviewUnit(
        testDb.database,
        unit.id,
        {
          action: 'save',
          changes: { downPayment: 25 },
          paymentPlans: [plan({ downPaymentPercent: 20 })],
        },
        null,
      );
      const [saved] = await testDb.database.db.select().from(units).where(eq(units.id, unit.id));
      expect(saved?.downPayment).toBe(25);
    });

    it('does not save a plan row left empty', async () => {
      const { unit } = await listing();
      const blank = plan({ label: null, downPaymentPercent: null, installmentYears: null });
      await reviewUnit(
        testDb.database,
        unit.id,
        { action: 'save', paymentPlans: [blank, plan({ position: 1 }), { ...blank, label: '' }] },
        null,
      );
      const rows = await storedPlans(unit.id);
      expect(rows.map((r) => [r.position, r.label])).toEqual([[0, '10% down']]);
    });

    it('refuses an impossible plan', async () => {
      const { unit } = await listing();
      await expect(
        reviewUnit(
          testDb.database,
          unit.id,
          { action: 'save', paymentPlans: [plan({ downPaymentPercent: 150 })] },
          null,
        ),
      ).rejects.toThrow();
      const tooMany = Array.from({ length: 13 }, (_, i) => plan({ position: i }));
      await expect(
        reviewUnit(testDb.database, unit.id, { action: 'save', paymentPlans: tooMany }, null),
      ).rejects.toThrow();
      expect(await storedPlans(unit.id)).toHaveLength(0);
      expect(await testDb.database.db.select().from(reviewCorrections)).toHaveLength(0);
    });

    it('leaves plans alone when not sent', async () => {
      const { unit, message } = await listing();
      await messagePlan(unit.id, message.id, message.sentAt);
      await reviewUnit(
        testDb.database,
        unit.id,
        { action: 'approve', changes: { bedrooms: 4 } },
        null,
      );
      expect(await storedPlans(unit.id)).toHaveLength(1);
      expect(
        await testDb.database.db
          .select()
          .from(reviewCorrections)
          .where(eq(reviewCorrections.field, 'paymentPlans')),
      ).toHaveLength(0);
    });

    it("clears a unit's plans; a newer message wins again; retracting it clears again", async () => {
      const { unit, message } = await listing();
      await messagePlan(unit.id, message.id, message.sentAt);
      await reviewUnit(testDb.database, unit.id, { action: 'save', paymentPlans: [] }, null);
      const db = testDb.database.db;
      expect((await unitView(db, unit.id))?.plans).toEqual([]);
      expect(await currentPlans(db, unit.id)).toEqual([]);
      const corrections = await db
        .select()
        .from(reviewCorrections)
        .where(eq(reviewCorrections.field, 'paymentPlans'));
      expect(corrections).toHaveLength(1);
      expect(corrections[0]?.after).toEqual([]);
      // Clearing again changes nothing.
      await reviewUnit(testDb.database, unit.id, { action: 'save', paymentPlans: [] }, null);
      expect(await storedPlans(unit.id)).toHaveLength(2);

      // A newer message with plans wins.
      const [laterRow] = await db
        .insert(messages)
        .values({
          groupId: message.groupId,
          waMessageId: `W${Math.random()}`,
          senderHash: 's'.repeat(64),
          sentAt: new Date(Date.now() + 60_000),
          text: 'plans again',
          status: 'processed',
        })
        .returning();
      if (!laterRow) throw new Error('message not stored');
      const later = laterRow;
      await messagePlan(unit.id, later.id, later.sentAt, { label: 'back' });
      expect((await currentPlans(db, unit.id)).map((p) => p.label)).toEqual(['back']);
      // Retracting it leaves the cleared marker as the newest source.
      await testDb.database.transaction((tx) => retract(tx, later.id));
      expect(await currentPlans(db, unit.id)).toEqual([]);
    });
  });

  it('acceptance: review corrections become eval cases', async () => {
    const { unit, message } = await listing();
    await reviewUnit(
      testDb.database,
      unit.id,
      { action: 'approve', changes: { minPrice: 980_000_000, maxPrice: 980_000_000 } },
      null,
    );
    const rejected = await listing({ unitType: 'Villa' });
    await reviewUnit(testDb.database, rejected.unit.id, { action: 'reject' }, null);

    const cases = await reviewCases(testDb.database.db);
    expect(cases.map((c) => c.id).sort()).toEqual(
      [`review-message-${message.id}`, `review-message-${rejected.message.id}`].sort(),
    );
    const corrected = cases.find((c) => c.id === `review-message-${message.id}`);
    expect(corrected?.messageText).toBe('شقة 3 غرف ميفيدا 165 متر 9.8 مليون');
    expect(corrected?.expected).toMatchObject({
      source: 'review',
      kind: 'text',
      intent: 'listing',
      units: [
        {
          project: 'Mivida',
          developer: 'Emaar Misr',
          city: 'New Cairo',
          unitType: 'Apartment',
          minPrice: 9_800_000,
          maxPrice: 9_800_000,
          bedrooms: 3,
        },
      ],
    });
    const notListing = cases.find((c) => c.id === `review-message-${rejected.message.id}`);
    expect(notListing?.expected).toMatchObject({ intent: 'not_relevant', units: [] });
  });

  it("takes expected plans only from the case's own message", async () => {
    const { db } = testDb.database;
    const { unit, message } = await listing();
    // A later repost of the same unit with different plans: today's plans, but
    // not what the first message said.
    const [repost] = await db
      .insert(messages)
      .values({
        groupId,
        waMessageId: `W${Math.random()}`,
        senderHash: 's'.repeat(64),
        sentAt: new Date('2026-10-25T10:00:00Z'),
        text: 'repost',
        status: 'processed',
      })
      .returning();
    if (!repost) throw new Error('insert failed');
    await db.insert(unitSources).values({ unitId: unit.id, messageId: repost.id, role: 'listing' });
    const row = (position: number, downPaymentPercent: number, installmentAmount: number) => ({
      unitId: unit.id,
      position,
      downPaymentPercent,
      installmentAmount,
      installmentFrequency: 'quarterly' as const,
      installmentYears: 8,
      currency: 'EGP' as const,
    });
    await db.insert(unitPaymentPlans).values([
      {
        ...row(0, 0, 15_200_000),
        source: 'message',
        sourceMessageId: message.id,
        observedAt: message.sentAt,
      },
      {
        ...row(1, 10, 10_461_200),
        source: 'message',
        sourceMessageId: message.id,
        observedAt: message.sentAt,
      },
      {
        ...row(0, 20, 7_527_600),
        source: 'message',
        sourceMessageId: repost.id,
        observedAt: repost.sentAt,
      },
    ]);
    await reviewUnit(testDb.database, unit.id, { action: 'approve' }, null);

    const planOf = async () =>
      (await reviewCases(db)).find((c) => c.id === `review-message-${message.id}`)?.expected
        .units[0]?.paymentPlans;
    expect(await planOf()).toEqual([
      {
        downPaymentPercent: 0,
        installmentAmount: 152_000,
        installmentFrequency: 'quarterly',
        installmentYears: 8,
      },
      {
        downPaymentPercent: 10,
        installmentAmount: 104_612,
        installmentFrequency: 'quarterly',
        installmentYears: 8,
      },
    ]);

    // Plans the owner typed while reviewing this unit are the expected answer.
    await db.insert(unitPaymentPlans).values({
      ...row(0, 5, 9_000_000),
      source: 'review',
      sourceMessageId: null,
      observedAt: new Date('2026-10-26T10:00:00Z'),
    });
    await db.insert(reviewCorrections).values({
      unitId: unit.id,
      messageId: message.id,
      action: 'edit',
      field: 'paymentPlans',
      before: [],
      after: [],
    });
    expect(await planOf()).toEqual([
      {
        downPaymentPercent: 5,
        installmentAmount: 90_000,
        installmentFrequency: 'quarterly',
        installmentYears: 8,
      },
    ]);
  });

  it('accuracy cases expect no plans once Review cleared them', async () => {
    const { unit, message } = await listing();
    const db = testDb.database.db;
    await db.insert(unitPaymentPlans).values({
      unitId: unit.id,
      position: 0,
      downPaymentPercent: 10,
      installmentFrequency: 'quarterly',
      installmentYears: 8,
      currency: 'EGP',
      source: 'message',
      sourceMessageId: message.id,
      observedAt: message.sentAt,
    });
    await reviewUnit(testDb.database, unit.id, { action: 'approve', paymentPlans: [] }, null);
    const found = (await reviewCases(db)).find((c) => c.id === `review-message-${message.id}`);
    expect(found?.expected.units[0]?.paymentPlans ?? []).toEqual([]);
  });

  it('unit view shows the price history in order', async () => {
    const { unit } = await listing();
    const view = await unitView(testDb.database.db, unit.id);
    expect(view?.prices.map((p) => p.minPrice)).toEqual([98_000_000]);
  });

  describe('remembering a spelling from review', () => {
    // Entities are not truncated between tests, so remove the one these tests create.
    beforeEach(async () => {
      await testDb.database.pool.query(
        "delete from entity_aliases where project_id in (select id from projects where name_en = 'Zomra East Residence')",
      );
      await testDb.database.pool.query(
        "delete from projects where name_en = 'Zomra East Residence'",
      );
    });
    const makeProject = async (nameEn: string, nameAr: string) =>
      createEntity(testDb.database.db, 'project', {
        nameEn,
        nameAr,
        developerId: mivida.developerId,
        cityId: mivida.cityId,
      });
    const aliasesOf = (projectId: number) =>
      testDb.database.db.select().from(entityAliases).where(eq(entityAliases.projectId, projectId));

    it('remembers a spelling when asked', async () => {
      const projectId = await makeProject('Zomra East Residence', 'زمرة ايست ريزيدنس');
      const { unit } = await listing({
        extras: { written: { developer: [], project: ['Zomra East'], city: [] } },
      });
      await reviewUnit(
        testDb.database,
        unit.id,
        {
          action: 'approve',
          changes: { projectId },
          remember: [{ kind: 'project', alias: 'Zomra East' }],
        },
        null,
      );
      const learned = (await aliasesOf(projectId)).find((a) => a.alias === 'Zomra East');
      expect(learned).toMatchObject({ source: 'review', reviewUnitId: unit.id });
      const view = await unitView(testDb.database.db, unit.id);
      expect(view?.learning.written.project).toEqual(['Zomra East']);
    });

    it('does not duplicate a known spelling', async () => {
      const projectId = await makeProject('Zomra East Residence', 'زمرة ايست ريزيدنس');
      const { unit } = await listing();
      const remember = [{ kind: 'project' as const, alias: 'Zomra East' }];
      for (let i = 0; i < 2; i++) {
        await reviewUnit(
          testDb.database,
          unit.id,
          { action: 'save', changes: { projectId }, remember },
          null,
        );
      }
      // The project's own English name is already a spelling: remembering it adds nothing.
      await reviewUnit(
        testDb.database,
        unit.id,
        { action: 'save', remember: [{ kind: 'project', alias: 'Zomra East Residence' }] },
        null,
      );
      const rows = await aliasesOf(projectId);
      expect(rows.filter((a) => a.alias === 'Zomra East')).toHaveLength(1);
      expect(rows.filter((a) => a.alias === 'Zomra East Residence')).toHaveLength(1);
    });

    it('matches Arabic spellings either way', async () => {
      const projectId = await makeProject('Zomra East Residence', 'زمرة ايست ريزيدنس');
      const { unit } = await listing();
      await reviewUnit(
        testDb.database,
        unit.id,
        {
          action: 'approve',
          changes: { projectId },
          remember: [{ kind: 'project', alias: 'زمرة ايست' }],
        },
        null,
      );
      const found = await matchEntities(testDb.database.db, {
        developer: null,
        project: 'زمره ايست',
        city: null,
      });
      expect(found.project).toMatchObject({ id: projectId, similarity: 1 });
    });

    it('learns nothing when the box is unticked', async () => {
      const projectId = await makeProject('Zomra East Residence', 'زمرة ايست ريزيدنس');
      const { unit } = await listing();
      await reviewUnit(
        testDb.database,
        unit.id,
        { action: 'approve', changes: { projectId } },
        null,
      );
      expect((await aliasesOf(projectId)).filter((a) => a.source === 'review')).toEqual([]);
    });
  });

  describe('what Gemini remembers about a waiting project', () => {
    const waiting = () =>
      listing({
        projectId: null,
        developerId: null,
        cityId: null,
        extras: { written: { developer: [], project: ['Lumia Lagoons'], city: [] } },
      });
    const remember = (row: Partial<typeof nameLookups.$inferInsert> = {}) =>
      testDb.database.db.insert(nameLookups).values({
        name: 'Lumia Lagoons',
        nameNormalized: 'lumia lagoons',
        known: true,
        developer: 'Emaar Misr',
        city: 'New Cairo',
        model: 'gemini-test',
        promptVersion: 'test',
        ...row,
      });
    const actions = async () =>
      (await testDb.database.db.select().from(auditLog).orderBy(asc(auditLog.id))).filter((r) =>
        r.action.startsWith('lookup.'),
      );
    beforeEach(async () => {
      await testDb.database.pool.query('truncate name_lookups, audit_log');
    });

    it('shows what Gemini remembers for a waiting unit', async () => {
      const { unit } = await waiting();
      expect((await unitView(testDb.database.db, unit.id))?.learning.lookup).toBeNull();
      await remember();
      expect((await unitView(testDb.database.db, unit.id))?.learning.lookup).toEqual({
        developer: 'Emaar Misr',
        city: 'New Cairo',
      });
      // "Not sure" is not an answer to show.
      await testDb.database.pool.query('truncate name_lookups');
      await remember({ known: false, developer: null, city: null });
      expect((await unitView(testDb.database.db, unit.id))?.learning.lookup).toBeNull();
    });

    const save = (unitId: number, changes: Record<string, unknown>, ip?: string) =>
      reviewUnit(testDb.database, unitId, { action: 'save', changes }, null, ip);
    const other = async (table: typeof developers | typeof cities, keep: number) => {
      const [row] = await testDb.database.db
        .select({ id: table.id })
        .from(table)
        .where(ne(table.id, keep))
        .limit(1);
      return row?.id;
    };
    const seen = async () => (await actions()).map((a) => [a.action, a.target, a.ipAddress]);

    it('counts a remembered answer once, when the unit is saved', async () => {
      await remember();
      const first = await waiting();
      // Same developer as the answer: used. A different area: ignored.
      await save(
        first.unit.id,
        { developerId: mivida.developerId, cityId: await other(cities, mivida.cityId) },
        '10.0.0.1',
      );
      expect(await seen()).toEqual([
        ['lookup.used', 'Emaar Misr', '10.0.0.1'],
        ['lookup.ignored', 'New Cairo', '10.0.0.1'],
      ]);
      // Saving again changes nothing: the fields are no longer empty.
      await save(first.unit.id, { developerId: await other(developers, mivida.developerId) });
      expect(await actions()).toHaveLength(2);
    });

    it('counts the area that matches, and a different developer', async () => {
      await remember();
      const { unit } = await waiting();
      await save(unit.id, {
        developerId: await other(developers, mivida.developerId),
        cityId: mivida.cityId,
      });
      expect((await seen()).map((r) => r.slice(0, 2))).toEqual([
        ['lookup.ignored', 'Emaar Misr'],
        ['lookup.used', 'New Cairo'],
      ]);
    });

    it('matches the answer by any spelling of the saved entity', async () => {
      await remember({ developer: 'Emaar', city: null });
      const { unit } = await waiting();
      // "Emaar" is a seeded spelling of Emaar Misr.
      await save(unit.id, { developerId: mivida.developerId });
      expect((await seen()).map((r) => r.slice(0, 2))).toEqual([['lookup.used', 'Emaar']]);
    });

    it('counts nothing without an answer, or when the field was already filled', async () => {
      const bare = await waiting();
      await save(bare.unit.id, { developerId: mivida.developerId });
      await remember();
      const filled = await listing({
        projectId: null,
        cityId: null,
        extras: { written: { developer: [], project: ['Lumia Lagoons'], city: [] } },
      });
      await save(filled.unit.id, { developerId: await other(developers, mivida.developerId) });
      expect(await actions()).toEqual([]);
    });
  });

  describe('entities', () => {
    it('creates an entity with its names as spellings, adds aliases, renames', async () => {
      const { db } = testDb.database;
      const id = await createEntity(db, 'developer', {
        nameEn: 'Test Developer',
        nameAr: 'مطور تجريبي',
      });
      expect(await addAlias(db, 'developer', id, 'TD')).toBe(true);
      expect(await addAlias(db, 'developer', id, 'td')).toBe(false); // same spelling after normalization
      await renameEntity(db, 'developer', id, { nameEn: 'Test Developments' });
      const [view] = await listEntities(db, 'developer', 'Test Dev');
      expect(view?.nameEn).toBe('Test Developments');
      expect(view?.aliases.map((a) => a.alias).sort()).toEqual(
        ['TD', 'Test Developer', 'Test Developments', 'مطور تجريبي'].sort(),
      );
    });

    it('merging a duplicate moves its units, projects and spellings, then deletes it', async () => {
      const { db } = testDb.database;
      const dup = await createEntity(db, 'city', { nameEn: 'New Cairo City', nameAr: 'نيو كايرو' });
      const project = await createEntity(db, 'project', {
        nameEn: 'Dup Project',
        nameAr: 'مشروع',
        developerId: mivida.developerId,
        cityId: dup,
      });
      const { unit } = await listing({ cityId: dup, projectId: project });
      await mergeEntities(testDb.database, 'city', dup, mivida.cityId);
      expect(await db.select().from(cities).where(eq(cities.id, dup))).toEqual([]);
      expect((await db.select().from(units).where(eq(units.id, unit.id)))[0]?.cityId).toBe(
        mivida.cityId,
      );
      expect((await db.select().from(projects).where(eq(projects.id, project)))[0]?.cityId).toBe(
        mivida.cityId,
      );
      const moved = await db
        .select()
        .from(entityAliases)
        .where(eq(entityAliases.cityId, mivida.cityId));
      expect(moved.map((a) => a.alias)).toContain('نيو كايرو');
      await expect(
        mergeEntities(testDb.database, 'city', mivida.cityId, mivida.cityId),
      ).rejects.toThrow(/itself/);
      expect(
        await db.select().from(developers).where(eq(developers.id, mivida.developerId)),
      ).toHaveLength(1);
    });
  });

  describe('settings', () => {
    it('stores a validated USD rate, used before the environment fallback', async () => {
      const { db } = testDb.database;
      expect(await usdToEgpRate(db, 48)).toBe(48);
      await setSetting(db, 'usd_egp_rate', 50.5, null);
      expect(await getSetting(db, 'usd_egp_rate')).toBe(50.5);
      expect(await usdToEgpRate(db, 48)).toBe(50.5);
      await expect(setSetting(db, 'usd_egp_rate', -1, null)).rejects.toThrow();
    });
  });

  describe('weekly learning numbers', () => {
    const approve = (unitId: number) =>
      testDb.database.db.insert(reviewCorrections).values({ unitId, action: 'approve' });
    const edit = (unitId: number, field: string) =>
      testDb.database.db
        .insert(reviewCorrections)
        .values({ unitId, action: 'edit', field, before: 1, after: 2 });
    const weeksNow = async () => (await stats(testDb.database)).weeks;

    it('reports learning per week', async () => {
      const a = await listing({ flaggedOnArrival: true });
      const b = await listing({ flaggedOnArrival: true });
      await listing();
      await approve(a.unit.id);
      await edit(b.unit.id, 'minPrice');
      await edit(b.unit.id, 'maxPrice');
      await approve(b.unit.id);
      const weeks = await weeksNow();
      expect(weeks).toHaveLength(12);
      expect(weeks.slice(0, 11).every((w) => w.newUnits === 0 && w.reviewed === 0)).toBe(true);
      expect(weeks[0]?.correctionsPerReviewed).toBeNull();
      expect(weeks[11]).toMatchObject({
        newUnits: 3,
        flaggedOnArrival: 2,
        reviewed: 2,
        rightFirstTime: 1,
        correctionsPerReviewed: 1,
      });
      expect(weeks[11]?.week).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('ignores fixes made after the first approval', async () => {
      const a = await listing();
      const approvedAt = new Date(Date.now() - 60_000);
      await testDb.database.db
        .insert(reviewCorrections)
        .values({ unitId: a.unit.id, action: 'approve', createdAt: approvedAt });
      await edit(a.unit.id, 'bedrooms'); // a later fix: the bot was right when approved
      expect((await weeksNow())[11]).toMatchObject({
        reviewed: 1,
        rightFirstTime: 1,
        correctionsPerReviewed: 0,
      });
    });

    it('does not count a unit as right first time when its name was learned during review', async () => {
      const a = await listing();
      await approve(a.unit.id);
      await testDb.database.db.insert(entityAliases).values({
        alias: 'ميفيدا الجديدة',
        aliasNormalized: 'ميفيدا الجديدة',
        projectId: mivida.id,
        source: 'review',
        reviewUnitId: a.unit.id,
      });
      try {
        expect((await weeksNow())[11]).toMatchObject({
          reviewed: 1,
          rightFirstTime: 0,
          correctionsPerReviewed: 0,
        });
      } finally {
        await testDb.database.db.delete(entityAliases).where(eq(entityAliases.source, 'review'));
      }
    });
  });

  it('stats count messages, outcomes, model cost and review load', async () => {
    const { db } = testDb.database;
    const { message } = await listing();
    await db.insert(messages).values({
      groupId,
      waMessageId: 'F',
      senderHash: 's',
      sentAt: new Date(),
      text: 'x',
      status: 'failed',
    });
    await db.insert(extractionRuns).values({
      messageId: message.id,
      purpose: 'extract',
      promptVersion: 'v',
      provider: 'gemini',
      model: 'm',
      request: {},
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.0012,
      latencyMs: 900,
      status: 'ok',
    });
    await db.update(messages).set({ sentAt: new Date() }).where(eq(messages.id, message.id));
    const result = await stats(testDb.database);
    const total = result.days.reduce(
      (s, d) => ({
        messages: s.messages + d.messages,
        calls: s.calls + d.modelCalls,
        cost: s.cost + d.costUsd,
      }),
      { messages: 0, calls: 0, cost: 0 },
    );
    expect(total).toEqual({ messages: 2, calls: 1, cost: 0.0012 });
    expect(result.extractionSuccessRate).toBe(0.5);
    expect(result.needsReview).toBe(1);
    expect(result.needsReviewRate).toBe(1);
  });

  it('shows the pairing QR code as an SVG image while waiting for pairing', async () => {
    const { db } = testDb.database;
    await db
      .insert(waConnections)
      .values({ account: 'scraper', state: 'awaiting_pairing', qr: '2@abc,def,ghi' });
    const [view] = await connectionStatus(db);
    expect(view?.state).toBe('awaiting_pairing');
    expect(view?.qrSvg).toMatch(/^<svg/);
    await db.update(waConnections).set({ state: 'open' });
    expect((await connectionStatus(db))[0]?.qrSvg).toBeNull();
  });
});
