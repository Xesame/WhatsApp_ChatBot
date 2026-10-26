import { apiKeysFrom, LlmClient, parseModelList } from '@reb/llm';
import { classify, extract, preprocess, RetryableError, type PipelineDeps } from '@reb/pipeline';
import { parsePayload, startQueue, type QueueName } from '@reb/queue';
import { runService } from '@reb/runtime';

// The worker runs the pipeline jobs. Logic lives in packages/pipeline; this
// file only connects queues to it.
//   preprocess → classify → extract
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
  const deps: PipelineDeps = { database, boss, llm, models, logger };

  /** Runs one job; expected failures are logged briefly and retried by pg-boss. */
  const handle = <Q extends QueueName>(
    queue: Q,
    run: (data: ReturnType<typeof parsePayload<Q>>) => Promise<unknown>,
  ) =>
    boss.work(queue, { batchSize: 1, localConcurrency: 2 }, async ([job]) => {
      if (!job) return;
      try {
        await run(parsePayload(queue, job.data));
      } catch (error) {
        if (error instanceof RetryableError)
          logger.warn({ queue, reason: error.message }, 'Job will be retried');
        else logger.error({ err: error, queue, jobId: job.id }, 'Job failed');
        throw error;
      }
    });

  await handle('preprocess', ({ messageId }) => preprocess(deps, messageId));

  // Without a model API key, messages wait in the classify queue (kept 60
  // days) until a key is added and the worker restarts.
  if (llm.canUse(models.classify) && llm.canUse(models.extract)) {
    await handle('classify', ({ messageId }) => classify(deps, messageId));
    await handle('extract', ({ messageId, intent }) => extract(deps, messageId, intent));
    logger.info(
      { classify: config.LLM_CLASSIFY_MODELS, extract: config.LLM_EXTRACT_MODELS },
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
