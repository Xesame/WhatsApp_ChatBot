import ExcelJS from 'exceljs';

/**
 * Turns an Excel price list into text: one line per row, cells separated by
 * " | ", like a transcribed table. No model needed: the numbers are exact.
 */
export async function readSpreadsheet(data: Buffer, maxRows = 500): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as unknown as ArrayBuffer);
  const parts: string[] = [];
  for (const sheet of workbook.worksheets) {
    const lines: string[] = [];
    sheet.eachRow((row, number) => {
      if (number > maxRows) return;
      const cells = (row.values as ExcelJS.CellValue[])
        .slice(1)
        .map((value) => cellText(value))
        .filter((text) => text !== '');
      if (cells.length > 0) lines.push(cells.join(' | '));
    });
    if (lines.length > 0) parts.push(`[Sheet ${sheet.name}]\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ('richText' in value)
    return value.richText
      .map((r) => r.text)
      .join('')
      .trim();
  if ('result' in value) return cellText(value.result);
  if ('text' in value) return value.text.trim();
  return '';
}
