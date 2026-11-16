/**
 * Where every opening and inlay sits, as 2D loops on the face that carries it.
 * Pure data (unit-tested): the body mesh cuts these loops, the parts fill them.
 */
import {
  BACK_FEATURES_ESTIMATE as BF,
  SIDE_FEATURES_ESTIMATE as SF,
  circleLoop,
  crossLoop,
  roundedRectLoop,
  type BodyDims,
  type Pt,
} from '../lib/bodyModel';

/** Hairline gap between the body and a part sitting in it. */
export const SEAM_MM = 0.07;

/** Move every point of a counter-clockwise loop outwards by g (negative: inwards). Meant for small g on smooth loops. */
export function offsetLoop(loop: Pt[], g: number): Pt[] {
  const n = loop.length;
  return loop.map((p, i) => {
    const a = loop[(i + n - 1) % n];
    const b = loop[(i + 1) % n];
    let n1x = p[1] - a[1], n1y = -(p[0] - a[0]);
    let n2x = b[1] - p[1], n2y = -(b[0] - p[0]);
    const l1 = Math.hypot(n1x, n1y) || 1, l2 = Math.hypot(n2x, n2y) || 1;
    n1x /= l1; n1y /= l1; n2x /= l2; n2y /= l2;
    let bx = n1x + n2x, by = n1y + n2y;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl; by /= bl;
    const k = Math.min(2, 1 / Math.max(0.5, Math.sqrt((1 + n1x * n2x + n1y * n2y) / 2)));
    return [p[0] + bx * g * k, p[1] + by * g * k] as Pt;
  });
}

export interface Recess {
  /** counter-clockwise loop in the face's own 2D coordinates */
  loop: Pt[];
  depth: number;
  /** occlusion at the rim, at the bottom of the wall, and on the floor (1 = open, 0 = black) */
  shade: [number, number, number];
  /** no floor: something else closes the hole (an inlay), or it goes right through */
  floor: boolean;
  /** recesses cut into the floor of this one */
  inner?: Recess[];
}

const translate = (loop: Pt[], x: number, y: number): Pt[] => loop.map(([a, b]) => [a + x, b + y]);

/** Openings in the front face, in body x/y. */
export function frontOpenings(d: BodyDims) {
  const dark: [number, number, number] = [0.5, 0.14, 0.1];
  const well = (loop: Pt[], depth = 1.3): Recess => ({ loop, depth, shade: dark, floor: true });
  return {
    bezel: { loop: roundedRectLoop(d.bezel.cx, d.bezel.cy, d.bezel.w + 2 * SEAM_MM, d.bezel.h + 2 * SEAM_MM, d.bezel.r + SEAM_MM, 14), depth: 0.9, shade: [0.45, 0.1, 0.1], floor: false } as Recess,
    led: { loop: offsetLoop(d.led.loop, SEAM_MM), depth: 0.9, shade: [0.6, 0.3, 0.3], floor: false } as Recess,
    top: well(circleLoop(d.buttons.top.x, d.buttons.top.y, d.buttons.top.r + SEAM_MM, 44)),
    bottom: well(circleLoop(d.buttons.bottom.x, d.buttons.bottom.y, d.buttons.bottom.r + SEAM_MM, 44)),
    dpad: well(translate(crossLoop(d.dpad.half, d.dpad.armHalf, d.dpad.innerR, SEAM_MM, 14, 5), d.dpad.x, d.dpad.y)),
  };
}

/** Loops of the parts that sit in the front face (no seam). */
export function frontParts(d: BodyDims) {
  return {
    bezel: roundedRectLoop(d.bezel.cx, d.bezel.cy, d.bezel.w, d.bezel.h, d.bezel.r, 14),
    screen: roundedRectLoop(0, 0, d.screen.w, d.screen.h, d.screen.r, 12),
    led: d.led.loop,
  };
}

/**
 * Wall features in wall coordinates: (t, z) with t = y on the left/right walls
 * and t = x on the top/bottom walls, z in the body frame.
 */
export function wallOpenings(d: BodyDims) {
  const zOf = (behind: number) => d.zf - behind;
  // right wall: window. Keep it on the flat part of the wall.
  const w = SF.window;
  const windowLoop = roundedRectLoop(w.y, zOf(w.zBehind), w.h, w.w, w.r, 8);
  const windowRecess: Recess = { loop: offsetLoop(windowLoop, SEAM_MM), depth: 0.8, shade: [0.5, 0.12, 0.1], floor: false };

  // left wall: grille 5 + 6 + 5 holes, the middle column half a pitch higher
  const g = SF.grille;
  const holes: Pt[] = [];
  const zc = zOf(g.zBehind);
  for (let c = -1; c <= 1; c++) {
    const count = c === 0 ? 6 : 5;
    for (let i = 0; i < count; i++) {
      const y = g.y + ((count - 1) / 2 - i) * g.pitchY;
      holes.push([y, zc + c * g.pitchZ]);
    }
  }
  const grille: Recess[] = holes.map(([y, z]) => ({ loop: circleLoop(y, z, g.holeD / 2, 14), depth: 1.0, shade: [0.86, 0.5, 0.52], floor: true }));

  const s = SF.slot;
  const slotOuter = roundedRectLoop(s.y, zOf(s.zBehind), s.len, s.w, s.w / 2, 7);
  const slotInner = roundedRectLoop(s.y, zOf(s.zBehind), s.len - 1.5, s.w - 1.1, (s.w - 1.1) / 2, 5);
  const slot: Recess = { loop: slotOuter, depth: 0.45, shade: [0.88, 0.7, 0.8], floor: true, inner: [{ loop: slotInner, depth: 1.4, shade: [0.7, 0.38, 0.36], floor: true }] };

  // top wall: 2 rows x 10 slots
  const c = SF.connector;
  const connector: Recess[] = [];
  for (const behind of c.rowsBehind)
    for (let i = 0; i < 10; i++) {
      const x = c.x + (i - 4.5) * c.pitch;
      connector.push({ loop: roundedRectLoop(x, zOf(behind), c.slotW, c.slotLen, 0.2, 3), depth: 1.4, shade: [0.6, 0.12, 0.05], floor: true });
    }
  return { windowLoop, windowRecess, grille, grilleCentres: holes, slot, connector };
}

/** Back features in body x/y (the back is a height field over y, see backProfile). */
export function backOpenings() {
  const db = BF.deboss;
  const deboss: Recess = { loop: roundedRectLoop(db.x, db.y, db.w, db.h, db.r, 6), depth: db.depth, shade: [0.9, 0.74, 0.9], floor: true };
  const pg = BF.pogo;
  const len = 4 * pg.pitch + pg.h;
  const pads: Pt[] = [];
  for (let i = 0; i < 5; i++) pads.push([pg.x + (2 - i) * pg.pitch, pg.y]); // first = towards +X (silver)
  const padHoles: Recess[] = pads.map(([x, y]) => ({ loop: circleLoop(x, y, pg.padD / 2 + SEAM_MM, 20), depth: 0.5, shade: [0.5, 0.15, 0.1], floor: false }));
  const pogo: Recess = { loop: roundedRectLoop(pg.x, pg.y, len, pg.h, pg.h / 2, 10), depth: pg.depth, shade: [0.86, 0.66, 0.84], floor: true, inner: padHoles };
  const sc = BF.screw;
  const screw: Recess = { loop: circleLoop(sc.x, sc.y, sc.d / 2 + SEAM_MM, 28), depth: sc.depth + 0.4, shade: [0.6, 0.2, 0.15], floor: false };
  return { deboss, pogo, pads, screw };
}
