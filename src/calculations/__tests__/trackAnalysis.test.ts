import { describe, expect, it } from 'vitest';
import { CAN_ID_DALY_90, CAN_ID_EZ_MSG1, CAN_ID_EZ_MSG2 } from '../../decoder/can';
import { rawToCourseDeg } from '../../decoder/gps';
import { parseLog } from '../../parser/parseLog';
import {
  bootRecord,
  buildLog,
  canRecord,
  gpsRecord,
  gyroRecord,
} from '../../parser/__tests__/fixtures';
import {
  computeTrackAnalysis,
  createSpatialTelemetrySelector,
  findNearestTrackPointIndex,
} from '../trackAnalysis';
import { createGraphSeriesProvider } from '../graphSeries';

const boot = () => bootRecord({ timestamp: 0, bootTime: 1_755_820_800 });

function toNmeaRaw(decimalDegrees: number): number {
  const absolute = Math.abs(decimalDegrees);
  const degrees = Math.floor(absolute);
  const minutes = (absolute - degrees) * 60;
  return Math.round((degrees * 100 + minutes) * 1e5);
}

function gps(
  timestamp: number,
  latitude: number,
  longitude: number,
  speedKmh: number,
  courseDeg = 0,
): Uint8Array {
  return gpsRecord({
    timestamp,
    latitudeRaw: toNmeaRaw(latitude),
    longitudeRaw: toNmeaRaw(longitude),
    latDir: latitude < 0 ? 'S' : 'N',
    lonDir: longitude < 0 ? 'W' : 'E',
    speedRaw: Math.round(speedKmh * 100),
    courseRaw: Math.round(courseDeg * 100),
  });
}

function ezRpm(timestamp: number, rpm: number): Uint8Array {
  const raw = Math.round((rpm + 2000) * 10);
  return canRecord({
    timestamp,
    id: CAN_ID_EZ_MSG1,
    extended: true,
    data: [0, 0, 0, 0, 0, 0, raw & 0xff, raw >> 8],
  });
}

function accelerator(timestamp: number, percent: number): Uint8Array {
  return canRecord({
    timestamp,
    id: CAN_ID_EZ_MSG2,
    extended: true,
    data: [0, 0, percent, 0, 0, 0, 0, 0],
  });
}

function daly90(timestamp: number, voltageV: number, currentA: number): Uint8Array {
  const voltageRaw = Math.round(voltageV * 10);
  const currentRaw = Math.round(currentA * 10 + 30_000);
  return canRecord({
    timestamp,
    id: CAN_ID_DALY_90,
    extended: true,
    data: [
      voltageRaw >> 8,
      voltageRaw & 0xff,
      0,
      0,
      currentRaw >> 8,
      currentRaw & 0xff,
      0,
      0,
    ],
  });
}

function parse(records: Uint8Array[]) {
  return parseLog(buildLog([boot(), ...records]));
}

