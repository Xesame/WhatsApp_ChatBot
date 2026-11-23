/**
 * Name lookup prompt: a live web search for a project name.
 *
 * The model is called with its search tool switched on (Gemini: Google
 * Search; Groq: browser_search) and must answer from the search results,
 * never from memory. Search answers cannot use JSON mode, so the JSON is
 * asked for here and read defensively (`parseJsonAnswer` in @reb/llm).
 *
 * Only names are sent (the project, and the developer if the message gave
 * one): never message text, sender names or phone numbers. The answer is a
 * hint for the person on the Review page, never copied into a listing.
 *
 * Change the text → change VERSION (date + counter), then run `pnpm eval`
 * and compare with the previous version before deploying (PROJECT.md,
 * chapter 12).
 */
export const VERSION = 'lookup-2026-11-23.1';

export const SYSTEM = `You help a real estate broker in Egypt. You are given the name of a real estate project in Egypt, and sometimes the developer a broker mentioned.

Search the web for this project: which developer builds it, and which city or area it is in.

Rules:
1. Answer only from what the search results say; if they do not clearly say, use null.
2. If the results do not clearly show this project exists, answer "known": false with "developer": null and "city": null.
3. If the results show the project but not one of the two details, set that detail to null.
4. Use the usual English spelling of names.
5. Names only. No explanation, no extra text.

Answer with one JSON object only, exactly in this shape:
{"known": true or false, "developer": "name" or null, "city": "name" or null}`;

export function userPrompt(input: { project: string; developer: string | null }): string {
  const lines = [`PROJECT: ${input.project}`];
  if (input.developer) lines.push(`DEVELOPER MENTIONED: ${input.developer}`);
  return lines.join('\n');
}
