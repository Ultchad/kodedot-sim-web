# STATUS: web (page)

State: the page runs the real firmware (kodeOS by default) through the web adapter, shows Kode's own 3D model of the device (optimised) and has been through a UI review at eight viewports. The newest state is in the last section, "Model and review pass"; older sections are kept as history and may describe earlier behaviour.

## Run
```
cd web
npm install
npm run dev          # Vite dev server, COOP/COEP headers on
npm run build        # tsc --noEmit + vite build
npm run preview      # serves dist with the same headers
npm test             # Vitest (158 tests)
npm run build && node scripts/smoke.mjs            # 1 minute: kodeOS reaches its lock screen in 2D and 3D, no page errors
npm run build && node scripts/headless-check.mjs   # headless Chrome, about 215 checks incl. the layout audit (15 minutes), writes web/screenshots/
npm run build && node scripts/layout-audit.mjs [viewport ...]   # the layout audit alone
npm run build && node scripts/ux-shots.mjs after   # review screenshots into web/screenshots/ux/
```
Deploy: `web/vercel.json` sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on every route.
Debug hooks (`window.__dotbench`, `window.__dotbench3d`) exist only when the URL has `?debug`.

## Dependencies
Runtime: react, react-dom, three, @react-three/fiber (no drei), @fontsource/outfit, @fontsource/dm-sans, @fontsource/dm-mono (self-hosted fonts, latin subset, so COEP stays satisfied). Dev: vite, @vitejs/plugin-react, typescript, tailwindcss + @tailwindcss/vite (v4), vitest, fake-indexeddb, puppeteer-core, types.
Bundle (build): main JS 318 KB (98.6 KB gzip), CSS 30 KB (7 KB gzip; was 22 KB), lazy `Device3D` chunk 945 KB (253 KB gzip, only loaded in 3D view). Fonts: 7 woff2 files, about 100 KB total, fetched on demand. The 2D page works without three.js loaded.

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

## Verified by running (headless Chrome, `scripts/headless-check.mjs`, now 123/123, see "Real apps" below)
Console clean in every phase; COOP/COEP on the served build; `crossOriginIsolated` true; WebGL context; 3D screen texture version and GL frame counter advance; canvas pixels change; click on the top button mesh changes the LED; glass clicks map within 2 px in 3D, 2D and phone (touch); glass drag does not orbit; orbit, tilt link both ways; IndexedDB bundle, mock/wasm notices; language switch (en, pt-BR, es); phone 390x844@3x and 844x390: fills viewport, no scroll or zoom on touch-drag, 6 buttons >= 44 px inside viewport, one-pointer touch, sheet open/close, nothing overflows in en, es, pt-BR across all five sheet tabs.
Screenshots (`web/screenshots/`): `3d-light-1440x900.png`, `2d-dark-1280x720.png`, `3d-orbited-side.png`, `2d-light-1280x720.png`, `phone-portrait.png`, `phone-landscape.png` (plus sheet-open and tablet-drawers).

## NOT verified (needs a real phone or GPU)
- iOS permission prompts for DeviceOrientation/DeviceMotion, real sensor data and shake threshold tuning.
- `navigator.vibrate` output (absent on iOS Safari), Wake Lock behaviour, "Add to Home Screen" full-screen install, safe-area insets on notched devices (headless has zero insets).
- 3D frame rate on real GPUs (headless uses SwiftShader, ~15 fps).
- Pinch zoom on a real touchscreen; 3D look under the real light theme at length.

## Known limits
- D-pad in 3D fixes the direction at press (no slide between arms); 2D does slide.
- Mock screen draws its own text in English.

