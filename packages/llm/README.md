# @reb/llm

The model client and the prompts.

| File                                        | What it does                                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/client.ts`                             | `LlmClient.callJson()`: sends a strict JSON-schema request, validates the answer, retries once with the error, and falls back to the next model      |
| `src/models.ts`                             | Providers (Gemini, Groq, OpenRouter, Cerebras: all OpenAI-compatible), the `provider:model` list format, `apiKeysFrom()`; prices for the cost column |
| `src/rate-limit.ts`                         | Keeps each model under its requests-per-minute limit by waiting, not failing                                                                         |
| `src/privacy.ts`                            | `scrubPersonalData()`: replaces phone numbers, e-mails and @mentions with `[phone]`, `[email]`, `[mention]`                                          |
| `prompts/classify.ts`, `prompts/extract.ts` | The prompts, each with a `VERSION` string                                                                                                            |

**Why it is designed this way**

- **Provider-independent.** Models are configured as `gemini:gemini-flash-latest,groq:openai/gpt-oss-120b,openrouter:openrouter/free` (fallback order). Models whose provider has no API key are skipped. Any provider that speaks the OpenAI chat format can be added in `models.ts`; switching is a settings change.
- **Fallback.** A rate limit (429), timeout, server error or refusal moves on to the next model. An answer that fails validation gets one retry on the same model with the validation error appended, then moves on.
- **Rate limits.** Free tiers allow roughly 10-30 requests a minute per model (`LLM_REQUESTS_PER_MINUTE`, default 10). The client waits for a free slot, so a busy hour slows down instead of failing; a daily-quota error moves on to the next provider. Classification and extraction use different Gemini models so they don't share one limit.
- **OpenRouter** requests include `provider.require_parameters: true`, so the free router only picks models that honour the JSON schema.
- **Privacy, twice.** Text is scrubbed before it is put into a prompt, and the client refuses to send any request that still contains a phone number or e-mail. Sender names and numbers are never stored, so they cannot be sent. Personal names typed inside a post (a signature) are not detectable and are not removed.
- **Every call is recorded.** Each attempt (request without the API key, raw answer, tokens, cost, latency, status) is returned for `extraction_runs`.
- **Prompt versions.** Changing a prompt means changing its `VERSION` (e.g. `extract-2026-10-27.1`) and running `pnpm eval` before deploying.
