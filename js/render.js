/**
 * Рендер «Защитник Неба», стиль 16-bit Sega.
 *
 * Мир (небо, облака, враги, взрывы, прицел) рисуется в offscreen-канвас
 * 320×240 и растягивается на 640×480 без сглаживания — так любая графика
 * получает честные «толстые» пиксели. Кабина и HUD рисуются поверх на
 * полном разрешении: это «железо игрока», а не игровой мир.
 *
 * Renderer владеет чисто визуальными сущностями (облака, взрывы, вспышки
 * выстрелов, всплывающие очки); игровую логику ведёт Game.
 */
import { randomBetween } from './math.js';

/* Press Start 2P без кириллицы: латиница/цифры — из него, кириллица — Pixelify Sans. */
const FONT = '"Press Start 2P", "Pixelify Sans", "Courier New", monospace';

/** Прямоугольник HUD-панели на экране 640×480 (layout «panel»). */
const HUD = { x: 508, y: 6, w: 126, h: 468 };

/** Границы зоны прицела по layout-режимам (мир 320×240). */
const AIM_BOUNDS = {
  panel: { minX: 13, maxX: 244, minY: 13, maxY: 186 },
  compact: { minX: 13, maxX: 307, minY: 13, maxY: 186 },
};

const PLANE_VARIANTS = [
  { body: '#c9d0da', dark: '#7d848f', trim: '#c22f2f' },
  { body: '#9a86e0', dark: '#6a58a8', trim: '#ffd93d' },
  { body: '#79b46a', dark: '#567f4c', trim: '#2b2f3a' },
];

