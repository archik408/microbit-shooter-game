/**
 * Игровая логика «Защитник Неба»: состояния, цикл, спавн врагов, попадания,
 * таймер и счёт. Координаты — в мире низкого разрешения (320×240,
 * см. Renderer); на экран он растягивается ×2.
 */
import { clamp, lerp, randomBetween } from './math.js';

const GAME_DURATION = 30; // секунд, как в оригинале на micro:bit
const FIRE_COOLDOWN = 0.22; // секунд между выстрелами
const SPAWN_FIRST = 1.5; // секунд между самолётами в начале партии
const SPAWN_LAST = 0.95; // ...и к её концу
const PLANE_APPROACH = 3.2; // секунд до полного роста масштаба
const PLANE_LIFE = 4.2; // секунд до начала ухода
const PLANE_ESCAPE = 1.2; // секунд на уход за экран
const PLANE_VARIANT_COUNT = 3; // синхронизировано с PLANE_VARIANTS в render.js
const KILL_POINTS = 100;
const BEST_KEY = 'sky-defender-best';
const LEGACY_BEST_KEY = 'as-neba-best'; // рекорд до переименования игры

/** Рабочая зона прицела (fallback): справа HUD-панель, снизу — приборная доска. */
const AIM_MIN_X = 13;
const AIM_MAX_X = 244;
const AIM_MIN_Y = 13;
const AIM_MAX_Y = 186;

/** Зона спавна врагов: правее — HUD-панель, ниже — кабина (мир 320×240). */
const SPAWN_MIN_X = 38;
const SPAWN_MAX_X = 210;
const SPAWN_MIN_Y = 34;
const SPAWN_MAX_Y = 150;

