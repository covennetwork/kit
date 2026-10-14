import { defineConfig } from 'vite'

export default defineConfig({
  root: __dirname,
  define: { 'process.env.NODE_ENV': '"production"' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { port: 5199 },
})
