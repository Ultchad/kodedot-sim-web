# STATUS - audio area (speaker and microphone), branch area/audio

Result: `tests/node/run.sh audio` passes from a clean seeded build dir (`/tmp/audio-build2`, seeded from the main build): RTOS unit tests, the two stage-0 acceptance tests, and 4 audio test files (unmodified `examples/audio` end to end, layout, record, tone/volume/mute/stop/stall). `node tests/browser/audio.test.mjs` passes in headless Chrome (8 checks). Final output is pasted at the end.

## Seam and why

The SDK's real `kdrv_es8311.c` (and `kaos/audio`, `kode_audio_*`) is compiled **unmodified**; `codec_park_web.c` and the audio "supersedes" are gone (the real `kdrv_es8311_park` now runs over a virtual I2C chip at 0x18). Faked is the layer under the driver, the same one the SDK's own `tests/host_codec` fakes: shim headers for `driver/i2s_std.h` and `esp_codec_dev` (`include/`), implemented in `audio_codec_web.c`:

- ES8311 register model shared by the codec control interface and the I2C chip (audible gain derived from regs 0x31, 0x32, 0x12, 0x16, 0x17; mute from 0x31).
- Software I2S controller. TX is wall-clock paced at 48 kHz (DMA 1440 frames, 256-frame blocks, tolerance 200 ms): a 1 s tone takes 1 s. RX is position-paced and lossless.
- Input sources (`audio_input.c`): silence (default), synthetic tone/noise at a level, host-decoded WAV (looping, rewind), host microphone ring.
- Wire capture for Node tests (`audio_bench.c`, `audio_cap_*`): exactly what the transmitter clocked out.

## Shared memory ring layout (kaud_shared_t, `audio_shared.h`, mirrored by LAYOUT in `audio.js`, checked by layout.test.mjs)

All fields u32 little-endian, offsets pinned by `_Static_assert`. Header: magic "KAUD" 0x00, version 0x04, size 0x08, flags 0x0C (TX_RUN, RX_RUN, OPEN, PRESENT, MIC_DENIED), outOff 0x10, outFrames 0x14 (32768), outRate 0x18, outChannels 0x1C, outWr 0x20, outRd 0x24, outDropped 0x28, outOverruns 0x2C, outActiveMs 0x30, outBlocks 0x34, outFramesTotal 0x38, outUnderruns 0x3C, outGapFrames 0x40, outLates 0x44, outGainQ16 0x48, outCodecMute 0x4C, levelPeak/Rms/Seq/Ms 0x50..0x5C, benchGainQ16 0x60, benchMute 0x64, toleranceFrames 0x68, pace 0x6C, sinkState 0x70 (0 none, 1 running, 2 starved, 3 blocked), sinkPeak 0x74, sinkRms 0x78, sinkUnderruns 0x7C, input block 0x80..0xDC (source, synth, file, rewind, in ring off/cap/wr/rd, stats, gain, mute, level). Data from 0x100: output ring of 32768 stereo int16 frames (interleaved L,R, 48 kHz), then the input ring of 16384 mono int16 frames.
Protocol: single producer, single consumer, monotonic u32 frame counters (index = counter mod size), release stores, data only (no pointers). A consumer that finds fill > size resyncs to "now minus target". The firmware never waits for the host: a stalled host costs only the overrun counters.

## Exported C API (area.json "exports")

audio_shared_ptr, audio_layout, audio_bench_set, audio_set_tolerance_ms, audio_set_pacing, audio_stats_reset, audio_cap_start/stop/frames/overflow/ptr, audio_in_source, audio_in_synth, audio_in_rewind, audio_in_rewind_auto, audio_in_file_begin/commit/clear.

## JS API (`audio.js`, default export `(ctx) => api`; `audio-worklet.js` is the AudioWorklet module)

