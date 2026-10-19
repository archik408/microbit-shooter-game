/**
 * Сборка игры: создаёт подсистемы, вешает обработчики на оверлеи и кнопки.
 */
import { Renderer } from './render.js';
import { InputController } from './input.js';
import { SoundSystem } from './audio.js';
import { MicrobitConnector } from './microbit/serial.js';
import { Game } from './game.js';

const canvas = document.getElementById('game');
const menuOverlay = document.getElementById('menuOverlay');
const gameoverOverlay = document.getElementById('gameoverOverlay');
const topbar = document.getElementById('topbar');
const statusChip = document.getElementById('statusChip');
const chipText = document.getElementById('chipText');
const finalStats = document.getElementById('finalStats');
const joystick = document.getElementById('joystick');
const cabinet = document.querySelector('.cabinet');

const startBtn = document.getElementById('startBtn');
const againBtn = document.getElementById('againBtn');
const endBtn = document.getElementById('endBtn');
const connectBtn = document.getElementById('connectBtn');
const muteBtn = document.getElementById('muteBtn');
const installBtn = document.getElementById('installBtn');

const sound = new SoundSystem();
const microbit = new MicrobitConnector();
const input = new InputController({ microbit });
const renderer = new Renderer(canvas);
const isDebug = new URLSearchParams(location.search).has('debug');
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

const game = new Game({
  renderer,
  input,
  sound,
  microbit,
  onState: handleState,
  debug: isDebug,
});

// Отладочный доступ из консоли (только в debug-режиме): например,
// game.renderer.addExplosion(160, 120, 1).
if (isDebug) {
  window.game = game;
}

function startGame() {
  sound.ensure();
  sound.click();
  if (isTouchDevice) enterMobileFullscreen();
  game.start();
}

startBtn.addEventListener('click', () => {
  startBtn.blur();
  startGame();
});

againBtn.addEventListener('click', () => {
  againBtn.blur();
  startGame();
});

endBtn.addEventListener('click', () => {
  endBtn.blur();
  game.finish();
});

muteBtn.addEventListener('click', () => {
  muteBtn.blur();
  const muted = !sound.muted;
  sound.setMuted(muted);
  muteBtn.textContent = muted ? 'ЗВУК: ВЫКЛ' : 'ЗВУК: ВКЛ';
});

async function connectMicrobit() {
  if (!MicrobitConnector.isSupported()) {
    setChip('error', 'WEB SERIAL НЕ ПОДДЕРЖИВАЕТСЯ — ИГРАЙТЕ С КЛАВИАТУРЫ');
    return;
  }
  connectBtn.disabled = true;
  setChip('connecting', 'ПОДКЛЮЧЕНИЕ MICRO:BIT…');
  try {
    await microbit.connect();
  } catch (error) {
    setChip('error', error.message.toUpperCase());
  } finally {
    connectBtn.disabled = false;
  }
}

connectBtn.addEventListener('click', () => {
  connectBtn.blur();
  connectMicrobit();
});

microbit.on('status', ({ status, message }) => {
  if (status === 'connected') {
    setChip('connected', 'MICRO:BIT ПОДКЛЮЧЁН');
  } else if (status === 'disconnected') {
    setChip('', message ? message.toUpperCase() : 'УПРАВЛЕНИЕ: КЛАВИАТУРА');
  }
});

function setChip(kind, text) {
  // Модификаторы меняем точечно: классом hidden владеет handleState
  // (на touch чип прячется в бою), перезапись className его бы затёрла.
  statusChip.classList.remove('chip-connected', 'chip-error', 'chip-connecting');
  if (kind) statusChip.classList.add(`chip-${kind}`);
  // Только текст в span: SVG-иконка micro:bit живёт рядом и не трогается.
  chipText.textContent = text;
}

function handleState(mode, stats) {
  menuOverlay.classList.toggle('hidden', mode !== 'menu');
  gameoverOverlay.classList.toggle('hidden', mode !== 'gameover');
  topbar.classList.toggle('hidden', mode !== 'playing');
  // На телефоне чип с индикатором уступает место компактной строке HUD.
  if (isTouchDevice) statusChip.classList.toggle('hidden', mode === 'playing');
  if (mode === 'gameover') {
    finalStats.textContent =
      `СЧЕТ: ${stats.score}\nСБИТО САМОЛЁТОВ: ${stats.hits}\n` +
      `РЕКОРД: ${stats.best}${stats.newBest ? '  ★ НОВЫЙ!' : ''}`;
  }
}

// Enter стартует партию из меню и с экрана результатов.
window.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && game.mode !== 'playing') {
    event.preventDefault();
    startGame();
  }
});

// Встряхнул плату — начал партию (жест из оригинальной micro:bit-игры).
microbit.on('start', () => {
  if (game.mode !== 'playing') startGame();
});

// Рано будим AudioContext первым касанием — к моменту старта он готов.
window.addEventListener('pointerdown', () => sound.ensure(), { once: true });

// Если micro:bit уже был разрешён раньше, поднимаем USB-соединение без клика.
microbit.autoConnect();

/* ---------- Мобильная версия (pointer: coarse) ---------- */

/**
 * Landscape принудительно: fullscreen + блокировка ориентации — работает
 * на Android по жесту тапа; iOS и отказ пользователя молча игнорируем
 * (CSS-поворот кабинета в portrait — резервный путь, см. style.css).
 */
async function enterMobileFullscreen() {
  try {
    await document.documentElement.requestFullscreen?.();
    await screen.orientation?.lock?.('landscape');
  } catch {
    // Не фатально: играем в текущей ориентации.
  }
}

function setupTouchControls() {
  if (!isTouchDevice) return;

  // Компактный HUD без боковой панели + расширенная зона прицела.
  renderer.layout = 'compact';
  cabinet.classList.add('compact');

  // D-pad подключаем один раз; показываем и при синхронном отказе сенсора,
  // и при асинхронном (событие error — например, нет разрешения).
  const showDpad = () => {
    joystick.classList.remove('hidden');
    setupDpad();
  };
  if (!input.enablePhoneTilt(showDpad)) showDpad();

  // Выстрел — тап по экрану (канвасу); кнопки и D-pad сюда не попадают.
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (game.mode === 'playing') input.touchFire();
  });
}

function setupDpad() {
  if (setupDpad.done) return;
  setupDpad.done = true;

  for (const button of joystick.querySelectorAll('[data-dir]')) {
    const dir = button.dataset.dir;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      input.setDirection(dir, true);
    });
    for (const endEvent of ['pointerup', 'pointercancel', 'pointerleave']) {
      button.addEventListener(endEvent, () => input.setDirection(dir, false));
    }
  }
}

setupTouchControls();

/* ---------- PWA ---------- */

/**
 * Установка из интерфейса (Chrome/Android): браузер отдаёт отложенный
 * промпт событием beforeinstallprompt. Показать системный диалог можно
 * один раз — после клика ждём новое событие. iOS событие не шлёт:
 * кнопка не появляется, установка — «На экран Домой» из Safari.
 */
let installPrompt = null;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installBtn.classList.remove('hidden');
});

installBtn.addEventListener('click', () => {
  installBtn.blur();
  if (!installPrompt) return;
  // Отказ диалога установки (уже установлено, политика браузера) — не фатально.
  installPrompt.prompt().catch(() => {});
  installPrompt = null;
  installBtn.classList.add('hidden');
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  installBtn.classList.add('hidden');
});

// Service Worker: офлайн и установка как standalone-приложение.
// Только http/https (file:// и не-secure контексты не подходят).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Без SW игра работает онлайн как обычно.
  });
}
