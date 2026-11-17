/**
 * Bluetooth sensor: a small round puck (about 40 mm) with a segment display showing the temperature it advertises and
 * a status lamp that glows while it is in range. Markings are functional only ("°C", a battery gauge).
 */
import { FONT_HEAD, Shape, defineModel, drawScreen, lamp, screen, setLamp, topQuad } from '../../index';
import { state, type WirelessState } from './state';

export default defineModel<WirelessState>({
  id: 'ble.sensor',
  title: 'Bluetooth sensor',
  footprintMm: { w: 40, d: 40, h: 12 },
  build() {
    const s = new Shape();
    s.disc('matte', '#ecebe6', 0, 0, 20, 0, 9.4, 1.6, 40);
    s.disc('soft', '#2a2c30', 0, 0, 18.4, 0, 0.8, 0.2, 36);
    s.disc('gloss', '#17181b', 0, -1, 12.6, 9.4, 10, 0.3, 36);
    s.box('matte', '#d5d3cc', 0, 16.6, 6, 2.2, 9.4, 9.9, 0.8, 0.2);
    const root = s.toObject();
    root.add(screen('face', topQuad(0, -1, 10.03, 9.6, 6.2), 10));
    root.add(lamp('status', [0, 9.9, 13], 1.1));
    return root;
  },
  animate(st, obj) {
    const temp = Number(st.fields.temperature ?? 21.5);
    const batt = Math.round(Number(st.fields.battery ?? 90));
    setLamp(obj, 'status', 0x3d8bff, st.near ? 1.2 : 0);
    drawScreen(obj, 'face', `${temp}|${batt}|${st.near}`, (g, w, h) => {
      g.fillStyle = '#0b0d10';
      g.fillRect(0, 0, w, h);
      g.fillStyle = st.near ? '#cfe6ff' : '#5c6470';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `700 ${h * 0.5}px ${FONT_HEAD}`;
      g.fillText(`${temp.toFixed(1)}°C`, w / 2, h * 0.42);
      // the battery gauge
      const bw = w * 0.3, bh = h * 0.16, bx = (w - bw) / 2, by = h * 0.76;
      g.strokeStyle = g.fillStyle;
      g.lineWidth = Math.max(1, h * 0.025);
      g.strokeRect(bx, by, bw, bh);
      g.fillRect(bx + 2, by + 2, Math.max(0, (bw - 4) * (batt / 100)), bh - 4);
    });
  },
  states: {
    'in range': state({ near: true, fields: { temperature: 21.5, battery: 90 } }),
    away: state({ fields: { temperature: -4, battery: 20 } }),
  },
});
