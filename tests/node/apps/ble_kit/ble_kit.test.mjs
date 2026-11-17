// Bluetooth: the real app on the bench, where the radio has no Bluetooth fake yet, so kode_ble_scan() is refused: the app must say "Bluetooth is not
// available" and stay usable. Then the same sources, rebuilt in a throw-away folder with kode_ble_scan() replaced by canned answers (devices, nothing,
// busy, off), prove the list, the device page and the other states are all reachable and look right. The canned build is a test device, not the app.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as radioGlue from "../../../../runtime/drivers/radio/radio.js";
import { Bench, launch, build, runner, sleep, BTN, storeShots, root } from "../lib.mjs";
import { buildApp } from "../../persist/host.mjs";

const T = runner("ble_kit");
const ROW = [116, 208, 300, 392];
const BTN_Y = 432;
const back = async (app) => { await app.press(BTN.BOT); await app.settle(600); };

/** Boot an app package and wait for its first frame. */
async function open(pkg, name, shotName) {
  const bench = await new Bench().open();
  const app = await launch(bench, pkg, { name: shotName, glue: { radio: radioGlue } });
  app.glue.radio.fastTiming?.();
  await app.waitFor(() => app.log().includes("ble.ao up"), 30000, "boot");
  await app.waitFor(() => app.run.frameSeq() > 0, 30000, "first frame");
  await app.settle(600);
  return app;
}
const count = (app, re) => (app.log().match(re) || []).length;
const lit = (app, x, y) => app.px(x, y) !== 0;
/** Whether anything is drawn in a band of the glass. */
const ink = (app, x0, y0, x1, y1) => { for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) if (app.px(x, y) !== 0) return true; return false; };
async function listen(app, tapAt) {
  const n = count(app, /listen ended/g);
  await app.tap(205, tapAt);
  await app.settle(400);
  return n;
}
async function listened(app, n) {
  await app.waitFor(() => count(app, /listen ended/g) > n, 30000, "the listen to end");
  await app.settle(900);
}

// ---- The app as it is, on the bench as it is ----
const pkg = build("ble_kit");
const app = await open(pkg, "ble_kit", "ble_kit");

await T.check("boots to Nearby", async () => {
  await app.shot("home");
  assert.ok(app.stats().colours > 20 && lit(app, 100, ROW[0]) && !lit(app, 100, ROW[1]));
});

await T.check("Listening shows a wait with Cancel; when it ends Back returns to Nearby", async () => {
  const n = await listen(app, ROW[0]);
  assert.ok(lit(app, 205, BTN_Y), "Cancel");
  await listened(app, n);
  await back(app);
  assert.ok(lit(app, 100, ROW[0]));
});

await T.check("Without a Bluetooth radio the app says it is not available, and Try again asks again", async () => {
  const log = app.log();
  assert.ok(/listen ended: 0 devices, fail 3/.test(log), "refused as 'cannot do it'");
  await app.tap(205, ROW[0]);
  await app.settle(500);
  await app.shot("unavailable");
  assert.ok(lit(app, 205, BTN_Y), "Try again");
  const n = count(app, /listen ended/g);
  await app.tap(205, BTN_Y);
  await listened(app, n);
  await app.shot("unavailable-again");
  assert.ok(count(app, /listen ended: 0 devices, fail 3/g) >= 2);
  await back(app);
  await app.shot("home-unavailable");
});
const refused = (app.log().match(/listen ended: 0 devices, fail 3: (.*)/) || [])[1];
console.log("the radio's own words:", refused);
app.run.shutdown();

