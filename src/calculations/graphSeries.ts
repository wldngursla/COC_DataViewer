/**
 * Graphs 탭용 신호 시리즈 생성 — ParsedLog → 기존 decoder → [elapsedSec, value] 점열.
 *
 * - 확인된 payload 필드와 문서화된 CAN decoder만 그래프로 제공한다.
 * - X축은 run 시작(첫 레코드) 기준 경과 시간[초]. epoch time을 주축으로 쓰지 않는다.
 * - 소스가 없으면 available:false — 0 채움/interpolation/가짜 데이터 금지.
 * - 소스 내부의 큰 timestamp 공백에는 null 점을 삽입해 선이 공백을 가로질러
 *   그려지지 않게 한다(존재하지 않는 구간을 그리지 않는다 — 시험 데이터 신뢰성).
 * - 색/소수점 등 표현은 컴포넌트 몫이다. 이 파일은 React를 모른다.
 */

import type { ParsedLog, CanRawSeries } from '../parser/types';
import { CAN_DATA_BYTES } from '../parser/types';
import {
  CAN_ID_EZ_MSG1,
  CAN_ID_EZ_MSG2,
  CAN_ID_DALY_90,
  CAN_ID_DALY_93,
  decodeAccelerator,
  decodeMotorRpm,
  decodeEzBusVoltage,
  decodeEzBusCurrent,
  decodeControllerTemp,
  decodeMotorTemp,
  decodeBmsVoltage,
  decodeBmsCurrent,
  decodeBmsSoc,
  decodeBmsRemainingCapacityMah,
} from '../decoder/can';
import { rawToCourseDeg, rawToKmh } from '../decoder/gps';
import { rawToG, rawToDps } from '../decoder/imu';
import { analogRawToVolts } from '../decoder/analog';
import { computeTimeRange } from './logSummary';

export type SignalId =
  | 'gpsSpeed'
  | 'gpsCourse'
  | 'accelerator'
  | 'motorRpm'
  | 'ezBusVoltage'
  | 'ezBusCurrent'
  | 'controllerTemp'
  | 'motorTemp'
  | 'wheelFl'
  | 'wheelFr'
  | 'wheelRl'
  | 'wheelRr'
  | 'wheelAverage'
  | 'accX'
  | 'accY'
  | 'accZ'
  | 'gyroX'
  | 'gyroY'
  | 'yawRate'
  | 'imuTemperatureRaw'
  | 'ain1'
  | 'ain2'
  | 'ain3'
  | 'ain4'
  | 'ain5'
  | 'ain6'
  | 'ain7'
  | 'ain8'
  | 'soc'
  | 'voltage'
  | 'current'
  | 'power'
  | 'remainingCapacity';

export type SignalGroup = 'Vehicle' | 'Wheels' | 'Motor' | 'IMU' | 'Analog' | 'Battery';

export interface GraphSignalDef {
  id: SignalId;
  label: string;
  unit: string;
  group: SignalGroup;
  /** 가정/주의가 있는 신호에만 표시하는 짧은 문구 */
  note?: string;
}

