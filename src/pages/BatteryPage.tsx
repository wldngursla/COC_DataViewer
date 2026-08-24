/**
 * Battery — run-level energy and efficiency KPIs. All calculations are kept in
 * batteryAnalysis.ts; this page only formats and arranges the result.
 */

import { useMemo } from 'react';
import { computeBatteryAnalysis } from '../calculations/batteryAnalysis';
import { StatTile } from '../components/StatTile';
import type { LoadedRun } from '../state/loadedRun';
import { formatCount } from '../ui/format';

const NA = 'N/A';

function formatMetric(value: number | null, fractionDigits: number, unit: string): string {
  return value !== null && Number.isFinite(value)
    ? `${value.toFixed(fractionDigits)} ${unit}`
    : NA;
}

interface BatteryPageProps {
  run: LoadedRun;
}

export function BatteryPage({ run }: BatteryPageProps) {
  const analysis = useMemo(() => computeBatteryAnalysis(run.result), [run.result]);
  const { battery, totalDistanceKm, efficiencyKmPerKwh } = analysis;
  const bmsMissingHint = battery === null ? 'Daly BMS 0x18904001 frame 없음' : undefined;

  let efficiencyHint = 'GPS distance / discharge-only consumed energy';
  if (battery === null) efficiencyHint = 'Daly BMS 0x18904001 frame 없음';
  else if (totalDistanceKm === null) efficiencyHint = 'GPS record 없음';
  else if (battery.consumedEnergyKwh <= 0) efficiencyHint = '방전 소비 에너지 없음';

  return (
    <main className="page battery-page">
      <header className="battery-header">
        <div>
          <h1>Battery</h1>
          <p>주행시험의 방전 에너지, GPS 거리, 전비를 정량 평가합니다.</p>
        </div>
        <span className="file-name">{run.fileName}</span>
      </header>

      <section className="summary-section">
        <h2>Energy performance</h2>
        <div className="stat-grid battery-kpi-grid">
          <StatTile
            label="Consumed energy"
            value={formatMetric(battery?.consumedEnergyKwh ?? null, 3, 'kWh')}
            hint={bmsMissingHint ?? '방전 전력만 timestamp 기반 사다리꼴 적분'}
          />
          <StatTile
            label="Total distance"
            value={formatMetric(totalDistanceKm, 3, 'km')}
            hint={totalDistanceKm === null ? 'GPS record 없음' : '연속 GPS 좌표 haversine 누적'}
          />
          <StatTile
            label="Efficiency"
            value={formatMetric(efficiencyKmPerKwh, 2, 'km/kWh')}
            hint={efficiencyHint}
          />
          <StatTile
            label="SOC drop"
            value={formatMetric(battery?.socDropPercentagePoints ?? null, 1, '%p')}
            hint={bmsMissingHint ?? 'Start SOC − End SOC'}
          />
        </div>
      </section>

      <section className="summary-section">
        <h2>State of charge</h2>
        <div className="stat-grid battery-detail-grid">
          <StatTile
            label="Start SOC"
            value={formatMetric(battery?.startSocPercent ?? null, 1, '%')}
            hint={bmsMissingHint}
          />
          <StatTile
            label="End SOC"
            value={formatMetric(battery?.endSocPercent ?? null, 1, '%')}
            hint={
              bmsMissingHint ??
              `${formatCount(battery?.bmsFrames ?? 0)} Daly BMS frames`
            }
          />
        </div>
      </section>

      <section className="summary-section">
        <h2>Electrical detail</h2>
        <div className="stat-grid battery-detail-grid">
          <StatTile
            label="Minimum voltage"
            value={formatMetric(battery?.minimumVoltageV ?? null, 1, 'V')}
            hint={bmsMissingHint}
          />
          <StatTile
            label="Average voltage"
            value={formatMetric(battery?.averageVoltageV ?? null, 1, 'V')}
            hint={bmsMissingHint ?? 'Daly BMS frame arithmetic mean'}
          />
          <StatTile
            label="Maximum voltage"
            value={formatMetric(battery?.maximumVoltageV ?? null, 1, 'V')}
            hint={bmsMissingHint}
          />
          <StatTile
            label="Peak discharge current"
            value={formatMetric(battery?.peakDischargeCurrentA ?? null, 1, 'A')}
            hint={bmsMissingHint ?? '방전 전류(음수)의 최대 크기'}
          />
          <StatTile
            label="Peak discharge power"
            value={formatMetric(battery?.peakDischargePowerKw ?? null, 2, 'kW')}
            hint={bmsMissingHint ?? 'max(−V × I, 0)'}
          />
        </div>
        <p className="battery-note">
          Daly 전류 부호는 문서 기준 방전 − / 충전 +입니다. Consumed energy는 충전·회생
          구간을 제외한 <code>max(−V × I, 0)</code>만 적분하며 SOH나 고장을 판단하지 않습니다.
        </p>
      </section>
    </main>
  );
}
