/**
 * Single stat tile: label (sentence case) + value (semibold, proportional
 * figures). Status tones always pair color with an icon glyph so state is
 * never carried by color alone.
 */

export type StatTone = 'default' | 'good' | 'warning';

interface StatTileProps {
  label: string;
  value: string;
  tone?: StatTone;
  /** small secondary line under the value */
  hint?: string;
}

const TONE_ICON: Record<StatTone, string> = {
  default: '',
  good: '✓', // ✓
  warning: '▲', // ▲
};

export function StatTile({ label, value, tone = 'default', hint }: StatTileProps) {
  return (
    <div className={`stat-tile tone-${tone}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {tone !== 'default' && (
          <span className="stat-icon" aria-hidden="true">
            {TONE_ICON[tone]}
          </span>
        )}
        {value}
      </div>
      {hint !== undefined && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
