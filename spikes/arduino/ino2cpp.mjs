#!/usr/bin/env node
// Minimal replacement for the Arduino IDE's .ino preprocessing: add #include <Arduino.h> and
// forward prototypes for every top-level function, so code may call functions defined later.
// Usage: node ino2cpp.mjs sketch.ino > sketch.cpp          (throwaway: the real CLI hardens this)
import fs from 'node:fs';
const file = process.argv[2], src = fs.readFileSync(file, 'utf8');
// 1. mask comments, string/char literals and preprocessor lines (same length, newlines kept)
const m = src.split(''); const blank = (a, b) => { for (let k = a; k < b; k++) if (m[k] !== '\n') m[k] = ' '; };
for (let i = 0; i < src.length;) {
  const c = src[i], d = src[i + 1];
  if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = src.length; blank(i, j); i = j; }
  else if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? src.length : j + 2; blank(i, j); i = j; }
  else if (c === '"' || c === "'") { let j = i + 1; while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1; blank(i + 1, j); i = j + 1; }
  else if (c === '#' && /^\s*$/.test(src.slice(src.lastIndexOf('\n', i - 1) + 1, i))) {
    let j = i; for (;;) { const e = src.indexOf('\n', j); if (e < 0) { j = src.length; break; } if (src[e - 1] === '\\') { j = e + 1; continue; } j = e; break; }
    blank(i, j); i = j;
  } else i++;
}
const t = m.join('');
// 2. find top-level function definitions
const protos = []; let depth = 0, stmtStart = 0, firstDef = -1;
const NOT_FN = /^(?:class|struct|enum|union|namespace|typedef|extern|template|using)\b/;
for (let i = 0; i < t.length; i++) {
  const c = t[i];
  if (c === '{') {
    if (depth === 0) {
      const head = t.slice(stmtStart, i);
      const mm = /^\s*([A-Za-z_][\w\s\*&:<>,]*?[\s\*&])([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:const)?\s*$/.exec(head);
      if (mm && !NOT_FN.test(head.trim()) && !/^(?:if|for|while|switch|else|return)$/.test(mm[2])) {
        const startOrig = stmtStart + head.length - head.trimStart().length;
        protos.push(src.slice(startOrig, i).trim().replace(/\s+/g, ' ') + ';');
        if (firstDef < 0) firstDef = startOrig;
      }
    }
    depth++;
  } else if (c === '}') { depth--; if (depth === 0) stmtStart = i + 1; }
  else if (c === ';' && depth === 0) stmtStart = i + 1;
}
const line = (idx) => src.slice(0, idx).split('\n').length;
if (firstDef < 0) firstDef = src.length;
const out = `#include <Arduino.h>\n#line 1 "${file}"\n${src.slice(0, firstDef)}\n#line 1 "(auto prototypes)"\n${protos.join('\n')}\n#line ${line(firstDef)} "${file}"\n${src.slice(firstDef)}`;
process.stdout.write(out);
