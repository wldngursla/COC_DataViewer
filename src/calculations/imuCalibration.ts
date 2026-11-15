import type { ParsedLog } from '../parser/types';
import { rawToG, rawToDps, GRAVITY_MS2 } from '../decoder/imu';
import { rawToKmh, rawToCourseDeg, rawToDecimalDegrees } from '../decoder/gps';
import { nearestValue, metrics, type ErrorMetrics, type TimedValue } from './rearCalibration';
import { add, sub, scale, dot, norm, unit, transform, vehicleFrame, eulerRotation, mappedRotation, properRotation, propagateUp, type Vec3, type Mat3 } from './imuMath';

export interface ImuSettings {
  autoStationary: boolean; stationaryStartMs: number | null; stationaryEndMs: number | null; stationaryConfirmed: boolean;
  stationarySeconds: number; searchSeconds: number; autoAxes: boolean; forwardConfirmed: boolean;
  mounting: 'auto' | 'mapping' | 'angles'; axes: Vec3; angles: Vec3;
  removeGravity: boolean; gravityMethod: 'static' | 'complementary'; attitudeTau: number; maxPropagationSeconds: number;
  hampel: boolean; window: number; threshold: number; lowpass: boolean; tau: number;
  gapMs: number; toleranceMs: number; gpsLagMs: number | null; maxAccelG: number; maxGyroDps: number;
}
export const defaultImuSettings = (): ImuSettings => ({
  autoStationary: true, stationaryStartMs: null, stationaryEndMs: null, stationaryConfirmed: false,
  stationarySeconds: 3, searchSeconds: 120, autoAxes: true, forwardConfirmed: false,
  mounting: 'auto', axes: [1, 2, 3], angles: [0, 0, 0], removeGravity: true,
  gravityMethod: 'complementary', attitudeTau: 2, maxPropagationSeconds: 30,
  hampel: true, window: 7, threshold: 3, lowpass: true, tau: 0.15,
  gapMs: 500, toleranceMs: 250, gpsLagMs: null, maxAccelG: 7.9, maxGyroDps: 490,
});
export interface ImuRow {
  t: number; sourceIndex: number; epoch: number; sensorAccel: Vec3; sensorGyro: Vec3;
  biasCorrectedSensorGyro: Vec3 | null;
  filteredSensorAccel: Vec3 | null; filteredSensorGyro: Vec3 | null;
  accel: Vec3 | null; gyro: Vec3 | null; filteredAccel: Vec3 | null; filteredGyro: Vec3 | null;
  linear: Vec3 | null; filteredLinear: Vec3 | null; gravity: Vec3 | null;
  gpsAccel: number | null; gpsYaw: number | null; gpsLateral: number | null; flags: string[];
}
export interface GpsImuReference { t: number; speed: number | null; acceleration: number | null; yaw: number | null; lateral: number | null }
export interface StationaryCalibration { start: number; end: number; count: number; epoch: number; bias: Vec3; gravity: Vec3; accelStd: number; gyroStd: number; gpsCoverage: number; source: string }
export interface ImuAnalysis {
  settings: ImuSettings; rows: ImuRow[]; gps: GpsImuReference[]; stationary: StationaryCalibration | null;
  calibrations: StationaryCalibration[];
  rotation: Mat3 | null; candidateRotation: Mat3 | null; status: string; axisTraining: number; axisValidation: number;
  forwardError: ErrorMetrics; turnValidation: ErrorMetrics; axisReasons: Record<string, number>; yawError: ErrorMetrics; lateralError: ErrorMetrics; rawYawError: ErrorMetrics;
  lag: { ms: number; trusted: boolean; correlation: number | null; source: string };
  counts: { invalid: number; hampel: number; linear: number; gaps: number }; cadence: { medianMs: number | null; maxGapMs: number; regressions: number }; notes: string[];
}
const median = (a: number[]) => { if (!a.length) return 0; a.sort((x, y) => x - y); const i = a.length >>> 1; return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2; };
const componentMedian = (a: Vec3[]): Vec3 => [0, 1, 2].map((j) => median(a.map((v) => v[j]))) as Vec3;
const finiteNearest = (a: TimedValue[], t: number, tolerance: number) => { const v = nearestValue(a, t, tolerance); return v !== null && Number.isFinite(v) ? v : null; };
const standardDeviation = (vectors: Vec3[], center: Vec3) => Math.sqrt(vectors.reduce((s, v) => s + norm(sub(v, center)) ** 2, 0) / Math.max(1, vectors.length));

