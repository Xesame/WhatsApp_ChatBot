import { apiKeysFrom, LlmClient, parseModelList } from '@reb/llm';
import {
  classify,
  extract,
  markStale,
  preprocess,
  RetryableError,
  transcribe,
  type PipelineDeps,
} from '@reb/pipeline';
import { parsePayload, queueSettings, startQueue, type QueueName } from '@reb/queue';
import { runService } from '@reb/runtime';

// The worker runs the pipeline jobs. Logic lives in packages/pipeline; this
// file only connects queues to it.
//   preprocess → (transcribe, for files) → classify → extract (with dedup),
//   plus a daily lifecycle job
await runService('worker', async ({ config, logger, database }) => {
  const boss = await startQueue(config.DATABASE_URL, {
    supervise: true,
    onError: (error) => {
      logger.warn({ reason: error.message }, 'Job queue connection error');
    },
  });

  const llm = new LlmClient({
    apiKeys: apiKeysFrom(config),
    requestsPerMinute: config.LLM_REQUESTS_PER_MINUTE,
    timeoutMs: config.LLM_TIMEOUT_MS,
    freeTier: config.LLM_FREE_TIER === 'true',
  });
  const models = {
    classify: parseModelList(config.LLM_CLASSIFY_MODELS),
    extract: parseModelList(config.LLM_EXTRACT_MODELS),
  };
  const tolerances = {
    areaFraction: config.DEDUP_AREA_TOLERANCE_PERCENT / 100,
    areaMinimumM2: config.DEDUP_AREA_TOLERANCE_M2,
    priceFraction: config.DEDUP_PRICE_TOLERANCE_PERCENT / 100,
  };
  const media = {
    mediaDir: config.MEDIA_DIR,
    visionModels: parseModelList(config.LLM_VISION_MODELS),
    pdfMaxPages: config.PDF_MAX_PAGES,
    pdfMinTextChars: config.PDF_MIN_TEXT_CHARS,
    captionWindowSeconds: config.CAPTION_WINDOW_SECONDS,
  };
  const deps: PipelineDeps = { database, boss, llm, models, logger, tolerances, media };

  /** Runs one job; expected failures are logged briefly and retried by pg-boss. */
  const handle = <Q extends QueueName>(
    queue: Q,
    run: (
      data: ReturnType<typeof parsePayload<Q>>,
      job: { lastAttempt: boolean },
    ) => Promise<unknown>,
  ) =>
    boss.work(queue, { batchSize: 1, localConcurrency: 2 }, async ([job]) => {
      if (!job) return;
      try {
        await run(parsePayload(queue, job.data), {
          lastAttempt: job.retryCount >= queueSettings[queue].retryLimit,
        });
      } catch (error) {
        if (error instanceof RetryableError)
          logger.warn({ queue, reason: error.message }, 'Job will be retried');
        else logger.error({ err: error, queue, jobId: job.id }, 'Job failed');
        throw error;
      }
    });

  await handle('preprocess', ({ messageId }) => preprocess(deps, messageId));

  // Step 8 (lifecycle): once a day, mark units nobody has posted for a while.
  await handle('lifecycle', async () => {
    const count = await markStale(database.db, config.STALE_AFTER_DAYS);
    logger.info({ count, days: config.STALE_AFTER_DAYS }, 'Marked units stale');
  });
  await boss.schedule('lifecycle', '17 3 * * *', {}, { tz: 'Africa/Cairo' });

  // Without a model API key, messages wait in the classify queue (kept 60
  // days) until a key is added and the worker restarts.
  if (llm.canUse(models.classify) && llm.canUse(models.extract)) {
    // Files: read the text in images, PDFs and spreadsheets first.
    await handle('transcribe', ({ messageId }, job) => transcribe(deps, messageId, job));
    await handle('classify', ({ messageId }) => classify(deps, messageId));
    await handle('extract', ({ messageId, intent }) => extract(deps, messageId, intent));
    logger.info(
      {
        vision: config.LLM_VISION_MODELS,
        classify: config.LLM_CLASSIFY_MODELS,
        extract: config.LLM_EXTRACT_MODELS,
      },
      'Pipeline ready',
    );
  } else {
    logger.warn(
      'No model API key set (GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY): messages are queued but not extracted',
    );
  }

  return {
    stop: () => boss.stop({ graceful: true, timeout: 30_000 }),
  };
});
