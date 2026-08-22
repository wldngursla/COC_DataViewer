/**
 * Post-parse summary: exactly the fields the File Loading stage shows.
 * Values are computed by src/calculations and formatted by src/ui/format.
 */

import type { ParsedLog } from '../parser/types';
import { LogType } from '../parser/types';
import { computeTimeRange, countEventRecords } from '../calculations/logSummary';
import { formatCount, formatDuration, formatEpochSec } from '../ui/format';
import { StatTile } from './StatTile';

interface ParseSummaryProps {
  result: ParsedLog;
}

/** integrity counters: 0 is good, anything else is a warning */
const integrityTone = (n: number) => (n === 0 ? ('good' as const) : ('warning' as const));

export function ParseSummary({ result }: ParseSummaryProps) {
  const { stats, boot, bootTimeEpochSec } = result;
  const range = computeTimeRange(result);

  return (
    <div className="summary">
      <section className="summary-section">
        <h2>Run</h2>
        <div className="stat-grid">
          <StatTile
            label="Run duration"
            value={range !== null ? formatDuration(range.durationMs) : '—'}
            hint={range !== null ? `${formatCount(range.durationMs)} ms` : undefined}
          />
          <StatTile label="Total accepted records" value={formatCount(stats.accepted)} />
          <StatTile
            label="Protocol version"
            value={boot !== null ? String(boot.protocolVersion) : '—'}
            hint={boot === null ? 'BOOT record 없음' : undefined}
          />
          <StatTile
            label="Boot time"
            value={bootTimeEpochSec !== null ? formatEpochSec(bootTimeEpochSec) : '—'}
            hint={bootTimeEpochSec === null ? 'GPS fix 없음 — 절대 시각 미확정' : undefined}
          />
        </div>
      </section>

      <section className="summary-section">
        <h2>Records by source</h2>
        <div className="stat-grid">
          <StatTile label="CAN records" value={formatCount(stats.byType[LogType.Can])} />
          <StatTile label="GPS records" value={formatCount(stats.byType[LogType.Gps])} />
          <StatTile label="IMU records" value={formatCount(stats.byType[LogType.Gyroscope])} />
          <StatTile label="Analog records" value={formatCount(stats.byType[LogType.Analog])} />
          <StatTile label="Digital records" value={formatCount(stats.byType[LogType.Digital])} />
          <StatTile
            label="System/User event records"
            value={formatCount(countEventRecords(result))}
          />
        </div>
      </section>

      <section className="summary-section">
        <h2>File integrity</h2>
        <div className="stat-grid">
          <StatTile
            label="Bad magic records"
            value={formatCount(stats.badMagic)}
            tone={integrityTone(stats.badMagic)}
          />
          <StatTile
            label="Bad checksum records"
            value={formatCount(stats.badChecksum)}
            tone={integrityTone(stats.badChecksum)}
          />
          <StatTile
            label="Unknown type records"
            value={formatCount(stats.unknownType)}
            tone={integrityTone(stats.unknownType)}
          />
          <StatTile
            label="Trailing bytes"
            value={`${formatCount(stats.trailingBytes)} B`}
            tone={integrityTone(stats.trailingBytes)}
            hint={stats.trailingBytes > 0 ? '파일 끝 불완전 레코드 (전원 차단 시 정상)' : undefined}
          />
        </div>
      </section>
    </div>
  );
}
