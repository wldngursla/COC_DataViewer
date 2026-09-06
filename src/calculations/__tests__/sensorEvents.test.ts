import { describe, expect, it } from 'vitest';
import { LogType, type EventRecord } from '../../parser/types';
import { analyzeSensorEvents } from '../sensorEvents';

const system = (timestamp: number, message: string): EventRecord => ({
  timestamp,
  type: LogType.System,
  message,
});

describe('analyzeSensorEvents', () => {
  it('extracts configuration and keeps the latest runtime state per sensor', () => {
    const events = [
      system(1, 'CFG:WHL_FL:ON'),
      system(2, 'CFG:AIN1:OFF'),
      system(3, 'SNS:GPS:MISS'),
      system(4, 'SNS:GPS:OK'),
      { timestamp: 5, type: LogType.UserEvent, message: 'SNS:GPS:ERR' },
    ] satisfies EventRecord[];

    const result = analyzeSensorEvents(events);
    expect(result.config.map(({ name, value }) => ({ name, value }))).toEqual([
      { name: 'WHL_FL', value: 'ON' },
      { name: 'AIN1', value: 'OFF' },
    ]);
    expect(result.statusTimeline).toHaveLength(2);
    expect(result.latestStatus).toEqual([
      { name: 'GPS', value: 'OK', timestampMs: 4 },
    ]);
  });
});
