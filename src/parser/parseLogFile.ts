/**
 * Promise-based front door for the UI: read a File, parse it in a Web Worker,
 * report progress. This is the only parser API React code should touch.
 */

import { LogParseError } from './types';
import type { LogParseErrorCode, ParsedLog } from './types';
import type { WorkerResponse } from './worker';

export interface ParseLogFileOptions {
  /** 0..1 fraction of parsing done */
  onProgress?: (fraction: number) => void;
}

export function parseLogFile(file: File, options?: ParseLogFileOptions): Promise<ParsedLog> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

    const fail = (err: unknown) => {
      worker.terminate();
      reject(err);
    };

    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      switch (msg.kind) {
        case 'progress':
          options?.onProgress?.(msg.total === 0 ? 0 : msg.done / msg.total);
          break;
        case 'done':
          worker.terminate();
          resolve(msg.result);
          break;
        case 'error':
          fail(new LogParseError(msg.code as LogParseErrorCode, msg.message));
          break;
      }
    };
    worker.onerror = (ev) => fail(new Error(ev.message || 'parser worker crashed'));

    file
      .arrayBuffer()
      .then((buffer) => worker.postMessage({ buffer }, [buffer]))
      .catch(fail);
  });
}
