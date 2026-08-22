/**
 * File Loading — V1 첫 화면.
 * 파일 선택/드롭 → Web Worker 파싱(진행률) → 요약 표시 or 오류 표시.
 * 파싱 로직은 src/parser에 있고, 이 페이지는 상태 전이와 표시만 담당한다.
 */

import { useCallback, useState } from 'react';
import { parseLogFile } from '../parser/parseLogFile';
import { LogParseError } from '../parser/types';
import type { ParsedLog } from '../parser/types';
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
  | { phase: 'done'; file: FileInfo; result: ParsedLog }
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

export function FileLoadPage() {
  const [state, setState] = useState<LoadState>({ phase: 'idle' });

  const handleFile = useCallback(
    (file: File) => {
      if (state.phase === 'parsing') return; // 드롭 이벤트는 disabled를 우회할 수 있음
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
        .then((result) => setState({ phase: 'done', file: info, result }))
        .catch((err: unknown) => setState({ phase: 'error', file: info, message: errorMessage(err) }));
    },
    [state.phase],
  );

  const file = state.phase === 'idle' ? null : state.file;
  const parsing = state.phase === 'parsing';

  return (
    <main className="page">
      <FileDropZone onFile={handleFile} disabled={parsing} compact={state.phase === 'done'} />

      {file !== null && (
        <div className="file-info">
          <span className="file-name">{file.name}</span>
          <span className="file-size">{formatBytes(file.size)}</span>
          {state.phase === 'done' && (
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

      {state.phase === 'done' && <ParseSummary result={state.result} />}
    </main>
  );
}
