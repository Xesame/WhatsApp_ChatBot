/**
 * Scoring for the eval set: compares the units the pipeline produced with
 * the expected units of a case, field by field.
 *
 * Values are compared in their export form (names, whole EGP), so
 * expected.json is easy to write and read by hand.
 *
 * Payment plans are scored on their own (see PLAN_FIELDS): they are new, so
 * their accuracy is reported but does not block a prompt or model change.
 */

export type FieldValue = string | number | boolean | null;
/** One payment plan in export form (whole currency units). */
export type ComparablePlan = Record<string, FieldValue>;
/** A unit in export form; `paymentPlans` lists its plans in the order written. */
export interface ComparableUnit {
  [field: string]: FieldValue | ComparablePlan[] | undefined;
  paymentPlans?: ComparablePlan[];
}

/** Fields whose accuracy may not drop by more than 2 points without approval. */
export const KEY_FIELDS = [
  'minPrice',
  'maxPrice',
  'minArea',
  'maxArea',
  'city',
  'project',
  'developer',
  'unitType',
];

export const COMPARED_FIELDS = [
  'category',
  'developer',
  'project',
  'city',
  'unitType',
  'unitCode',
  'floor',
  'finishingSpecs',
  'minArea',
  'maxArea',
  'landArea',
  'gardenArea',
  'outdoorArea',
  'minPrice',
  'maxPrice',
  'priceCurrency',
  'deliveryYear',
  'readyToMove',
  'maintenance',
  'maintenanceCurrency',
  'cashDiscount',
  'cashDiscountType',
  'downPayment',
  'installmentsCount',
  'bedrooms',
  'bathrooms',
];

/**
 * Plan details compared for each plan, paired by position (first plan with
 * first plan). Kept out of KEY_FIELDS: plans don't count toward the
 * "may not drop by more than 2 points" rule until there are at least 20 real
 * reviewed cases with plans (spec, Part 1 "Review").
 */
export const PLAN_FIELDS = [
  'downPaymentPercent',
  'installmentAmount',
  'installmentFrequency',
  'installmentYears',
];

/** Equal, allowing tiny rounding differences in numbers. */
export function sameValue(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  const x = a ?? null;
  const y = b ?? null;
  if (typeof x === 'number' && typeof y === 'number')
    return Math.abs(x - y) <= Math.max(0.01, Math.abs(y) * 1e-6);
  if (typeof x === 'string' && typeof y === 'string')
    return x.trim().toLowerCase() === y.trim().toLowerCase();
  return x === y;
}

/** A unit's value for a plain field (never its plans list). */
function valueOf(unit: ComparableUnit, field: string): FieldValue {
  const value = unit[field];
  return Array.isArray(value) ? null : (value ?? null);
}

function similarity(expected: ComparableUnit, actual: ComparableUnit): number {
  return COMPARED_FIELDS.filter((f) => sameValue(valueOf(actual, f), valueOf(expected, f))).length;
}

/**
 * Pairs each expected unit with the most similar produced unit (greedy,
 * best pairs first). Unpaired expected units count as fully wrong.
 */
export function pairUnits(
  expected: ComparableUnit[],
  actual: ComparableUnit[],
): [ComparableUnit, ComparableUnit | null][] {
  const candidates: { e: number; a: number; score: number }[] = [];
  expected.forEach((e, ei) => {
    actual.forEach((a, ai) => {
      candidates.push({ e: ei, a: ai, score: similarity(e, a) });
    });
  });
  candidates.sort((x, y) => y.score - x.score);
  const usedE = new Set<number>();
  const usedA = new Set<number>();
  const pairs = new Map<number, number>();
  for (const c of candidates) {
    if (usedE.has(c.e) || usedA.has(c.a)) continue;
    usedE.add(c.e);
    usedA.add(c.a);
    pairs.set(c.e, c.a);
  }
  return expected.map((e, i) => {
    const a = pairs.get(i);
    return [e, a === undefined ? null : (actual[a] ?? null)];
  });
}

