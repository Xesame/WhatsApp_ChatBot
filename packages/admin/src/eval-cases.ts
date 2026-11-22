import {
  cities,
  developers,
  mediaFiles,
  messages,
  projects,
  reviewCorrections,
  unitPaymentPlans,
  units,
  unitSources,
  type Db,
} from '@reb/db';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

type Value = string | number | boolean | null;
type ComparablePlan = Record<string, Value>;
type Comparable = Record<string, Value | ComparablePlan[]>;

export interface ReviewCase {
  /** Folder name under eval/cases. */
  id: string;
  messageText: string;
  quotedText: string | null;
  media: { path: string; kind: string; mimeType: string | null } | null;
  expected: {
    source: 'review';
    kind: 'text' | 'image' | 'pdf' | 'spreadsheet';
    sentAt: string;
    intent: 'listing' | 'not_relevant';
    units: Comparable[];
  };
}

const major = (minor: number | null) => (minor === null ? null : minor / 100);

/**
 * The plans a case expects for one unit: what this message said, never a
 * later repost ("newest post wins" makes today's plans possibly another
 * message's). Plans the owner typed while reviewing this unit win, because
 * they are his correction of this message; Review records those corrections
 * against the unit's first message, so they belong to that message's case.
 */
async function expectedPlans(db: Db, unitId: number, messageId: number): Promise<ComparablePlan[]> {
  const [corrected] = await db
    .select({ id: reviewCorrections.id })
    .from(reviewCorrections)
    .where(
      and(
        eq(reviewCorrections.unitId, unitId),
        eq(reviewCorrections.messageId, messageId),
        eq(reviewCorrections.field, 'paymentPlans'),
      ),
    )
    .limit(1);
  let rows: (typeof unitPaymentPlans.$inferSelect)[];
  if (corrected) {
    // No review rows left means the owner removed every plan: expect none.
    // The newest set the owner saved (rows of one save share their time).
    const [newest] = await db
      .select({ observedAt: unitPaymentPlans.observedAt })
      .from(unitPaymentPlans)
      .where(and(eq(unitPaymentPlans.unitId, unitId), eq(unitPaymentPlans.source, 'review')))
      .orderBy(desc(unitPaymentPlans.observedAt))
      .limit(1);
    rows = !newest
      ? []
      : await db
          .select()
          .from(unitPaymentPlans)
          .where(
            and(
              eq(unitPaymentPlans.unitId, unitId),
              eq(unitPaymentPlans.source, 'review'),
              eq(unitPaymentPlans.observedAt, newest.observedAt),
            ),
          )
          .orderBy(asc(unitPaymentPlans.position), asc(unitPaymentPlans.id));
  } else {
    rows = await db
      .select()
      .from(unitPaymentPlans)
      .where(
        and(eq(unitPaymentPlans.unitId, unitId), eq(unitPaymentPlans.sourceMessageId, messageId)),
      )
      .orderBy(asc(unitPaymentPlans.position), asc(unitPaymentPlans.id));
  }
  // The details eval/compare.ts scores (PLAN_FIELDS), in whole currency units.
  return rows.map((r) => ({
    downPaymentPercent: r.downPaymentPercent,
    installmentAmount: major(r.installmentAmount),
    installmentFrequency: r.installmentFrequency,
    installmentYears: r.installmentYears,
  }));
}

/**
 * Turns reviewed messages into eval cases (build plan: review corrections
 * feed the eval set). For every message whose units were reviewed, the
 * expected answer is the units as they are now, after the owner's
 * corrections; rejected units are left out (a message with only rejected
 * units becomes a "not relevant" case).
 *
 * The values are in export form (English names, whole currency units),
 * like hand-written cases. Check each case once before committing it: a
 * unit merged from several messages may carry details another message added.
 */
