/**
 * Builders of the ESP32 family that the shared kit (parts.ts) does not have yet: a header soldered pins-down (the
 * board rides on its housing and plugs into a breadboard), the radio module with its antenna end, the small SMD
 * parts of a dev board. Millimetres, same conventions as parts.ts (`turn` = quarter turns clockwise seen from above).
 * Candidates for the kit: `legRow`, `radioModule`, `smdButton`, `chip`, `sot23`, `sot223`, `sod123`, `ledChip`,
 * `rgbLed` and `faces` (upright flat marks; lying ones are the kit's `Shape.rect`).
 */
import { PAL, PITCH, Shape, place, type Finish, type V3 } from '../../index';

type MeshData = Parameters<Shape['add']>[2];
/**
 * Flat faces without the solid behind them: each quad is four corners, wound to look along `facing`. For marks a few
 * hundredths thick (a trace under the mask, the plating of a pad), where a prism would spend its triangles on walls
 * nobody can see.
 */
export function faces(s: Shape, finish: Finish, quads: readonly (readonly [V3, V3, V3, V3])[], facing: V3 = [0, 1, 0], shade = 1): void {
  const n = quads.length;
  const m: MeshData = { positions: new Float32Array(n * 12), normals: new Float32Array(n * 12), colors: new Float32Array(n * 12).fill(shade), uvs: new Float32Array(n * 8), indices: new Uint32Array(n * 6) };
  quads.forEach((q, i) => {
    const [a, b, c] = q;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const flip = (uy * vz - uz * vy) * facing[0] + (uz * vx - ux * vz) * facing[1] + (ux * vy - uy * vx) * facing[2] < 0;
    q.forEach((p, k) => {
      m.positions.set(p, i * 12 + k * 3);
      m.normals.set(facing, i * 12 + k * 3);
    });
    m.indices.set(flip ? [0, 2, 1, 0, 3, 2].map((k) => i * 4 + k) : [0, 1, 2, 0, 2, 3].map((k) => i * 4 + k), i * 6);
  });
  s.add(finish[0], finish[1], m);
}

interface At {
  x: number;
  z: number;
  /** Top face of the board. */
  y: number;
  turn?: number;
}

/** Body colours of chip passives: thick-film resistors are black, ceramic capacitors tan. */
export const RES: Finish = ['matte', '#1c1c1f'];
/** Moulded chip packages: a shade lighter than the black solder mask they sit on, as epoxy is. */
export const EPOXY: Finish = ['matte', '#232327'];
export const MLCC: Finish = ['matte', '#94734a'];

/**
 * A male header soldered pins-DOWN through a board, one pin per point (x, z): the housing hangs under the board from
 * the seating plane y = 0 up to the board's underside, the legs reach `plug` below it, and each pin ends in a solder
 * fillet on the board's top face. Lean on purpose (56 triangles a pin): a dev board has dozens.
 */
export function legRow(s: Shape, pts: readonly V3[], o: { under: number; top: number; plug: number; seg: number }): void {
  for (const [x, , z] of pts) {
    // the housing's top is hidden by the board: no bevel there
    s.box(...PAL.plasticBlack, x, z, PITCH - 0.12, PITCH - 0.12, 0, o.under, 0, 0, { ao: 0.72 });
    s.box(...PAL.gold, x, z, 0.64, 0.64, -o.plug, 0.2, 0, 0, { cap: true, ao: 0.82 });
    s.disc(...PAL.tin, x, z, 0.82, o.top, o.top + 0.72, 0.5, o.seg, { ao: 0.86 });
  }
}

export interface RadioModuleOptions {
  /** The antenna end (the module points its antenna at -X). */
  x: number;
  z: number;
  /** Top face of the carrier board. */
  y: number;
  len?: number;
  wid?: number;
  /** Length of the antenna end that the shield does not cover. */
  ant?: number;
  canH?: number;
  /** Castellated pads on each long edge, and on the end opposite the antenna. */
  sidePads?: number;
  endPads?: number;
  /** Teeth of the printed meander. */
  teeth?: number;
}
export interface RadioModuleOut {
  /** Top face of the shield, its centre and half sizes (for the marking print). */
  canTop: number;
  canX: number;
  canZ: number;
  canHalfLen: number;
  canHalfWid: number;
}
/**
 * A Wi-Fi module of the WROOM kind (18 x 25.5 x 3.1 mm): its own thin black board, a drawn shield can with a stepped
 * rim, gold castellations on three edges and the meander antenna (a trace under the solder mask) at the end the can
 * leaves bare. Lies along X with the antenna at -X.
 */
