/**
 * Binary .log record types — see docs/PROTOCOL_SPEC.md
 *
 * Layout is dictated by reference/protocol.h and must not be changed here.
 * This module is intentionally free of any unit conversion: it describes the
 * raw wire values only. Physical units live in src/decoder/.
 */

/** sizeof(log_t) — header 8 B + payload union 16 B, no padding. */
export const RECORD_SIZE = 24;

/** LOG_MAGIC — first byte of every record. */
export const LOG_MAGIC = 0xae;

/** PROTOCOL_VERSION carried in the BOOT payload. */
export const PROTOCOL_VERSION = 1;

/**
 * log_type_t. Declared as a const object rather than a TS `enum` because the
 * project builds with `erasableSyntaxOnly`.
 */
export const LogType = {
  Invalid: 0,
  Boot: 1,
  Can: 2,
  Gps: 3,
  Analog: 4,
  Digital: 5,
  Gyroscope: 6,
  System: 7,
  UserEvent: 8,
} as const;

export type LogType = (typeof LogType)[keyof typeof LogType];

export const LOG_TYPE_NAMES: Record<number, string> = {
  [LogType.Invalid]: 'INVALID',
  [LogType.Boot]: 'BOOT',
  [LogType.Can]: 'CAN',
  [LogType.Gps]: 'GPS',
  [LogType.Analog]: 'ANALOG',
  [LogType.Digital]: 'DIGITAL',
  [LogType.Gyroscope]: 'GYROSCOPE',
  [LogType.System]: 'SYSTEM',
  [LogType.UserEvent]: 'USER_EVENT',
};

/** Number of analog input channels in an ANALOG record. */
export const ANALOG_CHANNELS = 8;

/** Number of digital input channels in a DIGITAL record. */
export const DIGITAL_CHANNELS = 4;

/** Bytes of CAN payload stored per record (DLC may exceed this; data is truncated). */
export const CAN_DATA_BYTES = 8;

/* ------------------------------------------------------------------ *
 * Single records (used for rare event types and for tests)
 * ------------------------------------------------------------------ */

export interface BootRecord {
  /** ms since boot */
  timestamp: number;
  protocolVersion: number;
  /** colon-separated lowercase hex, e.g. "a1:b2:c3:d4:e5:f6" */
  mac: string;
  /** epoch seconds (UTC). 0 means the logger never got a GPS fix. */
  bootTime: number;
}

export interface EventRecord {
  /** ms since boot */
  timestamp: number;
  type: typeof LogType.System | typeof LogType.UserEvent;
  /** msg[16], NUL-trimmed. The firmware does not guarantee NUL termination. */
  message: string;
}

/* ------------------------------------------------------------------ *
 * Columnar raw series
 *
 * Sampled sources produce hundreds of thousands of records per run, so they are
 * stored column-wise in typed arrays rather than as one object per record.
 * ------------------------------------------------------------------ */

export interface CanRawSeries {
  count: number;
  /** ms since boot */
  timestamp: Uint32Array;
  id: Uint32Array;
  /** 0/1 — 29-bit identifier */
  extended: Uint8Array;
  /** 0/1 — RTR frame */
  remote: Uint8Array;
  /** DLC as reported; may exceed CAN_DATA_BYTES */
  len: Uint8Array;
  /** flat count * CAN_DATA_BYTES buffer; frame i occupies [i*8, i*8+8) */
  data: Uint8Array;
}

export interface GpsRawSeries {
  count: number;
  timestamp: Uint32Array;
  /** NMEA ddmm.mmmmm * 1e5 — NOT decimal degrees */
  latitudeRaw: Uint32Array;
  /** NMEA dddmm.mmmmm * 1e5 — NOT decimal degrees */
  longitudeRaw: Uint32Array;
  /** ASCII 'N' / 'S' */
  latDir: Uint8Array;
  /** ASCII 'E' / 'W' */
  lonDir: Uint8Array;
  /** km/h * 100 */
  speedRaw: Uint16Array;
  /** degree * 100 */
  courseRaw: Uint16Array;
}

export interface AnalogRawSeries {
  count: number;
  timestamp: Uint32Array;
  /** ain[c][i] — ADS1115 signed counts, +-4.096 V full scale */
  ain: Int16Array[];
}

export interface DigitalRawSeries {
  count: number;
  timestamp: Uint32Array;
  /** din[c][i] — GPIO level 0/1, NOT a pulse counter */
  din: Uint32Array[];
}

export interface GyroRawSeries {
  count: number;
  timestamp: Uint32Array;
  accelX: Int16Array;
  accelY: Int16Array;
  accelZ: Int16Array;
  temperature: Int16Array;
  gyroX: Int16Array;
  gyroY: Int16Array;
  gyroZ: Int16Array;
}

/* ------------------------------------------------------------------ *
 * Parse result
 * ------------------------------------------------------------------ */

export interface ParseStats {
  fileSize: number;
  /** floor(fileSize / RECORD_SIZE) */
  recordSlots: number;
  /** fileSize % RECORD_SIZE — a truncated final record after power loss */
  trailingBytes: number;
  accepted: number;
  badMagic: number;
  badChecksum: number;
  unknownType: number;
  /** accepted record count keyed by LogType */
  byType: Record<number, number>;
  /** the protocol guarantees record 0 is a BOOT record */
  recordZeroIsBoot: boolean;
}

export interface ParsedLog {
  stats: ParseStats;
  /** first BOOT record, or null if the file contains none */
  boot: BootRecord | null;
  /** epoch seconds of boot, or null when the logger never had a GPS fix */
  bootTimeEpochSec: number | null;
  can: CanRawSeries;
  gps: GpsRawSeries;
  analog: AnalogRawSeries;
  digital: DigitalRawSeries;
  gyro: GyroRawSeries;
  /** SYSTEM and USER_EVENT records, in file order */
  events: EventRecord[];
}

export type LogParseErrorCode =
  | 'EMPTY_FILE'
  | 'TOO_SMALL'
  | 'NOT_A_LOG'
  | 'UNSUPPORTED_PROTOCOL';

export class LogParseError extends Error {
  readonly code: LogParseErrorCode;

  constructor(code: LogParseErrorCode, message: string) {
    super(message);
    this.name = 'LogParseError';
    this.code = code;
  }
}
