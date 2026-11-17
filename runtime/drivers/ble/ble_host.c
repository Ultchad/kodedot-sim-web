/* SPDX-License-Identifier: GPL-3.0-or-later
 * kdrv_ble for the bench: the whole of components/kdrv/radio/src/kdrv_ble.c, replaced.
 *
 * Seam. The SDK's kdrv_ble.c is a NimBLE host on the P4 with its controller on the ESP32-C5 (HCI over esp-hosted). NimBLE is not part of
 * this tree, so the seam is the kdrv_ble.h interface itself: this file is the "BLE host" and keeps every rule kdrv_ble.c has - the console
 * ring and its drain, the confirmed line, the app's characteristics and queue, the battery level, the scan table, find and the passive
 * hear ring, the pulsed advert train, hidden mode, pairing (passkey shown on the Dot, accept/reject, 30 s SM timeout), the bond store
 * (3 bonds, round-robin, none made in an app), link security and the permission checks on every characteristic. What stays the SDK's:
 * kdrv_ble_adv.c (advert packing, serial name, connection parameters, the pulse arithmetic), kdrv_ble_app.c (service rules, values, ring),
 * kdrv_ble_heard.c, kdrv_ble_bonds.c (the bond-count word), kdrv_ble_tokens.c, kdrv_ble_find.c, AO_Radio, kode_ble_*, kode_sys_ble_*.
 *
 * The other side of the air is ble.js: bench Sensors and Phones. They talk to this file through two byte queues:
 *   ble_in(buf, len)      page -> host : connect, disconnect, ATT requests, security-manager steps, scan results (see IN_* below)
 *   ble_out_pop(buf, cap) host -> page : advertising on/off (with the bytes on the air), scan on/off, notifications, terminate, the passkey
 *                                         on the screen, ATT responses, bond count (see OUT_* below)
 * Everything the Dot does is decided here, in a host thread that plays NimBLE's host task (callouts, event queue). The page only
 * answers what is on the air. The link follows the radio core: kdrv_radio_link_up() false (C5 reset, power off, fault) is a controller
 * reset for the host: the connection drops, advertising and scans stop, the state goes IDLE; when the link returns the host syncs again.
 *
 * Threading: ble_in / ble_out_pop / the info exports run on the page's thread and only take g_mu for a memory copy. Firmware callbacks
 * (state, pair, hear, console rx/raw/sent) are called on the host thread or on the firmware caller's thread, as on the board, always with
 * g_mu held (recursive): they must not block, which is their contract on the board too. Waiters (scan, find) sleep on a separate cond. */
#include <emscripten.h>
#include <emscripten/threading.h>
#include <errno.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

#include "dotbench_persist.h"
#include "kdrv_ble.h"
#include "kdrv_ble_heard.h"
#include "kode_log.h"
#include "sdkconfig.h"
#if CONFIG_KODEOS_RADIO
#include "kdrv_radio.h"
#endif
#include "ble_priv.h"

#if CONFIG_KODEOS_BLE && CONFIG_KODEOS_BLE_CONSOLE

#define TAG "kdrv.ble"

#if !CONFIG_KODEOS_BLE_CONSOLE_PAIRING
#error "the bench's BLE host models the console with pairing (CONFIG_KODEOS_BLE_CONSOLE_PAIRING=y)"
#endif

#if CONFIG_KODEOS_BLE_CONSOLE && CONFIG_KODEOS_MIRROR
#define MIRROR_PIPE 1
#else
#define MIRROR_PIPE 0
#endif

/* ---- NimBLE's numbers that the rules above quote ---- */
#define HS_EALREADY   2
#define HS_ENOMEM     6
#define HS_ENOTCONN   7
#define HS_ENOTSUP    8
#define HS_ETIMEOUT   13
#define HS_ENOTSYNCED 22
#define CONN_NONE     0xFFFFu
#define ERR_REM_USER_CONN_TERM 0x13u
#define ERR_AUTH_FAIL          0x05u
#define ERR_CONN_TIMEOUT       0x08u
#define ERR_LOCAL_HOST_TERM    0x16u

/* ATT errors */
#define ATT_OK                  0
#define ATT_READ_NOT_PERMITTED  0x02
#define ATT_WRITE_NOT_PERMITTED 0x03
#define ATT_INSUFFICIENT_AUTHEN 0x05
#define ATT_NOT_FOUND           0x0A
#define ATT_INVALID_VALUE_LEN   0x0D
#define ATT_UNLIKELY            0x0E
#define ATT_INSUFFICIENT_ENC    0x0F
#define ATT_INSUFFICIENT_RES    0x11

/* characteristic flags: opaque bits shared with kdrv_ble_app_build (the SDK just ORs what it is given), so these values are this file's */
#define F_READ        0x0002u
#define F_WNR         0x0004u
#define F_WRITE       0x0008u
#define F_NOTIFY      0x0010u
#define F_READ_ENC    0x0200u
#define F_READ_AUTHEN 0x0400u
#define F_WRITE_ENC   0x1000u
#define F_WRITE_AUTHEN 0x2000u
#define F_NOTIFY_ENC   0x4000u
#define F_NOTIFY_AUTHEN 0x8000u

#if CONFIG_KODEOS_BLE_PAIRING_PASSKEY
#define CHR_WRITE_ENC  (F_WRITE_ENC | F_WRITE_AUTHEN)
#define CHR_NOTIFY_ENC (F_NOTIFY_ENC | F_NOTIFY_AUTHEN)
#define CHR_READ_ENC   (F_READ_ENC | F_READ_AUTHEN)
#else
#define CHR_WRITE_ENC  F_WRITE_ENC
#define CHR_NOTIFY_ENC F_NOTIFY_ENC
#define CHR_READ_ENC   F_READ_ENC
#endif

#define SYNC_MS            5000u
#define SCAN_MARGIN_MS     2000u
#define SM_TIMEOUT_MS_DEF  30000u
#define RETRY_MS           20u
#define LINE_MAX_          240u
#define RX_SCRATCH         256u
#define RING_BYTES         2048u
#define DRAIN_MAX          12u
#define REC_MAX            256u
#define MIRROR_RING_BYTES  8192u
#define NOTIFY_HDR         3u
#define READ_HDR           1u
#define APP_MTU_MAX        451u
#define MTU_DEFAULT        23u
#define BONDS_MAX          3u
#define GAP_SVC_UUID16     0x1800u
#define BATT_SVC_UUID16    0x180Fu
#define BATT_LEVEL_UUID16  0x2A19u
#define CONFIRM_TIMEOUT_MS 5000u
#define LINK_POLL_MS       20u
#define OUT_BYTES          (64u * 1024u)
#define IN_BYTES           (64u * 1024u)

/* bits waiters sleep on */
#define BIT_SCAN_DONE  1u
#define BIT_SCAN_ABORT 2u

/* ---- the two queues (keep in step with ble.js) ---- */
enum {   /* host -> page: [type u8][len u16][payload] */
    OUT_STACK = 1,    /* up u8, synced u8                                                                         */
    OUT_ADV,          /* on u8, connectable u8, discoverable u8, itvl_ms u16, advlen u8, adv[], rsplen u8, rsp[]   */
    OUT_SCAN,         /* on u8, passive u8, ms u32                                                                */
    OUT_TERMINATE,    /* conn u16, reason u8                                                                      */
    OUT_NOTIFY,       /* conn u16, handle u16, len u16, data[]                                                    */
    OUT_PASSKEY,      /* conn u16, passkey u32 (the code on the Dot's screen)                                     */
    OUT_CONFIRM_REQ,  /* conn u16 (a confirmed console line asks the phone to answer a discovery)                  */
    OUT_SEC_REQ,      /* conn u16 (the Dot's Security Request)                                                    */
    OUT_CONN_PARAMS,  /* conn u16, itvl_min u16, itvl_max u16, latency u16, timeout u16                           */
    OUT_SM_RESULT,    /* conn u16, ok u8, status u16, authenticated u8, bonded u8, ltk[16]                        */
    OUT_ATT_RSP,      /* id u32, status u8, len u16, data[]                                                       */
    OUT_BONDS,        /* count u8                                                                                 */
    OUT_CONN_OK,      /* conn u16, mtu u16                                                                        */
    OUT_CONN_FAIL,    /* reason u8 (0 not advertising, 1 not connectable, 2 already connected, 3 stack down)       */
    OUT_MTU           /* conn u16, mtu u16                                                                        */
};
enum {   /* page -> host: [type u8][payload] */
    IN_CONNECT = 1,   /* addr_type u8, addr[6] (NimBLE order), mtu_request u16 (0 none)                           */
    IN_DISCONNECT,    /* conn u16, reason u8                                                                      */
    IN_ATT,           /* id u32, conn u16, op u8 (1 read, 2 write, 3 write command, 4 cccd write), handle u16, offset u16, len u16, data[] */
    IN_SM_PAIR,       /* conn u16, io u8 (0 no input/output, 1 keyboard), bonding u8                              */
    IN_SM_KEY,        /* conn u16, passkey u32                                                                    */
    IN_SM_CANCEL,     /* conn u16                                                                                 */
    IN_SM_ENC,        /* conn u16, ltk[16]                                                                        */
    IN_DISC,          /* event_type u8, addr_type u8, addr[6], rssi i8, len u8, data[]                            */
    IN_CONFIRM,       /* ok u8                                                                                    */
    IN_MTU            /* conn u16, mtu u16                                                                        */
};
enum { ATT_READ = 1, ATT_WRITE = 2, ATT_WRITE_CMD = 3, ATT_CCCD = 4 };

/* ble_cfg / ble_stat keys (keep in step with ble.js) */
enum {
    CFG_SCAN_SPEED = 0,   /* scans run this many times faster than their stated duration (1 = honest)                */
    CFG_STALL,            /* 1: the connected phone's controller has no buffers: notifications get ENOMEM            */
    CFG_PASSKEY,          /* >= 0: the code shown is this number (tests); -1 random                                  */
    CFG_SM_TIMEOUT_MS,    /* the security manager's timeout (30000)                                                   */
    CFG_MUTE_CONFIRM,     /* 1: the phone never answers a discovery (a confirmed line then fails after its timeout)   */
    CFG_COUNT
};
enum {
    STAT_UP = 0, STAT_SYNCED, STAT_STATE, STAT_CONN, STAT_LINKS, STAT_SECURE, STAT_BONDS, STAT_OUT_DROPPED, STAT_IN_DROPPED,
    STAT_COUNT
};

typedef struct { uint8_t used, type, auth, pad; uint8_t addr[6]; uint8_t pad2[2]; uint8_t ltk[16]; uint32_t seq; } bond_t;
typedef struct { uint32_t magic, nextseq; bond_t b[BONDS_MAX]; } bonds_t;
#define BONDS_MAGIC 0x424c4531u   /* "BLE1" */
#define REGION_BYTES (3u * 4096u)
#define BLOB_OFF 4096u
#define BLOB_MAGIC 0x424c4f42u    /* "BLOB" */

static uint8_t g_region[REGION_BYTES] __attribute__((aligned(64)));
static dbp_region_t *g_reg;
static bonds_t *const g_bonds = (bonds_t *)g_region;

__attribute__((constructor(120))) static void ble_region_register(void)
{
    g_reg = dbp_register("ble", g_region, sizeof g_region, 0);
}

static pthread_mutex_t g_mu;
static pthread_cond_t g_hcv;            /* the host thread's doorbell */
static pthread_mutex_t g_wmu = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t g_wcv = PTHREAD_COND_INITIALIZER;
static unsigned g_wbits;
static pthread_once_t g_once = PTHREAD_ONCE_INIT;

static uint32_t now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint32_t)((uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u);
}

/* ---- callouts ---- */
enum { CO_PULSE, CO_ADV, CO_TX, CO_MIRROR, CO_APP, CO_SM, CO_SCAN, CO_CONFIRM, CO_COUNT };
static struct { bool on; uint32_t due; } g_co[CO_COUNT];
static void co_reset(int c, uint32_t ms) { g_co[c].on = true; g_co[c].due = now_ms() + ms; }
static void co_stop(int c) { g_co[c].on = false; }

/* ---- the ring ---- */
typedef struct { uint8_t *buf; size_t cap, head, tail, used; } ring_t;
static void ring_init(ring_t *r, uint8_t *storage, size_t cap) { r->buf = storage; r->cap = cap; r->head = r->tail = r->used = 0u; }
static void ring_write(ring_t *r, const uint8_t *src, size_t n)
{
    for (size_t i = 0u; i < n; ++i) { r->buf[r->head] = src[i]; r->head = (r->head + 1u) % r->cap; }
    r->used += n;
}
static kode_status_t ring_put(ring_t *r, const char *buf, size_t len)
{
    if (0u == len || 0xFFFFu < len) return KODE_DENIED;
    if ((r->used + len + 2u) > r->cap) return KODE_NO_RESOURCES;
    uint8_t const hdr[2] = { (uint8_t)(len & 0xFFu), (uint8_t)(len >> 8) };
    ring_write(r, hdr, 2u);
    ring_write(r, (const uint8_t *)buf, len);
    return KODE_OK;
}
static bool ring_get(ring_t *r, uint8_t *out, size_t max, size_t *n)
{
    if (2u > r->used) return false;
    size_t const len = (size_t)r->buf[r->tail] | ((size_t)r->buf[(r->tail + 1u) % r->cap] << 8);
    if (len > max) return false;
    r->tail = (r->tail + 2u) % r->cap;
    for (size_t i = 0u; i < len; ++i) { out[i] = r->buf[r->tail]; r->tail = (r->tail + 1u) % r->cap; }
    r->used -= (len + 2u);
    *n = len;
    return true;
}

