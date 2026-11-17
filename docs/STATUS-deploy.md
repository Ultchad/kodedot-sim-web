# STATUS: clean build and deploy (Vercel)

Branch `fix/clean-build`. Goal: `git clone` + `npm ci` + `npm run build` in `web/` works on a machine that has only Node, npm and network access to the npm registry (Vercel Hobby), with no emsdk, no `/home/claude/src`, no `build/` folder.

## What a clean build needs

Node 22, npm, the npm registry (web dependencies, and `@yowasp/clang` fetched with `npm pack`, integrity-checked against `runtime/cc/toolchain.json`). Nothing else: the third piece that used to come from the maker's machine, ArduinoCore-API, is vendored.

| Piece | Before | Now |
|---|---|---|
| Parts library (39 parts, 332 KB) | compiled with Emscripten at `/home/claude/tools/emsdk` | committed prebuilt in `parts/prebuilt/` (the `.dotpart` files, `library.json`, `SOURCES.json`); `prepare-parts` copies it |
| ArduinoCore-API | `/home/claude/src/third/ArduinoCore-API` | vendored in `third_party/ArduinoCore-API/` (`api/` + `LICENSE` + `VERSION`, commit 0f4e57e, unmodified, 308 KB). LGPL-2.1-or-later; `Udp.h` and `avr/pgmspace.h` are MIT; compatible with the repo's GPL-3.0-or-later (like `third_party/cJSON`). `DOTBENCH_ARDUINO_API` still overrides it when it names a checkout that exists (otherwise a warning and the vendored copy) |
| Compiler assets (124.7 MB, 34 files) | built by `prepare-cc` when `build/cc-assets` is missing, failure silent | still built by `prepare-cc` at every deploy (decision B), now self-sufficient, and a failure FAILS the build when `VERCEL` or `CI` is set |
| Apps (`web/public/apps`) | committed | unchanged |

## Commands

```
# on the maker's machine, after changing a part, dotcore (runtime/parts/core), the part build code, or the vendored API:
npm run parts:regen        # (in web/)  = node tools/parts-prebuilt.mjs regen   rebuilds with Emscripten, writes parts/prebuilt, checks itself
git add parts/prebuilt && git commit
# anywhere (no toolchain needed), also what the coordinator runs before pushing:
npm run parts:check        # = node tools/parts-prebuilt.mjs check [--rebuild]   exit 1 if stale; --rebuild also recompiles and demands byte-identical files
# the page build (Vercel runs exactly this):
cd web && npm ci && npm run build
```

### Parts: how staleness is detected
`SOURCES.json` records, per part folder, a sha-256 over the folder's files (not `build/` or `*.dotpart`) plus the shared build inputs (`tools/dblib/part/*`, `runtime/web-adapter/dotpart*.js`, `zip.js`, `parts/build-library.mjs`) and, for the 7 code parts (`behaviour.type` wasm; `kind` in `SOURCES.json`), `runtime/parts/core/**` and `third_party/ArduinoCore-API/**`. `check` recomputes and compares; it also checks every committed `.dotpart` against its recorded sha-256 and `library.json`. It is deliberately conservative: touching the shared packaging code marks every part stale (this happened during this work: editing `build.mjs` after a regen made the check fail until the regen was redone; the regen output was byte-identical).
The build IS deterministic: two clean builds with separate caches (`DOTBENCH_CACHE`) gave byte-identical `.dotpart` and `library.json` (23 s and 27 s), and `check --rebuild` passes against the committed folder. So the check compares source hashes (works with no toolchain) and the rebuild comparison is available when there is one.
`prepare-parts`: prebuilt up to date -> use it (a fresh build would be identical, so it is skipped; `DOTBENCH_PARTS=build` forces one into `parts/dist`). Stale + Emscripten present -> warns and builds fresh into `parts/dist`. Stale + no Emscripten -> exit 1 when `VERCEL`/`CI` is set, warning elsewhere.
Why not build in the page build instead: Emscripten (about 1 GB, pinned 7.0.0) would have to be installed on Vercel at every deploy for 332 KB of output that is deterministic; committing it costs almost nothing in history.

