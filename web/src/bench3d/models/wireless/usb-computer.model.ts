/**
 * Computer on a USB cable: a small laptop (150 x 104 mm, lid open) whose screen shows the serial terminal's last
 * lines. Its cable leaves from the left side and ends in the USB-C plug the Workbench puts into the Dot's port.
 */
import { Matrix4 } from 'three';
import { FONT_MONO, Shape, defineModel, drawScreen, movedQuad, frontQuad, screen } from '../../index';
import { state, type WirelessState } from './state';

/** Where the cable leaves the laptop (model frame): the left side, near the back. */
/** The base sits forward of the footprint's middle: the lid leans back over the rest. */
const OFF = 10.4;
export const COMPUTER_EXIT: [number, number, number] = [-75, 3.2, -30 + OFF];

const TILT = (-14 * Math.PI) / 180; // the lid leans back
const lid = new Matrix4().makeTranslation(0, 6, -48 + OFF).multiply(new Matrix4().makeRotationX(TILT));

export default defineModel<WirelessState>({
  id: 'usb.computer',
  title: 'Computer on a USB cable',
  footprintMm: { w: 150, d: 122, h: 96 },
  build() {
    const s = new Shape();
    s.box('metal', '#b9bcc2', 0, OFF, 150, 100, 0.6, 6, 6, 0.8);
    s.box('soft', '#2a2c30', 0, OFF, 140, 90, 0, 0.6, 5, 0.2);
    // the keyboard well, its keys as rows, and the touch pad
    s.rect('matte', '#8f9299', 0, -12 + OFF, 128, 46, 6.02);
    for (let r = 0; r < 5; r++) for (let c = 0; c < 13; c++) s.rect('matte', '#2b2d31', -57.6 + c * 9.6, -30 + OFF + r * 9, 8, 7.4, 6.05);
    s.rect('matte', '#a5a8ae', 0, 31 + OFF, 44, 26, 6.03);
    // the lid: a thin slab leaning back from the hinge
    s.block('metal', '#b9bcc2', 75, 44, 1.6, new Matrix4().copy(lid).multiply(new Matrix4().makeTranslation(0, 44, 0)), 0.6);
    s.block('gloss', '#0c0d0f', 71.5, 41, 0.3, new Matrix4().copy(lid).multiply(new Matrix4().makeTranslation(0, 44.5, 1.7)), 0.1);
    s.box('gloss', '#17181b', -74.2, -30 + OFF, 1.4, 9, 1.6, 4.8, 0.3, 0.1);
    const root = s.toObject();
    root.add(screen('display', movedQuad(frontQuad(0, 44.5, 2.06, 68, 38), lid), 4));
    return root;
  },
  animate(st, obj) {
    const text = String(st.live.text ?? '');
    const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(-9);
    drawScreen(obj, 'display', `${st.near}|${lines.join('\n')}`, (g, w, h) => {
      g.fillStyle = st.near ? '#10151c' : '#0b0c0e';
      g.fillRect(0, 0, w, h);
      g.font = `500 ${h * 0.062}px ${FONT_MONO}`;
      g.textBaseline = 'top';
      g.fillStyle = st.near ? '#9fe6b0' : '#4a4f57';
      if (!st.near) return void g.fillText('_', w * 0.04, h * 0.06);
      lines.forEach((l, i) => g.fillText(l.slice(0, 44), w * 0.04, h * (0.06 + i * 0.095)));
      g.fillText('> _', w * 0.04, h * (0.06 + lines.length * 0.095));
    });
  },
  states: {
    unplugged: state({}),
    plugged: state({ near: true, live: { text: 'console ready\nping\npong\nfile_put ok 1204 bytes' } }),
  },
});
