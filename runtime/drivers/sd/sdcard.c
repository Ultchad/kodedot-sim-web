/* SPDX-License-Identifier: GPL-3.0-or-later
 * The virtual microSD card's sectors: a sparse store with a nominal capacity of 2 MB .. 256 GB.
 *
 * Two layouts, chosen by the card's nominal capacity (devstate.sd_capacity_mb):
 *
 *  DENSE   capacity <= 32 MB. Sector s is at byte s*512 of region "sd-card" (32 MiB). This is the layout every card
 *          saved by earlier versions has, so those cards load unchanged (migration is "do nothing"). Nothing is
 *          stored for all-zero 4 KiB chunks: the host drops them and wasm pages nobody wrote stay uncommitted.
 *
 *  SPARSE  capacity > 32 MB. Region "sd-card" (and optionally "sd-pool2") is a POOL of 4 KiB slots. A two-level
 *          page table maps card chunk (4 KiB = 8 sectors) -> slot:
 *              directory  region "sd-map" (after a 4 KiB header): 32768 x u16, entry = leaf slot + 1, 0 = none
 *              leaf       one pool slot: 2048 x u16, entry = data slot + 1, 0 = none (covers 8 MiB of card)
 *          A chunk gets a slot the first time a non-zero sector is written into it (a write of zeros to an unmapped
 *          chunk does nothing, so formatting a 128 GB card stores no zeros); the slot is returned, and zeroed so the
 *          host stops storing it, when the chunk becomes all zero again. A leaf is freed when it empties. When no
 *          slot is left a write fails (the caller's sector write returns an error: FatFs EIO, the SDK's I/O error).
 *
 * Everything lives in persistent regions written through dbp_write, so the existing persistence service stores exactly
 * the chunks that hold data (pool slots in use + the touched part of the directory), with its dirty bits, debounce,
 * power-cut injection and device file. The free-slot bitmap is RAM only, rebuilt from the table at the first access.
 *
 * Threads. Firmware threads call in from anywhere (kdrv_sd raw sector API, FatFs): one mutex, held only for the
 * duration of a sector transfer, never across anything that waits. The page never takes it for long: its
 * entry points (sdc_stats, the new-card request) are atomic loads/stores. A new card requested by the page only
 * bumps an epoch in the map header; the firmware side wipes and re-sizes the map at its next access (and at the first
 * access after a reload, if the page asked and the device was stopped before anything ran). */
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <pthread.h>
#include <stdatomic.h>
#include <emscripten.h>
#include <emscripten/threading.h>
#include "dotbench_persist.h"
#include "dotbench_vfs.h"

#ifndef DBSD_EXTRA_MB
#define DBSD_EXTRA_MB 24u                        /* second pool region "sd-pool2" (sparse cards only). The wasm memory is a fixed 96 MB; measured
                                                    * firmware needs: kodeOS ends at 52.7 MB with ~44.5 MB of regions below it, the apps at 48..52 MB.
                                                    * 24 MB more leaves >= 19 MB for kodeOS (it uses 8 MB of malloc). 0 = none. */
#endif
#define CH         4096u
#define SPC        8u                            /* sectors per chunk */
#define POOL0_MB   32u                           /* region "sd-card": same size as before, so saved cards load */
#define N0         ((POOL0_MB << 20) / CH)
#define N1         ((DBSD_EXTRA_MB << 20) / CH)
#define NSLOTS     (N0 + N1)
#define LEAF_ENT   2048u
#define DIR_ENT    32768u
#define MAP_BYTES  (CH + DIR_ENT * 2u)
#define MAGIC      0x53444D31u                   /* "SDM1" */

typedef struct {
    uint32_t magic, version;
    uint32_t cap_mb;                             /* capacity the table was made for */
    uint32_t pad;
    _Atomic uint32_t req_epoch;                  /* page: +1 for every new card */
    _Atomic uint32_t applied_epoch;              /* firmware: the epoch the table matches */
} hdr_t;

static uint8_t *s_pool0, *s_pool1, *s_map;
static dbp_region_t *r_pool0, *r_pool1, *r_map;
static pthread_mutex_t s_lock = PTHREAD_MUTEX_INITIALIZER;

/* RAM state, rebuilt from the table */
static _Atomic int      s_valid;
static uint32_t         s_applied;               /* epoch applied in this run */
static uint32_t         s_cap_mb;                /* capacity the RAM state is for */
static uint8_t          s_used[(NSLOTS + 7) / 8];
static uint32_t         s_hint;
static _Atomic uint32_t s_nused;                 /* sparse: slots in use (data + leaves); dense: non-zero chunks */

