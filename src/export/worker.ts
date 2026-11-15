import type { LoadedRun } from '../state/loadedRun';
import { exportTables } from './tables';
import { buildWorkbook } from './workbook';

const ctx = self as unknown as { onmessage: ((event: MessageEvent<LoadedRun>) => void) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void };
ctx.onmessage = (event) => {
  void buildWorkbook(exportTables(event.data), (message) => ctx.postMessage({ kind: 'progress', message }))
    .then((buffer) => ctx.postMessage({ kind: 'done', buffer }, [buffer]))
    .catch((error: unknown) => ctx.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) }));
};
