import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The app is served from GitHub Pages under /Who-knows/ (the repo name).
// If the repo is ever renamed, change this one line.
export default defineConfig({
  plugins: [react()],
  base: '/Who-knows/',
})
