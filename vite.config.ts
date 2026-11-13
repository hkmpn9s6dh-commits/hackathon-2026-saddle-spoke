import { defineConfig } from 'vite'

// Static, single-page, no server. `base: './'` keeps the build portable between
// GitHub Pages project sites and local preview.
export default defineConfig({
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 0 },
})
