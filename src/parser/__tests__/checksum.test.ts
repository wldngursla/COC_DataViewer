import { describe, it, expect } from 'vitest';
import { computeChecksum, verifyChecksum, sealChecksum } from '../checksum';
import { RECORD_SIZE, LOG_MAGIC, LogType } from '../types';
import { bootRecord, canRecord } from './fixtures';

/**
 * Independent reference implementation, transcribed 1:1 from the firmware
 * (log_prepare in main.h): zero the checksum field, XOR the record as six
 * uint32 LE words, fold high+low 16 bits, assign to uint16_t (truncates).
 */
function referenceChecksum(record: Uint8Array): number {
  const copy = new Uint8Array(record);
  copy[2] = 0;
  copy[3] = 0;
  const v = new DataView(copy.buffer);
  let chksum = 0;
  for (let i = 0; i < RECORD_SIZE / 4; i++) {
    chksum = (chksum ^ v.getUint32(i * 4, true)) >>> 0;
  }
  return ((chksum & 0xffff) + (chksum >>> 16)) & 0xffff; // uint16_t assignment
}

describe('checksum', () => {
  it('matches the firmware reference implementation on a normal record', () => {
    const rec = canRecord({
      timestamp: 123456,
      id: 0x180117ef,
      extended: true,
      data: [0x70, 0x03, 0x00, 0x7d, 0, 0, 0xd0, 0x84],
    });
    const view = new DataView(rec.buffer);
    expect(computeChecksum(view, 0)).toBe(referenceChecksum(rec));
    expect(verifyChecksum(view, 0)).toBe(true);
  });

  it('reproduces the uint16_t truncation when the fold sum overflows 16 bits', () => {
    // craft x = 0xFFFFFFFF: fold gives 0xFFFF + 0xFFFF = 0x1FFFE,
    // which the firmware truncates to 0xFFFE (it does NOT fold twice)
    const bytes = new Uint8Array(RECORD_SIZE);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, LOG_MAGIC);
    view.setUint8(1, LogType.System);
    view.setUint32(4, 0xdeadbeef, true); // timestamp word w1
    const w0 = view.getUint32(0, true) & 0x0000ffff;
    const w1 = view.getUint32(4, true);
    view.setUint32(8, (w0 ^ w1 ^ 0xffffffff) >>> 0, true); // w2 forces x = 0xFFFFFFFF
    // w3..w5 remain 0

    expect(computeChecksum(view, 0)).toBe(0xfffe);
    expect(referenceChecksum(bytes)).toBe(0xfffe);
  });

  it('ignores the stored checksum bytes when computing', () => {
    const rec = bootRecord({ timestamp: 0, bootTime: 1755820800 });
    const view = new DataView(rec.buffer);
    const expected = computeChecksum(view, 0);
    view.setUint16(2, 0x1234, true); // clobber the stored value
    expect(computeChecksum(view, 0)).toBe(expected); // unchanged
    expect(verifyChecksum(view, 0)).toBe(false); // but verification now fails
  });

  it('sealChecksum produces a record that verifies', () => {
    const bytes = new Uint8Array(RECORD_SIZE).fill(0x5a);
    const view = new DataView(bytes.buffer);
    view.setUint8(0, LOG_MAGIC);
    view.setUint8(1, LogType.Analog);
    sealChecksum(view, 0);
    expect(verifyChecksum(view, 0)).toBe(true);
    expect(view.getUint16(2, true)).toBe(referenceChecksum(bytes));
  });

  it('detects a single flipped bit anywhere in the record', () => {
    const rec = gyroLike();
    const view = new DataView(rec.buffer);
    expect(verifyChecksum(view, 0)).toBe(true);
    for (const byteIdx of [0, 1, 5, 8, 15, 23]) {
      const copy = new Uint8Array(rec);
      copy[byteIdx] ^= 0x01;
      expect(verifyChecksum(new DataView(copy.buffer), 0)).toBe(false);
    }
  });
});

function gyroLike(): Uint8Array {
  const bytes = new Uint8Array(RECORD_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, LOG_MAGIC);
  view.setUint8(1, LogType.Gyroscope);
  view.setUint32(4, 98765, true);
  view.setInt16(8, -1234, true);
  view.setInt16(16, 4096, true);
  sealChecksum(view, 0);
  return bytes;
}
