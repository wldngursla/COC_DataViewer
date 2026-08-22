/**
 * .log file picker: a click-to-browse button plus a drag & drop target.
 * Local Browser File API only — the file never leaves the machine.
 */

import { useRef, useState } from 'react';
import type { DragEvent, ChangeEvent } from 'react';

interface FileDropZoneProps {
  onFile: (file: File) => void;
  /** true while a parse is running — input is blocked */
  disabled: boolean;
  /** slim layout once a result is already on screen */
  compact: boolean;
}

export function FileDropZone({ onFile, disabled, compact }: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const pick = (file: File | undefined) => {
    if (!disabled && file) onFile(file);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    pick(e.dataTransfer.files[0]);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // required to allow dropping
    if (!disabled) setDragOver(true);
  };

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    pick(e.target.files?.[0] ?? undefined);
    e.target.value = ''; // allow re-selecting the same file
  };

  return (
    <div
      className={[
        'dropzone',
        compact ? 'dropzone-compact' : '',
        dragOver ? 'dropzone-over' : '',
        disabled ? 'dropzone-disabled' : '',
      ].join(' ')}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".log"
        hidden
        onChange={onInputChange}
        disabled={disabled}
      />
      <div className="dropzone-text">
        {compact ? (
          <span>다른 .log 파일을 여기에 끌어다 놓거나</span>
        ) : (
          <>
            <div className="dropzone-title">.log 파일을 여기에 끌어다 놓으세요</div>
            <div className="dropzone-sub">
              ESP32 데이터로거의 binary 로그 — 모든 분석은 브라우저 안에서만 수행됩니다
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        파일 선택
      </button>
    </div>
  );
}
