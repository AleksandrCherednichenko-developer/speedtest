#!/usr/bin/env node
// CLI: N последовательных запросов к одному URL и сводка по скорости скачивания.
// Единицы: время — мс, объём — МБ (10^6 байт), скорость — Мбит/с (10^6 бит/с).

import { measure, parseArgs, summarize, toMB, toMbps } from './lib.js';

const USAGE = `Использование: node index.js <url> [опции]

Опции:
  --count N      число замеряемых запросов (по умолчанию 10)
  --warmup N     сколько прогревочных запросов сделать до замера, они не учитываются (0)
  --timeout MS   лимит на один запрос в миллисекундах (30000)
  --json         вывести результат в JSON
  -h, --help     эта справка

Пример: node index.js https://proof.ovh.net/files/10Mb.dat`;

const pad = (value, width) => String(value).padStart(width);

// Прогресс пишем в stderr и только в терминал: он не мешает JSON и перенаправлению вывода.
function createProgress(enabled) {
  const out = process.stderr;
  return {
    update(label, bytes) {
      if (enabled) out.write(`\r${label}  загружено ${toMB(bytes).toFixed(2)} МБ...`);
    },
    clear() {
      if (enabled) out.write('\r\x1b[K');
    },
  };
}

function printSummary(summary, count) {
  const { timeMs: t, speedMbps: s } = summary;
  console.log('\nИтого');
  console.log(`  Успешных запросов:     ${summary.requests} из ${count}`);
  console.log(`  Скачано всего:         ${toMB(summary.totalBytes).toFixed(2)} МБ`);
  console.log(`  Среднее время запроса: ${t.avg.toFixed(1)} мс`);
  console.log(`  Время (медиана/мин/макс): ${t.median.toFixed(1)} / ${t.min.toFixed(1)} / ${t.max.toFixed(1)} мс`);
  console.log(`  Скорость (медиана/мин/макс): ${s.median.toFixed(2)} / ${s.min.toFixed(2)} / ${s.max.toFixed(2)} Мбит/с`);
  console.log(`  Скорость скачивания:   ${s.overall.toFixed(2)} Мбит/с`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }
  if (parsed.error) {
    console.error(`${parsed.error}\n\n${USAGE}`);
    return 1;
  }

  const { url, count, warmup, timeout, json } = parsed.options;
  const log = json ? () => {} : console.log;
  const progress = createProgress(!json && process.stderr.isTTY);

  // Ctrl+C: первый раз прерываем текущий запрос и печатаем частичный итог,
  // второй раз выходим сразу.
  const controller = new AbortController();
  process.on('SIGINT', () => {
    if (controller.signal.aborted) process.exit(130);
    controller.abort();
  });

  log(`URL: ${url}`);
  log(`Запросов: ${count}${warmup ? ` (+${warmup} прогревочных)` : ''}, таймаут: ${timeout} мс\n`);

  const results = [];
  const requests = [];

  // Строго последовательно: следующий запрос стартует после полного ответа.
  for (let i = 1 - warmup; i <= count && !controller.signal.aborted; i++) {
    const isWarmup = i < 1;
    const label = isWarmup ? 'прогрев' : `#${pad(i, 2)}`;

    try {
      const r = await measure(url, {
        timeout,
        signal: controller.signal,
        onProgress: (bytes) => progress.update(label, bytes),
      });
      progress.clear();
      const speed = toMbps(r.bytes, r.ms);
      log(`${label.padEnd(7)} ${pad(r.ms.toFixed(1), 9)} мс  ${pad(toMB(r.bytes).toFixed(2), 8)} МБ  ${pad(speed.toFixed(2), 8)} Мбит/с`);
      if (!isWarmup) {
        results.push(r);
        requests.push({ ms: r.ms, bytes: r.bytes, mbps: speed });
      }
    } catch (err) {
      progress.clear();
      log(`${label.padEnd(7)} ошибка: ${err.message}`);
      if (!isWarmup && !err.aborted) requests.push({ error: err.message });
    }
  }

  const interrupted = controller.signal.aborted;
  if (interrupted) log('\nОстановлено по Ctrl+C, итог по завершённым запросам.');

  const summary = summarize(results);

  if (json) {
    console.log(JSON.stringify({ url, count, warmup, timeout, interrupted, requests, summary }, null, 2));
  } else if (summary) {
    printSummary(summary, count);
  }

  if (!summary) {
    if (!json) console.error('\nНи один запрос не завершился успешно.');
    return 1;
  }
  return interrupted ? 130 : 0;
}

process.exitCode = await main();
