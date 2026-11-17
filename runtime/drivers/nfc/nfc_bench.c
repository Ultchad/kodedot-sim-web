/* SPDX-License-Identifier: GPL-3.0-or-later
 * The bench objects of the NFC area and the C functions the page calls (exports in area.json).
 * Threading: every export runs on the page's thread. They only touch plain memory under a short
 * spin lock (no SDK call, no sleep, no allocation inside), exactly what the area guide allows. */
#include <emscripten.h>
#include <sched.h>
#include <stdatomic.h>
#include <string.h>
#include <time.h>
#include "kweb_bridge.h"
#include "dotbench_persist.h"
#include "nfc_bench.h"

#define STORE_MAGIC 0x4E464331u   /* "NFC1" */
#define EV_RING 128u

static atomic_flag g_lk = ATOMIC_FLAG_INIT;
/* The store lives in the persistent region "nfc" (runtime/persist: mirrored to the host's durable storage with the other
 * regions). A region is a whole number of 4 KiB chunks, so the buffer is rounded up. */
#define NFC_REGION_BYTES ((sizeof(nfc_store_t) + 4095u) & ~4095u)
static uint8_t g_region[NFC_REGION_BYTES] __attribute__((aligned(64)));
#define g_store (*(nfc_store_t *)(void *)g_region)
static dbp_region_t *g_reg;
static uint32_t g_ev[EV_RING][4];
static uint32_t g_ev_head, g_ev_tail, g_ev_lost;

__attribute__((constructor(120))) static void nfc_store_register(void)
{
    g_reg = dbp_register("nfc", g_region, sizeof g_region, 0);
}

void nfc_lock(void)
{
    while (atomic_flag_test_and_set_explicit(&g_lk, memory_order_acquire)) sched_yield();
}
/* Every section that holds the lock may have changed the store (the fake driver writes tag memory, the page edits objects), so at
 * unlock the region is compared, a 4 KiB chunk at a time, with a shadow copy of what was last reported, and only chunks that differ
 * are marked dirty. (Marking the whole region at every unlock made the persist generation counter move ~350-1750 times a second
 * while kodeOS idled, which defeats the host's 800 ms "quiet" debounce.) The compare runs under the lock, before it is released. */
static uint8_t g_shadow[sizeof g_region];
void nfc_unlock(void)
{
    if (g_reg) {
        for (uint32_t o = 0; o < sizeof g_region; o += 4096u) {
            uint32_t n = sizeof g_region - o < 4096u ? (uint32_t)(sizeof g_region - o) : 4096u;
            if (memcmp(g_shadow + o, g_region + o, n) != 0) { memcpy(g_shadow + o, g_region + o, n); dbp_dirty(g_reg, o, n); }
        }
    }
    atomic_flag_clear_explicit(&g_lk, memory_order_release);
}

/* The page's thread must not wait unboundedly for this lock (it spins in wasm and never returns to the event loop, while a firmware thread that
 * holds a lock the holder of this one waits for may be blocked on the main thread: pthread_create with an empty worker pool is proxied to it). The
 * page-facing exports take it with a bounded try and answer -9 (busy); the page asks again at its next poll. */
static bool nfc_lock_page(void)
{
    struct timespec t0, t;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    while (atomic_flag_test_and_set_explicit(&g_lk, memory_order_acquire)) {
        clock_gettime(CLOCK_MONOTONIC, &t);
        if ((t.tv_sec - t0.tv_sec) * 1000L + (t.tv_nsec - t0.tv_nsec) / 1000000L >= 20) return false;
    }
    return true;
}

uint32_t nfc_now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint32_t)(ts.tv_sec * 1000u + ts.tv_nsec / 1000000u);
}

/* The region may have been filled by the host before main() (a restart) or be all zero (first boot). */
nfc_store_t *nfc_store(void)
{
    if (g_store.magic != STORE_MAGIC) {
        memset(&g_store, 0, sizeof g_store);
        g_store.magic = STORE_MAGIC;
    }
    return &g_store;
}

