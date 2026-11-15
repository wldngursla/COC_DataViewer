import ExcelJS from 'exceljs';
import type { ExportTable } from './tables';

export const MAX_DATA_ROWS = 1_048_575;
export async function buildWorkbook(tables: ExportTable[], progress: (message: string) => void = () => {}, maxRows = MAX_DATA_ROWS) {
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_DATA_ROWS) throw new Error('Invalid sheet row limit');
  const book = new ExcelJS.Workbook();
  const manifest: [string, string, number][] = [];
  for (const table of tables) {
    let part = 0; let count = 0;
    const sheet = () => {
      const ws = book.addWorksheet(part === 0 ? table.name : `${table.name}_${part + 1}`);
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.columns = table.headers.map((header) => ({ header, width: Math.min(46, Math.max(18, header.length + 2)) }));
      ws.getRow(1).font = { bold: true };
      return ws;
    };
    let ws = sheet();
    const finish = () => { ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: count + 1, column: table.headers.length } }; manifest.push([table.name, ws.name, count]); };
    for (const row of table.rows()) {
      if (count === maxRows) { finish(); part++; count = 0; ws = sheet(); }
      ws.addRow(row.map((v) => typeof v === 'number' && !Number.isFinite(v) ? String(v) : v));
      count++;
      if (count % 5000 === 0) { progress(`${ws.name}: ${count.toLocaleString()} rows`); await new Promise((resolve) => setTimeout(resolve, 0)); }
    }
    finish(); progress(`${table.name} 완료`);
  }
  const index = book.addWorksheet('Export_Index');
  index.addRow(['Source table', 'Worksheet', 'Data rows (excluding header)']);
  for (const row of manifest) index.addRow(row);
  index.views = [{ state: 'frozen', ySplit: 1 }];
  index.columns.forEach((c) => { c.width = 34; });
  index.autoFilter = `A1:C${manifest.length + 1}`;
  progress('XLSX 압축 중…');
  const buffer = await book.xlsx.writeBuffer();
  return new Uint8Array(buffer).buffer;
}
