/** Structured view of CFG:* and SNS:* SYSTEM records emitted by newer firmware. */

import { LogType, type EventRecord } from '../parser/types';

export type SensorConfigValue = 'ON' | 'OFF';
export type SensorRuntimeValue = 'OK' | 'MISS' | 'ERR';

export interface SensorConfigEntry {
  name: string;
  value: SensorConfigValue;
  timestampMs: number;
}

export interface SensorStatusEntry {
  name: string;
  value: SensorRuntimeValue;
  timestampMs: number;
}

export interface SensorEventAnalysis {
  config: SensorConfigEntry[];
  latestStatus: SensorStatusEntry[];
  statusTimeline: SensorStatusEntry[];
}

export function analyzeSensorEvents(events: readonly EventRecord[]): SensorEventAnalysis {
  const configByName = new Map<string, SensorConfigEntry>();
  const latestStatusByName = new Map<string, SensorStatusEntry>();
  const statusTimeline: SensorStatusEntry[] = [];

  for (const event of events) {
    if (event.type !== LogType.System) continue;

    const configMatch = /^CFG:([^:]+):(ON|OFF)$/.exec(event.message);
    if (configMatch !== null) {
      configByName.set(configMatch[1], {
        name: configMatch[1],
        value: configMatch[2] as SensorConfigValue,
        timestampMs: event.timestamp,
      });
      continue;
    }

    const statusMatch = /^SNS:([^:]+):(OK|MISS|ERR)$/.exec(event.message);
    if (statusMatch !== null) {
      const entry: SensorStatusEntry = {
        name: statusMatch[1],
        value: statusMatch[2] as SensorRuntimeValue,
        timestampMs: event.timestamp,
      };
      latestStatusByName.set(entry.name, entry);
      statusTimeline.push(entry);
    }
  }

  return {
    config: [...configByName.values()],
    latestStatus: [...latestStatusByName.values()],
    statusTimeline,
  };
}
