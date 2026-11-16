/* SPDX-License-Identifier: GPL-3.0-or-later */
#include "kweb_bridge.h"

#include <emscripten.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

/* The layout is part of the ABI: pin it. runtime/bridge/README.md quotes these. */
_Static_assert(offsetof(kweb_state_t, magic) == 0x000, "header");
_Static_assert(offsetof(kweb_state_t, fb_width) == 0x010, "display");
_Static_assert(offsetof(kweb_state_t, led_rgb) == 0x050, "outputs");
_Static_assert(offsetof(kweb_state_t, buttons) == 0x070, "inputs");
_Static_assert(offsetof(kweb_state_t, text_head) == 0x090, "text ring header");
_Static_assert(offsetof(kweb_state_t, growth) == 0x0B0, "growth area");
_Static_assert(offsetof(kweb_state_t, fb) == 0x3A0, "framebuffer");
_Static_assert(offsetof(kweb_state_t, text) == 0x3A0 + KWEB_FB_BYTES, "text ring");

/* Static storage: zero-filled, lives for the whole run. */
static kweb_state_t g_state;
static kweb_input_hook_t g_button_hook;
static kweb_input_hook_t g_touch_hook;
static volatile int g_echo;

static void state_init(void)
{
    if (g_state.magic == KWEB_MAGIC) {
        return;
    }
    g_state.abi_version = KWEB_ABI_VERSION;
    g_state.struct_size = sizeof(g_state);
    g_state.fb_width = KWEB_FB_WIDTH;
    g_state.fb_height = KWEB_FB_HEIGHT;
    g_state.fb_format = KWEB_FB_FMT_RGBA8888;
    g_state.fb_stride = KWEB_FB_WIDTH * 4u;
    g_state.fb_offset = offsetof(kweb_state_t, fb);
    g_state.text_offset = offsetof(kweb_state_t, text);
    g_state.text_size = KWEB_TEXT_RING_BYTES;
    g_state.panel_on = 0;
    g_state.backlight = 0;
    /* alpha opaque, colour black: an unpainted glass is black, not transparent */
    for (uint32_t i = 3; i < KWEB_FB_BYTES; i += 4) {
        g_state.fb[i] = 0xFF;
    }
    __atomic_store_n(&g_state.magic, KWEB_MAGIC, __ATOMIC_RELEASE);
}

__attribute__((constructor(102))) static void kweb_ctor(void) { state_init(); }

EMSCRIPTEN_KEEPALIVE kweb_state_t *kweb_state(void)
{
    state_init();
    return &g_state;
}

EMSCRIPTEN_KEEPALIVE uint32_t kweb_abi_version(void) { return KWEB_ABI_VERSION; }

EMSCRIPTEN_KEEPALIVE void kweb_button(int id, int pressed)
{
    state_init();
    if (id < 0 || (unsigned)id >= KWEB_BTN_COUNT) {
        return;
    }
    if (pressed) {
        __atomic_fetch_or(&g_state.buttons, 1u << id, __ATOMIC_SEQ_CST);
    } else {
        __atomic_fetch_and(&g_state.buttons, ~(1u << id), __ATOMIC_SEQ_CST);
    }
    if (g_button_hook != NULL) {
        g_button_hook();
    }
}

EMSCRIPTEN_KEEPALIVE void kweb_touch(int x, int y, int down)
{
    state_init();
    g_state.touch_x = x;
    g_state.touch_y = y;
    g_state.touch_down = down ? 1u : 0u;
    __atomic_fetch_add(&g_state.touch_seq, 1u, __ATOMIC_SEQ_CST);
    if (g_touch_hook != NULL) {
        g_touch_hook();
    }
}

void kweb_set_button_hook(kweb_input_hook_t hook) { g_button_hook = hook; }
void kweb_set_touch_hook(kweb_input_hook_t hook) { g_touch_hook = hook; }

