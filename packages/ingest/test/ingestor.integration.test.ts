import { mediaFiles, messages, waGroups } from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { startQueue, type PgBoss } from '@reb/queue';
import type { MediaRef, ParsedMessage } from '@reb/whatsapp';
import { asc, eq } from 'drizzle-orm';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Ingestor, setWatched, syncGroups } from '../src/index.ts';

const GROUP = '120363000000000001@g.us';
const OTHER_GROUP = '120363000000000002@g.us';
const logger = pino({ level: 'silent' });

const text = (id: string, overrides: Partial<ParsedMessage & { kind: 'message' }> = {}) =>
  ({
    kind: 'message',
    groupJid: GROUP,
    waMessageId: id,
    senderHash: 'a'.repeat(64),
    sentAt: new Date('2026-10-25T10:00:00Z'),
    text: `listing ${id}`,
    quotedWaMessageId: null,
    isForwarded: false,
    media: null,
    ...overrides,
  }) satisfies ParsedMessage;

const withImage = (id: string, sizeBytes = 1000) =>
  text(id, {
    text: 'flyer',
    media: {
      kind: 'image',
      mimeType: 'image/jpeg',
      fileName: null,
      sizeBytes,
      ref: { kind: 'image', url: 'https://example/x', directPath: '/x', mediaKey: 'AQID' },
    },
  });

