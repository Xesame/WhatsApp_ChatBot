import {
  cities,
  developers,
  mediaFiles,
  messages,
  projects,
  reviewCorrections,
  unitPrices,
  units,
  unitSources,
  waGroups,
  type Database,
  type Db,
} from '@reb/db';
import { PRICE_FIELDS, snapshotOf } from '@reb/dedup';
import { unitSchema } from '@reb/schema';
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';
import { z } from 'zod';

type UnitRow = typeof units.$inferSelect;

/**
 * Fields the owner may correct in the review queue: the template columns
 * and the internal ones that feed them. Validated with the shared unit
 * schema, so a correction can't store an impossible value. Prices are in
 * minor units (piastres / cents), like everywhere else.
 */
export const editableUnitSchema = unitSchema
  .pick({
    category: true,
    developerId: true,
    projectId: true,
    cityId: true,
    unitType: true,
    unitCode: true,
    floor: true,
    finishingSpecs: true,
    minArea: true,
    maxArea: true,
    landArea: true,
    gardenArea: true,
    outdoorArea: true,
    minPrice: true,
    maxPrice: true,
    priceCurrency: true,
    deliveryYear: true,
    readyToMove: true,
    maintenance: true,
    maintenanceCurrency: true,
    cashDiscount: true,
    cashDiscountCurrency: true,
    cashDiscountType: true,
    downPayment: true,
    downPaymentAmount: true,
    installmentsCount: true,
    installmentYears: true,
    installmentFrequency: true,
    bedrooms: true,
    bathrooms: true,
    notes: true,
  })
  .partial()
  .strict();

export type UnitChanges = z.infer<typeof editableUnitSchema>;
export type ReviewAction = 'save' | 'approve' | 'reject';

export interface SourceView {
  messageId: number;
  role: string;
  sentAt: Date;
  groupName: string | null;
  text: string | null;
  media: {
    id: number;
    kind: string;
    mimeType: string | null;
    status: string;
    derivedText: string | null;
    derivedMethod: string | null;
  } | null;
}

export interface UnitView {
  unit: UnitRow;
  names: { developer: string | null; project: string | null; city: string | null };
  sources: SourceView[];
  prices: (typeof unitPrices.$inferSelect)[];
}

async function nameOf(
  db: Db,
  table: typeof cities | typeof developers | typeof projects,
  id: number | null,
) {
  if (id === null) return null;
  const [row] = await db.select({ name: table.nameEn }).from(table).where(eq(table.id, id));
  return row?.name ?? null;
}

/** Everything the review page shows for one unit. Sender details are never included. */
export async function unitView(db: Db, unitId: number): Promise<UnitView | null> {
  const [unit] = await db.select().from(units).where(eq(units.id, unitId));
  if (!unit) return null;
  const sourceRows = await db
    .select({
      messageId: messages.id,
      role: unitSources.role,
      sentAt: messages.sentAt,
      groupName: waGroups.name,
      text: messages.text,
      media: {
        id: mediaFiles.id,
        kind: mediaFiles.kind,
        mimeType: mediaFiles.mimeType,
        status: mediaFiles.status,
        derivedText: mediaFiles.derivedText,
        derivedMethod: mediaFiles.derivedMethod,
      },
    })
    .from(unitSources)
    .innerJoin(messages, eq(messages.id, unitSources.messageId))
    .innerJoin(waGroups, eq(waGroups.id, messages.groupId))
    .leftJoin(mediaFiles, eq(mediaFiles.messageId, messages.id))
    .where(eq(unitSources.unitId, unitId))
    .orderBy(asc(messages.sentAt));
  const prices = await db
    .select()
    .from(unitPrices)
    .where(eq(unitPrices.unitId, unitId))
    .orderBy(asc(unitPrices.observedAt), asc(unitPrices.id));
  return {
    unit,
    names: {
      developer: await nameOf(db, developers, unit.developerId),
      project: await nameOf(db, projects, unit.projectId),
      city: await nameOf(db, cities, unit.cityId),
    },
    sources: sourceRows.map((s) => ({ ...s, media: s.media?.id ? s.media : null })),
    prices,
  };
}

