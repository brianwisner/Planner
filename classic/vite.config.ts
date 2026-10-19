import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative paths: published in the planner's classic/ folder, whatever the repo is called.
export default defineConfig({
  plugins: [react()],
  base: './',
})
