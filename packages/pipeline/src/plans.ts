import { unitPaymentPlans, type Db } from '@reb/db';
import type { PaymentPlan } from '@reb/schema';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

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
  const [newest] = await db
    .select({
      sourceMessageId: unitPaymentPlans.sourceMessageId,
      observedAt: unitPaymentPlans.observedAt,
    })
    .from(unitPaymentPlans)
    .where(eq(unitPaymentPlans.unitId, unitId))
    .orderBy(desc(unitPaymentPlans.observedAt), desc(unitPaymentPlans.id))
    .limit(1);
  if (!newest) return [];
  // Rows of one source share both its message (empty for Review) and its time.
  const rows = await db
    .select()
    .from(unitPaymentPlans)
    .where(
      and(
        eq(unitPaymentPlans.unitId, unitId),
        eq(unitPaymentPlans.observedAt, newest.observedAt),
        sql`${unitPaymentPlans.sourceMessageId} is not distinct from ${newest.sourceMessageId}`,
      ),
    )
    .orderBy(asc(unitPaymentPlans.position), asc(unitPaymentPlans.id));
  return rows.map(toPlan);
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
