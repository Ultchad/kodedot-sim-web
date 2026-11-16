# STATUS: NFC area

Branch `area/nfc`, worktree `/home/claude/wt/nfc`. Files: `runtime/drivers/nfc/`, `tests/node/nfc/`, this file.

## Seam

The seam is the whole public header `components/kdrv/nfc/include/kdrv_st25r3916.h`. `nfc_drv.c` replaces
`kdrv_st25r3916.c` through the manifest `supersedes` entry (the RFAL and SPI layer is not built).

Why this one: the SDK authors' own host tests mock exactly this header (`tests/host/mocks/kdrv_st25r3916`), and their
CMakeLists says `knfc_ndef.c` and `knfc_tag.c` are *not* mocked because they are the code under test. A register-level
chip model would be out of scope and would add nothing the SDK's logic above can see. Running unchanged above the seam:
`AO_Nfc` (kaos/nfc/nfc_ao.c), `kode_sys_nfc`, the standard layer `kode_nfc.c` (`kode_nfc_*`), `knfc_tag.c`, `knfc_ndef.c`,
`knfc_mfc.c`, `knfc_crypto1.c`, `knfc_emu_img.c`, `knfc_field.c`. Mifare Classic is handled by the SDK's own Crypto1
over `transceive_bits`; the bench card side uses the same `knfc_crypto1` (it is symmetric).

## Exported C API (area.json, all safe from the host thread; one spin lock guards store and driver state)

`nfc_obj_create(kind)`, `nfc_obj_destroy(id)`, `nfc_obj_set_identity(id, uid, len, atqa, sak)`,
`nfc_obj_set_memory(id, data, len, offset)`, `nfc_obj_set_mem_len(id, len)`, `nfc_obj_set_flags(id, flags)`
(LOCKED=1 NOAPP=2 MUTE=4 AUTOREAD=8), `nfc_obj_set_param(id, key, v)` (1 drop-after, 2 field amplitude, 3 modulation),
`nfc_obj_near(id, near)`, `nfc_obj_info(id, out16)`, `nfc_obj_read_blob(id, which, dst, off, len)` (0 memory, 1 uid,
2 UID the reader saw, 3 pages-seen bitmap), `nfc_reader_read(id, block)`, `nfc_state(out16)`,
`nfc_event_pop(out4)`, `nfc_event_lost()`, `nfc_chip_fitted(on)`, `nfc_reset_bench()`.
Kinds: T2T=1 T4T=2 MIFARE=3 OTHER=4 READER=5; 6 slots, 4096 bytes memory each. Objects and the chip-fitted flag live in
the persistent region `nfc`, so they survive a device restart; driver runtime state (field, discovery, active object,
emulation window) is plain RAM. `area.json` also sets `sdkconfig CONFIG_KODEOS_NFC=y`.

## JS API (`runtime/drivers/nfc/nfc.js`, default export `(ctx) => api`)

- `nfc.tag(spec)` Type-2 (ntag213/215/216/ultralight, `text`, `uri`, `records`, `locked`, `lockMode` cc|chip|both,
  `formatted:false`, `mute`, `near`), `nfc.card(spec)` (`iso-dep`, `mifare1k|4k|mini`, `unsupported`; `fileSize`, `noApp`,
  `blank`, `keys:{a,b}`), `nfc.reader(spec)`, `nfc.get(id)`, `nfc.objects()`, `nfc.state()`, `nfc.setChipFitted(bool)`,
  `nfc.reset()`, `nfc.poll()`, `nfc.ndef.{encode,decode,wrapTlv,findTlv,decodeMemory}`.
- Handle: `near() away() remove() info() memory() content() update(spec) setLocked(on, mode) setNoApp() setMute()
  dropAfter(n)`; readers: `seen() read(block) setField(amp, mod) setAutoRead(on)`.
- Events: `field created removed near activated read written lost dropped emulation reader-saw`.
- Named exports: `KIND encodeNdef decodeNdef wrapTlv findTlv t2tImage mifareImage t4File decodeMemory parseHex hex`.
  JS builds initial memory only; every later read and write is done by the SDK code.

## Scenarios (all pass)

