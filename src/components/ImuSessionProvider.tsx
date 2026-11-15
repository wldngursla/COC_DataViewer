import { useEffect, useState, type ReactNode } from 'react';
import type { ParsedLog } from '../parser/types';
import { defaultImuSettings, type ImuAnalysis } from '../calculations/imuCalibration';
import { ImuSessionContext, type ImuSessionResult } from '../state/imuSession';
export function ImuSessionProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultImuSettings);
  const [parsed, request] = useState<ParsedLog | null>(null);
  const [data, setData] = useState<ImuSessionResult | null>(null);
  useEffect(() => {
    if (!parsed) return;
    let worker: Worker | undefined;
    const timer = setTimeout(() => {
      try {
        worker = new Worker(new URL('../calculations/imuWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ result?: ImuAnalysis; error?: string }>) => { setData({ parsed, settings, ...event.data }); worker?.terminate(); };
        worker.onerror = () => { setData({ parsed, settings, error: 'IMU Worker 오류' }); worker?.terminate(); };
        worker.postMessage({ parsed, settings });
      } catch (error) { setData({ parsed, settings, error: String(error) }); }
    }, 200);
    return () => { clearTimeout(timer); worker?.terminate(); };
  }, [parsed, settings]);
  return <ImuSessionContext.Provider value={{ settings, setSettings, request, data }}>{children}</ImuSessionContext.Provider>;
}