/* ---- the GATT table ---- */
enum { K_GAPNAME, K_RX, K_TX, K_MIRROR, K_APP, K_BATT };
typedef struct {
    uint8_t  kind, app_i, is16, pad;
    uint16_t val, cccd, uuid16;
    uint32_t flags;
    uint8_t  uuid[16];     /* 128-bit, wire order */
    bool     sub;
} chr_t;
#define CHR_MAX 12u
typedef struct { uint8_t is16; uint16_t uuid16; uint8_t uuid[16]; uint16_t start, end; } svc_t;
#define SVC_MAX 4u

static const uint8_t k_svc_uuid[16] = { 0x61, 0x3a, 0x5f, 0x9b, 0x0e, 0x7c, 0xd1, 0xa2, 0x53, 0x4f, 0x01, 0x00, 0x45, 0x44, 0x4f, 0x4b };
static uint8_t s_chr_uuid(uint8_t n, uint8_t *out) { memcpy(out, k_svc_uuid, 16); out[10] = n; return n; }

/* ---- the state (g_mu) ---- */
static struct {
    bool up, synced, thread;
    uint8_t addr[6];                  /* most significant first, as kdrv_ble_addr() gives it */
    kdrv_ble_state_t state;
    kdrv_ble_cb_t cb;
    kdrv_ble_hear_cb_t hear_cb;
    kdrv_ble_pair_cb_t pair_cb;
    uint8_t count;
    bool dev_taken;
    kdrv_ble_dev_t dev[KDRV_BLE_SCAN_MAX];
    uint8_t rsp[KDRV_BLE_ADV_MAX];
    uint8_t rsp_len;
    bool rsp_set;
    char name[KDRV_BLE_ADV_MAX];
    uint16_t conn;
    uint32_t links;
    bool secure, hearing;
    uint16_t adv_itvl;
    uint32_t adv_ms;
    bool adv_hidden, adv_pulsed, adv_said, adv_said_hidden, adv_said_pulsed;
    bool console_on, mirror_on;
    uint16_t tx_drop, tx_retry;
    /* controller */
    struct { bool on; bool connectable; bool discoverable; bool forever; } adv;
    struct { bool on; bool passive; } scan;
    unsigned next_conn;
    struct { uint8_t type; uint8_t addr[6]; bool enc, auth; uint16_t mtu; } c;
    /* GATT */
    chr_t chr[CHR_MAX];
    uint8_t nchr;
    svc_t svc[SVC_MAX];
    uint8_t nsvc;
    uint16_t rx_val, tx_val, mirror_val, batt_val, name_val;
    bool app_live, batt_live;
    uint8_t app_count;
    /* queues */
    uint8_t out[OUT_BYTES];
    uint32_t out_r, out_w;           /* byte indexes, power of two sized ring */
    uint8_t in[IN_BYTES];
    uint32_t in_r, in_w;
    uint32_t out_dropped, in_dropped;
    /* events for the host thread */
    bool ev_tx, ev_mirror, ev_app, ev_batt;
    /* config */
    int cfg[CFG_COUNT];
    /* pairing */
    bool pair_live;                  /* s_pair_live: a code is on the screen and the pairing is in flight */
    bool sm_wait;                    /* waiting for the peer's passkey */
    uint32_t sm_passkey;
    int64_t last_passkey;
    kdrv_ble_pair_t pair;
    uint32_t rng;
    /* console */
    char line[LINE_MAX_];
    uint16_t line_len;
    bool line_over, raw_on;
    kdrv_ble_console_rx_t rx_cb;
    kdrv_ble_console_raw_t raw_cb;
    kdrv_ble_console_sent_t sent_cb;
    ring_t ring;
    uint8_t ring_store[RING_BYTES];
    uint8_t pend[REC_MAX];
    uint16_t pend_len, pend_off;
    bool confirm_want, confirm_busy;
    uint16_t confirm_drops;
#if MIRROR_PIPE
    ring_t mring;
    uint8_t mring_store[MIRROR_RING_BYTES];
    uint8_t mpend[REC_MAX];
    uint16_t mpend_len, mpend_off;
#endif
    /* pulses */
    struct { bool live, on_air; uint16_t itvl; uint32_t leg_ms, leg_t0, pulse_t0, due; uint8_t refused; } pulse;
    kdrv_ble_find_t find;
    volatile bool scan_abort;
    _Atomic uint8_t batt_pct;
    atomic_uint activity;
    bool link_was;
} g = { .conn = CONN_NONE, .rng = 0x9e3779b9u, .last_passkey = -1 };

static void lock(void) { pthread_mutex_lock(&g_mu); }
static void unlock(void) { pthread_mutex_unlock(&g_mu); }
static void wake(void) { pthread_cond_signal(&g_hcv); }
static void wbits_set(unsigned b) { pthread_mutex_lock(&g_wmu); g_wbits |= b; pthread_cond_broadcast(&g_wcv); pthread_mutex_unlock(&g_wmu); }
static void wbits_clear(unsigned b) { pthread_mutex_lock(&g_wmu); g_wbits &= ~b; pthread_mutex_unlock(&g_wmu); }
/* Sleep until one of mask is set (and clear what was seen) or ms pass. Never call with g_mu held. */
static unsigned wbits_wait(unsigned mask, uint32_t ms)
{
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    ts.tv_sec += ms / 1000u;
    ts.tv_nsec += (long)(ms % 1000u) * 1000000L;
    if (ts.tv_nsec >= 1000000000L) { ts.tv_sec += 1; ts.tv_nsec -= 1000000000L; }
    pthread_mutex_lock(&g_wmu);
    while (!(g_wbits & mask)) {
        if (pthread_cond_timedwait(&g_wcv, &g_wmu, &ts) == ETIMEDOUT) break;
    }
    unsigned const got = g_wbits & mask;
    g_wbits &= ~got;
    pthread_mutex_unlock(&g_wmu);
    return got;
}

static uint32_t rnd(void)
{
    g.rng ^= g.rng << 13; g.rng ^= g.rng >> 17; g.rng ^= g.rng << 5;
    return g.rng;
}

/* ---- link: the radio core's ---- */
static bool link_ok(void)
{
#if CONFIG_KODEOS_RADIO
    return kdrv_radio_link_up();
#else
    return true;
#endif
}

/* ---- queues ---- */
static void out_put(uint8_t type, const uint8_t *p, uint16_t n)
{
    uint32_t const need = 3u + n;
    if (OUT_BYTES - (g.out_w - g.out_r) < need) { ++g.out_dropped; return; }
    uint8_t hdr[3] = { type, (uint8_t)(n & 255u), (uint8_t)(n >> 8) };
    for (uint32_t i = 0; i < 3u; ++i) g.out[(g.out_w + i) % OUT_BYTES] = hdr[i];
    for (uint32_t i = 0; i < n; ++i) g.out[(g.out_w + 3u + i) % OUT_BYTES] = p[i];
    g.out_w += need;
}
typedef struct { uint8_t b[600]; uint16_t n; } wbuf_t;
static void w8(wbuf_t *w, uint8_t v) { if (w->n < sizeof w->b) w->b[w->n++] = v; }
static void w16(wbuf_t *w, uint16_t v) { w8(w, (uint8_t)v); w8(w, (uint8_t)(v >> 8)); }
static void w32(wbuf_t *w, uint32_t v) { w16(w, (uint16_t)v); w16(w, (uint16_t)(v >> 16)); }
static void wn(wbuf_t *w, const uint8_t *p, uint16_t n) { for (uint16_t i = 0; i < n; ++i) w8(w, p[i]); }
static void out_w(uint8_t type, const wbuf_t *w) { out_put(type, w->b, w->n); }

typedef struct { const uint8_t *p; uint16_t n, i; bool bad; } rbuf_t;
static uint8_t r8(rbuf_t *r) { if (r->i >= r->n) { r->bad = true; return 0; } return r->p[r->i++]; }
static uint16_t r16(rbuf_t *r) { uint16_t lo = r8(r); return (uint16_t)(lo | ((uint16_t)r8(r) << 8)); }
static uint32_t r32(rbuf_t *r) { uint32_t lo = r16(r); return lo | ((uint32_t)r16(r) << 16); }
static void rn(rbuf_t *r, uint8_t *out, uint16_t n) { for (uint16_t i = 0; i < n; ++i) out[i] = r8(r); }

/* ---- state callbacks ---- */
static void set_state(kdrv_ble_state_t s)
{
    if (g.state == s) return;
    g.state = s;
    if (g.cb) g.cb(s);
}
static void bonds_tell(void) { if (g.cb) g.cb(g.state); }

static void moved(void) { atomic_fetch_add(&g.activity, 1u); }

/* ---- bonds ---- */
static uint8_t bond_count(void)
{
    uint8_t n = 0;
    for (unsigned i = 0; i < BONDS_MAX; ++i) if (g_bonds->b[i].used) ++n;
    return n;
}
static void bonds_dirty(void) { if (g_reg) dbp_dirty(g_reg, 0, sizeof(bonds_t)); }
static void bonds_load(void)
{
    if (g_bonds->magic != BONDS_MAGIC) { memset(g_bonds, 0, sizeof *g_bonds); g_bonds->magic = BONDS_MAGIC; }
}
static void bonds_recount(void)
{
    uint8_t const n = bond_count();
    wbuf_t w = { .n = 0 };
    w8(&w, n);
    out_w(OUT_BONDS, &w);
    if (kdrv_ble_bonds_changed(n)) bonds_tell();
}
static bond_t *bond_find(const uint8_t addr[6], uint8_t type)
{
    for (unsigned i = 0; i < BONDS_MAX; ++i) {
        bond_t *b = &g_bonds->b[i];
        if (b->used && b->type == type && memcmp(b->addr, addr, 6) == 0) return b;
    }
    return NULL;
}
static void bond_del(const uint8_t addr[6], uint8_t type)
{
    bond_t *b = bond_find(addr, type);
    if (b) { memset(b, 0, sizeof *b); bonds_dirty(); bonds_recount(); }
}
static bool pair_open(void)
{
#if CONFIG_KODEOS_BOOT_ROLE_APP
    return false;
#else
    return !g.adv_hidden;
#endif
}
/* Store a bond. false: the store is full and refuses (an app, or a hidden board: nothing is evicted). */
static bool bond_put(const uint8_t addr[6], uint8_t type, const uint8_t ltk[16], bool auth)
{
    bond_t *b = bond_find(addr, type);
    if (!b) {
        for (unsigned i = 0; i < BONDS_MAX && !b; ++i) if (!g_bonds->b[i].used) b = &g_bonds->b[i];
    }
    if (!b) {
        if (!pair_open()) return false;
        b = &g_bonds->b[0];                         /* round-robin: the oldest goes */
        for (unsigned i = 1; i < BONDS_MAX; ++i) if (g_bonds->b[i].seq < b->seq) b = &g_bonds->b[i];
    }
    memset(b, 0, sizeof *b);
    b->used = 1; b->type = type; b->auth = auth ? 1 : 0;
    memcpy(b->addr, addr, 6); memcpy(b->ltk, ltk, 16);
    b->seq = ++g_bonds->nextseq;
    bonds_dirty();
    bonds_recount();
    return true;
}

/* ---- the host's view of the controller ---- */
static void emit_adv(bool on)
{
    wbuf_t w = { .n = 0 };
    w8(&w, on); w8(&w, g.adv.connectable); w8(&w, g.adv.discoverable);
    w16(&w, (uint16_t)(((uint32_t)(g.pulse.itvl ? g.pulse.itvl : (g.adv_itvl ? g.adv_itvl : KDRV_BLE_ITVL_SLOW)) * 5u) / 8u));
    /* the bytes on the air: set by kdrv_ble_advertise() in s_adv_data / s_adv_rsp */
    extern uint8_t g_adv_data[31], g_adv_rsp[31]; extern uint8_t g_adv_len, g_adv_rsp_len;
    w8(&w, g_adv_len); wn(&w, g_adv_data, g_adv_len);
    w8(&w, g_adv_rsp_len); wn(&w, g_adv_rsp, g_adv_rsp_len);
    out_w(OUT_ADV, &w);
}
uint8_t g_adv_data[31], g_adv_rsp[31];
uint8_t g_adv_len, g_adv_rsp_len;

static void scan_emit(bool on, bool passive, uint32_t ms)
{
    wbuf_t w = { .n = 0 };
    w8(&w, on); w8(&w, passive); w32(&w, ms);
    out_w(OUT_SCAN, &w);
}

