import { normalizeName } from '@reb/normalize';
import type { Unit } from '@reb/schema';

/**
 * Deciding whether two listings are the same unit offering.
 *
 * The same unit is reposted in many groups, by many brokers, with slightly
 * different wording and rounding. Dedup keeps one unit and records every
 * message as a source. The rules below are deliberately conservative: when
 * in doubt, they say "different", because two units wrongly merged lose
 * information, while a missed duplicate is merely visible twice and can be
 * merged from the review queue.
 */

/** The fields matching looks at. */
export type MatchFields = Pick<
  Unit,
  | 'projectId'
  | 'developerId'
  | 'unitType'
  | 'unitCode'
  | 'bedrooms'
  | 'minArea'
  | 'maxArea'
  | 'minPrice'
  | 'maxPrice'
  | 'priceCurrency'
>;

export interface Tolerances {
  /** Areas may differ by this fraction and still overlap (0.05 = 5%). */
  areaFraction: number;
  /** ...or by at least this many square metres, for small units. */
  areaMinimumM2: number;
  /** Prices may differ by this fraction when no area is known (0.1 = 10%). */
  priceFraction: number;
}

export const DEFAULT_TOLERANCES: Tolerances = {
  areaFraction: 0.05,
  areaMinimumM2: 3,
  priceFraction: 0.1,
};

/**
 * True when two ranges are within `fraction` of the larger value of each
 * other (or `minimum`, whichever is bigger). Overlapping ranges have a gap
 * of 0. "150 m²" and "157 m²": gap 7, allowed 5% of 157 = 7.85 → close.
 */
function close(
  aMin: number,
  aMax: number | null,
  bMin: number,
  bMax: number | null,
  fraction: number,
  minimum = 0,
): boolean {
  const aHigh = aMax ?? aMin;
  const bHigh = bMax ?? bMin;
  const gap = Math.max(0, bMin - aHigh, aMin - bHigh);
  return gap <= Math.max(fraction * Math.max(aHigh, bHigh), minimum);
}

const sameCode = (a: string | null, b: string | null) =>
  (a ? normalizeName(a).replace(/\s+/g, '') : '') ===
  (b ? normalizeName(b).replace(/\s+/g, '') : '');

export function areasOverlap(a: MatchFields, b: MatchFields, t: Tolerances): boolean {
  if (a.minArea === null || b.minArea === null) return false;
  return close(a.minArea, a.maxArea, b.minArea, b.maxArea, t.areaFraction, t.areaMinimumM2);
}

export function pricesOverlap(a: MatchFields, b: MatchFields, t: Tolerances): boolean {
  if (a.minPrice === null || b.minPrice === null || a.priceCurrency !== b.priceCurrency)
    return false;
  return close(a.minPrice, a.maxPrice, b.minPrice, b.maxPrice, t.priceFraction);
}

/**
 * True when `incoming` describes the same offering as `existing`.
 *
 * 1. Same project (required: without a project there is nothing safe to match on).
 * 2. Same developer when both are known.
 * 3. Same unit type (required).
 * 4. Unit codes: a named unit only matches the same code; a named unit never
 *    matches a unit-type offering.
 * 5. Same bedrooms when both are known.
 * 6. Area ranges overlap (with tolerance). When neither has an area, the
 *    price ranges must overlap instead. If only one has an area: different.
 */
export function isSameUnit(
  existing: MatchFields,
  incoming: MatchFields,
  t: Tolerances = DEFAULT_TOLERANCES,
): boolean {
  if (existing.projectId === null || existing.projectId !== incoming.projectId) return false;
  if (
    existing.developerId !== null &&
    incoming.developerId !== null &&
    existing.developerId !== incoming.developerId
  ) {
    return false;
  }
  if (existing.unitType === null || existing.unitType !== incoming.unitType) return false;
  if (existing.unitCode || incoming.unitCode) return sameCode(existing.unitCode, incoming.unitCode);
  if (
    existing.bedrooms !== null &&
    incoming.bedrooms !== null &&
    existing.bedrooms !== incoming.bedrooms
  )
    return false;
  if (existing.minArea !== null && incoming.minArea !== null)
    return areasOverlap(existing, incoming, t);
  if (existing.minArea === null && incoming.minArea === null)
    return pricesOverlap(existing, incoming, t);
  return false;
}

/** How far apart two area ranges are, comparing both ends (smaller = closer). */
function areaDistance(a: MatchFields, b: MatchFields): number {
  if (a.minArea === null || b.minArea === null) return Number.MAX_SAFE_INTEGER;
  return (
    Math.abs(a.minArea - b.minArea) + Math.abs((a.maxArea ?? a.minArea) - (b.maxArea ?? b.minArea))
  );
}

/**
 * The best existing unit for an incoming listing, or null to create a new
 * one. Among matches: closest area, then the one with known bedrooms.
 */
export function findMatch<T extends MatchFields>(
  candidates: T[],
  incoming: MatchFields,
  t: Tolerances = DEFAULT_TOLERANCES,
): T | null {
  const matches = candidates.filter((c) => isSameUnit(c, incoming, t));
  matches.sort(
    (a, b) =>
      areaDistance(a, incoming) - areaDistance(b, incoming) ||
      Number(b.bedrooms !== null) - Number(a.bedrooms !== null),
  );
  return matches[0] ?? null;
}

/**
 * For a price update or sold notice that replies to an earlier message: which
 * of the units from that message does it mean?
 *
 * - The earlier message had one unit: that one.
 * - Several: narrow down by what the update states (unit type, bedrooms,
 *   area). Exactly one left: that one. Otherwise ambiguous (null), and the
 *   caller flags it for review rather than guessing.
 * - A sold notice that names nothing specific means all of them.
 */
export function pickTargets<T extends MatchFields>(
  quotedUnits: T[],
  update: Partial<MatchFields>,
  t: Tolerances = DEFAULT_TOLERANCES,
): { targets: T[]; ambiguous: boolean } {
  if (quotedUnits.length <= 1) return { targets: quotedUnits, ambiguous: false };
  const specific = update.unitType != null || update.bedrooms != null || update.minArea != null;
  if (!specific) return { targets: quotedUnits, ambiguous: true };
  const narrowed = quotedUnits.filter(
    (u) =>
      (update.unitType == null || u.unitType === update.unitType) &&
      (update.bedrooms == null || u.bedrooms === null || u.bedrooms === update.bedrooms) &&
      (update.minArea == null ||
        u.minArea === null ||
        close(
          u.minArea,
          u.maxArea,
          update.minArea,
          update.maxArea ?? null,
          t.areaFraction,
          t.areaMinimumM2,
        )),
  );
  return narrowed.length === 1
    ? { targets: narrowed, ambiguous: false }
    : { targets: narrowed, ambiguous: true };
}
