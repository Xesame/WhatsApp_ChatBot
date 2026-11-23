import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  readHeaderRow,
  readSheetName,
  TEMPLATE_SHEET_NAME,
  writePrimaryUnitsCsv,
  writePrimaryUnitsWorkbook,
} from '../src/export.ts';
import {
  extractionResultSchema,
  jsonSchemaFor,
  lookupResultSchema,
  MissingExchangeRateError,
  rawPaymentPlanSchema,
  TEMPLATE_HEADERS,
  toTemplateRow,
  type ExportContext,
  type PaymentPlan,
  type Unit,
} from '../src/index.ts';

// The 26 headers listed in the build plan (section 5), in order.
const PLAN_HEADERS = [
  'Category',
  'Developer',
  'Project',
  'City',
  'Unit Type',
  'Unit Code',
  'Floor',
  'Finishing Specs',
  'Min Area',
  'Max Area',
  'Land Area',
  'Garden Area',
  'Outdoor Area',
  'Min Price',
  'Max Price',
  'Delivery Year',
  'Maintenance',
  'Maintenance Currency',
  'Cash Discount',
  'Cash Discount Currency',
  'Cash Discount Type',
  'Down Payment',
  'Installments Count',
  'Bedrooms',
  'Bathrooms',
  'Notes',
];

const TEMPLATE_FILE = fileURLToPath(
  new URL('../template/primary-units-template.xlsx', import.meta.url),
);

export const sampleUnit = (overrides: Partial<Unit> = {}): Unit => ({
  category: 'Residential',
  developerId: 1,
  projectId: 2,
  cityId: 3,
  unitType: 'Apartment',
  unitCode: null,
  floor: null,
  building: null,
  finishingSpecs: 'Semi-finished',
  minArea: 120,
  maxArea: 180,
  landArea: null,
  gardenArea: null,
  outdoorArea: null,
  minPrice: 650_000_000,
  maxPrice: 900_000_000,
  deliveryYear: 2028,
  maintenance: 8,
  maintenanceCurrency: '%',
  cashDiscount: null,
  cashDiscountCurrency: null,
  cashDiscountType: null,
  downPayment: 10,
  installmentsCount: 32,
  bedrooms: 3,
  bathrooms: 2,
  notes: 'Club access',
  priceCurrency: 'EGP',
  downPaymentAmount: null,
  installmentYears: 8,
  installmentFrequency: 'quarterly',
  paymentPlans: [],
  readyToMove: false,
  confidence: 0.9,
  needsReview: false,
  reviewReasons: [],
  extras: {},
  ...overrides,
});

const ctx: ExportContext = {
  developerName: (id) => ({ 1: 'Emaar Misr' })[id],
  projectName: (id) => ({ 2: 'Mivida' })[id],
  cityName: (id) => ({ 3: 'New Cairo' })[id],
  usdToEgp: 50,
};

describe('template columns', () => {
  it('has exactly the 26 template headers from the plan, in order', () => {
    expect(TEMPLATE_HEADERS).toEqual(PLAN_HEADERS);
  });

  it.skipIf(!existsSync(TEMPLATE_FILE))('matches the committed template file', async () => {
    expect(await readHeaderRow(TEMPLATE_FILE)).toEqual(TEMPLATE_HEADERS);
    expect(await readSheetName(TEMPLATE_FILE)).toBe(TEMPLATE_SHEET_NAME);
  });

  it.skipIf(!existsSync(TEMPLATE_FILE))(
    'exports with the same headers and sheet name as the template file',
    async () => {
      const file = await writePrimaryUnitsWorkbook([sampleUnit()], ctx);
      expect(await readHeaderRow(file)).toEqual(await readHeaderRow(TEMPLATE_FILE));
      expect(await readSheetName(file)).toBe(await readSheetName(TEMPLATE_FILE));
    },
  );

  it('writes a template row with entity names and EGP prices', () => {
    expect(toTemplateRow(sampleUnit(), ctx)).toEqual([
      'Residential',
      'Emaar Misr',
      'Mivida',
      'New Cairo',
      'Apartment',
      null,
      null,
      'Semi-finished',
      120,
      180,
      null,
      null,
      null,
      6_500_000,
      9_000_000,
      2028,
      8,
      '%',
      null,
      null,
      null,
      10,
      32,
      3,
      2,
      'Club access',
    ]);
  });

  it('converts USD prices to EGP with the owner-set rate and says so in Notes', () => {
    const row = toTemplateRow(
      sampleUnit({ priceCurrency: 'USD', minPrice: 20_000_000, maxPrice: 20_000_000, notes: null }),
      ctx,
    );
    expect(row[13]).toBe(10_000_000); // USD 200,000 × 50
    expect(row[25]).toBe('Priced in USD, converted at 50 EGP/USD');
  });

  it('refuses to export USD prices without a rate', () => {
    expect(() =>
      toTemplateRow(sampleUnit({ priceCurrency: 'USD' }), { ...ctx, usdToEgp: undefined }),
    ).toThrow(MissingExchangeRateError);
  });

  it('leaves Delivery Year blank for ready-to-move units and notes it', () => {
    const row = toTemplateRow(
      sampleUnit({ readyToMove: true, deliveryYear: null, notes: null }),
      ctx,
    );
    expect(row[15]).toBeNull();
    expect(row[25]).toBe('Ready to move');
  });
});

