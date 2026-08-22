/**
 * Folded-XOR record checksum — mirrors log_prepare() in the ESP32 firmware.
 * See docs/PROTOCOL_SPEC.md section 4.
 *
 * The firmware zeroes the checksum field, XORs the 24-byte record as six
 * little-endian uint32 words, then folds: (x & 0xFFFF) + (x >> 16) assigned to
 * a uint16_t. The assignment TRUNCATES on overflow (it is not folded twice),
 * so the final `& 0xffff` below is required for exact compatibility.
 */

import { RECORD_SIZE } from './types';

/**
 * Compute the expected checksum of the 24-byte record at `offset`.
 * The stored checksum bytes (offset +2..+3) are excluded by masking word 0.
 */
export function computeChecksum(view: DataView, offset: number): number {
  // checksum occupies the high 16 bits of little-endian word 0
  let x = view.getUint32(offset, true) & 0x0000ffff;
  x ^= view.getUint32(offset + 4, true);
  x ^= view.getUint32(offset + 8, true);
  x ^= view.getUint32(offset + 12, true);
  x ^= view.getUint32(offset + 16, true);
  x ^= view.getUint32(offset + 20, true);
  // >>> keeps the XOR result unsigned before folding
  return ((x & 0xffff) + (x >>> 16)) & 0xffff;
}

/** Verify the record at `offset` against its stored checksum field. */
export function verifyChecksum(view: DataView, offset: number): boolean {
  return view.getUint16(offset + 2, true) === computeChecksum(view, offset);
}

/**
 * Write a valid checksum into the record at `offset`.
 * Used by test fixtures; the viewer itself never modifies log data.
 */
export function sealChecksum(view: DataView, offset: number): void {
  view.setUint16(offset + 2, computeChecksum(view, offset), true);
}

export { RECORD_SIZE };
