import {
  cities,
  developers,
  mediaFiles,
  messages,
  projects,
  reviewCorrections,
  units,
  unitSources,
  type Db,
} from '@reb/db';
import { and, eq, inArray } from 'drizzle-orm';

type Comparable = Record<string, string | number | boolean | null>;

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
        units: kept.map((u) => ({
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
        })),
      },
    });
  }
  return cases;
}
