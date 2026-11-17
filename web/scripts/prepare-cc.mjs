// Puts the in-browser sketch compiler where the page can fetch it: <repo>/build/cc-assets (made by
// `node runtime/cc/build/build-assets.mjs`, never committed) -> public/cc/ (git-ignored), and the compiler's page-side
// module (runtime/cc/index.js) -> src/generated/cc/. The page fetches nothing of it until the code editor compiles.
// DOTBENCH_CC_ASSETS may name another folder holding manifest.json. Without the assets the build still works: the
// editor then says the compiler's files are not on this site.
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(web, '..');
const gen = join(web, 'src', 'generated', 'cc');
mkdirSync(gen, { recursive: true });
const index = join(repo, 'runtime', 'cc', 'index.js');
if (!existsSync(index)) {
  console.error('prepare-cc: runtime/cc/index.js is missing (the compile service owns it).');
  process.exit(1);
}
if (!existsSync(join(gen, 'index.js')) || !readFileSync(join(gen, 'index.js')).equals(readFileSync(index))) copyFileSync(index, join(gen, 'index.js'));

const out = join(web, 'public', 'cc');
let src = process.env.DOTBENCH_CC_ASSETS || join(repo, 'build', 'cc-assets');
const builder = join(repo, 'runtime', 'cc', 'build', 'build-assets.mjs');
if (!existsSync(join(src, 'manifest.json')) && existsSync(builder)) {
  console.log('prepare-cc: building the compiler assets (minutes, once)...');
  spawnSync(process.execPath, [builder], { stdio: 'inherit', cwd: repo });
}
if (!existsSync(join(src, 'manifest.json'))) {
  rmSync(out, { recursive: true, force: true });
  console.warn('prepare-cc: no compiler assets (build/cc-assets/manifest.json). The code editor will not compile on this build.');
  process.exit(0);
}
// The packs are gzip files the compiler inflates itself. Static servers that see ".gz" (vite preview's sirv among them)
// add "Content-Encoding: gzip", the browser then inflates the body and the compiler gets something it cannot read:
// here they are served under ".pack.bin" (the manifest says which files are gzip, not the name).
const stamp = readFileSync(join(src, 'manifest.json'), 'utf8').replaceAll('.pack.gz', '.pack.bin');
if (existsSync(join(out, 'manifest.json')) && readFileSync(join(out, 'manifest.json'), 'utf8') === stamp) {
  console.log('prepare-cc: up to date -> public/cc');
} else {
  rmSync(out, { recursive: true, force: true });
  cpSync(src, out, { recursive: true });
  for (const f of readdirSync(out)) if (f.endsWith('.pack.gz')) renameSync(join(out, f), join(out, f.replace(/\.pack\.gz$/, '.pack.bin')));
  writeFileSync(join(out, 'manifest.json'), stamp);
  console.log('prepare-cc: compiler assets -> public/cc');
}
