/**
 * Генератор PWA-графики без зависимостей: иконки (пиксель-арт 64×64 —
 * небо, солнце, вражеский самолёт — апскейлится в 192/512) и промо-
 * скриншоты для install-диалога (сцены в палитре игры). PNG-энкодер на
 * node:zlib + CRC32. Запуск: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const ICONS_DIR = join(ROOT, 'icons');
const SHOTS_DIR = join(ROOT, 'screenshots');

/* ---------- PNG-энкодер ---------- */

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** RGBA-буфер (Uint8Array width*height*4) → PNG. */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // глубина
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // фильтр None
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- Пиксель-арт ---------- */

/** Логический размер арт-блока иконки: 64 «пикселя», апскейл целым множителем. */
const ART = 64;

/** Палитры врагов — те же варианты, что в render.js (PLANE_VARIANTS там). */
const PLANE_VARIANTS = [
  { body: '#c9d0da', dark: '#7d848f', trim: '#c22f2f' },
  { body: '#9a86e0', dark: '#6a58a8', trim: '#ffd93d' },
];

/** Канвас произвольного соотношения сторон: иконки квадратные, скриншоты нет. */
function makeCanvas(width, height) {
  return { width, height, pixels: new Uint8Array(width * height * 4) };
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function paintPixel(canvas, rgb, x, y) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const at = (Math.round(y) * canvas.width + Math.round(x)) * 4;
  canvas.pixels[at] = rgb[0];
  canvas.pixels[at + 1] = rgb[1];
  canvas.pixels[at + 2] = rgb[2];
  canvas.pixels[at + 3] = 255;
}

function paintRect(canvas, hex, x, y, w, h) {
  const rgb = hexToRgb(hex);
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      paintPixel(canvas, rgb, px, py);
    }
  }
}

function paintCircle(canvas, hex, cx, cy, radius) {
  const rgb = hexToRgb(hex);
  for (let py = Math.floor(cy - radius); py <= cy + radius; py++) {
    for (let px = Math.floor(cx - radius); px <= cx + radius; px++) {
      if ((px - cx) ** 2 + (py - cy) ** 2 > radius * radius) continue;
      paintPixel(canvas, rgb, px, py);
    }
  }
}

function strokeCircle(canvas, hex, cx, cy, radius) {
  const rgb = hexToRgb(hex);
  for (let deg = 0; deg < 360; deg++) {
    const rad = (deg * Math.PI) / 180;
    paintPixel(canvas, rgb, cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius);
    paintPixel(canvas, rgb, cx + Math.cos(rad) * (radius - 1), cy + Math.sin(rad) * (radius - 1));
  }
}

/** Пиксельное облако: пирамида «ступеней» — расширяется вниз, как кучевое. */
function paintCloud(canvas, x, y, scale) {
  const rgb = hexToRgb('#cfe4f7');
  const rowHeight = Math.ceil(scale * 0.7);
  for (let dy = 0; dy < 3; dy++) {
    const rowX = x - Math.round(dy * scale * 0.5);
    for (let dx = 0; dx < 3 + dy; dx++) {
      for (let py = 0; py < rowHeight; py++) {
        for (let px = 0; px < scale; px++) {
          paintPixel(canvas, rgb, rowX + dx * scale + px, y + dy * rowHeight + py);
        }
      }
    }
  }
}

/** Вражеский самолёт «в фас» — тот же силуэт, что в иконке и в игре. */
function paintPlane(canvas, cx, cy, unit, variant) {
  const px = (value) => Math.round(cx + value * unit);
  const py = (value) => Math.round(cy + value * unit);
  const pw = (value) => Math.round(value * unit);
  paintRect(canvas, variant.trim, px(-6), py(-10), pw(12), pw(4)); // хвост
  paintRect(canvas, variant.body, px(-22), py(-2), pw(44), pw(6)); // крылья
  paintRect(canvas, variant.trim, px(-22), py(-3), pw(6), pw(8));
  paintRect(canvas, variant.trim, px(16), py(-3), pw(6), pw(8));
  paintRect(canvas, variant.dark, px(-6), py(-6), pw(12), pw(18)); // фюзеляж
  paintRect(canvas, '#9adcff', px(-3), py(-4), pw(6), pw(8)); // фонарь
  paintRect(canvas, '#ffd93d', px(-2), py(10), pw(4), pw(4)); // кок винта
}

/** Прицел: жёлтое кольцо с рисками и точкой в центре, как в игре. */
function paintCrosshair(canvas, cx, cy, radius) {
  strokeCircle(canvas, '#ffd93d', cx, cy, radius);
  const rgb = hexToRgb('#ffd93d');
  for (let d = -radius - 5; d <= radius + 5; d++) {
    if (Math.abs(d) <= radius - 2) continue; // риски выходят за кольцо
    paintPixel(canvas, rgb, cx + d, cy);
    paintPixel(canvas, rgb, cx, cy + d);
  }
  paintRect(canvas, '#ffd93d', cx - 1, cy - 1, 3, 3);
}

/** Приборная доска снизу экрана: тёмный металл, заклёпки, лампы. */
function paintDashboard(canvas, y) {
  const width = canvas.width;
  paintRect(canvas, '#23262e', 0, y, width, canvas.height - y);
  paintRect(canvas, '#3a3f4a', 0, y, width, 4);
  for (let x = 16; x < width; x += 40) paintRect(canvas, '#565e6c', x, y + 8, 4, 4);
  paintRect(canvas, '#ffd93d', Math.round(width * 0.38), y + 14, 6, 6);
  paintRect(canvas, '#79b46a', Math.round(width * 0.61), y + 14, 6, 6);
  paintRect(canvas, '#e04a1a', Math.round(width * 0.84), y + 14, 6, 6);
}

