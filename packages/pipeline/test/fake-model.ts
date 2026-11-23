import { LlmClient } from '@reb/llm';

/** A stand-in for the model API: answers by schema name with canned replies. */
export function fakeModel(replies: {
  classification?: unknown;
  extraction?: unknown;
  /** Answer to name lookups (a web search: Gemini generateContent or Groq browser_search). */
  lookup?: unknown;
  /** How each search provider replies to a lookup (default: searched, with two sources). */
  geminiSearch?: 'searched' | 'no-search' | 'rate-limited';
  groqSearch?: 'searched' | 'no-search' | 'rate-limited';
  /** Plain-text answer to image transcription requests. */
  transcription?: string;
  fail?: boolean;
  failVision?: boolean;
}) {
  const bodies: string[] = [];
  const fetchFn = ((url: string, init: RequestInit) => {
    const body = init.body as string;
    bodies.push(body);
    const parsed = JSON.parse(body) as {
      response_format?: { json_schema: { name: string } };
      tools?: unknown[];
    };
    if (replies.fail) return Promise.resolve(new Response('{}', { status: 503 }));
    if (url.endsWith(':generateContent')) return Promise.resolve(geminiReply());
    if (parsed.tools) return Promise.resolve(groqReply());
    const isVision = !parsed.response_format;
    if (isVision && replies.failVision) {
      return Promise.resolve(new Response('{}', { status: 503 }));
    }
    const name = parsed.response_format?.json_schema.name;
    const content = isVision
      ? (replies.transcription ?? '')
      : JSON.stringify(
          name === 'classification'
            ? replies.classification
            : name === 'lookup'
              ? replies.lookup
              : replies.extraction,
        );
    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 500, completion_tokens: 200 },
        }),
      ),
    );
  }) as unknown as typeof fetch;

  const answer = JSON.stringify(replies.lookup);
  // Gemini often wraps its JSON in a code fence when JSON mode is off.
  const fenced = '```json\n' + answer + '\n```';
  const geminiReply = () =>
    replies.geminiSearch === 'rate-limited'
      ? new Response('{}', { status: 429 })
      : new Response(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: fenced }] },
                ...(replies.geminiSearch === 'no-search'
                  ? {}
                  : {
                      groundingMetadata: {
                        webSearchQueries: ['project developer'],
                        groundingChunks: [
                          {
                            web: {
                              uri: 'https://vertexaisearch.cloud.google.com/r/1',
                              title: 'a.com',
                            },
                          },
                          {
                            web: {
                              uri: 'https://vertexaisearch.cloud.google.com/r/2',
                              title: 'b.eg',
                            },
                          },
                        ],
                      },
                    }),
              },
            ],
          }),
        );
  const groqReply = () =>
    replies.groqSearch === 'rate-limited'
      ? new Response('{}', { status: 429 })
      : new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: answer,
                  executed_tools:
                    replies.groqSearch === 'no-search'
                      ? []
                      : [
                          {
                            type: 'browser_search',
                            output: 'found',
                            search_results: {
                              results: [{ url: 'https://news.example.com/p', title: 'News' }],
                            },
                          },
                        ],
                },
              },
            ],
          }),
        );
  return {
    bodies,
    llm: new LlmClient({
      apiKeys: { cerebras: 'test', gemini: 'test', groq: 'test', openrouter: 'test' },
      requestsPerMinute: 1000,
      timeoutMs: 1000,
      freeTier: true,
      fetch: fetchFn,
    }),
  };
}
