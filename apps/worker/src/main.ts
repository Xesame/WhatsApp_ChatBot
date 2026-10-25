import { runService } from '@reb/runtime';

// Phase 0 skeleton. Phase 1 starts the pg-boss job queue here; later phases
// register the pipeline jobs (preprocess, classify, extract, dedup, alerts).
await runService('worker', ({ logger }) => {
  logger.info('Worker skeleton running. Pipeline jobs arrive in Phases 1 to 4.');
  return Promise.resolve(undefined);
});
