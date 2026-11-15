import { useState, type ReactNode } from 'react';
import { defaultRearSettings } from '../calculations/rearCalibration';
import { RearSettingsContext } from '../state/rearSettings';
export function RearSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultRearSettings);
  return <RearSettingsContext.Provider value={{ settings, setSettings }}>{children}</RearSettingsContext.Provider>;
}
