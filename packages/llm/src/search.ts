/**
 * Questions answered from a live web search (the name lookups).
 *
 * Two providers can search for us, each in its own way:
 *
 * - **Gemini with Google Search grounding.** The OpenAI-compatible endpoint
 *   cannot turn the search tool on, so we call Gemini's own
 *   `generateContent` with `tools: [{ google_search: {} }]`. Proof that it
 *   searched: `groundingMetadata` with at least one search query or result.
 *   The result links are Google redirect links; their `title` is the site.
 * - **Groq `openai/gpt-oss-120b` with `browser_search`.** OpenAI-compatible
 *   chat completions with `tools: [{ type: 'browser_search' }]`. Proof that
 *   it searched: `message.executed_tools` lists a browser search.
 *
 * An answer without that proof came from the model's memory, so it is not
 * used. Search answers cannot use JSON mode, so the prompt asks for JSON
 * and `parseJsonAnswer` reads it defensively.
 */

import type { ChatMessage } from './client.ts';
import type { ProviderName } from './models.ts';

/** Providers that can run a web search for us. */
export const SEARCH_PROVIDERS = ['gemini', 'groq'] as const satisfies readonly ProviderName[];
export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

export const canSearch = (provider: ProviderName): provider is SearchProvider =>
  (SEARCH_PROVIDERS as readonly string[]).includes(provider);

/** A web page the search used. `title` is null when the provider gave none. */
export interface SearchSource {
  url: string;
  title: string | null;
}

/** At most this many sources are kept per answer. */
export const MAX_SOURCES = 3;

/** What one search response says: the answer text, whether it searched, and its sources. */
export interface SearchReading {
  text: string | null;
  searched: boolean;
  sources: SearchSource[];
  inputTokens: number | null;
  outputTokens: number | null;
}

const GEMINI_NATIVE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const textOf = (content: ChatMessage['content']) =>
  typeof content === 'string'
    ? content
    : content.map((p) => (p.type === 'text' ? p.text : '')).join('\n');

/** Gemini's own request format, with Google Search switched on. */
export function geminiSearchRequest(
  model: string,
  messages: ChatMessage[],
): { url: string; body: Record<string, unknown> } {
  const system = messages.filter((m) => m.role === 'system').map((m) => textOf(m.content));
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: textOf(m.content) }],
    }));
  return {
    url: `${GEMINI_NATIVE_URL}/models/${encodeURIComponent(model)}:generateContent`,
    body: {
      ...(system.length > 0
        ? { systemInstruction: { parts: [{ text: system.join('\n\n') }] } }
        : {}),
      contents,
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0 },
    },
  };
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: { web?: { uri?: string; title?: string } }[];
    };
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export function readGeminiSearch(json: unknown): SearchReading {
  const response = json as GeminiResponse;
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('') || null;
  const grounding = candidate?.groundingMetadata;
  const chunks = grounding?.groundingChunks ?? [];
  const searched = (grounding?.webSearchQueries?.length ?? 0) > 0 || chunks.length > 0;
  const sources = chunks.flatMap((c) =>
    c.web?.uri ? [{ url: c.web.uri, title: c.web.title?.trim() || null }] : [],
  );
  return {
    text,
    searched,
    sources: keepSources(sources),
    inputTokens: response.usageMetadata?.promptTokenCount ?? null,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
  };
}

/** Groq's chat completions request with its built-in browser search. */
export function groqSearchRequest(model: string, messages: ChatMessage[]): Record<string, unknown> {
  return { model, messages, temperature: 0, tools: [{ type: 'browser_search' }] };
}

interface GroqTool {
  type?: string;
  output?: unknown;
  search_results?: { results?: { url?: string; title?: string }[] };
}

interface GroqResponse {
  choices?: {
    message?: {
      content?: string | null;
      executed_tools?: GroqTool[];
      annotations?: { url_citation?: { url?: string; title?: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Web addresses in free text; trailing punctuation and brackets are not part of them. */
const URL_PATTERN = /https?:\/\/[^\s"'<>【】()[\]{}]+/g;

export function readGroqSearch(json: unknown): SearchReading {
  const response = json as GroqResponse;
  const message = response.choices?.[0]?.message;
  const searches = (message?.executed_tools ?? []).filter((t) => (t.type ?? '').includes('search'));
  // Best first: the search results Groq lists, then citations, then any
  // address written in the tool output. Never an address we made up.
  const listed = searches.flatMap((t) =>
    (t.search_results?.results ?? []).flatMap((r) =>
      r.url ? [{ url: r.url, title: r.title?.trim() || null }] : [],
    ),
  );
  const cited = (message?.annotations ?? []).flatMap((a) =>
    a.url_citation?.url ? [{ url: a.url_citation.url, title: a.url_citation.title || null }] : [],
  );
  const written = searches.flatMap((t) =>
    typeof t.output === 'string'
      ? [...t.output.matchAll(URL_PATTERN)].map((m) => ({
          url: m[0].replace(/[.,;:!?]+$/, ''),
          title: null,
        }))
      : [],
  );
  return {
    text: message?.content ?? null,
    searched: searches.length > 0,
    sources: keepSources(listed.length > 0 ? listed : cited.length > 0 ? cited : written),
    inputTokens: response.usage?.prompt_tokens ?? null,
    outputTokens: response.usage?.completion_tokens ?? null,
  };
}

/** Web links only, each once, at most MAX_SOURCES. */
function keepSources(sources: SearchSource[]): SearchSource[] {
  const seen = new Set<string>();
  const kept: SearchSource[] = [];
  for (const source of sources) {
    if (!/^https?:\/\//.test(source.url) || seen.has(source.url)) continue;
    seen.add(source.url);
    kept.push(source);
    if (kept.length === MAX_SOURCES) break;
  }
  return kept;
}

/**
 * The JSON object in a model's text answer: code fences are removed and the
 * first complete `{...}` is read (braces inside strings are skipped).
 * Undefined when there is none.
 */
export function parseJsonAnswer(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, '');
  for (let start = unfenced.indexOf('{'); start !== -1; start = unfenced.indexOf('{', start + 1)) {
    const end = endOfObject(unfenced, start);
    if (end === -1) continue;
    try {
      return JSON.parse(unfenced.slice(start, end + 1)) as unknown;
    } catch {
      // not JSON after all; try the next "{"
    }
  }
  return undefined;
}

/** Index of the "}" that closes the "{" at `start`, or -1. */
function endOfObject(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}
