import js from '@eslint/js';
import ts from 'typescript-eslint';

export default ts.config(
  { ignores: ['dist/**', 'node_modules/**', 'archive/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: { globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', setTimeout: 'readonly', URLSearchParams: 'readonly', AbortSignal: 'readonly' } },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  { files: ['frontend/src/**/*.ts'], languageOptions: { globals: { document: 'readonly', window: 'readonly', crypto: 'readonly', clearTimeout: 'readonly', AbortController: 'readonly', HTMLElement: 'readonly', HTMLInputElement: 'readonly', HTMLButtonElement: 'readonly' } } },
);
