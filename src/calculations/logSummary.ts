/**
 * Derived values for the parse-summary screen. Pure functions over ParsedLog —
 * no React, no formatting (presentation lives in the components).
 */

import type { ParsedLog } from '../parser/types';

export interface TimeRange {
  /** earliest record timestamp, ms since boot */
  firstMs: number;
  /** latest record timestamp, ms since boot */
  lastMs: number;
  /** lastMs - firstMs */
  durationMs: number;
}

/**
 * Run duration across every accepted record. Timestamps are near-monotonic but
 * micro-reversals are allowed by the protocol, so scan for true min/max instead
 * of trusting first/last file order.
 */
export function computeTimeRange(parsed: ParsedLog): TimeRange | null {
  let first = Infinity;
  let last = -Infinity;

  const scan = (timestamps: Uint32Array, count: number): void => {
    for (let i = 0; i < count; i++) {
      const t = timestamps[i];
      if (t < first) first = t;
      if (t > last) last = t;
    }
  };

  scan(parsed.can.timestamp, parsed.can.count);
  scan(parsed.gps.timestamp, parsed.gps.count);
  scan(parsed.analog.timestamp, parsed.analog.count);
  scan(parsed.digital.timestamp, parsed.digital.count);
  scan(parsed.gyro.timestamp, parsed.gyro.count);

  for (const e of parsed.events) {
    if (e.timestamp < first) first = e.timestamp;
    if (e.timestamp > last) last = e.timestamp;
  }
  if (parsed.boot !== null) {
    if (parsed.boot.timestamp < first) first = parsed.boot.timestamp;
    if (parsed.boot.timestamp > last) last = parsed.boot.timestamp;
  }

  if (!Number.isFinite(first)) return null;
  return { firstMs: first, lastMs: last, durationMs: last - first };
}

/** SYSTEM + USER_EVENT count (the two event types share one tile). */
export function countEventRecords(parsed: ParsedLog): number {
  return parsed.events.length;
}
