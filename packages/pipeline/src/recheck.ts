import {
  cities,
  developers,
  projects,
  reviewCorrections,
  units,
  type Database,
  type Db,
} from '@reb/db';
import {
  entityOutcome,
  isNameReason,
  priceReason,
  scoreConfidence,
  type Suggestion,
  type WrittenNames,
} from '@reb/normalize';
import type { PgBoss } from '@reb/queue';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { matchEntities, type EntityMatches, type EntitySuggestions } from './entities.ts';
import { queueLookups } from './lookup.ts';
import { usualPricePerM2 } from './price-range.ts';

/**
 * Re-checking waiting units when the bot learns a name.
 *
 * When Hassan adds a project, a spelling, or merges two entries, units that
 * were waiting only because a name was unknown can be fixed in place: we
 * match their names again (as the broker wrote them, kept in
 * `extras.written`) and recompute their names, review reasons and
 * confidence exactly as `normalizeUnit` would for a fresh message. The unit
 * keeps its id, sources and price history; it is never merged into another
 * unit here (that is the dedup step's job, on new messages).
 *
 * Which units:
 * - waiting for review, or flagged when they arrived (so a unit this
 *   re-check cleared goes back to waiting if the spelling is removed again);
 * - active or stale (sold or withdrawn units are left alone);
 * - never a unit Hassan touched in Review (any `review_corrections` row):
 *   his answer always wins. This is checked again inside each unit's
 *   transaction, with the row locked, so a review saved at the same moment
 *   is never overwritten.
 *
 * Safe to run any number of times: a unit whose result is unchanged is not
 * written, so a second run changes nothing (rule 6). It runs right after the
 * change in the same API request (not a queue job): there are at most a few
 * hundred waiting units and no model calls, so it takes well under a second.
 */

const FIELDS = ['developer', 'project', 'city'] as const;
type Field = (typeof FIELDS)[number];

/** Old name reasons that quote the name as written: `project "X" ...`. */
const QUOTED_NAME_PATTERNS = [
  /^(developer|project|city) "(.*)" is not in the known list( \(closest: .*\))?$/,
  /^(developer|project|city) "(.*)" matched ".*" by similarity \(\d+(\.\d+)?\)$/,
];

interface UnitExtras {
  written?: WrittenNames;
  /** The price score normalizeUnit used (0, 0.6 or 1); missing on older units. */
  priceFactor?: number;
  unmatched?: Partial<Record<Field, string>>;
  suggested?: Partial<Record<Field, Suggestion>>;
  [key: string]: unknown;
}

type UnitRow = typeof units.$inferSelect;

/** An old `<field> "x" matched "y" by similarity (0.82)` reason: its similarity. */
const SIMILARITY_REASON =
  /^(developer|project|city) ".*" matched ".*" by similarity \((\d+(?:\.\d+)?)\)$/;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The part of the confidence that depends on names, exactly as in
 * scoreConfidence: 0.25 x project similarity + 0.15 x developer part.
 */
const nameParts = (parts: { projectSimilarity: number; developerPart: number }) =>
  0.25 * parts.projectSimilarity + 0.15 * parts.developerPart;

/**
 * The name parts a unit was scored with, read back from its ids and reasons:
 * an attached id counts 1, unless an old reason says it matched by
 * similarity (then that number); no id counts 0. The developer part follows
 * normalizeUnit's rule (a developer match, else 1 with a project, else 0.6
 * with a city).
 */
function oldNameParts(unit: UnitRow) {
  const similarity: Partial<Record<Field, number>> = {};
  for (const reason of unit.reviewReasons) {
    const found = SIMILARITY_REASON.exec(reason);
    if (found?.[1] && found[2]) similarity[found[1] as Field] = Number(found[2]);
  }
  const developer = unit.developerId === null ? 0 : (similarity.developer ?? 1);
  const project = unit.projectId === null ? 0 : (similarity.project ?? 1);
  return {
    projectSimilarity: project,
    developerPart: Math.max(
      developer,
      unit.projectId !== null ? 1 : 0,
      unit.cityId !== null ? 0.6 : 0,
    ),
  };
}

