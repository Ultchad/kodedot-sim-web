/**
 * Potentiometer, 10 kOhm: a single-turn carbon pot for a board, of the 9 mm "blue and white" kind (Alps RK09 / Bourns
 * PTV09 layout: blue moulded housing under a stamped steel frame with two side straps, a plain bushing, a cream
 * plastic shaft with a knurled top, three flat terminals in a row along the front), drawn at the size and with the
 * 5 mm terminal pitch of parts/potentiometer/manifest.json. The shaft is the control (`knob`, rotate, field
 * `position`): its pointer line turns from -135 to +135 degrees as the manifest's knob visual says, the dead arc
 * towards the terminals. The frame carries only the marking of a real pot: taper and value.
 */
import manifestJson from '../../../../../parts/potentiometer/manifest.json';
import { PAL, Shape, controlFromManifest, defineModel, footprintOf, markControl, part, partState, print, terminalsFromManifest, text, topQuad, turnDeg, type PartState, type Pt } from '../../index';
import { asManifest, fieldDefault, flatLeg } from './shared';

const manifest = asManifest(manifestJson);
const terminals = terminalsFromManifest(manifest);
const { w: W, d: D, h: H } = footprintOf(manifest.body);
const LEGS = 3.5;
const DEG = Math.PI / 180;
const mark = controlFromManifest(manifest, 'position');
const TURN = mark.turn!;
const DEFAULT = Number(fieldDefault(manifest, 'position') ?? 0.5);
const OHMS = Number(manifest.behaviour?.elements?.find((e) => e.type === 'divider')?.ohms ?? 10000);

// the terminals stand in front of the housing; the housing fills the rest of the footprint
const TERM_Z = terminals[0].pos[2];
const FRONT = TERM_Z - 0.2, BACK = -D / 2 + 0.1;
const BODY_D = FRONT - BACK, BODY_Z = (FRONT + BACK) / 2, BODY_W = W - 0.9;
const HOUSING = 6.0, FRAME = 6.7, BUSH = 9.4;
const SHAFT_R = 3.0;
const INK = '#2b2a2d';
const HOUSING_BLUE = ['matte', '#1f62ad'] as const; // the housing's own blue, deeper than PAL.plasticBlue

/** The knurled top of the shaft: a ring of flat teeth. */
function knurl(r: number, teeth: number, depth: number): Pt[] {
  const loop: Pt[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, step = (Math.PI * 2) / teeth;
    for (const [f, rr] of [[0.06, r - depth], [0.3, r], [0.7, r], [0.94, r - depth]] as const) loop.push([Math.cos(a + f * step) * rr, Math.sin(a + f * step) * rr]);
  }
  return loop;
}

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  plugMm: LEGS,
  terminals,
  build(ctx) {
    const s = new Shape();
    // housing, then the steel frame: a plate on top, a strap down each side, two tabs folded over the front
    s.box(...HOUSING_BLUE, 0, BODY_Z, BODY_W, BODY_D, 0, HOUSING, 1.0, 0.3, { cap: true, ao: 0.78 });
    s.box(...PAL.tin, 0, BODY_Z, BODY_W, BODY_D, HOUSING, FRAME, 1.0, 0.16, { ao: 1 });
    for (const sx of [-1, 1]) {
      s.box(...PAL.tin, sx * (BODY_W / 2 + 0.1), BODY_Z, 0.3, 3.4, 0, FRAME - 0.2, 0, 0.1, { cap: true, ao: 0.85 });
      s.box(...PAL.tin, sx * 2.5, FRONT + 0.02, 1.5, 0.24, HOUSING - 1.5, FRAME - 0.2, 0, 0.08, { ao: 0.9 });
    }
    // the bushing the shaft turns in
    s.lathe(...PAL.tin, 0, BODY_Z, [[SHAFT_R + 0.75, FRAME], [SHAFT_R + 0.75, BUSH - 0.4], [SHAFT_R + 0.4, BUSH], [SHAFT_R - 0.2, BUSH]], ctx.seg(24));
    // terminals: an eyelet riveted to the front of the housing, then the pin
    for (const t of terminals) {
      flatLeg(s, { x: t.pos[0], z: t.pos[2], y0: -LEGS, y1: 3.7, neck: 0.9, w: 0.9, shoulder: 1.8, t: 0.3 });
    }
    const root = s.toObject();
    root.add(
      print({
        name: 'value',
        quad: topQuad(0, BODY_Z, FRAME + 0.02, BODY_W / 2, BODY_D / 2),
        ppm: 22,
        draw(g) {
          // stamped in the frame, as on the real part: the taper (B, linear) and the value
          g.fillStyle = 'rgba(40,40,46,0.8)';
          text(g, `B${OHMS / 1000}K`, 0, BODY_D / 2 - 0.75, 0.95, { weight: 700 });
        },
      }),
    );

    const k = new Shape();
    k.disc(...PAL.plasticCream, 0, 0, SHAFT_R, 0, 2.4, 0, ctx.seg(24), { ao: 0.8 });
    k.prism(...PAL.plasticCream, knurl(SHAFT_R + 0.08, 18, 0.34), 2.2, H - BUSH + 0.3, 0.3, { ao: 0.86 });
    // the pointer: a line from the middle to the rim, carried down the side so it reads from any angle
    const top = H - BUSH + 0.3;
    k.box('matte', INK, 0, -SHAFT_R / 2 - 0.1, 0.85, SHAFT_R - 0.35, top, top + 0.03, 0.3, 0, { ao: 1 });
    k.box('matte', INK, 0, -SHAFT_R - 0.02, 0.85, 0.3, 0.2, top - 0.25, 0, 0, { ao: 1 });
    const knob = markControl(k.toObject('knob'), mark);
    knob.position.set(0, BUSH - 0.3, BODY_Z);
    knob.rotation.y = -turnDeg(TURN, DEFAULT) * DEG;
    root.add(knob);
    return root;
  },
  animate(st, obj) {
    const knob = part(obj, 'knob');
    if (!knob) return;
    const v = st.fields.position;
    // clockwise seen from above is a negative turn about Y
    knob.rotation.y = -turnDeg(TURN, typeof v === 'number' ? v : DEFAULT) * DEG;
  },
  states: {
    middle: partState({ fields: { position: 0.5 } }),
    min: partState({ fields: { position: 0 } }),
    max: partState({ fields: { position: 1 } }),
    quarter: partState({ fields: { position: 0.25 } }),
  },
});
