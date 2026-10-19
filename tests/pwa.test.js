import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const swSource = readFileSync(join(ROOT, 'sw.js'), 'utf8');

/** Размеры PNG из заголовка IHDR (смещения 16/20 после подписи и чанк-префикса). */
function pngSize(path) {
  const png = readFileSync(path);
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('PWA: manifest', () => {
  it('поля install-criteria на месте и относительные', () => {
    for (const field of ['id', 'start_url', 'scope']) {
      expect(manifest[field]).not.toMatch(/^\//);
    }
    expect(manifest.display).toBe('standalone');
    expect(manifest.display_override).toContain('standalone');
    expect(manifest.launch_handler.client_mode).toContain('navigate-existing');
  });

  it('иконки и скриншоты существуют, размеры PNG совпадают с манифестом', () => {
    for (const entry of [...manifest.icons, ...manifest.screenshots]) {
      expect(entry.src).not.toMatch(/^\//);
      const path = join(ROOT, entry.src);
      expect(existsSync(path), entry.src).toBe(true);
      const [width, height] = entry.sizes.split('x').map(Number);
      expect(pngSize(path)).toEqual({ width, height });
    }
  });

  it('есть скриншоты обоих form_factor для install-диалога', () => {
    const factors = manifest.screenshots.map((shot) => shot.form_factor);
    expect(factors).toContain('narrow');
    expect(factors).toContain('wide');
  });
});

describe('PWA: shell', () => {
  it('sw.js кэширует всю графику манифеста', () => {
    for (const entry of [...manifest.icons, ...manifest.screenshots]) {
      expect(swSource).toContain(`'./${entry.src}'`);
    }
  });

  it('index.html: viewport-fit, legacy-мета и кнопка установки', () => {
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('mobile-web-app-capable');
    expect(html).toContain('id="installBtn"');
  });

  it('index.html: только относительные пути к своей статике', () => {
    const rootRelative = html.match(/(?:href|src)="\/[^/][^"]*"/g) ?? [];
    expect(rootRelative).toEqual([]);
  });
});