static void terminate_emit(uint16_t conn, uint8_t reason)
{
    wbuf_t w = { .n = 0 };
    w16(&w, conn); w8(&w, reason);
    out_w(OUT_TERMINATE, &w);
}

static void gap_disconnect_event(uint8_t reason);
static void pulse_train_end(void)
{
    g.pulse.live = false;
    g.pulse.on_air = false;
    co_stop(CO_PULSE);
}
/* the controller stops advertising (no event), as a connection or an explicit stop does */
static void adv_stop_ctrl(void)
{
    if (g.adv.on) { g.adv.on = false; co_stop(CO_ADV); emit_adv(false); }
}
static void adv_halt(void)
{
    pulse_train_end();
    adv_stop_ctrl();
}
static void scan_cancel(void)
{
    if (g.scan.on) { g.scan.on = false; co_stop(CO_SCAN); scan_emit(false, false, 0); }
}
static int adv_start_ctrl(int32_t duration_ms /* 0 = forever */)
{
    if (g.adv.on) return HS_EALREADY;
    if (!g.synced) return HS_ENOTSYNCED;
    g.adv.on = true;
    if (duration_ms > 0) co_reset(CO_ADV, (uint32_t)duration_ms); else co_stop(CO_ADV);
    emit_adv(true);
    return 0;
}

/* ---- pairing state ---- */
static void pair_note(kdrv_ble_pair_phase_t phase, kdrv_ble_pair_outcome_t outcome, uint32_t passkey)
{
    g.pair.phase = phase;
    g.pair.outcome = outcome;
    g.pair.passkey = passkey;
    if (g.pair_cb) g.pair_cb();
}

static void gap_terminate(uint16_t conn, uint8_t reason)
{
    if (conn == CONN_NONE || conn != g.conn) return;
    terminate_emit(conn, reason);
    gap_disconnect_event(reason);
}

static void pair_refuse(uint16_t conn, bool forget)
{
#if CONFIG_KODEOS_BOOT_ROLE_APP
    KLOG_N(TAG, "pairing refused: a new phone pairs in kodeOS; this app serves bonded phones");
#else
    KLOG_N(TAG, "pairing refused: the board is hidden; Pair new device makes it visible");
#endif
    if (forget && conn == g.conn) bond_del(g.c.addr, g.c.type);
    g.sm_wait = false;
    co_stop(CO_SM);
    gap_terminate(conn, ERR_REM_USER_CONN_TERM);
}

/* ---- the connection's end ---- */
static void confirm_report(bool ok)
{
    g.confirm_busy = false;
    co_stop(CO_CONFIRM);
    if (g.sent_cb) g.sent_cb(ok);
}
static void confirm_lost(void)
{
    bool const want = g.confirm_want;
    g.confirm_want = false;
    if (want || g.confirm_busy) confirm_report(false);
}

static void app_quiet(void)
{
    g.app_live = false;
    g.batt_live = false;
}

static void ring_reset_all(void)
{
    ring_init(&g.ring, g.ring_store, RING_BYTES);
#if MIRROR_PIPE
    ring_init(&g.mring, g.mring_store, MIRROR_RING_BYTES);
#endif
}

static void gap_disconnect_event(uint8_t reason)
{
    moved();
    KLOG_N(TAG, "disconnected (reason %u)", (unsigned)reason);
    /* a bond whose key the peer lost: nothing to do here, the peer re-pairs through REPEAT_PAIRING */
    g.conn = CONN_NONE;
    g.sm_wait = false;
    co_stop(CO_SM);
    if (g.pair_live) {
        g.pair_live = false;
        pair_note(KDRV_BLE_PAIR_DONE, KDRV_BLE_PAIR_GONE, 0u);
    }
    kdrv_ble_app_link_reset();
    g.console_on = false;
    confirm_lost();
    g.tx_drop = 0u;
    g.line_len = 0u; g.line_over = false; g.raw_on = false;
    g.pend_len = 0u; g.pend_off = 0u;
    ring_init(&g.ring, g.ring_store, RING_BYTES);
#if MIRROR_PIPE
    g.mirror_on = false;
    g.mpend_len = 0u; g.mpend_off = 0u;
    ring_init(&g.mring, g.mring_store, MIRROR_RING_BYTES);
#endif
    for (unsigned i = 0; i < g.nchr; ++i) g.chr[i].sub = false;
    g.c.enc = g.c.auth = false;
    g.c.mtu = MTU_DEFAULT;
    set_state(KDRV_BLE_IDLE);
}

/* ---- the console: line assembler ---- */
static void console_feed(const uint8_t *data, uint16_t len)
{
    for (uint16_t i = 0u; i < len; ++i) {
        char const c = (char)data[i];
        if ('\r' == c || '\n' == c) {
            if (g.line_over) {
                KLOG_W(TAG, "console line over %u bytes, dropped", (unsigned)(LINE_MAX_ - 1u));
            } else if (0u < g.line_len && g.rx_cb) {
                g.line[g.line_len] = '\0';
                g.rx_cb(g.line);
            }
            g.line_len = 0u;
            g.line_over = false;
        } else if ((LINE_MAX_ - 1u) > g.line_len) {
            g.line[g.line_len++] = c;
        } else {
            g.line_over = true;
        }
    }
}

/* notify: 0, or an error the drains react to as NimBLE's (ENOMEM: no buffer, try again) */
static int notify_custom(uint16_t conn, uint16_t handle, const uint8_t *data, uint16_t len)
{
    if (conn == CONN_NONE || conn != g.conn) return HS_ENOTCONN;
    if (g.cfg[CFG_STALL]) return HS_ENOMEM;
    wbuf_t w = { .n = 0 };
    w16(&w, conn); w16(&w, handle); w16(&w, len); wn(&w, data, len);
    out_w(OUT_NOTIFY, &w);
    return 0;
}

static void confirm_send(uint16_t conn)
{
    if (g.confirm_want && !g.confirm_busy && 0u == g.ring.used) {
        uint16_t const drops = g.confirm_drops;
        g.confirm_want = false;
        g.confirm_busy = true;
        if (drops != g.tx_drop) {
            confirm_report(false);       /* a line since the mark never went */
        } else {
            wbuf_t w = { .n = 0 };
            w16(&w, conn);
            out_w(OUT_CONFIRM_REQ, &w);
            co_reset(CO_CONFIRM, CONFIRM_TIMEOUT_MS);
            if (g.cfg[CFG_MUTE_CONFIRM]) { /* the phone never answers: the timeout reports it */ }
        }
    }
}

static void confirm_answered(bool ok)
{
    if (!g.confirm_busy) return;
    bool again = false;
    if (ok) again = g.confirm_want;
    if (again) { g.confirm_busy = false; co_stop(CO_CONFIRM); g.ev_tx = true; }
    else confirm_report(ok);
}

static void console_drain(void)
{
    uint16_t const conn = g.conn;
    if (!g.console_on || CONN_NONE == conn) {
        g.pend_len = 0u; g.pend_off = 0u;
        confirm_lost();
        return;
    }
    uint16_t const mtu = g.c.mtu;
    size_t const chunk = (3u < mtu) ? (size_t)(mtu - 3u) : 20u;
    for (uint8_t i = 0u; DRAIN_MAX > i; ++i) {
        if (0u == g.pend_len) {
            size_t n = 0u;
            if (!ring_get(&g.ring, g.pend, sizeof g.pend, &n)) break;
            g.pend_len = (uint16_t)n; g.pend_off = 0u;
        }
        while (g.pend_off < g.pend_len) {
            size_t const left = (size_t)(g.pend_len - g.pend_off);
            size_t const take = (left > chunk) ? chunk : left;
            int const rc = notify_custom(conn, g.tx_val, &g.pend[g.pend_off], (uint16_t)take);
            if (HS_ENOMEM == rc) { ++g.tx_retry; co_reset(CO_TX, RETRY_MS); return; }
            if (0 != rc) { ++g.tx_drop; g.pend_len = 0u; g.pend_off = 0u; return; }
            g.pend_off += (uint16_t)take;
        }
        g.pend_len = 0u; g.pend_off = 0u;
    }
    if (0u < g.ring.used || 0u < g.pend_len) co_reset(CO_TX, RETRY_MS);
    else confirm_send(conn);
}

#if MIRROR_PIPE
static void mirror_drain(void)
{
    uint16_t const conn = g.conn;
    if (!g.mirror_on || CONN_NONE == conn) { g.mpend_len = 0u; g.mpend_off = 0u; return; }
    uint16_t const mtu = g.c.mtu;
    size_t const chunk = (3u < mtu) ? (size_t)(mtu - 3u) : 20u;
    for (uint8_t i = 0u; DRAIN_MAX > i; ++i) {
        if (0u == g.mpend_len) {
            size_t n = 0u;
            if (!ring_get(&g.mring, g.mpend, sizeof g.mpend, &n)) break;
            g.mpend_len = (uint16_t)n; g.mpend_off = 0u;
        }
        while (g.mpend_off < g.mpend_len) {
            size_t const left = (size_t)(g.mpend_len - g.mpend_off);
            size_t const take = (left > chunk) ? chunk : left;
            int const rc = notify_custom(conn, g.mirror_val, &g.mpend[g.mpend_off], (uint16_t)take);
            if (HS_ENOMEM == rc) { ++g.tx_retry; co_reset(CO_MIRROR, RETRY_MS); return; }
            if (0 != rc) { ++g.tx_drop; g.mpend_len = 0u; g.mpend_off = 0u; return; }
            g.mpend_off += (uint16_t)take;
        }
        g.mpend_len = 0u; g.mpend_off = 0u;
    }
    if (0u < g.mring.used || 0u < g.mpend_len) co_reset(CO_MIRROR, RETRY_MS);
}
#endif

static void app_drain(void)
{
    uint16_t const conn = g.conn;
    uint8_t *const buf = kdrv_ble_app_scratch();
    uint8_t chr = 0u;
    uint16_t len = 0u;
    bool more = g.app_live && CONN_NONE != conn && NULL != buf;
    for (uint32_t k = 0u; more && KDRV_BLE_APP_RING_SLOTS > k; ++k) {
        more = kdrv_ble_app_peek(&chr, buf, &len);
        if (!more) break;
        uint16_t const mtu = g.c.mtu;
        uint16_t handle = 0;
        for (unsigned i = 0; i < g.nchr; ++i) if (g.chr[i].kind == K_APP && g.chr[i].app_i == chr) handle = g.chr[i].val;
        if (chr >= g.app_count || NOTIFY_HDR >= mtu || (uint16_t)(mtu - NOTIFY_HDR) < len || 0u == handle) {
            ++g.tx_drop;
            kdrv_ble_app_pop();
        } else {
            int const rc = notify_custom(conn, handle, buf, len);
            if (HS_ENOMEM == rc) { ++g.tx_retry; co_reset(CO_APP, RETRY_MS); more = false; }
            else {
                if (0 != rc) ++g.tx_drop;
                kdrv_ble_app_pop();
            }
        }
    }
}

/* ---- security ---- */
static void enc_change(int status)
{
    bool const refused = false;
    g.secure = (0 == status) && !refused;
    if (g.pair_live) {
        kdrv_ble_pair_outcome_t how = KDRV_BLE_PAIR_FAILED;
        if (0 == status) how = KDRV_BLE_PAIR_OK;
        g.pair_live = false;
        pair_note(KDRV_BLE_PAIR_DONE, how, 0u);
    }
    if (0 == status && !pair_open() && !g.c.auth) {              /* ble_refuse_unproven */
        pair_refuse(g.conn, true);
        KLOG_D(TAG, "a link without a code was undone");
    } else if (0 == status) {
        KLOG_N(TAG, "bonded");
    } else {
        KLOG_W(TAG, "encryption failed (status %d)", status);
        gap_terminate(g.conn, ERR_AUTH_FAIL);
    }
}

static void sm_result(bool ok, uint16_t status, bool auth, bool bonded, const uint8_t *ltk)
{
    wbuf_t w = { .n = 0 };
    uint8_t zero[16] = { 0 };
    w16(&w, g.conn); w8(&w, ok); w16(&w, status); w8(&w, auth); w8(&w, bonded); wn(&w, ltk ? ltk : zero, 16);
    out_w(OUT_SM_RESULT, &w);
}

static void sm_fail(uint16_t status)
{
    g.sm_wait = false;
    co_stop(CO_SM);
    sm_result(false, status, false, false, NULL);
    enc_change((int)status);
}

static void sm_complete(bool auth)
{
    uint8_t ltk[16];
    for (unsigned i = 0; i < 16u; ++i) ltk[i] = (uint8_t)rnd();
    g.sm_wait = false;
    co_stop(CO_SM);
    if (!bond_put(g.c.addr, g.c.type, ltk, auth)) { sm_fail(6u /* ENOMEM: the store is full and refuses */); return; }
    g.c.enc = true; g.c.auth = auth;
    sm_result(true, 0u, auth, true, ltk);
    enc_change(0);
}