describe.skipIf(!testDatabaseUrl)('Ingestor (real Postgres and pg-boss)', () => {
  let testDb: TestDatabase;
  let boss: PgBoss;
  let mediaDir: string;
  let downloads: string[];
  let download: (ref: MediaRef) => Promise<Readable>;

  const ingestor = () =>
    new Ingestor({
      database: testDb.database,
      boss,
      logger,
      mediaDir,
      maxMediaBytes: 10_000,
      download: (ref) => download(ref),
      maxMediaAttempts: 3,
      groupRefreshMs: 60_000,
    });

  const jobCount = async () => {
    const result = await testDb.database.pool.query<{ n: string }>(
      `select count(*) as n from pgboss.job where name = 'preprocess'`,
    );
    return Number(result.rows[0]?.n);
  };
  const allMessages = () => testDb.database.db.select().from(messages).orderBy(asc(messages.id));
  const settle = async (ing: Ingestor) => {
    // wait for background downloads
    await ing.stop();
  };

  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
    boss = await startQueue(testDb.url, { supervise: false, onError: () => undefined });
  });

  afterAll(async () => {
    await boss.stop({ graceful: false });
    await testDb.drop();
  });

  beforeEach(async () => {
    await testDb.database.pool.query(
      `truncate media_files, messages, wa_groups restart identity cascade; delete from pgboss.job;`,
    );
    await syncGroups(testDb.database.db, [{ jid: GROUP, name: 'Developers EG' }], false);
    await setWatched(testDb.database.db, [GROUP], true);
    mediaDir = await mkdtemp(join(tmpdir(), 'reb-media-'));
    downloads = [];
    download = (ref) => {
      downloads.push(ref.url ?? '');
      return Promise.resolve(Readable.from([Buffer.from('fake image bytes')]));
    };
  });

  it('stores a text message and queues exactly one job', async () => {
    const ing = ingestor();
    await ing.start();
    expect(await ing.handle([text('M1')])).toEqual(['saved']);
    const [row] = await allMessages();
    expect(row).toMatchObject({
      waMessageId: 'M1',
      text: 'listing M1',
      status: 'pending',
      mediaType: 'none',
    });
    expect(row?.enqueuedAt).not.toBeNull();
    expect(await jobCount()).toBe(1);
    await settle(ing);
  });

  it('saving the same message again (reconnect, restart) changes nothing', async () => {
    const first = ingestor();
    await first.start();
    await first.handle([text('M1'), text('M2')]);
    await settle(first);
    // a "restarted" capture receives the same messages again, plus a new one
    const second = ingestor();
    await second.start();
    expect(await second.handle([text('M1'), text('M2'), text('M3')])).toEqual([
      'duplicate',
      'duplicate',
      'saved',
    ]);
    expect((await allMessages()).map((m) => m.waMessageId)).toEqual(['M1', 'M2', 'M3']);
    expect(await jobCount()).toBe(3);
    await settle(second);
  });

  it('does not store messages from unwatched groups, but registers the group', async () => {
    const ing = ingestor();
    await ing.start();
    expect(await ing.handle([text('X1', { groupJid: OTHER_GROUP })])).toEqual(['unwatched']);
    expect(await allMessages()).toEqual([]);
    expect(await jobCount()).toBe(0);
    const groups = await testDb.database.db.select().from(waGroups).orderBy(asc(waGroups.id));
    expect(groups.map((g) => [g.jid, g.watched])).toEqual([
      [GROUP, true],
      [OTHER_GROUP, false],
    ]);
    await settle(ing);
  });

  it('records quoted message IDs, forwarding, edits and deletions', async () => {
    const ing = ingestor();
    await ing.start();
    await ing.handle([
      text('M1'),
      text('M2', { quotedWaMessageId: 'M1', isForwarded: true }),
      {
        kind: 'edit',
        groupJid: GROUP,
        waMessageId: 'E1',
        senderHash: 'a'.repeat(64),
        sentAt: new Date(),
        editOfWaMessageId: 'M1',
        text: 'edited price',
      },
      { kind: 'revoke', groupJid: GROUP, targetWaMessageId: 'M2' },
    ]);
    const rows = await allMessages();
    expect(
      rows.map((r) => [
        r.waMessageId,
        r.quotedWaMessageId,
        r.isForwarded,
        r.editOfWaMessageId,
        r.text,
      ]),
    ).toEqual([
      ['M1', null, false, null, 'listing M1'],
      ['M2', 'M1', true, null, 'listing M2'],
      ['E1', null, false, 'M1', 'edited price'],
    ]);
    expect(rows[1]?.deletedAt).not.toBeNull();
    expect(await jobCount()).toBe(3);
    await settle(ing);
  });

  it('downloads media, stores it by hash, then queues the message', async () => {
    const ing = ingestor();
    await ing.start();
    await ing.handle([withImage('IMG1'), withImage('IMG2')]);
    await settle(ing);

    const files = await testDb.database.db.select().from(mediaFiles).orderBy(asc(mediaFiles.id));
    expect(files).toHaveLength(2);
    for (const file of files) {
      expect(file).toMatchObject({ status: 'downloaded', attempts: 1, sizeBytes: 16 });
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.path).toBe(
        `${file.sha256?.slice(0, 2)}/${file.sha256?.slice(2, 4)}/${file.sha256}.jpg`,
      );
    }
    // identical content: both rows point at the same single file on disk
    expect(files[0]?.path).toBe(files[1]?.path);
    expect(await readFile(join(mediaDir, files[0]?.path ?? ''), 'utf8')).toBe('fake image bytes');
    expect(await readdir(join(mediaDir, '.tmp'))).toEqual([]);
    expect(await jobCount()).toBe(2);
  });

  it('retries a failing download, then gives up and still queues the message', async () => {
    download = () => Promise.reject(new Error('media expired'));
    const ing = ingestor();
    await ing.start();
    await ing.handle([withImage('IMG1')]);
    await settle(ing);
    let [file] = await testDb.database.db.select().from(mediaFiles);
    expect(file).toMatchObject({ status: 'pending', attempts: 1, error: 'media expired' });
    expect(await jobCount()).toBe(0); // not queued while a retry is due

    const retry = ingestor(); // each start runs a sweep that retries pending downloads
    await retry.start();
    await settle(retry);
    const last = ingestor();
    await last.start();
    await settle(last);
    [file] = await testDb.database.db.select().from(mediaFiles);
    expect(file).toMatchObject({ status: 'failed', attempts: 3 });
    expect(await jobCount()).toBe(1);
  });

  it('skips files over MEDIA_MAX_BYTES without downloading them', async () => {
    const ing = ingestor();
    await ing.start();
    await ing.handle([withImage('BIG', 50_000)]);
    await settle(ing);
    expect(downloads).toEqual([]);
    const [file] = await testDb.database.db.select().from(mediaFiles);
    expect(file?.status).toBe('skipped');
    expect(await jobCount()).toBe(1);
  });

  it('stops a download that turns out bigger than announced', async () => {
    download = () => Promise.resolve(Readable.from([Buffer.alloc(20_000)]));
    const ing = ingestor();
    await ing.start();
    await ing.handle([withImage('LIAR', 100)]);
    await settle(ing);
    const [file] = await testDb.database.db.select().from(mediaFiles);
    expect(file?.status).toBe('skipped');
    expect(await readdir(join(mediaDir, '.tmp'))).toEqual([]);
    expect(await jobCount()).toBe(1);
  });

  it('after a crash mid-download, the next start finishes the download and queues once', async () => {
    // Simulate a crash: the message and its pending file are committed, but
    // the process died before downloading.
    let release: (() => void) | undefined;
    download = () =>
      new Promise((resolve) => {
        release = () => {
          resolve(Readable.from([Buffer.from('late bytes')]));
        };
      });
    const crashed = ingestor();
    await crashed.start();
    await crashed.handle([withImage('IMG1')]);
    expect(await jobCount()).toBe(0);
    // the old process never finishes this download
    download = () => Promise.resolve(Readable.from([Buffer.from('late bytes')]));

    const restarted = ingestor();
    await restarted.start();
    await settle(restarted);
    expect(await jobCount()).toBe(1);
    const [file] = await testDb.database.db.select().from(mediaFiles);
    expect(file?.status).toBe('downloaded');

    // the stale download from the "dead" process finishing late must not
    // queue a second job
    release?.();
    await settle(crashed);
    expect(await jobCount()).toBe(1);
  });

  it('queues a stored message whose job was somehow never queued', async () => {
    const ing = ingestor();
    await ing.start();
    await ing.handle([text('M1')]);
    await settle(ing);
    await testDb.database.pool.query(`delete from pgboss.job`);
    await testDb.database.db
      .update(messages)
      .set({ enqueuedAt: null })
      .where(eq(messages.waMessageId, 'M1'));
    const next = ingestor();
    await next.start();
    await settle(next);
    expect(await jobCount()).toBe(1);
  });

  it('keeps group and sender details out of stored media paths and references', async () => {
    const ing = ingestor();
    await ing.start();
    await ing.handle([withImage('IMG1')]);
    await settle(ing);
    const [file] = await testDb.database.db.select().from(mediaFiles);
    expect(file?.path).not.toContain(GROUP);
    expect(JSON.stringify(file?.mediaRef)).not.toMatch(/whatsapp\.net|@lid/);
    await rm(mediaDir, { recursive: true, force: true });
  });
});

