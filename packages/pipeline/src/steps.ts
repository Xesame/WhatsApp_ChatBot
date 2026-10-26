import { extractionRuns, messages, units, type Database, type Db } from '@reb/db';
import {
  classifyPrompt,
  extractPrompt,
  type Attempt,
  type LlmClient,
  type ModelRef,
} from '@reb/llm';
import { normalizeUnit } from '@reb/normalize';
import { enqueueInTransaction, type PgBoss } from '@reb/queue';
import {
  classificationSchema,
  extractionResultSchema,
  jsonSchemaFor,
  type Classification,
  type ExtractionResult,
  type MessageIntent,
  type Unit,
} from '@reb/schema';
import { eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { z } from 'zod';
import { assembleContext, type MessageContext } from './context.ts';
import { matchEntities } from './entities.ts';
import { mightBeListing } from './prefilter.ts';

export interface PipelineDeps {
  database: Database;
  boss: PgBoss;
  llm: LlmClient;
  models: { classify: ModelRef[]; extract: ModelRef[] };
  logger: Logger;
}

/** A step that could not finish; the job queue retries it later. */
export class RetryableError extends Error {
  override name = 'RetryableError';
}

type Status = (typeof messages.$inferSelect)['status'];

async function setStatus(db: Db, messageId: number, status: Status, error: string | null = null) {
  await db.update(messages).set({ status, error }).where(eq(messages.id, messageId));
}

async function recordAttempts(
  db: Db,
  messageId: number,
  purpose: 'classify' | 'extract',
  attempts: Attempt[],
  parsed: unknown,
): Promise<number | null> {
  let lastOkId: number | null = null;
  for (const attempt of attempts) {
    const [row] = await db
      .insert(extractionRuns)
      .values({
        messageId,
        purpose,
        promptVersion: attempt.promptVersion,
        provider: attempt.provider,
        model: attempt.model,
        request: attempt.request,
        rawOutput: attempt.rawOutput,
        parsed: attempt.status === 'ok' ? (parsed as object) : null,
        inputTokens: attempt.inputTokens,
        outputTokens: attempt.outputTokens,
        costUsd: attempt.costUsd,
        latencyMs: attempt.latencyMs,
        status: attempt.status,
        error: attempt.error,
      })
      .returning({ id: extractionRuns.id });
    if (attempt.status === 'ok' && row) lastOkId = row.id;
  }
  return lastOkId;
}

const validator =
  <T>(schema: z.ZodType<T>) =>
  (data: unknown) => {
    const result = schema.safeParse(data);
    return result.success
      ? { ok: true as const, data: result.data }
      : {
          ok: false as const,
          error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        };
  };

export interface ModelResult<T> {
  data: T | null;
  attempts: Attempt[];
}

/** Asks the classification models about one message context. Shared with `pnpm eval`. */
export function runClassification(
  llm: LlmClient,
  models: ModelRef[],
  context: Pick<MessageContext, 'text' | 'quoted'>,
): Promise<ModelResult<Classification>> {
  return llm.callJson<Classification>(models, {
    promptVersion: classifyPrompt.VERSION,
    messages: [
      { role: 'system', content: classifyPrompt.SYSTEM },
      { role: 'user', content: classifyPrompt.userPrompt(context) },
    ],
    schemaName: 'classification',
    jsonSchema: jsonSchemaFor(classificationSchema),
    validate: validator(classificationSchema),
  });
}

/**
 * Asks the extraction models for the units in one message context, then
 * matches names and normalizes every unit in code. Shared with `pnpm eval`.
 */
export async function runExtraction(
  db: Db,
  llm: LlmClient,
  models: ModelRef[],
  context: Pick<MessageContext, 'text' | 'quoted' | 'sourceText'> & { sentAt: Date },
): Promise<ModelResult<ExtractionResult> & { units: Unit[] }> {
  const result = await llm.callJson<ExtractionResult>(models, {
    promptVersion: extractPrompt.VERSION,
    messages: [
      { role: 'system', content: extractPrompt.SYSTEM },
      { role: 'user', content: extractPrompt.userPrompt(context) },
    ],
    schemaName: 'extraction',
    jsonSchema: jsonSchemaFor(extractionResultSchema),
    validate: validator(extractionResultSchema),
  });
  const normalized: Unit[] = [];
  for (const raw of result.data?.units ?? []) {
    const entities = await matchEntities(db, raw);
    normalized.push(
      normalizeUnit(raw, { sourceText: context.sourceText, sentAt: context.sentAt, ...entities }),
    );
  }
  return { ...result, units: normalized };
}

/**
 * Step 2 (preprocess): decides whether a message can be processed now.
 * Text goes on to classification. Voice notes are not processed (decided
 * with Hassan). Images, PDFs and videos wait for media extraction in Phase 3;
 * they are marked `skipped` and can be reprocessed then.
 */
export async function preprocess(deps: PipelineDeps, messageId: number): Promise<string> {
  const { db } = deps.database;
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!message) return 'missing';
  if (message.deletedAt) {
    await setStatus(db, messageId, 'skipped', 'Deleted by the sender');
    return 'skipped';
  }
  if (message.mediaType === 'audio') {
    await setStatus(db, messageId, 'skipped', 'Voice notes are not processed');
    return 'skipped';
  }
  if (message.mediaType !== 'none') {
    await setStatus(db, messageId, 'skipped', 'Media extraction arrives in Phase 3');
    return 'skipped';
  }
  if (!message.text?.trim()) {
    await setStatus(db, messageId, 'skipped', 'No text');
    return 'skipped';
  }
  await deps.database.transaction(async (tx, client) => {
    await tx
      .update(messages)
      .set({ status: 'processing', error: null })
      .where(eq(messages.id, messageId));
    await enqueueInTransaction(deps.boss, client, 'classify', { messageId });
  });
  return 'queued';
}

