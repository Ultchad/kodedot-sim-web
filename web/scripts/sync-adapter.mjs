// Copies the firmware team's browser adapter (../runtime/web-adapter/*.js) into src/generated/web-adapter/ (git-ignored).
// One source of truth: never edit the copy. Runs before dev, build, test and the headless check.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(web, '..', 'runtime', 'web-adapter');
const dst = join(web, 'src', 'generated', 'web-adapter');

if (!existsSync(join(src, 'dotbench-device.js'))) {
  console.error(`sync-adapter: cannot find ${src}/dotbench-device.js.\nThe web page needs the repository's runtime/web-adapter folder next to web/ (the firmware side owns it).`);
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
let n = 0;
for (const f of readdirSync(src).filter((f) => f.endsWith('.js'))) {
  const to = join(dst, f);
  if (existsSync(to) && readFileSync(to).equals(readFileSync(join(src, f)))) continue; // unchanged: keep mtime (no needless HMR)
  copyFileSync(join(src, f), to);
  n++;
}
console.log(`sync-adapter: ${n ? `copied ${n} file(s)` : 'up to date'} -> src/generated/web-adapter`);
