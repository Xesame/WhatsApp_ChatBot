import { describe, expect, it } from 'vitest';
import {
  LlmClient,
  parseJsonAnswer,
  parseModelList,
  type ChatMessage,
  type SearchCall,
} from '../src/index.ts';

// Name lookups through a live web search: Gemini with Google Search first,
// Groq's browser_search second. No real calls: a fake HTTP API answers.

type Reply = { status: number; body: unknown } | 'timeout';

function fakeFetch(replies: Reply[]) {
  const requests: { url: string; body: Record<string, unknown>; raw: string; headers: Headers }[] =
    [];
  const fetchFn = ((url: string, init: RequestInit) => {
    const raw = init.body as string;
    requests.push({
      url,
      raw,
      body: JSON.parse(raw) as Record<string, unknown>,
      headers: new Headers(init.headers),
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

const ANSWER = '{"known": true, "developer": "Some Developer", "city": "New Cairo"}';

const geminiGrounded = (text: string, chunks = 2) => ({
  status: 200,
  body: {
    candidates: [
      {
        content: { parts: [{ text }] },
        groundingMetadata: {
          webSearchQueries: ['Lumia Lagoons developer'],
          groundingChunks: Array.from({ length: chunks }, (_, i) => ({
            web: {
              uri: `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${i}`,
              title: `site${i}.com`,
            },
          })),
        },
      },
    ],
    usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
  },
});

const geminiUngrounded = (text: string) => ({
  status: 200,
  body: { candidates: [{ content: { parts: [{ text }] } }] },
});

const groqAnswer = (content: string, executed: unknown[] | undefined) => ({
  status: 200,
  body: {
    choices: [{ message: { content, ...(executed ? { executed_tools: executed } : {}) } }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  },
});

const groqSearch = (results: { url: string; title: string }[]) => ({
  index: 0,
  type: 'browser_search',
  arguments: '{"query":"Lumia Lagoons"}',
  output: results.map((r) => `${r.title} ${r.url}`).join('\n'),
  search_results: { results: results.map((r) => ({ ...r, content: 'text' })) },
});

const messages: ChatMessage[] = [
  { role: 'system', content: 'Search the web for this project.' },
  { role: 'user', content: 'PROJECT: Lumia Lagoons' },
];

const call: SearchCall<{ known: boolean }> = {
  promptVersion: 'lookup-test',
  messages,
  validate: (data) =>
    typeof data === 'object' && data !== null && 'known' in data && typeof data.known === 'boolean'
      ? { ok: true, data: data as { known: boolean } }
      : { ok: false, error: 'missing "known"' },
};

const models = parseModelList('gemini:gemini-flash-latest,groq:openai/gpt-oss-120b');
const client = (fetchFn: typeof fetch, keys: Record<string, string> = { gemini: 'g', groq: 'q' }) =>
  new LlmClient({
    apiKeys: keys,
    requestsPerMinute: 100,
    timeoutMs: 1000,
    freeTier: true,
    fetch: fetchFn,
  });

describe('LlmClient.callSearch', () => {
  it('asks Gemini with Google Search and returns its answer with the sources', async () => {
    const { fetchFn, requests } = fakeFetch([geminiGrounded(ANSWER)]);
    const result = await client(fetchFn).callSearch(models, call);
    expect(result.data).toEqual({ known: true, developer: 'Some Developer', city: 'New Cairo' });
    expect(result.searched).toEqual({ provider: 'gemini', model: 'gemini-flash-latest' });
    expect(result.sources).toEqual([
      {
        url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/0',
        title: 'site0.com',
      },
      {
        url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/1',
        title: 'site1.com',
      },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
    );
    expect(requests[0]?.headers.get('x-goog-api-key')).toBe('g');
    expect(requests[0]?.body.tools).toEqual([{ google_search: {} }]);
    expect(result.attempts[0]).toMatchObject({ status: 'ok', inputTokens: 50, outputTokens: 20 });
  });

  it('moves on to Groq when Gemini stopped at its output limit', async () => {
    const cut = geminiGrounded(ANSWER);
    (cut.body.candidates[0] as Record<string, unknown>).finishReason = 'MAX_TOKENS';
    const { fetchFn, requests } = fakeFetch([
      cut,
      groqAnswer(ANSWER, [groqSearch([{ url: 'https://example.com', title: 'x' }])]),
    ]);
    const result = await client(fetchFn).callSearch(models, call);
    expect(result.searched?.provider).toBe('groq');
    expect(result.attempts[0]).toMatchObject({
      status: 'error',
      error: 'answer cut off (output limit)',
    });
    expect(requests[1]?.body).toMatchObject({
      max_completion_tokens: 16384,
      reasoning_effort: 'low',
    });
  });

  it('gives no answer when Groq stopped at its output limit', async () => {
    const cut = groqAnswer(ANSWER, [groqSearch([{ url: 'https://example.com', title: 'x' }])]);
    (cut.body.choices[0] as Record<string, unknown>).finish_reason = 'length';
    const { fetchFn } = fakeFetch([{ status: 429, body: {} }, cut]);
    const result = await client(fetchFn).callSearch(models, call);
    expect(result.data).toBeNull();
    expect(result.attempts[1]?.error).toBe('answer cut off (output limit)');
  });

  it('keeps at most 3 sources', async () => {
    const { fetchFn } = fakeFetch([geminiGrounded(ANSWER, 6)]);
    const result = await client(fetchFn).callSearch(models, call);
    expect(result.sources).toHaveLength(3);
  });

  it('moves on to Groq browser search when Gemini is rate limited', async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 429, body: { error: { message: 'quota' } } },
      groqAnswer(ANSWER, [
        groqSearch([
          { url: 'https://example.com/lumia', title: 'Lumia Lagoons' },
          { url: 'https://other.eg/p', title: 'Other' },
        ]),
      ]),
    ]);
    const result = await client(fetchFn).callSearch(models, call);
    expect(result.data).toEqual({ known: true, developer: 'Some Developer', city: 'New Cairo' });
    expect(result.searched).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b' });
    expect(result.sources).toEqual([
      { url: 'https://example.com/lumia', title: 'Lumia Lagoons' },
      { url: 'https://other.eg/p', title: 'Other' },
    ]);
    expect(result.attempts.map((a) => a.status)).toEqual(['rate_limited', 'ok']);
    expect(requests[1]?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(requests[1]?.body.tools).toEqual([{ type: 'browser_search' }]);
    expect(requests[1]?.body.model).toBe('openai/gpt-oss-120b');
    expect(requests[1]?.body.response_format).toBeUndefined();
  });

  it.each<[string, Reply]>([
    ['not available on the free tier', { status: 400, body: { error: 'tool not allowed' } }],
    ['forbidden', { status: 403, body: {} }],
    ['a server error', { status: 503, body: {} }],
    ['a timeout', 'timeout'],
  ])('moves on to Groq after %s', async (_label, reply) => {
    const { fetchFn } = fakeFetch([
      reply,
      groqAnswer(ANSWER, [groqSearch([{ url: 'https://example.com', title: 'x' }])]),
    ]);
    const result = await client(fetchFn).callSearch(models, call);
    expect(result.searched?.provider).toBe('groq');
  });

  it('does not trust a Gemini answer that did not search', async () => {
    const { fetchFn } = fakeFetch([
      geminiUngrounded(ANSWER),
      groqAnswer(ANSWER, [groqSearch([{ url: 'https://example.com', title: 'x' }])]),
    ]);
    const result = await client(fetchFn).callSearch(models, call);
    expect(result.searched?.provider).toBe('groq');
    expect(result.attempts[0]).toMatchObject({ status: 'invalid', error: 'no web search' });
  });

  it('gives no answer when Groq did not run a search either', async () => {
    const { fetchFn } = fakeFetch([geminiUngrounded(ANSWER), groqAnswer(ANSWER, [])]);
    const result = await client(fetchFn).callSearch(models, call);
    expect(result.data).toBeNull();
    expect(result.searched).toBeNull();
    expect(result.sources).toEqual([]);
    expect(result.attempts.map((a) => a.error)).toEqual(['no web search', 'no web search']);
    expect(result.unusable).toBeNull();
  });

  it('says which model searched when its answer could not be read', async () => {
    const { fetchFn } = fakeFetch([
      geminiGrounded('The developer is {"known": true, "developer": "X"'),
      { status: 429, body: {} },
    ]);
    const result = await client(fetchFn).callSearch(models, call);
    expect(result.data).toBeNull();
    expect(result.searched).toBeNull();
    expect(result.unusable).toEqual({ provider: 'gemini', model: 'gemini-flash-latest' });
    expect(result.attempts[0]).toMatchObject({ status: 'invalid', error: 'not valid JSON' });
  });

  it('remembers the last model whose search answer was unusable', async () => {
    const { fetchFn } = fakeFetch([
      { status: 503, body: {} },
      groqAnswer('{"wrong": 1}', [groqSearch([{ url: 'https://example.com', title: 'x' }])]),
    ]);
    const result = await client(fetchFn).callSearch(models, call);
    expect(result.data).toBeNull();
    expect(result.unusable).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b' });
  });

  it('gives no answer when both fail, and never asks without search', async () => {
    const { fetchFn, requests } = fakeFetch([
      { status: 429, body: {} },
      { status: 500, body: {} },
    ]);
    const result = await client(fetchFn).callSearch(models, call);
    expect(result.data).toBeNull();
    expect(requests).toHaveLength(2);
    expect(requests.every((r) => Array.isArray(r.body.tools))).toBe(true);
  });

  it('reads Groq sources from the tool output when there are no search results', async () => {
    const { fetchFn } = fakeFetch([
      { status: 429, body: {} },
      groqAnswer(ANSWER, [
        {
          type: 'browser_search',
          output: 'Result 【0†Lumia†https://news.example.com/a】 and https://b.example.org/x.',
        },
      ]),
    ]);
    const result = await client(fetchFn).callSearch(models, call);
    expect(result.sources).toEqual([
      { url: 'https://news.example.com/a', title: null },
      { url: 'https://b.example.org/x', title: null },
    ]);
  });

  it('skips models without a key and providers that cannot search', async () => {
    const { fetchFn, requests } = fakeFetch([
      groqAnswer(ANSWER, [groqSearch([{ url: 'https://example.com', title: 'x' }])]),
    ]);
    const result = await client(fetchFn, { groq: 'q', openrouter: 'o' }).callSearch(
      parseModelList(
        'openrouter:openrouter/free,gemini:gemini-flash-latest,groq:openai/gpt-oss-120b',
      ),
      call,
    );
    expect(requests).toHaveLength(1);
    expect(result.searched?.provider).toBe('groq');
  });

  it('refuses to send a phone number', async () => {
    const { fetchFn, requests } = fakeFetch([]);
    await expect(
      client(fetchFn).callSearch(models, {
        ...call,
        messages: [{ role: 'user', content: 'PROJECT: Lumia 01001234567' }],
      }),
    ).rejects.toThrow(/personal data/);
    expect(requests).toEqual([]);
  });
});

describe('parseJsonAnswer', () => {
  it('reads JSON inside code fences', () => {
    expect(parseJsonAnswer('```json\n{"known": false}\n```')).toEqual({ known: false });
  });

  it('takes the first JSON object out of surrounding text', () => {
    expect(
      parseJsonAnswer('Here is the answer: {"known": true, "city": "A {b}"} and more {"x": 1}'),
    ).toEqual({ known: true, city: 'A {b}' });
  });

  it('returns undefined when there is no JSON', () => {
    expect(parseJsonAnswer('I could not find it.')).toBeUndefined();
  });
});
