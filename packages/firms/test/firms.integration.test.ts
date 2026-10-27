import { accessProblem, createAuth, upsertOwner } from '@reb/auth';
import {
  accessLinks,
  messages,
  sessions,
  units,
  unitSources,
  usageEvents,
  waGroups,
} from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accessLinkInfo,
  addNote,
  createFirm,
  createSavedSearch,
  deleteNote,
  deleteSavedSearch,
  inviteUser,
  listFirms,
  listNotes,
  listSavedSearches,
  listTeam,
  newAccessLink,
  recordUsage,
  redeemAccessLink,
  setRemoved,
  updateFirm,
  updateSavedSearch,
  type Actor,
} from '../src/index.ts';

describe.skipIf(!testDatabaseUrl)('firms and tenancy (real Postgres)', () => {
  let testDb: TestDatabase;
  let owner: Actor;
  let firmA = 0;
  let firmB = 0;
  let adminA: Actor;
  let agentA1: Actor;
  let agentA2: Actor;
  let adminB: Actor;
  let agentB: Actor;
  let unitId = 0;
  const PASSWORD = 'a good long password';
  const db = () => testDb.database.db;

  const join = async (
    actor: Actor,
    firmId: number,
    email: string,
    role: 'firm_admin' | 'agent',
  ) => {
    const { userId, token } = await inviteUser(db(), actor, firmId, {
      name: email.split('@')[0] ?? email,
      email,
      role,
    });
    await redeemAccessLink(db(), token, PASSWORD);
    return { userId, role, firmId } satisfies Actor;
  };
  const signIn = (email: string, password = PASSWORD) =>
    createAuth(db(), { secret: 's'.repeat(32), baseUrl: 'http://localhost:4173' }).handler(
      new Request('http://localhost:4173/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:4173',
          'x-forwarded-for': `10.2.${Math.floor(Math.random() * 250)}.1`,
        },
        body: JSON.stringify({ email, password }),
      }),
    );

  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
    const { id } = await upsertOwner(db(), {
      name: 'Hassan',
      email: 'owner@example.com',
      password: PASSWORD,
    });
    owner = { userId: id, role: 'owner', firmId: null };
    firmA = await createFirm(db(), owner, { name: 'Alpha Realty', maxUsers: 4 });
    firmB = await createFirm(db(), owner, { name: 'Beta Homes' });
    adminA = await join(owner, firmA, 'admin@alpha.example', 'firm_admin');
    agentA1 = await join(adminA, firmA, 'one@alpha.example', 'agent');
    agentA2 = await join(adminA, firmA, 'two@alpha.example', 'agent');
    adminB = await join(owner, firmB, 'admin@beta.example', 'firm_admin');
    agentB = await join(adminB, firmB, 'agent@beta.example', 'agent');
    const [g] = await db().insert(waGroups).values({ jid: 'g@g.us' }).returning();
    const [m] = await db()
      .insert(messages)
      .values({
        groupId: g?.id ?? 0,
        waMessageId: 'x',
        senderHash: 'h',
        sentAt: new Date(),
        status: 'processed',
      })
      .returning();
    const [u] = await db()
      .insert(units)
      .values({
        unitType: 'Apartment',
        confidence: 1,
        needsReview: false,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      })
      .returning();
    await db()
      .insert(unitSources)
      .values({ unitId: u?.id ?? 0, messageId: m?.id ?? 0, role: 'listing' });
    unitId = u?.id ?? 0;
  });
  afterAll(async () => {
    await testDb.drop();
  });

  describe('firms (owner only)', () => {
    it('only the owner creates or changes firms; names are unique', async () => {
      await expect(createFirm(db(), adminA, { name: 'Sneaky' })).rejects.toThrow(/owner/);
      await expect(updateFirm(db(), adminA, firmA, { maxUsers: 999 })).rejects.toThrow(/owner/);
      await expect(listFirms(db(), agentA1)).rejects.toThrow(/owner/);
      await expect(createFirm(db(), owner, { name: 'Alpha Realty' })).rejects.toThrow(
        /already exists/,
      );
    });
  });

  describe('invitations and links', () => {
    it('an invited person sets a password once, then signs in', async () => {
      const { token } = await inviteUser(db(), owner, firmB, {
        name: 'New',
        email: 'New@Beta.example',
        role: 'agent',
        locale: 'ar',
      });
      expect(await accessLinkInfo(db(), token)).toEqual({
        purpose: 'invite',
        name: 'New',
        email: 'new@beta.example',
        firmName: 'Beta Homes',
        locale: 'ar',
      });
      expect((await signIn('new@beta.example')).status).toBe(401); // no password yet
      await redeemAccessLink(db(), token, PASSWORD);
      expect((await signIn('new@beta.example')).status).toBe(200);
      await expect(redeemAccessLink(db(), token, 'another long password')).rejects.toThrow(
        /expired or was already used/,
      );
      expect(await accessLinkInfo(db(), token)).toBeNull();
    });

    it('stores only a hash of the token, and links expire', async () => {
      const { token } = await newAccessLink(db(), adminA, agentA1.userId);
      const rows = await db().select().from(accessLinks);
      expect(JSON.stringify(rows)).not.toContain(token);
      expect(
        await accessLinkInfo(db(), token, new Date(Date.now() + 2 * 24 * 3600 * 1000)),
      ).toBeNull(); // reset links last a day
    });

    it('a new link replaces the previous one; a reset signs the person out elsewhere', async () => {
      const first = await newAccessLink(db(), adminA, agentA1.userId);
      const second = await newAccessLink(db(), adminA, agentA1.userId);
      expect(second.purpose).toBe('reset');
      expect(await accessLinkInfo(db(), first.token)).toBeNull();
      expect((await signIn('one@alpha.example')).status).toBe(200);
      await redeemAccessLink(db(), second.token, 'my new password 2');
      expect(await db().select().from(sessions).where(eq(sessions.userId, agentA1.userId))).toEqual(
        [],
      );
      expect((await signIn('one@alpha.example', 'my new password 2')).status).toBe(200);
    });

    it('firm admins invite agents to their own firm only; limits and e-mails are enforced', async () => {
      await expect(
        inviteUser(db(), adminA, firmA, {
          name: 'X',
          email: 'x@alpha.example',
          role: 'firm_admin',
        }),
      ).rejects.toThrow(/Only the owner/);
      await expect(
        inviteUser(db(), adminA, firmB, { name: 'X', email: 'x@beta.example', role: 'agent' }),
      ).rejects.toThrow(/Not allowed/);
      await expect(
        inviteUser(db(), agentA1, firmA, { name: 'X', email: 'x@alpha.example', role: 'agent' }),
      ).rejects.toThrow(/Not allowed/);
      await expect(
        inviteUser(db(), adminA, firmA, { name: 'X', email: 'one@alpha.example', role: 'agent' }),
      ).rejects.toThrow(/already used/);
      await inviteUser(db(), adminA, firmA, {
        name: 'Fourth',
        email: 'four@alpha.example',
        role: 'agent',
      }); // 4 of 4
      await expect(
        inviteUser(db(), adminA, firmA, {
          name: 'Fifth',
          email: 'five@alpha.example',
          role: 'agent',
        }),
      ).rejects.toThrow(/4 users/);
    });
  });

  describe('team', () => {
    it('a firm admin sees only their own team; other firms look like they do not exist', async () => {
      const team = await listTeam(db(), adminA, firmA);
      expect(team.map((m) => m.email).sort()).toEqual([
        'admin@alpha.example',
        'four@alpha.example',
        'one@alpha.example',
        'two@alpha.example',
      ]);
      expect(team.find((m) => m.email === 'four@alpha.example')?.status).toBe('invited');
      await expect(listTeam(db(), adminB, firmA)).rejects.toThrow(/Not allowed/);
      await expect(listTeam(db(), agentA1, firmA)).rejects.toThrow(/Not allowed/);
      await expect(setRemoved(db(), adminB, agentA2.userId, true)).rejects.toThrow(/not found/);
      await expect(newAccessLink(db(), adminB, agentA2.userId)).rejects.toThrow(/not found/);
    });

    it('removing someone signs them out and blocks sign-in; restoring respects the limit', async () => {
      await setRemoved(db(), adminA, agentA2.userId, true);
      expect(await accessProblem(db(), agentA2.userId)).toBe('disabled');
      expect((await signIn('two@alpha.example')).status).toBe(403);
      expect(
        (await listTeam(db(), adminA, firmA)).find((m) => m.email === 'two@alpha.example')?.status,
      ).toBe('removed');
      await inviteUser(db(), adminA, firmA, {
        name: 'Five',
        email: 'five@alpha.example',
        role: 'agent',
      }); // takes the free place
      await expect(setRemoved(db(), adminA, agentA2.userId, false)).rejects.toThrow(/4 users/);
      await expect(setRemoved(db(), adminA, adminA.userId, true)).rejects.toThrow(/yourself/);
    });

    it('suspending a firm or an ended contract locks its users out', async () => {
      await updateFirm(db(), owner, firmB, { status: 'suspended' });
      expect(await accessProblem(db(), agentB.userId)).toBe('firm_suspended');
      expect((await signIn('agent@beta.example')).status).toBe(403);
      await updateFirm(db(), owner, firmB, { status: 'active', contractEnd: '2020-01-01' });
      expect(await accessProblem(db(), agentB.userId)).toBe('contract_ended');
      await updateFirm(db(), owner, firmB, { contractEnd: null });
      expect(await accessProblem(db(), agentB.userId)).toBeNull();
      expect(await accessProblem(db(), owner.userId)).toBeNull();
    });
  });

  describe('acceptance: a firm user can never read another firm’s notes, searches or users', () => {
    it('notes', async () => {
      const noteId = await addNote(db(), agentA1, unitId, { body: 'Client Ahmed likes this one' });
      expect((await listNotes(db(), agentA1, unitId)).map((n) => n.body)).toEqual([
        'Client Ahmed likes this one',
      ]);
      expect(await listNotes(db(), agentB, unitId)).toEqual([]);
      expect(await listNotes(db(), adminB, unitId)).toEqual([]);
      await expect(deleteNote(db(), agentB, noteId)).rejects.toThrow(/not found/);
      await expect(deleteNote(db(), adminB, noteId)).rejects.toThrow(/not found/);
      await expect(listNotes(db(), owner, unitId)).rejects.toThrow(/Only firm users/);
      const otherAgent = { ...agentA1, userId: agentA2.userId };
      await expect(deleteNote(db(), otherAgent, noteId)).rejects.toThrow(/author or a firm admin/);
      await deleteNote(db(), adminA, noteId);
      expect(await listNotes(db(), agentA1, unitId)).toEqual([]);
    });

    it('saved searches', async () => {
      const id = await createSavedSearch(db(), agentA1, {
        name: '3BR New Cairo',
        filters: { bedroomsMin: 3, priceMax: 8_000_000 },
        alertChannel: 'whatsapp',
        active: true,
      });
      expect((await listSavedSearches(db(), agentA1)).map((s) => s.name)).toEqual([
        '3BR New Cairo',
      ]);
      expect(await listSavedSearches(db(), agentA2)).toEqual([]); // another agent, same firm
      expect((await listSavedSearches(db(), adminA)).map((s) => s.ownerName)).toEqual(['one']); // firm admin sees the firm's
      expect(await listSavedSearches(db(), agentB)).toEqual([]);
      expect(await listSavedSearches(db(), adminB)).toEqual([]);
      await expect(updateSavedSearch(db(), agentB, id, { name: 'stolen' })).rejects.toThrow(
        /not found/,
      );
      await expect(deleteSavedSearch(db(), adminB, id)).rejects.toThrow(/not found/);
      await expect(
        createSavedSearch(db(), agentA1, {
          name: 'bad',
          filters: { firmId: 2 } as never,
          alertChannel: 'none',
          active: true,
        }),
      ).rejects.toThrow();
      await updateSavedSearch(db(), adminA, id, { active: false });
      expect((await listSavedSearches(db(), agentA1))[0]?.active).toBe(false);
    });

    it('usage is recorded per firm, not for the owner', async () => {
      await recordUsage(db(), agentA1, 'search', { total: 12 });
      await recordUsage(db(), agentB, 'export', { count: 3 });
      await recordUsage(db(), owner, 'search', {});
      const rows = await db().select().from(usageEvents);
      expect(rows.map((r) => [r.firmId, r.kind]).sort()).toEqual(
        [
          [firmA, 'search'],
          [firmB, 'export'],
        ].sort(),
      );
      const summary = await listFirms(db(), owner);
      expect(summary.find((f) => f.id === firmA)).toMatchObject({ searches30d: 1, exports30d: 0 });
      expect(summary.find((f) => f.id === firmB)).toMatchObject({ exports30d: 1 });
    });
  });
});
