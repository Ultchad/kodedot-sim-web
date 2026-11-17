// Directory <-> yowasp "Tree" helpers (Node only; the browser builds its trees from the fetched packs).
import fs from "node:fs"; import path from "node:path";
export function loadTree(dir, filter = () => true) {
  const t = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (!filter(p, e)) continue;
    const st = fs.statSync(p);
    t[e.name] = st.isDirectory() ? loadTree(p, filter) : fs.readFileSync(p);
  }
  return t;
}
export function setPath(tree, p, v) {
  const parts = p.split("/"); let d = tree;
  for (const s of parts.slice(0, -1)) d = d[s] ??= {};
  d[parts.at(-1)] = v; return tree;
}
export function getPath(tree, p) { let d = tree; for (const s of p.split("/")) { d = d?.[s]; if (d === undefined) return undefined; } return d; }
export function flatten(tree, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(tree)) (v instanceof Uint8Array || typeof v === "string") ? out.set(prefix + k, v) : flatten(v, prefix + k + "/", out);
  return out;
}
