/* SPDX-License-Identifier: GPL-3.0-or-later
 * Minimal ESP-IDF surface: esp_err, esp_log, esp_timer, esp_rom, heap_caps, random. */
#include <errno.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include "soc/soc.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "esp_rom_crc.h"
#include "esp_rom_sys.h"
#include "esp_system.h"
#include "esp_random.h"
#include "envlock.h"
#include "kweb_bridge.h"

static int64_t now_us(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (int64_t)ts.tv_sec * 1000000 + ts.tv_nsec / 1000;
}
static int64_t g_t0;
__attribute__((constructor(102))) static void idf_init(void) { g_t0 = now_us(); }

/* ---- esp_err ---- */
const char *esp_err_to_name(esp_err_t c)
{
    switch (c) {
    case ESP_OK: return "ESP_OK";
    case ESP_FAIL: return "ESP_FAIL";
    case ESP_ERR_NO_MEM: return "ESP_ERR_NO_MEM";
    case ESP_ERR_INVALID_ARG: return "ESP_ERR_INVALID_ARG";
    case ESP_ERR_INVALID_STATE: return "ESP_ERR_INVALID_STATE";
    case ESP_ERR_INVALID_SIZE: return "ESP_ERR_INVALID_SIZE";
    case ESP_ERR_NOT_FOUND: return "ESP_ERR_NOT_FOUND";
    case ESP_ERR_NOT_SUPPORTED: return "ESP_ERR_NOT_SUPPORTED";
    case ESP_ERR_TIMEOUT: return "ESP_ERR_TIMEOUT";
    case ESP_ERR_INVALID_RESPONSE: return "ESP_ERR_INVALID_RESPONSE";
    case ESP_ERR_INVALID_CRC: return "ESP_ERR_INVALID_CRC";
    case ESP_ERR_INVALID_VERSION: return "ESP_ERR_INVALID_VERSION";
    case ESP_ERR_NOT_ALLOWED: return "ESP_ERR_NOT_ALLOWED";
    default: return "UNKNOWN ERROR";
    }
}
const char *esp_err_to_name_r(esp_err_t c, char *buf, size_t n)
{
    snprintf(buf, n, "%s", esp_err_to_name(c));
    return buf;
}
void _esp_error_check_failed(esp_err_t rc, const char *file, int line, const char *fn, const char *expr)
{
    kweb_text_printf(KWEB_CH_LOG, "ESP_ERROR_CHECK failed: esp_err_t 0x%x (%s) at %s:%d in %s: %s\n",
                     rc, esp_err_to_name(rc), file, line, fn, expr);
    kweb_restart(KWEB_RESET_PANIC, "");
}

/* ---- esp_log ---- */
static vprintf_like_t g_vprintf;
static pthread_mutex_t g_log_mu = PTHREAD_MUTEX_INITIALIZER;
vprintf_like_t esp_log_set_vprintf(vprintf_like_t f)
{
    vprintf_like_t old = g_vprintf;
    g_vprintf = f;
    return old;
}
void esp_log_level_set(const char *tag, esp_log_level_t l) { (void)tag; (void)l; }
esp_log_level_t esp_log_level_get(const char *tag) { (void)tag; return ESP_LOG_VERBOSE; }
uint32_t esp_log_timestamp(void) { return (uint32_t)((now_us() - g_t0) / 1000); }
uint32_t esp_log_early_timestamp(void) { return esp_log_timestamp(); }
void esp_log_writev(esp_log_level_t level, const char *tag, const char *fmt, va_list ap)
{
    (void)level; (void)tag;
    if (g_vprintf) { g_vprintf(fmt, ap); return; }
    char buf[512];
    int n = vsnprintf(buf, sizeof buf, fmt, ap);
    if (n < 0) return;
    if (n >= (int)sizeof buf) n = sizeof buf - 1;
    kweb_text_write(KWEB_CH_LOG, buf, (uint32_t)n);
}
void esp_log_write(esp_log_level_t level, const char *tag, const char *fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    esp_log_writev(level, tag, fmt, ap);
    va_end(ap);
}
int esp_rom_printf(const char *fmt, ...)
{
    char buf[512];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    if (n > 0) kweb_text_write(KWEB_CH_LOG, buf, (uint32_t)(n >= (int)sizeof buf ? sizeof buf - 1 : n));
    return n;
}
int ets_printf(const char *fmt, ...)
{
    char buf[512];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    if (n > 0) kweb_text_write(KWEB_CH_LOG, buf, (uint32_t)(n >= (int)sizeof buf ? sizeof buf - 1 : n));
    return n;
}
void esp_rom_delay_us(uint32_t us)
{
    struct timespec ts = { us / 1000000, (long)(us % 1000000) * 1000 };
    nanosleep(&ts, NULL);
}
void ets_delay_us(uint32_t us) { esp_rom_delay_us(us); }

