/**
 * Providers and models. Every provider here speaks the OpenAI chat
 * completions format, so switching models is a settings change.
 *
 * Models are configured as "provider:model" lists in the environment, in
 * fallback order, e.g.
 * LLM_EXTRACT_MODELS=gemini:gemini-flash-latest,groq:openai/gpt-oss-120b,openrouter:openrouter/free
 *
 * Adding a provider = one entry here + its API key variable in
 * packages/config/src/env.ts.
 */

interface Provider {
  baseUrl: string;
  keyVariable: string;
  /** Extra request fields this provider needs. */
  extraBody?: Record<string, unknown>;
}

export const PROVIDERS = {
  // Google AI Studio key. OpenAI-compatible endpoint of the Gemini API.
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyVariable: 'GEMINI_API_KEY',
  },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', keyVariable: 'GROQ_API_KEY' },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    keyVariable: 'OPENROUTER_API_KEY',
    // Only route to models that honour response_format; some models
    // otherwise ignore the JSON schema silently.
    extraBody: { provider: { require_parameters: true } },
  },
  // Paid since late October 2026; kept so it can be switched back on.
  cerebras: { baseUrl: 'https://api.cerebras.ai/v1', keyVariable: 'CEREBRAS_API_KEY' },
} as const satisfies Record<string, Provider>;

export type ProviderName = keyof typeof PROVIDERS;

export interface ModelRef {
  provider: ProviderName;
  model: string;
}

export const modelLabel = (ref: ModelRef) => `${ref.provider}:${ref.model}`;

/** "cerebras:gpt-oss-120b,openrouter:google/gemma-4-27b" → model refs. */
export function parseModelList(list: string): ModelRef[] {
  return list
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.indexOf(':');
      const provider = entry.slice(0, at);
      const model = entry.slice(at + 1);
      if (at < 1 || !model || !(provider in PROVIDERS)) {
        throw new Error(
          `Bad model "${entry}": use provider:model with provider one of ${Object.keys(PROVIDERS).join(', ')}`,
        );
      }
      return { provider: provider as ProviderName, model };
    });
}

/**
 * USD per million tokens, for the cost column of `extraction_runs`. Free
 * tiers cost nothing; add a model here when moving to a paid plan, using
 * the provider's pricing page. Unknown models record cost as null.
 */
export const PRICES_USD_PER_MILLION: Record<string, { input: number; output: number }> = {};

export function costOf(
  ref: ModelRef,
  inputTokens: number,
  outputTokens: number,
  freeTier: boolean,
): number | null {
  if (freeTier) return 0;
  const price = PRICES_USD_PER_MILLION[modelLabel(ref)];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/**
 * Collects each provider's API key from settings, using the variable names
 * in PROVIDERS. Missing or empty keys are left out, so those models are skipped.
 */
export function apiKeysFrom(
  settings: Record<string, unknown>,
): Partial<Record<ProviderName, string>> {
  const keys: Partial<Record<ProviderName, string>> = {};
  for (const [name, provider] of Object.entries(PROVIDERS) as [
    ProviderName,
    (typeof PROVIDERS)[ProviderName],
  ][]) {
    const value = settings[provider.keyVariable];
    if (typeof value === 'string' && value.length > 0) keys[name] = value;
  }
  return keys;
}
