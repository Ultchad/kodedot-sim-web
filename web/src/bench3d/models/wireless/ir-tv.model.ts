/**
 * Infrared TV: a small flat screen on a foot (150 x 90 mm panel: a 6.7 inch desk monitor), with a picture that shows
 * what the Dot's remote codes did to it: power, channel, volume, mute. A red standby lamp when it is off.
 */
import { FONT_HEAD, Matrix4, PAL, Shape, defineModel, drawScreen, lamp, movedQuad, screen, setLamp, topQuad } from '../../index';
import { state, type WirelessState } from './state';

const PANEL = new Matrix4().makeTranslation(0, 58, 1).multiply(new Matrix4().makeRotationX((86 * Math.PI) / 180));
const at = (x: number, y: number, z: number): [number, number, number] => {
  const e = PANEL.elements;
  return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
};
/** A calm picture per channel: the page's own colours. */
const SKIES = ['#0a84b8', '#c9303d', '#1f9d55', '#ffac00', '#6b5bd6', '#d9622b'];

export default defineModel<WirelessState>({
  id: 'ir.tv',
  title: 'TV',
  footprintMm: { w: 150, d: 46, h: 104 },
  build() {
    const s = new Shape();
    s.box('soft', '#29292c', 0, 3, 78, 36, 0, 3.2, 9, 1.1);
    s.block('metal', '#7c7e84', 8, 7, 2.8, new Matrix4().makeTranslation(0, 9.5, -2), 0.8);
    s.with(PANEL, () => {
      s.box('matte', '#2d2d31', 0, 0, 98, 54, -10.5, -3, 8, 2, { cap: true, ao: 0.9 });
      s.box(...PAL.glossBlack, 0, 0, 150, 90, -3, 3, 4.5, 1, { cap: true, ao: 0.95 });
      // the receiver's window in the lower bezel
      s.box('gloss', '#3a0d12', 9, 42.1, 7, 2.2, 3, 3.05, 1, 0, { ao: 1 });
    });
    const root = s.toObject();
    root.add(screen('picture', movedQuad(topQuad(0, -1.6, 3.04, 71, 40.4), PANEL), 2.6), lamp('standby', at(0, 3.1, 42.1), [1.15, 0.5, 1.15]));
    return root;
  },
  animate(st, obj) {
    const f = st.fields;
    const on = f.power === true;
    const vol = Number(f.volume ?? 0), ch = Number(f.channel ?? 1), muted = f.muted === true;
    setLamp(obj, 'standby', 0xff3b30, on ? 0 : 0.9);
    drawScreen(obj, 'picture', on ? ch * 1000 + vol * 2 + (muted ? 1 : 0) : -1, (g, w, h) => {
      if (!on) {
        g.fillStyle = '#050506';
        g.fillRect(0, 0, w, h);
        return;
      }
      const sky = SKIES[(((ch - 1) % SKIES.length) + SKIES.length) % SKIES.length];
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
      // a sun and two hills, so a channel is a picture and not a flat colour
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.beginPath();
      g.arc(w * 0.76, h * 0.3, h * 0.13, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.beginPath();
      g.ellipse(w * 0.3, h * 1.02, w * 0.42, h * 0.4, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.34)';
      g.beginPath();
      g.ellipse(w * 0.78, h * 1.08, w * 0.4, h * 0.36, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.font = `700 ${Math.round(h * 0.26)}px ${FONT_HEAD}`;
      g.textBaseline = 'top';
      g.fillText(`CH ${ch}`, w * 0.06, h * 0.07);
      // the volume bar along the bottom
      const bw = w * 0.62, bx = w * 0.06, by = h * 0.82, bh = h * 0.07;
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.beginPath();
      g.roundRect(bx, by, bw, bh, bh / 2);
      g.fill();
      g.fillStyle = muted ? 'rgba(255,255,255,0.4)' : '#ffffff';
      g.beginPath();
      g.roundRect(bx, by, Math.max(bh, (bw * Math.min(100, Math.max(0, vol))) / 100), bh, bh / 2);
      g.fill();
      g.font = `700 ${Math.round(h * 0.11)}px ${FONT_HEAD}`;
      g.textBaseline = 'middle';
      g.fillStyle = '#ffffff';
      g.fillText(muted ? 'MUTE' : `VOL ${vol}`, bx + bw + w * 0.03, by + bh / 2);
    });
  },
  states: {
    standby: state({ fields: { power: false, volume: 20, channel: 1, muted: false } }),
    on: state({ near: true, fields: { power: true, volume: 35, channel: 3, muted: false } }),
    muted: state({ near: true, fields: { power: true, volume: 35, channel: 5, muted: true } }),
  },
});
