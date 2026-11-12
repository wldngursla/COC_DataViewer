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
    <p className="vehicle-note">굵은 선: 구간 최고값을 이은 상단 envelope · 점선: 최저값. 0.5초부터 비교하세요. 피크는 노이즈도 포함할 수 있으며 보정된 실제 차속이 아닙니다. Current Values와 원본 데이터는 유지됩니다.</p>
  </section>;
}
