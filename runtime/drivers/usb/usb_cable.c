/* SPDX-License-Identifier: GPL-3.0-or-later
 * The USB-C cable: VBUS (through the power area's own model, no logic copied) and the USB-Serial/JTAG data pipe to a computer.
 *
 * Plug state is the page's input; the firmware notices a cable only the way it does on the board: the BQ25896 input detection
 * (power area), read by AO_Power. This file never talks to the SDK. The data pipe has the board's two rings:
 *   RX (computer -> Dot) 8192 B: the hardware drops silently when it is full (a host that sends ahead of `>|ack` corrupts a transfer);
 *   TX (Dot -> computer) 64 KB here (the board's driver ring is 2 KB and the host drains at line rate): a full ring makes the
 *   writer wait, then drop, as khal_console_esp.c cable_put does.
 * Threads: the page calls the exports (write a ring and return); firmware tasks call usb_cable_read/write. */
#include "page_lock.h"
#include <pthread.h>
#include <stdatomic.h>
#include <string.h>
#include <time.h>
#include <emscripten.h>
#include "usb_cable.h"

#define RX_SZ 8192u
#define TX_SZ 65536u
extern int power_get(int id);                 /* runtime/drivers/power: G_CABLE = 7 */
extern void power_set_usb(int plugged, int kind);

static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t g_rx_cv = PTHREAD_COND_INITIALIZER, g_tx_cv = PTHREAD_COND_INITIALIZER;
static uint8_t g_rx[RX_SZ], g_tx[TX_SZ];
static unsigned g_rx_n, g_rx_r, g_tx_n, g_tx_r;     /* count and read index */
static bool g_plugged, g_host, g_stalled;
static unsigned g_rx_dropped, g_tx_dropped;
static unsigned long g_rx_total, g_tx_total;
static unsigned g_gen;                               /* bumps on every plug/unplug */

static void deadline(struct timespec *ts, uint32_t ms)
{
    clock_gettime(CLOCK_REALTIME, ts);
    ts->tv_sec += ms / 1000; ts->tv_nsec += (long)(ms % 1000) * 1000000L;
    if (ts->tv_nsec >= 1000000000L) { ts->tv_sec++; ts->tv_nsec -= 1000000000L; }
}

bool usb_cable_up(void) { return g_plugged && g_host; }

size_t usb_cable_write(const void *buf, size_t len, uint32_t wait_ms)
{
    size_t ok = 0;
    pthread_mutex_lock(&g_mu);
    if (!usb_cable_up() || len > TX_SZ) { pthread_mutex_unlock(&g_mu); return 0; }
    if (g_stalled) wait_ms = 0;
    struct timespec ts; deadline(&ts, wait_ms);
    while (TX_SZ - g_tx_n < len && wait_ms && usb_cable_up()) {
        if (pthread_cond_timedwait(&g_tx_cv, &g_mu, &ts)) break;
    }
    if (usb_cable_up() && TX_SZ - g_tx_n >= len) {
        for (size_t i = 0; i < len; i++) g_tx[(g_tx_r + g_tx_n++) % TX_SZ] = ((const uint8_t *)buf)[i];
        g_tx_total += len; ok = len; g_stalled = false;
    } else { g_stalled = true; g_tx_dropped += (unsigned)len; }
    pthread_mutex_unlock(&g_mu);
    return ok;
}

int32_t usb_cable_read(void *buf, size_t want, uint32_t timeout_ms)
{
    uint8_t *p = buf; size_t n = 0;
    pthread_mutex_lock(&g_mu);
    if (!g_rx_n && timeout_ms) { struct timespec ts; deadline(&ts, timeout_ms); pthread_cond_timedwait(&g_rx_cv, &g_mu, &ts); }
    while (n < want && g_rx_n) { p[n++] = g_rx[g_rx_r]; g_rx_r = (g_rx_r + 1) % RX_SZ; g_rx_n--; }
    pthread_mutex_unlock(&g_mu);
    return (int32_t)n;
}

