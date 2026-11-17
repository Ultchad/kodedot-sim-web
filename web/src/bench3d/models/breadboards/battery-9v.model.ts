/**
 * 9 V battery (PP3 / 6LR61): 48.5 x 26.5 x 17.5 mm over the snaps (IEC 60086-2), the snaps 12.7 mm apart: the small
 * stud is +, the six-sided crown is -. A lacquered steel jacket with rolled rims and a generic label: a coloured
 * band with the polarity, the voltage, the chemistry and the size codes; no name and no mark of any maker.
 * Live state: the voltage (field `volts`) is the big numeral of the label and the small one between the snaps, where
 * the part's picture shows it. Hazard: above the manifest's `max_ma` the cell overheats: a red-hot glow that beats
 * faster and stronger up to a dead short.
 */
import manifest from '../../../../../parts/battery-9v/manifest.json';
import {
  FONT, FONT_HEAD, Matrix4, PAL, Shape, defineModel, drawScreen, footprintOf, frontQuad, glowing, movedQuad, part, partState, print, roundedRectLoop, screen,
  setLamp, terminalsFromManifest, text, topQuad, type PartState,
} from '../../index';
import { asPart, extrude, pp3Snaps } from './builders';

const M = asPart(manifest);
const terminals = terminalsFromManifest(M);
const POS = terminals.find((t) => t.id === 'POS')!.pos, NEG = terminals.find((t) => t.id === 'NEG')!.pos;
const MAX_MA = manifest.behaviour.elements[0].max_ma;
const DEFAULT_VOLTS = manifest.fields[0].default;
const W = M.body.w_mm, D = M.body.d_mm;
const PLATE = M.body.h_mm - 4.1; // the snaps stand 4.1 mm over the top plate
const RIM = PLATE + 0.3;
const BAND = 29.6; // where the amber band of the label begins

const CREAM = '#f5eede', GRAPHITE = '#1c1c1f', AMBER = '#ffac00';