describe('Excel export', () => {
  it('writes the template headers and one row per unit, with no internal columns', async () => {
    const file = await writePrimaryUnitsWorkbook(
      [sampleUnit(), sampleUnit({ unitType: 'Villa' })],
      ctx,
    );
    expect(await readHeaderRow(file)).toEqual(PLAN_HEADERS);
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(sheet?.rowCount).toBe(3);
    expect(sheet?.columnCount).toBe(26);
    expect(sheet?.getRow(3).getCell(5).value).toBe('Villa');
  });
});

describe('Payment plans sheet', () => {
  const plan = (position: number, over: Partial<PaymentPlan> = {}): PaymentPlan => ({
    position,
    label: `Plan ${String(position + 1)}`,
    downPaymentPercent: 10,
    downPaymentAmount: 500_000_00,
    installmentAmount: 100_000_00,
    installmentFrequency: 'monthly',
    installmentsCount: null,
    installmentYears: 8,
    planPrice: null,
    cash: false,
    notes: null,
    currency: 'EGP',
    ...over,
  });
  const load = async (file: Buffer) => {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file as unknown as ArrayBuffer);
    return workbook;
  };

  it('adds a Payment plans sheet', async () => {
    const units = [sampleUnit(), sampleUnit({ unitType: 'Villa' })];
    const plans = new Map([[1, [plan(0), plan(1, { cash: true, planPrice: 9_000_000_00 })]]]);
    const workbook = await load(await writePrimaryUnitsWorkbook(units, ctx, plans));
    expect(workbook.worksheets.map((s) => s.name)).toEqual([TEMPLATE_SHEET_NAME, 'Payment plans']);
    const sheet = workbook.worksheets[1];
    expect((sheet?.getRow(1).values as unknown[]).slice(1)).toEqual([
      'Row',
      'Unit code',
      'Project',
      'Unit type',
      'Plan',
      'Down payment %',
      'Down payment amount',
      'Installment',
      'How often',
      'Years',
      'Plan price',
      'Cash',
      'Notes',
      'Currency',
    ]);
    expect(sheet?.rowCount).toBe(3);
    expect(sheet?.getRow(2).getCell(1).value).toBe(3);
    expect(sheet?.getRow(2).getCell(4).value).toBe('Villa');
    expect(sheet?.getRow(2).getCell(7).value).toBe(500_000);
    expect(sheet?.getRow(3).getCell(11).value).toBe(9_000_000);
    expect(sheet?.getRow(3).getCell(12).value).toBe('Yes');
  });

  it('adds no second sheet without plans', async () => {
    const a = await load(await writePrimaryUnitsWorkbook([sampleUnit()], ctx));
    const b = await load(await writePrimaryUnitsWorkbook([sampleUnit()], ctx, new Map([[0, []]])));
    expect(a.worksheets).toHaveLength(1);
    expect(b.worksheets).toHaveLength(1);
  });
});

describe('CSV export', () => {
  it('has the template headers, a BOM for Excel, Arabic intact and quoted cells', () => {
    const csv = writePrimaryUnitsCsv(
      [{ ...sampleUnit(), notes: 'view on the lake, "club" access, قريب من الخدمات' }],
      ctx,
    ).toString('utf8');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const [header, row] = csv.slice(1).split('\r\n');
    expect(header?.split(',')).toEqual(TEMPLATE_HEADERS);
    expect(row).toContain('"view on the lake, ""club"" access, قريب من الخدمات"');
  });
});

describe('LLM JSON schema', () => {
  const schema = jsonSchemaFor(extractionResultSchema);

  const objects = (
    node: unknown,
    found: Record<string, unknown>[] = [],
  ): Record<string, unknown>[] => {
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (record.type === 'object') found.push(record);
      for (const value of Object.values(record)) objects(value, found);
    }
    return found;
  };

  it('forbids extra properties and requires every field at every level (strict mode)', () => {
    const all = objects(schema);
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const object of all) {
      expect(object.additionalProperties).toBe(false);
      expect(Object.keys(object.properties as object).sort()).toEqual(
        [...(object.required as string[])].sort(),
      );
    }
  });

  it('describes the fields for the model', () => {
    expect(JSON.stringify(schema)).toContain('Price phrase as written');
  });

  it('asks for payment plans as a required list of plan phrases', () => {
    const text = JSON.stringify(schema);
    expect(text).toContain('payment_plans');
    expect(text).toContain('Quarterly: 104,612 L.E');
    expect(Object.keys(rawPaymentPlanSchema.shape).sort()).toEqual([
      'cash_discount',
      'down_payment',
      'installment_amount',
      'installments',
      'label',
      'notes',
      'plan_price',
    ]);
  });
});

describe('name lookup answer', () => {
  it('accepts a lookup answer', () => {
    const answer = { known: true, developer: 'Dubai Misr', city: 'Mostakbal City' };
    expect(lookupResultSchema.safeParse(answer).success).toBe(true);
    expect(
      lookupResultSchema.safeParse({ known: false, developer: null, city: null }).success,
    ).toBe(true);
    expect(lookupResultSchema.safeParse({ ...answer, extra: 1 }).success).toBe(false);
  });
});
