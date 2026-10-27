import { CATEGORIES, FINISHING_SPECS, UNIT_TYPES } from '@reb/schema/enums';
import { z } from 'zod';

/**
 * The listing search filters: one shape for the dashboard, exports, saved
 * searches and (Phase 7) the chat bots, so the same question gives the same
 * answer everywhere. This file has no database code, so the web app uses it
 * too.
 *
 * Prices are whole Egyptian pounds and areas square metres. A listing
 * matches a range when its own range overlaps it ("from 120 to 180 m²"
 * matches "at least 150 m²").
 */

/** Statuses a firm can see. Withdrawn listings (not real offers) never show. */
export const VISIBLE_STATUSES = ['active', 'stale', 'sold'] as const;
export const SORTS = ['newest', 'price_asc', 'price_desc', 'ppsqm_asc', 'ppsqm_desc'] as const;

const ids = z.array(z.number().int().positive()).max(50);
const count = z.number().int().min(0).max(20);

export const searchFiltersSchema = z
  .object({
    /** Free text matched against every spelling of projects, developers and areas. */
    q: z.string().trim().min(1).max(100),
    cityIds: ids,
    developerIds: ids,
    projectIds: ids,
    unitTypes: z.array(z.enum(UNIT_TYPES)).max(UNIT_TYPES.length),
    categories: z.array(z.enum(CATEGORIES)).max(CATEGORIES.length),
    finishing: z.array(z.enum(FINISHING_SPECS)).max(FINISHING_SPECS.length),
    bedroomsMin: count,
    bedroomsMax: count,
    areaMin: z.number().positive().max(100_000),
    areaMax: z.number().positive().max(100_000),
    priceMin: z.number().nonnegative().max(10_000_000_000),
    priceMax: z.number().positive().max(10_000_000_000),
    /** Delivered by the end of this year (ready-to-move units always match). */
    deliveryYearMax: z.number().int().min(2000).max(2100),
    readyToMove: z.boolean(),
    downPaymentMax: z.number().min(0).max(100),
    installmentYearsMin: z.number().min(0).max(30),
    /** Only listings whose latest price is lower than the one before. */
    priceDropped: z.boolean(),
    statuses: z.array(z.enum(VISIBLE_STATUSES)).min(1).max(3),
    sort: z.enum(SORTS),
  })
  .partial()
  .strict();

export type SearchFilters = z.infer<typeof searchFiltersSchema>;
export type Sort = (typeof SORTS)[number];

const LIST_KEYS = [
  'cityIds',
  'developerIds',
  'projectIds',
  'unitTypes',
  'categories',
  'finishing',
  'statuses',
] as const;
const NUMBER_KEYS = [
  'bedroomsMin',
  'bedroomsMax',
  'areaMin',
  'areaMax',
  'priceMin',
  'priceMax',
  'deliveryYearMax',
  'downPaymentMax',
  'installmentYearsMin',
] as const;
const BOOLEAN_KEYS = ['readyToMove', 'priceDropped'] as const;
const NUMBER_LISTS = new Set(['cityIds', 'developerIds', 'projectIds']);

/**
 * Filters from a URL query (`?unitTypes=Apartment,Villa&priceMax=8000000`).
 * Lists are comma-separated; unknown keys are refused. Throws a ZodError on
 * a bad value.
 */
export function filtersFromQuery(query: Record<string, string | undefined>): SearchFilters {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '' || key === 'page' || key === 'pageSize') continue;
    if ((LIST_KEYS as readonly string[]).includes(key)) {
      const parts = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      raw[key] = NUMBER_LISTS.has(key) ? parts.map(Number) : parts;
    } else if ((NUMBER_KEYS as readonly string[]).includes(key)) {
      raw[key] = Number(value);
    } else if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
      raw[key] = value === 'true' || value === '1';
    } else {
      raw[key] = value;
    }
  }
  return searchFiltersSchema.parse(raw);
}

/** The reverse of `filtersFromQuery`: filters as a URL query string (no leading `?`). */
export function filtersToQuery(filters: SearchFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

/** True when no filter narrows the results (the sort alone doesn't count). */
export function isEmptySearch(filters: SearchFilters): boolean {
  return Object.entries(filters as Record<string, unknown>).every(
    ([key, value]) =>
      key === 'sort' || value === undefined || (Array.isArray(value) && value.length === 0),
  );
}
