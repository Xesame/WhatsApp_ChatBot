import { cities, developers, messages, projects, units, unitSources, type Database } from '@reb/db';
import { enqueueInTransaction, type PgBoss } from '@reb/queue';
import { type ExportContext, type PaymentPlan, type Unit } from '@reb/schema';
import { writePrimaryUnitsCsv, writePrimaryUnitsWorkbook } from '@reb/schema/export';
import { currentPlans } from './plans.ts';
import { and, asc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';

/** Each unit's current plans, keyed by its index in the list (for the plans sheet). */
async function plansByIndex(
  database: Database,
  unitIds: number[],
): Promise<Map<number, PaymentPlan[]>> {
  const map = new Map<number, PaymentPlan[]>();
  for (const [index, unitId] of unitIds.entries()) {
    const plans = await currentPlans(database.db, unitId);
    if (plans.length) map.set(index, plans);
  }
  return map;
}

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
  options: {
    usdToEgp: number | undefined;
    messageIds?: number[];
    includeInactive?: boolean;
    /** Exactly these units, in this order (a firm's search results). */
    unitIds?: number[];
    format?: 'xlsx' | 'csv';
  },
): Promise<{ file: Buffer; count: number }> {
  const { db } = database;
  const conditions: SQL[] = [];
  if (options.unitIds) {
    if (options.unitIds.length === 0) conditions.push(sql`false`);
    else conditions.push(inArray(units.id, options.unitIds));
  } else if (!options.includeInactive) {
    conditions.push(eq(units.status, 'active'));
  }
  if (options.messageIds?.length) {
    const ids = options.messageIds;
    conditions.push(
      inArray(
        units.id,
        db
          .select({ id: unitSources.unitId })
          .from(unitSources)
          .where(inArray(unitSources.messageId, ids)),
      ),
    );
  }
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
  if (options.unitIds) {
    const position = new Map(options.unitIds.map((id, i) => [id, i]));
    rows.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  }
  const list = rows as unknown as Unit[];
  if (options.format === 'csv') {
    return { file: writePrimaryUnitsCsv(list, ctx), count: rows.length };
  }
  const plans = await plansByIndex(
    database,
    rows.map((row) => row.id),
  );
  const file = await writePrimaryUnitsWorkbook(list, ctx, plans);
  return { file, count: rows.length };
}
