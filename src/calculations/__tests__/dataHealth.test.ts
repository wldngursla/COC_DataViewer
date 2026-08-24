import { describe, expect, it } from 'vitest';
import { computeDataHealth } from '../dataHealth';
import type { SourceHealth, SourceId } from '../dataHealth';
import { parseLog } from '../../parser/parseLog';
import { LogType } from '../../parser/types';
import {
  bootRecord,
  buildLog,
  canRecord,
  digitalRecord,
  eventRecord,
  gpsRecord,
  gyroRecord,
} from '../../parser/__tests__/fixtures';

const boot = () => bootRecord({ timestamp: 0, bootTime: 1_755_820_800 });
const gyroAt = (timestamp: number) =>
  gyroRecord({ timestamp, accel: [0, 0, 0], gyro: [0, 0, 0] });
const gpsAt = (timestamp: number) =>
  gpsRecord({
    timestamp,
    latitudeRaw: 0,
    longitudeRaw: 0,
    latDir: 'N',
    lonDir: 'E',
    speedRaw: 0,
    courseRaw: 0,
  });
const canAt = (timestamp: number, id: number) =>
  canRecord({ timestamp, id, data: [0, 0, 0, 0, 0, 0, 0, 0] });

function getSource(records: Uint8Array[], id: SourceId): SourceHealth {
  const health = computeDataHealth(parseLog(buildLog([boot(), ...records])));
  const source = health.sources.find((item) => item.source.id === id);
  if (source === undefined) throw new Error(`No source health result for ${id}`);
  return source;
}

describe('computeDataHealth — regular cadence', () => {
  it('calculates average Hz, median interval, and maximum gap', () => {
    const records: Uint8Array[] = [];
    for (let timestamp = 0; timestamp <= 1000; timestamp += 10) {
      records.push(gyroAt(timestamp));
    }

    const source = getSource(records, 'imu');
    expect(source.count).toBe(101);
    expect(source.firstTimestampMs).toBe(0);
    expect(source.lastTimestampMs).toBe(1000);
    expect(source.averageHz).toBeCloseTo(100, 6);
    expect(source.medianIntervalMs).toBe(10);
    expect(source.maximumGapMs).toBe(10);
    expect(source.largeGapThresholdMs).toBe(1000);
    expect(source.largeGapCount).toBe(0);
    expect(source.status).toBe('NORMAL');
  });

  it('uses each source cadence instead of an invented target frequency', () => {
    const records: Uint8Array[] = [];
    for (let timestamp = 0; timestamp <= 5000; timestamp += 500) {
      records.push(gpsAt(timestamp));
    }
    records.push(gpsAt(7000));

    const source = getSource(records, 'gps');
    expect(source.largeGapThresholdMs).toBe(2500);
    expect(source.maximumGapMs).toBe(2000);
    expect(source.largeGapCount).toBe(0);
    expect(source.status).toBe('NORMAL');
  });

  it('sorts tiny timestamp reversals before interval analysis', () => {
    const source = getSource([gyroAt(0), gyroAt(20), gyroAt(10), gyroAt(30)], 'imu');
    expect(source.medianIntervalMs).toBe(10);
    expect(source.maximumGapMs).toBe(10);
    expect(source.status).toBe('NORMAL');
  });

  it('accepts zero median dt for aggregate CAN records with shared timestamps', () => {
    const source = getSource(
      [
        canAt(0, 0x100),
        canAt(0, 0x200),
        canAt(100, 0x100),
        canAt(100, 0x200),
        canAt(200, 0x100),
        canAt(200, 0x200),
      ],
      'can',
    );

    expect(source.medianIntervalMs).toBe(0);
    expect(source.maximumGapMs).toBe(100);
    expect(source.largeGapCount).toBe(0);
    expect(source.status).toBe('NORMAL');
  });
});

