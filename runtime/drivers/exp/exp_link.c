/* SPDX-License-Identifier: GPL-3.0-or-later
 * The shared block between the J3 fakes and the bench model (see include/dotbench_exp.h for the layout and the rules).
 * khal_gpio_web.c, the khal_pwm port, the ADC port, kdrv_exp_bus_web.c and the I2C tap publish through here. */
#include <emscripten.h>
#include <emscripten/threading.h>
#include <pthread.h>
#include <stdatomic.h>
#include <string.h>
#include <time.h>

#include "dotbench_board.h"
#include "dotbench_exp.h"
#include "kbsp_exp.h"

typedef struct {
    volatile uint32_t seq, mode, pull, level, hz, duty, gen, rsv;
} dbx_pin_t;

typedef struct {
    uint32_t magic, abi;
    volatile uint32_t attached, doorbell, in_seq, v5_boost, rx_wake, rx_head, rx_tail, rx_drop;
    uint32_t pad0[6];
    dbx_pin_t pin[DBX_POS];                       /* word 16 */
    volatile int32_t level_in[16];                /* word 128 */
    volatile int32_t mv_in[16];                   /* word 144 */
    volatile uint32_t rq_state;                   /* word 160: 0 idle, 1 posted, 2 taken by the bench, 3 done, 4 abandoned */
    uint32_t rq_seq, rq_kind;
    int32_t rq_p[6];
    uint32_t rq_wlen, rq_rlen;
    volatile int32_t rq_result;
    volatile uint32_t rq_rdone;
    uint32_t rq_pad[3];
    uint8_t rq_w[1024];                           /* byte 704 */
    uint8_t rq_r[1024];
    uint8_t rx_buf[1024];
} dbx_t;

_Static_assert(offsetof(dbx_t, pin) == 64, "exp.js reads the pin table at word 16");
_Static_assert(offsetof(dbx_t, level_in) == 512 && offsetof(dbx_t, mv_in) == 576, "exp.js reads the inputs at words 128 and 144");
_Static_assert(offsetof(dbx_t, rq_state) == 640 && offsetof(dbx_t, rq_w) == 704, "exp.js reads the mailbox at word 160 and byte 704");
_Static_assert(offsetof(dbx_t, rx_buf) == 704 + 2048, "exp.js reads the UART ring at byte 2752");

static dbx_t g = { .magic = 0x31584244u /* 'DBX1' */, .abi = 1 };
static pthread_mutex_t g_pin_mu = PTHREAD_MUTEX_INITIALIZER;
static pthread_mutex_t g_rq_mu = PTHREAD_MUTEX_INITIALIZER;

EMSCRIPTEN_KEEPALIVE const void *dbx_block(void) { return &g; }

int dbx_gpio_to_pos(uint8_t gpio)
{
    for (int i = 0; i < DBX_POS; i++) if (KBSP_EXP[i].gpio == gpio) return i;
    return -1;
}
uint8_t dbx_pos_to_gpio(int pos) { return (pos >= 0 && pos < DBX_POS) ? KBSP_EXP[pos].gpio : 0xFF; }
int dbx_level(int pos) { return (pos >= 0 && pos < DBX_POS) ? (__atomic_load_n(&g.level_in[pos], __ATOMIC_ACQUIRE) ? 1 : 0) : 0; }
int32_t dbx_mv(int pos) { return (dbx_attached() && pos >= 0 && pos < DBX_POS) ? __atomic_load_n(&g.mv_in[pos], __ATOMIC_ACQUIRE) : 0; }
bool dbx_attached(void) { return __atomic_load_n(&g.attached, __ATOMIC_ACQUIRE) != 0; }

static void ring_bell(void)
{
    __atomic_add_fetch(&g.doorbell, 1, __ATOMIC_RELEASE);
    emscripten_futex_wake((void *)&g.doorbell, 1);
}

void dbx_pin_set(uint8_t gpio, dbx_mode_t mode, int pull, int level, uint32_t hz, uint32_t duty_q16)
{
    int pos = dbx_gpio_to_pos(gpio);
    if (pos < 0) return;
    dbx_start();
    pthread_mutex_lock(&g_pin_mu);
    dbx_pin_t *p = &g.pin[pos];
    uint32_t s = p->seq;
    __atomic_store_n(&p->seq, s + 1, __ATOMIC_SEQ_CST);        /* odd: being written */
    p->mode = (uint32_t)mode; p->pull = (uint32_t)pull; p->level = level ? 1u : 0u; p->hz = hz; p->duty = duty_q16; p->gen++;
    __atomic_store_n(&p->seq, s + 2, __ATOMIC_SEQ_CST);
    pthread_mutex_unlock(&g_pin_mu);
    ring_bell();
}

void dbx_set_v5_boost(bool on)
{
    if ((uint32_t)on == g.v5_boost) return;
    __atomic_store_n(&g.v5_boost, on ? 1u : 0u, __ATOMIC_RELEASE);
    ring_bell();
}