static void sm_pair(uint8_t io)
{
    if (CONN_NONE == g.conn) return;
    bond_t *const old = bond_find(g.c.addr, g.c.type);
    if (old) {                                      /* REPEAT_PAIRING */
        if (!pair_open()) { pair_refuse(g.conn, false); sm_result(false, 0x401u, false, false, NULL); return; }
        bond_del(g.c.addr, g.c.type);
    }
#if CONFIG_KODEOS_BOOT_ROLE_APP
    pair_refuse(g.conn, false);
    sm_result(false, 0x401u, false, false, NULL);
    return;
#else
    if (!pair_open()) { pair_refuse(g.conn, false); sm_result(false, 0x401u, false, false, NULL); return; }
#if CONFIG_KODEOS_BLE_PAIRING_PASSKEY
    if (1u == io) {                                 /* the phone has a keyboard: passkey entry, this side displays */
        uint32_t pk = (g.cfg[CFG_PASSKEY] >= 0) ? (uint32_t)g.cfg[CFG_PASSKEY] : (rnd() % 1000000u);
        g.sm_passkey = pk;
        g.sm_wait = true;
        g.pair_live = true;
        g.last_passkey = pk;
        KLOG_N(TAG, "pairing: a code is on the screen");
        wbuf_t w = { .n = 0 };
        w16(&w, g.conn); w32(&w, pk);
        out_w(OUT_PASSKEY, &w);
        co_reset(CO_SM, (uint32_t)g.cfg[CFG_SM_TIMEOUT_MS]);
        pair_note(KDRV_BLE_PAIR_SHOW, KDRV_BLE_PAIR_OK, pk);
        return;
    }
#endif
    sm_complete(false);                             /* Just Works: unauthenticated */
#endif
}

/* ---- the scan table ---- */
typedef struct { const uint8_t *name; uint8_t name_len; const uint8_t *mfg; uint8_t mfg_len; uint16_t svc[KDRV_BLE_SVC_MAX]; uint8_t svc_n; } fields_t;
static bool parse_adv(const uint8_t *d, uint8_t len, fields_t *f)
{
    memset(f, 0, sizeof *f);
    uint8_t i = 0;
    while (i < len) {
        uint8_t const l = d[i];
        if (l == 0) break;
        if (i + 1u + l > len) return false;
        uint8_t const t = d[i + 1u];
        const uint8_t *p = &d[i + 2u];
        uint8_t const n = (uint8_t)(l - 1u);
        if (t == 0x08 || t == 0x09) { f->name = p; f->name_len = n; }
        else if (t == 0xFF) { f->mfg = p; f->mfg_len = n; }
        else if (t == 0x02 || t == 0x03) {
            for (uint8_t k = 0; k + 1u < n && f->svc_n < KDRV_BLE_SVC_MAX; k += 2u) f->svc[f->svc_n++] = (uint16_t)(p[k] | (p[k + 1u] << 8));
        } else if (t == 0x16 && n >= 2u && f->svc_n < KDRV_BLE_SVC_MAX) {
            f->svc[f->svc_n++] = (uint16_t)(p[0] | (p[1] << 8));
        }
        i = (uint8_t)(i + 1u + l);
    }
    return true;
}
static void take_fields(kdrv_ble_dev_t *dev, uint8_t addr_type, const fields_t *f, bool parsed)
{
    dev->addr_type = (addr_type == 0u || addr_type == 2u) ? (uint8_t)KDRV_BLE_ADDR_PUBLIC : (uint8_t)KDRV_BLE_ADDR_RANDOM;
    if (!parsed) return;
    if (0u == dev->mfg_len && f->mfg && 0u < f->mfg_len) {
        uint8_t n = f->mfg_len; if (KDRV_BLE_MFG_MAX < n) n = (uint8_t)KDRV_BLE_MFG_MAX;
        memcpy(dev->mfg, f->mfg, n); dev->mfg_len = n;
    }
    if (0u == dev->svc_n) for (uint8_t i = 0; i < f->svc_n && KDRV_BLE_SVC_MAX > dev->svc_n; ++i) dev->svc16[dev->svc_n++] = f->svc[i];
}
static void on_disc(uint8_t evt, uint8_t atype, const uint8_t addr_le[6], int8_t rssi, const uint8_t *data, uint8_t len)
{
    if (!g.scan.on) return;
    fields_t f;
    bool const parsed = parse_adv(data, len, &f);
    if (g.find.on) {
        if (!parsed) return;
        uint8_t const at = (atype == 0u || atype == 2u) ? (uint8_t)KDRV_BLE_ADDR_PUBLIC : (uint8_t)KDRV_BLE_ADDR_RANDOM;
        if (kdrv_ble_find_offer(&g.find, addr_le, at, rssi, f.name, f.name_len)) wbits_set(BIT_SCAN_DONE);
        return;
    }
    if (g.hearing) {
        kdrv_ble_heard_t rec;
        kdrv_ble_heard_make(addr_le, atype, evt, rssi, data, len, &rec);
        (void)kdrv_ble_heard_feed(&rec);
        if (g.hear_cb) g.hear_cb(KDRV_BLE_HEAR_RECORD);
        return;
    }
    if (!g.dev_taken) return;
    uint8_t addr[6];
    for (uint8_t i = 0u; 6u > i; ++i) addr[i] = addr_le[5u - i];
    for (uint8_t i = 0u; i < g.count; ++i) {
        kdrv_ble_dev_t *d = &g.dev[i];
        if (memcmp(d->addr, addr, 6u) == 0) {
            if (rssi > d->rssi) d->rssi = rssi;
            if ('\0' == d->name[0] && parsed && f.name && 0u < f.name_len) {
                size_t const n = ((sizeof d->name - 1u) > f.name_len) ? f.name_len : (sizeof d->name - 1u);
                memcpy(d->name, f.name, n); d->name[n] = '\0';
            }
            take_fields(d, atype, &f, parsed);
            return;
        }
    }
    if (KDRV_BLE_SCAN_MAX <= g.count) return;
    kdrv_ble_dev_t *const d = &g.dev[g.count];
    memset(d, 0, sizeof *d);
    memcpy(d->addr, addr, sizeof d->addr);
    d->rssi = rssi;
    if (parsed && f.name && 0u < f.name_len) {
        size_t const n = ((sizeof d->name - 1u) > f.name_len) ? f.name_len : (sizeof d->name - 1u);
        memcpy(d->name, f.name, n); d->name[n] = '\0';
    }
    take_fields(d, atype, &f, parsed);
    ++g.count;
}
static void disc_complete(void)
{
    g.scan.on = false;
    co_stop(CO_SCAN);
    if (g.hearing) {
        g.hearing = false;
        if (g.hear_cb) g.hear_cb(KDRV_BLE_HEAR_ENDED);
    } else {
        wbits_set(BIT_SCAN_DONE);
    }
}

/* ---- pulses (kdrv_ble.c's train, with NimBLE's advert replaced by adv_start_ctrl) ---- */
#define TIME_HALF 0x80000000u
static uint32_t pulse_ms_left(uint32_t due, uint32_t now) { uint32_t const left = due - now; return (TIME_HALF > left) ? left : 0u; }
static kdrv_ble_pulse_t pulse_input(uint32_t now, bool timed_out)
{
    kdrv_ble_pulse_t in;
    in.live = g.pulse.live; in.timed_out = timed_out; in.itvl = g.pulse.itvl; in.leg_ms = g.pulse.leg_ms;
    in.leg_run_ms = now - g.pulse.leg_t0; in.pulse_run_ms = now - g.pulse.pulse_t0; in.refused = g.pulse.refused;
    return in;
}
static bool pulse_arm(uint32_t wait_ms) { g.pulse.due = now_ms() + wait_ms; co_reset(CO_PULSE, wait_ms); return true; }
static int pulse_begin(uint16_t itvl)
{
    int rc = HS_EALREADY;
    if (!g.pulse.live) {
        rc = adv_start_ctrl((int32_t)KDRV_BLE_PULSE_ON_MS);
        if (0 == rc) {
            uint32_t const now = now_ms();
            g.pulse.itvl = itvl; g.pulse.live = true; g.pulse.on_air = true; g.pulse.leg_ms = g.adv_ms;
            g.pulse.leg_t0 = now; g.pulse.pulse_t0 = now; g.pulse.refused = 0u;
        }
    }
    return rc;
}
static bool pulse_ended(int reason)
{
    bool idle = true;
    if (g.pulse.live) {
        uint32_t wait = 0u;
        kdrv_ble_pulse_t const in = pulse_input(now_ms(), HS_ETIMEOUT == reason);
        kdrv_ble_pulse_do_t const act = kdrv_ble_pulse_next(&in, &wait);
        g.pulse.on_air = false;
        if (KDRV_BLE_PULSE_NEXT == act && pulse_arm(wait)) idle = false; else g.pulse.live = false;
    }
    return idle;
}
static void pulse_timer(void)
{
    bool idle = false, began = false, first = false;
    int refusal = 0;
    uint32_t wait = 0u;
    if (g.pulse.live && !g.pulse.on_air) {
        uint32_t const now = now_ms();
        uint32_t const left = pulse_ms_left(g.pulse.due, now);
        if (0u != left) {
            idle = !pulse_arm(left);
        } else {
            kdrv_ble_pulse_t in = pulse_input(now, true);
            kdrv_ble_pulse_do_t act = kdrv_ble_pulse_next(&in, &wait);
            if (KDRV_BLE_PULSE_NEXT == act) {
                refusal = adv_start_ctrl((int32_t)KDRV_BLE_PULSE_ON_MS);
                if (0 == refusal || HS_EALREADY == refusal) {
                    refusal = 0; g.pulse.on_air = true; g.pulse.pulse_t0 = now; g.pulse.refused = 0u; began = true;
                } else {
                    ++g.pulse.refused; first = (1u == g.pulse.refused); g.pulse.pulse_t0 = now;
                    in = pulse_input(now, true);
                    act = kdrv_ble_pulse_next(&in, &wait);
                    idle = !(KDRV_BLE_PULSE_NEXT == act && pulse_arm(wait));
                }
            } else {
                idle = true;
            }
        }
        if (idle) { g.pulse.live = false; g.pulse.on_air = false; }
    }
    if (began) KLOG_D(TAG, "advert pulse");
    if (first) KLOG_W(TAG, "an advert pulse was refused (%d); the next is tried at the next period", refusal);
    if (idle) set_state(KDRV_BLE_IDLE);
}
static void adv_complete(int reason)
{
    if (pulse_ended(reason)) { moved(); set_state(KDRV_BLE_IDLE); }
}

/* ---- connection ---- */
static void on_connect(uint8_t atype, const uint8_t addr[6], uint16_t mtu_req)
{
    uint8_t why = 0;
    if (!g.up || !g.synced) why = 3;
    else if (CONN_NONE != g.conn) why = 2;
    else if (!g.adv.on) why = 0;
    else if (!g.adv.connectable) why = 1;
    else why = 255;
    if (255 != why) {
        wbuf_t w = { .n = 0 };
        w8(&w, why);
        out_w(OUT_CONN_FAIL, &w);
        return;
    }
    moved();
    pulse_train_end();
    adv_stop_ctrl();
    uint16_t const h = (uint16_t)(++g.next_conn & 0x0EFFu);
    g.c.type = atype; memcpy(g.c.addr, addr, 6); g.c.enc = g.c.auth = false; g.c.mtu = MTU_DEFAULT;
    KLOG_N(TAG, "connected");
    g.conn = h;
    ++g.links;
    g.secure = false;
    kdrv_ble_app_link_reset();
    set_state(KDRV_BLE_CONNECTED);
    wbuf_t ok = { .n = 0 };
    w16(&ok, h); w16(&ok, g.c.mtu);
    out_w(OUT_CONN_OK, &ok);
    {
        kdrv_ble_conn_params_t p;
        kdrv_ble_conn_params(false, &p);
        wbuf_t w = { .n = 0 };
        w16(&w, h); w16(&w, p.itvl_min); w16(&w, p.itvl_max); w16(&w, p.latency); w16(&w, p.timeout);
        out_w(OUT_CONN_PARAMS, &w);
    }
    if (mtu_req) {
        uint16_t mine = (uint16_t)(KDRV_BLE_APP_VALUE_MAX + NOTIFY_HDR);
        if (APP_MTU_MAX < mine) mine = (uint16_t)APP_MTU_MAX;
        uint16_t m = mtu_req < mine ? mtu_req : mine;
        if (m < MTU_DEFAULT) m = MTU_DEFAULT;
        g.c.mtu = m;
        wbuf_t w = { .n = 0 };
        w16(&w, h); w16(&w, m);
        out_w(OUT_MTU, &w);
    }
    wbuf_t sr = { .n = 0 };
    w16(&sr, h);
    out_w(OUT_SEC_REQ, &sr);      /* ble_gap_security_initiate(): the peer is not encrypted yet */
}

/* ---- GATT ---- */
static chr_t *chr_by_val(uint16_t h) { for (unsigned i = 0; i < g.nchr; ++i) if (g.chr[i].val == h) return &g.chr[i]; return NULL; }
static chr_t *chr_by_cccd(uint16_t h) { for (unsigned i = 0; i < g.nchr; ++i) if (g.chr[i].cccd && g.chr[i].cccd == h) return &g.chr[i]; return NULL; }

