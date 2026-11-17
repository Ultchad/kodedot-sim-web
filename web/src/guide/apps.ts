import { REPO_URL, type GuideKey } from './content';

/**
 * The software the Dot comes with, in kodeOS's own order, and where each one's source is public
 * (web/public/apps/SOURCES.md is the record; apps.test.ts checks this list against it and against
 * scripts/factory-apps.json, so an app added to the factory set cannot be missing here).
 */
export interface BundledApp {
  /** The package's name (scripts/factory-apps.json); `kodeos` is the system itself. */
  id: string;
  /** The name kodeOS shows. */
  name: string;
  text: GuideKey;
  source: { label: GuideKey; url: string };
}

const KODE = 'https://github.com/kodediy';
const here = (id: string) => ({ label: 'apps.src.here' as const, url: `${REPO_URL}/tree/main/apps/${id}` });
const kode = (repo: string) => ({ label: 'apps.src.kode' as const, url: `${KODE}/${repo}` });

export const BUNDLED_APPS: readonly BundledApp[] = [
  { id: 'kodeos', name: 'kodeOS', text: 'apps.kodeos', source: kode('KodeOS') },
  { id: 'kody_kart', name: 'Kody Kart', text: 'apps.kody_kart', source: kode('kode-app-kody_kart') },
  { id: 'light', name: 'Light', text: 'apps.light', source: here('light') },
  { id: 'nfc_kit', name: 'NFC', text: 'apps.nfc_kit', source: here('nfc_kit') },
  { id: 'rfid_kit', name: 'RFID', text: 'apps.rfid_kit', source: here('rfid_kit') },
  { id: 'ir_kit', name: 'IR Remote', text: 'apps.ir_kit', source: here('ir_kit') },
  { id: 'wifi_kit', name: 'Wi-Fi', text: 'apps.wifi_kit', source: here('wifi_kit') },
  { id: 'ble_kit', name: 'Bluetooth', text: 'apps.ble_kit', source: here('ble_kit') },
  { id: 'gpio_kit', name: 'GPIO', text: 'apps.gpio_kit', source: here('gpio_kit') },
  { id: 'level', name: 'Level', text: 'apps.level', source: here('level') },
  { id: 'files', name: 'Files', text: 'apps.files', source: here('files') },
  { id: 'sound', name: 'Sound', text: 'apps.sound', source: here('sound') },
  { id: 'display_lvgl', name: 'Display', text: 'apps.display_lvgl', source: kode('kode-sdk') },
  { id: 'buttons_led', name: 'Buttons + LED', text: 'apps.buttons_led', source: kode('kode-sdk') },
];
