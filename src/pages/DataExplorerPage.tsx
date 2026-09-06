import { useMemo, useState } from 'react';
import { analyzeSensorEvents } from '../calculations/sensorEvents';
import {
  RecordExplorerTable,
  type ExplorerSource,
} from '../components/RecordExplorerTable';
import { LogFeature } from '../parser/types';
import type { LoadedRun } from '../state/loadedRun';
import { formatCount, formatEpochSec } from '../ui/format';

const PAGE_SIZES = [25, 50, 100, 250] as const;

interface DataExplorerPageProps {
  run: LoadedRun;
}

export function DataExplorerPage({ run }: DataExplorerPageProps) {
  const { result } = run;
  const [source, setSource] = useState<ExplorerSource>('can');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(50);
  const sensorEvents = useMemo(() => analyzeSensorEvents(result.events), [result.events]);

  const sourceDefinitions: readonly { id: ExplorerSource; label: string; count: number }[] = [
    { id: 'can', label: 'CAN', count: result.can.count },
    { id: 'gps', label: 'GPS', count: result.gps.count },
    { id: 'analog', label: 'Analog', count: result.analog.count },
    {
      id: 'digital',
      label: result.digital.format === 'wheel-speed-kmh' ? 'Wheel Speed' : 'Digital',
      count: result.digital.count,
    },
    { id: 'imu', label: 'IMU', count: result.gyro.count },
    { id: 'events', label: 'Events', count: result.events.length },
  ];
  const selectedSource = sourceDefinitions.find((item) => item.id === source)!;
  const pageCount = Math.max(1, Math.ceil(selectedSource.count / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  const end = Math.min(start + pageSize, selectedSource.count);
  const flags = result.boot?.featureFlags ?? 0;
  const knownFlags = [
    flags & LogFeature.DigitalWheelSpeedFloat ? 'Wheel speed float32' : null,
    flags & LogFeature.SensorStatusEvents ? 'Sensor status events' : null,
  ].filter((value): value is string => value !== null);

  return (
    <main className="page data-explorer-page">
      <header className="data-explorer-header">
        <div>
          <h1>All Recorded Data</h1>
          <p>수집된 모든 필드를 raw 값과 확인된 물리 단위로 함께 표시합니다.</p>
        </div>
        <span className="file-name">{run.fileName}</span>
      </header>

      <section className="summary-section">
        <h2>Log format</h2>
        <dl className="data-format-grid">
          <div><dt>Protocol</dt><dd>{result.boot?.protocolVersion ?? 'N/A'}</dd></div>
          <div><dt>Feature flags</dt><dd>0x{flags.toString(16).toUpperCase().padStart(2, '0')}</dd></div>
          <div><dt>Digital layout</dt><dd>{result.digital.format === 'wheel-speed-kmh' ? '4 × float32 km/h' : '4 × uint32 GPIO level'}</dd></div>
          <div><dt>Logger MAC</dt><dd>{result.boot?.mac ?? 'N/A'}</dd></div>
          <div><dt>Boot time</dt><dd>{result.bootTimeEpochSec === null ? 'N/A' : formatEpochSec(result.bootTimeEpochSec)}</dd></div>
          <div><dt>Boot time raw</dt><dd>{result.boot === null ? 'N/A' : `${result.boot.bootTime} epoch sec`}</dd></div>
          <div><dt>BOOT timestamp</dt><dd>{result.boot === null ? 'N/A' : `${result.boot.timestamp} ms`}</dd></div>
          <div><dt>Accepted records</dt><dd>{formatCount(result.stats.accepted)}</dd></div>
        </dl>
        <div className="feature-badges" aria-label="Detected log features">
          {knownFlags.length === 0
            ? <span className="feature-badge feature-badge-legacy">Legacy V1 feature byte</span>
            : knownFlags.map((flag) => <span key={flag} className="feature-badge">● {flag}</span>)}
        </div>
      </section>

      {(sensorEvents.config.length > 0 || sensorEvents.latestStatus.length > 0) && (
        <section className="summary-section">
          <div className="data-section-heading">
            <h2>Sensor configuration & latest status</h2>
            <span>decoded from CFG:* / SNS:* SYSTEM events</span>
          </div>
          {sensorEvents.config.length > 0 && (
            <div className="sensor-state-grid">
              {sensorEvents.config.map((entry) => (
                <div className="sensor-state" key={`cfg-${entry.name}`}>
                  <span>{entry.name}</span>
                  <strong className={entry.value === 'ON' ? 'sensor-state-ok' : 'sensor-state-off'}>
                    {entry.value === 'ON' ? '●' : '○'} {entry.value}
                  </strong>
                </div>
              ))}
            </div>
          )}
          {sensorEvents.latestStatus.length > 0 && (
            <div className="sensor-status-row">
              {sensorEvents.latestStatus.map((entry) => (
                <span
                  key={`status-${entry.name}`}
                  className={`sensor-status sensor-status-${entry.value.toLowerCase()}`}
                  title={`last update: ${entry.timestampMs} ms`}
                >
                  {entry.value === 'OK' ? '●' : '▲'} {entry.name}: {entry.value}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="summary-section">
        <div className="data-section-heading">
          <h2>Record explorer</h2>
          <span>모든 행은 페이지 이동으로 확인 가능 · 보간/샘플 생략 없음</span>
        </div>
        <div className="record-source-tabs" role="tablist" aria-label="Record source">
          {sourceDefinitions.map((definition) => (
            <button
              key={definition.id}
              type="button"
              role="tab"
              aria-selected={source === definition.id}
              className={source === definition.id ? 'record-source-active' : ''}
              onClick={() => {
                setSource(definition.id);
                setPage(0);
              }}
            >
              {definition.label} <span>{formatCount(definition.count)}</span>
            </button>
          ))}
        </div>

        <div className="record-toolbar">
          <span>
            {selectedSource.count === 0
              ? 'No records'
              : `${formatCount(start + 1)}–${formatCount(end)} of ${formatCount(selectedSource.count)}`}
          </span>
          <label>
            Rows
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.currentTarget.value));
                setPage(0);
              }}
            >
              {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <div className="record-pager">
            <button type="button" disabled={safePage === 0} onClick={() => setPage(0)}>« First</button>
            <button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>‹ Prev</button>
            <output>{safePage + 1} / {pageCount}</output>
            <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Next ›</button>
            <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage(pageCount - 1)}>Last »</button>
          </div>
        </div>

        {selectedSource.count === 0 ? (
          <div className="record-empty">N/A · 이 source의 record가 없습니다.</div>
        ) : (
          <div className="record-table-wrap" role="tabpanel">
            <RecordExplorerTable result={result} source={source} start={start} end={end} />
          </div>
        )}
        <p className="data-explorer-note">
          Analog 0은 실제 0 V와 비활성 채널을 구분할 수 없습니다. CFG 이벤트가 있는 로그에서는 위 설정값을
          기준으로 판단합니다. IMU temperature는 센서 모델별 공식이 확정되지 않아 raw 값만 표시합니다.
        </p>
      </section>
    </main>
  );
}
