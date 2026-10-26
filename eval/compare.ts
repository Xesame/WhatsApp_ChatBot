/**
 * Scoring for the eval set: compares the units the pipeline produced with
 * the expected units of a case, field by field.
 *
 * Values are compared in their export form (names, whole EGP), so
 * expected.json is easy to write and read by hand.
 */

export type FieldValue = string | number | boolean | null;
export type ComparableUnit = Record<string, FieldValue>;

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

function similarity(expected: ComparableUnit, actual: ComparableUnit): number {
  return COMPARED_FIELDS.filter((f) => sameValue(actual[f], expected[f])).length;
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
  unitCountCorrect: boolean;
  intentCorrect: boolean;
  /** "field: expected X, got Y" lines, for the report. */
  mistakes: string[];
}

export function scoreCase(
  expected: { intent: string; units: ComparableUnit[] },
  actual: { intent: string; units: ComparableUnit[] },
): CaseScore {
  const fields: Record<string, FieldTally> = {};
  const mistakes: string[] = [];
  for (const [e, a] of pairUnits(expected.units, actual.units)) {
    for (const field of COMPARED_FIELDS) {
      const tally = (fields[field] ??= { correct: 0, total: 0 });
      tally.total += 1;
      if (a && sameValue(a[field], e[field])) tally.correct += 1;
      else {
        mistakes.push(
          a
            ? `${field}: expected ${JSON.stringify(e[field] ?? null)}, got ${JSON.stringify(a[field] ?? null)}`
            : `${field}: unit missing (expected ${JSON.stringify(e[field] ?? null)})`,
        );
      }
    }
  }
  if (actual.units.length > expected.units.length) {
    mistakes.push(`${actual.units.length - expected.units.length} extra unit(s) produced`);
  }
  return {
    fields,
    unitCountCorrect: expected.units.length === actual.units.length,
    intentCorrect: expected.intent === actual.intent,
    mistakes,
  };
}

/** Adds case scores together. */
export function sumScores(scores: CaseScore[]): Record<string, FieldTally> {
  const total: Record<string, FieldTally> = {};
  for (const score of scores) {
    for (const [field, tally] of Object.entries(score.fields)) {
      const t = (total[field] ??= { correct: 0, total: 0 });
      t.correct += tally.correct;
      t.total += tally.total;
    }
  }
  return total;
}

export const percent = (t: FieldTally) =>
  t.total === 0 ? 100 : Math.round((1000 * t.correct) / t.total) / 10;