/* ATT_OK, or the error NimBLE answers when the link is not enough */
static int sec_check(uint32_t flags, uint32_t enc_bit, uint32_t authen_bit)
{
    if ((flags & enc_bit) && !g.c.enc) return ATT_INSUFFICIENT_ENC;
    if ((flags & authen_bit) && !g.c.auth) return ATT_INSUFFICIENT_AUTHEN;
    return ATT_OK;
}

static void att_rsp(uint32_t id, int status, const uint8_t *data, uint16_t len)
{
    wbuf_t w = { .n = 0 };
    w32(&w, id); w8(&w, (uint8_t)status); w16(&w, len); wn(&w, data, len);
    out_w(OUT_ATT_RSP, &w);
}

static void subscribed(chr_t *c, bool on)
{
    c->sub = on;
    if (c->kind == K_TX) { g.console_on = on; KLOG_N(TAG, "console %s", on ? "attached" : "detached"); }
#if MIRROR_PIPE
    else if (c->kind == K_MIRROR) { g.mirror_on = on; KLOG_N(TAG, "mirror %s", on ? "attached" : "detached"); }
#endif
    else if (c->kind == K_APP) kdrv_ble_app_subscribed(c->app_i, on);
}

static void on_att(uint32_t id, uint16_t conn, uint8_t op, uint16_t handle, uint16_t off, const uint8_t *data, uint16_t len)
{
    moved();
    if (conn != g.conn || CONN_NONE == g.conn) { att_rsp(id, ATT_UNLIKELY, NULL, 0); return; }
    uint8_t out[REC_MAX + 8u];
    if (op == ATT_CCCD) {
        chr_t *c = chr_by_cccd(handle);
        if (!c) { att_rsp(id, ATT_NOT_FOUND, NULL, 0); return; }
        int e = sec_check(c->flags, F_NOTIFY_ENC, F_NOTIFY_AUTHEN);
        if (e) { att_rsp(id, e, NULL, 0); return; }
        if (len != 2u) { att_rsp(id, ATT_INVALID_VALUE_LEN, NULL, 0); return; }
        bool const on = (data[0] & 1u) != 0u;
        if (c->sub != on) subscribed(c, on);
        att_rsp(id, ATT_OK, NULL, 0);
        return;
    }
    chr_t *c = chr_by_val(handle);
    if (!c) { att_rsp(id, ATT_NOT_FOUND, NULL, 0); return; }
    if (op == ATT_READ) {
        if (!(c->flags & F_READ)) { att_rsp(id, ATT_READ_NOT_PERMITTED, NULL, 0); return; }
        int e = sec_check(c->flags, F_READ_ENC, F_READ_AUTHEN);
        if (e) { att_rsp(id, e, NULL, 0); return; }
        uint16_t n = 0;
        if (c->kind == K_APP) {
            uint8_t *buf = kdrv_ble_app_scratch();
            uint16_t const span = (READ_HDR < g.c.mtu) ? (uint16_t)(g.c.mtu - READ_HDR) : 0u;
            if (!buf) { att_rsp(id, ATT_UNLIKELY, NULL, 0); return; }
            n = kdrv_ble_app_read(c->app_i, off, span, buf, (uint16_t)KDRV_BLE_APP_VALUE_MAX);
            att_rsp(id, ATT_OK, buf, n);
            return;
        }
        if (c->kind == K_BATT) { out[0] = atomic_load(&g.batt_pct); n = 1; }
        else if (c->kind == K_GAPNAME) {
            const char *nm = kdrv_ble_name();
            n = (uint16_t)strlen(nm);
            if (n > sizeof out) n = sizeof out;
            memcpy(out, nm, n);
        } else { att_rsp(id, ATT_READ_NOT_PERMITTED, NULL, 0); return; }
        att_rsp(id, ATT_OK, out, n);
        return;
    }
    /* writes */
    bool const cmd = (op == ATT_WRITE_CMD);
    if (!(c->flags & F_WRITE) && !(cmd && (c->flags & F_WNR))) { if (!cmd) att_rsp(id, ATT_WRITE_NOT_PERMITTED, NULL, 0); return; }
    if (cmd && !(c->flags & F_WNR) && !(c->flags & F_WRITE)) return;
    int e = sec_check(c->flags, F_WRITE_ENC, F_WRITE_AUTHEN);
    if (e) { if (!cmd) att_rsp(id, e, NULL, 0); return; }
    int rc = ATT_UNLIKELY;
    if (c->kind == K_RX) {
        if ((uint16_t)RX_SCRATCH < len) rc = ATT_INVALID_VALUE_LEN;
        else {
            if (g.raw_on && g.raw_cb) g.raw_cb(data, len); else console_feed(data, len);
            rc = ATT_OK;
        }
    } else if (c->kind == K_APP) {
        if ((uint16_t)KDRV_BLE_APP_VALUE_MAX < len) rc = ATT_INVALID_VALUE_LEN;
        else if (kdrv_ble_app_written(c->app_i, data, len)) rc = ATT_OK;
        else rc = ATT_INSUFFICIENT_RES;
    }
    if (!cmd) att_rsp(id, rc, NULL, 0);
}

static void build_table(void)
{
    g.nchr = 0; g.nsvc = 0;
    uint16_t h = 1;
    /* GAP: device name */
    {
        svc_t *s = &g.svc[g.nsvc++]; s->is16 = 1; s->uuid16 = GAP_SVC_UUID16; s->start = h++;
        chr_t *c = &g.chr[g.nchr++]; memset(c, 0, sizeof *c);
        c->kind = K_GAPNAME; c->is16 = 1; c->uuid16 = 0x2A00; c->flags = F_READ; h++; c->val = h++;
        s->end = (uint16_t)(h - 1);
    }
    h = 0x10;
    {
        svc_t *s = &g.svc[g.nsvc++]; s->is16 = 0; memcpy(s->uuid, k_svc_uuid, 16); s->start = h++;
        chr_t *c = &g.chr[g.nchr++]; memset(c, 0, sizeof *c);
        c->kind = K_RX; s_chr_uuid(2, c->uuid); c->flags = F_WRITE | F_WNR | CHR_WRITE_ENC; h++; c->val = g.rx_val = h++;
        c = &g.chr[g.nchr++]; memset(c, 0, sizeof *c);
        c->kind = K_TX; s_chr_uuid(3, c->uuid); c->flags = F_NOTIFY | CHR_NOTIFY_ENC; h++; c->val = g.tx_val = h++; c->cccd = h++;
#if MIRROR_PIPE
        c = &g.chr[g.nchr++]; memset(c, 0, sizeof *c);
        c->kind = K_MIRROR; s_chr_uuid(4, c->uuid); c->flags = F_NOTIFY | CHR_NOTIFY_ENC; h++; c->val = g.mirror_val = h++; c->cccd = h++;
#endif
        s->end = (uint16_t)(h - 1);
    }
    g.app_count = 0;
    kdrv_ble_app_table_t t;
    kdrv_ble_app_perm_t const perm = { .read = F_READ | CHR_READ_ENC, .write = F_WRITE | CHR_WRITE_ENC, .notify = F_NOTIFY | CHR_NOTIFY_ENC };
    bool const served = kdrv_ble_app_build(kdrv_ble_app_fix(), &perm, &t);
    h = 0x20;
    if (served) {
        svc_t *s = &g.svc[g.nsvc++]; s->is16 = 0; memcpy(s->uuid, t.svc_uuid, 16); s->start = h++;
        for (uint8_t i = 0; i < t.count && g.nchr < CHR_MAX; ++i) {
            chr_t *c = &g.chr[g.nchr++]; memset(c, 0, sizeof *c);
            c->kind = K_APP; c->app_i = i; memcpy(c->uuid, t.uuid[i], 16); c->flags = t.flags[i];
            h++; c->val = h++;
            if (c->flags & F_NOTIFY) c->cccd = h++;
        }
        g.app_count = t.count;
        s->end = (uint16_t)(h - 1);
    }
    g.batt_val = 0;
    if (kdrv_ble_battery_declared() && g.nsvc < SVC_MAX && g.nchr < CHR_MAX) {
        h = 0x30;
        svc_t *s = &g.svc[g.nsvc++]; s->is16 = 1; s->uuid16 = BATT_SVC_UUID16; s->start = h++;
        chr_t *c = &g.chr[g.nchr++]; memset(c, 0, sizeof *c);
        c->kind = K_BATT; c->is16 = 1; c->uuid16 = BATT_LEVEL_UUID16; c->flags = F_READ | F_NOTIFY | CHR_READ_ENC | CHR_NOTIFY_ENC;
        h++; c->val = g.batt_val = h++; c->cccd = h++;
        s->end = (uint16_t)(h - 1);
    }
}

/* ---- the IN queue ---- */
static void run_in(void)
{
    while (g.in_w != g.in_r) {
        uint8_t buf[700];
        uint32_t n = (uint32_t)g.in[g.in_r % IN_BYTES] | ((uint32_t)g.in[(g.in_r + 1u) % IN_BYTES] << 8);
        if (n > sizeof buf) n = sizeof buf;
        for (uint32_t i = 0; i < n; ++i) buf[i] = g.in[(g.in_r + 2u + i) % IN_BYTES];
        uint32_t const total = (uint32_t)g.in[g.in_r % IN_BYTES] | ((uint32_t)g.in[(g.in_r + 1u) % IN_BYTES] << 8);
        g.in_r += 2u + total;
        if (!g.up) continue;                     /* the stack is down: the air is deaf to it */
        rbuf_t r = { .p = buf, .n = (uint16_t)n, .i = 0, .bad = false };
        uint8_t const type = r8(&r);
        switch (type) {
        case IN_CONNECT: { uint8_t at = r8(&r); uint8_t a[6]; rn(&r, a, 6); uint16_t m = r16(&r); if (!r.bad) on_connect(at, a, m); break; }
        case IN_DISCONNECT: { uint16_t c = r16(&r); uint8_t why = r8(&r); if (!r.bad && c == g.conn) gap_disconnect_event(why); break; }
        case IN_ATT: {
            uint32_t id = r32(&r); uint16_t c = r16(&r); uint8_t op = r8(&r); uint16_t h = r16(&r); uint16_t off = r16(&r); uint16_t l = r16(&r);
            if (r.bad || r.i + l > r.n) break;
            on_att(id, c, op, h, off, &buf[r.i], l);
            break;
        }
        case IN_SM_PAIR: { uint16_t c = r16(&r); uint8_t io = r8(&r); (void)r8(&r); if (!r.bad && c == g.conn) sm_pair(io); break; }
        case IN_SM_KEY: {
            uint16_t c = r16(&r); uint32_t pk = r32(&r);
            if (r.bad || c != g.conn || !g.sm_wait) break;
            if (pk == g.sm_passkey) sm_complete(true); else sm_fail(0x401u);
            break;
        }
        case IN_SM_CANCEL: { uint16_t c = r16(&r); if (!r.bad && c == g.conn && (g.sm_wait || g.pair_live)) sm_fail(0x401u); break; }
        case IN_SM_ENC: {
            uint16_t c = r16(&r); uint8_t ltk[16]; rn(&r, ltk, 16);
            if (r.bad || c != g.conn) break;
            bond_t *b = bond_find(g.c.addr, g.c.type);
            if (!b) { sm_result(false, 518u, false, false, NULL); enc_change(518); }
            else if (memcmp(b->ltk, ltk, 16) != 0) { sm_result(false, 573u, false, false, NULL); enc_change(573); }
            else { g.c.enc = true; g.c.auth = b->auth != 0; sm_result(true, 0u, g.c.auth, true, b->ltk); enc_change(0); }
            break;
        }
        case IN_DISC: {
            uint8_t evt = r8(&r), at = r8(&r); uint8_t a[6]; rn(&r, a, 6); int8_t rssi = (int8_t)r8(&r); uint8_t l = r8(&r);
            if (r.bad || r.i + l > r.n) break;
            on_disc(evt, at, a, rssi, &buf[r.i], l);
            break;
        }
        case IN_CONFIRM: { uint8_t ok = r8(&r); confirm_answered(ok != 0u); break; }
        case IN_MTU: {
            uint16_t c = r16(&r); uint16_t m = r16(&r);
            if (r.bad || c != g.conn) break;
            uint16_t mine = (uint16_t)(KDRV_BLE_APP_VALUE_MAX + NOTIFY_HDR);
            if (APP_MTU_MAX < mine) mine = (uint16_t)APP_MTU_MAX;
            if (m > mine) m = mine;
            if (m < MTU_DEFAULT) m = MTU_DEFAULT;
            g.c.mtu = m;
            wbuf_t w = { .n = 0 }; w16(&w, c); w16(&w, m); out_w(OUT_MTU, &w);
            break;
        }
        default: break;
        }
    }
}

