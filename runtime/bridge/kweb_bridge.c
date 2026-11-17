/* SPDX-License-Identifier: GPL-3.0-or-later */
#include "page_lock.h"
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
_Static_assert(offsetof(kweb_state_t, boot_reason) == 0x0B0, "boot block");
_Static_assert(offsetof(kweb_state_t, boot_version) == 0x100, "boot block");
_Static_assert(offsetof(kweb_state_t, growth) == 0x120, "growth area");
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

#include <pthread.h>
#include <unistd.h>
__attribute__((constructor(102))) static void kweb_ctor(void) { state_init(); }

EMSCRIPTEN_KEEPALIVE kweb_state_t *kweb_state(void)
{
    state_init();
    return &g_state;
}

EMSCRIPTEN_KEEPALIVE uint32_t kweb_abi_version(void) { return KWEB_ABI_VERSION; }

/* ---- inputs: lock-free hand-over from the page's thread to an input pump thread -------------------
 * kweb_button()/kweb_touch() run on the page's (main) thread and must never block: they push an event
 * into a single-producer single-consumer ring and wake the pump with a futex wake (non-blocking). The
 * pump thread applies the event to the shared state and calls the driver hook, in order. */
#include <emscripten/threading.h>
#include <pthread.h>

typedef struct { uint8_t kind; uint8_t id; uint8_t down; int16_t x, y; } in_evt_t;
#define IN_RING 256u
static in_evt_t g_in[IN_RING];
static volatile uint32_t g_in_head, g_in_tail;     /* head: producer, tail: consumer */
static volatile uint32_t g_in_wake;
static volatile uint32_t g_in_dropped;
static volatile uint32_t g_pump_state;             /* 0 none, 1 being created, 2 running (never pthread_once: see ensure_pump) */

static void apply(const in_evt_t *e)
{
    if (e->kind == 0) {
        if (e->down) __atomic_fetch_or(&g_state.buttons, 1u << e->id, __ATOMIC_SEQ_CST);
        else         __atomic_fetch_and(&g_state.buttons, ~(1u << e->id), __ATOMIC_SEQ_CST);
        if (g_button_hook) g_button_hook();
    } else {
        g_state.touch_x = e->x;
        g_state.touch_y = e->y;
        g_state.touch_down = e->down ? 1u : 0u;
        __atomic_fetch_add(&g_state.touch_seq, 1u, __ATOMIC_SEQ_CST);
        if (g_touch_hook) g_touch_hook();
    }
}
static void *pump(void *arg)
{
    (void)arg;
    for (;;) {
        uint32_t t = __atomic_load_n(&g_in_tail, __ATOMIC_ACQUIRE);
        if (t == __atomic_load_n(&g_in_head, __ATOMIC_ACQUIRE)) {
            uint32_t w = __atomic_load_n(&g_in_wake, __ATOMIC_ACQUIRE);
            if (t == __atomic_load_n(&g_in_head, __ATOMIC_ACQUIRE)) {
                emscripten_futex_wait(&g_in_wake, w, 1000.0);
            }
            continue;
        }
        in_evt_t e = g_in[t % IN_RING];
        apply(&e);
        __atomic_store_n(&g_in_tail, t + 1u, __ATOMIC_RELEASE);
    }
    return NULL;
}
static void start_pump(void)
{
    pthread_t th;
    pthread_attr_t at;
    pthread_attr_init(&at);
    pthread_attr_setdetachstate(&at, PTHREAD_CREATE_DETACHED);
    pthread_attr_setstacksize(&at, 128 * 1024);
    pthread_create(&th, &at, pump, NULL);
}
/* Starts the pump once. NOT pthread_once: a firmware task that calls it first runs pthread_create inside the once, and a worker's
 * pthread_create is proxied to the page's main thread (it waits for that thread's event loop); a kweb_touch() on the main thread that
 * found the once in progress would wait for it, spinning inside wasm, and neither could ever continue (the settings-check hang after a
 * boot, docs/STATUS-panic.md). Here a caller that finds the pump being created simply goes on: the event waits in the ring. */
