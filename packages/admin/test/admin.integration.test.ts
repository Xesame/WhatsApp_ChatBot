import {
  cities,
  developers,
  entityAliases,
  extractionRuns,
  messages,
  projects,
  reviewCorrections,
  unitPrices,
  units,
  unitSources,
  waConnections,
  waGroups,
} from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { seed } from '@reb/db/seed-runner';
import { asc, eq } from 'drizzle-orm';
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

  it('unit view shows the price history in order', async () => {
    const { unit } = await listing();
    const view = await unitView(testDb.database.db, unit.id);
    expect(view?.prices.map((p) => p.minPrice)).toEqual([98_000_000]);
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
