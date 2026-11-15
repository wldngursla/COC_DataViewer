import type { BatteryAnalysisResult } from './batteryAnalysis';

export type RangeMethod = 'soc' | 'capacity';
export interface BatteryRangeEstimate {
  distanceKm: number | null;
  usableEnergyKwh: number | null;
  reason: string | null;
}
/** Scenario: spend 80 percentage points of full charge, keeping this run's efficiency. */
export function estimateBatteryRange(
  analysis: BatteryAnalysisResult,
  method: RangeMethod,
  fullEnergyKwh: number | null = null,
): BatteryRangeEstimate {
  const unavailable = (reason: string): BatteryRangeEstimate => ({ distanceKm: null, usableEnergyKwh: null, reason });
  const efficiency = analysis.efficiencyKmPerKwh;
  if (efficiency === null || !Number.isFinite(efficiency) || efficiency <= 0) return unavailable('주행거리와 방전 에너지가 있는 유효한 전비가 필요합니다.');
  let usableEnergyKwh: number;
  if (method === 'capacity') {
    if (fullEnergyKwh === null || !Number.isFinite(fullEnergyKwh) || fullEnergyKwh <= 0) return unavailable('SOC 100% 기준 배터리 에너지 용량(kWh)을 입력하세요.');
    usableEnergyKwh = fullEnergyKwh * 0.8;
  } else {
    const b = analysis.battery;
    if (!b || !Number.isFinite(b.startSocPercent + b.endSocPercent + b.socDropPercentagePoints + b.consumedEnergyKwh)
      || b.startSocPercent < 0 || b.startSocPercent > 100 || b.endSocPercent < 0 || b.endSocPercent > 100
      || b.socDropPercentagePoints < 1 || b.socDropPercentagePoints > 100 || b.consumedEnergyKwh <= 0) return unavailable('자동 환산에는 유효한 SOC 감소가 1%p 이상 필요합니다. 용량 직접 입력으로도 계산할 수 있습니다.');
    // A run-derived scenario, not a measurement of rated battery capacity.
    usableEnergyKwh = b.consumedEnergyKwh * 80 / b.socDropPercentagePoints;
  }
  const distanceKm = efficiency * usableEnergyKwh;
  if (!Number.isFinite(distanceKm) || !Number.isFinite(usableEnergyKwh)) return unavailable('입력값이 계산 가능한 범위를 벗어났습니다.');
  return { distanceKm, usableEnergyKwh, reason: null };
}
