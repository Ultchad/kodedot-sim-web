# dotbench bench objects: specification

Status: draft for review. Scope: the data and behaviour of the bench objects for dotbench (the web test bench that runs unmodified Kode Dot kode-sdk C apps in a browser with fake hardware). No UI visuals are specified here.

## 0. How to read this document

Sources, in the order of authority:

1. **Header** (public API): `kode-sdk/components/kode/include/kode.h` (cited `kode.h:N`), `kode_sys/include/kode_sys.h` (`kode_sys.h:N`), `kqp/include/kqp_signals.h` (`kqp_signals.h:N`), `kdefs/include/kode_defs.h` (status codes). All line numbers are in the pinned kode-sdk checkout.
2. **Example**: `kode-sdk/examples/*` (cited by file name).
3. **Driver / implementation source** (`kdrv/*`, `kode/src/*.c`): NOT public API. Cited only to say what the real hardware path does, and always labelled "(impl.)". The bench is free to differ where the app cannot tell.
4. **Docs**: https://docs.kode.diy pages (sdk, device, internals). Every fact taken from the docs is labelled **(docs)**. The docs were read as summaries only.
5. **Not stated**: anything none of the above gives. Written "not stated", never guessed. Where the bench still needs a value, it appears under Open questions with a recommended default.

Notation: "kode.h call" means the blocking API, legal only in a task; called from an Active Object (AO) or an ISR it fails with `kode_error()` text "was called from an Active Object (...)". "kode_sys call" means the AO API, in three kinds: Command (returns `kode_status_t`, posts to the owner), Request (takes `QActive *me`, returns at once, the answer arrives as a signal; one "door" per request kind per AO; buffers are lent), Immediate (returns a copy, flag or pin).

Signal tables cite `kqp_signals.h:N` at the line where the signal is declared. Payload structs are cited by the line of their closing brace ("closing line").

The API tables are generated from the headers by script: "Wait" is derived from a `ms`-named parameter in the prototype (a header comment may add a fixed wait, mentioned in the section); "Failure value" is derived from the return type plus the convention below; the section text gives header-specific exceptions.

Prototype counts: 170 functions from kode.h (the brief said about 171) and 120 from kode_sys.h are mapped to areas below. Functions that exist outside these two headers are listed in section "Uncovered functions".

## Cross-cutting conventions

### Status and error reporting

- `kode_status_t` (kdefs/include/kode_defs.h): `KODE_OK`=0, `KODE_ERROR`, `KODE_TIMEOUT`, `KODE_DENIED`, `KODE_NO_RESOURCES`, `KODE_IO_ERROR`, `KODE_EXISTS`, `KODE_NOT_DIR`, `KODE_IS_DIR`, `KODE_CANCELLED`.
- kode.h calls report failure with `false`, `""`, `NULL`, `NAN`, `0` or an empty struct, and set a text reason read through `kode_error()` (kode.h:48), which is never NULL. The reason text is English. Reason strings quoted below come from the implementation `kode/src/*.c` (impl.) and are informational, not API; the bench should reproduce them because apps print them, but an app must not branch on them.
- kode_sys calls return `kode_status_t` (Commands) or deliver `rc` in the answer signal (Requests).

### Paths

- kode.h file calls use volumes `sd/...` and `flash/...`: at most 91 bytes (`KODE_FILE_PATH_MAX` 91 at kode.h:420 includes the NUL, as the examples treat it), no leading "/", no "." or ".." part.
- kode_sys uses `/sdcard/...` and `/storage/...`, at most 96 (`KODE_SYS_FILE_PATH_MAX`, kode_sys.h:1167). The mapping between the two is in `kode/src/kode_file.c` (impl.). Docs page sdk/paths covers this **(docs)**.

### Fault injection (applies to every bench object)

Every object below has a "fault" control set (unplugged, busy, radio off, timeout, wrong answer). The spec lists the faults per object; a fault must change only what the app can observe through the API.

### Time model

The bench has one simulated clock source for `kode_uptime_ms` and `kode_sys_time_ms`. Real-time waiting inside kode.h calls (ms parameters) should honour the host clock, with an optional "fast-forward" toggle. This is a recommendation, not stated anywhere.


# Lifecycle and system

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:48 | `const char *kode_error(void);` | no wait parameter | never fails; never NULL |
| kode.h:107 | `const char *kode_device_id(void);` | no wait parameter | n/a |
| kode.h:110 | `void kode_exit(void);` | no wait parameter | n/a (void) |
| kode.h:135 | `uint32_t kode_random(uint32_t min, uint32_t max);` | no wait parameter | n/a |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:267 | `kode_status_t kode_sys_flash(const char *src, const char *dst, bool run);` | Command (posts to owner; returns status) |
| kode_sys.h:593 | `kode_status_t kode_sys_exit_to_os(void);` | Command (posts to owner; returns status) |
| kode_sys.h:616 | `kode_status_t kode_sys_home_defer(void);` | Command (posts to owner; returns status) |
| kode_sys.h:622 | `kode_status_t kode_sys_home_now(void);` | Command (posts to owner; returns status) |
| kode_sys.h:1700 | `const char *kode_sys_device_id(void);` | Immediate (returns a copy, flag or pin) |

### Return values, errors, events and constants

- `kode_error()` (kode.h:48): short English text, "" when none, never NULL; a failed call sets it, a successful one clears it; valid until the task's next kode.h call. kode.h is for tasks: a call from an ISR or an AO is refused and the text says so ("was called from an Active Object (...)").
- `kode_device_id()` (107): the serial, such as "KODE78YR5EEV0XS"; "" when the MAC is unreadable or refused. `kode_exit()` (110): end the app and return to kodeOS; does not return unless refused. `kode_random(min,max)` (135): hardware random number, both ends included; `min` when `max` is below it.
- kode_sys: `kode_sys_device_id` (1700), `kode_sys_flash(src, dst, run)` (267; semantics not summarised from the header), `kode_sys_exit_to_os` (593), `kode_sys_home_defer` (616) and `kode_sys_home_now` (622) (home gesture handling; the matching signals are `BOOT_HOME_DEFER_SIG` and `BOOT_HOME_NOW_SIG`, kqp_signals.h:857-861). `KODE_VERSION_MAJOR` 4 and `KODE_VERSION_MINOR` 0 (kode.h:25-26).
- The manifest macro `KODE_APP_MANIFEST` is in `kapp_desc.h:196` (outside kode.h/kode_sys.h); it describes the app and is read at load.

## 2. Scenarios (Given / When / Then)

1. **Exit.** `kode_exit()` ends the app; the bench shows the launcher.
2. **Wrong context.** Calling a kode.h function from an AO returns the failure value with the "Active Object" reason; the converse (kode_sys from a task) is not covered by the text read; not stated.
3. **Error clearing.** After a failing call then a succeeding call, `kode_error()` is "".
4. **Home gesture.** `kode_sys_home_defer()` postpones the bottom-button home gesture until `kode_sys_home_now()`; not stated further.

## 3. Bench object model
No bench object. Runtime controls: load app, stop app, restart, device ID field (see Time).

## 4. Data formats
Not applicable.

## 5. Open questions
1. **Home gesture semantics** (`home_defer`/`home_now`): the header text was read only in summary. Default: honour defer by ignoring the 3000 ms hold until `home_now`.


# Events

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:266 | `const char *kode_event_ble_connected(void);` | no wait parameter | n/a (event-name constant) |
| kode.h:272 | `const char *kode_event_ble_disconnected(void);` | no wait parameter | n/a (event-name constant) |
| kode.h:278 | `const char *kode_event_ble_written(void);` | no wait parameter | n/a (event-name constant) |
| kode.h:284 | `const char *kode_event_ble_taken(void);` | no wait parameter | n/a (event-name constant) |
| kode.h:290 | `const char *kode_event_ir_received(void);` | no wait parameter | n/a (event-name constant) |
| kode.h:296 | `const char *kode_event_wifi_connected(void);` | no wait parameter | n/a (event-name constant) |
| kode.h:302 | `const char *kode_event_wifi_lost(void);` | no wait parameter | n/a (event-name constant) |
| kode.h:346 | `bool kode_event_add_listener(const char *event, kode_listener_t fn);` | no wait parameter | `false` |
| kode.h:355 | `bool kode_event_remove_listener(const char *event, kode_listener_t fn);` | no wait parameter | `false` |
| kode.h:370 | `bool kode_event_wait(const char *event, uint32_t ms, kode_event_t *out);` | waits up to `ms` | `false` |

### Return values, errors, events and constants

- Event model (kode.h:192-237, 304-370): events are named strings, any case. `kode_event_t` (316-323): `name`, `source`, `value` (int32), `text`, `x`, `y` (touch only). Listeners run one at a time in a listener task, in event order; adding the same pair twice registers it once. `kode_event_wait` waits for an event pushed after the wait began; every waiting task gets it; refused inside a listener; `ms` 0 returns false at once; `KODE_FOREVER` is allowed.
- Constants: `KODE_LISTENERS_MAX` 32 (304), `KODE_EVENT_QUEUE_DEPTH` 16 (305), `KODE_EVENT_NAME_MAX` 32 (306), `KODE_EVENT_SOURCE_MAX` 80 (307), `KODE_EVENT_TEXT_MQTT` 256 and `KODE_EVENT_TEXT_MAX` (308-312; the larger of the MQTT and BLE value limits).
- Event list: `button_<name>_pressed|released|held`, `wifi_connected` and `wifi_lost` (source = network name; no event for a board already online at start), `mqtt_message`, `battery_low` (value = level), `ir_received`, `nfc_tag`, `touch_pressed|moved|released`, `pin_<n>_changed` (n 1 to 14), `ble_connected|disconnected|written|taken`. Per-area details are in each area section.
- An event arrives only from an owner the app links: ten events (ir_received, wifi_connected, wifi_lost, three touch, four Bluetooth) need the matching `KODE_EVENT_*` constant, else the event is refused and `kode_error()` names the constant. The first event call starts the layer's own AO at QP level `KODE_PRIO_USER_GUI` (3), which an app's own AO cannot then take. Refused in the kodeOS image.
- `add_listener` false: bad name, NULL fn, full table, level 3 taken, or refused. `remove_listener` false: not registered, NULL argument or refused.

## 2. Scenarios (Given / When / Then)

1. **Listener.** `kode_event_add_listener("button_top_pressed", cb)`; the user presses top; `cb` runs with name "button_top_pressed", source "top".
2. **Wait.** `kode_event_wait("wifi_connected", 5000, &e)` returns true if the router joins within 5 s, else false.
3. **Wait past event.** An event that happened before the wait began does not count.
4. **Unknown name.** `kode_event_add_listener("bogus", cb)` returns false.
5. **Constant needed.** `kode_event_wait("ir_received", ...)` as a typed string in an app that links no IR owner is refused naming `KODE_EVENT_IR_RECEIVED`.
6. **Listener table full.** The 33rd listener fails.
7. **Pin listening.** Listening to `pin_6_changed` makes pin 6 an input (see Expansion).

## 3. Bench object model
No separate object. Every event comes from its area's object (buttons, touch, router, phone, TV remote, tag, pins, battery). The bench shows an event log.

## 4. Data formats
`kode_event_t` as above; strings valid until the listener returns or the task's next wait.

## 5. Open questions
1. **Event queue overflow** (depth 16): behaviour on overflow is not stated. Default: drop the oldest.


# NFC

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:2114 | `bool kode_nfc_scan_start(void);` | no wait parameter | `false` |
| kode.h:2124 | `bool kode_nfc_scan_stop(void);` | no wait parameter | `false` |
| kode.h:2134 | `kode_tag_t kode_nfc_read_id(uint32_t ms);` | waits up to `ms` | empty struct / zero handle (per header text) |
| kode.h:2149 | `const char *kode_nfc_read(const char *type, uint32_t ms);` | waits up to `ms` | `""` or `NULL` (per header text) |
| kode.h:2162 | `bool kode_nfc_write(const char *type, const char *data, uint32_t ms);` | waits up to `ms` | `false` |
| kode.h:2173 | `bool kode_nfc_emulate_start(const char *profile);` | no wait parameter | `false` |
| kode.h:2179 | `bool kode_nfc_emulate_stop(void);` | no wait parameter | `false` |
| kode.h:2191 | `bool kode_nfc_add_profile(const char *name, const char *type, const char *data);` | no wait parameter | `false` |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:1035 | `kode_status_t kode_sys_nfc_read_tag(QActive *me, uint32_t ms);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1044 | `kode_status_t kode_sys_nfc_ndef_read(QActive *me, uint32_t ms);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1053 | `kode_status_t kode_sys_nfc_ndef_write_uri(QActive *me, const char *uri, uint32_t ms);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1062 | `kode_status_t kode_sys_nfc_ndef_write_text(QActive *me, const char *text, uint32_t ms);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1074 | `kode_status_t kode_sys_nfc_emulate_start(QActive *me, const kode_sys_nfc_card_t *card);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1082 | `kode_status_t kode_sys_nfc_emulate_stop(QActive *me);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1793 | `bool kode_sys_nfc_is_emulating(void);` | Immediate (returns a copy, flag or pin) |

### Return values, errors, events and constants

- Constants (kode.h): `KODE_TAG_ID_MAX` 32 (kode.h:2090), `KODE_TAG_NAME_MAX` 32 (2091), `KODE_NFC_TEXT_MAX` 97 (2092), `KODE_NFC_TAG_DATA_MAX` 95 (2093), `KODE_NFC_PROFILES_MAX` 8 (2094), `KODE_NFC_PROFILE_NAME_MAX` 16 (2095, so 15 characters), `KODE_NFC_BUSY_MS` 5000 (2096). kode_sys: `KODE_SYS_NFC_TEXT_MAX` (kode_sys.h:976, 96 including NUL), `KODE_SYS_NFC_EMU_NDEF_MAX` (980, 96 characters), `KODE_SYS_NFC_UID_MAX` (983, up to 10 bytes: 4, 7 or 10), tag types UNKNOWN 0, T2T 1, T4T 2, MIFARE 3 (986-989). Raw NDEF buffer 140 bytes (kqp_config.h, read earlier).
- `kode_tag_t` holds the ID as hex text with colons ("04:A2:3B:91") and the model name (both from kode.h:2090-2091 sizes). Text and link reads return strings of at most `KODE_NFC_TAG_DATA_MAX` (95) bytes; the `type` argument is "text" or "uri", any case. "There are no profiles to begin with"; a profile with the same name (any case) is replaced; the profile type is "text", "uri" or "uid" (kode.h:2180-2191).
- NDEF status mapping (kode_sys.h:997-1000): `NO_MESSAGE`=`KODE_ERROR`, `LOCKED`=`KODE_DENIED`, `TOO_LONG`=`KODE_NO_RESOURCES`, `LOST`=`KODE_TIMEOUT`. For the "have_tag false" answer: `KODE_TIMEOUT` = no tag in the window, `KODE_DENIED` = reader held by another owner, `KODE_IO_ERROR` = no reader fitted.
- Failure reasons seen in `kode_nfc.c` (impl.): "no NFC tag in N ms" (also for 0 ms: "no NFC tag in 0 ms"); "this card's data cannot be read (<model>)"; "this card cannot be written (<model>)"; "the tag holds no text or link"; "the tag holds a link, not text" / "the tag holds text, not a link"; "the tag's text is too long"; "the tag could not be written"; "the data does not fit on the tag"; "NFC is busy, or no reader is fitted"; "a UID is 4, 7 or 10 bytes of hex, such as 04:A2:3B:91"; "no emulation profile '%s'; add one with kode_nfc_add_profile()"; "all 8 emulation profiles are in use".
- Mutual exclusion (header text): `kode_nfc_read*`, `write*` and `read_id` fail at once while the Dot is emulating; scan start and emulate are mutually exclusive.

### Signals and events

| Signal / event | Payload | When |
|---|---|---|
| `NFC_TAG_SIG` (kqp_signals.h:193) | `NfcTagEvt` (kqp_signals.h:3732, closing line) | One tag activated by the poller (published). |
| `NFC_EMU_SIG` (kqp_signals.h:198) | `NfcEmuEvt` (kqp_signals.h:4159, closing line) | One turn of an emulation window: kinds FIELD, SELECTED, READ, STOPPED, with a `reads` counter. |
| `NFC_READ_RSP_SIG` (kqp_signals.h:1212) | `NfcReadRspEvt` (kqp_signals.h:3756, closing line) | Answer to `kode_sys_nfc_read` (kode_sys.h:1035-1082 block). |
| `NFC_NDEF_RSP_SIG` (kqp_signals.h:1139) | `NfcNdefEvt` (kqp_signals.h:3837, closing line) | Answer to the NDEF read/write requests. |
| `NFC_EMU_RSP_SIG` (kqp_signals.h:1205) | `NfcEmuEvt` (kqp_signals.h:4159, closing line) | Answer to `kode_sys_nfc_emulate_start`. |
| Event `nfc_tag` (kode.h event list, 192-237) | `source` = the card (header; the model name per impl.), `text` = UID | Fires about once a second while a tag stays on the antenna, and also on the app's own reads (impl./header comment). |

## 2. Scenarios (Given / When / Then)

1. **Read a text tag.** Given a tag object of kind "text tag" holding "hello" and placed on the antenna; When the app calls `kode_nfc_read("text", 1000)`; Then it returns "hello", `kode_error()` is unchanged, and an `nfc_tag` event with source "Ultralight / NTAG (Type-2)" and text = the UID has been or will be delivered.
2. **Read a link tag.** Given a link tag with `https://kode.diy`; When `kode_nfc_read("uri", 1000)` runs; Then it returns the URL (stored with prefix code 0x04, "https://"). If the app instead asks for "text", Then it returns "" and `kode_error()` says "the tag holds a link, not text".
3. **No tag.** Given nothing on the antenna; When `kode_nfc_read_id(500)` runs; Then it blocks about 500 ms and returns `ok=false` with "no NFC tag in 500 ms". With `ms`=0 it fails at once with "no NFC tag in 0 ms".
4. **Tag arrives during the wait.** Given nothing placed at call time; When the user places a tag 300 ms into a 1000 ms wait; Then the call returns the data (the poller activates the tag on its next turn).
5. **Card removed mid-operation.** Given a write in progress; When the user removes the tag before it ends; Then the write fails with "the tag could not be written" (kode.h) / `KODE_TIMEOUT` (`NDEF_LOST`, kode_sys.h:1000).
6. **Card that cannot be read.** Given a "card" object whose model is Mifare Classic 1K (card kind); When the app reads text; Then it fails with "this card's data cannot be read (Mifare Classic 1K)". Docs say Mifare Classic 1K is readable only with factory keys **(docs, device/nfc)**; the bench card has a "keys known" flag (see object model).
7. **Write too long.** Given a writable tag with 48 bytes of capacity; When the app writes a 60 byte text with `kode_nfc_write("text", ..., ms)`; Then it fails with "the data does not fit on the tag" and nothing is written (header: "Nothing is written if it does not fit") (kode_sys: `KODE_NO_RESOURCES`).
8. **Locked tag.** Given a read-only tag (CC[3] low nibble not 0); When the app writes; Then `NDEF_LOCKED` = `KODE_DENIED`.
9. **Unformatted tag.** Given a blank tag (CC[0] not 0xE1); When the app reads text; Then it fails with "the tag holds no text or link"; in kode_sys `KODE_ERROR` (`NDEF_NO_MESSAGE`).
10. **Text too long to return.** Given a tag whose text is longer than `KODE_NFC_TAG_DATA_MAX` (95 bytes); When read; Then it returns "" with "the tag's text is too long" (header: fails also for "a longer message"). A `kode_nfc_write` data argument over 95 bytes is refused, never cut.
11. **Dot emulates a card.** Given the "reader" object and a profile added by `kode_nfc_add_profile(name, "uid"|"text"|"uri", data)`; When the app calls `kode_nfc_emulate_start(name)`; Then the reader object sees the profile: a "uid" profile clones UID, ATQA and SAK verbatim; a text or uri profile presents a synthesised 7-byte Type-2 tag with SAK 0x00. The app receives FIELD, SELECTED, READ, STOPPED turns as the reader acts.
12. **Emulation while reading.** Given emulation running; When the app calls `kode_nfc_read_id`; Then it fails at once (mutual exclusion). `kode_nfc_emulate_start` while `kode_nfc_scan_start` reads is refused (kode.h:2173 comment). A second `kode_nfc_scan_start` does nothing and answers true; a tag left on the antenna is heard once a second.
13. **Radio / reader missing.** Given the reader fault "not fitted"; When any NFC call runs; Then kode.h fails with "NFC is busy, or no reader is fitted" and `kode_sys` returns `KODE_IO_ERROR`. Given the fault "reader held"; Then `KODE_DENIED` (kode_sys.h NFC block 1035-1082).
14. **Profile limits.** Given 8 profiles; When the app adds a ninth; Then it fails with "all 8 emulation profiles are in use". A 12-byte UID fails with "a UID is 4, 7 or 10 bytes of hex, such as 04:A2:3B:91".

