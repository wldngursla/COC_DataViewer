/**
 * CAN signal decoding — only signals documented in
 * reference/CAN_SIGNALS_SELECTED.md are implemented. Do not add signals that
 * are not in that document.
 *
 * Endianness differs per device:
 *   EZkontrol motor controller — little-endian  (lo | hi << 8)
 *   Daly BMS                   — big-endian     (hi << 8 | lo)
 */

/* ------------------------------------------------------------------ *
 * CAN IDs
 *
 * ★ 확인 필요 (PROTOCOL_SPEC.md item F) — 전장팀 확인 전 가정값:
 *   - EZkontrol 프로토콜 모드 = METER(0x17). VCU 모드면 0xD0으로 바뀐다.
 *   - EZkontrol SA(끝바이트) = 0xEF (기본값)
 *   - Daly BMS addr = 0x01, PC = 0x40
 * 펌웨어 config.h(CAN_EZ_ID1, CAN_DALY_ID90)와 동일한 가정이다.
 * ------------------------------------------------------------------ */

const EZ_SA = 0xef;
const EZ_MODE = 0x17; // METER=0x17, VCU=0xD0

/** EZkontrol message 1 — speed / bus voltage / bus current */
export const CAN_ID_EZ_MSG1 = (0x18010000 | (EZ_MODE << 8) | EZ_SA) >>> 0; // 0x180117EF
/** EZkontrol message 2 — temps / accelerator / error flags */
export const CAN_ID_EZ_MSG2 = (0x18020000 | (EZ_MODE << 8) | EZ_SA) >>> 0; // 0x180217EF

const DALY_PC = 0x40;
const DALY_ADDR = 0x01;
const dalyId = (dataId: number): number =>
  (0x18000000 | (dataId << 16) | (DALY_PC << 8) | DALY_ADDR) >>> 0;

/** Daly 0x90 — total voltage / current / SOC */
export const CAN_ID_DALY_90 = dalyId(0x90); // 0x18904001
/** Daly 0x93 — remaining capacity */
export const CAN_ID_DALY_93 = dalyId(0x93); // 0x18934001
/** Daly 0x98 — fault bitfield */
export const CAN_ID_DALY_98 = dalyId(0x98); // 0x18984001

/* ------------------------------------------------------------------ *
 * Battery sign convention
 *
 * ★ 확인 필요 (PROTOCOL_SPEC.md item D): 문서상 Daly 전류는 방전 −/충전 +.
 * 실측에서 반대로 확인되면 이 상수만 -1 → 1 로 바꾼다.
 * "방전 중일 때 디코딩된 전류의 부호"를 의미한다.
 * ------------------------------------------------------------------ */
export const DISCHARGE_SIGN: 1 | -1 = -1;

/* ------------------------------------------------------------------ *
 * Byte helpers (b = 8-byte frame data, big/little per device)
 * ------------------------------------------------------------------ */

/** EZkontrol: little-endian u16 at byte offset `lo` */
const leU16 = (b: Uint8Array, lo: number): number => b[lo] | (b[lo + 1] << 8);
/** Daly: big-endian u16 at byte offset `hi` */
const beU16 = (b: Uint8Array, hi: number): number => (b[hi] << 8) | b[hi + 1];
/** Daly: big-endian u32 at byte offset `hi` */
const beU32 = (b: Uint8Array, hi: number): number =>
  ((b[hi] << 24) | (b[hi + 1] << 16) | (b[hi + 2] << 8) | b[hi + 3]) >>> 0;

/* ------------------------------------------------------------------ *
 * EZkontrol motor controller — ID 0x180117EF
 * ------------------------------------------------------------------ */

/**
 * Motor speed [rpm], B6-B7 LE: -(raw - 32000).
 * User-requested sign reversal; scale and raw decoding are unchanged.
 * B6=0x00, B7=0x7D gives raw 32000 and therefore 0 rpm.
 */
export function decodeMotorRpm(data: Uint8Array): number {
  return 32000 - leU16(data, 6);
}

/** Bus voltage [V]. B0-B1 LE, V = raw * 0.1 */
export function decodeEzBusVoltage(data: Uint8Array): number {
  return leU16(data, 0) * 0.1;
}

/** Bus current [A]. B2-B3 LE, A = raw * 0.1 - 3200 */
export function decodeEzBusCurrent(data: Uint8Array): number {
  return leU16(data, 2) * 0.1 - 3200;
}

/* ------------------------------------------------------------------ *
 * EZkontrol motor controller — ID 0x180217EF
 * ------------------------------------------------------------------ */

/** Controller temperature [°C]. B0, °C = raw - 40 */
export function decodeControllerTemp(data: Uint8Array): number {
  return data[0] - 40;
}

/** Motor temperature [°C]. B1, °C = raw - 40 */
export function decodeMotorTemp(data: Uint8Array): number {
  return data[1] - 40;
}

/** Accelerator [%]. B2, 0~100 */
export function decodeAccelerator(data: Uint8Array): number {
  return data[2];
}

export interface CanFaultState {
  /** Human-readable names for every asserted documented flag. */
  active: string[];
  /** True when no documented flag is asserted. */
  clear: boolean;
}

