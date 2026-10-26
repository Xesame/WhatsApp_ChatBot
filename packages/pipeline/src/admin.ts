import { cities, developers, messages, projects, units, type Database } from '@reb/db';
import { enqueueInTransaction, type PgBoss } from '@reb/queue';
import { type ExportContext, type Unit } from '@reb/schema';
import { writePrimaryUnitsWorkbook } from '@reb/schema/export';
import { and, asc, eq, gte, inArray, lt, type SQL } from 'drizzle-orm';

export interface ReprocessFilter {
  from?: Date;
  to?: Date;
  groupId?: number;
  status?: (typeof messages.$inferSelect)['status'][];
  messageIds?: number[];
}

/**
 * Sends stored messages through the pipeline again, e.g. after a prompt or
 * model change, or when Phase 3 adds media support. New model calls are added
 * to `extraction_runs`; old ones are kept for comparison. Returns how many
 * messages were queued.
 */
export async function reprocess(
  database: Database,
  boss: PgBoss,
  filter: ReprocessFilter,
): Promise<number> {
  const conditions: SQL[] = [];
  if (filter.from) conditions.push(gte(messages.sentAt, filter.from));
  if (filter.to) conditions.push(lt(messages.sentAt, filter.to));
  if (filter.groupId) conditions.push(eq(messages.groupId, filter.groupId));
  if (filter.status?.length) conditions.push(inArray(messages.status, filter.status));
  if (filter.messageIds?.length) conditions.push(inArray(messages.id, filter.messageIds));
  const rows = await database.db
    .select({ id: messages.id })
    .from(messages)
    .where(and(...conditions))
    .orderBy(asc(messages.id));
  for (const { id } of rows) {
    await database.transaction(async (tx, client) => {
      await tx.update(messages).set({ status: 'pending', error: null }).where(eq(messages.id, id));
      await enqueueInTransaction(boss, client, 'preprocess', { messageId: id });
    });
  }
  return rows.length;
}

/** Loads units (active by default) and writes them in the Primary Units template layout. */
export async function exportUnits(
  database: Database,
  options: { usdToEgp: number | undefined; messageIds?: number[]; includeInactive?: boolean },
): Promise<{ file: Buffer; count: number }> {
  const { db } = database;
  const conditions: SQL[] = [];
  if (!options.includeInactive) conditions.push(eq(units.status, 'active'));
  if (options.messageIds?.length)
    conditions.push(inArray(units.sourceMessageId, options.messageIds));
  const rows = await db
    .select()
    .from(units)
    .where(and(...conditions))
    .orderBy(asc(units.id));

  const names = async <T extends { id: number; nameEn: string }>(promise: Promise<T[]>) =>
    new Map((await promise).map((r) => [r.id, r.nameEn]));
  const [developerNames, projectNames, cityNames] = await Promise.all([
    names(db.select({ id: developers.id, nameEn: developers.nameEn }).from(developers)),
    names(db.select({ id: projects.id, nameEn: projects.nameEn }).from(projects)),
    names(db.select({ id: cities.id, nameEn: cities.nameEn }).from(cities)),
  ]);
  const ctx: ExportContext = {
    developerName: (id) => developerNames.get(id),
    projectName: (id) => projectNames.get(id),
    cityName: (id) => cityNames.get(id),
    usdToEgp: options.usdToEgp,
  };
  const file = await writePrimaryUnitsWorkbook(rows as unknown as Unit[], ctx);
  return { file, count: rows.length };
}