## 3. Bench object model

All objects below are editable while the app runs. "Placed" means the user has put the object on the antenna (a boolean action); only one tag or card can be placed at a time (the antenna sees one tag; multi-tag collision handling is not stated).

### 3.1 NFC tag (text or link)

| Field | Type | Range | Default |
|---|---|---|---|
| name | string | free | "Tag 1" |
| uid | hex bytes | 4, 7 or 10 bytes | 7 bytes, `04:A2:3B:91:5C:6D:80` |
| type | enum | Type-2 (NTAG/Ultralight) | Type-2 |
| content kind | enum | text, link, empty | text |
| text | string | up to 95 bytes of data (`KODE_NFC_TAG_DATA_MAX`) | "hello" |
| language | string | not stated beyond default | "en" (impl.) |
| link | string | URI with prefix compression | `https://kode.diy` |
| capacity bytes | int | not stated per model | 144 (assumption, see Open questions) |
| locked | bool | | false |
| unformatted | bool | | false |

Actions: place on antenna, remove, toggle locked, rewrite content.
Displays back: the current NDEF content after an app write, the write counter, whether it is placed.

### 3.2 NFC card

| Field | Type | Range | Default |
|---|---|---|---|
| name | string | | "Card 1" |
| model | enum | Mifare Classic 1K, Mifare Classic 4K, Mifare Mini, Type-4 (ISO-DEP / DESFire), NFC-A | Mifare Classic 1K |
| uid | hex bytes | 4, 7 or 10 | 4 bytes |
| atqa, sak | bytes | derived from model; editable | per model |
| keys known | bool | | false |

The model name the app sees is derived from SAK (impl., `knfc_tag.c`): SAK&0x20 gives "Type-4 (ISO-DEP / DESFire)", 0x00 "Ultralight / NTAG (Type-2)", 0x09 "Mifare Mini", 0x08 or 0x88 "Mifare Classic 1K", 0x18 or 0x98 "Mifare Classic 4K", 0x01 "Mifare Classic 1K (TNP3xxx)", other SAK&0x08 "Mifare Classic", otherwise "NFC-A". Tag type constants follow SAK: bit 3 gives MIFARE, bit 6 UNKNOWN, bit 5 T4T (overrides), default T2T.

### 3.3 NFC reader (the Dot emulates a card)

| Field | Type | Range | Default |
|---|---|---|---|
| present | bool | | true |
| held by another owner | bool | | false |
| auto-select | bool | | true |
| sequence | enum | field on only, select, read | read |

Displays back: whether the field is on, the UID/ATQA/SAK it saw, the NDEF it read (text or URI), the number of reads (the `reads` counter).

## 4. Data formats the fake driver must speak

- UID: 4, 7 or 10 bytes. ID text "04:A2:3B:91" (kode.h:2090).
- Type-2 memory: capability container CC[0]=0xE1 (magic), CC[2] size in 8-byte units, CC[3] low nibble 0 means writable (impl., `knfc_ndef.h`); unformatted tag = no message.
- NDEF TLV: tag 0x03, one-byte length (message at most 254 bytes), terminator 0xFE; NDEF buffer at most 480 bytes (impl.).
- Subset the driver speaks: first URI record ('U') or Text record ('T'); other records are skipped; UTF-16 text is skipped. Text default language "en". Write prefix codes: 0x02 "https://www.", 0x01 "http://www.", 0x04 "https://", 0x03 "http://", 0x06 "mailto:", 0x05 "tel:". The read table carries the full NFC Forum list (impl.).
- Type-4: NDEF application AID D2760000850101, capability container file E103 (impl.).
- Emulation: "uid" profile clones UID, ATQA, SAK; text/uri profile gives a 7-byte Type-2 tag with SAK 0x00 (impl.).

## 5. Open questions

1. **Emulation supported?** The docs say emulation is "Not supported on this board" because the antenna board does not route the pins **(docs, device/nfc)**, but the headers (kode_sys.h NFC block, kode.h profiles) and firmware support it. Recommended default: implement per the headers, with a bench setting "emulation hardware present" defaulting to on.
2. **Tag memory sizes per model** are not stated. Recommended default: NTAG215-like 504 usable bytes for Type-2 but cap by the 480-byte NDEF buffer; flag as assumption.
3. **Multiple tags on the antenna**: not stated. Default: only one placed object at a time.
4. **Delay between "place" and the first successful read**: not stated. Default 100 ms, with `nfc_tag` cadence 1 s while placed.
5. **Mifare Classic data**: header only exposes ID and model for cards that cannot be read. Default: cards never yield text; only the ID read works.


# RFID

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:2208 | `kode_tag_t kode_rfid_read_id(uint32_t ms);` | waits up to `ms` | empty struct / zero handle (per header text) |
| kode.h:2219 | `bool kode_rfid_write(const char *id, uint32_t ms);` | waits up to `ms` | `false` |
| kode.h:2229 | `bool kode_rfid_emulate_start(const char *id);` | no wait parameter | `false` |
| kode.h:2235 | `bool kode_rfid_emulate_stop(void);` | no wait parameter | `false` |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:1111 | `kode_status_t kode_sys_rfid_read(QActive *me, uint32_t ms);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1120 | `kode_status_t kode_sys_rfid_write(QActive *me, const uint8_t id[KODE_SYS_RFID_ID_BYTES], uint32_t ms);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1130 | `kode_status_t kode_sys_rfid_emulate_start(QActive *me, const uint8_t id[KODE_SYS_RFID_ID_BYTES]);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1139 | `kode_status_t kode_sys_rfid_emulate_stop(QActive *me);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1799 | `bool kode_sys_rfid_is_emulating(void);` | Immediate (returns a copy, flag or pin) |

### Return values, errors, events and constants

- Constants: `KODE_RFID_BUSY_MS` 5000 (kode.h:2197); `KODE_SYS_RFID_ID_BYTES` 5 (kode_sys.h:1092). `kode_rfid_write` accepts ID separators ':', '-' or ' ' and at most 60 s of field time (kode.h:2208-2235 block).
- Reasons (impl.): "no RFID tag in N ms", "an EM4100 ID is 5 bytes ('%s')", "RFID is busy", "the RFID front end did not answer".
- `RFID_OP_RSP_SIG` rc values (impl./header): read OK or TIMEOUT; write OK when the read-back matched, else TIMEOUT; DENIED when busy. A missing front end is not detected: a read simply times out.

### Signals and events

| Signal | Payload | When |
|---|---|---|
| `RFID_TAG_SIG` (kqp_signals.h:205) | `RfidTagEvt` (kqp_signals.h:4241, closing line) | One EM4100 ID decoded inside a read window (published). |
| `RFID_OP_RSP_SIG` (kqp_signals.h:1227) | `RfidTagEvt` (kqp_signals.h:4241, closing line) | Answer to read/write requests (kode_sys.h:1111-1139). |
| `RFID_EMU_RSP_SIG` (kqp_signals.h:1269) | `RfidEmuRspEvt` (kqp_signals.h:4425, closing line) | Answer to the emulate request; `kode_sys_rfid_is_emulating` (kode_sys.h:1799) is the immediate state. |

## 2. Scenarios (Given / When / Then)

1. **Read an EM4100 card.** Given an EM4100 card with ID 01:02:03:04:05 placed on the door reader; When the app calls `kode_rfid_read_id(ms)`; Then it returns `ok=true` with the tag with ID "01:02:03:04:05" and name "EM4100".
2. **No card.** Given nothing placed; When `kode_rfid_read_id(1000)` runs; Then `ok=false` and `kode_error()` is "no RFID tag in 1000 ms". With `ms`=0 it looks for none.
3. **Write a T5577.** Given a blank T5577 placed; When the app calls `kode_rfid_write("01:02:03:04:05", ms)`; Then the driver writes three blocks (config, then two 32-bit halves) and reads back; Then it reports success and the tag now answers as EM4100 with that ID.
4. **Write verify fails.** Given a T5577 the user removes mid-write (or marks "write protected"); When write runs; Then read-back does not match and the call fails (`RFID_OP_RSP_SIG` TIMEOUT).
5. **Write to an EM4100 card.** Given a non-rewritable EM4100 card; When write runs; Then it cannot match the read-back and fails (the bench card "writable" flag is false).
6. **Bad ID.** Given any state; When the app writes "01:02:03"; Then it fails with "an EM4100 ID is 5 bytes ('01:02:03')".
7. **Busy.** Given another read in progress; When a second request arrives; Then kode_sys answers DENIED, kode.h fails with "RFID is busy".
8. **Reader fault.** Given the reader fault "front end not answering"; When read runs; Then it times out (the driver cannot tell missing from absent card) or fails with "the RFID front end did not answer".
9. **Emulate a card on the door reader.** Given the app called `kode_rfid_emulate_start("01:02:03:04:05")` (takes the ID directly, no profile; a tag already played is replaced); When the door reader object polls; Then it decodes the ID and shows it; `kode_sys_rfid_is_emulating` reports true until stopped.

## 3. Bench object model

### 3.1 EM4100 card (read-only)

| Field | Type | Range | Default |
|---|---|---|---|
| name | string | | "Fob 1" |
| id | 5 bytes | 40 bits | 01:02:03:04:05 |
| rf divider | enum | RF/16, RF/32, RF/64 | RF/64 |

### 3.2 T5577 tag (rewritable)

| Field | Type | Range | Default |
|---|---|---|---|
| id | 5 bytes | | 00:00:00:00:00 (blank) |
| modulation configured as EM4100 | bool | | false until written |
| write protected | bool | | false |

### 3.3 Door reader

| Field | Type | Default |
|---|---|---|
| expected ID | 5 bytes | 01:02:03:04:05 |
| shows | last ID seen, match yes/no, read count | |

