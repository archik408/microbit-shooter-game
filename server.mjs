/**
 * Статический сервер без зависимостей.
 * Web Serial работает только в secure context, поэтому для локальной игры
 * нужен http://localhost — открытие index.html через file:// не подходит
 * (плюс ES-модули блокируются CORS-политикой file://).
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(join(fileURLToPath(import.meta.url), '..'));
const PORT = Number(process.env.PORT || 8080);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ts': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/**
 * Создать сервер статики из указанного корня. Вынесено в фабрику, чтобы
 * тесты могли поднять её на временном каталоге и случайном порту.
 */
export function createStaticServer(root = ROOT) {
  return createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('Только GET');
      return;
    }

    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, `http://localhost`).pathname);
    } catch {
      res.writeHead(400).end('Некорректный путь');
      return;
    }

    const filePath = join(root, urlPath === '/' ? 'index.html' : urlPath);
    // Всё вне корня — 403, включая закодированные попытки выхода наверх.
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403).end('Доступ запрещён');
      return;
    }

    try {
      const body = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404).end('Не найдено');
    }
  });
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  createStaticServer().listen(PORT, () => {
    console.log(`«Защитник Неба» запущена: http://localhost:${PORT}`);
  });
}
