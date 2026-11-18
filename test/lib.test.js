import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { measure, median, parseArgs, summarize, toMbps } from '../lib.js';
import { startServer } from './helpers.js';

describe('parseArgs', () => {
  test('значения по умолчанию', () => {
    const { options } = parseArgs(['https://example.com/a']);
    assert.deepEqual(options, {
      url: 'https://example.com/a',
      count: 10,
      warmup: 0,
      timeout: 30000,
      json: false,
    });
  });

  test('все флаги', () => {
    const { options } = parseArgs(['--count', '3', '--warmup', '1', '--timeout', '500', '--json', 'http://x.ru']);
    assert.equal(options.count, 3);
    assert.equal(options.warmup, 1);
    assert.equal(options.timeout, 500);
    assert.equal(options.json, true);
  });

  test('ошибки ввода', () => {
    assert.match(parseArgs([]).error, /Не указан адрес/);
    assert.match(parseArgs(['not-a-url']).error, /Некорректный адрес/);
    assert.match(parseArgs(['ftp://x.ru']).error, /Некорректный адрес/);
    assert.match(parseArgs(['http://x.ru', '--count', '0']).error, /--count/);
    assert.match(parseArgs(['http://x.ru', '--count', 'abc']).error, /--count/);
    assert.match(parseArgs(['http://x.ru', '--foo']).error, /Неизвестный флаг/);
    assert.match(parseArgs(['http://a.ru', 'http://b.ru']).error, /один адрес/);
  });

  test('справка', () => {
    assert.deepEqual(parseArgs(['--help']), { help: true });
  });
});

describe('статистика', () => {
  test('median', () => {
    assert.equal(median([]), 0);
    assert.equal(median([5]), 5);
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
  });

  test('toMbps: 1 МБ за 1 с = 8 Мбит/с', () => {
    assert.equal(toMbps(1_000_000, 1000), 8);
    assert.equal(toMbps(100, 0), 0);
  });

  test('summarize', () => {
    const s = summarize([
      { ms: 1000, bytes: 1_000_000 }, // 8 Мбит/с
      { ms: 3000, bytes: 1_000_000 }, // ~2.67 Мбит/с
    ]);
    assert.equal(s.requests, 2);
    assert.equal(s.totalBytes, 2_000_000);
    assert.equal(s.timeMs.avg, 2000);
    assert.equal(s.timeMs.min, 1000);
    assert.equal(s.timeMs.max, 3000);
    // общая скорость = все байты / всё время: 16 Мбит / 4 с
    assert.equal(s.speedMbps.overall, 4);
    assert.equal(s.speedMbps.max, 8);
  });

  test('summarize без результатов', () => {
    assert.equal(summarize([]), null);
  });
});

describe('measure', () => {
  let server;
  before(async () => (server = await startServer()));
  after(() => server.close());

  test('считает реально полученные байты', async () => {
    const progress = [];
    const r = await measure(server.url('/file?size=250000'), { onProgress: (b) => progress.push(b) });
    assert.equal(r.bytes, 250000);
    assert.ok(r.ms > 0);
    assert.equal(progress.at(-1), 250000);
  });

  test('HTTP-ошибка', async () => {
    await assert.rejects(measure(server.url('/missing')), /HTTP 404/);
  });

  test('таймаут', async () => {
    await assert.rejects(measure(server.url('/slow'), { timeout: 200 }), /таймаут 200 мс/);
  });

  test('внешняя отмена', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(measure(server.url('/slow'), { signal: controller.signal }), (err) => err.aborted === true);
  });

  test('сетевая ошибка', async () => {
    // поднимаем и сразу гасим сервер: его порт гарантированно свободен
    const tmp = await startServer();
    const deadUrl = tmp.url('/file');
    await tmp.close();
    await assert.rejects(measure(deadUrl), /ECONNREFUSED/);
  });
});
