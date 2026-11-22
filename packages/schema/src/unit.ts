import { z } from 'zod';
import {
  CASH_DISCOUNT_TYPES,
  CATEGORIES,
  CURRENCIES,
  FINISHING_SPECS,
  INSTALLMENT_FREQUENCIES,
  MAINTENANCE_CURRENCIES,
  UNIT_TYPES,
} from './enums.ts';

/**
 * A unit after normalization: the shape stored in the `units` table and
 * used everywhere after extraction. This is the single definition of the
 * listing fields (build plan, rule 1).
 *
 * Money is in **minor units** (piastres / cents) as integers, with the
 * currency alongside, so no rounding errors creep in. `minPrice: 650000000`
 * with `priceCurrency: 'EGP'` means EGP 6,500,000.
 */
const money = z.number().int().nonnegative();
const area = z.number().positive();

/**
 * One payment plan of a unit (a unit can offer several: 0% down, 10% down...).
 * Money in minor units, with the currency alongside.
 */
export const paymentPlanSchema = z.object({
  /** Order in the message; the first plan feeds the unit's own columns. */
  position: z.number().int().min(0),
  label: z.string().nullable(),
  downPaymentPercent: z.number().min(0).max(100).nullable(),
  downPaymentAmount: money.nullable(),
  installmentAmount: money.nullable(),
  installmentFrequency: z.enum(INSTALLMENT_FREQUENCIES).nullable(),
  installmentsCount: z.number().int().positive().nullable(),
  installmentYears: z.number().positive().max(30).nullable(),
  /** A total that applies only to this plan; null when it is the unit's price. */
  planPrice: money.nullable(),
  /** A pay-in-full option (no installments). */
  cash: z.boolean(),
  notes: z.string().max(300).nullable(),
  currency: z.enum(['EGP', 'USD']),
});

/** What Review may send for a unit's plans: at most 12, each a valid plan. */
export const editablePlansSchema = z.array(paymentPlanSchema).max(12);

export const unitSchema = z.object({
  // --- Template columns (in template order; see columns.ts) ---
  category: z.enum(CATEGORIES).nullable(),
  developerId: z.number().int().nullable(),
  projectId: z.number().int().nullable(),
  cityId: z.number().int().nullable(),
  unitType: z.enum(UNIT_TYPES).nullable(),
  unitCode: z.string().nullable(),
  floor: z.string().nullable(),
  finishingSpecs: z.enum(FINISHING_SPECS).nullable(),
  minArea: area.nullable(),
  maxArea: area.nullable(),
  landArea: area.nullable(),
  gardenArea: area.nullable(),
  outdoorArea: area.nullable(),
  minPrice: money.nullable(),
  maxPrice: money.nullable(),
  deliveryYear: z.number().int().min(2000).max(2100).nullable(),
  maintenance: z.number().nonnegative().nullable(),
  maintenanceCurrency: z.enum(MAINTENANCE_CURRENCIES).nullable(),
  cashDiscount: z.number().nonnegative().nullable(),
  cashDiscountCurrency: z.enum(CURRENCIES).nullable(),
  cashDiscountType: z.enum(CASH_DISCOUNT_TYPES).nullable(),
  /** Percent 0-100. */
  downPayment: z.number().min(0).max(100).nullable(),
  installmentsCount: z.number().int().positive().nullable(),
  bedrooms: z.number().int().min(0).max(20).nullable(),
  bathrooms: z.number().int().min(0).max(20).nullable(),
  notes: z.string().nullable(),

  // --- Internal columns (never exported) ---
  priceCurrency: z.enum(CURRENCIES),
  /** Down payment as an amount (minor units, in priceCurrency), when stated. */
  downPaymentAmount: money.nullable(),
  installmentYears: z.number().positive().max(30).nullable(),
  installmentFrequency: z.enum(INSTALLMENT_FREQUENCIES).nullable(),
  /** Every payment plan the message offered, in order. */
  paymentPlans: z.array(paymentPlanSchema),
  readyToMove: z.boolean(),
  /** 0 to 1, computed in code. */
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
  /** Why the unit needs review, in plain English. */
  reviewReasons: z.array(z.string()),
  /** Raw names that did not match a known entity, kept for review. */
  extras: z.record(z.string(), z.unknown()),
});

export type PaymentPlan = z.infer<typeof paymentPlanSchema>;
export type Unit = z.infer<typeof unitSchema>;