export function radioModule(s: Shape, o: RadioModuleOptions): RadioModuleOut {
  const len = o.len ?? 25.5, wid = o.wid ?? 18, ant = o.ant ?? 6.2, canH = o.canH ?? 2.3;
  const y0 = o.y, y1 = o.y + 0.8;
  s.box(...PAL.pcbBlack, o.x + len / 2, o.z, len, wid, y0, y1, 0.35, 0.08, { cap: true, ao: 0.92 });
  // the shield: a soldered rim, then the drawn can a step inside it
  const canLen = len - ant - 1.4, canWid = wid - 2.0;
  const canX = o.x + ant + 0.7 + canLen / 2;
  s.box(...CAN, canX, o.z, canLen, canWid, y1, y1 + 0.45, 0.5, 0.12, { ao: 0.8 });
  s.box(...CAN, canX, o.z, canLen - 0.5, canWid - 0.5, y1 + 0.45, y1 + canH, 1.0, 0.38, { ao: 0.86 });
  // castellations: half-holes plated in gold, seen on the edge and on top (plating only: faces, not solids)
  const nSide = o.sidePads ?? 14, nEnd = o.endPads ?? 10;
  const yp = y1 + 0.03;
  for (const side of [-1, 1]) {
    const edge: [V3, V3, V3, V3][] = [];
    const ze = o.z + side * (wid / 2 + 0.03);
    for (let i = 0; i < nSide; i++) {
      const px = o.x + len - 1.5 - i * 1.27;
      s.rect(...PAL.gold, px, ze - side * 0.4, 0.72, 0.8, yp);
      edge.push([[px - 0.36, y0 + 0.04, ze], [px + 0.36, y0 + 0.04, ze], [px + 0.36, yp, ze], [px - 0.36, yp, ze]]);
    }
    faces(s, PAL.gold, edge, [0, 0, side], 0.9);
  }
  const end: [V3, V3, V3, V3][] = [];
  const xe = o.x + len + 0.03;
  for (let i = 0; i < nEnd; i++) {
    const pz = o.z + (i - (nEnd - 1) / 2) * 1.27;
    s.rect(...PAL.gold, xe - 0.4, pz, 0.8, 0.72, yp);
    end.push([[xe, y0 + 0.04, pz - 0.36], [xe, y0 + 0.04, pz + 0.36], [xe, yp, pz + 0.36], [xe, yp, pz - 0.36]]);
  }
  faces(s, PAL.gold, end, [1, 0, 0], 0.9);
  // the antenna: feed and short at one side, then a square meander across the width
  const teeth = o.teeth ?? 5;
  const uNear = 1.0, uFar = ant - 1.9, v0 = -wid / 2 + 2.3, step = (wid - 3.6) / (2 * teeth);
  const pts: [number, number][] = [[ant + 0.3, v0 - 1.1], [uNear, v0 - 1.1], [uNear, v0], [ant + 0.3, v0], [uNear, v0]];
  let v = v0, near = true;
  for (let i = 0; i < 2 * teeth; i++) {
    v += step;
    pts.push([near ? uNear : uFar, v]);
    near = !near;
    if (i < 2 * teeth - 1) pts.push([near ? uNear : uFar, v]);
  }
  for (let i = 1; i < pts.length; i++) {
    const [u1, w1] = pts[i - 1], [u2, w2] = pts[i];
    s.rect(...ANTENNA, o.x + (u1 + u2) / 2, o.z + (w1 + w2) / 2, Math.abs(u2 - u1) + 0.52, Math.abs(w2 - w1) + 0.52, y1 + 0.03);
  }
  // the matching network between the can and the feed
  chip(s, { x: o.x + ant - 0.25, z: o.z + v0 + 2.2, y: y1, len: 1.0, wid: 0.5, h: 0.35, body: MLCC, turn: 1 });
  chip(s, { x: o.x + ant - 0.25, z: o.z + v0 + 3.6, y: y1, len: 1.0, wid: 0.5, h: 0.35, body: MLCC, turn: 1 });
  return { canTop: y1 + canH, canX, canZ: o.z, canHalfLen: (canLen - 0.5) / 2, canHalfWid: (canWid - 0.5) / 2 };
}
/** Copper under black solder mask, as the antenna trace of a module shows: a shade off the board, no more. */
const ANTENNA: Finish = ['pcb', '#3a362c'];
/** The shield of a module: satin nickel silver, duller than fresh solder. */
const CAN: Finish = ['metal', '#9fa3a9'];

/** A chip resistor or capacitor (0603 by default) lying along X: tinned ends, coloured body. */
export function chip(s: Shape, o: At & { len?: number; wid?: number; h?: number; body?: Finish }): void {
  const len = o.len ?? 1.6, wid = o.wid ?? 0.8, h = o.h ?? 0.5;
  s.with(place(o.x, o.y, o.z, o.turn), () => {
    s.box(...PAL.tin, 0, 0, len, wid, 0, h * 0.9, 0, 0.08, { ao: 0.9 });
    s.box(...(o.body ?? RES), 0, 0, len * 0.56, wid + 0.03, 0, h, 0, 0.08, { ao: 0.9 });
  });
}

