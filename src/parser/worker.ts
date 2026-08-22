/**
 * Web Worker entry — runs parseLog off the main thread so the UI can show
 * parsing progress on large files. Spawned by parseLogFile.ts.
 */

import { parseLog } from './parseLog';
import { LogParseError } from './types';
import type { ParsedLog } from './types';

export type WorkerRequest = { buffer: ArrayBuffer };

export type WorkerResponse =
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'done'; result: ParsedLog }
  | { kind: 'error'; code: string; message: string };

// minimal worker-scope typing — the project tsconfig uses the DOM lib, not WebWorker
interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
}

const ctx = self as unknown as WorkerScope;

/** Every typed-array buffer in the result, for zero-copy transfer back. */
function collectTransferables(result: ParsedLog): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  const add = (a: { buffer: ArrayBufferLike }) => {
    if (a.buffer instanceof ArrayBuffer) buffers.add(a.buffer);
  };

  add(result.can.timestamp);
  add(result.can.id);
  add(result.can.extended);
  add(result.can.remote);
  add(result.can.len);
  add(result.can.data);
  add(result.gps.timestamp);
  add(result.gps.latitudeRaw);
  add(result.gps.longitudeRaw);
  add(result.gps.latDir);
  add(result.gps.lonDir);
  add(result.gps.speedRaw);
  add(result.gps.courseRaw);
  add(result.analog.timestamp);
  result.analog.ain.forEach(add);
  add(result.digital.timestamp);
  result.digital.din.forEach(add);
  add(result.gyro.timestamp);
  add(result.gyro.accelX);
  add(result.gyro.accelY);
  add(result.gyro.accelZ);
  add(result.gyro.temperature);
  add(result.gyro.gyroX);
  add(result.gyro.gyroY);
  add(result.gyro.gyroZ);

  return [...buffers];
}

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  try {
    // throttle progress messages: at 65536-slot granularity they are already sparse
    const result = parseLog(ev.data.buffer, (done, total) => {
      ctx.postMessage({ kind: 'progress', done, total });
    });
    ctx.postMessage({ kind: 'done', result }, collectTransferables(result));
  } catch (err) {
    if (err instanceof LogParseError) {
      ctx.postMessage({ kind: 'error', code: err.code, message: err.message });
    } else {
      ctx.postMessage({ kind: 'error', code: 'INTERNAL', message: String(err) });
    }
  }
};
