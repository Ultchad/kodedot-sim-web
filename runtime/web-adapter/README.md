# web-adapter: run a .dotbench in a page

`dotbench-device.js` + `zip.js`: framework-free ES modules, no bundler, no server files besides the two scripts.
A `.dotbench` is a zip (Emscripten module, wasm, `appdata/app.json`, `manifest.json`, optional `glue/<area>/*.js`).
The adapter unzips it from an `ArrayBuffer` (for example read from IndexedDB), makes blob URLs for the module, the
worker and any glue, compiles the wasm once, and boots the firmware in WebAssembly threads. Tested in headless
Chrome (`tests/browser/run.sh`).

## Usage

```js
import { DotbenchDevice, SCREEN_WIDTH as W, SCREEN_HEIGHT as H } from "./dotbench-device.js";

const dev = new DotbenchDevice();                       // { autoRestart: true, resolveTarget?: name => ArrayBuffer }
dev.on("status", (s) => console.log(s.status, s.reason ?? ""));   // idle|booting|running|crashed|restart-requested
dev.on("log", (line) => console.log(line.level, line.text));      // {id, ts, level, text, channel}

await dev.load(await (await fetch("app.dotbench")).arrayBuffer());   // or bytes from IndexedDB
await dev.start();                                       // power-on: clears the keep store, keeps NVS

const image = new ImageData(W, H), ctx = canvas.getContext("2d");
let seq = -1;
(function paint() {
  const s = dev.copyFrame(image.data, seq);              // copies 820 KB only when the picture changed
  if (s !== seq) { seq = s; ctx.putImageData(image, 0, 0); }
  requestAnimationFrame(paint);
})();

button.onpointerdown = () => dev.button("top", true);    // or 0..5; releaseAll() on window blur
button.onpointerup   = () => dev.button("top", false);
canvas.onpointerdown = (e) => dev.touch(e.offsetX, e.offsetY, true);
dev.sendConsole("help");                                 // echoed into the log with level "input"
dev.stop(); await dev.restart();                         // stop = terminate all workers; restart = reset, keeps NVS + keep
```

## API

| member | meaning |
|---|---|
| `load(bytes)` / `start()` / `stop()` / `restart()` / `dispose()` | lifecycle; `load` replaces and stops the current program, `start` = power-on, `restart` = reset (RAM lost, keep + NVS survive) |
| `on(type, cb)` returns unsubscribe | `"status"` ({status, reason?, target?}), `"log"` (LogLine), `"outputs"` ({led, haptic, backlight, panelOn}), `"area:<name>:<type>"` (emitted by area glue) |
| `status`, `statusDetail`, `appName`, `appInfo` | `idle`, `booting`, `running`, `crashed` (reason: `panic`, `abort: ...`, load failure), `restart-requested` (reason `software`, `panic`, ...; target = other program or `""`) |
| `copyFrame(out, lastSeq)` | copies RGBA 410x502 into a caller-provided `Uint8ClampedArray` (plain ArrayBuffer), returns the frame seq; equal to `lastSeq` = nothing copied |
| `frame()` | `{seq,width,height,data}`; same object and same `data` while unchanged |
| `frameSeq`, `backlight` (0..100), `panelOn` | cheap reads of shared memory |
| `button(id, pressed)`, `touch(x, y, down)`, `releaseAll()` | `id` 0..5 or `top bottom up down left right`; lock-free hand-over to the firmware |
| `led` {r,g,b}, `haptic` (0..1) | |
| `lines`, `clearLog()`, `sendConsole(line)` | bounded line buffer (2000), ANSI and `!I ` prefixes stripped; the firmware's own echo of the typed line is dropped |
| `time()` | device clock in epoch ms (host clock + the offset the firmware set; survives restarts) |
| `area(name)` | the JS object the area's glue returned (`null` if none/not running), recreated at every boot |
| `exportPersist()` / `importPersist(map)` / `factoryReset()` | persistent regions as `Map<name, Uint8Array>`, for the page to mirror to IndexedDB (not done by the adapter) |
| `workerCount`, `wasmMemoryBytes` | diagnostics |

Main-thread reads never block: they are plain loads from shared memory (`copyFrame`, `led`, ...), a non-blocking SPSC
ring push (`button`, `touch`) and a bounded drain of the log ring (a spin lock held for microseconds by the firmware).
`sendConsole` takes the console queue mutex for a few bytes.

Hidden tabs: the 20 ms poll timer is throttled to 1 Hz by Chrome; restart requests are also awaited with
`Atomics.waitAsync`, which is not throttled. The firmware itself keeps running (pthreads are not throttled).

## Hosting page requirements

* Cross-origin isolation (SharedArrayBuffer): `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`) on the page; every subresource served same-origin
  or with `Cross-Origin-Resource-Policy: cross-origin`. Blob URLs need nothing extra.
* CSP (if you set one): `script-src 'self' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src 'self' blob:`.
  `tests/browser/server.mjs` serves exactly this and the test passes under it.
* Browser: `Atomics.waitAsync` (Chrome/Edge 87+, Safari 16.4+, Firefox does not ship it: the 20 ms poll is used),
  `DecompressionStream("deflate-raw")`.
* About 100 MB of shared wasm memory and 32 pooled workers per running program. Only one program runs at a time.

## Wrapping it as `KodeDevice` (web/src/device/types.ts)

`status`/`appName`/`backlight`/`panelOn`/`led`/`haptic` become Observables over `dev.on(...)`; `getFrame()` is
`dev.frame()`; `setButton` = `button`; `setTouch` = `touch`; `log` = `lines` + `on("log")`; `sendConsole`, `time`, `stop`,
`restart`, `dispose` are 1:1. `load(bundle)` = `dev.load(bundle)`. `areas` = `dev.area(name)`.
Differences: the adapter status has the extra `restart-requested` (map it to `booting` or ignore); `haptic` is already
0..1; `restart-requested` with `autoRestart` reboots by itself.
