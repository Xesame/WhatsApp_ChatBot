import { messages, units, unitSources, waGroups } from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { startQueue, type PgBoss } from '@reb/queue';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  pasteTestMessage,
  readTestMessageAgain,
  TEST_SENDER_HASH,
  testMessage,
  testMessages,
} from '../src/index.ts';

describe.skipIf(!testDatabaseUrl)('test messages (real Postgres)', () => {
  let testDb: TestDatabase;
  let boss: PgBoss;

  const preprocessJobs = async (messageId: number) => {
    const { rows } = await testDb.database.pool.query<{ n: string }>(
      `select count(*) as n from pgboss.job where name = 'preprocess' and (data->>'messageId')::bigint = $1`,
      [messageId],
    );
    return Number(rows[0]?.n);
  };

  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
    boss = await startQueue(testDb.url, { supervise: false, onError: () => undefined });
  });
  afterAll(async () => {
    await boss.stop({ graceful: false });
    await testDb.drop();
  });

  it('saves pasted text into a watched "Test messages" group and queues it once, with no sender', async () => {
    const { db } = testDb.database;
    const pasted = await pasteTestMessage(testDb.database, boss, {
      text: '  متاح شقة في ميفيدا 3 غرف 165 متر السعر 9.8 مليون  ',
      posterType: 'broker',
    });
    expect(pasted.again).toBe(false);

    const [row] = await db.select().from(messages).where(eq(messages.id, pasted.messageId));
    expect(row).toMatchObject({
      text: 'متاح شقة في ميفيدا 3 غرف 165 متر السعر 9.8 مليون',
      senderHash: TEST_SENDER_HASH,
      mediaType: 'none',
      status: 'pending',
    });
    expect(row?.enqueuedAt).not.toBeNull();
    const [group] = await db
      .select()
      .from(waGroups)
      .where(eq(waGroups.id, row?.groupId ?? 0));
    expect(group).toMatchObject({
      name: 'Test messages (broker)',
      watched: true,
      sourceType: 'broker',
    });
    expect(await preprocessJobs(pasted.messageId)).toBe(1);

    expect(await testMessage(db, pasted.messageId)).toMatchObject({
      status: 'pending',
      posterType: 'broker',
      units: [],
    });
  });

  it('pasting the same text again reads the earlier message again instead of adding a copy', async () => {
    const first = await pasteTestMessage(testDb.database, boss, { text: 'Villa in Zayed 12M' });
    await testDb.database.db
      .update(messages)
      .set({ status: 'skipped', error: 'Not a listing' })
      .where(eq(messages.id, first.messageId));
    const second = await pasteTestMessage(testDb.database, boss, { text: 'Villa in Zayed 12M' });
    expect(second).toEqual({ messageId: first.messageId, again: true });
    expect(await testMessage(testDb.database.db, first.messageId)).toMatchObject({
      status: 'pending',
      error: null,
      posterType: null,
    });
    // another poster type is another group, so a separate message
    const asDeveloper = await pasteTestMessage(testDb.database, boss, {
      text: 'Villa in Zayed 12M',
      posterType: 'developer',
    });
    expect(asDeveloper.messageId).not.toBe(first.messageId);
  });

  it('shows the listings a message made, and lists only test messages, newest first', async () => {
    const { db } = testDb.database;
    const pasted = await pasteTestMessage(testDb.database, boss, { text: 'Two units in Mivida' });
    const now = new Date();
    const made = await db
      .insert(units)
      .values([
        {
          unitType: 'Apartment',
          confidence: 0.5,
          needsReview: true,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        {
          unitType: 'Villa',
          confidence: 0.9,
          needsReview: false,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      ])
      .returning({ id: units.id });
    await db
      .insert(unitSources)
      .values(
        made.map((u) => ({ unitId: u.id, messageId: pasted.messageId, role: 'listing' as const })),
      );
    await db.update(messages).set({ status: 'processed' }).where(eq(messages.id, pasted.messageId));

    // a real WhatsApp message is never listed or read again from here
    const [other] = await db
      .insert(waGroups)
      .values({ jid: '123@g.us', name: 'Real group', watched: true })
      .returning();
    const [real] = await db
      .insert(messages)
      .values({
        groupId: other?.id ?? 0,
        waMessageId: 'REAL1',
        senderHash: 'h'.repeat(64),
        sentAt: new Date(),
        text: 'real',
      })
      .returning();

    const list = await testMessages(db);
    expect(list.at(0)).toMatchObject({
      id: pasted.messageId,
      status: 'processed',
      units: [
        { id: made[0]?.id, unitType: 'Apartment', needsReview: true },
        { id: made[1]?.id, unitType: 'Villa', needsReview: false },
      ],
    });
    expect(list.map((m) => m.id)).not.toContain(real?.id);
    expect(await testMessage(db, real?.id ?? 0)).toBeNull();
    expect(await readTestMessageAgain(testDb.database, boss, real?.id ?? 0)).toBe(false);
  });

  it('"Read again" puts a test message back in the queue', async () => {
    const { db } = testDb.database;
    const pasted = await pasteTestMessage(testDb.database, boss, { text: 'Read me again' });
    await db
      .update(messages)
      .set({ status: 'failed', error: 'Every model was down' })
      .where(eq(messages.id, pasted.messageId));
    expect(await readTestMessageAgain(testDb.database, boss, pasted.messageId)).toBe(true);
    expect(await testMessage(db, pasted.messageId)).toMatchObject({
      status: 'pending',
      error: null,
    });
    expect(await preprocessJobs(pasted.messageId)).toBe(2);
  });
});