/** Compares two JSON values, ignoring the order of object keys (jsonb reorders them). */
function sameJson(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, v]) => v !== undefined)
              .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : value;
  return JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));
}

const isWritten = (value: unknown): value is WrittenNames =>
  !!value &&
  typeof value === 'object' &&
  FIELDS.every((f) => Array.isArray((value as Record<string, unknown>)[f]));

/**
 * Units saved before we kept the names as written have no `extras.written`.
 * Their names are read back from `extras.unmatched` and from the quoted
 * name in their old name reasons. Returns the names found and the reasons
 * they came from (those are the reasons the re-check replaces).
 */
function legacyNames(
  extras: UnitExtras,
  reasons: string[],
): { written: WrittenNames; usedReasons: Set<string> } {
  const written: WrittenNames = { developer: [], project: [], city: [] };
  const add = (field: Field, name: string) => {
    if (name.trim() && !written[field].includes(name)) written[field].push(name);
  };
  for (const field of FIELDS) {
    const name = extras.unmatched?.[field];
    if (typeof name === 'string') add(field, name);
  }
  const usedReasons = new Set<string>();
  for (const reason of reasons) {
    for (const pattern of QUOTED_NAME_PATTERNS) {
      const found = pattern.exec(reason);
      if (found?.[1] && found[2] !== undefined) {
        add(found[1] as Field, found[2]);
        usedReasons.add(reason);
        break;
      }
    }
  }
  return { written, usedReasons };
}

/**
 * Matches every written name of each field and keeps the best: the highest
 * attaching match, or failing that the closest suggestion.
 */
async function bestMatches(
  db: Db,
  written: WrittenNames,
): Promise<EntityMatches & { suggestions: EntitySuggestions }> {
  const best: EntityMatches & { suggestions: EntitySuggestions } = {
    developer: null,
    project: null,
    city: null,
    suggestions: { developer: null, project: null, city: null },
  };
  const rounds = Math.max(...FIELDS.map((f) => written[f].length));
  for (let i = 0; i < rounds; i++) {
    const found = await matchEntities(db, {
      developer: written.developer[i] ?? null,
      project: written.project[i] ?? null,
      city: written.city[i] ?? null,
    });
    const better = <T extends { similarity: number }>(now: T | null, next: T | null) =>
      next && (!now || next.similarity > now.similarity) ? next : now;
    best.developer = better(best.developer, found.developer);
    best.project = better(best.project, found.project);
    best.city = better(best.city, found.city);
    for (const f of FIELDS) {
      best.suggestions[f] = better(best.suggestions[f], found.suggestions[f]);
    }
  }
  return best;
}

/**
 * For an older unit, a field we found no written name for keeps the entity
 * it already has, as if it had matched exactly (an exact match leaves no
 * reason behind, which is why there is no name to read back). Its English
 * name is recorded as the written name so later re-checks find it again.
 */
async function keepCurrent(
  db: Db,
  unit: UnitRow,
  written: WrittenNames,
): Promise<Partial<EntityMatches>> {
  const kept: Partial<EntityMatches> = {};
  if (written.developer.length === 0 && unit.developerId !== null) {
    const [row] = await db
      .select({ name: developers.nameEn })
      .from(developers)
      .where(eq(developers.id, unit.developerId));
    if (row) {
      kept.developer = { id: unit.developerId, name: row.name, similarity: 1 };
      written.developer.push(row.name);
    }
  }
  if (written.project.length === 0 && unit.projectId !== null) {
    const [row] = await db
      .select({ name: projects.nameEn, developerId: projects.developerId, cityId: projects.cityId })
      .from(projects)
      .where(eq(projects.id, unit.projectId));
    if (row) {
      kept.project = { id: unit.projectId, similarity: 1, ...row };
      written.project.push(row.name);
    }
  }
  if (written.city.length === 0 && unit.cityId !== null) {
    const [row] = await db
      .select({ name: cities.nameEn })
      .from(cities)
      .where(eq(cities.id, unit.cityId));
    if (row) {
      kept.city = { id: unit.cityId, name: row.name, similarity: 1 };
      written.city.push(row.name);
    }
  }
  return kept;
}

