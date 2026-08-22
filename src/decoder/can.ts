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
 * Motor speed [rpm]. B6-B7 LE, rpm = raw * 0.1 - 2000.
 * (문서의 검산 예시에 적힌 −32000은 오타 — 표와 펌웨어 main.h 모두 −2000)
 */
export function decodeMotorRpm(data: Uint8Array): number {
  return leU16(data, 6) * 0.1 - 2000;
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
