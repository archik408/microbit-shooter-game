# AGENTS.md — конвенции проекта «Защитник Неба»

HTML5 16-bit шутер (кабина истребителя) — порт игры с BBC micro:bit.
Ванильный JS (ES-модули), Canvas 2D, Web Audio, Web Serial; без сборки
и без рантайм-зависимостей. Как проект устроен и почему — в
[ARCHITECTURE.md](ARCHITECTURE.md); правила приёмки кода — в
[aireview/criteria/REVIEW.md](aireview/criteria/REVIEW.md).

## Быстрый старт

```bash
npm install   # один раз: только dev-инструменты
npm start     # http://localhost:8080
```

Сервер нужен для localhost (secure context Web Serial); ES-модули с `file://`
не грузятся. На Vercel игра работает без сервера.

## Команды

| Команда                 | Что делает                                      |
| ----------------------- | ----------------------------------------------- |
| `npm start`             | статический сервер на `http://localhost:8080`   |
| `npm run check`         | **обязательный гейт**: eslint + prettier + test |
| `npm run lint`          | ESLint 10 (flat config, `eslint.config.js`)     |
| `npm run format`        | Prettier (`--write .`)                          |
| `npm run format:check`  | Prettier (`--check .`)                          |
| `npm test`              | Vitest, одиночный прогон                        |
| `npm run test:watch`    | Vitest в watch-режиме                           |
| `npm run test:coverage` | Vitest + coverage (v8)                          |

## Карта проекта

| Путь                                      | Роль                                                                |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `index.html`, `css/`                      | экран-«кабина», оверлеи, D-pad, PWA-мета (только отн. пути!)        |
| `js/main.js`                              | композиция: подсистемы, кнопки, touch-режим, регистрация SW         |
| `js/game.js`                              | игровая логика: состояния, спавн, попадания, таймер, счёт           |
| `js/render.js`                            | весь рендер: мир 320×240 → ×2, кабина, HUD (panel/compact)          |
| `js/input.js`                             | ввод: клавиатура/D-pad/micro:bit/акселерометр → один API            |
| `js/audio.js`                             | процедурный звук (Web Audio)                                        |
| `js/microbit/serial.js`                   | USB-коннектор платы (Web Serial)                                    |
| `js/math.js`                              | общие хелперы: `clamp`/`lerp`/`randomBetween` (нижний слой)         |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA: standalone-установка и офлайн (детали — ARCHITECTURE.md)       |
| `scripts/generate-icons.mjs`              | генератор PWA-иконок; иконки — артефакты, руками не править         |
| `firmware/microbit-firmware.ts`           | прошивка MakeCode для платы                                         |
| `server.mjs`                              | статический сервер (только localhost; экспорт `createStaticServer`) |
| `tests/`                                  | Vitest-тесты                                                        |
| `vercel.json`                             | заголовки Vercel: nosniff, no-cache для sw.js                       |
| `aireview/`                               | процесс ревью — [aireview/README.md](aireview/README.md)            |

## Правила работы

- **Зависимости**: рантайм — только платформные API браузера; новые пакеты
  (даже dev) — только по явной задаче пользователя.
- **Язык**: идентификаторы — английские; комментарии, UI-тексты и README —
  русские. Комментарии объясняют «почему», а не пересказывают код.
- **Инварианты**: координатное пространство мира, протокол micro:bit,
  тайминги механики и слои зафиксированы в [ARCHITECTURE.md](ARCHITECTURE.md) —
  менять их только по явной задаче, вокруг них тесты.
- **Тесты**: новая или изменённая логика покрывается тестами в `tests/`.
  Чистая логика — в node-окружении; всё, что трогает `window`/события, —
  докблок `// @vitest-environment happy-dom`. Юнитами не тестируются
  `render.js`, `audio.js`, `main.js` (канвас/WebAudio/DOM-композиция) —
  держите их тонкими обёртками над тестируемой логикой.
- **Производительность**: в покадровом коде (`update`/`draw`) не создавать
  канвасы, градиенты и спрайты — кэшировать (см. критерий ревью №11).
- **Статик-хостинг (Vercel)**: в `index.html`, CSS, `manifest.webmanifest` и
  `sw.js` — только относительные пути (`./`), никаких абсолютных `/...`.
- **PWA**: новая статика в shell → добавить в `CORE_ASSETS` в `sw.js` и
  поднять `VERSION`; иконки — только через `node scripts/generate-icons.mjs`.
- **Мобильное**: поведение touch-режима и приоритеты ввода зафиксированы в
  [ARCHITECTURE.md](ARCHITECTURE.md) («Режимы ввода», «Мобильный layout») —
  не менять точечно.
- **Коммиты**: не коммитить без явной команды пользователя.

## Рабочий цикл задач

Нетривиальные задачи — через команду `/review-loop` (.zcode/commands):
реализация → свежий субагент-ревьюер по плану и критериям aireview →
правки → повтор до `VERDICT: APPROVE` + зелёного `npm run check`.
Быстрый рефакторинг — скилл `/my-refactor` (.zcode/skills).