## Decision B: compiler assets are built on Vercel at each deploy, not committed

Numbers (this machine, 2 cores, load average 5 to 6 from other engineers):
- clean build of the assets inside `npm run build`: **141.7 s for the whole `npm run build`** (assets about 128 s of it, `npm ci` 7.4 s before), peak resident memory of the largest process **756 MB** (`npm ci`: 434 MB). Standalone builder run: 88.5 s.
- output: `dist` 135 MB, 34 files in `dist/cc` (124.7 MB), largest file 20,000,000 B (the LLVM wasm is chunked at 20 MB), ten largest: four `llvm.core.*.wasm` (20, 20, 20, 15.5 MB), five `pch-stl-*.pack.bin` (8.4 MB each), `apps/kodeos.dotbench` (1.5 MB).
Vercel documentation read (pages dated 2026-09 by their own `last_updated`):
- https://vercel.com/docs/limits : build time per deployment 45 minutes; "Static File uploads" 100 MB on Hobby is for source files uploaded by the CLI, not for Git-integration builds or build output; "there is no upper limit for output files created during a build" (a per-file output cap is not stated); disk 64 GB; build cache maximum 5 GB, retained one month.
- https://vercel.com/docs/builds/managing-builds : Hobby always uses the Basic build machine: 2 vCPU, 8 GB memory, 64 GB disk; Hobby 1 concurrent build.
- https://vercel.com/docs/deployments/troubleshoot-a-build : builds over the memory or disk limit are cancelled; what is cached is node_modules, `.vercel/builders`, framework files and `.vercel/cache`, "It is not possible to manually configure which files are cached", so our `build/cc-work` is not cached and the asset build runs in full every deploy.
- https://vercel.com/docs/how-vercel-cdn-works/compression : with `Accept-Encoding` Vercel compresses compressible MIME types, `wasm` and `javascript` among them; `octet-stream` is not on the list (why the packs are gzipped by us).
Margins: 142 s against 45 min, 0.76 GB against 8 GB, 135 MB output against a documented no-limit. Why not commit: 125 MB of binaries in a public repo, rewritten whenever the toolchain, a part manifest or dotcore changes (every board pack and PCH carries those; 12 of 40 files changed between two builds of this same branch point); the single 20 MB chunks times many revisions bloats history for good, the CLI source limit (100 MB) would be exceeded by a CLI deploy, and clones get slow. Building is reproducible: the manifest `version` of the clean-clone build (`7a3ecafb4276`) is identical to a build on the maker's machine from the same commit (all 34 file hashes equal), so what Vercel serves is what is tested here. Cost: every deploy builds for about 2 minutes (Hobby has no build-minute charge).
If it ever must change: commit only the board packs (0.9 MB each) and build the toolchain part, as noted in STATUS-cc.md.

Equivalence with the assets in `/home/claude/dotbench/build/cc-assets` (made earlier, 10:20): same 5 boards, same 34 file roles; 28 files are byte-identical by sha-256 (all LLVM chunks and small modules, the three sysroot packs, the Worker, four of the five STL PCH packs, licences), and 12 differ only in the 6 board packs and `pch-stl-esp32-s3` (6 pairs). Unpacked, the differences are exactly: `meta/manifest.json` and `meta/picture.svg` of the board parts, and for esp32-s3 `variant/pins_arduino.h` and its PCHs; those inputs were changed by later commits. A build of this branch on the maker's machine equals the clean-clone one byte for byte.

## Proof (clean clone)

