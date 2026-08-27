module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  settings: { react: { version: 'detect' } },
  env: { node: true, browser: true, es2022: true },
  ignorePatterns: ['out', 'dist', 'node_modules', '*.cjs'],
  rules: {
    'react/react-in-jsx-scope': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
  overrides: [
    {
      // The shared layer must stay backend- and UI-agnostic: no Electron, no DB,
      // no React, no Node built-ins. This is the reusability contract for the web port.
      files: ['shared/**/*.ts'],
      excludedFiles: ['shared/**/*.test.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { group: ['electron*'], message: 'shared/ must not import Electron' },
              { group: ['better-sqlite3', 'drizzle-orm*'], message: 'shared/ must not import the DB layer' },
              { group: ['react', 'react-dom'], message: 'shared/ must not import React' },
              { group: ['node:*', 'fs', 'path', 'os', 'crypto'], message: 'shared/ must not use Node built-ins' },
            ],
          },
        ],
      },
    },
  ],
};
