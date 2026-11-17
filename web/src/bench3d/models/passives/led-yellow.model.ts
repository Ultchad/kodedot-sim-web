/**
 * LED yellow 5 mm (parts/led-yellow): the library's plain LED, no resistor inside. Built by led5.ts; the light's colour
 * is the manifest's. The kit's amber resin reads as orange next to the red LED, so the tint is this model's own (a
 * candidate for PAL: resinYellow).
 */
import manifest from '../../../../../parts/led-yellow/manifest.json';
import type { Finish } from '../../index';
import { ledModel } from './led5';

const RESIN_YELLOW: Finish = ['glass', '#f1cf1f'];

export default ledModel(manifest, { resin: RESIN_YELLOW });