`git clone --branch fix/clean-build` into `/tmp/proof/repo`, `env -i` with `HOME=/tmp/proof/home`, `VERCEL=1`, `DOTBENCH_EMSDK=/nonexistent/emsdk`, `DOTBENCH_ARDUINO_API=/nonexistent/ArduinoCore-API`, PATH without emsdk (no `emcc`), only the registry proxy variables kept, `npm ci` then `npm run build` in `web/`: **exit 0**, `prepare-parts: 39 parts (committed prebuilt)`, `prepare-cc` built the assets from the pinned npm package and the vendored API, `dist/parts` 41 files (39 packages, `library.json`, `part-worker.js`), `dist/cc` 25 entries (34 files in the manifest plus `licenses/`), `dist` 135 MB, `tsc --noEmit` clean, `csp.test.ts` passes. `git status` of the clone stays clean after the build.
Then `npx vite preview` served that `dist` and `node scripts/workbench-proof.mjs --only b --no-shots` (headless Chrome, `UX_PORT=4173`) passed all six checks: the Uno's editor opens, the sketch compiled in the browser from those assets (first compile 15.5 s including the download on this loaded machine, second 6.8 s), uploaded, the LED blinks, a syntax error is reported on its line. The explicit nonexistent `DOTBENCH_ARDUINO_API` produced a warning and used the vendored copy.

## What only a real Vercel preview can verify

1. The build itself on Vercel: it runs `npm install` (not `npm ci`; the lockfile is committed so versions should match), then `npm run build`; the log must show `prepare-parts: 39 parts (committed prebuilt)` and `prepare-cc: compiler assets -> public/cc`, and the build must take about 2 to 5 minutes. Unverified: `npm pack` and `tar` on the Vercel image, Node version (set Node 22 in the project settings; `engines` is not declared in `web/package.json`).
2. Content-Encoding. Locally verified: `vite preview` (sirv) serves `.pack.bin` as `application/octet-stream` with NO `Content-Encoding` (so the browser does not inflate the gzip packs before the compiler does), `.wasm` as `application/wasm` uncompressed. Not verifiable locally: what Vercel's CDN does. On the preview deployment `https://<preview>/cc/`, run (with the real file names from `/cc/manifest.json`):
   - `curl -sI -H 'Accept-Encoding: gzip, br' https://<preview>/cc/board-uno-r3.<hash>.pack.bin` expect `content-type: application/octet-stream` and NO `content-encoding` (and a `content-length` near 0.9 MB). If a `content-encoding: gzip` appears, the page would break (the compiler would get an inflated body): rename the packs to an extension Vercel does not treat as gzip or add a `Content-Encoding`-neutral header rule.
   - `curl -sI -H 'Accept-Encoding: br' https://<preview>/cc/llvm.core.<hash>.0.wasm` expect `content-type: application/wasm` and `content-encoding: br` or `gzip` (the CDN compression; without it the first visit downloads 75 MB instead of about 17 MB). Whether a 20 MB file is compressed by the CDN is not stated in the docs.
   - `curl -sI https://<preview>/cc/manifest.json` expect `cache-control: public, max-age=0, must-revalidate`, and for a hashed file `cache-control: public, max-age=31536000, immutable`. The `/cc/:file(.+\.[0-9a-f]{10}\..+)` header rule in `vercel.json` is untested on Vercel (path-to-regexp custom pattern); also check `cross-origin-opener-policy: same-origin`, `cross-origin-embedder-policy: require-corp` and the CSP are still present on those responses (header rules are merged).
   - Open the preview, a board's Code editor, Compile: no console errors, `crossOriginIsolated` true.
3. A per-file size cap on build output is not documented; 20 MB files are the largest we ship.

## At merge time

- Merge only with `node tools/parts-prebuilt.mjs check` passing on the merged tree (any other branch that touches a part, `runtime/parts/core` or `tools/dblib/part` makes `parts/prebuilt` stale: re-run `npm run parts:regen` in `web/` and commit; a stale prebuilt FAILS the Vercel build on purpose).
- Merge conflicts in `parts/prebuilt/` are resolved by regenerating, never by hand.
- Set Node 22 on the Vercel project; leave the build command as `npm run build` (root directory `web`).
- `parts/.gitignore` now un-ignores `prebuilt/*.dotpart`.

## Unchanged and untouched

`web/src`, drivers and part manifests. Tests that still mention `/home/claude/...` paths (`tests/node/parts/run.sh` emsdk default, `tests/browser/cc.test.mjs` node_modules fallbacks) are local-machine tools and were not changed.
