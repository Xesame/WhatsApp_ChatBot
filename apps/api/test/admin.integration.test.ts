import { createAuth, upsertOwner } from '@reb/auth';
import { auditLog, mediaFiles, messages, units, unitSources, waGroups, users } from '@reb/db';
import { seed } from '@reb/db/seed-runner';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { startQueue, type PgBoss } from '@reb/queue';
import { createLogger } from '@reb/runtime';
import { eq } from 'drizzle-orm';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { failedJobs } from '@reb/admin';
import { buildApp } from '../src/app.ts';

const PUBLIC_URL = 'http://localhost:4173';

describe.skipIf(!testDatabaseUrl)('admin API (real Postgres, real Better Auth)', () => {
  let testDb: TestDatabase;
  let app: ReturnType<typeof buildApp>;
  let mediaDir: string;
  let cookie = '';
  const retried: string[] = [];

  const as = (c: string) => ({ cookie: c, origin: PUBLIC_URL });
  const signIn = (email: string, password: string, ip = '10.1.1.1') =>
    app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json', origin: PUBLIC_URL, 'x-forwarded-for': ip },
      payload: { email, password },
    });

  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
    await seed(testDb.database.db);
    mediaDir = await mkdtemp(join(tmpdir(), 'reb-media-'));
    await upsertOwner(testDb.database.db, {
      name: 'Hassan',
      email: 'owner@example.com',
      password: 'correct horse battery',
    });
    app = buildApp({
      logger: createLogger('api', 'silent'),
      database: testDb.database,
      admin: {
        auth: createAuth(testDb.database.db, { secret: 'y'.repeat(32), baseUrl: PUBLIC_URL }),
        boss: {
          retry: (queue: string, id: string) => retried.push(`${queue}/${id}`),
        } as unknown as PgBoss,
        mediaDir,
        publicUrl: PUBLIC_URL,
        usdEgpRateFallback: undefined,
      },
    });
    await app.ready();
    const response = await signIn('owner@example.com', 'correct horse battery');
    expect(response.statusCode).toBe(200);
    cookie = String(response.headers['set-cookie']).split(';')[0] ?? '';
  });
  afterAll(async () => {
    await app.close();
    await testDb.drop();
    await rm(mediaDir, { recursive: true, force: true });
  });

  it('refuses every admin route without a signed-in owner', async () => {
    for (const url of [
      '/api/admin/me',
      '/api/admin/review',
      '/api/admin/groups',
      '/api/admin/media/1',
      '/api/admin/export.xlsx',
    ]) {
      expect((await app.inject({ url })).statusCode, url).toBe(401);
    }
    expect(
      (
        await app.inject({
          url: '/api/admin/me',
          headers: { cookie: 'better-auth.session_token=forged' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('refuses a signed-in user who is not the owner', async () => {
    const { id } = await upsertOwner(testDb.database.db, {
      name: 'Agent',
      email: 'agent@example.com',
      password: 'agent password 1',
    });
    await testDb.database.db.update(users).set({ role: 'agent' }).where(eq(users.id, id));
    const response = await signIn('agent@example.com', 'agent password 1', '10.1.1.2');
    const agentCookie = String(response.headers['set-cookie']).split(';')[0] ?? '';
    expect(
      (await app.inject({ url: '/api/admin/me', headers: { cookie: agentCookie } })).statusCode,
    ).toBe(403);
  });

  it('records sign-ins, failed ones included, in the audit log', async () => {
    expect((await signIn('owner@example.com', 'not the password', '10.1.1.3')).statusCode).toBe(
      401,
    );
    const rows = await testDb.database.db.select().from(auditLog);
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['login', 'login_failed']));
    const failed = rows.find((r) => r.action === 'login_failed');
    expect(failed?.details).toMatchObject({ email: 'owner@example.com' });
    expect(JSON.stringify(rows)).not.toContain('not the password');
  });

  it('limits password guessing', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++)
      statuses.push(
        (await signIn('owner@example.com', `guess number ${i}`, '10.9.9.9')).statusCode,
      );
    expect(statuses).toContain(429);
  });

  it('a forged X-Forwarded-For does not get around the limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push(
        (await signIn('owner@example.com', `guess ${i}`, `1.2.3.${i}, 10.8.8.8`)).statusCode,
      );
    }
    expect(statuses).toContain(429);
  });

  it('returns the signed-in owner', async () => {
    const response = await app.inject({ url: '/api/admin/me', headers: as(cookie) });
    expect(response.json()).toMatchObject({ email: 'owner@example.com', role: 'owner' });
  });

  it('refuses changes sent from another site', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/usd-egp-rate',
      headers: { cookie, origin: 'https://evil.example' },
      payload: { value: 1 },
    });
    expect(response.statusCode).toBe(403);
  });

  it('acceptance: choose groups to watch from the browser', async () => {
    const [group] = await testDb.database.db
      .insert(waGroups)
      .values({ jid: 'x@g.us', name: 'New Cairo Brokers' })
      .returning();
    const list = await app.inject({ url: '/api/admin/groups', headers: as(cookie) });
    expect(list.json()).toEqual([
      expect.objectContaining({ id: group?.id, watched: false, messages: 0 }),
    ]);
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/admin/groups/${String(group?.id)}`,
      headers: as(cookie),
      payload: { watched: true, sourceType: 'broker' },
    });
    expect(patched.json()).toMatchObject({ watched: true, sourceType: 'broker' });
    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/admin/groups/1',
      headers: as(cookie),
      payload: { jid: 'other' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('acceptance: review a flagged unit, see its flyer, correct and approve it', async () => {
    const { db } = testDb.database;
    const [group] = await db.select().from(waGroups);
    const [message] = await db
      .insert(messages)
      .values({
        groupId: group?.id ?? 0,
        waMessageId: 'M1',
        senderHash: 'h',
        sentAt: new Date(),
        text: 'Mivida flyer',
        status: 'processed',
        mediaType: 'image',
      })
      .returning();
    await mkdir(join(mediaDir, 'ab'), { recursive: true });
    await writeFile(join(mediaDir, 'ab', 'flyer.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const [media] = await db
      .insert(mediaFiles)
      .values({
        messageId: message?.id ?? 0,
        kind: 'image',
        mimeType: 'image/jpeg',
        path: 'ab/flyer.jpg',
        status: 'downloaded',
        mediaRef: {},
      })
      .returning();
    const [unit] = await db
      .insert(units)
      .values({
        unitType: 'Apartment',
        bedrooms: 2,
        confidence: 0.5,
        needsReview: true,
        reviewReasons: ['project name unclear'],
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      })
      .returning();
    await db
      .insert(unitSources)
      .values({ unitId: unit?.id ?? 0, messageId: message?.id ?? 0, role: 'listing' });

    const queue = (await app.inject({ url: '/api/admin/review', headers: as(cookie) })).json<{
      items: { unit: { id: number }; sources: { media: { id: number } }[] }[];
      remaining: number;
    }>();
    expect(queue.remaining).toBe(1);
    expect(queue.items[0]?.sources[0]?.media.id).toBe(media?.id);

    const image = await app.inject({
      url: `/api/admin/media/${String(media?.id)}`,
      headers: as(cookie),
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.rawPayload).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

    const invalid = await app.inject({
      method: 'POST',
      url: `/api/admin/units/${String(unit?.id)}/review`,
      headers: as(cookie),
      payload: { action: 'save', changes: { bedrooms: -3 } },
    });
    expect(invalid.statusCode).toBe(400);

    const approved = await app.inject({
      method: 'POST',
      url: `/api/admin/units/${String(unit?.id)}/review`,
      headers: as(cookie),
      payload: { action: 'approve', changes: { bedrooms: 3 } },
    });
    expect(approved.json()).toMatchObject({ bedrooms: 3, needsReview: false });
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, 'unit.approve'));
    expect(audits[0]?.target).toBe(`unit:${String(unit?.id)}`);
    expect(
      (await app.inject({ url: '/api/admin/units/999999', headers: as(cookie) })).statusCode,
    ).toBe(404);
  });

  it('never serves files outside the media folder', async () => {
    const { db } = testDb.database;
    const [message] = await db.select().from(messages);
    await db.delete(mediaFiles);
    const [evil] = await db
      .insert(mediaFiles)
      .values({
        messageId: message?.id ?? 0,
        kind: 'document',
        path: '../../etc/passwd',
        status: 'downloaded',
        mediaRef: {},
      })
      .returning();
    expect(
      (await app.inject({ url: `/api/admin/media/${String(evil?.id)}`, headers: as(cookie) }))
        .statusCode,
    ).toBe(404);
  });

  it('manages spellings and refuses a project without developer and city', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/entities/developer',
      headers: as(cookie),
      payload: { nameEn: 'Acme Developments', nameAr: 'أكمي' },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: number }>();
    await app.inject({
      method: 'POST',
      url: `/api/admin/entities/developer/${String(id)}/aliases`,
      headers: as(cookie),
      payload: { alias: 'Akmi' },
    });
    const list = (
      await app.inject({ url: '/api/admin/entities/developer?search=Acme', headers: as(cookie) })
    ).json<{ aliases: { alias: string }[] }[]>();
    expect(list[0]?.aliases.map((a) => a.alias)).toContain('Akmi');
    const project = await app.inject({
      method: 'POST',
      url: '/api/admin/entities/project',
      headers: as(cookie),
      payload: { nameEn: 'P', nameAr: 'ب' },
    });
    expect(project.statusCode).toBe(400);
    const self = await app.inject({
      method: 'POST',
      url: `/api/admin/entities/developer/${String(id)}/merge`,
      headers: as(cookie),
      payload: { intoId: id },
    });
    expect(self.statusCode).toBe(400);
  });

  it('sets the USD rate, and exports need it only when a unit is in USD', async () => {
    const rate = await app.inject({
      method: 'PUT',
      url: '/api/admin/settings/usd-egp-rate',
      headers: as(cookie),
      payload: { value: 49.5 },
    });
    expect(rate.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/admin/settings', headers: as(cookie) })).json()).toEqual({
      usdEgpRate: 49.5,
      usdEgpRateFallback: null,
    });
    const file = await app.inject({ url: '/api/admin/export.xlsx?all=true', headers: as(cookie) });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-disposition']).toMatch(/attachment; filename="primary-units-/);
    expect(file.rawPayload.subarray(0, 2).toString()).toBe('PK'); // a zip, i.e. an .xlsx
  });

  it('shows stats and retries failed jobs', async () => {
    expect(
      (await app.inject({ url: '/api/admin/stats?days=7', headers: as(cookie) })).json(),
    ).toHaveProperty('days');
    expect(
      (await app.inject({ url: '/api/admin/jobs/failed', headers: as(cookie) })).statusCode,
    ).toBe(200);
    const id = '00000000-0000-4000-8000-000000000001';
    const retry = await app.inject({
      method: 'POST',
      url: `/api/admin/jobs/extract/${id}/retry`,
      headers: as(cookie),
    });
    expect(retry.statusCode).toBe(200);
    expect(retried).toEqual([`extract/${id}`]);
  });

  it('lists a real failed pg-boss job with its error, and retrying puts it back in the queue', async () => {
    const boss = await startQueue(testDb.url, { supervise: false, onError: () => undefined });
    try {
      const id = await boss.send('extract', { messageId: 1 }, { retryLimit: 0 });
      const [job] = await boss.fetch('extract');
      expect(job?.id).toBe(id);
      await boss.fail('extract', job?.id ?? '', { message: 'model returned nothing' });
      const failed = await failedJobs(testDb.database);
      expect(failed).toEqual([
        expect.objectContaining({ id, queue: 'extract', error: 'model returned nothing' }),
      ]);
      await boss.retry('extract', id ?? '');
      expect(await failedJobs(testDb.database)).toEqual([]);
    } finally {
      await boss.stop({ graceful: false });
    }
  });

  it('signs out', async () => {
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { ...as(cookie), 'content-type': 'application/json' },
      payload: {},
    });
    expect(out.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/admin/me', headers: as(cookie) })).statusCode).toBe(401);
  });
});