## Restyle (warm, toy-like; light is the default regardless of OS)
Tokens in `src/styles/tokens.css` (light + `[data-theme=dark]`), primitives in `src/index.css` (.card, .inner, .btn, .chip, .seg, .pill, .tag, .soon, .icon-tile). Outfit headings, DM Sans body, DM Mono only in console log lines. Secondary text and the success colour were darkened from the owner's greys to pass WCAG AA (secondary #4A4742, success text #0D5F2F). Contrast (measured): ink on card 12.3, ink on bg 9.2, secondary on card 6.5, amber button label 9.3, link text 4.8, red text 5.2, console text 14.4, console dim 5.1. Headless check asserts tab-label contrast >= 4.5 in light and dark.

## 3D view: public interface (model is owned by another engineer from here)
- `Device3D` (default export of `components/Device3D.tsx`, lazy): props `{ device, input, painter, storePose, tiltLink, onPose, resetSignal, reducedMotion, onContextLost }`.
- Screen: `ScreenPainter.canvas` (410x502) is a CanvasTexture on the glass mesh; `painter.onFrame` sets `needsUpdate`. LED: `device.led` is read per frame and drives the light-guide material (emissive) and a point light. Backlight/panelOn dim the screen material.
- Input: glass hit -> UV -> `uvToScreen` -> `input.touchDown/Move/Up` (-> `setTouch`); controls call `input.press/release(id, 'p3:<pointerId>')` (-> `setButton`). Pressable ids: `top`, `bottom`, `up`, `down`, `left`, `right` (D-pad arm from `dpadDirection` on the hit point). Background and body drag orbits.
- Debug hook (only with `?debug`): `window.__dotbench3d` {project('top'|'bottom'|'dpad:<dir>'|'glass:x,y'), textureVersion, rendered, pose, setPoseDebug, scene}.
- Models: see "Model and review pass" below and `web/public/device/MODEL.md` (`components/glbModel.ts` is gone; `src/device3d/customModel.ts` decides which model is shown).

## Real apps (web-adapter integration)
- `npm run prepare:assets` (runs before dev/build/preview/test/headless): `scripts/sync-adapter.mjs` copies `runtime/web-adapter/*.js` into git-ignored `src/generated/web-adapter/`; `scripts/prepare-apps.mjs` copies the two example `.dotbench` into git-ignored `public/apps/` with `index.json` (names, en/pt-BR/es descriptions, size, sdk commit). Fails with build instructions if packages are missing. NOTE: `build/` and `public/apps/` are git-ignored, so Vercel needs the packages built or committed.
- `device/wasm.ts`: `WasmDevice` over the adapter (lazy chunk ~11.4 kB / 4.7 kB gzip). restart-requested maps to booting plus a log line with the reason; crashes carry the reason; `checkRuntime` yields friendly causes (not isolated, no SharedArrayBuffer, no wasm threads). `areas` is a Proxy over `adapter.area(name)`.
- Default is the real device (mock behind "Test device (mock)" toggle, off). First visit auto-starts built-in display_lvgl; picker has Built-in plus Your apps (IndexedDB); dropping a `.dotbench` runs it.
- UX: boot/crash/unsupported/idle cards on the glass (2D) or stage (3D); details pill shows workers and wasm memory; Device menu offers Export/Import via adapter exportPersist/importPersist (own small container in `lib/devicefile.ts`).
- CSP (`csp.mjs`, mirrored in vercel.json, asserted by test): `default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src 'self' blob:; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; ...` plus COOP/COEP. Dev server relaxes script/style/connect only.
- Tests: vitest 77/77 (wasm wrapper vs fake adapter, builtins, devicefile, csp); headless 123/123 incl. real buttons_led LED green/red/green, display_lvgl real frame and touch, restart, stop, phone viewport, unsupported-browser card.
- Bundle: main JS 334 kB (103 gz), CSS 31.9 kB (7.2 gz), Device3D 945 kB (253 gz, other engineer).
- Left: real-phone verification; 3D crash/boot card sits over the stage, not on the 3D glass (Device3D off limits).

## UX review (2026-11-16, review-and-fix pass)

