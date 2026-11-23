import { nameLookups, units, type Db, type LookupSource } from '@reb/db';
import { canSearch, lookupPrompt, modelLabel, parseModelList, type ModelRef } from '@reb/llm';
import { normalizeName } from '@reb/normalize';
import type { PgBoss } from '@reb/queue';
import { lookupResultSchema, type LookupResult } from '@reb/schema';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { RetryableError, type PipelineDeps } from './steps.ts';

/**
 * Names from a live web search.
 *
 * When a unit's project name was written but its developer or city/area is
 * missing, we search the web once for that project (which developer builds
 * it, where it is). The answer is kept in `name_lookups`, one row per name
 * however many units mention it, and shown on the Review page as a hint
 * ("Gemini found on Google: ..."). It is never copied into a unit: Hassan
 * decides.
 *
 * - From a search, never from memory. Gemini with Google Search first; if
 *   Gemini cannot search (quota, not allowed on the free tier, an error, or
 *   an answer that shows no search was run), Groq with its browser search.
 *   If neither searched, nothing is saved and the job is retried later by
 *   the queue. A model is never asked without search. Models: LLM_LOOKUP_MODELS.
 * - Only names go to the model: the project as written and the developer as
 *   written, if any. Never message text, sender names or phone numbers
 *   (rule 3).
 * - Extraction first: the worker runs queues side by side under one shared
 *   rate limit, so a lookup waits while messages are still being extracted.
 * - "Not sure" answers (a search ran but did not clearly say) are kept too (so we do not ask on every
 *   message) and asked again after 30 days, since new projects become known.
 *   Older answers from Gemini's memory (`method = 'memory'`) are no longer
 *   trusted: they count as stale and are asked again with search.
 * - Safe to run again (rule 6): a job whose name already has a fresh answer
 *   does nothing, and saving the answer overwrites the same row.
 */

/** Used when the worker was not given lookup models (tests, scripts). */
export const DEFAULT_LOOKUP_MODELS = 'gemini:gemini-flash-latest,groq:openai/gpt-oss-120b';

/** How long a "not sure" answer is trusted before we ask again. */
export const UNKNOWN_RETRY_DAYS = 30;
/** How long a lookup waits before trying again while extraction is busy (seconds). */
export const LOOKUP_WAIT_SECONDS = 60;

interface LookupUnit {
  projectId: number | null;
  developerId: number | null;
  cityId: number | null;
  extras: unknown;
}

export interface LookupJob {
  name: string;
  developer: string | null;
}

const firstName = (value: unknown): string | null => {
  const name = Array.isArray(value) ? (value as unknown[])[0] : value;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
};

/**
 * Which project name to ask about for this unit, or null if none.
 * A unit needs a lookup when a project name was written and its developer
 * or city/area is still missing. The names come from `extras.written`
 * (the names as the broker wrote them); older units that do not have it
 * fall back to `extras.unmatched`.
 */
export function needsLookup(unit: LookupUnit): LookupJob | null {
  if (unit.developerId !== null && unit.cityId !== null) return null;
  const extras = (unit.extras ?? {}) as {
    written?: { developer?: unknown; project?: unknown };
    unmatched?: { developer?: unknown; project?: unknown };
  };
  const names = extras.written ?? extras.unmatched;
  const name = firstName(names?.project);
  if (!name) return null;
  // Lookup names are capped at 200 characters by the queue payload.
  return {
    name: name.slice(0, 200),
    developer: firstName(names?.developer)?.slice(0, 200) ?? null,
  };
}

/**
 * An answer that still counts: one from a web search that is either known,
 * or "not sure" and under 30 days old. Answers from memory never count.
 */
const fresh = () =>
  and(
    eq(nameLookups.method, 'search'),
    or(
      eq(nameLookups.known, true),
      sql`${nameLookups.updatedAt} > now() - make_interval(days => ${UNKNOWN_RETRY_DAYS})`,
    ),
  );

/** The lookup job's key (the name in its comparable form): one waiting job per name. */
const keyOf = (normalized: string) => normalized;

