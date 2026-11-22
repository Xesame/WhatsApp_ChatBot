import ExcelJS from 'exceljs';
import { TEMPLATE_HEADERS, toTemplateRow, type ExportContext } from './columns.ts';
import type { PaymentPlan, Unit } from './unit.ts';

/**
 * Writes units as an Excel workbook in the exact Primary Units template
 * layout: the 26 template headers in order, no internal columns.
 */
/** Sheet name used by the original template file. */
export const TEMPLATE_SHEET_NAME = 'Primary Units Template';

/** Name of the optional second sheet (only present when a unit has plans). */
export const PLANS_SHEET_NAME = 'Payment plans';

export const PLANS_SHEET_HEADERS = [
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
] as const;

/** Minor units → whole pounds/dollars, like the prices on the first sheet. */
const whole = (minor: number | null) => (minor === null ? null : Math.round(minor / 100));

/**
 * `plans` is keyed by the unit's index in `units`. The first sheet is never
 * changed; the "Payment plans" sheet is added only when some unit has plans.
 * Its "Row" column is the unit's row number on the first sheet.
 */
export async function writePrimaryUnitsWorkbook(
  units: Unit[],
  ctx: ExportContext,
  plans?: Map<number, PaymentPlan[]>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(TEMPLATE_SHEET_NAME);
  sheet.addRow(TEMPLATE_HEADERS);
  sheet.getRow(1).font = { bold: true };
  for (const unit of units) sheet.addRow(toTemplateRow(unit, ctx));
  if (plans && [...plans.values()].some((list) => list.length > 0)) {
    const planSheet = workbook.addWorksheet(PLANS_SHEET_NAME);
    planSheet.addRow([...PLANS_SHEET_HEADERS]);
    planSheet.getRow(1).font = { bold: true };
    units.forEach((unit, index) => {
      for (const plan of plans.get(index) ?? []) {
        planSheet.addRow([
          index + 2,
          unit.unitCode,
          unit.projectId === null ? null : (ctx.projectName(unit.projectId) ?? null),
          unit.unitType,
          plan.label,
          plan.downPaymentPercent,
          whole(plan.downPaymentAmount),
          whole(plan.installmentAmount),
          plan.installmentFrequency,
          plan.installmentYears,
          whole(plan.planPrice),
          plan.cash ? 'Yes' : null,
          plan.notes,
          plan.currency,
        ]);
      }
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * The same rows as CSV: the template headers, UTF-8 with a byte-order mark
 * so Excel shows Arabic correctly, Windows line endings, cells quoted when
 * needed.
 */
export function writePrimaryUnitsCsv(units: Unit[], ctx: ExportContext): Buffer {
  const cell = (value: string | number | null) => {
    if (value === null) return '';
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [TEMPLATE_HEADERS, ...units.map((u) => toTemplateRow(u, ctx))].map((row) =>
    row.map(cell).join(','),
  );
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

/** Name of the first sheet of a workbook (used by tests). */
export async function readSheetName(file: Buffer | string): Promise<string | undefined> {
  const workbook = new ExcelJS.Workbook();
  if (typeof file === 'string') await workbook.xlsx.readFile(file);
  else await workbook.xlsx.load(file as unknown as ArrayBuffer);
  return workbook.worksheets[0]?.name;
}

/** Reads the header row of the first sheet of a workbook (used by tests). */
export async function readHeaderRow(file: Buffer | string): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  if (typeof file === 'string') await workbook.xlsx.readFile(file);
  else await workbook.xlsx.load(file as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const values = sheet.getRow(1).values as (ExcelJS.CellValue | undefined)[];
  // ExcelJS rows are 1-indexed: values[0] is always empty.
  return values
    .slice(1)
    .map((v) =>
      typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : JSON.stringify(v),
    );
}
