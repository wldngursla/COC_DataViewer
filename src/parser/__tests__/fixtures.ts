/**
 * Synthetic 24-byte record builders for tests. Layout mirrors
 * reference/protocol.h exactly (see docs/PROTOCOL_SPEC.md).
 */

import { RECORD_SIZE, LOG_MAGIC, LogType } from '../types';
import { sealChecksum } from '../checksum';

function newRecord(type: number, timestamp: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(RECORD_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, LOG_MAGIC);
  view.setUint8(1, type);
  view.setUint32(4, timestamp, true);
  return { bytes, view };
}

export function bootRecord(opts: {
  timestamp: number;
  protocolVersion?: number;
  mac?: number[];
  bootTime: number;
}): Uint8Array {
  const { bytes, view } = newRecord(LogType.Boot, opts.timestamp);
  view.setUint8(8, opts.protocolVersion ?? 1);
  (opts.mac ?? [0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6]).forEach((b, i) => view.setUint8(10 + i, b));
  view.setBigUint64(16, BigInt(opts.bootTime), true);
  sealChecksum(view, 0);
  return bytes;
}

export function canRecord(opts: {
  timestamp: number;
  id: number;
  extended?: boolean;
  remote?: boolean;
  data: number[]; // up to 8 bytes; len defaults to data.length
  len?: number;
}): Uint8Array {
  const { bytes, view } = newRecord(LogType.Can, opts.timestamp);
  view.setUint32(8, opts.id, true);
  view.setUint8(12, opts.extended ? 1 : 0);
  view.setUint8(13, opts.remote ? 1 : 0);
  view.setUint8(14, opts.len ?? opts.data.length);
  opts.data.slice(0, 8).forEach((b, i) => view.setUint8(16 + i, b));
  sealChecksum(view, 0);
  return bytes;
}

export function gpsRecord(opts: {
  timestamp: number;
  latitudeRaw: number; // ddmm.mmmmm * 1e5
  longitudeRaw: number; // dddmm.mmmmm * 1e5
  latDir: 'N' | 'S';
  lonDir: 'E' | 'W';
  speedRaw: number; // km/h * 100
  courseRaw: number; // deg * 100
}): Uint8Array {
  const { bytes, view } = newRecord(LogType.Gps, opts.timestamp);
  view.setUint32(8, opts.latitudeRaw, true);
  view.setUint32(12, opts.longitudeRaw, true);
  view.setUint8(16, opts.latDir.charCodeAt(0));
  view.setUint8(17, opts.lonDir.charCodeAt(0));
  view.setUint16(20, opts.speedRaw, true);
  view.setUint16(22, opts.courseRaw, true);
  sealChecksum(view, 0);
  return bytes;
}

export function analogRecord(opts: { timestamp: number; ain: number[] }): Uint8Array {
  const { bytes, view } = newRecord(LogType.Analog, opts.timestamp);
  opts.ain.forEach((v, c) => view.setInt16(8 + c * 2, v, true));
  sealChecksum(view, 0);
  return bytes;
}

export function digitalRecord(opts: { timestamp: number; din: number[] }): Uint8Array {
  const { bytes, view } = newRecord(LogType.Digital, opts.timestamp);
  opts.din.forEach((v, c) => view.setUint32(8 + c * 4, v, true));
  sealChecksum(view, 0);
  return bytes;
}

export function gyroRecord(opts: {
  timestamp: number;
  accel: [number, number, number];
  temperature?: number;
  gyro: [number, number, number];
}): Uint8Array {
  const { bytes, view } = newRecord(LogType.Gyroscope, opts.timestamp);
  view.setInt16(8, opts.accel[0], true);
  view.setInt16(10, opts.accel[1], true);
  view.setInt16(12, opts.accel[2], true);
  view.setInt16(14, opts.temperature ?? 0, true);
  view.setInt16(16, opts.gyro[0], true);
  view.setInt16(18, opts.gyro[1], true);
  view.setInt16(20, opts.gyro[2], true);
  sealChecksum(view, 0);
  return bytes;
}

export function eventRecord(opts: {
  timestamp: number;
  type: typeof LogType.System | typeof LogType.UserEvent;
  message: string; // ASCII; truncated to 16 bytes, NOT NUL-terminated when full
}): Uint8Array {
  const { bytes, view } = newRecord(opts.type, opts.timestamp);
  for (let i = 0; i < Math.min(opts.message.length, 16); i++) {
    view.setUint8(8 + i, opts.message.charCodeAt(i));
  }
  sealChecksum(view, 0);
  return bytes;
}

/** Concatenate records (plus optional raw trailing bytes) into one buffer. */
export function buildLog(records: Uint8Array[], trailing?: Uint8Array): ArrayBuffer {
  const trailingLen = trailing?.length ?? 0;
  const out = new Uint8Array(records.length * RECORD_SIZE + trailingLen);
  records.forEach((r, i) => out.set(r, i * RECORD_SIZE));
  if (trailing) out.set(trailing, records.length * RECORD_SIZE);
  return out.buffer;
}
