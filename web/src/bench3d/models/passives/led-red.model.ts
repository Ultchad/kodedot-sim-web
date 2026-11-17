/** LED red 5 mm (parts/led-red): the library's plain LED, no resistor inside. Built by led5.ts; the light's colour is the manifest's. */
import manifest from '../../../../../parts/led-red/manifest.json';
import { RESIN, ledModel } from './led5';

export default ledModel(manifest, { resin: RESIN.red });