void nfc_event_push_locked(uint32_t type, uint32_t id, uint32_t a, uint32_t b)
{
    if (g_ev_head - g_ev_tail >= EV_RING) { g_ev_lost++; return; }
    uint32_t *e = g_ev[g_ev_head % EV_RING];
    e[0] = type; e[1] = id; e[2] = a; e[3] = b;
    g_ev_head++;
}

static nfc_obj_t *obj_of(int id)
{
    nfc_store_t *st = nfc_store();
    if (id < 1 || id > (int)NFC_SLOTS || !st->obj[id - 1].used) return NULL;
    return &st->obj[id - 1];
}

/* ------------------------------------------------------------------ exports */

/* Make an object of a kind (NFC_KIND_*). Returns its id (1..NFC_SLOTS) or -1 when every slot is taken. */
EMSCRIPTEN_KEEPALIVE int nfc_obj_create(int kind)
{
    if (kind < NFC_KIND_T2T || kind > NFC_KIND_READER) return -1;
    if (!nfc_lock_page()) return -9;
    nfc_store_t *st = nfc_store();
    int id = -1;
    for (uint32_t i = 0; i < NFC_SLOTS; i++) {
        if (st->obj[i].used) continue;
        nfc_obj_t *o = &st->obj[i];
        memset(o, 0, sizeof *o);
        o->used = 1; o->kind = (uint8_t)kind;
        if (kind == NFC_KIND_READER) { o->flags = NFC_F_AUTOREAD; o->amp = 0x90; o->mod = 0x30; }
        id = (int)i + 1;
        nfc_event_push_locked(NFC_EV_CREATED, (uint32_t)id, (uint32_t)kind, 0);
        break;
    }
    nfc_unlock();
    return id;
}

/* Destroy an object (it leaves the desk; a device that had it activated finds it gone). */
EMSCRIPTEN_KEEPALIVE int nfc_obj_destroy(int id)
{
    if (!nfc_lock_page()) return -9;
    nfc_obj_t *o = obj_of(id);
    int rc = -1;
    if (o) {
        if (o->near_) nfc_drv_object_near_locked(id - 1, false);
        memset(o, 0, sizeof *o);
        nfc_event_push_locked(NFC_EV_REMOVED, (uint32_t)id, 0, 0);
        rc = 0;
    }
    nfc_unlock();
    return rc;
}

EMSCRIPTEN_KEEPALIVE int nfc_obj_set_identity(int id, const uint8_t *uid, int uid_len, int atqa, int sak)
{
    if (uid_len < 0 || uid_len > (int)NFC_UID_MAX || (uid_len && !uid)) return -2;
    if (!nfc_lock_page()) return -9;
    nfc_obj_t *o = obj_of(id);
    int rc = -1;
    if (o) {
        memset(o->uid, 0, sizeof o->uid);
        if (uid_len) memcpy(o->uid, uid, (size_t)uid_len);
        o->uid_len = (uint8_t)uid_len; o->atqa = (uint16_t)atqa; o->sak = (uint8_t)sak;
        rc = 0;
    }
    nfc_unlock();
    return rc;
}

/* Write bytes into an object's memory (the bench changing the content: allowed while near). */
EMSCRIPTEN_KEEPALIVE int nfc_obj_set_memory(int id, const uint8_t *data, int len, int offset)
{
    if (len < 0 || offset < 0 || offset + len > (int)NFC_MEM_BYTES || (len && !data)) return -2;
    if (!nfc_lock_page()) return -9;
    nfc_obj_t *o = obj_of(id);
    int rc = -1;
    if (o) {
        if (len) memcpy(o->mem + offset, data, (size_t)len);
        if (offset + len > (int)o->mem_len) o->mem_len = (uint16_t)(offset + len);
        rc = 0;
    }
    nfc_unlock();
    return rc;
}

