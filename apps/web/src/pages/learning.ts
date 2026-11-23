import type { Entity, EntityKind } from '../api.ts';

/**
 * Plain helpers behind the "teach the system" controls (Review page) and the
 * re-check note (Places & names). No React here, so they can be tested alone.
 */

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Written names worth remembering for the chosen entity: the ones that are
 * not already one of its names or spellings. Empty when nothing is chosen.
 */
export function spellingsToOffer(written: string[], chosen: Entity | undefined): string[] {
  if (!chosen) return [];
  const known = [chosen.nameEn, chosen.nameAr, ...chosen.aliases.map((a) => a.alias)];
  const offers: string[] = [];
  for (const w of written) {
    if (w.trim() && !known.some((k) => same(k, w)) && !offers.some((o) => same(o, w)))
      offers.push(w);
  }
  return offers;
}

export const rememberKey = (kind: EntityKind, alias: string) =>
  `${kind}:${alias.trim().toLowerCase()}`;

/** Which form field holds each kind's entity id (entity ids as text). */
const KEY_OF = { project: 'projectId', developer: 'developerId', city: 'cityId' } as const;

/**
 * The spellings to send with a Review save: for each name the person
 * changed, the offered spellings they left ticked. An unticked spelling is
 * never sent; an unchanged name offers nothing.
 */
export function rememberedSpellings(input: {
  values: Record<string, string>;
  initial: Record<string, string>;
  lists: Partial<Record<EntityKind, Entity[] | undefined>>;
  written: Record<EntityKind, string[]>;
  unticked: Set<string>;
}): { kind: EntityKind; alias: string }[] {
  return (['project', 'developer', 'city'] as const).flatMap((kind) => {
    const key = KEY_OF[kind];
    if (input.values[key] === input.initial[key]) return [];
    const chosen = input.lists[kind]?.find((e) => String(e.id) === input.values[key]);
    return spellingsToOffer(input.written[kind], chosen)
      .filter((alias) => !input.unticked.has(rememberKey(kind, alias)))
      .map((alias) => ({ kind, alias }));
  });
}

/** What the server says after a change to names: how many waiting units it checked again. */
export interface Recheck {
  checked: number;
  cleared: number;
}

/** The note shown on Places & names after a change. */
export const recheckMessage = (recheck: Recheck) =>
  `Re-checked ${recheck.checked} waiting units, ${recheck.cleared} cleared`;

/**
 * The "+ New developer / area" choice at the top of a list inside the New
 * project form. Offered unless the unit's written name is already a known
 * developer / area (by name or spelling); with no written name it is offered
 * with an empty name. `name` is what the little form starts with.
 */
export function newEntityOption(
  kind: 'developer' | 'city',
  written: string | undefined,
  known: Entity[] | undefined,
): { label: string; name: string } | null {
  const word = kind === 'developer' ? 'developer' : 'area';
  const name = written?.trim() ?? '';
  if (!name) return { label: `+ New ${word}…`, name: '' };
  const isKnown = (known ?? []).some((e) =>
    [e.nameEn, e.nameAr, ...e.aliases.map((a) => a.alias)].some((k) => same(k, name)),
  );
  return isKnown ? null : { label: `+ New ${word} named “${name}”`, name };
}

/** Who searched, in the words the Review page shows: "Gemini found on Google: ...". */
export function lookupLabel(provider: 'gemini' | 'groq', answer: string): string {
  return provider === 'gemini'
    ? `Gemini found on Google: ${answer}`
    : `Groq found on the web: ${answer}`;
}

/**
 * The pages a search used, as small links named by their site. Gemini's
 * links go through a Google redirect, so its site is the `title` Google
 * gives (a domain such as "example.com"). Only http(s) links, at most 3.
 */
export function lookupSourceLinks(
  sources: { url: string; title: string | null }[],
): { href: string; label: string }[] {
  const links: { href: string; label: string }[] = [];
  for (const source of sources) {
    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    const site = (host: string) => host.replace(/^www\./, '').toLowerCase();
    const title = source.title?.trim() ?? '';
    const titleIsSite = /^[\w-]+(\.[\w-]+)+$/.test(title);
    const redirect = url.hostname.endsWith('vertexaisearch.cloud.google.com');
    const label = redirect ? (titleIsSite ? site(title) : 'google.com') : site(url.hostname);
    links.push({ href: url.href, label });
    if (links.length === 3) break;
  }
  return links;
}

