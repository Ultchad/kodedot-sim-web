/**
 * Wi-Fi router: a small home router with two antennas, the COMPLEX reference model of the kit.
 * Static body in three families, a print on its top, three lamps driven by `animate`.
 * Size after the common travel/home routers (about 120 x 65 x 22 mm, antennas about 70 mm).
 */
import { INK, PAL, Shape, defineModel, lamp, powerSign, print, rr, setLamp, topQuad, waves, type Pt } from '../../index';
import { state, type WirelessState } from './state';

const GREEN = 0x35d06a, AMBER = 0xffac00, BLUE = 0x3aa0ff;

export default defineModel<WirelessState>({
  id: 'wifi.router',
  title: 'Wi-Fi router',
  footprintMm: { w: 118, d: 78, h: 88 },
  build(ctx) {
    const s = new Shape();
    for (const [x, z] of [[-48, -18], [48, -18], [-48, 30], [48, 30]] as Pt[]) s.disc(...PAL.rubber, x, z, 4.2, 0, 2.4, 0.4, ctx.seg(14));
    s.box(...PAL.plasticWhite, 0, 6, 118, 62, 2, 22, 13, 2.4);
    // the dark window the lamps sit behind
    s.box(...PAL.glossBlack, 0, 37.2, 86, 1.6, 6.5, 14.5, 0.7, 0.35, { ao: 1 });
    for (const sx of [-1, 1]) {
      s.disc(...PAL.plasticBlack, sx * 45, -29.5, 4.6, 5, 16.5, 1, ctx.seg(18));
      s.tube(...PAL.plasticBlack, [[sx * 45, 14, -29.5], [sx * 46.4, 40, -30.6], [sx * 49.5, 86, -32]], 3.1, ctx.seg(12));
      s.disc(...PAL.plasticBlack, sx * 49.6, -32, 3.1, 85.4, 87.6, 1.1, ctx.seg(12));
    }
    const root = s.toObject();
    root.add(
      print({
        name: 'top',
        quad: topQuad(0, 6, 22.03, 59, 31),
        ppm: 6,
        draw(g) {
          // cooling slots at the back, the radio sign at the front
          g.fillStyle = 'rgba(60,56,50,0.42)';
          for (let r = 0; r < 4; r++) for (let c = -5; c <= 5; c++) {
            rr(g, c * 8.6 - 3.2, -24 + r * 4.2, 6.4, 1.5, 0.75);
            g.fill();
          }
          g.strokeStyle = INK.amber;
          waves(g, 38, 21, 11, 3, -Math.PI / 2, 1.9);
          g.fillStyle = INK.amber;
          g.beginPath();
          g.arc(38, 21, 1.6, 0, Math.PI * 2);
          g.fill();
          // legends over the three lamps: power, link, traffic
          g.strokeStyle = g.fillStyle = 'rgba(60,56,50,0.78)';
          powerSign(g, -30, 25.6, 1.9, 0.55);
          g.lineWidth = 0.55;
          g.beginPath();
          g.arc(-18, 25.6, 2.1, 0, Math.PI * 2);
          g.moveTo(-20.1, 25.6);
          g.lineTo(-15.9, 25.6);
          g.ellipse(-18, 25.6, 0.95, 2.1, 0, 0, Math.PI * 2);
          g.stroke();
          g.beginPath();
          g.moveTo(-8.2, 26.6);
          g.lineTo(-6.8, 24.4);
          g.lineTo(-5.4, 26.9);
          g.lineTo(-4, 24.6);
          g.stroke();
        },
      }),
      lamp('power', [-30, 10.5, 38.1], [1.6, 1.6, 0.8]),
      lamp('link', [-18, 10.5, 38.1], [1.6, 1.6, 0.8]),
      lamp('act', [-6, 10.5, 38.1], [1.6, 1.6, 0.8]),
    );
    return root;
  },
  animate(st, obj, env) {
    const on = st.fields.on !== false;
    const connected = on && st.near && st.live.connected === true;
    const joining = on && st.near && !connected && st.area.connecting === true;
    setLamp(obj, 'power', GREEN, on ? 1 : 0);
    // link: steady blue once the Dot has joined, amber blinking while it is joining, a dim amber when merely in range
    const blink = Math.floor(env.time * 5) % 2 === 0;
    setLamp(obj, 'link', connected ? BLUE : AMBER, connected ? 1 : joining ? (blink ? 1 : 0) : on && st.near ? 0.25 : 0);
    // traffic: flickers for a moment after each request of the Dot
    const busy = on && st.sinceEvent < 1.2;
    setLamp(obj, 'act', GREEN, busy && Math.floor(env.time * 14) % 2 === 0 ? 1 : 0);
    return joining || busy;
  },
  states: {
    off: state({ fields: { on: false } }),
    idle: state({ near: true, fields: { on: true } }),
    joining: state({ near: true, fields: { on: true }, area: { connecting: true } }),
    connected: state({ near: true, fields: { on: true }, live: { connected: true, ip: '192.168.4.2' }, sinceEvent: 0.1, tone: 'ok' }),
  },
});
