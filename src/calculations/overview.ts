/**
 * Overview-page derived values. Pure functions over the raw columnar series —
 * decoding rules come from src/decoder (documented signals only), presentation
 * stays in the components.
 *
 * Every function returns null when its data source is absent from the log:
 * the UI shows N/A instead of a guessed value.
 */

import type { CanRawSeries, GpsRawSeries, GyroRawSeries } from '../parser/types';
import { CAN_DATA_BYTES } from '../parser/types';
import {
  CAN_ID_EZ_MSG1,
  CAN_ID_DALY_90,
  decodeMotorRpm,
  decodeBmsSoc,
  decodeBmsVoltage,
} from '../decoder/can';
import { rawToKmh } from '../decoder/gps';
import { rawToG, selectAxis, IMU_AXIS_MAP } from '../decoder/imu';

/** data frames only: not RTR, and a full 8-byte payload for the documented signals */
function isDecodableFrame(can: CanRawSeries, i: number, id: number): boolean {
  return can.id[i] === id && can.remote[i] === 0 && can.len[i] >= CAN_DATA_BYTES;
}

function frameData(can: CanRawSeries, i: number): Uint8Array {
  return can.data.subarray(i * CAN_DATA_BYTES, (i + 1) * CAN_DATA_BYTES);
}

/** Max GPS speed [km/h], or null when the log has no GPS records. */
export function computeMaxGpsSpeedKmh(gps: GpsRawSeries): number | null {
  if (gps.count === 0) return null;
  let maxRaw = 0;
  for (let i = 0; i < gps.count; i++) {
    if (gps.speedRaw[i] > maxRaw) maxRaw = gps.speedRaw[i];
  }
  return rawToKmh(maxRaw);
}

/** Max motor RPM from EZkontrol 0x180117EF, or null when no such frame exists. */
export function computeMaxMotorRpm(can: CanRawSeries): number | null {
  let max: number | null = null;
  for (let i = 0; i < can.count; i++) {
    if (!isDecodableFrame(can, i, CAN_ID_EZ_MSG1)) continue;
    const rpm = decodeMotorRpm(frameData(can, i));
    if (max === null || rpm > max) max = rpm;
  }
  return max;
}

export interface MaxAccelG {
  /** max |longitudinal| acceleration [g], per IMU_AXIS_MAP (가정 — 실측 확인 전) */
  longitudinalG: number;
  /** max |lateral| acceleration [g] */
  lateralG: number;
}

/** Peak accelerations from the IMU, or null when the log has no IMU records. */
export function computeMaxAccelG(gyro: GyroRawSeries): MaxAccelG | null {
  if (gyro.count === 0) return null;
  let maxLon = 0;
  let maxLat = 0;
  for (let i = 0; i < gyro.count; i++) {
    const v = { x: gyro.accelX[i], y: gyro.accelY[i], z: gyro.accelZ[i] };
    const lon = Math.abs(selectAxis(v, IMU_AXIS_MAP.longitudinal));
    const lat = Math.abs(selectAxis(v, IMU_AXIS_MAP.lateral));
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return { longitudinalG: rawToG(maxLon), lateralG: rawToG(maxLat) };
}

export interface BmsOverview {
  /** SOC [%] of the first Daly 0x90 frame in the log */
  startSoc: number;
  /** SOC [%] of the last Daly 0x90 frame in the log */
  endSoc: number;
  /** pack voltage range [V] over the whole run */
  minVoltage: number;
  maxVoltage: number;
  /** number of decoded frames, for context */
  frames: number;
}

/**
 * Battery figures from Daly BMS 0x18904001, or null when the log carries no
 * such frame (the BMS is poll-response — silence on the bus is a real case).
 * First/last follow file order, which matches record time order.
 */
export function computeBmsOverview(can: CanRawSeries): BmsOverview | null {
  let startSoc: number | null = null;
  let endSoc = 0;
  let minVoltage = Infinity;
  let maxVoltage = -Infinity;
  let frames = 0;

  for (let i = 0; i < can.count; i++) {
    if (!isDecodableFrame(can, i, CAN_ID_DALY_90)) continue;
    const data = frameData(can, i);
    const soc = decodeBmsSoc(data);
    const voltage = decodeBmsVoltage(data);
    if (startSoc === null) startSoc = soc;
    endSoc = soc;
    if (voltage < minVoltage) minVoltage = voltage;
    if (voltage > maxVoltage) maxVoltage = voltage;
    frames++;
  }

  if (startSoc === null) return null;
  return { startSoc, endSoc, minVoltage, maxVoltage, frames };
}
