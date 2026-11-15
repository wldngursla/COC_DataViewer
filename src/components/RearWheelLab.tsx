import { useEffect, useState } from 'react';
import type { LoadedRun } from '../state/loadedRun';
import { useRearSettings } from '../state/rearSettings';
import { defaultRearSettings, type RearAnalysis, type RearSettings } from '../calculations/rearCalibration';
import { RearComparisonChart } from './RearComparisonChart';
import './RearWheelLab.css';
const n = (v: number | null | undefined) => v === null || v === undefined || !Number.isFinite(v) ? 'N/A' : v.toFixed(3);
export function RearWheelLab({ run }: { run: LoadedRun }) {
  const { settings: s, setSettings } = useRearSettings();
  const [state, setState] = useState<{ run: LoadedRun; settings: RearSettings; result?: RearAnalysis; error?: string } | null>(null);
  const [mode, setMode] = useState<'raw' | 'corrected' | 'filtered' | 'compare'>('compare');
  useEffect(() => {
    let worker: Worker | undefined;
    const timer = setTimeout(() => {
      try {
        worker = new Worker(new URL('../calculations/rearCalibrationWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent<{ result?: RearAnalysis; error?: string }>) => { setState({ run, settings: s, ...e.data }); worker?.terminate(); };
        worker.onerror = () => { setState({ run, settings: s, error: '분석 Worker 오류' }); worker?.terminate(); };
        worker.postMessage({ result: run.result, settings: s });
      } catch (error) { setState({ run, settings: s, error: String(error) }); }
    }, 250);
    return () => { clearTimeout(timer); worker?.terminate(); };
  }, [run, s]);
  const current = state?.run === run && state.settings === s ? state : null;
  const a = current?.result;
  const numeric = (key: keyof RearSettings, label: string, nullable = false) => <label key={key}>{label}<input type="number" step="any" value={s[key] as number ?? ''} onChange={(e) => setSettings({ ...s, [key]: nullable && e.target.value === '' ? null : Number(e.target.value) })} /></label>;
  return <section className="rear-lab summary-section">
    <h2>Rear Wheel Calibration Lab</h2>
    <p>저장된 km/h의 검증·후처리 도구입니다. 원시 펄스가 없어 펌웨어의 PPR/둘레를 소급 수정할 수 없습니다. 기존 그래프·원본값은 유지됩니다.</p>
    <div className="rear-settings">
      <label><input type="checkbox" checked={s.gpsEnabled} onChange={(e) => setSettings({ ...s, gpsEnabled: e.target.checked })} /> GPS 기반 추정 사용</label>
      <label>계수 적용<select value={s.mode} onChange={(e) => setSettings({ ...s, mode: e.target.value as RearSettings['mode'] })}><option value="off">OFF (추정만)</option><option value="auto">자동 (검증 통과 시만 적용)</option><option value="manual">수동 a,b</option></select></label>
      {[0, 1].map((w) => <fieldset key={w}><legend>{w ? 'RR' : 'RL'} manual</legend>{(['a', 'b'] as const).map((key) => <label key={key}>{key}<input type="number" step="any" value={s[key][w]} onChange={(e) => { const values: [number, number] = [...s[key]]; values[w] = Number(e.target.value); setSettings({ ...s, [key]: values }); }} /></label>)}</fieldset>)}
      <label><input type="checkbox" checked={s.hampel} onChange={(e) => setSettings({ ...s, hampel: e.target.checked })} /> Hampel</label>
      {numeric('window', 'Hampel window (odd, 3–101)')}{numeric('threshold', 'Hampel threshold')}
      <label><input type="checkbox" checked={s.ema} onChange={(e) => setSettings({ ...s, ema: e.target.checked })} /> EMA</label>
      {numeric('tau', 'EMA tau (s)')}{numeric('maximumKmh', '분석 최대속도 (km/h)')}{numeric('accelerationMs2', '허용 가감속 (m/s²)')}{numeric('minimumGps', '최소 GPS 보정속도 (km/h)')}{numeric('toleranceMs', '최대 시간 정렬 간격 (ms)')}{numeric('gapMs', '공백 reset (ms)')}
      {numeric('circumferenceM', '유효 구름 둘레 (m), 미확정=빈칸', true)}{numeric('gearRatio', '전체 감속비 Motor/Wheel, 미확정=빈칸', true)}{numeric('ppr', 'PPR 기록용 (펄스 재계산 안 함)', true)}
      <label>구동 구조<select value={s.drivetrain} onChange={(e) => setSettings({ ...s, drivetrain: e.target.value as RearSettings['drivetrain'] })}><option value="unknown">미확정</option><option value="both">양쪽 후륜 구동</option><option value="single">단일 후륜 구동</option></select></label>
      {numeric('trackM', '후륜 트레드 (m)', true)}
      <label><input type="checkbox" checked={s.yawConfirmed} onChange={(e) => setSettings({ ...s, yawConfirmed: e.target.checked })} /> Gyro Z=차량 yaw 축 확인됨</label>
      <label>RR−RL yaw 부호<select value={s.yawSign} onChange={(e) => setSettings({ ...s, yawSign: Number(e.target.value) })}><option value={1}>+1</option><option value={-1}>−1</option></select></label>
      <button type="button" className="sig-toggle" onClick={() => setSettings(defaultRearSettings())}>분석 설정 초기화</button>
    </div>
    <p>자동 모델 GPS = a × Hall (b=0). 기준: GPS ≥ 최소속도, |가감속| ≤ 2.5 m/s², |센서 Gyro Z| ≤ 5 deg/s(있을 때), 좌우 raw 차이 ≤20%. 시간 순서 앞 70%로 학습·지연 추정, 뒤 30%로 검증합니다. 지연 부호: GPS(t+lag)와 Hall(t) 비교. 위성 품질 정보는 로그에 없습니다.</p>
    {!current && <p role="status">분석 중… 설정 변경 후 결과를 다시 계산합니다.</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {a && <>
      <div className="signal-toggles">{(['raw', 'corrected', 'filtered', 'compare'] as const).map((m) => <button type="button" className={`sig-toggle${mode === m ? ' sig-on' : ''}`} key={m} onClick={() => setMode(m)}>{m}</button>)}</div>
      <RearComparisonChart analysis={a} mode={mode} />
      <div className="health-table-wrap"><table className="rear-results"><thead><tr><th>Wheel</th><th>적용</th><th>추정 a / 적용 a,b</th><th>Raw/Corrected/Filtered max km/h</th><th>보류/신뢰도</th><th>lag / corr</th><th>학습 / 검증</th><th>이상치 수 / 비율</th><th>Holdout Raw MAE/RMSE</th><th>Corrected MAE/RMSE</th><th>Filtered MAE/RMSE / n</th></tr></thead><tbody>{a.fits.map((f, w) => <tr key={w}><th>{w ? 'RR' : 'RL'}</th><td>{a.coefficients[w].applied}</td><td>{n(f.a)} / {n(a.coefficients[w].a)}, {n(a.coefficients[w].b)}</td><td>{n(a.max[w].raw)} / {n(a.max[w].corrected)} / {n(a.max[w].filtered)}</td><td>{f.reason}</td><td>{f.lagMs} ms {f.lagTrusted ? '추정됨' : '보류→0'} / {n(f.correlation)}</td><td>{f.training} / {f.validation}<br/>{f.interval?.join('–')} ms</td><td>{a.counts[w]} / {n(a.counts[w] / Math.max(1, a.rows.length) * 100)}%</td><td>{n(f.raw.mae)} / {n(f.raw.rmse)}</td><td>{n(f.corrected.mae)} / {n(f.corrected.rmse)}</td><td>{n(f.filtered.mae)} / {n(f.filtered.rmse)} / {f.filtered.count}</td></tr>)}</tbody></table></div>
      <p>Filtered 지표는 남은 유효 행만 사용합니다. 제외 비율과 표본 수도 비교하세요. 자동계수는 학습 ≥30, 검증 ≥15, 학습속도 범위 ≥10km/h, 기간 ≥10s, 검증 R²≥0.5, RMSE≤max(3km/h, 평균GPS×20%)일 때만 적용합니다.</p>
      {a.fits.map((f, w) => <p key={w}>{w ? 'RR' : 'RL'} 추정 모델 검증: R²={n(f.validationFit.r2)}, MAE={n(f.validationFit.mae)}, RMSE={n(f.validationFit.rmse)} km/h. 모델 검증은 직진 후보에서, 위 처리단계 지표는 이후 전체 주행에서 계산합니다.</p>)}
      {a.fits.map((f, w) => <p key={w}>{w ? 'RR' : 'RL'} 동일 표본 비교 (n={f.commonRaw.count}): Raw MAE/RMSE {n(f.commonRaw.mae)}/{n(f.commonRaw.rmse)} → Filtered {n(f.filtered.mae)}/{n(f.filtered.rmse)} km/h. 이 표본에서 제외된 오류 구간은 복원 성공으로 계산하지 않습니다.</p>)}
      <div className="rear-settings">{a.fits.map((f, w) => <div key={w}><strong>{w ? 'RR' : 'RL'} 속도구간별 검증 (km/h)</strong>{f.bins.map((bin) => <p key={bin.range}>{bin.range}: n={bin.raw.count}, MAE {n(bin.raw.mae)}→{n(bin.corrected.mae)}, RMSE {n(bin.raw.rmse)}→{n(bin.corrected.rmse)}</p>)}</div>)}</div>
      <p>Motor ↔ GPS MAE/RMSE: {n(a.motorComparison.gps.mae)} / {n(a.motorComparison.gps.rmse)} km/h (n={a.motorComparison.gps.count}) · 둘레·감속비 설정이 없으면 N/A. 구동 구조가 미확정이면 모터를 특정 휠의 절대 기준으로 해석하지 마세요. 슬립·제동 중에는 GPS와 달라질 수 있습니다.</p>
      {a.motorComparison.wheels.map((m, w) => <p key={w}>Motor ↔ {w ? 'RR' : 'RL'} MAE/RMSE (km/h): {(['raw', 'corrected', 'filtered'] as const).map((key) => `${key} ${n(m[key].mae)}/${n(m[key].rmse)} (n=${m[key].count})`).join(' · ')}</p>)}
      <p>좌우 차이 (RR−RL)는 각 휠을 독립적으로 처리합니다. {a.rows.filter((r) => r.expectedDelta !== null).length}개 yaw 비교값: 트레드·축/부호 확인 시만 산출하며 측정값에 강제로 맞추지 않습니다.</p>
      {a.notes.map((note) => <p key={note}>{note}</p>)}
    </>}
  </section>;
}