/** Иконка: полосатое небо, солнце и вражеский самолёт «в фас». */
function drawArt(size, { margin = 0 }) {
  const canvas = makeCanvas(size, size);
  const bands = ['#16418f', '#2a63b8', '#4c8cd6', '#7fb6e8', '#b7e2f8'];
  const bandHeight = Math.ceil(size / bands.length);
  bands.forEach((color, index) =>
    paintRect(canvas, color, 0, index * bandHeight, size, bandHeight),
  );

  paintCircle(canvas, '#ffd93d', size * 0.22, size * 0.22, size * 0.1);
  paintCircle(canvas, '#fff3b0', size * 0.2, size * 0.2, size * 0.06);

  // Самолёт в центре; для maskable-версии отступ (safe zone — круг ~80%).
  const unit = (size - margin * 2) / ART;
  paintPlane(canvas, 32 * unit + margin, 32 * unit + margin, unit, {
    body: '#c9d0da',
    dark: '#7d848f',
    trim: '#c22f2f',
  });
  return canvas;
}

/**
 * Промо-скриншот: небо как buildSky() в render.js (12 полос, дизер-переходы),
 * облака, солнце, пара врагов, прицел на цели и приборная доска. Рисуем в
 * «мировых» пикселях, апскейлим целым множителем — те же толстые пиксели.
 */
function drawScreenshot(width, height) {
  const canvas = makeCanvas(width, height);

  const top = [22, 65, 143];
  const bottom = [183, 226, 248];
  const bands = 12;
  const bandHeight = Math.ceil(height / bands);
  const colorAt = (index) => {
    const t = index / (bands - 1);
    return top.map((c, channel) => Math.round(c + (bottom[channel] - c) * t));
  };
  for (let i = 0; i < bands; i++) {
    const rgb = colorAt(i);
    for (let y = i * bandHeight; y < Math.min((i + 1) * bandHeight, height); y++) {
      for (let x = 0; x < width; x++) paintPixel(canvas, rgb, x, y);
    }
    if (i > 0) {
      // Дизер-шахматка 2×1 на стыке полос — приём из buildSky().
      const above = colorAt(i - 1);
      const y0 = i * bandHeight;
      for (let y = y0 - 4; y < y0; y++) {
        for (let x = (y + y0) % 4; x < width; x += 4) {
          const dither = ((x >> 1) + y) % 2 === 0 ? rgb : above;
          for (let w = 0; w < 2; w++) paintPixel(canvas, dither, x + w, y);
        }
      }
    }
  }

  paintCircle(canvas, '#ffd93d', width * 0.12, height * 0.11, height * 0.05);
  paintCircle(canvas, '#fff3b0', width * 0.11, height * 0.1, height * 0.03);
  paintCloud(canvas, Math.round(width * 0.55), Math.round(height * 0.12), 8);
  paintCloud(canvas, Math.round(width * 0.05), Math.round(height * 0.52), 6);
  paintCloud(canvas, Math.round(width * 0.82), Math.round(height * 0.62), 7);

  // Крупный враг слева — под прицелом, мелкий фиолетовый уходит верхом вправо.
  const bigUnit = height / 76;
  const bigX = width * 0.36;
  const bigY = height * 0.48;
  paintPlane(canvas, bigX, bigY, bigUnit, PLANE_VARIANTS[0]);
  paintPlane(canvas, width * 0.76, height * 0.24, bigUnit * 0.55, PLANE_VARIANTS[1]);
  paintCrosshair(canvas, bigX, bigY, Math.round(height * 0.07));
  paintDashboard(canvas, Math.round(height * 0.82));
  return canvas;
}

/** Целочисленный апскейл nearest-neighbor. */
function upscale(canvas, factor) {
  const result = makeCanvas(canvas.width * factor, canvas.height * factor);
  for (let y = 0; y < result.height; y++) {
    const sourceY = (y / factor) | 0;
    for (let x = 0; x < result.width; x++) {
      const sourceX = (x / factor) | 0;
      const from = (sourceY * canvas.width + sourceX) * 4;
      const to = (y * result.width + x) * 4;
      result.pixels.set(canvas.pixels.subarray(from, from + 4), to);
    }
  }
  return result;
}

mkdirSync(ICONS_DIR, { recursive: true });
mkdirSync(SHOTS_DIR, { recursive: true });

// Скриншоты рисуются в логических пикселях (240 в высоту) и апскейлятся ×4.
const outputs = [
  [ICONS_DIR, 'icon-192.png', drawArt(64, {}), 3],
  [ICONS_DIR, 'icon-512.png', drawArt(64, {}), 8],
  [ICONS_DIR, 'icon-maskable-512.png', drawArt(64, { margin: 10 }), 8],
  [SHOTS_DIR, 'narrow-1.png', drawScreenshot(240, 320), 4],
  [SHOTS_DIR, 'wide-1.png', drawScreenshot(320, 240), 4],
];

for (const [dir, name, art, factor] of outputs) {
  const scaled = upscale(art, factor);
  writeFileSync(join(dir, name), encodePng(scaled.width, scaled.height, scaled.pixels));
  console.log(
    `${dir === ICONS_DIR ? 'icons' : 'screenshots'}/${name} — ${scaled.width}×${scaled.height}`,
  );
}
