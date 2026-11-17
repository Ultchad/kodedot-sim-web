// Puts the parts library where the page can fetch it -> public/parts/ (git-ignored), with the parts engine's Worker source beside
// it (the page hands it to the engine as text, because the CSP only allows blob: workers).
//
// Where the library comes from (see docs/STATUS-deploy.md):
//   * ../parts/prebuilt (committed; made by `node tools/parts-prebuilt.mjs regen` on a machine with Emscripten) when it is up to
//     date with the part sources. This is the only source on a clean machine such as Vercel, which has no Emscripten.
//   * a fresh local build into ../parts/dist when it is stale and Emscripten is present (the build is deterministic, so a fresh
//     one equals the prebuilt whenever the prebuilt is up to date; that is why it is skipped then). DOTBENCH_PARTS=build forces it.
//   * stale and no Emscripten: on Vercel / CI (VERCEL or CI set) the build FAILS, elsewhere it warns and uses the stale prebuilt.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(web, '..');
const out = join(web, 'public', 'parts');
const tool = await import(pathToFileURL(join(repo, 'tools', 'parts-prebuilt.mjs')).href);
const ci = !!(process.env.VERCEL || process.env.CI);

const status = tool.checkPrebuilt();
let from = tool.PREBUILT, why = 'committed prebuilt';
const force = process.env.DOTBENCH_PARTS === 'build';
if (!status.ok || force) {
  if (tool.hasToolchain()) {
    const dist = join(repo, 'parts', 'dist');
    rmSync(dist, { recursive: true, force: true });
    if (!force) console.warn(`prepare-parts: the committed parts/prebuilt is out of date:\n  ${status.problems.join('\n  ')}\n  building the library here; run "npm run parts:regen" (repo root: node tools/parts-prebuilt.mjs regen) and commit parts/prebuilt.`);
    const r = spawnSync(process.execPath, [join(repo, 'parts', 'build-library.mjs')], { stdio: 'inherit' });
    if (r.status !== 0 || !existsSync(join(dist, 'library.json'))) {
      console.error('prepare-parts: could not build the parts library (node parts/build-library.mjs).');
      process.exit(1);
    }
    from = dist; why = 'fresh local build';
  } else if (ci) {
    console.error(`prepare-parts: the committed parts/prebuilt is out of date and this machine has no Emscripten:\n  ${status.problems.join('\n  ')}\nOn the maker's machine run: node tools/parts-prebuilt.mjs regen   and commit parts/prebuilt.`);
    process.exit(1);
  } else {
    console.warn(`prepare-parts: the committed parts/prebuilt is out of date and there is no Emscripten here; using it as it is:\n  ${status.problems.join('\n  ')}`);
  }
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const lib = JSON.parse(readFileSync(join(from, 'library.json'), 'utf8'));
for (const f of readdirSync(from)) if (f !== 'SOURCES.json') copyFileSync(join(from, f), join(out, f));
// what the page needs of each manifest before the package itself is fetched (the library panel and the table's sizes)
writeFileSync(join(out, 'library.json'), JSON.stringify(lib));
copyFileSync(join(repo, 'runtime', 'web-adapter', 'part-worker.js'), join(out, 'part-worker.js'));
console.log(`prepare-parts: ${lib.parts.length} parts (${why}) -> public/parts`);