/**
 * Queues a lookup for each of these units that needs one, once per name:
 * skipped when the name already has an answer that still counts, or a
 * lookup for it is already waiting. Returns how many jobs were added.
 */
export async function queueLookups(db: Db, boss: PgBoss, unitIds: number[]): Promise<number> {
  if (unitIds.length === 0) return 0;
  const rows = await db
    .select({
      projectId: units.projectId,
      developerId: units.developerId,
      cityId: units.cityId,
      extras: units.extras,
    })
    .from(units)
    .where(inArray(units.id, unitIds));

  const wanted = new Map<string, LookupJob>();
  for (const row of rows) {
    const job = needsLookup(row);
    if (!job) continue;
    const normalized = normalizeName(job.name);
    if (normalized && !wanted.has(normalized)) wanted.set(normalized, job);
  }
  if (wanted.size === 0) return 0;

  const answered = await db
    .select({ nameNormalized: nameLookups.nameNormalized })
    .from(nameLookups)
    .where(and(inArray(nameLookups.nameNormalized, [...wanted.keys()]), fresh()));
  for (const { nameNormalized } of answered) wanted.delete(nameNormalized);
  if (wanted.size === 0) return 0;

  // Small race: two requests can both pass this check and queue the same name;
  // the second job returns early on the fresh-row check in runLookup.
  // pg-boss's singletonKey only blocks duplicates on some queue policies, so
  // we also check for a lookup that is already waiting for the same name.
  const keys = [...wanted.keys()].map(keyOf);
  const { rows: waiting } = await db.execute<{ key: string }>(
    sql`select singleton_key as key from pgboss.job
      where name = 'lookup' and state in ('created', 'retry', 'active')
        and singleton_key in (${sql.join(
          keys.map((k) => sql`${k}`),
          sql`, `,
        )})`,
  );
  const alreadyWaiting = new Set(waiting.map((w) => w.key));

  let queued = 0;
  for (const [normalized, job] of wanted) {
    if (alreadyWaiting.has(keyOf(normalized))) continue;
    const id = await boss.send('lookup', job, { singletonKey: keyOf(normalized) });
    if (id) queued += 1;
  }
  return queued;
}

/**
 * `lookup --redo-memory`: queues a search for every name a waiting unit
 * needs whose answer no longer counts: from Gemini's memory, "not sure" for
 * over 30 days, or never asked. Same rules as `queueLookups`, so it is safe
 * to run again: names already answered by search, or already waiting, are
 * skipped. The jobs run at the worker's pace, under its rate limit.
 * Returns how many jobs were added.
 */
export async function redoLookups(db: Db, boss: PgBoss): Promise<number> {
  const rows = await db
    .select({ id: units.id })
    .from(units)
    .where(or(isNull(units.developerId), isNull(units.cityId)));
  const ids = rows.map((r) => r.id);
  let queued = 0;
  for (let i = 0; i < ids.length; i += 500) {
    queued += await queueLookups(db, boss, ids.slice(i, i + 500));
  }
  return queued;
}

/** Puts a lookup back in the queue to try again in a minute (extraction was busy). */
export async function queueLookupLater(boss: PgBoss, job: LookupJob): Promise<void> {
  await boss.send('lookup', job, {
    singletonKey: keyOf(normalizeName(job.name)),
    startAfter: LOOKUP_WAIT_SECONDS,
  });
}

/** True while messages are waiting for, or in the middle of, extraction. */
async function extractionBusy(db: Db): Promise<boolean> {
  const { rows } = await db.execute<{ busy: boolean }>(
    sql`select exists (select 1 from pgboss.job
      where name = 'extract' and state in ('created', 'retry', 'active')) as busy`,
  );
  return rows[0]?.busy ?? false;
}

/** Said once per worker run, not on every job. */
let warnedNoSearch = false;

/**
 * The answer as read from a search: the three fields. Anything else the
 * model added is dropped (search answers cannot use a strict JSON schema).
 */
const searchAnswerSchema = lookupResultSchema.strip();

