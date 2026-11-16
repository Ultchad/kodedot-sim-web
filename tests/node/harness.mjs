// Test harness: unpack a .dotbench, boot it under Node, and give tests the bridge.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// kweb_state_t byte offsets (runtime/bridge/README.md)
export const OFF = {
  magic: 0x00, abi: 0x04, events: 0x0c,
  fbW: 0x10, fbH: 0x14, fbStride: 0x1c, fbOffset: 0x20, frameSeq: 0x24, panelOn: 0x30, backlight: 0x34, flushes: 0x38,
  ledRgb: 0x50, ledSeq: 0x54,
  buttons: 0x70, touchX: 0x74, touchY: 0x78, touchDown: 0x7c, touchSeq: 0x80,
};
export const BTN = { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3, TOP: 4, BOT: 5 };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function boot(pkgPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotbench-"));
  execFileSync("python3", ["-I", "-c",
    "import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", pkgPath, dir]);
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const mod = await import(pathToFileURL(path.join(dir, manifest.js)).href);
  const logs = [];
  const M = await mod.default({
    print: (s) => logs.push("[stdout] " + s),
    printErr: (s) => logs.push("[stderr] " + s),
  });
  const statePtr = M._kweb_state();
  const dv = () => new DataView(M.HEAPU8.buffer, 0, M.HEAPU8.buffer.byteLength);
  const u32 = (off) => dv().getUint32(statePtr + off, true);
  const i32 = (off) => dv().getInt32(statePtr + off, true);
  const text = [];
  const drain = () => {
    const cap = 8192, buf = M._malloc(cap);
    for (;;) {
      const n = M._kweb_text_drain(buf, cap);
      if (!n) break;
      const bytes = M.HEAPU8.slice(buf, buf + n);
      for (let i = 0; i + 3 <= bytes.length;) {
        const ch = bytes[i], len = bytes[i + 1] | (bytes[i + 2] << 8);
        text.push({ ch, s: Buffer.from(bytes.slice(i + 3, i + 3 + len)).toString("utf8") });
        i += 3 + len;
      }
    }
    M._free(buf);
  };
  const api = {
    M, dir, manifest, logs, text, drain,
    u32, i32,
    led: () => { const v = u32(OFF.ledRgb); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; },
    ledSeq: () => u32(OFF.ledSeq),
    frameSeq: () => u32(OFF.frameSeq),
    button: (id, down) => M._kweb_button(id, down ? 1 : 0),
    touch: (x, y, down) => M._kweb_touch(x, y, down ? 1 : 0),
    framebuffer: () => {
      const off = statePtr + u32(OFF.fbOffset);
      return M.HEAPU8.slice(off, off + u32(OFF.fbStride) * u32(OFF.fbH));
    },
    logText: () => { drain(); return text.map((t) => t.s).join(""); },
    async waitFor(pred, ms, what) {
      const t0 = Date.now();
      for (;;) {
        drain();
        if (pred()) return true;
        if (Date.now() - t0 > ms) throw new Error("timeout waiting for " + what + "\n--- log ---\n" + api.logText() + "\n--- stdio ---\n" + logs.join("\n"));
        await sleep(25);
      }
    },
  };
  return api;
}
