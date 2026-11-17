// The UNMODIFIED SDK examples end to end on the new storage: examples/storage (a counter in settings + a log file the buttons
// append to and read back) and examples/console_actions (settings and clock through the console). Plus the file verbs of the
// real console and AO_Storage, 20 restarts with write/read each time, and the error codes the SDK promises.
import assert from "node:assert/strict";
import { Bench, RESET, pkgPath, sleep, glueMods } from "../persist/host.mjs";

let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); } };
const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
const press = async (run, id) => { run.button(id, true); await sleep(250); run.button(id, false); };   // held long enough for a starved host to see the level
/** Type one console line and return the reply lines (">..." up to the terminating >ok / >err). */
async function cli(run, line, ms = 6000) {
  const start = run.logText().length;
  run.console(line);
  const t0 = Date.now();
  for (;;) {
    const t = strip(run.logText().slice(start));
    const m = /^>(ok|err .*)$/m.exec(t);
    if (m) return { ok: m[1] === "ok", text: t, lines: t.split("\n").filter((l) => l.startsWith(">|")), err: m[1] };
    if (Date.now() - t0 > ms) throw new Error("no reply to: " + line + "\n" + t);
    await sleep(25);
  }
}
const TOP = 4, BOT = 5;
/** Press a button until the firmware reacts (`seen` matches the log after the press). A press that lands in the first
 *  moments after the folder line can be lost under heavy host load (the button AO polls with a 30 ms settle), and nothing is
 *  logged for a lost press; this retries the INPUT only, every assertion on what the firmware then does is unchanged. */
const pressUntil = async (run, id, seen, ms = 2500, tries = 3) => {
  for (let k = 0; k < tries; k++) {
    const from = run.logText().length;
    await press(run, id);
    try { await run.waitFor(() => seen.test(run.logText().slice(from)), ms, "reaction to button " + id); return; } catch (e) { if (k === tries - 1) throw e; }
  }
};

// ---------------------------------------------------------------- examples/storage, unmodified
await check("examples/storage: first boot formats, writes a line, reads it back; the next boot appends and reads two", async () => {
  const bench = await new Bench().open();
  let run = await bench.boot(pkgPath("storage"));
  await run.waitFor(() => /storage folder \/storage\/storage_demo is there/.test(run.logText()), 20000, "folder");
  assert.match(run.logText(), /storage boot number 1;/);
  assert.match(run.logText(), /kdrv\.fs 'storage' will not mount: a new board/);   // as on a factory-fresh board
  await press(run, TOP);
  await run.waitFor(() => /line written; the bottom button reads it back/.test(run.logText()), 5000, "write");
  await press(run, BOT);
  await run.waitFor(() => /1 lines read/.test(run.logText()), 5000, "read");
  assert.match(run.logText(), /boot 1 press 1 at \d+ ms/);
  await run.stop();

  run = await bench.boot(pkgPath("storage"), { reason: RESET.EXTERNAL });
  await run.waitFor(() => /folder \/storage\/storage_demo is there/.test(run.logText()), 20000, "folder 2");
  assert.match(run.logText(), /storage boot number 2;/, "the boot counter (a setting in NVS) survived");
  assert.doesNotMatch(run.logText(), /will not mount/, "the volume mounted as it was, no format");
  await pressUntil(run, BOT, /reading \/storage/);          // read what boot 1 left, before writing anything
  await run.waitFor(() => /1 lines read/.test(run.logText()), 5000, "read of boot 1's file");
  assert.match(run.logText(), /boot 1 press 1 at \d+ ms/, "the file written by the previous boot was read back");
  await press(run, TOP);                                   // the demo starts a new log on the first press of a boot...
  await run.waitFor(() => /line written/.test(run.logText()), 5000, "write 2");
  await sleep(150);
  await press(run, TOP);                                   // ...and appends from then on
  await sleep(300);
  await press(run, BOT);
  await run.waitFor(() => /2 lines read/.test(run.logText()), 5000, "read 2");
  assert.match(run.logText(), /boot 2 press 1/); assert.match(run.logText(), /boot 2 press 2/);
  await run.stop();
});

await check("examples/storage: 20 restarts; each boot reads what the one before wrote, then writes two lines and reads them back", async () => {
  const bench = await new Bench().open();
  for (let i = 1; i <= 20; i++) {
    const run = await bench.boot(pkgPath("storage"), { reason: i === 1 ? RESET.POWERON : RESET.SOFTWARE });
    await run.waitFor(() => /folder \/storage\/storage_demo is there/.test(run.logText()), 20000, "folder " + i);
    assert.match(run.logText(), new RegExp(`storage boot number ${i};`));
    if (i > 1) {
      await pressUntil(run, BOT, /reading \/storage/);
      await run.waitFor(() => /lines read/.test(run.logText()), 5000, "read of the previous boot's file " + i);
      assert.match(run.logText(), new RegExp(`boot ${i - 1} press 2 at`), "boot " + (i - 1) + "'s second line is on the volume");
    }
    const written = () => (run.logText().match(/line written/g) ?? []).length;
    for (let k = 1; k <= 2; k++) {                          // each write must be answered before the next press (the demo ignores a press while its buffer is lent)
      await pressUntil(run, TOP, /line written|write failed/, 4000);
      await run.waitFor(() => written() >= k, 8000, "write " + k + " of boot " + i);
    }
    const before = (run.logText().match(/lines read/g) ?? []).length;
    await pressUntil(run, BOT, /reading \/storage/);        // (ignored by the demo while a write still holds its buffer: slow host)
    await run.waitFor(() => (run.logText().match(/lines read/g) ?? []).length > before, 5000, "read " + i);
    assert.match(run.logText(), new RegExp(`boot ${i} press 2 at`));
    await run.stop();
  }
});

