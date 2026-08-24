/** Presentation-only formatting helpers shared by pages/components. */

/** 1234567 → "1.2 MB" (binary-ish steps at 1000 for readability) */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 'B';
  for (const u of units) {
    if (value < 1000) break;
    value /= 1000;
    unit = u;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

/** milliseconds → "H:MM:SS" (or "M:SS" under an hour) */
export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** milliseconds → "m:ss.mmm" (or "h:mm:ss.mmm" at one hour and above) */
export function formatElapsedTime(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const milliseconds = totalMs % 1000;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  const mmm = String(milliseconds).padStart(3, '0');
  return h > 0 ? `${h}:${mm}:${ss}.${mmm}` : `${mm}:${ss}.${mmm}`;
}

/** thousands separators for counts */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** epoch seconds (UTC) → local date-time string */
export function formatEpochSec(sec: number): string {
  return new Date(sec * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
}
