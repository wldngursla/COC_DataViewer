/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLog } from '../../parser/parseLog';
import { bootRecord, buildLog, canRecord } from '../../parser/__tests__/fixtures';
import { computeBatteryTemperatures, decodeBatteryTemperatureFrame } from '../batteryTemperature';
import { createGraphSeriesProvider } from '../graphSeries';

describe('Daly battery temperatures', () => {
  it('handles frame index, signed Celsius and invalid bytes', () => {
    expect(decodeBatteryTemperatureFrame(Uint8Array.of(2, 39, 40, 41, 255, 255, 255, 255))).toEqual([
      { sensor: 8, temperatureC: -1 }, { sensor: 9, temperatureC: 0 }, { sensor: 10, temperatureC: 1 },
    ]);
    expect(decodeBatteryTemperatureFrame(Uint8Array.of(255, 70, 70, 70, 70, 70, 70, 70))).toEqual([]);
  });
  it('respects declared sensor count and excludes RTR/short frames', () => {
    const log = parseLog(buildLog([
      bootRecord({ timestamp: 0, bootTime: 0 }),
      canRecord({ timestamp: 1, id: 0x18944001, extended: true, data: [14, 2, 0, 0, 0, 0, 0, 0] }),
      canRecord({ timestamp: 2, id: 0x18964001, extended: true, data: [1, 70, 72, 0, 0, 255, 255, 255] }),
      canRecord({ timestamp: 3, id: 0x18964001, extended: true, remote: true, data: [1, 80, 80, 0, 0, 0, 0, 0] }),
    ]));
    const temperatures = computeBatteryTemperatures(log.can);
    expect(temperatures[0]).toEqual([{ timestampMs: 2, temperatureC: 30 }]);
    expect(temperatures[1][0].temperatureC).toBe(32);
    expect(temperatures[2]).toEqual([]);
    const graphs = createGraphSeriesProvider(log);
    expect(graphs.get('batteryTemp1').points).toEqual([[0.002, 30]]);
    expect(graphs.isAvailable('batteryTemp3')).toBe(false);
  });
  it('loads the bundled real log and detects exactly two fitted probes', () => {
    const bytes = readFileSync('public/data/default-run.bin');
    const log = parseLog(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const series = computeBatteryTemperatures(log.can);
    expect(series.filter((s) => s.length > 0)).toHaveLength(2);
    expect(series[0][0].temperatureC).toBe(30);
    expect(series[1][0].temperatureC).toBe(32);
    expect(log.stats.badChecksum).toBe(0);
    console.info(`Default log: ${log.stats.accepted} records, temperatures ${series[0].length}/${series[1].length} samples`);
  });
});
