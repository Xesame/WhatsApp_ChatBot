import { describe, expect, it } from 'vitest';
import {
  containsPersonalData,
  LlmClient,
  parseModelList,
  RateLimiter,
  scrubPersonalData,
  type JsonCall,
} from '../src/index.ts';

describe('scrubPersonalData', () => {
  it.each<[string, string]>([
    ['للتواصل 01001234567', 'للتواصل [phone]'],
    ['call 0100 123 4567 now', 'call [phone] now'],
    ['واتس ٠١٠٠١٢٣٤٥٦٧', 'واتس [phone]'],
    ['+20 100 123 4567', '[phone]'],
    ['00201001234567', '[phone]'],
    ['010-0123-4567', '[phone]'],
    ['office 02-2345-6789', 'office [phone]'],
    ['mail sales@broker.com', 'mail [email]'],
    ['@201001234567 شوف ده', '[mention] شوف ده'],
  ])('%s', (input, expected) => {
    expect(scrubPersonalData(input)).toBe(expected);
  });

  it('leaves prices, areas, years and percentages alone', () => {
    const text = 'شقة 150 م بسعر 6,500,000 او 6.5 مليون مقدم 10% استلام 2028 تقسيط 96 شهر 1-5';
    expect(scrubPersonalData(text)).toBe(text);
    expect(containsPersonalData(text)).toBe(false);
  });

  it('keeps Arabic digits elsewhere in the text', () => {
    expect(scrubPersonalData('سعر ٦٫٥ مليون - ٠١٠٠١٢٣٤٥٦٧')).toBe('سعر ٦٫٥ مليون - [phone]');
  });
});

describe('parseModelList', () => {
  it('reads provider:model lists, including model names with slashes', () => {
    expect(parseModelList('cerebras:gpt-oss-120b, openrouter:google/gemma-4-27b')).toEqual([
      { provider: 'cerebras', model: 'gpt-oss-120b' },
      { provider: 'openrouter', model: 'google/gemma-4-27b' },
    ]);
  });

  it('rejects unknown providers', () => {
    expect(() => parseModelList('acme:model')).toThrow(/provider:model/);
  });
});

describe('RateLimiter', () => {
  it('lets N calls through per minute per model, then waits', async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = new RateLimiter(2, {
      now: () => now,
      sleep: (ms) => {
        waits.push(ms);
        now += ms;
        return Promise.resolve();
      },
    });
    await limiter.acquire('a');
    await limiter.acquire('a');
    await limiter.acquire('b'); // other model: no wait
    expect(waits).toEqual([]);
    await limiter.acquire('a');
    expect(waits).toEqual([60_050]);
  });
});

// --- LlmClient with a fake HTTP API ---

type Reply = { status: number; body: unknown } | 'timeout';

function fakeFetch(replies: Reply[]) {
  const requests: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  const fetchFn = ((url: string, init: RequestInit) => {
    requests.push({
      url,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
      auth: new Headers(init.headers).get('authorization') ?? '',
    });
    const reply = replies.shift();
    if (!reply || reply === 'timeout') {
      throw Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      });
    }
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as unknown as typeof fetch;
  return { fetchFn, requests };
}

const completion = (content: string) => ({
  status: 200,
  body: {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  },
});

const call: JsonCall<{ intent: string }> = {
  promptVersion: 'test-1',
  messages: [{ role: 'user', content: 'شقة للبيع 6 مليون' }],
  schemaName: 'classification',
  jsonSchema: { type: 'object' },
  validate: (data) =>
    typeof data === 'object' && data !== null && 'intent' in data && typeof data.intent === 'string'
      ? { ok: true, data: { intent: data.intent } }
      : { ok: false, error: 'missing "intent"' },
};

const models = parseModelList('cerebras:gpt-oss-120b,cerebras:qwen-3.8-27b');
const client = (fetchFn: typeof fetch, keys = { cerebras: 'test-key' }) =>
  new LlmClient({
    apiKeys: keys,
    requestsPerMinute: 100,
    timeoutMs: 1000,
    freeTier: true,
    fetch: fetchFn,
  });

describe('LlmClient', () => {
  it('sends a strict json_schema request and returns the validated data', async () => {
    const { fetchFn, requests } = fakeFetch([completion('{"intent":"listing"}')]);
    const result = await client(fetchFn).callJson(models, call);
    expect(result.data).toEqual({ intent: 'listing' });
    expect(requests[0]?.url).toBe('https://api.cerebras.ai/v1/chat/completions');
    expect(requests[0]?.auth).toBe('Bearer test-key');
    expect(requests[0]?.body).toMatchObject({
      model: 'gpt-oss-120b',
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'classification', strict: true },
      },
    });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      status: 'ok',
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0,
      promptVersion: 'test-1',
    });
    expect(JSON.stringify(result.attempts[0]?.request)).not.toContain('test-key');
  });

  it('moves to the next model when rate limited or timed out', async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 429, body: { error: 'too many requests' } },
      completion('{"intent":"sold"}'),
    ]);
    const result = await client(fetchFn).callJson(models, call);
    expect(result.data).toEqual({ intent: 'sold' });
    expect(requests.map((r) => r.body.model)).toEqual(['gpt-oss-120b', 'qwen-3.8-27b']);
    expect(result.attempts.map((a) => a.status)).toEqual(['rate_limited', 'ok']);

    const timeouts = fakeFetch(['timeout', completion('{"intent":"listing"}')]);
    const second = await client(timeouts.fetchFn).callJson(models, call);
    expect(second.attempts.map((a) => a.status)).toEqual(['timeout', 'ok']);
  });

  it('retries the same model once with the validation error, then moves on', async () => {
    const { fetchFn, requests } = fakeFetch([
      completion('{"wrong":true}'),
      completion('```json\n{"intent":"listing"}\n```'),
    ]);
    const result = await client(fetchFn).callJson(models, call);
    expect(result.data).toEqual({ intent: 'listing' });
    expect(result.attempts.map((a) => [a.model, a.status])).toEqual([
      ['gpt-oss-120b', 'invalid'],
      ['gpt-oss-120b', 'ok'],
    ]);
    const retryMessages = requests[1]?.body.messages as { content: string }[];
    expect(retryMessages.at(-1)?.content).toContain('missing "intent"');
  });

  it('returns null data when every model fails', async () => {
    const { fetchFn } = fakeFetch([
      completion('not json'),
      completion('still not json'),
      { status: 500, body: {} },
    ]);
    const result = await client(fetchFn).callJson(models, call);
    expect(result.data).toBeNull();
    expect(result.attempts.map((a) => a.status)).toEqual(['invalid', 'invalid', 'error']);
  });

  it('skips models whose provider has no API key', async () => {
    const { fetchFn } = fakeFetch([]);
    const c = client(fetchFn, {} as { cerebras: string });
    expect(c.canUse(models)).toBe(false);
    expect(await c.callJson(models, call)).toEqual({ data: null, attempts: [] });
  });

  it('refuses to send a phone number', async () => {
    const { fetchFn, requests } = fakeFetch([completion('{"intent":"listing"}')]);
    await expect(
      client(fetchFn).callJson(models, {
        ...call,
        messages: [{ role: 'user', content: 'كلمني 01001234567' }],
      }),
    ).rejects.toThrow(/personal data/);
    expect(requests).toEqual([]);
  });
});
