// The file side of the audio API on the real storage layer: WAV playback from /storage and /sdcard, recording to a file,
// record_start/record_save, refusals (wrong format, missing file, full volume), and the files as the page sees them.
import { bootAudio, check, done, note, sleep, activeRange, freqOf, peak, makeWav, RATE } from "./bench.mjs";

const a = await bootAudio("audio_api");
const fs = a.fs;
const grab = async (name, arg, wait = 300) => {
  a.capStart(12); const b = a.capFrames();
  const r = await a.cmd(name, arg, 30000);
  await sleep(wait);
  const l = a.capLeft(b, a.capFrames()); a.capStop();
  return { r, l, ar: activeRange(l, 0.1) };
};
const u32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const tag = (b, o) => String.fromCharCode(...b.subarray(o, o + 4));
const samples = (wav) => new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length - ((wav.length - 44) & 1)));

// ---- a WAV written by the app (kode_file_write_bytes / append_bytes) is a file of the real FAT volume
{
  const r = await a.cmd("wavwrite", "/storage/tone.wav;1000;500");
  check(r.ok === 1 && r.bytes === 48044, "the app writes a 500 ms WAV to /storage", r.line);
  const st = fs.stat("/storage/tone.wav");
  check(st.exists && !st.isDir && st.size === 48044, "the page sees the file with its exact size", st);
  const w = fs.read("/storage/tone.wav");
  check(tag(w, 0) === "RIFF" && tag(w, 8) === "WAVE" && u32(w, 24) === RATE, "and its content", Array.from(w.subarray(0, 4)));
}
// ---- kode_audio_play of that file: pitch, length, no gaps, paced at the real rate
{
  const { r, l, ar } = await grab("play", "/storage/tone.wav");
  check(r.ok === 1, "kode_audio_play(/storage/tone.wav) succeeds", r.line);
  check(r.took >= 450 && r.took < 1400, "the call lasts the playing time", r.took);
  const f = freqOf(l, ar.first + 500, ar.last);
  check(Math.abs(f - 1000) / 1000 < 0.01, "the file plays at 1000 Hz", f);
  check(Math.abs(ar.frames / 48 - 500) / 500 < 0.03, "for 500 ms", ar.frames / 48);
  check(peak(l) > 10000 && peak(l) < 20000, "at the amplitude it was written with (50 %)", peak(l));
}
// ---- play_start: non-blocking, is_playing, play_stop cuts it short
{
  await a.cmd("wavwrite", "/storage/long.wav;600;4000");
  a.capStart(12); const b = a.capFrames();
  const s = await a.cmd("playstart", "/storage/long.wav");
  check(s.ok === 1 && s.playing === 1, "play_start returns at once and the sound is playing", s.line);
  await sleep(600);
  check((await a.cmd("isplaying")).line.endsWith("1"), "is_playing while it plays");
  const t0 = Date.now();
  const st = await a.cmd("playstop");
  check(st.ok === 1 && st.playing === 0, "play_stop ends it", st.line);
  await sleep(300);
  const l = a.capLeft(b, a.capFrames()); a.capStop();
  const ar = activeRange(l, 0.1);
  check(ar.frames / 48 > 400 && ar.frames / 48 < 2500, "only the first part was played", ar.frames / 48);
  check(Date.now() - t0 < 2500, "and the stop was quick", Date.now() - t0);
}
// ---- recording to a file: kode_audio_record_file of a 800 Hz synthetic tone
{
  a.audio.input.setSynth({ kind: "tone", hz: 800, levelDb: -20 });
  a.audio.input.setSource("synth");
  const t0 = Date.now();
  const r = await a.cmd("recfile", "/storage/rec.wav;1000", 30000);
  const wall = Date.now() - t0;
  check(r.ok === 1, "kode_audio_record_file(/storage/rec.wav, 1000 ms) succeeds", r.line);
  check(wall >= 950 && wall < 3000, "paced at the real rate", wall);
  const st = fs.stat("/storage/rec.wav");
  check(st.exists && st.size > 44, "a file exists on the volume", st);
  const w = fs.read("/storage/rec.wav");
  check(tag(w, 0) === "RIFF" && tag(w, 8) === "WAVE" && tag(w, 12) === "fmt ", "RIFF/WAVE/fmt header", tag(w, 0));
  check(u16(w, 20) === 1 && u16(w, 22) === 1 && u32(w, 24) === RATE && u16(w, 34) === 16, "PCM, mono, 48000 Hz, 16 bits", { fmt: u16(w, 20), ch: u16(w, 22), rate: u32(w, 24), bits: u16(w, 34) });
  const dataLen = u32(w, 40);
  check(tag(w, 36) === "data" && dataLen === w.length - 44 && u32(w, 4) === w.length - 8, "chunk sizes agree with the file size", { dataLen, size: w.length });
  const x = samples(w);
  check(Math.abs(x.length - RATE) < RATE * 0.05, "one second of samples", x.length);
  check(Math.abs(freqOf(x, 2000, x.length) - 800) < 10, "the 800 Hz source is in the file", freqOf(x, 2000, x.length));
  a.audio.input.setSource("silence");
}
// ---- round trip: what was recorded plays back
{
  const { r, l, ar } = await grab("play", "/storage/rec.wav");
  check(r.ok === 1, "the recording plays back", r.line);
  check(Math.abs(freqOf(l, ar.first + 500, ar.last) - 800) < 10, "at 800 Hz", freqOf(l, ar.first + 500, ar.last));
}
// ---- record_start / record_stop / record_save to a file
{
  a.audio.input.setSynth({ kind: "tone", hz: 500, levelDb: -20 });
  a.audio.input.setSource("synth");
  const s = await a.cmd("recstart", "600");
  check(s.ok === 1, "kode_audio_record_start", s.line);
  await sleep(900);
  const r = await a.cmd("recsave", "/storage/saved.wav");
  check(r.ok === 1, "kode_audio_record_save(/storage/saved.wav)", r.line);
  const w = fs.read("/storage/saved.wav");
  const x = samples(w);
  check(tag(w, 0) === "RIFF" && Math.abs(x.length - 0.6 * RATE) < 0.1 * RATE, "a WAV of the 600 ms asked for", x.length);
  check(Math.abs(freqOf(x, 1500, x.length) - 500) < 10, "holding the 500 Hz source", freqOf(x, 1500, x.length));
  a.audio.input.setSource("silence");
}
// ---- the microSD: mount it from the page (the firmware does not mount it on its own), play from and record to /sdcard
{
  const sdMod = await import(a.dir + "/glue/sd/sd.js");
  const sd = sdMod.default({ module: a.M, call: (fn, ...x) => a.M["_" + fn](...x), heap: () => a.M.HEAPU8, emit: () => {}, onTick: () => {} });
  sd.mount();
  const w = await a.cmd("wavwrite", "/sdcard/sd_tone.wav;1500;400");
  check(w.ok === 1, "the app writes a WAV to the microSD", w.line);
  const { r, l, ar } = await grab("play", "/sdcard/sd_tone.wav");
  check(r.ok === 1 && Math.abs(freqOf(l, ar.first + 400, ar.last) - 1500) < 20, "and plays it back from the card at 1500 Hz", r.line);
  a.audio.input.setSynth({ kind: "tone", hz: 900, levelDb: -20 }); a.audio.input.setSource("synth");
  const rr = await a.cmd("recfile", "/sdcard/sd_rec.wav;500", 30000);
  check(rr.ok === 1 && fs.stat("/sdcard/sd_rec.wav").size > 44, "recording to the microSD", rr.line);
  a.audio.input.setSource("silence");
}
// ---- refusals
const refuse = async (what, name, path, re) => {
  const r = await a.cmd("play", path);
  check(r.ok === 0 && (!re || re.test(r.line)), what, r.line);
};
await refuse("a file that does not exist is refused", "play", "/storage/nothere.wav", /./);
fs.write("/storage/words.wav", "this is not a wav file at all, only words, padded out to be longer than a wav header is");
await refuse("a text file is refused (not a WAV)", "play", "/storage/words.wav", /./);
fs.write("/storage/w44.wav", makeWav(new Int16Array(4410), 44100, 1));
await refuse("a 44.1 kHz WAV is refused", "play", "/storage/w44.wav", /./);
fs.write("/storage/stereo.wav", makeWav(new Int16Array(9600), RATE, 2));
await refuse("a stereo WAV is refused", "play", "/storage/stereo.wav", /./);
{
  const w = fs.read("/storage/tone.wav").slice(0, 30);        // cut inside the fmt chunk
  fs.write("/storage/cut.wav", w);
  await refuse("a truncated WAV is refused", "play", "/storage/cut.wav", /./);
}
{
  const r = await a.cmd("play", "/storage/../etc/x.wav");
  check(r.ok === 0, "a path that leaves the volume is refused", r.line);
}
// ---- a full volume: recording fails with an error, nothing is left that claims to be a recording, the firmware survives
{
  const u0 = fs.usage("storage");
  fs.write("/storage/fill.bin", new Uint8Array(u0.free - 20 * 1024));
  const r = await a.cmd("recfile", "/storage/full.wav;1000", 30000);
  check(r.ok === 0, "recording into a nearly full volume fails (about 94 KB needed, 20 KB free)", r.line);
  check(/./.test(r.err ?? ""), "with a reason", r.err);
  fs.remove("/storage/fill.bin");
  const r2 = await a.cmd("recfile", "/storage/full2.wav;1000", 30000);
  check(r2.ok === 1, "and works again once the space is back", r2.line);
}
check(!/dotbench: .* not implemented|assert|panic/i.test(a.logText()), "no stub fired, no assert in the log");
done(a, "files");
