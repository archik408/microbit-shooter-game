import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/'],
  },
  js.configs.recommended,
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      // Отладочный вывод в браузерном коде запрещён (критерий aireview №3).
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: [
      'server.mjs',
      'eslint.config.js',
      'vitest.config.js',
      'tests/**/*.js',
      'scripts/**/*.mjs',
    ],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      // Тесты ходят и в node-API, и (через happy-dom) в браузерные глобалы.
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // CLI-вывод (баннер сервера, список сгенерированных иконок) — не отладка.
  {
    files: ['server.mjs', 'scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Service Worker живёт в отдельном контексте со своими глобалами.
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.serviceworker },
    },
  },
];
