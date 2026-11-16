import { DotbenchDevice, SCREEN_WIDTH as W, SCREEN_HEIGHT as H } from "/adapter/dotbench-device.js";

// The package lives in IndexedDB, like the real page: nothing but this page and the adapter come from the server.
const idb = () => new Promise((ok, err) => { const r = indexedDB.open("dotbench-test", 1); r.onupgradeneeded = () => r.result.createObjectStore("pkg"); r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });
const idbPut = async (k, v) => { const db = await idb(); await new Promise((ok, err) => { const t = db.transaction("pkg", "readwrite"); t.objectStore("pkg").put(v, k); t.oncomplete = ok; t.onerror = () => err(t.error); }); };
const idbGet = async (k) => { const db = await idb(); return new Promise((ok, err) => { const r = db.transaction("pkg").objectStore("pkg").get(k); r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); }); };

const ctx = document.getElementById("c").getContext("2d");
const image = new ImageData(W, H);          // ImageData.data is plain-ArrayBuffer backed
const dev = new DotbenchDevice();
const t = { paints: 0, seq: -1 };
const statuses = [];
dev.on("status", (s) => statuses.push({ ...s, at: performance.now() }));

function paint() {
  const seq = dev.copyFrame(image.data, t.seq);
  if (seq !== t.seq) { t.seq = seq; ctx.putImageData(image, 0, 0); t.paints++; }
  requestAnimationFrame(paint);
}
requestAnimationFrame(paint);

window.T = {
  dev, t, statuses,
  async store(name) { const r = await fetch("/pkg/" + name + ".dotbench"); await idbPut(name, await r.arrayBuffer()); },
  async open(name) { const buf = await idbGet(name); await dev.load(buf); },
  canvasPixels() { return Array.from(ctx.getImageData(0, 0, W, H).data); },
  // canvas vs wasm framebuffer, compared inside the page (no 800 KB array over the wire); null if the picture moved meanwhile
  compare() {
    const inst = dev._inst, s0 = dev.frameSeq;
    const fb = new Uint8Array(inst.M.HEAPU8.buffer, inst.statePtr + 0x3a0, W * H * 4).slice();
    const px = ctx.getImageData(0, 0, W, H).data;
    if (dev.frameSeq !== s0 || t.seq !== s0) return null;
    let diff = 0; for (let i = 0; i < fb.length; i++) if (fb[i] !== px[i]) diff++;
    let colours = new Set(); for (let i = 0; i < fb.length; i += 4) colours.add(fb[i] | (fb[i + 1] << 8) | (fb[i + 2] << 16));
    return { diff, colours: colours.size, seq: s0 };
  },
  mem() { return { jsHeap: performance.memory?.usedJSHeapSize ?? 0, wasm: dev.wasmMemoryBytes, workers: dev.workerCount }; },
};
window.TREADY = true;
window.errs = [];
window.addEventListener("error", (e) => window.errs.push({ msg: e.message, file: e.filename, line: e.lineno, type: e.type }));
window.addEventListener("unhandledrejection", (e) => window.errs.push({ rej: String(e.reason?.message ?? e.reason), type: e.reason?.type }));
