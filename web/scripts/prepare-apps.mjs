// Puts the Dot's software into public/apps/: the system package (kodeos.dotbench), the factory apps and factory.json.
//
// The list is data: scripts/factory-apps.json = { "os": "<name>", "factory": ["<name>", ...] }, each name a package
// built by the repository's build tool at ../build/apps/<name>/<name>.dotbench. To ship one more factory app, build it
// and add its name to that list; nothing else changes (the page reads factory.json, kodeOS shows the app's own name
// and icon from the package).
//
// public/apps/factory.json = {"format":1,"apps":["<name>.dotbench", ...]} is what the page hands to the system layer
// (runtime/web-adapter/dotbench-system.js), which installs those packages on the first boot of an empty Dot.
//
// When a package is missing under ../build/apps but public/apps is already complete (committed, or provided by CI),
// the existing files are kept. Otherwise this fails with build instructions.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..');
const root = join(web, '..');
const outDir = join(web, 'public', 'apps');

const list = JSON.parse(readFileSync(join(here, 'factory-apps.json'), 'utf8'));
const valid = (n) => typeof n === 'string' && /^[A-Za-z0-9_.-]+$/.test(n);
if (!valid(list.os) || !Array.isArray(list.factory) || !list.factory.every(valid) || new Set(list.factory).size !== list.factory.length) {
  console.error('prepare-apps: scripts/factory-apps.json must be {"os": "<name>", "factory": ["<name>", ...]} with distinct package names.');
  process.exit(1);
}
const names = [list.os, ...list.factory];
const built = (n) => join(root, 'build', 'apps', n, `${n}.dotbench`);
const file = (n) => `${n}.dotbench`;
const factoryJson = JSON.stringify({ format: 1, apps: list.factory.map(file) }) + '\n';

const missing = names.filter((n) => !existsSync(built(n)));
if (missing.length) {
  if (names.every((n) => existsSync(join(outDir, file(n))))) {
    console.warn(`prepare-apps: ../build/apps has no ${missing.join(', ')}; keeping the packages already in public/apps.`);
  } else {
    console.error(
      `prepare-apps: packages are missing: ${missing.map((n) => `build/apps/${n}/${n}.dotbench`).join(', ')}.\n` +
        `Build them from the repository root first, with:\n  tests/node/boot/run.sh       (builds kodeOS and the factory apps)\n  tools/dotbench build <app>   (one app)\nthen run this again (npm run prepare:assets).`,
    );
    process.exit(1);
  }
}

mkdirSync(outDir, { recursive: true });
const report = [];
for (const n of names) {
  const to = join(outDir, file(n));
  if (existsSync(built(n))) {
    const bytes = readFileSync(built(n));
    if (!existsSync(to) || !readFileSync(to).equals(bytes)) copyFileSync(built(n), to);
  }
  report.push(`${n} (${statSync(to).size} B)`);
}
const target = join(outDir, 'factory.json');
if (!existsSync(target) || readFileSync(target, 'utf8') !== factoryJson) writeFileSync(target, factoryJson);
// the list the page used before apps lived inside kodeOS
rmSync(join(outDir, 'index.json'), { force: true });
console.log(`prepare-apps: system ${report[0]}; factory: ${report.slice(1).join(', ')} -> public/apps`);
