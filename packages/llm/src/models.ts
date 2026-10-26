/**
 * Providers and models. Every provider here speaks the OpenAI chat
 * completions format, so switching models is a settings change.
 *
 * Models are configured as "provider:model" lists in the environment, in
 * fallback order, e.g. LLM_EXTRACT_MODELS=cerebras:gpt-oss-120b,cerebras:qwen-3.8-27b
 */

export const PROVIDERS = {
  cerebras: { baseUrl: 'https://api.cerebras.ai/v1', keyVariable: 'CEREBRAS_API_KEY' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyVariable: 'OPENROUTER_API_KEY' },
} as const;

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
