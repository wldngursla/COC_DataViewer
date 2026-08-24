/**
 * Vehicle Analysis summarizes measurements that are currently supported and
 * keeps blocked wheel/steering work visible without inventing calibration.
 */

import { useCallback, useMemo } from 'react';
import { computeVehicleAnalysis } from '../calculations/vehicleAnalysis';
import {
  computeTrackAnalysis,
  createSpatialTelemetrySelector,
} from '../calculations/trackAnalysis';
import { StatTile } from '../components/StatTile';
import { TrackMap } from '../components/TrackMap';
import type { LoadedRun } from '../state/loadedRun';
import { formatElapsedTime } from '../ui/format';

const NA = 'N/A';

function formatMetric(value: number | null, fractionDigits: number, unit: string): string {
  return value !== null && Number.isFinite(value)
    ? `${value.toFixed(fractionDigits)} ${unit}`
    : NA;
}

interface VehiclePageProps {
  run: LoadedRun;
  selectedTimestampMs: number | null;
  onSelectTimestamp: (timestampMs: number) => void;
  onViewInGraphs: (timestampMs: number) => void;
}

export function VehiclePage({
  run,
  selectedTimestampMs,
  onSelectTimestamp,
  onViewInGraphs,
}: VehiclePageProps) {
  const analysis = useMemo(() => computeVehicleAnalysis(run.result), [run.result]);
  const track = useMemo(() => computeTrackAnalysis(run.result), [run.result]);
  const telemetrySelector = useMemo(
    () => createSpatialTelemetrySelector(run.result, track),
    [run.result, track],
  );
  const selectedPointIndex = useMemo(() => {
    if (track.points.length === 0 || selectedTimestampMs === null) return 0;
    let nearestIndex = 0;
    let nearestDeltaMs = Infinity;
    for (let index = 0; index < track.points.length; index++) {
      const deltaMs = Math.abs(track.points[index].timestampMs - selectedTimestampMs);
      if (deltaMs < nearestDeltaMs) {
        nearestDeltaMs = deltaMs;
        nearestIndex = index;
      }
    }
    return nearestIndex;
  }, [track, selectedTimestampMs]);
  const selectedTelemetry = useMemo(() => {
    const point = track.points[selectedPointIndex];
    return point === undefined ? null : telemetrySelector.select(point);
  }, [track, selectedPointIndex, telemetrySelector]);
  const handleSelectPoint = useCallback(
    (pointIndex: number) => {
      const point = track.points[pointIndex];
      if (point !== undefined) onSelectTimestamp(point.timestampMs);
    },
    [track, onSelectTimestamp],
  );
  const gpsMissing = analysis.maxGpsSpeedKmh === null;
  const motorMissing = analysis.maxMotorRpm === null;
  const imuMissing = analysis.imu === null;

  return (
    <main className="page vehicle-page">
      <header className="vehicle-header">
        <div>
          <h1>Vehicle Analysis</h1>
          <p>현재 검증된 신호로 주행 중 차량 움직임의 핵심 측정치를 요약합니다.</p>
        </div>
        <span className="file-name">{run.fileName}</span>
      </header>

      <section className="summary-section track-section">
        <div className="track-section-heading">
          <div>
            <h2>GPS Track Map</h2>
            <span>Route position → nearest timestamp telemetry · no interpolation</span>
          </div>
          {track.points.length > 0 && (
            <span className="track-sample-count">{track.points.length.toLocaleString('en-US')} GPS samples</span>
          )}
        </div>
        {track.points.length === 0 ? (
          <div className="track-empty">
            <strong>N/A</strong>
            <span>GPS record가 없어 route와 spatial telemetry를 표시할 수 없습니다.</span>
          </div>
        ) : (
          <div className="track-layout">
            <TrackMap
              track={track}
              selectedPointIndex={selectedPointIndex}
              onSelectPoint={handleSelectPoint}
            />
            <aside className="selected-point-panel" aria-label="Selected track point telemetry">
              <div className="selected-point-heading">
                <h3>Selected Point</h3>
                <span>nearest samples</span>
              </div>
              <dl className="selected-point-values">
                <div><dt>Elapsed time</dt><dd>{formatElapsedTime(selectedTelemetry!.point.elapsedMs)}</dd></div>
                <div><dt>Latitude</dt><dd>{selectedTelemetry!.point.latitudeDeg.toFixed(6)}°</dd></div>
                <div><dt>Longitude</dt><dd>{selectedTelemetry!.point.longitudeDeg.toFixed(6)}°</dd></div>
                <div><dt>GPS Speed</dt><dd>{formatMetric(selectedTelemetry!.point.speedKmh, 1, 'km/h')}</dd></div>
                <div><dt>Motor RPM</dt><dd>{formatMetric(selectedTelemetry!.motorRpm, 0, 'rpm')}</dd></div>
                <div><dt>Acceleration X</dt><dd>{formatMetric(selectedTelemetry!.accelerationXG, 2, 'g')}</dd></div>
                <div><dt>Acceleration Y</dt><dd>{formatMetric(selectedTelemetry!.accelerationYG, 2, 'g')}</dd></div>
                <div><dt>Acceleration Z</dt><dd>{formatMetric(selectedTelemetry!.accelerationZG, 2, 'g')}</dd></div>
                <div><dt>Gyro Z</dt><dd>{formatMetric(selectedTelemetry!.gyroZDps, 1, 'deg/s')}</dd></div>
                <div><dt>Battery Current</dt><dd>{formatMetric(selectedTelemetry!.batteryCurrentA, 1, 'A')}</dd></div>
                <div><dt>Battery Power</dt><dd>{formatMetric(selectedTelemetry!.batteryPowerKw, 2, 'kW')}</dd></div>
              </dl>
              <p className="selected-point-note">
                IMU sensor axis 기준 · vehicle coordinate mapping 미확정
              </p>
              <button
                type="button"
                className="btn-view-graphs"
                onClick={() => onViewInGraphs(selectedTelemetry!.point.timestampMs)}
              >
                View in Graphs →
              </button>
            </aside>
          </div>
        )}
        <p className="vehicle-note">
          지도 tile은 OpenStreetMap 배경만 요청합니다. 원본 log와 decoded CAN/IMU/BMS telemetry는
          외부로 전송하지 않습니다.
        </p>
      </section>

      <section className="summary-section">
        <h2>Measured performance</h2>
        <div className="stat-grid vehicle-kpi-grid">
          <StatTile
            label="Max GPS speed"
            value={formatMetric(analysis.maxGpsSpeedKmh, 1, 'km/h')}
            hint={gpsMissing ? 'GPS record 없음' : 'GPS decoder 기준'}
          />
          <StatTile
            label="Max motor RPM"
            value={formatMetric(analysis.maxMotorRpm, 0, 'rpm')}
            hint={motorMissing ? 'EZkontrol 0x180117EF frame 없음' : 'EZkontrol 0x180117EF'}
          />
          <StatTile
            label="Peak acceleration X"
            value={formatMetric(analysis.imu?.peakAbsAccelXG ?? null, 2, 'g')}
            hint={imuMissing ? 'IMU record 없음' : 'max |value| · sensor X axis'}
          />
          <StatTile
            label="Peak acceleration Y"
            value={formatMetric(analysis.imu?.peakAbsAccelYG ?? null, 2, 'g')}
            hint={imuMissing ? 'IMU record 없음' : 'max |value| · sensor Y axis'}
          />
          <StatTile
            label="Peak acceleration Z"
            value={formatMetric(analysis.imu?.peakAbsAccelZG ?? null, 2, 'g')}
            hint={imuMissing ? 'IMU record 없음' : 'max |value| · sensor Z axis'}
          />
          <StatTile
            label="Peak absolute Gyro Z"
            value={formatMetric(analysis.imu?.peakAbsGyroZDps ?? null, 1, 'deg/s')}
            hint={imuMissing ? 'IMU record 없음' : 'max |value| · sensor Z axis'}
          />
        </div>
        <p className="vehicle-note">
          IMU 값은 센서 X/Y/Z 축 기준입니다. 장착 방향과 차량 종·횡·수직축 매핑이 확정되지 않아
          차량축 가속도 또는 yaw response로 해석하지 않습니다.
        </p>
      </section>

      <section className="summary-section">
        <h2>Sensor configuration</h2>
        <div className="configuration-grid">
          <article className="configuration-card">
            <div className="configuration-heading">
              <h3>Wheel Speed Analysis</h3>
              <span className="configuration-status" aria-label="Sensor configuration required">
                <span aria-hidden="true">▲</span> SENSOR CONFIGURATION REQUIRED
              </span>
            </div>
            <p>
              DIGITAL record는 pulse counter가 아니라 debounce가 적용된 GPIO level snapshot입니다.
              현재 로그에서 wheel speed를 계산할 수 없습니다.
            </p>
            <div className="configuration-label">Required configuration</div>
            <ul>
              <li>Wheel sensor pulses per revolution (PPR)</li>
              <li>Tire circumference</li>
              <li>Real-driving pulse logging validation</li>
            </ul>
            <div className="configuration-value">N/A · ready once configured and validated</div>
          </article>

          <article className="configuration-card">
            <div className="configuration-heading">
              <h3>Steering Response</h3>
              <span className="configuration-status" aria-label="Calibration required">
                <span aria-hidden="true">▲</span> CALIBRATION REQUIRED
              </span>
            </div>
            <p>
              ANALOG 채널 용도와 조향각 변환식이 문서화되지 않아 steering angle 또는 response를
              계산하지 않습니다.
            </p>
            <div className="configuration-label">Required calibration</div>
            <ul>
              <li>Steering sensor analog channel</li>
              <li>Center / zero reference</li>
              <li>Voltage-to-angle calibration formula and angle range</li>
            </ul>
            <div className="configuration-value">N/A · ready once calibrated</div>
          </article>
        </div>
      </section>

      <section className="summary-section">
        <h2>Analysis readiness</h2>
        <div className="readiness-list" aria-label="Vehicle analysis capability readiness">
          {[
            'GPS vehicle speed',
            'Motor RPM',
            'IMU raw-axis acceleration',
            'Gyro Z',
          ].map((label) => (
            <div className="readiness-row" key={label}>
              <span>{label}</span>
              <span className="readiness-status readiness-available">
                <span aria-hidden="true">●</span> AVAILABLE
              </span>
            </div>
          ))}
          {['Wheel speed', 'Steering angle'].map((label) => (
            <div className="readiness-row" key={label}>
              <span>{label}</span>
              <span className="readiness-status readiness-required">
                <span aria-hidden="true">▲</span> REQUIRES CALIBRATION
              </span>
            </div>
          ))}
        </div>
        <p className="vehicle-note">
          AVAILABLE은 decoder와 계산 경로가 준비되었다는 뜻입니다. 현재 파일에 source가 없으면 위 KPI는
          0이 아닌 N/A로 표시됩니다.
        </p>
      </section>
    </main>
  );
}
