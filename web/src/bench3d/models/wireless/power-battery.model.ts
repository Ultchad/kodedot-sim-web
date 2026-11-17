/**
 * Battery: a single LiPo pouch cell (about 34 x 46 x 6 mm) with its tab tape, two leads and a 2-pin connector. Its
 * label is drawn per copy: the charge as a gauge, and a bolt while it charges.
 */
import { FONT_HEAD, PAL, Shape, defineModel, drawScreen, screen, topQuad } from '../../index';
import { state, type WirelessState } from './state';

export default defineModel<WirelessState>({
  id: 'power.battery',
  title: 'Battery',
  footprintMm: { w: 36, d: 54, h: 6.8 },
  build() {
    const s = new Shape();
    s.box('metal', '#aeb1b8', 0, 3, 36, 48.5, 2.5, 3.3, 2.2, 0.2);
    s.box('metal', '#c3c6cc', 0, 3, 33.6, 46, 0, 6.1, 3.2, 1.8);
    s.box('matte', '#e2a31f', 0, -19.6, 34.2, 8.6, 0, 6.4, 1.6, 0.9);
    s.tube('soft', '#c9303d', [[3.4, 4.3, -23.4], [3.4, 3.4, -25.2], [-1, 2, -25.9], [-8.6, 1.9, -25.9]], 0.75, 6);
    s.tube(...PAL.rubber, [[-0.6, 4.3, -23.4], [-0.6, 3.1, -24.9], [-3.6, 1.6, -25.1], [-8.6, 1.5, -24.9]], 0.75, 6);
    s.box(...PAL.plasticWhite, -11.6, -25.4, 6.2, 3, 0, 3.4, 0.5, 0.3);
    const root = s.toObject();
    root.add(screen('label', topQuad(0, 6.5, 6.13, 13.6, 16.5), 9, { lit: false }));
    return root;
  },
  animate(st, obj) {
    const level = Math.round(Math.min(100, Math.max(0, Number(st.live.level ?? st.fields.level ?? 0))));
    const phase = String(st.live.phase ?? 'none');
    const charging = phase === 'pre' || phase === 'fast';
    drawScreen(obj, 'label', level * 2 + (charging ? 1 : 0), (g, w, h) => {
      const u = w / 27.2; // pixels per millimetre
      g.fillStyle = '#f5f2ec';
      g.beginPath();
      g.roundRect(0, 0, w, h, 2 * u);
      g.fill();
      g.fillStyle = '#2b2a2d';
      g.font = `700 ${3.4 * u}px ${FONT_HEAD}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('Li-Po  3.7 V', w / 2, 4.6 * u);
      // the gauge: a cell outline that fills from the bottom
      const gx = 6.6 * u, gy = 9.4 * u, gw = 14 * u, gh = 15.6 * u;
      g.lineWidth = 0.9 * u;
      g.strokeStyle = '#2b2a2d';
      g.beginPath();
      g.roundRect(gx, gy, gw, gh, 1.6 * u);
      g.stroke();
      g.fillStyle = '#2b2a2d';
      g.fillRect(w / 2 - 2.4 * u, gy - 1.5 * u, 4.8 * u, 1.5 * u);
      g.fillStyle = level <= 15 ? '#c9303d' : level <= 40 ? '#ffac00' : '#1f9d55';
      const fill = ((gh - 2.2 * u) * level) / 100;
      g.beginPath();
      g.roundRect(gx + 1.1 * u, gy + gh - 1.1 * u - fill, gw - 2.2 * u, Math.max(0.01, fill), 0.8 * u);
      g.fill();
      g.fillStyle = '#2b2a2d';
      g.font = `700 ${4.2 * u}px ${FONT_HEAD}`;
      g.fillText(`${level}%`, w / 2, gy + gh + 4.2 * u);
      if (charging) {
        g.fillStyle = '#ffffff';
        g.strokeStyle = '#2b2a2d';
        g.lineWidth = 0.5 * u;
        const cx = w / 2, cy = gy + gh / 2, s = 4.6 * u;
        g.beginPath();
        g.moveTo(cx + 0.15 * s, cy - s);
        g.lineTo(cx - 0.55 * s, cy + 0.12 * s);
        g.lineTo(cx - 0.05 * s, cy + 0.12 * s);
        g.lineTo(cx - 0.2 * s, cy + s);
        g.lineTo(cx + 0.55 * s, cy - 0.2 * s);
        g.lineTo(cx + 0.05 * s, cy - 0.2 * s);
        g.closePath();
        g.fill();
        g.stroke();
      }
    });
  },
  states: { full: state({ fields: { level: 92 } }), half: state({ fields: { level: 45 }, live: { phase: 'fast' } }), low: state({ fields: { level: 9 } }) },
});
