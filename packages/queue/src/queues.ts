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
  /** Decide what the message is about: listing, price update, sold, or not relevant. */
  classify: z.object({ messageId: z.number().int().positive() }),
  /** Copy the units out of a message the classifier kept. */
  extract: z.object({
    messageId: z.number().int().positive(),
    intent: z.enum(['listing', 'price_update', 'sold']),
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
  // Model calls: a failed call has already tried every model in the
  // fallback list, so wait longer before trying again (rate limits, outages).
  classify: { retryLimit: 6, retryDelay: 60, retryBackoff: true, retentionSeconds: 60 * 24 * 3600 },
  extract: { retryLimit: 6, retryDelay: 60, retryBackoff: true, retentionSeconds: 60 * 24 * 3600 },
  lifecycle: {
    retryLimit: 3,
    retryDelay: 300,
    retryBackoff: true,
    retentionSeconds: 7 * 24 * 3600,
  },
};
