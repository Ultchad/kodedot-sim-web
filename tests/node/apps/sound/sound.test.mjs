// Sound: record a voice note to a WAV file, play it back, rename, delete; the tone generator; settings survive a restart.
import assert from "node:assert/strict";
import audioGlue from "../../../../runtime/drivers/audio/audio.js";
import storageGlue from "../../../../runtime/drivers/storage/storage.js";
import { freqOf, activeRange, peak, makeWav, RATE } from "../../audio/bench.mjs";
import fsNode from "node:fs";
import path from "node:path";
import { savePng } from "../../kodeos/png.mjs";
import { Bench, root, launch, build, runner, sleep, BTN, RESET, storeShots } from "../lib.mjs";

const T = runner("sound");
const pkg = build("sound");
const bench = await new Bench().open();
const mk = (reason) => launch(bench, pkg, { name: "sound", glue: { audio: { default: audioGlue }, fs: { default: storageGlue } }, reason });
let app = await mk();
const fs = () => app.glue.fs;
const M = () => app.run.M;
const ROW = [116, 208, 300];
const DIR = "/storage/sound";
const wavs = () => { try { return fs().list(DIR).filter((f) => f.name.endsWith(".wav")).map((f) => f.name).sort(); } catch { return []; } };
const samples = (b) => new Int16Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + b.length - ((b.length - 44) & 1)));
const differs = (a) => app.fb().some((v, i) => v !== a[i]);

