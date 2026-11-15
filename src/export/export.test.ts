/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { parseLog } from '../parser/parseLog';
import { bootRecord, gpsRecord, analogRecord, digitalRecord, gyroRecord, canRecord, eventRecord, buildLog } from '../parser/__tests__/fixtures';
import { LogType } from '../parser/types';
import { exportTables } from './tables';
import { buildWorkbook } from './workbook';

describe('Excel export', () => {
  it('round-trips all raw types with numeric precision, timestamps and blank missing values', async () => {
    const result = parseLog(buildLog([
      bootRecord({ timestamp: 0, bootTime: 0 }),
      gpsRecord({ timestamp: 1234, latitudeRaw: 372346587, longitudeRaw: 1270412345, latDir: 'N', lonDir: 'E', speedRaw: 4567, courseRaw: 9000 }),
      analogRecord({ timestamp: 1235, ain: [1, -32768, 0, 32767, 5, 6, 7, 8] }),
      digitalRecord({ timestamp: 1236, din: [0, 1, 0, 1] }),
      gyroRecord({ timestamp: 1237, accel: [4096, -2048, 0], temperature: 1234, gyro: [655, -655, 0] }),
      canRecord({ timestamp: 1238, id: 0x180117ef, data: [0x70, 3, 0, 0, 0, 0, 0, 0x7d] }),
      eventRecord({ timestamp: 1239, type: LogType.UserEvent, message: '=1+1' }),
    ]));
    const buffer = await buildWorkbook(exportTables({ fileName: 'test.log', fileSize: result.stats.fileSize, result }));
    const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer);
    const gps = book.getWorksheet('GPS')!;
    expect(gps.getCell('A2').value).toBe(1234);
    expect(gps.getCell('B2').value).toBeNull();
    expect(gps.getCell('C2').value).toBe(372346587);
    expect(gps.getCell('K2').value).toBeCloseTo(45.67, 12);
    expect(book.getWorksheet('Analog')!.getCell('D2').value).toBe(-32768);
    expect(book.getWorksheet('Motor')!.getCell('D2').value).toBe(0);
    expect(book.getWorksheet('Motor')!.getCell('G2').value).toBeNull();
    expect(book.getWorksheet('Events')!.getCell('E2').value).toBe('=1+1');
    for (const name of ['BOOT', 'GPS', 'IMU', 'Analog', 'Digital', 'CAN', 'Events']) expect(book.getWorksheet(name)!.rowCount).toBe(2);
    expect(gps.views[0].state).toBe('frozen'); expect(gps.autoFilter).toBeTruthy();
    expect(result.analog.ain[1][0]).toBe(-32768);
  });
  it('splits without losing a boundary row, repeats headers and records a manifest', async () => {
    const buffer = await buildWorkbook([{ name: 'Test', headers: ['Timestamp (ms)', 'Value'], rows: function* () { for (let i = 0; i < 5; i++) yield [i, i / 3]; } }], () => {}, 2);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer);
    expect(['Test', 'Test_2', 'Test_3'].map((n) => book.getWorksheet(n)!.rowCount)).toEqual([3, 3, 2]);
    expect(book.getWorksheet('Test_2')!.getCell('A2').value).toBe(2);
    expect(book.getWorksheet('Test_3')!.getCell('A2').value).toBe(4);
    expect(book.getWorksheet('Test_3')!.getCell('A1').value).toBe('Timestamp (ms)');
    expect(book.getWorksheet('Export_Index')!.getCell('C4').value).toBe(1);
  });
  it('exports every raw sample of the bundled real log', () => {
    const bytes = readFileSync('public/data/default-run.bin');
    const result = parseLog(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const tables = exportTables({ fileName: 'real.log', fileSize: bytes.length, result });
    for (const [name, count] of [['GPS', result.gps.count], ['IMU', result.gyro.count], ['Analog', result.analog.count], ['Digital', result.digital.count], ['CAN', result.can.count], ['Events', result.events.length]] as const) {
      let n = 0; for (const row of tables.find((t) => t.name === name)!.rows()) { expect(typeof row[0]).toBe('number'); n++; } expect(n).toBe(count);
    }
  });
});