describe.skipIf(!testDatabaseUrl)('capture path: raw WhatsApp message → database', () => {
  let testDb: TestDatabase;
  let boss: PgBoss;
  const SALT = 'pipeline-test-salt-pipeline-test-salt';
  const PHONE = '201001234567';

  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
    boss = await startQueue(testDb.url, { supervise: false, onError: () => undefined });
  });
  afterAll(async () => {
    await boss.stop({ graceful: false });
    await testDb.drop();
  });

  it('stores the listing and queues it, with no phone number or name anywhere', async () => {
    const { parseMessage } = await import('@reb/whatsapp');
    await syncGroups(testDb.database.db, [{ jid: GROUP, name: 'Brokers' }], true);
    await setWatched(testDb.database.db, [GROUP], true);
    const ingestor = new Ingestor({
      database: testDb.database,
      boss,
      logger,
      mediaDir: await mkdtemp(join(tmpdir(), 'reb-media-')),
      maxMediaBytes: 10_000,
      download: () => Promise.resolve(Readable.from([Buffer.from('x')])),
    });
    await ingestor.start();
    const raw = {
      key: {
        remoteJid: GROUP,
        id: '3EB0ABC',
        fromMe: false,
        participant: '111111111111111@lid',
        participantAlt: `${PHONE}@s.whatsapp.net`,
      },
      pushName: 'Ahmed Broker',
      messageTimestamp: 1_792_000_000,
      message: { conversation: 'للبيع شقة 150م في ميفيدا 9 مليون' },
    };
    expect(await ingestor.handle([parseMessage(raw, SALT)])).toEqual(['saved']);
    await ingestor.stop();

    const dump = await testDb.database.pool.query<{ row: string }>(
      `select row_to_json(m)::text as row from messages m
       union all select row_to_json(g)::text from wa_groups g`,
    );
    const everything = dump.rows.map((r) => r.row).join('\n');
    expect(everything).toContain('للبيع شقة 150م في ميفيدا 9 مليون');
    expect(everything).not.toContain(PHONE);
    expect(everything).not.toContain('111111111111111');
    expect(everything).not.toContain('Ahmed');
    const jobs = await testDb.database.pool.query(
      `select data from pgboss.job where name = 'preprocess'`,
    );
    expect(jobs.rows).toEqual([{ data: { messageId: 1 } }]);
  });
});