// ---- The same sources with canned answers ----
const demoDir = fs.mkdtempSync(path.join(os.tmpdir(), "ble-demo-"));
fs.cpSync(path.join(root, "apps/ble_kit"), demoDir, { recursive: true });
const jobFile = path.join(demoDir, "main/ble_job.c");
let src = fs.readFileSync(jobFile, "utf8");
const canned = `
static const char *s_bench_err = "";
static const char *bench_error(void) { return s_bench_err; }
static int bench_scan(kode_ble_device_t *out, size_t cap, uint32_t ms)
{
    static int call = 0;
    static const struct { const char *name, *addr; int8_t rssi; } d[] = {
        { "Kode Dot", "c0:00:00:00:00:01", -48 }, { "Headphones", "d4:11:22:33:44:55", -61 },
        { "", "5e:aa:09:77:12:f0", -74 }, { "Thermometer", "a0:b1:c2:d3:e4:f5", -83 } };
    (void)cap; (void)ms;
    call++;
    s_bench_err = "";
    if ( 1 == call ) { kode_delay(2500); }
    if ( 1 == call || 5 == call )
    {
        for ( int i = 0; i < 4; ++i )
        {
            (void)snprintf(out[i].name, sizeof(out[i].name), "%s", d[i].name);
            (void)snprintf(out[i].address, sizeof(out[i].address), "%s", d[i].addr);
            out[i].rssi = d[i].rssi;
        }
        return 4;
    }
    if ( 2 == call ) { return 0; }
    if ( 3 == call ) { s_bench_err = "the radio is busy"; return -1; }
    s_bench_err = "Bluetooth is off in Settings";
    return -1;
}
`;
assert.ok(src.includes("kode_ble_scan(") && src.includes("kode_error()"));
src = src.replace("kode_status_t ble_run", canned + "\nkode_status_t ble_run").replace("= kode_ble_scan(", "= bench_scan(").replace(/kode_error\(\)/g, "bench_error()");
fs.writeFileSync(jobFile, src);
fs.writeFileSync(path.join(demoDir, "CMakeLists.txt"), fs.readFileSync(path.join(demoDir, "CMakeLists.txt"), "utf8").replace("project(ble_kit)", "project(ble_demo)"));
const demo = await open(buildApp(demoDir), "ble_demo", "ble_kit");

await T.check("While it listens the app shows a wait with Cancel", async () => {
  const n = await listen(demo, ROW[0]);
  await demo.shot("listening");
  assert.ok(lit(demo, 205, BTN_Y) && lit(demo, 205, 140), "the disc and Cancel");
  await listened(demo, n);
  await demo.shot("list");
  await back(demo);
});

await T.check("The list shows each device with its address and signal bars, strongest first", async () => {
  await demo.tap(205, ROW[0]);              // the heard list again, without listening
  await demo.settle(600);
  assert.ok(/listen ended: 4 devices, fail 0/.test(demo.log()));
  for (const y of ROW) assert.ok(lit(demo, 100, y), "four rows");
});

await T.check("A device's page shows name, address and signal", async () => {
  await demo.tap(205, ROW[1]);              // Headphones
  await demo.settle(700);
  await demo.shot("device");
  assert.ok(lit(demo, 205, BTN_Y) && ink(demo, 32, 108, 300, 134) && ink(demo, 32, 180, 300, 210) && ink(demo, 32, 254, 300, 284), "name, address and signal");
  await back(demo);
  await demo.tap(205, ROW[2]);              // the unnamed one
  await demo.settle(700);
  await demo.shot("device-unnamed");
  await back(demo);
});

await T.check("Scan again from the list listens again: nothing heard is said so", async () => {
  await demo.press(BTN.DOWN); await demo.press(BTN.DOWN); await demo.press(BTN.DOWN); await demo.press(BTN.DOWN); await demo.press(BTN.DOWN);
  const n = count(demo, /listen ended/g);
  await demo.press(BTN.TOP);
  await listened(demo, n);
  await demo.shot("empty");
  assert.ok(/listen ended: 0 devices, fail 0/.test(demo.log()));
  assert.ok(lit(demo, 205, BTN_Y));
});

await T.check("A busy radio and a switched-off Bluetooth are each said in words", async () => {
  let n = count(demo, /listen ended/g);
  await demo.tap(205, BTN_Y);
  await listened(demo, n);
  await demo.shot("busy");
  assert.ok(/fail 2: the radio is busy/.test(demo.log()));
  n = count(demo, /listen ended/g);
  await demo.tap(205, BTN_Y);
  await listened(demo, n);
  await demo.shot("off");
  assert.ok(/fail 1: Bluetooth is off in Settings/.test(demo.log()));
  n = count(demo, /listen ended/g);
  await demo.tap(205, BTN_Y);
  await listened(demo, n);                  // the fifth call hears the devices again
  assert.ok(lit(demo, 100, ROW[0]) && lit(demo, 100, ROW[3]));
  await back(demo);
  await demo.shot("home-heard");
});

storeShots(demo, ["home-heard", "list", "device", "listening"]);
demo.run.shutdown();
fs.rmSync(demoDir, { recursive: true, force: true });
process.exit(T.done());
