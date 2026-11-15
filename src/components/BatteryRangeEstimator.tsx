import { useId, useState } from 'react';
import type { BatteryAnalysisResult } from '../calculations/batteryAnalysis';
import { estimateBatteryRange, type RangeMethod } from '../calculations/batteryRange';
import { StatTile } from './StatTile';
import './BatteryRangeEstimator.css';

const format = (v: number | null, digits: number, unit: string) => v !== null && Number.isFinite(v) ? `${v.toFixed(digits)} ${unit}` : 'N/A';
export function BatteryRangeEstimator({ analysis }: { analysis: BatteryAnalysisResult }) {
  const [method, setMethod] = useState<RangeMethod>('soc');
  const [capacity, setCapacity] = useState('');
  const id = useId();
  const estimate = estimateBatteryRange(analysis, method, capacity.trim() ? Number(capacity) : null);
  return <section className="summary-section battery-range" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>예상 주행거리 · SOC 100% → 20%</h2>
    <p>현재 업로드된 주행 로그의 평균 전비로 배터리 80%를 사용한다고 가정한 환산입니다.</p>
    <div className="battery-range-tabs" role="tablist" aria-label="주행거리 환산 방법">
      {([['soc', '로그 SOC 기준'], ['capacity', '용량 직접 입력']] as const).map(([value, label]) => <button type="button" role="tab" id={`${id}-${value}`} aria-selected={method === value} aria-controls={`${id}-panel`} key={value} onClick={() => setMethod(value)}>{label}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${method}`}>
      {method === 'capacity' && <label className="battery-range-input">SOC 100% 기준 배터리 에너지 용량 (kWh)<input type="number" min="0" step="any" inputMode="decimal" placeholder="배터리 용량 입력" value={capacity} onChange={(event) => setCapacity(event.target.value)} /></label>}
      <div className="stat-grid battery-kpi-grid">
        <StatTile label="100% → 20% 예상 주행거리" value={format(estimate.distanceKm, 1, 'km')} hint={estimate.reason ?? '현재 로그의 주행 조건이 동일하게 유지될 때'} />
        <StatTile label="계산에 사용한 평균 전비" value={format(analysis.efficiencyKmPerKwh, 2, 'km/kWh')} hint="위 Energy performance의 전비를 그대로 사용" />
        <StatTile label={method === 'soc' ? '80%p 사용 에너지 환산' : '사용 가능 에너지 · 용량의 80%'} value={format(estimate.usableEnergyKwh, 3, 'kWh')} hint={method === 'soc' ? '로그 방전 에너지 × 80 ÷ SOC 감소(%p)' : '입력한 100% 에너지 용량 × 0.8'} />
        <StatTile label="기록된 SOC 감소" value={format(analysis.battery?.socDropPercentagePoints ?? null, 1, '%p')} hint="자동 환산은 SOC 감소 1%p 이상일 때 제공" />
      </div>
      <p className="battery-note">{method === 'soc' ? '계산식: 기록 주행거리 × 80 ÷ 기록 SOC 감소(%p). SOC와 에너지의 비례 관계를 가정한 단순 외삽이며, 배터리 정격 용량을 측정한 값은 아닙니다.' : '계산식: 현재 전비(km/kWh) × 입력한 배터리 에너지 용량(kWh) × 0.8.'} 현재 SOC에서 남은 거리가 아니라 100%에서 20%까지의 총 주행거리 예상입니다.</p>
      <p className="battery-note">GPS 오차, GPS·BMS 기록 범위 차이, SOC 추정 오차, 회생·충전, 온도·속도·노면 변화에 따라 실제 거리와 달라질 수 있습니다. 짧은 로그나 작은 SOC 감소의 환산은 오차가 커집니다.</p>
    </div>
  </section>;
}
