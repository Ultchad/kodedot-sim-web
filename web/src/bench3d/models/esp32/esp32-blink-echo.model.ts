/** ESP32-DevKitC V4 carrying the "blink-echo" sketch (parts/esp32-blink-echo): see board.ts for the board and its live state. */
import manifest from '../../../../../parts/esp32-blink-echo/manifest.json';
import { esp32Model } from './board';

export default esp32Model(manifest, 'classic');