/** 고정 표시 순서. IMU는 실측 확정 전이므로 센서 축 기준으로 표기한다. */
export const GRAPH_SIGNALS: readonly GraphSignalDef[] = [
  { id: 'gpsSpeed', label: 'GPS Speed', unit: 'km/h', group: 'Vehicle' },
  { id: 'gpsCourse', label: 'GPS Course', unit: '°', group: 'Vehicle' },
  { id: 'accelerator', label: 'Accelerator Pedal', unit: '%', group: 'Vehicle', note: 'EZkontrol 0x180217EF byte 2' },
  { id: 'motorRpm', label: 'Motor RPM', unit: 'rpm', group: 'Vehicle', note: 'EZkontrol 0x180117EF' },
  { id: 'wheelFl', label: 'Wheel FL', unit: 'km/h', group: 'Wheels', note: 'firmware-calculated float32' },
  { id: 'wheelFr', label: 'Wheel FR', unit: 'km/h', group: 'Wheels', note: 'firmware-calculated float32' },
  { id: 'wheelRl', label: 'Wheel RL', unit: 'km/h', group: 'Wheels', note: 'firmware-calculated float32' },
  { id: 'wheelRr', label: 'Wheel RR', unit: 'km/h', group: 'Wheels', note: 'firmware-calculated float32' },
  { id: 'wheelAverage', label: 'Wheel Average', unit: 'km/h', group: 'Wheels' },
  { id: 'ezBusVoltage', label: 'Motor Bus Voltage', unit: 'V', group: 'Motor', note: 'EZkontrol 0x180117EF' },
  { id: 'ezBusCurrent', label: 'Motor Bus Current', unit: 'A', group: 'Motor', note: 'EZkontrol 0x180117EF' },
  { id: 'controllerTemp', label: 'Controller Temp', unit: '°C', group: 'Motor', note: 'EZkontrol 0x180217EF' },
  { id: 'motorTemp', label: 'Motor Temp', unit: '°C', group: 'Motor', note: 'EZkontrol 0x180217EF' },
  { id: 'accX', label: 'Acceleration X', unit: 'g', group: 'IMU', note: '센서 축 기준' },
  { id: 'accY', label: 'Acceleration Y', unit: 'g', group: 'IMU', note: '센서 축 기준' },
  { id: 'accZ', label: 'Acceleration Z', unit: 'g', group: 'IMU', note: '센서 축 기준' },
  { id: 'gyroX', label: 'Gyro X', unit: 'deg/s', group: 'IMU', note: '센서 축 기준' },
  { id: 'gyroY', label: 'Gyro Y', unit: 'deg/s', group: 'IMU', note: '센서 축 기준' },
  { id: 'yawRate', label: 'Gyro Z (Yaw Rate)', unit: 'deg/s', group: 'IMU', note: '센서 축 기준' },
  { id: 'imuTemperatureRaw', label: 'IMU Temperature', unit: 'raw', group: 'IMU', note: '칩 변환식 미확정' },
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `ain${index + 1}` as SignalId,
    label: `Analog IN ${index + 1}`,
    unit: 'V',
    group: 'Analog' as const,
    note: 'ADS1115 ±4.096 V · 채널 용도 미지정',
  })),
  { id: 'soc', label: 'Battery SOC', unit: '%', group: 'Battery', note: 'Daly 0x18904001' },
  { id: 'voltage', label: 'Battery Voltage', unit: 'V', group: 'Battery', note: 'Daly 0x18904001' },
  { id: 'current', label: 'Battery Current', unit: 'A', group: 'Battery', note: '방전 − / 충전 + (문서 기준)' },
  { id: 'power', label: 'Battery Power', unit: 'kW', group: 'Battery', note: 'P = V × I / 1000 (signed)' },
  { id: 'remainingCapacity', label: 'Remaining Capacity', unit: 'Ah', group: 'Battery', note: 'Daly 0x18934001' },
];

/** [elapsedSec, value] — 소스 공백 위치에는 [elapsedSec, null]이 삽입된다 */
export type GraphPoint = [number, number | null];

export interface GraphSeries {
  def: GraphSignalDef;
  available: boolean;
  points: GraphPoint[];
}

export interface GraphSeriesProvider {
  /** run 전체 길이 [초] */
  durationSec: number;
  isAvailable(id: SignalId): boolean;
  /** 시리즈는 최초 요청 시 1회 생성 후 캐시된다 */
  get(id: SignalId): GraphSeries;
}

/* ------------------------------------------------------------------ */

function isDecodableFrame(can: CanRawSeries, i: number, id: number): boolean {
  return can.id[i] === id && can.remote[i] === 0 && can.len[i] >= CAN_DATA_BYTES;
}

/**
 * timestamp 공백 임계값[ms]: 중앙값 샘플링 간격의 5배(최소 1000ms).
 * 이보다 긴 공백에는 null 점을 넣어 선을 끊는다.
 */
function gapThresholdMs(timestampsMs: number[]): number {
  if (timestampsMs.length < 3) return Infinity;
  const dts: number[] = [];
  const step = Math.max(1, Math.floor((timestampsMs.length - 1) / 512));
  for (let i = step; i < timestampsMs.length; i += step) {
    dts.push(timestampsMs[i] - timestampsMs[i - step]);
  }
  dts.sort((a, b) => a - b);
  const medianPerRecord = dts[Math.floor(dts.length / 2)] / step;
  return Math.max(1000, medianPerRecord * 5);
}

/** (ms 타임스탬프, 값) 배열 → 경과초 점열 + 공백 break */
function toPoints(timestampsMs: number[], values: number[], t0Ms: number): GraphPoint[] {
  const threshold = gapThresholdMs(timestampsMs);
  const points: GraphPoint[] = [];
  for (let i = 0; i < timestampsMs.length; i++) {
    if (i > 0 && timestampsMs[i] - timestampsMs[i - 1] > threshold) {
      points.push([(timestampsMs[i - 1] - t0Ms + 1) / 1000, null]);
    }
    points.push([(timestampsMs[i] - t0Ms) / 1000, values[i]]);
  }
  return points;
}

