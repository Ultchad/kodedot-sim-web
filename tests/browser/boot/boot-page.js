import { DotbenchSystem } from "/adapter/dotbench-system.js";
import { IdbBackend } from "/adapter/persist-idb.js";

const DB = "dotbench-boot-test";
const get = async (n) => new Uint8Array(await (await fetch("/pkg/" + n.replace(/\.dotbench$/, "") + ".dotbench")).arrayBuffer());
const events = [];
let sys;
window.B = {
  events,
  async open() {
    sys = new DotbenchSystem({ os: await get("kodeos"), persist: new IdbBackend({ name: DB }),
      factory: { apps: ["kody_kart.dotbench", "display_lvgl.dotbench", "buttons_led.dotbench"], fetch: get } });
    sys.on("program", (p) => events.push(p));
    window.S = sys;
    await sys.start();
  },
  install: async (n) => sys.install(await get(n)),
  text: () => sys.lines.map((l) => l.text).join("\n"),
  eraseDb: () => new Promise((ok) => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => ok(); }),
};
window.PREADY = true;
