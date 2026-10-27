import {
  cities,
  developers,
  mediaFiles,
  messages,
  projects,
  unitPrices,
  units,
  unitSources,
  waGroups,
  type Db,
} from '@reb/db';
import { scrubPersonalData } from '@reb/llm';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { VISIBLE_STATUSES } from './filters.ts';
import type { Names } from './search.ts';

/**
 * What a firm sees about one listing: every field, price history and the
 * messages it came from. Never who posted, never which group (Hassan's
 * sources are his business), and phone numbers and e-mails inside the text
 * are blanked out, so a firm can't go around the service to the broker.
 */
export interface ListingSource {
  role: string;
  sentAt: string;
  /** `developer` or `broker`, as the owner marked the group; null if not set. */
  postedIn: string | null;
  text: string | null;
  media: { id: number; kind: string; mimeType: string | null; text: string | null } | null;
}

export interface ListingDetail {
  unit: Record<string, unknown> & { id: number; status: string; priceCurrency: string };
  names: { project: Names | null; developer: Names | null; city: Names | null };
  prices: {
    minPrice: number | null;
    maxPrice: number | null;
    priceCurrency: string;
    downPayment: number | null;
    installmentYears: number | null;
    observedAt: string;
  }[];
  sources: ListingSource[];
}

/** Fields of `units` that are internal to the pipeline and not shown to firms. */
const HIDDEN = new Set([
  'extras',
  'extractionRunId',
  'soldByMessageId',
  'reviewReasons',
  'needsReview',
]);

export async function listingDetail(db: Db, unitId: number): Promise<ListingDetail | null> {
  const [unit] = await db
    .select()
    .from(units)
    .where(and(eq(units.id, unitId), inArray(units.status, [...VISIBLE_STATUSES])));
  if (!unit) return null;

  const nameOf = async (
    table: typeof cities | typeof developers | typeof projects,
    id: number | null,
  ) => {
    if (id === null) return null;
    const [row] = await db
      .select({ en: table.nameEn, ar: table.nameAr })
      .from(table)
      .where(eq(table.id, id));
    return row ?? null;
  };
  const [project, developer, city, prices, sourceRows] = await Promise.all([
    nameOf(projects, unit.projectId),
    nameOf(developers, unit.developerId),
    nameOf(cities, unit.cityId),
    db
      .select()
      .from(unitPrices)
      .where(eq(unitPrices.unitId, unitId))
      .orderBy(desc(unitPrices.observedAt), desc(unitPrices.id)),
    db
      .select({
        role: unitSources.role,
        sentAt: messages.sentAt,
        postedIn: waGroups.sourceType,
        text: messages.text,
        mediaId: mediaFiles.id,
        mediaKind: mediaFiles.kind,
        mimeType: mediaFiles.mimeType,
        mediaStatus: mediaFiles.status,
        mediaText: mediaFiles.derivedText,
      })
      .from(unitSources)
      .innerJoin(messages, eq(messages.id, unitSources.messageId))
      .innerJoin(waGroups, eq(waGroups.id, messages.groupId))
      .leftJoin(mediaFiles, eq(mediaFiles.messageId, messages.id))
      .where(eq(unitSources.unitId, unitId))
      .orderBy(asc(messages.sentAt)),
  ]);

  const shown = Object.fromEntries(Object.entries(unit).filter(([key]) => !HIDDEN.has(key)));
  return {
    unit: shown as ListingDetail['unit'],
    names: { project, developer, city },
    prices: prices.map((p) => ({
      minPrice: p.minPrice,
      maxPrice: p.maxPrice,
      priceCurrency: p.priceCurrency,
      downPayment: p.downPayment,
      installmentYears: p.installmentYears,
      observedAt: p.observedAt.toISOString(),
    })),
    sources: sourceRows.map((s) => ({
      role: s.role,
      sentAt: s.sentAt.toISOString(),
      postedIn: s.postedIn,
      text: s.text ? scrubPersonalData(s.text) : null,
      media:
        s.mediaId !== null && s.mediaStatus === 'downloaded'
          ? {
              id: s.mediaId,
              kind: s.mediaKind ?? 'document',
              mimeType: s.mimeType,
              text: s.mediaText ? scrubPersonalData(s.mediaText) : null,
            }
          : null,
    })),
  };
}

/**
 * The stored file for a media id, only if it belongs to a message behind a
 * listing firms can see. Anything else (unwatched chatter, withdrawn units)
 * stays private to the owner.
 */
export async function visibleMedia(
  db: Db,
  mediaId: number,
): Promise<{ path: string; mimeType: string | null } | null> {
  const [row] = await db
    .select({ path: mediaFiles.path, mimeType: mediaFiles.mimeType })
    .from(mediaFiles)
    .innerJoin(unitSources, eq(unitSources.messageId, mediaFiles.messageId))
    .innerJoin(units, eq(units.id, unitSources.unitId))
    .where(
      and(
        eq(mediaFiles.id, mediaId),
        eq(mediaFiles.status, 'downloaded'),
        ne(units.status, 'withdrawn'),
      ),
    )
    .limit(1);
  return row?.path ? { path: row.path, mimeType: row.mimeType } : null;
}