static void ensure_pump(void)
{
    if (__atomic_load_n(&g_pump_state, __ATOMIC_ACQUIRE) != 0u) return;
    uint32_t none = 0u;
    if (!__atomic_compare_exchange_n(&g_pump_state, &none, 1u, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) return;
    start_pump();
    __atomic_store_n(&g_pump_state, 2u, __ATOMIC_RELEASE);
}
static void push(in_evt_t e)
{
    uint32_t h = __atomic_load_n(&g_in_head, __ATOMIC_RELAXED);
    if (h - __atomic_load_n(&g_in_tail, __ATOMIC_ACQUIRE) >= IN_RING) { g_in_dropped++; return; }
    g_in[h % IN_RING] = e;
    __atomic_store_n(&g_in_head, h + 1u, __ATOMIC_RELEASE);
    __atomic_fetch_add(&g_in_wake, 1u, __ATOMIC_RELEASE);
    emscripten_futex_wake(&g_in_wake, 1);
}

EMSCRIPTEN_KEEPALIVE void kweb_button(int id, int pressed)
{
    if (id < 0 || (unsigned)id >= KWEB_BTN_COUNT) return;
    ensure_pump();
    push((in_evt_t){ .kind = 0, .id = (uint8_t)id, .down = pressed ? 1 : 0 });
}

EMSCRIPTEN_KEEPALIVE void kweb_touch(int x, int y, int down)
{
    ensure_pump();
    push((in_evt_t){ .kind = 1, .down = down ? 1 : 0, .x = (int16_t)x, .y = (int16_t)y });
}

void kweb_set_button_hook(kweb_input_hook_t hook) { g_button_hook = hook; ensure_pump(); }
void kweb_set_touch_hook(kweb_input_hook_t hook) { g_touch_hook = hook; ensure_pump(); }

/* ---- the text ring -----------------------------------------------------------
 * Producers (any C thread) append records [u8 channel][u16 len LE][len bytes]
 * under a spin lock. The page drains with kweb_text_drain(). If the ring is
 * full the OLDEST whole records are discarded (counted in text_dropped), so a
 * page that stopped draining never blocks the firmware. */
volatile uint32_t g_dbpage_busy;
EMSCRIPTEN_KEEPALIVE uint32_t dbpage_busy_take(void) { return __atomic_exchange_n(&g_dbpage_busy, 0u, __ATOMIC_RELAXED); }

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
    if (!db_page_spin_take((volatile uint32_t *)&g_state.text_lock, DB_PAGE_BUDGET_MS)) return 0;   /* the page never spins unbounded */
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

/* ---- restart ------------------------------------------------------------------------ */
#include <string.h>
#include <unistd.h>

void kweb_restart(uint32_t reason, const char *target)
{
    kweb_state_t *s = kweb_state();
    memset((void *)s->restart_target, 0, sizeof s->restart_target);
    if (target) {
        strncpy((char *)s->restart_target, target, sizeof s->restart_target - 1);
    }
    s->restart_reason = reason;
    __atomic_fetch_add(&s->restart_seq, 1u, __ATOMIC_SEQ_CST);
    __atomic_fetch_or(&s->events, KWEB_EVT_RESTART_REQUESTED | (reason == KWEB_RESET_PANIC ? KWEB_EVT_PANIC : 0u),
                      __ATOMIC_SEQ_CST);
    emscripten_futex_wake((void *)&s->restart_seq, 0x7fffffff);   /* wakes a page parked in Atomics.waitAsync */
    /* The host tears every worker down; until then this thread must not run on. */
    for (;;) {
        sleep(3600);
    }
}

/* ---- persistent regions ------------------------------------------------------------- */
static struct { char name[16]; void *ptr; uint32_t size; } g_persist[KWEB_PERSIST_MAX];
static uint32_t g_npersist;

void kweb_persist_register(const char *name, void *ptr, uint32_t size)
{
    if (g_npersist < KWEB_PERSIST_MAX) {
        strncpy(g_persist[g_npersist].name, name, 15);
        g_persist[g_npersist].ptr = ptr;
        g_persist[g_npersist].size = size;
        g_npersist++;
    }
}
EMSCRIPTEN_KEEPALIVE uint32_t kweb_persist_count(void) { return g_npersist; }
EMSCRIPTEN_KEEPALIVE const char *kweb_persist_name(uint32_t i) { return i < g_npersist ? g_persist[i].name : ""; }
EMSCRIPTEN_KEEPALIVE void *kweb_persist_ptr(uint32_t i) { return i < g_npersist ? g_persist[i].ptr : 0; }
EMSCRIPTEN_KEEPALIVE uint32_t kweb_persist_size(uint32_t i) { return i < g_npersist ? g_persist[i].size : 0; }
