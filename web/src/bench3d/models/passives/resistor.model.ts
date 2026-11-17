/**
 * Resistor (parts/resistor): a 0.25 W axial carbon film resistor lying on the board, its leads bent down to the two
 * terminals 10.16 mm apart. The four colour bands show the part's `ohms` (two digits, multiplier, 5 % gold), so the
 * value can be read off the model as off the real part.
 * Dimensions (the usual CF-1/4 drawing): body 6.3 x 2.5 mm with the two swollen end caps, leads 0.55 mm.
 *
 * The body, the leads and the gold tolerance band are the static body (instanced). The value is two small meshes per
 * copy, the pair of digit bands and the multiplier band, which only point at geometries made once with the model
 * (90 digit pairs, 12 multipliers; colours in the vertices, the kit's matte material): no material and no geometry
 * per copy, nothing allocated when a value changes.
 * Above its rated power (the part's `overpower` output) the body glows.
 */
import { Mesh, type BufferGeometry } from 'three';
import manifest from '../../../../../parts/resistor/manifest.json';
import { Shape, defineModel, familyMaterial, footprintOf, part, partState, terminalsFromManifest, type Finish, type PartState, type V2 } from '../../index';
import { BAND_COLOURS, GOLD, resistorBands } from './codes';
import { PLUG, asManifest, axial, axialLeadsTo, axialShell, fieldDefault, hotShell, num, setHot, terminalOf } from './common';

const m = asManifest(manifest);
const terminals = terminalsFromManifest(m);
const OHMS = fieldDefault(m, 'ohms', 330);
/** The lacquer of a carbon film resistor (a candidate for PAL: resistorTan). */
const TAN: Finish = ['gloss', '#d7b682'];
const AXIS_Y = 1.35;
const R_CAP = 1.25, R_WAIST = 1.08;
/** The body's outline, [radius, x]: two end caps and the waist between them. */
const BODY: V2[] = [[0, -3.15], [0.62, -3.15], [1.08, -2.98], [R_CAP, -2.62], [R_CAP, -1.95], [R_WAIST, -1.55], [R_WAIST, 1.55], [R_CAP, 1.95], [R_CAP, 2.62], [1.08, 2.98], [0.62, 3.15], [0, 3.15]];
/** Where the bands sit: [x, radius under it]. Digits and multiplier together at one end, the tolerance apart at the other. */
const BANDS: V2[] = [[-2.28, R_CAP], [-1.02, R_WAIST], [0.06, R_WAIST], [2.28, R_CAP]];
const BAND_W = 0.52;

/** One band (or several) as a geometry: [index of the band's place, colour index]. */
function bandGeometry(bands: [number, number][]): BufferGeometry {
  const s = new Shape();
  s.with(axial(AXIS_Y), () => bands.forEach(([at, colour]) => s.band('matte', BAND_COLOURS[colour], 0, 0, BANDS[at][1], BANDS[at][0] - BAND_W / 2, BANDS[at][0] + BAND_W / 2, 0, Math.PI * 2, 14)));
  return s.build().matte!;
}
/** Every digit pair (index d1 + 16 * d2) and every multiplier, made once: `animate` only picks among them. */
let DIGITS: BufferGeometry[] | null = null, MULTIPLIERS: BufferGeometry[] | null = null;
function bandTables(): void {
  if (DIGITS) return;
  DIGITS = [];
  for (let d1 = 1; d1 <= 9; d1++) for (let d2 = 0; d2 <= 9; d2++) DIGITS[d1 + 16 * d2] = bandGeometry([[0, d1], [1, d2]]);
  MULTIPLIERS = BAND_COLOURS.map((_, c) => bandGeometry([[2, c]]));
}
const dynamicMesh = (name: string, geometry: BufferGeometry): Mesh => {
  const m = new Mesh(geometry, familyMaterial('matte'));
  m.name = name;
  m.userData.bench3d = 'bands';
  return m;
};

export default defineModel<PartState>({
  id: m.id,
  title: m.name.en,
  footprintMm: footprintOf(m.body),
  plugMm: PLUG,
  terminals,
  build(ctx) {
    const s = new Shape();
    s.with(axial(AXIS_Y), () => s.lathe(...TAN, 0, 0, BODY, ctx.seg(14)));
    axialLeadsTo(s, terminalOf(terminals, 'A'), terminalOf(terminals, 'B'), AXIS_Y, -3.05, 3.05);
    // the tolerance band: always gold
    s.with(axial(AXIS_Y), () => s.band('matte', BAND_COLOURS[GOLD], 0, 0, BANDS[3][1], BANDS[3][0] - BAND_W / 2, BANDS[3][0] + BAND_W / 2, 0, Math.PI * 2, 14));
    const root = s.toObject();
    bandTables();
    const code = resistorBands(OHMS);
    const digits = dynamicMesh('digits', DIGITS![code & 255]), multiplier = dynamicMesh('multiplier', MULTIPLIERS![(code >> 8) & 15]);
    digits.userData.ohms = OHMS;
    root.add(digits, multiplier, hotShell('hot', axialShell(AXIS_Y, BODY.filter((_, i) => i !== 2 && i !== 9), ctx.seg(14))));
    return root;
  },
  animate(st, obj, env) {
    const ohms = num(st.fields.ohms, OHMS);
    const digits = part(obj, 'digits') as Mesh;
    if (digits.userData.ohms !== ohms) {
      digits.userData.ohms = ohms;
      const code = resistorBands(ohms);
      digits.geometry = DIGITS![code & 255];
      (part(obj, 'multiplier') as Mesh).geometry = MULTIPLIERS![(code >> 8) & 15];
    }
    // over its rated power the body glows
    const hot = st.power.on && st.outputs.overpower === true;
    setHot(obj, 'hot', hot, env.time);
    return hot;
  },
  states: {
    r330: partState({ fields: { ohms: 330 }, outputs: { current_ma: 4 } }),
    r4k7: partState({ fields: { ohms: 4700 }, outputs: { current_ma: 0.7 } }),
    r10k: partState({ fields: { ohms: 10000 }, outputs: { current_ma: 0.33 } }),
    r1M: partState({ fields: { ohms: 1000000 } }),
    r0R47: partState({ fields: { ohms: 0.47 }, outputs: { current_ma: 120 } }),
    r68: partState({ fields: { ohms: 68 }, outputs: { current_ma: 20 } }),
    overpower: partState({ fields: { ohms: 10 }, outputs: { current_ma: 500, overpower: true } }),
  },
});
