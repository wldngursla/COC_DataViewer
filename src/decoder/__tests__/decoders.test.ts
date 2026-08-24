import { describe, it, expect } from 'vitest';
import {
  decodeMotorRpm,
  decodeAccelerator,
  decodeEzBusVoltage,
  decodeEzBusCurrent,
  decodeBmsVoltage,
  decodeBmsCurrent,
  decodeBmsSoc,
  decodeBmsRemainingCapacityMah,
  CAN_ID_EZ_MSG1,
  CAN_ID_EZ_MSG2,
  CAN_ID_DALY_90,
} from '../can';
import { rawToDecimalDegrees, rawToKmh, rawToCourseDeg, haversineMeters } from '../gps';
import { rawToG, rawToDps, selectAxis, IMU_AXIS_MAP } from '../imu';

const frame = (bytes: Partial<Record<number, number>>): Uint8Array => {
  const d = new Uint8Array(8);
  for (const [i, v] of Object.entries(bytes)) d[Number(i)] = v!;
  return d;
};

describe('CAN decoder — 검산용 예시 (reference/CAN_SIGNALS_SELECTED.md)', () => {
  it('Motor Speed: B6=0xD0, B7=0x84 → 1400 rpm', () => {
    // 문서 예시 본문의 "−32000"은 오타; 표와 펌웨어 공식(raw*0.1−2000) 기준
    expect(decodeMotorRpm(frame({ 6: 0xd0, 7: 0x84 }))).toBeCloseTo(1400, 6);
  });

  it('Motor Bus Voltage: B0=0x70, B1=0x03 → 88.0 V', () => {
    expect(decodeEzBusVoltage(frame({ 0: 0x70, 1: 0x03 }))).toBeCloseTo(88.0, 6);
  });

  it('BMS 전류: B4=0x75, B5=0x30 → 0.0 A', () => {
    expect(decodeBmsCurrent(frame({ 4: 0x75, 5: 0x30 }))).toBeCloseTo(0.0, 6);
  });

  it('BMS SOC: B6=0x02, B7=0x71 → 62.5 %', () => {
    expect(decodeBmsSoc(frame({ 6: 0x02, 7: 0x71 }))).toBeCloseTo(62.5, 6);
  });
});

describe('CAN decoder — additional signals', () => {
  it('EZ bus current offset −3200 A', () => {
    // raw 32000 → 32000*0.1 − 3200 = 0 A
    expect(decodeEzBusCurrent(frame({ 2: 0x00, 3: 0x7d }))).toBeCloseTo(0, 6);
  });

  it('BMS total voltage big-endian', () => {
    // BE 0x0370 = 880 → 88.0 V (byte order opposite to EZkontrol)
    expect(decodeBmsVoltage(frame({ 0: 0x03, 1: 0x70 }))).toBeCloseTo(88.0, 6);
  });

  it('BMS remaining capacity u32 BE', () => {
    expect(decodeBmsRemainingCapacityMah(frame({ 4: 0x00, 5: 0x01, 6: 0x86, 7: 0xa0 }))).toBe(100000);
  });

  it('assumed CAN IDs match firmware config.h', () => {
    expect(CAN_ID_EZ_MSG1).toBe(0x180117ef);
    expect(CAN_ID_EZ_MSG2).toBe(0x180217ef);
    expect(CAN_ID_DALY_90).toBe(0x18904001);
  });
});

describe('Accelerator decoder', () => {
  it('uses EZkontrol Msg2 byte 2 as percent', () => {
    expect(decodeAccelerator(frame({ 0: 99, 2: 73, 7: 88 }))).toBe(73);
  });
});

describe('GPS decoder', () => {
  it('converts ddmm.mmmmm×1e5 to decimal degrees', () => {
    // 3723.46587' N → 37° + 23.46587/60 = 37.391097833…
    expect(rawToDecimalDegrees(372346587, 'N'.charCodeAt(0))).toBeCloseTo(37.39109783, 7);
    // 12704.12345' E → 127° + 4.12345/60 = 127.06872416…
    expect(rawToDecimalDegrees(1270412345, 'E'.charCodeAt(0))).toBeCloseTo(127.06872417, 7);
  });

  it('applies sign from the direction byte', () => {
    expect(rawToDecimalDegrees(372346587, 'S'.charCodeAt(0))).toBeCloseTo(-37.39109783, 7);
    expect(rawToDecimalDegrees(1270412345, 'W'.charCodeAt(0))).toBeCloseTo(-127.06872417, 7);
  });

  it('scales speed and course by 1/100', () => {
    expect(rawToKmh(4523)).toBeCloseTo(45.23, 6);
    expect(rawToCourseDeg(18050)).toBeCloseTo(180.5, 6);
  });

  it('haversine: 1 degree of latitude ≈ 111.2 km', () => {
    const d = haversineMeters(37.0, 127.0, 38.0, 127.0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_500);
  });
});

describe('IMU decoder', () => {
  it('accel: ±8 g full scale → 4096 LSB/g', () => {
    expect(rawToG(4096)).toBeCloseTo(1, 9);
    expect(rawToG(-32768)).toBeCloseTo(-8, 9);
  });

  it('gyro: ±500 dps full scale → 65.5 LSB/dps', () => {
    expect(rawToDps(655)).toBeCloseTo(10, 9);
    expect(rawToDps(-65.5)).toBeCloseTo(-1, 9);
  });

  it('axis map default selects sensor axes with sign', () => {
    const v = { x: 1, y: 2, z: 3 };
    expect(selectAxis(v, IMU_AXIS_MAP.longitudinal)).toBe(1);
    expect(selectAxis(v, IMU_AXIS_MAP.lateral)).toBe(2);
    expect(selectAxis(v, IMU_AXIS_MAP.yaw)).toBe(3);
    expect(selectAxis(v, { axis: 'y', sign: -1 })).toBe(-2);
  });
});
