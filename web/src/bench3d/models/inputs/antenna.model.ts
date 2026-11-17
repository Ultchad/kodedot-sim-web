/**
 * Antenna: a rubber stub ("rubber duck") antenna screwed on a vertical SMA board jack, as parts/antenna/manifest.json
 * describes it (10 x 10 x 60 mm, FEED and GND underneath). SMA sizes: 6.35 mm square flange, 1/4"-36 thread (6.35 mm),
 * 8 mm hexagonal coupling nut; above it the moulded sleeve, a collar 9.4 mm across tapering to a 6.4 mm whip with a
 * rounded tip. A real jack has a centre pin and four corner posts; the model has one post per manifest terminal,
 * where the manifest puts them, so the body and the wiring agree.
 * Live state: the fields `band` and `gain_dbi` are printed along the whip (`label`), as on a real antenna.
 */
import manifestJson from '../../../../../parts/antenna/manifest.json';
import { PAL, Shape, defineModel, drawScreen, footprintOf, partState, screen, terminalsFromManifest, type PartState, type Pt, type V2 } from '../../index';
import { asManifest, fieldDefault } from './shared';

const manifest = asManifest(manifestJson);
const terminals = terminalsFromManifest(manifest);
const { w: W, h: H } = footprintOf(manifest.body);
const LEGS = 3.5;
const FLANGE = 6.35, FLANGE_H = 1.7;
const NUT0 = 3.5, NUT1 = 9.6, NUT_AF = 8; // the coupling nut: across flats
const COLLAR_R = Math.min(4.7, W / 2 - 0.3), WHIP0 = 16.3, WHIP_R0 = 3.9, WHIP_R1 = 3.2, TIP = H - 3.4;
const SLEEVE = ['matte', '#29292c'] as const; // moulded sleeve: PAL.rubber's colour with a little more sheen, so the round reads
const whipR = (y: number): number => WHIP_R0 + ((WHIP_R1 - WHIP_R0) * (y - WHIP0)) / (TIP - WHIP0);

const BAND_DEFAULT = Number(fieldDefault(manifest, 'band') ?? 2400), GAIN_DEFAULT = Number(fieldDefault(manifest, 'gain_dbi') ?? 2);
const BAND_LABEL = new Map((manifest.fields?.find((f) => f.name === 'band')?.values ?? []).map((v) => [Number(v.value), v.label?.en ?? `${v.value} MHz`]));
const LABEL_Y = 35, LABEL_HW = 1.3, LABEL_HH = 11, LABEL_PPM = 14;
// what the label shows: set by `animate` just before it asks for a redraw (no closure per call)
let band = BAND_DEFAULT, gain = GAIN_DEFAULT;
function drawLabel(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.translate(w / 2, h / 2);
  g.rotate(-Math.PI / 2); // reads up the whip
  g.fillStyle = 'rgba(238,234,226,0.9)';
  g.font = `700 ${Math.round(w * 0.6)}px "DM Sans", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(`${BAND_LABEL.get(band) ?? `${band} MHz`}  ·  ${gain} dBi`, 0, w * 0.04);
}

export default defineModel<PartState>({
  id: manifest.id,
  title: manifest.name.en,
  footprintMm: footprintOf(manifest.body),
  plugMm: LEGS,
  terminals,
  build(ctx) {
    const s = new Shape();
    const seg = ctx.seg(20);
    // the jack: posts, flange, the white insulator round the feed underneath, the threaded barrel
    for (const t of terminals) s.box(...PAL.gold, t.pos[0], t.pos[2], 0.9, 0.9, -LEGS, 0.3, 0.08, 0, { cap: true, ao: 0.95 });
    s.box(...PAL.gold, 0, 0, FLANGE, FLANGE, 0, FLANGE_H, 0.35, 0.18, { cap: true, ao: 0.9 });
    const thread: V2[] = [];
    for (let y = FLANGE_H, i = 0; y < NUT0 + 0.3; y += 0.3, i++) thread.push([i % 2 ? 3.17 : 2.9, y]);
    s.lathe(...PAL.gold, 0, 0, thread, ctx.seg(16));
    // the antenna's plug: a hexagonal coupling nut, a turned neck
    const hex: Pt[] = [];
    for (let i = 0; i < 6; i++) hex.push([(Math.cos((i / 6) * Math.PI * 2) * NUT_AF) / Math.sqrt(3), (Math.sin((i / 6) * Math.PI * 2) * NUT_AF) / Math.sqrt(3)]);
    s.prism(...PAL.tin, hex, NUT0, NUT1, 0.4, { cap: true, ao: 0.82 });
    s.lathe(...PAL.tin, 0, 0, [[3.7, NUT1 - 0.1], [3.7, NUT1 + 0.7], [3.3, NUT1 + 0.9]], ctx.seg(16));
    // the moulded sleeve: collar, shoulder, a groove, the whip tapering to a rounded tip
    const top = H - TIP, r1 = WHIP_R1;
    s.lathe(
      ...SLEEVE,
      0,
      0,
      [
        [COLLAR_R - 0.35, NUT1 + 0.75], [COLLAR_R, NUT1 + 1.1], [COLLAR_R, 11.7], [COLLAR_R - 0.28, 11.95], [COLLAR_R - 0.28, 12.25], [COLLAR_R, 12.5], [COLLAR_R, 13.9], [WHIP_R0 + 0.15, 14.9], [WHIP_R0 - 0.2, 15.5], [WHIP_R0 - 0.2, 15.9], [WHIP_R0, WHIP0],
        [r1, TIP], [r1 * 0.94, TIP + top * 0.45], [r1 * 0.72, TIP + top * 0.78], [r1 * 0.4, TIP + top * 0.95], [0, H],
      ],
      seg,
    );
    const root = s.toObject();
    // the print along the whip, on the side that faces the viewer: tilted with the taper so it lies on the rubber
    const slope = (WHIP_R1 - WHIP_R0) / (TIP - WHIP0);
    root.add(screen('label', { c: [0, LABEL_Y, whipR(LABEL_Y) + 0.04], u: [LABEL_HW, 0, 0], v: [0, LABEL_HH, slope * LABEL_HH] }, LABEL_PPM, { lit: false }));
    return root;
  },
  animate(st, obj) {
    band = Number(st.fields.band ?? BAND_DEFAULT);
    gain = Number(st.fields.gain_dbi ?? GAIN_DEFAULT);
    drawScreen(obj, 'label', band * 1000 + gain * 10, drawLabel);
  },
  states: {
    'wifi-2g4': partState({ fields: { band: 2400, gain_dbi: 2 } }),
    'lora-868': partState({ fields: { band: 868, gain_dbi: 3 } }),
    'sub-433': partState({ fields: { band: 433, gain_dbi: 2.5 } }),
  },
});
