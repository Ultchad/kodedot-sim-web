/* SPDX-License-Identifier: GPL-3.0-or-later
 * kdrv_ir for the bench: the whole public interface of components/kdrv/ir/include/kdrv_ir.h.
 *
 * On the board the IR block hangs off the ESP32-C5, so the SDK driver speaks request/reply to it (kir_wire.h). Here the
 * seam is the six kdrv_ir_* functions: everything above them is the SDK's own code, unmodified (knec.c, AO_Ir with its echo
 * window, retries and job worker, kode_ir_*, kode_sys_ir_*, capture files).
 *
 * The link is modelled as raw symbol trains (mark_us, space_us), up to 256 symbols, with a carrier frequency, in both directions:
 *   out: kdrv_ir_send() puts a record in a small ring; the page's glue pops it (ir_tx_pop) and hands it to the TV bench objects.
 *   in : the page's glue injects a train (ir_rx_inject). It is kept only if the receiver is armed (one capture per arming, as the
 *        C5 does), the block is up, the receiver is not faulted and the carrier is in the TSOP75338's band. A fake-owned thread then
 *        calls the owner's callback, which is what the C5 link's thread does on the board.
 * What is deliberately the same as the real driver: argument checks and status codes, one transmission in flight (second is
 * KODE_DENIED), zero space sent as the longest the RMT can express and zero mark as 1 us, one capture per arming, arming an armed
 * receiver is KODE_ERROR, kdrv_ir_rx_present() re-arms and loses what waited, a capture is truncated to the caller's cap, never wrapped.
 *
 * Threading: every export runs on the page's thread and only takes a spin lock for a plain memory copy. The callback is never
 * called under the lock and never from the page's thread. */
#include <emscripten.h>
#include <emscripten/threading.h>
#include <pthread.h>
#include <sched.h>
#include <stdatomic.h>
#include <string.h>
#include <time.h>

#include "dotbench_persist.h"
#include "kdrv_ir.h"
#include "kode_log.h"
#include "sdkconfig.h"
#if CONFIG_KODEOS_RADIO
#include "kdrv_radio.h"
#endif

#define TAG "dotbench.ir"

#define RMT_MAX_US   32767u    /* one RMT duration field (15 bits) */
#define TXQ          16u
#define RX_BAND_LO   36000u    /* what the receiver hears: a TSOP75338-type band around 38 kHz */
#define RX_BAND_HI   40000u

/* ir_set / ir_get keys (keep in step with ir.js) */
enum {
    IRK_LINK = 0,      /* 1 up, 0 down: every kdrv_ir call but init answers KODE_DENIED, nothing is heard      */
    IRK_RX_DEAF,       /* receiver deaf: arming works, nothing ever arrives                                    */
    IRK_TX_DARK,       /* emitter dead: kdrv_ir_send() answers OK, nothing leaves                              */
    IRK_RX_FITTED,     /* kdrv_ir_rx_present(): receiver fitted (also: nothing arrives when 0)                 */
    IRK_REST_HIGH,     /* kdrv_ir_rx_idle(): receiver output rests high (0 = stuck low)                        */
    IRK_ECHO,          /* the Dot's own sends come back on its receiver (as on the board), at the end of the frame */
    IRK_STRETCH_US,    /* the receiver's AGC: marks come back this much longer, spaces shorter                 */
    IRK_DISARM,        /* write-only, one shot: the C5 loses the receiver's arming (and any capture waiting)   */
    IRK_COUNT
};

/* ir_stats slots (keep in step with ir.js) */
enum {
    IRS_INIT = 0, IRS_ARMED, IRS_READY, IRS_TX_BUSY, IRS_SENDS, IRS_SEND_REFUSED, IRS_CAPTURES, IRS_DROP_UNARMED,
    IRS_DROP_DEAF, IRS_DROP_CARRIER, IRS_DROP_LINK, IRS_DROP_NOINIT, IRS_TX_LOST, IRS_ECHOES, IRS_ARMS, IRS_TAKES,
    IRS_COUNT
};

