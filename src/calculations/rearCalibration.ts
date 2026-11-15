import type { ParsedLog } from '../parser/types';
import { rawToKmh, rawToDecimalDegrees } from '../decoder/gps';
import { decodeMotorRpm, CAN_ID_EZ_MSG1 } from '../decoder/can';
import { rawToDps } from '../decoder/imu';

export interface RearSettings {
  gpsEnabled: boolean; mode: 'off' | 'manual' | 'auto'; a: [number, number]; b: [number, number];
  hampel: boolean; window: number; threshold: number; ema: boolean; tau: number;
  maximumKmh: number; accelerationMs2: number; minimumGps: number; toleranceMs: number; gapMs: number;
  circumferenceM: number | null; gearRatio: number | null; ppr: number | null;
  drivetrain: 'unknown' | 'both' | 'single'; trackM: number | null; yawConfirmed: boolean; yawSign: number;
}
export const defaultRearSettings = (): RearSettings => ({ gpsEnabled: true, mode: 'off', a: [1, 1], b: [0, 0], hampel: true, window: 7, threshold: 3, ema: true, tau: 0.2, maximumKmh: 160, accelerationMs2: 20, minimumGps: 8, toleranceMs: 250, gapMs: 1000, circumferenceM: null, gearRatio: null, ppr: null, drivetrain: 'unknown', trackM: null, yawConfirmed: false, yawSign: 1 });
export interface TimedValue { t: number; v: number }
export interface ErrorMetrics { count: number; mae: number | null; rmse: number | null; r2: number | null }
export interface WheelFit { a: number; b: number; trusted: boolean; reason: string; training: number; validation: number; validationFit: ErrorMetrics; interval: [number, number] | null; lagMs: number; lagTrusted: boolean; correlation: number | null; raw: ErrorMetrics; corrected: ErrorMetrics; filtered: ErrorMetrics; commonRaw: ErrorMetrics; bins: { range: string; raw: ErrorMetrics; corrected: ErrorMetrics }[] }
export interface RearRow { t: number; sourceIndex: number; gps: number | null; matchedGps: [number | null, number | null]; motor: number | null; raw: [number | null, number | null]; corrected: [number | null, number | null]; filtered: [number | null, number | null]; flags: [string, string]; outlier: [boolean, boolean]; expectedDelta: number | null }
export interface RearAnalysis { rows: RearRow[]; fits: WheelFit[]; coefficients: { a: number; b: number; applied: string }[]; settings: RearSettings; counts: number[]; max: { raw: number | null; corrected: number | null; filtered: number | null }[]; motorComparison: { gps: ErrorMetrics; wheels: { raw: ErrorMetrics; corrected: ErrorMetrics; filtered: ErrorMetrics }[] }; notes: string[] }
const median = (a: number[]) => { if (!a.length) return 0; a.sort((x, y) => x - y); const i = Math.floor(a.length / 2); return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2; };
export function nearestValue(a: readonly TimedValue[], t: number, tolerance: number): number | null {
  let lo = 0; let hi = a.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (a[m].t < t) lo = m + 1; else hi = m; }
  const x = a[lo]; const y = a[lo - 1]; const chosen = y && (!x || t - y.t <= x.t - t) ? y : x;
  return chosen && Math.abs(chosen.t - t) <= tolerance ? chosen.v : null;
}
export function motorSpeed(rpm: number, circumferenceM: number | null, ratio: number | null): number | null {
  return circumferenceM !== null && ratio !== null && circumferenceM > 0 && ratio > 0 ? Math.abs(rpm) / ratio * circumferenceM * 60 / 1000 : null;
}
export function metrics(pairs: readonly [number, number][]): ErrorMetrics {
  if (!pairs.length) return { count: 0, mae: null, rmse: null, r2: null };
  const mean = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let ae = 0; let se = 0; let variance = 0;
  for (const [x, y] of pairs) { ae += Math.abs(x - y); se += (x - y) ** 2; variance += (y - mean) ** 2; }
  return { count: pairs.length, mae: ae / pairs.length, rmse: Math.sqrt(se / pairs.length), r2: variance > 0 ? 1 - se / variance : null };
}
/** Huber IRLS through the origin; preserves a stopped wheel and its physical zero. */
export function huberScale(pairs: readonly [number, number][]): number {
  let a = median(pairs.filter(([x]) => x > 0).map(([x, y]) => y / x));
  for (let k = 0; k < 30; k++) {
    const residuals = pairs.map(([x, y]) => y - a * x);
    const center = median([...residuals]);
    const scale = Math.max(0.25, 1.4826 * median(residuals.map((r) => Math.abs(r - center))));
    let xy = 0; let xx = 0;
    pairs.forEach(([x, y], i) => { const w = Math.min(1, 1.345 * scale / Math.max(1e-12, Math.abs(residuals[i]))); xy += w * x * y; xx += w * x * x; });
    if (xx === 0) return 1;
    const next = xy / xx; if (Math.abs(next - a) < 1e-9) break; a = next;
  }
  return a;
}
function correlation(pairs: [number, number][]) {
  if (pairs.length < 30) return null;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / pairs.length; const my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let xx = 0; let yy = 0; let xy = 0;
  for (const [x, y] of pairs) { xx += (x - mx) ** 2; yy += (y - my) ** 2; xy += (x - mx) * (y - my); }
  return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : null;
}
function estimateLag(gps: TimedValue[], wheel: TimedValue[], s: RearSettings) {
  const span = gps.reduce((r, p) => [Math.min(r[0], p.v), Math.max(r[1], p.v)], [Infinity, -Infinity]);
  if (span[1] - span[0] < 10) return { lag: 0, trusted: false, correlation: null };
  const scores: { lag: number; score: number }[] = [];
  const stride = Math.max(1, Math.ceil(gps.length / 1500));
  for (let lag = -2000; lag <= 2000; lag += 100) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < gps.length; i += stride) { const v = nearestValue(wheel, gps[i].t - lag, s.toleranceMs); if (v !== null && gps[i].v >= s.minimumGps) pairs.push([v, gps[i].v]); }
    const score = correlation(pairs); if (score !== null) scores.push({ lag, score });
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0]; const alternatives = scores.filter((x) => best && Math.abs(x.lag - best.lag) >= 500);
  const trusted = !!best && best.score >= 0.7 && Math.abs(best.lag) < 2000 && alternatives.every((x) => best.score - x.score >= 0.02);
  return { lag: trusted ? best.lag : 0, trusted, correlation: best?.score ?? null };
}
export function validateRearSettings(s: RearSettings): void {
  if (![s.maximumKmh, s.accelerationMs2, s.minimumGps, s.toleranceMs, s.gapMs, s.threshold, s.tau].every((v) => Number.isFinite(v) && v > 0)
    || !Number.isInteger(s.window) || s.window < 3 || s.window > 101 || s.window % 2 === 0
    || !s.a.every((a) => Number.isFinite(a) && a > 0) || !s.b.every(Number.isFinite)
    || ![s.circumferenceM, s.gearRatio, s.ppr, s.trackM].every((v) => v === null || (Number.isFinite(v) && v > 0))) throw new Error('설정값 오류: 양수·유한값 및 홀수 Hampel window(3~101)를 입력하세요.');
}
export function analyzeRearWheels(p: ParsedLog, s: RearSettings = defaultRearSettings()): RearAnalysis {
  validateRearSettings(s);
  const notes = ['Raw는 저장된 km/h이며 펄스 간격이 없습니다. 회귀 보정은 펌웨어 수정 결과나 참값이 아닙니다.', 'GPS 위성수/HDOP/fix 품질은 프로토콜에 없어 직접 검증할 수 없습니다. 지연은 모호하면 0ms로 보류합니다.', '최대속도·가감속·직진 조건은 분석 휴리스틱이며 차량 확정 사양이 아닙니다. 모터는 특정 후륜의 절대 기준이 아닙니다.'];
  const gps: TimedValue[] = [];
  for (let i = 0; i < p.gps.count; i++) {
    const g = p.gps; const v = rawToKmh(g.speedRaw[i]); const lat = rawToDecimalDegrees(g.latitudeRaw[i], g.latDir[i]); const lon = rawToDecimalDegrees(g.longitudeRaw[i], g.lonDir[i]);
    const valid = Number.isFinite(lat + lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && v <= s.maximumKmh && [78, 83].includes(g.latDir[i]) && [69, 87].includes(g.lonDir[i]);
    gps.push({ t: g.timestamp[i], v: valid ? v : NaN });
  }
  gps.sort((a, b) => a.t - b.t);
  const goodGps = gps.filter((g, i) => { const prev = gps[i - 1]; const next = gps[i + 1]; return Number.isFinite(g.v) && [prev, next].every((n) => !n || (Number.isFinite(n.v) && n.t !== g.t && Math.abs(n.t - g.t) <= s.gapMs && Math.abs(n.v - g.v) / 3.6 / (Math.abs(n.t - g.t) / 1000) <= 5)); });
  const gpsReference = (t: number) => {
    const recorded = nearestValue(gps, t, s.toleranceMs);
    return recorded === null || !Number.isFinite(recorded) ? null : nearestValue(goodGps, t, s.toleranceMs);
  };
  const rpm: TimedValue[] = [];
  for (let i = 0; i < p.can.count; i++) if (p.can.id[i] === CAN_ID_EZ_MSG1 && !p.can.remote[i] && p.can.len[i] >= 8) rpm.push({ t: p.can.timestamp[i], v: decodeMotorRpm(p.can.data.subarray(i * 8, i * 8 + 8)) });
  rpm.sort((a, b) => a.t - b.t);
  const yaw = Array.from(p.gyro.timestamp, (t, i) => ({ t, v: rawToDps(p.gyro.gyroZ[i]) })).sort((a, b) => a.t - b.t);
  const abnormalTime = new Set<number>();
  for (let i = 1; i < p.digital.count; i++) if (p.digital.timestamp[i] <= p.digital.timestamp[i - 1]) abnormalTime.add(i);
  const order = Array.from({ length: p.digital.count }, (_, i) => i).sort((a, b) => p.digital.timestamp[a] - p.digital.timestamp[b]);
  const rows: RearRow[] = order.map((sourceIndex) => {
    const t = p.digital.timestamp[sourceIndex];
    const v = nearestValue(rpm, t, s.toleranceMs);
    const y = nearestValue(yaw, t, s.toleranceMs);
    return {
      t, sourceIndex, gps: gpsReference(t), matchedGps: [null, null],
      motor: v === null ? null : motorSpeed(v, s.circumferenceM, s.gearRatio),
      raw: p.digital.format === 'wheel-speed-kmh' ? [p.digital.wheelSpeedKmh[2][sourceIndex], p.digital.wheelSpeedKmh[3][sourceIndex]] : [null, null],
      corrected: [null, null], filtered: [null, null], flags: ['', ''], outlier: [false, false],
      expectedDelta: s.yawConfirmed && s.trackM !== null && y !== null ? s.yawSign * y * Math.PI / 180 * s.trackM * 3.6 : null,
    };
  });
  const fits: WheelFit[] = []; const coefficients: RearAnalysis['coefficients'] = []; const counts = [0, 0];
  for (let w = 0; w < 2; w++) {
    const rawSeries = rows.filter((r) => !abnormalTime.has(r.sourceIndex) && r.raw[w] !== null && Number.isFinite(r.raw[w]) && r.raw[w]! >= 0).map((r) => ({ t: r.t, v: r.raw[w]! }));
    const timeCut = goodGps[Math.floor(goodGps.length * 0.7)]?.t ?? Infinity;
    const lag = s.gpsEnabled ? estimateLag(goodGps.filter((g) => g.t < timeCut), rawSeries.filter((v) => v.t < timeCut), s) : { lag: 0, trusted: false, correlation: null };
    const otherSeries = rows.filter((r) => r.raw[1 - w] !== null && Number.isFinite(r.raw[1 - w])).map((r) => ({ t: r.t, v: r.raw[1 - w]! }));
    const candidates: { t: number; x: number; y: number }[] = [];
    for (let i = 1; s.gpsEnabled && i < goodGps.length; i++) {
      const g = goodGps[i]; const prev = goodGps[i - 1]; const dt = (g.t - prev.t) / 1000;
      const x = nearestValue(rawSeries, g.t - lag.lag, s.toleranceMs);
      const other = nearestValue(otherSeries, g.t - lag.lag, s.toleranceMs);
      const y = nearestValue(yaw, g.t, s.toleranceMs);
      if (g.v >= s.minimumGps && x !== null && x > 0 && dt > 0 && dt <= s.gapMs / 1000 && Math.abs(g.v - prev.v) / 3.6 / dt <= 2.5 && (y === null || Math.abs(y) <= 5) && other !== null && Math.abs(x - other) / Math.max(x, other, 1) <= 0.2) candidates.push({ t: g.t, x, y: g.v });
    }
    // Chronological holdout: final 30% are never used for fitting.
    const training = candidates.filter((c) => c.t < timeCut); const validation = candidates.filter((c) => c.t >= timeCut);
    const a = huberScale(training.map((c) => [c.x, c.y]));
    const validationError = metrics(validation.map((c) => [a * c.x, c.y]));
    const span = training.reduce((r, c) => [Math.min(r[0], c.y), Math.max(r[1], c.y)], [Infinity, -Infinity]);
    const spread = training.length ? span[1] - span[0] : 0;
    const trusted = training.length >= 30 && validation.length >= 15 && spread >= 10 && (training.at(-1)!.t - training[0].t) >= 10000 && Number.isFinite(a) && a > 0 && validationError.r2 !== null && validationError.r2 >= 0.5 && validationError.rmse! <= Math.max(3, validation.reduce((n, c) => n + c.y, 0) / Math.max(1, validation.length) * 0.2);
    const applied = s.mode === 'manual' ? { a: s.a[w], b: s.b[w], applied: 'MANUAL' } : s.mode === 'auto' && s.gpsEnabled && trusted ? { a, b: 0, applied: 'GPS_HUBER' } : { a: 1, b: 0, applied: s.mode === 'auto' ? 'AUTO_WITHHELD' : 'OFF' };
    coefficients.push(applied);
    let previous: { t: number; v: number } | null = null;
    for (const r of rows) {
      const raw = r.raw[w]; const flag: string[] = [];
      r.matchedGps[w] = gpsReference(r.t + lag.lag);
      if (raw === null) flag.push('NO_STORED_KMH');
      else if (!Number.isFinite(raw) || raw < 0) flag.push('INVALID_RAW');
      else r.corrected[w] = raw * applied.a + applied.b;
      const v = r.corrected[w];
      if (v !== null && (v < 0 || v > s.maximumKmh)) flag.push('SPEED_LIMIT');
      if (abnormalTime.has(r.sourceIndex) || (previous && r.t <= previous.t)) flag.push('TIMESTAMP');
      if (v !== null && previous && r.t > previous.t && r.t - previous.t <= s.gapMs && Math.abs(v - previous.v) / 3.6 / ((r.t - previous.t) / 1000) > s.accelerationMs2) flag.push('ACCELERATION_LIMIT');
      if (!flag.length && v !== null) previous = { t: r.t, v };
      r.flags[w] = [...flag, applied.applied, r.matchedGps[w] === null ? 'GPS_UNAVAILABLE' : 'GPS_MATCHED'].join('|');
      r.outlier[w] = flag.length > 0;
    }
    // Snapshot eligibility: Hampel decisions must not depend on traversal order.
    const eligible = rows.map((r) => !r.outlier[w] && r.corrected[w] !== null);
    let ema: { t: number; v: number } | null = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]; let v = r.outlier[w] ? null : r.corrected[w];
      const half = Math.floor(s.window / 2);
      const neighbors: number[] = [];
      if (s.hampel) for (let j = Math.max(0, i - half); j < Math.min(rows.length, i + half + 1); j++) if (eligible[j] && Math.abs(rows[j].t - r.t) <= s.gapMs) neighbors.push(rows[j].corrected[w]!);
      if (s.hampel && neighbors.length >= 5 && v !== null) {
        const center = median([...neighbors]); const mad = median(neighbors.map((n) => Math.abs(n - center)));
        if (Math.abs(v - center) > s.threshold * Math.max(0.1, 1.4826 * mad)) { v = center; r.outlier[w] = true; r.flags[w] += '|HAMPEL_REPLACED'; }
      }
      if (v === null) { ema = null; r.filtered[w] = null; }
      else {
        const dt: number = ema ? r.t - ema.t : Infinity;
        const alpha = !s.ema || !ema || dt > s.gapMs ? 1 : 1 - Math.exp(-Math.max(0, dt) / (1000 * s.tau));
        const filtered: number = ema ? ema.v + alpha * (v - ema.v) : v;
        r.filtered[w] = filtered; ema = { t: r.t, v: filtered };
      }
      if (r.outlier[w]) counts[w]++;
    }
    const heldout = validation.length ? rows.filter((r) => r.t + lag.lag >= validation[0].t) : [];
    const error = (key: 'raw' | 'corrected' | 'filtered', subset = heldout) => metrics(subset.filter((r) => r.matchedGps[w] !== null && r.matchedGps[w]! >= s.minimumGps && r[key][w] !== null && Number.isFinite(r[key][w])).map((r) => [r[key][w]!, r.matchedGps[w]!]));
    fits.push({
      a, b: 0, trusted, reason: trusted ? 'HELDOUT_VALIDATED' : 'WITHHELD: samples / speed range / holdout fit insufficient',
      training: training.length, validation: validation.length, validationFit: validationError,
      interval: training.length ? [training[0].t, training.at(-1)!.t] : null,
      lagMs: lag.lag, lagTrusted: lag.trusted, correlation: lag.correlation,
      raw: error('raw'), corrected: error('corrected'), filtered: error('filtered'),
      commonRaw: error('raw', heldout.filter((r) => r.filtered[w] !== null)),
      bins: [[8, 20], [20, 40], [40, 60], [60, 200]].map(([lo, hi]) => {
        const subset = heldout.filter((r) => r.matchedGps[w] !== null && r.matchedGps[w]! >= lo && r.matchedGps[w]! < hi);
        return { range: `${lo}–${hi}`, raw: error('raw', subset), corrected: error('corrected', subset) };
      }),
    });
  }
  const max = [0, 1].map((w) => { const peak = (key: 'raw' | 'corrected' | 'filtered') => { let v: number | null = null; for (const r of rows) if (r[key][w] !== null && Number.isFinite(r[key][w])) v = Math.max(v ?? -Infinity, r[key][w]!); return v; }; return { raw: peak('raw'), corrected: peak('corrected'), filtered: peak('filtered') }; });
  if (p.digital.format !== 'wheel-speed-kmh') notes.push('Legacy GPIO log: no PPR/channel assumptions are made; stored-km/h correction is unavailable.');
  const motorComparison = {
    gps: metrics(rows.filter((r) => r.motor !== null && r.gps !== null && r.gps >= s.minimumGps).map((r) => [r.motor!, r.gps!])),
    wheels: [0, 1].map((w) => {
      const compare = (key: 'raw' | 'corrected' | 'filtered') => metrics(rows.filter((r) => r.motor !== null && r.motor >= s.minimumGps && r[key][w] !== null && Number.isFinite(r[key][w])).map((r) => [r[key][w]!, r.motor!]));
      return { raw: compare('raw'), corrected: compare('corrected'), filtered: compare('filtered') };
    }),
  };
  return { rows, fits, coefficients, settings: s, counts, max, motorComparison, notes };
}