/** The unit's new names, reasons and confidence, or null if it has no names to re-check. */
async function recompute(db: Db, unit: UnitRow) {
  const extras = (unit.extras ?? {}) as UnitExtras;
  let written: WrittenNames;
  let otherReasons: string[];
  let kept: Partial<EntityMatches> = {};
  if (isWritten(extras.written)) {
    written = {
      developer: [...extras.written.developer],
      project: [...extras.written.project],
      city: [...extras.written.city],
    };
    // Every name reason is recomputed below, from the names as written.
    otherReasons = unit.reviewReasons.filter((r) => !isNameReason(r));
  } else {
    const legacy = legacyNames(extras, unit.reviewReasons);
    // No name to read back: nothing here a learned name could change.
    if (FIELDS.every((f) => legacy.written[f].length === 0)) return null;
    written = legacy.written;
    // Only the reasons the names were read from are replaced; anything else stays.
    otherReasons = unit.reviewReasons.filter((r) => !legacy.usedReasons.has(r));
    kept = await keepCurrent(db, unit, written);
  }
  if (FIELDS.every((f) => written[f].length === 0)) return null;

  const found = await bestMatches(db, {
    developer: kept.developer ? [] : written.developer,
    project: kept.project ? [] : written.project,
    city: kept.city ? [] : written.city,
  });
  const ctx = {
    developer: kept.developer ?? found.developer,
    project: kept.project ?? found.project,
    city: kept.city ?? found.city,
    suggestions: found.suggestions,
  };
  const outcome = entityOutcome(
    {
      developer: kept.developer ? null : (written.developer[0] ?? null),
      project: kept.project ? null : (written.project[0] ?? null),
      city: kept.city ? null : (written.city[0] ?? null),
    },
    ctx,
  );
  // A unit that just gained its project gets its price checked against what
  // approved units of that project and type cost; other units keep their price
  // reasons as they are.
  let otherNow = otherReasons;
  const gainedProject = unit.projectId === null && outcome.projectId !== null;
  if (
    gainedProject &&
    ctx.project &&
    unit.unitType !== null &&
    unit.minPrice !== null &&
    unit.minArea !== null &&
    unit.minArea > 0 &&
    unit.priceCurrency === 'EGP'
  ) {
    const learned = await usualPricePerM2(db, ctx.project.id, unit.unitType);
    const reason = priceReason(
      unit.minPrice / 100 / unit.minArea,
      learned
        ? { median: learned.median, projectName: ctx.project.name, unitType: unit.unitType }
        : null,
    );
    otherNow = otherReasons.filter((r) => !r.startsWith('Price per m²'));
    if (reason) otherNow = [...otherNow, reason];
  }
  const reasons = [...new Set([...otherNow, ...outcome.reasons])];
  const newParts = {
    projectSimilarity: ctx.project?.similarity ?? 0,
    developerPart: Math.max(
      ctx.developer?.similarity ?? 0,
      ctx.project ? 1 : 0,
      outcome.cityId !== null ? 0.6 : 0,
    ),
  };
  // Confidence is the same arithmetic as normalizeUnit step 9 (rule 4: in
  // code, never the model), with the price scored as it was at creation.
  let confidence: number;
  let needsReview: boolean | null = null;
  if (typeof extras.priceFactor === 'number') {
    confidence = scoreConfidence({
      ...newParts,
      hasUnitType: unit.unitType !== null,
      priceFactor: extras.priceFactor,
      hasArea: unit.minArea !== null,
    });
  } else {
    // Older units did not keep their price score, and it cannot always be
    // told from the unit (a plain "6500000" scored 0.6 with no reason). So
    // only the name parts are swapped: the rest of the old score stays.
    const before = oldNameParts(unit);
    const sameNames =
      outcome.developerId === unit.developerId &&
      outcome.projectId === unit.projectId &&
      outcome.cityId === unit.cityId &&
      before.projectSimilarity === newParts.projectSimilarity &&
      before.developerPart === newParts.developerPart;
    if (sameNames) {
      // Nothing about the names changed: score and decision stay as they are.
      confidence = unit.confidence;
      needsReview = unit.needsReview;
    } else {
      const score = unit.confidence - nameParts(before) + nameParts(newParts);
      confidence = Math.min(1, Math.max(0, round2(score)));
    }
  }
  // Other extras stay as they are; unmatched and suggested are replaced.
  const rest: UnitExtras = { ...extras };
  delete rest.unmatched;
  delete rest.suggested;
  return {
    developerId: outcome.developerId,
    projectId: outcome.projectId,
    cityId: outcome.cityId,
    reviewReasons: reasons,
    confidence,
    needsReview: needsReview ?? (reasons.length > 0 || confidence < 0.7),
    extras: {
      ...rest,
      written,
      ...(Object.keys(outcome.unmatched).length ? { unmatched: outcome.unmatched } : {}),
      ...(Object.keys(outcome.suggested).length ? { suggested: outcome.suggested } : {}),
    },
  };
}

