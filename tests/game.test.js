import { beforeEach, describe, expect, it, vi } from 'vitest';

// Game не касается DOM, но использует requestAnimationFrame — стабим до импорта.
vi.stubGlobal('requestAnimationFrame', () => 0);
vi.stubGlobal('cancelAnimationFrame', vi.fn());

const { Game } = await import('../js/game.js');

/** Заглушка рендера: только поля и методы, которых касается Game. */
function fakeRenderer() {
  return {
    worldSize: { w: 320, h: 240 },
    canvas: { width: 640, height: 480 },
    ctx: {},
    wctx: { save: vi.fn(), translate: vi.fn(), restore: vi.fn() },
    addExplosion: vi.fn(),
    addMuzzle: vi.fn(),
    addPopup: vi.fn(),
    updateEffects: vi.fn(),
    drawWorld: vi.fn(),
    drawPlane: vi.fn(),
    drawEffects: vi.fn(),
    drawCrosshair: vi.fn(),
    blitWorld: vi.fn(),
    drawPopups: vi.fn(),
    drawCockpit: vi.fn(),
    drawHud: vi.fn(),
    drawDebug: vi.fn(),
  };
}

function fakeSound() {
  return {
    ensure: vi.fn(),
    startEngine: vi.fn(),
    stopEngine: vi.fn(),
    shot: vi.fn(),
    explosion: vi.fn(),
    hitJingle: vi.fn(),
    startJingle: vi.fn(),
    gameOverJingle: vi.fn(),
  };
}

function fakeInput() {
  return {
    aim: { x: 0.5, y: 0.5 },
    velocity: { x: 0, y: 0 },
    keys: new Set(),
    fireQueued: false,
    update: vi.fn(),
    reset: vi.fn(),
    destroy: vi.fn(),
    consumeFire: vi.fn(() => false),
  };
}

function fakeMicrobit() {
  return {
    isConnected: () => false,
    latest: { roll: 0, pitch: 0, ts: -Infinity },
    status: 'disconnected',
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function makeGame(overrides = {}) {
  return new Game({
    renderer: overrides.renderer ?? fakeRenderer(),
    input: overrides.input ?? fakeInput(),
    sound: overrides.sound ?? fakeSound(),
    microbit: overrides.microbit ?? fakeMicrobit(),
    onState: overrides.onState ?? vi.fn(),
  });
}

/** Самолет ровно под прицелом: базовый сценарий попадания. */
function spawnAtCrosshair(game, sc = 1) {
  game.spawnPlane();
  const plane = game.planes[game.planes.length - 1];
  plane.x = game.crosshairX();
  plane.y = game.crosshairY();
  plane.sc = sc;
  return plane;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Game: выстрел и попадание', () => {
  it('выстрел в упор: +100, взрыв, гудок на плату', () => {
    const game = makeGame();
    game.start();
    spawnAtCrosshair(game);
    game.input.consumeFire = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);

    game.update(0.02);
    expect(game.score).toBe(100);
    expect(game.hits).toBe(1);
    expect(game.planes).toHaveLength(0);
    expect(game.renderer.addExplosion).toHaveBeenCalledTimes(1);
    expect(game.renderer.addPopup).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '+100',
    );
    expect(game.sound.explosion).toHaveBeenCalledTimes(1);
    expect(game.microbit.send).toHaveBeenCalledWith('BEEP');
  });

  it('среди пересекающихся сбивается ближний (крупнейший)', () => {
    const game = makeGame();
    game.start();
    const far = spawnAtCrosshair(game, 0.4);
    spawnAtCrosshair(game, 1);
    game.input.consumeFire = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);

    game.update(0.02);
    expect(game.renderer.addExplosion).toHaveBeenCalledWith(
      game.crosshairX(),
      game.crosshairY(),
      1,
    );
    expect(game.planes).toContain(far);
  });

  it('промах: звук выстрела есть, счёта и взрыва нет', () => {
    const game = makeGame();
    game.start();
    game.spawnPlane();
    game.planes[0].x = 10;
    game.planes[0].y = 10;
    game.input.consumeFire = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);

    game.update(0.02);
    expect(game.score).toBe(0);
    expect(game.sound.shot).toHaveBeenCalledTimes(1);
    expect(game.renderer.addExplosion).not.toHaveBeenCalled();
  });

  it('кулдаун 220 мс не даёт стрелять чаще', () => {
    const game = makeGame();
    game.start();
    spawnAtCrosshair(game);
    game.fire();

    spawnAtCrosshair(game);
    game.clock = 0.1;
    game.fire();
    expect(game.score).toBe(100);

    game.clock = 0.25;
    game.fire();
    expect(game.score).toBe(200);
  });
});

describe('Game: партия и таймер', () => {
  it('attract mode в меню спавнит самолёты', () => {
    const game = makeGame();
    game.update(3);
    expect(game.planes.length).toBeGreaterThanOrEqual(1);
  });

  it('compact-режим расширяет зону прицела по renderer.aimBounds', () => {
    const renderer = fakeRenderer();
    renderer.aimBounds = { minX: 13, maxX: 307, minY: 13, maxY: 186 };
    const game = makeGame({ renderer });
    game.input.aim = { x: 1, y: 0.5 };
    expect(game.crosshairX()).toBe(307);
    expect(game.crosshairY()).toBe(13 + (186 - 13) * 0.5);
  });

  it('30 секунд партии: финиш, рекорд, флаг нового рекорда', () => {
    const onState = vi.fn();
    const game = makeGame({ onState });
    game.start();
    game.score = 500;

    game.update(31);
    expect(game.mode).toBe('gameover');
    expect(game.best).toBe(500);
    expect(game.newBest).toBe(true);
    expect(onState).toHaveBeenCalledWith('gameover', {
      score: 500,
      hits: 0,
      best: 500,
      newBest: true,
    });
    expect(game.sound.stopEngine).toHaveBeenCalledTimes(1);
    expect(game.sound.gameOverJingle).toHaveBeenCalledTimes(1);
  });

  it('повторение рекорда не считается новым', () => {
    const game = makeGame();
    game.best = 500;
    game.start();
    game.score = 500;
    game.update(31);
    expect(game.newBest).toBe(false);
  });

  it('ручное завершение (кнопка) проходит тем же путём', () => {
    const game = makeGame();
    game.start();
    game.finish();
    expect(game.mode).toBe('gameover');
    expect(game.sound.stopEngine).toHaveBeenCalledTimes(1);
  });
});

describe('Game: миграция рекорда после ребрендинга', () => {
  it('берёт максимум старого as-neba-best и пишет только в новый ключ', () => {
    const store = new Map([['as-neba-best', '500']]);
    vi.stubGlobal('localStorage', {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    });

    const game = makeGame();
    expect(game.best).toBe(500);

    game.best = 700;
    game.saveBest();
    expect(store.get('sky-defender-best')).toBe('700');
    expect(store.get('as-neba-best')).toBe('500'); // старый ключ не трогаем

    vi.unstubAllGlobals();
  });
});