/** One saved answer, as the Review page reads it. */
export type SavedLookup = LookupResult & {
  name: string;
  method: 'memory' | 'search' | null;
  provider: 'gemini' | 'groq' | null;
  sources: LookupSource[] | null;
};

/**
 * Runs one lookup job. Returns 'waiting' when extraction is busy (the worker
 * then queues it again for a minute later), 'done' otherwise.
 */
export async function runLookup(deps: PipelineDeps, job: LookupJob): Promise<'done' | 'waiting'> {
  const { db } = deps.database;
  const normalized = normalizeName(job.name);
  if (!normalized) return 'done';

  const models: ModelRef[] = deps.models.lookup ?? parseModelList(DEFAULT_LOOKUP_MODELS);
  const searchers = models.filter((m) => canSearch(m.provider));
  if (!deps.llm.canUse(searchers)) {
    if (!warnedNoSearch) {
      warnedNoSearch = true;
      deps.logger.warn(
        'No search model in LLM_LOOKUP_MODELS (gemini or groq, with its API key): name lookups are skipped',
      );
    }
    return 'done';
  }

  // Already answered (a duplicate job, or another unit got there first).
  const [existing] = await db
    .select({ id: nameLookups.id })
    .from(nameLookups)
    .where(and(eq(nameLookups.nameNormalized, normalized), fresh()));
  if (existing) return 'done';

  if (await extractionBusy(db)) return 'waiting';

  const result = await deps.llm.callSearch<LookupResult>(searchers, {
    promptVersion: lookupPrompt.VERSION,
    messages: [
      { role: 'system', content: lookupPrompt.SYSTEM },
      {
        role: 'user',
        content: lookupPrompt.userPrompt({ project: job.name, developer: job.developer }),
      },
    ],
    validate: (data) => {
      const parsed = searchAnswerSchema.safeParse(data);
      return parsed.success
        ? { ok: true as const, data: parsed.data }
        : { ok: false as const, error: parsed.error.issues.map((i) => i.message).join('; ') };
    },
  });
  // Lookup calls are not added to extraction_runs: that table needs a
  // message and only allows classify, extract and transcribe.
  // No model got to search (quota, server error, timeout, an answer without
  // a search, or not the JSON asked for): nothing is saved, and the job is
  // retried soon by the queue (its usual retries, then Failed jobs). Only
  // a search that ran but did not clearly say is saved as "not sure".
  if (!result.data || !result.searched) {
    const tried = result.attempts.map((a) => `${modelLabel(a)}: ${a.error ?? a.status}`);
    throw new RetryableError(
      `Name lookup for "${job.name}": no model could search (${tried.join('; ') || 'no model tried'})`,
    );
  }

  const clean = (value: string | null) => (value?.trim() ? value.trim() : null);
  // "Not sure" is stored with no names, whatever else the model said.
  const known = result.data.known;
  const answer = {
    known,
    developer: known ? clean(result.data.developer) : null,
    city: known ? clean(result.data.city) : null,
    model: modelLabel(result.searched),
    promptVersion: lookupPrompt.VERSION,
    method: 'search' as const,
    provider: result.searched.provider,
    sources: result.sources,
  };
  await db
    .insert(nameLookups)
    .values({ name: job.name, nameNormalized: normalized, ...answer })
    .onConflictDoUpdate({
      target: nameLookups.nameNormalized,
      set: { ...answer, updatedAt: new Date() },
    });
  return 'done';
}

/**
 * The saved lookup answer for this unit's project name, if there is one
 * (for Review, which shows only answers from a search).
 */
export async function lookupFor(db: Db, unit: LookupUnit): Promise<SavedLookup | null> {
  const job = needsLookup(unit);
  if (!job) return null;
  const [row] = await db
    .select({
      name: nameLookups.name,
      known: nameLookups.known,
      developer: nameLookups.developer,
      city: nameLookups.city,
      method: nameLookups.method,
      provider: nameLookups.provider,
      sources: nameLookups.sources,
    })
    .from(nameLookups)
    .where(eq(nameLookups.nameNormalized, normalizeName(job.name)));
  return row ?? null;
}