describe('computeDataHealth — large gap heuristic', () => {
  it('detects a deliberately inserted large gap', () => {
    const records: Uint8Array[] = [];
    for (let timestamp = 0; timestamp <= 500; timestamp += 10) {
      records.push(gyroAt(timestamp));
    }
    records.push(gyroAt(2500));
    for (let timestamp = 2510; timestamp <= 3000; timestamp += 10) {
      records.push(gyroAt(timestamp));
    }

    const source = getSource(records, 'imu');
    expect(source.medianIntervalMs).toBe(10);
    expect(source.maximumGapMs).toBe(2000);
    expect(source.largeGapCount).toBe(1);
    expect(source.status).toBe('WARNING');
  });

  it('applies the same observed-cadence heuristic to event sources', () => {
    const source = getSource(
      [
        digitalRecord({ timestamp: 0, din: [0, 0, 0, 0] }),
        digitalRecord({ timestamp: 100, din: [1, 0, 0, 0] }),
        digitalRecord({ timestamp: 200, din: [0, 0, 0, 0] }),
        digitalRecord({ timestamp: 90_000, din: [0, 0, 0, 0] }),
      ],
      'digital',
    );

    expect(source.maximumGapMs).toBe(89_800);
    expect(source.largeGapThresholdMs).toBe(1000);
    expect(source.largeGapCount).toBe(1);
    expect(source.status).toBe('WARNING');
  });
});

describe('computeDataHealth — missing and insufficient timestamps', () => {
  it('marks a missing source without presenting zero as an observed rate', () => {
    const source = getSource([], 'gps');
    expect(source.count).toBe(0);
    expect(source.status).toBe('MISSING');
    expect(source.averageHz).toBeNull();
    expect(source.medianIntervalMs).toBeNull();
    expect(source.maximumGapMs).toBeNull();
    expect(source.largeGapCount).toBeNull();
  });

  it('marks one timestamp as N/A', () => {
    const source = getSource([gyroAt(500)], 'imu');
    expect(source.count).toBe(1);
    expect(source.firstTimestampMs).toBe(500);
    expect(source.lastTimestampMs).toBe(500);
    expect(source.status).toBe('N/A');
    expect(source.averageHz).toBeNull();
  });

  it('marks non-positive elapsed time as N/A', () => {
    const source = getSource([gyroAt(500), gyroAt(500)], 'imu');
    expect(source.status).toBe('N/A');
    expect(source.averageHz).toBeNull();
    expect(source.medianIntervalMs).toBeNull();
  });
});

describe('computeDataHealth — aggregation and integrity', () => {
  it('combines SYSTEM and USER_EVENT records into one source', () => {
    const source = getSource(
      [
        eventRecord({ timestamp: 100, type: LogType.System, message: 'READY' }),
        eventRecord({ timestamp: 1100, type: LogType.UserEvent, message: 'MARK' }),
      ],
      'events',
    );

    expect(source.count).toBe(2);
    expect(source.firstTimestampMs).toBe(100);
    expect(source.lastTimestampMs).toBe(1100);
    expect(source.averageHz).toBeNull();
    expect(source.medianIntervalMs).toBeNull();
    expect(source.maximumGapMs).toBeNull();
    expect(source.largeGapThresholdMs).toBeNull();
    expect(source.largeGapCount).toBeNull();
    expect(source.status).toBe('EVENT');
  });

  it('reuses parser integrity counters and counts present sources', () => {
    const corrupt = gyroAt(10);
    corrupt[20] ^= 0xff;
    const parsed = parseLog(buildLog([boot(), gyroAt(0), gyroAt(10), gpsAt(0), corrupt]));
    const health = computeDataHealth(parsed);

    expect(health.presentSources).toBe(2);
    expect(health.totalSources).toBe(6);
    expect(health.fileIntegrity).toEqual({
      totalSlots: 5,
      acceptedRecords: 4,
      rejectedRecords: 1,
      badMagic: 0,
      badChecksum: 1,
      unknownType: 0,
      trailingBytes: 0,
    });
  });
});
