/**
 * IMU (MPU-6050/6500 compatible) raw-value decoding.
 *
 * The firmware configures the sensor to ±8 g accel / ±500 dps gyro full scale
 * (gyroscope.c: GYRO_CONFIG = 1<<3, ACCEL_CONFIG = 1<<4), so:
 *   g   = raw / 4096     (32768 / 8)
 *   dps = raw / 65.5     (32768 / 500, datasheet LSB/dps value)
 *
 * Temperature is left raw: the exact conversion differs between MPU-6050 and
 * MPU-6500 and the chip variant is not documented (PROTOCOL_SPEC.md item H).
 */

export const ACCEL_LSB_PER_G = 4096;
export const GYRO_LSB_PER_DPS = 65.5;
export const GRAVITY_MS2 = 9.80665;

/** raw accel count → g */
export function rawToG(raw: number): number {
  return raw / ACCEL_LSB_PER_G;
}

/** raw accel count → m/s² */
export function rawToMs2(raw: number): number {
  return (raw / ACCEL_LSB_PER_G) * GRAVITY_MS2;
}

/** raw gyro count → degree/s */
export function rawToDps(raw: number): number {
  return raw / GYRO_LSB_PER_DPS;
}

/* ------------------------------------------------------------------ *
 * Sensor axis → vehicle axis mapping
 *
 * ★ 확인 필요 (PROTOCOL_SPEC.md item C): IMU 장착 방향은 어디에도 문서화되지
 * 않았다. 아래 기본값은 "센서 X=차량 종방향(전방 +), Y=횡방향(우측 +),
 * Z=수직(상방 +)" 가정이며, 실차 실측 후 이 상수만 수정하면 된다.
 * axis: 어느 센서 축을 읽을지 / sign: 부호 뒤집기 (+1 | -1)
 * ------------------------------------------------------------------ */

export type SensorAxis = 'x' | 'y' | 'z';

export interface AxisSelect {
  axis: SensorAxis;
  sign: 1 | -1;
}

export interface ImuAxisMap {
  /** 차량 종방향 가속 (전방 +) */
  longitudinal: AxisSelect;
  /** 차량 횡방향 가속 (우측 +) */
  lateral: AxisSelect;
  /** 차량 수직 가속 (상방 +) */
  vertical: AxisSelect;
  /** Yaw rate — 수직축 자이로 */
  yaw: AxisSelect;
}

export const IMU_AXIS_MAP: ImuAxisMap = {
  longitudinal: { axis: 'x', sign: 1 },
  lateral: { axis: 'y', sign: 1 },
  vertical: { axis: 'z', sign: 1 },
  yaw: { axis: 'z', sign: 1 },
};

/** Pick the mapped sensor axis from an {x, y, z} triple and apply its sign. */
export function selectAxis(
  values: { x: number; y: number; z: number },
  select: AxisSelect,
): number {
  return values[select.axis] * select.sign;
}
