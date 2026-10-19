import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    // Базовое окружение — node; DOM-тесты включают happy-dom через
    // докблок `// @vitest-environment happy-dom` в самом файле.
    environment: 'node',
    coverage: {
      // Покрытие считаем по тестируемой логике: render (канвас), audio
      // (WebAudio) и main (композиция DOM) юнитами не покрываются.
      exclude: ['js/render.js', 'js/audio.js', 'js/main.js', 'firmware/**'],
    },
  },
});