export function validateImuSettings(s: ImuSettings) {
  if (![s.stationarySeconds, s.searchSeconds, s.tau, s.attitudeTau, s.maxPropagationSeconds, s.threshold, s.gapMs, s.toleranceMs, s.maxAccelG, s.maxGyroDps].every((v) => Number.isFinite(v) && v > 0)
    || !Number.isInteger(s.window) || s.window < 3 || s.window > 101 || s.window % 2 === 0 || !s.angles.every(Number.isFinite)
    || s.maxAccelG > 8 || s.maxGyroDps > 500 || (s.gpsLagMs !== null && (!Number.isFinite(s.gpsLagMs) || Math.abs(s.gpsLagMs) > 5000))
    || ![s.stationaryStartMs, s.stationaryEndMs].every((v) => v === null || Number.isFinite(v))
    || (s.mounting === 'mapping' && (!s.axes.every((v) => [1, 2, 3].includes(Math.abs(v))) || !properRotation(mappedRotation(s.axes))))) throw new Error('IMU 설정 오류: 유효한 양수·홀수 window(3–101)·오른손 축 매핑을 입력하세요.');
}

/** GPS course grows clockwise from north; vehicle +Z yaw grows counterclockwise. */
export const courseDifference = (a: number, b: number) => ((b - a + 540) % 360) - 180;
export function gpsImuReference(p: ParsedLog, s: ImuSettings): GpsImuReference[] {
  const samples = Array.from(p.gps.timestamp, (t, i) => {
    const g = p.gps; const lat = rawToDecimalDegrees(g.latitudeRaw[i], g.latDir[i]); const lon = rawToDecimalDegrees(g.longitudeRaw[i], g.lonDir[i]);
    const speed = rawToKmh(g.speedRaw[i]); const course = rawToCourseDeg(g.courseRaw[i]);
    const valid = [78, 83].includes(g.latDir[i]) && [69, 87].includes(g.lonDir[i]) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && speed <= 160 && course < 360;
    return { t, speed, course, valid };
  }).sort((a, b) => a.t - b.t);
  const smooth = samples.map((g, i) => {
    const neighbors = samples.slice(Math.max(0, i - 2), i + 3).filter((n) => n.valid && Math.abs(n.t - g.t) <= 300);
    return neighbors.length >= 3 ? median(neighbors.map((n) => n.speed)) : g.speed;
  });
  return samples.map((g, i) => {
    const begin = Math.max(0, i - 5), end = Math.min(samples.length - 1, i + 5);
    const values = samples.slice(begin, end + 1);
    let ok = g.valid && values.length >= 5 && values.at(-1)!.t - values[0].t >= 400;
    let unwrapped = values[0]?.course ?? 0;
    const points = values.map((n, j) => {
      if (!n.valid || (j && (n.t <= values[j - 1].t || n.t - values[j - 1].t > s.gapMs))) ok = false;
      if (j) { const delta = courseDifference(values[j - 1].course, n.course); if (Math.abs(delta) > 30) ok = false; unwrapped += delta; }
      return { dt: (n.t - g.t) / 1000, v: smooth[begin + j] / 3.6, course: unwrapped };
    });
    const meanT = points.reduce((sum, v) => sum + v.dt, 0) / Math.max(1, points.length);
    const denominator = points.reduce((sum, v) => sum + (v.dt - meanT) ** 2, 0);
    const slope = (key: 'v' | 'course') => denominator ? points.reduce((sum, v) => sum + (v.dt - meanT) * v[key], 0) / denominator : 0;
    const acceleration = slope('v'); const yaw = -slope('course');
    if (Math.abs(acceleration) > 6 || Math.abs(yaw) > 90) ok = false;
    // Course is unobservable at low speed, even when a numerical course is stored.
    const headingValid = ok && values.every((n) => n.speed >= 8);
    return { t: g.t, speed: g.valid ? g.speed : null, acceleration: ok ? acceleration : null, yaw: headingValid ? yaw : null, lateral: headingValid ? smooth[i] / 3.6 * yaw * Math.PI / 180 / GRAVITY_MS2 : null };
  });
}

