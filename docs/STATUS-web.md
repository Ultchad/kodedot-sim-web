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
- The system reads "kodeOS" everywhere (Apps menu, status bar, cards).
- First run speaks about an operating system (the wording was replaced again when apps moved inside kodeOS, see the next section); idle, crash, console-empty, mock and unsupported-browser texts no longer assume a demo app (en, pt-BR, es; typed, tested for equal keys and variables). The hint hides while the Dot is stopped or crashed.
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

## Apps inside kodeOS (2026-11-16, after the system layer was merged)

The page no longer runs one program at a time. It holds one `DotbenchSystem` (runtime/web-adapter) through `web/src/device/wasm.ts` (`SystemDevice`): the Dot always boots kodeOS, apps are installed into it and opened from its own list, and the system layer plays the bootloader between programs. The page never handles a restart: it listens to `program` (what runs) and `apps` (what is installed) and keeps reading frames, outputs and logs from the same object.

- Persistence: `IdbBackend` with its own database, `kodedot-system` (settings, files, installed apps and their packages survive a reload).
- `web/scripts/prepare-apps.mjs` is data-driven: `web/scripts/factory-apps.json` (`{"os": "kodeos", "factory": ["kody_kart", "display_lvgl", "buttons_led"]}`) names the packages under `../build/apps/<name>/<name>.dotbench`; it copies them to `public/apps/` and writes `public/apps/factory.json` (`{"format":1,"apps":[...]}`), which the page hands to the system layer for the first boot of an empty Dot. One more factory app = build it, add its name to the list. `public/apps/index.json` is gone.
- The top-bar "Apps" menu (phone: the Apps tab) is the Dot's app manager: what runs now (kodeOS or the app) with Home, the installed apps (open, remove after a confirmation), "Install a .dotbench…" (file picker, or drop the file anywhere: install, then open), and a factory reset behind a confirmation. Restart is a reset of the Dot (kodeOS comes up), Stop switches it off.
- Removed: the "default built-in app" (`lib/builtins.ts`, `pickStartApp`), the page's own store of saved bundles (`lib/bundles.ts`; packages saved by the old page are not migrated: install them again), the legacy region export (`lib/devicefile.ts`; Export/Import device now uses the system's whole-device file, apps included).
- First-run hint: unlock by swiping sideways, open the app list, tap an app, hold the bottom button to come back, drop a .dotbench to install (en, pt-BR, es).
- Checked by `npm run build && node scripts/system-check.mjs` (headless Chrome, a fresh profile, the real page; screenshots `web/screenshots/system-*.png`): kodeOS boots with Kody Kart, Display and Buttons + LED; a tap on Kody Kart in kodeOS's own list opens it and its title screen shows; holding the bottom button returns to kodeOS; a package installed from the page appears and opens; a reload keeps the four apps; open from the manager, Home, remove, factory reset, Stop/Start and the 3D view work; no page errors.

Last runs with the app manager in place: unit tests 156/156; `scripts/system-check.mjs` all pass; `AUDIT=off node scripts/headless-check.mjs` 169/169; layout audit at 1280x720, 820x1180, 390x844 and 844x390 in both themes and three languages: 386 scene audits, 25/25 combinations clean (the other four viewports were audited before the app manager: 796 audits, clean after the audit learned to wait for the theme). Whole-device export, remove an app, import: the app is back, also after a reload. Review screenshots: `web/screenshots/ux/before-*` (370, earlier state) and `after-*` (100: light, English, those four viewports).

Rough edges (known, not the page's to fix):
- kodeOS's own details card shows a tiny size for an app (the image in the apps region is synthesised).
- Installing or removing an app restarts kodeOS once (it re-reads its directory).
- Holding the bottom button returned to kodeOS after about 1.8 to 2.2 s of wall time in headless Chrome, not 3.0 s (the Node suite measures 3.0 s); the same through the mouse, the keyboard and the API, so it is below the page.
- Back from an app, kodeOS shows its app list, not the lock screen.

## Printed labels on the model (2026-11-17)

Reported: the pin names printed next to the expansion header (3V3, IO9 … 5V / 5V, IO8 … 3V3) flickered, showed a moire or vanished depending on the angle.
Cause: the label is a see-through textured quad lying exactly in the shell's top surface (0.9 µm above it in Kode's file, 0 after quantisation), so the depth buffer could not order the two: classic depth fighting, different at every angle.
Fix (`web/src/device3d/decal.ts`, used by `prepare.ts` for every model file and by `Device3D.tsx`):
- print on a surface (a flat sheet with a picture that is see-through in places, or a small flat textured patch) is drawn as a decal: in the vertex shader it is pulled 0.3 mm towards the camera along its own line of sight (its place on screen does not change, only its depth, by the same amount at every angle and zoom), it does not write depth, is drawn after the surface, and has a constant polygon offset on top. The same pull (0.12 and 0.18 mm) is on the live picture and its gloss over the glass, for all three models.
- the camera's near and far planes now hug the model (they were 20 and 1500 mm), which alone improves depth resolution about tenfold; a 16-bit depth buffer resolves about 0.01 mm at the device.
- the label's texture keeps its full 2048 px and gets anisotropic filtering (it is the one texture that is read); the optimiser keeps the shell under the print exactly as modelled. Bundled model now: 49,562 triangles, 445 kB.
- the only printed part in Kode's model is this label (the mark on the back is geometry); the rule is generic, so a user's own model gets the same treatment.
Check (permanent): `node scripts/model-shots.mjs --kode --labels` (also `--custom <file> --labels`, and without `--kode` for the simple model). 11 views of the labels (straight, 30, 60, 80 degrees, turned, near and far zoom): each is compared with a reference drawn without a depth test and must match within 1 % of the print's pixels, at the real depth precision and with a 256 times coarser one (near plane 256 times closer: what a 16-bit buffer gives where this machine has 24 bits); plus 6 general views that must not change with the coarse depth. All pass for the Kode model, the original file loaded as "My own…" and the simple model; with the fix switched off the 60-degree views lose 1,400 to 5,200 of 8,700 print pixels. Screenshots: `web/screenshots/model-labels-*.png`, `model-kode-depth-*.png`.

## What is kept between visits (2026-11-17)