const FIRE_COLORS = ['#fff7cc', '#ffd93d', '#ff8a2a', '#e04a1a'];

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Layout «panel» — боковая HUD-панель (desktop); «compact» — верхняя
    // строка вместо панели (мобильные). Меняет и зону прицела (aimBounds).
    this.layout = 'panel';

    // Мир низкого разрешения.
    this.world = document.createElement('canvas');
    this.world.width = 320;
    this.world.height = 240;
    this.wctx = this.world.getContext('2d');
    this.worldSize = { w: this.world.width, h: this.world.height };

    this.time = 0;

    this.skyCache = this.buildSky();
    this.cockpitCache = this.buildCockpit();

    /** Облака: два слоя параллакса, спрайты собираются один раз. */
    this.clouds = [];
    for (let i = 0; i < 5; i++) this.clouds.push(this.makeCloud(0.45));
    for (let i = 0; i < 4; i++) this.clouds.push(this.makeCloud(1));

    this.explosions = [];
    this.muzzles = [];
    this.popups = [];
  }

  /** Зона прицела для текущего layout (потребляет Game). */
  get aimBounds() {
    return AIM_BOUNDS[this.layout] ?? AIM_BOUNDS.panel;
  }

  /* ------------------------------------------------------------------ */
  /* Кэши статичной графики                                              */
  /* ------------------------------------------------------------------ */

  /** Полосатое небо с дизерингом на стыках — классический приём Mega Drive. */
  buildSky() {
    const { width, height } = this.world;
    const sky = document.createElement('canvas');
    sky.width = width;
    sky.height = height;
    const sctx = sky.getContext('2d');

    const top = [22, 65, 143];
    const bottom = [183, 226, 248];
    const bands = 12;
    const bandHeight = Math.ceil(height / bands);
    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    const colorAt = (index) => {
      const t = index / (bands - 1);
      return `rgb(${lerp(top[0], bottom[0], t)},${lerp(top[1], bottom[1], t)},${lerp(top[2], bottom[2], t)})`;
    };

    for (let i = 0; i < bands; i++) {
      sctx.fillStyle = colorAt(i);
      sctx.fillRect(0, i * bandHeight, width, bandHeight);
      if (i > 0) {
        // Дизер-переход в 4 пикселя на границе полос.
        const above = colorAt(i - 1);
        const own = colorAt(i);
        const y0 = i * bandHeight;
        for (let y = y0 - 4; y < y0; y++) {
          for (let x = (y + y0) % 4; x < width; x += 4) {
            sctx.fillStyle = ((x >> 1) + y) % 2 === 0 ? own : above;
            sctx.fillRect(x, y, 2, 1);
          }
        }
      }
    }
    return sky;
  }

  /** Кабина: стойки, панель приборов, заклёпки. Рисуется один раз. */
  buildCockpit() {
    const cockpit = document.createElement('canvas');
    cockpit.width = this.canvas.width;
    cockpit.height = this.canvas.height;
    const cctx = cockpit.getContext('2d');

    // Верхняя рама фонаря.
    cctx.fillStyle = '#1b1e26';
    cctx.fillRect(0, 0, 640, 8);
    cctx.fillStyle = '#3a3f4a';
    cctx.fillRect(0, 8, 640, 3);

    // Боковые стойки.
    for (const side of [-1, 1]) {
      cctx.fillStyle = '#23262e';
      cctx.beginPath();
      if (side < 0) {
        cctx.moveTo(0, 0);
        cctx.lineTo(96, 0);
        cctx.lineTo(0, 168);
      } else {
        cctx.moveTo(640, 0);
        cctx.lineTo(544, 0);
        cctx.lineTo(640, 168);
      }
      cctx.closePath();
      cctx.fill();
      cctx.strokeStyle = '#3a3f4a';
      cctx.lineWidth = 3;
      cctx.beginPath();
      cctx.moveTo(side < 0 ? 96 : 544, 0);
      cctx.lineTo(side < 0 ? 0 : 640, 168);
      cctx.stroke();
    }

    // Панель приборов.
    cctx.fillStyle = '#23262e';
    cctx.fillRect(0, 396, 640, 84);
    cctx.fillStyle = '#3a3f4a';
    cctx.fillRect(0, 396, 640, 4);
    cctx.fillStyle = '#565e6c';
    for (let x = 16; x < 640; x += 40) cctx.fillRect(x, 404, 4, 4);

    // Приборы.
    const gauges = [
      [150, 436, 20, -0.9],
      [320, 440, 24, -0.4],
      [490, 436, 20, 0.7],
    ];
    for (const [gx, gy, gr, needleAngle] of gauges) {
      cctx.fillStyle = '#10141f';
      cctx.beginPath();
      cctx.arc(gx, gy, gr, 0, Math.PI * 2);
      cctx.fill();
      cctx.strokeStyle = '#565e6c';
      cctx.lineWidth = 3;
      cctx.stroke();
      cctx.strokeStyle = '#3de0ff';
      cctx.lineWidth = 2;
      cctx.beginPath();
      cctx.arc(gx, gy, gr - 5, Math.PI * 0.75, Math.PI * 2.25);
      cctx.stroke();
      cctx.strokeStyle = '#e04a1a';
      cctx.lineWidth = 3;
      cctx.beginPath();
      cctx.moveTo(gx, gy);
      cctx.lineTo(gx + Math.cos(needleAngle) * (gr - 7), gy + Math.sin(needleAngle) * (gr - 7));
      cctx.stroke();
      cctx.fillStyle = '#ffd93d';
      cctx.fillRect(gx - 2, gy - 2, 4, 4);
    }

    // Индикаторные лампы на панели.
    cctx.fillStyle = '#ffd93d';
    cctx.fillRect(246, 410, 6, 6);
    cctx.fillStyle = '#79b46a';
    cctx.fillRect(388, 410, 6, 6);
    return cockpit;
  }

  makeCloud(depth) {
    const width = Math.round(randomBetween(46, 76));
    const height = Math.round(randomBetween(22, 30));
    const img = document.createElement('canvas');
    img.width = width;
    img.height = height;
    const ictx = img.getContext('2d');

    const puffs = [];
    const count = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const px = 8 + (i / Math.max(1, count - 1)) * (width - 16) + randomBetween(-3, 3);
      puffs.push({
        x: px,
        y: randomBetween(height * 0.45, height * 0.62),
        r: randomBetween(height * 0.28, height * 0.42),
      });
    }

    const path = new Path2D();
    for (const puff of puffs) path.arc(puff.x, puff.y, puff.r, 0, Math.PI * 2);
    ictx.strokeStyle = '#9dbde8';
    ictx.lineWidth = 3;
    ictx.stroke(path);
    ictx.fillStyle = '#ffffff';
    ictx.fill(path);
    // Плоское затенённое брюхо облака — только по форме самого облака.
    ictx.globalCompositeOperation = 'source-atop';
    ictx.fillStyle = '#cfe4f7';
    ictx.fillRect(0, height * 0.68, width, height);
    ictx.globalCompositeOperation = 'source-over';

    const speed = depth === 1 ? randomBetween(34, 50) : randomBetween(16, 24);
    return {
      img,
      depth,
      speed,
      x: randomBetween(-20, this.world.width - 20),
      y: randomBetween(-40, this.world.height),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Мир                                                                  */
  /* ------------------------------------------------------------------ */

  drawWorld(dt, aim) {
    this.time += dt;
    const ctx = this.wctx;

    ctx.drawImage(this.skyCache, 0, 0);

    // Солнце с медленно вращающимися лучами.
    const sunX = 43 + (0.5 - aim.x) * 5;
    const sunY = 34 + (0.5 - aim.y) * 3;
    ctx.save();
    ctx.translate(sunX, sunY);
    ctx.rotate(this.time * 0.15);
    ctx.fillStyle = '#ffd93d';
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(14, -1.5, 7, 3);
    }
    ctx.restore();
    ctx.fillStyle = '#ffd93d';
    ctx.beginPath();
    ctx.arc(sunX, sunY, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath();
    ctx.arc(sunX - 1, sunY - 1, 6, 0, Math.PI * 2);
    ctx.fill();

    // Облака с параллаксом от наклона (мир чуть «уезжает» против прицела).
    for (const cloud of this.clouds) {
      cloud.y += cloud.speed * dt;
      if (cloud.y > this.world.height + 10) {
        cloud.y = -cloud.img.height - randomBetween(0, 60);
        cloud.x = randomBetween(-20, this.world.width - 20);
      }
      const parallaxX = (0.5 - aim.x) * 12 * cloud.depth;
      const parallaxY = (0.5 - aim.y) * 6 * cloud.depth;
      ctx.globalAlpha = cloud.depth === 1 ? 0.95 : 0.75;
      ctx.drawImage(cloud.img, Math.round(cloud.x + parallaxX), Math.round(cloud.y + parallaxY));
    }
    ctx.globalAlpha = 1;
  }

  blitWorld() {
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.world, 0, 0, this.canvas.width, this.canvas.height);
  }

  drawPlane(plane) {
    const ctx = this.wctx;
    const s = plane.sc;
    const variant = PLANE_VARIANTS[plane.variant % PLANE_VARIANTS.length];
    const spin = this.time * 20 + plane.phase;

    ctx.save();
    ctx.translate(Math.round(plane.x), Math.round(plane.y));
    if (plane.escaping) {
      ctx.rotate(plane.rot);
      ctx.globalAlpha = Math.max(0, plane.alpha);
    } else {
      ctx.rotate(Math.sin(this.time * 2 + plane.phase) * 0.07);
    }

    const rect = (x, y, w, h, fill) => {
      ctx.fillStyle = fill;
      ctx.fillRect(x * s, y * s, w * s, h * s);
    };

    // Плоские силуэты без обводок: «квадраты» вокруг самолётов не нужны.
    // Хвостовое оперение (за фюзеляжем).
    rect(-4, -9.5, 8, 3.5, variant.trim);

    // Крылья с контрастными законцовками.
    rect(-15, -2, 30, 5, variant.body);
    rect(-15, -3, 4, 7, variant.trim);
    rect(11, -3, 4, 7, variant.trim);

    // Фюзеляж и фонарь кабины.
    ctx.fillStyle = variant.dark;
    ctx.beginPath();
    ctx.ellipse(0, 0.5 * s, 5 * s, 7.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9adcff';
    ctx.beginPath();
    ctx.ellipse(0, -3 * s, 3 * s, 3.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-2.5 * s, -5 * s, 1.5 * s, 1.5 * s);

    // Воздушный винт: полупрозрачный диск + вращающиеся лопасти.
    ctx.fillStyle = 'rgba(24,26,32,0.28)';
    ctx.beginPath();
    ctx.arc(0, 3 * s, 4.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,22,28,0.85)';
    ctx.lineWidth = Math.max(0.8, s);
    for (let i = 0; i < 3; i++) {
      const angle = spin + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(0, 3 * s);
      ctx.lineTo(Math.cos(angle) * 4 * s, 3 * s + Math.sin(angle) * 4 * s);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffd93d';
    ctx.beginPath();
    ctx.arc(0, 3 * s, 1.3 * s, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawCrosshair(x, y) {
    const ctx = this.wctx;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(this.time * 0.8);

    // Двойной проход: тёмная подложка + яркая линия.
    for (const [color, width, radius] of [
      ['#0a2a08', 3, 8],
      ['#58ff2e', 1.5, 8],
    ]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, radius, i * (Math.PI / 2) + 0.35, (i + 1) * (Math.PI / 2) - 0.35);
        ctx.stroke();
      }
    }
    ctx.rotate(-this.time * 0.8);
    for (const [color, width] of [
      ['#0a2a08', 3],
      ['#58ff2e', 1.5],
    ]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * 10, Math.sin(angle) * 10);
        ctx.lineTo(Math.cos(angle) * 13, Math.sin(angle) * 13);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#0a2a08';
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#58ff2e';
    ctx.beginPath();
    ctx.arc(0, 0, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Эффекты: взрывы, вспышки выстрела, всплывающие очки                 */
  /* ------------------------------------------------------------------ */

  addExplosion(x, y, scale) {
    const fire = [];
    const fireCount = Math.round(14 + 10 * scale);
    for (let i = 0; i < fireCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = randomBetween(35, 120) * (0.6 + 0.6 * scale);
      fire.push({
        x: 0,
        y: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 15,
        size: randomBetween(1.5, 3.5),
        color: FIRE_COLORS[Math.floor(Math.random() * FIRE_COLORS.length)],
        life: randomBetween(0.4, 0.75),
      });
    }
    const smoke = [];
    for (let i = 0; i < 5; i++) {
      smoke.push({
        x: randomBetween(-8, 8),
        y: randomBetween(-6, 2),
        vx: randomBetween(-8, 8),
        vy: randomBetween(-22, -10),
        radius: randomBetween(2, 4),
        life: randomBetween(0.8, 1.3),
      });
    }
    this.explosions.push({ x, y, scale, age: 0, dur: 0.85, fire, smoke });
  }

  addMuzzle(x, y) {
    this.muzzles.push({ x, y, age: 0 });
  }

  addPopup(x, y, text) {
    this.popups.push({ x, y, text, age: 0 });
  }

  updateEffects(dt) {
    for (const explosion of this.explosions) {
      explosion.age += dt;
      for (const particle of explosion.fire) {
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += 130 * dt;
        particle.life -= dt;
      }
      for (const puff of explosion.smoke) {
        puff.x += puff.vx * dt;
        puff.y += puff.vy * dt;
        puff.life -= dt;
      }
    }
    this.explosions = this.explosions.filter((e) => e.age < e.dur + 0.5);

    for (const muzzle of this.muzzles) muzzle.age += dt;
    this.muzzles = this.muzzles.filter((m) => m.age < 0.07);

    for (const popup of this.popups) {
      popup.age += dt;
      popup.y -= 14 * dt;
    }
    this.popups = this.popups.filter((p) => p.age < 0.9);
  }

  drawEffects() {
    const ctx = this.wctx;

    for (const explosion of this.explosions) {
      const t = Math.min(1, explosion.age / explosion.dur);
      const eased = 1 - (1 - t) * (1 - t);
      const { x, y, scale } = explosion;

      // Вспышка в начале взрыва.
      if (explosion.age < 0.06) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 8 + 34 * (explosion.age / 0.06) * scale, 0, Math.PI * 2);
        ctx.fill();
      }

      // Огненный шар: концентрические круги с дрожью.
      const fireRadius = (4 + 22 * eased) * (0.55 + 0.55 * scale);
      const layers = [
        ['#e04a1a', fireRadius],
        ['#ff8a2a', fireRadius * 0.72],
        ['#ffd93d', fireRadius * 0.46],
        ['#fff7cc', fireRadius * 0.22],
      ];
      for (const [color, radius] of layers) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(
          x + randomBetween(-1.5, 1.5),
          y + randomBetween(-1.5, 1.5),
          Math.max(1, radius * (1 - t * 0.35)),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      // Ударная волна.
      ctx.strokeStyle = `rgba(255,247,204,${(1 - t) * 0.8})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 4 + 30 * eased, 0, Math.PI * 2);
      ctx.stroke();

      // Частички огня.
      for (const particle of explosion.fire) {
        if (particle.life <= 0) continue;
        ctx.fillStyle = particle.color;
        const size = particle.size * Math.min(1, particle.life * 2.5);
        ctx.fillRect(x + particle.x - size / 2, y + particle.y - size / 2, size, size);
      }

      // Дым.
      for (const puff of explosion.smoke) {
        if (puff.life <= 0) continue;
        ctx.fillStyle = `rgba(85,90,102,${Math.min(0.5, puff.life * 0.45)})`;
        ctx.beginPath();
        ctx.arc(
          x + puff.x,
          y + puff.y,
          puff.radius + (1.3 - Math.min(1.3, puff.life)),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }

    // Вспышка выстрела у прицела.
    for (const muzzle of this.muzzles) {
      const k = 1 - muzzle.age / 0.07;
      ctx.strokeStyle = `rgba(255,247,204,${k})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + muzzle.age * 40;
        ctx.beginPath();
        ctx.moveTo(muzzle.x + Math.cos(angle) * 2, muzzle.y + Math.sin(angle) * 2);
        ctx.lineTo(
          muzzle.x + Math.cos(angle) * (4 + 5 * k),
          muzzle.y + Math.sin(angle) * (4 + 5 * k),
        );
        ctx.stroke();
      }
      ctx.fillStyle = '#ffd93d';
      ctx.beginPath();
      ctx.arc(muzzle.x, muzzle.y, 2.5 * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Всплывающие «+100» — на полноэкранном слое, чтобы текст был чётким. */
  drawPopups() {
    const ctx = this.ctx;
    for (const popup of this.popups) {
      const alpha = Math.max(0, 1 - popup.age / 0.9);
      ctx.font = `bold 14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#14161c';
      ctx.fillText(popup.text, popup.x * 2 + 2, popup.y * 2 + 2);
      ctx.fillStyle = '#ffd93d';
      ctx.fillText(popup.text, popup.x * 2, popup.y * 2);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left';
  }

  /* ------------------------------------------------------------------ */
  /* Слой кабины и HUD                                                    */
  /* ------------------------------------------------------------------ */

  drawCockpit() {
    this.ctx.drawImage(this.cockpitCache, 0, 0);
  }

  pixelText(text, x, y, size, color, align = 'left') {
    const ctx = this.ctx;
    ctx.font = `bold ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.fillStyle = '#14161c';
    ctx.fillText(text, x + 2, y + 2);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  drawHud(state) {
    if (this.layout === 'compact') {
      this.drawCompactHud(state);
      return;
    }
    this.drawPanelHud(state);
  }

  /** Мобильный HUD: строка «СЧЕТ · СБИТО · ВРЕМЯ» под чипом и кнопками. */
  drawCompactHud(state) {
    const ctx = this.ctx;
    // Полоса ниже статичного чипа (слева) и кнопок topbar (справа), см. css.
    ctx.fillStyle = 'rgba(16, 20, 31, 0.85)';
    ctx.fillRect(4, 60, this.canvas.width - 8, 26);

    const timeCritical = state.timeLeft <= 5 && state.mode === 'playing';
    const timeColor = timeCritical && Math.floor(state.clock * 6) % 2 === 0 ? '#e04a1a' : '#ffffff';
    this.pixelText(String(state.score).padStart(6, '0'), 14, 79, 13, '#ffffff');
    this.pixelText(`РЕКОРД ${String(state.best).padStart(6, '0')}`, 110, 79, 11, '#ffd93d');
    this.pixelText(`СБИТО ${String(state.hits).padStart(2, '0')}`, 290, 79, 11, '#3de0ff');
    this.pixelText('ВРЕМЯ', this.canvas.width - 100, 79, 11, '#3de0ff', 'right');
    this.pixelText(state.timeLeft.toFixed(1), this.canvas.width - 14, 79, 13, timeColor, 'right');
  }

  /** Desktop-HUD: боковая панель справа. */
  drawPanelHud(state) {
    const ctx = this.ctx;

    ctx.fillStyle = '#10141f';
    ctx.fillRect(HUD.x, HUD.y, HUD.w, HUD.h);
    const border = state.hudFlash > 0 ? '#ffd93d' : '#3de0ff';
    ctx.strokeStyle = border;
    ctx.lineWidth = 3;
    ctx.strokeRect(HUD.x + 1.5, HUD.y + 1.5, HUD.w - 3, HUD.h - 3);
    ctx.strokeStyle = '#0a6f8a';
    ctx.lineWidth = 2;
    ctx.strokeRect(HUD.x + 6, HUD.y + 6, HUD.w - 12, HUD.h - 12);

    const lx = HUD.x + 16;
    this.pixelText('СЧЕТ', lx, 42, 11, '#3de0ff');
    this.pixelText(String(state.score).padStart(6, '0'), lx, 68, 14, '#ffffff');

    this.pixelText('СБИТО', lx, 118, 11, '#3de0ff');
    this.pixelText(String(state.hits).padStart(2, '0'), lx, 144, 14, '#ffffff');

    this.pixelText('ВРЕМЯ', lx, 194, 11, '#3de0ff');
    const timeCritical = state.timeLeft <= 5 && state.mode === 'playing';
    const timeColor = timeCritical && Math.floor(state.clock * 6) % 2 === 0 ? '#e04a1a' : '#ffffff';
    this.pixelText(state.timeLeft.toFixed(1), lx, 220, 14, timeColor);

    this.pixelText('РЕКОРД', lx, 270, 11, '#3de0ff');
    this.pixelText(String(state.best).padStart(6, '0'), lx, 296, 14, '#ffd93d');

    this.pixelText('ПРОБЕЛ', lx, 390, 9, '#565e6c');
    this.pixelText('ОГОНЬ', lx, 406, 9, '#565e6c');
    this.pixelText('СТРЕЛКИ', lx, 430, 9, '#565e6c');
    this.pixelText('ПРИЦЕЛ', lx, 446, 9, '#565e6c');
  }

  /** Служебный слой для ?debug=1: хитбоксы (считает Game) и состояние ввода. */
  drawDebug(state) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = 1;
    for (const box of state.hitboxes) {
      ctx.strokeRect(box.x * 2 - box.hw * 2, box.y * 2 - box.hh * 2, box.hw * 4, box.hh * 4);
    }
    ctx.strokeStyle = '#00ff00';
    ctx.beginPath();
    ctx.arc(state.crosshair.x * 2, state.crosshair.y * 2, 7 * 2, 0, Math.PI * 2);
    ctx.stroke();

    const lines = [
      `aim ${state.aim.x.toFixed(2)} ${state.aim.y.toFixed(2)}`,
      `mb ${state.microbit.roll} ${state.microbit.pitch} (${state.microbitStatus})`,
      `fps ${state.fps}`,
    ];
    lines.forEach((line, index) => this.pixelText(line, 14, 30 + index * 18, 11, '#00ff00'));
  }
}