/* ---- the interrupt pump: bench level changes -> dotbench_gpio_drive() on a firmware thread ---- */
static void *pump_main(void *arg)
{
    (void)arg;
    int last[DBX_POS];
    for (int i = 0; i < DBX_POS; i++) last[i] = -1;
    uint32_t seen = 0xFFFFFFFFu;
    for (;;) {
        uint32_t seq = __atomic_load_n(&g.in_seq, __ATOMIC_ACQUIRE);
        if (seq == seen) { emscripten_futex_wait((void *)&g.in_seq, seq, 1000.0); continue; }
        seen = seq;
        if (!dbx_attached()) { for (int i = 0; i < DBX_POS; i++) last[i] = -1; continue; }
        for (int i = 0; i < DBX_POS; i++) {
            int lv = __atomic_load_n(&g.level_in[i], __ATOMIC_ACQUIRE) ? 1 : 0;
            if (lv != last[i]) { last[i] = lv; dotbench_gpio_drive(KBSP_EXP[i].gpio, lv != 0); }
        }
    }
    return NULL;
}
static pthread_once_t g_once = PTHREAD_ONCE_INIT;
static void start_once(void)
{
    pthread_t t; pthread_attr_t a;
    pthread_attr_init(&a);
    pthread_attr_setstacksize(&a, 64 * 1024);
    pthread_attr_setdetachstate(&a, PTHREAD_CREATE_DETACHED);
    pthread_create(&t, &a, pump_main, NULL);
}
void dbx_start(void) { pthread_once(&g_once, start_once); }

/* ---- the mailbox ---- */
static double now_ms(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (double)t.tv_sec * 1000.0 + (double)t.tv_nsec / 1e6; }

int dbx_call(int kind, const int32_t p[6], const void *out, size_t out_len, void *in, size_t in_cap, size_t *in_len, uint32_t timeout_ms)
{
    if (in_len) *in_len = 0;
    if (!dbx_attached()) return DBX_R_NOHOST;
    if (out_len > sizeof g.rq_w || in_cap > sizeof g.rq_r) return DBX_R_REFUSED;
    pthread_mutex_lock(&g_rq_mu);
    g.rq_kind = (uint32_t)kind;
    for (int i = 0; i < 6; i++) g.rq_p[i] = p ? p[i] : 0;
    g.rq_wlen = (uint32_t)out_len; g.rq_rlen = (uint32_t)in_cap;
    if (out && out_len) memcpy(g.rq_w, out, out_len);
    g.rq_rdone = 0; g.rq_result = 0; g.rq_seq++;
    __atomic_store_n(&g.rq_state, 1u, __ATOMIC_RELEASE);
    ring_bell();
    double deadline = now_ms() + (double)timeout_ms;
    int rc = DBX_R_NOREPLY;
    for (;;) {
        uint32_t st = __atomic_load_n(&g.rq_state, __ATOMIC_ACQUIRE);
        if (st == 3) { rc = g.rq_result; break; }
        double left = deadline - now_ms();
        if (left <= 0) {
            uint32_t e = 1;
            if (__atomic_compare_exchange_n(&g.rq_state, &e, 0u, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) { rc = DBX_R_NOREPLY; goto done; }
            e = 2;
            if (__atomic_compare_exchange_n(&g.rq_state, &e, 4u, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) { rc = DBX_R_NOREPLY; goto done; }
            if (e == 3) { rc = g.rq_result; break; }
            continue;
        }
        emscripten_futex_wait((void *)&g.rq_state, st, left > 1000.0 ? 1000.0 : left);
    }
    {
        size_t n = g.rq_rdone; if (n > in_cap) n = in_cap;
        if (in && n) memcpy(in, g.rq_r, n);
        if (in_len) *in_len = n;
    }
    __atomic_store_n(&g.rq_state, 0u, __ATOMIC_RELEASE);
done:
    pthread_mutex_unlock(&g_rq_mu);
    return rc;
}

/* ---- UART receive ring: the bench writes rx_head, the firmware rx_tail ---- */
size_t dbx_rx_read(uint8_t *d, size_t cap, uint32_t wait_ms)
{
    size_t got = 0;
    double deadline = now_ms() + (double)wait_ms;
    for (;;) {
        uint32_t head = __atomic_load_n(&g.rx_head, __ATOMIC_ACQUIRE), tail = g.rx_tail;
        while (tail != head && got < cap) { d[got++] = g.rx_buf[tail & 1023u]; tail++; }
        __atomic_store_n(&g.rx_tail, tail, __ATOMIC_RELEASE);
        if (got >= cap) return got;
        double left = deadline - now_ms();
        if (left <= 0) return got;
        uint32_t w = __atomic_load_n(&g.rx_wake, __ATOMIC_ACQUIRE);
        if (__atomic_load_n(&g.rx_head, __ATOMIC_ACQUIRE) != tail) continue;
        emscripten_futex_wait((void *)&g.rx_wake, w, left > 1000.0 ? 1000.0 : left);
    }
}
void dbx_rx_flush(void) { __atomic_store_n(&g.rx_tail, __atomic_load_n(&g.rx_head, __ATOMIC_ACQUIRE), __ATOMIC_RELEASE); }
