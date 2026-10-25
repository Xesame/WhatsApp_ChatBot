import { Ingestor, syncGroups } from '@reb/ingest';
import { startQueue } from '@reb/queue';
import { runService } from '@reb/runtime';
import { downloadMedia, parseMessage, WhatsAppConnection } from '@reb/whatsapp';

// Capture: keeps the scraper number connected, stores every message from
// watched groups (with its media), and queues it for the worker. It never
// calls a model or interprets a message. See packages/whatsapp and
// packages/ingest for the logic; this file only wires them together.
await runService('capture', async ({ config, logger, database }) => {
  // loadConfigOrExit('capture') has already refused to start without it.
  const salt = config.SENDER_HASH_SALT ?? '';

  const boss = await startQueue(config.DATABASE_URL, {
    supervise: false,
    onError: (error) => {
      logger.warn({ reason: error.message }, 'Job queue connection error');
    },
  });

  const ingestor = new Ingestor({
    database,
    boss,
    logger,
    mediaDir: config.MEDIA_DIR,
    maxMediaBytes: config.MEDIA_MAX_BYTES,
    download: downloadMedia,
  });
  await ingestor.start();

  const whatsapp = new WhatsAppConnection({
    account: 'scraper',
    db: database.db,
    logger,
    pairingPhone: config.WA_PAIRING_PHONE,
    onMessages: async (messages) => {
      const results = await ingestor.handle(messages.map((m) => parseMessage(m, salt)));
      const saved = results.filter((r) => r === 'saved').length;
      if (saved > 0) logger.debug({ saved }, 'Messages stored');
    },
    onGroups: (groups, complete) => syncGroups(database.db, groups, complete),
  });
  await whatsapp.start();

  return {
    checks: { whatsapp: whatsapp.healthCheck },
    stop: async () => {
      await whatsapp.stop();
      await ingestor.stop();
      await boss.stop({ graceful: true, timeout: 10_000 });
    },
  };
});
