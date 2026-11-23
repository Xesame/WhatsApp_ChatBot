import {
  GROUP_SOURCE_TYPES,
  messages,
  units,
  unitSources,
  waGroups,
  type Database,
  type Db,
} from '@reb/db';
import { importGroup, importGroupJid, saveImportedMessage } from '@reb/ingest';
import { reprocess } from '@reb/pipeline';
import type { PgBoss } from '@reb/queue';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * "Test a message" in the admin console: the owner pastes a sample WhatsApp
 * message and watches the normal pipeline read it. A pasted message is saved
 * exactly like an imported one (`pnpm worker import`), into a watched group
 * named "Test messages", and queued for the same `preprocess` job.
 */

export type PosterType = (typeof GROUP_SOURCE_TYPES)[number];

export const TEST_GROUP_NAME = 'Test messages';

/** What the page sends. The text is trimmed; 1 to 20,000 characters. */
export const testMessageSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  posterType: z.enum(GROUP_SOURCE_TYPES).nullable().default(null),
});
export type TestMessageInput = z.input<typeof testMessageSchema>;

/**
 * Who posts in a group is a setting of the group, not of the message, so each
 * poster type gets its own test group. "Read again" then reads a message with
 * the poster type it was pasted with.
 */
export function testGroupName(posterType: PosterType | null): string {
  return posterType ? `${TEST_GROUP_NAME} (${posterType})` : TEST_GROUP_NAME;
}

const TEST_GROUP_JIDS = [null, ...GROUP_SOURCE_TYPES].map((t) => importGroupJid(testGroupName(t)));

/**
 * Pasted text has no sender. Every test message gets this one fixed value
 * instead of a hash of a person, so no name or phone number is ever stored.
 * (Context assembly only joins a sender's nearby texts to images and files,
 * which pasted messages never have, so test messages don't mix.)
 */
export const TEST_SENDER_HASH = createHash('sha256').update('reb:test-message').digest('hex');

/** The same text pasted again with the same poster type is the same message. */
export function testMessageWaId(text: string): string {
  return `test-${createHash('sha256').update(text).digest('hex').slice(0, 32)}`;
}

export interface TestMessageUnit {
  id: number;
  unitType: string | null;
  needsReview: boolean;
  status: string;
}

export interface TestMessage {
  id: number;
  text: string | null;
  posterType: PosterType | null;
  status: (typeof messages.$inferSelect)['status'];
  /** Why it was skipped or failed. */
  error: string | null;
  pastedAt: Date;
  /** The listings this message created or updated. */
  units: TestMessageUnit[];
}

/**
 * Saves the pasted text and queues it for the pipeline. Pasting the same text
 * (with the same poster type) again does not add a second copy: the earlier
 * message is queued to be read again instead (`again: true`).
 */
export async function pasteTestMessage(
  database: Database,
  boss: PgBoss,
  input: TestMessageInput,
  now: Date = new Date(),
): Promise<{ messageId: number; again: boolean }> {
  const { text, posterType } = testMessageSchema.parse(input);
  const group = await importGroup(database.db, testGroupName(posterType), posterType);
  const waMessageId = testMessageWaId(text);
  const savedId = await saveImportedMessage(database, boss, {
    groupId: group.id,
    waMessageId,
    senderHash: TEST_SENDER_HASH,
    sentAt: now,
    text,
    file: null,
  });
  if (savedId !== null) return { messageId: savedId, again: false };

  const [existing] = await database.db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.groupId, group.id), eq(messages.waMessageId, waMessageId)));
  if (!existing) throw new Error('Could not save the test message');
  await reprocess(database, boss, { messageIds: [existing.id] });
  return { messageId: existing.id, again: true };
}

/** The newest test messages first (or just the ones asked for), with their listings. */
export async function testMessages(
  db: Db,
  options: { ids?: number[]; limit?: number } = {},
): Promise<TestMessage[]> {
  const rows = await db
    .select({
      id: messages.id,
      text: messages.text,
      posterType: waGroups.sourceType,
      status: messages.status,
      error: messages.error,
      pastedAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(waGroups, eq(waGroups.id, messages.groupId))
    .where(
      and(
        inArray(waGroups.jid, TEST_GROUP_JIDS),
        options.ids ? inArray(messages.id, options.ids) : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(options.limit ?? 10);
  if (rows.length === 0) return [];

  const made = await db
    .select({
      messageId: unitSources.messageId,
      id: units.id,
      unitType: units.unitType,
      needsReview: units.needsReview,
      status: units.status,
    })
    .from(unitSources)
    .innerJoin(units, eq(units.id, unitSources.unitId))
    .where(
      inArray(
        unitSources.messageId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(units.id));
  return rows.map((row) => ({
    ...row,
    units: made.filter((u) => u.messageId === row.id).map(({ messageId: _, ...unit }) => unit),
  }));
}

/** One test message, or null if the ID is not a test message. */
export async function testMessage(db: Db, id: number): Promise<TestMessage | null> {
  return (await testMessages(db, { ids: [id], limit: 1 })).at(0) ?? null;
}

/** Queues a test message to be read again. False if the ID is not a test message. */
export async function readTestMessageAgain(
  database: Database,
  boss: PgBoss,
  id: number,
): Promise<boolean> {
  if (!(await testMessage(database.db, id))) return false;
  await reprocess(database, boss, { messageIds: [id] });
  return true;
}
