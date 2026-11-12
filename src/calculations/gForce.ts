import type { ParsedLog } from '../parser/types';
import { rawToG } from '../decoder/imu';

export interface GSample { timestampMs: number; x: number; y: number; magnitude: number }
export function computeGForce(parsed: ParsedLog) {
  const rows = Array.from(parsed.gyro.timestamp, (timestampMs, i) => ({ timestampMs, x: rawToG(parsed.gyro.accelX[i]), y: rawToG(parsed.gyro.accelY[i]) })).sort((a, b) => a.timestampMs - b.timestampMs);
  const events = parsed.events.filter((e) => e.type === 7 && /^(SNS:GYR:|GYR_READ_FAIL)/.test(e.message)).sort((a, b) => a.timestamp - b.timestamp);
  const samples: GSample[] = [];
  let previous: GSample | null = null;
  let queue: typeof rows = [];
  let eventIndex = 0; let failed = false;
  let maxX = 0; let maxY = 0; let maxG = 0;
  const median = (v: number[]) => { v.sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  for (const row of rows) {
    while (eventIndex < events.length && events[eventIndex].timestamp <= row.timestampMs) {
      failed = events[eventIndex].message !== 'SNS:GYR:OK';
      previous = null; queue = []; eventIndex++;
    }
    if (failed || !Number.isFinite(row.x + row.y)) continue;
    if (previous !== null && row.timestampMs - previous.timestampMs > 500) { previous = null; queue = []; }
    queue.push(row); if (queue.length > 5) queue.shift();
    const alpha = previous === null ? 1 : 1 - Math.exp(-(row.timestampMs - previous.timestampMs) / 350);
    const x: number = previous === null ? median(queue.map((s) => s.x)) : previous.x + alpha * (median(queue.map((s) => s.x)) - previous.x);
    const y: number = previous === null ? median(queue.map((s) => s.y)) : previous.y + alpha * (median(queue.map((s) => s.y)) - previous.y);
    previous = { timestampMs: row.timestampMs, x, y, magnitude: Math.hypot(x, y) };
    samples.push(previous); maxX = Math.max(maxX, Math.abs(x)); maxY = Math.max(maxY, Math.abs(y)); maxG = Math.max(maxG, previous.magnitude);
  }
  return { samples, maxX, maxY, maxG };
}
export function selectGForce(samples: readonly GSample[], timestampMs: number) {
  let low = 0; let high = samples.length;
  while (low < high) { const mid = (low + high) >>> 1; if (samples[mid].timestampMs <= timestampMs) low = mid + 1; else high = mid; }
  const value = samples[low - 1];
  return value && timestampMs - value.timestampMs <= 500 ? value : null;
}