describe('computeTrackAnalysis', () => {
  it('creates decoded GPS track points with run-relative elapsed time', () => {
    const track = computeTrackAnalysis(parse([gps(1_000, 37.5, 127.1, 42.5)]));

    expect(track.points).toHaveLength(1);
    expect(track.points[0].latitudeDeg).toBeCloseTo(37.5, 5);
    expect(track.points[0].longitudeDeg).toBeCloseTo(127.1, 5);
    expect(track.points[0].speedKmh).toBeCloseTo(42.5, 6);
    expect(track.points[0].elapsedMs).toBe(1_000);
  });

  it('keeps non-zero speed and course distinct across graph, map, and current values', () => {
    const parsed = parse([gps(90_000, 37.5, 127.1, 92.73, 285.45)]);
    const graphSpeed = createGraphSeriesProvider(parsed).get('gpsSpeed').points[0][1];
    const track = computeTrackAnalysis(parsed);
    const selectedPoint = createSpatialTelemetrySelector(parsed, track).select(track.points[0]);
    const currentValues = createSpatialTelemetrySelector(parsed, track).selectTimestamp(90_000);

    expect(parsed.gps.speedRaw[0]).toBe(9273);
    expect(parsed.gps.courseRaw[0]).toBe(28545);
    expect(rawToCourseDeg(parsed.gps.courseRaw[0])).toBeCloseTo(285.45, 6);
    expect(graphSpeed).toBeCloseTo(92.73, 6);
    expect(selectedPoint.point.speedKmh).toBeCloseTo(92.73, 6);
    expect(currentValues.gpsSpeedKmh).toBeCloseTo(92.73, 6);
  });

  it('uses chronological points for start and end', () => {
    const track = computeTrackAnalysis(parse([
      gps(3_000, 37.3, 127, 30),
      gps(1_000, 37.1, 127, 10),
      gps(2_000, 37.2, 127, 20),
    ]));

    expect(track.startPoint?.timestampMs).toBe(1_000);
    expect(track.endPoint?.timestampMs).toBe(3_000);
  });

  it('creates speed segments using endpoint mean speed', () => {
    const track = computeTrackAnalysis(parse([
      gps(1_000, 37, 127, 10),
      gps(2_000, 37.001, 127, 30),
      gps(3_000, 37.002, 127, 50),
    ]));

    expect(track.segments).toEqual([
      { startPointIndex: 0, endPointIndex: 1, speedKmh: 20 },
      { startPointIndex: 1, endPointIndex: 2, speedKmh: 40 },
    ]);
  });

  it('selects the GPS sample nearest a clicked route coordinate', () => {
    const track = computeTrackAnalysis(parse([
      gps(1_000, 37, 127, 10),
      gps(2_000, 37.01, 127, 20),
      gps(3_000, 37.02, 127, 30),
    ]));

    expect(findNearestTrackPointIndex(track.points, 37.0101, 127)).toBe(1);
  });

  it('matches the nearest motor RPM sample within cadence tolerance', () => {
    const parsed = parse([
      gps(1_150, 37, 127, 10),
      ezRpm(1_000, 1_000),
      ezRpm(1_100, 1_400),
      ezRpm(1_200, 1_800),
    ]);
    const point = computeTrackAnalysis(parsed).points[0];

    expect(createSpatialTelemetrySelector(parsed).select(point).motorRpm).toBeCloseTo(1_400, 6);
  });

  it('matches the nearest IMU sample without interpolation', () => {
    const parsed = parse([
      gps(1_020, 37, 127, 10),
      gyroRecord({ timestamp: 1_000, accel: [4_096, -2_048, 8_192], gyro: [0, 0, -655] }),
      gyroRecord({ timestamp: 1_100, accel: [0, 0, 0], gyro: [0, 0, 0] }),
    ]);
    const point = computeTrackAnalysis(parsed).points[0];
    const selected = createSpatialTelemetrySelector(parsed).select(point);

    expect(selected.accelerationXG).toBeCloseTo(1, 6);
    expect(selected.accelerationYG).toBeCloseTo(-0.5, 6);
    expect(selected.accelerationZG).toBeCloseTo(2, 6);
    expect(selected.gyroZDps).toBeCloseTo(-10, 6);
  });

  it('matches nearest Daly current and signed power from the same frame', () => {
    const parsed = parse([
      gps(1_100, 37, 127, 10),
      daly90(1_000, 100, -40),
      daly90(2_000, 90, -20),
    ]);
    const point = computeTrackAnalysis(parsed).points[0];
    const selected = createSpatialTelemetrySelector(parsed).select(point);

    expect(selected.batteryCurrentA).toBeCloseTo(-40, 6);
    expect(selected.batteryPowerKw).toBeCloseTo(-4, 6);
  });

  it('returns N/A-ready nulls when nearest samples exceed tolerance', () => {
    const parsed = parse([
      gps(2_000, 37, 127, 10),
      ezRpm(0, 1_000),
      ezRpm(100, 1_100),
      gyroRecord({ timestamp: 0, accel: [1, 2, 3], gyro: [0, 0, 4] }),
      gyroRecord({ timestamp: 100, accel: [1, 2, 3], gyro: [0, 0, 4] }),
      daly90(0, 100, -10),
      daly90(100, 100, -10),
    ]);
    const point = computeTrackAnalysis(parsed).points[0];
    const selected = createSpatialTelemetrySelector(parsed).select(point);

    expect(selected.motorRpm).toBeNull();
    expect(selected.accelerationXG).toBeNull();
    expect(selected.gyroZDps).toBeNull();
    expect(selected.batteryCurrentA).toBeNull();
    expect(selected.batteryPowerKw).toBeNull();
  });

  it('returns an empty track when GPS is missing', () => {
    const track = computeTrackAnalysis(parse([ezRpm(1_000, 1_000)]));

    expect(track.points).toEqual([]);
    expect(track.startPoint).toBeNull();
    expect(track.endPoint).toBeNull();
  });

  it('matches selected time to nearest GPS and accelerator samples', () => {
    const parsed = parse([
      gps(1_000, 37, 127, 10),
      gps(1_100, 37.001, 127, 20),
      accelerator(1_000, 25),
      accelerator(1_100, 75),
    ]);
    const track = computeTrackAnalysis(parsed);
    const selected = createSpatialTelemetrySelector(parsed, track).selectTimestamp(1_080);

    expect(selected.gpsPoint).toBe(track.points[1]);
    expect(selected.gpsSpeedKmh).toBeCloseTo(20, 6);
    expect(selected.acceleratorPedalPercent).toBe(75);
  });

  it('matches selected time to nearest RPM, IMU, and BMS without interpolation', () => {
    const parsed = parse([
      ezRpm(1_000, 1_500),
      gyroRecord({ timestamp: 1_020, accel: [4_096, -2_048, 0], gyro: [0, 0, 655] }),
      daly90(1_040, 100, -30),
    ]);
    const selected = createSpatialTelemetrySelector(parsed).selectTimestamp(1_030);

    expect(selected.motorRpm).toBeCloseTo(1_500, 6);
    expect(selected.accelerationXG).toBeCloseTo(1, 6);
    expect(selected.accelerationYG).toBeCloseTo(-0.5, 6);
    expect(selected.gyroZDps).toBeCloseTo(10, 6);
    expect(selected.batteryCurrentA).toBeCloseTo(-30, 6);
    expect(selected.batteryPowerKw).toBeCloseTo(-3, 6);
  });

  it('returns N/A-ready values when selected time exceeds source tolerances', () => {
    const parsed = parse([
      gps(0, 37, 127, 10),
      gps(100, 37.001, 127, 20),
      accelerator(0, 10),
      accelerator(100, 20),
      ezRpm(0, 1_000),
      ezRpm(100, 1_100),
    ]);
    const selected = createSpatialTelemetrySelector(parsed).selectTimestamp(2_000);

    expect(selected.gpsPoint).toBeNull();
    expect(selected.gpsSpeedKmh).toBeNull();
    expect(selected.acceleratorPedalPercent).toBeNull();
    expect(selected.motorRpm).toBeNull();
  });

  it('keeps one GPS point with start/end markers and no segments', () => {
    const track = computeTrackAnalysis(parse([gps(1_000, 37, 127, 10)]));

    expect(track.points).toHaveLength(1);
    expect(track.segments).toHaveLength(0);
    expect(track.startPoint).toBe(track.points[0]);
    expect(track.endPoint).toBe(track.points[0]);
  });
});
