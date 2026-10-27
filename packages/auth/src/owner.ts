import { accounts, users, type Db } from '@reb/db';
import { hashPassword } from 'better-auth/crypto';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

/**
 * Creates the owner account, or resets its password if it exists. Used by
 * `create-owner` (setup) and by tests. The password is stored as a scrypt
 * hash in `accounts.password`, the format Better Auth checks at login.
 */
/** Sets (or replaces) a user's password, in the format Better Auth checks at login. */
export async function setPassword(db: Db, userId: string, password: string): Promise<void> {
  if (password.length < 10) throw new Error('Password must be at least 10 characters');
  const hash = await hashPassword(password);
  const updated = await db
    .update(accounts)
    .set({ password: hash })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
    .returning({ id: accounts.id });
  if (updated.length === 0) {
    await db.insert(accounts).values({
      id: randomUUID(),
      userId,
      accountId: userId,
      providerId: 'credential',
      password: hash,
    });
  }
}

export async function upsertOwner(
  db: Db,
  input: { name: string; email: string; password: string },
): Promise<{ id: string; created: boolean }> {
  if (input.password.length < 10) throw new Error('Password must be at least 10 characters');
  const email = input.email.trim().toLowerCase();
  const hash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) {
      await tx
        .update(users)
        .set({ role: 'owner', name: input.name })
        .where(eq(users.id, existing.id));
      const updated = await tx
        .update(accounts)
        .set({ password: hash })
        .where(and(eq(accounts.userId, existing.id), eq(accounts.providerId, 'credential')))
        .returning({ id: accounts.id });
      if (updated.length === 0) {
        await tx.insert(accounts).values({
          id: randomUUID(),
          userId: existing.id,
          accountId: existing.id,
          providerId: 'credential',
          password: hash,
        });
      }
      return { id: existing.id, created: false };
    }
    const id = randomUUID();
    await tx
      .insert(users)
      .values({ id, name: input.name, email, role: 'owner', emailVerified: true });
    await tx.insert(accounts).values({
      id: randomUUID(),
      userId: id,
      accountId: id,
      providerId: 'credential',
      password: hash,
    });
    return { id, created: true };
  });
}
