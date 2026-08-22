import { describe, it, expect } from 'vitest';
import { parseLog } from '../../parser/parseLog';
import { createGraphSeriesProvider, GRAPH_SIGNALS } from '../graphSeries';
import { bootRecord, canRecord, gpsRecord, gyroRecord, buildLog } from '../../parser/__tests__/fixtures';

const boot = () => bootRecord({ timestamp: 0, bootTime: 1755820800 });

const gps = (ts: number, speedRaw: number) =>
  gpsRecord({
    timestamp: ts,
    latitudeRaw: 372346587,
    longitudeRaw: 1270412345,
    latDir: 'N',
    lonDir: 'E',
    speedRaw,
    courseRaw: 0,
  });

// EZkontrol 0x180117EF: rpm = LE(B6,B7)*0.1 - 2000
const ezRpm = (ts: number, rpm: number) => {
  const raw = Math.round((rpm + 2000) * 10);
  return canRecord({
    timestamp: ts,
    id: 0x180117ef,
    extended: true,
    data: [0, 0, 0, 0, 0, 0, raw & 0xff, raw >> 8],
  });
};

// Daly 0x18904001: V = BE(B0,B1)*0.1, A = (BE(B4,B5)-30000)*0.1, SOC = BE(B6,B7)*0.1
const daly90 = (ts: number, voltage: number, currentA: number, soc: number) => {
  const vRaw = Math.round(voltage * 10);
  const iRaw = 30000 + Math.round(currentA * 10);
  const sRaw = Math.round(soc * 10);
  return canRecord({
    timestamp: ts,
    id: 0x18904001,
    extended: true,
    data: [vRaw >> 8, vRaw & 0xff, 0, 0, iRaw >> 8, iRaw & 0xff, sRaw >> 8, sRaw & 0xff],
  });
};

describe('createGraphSeriesProvider', () => {
  it('defines exactly the 10 documented signals', () => {
    expect(GRAPH_SIGNALS.map((d) => d.id)).toEqual([
      'gpsSpeed', 'motorRpm', 'accX', 'accY', 'accZ', 'yawRate', 'soc', 'voltage', 'current', 'power',
    ]);
  });

  it('GPS speed: elapsed seconds from run start, km/h values', () => {
    // run starts at BOOT ts=0, so elapsed == ts/1000
    const log = parseLog(buildLog([boot(), gps(1000, 4523), gps(2000, 6810)]));
    const p = createGraphSeriesProvider(log);
    const s = p.get('gpsSpeed');
    expect(s.available).toBe(true);
    expect(s.points).toEqual([
      [1, 45.23],
      [2, 68.1],
    ]);
    expect(p.durationSec).toBe(2);
  });

  it('Motor RPM: EZkontrol frames only, decoded with -2000 offset', () => {
    const log = parseLog(
      buildLog([boot(), ezRpm(500, 1400), daly90(600, 90, 0, 80), ezRpm(1500, 4500)]),
    );
    const s = createGraphSeriesProvider(log).get('motorRpm');
    expect(s.points.map((pt) => pt[1])).toEqual([1400, 4500]);
    expect(s.points.map((pt) => pt[0])).toEqual([0.5, 1.5]);
  });

  it('IMU: raw sensor axes in g, gyro Z in deg/s', () => {
    const log = parseLog(
      buildLog([boot(), gyroRecord({ timestamp: 100, accel: [4096, -2048, 1024], gyro: [0, 0, 655] })]),
    );
    const p = createGraphSeriesProvider(log);
    expect(p.get('accX').points[0][1]).toBeCloseTo(1.0, 9);
    expect(p.get('accY').points[0][1]).toBeCloseTo(-0.5, 9);
    expect(p.get('accZ').points[0][1]).toBeCloseTo(0.25, 9);
    expect(p.get('yawRate').points[0][1]).toBeCloseTo(10.0, 6);
  });

  it('BMS: voltage / current(signed) / SOC / power = V*I/1000 from the same frame', () => {
    const log = parseLog(buildLog([boot(), daly90(1000, 90.0, -12.5, 79.5)]));
    const p = createGraphSeriesProvider(log);
    expect(p.get('voltage').points[0][1]).toBeCloseTo(90.0, 6);
    expect(p.get('current').points[0][1]).toBeCloseTo(-12.5, 6);
    expect(p.get('soc').points[0][1]).toBeCloseTo(79.5, 6);
    expect(p.get('power').points[0][1]).toBeCloseTo((90.0 * -12.5) / 1000, 6); // -1.125 kW
  });

  it('missing source → available:false, empty points, no fake data', () => {
    const log = parseLog(buildLog([boot(), gyroRecord({ timestamp: 10, accel: [0, 0, 0], gyro: [0, 0, 0] })]));
    const p = createGraphSeriesProvider(log);
    expect(p.isAvailable('gpsSpeed')).toBe(false);
    expect(p.get('gpsSpeed')).toMatchObject({ available: false, points: [] });
    expect(p.isAvailable('soc')).toBe(false);
    expect(p.get('power')).toMatchObject({ available: false, points: [] });
    expect(p.isAvailable('accX')).toBe(true);
  });

  it('inserts a null break across a large timestamp gap (no interpolation)', () => {
    // 10ms cadence, then a 60s hole — the line must break, not bridge it
    const records = [boot()];
    for (let ts = 0; ts <= 200; ts += 10) {
      records.push(gyroRecord({ timestamp: ts, accel: [ts, 0, 0], gyro: [0, 0, 0] }));
    }
    records.push(gyroRecord({ timestamp: 60_000, accel: [999, 0, 0], gyro: [0, 0, 0] }));
    const s = createGraphSeriesProvider(parseLog(buildLog(records))).get('accX');
    const nullBreaks = s.points.filter((pt) => pt[1] === null);
    expect(nullBreaks).toHaveLength(1);
    // break sits between the last pre-gap point (0.2s) and the post-gap point (60s)
    expect(nullBreaks[0][0]).toBeGreaterThan(0.2);
    expect(nullBreaks[0][0]).toBeLessThan(60);
    expect(s.points.at(-1)![1]).toBeCloseTo(999 / 4096, 9);
  });

  it('caches series objects per provider', () => {
    const log = parseLog(buildLog([boot(), gps(1000, 100)]));
    const p = createGraphSeriesProvider(log);
    expect(p.get('gpsSpeed')).toBe(p.get('gpsSpeed'));
  });
});
