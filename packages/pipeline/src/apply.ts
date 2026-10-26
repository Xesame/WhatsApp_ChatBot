import { messages, unitPrices, units, unitSources, type Db } from '@reb/db';
import {
  applyObservation,
  findMatch,
  pickTargets,
  priceChanged,
  snapshotOf,
  type PriceSnapshot,
  type Tolerances,
} from '@reb/dedup';
import type { MessageIntent, Unit } from '@reb/schema';
import { and, desc, eq, inArray, max, min, ne, sql } from 'drizzle-orm';

type UnitRow = typeof units.$inferSelect;
type Role = (typeof unitSources.$inferInsert)['role'];

export interface ApplyInput {
  message: Pick<
    typeof messages.$inferSelect,
    'id' | 'groupId' | 'sentAt' | 'quotedWaMessageId' | 'editOfWaMessageId'
  >;
  intent: Exclude<MessageIntent, 'not_relevant'>;
  units: Unit[];
  extractionRunId: number | null;
  tolerances: Tolerances;
}

export interface ApplyResult {
  created: number[];
  merged: number[];
  priceChanged: number[];
  sold: number[];
  /** Plain-English problems (unmatched update, ambiguous reply), for the message's error column. */
  notes: string[];
}

/** Fields that describe the unit itself; a repost fills them in when they were unknown. */
const DESCRIPTIVE_FIELDS = [
  'category',
  'developerId',
  'cityId',
  'floor',
  'finishingSpecs',
  'minArea',
  'maxArea',
  'landArea',
  'gardenArea',
  'outdoorArea',
  'deliveryYear',
  'maintenance',
  'maintenanceCurrency',
  'bedrooms',
  'bathrooms',
  'notes',
] as const satisfies readonly (keyof Unit & keyof UnitRow)[];

/**
 * Steps 7 and 8 of the pipeline (dedup, merge, price history, sold) for one
 * message, inside the caller's transaction.
 *
 * Idempotent: whatever this message did before (sources, price rows, a sold
 * mark, units it alone created) is undone first, then applied again. So
 * reprocessing a message after a prompt change never duplicates anything.
 *
 * One advisory lock serializes this step across workers, so the same flyer
 * arriving in three groups at once can't create three units. The step is
 * short (no model calls inside), so the lock costs nothing noticeable.
 */
