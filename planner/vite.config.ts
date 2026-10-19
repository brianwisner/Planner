import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Relative paths ('./') let the built site work from any folder, so renaming the
// GitHub repository (which changes the address) needs no code change. The app uses
// HashRouter, so every page loads the same index.html.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Demo mode (`npm run demo`) swaps in an in-memory database. Defining the
  // flag at build time lets the production build leave the demo code out.
  define: { __DEMO__: JSON.stringify(mode === 'demo') },
  base: './',
  build: { chunkSizeWarningLimit: 900 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/**/*.test.ts'],
  },
}))