/**
 * What to offer for the developer / area the search found: use the one we
 * already have under that name or spelling, or add it as new. Null when
 * there is no answer.
 */
export function lookupOffer(
  answer: string | null,
  known: Entity[] | undefined,
): { kind: 'use'; id: number; name: string } | { kind: 'new'; name: string } | null {
  const name = answer?.trim() ?? '';
  if (!name) return null;
  const match = (known ?? []).find((e) =>
    [e.nameEn, e.nameAr, ...e.aliases.map((a) => a.alias)].some((k) => same(k, name)),
  );
  return match ? { kind: 'use', id: match.id, name: match.nameEn } : { kind: 'new', name };
}

/**
 * Which "+ New developer / area named ..." buttons to show when the message
 * wrote a name and the search also named one. The same name (ignoring case
 * and extra spaces) gets ONE button, in the written slot, spelled as the
 * search spelled it when the message wrote it all in lower or upper case, else as
 * written. Different names keep both buttons.
 */
export function newNameButtons(
  written: string | undefined,
  answer: string | null,
): { written: string | null; lookup: string | null } {
  const w = written?.trim() || null;
  const a = answer?.trim() || null;
  const squash = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();
  if (w && a && squash(w) === squash(a)) {
    const flat = w === w.toLowerCase() || w === w.toUpperCase();
    return { written: flat ? a : w, lookup: null };
  }
  return { written: w, lookup: a };
}

/**
 * What a key press means inside the small "new developer / area" box.
 * Enter saves it (only with both names filled in, and not twice); Escape
 * cancels. The page must stop Enter from reaching the project form around
 * it, whatever this returns for Enter.
 */
export function inlineKeyAction(
  key: string,
  nameEn: string,
  nameAr: string,
  saving: boolean,
): 'save' | 'cancel' | 'none' | null {
  if (key === 'Escape') return 'cancel';
  if (key !== 'Enter') return null;
  return !saving && nameEn.trim() && nameAr.trim() ? 'save' : 'none';
}

/**
 * What the Review page shows and does after a button succeeds. Approving or
 * rejecting always confirms; on the single-listing page (opened from a link)
 * it also goes back to the queue so the next waiting listing appears. Saving
 * without a decision stays where it is.
 */
export function afterReview(
  action: 'save' | 'approve' | 'reject',
  singleListing: boolean,
): { message: string; backToQueue: boolean } {
  if (action === 'approve') return { message: 'Approved ✓', backToQueue: singleListing };
  if (action === 'reject')
    return { message: 'Marked as not a listing ✓', backToQueue: singleListing };
  return { message: 'Saved ✓', backToQueue: false };
}

/**
 * The other listings from the same message (a price list of 25 lines is 25
 * listings): Review offers to give them this unit's names in the same save.
 */
export const siblingsLabel = (count: number) =>
  count === 1
    ? 'Use this project, developer and area for the other listing from this message'
    : `Use this project, developer and area for the other ${count} listings from this message`;

/**
 * What to send about the other listings: nothing when there are none or the
 * first box is unticked, and nothing with "Not a listing" (rejecting one line
 * says nothing about the others' names). "Approve them too" only goes with
 * Approve.
 */
export function siblingsChoice(
  state: { count: number; apply: boolean; approve: boolean },
  action: 'save' | 'approve' | 'reject',
): { apply: true; approve: boolean } | undefined {
  if (state.count === 0 || !state.apply || action === 'reject') return undefined;
  return { apply: true, approve: state.approve && action === 'approve' };
}

/** The confirmation after a save that also changed other listings, or null. */
export function siblingsMessage(changed: number | undefined): string | null {
  if (!changed) return null;
  return `Updated ${changed} other ${changed === 1 ? 'listing' : 'listings'} from this message`;
}

/** A short label for a unit that is not waiting for review (empty when it is). */
export function unitStateLabel(unit: { needsReview: boolean; status: string }): string | null {
  if (unit.status === 'withdrawn') return 'Withdrawn (not a listing)';
  if (!unit.needsReview && (unit.status === 'active' || unit.status === 'stale'))
    return 'Already checked';
  return null;
}
