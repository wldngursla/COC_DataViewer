import { describe, expect, it } from 'vitest';
import { parseLog } from '../../parser/parseLog';
import { bootRecord, buildLog, gyroRecord, eventRecord } from '../../parser/__tests__/fixtures';
import { LogType } from '../../parser/types';
import { computeGForce, selectGForce } from '../gForce';
import { rearWheelDifference } from '../rearWheelDifference';
import { smoothTrack } from '../smoothTrack';
import type { TrackAnalysis } from '../trackAnalysis';

describe('G-force display', () => {
  it('converts IMU axes to G, smooths a transient spike, and expires gaps', () => {
    const records = [bootRecord({ timestamp: 0, bootTime: 0 })];
    for (let i = 0; i < 100; i++) records.push(gyroRecord({ timestamp: i * 10, accel: [i === 50 ? 30000 : 4096, 0, 4096], gyro: [0, 0, 0] }));
    const data = computeGForce(parseLog(buildLog(records)));
    expect(data.maxG).toBeCloseTo(1);
    expect(data.maxX).toBeCloseTo(1);
    expect(selectGForce(data.samples, 550)?.magnitude).toBeCloseTo(1);
    expect(selectGForce(data.samples, 2000)).toBeNull();
  });
  it('does not count samples during a reported sensor failure', () => {
    const log = parseLog(buildLog([
      bootRecord({ timestamp: 0, bootTime: 0 }),
      eventRecord({ timestamp: 1, type: LogType.System, message: 'SNS:GYR:ERR' }),
      gyroRecord({ timestamp: 10, accel: [30000, 30000, 0], gyro: [0, 0, 0] }),
      eventRecord({ timestamp: 20, type: LogType.System, message: 'SNS:GYR:OK' }),
      gyroRecord({ timestamp: 30, accel: [0, 0, 4096], gyro: [0, 0, 0] }),
    ]));
    expect(computeGForce(log).maxG).toBe(0);
  });
});
describe('rear wheel delta', () => {
  it('compares the same peak bins and preserves missing-side gaps', () => {
    expect(rearWheelDifference([[0, 10], [0.1, 30], [1, 20]], [[0, 20], [0.2, 40], [0.6, 50]])).toEqual([[0.25, 10], [0.75, null], [1.25, null]]);
  });
});
describe('GPS map smoothing', () => {
  it('suppresses an isolated location jump while preserving timestamps and source indices', () => {
    const points = Array.from({ length: 21 }, (_, i) => ({ sourceIndex: i, timestampMs: i * 100, elapsedMs: i * 100, latitudeDeg: i === 10 ? 38 : 37, longitudeDeg: 127, speedKmh: 0 }));
    const track: TrackAnalysis = { points, segments: points.slice(1).map((_, i) => ({ startPointIndex: i, endPointIndex: i + 1, speedKmh: 0 })), startPoint: points[0], endPoint: points[20], minimumSpeedKmh: 0, maximumSpeedKmh: 0 };
    const result = smoothTrack(track);
    expect(result.points[10].latitudeDeg).toBe(37);
    expect(result.points[10].sourceIndex).toBe(10);
    expect(track.points[10].latitudeDeg).toBe(38);
  });
});
