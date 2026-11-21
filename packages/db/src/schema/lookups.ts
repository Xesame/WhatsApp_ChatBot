import { boolean, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * What the model remembers about a project name we have never seen before
 * (the "names from Gemini's memory" hint on the Review page).
 *
 * One row per name, however many messages mention it, so we ask the model
 * once. `known = false` with empty developer and city means the model was
 * not sure; that is stored too, so we do not ask again. The answer is only
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('name_lookups_name_normalized_key').on(t.nameNormalized)],
);