static uint8_t *zalloc64(size_t n)
{
    void *p = sbrk((intptr_t)(n + 64));
    return (p == (void *)-1) ? NULL : (uint8_t *)(((uintptr_t)p + 63u) & ~(uintptr_t)63u);
}

__attribute__((constructor(120))) static void sdc_ctor(void)
{
    s_pool0 = zalloc64((size_t)POOL0_MB << 20);
    r_pool0 = dbp_register("sd-card", s_pool0, POOL0_MB << 20, 0);
    s_map = zalloc64(MAP_BYTES);
    r_map = dbp_register("sd-map", s_map, MAP_BYTES, 0);
#if DBSD_EXTRA_MB
    s_pool1 = zalloc64((size_t)DBSD_EXTRA_MB << 20);
    r_pool1 = dbp_register("sd-pool2", s_pool1, DBSD_EXTRA_MB << 20, 0);
#endif
}

#define H ((hdr_t *)(void *)s_map)
static uint16_t *dir(void) { return (uint16_t *)(void *)(s_map + CH); }

static uint32_t cap_mb(void)
{
    uint32_t mb = dbp_devstate()->sd_capacity_mb;
    return (mb < DBV_SD_MIN_MB) ? 8u : (mb > DBV_SD_MAX_MB ? DBV_SD_MAX_MB : mb);
}
static int dense_of(uint32_t mb) { return mb <= POOL0_MB; }

int      dbd_sd_present(void) { return dbp_devstate()->sd_inserted != 0; }
uint32_t dbd_sd_sectors(void) { return cap_mb() * 2048u; }

/* ---- helpers ---------------------------------------------------------------------------------------- */
static int is_zero(const void *p, uint32_t n)
{
    const uint8_t *b = p;
    if ((((uintptr_t)b | n) & 7u) == 0) {
        const uint64_t *w = (const uint64_t *)p;
        for (uint32_t i = 0; i < n / 8; i++) if (w[i]) return 0;
        return 1;
    }
    for (uint32_t i = 0; i < n; i++) if (b[i]) return 0;
    return 1;
}
static uint8_t *slot_ptr(uint32_t s) { return s < N0 ? s_pool0 + (size_t)s * CH : s_pool1 + (size_t)(s - N0) * CH; }
static void slot_put(uint32_t s, uint32_t off, const void *src, uint32_t len)
{
    if (s < N0) dbp_write(r_pool0, s * CH + off, src, len);
    else dbp_write(r_pool1, (s - N0) * CH + off, src, len);
}
static void slot_zero(uint32_t s)
{
    if (s < N0) dbp_fill(r_pool0, s * CH, 0, CH);
    else dbp_fill(r_pool1, (s - N0) * CH, 0, CH);
}
static int  used_get(uint32_t s) { return (s_used[s >> 3] >> (s & 7)) & 1; }
static void used_set(uint32_t s, int v) { if (v) s_used[s >> 3] |= (uint8_t)(1u << (s & 7)); else s_used[s >> 3] &= (uint8_t)~(1u << (s & 7)); }

static int alloc_slot(void)
{
    for (uint32_t i = 0; i < NSLOTS; i++) {
        uint32_t s = (s_hint + i) % NSLOTS;
        if (!used_get(s)) { used_set(s, 1); s_hint = s + 1; atomic_fetch_add(&s_nused, 1); return (int)s; }
    }
    return -1;
}
static void free_slot(uint32_t s) { if (used_get(s)) { used_set(s, 0); atomic_fetch_sub(&s_nused, 1); if (s < s_hint) s_hint = s; } }

/* ---- the table (SPARSE) ----------------------------------------------------------------------------- */
static uint32_t lookup(uint32_t ch)                  /* data slot + 1, or 0 */
{
    uint16_t ls = dir()[ch / LEAF_ENT];
    if (!ls || ls - 1u >= NSLOTS) return 0;
    uint32_t e = ((uint16_t *)(void *)slot_ptr(ls - 1u))[ch % LEAF_ENT];
    return e > NSLOTS ? 0 : e;
}
static void put16(uint32_t slot, uint32_t idx, uint16_t v) { slot_put(slot, idx * 2u, &v, 2); }

