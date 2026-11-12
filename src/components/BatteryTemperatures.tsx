import { useMemo } from 'react';
import type { ParsedLog } from '../parser/types';
import { computeBatteryTemperatures } from '../calculations/batteryTemperature';
import { StatTile } from './StatTile';

export function BatteryTemperatures({ result }: { result: ParsedLog }) {
  const series = useMemo(() => computeBatteryTemperatures(result.can), [result]);
  return <section className="summary-section">
    <h2>배터리 센서별 온도</h2>
    <div className="stat-grid battery-detail-grid">
      {series.map((samples, index) => samples.length === 0 ? null : <StatTile
        key={index} label={`Battery Temperature ${index + 1}`}
        value={`${samples[samples.length - 1].temperatureC} °C`}
        hint={`최종값 · 최저 ${samples.reduce((v, s) => Math.min(v, s.temperatureC), Infinity)} / 최고 ${samples.reduce((v, s) => Math.max(v, s.temperatureC), -Infinity)} °C · ${samples.length} samples`}
      />)}
    </div>
    {!series.some((samples) => samples.length > 0) && <p>N/A · 배터리 온도 프레임 없음</p>}
    <p className="battery-note">Daly 0x18964001 · 온도 = 저장값 − 40 °C · Graphs에서 센서별 시간 변화를 선택할 수 있습니다.</p>
  </section>;
}
