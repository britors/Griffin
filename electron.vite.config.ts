import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { build: { rollupOptions: { input: resolve('src/main/preload.ts') } }, plugins: [externalizeDepsPlugin()] },
  renderer: { publicDir: resolve('logo'), resolve: { alias: { '@renderer': resolve('src/renderer') } }, plugins: [react()] },
})
