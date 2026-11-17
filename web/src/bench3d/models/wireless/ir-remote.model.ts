/**
 * Infrared remote: a slim six-button remote (40 x 118 x 12 mm). Its emitter end is its front (+Z): aimed at the Dot it
 * points at it. The buttons are separate caps that go down when pressed; a small lamp shows it is sending.
 */
import { Shape, defineModel, lamp, part, powerSign, print, rr, setLamp, text, topQuad } from '../../index';
import { state, type WirelessState } from './state';

/** Where the buttons sit on the face (x, z) and how big they are. The ids are the bench's button names. */
export const REMOTE_BUTTONS: Record<string, { x: number; z: number; r: number; colour: string }> = {
  Power: { x: -10, z: 42, r: 5.2, colour: '#c9303d' },
  Mute: { x: 10, z: 42, r: 5.2, colour: '#5b5b62' },
  'Vol+': { x: -10, z: 21, r: 6.3, colour: '#4a4a51' },
  'Vol-': { x: -10, z: 3.5, r: 6.3, colour: '#4a4a51' },
  'Ch+': { x: 10, z: 21, r: 6.3, colour: '#4a4a51' },
  'Ch-': { x: 10, z: 3.5, r: 6.3, colour: '#4a4a51' },
};
export const REMOTE_FACE_Y = 9.9;
const CAP_H = 1.7;
const IDS = Object.keys(REMOTE_BUTTONS);

export default defineModel<WirelessState>({
  id: 'ir.remote',
  title: 'Remote',
  footprintMm: { w: 40, d: 118, h: 12 },
  build(ctx) {
    const s = new Shape();
    s.box('matte', '#2b2b2f', 0, 0, 40, 118, 0, 9.5, 13.5, 2.2);
    s.box('soft', '#37373c', 0, 0, 33.5, 111, 9.5, REMOTE_FACE_Y, 10.5, 0.3);
    // the dark red window of the emitter
    s.box('gloss', '#4d1016', 0, 58.3, 17, 1.2, 2.6, 7.6, 0.5, 0.4, { ao: 1 });
    const root = s.toObject();
    root.add(
      print({
        name: 'face',
        quad: topQuad(0, 0, REMOTE_FACE_Y + 0.02, 16.5, 55),
        ppm: 8,
        draw(g) {
          // the remote's own way up: its top is the emitter end
          g.rotate(Math.PI);
          g.fillStyle = 'rgba(235,230,220,0.62)';
          text(g, 'VOL', 10, -12.2, 2.6, { weight: 700, spacing: 0.4 });
          text(g, 'CH', -10, -12.2, 2.6, { weight: 700, spacing: 0.4 });
          // grip ribs towards the hand
          g.fillStyle = 'rgba(0,0,0,0.28)';
          for (let i = 0; i < 6; i++) {
            rr(g, -10, 18 + i * 5.2, 20, 1.6, 0.8);
            g.fill();
          }
        },
      }),
      lamp('tx', [0, REMOTE_FACE_Y, 52.5], [1.1, 0.55, 1.1]),
    );
    // the legends of all six buttons in one print at the height of the caps' tops (a pressed cap sinks under it by less than a millimetre)
    root.add(
      print({
        name: 'legends',
        quad: topQuad(0, 0, REMOTE_FACE_Y + CAP_H + 0.03, 20, 59),
        ppm: 9,
        draw(g) {
          for (const id of IDS) {
            const b = REMOTE_BUTTONS[id];
            g.save();
            g.translate(b.x, b.z);
            g.rotate(Math.PI);
              g.strokeStyle = g.fillStyle = '#ffffff';
              g.lineCap = 'round';
              g.lineJoin = 'round';
              if (id === 'Power') powerSign(g, 0, 0.2, b.r * 0.42, 0.85);
              else if (id === 'Mute') {
                g.beginPath();
                g.moveTo(-2.6, -1);
                g.lineTo(-1.1, -1);
                g.lineTo(0.7, -2.4);
                g.lineTo(0.7, 2.4);
                g.lineTo(-1.1, 1);
                g.lineTo(-2.6, 1);
                g.closePath();
                g.fill();
                g.lineWidth = 0.7;
                g.beginPath();
                g.moveTo(1.7, -1.2);
                g.lineTo(3.3, 1.2);
                g.moveTo(3.3, -1.2);
                g.lineTo(1.7, 1.2);
                g.stroke();
              } else if (id.startsWith('Vol')) {
                g.lineWidth = 1.0;
                g.beginPath();
                g.moveTo(-2.4, 0);
                g.lineTo(2.4, 0);
                if (id === 'Vol+') {
                  g.moveTo(0, -2.4);
                  g.lineTo(0, 2.4);
                }
                g.stroke();
              } else {
                const up = id === 'Ch+';
                g.lineWidth = 1.0;
                g.beginPath();
                g.moveTo(-2.5, up ? 1.2 : -1.2);
                g.lineTo(0, up ? -1.3 : 1.3);
                g.lineTo(2.5, up ? 1.2 : -1.2);
                g.stroke();
              }
            g.restore();
          }
        },
      }),
    );
    for (const id of IDS) {
      const b = REMOTE_BUTTONS[id];
      const cap = new Shape();
      cap.disc('soft', b.colour, 0, 0, b.r, 0, CAP_H, 0.55, ctx.seg(22), { ao: 0.85 });
      const node = cap.toObject(`cap:${id}`);
      node.position.set(b.x, REMOTE_FACE_Y, b.z);
      root.add(node);
    }
    return root;
  },
  animate(st, obj) {
    for (let i = 0; i < IDS.length; i++) {
      const cap = part(obj, `cap:${IDS[i]}`);
      if (cap) cap.position.y = REMOTE_FACE_Y - (st.pressed === IDS[i] ? 0.95 : 0);
    }
    setLamp(obj, 'tx', 0xff3b30, st.pressed ? 1 : 0);
  },
  states: { idle: state({ near: true }), pressing: state({ near: true, pressed: 'Vol+' }) },
});
