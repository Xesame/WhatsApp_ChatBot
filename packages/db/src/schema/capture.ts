import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/**
 * Tables written by the capture service (Phase 1).
 *
 * Capture stores raw WhatsApp data exactly once and never interprets it.
 * Everything else in the system reads from here, so old messages can always
 * be reprocessed after a prompt or model change.
 */

/** CHECK constraint so the database itself rejects values outside the list. */
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

export const GROUP_SOURCE_TYPES = ['developer', 'broker'] as const;

export const waGroups = pgTable(
  'wa_groups',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    jid: text('jid').notNull().unique(),
    name: text('name'),
    // New groups start unwatched: nothing from a group is stored until the
    // owner chooses to watch it.
    watched: boolean('watched').notNull().default(false),
    sourceType: text('source_type', { enum: GROUP_SOURCE_TYPES }),
    isMember: boolean('is_member').notNull().default(true),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt,
  },
  (t) => [oneOf('wa_groups_source_type_check', t.sourceType, GROUP_SOURCE_TYPES)],
);

export const MESSAGE_STATUSES = [
  'pending',
  'processing',
  'processed',
  'skipped',
  'failed',
] as const;
export const MEDIA_TYPES = ['none', 'image', 'video', 'audio', 'document'] as const;

export const messages = pgTable(
  'messages',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    groupId: integer('group_id')
      .notNull()
      .references(() => waGroups.id, { onDelete: 'restrict' }),
    waMessageId: text('wa_message_id').notNull(),
    senderHash: text('sender_hash').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    text: text('text'),
    quotedWaMessageId: text('quoted_wa_message_id'),
    editOfWaMessageId: text('edit_of_wa_message_id'),
    mediaType: text('media_type', { enum: MEDIA_TYPES }).notNull().default('none'),
    isForwarded: boolean('is_forwarded').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    status: text('status', { enum: MESSAGE_STATUSES }).notNull().default('pending'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    // Set in the same transaction that queues the `preprocess` job, so a
    // message is queued exactly once even if capture crashes and retries.
    enqueuedAt: timestamp('enqueued_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    // WhatsApp message IDs are unique within a chat. This index is what makes
    // saving the same message twice (after a reconnect) a no-op.
    uniqueIndex('messages_group_wa_message_id_key').on(t.groupId, t.waMessageId),
    index('messages_status_idx').on(t.status),
    index('messages_group_sent_at_idx').on(t.groupId, t.sentAt),
    // Context assembly (Phase 3) looks up captions from the same sender
    // within a short window of an image or file.
    index('messages_sender_sent_at_idx').on(t.senderHash, t.sentAt),
    oneOf('messages_status_check', t.status, MESSAGE_STATUSES),
    oneOf('messages_media_type_check', t.mediaType, MEDIA_TYPES),
  ],
);

export const MEDIA_STATUSES = ['pending', 'downloaded', 'failed', 'skipped'] as const;
export const MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const;

export const mediaFiles = pgTable(
  'media_files',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    messageId: bigint('message_id', { mode: 'number' })
      .notNull()
      .unique()
      .references(() => messages.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: MEDIA_KINDS }).notNull(),
    mimeType: text('mime_type'),
    fileName: text('file_name'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    sha256: text('sha256'),
    path: text('path'),
    status: text('status', { enum: MEDIA_STATUSES }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    // What WhatsApp needs to download the file again (url, directPath,
    // mediaKey). Contains no sender information.
    mediaRef: jsonb('media_ref').notNull(),
    createdAt,
    downloadedAt: timestamp('downloaded_at', { withTimezone: true }),
  },
  (t) => [
    index('media_files_sha256_idx').on(t.sha256),
    index('media_files_status_idx')
      .on(t.status)
      .where(sql`${t.status} in ('pending', 'failed')`),
    oneOf('media_files_status_check', t.status, MEDIA_STATUSES),
    oneOf('media_files_kind_check', t.kind, MEDIA_KINDS),
  ],
);

/**
 * WhatsApp login keys (Baileys auth state), one set per account
 * ("scraper" now, "query-bot" in Phase 7). Kept in Postgres rather than files
 * so the session is included in database backups and survives container
 * rebuilds.
 */
export const waAuth = pgTable(
  'wa_auth',
  {
    account: text('account').notNull(),
    category: text('category').notNull(),
    keyId: text('key_id').notNull(),
    value: jsonb('value').notNull(),
    updatedAt,
  },
  (t) => [primaryKey({ columns: [t.account, t.category, t.keyId] })],
);

export const CONNECTION_STATES = [
  'starting',
  'awaiting_pairing',
  'open',
  'reconnecting',
  'logged_out',
  'stopped',
] as const;

/** Live connection status of each WhatsApp account, for health checks and the admin page. */
export const waConnections = pgTable(
  'wa_connections',
  {
    account: text('account').primaryKey(),
    state: text('state', { enum: CONNECTION_STATES }).notNull(),
    qr: text('qr'),
    pairingCode: text('pairing_code'),
    lastConnectedAt: timestamp('last_connected_at', { withTimezone: true }),
    lastDisconnectedAt: timestamp('last_disconnected_at', { withTimezone: true }),
    lastDisconnectReason: text('last_disconnect_reason'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    updatedAt,
  },
  (t) => [oneOf('wa_connections_state_check', t.state, CONNECTION_STATES)],
);
