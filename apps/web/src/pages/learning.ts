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