Method: `npm run build`, `vite preview`, headless Chrome driven by `web/scripts/ux-shots.mjs` (scenes in `ux-scenes.mjs`, helpers in `ux-lib.mjs`). 370 "before" screenshots: 8 viewports (1920x1080, 1440x900, 1280x720, 1024x768, 820x1180, 390x844, 360x740, 844x390; the last five with touch emulation), light/English and dark/Spanish (the longest language) for every scene, light/pt-BR for the text-heavy scenes. Scenes: first run, 3D toolbar and hints, 3D crash and boot cards, 2D at 1x/2x/3x/Fit, boot, crash, idle, placeholder area, Motion with an object in use, Components, console with 70 long lines, console input focused, console collapsed, app picker with built-in and user apps, Device menu, drop overlay, notice, tablet drawers, phone sheet on every tab, phone 3D, keyboard focus, unsupported browser.

Severity: S1 = cut off, overlapping, unreachable or broken; S2 = flow (a first-time visitor is lost, a dead end, a misleading state); S3 = fluidity, consistency, craft, keyboard and screen reader.

### Defects found (written before any fix; status added afterwards)

S1
1. Bench card content is clipped at the bottom at 1280x720 and on every smaller size, with no visible way to scroll (the sensors card and the object card are sliced).
2. Crash card is clipped by the 2D glass whenever the device is drawn below about 1x: the title and the Restart button are cut off or unreachable (1280x720, 1024x768; a sliver at 844x390).
3. Switching 3D -> 2D raises "The 3D context was lost" and disables the 3D button for the session (the 3D canvas releases its context when it unmounts and the page takes that for a failure).
4. Tablet console drawer collapses to a title and an input: the log has no height, so output cannot be read.
5. Phone sheet, Apps tab: sections overlap each other (Open file under Export device, texts printed over each other); in landscape the list is unreadable.
6. The closed phone sheet is not inert: Tab moves focus into it, the page scrolls inside its clipped root and the layout stays broken (device cut, sheet half open).
7. Phone sheet tabs overflow sideways: "Settings" is off screen with no scroll cue (390, 360, landscape).
8. Top bar wraps to two rows (Spanish and pt-BR at 1280; every language on tablets): the device shrinks and popovers cover the wrapped controls.
9. Status bar wraps to two rows on tablets and in Spanish at 1024.
10. Tablet drawers cover the view toolbar and the device, have no scrim, can both be open and overlap; no Escape, focus does not move into them.
11. 2D at 1x/2x/3x overflows the stage: hairline scrollbars, touch panning blocked (`touch-action: none`), arrow keys go to the D-pad so the keyboard cannot scroll, and the view opens on the top-left corner instead of the screen.
12. Notices sit on top of the console input and the read-outs and never leave on their own.
13. Phone landscape: the side sheet covers the device; the bench shows only chips, the object card is below the fold.
14. App picker and Device popovers have no maximum height: with several saved apps they run past the bottom edge on short viewports.
15. Bench object card: the name is cut to "Tilt and…" / "Incl…" by three icon buttons and the description is clamped to "(pitch, roll,…".
16. Console lines break in the middle of words.
17. Console shows the raw firmware prefix "!I " after a "kode>" prompt.
18. Console prints two timestamps per line (page clock and firmware ISO time), which take almost half of the width.
19. The focus ring (#01608E) is close to invisible on dark surfaces in the light theme (console buttons and input, selected chips): about 2.3:1.

S2
20. Status bar shows "FPS 1" or "FPS 2" for an idle app; it reads as a fault although the firmware only redraws on change.
21. "This phone's sensors" card is shown on desktop.
22. "Soon" areas take prime space: nine chips in three rows, eight of them placeholders; a placeholder area still shows a drop slot ("Drag an object here or press Bring near") although nothing can be added.
23. "Near the device" summary repeats the slot below it; when empty it is one more empty line.
24. Side cards have a fixed 20 to 24 rem width: at 1920 the stage keeps about 600 px of dead room while console lines wrap at 30 characters.
25. 2D defaults to 1x (cut off on laptops); Fit keeps the render's transparent margin, so the device is smaller than the stage allows.
26. First visit: nothing says the device is live and clickable, how to load an app of one's own, or what the bench is for; on a phone the only cue is a 4 px handle.
27. Drop -> run: the picker shows the file name with its extension, nothing confirms that the app was saved, and the picker stays open after choosing an app.
28. Idle state is a dim caption with no action; Restart lives far away (on a phone: sheet, Apps tab).
29. Unsupported-browser card has no action (it mentions the test device but offers no way to switch to it).
30. Empty states are a sentence plus a separate dashed button (bench), or a bare sentence (console).
31. Restart with nothing loaded ends in the notice `Could not load ""`.
32. "Test device (mock)" is the widest control of the top bar; language is a 180 px select; Device menu, mock, language and theme compete with the app controls.
33. The bench cannot be collapsed; the collapsed console leaves a floating "◂ Console" button; neither state nor width is remembered or adjustable.
34. The keyboard-hints button inserts a paragraph and pushes the device up; the 3D toolbar wraps to two rows because of the long tilt label.
35. Deleting a saved app is immediate, while bench objects ask first.
36. Jargon without help: "Isolated yes", "Device WebAssembly", "stage 2", "(mock)", "details".

S3
37. No transitions on popovers, drawers and tab changes; no hover or pressed feedback on chips, list rows and the 2D device buttons.
38. Layout jumps at 1180 px from three columns to none.
39. Touch targets below 44 px on touch viewports: chips 36, small buttons 34, icon buttons 34, switches 44x26, the hints button.
40. Mixed icon styles: Unicode glyphs (✎ ⧉ ✕ ☾ ☀ ▾ ▸ ◂ ?) next to stroke icons; they change with the system font.
41. Pill heights (32/34/36/44) and radii (12/16/20/24) are mixed without a rule.
42. Tabs are not ARIA tabs (no arrow keys, every tab in the tab order, no `aria-controls`); popovers are dialogs without focus handling; Escape does not return focus and closes more than the top layer.
43. No live region for device status changes.
44. Arrow keys always go to the D-pad, even with focus on a tab, a menu or the log.
45. Plurals: "Paused, 1 new", "1 novas", "1 nuevas".
46. Console time is "7:55:43 PM" in English (11 characters per line).
47. Truncated names (picker button, saved apps, "Near the device" pills) have no tooltip; long log lines cannot be read whole without scrolling back.
48. Heavy `shadow-2xl` on drawers against a language with almost no shadows.
49. Drop overlay is one line on a tinted page; it does not say what will happen.
50. Read-outs under the device plus the status bar are two rows of pills (about 90 px) that the device could use.
51. The device does not look clickable: no pointer cursor on its buttons, no hover state.
52. Web fonts swap in after first paint (text reflows).

## Model and review pass (2026-11-16)

### The device model
- Default: `web/public/device/model.glb`, Kode's own model from its site, made by `web/scripts/optimise-model.mjs` from the original (kept outside the repository). Credit: `web/public/device/NOTICE-model.md`.
- What the optimiser does: frame in mm, documented node names (`screen`, `btn_top`, `btn_bottom`, `dpad`, `led`), the two round buttons cut apart, a flat `screen` surface for the live picture, simplification with the normals weighed in and the shell's rims next to the glass, the controls, the light guide and the side window locked, the shared palette texture turned into plain materials, baked normal maps dropped except the back cover's, meshopt compression.
- Measured: 144,817 -> 48,706 triangles; 1005 kB -> 416 kB; 13 materials with clear coat/anisotropy/specular -> 16 plain materials, 25 draw calls in the page. Frame time on SwiftShader (software GL, 760 x 900, back to back, best of six runs): original file with its own materials 883 ms, optimised 286 ms (the simple model 209 ms; measured with the 46.6k build, the final 48.7k build measures the same within noise: 247 to 277 ms in the model stand). Software GL is bound by pixel shading, so this is a relative figure only; no real GPU or phone was measured.
- Rendering is on demand: `frameloop="demand"`, a frame is drawn only when the picture, the pose, a control or the LED changes (checked: 0 frames in 1.5 s with a still picture), never while the tab or the canvas is hidden. A firmware frame only re-uploads the 410 x 502 screen texture.
- Loading: the GLB is fetched while the lazy 3D chunk loads (`DevicePane`), decoded by the meshopt decoder that is part of that chunk (no Draco download for the bundled file).
- Selector (Device menu; phone: Settings): "Kode model" (default), "Simple model" (procedural, also the automatic fallback when the GLB is missing or broken or the browser has WebGL 1 only), "My own…" (.glb, or a .gltf with everything embedded, repacked to GLB in memory by `src/device3d/container.ts`; kept in IndexedDB; also by dropping the file on the page, which asks first). A file that fails while another own model is on show leaves that model in place.
- Input on every model: glass -> touch at the pixel under the pointer (0 px error at 7 points, face-on and turned), the two round buttons and the four D-pad directions press and visibly move; parts are found by node, mesh or material names with shape-and-position fallbacks (`src/device3d/analyse.ts`, unit-tested).
- Checks: `node scripts/model-shots.mjs --kode` (all pass; shots in `web/screenshots/model-kode-*.png`), `--custom <file>` for the own-model path, `scripts/smoke.mjs`.
- Link preview: `node scripts/og/make-og.mjs` writes `web/screenshots/og-device.png` (the Kode model with kodeOS's lock screen, 2x, on #C2BAB3) and `web/public/og.png` from `scripts/og/og.html`.

### Review fixes in this pass
- The system reads "kodeOS" everywhere (App menu, status bar, cards); it has its own "System" section at the top of the App menu, apart from "Your apps" and "Built-in apps" (room for "install into the Dot").
- First run speaks about an operating system: "This Dot is live. It runs kodeOS: swipe sideways on the screen to unlock…"; idle, crash, console-empty, mock and unsupported-browser texts no longer assume a demo app (en, pt-BR, es; typed, tested for equal keys and variables). The hint hides while the Dot is stopped or crashed.
- 2D <-> 3D: the 3D view stays mounted (hidden, drawing nothing) once shown on desktop and tablet, so going back is one frame instead of a new WebGL context; the view fades in.
- A selected chip under the pointer was white text on white (hover overrode the selected look): fixed; hover looks now apply only to pointers that can hover, so nothing stays "hovered" after a tap on a phone.
- Cut off: the Spanish "add to the bench" button ran out of its card at 1024 px (label shortened, the button now wraps inside the card); the 3D device touched both edges of a phone screen (more side margin); the ground shadow ended in a hard line at the stage edge (it fades).
- Device menu: the three model choices on one row; the file name row and the file button only when a file is in play.
- Phone ("device mode"): the sheet no longer repeats the tab's name as a heading; Settings starts with "This phone as the Dot" (use this phone's motion sensors, keep the screen awake).
- No notices or disclaimers in the UI; `public/device/NOTICE.md` and `NOTICE-model.md` are plain credits.
- Layout audit (`scripts/layout-audit.mjs`: clipped, covered, overlapping, undersized, low contrast; 8 viewports x 2 themes x 3 languages, 796 scene audits): see the last run noted below.

### Not verified, weak
- No real phone or GPU: frame rate, iOS sensor permission, vibration, wake lock, safe areas remain unverified.
- A user who loads Kode's ORIGINAL file as "My own…" sees the bezel round the glass grey: its colours come from a palette texture, which the page's "glossy black" detection cannot read (the bundled file has plain materials and is right).
- kodeOS prints many "dotbench: kdrv_… not implemented" lines at boot: they fill the console on first run (runtime side, not the page).
- The before/after set in `web/screenshots/ux/`: `before-*` (earlier reviewer, 370 shots), `after-*` (this pass).

