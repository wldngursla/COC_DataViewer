import type { GraphPoint, GraphSeries } from './graphSeries';

export type WheelDisplayMode = 'envelope' | 'raw' | 'both';
export interface WheelEnvelope {
  lower: GraphPoint[];
  upper: GraphPoint[];
  raw?: GraphPoint[];
  windowSec: number;
}

/** Display-only time bins: peak curve and exact min/max envelope.
 * Nulls and empty time bins split segments; never bridge missing measurements.
 * Source points remain untouched. Bin times stay within observed sample times.
 */
export function withWheelEnvelope(series: GraphSeries, windowSec: number, mode: WheelDisplayMode): GraphSeries {
  if (mode === 'raw' || series.def.group !== 'Wheels') return series;
  if (!Number.isFinite(windowSec) || windowSec <= 0) throw new Error('Envelope window must be positive');
  const points: GraphPoint[] = [];
  const lower: GraphPoint[] = [];
  const upper: GraphPoint[] = [];
  let bin = -1;
  let times: number[] = [];
  let values: number[] = [];
  const flush = () => {
    if (values.length === 0) return;
    values.sort((a, b) => a - b);
    const time = (times[0] + times[times.length - 1]) / 2;
    points.push([time, values[values.length - 1]]);
    lower.push([time, values[0]]);
    upper.push([time, values[values.length - 1]]);
    values = []; times = [];
  };
  const split = (time: number) => {
    points.push([time, null]); lower.push([time, null]); upper.push([time, null]);
  };
  for (const [time, value] of series.points) {
    if (value === null || !Number.isFinite(value)) {
      flush(); split(time); bin = -1;
      continue;
    }
    const nextBin = Math.floor(time / windowSec);
    if (nextBin !== bin) {
      flush();
      if (bin >= 0 && nextBin > bin + 1) split((bin + 1) * windowSec);
      bin = nextBin;
    }
    times.push(time); values.push(value);
  }
  flush();
  return { ...series, points, envelope: { lower, upper, windowSec, raw: mode === 'both' ? series.points : undefined } };
}
