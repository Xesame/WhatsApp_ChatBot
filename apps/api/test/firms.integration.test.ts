import { createAuth, upsertOwner } from '@reb/auth';
import {
  auditLog,
  mediaFiles,
  messages,
  projects,
  units,
  unitSources,
  usageEvents,
  waGroups,
} from '@reb/db';
import { seed } from '@reb/db/seed-runner';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import type { PgBoss } from '@reb/queue';
import { createLogger } from '@reb/runtime';
import { eq } from 'drizzle-orm';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';

const PUBLIC_URL = 'http://localhost:4173';
const PASSWORD = 'a long enough password';

describe.skipIf(!testDatabaseUrl)(
  'firm dashboard API and tenancy (real Postgres, real Better Auth)',
  () => {
    let testDb: TestDatabase;
    let app: ReturnType<typeof buildApp>;
    let mediaDir: string;
    let ip = 0;
    const cookie: Record<string, string> = {};
    const userId: Record<string, string> = {};
    let firmA = 0;
    let firmB = 0;
    let unitId = 0;
    let withdrawnId = 0;
    let mediaId = 0;

    const call = (who: string | null, method: string, url: string, payload?: unknown) =>
      app.inject({
        method: method as 'GET',
        url,
        headers: {
          origin: PUBLIC_URL,
          'x-forwarded-for': `10.3.${ip++ % 250}.1`,
          ...(who ? { cookie: cookie[who] ?? '' } : {}),
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        },
        payload: payload === undefined ? undefined : JSON.stringify(payload),
      });
    const signIn = async (who: string, email: string, password = PASSWORD) => {
      const response = await call(null, 'POST', '/api/auth/sign-in/email', { email, password });
      if (response.statusCode === 200)
        cookie[who] = String(response.headers['set-cookie']).split(';')[0] ?? '';
      return response.statusCode;
    };
    /** Invites through the API, opens the link like a browser would, sets the password and signs in. */
    const onboard = async (
      inviter: string,
      url: string,
      who: string,
      body: Record<string, unknown>,
    ) => {
      const invited = await call(inviter, 'POST', url, body);
      expect(invited.statusCode, invited.body).toBe(201);
      const { link, userId: id } = invited.json<{ link: string; userId: string }>();
      expect(link.startsWith(`${PUBLIC_URL}/set-password#`)).toBe(true);
      const token = link.split('#')[1] ?? '';
      expect((await call(null, 'POST', '/api/links/info', { token })).json()).toMatchObject({
        email: body.email,
        purpose: 'invite',
      });
      expect(
        (await call(null, 'POST', '/api/links/redeem', { token, password: PASSWORD })).statusCode,
      ).toBe(200);
      userId[who] = id;
      expect(await signIn(who, String(body.email))).toBe(200);
    };

    beforeAll(async () => {
      testDb = await createTestDatabase(testDatabaseUrl ?? '');
      const { db } = testDb.database;
      await seed(db);
      mediaDir = await mkdtemp(join(tmpdir(), 'reb-media-'));
      await upsertOwner(db, { name: 'Hassan', email: 'owner@example.com', password: PASSWORD });
      app = buildApp({
        logger: createLogger('api', 'silent'),
        database: testDb.database,
        admin: {
          auth: createAuth(db, { secret: 'z'.repeat(32), baseUrl: PUBLIC_URL }),
          boss: {} as PgBoss,
          mediaDir,
          publicUrl: PUBLIC_URL,
          usdEgpRateFallback: 50,
        },
      });
      await app.ready();
      expect(await signIn('owner', 'owner@example.com')).toBe(200);

      firmA = (
        await call('owner', 'POST', '/api/admin/firms', { name: 'Alpha Realty', maxUsers: 5 })
      ).json<{ id: number }>().id;
      firmB = (await call('owner', 'POST', '/api/admin/firms', { name: 'Beta Homes' })).json<{
        id: number;
      }>().id;
      await onboard('owner', `/api/admin/firms/${firmA}/invitations`, 'adminA', {
        name: 'Alpha Admin',
        email: 'admin@alpha.example',
        role: 'firm_admin',
      });
      await onboard('owner', `/api/admin/firms/${firmB}/invitations`, 'adminB', {
        name: 'Beta Admin',
        email: 'admin@beta.example',
        role: 'firm_admin',
      });
      await onboard('adminA', '/api/app/team', 'agentA', {
        name: 'Alpha Agent',
        email: 'agent@alpha.example',
      });
      await onboard('adminB', '/api/app/team', 'agentB', {
        name: 'Beta Agent',
        email: 'agent@beta.example',
      });

      // two listings: one visible, one withdrawn
      const [mivida] = await db.select().from(projects).where(eq(projects.nameEn, 'Mivida'));
      const [group] = await db
        .insert(waGroups)
        .values({
          jid: 'g@g.us',
          name: 'Private Source Group',
          sourceType: 'developer',
          watched: true,
        })
        .returning();
      const [message] = await db
        .insert(messages)
        .values({
          groupId: group?.id ?? 0,
          waMessageId: 'a',
          senderHash: 'sender-hash-xyz',
          sentAt: new Date(),
          text: 'Mivida 3BR call 01001234567',
          status: 'processed',
          mediaType: 'image',
        })
        .returning();
      const base = {
        projectId: mivida?.id,
        developerId: mivida?.developerId,
        cityId: mivida?.cityId,
        confidence: 1,
        needsReview: false,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      };
      const [unit] = await db
        .insert(units)
        .values({
          ...base,
          unitType: 'Apartment',
          bedrooms: 3,
          minArea: 165,
          maxArea: 165,
          minPrice: 980_000_000,
          maxPrice: 980_000_000,
        })
        .returning();
      const [gone] = await db
        .insert(units)
        .values({ ...base, unitType: 'Villa', status: 'withdrawn' })
        .returning();
      await db
        .insert(unitSources)
        .values([{ unitId: unit?.id ?? 0, messageId: message?.id ?? 0, role: 'listing' }]);
      await mkdir(join(mediaDir, 'ab'), { recursive: true });
      await writeFile(join(mediaDir, 'ab', 'f.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
      const [file] = await db
        .insert(mediaFiles)
        .values({
          messageId: message?.id ?? 0,
          kind: 'image',
          mimeType: 'image/jpeg',
          path: 'ab/f.jpg',
          status: 'downloaded',
          mediaRef: {},
        })
        .returning();
      unitId = unit?.id ?? 0;
      withdrawnId = gone?.id ?? 0;
      mediaId = file?.id ?? 0;
    });
    afterAll(async () => {
      await app.close();
      await testDb.drop();
      await rm(mediaDir, { recursive: true, force: true });
    });

    it('firm users cannot use the owner console', async () => {
      for (const who of ['adminA', 'agentA']) {
        expect((await call(who, 'GET', '/api/admin/firms')).statusCode).toBe(403);
        expect((await call(who, 'POST', '/api/admin/firms', { name: 'Mine' })).statusCode).toBe(
          403,
        );
        expect((await call(who, 'GET', '/api/admin/review')).statusCode).toBe(403);
      }
      expect((await call(null, 'GET', '/api/app/listings')).statusCode).toBe(401);
    });

    it('shows who is signed in, with their firm, and keeps their language', async () => {
      expect((await call('agentA', 'GET', '/api/app/me')).json()).toMatchObject({
        role: 'agent',
        locale: 'ar',
        firm: { id: firmA, name: 'Alpha Realty' },
      });
      await call('agentA', 'PUT', '/api/app/me/locale', { locale: 'en' });
      await signIn('agentA', 'agent@alpha.example');
      expect((await call('agentA', 'GET', '/api/app/me')).json()).toMatchObject({ locale: 'en' });
    });

    it('searches listings and logs searches per firm', async () => {
      const result = (
        await call('agentA', 'GET', '/api/app/listings?q=mivida&bedroomsMin=3')
      ).json<{ total: number; items: { id: number }[] }>();
      expect(result.total).toBe(1);
      expect(result.items[0]?.id).toBe(unitId);
      expect((await call('agentA', 'GET', '/api/app/listings?statuses=withdrawn')).statusCode).toBe(
        400,
      );
      expect((await call('agentA', 'GET', '/api/app/listings?firmId=2')).statusCode).toBe(400);
      const usage = await testDb.database.db
        .select()
        .from(usageEvents)
        .where(eq(usageEvents.kind, 'search'));
      expect(usage.map((u) => u.firmId)).toEqual([firmA]);
    });

    it('listing page: no sender, no group, no phone numbers; withdrawn listings are not found', async () => {
      const response = await call('agentA', 'GET', `/api/app/listings/${unitId}`);
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('sender-hash-xyz');
      expect(response.body).not.toContain('Private Source Group');
      expect(response.body).not.toContain('01001234567');
      expect(response.json()).toMatchObject({
        sources: [{ postedIn: 'developer', media: { id: mediaId } }],
        notes: [],
      });
      expect((await call('agentA', 'GET', `/api/app/listings/${withdrawnId}`)).statusCode).toBe(
        404,
      );
      expect((await call('agentA', 'GET', `/api/app/media/${mediaId}`)).statusCode).toBe(200);
    });

    it('exports the current search as Excel or CSV, logged per firm', async () => {
      const xlsx = await call('agentB', 'GET', '/api/app/export?q=mivida');
      expect(xlsx.statusCode).toBe(200);
      expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
      const csv = await call('agentB', 'GET', '/api/app/export?q=mivida&format=csv');
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.body.split('\r\n')).toHaveLength(3); // header, one listing, final line break
      const exports = await testDb.database.db
        .select()
        .from(usageEvents)
        .where(eq(usageEvents.kind, 'export'));
      expect(exports.map((e) => e.firmId)).toEqual([firmB, firmB]);
      expect(
        (
          await testDb.database.db
            .select()
            .from(auditLog)
            .where(eq(auditLog.action, 'units.export'))
        ).length,
      ).toBe(2);
    });

    describe('acceptance: a firm user can never read another firm’s notes, searches or users', () => {
      let noteId = 0;
      let searchId = 0;

      beforeAll(async () => {
        noteId = (
          await call('agentA', 'POST', `/api/app/listings/${unitId}/notes`, {
            body: 'Alpha client is interested',
          })
        ).json<{ id: number }>().id;
        searchId = (
          await call('agentA', 'POST', '/api/app/saved-searches', {
            name: 'Mivida 3BR',
            filters: { q: 'mivida', bedroomsMin: 3 },
            alertChannel: 'none',
            active: true,
          })
        ).json<{ id: number }>().id;
      });

      it('notes', async () => {
        const notesOf = async (who: string) =>
          (await call(who, 'GET', `/api/app/listings/${unitId}`))
            .json<{ notes: { body: string }[] }>()
            .notes.map((n) => n.body);
        expect(await notesOf('agentA')).toEqual(['Alpha client is interested']);
        expect(await notesOf('adminA')).toEqual(['Alpha client is interested']);
        expect(await notesOf('agentB')).toEqual([]);
        expect(await notesOf('adminB')).toEqual([]);
        expect(await notesOf('owner')).toEqual([]);
        expect((await call('agentB', 'DELETE', `/api/app/notes/${noteId}`)).statusCode).toBe(404);
        expect((await call('adminB', 'DELETE', `/api/app/notes/${noteId}`)).statusCode).toBe(404);
        expect(
          (await call('owner', 'POST', `/api/app/listings/${unitId}/notes`, { body: 'x' }))
            .statusCode,
        ).toBe(403);
      });

      it('saved searches', async () => {
        const names = async (who: string) =>
          (await call(who, 'GET', '/api/app/saved-searches'))
            .json<{ name: string }[]>()
            .map((s) => s.name);
        expect(await names('agentA')).toEqual(['Mivida 3BR']);
        expect(await names('adminA')).toEqual(['Mivida 3BR']);
        expect(await names('agentB')).toEqual([]);
        expect(await names('adminB')).toEqual([]);
        expect(
          (await call('adminB', 'PATCH', `/api/app/saved-searches/${searchId}`, { name: 'taken' }))
            .statusCode,
        ).toBe(404);
        expect(
          (await call('agentB', 'DELETE', `/api/app/saved-searches/${searchId}`)).statusCode,
        ).toBe(404);
        expect(await names('agentA')).toEqual(['Mivida 3BR']);
      });

      it('users', async () => {
        const team = async (who: string) =>
          (await call(who, 'GET', '/api/app/team'))
            .json<{ email: string }[]>()
            .map((m) => m.email)
            .sort();
        expect(await team('adminA')).toEqual(['admin@alpha.example', 'agent@alpha.example']);
        expect(await team('adminB')).toEqual(['admin@beta.example', 'agent@beta.example']);
        expect((await call('agentA', 'GET', '/api/app/team')).statusCode).toBe(403);
        expect(
          (await call('adminB', 'POST', `/api/app/team/${userId.agentA}/link`)).statusCode,
        ).toBe(404);
        expect(
          (await call('adminB', 'PATCH', `/api/app/team/${userId.agentA}`, { removed: true }))
            .statusCode,
        ).toBe(404);
        expect((await call('agentA', 'GET', '/api/app/me')).statusCode).toBe(200); // untouched
      });

      it('usage', async () => {
        const kinds = async (who: string) =>
          (await call(who, 'GET', '/api/app/usage'))
            .json<{ kind: string }[]>()
            .map((u) => u.kind)
            .sort();
        expect(await kinds('adminA')).toEqual(['listing_view', 'search']);
        expect(await kinds('adminB')).toEqual(['export', 'listing_view']); // Beta's own views only
        expect((await call('agentB', 'GET', '/api/app/usage')).statusCode).toBe(403);
      });
    });

    it('removing an agent or suspending a firm ends access at once, even mid-session', async () => {
      expect(
        (await call('adminA', 'PATCH', `/api/app/team/${userId.agentA}`, { removed: true }))
          .statusCode,
      ).toBe(200);
      expect((await call('agentA', 'GET', '/api/app/listings')).statusCode).toBe(401); // sessions deleted
      expect(await signIn('agentA', 'agent@alpha.example')).toBe(403);

      const before = cookie.agentB ?? '';
      expect(
        (await call('owner', 'PATCH', `/api/admin/firms/${firmB}`, { status: 'suspended' }))
          .statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ url: '/api/app/me', headers: { cookie: before } })).statusCode,
      ).toBe(401);
      expect(await signIn('agentB', 'agent@beta.example')).toBe(403);
      await call('owner', 'PATCH', `/api/admin/firms/${firmB}`, { status: 'active' });
      expect(await signIn('agentB', 'agent@beta.example')).toBe(200);
    });

    it('a password-reset link from the firm admin works once', async () => {
      expect(await signIn('adminB', 'admin@beta.example')).toBe(200); // suspension signed everyone out
      const { link, purpose } = (
        await call('adminB', 'POST', `/api/app/team/${userId.agentB}/link`)
      ).json<{ link: string; purpose: string }>();
      expect(purpose).toBe('reset');
      const token = link.split('#')[1] ?? '';
      expect(
        (await call(null, 'POST', '/api/links/redeem', { token, password: 'brand new password' }))
          .statusCode,
      ).toBe(200);
      expect(
        (await call(null, 'POST', '/api/links/redeem', { token, password: 'another password!' }))
          .statusCode,
      ).toBe(409);
      expect(await signIn('agentB', 'agent@beta.example', 'brand new password')).toBe(200);
    });

    it('the owner sees every firm with its users and usage', async () => {
      const list = (await call('owner', 'GET', '/api/admin/firms')).json<
        { name: string; activeUsers: number; exports30d: number }[]
      >();
      expect(list.map((f) => [f.name, f.activeUsers, f.exports30d])).toEqual([
        ['Alpha Realty', 1, 0],
        ['Beta Homes', 2, 2],
      ]);
    });
  },
);
