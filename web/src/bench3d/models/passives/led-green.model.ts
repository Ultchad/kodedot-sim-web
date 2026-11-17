/** LED green 5 mm (parts/led-green): the library's plain LED, no resistor inside. Built by led5.ts; the light's colour is the manifest's. */
import manifest from '../../../../../parts/led-green/manifest.json';
import { PAL } from '../../index';
import { ledModel } from './led5';

export default ledModel(manifest, { resin: PAL.resinGreen });
