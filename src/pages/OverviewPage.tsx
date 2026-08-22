/**
 * Overview — 첫 분석 화면. 값 계산은 전부 src/calculations/overview.ts에 있고,
 * 이 페이지는 포맷과 배치만 담당한다. 데이터가 없는 항목은 추측 없이 N/A.
 */

import type { LoadedRun } from '../state/loadedRun';
import { computeTimeRange } from '../calculations/logSummary';
import {
  computeMaxGpsSpeedKmh,
  computeMaxMotorRpm,
  computeMaxAccelG,
  computeBmsOverview,
} from '../calculations/overview';
import { formatBytes, formatCount, formatDuration, formatEpochSec } from '../ui/format';
import { StatTile } from '../components/StatTile';

const NA = 'N/A';

interface OverviewPageProps {
  run: LoadedRun;
}

export function OverviewPage({ run }: OverviewPageProps) {
  const { result } = run;
  const range = computeTimeRange(result);
  const maxSpeed = computeMaxGpsSpeedKmh(result.gps);
  const maxRpm = computeMaxMotorRpm(result.can);
  const maxAccel = computeMaxAccelG(result.gyro);
  const bms = computeBmsOverview(result.can);

  return (
    <main className="page">
      <section className="summary-section">
        <h2>Run</h2>
        <div className="stat-grid">
          <StatTile
            label="Run duration"
            value={range !== null ? formatDuration(range.durationMs) : NA}
            hint={range !== null ? `${formatCount(range.durationMs)} ms` : undefined}
          />
          <StatTile
            label="Total records"
            value={formatCount(result.stats.accepted)}
            hint="checksum 통과 레코드"
          />
        </div>
      </section>

      <section className="summary-section">
        <h2>Performance</h2>
        <div className="stat-grid">
          <StatTile
            label="Max GPS speed"
            value={maxSpeed !== null ? `${maxSpeed.toFixed(1)} km/h` : NA}
            hint={maxSpeed === null ? 'GPS 레코드 없음' : undefined}
          />
          <StatTile
            label="Max motor RPM"
            value={maxRpm !== null ? `${maxRpm.toFixed(0)} rpm` : NA}
            hint={maxRpm !== null ? 'EZkontrol 0x180117EF' : '해당 CAN 프레임 없음'}
          />
          <StatTile
            label="Max longitudinal acc"
            value={maxAccel !== null ? `${maxAccel.longitudinalG.toFixed(2)} g` : NA}
            hint={maxAccel !== null ? 'IMU 축 매핑 가정(X=종) 기준' : 'IMU 레코드 없음'}
          />
          <StatTile
            label="Max lateral acc"
            value={maxAccel !== null ? `${maxAccel.lateralG.toFixed(2)} g` : NA}
            hint={maxAccel !== null ? 'IMU 축 매핑 가정(Y=횡) 기준' : 'IMU 레코드 없음'}
          />
        </div>
      </section>

      <section className="summary-section">
        <h2>Battery</h2>
        <div className="stat-grid">
          <StatTile
            label="Start SOC"
            value={bms !== null ? `${bms.startSoc.toFixed(1)} %` : NA}
            hint={bms === null ? 'Daly BMS(0x18904001) 프레임 없음' : undefined}
          />
          <StatTile
            label="End SOC"
            value={bms !== null ? `${bms.endSoc.toFixed(1)} %` : NA}
            hint={bms === null ? 'Daly BMS(0x18904001) 프레임 없음' : undefined}
          />
          <StatTile
            label="Battery voltage range"
            value={
              bms !== null ? `${bms.minVoltage.toFixed(1)} – ${bms.maxVoltage.toFixed(1)} V` : NA
            }
            hint={bms !== null ? `${formatCount(bms.frames)} frames` : 'Daly BMS(0x18904001) 프레임 없음'}
          />
        </div>
      </section>

      <section className="summary-section">
        <h2>Run metadata</h2>
        <div className="stat-grid">
          <StatTile label="Filename" value={run.fileName} />
          <StatTile label="File size" value={formatBytes(run.fileSize)} />
          <StatTile
            label="Protocol version"
            value={result.boot !== null ? String(result.boot.protocolVersion) : NA}
            hint={result.boot === null ? 'BOOT record 없음' : undefined}
          />
          <StatTile
            label="Boot time"
            value={result.bootTimeEpochSec !== null ? formatEpochSec(result.bootTimeEpochSec) : NA}
            hint={result.bootTimeEpochSec === null ? 'GPS fix 없음 — 절대 시각 미확정' : undefined}
          />
        </div>
      </section>
    </main>
  );
}
