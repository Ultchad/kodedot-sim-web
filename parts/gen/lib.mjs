// SPDX-License-Identifier: GPL-3.0-or-later
// Helpers of the built-in part generators (parts/gen/*.mjs). A generator writes parts/<dir>/manifest.json, picture.svg and tests/*.test.json;
// `node parts/gen/gen-parts.mjs` rewrites them all, `node parts/build-library.mjs` builds the .dotpart files from them.
// Geometry convention (the same for every part; docs/STATUS-parts.md "Geometry"): millimetres, origin at the top-left corner of the footprint
// seen from above, x to the right, y down the picture, z up from the table. The picture is that top view at `scale` pixels per millimetre.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PARTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const L = (en, pt, es) => ({ en, "pt-BR": pt, es });
const r1 = (x) => Math.round(x * 100) / 100;

/** pin at (x, y) millimetres. kind io|power_in|power_out|ground|analog. */
export function P(name, kind, x, y, o = {}) { return { name, kind, mm: { x: r1(x), y: r1(y) }, ...o }; }

/**
 * @param {object} d {id, dir, name, desc, category, tags, keywords, w, d, h (mm), scale (px per mm, default 10), pins, fields, outputs, visuals, controls, behaviour, extra, svg(px) -> string, tests: {file: obj}, files: {rel: text}}
 */
export function writePart(d) {
  const scale = d.scale ?? 10, W = Math.round(d.w * scale), H = Math.round(d.d * scale), px = (mm) => Math.round(mm * scale * 10) / 10;
  const dir = path.join(PARTS, d.dir);
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  const pins = d.pins.map(({ name, kind, mm, face, label, ...rest }) => {
    const o = { name, kind, pos: { x: px(mm.x), y: px(mm.y) }, mm: mm.z === undefined ? mm : { ...mm } };
    if (face) o.face = face;
    if (label !== null) o.label = label ?? { en: name };
    return { ...o, ...rest };
  });
  const m = {
    $schema: "../../templates/component-starter/manifest.schema.json", schemaVersion: 1, id: d.id, name: d.name, version: d.version ?? "1.0.0",
    author: { name: "dotbench", url: "https://dotbench.app" }, license: "GPL-3.0-or-later", description: d.desc, category: d.category, tags: d.tags, keywords: d.keywords,
    body: { w_mm: d.w, d_mm: d.d, h_mm: d.h, ...(d.estimate ? { estimate: true } : {}) }, picture: { file: "picture.svg", width: W, height: H }, ...(d.extra ?? {}),
    pins, ...(d.groups ? { groups: d.groups } : {}), ...(d.fields ? { fields: d.fields } : {}), ...(d.controls ? { controls: d.controls } : {}), ...(d.outputs ? { outputs: d.outputs } : {}),
    ...(d.visuals ? { visuals: d.visuals } : {}), behaviour: d.behaviour,
  };
  // pins one per line: a breadboard has 830 of them and the manifest limit is 256 KB
  const text = JSON.stringify({ ...m, pins: "@@PINS@@", ...(m.groups ? { groups: "@@GROUPS@@" } : {}) }, null, 2)
    .replace('"@@PINS@@"', "[\n" + pins.map((p) => "    " + JSON.stringify(p)).join(",\n") + "\n  ]")
    .replace('"@@GROUPS@@"', () => "[\n" + (m.groups ?? []).map((g) => "    " + JSON.stringify(g)).join(",\n") + "\n  ]");
  fs.writeFileSync(path.join(dir, "manifest.json"), text + "\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${d.svg({ px, W, H, scale })}\n</svg>\n`;
  fs.writeFileSync(path.join(dir, "picture.svg"), svg);
  for (const [f, t] of Object.entries(d.tests ?? {})) fs.writeFileSync(path.join(dir, "tests", f), JSON.stringify(t, null, 2) + "\n");
  for (const [f, t] of Object.entries(d.files ?? {})) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); }
  return m;
}
/** a pin marker as drawn in pictures */
export const dot = (x, y, r = 3.5, fill = "#c9a227") => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="#7a6416" stroke-width="1.5"/>`;
export const pinDots = (pins, px, r) => pins.filter((p) => p.kind !== "nc").map((p) => dot(px(p.mm.x), px(p.mm.y), r)).join("");
