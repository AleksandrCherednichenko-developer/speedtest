import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startServer } from './helpers.js';

const CLI = fileURLToPath(new URL('../index.js', import.meta.url));
const exec = promisify(execFile);

// Запуск CLI, который не падает на ненулевом коде, а возвращает его.
async function run(args) {
  try {
    const { stdout, stderr } = await exec('node', [CLI, ...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

describe('CLI', () => {
  let server;
  before(async () => (server = await startServer()));
  after(() => server.close());

  test('без аргументов: справка и код 1', async () => {
    const r = await run([]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Использование/);
  });

  test('успешный замер', async () => {
    const r = await run([server.url('/file?size=100000'), '--count', '3']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Успешных запросов:\s+3 из 3/);
    assert.match(r.stdout, /Скачано всего:\s+0\.30 МБ/);
    assert.match(r.stdout, /Скорость скачивания:\s+[\d.]+ Мбит\/с/);
  });

  test('--json и --warmup', async () => {
    const r = await run([server.url('/file?size=1000'), '--count', '2', '--warmup', '1', '--json']);
    assert.equal(r.code, 0);
    const data = JSON.parse(r.stdout);
    assert.equal(data.requests.length, 2); // прогрев не попал в результаты
    assert.equal(data.summary.totalBytes, 2000);
    assert.equal(data.interrupted, false);
  });

  test('все запросы с ошибкой: код 1', async () => {
    const r = await run([server.url('/missing'), '--count', '2']);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /HTTP 404/);
  });

  test('Ctrl+C печатает частичный итог', async () => {
    const child = spawn('node', [CLI, server.url('/slow'), '--count', '3']);
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    // ждём, пока CLI начнёт первый запрос, и шлём SIGINT
    await new Promise((resolve) => child.stdout.once('data', resolve));
    child.kill('SIGINT');
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.match(stdout, /Остановлено по Ctrl\+C/);
    assert.equal(code, 1); // успешных запросов не было
  });
});
