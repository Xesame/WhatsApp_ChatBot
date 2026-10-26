import { containsPersonalData } from './privacy.ts';
import { costOf, modelLabel, PROVIDERS, type ModelRef, type ProviderName } from './models.ts';
import { RateLimiter } from './rate-limit.ts';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type AttemptStatus = 'ok' | 'invalid' | 'error' | 'rate_limited' | 'timeout';

/** One request to one model. Every attempt becomes an `extraction_runs` row. */
export interface Attempt {
  provider: ProviderName;
  model: string;
  promptVersion: string;
  /** The request body as sent (no API key), for audit and the privacy test. */
  request: Record<string, unknown>;
  rawOutput: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  status: AttemptStatus;
  error: string | null;
}

export interface JsonCall<T> {
  promptVersion: string;
  messages: ChatMessage[];
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  /** Checks the model's JSON; returns an error message to send back, or the data. */
  validate: (data: unknown) => { ok: true; data: T } | { ok: false; error: string };
}

export interface LlmClientOptions {
  apiKeys: Partial<Record<ProviderName, string>>;
  requestsPerMinute: number;
  timeoutMs: number;
  /** Free-tier keys: record cost as 0. */
  freeTier: boolean;
  fetch?: typeof fetch;
  limiter?: RateLimiter;
  now?: () => number;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
    this.status = status;
  }
}

interface CompletionResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Calls chat models that return JSON matching a schema, trying each model in
 * the fallback list until one gives a valid answer.
 *
 * - Structured output (`response_format: json_schema, strict: true`) makes
 *   the model's answer follow the schema.
 * - If the answer still fails validation, the same model gets one retry
 *   with the error appended (build plan, section 7).
 * - Rate limits, timeouts, server errors and refusals move on to the next
 *   model.
 * - A request that still contains a phone number or e-mail is refused before
 *   it is sent: a last line of defence behind `scrubPersonalData`.
 */
export class LlmClient {
  private readonly options: LlmClientOptions;
  private readonly limiter: RateLimiter;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;

  constructor(options: LlmClientOptions) {
    this.options = options;
    this.limiter = options.limiter ?? new RateLimiter(options.requestsPerMinute);
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  /** True if at least one model in the list has an API key configured. */
  canUse(models: ModelRef[]): boolean {
    return models.some((m) => Boolean(this.options.apiKeys[m.provider]));
  }

  async callJson<T>(
    models: ModelRef[],
    call: JsonCall<T>,
  ): Promise<{ data: T | null; attempts: Attempt[] }> {
    for (const message of call.messages) {
      if (containsPersonalData(message.content)) {
        throw new Error('Refusing to send personal data to a model; scrub the text first');
      }
    }
    const attempts: Attempt[] = [];
    for (const ref of models) {
      if (!this.options.apiKeys[ref.provider]) continue;
      let messages = call.messages;
      for (let retry = 0; retry < 2; retry++) {
        const attempt = await this.request(ref, call, messages);
        attempts.push(attempt);
        if (attempt.status !== 'ok' && attempt.status !== 'invalid') break; // next model
        const checked = this.check(attempt, call);
        if (checked.ok) return { data: checked.data, attempts };
        attempt.status = 'invalid';
        attempt.error = checked.error;
        messages = [
          ...call.messages,
          { role: 'assistant', content: attempt.rawOutput ?? '' },
          {
            role: 'user',
            content: `Your answer was invalid: ${checked.error}. Reply again with corrected JSON only.`,
          },
        ];
      }
    }
    return { data: null, attempts };
  }

  private check<T>(
    attempt: Attempt,
    call: JsonCall<T>,
  ): { ok: true; data: T } | { ok: false; error: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(attempt.rawOutput ?? ''));
    } catch {
      return { ok: false, error: 'not valid JSON' };
    }
    return call.validate(parsed);
  }

  private async request(
    ref: ModelRef,
    call: JsonCall<unknown>,
    messages: ChatMessage[],
  ): Promise<Attempt> {
    const provider = PROVIDERS[ref.provider];
    const extraBody = 'extraBody' in provider ? provider.extraBody : {};
    const body = {
      ...extraBody,
      model: ref.model,
      messages,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: { name: call.schemaName, strict: true, schema: call.jsonSchema },
      },
    };
    const base: Omit<Attempt, 'status' | 'error' | 'latencyMs' | 'rawOutput'> = {
      provider: ref.provider,
      model: ref.model,
      promptVersion: call.promptVersion,
      request: body,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    };

    await this.limiter.acquire(modelLabel(ref));
    const started = this.now();
    try {
      const response = await this.fetchFn(`${PROVIDERS[ref.provider].baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKeys[ref.provider] ?? ''}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      const text = await response.text();
      if (!response.ok) throw new HttpError(response.status, text);
      const json = JSON.parse(text) as CompletionResponse;
      const inputTokens = json.usage?.prompt_tokens ?? null;
      const outputTokens = json.usage?.completion_tokens ?? null;
      return {
        ...base,
        rawOutput: json.choices?.[0]?.message?.content ?? null,
        inputTokens,
        outputTokens,
        costUsd: costOf(ref, inputTokens ?? 0, outputTokens ?? 0, this.options.freeTier),
        latencyMs: this.now() - started,
        status: 'ok',
        error: null,
      };
    } catch (error) {
      const latencyMs = this.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      const status: AttemptStatus =
        error instanceof HttpError && error.status === 429
          ? 'rate_limited'
          : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
            ? 'timeout'
            : 'error';
      return { ...base, rawOutput: null, latencyMs, status, error: message };
    }
  }
}

/** Some models wrap JSON in ```json fences even when asked not to. */
function stripFences(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return fenced?.[1] ?? text;
}
