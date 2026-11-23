import { containsPersonalData } from './privacy.ts';
import {
  costOf,
  modelLabel,
  outputSettings,
  PROVIDERS,
  type ModelRef,
  type ProviderName,
} from './models.ts';
import { RateLimiter } from './rate-limit.ts';
import {
  canSearch,
  geminiSearchRequest,
  groqSearchRequest,
  parseJsonAnswer,
  readGeminiSearch,
  readGroqSearch,
  type SearchProvider,
  type SearchReading,
  type SearchSource,
} from './search.ts';

/** One part of a message: text, or an image (Phase 3, vision). */
export type ContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

/** The text parts of a message (images have none). */
const textOf = (content: ChatMessage['content']) =>
  typeof content === 'string'
    ? content
    : content.map((p) => (p.type === 'text' ? p.text : '')).join('\n');

/**
 * The request as stored in `extraction_runs`: images are replaced by a short
 * note, so a 2 MB flyer isn't copied into the database with every call.
 */
function forRecord(body: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(body, (key, value: unknown) =>
      key === 'url' && typeof value === 'string' && value.startsWith('data:')
        ? `${value.slice(0, value.indexOf(',') + 1)}[${Math.round((value.length * 3) / 4 / 1024)} KB image omitted]`
        : value,
    ),
  ) as Record<string, unknown>;
}

export interface TextCall {
  promptVersion: string;
  messages: ChatMessage[];
  /** Output limit for providers that need one (default DEFAULT_MAX_OUTPUT_TOKENS). */
  maxOutputTokens?: number;
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
  /** Output limit for providers that need one (default DEFAULT_MAX_OUTPUT_TOKENS). */
  maxOutputTokens?: number;
  /** Checks the model's JSON; returns an error message to send back, or the data. */
  validate: (data: unknown) => { ok: true; data: T } | { ok: false; error: string };
}

/** A question answered from a live web search (no JSON mode: the prompt asks for JSON). */
export interface SearchCall<T> {
  promptVersion: string;
  messages: ChatMessage[];
  /** Output limit for providers that need one (default DEFAULT_MAX_OUTPUT_TOKENS). */
  maxOutputTokens?: number;
  /** Checks the model's JSON; returns the data or what is wrong with it. */
  validate: (data: unknown) => { ok: true; data: T } | { ok: false; error: string };
}

