import type { WheelDisplayMode } from '../calculations/wheelEnvelope';

export function WheelEnvelopeControls({ mode, windowSec, onMode, onWindow }: {
  mode: WheelDisplayMode; windowSec: number;
  onMode: (mode: WheelDisplayMode) => void; onWindow: (seconds: number) => void;
}) {
  return <section className="signal-panel" aria-label="휠 속도 파형 표시">
    <div className="signal-group">
      <div className="signal-group-label">Wheel speed display</div>
      <div className="signal-toggles">
        {([['envelope', 'Envelope'], ['both', 'Envelope + 원본'], ['raw', '원본']] as const).map(([value, label]) =>
          <button key={value} type="button" className={`sig-toggle${mode === value ? ' sig-on' : ''}`} aria-pressed={mode === value} onClick={() => onMode(value)}>{label}</button>)}
      </div>
    </div>
    <div className="signal-group">
      <div className="signal-group-label">평활 구간</div>
      <div className="signal-toggles">
        {[0.25, 0.5, 1, 2].map((value) => <button key={value} type="button" disabled={mode === 'raw'} className={`sig-toggle${windowSec === value ? ' sig-on' : ''}`} aria-pressed={windowSec === value} onClick={() => onWindow(value)}>{value}초</button>)}
      </div>
    </div>
    <p className="vehicle-note">굵은 선: 구간 중앙값 추세 · 점선: 최저/최고 envelope. 구간이 길수록 변화가 완만해집니다. 표시용 가공이며 Current Values와 원본 데이터는 유지됩니다.</p>
  </section>;
}
