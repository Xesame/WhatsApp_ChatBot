import { unitPaymentPlans, type Db } from '@reb/db';
import type { PaymentPlan } from '@reb/schema';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

/**
 * Payment plans of a unit. Every message that states plans keeps its own rows
 * (like price history), and a unit's current plans are simply the rows of its
 * newest source: the newest message by sent time that stated plans, or
 * Hassan's Review correction when that is newer ("newest post wins", Hassan,
 * 21 Nov). Nothing is marked "current", so retracting or reprocessing a
 * message, or processing a group out of date order, always ends with the
 * right plans.
 */

/** The review reason when a price changes but the message states no plans. */
export const PLANS_CHECK_REASON = 'Price changed; check the payment plans';

type PlanRow = typeof unitPaymentPlans.$inferSelect;

const toPlan = (row: PlanRow): PaymentPlan => ({
  position: row.position,
  label: row.label,
  downPaymentPercent: row.downPaymentPercent,
  downPaymentAmount: row.downPaymentAmount,
  installmentAmount: row.installmentAmount,
  installmentFrequency: row.installmentFrequency,
  installmentsCount: row.installmentsCount,
  installmentYears: row.installmentYears,
  planPrice: row.planPrice,
  cash: row.cash,
  notes: row.notes,
  currency: row.currency,
});

/** The unit's current plans (its newest source's rows), in the order written. */
export async function currentPlans(db: Db, unitId: number): Promise<PaymentPlan[]> {
  return (await currentPlansFor(db, [unitId])).get(unitId) ?? [];
}

/**
 * The current plans of many units at once (the Excel export reads thousands):
 * one query per 5,000 units instead of two per unit. Same rule as
 * `currentPlans`: per unit, the rows of its newest source, and none when that
 * source is a Review "no plans" marker. Units with no current plans are left
 * out of the map.
 */
export async function currentPlansFor(
  db: Db,
  unitIds: readonly number[],
): Promise<Map<number, PaymentPlan[]>> {
  const found = new Map<number, PaymentPlan[]>();
  // Postgres takes at most 65,535 values per query, so long lists go in parts.
  for (let start = 0; start < unitIds.length; start += 5000) {
    const part = unitIds.slice(start, start + 5000);
    // Each unit's newest row (newest time, then newest id) names its newest source.
    const newest = db
      .selectDistinctOn([unitPaymentPlans.unitId], {
        unitId: sql<number>`${unitPaymentPlans.unitId}`.as('newest_unit_id'),
        observedAt: sql<Date>`${unitPaymentPlans.observedAt}`.as('newest_observed_at'),
        messageId: sql<number | null>`${unitPaymentPlans.sourceMessageId}`.as('newest_message_id'),
      })
      .from(unitPaymentPlans)
      .where(inArray(unitPaymentPlans.unitId, part))
      .orderBy(
        unitPaymentPlans.unitId,
        desc(unitPaymentPlans.observedAt),
        desc(unitPaymentPlans.id),
      )
      .as('newest');
    // Rows of one source share both its message (empty for Review) and its time.
    const rows = await db
      .select({ row: unitPaymentPlans })
      .from(unitPaymentPlans)
      .innerJoin(
        newest,
        and(
          eq(unitPaymentPlans.unitId, newest.unitId),
          eq(unitPaymentPlans.observedAt, newest.observedAt),
          sql`${unitPaymentPlans.sourceMessageId} is not distinct from ${newest.messageId}`,
        ),
      )
      .orderBy(
        asc(unitPaymentPlans.unitId),
        asc(unitPaymentPlans.position),
        asc(unitPaymentPlans.id),
      );
    const byUnit = new Map<number, PlanRow[]>();
    for (const { row } of rows) {
      const list = byUnit.get(row.unitId) ?? [];
      list.push(row);
      byUnit.set(row.unitId, list);
    }
    for (const [unitId, unitRows] of byUnit) {
      // A "no plans" marker from Review: the unit has none until a newer message states some.
      if (unitRows.some((row) => row.cleared)) continue;
      found.set(unitId, unitRows.map(toPlan));
    }
  }
  return found;
}

/**
 * Stores the plans a message states for a unit. A message without plans
 * writes nothing, so the unit keeps the plans it had. The message's earlier
 * rows for this unit are replaced, so applying it twice never duplicates.
 */
export async function writePlans(
  tx: Db,
  unitId: number,
  plans: readonly PaymentPlan[] | undefined,
  message: { id: number; sentAt: Date },
): Promise<void> {
  if (!plans || plans.length === 0) return;
  await tx
    .delete(unitPaymentPlans)
    .where(
      and(eq(unitPaymentPlans.unitId, unitId), eq(unitPaymentPlans.sourceMessageId, message.id)),
    );
  await tx.insert(unitPaymentPlans).values(
    plans.map((plan) => ({
      ...plan,
      unitId,
      sourceMessageId: message.id,
      source: 'message' as const,
      observedAt: message.sentAt,
    })),
  );
}

/** True when a price change could make the plans' own amounts out of date. */
export function plansHaveAmounts(plans: readonly PaymentPlan[]): boolean {
  return plans.some((plan) => plan.installmentAmount !== null || plan.planPrice !== null);
}