export interface FieldTally {
  correct: number;
  total: number;
}

export interface CaseScore {
  fields: Record<string, FieldTally>;
  /** Plan details (PLAN_FIELDS), over every expected plan. */
  plans: Record<string, FieldTally>;
  /** Expected units whose number of plans was right. */
  planCount: FieldTally;
  unitCountCorrect: boolean;
  intentCorrect: boolean;
  /** "field: expected X, got Y" lines, for the report. */
  mistakes: string[];
}

/**
 * Values assumed when expected.json leaves a field out: not ready to move,
 * priced in EGP. Every other field left out means "should be empty".
 */
export const EXPECTED_DEFAULTS: ComparableUnit = { readyToMove: false, priceCurrency: 'EGP' };

export function scoreCase(
  expected: { intent: string; units: ComparableUnit[] },
  actual: { intent: string; units: ComparableUnit[] },
): CaseScore {
  const fields: Record<string, FieldTally> = {};
  const plans: Record<string, FieldTally> = {};
  const planCount: FieldTally = { correct: 0, total: 0 };
  const mistakes: string[] = [];
  const withDefaults = expected.units.map((u) => ({ ...EXPECTED_DEFAULTS, ...u }));
  for (const [e, a] of pairUnits(withDefaults, actual.units)) {
    for (const field of COMPARED_FIELDS) {
      const tally = (fields[field] ??= { correct: 0, total: 0 });
      tally.total += 1;
      const want = valueOf(e, field);
      if (a && sameValue(valueOf(a, field), want)) tally.correct += 1;
      else {
        mistakes.push(
          a
            ? `${field}: expected ${JSON.stringify(want)}, got ${JSON.stringify(valueOf(a, field))}`
            : `${field}: unit missing (expected ${JSON.stringify(want)})`,
        );
      }
    }

    // Plans: left out of expected.json means "no plans".
    const wanted = e.paymentPlans ?? [];
    const got = a?.paymentPlans ?? [];
    const unitName = typeof e.unitType === 'string' ? e.unitType : 'unit';
    planCount.total += 1;
    if (a && wanted.length === got.length) planCount.correct += 1;
    wanted.forEach((plan, i) => {
      const produced = a ? got[i] : undefined;
      if (a && !produced) mistakes.push(`${unitName} plan ${i + 1}: missing`);
      for (const field of PLAN_FIELDS) {
        const tally = (plans[field] ??= { correct: 0, total: 0 });
        tally.total += 1;
        if (produced && sameValue(produced[field], plan[field])) tally.correct += 1;
        else if (produced) {
          mistakes.push(
            `${unitName} plan ${i + 1} ${field}: expected ${JSON.stringify(plan[field] ?? null)}, got ${JSON.stringify(produced[field] ?? null)}`,
          );
        }
      }
    });
    if (a && got.length > wanted.length)
      mistakes.push(`${unitName}: ${got.length - wanted.length} extra plan(s)`);
  }
  if (actual.units.length > expected.units.length) {
    mistakes.push(`${actual.units.length - expected.units.length} extra unit(s) produced`);
  }
  return {
    fields,
    plans,
    planCount,
    unitCountCorrect: expected.units.length === actual.units.length,
    intentCorrect: expected.intent === actual.intent,
    mistakes,
  };
}

/** Adds case scores together: the unit fields, or the plan details. */
export function sumScores(
  scores: CaseScore[],
  part: 'fields' | 'plans' = 'fields',
): Record<string, FieldTally> {
  const total: Record<string, FieldTally> = {};
  for (const score of scores) {
    for (const [field, tally] of Object.entries(score[part])) {
      const t = (total[field] ??= { correct: 0, total: 0 });
      t.correct += tally.correct;
      t.total += tally.total;
    }
  }
  return total;
}

export const percent = (t: FieldTally) =>
  t.total === 0 ? 100 : Math.round((1000 * t.correct) / t.total) / 10;