Actions: place or remove a card, set the reader fault. The reader accepts when the decoded ID equals the expected ID (the door's behaviour beyond this is not stated).

## 4. Data formats the fake driver must speak

- ID: 5 bytes (40 bits, MSB nibble first), shown "01:02:03:04:05" (impl., `krfid_em4100.h`).
- Frame: 9 header ones, ten rows of 4 data bits plus even row parity, four column parities, zero stop bit: 64 bits (impl.). RF/16, RF/32 or RF/64 is reported as `rf_div`.
- T5577 write: config block, then two 32-bit data halves, read-back verify; the write boosts VO4 to 3.3 V (impl.).
- Frequency 125 kHz: stated by the area name in the brief; the header text does not restate it.

## 5. Open questions

1. **Clock/bit timing is not API-visible.** Default: the bench synthesises decoded IDs, not waveforms.
2. **Other 125 kHz formats (HID, Indala)**: not stated. Default: EM4100 only.
3. **Time from placing to first decode**: not stated. Default 200 ms.
4. **Door semantics** beyond matching an ID: not stated. Default: only a match indicator.


# Wi-Fi

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:1057 | `bool kode_wifi_connect(const char *ssid, const char *password);` | no wait parameter | `false` |
| kode.h:1063 | `bool kode_wifi_is_connected(void);` | no wait parameter | `false` |
| kode.h:1069 | `bool kode_wifi_disconnect(void);` | no wait parameter | `false` |
| kode.h:1104 | `int kode_wifi_scan(kode_wifi_network_t *out, size_t cap);` | no wait parameter | `0` (per header text) |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:351 | `kode_status_t kode_sys_wifi_connect(const char *ssid, const char *pass);` | Command (posts to owner; returns status) |
| kode_sys.h:357 | `kode_status_t kode_sys_wifi_disconnect(void);` | Command (posts to owner; returns status) |
| kode_sys.h:1513 | `kode_status_t kode_sys_wifi_scan(QActive *me);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1569 | `kode_status_t kode_sys_wifi_frames(QActive *me, bool on, uint8_t channel);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1916 | `kode_status_t kode_sys_wifi_status(kode_sys_wifi_status_t *out);` | Command (posts to owner; returns status) |

### Return values, errors, events and constants

- Constants: `KODE_WIFI_CONNECT_MS` 30000 (kode.h:1043); `KODE_WIFI_LEAVE_MS` 5000 (1044); `KODE_WIFI_SCAN_MS` 110000 (1071, the ceiling; a scan takes about 38 s in practice, impl.); `KODE_WIFI_SSID_MAX` 33 (1072, 32 characters); `KODE_SYS_WIFI_SSID_MAX` 33 and `KODE_SYS_WIFI_PASS_MAX` 65 (kode_sys.h:341-342, password up to 64 bytes); `KODE_SYS_WIFI_SCAN_MAX` 24 (1483).
- kode_wifi_network_t: ssid[33], int8 rssi, uint8 channel, bool open (kode.h:1057-1104 block). The scan returns strongest first. `WifiScanEntryEvt` adds `authmode` (0 means open) and `bssid[6]`.
- Wi-Fi state (kode_sys.h:1896-1899): IDLE 0, CONNECTING 1, GOT_IP 2, DISCONNECTED 3; read with `kode_sys_wifi_status` (kode_sys.h:1916).
- `kode_sys_wifi_frames` takes channel 1..177, or 0 for the current one (kode_sys.h:1569).
- Newest request wins: an older request answers `KODE_CANCELLED`. Radio busy answers `KODE_NO_RESOURCES` (ask again).
- Reasons (impl.): "could not join '%s': wrong password or out of range", "no address from '%s' within N s", "bad network name", "password too long".
- Events: `wifi_connected`, `wifi_lost` (kode.h:296, 302). No event fires for a board that is already online at app start (header text).

### Signals and events

| Signal | Payload | When |
|---|---|---|
| `WIFI_STATE_SIG` (kqp_signals.h:236) | `WifiStateEvt` (kqp_signals.h:5343, closing line) | Where the connection stands (state change). |
| `WIFI_SCAN_ENTRY_SIG` (kqp_signals.h:238) | `WifiScanEntryEvt` (kqp_signals.h:4787, closing line) | One network found. |
| `WIFI_SCAN_END_SIG` (kqp_signals.h:241) | `WifiScanEndEvt` (kqp_signals.h:4821, closing line) | Last network of the scan. |
| `WIFI_SAVED_ENTRY_SIG` (kqp_signals.h:244) | `WifiSavedEvt` (kqp_signals.h:5318, closing line) | One remembered network. |
| `RADIO_STATE_SIG` (kqp_signals.h:230) | `RadioStateEvt` (kqp_signals.h:4600, closing line) | The C5 link's state (docs: the ESP32-C5 handles Wi-Fi, BLE and IR). |
| `WIFI_LOST_SIG` (kqp_signals.h:1515) | `WifiStateEvt` (kqp_signals.h:5343, closing line) | The link was lost. |

## 2. Scenarios (Given / When / Then)

1. **Scan.** Given routers "Home" (-48 dBm, ch 6, WPA2) and "Guest" (-70, ch 1, open); When `kode_wifi_scan` runs; Then it returns both, strongest first, `open` false for Home, true for Guest, after a simulated delay (about 38 s on hardware; the bench may shorten it).
2. **Join with the right password.** Given router "Home" with password "secret123" and internet; When `kode_wifi_connect("Home","secret123")`; Then it returns true within 30 s, `wifi_connected` fires, and later HTTP calls work.
3. **Wrong password.** Given the same router; When the app uses "wrong"; Then it fails with "could not join 'Home': wrong password or out of range".
4. **Out of range.** Given a router with `in range` off; When the app joins; Then the same reason text is produced (the driver does not distinguish).
5. **Joined, no internet.** Given a router with internet off; When the app joins; Then the join succeeds (address assigned) but HTTP, ping and MQTT fail (see Network).
6. **No address.** Given a router with DHCP fault; When joining; Then it fails with "no address from 'Home' within 30 s".
7. **Connection lost.** Given a connected app; When the user powers the router off; Then `wifi_lost` fires and `kode_sys_wifi_status` becomes DISCONNECTED.
8. **Bad inputs.** When the SSID is empty or over 32 bytes: "bad network name"; password over 64 bytes: "password too long".
9. **Newest wins.** Given a scan in progress; When the app starts a second request in the same AO door; Then the first answers `KODE_CANCELLED`.
10. **Radio busy at boot.** Given the boot autojoin round is running; When the app scans at once; Then it fails with a "busy" answer and works if asked again (headers describe this, kode_sys.h BLE notes; Wi-Fi equivalent `KODE_NO_RESOURCES`).
11. **Radio off.** Given the C5 link fault "down"; When any Wi-Fi call runs; Then it fails (link-down gives timeout or DENIED, impl. via IR/radio text).

## 3. Bench object model

### 3.1 Wi-Fi router

| Field | Type | Range | Default |
|---|---|---|---|
| ssid | string | 1 to 32 bytes | "DotLab" |
| password | string | up to 64 bytes; empty means open | "dotbench1" |
| security | enum | open, password protected | password protected (see Open questions for WPA2/WPA3) |
| bssid | 6 bytes | | generated |
| channel | int | 1 to 177 are accepted by `kode_sys_wifi_frames`; real 2.4 GHz range not stated | 6 |
| signal strength | int8 dBm | not stated | -50 |
| in range | bool | | true |
| internet | bool | | true |
| dhcp works | bool | | true |
| latency | ms | | 20 |

Actions: power on or off, change password, toggle internet, drag signal strength.
Displays back: whether the Dot is joined, its address (the `NetInfoEvt` holds addresses), connected duration.

## 4. Data formats the fake driver must speak

- Scan entry: `ssid` (up to 32 bytes), `rssi` int8, `channel` uint8, `open` bool; `authmode` 0 = open; `bssid[6]`.
- Status: the four states above.
- Wi-Fi frames (kode_sys.h:1569): sniffer-style `WifiFrameEvt`; the bench may return no frames. Not stated what an app does with them.

## 5. Open questions

1. **Security modes beyond open vs not-open**: not stated. Default: enum {open, WPA2, WPA3}; the join succeeds when the password matches; flag as an assumption.
2. **Scan duration**: 38 s (impl.) makes tests slow. Default: 1.5 s simulated, with a "realistic timing" toggle.
3. **Saved networks**: `WifiSavedEvt` exists, but how an app writes them is not in kode.h. Default: the bench lists remembered networks only after a successful join.
4. **Rate limits / RSSI noise**: not stated. Default: fixed RSSI plus the user-set value.


# Network

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:1409 | `const char *kode_http_get(const char *url);` | no wait parameter | `""` or `NULL` (per header text) |
| kode.h:1421 | `const char *kode_http_post(const char *url, const char *body);` | no wait parameter | `""` or `NULL` (per header text) |
| kode.h:1451 | `bool kode_http_get_range(const char *url, kode_http_off_t offset, void *buf, uint32_t cap, uint32_t *got, kode_http_off_t *total);` | no wait parameter | `false` |
| kode.h:1459 | `uint16_t kode_http_status(void);` | no wait parameter | `0` (per header text) |
| kode.h:1490 | `kode_net_ping_t kode_net_ping(const char *host, uint32_t count);` | no wait parameter | empty struct / zero handle (per header text) |
| kode.h:1498 | `bool kode_net_resolve(const char *host, uint32_t *ip4);` | no wait parameter | `false` |
| kode.h:1508 | `bool kode_udp_send(const char *host, uint16_t port, const void *data, uint32_t len);` | no wait parameter | `false` |
| kode.h:1525 | `bool kode_mqtt_connect(const char *uri);` | no wait parameter | `false` |
| kode.h:1533 | `bool kode_mqtt_publish(const char *topic, const char *text);` | no wait parameter | `false` |
| kode.h:1540 | `bool kode_mqtt_subscribe(const char *topic);` | no wait parameter | `false` |
| kode.h:1548 | `bool kode_mqtt_unsubscribe(const char *topic);` | no wait parameter | `false` |
| kode.h:1556 | `bool kode_mqtt_is_connected(void);` | no wait parameter | `false` |
| kode.h:1562 | `bool kode_mqtt_disconnect(void);` | no wait parameter | `false` |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:296 | `kode_status_t kode_sys_mqtt_connect(const char *uri, const char *user, const char *pass);` | Command (posts to owner; returns status) |
| kode_sys.h:303 | `kode_status_t kode_sys_mqtt_disconnect(void);` | Command (posts to owner; returns status) |
| kode_sys.h:314 | `kode_status_t kode_sys_mqtt_publish(const char *topic, const void *data, uint16_t len);` | Command (posts to owner; returns status) |
| kode_sys.h:329 | `kode_status_t kode_sys_mqtt_subscribe(const char *topic);` | Command (posts to owner; returns status) |
| kode_sys.h:337 | `kode_status_t kode_sys_mqtt_unsubscribe(const char *topic);` | Command (posts to owner; returns status) |
| kode_sys.h:1330 | `kode_status_t kode_sys_net_lookup(QActive *me, const char *host);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1340 | `kode_status_t kode_sys_net_ping(QActive *me, const char *host, uint8_t count);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1352 | `kode_status_t kode_sys_http_get(QActive *me, const char *url, void *buf, uint32_t cap);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1376 | `kode_status_t kode_sys_http_get_range(QActive *me, const char *url, kode_http_off_t offset, void *buf, uint32_t cap);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1419 | `kode_status_t kode_sys_http_get_file(QActive *me, const char *url, const char *path);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1429 | `kode_status_t kode_sys_http_file_stop(QActive *me);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1443 | `kode_status_t kode_sys_http_post(QActive *me, const char *url, const void *body, uint32_t len, const char *ctype, void *buf, uint32_t cap);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1456 | `kode_status_t kode_sys_udp_send(QActive *me, const char *host, uint16_t port, const void *data, uint16_t len);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1866 | `bool kode_sys_mqtt_is_connected(void);` | Immediate (returns a copy, flag or pin) |
| kode_sys.h:1894 | `kode_status_t kode_sys_mqtt_status(kode_sys_mqtt_status_t *out);` | Command (posts to owner; returns status) |

### Return values, errors, events and constants

- Constants (kode.h): `KODE_HTTP_BODY_MAX` 65536 (1395); `KODE_HTTP_URL_MAX` 256 (1396); `KODE_NET_HOST_LIMIT` 63 (1466); `KODE_PING_COUNT_MAX` 10 (1467); `KODE_UDP_DATA_MAX` 65535 (1468); `KODE_MQTT_WAIT_MS` 20000 (1514); `KODE_MQTT_BUSY_MS` 5000 (1515); `KODE_MQTT_URI_LIMIT` 95 (1516); `KODE_MQTT_TOPIC_LIMIT` 79 (1517); `KODE_MQTT_TEXT_LIMIT` 240 (1518). kode_sys: host 64 (`KODE_SYS_NET_HOST_MAX`, kode_sys.h:1301), URL 80 for `kode_sys_http_get` (1303), content type 48 (1305), ping 10 (1307), file URL 256 (1380).
- HTTP: redirects are not followed (301/302 come back as the answer); 404 is not a failure (the call succeeds with status 404); body over 64 KiB fails with "the answer is over 64 KiB" (impl.). `kode_http_get_range` (kode.h:1451) returns true whenever the server answered and `kode_http_status()` (kode.h:1459) says what the buffer holds: 206 = bytes from offset; 200 = resource from byte 0, used only when offset is 0 (for a later offset a 200 leaves `got` 0); 416 = offset past the end; any other status leaves `got` 0. `total` is filled for 206 and 416. `kode_http_status()` returns 0 when no request was made or the last one failed before an answer. `kode_sys_http_get_file` (kode_sys.h:1419) resumes a download to a file. POST sends `application/json` if the first non-space character is `{` or `[`, else `text/plain` (impl.).
- Ping: 1 to 10 echoes at one per second. `kode_net_ping_t`: ok, sent, received, min_ms, avg_ms, max_ms. A host that never answers gives `ok=true` with `received=0`.
- UDP: payload up to 65535 bytes; host up to 63 bytes; port above 0.
- MQTT: subscribe is QoS 0. States: DOWN 0, CONNECTING 1, UP 2; errors NONE 0, NO_NET 1, REFUSED 2, TIMEOUT 3, BUSY 4 (BUSY = the Kode channel holds the client) (kode_sys.h:1868-1876). kode_sys connect carries user and password; payload is cut to 240 bytes. Event `mqtt_message`: `source` = topic, `text` = payload, `value` = length; `MqttMsgEvt` has `topic_cut`, `data_cut`, `retained` flags.
- kode_sys answers: `KODE_IO_ERROR` = no network, `KODE_DENIED` = worker busy, `KODE_ERROR` = unresolved name or refusal, `KODE_TIMEOUT` = past the guard.
- Reasons (impl.): "no network: call kode_wifi_connect() first", "%s does not resolve", "the answer is over 64 KiB", "not connected: call kode_mqtt_connect() first", "the broker refused".

### Signals and events

| Signal | Payload | When |
|---|---|---|
| `NET_PING_ENTRY_SIG` (kqp_signals.h:271) | `NetPingEntryEvt` (kqp_signals.h:5366, closing line) | One echo's outcome. |
| `NET_PING_END_SIG` (kqp_signals.h:276) | `NetPingEndEvt` (kqp_signals.h:5385, closing line) | Ping summary. |
| `NET_HTTP_DATA_SIG` (kqp_signals.h:279) | `NetHttpDataEvt` (kqp_signals.h:5407, closing line) | A slice of a response body. |
| `NET_HTTP_DONE_SIG` (kqp_signals.h:281) | `NetHttpDoneEvt` (kqp_signals.h:5425, closing line) | Status, lengths, truncation flag. |
| `NET_UDP_DONE_SIG` (kqp_signals.h:283) | `NetUdpDoneEvt` (kqp_signals.h:5441, closing line) | Datagram sent or not. |
| `NET_INFO_SIG` (kqp_signals.h:285) | `NetInfoEvt` (kqp_signals.h:5536, closing line) | Board addresses and network state. |
| `MQTT_STATE_SIG` (kqp_signals.h:287) | `MqttStateEvt` (kqp_signals.h:5574, closing line) | MQTT client state. |
| `HTTP_FILE_PROGRESS_SIG`, `HTTP_FILE_RSP_SIG` | `HttpFileEvt` (kqp_signals.h:2700, closing line) | Download-to-file progress and result (kode_sys.h:1419). |
| Event `mqtt_message` | `MqttMsgEvt` | A subscribed message arrived. |

## 2. Scenarios (Given / When / Then)

1. **GET a page.** Given Wi-Fi joined and a "server" mapped for `http://bench.test/hello` returning 200 "hi"; When `kode_http_get(url)`; Then it returns "hi" and `kode_http_status()` is 200. The returned text stays valid until the task's next get or post.
2. **404 and redirect.** Given a path configured 404; Then the body comes back and `kode_http_status()` says 404 (header: not a failure). Given a path configured 302; Then the answer is the 302 itself (not followed).
3. **No network.** Given Wi-Fi not joined; When any HTTP, ping, UDP or MQTT call runs; Then it fails with "no network: call kode_wifi_connect() first" (kode_sys: `KODE_IO_ERROR`).
4. **Unresolvable host.** Given an unmapped host; Then "%s does not resolve" (kode_sys: `KODE_ERROR`).
5. **Timeout.** Given a server fault "never answers"; Then the call fails after its wait; kode_sys answers `KODE_TIMEOUT` after the guard.
6. **Oversize body.** Given a response of 70000 bytes; Then it fails with "the answer is over 64 KiB".
7. **Range and resume.** Given a file server honouring Range; When the app loops `kode_http_get_range` appending to a file; Then the replies are 206 until the end, then 416 past the end. Given a server that ignores ranges: 200 at offset 0, `got` 0 at a later offset.
8. **Ping.** Given host answering with 20 ms; When the app pings 4 times; Then 4 sent, 4 received, min/avg/max near 20. A silent host gives `ok=true`, `received=0`.
9. **UDP send.** Given a UDP sink at host:port; When the app sends; Then the sink records the datagram. Over 65535 bytes, or port 0, or a host over 63 bytes, fail.
10. **MQTT happy path.** Given a broker object; When the app connects, subscribes to `bench/in`, and the user publishes "on" on that topic; Then `mqtt_message` fires with source `bench/in`, text "on", value 2. App publishes appear in the broker log.
11. **MQTT refused / wrong credentials.** Given broker fault "refuse"; Then connect fails with "the broker refused" (state error REFUSED).
12. **MQTT not connected.** When the app publishes before connecting; Then "not connected: call kode_mqtt_connect() first".
13. **MQTT busy.** Given the Kode channel holds the client; Then error BUSY.
14. **Limits.** URI over 95, topic over 79, text over 240: refused (kode.h) or cut (kode_sys payload to 240; `topic_cut`/`data_cut` on receive).

## 3. Bench object model

The brief lists the router (Wi-Fi) as the only network bench object. Servers behind it must be defined by the user for tests to be useful; this section defines them as "router services" (not in the approved list, flagged in Open questions).

### 3.1 Router internet gateway (part of the router)

| Field | Type | Default |
|---|---|---|
| internet | bool | true |
| DNS entries | list host -> address | empty |
| latency | ms | 20 |
| packet loss | percent | 0 |

### 3.2 HTTP route table (router service)

| Field | Type | Default |
|---|---|---|
| host, path, method | string | |
| status | int | 200 |
| content type | string | text/plain |
| body | bytes | |
| delay | ms | 0 |
| honour Range | bool | true |

### 3.3 MQTT broker (router service)

| Field | Type | Default |
|---|---|---|
| host:port | string | broker.test:1883 |
| accept credentials | list | any |
| retained messages | list | empty |
Actions: publish to a topic, kill the broker. Displays: connected client, subscriptions, published messages.

### 3.4 UDP sink (router service)
Fields: host, port. Displays: received datagrams (hex and text).

## 4. Data formats

- HTTP is a plain request/response model: status int, content-type text (up to 48 chars), body up to 64 KiB. In the browser the bench is subject to CORS (design doc); real internet hosts may fail; recommended default is bench-defined routes only.
- MQTT: URI `mqtt://host[:port]` or `mqtts://host[:port]` up to 95 bytes (kode.h:1525 comment); `kode_mqtt_connect` has no user/password parameter (those exist only in `kode_sys_mqtt_connect`); topics up to 79 bytes, payload up to 240 bytes. The browser path uses a WebSocket (design doc, stage 3).
- UDP over the browser: not possible directly (design doc names WebSocket for MQTT only); the sink is virtual.

## 5. Open questions

1. **Services beyond the approved router.** HTTP, MQTT, UDP need servers. Default: router services defined above, plus an optional passthrough to the real network for HTTP (subject to CORS).
2. **MQTT URI schemes**: header states `mqtt://host[:port]` or `mqtts://host[:port]` (kode.h:1525 comment). Default: both accepted, TLS not simulated.
3. **TLS errors** (certificates): not stated. Default: no TLS faults.
4. **kode_sys HTTP URL limit 80 vs 256**: reproduce both limits.


# Bluetooth LE

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:1135 | `bool kode_ble_set_name(const char *name);` | no wait parameter | `false` |
| kode.h:1147 | `bool kode_ble_set_manufacturer_data(const uint8_t *data, size_t len);` | no wait parameter | `false` |
| kode.h:1175 | `int kode_ble_scan(kode_ble_device_t *out, size_t cap, uint32_t ms);` | waits up to `ms` | `0` (per header text) |
| kode.h:1302 | `bool kode_ble_service_select(const kode_ble_service_t *service);` | no wait parameter | `false` |
| kode.h:1332 | `bool kode_ble_set_value(const char *chr, const void *data, size_t len);` | no wait parameter | `false` |
| kode.h:1351 | `bool kode_ble_notify(const char *chr, const void *data, size_t len);` | no wait parameter | `false` |
| kode.h:1367 | `bool kode_ble_queue_push(const char *chr, const void *data, size_t len);` | no wait parameter | `false` |
| kode.h:1380 | `size_t kode_ble_queue_room(const char *chr);` | no wait parameter | `0` (per header text) |
| kode.h:1388 | `bool kode_ble_queue_clear(const char *chr);` | no wait parameter | `false` |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:379 | `kode_status_t kode_sys_ble_set_name(const char *name);` | Command (posts to owner; returns status) |
| kode_sys.h:389 | `kode_status_t kode_sys_ble_set_data(const uint8_t *data, size_t len);` | Command (posts to owner; returns status) |
| kode_sys.h:414 | `kode_status_t kode_sys_ble_set_value(const char *chr, const void *data, size_t len);` | Command (posts to owner; returns status) |
| kode_sys.h:428 | `kode_status_t kode_sys_ble_notify(const char *chr, const void *data, size_t len);` | Command (posts to owner; returns status) |
| kode_sys.h:445 | `kode_status_t kode_sys_ble_queue_push(const char *chr, const void *data, size_t len);` | Command (posts to owner; returns status) |
| kode_sys.h:453 | `kode_status_t kode_sys_ble_queue_clear(const char *chr);` | Command (posts to owner; returns status) |
| kode_sys.h:1624 | `kode_status_t kode_sys_ble_scan(QActive *me, uint32_t ms);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1675 | `kode_status_t kode_sys_ble_heard(QActive *me, bool on);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1925 | `bool kode_sys_ble_enabled(void);` | Immediate (returns a copy, flag or pin) |
| kode_sys.h:2066 | `kode_status_t kode_sys_ble_subscribe(QActive *me);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:2075 | `bool kode_sys_ble_service_fault(char *why, size_t cap);` | Immediate (returns a copy, flag or pin) |
| kode_sys.h:2090 | `kode_status_t kode_sys_ble_service_select(const kode_sys_ble_service_t *svc);` | Command (posts to owner; returns status) |
| kode_sys.h:2104 | `kode_status_t kode_sys_ble_queue_room(const char *chr, size_t *room);` | Command (posts to owner; returns status) |

### Return values, errors, events and constants

- Role (kode.h:1135-1388): the blocking API is peripheral/GATT-server oriented. The Dot serves one app service (`KODE_BLE_SERVICE`) and the phone is the central. **There is no central/connect API**: nothing lets an app connect to a sensor peripheral. A sensor can only be observed by scanning (`kode_ble_scan`, `kode_sys_ble_scan`, `kode_sys_ble_heard`).
- Constants: `KODE_BLE_NAME_MAX` 30 (kode.h:1114); `KODE_BLE_ADDR_MAX` 18 (1115, "c0:00:00:00:00:01"); `KODE_BLE_SCAN_RSP_MAX` 31 (1116); `KODE_BLE_DATA_MIN` 2 (1118); scan 500 to 30000 ms (1119-1120); `KODE_BLE_CHARACTERISTICS_MAX` 4 (1222); `KODE_BLE_VALUE_MAX` 244 by default, up to 512 via config (1224-1226); characteristic name 16 incl. NUL (1228); properties READ 0x01, WRITE 0x02, NOTIFY 0x04, QUEUED 0x08 (1229-1232); queue 8 slots (1235); `KODE_SYS_BLE_SCAN_MAX` 24 (kode_sys.h:1591).
- Notifications carry at most 448 bytes, or MTU-3 (impl./header text).
- `kode_ble_device_t`: name[30], address[18], rssi. `BleScanEvt` adds `addr[6]`, `addr_type`, `mfg_len`/`mfg[30]`, `svc_n`/`svc16[4]`.
- Name and manufacturer data share the 31-byte scan response; each costs 2 bytes of overhead. Manufacturer data begins with a 2-byte little-endian company ID (minimum length 2, `KODE_BLE_DATA_MIN`). These are not stored.
- Security: with console pairing and passkey on (default), every characteristic requires an encrypted, authenticated, bonded link. With Bluetooth off in Settings every call fails (`kode_sys_ble_enabled`, kode_sys.h:1925).
- A scan fails "busy" right after link-up because the boot autojoin round runs; retry.
- Events (kode.h:251-260 macros): `ble_connected`, `ble_disconnected`, `ble_written` (text holds the bytes, NULs included), `ble_taken` (value = values left).
- `KODE_BLE_BATTERY_SERVICE` serves service 0x180F, characteristic 0x2A19 (kode_sys.h:1964-2066 block).

### Signals and events

| Signal | Payload | When |
|---|---|---|
| `BLE_STATE_SIG` (kqp_signals.h:250) | `BleStateEvt` (kqp_signals.h:5161, closing line) | What the BLE half is doing. |
| `BLE_PAIR_SIG` (kqp_signals.h:254) | `BlePairEvt` (kqp_signals.h:5176, closing line) | A pairing wants a code shown or entered. |
| `BLE_SCAN_ENTRY_SIG` (kqp_signals.h:259) | `BleScanEvt` (kqp_signals.h:5227, closing line) | One device seen. |
| `BLE_SCAN_END_SIG` (kqp_signals.h:260) | `BleScanEvt` (kqp_signals.h:5227, closing line) | Last device of the scan. |
| `BLE_APP_WRITE_SIG` (kqp_signals.h:263) | `BleAppWriteEvt` (kqp_signals.h:5266, closing line) | A central wrote to the app's characteristic. |
| `BLE_APP_LINK_SIG` (kqp_signals.h:266) | `BleAppLinkEvt` (kqp_signals.h:5304, closing line) | A central connected or left. |
| `BLE_APP_TAKEN_SIG` (kqp_signals.h:268) | `BleAppTakenEvt` (kqp_signals.h:5312, closing line) | A read took the oldest queued value. |
| `kode_sys_ble_heard` answers | `BleHeardEvt` (kqp_signals.h:5049, closing line) | Raw advertisements (kode_sys.h:1675). |

## 2. Scenarios (Given / When / Then)

1. **Scan finds a sensor.** Given a sensor peripheral "Thermo" at c0:00:00:00:00:01, rssi -60; When `kode_ble_scan(3000)`; Then the list contains it, with name, address and rssi.
2. **Manufacturer data.** Given sensor manufacturer data `FF FF 17 01` (company 0xFFFF, value bytes); When the app reads `kode_sys_ble_heard`; Then `mfg_len`=4 and the bytes are present.
3. **Scan limits.** When the app scans 100 ms or 60000 ms; Then it is refused (range 500 to 30000). More than 24 devices: the list is cut at 24.
4. **Bluetooth off.** Given Settings "Bluetooth off"; Then every BLE call fails.
5. **Boot busy.** Given the first seconds after link-up; When the app scans; Then it fails "busy"; a retry after the autojoin round succeeds.
6. **Phone connects, writes.** Given a phone object and an app characteristic with WRITE; When the phone writes "abc"; Then the event `ble_connected` fires first, then `ble_written` with text "abc". When it disconnects, `ble_disconnected`.
7. **Phone not paired.** Given pairing required (default) and the phone has not bonded; When it writes; Then the write is rejected, no `ble_written`.
8. **Notify.** Given the phone subscribed; When the app notifies a 100 byte value; Then the phone sees it. A value over 244 bytes (or MTU-3 over the wire, 448 maximum) is refused.
9. **Queue.** Given a QUEUED characteristic and 8 slots full; When the app queues a ninth; Then it is refused; each phone read raises `ble_taken` with the count left.
10. **Dot advertises.** When the app calls `kode_ble_set_name("Dot")` and `kode_ble_set_manufacturer_data(data, len)` (company ID first, little-endian; the call adds none; `len` 0 clears or at least 2 up to what fits beside the name; not stored); Then the phone object lists the name and the bytes in its scan. Too long for the 31-byte scan response: refused with a reason.
11. **Characteristic limits.** A fifth characteristic, a name over 15 characters or a bad UUID (not 8-4-4-4-12) is refused.

## 3. Bench object model

### 3.1 Sensor peripheral (advertiser)

Because the API has no central role, the sensor is observable only by advertising.

| Field | Type | Range | Default |
|---|---|---|---|
| name | string | up to 30 bytes (shares the 31-byte scan response) | "Thermo" |
| address | 6 bytes | | c0:00:00:00:00:01 |
| address type | enum | not stated | public |
| rssi | int8 dBm | not stated | -60 |
| company ID | uint16 | | 0xFFFF |
| manufacturer data | bytes | up to 30, min 2 including company ID | company ID + 2-byte temperature in 0.01 C |
| service UUIDs (16-bit) | list | up to 4 | 0x181A |
| advertising on | bool | | true |
| value | number | | 21.5 |

Actions: edit value (re-encoded into manufacturer data), move away (lower rssi), switch off.

### 3.2 Phone (central)

| Field | Type | Default |
|---|---|---|
| name | string | "Phone" |
| connected | bool | false |
| bonded | bool | false |
| MTU | int | 23 (ATT default; not stated by headers) |
| passkey shown | string | read-only, from `BlePairEvt` |
Actions: connect, disconnect, pair (enter the passkey), write a characteristic (hex or text), read a characteristic, subscribe. Displays: characteristics (name, UUID, properties), latest notifications, values left in the queue.

## 4. Data formats

- Advertising and scan response: AD structures with a 2-byte overhead each, 31-byte limit. Manufacturer data: company ID little-endian first.
- Characteristic UUID text form 8-4-4-4-12; the app service UUID is `KODE_BLE_SERVICE` (value not restated here).
- Battery service 0x180F / 0x2A19: one byte, percent (standard GATT; the header only names the IDs).

## 5. Open questions

1. **Sensor value delivery**: no GATT client exists. Default: put the value in manufacturer data; document it for app authors.
2. **Address type and rssi ranges**: not stated. Default: public, -30 to -100.
3. **MTU negotiation**: not stated. Default: MTU 247 after connect, so the 244-byte value limit is reachable.
4. **Pairing UX**: passkey display only comes through `BLE_PAIR_SIG`. Default: bench phone shows the passkey and has an input.


# Infrared

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:1999 | `bool kode_ir_send(const char *protocol, uint32_t address, uint32_t command);` | no wait parameter | `false` |
| kode.h:2010 | `kode_ir_code_t kode_ir_receive(uint32_t ms);` | waits up to `ms` | empty struct / zero handle (per header text) |
| kode.h:2020 | `kode_ir_code_t kode_ir_last(void);` | no wait parameter | empty struct / zero handle (per header text) |
| kode.h:2031 | `const kode_ir_raw_t *kode_ir_receive_raw(uint32_t ms);` | waits up to `ms` | empty struct / zero handle (per header text) |
| kode.h:2044 | `bool kode_ir_send_raw(const uint16_t *us, uint32_t n, uint32_t carrier_hz);` | no wait parameter | `false` |
| kode.h:2061 | `bool kode_ir_capture_start(const char *path);` | no wait parameter | `false` |
| kode.h:2072 | `bool kode_ir_capture_stop(void);` | no wait parameter | `false` |
| kode.h:2082 | `bool kode_ir_send_file(const char *path);` | no wait parameter | `false` |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:153 | `kode_status_t kode_sys_ir_send_nec(uint16_t addr, uint16_t cmd);` | Command (posts to owner; returns status) |
| kode_sys.h:752 | `kode_status_t kode_sys_ir_send_raw(QActive *me, const kode_sys_ir_symbol_t *sym, size_t n, uint32_t carrier_hz);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:769 | `kode_status_t kode_sys_ir_capture(QActive *me, kode_sys_ir_symbol_t *out, size_t cap, uint32_t ms);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:777 | `kode_status_t kode_sys_ir_last(QActive *me);` | Request (returns at once; answer arrives as a signal) |

### Return values, errors, events and constants

- Constants: `KODE_IR_PROTOCOL_MAX` 8 (kode.h:1969); `KODE_IR_RAW_MAX` 512 durations (1970); `KODE_IR_BUSY_MS` 5000 (1971); `KODE_IR_FILE_SIGNALS_MAX` 32 and `KODE_IR_FILE_GAP_MS` 100 (2049-2050); `KODE_SYS_IR_RAW_MAX_SYMBOLS` and `KODE_SYS_IR_RX_MAX_SYMBOLS` 256 (kode_sys.h:717, 720).
- `kode_ir_raw_t`: `count`, `carrier_hz` (38000), `us[512]` (durations, mark first). `kode_ir_code_t`: `ok`, `protocol[8]` ("NEC" or "unknown"), `address` and `command` (uint32).
- Only protocol "nec" is encoded (address and command 0 to 65535); anything else goes through `kode_ir_send_raw`. A repeat frame decodes as "unknown".
- Reasons (impl.): "no infrared signal in N ms", "protocol '%s' not supported", "infrared is busy, or the radio is off".
- Capture file format (impl.): first line `# kode ir capture v1`, a blank line, then blocks `nec 0x0012 0x0034` or `raw 38000` followed by durations. At most 32 signals, 100 ms gap, carrier at most 1,000,000, values at most 65535.
- kode_sys: `kode_sys_ir_capture` answers `KODE_OK` on a frame, `KODE_TIMEOUT` on silence, `KODE_IO_ERROR` with no block, `KODE_DENIED` when displaced. Behind the C5 link: link-down gives timeout or DENIED. Capture ms is clamped to 10 minutes.
- Event `ir_received` (kode.h:290): `source` "NEC", `value` = command, `text` = "0x%04X" of the 16-bit address word; otherwise `source` "unknown".
- The board's own sends echo back on the receiver, and AO_Ir is deaf during the frame plus a 120 ms tail (impl.), so the bench must not deliver an echo of the app's own sends.

### Signals and events

| Signal | Payload | When |
|---|---|---|
| `IR_RX_SIG` (kqp_signals.h:189) | `IrRxEvt` (kqp_signals.h:3464, closing line) | One frame the receiver heard (published). |
| `IR_CAPTURE_RSP_SIG` (kqp_signals.h:1080) | `IrCaptureRspEvt` (kqp_signals.h:3501, closing line) | Answer to a capture request. |
| `IR_SEND_RAW_RSP_SIG` (kqp_signals.h:1078) | `StatusRspEvt` (kqp_signals.h:3476, closing line) | Answer to a raw send. |
| `IR_LAST_RSP_SIG` (kqp_signals.h:1082) | `IrLastRspEvt` (kqp_signals.h:3510, closing line) | The last received frame, on request. |
| `IR_ECHO_SIG` (kqp_signals.h:1091) | `IrRxEvt` (kqp_signals.h:3464, closing line) | Own transmission echoing back (internal). |

## 2. Scenarios (Given / When / Then)

1. **Receive a NEC code.** Given a remote object with button "Power" = address word 0xFB04, command 0x08; When the user presses it during `kode_ir_receive(ms)`; Then the call returns `ok=true`, protocol "NEC", address 0xFB04, command 0x08, and the event `ir_received` has source "NEC", value 8 and text "0xFB04" (the 16-bit address word; see Open question 1). `kode_ir_last()` then returns the same code.
2. **Silence.** Given nothing pressed; When `kode_ir_receive(500)` runs; Then it returns `ok=false` with "no infrared signal in 500 ms".
3. **Send NEC to the TV.** Given the TV object listening with address word 0xFB04; When the app calls `kode_ir_send("nec", 0xFB04, 0x08)`; Then the TV decodes a frame and executes command 0x08 (power toggle in the default map).
4. **Unsupported protocol.** When the app sends "sony"; Then it fails with "protocol 'sony' not supported".
5. **Raw send.** Given `kode_ir_send_raw(us, n, carrier_hz)` with up to 512 durations at 38 kHz; Then the TV decodes it if it matches NEC timing; otherwise it ignores it.
6. **Out of range value.** Address or command above 65535: refused.
7. **Repeat frame.** Given the remote button held; Then the first frame is "NEC", following repeat frames decode as "unknown" (docs repeat 9000/2250 us).
8. **Radio off / busy.** Given the C5 link down; Then "infrared is busy, or the radio is off".
9. **Own send is not an input.** When the app sends then immediately receives; Then no echo is delivered.
10b. **Raw receive.** When the app calls `kode_ir_receive_raw(ms)`; Then it gets a `kode_ir_raw_t` (carrier 38000, durations mark first, at most 512 values) or NULL with a reason on silence.
11. **Capture and replay.** Given `kode_ir_capture_start("sd/ir.txt")` and the user pressing remote buttons; When `kode_ir_capture_stop()` runs (about half a second); Then the file holds at most 32 signals; with nothing heard no file is written. `kode_ir_send_file` reads the whole file first and sends nothing if any line is wrong, then sends the signals 100 ms apart. While capturing, `kode_ir_receive` fails at once and sends still work.

## 3. Bench object model

### 3.1 IR remote (sends)

| Field | Type | Range | Default |
|---|---|---|---|
| name | string | | "Remote" |
| protocol | enum | nec, raw | nec |
| address word | uint16 | 0..65535 | 0xFB04 (classic address 0x04 with its inverted copy) |
| buttons | list label -> command | 0..65535 | Power=0x08, Vol+=0x02, Vol-=0x03 |
| carrier | Hz | up to 1,000,000 | 38000 |
| repeat on hold | bool | | true |

Actions: press/release a button, hold. Displays: the frame sent (address, command, durations).

### 3.2 TV (receives)

| Field | Type | Default |
|---|---|---|
| accepted address word | uint16 | 0xFB04 |
| command map | command -> action | Power toggles `on`; Vol+/- change `volume` 0..100 |
| power | bool | false |
| volume | int | 20 |
| receiver fault | enum | none, deaf |
Displays: the last frame decoded, power, volume, a log. A frame with the wrong address is ignored and logged.

## 4. Data formats

- NEC (impl., `knec.h`): 34 symbols (leader, 32 bits, stop mark); bits LSB first; two 16-bit words with NO inversion in the driver. A classic remote with address 0x04 arrives as word 0xFB04 (the example comment in `ir_remote_ao.c`). Decode accepts marks up to 200 us longer than nominal (AGC excess).
- Timing **(docs, device/infrared)**: leader 9000/4500 us, bit 0 560/560, bit 1 560/1690, repeat 9000/2250, tolerance 300 us, 38 kHz carrier, 33% duty.
- `IrSymbol` is {mark_us, space_us}; `kode_ir_raw_t.us` is a flat list, mark first, up to 512 values (256 symbols).

## 5. Open questions

1. **Address representation.** Header example text says "0x0004" while the driver word for a classic address 0x04 is 0xFB04. Default: store 16-bit words; offer a "classic NEC (addr8, cmd8)" helper that builds the words with their inverted copies.
2. **Receiver deafness window** (frame plus 120 ms tail): default on, per impl.
3. **Which commands a real TV accepts**: not stated. Default: the user-editable map above.
4. **Raw decode tolerance**: default the docs tolerance of 300 us.


# Files

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:458 | `const char *kode_file_read(const char *path);` | no wait parameter | `""` or `NULL` (per header text) |
| kode.h:470 | `const uint8_t *kode_file_read_bytes(const char *path, uint32_t *len);` | no wait parameter | empty struct / zero handle (per header text) |
| kode.h:492 | `bool kode_file_read_at(const char *path, uint32_t offset, void *buf, uint32_t cap, uint32_t *got);` | no wait parameter | `false` |
| kode.h:505 | `bool kode_file_write(const char *path, const char *text);` | no wait parameter | `false` |
| kode.h:516 | `bool kode_file_append(const char *path, const char *text);` | no wait parameter | `false` |
| kode.h:533 | `bool kode_file_write_bytes(const char *path, const void *data, uint32_t len);` | no wait parameter | `false` |
| kode.h:545 | `bool kode_file_append_bytes(const char *path, const void *data, uint32_t len);` | no wait parameter | `false` |
| kode.h:555 | `kode_file_status_t kode_file_status(const char *path);` | no wait parameter | empty struct / zero handle (per header text) |
| kode.h:573 | `bool kode_file_space(const char *volume, uint64_t *total_bytes, uint64_t *free_bytes);` | no wait parameter | `false` |
| kode.h:584 | `bool kode_file_exists(const char *path);` | no wait parameter | `false` |
| kode.h:596 | `const kode_file_list_t *kode_file_list(const char *folder);` | no wait parameter | empty struct / zero handle (per header text) |
| kode.h:616 | `const kode_file_list_t *kode_file_list_from(const char *folder, uint32_t skip);` | no wait parameter | empty struct / zero handle (per header text) |
| kode.h:626 | `bool kode_file_delete(const char *path);` | no wait parameter | `false` |
| kode.h:637 | `bool kode_file_create_folder(const char *path);` | no wait parameter | `false` |
| kode.h:648 | `bool kode_file_rename(const char *path, const char *new_name);` | no wait parameter | `false` |
| kode.h:661 | `bool kode_file_move(const char *from, const char *to);` | no wait parameter | `false` |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:1199 | `kode_status_t kode_sys_file_status(QActive *me, const char *path);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1212 | `kode_status_t kode_sys_file_space(QActive *me, const char *volume);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1228 | `kode_status_t kode_sys_file_list(QActive *me, const char *path, uint16_t skip);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1236 | `kode_status_t kode_sys_file_create_folder(QActive *me, const char *path);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1244 | `kode_status_t kode_sys_file_delete(QActive *me, const char *path);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1253 | `kode_status_t kode_sys_file_rename(QActive *me, const char *from, const char *to);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1267 | `kode_status_t kode_sys_file_read(QActive *me, const char *path, uint32_t offset, void *buf, uint32_t cap);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1281 | `kode_status_t kode_sys_file_write(QActive *me, const char *path, const void *data, uint32_t len, bool append);` | Request (returns at once; answer arrives as a signal) |

### Return values, errors, events and constants

- Constants (kode.h): `KODE_FILE_PATH_MAX` 91 (420), `KODE_FILE_NAME_MAX` 64 (421), `KODE_FILE_LIST_MAX` 24 per page (422), `KODE_FILE_READ_MAX` 4194304 (423, 4 MiB for `kode_file_read`), `KODE_FILE_BUSY_MS` 5000 (424). kode_sys: `KODE_SYS_FILE_READ_MAX` 32768 per call (kode_sys.h:1154), `KODE_SYS_FILE_LIST_MAX` 24 (1157), `KODE_SYS_FILE_PATH_MAX` 96 (1167).
- Volumes: `sd/...` (microSD) and `flash/...` (internal). The volumes themselves cannot be deleted, renamed or moved. A folder must already exist before a write into it. A cross-volume move is files only (copy, then delete). `kode_file_rename` takes a single new name, not a path. `kode_file_space` returns bytes in its prototype (kode.h:573) but the implementation holds whole KB (impl.). The listing walks from the start on each page (use `kode_file_list_from` with `skip`).
- Reasons (impl.): "no such file", "no such folder", "the folder above does not exist", "too big (over 4 MiB)", "the folder is not empty".
- kode_sys answers: `FileRspEvt` with `rc`, `more`, `count`, `got` and a union of `FileStat` (exists, is_dir, size) and `FileSpace` (total_kb, free_kb). `KODE_NOT_DIR`, `KODE_IS_DIR`, `KODE_EXISTS`, `KODE_NO_RESOURCES` appear as `rc` for the matching cases (kode_defs.h).
- Docs (device/storage) **(docs)**: microSD is FAT (exFAT off, so cards over 32 GB will not mount unless reformatted); a single file is at most 4 GiB. Internal flash size: not stated.

### Signals and events

| Signal | Payload | When |
|---|---|---|
| `FILE_STATUS_RSP_SIG` (kqp_signals.h:761) | `FileRspEvt` (kqp_signals.h:6920, closing line) | Stat answer. |
| `FILE_LIST_END_SIG` (kqp_signals.h:763) | `FileRspEvt` (kqp_signals.h:6920, closing line) | End of a listing; entries come as `STORAGE_ENTRY_SIG` (kqp_signals.h:111) (`StorageEntryEvt` (kqp_signals.h:2616, closing line)). |
| `FILE_FOLDER_RSP_SIG` (kqp_signals.h:766) | `FileRspEvt` (kqp_signals.h:6920, closing line) | Create-folder answer. |
| `FILE_DELETE_RSP_SIG` (kqp_signals.h:768) | `FileRspEvt` (kqp_signals.h:6920, closing line) | Delete answer. |
| `FILE_RENAME_RSP_SIG` (kqp_signals.h:770) | `FileRspEvt` (kqp_signals.h:6920, closing line) | Rename answer. |
| `FILE_READ_RSP_SIG` (kqp_signals.h:772) | `FileRspEvt` (kqp_signals.h:6920, closing line) | Read answer, `got` bytes. |
| `FILE_WRITE_RSP_SIG` (kqp_signals.h:774) | `FileRspEvt` (kqp_signals.h:6920, closing line) | Write answer. |
| `FILE_SPACE_RSP_SIG` (kqp_signals.h:776) | `FileRspEvt` (kqp_signals.h:6920, closing line) | Space answer. |
| `STORAGE_CARD_SIG` (kqp_signals.h:367) | `StorageCardEvt` (kqp_signals.h:6854, closing line) | Card state (inserted, mounted). |

## 2. Scenarios (Given / When / Then)

1. **Write and read.** Given `sd` mounted; When `kode_file_write("sd/a.txt","hi")` then `kode_file_read("sd/a.txt")`; Then it returns "hi".
2. **Append.** `kode_file_append` adds to the end and creates nothing in a missing folder.
3. **Missing file.** `kode_file_read("sd/none.txt")` returns "" with "no such file". `kode_file_exists` returns false.
4. **Missing folder.** Write to `sd/dir/a.txt` with no `dir`: fails ("the folder above does not exist"); after `kode_file_create_folder("sd/dir")` it succeeds.
5. **No card.** Given the microSD removed; When the app touches `sd/...`; Then it fails, `kode_sys` answers `KODE_IO_ERROR` (the exact reason text is not stated). `flash/...` keeps working.
6. **Storage full.** Given the card has 1 KB free; When the app writes 4 KB; Then the write fails and the error says so (the exact text is not stated; kode_sys: `KODE_NO_RESOURCES`). `kode_file_space("sd", &total, &free)` shows free at 1 KB.
7. **Too big to read.** A file over 4 MiB: `kode_file_read` fails "too big (over 4 MiB)"; `kode_file_read_at` still reads in pieces.
8. **List paging.** Given 30 files; When `kode_file_list("sd")`; Then the first 24 come back; `kode_file_list_from("sd", 24)` returns the rest.
9. **Delete non-empty folder.** Fails with "the folder is not empty".
10. **Rename and move.** Rename with a path in `new_name` fails; moving a folder across volumes fails (files only).
11. **Protected volumes.** Delete, rename or move of `sd` or `flash` fails.
12. **Illegal paths.** Over 91 bytes, leading "/", or a "." or ".." part: refused.
13. **Busy.** Concurrent calls wait up to 5000 ms (`KODE_FILE_BUSY_MS`) and then fail.
14. **Card swap.** Removing then re-inserting a card: previous files persist for the same card object.

## 3. Bench object model

### 3.1 microSD card

| Field | Type | Range | Default |
|---|---|---|---|
| inserted | bool | | true |
| capacity | bytes | up to 32 GB mounts; larger refused (docs) | 8 GB |
| used | bytes | derived, plus "filler" slider | contents size |
| read only | bool | not stated for the API | false |
| write fault | enum | none, no space, I/O error | none |
| contents | tree of files and folders | | empty |

Actions: insert, remove, load a folder or files from the host, download a file, fill the card to a free-space value, inject faults.

### 3.2 Internal flash volume

Same tree model, always present. Size: not stated (Open question 1). Persists across app runs (design doc: IndexedDB).

## 4. Data formats

- Paths: `sd/a/b.txt`, case handling not stated. Name at most 64 bytes, path at most 91.
- Text and binary files are byte strings. Listing entries carry name, is_dir, size (`kode_file_status_t`, kode.h:427; `kode_file_list_t`, kode.h:434-441).
- Audio files for the audio area: WAV PCM 48 kHz 16-bit mono (see Audio).
- IR capture file text format: see Infrared.

## 5. Open questions

1. **Flash volume size**: not stated. Default 4 MiB, flagged as an assumption.
2. **Filesystem quirks (case sensitivity, long names)**: not stated. Default: case-sensitive, names up to 64 bytes.
3. **Space unit**: prototype says bytes, impl. KB granularity. Default: bytes rounded down to whole KB.
4. **Write speed / latency**: not stated. Default: instant.


# Power

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:1582 | `uint8_t kode_battery_level(void);` | no wait parameter | `0` (per header text) |
| kode.h:1589 | `bool kode_battery_is_charging(void);` | no wait parameter | `false` |
| kode.h:1596 | `uint32_t kode_battery_voltage_mv(void);` | no wait parameter | `0` (per header text) |
| kode.h:1603 | `bool kode_power_is_usb_connected(void);` | no wait parameter | `false` |
| kode.h:1619 | `bool kode_power_off(void);` | no wait parameter | `false` |
| kode.h:1631 | `bool kode_power_set_charging(bool on);` | no wait parameter | `false` |
| kode.h:1644 | `bool kode_power_set_charge_current(uint16_t ma);` | no wait parameter | `false` |
| kode.h:1769 | `bool kode_pin_power_5v(bool on);` | no wait parameter | `false` |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:480 | `kode_status_t kode_sys_power_sleep(void);` | Command (posts to owner; returns status) |
| kode_sys.h:490 | `kode_status_t kode_sys_power_off(void);` | Command (posts to owner; returns status) |
| kode_sys.h:507 | `kode_status_t kode_sys_power_boost(bool on);` | Command (posts to owner; returns status) |
| kode_sys.h:517 | `kode_status_t kode_sys_power_charge(bool on);` | Command (posts to owner; returns status) |
| kode_sys.h:527 | `kode_status_t kode_sys_power_charge_limit(uint16_t ma);` | Command (posts to owner; returns status) |
| kode_sys.h:579 | `kode_status_t kode_sys_exp_power(bool on);` | Command (posts to owner; returns status) |
| kode_sys.h:2128 | `kode_status_t kode_sys_battery_read(kode_sys_battery_t *out);` | Command (posts to owner; returns status) |

### Return values, errors, events and constants

- Constants: `KODE_BATTERY_LOW_PCT` 15 (kode.h:1568), `KODE_BATTERY_REARM_PCT` 5 (1569, re-arm 5 points above), `KODE_BATTERY_WAIT_MS` 3000 (1570), charge current 64 to 896 mA (1571-1572; kode_sys 494-495), boost minimum 3600 mV (kode_sys.h:496). `PowerEvt` is published every `KODE_POWER_POLL_MS` = 2000 (kqp_config.h).
- `kode_battery_level` returns 0 to 100; 0 with a reason when the battery was not read within 3000 ms or the gauge does not answer. `kode_battery_voltage_mv` falls back to the charger's value in 20 mV steps without a gauge. `kode_power_is_usb_connected` is judged from the last battery reading.
- `kode_power_off` (kode.h:1619): deep sleep; only the bottom button wakes it. Refused while USB is plugged in ("the board cannot switch off while USB is plugged in", impl.). Needs `CONFIG_KODE_LOWPOWER`. On battery it does not return. The battery ship mode is the console `ship_mode`, not an API call.
- `kode_power_set_charging` (1631) and `kode_power_set_charge_current` (1644) are not stored: the next boot returns to the `charge` and `charge_ma` settings. The charger holds charging outside the 10 to 45 C window; a request to charge while held takes effect when the window returns. The charger keeps the nearest 64 mA step; the board's input limit may hold the real current lower. 0 is not "off".
- Docs (device/power) **(docs)**: 1000 mAh cell; charge limit 850 mA via ILIM.
- `kode_pin_power_5v` (kode.h:1769) is the 5 V boost on the expansion header (listed here for power; the 3.3 V twin is under Expansion). Boost is refused on USB or when the cell is under 3600 mV; boost is 5 V at 0.5 A (header text, kode_sys.h:507-527).
- kode_sys: `kode_sys_battery_t`: `vbat_mv`, `soc_pct`, `charging` (NONE 0, PRE 1, FAST 2, DONE 3; kode_sys.h:2108-2111), `vbus`, `gauge_ok`. Sleep or off is refused while USB or a cable is present (kode_sys.h:480, 490).
- Event `battery_low`: fires below 15%, re-arms 5 points above (kode.h event list).

### Signals and events

| Signal | Payload | When |
|---|---|---|
| `POWER_EVT_SIG` (kqp_signals.h:210) | `PowerEvt` (kqp_signals.h:3316, closing line) | Reading every 2000 ms: `vbat_mv`, `vbus_mv`, `current_ma`, `soc_pct`, `charging`, `fault`, `vbus`, `boost`, `ntc` (0 normal, 2 warm, 3 cool, 5 cold, 6 hot). |
| `POWER_SHIP_SIG` (kqp_signals.h:211) | `PowerShipArmEvt` (kqp_signals.h:4467, closing line) | The BATFET is about to open (ship mode). |
| `POWER_CTRL_SIG` (kqp_signals.h:228) | `PowerCtrlEvt` (kqp_signals.h:4482, closing line) | Answer to a control request. |
| `POWER_FIELD_SIG` (kqp_signals.h:224) | `PowerFieldEvt` (kqp_signals.h:3366, closing line) | A chip field's value. |
| `EXP_POWER_SIG` (kqp_signals.h:448) | `ExpPowerDoneEvt` (kqp_signals.h:4775, closing line) | Answer to `kode_sys_exp_power`: rc OK, IO_ERROR or DENIED. |

## 2. Scenarios (Given / When / Then)

1. **Battery level.** Given charge 80%; When `kode_battery_level()`; Then 80.
2. **Gauge missing.** Given fault "gauge not answering"; Then `kode_battery_level()` returns 0 with a reason; `kode_battery_voltage_mv()` returns the charger-derived value in 20 mV steps.
3. **Charging.** Given USB plugged in, charge state FAST; Then `kode_battery_is_charging()` is true; DONE gives false.
4. **Low battery event.** Given charge falling from 16% to 14%; Then `battery_low` fires once; it re-arms after the charge passes 20%.
5. **USB plugged.** `kode_power_is_usb_connected()` is true after a reading with VBUS present.
6. **Power off on battery.** Given no USB; When `kode_power_off()`; Then the run ends (the call does not return); only a bottom-button press restarts the app.
7. **Power off on USB.** Given USB; Then it returns false with "the board cannot switch off while USB is plugged in".
8. **Boost.** Given battery 3500 mV; When `kode_pin_power_5v(true)`; Then it is refused (under 3600 mV); on USB also refused.
9. **Charge control.** `kode_power_set_charge_current(900)` fails with the range in the reason; 0 fails; 100 becomes 128 (nearest 64 mA step is not specified for ties; see Open questions). `kode_power_set_charging(false)` stops charging until reboot.
10. **Temperature window.** Given NTC "hot" (6) or "cold" (5); Then charging is held (charging NONE) even if allowed.
11. **No reading yet.** Within 3000 ms of start, calls may fail with a reason that the battery has not been read.

## 3. Bench object model

### 3.1 Charger / battery

| Field | Type | Range | Default |
|---|---|---|---|
| connected to charger (VBUS) | bool | | false |
| battery present | bool | not stated | true |
| charge level | int percent | 0 to 100 | 75 |
| battery voltage | mV | derived from the level; range not stated | 3900 |
| charge state | enum | NONE, PRE, FAST, DONE | derived |
| charge current | mA | 64 to 896 in 64 steps | 512 |
| NTC | enum | normal 0, warm 2, cool 3, cold 5, hot 6 | normal |
| gauge works | bool | | true |
| charge fault | bool | | false |
| 5 V boost load | mA | not stated | 0 |

Actions: plug or unplug; set level; drain at a rate; toggle gauge; set temperature class. Displays back: the values the app set (charging allowed, charge current), boost on, `PowerEvt` last values.

### 3.2 USB cable with computer
VBUS is the only property the API exposes (see USB). Plugging the cable is the same action as "connected to charger" and also attaches the console terminal.

## 4. Data formats

- `PowerEvt` fields above (kqp_signals.h). The units are mV, mA, percent. The mapping of level to voltage is not stated; default: linear 3300 mV (0%) to 4200 mV (100%) (assumption).
- `kode_sys_battery_t` fields: vbat_mv, soc_pct, charging (0..3), vbus, gauge_ok.

## 5. Open questions

1. **Voltage curve and full/empty voltages**: not stated. Default: linear 3300-4200 mV, flagged as an assumption.
2. **Does the bench drain over time**: not stated. Default: off, with a slider for a drain rate.
3. **Charge current rounding**: header says the charger keeps the nearest 64 mA step. Default: round half up.
4. **Power-off behaviour in a browser**: the call does not return on hardware. Default: stop the app and show "powered off", restart on a bottom-button action.


# Motion

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:695 | `float kode_imu_read_axis(const char *axis);` | no wait parameter | `NAN` |
| kode.h:701 | `kode_imu_t kode_imu_read(void);` | no wait parameter | empty struct / zero handle (per header text) |
| kode.h:708 | `float kode_mag_read_axis(const char *axis);` | no wait parameter | `NAN` |
| kode.h:714 | `kode_mag_t kode_mag_read(void);` | no wait parameter | empty struct / zero handle (per header text) |
| kode.h:737 | `float kode_mag_heading(void);` | no wait parameter | `NAN` |
| kode.h:744 | `bool kode_mag_is_calibrated(void);` | no wait parameter | `false` |
| kode.h:750 | `bool kode_mag_clear_calibration(void);` | no wait parameter | `false` |
| kode.h:766 | `bool kode_mag_calibrate(void);` | no wait parameter | `false` |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:934 | `kode_status_t kode_sys_imu_read(QActive *me);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:941 | `kode_status_t kode_sys_mag_read(QActive *me);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:948 | `kode_status_t kode_sys_mag_cal_get(QActive *me);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:956 | `kode_status_t kode_sys_mag_cal_set(QActive *me, const kode_sys_mag_corr_t *corr);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:963 | `kode_status_t kode_sys_mag_cal_clear(QActive *me);` | Request (returns at once; answer arrives as a signal) |

### Return values, errors, events and constants

- Axes are the parts' own: QMI8658A (accelerometer and gyro), QMC5883P (field) (kode.h:662-664 comment). Docs (device/motion) **(docs)**: IMU at I2C 0x6A, magnetometer at 0x2C, on a shared bus. Ranges, noise and axis orientation relative to the board: not stated.
- Units (kode.h:672-694): `kode_imu_t` accel x/y/z in g, gyro x/y/z in degrees per second, `temp` in degrees C. `kode_mag_t` x/y/z in microtesla. Failure gives NAN (every field for struct reads) and a reason.
- All four read calls block: a read takes its turn behind other tasks' reads, keeps trying for `KODE_MOTION_BUSY_MS` 1000 (kode.h:670), and its last try can take 600 ms more. `kode_imu_read_axis` takes "accel_x", "accel_y", "accel_z", "gyro_x", "gyro_y", "gyro_z" or "temp" (any case); `kode_mag_read_axis` the field axes; a bad name returns NAN.
- `kode_mag_read` applies the stored calibration. `kode_mag_heading` (kode.h:737) returns degrees clockwise from north, 0 up to 360; NAN with "call kode_mag_calibrate() first", "the Dot is moving too much to tell which way is up", or "the field is too weak to give a heading". The Dot's top is the heading reference; tilt is corrected with the accelerometer.
- `kode_mag_calibrate` (kode.h:766): takes the glass, asks the user to turn the Dot in every direction, blocks until the sweep is complete or `KODE_MAG_CALIBRATE_MS` 30000 passes; needs kode_screen; its screen replaces the app's, so the app calls `kode_screen_new()` again. Failure example text: "not enough directions were covered". The calibration is stored as setting `mag_cal`; `kode_mag_clear_calibration` forgets it.
- kode_sys: `ImuSample` is `a_mg[3]`, `w_mdps[3]`, `temp_dc` (milli-g, milli-degrees per second, tenths of a degree); `MagSampleRspEvt` is raw mG; `MagCorr` has `offset_mg` within +-9999 and `scale_milli` 250 to 4000 (kode_sys.h:899-963). `kode_sys_imu_read` wakes a resting IMU in about 200 ms. Answers: `KODE_IO_ERROR` no IMU, `KODE_DENIED` self-test running, `KODE_ERROR` magnetometer not ready.

### Signals and events

| Signal | Payload | When |
|---|---|---|
| `IMU_SAMPLE_RSP_SIG` (kqp_signals.h:1354) | `ImuSampleRspEvt` (kqp_signals.h:6288, closing line) | Answer to an IMU read request. |
| `MAG_SAMPLE_RSP_SIG` (kqp_signals.h:1387) | `MagSampleRspEvt` (kqp_signals.h:6413, closing line) | Answer to a magnetometer read. |
| `MAG_CAL_RSP_SIG` (kqp_signals.h:1396) | `MagCalRspEvt` (kqp_signals.h:6470, closing line) | Answer to a calibration get, set or clear (`KODE_SYS_MAG_CAL_GET/SET/CLEAR`). |
| `IMU_ENERGY_SIG` (kqp_signals.h:1364) | `ImuEnergyEvt` (kqp_signals.h:6371, closing line) | Motion energy during a capture (kode_sys only). |

## 2. Scenarios (Given / When / Then)

1. **At rest.** Given tilt flat, still; When `kode_imu_read()`; Then accel is about (0, 0, 1) g, gyro about 0, temp near the die temperature. (Which axis points up is not stated; Open question 1.)
2. **Tilt.** Given tilt pitch 30 degrees; Then accel components follow sin/cos of the angle with magnitude 1 g.
3. **Shake.** Given the user presses "shake" (a timed burst); Then accel varies by several g and gyro by hundreds of degrees per second for the duration, then returns to rest; `kode_mag_heading` fails with "the Dot is moving too much to tell which way is up".
4. **Heading without calibration.** `kode_mag_heading()` returns NAN with "call kode_mag_calibrate() first". After `kode_mag_calibrate()` succeeds, `kode_mag_is_calibrated()` is true and the heading follows the bench compass angle.
5. **Calibration sweep.** The bench asks the user to rotate the virtual Dot through all directions (a "rotate" control); if the sweep does not cover enough, the call fails with "not enough directions were covered"; at 30000 ms it ends.
6. **Weak field.** Given field strength near 0: "the field is too weak to give a heading".
7. **Sensor missing.** Given a fault "IMU not answering": reads return NAN; kode_sys returns `KODE_IO_ERROR`.
8. **Bad axis name.** `kode_imu_read_axis("w")` returns NAN.
9. **Busy.** Many concurrent reads: one may wait up to 1000 ms plus 600 ms, then NAN.
10. **Clear calibration.** `kode_mag_clear_calibration()` true; `kode_mag_is_calibrated()` false; field reads raw again.

## 3. Bench object model

### 3.1 Tilt and shake (virtual orientation)

| Field | Type | Range | Default |
|---|---|---|---|
| pitch | degrees | not stated; use -180 to 180 | 0 |
| roll | degrees | -180 to 180 | 0 |
| yaw (compass heading) | degrees | 0 to 360 | 0 |
| temperature | degrees C | not stated | 25 |
| earth field | microtesla | not stated | 50 |
| hard-iron offset | microtesla per axis | not stated | 0 |
| IMU works | bool | | true |
| magnetometer works | bool | | true |

Actions: drag pitch/roll, shake (duration and amplitude), spin (gyro rate), reset. Displays back: the seven IMU values and three field values the driver would return, calibrated or raw, and whether `mag_cal` is stored.

## 4. Data formats

- IMU: accel g, gyro deg/s, temp C (float). Mag: microtesla float. kode_sys raw: mg, mdps, deci-degrees C, mG as integers (kode_sys.h:934-963).
- Calibration: `MagCorr` per-axis offset (mG, within +-9999) and scale (milli, 250 to 4000) applied by `kode_mag_read`.

## 5. Open questions

1. **Axis orientation and measurement ranges**: not stated. Default: +z up out of the screen, 1 g on +z at rest, +-8 g range, earth field about 50 uT pointing north and down (assumptions).
2. **"Too much movement" threshold**: not stated. Default: gyro magnitude above 30 deg/s or accel deviating from 1 g by more than 0.3 g.
3. **What counts as enough directions for calibration**: not stated. Default: yaw swept over 270 degrees and pitch/roll over 60 degrees.


# Audio

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:849 | `bool kode_audio_play(const char *path);` | no wait parameter | `false` |
| kode.h:861 | `bool kode_audio_play_start(const char *path);` | no wait parameter | `false` |
| kode.h:867 | `bool kode_audio_is_playing(void);` | no wait parameter | `false` |
| kode.h:876 | `bool kode_audio_play_stop(void);` | no wait parameter | `false` |
| kode.h:888 | `bool kode_audio_play_samples(const int16_t *samples, uint32_t count);` | no wait parameter | `false` |
| kode.h:905 | `bool kode_audio_stream_open(uint8_t channels);` | no wait parameter | `false` |
| kode.h:925 | `bool kode_audio_stream_write(const int16_t *frames, uint32_t count, uint32_t ms, uint32_t *taken);` | waits up to `ms` | `false` |
| kode.h:936 | `bool kode_audio_stream_close(void);` | no wait parameter | `false` |
| kode.h:949 | `bool kode_audio_tone(uint16_t hz, uint32_t ms);` | waits up to `ms` | `false` |
| kode.h:958 | `bool kode_audio_set(const char *setting, uint32_t value);` | no wait parameter | `false` |
| kode.h:965 | `uint32_t kode_audio_get(const char *setting);` | no wait parameter | `0` (per header text) |
| kode.h:978 | `bool kode_audio_record_file(const char *path, uint32_t ms);` | waits up to `ms` | `false` |
| kode.h:1002 | `bool kode_audio_record_samples(int16_t *buf, uint32_t cap, uint32_t ms, uint32_t *frames);` | waits up to `ms` | `false` |
| kode.h:1013 | `bool kode_audio_record_start(uint32_t max_ms);` | waits up to `max_ms` | `false` |
| kode.h:1019 | `kode_audio_record_status_t kode_audio_record_status(void);` | no wait parameter | empty struct / zero handle (per header text) |
| kode.h:1026 | `bool kode_audio_record_stop(void);` | no wait parameter | `false` |
| kode.h:1037 | `bool kode_audio_record_save(const char *path);` | no wait parameter | `false` |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:174 | `kode_status_t kode_sys_audio_tone(uint16_t hz, uint16_t ms, uint8_t amp_pct);` | Command (posts to owner; returns status) |
| kode_sys.h:183 | `kode_status_t kode_sys_audio_volume(uint8_t pct);` | Command (posts to owner; returns status) |
| kode_sys.h:191 | `kode_status_t kode_sys_audio_mic_gain(uint8_t db);` | Command (posts to owner; returns status) |
| kode_sys.h:199 | `kode_status_t kode_sys_audio_mute(bool on);` | Command (posts to owner; returns status) |
| kode_sys.h:207 | `void kode_sys_audio_record_stop(void);` | Immediate (returns a copy, flag or pin) |
| kode_sys.h:836 | `kode_status_t kode_sys_audio_info_read(QActive *me);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:848 | `kode_status_t kode_sys_audio_play(QActive *me, const int16_t *frames, size_t n);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:862 | `kode_status_t kode_sys_audio_record(QActive *me, int16_t *buf, size_t cap, uint32_t ms);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:871 | `kode_status_t kode_sys_audio_record_file(QActive *me, const char *path, uint32_t ms);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:884 | `kode_status_t kode_sys_audio_stream_open(QActive *me);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:893 | `kode_status_t kode_sys_audio_stream_close(QActive *me);` | Request (returns at once; answer arrives as a signal) |
| kode_sys.h:1780 | `kode_status_t kode_sys_audio_stream_write(QActive const *me, const int16_t *frames, size_t n, uint8_t channels, size_t *taken);` | Command (posts to owner; returns status) |

### Return values, errors, events and constants

- Format: 48 kHz, 16-bit, mono (`KODE_SYS_AUDIO_RATE_HZ` 48000, kode_sys.h:783; mono 1, stereo 2). Stereo files, other rates, mp3 and non-PCM WAV are refused. Tone: 400 to 3400 Hz (`KODE_AUDIO_TONE_HZ_MIN/MAX`, kode.h:827-828), up to 65535 ms (826). Record up to 30000 ms (829). The stream holds 9600 frames, 200 ms (`KODE_SYS_AUDIO_STREAM_FRAMES`, kode_sys.h:798) and closes after a 10 s idle (kode.h:830). `KODE_AUDIO_BUSY_MS` 5000 (825). kode_sys buffer: 30 s (`KODE_SYS_AUDIO_BUF_SECONDS`, 786), path 96.
- Settings (`kode_audio_set`/`kode_audio_get`, kode.h:958-965): "volume" 0 to 100, "mic_gain" 0 to 42 dB in steps of 6, "mute" 0 or 1, any case. Settings last for this boot. `kode_audio_get` returns 0 on failure; read `kode_error()` to tell it from a real 0.
- `kode_audio_record_status_t` has `recording`, `ms`, `frames`. `kode_audio_record_file` blocks until the WAV is written and is refused while a recording or sound runs in the background. A medium that refuses the file as denied reads "audio is busy", like a held microphone (kode.h:974-977 comment).
- kode_sys commands (kode_sys.h:174-207): tone(hz, ms, amp_pct), volume, mic_gain, mute, record_stop. `AudioInfo` (kqp_signals.h:6103 closing line): rate, present, open, busy, bits, volume, mic_db, mute (via `kode_sys_audio_info_read`).

### Signals and events

| Signal | Payload | When |
|---|---|---|
| `AUDIO_DONE_SIG` (kqp_signals.h:1300) | `AudioDoneEvt` (kqp_signals.h:6241, closing line) | A tone or playback ended. |
| `AUDIO_REC_RSP_SIG` (kqp_signals.h:1308) | `AudioBufEvt` (kqp_signals.h:6270, closing line) | Recording into a buffer ended. |
| `AUDIO_FILE_RSP_SIG` (kqp_signals.h:379) | `AudioFileRspEvt` (kqp_signals.h:6200, closing line) | Record-to-file or play-file ended. |
| `AUDIO_STREAM_OPEN_RSP_SIG` (kqp_signals.h:1314) | `AudioBufEvt` (kqp_signals.h:6270, closing line) | Stream opened. |
| `AUDIO_STREAM_CLOSE_RSP_SIG` (kqp_signals.h:1320) | `AudioBufEvt` (kqp_signals.h:6270, closing line) | Stream closed. |
| `AUDIO_INFO_RSP_SIG` (kqp_signals.h:1286) | `AudioInfoRspEvt` (kqp_signals.h:6110, closing line) | Audio info answer. |

## 2. Scenarios (Given / When / Then)

1. **Play a WAV.** Given `sd/beep.wav` (48 kHz, 16-bit, mono, PCM); When `kode_audio_play("sd/beep.wav")`; Then the bench plays it through the browser audio output and the call returns when finished; `kode_audio_play_start` returns at once and `kode_audio_is_playing` is true until the end.
2. **Wrong format.** A stereo, 44.1 kHz or mp3 file: refused with a reason.
3. **Tone.** `kode_audio_tone(1000, 500)` sounds 1 kHz for 500 ms. 300 Hz or 4000 Hz: refused.
4. **Volume and mute.** `kode_audio_set("volume", 120)` is refused (range); `"mute", 1` silences the output.
5. **Record.** `kode_audio_record_file("sd/rec.wav", 2000)` records 2 s from the bench microphone into a WAV and returns once written; `kode_audio_record_start`/`status`/`stop`/`save` give the background form (status shows `recording`, `ms`, `frames`).
6. **Busy.** A second record or play while one runs: "audio is busy" (after waiting up to 5000 ms).
7. **No microphone permission.** Given the browser denies the mic: recording fails (the exact reason is not stated; kode_sys `KODE_IO_ERROR`).
8. **Streaming.** `kode_audio_stream_open(1)`, then `kode_audio_stream_write(frames, count, ms, &taken)` fills the 9600-frame buffer; a write into a full buffer waits up to `ms`, reporting `taken`; no write for 10 s closes the stream.
9. **Samples.** `kode_audio_play_samples` plays an int16 buffer; `kode_audio_record_samples` records into one (`frames` out).
10. **Storage full while recording**: the file write fails; the call returns false.

## 3. Bench object model

### 3.1 Speaker / microphone (host-backed)

| Field | Type | Range | Default |
|---|---|---|---|
| speaker output | enum | host default device, muted | host default |
| microphone source | enum | host microphone, file loop, silence | silence |
| volume (app setting) | int | 0 to 100 | not stated (Open question 1) |
| mic gain (app setting) | dB | 0 to 42, steps of 6 | not stated |
| mute (app setting) | bool | | false |
| hardware present | bool | | true |

Displays back: playing yes/no, file or tone, level meter, recorded length. Recording produces a downloadable WAV.

## 4. Data formats

- WAV PCM, mono, 16-bit little-endian, 48000 Hz. Streams and sample calls use `int16_t` frames at 48 kHz.
- Tones are generated at 48 kHz; amplitude percent in kode_sys (`KODE_SYS_AUDIO_AMP_MAX_PCT` 100).

## 5. Open questions

1. **Default volume, gain and mute at boot**: not stated. Default 70, 0 dB, unmuted.
2. **Sample-rate conversion in the browser**: the bench resamples to the host rate. Default on.
3. **Microphone default**: a browser permission prompt is intrusive. Default: silence until the user enables the host microphone.


# Haptic

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:787 | `bool kode_haptic_vibrate(bool on);` | no wait parameter | `false` |
| kode.h:798 | `bool kode_haptic_play(const char *profile);` | no wait parameter | `false` |
| kode.h:809 | `bool kode_haptic_add_profile(const char *name, const uint16_t *pattern_ms, uint32_t n, uint8_t intensity);` | waits up to `pattern_ms` | `false` |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:229 | `kode_status_t kode_sys_haptic_play_buzz(uint16_t ms, uint8_t gain_pct);` | Command (posts to owner; returns status) |
| kode_sys.h:239 | `kode_status_t kode_sys_haptic_play_pattern(const uint16_t *seg_ms, uint8_t n, uint8_t gain_pct);` | Command (posts to owner; returns status) |
| kode_sys.h:247 | `kode_status_t kode_sys_haptic_hold(uint8_t gain_pct);` | Command (posts to owner; returns status) |
| kode_sys.h:254 | `void kode_sys_haptic_stop(void);` | Immediate (returns a copy, flag or pin) |
| kode_sys.h:1787 | `bool kode_sys_haptic_is_holding(void);` | Immediate (returns a copy, flag or pin) |

### Return values, errors, events and constants

- Constants: `KODE_HAPTIC_PROFILES_MAX` 8 (kode.h:776), `KODE_HAPTIC_PATTERN_MAX` 16 segments (777), `KODE_HAPTIC_NAME_MAX` 16 (778, 15 characters), `KODE_HAPTIC_WAIT_MS` 5000 (779). One motor, one thing at a time: a call whose motor is in use waits up to `KODE_HAPTIC_WAIT_MS`, but a hold on the motor, whoever started it, fails a play at once. A hold has no time limit and any reset stops the motor. The stored `haptic` setting scales every strength. `kode_haptic_vibrate` and `kode_haptic_play` block; `kode_haptic_play` returns once the vibration has started, not when it ends; `kode_haptic_add_profile` never waits for the motor (kode.h:768-774). A name must not be a built-in name; adding an existing added name replaces it.
- Built-in profiles (docs/headers): click, tick, double, success, warning, error. An app adds up to 8 via `kode_haptic_add_profile(name, pattern_ms, n, intensity)`; intensity 0 to 100.
- kode_sys (kode_sys.h:229-254): `play_buzz` up to `KODE_SYS_HAPTIC_MAX_MS` 2000 (kode_sys.h:212) with gain up to 100 (215) but clamped at 80% by the LRA (driver); `play_pattern` up to 16 segments (218); `hold`; `stop`; `kode_sys_haptic_is_holding` (kode_sys.h:1787). A hold blocks plays. `HapticDoneEvt` has `rc`, `samples`, `starved`.

### Signals and events

| Signal | Payload | When |
|---|---|---|
| `HAPTIC_DONE_SIG` (kqp_signals.h:398) | `HapticDoneEvt` (kqp_signals.h:6588, closing line) | A play finished (rc, samples, starved). |
| `HAPTIC_FIELD_SIG` (kqp_signals.h:395) | `HapticFieldEvt` (kqp_signals.h:6567, closing line) | A chip field read. |

## 2. Scenarios (Given / When / Then)

1. **Named profile.** `kode_haptic_play("click")` buzzes briefly; the bench shows a pulse and uses the browser Vibration API when available.
2. **Unknown profile.** `kode_haptic_play("nope")` fails with a reason.
3. **Custom profile.** `kode_haptic_add_profile("buzz2", {50,50,50}, 3, 80)` then `kode_haptic_play("buzz2")`: three segments with the stated durations.
4. **Limits.** Ninth profile, 17 segments, name over 15 characters, intensity above 100: refused.
5. **Vibrate.** `kode_haptic_vibrate(true)` starts at the strongest the motor allows and holds until `kode_haptic_vibrate(false)` (already on counts as true). While held, `kode_haptic_play` fails at once (header).
6. **Motor busy.** A play while another plays: waits up to 5000 ms.
7. **Gain clamp.** kode_sys `play_buzz` with gain 100 is felt as 80% (clamp).
8. **Starved.** If the pattern buffer underruns, `HapticDoneEvt.starved` is set (impl.).

## 3. Bench object model

### 3.1 Vibration motor (output only)

| Field | Type | Range | Default |
|---|---|---|---|
| motor present | bool | | true |
| held by another owner | bool | | false |
Displays back: on/off, current intensity, a history of plays (profile or segment list), total on-time. No user-editable physical parameters.

## 4. Data formats

- A pattern is a list of segment lengths in milliseconds, on first, each above 0 (kode.h:803 `pattern_ms` comment). Intensity 0 to 100, spread over the motor's whole range.

## 5. Open questions

1. **Pattern convention**: resolved by the header: segment lengths in ms, "on first", each above 0, copied (kode.h:803). Segments alternate on and off (alternation is implied by "on first"; not spelled out).
1b. **Stored `haptic` setting** scales every strength; its value range is not stated. Default 100%.
2. **Built-in profile timings**: not stated. Default: click 20 ms, tick 10 ms, double 2 x 20 ms with 60 ms gap, success 20/60/40, warning 120, error 3 x 60.


# LED

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:381 | `kode_color_t kode_rgb(uint8_t r, uint8_t g, uint8_t b);` | no wait parameter | empty struct / zero handle (per header text) |
| kode.h:388 | `bool kode_led_set_color(kode_color_t c);` | no wait parameter | `false` |
| kode.h:397 | `bool kode_led_set_rgb(uint8_t r, uint8_t g, uint8_t b);` | no wait parameter | `false` |
| kode.h:403 | `bool kode_led_off(void);` | no wait parameter | `false` |
| kode.h:409 | `bool kode_led_toggle(void);` | no wait parameter | `false` |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:64 | `kode_status_t kode_sys_led_set(bool on);` | Command (posts to owner; returns status) |
| kode_sys.h:70 | `kode_status_t kode_sys_led_toggle(void);` | Command (posts to owner; returns status) |
| kode_sys.h:79 | `kode_status_t kode_sys_led_set_rgb(uint8_t r, uint8_t g, uint8_t b);` | Command (posts to owner; returns status) |

### Return values, errors, events and constants

- `kode_led_set_color`, `kode_led_set_rgb`, `kode_led_off`, `kode_led_toggle` (kode.h:388-409) wait up to 100 ms for the owner to take the LED; return true when taken, false when not or when refused. `kode_rgb(r,g,b)` packs 0xRRGGBB; the top byte of a colour is ignored. Named colours such as `KODE_BLUE` exist (kode.h:376-381 region).
- kode_sys (kode_sys.h:64-79): `kode_sys_led_set(bool)`, `kode_sys_led_toggle()`, `kode_sys_led_set_rgb(r,g,b)`; (0,0,0) is off. The refusal text `KODE_LED_REFUSED` is an implementation string (impl.). An LED heartbeat is owned by the system and can be enabled or its period changed through signals (`LED_HEARTBEAT_ENABLE_SIG` (kqp_signals.h:23), `LED_BLINK_PERIOD_SIG` (kqp_signals.h:22)); not part of the app API.

### Signals and events

| Signal | Payload | When |
|---|---|---|
| `LED_SET_SIG` (kqp_signals.h:20) | `LedEvt` (kqp_signals.h:2151, closing line) | LedMgr: drive the LED on or off. |
| `LED_RGB_SIG` (kqp_signals.h:24) | `LedRgbEvt` (kqp_signals.h:2165, closing line) | LedMgr: set the colour. |
| `LED_TOGGLE_SIG` (kqp_signals.h:21) | none | LedMgr: invert the LED. |

## 2. Scenarios (Given / When / Then)

1. **Set a colour.** `kode_led_set_rgb(255,0,0)` returns true; the bench LED is red.
2. **Off.** `kode_led_off()` returns true; LED dark. `kode_led_set_rgb(0,0,0)` is the same.
3. **Toggle.** From off, `kode_led_toggle()` lights it (colour not stated; Open question 1); again turns it off.
4. **Owner busy.** Given the LED owned by another party (heartbeat or fault "refused"); The call waits 100 ms and returns false.
5. **Heartbeat.** The system heartbeat blinks the LED unless the app takes it (behaviour internal; not stated for apps).

## 3. Bench object model

### 3.1 RGB LED (output only)

| Field | Type | Range | Default |
|---|---|---|---|
| colour | r,g,b | 0..255 each | 0,0,0 |
| owner refuses | bool | | false |
Displays back: current colour and a short history. No editable physical parameters.

## 4. Data formats

- Colour: 0xRRGGBB (24 bit), top byte ignored.

## 5. Open questions

1. **Colour used by toggle-on and by `kode_sys_led_set(true)`**: not stated. Default: white (255,255,255).
2. **Brightness / gamma**: not stated. Default: linear.


# Buttons, touch, display

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:159 | `bool kode_button_is_pressed(const char *name);` | no wait parameter | `false` |
| kode.h:171 | `bool kode_button_was_pressed(const char *name);` | no wait parameter | `false` |
| kode.h:182 | `uint32_t kode_button_get_presses(const char *name);` | no wait parameter | `0` (per header text) |
| kode.h:188 | `kode_buttons_t kode_button_read_all(void);` | no wait parameter | empty struct / zero handle (per header text) |
| kode.h:2255 | `bool kode_display_set_brightness(uint8_t pct);` | no wait parameter | `false` |
| kode.h:2278 | `bool kode_display_sleep(bool sleep);` | no wait parameter | `false` |
| kode.h:2311 | `const char *kode_event_touch_pressed(void);` | no wait parameter | n/a (event-name constant) |
| kode.h:2317 | `const char *kode_event_touch_moved(void);` | no wait parameter | n/a (event-name constant) |
| kode.h:2323 | `const char *kode_event_touch_released(void);` | no wait parameter | n/a (event-name constant) |
| kode.h:2337 | `bool kode_touch_read(int16_t *x, int16_t *y);` | no wait parameter | `false` |
| kode.h:2366 | `bool kode_screen_new(const char *title);` | no wait parameter | `false` |
| kode.h:2374 | `kode_widget_t kode_screen_add_text(const char *text);` | no wait parameter | empty struct / zero handle (per header text) |
| kode.h:2387 | `kode_widget_t kode_screen_add_value(const char *number, const char *unit);` | no wait parameter | empty struct / zero handle (per header text) |
| kode.h:2397 | `kode_widget_t kode_screen_add_button(const char *label);` | no wait parameter | empty struct / zero handle (per header text) |
| kode.h:2410 | `bool kode_widget_set_text(kode_widget_t p, const char *fmt, ...) KODE_PRINTF_FORMAT(2, 3);` | no wait parameter | `false` |
| kode.h:2424 | `bool kode_widget_set_color(kode_widget_t p, kode_color_t color);` | no wait parameter | `false` |
| kode.h:2438 | `bool kode_widget_was_pressed(kode_widget_t w);` | no wait parameter | `false` |
| kode.h:2478 | `kode_canvas_t kode_screen_add_canvas(uint32_t width, uint32_t height);` | no wait parameter | empty struct / zero handle (per header text) |
| kode.h:2486 | `bool kode_canvas_fill(kode_canvas_t c, kode_color_t color);` | no wait parameter | `false` |
| kode.h:2497 | `bool kode_draw_pixel(kode_canvas_t c, int32_t x, int32_t y, kode_color_t color);` | no wait parameter | `false` |
| kode.h:2513 | `bool kode_draw_line(kode_canvas_t c, int32_t x0, int32_t y0, int32_t x1, int32_t y1, kode_color_t color);` | no wait parameter | `false` |
| kode.h:2527 | `bool kode_draw_rect(kode_canvas_t c, int32_t x, int32_t y, int32_t w, int32_t h, kode_color_t color);` | no wait parameter | `false` |
| kode.h:2540 | `bool kode_fill_rect(kode_canvas_t c, int32_t x, int32_t y, int32_t w, int32_t h, kode_color_t color);` | no wait parameter | `false` |
| kode.h:2553 | `bool kode_draw_circle(kode_canvas_t c, int32_t x, int32_t y, int32_t r, kode_color_t color);` | no wait parameter | `false` |
| kode.h:2564 | `bool kode_fill_circle(kode_canvas_t c, int32_t x, int32_t y, int32_t r, kode_color_t color);` | no wait parameter | `false` |
| kode.h:2587 | `bool kode_draw_text(kode_canvas_t c, int32_t x, int32_t y, const char *text, kode_color_t color, kode_align_t align);` | no wait parameter | `false` |
| kode.h:2608 | `bool kode_draw_png(kode_canvas_t c, int32_t x, int32_t y, const char *path);` | no wait parameter | `false` |
| kode.h:2625 | `kode_widget_t kode_screen_add_image(const char *path);` | no wait parameter | empty struct / zero handle (per header text) |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:93 | `kode_status_t kode_sys_screen_brightness(uint8_t pct);` | Command (posts to owner; returns status) |
| kode_sys.h:126 | `kode_status_t kode_sys_screen_sleep(bool sleep);` | Command (posts to owner; returns status) |
| kode_sys.h:135 | `kode_status_t kode_sys_screen_parked(uint32_t seq);` | Command (posts to owner; returns status) |
| kode_sys.h:1757 | `uint32_t kode_sys_button_read_mask(void);` | Immediate (returns a copy, flag or pin) |
| kode_sys.h:1765 | `uint32_t kode_sys_button_read_presses(uint8_t id);` | Immediate (returns a copy, flag or pin) |
| kode_sys.h:1807 | `bool kode_sys_screen_is_asleep(void);` | Immediate (returns a copy, flag or pin) |
| kode_sys.h:1822 | `kode_status_t kode_sys_touch_subscribe(QActive *me);` | Request (returns at once; answer arrives as a signal) |

### Return values, errors, events and constants

**Buttons.** Six buttons: up, down, left, right, top, bottom (`KODE_SYS_BUTTON_UP..BOT` 0..5, `KODE_SYS_BUTTON_COUNT` 6; kode_sys.h:1739-1745). `kode_buttons_t` (kode.h:145-152) is read by `kode_button_read_all`. Names for `kode_button_is_pressed/was_pressed/get_presses`: the six names above. The press count is shared and consumed by `kode_button_was_pressed` and `kode_button_get_presses`. Timing (impl./docs): settle 30 ms, hold 600 ms, home hold 3000 ms (the bottom button held that long leaves the app), double press 800 ms (top button). Events (kode.h event list 192-237): `button_<name>_pressed`, `button_<name>_released`, and `button_<name>_held` for top and bottom. `ButtonEvt`: id, pressed, t_ms.

**Touch.** 410 x 502 glass pixels (kode.h:2311-2337 comment). Events `touch_pressed`, `touch_moved`, `touch_released` carry x, y (kode.h:2299-2305 macros, event getters at 2311-2323); moves are coalesced. `kode_touch_read(&x,&y)` (2337) returns true while a finger is down and fills x, y; false when none is, and when refused (`kode_error()` tells the two apart). The first call asks for the panel's reports, so it reads no finger until the panel reports one afterwards. `TouchEvt`: x, y, pressed, t_ms, plus a stale flag for a contact still for 60 s. Docs: controller CST820 at 0x15 or CST916E at 0x5A **(docs)**.

**Display / screen.**
- `kode_display_set_brightness(pct)` (kode.h:2255): 0 or 5 to 100 (`KODE_DISPLAY_BRIGHTNESS_MIN/MAX` 5/100). `kode_display_sleep(bool)` (2278) waits up to `KODE_DISPLAY_SLEEP_BOUND_MS` 2000 (2258). `DisplaySleepEvt` carries a `why` enum.
- Screen API (kode.h:2366-2625): `kode_screen_new(title)` starts a screen; `add_text`, `add_value(number, unit)`, `add_button(label)` return widget handles; `kode_widget_set_text`, `set_color`, `was_pressed`; canvases and draw calls; PNG drawing and image widgets.
- Limits: 32 widgets (`KODE_WIDGETS_MAX`, 2350); text 128 bytes (2351, 127 characters); `KODE_SCREEN_BUSY_MS` 2000 (2352); value number 10, unit 16, button label 32 bytes (2353-2355); canvas up to 410 x 502 (2449-2450) or 346 wide and 264 (with title) or 422 (no title) tall (2451-2453); 4 canvases and 4 images (2454-2455); draw coordinate range +-32767 (2456).
- An AO's own screen uses LVGL via `kscreen/include/kscreen.h` (outside kode.h). kode_sys: `kode_sys_screen_brightness` (93), `kode_sys_screen_sleep` (126), `kode_sys_screen_parked` (135), `kode_sys_screen_is_asleep` (1807), `kode_sys_touch_subscribe` (1822), `kode_sys_button_read_mask` (1757), `kode_sys_button_read_presses` (1765).

### Signals and events

| Signal | Payload | When |
|---|---|---|
| `BUTTON_EVT_SIG` (kqp_signals.h:152) | `ButtonEvt` (kqp_signals.h:3247, closing line) | One button changed. |
| `BUTTON_HOLD_SIG` (kqp_signals.h:153) | `ButtonHoldEvt` (kqp_signals.h:3263, closing line) | Top or bottom button held. |
| `BUTTON_HOME_HOLD_SIG` (kqp_signals.h:159) | `ButtonHoldEvt` (kqp_signals.h:3263, closing line) | Bottom held for the home gesture. |
| `BUTTON_DOUBLE_SIG` (kqp_signals.h:167) | `ButtonDoubleEvt` (kqp_signals.h:3286, closing line) | Top button double press. |
| `TOUCH_EVT_SIG` (kqp_signals.h:151) | `TouchEvt` (kqp_signals.h:4500, closing line) | A touch sample. |
| `DISPLAY_STATE_SIG` (kqp_signals.h:135) | `DisplayStateEvt` (kqp_signals.h:5681, closing line) | Panel up or asleep. |
| `DISPLAY_SLEEP_SIG` (kqp_signals.h:486) | `DisplaySleepEvt` (kqp_signals.h:5721, closing line) | Panel went to sleep (why). |

## 2. Scenarios (Given / When / Then)

1. **Button press.** Given the user presses "up"; Then `kode_button_is_pressed("up")` is true while held; `kode_button_was_pressed("up")` is true once and then false; `button_up_pressed` and `button_up_released` fire.
2. **Count.** Three presses: `kode_button_get_presses("up")` returns 3 and consumes them.
3. **Hold.** Top held 600 ms: `button_top_held` fires. Bottom held 3000 ms: home gesture; the app is stopped and the bench returns to its launcher.
4. **Double.** Two top presses within 800 ms raise the double event.
5. **Debounce.** A press shorter than 30 ms is not reported.
6. **Touch.** Pressing at (100, 200): `touch_pressed` with x=100, y=200; dragging fires coalesced `touch_moved`; release fires `touch_released`. Coordinates outside 410 x 502 are not possible.
7. **Screen widgets.** `kode_screen_new("T")`, `kode_screen_add_text("hello")`: the bench shows the widget; a button widget press makes `kode_widget_was_pressed` true once.
8. **Widget limits.** The 33rd widget fails; text over 127 characters is refused.
9. **Canvas.** `kode_screen_add_canvas(346, 264)` then `kode_draw_line(...)`: drawing appears; sizes over the limits fail; 5th canvas fails.
10. **Brightness.** `kode_display_set_brightness(50)` is accepted; 2 is refused (0 or 5 to 100).
11. **Sleep.** `kode_display_sleep(true)` dims the panel within 2000 ms; touch or a button wakes it; `kode_sys_screen_is_asleep` mirrors it.
12. **Calibration screen replaces the app screen** (see Motion): widgets are gone afterwards.

## 3. Bench object model

### 3.1 Face buttons

Six buttons: up, down, left, right, top, bottom. Each has: state (pressed or released), press count (consumed by the app), hold duration. Actions: click, press-and-hold, double-click (top). Keyboard mapping is a UI matter, not specified here.

### 3.2 Touchscreen

Fields: enabled (bool, default true), pointer position (read-only 0..409, 0..501), stale-touch simulation (a contact held 60 s sets `stale`).

### 3.3 Display

Read-only mirror: the framebuffer 410 x 502 as drawn by the app, brightness (0 or 5..100), asleep (bool). Fault: none stated.

## 4. Data formats

- Colour 0xRRGGBB; PNG paths use `sd/...` or `flash/...`; the screen is 410 x 502 pixels (docs/headers). Pixel format and refresh timing: not stated.

## 5. Open questions

1. **Screen shape and corner masks**: not stated beyond 410 x 502. Default: full rectangle.
2. **Is brightness 0 allowed?** Header comment says 0 or 5 to 100 (impl. text read earlier). Default: accept 0 as off.
3. **Where the home gesture goes in the bench**: Default: stop the app and show the loader.


# Time

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:57 | `void kode_delay(uint32_t ms);` | waits up to `ms` | n/a (void) |
| kode.h:64 | `uint32_t kode_uptime_ms(void);` | no wait parameter | n/a |
| kode.h:75 | `int64_t kode_time_unix(void);` | no wait parameter | -1 if clock not set |
| kode.h:100 | `bool kode_time_local(kode_time_t *out);` | no wait parameter | `false` |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:1693 | `uint32_t kode_sys_time_ms(void);` | Immediate (returns a copy, flag or pin) |
| kode_sys.h:1709 | `kode_status_t kode_sys_clock_read(int64_t *unix_s);` | Command (posts to owner; returns status) |
| kode_sys.h:1735 | `kode_status_t kode_sys_clock_local(kode_sys_time_t *out);` | Command (posts to owner; returns status) |

### Return values, errors, events and constants

- `kode_delay(ms)` (kode.h:57): sleeps the task; under one tick (1 ms) only yields; `KODE_FOREVER` (kode.h:29) is about 49.7 days, not forever.
- `kode_uptime_ms()` (64): milliseconds since boot, wraps after about 49 days (subtract as uint32_t); 0 when refused.
- `kode_time_unix()` (75): Unix seconds UTC; -1 while the clock is not set or when refused. The clock is set by SNTP, by the console `time set`, or restored after a power cut (then it may be behind).
- `kode_time_local(&t)` (100): fills `kode_time_t` (kode.h:78-86: year, month 1-12, day 1-31, hour, minute, second 0-60, weekday 0 = Sunday to 6) in the zone from `config key="zone"` (a POSIX TZ string such as "CET-1CEST,M3.5.0,M10.5.0/3"; UTC while none is stored). Returns false while the clock is not set or for NULL. A zone change applies at once.
- kode_sys: `kode_sys_time_ms` (kode_sys.h:1693), `kode_sys_clock_read` (1709) and `kode_sys_clock_local` (1735, `KODE_ERROR` when unset).
- Reason (impl.): "the clock is not set".

## 2. Scenarios (Given / When / Then)

1. **Clock not set.** Given a fresh bench with no sync; Then `kode_time_unix()` is -1 and `kode_time_local` is false with "the clock is not set".
2. **Clock set from the host.** Given "sync to host time" (the default, standing in for SNTP/`time set`); Then `kode_time_unix()` returns the host time in seconds.
3. **Time zone.** Given `config zone="CET-1CEST,M3.5.0,M10.5.0/3"`; Then `kode_time_local` reflects the zone including DST changes; with no zone it is UTC.
4. **Uptime.** `kode_uptime_ms()` starts near 0 at app load and advances with the bench clock; at 2^32 ms it wraps.
5. **Delay.** `kode_delay(100)` returns after 100 ms of bench time; `kode_delay(0)` only yields.
6. **Random.** `kode_random(5, 10)` returns 5 to 10 inclusive; with max below min it returns min and sets an error.
7. **Power-cut restore.** A bench "restart" restores a stored clock that may be behind by the downtime.

## 3. Bench object model

### 3.1 Clock

| Field | Type | Range | Default |
|---|---|---|---|
| clock set | bool | | true |
| source | enum | host time, manual, unset | host time |
| manual time | date-time | | now |
| offset from host | seconds | | 0 |
| zone (POSIX TZ) | string | any POSIX TZ | "" (UTC) |
| device id | string | `kode_device_id`, like "KODE78YR5EEV0XS" | "KODEBENCH0000001" |
Actions: set time, clear time, fast-forward, change zone. Displays back: unix time, local time, uptime.

## 4. Data formats

- Unix seconds int64; `kode_time_t` broken-down local time; POSIX TZ string.
- Device ID: a serial of the form shown in the header, "KODE78YR5EEV0XS" (15 characters); `""` when the MAC is unreadable.

## 5. Open questions

1. **SNTP behaviour in the browser**: not stated. Default: host clock acts as the source once "synced".
2. **Fast-forward** semantics for `kode_delay`: Default: advance bench time instantly, off by default.
3. **Device ID**: any string of this shape. Default as above.


# Settings

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:1664 | `bool kode_setting_set(const char *key, const char *value);` | no wait parameter | `false` |
| kode.h:1674 | `const char *kode_setting_get(const char *key);` | no wait parameter | `""` or `NULL` (per header text) |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:641 | `kode_status_t kode_sys_nvs_set(const char *key, const char *value);` | Command (posts to owner; returns status) |
| kode_sys.h:1858 | `kode_status_t kode_sys_nvs_get(const char *key, char *out, size_t cap);` | Command (posts to owner; returns status) |

### Return values, errors, events and constants

- `KODE_SETTING_KEY_MAX` 16 (kode.h:1654, so 1 to 15 bytes) and `KODE_SETTING_VALUE_MAX` 192 (1655, up to 191 bytes; "" is a value). Names are exact and case-sensitive. The calls block, one task at a time, and fail on a task whose stack is in PSRAM (use `app_main` or a task of your own). Anyone who can read the board can read settings.
- `kode_setting_get` returns "" with a reason when nothing is kept or it cannot be read; a kept "" is "" with no error. The string is valid until the task's next `kode_setting_get`.
- kode_sys (kode_sys.h:641, 1858): `kode_sys_nvs_set` is a command (no answer); `kode_sys_nvs_get(key, out, cap)` is immediate and answers `KODE_DENIED` when absent. Limits `KODE_SYS_NVS_KEY_MAX` 16, `KODE_SYS_NVS_VALUE_MAX` 192 (1839, 1842).
- System settings that the console `config` edits (not app API): zone, log, off_after, haptic, charge, charge_ma, mag_cal (from the headers and examples read).

## 2. Scenarios (Given / When / Then)

1. **Set and get.** `kode_setting_set("name","dot")` then `kode_setting_get("name")` returns "dot".
2. **Persistence.** After a bench restart or a new app run, the value is still there (design doc: stored with the files in IndexedDB).
3. **Missing key.** `kode_setting_get("none")` returns "" with a reason.
4. **Case.** "Name" and "name" are separate keys.
5. **Limits.** A 16-byte key, empty key, or a 192-byte value fails.
6. **Empty value.** Setting "" works and get returns "" with no error.
7. **PSRAM stack.** A call from a task created with its stack in PSRAM fails with a reason (the bench can model this as a fault).

## 3. Bench object model

### 3.1 Settings store (key-value)
Fields: list of key/value pairs (key 1 to 15 bytes, value up to 191), seeded with system keys (zone, log, off_after, haptic, charge, charge_ma, mag_cal). Actions: add, edit, delete, clear (factory reset), export. Displays back: what the app changed.
Settings that other areas read: `zone` (Time), `haptic` (Haptic), `charge`, `charge_ma` (Power), `mag_cal` (Motion), Bluetooth on/off and pairing options (BLE; the key names are not stated).

## 4. Data formats
Strings only. Persisted in IndexedDB (design doc).

## 5. Open questions

1. **Names of the Bluetooth and Wi-Fi enable settings**: not stated. Default: bench-internal toggles in the object model of those areas.
2. **Default `off_after`, `haptic`, `log` values**: not stated. Default: off_after 0 (never), haptic 100, log "info".


# Expansion

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:1699 | `bool kode_pin_write(uint8_t pin, bool level);` | no wait parameter | `false` |
| kode.h:1706 | `bool kode_pin_read(uint8_t pin);` | no wait parameter | `false` |
| kode.h:1713 | `uint32_t kode_pin_read_analog(uint8_t pin);` | no wait parameter | `0` (per header text) |
| kode.h:1722 | `bool kode_pin_write_pwm(uint8_t pin, uint32_t hz, uint8_t duty_pct);` | no wait parameter | `false` |
| kode.h:1756 | `bool kode_pin_power_3v3(bool on);` | no wait parameter | `false` |
| kode.h:1809 | `bool kode_i2c_begin(uint8_t sda, uint8_t scl, uint32_t hz);` | no wait parameter | `false` |
| kode.h:1818 | `bool kode_i2c_probe(uint8_t addr);` | no wait parameter | `false` |
| kode.h:1827 | `bool kode_i2c_write(uint8_t addr, const uint8_t *data, size_t len);` | no wait parameter | `false` |
| kode.h:1836 | `bool kode_i2c_read(uint8_t addr, uint8_t *data, size_t len);` | no wait parameter | `false` |
| kode.h:1849 | `bool kode_i2c_write_read(uint8_t addr, const uint8_t *out, size_t out_len, uint8_t *in, size_t in_len);` | no wait parameter | `false` |
| kode.h:1857 | `bool kode_i2c_end(void);` | no wait parameter | `false` |
| kode.h:1883 | `bool kode_spi_begin(uint8_t sck, uint8_t miso, uint8_t mosi, uint8_t cs, uint32_t hz, uint8_t mode);` | no wait parameter | `false` |
| kode.h:1898 | `bool kode_spi_transfer(const uint8_t *out, uint8_t *in, size_t len);` | no wait parameter | `false` |
| kode.h:1905 | `bool kode_spi_end(void);` | no wait parameter | `false` |
| kode.h:1929 | `bool kode_uart_begin(uint8_t tx, uint8_t rx, uint32_t baud);` | no wait parameter | `false` |
| kode.h:1939 | `size_t kode_uart_write(const uint8_t *data, size_t len);` | no wait parameter | `0` (per header text) |
| kode.h:1952 | `size_t kode_uart_read(uint8_t *data, size_t cap, uint32_t ms);` | waits up to `ms` | `0` (per header text) |
| kode.h:1959 | `bool kode_uart_end(void);` | no wait parameter | `false` |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:2192 | `kode_status_t kode_sys_exp_input(uint8_t pos, kode_sys_gpio_pull_t bias);` | Command (posts to owner; returns status) |
| kode_sys.h:2200 | `kode_status_t kode_sys_exp_output(uint8_t pos, bool level);` | Command (posts to owner; returns status) |
| kode_sys.h:2209 | `kode_status_t kode_sys_exp_write(uint8_t pos, bool level);` | Command (posts to owner; returns status) |
| kode_sys.h:2216 | `bool kode_sys_exp_level(uint8_t pos);` | Immediate (returns a copy, flag or pin) |
| kode_sys.h:2228 | `kode_status_t kode_sys_exp_adc(uint8_t pos, uint16_t *raw, int32_t *mv, bool *calibrated);` | Command (posts to owner; returns status) |
| kode_sys.h:2239 | `kode_status_t kode_sys_exp_pwm(uint8_t pos, uint32_t hz, uint16_t duty_x10);` | Command (posts to owner; returns status) |
| kode_sys.h:2250 | `kode_status_t kode_sys_exp_irq(uint8_t pos, kode_sys_gpio_irq_t kind, kode_sys_gpio_cb_t cb, void *arg);` | Command (posts to owner; returns status) |
| kode_sys.h:2258 | `void kode_sys_exp_irq_enable(uint8_t pos);` | Immediate (returns a copy, flag or pin) |
| kode_sys.h:2266 | `kode_status_t kode_sys_exp_release(uint8_t pos);` | Command (posts to owner; returns status) |
| kode_sys.h:2275 | `kode_status_t kode_sys_exp_info(uint8_t pos, kode_sys_exp_info_t *out);` | Command (posts to owner; returns status) |
| kode_sys.h:2288 | `kode_status_t kode_sys_exp_lend(const uint8_t *pos, size_t n, const char *tag, uint8_t *gpio);` | Command (posts to owner; returns status) |
| kode_sys.h:2296 | `kode_status_t kode_sys_exp_return(const char *tag);` | Command (posts to owner; returns status) |
| kode_sys.h:2311 | `kode_status_t kode_sys_exp_ctrl(kode_sys_exp_bus_t bus, const char *tag, uint8_t *id);` | Command (posts to owner; returns status) |

Note: `kode_pin_power_5v` and `kode_sys_exp_power` are listed under Power; `kode_pin_power_3v3` is in the table above.

### Return values, errors, events and constants

- Header J3 (kode.h:1675-1683): fourteen positions, numbered as printed on the connector (`KODE_PIN_FIRST` 1, `KODE_PIN_LAST` 14). A pin is configured by the call that uses it. Calls block, one task at a time, and fail (`kode_error()` says why) when the pin does not exist, a module holds it, or something else in the image owns the header. A pin something listens to (`pin_<n>_changed`) is read, never driven.
- `kode_pin_write` (1699) makes the pin an output; `kode_pin_read` (1706) makes a pin that is neither input nor output an input with no pull, true for high; `kode_pin_read_analog` (1713) takes pins 8 to 12 or 14 only and returns millivolts, 0 with a reason otherwise; `kode_pin_write_pwm` (1722) hz 1 to 40000 (`KODE_PIN_PWM_HZ_MIN/MAX`, 1687-1688) duty 0 to 100 percent. Docs (device/expansion) **(docs)**: pins 1 and 20 are 5 V, 2 and 19 are 3.3 V, pins 3 to 9 and 12 to 18 are GPIO8 to GPIO21 and GPIO16..21 read on ADC1 while the others are digital only; this differs in detail from the "8 to 12 or 14" analog pins of kode.h:1713 (Open question 2). The ADC millivolt full scale is not stated (the example `expansion_io` uses 3100 as `EXPIO_ADC_FULL_MV`).
- `kode_pin_power_3v3(on)` (1756): switches J3's 3.3 V (pins 2 and 19) via the C5 and waits up to `KODE_PIN_POWER_MS` 300000. Its state at app start is not promised; the first call always switches it. Reasons include "the C5 would not switch J3's supply", "J3's supply did not switch within 300 s". `kode_pin_power_5v` is not switched here.
- Events `pin_<n>_changed`, n 1 to 14 (kode.h event list): value is the new level; each change is read 30 ms (`KODE_PIN_SETTLE_MS`, 1690) after the edge, bounces collapse to one event at the settled level, and an edge that settles back at the last level sends nothing. A pin with a listener stays an input: `kode_pin_write`, `kode_pin_write_pwm`, `kode_pin_read_analog` and a bus begin on it fail with "pin N is listened to".
- Buses (kode.h:1789-1791 tags "i2c", "spi", "uart"): the bus calls take pin numbers (sda, scl; sck, miso, mosi, cs; tx, rx). A pin lent to a bus cannot be listened to.
  - I2C: 10000 to 400000 Hz (`KODE_I2C_HZ_MIN/MAX`, 1793-1794); 7-bit addresses 0 to 0x7F (1796); timeout `KODE_I2C_TIMEOUT_MS` 100 (1795). `kode_i2c_probe` returns false with an empty error when nobody answers.
  - SPI: 100000 to 10000000 Hz (1859-1860), mode 0 to 3 (1861), transfer at most 64 bytes (1862).
  - UART: 1200 to 921600 baud (1907-1908), RX ring 1024 bytes (1909), 8N1; `kode_uart_read(buf, cap, ms)` waits up to `ms`; `kode_uart_write` returns the bytes taken.
- kode_sys (kode_sys.h:2135-2311): positions 1 to 14 (`KODE_SYS_EXP_POS_MIN/MAX`), PWM 1 to 40000 Hz with duty in tenths of a percent, 1000 = full (`KODE_SYS_EXP_PWM_DUTY_MAX`, 2139); pull enum NONE, UP, DOWN; IRQ kinds LOW_LEVEL, ANY_EDGE, HIGH_LEVEL; pin modes FREE, IN, OUT, ADC, PWM, LENT; bus kinds I2C, SPI, UART. `KODE_EXISTS` means something else owns the header. `kode_sys_exp_adc` returns `raw`, `mv` and `calibrated`. `kode_sys_exp_lend/return/ctrl` hand pins to a bus driver by tag.

### Signals and events

| Signal | Payload | When |
|---|---|---|
| `IOEXP_INPUT_SIG` (kqp_signals.h:183) | `IoexpInputEvt` (kqp_signals.h:3405, closing line) | What the I/O expander's eight pins read (board-internal expander, not J3). |
| `EXP_POWER_SIG` (kqp_signals.h:448) | `ExpPowerDoneEvt` (kqp_signals.h:4775, closing line) | Answer to `kode_sys_exp_power`: rc OK, IO_ERROR or DENIED. |
| Event `pin_<n>_changed` | `kode_event_t` | Pin n settled at a new level. |

## 2. Scenarios (Given / When / Then)

1. **Digital out.** `kode_pin_write(5, true)` then the wiring object connected to pin 5 (an LED) shows lit.
2. **Digital in.** Given a button object wired to pin 6 with pull-up behaviour (not stated); `kode_pin_read(6)` returns the level; a press raises `pin_6_changed` after 30 ms.
3. **Bounce.** A 5 ms glitch settles back: no event.
4. **Listened pin.** After adding a listener for pin 6, `kode_pin_write(6, true)` fails with "pin 6 is listened to".
5. **Analog.** Pin 8 wired to a potentiometer at 1.65 V: `kode_pin_read_analog(8)` returns about 1650 mV; pin 3 fails with a reason (no analog input).
6. **PWM.** `kode_pin_write_pwm(9, 1000, 50)`: pin 9 shows a 1 kHz 50% waveform; 0 Hz or 40001 Hz refused.
7. **Bad pin.** Pin 0 or 15: refused ("the pin does not exist").
8. **3.3 V rail.** `kode_pin_power_3v3(true)` returns true when the C5 link is up, supply shown on pins 2 and 19; with the link down it fails after a wait ("the C5's link would not come up...").
9. **I2C device.** Given a device at 0x48: `kode_i2c_begin(sda,scl,100000)`, `kode_i2c_probe(0x48)` true; probe at 0x49 false with empty `kode_error()`; `kode_i2c_write_read(0x48, reg, 1, buf, 2)` returns the register bytes.
10. **I2C limits.** 5 kHz or 500 kHz: refused; address 0x80: refused.
11. **SPI loopback.** `kode_spi_begin(...)`, `kode_spi_transfer(out, in, 8)` with MISO tied to MOSI returns what was sent; 65 bytes refused.
12. **UART echo.** `kode_uart_begin(tx,rx,115200)`, `kode_uart_write("hi")`, a peripheral echoing returns the bytes in `kode_uart_read` within `ms`; silence returns 0 after `ms`.
13. **Header owned.** Given a module (Maker/Robotics) attached: the pins it holds fail with the "a module holds it" reason.
14. **Bus pin conflicts.** `kode_i2c_begin` on a pin already used as PWM fails.

## 3. Bench object model

The brief's approved bench objects do not include anything on the expansion header. The model below is proposed to make this area testable (see Open question 1).

### 3.1 Header wiring (proposed)

| Field | Type | Range | Default |
|---|---|---|---|
| pin n attached device | enum | none, LED, button, potentiometer, scope probe | none |
| button/pot value | bool / mV | 0 to full scale | low / 1650 |
| external pull | enum | none, up, down | none |
| module present | enum | none, Maker, Robotics (docs, design stage 5) | none |

### 3.2 I2C peripheral (proposed)
Fields: address (0..0x7F), register map (bytes), nack fault. Defaults: none present.

### 3.3 SPI / UART peripheral (proposed)
SPI: loopback or fixed reply bytes; modes 0..3 accepted. UART: echo, scripted reply, baud (must match the app's, otherwise garbage). Defaults: none.

## 4. Data formats

- Pin level bool; analog in millivolts (reference not stated); PWM hz + duty percent (kode.h) or tenths (kode_sys); I2C byte transfers with 7-bit addresses; SPI full-duplex up to 64 bytes; UART 8N1 byte stream.
- J3 layout **(docs, device/expansion)**: a 2 x 10 header; pins 1 and 20 are 5 V, pins 2 and 19 are 3.3 V, pins 3 to 9 and 12 to 18 are GPIO8 to GPIO21. kode.h:1675 calls the fourteen GPIO positions "the number printed on the connector", and kode.h:1756 speaks of "J3's pins 2 and 19" for 3.3 V: the mapping from the 14 positions to the 20 physical pins is not stated (Open question 6).

## 5. Open questions

1. **Objects for the header**: none approved. Default: the proposed wiring objects, built in delivery stage 5.
2. **Analog-capable pins**: kode.h says 8 to 12 and 14; docs say GPIO16..21. Default: follow kode.h (positions 8 to 12 and 14).
3. **ADC full scale**: not stated. Default 3100 mV (the example constant), flagged.
4. **Pull-ups on input pins**: `kode_pin_read` sets no pull. Default: floating pins read low.
6. **Position vs physical pin numbering**: kode.h positions 1 to 14 against the docs' pins 1 to 20 (power pins included). Default: bench pins are the kode.h positions; the physical layout is shown as documentation only.
5. **Module identification** (Maker, Robotics): not stated in the API read. Default: out of scope until stage 5 detail is available.


# USB

## 1. API surface

No USB data API exists in kode.h or kode_sys.h. The public surface is only: `kode_power_is_usb_connected` (kode.h:1603), the `vbus`/`vbus_mv` fields of `kode_sys_battery_t` and `PowerEvt`, the rules that boost is refused and power-off or sleep is refused while USB or a cable is present (kode.h:1619, kode_sys.h:480-490), and the cable being the console port (`kode_sys_console_congested`, kode_sys.h:1833; console verbs in the Console area). The docs state that USB protocol details are not given **(docs)**. Everything USB-related is therefore covered by the Power and Console tables above; no functions are mapped here.

## 2. Scenarios (Given / When / Then)

1. **Plug in.** Given battery 60% and no cable; When the user plugs the USB cable into the computer object; Then within 2000 ms `kode_power_is_usb_connected()` is true, `PowerEvt.vbus` is true, charging starts (see Power).
2. **Unplug.** The reverse; `kode_power_off()` then works (on battery).
3. **Console over the cable.** With the cable plugged and a computer terminal open, `kode_print` lines appear there and typed verbs are accepted.
4. **Cable without computer** (charger only): VBUS true, no console peer; `kode_print` output is discarded or buffered; `kode_sys_console_congested` may become true.
5. **Power off with cable.** `kode_power_off()` returns false with "the board cannot switch off while USB is plugged in".
6. **Boost with cable.** `kode_pin_power_5v(true)` is refused.

## 3. Bench object model

### 3.1 USB cable with computer

| Field | Type | Range | Default |
|---|---|---|---|
| plugged | bool | | false |
| computer attached | bool | | true |
| VBUS voltage | mV | not stated | 5000 |
| console terminal | text | see Console | empty |
Actions: plug, unplug, type into the terminal, copy output. Displays back: connected state and console lines.

## 4. Data formats
Console text only. No USB descriptors, protocols or data transfers are exposed by the API; none must be emulated.

## 5. Open questions

1. **Flashing apps over USB** (`kode_sys_flash`, kode_sys.h:267; app receive protocol `RECV_*` signals): the bench loads apps from the browser instead. Default: not emulated.
2. **VBUS level and charger detection details** (`vbus_mv` in `PowerEvt`): not stated. Default 5000 mV.


# Console

## 1. API surface

### kode.h (blocking API, task context only)

| Line | Prototype | Wait | Failure value |
|---|---|---|---|
| kode.h:123 | `void kode_print(const char *fmt, ...) KODE_PRINTF_FORMAT(1, 2);` | no wait parameter | n/a (void) |

### kode_sys.h (Active Object API)

| Line | Prototype | Kind |
|---|---|---|
| kode_sys.h:1833 | `bool kode_sys_console_congested(void);` | Immediate (returns a copy, flag or pin) |

### Return values, errors, events and constants

- `kode_print(fmt, ...)` (kode.h:123): writes one line through the system log as `!N <ms> app <text>`; shown whatever `config key="log"` filters, unless the log is off. Text longer than `KODE_PRINT_MAX` - 1 = 199 bytes (kode.h:112, 200 including NUL) is cut; no newline is needed; NULL `fmt` prints nothing and sets `kode_error()`.
- `kode_sys_console_congested()` (kode_sys.h:1833): true when the console cannot take more.
- Console verbs seen in headers and examples (not an API; the "computer" object in the USB area is the console peer): `btn`, `time set`, `config key=... value`, `wifi_scan`, `ble_scan`, `wifi_up`, `wifi_join ssid="..." pass="..."`, `ps`, `exp`, `ship_mode`, `function_list`, `function name="reset"`, `function name="add" arg=<n>`. The Bluetooth console uses the same verbs as the USB-C cable (docs/internals **(docs)**).
- Console-visible app tables (kaos, outside kode.h; see Uncovered functions): `KODE_VARIABLES_ADD` and `KODE_FUNCTIONS_ADD` with types NONE, INT, BOOL, ENUM, STRING. Limits: names `[a-z0-9_]` up to 15 characters, description 48 characters, 32 variables, 64 functions, string argument 256 characters, watch period 100 to 60000 ms.

## 2. Scenarios (Given / When / Then)

1. **Print.** `kode_print("hello %d", 5)` shows `!<n> <ms> app hello 5` in the bench console with the uptime in ms.
2. **Cut.** A 300 byte text is cut at 199 bytes.
3. **Log off.** Given `config log=off`: nothing is shown.
4. **Congestion.** If the console reader is stopped, `kode_sys_console_congested()` becomes true after the buffer fills (buffer size not stated).
5. **Console buttons.** The command `btn top` injects a press like the face button.
6. **Function call.** `function name="add" arg=3` calls the app's registered function; the answer prints in the console.

## 3. Bench object model

The console is the shared text channel to the computer (see USB). No separate bench object is approved; the "USB cable with computer" object carries it.

| Field | Type | Range | Default |
|---|---|---|---|
| log filter (`config log`) | enum | levels from `KLOG_D/I/N/W/E` or off | not stated (Open question 1) |
| scrollback lines | int | | 1000 |
| input | text | console verbs above | empty |
Displays back: every `kode_print` line and system log line, with the `!N <ms> app` prefix, and the answer to each verb typed.

## 4. Data formats

- Output line: `!N <ms> app <text>`, text at most 199 bytes (kode.h:123 comment). System log lines use the macros `KLOG_D/I/N/W/E` (klog/include/kode_log.h). The meaning of `N` (a sequence or level) is not stated.
- Input: `verb key=value key="quoted value"` lines (as in the examples read).

## 5. Open questions

1. **Default log level and the meaning of `N`**: not stated. Default: all levels shown, `N` as a running line counter.
2. **Console buffer size for "congested"**: not stated. Default: 4 KiB.
3. **Which console verbs the bench implements**: Default: `btn`, `time set`, `config`, `function_list`, `function`, plus `ps` as a stub; hardware verbs (`wifi_up`, `ship_mode`) accepted and logged.


# Delivery stages mapped to areas

Stages are from the design doc (docs/superpowers/specs/2026-11-16-dotbench-design.md). Placement of areas the design does not name is marked "(recommended)".

| Stage (design doc) | Areas | Bench objects built | Notes |
|---|---|---|---|
| 0 Foundation | System, Events, Console (print only) (recommended) | none | Conventions section, `kode_error`, task-vs-AO refusal, event dispatcher, `kode_print` to a console pane. |
| 1 Base: screen, touch, buttons, LED, vibration, time, files (IndexedDB), console, load app | Buttons/touch/display, LED, Haptic, Time, Files (flash volume only; microSD object waits for stage 4), Settings (recommended), Console | Face buttons, touchscreen, display mirror, RGB LED, vibration motor, clock, settings store, flash volume | Events used by buttons and touch. |
| 2 NFC and RFID | NFC, RFID | NFC tag, NFC card, NFC reader, EM4100 card, T5577 tag, door reader | Emulation scenarios depend on Open question 1 of NFC. |
| 3 Wi-Fi, HTTP, MQTT (WebSocket) and Bluetooth | Wi-Fi, Network, Bluetooth LE | Router (with internet gateway and the proposed HTTP/MQTT/UDP services), sensor peripheral, phone | HTTP is subject to CORS (design doc); UDP is virtual. |
| 4 Infrared, microSD, USB, battery, motion, audio | Infrared, Files (microSD), USB, Power, Motion, Audio | IR remote, TV, microSD card, USB cable with computer, charger/battery, tilt and shake, speaker/microphone | Capture files use the microSD or flash volume. |
| 5 Expansion modules (pins, I2C, SPI, UART; Maker and Robotics first) | Expansion | Proposed header wiring and I2C/SPI/UART peripherals | No approved bench object exists; see Expansion Open question 1. |

# Functions that no approved bench object covers

Counts are over the 170 kode.h and 120 kode_sys.h prototypes mapped above.

**A. Runtime or plumbing only (no external object makes sense):** `kode_error`, `kode_exit`, `kode_random`, `kode_sys_flash`, `kode_sys_exit_to_os`, `kode_sys_home_defer`, `kode_sys_home_now`, `kode_sys_screen_parked`, `kode_sys_console_congested`, `kode_sys_wifi_frames`, `kode_sys_http_file_stop`, `kode_sys_exp_lend`, `kode_sys_exp_return`, `kode_sys_exp_ctrl`, `kode_sys_ble_service_fault`, `kode_sys_ble_subscribe`, `kode_sys_audio_stream_write`, `kode_sys_audio_stream_open`, `kode_sys_audio_stream_close`. The `kode_event_*` name getters are constants and need no object.

**B. Need objects that are not in the approved list** (proposed in the Expansion and Network sections): `kode_pin_write`, `kode_pin_read`, `kode_pin_read_analog`, `kode_pin_write_pwm`, `kode_pin_power_3v3`, `kode_i2c_begin`, `kode_i2c_probe`, `kode_i2c_write`, `kode_i2c_read`, `kode_i2c_write_read`, `kode_i2c_end`, `kode_spi_begin`, `kode_spi_transfer`, `kode_spi_end`, `kode_uart_begin`, `kode_uart_write`, `kode_uart_read`, `kode_uart_end`, `kode_sys_exp_input`, `kode_sys_exp_output`, `kode_sys_exp_write`, `kode_sys_exp_level`, `kode_sys_exp_adc`, `kode_sys_exp_pwm`, `kode_sys_exp_irq`, `kode_sys_exp_irq_enable`, `kode_sys_exp_release`, `kode_sys_exp_info`, `kode_sys_exp_lend`, `kode_sys_exp_return`, `kode_sys_exp_ctrl`; and the service side of `kode_http_*`, `kode_udp_send`, `kode_mqtt_*`, `kode_net_resolve` (the router object gives reachability only; the servers behind it are proposed).

**C. Exist outside kode.h and kode_sys.h (not mapped to bench objects):** `kode_init`, `kode_up` (kode_init.h); `kode_worker_start`, `kode_worker_submit` (kode_worker.h); `kode_variables_add`, `kode_functions_add`, `kode_config_add`, `function_ticket`, `function_record`, `function_end`, `function_quote` (kaos/core/include); the `kode_cert_*` functions (kode_cert.h, certification only, not app API); the logging macros `KLOG_D/I/N/W/E` (klog/include/kode_log.h); `KODE_APP_MANIFEST` (kapp_desc.h:196); the LVGL screen API of `kscreen/include/kscreen.h` for an AO's own screen. The console-registered variables and functions (`KODE_VARIABLES_ADD`, `KODE_FUNCTIONS_ADD`) are surfaced through the Console object only.

**D. Partly covered:** `kode_mag_calibrate` (needs the tilt/yaw controls and the screen; see Motion), `kode_power_off` (needs the "powered off" runtime state; see Power), `kode_ble_*` GATT-server calls (covered by the phone object, not by the sensor object).

