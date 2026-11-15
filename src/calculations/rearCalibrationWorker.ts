import type { ParsedLog } from '../parser/types';
import { analyzeRearWheels, type RearSettings } from './rearCalibration';
const ctx = self as unknown as { onmessage: ((e: MessageEvent<{ result: ParsedLog; settings: RearSettings }>) => void) | null; postMessage: (v: unknown) => void };
ctx.onmessage = (e) => {
  try { ctx.postMessage({ result: analyzeRearWheels(e.data.result, e.data.settings) }); }
  catch (error) { ctx.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