| Area | Scenario | Result |
|---|---|---|
| nfc_read (unmodified example) | identify, text read, tag away (3000 ms window), URI tag, late arrival, blank tag, Mifare known/unknown key, tag lost mid-read | pass (11) |
| tags | no tag, removed mid-read/mid-write, retry completes, text and URI read, all URI prefixes, write and read-back, locked (cc, chip), unformatted, no text/URI record, too long, update while near, mute, two tags, 4 memory sizes, events | pass (18) |
| cards | Type 4 read/write/read-only/no app/too small/torn; Mifare 1K/4K/Mini known keys, unknown keys, blank card, locked, too long, torn during auth; unsupported SAK | pass (13) |
| emulation | text/uri/uid profiles seen by a reader (UID, ATQA, SAK, Type-2 pages), stop and restart, replaced profile, refusals while emulating, scan vs emulate exclusion, profile limits, bad UID, unknown profile, scan events and scan_stop | pass (11) |
| missing | objects survive restart, chip absent (persisted), every API call fails with the SDK's message, example logs "no reader", refit | pass (6) |
| glue | NDEF round trips, TLV forms, Type-2/Mifare/Type-4 images, hex | pass (7) |

## Final passing output

`DOTBENCH_BUILD=/tmp/nfcc tests/node/run.sh nfc` (clean seeded build dir, `tools/dotbench --build /tmp/nfcc seed ...`):

```
== rtos unit tests
85 checks, 0 failed
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
== nfc/cards.test.mjs (Node)
ok   - T4. an ISO-DEP card: identified, text and link read through the NDEF application
ok   - T4. write and read back; the length field is zeroed first and written last (3 UPDATE BINARY)
ok   - T4. file too small: refused, nothing written; read-only card (write access denied); no NDEF application
ok   - T4. card removed in the middle of the APDU exchange: the read keeps waiting, then times out
ok   - M1. Mifare Classic 1K formatted for NDEF with keys kodeOS knows: identified, read, written, read back
ok   - M2. Mifare Classic 4K and Mini are told apart by SAK, and read the same way
ok   - M3. a card whose keys kodeOS does not know cannot be read or written
ok   - M4. a factory-blank card (default keys, no MAD): reads as 'no text or link', takes a write at sector 1
ok   - M5. a read-only card (the card NAKs writes): the write fails, content is unchanged
ok   - M6. message too long for the two NDEF sectors: refused before anything is written
ok   - M7. Mifare card removed during authentication: the call finds no card within its time
ok   - U1. unsupported card (NFC-DEP / unknown SAK): identified as NFC-A; reading and writing are refused
ok   - U2. nothing 'not implemented' was called, the field is down
cards: PASSED (13 checks)
== nfc/emulation.test.mjs (Node)
ok   - E1. text profile: the reader sees an NXP-style 7-byte UID, ATQA 0x0044, SAK 0 and reads the NDEF text from the Type-2 image
ok   - E2. uri profile reads back as a link
ok   - E3. uid profile clones the given UID verbatim (4 bytes: SAK 0x08 Classic-style)
ok   - E4. while emulating, read_id / read / scan_start are refused with the SDK's message; stop is idempotent
ok   - E5. after the stop the reader no longer meets the card, and the Dot reads a real tag again
ok   - E6. a reader brought near after the start, and a restart with a replaced profile
ok   - E7. a reader that is away sees nothing; two readers both see the card
ok   - E8. unhappy: unknown profile, bad UID, bad type, ninth profile
ok   - E9. scan vs emulate are mutually exclusive; scan_stop is idempotent
ok   - S1. scanning raises nfc_tag events for a tag in the field, about once a second, and stops on scan_stop
ok   - S2. scanning with nothing near raises no event; a tag arriving later does
emulation: PASSED (11 checks)
== nfc/glue.test.mjs (Node)
ok   - G1. NDEF text and URI records round-trip, including URI prefix compression
ok   - G2. a long record uses the long form; unknown records survive as 'unknown'
ok   - G3. TLV wrapper: short and long length forms; findTlv skips NULL and unknown TLVs
ok   - G4. Type-2 images: UID, BCC bytes, capability container, sizes, formatted:false
ok   - G5. Mifare images: layout, default NDEF keys vs blank vs custom keys
ok   - G6. Type-4 file: NLEN then message, padded to the file size
ok   - G7. hex helpers
glue: PASSED (7 checks)
== nfc/missing.test.mjs (Node)
ok   - R1. objects (and their content) survive a restart of the device
ok   - R2. no chip fitted: the flag is kept across restarts and reaches the driver at the next boot
ok   - R3. after the restart: the bench objects are all still there
ok   - R4. no reader fitted: kaos.nfc reports it, every API call fails with the SDK's message
ok   - R5. refitting the chip and restarting brings NFC back, with the same tag
ok   - R6. the unmodified nfc_read example on a board without the chip says so and keeps running
missing: PASSED (6 checks)
== nfc/nfc_read.test.mjs (Node)
ok   - boot: AO_Nfc finds the reader, no 'not implemented' for anything it calls
ok   - top button: identify a Type-2 tag (UID, ATQA, SAK)
ok   - bottom button: read the text NDEF message
ok   - the device's events reached the page: field on/off, activated, read
ok   - take the tag away: the read finds nothing within its 3000 ms window
ok   - present another tag (a link): the next read shows it
ok   - a tag removed while the window is open, then presented, is read when it arrives
ok   - blank tag: opens but carries no message (the example says how to fix it)
ok   - Mifare Classic with a key kodeOS knows is read; one with an unknown key is refused
ok   - a tag that disappears mid-read: 'stopped answering'
ok   - the device shuts down cleanly with the bench still populated
nfc_read: PASSED (11 checks)
== nfc/tags.test.mjs (Node)
ok   - 1. read a text tag; the nfc_tag event carries the model and the UID
ok   - 2. read a link tag; asking for text instead fails; the other way round too
ok   - 2b. every URI prefix the tag can use is expanded on read
ok   - 3. no tag: read_id blocks for its time and fails; ms = 0 fails at once
ok   - 4. a tag arrives during the wait and is read by the call in progress
ok   - 5. a tag removed mid-write: the write fails after its time, the tag keeps a half-written message
ok   - 5b. removed and brought back within the call's time: the write is retried and completes
ok   - 6. write too long for the tag: refused before anything is written
ok   - 7. locked tags: read-only capability container, and lock bits the chip enforces
ok   - 8. unformatted (blank) tag: reads and writes fail, no 'not implemented'
ok   - 9. an NDEF message with no text or link record reads as 'holds no text or link'
ok   - 10. text too long to return; a write over 95 bytes is refused, never cut
ok   - 11. write and read back; a link over a text; the device's writes reach the page as events
ok   - 12. content changed from the bench while the tag is near: the next read sees it
ok   - 13. a tag that never answers (muted) is never found; an absent tag neither
ok   - 14. two tags near: the lower id is activated (the antenna sees one)
ok   - 15. tag memory sizes: ultralight, ntag213, ntag215, ntag216 read back and report the model
ok   - 16. nothing left behind: field down, no 'not implemented' log
tags: PASSED (18 checks)
ALL TESTS PASSED
```

