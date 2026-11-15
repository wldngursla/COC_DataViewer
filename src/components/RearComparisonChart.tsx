import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { RearAnalysis } from '../calculations/rearCalibration';
echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);
export function RearComparisonChart({ analysis, mode }: { analysis: RearAnalysis; mode: 'raw' | 'corrected' | 'filtered' | 'compare' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const start = analysis.rows[0]?.t ?? 0;
    const make = (name: string, field: 'gps' | 'motor' | 'raw' | 'corrected' | 'filtered', color: string, wheel = 0) => {
      const points: [number, number | null][] = [];
      analysis.rows.forEach((row, i) => {
        if (i && row.t - analysis.rows[i - 1].t > analysis.settings.gapMs) points.push([(analysis.rows[i - 1].t + 1 - start) / 1000, null]);
        const v = field === 'gps' || field === 'motor' ? row[field] : row[field][wheel];
        points.push([(row.t - start) / 1000, v !== null && Number.isFinite(v) ? v : null]);
      });
      return { name, type: 'line' as const, data: points, showSymbol: false, connectNulls: false, sampling: 'lttb' as const, lineStyle: { color, width: field === 'gps' ? 2.5 : 1.3 }, itemStyle: { color } };
    };
    const fields = mode === 'compare' ? ['raw', 'corrected', 'filtered'] as const : [mode];
    const palette = ['#c98500', '#d55181', '#3987e5', '#199e70', '#fab219', '#e66767'];
    const series = [make('GPS reference', 'gps', '#ffffff'), make('Motor-derived (configured only)', 'motor', '#9085e9'), ...fields.flatMap((f, i) => [make(`RL ${f}`, f, palette[i * 2], 0), make(`RR ${f}`, f, palette[i * 2 + 1], 1)])];
    const alignedPoints = (value: (r: RearAnalysis['rows'][number]) => number | null) => analysis.rows.flatMap((r, j) => {
      const v = value(r);
      return [...(j && r.t - analysis.rows[j - 1].t > analysis.settings.gapMs ? [[(analysis.rows[j - 1].t + 1 - start) / 1000, null]] : []), [(r.t - start) / 1000, v !== null && Number.isFinite(v) ? v : null]];
    });
    const deltas = fields.map((field, i) => ({ name: `RR−RL ${field}`, type: 'line' as const, xAxisIndex: 1, yAxisIndex: 1, data: alignedPoints((r) => r[field][0] === null || r[field][1] === null ? null : r[field][1]! - r[field][0]!), showSymbol: false, connectNulls: false, lineStyle: { color: palette[i * 2] } }));
    chart.setOption({ animation: false, legend: { type: 'scroll', textStyle: { color: '#c3c2b7' }, top: 0 }, tooltip: { trigger: 'axis' }, axisPointer: { link: [{ xAxisIndex: 'all' }] }, grid: [{ top: 80, height: 220, left: 65, right: 20 }, { top: 360, height: 120, left: 65, right: 20 }], xAxis: [0, 1].map((gridIndex) => ({ type: 'value', gridIndex, name: 's', axisLabel: { color: '#8a897f' } })), yAxis: [{ type: 'value', name: 'km/h', axisLabel: { color: '#8a897f' } }, { type: 'value', gridIndex: 1, name: 'RR−RL km/h', axisLabel: { color: '#8a897f' } }], dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }, { type: 'slider', xAxisIndex: [0, 1], bottom: 10 }], series: [...series, ...deltas, { name: 'Yaw model (confirmed only)', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: alignedPoints((r) => r.expectedDelta), showSymbol: false, connectNulls: false, lineStyle: { color: '#ffffff', type: 'dashed' } }] });
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [analysis, mode]);
  return <div ref={ref} className="telemetry-chart" style={{ height: 560, minWidth: 0, width: '100%' }} aria-label="GPS Motor RL RR comparison chart" />;
}