/* ---- the link follows the radio core ---- */
static void controller_reset(const char *why)
{
    KLOG_W(TAG, "controller reset (%s)", why);
    if (CONN_NONE != g.conn) { terminate_emit(g.conn, ERR_CONN_TIMEOUT); gap_disconnect_event(ERR_CONN_TIMEOUT); }
    scan_cancel();
    g.synced = false;
    g.hearing = false;
    pulse_train_end();
    adv_stop_ctrl();
    set_state(KDRV_BLE_IDLE);
    wbuf_t w = { .n = 0 }; w8(&w, g.up); w8(&w, 0);
    out_w(OUT_STACK, &w);
    wbits_set(BIT_SCAN_DONE);
}
static void controller_sync(void)
{
    uint32_t const ticket = kdrv_ble_bonds_begin();
    uint8_t const n = bond_count();
    wbuf_t bw = { .n = 0 }; w8(&bw, n); out_w(OUT_BONDS, &bw);
    if (kdrv_ble_bonds_settle(ticket, n)) bonds_tell();
    g.synced = true;
    wbuf_t w = { .n = 0 }; w8(&w, g.up); w8(&w, 1);
    out_w(OUT_STACK, &w);
}

static void run_timers(void)
{
    uint32_t const now = now_ms();
    for (int c = 0; c < CO_COUNT; ++c) {
        if (!g_co[c].on || (uint32_t)(now - g_co[c].due) >= TIME_HALF) continue;
        g_co[c].on = false;
        switch (c) {
        case CO_PULSE: pulse_timer(); break;
        case CO_ADV:
            if (g.adv.on) { g.adv.on = false; emit_adv(false); adv_complete(HS_ETIMEOUT); }
            break;
        case CO_TX: g.ev_tx = true; break;
        case CO_MIRROR: g.ev_mirror = true; break;
        case CO_APP: g.ev_app = true; break;
        case CO_SM: if (g.sm_wait) sm_fail((uint16_t)HS_ETIMEOUT); break;
        case CO_SCAN: if (g.scan.on) { scan_emit(false, false, 0); disc_complete(); } break;
        case CO_CONFIRM: if (g.confirm_busy) confirm_report(false); break;
        default: break;
        }
    }
}

static void *host_main(void *arg)
{
    (void)arg;
    lock();
    for (;;) {
        bool const ok = link_ok();
        if (g.up) {
            if (g.synced && !ok) controller_reset("the C5 link is down");
            else if (!g.synced && ok) { controller_sync(); KLOG_D(TAG, "controller in sync again"); }
        }
        g.link_was = ok;
        if (g.up) {
            run_in();
            run_timers();
            if (g.ev_tx) { g.ev_tx = false; console_drain(); }
#if MIRROR_PIPE
            if (g.ev_mirror) { g.ev_mirror = false; mirror_drain(); }
#endif
            if (g.ev_app) { g.ev_app = false; if (g.app_live) app_drain(); }
            if (g.ev_batt) {
                g.ev_batt = false;
                for (unsigned i = 0; i < g.nchr; ++i)
                    if (g.chr[i].kind == K_BATT && g.chr[i].sub && CONN_NONE != g.conn) {
                        uint8_t pct = atomic_load(&g.batt_pct);
                        (void)notify_custom(g.conn, g.chr[i].val, &pct, 1u);
                    }
            }
        } else {
            g.in_r = g.in_w;
        }
        uint32_t wait = LINK_POLL_MS;
        uint32_t const now = now_ms();
        for (int c = 0; c < CO_COUNT; ++c) if (g_co[c].on) {
            uint32_t d = g_co[c].due - now;
            if (d >= TIME_HALF) d = 0;
            if (d < wait) wait = d;
        }
        if (g.in_w != g.in_r || g.ev_tx || g.ev_app || g.ev_batt || g.ev_mirror) wait = 0;
        if (wait > 0u) {
            struct timespec ts;
            clock_gettime(CLOCK_REALTIME, &ts);
            ts.tv_nsec += (long)wait * 1000000L;
            ts.tv_sec += ts.tv_nsec / 1000000000L; ts.tv_nsec %= 1000000000L;
            pthread_cond_timedwait(&g_hcv, &g_mu, &ts);
        }
    }
    return NULL;
}

static void start_thread_once(void)
{
    pthread_mutexattr_t ma;
    pthread_mutexattr_init(&ma);
    pthread_mutexattr_settype(&ma, PTHREAD_MUTEX_RECURSIVE);
    pthread_mutex_init(&g_mu, &ma);
    pthread_cond_init(&g_hcv, NULL);
}
static void ensure_thread(void)
{
    pthread_once(&g_once, start_thread_once);
    if (!g.thread) {
        g.thread = true;
        pthread_t th;
        pthread_attr_t at;
        pthread_attr_init(&at);
        pthread_attr_setdetachstate(&at, PTHREAD_CREATE_DETACHED);
        pthread_attr_setstacksize(&at, 96 * 1024);
        pthread_create(&th, &at, host_main, NULL);
    }
}

/* ======================================================================================== kdrv_ble.h */
static inline void api_lock(void) { pthread_once(&g_once, start_thread_once); lock(); }

uint8_t kdrv_ble_scan_count(void) { api_lock(); uint8_t n = g.count; unlock(); return n; }
bool kdrv_ble_scan_get(uint8_t idx, kdrv_ble_dev_t *out)
{
    api_lock();
    bool ok = (idx < g.count) && out;
    if (ok) *out = g.dev[idx];
    unlock();
    return ok;
}
kdrv_ble_state_t kdrv_ble_state(void) { api_lock(); kdrv_ble_state_t s = g.state; unlock(); return s; }
bool kdrv_ble_addr(uint8_t out[6])
{
    api_lock();
    bool ok = g.synced && out;
    if (ok) memcpy(out, g.addr, 6);
    unlock();
    return ok;
}
uint32_t kdrv_ble_links(void) { api_lock(); uint32_t n = g.links; unlock(); return n; }

extern const kdrv_ble_app_service_t kode_ble_app_service __attribute__((weak));
const kdrv_ble_app_service_t *kdrv_ble_app_declared(void) { return &kode_ble_app_service; }
extern const uint8_t kode_ble_battery_service __attribute__((weak));
bool kdrv_ble_battery_declared(void) { return NULL != &kode_ble_battery_service; }

/* The SDK's own block for the app's NimBLE structures: this host keeps its state itself. Weak, so a stub of the same name elsewhere wins. */
__attribute__((weak)) size_t kdrv_ble_app_host_bytes(void) { return 0u; }

kode_status_t kdrv_ble_set_cb(kdrv_ble_cb_t cb) { if (!cb) return KODE_DENIED; api_lock(); g.cb = cb; unlock(); return KODE_OK; }
kode_status_t kdrv_ble_set_hear_cb(kdrv_ble_hear_cb_t cb) { if (!cb) return KODE_DENIED; api_lock(); g.hear_cb = cb; unlock(); return KODE_OK; }
kode_status_t kdrv_ble_set_pair_cb(kdrv_ble_pair_cb_t cb) { if (!cb) return KODE_DENIED; api_lock(); g.pair_cb = cb; unlock(); return KODE_OK; }

bool kdrv_ble_pair_take(kdrv_ble_pair_t *out)
{
    bool taken = false;
    if (!out) return false;
    api_lock();
    if (KDRV_BLE_PAIR_NONE != g.pair.phase) { *out = g.pair; g.pair.phase = KDRV_BLE_PAIR_NONE; taken = true; }
    unlock();
    return taken;
}
kode_status_t kdrv_ble_pair_reject(void)
{
    api_lock();
    if (!g.pair_live) { unlock(); return KODE_DENIED; }
    g.pair_live = false;
    g.sm_wait = false;
    co_stop(CO_SM);
    KLOG_N(TAG, "pairing refused here");
    sm_result(false, 0x401u, false, false, NULL);
    pair_note(KDRV_BLE_PAIR_DONE, KDRV_BLE_PAIR_REJECTED, 0u);
    if (CONN_NONE != g.conn) gap_terminate(g.conn, ERR_REM_USER_CONN_TERM);
    unlock();
    return KODE_OK;
}

kode_status_t kdrv_ble_console_set_rx_cb(kdrv_ble_console_rx_t cb) { api_lock(); g.rx_cb = cb; unlock(); return KODE_OK; }
kode_status_t kdrv_ble_console_set_raw_cb(kdrv_ble_console_raw_t cb) { api_lock(); g.raw_cb = cb; unlock(); return KODE_OK; }
void kdrv_ble_console_raw(bool on) { api_lock(); g.line_len = 0u; g.line_over = false; g.raw_on = on; unlock(); }

kode_status_t kdrv_ble_console_write(const char *buf, size_t len)
{
    api_lock();
    if (!buf || 0u == len || !g.console_on) { unlock(); return KODE_DENIED; }
    kode_status_t const st = ring_put(&g.ring, buf, len);
    if (KODE_OK != st) ++g.tx_drop;
    g.ev_tx = true;
    wake();
    unlock();
    return st;
}
kode_status_t kdrv_ble_console_write_confirmed(const char *buf, size_t len)
{
    api_lock();
    uint16_t const drops = g.tx_drop;
    kode_status_t const st = kdrv_ble_console_write(buf, len);
    if (KODE_OK == st) {
        if (!g.confirm_want) g.confirm_drops = drops;
        g.confirm_want = true;
        g.ev_tx = true;
        wake();
    }
    unlock();
    return st;
}
kode_status_t kdrv_ble_console_set_sent_cb(kdrv_ble_console_sent_t cb) { api_lock(); g.sent_cb = cb; unlock(); return KODE_OK; }

kode_status_t kdrv_ble_console_selftest(void)
{
    static uint8_t store[64];
    static ring_t r;
    uint8_t out[32];
    size_t n = 0U;
    ring_init(&r, store, sizeof(store));
    if (ring_get(&r, out, sizeof(out), &n)) return KODE_ERROR;
    if (ring_put(&r, "ab\n", 3U) != KODE_OK) return KODE_ERROR;
    if (!ring_get(&r, out, sizeof(out), &n) || 3U != n || memcmp(out, "ab\n", 3U) != 0) return KODE_ERROR;
    if (ring_put(&r, "1\n", 2U) != KODE_OK || ring_put(&r, "2\n", 2U) != KODE_OK) return KODE_ERROR;
    if (!ring_get(&r, out, sizeof(out), &n) || '1' != out[0]) return KODE_ERROR;
    if (!ring_get(&r, out, sizeof(out), &n) || '2' != out[0]) return KODE_ERROR;
    static const char big[80] = { 0 };
    if (ring_put(&r, big, sizeof(big)) != KODE_NO_RESOURCES) return KODE_ERROR;
    if (ring_get(&r, out, sizeof(out), &n)) return KODE_ERROR;
    for (uint8_t i = 0U; 8U > i; ++i) if (ring_put(&r, "xxxx\n", 5U) != KODE_OK) break;
    while (ring_get(&r, out, sizeof(out), &n)) if (5U != n || '\n' != out[4]) return KODE_ERROR;
    if (ring_put(&r, "after\n", 6U) != KODE_OK) return KODE_ERROR;
    return KODE_OK;
}
bool kdrv_ble_console_attached(void) { api_lock(); bool b = g.console_on; unlock(); return b; }
uint16_t kdrv_ble_console_tx_drop(void) { api_lock(); uint16_t n = g.tx_drop; unlock(); return n; }
uint16_t kdrv_ble_console_retry(void) { api_lock(); uint16_t n = g.tx_retry; unlock(); return n; }
uint16_t kdrv_ble_console_backlog(void)
{
    api_lock();
    uint16_t n = 0u;
    if (g.console_on) n = (uint16_t)(g.ring.used + (g.pend_len > g.pend_off ? (g.pend_len - g.pend_off) : 0u));
    unlock();
    return n;
}

#if MIRROR_PIPE
kode_status_t kdrv_ble_mirror_write(const uint8_t *data, size_t len)
{
    api_lock();
    if (!data || 0u == len || !g.mirror_on) { unlock(); return KODE_DENIED; }
    kode_status_t const st = ring_put(&g.mring, (const char *)data, len);
    g.ev_mirror = true;
    wake();
    unlock();
    return st;
}
bool kdrv_ble_mirror_attached(void) { api_lock(); bool b = g.mirror_on; unlock(); return b; }
#else
kode_status_t kdrv_ble_mirror_write(const uint8_t *data, size_t len) { (void)data; (void)len; return KODE_DENIED; }
bool kdrv_ble_mirror_attached(void) { return false; }
#endif

void kdrv_ble_app_kick(void)
{
    api_lock();
    if (g.app_live && kdrv_ble_app_queued()) { g.ev_app = true; wake(); }
    unlock();
}
void kdrv_ble_battery_set(uint8_t pct)
{
    api_lock();
    if (atomic_exchange(&g.batt_pct, pct) != pct && g.batt_live) { g.ev_batt = true; wake(); }
    unlock();
}
#if CONFIG_KODE_LOWPOWER
uint32_t kdrv_ble_activity(void) { return (uint32_t)atomic_load(&g.activity); }
#endif

