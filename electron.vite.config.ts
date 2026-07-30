import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), 'onnx-separation-worker': resolve('src/main/onnx-separation-worker.ts') } } }, plugins: [externalizeDepsPlugin()] },
  preload: { build: { rollupOptions: { input: resolve('src/main/preload.ts') } }, plugins: [externalizeDepsPlugin()] },
  renderer: { publicDir: resolve('logo'), resolve: { alias: { '@renderer': resolve('src/renderer') } }, plugins: [react()] },
})
