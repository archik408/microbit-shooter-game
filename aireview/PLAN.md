# План: touch-UX (double-tap zoom, выделение текста) + installable PWA

База ревью: `HEAD` (826fed2), рабочее дерево чистое. Референс PWA — vydokh.vercel.app.

## Часть 1. Touch-UX

Проблема: двойной тап по D-pad (и промежуткам между его кнопками) зумит
страницу; быстрые тапы выделяют текст и подсвечивают элемент.

1. `css/style.css`:
   - `html, body { touch-action: manipulation; }` — двойной тап больше не
     зумит (весь UI включая D-pad); pinch-zoom для доступности сохраняется;
   - явно `touch-action: manipulation` на `.joystick` (контейнер D-pad:
     закрывает промежутки между кнопками); `.joy-btn` и канвас остаются
     `touch-action: none` — для игровых зон это сильнее (никаких жестов);
   - `body`: `-webkit-user-select: none; user-select: none;
-webkit-touch-callout: none; -webkit-tap-highlight-color: transparent`
     — тапы не выделяют текст, нет long-press callout и серого flash;
   - safe-area отступы `env(safe-area-inset-*)` через `@supports
(padding: max(0px))` — под «челку» iOS в standalone.

## Часть 2. Installable PWA (по аналогии с vydokh)

Технически установке уже ничто не мешает (manifest + SW + иконки есть);
добираем «полноценность» до уровня референса:

2. `index.html`:
   - viewport: `viewport-fit=cover` (iOS standalone с notch);
   - `<meta name="mobile-web-app-capable" content="yes">` (legacy Android);
   - favicon вместо заглушки `data:,`: `icons/icon-192.png`;
   - кнопка «УСТАНОВИТЬ ПРИЛОЖЕНИЕ» (`#installBtn`, `.hidden` по умолчанию)
     в меню, между «ПОДКЛЮЧИТЬ MICRO:BIT» и справкой.
3. `js/main.js`: `beforeinstallprompt` → показать кнопку; клик →
   `prompt()` и спрятать (повторный показ — по новому событию);
   `appinstalled` → спрятать. iOS событие не шлёт — кнопка просто не
   появляется, установка через «На экран Домой».
4. `manifest.webmanifest`: `id: "./"`, `display_override:
["standalone","minimal-ui"]`, `launch_handler`, `categories:
["games","entertainment"]`, `prefer_related_applications: false`,
   `screenshots`: narrow + wide (для богатого install-диалога Android).
   Все пути — относительные.
5. `scripts/generate-icons.mjs`: генератор (PNG-энкодер + пиксель-арт)
   обобщается на прямоугольные канвасы и рисует два промо-скриншота
   в палитре игры (небо с полосами как в `render.js`, самолёт, прицел,
   приборная доска):
   - `screenshots/narrow-1.png` — 960×1280 portrait;
   - `screenshots/wide-1.png` — 1280×960 landscape.
     Иконки на выходе не меняются.
6. `sw.js`: `VERSION` → `sky-defender-v3`; скриншоты добавить в
   `CORE_ASSETS` (правило: новая статика shell → CORE_ASSETS + bump).
7. `tests/pwa.test.js` (node): manifest парсится, поля install-criteria
   (id/start_url/scope относительные, display standalone, display_override,
   launch_handler); иконки и скриншоты существуют и их реальные размеры
   PNG (IHDR) совпадают с заявленными в манифесте; есть narrow + wide
   скриншот; каждый скриншот упомянут в `CORE_ASSETS` sw.js; в
   index.html есть `viewport-fit=cover`, `mobile-web-app-capable`,
   `#installBtn` и нет корневых абсолютных путей (`/...`).
8. Документация: `ARCHITECTURE.md` (раздел PWA + строка о touch-политике
   в «Мобильный layout») и `AGENTS.md` (иконки и скриншоты — артефакты
   генератора; `screenshots/` в карте проекта).

## Вне scope

- `shortcuts` в манифесте — у игры один экран, осмысленных точек входа нет.
- Замена `apple-touch-icon` 192→180: iOS масштабирует, референс тоже
  использует 192.
- Экранные тексты в промо-скриншотах (нет текстового растеризатора в
  генераторе; скриншоты — сцена без текста).

## Гейты

`npm run check` зелёный; `npm run dev` — страница без ошибок консоли;
`node scripts/generate-icons.mjs` — идемпотентен.
