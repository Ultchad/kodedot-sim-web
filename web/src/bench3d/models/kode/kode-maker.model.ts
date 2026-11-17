/**
 * Kode Maker module (KDMKR001 rev 1.0): a passive breadboard carrier for the Dot's expansion header.
 *
 * Sources: parts/kode-maker/manifest.json (footprint 58 x 60 x 14 mm with the header's pins, an ESTIMATE; all 220
 * terminals; the connector's seat), the written spec research/06-official-modules-spec.md section 2 (an SYB-170
 * breadboard, 45.5 x 34.5 mm, glued in the middle; the silkscreen ratings "5V-1A" and "3V3-1A") and the maker's store
 * picture (ref-4, never copied) for everything seen: the black board with eared corners and gold-ringed holes, the
 * plain white breadboard with its closed centre channel inside a thin gold outline, the row of fourteen sockets on
 * the far edge with a small turned legend at each, the power sockets at the sides, the 2x10 right-angle header with
 * bright pins on the near edge. The print is the functional legends and the board's own name and revision; the
 * maker's name mark and web address, which the real board prints beside the header, are left out (the kit's rule).
 * The legend at each socket could not be read off the picture beyond its number: the GPIO number is printed, taken
 * from the manifest (the socket's net and the mount table).
 *
 * Every socket and every breadboard hole is drawn on its manifest terminal, the header on the connector's seat. The
 * 170 holes are print, not geometry (the board is drawn many times over).
 *
 * The board is passive: nothing lights. Its one hazard, more than a GPIO socket stands (5 V on a 3.3 V line), shows
 * as a red-hot collar round the socket: the simulator's own way of speaking, not a part of the board.
 */
import manifest from '../../../../../parts/kode-maker/manifest.json';
import { FONT, PAL, PITCH, Shape, defineModel, footprintOf, glowing, part, partState, print, roundedRectLoop, rr, setLamp, terminalsFromManifest, text, topQuad, type PartState } from '../../index';
import { SILK, asManifest, connectorOf, earOutline, outlineBoard, pinPoints, rightAngleHeader, socketStrip, stripBetween } from './shared';

const M = asManifest(manifest);
const terminals = terminalsFromManifest(M);
const at = pinPoints(M);
const { w: W, d: D } = footprintOf(M.body);
const con = connectorOf(M);

const TOP = con.seat[1] - PITCH; // the header's two rows stand 1.27 and 3.81 mm above the board
const BOARD_Y = Math.max(0, TOP - 1.6);
const EDGE = con.seat[2]; // the near edge of the board: J401's plastic ends here, its pins go on
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
const OUTLINE = earOutline({ x0: -W / 2, x1: W / 2, z0: -D / 2, z1: EDGE + 0.6, ear: 5, inset: { far: 0.4, near: 1.2, side: 0.25 }, blend: 5 });

/**
 * The GPIO sockets S1..S14 with the GPIO each carries (its net holds one pin of J401, which the mount table maps)
 * and the most each one stands (the manifest's abs_max_mv), for the legends and the overvoltage look.
 */
const SOCKETS = M.pins
  .filter((p) => /^S\d+$/.test(p.name))
  .sort((a, b) => Number(a.name.slice(1)) - Number(b.name.slice(1)))
  .map((p) => {
    const net = M.groups?.find((g) => g.pins.includes(p.name))?.pins ?? [];
    return { name: p.name, x: at[p.name][0], max: p.abs_max_mv ?? 3600, gpio: M.mount?.pins.find((mp) => net.includes(mp.pin))?.gpio };
  });
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
    rightAngleHeader(s, { x: con.seat[0], y: TOP, z: EDGE, n: 10, length: con.length, tail: TOP - BOARD_Y - 0.05 });

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
        },
      }),
      print({
        name: 'silk',
        quad: topQuad(0, 0, TOP + 0.02, W / 2, D / 2),
        ppm: 16,
        draw(g) {
          g.fillStyle = g.strokeStyle = SILK;
          const bold = (t: string, x: number, z: number, size: number, angle = 0, align: CanvasTextAlign = 'center') => text(g, t, x, z, size, { font: FONT, weight: 700, angle, align });
          // the legend of each socket, turned as on the real board, between the row and the far edge
          for (const so of SOCKETS) if (so.gpio !== undefined) bold(String(so.gpio), so.x, S_FIRST[2] - PITCH / 2 - 1.15, 1.15, -Math.PI / 2);
          // the thin outline round the breadboard
          g.lineWidth = 0.18;
          rr(g, BB.x - BB.w / 2 - 0.7, BB.z - BB.d / 2 - 0.7, BB.w + 1.4, BB.d + 1.4, 0.6);
          g.stroke();
          // the strips, named along their columns, and the documented ratings
          const below = at.V5_4[2] + 3.4;
          bold('5V', at.V5_1[0], below, 1.15, -Math.PI / 2);
          bold('GND', at.GL_1[0], below + 0.4, 1.15, -Math.PI / 2);
          bold('3V3', at.V33_1[0], below + 0.4, 1.15, -Math.PI / 2);
          bold('GND', at.GR_1[0], below + 0.4, 1.15, -Math.PI / 2);
          const side = (at.V5_1[0] + at.GL_1[0]) / 2;
          bold('5V-1A', side, below + 10, 1.4, -Math.PI / 2);
          bold('3V3-1A', -side, below + 10, 1.4, -Math.PI / 2);
          // beside the header: the board's own name and revision, as the real board prints them
          bold('maker rev1.0', con.seat[0] + 5 * PITCH + 1.6, EDGE - 1.3, 1.5, 0, 'left');
        },
      }),
      hot,
    );
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
