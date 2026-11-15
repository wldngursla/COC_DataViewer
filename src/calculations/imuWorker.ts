import type { ParsedLog } from '../parser/types';
import { analyzeImu, type ImuSettings } from './imuCalibration';
const ctx = self as unknown as { onmessage: ((e: MessageEvent<{ parsed: ParsedLog; settings: ImuSettings }>) => void) | null; postMessage: (value: unknown) => void };
ctx.onmessage = (event) => {
  try { ctx.postMessage({ result: analyzeImu(event.data.parsed, event.data.settings) }); }
  catch (error) { ctx.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
