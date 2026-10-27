import { accessLinks, accounts, firms, sessions, users, type Db } from '@reb/db';
import { and, asc, count, eq, isNull, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  assertCanManage,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type Actor,
} from './actor.ts';
import { createAccessLink } from './links.ts';

export const inviteSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.email().max(200),
    role: z.enum(['firm_admin', 'agent']),
    locale: z.enum(['en', 'ar']).default('ar'),
    phone: z.string().trim().max(30).optional(),
  })
  .strict();
export type InviteInput = z.input<typeof inviteSchema>;

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  locale: string;
  /** `invited` until they set a password, `removed` after an admin removed them. */
  status: 'invited' | 'active' | 'removed';
  createdAt: Date;
}

async function firmOrThrow(db: Db, firmId: number) {
  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId));
  if (!firm) throw new NotFoundError('Firm not found');
  return firm;
}

async function activeCount(db: Db, firmId: number, except?: string) {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(
      and(
        eq(users.firmId, firmId),
        eq(users.disabled, false),
        except ? ne(users.id, except) : undefined,
      ),
    );
  return row?.n ?? 0;
}

/**
 * Adds a person to a firm and returns their invitation link (valid 7 days).
 * The owner can invite firm admins and agents; a firm admin can invite agents
 * to their own firm. The firm's user limit counts everyone not removed,
 * invited or active.
 */
export async function inviteUser(
  db: Db,
  actor: Actor,
  firmId: number,
  input: InviteInput,
): Promise<{ userId: string; token: string; expiresAt: Date }> {
  assertCanManage(actor, firmId);
  const data = inviteSchema.parse(input);
  if (actor.role !== 'owner' && data.role !== 'agent') {
    throw new ForbiddenError('Only the owner can add firm admins');
  }
  const firm = await firmOrThrow(db, firmId);
  if (firm.status !== 'active') throw new ConflictError('This firm is suspended');
  if ((await activeCount(db, firmId)) >= firm.maxUsers) {
    throw new ConflictError(`This firm already has its ${firm.maxUsers} users`);
  }
  const email = data.email.toLowerCase();
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (taken) throw new ConflictError('This e-mail is already used');
  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    name: data.name,
    email,
    role: data.role,
    firmId,
    locale: data.locale,
    phone: data.phone ?? null,
  });
  const link = await createAccessLink(db, userId, 'invite', actor.userId);
  return { userId, ...link };
}

/** The member, if `actor` may manage them. */
async function memberFor(db: Db, actor: Actor, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  // Same answer for "no such user" and "another firm's user": nothing leaks.
  if (!user || user.firmId === null) throw new NotFoundError('User not found');
  try {
    assertCanManage(actor, user.firmId);
  } catch {
    throw new NotFoundError('User not found');
  }
  return user;
}

export async function listTeam(db: Db, actor: Actor, firmId: number): Promise<TeamMember[]> {
  assertCanManage(actor, firmId);
  const rows = await db
    .select({ user: users, hasPassword: accounts.id })
    .from(users)
    .leftJoin(accounts, and(eq(accounts.userId, users.id), eq(accounts.providerId, 'credential')))
    .where(eq(users.firmId, firmId))
    .orderBy(asc(users.name));
  return rows.map(({ user, hasPassword }) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    locale: user.locale,
    status: user.disabled ? 'removed' : hasPassword ? 'active' : 'invited',
    createdAt: user.createdAt,
  }));
}

/**
 * A new link for a member: an invitation again if they never set a
 * password, otherwise a password reset (valid one day).
 */
export async function newAccessLink(
  db: Db,
  actor: Actor,
  userId: string,
): Promise<{ purpose: 'invite' | 'reset'; token: string; expiresAt: Date }> {
  const user = await memberFor(db, actor, userId);
  if (user.disabled) throw new ConflictError('This person was removed; restore them first');
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')));
  const purpose = account ? 'reset' : 'invite';
  return { purpose, ...(await createAccessLink(db, userId, purpose, actor.userId)) };
}

/**
 * Removes a member (they are signed out and can't sign in; their saved
 * searches stay for the firm), or restores them within the firm's limit.
 */
export async function setRemoved(
  db: Db,
  actor: Actor,
  userId: string,
  removed: boolean,
): Promise<void> {
  const user = await memberFor(db, actor, userId);
  if (userId === actor.userId) throw new ForbiddenError('You cannot remove yourself');
  if (actor.role !== 'owner' && user.role === 'firm_admin') {
    throw new ForbiddenError('Only the owner can remove a firm admin');
  }
  if (!removed && user.firmId !== null) {
    const firm = await firmOrThrow(db, user.firmId);
    if ((await activeCount(db, user.firmId, userId)) >= firm.maxUsers) {
      throw new ConflictError(`This firm already has its ${firm.maxUsers} users`);
    }
  }
  await db.update(users).set({ disabled: removed }).where(eq(users.id, userId));
  if (removed) {
    await db.delete(sessions).where(eq(sessions.userId, userId));
    await db
      .delete(accessLinks)
      .where(and(eq(accessLinks.userId, userId), isNull(accessLinks.usedAt)));
  }
}

/** Each person chooses the dashboard language. */
export async function setLocale(db: Db, actor: Actor, locale: 'en' | 'ar'): Promise<void> {
  await db.update(users).set({ locale }).where(eq(users.id, actor.userId));
}