export interface SearchResult<T> {
  /** The answer, or null when no model searched and answered. */
  data: T | null;
  /** Which model searched for the answer (null without an answer). */
  searched: { provider: SearchProvider; model: string } | null;
  /** Up to 3 pages the search used. */
  sources: SearchSource[];
  attempts: Attempt[];
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
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
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
    this.refusePersonalData(call.messages);
    const format = {
      type: 'json_schema',
      json_schema: { name: call.schemaName, strict: true, schema: call.jsonSchema },
    };
    const attempts: Attempt[] = [];
    for (const ref of models) {
      if (!this.options.apiKeys[ref.provider]) continue;
      let messages = call.messages;
      for (let retry = 0; retry < 2; retry++) {
        const attempt = await this.request(ref, call, messages, format);
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

  /**
   * Plain-text answer (used to transcribe images). Tries each model in
   * order until one returns non-empty text.
   */
  async callText(
    models: ModelRef[],
    call: TextCall,
  ): Promise<{ text: string | null; attempts: Attempt[] }> {
    this.refusePersonalData(call.messages);
    const attempts: Attempt[] = [];
    for (const ref of models) {
      if (!this.options.apiKeys[ref.provider]) continue;
      const attempt = await this.request(ref, call, call.messages, undefined);
      attempts.push(attempt);
      const text = attempt.rawOutput?.trim();
      if (attempt.status === 'ok' && text) return { text, attempts };
      if (attempt.status === 'ok') {
        attempt.status = 'invalid';
        attempt.error = 'empty answer';
      }
    }
    return { text: null, attempts };
  }

  /**
   * An answer from a live web search: each model in order is asked with its
   * provider's search tool switched on (Gemini: Google Search; Groq:
   * browser_search). An answer that shows no search was run, or is not the
   * JSON asked for, does not count and the next model is tried. Never falls
   * back to asking without search. Providers that cannot search, and models
   * without an API key, are skipped.
   */
  async callSearch<T>(models: ModelRef[], call: SearchCall<T>): Promise<SearchResult<T>> {
    this.refusePersonalData(call.messages);
    const attempts: Attempt[] = [];
    for (const ref of models) {
      if (!this.options.apiKeys[ref.provider] || !canSearch(ref.provider)) continue;
      const { attempt, reading } = await this.search(ref, ref.provider, call);
      attempts.push(attempt);
      if (attempt.status !== 'ok' || !reading) continue;
      if (!reading.searched) {
        attempt.status = 'invalid';
        attempt.error = 'no web search';
        continue;
      }
      const parsed = parseJsonAnswer(reading.text ?? '');
      const checked =
        parsed === undefined
          ? { ok: false as const, error: 'not valid JSON' }
          : call.validate(parsed);
      if (!checked.ok) {
        attempt.status = 'invalid';
        attempt.error = checked.error;
        continue;
      }
      return {
        data: checked.data,
        searched: { provider: ref.provider, model: ref.model },
        sources: reading.sources,
        attempts,
      };
    }
    return { data: null, searched: null, sources: [], attempts };
  }

  private async search<T>(
    ref: ModelRef,
    provider: SearchProvider,
    call: SearchCall<T>,
  ): Promise<{ attempt: Attempt; reading: SearchReading | null }> {
    const key = this.options.apiKeys[provider] ?? '';
    if (provider === 'gemini') {
      const { url, body } = geminiSearchRequest(ref.model, call.messages);
      return this.exchange(ref, call.promptVersion, url, { 'x-goog-api-key': key }, body, (json) =>
        readGeminiSearch(json),
      );
    }
    return this.exchange(
      ref,
      call.promptVersion,
      `${PROVIDERS[provider].baseUrl}/chat/completions`,
      { authorization: `Bearer ${key}` },
      {
        ...groqSearchRequest(ref.model, call.messages),
        ...outputSettings(ref, call.maxOutputTokens),
      },
      (json) => readGroqSearch(json),
    );
  }

  /** Text parts must be scrubbed; images are sent as they are (approved by Hassan). */
  private refusePersonalData(messages: ChatMessage[]): void {
    for (const message of messages) {
      if (containsPersonalData(textOf(message.content))) {
        throw new Error('Refusing to send personal data to a model; scrub the text first');
      }
    }
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
    call: { promptVersion: string; maxOutputTokens?: number },
    messages: ChatMessage[],
    responseFormat: Record<string, unknown> | undefined,
  ): Promise<Attempt> {
    const provider = PROVIDERS[ref.provider];
    const extraBody = 'extraBody' in provider ? provider.extraBody : {};
    const body = {
      ...extraBody,
      model: ref.model,
      messages,
      temperature: 0,
      ...outputSettings(ref, call.maxOutputTokens),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };
    const { attempt } = await this.exchange(
      ref,
      call.promptVersion,
      `${provider.baseUrl}/chat/completions`,
      { authorization: `Bearer ${this.options.apiKeys[ref.provider] ?? ''}` },
      body,
      (json) => {
        const response = json as CompletionResponse;
        return {
          text: response.choices?.[0]?.message?.content ?? null,
          cutOff: response.choices?.[0]?.finish_reason === 'length',
          inputTokens: response.usage?.prompt_tokens ?? null,
          outputTokens: response.usage?.completion_tokens ?? null,
        };
      },
    );
    return attempt;
  }

  /**
   * One HTTP request to one model, waiting for a free slot under the rate
   * limit first. Rate limits, timeouts and errors become the attempt's status.
   */
  private async exchange<R extends ReadResult>(
    ref: ModelRef,
    promptVersion: string,
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    read: (json: unknown) => R,
  ): Promise<{ attempt: Attempt; reading: R | null }> {
    const base: Omit<Attempt, 'status' | 'error' | 'latencyMs' | 'rawOutput'> = {
      provider: ref.provider,
      model: ref.model,
      promptVersion,
      request: forRecord(body),
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    };

    await this.limiter.acquire(modelLabel(ref));
    const started = this.now();
    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      const text = await response.text();
      if (!response.ok) throw new HttpError(response.status, text);
      const reading = read(JSON.parse(text));
      const { inputTokens, outputTokens } = reading;
      const done = {
        ...base,
        rawOutput: reading.text,
        inputTokens,
        outputTokens,
        costUsd: costOf(ref, inputTokens ?? 0, outputTokens ?? 0, this.options.freeTier),
        latencyMs: this.now() - started,
      };
      // An answer stopped at the output limit is incomplete (a long price
      // list loses its last units, though the JSON may still parse): it is
      // a failed attempt, like an HTTP error, and the next model is tried.
      if (reading.cutOff) {
        return {
          attempt: { ...done, status: 'error', error: 'answer cut off (output limit)' },
          reading: null,
        };
      }
      return { attempt: { ...done, status: 'ok', error: null }, reading };
    } catch (error) {
      const latencyMs = this.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      const status: AttemptStatus =
        error instanceof HttpError && error.status === 429
          ? 'rate_limited'
          : error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
            ? 'timeout'
            : 'error';
      return {
        attempt: { ...base, rawOutput: null, latencyMs, status, error: message },
        reading: null,
      };
    }
  }
}

interface ReadResult {
  text: string | null;
  /** The answer stopped at the output limit. */
  cutOff?: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Some models wrap JSON in ```json fences even when asked not to. */
function stripFences(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return fenced?.[1] ?? text;
}
