/* SPDX-License-Identifier: GPL-3.0-or-later
 * The radio core's host bridge (see include/dotbench_radio.h) and the esp_event loop that runs on its thread.
 *
 * Call slots: a firmware thread fills a slot, publishes it (state REQUEST), bumps the doorbell and futex-waits on the slot's
 * state. The JS glue (a Promise per call; the page never blocks) writes the reply into the slot's own buffer and moves the
 * state to DONE, then Atomics.notify. A timed-out caller moves the slot to ABANDONED (or frees it when JS never took it), so
 * JS can never write into a buffer the caller has gone away from: replies live in the slot, never in caller memory.
 *
 * JS -> firmware events: a single-producer byte ring written by the page; the platform thread (below) consumes it. */
#include <emscripten.h>
#include <emscripten/threading.h>
#include <errno.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "dotbench_radio.h"
#include "esp_event.h"

#define DBH_SLOTS    16
#define DBH_EV_SIZE  (1u << 17)

enum { S_FREE = 0, S_FILLING, S_REQUEST, S_TAKEN, S_DONE, S_ABANDONED };

typedef struct {
    volatile int32_t state;      /* 0  */
    int32_t seq;                 /* 4  */
    uint32_t in_ptr;             /* 8  */
    uint32_t in_len;             /* 12 */
    volatile int32_t rc;         /* 16 */
    volatile uint32_t out_len;   /* 20 */
    uint32_t out_cap;            /* 24 */
    uint32_t timeout_ms;         /* 28 */
    char op[32];                 /* 32 */
    uint8_t out[DBH_OUT_MAX];    /* 64 */
} dbh_slot_t;

typedef struct {
    volatile int32_t attached;   /* 0  JS sets 1 when the glue binds */
    volatile int32_t doorbell;   /* 4  C bumps per request */
    volatile int32_t evwake;     /* 8  platform thread futex: JS and C bump */
    volatile uint32_t ev_head;   /* 12 JS writes */
    volatile uint32_t ev_tail;   /* 16 C writes */
    uint32_t ev_size;            /* 20 */
    uint32_t ev_buf;             /* 24 */
    uint32_t nslots;             /* 28 */
    uint32_t slot_size;          /* 32 */
    uint32_t slots;              /* 36 */
    uint32_t abi;                /* 40 */
    uint32_t out_max;            /* 44 */
} dbh_layout_t;

static dbh_layout_t g_l = { .ev_size = DBH_EV_SIZE, .nslots = DBH_SLOTS, .slot_size = sizeof(dbh_slot_t), .abi = 1, .out_max = DBH_OUT_MAX };
static dbh_slot_t g_slots[DBH_SLOTS];
static uint8_t g_ev[DBH_EV_SIZE];

_Static_assert(offsetof(dbh_slot_t, op) == 32 && offsetof(dbh_slot_t, out) == 64, "slot layout is read by radio.js");
_Static_assert(offsetof(dbh_layout_t, slots) == 36, "layout is read by radio.js");

EMSCRIPTEN_KEEPALIVE const void *dbh_layout(void)
{
    g_l.ev_buf = (uint32_t)(uintptr_t)g_ev;
    g_l.slots = (uint32_t)(uintptr_t)g_slots;
    return &g_l;
}

bool dbh_host_attached(void) { return __atomic_load_n(&g_l.attached, __ATOMIC_ACQUIRE) != 0; }

static double now_ms(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (double)t.tv_sec * 1000.0 + (double)t.tv_nsec / 1e6; }

