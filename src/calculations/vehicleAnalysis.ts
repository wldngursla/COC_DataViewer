/**
 * Vehicle-page run-level measurements.
 *
 * GPS speed and motor RPM reuse the established Overview calculations. IMU
 * values intentionally remain on the sensor's raw X/Y/Z axes because the
 * mounting orientation and vehicle-axis mapping have not been confirmed.
 */

import type { GyroRawSeries, ParsedLog } from '../parser/types';
import { rawToDps, rawToG } from '../decoder/imu';
import { computeMaxGpsSpeedKmh, computeMaxMotorRpm } from './overview';

export interface ImuSensorAxisPeaks {
  /** Maximum absolute sensor-axis acceleration [g]. */
  peakAbsAccelXG: number;
  peakAbsAccelYG: number;
  peakAbsAccelZG: number;
  /** Maximum absolute sensor-axis gyro Z rate [deg/s]. */
  peakAbsGyroZDps: number;
}

export interface VehicleAnalysisResult {
  maxGpsSpeedKmh: number | null;
  maxMotorRpm: number | null;
  imu: ImuSensorAxisPeaks | null;
}

function computeImuSensorAxisPeaks(gyro: GyroRawSeries): ImuSensorAxisPeaks | null {
  if (gyro.count === 0) return null;

  let peakAbsAccelXRaw = 0;
  let peakAbsAccelYRaw = 0;
  let peakAbsAccelZRaw = 0;
  let peakAbsGyroZRaw = 0;

  for (let index = 0; index < gyro.count; index++) {
    peakAbsAccelXRaw = Math.max(peakAbsAccelXRaw, Math.abs(gyro.accelX[index]));
    peakAbsAccelYRaw = Math.max(peakAbsAccelYRaw, Math.abs(gyro.accelY[index]));
    peakAbsAccelZRaw = Math.max(peakAbsAccelZRaw, Math.abs(gyro.accelZ[index]));
    peakAbsGyroZRaw = Math.max(peakAbsGyroZRaw, Math.abs(gyro.gyroZ[index]));
  }

  return {
    peakAbsAccelXG: rawToG(peakAbsAccelXRaw),
    peakAbsAccelYG: rawToG(peakAbsAccelYRaw),
    peakAbsAccelZG: rawToG(peakAbsAccelZRaw),
    peakAbsGyroZDps: rawToDps(peakAbsGyroZRaw),
  };
}

export function computeVehicleAnalysis(parsed: ParsedLog): VehicleAnalysisResult {
  return {
    maxGpsSpeedKmh: computeMaxGpsSpeedKmh(parsed.gps),
    maxMotorRpm: computeMaxMotorRpm(parsed.can),
    imu: computeImuSensorAxisPeaks(parsed.gyro),
  };
}
