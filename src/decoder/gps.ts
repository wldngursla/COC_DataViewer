/**
 * GPS raw-value decoding — docs/PROTOCOL_SPEC.md section 3 (GPS).
 *
 * The logger stores NMEA GPRMC fields as scaled integers:
 *   latitude/longitude — degree-minute notation ddmm.mmmmm scaled by 1e5
 *                        (NOT decimal degrees)
 *   speed              — km/h * 100 (firmware already converted from knots)
 *   course             — true course, degree * 100
 */

const ASCII_S = 0x53; // 'S'
const ASCII_W = 0x57; // 'W'

/**
 * Convert a raw ddmm.mmmmm * 1e5 value plus its direction byte to signed
 * decimal degrees. Works for both latitude ('N'/'S') and longitude ('E'/'W').
 */
export function rawToDecimalDegrees(raw: number, dirByte: number): number {
  const dd = Math.floor(raw / 1e7);
  const minutes = raw / 1e5 - dd * 100;
  const deg = dd + minutes / 60;
  return dirByte === ASCII_S || dirByte === ASCII_W ? -deg : deg;
}

/** km/h * 100 → km/h */
export function rawToKmh(speedRaw: number): number {
  return speedRaw / 100;
}

/** degree * 100 → degree */
export function rawToCourseDeg(courseRaw: number): number {
  return courseRaw / 100;
}

const EARTH_RADIUS_M = 6371000;

/** Great-circle distance between two decimal-degree points, in meters. */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}
