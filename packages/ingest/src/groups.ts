import { GROUP_SOURCE_TYPES, waGroups, type Db } from '@reb/db';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';

export type GroupSourceType = (typeof GROUP_SOURCE_TYPES)[number];

/**
 * Saves the groups the scraper number is in. New groups are added
 * unwatched; existing groups get their current name. When `complete` is
 * true the list is every group the number is in, so any other group is
 * marked as left (`is_member = false`).
 */
export async function syncGroups(
  db: Db,
  groups: { jid: string; name: string | null }[],
  complete: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const group of groups) {
      await tx
        .insert(waGroups)
        .values({ jid: group.jid, name: group.name, isMember: true })
        .onConflictDoUpdate({
          target: waGroups.jid,
          set: {
            name: sql`coalesce(excluded.name, ${waGroups.name})`,
            isMember: true,
          },
        });
    }
    if (complete) {
      const jids = groups.map((g) => g.jid);
      await tx
        .update(waGroups)
        .set({ isMember: false })
        .where(
          and(
            eq(waGroups.isMember, true),
            jids.length > 0 ? notInArray(waGroups.jid, jids) : undefined,
          ),
        );
    }
  });
}

export async function listGroups(db: Db) {
  return db
    .select()
    .from(waGroups)
    .orderBy(asc(waGroups.isMember), asc(waGroups.name), asc(waGroups.id));
}

/** Finds groups by numeric ID or WhatsApp JID. Returns the IDs that matched. */
async function resolve(db: Db, refs: string[]): Promise<number[]> {
  const ids = refs.filter((r) => /^\d+$/.test(r)).map(Number);
  const jids = refs.filter((r) => !/^\d+$/.test(r));
  const rows = await db
    .select({ id: waGroups.id })
    .from(waGroups)
    .where(
      sql`${ids.length ? inArray(waGroups.id, ids) : sql`false`} or ${jids.length ? inArray(waGroups.jid, jids) : sql`false`}`,
    );
  return rows.map((r) => r.id);
}

export async function setWatched(db: Db, refs: string[], watched: boolean): Promise<number> {
  const ids = await resolve(db, refs);
  if (ids.length === 0) return 0;
  await db.update(waGroups).set({ watched }).where(inArray(waGroups.id, ids));
  return ids.length;
}

export async function setSourceType(
  db: Db,
  refs: string[],
  sourceType: GroupSourceType | null,
): Promise<number> {
  const ids = await resolve(db, refs);
  if (ids.length === 0) return 0;
  await db.update(waGroups).set({ sourceType }).where(inArray(waGroups.id, ids));
  return ids.length;
}

/**
 * In-memory copy of which groups are watched, so capture doesn't query the
 * database for every message. It reloads every `refreshMs` (default 30 s),
 * which is how long a watch/unwatch change takes to apply.
 */
export class GroupDirectory {
  private groups = new Map<string, { id: number; watched: boolean }>();
  private timer: NodeJS.Timeout | undefined;
  private readonly db: Db;
  private readonly refreshMs: number;

  constructor(db: Db, refreshMs = 30_000) {
    this.db = db;
    this.refreshMs = refreshMs;
  }

  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh().catch(() => undefined), this.refreshMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async refresh(): Promise<void> {
    const rows = await this.db
      .select({ id: waGroups.id, jid: waGroups.jid, watched: waGroups.watched })
      .from(waGroups);
    this.groups = new Map(rows.map((r) => [r.jid, { id: r.id, watched: r.watched }]));
  }

  /** The group's ID if it is watched; registers unknown groups (unwatched). */
  async watchedGroupId(jid: string): Promise<number | undefined> {
    const known = this.groups.get(jid);
    if (known) return known.watched ? known.id : undefined;
    const [row] = await this.db
      .insert(waGroups)
      .values({ jid })
      .onConflictDoUpdate({ target: waGroups.jid, set: { isMember: true } })
      .returning({ id: waGroups.id, watched: waGroups.watched });
    if (!row) return undefined;
    this.groups.set(jid, row);
    return row.watched ? row.id : undefined;
  }
}