/** Step 4 (classify): keyword filter, then a small model call. */
export async function classify(
  deps: PipelineDeps,
  messageId: number,
): Promise<MessageIntent | 'missing'> {
  const { db } = deps.database;
  const context = await assembleContext(db, messageId);
  if (!context) return 'missing';

  if (!mightBeListing([context.text, context.quoted ?? ''].join(' '))) {
    await setStatus(db, messageId, 'skipped', 'Not relevant: no listing words');
    return 'not_relevant';
  }

  const result = await runClassification(deps.llm, deps.models.classify, context);
  await recordAttempts(db, messageId, 'classify', result.attempts, result.data);
  await db
    .update(messages)
    .set({ attempts: sql`${messages.attempts} + 1` })
    .where(eq(messages.id, messageId));

  if (!result.data) {
    const reason = result.attempts.at(-1)?.error ?? 'no model available';
    await setStatus(db, messageId, 'failed', `Classification failed: ${reason}`);
    throw new RetryableError(`Classification failed for message ${messageId}: ${reason}`);
  }
  const { intent } = result.data;
  if (intent === 'not_relevant') {
    await setStatus(db, messageId, 'skipped', 'Not relevant (model)');
    return intent;
  }
  await deps.database.transaction(async (tx, client) => {
    await enqueueInTransaction(deps.boss, client, 'extract', { messageId, intent });
    await tx
      .update(messages)
      .set({ status: 'processing', error: null })
      .where(eq(messages.id, messageId));
  });
  return intent;
}

/**
 * Steps 5-6 (extract, validate, normalize): the model copies out the units,
 * code turns them into template values, and they are saved.
 *
 * Idempotent: running it again for the same message replaces the units it
 * produced before (until Phase 4, when units are merged across messages).
 * Model calls are always added to `extraction_runs`, never replaced.
 */
export async function extract(
  deps: PipelineDeps,
  messageId: number,
  intent: Exclude<MessageIntent, 'not_relevant'>,
): Promise<number> {
  const { db } = deps.database;
  const context = await assembleContext(db, messageId);
  if (!context) return 0;

  const result = await runExtraction(db, deps.llm, deps.models.extract, {
    ...context,
    sentAt: context.message.sentAt,
  });
  const runId = await recordAttempts(db, messageId, 'extract', result.attempts, result.data);
  await db
    .update(messages)
    .set({ attempts: sql`${messages.attempts} + 1` })
    .where(eq(messages.id, messageId));

  if (!result.data) {
    const reason = result.attempts.at(-1)?.error ?? 'no model available';
    await setStatus(db, messageId, 'failed', `Extraction failed: ${reason}`);
    throw new RetryableError(`Extraction failed for message ${messageId}: ${reason}`);
  }

  const normalized = result.units;

  await deps.database.transaction(async (tx) => {
    await tx.delete(units).where(eq(units.sourceMessageId, messageId));
    // Price updates and sold notices change existing units; that matching
    // arrives with dedup in Phase 4. Their extraction is kept in
    // extraction_runs so Phase 4 can apply them without calling the model.
    if (intent === 'listing' && normalized.length > 0) {
      await tx.insert(units).values(
        normalized.map((unit) => ({
          ...unit,
          sourceMessageId: messageId,
          extractionRunId: runId,
          firstSeenAt: context.message.sentAt,
          lastSeenAt: context.message.sentAt,
        })),
      );
    }
    await tx
      .update(messages)
      .set({
        status: intent === 'listing' && normalized.length === 0 ? 'skipped' : 'processed',
        error:
          intent === 'listing' && normalized.length === 0
            ? 'No units found'
            : intent === 'listing'
              ? null
              : `${intent}: applied to existing units in Phase 4`,
      })
      .where(eq(messages.id, messageId));
  });
  deps.logger.info({ messageId, intent, units: normalized.length }, 'Message extracted');
  return intent === 'listing' ? normalized.length : 0;
}