/* Set how many bytes of memory are real (zero-fills a growth, truncates a shrink). */
EMSCRIPTEN_KEEPALIVE int nfc_obj_set_mem_len(int id, int len)
{
    if (len < 0 || len > (int)NFC_MEM_BYTES) return -2;
    if (!nfc_lock_page()) return -9;
    nfc_obj_t *o = obj_of(id);
    int rc = -1;
    if (o) {
        if (len < (int)o->mem_len) memset(o->mem + len, 0, o->mem_len - (uint32_t)len);
        o->mem_len = (uint16_t)len; rc = 0;
    }
    nfc_unlock();
    return rc;
}

EMSCRIPTEN_KEEPALIVE int nfc_obj_set_flags(int id, int flags)
{
    if (!nfc_lock_page()) return -9;
    nfc_obj_t *o = obj_of(id);
    int rc = -1;
    if (o) {
        o->flags = (uint8_t)((o->flags & NFC_F_DROP) | ((uint32_t)flags & ~NFC_F_DROP));   /* DROP is set_param's */
        rc = 0;
    }
    nfc_unlock();
    return rc;
}

/* key NFC_P_*: DROP_AFTER n >= 0 arms "leave the field after n more exchanges", n < 0 disarms;
 * AMP / MOD: a reader's field amplitude byte and its modulation depth. */
EMSCRIPTEN_KEEPALIVE int nfc_obj_set_param(int id, int key, int value)
{
    if (!nfc_lock_page()) return -9;
    nfc_obj_t *o = obj_of(id);
    int rc = -1;
    if (o) {
        rc = 0;
        switch (key) {
        case NFC_P_DROP_AFTER:
            if (value < 0) o->flags &= (uint8_t)~NFC_F_DROP;
            else { o->flags |= NFC_F_DROP; o->drop_left = (uint32_t)value; }
            break;
        case NFC_P_AMP: o->amp = (uint8_t)value; break;
        case NFC_P_MOD: o->mod = (uint8_t)value; break;
        default: rc = -2;
        }
    }
    nfc_unlock();
    return rc;
}

/* Bring an object near the antenna (1) or take it away (0). */
EMSCRIPTEN_KEEPALIVE int nfc_obj_near(int id, int near_)
{
    if (!nfc_lock_page()) return -9;
    nfc_obj_t *o = obj_of(id);
    int rc = -1;
    if (o) {
        bool n = near_ != 0;
        if ((bool)o->near_ != n) {
            o->near_ = n;
            nfc_event_push_locked(NFC_EV_NEAR, (uint32_t)id, n, 0);
            nfc_drv_object_near_locked(id - 1, n);
        }
        rc = 0;
    }
    nfc_unlock();
    return rc;
}

/* 16 words: kind, near, flags, uid_len, atqa, sak, mem_len, writes, reads, mod_seq, sessions,
 *           seen_uid_len, seen_atqa, seen_sak, drop_left (0xFFFFFFFF = not armed), amp | mod << 8 */
EMSCRIPTEN_KEEPALIVE int nfc_obj_info(int id, uint32_t *out)
{
    if (!out) return -2;
    if (!nfc_lock_page()) return -9;
    nfc_obj_t *o = obj_of(id);
    int rc = -1;
    if (o) {
        out[0] = o->kind; out[1] = o->near_; out[2] = o->flags; out[3] = o->uid_len; out[4] = o->atqa; out[5] = o->sak;
        out[6] = o->mem_len; out[7] = o->writes; out[8] = o->reads; out[9] = o->mod_seq; out[10] = o->sessions;
        out[11] = o->seen_uid_len; out[12] = o->seen_atqa; out[13] = o->seen_sak;
        out[14] = (o->flags & NFC_F_DROP) ? o->drop_left : 0xFFFFFFFFu;
        out[15] = (uint32_t)o->amp | ((uint32_t)o->mod << 8);
        rc = 0;
    }
    nfc_unlock();
    return rc;
}

/* Copy bytes out. which: 0 memory (from off), 1 uid, 2 the uid a reader saw, 3 a reader's "pages read" bitmap.
 * Returns the number of bytes copied. */
