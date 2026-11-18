#!/usr/bin/env node
// Adds a "kodeOS updated to vX.Y.Z" line to the site's changelog data (web/src/news/auto.json). The page turns the
// line into a "What's new" entry in three languages (web/src/news/changelog.ts); this script never touches TypeScript.
// Called by tools/upstream-update.sh after a new release passed its checks; safe to run twice (a version already
// listed changes nothing).
//
//   usage: node tools/news-add.mjs kodeos vX.Y.Z [--date YYYY-MM-DD] [--file <auto.json>] [--dry-run]
//     --date     the entry's day (default: today, UTC)
//     --file     another data file (tests)
//     --dry-run  print what would be written, write nothing
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const die = (msg, code = 64) => {
  console.error(`news-add: ${msg}`);
  process.exit(code);
};
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined) die(`${name} needs a value`);
  args.splice(i, 2);
  return v;
};
const file = opt('--file') ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src', 'news', 'auto.json');
const date = opt('--date') ?? new Date().toISOString().slice(0, 10);
const dry = args.includes('--dry-run');
const [kind, version, ...rest] = args.filter((a) => a !== '--dry-run');
if (kind !== 'kodeos' || rest.length) die('usage: news-add.mjs kodeos vX.Y.Z [--date YYYY-MM-DD] [--file <auto.json>] [--dry-run]');
if (!/^v\d+\.\d+\.\d+$/.test(version ?? '')) die(`${version} is not a release tag vX.Y.Z`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) die(`${date} is not a date YYYY-MM-DD`);

let list;
try {
  list = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  die(`cannot read ${file}: ${e.message}`, 66);
}
if (!Array.isArray(list)) die(`${file} is not a JSON list`, 65);

if (list.some((n) => n && n.kind === kind && n.version === version)) {
  console.log(`news-add: ${kind} ${version} is already in the changelog, nothing to add`);
  process.exit(0);
}
const entry = { id: `${date}-${kind}-${version.slice(1)}`, kind, version };
// newest first, one entry per line: a small diff, easy to read and to revert
const next = [entry, ...list];
const text = next.length ? `[\n${next.map((n) => `  ${JSON.stringify(n)}`).join(',\n')}\n]\n` : '[]\n';
if (dry) {
  console.log(`news-add: dry run, ${file} would become:\n${text}`);
  process.exit(0);
}
writeFileSync(`${file}.tmp`, text);
renameSync(`${file}.tmp`, file); // whole file or nothing
console.log(`news-add: added ${JSON.stringify(entry)}`);
