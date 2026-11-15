import type { LoadedRun } from '../state/loadedRun';
import { exportTables } from './tables';
import { buildWorkbook } from './workbook';
import type { RearSettings } from '../calculations/rearCalibration';
import type { ImuSettings } from '../calculations/imuCalibration';

const ctx = self as unknown as { onmessage: ((event: MessageEvent<LoadedRun & { rearSettings?: RearSettings; imuSettings?: ImuSettings }>) => void) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void };
ctx.onmessage = (event) => {
  void Promise.resolve().then(() => buildWorkbook(exportTables(event.data, event.data.rearSettings, event.data.imuSettings), (message) => ctx.postMessage({ kind: 'progress', message })))
    .then((buffer) => ctx.postMessage({ kind: 'done', buffer }, [buffer]))
    .catch((error: unknown) => ctx.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) }));
};
