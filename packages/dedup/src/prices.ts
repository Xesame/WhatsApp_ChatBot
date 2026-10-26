import type { Unit } from '@reb/schema';

/**
 * The price and payment terms of a unit at one moment: one row of
 * `unit_prices`. A new row is written only when something here changes.
 */
export const PRICE_FIELDS = [
  'minPrice',
  'maxPrice',
  'priceCurrency',
  'downPayment',
  'downPaymentAmount',
  'installmentsCount',
  'installmentYears',
  'installmentFrequency',
  'cashDiscount',
  'cashDiscountType',
  'cashDiscountCurrency',
] as const satisfies readonly (keyof Unit)[];

export type PriceSnapshot = Pick<Unit, (typeof PRICE_FIELDS)[number]>;

export function snapshotOf(unit: PriceSnapshot): PriceSnapshot {
  return Object.fromEntries(PRICE_FIELDS.map((f) => [f, unit[f]])) as PriceSnapshot;
}

/**
 * The terms after an observation: what the new message states replaces the
 * current value; what it doesn't mention is kept. A price update saying
 * only "now 7 million" keeps the payment plan.
 */
export function applyObservation(
  current: PriceSnapshot,
  observed: Partial<PriceSnapshot>,
): PriceSnapshot {
  const next = { ...current };
  const statesPrice = observed.minPrice != null || observed.maxPrice != null;
  for (const field of PRICE_FIELDS) {
    const value = observed[field];
    // A new price range replaces both ends: "starting from 7M" clears an old
    // max of 9M. Other fields only change when stated.
    if (
      statesPrice &&
      (field === 'minPrice' || field === 'maxPrice' || field === 'priceCurrency')
    ) {
      (next as Record<string, unknown>)[field] =
        value ?? (field === 'priceCurrency' ? current.priceCurrency : null);
    } else if (value !== null && value !== undefined) {
      (next as Record<string, unknown>)[field] = value;
    }
  }
  return next;
}

/** True when two snapshots differ in any field. */
export function priceChanged(a: PriceSnapshot, b: PriceSnapshot): boolean {
  return PRICE_FIELDS.some((f) => (a[f] ?? null) !== (b[f] ?? null));
}
