import type { PaymentPlan } from '@reb/schema';

/**
 * The payment-plans table in Review, as plain text boxes. Pure helpers (no
 * screen code) so the number handling is tested. Amounts show in whole
 * pounds or dollars and are stored in piastres / cents, like the price fields.
 */

/** One table row as the person sees it: every box is text. */
export interface PlanRow {
  label: string;
  downPaymentPercent: string;
  downPaymentAmount: string;
  installmentAmount: string;
  installmentFrequency: string;
  installmentYears: string;
  planPrice: string;
  cash: boolean;
  notes: string;
  /** Not shown in the table: kept so editing a plan never loses it. */
  installmentsCount: number | null;
  currency: PaymentPlan['currency'];
}

const text = (value: string | number | null) => (value === null ? '' : String(value));
const pounds = (minor: number | null) => (minor === null ? '' : String(minor / 100));

export function planToRow(plan: PaymentPlan): PlanRow {
  return {
    label: text(plan.label),
    downPaymentPercent: text(plan.downPaymentPercent),
    downPaymentAmount: pounds(plan.downPaymentAmount),
    installmentAmount: pounds(plan.installmentAmount),
    installmentFrequency: text(plan.installmentFrequency),
    installmentYears: text(plan.installmentYears),
    planPrice: pounds(plan.planPrice),
    cash: plan.cash,
    notes: text(plan.notes),
    installmentsCount: plan.installmentsCount,
    currency: plan.currency,
  };
}

/**
 * Applies an edit to a row. The number of installments is not shown, so when
 * the frequency or the years change it would be stale: it is dropped.
 */
export function editRow(row: PlanRow, patch: Partial<PlanRow>): PlanRow {
  const timing = 'installmentFrequency' in patch || 'installmentYears' in patch;
  return { ...row, ...patch, ...(timing ? { installmentsCount: null } : {}) };
}

/** A new empty row, in the unit's currency. */
export const emptyRow = (currency: PaymentPlan['currency']): PlanRow =>
  planToRow({
    position: 0,
    label: null,
    downPaymentPercent: null,
    downPaymentAmount: null,
    installmentAmount: null,
    installmentFrequency: null,
    installmentsCount: null,
    installmentYears: null,
    planPrice: null,
    cash: false,
    notes: null,
    currency,
  });

function number(name: string, box: string): number | null {
  const t = box.trim();
  if (t === '') return null;
  const n = Number(t.replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new Error(`Plan ${name}: "${box}" is not a number`);
  return n;
}

/** Rows → plans to send. Throws a plain sentence when a box is not a number. */
export function rowsToPlans(rows: readonly PlanRow[]): PaymentPlan[] {
  return rows.map((row, position) => {
    const name = String(position + 1);
    const amount = (box: string) => {
      const n = number(name, box);
      return n === null ? null : Math.round(n * 100);
    };
    const label = row.label.trim();
    const notes = row.notes.trim();
    return {
      position,
      label: label === '' ? null : label,
      downPaymentPercent: number(name, row.downPaymentPercent),
      downPaymentAmount: amount(row.downPaymentAmount),
      installmentAmount: amount(row.installmentAmount),
      installmentFrequency: (row.installmentFrequency ||
        null) as PaymentPlan['installmentFrequency'],
      installmentsCount: row.installmentsCount,
      installmentYears: number(name, row.installmentYears),
      planPrice: amount(row.planPrice),
      cash: row.cash,
      notes: notes === '' ? null : notes,
      currency: row.currency,
    };
  });
}

/** True when the table differs from what was loaded. */
export function plansChanged(initial: readonly PlanRow[], rows: readonly PlanRow[]): boolean {
  return JSON.stringify(initial) !== JSON.stringify(rows);
}
