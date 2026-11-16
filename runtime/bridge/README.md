# kweb_bridge: the seam between the firmware (WebAssembly) and the page

Everything the page reads or writes lives in one struct, `kweb_state_t`, in the
module's shared linear memory (a `SharedArrayBuffer` under `-pthread`). The page
asks for its address once with the exported `kweb_state()` and then reads and
writes it through typed-array views on `Module.HEAPU8.buffer`. Fields are 32-bit
aligned, little-endian; a field written by one side and read by the other is
`volatile` and accessed with aligned 32-bit loads/stores (atomic). The offsets
below are pinned by `_Static_assert`s in `kweb_bridge.c`; `KWEB_ABI_VERSION` (1)
is returned by `kweb_abi_version()` and stored at offset 0x04.

## Layout (byte offsets from `kweb_state()`)

| offset | size | field | direction | meaning |
|---|---|---|---|---|
| 0x000 | 4 | `magic` | | `0x4B574542` ("KWEB") |
| 0x004 | 4 | `abi_version` | | 1 |
| 0x008 | 4 | `struct_size` | | `sizeof(kweb_state_t)` |
| 0x00C | 4 | `events` | C sets, page clears | bit0 `RESTART_REQUESTED` (khal_restart), bit1 `PANIC` (khal_panic) |
| 0x010 | 4 | `fb_width` | | 410 |
| 0x014 | 4 | `fb_height` | | 502 |
| 0x018 | 4 | `fb_format` | | 1 = RGBA8888, bytes in memory R,G,B,0xFF |
| 0x01C | 4 | `fb_stride` | | bytes per row (1640) |
| 0x020 | 4 | `fb_offset` | | byte offset of `fb[]` from the struct base (0x3A0) |
| 0x024 | 4 | `frame_seq` | C | +1 for every frame that reached the glass |
| 0x028 | 4 | `dirty_y1` | C | first row of the last frame |
| 0x02C | 4 | `dirty_y2` | C | last row of the last frame, inclusive |
| 0x030 | 4 | `panel_on` | C | 1 awake, 0 asleep or not yet lit |
| 0x034 | 4 | `backlight` | C | 0..100 per cent (0 while the panel is dark) |
| 0x038 | 4 | `flushes` | C | flush calls completed |
| 0x03C | 20 | reserved | | display |
| 0x050 | 4 | `led_rgb` | C | `0x00RRGGBB`, each 0..255, as the KTD2026 model drives it |
| 0x054 | 4 | `led_seq` | C | +1 on every change of `led_rgb` |
| 0x058 | 4 | `haptic` | C | 0..255 (stage 4) |
| 0x05C | 4 | `haptic_seq` | C | |
| 0x060 | 16 | reserved | | outputs |
| 0x070 | 4 | `buttons` | page | bit n = button n pressed (`KWEB_BTN_*`) |
| 0x074 | 4 | `touch_x` | page | glass pixels |
| 0x078 | 4 | `touch_y` | page | |
| 0x07C | 4 | `touch_down` | page | 1 finger on glass |
| 0x080 | 4 | `touch_seq` | page | +1 on every `kweb_touch()` |
| 0x084 | 12 | reserved | | inputs |
| 0x090 | 4 | `text_head` | C | total bytes ever written to the text ring |
| 0x094 | 4 | `text_tail` | page/drain | total bytes ever consumed |
| 0x098 | 4 | `text_dropped` | C | records discarded because the ring was full |
| 0x09C | 4 | `text_lock` | C | producers' spin lock; the page never touches it |
| 0x0A0 | 4 | `text_offset` | | byte offset of `text[]` |
| 0x0A4 | 4 | `text_size` | | 65536 |
| 0x0A8 | 8 | reserved | | |
| 0x0B0 | 752 | `growth[188]` | | room for later stages (NFC/RFID, radio, IR, SD, battery, motion, audio, expansion pins). New fields go in here; nothing above ever moves |
| 0x3A0 | 820160 | `fb[]` | C | 410 x 502 x 4 framebuffer |
| 0x3A0 + 820160 | 65536 | `text[]` | C | text ring |

Buttons use the SDK's own numbering: `UP 0, DOWN 1, LEFT 2, RIGHT 3, TOP 4, BOT 5`.

## Functions exported to the page

| function | meaning |
|---|---|
| `kweb_state()` | address of the struct |
| `kweb_abi_version()` | 1 |
| `kweb_button(id, pressed)` | sets/clears the bit in `buttons`, then calls the input hook of the GPIO/expander model (drives GPIO35 for TOP, the TCA6408A pins and INT for the others) |
| `kweb_touch(x, y, down)` | updates `touch_*`, then the CST820 model's frame and the TP_INT line |
| `kweb_text_drain(dst, cap)` | copies whole records into `dst`, returns bytes copied |
| `kweb_text_pending()` | bytes waiting |
| `kweb_text_echo(on)` | also echo every record to the process stdout (debugging) |
| `kweb_console_input(ptr, len)` | bytes typed on the console (from `runtime/drivers/console`) |
| `malloc`, `free` | so the page can allocate a drain buffer |

Every `runtime/**/exports.txt` is concatenated by `dotbench build` into `-sEXPORTED_FUNCTIONS`.

## Text ring protocol (C to page)

Records `[u8 channel][u16 length, little-endian][length bytes of UTF-8]`, appended
by any C thread under a spin lock; one record is at most 1024 bytes (longer text is
split). A full ring discards the oldest whole records (`text_dropped`), so a page
that stopped draining never blocks the firmware. The page drains with
`kweb_text_drain` (it advances `text_tail`). Channels:

| id | name | content |
|---|---|---|
| 0 | `LOG` | `esp_log` / `esp_rom_printf` / "dotbench: ... not implemented" |
| 1 | `CONSOLE` | the console's output stream (klog lines once AO_Log owns the console, the `kode>` prompt, command output) |
| 2 | `STDOUT` | reserved for app `printf` |

## C-side API (`kweb_bridge.h`)

`kweb_text_write(channel, text, len)`, `kweb_text_printf(channel, fmt, ...)`,
`kweb_set_button_hook(fn)`, `kweb_set_touch_hook(fn)` (hooks run on the thread that
called `kweb_button`/`kweb_touch`, after the shared state is updated).
