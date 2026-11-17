/* SPDX-License-Identifier: GPL-3.0-or-later
 * khal_console over two ports, structured like khal_console_esp.c (cable + dock): replaces components/khal/console/src/khal_console_esp.c.
 *
 *   PAGE port  the bench's debug console: always open. Output goes to the CONSOLE text channel (the page's console panel), input
 *              arrives through kweb_console_input() (exported).
 *   CABLE port the USB-C cable to the Computer bench object (runtime/drivers/usb/usb_cable.c): only while plugged with a host.
 *
 * The reader task, line mode (both ports, remembering which spoke last), raw mode (pump run on the reader task, reading only the
 * port that asked, as khal_console_esp.c), rest and the request handshake are the board's logic. A write goes to both ports. */
#include "page_lock.h"
#include <pthread.h>
#include <string.h>
#include <time.h>
#include <emscripten.h>
#include "khal_console.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "kweb_bridge.h"
#include "usb_cable.h"

#define RXQ 1024
#define READER_TIMEOUT_MS 50u
#define READER_DRAIN_CHUNK 64u
#define READER_REST_MS 1000u
#define SLICE_MS 5u            /* longest cable wait before the page port is looked at again (the dock's DOCK_POLL_MS) */
#define CABLE_TX_CHUNK 128u
#define CABLE_TX_WAIT_MS 500u
typedef enum { PORT_ANY = 0, PORT_CABLE, PORT_PAGE } port_t;

static uint8_t g_rx[RXQ];
static unsigned g_head, g_tail;
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
DB_PAGE_REGISTER(console, "console", g_mu, DB_LOCK_MUTEX)
static pthread_cond_t g_cv = PTHREAD_COND_INITIALIZER;
static void (*g_on_byte)(uint8_t);
static volatile bool g_rest;
static volatile port_t g_last = PORT_ANY, g_raw_port = PORT_ANY;
static void (*volatile g_pump)(void);
static void (*volatile g_pump_req)(void);
static void (*g_on_armed)(void);

EMSCRIPTEN_KEEPALIVE void kweb_console_input(const char *s, int len)
{
    DB_PAGE_LOCK_V(&g_mu);
    for (int i = 0; i < len; i++) {
        unsigned n = (g_head + 1) % RXQ;
        if (n == g_tail) break;
        g_rx[g_head] = (uint8_t)s[i];
        g_head = n;
    }
    pthread_cond_broadcast(&g_cv);
    pthread_mutex_unlock(&g_mu);
}

static int32_t page_take(void *buf, size_t want)
{
    uint8_t *p = buf; size_t n = 0;
    pthread_mutex_lock(&g_mu);
    while (n < want && g_head != g_tail) { p[n++] = g_rx[g_tail]; g_tail = (g_tail + 1) % RXQ; }
    pthread_mutex_unlock(&g_mu);
    return (int32_t)n;
}
static void page_wait(uint32_t ms)
{
    pthread_mutex_lock(&g_mu);
    if (g_head == g_tail && ms) {
        struct timespec ts; clock_gettime(CLOCK_REALTIME, &ts);
        ts.tv_sec += ms / 1000; ts.tv_nsec += (long)(ms % 1000) * 1000000L;
        if (ts.tv_nsec >= 1000000000L) { ts.tv_sec++; ts.tv_nsec -= 1000000000L; }
        pthread_cond_timedwait(&g_cv, &g_mu, &ts);
    }
    pthread_mutex_unlock(&g_mu);
}

/* The console's one read (console_read of khal_console_esp.c): raw mode reads only its own port; line mode looks at the page port,
 * then the cable for a short slice, until something arrives. */
static int32_t console_read(void *buf, size_t want, uint32_t timeout_ms)
{
    port_t raw = g_raw_port;
    if (raw == PORT_PAGE) { int32_t n = page_take(buf, want); if (!n && timeout_ms) { page_wait(timeout_ms); n = page_take(buf, want); } return n; }
    if (raw == PORT_CABLE) return usb_cable_read(buf, want, timeout_ms);
    struct timespec t0; clock_gettime(CLOCK_MONOTONIC, &t0);
    for (;;) {
        int32_t n = page_take(buf, want);
        if (n > 0) { g_last = PORT_PAGE; return n; }
        n = usb_cable_read(buf, want, 0);
        if (n > 0) { g_last = PORT_CABLE; return n; }
        struct timespec t1; clock_gettime(CLOCK_MONOTONIC, &t1);
        long spent = (t1.tv_sec - t0.tv_sec) * 1000 + (t1.tv_nsec - t0.tv_nsec) / 1000000;
        if (spent >= (long)timeout_ms) return 0;
        uint32_t left = timeout_ms - (uint32_t)spent, slice = g_rest ? 50u : SLICE_MS;
        if (slice > left) slice = left;
        n = usb_cable_read(buf, want, slice);
        if (n > 0) { g_last = PORT_CABLE; return n; }
    }
}

void khal_console_init(void) { }
void khal_console_rest(bool rest) { g_rest = rest; }

static void reader(void *arg)
{
    (void)arg;
    for (;;) {
        if (g_pump_req) {
            port_t from = g_last;
            uint8_t junk[READER_DRAIN_CHUNK];
            while (khal_console_read_raw(junk, sizeof junk, 0) > 0) { }
            g_raw_port = (from == PORT_PAGE) ? PORT_PAGE : PORT_CABLE;
            g_pump = g_pump_req; g_pump_req = NULL;
            g_on_armed();
            continue;
        }
        void (*pump)(void) = g_pump;
        if (pump) { pump(); continue; }
        uint8_t c;
        int32_t n = console_read(&c, 1, g_rest ? READER_REST_MS : READER_TIMEOUT_MS);
        if (n != 1) continue;
        if (!g_pump_req) g_on_byte(c);
    }
}
kode_status_t khal_console_start_reader(void (*on_byte)(uint8_t), uint32_t prio)
{
    if (!on_byte) return KODE_ERROR;
    if (g_on_byte) return KODE_OK;
    g_on_byte = on_byte;
    return xTaskCreate(reader, "khal.rd", 4096, NULL, prio, NULL) == pdPASS ? KODE_OK : KODE_NO_RESOURCES;
}
kode_status_t khal_console_raw_begin(void (*pump)(void), void (*on_armed)(void))
{
    if (!pump || !on_armed || g_pump || g_pump_req) return KODE_DENIED;
    g_on_armed = on_armed;
    g_pump_req = pump;
    return KODE_OK;
}
void khal_console_raw_end(void) { g_pump = NULL; g_pump_req = NULL; g_raw_port = PORT_ANY; }
int32_t khal_console_read_raw(void *buf, size_t want, uint32_t timeout_ms)
{
    if (!buf || !want) return -1;
    return console_read(buf, want, timeout_ms);
}
void khal_console_write(const char *buf, size_t len)
{
    if (!buf || !len) return;
    kweb_text_write(KWEB_CH_CONSOLE, buf, (unsigned)len);
    for (size_t off = 0; off < len; off += CABLE_TX_CHUNK) {            /* cable_write: chunks, each whole or dropped */
        size_t n = len - off < CABLE_TX_CHUNK ? len - off : CABLE_TX_CHUNK;
        if (!usb_cable_up()) break;
        (void)usb_cable_write(buf + off, n, CABLE_TX_WAIT_MS);
    }
}
kode_status_t khal_console_dock_release(void) { return KODE_OK; }
kode_status_t khal_console_dock_take(void) { return KODE_OK; }
