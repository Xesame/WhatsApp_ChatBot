import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * How an answer was found. `search`: a live web search (Gemini with Google
 * Search, or Groq's browser search). `memory`: the model's memory, from
 * before lookups searched; no longer trusted, so asked again with search.
 */
export const LOOKUP_METHODS = ['memory', 'search'] as const;
/** Which provider ran the search. */
export const LOOKUP_PROVIDERS = ['gemini', 'groq'] as const;

/** A page the search used, shown as a small link on the Review page. */
export interface LookupSource {
  url: string;
  title: string | null;
}

const inList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', '));

/**
 * What a web search says about a project name we have never seen before
 * (the "found on Google / on the web" hint on the Review page).
 *
 * One row per name, however many messages mention it, so we search once.
 * `known = false` with empty developer and city means the search did not
 * clearly say; that is stored too, so we do not
 * ask on every message, and asked again after 30 days. The answer is only
 * a hint for the person reviewing: it is never copied into a listing.
 */
export const nameLookups = pgTable(
  'name_lookups',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    /** The name as first written in a message. */
    name: text('name').notNull(),
    /** The name in its comparable form (see @reb/normalize). */
    nameNormalized: text('name_normalized').notNull(),
    /** The developer the model named, as it answered, or null. */
    developer: text('developer'),
    /** The city the model named, as it answered, or null. */
    city: text('city'),
    known: boolean('known').notNull(),
    /** Which model gave the answer. */
    model: text('model').notNull(),
    /** Which version of the lookup prompt was used. */
    promptVersion: text('prompt_version').notNull(),
    /** `search` or `memory` (rows from before lookups searched the web). */
    method: text('method', { enum: LOOKUP_METHODS }),
    /** `gemini` or `groq`: who ran the search (null on rows from memory). */
    provider: text('provider', { enum: LOOKUP_PROVIDERS }),
    /** Up to 3 pages the search used: `[{ url, title }]`. */
    sources: jsonb('sources').$type<LookupSource[]>(),
    /**
     * A search ran but its answer could not be read (not the JSON asked
     * for). Saved as "not sure", and asked again after one day, not 30.
     */
    unusable: boolean('unusable').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('name_lookups_name_normalized_key').on(t.nameNormalized),
    check('name_lookups_method_check', sql`${t.method} in (${inList(LOOKUP_METHODS)})`),
    check('name_lookups_provider_check', sql`${t.provider} in (${inList(LOOKUP_PROVIDERS)})`),
  ],
);
