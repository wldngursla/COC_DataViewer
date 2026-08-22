/**
 * Graphs — time-aligned signal 분석 화면.
 * 시리즈 생성은 src/calculations/graphSeries.ts, 차트는 StackedSignalChart.
 * 이 페이지는 신호 ON/OFF 상태와 배치만 담당한다.
 */

import { useMemo, useState } from 'react';
import type { LoadedRun } from '../state/loadedRun';
import {
  GRAPH_SIGNALS,
  createGraphSeriesProvider,
} from '../calculations/graphSeries';
import type { SignalGroup, SignalId } from '../calculations/graphSeries';
import { formatDuration } from '../ui/format';
import { StackedSignalChart } from '../components/StackedSignalChart';

/** 초기 진입 시 표시하는 신호 (전부 렌더링하지 않는다) */
const DEFAULT_ON: readonly SignalId[] = ['gpsSpeed', 'motorRpm', 'current'];

const GROUP_ORDER: readonly SignalGroup[] = ['Vehicle', 'IMU', 'Battery'];
const GROUP_LABEL: Record<SignalGroup, string> = {
  Vehicle: 'Vehicle',
  IMU: 'IMU (sensor axis)',
  Battery: 'Battery',
};

interface GraphsPageProps {
  run: LoadedRun;
}

export function GraphsPage({ run }: GraphsPageProps) {
  const provider = useMemo(() => createGraphSeriesProvider(run.result), [run]);
  const [enabled, setEnabled] = useState<ReadonlySet<SignalId>>(() => new Set(DEFAULT_ON));

  const toggle = (id: SignalId) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 고정 표시 순서 유지 — ON이면서 소스가 실제로 존재하는 신호만 차트에 올린다
  const activeSeries = useMemo(
    () =>
      GRAPH_SIGNALS.filter((d) => enabled.has(d.id) && provider.isAvailable(d.id)).map((d) =>
        provider.get(d.id),
      ),
    [provider, enabled],
  );

  return (
    <main className="page">
      <div className="graphs-header">
        <span className="file-name">{run.fileName}</span>
        <span className="graphs-meta">
          run {formatDuration(provider.durationSec * 1000)} · 활성 신호 {activeSeries.length}개
        </span>
      </div>

      <div className="signal-panel">
        {GROUP_ORDER.map((group) => (
          <div key={group} className="signal-group">
            <div className="signal-group-label">{GROUP_LABEL[group]}</div>
            <div className="signal-toggles">
              {GRAPH_SIGNALS.filter((d) => d.group === group).map((d) => {
                const available = provider.isAvailable(d.id);
                const on = available && enabled.has(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`sig-toggle${on ? ' sig-on' : ''}`}
                    aria-pressed={on}
                    disabled={!available}
                    title={available ? d.note : `N/A — 로그에 해당 데이터 없음${d.note ? ` (${d.note})` : ''}`}
                    onClick={() => toggle(d.id)}
                  >
                    {d.label} <span className="sig-unit">{available ? d.unit : 'N/A'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {activeSeries.length > 0 ? (
        <StackedSignalChart seriesList={activeSeries} durationSec={provider.durationSec} />
      ) : (
        <div className="graphs-empty">
          표시할 신호가 없습니다 — 위에서 신호를 켜세요.
          {GRAPH_SIGNALS.every((d) => !provider.isAvailable(d.id)) &&
            ' (이 로그에는 그래프로 표시할 수 있는 데이터가 없습니다)'}
        </div>
      )}
    </main>
  );
}