## Assumptions

- A tag is activated after two `worker()` calls with the object near (AO_Nfc ticks every 10 ms). The lowest object id wins when
  several are near. A lost tag answers KODE_TIMEOUT to every exchange until a new discovery.
- Emulation stop is asynchronous (20 ms). The text and URI profiles get a derived 7-byte `04..` UID, ATQA 0x0044, SAK 0.
- Type 2 behaves like an NTAG: NAK (KODE_ERROR) past the end, pages 0 and 1 not writable, pages 2 and 3 OR-only,
  LOCKED flag NAKs data pages. Type 4 is served by APDUs (app D2760000850101, CC E103, file E104, 6A82 no app, 6982 locked).
- Mifare: any authenticated key opens data blocks, trailer access bits are not enforced, block 0 and trailers refuse
  writes, key A reads back zeroed.
- Register-level `get()` values and the certification carrier are approximated; `dropAfter(n)` models tearing.

## Doc/code disagreements

- A tag lost during `kode_nfc_write` gives "no NFC tag in N ms" (the SDK retries an empty window), not "the tag could not be written".
- An NDEF-formatted Mifare Classic with a known key is readable and writable; "refused" applies only to unknown keys.
- A CC-read-only tag fails with "this card cannot be written (...)", a chip-locked one with "the tag could not be written".
- "Reader held by another owner" is `kaos_claim`, not a driver condition, so it is not modelled.
- `kode_nfc_scan_start` with no chip reports success (it only raises a flag); `kode_nfc_emulate_start` fails with
  "no NFC reader is fitted, or it would not present the card".
- `kode_error()` points into the task's buffer and is cleared by `kode_print`; the test app runs in an `xTaskCreate` task and copies it.
- Bug found by my own tests and fixed: `parseHex` mis-parsed contiguous hex such as `"A1B2C3D4E5F6"`.

## Shared-file notes for the coordinator

- No shared file was edited. `CONFIG_KODEOS_NFC=y` is global (sdkconfig); adding it forces a full SDK rebuild (~4 min) and
  cut the stub count from 417 to 383. Other areas' seed dirs need `dotbench sdk` once.
- The `nfc` persist region adds about 26 KB; the persist table holds at most 8 regions.
- Harness risk: on a heavily loaded machine, booting a second wasm instance in one Node process sometimes stalls in early boot
  (after `kqp QF up`, reproduced with no NFC state at all). The tests use `bootReady` (bench.mjs), which shuts down and retries a
  stalled boot up to 4 times. Worth a look in `tests/node/harness.mjs`.
