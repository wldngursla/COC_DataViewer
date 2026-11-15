import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RearSettingsProvider } from './components/RearSettingsProvider'
import { ImuSessionProvider } from './components/ImuSessionProvider'
import './ui/iosTheme.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RearSettingsProvider><ImuSessionProvider><App /></ImuSessionProvider></RearSettingsProvider>
  </StrictMode>,
)
