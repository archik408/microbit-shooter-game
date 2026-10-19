/**
 * Единый ввод: клавиатура (стрелки + пробел), micro:bit (наклон + A+B)
 * и телефон (Accelerometer API + тап + экранный D-pad).
 *
 * aim — нормализованная позиция прицела, {x, y} в диапазоне 0..1.
 * Абсолютную позицию задаёт первый доступный источник наклона
 * (micro:bit приоритетнее телефона); пока нажимаются стрелки или D-pad,
 * наклон игнорируется, чтобы управления не спорили друг с другом.
 */
import { clamp } from './math.js';

const KEY_TO_DIR = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** Мертвая зона и угол полного отклонения, градусы (в оригинале на LED было ±10). */
const TILT_DEADZONE_DEG = 6;
const TILT_FULL_DEG = 38;
const KEYBOARD_SPEED = 1.35; // экранов в секунду
const TILT_FRESH_MS = 1200; // наклон старше — источник «потерян»
const KEYBOARD_TAKEOVER_MS = 800; // сколько времени клавиатура подавляет наклон

function tiltToAxis(degrees) {
  const clamped = clamp(degrees, -90, 90);
  const magnitude = Math.abs(clamped);
  if (magnitude <= TILT_DEADZONE_DEG) return 0;
  const normalized = Math.min(
    1,
    (magnitude - TILT_DEADZONE_DEG) / (TILT_FULL_DEG - TILT_DEADZONE_DEG),
  );
  return Math.sign(clamped) * normalized;
}

export class InputController {
  constructor({ microbit }) {
    this.microbit = microbit;
    this.aim = { x: 0.5, y: 0.5 };
    this.velocity = { x: 0, y: 0 };
    this.keys = new Set();
    this.fireQueued = false;
    this.lastKeyboardAt = -Infinity;
    /** Наклон телефона из Accelerometer API (сырые градусы, без зеркалирования). */
    this.phoneTilt = { roll: 0, pitch: 0, ts: -Infinity };
    this.sensor = null;

    this.onKeyDown = (event) => {
      if (event.code === 'Space') {
        // Пробел и скроллит страницу, и «нажимает» сфокусированную кнопку — гасим.
        event.preventDefault();
        if (!event.repeat) this.fireQueued = true;
        return;
      }
      const dir = KEY_TO_DIR[event.code];
      if (dir) {
        event.preventDefault();
        this.keys.add(dir);
      }
    };

    this.onKeyUp = (event) => {
      const dir = KEY_TO_DIR[event.code];
      if (dir) this.keys.delete(dir);
    };

    // При потере фокуса keyup не приедет — сбрасываем, иначе прицел уплывёт.
    this.onBlur = () => {
      this.keys.clear();
      this.velocity.x = 0;
      this.velocity.y = 0;
    };

    // A+B на плате прилетает строкой FIRE — превращаем в тот же флаг выстрела.
    this.onMicrobitFire = () => {
      this.fireQueued = true;
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    microbit.on('fire', this.onMicrobitFire);
  }

  /**
   * Включить наклон телефона (Accelerometer API) как источник прицела.
   * false — API нет или сенсор не стартовал; отказ разрешения прилетает
   * асинхронно событием error — тогда вызывается onUnavailable (показ D-pad).
   */
  enablePhoneTilt(onUnavailable = () => {}) {
    if (typeof window === 'undefined' || typeof window.Accelerometer !== 'function') {
      return false;
    }
    try {
      const sensor = new window.Accelerometer({ frequency: 30 });
      sensor.addEventListener('reading', () => {
        const toDeg = 180 / Math.PI;
        // Landscape: крен («руль», вокруг длинной оси) — x/z,
        // тангаж (наклон верхнего края) — y/z.
        this.phoneTilt = {
          roll: Math.atan2(sensor.x, sensor.z) * toDeg,
          pitch: Math.atan2(sensor.y, sensor.z) * toDeg,
          ts: performance.now(),
        };
      });
      sensor.addEventListener('error', () => {
        // Разрешение отозвано/сенсор умер — управление падает на D-pad.
        this.sensor = null;
        onUnavailable();
      });
      sensor.start();
      this.sensor = sensor;
      return true;
    } catch {
      return false;
    }
  }

  /** landscape-secondary — телефон повёрнут «в другую сторону»: оси зеркалим. */
  get orientationSign() {
    const type = screen.orientation?.type ?? 'landscape-primary';
    return type.includes('secondary') ? -1 : 1;
  }

  /** Первый живой источник наклона: micro:bit приоритетнее телефона. */
  activeTiltSource(now) {
    const mb = this.microbit;
    if (mb.isConnected() && now - mb.latest.ts < TILT_FRESH_MS) {
      return { roll: mb.latest.roll, pitch: mb.latest.pitch };
    }
    if (this.sensor && now - this.phoneTilt.ts < TILT_FRESH_MS) {
      const sign = this.orientationSign;
      return { roll: this.phoneTilt.roll * sign, pitch: this.phoneTilt.pitch * sign };
    }
    return null;
  }

  update(dt) {
    let dx = 0;
    let dy = 0;
    if (this.keys.has('left')) dx -= 1;
    if (this.keys.has('right')) dx += 1;
    if (this.keys.has('up')) dy -= 1;
    if (this.keys.has('down')) dy += 1;
    if (dx !== 0 || dy !== 0) this.lastKeyboardAt = performance.now();

    // Плавный разгон/торможение клавиатурного движения.
    const smoothing = 1 - Math.exp(-12 * dt);
    this.velocity.x += (dx * KEYBOARD_SPEED - this.velocity.x) * smoothing;
    this.velocity.y += (dy * KEYBOARD_SPEED - this.velocity.y) * smoothing;
    this.aim.x = clamp(this.aim.x + this.velocity.x * dt, 0, 1);
    this.aim.y = clamp(this.aim.y + this.velocity.y * dt, 0, 1);

    const now = performance.now();
    const tilt = this.activeTiltSource(now);
    if (tilt && now - this.lastKeyboardAt > KEYBOARD_TAKEOVER_MS) {
      const targetX = 0.5 + 0.5 * tiltToAxis(tilt.roll);
      const targetY = 0.5 + 0.5 * tiltToAxis(tilt.pitch);
      const follow = 1 - Math.exp(-9 * dt);
      this.aim.x += (targetX - this.aim.x) * follow;
      this.aim.y += (targetY - this.aim.y) * follow;
      this.velocity.x *= Math.exp(-6 * dt);
      this.velocity.y *= Math.exp(-6 * dt);
    }
  }

  /** Виртуальное направление (экранный D-pad) — те же ключи, что у клавиатуры. */
  setDirection(dir, pressed) {
    if (pressed) {
      this.keys.add(dir);
      this.lastKeyboardAt = performance.now();
    } else {
      this.keys.delete(dir);
    }
  }

  /** Выстрел тапом по экрану (подключается только на touch-устройствах). */
  touchFire() {
    this.fireQueued = true;
  }

  /** true, если с прошлого опроса был выстрел (пробел или A+B). */
  consumeFire() {
    const fired = this.fireQueued;
    this.fireQueued = false;
    return fired;
  }

  reset() {
    this.aim.x = 0.5;
    this.aim.y = 0.5;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.fireQueued = false;
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.microbit.off('fire', this.onMicrobitFire);
    this.sensor?.stop();
    this.sensor = null;
  }
}
