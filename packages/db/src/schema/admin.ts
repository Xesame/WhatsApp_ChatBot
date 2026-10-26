import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { messages } from './capture.ts';
import { units } from './listings.ts';

/**
 * Accounts and administration (Phase 5).
 *
 * `users`, `sessions`, `accounts` and `verifications` follow the layout Better
 * Auth expects (field names are Better Auth's); the database column names
 * are ours. Passwords live in `accounts.password` (scrypt hash), never in
 * `users`.
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

export const USER_ROLES = ['owner', 'firm_admin', 'agent'] as const;

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    role: text('role', { enum: USER_ROLES }).notNull().default('agent'),
    phone: text('phone'),
    createdAt,
    updatedAt,
  },
  (t) => [oneOf('users_role_check', t.role, USER_ROLES)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt,
    updatedAt,
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt,
    updatedAt,
  },
  (t) => [index('accounts_user_idx').on(t.userId)],
);

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt,
  updatedAt,
});

export const REVIEW_ACTIONS = ['edit', 'approve', 'reject'] as const;

/**
 * Every change made in the review queue, field by field. These feed the
 * eval set: a corrected unit becomes an eval case (`pnpm eval:from-review`).
 */
export const reviewCorrections = pgTable(
  'review_corrections',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    unitId: bigint('unit_id', { mode: 'number' }).references(() => units.id, {
      onDelete: 'set null',
    }),
    messageId: bigint('message_id', { mode: 'number' }).references(() => messages.id, {
      onDelete: 'set null',
    }),
    action: text('action', { enum: REVIEW_ACTIONS }).notNull(),
    field: text('field'),
    before: jsonb('before'),
    after: jsonb('after'),
    reviewerId: text('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt,
  },
  (t) => [
    index('review_corrections_unit_idx').on(t.unitId),
    oneOf('review_corrections_action_check', t.action, REVIEW_ACTIONS),
  ],
);

/** Who did what: logins, exports, admin actions (build plan, section 11). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target'),
    details: jsonb('details'),
    ipAddress: text('ip_address'),
    createdAt,
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt), index('audit_log_user_idx').on(t.userId)],
);

/** Settings the owner changes from the admin page (e.g. the USD→EGP rate). */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt,
});