// ---------------------------------------------------------------- the console's file verbs (real console + AO_Storage)
await check("console file verbs on /storage: mkdir, write, append, cat, ls, stat, cp, mv, rm, rmdir; across a restart", async () => {
  const bench = await new Bench().open();
  let run = await bench.boot(pkgPath("storage"));
  await run.waitFor(() => /kode>/.test(run.logText()), 20000, "console");
  await run.waitFor(() => /is there/.test(run.logText()), 10000, "volume");
  assert.ok((await cli(run, 'mkdir path="/storage/d"')).ok);
  assert.ok((await cli(run, 'write path="/storage/d/f.txt" text="hello"')).ok);
  assert.ok((await cli(run, 'write path="/storage/d/f.txt" append=on text="more"')).ok);
  let r = await cli(run, 'cat path="/storage/d/f.txt"');
  assert.ok(r.ok); assert.ok(r.text.includes('hello') && r.text.includes('more'), r.text);
  r = await cli(run, 'stat path="/storage/d/f.txt"');
  assert.match(r.text, /type=file size=\d+ medium=fs/);
  assert.ok((await cli(run, 'cp src="/storage/d/f.txt" dst="/storage/d/g.txt"')).ok);
  assert.ok((await cli(run, 'mv src="/storage/d/g.txt" dst="/storage/d/h.txt"')).ok);
  r = await cli(run, 'ls path="/storage/d"');
  assert.deepEqual(r.lines.map((l) => /name="([^"]+)"/.exec(l)[1]).sort(), ["f.txt", "h.txt"]);
  // the error codes the SDK maps: exists, a file as a directory, a directory where a file is wanted, a missing parent
  assert.match((await cli(run, 'mkdir path="/storage/d"')).text, /err .*exists/);
  assert.match((await cli(run, 'mkdir path="/storage/d/f.txt/sub"')).text, /err .*notdir/);
  assert.match((await cli(run, 'write path="/storage/d" text="x"')).text, /err .*isdir/);
  assert.match((await cli(run, 'mkdir path="/storage/nope/sub"')).text, /err /);
  assert.match((await cli(run, 'rm path="/storage/d/nope.txt"')).text, /err /);
  assert.match((await cli(run, 'rmdir path="/storage/d"')).text, /err /, "a directory with files is not removed");
  await run.stop();

  run = await bench.boot(pkgPath("storage"), { reason: RESET.EXTERNAL });
  await run.waitFor(() => /kode>/.test(run.logText()), 20000, "console 2");
  await run.waitFor(() => /is there/.test(run.logText()), 10000, "volume 2");
  r = await cli(run, 'cat path="/storage/d/h.txt"');
  assert.ok(r.text.includes('hello') && r.text.includes('more'), "files survived the restart: " + r.text);
  assert.ok((await cli(run, 'rm path="/storage/d/h.txt"')).ok);
  assert.ok((await cli(run, 'rm path="/storage/d/f.txt"')).ok);
  assert.ok((await cli(run, 'rmdir path="/storage/d"')).ok);
  assert.equal((await cli(run, 'ls path="/storage"')).lines.length, 1, "only the example's own folder is left");
  assert.match((await cli(run, "test component=fs", 20000)).text, /pass\s+fs/, "the SDK's own fs self-test passes");
  await run.stop();
});

// ---------------------------------------------------------------- examples/console_actions, unmodified
await check("examples/console_actions: variable and function; settings (nvs_*, zone) survive a restart", async () => {
  const bench = await new Bench().open();
  let run = await bench.boot(pkgPath("console_actions"));
  await run.waitFor(() => /kode>/.test(run.logText()), 20000, "console");
  assert.ok((await cli(run, 'function name="add" arg=5')).ok);
  assert.match((await cli(run, 'variable name="count"')).text, /variable="count" value=5/);
  assert.ok((await cli(run, 'nvs_set key="k1" value="v1"')).ok);
  assert.ok((await cli(run, 'nvs_set key="k2" value="a longer value, with spaces"')).ok);
  assert.ok((await cli(run, 'config key="zone" value="CET-1CEST,M3.5.0,M10.5.0/3"')).ok);
  await run.stop();

  run = await bench.boot(pkgPath("console_actions"), { reason: RESET.EXTERNAL });
  await run.waitFor(() => /kode>/.test(run.logText()), 20000, "console 2");
  assert.match((await cli(run, 'nvs_get key="k1"')).text, /value="v1"/);
  assert.match((await cli(run, 'nvs_get key="k2"')).text, /value="a longer value, with spaces"/);
  assert.match((await cli(run, 'config key="zone"')).text, /value="CET-1CEST,M3.5.0,M10.5.0\/3" stored=yes/);
  assert.match((await cli(run, 'variable name="count"')).text, /value=0/, "RAM state is gone, as after a reset");
  assert.ok((await cli(run, 'nvs_del key="k1"')).ok);
  await run.stop();
  run = await bench.boot(pkgPath("console_actions"), { reason: RESET.EXTERNAL });
  await run.waitFor(() => /kode>/.test(run.logText()), 20000, "console 3");
  assert.doesNotMatch((await cli(run, 'nvs_get key="k1"')).text, /value="v1"/, "a deleted setting stays deleted");
  assert.match((await cli(run, 'nvs_get key="k2"')).text, /value="a longer value/);
  await run.stop();
});
process.exit(failed ? 1 : 0);