/* ---- the text ring -----------------------------------------------------------
 * Producers (any C thread) append records [u8 channel][u16 len LE][len bytes]
 * under a spin lock. The page drains with kweb_text_drain(). If the ring is
 * full the OLDEST whole records are discarded (counted in text_dropped), so a
 * page that stopped draining never blocks the firmware. */
static void lock(void)
{
    while (__atomic_exchange_n(&g_state.text_lock, 1u, __ATOMIC_ACQUIRE)) {
        /* spin: critical sections are a few hundred bytes of memcpy */
    }
}
static void unlock(void) { __atomic_store_n(&g_state.text_lock, 0u, __ATOMIC_RELEASE); }

static uint8_t ring_byte(uint32_t pos) { return g_state.text[pos % KWEB_TEXT_RING_BYTES]; }

void kweb_text_write(unsigned channel, const char *text, unsigned len)
{
    state_init();
    if (g_echo) {
        fwrite(text, 1, len, stdout);
        if (len == 0 || text[len - 1] != '\n') {
            fputc('\n', stdout);
        }
        fflush(stdout);
    }
    while (len > 0) {
        unsigned n = len > 1024u ? 1024u : len;      /* one record never exceeds 1 KB */
        uint32_t need = 3u + n;
        lock();
        /* make room by dropping the oldest records */
        while ((g_state.text_head - g_state.text_tail) + need > KWEB_TEXT_RING_BYTES) {
            uint32_t t = g_state.text_tail;
            uint32_t rec = 3u + ((uint32_t)ring_byte(t + 1) | ((uint32_t)ring_byte(t + 2) << 8));
            __atomic_store_n(&g_state.text_tail, t + rec, __ATOMIC_RELEASE);
            g_state.text_dropped++;
        }
        uint32_t h = g_state.text_head;
        g_state.text[h % KWEB_TEXT_RING_BYTES] = (uint8_t)channel;
        g_state.text[(h + 1) % KWEB_TEXT_RING_BYTES] = (uint8_t)(n & 0xFFu);
        g_state.text[(h + 2) % KWEB_TEXT_RING_BYTES] = (uint8_t)(n >> 8);
        for (unsigned i = 0; i < n; i++) {
            g_state.text[(h + 3 + i) % KWEB_TEXT_RING_BYTES] = (uint8_t)text[i];
        }
        __atomic_store_n(&g_state.text_head, h + need, __ATOMIC_RELEASE);
        unlock();
        text += n;
        len -= n;
    }
}

void kweb_text_printf(unsigned channel, const char *fmt, ...)
{
    char buf[512];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    if (n < 0) return;
    if ((size_t)n >= sizeof(buf)) n = sizeof(buf) - 1;
    kweb_text_write(channel, buf, (unsigned)n);
}

EMSCRIPTEN_KEEPALIVE uint32_t kweb_text_pending(void)
{
    state_init();
    return __atomic_load_n(&g_state.text_head, __ATOMIC_ACQUIRE) -
           __atomic_load_n(&g_state.text_tail, __ATOMIC_ACQUIRE);
}

EMSCRIPTEN_KEEPALIVE uint32_t kweb_text_drain(uint8_t *dst, uint32_t cap)
{
    state_init();
    uint32_t out = 0;
    lock();
    uint32_t t = g_state.text_tail;
    uint32_t h = g_state.text_head;
    while (t != h) {
        uint32_t len = (uint32_t)ring_byte(t + 1) | ((uint32_t)ring_byte(t + 2) << 8);
        uint32_t rec = 3u + len;
        if (out + rec > cap) break;
        for (uint32_t i = 0; i < rec; i++) {
            dst[out + i] = ring_byte(t + i);
        }
        out += rec;
        t += rec;
    }
    __atomic_store_n(&g_state.text_tail, t, __ATOMIC_RELEASE);
    unlock();
    return out;
}

EMSCRIPTEN_KEEPALIVE void kweb_text_echo(int on) { g_echo = on; }