function findStationary(rows: ImuRow[], gps: TimedValue[], s: ImuSettings): StationaryCalibration | null {
  const initial = rows[0]?.t ?? 0;
  const attempts: [number, number, boolean][] = [];
  if (s.autoStationary) for (let t = initial; t <= initial + s.searchSeconds * 1000; t += 500) attempts.push([t, t + s.stationarySeconds * 1000, false]);
  else if (s.stationaryStartMs !== null && s.stationaryEndMs !== null) attempts.push([s.stationaryStartMs, s.stationaryEndMs, true]);
  let start = 0;
  for (const [lo, hi, manual] of attempts) {
    if (hi - lo < s.stationarySeconds * 1000) continue;
    while (start < rows.length && rows[start].t < lo) start++;
    let end = start; while (end < rows.length && rows[end].t <= hi) end++;
    const segment = rows.slice(start, end);
    if (segment.length < 30 || segment.at(-1)!.t - segment[0].t < (hi - lo) * 0.9 || segment.some((r, i) => r.flags.length || r.epoch !== segment[0].epoch || (i && r.t - segment[i - 1].t > s.gapMs))) continue;
    const a = componentMedian(segment.map((r) => r.sensorAccel)); const bias = componentMedian(segment.map((r) => r.sensorGyro));
    const accelStd = standardDeviation(segment.map((r) => r.sensorAccel), a); const gyroStd = standardDeviation(segment.map((r) => r.sensorGyro), bias);
    const speed = segment.map((r) => finiteNearest(gps, r.t, s.toleranceMs));
    const gpsCoverage = speed.filter((v) => v !== null).length / speed.length;
    const gpsStopped = gpsCoverage >= 0.8 && speed.every((v) => v === null || v < 1);
    const confirmed = manual ? s.stationaryConfirmed : gpsStopped;
    if (confirmed && norm(a) >= 0.8 && norm(a) <= 1.2 && accelStd <= 0.035 && gyroStd <= 0.7 && norm(bias) <= 5) return { start: segment[0].t, end: segment.at(-1)!.t, count: segment.length, epoch: segment[0].epoch, bias, gravity: a, accelStd, gyroStd, gpsCoverage, source: manual ? 'MANUAL_CONFIRMED_STABLE' : 'GPS_STOP_AND_IMU_STABILITY' };
  }
  return null;
}

