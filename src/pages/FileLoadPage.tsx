/**
 * File Loading — 진입 화면.
 * 파일 선택/드롭 → Web Worker 파싱(진행률) → 성공 시 onLoaded로 App에 run을
 * 넘긴다(App이 Overview로 전환). 이 화면으로 돌아오면 마지막 run의 Parse
 * Summary를 보여주고 새 파일을 받을 수 있다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseLogFile } from '../parser/parseLogFile';
import { LogParseError } from '../parser/types';
import type { LoadedRun } from '../state/loadedRun';
import { formatBytes } from '../ui/format';
import { FileDropZone } from '../components/FileDropZone';
import { ParseSummary } from '../components/ParseSummary';

interface FileInfo {
  name: string;
  size: number;
}

type LoadState =
  | { phase: 'idle' }
  | { phase: 'parsing'; file: FileInfo; progress: number }
  | { phase: 'error'; file: FileInfo; message: string };

function errorMessage(err: unknown): string {
  if (err instanceof LogParseError) {
    switch (err.code) {
      case 'EMPTY_FILE':
        return '빈 파일입니다.';
      case 'TOO_SMALL':
        return '파일이 너무 작습니다 — 24 byte 레코드 하나보다 작습니다.';
      case 'NOT_A_LOG':
        return 'COC 데이터로거 로그 파일이 아닙니다 (유효한 레코드를 찾지 못했습니다).';
      case 'UNSUPPORTED_PROTOCOL':
        return `지원하지 않는 프로토콜 버전입니다 — ${err.message}`;
      default:
        return `파싱 중 오류가 발생했습니다: ${err.message}`;
    }
  }
  return `파일을 읽는 중 오류가 발생했습니다: ${err instanceof Error ? err.message : String(err)}`;
}

interface FileLoadPageProps {
  /** 마지막으로 성공한 run (App 소유) — 이 화면에서는 요약으로 보여준다 */
  run: LoadedRun | null;
  onLoaded: (run: LoadedRun) => void;
}

export function FileLoadPage({ run, onLoaded }: FileLoadPageProps) {
  const [state, setState] = useState<LoadState>({ phase: 'idle' });
  const onLoadedRef = useRef(onLoaded);
  const loadVersion = useRef(0);
  useEffect(() => { onLoadedRef.current = onLoaded; }, [onLoaded]);
  useEffect(() => {
    if (run !== null) return;
    const version = ++loadVersion.current;
    let cancelled = false;
    const controller = new AbortController();
    const info = { name: '00000175-2026-09-20-16-26-47.log', size: 2452032 };
    void fetch(`${import.meta.env.BASE_URL}data/default-run.bin`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('기본 로그를 불러올 수 없습니다. 다른 파일을 선택해 주세요.');
        const file = new File([await response.blob()], info.name);
        if (cancelled || version !== loadVersion.current) return;
        setState({ phase: 'parsing', file: { ...info, size: file.size }, progress: 0 });
        const result = await parseLogFile(file, { onProgress: (progress) => {
          if (!cancelled && version === loadVersion.current) setState({ phase: 'parsing', file: info, progress });
        } });
        if (!cancelled && version === loadVersion.current) onLoadedRef.current({ fileName: file.name, fileSize: file.size, result });
      }).catch((err: unknown) => {
        if (!cancelled && !controller.signal.aborted && version === loadVersion.current) setState({ phase: 'error', file: info, message: errorMessage(err) });
      });
    return () => { cancelled = true; controller.abort(); };
  }, [run]);

  const handleFile = useCallback(
    (file: File) => {
      if (state.phase === 'parsing') return; // 드롭 이벤트는 disabled를 우회할 수 있음
      loadVersion.current++;
      const info: FileInfo = { name: file.name, size: file.size };
      setState({ phase: 'parsing', file: info, progress: 0 });

      parseLogFile(file, {
        onProgress: (fraction) =>
          setState((prev) =>
            prev.phase === 'parsing' && prev.file === info
              ? { ...prev, progress: fraction }
              : prev,
          ),
      })
        .then((result) => {
          setState({ phase: 'idle' });
          onLoaded({ fileName: info.name, fileSize: info.size, result });
        })
        .catch((err: unknown) => setState({ phase: 'error', file: info, message: errorMessage(err) }));
    },
    [state.phase, onLoaded],
  );

  const parsing = state.phase === 'parsing';
  // 파싱/오류 중에는 그 파일을, 아니면 마지막 성공 run의 파일을 보여준다
  const shownFile: FileInfo | null =
    state.phase !== 'idle' ? state.file : run !== null ? { name: run.fileName, size: run.fileSize } : null;
  const showLastRun = state.phase === 'idle' && run !== null;

  return (
    <main className="page">
      <h1>로그 파일 변경</h1>
      <p>첫 접속에는 기본 주행 로그를 표시합니다. 다른 로그는 아래에서 선택하거나 끌어다 놓으세요.</p>
      <FileDropZone onFile={handleFile} disabled={parsing} compact={showLastRun} />

      {shownFile !== null && (
        <div className="file-info">
          <span className="file-name">{shownFile.name}</span>
          <span className="file-size">{formatBytes(shownFile.size)}</span>
          {showLastRun && (
            <span className="file-status status-ok">
              <span aria-hidden="true">✓</span> Parsing 완료
            </span>
          )}
          {state.phase === 'error' && (
            <span className="file-status status-error">
              <span aria-hidden="true">✕</span> Parsing 실패
            </span>
          )}
        </div>
      )}

      {parsing && (
        <div className="progress-block" aria-live="polite">
          <div className="progress-row">
            <span className="progress-label">Parsing…</span>
            <span className="progress-percent">{Math.round(state.progress * 100)}%</span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(state.progress * 100)}
          >
            <div className="progress-fill" style={{ width: `${state.progress * 100}%` }} />
          </div>
        </div>
      )}

      {state.phase === 'error' && (
        <div className="error-box" role="alert">
          <div className="error-title">
            <span aria-hidden="true">✕</span> 파일을 분석할 수 없습니다
          </div>
          <div className="error-message">{state.message}</div>
        </div>
      )}

      {showLastRun && <ParseSummary result={run.result} />}
    </main>
  );
}
