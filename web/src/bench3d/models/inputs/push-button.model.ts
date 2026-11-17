/**
 * Push button: a 6 x 6 x 5 mm tactile switch (the B3F / TS-06 family: 6 mm square moulded base, stamped steel cover
 * staked at four corners, round plunger 3.5 mm across standing 1.45 mm proud, four legs in two pairs, here spread to the 5.08 mm of the manifest so they
 * drop into a breadboard).
 * Size and terminals come from parts/push-button/manifest.json: A and B sit between the two legs of each pair (the
 * legs of a pair are one contact inside the switch, which is why the manifest has two pins for four legs).
 * The plunger is the control (`cap`, momentary, field `pressed`). Its real travel is 0.25 mm; the model moves it
 * 0.7 mm so that a press can be seen from the Workbench's camera.
 */
import manifestJson from '../../../../../parts/push-button/manifest.json';
import { PAL, Shape, controlFromManifest, defineModel, footprintOf, markControl, part, partState, terminalsFromManifest, type PartState } from '../../index';
import { approach, asManifest, flatLeg } from './shared';

const manifest = asManifest(manifestJson);
const terminals = terminalsFromManifest(manifest);
const { w: W, d: D, h: H } = footprintOf(manifest.body);
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
    s.box(...PAL.plasticBlack, 0, 0, W, D, 0, COVER - 0.25, 0.3, 0.15, { cap: true, ao: 0.82 });
    s.box(...PAL.tin, 0, 0, W - 0.1, D - 0.1, COVER - 0.25, COVER, 0.55, 0.09, { ao: 1 });
    for (const sx of [-1, 1]) s.box(...PAL.tin, sx * (W / 2 - 0.02), 0, 0.14, 2.3, COVER - 1.9, COVER - 0.15, 0, 0.05, { ao: 0.9 });
    // the four heat stakes that hold the cover, and the hole the plunger moves in
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) s.disc(...PAL.plasticBlack, sx * (W / 2 - 0.95), sz * (D / 2 - 0.95), 0.42, COVER, COVER + 0.16, 0.1, ctx.seg(10), { ao: 1 });
    s.disc('matte', '#0c0c0e', 0, 0, 2.02, COVER, COVER + 0.015, 0, ctx.seg(24), { ao: 1 });
    // two legs per terminal: out of the base's sides, a shoulder, then the pin
    for (const t of terminals) for (const sz of [-1, 1]) flatLeg(s, { x: t.pos[0], z: sz * (D / 2 + 0.1), y0: -LEGS, y1: 1.15, neck: -0.45, w: 0.6, shoulder: 0.85, t: 0.25 });
    const root = s.toObject();

    const cap = new Shape();
    cap.disc(...PAL.plasticRed, 0, 0, 1.75, 0, CAP_H, 0.32, ctx.seg(24), { ao: 0.8 });
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
