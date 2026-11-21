/**
 * Name lookup prompt: ask the model what it remembers about a project name.
 *
 * Only names are sent (the project, and the developer if the message gave
 * one): never message text, sender names or phone numbers. The answer is a
 * hint for the person on the Review page, never copied into a listing.
 *
 * Change the text → change VERSION (date + counter), then run `pnpm eval`
 * and compare with the previous version before deploying (PROJECT.md,
 * chapter 12).
 */
export const VERSION = 'lookup-2026-11-21.1';

export const SYSTEM = `You know Egyptian real estate: developers, compounds and projects in Cairo, the North Coast, the Red Sea and elsewhere in Egypt.

You are given the name of a project, and sometimes the developer a broker mentioned. Say which developer builds it and which city or area it is in.

Rules:
1. Answer only from what you actually know. Never invent or guess a developer or city.
2. If you are not sure the project exists, or not sure who builds it, answer "known": false with "developer": null and "city": null.
3. If you know the project but not one of the two details, set that detail to null.
4. Use the usual English spelling of names (for example "Dubai Misr", "Mostakbal City").
5. Names only. No explanation, no extra text.

Answer with JSON only.`;

export function userPrompt(input: { project: string; developer: string | null }): string {
  const lines = [`PROJECT: ${input.project}`];
  if (input.developer) lines.push(`DEVELOPER MENTIONED: ${input.developer}`);
  return lines.join('\n');
}
