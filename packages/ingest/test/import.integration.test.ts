import { mediaFiles, messages, waGroups } from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { startQueue, type PgBoss } from '@reb/queue';
import { eq } from 'drizzle-orm';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importSamples, parseChatExport } from '../src/index.ts';

describe.skipIf(!testDatabaseUrl)('importing sample messages (real Postgres)', () => {
  let testDb: TestDatabase;
  let boss: PgBoss;
  let dir: string;
  let mediaDir: string;
  const salt = 's'.repeat(32);
  const exportText = [
    '13/01/2026, 10:05 - Ahmed Broker: متاح شقة في ميفيدا 3 غرف 165 متر السعر 9.8 مليون',
    '13/01/2026, 10:07 - Ahmed Broker: IMG-20260113-WA0003.jpg (file attached)',
    'قائمة أسعار المرحلة الجديدة',
    '13/01/2026, 10:08 - Sara: DOC-20260113-WA0004.pdf (file attached)',
  ].join('\n');
  const options = () => ({
    groupName: 'Sample brokers',
    sourceType: 'broker' as const,
    salt,
    mediaDir,
    maxMediaBytes: 10_000_000,
    filesDir: dir,
    shiftToNow: false,
  });

  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
    boss = await startQueue(testDb.url, { supervise: false, onError: () => undefined });
    dir = await mkdtemp(join(tmpdir(), 'reb-samples-'));
    mediaDir = await mkdtemp(join(tmpdir(), 'reb-media-'));
    await writeFile(
      join(dir, 'IMG-20260113-WA0003.jpg'),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
    );
  });
  afterAll(async () => {
    await boss.stop({ graceful: false });
    await testDb.drop();
    await rm(dir, { recursive: true, force: true });
    await rm(mediaDir, { recursive: true, force: true });
  });

  it('stores messages and files like capture does, queues each once, and never stores a sender name', async () => {
    const result = await importSamples(
      testDb.database,
      boss,
      parseChatExport(exportText),
      options(),
    );
    expect(result).toMatchObject({
      saved: 3,
      alreadyImported: 0,
      withFiles: 1,
      missingFiles: ['DOC-20260113-WA0004.pdf'],
    });

    const [group] = await testDb.database.db
      .select()
      .from(waGroups)
      .where(eq(waGroups.id, result.groupId));
    expect(group).toMatchObject({ name: 'Sample brokers', watched: true, sourceType: 'broker' });

    const rows = await testDb.database.db.select().from(messages).orderBy(messages.sentAt);
    expect(rows.map((r) => [r.text, r.mediaType])).toEqual([
      ['متاح شقة في ميفيدا 3 غرف 165 متر السعر 9.8 مليون', 'none'],
      ['قائمة أسعار المرحلة الجديدة', 'image'],
      [null, 'none'], // the PDF was not in the folder: the message is kept without it
    ]);
    expect(rows.every((r) => r.enqueuedAt !== null)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('Ahmed');
    expect(rows.at(0)?.senderHash).toBe(rows.at(1)?.senderHash); // same person, same hash: captions still link
    expect(rows.at(0)?.senderHash).not.toBe(rows.at(2)?.senderHash);

    const [file] = await testDb.database.db.select().from(mediaFiles);
    expect(file).toMatchObject({ status: 'downloaded', kind: 'image', mimeType: 'image/jpeg' });
    expect(await readFile(join(mediaDir, file?.path ?? ''))).toEqual(
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
    );

    const queued = await testDb.database.pool.query<{ n: string }>(
      `select count(*) as n from pgboss.job where name = 'preprocess'`,
    );
    expect(Number(queued.rows[0]?.n)).toBe(3);
  });

  it('importing the same file again adds nothing', async () => {
    const again = await importSamples(
      testDb.database,
      boss,
      parseChatExport(exportText),
      options(),
    );
    expect(again).toMatchObject({ saved: 0, alreadyImported: 3 });
    expect(await testDb.database.db.select().from(messages)).toHaveLength(3);
  });

  it('can move old samples forward so the newest is now, keeping their order and gaps', async () => {
    const now = new Date('2026-11-08T12:00:00Z');
    await importSamples(
      testDb.database,
      boss,
      parseChatExport('01/03/2026, 09:00 - A: one\n01/03/2026, 09:30 - A: two'),
      {
        ...options(),
        groupName: 'Shifted',
        shiftToNow: true,
        now,
      },
    );
    const rows = await testDb.database.db.select().from(messages).where(eq(messages.text, 'two'));
    expect(rows.at(0)?.sentAt.toISOString()).toBe(now.toISOString());
    const [one] = await testDb.database.db.select().from(messages).where(eq(messages.text, 'one'));
    expect(one?.sentAt.toISOString()).toBe('2026-11-08T11:30:00.000Z');
  });
});
