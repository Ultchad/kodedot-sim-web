/**
 * The materials of the Bench3D kit: one shared material per family (the colour is in the vertices), and the palette of
 * finishes in the page's language. Use the palette instead of inventing colours, so every model belongs to one world.
 */
import { MeshStandardMaterial } from 'three';
import type { Family, Finish } from './shape';

const SPEC: Record<Family, { roughness: number; metalness: number; envMapIntensity?: number; opacity?: number }> = {
  matte: { roughness: 0.78, metalness: 0 },
  gloss: { roughness: 0.2, metalness: 0, envMapIntensity: 0.9 },
  metal: { roughness: 0.34, metalness: 0.82 },
  soft: { roughness: 0.94, metalness: 0 },
  pcb: { roughness: 0.42, metalness: 0.05, envMapIntensity: 0.8 },
  glass: { roughness: 0.06, metalness: 0, opacity: 0.42, envMapIntensity: 1.1 },
};

const cache = new Map<Family, MeshStandardMaterial>();
/** The one material of a family. Never change it from a model: it is shared by every model on the table. */
export function familyMaterial(f: Family): MeshStandardMaterial {
  let m = cache.get(f);
  if (!m) {
    const s = SPEC[f];
    m = new MeshStandardMaterial({ vertexColors: true, roughness: s.roughness, metalness: s.metalness, envMapIntensity: s.envMapIntensity ?? 1 });
    if (s.opacity !== undefined) {
      m.transparent = true;
      m.opacity = s.opacity;
      m.depthWrite = false;
    }
    m.name = `bench3d:${f}`;
    cache.set(f, m);
  }
  return m;
}

const f = (family: Family, colour: string): Finish => [family, colour] as const;

/** Finishes. Spread one into a builder: `s.box(...PAL.plasticBlack, 0, 0, 10, 10, 0, 3)`. */
export const PAL = {
  // boards
  pcbGreen: f('pcb', '#1d6a45'),
  pcbBlue: f('pcb', '#145a8c'),
  pcbBlack: f('pcb', '#1b1c1f'),
  pcbRed: f('pcb', '#a8262f'),
  pcbWhite: f('pcb', '#e9e6df'),
  pcbPurple: f('pcb', '#4b2a78'),
  pcbCore: f('matte', '#b9a878'), // the FR4 edge of a board
  // metals
  tin: f('metal', '#c8cbd0'), // tinned leads, shields, connector shells
  steel: f('metal', '#a9acb3'),
  gold: f('metal', '#d6a13a'), // pins, pads, contacts
  copper: f('metal', '#c4773a'),
  aluminium: f('metal', '#d5d7db'),
  blackOxide: f('metal', '#3a3b40'),
  // plastics
  plasticBlack: f('matte', '#232326'),
  plasticGraphite: f('matte', '#34343a'),
  plasticWhite: f('matte', '#f5f2ec'),
  plasticCream: f('matte', '#ebe6dc'), // the Dot's own shell colour
  plasticBlue: f('matte', '#0a84b8'),
  plasticRed: f('matte', '#c9303d'),
  plasticAmber: f('matte', '#ffac00'),
  plasticGreen: f('matte', '#1f9d55'),
  glossBlack: f('gloss', '#161618'),
  glossWhite: f('gloss', '#f6f4ef'),
  glossBlue: f('gloss', '#1479a8'),
  glossRed: f('gloss', '#c9303d'),
  epoxyBlack: f('matte', '#1a1a1d'), // chip packages
  ceramic: f('matte', '#d8cdb4'), // resistor and capacitor bodies
  dipOchre: f('matte', '#c98f2e'), // dipped ceramic and film capacitors
  sleeveBlue: f('gloss', '#1d2a55'), // an electrolytic's sleeve
  rubber: f('soft', '#29292c'),
  silicone: f('soft', '#dedad2'),
  paper: f('matte', '#ece8df'),
  // clear parts
  glassClear: f('glass', '#eef4f6'),
  glassSmoke: f('glass', '#30343a'),
  resinRed: f('glass', '#e2413b'),
  resinGreen: f('glass', '#3fbf5f'),
  resinBlue: f('glass', '#3f8fe0'),
  resinAmber: f('glass', '#f2a51e'),
  resinWhite: f('glass', '#f4f4ef'),
  resinYellow: f('glass', '#f4d21e'),
} as const;

/** Colours for print (decals): silkscreen and inks. */
export const INK = {
  silk: '#f4f1ea', // silkscreen white on a board
  silkDark: '#2b2a2d', // legends on light plastic
  amber: '#ffac00',
  blue: '#0a84b8',
  red: '#c9303d',
  green: '#1f9d55',
  gold: '#d6a13a',
  copper: '#c4853a',
} as const;
