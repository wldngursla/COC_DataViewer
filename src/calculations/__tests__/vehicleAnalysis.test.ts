import { describe, expect, it } from 'vitest';
import { CAN_ID_EZ_MSG1 } from '../../decoder/can';
import { parseLog } from '../../parser/parseLog';
import {
  bootRecord,
  buildLog,
  canRecord,
  gpsRecord,
  gyroRecord,
  wheelSpeedRecord,
} from '../../parser/__tests__/fixtures';
import { computeVehicleAnalysis } from '../vehicleAnalysis';

const boot = () => bootRecord({ timestamp: 0, bootTime: 1_755_820_800 });

function gps(timestamp: number, speedRaw: number): Uint8Array {
  return gpsRecord({
    timestamp,
    latitudeRaw: 3_723_465_870,
    longitudeRaw: 1_270_412_345,
    latDir: 'N',
    lonDir: 'E',
    speedRaw,
    courseRaw: 0,
  });
}

function ezRpm(timestamp: number, rpm: number): Uint8Array {
  const raw = Math.round(rpm + 32000);
  return canRecord({
    timestamp,
    id: CAN_ID_EZ_MSG1,
    extended: true,
    data: [0, 0, 0, 0, 0, 0, raw & 0xff, raw >> 8],
  });
}

function analyze(records: Uint8Array[]) {
  return computeVehicleAnalysis(parseLog(buildLog([boot(), ...records])));
}

describe('computeVehicleAnalysis', () => {
  it('returns maximum GPS speed in km/h', () => {
    const result = analyze([gps(100, 1_250), gps(200, 7_325), gps(300, 4_000)]);

    expect(result.maxGpsSpeedKmh).toBeCloseTo(73.25, 6);
  });

  it('returns maximum decoded motor RPM', () => {
    const result = analyze([ezRpm(100, 1_400), ezRpm(200, 4_500), ezRpm(300, 900)]);

    expect(result.maxMotorRpm).toBeCloseTo(4_500, 6);
  });

  it('returns absolute acceleration peaks for sensor X, Y, and Z', () => {
    const result = analyze([
      gyroRecord({ timestamp: 100, accel: [4_096, -2_048, 1_024], gyro: [0, 0, 0] }),
      gyroRecord({ timestamp: 200, accel: [-6_144, 3_072, -8_192], gyro: [0, 0, 0] }),
    ]);

    expect(result.imu?.peakAbsAccelXG).toBeCloseTo(1.5, 6);
    expect(result.imu?.peakAbsAccelYG).toBeCloseTo(0.75, 6);
    expect(result.imu?.peakAbsAccelZG).toBeCloseTo(2, 6);
  });

  it('returns the absolute Gyro Z peak in degrees per second', () => {
    const result = analyze([
      gyroRecord({ timestamp: 100, accel: [0, 0, 0], gyro: [0, 0, 655] }),
      gyroRecord({ timestamp: 200, accel: [0, 0, 0], gyro: [0, 0, -1_310] }),
    ]);

    expect(result.imu?.peakAbsGyroZDps).toBeCloseTo(20, 6);
  });

  it('returns N/A-ready null when GPS is missing', () => {
    expect(analyze([ezRpm(100, 1_000)]).maxGpsSpeedKmh).toBeNull();
  });

  it('returns N/A-ready null when EZkontrol CAN frames are missing', () => {
    expect(analyze([gps(100, 1_000)]).maxMotorRpm).toBeNull();
  });

  it('returns N/A-ready null when IMU records are missing', () => {
    expect(analyze([gps(100, 1_000)]).imu).toBeNull();
  });

  it('summarizes firmware-calculated wheel speeds when the feature bit is present', () => {
    const parsed = parseLog(buildLog([
      bootRecord({ timestamp: 0, bootTime: 1_755_820_800, featureFlags: 1 }),
      wheelSpeedRecord({ timestamp: 100, wheelSpeedKmh: [10, 20, 30, 40] }),
      wheelSpeedRecord({ timestamp: 200, wheelSpeedKmh: [50, 45, 35, 25] }),
    ]));
    const result = computeVehicleAnalysis(parsed);

    expect(result.wheels?.maximumKmh).toEqual([50, 45, 35, 40]);
    expect(result.wheels?.maximumFourWheelAverageKmh).toBe(38.75);
    expect(result.wheels?.samples).toBe(2);
  });

  it('does not interpret legacy DIGITAL GPIO levels as wheel speed', () => {
    expect(analyze([]).wheels).toBeNull();
  });
});
