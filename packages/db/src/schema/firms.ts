import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { firms, users } from './admin.ts';
import { units } from './listings.ts';

/**
 * Data that belongs to one firm (Phase 6). Every table here has `firm_id`,
 * and every query on it must filter by the caller's firm (build plan,
 * rule 5). `@reb/firms` is the only code that reads or writes these.
 */

const oneOf = (name: string, column: AnyPgColumn, values: readonly string[]) =>
  check(
    name,
    sql`${column} in (${sql.join(
      values.map((v) => sql.raw(`'${v}'`)),
      sql`, `,
    )})`,
  );
const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true })
  .notNull()
  .defaultNow()
  .$onUpdate(() => new Date());

export const ACCESS_LINK_PURPOSES = ['invite', 'reset'] as const;

/**
 * One-time links to set a password: an invitation for a new user, or a
 * password reset. Only a hash of the token is stored; the link itself is
 * shown once to whoever created it, who sends it to the person.
 */
export const accessLinks = pgTable(
  'access_links',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    purpose: text('purpose', { enum: ACCESS_LINK_PURPOSES }).notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    oneOf('access_links_purpose_check', t.purpose, ACCESS_LINK_PURPOSES),
    index('access_links_user_idx').on(t.userId),
  ],
);

export const ALERT_CHANNELS = ['none', 'whatsapp', 'telegram'] as const;

/** A filter an agent saved; alerts on it arrive in Phase 7. */
export const savedSearches = pgTable(
  'saved_searches',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    firmId: integer('firm_id')
      .notNull()
      .references(() => firms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filters: jsonb('filters').notNull(),
    alertChannel: text('alert_channel', { enum: ALERT_CHANNELS }).notNull().default('none'),
    active: boolean('active').notNull().default(true),
    createdAt,
    updatedAt,
  },
  (t) => [
    oneOf('saved_searches_alert_channel_check', t.alertChannel, ALERT_CHANNELS),
    index('saved_searches_firm_user_idx').on(t.firmId, t.userId),
  ],
);

/** A firm's private note on a listing. Other firms never see it. */
export const firmNotes = pgTable(
  'firm_notes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    firmId: integer('firm_id')
      .notNull()
      .references(() => firms.id, { onDelete: 'cascade' }),
    unitId: bigint('unit_id', { mode: 'number' })
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('firm_notes_firm_unit_idx').on(t.firmId, t.unitId),
    check('firm_notes_body_check', sql`length(${t.body}) between 1 and 2000`),
  ],
);

export const USAGE_KINDS = ['search', 'export', 'listing_view', 'chat_query'] as const;

/** Searches, exports and listing views per firm, for billing and plan limits. */
export const usageEvents = pgTable(
  'usage_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    firmId: integer('firm_id')
      .notNull()
      .references(() => firms.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: USAGE_KINDS }).notNull(),
    details: jsonb('details'),
    createdAt,
  },
  (t) => [
    oneOf('usage_events_kind_check', t.kind, USAGE_KINDS),
    index('usage_events_firm_created_idx').on(t.firmId, t.createdAt),
  ],
);

export type FirmId = (typeof firms.$inferSelect)['id'];
