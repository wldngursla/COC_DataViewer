/**
 * Binary .log parser — pure TypeScript, no DOM/React dependency.
 * Format: docs/PROTOCOL_SPEC.md (source of truth: reference/protocol.h).
 *
 * Two passes over the buffer:
 *   1. validate every 24-byte slot (magic + checksum) and count records per
 *      type, so the columnar typed arrays can be allocated exactly once;
 *   2. decode accepted records into the columns.
 *
 * Corrupt slots are dropped and counted — record size is fixed, so parsing
 * simply continues at the next 24-byte boundary (no resync needed).
 */

import {
  RECORD_SIZE,
  LOG_MAGIC,
  PROTOCOL_VERSION,
  LogType,
  ANALOG_CHANNELS,
  DIGITAL_CHANNELS,
  CAN_DATA_BYTES,
  LogParseError,
} from './types';
import type {
  BootRecord,
  EventRecord,
  ParsedLog,
  ParseStats,
  CanRawSeries,
  GpsRawSeries,
  AnalogRawSeries,
  DigitalRawSeries,
  GyroRawSeries,
} from './types';
import { verifyChecksum } from './checksum';

/** Reported every ~PROGRESS_STEP slots and once at the end of each pass. */
export type ProgressCallback = (done: number, total: number) => void;

const PROGRESS_STEP = 65536;

const MAX_TYPE = LogType.UserEvent;

/** msg[16] is not guaranteed to be NUL-terminated — trim at first NUL if any. */
function decodeMessage(bytes: Uint8Array): string {
  const nul = bytes.indexOf(0);
  const slice = nul === -1 ? bytes : bytes.subarray(0, nul);
  // log messages are plain ASCII; fatal:false keeps garbage bytes from throwing
  return new TextDecoder('utf-8', { fatal: false }).decode(slice);
}

function formatMac(view: DataView, offset: number): string {
  const parts: string[] = [];
  for (let i = 0; i < 6; i++) {
    parts.push(view.getUint8(offset + i).toString(16).padStart(2, '0'));
  }
  return parts.join(':');
}

