import type { Category, RawUnit, Unit, UnitType } from '@reb/schema';
import { detectCurrency, parseDelivery, parseFloor, parseInstallments } from './fields.ts';
import { parseCount, parsePercentOrAmount, parseRange } from './numbers.ts';
import { normalizeName } from './text.ts';

/** Result of matching a name against the alias table (done by the pipeline). */
export interface EntityMatch {
  id: number;
  name: string;
  /** 1 for an exact alias match, the trigram similarity otherwise. */
  similarity: number;
}

export interface ProjectMatch extends EntityMatch {
  developerId: number;
  cityId: number;
}

export interface NormalizeContext {
  /** The text the model read (message, quoted message), for the no-invention check. */
  sourceText: string;
  sentAt: Date;
  developer: EntityMatch | null;
  project: ProjectMatch | null;
  city: EntityMatch | null;
}

/** Compares text ignoring case, spacing, punctuation, diacritics and digit style. */
const compact = (text: string) => normalizeName(text).replace(/\s+/g, '');

/** True when `value` appears in the source text (loosely compared). */
export function appearsIn(value: string, source: string): boolean {
  const needle = compact(value);
  return needle.length > 0 && compact(source).includes(needle);
}

const CATEGORY_BY_TYPE: Partial<Record<UnitType, Category>> = {
  Office: 'Administrative',
  Retail: 'Commercial',
  Clinic: 'Medical',
};

/** Fields the model must copy from the text; anything not found there is dropped. */
const COPIED_FIELDS = [
  'developer',
  'project',
  'city',
  'unit_code',
  'floor',
  'bedrooms',
  'bathrooms',
  'area',
  'land_area',
  'garden_area',
  'outdoor_area',
  'price',
  'delivery',
  'maintenance',
  'down_payment',
  'installments',
  'cash_discount',
] as const satisfies readonly (keyof RawUnit)[];