const CHECKED_STATUSES = ['active', 'stale'] as const;

/**
 * With `boss`, units the re-check changed that still miss a developer or
 * city/area get a name lookup queued (see lookup.ts).
 */
export async function recheckWaitingUnits(
  database: Database,
  options: { boss?: PgBoss } = {},
): Promise<{ checked: number; cleared: number }> {
  const notReviewed = sql`not exists (select 1 from ${reviewCorrections} where ${reviewCorrections.unitId} = ${units.id})`;
  const candidates = await database.db
    .select({ id: units.id })
    .from(units)
    .where(
      and(
        or(eq(units.needsReview, true), eq(units.flaggedOnArrival, true)),
        inArray(units.status, [...CHECKED_STATUSES]),
        notReviewed,
      ),
    )
    .orderBy(asc(units.id));

  let checked = 0;
  let cleared = 0;
  const updated: number[] = [];
  for (const { id } of candidates) {
    const result = await database.transaction(async (tx) => {
      // Lock the unit, then make sure it still qualifies: a review may have
      // been saved since the list above was read.
      const [unit] = await tx.select().from(units).where(eq(units.id, id)).for('update');
      if (
        !unit ||
        !(unit.needsReview || unit.flaggedOnArrival) ||
        !(CHECKED_STATUSES as readonly string[]).includes(unit.status)
      )
        return null;
      const [touched] = await tx
        .select({ id: reviewCorrections.id })
        .from(reviewCorrections)
        .where(eq(reviewCorrections.unitId, id))
        .limit(1);
      if (touched) return null;

      const next = await recompute(tx, unit);
      if (!next) return null;
      const unchanged =
        next.developerId === unit.developerId &&
        next.projectId === unit.projectId &&
        next.cityId === unit.cityId &&
        next.confidence === unit.confidence &&
        next.needsReview === unit.needsReview &&
        sameJson(next.reviewReasons, unit.reviewReasons) &&
        sameJson(next.extras, unit.extras);
      // flagged_on_arrival is never changed: it records how the unit arrived.
      if (!unchanged) await tx.update(units).set(next).where(eq(units.id, id));
      return { cleared: unit.needsReview && !next.needsReview, updated: !unchanged };
    });
    if (result) {
      checked += 1;
      if (result.cleared) cleared += 1;
      if (result.updated) updated.push(id);
    }
  }
  if (options.boss) await queueLookups(database.db, options.boss, updated);
  return { checked, cleared };
}
