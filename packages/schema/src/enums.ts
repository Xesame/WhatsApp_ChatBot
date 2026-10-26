/**
 * Every fixed list of values used by listings. Decided with Hassan on
 * 2026-10-25 (PROJECT.md, chapter 4). Change them here only: the database
 * checks, the LLM schema, the export and the UI all read from this file.
 */
export const CATEGORIES = ['Residential', 'Commercial', 'Administrative', 'Medical'] as const;

export const UNIT_TYPES = [
  'Apartment',
  'Studio',
  'Duplex',
  'Penthouse',
  'Townhouse',
  'Twin House',
  'Villa',
  'Chalet',
  'Office',
  'Retail',
  'Clinic',
] as const;

export const FINISHING_SPECS = [
  'Core & Shell',
  'Semi-finished',
  'Fully finished',
  'Furnished',
] as const;

/** Currencies a price can be stated in. EGP is the main (export) currency. */
export const CURRENCIES = ['EGP', 'USD'] as const;
export const MAINTENANCE_CURRENCIES = ['EGP', 'USD', '%'] as const;
export const CASH_DISCOUNT_TYPES = ['Percentage', 'Fixed amount'] as const;

/** How often installments are paid, and how many payments that is per year. */
export const INSTALLMENT_FREQUENCIES = ['monthly', 'quarterly', 'semi-annual', 'annual'] as const;
export const PAYMENTS_PER_YEAR: Record<InstallmentFrequency, number> = {
  monthly: 12,
  quarterly: 4,
  'semi-annual': 2,
  annual: 1,
};

/** What a message is about (classification). */
export const MESSAGE_INTENTS = ['listing', 'price_update', 'sold', 'not_relevant'] as const;

export const UNIT_STATUSES = ['active', 'stale', 'sold', 'withdrawn'] as const;

export type Category = (typeof CATEGORIES)[number];
export type UnitType = (typeof UNIT_TYPES)[number];
export type FinishingSpec = (typeof FINISHING_SPECS)[number];
export type Currency = (typeof CURRENCIES)[number];
export type MaintenanceCurrency = (typeof MAINTENANCE_CURRENCIES)[number];
export type CashDiscountType = (typeof CASH_DISCOUNT_TYPES)[number];
export type InstallmentFrequency = (typeof INSTALLMENT_FREQUENCIES)[number];
export type MessageIntent = (typeof MESSAGE_INTENTS)[number];
export type UnitStatus = (typeof UNIT_STATUSES)[number];