/** Units waiting for review, oldest first, `limit` at a time after `afterId`. */
export async function reviewQueue(
  db: Db,
  options: { limit: number; afterId?: number },
): Promise<{ items: UnitView[]; remaining: number }> {
  const waiting = and(eq(units.needsReview, true), inArray(units.status, ['active', 'stale']));
  const rows = await db
    .select({ id: units.id })
    .from(units)
    .where(options.afterId ? and(waiting, gt(units.id, options.afterId)) : waiting)
    .orderBy(asc(units.id))
    .limit(options.limit);
  const items: UnitView[] = [];
  for (const { id } of rows) {
    const view = await unitView(db, id);
    if (view) items.push(view);
  }
  const remaining = (await db.select({ id: units.id }).from(units).where(waiting)).length;
  return { items, remaining };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Applies a review decision to a unit, in one transaction:
 * - `save`: correct fields (each change is a `review_corrections` row);
 * - `approve`: correct fields if any, then mark as checked (no longer needs review);
 * - `reject`: not a real listing → `withdrawn`, out of exports and search.
 *
 * Price corrections also fix the latest price-history row: a misread price
 * is an extraction error, not a market price change.
 */
export async function reviewUnit(
  database: Database,
  unitId: number,
  input: { action: ReviewAction; changes?: unknown },
  reviewerId: string | null,
): Promise<UnitRow> {
  const changes = editableUnitSchema.parse(input.changes ?? {});
  return database.transaction(async (tx) => {
    const [unit] = await tx.select().from(units).where(eq(units.id, unitId)).for('update');
    if (!unit) throw new NotFoundError(`Unit ${unitId} not found`);
    const [source] = await tx
      .select({ messageId: unitSources.messageId })
      .from(unitSources)
      .where(and(eq(unitSources.unitId, unitId), eq(unitSources.role, 'listing')))
      .orderBy(asc(unitSources.createdAt))
      .limit(1);

    const changed = (Object.keys(changes) as (keyof UnitChanges)[]).filter(
      (f) => !same(unit[f], changes[f]),
    );
    const corrections: (typeof reviewCorrections.$inferInsert)[] = changed.map((field) => ({
      unitId,
      messageId: source?.messageId ?? null,
      action: 'edit',
      field,
      before: unit[field] ?? null,
      after: changes[field] ?? null,
      reviewerId,
    }));
    if (input.action !== 'save') {
      corrections.push({
        unitId,
        messageId: source?.messageId ?? null,
        action: input.action,
        reviewerId,
      });
    }
    if (corrections.length > 0) await tx.insert(reviewCorrections).values(corrections);

    const update: Partial<typeof units.$inferInsert> = {};
    for (const field of changed) (update as Record<string, unknown>)[field] = changes[field];
    if (input.action === 'approve')
      Object.assign(update, { needsReview: false, reviewReasons: [], confidence: 1 });
    if (input.action === 'reject')
      Object.assign(update, { needsReview: false, status: 'withdrawn' });
    const [saved] = Object.keys(update).length
      ? await tx.update(units).set(update).where(eq(units.id, unitId)).returning()
      : [unit];

    if (changed.some((f) => (PRICE_FIELDS as readonly string[]).includes(f))) {
      const [latest] = await tx
        .select({ id: unitPrices.id })
        .from(unitPrices)
        .where(eq(unitPrices.unitId, unitId))
        .orderBy(desc(unitPrices.observedAt), desc(unitPrices.id))
        .limit(1);
      if (latest && saved) {
        await tx.update(unitPrices).set(snapshotOf(saved)).where(eq(unitPrices.id, latest.id));
      }
    }
    if (!saved) throw new NotFoundError(`Unit ${unitId} not found`);
    return saved;
  });
}

export class NotFoundError extends Error {
  override name = 'NotFoundError';
}
