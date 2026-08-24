/** Time-aligned graphs with a GPS context map and one shared selected time. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LoadedRun } from '../state/loadedRun';
import {
  GRAPH_SIGNALS,
  createGraphSeriesProvider,
} from '../calculations/graphSeries';
import type { SignalGroup, SignalId } from '../calculations/graphSeries';
import {
  PLAYBACK_SPEEDS,
  advancePlayback,
  seekPlayback,
  setPlaybackPlaying,
  setPlaybackSpeed,
  type PlaybackState,
  type PlaybackSpeed,
} from '../calculations/playback';
import {
  computeTrackAnalysis,
  createSpatialTelemetrySelector,
} from '../calculations/trackAnalysis';
import { computeTimeRange } from '../calculations/logSummary';
import { StackedSignalChart } from '../components/StackedSignalChart';
import { TrackMap } from '../components/TrackMap';
import { formatDuration, formatElapsedTime } from '../ui/format';

const DEFAULT_ON: readonly SignalId[] = ['gpsSpeed', 'accelerator', 'motorRpm', 'current'];

const GROUP_ORDER: readonly SignalGroup[] = ['Vehicle', 'IMU', 'Battery'];
const GROUP_LABEL: Record<SignalGroup, string> = {
  Vehicle: 'Vehicle',
  IMU: 'IMU (sensor axis)',
  Battery: 'Battery',
};

const NA = 'N/A';

function formatMetric(value: number | null, fractionDigits: number, unit: string): string {
  return value !== null && Number.isFinite(value)
    ? `${value.toFixed(fractionDigits)} ${unit}`
    : NA;
}

interface GraphsPageProps {
  run: LoadedRun;
  selectedTimestampMs: number | null;
  onSelectTimestamp: (timestampMs: number) => void;
}

export function GraphsPage({
  run,
  selectedTimestampMs,
  onSelectTimestamp,
}: GraphsPageProps) {
  const provider = useMemo(() => createGraphSeriesProvider(run.result), [run.result]);
  const runRange = useMemo(() => computeTimeRange(run.result), [run.result]);
  const track = useMemo(() => computeTrackAnalysis(run.result), [run.result]);
  const telemetrySelector = useMemo(
    () => createSpatialTelemetrySelector(run.result, track),
    [run.result, track],
  );
  const [enabled, setEnabled] = useState<ReadonlySet<SignalId>>(() => new Set(DEFAULT_ON));
  const [playback, setPlayback] = useState<PlaybackState>(() => {
    const initialTimeSec =
      selectedTimestampMs !== null && runRange !== null
        ? (selectedTimestampMs - runRange.firstMs) / 1000
        : 0;
    return seekPlayback(
      { timeSec: 0, isPlaying: false, speed: 1 },
      initialTimeSec,
      provider.durationSec,
    );
  });

  useEffect(() => {
    if (!playback.isPlaying) return;
    let previousFrameMs = performance.now();
    let frameId = 0;
    const tick = (frameMs: number) => {
      const realDeltaSec = (frameMs - previousFrameMs) / 1000;
      previousFrameMs = frameMs;
      setPlayback((state) => advancePlayback(state, realDeltaSec, provider.durationSec));
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [playback.isPlaying, provider.durationSec]);

  useEffect(() => {
    if (runRange !== null) {
      onSelectTimestamp(Math.round(runRange.firstMs + playback.timeSec * 1000));
    }
  }, [onSelectTimestamp, playback.timeSec, runRange]);

  const selectedTimestamp =
    runRange === null ? 0 : runRange.firstMs + playback.timeSec * 1000;
  const currentValues = useMemo(
    () => telemetrySelector.selectTimestamp(selectedTimestamp),
    [selectedTimestamp, telemetrySelector],
  );
  const trackIndexBySource = useMemo(
    () => new Map(track.points.map((point, index) => [point.sourceIndex, index])),
    [track],
  );
  const selectedPointIndex =
    currentValues.gpsPoint === null
      ? null
      : (trackIndexBySource.get(currentValues.gpsPoint.sourceIndex) ?? null);

  const toggle = (id: SignalId) => {
    setEnabled((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activeSeries = useMemo(
    () =>
      GRAPH_SIGNALS.filter((definition) =>
        enabled.has(definition.id) && provider.isAvailable(definition.id),
      ).map((definition) => provider.get(definition.id)),
    [provider, enabled],
  );

  const selectTime = useCallback(
    (timeSec: number) => {
      setPlayback((state) => seekPlayback(state, timeSec, provider.durationSec));
    },
    [provider.durationSec],
  );

  const selectMapPoint = useCallback(
    (pointIndex: number) => {
      const point = track.points[pointIndex];
      if (point !== undefined) selectTime(point.elapsedMs / 1000);
    },
    [selectTime, track],
  );

  const togglePlayback = () => {
    setPlayback((state) => setPlaybackPlaying(state, !state.isPlaying));
  };

  const selectSpeed = (speed: PlaybackSpeed) => {
    setPlayback((state) => setPlaybackSpeed(state, speed));
  };

  return (
    <main className="page graphs-page">
      <div className="graphs-header">
        <span className="file-name">{run.fileName}</span>
        <span className="graphs-meta">
          run {formatDuration(provider.durationSec * 1000)} · active signals {activeSeries.length}
        </span>
        <span className="graphs-selection">
          T+{formatElapsedTime(playback.timeSec * 1000)}
        </span>
      </div>

      <div className="signal-panel">
        {GROUP_ORDER.map((group) => (
          <div key={group} className="signal-group">
            <div className="signal-group-label">{GROUP_LABEL[group]}</div>
            <div className="signal-toggles">
              {GRAPH_SIGNALS.filter((definition) => definition.group === group).map((definition) => {
                const available = provider.isAvailable(definition.id);
                const on = available && enabled.has(definition.id);
                return (
                  <button
                    key={definition.id}
                    type="button"
                    className={`sig-toggle${on ? ' sig-on' : ''}`}
                    aria-pressed={on}
                    disabled={!available}
                    title={available ? definition.note : `N/A — source data missing${definition.note ? ` (${definition.note})` : ''}`}
                    onClick={() => toggle(definition.id)}
                  >
                    {definition.label} <span className="sig-unit">{available ? definition.unit : 'N/A'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <section className="graphs-track-section" aria-labelledby="graphs-track-heading">
        <div className="graphs-section-heading">
          <div>
            <h2 id="graphs-track-heading">GPS Track</h2>
            <span>Route position synchronized to selected graph time</span>
          </div>
          {track.points.length > 0 && (
            <span>{track.points.length.toLocaleString('en-US')} GPS samples</span>
          )}
        </div>
        {track.points.length === 0 ? (
          <div className="track-empty graphs-track-empty">
            <strong>N/A</strong>
            <span>GPS records are missing, so route position is unavailable.</span>
          </div>
        ) : (
          <TrackMap
            track={track}
            selectedPointIndex={selectedPointIndex}
            onSelectPoint={selectMapPoint}
            compact
          />
        )}
      </section>

      <section className="playback-panel" aria-label="Playback controls and current values">
        <div className="playback-controls">
          <div className="playback-control-row">
            <button
              type="button"
              className="btn-playback"
              onClick={togglePlayback}
              disabled={provider.durationSec <= 0}
            >
              {playback.isPlaying ? 'Ⅱ Pause' : '▶ Play'}
            </button>
            <output className="playback-time" aria-live="off">
              {formatElapsedTime(playback.timeSec * 1000)} / {formatElapsedTime(provider.durationSec * 1000)}
            </output>
            <div className="playback-speeds" aria-label="Playback speed">
              {PLAYBACK_SPEEDS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  className={playback.speed === speed ? 'playback-speed-active' : ''}
                  aria-pressed={playback.speed === speed}
                  onClick={() => selectSpeed(speed)}
                >
                  {speed}×
                </button>
              ))}
            </div>
          </div>
          <input
            className="playback-slider"
            type="range"
            min={0}
            max={provider.durationSec}
            step={0.001}
            value={playback.timeSec}
            aria-label="Selected run time"
            onChange={(event) => selectTime(Number(event.currentTarget.value))}
          />
        </div>

        <div className="current-values">
          <div className="current-values-heading">
            <h2>Current Values</h2>
            <span>nearest samples · no interpolation</span>
          </div>
          <dl className="current-values-grid">
            <div><dt>GPS Speed</dt><dd>{formatMetric(currentValues.gpsSpeedKmh, 1, 'km/h')}</dd></div>
            <div><dt>Accelerator Pedal</dt><dd>{formatMetric(currentValues.acceleratorPedalPercent, 0, '%')}</dd></div>
            <div><dt>Motor RPM</dt><dd>{formatMetric(currentValues.motorRpm, 0, 'rpm')}</dd></div>
            <div><dt>Acceleration X</dt><dd>{formatMetric(currentValues.accelerationXG, 2, 'g')}</dd></div>
            <div><dt>Acceleration Y</dt><dd>{formatMetric(currentValues.accelerationYG, 2, 'g')}</dd></div>
            <div><dt>Gyro Z</dt><dd>{formatMetric(currentValues.gyroZDps, 1, 'deg/s')}</dd></div>
            <div><dt>Battery Current</dt><dd>{formatMetric(currentValues.batteryCurrentA, 1, 'A')}</dd></div>
            <div><dt>Battery Power</dt><dd>{formatMetric(currentValues.batteryPowerKw, 2, 'kW')}</dd></div>
          </dl>
          <p className="current-values-note">IMU values use sensor axes; vehicle-axis mapping is not confirmed.</p>
        </div>
      </section>

      {activeSeries.length > 0 ? (
        <StackedSignalChart
          seriesList={activeSeries}
          durationSec={provider.durationSec}
          selectedTimeSec={playback.timeSec}
          onSelectTimeSec={selectTime}
        />
      ) : (
        <div className="graphs-empty">
          No signals selected. Enable a signal above.
          {GRAPH_SIGNALS.every((definition) => !provider.isAvailable(definition.id)) &&
            ' (This log has no data supported by the graph signals.)'}
        </div>
      )}
    </main>
  );
}
