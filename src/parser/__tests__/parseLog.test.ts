import { describe, it, expect } from 'vitest';
import { parseLog } from '../parseLog';
import { LogType, LogParseError, RECORD_SIZE } from '../types';
import { sealChecksum } from '../checksum';
import {
  bootRecord,
  canRecord,
  gpsRecord,
  analogRecord,
  digitalRecord,
  gyroRecord,
  eventRecord,
  buildLog,
} from './fixtures';

const BOOT_EPOCH = 1755820800; // 2026-08-22 00:00:00 UTC

function sampleLog(): ArrayBuffer {
  return buildLog([
    bootRecord({ timestamp: 3, bootTime: BOOT_EPOCH, mac: [1, 2, 3, 4, 5, 6] }),
    canRecord({
      timestamp: 100,
      id: 0x18904001,
      extended: true,
      data: [0x02, 0x2c, 0, 0, 0x75, 0x30, 0x02, 0x71],
    }),
    gpsRecord({
      timestamp: 200,
      latitudeRaw: 372346587, // 3723.46587 N
      longitudeRaw: 1270412345, // 12704.12345 E
      latDir: 'N',
      lonDir: 'E',
      speedRaw: 9273, // 92.73 km/h
      courseRaw: 28545, // 285.45 deg
    }),
    analogRecord({ timestamp: 210, ain: [100, -200, 300, -400, 500, -600, 700, -32768] }),
    digitalRecord({ timestamp: 220, din: [1, 0, 1, 0] }),
    gyroRecord({ timestamp: 230, accel: [4096, -2048, 4096], temperature: 1234, gyro: [655, -131, 0] }),
    eventRecord({ timestamp: 240, type: LogType.System, message: 'GPS_RDY' }),
    eventRecord({ timestamp: 250, type: LogType.UserEvent, message: 'ABCDEFGHIJKLMNOP' }), // full 16B, no NUL
  ]);
}

