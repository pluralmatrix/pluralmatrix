import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import istanbul from 'vite-plugin-istanbul'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    istanbul({
      include: 'src/**',
      exclude: ['node_modules', 'test/**'],
      extension: ['.ts', '.tsx'],
      requireEnv: false,
      forceBuildInstrument: process.env.VITE_COVERAGE === 'true',
    }),
  ],
  build: {
    sourcemap: process.env.VITE_COVERAGE === 'true',
  }
})
