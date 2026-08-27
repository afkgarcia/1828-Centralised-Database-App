import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Web build of the SAME renderer the desktop app uses — the api.ts adapter
 * switches to fetch when no preload bridge is present. Dev: run the API via
 * `npm run web:server`, then `npm run web:dev` proxies /api to it.
 */
export default defineConfig({
  root: resolve(__dirname, '../desktop/renderer'),
  plugins: [react()],
  resolve: {
    alias: { '@shared': resolve(__dirname, '../shared') },
  },
  build: {
    outDir: resolve(__dirname, 'dist-renderer'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8028' },
  },
});
