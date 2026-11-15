import { useEffect, useRef, useState } from 'react';
import type { LoadedRun } from '../state/loadedRun';

export function ExcelExport({ run }: { run: LoadedRun | null }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => () => { workerRef.current?.terminate(); }, []);
  const start = () => {
    if (!run || workerRef.current) return;
    setBusy(true); setStatus('전체 데이터 준비 중…');
    let worker: Worker;
    try { worker = new Worker(new URL('../export/worker.ts', import.meta.url), { type: 'module' }); }
    catch (error) { setBusy(false); setStatus(`Excel Worker 생성 실패: ${String(error)}`); return; }
    workerRef.current = worker;
    const finish = () => { worker.terminate(); workerRef.current = null; setBusy(false); };
    worker.onerror = () => { setStatus('Excel 생성 실패: 메모리가 부족하거나 Worker 오류가 발생했습니다. 다시 시도해 주세요.'); finish(); };
    worker.onmessage = (event: MessageEvent<{ kind: string; message?: string; buffer?: ArrayBuffer }>) => {
      if (event.data.kind === 'progress') { setStatus(event.data.message ?? '생성 중…'); return; }
      if (event.data.kind === 'error') { setStatus(`Excel 생성 실패: ${event.data.message}`); finish(); return; }
      try {
        const url = URL.createObjectURL(new Blob([event.data.buffer!], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const link = document.createElement('a'); link.href = url; link.download = run.fileName.replace(/\.[^.]+$/, '') + '.xlsx';
        document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setStatus('Excel 다운로드 완료');
      } catch (error) { setStatus(`다운로드 실패: ${String(error)}`); }
      finish();
    };
    try { worker.postMessage(run); } catch (error) { setStatus(`Excel 생성 실패: ${String(error)}`); finish(); }
  };
  return <div><button type="button" className="btn-primary" disabled={!run || busy} onClick={start}>{busy ? 'Excel 생성 중…' : 'Excel 다운로드 (.xlsx)'}</button>{busy && <button type="button" className="sig-toggle" onClick={() => { workerRef.current?.terminate(); workerRef.current = null; setBusy(false); setStatus('Excel 생성 취소'); }}>취소</button>}<span role="status" style={{ display: 'block', fontSize: 11, maxWidth: 260 }}>{status}</span></div>;
}