/* ---- life cycle ---- */
static kode_status_t start_locked(void)
{
    if (g.up) return KODE_OK;
    g.conn = CONN_NONE;
    if (!link_ok()) { KLOG_E(TAG, "the C5 refused to bring its BT controller up"); return KODE_ERROR; }
    ensure_thread();
    bonds_load();
    {   /* the controller's address: the C5's Wi-Fi MAC with the last byte + 2 (BT is the third of its four) */
        static const uint8_t mac[6] = { 0x68, 0x67, 0x25, 0xc5, 0x00, 0x01 };
        if (0 == g.addr[0] && 0 == g.addr[1]) { memcpy(g.addr, mac, 6); g.addr[5] = (uint8_t)(mac[5] + 2u); }
    }
    build_table();
    ring_reset_all();
    g.pend_len = g.pend_off = 0u;
    g.console_on = false;
#if MIRROR_PIPE
    g.mirror_on = false;
    g.mpend_len = g.mpend_off = 0u;
#endif
    g.tx_drop = 0u;
    g.pair.phase = KDRV_BLE_PAIR_NONE;
    g.pair_live = false;
    kdrv_ble_app_link_reset();
    g.app_live = g.app_count > 0u;
    g.batt_live = g.batt_val != 0u;
    g.pulse.live = false; g.pulse.on_air = false;
    g.up = true;
    for (int c = 0; c < CO_COUNT; ++c) g_co[c].on = false;
    g.scan.on = false;
    wbits_clear(BIT_SCAN_DONE | BIT_SCAN_ABORT);
    controller_sync();
    set_state(KDRV_BLE_IDLE);
    KLOG_N(TAG, "BLE up (NimBLE here, the radio on the C5), as '%s'", kdrv_ble_name());
    wake();
    return KODE_OK;
}
kode_status_t kdrv_ble_start(void)
{
    api_lock();
    kode_status_t const rc = start_locked();
    unlock();
    return rc;
}

kode_status_t kdrv_ble_quiet(void)
{
    api_lock();
    if (!g.up) { unlock(); return KODE_OK; }
    adv_halt();
    g.hearing = false;
    scan_cancel();
    if (CONN_NONE != g.conn) {
        console_drain();         /* what is in the ring reaches the stack first (console_hangup) */
        gap_terminate(g.conn, ERR_REM_USER_CONN_TERM);
    }
    set_state(KDRV_BLE_IDLE);
    KLOG_N(TAG, "BLE quiet (the host stays up; see kdrv_ble_stop)");
    unlock();
    return KODE_OK;
}

kode_status_t kdrv_ble_stop(void)
{
    api_lock();
    if (!g.up) { unlock(); return KODE_OK; }
    adv_halt();
    g.hearing = false;
    scan_cancel();
    app_quiet();
    if (CONN_NONE != g.conn) { terminate_emit(g.conn, ERR_LOCAL_HOST_TERM); gap_disconnect_event(ERR_LOCAL_HOST_TERM); }
    kdrv_ble_app_link_reset();
    g.up = false; g.synced = false; g.count = 0u;
    wbuf_t w = { .n = 0 }; w8(&w, 0); w8(&w, 0);
    out_w(OUT_STACK, &w);
    set_state(KDRV_BLE_OFF);
    wbits_set(BIT_SCAN_DONE);
    KLOG_N(TAG, "BLE down");
    unlock();
    return KODE_OK;
}

void kdrv_ble_forget(void)
{
    api_lock();
    pulse_train_end();
    scan_cancel();
    adv_stop_ctrl();
    if (CONN_NONE != g.conn) terminate_emit(g.conn, ERR_CONN_TIMEOUT);
    g.up = false; g.synced = false; g.hearing = false; g.count = 0u;
    g.state = KDRV_BLE_OFF;
    g.conn = CONN_NONE;
    g.console_on = false;
#if MIRROR_PIPE
    g.mirror_on = false;
#endif
    g.tx_drop = 0u;
    g.pair_live = false; g.sm_wait = false;
    app_quiet();
    kdrv_ble_app_link_reset();
    wbuf_t w = { .n = 0 }; w8(&w, 0); w8(&w, 0);
    out_w(OUT_STACK, &w);
    wbits_set(BIT_SCAN_DONE);
    unlock();
}

uint8_t kdrv_ble_bonds(void)
{
    api_lock();
    uint8_t n = g.up ? kdrv_ble_bonds_kept() : 0u;
    unlock();
    return n;
}
kode_status_t kdrv_ble_unpair(void)
{
    api_lock();
    kode_status_t const rc = start_locked();
    if (KODE_OK == rc) {
        bonds_load();
        memset(g_bonds->b, 0, sizeof g_bonds->b);
        bonds_dirty();
        bonds_recount();
    }
    unlock();
    return rc;
}

static kode_status_t rsp_pack(const char *name, const uint8_t *data, size_t len)
{
    uint8_t buf[KDRV_BLE_ADV_MAX];
    size_t n = 0U;
    const char *who = name;
    if (!who) who = kdrv_ble_serial_name();
    kode_status_t const rc = kdrv_ble_adv_pack(who, data, len, buf, sizeof buf, &n);
    if (KODE_OK == rc) { memcpy(g.rsp, buf, n); g.rsp_len = (uint8_t)n; }
    return rc;
}
kode_status_t kdrv_ble_set_scan_rsp(const char *name, const uint8_t *data, size_t len)
{
    api_lock();
    kode_status_t const rc = rsp_pack(name, data, len);
    if (KODE_OK != rc) {
        KLOG_W(TAG, "scan response refused: the name and %u byte(s) of data do not fit its %u", (unsigned)len, (unsigned)KDRV_BLE_ADV_MAX);
        unlock();
        return rc;
    }
    g.rsp_set = true;
    g.name[0] = '\0';
    if (name) snprintf(g.name, sizeof g.name, "%s", name);
    if (g.synced && !g.adv_hidden) {
        memcpy(g_adv_rsp, g.rsp, g.rsp_len); g_adv_rsp_len = g.rsp_len;
        if (g.adv.on) emit_adv(true);
    }
    KLOG_N(TAG, "scan response: %u of %u bytes", (unsigned)g.rsp_len, (unsigned)KDRV_BLE_ADV_MAX);
    unlock();
    return KODE_OK;
}
const char *kdrv_ble_name(void)
{
    const char *name = g.name;
    if ('\0' == g.name[0]) name = kdrv_ble_serial_name();
    return name;
}
bool kdrv_ble_link_secure(void) { api_lock(); bool b = g.secure; unlock(); return b; }

void kdrv_ble_adv_plan(uint16_t itvl, uint32_t ms, bool hidden, bool pulsed)
{
    api_lock();
    g.adv_itvl = itvl; g.adv_ms = ms; g.adv_hidden = hidden; g.adv_pulsed = pulsed;
    unlock();
}

static kode_status_t advertise_on(void)
{
    kode_status_t const rc = start_locked();
    if (KODE_OK != rc) return rc;
    if (KDRV_BLE_CONNECTED == g.state) { KLOG_W(TAG, "already connected; not advertising"); return KODE_DENIED; }
    if (!g.synced) { KLOG_E(TAG, "ble_gap_adv_start: %d", HS_ENOTSYNCED); return KODE_ERROR; }
    bool const hidden = g.adv_hidden;
    /* the advertising data: flags, the 128-bit service (the console's, or the app's), the tx power */
    uint8_t d[KDRV_BLE_ADV_MAX];
    uint8_t n = 0;
    d[n++] = 2; d[n++] = 0x01; d[n++] = (uint8_t)(0x04u | (hidden ? 0x00u : 0x02u));
    const uint8_t *uuid = k_svc_uuid;
#if CONFIG_KODE_BLE_ADVERTISE_APP_SERVICE
    for (unsigned i = 0; i < g.nsvc; ++i) if (!g.svc[i].is16 && memcmp(g.svc[i].uuid, k_svc_uuid, 16) != 0 && g.app_count) { uuid = g.svc[i].uuid; break; }
#endif
    d[n++] = 17; d[n++] = 0x07; memcpy(&d[n], uuid, 16); n = (uint8_t)(n + 16u);
    d[n++] = 2; d[n++] = 0x0A; d[n++] = 0x09;
    memcpy(g_adv_data, d, n); g_adv_len = n;
    if (!g.rsp_set) (void)rsp_pack(NULL, NULL, 0u);
    if (hidden) g_adv_rsp_len = 0u;
    else { memcpy(g_adv_rsp, g.rsp, g.rsp_len); g_adv_rsp_len = g.rsp_len; }
    g.adv.connectable = true;
    g.adv.discoverable = !hidden;
    uint16_t const itvl = (0u != g.adv_itvl) ? g.adv_itvl : (uint16_t)KDRV_BLE_ITVL_SLOW;
    bool const pulsed = g.adv_pulsed;
    int rc_n;
    if (pulsed) {
        g.pulse.itvl = itvl;
        rc_n = pulse_begin(itvl);
    } else {
        pulse_train_end();
        rc_n = adv_start_ctrl((0u != g.adv_ms) ? (int32_t)g.adv_ms : 0);
    }
    if (0 != rc_n && HS_EALREADY != rc_n) { KLOG_E(TAG, "ble_gap_adv_start: %d", rc_n); return KODE_ERROR; }
    set_state(KDRV_BLE_ADVERTISING);
    if (pulsed && 0 == rc_n) KLOG_D(TAG, "advert pulse");
    if (g.adv_said && g.adv_said_hidden == hidden && g.adv_said_pulsed == pulsed) return KODE_OK;
    g.adv_said = true; g.adv_said_hidden = hidden; g.adv_said_pulsed = pulsed;
    if (pulsed) {
        uint32_t const every = kdrv_ble_pulse_period_ms(itvl);
        if (hidden) KLOG_I(TAG, "advertising hidden, to the devices that know it, one event every %u ms", (unsigned)every);
        else KLOG_I(TAG, "advertising as '%s', one event every %u ms", kdrv_ble_name(), (unsigned)every);
    } else if (hidden) KLOG_I(TAG, "advertising hidden, to the devices that know it");
    else KLOG_I(TAG, "advertising as '%s'", kdrv_ble_name());
    return KODE_OK;
}
kode_status_t kdrv_ble_advertise(bool on)
{
    api_lock();
    kode_status_t rc = KODE_OK;
    if (!on) {
        if (g.up) { adv_halt(); set_state(KDRV_BLE_IDLE); }
    } else {
        rc = advertise_on();
    }
    unlock();
    return rc;
}
kode_status_t kdrv_ble_adv_calm(uint32_t ms)
{
    api_lock();
    kode_status_t rc = KODE_OK;
    if (g.up && KDRV_BLE_ADVERTISING == g.state && (g.adv_pulsed || (0u != g.adv_itvl && (uint16_t)KDRV_BLE_ITVL_SLOW > g.adv_itvl))) {
        adv_halt();
        g.adv_itvl = (uint16_t)KDRV_BLE_ITVL_SLOW; g.adv_ms = ms; g.adv_pulsed = false;
        rc = advertise_on();
    }
    unlock();
    return rc;
}
kode_status_t kdrv_ble_conn_calm(bool rest)
{
    api_lock();
    kode_status_t rc = KODE_OK;
    if (g.up && CONN_NONE != g.conn) {
        kdrv_ble_conn_params_t p;
        kdrv_ble_conn_params(rest, &p);
        wbuf_t w = { .n = 0 };
        w16(&w, g.conn); w16(&w, p.itvl_min); w16(&w, p.itvl_max); w16(&w, p.latency); w16(&w, p.timeout);
        out_w(OUT_CONN_PARAMS, &w);
    }
    unlock();
    return rc;
}