typedef struct {
    uint32_t seq, start_ms, dur_us, carrier, n, flags;
    kdrv_ir_symbol_t sym[KDRV_IR_TX_MAX_SYMBOLS];
} txrec_t;

static struct {
    bool init;
    kdrv_ir_rx_cb_t cb;
    void *cb_ctx;
    int cfg[IRK_COUNT];
    bool armed, ready;
    size_t rx_len;
    kdrv_ir_symbol_t rx[KDRV_IR_RX_MAX_SYMBOLS];
    bool tx_busy;
    uint32_t tx_end_ms;
    txrec_t q[TXQ];
    uint32_t q_head, q_tail, seq;
    bool echo_due;
    uint32_t echo_at_ms;
    size_t echo_n;
    kdrv_ir_symbol_t echo[KDRV_IR_TX_MAX_SYMBOLS];
    int cb_pending;
    bool was_c5;
    uint32_t stat[IRS_COUNT];
} g = { .cfg = { [IRK_LINK] = 1, [IRK_RX_FITTED] = 1, [IRK_REST_HIGH] = 1 } };

static atomic_flag g_lk = ATOMIC_FLAG_INIT;
static volatile uint32_t g_wake;
static pthread_once_t g_once = PTHREAD_ONCE_INIT;

static void lock(void) { while (atomic_flag_test_and_set_explicit(&g_lk, memory_order_acquire)) sched_yield(); }
static void unlock(void) { atomic_flag_clear_explicit(&g_lk, memory_order_release); }

static uint32_t now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint32_t)(ts.tv_sec * 1000u + ts.tv_nsec / 1000000u);
}

/* Whether the block is reachable now (lock held). As on the board the block is behind the C5 link: with CONFIG_KODEOS_RADIO the
 * link is the radio's (kdrv_radio_link_up(): a plain read), and a link that comes up means the C5 was just reset, so its receiver is
 * not armed and nothing is in flight: what the real driver's link-up callback does. cfg[IRK_LINK] is the bench's own "IR block down". */
static bool link_ok(void)
{
#if CONFIG_KODEOS_RADIO
    bool c5 = kdrv_radio_link_up();
    if (c5 && !g.was_c5) { g.armed = false; g.ready = false; g.tx_busy = false; g.rx_len = 0; }
    g.was_c5 = c5;
    if (!c5) return false;
#endif
    return g.cfg[IRK_LINK] != 0;
}

static void wake(void)
{
    __atomic_fetch_add(&g_wake, 1u, __ATOMIC_SEQ_CST);
    emscripten_futex_wake((void *)&g_wake, 1);
}

/* ---- the persistent blob (the page's object definitions, opaque to C) ---- */
#define BLOB_REGION_BYTES (8u * 4096u)
#define BLOB_MAGIC 0x49524231u   /* "IRB1" */
static struct { uint32_t magic, len; uint8_t data[BLOB_REGION_BYTES - 8u]; } g_blob __attribute__((aligned(64)));
static dbp_region_t *g_breg;
__attribute__((constructor(120))) static void ir_blob_register(void)
{
    g_breg = dbp_register("ir", &g_blob, sizeof g_blob, 0);
}

/* ---- the receiver side: store a capture (lock held) ---- */
static void store_capture(const kdrv_ir_symbol_t *s, size_t n, uint32_t stretch)
{
    if (n > KDRV_IR_RX_MAX_SYMBOLS) n = KDRV_IR_RX_MAX_SYMBOLS;
    for (size_t i = 0; i < n; i++) {
        uint32_t m = s[i].mark_us, sp = s[i].space_us;
        if (stretch) {
            m += stretch;
            if (m > 65535u) m = 65535u;
            if (sp) sp = sp > stretch ? sp - stretch : 1u;
        }
        g.rx[i].mark_us = (uint16_t)m;
        g.rx[i].space_us = (uint16_t)sp;
    }
    g.rx[n - 1u].space_us = 0;   /* the capture ends at the idle gap: the last symbol has no space */
    g.rx_len = n;
    g.armed = false;             /* one capture per arming */
    g.ready = true;
    g.cb_pending = 1;
    g.stat[IRS_CAPTURES]++;
}

