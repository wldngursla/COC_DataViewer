import { describe, expect, it } from 'vitest';
import { computeBatteryAnalysis } from '../batteryAnalysis';
import { parseLog } from '../../parser/parseLog';
import {
  bootRecord,
  buildLog,
  canRecord,
  gpsRecord,
} from '../../parser/__tests__/fixtures';

const boot = () => bootRecord({ timestamp: 0, bootTime: 1_755_820_800 });

function daly90(
  timestamp: number,
  voltageV: number,
  currentA: number,
  socPercent: number,
): Uint8Array {
  const voltageRaw = Math.round(voltageV * 10);
  const currentRaw = Math.round(currentA * 10 + 30_000);
  const socRaw = Math.round(socPercent * 10);
  return canRecord({
    timestamp,
    id: 0x18904001,
    extended: true,
    data: [
      voltageRaw >> 8,
      voltageRaw & 0xff,
      0,
      0,
      currentRaw >> 8,
      currentRaw & 0xff,
      socRaw >> 8,
      socRaw & 0xff,
    ],
  });
}

function toNmeaRaw(decimalDegrees: number): number {
  const absolute = Math.abs(decimalDegrees);
  const degrees = Math.floor(absolute);
  const minutes = (absolute - degrees) * 60;
  return Math.round((degrees * 100 + minutes) * 1e5);
}

function gpsPoint(timestamp: number, latitude: number, longitude: number): Uint8Array {
  return gpsRecord({
    timestamp,
    latitudeRaw: toNmeaRaw(latitude),
    longitudeRaw: toNmeaRaw(longitude),
    latDir: latitude < 0 ? 'S' : 'N',
    lonDir: longitude < 0 ? 'W' : 'E',
    speedRaw: 0,
    courseRaw: 0,
  });
}

function analyze(records: Uint8Array[]) {
  return computeBatteryAnalysis(parseLog(buildLog([boot(), ...records])));
}

function requireBattery(records: Uint8Array[]) {
  const result = analyze(records);
  if (result.battery === null) throw new Error('Expected Daly BMS metrics');
  return result.battery;
}

describe('computeBatteryAnalysis — battery state', () => {
  it('calculates start SOC, end SOC, and SOC drop in chronological order', () => {
    const battery = requireBattery([
      daly90(2000, 90, -10, 72.5),
      daly90(0, 92, -10, 80),
    ]);

    expect(battery.startSocPercent).toBeCloseTo(80, 6);
    expect(battery.endSocPercent).toBeCloseTo(72.5, 6);
    expect(battery.socDropPercentagePoints).toBeCloseTo(7.5, 6);
  });

  it('calculates minimum, maximum, and arithmetic-average voltage', () => {
    const battery = requireBattery([
      daly90(0, 90, 0, 80),
      daly90(1000, 100, 0, 80),
      daly90(2000, 110, 0, 80),
    ]);

    expect(battery.minimumVoltageV).toBeCloseTo(90, 6);
    expect(battery.maximumVoltageV).toBeCloseTo(110, 6);
    expect(battery.averageVoltageV).toBeCloseTo(100, 6);
  });

  it('reports positive peak discharge current and power magnitudes', () => {
    const battery = requireBattery([
      daly90(0, 100, -10, 80),
      daly90(1000, 80, -20, 80),
      daly90(2000, 100, 30, 80),
    ]);

    expect(battery.peakDischargeCurrentA).toBeCloseTo(20, 6);
    expect(battery.peakDischargePowerKw).toBeCloseTo(1.6, 6);
  });
});

describe('computeBatteryAnalysis — discharge-only energy', () => {
  it('integrates constant discharge power over actual elapsed time', () => {
    const battery = requireBattery([
      daly90(0, 100, -10, 80),
      daly90(3_600_000, 100, -10, 70),
    ]);

    expect(battery.consumedEnergyKwh).toBeCloseTo(1, 9);
  });

  it('uses trapezoidal integration with irregular timestamp intervals', () => {
    const battery = requireBattery([
      daly90(0, 100, -10, 80),
      daly90(600_000, 100, -20, 78),
      daly90(1_800_000, 100, -10, 75),
    ]);

    expect(battery.consumedEnergyKwh).toBeCloseTo(0.75, 9);
  });

  it('excludes charging intervals from consumed energy', () => {
    const battery = requireBattery([
      daly90(0, 100, -10, 80),
      daly90(1_800_000, 100, -10, 75),
      daly90(1_800_000, 100, 20, 75),
      daly90(3_600_000, 100, 20, 78),
    ]);

    expect(battery.consumedEnergyKwh).toBeCloseTo(0.5, 9);
  });

  it('sorts timestamp reversals and skips duplicate-time intervals safely', () => {
    const battery = requireBattery([
      daly90(0, 100, -10, 80),
      daly90(3000, 100, -10, 79),
      daly90(1000, 100, -10, 79.8),
      daly90(2000, 100, -10, 79.4),
      daly90(2000, 100, -10, 79.4),
    ]);

    expect(battery.consumedEnergyKwh).toBeCloseTo(3 / 3600, 9);
  });
});

describe('computeBatteryAnalysis — distance and efficiency', () => {
  it('accumulates consecutive GPS coordinates with haversine distance', () => {
    const result = analyze([gpsPoint(0, 37, 127), gpsPoint(1000, 38, 127)]);

    expect(result.totalDistanceKm).not.toBeNull();
    expect(result.totalDistanceKm!).toBeGreaterThan(110);
    expect(result.totalDistanceKm!).toBeLessThan(112.5);
  });

  it('calculates distance divided by consumed energy', () => {
    const result = analyze([
      daly90(0, 100, -10, 80),
      daly90(3_600_000, 100, -10, 70),
      gpsPoint(0, 37, 127),
      gpsPoint(3_600_000, 38, 127),
    ]);

    expect(result.battery?.consumedEnergyKwh).toBeCloseTo(1, 9);
    expect(result.efficiencyKmPerKwh).toBeCloseTo(result.totalDistanceKm!, 9);
  });
});

describe('computeBatteryAnalysis — unavailable KPI handling', () => {
  it('returns no battery KPIs or efficiency when Daly BMS frames are missing', () => {
    const result = analyze([gpsPoint(0, 37, 127), gpsPoint(1000, 38, 127)]);

    expect(result.battery).toBeNull();
    expect(result.totalDistanceKm).not.toBeNull();
    expect(result.efficiencyKmPerKwh).toBeNull();
  });

  it('returns no distance or efficiency when GPS records are missing', () => {
    const result = analyze([
      daly90(0, 100, -10, 80),
      daly90(3_600_000, 100, -10, 70),
    ]);

    expect(result.battery).not.toBeNull();
    expect(result.totalDistanceKm).toBeNull();
    expect(result.efficiencyKmPerKwh).toBeNull();
  });

  it('returns no efficiency when consumed energy is zero', () => {
    const result = analyze([
      daly90(0, 100, 0, 80),
      daly90(1000, 100, 0, 80),
      gpsPoint(0, 37, 127),
      gpsPoint(1000, 38, 127),
    ]);

    expect(result.battery?.consumedEnergyKwh).toBe(0);
    expect(result.efficiencyKmPerKwh).toBeNull();
  });
});
