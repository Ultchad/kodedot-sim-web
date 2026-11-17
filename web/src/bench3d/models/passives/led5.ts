/**
 * The 5 mm round LED (T-1 3/4) of the parts library, one builder for every colour and for the LED with its resistor.
 * Same approach as the kit's reference (models/reference/led-5mm.model.ts): leads and lead frame are the static body,
 * the resin body is a `glowing` part lit with `setLamp`.
 *
 * Dimensions (the usual T-1 3/4 drawing, e.g. Kingbright L-53 series): lens 5.0 mm, flange 5.8 x 1.0 mm with a flat
 * on the cathode side, 8.6 mm from the seating plane to the top, square leads 0.5 mm at 2.54 mm, the anode lead the
 * longer one. Inside the resin: the cathode's anvil with its reflector cup and the die, the anode's post, a bond wire.
 */
import {
  PAL, Shape, circleLoop, defineModel, footprintOf, glowing, part, partState, setLamp, terminalsFromManifest,
  type AnimEnv, type BuildCtx, type Finish, type Object3D, type PartModel, type PartState, type Pt, type V2, type V3,
} from '../../index';
import { asManifest, halo, plate, ribbon, setHalo, show, squareLead, terminalOf, tint, visualColour, type PartManifest } from './common';

export const LENS_R = 2.5;
export const FLANGE_R = 2.9;
export const FLANGE_H = 1.0;
export const LED_H = 8.6;
/** How far the leads reach below the seating plane: the anode, and the shorter cathode. */
export const LEG_LONG = 7;
export const LEG_SHORT = 5.6;

/**
 * The resin body: flange (with a flat towards `flat`, +1 = +X, -1 = -X, 0 = none) and the domed lens, standing on
 * height `y`. A Shape of its own, to hand to `glowing()`.
 */
export function lensShape(o: { y: number; resin: Finish; seg: number; flat?: 1 | -1 | 0; h?: number }): Shape {
  const s = new Shape();
  const [fam, col] = o.resin;
  const flat = o.flat ?? 1;
  const edge = LENS_R + 0.08;
  const loop = circleLoop(0, 0, FLANGE_R, o.seg).map(([x, z]) => [flat > 0 ? Math.min(x, edge) : flat < 0 ? Math.max(x, -edge) : x, z] as Pt);
  s.prism(fam, col, loop, o.y, o.y + FLANGE_H, 0.14, { cap: true, ao: 0.92 });
  const straight = (o.h ?? LED_H) - FLANGE_H - LENS_R;
  const prof: V2[] = [[LENS_R, o.y + FLANGE_H], [LENS_R, o.y + FLANGE_H + straight]];
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    prof.push([LENS_R * Math.cos(a), o.y + FLANGE_H + straight + LENS_R * Math.sin(a)]);
  }
  s.lathe(fam, col, 0, 0, prof, o.seg);
  return s;
}

/** A point of the lens's surface and its normal: `a` round the axis (0 = +X, towards +Z), `y` above the flange's underside. */
function onLens(a: number, y: number, h = LED_H): { p: V3; n: V3 } {
  const yc = h - LENS_R;
  const dy = Math.max(0, y - yc);
  const r = Math.sqrt(Math.max(0.01, LENS_R * LENS_R - dy * dy));
  const n: V3 = [(Math.cos(a) * r) / LENS_R, dy / LENS_R, (Math.sin(a) * r) / LENS_R];
  return { p: [Math.cos(a) * r, y, Math.sin(a) * r], n };
}
/** A crack through the lens along `pts` ([degrees round the axis, height above the flange's underside at `y0`]), pointed at its end. */
function crack(s: Shape, colour: string, pts: V2[], y0: number, w0: number, lift: number, shift = 0): void {
  const at = pts.map(([deg, y]) => {
    const q = onLens((deg * Math.PI) / 180, y);
    return { p: [q.p[0], q.p[1] + y0, q.p[2]] as V3, n: q.n };
  });
  ribbon(s, ['matte', colour], at, w0, w0 * 0.2, lift, shift);
}
const CRACKS: { pts: V2[]; w: number }[] = [
  { pts: [[58, 1.05], [66, 2.1], [55, 3.2], [64, 4.3], [53, 5.4], [61, 6.5], [48, 7.5], [60, 8.25]], w: 0.3 },
  { pts: [[55, 3.2], [41, 3.8], [34, 4.8], [22, 5.3]], w: 0.2 },
  { pts: [[64, 4.3], [79, 4.9], [86, 6.0], [99, 6.6]], w: 0.2 },
  { pts: [[232, 1.05], [241, 2.4], [228, 3.6], [240, 4.9], [231, 6.2], [246, 7.4]], w: 0.28 },
  { pts: [[228, 3.6], [212, 4.3], [204, 5.4]], w: 0.18 },
  { pts: [[150, 1.05], [143, 2.3], [154, 3.5], [146, 4.6]], w: 0.22 },
  { pts: [[322, 1.05], [330, 2.5], [319, 3.7], [327, 5.0]], w: 0.22 },
];
/** What a burnt-out LED shows on top of its darkened resin: cracks through the lens and a charred core. Hidden until burnt. */
export function burntMarks(y: number): Object3D {
  const s = new Shape();
  for (const c of CRACKS) {
    crack(s, '#0d0a09', c.pts, y, c.w, 0.05);
    crack(s, '#e9e2da', c.pts, y, c.w * 0.3, 0.06, c.w * 0.6); // the light caught in the fracture
  }
  // soot round the die, seen through the resin
  s.lathe('soft', '#0e0c0b', 0, 0, [[0, y + 4.3], [0.9, y + 4.5], [1.25, y + 5.2], [1.0, y + 6.1], [0.45, y + 6.7], [0, y + 6.8]], 8);
  const g = s.toObject('burnt');
  g.visible = false;
  return g;
}

