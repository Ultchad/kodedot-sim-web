// Geometry of EVERY built-in part (parts/*/manifest.json): the picture is the top view of the body at one scale, so each pin's picture position must equal
// its millimetre position times that scale; pins that plug into a breadboard (face bottom, a part that is not a board or a module) sit on the 2.54 mm grid
// relative to each other; every pin lies inside the body box (so the box must include connector overhangs and antennas).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, finish, test } from "./rig.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../parts");
const dirs = fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, "manifest.json")));
const onGrid = (v) => { const k = Math.abs(v) / 2.54; return Math.abs(k - Math.round(k)) * 2.54 < 0.06; };

await test(`geometry of every part (${dirs.length})`, async () => {
  for (const d of dirs) {
    const m = JSON.parse(fs.readFileSync(path.join(root, d, "manifest.json"), "utf8")), b = m.body, bad = [];
    if (!b || !m.picture) { check(false, `${d}: body and picture present`); continue; }
    const sx = m.picture.width / b.w_mm, sy = m.picture.height / b.d_mm;
    check(Math.abs(sx - sy) < 0.05 * sx, `${d}: the picture keeps the body's aspect (${sx.toFixed(2)} x ${sy.toFixed(2)} px/mm)`);
    for (const p of m.pins) {
      if (Math.abs(p.pos.x - p.mm.x * sx) > 0.6 || Math.abs(p.pos.y - p.mm.y * sy) > 0.6) bad.push(`${p.name} pos (${p.pos.x},${p.pos.y}) != mm*scale (${(p.mm.x * sx).toFixed(1)},${(p.mm.y * sy).toFixed(1)})`);
      if (p.mm.x < -0.001 || p.mm.x > b.w_mm + 0.001 || p.mm.y < -0.001 || p.mm.y > b.d_mm + 0.001 || (p.mm.z ?? 0) < -0.001 || (p.mm.z ?? 0) > b.h_mm + 0.001) bad.push(`${p.name} outside the body (${p.mm.x}, ${p.mm.y}, ${p.mm.z ?? "-"}) in ${b.w_mm} x ${b.d_mm} x ${b.h_mm}`);
    }
    check(bad.length === 0, `${d}: every pin's picture position is its mm times the scale and lies inside the body`, bad.slice(0, 4));
    const leg = m.pins.filter((p) => (p.face ?? "top") === "bottom" && p.kind !== "nc");
    if (m.category !== "board" && m.category !== "kode-module" && m.category !== "breadboard" && leg.length > 1) {
      const off = []; for (const p of leg) for (const q of leg) if (p.name < q.name && (!onGrid(p.mm.x - q.mm.x) || !onGrid(p.mm.y - q.mm.y))) off.push(`${p.name}-${q.name} (${(p.mm.x - q.mm.x).toFixed(2)}, ${(p.mm.y - q.mm.y).toFixed(2)})`);
      check(off.length === 0, `${d}: breadboard leads are on the 2.54 mm grid`, off.slice(0, 4));
    }
  }
});
process.exit(finish("geometry"));
