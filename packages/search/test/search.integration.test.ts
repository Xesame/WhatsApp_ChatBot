import {
  mediaFiles,
  messages,
  projects,
  unitPaymentPlans,
  unitPrices,
  units,
  unitSources,
  waGroups,
} from '@reb/db';
import { seed } from '@reb/db/seed-runner';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  listingDetail,
  matchingIds,
  searchListings,
  visibleMedia,
  type SearchFilters,
} from '../src/index.ts';

describe.skipIf(!testDatabaseUrl)('listing search (real Postgres)', () => {
  let testDb: TestDatabase;
  const id: Record<string, number> = {};
  let mediaId = 0;

  const search = async (filters: SearchFilters, rate: number | null = 50) =>
    (
      await searchListings(testDb.database.db, filters, {
        usdEgpRate: rate ?? undefined,
        pageSize: 100,
      })
    ).items.map((i) => i.id);
  const named = (...names: string[]) => names.map((n) => id[n]).sort();
  const sorted = (ids: number[]) => [...ids].sort();

  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
    const { db } = testDb.database;
    await seed(db);
    const project = async (name: string) => {
      const [p] = await db.select().from(projects).where(eq(projects.nameEn, name));
      if (!p) throw new Error(`no project ${name}`);
      return p;
    };
    const mivida = await project('Mivida');
    const [other] = await db.select().from(projects).where(eq(projects.nameEn, 'Madinaty'));
    if (!other) throw new Error('seed');
    const [group] = await db
      .insert(waGroups)
      .values({ jid: 'g@g.us', name: 'Secret Source Group', watched: true, sourceType: 'broker' })
      .returning();
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);
    let n = 0;
    const unit = async (
      name: string,
      values: Partial<typeof units.$inferInsert>,
      text = 'listing',
      p = mivida,
    ) => {
      const [m] = await db
        .insert(messages)
        .values({
          groupId: group?.id ?? 0,
          waMessageId: `m${n++}`,
          senderHash: 'secret-sender-hash',
          sentAt: at(5),
          text,
          status: 'processed',
        })
        .returning();
      const [u] = await db
        .insert(units)
        .values({
          projectId: p.id,
          developerId: p.developerId,
          cityId: p.cityId,
          unitType: 'Apartment',
          firstSeenAt: at(5),
          lastSeenAt: at(5),
          confidence: 0.9,
          needsReview: false,
          ...values,
        })
        .returning();
      if (!u || !m) throw new Error('insert');
      await db.insert(unitSources).values({ unitId: u.id, messageId: m.id, role: 'listing' });
      id[name] = u.id;
      return { u, m };
    };
    // prices in piastres
    await unit('cheap', {
      bedrooms: 2,
      minArea: 100,
      maxArea: 100,
      minPrice: 500_000_000,
      maxPrice: 500_000_000,
      deliveryYear: 2027,
      downPayment: 5,
      installmentYears: 10,
      lastSeenAt: at(1),
    });
    const mid = await unit(
      'mid',
      {
        bedrooms: 3,
        minArea: 150,
        maxArea: 180,
        minPrice: 800_000_000,
        maxPrice: 950_000_000,
        deliveryYear: 2029,
        downPayment: 10,
        installmentYears: 8,
        lastSeenAt: at(2),
      },
      'شقة 3 غرف للتواصل 01001234567 او broker@example.com',
    );
    await unit('usd', {
      unitType: 'Villa',
      bedrooms: 4,
      minArea: 300,
      maxArea: 300,
      minPrice: 40_000_000,
      maxPrice: 40_000_000,
      priceCurrency: 'USD',
      readyToMove: true,
      lastSeenAt: at(3),
    }); // $400k = EGP 20M at 50
    await unit(
      'madinaty',
      {
        bedrooms: 3,
        minArea: 160,
        maxArea: 160,
        minPrice: 700_000_000,
        maxPrice: 700_000_000,
        deliveryYear: 2026,
        lastSeenAt: at(4),
      },
      'listing',
      other,
    );
    await unit('sold', {
      status: 'sold',
      bedrooms: 2,
      minArea: 110,
      maxArea: 110,
      minPrice: 520_000_000,
      maxPrice: 520_000_000,
    });
    await unit('withdrawn', { status: 'withdrawn', bedrooms: 2, minPrice: 1, maxPrice: 1 });

    // mid dropped in price: 9.5M then 8M
    await db.insert(unitPrices).values([
      {
        unitId: id.mid ?? 0,
        minPrice: 950_000_000,
        maxPrice: 950_000_000,
        priceCurrency: 'EGP',
        observedAt: at(20),
        sourceMessageId: mid.m.id,
      },
      {
        unitId: id.mid ?? 0,
        minPrice: 800_000_000,
        maxPrice: 950_000_000,
        priceCurrency: 'EGP',
        observedAt: at(2),
        sourceMessageId: mid.m.id,
      },
    ]);
    // Payment plans. 'veloria': an old message said 5% (stale), the newest says 20% and 0%.
    const plan = (
      unitName: string,
      daysAgo: number,
      position: number,
      values: Partial<typeof unitPaymentPlans.$inferInsert>,
    ) => ({
      unitId: id[unitName] ?? 0,
      sourceMessageId: planMessage[unitName]?.[daysAgo] ?? null,
      source: 'message' as const,
      position,
      currency: 'EGP' as const,
      cash: false,
      observedAt: at(daysAgo),
      ...values,
    });
    const planMessage: Record<string, Record<number, number>> = {};
    for (const [name, days] of [
      ['cheap', [30, 3]],
      ['mid', [3]],
      ['usd', [3]],
      ['madinaty', [3]],
      ['sold', [3]],
    ] as const) {
      planMessage[name] = {};
      for (const d of days) {
        const [m] = await db
          .insert(messages)
          .values({
            groupId: group?.id ?? 0,
            waMessageId: `plan-${name}-${d}`,
            senderHash: 'secret-sender-hash',
            sentAt: at(d),
            text: 'plans',
            status: 'processed',
          })
          .returning();
        planMessage[name][d] = m?.id ?? 0;
      }
    }
    await db.insert(unitPaymentPlans).values([
      // cheap: an old message said 50% over 20 years; the newest says 20% and 0%
      plan('cheap', 30, 0, { downPaymentPercent: 50, installmentYears: 20 }),
      plan('cheap', 3, 0, { downPaymentPercent: 20, installmentYears: 7 }),
      plan('cheap', 3, 1, { downPaymentPercent: 0, installmentYears: 10 }),
      // mid: quarterly 152,000 EGP = 50,667 a month; plus a cash option
      plan('mid', 3, 0, {
        downPaymentPercent: 10,
        installmentAmount: 15_200_000,
        installmentFrequency: 'quarterly',
        installmentYears: 8,
      }),
      plan('mid', 3, 1, { cash: true, downPaymentPercent: null }),
      // usd: 1,000 USD monthly = 50,000 EGP at the rate of 50
      plan('usd', 3, 0, {
        currency: 'USD',
        installmentAmount: 100_000,
        installmentFrequency: 'monthly',
      }),
      // madinaty: cash only
      plan('madinaty', 3, 0, { cash: true }),
      // sold: no single plan has both a low down payment and a long term
      plan('sold', 3, 0, { downPaymentPercent: 0, installmentYears: 5 }),
      plan('sold', 3, 1, { downPaymentPercent: 20, installmentYears: 10 }),
    ]);
    const [file] = await db
      .insert(mediaFiles)
      .values({
        messageId: mid.m.id,
        kind: 'image',
        mimeType: 'image/jpeg',
        path: 'ab/x.jpg',
        status: 'downloaded',
        mediaRef: {},
        derivedText: 'Call 0122 333 4444',
      })
      .returning();
    mediaId = file?.id ?? 0;
  });
  afterAll(async () => {
    await testDb.drop();
  });

  it('shows active listings by default, never withdrawn ones', async () => {
    expect(sorted(await search({}))).toEqual(named('cheap', 'mid', 'usd', 'madinaty'));
    expect(sorted(await search({ statuses: ['active', 'sold'] }))).toEqual(
      named('cheap', 'mid', 'usd', 'madinaty', 'sold'),
    );
  });

  it('filters by project, type, bedrooms and area (ranges overlap)', async () => {
    expect(sorted(await search({ q: 'ميفيدا', bedroomsMin: 3 }))).toEqual(named('mid', 'usd'));
    expect(await search({ q: 'mivida', unitTypes: ['Villa'] })).toEqual([id.usd]);
    expect(sorted(await search({ areaMin: 170 }))).toEqual(named('mid', 'usd')); // 150-180 overlaps "at least 170"
    expect(sorted(await search({ areaMax: 120 }))).toEqual(named('cheap'));
  });

  it('compares prices in EGP, converting USD at the rate', async () => {
    expect(sorted(await search({ priceMin: 15_000_000 }))).toEqual(named('usd'));
    expect(sorted(await search({ priceMax: 8_000_000 }))).toEqual(
      named('cheap', 'mid', 'madinaty'),
    ); // mid starts at 8M
    // without a rate a USD listing has no EGP price, so price filters leave it out
    expect(await search({ priceMin: 15_000_000 }, null)).toEqual([]);
  });

  it('filters by delivery, payment plan and price drops', async () => {
    expect(sorted(await search({ deliveryYearMax: 2027 }))).toEqual(
      named('cheap', 'usd', 'madinaty'),
    ); // ready to move counts
    expect(sorted(await search({ downPaymentMax: 5, installmentYearsMin: 10 }))).toEqual(
      named('cheap'),
    );
    expect(await search({ priceDropped: true })).toEqual([id.mid]);
  });

  it('matches a unit when any plan fits', async () => {
    // cheap's newest plans are 20% and 0%; its old 50% / 20 years plan no longer counts
    expect(await search({ downPaymentMax: 20 })).toContain(id.cheap);
    expect(sorted(await search({ downPaymentMax: 0 }))).toEqual(named('cheap'));
    expect(sorted(await search({ downPaymentMax: 5 }))).toEqual(named('cheap'));
    expect(await search({ installmentYearsMin: 10 })).toEqual([id.cheap]);
    expect(await search({ installmentYearsMin: 15 })).toEqual([]);
    // mid's plan says 10%
    expect(sorted(await search({ downPaymentMax: 10 }))).toEqual(named('cheap', 'mid'));
  });

  it('needs one plan to satisfy every plan filter together', async () => {
    const sold = { statuses: ['sold' as const] };
    expect(await search({ ...sold, downPaymentMax: 5 })).toEqual([id.sold]);
    expect(await search({ ...sold, installmentYearsMin: 10 })).toEqual([id.sold]);
    expect(await search({ ...sold, downPaymentMax: 5, installmentYearsMin: 10 })).toEqual([]);
    expect(await search({ ...sold, downPaymentMax: 20, installmentYearsMin: 10 })).toEqual([
      id.sold,
    ]);
  });

  it('filters by monthly payment', async () => {
    expect(sorted(await search({ monthlyInstallmentMax: 60_000 }))).toEqual(named('mid', 'usd'));
    expect(sorted(await search({ monthlyInstallmentMax: 50_000 }))).toEqual(named('usd'));
  });

  it('skips cash-only plans', async () => {
    expect(await search({ monthlyInstallmentMax: 100_000_000 })).not.toContain(id.madinaty);
    expect(await search({ monthlyInstallmentMax: 100_000_000 })).not.toContain(id.cheap);
  });

  it('converts USD plans for the monthly filter', async () => {
    expect(await search({ monthlyInstallmentMax: 60_000 }, 50)).toContain(id.usd);
    expect(await search({ monthlyInstallmentMax: 60_000 }, 70)).not.toContain(id.usd);
    expect(await search({ monthlyInstallmentMax: 60_000 }, null)).not.toContain(id.usd);
  });

  it('shows plans on the listing without sources', async () => {
    const detail = await listingDetail(testDb.database.db, id.mid ?? 0);
    expect(detail?.paymentPlans).toHaveLength(2);
    expect(detail?.paymentPlans[0]).toMatchObject({
      downPaymentPercent: 10,
      installmentAmount: 15_200_000,
      installmentFrequency: 'quarterly',
      installmentYears: 8,
    });
    expect(detail?.paymentPlans[0]?.monthlyEquivalent).toBe(5_066_667);
    expect(detail?.paymentPlans[1]).toMatchObject({ cash: true, monthlyEquivalent: null });
    const old = await listingDetail(testDb.database.db, id.cheap ?? 0);
    expect(old?.paymentPlans.map((p) => p.downPaymentPercent)).toEqual([20, 0]);
    const json = JSON.stringify(detail?.paymentPlans);
    expect(json).not.toContain('sourceMessageId');
    expect(json).not.toContain('observedAt');
  });

  it('sorts by newest, price and price per m²', async () => {
    expect(await search({ sort: 'newest' })).toEqual([id.cheap, id.mid, id.usd, id.madinaty]);
    expect(await search({ sort: 'price_asc' })).toEqual([id.cheap, id.madinaty, id.mid, id.usd]);
    // per m²: cheap 50k, mid 53.3k, madinaty 43.75k, usd 66.7k
    expect(await search({ sort: 'ppsqm_asc' })).toEqual([id.madinaty, id.cheap, id.mid, id.usd]);
  });

  it('returns names in both languages, EGP prices and the earlier price', async () => {
    const { items, total } = await searchListings(
      testDb.database.db,
      { q: 'mivida', unitTypes: ['Villa'] },
      { usdEgpRate: 50 },
    );
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({
      project: { en: 'Mivida' },
      priceCurrency: 'USD',
      minPrice: 40_000_000,
      minPriceEgp: 2_000_000_000,
      pricePerSqm: 66_667,
      sourceCount: 1,
    });
    const [mid] = (
      await searchListings(testDb.database.db, { priceDropped: true }, { usdEgpRate: 50 })
    ).items;
    expect(mid?.previousMinPrice).toBe(950_000_000);
  });

  it('pages through results and lists every match for exports', async () => {
    const page2 = await searchListings(
      testDb.database.db,
      {},
      { usdEgpRate: 50, page: 2, pageSize: 3 },
    );
    expect(page2.items).toHaveLength(1);
    expect(page2.total).toBe(4);
    expect(
      await matchingIds(testDb.database.db, { sort: 'price_asc' }, { usdEgpRate: 50, limit: 2 }),
    ).toEqual([id.cheap, id.madinaty]);
  });

  it('ignores text that is only punctuation', async () => {
    expect(await search({ q: '%' })).toHaveLength(4);
  });

  it('listing page: no sender, no group name, phone numbers and e-mails blanked', async () => {
    const detail = await listingDetail(testDb.database.db, id.mid ?? 0);
    const json = JSON.stringify(detail);
    expect(json).not.toContain('secret-sender-hash');
    expect(json).not.toContain('Secret Source Group');
    expect(json).not.toContain('01001234567');
    expect(json).not.toContain('broker@example.com');
    expect(json).not.toContain('333 4444');
    expect(detail?.sources[0]).toMatchObject({
      role: 'listing',
      postedIn: 'broker',
      media: { id: mediaId, kind: 'image' },
    });
    expect(detail?.prices.map((p) => p.minPrice)).toEqual([800_000_000, 950_000_000]);
    expect(detail?.unit).not.toHaveProperty('reviewReasons');
    expect(await listingDetail(testDb.database.db, id.withdrawn ?? 0)).toBeNull();
  });

  it('serves a file only when it belongs to a listing firms can see', async () => {
    expect(await visibleMedia(testDb.database.db, mediaId)).toMatchObject({ path: 'ab/x.jpg' });
    await testDb.database.db
      .update(units)
      .set({ status: 'withdrawn' })
      .where(eq(units.id, id.mid ?? 0));
    expect(await visibleMedia(testDb.database.db, mediaId)).toBeNull();
    await testDb.database.db
      .update(units)
      .set({ status: 'active' })
      .where(eq(units.id, id.mid ?? 0));
  });
});
