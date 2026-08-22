/**
 * 시간축이 정렬된 stacked signal plot.
 * 활성 신호마다 grid 하나 — 각자 자기 Y scale을 가지되,
 * X(경과 시간)·zoom·pan·axis pointer는 전부 공유한다.
 * ECharts 인스턴스는 하나만 쓴다 (grid 분할 방식이 cursor/zoom 동기화에 가장 견고).
 */

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  TitleComponent,
  DataZoomComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { GraphSeries, SignalId } from '../calculations/graphSeries';

echarts.use([LineChart, GridComponent, TooltipComponent, TitleComponent, DataZoomComponent, CanvasRenderer]);

/** 신호별 고정 색 (dataviz dark palette steps) — 순서가 아니라 신호 정체성에 고정 */
const SIGNAL_COLOR: Record<SignalId, string> = {
  gpsSpeed: '#3987e5',
  motorRpm: '#d95926',
  current: '#199e70',
  accX: '#c98500',
  accY: '#d55181',
  accZ: '#008300',
  yawRate: '#9085e9',
  soc: '#e66767',
  voltage: '#3987e5',
  power: '#d95926',
};

/** tooltip 소수 자릿수 */
const SIGNAL_DECIMALS: Record<SignalId, number> = {
  gpsSpeed: 1,
  motorRpm: 0,
  accX: 3,
  accY: 3,
  accZ: 3,
  yawRate: 1,
  soc: 1,
  voltage: 1,
  current: 1,
  power: 2,
};

/** 초 → "m:ss" (축 라벨) */
function clockLabel(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 초 → "m:ss.mmm" (tooltip — ms 정밀도) */
function clockTooltip(sec: number): string {
  const totalMs = Math.round(sec * 1000);
  const m = Math.floor(totalMs / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

const ROW_HEIGHT = 128;
const ROW_GAP = 34;
const TOP_PAD = 22;
const SLIDER_AREA = 64;

function chartHeightPx(signalCount: number): number {
  return TOP_PAD + signalCount * (ROW_HEIGHT + ROW_GAP) + SLIDER_AREA;
}

interface TooltipEntry {
  seriesIndex?: number;
  axisValue?: number;
  value?: [number, number | null];
}

function buildOption(seriesList: GraphSeries[], durationSec: number): echarts.EChartsCoreOption {
  const n = seriesList.length;
  const axisIndexes = seriesList.map((_, i) => i);

  return {
    backgroundColor: 'transparent',
    animation: false,
    axisPointer: {
      link: [{ xAxisIndex: 'all' }],
      lineStyle: { color: '#8a897f', width: 1 },
      label: { backgroundColor: '#232322' },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#232322',
      borderColor: '#32322f',
      textStyle: { color: '#ffffff', fontSize: 12 },
      formatter: (params: unknown) => {
        const list = (Array.isArray(params) ? params : [params]) as TooltipEntry[];
        if (list.length === 0) return '';
        const t = list[0].axisValue ?? list[0].value?.[0] ?? 0;
        const lines = [`<b>t = ${clockTooltip(Number(t))}</b>`];
        for (const e of list) {
          if (e.seriesIndex === undefined) continue;
          const s = seriesList[e.seriesIndex];
          const v = e.value?.[1];
          const text =
            v === null || v === undefined
              ? 'no data'
              : `${v.toFixed(SIGNAL_DECIMALS[s.def.id])} ${s.def.unit}`;
          lines.push(`${s.def.label}: <b>${text}</b>`);
        }
        return lines.join('<br/>');
      },
    },
    title: seriesList.map((s, i) => ({
      text: `${s.def.label}  [${s.def.unit}]`,
      left: 4,
      top: TOP_PAD + i * (ROW_HEIGHT + ROW_GAP) - 20,
      textStyle: { color: '#c3c2b7', fontSize: 12, fontWeight: 600 },
    })),
    grid: seriesList.map((_, i) => ({
      left: 64,
      right: 16,
      top: TOP_PAD + i * (ROW_HEIGHT + ROW_GAP),
      height: ROW_HEIGHT,
    })),
    xAxis: seriesList.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      min: 0,
      max: durationSec,
      axisLabel: {
        show: i === n - 1, // 시간 라벨은 맨 아래 grid만
        color: '#8a897f',
        formatter: (v: number) => clockLabel(v),
      },
      axisLine: { lineStyle: { color: '#32322f' } },
      axisTick: { show: i === n - 1 },
      splitLine: { show: true, lineStyle: { color: '#232322' } },
    })),
    yAxis: seriesList.map((_, i) => ({
      type: 'value',
      gridIndex: i,
      scale: true, // 신호마다 자기 scale 유지
      splitNumber: 3,
      axisLabel: { color: '#8a897f' },
      splitLine: { lineStyle: { color: '#232322' } },
    })),
    dataZoom: [
      // wheel = zoom, drag = pan — 모든 grid의 X축을 함께 움직인다
      { type: 'inside', xAxisIndex: axisIndexes, filterMode: 'none' },
      {
        type: 'slider',
        xAxisIndex: axisIndexes,
        filterMode: 'none',
        bottom: 12,
        height: 26,
        borderColor: '#32322f',
        backgroundColor: '#1a1a19',
        fillerColor: 'rgba(57, 135, 229, 0.15)',
        handleStyle: { color: '#3987e5' },
        textStyle: { color: '#8a897f' },
        labelFormatter: (v: number) => clockLabel(v),
      },
    ],
    series: seriesList.map((s, i) => ({
      name: s.def.label,
      type: 'line',
      xAxisIndex: i,
      yAxisIndex: i,
      data: s.points,
      showSymbol: false,
      sampling: 'lttb', // 시각적 다운샘플링 — zoom 시 원본 정밀도 유지
      lineStyle: { width: 1.2, color: SIGNAL_COLOR[s.def.id] },
      itemStyle: { color: SIGNAL_COLOR[s.def.id] },
      connectNulls: false, // 공백 구간을 선으로 잇지 않는다
    })),
  };
}

interface StackedSignalChartProps {
  seriesList: GraphSeries[];
  durationSec: number;
}

export function StackedSignalChart({ seriesList, durationSec }: StackedSignalChartProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const div = divRef.current;
    if (div === null) return;
    const chart = echarts.init(div);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(div);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    // notMerge: 신호 ON/OFF 시 이전 grid 구성이 남지 않게 전체 교체
    chartRef.current?.setOption(buildOption(seriesList, durationSec), { notMerge: true });
    chartRef.current?.resize();
  }, [seriesList, durationSec]);

  return (
    <div
      ref={divRef}
      className="stacked-chart"
      style={{ height: chartHeightPx(seriesList.length) }}
      data-testid="stacked-chart"
    />
  );
}
