import { describe, it, expect } from 'vitest';
import { estimateBatteryRange } from '../batteryRange';
import type { BatteryAnalysisResult } from '../batteryAnalysis';

const run = (): BatteryAnalysisResult => ({ totalDistanceKm: 10, efficiencyKmPerKwh: 5, battery: { bmsFrames: 10, startSocPercent: 90, endSocPercent: 80, socDropPercentagePoints: 10, consumedEnergyKwh: 2, minimumVoltageV: 100, maximumVoltageV: 100, averageVoltageV: 100, peakDischargeCurrentA: 10, peakDischargePowerKw: 1 } });
describe('100% to 20% battery range scenario', () => {
  it('extrapolates observed efficiency and SOC usage without assuming a pack capacity', () => {
    expect(estimateBatteryRange(run(), 'soc')).toEqual({ distanceKm: 80, usableEnergyKwh: 16, reason: null });
  });
  it('uses 80% of manually confirmed full energy capacity', () => {
    expect(estimateBatteryRange(run(), 'capacity', 10)).toEqual({ distanceKm: 40, usableEnergyKwh: 8, reason: null });
  });
  it('withholds unsupported estimates for missing efficiency or missing/invalid input', () => {
    expect(estimateBatteryRange({ ...run(), efficiencyKmPerKwh: null }, 'soc').distanceKm).toBeNull();
    expect(estimateBatteryRange({ ...run(), efficiencyKmPerKwh: 0 }, 'capacity', 10).distanceKm).toBeNull();
    for (const capacity of [null, 0, -1, NaN, Infinity]) expect(estimateBatteryRange(run(), 'capacity', capacity).distanceKm).toBeNull();
  });
  it('rejects absent, increasing, unchanged, tiny or invalid SOC readings', () => {
    expect(estimateBatteryRange({ ...run(), battery: null }, 'soc').distanceKm).toBeNull();
    for (const drop of [-2, 0, 0.1, 0.9, NaN]) {
      const a = run(); a.battery!.socDropPercentagePoints = drop;
      expect(estimateBatteryRange(a, 'soc').distanceKm).toBeNull();
    }
    const a = run(); a.battery!.startSocPercent = 150;
    expect(estimateBatteryRange(a, 'soc').distanceKm).toBeNull();
  });
  it('can use manual capacity when SOC is absent without mutating analysis', () => {
    const a = { ...run(), battery: null }; const snapshot = JSON.stringify(a);
    expect(estimateBatteryRange(a, 'capacity', 4).distanceKm).toBe(16);
    expect(JSON.stringify(a)).toBe(snapshot);
  });
});
