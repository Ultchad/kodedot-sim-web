// Puts the parts library where the page can fetch it: ../parts/dist (built by `node parts/build-library.mjs` when it is
// missing) -> public/parts/ (git-ignored), with the parts engine's Worker source beside it (the page hands it to the
// engine as text, because the CSP only allows blob: workers).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(web, '..', 'parts', 'dist');
const out = join(web, 'public', 'parts');
if (!existsSync(join(dist, 'library.json'))) {
  const r = spawnSync(process.execPath, [join(web, '..', 'parts', 'build-library.mjs')], { stdio: 'inherit' });
  if (r.status !== 0 || !existsSync(join(dist, 'library.json'))) {
    console.error('prepare-parts: could not build the parts library (node parts/build-library.mjs).');
    process.exit(1);
  }
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const lib = JSON.parse(readFileSync(join(dist, 'library.json'), 'utf8'));
for (const f of readdirSync(dist)) copyFileSync(join(dist, f), join(out, f));
// what the page needs of each manifest before the package itself is fetched (the library panel and the table's sizes)
writeFileSync(join(out, 'library.json'), JSON.stringify(lib));
copyFileSync(join(web, '..', 'runtime', 'web-adapter', 'part-worker.js'), join(out, 'part-worker.js'));
console.log(`prepare-parts: ${lib.parts.length} parts -> public/parts`);
