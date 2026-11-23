import {
  cities,
  developers,
  entityAliases,
  mediaFiles,
  messages,
  projects,
  reviewCorrections,
  unitPaymentPlans,
  unitPrices,
  units,
  unitSources,
  waGroups,
  type Database,
  type Db,
} from '@reb/db';
import { PRICE_FIELDS, snapshotOf } from '@reb/dedup';
import {
  columnsFromPlan,
  nameReasonFields,
  normalizeName,
  type Suggestion,
  type WrittenNames,
} from '@reb/normalize';
import { currentPlans, lookupFor } from '@reb/pipeline';
import { editablePlansSchema, isEmptyPlan, unitSchema, type PaymentPlan } from '@reb/schema';
import { and, asc, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from './audit.ts';
import { addAlias, type EntityKind } from './entities.ts';

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
    building: true,
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
  /** The unit's current payment plans, in the order written. */
  plans: PaymentPlan[];
  /**
   * What the pipeline wrote down about names it could not match: the names as
   * written in the message, and the closest existing entity when one was
   * close enough to suggest. Empty for units made before this was recorded.
   */
  learning: {
    written: WrittenNames;
    suggested: Record<string, Suggestion>;
    /**
     * What Gemini remembers about the project's name (a hint, checked by the
     * person): its developer and area. Null when nothing was looked up, or
     * the model was not sure.
     */
    lookup: { developer: string | null; city: string | null } | null;
  };
  /**
   * Other listings from the same message still waiting for review, with the
   * same project name as written: the ones "use this project for the other
   * listings" would change.
   */
  siblings: { count: number };
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

function learningOf(extras: unknown): Omit<UnitView['learning'], 'lookup'> {
  const e = (extras ?? {}) as { written?: Partial<WrittenNames>; suggested?: unknown };
  return {
    written: {
      developer: e.written?.developer ?? [],
      project: e.written?.project ?? [],
      city: e.written?.city ?? [],
    },
    suggested: (e.suggested ?? {}) as Record<string, Suggestion>,
  };
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
    plans: await currentPlans(db, unitId),
    learning: { ...learningOf(unit.extras), lookup: await rememberedNames(db, unit) },
    siblings: { count: (await siblingsOf(db, unit)).length },
  };
}

/**
 * The message a unit was first listed in (its oldest `listing` source), or
 * null. unit_sources has no id column, and rows written in one transaction
 * share a time, so equal times fall back to the oldest message id; the same
 * order is used everywhere "first listing" is read.
 */
async function listingMessageOf(db: Db, unitId: number): Promise<number | null> {
  const [source] = await db
    .select({ messageId: unitSources.messageId })
    .from(unitSources)
    .where(and(eq(unitSources.unitId, unitId), eq(unitSources.role, 'listing')))
    .orderBy(asc(unitSources.createdAt), asc(unitSources.messageId))
    .limit(1);
  return source?.messageId ?? null;
}

/**
 * The project name as the message wrote it, for comparing: every written
 * spelling, normalised the usual way (case, spaces, Arabic letter forms).
 * No written name at all gives "", so two units without one count as the
 * same.
 */
export function writtenProjectKey(extras: unknown): string {
  const written = (extras ?? {}) as { written?: Partial<WrittenNames> };
  return (written.written?.project ?? [])
    .map((name) => normalizeName(name))
    .filter(Boolean)
    .sort()
    .join('|');
}

/**
 * A unit's "siblings": the other units first listed in the same message,
 * still waiting for review (active or stale), whose project name as written
 * is the same. One post often lists many units (a price list of 25 lines);
 * they share the project, developer and area. A post can also mix projects
 * (two compounds in one list), so only units with the same written project
 * name count. `lock` locks the rows for an update in the same transaction.
 */