export function parseLog(buffer: ArrayBuffer, onProgress?: ProgressCallback): ParsedLog {
  const fileSize = buffer.byteLength;

  if (fileSize === 0) {
    throw new LogParseError('EMPTY_FILE', 'file is empty');
  }
  if (fileSize < RECORD_SIZE) {
    throw new LogParseError('TOO_SMALL', `file is smaller than one ${RECORD_SIZE}-byte record`);
  }

  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const recordSlots = Math.floor(fileSize / RECORD_SIZE);
  const trailingBytes = fileSize % RECORD_SIZE;

  /* ---------------- pass 1: validate + count ---------------- */

  // per-slot verdict so pass 2 does not repeat the checksum work:
  // 0 = rejected, otherwise the accepted record's type
  const verdict = new Uint8Array(recordSlots);
  const byType: Record<number, number> = {};
  for (let t = 0; t <= MAX_TYPE; t++) byType[t] = 0;

  let accepted = 0;
  let badMagic = 0;
  let badChecksum = 0;
  let unknownType = 0;
  let firstBootSlot = -1;

  for (let slot = 0; slot < recordSlots; slot++) {
    // progress tracks slot position, not accepted records, so a corrupt region
    // still advances the progress bar (pass 1 is the first half of the work)
    if (onProgress && slot % PROGRESS_STEP === 0) {
      onProgress(slot, recordSlots * 2);
    }

    const off = slot * RECORD_SIZE;

    if (bytes[off] !== LOG_MAGIC) {
      badMagic++;
      continue;
    }
    // checksum before type: a corrupted type byte fails the checksum and is
    // counted as badChecksum; unknownType is reserved for intact records whose
    // type this viewer genuinely does not know
    if (!verifyChecksum(view, off)) {
      badChecksum++;
      continue;
    }
    const type = bytes[off + 1];
    if (type === LogType.Invalid || type > MAX_TYPE) {
      unknownType++;
      continue;
    }

    verdict[slot] = type;
    byType[type]++;
    accepted++;

    if (type === LogType.Boot && firstBootSlot === -1) {
      firstBootSlot = slot;
    }
  }

  if (accepted === 0) {
    throw new LogParseError('NOT_A_LOG', 'no valid records found — not a COC data logger file?');
  }

  // a valid BOOT record with a protocol version this viewer does not support
  // must fail loudly, not parse silently with possibly-wrong field layouts
  if (firstBootSlot !== -1) {
    const version = bytes[firstBootSlot * RECORD_SIZE + 8];
    if (version !== PROTOCOL_VERSION) {
      throw new LogParseError(
        'UNSUPPORTED_PROTOCOL',
        `unsupported protocol version ${version} — this viewer supports version ${PROTOCOL_VERSION}`,
      );
    }
  }

  /* ---------------- allocate columns ---------------- */

  const can: CanRawSeries = {
    count: 0,
    timestamp: new Uint32Array(byType[LogType.Can]),
    id: new Uint32Array(byType[LogType.Can]),
    extended: new Uint8Array(byType[LogType.Can]),
    remote: new Uint8Array(byType[LogType.Can]),
    len: new Uint8Array(byType[LogType.Can]),
    data: new Uint8Array(byType[LogType.Can] * CAN_DATA_BYTES),
  };
  const gps: GpsRawSeries = {
    count: 0,
    timestamp: new Uint32Array(byType[LogType.Gps]),
    latitudeRaw: new Uint32Array(byType[LogType.Gps]),
    longitudeRaw: new Uint32Array(byType[LogType.Gps]),
    latDir: new Uint8Array(byType[LogType.Gps]),
    lonDir: new Uint8Array(byType[LogType.Gps]),
    speedRaw: new Uint16Array(byType[LogType.Gps]),
    courseRaw: new Uint16Array(byType[LogType.Gps]),
  };
  const analog: AnalogRawSeries = {
    count: 0,
    timestamp: new Uint32Array(byType[LogType.Analog]),
    ain: Array.from({ length: ANALOG_CHANNELS }, () => new Int16Array(byType[LogType.Analog])),
  };
  const digital: DigitalRawSeries = {
    count: 0,
    timestamp: new Uint32Array(byType[LogType.Digital]),
    din: Array.from({ length: DIGITAL_CHANNELS }, () => new Uint32Array(byType[LogType.Digital])),
  };
  const gyro: GyroRawSeries = {
    count: 0,
    timestamp: new Uint32Array(byType[LogType.Gyroscope]),
    accelX: new Int16Array(byType[LogType.Gyroscope]),
    accelY: new Int16Array(byType[LogType.Gyroscope]),
    accelZ: new Int16Array(byType[LogType.Gyroscope]),
    temperature: new Int16Array(byType[LogType.Gyroscope]),
    gyroX: new Int16Array(byType[LogType.Gyroscope]),
    gyroY: new Int16Array(byType[LogType.Gyroscope]),
    gyroZ: new Int16Array(byType[LogType.Gyroscope]),
  };
  const events: EventRecord[] = [];
  let boot: BootRecord | null = null;

  /* ---------------- pass 2: decode ---------------- */

  for (let slot = 0; slot < recordSlots; slot++) {
    // slot-based progress: fires for rejected slots too (pass 2 = second half)
    if (onProgress && slot % PROGRESS_STEP === 0) {
      onProgress(recordSlots + slot, recordSlots * 2);
    }

    const type = verdict[slot];
    if (type === 0) continue;

    const off = slot * RECORD_SIZE;
    const ts = view.getUint32(off + 4, true);
    const p = off + 8; // payload base

    switch (type) {
      case LogType.Boot: {
        // keep the first BOOT only; the firmware writes exactly one per file
        if (boot === null) {
          boot = {
            timestamp: ts,
            protocolVersion: view.getUint8(p),
            mac: formatMac(view, p + 2),
            // epoch seconds fit comfortably in a double
            bootTime: Number(view.getBigUint64(p + 8, true)),
          };
        }
        break;
      }
      case LogType.Can: {
        const i = can.count++;
        can.timestamp[i] = ts;
        can.id[i] = view.getUint32(p, true);
        can.extended[i] = view.getUint8(p + 4);
        can.remote[i] = view.getUint8(p + 5);
        can.len[i] = view.getUint8(p + 6);
        can.data.set(bytes.subarray(p + 8, p + 8 + CAN_DATA_BYTES), i * CAN_DATA_BYTES);
        break;
      }
      case LogType.Gps: {
        const i = gps.count++;
        gps.timestamp[i] = ts;
        gps.latitudeRaw[i] = view.getUint32(p, true);
        gps.longitudeRaw[i] = view.getUint32(p + 4, true);
        gps.latDir[i] = view.getUint8(p + 8);
        gps.lonDir[i] = view.getUint8(p + 9);
        gps.speedRaw[i] = view.getUint16(p + 12, true);
        gps.courseRaw[i] = view.getUint16(p + 14, true);
        break;
      }
      case LogType.Analog: {
        const i = analog.count++;
        analog.timestamp[i] = ts;
        for (let c = 0; c < ANALOG_CHANNELS; c++) {
          analog.ain[c][i] = view.getInt16(p + c * 2, true);
        }
        break;
      }
      case LogType.Digital: {
        const i = digital.count++;
        digital.timestamp[i] = ts;
        for (let c = 0; c < DIGITAL_CHANNELS; c++) {
          digital.din[c][i] = view.getUint32(p + c * 4, true);
        }
        break;
      }
      case LogType.Gyroscope: {
        const i = gyro.count++;
        gyro.timestamp[i] = ts;
        gyro.accelX[i] = view.getInt16(p, true);
        gyro.accelY[i] = view.getInt16(p + 2, true);
        gyro.accelZ[i] = view.getInt16(p + 4, true);
        gyro.temperature[i] = view.getInt16(p + 6, true);
        gyro.gyroX[i] = view.getInt16(p + 8, true);
        gyro.gyroY[i] = view.getInt16(p + 10, true);
        gyro.gyroZ[i] = view.getInt16(p + 12, true);
        break;
      }
      case LogType.System:
      case LogType.UserEvent: {
        events.push({
          timestamp: ts,
          type,
          message: decodeMessage(bytes.subarray(p, p + 16)),
        });
        break;
      }
    }
  }

  onProgress?.(recordSlots * 2, recordSlots * 2);

  const stats: ParseStats = {
    fileSize,
    recordSlots,
    trailingBytes,
    accepted,
    badMagic,
    badChecksum,
    unknownType,
    byType,
    recordZeroIsBoot: verdict[0] === LogType.Boot,
  };

  return {
    stats,
    boot,
    // boot_time is rewritten in place by the firmware once GPS sets the clock;
    // 0 means the run never had a fix, so no absolute date exists
    bootTimeEpochSec: boot !== null && boot.bootTime > 0 ? boot.bootTime : null,
    can,
    gps,
    analog,
    digital,
    gyro,
    events,
  };
}
