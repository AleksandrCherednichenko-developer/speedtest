#!/usr/bin/env node
// Замер скорости скачивания: N последовательных запросов к одному URL.
// Единицы: время — мс, объём — МБ (10^6 байт), скорость — Мбит/с (10^6 бит/с).

const DEFAULT_COUNT = 10;

function printUsage() {
  console.log('Использование: node index.js <url> [--count N]');
  console.log('Пример:        node index.js https://proof.ovh.net/files/10Mb.dat');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let count = DEFAULT_COUNT;
  let url;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count') {
      count = Number(args[++i]);
    } else if (args[i] === '-h' || args[i] === '--help') {
      return { help: true };
    } else {
      url = args[i];
    }
  }

  return { url, count };
}

// Один запрос: время от отправки до получения последнего байта тела.
async function measure(url) {
  const start = performance.now();
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });

  if (!res.ok) {
    // Тело всё равно нужно освободить, чтобы соединение не висело.
    await res.body?.cancel();
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  // Считаем реально полученные байты, а не Content-Length.
  let bytes = 0;
  for await (const chunk of res.body) {
    bytes += chunk.length;
  }

  return { ms: performance.now() - start, bytes };
}

const toMB = (bytes) => bytes / 1e6;
const toMbps = (bytes, ms) => (bytes * 8) / (ms / 1000) / 1e6;

async function main() {
  const { url, count, help } = parseArgs(process.argv);

  if (help) {
    printUsage();
    return;
  }

  if (!url) {
    printUsage();
    process.exit(1);
  }

  try {
    const { protocol } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') throw new Error();
  } catch {
    console.error(`Некорректный адрес: ${url} (нужен http:// или https://)`);
    process.exit(1);
  }

  if (!Number.isInteger(count) || count < 1) {
    console.error('--count должен быть целым числом больше 0');
    process.exit(1);
  }

  console.log(`URL: ${url}`);
  console.log(`Запросов: ${count}\n`);

  let totalMs = 0;
  let totalBytes = 0;
  let ok = 0;

  // Строго последовательно: следующий запрос стартует после полного ответа.
  for (let i = 1; i <= count; i++) {
    try {
      const { ms, bytes } = await measure(url);
      totalMs += ms;
      totalBytes += bytes;
      ok++;
      console.log(
        `#${String(i).padStart(2)}  ${ms.toFixed(1).padStart(9)} мс  ` +
          `${toMB(bytes).toFixed(2).padStart(8)} МБ  ${toMbps(bytes, ms).toFixed(2).padStart(8)} Мбит/с`,
      );
    } catch (err) {
      console.log(`#${String(i).padStart(2)}  ошибка: ${err.cause?.message ?? err.message}`);
    }
  }

  if (ok === 0) {
    console.error('\nНи один запрос не завершился успешно.');
    process.exit(1);
  }

  console.log('\nИтого');
  console.log(`  Успешных запросов:     ${ok} из ${count}`);
  console.log(`  Среднее время запроса: ${(totalMs / ok).toFixed(1)} мс`);
  console.log(`  Скачано всего:         ${toMB(totalBytes).toFixed(2)} МБ`);
  console.log(`  Скорость скачивания:   ${toMbps(totalBytes, totalMs).toFixed(2)} Мбит/с`);
}

main();
