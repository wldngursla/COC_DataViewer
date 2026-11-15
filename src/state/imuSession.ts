import { createContext, useContext, useEffect } from 'react';
import type { ParsedLog } from '../parser/types';
import { defaultImuSettings, type ImuAnalysis, type ImuSettings } from '../calculations/imuCalibration';
export interface ImuSessionResult { parsed: ParsedLog; settings: ImuSettings; result?: ImuAnalysis; error?: string }
export const ImuSessionContext = createContext<{
  settings: ImuSettings; setSettings: (value: ImuSettings) => void;
  request: (parsed: ParsedLog) => void; data: ImuSessionResult | null;
}>({ settings: defaultImuSettings(), setSettings: () => {}, request: () => {}, data: null });
export const useImuSettings = () => useContext(ImuSessionContext);
export function useImuAnalysis(parsed: ParsedLog) {
  const { settings, request, data } = useImuSettings();
  useEffect(() => { request(parsed); }, [parsed, request]);
  return data?.parsed === parsed && data.settings === settings ? data : null;
}
