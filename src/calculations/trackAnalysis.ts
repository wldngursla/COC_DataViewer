/**
 * Spatial vehicle analysis for the GPS track map.
 *
 * Track geometry is decoded locally from ParsedLog. Selecting a GPS point uses
 * nearest-timestamp samples without interpolation. A match is accepted only
 * within max(3 × that signal's median interval, 250 ms), so long data gaps do
 * not silently attach unrelated telemetry to a map position.
 */

import type { CanRawSeries, ParsedLog } from '../parser/types';
import { CAN_DATA_BYTES } from '../parser/types';
import {
  CAN_ID_DALY_90,
  CAN_ID_EZ_MSG1,
  CAN_ID_EZ_MSG2,
  decodeAccelerator,
  decodeBmsCurrent,
  decodeBmsVoltage,
  decodeMotorRpm,
} from '../decoder/can';
import { haversineMeters, rawToDecimalDegrees, rawToKmh } from '../decoder/gps';
import { rawToDps, rawToG } from '../decoder/imu';
import { computeMedianIntervalMs } from './dataHealth';
import { computeTimeRange } from './logSummary';

export const MIN_NEAREST_TOLERANCE_MS = 250;

export interface TrackPoint {
  sourceIndex: number;
  timestampMs: number;
  elapsedMs: number;
  latitudeDeg: number;
  longitudeDeg: number;
  speedKmh: number;
}

export interface SpeedSegment {
  startPointIndex: number;
  endPointIndex: number;
  /** Mean GPS speed of the segment endpoints [km/h]. */
  speedKmh: number;
}

export interface TrackAnalysis {
  points: TrackPoint[];
  segments: SpeedSegment[];
  startPoint: TrackPoint | null;
  endPoint: TrackPoint | null;
  minimumSpeedKmh: number | null;
  maximumSpeedKmh: number | null;
}

export interface SelectedTrackTelemetry {
  point: TrackPoint;
  acceleratorPedalPercent: number | null;
  motorRpm: number | null;
  accelerationXG: number | null;
  accelerationYG: number | null;
  accelerationZG: number | null;
  gyroZDps: number | null;
  batteryCurrentA: number | null;
  batteryPowerKw: number | null;
}

export interface SelectedTimeTelemetry {
  timestampMs: number;
  gpsPoint: TrackPoint | null;
  gpsSpeedKmh: number | null;
  acceleratorPedalPercent: number | null;
  motorRpm: number | null;
  accelerationXG: number | null;
  accelerationYG: number | null;
  accelerationZG: number | null;
  gyroZDps: number | null;
  batteryCurrentA: number | null;
  batteryPowerKw: number | null;
}

export interface SpatialTelemetrySelector {
  select(point: TrackPoint): SelectedTrackTelemetry;
  selectTimestamp(timestampMs: number): SelectedTimeTelemetry;
}

interface TimedSample<T> {
  timestampMs: number;
  value: T;
}

interface ImuValues {
  accelerationXG: number;
  accelerationYG: number;
  accelerationZG: number;
  gyroZDps: number;
}

interface BmsValues {
  currentA: number;
  powerKw: number;
}

interface PreparedSamples<T> {
  samples: TimedSample<T>[];
  toleranceMs: number;
}

function isDecodableFrame(can: CanRawSeries, index: number, id: number): boolean {
  return (
    can.id[index] === id &&
    can.remote[index] === 0 &&
    can.len[index] >= CAN_DATA_BYTES
  );
}

function frameData(can: CanRawSeries, index: number): Uint8Array {
  return can.data.subarray(index * CAN_DATA_BYTES, (index + 1) * CAN_DATA_BYTES);
}

function prepareSamples<T>(samples: TimedSample<T>[]): PreparedSamples<T> {
  samples.sort((a, b) => a.timestampMs - b.timestampMs);
  const medianIntervalMs = computeMedianIntervalMs(samples.map((sample) => sample.timestampMs));
  return {
    samples,
    toleranceMs: Math.max(
      MIN_NEAREST_TOLERANCE_MS,
      3 * (medianIntervalMs ?? 0),
    ),
  };
}

function findNearestSample<T>(
  prepared: PreparedSamples<T>,
  timestampMs: number,
): TimedSample<T> | null {
  const { samples, toleranceMs } = prepared;
  if (samples.length === 0) return null;

  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].timestampMs < timestampMs) low = middle + 1;
    else high = middle;
  }

  const after = low < samples.length ? samples[low] : null;
  const before = low > 0 ? samples[low - 1] : null;
  let nearest: TimedSample<T> | null = after;
  if (
    before !== null &&
    (after === null ||
      timestampMs - before.timestampMs <= after.timestampMs - timestampMs)
  ) {
    nearest = before;
  }

  return nearest !== null && Math.abs(nearest.timestampMs - timestampMs) <= toleranceMs
    ? nearest
    : null;
}