// the numerals are drawn per copy; `animate` may not allocate, so the value travels here
const pen = { volts: DEFAULT_VOLTS };
const shown = (v: number): string => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
function drawFront(g: CanvasRenderingContext2D, w: number, h: number): void {
  const u = w / 23; // pixels per millimetre
  const s = shown(pen.volts);
  g.fillStyle = CREAM;
  g.textBaseline = 'alphabetic';
  g.font = `700 ${(s.length > 2 ? 10.5 : 14) * u}px ${FONT_HEAD}`;
  const nw = g.measureText(s).width;
  g.font = `700 ${7 * u}px ${FONT_HEAD}`;
  const vw = g.measureText('V').width;
  const x0 = (w - nw - vw - 0.5 * u) / 2;
  g.textAlign = 'left';
  g.font = `700 ${(s.length > 2 ? 10.5 : 14) * u}px ${FONT_HEAD}`;
  g.fillText(s, x0, h * 0.86);
  g.font = `700 ${7 * u}px ${FONT_HEAD}`;
  g.fillStyle = AMBER;
  g.fillText('V', x0 + nw + 0.5 * u, h * 0.86);
}
function drawTop(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = CREAM;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${h * 0.42}px ${FONT}`;
  g.fillText(`${shown(pen.volts)}V`, w / 2, h / 2);
}

/** The band of the label: a large + and - under their snaps, a fine rule above and below. No name, no mark. */
function polarity(g: CanvasRenderingContext2D, xPlus: number, xMinus: number, y: number): void {
  g.strokeStyle = GRAPHITE;
  g.lineCap = 'round';
  g.lineWidth = 1.0;
  g.beginPath();
  g.moveTo(xPlus - 2.3, y);
  g.lineTo(xPlus + 2.3, y);
  g.moveTo(xPlus, y - 2.3);
  g.lineTo(xPlus, y + 2.3);
  g.moveTo(xMinus - 2.3, y);
  g.lineTo(xMinus + 2.3, y);
  g.stroke();
  g.lineCap = 'butt';
  g.lineWidth = 0.3;
  g.beginPath();
  for (const dy of [-4.6, 4.6]) {
    g.moveTo(-11.5, y + dy);
    g.lineTo(11.5, y + dy);
  }
  g.stroke();
}

export default defineModel<PartState>({
  id: M.id,
  title: '9 V battery (PP3)',
  footprintMm: footprintOf(M.body),
  terminals,
  build(ctx) {
    const s = new Shape();
    const jacket = roundedRectLoop(0, 0, W, D, 2.3, ctx.seg(4));
    // bottom rim and plate, the lacquered jacket in the label's three colours, the rolled top rim round the plate
    s.box(...PAL.steel, 0, 0, W - 1.6, D - 1.6, 0, 0.5, 1.6, 0, { ao: 0.8 });
    extrude(s, PAL.steel, jacket, 0.15, 1.0, 0, { open: true, ao: 0.7 });
    extrude(s, ['gloss', GRAPHITE], jacket, 1.0, BAND - 0.9, 0, { open: true, ao: 0.92 });
    extrude(s, ['gloss', CREAM], jacket, BAND - 0.9, BAND, 0, { open: true, ao: 1 });
    extrude(s, ['gloss', AMBER], jacket, BAND, RIM - 1.0, 0, { open: true, ao: 1 });
    s.prism(...PAL.steel, jacket, RIM - 1.0, RIM, 0.5, { ao: 1, holes: [roundedRectLoop(0, 0, W - 2.2, D - 2.2, 1.4, ctx.seg(3))] });
    s.box(...PAL.plasticBlack, 0, 0, W - 2, D - 2, RIM - 1.0, PLATE, 1.5, 0, { ao: 1 });
    pp3Snaps(s, { pos: POS, neg: NEG, y: PLATE, seg: ctx.seg(16) });
    const root = s.toObject();

    const front = frontQuad(0, RIM / 2, D / 2 + 0.02, W / 2 - 1.2, RIM / 2 - 1.2);
    const mid = RIM / 2; // a print's y for a height on the body: mid - height
    root.add(
      print({
        name: 'front',
        quad: front,
        ppm: 14,
        draw(g) {
          const y = (height: number) => mid - height;
          // on the amber band: the polarity under each snap, between two fine lines
          polarity(g, POS[0], NEG[0], y(BAND + (RIM - 1 - BAND) / 2));
          // on the dark body, under the numeral: what it is
          g.fillStyle = AMBER;
          text(g, 'ALKALINE', 0, y(8.4), 2.5, { weight: 700, font: FONT_HEAD, spacing: 0.75 });
          g.fillStyle = 'rgba(245, 238, 222, 0.82)';
          text(g, '6LR61  ·  PP3', 0, y(5.1), 1.7, { weight: 600 });
          g.strokeStyle = 'rgba(245, 238, 222, 0.5)';
          g.lineWidth = 0.18;
          g.beginPath();
          g.moveTo(-9.5, y(11.2));
          g.lineTo(9.5, y(11.2));
          g.stroke();
        },
      }),
      print({
        name: 'back',
        quad: movedQuad(front, new Matrix4().makeRotationY(Math.PI)),
        ppm: 14,
        draw(g) {
          const y = (height: number) => mid - height;
          // seen from behind the snaps swap sides
          polarity(g, -POS[0], -NEG[0], y(BAND + (RIM - 1 - BAND) / 2));
          g.fillStyle = 'rgba(245, 238, 222, 0.85)';
          const lines = ['ALKALINE BATTERY', '6LR61 / 6AM6 / PP3', '9 V ⎓  550 mAh', '', 'Do not recharge, short', 'or open. Mind the poles.'];
          lines.forEach((l, i) => text(g, l, -9.6, y(25) + i * 2.5, i < 3 ? 1.75 : 1.45, { weight: i === 0 ? 700 : 500, align: 'left' }));
          g.fillStyle = 'rgba(245, 238, 222, 0.6)';
          text(g, 'BEST BEFORE 2031', 0, y(4.2), 1.25, { weight: 500, spacing: 0.15 });
        },
      }),
      // the voltage, drawn per copy: the numeral of the label, and between the snaps as in the part's picture
      screen('volts', frontQuad(0, 19, D / 2 + 0.03, 11.5, 6.5), 14, { lit: false }),
      screen('top', topQuad((POS[0] + 3.9 + NEG[0] - 4.7) / 2, 0, PLATE + 0.02, 2.2, 2.6), 16, { lit: false }),
    );
    // the overload look: a hot shell round the jacket, hidden while the cell is within its limit
    const hot = new Shape();
    hot.box('glass', '#ff5a2a', 0, 0, W + 0.3, D + 0.3, 0.1, RIM + 0.15, 2.45, 0.6, { ao: 1 });
    const heat = glowing('heat', hot);
    heat.visible = false;
    root.add(heat);
    return root;
  },
  animate(st, obj, env) {
    pen.volts = Number(st.fields.volts ?? DEFAULT_VOLTS);
    const key = Math.round(pen.volts * 10);
    drawScreen(obj, 'volts', key, drawFront);
    drawScreen(obj, 'top', key, drawTop);
    const heat = part(obj, 'heat')!;
    const ma = Math.abs(Number(st.outputs.current_ma ?? 0));
    if (ma <= MAX_MA) {
      heat.visible = false;
      return;
    }
    // 0 just over the limit, 1 at a dead short (several times the limit)
    const over = Math.min(1, (ma - MAX_MA) / (MAX_MA * 4));
    const beat = 0.5 + 0.5 * Math.sin(env.time * (6 + over * 12));
    heat.visible = true;
    heat.scale.set(1 + 0.012 * beat, 1, 1 + 0.02 * beat);
    setLamp(obj, 'heat', over > 0.5 ? 0xff2a12 : 0xff6a1a, 0.3 + over * 0.45 + beat * 0.25);
    return true;
  },
  states: {
    idle: partState({ fields: { volts: DEFAULT_VOLTS }, outputs: { current_ma: 0 } }),
    'set-7v5': partState({ fields: { volts: 7.5 }, outputs: { current_ma: 20 } }),
    loaded: partState({ fields: { volts: DEFAULT_VOLTS }, outputs: { current_ma: 320 } }),
    overload: partState({ fields: { volts: DEFAULT_VOLTS }, outputs: { current_ma: 800 } }),
    short: partState({ fields: { volts: DEFAULT_VOLTS }, outputs: { current_ma: 4500 } }),
  },
});
