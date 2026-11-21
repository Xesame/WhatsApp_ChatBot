import { PAYMENTS_PER_YEAR, type PaymentPlan, type RawPaymentPlan } from '@reb/schema';
import { detectCurrency, parseInstallments } from './fields.ts';
import { parseAmounts, parsePercentOrAmount } from './numbers.ts';
import { appearsIn } from './unit.ts';

/**
 * Payment plans: a unit can offer several (0% down, 10% down, ...). The model
 * only copies each plan's phrases; everything below turns them into numbers
 * in code (build plan, rule 4). Money is in minor units (piastres).
 */

export interface PlanContext {
  /** The text the model read, for the no-invention check. */
  sourceText: string;
  /** The currency to assume when a plan's phrases name none. */
  unitCurrency: 'EGP' | 'USD';
}

/** The phrases a plan copies from the message (all checked against the message). */
const PLAN_PHRASES = [
  'label',
  'down_payment',
  'installment_amount',
  'installments',
  'plan_price',
  'cash_discount',
] as const satisfies readonly (keyof RawPaymentPlan)[];

const toMinor = (major: number | null) => (major === null ? null : Math.round(major * 100));

const PERCENT_TOKEN = /\d+(?:[.,]\d+)?\s*(%|٪|في\s*الم[يئ]ة|في\s*المي[هة]|بالم[يئ]ة|percent|pct)/gi;

/**
 * Numbers that are a length or a count, not money: "على 8 سنين", "12 قسط",
 * "over 10 years", "36 months". They are removed before an amount is read,
 * so "مقدم 10% على 8 سنين" has no down payment amount (not 8 EGP).
 */
const DURATION_TOKEN =
  /\d+(?:[.,]\d+)?\s*(years?|yrs?|سنين|سنوات|سنة|سنه|سنتين|عام|أعوام|اعوام|months?|شهور|شهر|أشهر|اشهر|installments?|أقساط|اقساط|قسط)/gi;

/**
 * First amount in a phrase, ignoring any percent and any length or count in
 * it ("10% DP DP: 395,200" → 395,200). A small bare number ("Monthly 850")
 * is more likely a slip than money, so an amount under 1,000 counts only
 * when the phrase names a currency.
 */
function firstAmount(text: string | null): number | null {
  if (!text) return null;
  const ascii = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const cleaned = ascii.replace(PERCENT_TOKEN, ' ').replace(DURATION_TOKEN, ' ');
  const namesCurrency = EGP_WORDS.test(cleaned) || detectCurrency(cleaned) === 'USD';
  const amount = parseAmounts(cleaned).find((a) => a.value >= 1000 || namesCurrency);
  return amount?.value ?? null;
}

const EGP_WORDS = /(egp|l\.?\s?e\b|جنيه|جنية|ج\.?م|(^|\s)ج(\s|$))/i;

function currencyOf(phrases: (string | null)[], fallback: 'EGP' | 'USD'): 'EGP' | 'USD' {
  const text = phrases.filter((p): p is string => p !== null).join(' ');
  if (detectCurrency(text) === 'USD') return 'USD';
  return EGP_WORDS.test(text) ? 'EGP' : fallback;
}

/**
 * Normalizes the plans of one unit. Returns the plans, the reasons for review
 * (phrases dropped because the message does not contain them), and the
 * checked raw plans (aligned with `plans`) so the caller can read the cash
 * discount of a plan.
 */
export function normalizePlans(
  rawPlans: RawPaymentPlan[],
  ctx: PlanContext,
): { plans: PaymentPlan[]; reasons: string[]; checked: RawPaymentPlan[] } {
  const reasons: string[] = [];
  const plans: PaymentPlan[] = [];
  const checked: RawPaymentPlan[] = [];

  for (const input of rawPlans) {
    const raw: RawPaymentPlan = { ...input };
    // No invention: a phrase the message doesn't contain is dropped.
    for (const field of PLAN_PHRASES) {
      const value = raw[field];
      if (value !== null && !appearsIn(value, ctx.sourceText)) {
        reasons.push(`Dropped ${field} "${value}": not found in the message`);
        raw[field] = null;
      }
    }
    // A plan with nothing left in it carries no information.
    if (Object.values(raw).every((v) => v === null)) continue;

    const down = parsePercentOrAmount(raw.down_payment);
    // Read the same way with or without a percent, so a length ("على 8 سنين")
    // never becomes the amount.
    const downAmount = firstAmount(raw.down_payment);
    const installment = parseInstallments(raw.installments);
    const frequency = installment.frequency ?? parseInstallments(raw.installment_amount).frequency;
    const years = installment.years;
    const count =
      installment.count ??
      (years !== null && frequency ? Math.round(years * PAYMENTS_PER_YEAR[frequency]) : null);
    const installmentAmount = toMinor(firstAmount(raw.installment_amount));
    const discount = parsePercentOrAmount(raw.cash_discount);
    const hasDiscount = discount.percent !== null || discount.amount !== null;
    const cashLabel = raw.label !== null && /(cash|كاش|نقد)/i.test(raw.label);
    const noInstallment = installmentAmount === null && count === null && years === null;

    plans.push({
      position: plans.length,
      label: raw.label?.trim() || null,
      downPaymentPercent:
        down.percent !== null && down.percent >= 0 && down.percent <= 100 ? down.percent : null,
      downPaymentAmount: toMinor(downAmount),
      installmentAmount,
      installmentFrequency: frequency,
      installmentsCount: count !== null && count > 0 ? count : null,
      // A plan "over 0 years" has no length; the column needs a positive number.
      installmentYears: years !== null && years > 0 && years <= 30 ? years : null,
      planPrice: toMinor(firstAmount(raw.plan_price)),
      cash: noInstallment && (hasDiscount || cashLabel),
      notes: raw.notes?.trim().slice(0, 300) || null,
      currency: currencyOf(
        [raw.down_payment, raw.installment_amount, raw.plan_price],
        ctx.unitCurrency,
      ),
    });
    checked.push(raw);
  }
  return { plans, reasons, checked };
}

/** What the plan costs per month, in minor units; null without an amount or frequency. */
export function monthlyEquivalent(plan: PaymentPlan): number | null {
  if (plan.installmentAmount === null || plan.installmentFrequency === null) return null;
  return Math.round((plan.installmentAmount * PAYMENTS_PER_YEAR[plan.installmentFrequency]) / 12);
}