static bool receiver_hears_locked(void)
{
    return g.init && link_ok() && !g.cfg[IRK_RX_DEAF] && g.cfg[IRK_RX_FITTED];
}

/* The thread that plays the C5 link's: calls the owner's callback, and delivers the echo of an own send at the end of its frame. */
static void *link_thread(void *arg)
{
    (void)arg;
    for (;;) {
        lock();
        uint32_t now = now_ms();
        if (g.echo_due && (int32_t)(now - g.echo_at_ms) >= 0) {
            g.echo_due = false;
            if (receiver_hears_locked() && g.armed) {
                store_capture(g.echo, g.echo_n, (uint32_t)g.cfg[IRK_STRETCH_US]);
                g.stat[IRS_ECHOES]++;
            }
        }
        int pend = g.cb_pending;
        g.cb_pending = 0;
        kdrv_ir_rx_cb_t cb = g.cb;
        void *ctx = g.cb_ctx;
        double wait = 1000.0;
        if (g.echo_due) {
            int32_t d = (int32_t)(g.echo_at_ms - now);
            wait = d > 0 ? (double)d : 1.0;
        }
        uint32_t w = __atomic_load_n(&g_wake, __ATOMIC_SEQ_CST);
        unlock();
        if (pend && cb) cb(ctx);
        else emscripten_futex_wait((void *)&g_wake, w, wait);
    }
    return NULL;
}

static void start_thread(void)
{
    pthread_t th;
    pthread_attr_t at;
    pthread_attr_init(&at);
    pthread_attr_setdetachstate(&at, PTHREAD_CREATE_DETACHED);
    pthread_attr_setstacksize(&at, 64 * 1024);
    pthread_create(&th, &at, link_thread, NULL);
}

/* ================================================================== kdrv_ir.h */

kode_status_t kdrv_ir_init(kdrv_ir_rx_cb_t cb, void *ctx)
{
    lock();
    bool first = !g.init;
    if (first) {
        g.init = true;
        g.cb = cb;
        g.cb_ctx = ctx;
    }
    unlock();
    if (first) pthread_once(&g_once, start_thread);
    return KODE_OK;   /* bring-up never waits on the C5 and arms nothing */
}

kode_status_t kdrv_ir_rx_idle(bool *high)
{
    if (!high) return KODE_DENIED;
    lock();
    kode_status_t rc = KODE_DENIED;
    if (g.init && link_ok()) {
        *high = g.cfg[IRK_REST_HIGH] != 0;
        rc = KODE_OK;
    }
    unlock();
    return rc;
}

kode_status_t kdrv_ir_rx_present(bool *present)
{
    if (!present) return KODE_DENIED;
    lock();
    kode_status_t rc = KODE_DENIED;
    if (g.init && link_ok()) {
        *present = g.cfg[IRK_RX_FITTED] != 0;
        /* the probe re-arms the receiver on its way out and loses whatever was waiting */
        g.ready = false;
        g.armed = true;
        rc = KODE_OK;
    }
    unlock();
    return rc;
}

