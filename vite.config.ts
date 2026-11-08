import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        alert: path.resolve(__dirname, 'alert.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
