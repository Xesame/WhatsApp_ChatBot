import { projects, reviewCorrections, units } from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { seed } from '@reb/db/seed-runner';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MIN_APPROVED_FOR_RANGE, usualPricePerM2 } from '../src/index.ts';

describe.skipIf(!testDatabaseUrl)('usual price per m2 (real Postgres)', () => {
  let testDb: TestDatabase;
  let projectId: number;

  /** A 100 m2 unit at `perMetre` EGP per m2, optionally approved. */
  const add = async (
    perMetre: number,
    approved: boolean,
    unitType = 'Apartment',
    priceCurrency: 'EGP' | 'USD' = 'EGP',
  ) => {
    const [row] = await testDb.database.db
      .insert(units)
      .values({
        projectId,
        unitType: unitType as 'Apartment',
        priceCurrency,
        minArea: 100,
        maxArea: 100,
        minPrice: perMetre * 100 * 100,
        maxPrice: perMetre * 100 * 100,
        confidence: 1,
        needsReview: false,
        reviewReasons: [],
        firstSeenAt: new Date('2026-11-01T10:00:00Z'),
        lastSeenAt: new Date('2026-11-01T10:00:00Z'),
      })
      .returning({ id: units.id });
    if (!row) throw new Error('insert failed');
    if (approved) {
      await testDb.database.db
        .insert(reviewCorrections)
        .values({ unitId: row.id, action: 'approve' });
    }
  };

  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
    await seed(testDb.database.db);
    const [p] = await testDb.database.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.nameEn, 'Mivida'));
    if (!p) throw new Error('seed missing');
    projectId = p.id;
  });
  afterAll(async () => {
    await testDb.drop();
  });
  beforeEach(async () => {
    await testDb.database.pool.query(
      'truncate review_corrections, unit_prices, unit_sources, units restart identity cascade',
    );
  });

  it('needs three approved units', async () => {
    expect(MIN_APPROVED_FOR_RANGE).toBe(3);
    await add(40_000, true);
    await add(41_000, true);
    await add(5_000, false); // not approved: ignored
    expect(await usualPricePerM2(testDb.database.db, projectId, 'Apartment')).toBeNull();
    await add(45_000, true);
    expect(await usualPricePerM2(testDb.database.db, projectId, 'Apartment')).toEqual({
      median: 41_000,
      count: 3,
    });
  });

  it('only counts units of the same type', async () => {
    await add(40_000, true, 'Villa');
    await add(41_000, true, 'Villa');
    await add(45_000, true, 'Villa');
    expect(await usualPricePerM2(testDb.database.db, projectId, 'Apartment')).toBeNull();
  });

  it('ignores approved USD units', async () => {
    await add(40_000, true);
    await add(41_000, true);
    await add(1_000_000, true, 'Apartment', 'USD');
    expect(await usualPricePerM2(testDb.database.db, projectId, 'Apartment')).toBeNull();
    await add(45_000, true);
    expect(await usualPricePerM2(testDb.database.db, projectId, 'Apartment')).toEqual({
      median: 41_000,
      count: 3,
    });
  });
});