const toMinor = (major: number | null) => (major === null ? null : Math.round(major * 100));
const plausibleArea = (n: number | null) => (n !== null && n >= 10 && n <= 100_000 ? n : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Turns one raw unit from the model into a normalized unit. Every number,
 * currency and calculation happens here, in code (build plan, rule 4).
 * Confidence and review reasons are computed here too, from which fields
 * were found and how well names matched.
 */
export function normalizeUnit(input: RawUnit, ctx: NormalizeContext): Unit {
  const reasons: string[] = [];
  const raw: RawUnit = { ...input, evidence: { ...input.evidence } };

  // 1. No invention: a value the message doesn't contain is dropped.
  for (const field of COPIED_FIELDS) {
    const value = raw[field];
    if (value !== null && !appearsIn(value, ctx.sourceText)) {
      reasons.push(`Dropped ${field} "${value}": not found in the message`);
      raw[field] = null;
    }
  }
  for (const [field, quote] of Object.entries(raw.evidence)) {
    if (quote !== null && !appearsIn(quote, ctx.sourceText)) {
      reasons.push(`Evidence for ${field} is not a quote from the message`);
    }
  }

  // 2. Price (minor units) and currency.
  const priceCurrency = detectCurrency(raw.price);
  const price = parseRange(raw.price);
  let [minPrice, maxPrice] = [price.min, price.max];
  if (minPrice !== null && !price.explicitUnits && minPrice < 1000) {
    // Brokers often write "السعر 6.5" meaning 6.5 million.
    minPrice *= 1e6;
    maxPrice = maxPrice === null ? null : maxPrice < 1000 ? maxPrice * 1e6 : maxPrice;
    reasons.push('Price had no "million"/"thousand"; read as millions');
  }
  if (priceCurrency === 'USD') reasons.push('Priced in USD');

  // 3. Areas.
  const area = parseRange(raw.area, { money: false });
  const minArea = plausibleArea(area.min);
  const maxArea = plausibleArea(area.max);
  const single = (text: string | null) => plausibleArea(parseRange(text, { money: false }).min);

  // 4. Delivery, installments, floor, rooms.
  const delivery = parseDelivery(raw.delivery, ctx.sentAt);
  if (delivery.ambiguous) reasons.push('More than one delivery year mentioned');
  const installments = parseInstallments(raw.installments);

  // 5. Down payment: percent for the template, amount kept when stated.
  const down = parsePercentOrAmount(raw.down_payment);
  let downPayment = down.percent;
  const downPaymentAmount = toMinor(down.amount);
  if (downPayment === null && down.amount !== null && minPrice) {
    downPayment = round1((down.amount / minPrice) * 100);
  }
  if (downPayment !== null && (downPayment < 0 || downPayment > 100)) {
    reasons.push(`Down payment ${downPayment}% is out of range`);
    downPayment = null;
  }

  // 6. Maintenance and cash discount: percent or amount.
  const maintenanceParsed = parsePercentOrAmount(raw.maintenance);
  const maintenance = maintenanceParsed.percent ?? maintenanceParsed.amount;
  const maintenanceCurrency =
    maintenance === null
      ? null
      : maintenanceParsed.percent !== null
        ? '%'
        : detectCurrency(raw.maintenance);
  const discount = parsePercentOrAmount(raw.cash_discount);
  const cashDiscount = discount.percent ?? discount.amount;

  // 7. Entities. A matched project also tells us its developer and city.
  const project = ctx.project;
  let developerId = ctx.developer?.id ?? project?.developerId ?? null;
  let cityId = ctx.city?.id ?? project?.cityId ?? null;
  if (project && ctx.developer && ctx.developer.id !== project.developerId) {
    reasons.push(
      `Developer "${ctx.developer.name}" does not build "${project.name}"; used the project's developer`,
    );
    developerId = project.developerId;
  }
  if (project && ctx.city && ctx.city.id !== project.cityId) {
    reasons.push(`Project "${project.name}" is not in "${ctx.city.name}"; used the project's city`);
    cityId = project.cityId;
  }
  const unmatched: Record<string, string> = {};
  for (const [field, match] of [
    ['developer', ctx.developer],
    ['project', ctx.project],
    ['city', ctx.city],
  ] as const) {
    const value = raw[field];
    if (value && !match) {
      unmatched[field] = value;
      reasons.push(`${field} "${value}" is not in the known list`);
    } else if (match && match.similarity < 1) {
      reasons.push(
        `${field} "${value ?? ''}" matched "${match.name}" by similarity (${match.similarity.toFixed(2)})`,
      );
    }
  }

  // 8. Sanity check on price per square metre (EGP).
  if (minPrice !== null && minArea !== null && priceCurrency === 'EGP') {
    const perMetre = minPrice / minArea;
    if (perMetre < 3_000 || perMetre > 1_000_000) {
      reasons.push(`Price per m² (${Math.round(perMetre)} EGP) looks wrong`);
    }
  }
  if (minPrice === null) reasons.push('No price');
  if (minArea === null && raw.unit_type !== 'Studio') reasons.push('No area');
  if (raw.unit_type === null) reasons.push('No unit type');

  // 9. Confidence: how much of what matters was found, and how surely.
  const score =
    0.25 * (project?.similarity ?? 0) +
    0.15 * Math.max(ctx.developer?.similarity ?? 0, project ? 1 : 0, cityId !== null ? 0.6 : 0) +
    0.15 * (raw.unit_type ? 1 : 0) +
    0.25 * (minPrice !== null ? (price.explicitUnits ? 1 : 0.6) : 0) +
    0.2 * (minArea !== null ? 1 : 0);
  const confidence = Math.round(score * 100) / 100;

  return {
    category:
      raw.category ?? (raw.unit_type ? (CATEGORY_BY_TYPE[raw.unit_type] ?? 'Residential') : null),
    developerId,
    projectId: project?.id ?? null,
    cityId,
    unitType: raw.unit_type,
    unitCode: raw.unit_code?.trim() || null,
    floor: parseFloor(raw.floor),
    finishingSpecs: raw.finishing,
    minArea,
    maxArea: maxArea ?? (area.startingFrom ? null : minArea),
    landArea: single(raw.land_area),
    gardenArea: single(raw.garden_area),
    outdoorArea: single(raw.outdoor_area),
    minPrice: toMinor(minPrice),
    maxPrice: toMinor(maxPrice),
    deliveryYear: delivery.year,
    maintenance,
    maintenanceCurrency,
    cashDiscount,
    cashDiscountCurrency: discount.amount !== null ? detectCurrency(raw.cash_discount) : null,
    cashDiscountType:
      discount.percent !== null ? 'Percentage' : discount.amount !== null ? 'Fixed amount' : null,
    downPayment,
    installmentsCount: installments.count,
    bedrooms: parseCount(raw.bedrooms),
    bathrooms: parseCount(raw.bathrooms),
    notes: raw.notes?.trim().slice(0, 300) || null,
    priceCurrency,
    downPaymentAmount,
    installmentYears: installments.years,
    installmentFrequency: installments.frequency,
    readyToMove: delivery.readyToMove,
    confidence,
    needsReview: reasons.length > 0 || confidence < 0.7,
    reviewReasons: reasons,
    extras: Object.keys(unmatched).length ? { unmatched } : {},
  };
}