/** SOT-23: two leads towards +Z, one towards -Z. */
export function sot23(s: Shape, o: At): void {
  s.with(place(o.x, o.y, o.z, o.turn), () => {
    s.box(...EPOXY, 0, 0, 2.9, 1.3, 0.1, 1.05, 0.12, 0.18, { ao: 0.95 });
    for (const [x, z] of [[-0.95, 0.9], [0.95, 0.9], [0, -0.9]]) s.box(...PAL.tin, x, z, 0.42, 0.62, 0, 0.5, 0, 0, { ao: 0.9 });
  });
}
/** SOT-223 regulator: three leads towards +Z, the heat tab towards -Z. */
export function sot223(s: Shape, o: At): void {
  s.with(place(o.x, o.y, o.z, o.turn), () => {
    s.box(...EPOXY, 0, 0, 6.5, 3.5, 0.08, 1.7, 0.25, 0.3, { ao: 0.95 });
    for (const i of [-1, 0, 1]) s.box(...PAL.tin, i * 2.3, 2.6, 0.75, 1.75, 0, 0.8, 0, 0.1, { ao: 0.9 });
    s.box(...PAL.tin, 0, -2.6, 3.05, 1.75, 0, 0.8, 0, 0.1, { ao: 0.9 });
  });
}
/** SOD-123 diode along X, the cathode bar at +X. */
export function sod123(s: Shape, o: At): void {
  s.with(place(o.x, o.y, o.z, o.turn), () => {
    s.box(...PAL.tin, 0, 0, 3.7, 0.7, 0, 0.55, 0, 0.08, { ao: 0.9 });
    s.box(...EPOXY, 0, 0, 2.7, 1.6, 0.05, 1.15, 0.12, 0.18, { ao: 0.95 });
    s.box('matte', '#9a9ca3', 0.85, 0, 0.42, 1.5, 1.15, 1.17, 0, 0, { ao: 1 });
  });
}

/**
 * The small SMD tactile switch of a dev board (4.2 x 3.2 x 2.2 mm): a stamped metal cover on a black base, a low
 * round plunger, two solder tabs at the ends (along X before `turn`).
 */
export function smdButton(s: Shape, o: At & { seg?: number; cap?: Finish; noPlunger?: boolean }): void {
  s.with(place(o.x, o.y, o.z, o.turn), () => {
    s.box(...PAL.plasticBlack, 0, 0, 4.2, 3.2, 0, 0.9, 0.25, 0.1, { ao: 0.85 });
    s.box(...PAL.steel, 0, 0, 4.0, 3.0, 0.9, 1.6, 0.35, 0.18, { ao: 0.92 });
    for (const sx of [-1, 1]) s.box(...PAL.tin, sx * 2.45, 0, 0.9, 1.5, 0, 0.55, 0, 0.08, { ao: 0.9 });
  });
  if (!o.noPlunger) smdPlunger(s, o);
}
/** The plunger of `smdButton` alone: into the body, or into a Shape of its own when the switch is a control. */
export function smdPlunger(s: Shape, o: At & { seg?: number; cap?: Finish }): void {
  s.disc(...(o.cap ?? PAL.plasticBlack), o.x, o.z, 0.9, o.y + 1.6, o.y + 2.2, 0.16, o.seg ?? 10, { ao: 0.85 });
}

/**
 * A chip LED lying along X: the solder ends go into `s` (static); the returned Shape is its lens, for `glowing()`.
 * Drawn a size up (0805) so that it reads from the bench camera.
 */
export function ledChip(s: Shape, o: At & { len?: number; wid?: number; lens?: Finish }): Shape {
  const len = o.len ?? 2.0, wid = o.wid ?? 1.25;
  const lens = new Shape();
  const m = place(o.x, o.y, o.z, o.turn);
  s.with(m, () => s.box(...PAL.tin, 0, 0, len, wid, 0, 0.5, 0, 0.08, { ao: 0.9 }));
  lens.with(m, () => lens.box(...(o.lens ?? LENS), 0, 0, len * 0.66, wid + 0.04, 0, 0.75, 0.2, 0.22, { ao: 0.95 }));
  return lens;
}
/** The milky lens of an unlit chip LED. */
export const LENS: Finish = ['gloss', '#e6e1d0'];
/**
 * The lens of an LED of a known colour (0xRRGGBB), unlit: tinted resin, dark enough that the light `setLamp` adds
 * keeps its hue instead of washing out to white.
 */
export function lensOf(colour: number): Finish {
  const c = [colour >> 16, (colour >> 8) & 255, colour & 255].map((v) => Math.round(v * 0.42 + 26).toString(16).padStart(2, '0'));
  return ['gloss', `#${c.join('')}`];
}

/**
 * An addressable RGB LED in its square white package: body and leads go into `s`; the returned Shape is the round
 * window over the dies, for `glowing()`.
 */
export function rgbLed(s: Shape, o: At & { size?: number; seg?: number }): Shape {
  const sz = o.size ?? 3.0;
  const lens = new Shape();
  const m = place(o.x, o.y, o.z, o.turn);
  s.with(m, () => {
    s.box(...PAL.plasticWhite, 0, 0, sz, sz, 0.05, 1.2, 0.25, 0.14, { ao: 0.9 });
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1]) s.box(...PAL.tin, sx * (sz / 2 + 0.1), sz2 * sz * 0.27, 0.5, 0.7, 0, 0.5, 0, 0, { ao: 0.9 });
  });
  lens.with(m, () => lens.disc('gloss', '#a3a19a', 0, 0, sz * 0.39, 1.2, 1.3, 0.08, o.seg ?? 14, { ao: 1 }));
  return lens;
}
