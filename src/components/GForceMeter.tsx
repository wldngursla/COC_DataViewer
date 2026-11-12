import { useMemo } from 'react';
import type { ParsedLog } from '../parser/types';
import { computeGForce, selectGForce } from '../calculations/gForce';
import './GForceMeter.css';

export function GForceMeter({ result, timestampMs }: { result: ParsedLog; timestampMs: number }) {
  const data = useMemo(() => computeGForce(result), [result]);
  const sample = selectGForce(data.samples, timestampMs);
  const scale = Math.max(1.5, Math.ceil(data.maxG * 2) / 2);
  const position = (x: number, y: number) => `${160 + x / scale * 112},${160 - y / scale * 112}`;
  let low = 0; let high = data.samples.length;
  while (low < high) { const mid = (low + high) >>> 1; if (data.samples[mid].timestampMs <= timestampMs) low = mid + 1; else high = mid; }
  const end = low;
  while (low > 0 && data.samples[low - 1].timestampMs > timestampMs - 2000) low--;
  const history = data.samples.slice(low, end);
  const trail = history.filter((_, i) => i % Math.max(1, Math.ceil(history.length / 80)) === 0);
  const metric = (v: number | undefined) => v === undefined ? 'N/A' : `${v.toFixed(2)} G`;
  return <aside className="gforce-meter" aria-label="G-force meter sensor axes">
    <div className="gforce-heading"><strong>G-FORCE</strong><span>IMU · REPLAY</span></div>
    <svg viewBox="0 0 320 320" role="img" aria-label={`Sensor XY ${metric(sample?.magnitude)}`}>
      <defs><radialGradient id="gforce-bg"><stop stopColor="#203244"/><stop offset="1" stopColor="#10171f"/></radialGradient></defs>
      <circle cx="160" cy="160" r="130" fill="url(#gforce-bg)" stroke="#3987e5" strokeOpacity="0.5"/>
      {[0.25, 0.5, 0.75, 1].map((r) => <circle key={r} cx="160" cy="160" r={112 * r} fill="none" stroke="#62778c" strokeOpacity="0.55"/>)}
      {Array.from({ length: 12 }, (_, i) => <line key={i} x1="160" y1="48" x2="160" y2="272" transform={`rotate(${i * 15} 160 160)`} stroke="#62778c" strokeOpacity="0.25"/>)}
      <text x="160" y="20" textAnchor="middle">+Y</text><text x="160" y="310" textAnchor="middle">−Y</text><text x="10" y="165">−X</text><text x="282" y="165">+X</text>
      {trail.map((p, i) => { const [cx, cy] = position(p.x, p.y).split(','); return <circle key={i} cx={cx} cy={cy} r="2" fill="#fab219" opacity={(i + 1) / trail.length * 0.65}/>; })}
      {sample && <circle cx={160 + sample.x / scale * 112} cy={160 - sample.y / scale * 112} r="6" fill="#fab219" stroke="white" strokeWidth="2"/>}
      <text x="160" y="287" textAnchor="middle">바깥 원 {scale.toFixed(1)} G</text>
    </svg>
    <div className="gforce-current">{metric(sample?.magnitude)}</div>
    <div className="gforce-max"><span>MAX XY <b>{metric(data.samples.length ? data.maxG : undefined)}</b></span><span>MAX |X| <b>{metric(data.samples.length ? data.maxX : undefined)}</b></span><span>MAX |Y| <b>{metric(data.samples.length ? data.maxY : undefined)}</b></span></div>
    <p>센서 X/Y 기준 · 5샘플 중앙값 + 0.35초 저역통과<br/>MAX는 전체 로그의 평활값 기준. 차량축·중력 보정 미확정.</p>
  </aside>;
}
