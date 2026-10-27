import { setPassword } from '@reb/auth';
import { accessLinks, firms, sessions, users, type Db } from '@reb/db';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { ConflictError } from './actor.ts';

const DAY = 24 * 3600 * 1000;
export const LINK_LIFETIME = { invite: 7 * DAY, reset: DAY } as const;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * A new one-time link for `userId`. Earlier unused links for the same person
 * stop working, so only the latest one sent is valid. Returns the secret
 * token; only its hash is stored.
 */
export async function createAccessLink(
  db: Db,
  userId: string,
  purpose: keyof typeof LINK_LIFETIME,
  createdBy: string | null,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + LINK_LIFETIME[purpose]);
  await db
    .delete(accessLinks)
    .where(and(eq(accessLinks.userId, userId), isNull(accessLinks.usedAt)));
  await db
    .insert(accessLinks)
    .values({ userId, tokenHash: hashToken(token), purpose, createdBy, expiresAt });
  return { token, expiresAt };
}

export interface LinkInfo {
  purpose: 'invite' | 'reset';
  name: string;
  email: string;
  firmName: string | null;
  locale: 'en' | 'ar';
}

async function findLink(db: Db, token: string, now: Date) {
  const [row] = await db
    .select({
      id: accessLinks.id,
      userId: accessLinks.userId,
      purpose: accessLinks.purpose,
      name: users.name,
      email: users.email,
      disabled: users.disabled,
      locale: users.locale,
      firmName: firms.name,
    })
    .from(accessLinks)
    .innerJoin(users, eq(users.id, accessLinks.userId))
    .leftJoin(firms, eq(firms.id, users.firmId))
    .where(
      and(
        eq(accessLinks.tokenHash, hashToken(token)),
        isNull(accessLinks.usedAt),
        gt(accessLinks.expiresAt, now),
      ),
    );
  return row && !row.disabled ? row : null;
}

/** What the "set your password" page shows, or null for a used, expired or unknown link. */
export async function accessLinkInfo(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<LinkInfo | null> {
  const row = await findLink(db, token, now);
  return row
    ? {
        purpose: row.purpose,
        name: row.name,
        email: row.email,
        firmName: row.firmName,
        locale: row.locale,
      }
    : null;
}

/**
 * Sets the password through a link, once. Signs the person out everywhere
 * else (a reset is often because a password leaked).
 */
export async function redeemAccessLink(
  db: Db,
  token: string,
  password: string,
  now: Date = new Date(),
): Promise<{ email: string }> {
  if (password.length < 10) throw new ConflictError('Password must be at least 10 characters');
  return db.transaction(async (tx) => {
    const row = await findLink(tx, token, now);
    if (!row) throw new ConflictError('This link has expired or was already used');
    const used = await tx
      .update(accessLinks)
      .set({ usedAt: now })
      .where(and(eq(accessLinks.id, row.id), isNull(accessLinks.usedAt)))
      .returning({ id: accessLinks.id });
    if (used.length === 0) throw new ConflictError('This link has expired or was already used');
    await setPassword(tx, row.userId, password);
    await tx.update(users).set({ emailVerified: true }).where(eq(users.id, row.userId));
    await tx.delete(sessions).where(eq(sessions.userId, row.userId));
    return { email: row.email };
  });
}
