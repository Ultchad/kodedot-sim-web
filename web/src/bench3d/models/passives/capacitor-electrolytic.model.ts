/**
 * Electrolytic capacitor (parts/capacitor-electrolytic): a 6.3 mm radial can in its sleeve, standing on its two leads
 * 2.54 mm apart. The light stripe with the minus signs is on the negative lead's side, the positive lead is the long
 * one, the top carries the scored vent. The sleeve's print follows the part's `uf` field.
 *
 * Hazards: wired backwards (`reversed`) the top swells; `burst` it has opened along the vent, the petals stand up
 * round a black hole, electrolyte has run down the sleeve.
 * Dimensions: a 6.3 x 11 mm can; the manifest's height leaves 0.4 mm above it for the swollen top.
 */
import { MeshBuilder } from '../../../device3d/meshBuilder';
import manifest from '../../../../../parts/capacitor-electrolytic/manifest.json';
import { FONT, Matrix4, PAL, Shape, defineModel, drawScreen, footprintOf, part, partState, terminalsFromManifest, text, type Finish, type Object3D, type PartState, type V3 } from '../../index';
import { microfarads } from './codes';
import { asManifest, asSeen, fieldDefault, num, ribbon, screenOnCylinder, show, stripSize, terminalOf, type CylinderStrip } from './common';

const m = asManifest(manifest);
const terminals = terminalsFromManifest(m);
const POS = terminalOf(terminals, 'POS'), NEG = terminalOf(terminals, 'NEG');
const UF = fieldDefault(m, 'uf', 100);
const VOLTS = `${Math.round(Number(m.behaviour?.elements?.[0]?.max_mv ?? 25000) / 1000)}V`;
const INK = m.visuals?.find((v) => v.id === 'value')?.color ?? '#e8eef5';
/** The sleeve (a candidate for PAL: sleeveBlue), its stripe and what is printed on the stripe. */
const SLEEVE: Finish = ['gloss', asSeen('#1d3a6e')];
const STRIPE: Finish = ['matte', asSeen('#d3d9e0')];
const R = 3.15, TOP = 11;
const LEG_LONG = 7, LEG_SHORT = 5.6;
/** The stripe looks towards the negative lead. */
const NEG_AT = NEG[0] >= POS[0] ? 0 : Math.PI;
/** The value is printed on the front (+Z), turned a little away from the stripe. */
const LABEL_AT = Math.PI / 2 + (NEG_AT ? 0.14 : -0.14);
const LABEL: CylinderStrip = { o: [0, 0, 0], axis: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], r: R, a0: LABEL_AT - 0.74, a1: LABEL_AT + 0.74, t0: 2.7, t1: TOP - 0.47, reads: 'arc', seg: 8 };
const [LABEL_W, LABEL_H] = stripSize(LABEL);
const SPOKES = [Math.PI / 2, Math.PI / 2 + (Math.PI * 2) / 3, Math.PI / 2 + (Math.PI * 4) / 3];

// drawn per copy: the value and the burst come with the state
let value = UF, leaked = false;
function drawLabel(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.setTransform(w / LABEL_W, 0, 0, w / LABEL_W, w / 2, h / 2); // millimetres from the middle of the label
  g.fillStyle = INK;
  const s = microfarads(value);
  // the longer the value, the smaller it is printed
  const size = Math.min(1.6, (LABEL_W - 0.5) / (s.length * 0.6));
  text(g, s, 0, -0.75, size, { weight: 700, font: FONT });
  text(g, VOLTS, 0, 1.2, 1.3, { weight: 700, font: FONT });
  text(g, '105°C', 0, 2.85, 0.75, { weight: 600, font: FONT });
  g.fillRect(-LABEL_W / 2 + 0.4, 0.2, LABEL_W - 0.8, 0.1);
  if (leaked) drawLeak(g, -LABEL_H / 2);
}
/**
 * Electrolyte that came over the shoulder and ran down the front of the sleeve, over the print: one wet stain whose
 * lower edge sags into runs of different length and width, each ending in a round drop. `t` is the label's top edge.
 */
