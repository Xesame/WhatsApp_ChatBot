import { z } from 'zod';

/**
 * Every pipeline job type, with the shape of its payload.
 *
 * Payloads only carry IDs: the job reads everything else from the database
 * when it runs. That keeps jobs small, and a retried job always sees the
 * latest data.
 */
export const jobPayloads = {
  /** A message (and its media, if any) is stored and ready for processing. */
  preprocess: z.object({ messageId: z.number().int().positive() }),
  /** Read the text in a message's image, PDF or spreadsheet (Phase 3). */
  transcribe: z.object({ messageId: z.number().int().positive() }),
  /** Decide what the message is about: listing, price update, sold, or not relevant. */
  classify: z.object({ messageId: z.number().int().positive() }),
  /** Copy the units out of a message the classifier kept. */
  extract: z.object({
    messageId: z.number().int().positive(),
    intent: z.enum(['listing', 'price_update', 'sold']),
  }),
  /**
   * Search the web for a project name nobody has seen before. Only the name
   * (and the developer, if the message gave one) is sent: never message
   * text, sender names or phone numbers. `attempt`: runs already used by
   * earlier jobs for this name (a lookup that waits is queued again as a
   * new job), so the total stays within LOOKUP_MAX_ATTEMPTS.
   */
  lookup: z.object({
    name: z.string().min(1).max(200),
    developer: z.string().max(200).nullable(),
    attempt: z.number().int().min(0).optional(),
  }),
  /** Daily: mark units not seen for STALE_AFTER_DAYS as stale. */
  lifecycle: z.object({}),
} as const;

export type QueueName = keyof typeof jobPayloads;
export type JobPayload<Q extends QueueName> = z.infer<(typeof jobPayloads)[Q]>;

/**
 * Retry and retention policy per queue. Retries back off exponentially
 * (30 s, 1 min, 2 min, ...) so a model or network outage is ridden out
 * without hammering it.
 */
export const queueSettings: Record<
  QueueName,
  { retryLimit: number; retryDelay: number; retryBackoff: boolean; retentionSeconds: number }
> = {
  preprocess: {
    retryLimit: 8,
    retryDelay: 30,
    retryBackoff: true,
    // Keep queued jobs for 60 days. If the worker is down for a long time,
    // jobs must not expire before it comes back.
    retentionSeconds: 60 * 24 * 3600,
  },
  // Vision calls: on the last attempt the message goes on with its caption only.
  transcribe: {
    retryLimit: 4,
    retryDelay: 120,
    retryBackoff: true,
    retentionSeconds: 60 * 24 * 3600,
  },
  // Model calls: a failed call has already tried every model in the
  // fallback list, so wait longer before trying again (rate limits, outages).
  classify: { retryLimit: 6, retryDelay: 60, retryBackoff: true, retentionSeconds: 60 * 24 * 3600 },
  extract: { retryLimit: 6, retryDelay: 60, retryBackoff: true, retentionSeconds: 60 * 24 * 3600 },
  // A lookup fails only when no model got to search (quota, outage): wait
  // longer each time (about 1, 2, 4, 8 ... minutes) so the free quota is
  // not burned, 8 retries in all.
  lookup: { retryLimit: 8, retryDelay: 60, retryBackoff: true, retentionSeconds: 30 * 24 * 3600 },
  lifecycle: {
    retryLimit: 3,
    retryDelay: 300,
    retryBackoff: true,
    retentionSeconds: 7 * 24 * 3600,
  },
};
