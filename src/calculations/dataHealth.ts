/**
 * Source-level timestamp quality checks used before vehicle analysis.
 *
 * A large gap is a log-local heuristic, not a vehicle or sensor PASS/FAIL
 * criterion. It finds gaps that are unusually long relative to the cadence
 * observed for that source in this log:
 *
 *   gap > max(5 * median interval, 1000 ms)
 */

import type { ParsedLog } from '../parser/types';

export type SourceId = 'can' | 'gps' | 'imu' | 'analog' | 'digital' | 'events';
export type SourceStatus = 'NORMAL' | 'WARNING' | 'MISSING' | 'N/A' | 'EVENT';

export interface SourceDefinition {
  id: SourceId;
  label: string;
  eventDriven?: true;
}

export const SOURCE_DEFINITIONS: readonly SourceDefinition[] = [
  { id: 'can', label: 'CAN' },
  { id: 'gps', label: 'GPS' },
  { id: 'imu', label: 'IMU' },
  { id: 'analog', label: 'Analog' },
  { id: 'digital', label: 'Digital' },
  { id: 'events', label: 'System/User Event', eventDriven: true },
];

export interface SourceHealth {
  source: SourceDefinition;
  count: number;
  /** Minimum and maximum timestamps, in milliseconds since logger boot. */
  firstTimestampMs: number | null;
  lastTimestampMs: number | null;
  /** (count - 1) / elapsed seconds. Null when count < 2 or elapsed <= 0. */
  averageHz: number | null;
  medianIntervalMs: number | null;
  maximumGapMs: number | null;
  /** max(5 * median interval, 1000 ms). */
  largeGapThresholdMs: number | null;
  largeGapCount: number | null;
  status: SourceStatus;
}

export interface FileIntegrityHealth {
  totalSlots: number;
  acceptedRecords: number;
  rejectedRecords: number;
  badMagic: number;
  badChecksum: number;
  unknownType: number;
  trailingBytes: number;
}

export interface DataHealthResult {
  sources: SourceHealth[];
  presentSources: number;
  totalSources: number;
  fileIntegrity: FileIntegrityHealth;
}

function median(sortedValues: Float64Array): number {
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 1
    ? sortedValues[middle]
    : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

function analyzeSource(
  source: SourceDefinition,
  rawTimestamps: ArrayLike<number>,
): SourceHealth {
  const count = rawTimestamps.length;
  const base: SourceHealth = {
    source,
    count,
    firstTimestampMs: null,
    lastTimestampMs: null,
    averageHz: null,
    medianIntervalMs: null,
    maximumGapMs: null,
    largeGapThresholdMs: null,
    largeGapCount: null,
    status: 'MISSING',
  };

  if (count === 0) return base;

  // The protocol permits tiny timestamp reversals. Sorting prevents those
  // enqueue-order effects from becoming false cadence anomalies.
  const timestamps = Float64Array.from(rawTimestamps);
  timestamps.sort();
  base.firstTimestampMs = timestamps[0];
  base.lastTimestampMs = timestamps[count - 1];

  if (source.eventDriven === true) {
    // SYSTEM/USER_EVENT records occur on events rather than a sampling clock,
    // so cadence and sampling-health metrics are not applicable.
    base.status = 'EVENT';
    return base;
  }

  if (count < 2) {
    base.status = 'N/A';
    return base;
  }

  const elapsedMs = base.lastTimestampMs - base.firstTimestampMs;
  if (elapsedMs <= 0) {
    base.status = 'N/A';
    return base;
  }

  base.averageHz = (count - 1) / (elapsedMs / 1000);

  const intervals = new Float64Array(count - 1);
  let maximumGapMs = 0;
  for (let index = 1; index < count; index++) {
    const intervalMs = timestamps[index] - timestamps[index - 1];
    intervals[index - 1] = intervalMs;
    if (intervalMs > maximumGapMs) maximumGapMs = intervalMs;
  }

  intervals.sort();
  base.medianIntervalMs = median(intervals);
  base.maximumGapMs = maximumGapMs;
  base.largeGapThresholdMs = Math.max(5 * base.medianIntervalMs, 1000);

  let largeGapCount = 0;
  for (const intervalMs of intervals) {
    if (intervalMs > base.largeGapThresholdMs) largeGapCount++;
  }

  base.largeGapCount = largeGapCount;
  // NORMAL only means that no structural timestamp anomaly was found in this
  // log. It is not a diagnosis of sensor health.
  base.status = largeGapCount > 0 ? 'WARNING' : 'NORMAL';
  return base;
}

export function computeDataHealth(parsed: ParsedLog): DataHealthResult {
  const eventTimestamps = parsed.events.map((event) => event.timestamp);

  const sources = SOURCE_DEFINITIONS.map((source) => {
    switch (source.id) {
      case 'can':
        return analyzeSource(source, parsed.can.timestamp);
      case 'gps':
        return analyzeSource(source, parsed.gps.timestamp);
      case 'imu':
        return analyzeSource(source, parsed.gyro.timestamp);
      case 'analog':
        return analyzeSource(source, parsed.analog.timestamp);
      case 'digital':
        return analyzeSource(source, parsed.digital.timestamp);
      case 'events':
        return analyzeSource(source, eventTimestamps);
    }
  });

  const { stats } = parsed;
  const rejectedRecords = stats.badMagic + stats.badChecksum + stats.unknownType;

  return {
    sources,
    presentSources: sources.filter((source) => source.count > 0).length,
    totalSources: sources.length,
    fileIntegrity: {
      totalSlots: stats.recordSlots,
      acceptedRecords: stats.accepted,
      rejectedRecords,
      badMagic: stats.badMagic,
      badChecksum: stats.badChecksum,
      unknownType: stats.unknownType,
      trailingBytes: stats.trailingBytes,
    },
  };
}
