import type { PaymentPlan } from './unit.ts';

/**
 * True when a plan says nothing (a "+ Add plan" row left blank): no label,
 * no numbers, not cash, no notes. Its currency alone is not information.
 * Kept free of zod so the web app can use it without loading the schemas.
 */
export function isEmptyPlan(plan: Omit<PaymentPlan, 'position'>): boolean {
  return (
    !plan.cash &&
    !plan.label?.trim() &&
    !plan.notes?.trim() &&
    plan.downPaymentPercent === null &&
    plan.downPaymentAmount === null &&
    plan.installmentAmount === null &&
    plan.installmentFrequency === null &&
    plan.installmentsCount === null &&
    plan.installmentYears === null &&
    plan.planPrice === null
  );
}
