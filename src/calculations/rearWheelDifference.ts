import type { GraphPoint } from './graphSeries';

/** RR peak minus RL peak from matching time bins; absent side is never zero-filled. */
export function rearWheelDifference(left: readonly GraphPoint[], right: readonly GraphPoint[], windowSec = 0.5): GraphPoint[] {
  const collect = (points: readonly GraphPoint[]) => {
    const bins = new Map<number, number>();
    for (const [t, value] of points) {
      if (value === null || !Number.isFinite(value)) continue;
      const key = Math.floor(t / windowSec);
      bins.set(key, Math.max(bins.get(key) ?? -Infinity, value));
    }
    return bins;
  };
  const l = collect(left); const r = collect(right);
  const keys = [...new Set([...l.keys(), ...r.keys()])].sort((a, b) => a - b);
  const output: GraphPoint[] = []; let previous: number | null = null;
  for (const key of keys) {
    if (previous !== null && key > previous + 1) output.push([(previous + 1.5) * windowSec, null]);
    const a = l.get(key); const b = r.get(key);
    output.push([(key + 0.5) * windowSec, a === undefined || b === undefined ? null : b - a]);
    previous = key;
  }
  return output;
}