static void wipe(void)
{
    for (uint32_t s = 0; s < N0; s++) if (!is_zero(slot_ptr(s), CH)) slot_zero(s);
    for (uint32_t s = N0; s < NSLOTS; s++) if (!is_zero(slot_ptr(s), CH)) slot_zero(s);
    for (uint32_t o = CH; o < MAP_BYTES; o += CH) if (!is_zero(s_map + o, CH)) dbp_fill(r_map, o, 0, CH);
}

static void rebuild(uint32_t mb)
{
    memset(s_used, 0, sizeof s_used); s_hint = 0; atomic_store(&s_nused, 0);
    if (dense_of(mb)) {
        uint32_t n = 0, chunks = mb << 8;
        for (uint32_t c = 0; c < chunks; c++) if (!is_zero(s_pool0 + (size_t)c * CH, CH)) n++;
        atomic_store(&s_nused, n);
    } else {
        uint32_t nd = (((mb << 8) + LEAF_ENT - 1) / LEAF_ENT);
        for (uint32_t d = 0; d < nd && d < DIR_ENT; d++) {
            uint16_t ls = dir()[d];
            if (!ls) continue;
            if (ls - 1u >= NSLOTS || used_get(ls - 1u)) { dbp_write(r_map, CH + d * 2u, &(uint16_t){0}, 2); continue; }   /* damaged entry */
            used_set(ls - 1u, 1); atomic_fetch_add(&s_nused, 1);
            uint16_t *lf = (uint16_t *)(void *)slot_ptr(ls - 1u);
            for (uint32_t i = 0; i < LEAF_ENT; i++) {
                uint16_t e = lf[i];
                if (!e) continue;
                if (e > NSLOTS || used_get(e - 1u)) { put16(ls - 1u, i, 0); continue; }
                used_set(e - 1u, 1); atomic_fetch_add(&s_nused, 1);
            }
        }
    }
    s_cap_mb = mb;
}

/* Take the lock (the page thread only spins a bounded time) and bring the RAM state and the table up to date with
 * the card the page asked for. Returns 0 with the lock held, -1 without it. */
static int enter(void)
{
    if (emscripten_is_main_browser_thread()) {
        int ok = 0;
        for (int i = 0; i < 20000 && !ok; i++) ok = pthread_mutex_trylock(&s_lock) == 0;
        if (!ok) return -1;
    } else pthread_mutex_lock(&s_lock);
    if (!s_map || !s_pool0) { pthread_mutex_unlock(&s_lock); return -1; }
    uint32_t req = atomic_load(&H->req_epoch), mb = cap_mb();
    if (atomic_load(&s_valid) && s_applied == req && s_cap_mb == mb) return 0;
    for (;;) {
        req = atomic_load(&H->req_epoch); mb = cap_mb();
        hdr_t h = *H; h.req_epoch = req;
        int fresh = h.magic != MAGIC, need_wipe;
        if (fresh) need_wipe = !dense_of(mb);                  /* a card saved by an older build is dense and <= 32 MB: adopt it */
        else need_wipe = h.applied_epoch != req || h.cap_mb != mb;
        if (need_wipe) wipe();
        h.magic = MAGIC; h.version = 1; h.cap_mb = mb; h.applied_epoch = req;
        dbp_write(r_map, 0, &h, sizeof h);                     /* req_epoch is rewritten with the value this wipe answers */
        s_applied = req;
        if (atomic_load(&H->req_epoch) == req && cap_mb() == mb) break;
    }
    rebuild(mb);
    atomic_store(&s_valid, 1);
    return 0;
}
static void leave(void) { pthread_mutex_unlock(&s_lock); }

/* ---- sector transfers ------------------------------------------------------------------------------- */
int dbd_sd_read(uint32_t first, uint32_t count, void *dst)
{
    if (!dbd_sd_present() || (uint64_t)first + count > dbd_sd_sectors()) return -1;
    if (enter() != 0) return -1;
    int dense = dense_of(s_cap_mb);
    uint8_t *d = dst;
    for (uint32_t s = first; s < first + count; s++, d += 512) {
        uint32_t ch = s / SPC, off = (s % SPC) * 512u;
        if (dense) memcpy(d, s_pool0 + (size_t)s * 512u, 512);
        else { uint32_t e = lookup(ch); if (e) memcpy(d, slot_ptr(e - 1u) + off, 512); else memset(d, 0, 512); }
    }
    leave();
    return 0;
}