/* ---- env lock ---- */
static pthread_mutex_t g_env_mu;
static pthread_once_t g_env_once = PTHREAD_ONCE_INIT;
static void env_init(void)
{
    pthread_mutexattr_t a;
    pthread_mutexattr_init(&a);
    pthread_mutexattr_settype(&a, PTHREAD_MUTEX_RECURSIVE);
    pthread_mutex_init(&g_env_mu, &a);
}
void dotbench_env_lock(void) { pthread_once(&g_env_once, env_init); pthread_mutex_lock(&g_env_mu); }
void dotbench_env_unlock(void) { pthread_mutex_unlock(&g_env_mu); }

/* ---- heap caps ---- */
void *heap_caps_malloc(size_t s, uint32_t c) { (void)c; return malloc(s); }
void *heap_caps_calloc(size_t n, size_t s, uint32_t c) { (void)c; return calloc(n, s); }
void *heap_caps_realloc(void *p, size_t s, uint32_t c) { (void)c; return realloc(p, s); }
void *heap_caps_aligned_alloc(size_t a, size_t s, uint32_t c)
{
    (void)c;
    void *p = NULL;
    if (a < sizeof(void *)) a = sizeof(void *);
    return posix_memalign(&p, a, s) == 0 ? p : NULL;
}
void *heap_caps_aligned_calloc(size_t a, size_t n, size_t s, uint32_t c)
{
    void *p = heap_caps_aligned_alloc(a, n * s, c);
    if (p) memset(p, 0, n * s);
    return p;
}
void heap_caps_free(void *p) { free(p); }
/* Fixed plausible figures: the linear memory is not partitioned. */
size_t heap_caps_get_free_size(uint32_t c) { return (c & MALLOC_CAP_SPIRAM) ? 24u << 20 : 256u << 10; }
size_t heap_caps_get_largest_free_block(uint32_t c) { return heap_caps_get_free_size(c) / 2; }
size_t heap_caps_get_minimum_free_size(uint32_t c) { return heap_caps_get_free_size(c) / 2; }
size_t heap_caps_get_total_size(uint32_t c) { return (c & MALLOC_CAP_SPIRAM) ? 32u << 20 : 512u << 10; }
uint32_t esp_get_free_heap_size(void) { return (uint32_t)heap_caps_get_free_size(MALLOC_CAP_INTERNAL); }
uint32_t esp_get_minimum_free_heap_size(void) { return (uint32_t)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL); }
void esp_restart(void)
{
    kweb_text_printf(KWEB_CH_LOG, "dotbench: esp_restart() requested\n");
    kweb_restart(KWEB_RESET_SOFTWARE, "");
}

/* ---- random ---- */
uint32_t esp_random(void) { return (uint32_t)random() ^ ((uint32_t)random() << 16); }
void esp_fill_random(void *buf, size_t len)
{
    uint8_t *p = buf;
    while (len) { uint32_t r = esp_random(); size_t n = len < 4 ? len : 4; memcpy(p, &r, n); p += n; len -= n; }
}

/* ---- crc (reflected, same as the ROM's little-endian variants) ---- */
uint32_t esp_rom_crc32_le(uint32_t crc, const uint8_t *buf, uint32_t len)
{
    crc = ~crc;
    while (len--) {
        crc ^= *buf++;
        for (int i = 0; i < 8; i++) crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1)));
    }
    return ~crc;
}
uint16_t esp_rom_crc16_le(uint16_t crc, const uint8_t *buf, uint32_t len)
{
    crc = (uint16_t)~crc;
    while (len--) {
        crc ^= *buf++;
        for (int i = 0; i < 8; i++) crc = (uint16_t)((crc >> 1) ^ (0x8408u & (0u - (crc & 1))));
    }
    return (uint16_t)~crc;
}
uint8_t esp_rom_crc8_le(uint8_t crc, const uint8_t *buf, uint32_t len)
{
    crc = (uint8_t)~crc;
    while (len--) {
        crc ^= *buf++;
        for (int i = 0; i < 8; i++) crc = (uint8_t)((crc >> 1) ^ (0x8Cu & (0u - (crc & 1))));
    }
    return (uint8_t)~crc;
}

/* ---- esp_timer: one service thread, a sorted-by-scan list ---- */
struct esp_timer {
    esp_timer_cb_t cb; void *arg; const char *name;
    int64_t due; int64_t period; bool active; bool skip; bool dead;
    struct esp_timer *next;
};
static struct esp_timer *g_timers;
static pthread_mutex_t g_tmu = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t g_tcv;
static pthread_once_t g_tonce = PTHREAD_ONCE_INIT;
static struct esp_timer *g_running;

