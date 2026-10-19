/**
 * Генератор PWA-иконок без зависимостей: пиксель-арт 64×64 (небо, солнце,
 * вражеский самолёт) апскейлится целым множителем в 192/512 и пишется
 * как PNG (энкодер на node:zlib + CRC32). Запуск: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const ICONS_DIR = join(ROOT, 'icons');

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

const ART = 64;

function makeCanvas(size) {
  return { size, pixels: new Uint8Array(size * size * 4) };
}

function paintRect(canvas, hex, x, y, w, h) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      if (px < 0 || py < 0 || px >= canvas.size || py >= canvas.size) continue;
      const at = (py * canvas.size + px) * 4;
      canvas.pixels[at] = r;
      canvas.pixels[at + 1] = g;
      canvas.pixels[at + 2] = b;
      canvas.pixels[at + 3] = 255;
    }
  }
}

function paintCircle(canvas, hex, cx, cy, radius) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  for (let py = Math.floor(cy - radius); py <= cy + radius; py++) {
    for (let px = Math.floor(cx - radius); px <= cx + radius; px++) {
      if ((px - cx) ** 2 + (py - cy) ** 2 > radius * radius) continue;
      if (px < 0 || py < 0 || px >= canvas.size || py >= canvas.size) continue;
      const at = (py * canvas.size + px) * 4;
      canvas.pixels[at] = r;
      canvas.pixels[at + 1] = g;
      canvas.pixels[at + 2] = b;
      canvas.pixels[at + 3] = 255;
    }
  }
}

/** Иконка: полосатое небо, солнце и вражеский самолёт «в фас». */
function drawArt(size, { margin = 0 }) {
  const canvas = makeCanvas(size);
  const bands = ['#16418f', '#2a63b8', '#4c8cd6', '#7fb6e8', '#b7e2f8'];
  const bandHeight = Math.ceil(size / bands.length);
  bands.forEach((color, index) =>
    paintRect(canvas, color, 0, index * bandHeight, size, bandHeight),
  );

  paintCircle(canvas, '#ffd93d', size * 0.22, size * 0.22, size * 0.1);
  paintCircle(canvas, '#fff3b0', size * 0.2, size * 0.2, size * 0.06);

  // Самолёт в центре; для maskable-версии отступ (safe zone — круг ~80%).
  const s = (size - margin * 2) / ART;
  const px = (value) => Math.round(margin + value * s);
  const pw = (value) => Math.round(value * s);
  const plane = {
    body: '#c9d0da',
    dark: '#7d848f',
    trim: '#c22f2f',
    canopy: '#9adcff',
  };
  const cx = 32;
  paintRect(canvas, plane.trim, px(cx - 6), px(22), pw(12), pw(4)); // хвост
  paintRect(canvas, plane.body, px(cx - 22), px(30), pw(44), pw(6)); // крылья
  paintRect(canvas, plane.trim, px(cx - 22), px(29), pw(6), pw(8));
  paintRect(canvas, plane.trim, px(cx + 16), px(29), pw(6), pw(8));
  paintRect(canvas, plane.dark, px(cx - 6), px(26), pw(12), pw(18)); // фюзеляж
  paintRect(canvas, plane.canopy, px(cx - 3), px(28), pw(6), pw(8)); // фонарь
  paintRect(canvas, '#ffd93d', px(cx - 2), px(42), pw(4), pw(4)); // кок винта
  return canvas;
}

/** Целочисленный апскейл nearest-neighbor. */
function upscale(canvas, factor) {
  const result = makeCanvas(canvas.size * factor);
  for (let y = 0; y < result.size; y++) {
    const sourceY = (y / factor) | 0;
    for (let x = 0; x < result.size; x++) {
      const sourceX = (x / factor) | 0;
      const from = (sourceY * canvas.size + sourceX) * 4;
      const to = (y * result.size + x) * 4;
      result.pixels.set(canvas.pixels.subarray(from, from + 4), to);
    }
  }
  return result;
}

mkdirSync(ICONS_DIR, { recursive: true });

const outputs = [
  ['icon-192.png', drawArt(64, {}), 3],
  ['icon-512.png', drawArt(64, {}), 8],
  ['icon-maskable-512.png', drawArt(64, { margin: 10 }), 8],
];

for (const [name, art, factor] of outputs) {
  writeFileSync(
    join(ICONS_DIR, name),
    encodePng(art.size * factor, art.size * factor, upscale(art, factor).pixels),
  );
  console.log(`icons/${name} — ${art.size * factor}×${art.size * factor}`);
}
