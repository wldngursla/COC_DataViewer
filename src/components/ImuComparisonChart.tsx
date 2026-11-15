import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ImuAnalysis, ImuRow } from '../calculations/imuCalibration';
echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, CanvasRenderer]);
export type ImuDisplay = 'raw' | 'calibrated' | 'filtered' | 'compare';
export function ImuComparisonChart({ analysis: a, mode, linear }: { analysis: ImuAnalysis; mode: ImuDisplay; linear: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current); const start = a.rows[0]?.t ?? 0;
    const points = (read: (r: ImuRow) => number | null) => {
      const data: [number, number | null][] = [];
      a.rows.forEach((r, i) => {
        if (i && (r.t - a.rows[i - 1].t > a.settings.gapMs || r.epoch !== a.rows[i - 1].epoch)) data.push([(a.rows[i - 1].t + 1 - start) / 1000, null]);
        const value = read(r); data.push([(r.t - start) / 1000, value !== null && Number.isFinite(value) ? value : null]);
      });
      return data;
    };
    const line = (name: string, axis: number, read: (r: ImuRow) => number | null, color: string, dashed = false) => ({ name, type: 'line' as const, xAxisIndex: axis, yAxisIndex: axis, data: points(read), connectNulls: false, showSymbol: false, sampling: 'lttb' as const, lineStyle: { color, width: dashed ? 1 : 1.7, type: dashed ? 'dashed' as const : 'solid' as const }, itemStyle: { color } });
    const stages = mode === 'compare' ? ['raw', 'calibrated', 'filtered'] as const : [mode];
    const colors = ['#3987e5', '#199e70', '#fab219'];
    const series = stages.flatMap((stage) => [0, 1, 2].flatMap((j) => {
      const axis = ['X', 'Y', 'Z'][j];
      const sensor = stage === 'raw' || !a.rotation;
      const accel: keyof ImuRow = stage === 'raw' ? 'sensorAccel' : stage === 'calibrated' ? (linear ? 'linear' : 'accel') : sensor ? 'filteredSensorAccel' : (linear ? 'filteredLinear' : 'filteredAccel');
      const gyro: keyof ImuRow = stage === 'raw' ? 'sensorGyro' : stage === 'calibrated' ? (sensor ? 'biasCorrectedSensorGyro' : 'gyro') : (sensor ? 'filteredSensorGyro' : 'filteredGyro');
      const frame = sensor ? 'sensor specific (not vehicle)' : `vehicle ${linear ? 'linear' : 'specific'}`;
      return [line(`${stage} ${frame} ${axis}`, 0, (r) => (r[accel] as number[] | null)?.[j] ?? null, colors[j], stage === 'raw'), line(`${stage} ${sensor ? 'sensor' : 'vehicle'} rate ${axis}`, 1, (r) => (r[gyro] as number[] | null)?.[j] ?? null, colors[j], stage === 'raw')];
    }));
    series.push(line('GPS longitudinal (g)', 0, (r) => r.gpsAccel, '#ffffff', true), line('GPS yaw CCW (deg/s)', 1, (r) => r.gpsYaw, '#ffffff', true), line('GPS lateral v*yaw (g)', 0, (r) => r.gpsLateral, '#9085e9', true));
    chart.setOption({ animation: false, legend: { type: 'scroll', top: 0, textStyle: { color: '#c3c2b7' } }, tooltip: { trigger: 'axis' }, axisPointer: { link: [{ xAxisIndex: 'all' }] }, grid: [{ top: 65, height: 190, left: 65, right: 20 }, { top: 320, height: 190, left: 65, right: 20 }], xAxis: [0, 1].map((gridIndex) => ({ type: 'value', gridIndex, name: 'elapsed s', axisLabel: { color: '#8a897f' } })), yAxis: [{ type: 'value', name: 'g', axisLabel: { color: '#8a897f' } }, { type: 'value', gridIndex: 1, name: 'deg/s', axisLabel: { color: '#8a897f' } }], dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }, { type: 'slider', xAxisIndex: [0, 1], bottom: 10 }], series });
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(ref.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [a, mode, linear]);
  return <div ref={ref} style={{ width: '100%', minWidth: 0, height: 590 }} aria-label="IMU sensor and vehicle axes comparison with independent GPS" />;
}
