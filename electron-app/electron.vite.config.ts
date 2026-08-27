import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const sharedAlias = { '@shared': resolve(__dirname, 'shared') };

export default defineConfig({
  main: {
    build: {
      lib: { entry: resolve(__dirname, 'desktop/main/index.ts') },
      rollupOptions: { external: ['better-sqlite3'] },
    },
    resolve: { alias: sharedAlias },
  },
  preload: {
    build: {
      lib: { entry: resolve(__dirname, 'desktop/preload/index.ts') },
    },
    resolve: { alias: sharedAlias },
  },
  renderer: {
    root: resolve(__dirname, 'desktop/renderer'),
    build: {
      rollupOptions: { input: resolve(__dirname, 'desktop/renderer/index.html') },
    },
    resolve: { alias: sharedAlias },
    plugins: [react()],
  },
});
