import type { Unit } from './unit.ts';

/**
 * The Primary Units template: each Excel header, the database column behind
 * it, and how a unit's value is written in the export. Order matters: this
 * is the column order of the template, and a test compares it with the
 * committed template file.
 */

export interface ExportContext {
  developerName: (id: number) => string | undefined;
  projectName: (id: number) => string | undefined;
  cityName: (id: number) => string | undefined;
  /**
   * EGP per 1 USD, set by the owner. EGP is the main currency: USD prices are
   * converted with this rate at export time (PROJECT.md, chapter 4).
   */
  usdToEgp: number | undefined;
}

export type CellValue = string | number | null;

export interface TemplateColumn {
  header: string;
  dbColumn: string;
  /** Plain-English extraction and normalization rule (shown in the generated docs). */
  rule: string;
  format: (unit: Unit, ctx: ExportContext) => CellValue;
}

export class MissingExchangeRateError extends Error {
  override name = 'MissingExchangeRateError';
  constructor() {
    super('A unit is priced in USD but no USD→EGP rate was given for the export');
  }
}

/** A price in minor units → whole EGP for the export (converting USD). */
function egp(minor: number | null, unit: Unit, ctx: ExportContext): number | null {
  if (minor === null) return null;
  const major = minor / 100;
  if (unit.priceCurrency === 'EGP') return Math.round(major);
  if (ctx.usdToEgp === undefined) throw new MissingExchangeRateError();
  return Math.round(major * ctx.usdToEgp);
}

/** Notes column: the unit's own note plus facts that have no column of their own. */
function exportNotes(unit: Unit, ctx: ExportContext): string | null {
  const parts: string[] = [];
  if (unit.notes) parts.push(unit.notes);
  if (unit.readyToMove) parts.push('Ready to move');
  if (unit.priceCurrency === 'USD' && (unit.minPrice !== null || unit.maxPrice !== null)) {
    parts.push(`Priced in USD, converted at ${String(ctx.usdToEgp)} EGP/USD`);
  }
  return parts.length ? parts.join('. ') : null;
}

const name = (lookup: (id: number) => string | undefined, id: number | null) =>
  id === null ? null : (lookup(id) ?? null);