/** Non-causal Hampel detector; EMA itself is causal and uses the actual dt. */
export function filterImuVectors(rows: { t: number; value: Vec3 | null; epoch: number }[], s: ImuSettings) {
  const cleaned = rows.map((r) => r.value ? [...r.value] as Vec3 : null);
  const spike = rows.map(() => false); const half = s.window >>> 1;
  if (s.hampel) for (let i = 0; i < rows.length; i++) {
    const current = rows[i]; if (!current.value) continue;
    const neighbors = rows.slice(Math.max(0, i - half), i + half + 1).filter((r) => r.value && r.epoch === current.epoch && Math.abs(r.t - current.t) <= s.gapMs);
    if (neighbors.length < 5) continue;
    const center = componentMedian(neighbors.map((r) => r.value!));
    const isSpike = [0, 1, 2].some((j) => Math.abs(current.value![j] - center[j]) > s.threshold * Math.max(0.005, 1.4826 * median(neighbors.map((r) => Math.abs(r.value![j] - center[j])))));
    if (isSpike) spike[i] = true;
  }
  // Restore only isolated spikes bracketed by trustworthy neighbors. Never bridge a gap.
  for (let i = 0; i < rows.length; i++) if (spike[i]) {
    const left = rows[i - 1], right = rows[i + 1];
    if (left?.value && right?.value && !spike[i - 1] && !spike[i + 1] && left.epoch === rows[i].epoch && right.epoch === rows[i].epoch && right.t > left.t && rows[i].t > left.t && right.t > rows[i].t && right.t - left.t <= s.gapMs) {
      const fraction = (rows[i].t - left.t) / (right.t - left.t);
      cleaned[i] = add(left.value, scale(sub(right.value, left.value), fraction));
    } else cleaned[i] = null;
  }
  let previous: { t: number; value: Vec3; epoch: number } | null = null;
  const filtered = cleaned.map((v, i) => {
    if (!v) { previous = null; return null; }
    const row = rows[i]; const dt = previous ? (row.t - previous.t) / 1000 : Infinity;
    const alpha = !s.lowpass || !previous || previous.epoch !== row.epoch || dt <= 0 || dt > s.gapMs / 1000 ? 1 : 1 - Math.exp(-dt / s.tau);
    const value = previous ? add(previous.value, scale(sub(v, previous.value), alpha)) : v;
    previous = { t: row.t, value, epoch: row.epoch }; return value;
  });
  return { cleaned, filtered, spike };
}

function lagEstimate(gps: TimedValue[], imu: TimedValue[], s: ImuSettings): ImuAnalysis['lag'] {
  if (s.gpsLagMs !== null) return { ms: s.gpsLagMs, trusted: true, correlation: null, source: 'MANUAL' };
  const scores: { ms: number; corr: number }[] = [];
  for (let ms = -1500; ms <= 1500; ms += 100) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < gps.length; i += Math.max(1, Math.ceil(gps.length / 1500))) { const v = finiteNearest(imu, gps[i].t - ms, s.toleranceMs); if (v !== null && Number.isFinite(gps[i].v)) pairs.push([v, gps[i].v]); }
    if (pairs.length < 30) continue;
    const mx = pairs.reduce((sum, v) => sum + v[0], 0) / pairs.length, my = pairs.reduce((sum, v) => sum + v[1], 0) / pairs.length;
    let xx = 0, yy = 0, xy = 0;
    for (const [x, y] of pairs) { xx += (x - mx) ** 2; yy += (y - my) ** 2; xy += (x - mx) * (y - my); }
    if (xx / pairs.length >= 4 && yy / pairs.length >= 4) scores.push({ ms, corr: xy / Math.sqrt(xx * yy) });
  }
  scores.sort((a, b) => b.corr - a.corr); const best = scores[0];
  const trusted = !!best && best.corr >= 0.75 && Math.abs(best.ms) < 1500 && scores.filter((v) => Math.abs(v.ms - best.ms) >= 500).every((v) => best.corr - v.corr >= 0.02);
  return { ms: trusted ? best.ms : 0, trusted, correlation: best?.corr ?? null, source: trusted ? 'TRAINING_YAW_CORRELATION' : 'WITHHELD_ZERO_LAG' };
}

