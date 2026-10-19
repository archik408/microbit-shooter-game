# План: «Защитник Неба» — ребрендинг, мобильная версия, PWA

Переименование игры, смена шрифта, мобильная сенсорная версия, правка
графики врагов и PWA. Инварианты механики (мир 320×240, тайминги, механика
попадания, протокол micro:bit) не меняются; меняется подача и клиентские
платформы.

## 1. Ребрендинг «АС НЕБА» → «Защитник Неба»

- Заголовок/подзаголовок в index.html (двухстрочный заголовок), `<title>`,
  баннер server.mjs, package.json, README, AGENTS.md, ARCHITECTURE.md,
  aireview/_, .zcode/_ — все вхождения.
- Ключ рекорда: `sky-defender-best`, при чтении миграция со старого
  `as-neba-best` (берём максимум), запись — только в новый ключ.

## 2. Шрифт Press Start 2P

- Press Start 2P не содержит кириллицы → стек с по-глифовым fallback:
  `"Press Start 2P", "Pixelify Sans", monospace` (латиница/цифры — PS2P,
  кириллица — Pixelify). Оба грузятся с Google Fonts, локально — fallback.
- Размеры под PS2P (глиф ~1em ширины): значения HUD 14px, метки 11px,
  подсказки 9px, попапы 14px; заголовок — двухстрочный, clamp уменьшен.

## 3. Иконка подключения micro:bit

- В статус-чип (index.html) статичный инлайн-SVG микроплаты; класс
  `chip-connected` зажигает её зелёным (fill/stroke + glow-тень).
  Тексты чипа обновляются как раньше через textContent.

## 4. Мобильная сенсорная версия (pointer: coarse)

1. micro:bit — без изменений в управлении (протокол тот же), только
   индикатор из п.3.
2. Клавиатура/desktop — без изменений.
3. Телефоны:
   - прицел — Accelerometer API (`new Accelerometer({frequency:30})`):
     roll = atan2(x, z), pitch = atan2(y, z) в градусах, далее та же
     рамка, что у micro:bit (deadzone 6°, полный ход 38°); знаки осей —
     именованные константы (landscape-primary);
   - если сенсор не поддержан/отказ в разрешении → полупрозрачный экранный
     D-pad (4 стрелки), pointerdown/up виртуально нажимают те же
     направления, что и клавиатура;
   - выстрел — тап по канвасу (только coarse-pointer);
   - landscape принудительно: на старте партии `requestFullscreen()` +
     `screen.orientation.lock('landscape')` (best-effort); CSS-fallback —
     при portrait кабинет поворачивается transform: rotate(90deg) с
     пересчётом размеров под повёрнутый экран;
   - боковая HUD-панель скрывается: компактный режим HUD — строка
     «СЧЕТ · СБИТО · ВРЕМЯ» сверху; зона прицела расширяется до полной
     ширины мира (aimBounds из Renderer, у Game — fallback-константы);
   - верхняя панель/чип адаптируются (отступы без места под HUD-панель).
4. Враги: убрать чёрные обводки (strokeRect/stroke) у самолётов —
   рисуются только заливки (плоские силуэты, prop-blur остаётся).

## 5. PWA + standalone

- `manifest.webmanifest`: имя, `start_url:"./"`, `display:"standalone"`,
  `orientation:"landscape"`, тема `#0a0c10`, иконки 192/512 + maskable.
- `icons/icon-*.png` — генерируются zero-dep скриптом
  `scripts/generate-icons.mjs` (PNG-энкодер на node:zlib + CRC32,
  пиксель-арт: небо, солнце, самолёт) и коммитятся как артефакты.
- `sw.js`: cache-first для same-origin GET (ядро — precache при install),
  stale-while-revalidate для Google Fonts, очистка старых версий кэша.
- index.html: `<link rel="manifest">`, apple-touch-icon, theme-color,
  apple-mobile-web-app-capable. Регистрация SW в main.js (только
  http/https). server.mjs: MIME `application/manifest+json` для
  `.webmanifest`.

## 6. Документация (финальные решения)

- ARCHITECTURE.md: разделы «Режимы ввода» (приоритет клавиатура →
  micro:bit → акселерометр → D-pad), «Мобильный layout» (поворот,
  компактный HUD, aimBounds), «PWA», правки таблицы решений.
- AGENTS.md: карта новых файлов, правило относительных путей для sw/manifest.
- README: новое имя, управление на мобильных, установка PWA.
- criteria/REVIEW.md: пункты 20 (мобильный ввод/fallback), 21 (PWA).

## 7. Тесты

- input: источник tilt телефона (свежий/устаревший), виртуальные
  направления D-pad, touchFire.
- game: aimBounds из renderer (компактный режим расширяет зону).
- server: MIME для .webmanifest.

## Проверка

`npm run check` зелёный; браузер: шрифт применился, заголовок не
разъезжается, обводок нет, чип-иконка реагирует на статус, компактный HUD
(принудительно через renderer.layout) корректен, SW зарегистрирован,
manifest доступен.
