/**
 * Data Health presents timestamp structure and parser integrity before the
 * operator begins vehicle analysis. Calculation stays in dataHealth.ts.
 */

import { useMemo } from 'react';
import { computeDataHealth } from '../calculations/dataHealth';
import type { SourceStatus } from '../calculations/dataHealth';
import { StatTile } from '../components/StatTile';
import type { LoadedRun } from '../state/loadedRun';
import { formatCount } from '../ui/format';

const NA = 'N/A';

const STATUS_PRESENTATION: Record<
  SourceStatus,
  { icon: string; tone: 'normal' | 'warning' | 'missing' | 'na' | 'event' }
> = {
  NORMAL: { icon: '●', tone: 'normal' },
  WARNING: { icon: '▲', tone: 'warning' },
  MISSING: { icon: '○', tone: 'missing' },
  'N/A': { icon: '—', tone: 'na' },
  EVENT: { icon: '◆', tone: 'event' },
};

function formatTimestamp(timestampMs: number | null): string {
  return timestampMs === null ? NA : `T+${(timestampMs / 1000).toFixed(3)} s`;
}

function formatRate(rateHz: number | null): string {
  if (rateHz === null) return NA;
  const digits = rateHz >= 10 ? 2 : 3;
  return `${rateHz.toFixed(digits)} Hz`;
}

function formatMilliseconds(valueMs: number | null): string {
  if (valueMs === null) return NA;
  const value = Number.isInteger(valueMs) ? formatCount(valueMs) : valueMs.toFixed(1);
  return `${value} ms`;
}

interface DataHealthPageProps {
  run: LoadedRun;
}

export function DataHealthPage({ run }: DataHealthPageProps) {
  const health = useMemo(() => computeDataHealth(run.result), [run.result]);
  const { fileIntegrity } = health;
  const integrityTone = (value: number) =>
    value === 0 ? ('good' as const) : ('warning' as const);

  return (
    <main className="page data-health-page">
      <header className="health-header">
        <div>
          <h1>Data Health</h1>
          <p>차량 분석 전 로그의 timestamp 연속성과 파일 무결성을 확인합니다.</p>
        </div>
        <span className="file-name">{run.fileName}</span>
      </header>

      <section className="summary-section">
        <h2>Overall</h2>
        <div className="stat-grid health-overall-grid">
          <StatTile
            label="Accepted records"
            value={formatCount(fileIntegrity.acceptedRecords)}
          />
          <StatTile
            label="Rejected records"
            value={formatCount(fileIntegrity.rejectedRecords)}
            tone={integrityTone(fileIntegrity.rejectedRecords)}
            hint="bad magic + bad checksum + unknown type"
          />
          <StatTile
            label="Sources present"
            value={`${health.presentSources} / ${health.totalSources}`}
            hint="CAN, GPS, IMU, Analog, Digital, System/User Event"
          />
        </div>
      </section>

      <section className="summary-section">
        <div className="health-section-heading">
          <h2>Source health</h2>
          <span>First/last timestamp는 로거 부팅 후 경과 시간입니다.</span>
        </div>
        <div className="health-table-wrap">
          <table className="health-table" aria-label="Source별 timestamp quality">
            <thead>
              <tr>
                <th scope="col">Source</th>
                <th scope="col">Count</th>
                <th scope="col">First</th>
                <th scope="col">Last</th>
                <th scope="col">Avg Hz</th>
                <th scope="col">Median dt</th>
                <th scope="col">Max gap</th>
                <th scope="col">Large gaps</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {health.sources.map((source) => {
                const status = STATUS_PRESENTATION[source.status];
                return (
                  <tr key={source.source.id}>
                    <th
                      scope="row"
                      title={
                        source.source.id === 'can'
                          ? 'Aggregate record cadence across all CAN IDs'
                          : source.source.id === 'events'
                            ? 'Event-driven source — sampling health not applicable'
                            : undefined
                      }
                    >
                      {source.source.label}
                    </th>
                    <td>{formatCount(source.count)}</td>
                    <td>{formatTimestamp(source.firstTimestampMs)}</td>
                    <td>{formatTimestamp(source.lastTimestampMs)}</td>
                    <td>{formatRate(source.averageHz)}</td>
                    <td>{formatMilliseconds(source.medianIntervalMs)}</td>
                    <td>{formatMilliseconds(source.maximumGapMs)}</td>
                    <td
                      title={
                        source.status === 'EVENT'
                          ? 'Event-driven source — sampling health not applicable'
                          : source.largeGapThresholdMs === null
                            ? 'Timestamp 분석 불가'
                          : `판정 기준: gap > ${formatMilliseconds(source.largeGapThresholdMs)}`
                      }
                    >
                      {source.largeGapCount === null ? NA : formatCount(source.largeGapCount)}
                    </td>
                    <td>
                      <span className={`health-status health-status-${status.tone}`}>
                        <span aria-hidden="true">{status.icon}</span> {source.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="health-note">
          Large gap은 <code>gap &gt; max(5 × median dt, 1000 ms)</code>인 구간입니다. 차량
          사양의 합격/불합격 기준이 아니라, 이 로그에서 평소 cadence보다 긴 공백을 찾는
          heuristic입니다.
        </p>
        <p className="health-note">
          <strong>CAN</strong>은 모든 CAN ID를 합친 aggregate record cadence입니다. 동일
          timestamp의 여러 frame 때문에 median dt가 0 ms여도 오류가 아닙니다.
          {' '}<strong>System/User Event</strong>는 event-driven source이므로 sampling health를
          계산하지 않습니다.
        </p>
        <p className="health-note">
          <strong>NORMAL</strong>은 센서 자체가 정상이라는 뜻이 아니라, 이 로그에서 구조적인
          timestamp anomaly가 발견되지 않았다는 뜻입니다.
        </p>
      </section>

      <section className="summary-section">
        <h2>File integrity</h2>
        <div className="stat-grid health-integrity-grid">
          <StatTile label="Total slots" value={formatCount(fileIntegrity.totalSlots)} />
          <StatTile
            label="Accepted records"
            value={formatCount(fileIntegrity.acceptedRecords)}
          />
          <StatTile
            label="Rejected records"
            value={formatCount(fileIntegrity.rejectedRecords)}
            tone={integrityTone(fileIntegrity.rejectedRecords)}
          />
          <StatTile
            label="Bad magic"
            value={formatCount(fileIntegrity.badMagic)}
            tone={integrityTone(fileIntegrity.badMagic)}
          />
          <StatTile
            label="Bad checksum"
            value={formatCount(fileIntegrity.badChecksum)}
            tone={integrityTone(fileIntegrity.badChecksum)}
          />
          <StatTile
            label="Unknown type"
            value={formatCount(fileIntegrity.unknownType)}
            tone={integrityTone(fileIntegrity.unknownType)}
          />
          <StatTile
            label="Trailing bytes"
            value={`${formatCount(fileIntegrity.trailingBytes)} B`}
            tone={integrityTone(fileIntegrity.trailingBytes)}
            hint={
              fileIntegrity.trailingBytes > 0
                ? '파일 끝의 불완전 레코드 바이트'
                : undefined
            }
          />
        </div>
      </section>
    </main>
  );
}
