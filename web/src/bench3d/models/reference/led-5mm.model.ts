/**
 * Reference for WIRED parts: a 5 mm through-hole LED. It shows what a wired part's model does beyond a body: its
 * size and terminals taken from the part's manifest, legs that plug in (`plugMm`), a part that lights up
 * (`glowing` + `setLamp`), the parts engine's state (`PartState`) and its hazards.
 * (It is the kit's example, id `ref.led-5mm`; the parts library's LEDs bring their own models.)
 * Dimensions: the usual T-1 3/4 drawing (dome 5.0 mm, flange 5.8 x 1.0 mm, body 8.6 mm, leads 0.5 mm at 2.54 mm).
 */
import { PAL, Shape, defineModel, footprintOf, glowing, ledDome, part, partState, setLamp, terminalsFromManifest, type PartState } from '../../index';

/**
 * What the model needs of parts/led/manifest.json, copied here so the example stands alone. A real part's model
 * imports its manifest instead: `import manifest from '<repo>/parts/<id>/manifest.json'`.
 */
const MANIFEST = {
  body: { w_mm: 5.8, d_mm: 5.8, h_mm: 9 },
  pins: [
    { name: 'A', mm: { x: 1.63, y: 2.9 }, face: 'bottom' as const, label: { en: 'A' } },
    { name: 'K', mm: { x: 4.17, y: 2.9 }, face: 'bottom' as const, label: { en: 'K' } },
  ],
};
const terminals = terminalsFromManifest(MANIFEST); // A at [-1.27, 0, 0], K at [1.27, 0, 0], both leaving downwards
const LEGS = 6; // how far the leads reach below the flange: into a breadboard
const RED = 0xff3b30;

export default defineModel<PartState>({
  id: 'ref.led-5mm',
  title: 'LED 5 mm (kit reference)',
  footprintMm: footprintOf(MANIFEST.body),
  plugMm: LEGS,
  build(ctx) {
    const s = new Shape();
    for (const t of terminals) s.box(...PAL.tin, t.pos[0], t.pos[2], 0.5, 0.5, -LEGS, 0.6, 0.05, 0.12, { cap: true, ao: 0.95 });
    // inside the resin: the anvil (cathode side) and the post, which show through the clear body
    s.box(...PAL.tin, 0.95, 0, 1.5, 0.5, 0.6, 5.4, 0.05, 0.1, { cap: true });
    s.box(...PAL.tin, -1.1, 0, 0.7, 0.5, 0.6, 4.6, 0.05, 0.1, { cap: true });
    const root = s.toObject();
    // the body is its own named part, so that this copy alone can glow
    root.add(glowing('dome', ledDome({ x: 0, z: 0, y: 0, d: 5, resin: PAL.resinRed, seg: ctx.seg(18) })));
    return root;
  },
  terminals,
  animate(st, obj, env) {
    const dome = part(obj, 'dome')!;
    if (st.outputs.burnt) {
      dome.scale.setScalar(1);
      setLamp(obj, 'dome', 0x1a0d0c, 0.25); // burnt out: a dull, dark body
      return;
    }
    if (st.outputs.overcurrent) {
      // glaring and unsteady, and the body swells a little: something is clearly wrong
      setLamp(obj, 'dome', 0xffb199, 2.2 + Math.sin(env.time * 47) * 0.6);
      dome.scale.setScalar(1 + 0.03 * Math.sin(env.time * 31));
      return true;
    }
    dome.scale.setScalar(1);
    setLamp(obj, 'dome', RED, st.power.on ? Number(st.outputs.brightness ?? 0) : 0);
  },
  states: {
    off: partState({ outputs: { brightness: 0 } }),
    on: partState({ outputs: { brightness: 1 } }),
    dim: partState({ outputs: { brightness: 0.3 } }),
    overcurrent: partState({ outputs: { brightness: 1, overcurrent: true } }),
    burnt: partState({ outputs: { brightness: 0, burnt: true } }),
  },
});
