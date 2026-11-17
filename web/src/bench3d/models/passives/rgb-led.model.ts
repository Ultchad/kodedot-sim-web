/**
 * RGB LED, common cathode (parts/rgb-led): a 5 mm LED with a diffused (milky) lens and four leads. Three dies share
 * the cup on the cathode's anvil; the lens mixes their light, so its colour is the sum of the three channels `r`, `g`
 * and `b` and its brightness that of the strongest.
 *
 * Dimensions: the T-1 3/4 body of led5.ts. The four leads leave the flange 1.27 mm apart and are fanned out to the
 * terminals' 2.54 mm grid (a breadboard) in the room the manifest gives under the body, then go straight down. The
 * common cathode is the long lead; the flange's flat is on the red lead's side.
 */
import type { Mesh, MeshStandardMaterial } from 'three';
import manifest from '../../../../../parts/rgb-led/manifest.json';
import { PAL, Shape, defineModel, footprintOf, glowing, halo, part, partState, setLamp, terminalsFromManifest, type PartState, type V2 } from '../../index';
import { asManifest, num, plate, squareLead, terminalOf, tint, visualColour } from './common';
import { LED_H, LEG_LONG, LEG_SHORT, lampLevel, lensShape, resinGlow } from './led5';

const m = asManifest(manifest);
const terminals = terminalsFromManifest(m);
const PINS = ['R', 'COM', 'G', 'B'].map((id) => terminalOf(terminals, id));
/** The flange's underside: the body stands as high as the manifest allows, the leads fan out under it. */
const Y0 = m.body.h_mm - LED_H - 0.1;
/** Where the fan starts above the seating plane, and where it ends under the flange. */
const FAN_0 = 1.0, FAN_1 = Y0 - 0.9;
/** Where each lead enters the resin, 1.27 mm apart, in the order of the terminals. */
const sense = Math.sign(PINS[3][0] - PINS[0][0]) || 1;
const ENTRY = [-1.905, -0.635, 0.635, 1.905].map((x) => x * sense);
const RED = visualColour(m, 'red', 0xff2a2a), GREEN = visualColour(m, 'green', 0x2aff4a), BLUE = visualColour(m, 'blue', 0x2a5aff);
const ch = (c: number, shift: number) => (c >> shift) & 255;

