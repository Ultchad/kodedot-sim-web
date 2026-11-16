// Directory backend for persist.js, for Node tests and tools: persistence without a browser.
//   <dir>/meta.json         {format, savedAt, regions:{name:{size,chunk,flags}}}   (written last, atomically via rename)
//   <dir>/<region>.img      the region's bytes, sparse (chunks never written read as zero)
import fs from "node:fs";
import path from "node:path";
import { CHUNK } from "./persist.js";

const safe = (n) => n.replace(/[^A-Za-z0-9_.-]/g, "_");

export class NodeDirBackend {
  /** @param {string} dir */
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); this.commits = 0; }
  _meta() { return path.join(this.dir, "meta.json"); }
  _img(name) { return path.join(this.dir, safe(name) + ".img"); }

  async load() {
    if (!fs.existsSync(this._meta())) return null;
    const meta = JSON.parse(fs.readFileSync(this._meta(), "utf8"));
    const regions = {};
    for (const [name, m] of Object.entries(meta.regions ?? {})) {
      const chunks = new Map();
      const f = this._img(name);
      if (fs.existsSync(f)) {
        const fd = fs.openSync(f, "r");
        const st = fs.fstatSync(fd);
        const buf = Buffer.alloc(CHUNK);
        for (let i = 0; i * CHUNK < Math.min(st.size, m.size); i++) {
          const n = fs.readSync(fd, buf, 0, CHUNK, i * CHUNK);
          let nz = false; for (let k = 0; k < n; k++) if (buf[k]) { nz = true; break; }
          if (nz) chunks.set(i, new Uint8Array(buf.subarray(0, Math.min(n, m.size - i * CHUNK))));
        }
        fs.closeSync(fd);
      }
      regions[name] = { ...m, chunks };
    }
    return { format: meta.format, regions };
  }

  async commit({ meta, puts }) {
    const fds = new Map();
    const fd = (name) => {
      if (!fds.has(name)) { const f = this._img(name); fds.set(name, fs.openSync(f, fs.existsSync(f) ? "r+" : "w+")); }
      return fds.get(name);
    };
    for (const [name, idx, bytes] of puts) {
      if (!meta.regions[name]) continue;
      const data = bytes ?? Buffer.alloc(CHUNK);
      fs.writeSync(fd(name), data, 0, data.length, idx * CHUNK);
    }
    for (const [name, m] of Object.entries(meta.regions)) { const d = fd(name); if (fs.fstatSync(d).size !== m.size) fs.ftruncateSync(d, m.size); }
    for (const d of fds.values()) { fs.fsyncSync(d); fs.closeSync(d); }
    for (const f of fs.readdirSync(this.dir)) {            // prune regions that are gone
      if (f.endsWith(".img") && !Object.keys(meta.regions).some((n) => safe(n) + ".img" === f)) fs.rmSync(path.join(this.dir, f));
    }
    const tmp = this._meta() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(meta));
    fs.renameSync(tmp, this._meta());
    this.commits++;
  }

  async erase() { fs.rmSync(this.dir, { recursive: true, force: true }); fs.mkdirSync(this.dir, { recursive: true }); }
}
