/**
 * Kode Maker module (KDMKR001 rev 1.0): a passive breadboard carrier for the Dot's expansion header.
 *
 * Sources: parts/kode-maker/manifest.json (footprint 58 x 52 x 12 mm, an ESTIMATE; all 200 terminals), the written
 * spec research/06-official-modules-spec.md section 2 (J502: fourteen GPIO sockets; J503 to J506: four-socket 5 V,
 * 3.3 V and ground strips; an SYB-170 breadboard, 45.5 x 34.5 mm, glued in the middle; the silkscreen ratings "5V-1A"
 * and "3V3-1A"; the 2x10 right-angle J401) and the maker's store picture for the look (black board with eared
 * corners, a white breadboard with its centre channel, black socket rows, amber print, tinned header pins).
 *
 * Every socket and every breadboard hole is drawn on its manifest terminal. The 170 holes are print, not geometry
 * (the board is drawn many times over). J401 has no terminals of its own in the manifest (the sockets are the mount
 * pins), so it sits where the real one is: the middle of the edge opposite the socket row, pins pointing at the
 * viewer (+Z, into the Dot's top wall). The footprint leaves 8 mm between the breadboard and that edge, so the
 * header's bends are hidden behind its plastic and the pins are 5.4 mm long instead of 6.
 *
 * The board is passive: nothing lights. Its one hazard, more than a GPIO socket stands (5 V on a 3.3 V line), shows
 * as a red-hot collar round the socket. No maker's logo or wordmark: the print is the plain designation.
 */
import manifest from '../../../../../parts/kode-maker/manifest.json';
import { FONT_HEAD, FONT_MONO, INK, PAL, PITCH, Shape, defineModel, footprintOf, glowing, part, partState, print, roundedRectLoop, setLamp, terminalsFromManifest, text, topQuad, type PartState } from '../../index';
import { asManifest, earOutline, outlineBoard, pinPoints, rightAngleHeader, socketStrip, stripBetween, type KodeMount } from './shared';

const M = asManifest(manifest);
const terminals = terminalsFromManifest(M);
const at = pinPoints(M);
const { w: W, d: D } = footprintOf(M.body);

const BOARD_Y = 1.3; // the board rests on the solder joints of its sockets
const TOP = BOARD_Y + 1.6;
const SOCKET_H = 8.5;
/** The breadboard: every tie point of the manifest, and the documented 45.5 x 34.5 mm body centred on them. */
const TIES = M.pins.filter((p) => /^[a-j]\d+$/.test(p.name)).map((p) => at[p.name]);
const BB = {
  x: (Math.min(...TIES.map((p) => p[0])) + Math.max(...TIES.map((p) => p[0]))) / 2,
  z: (Math.min(...TIES.map((p) => p[2])) + Math.max(...TIES.map((p) => p[2]))) / 2,
  w: 45.5,
  d: 34.5,
  h: 8.5,
};
/** The channel between rows e and f. */
const CHANNEL = { z: (at.e1[2] + at.f1[2]) / 2, w: BB.w - 7, d: at.f1[2] - at.e1[2] - 2.3 };
/** J401: its plastic stands against the breadboard, its pins end at the footprint's edge. */
const J401_Z = BB.z + BB.d / 2 + 0.05 + PITCH;
const J401_LEN = D / 2 - 0.1 - J401_Z;
const OUTLINE = earOutline({ x0: -W / 2, x1: W / 2, z0: -D / 2, z1: J401_Z + 1.2, ear: 4.4, inset: { far: 1.5, near: 1.2, side: 0.25 } });

/** The GPIO sockets with the most each one stands (the manifest's abs_max_mv), for the overvoltage look. */
const SOCKETS = (M.mount?.pins ?? []).map((m) => ({ name: m.pin, x: at[m.pin][0], max: M.pins.find((p) => p.name === m.pin)?.abs_max_mv ?? 3600 }));
const S_FIRST = at[SOCKETS[0].name], S_LAST = at[SOCKETS[SOCKETS.length - 1].name];