async function siblingsOf(db: Db, unit: UnitRow, lock = false): Promise<UnitRow[]> {
  const messageId = await listingMessageOf(db, unit.id);
  if (messageId === null) return [];
  // The sibling's own oldest listing source must be this message: a unit
  // that was only reposted here belongs to another message's list.
  const firstListing = sql`(select ${unitSources.messageId} from ${unitSources}
    where ${unitSources.unitId} = ${units.id} and ${unitSources.role} = 'listing'
    order by ${unitSources.createdAt} asc, ${unitSources.messageId} asc limit 1)`;
  const query = db
    .select()
    .from(units)
    .where(
      and(
        ne(units.id, unit.id),
        eq(units.needsReview, true),
        inArray(units.status, ['active', 'stale']),
        sql`${firstListing} = ${messageId}`,
      ),
    )
    .orderBy(asc(units.id));
  const rows = lock ? await query.for('update') : await query;
  const key = writtenProjectKey(unit.extras);
  return rows.filter((row) => writtenProjectKey(row.extras) === key);
}

/** Gemini's saved answer for this unit's project name, or null (no answer, or "not sure"). */
async function rememberedNames(db: Db, unit: UnitRow): Promise<UnitView['learning']['lookup']> {
  const found = await lookupFor(db, unit);
  if (!found?.known || (!found.developer && !found.city)) return null;
  return { developer: found.developer, city: found.city };
}

/**
 * Whether a saved developer / area is the one Gemini named: any of its
 * names or spellings, compared the way names are everywhere (same letters
 * whatever the spelling, upper or lower case).
 */