function drawLeak(g: CanvasRenderingContext2D, t: number): void {
  g.beginPath();
  g.moveTo(-2.0, t - 0.1);
  g.lineTo(2.05, t - 0.1);
  g.bezierCurveTo(2.1, t + 0.5, 1.78, t + 0.7, 1.72, t + 1.2);
  g.bezierCurveTo(1.7, t + 2.3, 1.76, t + 2.92, 1.46, t + 2.95); // a short run on the right
  g.bezierCurveTo(1.14, t + 2.9, 1.3, t + 1.5, 1.06, t + 1.22);
  g.bezierCurveTo(0.92, t + 1.08, 0.86, t + 1.3, 0.82, t + 1.9);
  g.bezierCurveTo(0.8, t + 3.4, 1.0, t + 5.3, 0.44, t + 5.4); // the long one, with its drop
  g.bezierCurveTo(-0.1, t + 5.3, 0.14, t + 3.4, 0.06, t + 1.7);
  g.bezierCurveTo(0.02, t + 1.2, -0.26, t + 1.08, -0.42, t + 1.36);
  g.bezierCurveTo(-0.52, t + 1.9, -0.46, t + 2.42, -0.76, t + 2.46); // a small one
  g.bezierCurveTo(-1.04, t + 2.4, -0.92, t + 1.5, -1.12, t + 1.0);
  g.bezierCurveTo(-1.3, t + 0.66, -1.8, t + 0.8, -2.0, t - 0.1);
  g.closePath();
  g.fillStyle = '#4a2e16';
  g.fill();
  g.lineWidth = 0.09;
  g.strokeStyle = 'rgba(24, 12, 4, 0.55)';
  g.stroke();
  // wet: a light catching along each run and on the drops
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255, 226, 180, 0.3)';
  g.lineWidth = 0.1;
  for (const [x, y0, y1] of [[0.62, 1.5, 4.6], [1.56, 1.3, 2.5], [-0.66, 1.5, 2.1], [-1.5, 0.15, 0.5], [0.3, 0.15, 0.9]]) {
    g.beginPath();
    g.moveTo(x, t + y0);
    g.lineTo(x, t + y1);
    g.stroke();
  }
}

/** The swollen top, as a part of its own standing on the can's rim (its height is animated). */
const BULGE: [number, number][] = [[R - 0.5, 0], [2.25, 0.3], [1.3, 0.5], [0, 0.6]];
function bulgeHeight(r: number): number {
  for (let i = 1; i < BULGE.length; i++) if (r >= BULGE[i][0]) return BULGE[i - 1][1] + ((BULGE[i][1] - BULGE[i - 1][1]) * (BULGE[i - 1][0] - r)) / (BULGE[i - 1][0] - BULGE[i][0]);
  return 0.6;
}
function bulge(seg: number): Object3D {
  const s = new Shape();
  s.lathe(...PAL.aluminium, 0, 0, BULGE, seg);
  // the vent's score lines, stretched over the swelling
  for (const a of SPOKES) ribbon(s, ['matte', '#6f7379'], [0.15, 0.9, 1.7, 2.4].map((r) => ({ p: [Math.cos(a) * r, bulgeHeight(r), Math.sin(a) * r] as V3, n: [0, 1, 0] as V3 })), 0.14, 0.1, 0.03);
  const g = s.toObject('bulge');
  g.position.y = TOP - 0.1;
  g.visible = false;
  return g;
}
/** What a burst can shows on top of the swollen top. */
function burstMarks(): Object3D {
  const s = new Shape();
  const y = TOP - 0.1;
  // the hole where the vent gave way, ragged
  const hole = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2, r = i % 3 === 0 ? 1.3 : i % 3 === 1 ? 0.8 : 1.05;
    return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
  });
  s.prism('matte', '#080706', hole, y + 0.3, y + 0.63, 0, { ao: 1 });
  // three petals of the top, bent up and outwards between the score lines
  const mb = new MeshBuilder();
  SPOKES.forEach((a0) => {
    const a = a0 + Math.PI / 3;
    const at = (da: number, r: number, h: number): V3 => [Math.cos(a + da) * r, y + h, Math.sin(a + da) * r];
    const out: V3 = [Math.cos(a) * 0.5, 0.86, Math.sin(a) * 0.5], inn: V3 = [-out[0], -out[1], -out[2]];
    const p = [at(-0.8, 1.5, 0.46), at(0.8, 1.5, 0.46), at(0, 1.2, 0.72)];
    mb.tri(mb.vertex(p[0], out), mb.vertex(p[1], out), mb.vertex(p[2], out), out);
    mb.tri(mb.vertex(p[0], inn, [0, 0], 0.45), mb.vertex(p[1], inn, [0, 0], 0.45), mb.vertex(p[2], inn, [0, 0], 0.45), inn);
  });
  s.add(PAL.aluminium[0], PAL.aluminium[1], mb.build());
  // the wound foil and paper pushed out of the hole
  s.block('matte', '#b9a57a', 0.3, 0.14, 0.2, new Matrix4().makeTranslation(0.12, y + 0.44, -0.1).multiply(new Matrix4().makeRotationZ(0.5)), 0.05);
  // dried electrolyte: crusts round the hole, soot on the shoulder, a run down the front of the sleeve
  const crust: Finish = ['matte', asSeen('#5b3d1f')];
  for (const [x, z, r] of [[1.75, 0.95, 0.5], [-1.45, 1.55, 0.4], [-0.7, -1.9, 0.44], [1.6, -1.3, 0.3], [0.25, 2.3, 0.4], [0.95, 2.05, 0.26]]) {
    const h = y + bulgeHeight(Math.hypot(x, z));
    s.lathe(...crust, x, z, [[r, h - 0.03], [r * 0.75, h + 0.07], [r * 0.3, h + 0.12], [0, h + 0.13]], 8);
  }
  const g = s.toObject('burst');
  g.visible = false;
  return g;
}

