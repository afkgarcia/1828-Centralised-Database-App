import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'shared') } },
  test: {
    include: ['shared/**/*.test.{ts,tsx}', 'desktop/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,tsx}', 'web/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