export const TEMPLATE_COLUMNS: readonly TemplateColumn[] = [
  {
    header: 'Category',
    rule: 'Stated category, or inferred in code from the unit type (Office → Administrative, Retail → Commercial, Clinic → Medical, others → Residential).',
    dbColumn: 'category',
    format: (u) => u.category,
  },
  {
    header: 'Developer',
    rule: 'Matched to a canonical developer via aliases; filled from the project when only the project is named. Exported as the English name.',
    dbColumn: 'developer_id',
    format: (u, c) => name(c.developerName, u.developerId),
  },
  {
    header: 'Project',
    rule: 'Matched via aliases: exact, then contained ("ميفيدا التجمع" → Mivida), then fuzzy (typos, flagged for review). Exported as the English name.',
    dbColumn: 'project_id',
    format: (u, c) => name(c.projectName, u.projectId),
  },
  {
    header: 'City',
    rule: 'Matched via aliases; filled from the project when not stated. Exported as the English name.',
    dbColumn: 'city_id',
    format: (u, c) => name(c.cityName, u.cityId),
  },
  {
    header: 'Unit Type',
    rule: 'One of the 11 unit types, chosen by the model from the text.',
    dbColumn: 'unit_type',
    format: (u) => u.unitType,
  },
  {
    header: 'Unit Code',
    rule: 'Only when the message names one specific unit.',
    dbColumn: 'unit_code',
    format: (u) => u.unitCode,
  },
  {
    header: 'Floor',
    rule: 'Normalized to Ground, Roof, a number, or a range "1-5" ("الدور التالت" → 3).',
    dbColumn: 'floor',
    format: (u) => u.floor,
  },
  {
    header: 'Finishing Specs',
    rule: 'Core & Shell, Semi-finished, Fully finished or Furnished.',
    dbColumn: 'finishing_specs',
    format: (u) => u.finishingSpecs,
  },
  {
    header: 'Min Area',
    rule: 'Built-up area in m². A single size fills Min and Max; "starting from" fills Min only.',
    dbColumn: 'min_area',
    format: (u) => u.minArea,
  },
  {
    header: 'Max Area',
    rule: 'Upper end of an area range.',
    dbColumn: 'max_area',
    format: (u) => u.maxArea,
  },
  {
    header: 'Land Area',
    rule: 'Plot size in m² (villas, townhouses).',
    dbColumn: 'land_area',
    format: (u) => u.landArea,
  },
  {
    header: 'Garden Area',
    rule: 'Garden size in m².',
    dbColumn: 'garden_area',
    format: (u) => u.gardenArea,
  },
  {
    header: 'Outdoor Area',
    rule: 'Terrace or roof size in m².',
    dbColumn: 'outdoor_area',
    format: (u) => u.outdoorArea,
  },
  {
    header: 'Min Price',
    rule: 'Whole EGP. Parsed in code ("3.5 مليون" → 3,500,000). USD prices are converted with USD_EGP_RATE. "Starting from" fills Min only; a bare "6.5" is read as millions and flagged.',
    dbColumn: 'min_price',
    format: (u, c) => egp(u.minPrice, u, c),
  },
  {
    header: 'Max Price',
    rule: 'Upper end of a price range, whole EGP.',
    dbColumn: 'max_price',
    format: (u, c) => egp(u.maxPrice, u, c),
  },
  // Blank for ready-to-move units; "Ready to move" goes in Notes instead.
  {
    header: 'Delivery Year',
    rule: '"Q3 2027" → 2027; "in 3 years" → message year + 3. Blank for ready-to-move units.',
    dbColumn: 'delivery_year',
    format: (u) => u.deliveryYear,
  },
  {
    header: 'Maintenance',
    rule: 'As stated: a percent or an amount.',
    dbColumn: 'maintenance',
    format: (u) => u.maintenance,
  },
  {
    header: 'Maintenance Currency',
    rule: 'EGP, USD, or % when stated as a percent of the price.',
    dbColumn: 'maintenance_currency',
    format: (u) => u.maintenanceCurrency,
  },
  {
    header: 'Cash Discount',
    rule: 'As stated: a percent or an amount.',
    dbColumn: 'cash_discount',
    format: (u) => u.cashDiscount,
  },
  {
    header: 'Cash Discount Currency',
    rule: 'EGP or USD, for fixed amounts only.',
    dbColumn: 'cash_discount_currency',
    format: (u) => u.cashDiscountCurrency,
  },
  {
    header: 'Cash Discount Type',
    rule: 'Percentage or Fixed amount.',
    dbColumn: 'cash_discount_type',
    format: (u) => u.cashDiscountType,
  },
  {
    header: 'Down Payment',
    rule: 'Percent 0-100. When only an amount is stated, computed in code from the price (the amount is kept internally).',
    dbColumn: 'down_payment',
    format: (u) => u.downPayment,
  },
  {
    header: 'Installments Count',
    rule: 'Computed in code: years × payments per year ("8 years quarterly" → 32); "96 شهر" → 96.',
    dbColumn: 'installments_count',
    format: (u) => u.installmentsCount,
  },
  {
    header: 'Bedrooms',
    rule: 'Number of bedrooms ("3 غرف", "3BR", "غرفتين" → 2).',
    dbColumn: 'bedrooms',
    format: (u) => u.bedrooms,
  },
  {
    header: 'Bathrooms',
    rule: 'Number of bathrooms.',
    dbColumn: 'bathrooms',
    format: (u) => u.bathrooms,
  },
  {
    header: 'Notes',
    rule: 'Short English note from the model, plus "Ready to move" and the USD conversion rate when they apply.',
    dbColumn: 'notes',
    format: (u, c) => exportNotes(u, c),
  },
];

export const TEMPLATE_HEADERS = TEMPLATE_COLUMNS.map((c) => c.header);

/** One export row, in template order. */
export function toTemplateRow(unit: Unit, ctx: ExportContext): CellValue[] {
  return TEMPLATE_COLUMNS.map((column) => column.format(unit, ctx));
}
