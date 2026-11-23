import { z } from 'zod';
import { CATEGORIES, FINISHING_SPECS, UNIT_TYPES } from './enums.ts';

/**
 * What the LLM returns when it reads a message.
 *
 * The model only copies what the message says. Numbers stay as the raw
 * phrase ("3.5 مليون", "120-180 م", "8 سنين ربع سنوي"); code in
 * @reb/normalize turns them into numbers. The model never does arithmetic,
 * converts currencies or scores confidence (build plan, rule 4).
 *
 * Every field is required but nullable: the model must say `null` for
 * anything the message doesn't state, never guess. Strict structured output
 * (Cerebras, OpenAI) needs all fields listed and no extra ones, which
 * `z.strictObject` gives us.
 */

const raw = (description: string) => z.string().nullable().describe(description);

/**
 * One payment plan as the message wrote it. Plans differ by down payment and
 * installment, so a unit may have several. Every field is a copied phrase;
 * code in @reb/normalize turns them into numbers.
 */
export const rawPaymentPlanSchema = z.strictObject({
  label: raw('Plan name as written, e.g. "Plan 2", "خطة 10%", "Cash"'),
  down_payment: raw('Down payment phrase as written, e.g. "10%", "DP: 395,200 L.E"'),
  installment_amount: raw(
    'Installment amount phrase as written, with its frequency word, e.g. "Quarterly: 104,612 L.E", "القسط الربع سنوي 104,612 ج"',
  ),
  installments: raw(
    'Installment duration phrase as written, e.g. "Rest over 10 Years", "على 8 سنين ربع سنوي"',
  ),
  plan_price: raw(
    'A total that applies only to this plan, as written, e.g. "Total after discount: 6,968,250"',
  ),
  cash_discount: raw('Cash discount phrase of this plan as written, e.g. "خصم 15% كاش"'),
  notes: raw('Short English note about this plan, e.g. "Equal installments"'),
});

export const rawUnitSchema = z.strictObject({
  category: z.enum(CATEGORIES).nullable().describe('Only if clear from the unit type or text'),
  developer: raw('Developer name exactly as written'),
  project: raw('Project / compound name exactly as written'),
  city: raw('City or area exactly as written'),
  unit_type: z.enum(UNIT_TYPES).nullable(),
  unit_code: raw('Specific unit code/number, only if the message names one unit'),
  floor: raw(
    'Floor phrase as written, e.g. "أرضي", "الدور الثالث", "1-5", "First Floor"; copied from the floor heading above the unit when there is one',
  ),
  building: raw(
    'Building or block label as written, e.g. "V-02", "Building B", "عمارة 5"; copied from the building heading above the unit when there is one',
  ),
  finishing: z.enum(FINISHING_SPECS).nullable(),
  bedrooms: raw('Bedrooms phrase as written, e.g. "3 غرف", "3BR"'),
  bathrooms: raw('Bathrooms phrase as written'),
  area: raw('Built-up area phrase as written, e.g. "120-180 م", "من 150 متر"'),
  land_area: raw('Land area phrase as written'),
  garden_area: raw('Garden area phrase as written'),
  outdoor_area: raw('Terrace / roof area phrase as written'),
  price: raw('Price phrase as written, including currency words, e.g. "يبدأ من 6.5 مليون"'),
  delivery: raw('Delivery phrase as written, e.g. "Q3 2027", "استلام فوري"'),
  maintenance: raw('Maintenance phrase as written, e.g. "8%", "200 ألف"'),
  down_payment: raw('Down payment phrase as written, e.g. "10%", "مقدم 500 ألف"'),
  installments: raw('Installment plan phrase as written, e.g. "على 8 سنين ربع سنوي"'),
  cash_discount: raw('Cash discount phrase as written, e.g. "خصم 15% كاش"'),
  payment_plans: z
    .array(rawPaymentPlanSchema)
    .describe(
      'Every payment plan the message offers for this unit, in the order written; empty when none',
    ),
  notes: raw(
    'Short English note for useful facts with no field (view, club, phase, offer deadline). Never repeat other fields.',
  ),
  evidence: z
    .strictObject({
      project: raw('Exact quote from the message supporting project'),
      unit_type: raw('Exact quote supporting unit_type'),
      area: raw('Exact quote supporting area'),
      price: raw('Exact quote supporting price'),
    })
    .describe('Exact words copied from the message for the key fields, or null'),
});

export const extractionResultSchema = z.strictObject({
  units: z
    .array(rawUnitSchema)
    .describe(
      'One entry per unit type or named unit offered, or per priced line in a list of units',
    ),
});

export const classificationSchema = z.strictObject({
  intent: z
    .enum(['listing', 'price_update', 'sold', 'not_relevant'])
    .describe(
      'listing: offers property for sale; price_update: changes the price of an earlier offer; sold: says something is sold/no longer available; not_relevant: anything else',
    ),
});

/**
 * The model's answer after a web search for a project name (the name
 * lookups). Only names go in and out. `known: false` with two nulls means
 * "the search did not clearly say".
 */
export const lookupResultSchema = z.strictObject({
  known: z.boolean().describe('true only if the search results clearly show this project exists'),
  developer: z.string().nullable().describe('Developer that builds it, or null if not clear'),
  city: z.string().nullable().describe('City or area it is in, or null if not clear'),
});

export type RawPaymentPlan = z.infer<typeof rawPaymentPlanSchema>;
export type RawUnit = z.infer<typeof rawUnitSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export type Classification = z.infer<typeof classificationSchema>;
export type LookupResult = z.infer<typeof lookupResultSchema>;

/** JSON Schema sent to the model; generated, never written by hand (build plan, section 7). */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}