EMSCRIPTEN_KEEPALIVE int nfc_obj_read_blob(int id, int which, uint8_t *dst, int off, int len)
{
    if (!dst || off < 0 || len < 0) return -2;
    if (!nfc_lock_page()) return -9;
    nfc_obj_t *o = obj_of(id);
    int n = -1;
    if (o) {
        const uint8_t *src = NULL; int avail = 0;
        switch (which) {
        case 0: src = o->mem; avail = o->mem_len; break;
        case 1: src = o->uid; avail = o->uid_len; break;
        case 2: src = o->seen_uid; avail = o->seen_uid_len; break;
        case 3: src = o->seen_valid; avail = (int)sizeof o->seen_valid; break;
        default: break;
        }
        if (src) {
            n = off >= avail ? 0 : (len < avail - off ? len : avail - off);
            if (n) memcpy(dst, src + off, (size_t)n);
        }
    }
    nfc_unlock();
    return n;
}

/* A reader object READs four pages from the card the device emulates. 0 ok; -1 not a reader or not near;
 * -2 the device is not emulating / not selected (nothing answers); -3 page out of range. */
EMSCRIPTEN_KEEPALIVE int nfc_reader_read(int id, int block)
{
    if (!nfc_lock_page()) return -9;
    nfc_obj_t *o = obj_of(id);
    int rc = -1;
    if (o && o->kind == NFC_KIND_READER && o->near_) rc = nfc_drv_reader_read_locked(id - 1, block);
    nfc_unlock();
    return rc;
}

/* 16 words, see nfc_drv.c: nfc_drv_state_locked. */
EMSCRIPTEN_KEEPALIVE int nfc_state(uint32_t *out)
{
    if (!out) return -2;
    if (!nfc_lock_page()) return -9;
    nfc_drv_state_locked(out);
    nfc_unlock();
    return 0;
}

/* Pop the oldest event: 4 words (type, id, a, b). 1 when one was written, 0 when the ring is empty. */
EMSCRIPTEN_KEEPALIVE int nfc_event_pop(uint32_t *out)
{
    if (!out) return -2;
    if (!nfc_lock_page()) return -9;
    int rc = 0;
    if (g_ev_tail != g_ev_head) {
        memcpy(out, g_ev[g_ev_tail % EV_RING], 16);
        g_ev_tail++;
        rc = 1;
    }
    nfc_unlock();
    return rc;
}

EMSCRIPTEN_KEEPALIVE uint32_t nfc_event_lost(void) { return g_ev_lost; }

/* The Antenna PCB is fitted (1, the default) or not (0). Read by kdrv_st25r3916_init() at boot, so it
 * takes effect at the next boot; it is kept across restarts like the rest of the store. */
EMSCRIPTEN_KEEPALIVE int nfc_chip_fitted(int fitted)
{
    if (!nfc_lock_page()) return -9;
    nfc_store()->chip_absent = fitted ? 0u : 1u;
    nfc_unlock();
    return 0;
}

/* Remove every object and clear the chip setting. */
EMSCRIPTEN_KEEPALIVE int nfc_reset_bench(void)
{
    if (!nfc_lock_page()) return -9;
    for (uint32_t i = 0; i < NFC_SLOTS; i++) {
        if (g_store.obj[i].used && g_store.obj[i].near_) nfc_drv_object_near_locked((int)i, false);
    }
    memset(&g_store, 0, sizeof g_store);
    g_store.magic = STORE_MAGIC;
    nfc_unlock();
    return 0;
}

/* Test hook (tests/node/nfc/page_lock.test.mjs): a thread takes the lock and exits holding it, as a terminated worker leaves it. */
#include <pthread.h>
static void *orphan_main(void *a) { (void)a; nfc_lock(); return NULL; }
EMSCRIPTEN_KEEPALIVE void nfc_test_orphan_lock(void)
{
    pthread_t th; pthread_create(&th, NULL, orphan_main, NULL); pthread_join(th, NULL);
}