export interface LedLook {
  /** The tinted epoxy. */
  resin: Finish;
  /** The light's colour, 0xRRGGBB. */
  lit: number;
  /** What sits in the cup: a bare die, or the yellow phosphor of a white LED. */
  phosphor?: boolean;
}

/**
 * The static body of a two-lead LED: leads at the terminals `a` (anode, the long one) and `k`, and the lead frame
 * inside the resin. `y` is the flange's underside.
 */
export function ledFrame(s: Shape, a: V3, k: V3, y = 0): void {
  const ax = a[0], kx = k[0];
  squareLead(s, ax, a[2], -LEG_LONG, y + 1.7);
  squareLead(s, kx, k[2], -LEG_SHORT, y + 1.7);
  const dir = Math.sign(kx - ax) || 1; // +1: cathode on +X
  const X = (v: number) => v * dir;
  // the anode's post
  plate(s, PAL.tin, [[X(-1.52), y + 1.5], [X(-2.0), y + 2.15], [X(-2.0), y + 4.0], [X(-1.75), y + 4.3], [X(-1.0), y + 4.3], [X(-1.0), y + 2.15], [X(-1.02), y + 1.5]], -0.25, 0.25);
  // the cathode's anvil, reaching the axis, where the cup is
  plate(s, PAL.tin, [[X(1.02), y + 1.5], [X(-0.2), y + 3.3], [X(-0.7), y + 3.9], [X(-0.7), y + 4.9], [X(1.35), y + 4.9], [X(2.05), y + 4.2], [X(2.05), y + 2.15], [X(1.52), y + 1.5]], -0.25, 0.25);
  // the reflector cup, pressed into the anvil's head
  s.lathe(...PAL.tin, 0, 0, [[0.5, y + 4.88], [0.78, y + 5.42], [0.64, y + 5.42], [0.36, y + 5.06], [0, y + 5.06]], 10);
  // the bond wire from the die over to the post
  s.tube(...PAL.gold, [[0, y + 5.16, 0], [X(-0.28), y + 5.72, 0], [X(-0.8), y + 5.78, 0], [X(-1.25), y + 5.2, 0], [X(-1.4), y + 4.3, 0]], 0.045, 4);
}
/** The die in its cup (it belongs to the glowing part: it is where the light comes from). */
export function ledDie(s: Shape, y: number, phosphor = false): void {
  if (phosphor) s.lathe('gloss', '#e9c63c', 0, 0, [[0.36, y + 5.06], [0.33, y + 5.22], [0.2, y + 5.33], [0, y + 5.36]], 8);
  else s.box('gloss', '#4a4a52', 0, 0, 0.34, 0.34, y + 5.06, y + 5.2, 0.02, 0.03, { ao: 1 });
}

