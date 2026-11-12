import type { TrackAnalysis } from './trackAnalysis';
import { haversineMeters } from '../decoder/gps';

/** Display-only 1 s local median + 0.8 s low-pass; never alters source indices. */
export function smoothTrack(track: TrackAnalysis): TrackAnalysis {
  const median = (v: number[]) => { v.sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  const points: TrackAnalysis['points'] = [];
  let left = 0; let right = 0;
  for (let i = 0; i < track.points.length; i++) {
    const point = track.points[i];
    while (left < i && point.timestampMs - track.points[left].timestampMs > 500) left++;
    if (right < i) right = i;
    while (right + 1 < track.points.length && track.points[right + 1].timestampMs - point.timestampMs <= 500) right++;
    const nearby = track.points.slice(left, right + 1);
    const lat = median(nearby.map((p) => p.latitudeDeg));
    const lon = median(nearby.map((p) => p.longitudeDeg));
    const previous = points[i - 1];
    const dt = previous ? point.timestampMs - previous.timestampMs : Infinity;
    const alpha = dt > 2000 ? 1 : 1 - Math.exp(-Math.max(0, dt) / 800);
    points.push({ ...point, latitudeDeg: previous ? previous.latitudeDeg + alpha * (lat - previous.latitudeDeg) : lat, longitudeDeg: previous ? previous.longitudeDeg + alpha * (lon - previous.longitudeDeg) : lon });
  }
  return { ...track, points, startPoint: points[0] ?? null, endPoint: points.at(-1) ?? null,
    segments: track.segments.filter((s) => {
      const a = points[s.startPointIndex]; const b = points[s.endPointIndex];
      const dt = b.timestampMs - a.timestampMs;
      return dt > 0 && dt <= 2000 && haversineMeters(a.latitudeDeg, a.longitudeDeg, b.latitudeDeg, b.longitudeDeg) <= 100 * dt / 1000;
    }),
  };
}
