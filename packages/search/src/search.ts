import type { Db } from '@reb/db';
import { normalizeName } from '@reb/normalize';
import { sql, type SQL } from 'drizzle-orm';
import type { SearchFilters } from './filters.ts';

export interface Names {
  en: string;
  ar: string;
}

/** One listing in search results. Money is in minor units (piastres / cents). */
export interface SearchItem {
  id: number;
  project: Names | null;
  developer: Names | null;
  city: Names | null;
  category: string | null;
  unitType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  minArea: number | null;
  maxArea: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  priceCurrency: string;
  /** The prices in EGP piastres (USD converted at the owner's rate), or null without a rate. */
  minPriceEgp: number | null;
  maxPriceEgp: number | null;
  /** EGP per m² (whole pounds), from the lowest price and smallest area. */
  pricePerSqm: number | null;
  /** The price before the latest change, when the listing's price changed. */
  previousMinPrice: number | null;
  downPayment: number | null;
  installmentYears: number | null;
  deliveryYear: number | null;
  readyToMove: boolean;
  finishingSpecs: string | null;
  status: string;
  /** How many messages mentioned it (reposts across groups). */
  sourceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SearchOptions {
  /** EGP per 1 USD; without it, USD listings have no EGP price and drop out of price filters. */
  usdEgpRate: number | undefined;
  page?: number;
  pageSize?: number;
}

const list = (values: readonly (string | number)[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/** Escapes `%` and `_` so typed text is matched literally inside LIKE. */
const likeText = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The WHERE conditions and price expressions shared by search, count and export. */
function build(filters: SearchFilters, rate: number | undefined) {
  const r = sql`${rate ?? null}::numeric`;
  const egp = (column: SQL) =>
    sql`(case when u.price_currency = 'EGP' then ${column} else round(${column} * ${r}) end)`;
  const lowEgp = egp(sql`coalesce(u.min_price, u.max_price)`);
  const highEgp = egp(sql`coalesce(u.max_price, u.min_price)`);
  const smallArea = sql`coalesce(u.min_area, u.max_area)`;
  const previous = sql`(select p.min_price from unit_prices p where p.unit_id = u.id order by p.observed_at desc, p.id desc offset 1 limit 1)`;

  const where: SQL[] = [sql`u.status in (${list(filters.statuses ?? ['active'])})`];
  const add = (condition: SQL) => where.push(condition);
  if (filters.cityIds?.length) add(sql`u.city_id in (${list(filters.cityIds)})`);
  if (filters.developerIds?.length) add(sql`u.developer_id in (${list(filters.developerIds)})`);
  if (filters.projectIds?.length) add(sql`u.project_id in (${list(filters.projectIds)})`);
  if (filters.unitTypes?.length) add(sql`u.unit_type in (${list(filters.unitTypes)})`);
  if (filters.categories?.length) add(sql`u.category in (${list(filters.categories)})`);
  if (filters.finishing?.length) add(sql`u.finishing_specs in (${list(filters.finishing)})`);
  if (filters.bedroomsMin !== undefined) add(sql`u.bedrooms >= ${filters.bedroomsMin}`);
  if (filters.bedroomsMax !== undefined) add(sql`u.bedrooms <= ${filters.bedroomsMax}`);
  if (filters.areaMin !== undefined)
    add(sql`coalesce(u.max_area, u.min_area) >= ${filters.areaMin}`);
  if (filters.areaMax !== undefined) add(sql`${smallArea} <= ${filters.areaMax}`);
  if (filters.priceMin !== undefined) add(sql`${highEgp} >= ${Math.round(filters.priceMin * 100)}`);
  if (filters.priceMax !== undefined) add(sql`${lowEgp} <= ${Math.round(filters.priceMax * 100)}`);
  if (filters.deliveryYearMax !== undefined) {
    add(sql`(u.ready_to_move or u.delivery_year <= ${filters.deliveryYearMax})`);
  }
  if (filters.readyToMove !== undefined) add(sql`u.ready_to_move = ${filters.readyToMove}`);
  if (filters.downPaymentMax !== undefined) add(sql`u.down_payment <= ${filters.downPaymentMax}`);
  if (filters.installmentYearsMin !== undefined) {
    add(sql`u.installment_years >= ${filters.installmentYearsMin}`);
  }
  if (filters.priceDropped) add(sql`u.min_price < ${previous}`);
  if (filters.q) {
    const pattern = `%${likeText(normalizeName(filters.q))}%`;
    add(sql`exists (
      select 1 from entity_aliases a
      where a.alias_normalized like ${pattern}
        and (a.project_id = u.project_id or a.developer_id = u.developer_id or a.city_id = u.city_id))`);
  }

  const pricePerSqm = sql`(${lowEgp} / 100.0 / nullif(${smallArea}, 0))`;
  const order = {
    newest: sql`u.last_seen_at desc, u.id desc`,
    price_asc: sql`${lowEgp} asc nulls last, u.id`,
    price_desc: sql`${lowEgp} desc nulls last, u.id`,
    ppsqm_asc: sql`${pricePerSqm} asc nulls last, u.id`,
    ppsqm_desc: sql`${pricePerSqm} desc nulls last, u.id`,
  }[filters.sort ?? 'newest'];

  return { where: sql.join(where, sql` and `), order, lowEgp, highEgp, pricePerSqm, previous };
}

type Row = {
  id: string;
  project_en: string | null;
  project_ar: string | null;
  developer_en: string | null;
  developer_ar: string | null;
  city_en: string | null;
  city_ar: string | null;
  category: string | null;
  unit_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  min_area: string | null;
  max_area: string | null;
  min_price: string | null;
  max_price: string | null;
  price_currency: string;
  low_egp: string | null;
  high_egp: string | null;
  price_per_sqm: string | null;
  previous_min: string | null;
  down_payment: string | null;
  installment_years: string | null;
  delivery_year: number | null;
  ready_to_move: boolean;
  finishing_specs: string | null;
  status: string;
  source_count: string;
  first_seen_at: string | Date;
  last_seen_at: string | Date;
};

const num = (v: string | number | null) => (v === null ? null : Number(v));
const names = (en: string | null, ar: string | null): Names | null =>
  en ? { en, ar: ar ?? en } : null;

function toItem(r: Row): SearchItem {
  const previous = num(r.previous_min);
  const minPrice = num(r.min_price);
  return {
    id: Number(r.id),
    project: names(r.project_en, r.project_ar),
    developer: names(r.developer_en, r.developer_ar),
    city: names(r.city_en, r.city_ar),
    category: r.category,
    unitType: r.unit_type,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    minArea: num(r.min_area),
    maxArea: num(r.max_area),
    minPrice,
    maxPrice: num(r.max_price),
    priceCurrency: r.price_currency,
    minPriceEgp: num(r.low_egp),
    maxPriceEgp: num(r.high_egp),
    pricePerSqm: r.price_per_sqm === null ? null : Math.round(Number(r.price_per_sqm)),
    previousMinPrice: previous !== null && previous !== minPrice ? previous : null,
    downPayment: num(r.down_payment),
    installmentYears: num(r.installment_years),
    deliveryYear: r.delivery_year,
    readyToMove: r.ready_to_move,
    finishingSpecs: r.finishing_specs,
    status: r.status,
    sourceCount: Number(r.source_count),
    firstSeenAt: new Date(r.first_seen_at).toISOString(),
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
  };
}

/** Rows of `units` joined with names, under the given conditions. */
function selectUnits(b: ReturnType<typeof build>) {
  return sql`
    select u.id, p.name_en as project_en, p.name_ar as project_ar,
      d.name_en as developer_en, d.name_ar as developer_ar,
      c.name_en as city_en, c.name_ar as city_ar,
      u.category, u.unit_type, u.bedrooms, u.bathrooms, u.min_area, u.max_area,
      u.min_price, u.max_price, u.price_currency,
      ${b.lowEgp} as low_egp, ${b.highEgp} as high_egp, ${b.pricePerSqm} as price_per_sqm,
      ${b.previous} as previous_min,
      u.down_payment, u.installment_years, u.delivery_year, u.ready_to_move, u.finishing_specs,
      u.status, (select count(*) from unit_sources s where s.unit_id = u.id) as source_count,
      u.first_seen_at, u.last_seen_at
    from units u
    left join projects p on p.id = u.project_id
    left join developers d on d.id = u.developer_id
    left join cities c on c.id = u.city_id
    where ${b.where}`;
}

/** One page of listings matching the filters, and the total number of matches. */
export async function searchListings(
  db: Db,
  filters: SearchFilters,
  options: SearchOptions,
): Promise<{ items: SearchItem[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 25)));
  const b = build(filters, options.usdEgpRate);
  const [rows, counted] = await Promise.all([
    db.execute<Row>(
      sql`${selectUnits(b)} order by ${b.order} limit ${pageSize} offset ${(page - 1) * pageSize}`,
    ),
    db.execute<{ total: string }>(sql`select count(*) as total from units u where ${b.where}`),
  ]);
  return {
    items: rows.rows.map(toItem),
    total: Number(counted.rows[0]?.total ?? 0),
    page,
    pageSize,
  };
}

/** IDs of every matching listing, in the chosen order (for exports), up to `limit`. */
export async function matchingIds(
  db: Db,
  filters: SearchFilters,
  options: { usdEgpRate: number | undefined; limit: number },
): Promise<number[]> {
  const b = build(filters, options.usdEgpRate);
  const rows = await db.execute<{ id: string }>(
    sql`select u.id from units u where ${b.where} order by ${b.order} limit ${options.limit}`,
  );
  return rows.rows.map((r) => Number(r.id));
}
