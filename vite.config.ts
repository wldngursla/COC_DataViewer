import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => ({
  // GitHub Pages serves this project from /COC_DataViewer/. Keep the dev
  // server at / while emitting production assets for the repository path.
  base: command === 'build' || mode === 'production' ? '/COC_DataViewer/' : '/',
  plugins: [react()],
}))
