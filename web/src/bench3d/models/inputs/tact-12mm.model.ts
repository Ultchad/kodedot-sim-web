/**
 * Tactile button 12 x 12 mm with a round cap, 4 pins (the B3F-4000 / TS-12 family: 12 mm square moulded base, steel
 * cover staked at four corners, a square plunger 7.3 mm to its top that takes a push-on round cap about 11.5 mm
 * across; four legs out of two opposite sides, real pitch 12.5 x 5.0 mm, here the manifest's 12.7 x 5.08 mm).
 * Size and terminals come from parts/tact-12mm/manifest.json; the height with the cap (12 mm) is an estimate.
 * The cap with the plunger is the control (`cap`, momentary, field `pressed`); its colour is the part's `cap` field.
 * Real travel 0.3 mm; the model moves it 0.9 mm so that a press can be seen from the Workbench's camera.
 */
import manifestJson from '../../../../../parts/tact-12mm/manifest.json';
import { PAL, Shape, controlFromManifest, defineModel, footprintOf, glowing, markControl, part, partState, terminalsFromManifest, type PartState } from '../../index';
import { approach, asManifest, fieldDefault, flatLeg, tint } from './shared';

const manifest = asManifest(manifestJson);
const terminals = terminalsFromManifest(manifest);
const { w: W, h: H } = footprintOf(manifest.body);
const B = 12; // the moulding, square
const LEGS = 3.5;
const COVER = 4.0; // top of the steel cover
const STEM_TOP = 7.3; // the bare plunger's top
const CAP_R = 5.75, CAP_Y = 6.2; // the cap: its skirt starts here, its top is the part's height
const TRAVEL = 0.9;
const SPEED = 18;
/** The caps as sold: the colour of each value of the `cap` field. */
const COLOURS: Record<string, number> = { black: 0x2a2a2e, red: 0xd0343f, blue: 0x1f6fd0, yellow: 0xf2c21a, green: 0x23a05a, white: 0xf1eee8 };
const DEFAULT = String(fieldDefault(manifest, 'cap') ?? 'red');

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  plugMm: LEGS,
  terminals,
  build(ctx) {
    const s = new Shape();
    s.box(...PAL.plasticBlack, 0, 0, W, B, 0, COVER - 0.3, 0.5, 0.2, { cap: true, ao: 0.82 });
    s.box(...PAL.tin, 0, 0, W - 0.15, B - 0.15, COVER - 0.3, COVER, 1.1, 0.1, { ao: 1 });
    for (const sx of [-1, 1]) s.box(...PAL.tin, sx * (W / 2 - 0.02), 0, 0.16, 4.2, COVER - 2.2, COVER - 0.15, 0, 0.05, { ao: 0.9 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) s.disc(...PAL.plasticBlack, sx * (W / 2 - 1.6), sz * (B / 2 - 1.6), 0.7, COVER, COVER + 0.2, 0.12, ctx.seg(10), { ao: 1 });
    s.disc('matte', '#0c0c0e', 0, 0, 3.4, COVER, COVER + 0.015, 0, ctx.seg(24), { ao: 1 });
    for (const t of terminals) {
      const sz = Math.sign(t.pos[2]);
      s.box(...PAL.tin, t.pos[0], sz * (B / 2 + (Math.abs(t.pos[2]) - B / 2) / 2), 1.2, Math.abs(t.pos[2]) - B / 2 + 0.3, 1.0, 1.3, 0, 0.04, { cap: true, ao: 0.95 });
      flatLeg(s, { x: t.pos[0], z: t.pos[2], y0: -LEGS, y1: 1.3, neck: -0.5, w: 0.7, shoulder: 1.2, t: 0.3 });
    }
    const root = s.toObject();

    // built white: `tint` gives each copy its colour
    const cap = new Shape();
    cap.box('matte', '#ffffff', 0, 0, 3.8, 3.8, COVER - 0.4 - CAP_Y, STEM_TOP - CAP_Y, 0.3, 0.1, { ao: 0.7 });
    cap.disc('matte', '#ffffff', 0, 0, CAP_R, 0, H - CAP_Y, 0.9, ctx.seg(32), { cap: true, ao: 0.9 });
    const node = markControl(glowing('cap', cap), controlFromManifest(manifest, 'pressed'));
    node.position.y = CAP_Y;
    tint(node, COLOURS[DEFAULT]);
    root.add(node);
    return root;
  },
  animate(st, obj, env) {
    const cap = part(obj, 'cap');
    if (!cap) return;
    tint(cap, COLOURS[String(st.fields.cap ?? DEFAULT)] ?? COLOURS[DEFAULT]);
    const down = st.fields.pressed === true || (st.visuals.cap ?? 0) > 0;
    const target = CAP_Y - (down ? TRAVEL : 0);
    cap.position.y = approach(cap.position.y, target, SPEED, env.dt);
    return cap.position.y !== target;
  },
  states: {
    released: partState({ fields: { pressed: false, cap: 'red' } }),
    pressed: partState({ fields: { pressed: true, cap: 'red' } }),
    blue: partState({ fields: { pressed: false, cap: 'blue' } }),
    yellow: partState({ fields: { pressed: false, cap: 'yellow' } }),
    black: partState({ fields: { pressed: false, cap: 'black' } }),
  },
});
