// Step 3: size of every shippable file, raw / gzip -9 / brotli q11 (large window). Writes build/sizes.json and prints a table.
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib"; import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), DIR = path.join(HERE, "build/site/cc");
const rows = []; let tr = 0, tg = 0, tb = 0;
for (const f of fs.readdirSync(DIR).sort()) {
  const raw = fs.readFileSync(path.join(DIR, f)), t0 = performance.now();
  const gz = zlib.gzipSync(raw, { level: 9 }).length;
  const br = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }).length;
  rows.push({ file: f, raw: raw.length, gzip: gz, brotli: br }); tr += raw.length; tg += gz; tb += br;
  console.log(f.padEnd(24), String(raw.length).padStart(10), String(gz).padStart(10), String(br).padStart(10), `(${Math.round(performance.now() - t0)} ms)`);
}
console.log("TOTAL".padEnd(24), String(tr).padStart(10), String(tg).padStart(10), String(tb).padStart(10));
fs.writeFileSync(path.join(HERE, "build/sizes.json"), JSON.stringify({ rows, total: { raw: tr, gzip: tg, brotli: tb } }, null, 1));
