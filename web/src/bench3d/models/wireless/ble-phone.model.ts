/**
 * Phone: a plain slab (72 x 148 x 9 mm) with a glass front. Its screen shows what the phone is doing with the Dot:
 * out of range, in range, connected, paired, and the passkey box while pairing asks for the code. No maker's marks.
 */
import { FONT as FONT_BODY, FONT_HEAD, Shape, defineModel, drawScreen, screen, topQuad } from '../../index';
import { state, type WirelessState } from './state';

export default defineModel<WirelessState>({
  id: 'ble.phone',
  title: 'Phone',
  footprintMm: { w: 72, d: 148, h: 9 },
  build() {
    const s = new Shape();
    s.box('metal', '#8f9299', 0, 0, 72, 148, 0.4, 8.2, 9, 1.4);
    s.box('gloss', '#0d0e10', 0, 0, 69.6, 145.6, 8.2, 8.9, 8, 0.3);
    s.box('gloss', '#15171a', 22, -58, 16, 16, 0, 0.5, 4, 0.2);
    s.box('metal', '#7c7f86', 35.5, -30, 0.9, 14, 3.4, 5.6, 0.3, 0.2);
    const root = s.toObject();
    root.add(screen('display', topQuad(0, 0, 8.93, 33, 71), 6));
    return root;
  },
  animate(st, obj) {
    const name = String(st.fields.name ?? 'Phone');
    const connected = st.live.connected === true, secure = st.live.secure === true, bonded = st.live.bonded === true;
    const asking = st.live.asking === true;
    drawScreen(obj, 'display', `${name}|${st.near}|${connected}|${secure}|${bonded}|${asking}`, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, st.near ? '#1c3a66' : '#1a1c21');
      grad.addColorStop(1, st.near ? '#0e1830' : '#0e0f12');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffffff';
      g.font = `700 ${w * 0.13}px ${FONT_HEAD}`;
      g.fillText(name.slice(0, 14), w / 2, h * 0.16);
      // the link: a row of three dots (in range, connected, secure)
      const on = [st.near, connected, secure];
      on.forEach((v, i) => {
        g.beginPath();
        g.arc(w / 2 + (i - 1) * w * 0.14, h * 0.27, w * 0.035, 0, Math.PI * 2);
        g.fillStyle = v ? '#63d08a' : 'rgba(255,255,255,0.22)';
        g.fill();
      });
      if (asking) {
        // the passkey box: six places
        g.fillStyle = 'rgba(255,255,255,0.94)';
        g.beginPath();
        g.roundRect(w * 0.08, h * 0.42, w * 0.84, h * 0.2, w * 0.05);
        g.fill();
        g.fillStyle = '#1b1c20';
        for (let i = 0; i < 6; i++) g.fillRect(w * 0.16 + i * w * 0.118, h * 0.555, w * 0.085, h * 0.008);
        g.font = `600 ${w * 0.075}px ${FONT_BODY}`;
        g.fillText('0–9', w / 2, h * 0.48);
      } else if (bonded || secure) {
        // a closed padlock
        g.strokeStyle = '#63d08a';
        g.lineWidth = w * 0.03;
        g.beginPath();
        g.arc(w / 2, h * 0.47, w * 0.09, Math.PI, 0);
        g.stroke();
        g.fillStyle = '#63d08a';
        g.beginPath();
        g.roundRect(w * 0.36, h * 0.47, w * 0.28, h * 0.1, w * 0.03);
        g.fill();
      }
      // the home bar
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath();
      g.roundRect(w * 0.32, h * 0.955, w * 0.36, h * 0.012, h * 0.006);
      g.fill();
    });
  },
  states: {
    away: state({ fields: { name: 'Phone' } }),
    'in range': state({ near: true, fields: { name: 'Phone' } }),
    pairing: state({ near: true, fields: { name: 'Phone' }, live: { connected: true, asking: true } }),
    paired: state({ near: true, fields: { name: 'Phone' }, live: { connected: true, secure: true, bonded: true } }),
  },
});