export default defineModel<PartState>({
  id: M.id,
  title: 'Kode Maker module',
  footprintMm: footprintOf(M.body),
  build() {
    const s = new Shape();
    outlineBoard(s, { loop: OUTLINE.loop, y: BOARD_Y, holes: OUTLINE.ears.map(([x, z]) => ({ x, z, d: 3.2 })) });

    // J502, the fourteen GPIO sockets, and the four power strips as two 2 x 4 blocks
    socketStrip(s, { ...stripBetween(S_FIRST, S_LAST), y: TOP, n: SOCKETS.length, h: SOCKET_H });
    for (const [a, b] of [['V5_1', 'GL_4'], ['V33_1', 'GR_4']] as const) socketStrip(s, { x: (at[a][0] + at[b][0]) / 2, z: (at[a][2] + at[b][2]) / 2, y: TOP, n: 4, rows: 2, turn: 1, h: SOCKET_H });
    const tip = rightAngleHeader(s, { x: 0, y: TOP, z: J401_Z, n: 10, length: J401_LEN, legs: false });

    // the breadboard on its foam pad: a white block with the channel cut through, and the channel's floor
    s.box('soft', '#d9d5cb', BB.x, BB.z, BB.w - 1.2, BB.d - 1.2, TOP, TOP + 0.9, 1, 0, { ao: 0.8 });
    s.prism(...PAL.plasticWhite, roundedRectLoop(BB.x, BB.z, BB.w, BB.d, 1.1, 3), TOP + 0.9, TOP + BB.h, 0.45, {
      ao: 0.86,
      holes: [roundedRectLoop(BB.x, CHANNEL.z, CHANNEL.w, CHANNEL.d, 0.7, 3)],
    });
    s.box('matte', '#8d887d', BB.x, CHANNEL.z, CHANNEL.w, CHANNEL.d, TOP + 0.9, TOP + BB.h - 3, 0.7, 0, { ao: 1 });

    const root = s.toObject();
    const top = TOP + BB.h;
    // the collar that glows round an overloaded socket: built on the first one, moved by `animate`, hidden until then
    const collar = new Shape();
    collar.prism('gloss', '#c2241c', roundedRectLoop(S_FIRST[0], S_FIRST[2], 7, 7, 2, 4), TOP + SOCKET_H - 0.9, TOP + SOCKET_H + 0.45, 0.35, {
      ao: 1,
      holes: [roundedRectLoop(S_FIRST[0], S_FIRST[2], 2.7, 2.7, 0.3, 2)],
    });
    const hot = glowing('hot', collar);
    hot.visible = false;
    root.add(
      print({
        name: 'holes',
        quad: topQuad(BB.x, BB.z, top + 0.02, BB.w / 2, BB.d / 2),
        ppm: 16,
        draw(g) {
          // each tie point: a chamfered square mouth with the spring's shadow inside
          for (const p of TIES) {
            const x = p[0] - BB.x, y = p[2] - BB.z;
            g.fillStyle = 'rgba(150,142,128,0.55)';
            g.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
            g.fillStyle = '#242220';
            g.fillRect(x - 0.56, y - 0.56, 1.12, 1.12);
            g.fillStyle = 'rgba(8,8,8,0.6)';
            g.fillRect(x - 0.56, y - 0.56, 1.12, 0.4);
          }
          // the row letters moulded beside the first and last columns, the column numbers along the channel
          g.fillStyle = 'rgba(96,90,80,0.62)';
          const x0 = TIES[0][0] - BB.x;
          'abcdefghij'.split('').forEach((c) => {
            const y = at[`${c}1`][2] - BB.z;
            text(g, c, x0 - 1.75, y, 1.05, { font: FONT_MONO, weight: 700 });
            text(g, c, -x0 + 1.75, y, 1.05, { font: FONT_MONO, weight: 700 });
          });
          for (const n of [1, 5, 10, 15, 17]) {
            text(g, String(n), at[`a${n}`][0] - BB.x, at.a1[2] - BB.z - 1.75, 1.0, { font: FONT_MONO, weight: 700 });
            text(g, String(n), at[`j${n}`][0] - BB.x, at.j1[2] - BB.z + 1.75, 1.0, { font: FONT_MONO, weight: 700 });
          }
        },
      }),
      print({
        name: 'silk',
        quad: topQuad(0, 0, TOP + 0.02, W / 2, D / 2),
        ppm: 16,
        draw(g) {
          g.fillStyle = INK.amber;
          const mono = (t: string, x: number, z: number, size = 1.1, angle = 0) => text(g, t, x, z, size, { font: FONT_MONO, weight: 700, angle });
          // socket numbers, as the docs' socket table counts them
          SOCKETS.forEach((so, i) => mono(String(i + 1), so.x, S_FIRST[2] + 2.5, 1.15));
          text(g, 'GPIO', S_LAST[0] + 5.2, S_LAST[2] + 0.1, 1.5, { font: FONT_HEAD, weight: 700 });
          // the strips, named along their columns, and the documented ratings
          const below = at.V5_4[2] + 3.2;
          mono('5V', at.V5_1[0], below, 1.1, -Math.PI / 2);
          mono('GND', at.GL_1[0], below + 0.3, 1.1, -Math.PI / 2);
          mono('3V3', at.V33_1[0], below + 0.3, 1.1, -Math.PI / 2);
          mono('GND', at.GR_1[0], below + 0.3, 1.1, -Math.PI / 2);
          const side = (at.V5_1[0] + at.GL_1[0]) / 2;
          text(g, '5V-1A', side, below + 9.5, 1.35, { font: FONT_HEAD, weight: 700, angle: -Math.PI / 2 });
          text(g, '3V3-1A', -side, below + 9.5, 1.35, { font: FONT_HEAD, weight: 700, angle: -Math.PI / 2 });
          g.lineWidth = 0.16;
          g.strokeStyle = INK.amber;
          for (const sx of [-1, 1]) {
            g.beginPath();
            g.moveTo(sx * side, below + 2.6);
            g.lineTo(sx * side, below + 4.6);
            g.stroke();
          }
          // the plain designation beside J401, where the maker prints its mark
          text(g, 'MAKER', -17.6, J401_Z - 1.25, 1.75, { font: FONT_HEAD, weight: 700, spacing: 0.35 });
          mono('KDMKR001 r1.0', 18.2, J401_Z - 1.25, 0.95);
        },
      }),
      hot,
    );
    root.userData.kodeMount = { pos: tip, dir: [0, 0, 1], via: M.mount?.via ?? 'direct' } satisfies KodeMount;
    return root;
  },
  terminals,
  animate(st, obj, env) {
    // the worst overloaded GPIO socket (each has a 3.3 V protection diode behind 68 ohm: 5 V on it is the hazard)
    let worst = -1, over = 0;
    for (let i = 0; i < SOCKETS.length; i++) {
      const p = st.pins[SOCKETS[i].name];
      if (p && !p.floating && p.mv - SOCKETS[i].max > over) {
        over = p.mv - SOCKETS[i].max;
        worst = i;
      }
    }
    const flagged = st.outputs.overvoltage === true;
    const hot = part(obj, 'hot')!;
    hot.visible = worst >= 0 || flagged;
    if (!hot.visible) return;
    // a hazard the engine flags without saying where: the middle of the row
    hot.position.x = (worst >= 0 ? SOCKETS[worst].x : (S_FIRST[0] + S_LAST[0]) / 2) - S_FIRST[0];
    setLamp(obj, 'hot', 0xff1800, 0.35 + 0.55 * Math.abs(Math.sin(env.time * 7)));
    return true;
  },
  states: {
    idle: partState({}),
    overvoltage: partState({ pins: { S5: { mv: 5000, level: 1, floating: false } } }),
  },
});
