import { DotbenchDevice } from "/adapter/dotbench-device.js";
import { IdbBackend } from "/adapter/persist-idb.js";

const DB = "dotbench-persist-test";
const dev = new DotbenchDevice({ persist: new IdbBackend({ name: DB }) });
const idbCounts = () => new Promise((ok, err) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => { r.result.createObjectStore("meta"); r.result.createObjectStore("chunks"); };
  r.onerror = () => err(r.error);
  r.onsuccess = () => {
    const db = r.result, tx = db.transaction(["meta", "chunks"], "readonly");
    const c = tx.objectStore("chunks").count(), m = tx.objectStore("meta").count();
    tx.oncomplete = () => { db.close(); ok({ chunks: c.result, meta: m.result }); };
  };
});
window.P = {
  dev, idbCounts,
  async boot(name) { const buf = await (await fetch("/pkg/" + name + ".dotbench")).arrayBuffer(); await dev.load(buf); await dev.start(); },
  text: () => dev.lines.map((l) => l.text).join("\n"),
};
window.PREADY = true;
