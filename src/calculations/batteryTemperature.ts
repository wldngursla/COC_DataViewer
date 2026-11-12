import type { CanRawSeries } from '../parser/types';

/** User-confirmed Daly 0x96: frame index + seven temperatures, raw − 40 °C. */
export const CAN_ID_DALY_96 = 0x18964001;
export const MAX_BATTERY_TEMP_SENSORS = 24;
export interface BatteryTemperatureSample { timestampMs: number; temperatureC: number }

export function decodeBatteryTemperatureFrame(data: Uint8Array): { sensor: number; temperatureC: number }[] {
  if (data.length < 8 || data[0] === 255) return [];
  const frame = data[0] === 0 ? 0 : data[0] - 1;
  return Array.from({ length: 7 }, (_, index) => ({
    sensor: frame * 7 + index + 1,
    temperatureC: data[index + 1] - 40,
  })).filter((entry, index) => entry.sensor <= MAX_BATTERY_TEMP_SENSORS && data[index + 1] !== 255);
}

export function computeBatteryTemperatures(can: CanRawSeries): BatteryTemperatureSample[][] {
  const series = Array.from({ length: MAX_BATTERY_TEMP_SENSORS }, () => [] as BatteryTemperatureSample[]);
  // 0x94 byte 1 declares the fitted probe count; do not mistake unused bytes for probes.
  let sensorCount = MAX_BATTERY_TEMP_SENSORS;
  for (let i = 0; i < can.count; i++) {
    if (can.extended[i] !== 1 || can.remote[i] !== 0 || can.len[i] < 8) continue;
    if (can.id[i] === 0x18944001) {
      const count = can.data[i * 8 + 1];
      if (count > 0 && count <= MAX_BATTERY_TEMP_SENSORS) sensorCount = count;
    }
  }
  for (let i = 0; i < can.count; i++) {
    if (can.id[i] !== CAN_ID_DALY_96 || can.extended[i] !== 1 || can.remote[i] !== 0 || can.len[i] < 8) continue;
    for (const entry of decodeBatteryTemperatureFrame(can.data.subarray(i * 8, i * 8 + 8))) {
      if (entry.sensor <= sensorCount) series[entry.sensor - 1].push({ timestampMs: can.timestamp[i], temperatureC: entry.temperatureC });
    }
  }
  series.forEach((samples) => samples.sort((a, b) => a.timestampMs - b.timestampMs));
  return series;
}