Checked end to end by `npm run build && node scripts/settings-check.mjs` (headless Chrome, a fresh profile, the real page, settings changed by touch in kodeOS and read back with kodeOS's console command `config`; screenshots `web/screenshots/settings-*.png`). All pass:
fresh profile has nothing stored and the lock screen asks for a time zone; brightness and time zone changed, reload after 2 s: kept; vibration changed, reload after 2 s: all three kept, the lock screen no longer asks, the page shows the stored brightness; tab closed right after a change; Stop right after a change, then Start; Restart right after a change (and a reload after it); tab crashed 1.5 s after a change; page hidden right after a change and then killed: the change is there every time, and the time zone question never comes back.

Found on the way: nothing was lost on reload, close, Stop/Start or Restart (the system layer saves on page-hide and when a program stops), but a tab that crashed or was killed within about 5 s of a change lost it. Cause: `PersistManager.tick` (runtime/web-adapter/persist.js) saves once the firmware has been quiet for 0.8 s, and kodeOS never is: its dirty-generation counter moves about 1,750 times a second while it idles on the lock screen, so only the 5 s upper limit ever fires (measured: one commit every 5.0 s, most of them empty). Fixed in the page, not in the runtime: `SystemDevice` (web/src/device/wasm.ts) calls the system's `flushPersist()` 150 and 700 ms after every release of the screen or a button, and once a second while the Dot runs (it writes only what changed). Nothing was changed outside `web/`. For the runtime's owner: either that counter should not move for writes that change nothing (or for the retained `keep` region), or `tick` should not wait for quiet.

kodeOS has no language setting in this build (Settings: Wi-Fi, Bluetooth, Battery, Time, Sleep after, Turn off after, Kody's scene, Vibration, While charging, Header 3.3 V, Header 5 V, Self-test, About), so the three settings checked are time zone, brightness and vibration.

| What | Where it is kept | Kept |
|---|---|---|
| kodeOS settings (time zone, brightness, vibration, sleep, volume, Wi-Fi list ...), its files and clock | IndexedDB `kodedot-system`, through the system layer | yes (checked) |
| Installed apps and their packages | same | yes (system-check) |
| Page language, theme, 3D/2D (desktop and phone apart), 2D zoom | localStorage `dotbench.*` | yes (checked) |
| Collapsed bench/console cards and their widths, bench area tab, bench objects | localStorage | yes (collapsed card checked) |
| Bench/Components side tab | localStorage `dotbench.left` | yes, new in this pass (checked) |
| Chosen 3D model (Kode/Simple), lighter materials; the user's own model file | localStorage; IndexedDB `dotbench-custom-model` | yes (choice checked) |
| Dismissed first-run hint, test device switch, keep-screen-awake | localStorage | yes (hint checked) |
| 3D view angle and zoom, tilt link, phone sheet position, phone sensors switch | not kept, on purpose (sensors need a fresh permission tap) | no |


## The bench: objects for every area (2026-11-17)

Framework (`web/src/bench/`): the bench store (localStorage `dotbench.bench.v1`, saved as v2 with `near`) is the single source of truth. A kind (`KindDef`: fields, defaults, presence wording, actions) and a driver (`drivers/<area>.ts`: create/update/remove/events/poll) per area; `BenchRuntime` reconciles the store with whichever program runs: it keeps an applied signature per object, and a new area glue object (every program boot makes one) means "wipe what the area persists, rebuild from the bench", so a near tag survives kodeOS -> NFC app -> kodeOS and nothing is duplicated. What the Dot did is reported by `ctx.say` into `LiveStore` (lines with a count and a clock on the card) and, where the Dot changes the object (text written to a tag, T5577 blocks, TV state), written back into the bench through `ctx.report` without a feedback loop. Objects: NFC tag/card/reader, EM4100 card, T5577 tag, door reader (access granted for a chosen number), Wi-Fi router (name, security, password, signal, channel, internet, power, in range; connected state and IP, the Dot's requests), IR TV (drawn, power/volume/channel/mute, event log) and remote (hold to repeat), microSD (insert/eject, write protect, new card size, listing, add by picker or drop, download, delete), charger and battery. Motion is a driver too. Bluetooth and USB remain under Coming soon (chip counts 2).

Proof: `web/src/bench/store.test.ts`, `runtime.test.ts` (fake device and areas: create near, rebuild once per new program with the wipe, edits, removal, Dot-reported changes not pushed back, errors shown and cleared) in `npm test` (179 pass). Permanent browser check `npm run build && node scripts/bench-check.mjs` (headless Chrome): NFC tag added, NFC app opened from kodeOS by touch, Read shows the tag (live line + `screenshots/bench/nfc-2-app-shows-tag.png`), Home, tag still near and exactly one, app opened again; EM4100 number typed, read in the RFID app; router added, kodeOS Settings > Wi-Fi by touch, tap the (open) network: joined with an address; IR at area level; file added from the page is on the card (read back) and listed by the Files app; reload keeps the bench and re-applies it. The on-screen keyboard is not driven: a secured router is not joined in the check (the open one is), and the Files app is started from the page's Apps menu because kodeOS's launcher rows move with the recent-apps row. `system-check.mjs`, `settings-check.mjs` and `headless-check.mjs` still pass (headless-check: its factory-app count was stale at 3, now 9; the motion button selectors go through the Motion tab). Screenshots: `web/screenshots/bench/` (card-*.png per object, bench-desktop/phone/tablet.png).

What the fakes lack or do differently (nothing worked around in the page):
- Wi-Fi: wifi.js documents its events as `area:wifi:*`, they are emitted under `area:radio:*` (the radio world's `ctx.emit`); the page listens there. Per-request data comes only from `area:net:*` (http, unreachable, ping, udp, mqtt), with no router id, so the page attributes it to the router the station is on.
- Infrared: no shipped app arms the receiver or transmits, so the remote always reports "receiver is not armed" and the TV is only checked at area level. NFC and IR objects persist in the Dot's own regions with ids the glue assigns; there is no call to adopt an existing id, so the page wipes and recreates after each boot.
- microSD: inserting does not mount; the page calls `sd.mount()` (kodeOS boots with the card mounted).
- RFID objects are per program (recreated by the page); Power is not persisted by the fake (page re-applies it).
- An emscripten `ExitStatus` page error shows up now and then when a program is restarted while it boots; the check ignores that one name.


## Bench3D kit and the Workbench (2026-11-17, in progress)

### Bench3D: the model kit (`web/src/bench3d/`, guide in its README.md)
A kit and a contract for procedural 3D models, usable without touching the page: one model per file under
`web/src/bench3d/models/<family>/<part-id>.model.ts` (default export `defineModel({ id, title, footprintMm, plugMm?, build, terminals?, animate?, states? })`),
found by file name (`registry.ts`, `import.meta.glob`). Millimetres; origin at the centre of the footprint on the table, X right,
Z towards the viewer, Y up; the front of a part faces +Z.
- Wired parts take everything from the parts engine's manifest: id = manifest id, `footprintOf(body)`, `terminalsFromManifest(manifest)`
  (manifest frame: origin top-left, x right, y down the picture, z up; model X = mm.x - w/2, Z = mm.y - d/2, Y = mm.z or the face's
  height; face -> wire direction), state = `PartState` (the part's entry of `bench.state().parts[]`). The mapping is stated in the
  README and unit-tested.
- `shape.ts`: `Shape` accumulates bevelled solids (prism with holes, box, disc, lathe, tube, rod, band, block) in a colour and a material
  family (matte, gloss, metal, soft, pcb, glass) and merges them into one mesh per family: the static body, instanced by the Workbench.
- `materials.ts`: `PAL` finishes (boards, tin, gold, copper, plastics, rubber, resins) and `INK` print colours.
- `parts.ts`: pcb (rounded, drilled), pinHeader (male/female, 1 or 2 rows), lead/axialLeads/roundCorners, soic, qfp, qfn, moduleCan,
  usbC, microUsb, usbB, barrelJack, tactButton, electrolytic, ledDome/ledLeads, screwTerminal, heatsink, shaft, gear, pad.
- `print.ts`: `print()` decals drawn by code in millimetres (silkscreen, pinLabels, legends), redrawn when the page's fonts arrive.
- `nodes.ts`: `lamp`, `glowing`, `screen`, `part`, `setLamp`, `drawScreen` for what changes per copy; `instantiate` for hosts.
- `contract.ts`: types, `budgetFor` (triangles by footprint area), `inspectModel` (inside the footprint, not under the table beyond
  `plugMm`, budget, mesh count, terminals).
- Reference models: `nfc.tag` (simple, 398 triangles), `wifi.router` (complex, 1,486, three lamps with states), `ref.led-5mm`
  (wired: manifest size and terminals, legs, glowing dome, hazard states), `ref.kit-sampler` (every builder on one board, 10,842).

Run (any engineer, one model, no page): `node scripts/model-shot.mjs --model <id> [--state <name|json>]` writes
`web/screenshots/models/<id>/{front,back,side,low,top}.png` and `state-<name>.png` (top = drawing with terminals and a millimetre
scale), prints triangles against the budget and the contract problems, exit code 1 on a problem; `--all`, `--list`.
`node scripts/model-gallery.mjs` writes the contact sheet `web/screenshots/models/_gallery.png`. `npx vitest run src/bench3d`
checks every model in node. Last run: unit tests 196/196, `npm run build` green, `model-shot --all` 4/4 ok.

### Workbench (phase 1: the scene and the wireless objects in 3D)

Run: `npm run build && node scripts/workbench-check.mjs [--no-shots] [--no-perf]` (headless Chrome, fresh profile, the real page).

What it is
- `host.mode`: 'device' | 'workbench' (desk and tablet default Workbench, phone default Device; remembered apart; `?mode=` in the
  URL decides for one visit, and the older check scripts ask for `mode=device`). The toolbar's first control is the Device / Workbench
  switch; in the Workbench it also has Focus on the Dot, Whole table, Undo, Redo. On a phone the Workbench is opened from the Bench
  tab of the sheet ("Open the Workbench") and left the same way or with the toolbar.
- One canvas, one Dot (`Device3D` got `mode`/`world`): in the Workbench the same model lies face up on the table
  (`web/src/workbench/`: `world.ts` scene and the Dot's pose, `bodies.ts` everything on the table, `World.tsx` input, `camera.ts`
  orbit rig, `table.ts` wooden top and desk mat with a 10 mm dot grid and a ruler, `layout.ts` table maths, `state.ts` selection and
  commands). The screen is the live framebuffer and takes touch, the buttons press. Switching modes moves the Dot and the camera
  (about half a second); the program, the bench and the WebGL context stay.
- Camera: drag turns, Shift/middle/right drag slides, wheel and pinch zoom, two fingers slide; never under the table (78 degrees
  from the vertical at most), never off the table; double click on a thing or on the Dot frames it; keys F and 0.
- Things stay on the table: dragging slides on the table plane, snapped to 5 mm (Alt: free), kept on the mat; a dragged thing
  goes round the Dot and the other things (it is pushed out the shortest way), several selected things move as one and stop
  where one of them has no room; R / Shift+R and a button turn a quarter; Shift-click adds to the selection, Ctrl+A, Escape;
  Delete; Ctrl+D; Ctrl+Z / Ctrl+Shift+Z and the toolbar (bench edits from the scene AND from the panel: add, delete, move, turn,
  near/away, rename, field edits; a drag, a held arrow or typing is one step); arrows nudge one grid step (Shift: five), N brings
  near or takes away; with nothing selected the arrows are the Dot's D-pad as before.
- Bodies: every kind has a Bench3D model (see the kit above): NFC tag, NFC card, desktop NFC reader (status light), EM4100 card,
  T5577 fob, door reader (bar blue while waiting, green granted, red denied), router (power, link: amber blinking while the Dot
  joins and blue when joined, traffic), TV (its screen shows power, channel, volume, mute; standby lamp), remote (six caps that go
  down; pressed in the scene they send, held they repeat), charger (its cable runs to a USB-C plug that goes into the middle of
  the Dot's bottom edge when plugged), battery (label with the charge), microSD card (flies into the slot of the left wall when
  inserted). Static bodies are instanced per kind and material family; lamps, screens and caps are a small copy per object.
  What the Dot does with an object shows as a ring pulse under it (green ok, red refused) and on its lamps.
- Motion: the amber ball off the Dot's top edge tilts it (drag: pitch and roll; Shift: heading; double click: flat; Alt+arrows
  from the keyboard), writing the pose the motion sensors read; the Dot's card in the panel has the three sliders, Shake and
  Lay flat. Lying flat on the table is the zero pose.
- Near and far are distances (`layout.ts`): NFC within 46 mm of the coil (upper half of the back), 125 kHz within 58 mm (lower
  half), infrared a beam out of the top edge (33 degrees either side, 255 mm), Wi-Fi within 300 mm with the signal the Dot hears
  falling with the distance (the router's own setting less up to about 18 dB; the fake's `signal` is set from it), the charger
  within its cable (105 mm of the bottom edge), the card within 26 mm of its slot. The range shows on the table while a thing of
  that area is dragged (and while a palette tile is), stronger when the thing is inside. Dragging in or out flips the object's
  near state at once; the switch moves the object just into or just out of its range. The bench store is the only truth
  (`pos`, `rot` per object, saved as v3; older benches get places: near things near, the rest parked); the runtime re-applies it
  to every program as before.
- Side panel (the same in Device mode and in the phone sheet): the inspector of the selection (the object's own card; the Dot:
  tilt, shake, this phone's sensors; the microSD card: its files panel; several things: bring near, take away, delete), the list
  of what is on the table with each thing's switch, and the palette (click to drop at a free spot, or drag the tile onto the table).

Checked by `workbench-check.mjs` (last run: all passed): the page opens in the Workbench with kodeOS running; the Dot's screen
in the scene is live; a swipe on it unlocks kodeOS; the NFC app is opened from kodeOS by touch on the 3D screen; an NFC tag is
added, taken away with the switch (it moves), dragged with the mouse from far to near (near, on the grid, not overlapping the Dot)
and Read in the app reads it; dragged away it is gone for the Dot's NFC area; Device and back: the NFC app is still the running
program, no reboot, same bench; arrows, R, N, Delete, Ctrl+Z, the undo and redo buttons; the remote's Vol+ pressed in the scene
sends; the card is in the slot at boot, dragged out it is ejected, its switch puts it back; the charger plugs and unplugs; the
tilt ball tilts the Dot; a palette tile dropped on the table lands there; a reload keeps every place and the bench is applied
again; no page errors; nothing is drawn while nothing changes.

Other checks after the Workbench landed (the older scripts ask for Device mode and follow the new panel): `system-check.mjs`
all passed (25), `bench-check.mjs` 20 passed (the bench is driven through the new list, palette and inspector, in Device mode
with the 2D view: the bench works without the table), `settings-check.mjs` all passed (18; run before the default names and
the toolbar thresholds changed), `AUDIT=off headless-check.mjs` 169/169 (run before the last toolbar threshold change),
unit tests 214/214, `npm run build` green. After main took the merge of the parts engine, USB and Bluetooth, `workbench-check.mjs` passed again on a fresh build (the other scripts were not run again after that merge). Layout audit (`layout-audit.mjs`, with new scenes `bench-objects`, `bench-list`,
`object-menu`, `workbench`): 1280x720 and 390x844 clean in both themes and three languages; 820x1180 and 1024x768 clean (12/12)
after the toolbar labels were made to collapse earlier (the Spanish and Portuguese toolbar overlapped its neighbours on a tablet).

Frame time, whole table in view, 1280 x 720, SwiftShader (software GL, a floor: it is bound by pixel shading; no real GPU was
measured): 1 object 82 to 90 ms, 20 objects 108 to 166 ms, 60 objects 185 to 332 ms over four runs on a shared machine
(the device alone in Device mode measures about 250 ms here, where it fills the view). Draw calls: 33, 90, 150 (60 objects of
nine kinds: the static bodies are 4 to 5 calls per kind whatever the count; the rest is lamps, screens and button caps).

Screenshots (`web/screenshots/workbench/`): `table-dozen-desktop.png`, `table-dozen-low-angle.png`, `table-dozen-dark.png`,
`range-{nfc,rfid,wifi,ir,power}.png`, `range-while-dragging.png`, `object-<kind>-{a,b}.png` (every object close up from two
sides, the Dot and the card included), `nfc-read-in-workbench.png`, `dot-tilted.png`, `perf-60-objects.png`,
`table-{tablet,phone}.png` and `-panel.png`, `desktop-empty.png`; every model alone: `web/screenshots/models/`.

Estimates and limits
- The maker publishes no positions for the coils, the infrared window or the USB-C port: NFC and 125 kHz coils against the back,
  infrared out of the top edge, USB-C in the middle of the bottom edge are estimates in `layout.ts` (`ANCHORS`). The card slot is
  the one of the left wall of the body model.
- Infrared: no shipped app arms the receiver or transmits, so the TV reacting to the Dot's codes is the driver's path
  (`tv-state` events) and is not exercised end to end; the remote reports "receiver is not armed".
- The wireless objects are drawn smaller than life where life is too big for a desk (TV 150 mm wide, router 118 mm).
- Pressing a remote button needs the pointer on the cap itself; a touch on a phone-size table is fiddly: zoom in first.
- No real GPU, phone or tablet was used: frame rate, pinch and two-finger slide on glass are unverified.
- Seams for phase 2: `bodies.ts` draws any Bench3D model by id (static part instanced, dynamic part per copy, `animate` with a
  state object, controls picked by ray), `layout.ts` sizes come from the models' footprints, the store keeps `pos`/`rot` per
  object; wired parts need their own state source (the parts engine), terminals drawn from `model.terminals`, wires and a library.


## Workbench phase 2 (2026-11-17: parts, wires, code, own parts, Bluetooth and USB, bench file)

Run: `npm run build && node scripts/workbench2-check.mjs` (headless Chrome, fresh profile, the real page; last run: all 15 passed).

Done
- `scripts/prepare-parts.mjs` (part of `prepare:assets`): builds `parts/dist` when it is missing (`node parts/build-library.mjs`) and
  copies the 39 packages, `library.json` and the engine's `part-worker.js` to `web/public/parts/` (git-ignored, like the adapter copy).
- `web/src/parts/service.ts` (`PartsService`, in the host): the page's side of the parts engine. The bench store stays the truth:
  a wired part is a bench object of area `part` (kind = the part's id, id = `p1`, `p2` ... which is also its instance name in the
  engine, fields, `pos`, `rot`), made by `BenchStore.addPart`. The service fetches the library index, fetches a part's package the
  first time it is needed, starts the engine lazily (`configureWorker({source})`, `new Bench()`, `attach` to the Dot's system
  object through `SystemDevice.system()`), and makes the engine equal to the store (add, remove, fields), so parts survive
  program restarts and reloads exactly like the wireless objects. It exposes the engine's `state()` per part and the hazards.
- Bodies: `bodies.ts` draws a part with its Bench3D model when one exists (id = part id: the inputs and breadboards families are
  in), otherwise with `parts/fallbackModel.ts`: a board of the manifest's body with the part's own picture as its top and a gold
  mark at every terminal (also the body of parts users will import). The model's `animate` gets the part's engine state
  (`PartState`), again on every engine change. Controls marked by the model (`bench3d/controls.ts`) are picked by ray: a
  momentary control is held while the pointer is down, a toggle steps on a click, a knob follows the pointer round its axis;
  each writes the part's field in the store, which reaches the engine.
- Components tab: the library (search over names and keywords in the page language and English, category chips, click to place at
  a free spot or drag onto the table), the parts on the table, and the selected part's card: fields from the manifest (number, enum,
  switch), what every pin carries (volts or not connected) and whether the part has power, hazards with "Replace the part"
  (`repairPart`), turn, duplicate, delete, show on the table. Moving, turning, deleting, duplicating and undo/redo are the bench's
  own (the same code as the wireless objects).
- Kit: `inspectModel` honours `overhangMm` (`overhangOf(manifest.body)`), the breadboards draw their dovetail tabs.
- `workbench-check.mjs`: sections with their own page are retried once from their start when the page is lost under software GL
  (the "detached Frame" after the last PASS).

Checked by `workbench2-check.mjs`: the library lists 39 parts and search narrows it; breadboard, LED, resistor, push button and
Uno R3 placed from the panel each get a body and an engine instance (`p1`..`p5`, separate places); the resistor set to 1000 ohm in
the inspector is 1000 ohm in the engine and its two pins are listed; the push button's cap held with the mouse in the scene presses
it (`pressed` true, false on release); Delete removes it from the table and the engine, Undo brings it back; after a reload the
same parts, places and fields are in the engine again with bodies; no page errors.

### Steps 2 to 6 (same day)

Run: `npm run build && node scripts/workbench-proof.mjs [--only a,b,...] [--no-shots]` (the proof by mouse, sections a to h and p;
screenshots in `web/screenshots/workbench2/`). Results of the last full run are at the end of this section.

Wires and terminals (`workbench/wires.ts`, `parts/geometry.ts`, store `wires`)
- A terminal is `"<instance>.<pin>"` or `device.<name>`. Places come from the manifest (`mm`, `face`, the same mapping as the
  models) through where the part stands, how high (legs in holes) or the mount matrix; the Dot's 20 header pins are terminals in
  its top wall and follow its pose (2 x 10, 2.54 mm, odd pins toward the screen, pin 1 at the Dot's left seen from the front:
  read off the pin names the Dot's own shell prints beside the holes; `wires.test.ts` checks every pin against that print).
- The wire tool (toolbar button or W; eight colours in a strip over the table) shows every terminal as a dot (board holes are not
  dotted: the board shows them). Picking is done on the screen: the nearest terminal within 13 px, so a 2.54 mm header is hit at
  any zoom at which it can be told apart; the name and the owner show in a tooltip. Click a terminal, then another (or press on
  one and let go on the other); Esc lets the wire go; a click on a wire selects it (also from the Wires list), Delete removes it,
  its card changes the colour. Wires are in the bench store with undo, and one mesh in the scene: tubes that rise from each end
  and lie on the table (or over the bodies under them), bowed sideways by wire so that neighbours stay apart. The line is made
  of Bezier pieces (`wirePath`): out of each terminal the way it faces (a header pin out of the Dot's top wall, a side pin
  sideways), down to the table without dipping under it, round the Dot and tall parts. (Until 2026-11-17 it was one spline
  through a few points, which sank under the table on long runs: only the middle of a wire from the Dot showed.)
- Legs in holes: a part whose pins are all `bottom` legs, let go over a part with sockets on top (breadboards, an Uno's headers,
  the Maker module), is pulled so that every leg is over a hole (2.2 mm reach), stands at the holes' height and is connected: the
  service keeps one engine wire per leg (`plug_<instance>_<pin>`) for as long as the part stands there. Nothing is stored: it is
  derived from the positions, so moving it off disconnects, undo and reload restore it. Two parts cannot take the same hole. Parts
  travel with the board they stand in.
- Modules: a part with `mount` in its manifest gets "Mount on the Dot" / "Mount turned over" / "Take off". The body is placed by
  `mount.connector.seat_mm`, `mount.placement.anchor_dot_mm` and the axis table (`mountMatrix`, tested to be a rotation), as a
  child of the Dot's pose, so it tilts with the Dot. Dragging a mounted module takes it off.

Code (`components/CodeEditor.tsx`, `code/compiler.ts`, `code/examples.ts`, `scripts/prepare-cc.mjs`)
- A board's card has "Code": an editor over the table (CodeMirror 6, C++ mode, in a shadow root so that its styles are constructed
  style sheets and the site's CSP stays `style-src 'self'`), a tab per file with add and remove, six examples (blink, button, fade,
  servo, knob, serial echo in two files), "Compile and upload", "Back to the original sketch", the problems list (click goes to
  the line) with the same problems underlined in the text, and the board's serial monitor with a line input and "Restart the board".
- The compiler (`runtime/cc/index.js`, copied to `src/generated/cc/`) is created the first time an editor opens and fetches only
  its manifest; the first Compile downloads the toolchain with a progress bar (bytes of the compiler's own progress events), later
  ones come from the Cache API. Upload is `setPartCode`: only that board restarts. Sketch text is kept in the bench store
  (`code`), the compiled binary in IndexedDB (`dotbench.bench` / `code`) and given back to the engine when the part is added
  again (reload, undo, an opened bench file).
- `prepare-cc.mjs` (in `prepare:assets`) copies `<repo>/build/cc-assets` to `public/cc/` (git-ignored). Two things the compile
  service should know: (1) `runtime/cc/build/build-assets.mjs` is not in `main` (the root `.gitignore` has `build/`, which hides
  that folder), so a clean checkout cannot build the assets: here they were copied from the compile service's worktree; without
  them the build still works and the editor says the compiler's files are not on this site. (2) the packs are named `*.pack.gz`;
  `vite preview` (sirv) answers them with `Content-Encoding: gzip`, the browser inflates them and the compiler fails with
  "Failed to fetch"; the page therefore serves them as `*.pack.bin` (the manifest is rewritten to match). The assets are 120 MB
  on disk (five boards); the first compile downloads about 21 MB.

Own parts (`components/MakePanel.tsx`, third tab "Make")
- Import of `.dotpart` files by picker or drop (the engine's own `loadPart`: its errors are listed), the visitor's parts with
  "put on the table" and remove, kept in IndexedDB and loaded again with the library. An imported part without a model gets the
  body made from its manifest. The starter folder as a zip (`scripts/prepare-starter.mjs`, made at build time from
  `templates/component-starter` with the repository's own zip writer), the AI prompt in the page's language with a copy button,
  and the manual (the starter's README, rendered) in English, Portuguese and Spanish.

Bluetooth and USB (`bench/drivers/ble.ts`, `usb.ts`, three models in `bench3d/models/wireless/`)
- `ble.sensor`: name, temperature, battery; a puck whose display shows the value. `ble.phone`: scan, connect, pair (passkey typed
  on the phone, or read off the Dot), disconnect, forget; the phone's screen shows the link and the passkey box. `usb.computer`:
  a small laptop whose cable goes into the Dot's USB-C port like the charger's; serial terminal with input, a file to the Dot and
  from it, "Install an app over USB" (`UsbComputer.installPackage`). The charger on its USB cable and the computer share the port:
  the one plugged last stays (store rule). The "Coming soon" line has nothing left to list and is gone.

The bench as one file (Bench tab, "Bench file")
- Save writes `bench.kodedot.json`: the store's data (objects, places, wires, mounts, sketches) plus the compiled sketches and the
  imported parts (base64). Open replaces the bench (undoable). The same data is what the browser keeps between visits
  (localStorage for the store, IndexedDB for binaries and imported parts).

Proof, last runs (2026-11-17, headless Chrome with software GL on a 2-core machine that other jobs were loading)
- `workbench-proof.mjs`, full run: sections a to g, 43 checks passed (third start: the page froze twice before, see below);
  sections h and p run on their own: 5 checks passed. What each proves:
  (a) breadboard, red LED and resistor placed from the library, the two legged parts dragged into the board's holes, two wires
  drawn by mouse from header pin EXP1 and to GND, the GPIO app opened from the installed apps and worked by touch on the 3D screen
  (Pins, Pin 1, Output, High): LED brightness 0 -> 0.40 (4.0 mA), Low: 0. (b) Uno, editor, Blink compiled and uploaded, LED 0/1
  and "on"/"off" in the monitor; a broken line 16 is reported on line 16 in the list and in the text, nothing uploaded; keys do
  not reach the table while the editor is open. (c) servo wired by mouse to D9, 5 V, GND; the sweep sketch moves it 0..180.
  (d) green LED across the 9 V battery burns, the card says so, a wire is clicked and deleted, repair restores the LED.
  (e) Robotics module mounted (body at the Dot's top edge), a motor on its output turns one way and the other, the three inputs
  driven through the engine's test hook; mounted turned over too. (f) Save writes one file (14.7 KB with the sketch's binary);
  after a reload 9 parts, 9 wires, 13 engine links, the legs in their holes, the module on the header and the uploaded sketch are
  back and the board runs it without compiling; the file opens into the same bench on an emptied table. (g) a `.dotpart` imported,
  listed, placed, kept over a reload, removed; a wrong file refused with the reason; the starter zip, the prompt with Copy, the
  manual. (h) sensor, phone and computer with bodies, "Coming soon" gone; the phone finds the Dot ("Found KODE... (-50 dBm)");
  the computer's terminal answers `ping` with `pong`; charger and computer take the port from each other.
- Numbers: first Compile and upload 14.6 to 21.5 s (about 21 MB fetched from the local server, compile, upload); a compile with
  everything cached 6.3 to 8.2 s. Frame time with 60 mixed parts and 40 wires, whole table in view, 1440x900: 480 and 593 ms
  (185 draw calls, 195,000 triangles, the wires 12,480 of them); phase 1 measured 185 to 332 ms for 60 wireless objects on the
  same software renderer when the machine was quieter. Not measured on a real GPU.
- Others: unit tests 273 passed; `workbench-check` 29 passed, `bench-check` 20 passed (each after one run lost to the freeze),
  `workbench2-check` 15 passed. Layout audit with the new scenes (part card, wire tool, code editor, Make tab): 820x1180 ran
  clean in English light and Spanish dark except the wire colour buttons (24 px on touch), which are 44 px now; the runs at
  390x844 and 1280x720 and the re-run at 820x1180 died with the browser (machine overloaded), so phone and desktop are NOT
  audited for the new panels, and the code editor was not looked at on a phone.

Weak or not done
- The page can freeze: the page's thread is seen stuck inside the firmware's `ble_out_pop` (called by `runtime/drivers/ble/ble.js`
  `poll -> drain`), most often right after a program starts, more often when the machine is loaded. It is not bench code; the
  proof script starts again when it happens (up to three times) and the older check scripts fail on it now and then.
- (e) drives the Robotics module's three inputs through the engine's `setDevicePin` (a test hook, `PartsService.drivePin`): the
  GPIO app drives one pin at a time and its pin list needs scrolling by touch, which the script does not do.
- Pairing on the phone was not run end to end (scan and the buttons were); file transfer and app install over USB were not run by
  the script (the terminal was).
- A board's EEPROM is not kept across reloads (the compiled sketch is). Wires are not yet drawn red when the engine reports a
  short (the wire's card says so). Hazards show in the part's card, not in the scene.
- The coil and port anchors are estimates. Touch and a real GPU were not tried. The editor keeps the
  light highlight colours in the dark theme.
- The part names shown in the library ("Arduino Uno R3" ...) are the parts library's data; the models carry no marks.

## Parts batch 5 on the models, and the boards' buttons (2026-11-17, branch fix/refit-batch5)

Run: `cd web && npm test` (302 passed, 29 files; 279 before, one of them failing), `npm run build`, and
`UX_PORT=4397 node scripts/controls-check.mjs` (headless Chrome on the built site, a port of its own; 19 checks passed, then
`--only modules` for the picture: 2 passed). Model shots: `node scripts/model-shot.mjs --model <id>` for each model named below.

Models refitted (`web/src/bench3d/models/`)
- Robotics: `contract.test.ts` failed because the batch moved the screws of the two blocks to y = 2 mm and a 3.81 mm block (5.7 mm
  deep, screws in the middle) then passes the far edge by 0.86 mm. The model was already reading the pins; it now also reads what
  the manifest lets it overhang (`overhangOf(body)`, nothing today) and ends the blocks at the footprint's edge (`screwBlock`'s
  `back`): 4.86 mm deep, the near face where it was. The day the manifest has `overhang_mm.back` the blocks get their whole depth
  with no change here. Their outline runs down the right side as in the picture, the names keep off the mounting holes, nothing is
  printed across a hole.
- Maker: nothing was typed in the model: strips, legends and corner marks moved with the manifest (GND upper right, 3V3 lower right).
- Both modules (and the Camera, same builder): the mounting holes are plain drilled holes with a pale edge. Looked at closely, the
  store picture has no gilded ring round them; the rings were the model's.
- Uno R3, R4 Minima, R4 WiFi: L lights at `visuals.led.mm` and the reset switch stands at `controls[reset].mm`
  (`unoGeo.visual`, `unoGeo.control`: body millimetres less the overhang; the outline's arcs and the 2.04 mm overhang came through
  the manifest's `outline` by themselves). The word RESET follows the switch; on the Minima the grid is rubbed out under it.
- ESP32 boards: the two switches are the manifest's controls (`switchesOf` in `esp32/board.ts`): at `controls[].mm` when the board
  has room for a switch there, otherwise where the board's drawing has them. The three DevKitC V4 parts take the manifest's places;
  the S3 does not (see the data notes). Names of pins that would lie under a switch are not printed.
- LED with resistor: the model reads `fields.ohms` and `outputs.brightness`, both unchanged: no change.

Buttons (C)
- On the model: each control is the switch's plunger, marked with `controlFromManifest`, with an unseen hit area the size of the
  switch's top (`hitPad`, new in `bench3d/controls.ts`). The Workbench's existing momentary path does the rest: pointer down sets the
  part's field true in the bench store, up sets it false, no drag starts. A press shows as the plunger going down (0.5 mm on the
  Unos, 0.45 on the ESP32s) and an amber glow over the switch.
- In the card: "Buttons on the board" with one press-and-hold button per control (`parts/controls.ts`, `HoldButton` in
  `ComponentsPanel.tsx`): pointer, Space or Enter; it is shown held while the model's button is held too; it lets go when the card
  goes away. The hint under each ("Restarts the sketch", "Holds IO0 at 0 V while pressed") is typed i18n in en, pt-BR and es; the
  button's name is the manifest's label. A momentary field of a plain part (the push button's `pressed`) stays the switch it was.
- The engine: nothing was missing. The store's field reaches `bench.setField(instance, field, value)` through `PartsService.sync`;
  the engine restarts the sketch when a field with `action: "restart"` goes true and holds `pin` at 0 V through 10 ohm while a
  field with `action: "pull_low"` is true (runtime/web-adapter/bench.js and bench-wasm.js, batch 5).
- Checked in the page: reset held on the Uno's model and then in its card empties the serial log and the sketch prints its first
  line again; the plunger is 0.50 mm down while held; letting go leaves the board where it was. BOOT held on the S3: IO0 goes from
  floating to 0 V and back, the sketch keeps running. EN held: the S3's sketch starts again. Screenshots:
  `web/screenshots/workbench2/controls-uno-reset.png`, `controls-s3-boot.png`, `controls-modules.png`.

The modules beside the store picture (looked at as pairs, the model turned to the picture's angle; the pairs are not in the repository)
- Robotics, same: outline, four holes, the three-pin and five-socket strips down the left, six sockets down the right, every legend,
  the driver with its two sense resistors and small parts, the header, "robotics rev1.0". Different: the picture's blocks hang over
  the far edge and stand clear of the two far holes; the model's end at the edge and each stands over a hole (data, below). The
  maker's logo and web address are left blank on purpose.
- Maker, same: breadboard with its channel, the fourteen sockets with turned legends, two strips a side, GND above 3V3 on the right,
  the header, "maker rev1.0". Different: the picture's strips stand against the breadboard with the legend outside them; the model's
  stand at the board's edge with the legend inside (data, below). The picture prints "3V3-2A" (a prototype, says the written spec);
  the model prints the documented "3V3-1A". The band between breadboard and header is wider than in the picture (board size, an estimate).

Data that looks wrong (for the parts engineer; nothing was changed under parts/)
- kode-robotics body: `d_mm` 48.5 and no `overhang_mm.back`, with MOTA/MOTB at y = 2 mm. A block centred on those screws reaches
  y = -0.86 mm; the picture shows more.
- kode-robotics MOTB x 7.5 / 11.31 and MOTA x 33.4 / 37.21: the blocks (x 5.6 to 13.2 and 31.5 to 39.1) cover the holes at (5, 4.75)
  and (40, 4.75). Measured on the picture in the frame of the four holes (the stepper pins come out within 0.3 mm of the manifest
  in that frame): block B spans about x 9.0 to 16.0, block A about 28.1 to 35.4, so the screws are near 10.6 / 14.4 and 29.8 / 33.6.
- kode-maker strips x 1.8 / 56.2 (half a millimetre from the edges): the picture has them beside the breadboard, about x 5.0 / 53.0.
- Uno reset (`estimate`): body (16.4, 4.5) on the R3 and (12.04, 4.5) on the R4s, that is board (10.0, 4.5). The maker's board
  files have (6.35, 3.94): body (12.75, 3.94) and (8.39, 3.94). At the estimate the switch touches the mounting hole beside it and
  lies over a diode (R3) or a resistor (R4s).
- ESP32-S3 EN (57.24, 3.5) and BOOT (57.24, 21.9): that is where the two USB-C sockets are (from x 55.3; y 3.1 to 12.1 and 13.3 to
  22.3). The model keeps RST at (50.0, 5.6) and BOOT at (50.0, 19.8), from the user guide's component map, and takes the manifest's
  place as soon as it is one the board has room at (tested).
- DevKitC V4 parts: EN (48.6, 4) and BOOT (48.6, 23.94) are 2.2 mm nearer the header rows than the model had them and cover the
  last pin names; as I know the board, EN is on the side of the row that carries EN (the front row here) and BOOT on IO0's, the
  other way round. Not checked against a drawing in this pass.
- The DevKitC V4 parts' `visuals.led` (GPIO2) has no `mm`; that board has no such LED and the model shows none (as before).

Not done
- The page run was at 1440x900 with the mouse; touch and a phone were not tried. The card's buttons were pressed with the mouse,
  not with the keyboard, in the page (the handlers are there).
- `_gallery.png` of the model shots was not redrawn.

## Wires, modules on the Dot, nothing under the table (2026-11-17, branch fix/wires-mount)

Run: `cd web && npm test` (363 passed, 30 files; 302 in 29 before), `npm run build`, and for the pictures
`UX_PORT=4398 node scripts/wires-mount-shots.mjs [--only wires,legs,cross,modules] [--cost]` (headless Chrome on the built site;
every picture named below is in `web/screenshots/workbench2/`). The owner reported three defects; each was reproduced in a
picture first (same script, same views), fixed, and looked at again.

### 1. Wires looked like glass and went through things
- Root of the look: every triangle of every tube was wound inward (`tubeIndices` in the kit, and the copy of it the wires had).
  With a front-side material the near wall was culled and what showed was the inside of the far wall, lit from behind: hollow,
  striped, "see-through". The material itself was always opaque. Fixed where it was wrong, in the kit (`bench3d/shape.ts`), so
  the models' cables and antennas and the charger's lead are right too; the wires write their own rings (`writeRings`,
  `writeRingIndices`) and a test checks the winding of both.
- Root of the passing through: the old line was a curve from terminal to terminal that only knew the height of the table under
  each point and the Dot's footprint; it rose from a hole toward the other end at once (through the board's own body) and
  climbed onto a body only when it was already inside it.
- `workbench/wires.ts`, `wirePath(a, b, boxes, { fan, seed })` (pure, tested): out of each terminal straight along the terminal's
  own direction for 4.5 mm (up out of a hole or a socket, outward from a side pin, out of the header's opening in the Dot's top
  wall), a bend of 5.5 mm, then the run: in plan the straight line, or the shortest way round what is gone round (the Dot with
  its module, and anything taller than 24 mm: corners of their boxes 11 mm out, rounded); in height on the table, rising to each
  end and over every body under the line (its top + 1.8 mm, reached 5 mm before the body begins), dips rounded. An end that
  faces away from the run turns aside by 9 mm instead of folding back. Only the two stubs may be inside a box: their own
  terminal's. Bodies are boxes (`WireBox`): every thing on the table with its height (a part in a board's holes or on its legs
  included), the Dot as it lies (tilted too) and the module on its header.
- A pin under a body (`face: bottom`) is left sideways past the nearest side, not up through the body; a bare leg a part stands
  on is held half way down. The 20
  pins of a mounted module's own connector are in the Dot's header: they are no longer offered as terminals while it is mounted.
- Wires between the same two things are a bundle: they bow to the same side (2 to 7 mm of slack on a free run) and are pushed
  apart in the middle only where they would lie on each other (2.6 mm), in the order they already lie in, so they do not cross.
- Look: 1.6 mm tube, six sides with smooth normals, satin opaque plastic in the wire's colour (roughness 0.58, no metal, depth
  written, drawn with the solid bodies), closed down onto a 0.64 mm tinned pin at each end that goes 1.4 mm into the terminal (a
  second mesh: one more draw call).
- Cost: each wire's line and tube are kept (`Built`) and made again only when its ends, its place in a bundle, its thickness or a
  body in or against the rectangle its line was made in change; a colour is only copied. Measured with `--cost` (the proof's
  scene p: 60 mixed parts, 40 wires, whole table, 1440x900, software GL, 2 cores shared with other jobs), before -> after:
  frame 502 / 452 / 545 ms -> 463 / 538 / 415 ms (the same within this machine's noise); 181 -> 183 draw calls; 198,654 ->
  200,208 triangles (the wires 15,360 -> 16,912); all 40 wires made from nothing 2.7 -> 12.6 ms (once); one part moved a step
  5.3 ms with all 40 wires made again -> 5.1 ms with 2 made again; a frame with nothing changed 0.002 ms both.
- Pictures: `wire-header-to-breadboard-front.png`, `-side.png`, `wire-header-from-behind.png` (out of the hole printed IO8, down
  to the table, up over the board's edge, down into the hole), `wire-round-the-dot.png`, `wires-fan.png`,
  `wires-crossing-a-board.png`, `-low.png` (three wires from the header over a breadboard to an Uno, a fourth from the board).

### 2 and 3. Modules on the Dot
- Root of "upside down": data. `mount.placement` of the three flat modules (Maker, Robotics, Camera) had `upright` and `turned`
  the wrong way round (flagged `assumed`, "no mounted photo of them"): upright put the component side on the Dot's back. The
  two tables are swapped in `parts/kode-{maker,robotics,camera-shape}/manifest.json` (the `mount` block only; `parts/prebuilt`
  regenerated, `parts:check` up to date) and flagged `documented`.
- Evidence for which face is up when the Dot lies screen-up:
  1. The maker's documents (as read in `/home/claude/research/06-official-modules-spec.md`, each marked [DOC]): the Maker's
     breadboard is "on the screen side when mounted"; the Robotics pin table is headed "Attach (screen-side, upright)"; the
     Camera's two tables are "lens towards you (lens on the screen side)" and "lens looking away"; turned round "power stays safe,
     every GPIO moves" and the factory tests Robotics turned, so both ways exist physically.
  2. The parts library's own definition (`parts/gen/data/modules.json`): `gpio` is what a pin meets "when mounted upright
     (screen side)". The engine's `upright` is that map; the picture now is that pose.
  3. The store picture (ref-4) against the Dot's own print: on the Robotics board seen from its component side with the connector
     toward the viewer the legends GPIO8..11 run down the left edge and GPIO15..18 down the right; the Dot's shell prints IO8..IO14
     beside the left half of its header (seen from the front) and IO15..IO21 beside the right half. Component side on the screen
     side, the two agree; the other way every line would have to cross the board.
  4. ref-5 and ref-8 (the cased radio modules on the Dot): the block's marked face is on the screen side, the tongue on the back.
- Where the connector meets the header, and how thick the stack is: the header is in the middle of the top wall's thickness (the
  render of the Dot's top wall, `shots/model-custom-top.png`: the two rows of holes sit midway between the wall's edges, 2.54 mm
  apart), so its axis is 9.9 mm above the table when the Dot (19.8 mm) lies face up. A flat module's right-angle connector has its
  two rows 2.87 and 5.41 mm above the board's underside (manifest), axis 4.14 mm. Upright: the board lies in the Dot's plane past
  its top edge, underside 5.76 mm above the table (it hangs on the header), its tallest part at 19.76 mm, level with the Dot's
  face. Turned: the same board half a turn about the Dot's long axis, parts hanging down to 3.5 mm (Maker), 3.8 mm (Robotics),
  6.2 mm (Camera) above the table: nothing touches, the Dot lies flat. The radio modules (one way only): the tongue, 14 mm thick,
  lies against the back of the Dot's upper 26 mm; the stack is 33.8 mm thick there.
- Both orientations are kept for the flat modules (both exist and the engine maps the pins for each); the card's "Mount turned
  over" now is the component side down.
- Root of "through the table": the Dot was rested on the lowest of its own eight corners only, and a module was drawn as its
  child wherever that put it. Now (`workbench/rest.ts`, used by `world.ts`) the Dot and the module on its header are one rigid
  thing that lies on the lowest points of the whole assembly: the corners of the module's model hull (65 to 413 points, kept
  per kind) through the mount matrix join the Dot's corners. When the module reaches lower than the Dot's back the stack TILTS
  (chosen over lifting the Dot level, which would leave its bottom end hovering): it rests on the Dot's bottom edge and on the
  module, on the edge of the side outline that is under the Dot's middle. With a radio module that is 14.8 degrees, top end up,
  the Dot's middle 19.4 mm above the table. The tilt is a way of lying, under the hand's own tilt (the amber ball), and is not
  reported to the motion sensors. Wires, terminals, the card slot and the USB plug follow, as they follow any pose of the Dot.
- Found by the new invariant: 21 library parts with legs (`plugMm`: LEDs, resistor, diode, capacitors, buzzer, potentiometer,
  push button, slide switch, HDC1080, antenna, the four ESP32 boards) stood with their legs 3.5 to 7 mm under the table when not
  in a board. They now stand on their legs (`standLift`), as the model stand always showed them; in a board's holes nothing changed.
- Invariant test (`workbench/rest.test.ts`, 53 tests): every library part alone (39, all with models), and the Dot with each of
  the five modules in each allowed orientation (8 poses), placed by the same functions the scene uses: no vertex of the model
  below the table (0.1 mm), something on the table (nothing hovers), and for a propped stack both the Dot and the module touching.
- Pictures: `module-{maker,robotics,camera,mesh,hacking}-side.png` (the eye at table level), `-above.png`, `-angle.png`,
  `module-{maker,robotics,camera}-turned-side.png`, `legged-parts-stand.png`.

### Data for the parts engineer (nothing outside the three `mount` blocks was changed under parts/)
- `parts/gen/modules.mjs` line 36 (`flatMount`) still writes the old tables; the next `gen-parts` run would undo the fix. It must
  read `upright: { x: "+X", y: "-Y", z: "+Z" }, turned: { x: "-X", y: "-Y", z: "-Z" }, source: "documented"`. `docs/STATUS-parts.md`
  ("component side facing the back for upright") says the old thing too.
- The 20 pins of the flat modules' connector have their `mm` laid out for the old pose (and `connector.odd_row: "low_z"`): with the
  board the right way up, pin J401.17 (GPIO8) is drawn where the Dot's pin 18 (IO16) is, and so on: each connector terminal is on
  the hole a half turn away from the one it is joined to. To agree with the header's print the pins must be mirrored about the
  board's centre line and the two rows exchanged (odd row high). Rails are unaffected (the header is symmetric). On a mounted module
  these pins are hidden now; on a loose module the names are right and the places are mirrored.
- `anchor_dot_mm` (header centred in the wall's thickness and across the Dot) is read off a render, not a drawing.

### What was run to the end, and what was not
- `npm test`: 363 passed (30 files) on the code before the last small change (a wire holds a bare leg half way down:
  `wires.ts` refresh, `World.tsx` adapter); after it `npx vitest run src/workbench` (the four workbench files) passed and
  `npm run build` (with `tsc --noEmit`) passed. The whole `npm test` was not repeated after it.
- `wires-mount-shots.mjs`: all 26 pictures taken and looked at; `legged-parts-stand.png` retaken after the last change, the
  others are from the build just before it (it only moves wires on pins under a body).
- `workbench-proof.mjs`, one full run on the final build with the machine's load above 40: 36 passed, 1 failed. The failure is
  (g) "the AI prompt is there with a copy button, and the manual opens": the button still read "Copy the prompt" 300 ms after the
  click (the manual opened, 6311 characters). That is the Make tab, which this branch does not touch; not repeated. Sections that
  bear on this work passed: (a) wires drawn by mouse from the header and the LED lit, (c) the servo wired, (d) a wire clicked and
  deleted, (e) the Robotics module mounted both ways and driving a motor, (f) save, reload and open. Its frame time (746 ms) was
  taken at that load and says nothing; the before and after above were measured back to back on a quieter machine.
- To confirm alone on a quiet machine: `cd web && npm test`; `npm run build && UX_PORT=4398 node scripts/workbench-proof.mjs --only g`;
  `UX_PORT=4398 node scripts/wires-mount-shots.mjs --only none --cost` for the frame cost.

### Weak or not done
- Bodies are bounding boxes: a wire to a socket that is lower than its board's tallest part first rises to clear that height,
  and the radio modules' box includes the whips, so a wire climbs over empty air beside an antenna.
- Wires do not see each other: two that cross lie through each other at the crossing; bundles are only kept apart sideways.
- A wire on the table still comes down to the table between two raised places close together (a dip) where a real jumper would
  hang in the air; a terminal that faces down (a socket of a module mounted turned) gets a wire that starts into the table's side.
- The Dot's shell is rested as its box: its real bottom-back edge is chamfered, so a propped Dot hovers about a millimetre there.
- A module mounted while the Dot's header already carries wires: those wires still end in the header, inside the module's connector.
- `tests/node/parts`, run for the manifest change: schema copies current, `geometry.test.mjs` 257 checks passed, the library built
  (39 parts), `modules.test.mjs` 65 of 66 (the one left needs `build/apps/parts_robotics`, a firmware package this worktree has
  no SDK build for). The rest of `run.sh` (boards, circuits, the firmware end to end) was not run: nothing they read changed.
- Not tried: touch, a real GPU, a phone.

