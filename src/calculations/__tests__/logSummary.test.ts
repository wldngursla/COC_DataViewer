import { describe, it, expect } from 'vitest';
import { parseLog } from '../../parser/parseLog';
import { LogType } from '../../parser/types';
import { computeTimeRange, countEventRecords } from '../logSummary';
import {
  bootRecord,
  gyroRecord,
  gpsRecord,
  eventRecord,
  buildLog,
} from '../../parser/__tests__/fixtures';

const BOOT_EPOCH = 1755820800;

describe('computeTimeRange', () => {
  it('spans min..max across all sources, tolerating micro-reversals', () => {
    const log = parseLog(
      buildLog([
        bootRecord({ timestamp: 3, bootTime: BOOT_EPOCH }),
        gyroRecord({ timestamp: 500, accel: [0, 0, 0], gyro: [0, 0, 0] }),
        // out-of-order record (allowed by the protocol) — must not break min/max
        gyroRecord({ timestamp: 480, accel: [0, 0, 0], gyro: [0, 0, 0] }),
        gpsRecord({
          timestamp: 61_500,
          latitudeRaw: 0,
          longitudeRaw: 0,
          latDir: 'N',
          lonDir: 'E',
          speedRaw: 0,
          courseRaw: 0,
        }),
        eventRecord({ timestamp: 61_000, type: LogType.System, message: 'X' }),
      ]),
    );
    const range = computeTimeRange(log);
    expect(range).not.toBeNull();
    expect(range!.firstMs).toBe(3);
    expect(range!.lastMs).toBe(61_500);
    expect(range!.durationMs).toBe(61_497);
  });

  it('works on a BOOT-only log (duration 0)', () => {
    const log = parseLog(buildLog([bootRecord({ timestamp: 7, bootTime: 0 })]));
    const range = computeTimeRange(log);
    expect(range).toEqual({ firstMs: 7, lastMs: 7, durationMs: 0 });
  });
});

describe('countEventRecords', () => {
  it('counts SYSTEM and USER_EVENT together', () => {
    const log = parseLog(
      buildLog([
        bootRecord({ timestamp: 0, bootTime: 0 }),
        eventRecord({ timestamp: 1, type: LogType.System, message: 'A' }),
        eventRecord({ timestamp: 2, type: LogType.UserEvent, message: 'B' }),
      ]),
    );
    expect(countEventRecords(log)).toBe(2);
  });
});
