/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { bootRecord, gpsRecord, gyroRecord, eventRecord, buildLog } from '../../parser/__tests__/fixtures';
import { parseLog } from '../../parser/parseLog';
import { LogType } from '../../parser/types';
import { rawToG, rawToDps } from '../../decoder/imu';
import { analyzeImu, defaultImuSettings, gpsImuReference, courseDifference, filterImuVectors, validateImuSettings, type ImuSettings } from '../imuCalibration';
import { eulerRotation, mappedRotation, properRotation, determinant, transform, propagateUp, norm, type Vec3, type Mat3 } from '../imuMath';
import { filteredGForceMode, imuGForce, selectImuGForce } from '../imuGForce';
import { defaultRearSettings } from '../rearCalibration';
import { exportTables } from '../../export/tables';
import { buildWorkbook } from '../../export/workbook';

const boot = () => bootRecord({ timestamp: 0, bootTime: 0 });
const gps = (t: number, speed = 0, course = 0) => gpsRecord({ timestamp: t, speedRaw: Math.round(speed * 100), courseRaw: Math.round(((course % 360 + 360) % 360) * 100) % 36000, latitudeRaw: 350000000, longitudeRaw: 1260000000, latDir: 'N', lonDir: 'E' });
const record = (t: number, a: Vec3 = [0, 0, 1], w: Vec3 = [1, -0.5, 0.2]) => gyroRecord({ timestamp: t, accel: a.map((v) => Math.round(v * 4096)) as Vec3, gyro: w.map((v) => Math.round(v * 65.5)) as Vec3 });
const manual = (): ImuSettings => ({ ...defaultImuSettings(), mounting: 'mapping', hampel: false, lowpass: false });
function stationaryLog(options: { tilt?: boolean; gpsMissing?: boolean; lengthMs?: number } = {}) {
  const records = [boot()];
  for (let t = 0; t <= (options.lengthMs ?? 5000); t += 10) {
    records.push(record(t, options.tilt ? [Math.sin(0.7), 0, Math.cos(0.7)] : [0, 0, 1]));
    if (t % 100 === 0 && !options.gpsMissing) records.push(gps(t));
  }
  return parseLog(buildLog(records));
}
describe('IMU calibration physics and processing', () => {
  it('decodes signed two-complement LE raw records with configured scales', () => {
    const p = parseLog(buildLog([boot(), gyroRecord({ timestamp: 0, accel: [-4096, 4096, -32768], gyro: [-655, 655, -32768] })]));
    expect(p.gyro.accelZ[0]).toBe(-32768);
    expect(rawToG(p.gyro.accelX[0])).toBe(-1);
    expect(rawToDps(p.gyro.gyroX[0])).toBe(-10);
  });
  it('only accepts orthogonal right-handed rotations and explicit Euler convention', () => {
    expect(properRotation(eulerRotation([23, -40, 75]))).toBe(true);
    expect(determinant(eulerRotation([23, -40, 75]))).toBeCloseTo(1);
    expect(transform(eulerRotation([0, 0, 90]), [1, 0, 0])[1]).toBeCloseTo(1);
    expect(properRotation(mappedRotation([1, -2, 3]))).toBe(false);
    expect(() => validateImuSettings({ ...manual(), axes: [1, -2, 3] })).toThrow();
    expect(() => validateImuSettings({ ...manual(), window: 4 })).toThrow();
  });
  it('finds a continuous stop, subtracts residual gyro bias and preserves +1g specific force', () => {
    const p = stationaryLog(); const before = Array.from(p.gyro.accelZ);
    const a = analyzeImu(p, manual());
    expect(a.stationary?.count).toBeGreaterThanOrEqual(300);
    expect(a.stationary?.bias[0]).toBeCloseTo(1, 1);
    const row = a.rows[100];
    expect(norm(row.gyro!)).toBeLessThan(1e-10);
    expect(row.accel![2]).toBe(1);
    expect(norm(row.filteredLinear!)).toBeLessThan(1e-10);
    expect(p.gyro.accelZ).toEqual(new Int16Array(before));
  });
  it('estimates tilt from many samples but withholds unobservable forward heading', () => {
    const a = analyzeImu(stationaryLog({ tilt: true }));
    expect(a.stationary?.gravity[0]).toBeCloseTo(Math.sin(0.7), 3);
    expect(a.rotation).toBeNull();
    expect(a.rows.every((r) => r.filteredLinear === null)).toBe(true);
    expect(imuGForce(a, 'filtered').samples).toHaveLength(0);
    expect(imuGForce(a, 'raw').samples.length).toBeGreaterThan(0);
    expect(filteredGForceMode(a)).toBe('sensorAdjusted');
    const preview = imuGForce(a, filteredGForceMode(a));
    expect(preview.samples.length).toBeGreaterThan(0);
    expect(preview.maxG).toBeLessThan(0.001);
    expect(imuGForce(a, 'raw').maxG).toBeGreaterThan(0.6);
    expect(selectImuGForce(a, 'sensorAdjusted', 1000)?.magnitude).toBeLessThan(0.001);
  });
  it('does not infer a stop from IMU constancy without GPS; accepts explicitly confirmed manual interval', () => {
    const p = stationaryLog({ gpsMissing: true });
    expect(analyzeImu(p, manual()).stationary).toBeNull();
    const unknown = analyzeImu(p);
    expect(filteredGForceMode(unknown)).toBe('sensorFiltered');
    expect(selectImuGForce(unknown, 'sensorFiltered', 1000)).not.toBeNull();
    const s = { ...manual(), autoStationary: false, stationaryStartMs: 0, stationaryEndMs: 3000, stationaryConfirmed: true };
    expect(analyzeImu(p, s).stationary?.source).toBe('MANUAL_CONFIRMED_STABLE');
    expect(analyzeImu(p, { ...s, stationaryConfirmed: false }).stationary).toBeNull();
  });
  it('unwraps north crossings and gives left-positive/right-negative GPS yaw and lateral acceleration', () => {
    expect(courseDifference(359, 1)).toBe(2);
    expect(courseDifference(1, 359)).toBe(-2);
    const records = [boot()];
    for (let t = 0; t <= 5000; t += 100) records.push(gps(t, 36, 2 - t / 1000 * 10));
    const reference = gpsImuReference(parseLog(buildLog(records)), manual());
    expect(reference[25].yaw).toBeCloseTo(10, 2);
    expect(reference[25].lateral).toBeCloseTo(10 * 10 * Math.PI / 180 / 9.80665, 3);
    const right = [boot()];
    for (let t = 0; t <= 5000; t += 100) right.push(gps(t, 36, 358 + t / 1000 * 10));
    expect(gpsImuReference(parseLog(buildLog(right)), manual())[25].yaw).toBeCloseTo(-10, 2);
    expect(gpsImuReference(parseLog(buildLog([boot(), gps(0), gps(100), gps(200), gps(300), gps(400)])), manual()).every((r) => r.yaw === null)).toBe(true);
  });
  it('rejects GPS missing gaps and implausible course jumps without bridging', () => {
    const records = [boot()];
    for (let t = 0; t < 1000; t += 100) records.push(gps(t, 30, t === 500 ? 180 : 0));
    records.push(gps(5000, 30));
    const rows = gpsImuReference(parseLog(buildLog(records)), manual());
    expect(rows[5].yaw).toBeNull(); expect(rows.at(-1)!.yaw).toBeNull();
  });
  it('uses gyro kinematics to propagate a fixed world-up vector in body coordinates', () => {
    const up = propagateUp([0, 0, 1], [0, 90, 0], 1);
    expect(up[0]).toBeCloseTo(-1); expect(up[2]).toBeCloseTo(0); expect(norm(up)).toBeCloseTo(1);
  });
  it('restores isolated spikes, preserves sustained maneuvers and resets EMA after gaps', () => {
    const s = { ...manual(), hampel: true, lowpass: false };
    const input = [0, 0, 0, 2, 0, 0, 0].map((v, i) => ({ t: i * 10, epoch: 0, value: [v, 0, 1] as Vec3 }));
    const result = filterImuVectors(input, s);
    expect(result.spike[3]).toBe(true); expect(result.filtered[3]![0]).toBe(0);
    const sustained = [0, 0, 0, 1, 1, 1, 1, 1, 0, 0].map((v, i) => ({ t: i * 10, epoch: 0, value: [v, 0, 1] as Vec3 }));
    expect(filterImuVectors(sustained, s).filtered[5]![0]).toBe(1);
    const ema = filterImuVectors([{ t: 0, epoch: 0, value: [0, 0, 1] }, { t: 100, epoch: 0, value: [1, 0, 1] }, { t: 2000, epoch: 0, value: [2, 0, 1] }], { ...s, hampel: false, lowpass: true, tau: 0.2 });
    expect(ema.filtered[1]![0]).toBeCloseTo(1 - Math.exp(-0.5)); expect(ema.filtered[2]![0]).toBe(2);
  });
  it('flags saturation, duplicate timestamps, sensor reconnects and withholds stale gravity', () => {
    const records = [boot()];
    for (let t = 0; t <= 5000; t += 10) { records.push(record(t)); if (t % 100 === 0) records.push(gps(t)); }
    records.push(record(5000), record(5010, [7.99, 0, 1]), eventRecord({ timestamp: 5100, type: LogType.System, message: 'SNS:GYR:ERR' }), eventRecord({ timestamp: 6000, type: LogType.System, message: 'SNS:GYR:OK' }), record(6000));
    const a = analyzeImu(parseLog(buildLog(records)), manual());
    expect(a.rows.some((r) => r.flags.includes('TIMESTAMP'))).toBe(true);
    expect(a.rows.some((r) => r.flags.includes('RANGE_OR_SATURATION'))).toBe(true);
    expect(a.rows.at(-1)!.gyro).toBeNull(); expect(a.rows.at(-1)!.linear).toBeNull();
  });
  it('does not reuse a previously valid G-force sample at an invalid recorded timestamp', () => {
    const records = [boot()];
    for (let t = 0; t <= 4000; t += 10) { records.push(record(t, t === 4000 ? [7.99, 0, 1] : [0, 0, 1])); if (t % 100 === 0) records.push(gps(t)); }
    const a = analyzeImu(parseLog(buildLog(records)), manual());
    expect(selectImuGForce(a, 'filtered', 3990)).not.toBeNull();
    expect(selectImuGForce(a, 'filtered', 4000)).toBeNull();
    expect(selectImuGForce(a, 'raw', 4000)).toBeNull();
    expect(selectImuGForce(a, 'filtered', 10000)).toBeNull();
  });
  it('recalibrates after reconnect, using a new stable stop rather than the old bias', () => {
    const records = [boot()];
    for (let t = 0; t <= 4000; t += 10) { records.push(record(t)); if (t % 100 === 0) records.push(gps(t)); }
    records.push(eventRecord({ timestamp: 4100, type: LogType.System, message: 'SNS:GYR:ERR' }), eventRecord({ timestamp: 5000, type: LogType.System, message: 'SNS:GYR:OK' }));
    for (let t = 5000; t <= 9000; t += 10) { records.push(record(t, [0, 0, 1], [2, 0, 0])); if (t % 100 === 0) records.push(gps(t)); }
    const a = analyzeImu(parseLog(buildLog(records)), manual());
    expect(a.calibrations).toHaveLength(2);
    expect(a.calibrations[1].bias[0]).toBeCloseTo(2);
    expect(norm(a.rows.at(-1)!.gyro!)).toBeLessThan(1e-10);
  });
  it('does not extrapolate attitude after uncorrected propagation exceeds its limit', () => {
    const records = [boot()];
    for (let t = 0; t <= 9000; t += 10) { records.push(record(t)); if (t % 100 === 0) records.push(gps(t, t > 4000 ? 20 : 0)); }
    const a = analyzeImu(parseLog(buildLog(records)), { ...manual(), maxPropagationSeconds: 1 });
    expect(a.rows[600].filteredLinear).toBeNull();
    expect(a.rows[600].flags).toContain('GRAVITY_UNTRUSTED');
  });
  it('keeps consecutive Hampel spikes missing and uses exact irregular dt', () => {
    const s = { ...manual(), hampel: true };
    const input = [0, 0, 0, 2, 2, 0, 0, 0].map((v, i) => ({ t: i * 10, epoch: 0, value: [v, 0, 1] as Vec3 }));
    const result = filterImuVectors(input, s);
    expect(result.filtered[3]).toBeNull(); expect(result.filtered[4]).toBeNull();
    const ema = filterImuVectors([{ t: 0, epoch: 0, value: [0, 0, 1] }, { t: 100, epoch: 0, value: [1, 0, 1] }, { t: 400, epoch: 0, value: [2, 0, 1] }], { ...s, hampel: false, lowpass: true, tau: 0.2 });
    const first = 1 - Math.exp(-0.5);
    expect(ema.filtered[2]![0]).toBeCloseTo(first + (1 - Math.exp(-1.5)) * (2 - first));
  });
  it('exports matching numeric stages, flags and raw records without mutating arrays', async () => {
    const p = stationaryLog({ lengthMs: 3200 }); const s = manual();
    const a = analyzeImu(p, s); const tables = exportTables({ fileName: 'imu.log', fileSize: p.stats.fileSize, result: p }, defaultRearSettings(), s);
    const table = tables.find((t) => t.name === 'IMU')!, rows = [...table.rows()];
    expect(rows).toHaveLength(p.gyro.count); expect(rows.every((r) => r.length === table.headers.length)).toBe(true);
    const index = table.headers.indexOf('Vehicle filtered linear acceleration Z (g)');
    expect(rows[100][index]).toBe(a.rows[100].filteredLinear![2]);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await buildWorkbook(tables));
    expect(book.getWorksheet('IMU')!.getCell(102, index + 1).value).toBe(a.rows[100].filteredLinear![2]);
    expect(book.getWorksheet('GForce_Analysis')!.rowCount - 1).toBe(imuGForce(a, 'filtered').samples.length);
  });
  it('evaluates the actual bundled run without asserting an unobserved mounting direction', () => {
    const bytes = readFileSync('public/data/default-run.bin');
    const p = parseLog(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const a = analyzeImu(p);
    expect(a.rows).toHaveLength(p.gyro.count); expect(a.rotation).toBeNull();
    const previewMode = filteredGForceMode(a);
    expect(previewMode).toBe('sensorAdjusted');
    const preview = imuGForce(a, previewMode);
    expect(preview.samples.length).toBeGreaterThan(20000);
    expect(selectImuGForce(a, previewMode, preview.samples[0].timestampMs)).not.toBeNull();
    const report = { imu: p.gyro.count, gps: p.gps.count, stationary: a.stationary, calibrations: a.calibrations, status: a.status, rotation: a.rotation, candidateRotation: a.candidateRotation, training: a.axisTraining, validation: a.axisValidation, axisReasons: a.axisReasons, forwardError: a.forwardError, turnValidation: a.turnValidation, rawYawError: a.rawYawError, yawError: a.yawError, lateralError: a.lateralError, lag: a.lag, cadence: a.cadence, counts: a.counts };
    writeFileSync(join(tmpdir(), 'coc-imu-calibration-report.json'), JSON.stringify(report, null, 2));
  });
  it('learns a tilted mounting from forward accel/decel and validates left/right turns on holdout', () => {
    const r = eulerRotation([0, -40, 0]);
    const transpose: Mat3 = [[r[0][0], r[1][0], r[2][0]], [r[0][1], r[1][1], r[2][1]], [r[0][2], r[1][2], r[2][2]]];
    const records = [boot()]; let course = 30;
    for (let i = 0; i <= 16000; i++) {
      const t = i / 100; const moving = t > 5; const phase = Math.floor((t - 5) / 20);
      const speed = moving ? 50 + 15 * Math.sin((t - 5) * 0.35) : 0;
      const acceleration = moving ? 15 * 0.35 * Math.cos((t - 5) * 0.35) / 3.6 / 9.80665 : 0;
      const yaw = moving && phase % 3 === 2 ? 10 * Math.sin(t * 0.5) : 0;
      course -= yaw * 0.01;
      const force: Vec3 = [acceleration, speed / 3.6 * yaw * Math.PI / 180 / 9.80665, 1];
      const w = transform(transpose, [0, 0, yaw]);
      records.push(record(i * 10, transform(transpose, force), [w[0] + 1, w[1] - 0.5, w[2] + 0.2]));
      if (i % 10 === 0) records.push(gps(i * 10, speed, course));
    }
    const p = parseLog(buildLog(records));
    const a = analyzeImu(p, { ...defaultImuSettings(), lowpass: false, hampel: false, gpsLagMs: 0, forwardConfirmed: true, gravityMethod: 'static' });
    expect(a.stationary).not.toBeNull(); expect(a.axisTraining).toBeGreaterThan(40); expect(a.axisValidation).toBeGreaterThan(20);
    expect(a.forwardError.r2!).toBeGreaterThan(0.95);
    expect(a.rotation).not.toBeNull(); expect(properRotation(a.rotation!)).toBe(true);
    expect(filteredGForceMode(a)).toBe('filtered');
    expect(a.rotation![0][0]).toBeCloseTo(r[0][0], 1);
    expect(a.yawError.rmse!).toBeLessThan(0.5);
    expect(a.lateralError.rmse!).toBeLessThan(0.03);
    const acceleration = a.rows.find((row) => row.gpsAccel !== null && row.gpsAccel > 0.1 && row.filteredLinear !== null)!;
    const braking = a.rows.find((row) => row.gpsAccel !== null && row.gpsAccel < -0.1 && row.filteredLinear !== null)!;
    expect(acceleration.filteredLinear![0]).toBeGreaterThan(0);
    expect(braking.filteredLinear![0]).toBeLessThan(0);
    const positive = a.rows.find((row) => row.gpsYaw !== null && row.gpsYaw > 8 && row.filteredLinear !== null)!;
    expect(positive.filteredLinear![1]).toBeGreaterThan(0); expect(positive.filteredGyro![2]).toBeGreaterThan(0);
    const negative = a.rows.find((row) => row.gpsYaw !== null && row.gpsYaw < -8 && row.filteredLinear !== null)!;
    expect(negative.filteredLinear![1]).toBeLessThan(0); expect(negative.filteredGyro![2]).toBeLessThan(0);
  });
});
