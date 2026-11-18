// Логика замера без привязки к консоли: её удобно тестировать.
// Единицы: время — мс, объём — байты (в МБ = 10^6 байт переводит toMB), скорость — Мбит/с.

export const DEFAULTS = Object.freeze({
  count: 10,
  warmup: 0,
  timeout: 30_000,
  json: false,
});

const HELP_FLAGS = new Set(['-h', '--help']);

// Разбор аргументов командной строки. Не вызывает process.exit,
// а возвращает { error } — решение о выходе принимает CLI.
export function parseArgs(args) {
  const options = { ...DEFAULTS, url: undefined };

  const readInt = (name, value, min) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min) {
      throw new Error(`${name} должен быть целым числом не меньше ${min}`);
    }
    return n;
  };

  try {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (HELP_FLAGS.has(arg)) return { help: true };
      else if (arg === '--count') options.count = readInt('--count', args[++i], 1);
      else if (arg === '--warmup') options.warmup = readInt('--warmup', args[++i], 0);
      else if (arg === '--timeout') options.timeout = readInt('--timeout', args[++i], 1);
      else if (arg === '--json') options.json = true;
      else if (arg.startsWith('-')) throw new Error(`Неизвестный флаг: ${arg}`);
      else if (options.url) throw new Error('Можно указать только один адрес');
      else options.url = arg;
    }
  } catch (err) {
    return { error: err.message };
  }

  if (!options.url) return { error: 'Не указан адрес' };
  if (!isHttpUrl(options.url)) {
    return { error: `Некорректный адрес: ${options.url} (нужен http:// или https://)` };
  }

  return { options };
}

export function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Один запрос: время от отправки до получения последнего байта тела.
// timeout — лимит на весь запрос; signal — внешняя отмена (Ctrl+C);
// onProgress(bytes) вызывается на каждый полученный кусок.
export async function measure(url, { timeout = DEFAULTS.timeout, signal, onProgress } = {}) {
  const signals = [AbortSignal.timeout(timeout)];
  if (signal) signals.push(signal);

  const start = performance.now();
  let bytes = 0;

  try {
    const res = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.any(signals),
    });

    if (!res.ok) {
      await res.body?.cancel(); // освобождаем соединение
      throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    }

    // Считаем реально полученные байты, а не Content-Length.
    for await (const chunk of res.body) {
      bytes += chunk.length;
      onProgress?.(bytes);
    }
  } catch (err) {
    throw describeError(err, timeout);
  }

  return { ms: performance.now() - start, bytes };
}

// Превращает низкоуровневые ошибки fetch в понятные сообщения.
function describeError(err, timeout) {
  if (err.name === 'TimeoutError') return new Error(`таймаут ${timeout} мс`);
  if (err.name === 'AbortError') {
    const e = new Error('прервано');
    e.aborted = true;
    return e;
  }
  // У сетевых ошибок fetch настоящая причина лежит в err.cause.
  return new Error(err.cause?.message ?? err.message);
}

export const toMB = (bytes) => bytes / 1e6;
export const toMbps = (bytes, ms) => (ms > 0 ? (bytes * 8) / (ms / 1000) / 1e6 : 0);

export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Сводка по успешным замерам. results — массив { ms, bytes }.
export function summarize(results) {
  if (results.length === 0) return null;

  const times = results.map((r) => r.ms);
  const speeds = results.map((r) => toMbps(r.bytes, r.ms));
  const totalMs = times.reduce((a, b) => a + b, 0);
  const totalBytes = results.reduce((a, r) => a + r.bytes, 0);

  return {
    requests: results.length,
    totalBytes,
    timeMs: {
      avg: totalMs / results.length,
      median: median(times),
      min: Math.min(...times),
      max: Math.max(...times),
    },
    // Итоговая скорость: все байты / всё время (а не среднее скоростей).
    speedMbps: {
      overall: toMbps(totalBytes, totalMs),
      median: median(speeds),
      min: Math.min(...speeds),
      max: Math.max(...speeds),
    },
  };
}