export async function reviewCases(db: Db): Promise<ReviewCase[]> {
  const reviewed = await db
    .selectDistinct({ messageId: reviewCorrections.messageId })
    .from(reviewCorrections);
  const messageIds = reviewed.map((r) => r.messageId).filter((id): id is number => id !== null);
  if (messageIds.length === 0) return [];

  const names = {
    developer: new Map(
      (await db.select({ id: developers.id, n: developers.nameEn }).from(developers)).map((r) => [
        r.id,
        r.n,
      ]),
    ),
    project: new Map(
      (await db.select({ id: projects.id, n: projects.nameEn }).from(projects)).map((r) => [
        r.id,
        r.n,
      ]),
    ),
    city: new Map(
      (await db.select({ id: cities.id, n: cities.nameEn }).from(cities)).map((r) => [r.id, r.n]),
    ),
  };
  const name = (map: Map<number, string>, id: number | null) =>
    id === null ? null : (map.get(id) ?? null);

  const cases: ReviewCase[] = [];
  for (const messageId of messageIds) {
    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    if (!message) continue;
    const linked = await db
      .select({ unit: units })
      .from(unitSources)
      .innerJoin(units, eq(units.id, unitSources.unitId))
      .where(and(eq(unitSources.messageId, messageId), eq(unitSources.role, 'listing')));
    const rejected = new Set(
      (
        await db
          .select({ unitId: reviewCorrections.unitId })
          .from(reviewCorrections)
          .where(
            and(
              eq(reviewCorrections.action, 'reject'),
              inArray(reviewCorrections.unitId, linked.map((l) => l.unit.id).concat(-1)),
            ),
          )
      ).map((r) => r.unitId),
    );
    const kept = linked.map((l) => l.unit).filter((u) => !rejected.has(u.id));

    let quotedText: string | null = null;
    const quotedId = message.quotedWaMessageId ?? message.editOfWaMessageId;
    if (quotedId) {
      const [quoted] = await db
        .select({ text: messages.text })
        .from(messages)
        .where(and(eq(messages.groupId, message.groupId), eq(messages.waMessageId, quotedId)));
      quotedText = quoted?.text ?? null;
    }
    const [file] = await db.select().from(mediaFiles).where(eq(mediaFiles.messageId, messageId));
    const media =
      file?.status === 'downloaded' && file.path
        ? { path: file.path, kind: file.kind, mimeType: file.mimeType }
        : null;
    const kind = !media
      ? 'text'
      : media.kind === 'image'
        ? 'image'
        : /pdf/.test(media.mimeType ?? '')
          ? 'pdf'
          : /sheet|excel/.test(media.mimeType ?? '')
            ? 'spreadsheet'
            : 'text';

    cases.push({
      id: `review-message-${messageId}`,
      messageText: message.text ?? '',
      quotedText,
      media,
      expected: {
        source: 'review',
        kind,
        sentAt: message.sentAt.toISOString(),
        intent: kept.length > 0 ? 'listing' : 'not_relevant',
        units: await Promise.all(
          kept.map(async (u) => ({
            category: u.category,
            developer: name(names.developer, u.developerId),
            project: name(names.project, u.projectId),
            city: name(names.city, u.cityId),
            unitType: u.unitType,
            unitCode: u.unitCode,
            floor: u.floor,
            finishingSpecs: u.finishingSpecs,
            minArea: u.minArea,
            maxArea: u.maxArea,
            landArea: u.landArea,
            gardenArea: u.gardenArea,
            outdoorArea: u.outdoorArea,
            minPrice: major(u.minPrice),
            maxPrice: major(u.maxPrice),
            priceCurrency: u.priceCurrency,
            deliveryYear: u.deliveryYear,
            readyToMove: u.readyToMove,
            maintenance: u.maintenance,
            maintenanceCurrency: u.maintenanceCurrency,
            cashDiscount: u.cashDiscount,
            cashDiscountType: u.cashDiscountType,
            downPayment: u.downPayment,
            installmentsCount: u.installmentsCount,
            bedrooms: u.bedrooms,
            bathrooms: u.bathrooms,
            paymentPlans: await expectedPlans(db, u.id, messageId),
          })),
        ),
      },
    });
  }
  return cases;
}
