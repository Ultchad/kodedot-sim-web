# STATUS: web (page)

State: complete against the brief, using the mock. The WebAssembly adapter is a placeholder.

## Run
```
cd web
npm install
npm run dev          # Vite dev server, COOP/COEP headers on
npm run build        # tsc --noEmit + vite build
npm run preview      # serves dist with the same headers
npm test             # Vitest (46 tests)
npm run build && node scripts/headless-check.mjs   # headless Chrome, 82 checks, writes web/screenshots/
```
Deploy: `web/vercel.json` sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on every route.
Debug hooks (`window.__dotbench`, `window.__dotbench3d`) exist only when the URL has `?debug`.

## Dependencies
Runtime: react, react-dom, three, @react-three/fiber (no drei). Dev: vite, @vitejs/plugin-react, typescript, tailwindcss + @tailwindcss/vite (v4), vitest, fake-indexeddb, puppeteer-core, types.
Bundle (build): main JS 313 KB (96 KB gzip), CSS 22 KB, lazy `Device3D` chunk 933 KB (248 KB gzip, only loaded in 3D view). The 2D page works without three.js loaded.

## Seam: `web/src/device/types.ts` (`KodeDevice`)
- Lifecycle: `load(ArrayBuffer, {name})`, `start()`, `stop()`, `restart()`, `dispose()`, `status` (idle|booting|running|crashed), `appName`.
- Screen: `getFrame()` -> `{seq, width:410, height:502, data: Uint8ClampedArray RGBA}`, `backlight` 0..100, `panelOn`.
- Inputs: `setButton(id, pressed)`, `setTouch(x, y, down)`.
- Outputs (Observable = `get()` + `subscribe()`): `led {r,g,b}`, `haptic` 0..1, `log` (+`clear()`); `sendConsole(line)`; `time()`; `info {kind,label,runsBundles}`.
- Areas: `areas: Partial<HardwareAreas>`. Each area file augments `HardwareAreas` (see `device/motion.ts`), so adding nfc/rfid/wifi/ble/ir/sd/usb/power never edits `types.ts`.

## For the firmware adapter author (`device/wasm.ts`)
- `getFrame()` must return a plain `ArrayBuffer`-backed `Uint8ClampedArray` (ImageData rejects SharedArrayBuffer views): copy out of wasm memory, and return the same object while the frame counter is unchanged.
- `sendConsole` must echo the line into `log` with level `input` (the page does not echo).
- `load()` rejects with `NotWiredError` today; any rejection becomes a notice, never a crash. `info.runsBundles` must be true.
- The page releases all buttons and touch on blur, pagehide and hidden visibility, so `setButton(.., false)` / `setTouch(.., false)` will arrive.
- Touch is one pointer only; coordinates are integers clamped to 0..409 / 0..501.
- The Movimento area contract is `MotionArea { setPose(pose|null), shake(ms?) }` (pitch -90..90, roll -180..180, heading 0..360; `null` = no object attached).
- Page must be cross-origin isolated: status bar shows `crossOriginIsolated`.

## Features
- Layouts: wide (bench | device | console), tablet (drawers), phone portrait/landscape ("device mode": 2D crop-to-body fit, bottom sheet or side sheet, handle outside the art). Hit areas >= 44 CSS px, `touch-action: none`, one-pointer touch, buttons released on pointercancel/hidden page.
- Device view: 3D (default on desktop; lazy) and 2D (integer zoom 1x/2x/3x or Fit; automatic fallback when WebGL is missing or lost). Geometry comes from `public/device/kode-dot.json` via `lib/geometry.ts`; literals only for three named estimates (thickness 12 mm, corner radius, cap ratio).
- 3D: drag body/background rotates the model (limits pitch +-60, roll +-135), Shift/Alt-drag spins (heading), wheel and pinch zoom, double-click or "Recenter" resets, glass = touch (ray to plane, clamped), button meshes depress. "Tilting controls the motion sensor" mirrors the pose to the Movimento object both ways.
- Bench: 9 areas with honest "Coming soon, stage N" states; generic BenchObject store (localStorage, try/catch), add/rename/duplicate/delete, per-area slot (drag or Bring near/Take away; non-radio areas use Activate/Insert/Connect wording). Working demo: Motion (pitch/roll/heading sliders, Shake).
- Components section reserved: "Library" and "Make your own" placeholders.
- Apps: IndexedDB wrapper (`lib/bundles.ts`), drag-drop anywhere or file picker, list/select/delete with size and date. Mock toggle on by default.
- i18n: en (source, fallback), pt-BR, es; typed (`Messages = Record<MessageKey,string>`), plural via Intl.PluralRules, detection from navigator.languages, persisted, `<html lang>` set. Mock device output (screen, log) is English by design: it is device output, not UI.
- Phone: sensors behind a toggle in the Motion section (off by default), `navigator.vibrate` on haptic (feature-detected, only after user activation), Wake Lock while running (setting, default on), web manifest + Apple meta tags + generated icons (original mark). No service worker. Manifest `orientation: portrait` as requested (landscape works in the browser only).

## Verified by running (headless Chrome, `scripts/headless-check.mjs`, 82/82)
Console clean in every phase; COOP/COEP on the served build; `crossOriginIsolated` true; WebGL context; 3D screen texture version and GL frame counter advance; canvas pixels change; click on the top button mesh changes the LED; glass clicks map within 2 px in 3D, 2D and phone (touch); glass drag does not orbit; orbit, tilt link both ways; IndexedDB bundle, mock/wasm notices; language switch (en, pt-BR, es); phone 390x844@3x and 844x390: fills viewport, no scroll or zoom on touch-drag, 6 buttons >= 44 px inside viewport, one-pointer touch, sheet open/close, nothing overflows in en, es, pt-BR across all five sheet tabs.
Screenshots (`web/screenshots/`): `3d-dark-1440x900.png`, `3d-orbited-side.png`, `2d-light-1280x720.png`, `phone-portrait.png`, `phone-landscape.png` (plus sheet-open and tablet-drawers).

## NOT verified (needs a real phone or GPU)
- iOS permission prompts for DeviceOrientation/DeviceMotion, real sensor data and shake threshold tuning.
- `navigator.vibrate` output (absent on iOS Safari), Wake Lock behaviour, "Add to Home Screen" full-screen install, safe-area insets on notched devices (headless has zero insets).
- 3D frame rate on real GPUs (headless uses SwiftShader, ~15 fps).
- Pinch zoom on a real touchscreen; 3D look under the real light theme at length.

## Known limits
- D-pad in 3D fixes the direction at press (no slide between arms); 2D does slide.
- Mock screen draws its own text in English.