static void *timer_thread(void *a)
{
    (void)a;
    pthread_mutex_lock(&g_tmu);
    for (;;) {
        int64_t now = now_us(), next = INT64_MAX;
        struct esp_timer *fire = NULL;
        for (struct esp_timer *t = g_timers; t; t = t->next) {
            if (!t->active) continue;
            if (t->due <= now) { fire = t; break; }
            if (t->due < next) next = t->due;
        }
        if (fire) {
            if (fire->period) {
                fire->due += fire->period;
                if (fire->skip && fire->due <= now) fire->due = now + fire->period;
            } else fire->active = false;
            g_running = fire;
            pthread_mutex_unlock(&g_tmu);
            fire->cb(fire->arg);
            pthread_mutex_lock(&g_tmu);
            g_running = NULL;
            pthread_cond_broadcast(&g_tcv);
            continue;
        }
        if (next == INT64_MAX) pthread_cond_wait(&g_tcv, &g_tmu);
        else {
            int64_t abs = next; /* CLOCK_MONOTONIC condvar */
            struct timespec ts = { abs / 1000000, (long)(abs % 1000000) * 1000 };
            pthread_cond_timedwait(&g_tcv, &g_tmu, &ts);
        }
    }
    return NULL;
}
static void timer_once(void)
{
    pthread_condattr_t ca;
    pthread_condattr_init(&ca);
    pthread_condattr_setclock(&ca, CLOCK_MONOTONIC);
    pthread_cond_init(&g_tcv, &ca);
    pthread_t th;
    pthread_attr_t at;
    pthread_attr_init(&at);
    pthread_attr_setdetachstate(&at, PTHREAD_CREATE_DETACHED);
    pthread_attr_setstacksize(&at, 128 * 1024);
    pthread_create(&th, &at, timer_thread, NULL);
}
esp_err_t esp_timer_create(const esp_timer_create_args_t *a, esp_timer_handle_t *out)
{
    if (!a || !a->callback || !out) return ESP_ERR_INVALID_ARG;
    pthread_once(&g_tonce, timer_once);
    struct esp_timer *t = calloc(1, sizeof *t);
    if (!t) return ESP_ERR_NO_MEM;
    t->cb = a->callback; t->arg = a->arg; t->name = a->name; t->skip = a->skip_unhandled_events;
    pthread_mutex_lock(&g_tmu);
    t->next = g_timers; g_timers = t;
    pthread_mutex_unlock(&g_tmu);
    *out = t;
    return ESP_OK;
}
static esp_err_t start(esp_timer_handle_t t, int64_t to, int64_t period)
{
    if (!t) return ESP_ERR_INVALID_ARG;
    pthread_mutex_lock(&g_tmu);
    if (t->active) { pthread_mutex_unlock(&g_tmu); return ESP_ERR_INVALID_STATE; }
    t->due = now_us() + to; t->period = period; t->active = true;
    pthread_cond_broadcast(&g_tcv);
    pthread_mutex_unlock(&g_tmu);
    return ESP_OK;
}
esp_err_t esp_timer_start_once(esp_timer_handle_t t, uint64_t us) { return start(t, (int64_t)us, 0); }
esp_err_t esp_timer_start_periodic(esp_timer_handle_t t, uint64_t us) { return start(t, (int64_t)us, (int64_t)us); }
esp_err_t esp_timer_restart(esp_timer_handle_t t, uint64_t us)
{
    if (!t) return ESP_ERR_INVALID_ARG;
    pthread_mutex_lock(&g_tmu);
    t->due = now_us() + (int64_t)us; t->active = true;
    pthread_cond_broadcast(&g_tcv);
    pthread_mutex_unlock(&g_tmu);
    return ESP_OK;
}
esp_err_t esp_timer_stop(esp_timer_handle_t t)
{
    if (!t) return ESP_ERR_INVALID_ARG;
    pthread_mutex_lock(&g_tmu);
    bool was = t->active;
    t->active = false;
    pthread_mutex_unlock(&g_tmu);
    return was ? ESP_OK : ESP_ERR_INVALID_STATE;
}
esp_err_t esp_timer_delete(esp_timer_handle_t t)
{
    if (!t) return ESP_ERR_INVALID_ARG;
    pthread_mutex_lock(&g_tmu);
    if (t->active) { pthread_mutex_unlock(&g_tmu); return ESP_ERR_INVALID_STATE; }
    while (g_running == t) pthread_cond_wait(&g_tcv, &g_tmu);
    for (struct esp_timer **pp = &g_timers; *pp; pp = &(*pp)->next)
        if (*pp == t) { *pp = t->next; break; }
    pthread_mutex_unlock(&g_tmu);
    free(t);
    return ESP_OK;
}
bool esp_timer_is_active(esp_timer_handle_t t) { return t && t->active; }
int64_t esp_timer_get_time(void) { return now_us() - g_t0; }
int64_t esp_timer_get_next_alarm(void)
{
    int64_t best = INT64_MAX;
    pthread_mutex_lock(&g_tmu);
    for (struct esp_timer *t = g_timers; t; t = t->next) if (t->active && t->due < best) best = t->due;
    pthread_mutex_unlock(&g_tmu);
    return best == INT64_MAX ? best : best - g_t0;
}
volatile uint32_t dotbench_lp_store[16];
