import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve('src/renderer'),
  publicDir: resolve('logo'),
  resolve: { alias: { '@renderer': resolve('src/renderer') } },
  plugins: [react()],
  build: { outDir: resolve('dist'), emptyOutDir: true },
})
