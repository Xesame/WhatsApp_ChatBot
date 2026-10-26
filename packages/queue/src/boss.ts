import { PgBoss } from 'pg-boss';
import type pg from 'pg';
import { jobPayloads, queueSettings, type JobPayload, type QueueName } from './queues.ts';

export { PgBoss };

/**
 * Starts pg-boss, the Postgres-backed job queue.
 *
 * pg-boss keeps its tables in its own `pgboss` schema and creates or
 * upgrades them on start. Only the worker supervises the queue (maintenance,
 * retries, scheduling); other services only add jobs, so they pass
 * `{ supervise: false }`.
 */
export async function startQueue(
  databaseUrl: string,
  options: { supervise: boolean; onError: (error: Error) => void },
): Promise<PgBoss> {
  const boss = new PgBoss({
    connectionString: databaseUrl,
    max: 3,
    supervise: options.supervise,
    schedule: options.supervise,
  });
  // Without an 'error' listener, a lost connection would crash the process.
  boss.on('error', options.onError);
  await boss.start();
  for (const name of Object.keys(queueSettings) as QueueName[]) {
    if (!(await boss.getQueue(name))) {
      await boss.createQueue(name, queueSettings[name]);
    }
  }
  return boss;
}

/** A database connection that is inside an open transaction. */
export type TransactionClient = Pick<pg.PoolClient, 'query'>;

/**
 * Adds a job using the caller's transaction. The job exists only if the
 * transaction commits, so saving a message and queuing its job happen
 * together or not at all.
 */
export async function enqueueInTransaction<Q extends QueueName>(
  boss: PgBoss,
  client: TransactionClient,
  queue: Q,
  payload: JobPayload<Q>,
): Promise<void> {
  const data = jobPayloads[queue].parse(payload);
  await boss.send(queue, data, {
    db: {
      executeSql: async (text: string, values?: unknown[]) => client.query(text, values),
    },
  });
}

/** Validates a job's payload when the worker receives it. */
export function parsePayload<Q extends QueueName>(queue: Q, data: unknown): JobPayload<Q> {
  return jobPayloads[queue].parse(data) as unknown as JobPayload<Q>;
}