async function boot() {
  await app.waitFor(() => app.log().includes("sound.ao up"), 30000, "boot");
  await app.waitFor(() => app.run.frameSeq() > 0, 30000, "first frame");
  await app.settle(800);
}
async function restart() {
  await sleep(1200);
  await app.run.stop();
  app = await mk(RESET.SOFTWARE);
  await boot();
}
/** Tap and require the glass to change (the tap was taken). */
async function go(x, y, settle = 700) {
  const before = app.fb().slice();
  await app.tap(x, y);
  await app.waitFor(() => differs(before), 6000, "the page to change after tapping " + x + "," + y);
  await app.settle(settle);
}
const back = async () => { await app.press(BTN.BOT); await app.settle(500); };
const input = () => app.glue.audio.input;
const tone = (hz) => { input().setSynth({ kind: "tone", hz, levelDb: -12 }); input().setSource("synth"); };
const cap = {
  start: () => { M()._audio_cap_start(RATE * 14); return M()._audio_cap_frames(); },
  stop: (from) => {
    const to = M()._audio_cap_frames(), p = M()._audio_cap_ptr();
    const st = new Int16Array(M().HEAPU8.buffer.slice(p + from * 4, p + to * 4)); M()._audio_cap_stop();
    const l = new Int16Array(st.length >> 1); for (let i = 0; i < l.length; i++) l[i] = st[2 * i];
    return l;
  },
};
/** What the speaker did while `fn` ran: pitch, length in ms, peak. */
async function heard(fn, tail = 600) {
  const from = cap.start();
  await fn();
  await sleep(tail);
  const l = cap.stop(from), ar = activeRange(l, 0.1);
  return { hz: ar.frames > 3000 ? freqOf(l, ar.first + 1500, ar.last) : 0, ms: ar.frames / 48, peak: peak(l) };
}
/** A screenshot of a page that never goes still (a clock runs on it): the glass as it is. */
async function shotLive(label) {
  const fb = app.run.framebuffer();
  const dir = path.join(root, "docs/apps-shots", "sound");
  fsNode.mkdirSync(dir, { recursive: true });
  savePng(path.join(dir, label + ".png"), fb, 410, 502, 410 * 4);
  app.shots.push({ label, fb });
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

await T.check("boots to Record, Recordings and Tone", async () => {
  await boot();
  await app.settle(1200);
  await app.shot("home");
  for (const y of ROW) assert.ok(app.px(100, y) !== 0, "a row at " + y);
  assert.equal(app.px(205, 8), 0);
  await app.waitFor(() => fs().stat(DIR).isDir, 8000, "the app's folder to be made on the first run");
});

await T.check("Recordings is empty at first and says so", async () => {
  await go(205, ROW[1], 1200);
  await app.shot("empty");
  assert.ok(app.stats().colours > 10);
  assert.equal(wavs().length, 0);
  await back();
});

await T.check("Record: a 2 second voice note becomes Rec 001.wav, and the page shows it", async () => {
  tone(800);
  await go(205, ROW[0], 900);
  await app.shot("record-ready");
  await app.tap(205, 432);
  await sleep(1200);
  await shotLive("recording");
  await sleep(1400);
  await app.tap(205, 432);                                   // Stop
  await app.waitFor(() => wavs().length === 1, 15000, "the file");
  assert.deepEqual(wavs(), ["Rec 001.wav"]);
  await app.settle(1200);
  await app.shot("recording-saved");
  const w = fs().read(DIR + "/Rec 001.wav"), x = samples(w);
  assert.equal(String.fromCharCode(...w.subarray(0, 4)), "RIFF");
  assert.ok(x.length > RATE * 1.8 && x.length < RATE * 4.5, "about the time held: " + x.length / RATE + " s");
  assert.ok(near(freqOf(x, 3000, x.length), 800, 12), "the 800 Hz source is in the file: " + freqOf(x, 3000, x.length));
});

await T.check("the saved note opens on its own page and plays at its pitch and length", async () => {
  const secs = samples(fs().read(DIR + "/Rec 001.wav")).length / RATE;
  const before = app.fb().slice();
  const h = await heard(async () => {
    await app.tap(205, 274);                                  // Play
    await app.waitFor(() => differs(before), 6000, "the page to show Stop");
    await sleep(700);
    await shotLive("playing");
    await sleep(Math.max(0, secs * 1000 - 900));
  }, 1800);
  assert.ok(near(h.hz, 800, 15), "plays at 800 Hz: " + h.hz);
  assert.ok(near(h.ms, secs * 1000, 400), "for its whole length: " + h.ms + " vs " + secs * 1000);
  await app.settle(800);
  assert.ok(app.log().includes("up"), "still running");
});

await T.check("Stop cuts a playback short", async () => {
  await sleep(500);
  const h = await heard(async () => {
    await app.tap(205, 274);
    await sleep(700);
    await app.tap(205, 274);                                  // Stop
    await sleep(500);
  }, 800);
  assert.ok(h.ms > 200 && h.ms < 1500, "only the start was played: " + h.ms);
  await app.settle(600);
});

await T.check("Recordings lists it with its length and size", async () => {
  await back();                                               // home
  await go(205, ROW[1], 1200);
  await app.shot("list");
  assert.ok(app.px(100, ROW[0]) !== 0, "a row");
  assert.equal(app.px(100, ROW[1]), 0, "and only one");
});

await T.check("Rename gives the file another name", async () => {
  await go(205, ROW[0], 900);                                 // the note
  await go(115, 344);                                         // Rename
  await app.shot("rename");
  for (let i = 0; i < 12; i++) { await app.tap(333, 316); await sleep(120); }
  await app.tap(103, 155); await sleep(150); await app.tap(55, 155); await sleep(150);
  await app.settle(400);
  await app.shot("rename-typed");
  await app.tap(205, 432);
  await app.waitFor(() => wavs().includes("Ba.wav"), 8000, "the file to be renamed");
  assert.deepEqual(wavs(), ["Ba.wav"]);
  await app.settle(1500);
  await app.shot("renamed");
});

await T.check("Delete asks first; confirming removes the file and returns to the list", async () => {
  await go(294, 344);                                         // Delete
  await app.shot("delete-ask");
  await back();
  assert.equal(wavs().length, 1, "cancelled: still there");
  await go(294, 344);
  await app.tap(205, 432);
  await app.waitFor(() => wavs().length === 0, 8000, "the file to go");
  await app.settle(1800);
  await app.shot("after-delete");
});

await T.check("leaving the recorder while it records saves what it has", async () => {
  await back();                                               // home
  tone(600);
  await go(205, ROW[0], 700);
  await app.tap(205, 432);
  await sleep(1800);
  await back();                                               // BOT
  await app.waitFor(() => wavs().length === 1, 15000, "the file");
  assert.deepEqual(wavs(), ["Rec 002.wav"], "numbering goes on after a delete");
});

await T.check("a file that is not a 48 kHz mono WAV says so instead of playing", async () => {
  fs().write(DIR + "/Bad.wav", makeWav(new Int16Array(4800), 22050, 2));
  await go(205, ROW[1], 1200);
  await app.shot("list-two");
  await go(205, ROW[0], 900);                                 // Bad.wav sorts first
  await app.tap(205, 274);
  await sleep(1800);
  await app.settle(600);
  await app.shot("cannot-play");
  await back();                                               // message
  await back();                                               // list
  await back();                                               // home
});

await T.check("Tone plays the pitch on the slider, presets move it, Stop ends it", async () => {
  await go(205, ROW[2], 900);
  await app.shot("tone");
  let h = await heard(async () => {
    await app.tap(205, 334);                                  // Play
    await sleep(1400);
    await app.shot("tone-playing");
    await app.tap(205, 334);                                  // Stop
    await sleep(500);
  }, 800);
  assert.ok(near(h.hz, 1000, 40), "1000 Hz by default: " + h.hz);
  assert.ok(h.ms < 3500, "stopped by the tap: " + h.ms);
  await app.tap(249, 258);                                    // preset 2000
  await sleep(500);
  h = await heard(async () => {
    await app.tap(205, 334);
    await sleep(1400);
    await app.tap(205, 334);
    await sleep(500);
  }, 800);
  assert.ok(near(h.hz, 2000, 60), "2000 Hz after the preset: " + h.hz);
  await app.shot("tone-2000");
});

await T.check("a tone that sounds follows a new preset", async () => {
  const h = await heard(async () => {
    await app.tap(205, 334);                                  // Play at 2000
    await sleep(1200);
    await app.tap(71, 258);                                   // 500 Hz
    await sleep(2200);
    await app.tap(205, 334);                                  // Stop
    await sleep(500);
  }, 800);
  assert.ok(h.ms > 2500, "it kept sounding through the change: " + h.ms);
  assert.ok(app.px(100, 258) !== 0);
});

await T.check("volume lowers the output", async () => {
  const loud = await heard(async () => { await app.tap(205, 334); await sleep(900); await app.tap(205, 334); await sleep(400); }, 600);
  await app.drag(377, 421, 120, 421, 12);                     // about a quarter
  await sleep(1200);
  await app.shot("tone-quiet");
  const soft = await heard(async () => { await app.tap(205, 334); await sleep(900); await app.tap(205, 334); await sleep(400); }, 600);
  assert.ok(soft.peak < loud.peak * 0.8, "quieter: " + soft.peak + " vs " + loud.peak);
});

await T.check("the pitch, the volume and the numbering survive a restart; the notes stay", async () => {
  await restart();
  assert.deepEqual(wavs(), ["Bad.wav", "Rec 002.wav"]);
  const s = fs().read(DIR + "/settings.bin");
  assert.ok(s[9] < 60 && s[9] > 0, "volume kept: " + s[9]);
  await go(205, ROW[2], 900);
  await app.shot("tone-after-restart");
  assert.ok(app.stats().colours > 10);
  await back();
  tone(900);
  await go(205, ROW[0], 700);
  await app.tap(205, 432);
  await sleep(1300);
  await app.tap(205, 432);
  await app.waitFor(() => wavs().includes("Rec 003.wav"), 15000, "the next note to take the next number");
});

storeShots(app, ["home", "recording", "recording-saved", "tone"]);
app.run.shutdown();
process.exit(T.done());
