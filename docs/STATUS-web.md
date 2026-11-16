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
- GLB override: `components/glbModel.ts` (`loadGlbModel`, nodes screen, btn_top, btn_bottom, dpad_*, led) is wired into Device3D; loading and rendering were checked with a synthetic GLB, the press path was not.
- Half-done in the model files: see the coordinator report (lib/bodyModel.ts SDF body, Device3D.tsx; bezel 1.9 mm and body colour tweaks applied but not reviewed visually).

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