export function createGraphSeriesProvider(result: ParsedLog): GraphSeriesProvider {
  const range = computeTimeRange(result);
  const t0Ms = range !== null ? range.firstMs : 0;
  const durationSec = range !== null ? range.durationMs / 1000 : 0;

  // 소스 존재 여부 (가용성 표시용 — 시리즈 생성 없이 1회 스캔)
  let hasEz = false;
  let hasAccelerator = false;
  let hasDaly = false;
  let hasDalyCapacity = false;
  const can = result.can;
  for (
    let i = 0;
    i < can.count && !(hasEz && hasAccelerator && hasDaly && hasDalyCapacity);
    i++
  ) {
    if (!hasEz && isDecodableFrame(can, i, CAN_ID_EZ_MSG1)) hasEz = true;
    if (!hasAccelerator && isDecodableFrame(can, i, CAN_ID_EZ_MSG2)) hasAccelerator = true;
    if (!hasDaly && isDecodableFrame(can, i, CAN_ID_DALY_90)) hasDaly = true;
    if (!hasDalyCapacity && isDecodableFrame(can, i, CAN_ID_DALY_93)) hasDalyCapacity = true;
  }

  const hasWheelSpeed =
    result.digital.format === 'wheel-speed-kmh' && result.digital.count > 0;
  const hasAnalog = result.analog.count > 0;

  const availability: Record<SignalId, boolean> = {
    gpsSpeed: result.gps.count > 0,
    gpsCourse: result.gps.count > 0,
    accelerator: hasAccelerator,
    motorRpm: hasEz,
    ezBusVoltage: hasEz,
    ezBusCurrent: hasEz,
    controllerTemp: hasAccelerator,
    motorTemp: hasAccelerator,
    wheelFl: hasWheelSpeed,
    wheelFr: hasWheelSpeed,
    wheelRl: hasWheelSpeed,
    wheelRr: hasWheelSpeed,
    wheelAverage: hasWheelSpeed,
    accX: result.gyro.count > 0,
    accY: result.gyro.count > 0,
    accZ: result.gyro.count > 0,
    gyroX: result.gyro.count > 0,
    gyroY: result.gyro.count > 0,
    yawRate: result.gyro.count > 0,
    imuTemperatureRaw: result.gyro.count > 0,
    ain1: hasAnalog,
    ain2: hasAnalog,
    ain3: hasAnalog,
    ain4: hasAnalog,
    ain5: hasAnalog,
    ain6: hasAnalog,
    ain7: hasAnalog,
    ain8: hasAnalog,
    soc: hasDaly,
    voltage: hasDaly,
    current: hasDaly,
    power: hasDaly,
    remainingCapacity: hasDalyCapacity,
  };

  // Daly 0x90 한 번 스캔으로 V/I/SOC/P 공유 (신호별 재스캔 방지)
  let bmsCache: { t: number[]; v: number[]; i: number[]; soc: number[] } | null = null;
  const bmsFrames = () => {
    if (bmsCache === null) {
      const t: number[] = [];
      const v: number[] = [];
      const iA: number[] = [];
      const soc: number[] = [];
      for (let i = 0; i < can.count; i++) {
        if (!isDecodableFrame(can, i, CAN_ID_DALY_90)) continue;
        const data = can.data.subarray(i * CAN_DATA_BYTES, (i + 1) * CAN_DATA_BYTES);
        t.push(can.timestamp[i]);
        v.push(decodeBmsVoltage(data));
        iA.push(decodeBmsCurrent(data));
        soc.push(decodeBmsSoc(data));
      }
      bmsCache = { t, v, i: iA, soc };
    }
    return bmsCache;
  };

  const canPoints = (frameId: number, decode: (data: Uint8Array) => number): GraphPoint[] => {
    const timestamps: number[] = [];
    const values: number[] = [];
    for (let index = 0; index < can.count; index++) {
      if (!isDecodableFrame(can, index, frameId)) continue;
      timestamps.push(can.timestamp[index]);
      values.push(decode(can.data.subarray(index * CAN_DATA_BYTES, (index + 1) * CAN_DATA_BYTES)));
    }
    return toPoints(timestamps, values, t0Ms);
  };

  function build(id: SignalId): GraphPoint[] {
    switch (id) {
      case 'gpsSpeed': {
        const t: number[] = [];
        const v: number[] = [];
        for (let i = 0; i < result.gps.count; i++) {
          t.push(result.gps.timestamp[i]);
          v.push(rawToKmh(result.gps.speedRaw[i]));
        }
        return toPoints(t, v, t0Ms);
      }
      case 'gpsCourse': {
        const t: number[] = [];
        const v: number[] = [];
        for (let i = 0; i < result.gps.count; i++) {
          t.push(result.gps.timestamp[i]);
          v.push(rawToCourseDeg(result.gps.courseRaw[i]));
        }
        return toPoints(t, v, t0Ms);
      }
      case 'motorRpm': {
        return canPoints(CAN_ID_EZ_MSG1, decodeMotorRpm);
      }
      case 'accelerator': {
        return canPoints(CAN_ID_EZ_MSG2, decodeAccelerator);
      }
      case 'ezBusVoltage': {
        return canPoints(CAN_ID_EZ_MSG1, decodeEzBusVoltage);
      }
      case 'ezBusCurrent': {
        return canPoints(CAN_ID_EZ_MSG1, decodeEzBusCurrent);
      }
      case 'controllerTemp': {
        return canPoints(CAN_ID_EZ_MSG2, decodeControllerTemp);
      }
      case 'motorTemp': {
        return canPoints(CAN_ID_EZ_MSG2, decodeMotorTemp);
      }
      case 'wheelFl':
      case 'wheelFr':
      case 'wheelRl':
      case 'wheelRr':
      case 'wheelAverage': {
        const digital = result.digital;
        if (digital.format !== 'wheel-speed-kmh') return [];
        const wheelIndex =
          id === 'wheelFl' ? 0 : id === 'wheelFr' ? 1 : id === 'wheelRl' ? 2 : 3;
        const t: number[] = [];
        const v: number[] = [];
        for (let i = 0; i < digital.count; i++) {
          t.push(digital.timestamp[i]);
          v.push(
            id === 'wheelAverage'
              ? digital.wheelSpeedKmh.reduce((sum, wheel) => sum + wheel[i], 0) / 4
              : digital.wheelSpeedKmh[wheelIndex][i],
          );
        }
        return toPoints(t, v, t0Ms);
      }
      case 'accX':
      case 'accY':
      case 'accZ':
      case 'gyroX':
      case 'gyroY':
      case 'yawRate': {
        const g = result.gyro;
        const src =
          id === 'accX' ? g.accelX
            : id === 'accY' ? g.accelY
              : id === 'accZ' ? g.accelZ
                : id === 'gyroX' ? g.gyroX
                  : id === 'gyroY' ? g.gyroY
                    : g.gyroZ;
        const convert = id === 'accX' || id === 'accY' || id === 'accZ' ? rawToG : rawToDps;
        const t: number[] = [];
        const v: number[] = [];
        for (let i = 0; i < g.count; i++) {
          t.push(g.timestamp[i]);
          v.push(convert(src[i]));
        }
        return toPoints(t, v, t0Ms);
      }
      case 'imuTemperatureRaw': {
        return toPoints(
          Array.from(result.gyro.timestamp),
          Array.from(result.gyro.temperature),
          t0Ms,
        );
      }
      case 'ain1':
      case 'ain2':
      case 'ain3':
      case 'ain4':
      case 'ain5':
      case 'ain6':
      case 'ain7':
      case 'ain8': {
        const channel = Number(id.slice(3)) - 1;
        return toPoints(
          Array.from(result.analog.timestamp),
          Array.from(result.analog.ain[channel], analogRawToVolts),
          t0Ms,
        );
      }
      case 'soc': {
        const b = bmsFrames();
        return toPoints(b.t, b.soc, t0Ms);
      }
      case 'voltage': {
        const b = bmsFrames();
        return toPoints(b.t, b.v, t0Ms);
      }
      case 'current': {
        const b = bmsFrames();
        return toPoints(b.t, b.i, t0Ms);
      }
      case 'power': {
        // P[kW] = V × I / 1000 — 같은 프레임의 V·I이므로 timestamp가 정확히 일치
        const b = bmsFrames();
        const p = b.v.map((v, i) => (v * b.i[i]) / 1000);
        return toPoints(b.t, p, t0Ms);
      }
      case 'remainingCapacity': {
        return canPoints(
          CAN_ID_DALY_93,
          (data) => decodeBmsRemainingCapacityMah(data) / 1000,
        );
      }
    }
  }

  const cache = new Map<SignalId, GraphSeries>();

  return {
    durationSec,
    isAvailable: (id) => availability[id],
    get(id) {
      let series = cache.get(id);
      if (series === undefined) {
        const def = GRAPH_SIGNALS.find((d) => d.id === id);
        if (def === undefined) throw new Error(`unknown signal: ${id}`);
        series = availability[id]
          ? { def, available: true, points: build(id) }
          : { def, available: false, points: [] };
        cache.set(id, series);
      }
      return series;
    },
  };
}