const EZ_FAULT_LABELS: readonly (readonly string[])[] = [
  [
    'Overcurrent', 'Overload', 'Overvoltage', 'Undervoltage',
    'Controller Overheat', 'Motor Overheat', 'Motor Stalled', 'Motor Out of phase',
  ],
  [
    'Motor Sensor', 'Motor AUX Sensor', 'Encoder Misaligned', 'Anti-Runaway',
    'Main Accelerator', 'AUX Accelerator', 'Pre-charge', 'DC Contactor',
  ],
  ['Power valve', 'Current Sensor', 'Auto-tune', 'RS485', 'CAN', 'Software'],
];

/** EZkontrol Msg2 B4-B6 documented fault bitfield. */
export function decodeEzFaults(data: Uint8Array): CanFaultState {
  const active: string[] = [];
  for (let byteOffset = 0; byteOffset < EZ_FAULT_LABELS.length; byteOffset++) {
    const labels = EZ_FAULT_LABELS[byteOffset];
    for (let bit = 0; bit < labels.length; bit++) {
      if ((data[4 + byteOffset] & (1 << bit)) !== 0) active.push(labels[bit]);
    }
  }
  return { active, clear: active.length === 0 };
}

/* ------------------------------------------------------------------ *
 * Daly BMS — ID 0x18904001 (DataID 0x90)
 * ------------------------------------------------------------------ */

/** Pack total voltage [V]. B0-B1 BE, V = raw * 0.1 */
export function decodeBmsVoltage(data: Uint8Array): number {
  return beU16(data, 0) * 0.1;
}

/**
 * Pack current [A]. B4-B5 BE, A = (raw - 30000) * 0.1.
 * Documented sign: 방전 −/충전 + (see DISCHARGE_SIGN).
 */
export function decodeBmsCurrent(data: Uint8Array): number {
  return (beU16(data, 4) - 30000) * 0.1;
}

/** State of charge [%]. B6-B7 BE, % = raw * 0.1 */
export function decodeBmsSoc(data: Uint8Array): number {
  return beU16(data, 6) * 0.1;
}

/* ------------------------------------------------------------------ *
 * Daly BMS — ID 0x18934001 (DataID 0x93)
 * ------------------------------------------------------------------ */

/** Remaining capacity [mAh]. B4-B7 BE u32 */
export function decodeBmsRemainingCapacityMah(data: Uint8Array): number {
  return beU32(data, 4);
}

const DALY_FAULT_LABELS: readonly (readonly string[])[] = [
  [
    'Cell overvoltage L1', 'Cell overvoltage L2', 'Cell undervoltage L1', 'Cell undervoltage L2',
    'Pack overvoltage L1', 'Pack overvoltage L2', 'Pack undervoltage L1', 'Pack undervoltage L2',
  ],
  [
    'Charge high temperature L1', 'Charge high temperature L2',
    'Charge low temperature L1', 'Charge low temperature L2',
    'Discharge high temperature L1', 'Discharge high temperature L2',
    'Discharge low temperature L1', 'Discharge low temperature L2',
  ],
  [
    'Charge overcurrent L1', 'Charge overcurrent L2',
    'Discharge overcurrent L1', 'Discharge overcurrent L2',
    'SOC high L1', 'SOC high L2', 'SOC low L1', 'SOC low L2',
  ],
  [
    'Cell voltage difference L1', 'Cell voltage difference L2',
    'Temperature difference L1', 'Temperature difference L2',
  ],
  // The source document groups B4 but does not assign individual meanings.
  // Retain asserted positions rather than inventing an undocumented mapping.
  [
    'MOS/temperature fault B4.0', 'MOS/temperature fault B4.1',
    'MOS/temperature fault B4.2', 'MOS/temperature fault B4.3',
    'MOS/temperature fault B4.4', 'MOS/temperature fault B4.5',
    'MOS/temperature fault B4.6', 'MOS/temperature fault B4.7',
  ],
  [
    'AFE chip error', 'Voltage acquisition disconnected', 'Cell temperature sensor error',
    'EEPROM error', 'RTC error', 'Pre-charge failure', 'Communication failure',
    'Internal communication failure',
  ],
  [
    'Current module fault', 'Pack voltage detection fault',
    'Short-circuit protection fault', 'Low-voltage charge prohibited',
  ],
];

export interface DalyFaultState extends CanFaultState {
  /** Daly 0x98 B7, retained as a numeric code rather than treated as flags. */
  faultCode: number;
}

/** Daly 0x98 B0-B6 documented fault flags plus B7 fault code. */
export function decodeDalyFaults(data: Uint8Array): DalyFaultState {
  const active: string[] = [];
  for (let byte = 0; byte < DALY_FAULT_LABELS.length; byte++) {
    const labels = DALY_FAULT_LABELS[byte];
    for (let bit = 0; bit < labels.length; bit++) {
      if ((data[byte] & (1 << bit)) !== 0) active.push(labels[bit]);
    }
  }
  return { active, clear: active.length === 0 && data[7] === 0, faultCode: data[7] };
}
