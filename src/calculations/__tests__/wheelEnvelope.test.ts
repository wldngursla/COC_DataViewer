import { describe, expect, it } from 'vitest';
import type { GraphSeries } from '../graphSeries';
import { withWheelEnvelope } from '../wheelEnvelope';

const series = (points: GraphSeries['points']): GraphSeries => ({
  def: { id: 'wheelRl', label: 'Wheel RL', unit: 'km/h', group: 'Wheels' }, available: true, points,
});

describe('wheel envelope display', () => {
  it('uses the upper envelope instead of the misleading median', () => {
    const input = series([[0, 40], [0.1, 42], [0.2, 300], [0.3, 44], [0.4, 41]]);
    const output = withWheelEnvelope(input, 0.5, 'both');
    expect(output.points).toEqual([[0.2, 300]]);
    expect(output.envelope?.lower).toEqual([[0.2, 40]]);
    expect(output.envelope?.upper).toEqual([[0.2, 300]]);
    expect(output.envelope?.raw).toBe(input.points);
    expect(input.points).toHaveLength(5);
  });
  it('does not bridge null breaks or missing time bins', () => {
    const output = withWheelEnvelope(series([[0, 10], [0.1, null], [0.2, 20], [2, 30]]), 0.5, 'envelope');
    expect(output.points).toEqual([[0, 10], [0.1, null], [0.2, 20], [0.5, null], [2, 30]]);
    expect(output.envelope?.upper.map((p) => p[0])).toEqual(output.points.map((p) => p[0]));
  });
  it('leaves raw mode and other signals unchanged, including valid zero speeds', () => {
    const input = series([[0, 0], [0.1, 0]]);
    expect(withWheelEnvelope(input, 0.5, 'raw')).toBe(input);
    const gps = { ...input, def: { ...input.def, group: 'Vehicle' as const } };
    expect(withWheelEnvelope(gps, 0.5, 'envelope')).toBe(gps);
    expect(withWheelEnvelope(input, 0.5, 'envelope').points).toEqual([[0.05, 0]]);
  });
  it('handles empty and single-sample runs and rejects invalid windows', () => {
    expect(withWheelEnvelope(series([]), 0.5, 'envelope').points).toEqual([]);
    expect(withWheelEnvelope(series([[1, 25]]), 0.5, 'envelope').points).toEqual([[1, 25]]);
    expect(() => withWheelEnvelope(series([]), 0, 'envelope')).toThrow();
  });
});
