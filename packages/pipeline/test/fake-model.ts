import { LlmClient } from '@reb/llm';

/** A stand-in for the model API: answers by schema name with canned replies. */
export function fakeModel(replies: {
  classification?: unknown;
  extraction?: unknown;
  /** Plain-text answer to image transcription requests. */
  transcription?: string;
  fail?: boolean;
  failVision?: boolean;
}) {
  const bodies: string[] = [];
  const fetchFn = ((_url: string, init: RequestInit) => {
    const body = init.body as string;
    bodies.push(body);
    const parsed = JSON.parse(body) as { response_format?: { json_schema: { name: string } } };
    const isVision = !parsed.response_format;
    if (replies.fail || (isVision && replies.failVision)) {
      return Promise.resolve(new Response('{}', { status: 503 }));
    }
    const name = parsed.response_format?.json_schema.name;
    const content = isVision
      ? (replies.transcription ?? '')
      : JSON.stringify(name === 'classification' ? replies.classification : replies.extraction);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 500, completion_tokens: 200 },
        }),
      ),
    );
  }) as unknown as typeof fetch;
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
