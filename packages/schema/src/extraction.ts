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

export const rawUnitSchema = z.strictObject({
  category: z.enum(CATEGORIES).nullable().describe('Only if clear from the unit type or text'),
  developer: raw('Developer name exactly as written'),
  project: raw('Project / compound name exactly as written'),
  city: raw('City or area exactly as written'),
  unit_type: z.enum(UNIT_TYPES).nullable(),
  unit_code: raw('Specific unit code/number, only if the message names one unit'),
  floor: raw('Floor phrase as written, e.g. "أرضي", "الدور الثالث", "1-5"'),
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
  units: z.array(rawUnitSchema).describe('One entry per unit type or named unit offered'),
});

export const classificationSchema = z.strictObject({
  intent: z
    .enum(['listing', 'price_update', 'sold', 'not_relevant'])
    .describe(
      'listing: offers property for sale; price_update: changes the price of an earlier offer; sold: says something is sold/no longer available; not_relevant: anything else',
    ),
});

export type RawUnit = z.infer<typeof rawUnitSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
export type Classification = z.infer<typeof classificationSchema>;

/** JSON Schema sent to the model; generated, never written by hand (build plan, section 7). */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}
