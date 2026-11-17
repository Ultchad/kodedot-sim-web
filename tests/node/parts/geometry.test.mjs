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
    // a terminal on a side face is at that face: within 2 mm of its edge
    const edge = m.pins.filter((p) => p.kind !== "nc" && ((p.face === "left" && p.mm.x > 2) || (p.face === "right" && p.mm.x < b.w_mm - 2) || (p.face === "back" && p.mm.y > 2) || (p.face === "front" && p.mm.y < b.d_mm - 2))).map((p) => p.name);
    check(edge.length === 0, `${d}: terminals on a left, right, front or back face sit at that edge`, edge.slice(0, 4));
    const ref = [...(m.outline ?? []), ...(m.refs ?? []).map((r) => r.mm)].filter((q) => q.x < -0.001 || q.x > b.w_mm + 0.001 || q.y < -0.001 || q.y > b.d_mm + 0.001);
    check(ref.length === 0, `${d}: outline points and reference points are inside the body`, ref.slice(0, 3));
    if (m.category === "prototyping") check(Object.values(m.body.overhang_mm ?? {}).some((v) => v > 0), `${d}: declares an overhang allowance for the dovetail tabs`);
    // controls and visuals that carry millimetres sit on the body and at their picture position
    const place = [...(m.controls ?? []).filter((c) => c.mm).map((c) => ({ n: "control " + c.field, mm: c.mm, px: { x: c.region.x + c.region.w / 2, y: c.region.y + c.region.h / 2 } })), ...(m.visuals ?? []).filter((v) => v.mm).map((v) => ({ n: "visual " + v.id, mm: v.mm, px: { x: v.x, y: v.y } }))];
    const off2 = place.filter((q) => q.mm.x < 0 || q.mm.x > b.w_mm || q.mm.y < 0 || q.mm.y > b.d_mm || Math.abs(q.px.x - q.mm.x * sx) > 1.5 || Math.abs(q.px.y - q.mm.y * sy) > 1.5).map((q) => q.n);
    check(off2.length === 0, `${d}: controls and visuals with mm are inside the body and match their picture position`, off2);
    const noz = m.pins.filter((p) => typeof p.mm.z !== "number").map((p) => p.name);
    check(noz.length === 0, `${d}: every pin has an explicit contact height mm.z (no terminal above the body: z <= ${b.h_mm})`, noz.slice(0, 4));
    check(bad.length === 0, `${d}: every pin's picture position is its mm times the scale and lies inside the body`, bad.slice(0, 4));
    const leg = m.pins.filter((p) => (p.face ?? "top") === "bottom" && p.kind !== "nc");
    if (m.category !== "board" && m.category !== "kode-module" && m.category !== "breadboard" && leg.length > 1) {
      const off = []; for (const p of leg) for (const q of leg) if (p.name < q.name && (!onGrid(p.mm.x - q.mm.x) || !onGrid(p.mm.y - q.mm.y))) off.push(`${p.name}-${q.name} (${(p.mm.x - q.mm.x).toFixed(2)}, ${(p.mm.y - q.mm.y).toFixed(2)})`);
      check(off.length === 0, `${d}: breadboard leads are on the 2.54 mm grid`, off.slice(0, 4));
    }
  }
});
process.exit(finish("geometry"));
