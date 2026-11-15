import type { ImuAnalysis, ImuRow } from './imuCalibration';
import type { GSample } from './gForce';
import { sub, type Vec3 } from './imuMath';
export type GForceMode = 'raw' | 'filtered' | 'sensorAdjusted' | 'sensorFiltered';
/** Preview stays in one frame for the entire run; never invent vehicle heading. */
export function filteredGForceMode(a: ImuAnalysis): GForceMode {
  return a.rotation && a.counts.linear > 0 ? 'filtered' : a.stationary ? 'sensorAdjusted' : 'sensorFiltered';
}
/** Chart horizontal=vehicle left(+Y), vertical=vehicle forward(+X). */
export function imuGForce(analysis: ImuAnalysis, mode: GForceMode) {
  const samples: GSample[] = [];
  let maxX = 0, maxY = 0, maxG = 0;
  for (const row of analysis.rows) {
    const sample = sampleForRow(row, mode, analysis.stationary?.gravity); if (!sample) continue;
    samples.push(sample);
    maxX = Math.max(maxX, Math.abs(sample.x)); maxY = Math.max(maxY, Math.abs(sample.y)); maxG = Math.max(maxG, sample.magnitude);
  }
  return { samples, maxX, maxY, maxG };
}
function sampleForRow(row: ImuRow, mode: GForceMode, reference?: Vec3): GSample | null {
  const v = mode === 'raw' ? row.sensorAccel : mode === 'filtered' ? row.filteredLinear : mode === 'sensorAdjusted' ? (row.filteredSensorAccel && reference ? sub(row.filteredSensorAccel, reference) : null) : row.filteredSensorAccel;
  if (!v || !v.every(Number.isFinite) || row.flags.some((f) => ['NON_FINITE', 'RANGE_OR_SATURATION', 'TIMESTAMP', 'SENSOR_OFFLINE'].includes(f))) return null;
  const x = mode === 'filtered' ? v[1] : v[0], y = mode === 'filtered' ? v[0] : v[1];
  return { timestampMs: row.t, x, y, magnitude: Math.hypot(x, y) };
}
export function selectImuGForce(a: ImuAnalysis, mode: GForceMode, timestamp: number): GSample | null {
  let low = 0, high = a.rows.length;
  while (low < high) { const mid = (low + high) >>> 1; if (a.rows[mid].t <= timestamp) low = mid + 1; else high = mid; }
  const row = a.rows[low - 1];
  // The last recorded row being invalid must not resurrect an older valid point.
  return row && timestamp - row.t <= Math.min(500, a.settings.gapMs) ? sampleForRow(row, mode, a.stationary?.gravity) : null;
}