describe('parseLog', () => {
  it('parses every record type with correct values', () => {
    const log = parseLog(sampleLog());

    expect(log.stats.accepted).toBe(8);
    expect(log.stats.badMagic).toBe(0);
    expect(log.stats.badChecksum).toBe(0);
    expect(log.stats.unknownType).toBe(0);
    expect(log.stats.trailingBytes).toBe(0);
    expect(log.stats.recordZeroIsBoot).toBe(true);

    // BOOT
    expect(log.boot).not.toBeNull();
    expect(log.boot!.protocolVersion).toBe(1);
    expect(log.boot!.mac).toBe('01:02:03:04:05:06');
    expect(log.boot!.bootTime).toBe(BOOT_EPOCH);
    expect(log.bootTimeEpochSec).toBe(BOOT_EPOCH);

    // CAN
    expect(log.can.count).toBe(1);
    expect(log.can.timestamp[0]).toBe(100);
    expect(log.can.id[0]).toBe(0x18904001);
    expect(log.can.extended[0]).toBe(1);
    expect(log.can.remote[0]).toBe(0);
    expect(log.can.len[0]).toBe(8);
    expect([...log.can.data.subarray(0, 8)]).toEqual([0x02, 0x2c, 0, 0, 0x75, 0x30, 0x02, 0x71]);

    // GPS (raw values pass through untouched)
    expect(log.gps.count).toBe(1);
    expect(log.gps.latitudeRaw[0]).toBe(372346587);
    expect(log.gps.longitudeRaw[0]).toBe(1270412345);
    expect(String.fromCharCode(log.gps.latDir[0])).toBe('N');
    expect(String.fromCharCode(log.gps.lonDir[0])).toBe('E');
    expect(log.gps.speedRaw[0]).toBe(9273);
    expect(log.gps.courseRaw[0]).toBe(28545);

    // ANALOG
    expect(log.analog.count).toBe(1);
    expect(log.analog.ain.map((c) => c[0])).toEqual([100, -200, 300, -400, 500, -600, 700, -32768]);

    // DIGITAL
    expect(log.digital.count).toBe(1);
    expect(log.digital.din.map((c) => c[0])).toEqual([1, 0, 1, 0]);

    // GYRO
    expect(log.gyro.count).toBe(1);
    expect(log.gyro.accelX[0]).toBe(4096);
    expect(log.gyro.accelY[0]).toBe(-2048);
    expect(log.gyro.accelZ[0]).toBe(4096);
    expect(log.gyro.temperature[0]).toBe(1234);
    expect(log.gyro.gyroX[0]).toBe(655);
    expect(log.gyro.gyroY[0]).toBe(-131);
    expect(log.gyro.gyroZ[0]).toBe(0);

    // events — including the non-NUL-terminated 16-byte message
    expect(log.events).toHaveLength(2);
    expect(log.events[0]).toMatchObject({ type: LogType.System, message: 'GPS_RDY' });
    expect(log.events[1]).toMatchObject({ type: LogType.UserEvent, message: 'ABCDEFGHIJKLMNOP' });

    expect(log.stats.byType[LogType.Can]).toBe(1);
    expect(log.stats.byType[LogType.Gyroscope]).toBe(1);
  });

  it('writes GPS reserved bytes, speed, and course at protocol.h offsets', () => {
    const record = gpsRecord({
      timestamp: 90_000,
      latitudeRaw: 373027514,
      longitudeRaw: 1265720439,
      latDir: 'N',
      lonDir: 'E',
      speedRaw: 9273,
      courseRaw: 28545,
    });

    expect([...record.subarray(18, 24)]).toEqual([
      0x00, 0x00, // _reserved[2]
      0x39, 0x24, // speedRaw 9273, little-endian
      0x81, 0x6f, // courseRaw 28545, little-endian
    ]);
  });

  it('drops corrupt records but keeps parsing at the next 24-byte boundary', () => {
    const records = [
      bootRecord({ timestamp: 0, bootTime: BOOT_EPOCH }),
      gyroRecord({ timestamp: 10, accel: [1, 2, 3], gyro: [4, 5, 6] }),
      gyroRecord({ timestamp: 20, accel: [7, 8, 9], gyro: [10, 11, 12] }),
      gyroRecord({ timestamp: 30, accel: [13, 14, 15], gyro: [16, 17, 18] }),
    ];
    records[1][20] ^= 0xff; // flip payload bits → checksum mismatch
    records[2][0] = 0x00; // destroy magic

    const log = parseLog(buildLog(records));
    expect(log.stats.accepted).toBe(2);
    expect(log.stats.badChecksum).toBe(1);
    expect(log.stats.badMagic).toBe(1);
    // the record after the corrupt ones is intact
    expect(log.gyro.count).toBe(1);
    expect(log.gyro.timestamp[0]).toBe(30);
    expect(log.gyro.accelX[0]).toBe(13);
  });

  it('counts an intact record with an unknown type as unknownType', () => {
    const rogue = gyroRecord({ timestamp: 5, accel: [0, 0, 0], gyro: [0, 0, 0] });
    rogue[1] = 42; // not a defined LOG_TYPE
    sealChecksum(new DataView(rogue.buffer), 0); // record itself is intact
    const log = parseLog(
      buildLog([bootRecord({ timestamp: 0, bootTime: BOOT_EPOCH }), rogue]),
    );
    expect(log.stats.unknownType).toBe(1);
    expect(log.stats.badChecksum).toBe(0);
    expect(log.stats.accepted).toBe(1);
  });

  it('counts a corrupted type byte as badChecksum, not unknownType', () => {
    const rogue = gyroRecord({ timestamp: 5, accel: [0, 0, 0], gyro: [0, 0, 0] });
    rogue[1] = 42; // type byte flipped after the checksum was written
    const log = parseLog(
      buildLog([bootRecord({ timestamp: 0, bootTime: BOOT_EPOCH }), rogue]),
    );
    expect(log.stats.badChecksum).toBe(1);
    expect(log.stats.unknownType).toBe(0);
    expect(log.stats.accepted).toBe(1);
  });

  it('rejects an unsupported protocol version with UNSUPPORTED_PROTOCOL', () => {
    const buf = buildLog([
      bootRecord({ timestamp: 0, bootTime: BOOT_EPOCH, protocolVersion: 2 }),
      gyroRecord({ timestamp: 10, accel: [1, 2, 3], gyro: [4, 5, 6] }),
    ]);
    try {
      parseLog(buf);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(LogParseError);
      expect((e as LogParseError).code).toBe('UNSUPPORTED_PROTOCOL');
      expect((e as LogParseError).message).toContain('version 2');
    }
  });

  it('does not run the version check on a corrupt BOOT record', () => {
    // a BOOT record that fails its checksum is dropped, so its version byte
    // must not abort parsing of the rest of the file
    const badBoot = bootRecord({ timestamp: 0, bootTime: BOOT_EPOCH, protocolVersion: 9 });
    badBoot[20] ^= 0xff; // corrupt payload → checksum mismatch
    const log = parseLog(
      buildLog([badBoot, gyroRecord({ timestamp: 10, accel: [1, 2, 3], gyro: [4, 5, 6] })]),
    );
    expect(log.stats.badChecksum).toBe(1);
    expect(log.boot).toBeNull();
    expect(log.gyro.count).toBe(1);
  });

  it('tolerates a truncated final record (power loss)', () => {
    const trailing = new Uint8Array(10).fill(0xae);
    const log = parseLog(buildLog([bootRecord({ timestamp: 0, bootTime: BOOT_EPOCH })], trailing));
    expect(log.stats.trailingBytes).toBe(10);
    expect(log.stats.recordSlots).toBe(1);
    expect(log.stats.accepted).toBe(1);
  });

  it('reports bootTimeEpochSec = null when the logger never got a GPS fix', () => {
    const log = parseLog(buildLog([bootRecord({ timestamp: 0, bootTime: 0 })]));
    expect(log.boot!.bootTime).toBe(0);
    expect(log.bootTimeEpochSec).toBeNull();
  });

  it('rejects empty and undersized files with typed errors', () => {
    expect(() => parseLog(new ArrayBuffer(0))).toThrowError(LogParseError);
    expect(() => parseLog(new ArrayBuffer(RECORD_SIZE - 1))).toThrowError(LogParseError);
    try {
      parseLog(new ArrayBuffer(0));
    } catch (e) {
      expect((e as LogParseError).code).toBe('EMPTY_FILE');
    }
  });

  it('rejects a file with no valid records as NOT_A_LOG', () => {
    const junk = new Uint8Array(RECORD_SIZE * 4).fill(0x55);
    try {
      parseLog(junk.buffer);
      expect.unreachable();
    } catch (e) {
      expect((e as LogParseError).code).toBe('NOT_A_LOG');
    }
  });

  it('keeps CAN DLC > 8 as reported while data stays 8 bytes', () => {
    const log = parseLog(
      buildLog([
        bootRecord({ timestamp: 0, bootTime: BOOT_EPOCH }),
        canRecord({ timestamp: 1, id: 0x123, data: [1, 2, 3, 4, 5, 6, 7, 8], len: 12 }),
      ]),
    );
    expect(log.can.len[0]).toBe(12);
    expect(log.can.data.length).toBe(8);
  });

  it('reports monotonically increasing progress ending at completion', () => {
    const fractions: number[] = [];
    parseLog(sampleLog(), (done, total) => fractions.push(done / total));
    expect(fractions.length).toBeGreaterThan(0);
    expect(fractions.at(-1)).toBe(1);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
    }
  });
});
