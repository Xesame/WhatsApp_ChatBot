import { extractionRuns, messages, units, type Database } from '@reb/db';
import type { PgBoss } from '@reb/queue';
import { gte, sql } from 'drizzle-orm';

export interface Stats {
  days: {
    day: string;
    messages: number;
    processed: number;
    skipped: number;
    failed: number;
    modelCalls: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  /** Processed ÷ (processed + failed) over the period. */
  extractionSuccessRate: number | null;
  /** Units needing review ÷ active units. */
  needsReviewRate: number | null;
  units: Record<string, number>;
  needsReview: number;
}

/** The numbers on the admin stats page (build plan, section 8). */
export async function stats(database: Database, days = 14): Promise<Stats> {
  const { db } = database;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const perDay = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${messages.sentAt}), 'YYYY-MM-DD')`,
      messages: sql<number>`count(*)::int`,
      processed: sql<number>`count(*) filter (where ${messages.status} = 'processed')::int`,
      skipped: sql<number>`count(*) filter (where ${messages.status} = 'skipped')::int`,
      failed: sql<number>`count(*) filter (where ${messages.status} = 'failed')::int`,
    })
    .from(messages)
    .where(gte(messages.sentAt, since))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const calls = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${extractionRuns.createdAt}), 'YYYY-MM-DD')`,
      calls: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(${extractionRuns.costUsd}), 0)::float`,
      input: sql<number>`coalesce(sum(${extractionRuns.inputTokens}), 0)::int`,
      output: sql<number>`coalesce(sum(${extractionRuns.outputTokens}), 0)::int`,
    })
    .from(extractionRuns)
    .where(gte(extractionRuns.createdAt, since))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  const allDays = [...new Set([...perDay.map((d) => d.day), ...calls.map((c) => c.day)])].sort();
  const dayRows = allDays.map((day) => {
    const m = perDay.find((d) => d.day === day);
    const c = calls.find((d) => d.day === day);
    return {
      day,
      messages: m?.messages ?? 0,
      processed: m?.processed ?? 0,
      skipped: m?.skipped ?? 0,
      failed: m?.failed ?? 0,
      modelCalls: c?.calls ?? 0,
      costUsd: c?.cost ?? 0,
      inputTokens: c?.input ?? 0,
      outputTokens: c?.output ?? 0,
    };
  });
  const processed = dayRows.reduce((s, d) => s + d.processed, 0);
  const failed = dayRows.reduce((s, d) => s + d.failed, 0);

  const byStatus = await db
    .select({ status: units.status, count: sql<number>`count(*)::int` })
    .from(units)
    .groupBy(units.status);
  const [review] = await db
    .select({
      count: sql<number>`count(*) filter (where ${units.needsReview} and ${units.status} in ('active', 'stale'))::int`,
    })
    .from(units);
  const active = byStatus.find((s) => s.status === 'active')?.count ?? 0;
  return {
    days: dayRows,
    extractionSuccessRate: processed + failed > 0 ? processed / (processed + failed) : null,
    needsReviewRate: active > 0 ? (review?.count ?? 0) / active : null,
    units: Object.fromEntries(byStatus.map((s) => [s.status, s.count])),
    needsReview: review?.count ?? 0,
  };
}

export interface FailedJob {
  id: string;
  queue: string;
  data: unknown;
  error: string | null;
  failedAt: Date | null;
  retries: number;
}

/** Jobs that used up their retries (state `failed` in pg-boss). */
export async function failedJobs(database: Database, limit = 50): Promise<FailedJob[]> {
  // pg-boss creates its tables when the worker first starts
  const exists = await database.pool.query<{ table: string | null }>(
    `select to_regclass('pgboss.job')::text as table`,
  );
  if (!exists.rows[0]?.table) return [];
  const result = await database.pool.query<{
    id: string;
    name: string;
    data: unknown;
    output: unknown;
    completed_on: Date | null;
    retry_count: number;
  }>(
    `select id, name, data, output, completed_on, retry_count from pgboss.job
     where state = 'failed' order by completed_on desc nulls last limit $1`,
    [limit],
  );
  return result.rows.map((r) => ({
    id: r.id,
    queue: r.name,
    data: r.data,
    error: errorText(r.output),
    failedAt: r.completed_on,
    retries: r.retry_count,
  }));
}

function errorText(output: unknown): string | null {
  if (!output) return null;
  if (typeof output === 'object' && 'message' in output && typeof output.message === 'string')
    return output.message;
  return JSON.stringify(output).slice(0, 500);
}

/** Puts a failed job back in the queue (the "retry" button). */
export async function retryJob(boss: PgBoss, queue: string, id: string): Promise<void> {
  await boss.retry(queue, id);
}
