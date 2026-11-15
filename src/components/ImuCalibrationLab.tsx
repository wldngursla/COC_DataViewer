import { useState } from 'react';
import type { LoadedRun } from '../state/loadedRun';
import { useImuAnalysis, useImuSettings } from '../state/imuSession';
import { defaultImuSettings, type ImuSettings } from '../calculations/imuCalibration';
import { determinant, type Vec3 } from '../calculations/imuMath';
import { ImuComparisonChart, type ImuDisplay } from './ImuComparisonChart';
import './ImuCalibrationLab.css';
const n = (v: number | null | undefined) => v === null || v === undefined ? 'N/A' : v.toFixed(4);
export function ImuCalibrationLab({ run }: { run: LoadedRun }) {
  const { settings: s, setSettings } = useImuSettings();
  const data = useImuAnalysis(run.result); const a = data?.result;
  const [mode, setMode] = useState<ImuDisplay>('compare');
  const [linear, setLinear] = useState(true);
  const checkbox = (key: keyof ImuSettings, title: string) => <label key={key}><input type="checkbox" checked={s[key] as boolean} onChange={(e) => setSettings({ ...s, [key]: e.target.checked })} />{title}</label>;
  const numeric = (key: keyof ImuSettings, title: string, nullable = false) => <label key={key}>{title}<input type="number" step="any" value={s[key] as number ?? ''} onChange={(e) => setSettings({ ...s, [key]: nullable && e.target.value === '' ? null : Number(e.target.value) })} /></label>;
  return <section className="imu-lab summary-section">
    <h2>IMU Calibration · Vehicle Coordinates</h2>
    <p>차량 +X 전진 · +Y 좌측 · +Z 위쪽. 원본 센서 specific force, 차량 specific force, 중력 제거 선형가속도를 구분합니다. 자동 보정이 보류되면 Raw는 유지하며 차량축 결과는 N/A입니다.</p>
    <details><summary>보정·필터 설정 (Excel과 공유)</summary><div className="imu-settings">
      {checkbox('autoStationary', '초기 정지 구간 자동 탐색')}{numeric('stationarySeconds', '최소 정지 시간 (s)')}{numeric('searchSeconds', '초기 검색 범위 (s)')}
      {numeric('stationaryStartMs', '수동 정지 시작 (부팅 후 ms)', true)}{numeric('stationaryEndMs', '수동 정지 종료 (부팅 후 ms)', true)}{checkbox('stationaryConfirmed', '수동 구간에서 실제 정차했음을 확인')}
      {checkbox('autoAxes', 'GPS 기반 축 추정')}{checkbox('forwardConfirmed', '추정 대상 구간 전진 주행 확인 (후진 아님)')}
      <label>장착 좌표계<select value={s.mounting} onChange={(e) => setSettings({ ...s, mounting: e.target.value as ImuSettings['mounting'] })}><option value="auto">자동 (검증 통과 시)</option><option value="mapping">수동 센서축 매핑</option><option value="angles">수동 Euler 장착 회전</option></select></label>
      {[0, 1, 2].map((j) => <label key={j}>차량 {['X 전진', 'Y 좌측', 'Z 위쪽'][j]} = 센서<select value={s.axes[j]} onChange={(e) => { const axes: Vec3 = [...s.axes]; axes[j] = Number(e.target.value); setSettings({ ...s, axes }); }}>{[1, -1, 2, -2, 3, -3].map((value) => <option key={value} value={value}>{value > 0 ? '+' : '−'}{['X', 'Y', 'Z'][Math.abs(value) - 1]}</option>)}</select></label>)}
      {[0, 1, 2].map((j) => <label key={j}>Rz(yaw)·Ry(pitch)·Rx(roll): {['roll', 'pitch', 'yaw'][j]} °<input type="number" value={s.angles[j]} step="any" onChange={(e) => { const angles: Vec3 = [...s.angles]; angles[j] = Number(e.target.value); setSettings({ ...s, angles }); }} /></label>)}
      {checkbox('removeGravity', '중력 제거')}
      <label>중력 방법<select value={s.gravityMethod} onChange={(e) => setSettings({ ...s, gravityMethod: e.target.value as ImuSettings['gravityMethod'] })}><option value="complementary">Gyro 전파 + 정차 시 complementary</option><option value="static">초기 중력 고정 (피치·롤 오차 있음)</option></select></label>
      {numeric('attitudeTau', '정차 자세 보정 tau (s)')}{numeric('maxPropagationSeconds', '정차 보정 없이 전파 허용 시간 (s)')}
      {checkbox('hampel', 'Hampel (오프라인 중앙 window)')}{numeric('window', 'Hampel window (홀수 3–101)')}{numeric('threshold', 'Hampel threshold')}{checkbox('lowpass', '인과 EMA 저역통과')}{numeric('tau', 'EMA tau (s)')}
      {numeric('maxAccelG', '유효 축별 가속도 한계 ≤8 (g)')}{numeric('maxGyroDps', '유효 축별 각속도 한계 ≤500 (deg/s)')}{numeric('gapMs', '공백 reset (ms)')}{numeric('toleranceMs', '정렬 허용 간격 (ms)')}{numeric('gpsLagMs', 'GPS lag (ms), 빈칸=자동 추정', true)}
      <button type="button" className="sig-toggle" onClick={() => setSettings(defaultImuSettings())}>IMU 설정 초기화</button>
    </div></details>
    {!data && <p role="status">IMU 보정 분석 중…</p>}{data?.error && <p role="alert">{data.error}</p>}
    {a && <>
      <p role="status"><strong>{a.status}</strong> · {a.rotation ? '차량 회전행렬 적용' : '차량축 보류 · Raw 확인 가능'}</p>
      <div className="signal-toggles">{(['raw', 'calibrated', 'filtered', 'compare'] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} className={`sig-toggle${mode === value ? ' sig-on' : ''}`} onClick={() => setMode(value)}>{value}</button>)}<label><input type="checkbox" checked={linear} onChange={(e) => setLinear(e.target.checked)} /> 차량 선형가속도 (해제=중력 포함 specific force)</label></div>
      <p>Raw=센서 X/Y/Z specific force. Calibrated/Filtered=차량 종/횡/수직 및 Roll/Pitch/Yaw. 실선은 차량축, 점선 Raw는 센서축이며 동일 축으로 해석하면 안 됩니다. 필터링은 센서축 Hampel→EMA 후 같은 회전행렬을 적용합니다.</p>
      {!a.rotation && <p>차량축 보류 상태: Filtered는 중력 포함 센서 specific force, 각속도는 확인된 구간의 센서 bias-corrected 값으로 표시됩니다. 차량 종/횡가속도·요레이트를 뜻하지 않습니다.</p>}
      <ImuComparisonChart analysis={a} mode={mode} linear={linear} />
      <div className="imu-info">
        <div><h3>정지 보정</h3><p>{a.stationary ? `${a.stationary.start}–${a.stationary.end} ms, n=${a.stationary.count}, ${a.stationary.source}` : '연속 정차를 확인하지 못했습니다. 수동 구간과 실제 정차 확인을 설정하세요.'}</p><p>Gyro bias (deg/s): {a.stationary?.bias.map(n).join(', ') ?? 'N/A'}</p><p>중력 기준 센서 (g): {a.stationary?.gravity.map(n).join(', ') ?? 'N/A'}</p><p>가속도 / 자이로 변동: {n(a.stationary?.accelStd)} g / {n(a.stationary?.gyroStd)} deg/s</p></div>
        <div><h3>장착 회전 R_vehicle_sensor</h3><pre>{a.rotation?.map((r) => r.map(n).join('  ')).join('\n') ?? 'N/A'}</pre><p>det(R)={a.rotation ? n(determinant(a.rotation)) : 'N/A'}</p><details><summary>미적용 자동 후보</summary><pre>{a.candidateRotation?.map((r) => r.map(n).join('  ')).join('\n') ?? 'N/A'}</pre></details><p>앞 70% 학습 {a.axisTraining} / 뒤 30% 검증 {a.axisValidation}. 가속·감속 모두 필요. Forward 검증 MAE/RMSE {n(a.forwardError.mae)}/{n(a.forwardError.rmse)} g, R² {n(a.forwardError.r2)}.</p></div>
        <div><h3>GPS 비교·품질</h3><p>lag {a.lag.ms} ms · {a.lag.source} · corr {n(a.lag.correlation)}</p><p>센서 raw Z yaw MAE/RMSE {n(a.rawYawError.mae)}/{n(a.rawYawError.rmse)} (센서축 참고값)</p><p>차량 yaw MAE/RMSE {n(a.yawError.mae)}/{n(a.yawError.rmse)} deg/s · n={a.yawError.count}</p><p>차량 횡가속도 vs GPS v×yaw MAE/RMSE {n(a.lateralError.mae)}/{n(a.lateralError.rmse)} g · n={a.lateralError.count}</p><p>물리 무효 {a.counts.invalid}, Hampel {a.counts.hampel}, 유효 선형 {a.counts.linear}/{a.rows.length}, gap {a.counts.gaps}, 중복/역전 {a.cadence.regressions}. median dt {n(a.cadence.medianMs)} ms / max gap {a.cadence.maxGapMs} ms</p></div>
      </div>
      <p>자동 적용 기준: 학습≥40·검증≥20, 양쪽 구간 가속/감속 포함, 전진축 검증 R²≥0.5·RMSE≤0.08g, 별도 선회 검증≥30·yaw MAE≤5deg/s·R²≥0.5, 전진 주행 확인. GPS 위성 수·HDOP·fix 품질은 로그에 없습니다.</p>
      <p>선회축 검증: n={a.turnValidation.count}, MAE={n(a.turnValidation.mae)} deg/s, R²={n(a.turnValidation.r2)}. 직진 후보 제외 이유: {Object.entries(a.axisReasons).map(([key, count]) => `${key}=${count}`).join(' · ') || '후보 없음 / 추정 비활성화'}.</p>
      <details><summary>재연결 구간별 정지 보정 ({a.calibrations.length})</summary>{a.calibrations.map((c) => <p key={c.epoch}>epoch {c.epoch}: {c.start}–{c.end} ms · bias {c.bias.map(n).join(', ')} deg/s · gravity {c.gravity.map(n).join(', ')} g. 자동 장착은 최초 중력 방향과 5° 이상 달라지면 보류됩니다.</p>)}</details>
      {a.notes.map((note) => <p key={note}>{note}</p>)}
    </>}
  </section>;
}
