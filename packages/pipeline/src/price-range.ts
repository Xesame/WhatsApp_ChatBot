import { reviewCorrections, units, type Db } from '@reb/db';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

/**
 * Learning what a project's units usually cost per m².
 *
 * Every unit Hassan approved in Review is a price he vouched for. Once three
 * units of the same project and type are approved, their median price per m²
 * becomes the "usual" price: a new unit far from it (more than 2.5 times
 * above or below, see `PRICE_RANGE_FACTOR` in @reb/normalize) is held for
 * review. Below three approvals we know too little, so the fixed range is
 * used instead. The arithmetic is plain SQL and code, never the model
 * (rule 4).
 */
export const MIN_APPROVED_FOR_RANGE = 3;

/** Prices are stored in piastres; area in m². The result is EGP per m². */
export async function usualPricePerM2(
  db: Db,
  projectId: number,
  unitType: string,
): Promise<{ median: number; count: number } | null> {
  const perMetre = sql<number>`${units.minPrice}::float8 / 100 / ${units.minArea}::float8`;
  const [row] = await db
    .select({
      median: sql<number | null>`percentile_cont(0.5) within group (order by ${perMetre})`,
      count: sql<number>`count(*)::int`,
    })
    .from(units)
    .where(
      and(
        eq(units.projectId, projectId),
        sql`${units.unitType} = ${unitType}`,
        isNotNull(units.minPrice),
        eq(units.priceCurrency, 'EGP'),
        sql`${units.minArea} > 0`,
        sql`exists (select 1 from ${reviewCorrections} where ${reviewCorrections.unitId} = ${units.id} and ${reviewCorrections.action} = 'approve')`,
      ),
    );
  if (!row || row.median === null || row.count < MIN_APPROVED_FOR_RANGE) return null;
  return { median: row.median, count: row.count };
}
