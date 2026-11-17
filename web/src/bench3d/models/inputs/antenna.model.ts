/**
 * Antenna: a rubber-duck stub antenna screwed on a vertical SMA board jack, as parts/antenna/manifest.json describes
 * it (10 x 10 x 60 mm, FEED and GND underneath, 2.54 mm apart). SMA sizes: 6.35 mm square flange, 1/4"-36 thread
 * (6.35 mm), on the antenna's plug an 8 mm hexagonal coupling nut with a knurled finger ring above it, all gold
 * plated. Above the metal the moulded sleeve: a base 9.5 mm across, a conical shoulder, a slight step, then the whip
 * tapering from 7.1 to 5.9 mm with a rounded tip. The manifest's part is a fixed stub, so there is no hinge.
 * A real jack has a centre pin and four corner posts; the model has one post per manifest terminal, where the
 * manifest puts them, so the body and the wiring agree.
 * Nothing on it is printed: real stub antennas of this kind carry no marking, and the part has no live state to show
 * (`band` and `gain_dbi` are data for the page).
 */
import manifestJson from '../../../../../parts/antenna/manifest.json';
import { PAL, Shape, defineModel, footprintOf, terminalsFromManifest, type PartState, type Pt, type V2 } from '../../index';
import { asManifest } from './shared';

const manifest = asManifest(manifestJson);
const terminals = terminalsFromManifest(manifest);
const { w: W, h: H } = footprintOf(manifest.body);
const LEGS = 3.5;
const FLANGE = 6.35, FLANGE_H = 1.7;
const NUT0 = 3.4, NUT1 = 6.5, NUT_AF = 8; // the coupling nut: across flats
const GRIP0 = 7.1, GRIP1 = 9.8, GRIP_R = 4.5; // the knurled ring above it, after a turned groove
const BASE_R = Math.min(4.75, W / 2 - 0.25), BASE1 = 18; // the sleeve's base
const WHIP0 = 20.7, WHIP_R0 = 3.55, WHIP_R1 = 2.95, TIP = H - 3; // the whip, from the step to where the tip rounds off
const SLEEVE = ['matte', '#212124'] as const; // moulded sleeve: black rubber with a little more sheen than PAL.rubber, so the round reads

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  plugMm: LEGS,
  terminals,
  build(ctx) {
    const s = new Shape();
    const seg = ctx.seg(20);
    // the jack: posts, flange, the threaded barrel
    for (const t of terminals) s.box(...PAL.gold, t.pos[0], t.pos[2], 0.9, 0.9, -LEGS, 0.3, 0.08, 0, { cap: true, ao: 0.95 });
    s.box(...PAL.gold, 0, 0, FLANGE, FLANGE, 0, FLANGE_H, 0.35, 0.18, { cap: true, ao: 0.9 });
    const thread: V2[] = [];
    for (let y = FLANGE_H, i = 0; y < NUT0 + 0.3; y += 0.3, i++) thread.push([i % 2 ? 3.17 : 2.9, y]);
    s.lathe(...PAL.gold, 0, 0, thread, ctx.seg(12));
    // the antenna's plug: a hexagonal coupling nut, then the knurled ring the fingers turn it by
    const hex: Pt[] = [], knurl: Pt[] = [];
    for (let i = 0; i < 6; i++) hex.push([(Math.cos((i / 6) * Math.PI * 2) * NUT_AF) / Math.sqrt(3), (Math.sin((i / 6) * Math.PI * 2) * NUT_AF) / Math.sqrt(3)]);
    const teeth = ctx.seg(16);
    for (let i = 0; i < teeth * 2; i++) knurl.push([Math.cos((i / (teeth * 2)) * Math.PI * 2) * (GRIP_R - (i % 2) * 0.5), Math.sin((i / (teeth * 2)) * Math.PI * 2) * (GRIP_R - (i % 2) * 0.5)]);
    s.prism(...PAL.gold, hex, NUT0, NUT1, 0.4, { cap: true, ao: 0.82 });
    s.lathe(...PAL.gold, 0, 0, [[3.45, NUT1 - 0.2], [3.45, GRIP0 + 0.2]], ctx.seg(12));
    s.prism(...PAL.gold, knurl, GRIP0, GRIP1, 0.25, { cap: true, ao: 0.7 });
    // the moulded sleeve: base with a groove, conical shoulder, a slight step, the whip tapering to a rounded tip
    const sleeve: V2[] = [
      [BASE_R - 0.4, GRIP1 - 0.1], [BASE_R, GRIP1 + 0.3], [BASE_R, 11.6], [BASE_R - 0.25, 11.85], [BASE_R - 0.25, 12.15], [BASE_R, 12.4], [BASE_R, BASE1 - 0.4], [BASE_R - 0.2, BASE1],
      [WHIP_R0 + 0.25, WHIP0 - 0.25], [WHIP_R0 + 0.25, WHIP0], [WHIP_R0, WHIP0 + 0.12], [WHIP_R1, TIP],
    ];
    for (let i = 1; i <= 4; i++) sleeve.push([WHIP_R1 * Math.cos((i / 4) * (Math.PI / 2)), TIP + (H - TIP) * Math.sin((i / 4) * (Math.PI / 2))]);
    s.lathe(...SLEEVE, 0, 0, sleeve, seg);
    const root = s.toObject();
    return root;
  },
});