export function analyzeImu(p: ParsedLog, s: ImuSettings = defaultImuSettings()): ImuAnalysis {
  validateImuSettings(s);
  const g = p.gyro; const events = p.events.filter((e) => e.type === 7 && /^(SNS:GYR:|GYR_READ_FAIL)/.test(e.message)).sort((a, b) => a.timestamp - b.timestamp);
  let eventIndex = 0, epoch = 0, offline = false;
  const rows: ImuRow[] = Array.from(g.timestamp, (t, sourceIndex) => {
    const sensorAccel: Vec3 = [rawToG(g.accelX[sourceIndex]), rawToG(g.accelY[sourceIndex]), rawToG(g.accelZ[sourceIndex])];
    const sensorGyro: Vec3 = [rawToDps(g.gyroX[sourceIndex]), rawToDps(g.gyroY[sourceIndex]), rawToDps(g.gyroZ[sourceIndex])];
    const flags: string[] = [];
    if (![...sensorAccel, ...sensorGyro].every(Number.isFinite)) flags.push('NON_FINITE');
    if (sensorAccel.some((v) => Math.abs(v) >= s.maxAccelG || Math.abs(v * 4096) >= 32760) || sensorGyro.some((v) => Math.abs(v) >= s.maxGyroDps)) flags.push('RANGE_OR_SATURATION');
    if (sourceIndex && t <= g.timestamp[sourceIndex - 1]) flags.push('TIMESTAMP');
    return { t, sourceIndex, epoch: 0, sensorAccel, sensorGyro, biasCorrectedSensorGyro: null, filteredSensorAccel: null, filteredSensorGyro: null, accel: null, gyro: null, filteredAccel: null, filteredGyro: null, linear: null, filteredLinear: null, gravity: null, gpsAccel: null, gpsYaw: null, gpsLateral: null, flags };
  }).sort((a, b) => a.t - b.t);
  for (const row of rows) {
    while (eventIndex < events.length && events[eventIndex].timestamp <= row.t) {
      const ready = events[eventIndex].message === 'SNS:GYR:OK';
      if (ready && offline) epoch++;
      offline = !ready; eventIndex++;
    }
    row.epoch = epoch; if (offline) row.flags.push('SENSOR_OFFLINE');
  }
  const gps = gpsImuReference(p, s);
  const speed = gps.map((r) => ({ t: r.t, v: r.speed ?? NaN }));
  const calibrations = [...new Set(rows.map((r) => r.epoch))].flatMap((epoch) => {
    const found = findStationary(rows.filter((r) => r.epoch === epoch), speed, s);
    return found ? [found] : [];
  });
  const stationary = calibrations[0] ?? null;
  const byEpoch = new Map(calibrations.map((c) => [c.epoch, c]));
  const calibrationFor = (row: ImuRow) => {
    const c = byEpoch.get(row.epoch);
    if (!c) return null;
    // Automatic mounting assumes the initial level reference still applies.
    if (s.mounting === 'auto' && stationary && dot(unit(c.gravity)!, unit(stationary.gravity)!) < Math.cos(5 * Math.PI / 180)) return null;
    return c;
  };
  const up = stationary ? unit(stationary.gravity) : null;
  const eligible = rows.map((r) => r.flags.length === 0);
  for (let i = 1; i < rows.length; i++) if (rows[i].t - rows[i - 1].t > s.gapMs) rows[i].flags.push('GAP_RESET');
  const preAccel = filterImuVectors(rows.map((r, i) => ({ t: r.t, epoch: r.epoch, value: eligible[i] ? r.sensorAccel : null })), s);
  const preGyro = filterImuVectors(rows.map((r, i) => ({ t: r.t, epoch: r.epoch, value: eligible[i] ? r.sensorGyro : null })), s);
  const sourceTimes = rows.map((r, i) => ({ t: r.t, v: i }));
  const cut = gps[Math.floor(gps.length * 0.7)]?.t ?? Infinity;
  const gyroUp = rows.map((r, i) => { const c = calibrationFor(r); return { t: r.t, v: up && c && preGyro.filtered[i] ? dot(sub(preGyro.filtered[i]!, c.bias), up) : NaN }; });
  const lag = lagEstimate(gps.filter((r) => r.t < cut).map((r) => ({ t: r.t, v: r.yaw ?? NaN })), gyroUp.filter((r) => r.t < cut), s);
  const candidates: { t: number; horizontal: Vec3; target: number }[] = [];
  const wheelTimes = Array.from(p.digital.timestamp, (t, i) => ({ t, v: i })).sort((a, b) => a.t - b.t);
  const gpsTimes = gps.map((r, i) => ({ t: r.t, v: i }));
  const axisReasons: Record<string, number> = {};
  const rejected = (reason: string) => { axisReasons[reason] = (axisReasons[reason] ?? 0) + 1; };
  if (stationary && up && s.autoAxes) for (const reference of gps) {
    const index = finiteNearest(sourceTimes, reference.t - lag.ms, s.toleranceMs);
    if (index === null) { rejected('NO_IMU_MATCH'); continue; }
    const a = preAccel.filtered[index], w = preGyro.filtered[index];
    const calibration = calibrationFor(rows[index]);
    if (!a || !w || !calibration) { rejected('INVALID_IMU_OR_BIAS_EPOCH'); continue; }
    if (reference.speed === null || reference.speed < 8) { rejected('LOW_OR_INVALID_GPS_SPEED'); continue; }
    if (reference.acceleration === null || Math.abs(reference.acceleration) < 0.3 || Math.abs(reference.acceleration) > 3) { rejected('INSUFFICIENT_OR_INVALID_ACCELERATION'); continue; }
    if (reference.yaw === null || Math.abs(reference.yaw) > 3 || Math.abs(dot(sub(w, calibration.bias), up)) > 5) { rejected('NOT_STRAIGHT_OR_NO_COURSE'); continue; }
    const before = finiteNearest(gpsTimes, reference.t - 400, 150);
    const earlier = before === null ? null : gps[before].acceleration;
    if (earlier === null || Math.sign(earlier) !== Math.sign(reference.acceleration)) { rejected('ACCELERATION_NOT_SUSTAINED'); continue; }
    const digital = finiteNearest(wheelTimes, reference.t - lag.ms, s.toleranceMs);
    if (digital !== null && p.digital.format === 'wheel-speed-kmh') {
      const wheels = [p.digital.wheelSpeedKmh[2][digital], p.digital.wheelSpeedKmh[3][digital]];
      if (wheels.some((v) => !Number.isFinite(v) || Math.abs(v - reference.speed!) > Math.max(5, reference.speed! * 0.25))) { rejected('WHEEL_DISAGREEMENT_OR_POSSIBLE_SLIP'); continue; }
    }
    const dynamic = sub(a, calibration.gravity);
    candidates.push({ t: reference.t, horizontal: sub(dynamic, scale(up, dot(dynamic, up))), target: reference.acceleration / GRAVITY_MS2 });
  }
  const training = candidates.filter((r) => r.t < cut), validation = candidates.filter((r) => r.t >= cut);
  let forward: Vec3 = [0, 0, 0];
  for (const row of training) {
    // Cap gross vector residual influence without inventing an accel scale factor.
    const weight = Math.min(1, 0.5 / Math.max(norm(row.horizontal), 1e-9));
    forward = add(forward, scale(row.horizontal, row.target * weight));
  }
  const candidateRotation = up ? vehicleFrame(up, forward) : null;
  const forwardError = metrics(candidateRotation ? validation.map((r) => [dot(candidateRotation[0], r.horizontal), r.target]) : []);
  const bothSigns = training.some((r) => r.target > 0.04) && training.some((r) => r.target < -0.04) && validation.some((r) => r.target > 0.04) && validation.some((r) => r.target < -0.04);
  const turnValidation = metrics(gps.filter((r) => r.t >= cut && r.yaw !== null && Math.abs(r.yaw) >= 3).flatMap((r) => {
    const value = finiteNearest(gyroUp, r.t - lag.ms, s.toleranceMs);
    return value === null ? [] : [[value, r.yaw!] as [number, number]];
  }));
  const axesTrusted = !!candidateRotation && training.length >= 40 && validation.length >= 20 && bothSigns && forwardError.r2 !== null && forwardError.r2 >= 0.5 && forwardError.rmse! <= 0.08 && turnValidation.count >= 30 && turnValidation.mae! <= 5 && turnValidation.r2 !== null && turnValidation.r2 >= 0.5;
  let rotation: Mat3 | null = null;
  let status = !stationary ? 'NO_CONFIRMED_STATIONARY_INTERVAL' : 'FORWARD_AXIS_WITHHELD';
  if (s.mounting === 'mapping') { rotation = mappedRotation(s.axes); status = 'MANUAL_AXIS_MAPPING'; }
  else if (s.mounting === 'angles') { rotation = eulerRotation(s.angles); status = 'MANUAL_EULER_ROTATION'; }
  else if (s.autoAxes && axesTrusted && s.forwardConfirmed) { rotation = candidateRotation; status = 'GPS_HOLDOUT_VALIDATED_FORWARD_CONFIRMED'; }
  else if (axesTrusted && !s.forwardConfirmed) status = 'CANDIDATE_REQUIRES_FORWARD_MOTION_CONFIRMATION';
  if (rotation && !properRotation(rotation)) throw new Error('IMU rotation must be orthogonal with determinant +1');
  const gpsAx = gps.map((r) => ({ t: r.t, v: r.acceleration === null ? NaN : r.acceleration / GRAVITY_MS2 }));
  const gpsYaw = gps.map((r) => ({ t: r.t, v: r.yaw ?? NaN }));
  const gpsAy = gps.map((r) => ({ t: r.t, v: r.lateral ?? NaN }));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]; row.gpsAccel = finiteNearest(gpsAx, row.t + lag.ms, s.toleranceMs); row.gpsYaw = finiteNearest(gpsYaw, row.t + lag.ms, s.toleranceMs); row.gpsLateral = finiteNearest(gpsAy, row.t + lag.ms, s.toleranceMs);
    if (preAccel.spike[i] || preGyro.spike[i]) row.flags.push('HAMPEL_DETECTED');
    const calibration = calibrationFor(row);
    const biasValid = calibration !== null;
    if (calibration && eligible[i]) row.biasCorrectedSensorGyro = sub(row.sensorGyro, calibration.bias);
    row.filteredSensorAccel = preAccel.filtered[i];
    row.filteredSensorGyro = calibration && preGyro.filtered[i] ? sub(preGyro.filtered[i]!, calibration.bias) : null;
    if (!biasValid) row.flags.push('GYRO_BIAS_UNAVAILABLE');
    if (!rotation || !eligible[i]) continue;
    row.accel = transform(rotation, row.sensorAccel);
    row.gyro = row.biasCorrectedSensorGyro ? transform(rotation, row.biasCorrectedSensorGyro) : null;
    row.filteredAccel = preAccel.filtered[i] ? transform(rotation, preAccel.filtered[i]!) : null;
    row.filteredGyro = calibration && preGyro.filtered[i] ? transform(rotation, sub(preGyro.filtered[i]!, calibration.bias)) : null;
  }
  let gravity: Vec3 | null = null, lastT: number | null = null, lastCorrection: number | null = null, quietSince: number | null = null, gravityEpoch = -1;
  for (const row of rows) {
    const calibration = calibrationFor(row);
    if (!s.removeGravity || !rotation || !calibration || row.t < calibration.start || !row.filteredAccel || !row.filteredGyro) { gravity = null; lastT = null; quietSince = null; continue; }
    if (row.epoch !== gravityEpoch) { gravity = null; lastT = null; quietSince = null; gravityEpoch = row.epoch; }
    const dt = lastT === null ? Infinity : (row.t - lastT) / 1000;
    const stopped = finiteNearest(speed, row.t, s.toleranceMs);
    const quiet = stopped !== null && stopped < 1 && norm(row.filteredGyro) < 3 && Math.abs(norm(row.filteredAccel) - 1) < 0.1;
    if (s.gravityMethod === 'static') { gravity = unit(transform(rotation, calibration.gravity)); row.flags.push('STATIC_GRAVITY_APPROXIMATION'); }
    else {
      if (dt <= 0 || dt > s.gapMs / 1000) { gravity = null; lastCorrection = null; quietSince = null; }
      if (!quiet) quietSince = null;
      else if (quietSince === null) quietSince = row.t;
      const confirmedStop = quiet && ((row.t >= calibration.start && row.t <= calibration.end) || (quietSince !== null && row.t - quietSince >= s.stationarySeconds * 1000));
      if (!gravity && confirmedStop) { gravity = unit(row.filteredAccel); lastCorrection = row.t; }
      else if (gravity && Number.isFinite(dt)) {
        gravity = unit(propagateUp(gravity, row.filteredGyro, dt));
        if (confirmedStop) { gravity = unit(add(scale(gravity!, Math.exp(-dt / s.attitudeTau)), scale(unit(row.filteredAccel)!, 1 - Math.exp(-dt / s.attitudeTau)))); lastCorrection = row.t; }
      }
      if (lastCorrection === null || row.t - lastCorrection > s.maxPropagationSeconds * 1000) gravity = null;
    }
    lastT = row.t;
    if (!gravity) { row.flags.push('GRAVITY_UNTRUSTED'); continue; }
    row.gravity = [...gravity];
    row.linear = row.accel ? sub(row.accel, gravity) : null;
    row.filteredLinear = sub(row.filteredAccel, gravity);
  }
  const evaluation = rows.filter((r) => r.t + lag.ms >= cut);
  const yawError = metrics(evaluation.filter((r) => r.filteredGyro && r.gpsYaw !== null).map((r) => [r.filteredGyro![2], r.gpsYaw!]));
  const validSources = new Set(rows.filter((_, i) => eligible[i]).map((r) => r.sourceIndex));
  const rawYawError = metrics(evaluation.filter((r) => r.gpsYaw !== null && validSources.has(r.sourceIndex)).map((r) => [r.sensorGyro[2], r.gpsYaw!]));
  const lateralError = metrics(evaluation.filter((r) => r.filteredLinear && r.gpsLateral !== null).map((r) => [r.filteredLinear![1], r.gpsLateral!]));
  const intervals = rows.slice(1).map((r, i) => r.t - rows[i].t).filter((dt) => dt > 0);
  const gaps = intervals.filter((dt) => dt > s.gapMs).length;
  return {
    settings: s, rows, gps, stationary, calibrations, rotation, candidateRotation, status, axisTraining: training.length, axisValidation: validation.length,
    forwardError, turnValidation, axisReasons, yawError, rawYawError, lateralError, lag,
    counts: { invalid: eligible.filter((v) => !v).length, hampel: rows.filter((r) => r.flags.includes('HAMPEL_DETECTED')).length, linear: rows.filter((r) => r.filteredLinear).length, gaps },
    cadence: { medianMs: intervals.length ? median([...intervals]) : null, maxGapMs: intervals.reduce((a, b) => Math.max(a, b), 0), regressions: rows.filter((r) => r.flags.includes('TIMESTAMP')).length },
    notes: ['Vehicle: +X forward, +Y left, +Z up; R maps sensor vectors to vehicle vectors, det(R)=+1.', 'Stationary gravity identifies tilt, not forward heading or a full accel bias/scale calibration. Linear acceleration subtracts a unit (1g) gravity vector; stationary magnitude error remains.', 'GPS fix/HDOP/satellites are not recorded. Course is travel direction, not body heading; reversing/slip remain ambiguous. Auto axes require forward-motion confirmation and independent acceleration/deceleration validation.', 'GPS yaw = minus unwrapped course derivative. Positive lag compares IMU(t) to GPS(t+lag). GPS reference values are never imposed on IMU.', 'Hampel uses centered offline samples; EMA is causal (phase lag), not zero-phase. Gravity is a separate gyro-propagated complementary estimate corrected only during quiet GPS stops; stale/gapped estimates are withheld. No position/velocity/yaw integration is exported.', 'No accelerometer scale factor or full 3-axis bias is inferred. Six-face static calibration and surveyed mounting are needed for accuracy. Gyro scale and absolute yaw are not calibrated; no magnetometer means drift is unobservable.'],
  };
}
