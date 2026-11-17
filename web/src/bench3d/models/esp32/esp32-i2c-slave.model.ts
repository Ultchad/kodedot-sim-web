/** ESP32-DevKitC V4 carrying the "i2c-slave" sketch (parts/esp32-i2c-slave): see board.ts for the board and its live state. */
import manifest from '../../../../../parts/esp32-i2c-slave/manifest.json';
import { esp32Model } from './board';

export default esp32Model(manifest, 'classic');
