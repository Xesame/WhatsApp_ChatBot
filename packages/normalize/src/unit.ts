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

/**
 * A weak match: the closest known name when nothing matched well enough to
 * trust. It is only ever shown to the reviewer as a hint ("closest: ...");
 * it never sets an id on the unit.
 */
export interface Suggestion {
  id: number;
  name: string;
  similarity: number;
}

/** The names as the broker wrote them on one unit, kept so reviews can teach the bot. */
export interface WrittenNames {
  developer: string[];
  project: string[];
  city: string[];
}

export interface NormalizeContext {
  /** The text the model read (message, quoted message), for the no-invention check. */
  sourceText: string;
  sentAt: Date;
  developer: EntityMatch | null;
  project: ProjectMatch | null;
  city: EntityMatch | null;
  /** Closest weak match per name, when no confident match was found. */
  suggestions: {
    developer: Suggestion | null;
    project: Suggestion | null;
    city: Suggestion | null;
  };
  /**
   * What approved units of the same project and type usually cost per m²
   * (EGP), when the bot has learned it. Looked up by the pipeline, since
   * this package never touches the database.
   */
  usualPricePerM2?: { median: number; projectName: string; unitType: string } | null;
}

/** A price per m² more than this many times above or below the usual one is flagged. */
export const PRICE_RANGE_FACTOR = 2.5;

const withCommas = (n: number) => Math.round(n).toLocaleString('en-US');

/** "Apartment" -> "apartments", "Duplex" -> "duplexes", "Penthouse" -> "penthouses". */
function plural(unitType: string): string {
  const t = unitType.toLowerCase();
  if (/[sx]$/.test(t) || /(ch|sh)$/.test(t)) return `${t}es`;
  if (/[^aeiou]y$/.test(t)) return `${t.slice(0, -1)}ies`;
  return `${t}s`;
}

/**
 * The review reason for a price per m² (EGP), or null when it looks fine.
 * With a learned usual price it flags anything more than 2.5x above or below
 * it; without one it uses the fixed 3,000 to 1,000,000 range. All the maths
 * is here in code (rule 4).
 */
