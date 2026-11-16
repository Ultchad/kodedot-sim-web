/* SPDX-License-Identifier: GPL-3.0-or-later
 * khal_console over the bridge: output goes to the CONSOLE text channel, input
 * arrives through kweb_console_input() (exported) into a byte queue read by a
 * reader task. Replaces components/khal/console/src/khal_console_esp.c. */
#include <pthread.h>
#include <string.h>
#include <time.h>
#include <emscripten.h>
#include "khal_console.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "kweb_bridge.h"

#define RXQ 1024
static uint8_t g_rx[RXQ];
static unsigned g_head, g_tail;
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t g_cv = PTHREAD_COND_INITIALIZER;
static void (*g_on_byte)(uint8_t);
static bool g_raw;
static bool g_rest;

EMSCRIPTEN_KEEPALIVE void kweb_console_input(const char *s, int len)
{
    pthread_mutex_lock(&g_mu);
    for (int i = 0; i < len; i++) {
        unsigned n = (g_head + 1) % RXQ;
        if (n == g_tail) break;
        g_rx[g_head] = (uint8_t)s[i];
        g_head = n;
    }
    pthread_cond_broadcast(&g_cv);
    pthread_mutex_unlock(&g_mu);
}

static int pop(uint32_t timeout_ms)
{
    int v = -1;
    pthread_mutex_lock(&g_mu);
    if (g_head == g_tail && timeout_ms) {
        struct timespec ts;
        clock_gettime(CLOCK_REALTIME, &ts);
        ts.tv_sec += timeout_ms / 1000;
        ts.tv_nsec += (long)(timeout_ms % 1000) * 1000000L;
        if (ts.tv_nsec >= 1000000000L) { ts.tv_sec++; ts.tv_nsec -= 1000000000L; }
        pthread_cond_timedwait(&g_cv, &g_mu, &ts);
    }
    if (g_head != g_tail) { v = g_rx[g_tail]; g_tail = (g_tail + 1) % RXQ; }
    pthread_mutex_unlock(&g_mu);
    return v;
}

void khal_console_init(void) { }
void khal_console_rest(bool rest) { g_rest = rest; }

static void reader(void *arg)
{
    (void)arg;
    for (;;) {
        int c = pop(100);
        if (c >= 0 && !g_raw && !g_rest && g_on_byte) g_on_byte((uint8_t)c);
    }
}
kode_status_t khal_console_start_reader(void (*on_byte)(uint8_t), uint32_t prio)
{
    if (!on_byte) return KODE_DENIED;
    if (g_on_byte) return KODE_OK;
    g_on_byte = on_byte;
    return xTaskCreate(reader, "console.rx", 4096, NULL, prio, NULL) == pdPASS ? KODE_OK : KODE_ERROR;
}
kode_status_t khal_console_raw_begin(void (*pump)(void), void (*on_armed)(void))
{
    (void)pump;
    g_raw = true;
    if (on_armed) on_armed();
    return KODE_OK;
}
void khal_console_raw_end(void) { g_raw = false; }
int32_t khal_console_read_raw(void *buf, size_t want, uint32_t timeout_ms)
{
    uint8_t *p = buf;
    size_t n = 0;
    while (n < want) {
        int c = pop(n == 0 ? timeout_ms : 0);
        if (c < 0) break;
        p[n++] = (uint8_t)c;
    }
    return (int32_t)n;
}
void khal_console_write(const char *buf, size_t len)
{
    if (buf && len) kweb_text_write(KWEB_CH_CONSOLE, buf, (unsigned)len);
}
kode_status_t khal_console_dock_release(void) { return KODE_OK; }
kode_status_t khal_console_dock_take(void) { return KODE_OK; }