export async function applyExtraction(tx: Db, input: ApplyInput): Promise<ApplyResult> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('reb:units'))`);
  await retract(tx, input.message.id);

  const result: ApplyResult = { created: [], merged: [], priceChanged: [], sold: [], notes: [] };
  if (input.intent === 'listing') {
    const used = new Set<number>();
    for (const unit of input.units) {
      const candidates = (await candidatesFor(tx, unit)).filter((c) => !used.has(c.id));
      const match = findMatch(candidates, unit, input.tolerances);
      if (match) {
        used.add(match.id);
        await merge(tx, match, unit, input, 'listing', result);
        result.merged.push(match.id);
      } else {
        const id = await create(tx, unit, input);
        used.add(id);
        result.created.push(id);
      }
    }
    return result;
  }

  // Price updates and sold notices change units that already exist.
  const quoted = await quotedUnits(tx, input.message);
  const updates: Partial<Unit>[] = input.units.length > 0 ? input.units : [{}];
  for (const update of updates) {
    let targets: UnitRow[];
    if (quoted.length > 0) {
      const picked = pickTargets(quoted, update, input.tolerances);
      if (picked.ambiguous) {
        result.notes.push(
          `${input.intent}: the earlier message has ${quoted.length} units and this one does not say which; flagged for review`,
        );
        await flag(
          tx,
          picked.targets.length > 0 ? picked.targets : quoted,
          `Possible ${input.intent} in message ${input.message.id} (unclear which unit)`,
        );
        continue;
      }
      targets = picked.targets;
    } else {
      const match =
        update.projectId != null
          ? findMatch(await candidatesFor(tx, update as Unit), update as Unit, input.tolerances)
          : null;
      targets = match ? [match] : [];
    }
    if (targets.length === 0) {
      result.notes.push(`${input.intent}: no matching unit found`);
      continue;
    }
    for (const target of targets) {
      if (input.intent === 'sold') {
        await tx
          .update(units)
          .set({
            status: 'sold',
            soldByMessageId: input.message.id,
            lastSeenAt: sql`greatest(${units.lastSeenAt}, ${input.message.sentAt.toISOString()}::timestamptz)`,
          })
          .where(eq(units.id, target.id));
        await addSource(tx, target.id, input.message.id, 'sold');
        result.sold.push(target.id);
      } else {
        await merge(tx, target, update, input, 'price_update', result);
      }
    }
  }
  return result;
}

/** Active or stale units of the same project and type: the only possible matches. */
async function candidatesFor(
  tx: Db,
  unit: Pick<Unit, 'projectId' | 'unitType'>,
): Promise<UnitRow[]> {
  if (unit.projectId === null || unit.unitType === null) return [];
  return tx
    .select()
    .from(units)
    .where(
      and(
        eq(units.projectId, unit.projectId),
        eq(units.unitType, unit.unitType),
        inArray(units.status, ['active', 'stale']),
      ),
    );
}

/** Units that came from the message this one replies to (or edits). */
async function quotedUnits(tx: Db, message: ApplyInput['message']): Promise<UnitRow[]> {
  const waId = message.quotedWaMessageId ?? message.editOfWaMessageId;
  if (!waId) return [];
  const rows = await tx
    .select({ unit: units })
    .from(unitSources)
    .innerJoin(messages, eq(messages.id, unitSources.messageId))
    .innerJoin(units, eq(units.id, unitSources.unitId))
    .where(
      and(
        eq(messages.groupId, message.groupId),
        eq(messages.waMessageId, waId),
        ne(units.status, 'withdrawn'),
      ),
    );
  return rows.map((r) => r.unit);
}

async function addSource(tx: Db, unitId: number, messageId: number, role: Role): Promise<void> {
  await tx.insert(unitSources).values({ unitId, messageId, role }).onConflictDoNothing();
}

async function addPriceRow(
  tx: Db,
  unitId: number,
  snapshot: PriceSnapshot,
  observedAt: Date,
  messageId: number,
) {
  await tx
    .insert(unitPrices)
    .values({ unitId, ...snapshot, observedAt, sourceMessageId: messageId });
}

async function create(tx: Db, unit: Unit, input: ApplyInput): Promise<number> {
  const { sentAt, id: messageId } = input.message;
  const [row] = await tx
    .insert(units)
    .values({
      ...unit,
      firstSeenAt: sentAt,
      lastSeenAt: sentAt,
      extractionRunId: input.extractionRunId,
    })
    .returning({ id: units.id });
  if (!row) throw new Error('Failed to create unit');
  await addSource(tx, row.id, messageId, 'listing');
  if (unit.minPrice !== null || unit.maxPrice !== null) {
    await addPriceRow(tx, row.id, snapshotOf(unit), sentAt, messageId);
  }
  return row.id;
}

/**
 * Adds a message to an existing unit: records the source, fills in details
 * the unit didn't have, and writes a price row if the terms changed. The
 * unit's own price columns follow the most recent observation, so a late
 * reprocessed older message adds history without overwriting today's price.
 */
async function merge(
  tx: Db,
  existing: UnitRow,
  incoming: Partial<Unit>,
  input: ApplyInput,
  role: Role,
  result: ApplyResult,
): Promise<void> {
  const { sentAt, id: messageId } = input.message;
  await addSource(tx, existing.id, messageId, role);

  const fill: Partial<Pick<UnitRow, (typeof DESCRIPTIVE_FIELDS)[number]>> = {};
  if (role === 'listing') {
    for (const field of DESCRIPTIVE_FIELDS) {
      if (existing[field] === null && incoming[field] != null) {
        (fill as Record<string, unknown>)[field] = incoming[field];
      }
    }
  }

  const [latest] = await tx
    .select({ observedAt: max(unitPrices.observedAt) })
    .from(unitPrices)
    .where(eq(unitPrices.unitId, existing.id));
  const current = snapshotOf(existing);
  const next = applyObservation(current, incoming);
  const isNewest = !latest?.observedAt || sentAt >= latest.observedAt;
  const changed =
    priceChanged(current, next) ||
    (!latest?.observedAt && (next.minPrice !== null || next.maxPrice !== null));
  if (changed) {
    await addPriceRow(tx, existing.id, next, sentAt, messageId);
    result.priceChanged.push(existing.id);
  }

  const reasons = [...new Set([...existing.reviewReasons, ...(incoming.reviewReasons ?? [])])];
  await tx
    .update(units)
    .set({
      ...fill,
      ...(changed && isNewest ? next : {}),
      readyToMove: existing.readyToMove || incoming.readyToMove === true,
      status: existing.status === 'stale' ? 'active' : existing.status,
      firstSeenAt: sql`least(${units.firstSeenAt}, ${sentAt.toISOString()}::timestamptz)`,
      lastSeenAt: sql`greatest(${units.lastSeenAt}, ${sentAt.toISOString()}::timestamptz)`,
      extractionRunId: input.extractionRunId ?? existing.extractionRunId,
      needsReview: existing.needsReview || incoming.needsReview === true,
      reviewReasons: reasons,
      confidence: Math.max(existing.confidence, incoming.confidence ?? 0),
    })
    .where(eq(units.id, existing.id));
}

async function flag(tx: Db, targets: UnitRow[], reason: string): Promise<void> {
  for (const target of targets) {
    await tx
      .update(units)
      .set({ needsReview: true, reviewReasons: [...new Set([...target.reviewReasons, reason])] })
      .where(eq(units.id, target.id));
  }
}

/**
 * Undoes everything a message did: its sources, its price rows, a sold mark
 * it set, and units that only it created. Units that keep other sources get
 * their latest remaining price and their first/last-seen dates recomputed.
 * (Details a message filled in on an existing unit stay: they were true.)
 */
export async function retract(tx: Db, messageId: number): Promise<void> {
  const fromSources = await tx
    .select({ unitId: unitSources.unitId })
    .from(unitSources)
    .where(eq(unitSources.messageId, messageId));
  const fromPrices = await tx
    .select({ unitId: unitPrices.unitId })
    .from(unitPrices)
    .where(eq(unitPrices.sourceMessageId, messageId));
  const affected = [...new Set([...fromSources, ...fromPrices].map((r) => r.unitId))];

  await tx
    .update(units)
    .set({ status: 'active', soldByMessageId: null })
    .where(eq(units.soldByMessageId, messageId));
  if (affected.length === 0) return;
  await tx.delete(unitPrices).where(eq(unitPrices.sourceMessageId, messageId));
  await tx.delete(unitSources).where(eq(unitSources.messageId, messageId));

  for (const unitId of affected) {
    const [seen] = await tx
      .select({ first: min(messages.sentAt), last: max(messages.sentAt) })
      .from(unitSources)
      .innerJoin(messages, eq(messages.id, unitSources.messageId))
      .where(eq(unitSources.unitId, unitId));
    if (!seen?.first || !seen.last) {
      await tx.delete(units).where(eq(units.id, unitId));
      continue;
    }
    const [price] = await tx
      .select()
      .from(unitPrices)
      .where(eq(unitPrices.unitId, unitId))
      .orderBy(desc(unitPrices.observedAt), desc(unitPrices.id))
      .limit(1);
    await tx
      .update(units)
      .set({ firstSeenAt: seen.first, lastSeenAt: seen.last, ...(price ? snapshotOf(price) : {}) })
      .where(eq(units.id, unitId));
  }
}

/** Step 8 (lifecycle): active units not seen for `days` days become stale. */
export async function markStale(tx: Db, days: number, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const rows = await tx
    .update(units)
    .set({ status: 'stale' })
    .where(
      and(
        eq(units.status, 'active'),
        sql`${units.lastSeenAt} < ${cutoff.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: units.id });
  return rows.length;
}