export function priceReason(
  perMetre: number,
  usual: NormalizeContext['usualPricePerM2'],
): string | null {
  if (usual && usual.median > 0) {
    const off =
      perMetre > usual.median * PRICE_RANGE_FACTOR || perMetre < usual.median / PRICE_RANGE_FACTOR;
    return off
      ? `Price per m² ${withCommas(perMetre)} EGP is far from the usual ${withCommas(usual.median)} for ${usual.projectName} ${plural(usual.unitType)}`
      : null;
  }
  return perMetre < 3_000 || perMetre > 1_000_000
    ? `Price per m² (${Math.round(perMetre)} EGP) looks wrong`
    : null;
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

/** The review reason added when a price had no "million"/"thousand" and was read as millions. */
export const MILLIONS_ASSUMED_REASON = 'Price had no "million"/"thousand"; read as millions';

const toMinor = (major: number | null) => (major === null ? null : Math.round(major * 100));
const plausibleArea = (n: number | null) => (n !== null && n >= 10 && n <= 100_000 ? n : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Step 7: matches the written names against what the pipeline found. A
 * matched project also tells us its developer and city. A weak match is only
 * a suggestion: it adds "(closest: ...)" text for the reviewer and never
 * sets an id.
 */
export function entityOutcome(
  written: { developer: string | null; project: string | null; city: string | null },
  ctx: Pick<NormalizeContext, 'developer' | 'project' | 'city' | 'suggestions'>,
): {
  developerId: number | null;
  projectId: number | null;
  cityId: number | null;
  reasons: string[];
  unmatched: Record<string, string>;
  suggested: Record<string, Suggestion>;
} {
  const reasons: string[] = [];
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
  const suggested: Record<string, Suggestion> = {};
  for (const [field, match] of [
    ['developer', ctx.developer],
    ['project', ctx.project],
    ['city', ctx.city],
  ] as const) {
    const value = written[field];
    if (value && !match) {
      unmatched[field] = value;
      const close = ctx.suggestions[field];
      if (close) {
        suggested[field] = close;
        reasons.push(
          `${field} "${value}" is not in the known list (closest: ${close.name}, ${close.similarity.toFixed(2)})`,
        );
      } else {
        reasons.push(`${field} "${value}" is not in the known list`);
      }
    } else if (match && match.similarity < 1) {
      reasons.push(
        `${field} "${value ?? ''}" matched "${match.name}" by similarity (${match.similarity.toFixed(2)})`,
      );
    }
  }
  return { developerId, projectId: project?.id ?? null, cityId, reasons, unmatched, suggested };
}

const NAME_REASON_PATTERNS = [
  /^(developer|project|city) ".*" is not in the known list( \(closest: .*\))?$/,
  /^(developer|project|city) ".*" matched ".*" by similarity \(\d+(\.\d+)?\)$/,
  /^Developer ".*" does not build ".*"; used the project's developer$/,
  /^Project ".*" is not in ".*"; used the project's city$/,
];

/** True for the review reasons that are about names (the ones a name correction can clear). */
export function isNameReason(reason: string): boolean {
  return NAME_REASON_PATTERNS.some((pattern) => pattern.test(reason));
}

/**
 * Step 9: confidence is how much of what matters was found, and how surely.
 * Plain arithmetic in code, never the model (rule 4).
 */
export function scoreConfidence(parts: {
  projectSimilarity: number;
  developerPart: number;
  hasUnitType: boolean;
  priceFactor: number;
  hasArea: boolean;
}): number {
  const score =
    0.25 * parts.projectSimilarity +
    0.15 * parts.developerPart +
    0.15 * (parts.hasUnitType ? 1 : 0) +
    0.25 * parts.priceFactor +
    0.2 * (parts.hasArea ? 1 : 0);
  return Math.round(score * 100) / 100;
}

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
    reasons.push(MILLIONS_ASSUMED_REASON);
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

  // 7. Entities (see entityOutcome).
  const entities = entityOutcome(raw, ctx);
  reasons.push(...entities.reasons);
  const { developerId, cityId, unmatched, suggested } = entities;
  const project = ctx.project;
  // Names as written on this unit (after the no-invention check), for learning from reviews.
  const written: WrittenNames = {
    developer: raw.developer ? [raw.developer] : [],
    project: raw.project ? [raw.project] : [],
    city: raw.city ? [raw.city] : [],
  };

  // 8. Sanity check on price per square metre (EGP).
  if (minPrice !== null && minArea !== null && priceCurrency === 'EGP') {
    const perMetre = minPrice / minArea;
    const reason = priceReason(perMetre, ctx.usualPricePerM2);
    if (reason) reasons.push(reason);
  }
  if (minPrice === null) reasons.push('No price');
  if (minArea === null && raw.unit_type !== 'Studio') reasons.push('No area');
  if (raw.unit_type === null) reasons.push('No unit type');

  // 9. Confidence: how much of what matters was found, and how surely.
  // A price without "million"/"thousand" counts for less, even when no reason
  // was recorded for it (a plain "6500000"). The factor is kept in extras so
  // a later re-check of the names scores the price exactly the same way.
  const priceFactor = minPrice !== null ? (price.explicitUnits ? 1 : 0.6) : 0;
  const confidence = scoreConfidence({
    projectSimilarity: project?.similarity ?? 0,
    developerPart: Math.max(
      ctx.developer?.similarity ?? 0,
      project ? 1 : 0,
      cityId !== null ? 0.6 : 0,
    ),
    hasUnitType: raw.unit_type !== null,
    priceFactor,
    hasArea: minArea !== null,
  });

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
    extras: {
      written,
      priceFactor,
      ...(Object.keys(unmatched).length ? { unmatched } : {}),
      ...(Object.keys(suggested).length ? { suggested } : {}),
    },
  };
}