static void hear_yield(void)
{
    if (g.hearing) { g.hearing = false; scan_cancel(); }
}
static bool scan_start(bool passive, uint32_t ms /* 0: forever */)
{
    if (g.scan.on) return false;
    g.scan.on = true; g.scan.passive = passive;
    uint32_t speed = g.cfg[CFG_SCAN_SPEED] > 0 ? (uint32_t)g.cfg[CFG_SCAN_SPEED] : 1u;
    if (ms) { uint32_t m = ms / speed; if (m < 1u) m = 1u; co_reset(CO_SCAN, m); } else co_stop(CO_SCAN);
    scan_emit(true, passive, ms);
    return true;
}
kode_status_t kdrv_ble_scan(uint32_t ms)
{
    api_lock();
    hear_yield();
    kode_status_t const rc = start_locked();
    if (KODE_OK != rc) { unlock(); return rc; }
    g.dev_taken = true;
    g.count = 0u;
    wbits_clear(BIT_SCAN_DONE);
    if (g.scan_abort) {
        KLOG_N(TAG, "scan: ended before it listened, as its owner asked");
        unlock();
        return KODE_DENIED;
    }
    if (!g.synced || !scan_start(false, ms)) { KLOG_E(TAG, "ble_gap_disc: %d", g.synced ? HS_EALREADY : HS_ENOTSYNCED); unlock(); return KODE_ERROR; }
    unlock();
    unsigned const bits = wbits_wait(BIT_SCAN_DONE | BIT_SCAN_ABORT, ms + SCAN_MARGIN_MS);
    lock();
    if (bits & BIT_SCAN_ABORT) {
        scan_cancel();
        KLOG_N(TAG, "scan: ended early with %u device(s), as its owner asked", (unsigned)g.count);
        unlock();
        return KODE_DENIED;
    }
    if (!(bits & BIT_SCAN_DONE)) { scan_cancel(); KLOG_W(TAG, "the scan did not report its own end"); }
    KLOG_N(TAG, "scan: %u device(s)", (unsigned)g.count);
    unlock();
    return KODE_OK;
}
void kdrv_ble_scan_abort(bool on)
{
    api_lock();
    g.scan_abort = on;
    unlock();
    if (on) wbits_set(BIT_SCAN_ABORT); else wbits_clear(BIT_SCAN_ABORT);
}
kode_status_t kdrv_ble_scan_find(const char *name, uint32_t max_ms, kdrv_ble_dev_t *dev, bool *found)
{
    if (!dev || !found) return KODE_DENIED;
    api_lock();
    hear_yield();
    if (!kdrv_ble_find_begin(&g.find, name)) { unlock(); return KODE_DENIED; }
    kode_status_t const rc = start_locked();
    if (KODE_OK != rc) { kdrv_ble_find_end(&g.find); unlock(); return rc; }
    wbits_clear(BIT_SCAN_DONE);
    if (!g.synced || !scan_start(false, max_ms)) { kdrv_ble_find_end(&g.find); KLOG_E(TAG, "ble_gap_disc (find): %d", HS_EALREADY); unlock(); return KODE_ERROR; }
    unlock();
    unsigned const bits = wbits_wait(BIT_SCAN_DONE, max_ms + SCAN_MARGIN_MS);
    lock();
    kdrv_ble_find_end(&g.find);
    if (g.find.hit || !(bits & BIT_SCAN_DONE)) scan_cancel();
    if (g.find.hit) { *dev = g.find.dev; *found = true; } else { *found = false; }
    unlock();
    return KODE_OK;
}
kode_status_t kdrv_ble_hear(bool on)
{
    api_lock();
    if (!on) {
        if (g.hearing) { g.hearing = false; scan_cancel(); }
        unlock();
        return KODE_OK;
    }
    hear_yield();
    if (!g.up || !g.synced || g.scan.on) { unlock(); return KODE_DENIED; }
    g.hearing = true;
    if (!scan_start(true, 0u)) { g.hearing = false; KLOG_E(TAG, "ble_gap_disc (hear): %d", HS_EALREADY); unlock(); return KODE_ERROR; }
    unlock();
    return KODE_OK;
}

/* ======================================================================================== page side */
EMSCRIPTEN_KEEPALIVE int ble_in(const uint8_t *buf, int len)
{
    api_lock();
    int rc = 0;
    if (len <= 0 || len > 1400 || IN_BYTES - (g.in_w - g.in_r) < (uint32_t)len + 2u) { ++g.in_dropped; rc = -1; }
    else {
        g.in[g.in_w % IN_BYTES] = (uint8_t)(len & 255); g.in[(g.in_w + 1u) % IN_BYTES] = (uint8_t)(len >> 8);
        for (int i = 0; i < len; ++i) g.in[(g.in_w + 2u + (uint32_t)i) % IN_BYTES] = buf[i];
        g.in_w += 2u + (uint32_t)len;
        if (g.thread) wake();
    }
    unlock();
    return rc;
}
EMSCRIPTEN_KEEPALIVE int ble_out_pop(uint8_t *buf, int cap)
{
    api_lock();
    int n = 0;
    if (g.out_w != g.out_r) {
        uint32_t const l = (uint32_t)g.out[(g.out_r + 1u) % OUT_BYTES] | ((uint32_t)g.out[(g.out_r + 2u) % OUT_BYTES] << 8);
        if ((int)(3u + l) <= cap) {
            for (uint32_t i = 0; i < 3u + l; ++i) buf[i] = g.out[(g.out_r + i) % OUT_BYTES];
            g.out_r += 3u + l;
            n = (int)(3u + l);
        } else n = -1;
    }
    unlock();
    return n;
}
EMSCRIPTEN_KEEPALIVE void ble_cfg(int key, int val)
{
    api_lock();
    if (key >= 0 && key < CFG_COUNT) g.cfg[key] = val;
    if (key == CFG_STALL && !val && g.thread) { g.ev_tx = g.ev_app = true;
#if MIRROR_PIPE
        g.ev_mirror = true;
#endif
        wake(); }
    unlock();
}
EMSCRIPTEN_KEEPALIVE int ble_cfg_get(int key)
{
    api_lock();
    int v = (key >= 0 && key < CFG_COUNT) ? g.cfg[key] : 0;
    unlock();
    return v;
}
EMSCRIPTEN_KEEPALIVE void ble_stat(uint32_t *out)
{
    api_lock();
    out[STAT_UP] = g.up; out[STAT_SYNCED] = g.synced; out[STAT_STATE] = (uint32_t)g.state;
    out[STAT_CONN] = (CONN_NONE == g.conn) ? 0xFFFFu : g.conn; out[STAT_LINKS] = g.links; out[STAT_SECURE] = g.secure;
    out[STAT_BONDS] = bond_count(); out[STAT_OUT_DROPPED] = g.out_dropped; out[STAT_IN_DROPPED] = g.in_dropped;
    unlock();
}
EMSCRIPTEN_KEEPALIVE void ble_set_addr(const uint8_t *a)
{
    api_lock();
    memcpy(g.addr, a, 6);
    unlock();
}
/* The info as JSON: for the page and for tests. Returns the length (0 when cap is too small). */
EMSCRIPTEN_KEEPALIVE int ble_info(char *buf, int cap)
{
    api_lock();
    int n = snprintf(buf, (size_t)cap,
        "{\"up\":%d,\"synced\":%d,\"state\":%d,\"name\":\"%s\",\"addr\":\"%02x:%02x:%02x:%02x:%02x:%02x\",\"conn\":%d,\"links\":%u,\"secure\":%d,"
        "\"hearing\":%d,\"hidden\":%d,\"pulsed\":%d,\"adv\":%d,\"scan\":%d,\"mtu\":%u,\"enc\":%d,\"auth\":%d,\"console\":%d,\"mirror\":%d,"
        "\"txDrop\":%u,\"txRetry\":%u,\"bonds\":%u,\"pairLive\":%d,\"passkey\":%lld,\"app\":%u,\"batt\":%d,\"count\":%u,\"outDropped\":%u,\"inDropped\":%u,"
        "\"peer\":\"%02x:%02x:%02x:%02x:%02x:%02x\",\"bondList\":[",
        g.up, g.synced, (int)g.state, kdrv_ble_name(), g.addr[0], g.addr[1], g.addr[2], g.addr[3], g.addr[4], g.addr[5],
        CONN_NONE == g.conn ? -1 : (int)g.conn, g.links, g.secure, g.hearing, g.adv_hidden, g.adv_pulsed, g.adv.on, g.scan.on, g.c.mtu, g.c.enc, g.c.auth,
        g.console_on, g.mirror_on, g.tx_drop, g.tx_retry, bond_count(), g.pair_live,
        (long long)(g.pair_live ? (int64_t)g.sm_passkey : -1), g.app_count, g.batt_val != 0, g.count, g.out_dropped, g.in_dropped,
        g.c.addr[5], g.c.addr[4], g.c.addr[3], g.c.addr[2], g.c.addr[1], g.c.addr[0]);
    for (unsigned i = 0, k = 0; i < BONDS_MAX && n > 0 && n < cap; ++i) {
        bond_t const *b = &g_bonds->b[i];
        if (!b->used) continue;
        n += snprintf(buf + n, (size_t)(cap - n), "%s{\"addr\":\"%02x:%02x:%02x:%02x:%02x:%02x\",\"type\":%u,\"auth\":%u,\"seq\":%u}", k++ ? "," : "",
                      b->addr[5], b->addr[4], b->addr[3], b->addr[2], b->addr[1], b->addr[0], b->type, b->auth, b->seq);
    }
    if (n > 0 && n < cap) n += snprintf(buf + n, (size_t)(cap - n), "]}");
    unlock();
    return (n > 0 && n < cap) ? n : 0;
}
/* The GATT table as JSON: services with their characteristics. */
EMSCRIPTEN_KEEPALIVE int ble_gatt_json(char *buf, int cap)
{
    api_lock();
    int n = snprintf(buf, (size_t)cap, "[");
    for (unsigned s = 0; s < g.nsvc && n > 0 && n < cap; ++s) {
        svc_t const *sv = &g.svc[s];
        char u[40];
        if (sv->is16) snprintf(u, sizeof u, "%04x", sv->uuid16);
        else { int k = 0; for (int i = 15; i >= 0; --i) { k += snprintf(u + k, sizeof u - (size_t)k, "%02x", sv->uuid[i]); if (i == 12 || i == 10 || i == 8 || i == 6) u[k++] = '-'; } u[k] = 0; }
        n += snprintf(buf + n, (size_t)(cap - n), "%s{\"uuid\":\"%s\",\"start\":%u,\"end\":%u,\"chars\":[", s ? "," : "", u, sv->start, sv->end);
        bool first = true;
        for (unsigned i = 0; i < g.nchr && n < cap; ++i) {
            chr_t const *c = &g.chr[i];
            if (c->val < sv->start || c->val > sv->end) continue;
            char cu[40];
            if (c->is16) snprintf(cu, sizeof cu, "%04x", c->uuid16);
            else { int k = 0; for (int j = 15; j >= 0; --j) { k += snprintf(cu + k, sizeof cu - (size_t)k, "%02x", c->uuid[j]); if (j == 12 || j == 10 || j == 8 || j == 6) cu[k++] = '-'; } cu[k] = 0; }
            static const char *const kind[] = { "gap-name", "console-rx", "console-tx", "mirror", "app", "battery" };
            n += snprintf(buf + n, (size_t)(cap - n),
                "%s{\"uuid\":\"%s\",\"handle\":%u,\"cccd\":%u,\"read\":%d,\"write\":%d,\"writeNoRsp\":%d,\"notify\":%d,\"enc\":%d,\"authen\":%d,\"kind\":\"%s\",\"index\":%u}",
                first ? "" : ",", cu, c->val, c->cccd, !!(c->flags & F_READ), !!(c->flags & F_WRITE), !!(c->flags & F_WNR), !!(c->flags & F_NOTIFY),
                !!(c->flags & (F_READ_ENC | F_WRITE_ENC | F_NOTIFY_ENC)), !!(c->flags & (F_READ_AUTHEN | F_WRITE_AUTHEN | F_NOTIFY_AUTHEN)), kind[c->kind], c->app_i);
            first = false;
        }
        if (n > 0 && n < cap) n += snprintf(buf + n, (size_t)(cap - n), "]}");
    }
    if (n > 0 && n < cap) n += snprintf(buf + n, (size_t)(cap - n), "]");
    unlock();
    return (n > 0 && n < cap) ? n : 0;
}
/* Plant a bond (a phone "paired in kodeOS earlier"): addr in NimBLE order, type 0/1, ltk 16 bytes. Returns the new count. */
EMSCRIPTEN_KEEPALIVE int ble_bond_inject(const uint8_t *addr_le, int type, const uint8_t *ltk, int auth)
{
    api_lock();
    bonds_load();
    bool ok = false;
    {   /* the store is full for an app: a planted bond still lands in a free slot only */
        bond_t *b = bond_find(addr_le, (uint8_t)type);
        for (unsigned i = 0; i < BONDS_MAX && !b; ++i) if (!g_bonds->b[i].used) b = &g_bonds->b[i];
        if (b) {
            memset(b, 0, sizeof *b);
            b->used = 1; b->type = (uint8_t)type; b->auth = auth ? 1 : 0; memcpy(b->addr, addr_le, 6); memcpy(b->ltk, ltk, 16); b->seq = ++g_bonds->nextseq;
            bonds_dirty();
            ok = true;
        }
    }
    int n = ok ? (int)bond_count() : -1;
    if (ok && g.up) bonds_recount();
    unlock();
    return n;
}
EMSCRIPTEN_KEEPALIVE uint8_t *ble_blob_ptr(void) { return g_region + BLOB_OFF + 8u; }
EMSCRIPTEN_KEEPALIVE uint32_t ble_blob_len(void)
{
    uint32_t m, l;
    memcpy(&m, g_region + BLOB_OFF, 4); memcpy(&l, g_region + BLOB_OFF + 4, 4);
    return (m == BLOB_MAGIC && l <= REGION_BYTES - BLOB_OFF - 8u) ? l : 0u;
}
EMSCRIPTEN_KEEPALIVE int ble_blob_commit(uint32_t len)
{
    if (len > REGION_BYTES - BLOB_OFF - 8u) return -1;
    uint32_t m = BLOB_MAGIC;
    memcpy(g_region + BLOB_OFF, &m, 4); memcpy(g_region + BLOB_OFF + 4, &len, 4);
    if (g_reg) dbp_dirty(g_reg, BLOB_OFF, 8u + len);
    return 0;
}
/* A hook for tests: forget everything this module keeps in memory (not the persisted region). */
EMSCRIPTEN_KEEPALIVE void ble_reset_counters(void)
{
    api_lock();
    g.out_dropped = g.in_dropped = 0u;
    unlock();
}

#endif /* CONFIG_KODEOS_BLE && CONFIG_KODEOS_BLE_CONSOLE */
