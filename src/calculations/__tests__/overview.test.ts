import { describe, it, expect } from 'vitest';
import { parseLog } from '../../parser/parseLog';
import {
  computeMaxGpsSpeedKmh,
  computeMaxMotorRpm,
  computeMaxAccelG,
  computeBmsOverview,
} from '../overview';
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

// EZkontrol 0x180117EF: B6-B7 LE, rpm = raw*0.1 - 2000
const ezRpm = (ts: number, rpm: number) => {
  const raw = Math.round((rpm + 2000) * 10);
  return canRecord({
    timestamp: ts,
    id: 0x180117ef,
    extended: true,
    data: [0, 0, 0, 0, 0, 0, raw & 0xff, raw >> 8],
  });
};

// Daly 0x18904001: V = BE(B0,B1)*0.1, SOC = BE(B6,B7)*0.1
const daly90 = (ts: number, voltage: number, soc: number) => {
  const vRaw = Math.round(voltage * 10);
  const sRaw = Math.round(soc * 10);
  return canRecord({
    timestamp: ts,
    id: 0x18904001,
    extended: true,
    data: [vRaw >> 8, vRaw & 0xff, 0, 0, 0x75, 0x30, sRaw >> 8, sRaw & 0xff],
  });
};

describe('computeMaxGpsSpeedKmh', () => {
  it('returns the max speed in km/h', () => {
    const log = parseLog(buildLog([boot(), gps(100, 4523), gps(200, 6810), gps(300, 1200)]));
    expect(computeMaxGpsSpeedKmh(log.gps)).toBeCloseTo(68.1, 6);
  });

  it('returns null with no GPS records', () => {
    const log = parseLog(buildLog([boot()]));
    expect(computeMaxGpsSpeedKmh(log.gps)).toBeNull();
  });
});

describe('computeMaxMotorRpm', () => {
  it('returns the max decoded rpm from EZkontrol frames only', () => {
    const log = parseLog(
      buildLog([
        boot(),
        ezRpm(100, 1400),
        ezRpm(200, 4500),
        ezRpm(300, 900),
        daly90(400, 88, 60), // different ID — must be ignored
      ]),
    );
    expect(computeMaxMotorRpm(log.can)).toBeCloseTo(4500, 6);
  });

  it('ignores RTR and short frames', () => {
    const rtr = canRecord({
      timestamp: 100,
      id: 0x180117ef,
      extended: true,
      remote: true,
      data: [0, 0, 0, 0, 0, 0, 0xff, 0xff],
    });
    const short = canRecord({
      timestamp: 200,
      id: 0x180117ef,
      extended: true,
      data: [0, 0, 0, 0], // len 4 < 8
    });
    const log = parseLog(buildLog([boot(), rtr, short]));
    expect(computeMaxMotorRpm(log.can)).toBeNull();
  });

  it('returns null when the log has no EZkontrol frames', () => {
    const log = parseLog(buildLog([boot(), daly90(100, 88, 60)]));
    expect(computeMaxMotorRpm(log.can)).toBeNull();
  });
});

describe('computeMaxAccelG', () => {
  it('returns peak |longitudinal| and |lateral| in g (default axis map: X=종, Y=횡)', () => {
    const log = parseLog(
      buildLog([
        boot(),
        gyroRecord({ timestamp: 10, accel: [4096, -2048, 4096], gyro: [0, 0, 0] }), // 1.0g / 0.5g
        gyroRecord({ timestamp: 20, accel: [-4915, 1024, 4096], gyro: [0, 0, 0] }), // 1.2g / 0.25g
      ]),
    );
    const acc = computeMaxAccelG(log.gyro);
    expect(acc).not.toBeNull();
    expect(acc!.longitudinalG).toBeCloseTo(4915 / 4096, 6); // |−1.2g| wins
    expect(acc!.lateralG).toBeCloseTo(0.5, 6);
  });

  it('returns null with no IMU records', () => {
    const log = parseLog(buildLog([boot()]));
    expect(computeMaxAccelG(log.gyro)).toBeNull();
  });
});

describe('computeBmsOverview', () => {
  it('returns first/last SOC and the voltage range in file order', () => {
    const log = parseLog(
      buildLog([
        boot(),
        daly90(100, 95.0, 80.0),
        daly90(200, 91.4, 72.3),
        daly90(300, 88.1, 65.2),
        ezRpm(400, 1000), // different ID — ignored
      ]),
    );
    const bms = computeBmsOverview(log.can);
    expect(bms).not.toBeNull();
    expect(bms!.startSoc).toBeCloseTo(80.0, 6);
    expect(bms!.endSoc).toBeCloseTo(65.2, 6);
    expect(bms!.minVoltage).toBeCloseTo(88.1, 6);
    expect(bms!.maxVoltage).toBeCloseTo(95.0, 6);
    expect(bms!.frames).toBe(3);
  });

  it('returns null when the log has no Daly 0x90 frames (poll-response silence)', () => {
    const log = parseLog(buildLog([boot(), ezRpm(100, 1000)]));
    expect(computeBmsOverview(log.can)).toBeNull();
  });
});
