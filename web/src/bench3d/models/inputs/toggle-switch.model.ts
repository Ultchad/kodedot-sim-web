/**
 * Toggle switch, SPDT on-on: the miniature panel toggle (the MTS-102 kind: moulded body 13.2 x 7.9 x 9.9 mm under a
 * steel frame, a threaded 6 mm bushing, a bat-shaped metal lever, three solder lugs). Size and terminals come from
 * parts/toggle-switch/manifest.json; the real lugs are 4.7 mm apart, the manifest has them at 5.08 mm. Heights are
 * estimates.
 * The lever is the control (`lever`, toggle, field `position`). As in the real switch it leans AWAY from the pin it
 * connects: at `a` (COM to A) it leans towards B.
 */
import manifestJson from '../../../../../parts/toggle-switch/manifest.json';
import { PAL, Shape, controlFromManifest, defineModel, footprintOf, hitPad, markControl, part, partState, terminalsFromManifest, type PartState } from '../../index';
import { approach, asManifest, fieldDefault, flatLeg } from './shared';

const manifest = asManifest(manifestJson);
const terminals = terminalsFromManifest(manifest);
const { w: W, d: D, h: H } = footprintOf(manifest.body);
const LEGS = 3.5;
const BODY = 9.4, FRAME = 9.9; // the moulding's top, the steel frame's top
const BUSH_TOP = 17.4, PIVOT = 16.0;
const LEAN = (13 * Math.PI) / 180;
const LEVER = (H - PIVOT - 0.2) * Math.cos(LEAN); // so that its tip stays under the part's height
const SPEED = 5; // rad/s: over in 90 ms
const mark = controlFromManifest(manifest, 'position');
const DEFAULT = fieldDefault(manifest, 'position');
// the lever's lean (about Z, positive towards -X) for each position: away from that position's pin
const leanOf = (pin: string): number => Math.sign(terminals.find((t) => t.id.toLowerCase() === pin)?.pos[0] ?? 0) * LEAN;
const LEAN_OF: Record<string, number> = Object.fromEntries((mark.values ?? []).map((v) => [String(v), leanOf(String(v))]));

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  plugMm: LEGS,
  terminals,
  build(ctx) {
    const s = new Shape();
    s.box(...PAL.plasticBlue, 0, 0, W - 0.4, D - 0.4, 0.4, BODY, 0.3, 0.2, { cap: true, ao: 0.85 });
    // the steel frame: a plate on top, folded down over the two ends
    s.box(...PAL.tin, 0, 0, W, D, BODY, FRAME, 0.3, 0.12, { ao: 1 });
    for (const sx of [-1, 1]) s.box(...PAL.tin, sx * (W / 2 - 0.1), 0, 0.2, D - 2.4, 3.2, BODY, 0, 0.05, { ao: 0.9 });
    // the threaded bushing: a ring per turn of the thread would cost the budget, three steps read as a thread
    for (let i = 0; i < 4; i++) s.disc(...PAL.steel, 0, 0, i % 2 ? 2.75 : 3.0, FRAME + (i * (BUSH_TOP - FRAME)) / 4, FRAME + ((i + 1) * (BUSH_TOP - FRAME)) / 4, 0.12, ctx.seg(18), { ao: 0.95 });
    s.disc('matte', '#0c0c0e', 0, 0, 1.9, BUSH_TOP, BUSH_TOP + 0.015, 0, ctx.seg(16), { ao: 1 });
    for (const t of terminals) flatLeg(s, { x: t.pos[0], z: t.pos[2], y0: -LEGS, y1: 0.4, w: 1.4, t: 0.5, turn: 1 });
    const root = s.toObject();

    // the lever turns about the pivot inside the bushing: its node sits there
    const lever = new Shape();
    lever.disc(...PAL.steel, 0, 0, 1.25, 0, LEVER * 0.45, 0.1, ctx.seg(14), { ao: 0.9 });
    lever.disc(...PAL.steel, 0, 0, 1.6, LEVER * 0.45, LEVER, 0.5, ctx.seg(14), { ao: 1 });
    const node = hitPad(markControl(lever.toObject('lever'), mark), { y: LEVER * 0.55, w: 4.5, d: 4.5, h: LEVER * 0.9 });
    node.position.y = PIVOT;
    node.rotation.z = LEAN_OF[String(DEFAULT)] ?? LEAN;
    root.add(node);
    return root;
  },
  animate(st, obj, env) {
    const lever = part(obj, 'lever');
    if (!lever) return;
    const target = LEAN_OF[String(st.fields.position ?? DEFAULT)] ?? LEAN;
    lever.rotation.z = approach(lever.rotation.z, target, SPEED, env.dt);
    return lever.rotation.z !== target;
  },
  states: {
    a: partState({ fields: { position: 'a' } }),
    b: partState({ fields: { position: 'b' } }),
  },
});