int dbh_call(const char *op, const void *in, size_t in_len, void *out, size_t out_cap, size_t *out_len, uint32_t timeout_ms)
{
    if (out_len) *out_len = 0;
    if (!dbh_host_attached()) return DBH_ERR_NOHOST;
    if (!op || in_len > DBH_IN_MAX) return DBH_ERR_BUSY;
    dbh_slot_t *s = NULL;
    double t0 = now_ms();
    for (;;) {
        for (int i = 0; i < DBH_SLOTS && !s; i++) {
            int32_t exp = S_FREE;
            if (__atomic_compare_exchange_n(&g_slots[i].state, &exp, S_FILLING, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) s = &g_slots[i];
        }
        if (s) break;
        if (now_ms() - t0 > 500.0) return DBH_ERR_BUSY;
        struct timespec ts = { 0, 2 * 1000 * 1000 };
        nanosleep(&ts, NULL);
    }
    static volatile int32_t seq;
    s->seq = __atomic_add_fetch(&seq, 1, __ATOMIC_RELAXED);
    strncpy(s->op, op, sizeof(s->op) - 1);
    s->op[sizeof(s->op) - 1] = 0;
    s->in_ptr = (uint32_t)(uintptr_t)in;
    s->in_len = (uint32_t)in_len;
    s->out_cap = out_cap > DBH_OUT_MAX ? DBH_OUT_MAX : (uint32_t)out_cap;
    s->timeout_ms = timeout_ms;
    s->out_len = 0;
    s->rc = 0;
    __atomic_store_n(&s->state, S_REQUEST, __ATOMIC_RELEASE);
    __atomic_add_fetch(&g_l.doorbell, 1, __ATOMIC_RELEASE);
    emscripten_futex_wake((void *)&g_l.doorbell, 1);

    double deadline = now_ms() + (double)timeout_ms;
    for (;;) {
        int32_t st = __atomic_load_n(&s->state, __ATOMIC_ACQUIRE);
        if (st == S_DONE) break;
        double left = deadline - now_ms();
        if (left <= 0) {
            int32_t e = S_REQUEST;
            if (__atomic_compare_exchange_n(&s->state, &e, S_FREE, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) return DBH_ERR_TIMEOUT;
            e = S_TAKEN;
            if (__atomic_compare_exchange_n(&s->state, &e, S_ABANDONED, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) return DBH_ERR_TIMEOUT;
            if (e == S_DONE) break;
            continue;
        }
        emscripten_futex_wait((void *)&s->state, (uint32_t)st, left > 1000.0 ? 1000.0 : left);
    }
    uint32_t n = s->out_len;
    if (n > s->out_cap) n = s->out_cap;
    if (out && n) memcpy(out, s->out, n);
    if (out_len) *out_len = n;
    int rc = s->rc;
    __atomic_store_n(&s->state, S_FREE, __ATOMIC_RELEASE);
    return rc;
}

/* ---- the platform thread ------------------------------------------------------------------------------------- */
#define MAX_EVH 32
#define MAX_Q   256

typedef struct { char name[32]; dbh_event_fn fn; void *ctx; } evh_t;
typedef struct { void (*fn)(void *); void *arg; } clo_t;

static evh_t g_evh[MAX_EVH];
static int g_nevh;
static clo_t g_q[MAX_Q];
static unsigned g_qh, g_qt;
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
static pthread_once_t g_once = PTHREAD_ONCE_INIT;

static void wake(void)
{
    __atomic_add_fetch(&g_l.evwake, 1, __ATOMIC_RELEASE);
    emscripten_futex_wake((void *)&g_l.evwake, 1);
}

bool dbh_post(void (*fn)(void *), void *arg)
{
    dbh_start();
    pthread_mutex_lock(&g_mu);
    bool ok = (g_qh - g_qt) < MAX_Q;
    if (ok) { g_q[g_qh % MAX_Q] = (clo_t){ fn, arg }; g_qh++; }
    pthread_mutex_unlock(&g_mu);
    if (ok) wake();
    return ok;
}

bool dbh_on_event(const char *name, dbh_event_fn fn, void *ctx)
{
    dbh_start();
    bool ok = false;
    pthread_mutex_lock(&g_mu);
    for (int i = 0; i < g_nevh && !ok; i++)
        if (!strncmp(g_evh[i].name, name, sizeof(g_evh[i].name))) { g_evh[i].fn = fn; g_evh[i].ctx = ctx; ok = true; }
    if (!ok && g_nevh < MAX_EVH) {
        strncpy(g_evh[g_nevh].name, name, 31);
        g_evh[g_nevh].fn = fn; g_evh[g_nevh].ctx = ctx; g_nevh++; ok = true;
    }
    pthread_mutex_unlock(&g_mu);
    return ok;
}

static uint8_t g_rec[DBH_EV_SIZE];   /* one record, linearised (platform thread only) */

static void ring_drain(void)
{
    for (;;) {
        uint32_t tail = g_l.ev_tail;
        uint32_t head = __atomic_load_n(&g_l.ev_head, __ATOMIC_ACQUIRE);
        if (tail == head) return;
        uint8_t hdr[8];
        for (int i = 0; i < 8; i++) hdr[i] = g_ev[(tail + (uint32_t)i) & (DBH_EV_SIZE - 1)];
        uint32_t nlen = hdr[0] | ((uint32_t)hdr[1] << 8);
        uint32_t dlen = hdr[4] | ((uint32_t)hdr[5] << 8) | ((uint32_t)hdr[6] << 16) | ((uint32_t)hdr[7] << 24);
        uint32_t total = (8 + nlen + dlen + 3u) & ~3u;
        if (total > DBH_EV_SIZE || total > head - tail) { __atomic_store_n(&g_l.ev_tail, head, __ATOMIC_RELEASE); return; }
        for (uint32_t i = 0; i < nlen + dlen; i++) g_rec[i] = g_ev[(tail + 8 + i) & (DBH_EV_SIZE - 1)];
        __atomic_store_n(&g_l.ev_tail, tail + total, __ATOMIC_RELEASE);
        dbh_event_fn fn = NULL; void *ctx = NULL;
        pthread_mutex_lock(&g_mu);
        for (int i = 0; i < g_nevh; i++)
            if (strlen(g_evh[i].name) == nlen && !memcmp(g_evh[i].name, g_rec, nlen)) { fn = g_evh[i].fn; ctx = g_evh[i].ctx; break; }
        pthread_mutex_unlock(&g_mu);
        if (fn) fn(g_rec + nlen, dlen, ctx);
    }
}

static void *platform_main(void *a)
{
    (void)a;
    for (;;) {
        int32_t w = __atomic_load_n(&g_l.evwake, __ATOMIC_ACQUIRE);
        for (;;) {
            clo_t c = { 0, 0 };
            pthread_mutex_lock(&g_mu);
            if (g_qt != g_qh) { c = g_q[g_qt % MAX_Q]; g_qt++; }
            pthread_mutex_unlock(&g_mu);
            if (!c.fn) break;
            c.fn(c.arg);
        }
        ring_drain();
        if (__atomic_load_n(&g_l.evwake, __ATOMIC_ACQUIRE) != w) continue;
        emscripten_futex_wait((void *)&g_l.evwake, (uint32_t)w, 1000.0);
    }
    return NULL;
}

static void start_once(void)
{
    pthread_t th;
    pthread_attr_t at;
    pthread_attr_init(&at);
    pthread_attr_setdetachstate(&at, PTHREAD_CREATE_DETACHED);
    pthread_attr_setstacksize(&at, 256 * 1024);
    pthread_create(&th, &at, platform_main, NULL);
}
void dbh_start(void) { pthread_once(&g_once, start_once); }

/* ---- esp_event ----------------------------------------------------------------------------------------------------- */
ESP_EVENT_DEFINE_BASE(WIFI_EVENT);
ESP_EVENT_DEFINE_BASE(IP_EVENT);

typedef struct { esp_event_base_t base; int32_t id; esp_event_handler_t fn; void *arg; int used; } eh_t;
#define MAX_EH 24
static eh_t g_eh[MAX_EH];
static int g_loop_created;

esp_err_t esp_event_loop_create_default(void)
{
    if (g_loop_created) return ESP_ERR_INVALID_STATE;
    g_loop_created = 1;
    dbh_start();
    return ESP_OK;
}
esp_err_t esp_event_loop_delete_default(void) { g_loop_created = 0; return ESP_OK; }

esp_err_t esp_event_handler_instance_register(esp_event_base_t base, int32_t id, esp_event_handler_t fn, void *arg,
                                              esp_event_handler_instance_t *inst)
{
    if (!fn) return ESP_ERR_INVALID_ARG;
    esp_err_t rc = ESP_ERR_NO_MEM;
    pthread_mutex_lock(&g_mu);
    for (int i = 0; i < MAX_EH; i++)
        if (!g_eh[i].used) { g_eh[i] = (eh_t){ base, id, fn, arg, 1 }; if (inst) *inst = &g_eh[i]; rc = ESP_OK; break; }
    pthread_mutex_unlock(&g_mu);
    return rc;
}
esp_err_t esp_event_handler_instance_unregister(esp_event_base_t base, int32_t id, esp_event_handler_instance_t inst)
{
    (void)base; (void)id;
    pthread_mutex_lock(&g_mu);
    if (inst) ((eh_t *)inst)->used = 0;
    pthread_mutex_unlock(&g_mu);
    return ESP_OK;
}

typedef struct { esp_event_base_t base; int32_t id; size_t n; uint8_t data[]; } evpost_t;
static void event_run(void *p)
{
    evpost_t *e = (evpost_t *)p;
    eh_t list[MAX_EH];
    int n = 0;
    pthread_mutex_lock(&g_mu);
    for (int i = 0; i < MAX_EH; i++) {
        if (!g_eh[i].used) continue;
        if (g_eh[i].base && strcmp(g_eh[i].base, e->base)) continue;
        if (g_eh[i].id != ESP_EVENT_ANY_ID && g_eh[i].id != e->id) continue;
        list[n++] = g_eh[i];
    }
    pthread_mutex_unlock(&g_mu);
    for (int i = 0; i < n; i++) list[i].fn(list[i].arg, e->base, e->id, e->n ? e->data : NULL);
    free(e);
}

esp_err_t esp_event_post(esp_event_base_t base, int32_t id, const void *data, size_t size, TickType_t ticks)
{
    (void)ticks;
    evpost_t *e = malloc(sizeof(*e) + size + 8);
    if (!e) return ESP_ERR_NO_MEM;
    e->base = base; e->id = id; e->n = size;
    if (size) memcpy(e->data, data, size);
    if (!dbh_post(event_run, e)) { free(e); return ESP_ERR_TIMEOUT; }
    return ESP_OK;
}
