// The "Make your own" tab's files: templates/component-starter as one zip, plus the manual (README) and the AI prompt
// (PROMPT) in the three languages as plain text -> public/starter/ (git-ignored).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(web, '..', 'templates', 'component-starter');
const out = join(web, 'public', 'starter');
if (!existsSync(join(src, 'manifest.json'))) {
  console.error('prepare-starter: templates/component-starter is missing.');
  process.exit(1);
}
const { writeZip } = await import(pathToFileURL(join(web, '..', 'tools', 'dblib', 'part', 'zipwrite.mjs')).href);
const files = [];
const walk = (dir, rel) => {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f), r = rel ? `${rel}/${f}` : f;
    if (statSync(p).isDirectory()) walk(p, r);
    else files.push([`component-starter/${r}`, new Uint8Array(readFileSync(p))]);
  }
};
walk(src, '');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const zip = writeZip(files);
writeFileSync(join(out, 'component-starter.zip'), zip);
for (const [lang, sfx] of [['en', ''], ['pt-BR', '.pt-BR'], ['es', '.es']]) {
  writeFileSync(join(out, `manual.${lang}.md`), readFileSync(join(src, `README${sfx}.md`)));
  writeFileSync(join(out, `prompt.${lang}.md`), readFileSync(join(src, `PROMPT${sfx}.md`)));
}
console.log(`prepare-starter: ${files.length} files, ${zip.length} bytes -> public/starter`);
