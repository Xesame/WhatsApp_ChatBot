import { firms, sessions, usageEvents, users, type Db } from '@reb/db';
import { and, asc, count, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ConflictError, ForbiddenError, NotFoundError, type Actor } from './actor.ts';

/** What the owner sets when creating or editing a firm. */
export const firmInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    plan: z.string().trim().min(1).max(40),
    maxUsers: z.number().int().min(1).max(1000),
    status: z.enum(['active', 'suspended']),
    contractStart: z.iso.date().nullable(),
    contractEnd: z.iso.date().nullable(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .strict();
export type FirmInput = z.infer<typeof firmInputSchema>;

const assertOwner = (actor: Actor) => {
  if (actor.role !== 'owner') throw new ForbiddenError('Only the owner manages firms');
};

const isUniqueViolation = (error: unknown) =>
  (error as { code?: string; cause?: { code?: string } }).code === '23505' ||
  (error as { cause?: { code?: string } }).cause?.code === '23505';

export async function createFirm(db: Db, actor: Actor, input: FirmInput): Promise<number> {
  assertOwner(actor);
  const data = firmInputSchema.parse(input);
  if (!data.name) throw new ConflictError('A firm needs a name');
  try {
    const [row] = await db
      .insert(firms)
      .values({ ...data, name: data.name })
      .returning({ id: firms.id });
    if (!row) throw new Error('insert failed');
    return row.id;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('A firm with this name already exists');
    throw error;
  }
}

/**
 * Changes a firm. Suspending it signs its users out at once (they also can't
 * sign in again until it is active).
 */
export async function updateFirm(
  db: Db,
  actor: Actor,
  firmId: number,
  input: FirmInput,
): Promise<void> {
  assertOwner(actor);
  const data = firmInputSchema.parse(input);
  try {
    const updated = await db
      .update(firms)
      .set(data)
      .where(eq(firms.id, firmId))
      .returning({ id: firms.id });
    if (updated.length === 0) throw new NotFoundError('Firm not found');
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('A firm with this name already exists');
    throw error;
  }
  if (data.status === 'suspended') {
    const members = db.select({ id: users.id }).from(users).where(eq(users.firmId, firmId));
    await db.delete(sessions).where(inArray(sessions.userId, members));
  }
}

export interface FirmSummary {
  id: number;
  name: string;
  plan: string;
  status: string;
  maxUsers: number;
  contractStart: string | null;
  contractEnd: string | null;
  notes: string | null;
  activeUsers: number;
  /** Searches and exports in the last 30 days. */
  searches30d: number;
  exports30d: number;
  createdAt: Date;
}

export async function listFirms(
  db: Db,
  actor: Actor,
  now: Date = new Date(),
): Promise<FirmSummary[]> {
  assertOwner(actor);
  const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const [rows, members, usage] = await Promise.all([
    db.select().from(firms).orderBy(asc(firms.name)),
    db
      .select({ firmId: users.firmId, n: count() })
      .from(users)
      .where(eq(users.disabled, false))
      .groupBy(users.firmId),
    db
      .select({ firmId: usageEvents.firmId, kind: usageEvents.kind, n: count() })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, since))
      .groupBy(usageEvents.firmId, usageEvents.kind),
  ]);
  const used = (firmId: number, kind: string) =>
    usage.find((u) => u.firmId === firmId && u.kind === kind)?.n ?? 0;
  return rows.map((f) => ({
    ...f,
    activeUsers: members.find((m) => m.firmId === f.id)?.n ?? 0,
    searches30d: used(f.id, 'search'),
    exports30d: used(f.id, 'export'),
  }));
}

/** Usage of one firm per day and per kind (for the owner's billing view and the firm admin). */
export async function usageByDay(
  db: Db,
  firmId: number,
  days = 30,
  now: Date = new Date(),
): Promise<{ day: string; kind: string; count: number }[]> {
  const since = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const day = sql<string>`to_char(${usageEvents.createdAt} at time zone 'Africa/Cairo', 'YYYY-MM-DD')`;
  const rows = await db
    .select({ day, kind: usageEvents.kind, count: count() })
    .from(usageEvents)
    .where(and(eq(usageEvents.firmId, firmId), gte(usageEvents.createdAt, since)))
    .groupBy(day, usageEvents.kind)
    .orderBy(day);
  return rows;
}