static int write_one_sparse(uint32_t s, const uint8_t *src)
{
    uint32_t ch = s / SPC, off = (s % SPC) * 512u, e = lookup(ch);
    int z = is_zero(src, 512);
    if (!e) {
        if (z) return 0;                                       /* zeros into a hole: nothing to store */
        uint32_t di = ch / LEAF_ENT;
        uint16_t ls = dir()[di];
        int newleaf = 0, l = -1;
        if (!ls) { l = alloc_slot(); if (l < 0) return -1; ls = (uint16_t)(l + 1); newleaf = 1; }
        int d = alloc_slot();
        if (d < 0) { if (newleaf) free_slot((uint32_t)l); return -1; }
        slot_put((uint32_t)d, off, src, 512);                  /* data first, then the entries that make it reachable */
        put16(ls - 1u, ch % LEAF_ENT, (uint16_t)(d + 1));
        if (newleaf) dbp_write(r_map, CH + di * 2u, &ls, 2);
        return 0;
    }
    slot_put(e - 1u, off, src, 512);
    if (z && is_zero(slot_ptr(e - 1u), CH)) {                  /* the chunk is all zero again: give the slot back */
        uint32_t di = ch / LEAF_ENT; uint16_t ls = dir()[di];
        put16(ls - 1u, ch % LEAF_ENT, 0);
        slot_zero(e - 1u); free_slot(e - 1u);
        if (is_zero(slot_ptr(ls - 1u), CH)) {                  /* leaf empty */
            uint16_t nil = 0;
            dbp_write(r_map, CH + di * 2u, &nil, 2); free_slot(ls - 1u);
        }
    }
    return 0;
}

int dbd_sd_write(uint32_t first, uint32_t count, const void *src)
{
    if ((uint64_t)first + count > dbd_sd_sectors() || dbp_devstate()->sd_write_protect) return -1;
    if (enter() != 0) return -1;
    int dense = dense_of(s_cap_mb), rc = 0;
    for (uint32_t i = 0; i < count && !rc; i++) {
        if (!dbd_sd_present()) { rc = -1; break; }              /* pulled mid-write: stop between sectors */
        const uint8_t *p = (const uint8_t *)src + (size_t)i * 512u;
        uint32_t s = first + i;
        if (dense) {
            uint8_t *c = s_pool0 + (size_t)(s / SPC) * CH;
            int was = !is_zero(c, CH);
            dbp_write(r_pool0, s * 512u, p, 512);
            int now = !is_zero(c, CH);
            if (now > was) atomic_fetch_add(&s_nused, 1); else if (was > now) atomic_fetch_sub(&s_nused, 1);
        } else rc = write_one_sparse(s, p);
    }
    leave();
    return rc;
}

/* ---- the page's side: no locks ------------------------------------------------------------------------ */
/* A new card was put in: the table is reset by the firmware side at its next access. */
void dbsd_card_changed(void)
{
    if (!s_map) return;
    atomic_fetch_add(&H->req_epoch, 1);
    dbp_dirty(r_map, 0, sizeof(hdr_t));
}

/* out[0..1] stored bytes (lo, hi), out[2..3] most real data this card can hold, out[4] 1 = sparse layout, 2 = dense,
 * out[5] 1 when the figures are known (the firmware has touched the card since the device started), out[6] pool bytes. */
void dbsd_stats(uint32_t *out)
{
    memset(out, 0, 8 * sizeof(uint32_t));
    uint32_t mb = cap_mb();
    uint64_t pool = ((uint64_t)NSLOTS) * CH, card = (uint64_t)mb << 20;
    int pending = s_map && (atomic_load(&H->req_epoch) != s_applied || !atomic_load(&s_valid));
    uint64_t stored = (uint64_t)atomic_load(&s_nused) * CH;
    if (s_map && atomic_load(&H->req_epoch) != s_applied && atomic_load(&s_valid)) stored = 0;   /* a new card, not wiped yet */
    uint64_t bound = dense_of(mb) ? card : (pool < card ? pool : card);
    out[0] = (uint32_t)stored; out[1] = (uint32_t)(stored >> 32);
    out[2] = (uint32_t)bound;  out[3] = (uint32_t)(bound >> 32);
    out[4] = dense_of(mb) ? 2 : 1;
    out[5] = (atomic_load(&s_valid) && !pending) ? 1u : 0u;
    out[6] = (uint32_t)pool;
}

/* From the page, right after a swap: make the firmware-side reset happen now instead of at the next card access, so the old card's
 * chunks leave the browser's storage at once. Bounded spin on the table lock (never blocks the page); -1 when it was busy: the reset
 * then happens at the next access, nothing is lost. */
EMSCRIPTEN_KEEPALIVE int dbsd_page_apply(void)
{
    if (enter() != 0) return -1;
    leave();
    return 0;
}