export default defineModel<PartState>({
  id: m.id,
  title: m.name.en,
  footprintMm: footprintOf(m.body),
  plugMm: LEG_LONG,
  terminals,
  build(ctx) {
    const s = new Shape();
    PINS.forEach((p, i) => {
      const xi = ENTRY[i], common = i === 1;
      // down into the board, flat along the seating plane to under the flange, up into the resin
      squareLead(s, p[0], p[2], common ? -LEG_LONG : -LEG_SHORT, FAN_0 + 0.05);
      plate(s, PAL.tin, [[p[0] - 0.25, FAN_0], [p[0] + 0.25, FAN_0], [xi + 0.25, FAN_1], [xi - 0.25, FAN_1]], p[2] - 0.25, p[2] + 0.25);
      squareLead(s, xi, p[2], FAN_1 - 0.05, Y0 + 0.2);
      if (common) {
        // the anvil: it carries the cup with the three dies on the lens's axis
        const a = Math.sign(xi) || -1;
        plate(s, PAL.tin, [[xi - 0.25 * a, Y0], [xi + 0.25 * a, Y0], [xi + 0.25 * a, Y0 + 3.2], [-0.42 * a, Y0 + 3.9], [-0.42 * a, Y0 + 4.9], [1.0 * a, Y0 + 4.9], [1.15 * a, Y0 + 4.3], [1.15 * a, Y0 + 3.0]].map(([x, y]) => [x, y] as V2), -0.25, 0.25);
      } else {
        const out = Math.sign(xi - ENTRY[1]) * 0.12; // the posts lean away from the anvil
        plate(s, PAL.tin, [[xi - 0.25, Y0], [xi + 0.25, Y0], [xi + 0.25, Y0 + 1.5], [xi + 0.3 + out, Y0 + 2.3], [xi + 0.3 + out, Y0 + 4.3], [xi - 0.3 + out, Y0 + 4.3], [xi - 0.3 + out, Y0 + 2.3], [xi - 0.25, Y0 + 1.5]], -0.25, 0.25);
        s.tube(...PAL.gold, [[(i - 1.5) * 0.14, Y0 + 5.15, 0.1], [xi * 0.35, Y0 + 5.75, 0.05], [xi * 0.8 + out, Y0 + 5.5, 0], [xi + out, Y0 + 4.3, 0]], 0.04, 4);
      }
    });
    s.lathe(...PAL.tin, 0, 0, [[0.55, Y0 + 4.88], [0.85, Y0 + 5.42], [0.7, Y0 + 5.42], [0.45, Y0 + 5.06], [0, Y0 + 5.06]], 10);
    const root = s.toObject();
    const lens = lensShape({ y: Y0, resin: PAL.resinWhite, seg: ctx.seg(20), flat: sense > 0 ? -1 : 1 });
    // the three dies, side by side in the cup
    for (const [x, z, c] of [[-0.2, 0.14, '#8a3a36'], [0.2, 0.14, '#3a7a4a'], [0, -0.2, '#3a4a8a']] as const) lens.box('gloss', c, x, z, 0.26, 0.26, Y0 + 5.06, Y0 + 5.18, 0.02, 0.03, { ao: 1 });
    const dome = glowing('dome', lens);
    // diffused resin: milky, the lead frame only a shadow inside (the materials of a glowing part are its own)
    for (const c of dome.children) {
      const mat = (c as Mesh).material as MeshStandardMaterial;
      if (mat.transparent) mat.opacity = 0.86;
    }
    // the light it throws on the board between its leads
    root.add(dome, halo('halo', [0, 0.03, 0], m.body.d_mm / 2 + 0.2));
    return root;
  },
  animate(st, obj) {
    const on = st.power.on;
    const r = on ? Math.min(1, Math.max(0, num(st.outputs.r, 0))) : 0;
    const g = on ? Math.min(1, Math.max(0, num(st.outputs.g, 0))) : 0;
    const b = on ? Math.min(1, Math.max(0, num(st.outputs.b, 0))) : 0;
    const peak = Math.max(r, g, b);
    const dome = part(obj, 'dome')!;
    if (peak < 0.004) {
      tint(dome, 0xffffff);
      setLamp(obj, 'dome', 0, 0);
      setLamp(obj, 'halo', 0, 0);
      return;
    }
    // the lens adds the three lights; the hue is kept pure and the strongest channel sets the level
    const R = r * ch(RED, 16) + g * ch(GREEN, 16) + b * ch(BLUE, 16);
    const G = r * ch(RED, 8) + g * ch(GREEN, 8) + b * ch(BLUE, 8);
    const B = r * ch(RED, 0) + g * ch(GREEN, 0) + b * ch(BLUE, 0);
    const k = 255 / Math.max(R, G, B, 1);
    const level = lampLevel(peak);
    const hex = (Math.round(R * k) << 16) | (Math.round(G * k) << 8) | Math.round(B * k);
    // the milky resin takes the light's colour (else its white washes every colour out to a pastel)
    const w = 255 * Math.max(0, 1 - level * 1.25), q = 1 - w / 255;
    tint(dome, (Math.round(w + R * k * q) << 16) | (Math.round(w + G * k * q) << 8) | Math.round(w + B * k * q));
    setLamp(obj, 'dome', resinGlow(hex), level);
    setLamp(obj, 'halo', hex, level);
  },
  states: {
    off: partState({ outputs: { r: 0, g: 0, b: 0 } }),
    red: partState({ outputs: { r: 1, g: 0, b: 0 } }),
    green: partState({ outputs: { r: 0, g: 1, b: 0 } }),
    blue: partState({ outputs: { r: 0, g: 0, b: 1 } }),
    yellow: partState({ outputs: { r: 1, g: 0.8, b: 0 } }),
    cyan: partState({ outputs: { r: 0, g: 1, b: 1 } }),
    magenta: partState({ outputs: { r: 1, g: 0, b: 1 } }),
    white: partState({ outputs: { r: 1, g: 1, b: 1 } }),
    'dim-orange': partState({ outputs: { r: 0.25, g: 0.06, b: 0 } }),
  },
});
