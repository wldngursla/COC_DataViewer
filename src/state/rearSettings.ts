import { createContext, useContext } from 'react';
import { defaultRearSettings, type RearSettings } from '../calculations/rearCalibration';
export const RearSettingsContext = createContext<{ settings: RearSettings; setSettings: (s: RearSettings) => void }>({ settings: defaultRearSettings(), setSettings: () => {} });
export const useRearSettings = () => useContext(RearSettingsContext);
