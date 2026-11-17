/**
 * Door reader: a wall reader (47 x 84 x 13 mm, the size of the usual 125 kHz proximity readers) on a desk stand,
 * leaning back a little, with its indicator bar: blue while waiting, green for access granted, red for denied.
 */
import { Matrix4, PAL, Shape, defineModel, lamp, movedQuad, print, rr, setLamp, topQuad, waves } from '../../index';
import { state, type WirelessState } from './state';

/** The head's own frame: its face is the top of a lying slab, stood up and leant back 10 degrees. */
const HEAD = new Matrix4().makeTranslation(0, 51, -4).multiply(new Matrix4().makeRotationX((80 * Math.PI) / 180));
const at = (x: number, y: number, z: number): [number, number, number] => {
  const e = HEAD.elements;
  return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
};

export default defineModel<WirelessState>({
  id: 'rfid.reader',
  title: 'Door reader',
  footprintMm: { w: 54, d: 46, h: 96 },
  build() {
    const s = new Shape();
    s.box('soft', '#2c2b2f', 0, 1, 54, 44, 0, 4.2, 9, 1.1);
    s.block('metal', '#8d9096', 6, 17, 2.6, new Matrix4().makeTranslation(0, 19, -11).multiply(new Matrix4().makeRotationX((-9 * Math.PI) / 180)), 0.8);
    s.with(HEAD, () => {
      s.box(...PAL.plasticCream, 0, 0, 47, 84, -6.5, 4.4, 8, 1.6, { cap: true, ao: 0.9 });
      s.box(...PAL.glossBlack, 0, 0, 40.5, 77.5, 4.4, 6.3, 5.5, 0.9, { ao: 1 });
    });
    const root = s.toObject();
    root.add(
      print({
        name: 'face',
        quad: movedQuad(topQuad(0, 6, 6.33, 19, 30), HEAD),
        ppm: 8,
        draw(g) {
          // a card held to the reader, and the sounder's grille
          g.strokeStyle = 'rgba(240,236,228,0.9)';
          g.lineWidth = 0.9;
          rr(g, -11.5, -8, 13, 19, 2);
          g.stroke();
          waves(g, 3.2, 1.5, 8.6, 3, 0, 1.0);
          g.fillStyle = 'rgba(240,236,228,0.38)';
          for (let r = 0; r < 3; r++) for (let c = -3; c <= 3; c++) {
            g.beginPath();
            g.arc(c * 2.4, 21 + r * 2.4, 0.55, 0, Math.PI * 2);
            g.fill();
          }
        },
      }),
      lamp('light', at(0, 6.5, -24), [13.5, 1.9, 1.9]),
    );
    return root;
  },
  animate(st, obj) {
    // what the reader decided about the number the Dot presents (bench/drivers/rfid.ts: visible, match)
    if (st.live.visible === true) setLamp(obj, 'light', st.live.match === true ? 0x35d06a : 0xff4336, 1);
    else setLamp(obj, 'light', 0x3aa0ff, st.near ? 0.5 : 0.14);
  },
  states: {
    away: state({}),
    waiting: state({ near: true }),
    granted: state({ near: true, live: { visible: true, match: true } }),
    denied: state({ near: true, live: { visible: true, match: false } }),
  },
});