/* ---- page side ---- */

/* plug(1, host): host=1 a computer with its port open (SDP 500 mA); host=0 a plain charger (adapter). Returns 0, or -1 when the
 * port is taken by a charger the power area holds (the bench's charger object) so two things never share one connector. */
EMSCRIPTEN_KEEPALIVE int usb_plug(int plugged, int host)
{
    DB_PAGE_LOCK(&g_mu, 0);
    if (plugged && !g_plugged && power_get(7) != 0) { pthread_mutex_unlock(&g_mu); return -1; }
    bool was = g_plugged;
    g_plugged = plugged != 0; g_host = g_plugged && host != 0;
    g_rx_n = g_rx_r = g_tx_n = g_tx_r = 0; g_stalled = false;   /* a new link starts empty (the endpoints' FIFOs go with the cable) */
    if (was != g_plugged) g_gen++;
    pthread_cond_broadcast(&g_rx_cv); pthread_cond_broadcast(&g_tx_cv);
    pthread_mutex_unlock(&g_mu);
    if (g_plugged) power_set_usb(1, g_host ? 1 : 2); else if (was) power_set_usb(0, 1);
    return 0;
}
/* The computer opens or closes its serial port while the cable stays in. */
EMSCRIPTEN_KEEPALIVE void usb_host(int host)
{
    DB_PAGE_LOCK_V(&g_mu);
    if (g_plugged) { g_host = host != 0; g_rx_n = g_rx_r = g_tx_n = g_tx_r = 0; g_stalled = false; }
    pthread_cond_broadcast(&g_rx_cv); pthread_cond_broadcast(&g_tx_cv);
    pthread_mutex_unlock(&g_mu);
    if (g_plugged) power_set_usb(1, g_host ? 1 : 2);
}
/* Computer -> Dot. Returns bytes taken; the rest is dropped silently when the 8 KB ring is full. */
EMSCRIPTEN_KEEPALIVE int usb_send(const uint8_t *data, int len)
{
    int n = 0;
    DB_PAGE_LOCK(&g_mu, 0);
    if (usb_cable_up()) {
        for (; n < len && g_rx_n < RX_SZ; n++) g_rx[(g_rx_r + g_rx_n++) % RX_SZ] = data[n];
        g_rx_dropped += (unsigned)(len - n); g_rx_total += (unsigned)n;
        pthread_cond_broadcast(&g_rx_cv);
    }
    pthread_mutex_unlock(&g_mu);
    return n;
}
/* Dot -> computer: drain up to cap bytes. */
EMSCRIPTEN_KEEPALIVE int usb_recv(uint8_t *out, int cap)
{
    int n = 0;
    DB_PAGE_LOCK(&g_mu, 0);
    while (n < cap && g_tx_n) { out[n++] = g_tx[g_tx_r]; g_tx_r = (g_tx_r + 1) % TX_SZ; g_tx_n--; }
    if (n) pthread_cond_broadcast(&g_tx_cv);
    pthread_mutex_unlock(&g_mu);
    return n;
}
/* 0 plugged, 1 host attached, 2 rx free, 3 tx pending, 4 rx dropped, 5 tx dropped, 6 stalled, 7 generation */
EMSCRIPTEN_KEEPALIVE int usb_get(int id)
{
    int v = 0;
    DB_PAGE_LOCK(&g_mu, 0);
    switch (id) {
    case 0: v = g_plugged; break; case 1: v = g_host; break; case 2: v = (int)(RX_SZ - g_rx_n); break; case 3: v = (int)g_tx_n; break;
    case 4: v = (int)g_rx_dropped; break; case 5: v = (int)g_tx_dropped; break; case 6: v = g_stalled; break; case 7: v = (int)g_gen; break;
    }
    pthread_mutex_unlock(&g_mu);
    return v;
}