Named helpers: RATE, BLOCKED_MESSAGE, LAYOUT, FLAGS, decodeWav, resampleTo48k, OutputRingReader.
Api: `output` {state: detached|blocked|running|unsupported|error|closed, message, latencyMs, sampleRate}; `attachOutput({workletUrl,audioContext,destination,latencyMs,gestureTarget})`, `detachOutput`, `resume`, `getAnalyser`, `setWorkletUrl`; `setVolume`, `setMuted` (bench level, independent of the SDK's), `level()` {peak,rms,peakDb,rmsDb,playing,source}, `stats()`, `codec()`, `setUnderrunTolerance`, `setPacing`, `resetStats`, `createReader` (Node/no-worklet consumer); `input` {source, state, setSource(silence|synth|file|mic), setSynth({kind:tone|noise,hz,levelDb}), setFile(wav), clearFile, rewind, setRewindOnRecord, useMic (getUserMedia, explicit permission; state "denied" on refusal), stopMic, feedMic}. Events via ctx.emit: output-state, playing, underrun, input-state, error.
The worklet file registers `dotbench-audio-out` and `dotbench-audio-in`; on the main thread it only sets `globalThis.__dotbenchAudioWorkletUrl = import.meta.url`. Both files contain no eval, no inline script: they load under `script-src 'self' blob:` and cross-origin isolation (browser test uses the strict CSP of tests/browser/server.mjs).

## Scenarios

| Scenario | File | Result |
|---|---|---|
| Unmodified examples/audio: 3 notes (1020/1137/1254 Hz, 250 ms, 25 %), no gaps/clicks, no underrun, 2 s recording with LED red | example_audio | PASS |
| Layout offsets, ring reader, WAV decoder, worklet constants, CSP-clean source | layout | PASS |
| Tone 1 s: frequency within 2 %, duration within 2 %, continuity, 48 kHz pacing; 300/4000 Hz refused | tone_volume | PASS |
| Volume 50 vs 100, 120 refused, mute, bench mute/volume, level meter, kode_sys tone/info | tone_volume | PASS |
| Stop mid-play; host stall (no ring reader): firmware unaffected, wire capture intact, late reader resyncs | tone_volume | PASS |
| Record: silence, synth tone (freq, level), noise, host mic ring, 1 s frame count and pacing, 30 s no drift | record | PASS |
| Browser: frames reach the worklet (analyser 1 kHz, sink_rms), bench mute/volume, starve and recover, detach/attach, OfflineAudioContext render, blocked-until-gesture then real click resumes, no page errors | tests/browser/audio.test.mjs | PASS |

Own app: `tests/node/audio/apps/audio_api` (console functions for the whole kode.h audio API and the kode_sys calls; answers as `RES ...` log lines).

## Measured

- Latency: first sample reaches the I2S transmitter about 38 ms after the open; worklet prebuffer 50 ms (`latencyMs` option); browser estimate 92 ms total with the context's base latency.
- CPU (Node, one core, `tests/node/audio/cpu.mjs`, loaded 2-core machine): idle 7.8 %, playing 8.5 %, recording 7.6 %; the audio cost is about 1 % of a core.
- 1 s tone: about 993 ms audible, 1052 ms API wall time; 1 s recording: 48000 frames in 1004 ms; 30 s: exact frame count, wall within 2 %.

## Assumptions and doc/code disagreements

- The tone generator snaps the frequency to 8 bins; tests use the snapped value (1 % tolerance holds for the example's notes, 2 % for arbitrary ones).
- Microphone gain is relative to the nominal 24 dB; stereo duplicates the mono slot.
- Volume 0 is treated as silence (register mute), an assumption, not documented.
- An idle gap after a drained sound is not an underrun (only a late write while audio was in flight counts); `outGapFrames` counts both.
- The amplifier enable lives on the radio co-processor; this area does not depend on it.

## Roles (app and kodeos)

The area manifest has no `roles` key, so it is included in both roles. Only the app role was built and tested here. The kodeos role was not built (several minutes of OS-role library build); `kaos/audio` is in the OS role too and the driver sits below it, so no role-specific code exists, but that is untested.

## Could not be tested

WAV play (`kode_audio_play*`), `record_file`/`record_save` to disk, and wrong-format refusal: the storage layer is still stubbed in this worktree (the test records the file-write failure with a note and does not count it as a pass). Real audible output, a real microphone (getUserMedia was not exercised; only `feedMic` and the denied path in the glue), and Safari/Firefox worklet behaviour.

## Shared-file changes needed (not made)

None required. Suggestions: `web-adapter` could define `__dotbenchAudioWorkletUrl` handling or pass the worklet blob URL (today the glue takes `workletUrl` or the global the worklet module sets); the adapter's glue loader returns the first listed glue as `device.area("audio")`, so `audio.js` must stay first in area.json "js"; `tests/browser/page.js` has no audio hook, so the browser test brings its own page and server (it does not boot the wasm firmware: the page plays the producer into the documented ring).

## Final passing output

```
== dotbench sdk
== dotbench build audio
== dotbench build buttons_led
== dotbench build display_lvgl
== dotbench build audio_api
== rtos unit tests
ALL PASSED
== acceptance/buttons_led.test.mjs (Node)
ok   - boots and logs 'up; the top button swaps the colour'
ok   - LED becomes green (0,32,0)
ok   - top button press turns the LED red (32,0,0)
ok   - releasing the top button changes nothing (toggle is on press)
ok   - a second press toggles back to green
buttons_led: PASSED
== acceptance/display_lvgl.test.mjs (Node)
ok   - boots: LVGL up and the panel lit
ok   - framebuffer is non-uniform
ok   - touch changes the counter and the picture
ok   - top button press changes the counter
display_lvgl: PASSED
== audio/example_audio.test.mjs (Node)
ok   - AO_Audio found the codec at boot (volume 100, microphone 24 dB, mute 0)
ok   - note 1: the I2S stream carries 1020 Hz within 1 %
ok   - note 1: audible length 250 ms within 2 % (first block and the chip's 12 ms ramp excluded)
ok   - note 1: peak is 25 % of full scale through the -0.5 dB speaker cap
ok   - note 1: no gaps or clicks at the 256-frame block boundaries (largest step 1032 <= 1292)
ok   - note 2: the I2S stream carries 1137 Hz within 1 %
ok   - note 2: audible length 250 ms within 2 % (first block and the chip's 12 ms ramp excluded)
ok   - note 2: peak is 25 % of full scale through the -0.5 dB speaker cap
ok   - note 2: no gaps or clicks at the 256-frame block boundaries (largest step 1150 <= 1439)
ok   - note 3: the I2S stream carries 1254 Hz within 1 %
ok   - note 3: audible length 250 ms within 2 % (first block and the chip's 12 ms ramp excluded)
ok   - note 3: peak is 25 % of full scale through the -0.5 dB speaker cap
ok   - note 3: no gaps or clicks at the 256-frame block boundaries (largest step 1268 <= 1587)
ok   - no underrun was counted while playing
ok   - LED red (32) and 'listening' logged while the microphone records
ok   - the 2 s recording takes 2 s of wall time (open and file write included)
note - file layer: the recording ran 2 s but AO_Storage could not write /storage/example_rec.wav (the storage area is still stubbed in this worktree): no recording in /storage/example_rec.wav: status 1
ok   - LED off again once the answer arrived
ok   - no 'dotbench: ... not implemented' stub fired for an audio function
heard: [{"n":1,"f":1019.5,"ms":244.08333333333334,"amp":7733},{"n":2,"f":1136.7,"ms":250.64583333333334,"amp":7733},{"n":3,"f":1253.9,"ms":250.64583333333334,"amp":7733}]
example_audio: PASSED
== audio/layout.test.mjs (Node)
ok   - kaud_shared_t size in the header equals sizeof (C)
ok   - magic KAUD and version 1
ok   - output ring data at 0x100
ok   - output ring capacity is a power of two
ok   - input ring offset and capacity match C
ok   - output format: 48000 Hz, 2 slots
ok   - defaults: bench gain unity, pacing on, tolerance 200 ms
ok   - default microphone source is silence
ok   - worklet word outOff == LAYOUT.outOff (0x10)
ok   - worklet word outFrames == LAYOUT.outFrames (0x14)
ok   - worklet word outWr == LAYOUT.outWr (0x20)
ok   - worklet word outRd == LAYOUT.outRd (0x24)
ok   - worklet word outDropped == LAYOUT.outDropped (0x28)
ok   - worklet word outBlocks == LAYOUT.outBlocks (0x34)
ok   - worklet word benchGain == LAYOUT.benchGainQ16 (0x60)
ok   - worklet word benchMute == LAYOUT.benchMute (0x64)
ok   - worklet word sinkState == LAYOUT.sinkState (0x70)
ok   - worklet word sinkPeak == LAYOUT.sinkPeak (0x74)
ok   - worklet word sinkRms == LAYOUT.sinkRms (0x78)
ok   - worklet word sinkUnder == LAYOUT.sinkUnderruns (0x7c)
ok   - worklet word inOff == LAYOUT.inOff (0xa4)
ok   - worklet word inCap == LAYOUT.inFramesCap (0xa8)
ok   - worklet word inWr == LAYOUT.inWr (0xac)
ok   - worklet registers the output and the input processor
ok   - worklet uses no eval/importScripts/fetch (CSP-clean)
ok   - reader returns every frame in order across a wrap-free sequence, both slots
ok   - reader stays in order while the ring wraps (5 x 600 frames through 1024)
ok   - a lapped reader skips to the newest full ring and counts the loss
ok   - the reader publishes out_rd
ok   - frame counters wrap at 2^32 without losing frames
ok   - 48 kHz mono 16-bit WAV decodes unchanged in length
ok   - 44.1 kHz stereo resamples to 48 kHz mono (1 s -> 48000 frames)
ok   - 8, 24-bit PCM and float32 WAV decode
ok   - 24-bit and float32 paths agree on the same waveform
ok   - garbage is rejected with an exception from decodeWav (and never reaches the firmware)
layout: PASSED
== audio/record.test.mjs (Node)
ok   - 1 s recording returns 48000 frames
ok   - recording is paced at the real rate
ok   - default source is silence
ok   - synthetic tone source: frequency 1000 Hz
ok   - synthetic tone source: level follows the setting
ok   - noise source has energy
ok   - microphone ring feeds the recording
ok   - 30 s recording holds exactly 1 440 000 frames
ok   - no pacing drift over 30 s of wall time
record: PASSED
== audio/tone_volume.test.mjs (Node)
ok   - kode_audio_tone 1000 Hz 1000 ms succeeds
ok   - the call takes the real playing time (48 kHz pacing)
ok   - tone frequency within the snapped bin (1000 Hz +-2 %)
ok   - tone duration within 2 %
ok   - no gaps or clicks at buffer boundaries
ok   - tone 300 Hz is refused (outside 400..3000)
ok   - tone 4000 Hz is refused (outside 400..3000)
ok   - volume 50 is quieter than volume 100
ok   - kode_audio_get(volume) reads back 50
ok   - volume 120 is refused
ok   - mute gives digital silence on the wire once the codec ramp is done
ok   - level meter exists
ok   - bench mute leaves the wire alone (the host applies it on the ring)
ok   - kode_sys_audio_info_read: 48 kHz codec present
ok   - kode_sys_audio_tone accepted (rc 0)
ok   - kode_sys_audio_tone amp 50 is 50 % of full scale through the speaker cap
note - stop mid-play: playstop ok=1 in 365 ms; audible 900 ms of a 3000 ms tone
ok   - a tone stopped at 600 ms does not play out its 3 s
ok   - no reader on the ring: the firmware call is not slowed
ok   - wire capture intact during a host stall
ok   - ring overrun counters readable
ok   - a late reader resyncs to at most one ring of data
tone_volume: PASSED
ALL TESTS PASSED
```

Browser test (`node tests/browser/audio.test.mjs`, 4 consecutive passes after a race in the offline check was fixed):
```
ok   - page is cross-origin isolated, strict CSP, glue and worklet module load
note - output latency estimate 92 ms (50 ms worklet prebuffer + context)
ok   - a tone written to the ring reaches the AudioWorklet: analyser sees 1 kHz, sink_rms and state report it
ok   - bench mute silences the worklet, unmute restores it; bench volume scales it
ok   - a stalled producer starves the worklet (counted), then it recovers
ok   - detach then re-attach works, no page errors
ok   - OfflineAudioContext renders the worklet over a pre-filled ring: 1 kHz at the written amplitude
ok   - without a user gesture the output reports 'blocked' with the documented message and never throws
ok   - a real click resumes the context: state becomes running and audio reaches the worklet
audio browser test: PASSED
```
