/**
 * Tactile button 6 x 6 mm, 4 pins (the B3F / TS-06 family: 6 mm square moulded base 3.5 mm high, stamped steel cover
 * staked at four corners, round black plunger 3.5 mm across, 5 mm to its top; four legs out of two opposite sides).
 * Size and terminals come from parts/tact-6mm/manifest.json. The real legs are 6.5 mm apart across the body and
 * 4.5 mm along a side; in a breadboard they spring to 7.62 x 5.08 mm, which is where the manifest has them, so the
 * legs stand outside the moulding and the part's box is 6 x 8 mm. The two legs that face each other across the body
 * (A1-A2, B1-B2) are one strip of metal inside.
 * The plunger is the control (`cap`, momentary, field `pressed`). Its real travel is 0.25 mm; the model moves it
 * 0.7 mm so that a press can be seen from the Workbench's camera.
 */
import manifestJson from '../../../../../parts/tact-6mm/manifest.json';
import { PAL, Shape, controlFromManifest, defineModel, footprintOf, markControl, part, partState, terminalsFromManifest, type PartState } from '../../index';
import { approach, asManifest, flatLeg } from './shared';

const manifest = asManifest(manifestJson);
const terminals = terminalsFromManifest(manifest);
const { w: W, h: H } = footprintOf(manifest.body);
const B = 6; // the moulding, square
const LEGS = 3.5; // below the seating plane
const COVER = H - 1.45; // top of the steel cover: the plunger stands 1.45 mm above it
const CAP_H = 1.9; // the plunger, of which 0.45 mm stays inside the cover
const TRAVEL = 0.7;
const SPEED = 14; // mm/s: down in 50 ms

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  plugMm: LEGS,
  terminals,
  build(ctx) {
    const s = new Shape();
    // moulded base, then the cover: a steel plate with its corners cut, folded down over two sides
    s.box(...PAL.plasticBlack, 0, 0, W, B, 0, COVER - 0.25, 0.3, 0.15, { cap: true, ao: 0.82 });
    s.box(...PAL.tin, 0, 0, W - 0.1, B - 0.1, COVER - 0.25, COVER, 0.55, 0.09, { ao: 1 });
    for (const sx of [-1, 1]) s.box(...PAL.tin, sx * (W / 2 - 0.02), 0, 0.14, 2.3, COVER - 1.9, COVER - 0.15, 0, 0.05, { ao: 0.9 });
    // the four heat stakes that hold the cover, and the hole the plunger moves in
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) s.disc(...PAL.plasticBlack, sx * (W / 2 - 0.95), sz * (B / 2 - 0.95), 0.42, COVER, COVER + 0.16, 0.1, ctx.seg(10), { ao: 1 });
    s.disc('matte', '#0c0c0e', 0, 0, 2.02, COVER, COVER + 0.015, 0, ctx.seg(24), { ao: 1 });
    // a leg per terminal: out of the base's side, then down
    for (const t of terminals) {
      const sz = Math.sign(t.pos[2]);
      s.box(...PAL.tin, t.pos[0], sz * (B / 2 + (Math.abs(t.pos[2]) - B / 2) / 2), 0.85, Math.abs(t.pos[2]) - B / 2 + 0.25, 0.95, 1.2, 0, 0.04, { cap: true, ao: 0.95 });
      flatLeg(s, { x: t.pos[0], z: t.pos[2], y0: -LEGS, y1: 1.2, neck: -0.45, w: 0.6, shoulder: 0.85, t: 0.25 });
    }
    const root = s.toObject();

    const cap = new Shape();
    cap.disc(...PAL.plasticGraphite, 0, 0, 1.75, 0, CAP_H, 0.32, ctx.seg(24), { ao: 0.8 });
    const node = markControl(cap.toObject('cap'), controlFromManifest(manifest, 'pressed'));
    node.position.y = H - CAP_H;
    root.add(node);
    return root;
  },
  animate(st, obj, env) {
    const cap = part(obj, 'cap');
    if (!cap) return;
    const down = st.fields.pressed === true || (st.visuals.cap ?? 0) > 0;
    const target = H - CAP_H - (down ? TRAVEL : 0);
    cap.position.y = approach(cap.position.y, target, SPEED, env.dt);
    return cap.position.y !== target;
  },
  states: {
    released: partState({ fields: { pressed: false } }),
    pressed: partState({ fields: { pressed: true } }),
  },
});