kode_status_t kdrv_ir_send(const kdrv_ir_symbol_t *sym, size_t n, uint32_t carrier_hz)
{
    if (!sym || n == 0 || n > KDRV_IR_TX_MAX_SYMBOLS || carrier_hz == 0) return KODE_DENIED;
    lock();
    if (!g.init || !link_ok()) { g.stat[IRS_SEND_REFUSED]++; unlock(); return KODE_DENIED; }
    uint32_t now = now_ms();
    if (g.tx_busy && (int32_t)(now - g.tx_end_ms) < 0) { g.stat[IRS_SEND_REFUSED]++; unlock(); return KODE_DENIED; }

    txrec_t *r = &g.q[g.q_head % TXQ];
    uint32_t dur = 0;
    for (size_t i = 0; i < n; i++) {
        uint32_t m = sym[i].mark_us, s = sym[i].space_us;
        if (m == 0) m = 1;                  /* a zero mark means nothing: one microsecond */
        if (s == 0 || s > RMT_MAX_US) s = RMT_MAX_US;   /* zero space: the frame ends here, longest the RMT expresses */
        if (m > RMT_MAX_US) m = RMT_MAX_US;
        r->sym[i].mark_us = (uint16_t)m;
        r->sym[i].space_us = (uint16_t)s;
        dur += m + s;
    }
    g.tx_busy = true;
    g.tx_end_ms = now + (dur + 999u) / 1000u;
    g.stat[IRS_SENDS]++;
    if (g.cfg[IRK_TX_DARK]) {
        g.stat[IRS_TX_LOST]++;              /* accepted, and nothing left the emitter */
    } else {
        if (g.q_head - g.q_tail >= TXQ) { g.q_tail++; g.stat[IRS_TX_LOST]++; }   /* nobody pops: drop the oldest */
        r = &g.q[g.q_head % TXQ];
        r->seq = ++g.seq; r->start_ms = now; r->dur_us = dur; r->carrier = carrier_hz; r->n = (uint32_t)n; r->flags = 0;
        g.q_head++;
        if (g.cfg[IRK_ECHO]) {
            memcpy(g.echo, r->sym, n * sizeof r->sym[0]);
            g.echo_n = n;
            g.echo_at_ms = g.tx_end_ms;
            g.echo_due = true;
        }
    }
    unlock();
    if (g.cfg[IRK_ECHO]) wake();
    return KODE_OK;
}

size_t kdrv_ir_rx_take(kdrv_ir_symbol_t *out, size_t cap)
{
    if (!out || cap == 0) return 0;
    lock();
    size_t n = 0;
    if (g.ready) {
        n = g.rx_len;
        if (n > cap) { KLOG_W(TAG, "a capture of %u symbols is truncated to %u", (unsigned)n, (unsigned)cap); n = cap; }
        memcpy(out, g.rx, n * sizeof out[0]);
        g.ready = false;
        g.stat[IRS_TAKES]++;
    }
    unlock();
    return n;
}

kode_status_t kdrv_ir_rx_arm(void)
{
    lock();
    kode_status_t rc;
    if (!g.init || !link_ok()) rc = KODE_DENIED;
    else if (g.armed) rc = KODE_ERROR;      /* a capture is in flight */
    else {
        g.rx_len = 0;
        g.ready = false;
        g.armed = true;
        g.stat[IRS_ARMS]++;
        rc = KODE_OK;
    }
    unlock();
    return rc;
}

/* ================================================================== page side */

/* Offer a train to the receiver. flat u16 pairs: mark, space, ...; n symbols.
 * Returns: 1 delivered, 2 delivered but truncated to 256 symbols, 0 lost (receiver not armed),
 *  -1 block down, -2 receiver deaf or not fitted, -3 carrier outside the receiver's band, -4 AO_Ir never brought the block up, -5 empty. */
EMSCRIPTEN_KEEPALIVE int ir_rx_inject(const uint16_t *us, int n, uint32_t carrier_hz)
{
    if (!us || n <= 0) return -5;
    kdrv_ir_symbol_t tmp[KDRV_IR_RX_MAX_SYMBOLS];
    int cnt = n > (int)KDRV_IR_RX_MAX_SYMBOLS ? (int)KDRV_IR_RX_MAX_SYMBOLS : n;
    for (int i = 0; i < cnt; i++) { tmp[i].mark_us = us[2 * i]; tmp[i].space_us = us[2 * i + 1]; }
    int rc;
    lock();
    if (!g.init) { g.stat[IRS_DROP_NOINIT]++; rc = -4; }
    else if (!link_ok()) { g.stat[IRS_DROP_LINK]++; rc = -1; }
    else if (g.cfg[IRK_RX_DEAF] || !g.cfg[IRK_RX_FITTED]) { g.stat[IRS_DROP_DEAF]++; rc = -2; }
    else if (carrier_hz < RX_BAND_LO || carrier_hz > RX_BAND_HI) { g.stat[IRS_DROP_CARRIER]++; rc = -3; }
    else if (!g.armed) { g.stat[IRS_DROP_UNARMED]++; rc = 0; }
    else {
        store_capture(tmp, (size_t)cnt, (uint32_t)g.cfg[IRK_STRETCH_US]);
        rc = n > cnt ? 2 : 1;
    }
    unlock();
    if (rc > 0) wake();
    return rc;
}