export function computeTrackAnalysis(parsed: ParsedLog): TrackAnalysis {
  const range = computeTimeRange(parsed);
  const firstTimestampMs = range?.firstMs ?? 0;
  const points: TrackPoint[] = [];

  for (let index = 0; index < parsed.gps.count; index++) {
    const latitudeDeg = rawToDecimalDegrees(
      parsed.gps.latitudeRaw[index],
      parsed.gps.latDir[index],
    );
    const longitudeDeg = rawToDecimalDegrees(
      parsed.gps.longitudeRaw[index],
      parsed.gps.lonDir[index],
    );
    if (
      !Number.isFinite(latitudeDeg) ||
      !Number.isFinite(longitudeDeg) ||
      Math.abs(latitudeDeg) > 90 ||
      Math.abs(longitudeDeg) > 180
    ) {
      continue;
    }

    points.push({
      sourceIndex: index,
      timestampMs: parsed.gps.timestamp[index],
      elapsedMs: parsed.gps.timestamp[index] - firstTimestampMs,
      latitudeDeg,
      longitudeDeg,
      speedKmh: rawToKmh(parsed.gps.speedRaw[index]),
    });
  }

  points.sort((a, b) => a.timestampMs - b.timestampMs);

  const segments: SpeedSegment[] = [];
  let minimumSpeedKmh = Infinity;
  let maximumSpeedKmh = -Infinity;
  for (let index = 0; index < points.length; index++) {
    minimumSpeedKmh = Math.min(minimumSpeedKmh, points[index].speedKmh);
    maximumSpeedKmh = Math.max(maximumSpeedKmh, points[index].speedKmh);
    if (index === 0) continue;
    segments.push({
      startPointIndex: index - 1,
      endPointIndex: index,
      speedKmh: (points[index - 1].speedKmh + points[index].speedKmh) / 2,
    });
  }

  return {
    points,
    segments,
    startPoint: points[0] ?? null,
    endPoint: points[points.length - 1] ?? null,
    minimumSpeedKmh: points.length > 0 ? minimumSpeedKmh : null,
    maximumSpeedKmh: points.length > 0 ? maximumSpeedKmh : null,
  };
}

export function findNearestTrackPointIndex(
  points: readonly TrackPoint[],
  latitudeDeg: number,
  longitudeDeg: number,
): number | null {
  if (points.length === 0) return null;
  let nearestIndex = 0;
  let nearestDistanceMeters = Infinity;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const distanceMeters = haversineMeters(
      latitudeDeg,
      longitudeDeg,
      point.latitudeDeg,
      point.longitudeDeg,
    );
    if (distanceMeters < nearestDistanceMeters) {
      nearestDistanceMeters = distanceMeters;
      nearestIndex = index;
    }
  }
  return nearestIndex;
}

export function createSpatialTelemetrySelector(
  parsed: ParsedLog,
  track: TrackAnalysis = computeTrackAnalysis(parsed),
): SpatialTelemetrySelector {
  const motorSamples: TimedSample<number>[] = [];
  const acceleratorSamples: TimedSample<number>[] = [];
  const bmsSamples: TimedSample<BmsValues>[] = [];
  for (let index = 0; index < parsed.can.count; index++) {
    if (isDecodableFrame(parsed.can, index, CAN_ID_EZ_MSG1)) {
      motorSamples.push({
        timestampMs: parsed.can.timestamp[index],
        value: decodeMotorRpm(frameData(parsed.can, index)),
      });
    }
    if (isDecodableFrame(parsed.can, index, CAN_ID_EZ_MSG2)) {
      acceleratorSamples.push({
        timestampMs: parsed.can.timestamp[index],
        value: decodeAccelerator(frameData(parsed.can, index)),
      });
    }
    if (isDecodableFrame(parsed.can, index, CAN_ID_DALY_90)) {
      const data = frameData(parsed.can, index);
      const voltageV = decodeBmsVoltage(data);
      const currentA = decodeBmsCurrent(data);
      bmsSamples.push({
        timestampMs: parsed.can.timestamp[index],
        value: { currentA, powerKw: (voltageV * currentA) / 1000 },
      });
    }
  }

  const imuSamples: TimedSample<ImuValues>[] = [];
  for (let index = 0; index < parsed.gyro.count; index++) {
    imuSamples.push({
      timestampMs: parsed.gyro.timestamp[index],
      value: {
        accelerationXG: rawToG(parsed.gyro.accelX[index]),
        accelerationYG: rawToG(parsed.gyro.accelY[index]),
        accelerationZG: rawToG(parsed.gyro.accelZ[index]),
        gyroZDps: rawToDps(parsed.gyro.gyroZ[index]),
      },
    });
  }

  const preparedMotor = prepareSamples(motorSamples);
  const preparedAccelerator = prepareSamples(acceleratorSamples);
  const preparedImu = prepareSamples(imuSamples);
  const preparedBms = prepareSamples(bmsSamples);
  const preparedGps = prepareSamples(
    track.points.map((point) => ({ timestampMs: point.timestampMs, value: point })),
  );

  const selectSources = (timestampMs: number) => {
    const accelerator = findNearestSample(preparedAccelerator, timestampMs);
    const motor = findNearestSample(preparedMotor, timestampMs);
    const imu = findNearestSample(preparedImu, timestampMs);
    const bms = findNearestSample(preparedBms, timestampMs);
    return {
      acceleratorPedalPercent: accelerator?.value ?? null,
      motorRpm: motor?.value ?? null,
      accelerationXG: imu?.value.accelerationXG ?? null,
      accelerationYG: imu?.value.accelerationYG ?? null,
      accelerationZG: imu?.value.accelerationZG ?? null,
      gyroZDps: imu?.value.gyroZDps ?? null,
      batteryCurrentA: bms?.value.currentA ?? null,
      batteryPowerKw: bms?.value.powerKw ?? null,
    };
  };

  return {
    select(point) {
      return {
        point,
        ...selectSources(point.timestampMs),
      };
    },
    selectTimestamp(timestampMs) {
      const gps = findNearestSample(preparedGps, timestampMs)?.value ?? null;
      return {
        timestampMs,
        gpsPoint: gps,
        gpsSpeedKmh: gps?.speedKmh ?? null,
        ...selectSources(timestampMs),
      };
    },
  };
}
