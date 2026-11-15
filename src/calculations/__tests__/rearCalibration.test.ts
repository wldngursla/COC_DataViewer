import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLog } from '../../parser/parseLog';
import { bootRecord, gpsRecord, wheelSpeedRecord, digitalRecord, canRecord, gyroRecord, buildLog } from '../../parser/__tests__/fixtures';
import { analyzeRearWheels, defaultRearSettings, huberScale, motorSpeed, nearestValue, validateRearSettings } from '../rearCalibration';
import { exportTables } from '../../export/tables';
import { buildWorkbook } from '../../export/workbook';
import ExcelJS from 'exceljs';

const boot = () => bootRecord({ timestamp: 0, bootTime: 0, featureFlags: 1 });
const wheel = (t: number, left: number, right = left) => wheelSpeedRecord({ timestamp: t, wheelSpeedKmh: [0, 0, left, right] });
const gps = (t: number, speed: number) => gpsRecord({ timestamp: t, latitudeRaw: 350000000, longitudeRaw: 1260000000, latDir: 'N', lonDir: 'E', speedRaw: Math.round(speed * 100), courseRaw: 0 });
const settings = () => ({ ...defaultRearSettings(), hampel: false, ema: false });

describe('rear wheel validation and calibration', () => {
  it('matches bounded nearest samples without extrapolation or interpolation', () => {
    const series = [{ t: 100, v: 10 }, { t: 300, v: 30 }];
    expect(nearestValue(series, 180, 100)).toBe(10);
    expect(nearestValue(series, 1000, 100)).toBeNull();
    expect(nearestValue([], 100, 100)).toBeNull();
  });
  it('uses units m, motor/wheel ratio, rpm and refuses missing hardware', () => {
    expect(motorSpeed(3000, 1.2, 6)).toBe(36);
    expect(motorSpeed(-3000, 1.2, 6)).toBe(36);
    expect(motorSpeed(3000, null, 6)).toBeNull();
    expect(motorSpeed(3000, 1.2, null)).toBeNull();
    // Period formula: 14 pulses, circumference pi*0.406 m, interval 1 ms.
    expect(Math.PI * 0.406 / (14 * 0.001) * 3.6).toBeCloseTo(327.982, 2);
  });
  it('Huber scale resists isolated gross errors', () => {
    const pairs: [number, number][] = Array.from({ length: 100 }, (_, i) => [20 + i, (20 + i) / 2]);
    pairs.push([1000, 20]);
    expect(huberScale(pairs)).toBeCloseTo(0.5, 2);
  });
  it('learns independent scales with chronological holdout and preserves raw data', () => {
    const records = [boot()];
    for (let i = 0; i < 301; i++) { const v = 10 + i * 0.15; records.push(gps(i * 200, v), wheel(i * 200, v * 2, v * 2.1)); }
    const p = parseLog(buildLog(records));
    if (p.digital.format !== 'wheel-speed-kmh') throw Error('fixture format');
    const snapshot = p.digital.wheelSpeedKmh.map((a) => Array.from(a));
    const a = analyzeRearWheels(p, { ...settings(), mode: 'auto' });
    expect(a.fits.every((f) => f.trusted)).toBe(true);
    expect(a.coefficients[0].a).toBeCloseTo(0.5, 5);
    expect(a.coefficients[1].a).toBeCloseTo(1 / 2.1, 5);
    expect(a.fits[0].corrected.rmse!).toBeLessThan(0.01);
    expect(a.fits[0].raw.rmse!).toBeGreaterThan(40);
    expect(a.fits[0].interval![1]).toBeLessThan(42000);
    expect(p.digital.wheelSpeedKmh.map((v) => Array.from(v))).toEqual(snapshot);
  });
  it('withholds automatic coefficients with absent GPS or insufficient variation', () => {
    const records = [boot()];
    for (let i = 0; i < 100; i++) records.push(gps(i * 200, 20), wheel(i * 200, 40));
    const a = analyzeRearWheels(parseLog(buildLog(records)), { ...settings(), mode: 'auto' });
    expect(a.coefficients[0]).toEqual({ a: 1, b: 0, applied: 'AUTO_WITHHELD' });
    expect(a.fits[0].lagTrusted).toBe(false);
    expect(analyzeRearWheels(parseLog(buildLog([boot(), wheel(0, 20)])), settings()).rows[0].gps).toBeNull();
  });
  it('estimates a known GPS delay only from changing training signals', () => {
    const records = [boot()];
    const speed = (t: number) => 30 + 10 * Math.sin(t * 0.8) + 2 * Math.sin(t * 2.3);
    for (let i = 0; i < 600; i++) records.push(gps(i * 100, speed(i / 10 - 0.6)), wheel(i * 100, 2 * speed(i / 10)));
    const a = analyzeRearWheels(parseLog(buildLog(records)), settings());
    expect(a.fits[0].lagTrusted).toBe(true);
    expect(a.fits[0].lagMs).toBe(600);
    const disabled = analyzeRearWheels(parseLog(buildLog(records)), { ...settings(), gpsEnabled: false, mode: 'auto' });
    expect(disabled.fits[0].lagMs).toBe(0);
    expect(disabled.coefficients[0].applied).toBe('AUTO_WITHHELD');
  });
  it('flags duplicate and regressing original timestamps even after sorting', () => {
    const a = analyzeRearWheels(parseLog(buildLog([boot(), wheel(200, 20), wheel(200, 21), wheel(100, 22)])), settings());
    expect(a.rows.find((r) => r.sourceIndex === 1)!.flags[0]).toContain('TIMESTAMP');
    expect(a.rows.find((r) => r.sourceIndex === 2)!.filtered[0]).toBeNull();
  });
  it('rejects GPS jumps and preserves missing references as null', () => {
    const p = parseLog(buildLog([boot(), gps(0, 20), gps(200, 200), gps(400, 20), wheel(200, 20)]));
    expect(analyzeRearWheels(p, settings()).rows[0].gps).toBeNull();
  });
  it('preserves actual left/right differences and manual intercepts independently', () => {
    const p = parseLog(buildLog([boot(), wheel(0, 30, 40), wheel(200, 31, 41)]));
    const a = analyzeRearWheels(p, { ...settings(), mode: 'manual', a: [0.5, 0.5], b: [1, 2] });
    expect(a.rows[0].corrected).toEqual([16, 22]);
    expect(a.rows[0].filtered).toEqual([16, 22]);
    expect(a.rows[0].expectedDelta).toBeNull();
  });
  it('cross-checks decoded motor RPM and only enables a confirmed yaw model', () => {
    const p = parseLog(buildLog([boot(), gps(100, 36), wheel(100, 30, 40),
      canRecord({ timestamp: 100, id: 0x180117ef, data: [0, 0, 0, 0, 0, 0, 0x48, 0x71] }),
      gyroRecord({ timestamp: 100, accel: [0, 0, 0], gyro: [0, 0, 655] }), wheel(2000, 30, 40)]));
    const a = analyzeRearWheels(p, { ...settings(), circumferenceM: 1.2, gearRatio: 6, trackM: 1.2, yawConfirmed: true });
    expect(a.rows[0].motor).toBe(36);
    expect(a.motorComparison.gps.rmse).toBe(0);
    expect(a.rows[0].expectedDelta).toBeCloseTo(10 * Math.PI / 180 * 1.2 * 3.6);
    expect(a.rows[0].filtered).toEqual([30, 40]);
    expect(a.rows[1].motor).toBeNull();
  });
  it('keeps stationary zero and marks excessive acceleration as missing', () => {
    const a = analyzeRearWheels(parseLog(buildLog([boot(), wheel(0, 0), wheel(10, 100), wheel(2000, 0)])), settings());
    expect(a.rows[0].filtered).toEqual([0, 0]);
    expect(a.rows[1].flags[0]).toContain('ACCELERATION_LIMIT');
    expect(a.rows[1].filtered[0]).toBeNull();
    expect(a.rows[2].filtered[0]).toBe(0);
  });
  it('flags continuous implausible data without fabricating replacement speeds', () => {
    const a = analyzeRearWheels(parseLog(buildLog([boot(), wheel(0, 30), wheel(200, 400), wheel(400, 400), wheel(2000, 35)])), settings());
    expect(a.rows.map((r) => r.filtered[0])).toEqual([30, null, null, 35]);
    expect(a.rows[1].raw[0]).toBe(400);
    expect(a.rows[1].flags[0]).toContain('SPEED_LIMIT');
  });
  it('restores a Hampel spike from valid neighbors without changing corrected', () => {
    const records = [boot(), ...[10, 10, 10, 100, 10, 10, 10].map((v, i) => wheel(i * 200, v))];
    const a = analyzeRearWheels(parseLog(buildLog(records)), { ...settings(), hampel: true, accelerationMs2: 1000 });
    expect(a.rows[3].corrected[0]).toBe(100);
    expect(a.rows[3].filtered[0]).toBe(10);
    expect(a.rows[3].flags[0]).toContain('HAMPEL_REPLACED');
  });
  it('EMA uses actual irregular dt and resets across a long gap', () => {
    const a = analyzeRearWheels(parseLog(buildLog([boot(), wheel(0, 10), wheel(100, 20), wheel(400, 30), wheel(2000, 50)])), { ...settings(), ema: true, accelerationMs2: 1000 });
    const second = 10 + (1 - Math.exp(-0.1 / 0.2)) * 10;
    expect(a.rows[1].filtered[0]).toBeCloseTo(second);
    expect(a.rows[2].filtered[0]).toBeCloseTo(second + (1 - Math.exp(-0.3 / 0.2)) * (30 - second));
    expect(a.rows[3].filtered[0]).toBe(50);
  });
  it('retains GPIO records without inventing km/h and rejects invalid settings', () => {
    const p = parseLog(buildLog([bootRecord({ timestamp: 0, bootTime: 0 }), digitalRecord({ timestamp: 10, din: [0, 1, 0, 1] })]));
    expect(analyzeRearWheels(p).rows[0].raw).toEqual([null, null]);
    expect(() => validateRearSettings({ ...settings(), window: 4 })).toThrow();
  });
  it('exports every original timestamp/value, independent stages, flags and settings', async () => {
    const p = parseLog(buildLog([boot(), wheel(100, 20, 30), wheel(300, 22, 32)]));
    const tables = exportTables({ fileName: 'test.log', fileSize: 72, result: p }, { ...settings(), mode: 'manual', a: [0.5, 0.5] });
    const digital = tables.find((t) => t.name === 'Digital')!;
    const rows = [...digital.rows()];
    expect(rows).toHaveLength(p.digital.count);
    expect(rows[0].length).toBe(digital.headers.length);
    expect(rows[0][0]).toBe(100);
    expect(rows[0][digital.headers.indexOf('RL stored (km/h)')]).toBe(20);
    expect(rows[0][digital.headers.indexOf('RL Corrected (km/h)')]).toBe(10);
    expect(rows[0][digital.headers.indexOf('RL Outlier flag')]).toBe(false);
    const analysis = tables.find((t) => t.name === 'WheelSpeed_Analysis')!;
    expect([...analysis.rows()].every((r) => r.length === analysis.headers.length)).toBe(true);
    expect([...tables.find((t) => t.name === 'Summary')!.rows()]).toContainEqual(['Rear calibration', 'RL applied a', 0.5]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildWorkbook(tables));
    const sheet = book.getWorksheet('Digital')!;
    expect(sheet.rowCount - 1).toBe(p.digital.count);
    expect(sheet.getCell(2, digital.headers.indexOf('RL Corrected (km/h)') + 1).value).toBe(10);
    expect(sheet.getCell(2, digital.headers.indexOf('RL Outlier flag') + 1).value).toBe(false);
    expect(book.getWorksheet('WheelSpeed_Analysis')!.rowCount - 1).toBe(p.digital.count);
  });
  it('evaluates the unchanged bundled run against independent GPS holdout', () => {
    const bytes = readFileSync('public/data/default-run.bin');
    const p = parseLog(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const a = analyzeRearWheels(p, { ...defaultRearSettings(), mode: 'auto' });
    expect(a.rows).toHaveLength(p.digital.count);
    const report = { source: 'public/data/default-run.bin', bytes: bytes.length, digitalCount: p.digital.count, gpsCount: p.gps.count, settings: a.settings, coefficients: a.coefficients, fits: a.fits, max: a.max, outliers: a.counts, validFiltered: [0, 1].map((w) => a.rows.filter((r) => r.filtered[w] !== null).length), near327: [0, 1].map((w) => a.rows.filter((r) => r.raw[w] !== null && r.raw[w]! >= 320 && r.raw[w]! <= 329).map((r) => ({ t: r.t, raw: r.raw[w] }))) };
    writeFileSync(join(tmpdir(), 'coc-rear-calibration-report.json'), JSON.stringify(report, null, 2));
    expect(a.coefficients.every((c, i) => c.applied !== 'GPS_HUBER' || a.fits[i].trusted)).toBe(true);
  });
});
