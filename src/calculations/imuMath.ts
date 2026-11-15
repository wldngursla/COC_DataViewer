export type Vec3 = [number, number, number];
/** Rows are vehicle unit axes expressed in sensor coordinates. */
export type Mat3 = [Vec3, Vec3, Vec3];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const sub = (a: Vec3, b: Vec3) => add(a, scale(b, -1));
export const norm = (a: Vec3) => Math.hypot(...a);
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: Vec3): Vec3 | null => norm(a) > 1e-9 ? scale(a, 1 / norm(a)) : null;
export const transform = (r: Mat3, a: Vec3): Vec3 => [dot(r[0], a), dot(r[1], a), dot(r[2], a)];
export const determinant = (r: Mat3) => dot(r[0], cross(r[1], r[2]));
export const properRotation = (r: Mat3) => r.flat().every(Number.isFinite) && Math.abs(determinant(r) - 1) < 1e-6 && r.every((a, i) => r.every((b, j) => Math.abs(dot(a, b) - (i === j ? 1 : 0)) < 1e-6));
export function vehicleFrame(up: Vec3, forward: Vec3): Mat3 | null {
  const z = unit(up); if (!z) return null;
  const x = unit(sub(forward, scale(z, dot(forward, z)))); if (!x) return null;
  const y = unit(cross(z, x)); return y ? [x, y, z] : null;
}
/** Explicit sensor→vehicle active rotation Rz(yaw)*Ry(pitch)*Rx(roll). */
export function eulerRotation(angles: Vec3): Mat3 {
  const [r, p, y] = angles.map((v) => v * Math.PI / 180);
  const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y);
  return [[cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr], [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr], [-sp, cp * sr, cp * cr]];
}
export function mappedRotation(axes: Vec3): Mat3 {
  return axes.map((axis) => [1, 2, 3].map((j) => Math.abs(axis) === j ? Math.sign(axis) : 0)) as Mat3;
}
/** Body components of fixed world up: dg/dt = -omega × g. Rodrigues step. */
export function propagateUp(up: Vec3, rateDps: Vec3, dt: number): Vec3 {
  const omega = scale(rateDps, -Math.PI / 180); const magnitude = norm(omega);
  if (magnitude < 1e-12) return [...up];
  const axis = scale(omega, 1 / magnitude); const theta = magnitude * dt;
  return add(add(scale(up, Math.cos(theta)), scale(cross(axis, up), Math.sin(theta))), scale(axis, dot(axis, up) * (1 - Math.cos(theta))));
}
