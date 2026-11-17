/**
 * Names of what runs on the Dot. The system's package calls itself "kodeos"; its name is written kodeOS.
 * (Which apps exist is not the page's knowledge: kodeOS lists what is installed, the factory set comes from
 * public/apps/factory.json, see scripts/prepare-apps.mjs and device/wasm.ts.)
 */
export function displayAppName(name: string): string {
  return /^kodeos$/i.test(name.trim()) ? 'kodeOS' : name;
}

/** "1.2.0 · Games", "1.2.0" or "Games": the one quiet line under an installed app's name. Empty parts are left out. */
export function appMeta(version: string, category: string): string {
  const v = version.trim();
  return [v && v !== '0.0.0' ? v : '', category.trim()].filter(Boolean).join(' · ');
}
