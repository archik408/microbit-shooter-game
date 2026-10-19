import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get, request } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticServer } from '../server.mjs';

let server;
let baseUrl;
let root;

/** Запрос сырым http-клиентом: fetch нормализует %2e%2e и не годится для теста traversal. */
function httpGet(path) {
  return new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port: server.address().port, path }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode, contentType: res.headers['content-type'], body }),
      );
    }).on('error', reject);
  });
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sky-defender-test-'));
  await mkdir(join(root, 'js'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>fixture</title>');
  await writeFile(join(root, 'js', 'app.js'), 'export const x = 1;');
  await writeFile(join(root, 'manifest.webmanifest'), '{"name": "fixture"}');
  await writeFile(join(tmpdir(), 'sky-defender-secret.txt'), 'secret');

  server = createStaticServer(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('createStaticServer', () => {
  it('отдаёт index.html для /', async () => {
    const res = await httpGet('/');
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('text/html');
    expect(res.body).toContain('fixture');
  });

  it('отдаёт корректный MIME для js-модулей', async () => {
    const res = await httpGet('/js/app.js');
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('text/javascript');
  });

  it('отдаёт webmanifest как application/manifest+json (требование PWA)', async () => {
    const res = await httpGet('/manifest.webmanifest');
    expect(res.status).toBe(200);
    expect(res.contentType).toContain('application/manifest+json');
  });

  it('блокирует выход за корень (../ появляется после декодирования)', async () => {
    const res = await httpGet('/..%2f..%2fetc/passwd');
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('root:');
  });

  it('закодированные точки схлопывает канонизация URL — файл не читается', async () => {
    const res = await httpGet('/%2e%2e/sky-defender-secret.txt');
    expect(res.status).toBe(404);
    expect(res.body).not.toContain('secret');
  });

  it('404 на отсутствующий файл', async () => {
    const res = await httpGet('/missing.html');
    expect(res.status).toBe(404);
  });

  it('405 на не-GET методы', async () => {
    const res = await new Promise((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port: server.address().port, path: '/', method: 'POST' },
        (r) => {
          resolve({ status: r.statusCode });
          r.resume();
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(res.status).toBe(405);
  });

  it('базовый URL доступен (smoke)', async () => {
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
