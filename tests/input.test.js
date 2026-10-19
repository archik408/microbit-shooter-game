// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputController } from '../js/input.js';

/** Заглушка коннектора micro:bit: наклон задаётся полями latest/isConnected. */
function fakeMicrobit() {
  return {
    on: vi.fn(),
    off: vi.fn(),
    isConnected: () => false,
    latest: { roll: 0, pitch: 0, ts: -Infinity },
  };
}

function press(code, options = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, ...options }));
}

function release(code) {
  window.dispatchEvent(new KeyboardEvent('keyup', { code }));
}

afterEach(() => {
  window.dispatchEvent(new Event('blur'));
});

describe('InputController: клавиатура', () => {
  it('стрелки двигают прицел, границы не пробиваются', () => {
    const input = new InputController({ microbit: fakeMicrobit() });
    press('ArrowLeft');
    for (let i = 0; i < 30; i++) input.update(0.05);
    expect(input.aim.x).toBeLessThan(0.5);
    expect(input.aim.x).toBeGreaterThanOrEqual(0);
    release('ArrowLeft');
  });

  it('пробел даёт один выстрел на нажатие, автоповтор игнорируется', () => {
    const input = new InputController({ microbit: fakeMicrobit() });
    press('Space');
    expect(input.consumeFire()).toBe(true);
    expect(input.consumeFire()).toBe(false);

    press('Space', { repeat: true });
    expect(input.consumeFire()).toBe(false);
  });

  it('blur сбрасывает залипшие клавиши', () => {
    const input = new InputController({ microbit: fakeMicrobit() });
    press('ArrowRight');
    window.dispatchEvent(new Event('blur'));
    const x = input.aim.x;
    input.update(0.5);
    expect(input.aim.x).toBe(x);
    expect(input.keys.size).toBe(0);
  });

  it('destroy снимает слушатели', () => {
    const input = new InputController({ microbit: fakeMicrobit() });
    input.destroy();
    press('Space');
    expect(input.consumeFire()).toBe(false);
  });
});

describe('InputController: телефон', () => {
  it('enablePhoneTilt честно отвечает false без Accelerometer API', () => {
    const input = new InputController({ microbit: fakeMicrobit() });
    expect(input.enablePhoneTilt()).toBe(false);
  });

  it('асинхронный отказ сенсора зовёт onUnavailable и глушит источник', () => {
    const listeners = {};
    class FakeAccelerometer {
      addEventListener(type, callback) {
        (listeners[type] ??= []).push(callback);
      }

      start() {}

      stop() {}
    }
    vi.stubGlobal('Accelerometer', FakeAccelerometer);

    const input = new InputController({ microbit: fakeMicrobit() });
    const onUnavailable = vi.fn();
    expect(input.enablePhoneTilt(onUnavailable)).toBe(true);

    listeners.error[0]();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(input.sensor).toBeNull();

    vi.unstubAllGlobals();
  });

  it('живой наклон телефона ведёт прицел; micro:bit приоритетнее', () => {
    const microbit = fakeMicrobit();
    const input = new InputController({ microbit });
    input.sensor = {}; // сенсор считается активным
    input.phoneTilt = { roll: 38, pitch: -38, ts: performance.now() };

    for (let i = 0; i < 60; i++) input.update(0.05);
    expect(input.aim.x).toBeGreaterThan(0.9);
    expect(input.aim.y).toBeLessThan(0.1);

    microbit.isConnected = () => true;
    microbit.latest = { roll: -38, pitch: 0, ts: performance.now() };
    for (let i = 0; i < 60; i++) input.update(0.05);
    expect(input.aim.x).toBeLessThan(0.5);
  });

  it('устаревший наклон телефона не влияет на прицел', () => {
    const input = new InputController({ microbit: fakeMicrobit() });
    input.sensor = {};
    input.phoneTilt = { roll: 38, pitch: 38, ts: performance.now() - 5000 };
    input.update(0.5);
    expect(input.aim.x).toBe(0.5);
    expect(input.aim.y).toBe(0.5);
  });

  it('виртуальный D-pad двигает прицел и отпускается', () => {
    const input = new InputController({ microbit: fakeMicrobit() });
    input.setDirection('right', true);
    input.update(0.2);
    expect(input.aim.x).toBeGreaterThan(0.5);
    input.setDirection('right', false);
    expect(input.keys.size).toBe(0);
  });

  it('тап-выстрел ставит тот же флаг, что и пробел', () => {
    const input = new InputController({ microbit: fakeMicrobit() });
    input.touchFire();
    expect(input.consumeFire()).toBe(true);
    expect(input.consumeFire()).toBe(false);
  });
});

describe('InputController: micro:bit', () => {
  it('свежий наклон тянет прицел к целевой позиции', () => {
    const microbit = fakeMicrobit();
    microbit.isConnected = () => true;
    microbit.latest = { roll: 38, pitch: -38, ts: performance.now() };
    const input = new InputController({ microbit });

    for (let i = 0; i < 60; i++) input.update(0.05);
    expect(input.aim.x).toBeGreaterThan(0.9);
    expect(input.aim.y).toBeLessThan(0.1);
  });

  it('мёртвая зона: слабый наклон ведёт прицел к центру', () => {
    const microbit = fakeMicrobit();
    microbit.isConnected = () => true;
    microbit.latest = { roll: 3, pitch: 2, ts: performance.now() };
    const input = new InputController({ microbit });
    input.aim.x = 0.8;
    input.aim.y = 0.1;

    for (let i = 0; i < 60; i++) input.update(0.05);
    expect(input.aim.x).toBeCloseTo(0.5, 1);
    expect(input.aim.y).toBeCloseTo(0.5, 1);
  });

  it('зажатые стрелки главнее наклона', () => {
    const microbit = fakeMicrobit();
    microbit.isConnected = () => true;
    microbit.latest = { roll: -38, pitch: 0, ts: performance.now() };
    const input = new InputController({ microbit });
    press('ArrowRight');
    input.update(0.1);
    expect(input.aim.x).toBeGreaterThan(0.5);
    release('ArrowRight');
  });

  it('устаревшие данные платы (нет пакета > 1.2 с) не влияют на прицел', () => {
    const microbit = fakeMicrobit();
    microbit.isConnected = () => true;
    microbit.latest = { roll: 38, pitch: 38, ts: performance.now() - 5000 };
    const input = new InputController({ microbit });
    input.update(0.5);
    expect(input.aim.x).toBe(0.5);
    expect(input.aim.y).toBe(0.5);
  });
});
