/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * kweb_bridge: the seam between the C firmware (compiled to WebAssembly) and
 * the page. Everything the page may read or write lives in ONE struct,
 * kweb_state_t, in shared linear memory; its address is returned by the
 * exported kweb_state(). The page reads it through typed-array views over
 * Module.HEAPU8.buffer (a SharedArrayBuffer under -pthread).
 *
 * Layout and protocol are documented in runtime/bridge/README.md; the offsets
 * are pinned by _Static_asserts in kweb_bridge.c, so the document cannot drift.
 */
#ifndef KWEB_BRIDGE_H
#define KWEB_BRIDGE_H

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define KWEB_MAGIC            0x4B574542u   /* "KWEB" */
#define KWEB_ABI_VERSION      1u

#define KWEB_FB_WIDTH         410u          /* the Kode Dot's glass */
#define KWEB_FB_HEIGHT        502u
#define KWEB_FB_FMT_RGBA8888  1u            /* bytes in memory: R, G, B, 0xFF */
#define KWEB_FB_BYTES         (KWEB_FB_WIDTH * KWEB_FB_HEIGHT * 4u)

/* Buttons: the same numbers as KODE_SYS_BUTTON_x / kdrv_button_t. */
#define KWEB_BTN_UP     0u
#define KWEB_BTN_DOWN   1u
#define KWEB_BTN_LEFT   2u
#define KWEB_BTN_RIGHT  3u
#define KWEB_BTN_TOP    4u
#define KWEB_BTN_BOT    5u
#define KWEB_BTN_COUNT  6u

/* Text channels of the C -> JS ring. */
#define KWEB_CH_LOG       0u   /* klog / ESP_LOGx lines, one line per record */
#define KWEB_CH_CONSOLE   1u   /* the console's output stream (AO_Console)   */
#define KWEB_CH_STDOUT    2u   /* anything the app printf()s                  */

#define KWEB_TEXT_RING_BYTES  (64u * 1024u)

/* Event flags in kweb_state_t.events: set by C, cleared by the page. */
#define KWEB_EVT_RESTART_REQUESTED   0x1u   /* khal_restart() was called */
#define KWEB_EVT_PANIC               0x2u   /* khal_panic() was called   */

/* All fields are 32-bit aligned; "volatile" fields are written by one side and
 * read by the other without a lock (aligned 32-bit accesses are atomic). */
typedef struct kweb_state {
    /* ---- 0x000 header ---------------------------------------------------- */
    uint32_t magic;               /* KWEB_MAGIC                               */
    uint32_t abi_version;         /* KWEB_ABI_VERSION                         */
    uint32_t struct_size;         /* sizeof(kweb_state_t)                     */
    volatile uint32_t events;     /* KWEB_EVT_* bits (page clears)            */

    /* ---- 0x010 display ----------------------------------------------------- */
    uint32_t fb_width;            /* 410                                      */
    uint32_t fb_height;           /* 502                                      */
    uint32_t fb_format;           /* KWEB_FB_FMT_RGBA8888                     */
    uint32_t fb_stride;           /* bytes per row (width * 4)                */
    uint32_t fb_offset;           /* byte offset of fb[] from the struct base */
    volatile uint32_t frame_seq;  /* +1 after every frame that reached the glass */
    volatile uint32_t dirty_y1;   /* first row changed by the last frame      */
    volatile uint32_t dirty_y2;   /* last row changed by the last frame (incl.) */
    volatile uint32_t panel_on;   /* 1 = panel awake, 0 = in sleep            */
    volatile uint32_t backlight;  /* 0..100 per cent                          */
    volatile uint32_t flushes;    /* flushes completed (all areas), diagnostics */
    uint32_t reserved_display[5];

    /* ---- 0x050 outputs the page renders --------------------------------------- */
    volatile uint32_t led_rgb;    /* 0x00RRGGBB, each 0..255, as the chip drives it */
    volatile uint32_t led_seq;    /* +1 on every LED register change          */
    volatile uint32_t haptic;     /* 0..255 current vibration level           */
    volatile uint32_t haptic_seq;
    uint32_t reserved_out[4];

    /* ---- 0x070 inputs the page writes ------------------------------------------ */
    volatile uint32_t buttons;    /* bit n = KWEB_BTN_n pressed               */
    volatile int32_t  touch_x;    /* glass pixels                             */
    volatile int32_t  touch_y;
    volatile uint32_t touch_down; /* 1 = finger on glass                      */
    volatile uint32_t touch_seq;  /* +1 on every kweb_touch()                 */
    uint32_t reserved_in[3];

    /* ---- 0x090 C -> JS text ring (records, see README) ------------------------- */
    volatile uint32_t text_head;  /* total bytes ever written (producer)      */
    volatile uint32_t text_tail;  /* total bytes ever consumed (drain)        */
    volatile uint32_t text_dropped;
    volatile uint32_t text_lock;  /* producers' spin lock (page never touches) */
    uint32_t text_offset;         /* byte offset of text[] from the struct base */
    uint32_t text_size;           /* KWEB_TEXT_RING_BYTES                     */
    uint32_t reserved_text[2];

    /* ---- 0x0B0 room to grow: one area per later stage ----------------------------
     * Stage 2 NFC/RFID, stage 3 radio, stage 4 IR/SD/USB/battery/motion/audio,
     * stage 5 expansion pins. New fields go in here, never move the ones above. */
    /* 0x0B0 boot and reset: the host writes boot_* before the program starts (noInitialRun,
     * then callMain), the firmware writes restart_* when it asks for a restart. */
    volatile uint32_t boot_reason;     /* 0x0B0 KWEB_RESET_*: why this boot happens (host -> C)   */
    volatile uint32_t boot_count;      /* 0x0B4 boots since the page created the device (host)     */
    volatile uint32_t restart_reason;  /* 0x0B8 KWEB_RESET_* the firmware asked for (C -> host)    */
    volatile uint32_t restart_seq;     /* 0x0BC +1 per request; events bit RESTART_REQUESTED too   */
    char     restart_target[32];       /* 0x0C0 program to start next, "" = the same one (C -> host) */
    char     boot_name[32];            /* 0x0E0 name of the running program (host -> C)            */
    char     boot_version[32];         /* 0x100 its version (host -> C)                            */
    uint32_t growth[160];         /* 0x120, 640 bytes */

    /* ---- 0x3A0 big buffers: framebuffer, then the text ring ---------------------- */
    uint8_t  fb[KWEB_FB_BYTES];
    uint8_t  text[KWEB_TEXT_RING_BYTES];
} kweb_state_t;

