import { startQueue } from '@reb/queue';
import { runService } from '@reb/runtime';

// The worker supervises the job queue (retries, expiry, cleanup). Phase 1
// only creates the queues; the pipeline jobs that consume them (preprocess,
// classify, extract, dedup, alerts) are registered in Phases 2 to 4. Until
// then, jobs queued by capture wait safely in Postgres.
await runService('worker', async ({ config, logger }) => {
  const boss = await startQueue(config.DATABASE_URL, {
    supervise: true,
    onError: (error) => {
      logger.warn({ reason: error.message }, 'Job queue connection error');
    },
  });
  logger.info('Job queue ready. Pipeline jobs arrive in Phases 2 to 4.');
  return {
    stop: () => boss.stop({ graceful: true, timeout: 30_000 }),
  };
});
