// SPDX-License-Identifier: GPL-3.0-or-later
// The Arduino IDE's .ino preprocessing, minus ctags: add #include <Arduino.h> and a forward prototype for every top-level function,
// so code may call functions defined later (the usual "undeclared identifier" surprise in plain C++).
/** @param {string} src sketch text (all .ino files concatenated, the main one first) @param {string} file name used in #line */
export function inoToCpp(src, file) { return inoToCppEx(src, file, []).cpp; }

/**
 * The IDE concatenates the .ino files of a sketch (the main one first, the rest in name order). Every file keeps its own name and line numbers in
 * `#line`, so compiler messages point into the file the user edits. [name, text][] -> {cpp, protoOrigins}; protoOrigins[i] is the {file, line} where
 * the function behind the i-th generated prototype is defined (errors inside "(auto prototypes)" are mapped back with it).
 * @param {[string, string][]} files
 */
export function sketchToCpp(files) {
  if (!files.length) throw new Error("a sketch needs at least one .ino file");
  const marks = []; let src = "";
  files.forEach(([name, text], i) => { if (i) { src += "\n"; marks.push({ at: src.length, name }); src += `#line 1 "${name}"\n`; } src += text; });
  return inoToCppEx(src, files[0][0], marks);
}

/** marks: [{at, name}], where a "#line 1 "name"\n" line starts at offset `at` of src (files after the first) */
function inoToCppEx(src, file, marks) {
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
const protos = [], protoStarts = []; let depth = 0, stmtStart = 0, firstDef = -1;
const NOT_FN = /^(?:class|struct|enum|union|namespace|typedef|extern|template|using)\b/;
for (let i = 0; i < t.length; i++) {
  const c = t[i];
  if (c === '{') {
    if (depth === 0) {
      const head = t.slice(stmtStart, i);
      const mm = /^\s*([A-Za-z_][\w\s\*&:<>,]*?[\s\*&])([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:const)?\s*$/.exec(head);
      if (mm && !NOT_FN.test(head.trim()) && !/^(?:if|for|while|switch|else|return)$/.test(mm[2])) {
        const startOrig = stmtStart + head.length - head.trimStart().length;
        protoStarts.push(startOrig);
        protos.push(src.slice(startOrig, i).trim().replace(/\s+/g, ' ') + ';');
        if (firstDef < 0) firstDef = startOrig;
      }
    }
    depth++;
  } else if (c === '}') { depth--; if (depth === 0) stmtStart = i + 1; }
  else if (c === ';' && depth === 0) stmtStart = i + 1;
}
const line = (idx) => src.slice(0, idx).split('\n').length;
// where idx is, as the file and line the user sees: the last "#line 1 "name"" marker before it decides the file
const loc = (idx) => {
  let m = null; for (const k of marks) if (k.at <= idx) m = k;
  if (!m) return { file, line: line(idx) };
  const from = src.indexOf('\n', m.at) + 1;
  return { file: m.name, line: src.slice(from, idx).split('\n').length };
};
if (firstDef < 0) firstDef = src.length;
const at = loc(firstDef);
// with several files the "#line N" after the prototypes must name the file the first definition is in (single file: unchanged output)
const back = marks.length ? `#line ${at.line} "${at.file}"` : `#line ${line(firstDef)} "${file}"`;
const out = `#include <Arduino.h>\n#line 1 "${file}"\n${src.slice(0, firstDef)}\n#line 1 "(auto prototypes)"\n${protos.join('\n')}\n${back}\n${src.slice(firstDef)}`;
return { cpp: out, protoOrigins: protoStarts.map(loc) };
}
