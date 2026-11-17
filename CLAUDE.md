# dotbench

A personal web test bench for writing apps for the Kode Dot handheld before the hardware arrives. It runs the **unmodified C source** of kode-sdk apps (and, in progress, kodeOS itself) in the browser by compiling the SDK's hardware-independent upper layers to WebAssembly and replacing only the hardware drivers with web fakes that bench objects in the page control (NFC tag, RFID card, router, ...). Static site, no backend, deployable on Vercel.

Owner: Murilo. Talk to him in Brazilian Portuguese, plainly, without em dashes. The site's UI is English by default, with pt-BR and es. Code, comments and commit messages are in English.

## Read these first

| File | What it holds |
|---|---|
| `docs/superpowers/specs/2026-11-16-dotbench-design.md` | The design (Portuguese): intent, goals, architecture, the bench, the stages, the visual language, later additions |
| `docs/STATUS-*.md` | What each part really does today, with the commands that prove it |
| `docs/DRIVER-AREA-GUIDE.md` | How to add or change one hardware area. Follow it exactly |
| `docs/bench-spec.md` | Public API behaviour per area and the bench object model (not fully reviewed: the SDK headers win) |
| `docs/driver-surface.md` / `.json` | Every `khal_*`/`kdrv_*` function the upper layers call, and where to fake each |
| `docs/kodeos-plan.md` | How kodeOS boots and how the page plays the bootloader |
| `docs/component-api.md` | Custom components ("Tinkercad for the Dot"): package format, wiring/net model, Arduino code as WebAssembly |

## Layout

- `runtime/` C side: `rtos/` (FreeRTOS API on Emscripten pthreads), `idf/` (minimal ESP-IDF surface), `bridge/` (shared state between firmware and page), `persist/` (the persistent-region service: `dbp_register`, dirty bits, power-cut injection; the host side is `web-adapter/persist*.js`), `drivers/<area>/` (one folder per hardware area with an `area.json` manifest), `web-adapter/` (framework-free JS that loads and runs a `.dotbench` package in a page; `persist*.js` mirrors regions to IndexedDB, `factory.js` hands a package's first-boot files to the storage driver). Two build roles: `app` (default) and `kodeos` (`tools/dotbench build <KodeOS dir> --role kodeos`; test: `tests/node/kodeos/run.sh`); an area's `roles` key says which firmware it belongs to.
- `tools/dotbench` build tool: `sdk` (precompile), `build <app-dir>` (produces `<name>.dotbench`), `seed` (copy a build dir).
- `tests/node/` and `tests/browser/` automated tests (Node workers; headless Chrome).
- `web/` the page: Vite + React + TypeScript + Tailwind. 3D device view (three.js), 2D view, bench, console, i18n.
- `templates/component-starter/` starter folder and AI prompt for user-made components.
- `spikes/` throwaway proofs (Arduino sketches as WebAssembly).

## Set-up on a fresh machine

`tools/setup.sh` clones the pinned dependencies and installs Emscripten, then prints the environment variables to export. Pinned: kode-sdk `c9568a3`, KodeOS `7612a16`, LVGL `v9.6.0`, Emscripten `7.0.0`. The SDK and KodeOS trees are read-only inputs: never modify them.

```
tools/setup.sh                 # once
source .dotbench-env           # each shell
tools/dotbench sdk             # precompile (minutes the first time)
tests/node/run.sh              # all Node suites; `tests/node/run.sh <area>` for one area
tests/browser/run.sh           # real-browser suite (needs Chrome)
cd web && npm install && npm run dev
```

## Rules

- Keep real SDK code running above the seam; never re-implement in a fake what the SDK already does.
- One hardware area = one folder under `runtime/drivers/` plus its tests. Areas do not edit each other or shared files.
- Verify by running before claiming anything works; paste the passing output into the area's status file.
- Licence is GPL-3.0-or-later (inherited from kode-sdk and QP/C). The Kode and Kode Dot names, logo and mascot are the maker's trademarks. The owner reports that Kode said on its Discord that community projects may use material from its sites, so the 3D device model (`web/public/device/model.glb`, optimised from the model on kode.diy; credit in `NOTICE-model.md`) is bundled on that basis; kodeOS and Kode's open-source apps are built from their public repositories (`web/public/apps/SOURCES.md`). The front render and geometry under `web/public/device/` come from kode-sdk under GPL. The owner wants no notices or disclaimers in the site's UI.
- The approved look is in the design doc under "Linguagem visual": warm, light, cream cards, amber/blue/red accents, Outfit + DM Sans, pills. Do not drift back to a dark dense panel.

## State of the work

See the stage list in the design doc. Each `docs/STATUS-*.md` says what is done for its part; branches named `area/<name>` hold areas still in progress.