/* Reset reasons, numbered as ESP-IDF's esp_reset_reason_t (= KDRV_RESET_*). */
#define KWEB_RESET_UNKNOWN   0u
#define KWEB_RESET_POWERON   1u
#define KWEB_RESET_EXTERNAL  2u
#define KWEB_RESET_SOFTWARE  3u
#define KWEB_RESET_PANIC     4u
#define KWEB_RESET_INT_WDT   5u
#define KWEB_RESET_TASK_WDT  6u
#define KWEB_RESET_WDT       7u
#define KWEB_RESET_DEEPSLEEP 8u
#define KWEB_RESET_BROWNOUT  9u

/* ---- exported to the page (see exports.txt) ------------------------------------ */
kweb_state_t *kweb_state(void);
void kweb_button(int id, int pressed);
void kweb_touch(int x, int y, int down);
/* Copies whole records into dst (up to cap bytes) and returns the byte count. */
uint32_t kweb_text_drain(uint8_t *dst, uint32_t cap);
uint32_t kweb_text_pending(void);
/* echo = 1 also prints every text record to the process stdout (debugging, Node tests). */
void kweb_text_echo(int on);
uint32_t kweb_abi_version(void);

/* ---- used by the C side (drivers, idf) ------------------------------------------- */
void kweb_text_write(unsigned channel, const char *text, unsigned len);
void kweb_text_printf(unsigned channel, const char *fmt, ...) __attribute__((format(printf, 2, 3)));

/* Hooks the input drivers register; the exported kweb_button()/kweb_touch() call
 * them after the shared state is updated. May be NULL until the driver starts. */
typedef void (*kweb_input_hook_t)(void);
/* Ask the host to end this program: records the reason (and optionally the name of the
 * program to start next), raises KWEB_EVT_RESTART_REQUESTED, then parks the calling
 * thread for good. The host terminates every worker and boots again. Never returns. */
void kweb_restart(uint32_t reason, const char *target) __attribute__((noreturn));

/* Memory that must survive a restart (the keep store, NVS, later: SD image, ...). Register
 * a fixed buffer from a constructor; the host copies every region out before it tears the
 * program down and back in before the next one starts, and may mirror them to IndexedDB. */
#define KWEB_PERSIST_MAX 8
void kweb_persist_register(const char *name, void *ptr, uint32_t size);
uint32_t kweb_persist_count(void);
const char *kweb_persist_name(uint32_t i);
void *kweb_persist_ptr(uint32_t i);
uint32_t kweb_persist_size(uint32_t i);

void kweb_set_button_hook(kweb_input_hook_t hook);
void kweb_set_touch_hook(kweb_input_hook_t hook);

#ifdef __cplusplus
}
#endif
#endif /* KWEB_BRIDGE_H */
