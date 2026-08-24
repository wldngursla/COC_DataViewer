/**
 * Battery performance KPIs for a completed run.
 *
 * Daly 0x90 frames provide voltage, signed current, and SOC at one timestamp.
 * Documented current sign is discharge negative / charge positive. Consumed
 * energy therefore integrates only max(-V * I, 0) using actual timestamps.
 */

import type { CanRawSeries, GpsRawSeries, ParsedLog } from '../parser/types';
import { CAN_DATA_BYTES } from '../parser/types';
import {
  CAN_ID_DALY_90,
  decodeBmsCurrent,
  decodeBmsSoc,
  decodeBmsVoltage,
} from '../decoder/can';
import { haversineMeters, rawToDecimalDegrees } from '../decoder/gps';

interface BatterySample {
  timestampMs: number;
  voltageV: number;
  currentA: number;
  socPercent: number;
  dischargePowerKw: number;
}

export interface BatteryKpis {
  bmsFrames: number;
  startSocPercent: number;
  endSocPercent: number;
  /** start SOC - end SOC, in percentage points; may be negative after charging. */
  socDropPercentagePoints: number;
  minimumVoltageV: number;
  maximumVoltageV: number;
  averageVoltageV: number;
  /** Positive magnitude. The decoded discharge current itself is negative. */
  peakDischargeCurrentA: number;
  /** Positive magnitude of max(-V * I, 0), in kW. */
  peakDischargePowerKw: number;
  /** Discharge-only trapezoidal integral, in kWh. */
  consumedEnergyKwh: number;
}

export interface BatteryAnalysisResult {
  battery: BatteryKpis | null;
  totalDistanceKm: number | null;
  efficiencyKmPerKwh: number | null;
}

function isDaly90Frame(can: CanRawSeries, index: number): boolean {
  return (
    can.id[index] === CAN_ID_DALY_90 &&
    can.remote[index] === 0 &&
    can.len[index] >= CAN_DATA_BYTES
  );
}

function collectBatterySamples(can: CanRawSeries): BatterySample[] {
  const samples: BatterySample[] = [];

  for (let index = 0; index < can.count; index++) {
    if (!isDaly90Frame(can, index)) continue;
    const data = can.data.subarray(
      index * CAN_DATA_BYTES,
      (index + 1) * CAN_DATA_BYTES,
    );
    const voltageV = decodeBmsVoltage(data);
    const currentA = decodeBmsCurrent(data);
    const signedPowerKw = (voltageV * currentA) / 1000;

    samples.push({
      timestampMs: can.timestamp[index],
      voltageV,
      currentA,
      socPercent: decodeBmsSoc(data),
      dischargePowerKw: Math.max(-signedPowerKw, 0),
    });
  }

  // The protocol permits tiny enqueue-order timestamp reversals. Work on a
  // sorted copy so integration remains chronological without changing raw data.
  samples.sort((a, b) => a.timestampMs - b.timestampMs);
  return samples;
}

function computeBatteryKpis(can: CanRawSeries): BatteryKpis | null {
  const samples = collectBatterySamples(can);
  if (samples.length === 0) return null;

  let voltageSum = 0;
  let minimumVoltageV = Infinity;
  let maximumVoltageV = -Infinity;
  let peakDischargeCurrentA = 0;
  let peakDischargePowerKw = 0;
  let consumedEnergyKwh = 0;

  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    voltageSum += sample.voltageV;
    if (sample.voltageV < minimumVoltageV) minimumVoltageV = sample.voltageV;
    if (sample.voltageV > maximumVoltageV) maximumVoltageV = sample.voltageV;

    const dischargeCurrentA = Math.max(-sample.currentA, 0);
    if (dischargeCurrentA > peakDischargeCurrentA) {
      peakDischargeCurrentA = dischargeCurrentA;
    }
    if (sample.dischargePowerKw > peakDischargePowerKw) {
      peakDischargePowerKw = sample.dischargePowerKw;
    }

    if (index === 0) continue;
    const previous = samples[index - 1];
    const deltaTimeMs = sample.timestampMs - previous.timestampMs;
    if (!Number.isFinite(deltaTimeMs) || deltaTimeMs <= 0) continue;

    const averageDischargePowerKw =
      (previous.dischargePowerKw + sample.dischargePowerKw) / 2;
    consumedEnergyKwh += averageDischargePowerKw * (deltaTimeMs / 3_600_000);
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  return {
    bmsFrames: samples.length,
    startSocPercent: first.socPercent,
    endSocPercent: last.socPercent,
    socDropPercentagePoints: first.socPercent - last.socPercent,
    minimumVoltageV,
    maximumVoltageV,
    averageVoltageV: voltageSum / samples.length,
    peakDischargeCurrentA,
    peakDischargePowerKw,
    consumedEnergyKwh,
  };
}

function computeGpsDistanceKm(gps: GpsRawSeries): number | null {
  if (gps.count === 0) return null;

  let previousLatitude = rawToDecimalDegrees(gps.latitudeRaw[0], gps.latDir[0]);
  let previousLongitude = rawToDecimalDegrees(gps.longitudeRaw[0], gps.lonDir[0]);
  let totalMeters = 0;

  for (let index = 1; index < gps.count; index++) {
    const latitude = rawToDecimalDegrees(gps.latitudeRaw[index], gps.latDir[index]);
    const longitude = rawToDecimalDegrees(gps.longitudeRaw[index], gps.lonDir[index]);
    const segmentMeters = haversineMeters(
      previousLatitude,
      previousLongitude,
      latitude,
      longitude,
    );
    if (!Number.isFinite(segmentMeters)) return null;
    totalMeters += segmentMeters;
    previousLatitude = latitude;
    previousLongitude = longitude;
  }

  return totalMeters / 1000;
}

export function computeBatteryAnalysis(parsed: ParsedLog): BatteryAnalysisResult {
  const battery = computeBatteryKpis(parsed.can);
  const totalDistanceKm = computeGpsDistanceKm(parsed.gps);
  const efficiencyKmPerKwh =
    battery !== null && totalDistanceKm !== null && battery.consumedEnergyKwh > 0
      ? totalDistanceKm / battery.consumedEnergyKwh
      : null;

  return { battery, totalDistanceKm, efficiencyKmPerKwh };
}
