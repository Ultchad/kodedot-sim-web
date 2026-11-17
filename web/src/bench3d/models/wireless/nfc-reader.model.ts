/** NFC reader: a desktop USB reader (about 68 x 92 x 13 mm) with a landing pad, a status light and its lead. */
import { INK, Matrix4, PAL, Shape, defineModel, lamp, print, rr, setLamp, text, topQuad, waves } from '../../index';
import { state, type WirelessState } from './state';

export default defineModel<WirelessState>({
  id: 'nfc.reader',
  title: 'NFC reader',
  footprintMm: { w: 68, d: 100, h: 13.5 },
  build() {
    const s = new Shape();
    s.box(...PAL.plasticCream, 0, 2, 68, 92, 0.6, 12.4, 12, 1.6);
    s.box('soft', '#38373b', 0, 4, 54, 64, 12.4, 12.95, 9, 0.35);
    // the lead: a gland at the back, the cable down to the table, a USB plug beside it
    s.box(...PAL.rubber, 0, -45.6, 9, 4.6, 3.4, 9.4, 1.4, 0.5);
    s.tube(...PAL.rubber, [[0, 6.4, -46.4], [0.4, 4.6, -47.6], [3, 2.2, -48], [10, 1.7, -47.7], [20.6, 1.9, -46.8]], 1.5, 8);
    const turn = new Matrix4().makeRotationY(-0.5);
    s.block(...PAL.rubber, 4.6, 2.3, 3.3, new Matrix4().makeTranslation(24.6, 2.4, -44.6).multiply(turn), 0.5);
    s.block(...PAL.tin, 3.4, 1.4, 2.6, new Matrix4().makeTranslation(29.6, 2.4, -41.9).multiply(turn), 0.2);
    const root = s.toObject();
    root.add(
      print({
        name: 'pad',
        quad: topQuad(0, 4, 12.97, 27, 32),
        ppm: 8,
        draw(g) {
          g.strokeStyle = 'rgba(235,230,220,0.55)';
          g.lineWidth = 0.5;
          g.setLineDash([2.2, 1.8]);
          rr(g, -20, -24, 40, 48, 7);
          g.stroke();
          g.setLineDash([]);
          g.strokeStyle = INK.amber;
          waves(g, -5.2, 0, 11.5, 3, 0, 1.7);
          g.fillStyle = INK.amber;
          g.beginPath();
          g.arc(-5.2, 0, 1.5, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = 'rgba(235,230,220,0.7)';
          text(g, '13.56 MHz', 0, 19.5, 2.7, { spacing: 0.3 });
        },
      }),
      lamp('status', [0, 12.45, 42.6], [5.5, 0.75, 1.25]),
    );
    return root;
  },
  animate(st, obj, env) {
    // a quiet blue while it waits near the Dot, a green flash when it has just seen the Dot's tag
    const fresh = st.sinceEvent < 1.4;
    if (fresh) setLamp(obj, 'status', 0x35d06a, 0.6 + 0.4 * Math.abs(Math.sin(env.time * 9)));
    else setLamp(obj, 'status', 0x3aa0ff, st.near ? 0.45 : 0.12);
    return fresh;
  },
  states: { away: state({}), waiting: state({ near: true }), saw: state({ near: true, sinceEvent: 0.2, tone: 'ok' }) },
});