export class Game {
  constructor({ renderer, input, sound, microbit, onState, debug = false }) {
    this.renderer = renderer;
    this.input = input;
    this.sound = sound;
    this.microbit = microbit;
    this.onState = onState;
    this.debug = debug;

    this.mode = 'menu'; // menu | playing | gameover
    this.score = 0;
    this.hits = 0;
    this.best = this.loadBest();
    this.timeLeft = GAME_DURATION;
    this.planes = [];
    this.spawnTimer = 1;
    this.lastShotAt = -Infinity;
    this.shake = 0;
    this.flash = 0;
    this.hudFlash = 0;
    this.clock = 0;
    this.fps = 0;
    this.fpsFrames = 0;
    this.fpsAccum = 0;

    this.lastFrameTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  loadBest() {
    try {
      const best = Number(localStorage.getItem(BEST_KEY)) || 0;
      // Разовая миграция рекорда со старого ключа (до ребрендинга).
      const legacy = Number(localStorage.getItem(LEGACY_BEST_KEY)) || 0;
      return Math.max(best, legacy);
    } catch {
      return 0; // localStorage бывает недоступен (приватный режим file:// и т.п.)
    }
  }

  saveBest() {
    try {
      localStorage.setItem(BEST_KEY, String(this.best));
    } catch {
      // рекорд не критичен
    }
  }

  start() {
    this.score = 0;
    this.hits = 0;
    this.timeLeft = GAME_DURATION;
    this.planes = [];
    this.spawnTimer = 0.4;
    this.shake = 0;
    this.flash = 0;
    this.hudFlash = 0;
    this.newBest = false;
    this.input.reset();
    this.setMode('playing');
    this.sound.ensure();
    this.sound.startEngine();
    this.sound.startJingle();
  }

  /** Завершение партии: по таймеру, по кнопке «ЗАВЕРШИТЬ» — без разницы. */
  finish() {
    if (this.mode !== 'playing') return;
    // Флаг нового рекорда считаем до обновления best: повторение рекорда — не рекорд.
    const newBest = this.score > this.best;
    if (newBest) {
      this.best = this.score;
      this.saveBest();
    }
    this.newBest = newBest;
    this.setMode('gameover');
    this.sound.stopEngine();
    this.sound.gameOverJingle();
  }

  setMode(mode) {
    this.mode = mode;
    this.onState?.(mode, {
      score: this.score,
      hits: this.hits,
      best: this.best,
      newBest: Boolean(this.newBest),
    });
  }

  spawnPlane() {
    this.planes.push({
      x: randomBetween(SPAWN_MIN_X, SPAWN_MAX_X),
      y: randomBetween(SPAWN_MIN_Y, SPAWN_MAX_Y),
      age: 0,
      sc: 0.34,
      variant: Math.floor(Math.random() * PLANE_VARIANT_COUNT),
      phase: Math.random() * Math.PI * 2,
      wobbleAmp: randomBetween(6, 16),
      wobbleFreq: randomBetween(0.8, 1.8),
      drift: randomBetween(-6, 6),
      escaping: false,
      rot: 0,
      alpha: 1,
      escapeAge: 0,
      escapeVx: 0,
      escapeVy: 0,
    });
  }

  /** Полуразмер хитбокса: габарит самолёта + запас на радиус прицела. */
  hitHalfSize(plane) {
    return { hw: 15 * plane.sc + 7, hh: 11 * plane.sc + 6 };
  }

  fire() {
    const now = this.clock;
    if (now - this.lastShotAt < FIRE_COOLDOWN) return;
    this.lastShotAt = now;

    const cx = this.crosshairX();
    const cy = this.crosshairY();
    this.sound.shot();
    this.renderer.addMuzzle(cx, cy);
    this.shake = Math.max(this.shake, 1.5);

    // Попадание = прицел на цели в момент выстрела (механика оригинала).
    // Среди пересекающихся берём самый крупный: он «ближе всех» к нам.
    let hitIndex = -1;
    for (let i = 0; i < this.planes.length; i++) {
      const plane = this.planes[i];
      const { hw, hh } = this.hitHalfSize(plane);
      if (Math.abs(plane.x - cx) <= hw && Math.abs(plane.y - cy) <= hh) {
        if (hitIndex === -1 || plane.sc > this.planes[hitIndex].sc) hitIndex = i;
      }
    }
    if (hitIndex === -1) return;

    const plane = this.planes[hitIndex];
    this.planes.splice(hitIndex, 1);
    this.score += KILL_POINTS;
    this.hits += 1;
    this.hudFlash = 0.3;
    this.flash = 0.12;
    this.shake = Math.max(this.shake, 6);
    this.renderer.addExplosion(plane.x, plane.y, plane.sc);
    this.renderer.addPopup(plane.x, plane.y - 10, `+${KILL_POINTS}`);
    this.sound.explosion();
    this.sound.hitJingle();
    // Гудок на плату — необязательный бонус, ошибка не должна рвать игру.
    this.microbit.send('BEEP').catch(() => {});
  }

  /** Границы зоны прицела: в компактном layout рендера зона шире (без панели). */
  aimBounds() {
    return (
      this.renderer.aimBounds ?? {
        minX: AIM_MIN_X,
        maxX: AIM_MAX_X,
        minY: AIM_MIN_Y,
        maxY: AIM_MAX_Y,
      }
    );
  }

  crosshairX() {
    const { minX, maxX } = this.aimBounds();
    return lerp(minX, maxX, this.input.aim.x);
  }

  crosshairY() {
    const { minY, maxY } = this.aimBounds();
    return lerp(minY, maxY, this.input.aim.y);
  }

  update(dt) {
    this.clock += dt;

    if (this.mode === 'playing') {
      this.input.update(dt);
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.finish();
      }

      // Спавн учащается к концу партии.
      const progress = 1 - this.timeLeft / GAME_DURATION;
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnPlane();
        this.spawnTimer = lerp(SPAWN_FIRST, SPAWN_LAST, progress) * randomBetween(0.75, 1.25);
      }

      if (this.input.consumeFire()) this.fire();
    } else if (this.mode === 'menu') {
      // Attract mode: самолёты летают за экраном меню.
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnPlane();
        this.spawnTimer = randomBetween(1.6, 2.6);
      }
    }

    for (const plane of this.planes) {
      plane.age += dt;
      if (!plane.escaping) {
        plane.sc = Math.min(1, 0.34 + ((1 - 0.34) * plane.age) / PLANE_APPROACH);
        plane.x +=
          (Math.sin(plane.age * plane.wobbleFreq * Math.PI + plane.phase) * plane.wobbleAmp +
            plane.drift) *
          dt;
        plane.x = clamp(plane.x, 20, this.renderer.worldSize.w - 40);
        if (plane.age > PLANE_LIFE) {
          plane.escaping = true;
          const toRight = plane.x < this.renderer.worldSize.w / 2;
          plane.escapeVx = toRight ? randomBetween(40, 70) : randomBetween(-70, -40);
          plane.escapeVy = randomBetween(25, 60);
        }
      } else {
        plane.escapeAge += dt;
        plane.sc += 0.35 * dt;
        plane.x += plane.escapeVx * dt;
        plane.y += plane.escapeVy * dt;
        plane.rot = clamp(plane.escapeVx / 90, -0.5, 0.5) * Math.min(1, plane.escapeAge * 1.5);
        plane.alpha = 1 - plane.escapeAge / PLANE_ESCAPE;
      }
    }
    this.planes = this.planes.filter(
      (plane) => plane.alpha > 0 && plane.y < this.renderer.worldSize.h + 30,
    );

    this.shake *= Math.exp(-7 * dt);
    this.flash = Math.max(0, this.flash - dt * 1.4);
    this.hudFlash = Math.max(0, this.hudFlash - dt);
    this.renderer.updateEffects(dt);
  }

  draw(dt) {
    const renderer = this.renderer;
    const ctx = renderer.ctx;

    const shakeX = (Math.random() * 2 - 1) * this.shake;
    const shakeY = (Math.random() * 2 - 1) * this.shake;

    // Трясём весь мир, кабина остаётся стабильной — так «сидим» надёжнее.
    renderer.wctx.save();
    renderer.wctx.translate(Math.round(shakeX), Math.round(shakeY));
    renderer.drawWorld(dt, this.input.aim);
    for (const plane of this.planes) renderer.drawPlane(plane);
    renderer.drawEffects();
    renderer.wctx.restore();

    if (this.mode === 'playing') {
      renderer.drawCrosshair(this.crosshairX(), this.crosshairY());
    }

    renderer.blitWorld();

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.8, this.flash * 6)})`;
      ctx.fillRect(0, 0, renderer.canvas.width, renderer.canvas.height);
    }

    renderer.drawPopups();
    renderer.drawCockpit();
    renderer.drawHud({
      mode: this.mode,
      score: this.score,
      hits: this.hits,
      best: this.best,
      timeLeft: this.timeLeft,
      clock: this.clock,
      hudFlash: this.hudFlash,
    });

    if (this.debug) {
      renderer.drawDebug({
        // Хитбоксы считает логика — рендер только рисует переданное.
        hitboxes: this.planes.map((plane) => ({
          x: plane.x,
          y: plane.y,
          ...this.hitHalfSize(plane),
        })),
        aim: this.input.aim,
        crosshair: { x: this.crosshairX(), y: this.crosshairY() },
        microbit: this.microbit.latest,
        microbitStatus: this.microbit.status,
        fps: this.fps,
      });
    }
  }

  loop = (timestamp) => {
    // Кламп dt страхует от скачка после сворачивания вкладки.
    const dt = clamp((timestamp - this.lastFrameTime) / 1000, 0, 0.05);
    this.lastFrameTime = timestamp;

    this.fpsFrames += 1;
    this.fpsAccum += dt;
    if (this.fpsAccum >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsFrames = 0;
      this.fpsAccum = 0;
    }

    this.update(dt);
    this.draw(dt);
    this.rafId = requestAnimationFrame(this.loop);
  };

  destroy() {
    cancelAnimationFrame(this.rafId);
    this.sound.stopEngine();
    this.input.destroy();
  }
}
