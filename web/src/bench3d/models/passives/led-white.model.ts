/**
 * LED white 5 mm (parts/led-white): water-clear resin, and the yellow phosphor over the die that every white LED has.
 * Built by led5.ts; the light's colour is the manifest's.
 */
import manifest from '../../../../../parts/led-white/manifest.json';
import { PAL } from '../../index';
import { ledModel } from './led5';

export default ledModel(manifest, { resin: PAL.resinWhite, phosphor: true });
