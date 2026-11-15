import { useId, useMemo, useState } from 'react';
import type { ParsedLog } from '../parser/types';
import { filteredGForceMode, imuGForce, selectImuGForce } from '../calculations/imuGForce';
import { useImuAnalysis } from '../state/imuSession';
import './GForceMeter.css';

export function GForceMeter({ result, timestampMs }: { result: ParsedLog; timestampMs: number }) {
  const session = useImuAnalysis(result);
  const [mode, setMode] = useState<'raw' | 'filtered'>('filtered');
  const gradient = useId();
  const displayMode = mode === 'raw' ? 'raw' : session?.result ? filteredGForceMode(session.result) : 'sensorFiltered';
  const data = useMemo(() => session?.result ? imuGForce(session.result, displayMode) : { samples: [], maxX: 0, maxY: 0, maxG: 0 }, [session, displayMode]);
  const sample = session?.result ? selectImuGForce(session.result, displayMode, timestampMs) : null;
  const vehicle = displayMode === 'filtered';
  const scale = Math.max(1.5, Math.ceil(data.maxG * 2) / 2);
  const position = (x: number, y: number) => `${160 + (vehicle ? -x : x) / scale * 112},${160 - y / scale * 112}`;
  let low = 0; let high = data.samples.length;
  while (low < high) { const mid = (low + high) >>> 1; if (data.samples[mid].timestampMs <= timestampMs) low = mid + 1; else high = mid; }
  const end = low;
  while (low > 0 && data.samples[low - 1].timestampMs > timestampMs - 2000) low--;
  const history = data.samples.slice(low, end);
  const trail = history.filter((_, i) => i % Math.max(1, Math.ceil(history.length / 80)) === 0);
  const metric = (v: number | undefined) => v === undefined ? 'N/A' : `${v.toFixed(2)} G`;
  return <aside className="gforce-meter" aria-label={vehicle ? 'Vehicle linear G-force meter' : 'Raw sensor specific-force meter'}>
    <div className="gforce-heading"><strong>G-FORCE</strong><span>IMU · REPLAY</span></div>
    <div className="gforce-modes"><button type="button" aria-pressed={mode === 'filtered'} onClick={() => setMode('filtered')}>Filtered</button><button type="button" aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>Raw</button></div>
    <p className="gforce-mode-label" role="status">{displayMode === 'filtered' ? '차량축 · 필터링 + 동적 중력 제거' : displayMode === 'sensorAdjusted' ? '센서축 · 필터링 + 초기 정지 기준 변화량' : displayMode === 'sensorFiltered' ? '센서축 · 필터링 (정지 기준 없음, 중력 포함)' : '센서축 · 원본 (중력 포함)'}</p>
    <svg viewBox="0 0 320 320" role="img" aria-label={`${vehicle ? 'Vehicle linear' : 'Sensor specific'} XY ${metric(sample?.magnitude)}`}>
      <defs><radialGradient id={gradient}><stop stopColor="#e8f1ff"/><stop offset="1" stopColor="#ffffff"/></radialGradient></defs>
      <circle cx="160" cy="160" r="130" fill={`url(#${gradient})`} stroke="#3987e5" strokeOpacity="0.5"/>
      {[0.25, 0.5, 0.75, 1].map((r) => <circle key={r} cx="160" cy="160" r={112 * r} fill="none" stroke="#62778c" strokeOpacity="0.55"/>)}
      {Array.from({ length: 12 }, (_, i) => <line key={i} x1="160" y1="48" x2="160" y2="272" transform={`rotate(${i * 15} 160 160)`} stroke="#62778c" strokeOpacity="0.25"/>)}
      <text x="160" y="20" textAnchor="middle">{vehicle ? '+X 전진' : '+Y'}</text><text x="160" y="310" textAnchor="middle">{vehicle ? '−X 제동' : '−Y'}</text><text x="10" y="165">{vehicle ? '+Y' : '−X'}</text><text x="282" y="165">{vehicle ? '−Y' : '+X'}</text>
      {trail.map((p, i) => { const [cx, cy] = position(p.x, p.y).split(','); return <circle key={i} cx={cx} cy={cy} r="2" fill="#0066dc" opacity={(i + 1) / trail.length * 0.65}/>; })}
      {sample && <circle cx={160 + (vehicle ? -sample.x : sample.x) / scale * 112} cy={160 - sample.y / scale * 112} r="6" fill="#0066dc" stroke="white" strokeWidth="2"/>}
      <text x="160" y="287" textAnchor="middle">바깥 원 {scale.toFixed(1)} G</text>
    </svg>
    <div className="gforce-current">{metric(sample?.magnitude)}</div>
    <div className="gforce-max"><span>MAX XY <b>{metric(data.samples.length ? data.maxG : undefined)}</b></span><span>MAX |{vehicle ? 'Y' : 'X'}| <b>{metric(data.samples.length ? data.maxX : undefined)}</b></span><span>MAX |{vehicle ? 'X' : 'Y'}| <b>{metric(data.samples.length ? data.maxY : undefined)}</b></span></div>
    <p>{vehicle ? '차량 Y 횡(좌측+) / X 종(전진+)' : displayMode === 'sensorAdjusted' ? '센서 X/Y에서 초기 정지 벡터를 뺀 변화량입니다. 차량 전후·좌우가 아니며, 주행 중 기울기 변화는 남습니다. 재연결 뒤에도 동일한 초기 기준을 쓰는 비교용 표시입니다.' : '센서 X/Y specific force · 중력 포함, 차량 방향 아님'}<br/>{session?.error ?? (session?.result ? (!session.result.rotation ? '차량축 자동 추정 보류 · 센서축으로 표시 중' : session.result.status) : 'IMU 분석 중…')}<br/>{!sample && session?.result ? '현재 시각에 유효한 IMU 표본이 없습니다. 재생 위치를 이동해 주세요.' : 'MAX는 선택한 표시 모드의 전체 유효 표본 기준입니다.'}</p>
  </aside>;
}
