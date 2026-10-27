import ExcelJS from 'exceljs';
import { TEMPLATE_HEADERS, toTemplateRow, type ExportContext } from './columns.ts';
import type { Unit } from './unit.ts';

/**
 * Writes units as an Excel workbook in the exact Primary Units template
 * layout: the 26 template headers in order, no internal columns.
 */
/** Sheet name used by the original template file. */
export const TEMPLATE_SHEET_NAME = 'Primary Units Template';

export async function writePrimaryUnitsWorkbook(
  units: Unit[],
  ctx: ExportContext,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(TEMPLATE_SHEET_NAME);
  sheet.addRow(TEMPLATE_HEADERS);
  sheet.getRow(1).font = { bold: true };
  for (const unit of units) sheet.addRow(toTemplateRow(unit, ctx));
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