/* Pop the oldest transmission: hdr[6] = seq, start_ms, dur_us, carrier, n, flags; sym = n * 2 u16 (mark, space, ...). Returns n, 0 when none. */
EMSCRIPTEN_KEEPALIVE int ir_tx_pop(uint32_t *hdr, uint16_t *sym)
{
    int n = 0;
    lock();
    if (g.q_tail != g.q_head) {
        txrec_t *r = &g.q[g.q_tail % TXQ];
        hdr[0] = r->seq; hdr[1] = r->start_ms; hdr[2] = r->dur_us; hdr[3] = r->carrier; hdr[4] = r->n; hdr[5] = r->flags;
        for (uint32_t i = 0; i < r->n; i++) { sym[2 * i] = r->sym[i].mark_us; sym[2 * i + 1] = r->sym[i].space_us; }
        n = (int)r->n;
        g.q_tail++;
    }
    unlock();
    return n;
}

EMSCRIPTEN_KEEPALIVE void ir_set(int key, int val)
{
    if (key < 0 || key >= IRK_COUNT) return;
    lock();
    if (key == IRK_DISARM) { if (val) { g.armed = false; g.ready = false; } }
    else g.cfg[key] = val;
    unlock();
}

EMSCRIPTEN_KEEPALIVE int ir_get(int key)
{
    if (key < 0 || key >= IRK_COUNT) return -1;
    lock();
    int v = g.cfg[key];
    unlock();
    return v;
}

/* Fill out[IRS_COUNT] (16 u32): init, armed, ready, tx_busy (now), sends, send_refused, captures, drop_unarmed, drop_deaf,
 * drop_carrier, drop_link, drop_noinit, tx_lost, echoes, arms, takes. */
EMSCRIPTEN_KEEPALIVE void ir_stats(uint32_t *out)
{
    lock();
    memcpy(out, g.stat, sizeof g.stat);
    out[IRS_INIT] = g.init;
    out[IRS_ARMED] = g.armed;
    out[IRS_READY] = g.ready;
    out[IRS_TX_BUSY] = g.tx_busy && (int32_t)(now_ms() - g.tx_end_ms) < 0;
    unlock();
}

/* Back to a clean link for a test: config defaults, counters, queues, no capture. The driver stays initialised. */
EMSCRIPTEN_KEEPALIVE void ir_reset(void)
{
    lock();
    g.cfg[IRK_LINK] = 1; g.cfg[IRK_RX_DEAF] = 0; g.cfg[IRK_TX_DARK] = 0; g.cfg[IRK_RX_FITTED] = 1;
    g.cfg[IRK_REST_HIGH] = 1; g.cfg[IRK_ECHO] = 0; g.cfg[IRK_STRETCH_US] = 0;
    g.ready = false; g.rx_len = 0;
    g.tx_busy = false;
    g.q_head = g.q_tail = 0;
    g.echo_due = false;
    memset(g.stat, 0, sizeof g.stat);
    unlock();
}

EMSCRIPTEN_KEEPALIVE uint8_t *ir_blob_ptr(void) { return g_blob.data; }
EMSCRIPTEN_KEEPALIVE uint32_t ir_blob_len(void)
{
    return (g_blob.magic == BLOB_MAGIC && g_blob.len <= sizeof g_blob.data) ? g_blob.len : 0;
}
/* The page wrote len bytes at ir_blob_ptr(): seal and mark dirty (after the write). Returns 0, or -1 when too big. */
EMSCRIPTEN_KEEPALIVE int ir_blob_commit(uint32_t len)
{
    if (len > sizeof g_blob.data) return -1;
    g_blob.magic = BLOB_MAGIC;
    g_blob.len = len;
    if (g_breg) dbp_dirty(g_breg, 0, 8u + len);
    return 0;
}
