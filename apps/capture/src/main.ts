import { runService } from '@reb/runtime';

// Phase 0 skeleton. Phase 1 adds the Baileys connection to the scraper
// WhatsApp number, saves every message from watched groups, and enqueues a
// `preprocess` job. Capture never calls an LLM (see PROJECT.md, Architecture).
await runService('capture', ({ logger }) => {
  logger.info('Capture skeleton running. WhatsApp connection arrives in Phase 1.');
  return Promise.resolve(undefined);
});
