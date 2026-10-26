import { accounts, users } from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuth, upsertOwner } from '../src/index.ts';

describe.skipIf(!testDatabaseUrl)('owner login (real Postgres, real Better Auth)', () => {
  let testDb: TestDatabase;
  const baseUrl = 'http://localhost:4173';
  const auth = () => createAuth(testDb.database.db, { secret: 'x'.repeat(32), baseUrl });
  const signIn = (email: string, password: string) =>
    auth().handler(
      new Request(`${baseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: baseUrl,
          'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 200)}`,
        },
        body: JSON.stringify({ email, password }),
      }),
    );

  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
  });
  afterAll(async () => {
    await testDb.drop();
  });

  it('creates the owner with a hashed password, never the password itself', async () => {
    const { id, created } = await upsertOwner(testDb.database.db, {
      name: 'Hassan',
      email: 'Owner@Example.com',
      password: 'correct horse battery',
    });
    expect(created).toBe(true);
    const [user] = await testDb.database.db.select().from(users).where(eq(users.id, id));
    expect(user).toMatchObject({ email: 'owner@example.com', role: 'owner' });
    const [account] = await testDb.database.db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, id));
    expect(account?.providerId).toBe('credential');
    expect(account?.password).not.toContain('correct horse');
  });

  it('signs in with the right password and returns a session cookie', async () => {
    const response = await signIn('owner@example.com', 'correct horse battery');
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/session_token=/);
    expect(cookie.toLowerCase()).toContain('httponly');
    const session = await auth().api.getSession({
      headers: new Headers({ cookie: cookie.split(';')[0] ?? '' }),
    });
    expect(session?.user).toMatchObject({ email: 'owner@example.com', role: 'owner' });
  });

  it('rejects a wrong password', async () => {
    expect((await signIn('owner@example.com', 'wrong password!!')).status).toBe(401);
  });

  it('does not allow public sign-up', async () => {
    const response = await auth().handler(
      new Request(`${baseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: baseUrl },
        body: JSON.stringify({ email: 'x@example.com', password: 'some password 123', name: 'X' }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(
      await testDb.database.db.select().from(users).where(eq(users.email, 'x@example.com')),
    ).toEqual([]);
  });

  it('resets the password when run again, and keeps one account', async () => {
    const again = await upsertOwner(testDb.database.db, {
      name: 'Hassan',
      email: 'owner@example.com',
      password: 'a brand new password',
    });
    expect(again.created).toBe(false);
    expect((await signIn('owner@example.com', 'a brand new password')).status).toBe(200);
    expect((await signIn('owner@example.com', 'correct horse battery')).status).toBe(401);
    expect(await testDb.database.db.select().from(accounts)).toHaveLength(1);
  });

  it('refuses short passwords', async () => {
    await expect(
      upsertOwner(testDb.database.db, { name: 'H', email: 'h@example.com', password: 'short' }),
    ).rejects.toThrow(/10 characters/);
  });
});