async function isAnswer(db: Db, kind: 'developer' | 'city', id: number, answer: string) {
  const table = kind === 'developer' ? developers : cities;
  const [row] = await db
    .select({ nameEn: table.nameEn, nameAr: table.nameAr })
    .from(table)
    .where(eq(table.id, id));
  const aliases = await db
    .select({ alias: entityAliases.alias })
    .from(entityAliases)
    .where(eq(kind === 'developer' ? entityAliases.developerId : entityAliases.cityId, id));
  const wanted = normalizeName(answer);
  return [row?.nameEn, row?.nameAr, ...aliases.map((a) => a.alias)].some(
    (name) => name !== undefined && normalizeName(name) === wanted,
  );
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
 * is an extraction error, not a market price change. A plans edit counts as
 * one too, since the unit's down payment and installment columns follow the
 * first plan.
 */
export async function reviewUnit(
  database: Database,
  unitId: number,
  input: ReviewInput,
  reviewerId: string | null,
  ipAddress?: string,
): Promise<UnitRow> {
  return (await reviewUnitDetailed(database, unitId, input, reviewerId, ipAddress)).unit;
}

export interface ReviewInput {
  action: ReviewAction;
  changes?: unknown;
  /**
   * The unit's payment plans as the reviewer left them. Left out = untouched.
   * Sent and different = stored as the newest source (see `currentPlans`).
   */
  paymentPlans?: unknown;
  /** Spellings the reviewer ticked "remember": added to the unit's entity after the changes. */
  remember?: { kind: EntityKind; alias: string }[];
  /**
   * The other listings from the same message (see `siblingsOf`). `apply`:
   * give them this unit's project, developer and area. `approve`: approve
   * them too; only honoured when this unit is approved.
   */
  siblings?: { apply: boolean; approve: boolean };
}

/** The names a review can pass on to the other listings of a message. */
const SIBLING_FIELDS = [
  ['developerId', 'developer'],
  ['projectId', 'project'],
  ['cityId', 'city'],
] as const;

/**
 * Like `reviewUnit`, and also says how many other listings from the same
 * message were changed (0 unless `input.siblings.apply`).
 */
export async function reviewUnitDetailed(
  database: Database,
  unitId: number,
  input: ReviewInput,
  reviewerId: string | null,
  ipAddress?: string,
): Promise<{ unit: UnitRow; siblings: number }> {
  const asked = editableUnitSchema.parse(input.changes ?? {});
  // Order is the order sent; positions are renumbered so they can't clash.
  // A row left completely empty ("+ Add plan" with nothing typed) is not a plan.
  const newPlans =
    input.paymentPlans === undefined
      ? undefined
      : editablePlansSchema
          .parse(input.paymentPlans)
          .filter((plan) => !isEmptyPlan(plan))
          .map((plan, position): PaymentPlan => ({ ...plan, position }));
  return database.transaction(async (tx) => {
    const [unit] = await tx.select().from(units).where(eq(units.id, unitId)).for('update');
    if (!unit) throw new NotFoundError(`Unit ${unitId} not found`);
    const [source] = await tx
      .select({ messageId: unitSources.messageId })
      .from(unitSources)
      .where(and(eq(unitSources.unitId, unitId), eq(unitSources.role, 'listing')))
      .orderBy(asc(unitSources.createdAt), asc(unitSources.messageId))
      .limit(1);

    // Plans: compared with the current ones, so resending the same list is a no-op.
    const before = newPlans ? await currentPlans(tx, unitId) : [];
    const plansEdited = newPlans !== undefined && !same(before, newPlans);
    // The unit's own payment columns keep coming from the first plan listed
    // (spec, "What code stores"), so a plans edit moves them too, as ordinary
    // corrections. Plans carry no cash discount: it is left alone, except that
    // clearing every plan clears it with the rest. A column the reviewer edited
    // in the same save keeps the reviewer's value.
    const fromPlans: UnitChanges = {};
    if (plansEdited) {
      const minPrice = asked.minPrice !== undefined ? asked.minPrice : unit.minPrice;
      Object.assign(fromPlans, columnsFromPlan(newPlans[0], minPrice));
      if (newPlans.length === 0) {
        Object.assign(fromPlans, {
          cashDiscount: null,
          cashDiscountCurrency: null,
          cashDiscountType: null,
        });
      }
    }
    const changes: UnitChanges = { ...fromPlans, ...asked };

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
    // Plans: the reviewer's list becomes the newest source (rows tagged
    // 'review', stamped now). Message rows are kept, so retracting a message
    // can still bring back the plans it replaced.
    if (newPlans) {
      if (plansEdited) {
        corrections.push({
          unitId,
          messageId: source?.messageId ?? null,
          action: 'edit',
          field: 'paymentPlans',
          before,
          after: newPlans,
          reviewerId,
        });
        // A JavaScript time (milliseconds), not the database's now(): rows of one
        // source are found by comparing times, and the database keeps microseconds.
        const stamp = new Date();
        // An empty list is stored as one "no plans" marker row.
        const rows =
          newPlans.length > 0
            ? newPlans.map((plan) => ({ ...plan, cleared: false }))
            : [
                {
                  position: 0,
                  label: null,
                  downPaymentPercent: null,
                  downPaymentAmount: null,
                  installmentAmount: null,
                  installmentFrequency: null,
                  installmentsCount: null,
                  installmentYears: null,
                  planPrice: null,
                  cash: false,
                  notes: null,
                  currency: before[0]?.currency ?? ('EGP' as const),
                  cleared: true,
                },
              ];
        await tx.insert(unitPaymentPlans).values(
          rows.map((plan) => ({
            ...plan,
            unitId,
            sourceMessageId: null,
            source: 'review' as const,
            observedAt: stamp,
          })),
        );
      }
    }
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

    // Counting how often Gemini's answer is right: once per field per save,
    // only when the field was empty and an answer is saved for the name.
    // `lookup.used` when the saved developer / area is the answer (by any
    // spelling), `lookup.ignored` when it is a different one.
    const remembered = await rememberedNames(tx, unit);
    for (const [kind, field] of [
      ['developer', 'developerId'],
      ['city', 'cityId'],
    ] as const) {
      const answer = remembered?.[kind];
      const chosen = changes[field];
      if (!answer || unit[field] !== null || typeof chosen !== 'number') continue;
      await audit(tx, {
        userId: reviewerId,
        action: (await isAnswer(tx, kind, chosen, answer)) ? 'lookup.used' : 'lookup.ignored',
        target: answer,
        details: { unitId, kind },
        ipAddress,
      });
    }

    // Spellings to remember go to the entity the unit has now (after the
    // changes above). Same transaction: a failed save learns nothing. A
    // kind the unit has no entity for is skipped; a known spelling is a no-op.
    const ownerOf = {
      developer: saved.developerId,
      project: saved.projectId,
      city: saved.cityId,
    } as const;
    for (const { kind, alias } of input.remember ?? []) {
      const entityId = ownerOf[kind];
      if (entityId === null || !normalizeName(alias)) continue;
      await addAlias(tx, kind, entityId, alias, { source: 'review', reviewUnitId: unitId });
    }

    // The other listings from this message. Rejecting a unit says nothing
    // about its siblings' names, so only a save or an approve passes them on.
    // Which names: on Approve all of the unit's names (approving confirms
    // them); on a Save only the names the reviewer changed in this save, so
    // a name the pipeline guessed is never stamped on the siblings as if a
    // person had chosen it.
    let siblings = 0;
    if (input.siblings?.apply && input.action !== 'reject' && source) {
      const approve = input.siblings.approve && input.action === 'approve';
      const fields = SIBLING_FIELDS.filter(
        ([field]) => input.action === 'approve' || changed.includes(field),
      );
      for (const sibling of await siblingsOf(tx, saved, true)) {
        const passed = await passNamesOn(tx, saved, sibling, {
          fields,
          messageId: source.messageId,
          approve,
          reviewerId,
        });
        if (passed) {
          siblings += 1;
        }
      }
    }
    return { unit: saved, siblings };
  });
}

/**
 * Gives one sibling the reviewed unit's names (those in `fields`), recorded
 * as review corrections so the name re-check leaves it alone afterwards.
 * Only the names change (never prices, areas or plans): each name the
 * reviewed unit has and the sibling lacks or has differently. The sibling's name reasons
 * for those names go; with no reason left it no longer waits for review.
 * `approve` approves it outright, like the reviewed unit. Returns whether
 * anything changed, so running the same review twice changes nothing more.
 */
async function passNamesOn(
  tx: Db,
  reviewed: UnitRow,
  sibling: UnitRow,
  options: {
    fields: readonly (typeof SIBLING_FIELDS)[number][];
    messageId: number;
    approve: boolean;
    reviewerId: string | null;
  },
): Promise<boolean> {
  const { fields, messageId, approve, reviewerId } = options;
  const update: Partial<typeof units.$inferInsert> = {};
  const corrections: (typeof reviewCorrections.$inferInsert)[] = [];
  const settled = new Set<string>();
  for (const [field, kind] of fields) {
    const value = reviewed[field];
    if (value === null || value === sibling[field]) continue;
    update[field] = value;
    settled.add(kind);
    corrections.push({
      unitId: sibling.id,
      messageId,
      action: 'edit',
      field,
      before: sibling[field],
      after: value,
      reviewerId,
    });
  }
  if (approve) {
    Object.assign(update, { needsReview: false, reviewReasons: [], confidence: 1 });
    corrections.push({ unitId: sibling.id, messageId, action: 'approve', reviewerId });
  } else if (settled.size > 0) {
    const reasons = sibling.reviewReasons.filter(
      (reason) => !nameReasonFields(reason).some((kind) => settled.has(kind)),
    );
    update.reviewReasons = reasons;
    if (reasons.length === 0) update.needsReview = false;
  }
  if (corrections.length === 0) return false;
  await tx.insert(reviewCorrections).values(corrections);
  await tx.update(units).set(update).where(eq(units.id, sibling.id));
  return true;
}

export class NotFoundError extends Error {
  override name = 'NotFoundError';
}
