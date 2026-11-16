// Copies the built-in demo apps (../build/apps/<name>/<name>.dotbench) into public/apps/ and writes public/apps/index.json.
// Fails with build instructions when they are missing (unless public/apps is already complete, e.g. committed/CI-provided).
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(web, '..');
const outDir = join(web, 'public', 'apps');

/** Descriptions shown in the app picker (the packages carry no localised text). */
const APPS = [
  {
    id: 'kodeos',
    name: 'kodeOS', // the package calls itself "kodeos"
    description: {
      en: 'The operating system of the Kode Dot: lock screen, app list and settings.',
      'pt-BR': 'O sistema operacional do Kode Dot: tela de bloqueio, lista de apps e ajustes.',
      es: 'El sistema operativo del Kode Dot: pantalla de bloqueo, lista de apps y ajustes.',
    },
  },
  {
    id: 'kody_kart',
    description: {
      en: 'Kody races his cousins on three Mode 7 circuits. Made by Kode.',
      'pt-BR': 'O Kody corre contra os primos em três circuitos Mode 7. Feito pela Kode.',
      es: 'Kody corre contra sus primos en tres circuitos Mode 7. Hecho por Kode.',
    },
  },
  {
    id: 'display_lvgl',
    description: {
      en: 'A touch demo that draws a small LVGL interface on the screen. Tap and drag on the glass.',
      'pt-BR': 'Uma demonstração de toque que desenha uma pequena interface LVGL na tela. Toque e arraste no vidro.',
      es: 'Una demostración táctil que dibuja una pequeña interfaz LVGL en la pantalla. Toca y arrastra sobre el cristal.',
    },
  },
  {
    id: 'buttons_led',
    description: {
      en: 'Press the top button to switch the LED between green and red.',
      'pt-BR': 'Aperte o botão de cima para alternar o LED entre verde e vermelho.',
      es: 'Pulsa el botón superior para cambiar el LED entre verde y rojo.',
    },
  },
];

const missing = APPS.filter((a) => !existsSync(join(root, 'build', 'apps', a.id, `${a.id}.dotbench`)));
if (missing.length) {
  if (existsSync(join(outDir, 'index.json')) && APPS.every((a) => existsSync(join(outDir, `${a.id}.dotbench`)))) {
    console.warn(`prepare-apps: ../build/apps has no ${missing.map((m) => m.id).join(', ')}; keeping the existing public/apps.`);
    process.exit(0);
  }
  console.error(
    `prepare-apps: the demo packages are missing: ${missing.map((m) => `build/apps/${m.id}/${m.id}.dotbench`).join(', ')}.\n` +
      `Build them from the repository root first, with:\n  tests/node/run.sh           (builds the example packages)\n  tools/dotbench build <app>   (one app)\nthen run this again (npm run prepare:assets).`,
  );
  process.exit(1);
}

const { readZip } = await import(pathToFileURL(join(root, 'runtime', 'web-adapter', 'zip.js')).href);
mkdirSync(outDir, { recursive: true });
const dec = new TextDecoder();
const apps = [];
for (const a of APPS) {
  const from = join(root, 'build', 'apps', a.id, `${a.id}.dotbench`);
  const to = join(outDir, `${a.id}.dotbench`);
  copyFileSync(from, to);
  const files = await readZip(readFileSync(from));
  const manifest = JSON.parse(dec.decode(files.get('manifest.json')));
  const info = JSON.parse(dec.decode(files.get('appdata/app.json')));
  apps.push({
    id: a.id,
    file: `${a.id}.dotbench`,
    name: a.name ?? info.display_name ?? info.name ?? a.id,
    description: a.description,
    size: statSync(to).size,
    version: info.version ?? '',
    sdkCommit: manifest.sdk_commit ?? '',
  });
}
const json = JSON.stringify({ apps }, null, 2) + '\n';
if (!existsSync(join(outDir, 'index.json')) || readFileSync(join(outDir, 'index.json'), 'utf8') !== json) writeFileSync(join(outDir, 'index.json'), json);
console.log(`prepare-apps: ${apps.map((a) => `${a.id} (${a.size} B, sdk ${a.sdkCommit})`).join(', ')} -> public/apps`);