export default defineModel<PartState>({
  id: m.id,
  title: m.name.en,
  footprintMm: footprintOf(m.body),
  plugMm: LEG_LONG,
  terminals,
  build(ctx) {
    const seg = ctx.seg(22);
    const s = new Shape();
    // the rubber bung, the leads (the positive one is the long one)
    s.disc(...PAL.rubber, 0, 0, R - 0.3, 0, 0.6, 0.12, seg, { cap: true, ao: 1 });
    s.rod(...PAL.tin, [POS[0], 0.3, POS[2]], [POS[0], -LEG_LONG, POS[2]], 0.25, 6);
    s.rod(...PAL.tin, [NEG[0], 0.3, NEG[2]], [NEG[0], -LEG_SHORT, NEG[2]], 0.25, 6);
    // the sleeve: tucked under, the crimp groove above the bung, shrunk over the shoulder
    s.lathe(...SLEEVE, 0, 0, [[R - 0.3, 0.22], [R, 0.5], [R, 1.25], [R - 0.2, 1.55], [R, 1.85], [R, TOP - 0.45], [R - 0.17, TOP - 0.13], [R - 0.5, TOP - 0.02]], seg);
    s.disc(...PAL.aluminium, 0, 0, R - 0.45, TOP - 0.3, TOP - 0.06, 0.05, seg, { ao: 1 });
    for (const a of SPOKES) s.with(new Matrix4().makeRotationY(-a), () => s.box('matte', '#74787e', 1.25, 0, 2.3, 0.13, TOP - 0.08, TOP - 0.045, 0, 0, { ao: 1 }));
    // the negative stripe and its minus signs
    s.band(...STRIPE, 0, 0, R, 2.1, TOP - 0.75, NEG_AT - 0.52, NEG_AT + 0.52, ctx.seg(6));
    for (const y of [3.3, 5.65, 8.0]) s.band('matte', '#232a38', 0, 0, R + 0.02, y, y + 0.45, NEG_AT - 0.24, NEG_AT + 0.24, 2);
    const root = s.toObject();
    root.add(screenOnCylinder('value', LABEL, 16), bulge(seg), burstMarks());
    return root;
  },
  animate(st, obj, env) {
    const burst = st.outputs.burst === true;
    value = num(st.fields.uf, UF);
    leaked = burst;
    drawScreen(obj, 'value', burst ? -value : value, drawLabel);
    const swelling = !burst && st.outputs.reversed === true && st.power.on;
    show(obj, 'burst', burst);
    const top = part(obj, 'bulge')!;
    top.visible = burst || swelling;
    // backwards: the top heaves until it gives way
    top.scale.y = swelling ? 0.7 + 0.3 * Math.abs(Math.sin(env.time * 8)) : 1;
    return swelling;
  },
  states: {
    c100u: partState({ fields: { uf: 100 }, outputs: { volts_mv: 5000, reversed: false, burst: false } }),
    c1000u: partState({ fields: { uf: 1000 }, outputs: { volts_mv: 9000 } }),
    c4u7: partState({ fields: { uf: 4.7 }, outputs: { volts_mv: 3300 } }),
    reversed: partState({ fields: { uf: 100 }, outputs: { volts_mv: -3300, reversed: true } }),
    burst: partState({ fields: { uf: 100 }, outputs: { volts_mv: 0, reversed: false, burst: true } }),
  },
});