const BURNT_TINT = 0x4b3b33;
/** The colours of an overload, whatever the LED's own: the die white-hot, an orange warning glow round the body. */
const WHITE_HOT = 0xfff3d2;
const WARNING = 0xff5a14;
/** `setLamp` level of a brightness 0..1: the eye's curve, so a dim LED is visibly on. */
export const lampLevel = (b: number): number => (b > 0.004 ? 0.12 + 0.88 * Math.pow(Math.min(1, b), 0.7) : 0);
/** The glare of an overloaded LED: its own colour washed out towards white-hot. */
export const hotColour = (lit: number): number => {
  const mix = (c: number, to: number) => Math.round(c + (to - c) * 0.5);
  return (mix((lit >> 16) & 255, 255) << 16) | (mix((lit >> 8) & 255, 196) << 8) | mix(lit & 255, 130);
};
/** The white-hot core of an overloaded LED, round the die: a glowing part of its own, hidden until then. */
export function hotCore(y: number): Object3D {
  const s = new Shape();
  s.lathe('gloss', '#fff6e0', 0, 0, [[0, y + 4.35], [0.7, y + 4.6], [1.05, y + 5.3], [0.8, y + 6.0], [0, y + 6.3]], 8);
  const g = glowing('core', s);
  g.visible = false;
  return g;
}
/**
 * Shows an LED's live state on one copy (`dome`, `core`, `halo` and `burnt` are its named parts): brightness with its
 * bloom, the overload (a white-hot core seen through the resin, a wide orange warning glow, all of it unsteady), the
 * dead look of a burnt-out one.
 */
export function animateLed(st: PartState, obj: Object3D, env: AnimEnv, lit: number, hot: number): boolean | void {
  const dome = part(obj, 'dome')!;
  const o = st.outputs;
  if (o.burnt) {
    // burnt out: the resin smoked dark, cracked, a charred core
    show(obj, 'burnt', true);
    show(obj, 'core', false);
    setHalo(obj, 'halo', 0, 0, 1);
    dome.scale.setScalar(1);
    tint(dome, BURNT_TINT);
    setLamp(obj, 'dome', 0x0b0605, 0.8);
    return;
  }
  show(obj, 'burnt', false);
  tint(dome, 0xffffff);
  if (o.overcurrent && st.power.on) {
    const flick = Math.sin(env.time * 47), heave = Math.sin(env.time * 31);
    // the resin stays half clear so the white-hot die shows through it
    setLamp(obj, 'dome', hot, 0.5 + 0.12 * flick);
    show(obj, 'core', true);
    setLamp(obj, 'core', WHITE_HOT, 3.4 + 0.6 * flick);
    setHalo(obj, 'halo', WARNING, 0.78 + 0.16 * flick, 21 + 2.5 * heave);
    dome.scale.setScalar(1 + 0.035 * heave);
    return true;
  }
  show(obj, 'core', false);
  dome.scale.setScalar(1);
  const level = st.power.on ? lampLevel(Number(o.brightness ?? 0)) : 0;
  setLamp(obj, 'dome', lit, level);
  setHalo(obj, 'halo', lit, level * 0.5, 9 + 6 * level);
}

export const LED_STATES: Record<string, PartState> = {
  off: partState({ outputs: { brightness: 0 } }),
  dim: partState({ outputs: { brightness: 0.12, current_ma: 1.2 } }),
  on: partState({ outputs: { brightness: 1, current_ma: 10 } }),
  overcurrent: partState({ outputs: { brightness: 1, current_ma: 41, overcurrent: true } }),
  burnt: partState({ outputs: { brightness: 0, current_ma: 0, burnt: true } }),
};

/** The whole static body and the glowing lens of a plain two-lead LED, as a model's root. */
export function buildLed(ctx: BuildCtx, a: V3, k: V3, look: LedLook, more?: (s: Shape) => void): Object3D {
  const s = new Shape();
  ledFrame(s, a, k);
  more?.(s);
  const root = s.toObject();
  const lens = lensShape({ y: 0, resin: look.resin, seg: ctx.seg(20), flat: k[0] >= a[0] ? 1 : -1 });
  ledDie(lens, 0, look.phosphor);
  root.add(hotCore(0), glowing('dome', lens), burntMarks(0), halo('halo', [0, 4.9, 0]));
  return root;
}

/** The model of a 5 mm LED of one colour, from its manifest: the five colours of the library differ only in `look`. */
export function ledModel(manifestJson: unknown, look: Omit<LedLook, 'lit'> & { lit?: number }): PartModel<PartState> {
  const manifest: PartManifest = asManifest(manifestJson);
  const terminals = terminalsFromManifest(manifest);
  const lit = look.lit ?? visualColour(manifest, 'glow', 0xff3b30);
  const hot = hotColour(lit);
  return defineModel<PartState>({
    id: manifest.id,
    title: manifest.name.en,
    footprintMm: footprintOf(manifest.body),
    plugMm: LEG_LONG,
    terminals,
    build: (ctx) => buildLed(ctx, terminalOf(terminals, 'A'), terminalOf(terminals, 'K'), { ...look, lit }),
    animate: (st, obj, env) => animateLed(st, obj, env, lit, hot),
    states: LED_STATES,
  });
}
