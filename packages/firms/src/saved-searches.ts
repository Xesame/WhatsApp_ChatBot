import { ALERT_CHANNELS, savedSearches, users, type Db } from '@reb/db';
import { searchFiltersSchema } from '@reb/search';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { firmOf, NotFoundError, type Actor } from './actor.ts';

export const savedSearchSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    filters: searchFiltersSchema,
    alertChannel: z.enum(ALERT_CHANNELS),
    active: z.boolean(),
  })
  .strict();
export type SavedSearchInput = z.input<typeof savedSearchSchema>;

export interface SavedSearch {
  id: number;
  name: string;
  filters: unknown;
  alertChannel: string;
  active: boolean;
  ownerName: string | null;
  mine: boolean;
  createdAt: Date;
}

/**
 * Which saved searches a person may see and change: an agent their own; a
 * firm admin everyone's in the firm (build plan: firm admins manage their
 * firm's saved searches). Never another firm's.
 */
function scope(actor: Actor): SQL | undefined {
  const firmId = firmOf(actor);
  return actor.role === 'firm_admin'
    ? eq(savedSearches.firmId, firmId)
    : and(eq(savedSearches.firmId, firmId), eq(savedSearches.userId, actor.userId));
}

export async function listSavedSearches(db: Db, actor: Actor): Promise<SavedSearch[]> {
  const rows = await db
    .select({ s: savedSearches, ownerName: users.name })
    .from(savedSearches)
    .leftJoin(users, eq(users.id, savedSearches.userId))
    .where(scope(actor))
    .orderBy(asc(savedSearches.name));
  return rows.map(({ s, ownerName }) => ({
    id: s.id,
    name: s.name,
    filters: s.filters,
    alertChannel: s.alertChannel,
    active: s.active,
    ownerName,
    mine: s.userId === actor.userId,
    createdAt: s.createdAt,
  }));
}

export async function createSavedSearch(
  db: Db,
  actor: Actor,
  input: SavedSearchInput,
): Promise<number> {
  const firmId = firmOf(actor);
  const data = savedSearchSchema.parse(input);
  const [row] = await db
    .insert(savedSearches)
    .values({ ...data, firmId, userId: actor.userId })
    .returning({ id: savedSearches.id });
  if (!row) throw new Error('insert failed');
  return row.id;
}

export async function updateSavedSearch(
  db: Db,
  actor: Actor,
  id: number,
  input: Partial<SavedSearchInput>,
): Promise<void> {
  const data = savedSearchSchema.partial().parse(input);
  const updated = await db
    .update(savedSearches)
    .set(data)
    .where(and(eq(savedSearches.id, id), scope(actor)))
    .returning({ id: savedSearches.id });
  if (updated.length === 0) throw new NotFoundError('Saved search not found');
}

export async function deleteSavedSearch(db: Db, actor: Actor, id: number): Promise<void> {
  const deleted = await db
    .delete(savedSearches)
    .where(and(eq(savedSearches.id, id), scope(actor)))
    .returning({ id: savedSearches.id });
  if (deleted.length === 0) throw new NotFoundError('Saved search not found');
}
