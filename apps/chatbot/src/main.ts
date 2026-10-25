import { runService } from '@reb/runtime';

// Phase 0 skeleton. Phase 7 adds the WhatsApp query bot (on its own number,
// never the scraper's) and the Telegram backup adapter.
await runService('chatbot', ({ logger }) => {
  logger.info('Chatbot skeleton running. Query bots arrive in Phase 7.');
  return Promise.resolve(undefined);
});
