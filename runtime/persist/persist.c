/* SPDX-License-Identifier: GPL-3.0-or-later
 * Persistent-region service (C side). See runtime/bridge/dotbench_persist.h.
 *
 * Regions are fixed buffers in wasm linear memory. Regions up to 1 MiB are also registered with the bridge's
 * kweb_persist_register(), so the older whole-region copy path keeps working for them. On top of that each region
 * has a dirty bitmap (one bit per 4 KiB chunk) and the service keeps a global generation counter, so the
 * host can notice "something changed" with one 32-bit load and then copy only the dirty chunks.
 *
 * Memory ordering: writers write the bytes first and set the bit afterwards (atomic OR); the host clears
 * a bit (atomic exchange of the word) first and copies the chunk afterwards. A write that lands between the
 * clear and the copy is either seen by the copy or sets the bit again: nothing is lost, a chunk may be
 * copied twice. A chunk copied while a writer is mid-memcpy is torn, but then the writer's bit-set follows
 * and the next flush fixes it (the same exposure as a power cut at that instant). */
#include <stdatomic.h>
#include <string.h>
#include "dotbench_persist.h"
#include "kweb_bridge.h"
#include <emscripten.h>

struct dbp_region {
    char      name[16];
    uint8_t  *buf;
    uint32_t  size, flags, nchunks;
    uint32_t *bits;           /* nchunks bits */
};

#define BIT_WORDS 2048u       /* 65536 chunks = 256 MiB of regions */
static struct dbp_region g_reg[DBP_MAX_REGIONS];
static uint32_t g_nreg;
static uint32_t g_bits[BIT_WORDS];
static uint32_t g_bits_used;
static _Atomic uint32_t g_gen;

/* power-cut injection */
static _Atomic int32_t  g_cut_armed;         /* 0/1 */
static _Atomic int64_t  g_cut_budget;
static _Atomic int32_t  g_cut_fired;

dbp_region_t *dbp_find(const char *name)
{
    for (uint32_t i = 0; i < g_nreg; i++) if (!strncmp(g_reg[i].name, name, 15)) return &g_reg[i];
    return NULL;
}

dbp_region_t *dbp_register(const char *name, void *buf, uint32_t size, uint32_t flags)
{
    dbp_region_t *r = dbp_find(name);
    if (r) return r;
    if (g_nreg >= DBP_MAX_REGIONS || !buf || (size & (DBP_CHUNK - 1u)) || ((uintptr_t)buf & 7u)) return NULL;
    uint32_t nch = size >> DBP_CHUNK_SHIFT, words = (nch + 31u) / 32u;
    if (g_bits_used + words > BIT_WORDS) return NULL;
    r = &g_reg[g_nreg++];
    memset(r, 0, sizeof *r);
    strncpy(r->name, name, 15);
    r->buf = buf; r->size = size; r->flags = flags; r->nchunks = nch;
    r->bits = &g_bits[g_bits_used]; g_bits_used += words;
    /* Small regions are also visible to the older whole-region copy path (kweb_persist_*: the Node harness's persist Map).
     * Big ones (flash-fs, sd-card: 34 MiB) are not: copying them whole at every restart is exactly what dirty tracking avoids. */
    if (size <= (1u << 20)) kweb_persist_register(r->name, buf, size);
    return r;
}

void *dbp_buf(const dbp_region_t *r) { return r ? r->buf : NULL; }
uint32_t dbp_size(const dbp_region_t *r) { return r ? r->size : 0; }

void dbp_dirty(dbp_region_t *r, uint32_t off, uint32_t len)
{
    if (!r || !len || off >= r->size) return;
    if (len > r->size - off) len = r->size - off;
    uint32_t a = off >> DBP_CHUNK_SHIFT, b = (off + len - 1u) >> DBP_CHUNK_SHIFT;
    for (uint32_t c = a; c <= b; c++)
        atomic_fetch_or_explicit((_Atomic uint32_t *)&r->bits[c >> 5], 1u << (c & 31u), memory_order_seq_cst);
    atomic_fetch_add_explicit(&g_gen, 1u, memory_order_seq_cst);
}

/* How many of `len` bytes a power cut lets through. */
static uint32_t cut_allow(uint32_t len)
{
    if (!atomic_load(&g_cut_armed)) return len;
    int64_t left = atomic_load(&g_cut_budget);
    for (;;) {
        if (left <= 0) { atomic_store(&g_cut_fired, 1); return 0; }
        int64_t take = left < (int64_t)len ? left : (int64_t)len;
        if (atomic_compare_exchange_weak(&g_cut_budget, &left, left - take)) {
            if (take < (int64_t)len) atomic_store(&g_cut_fired, 1);
            return (uint32_t)take;
        }
    }
}

void dbp_write(dbp_region_t *r, uint32_t off, const void *src, uint32_t len)
{
    if (!r || !src || off >= r->size) return;
    if (len > r->size - off) len = r->size - off;
    len = cut_allow(len);
    if (!len) return;
    memcpy(r->buf + off, src, len);
    dbp_dirty(r, off, len);
}

void dbp_fill(dbp_region_t *r, uint32_t off, int byte, uint32_t len)
{
    if (!r || off >= r->size) return;
    if (len > r->size - off) len = r->size - off;
    len = cut_allow(len);
    if (!len) return;
    memset(r->buf + off, byte, len);
    dbp_dirty(r, off, len);
}

EMSCRIPTEN_KEEPALIVE void dbp_cut_after(uint32_t bytes) { atomic_store(&g_cut_fired, 0); atomic_store(&g_cut_budget, (int64_t)bytes); atomic_store(&g_cut_armed, 1); }
EMSCRIPTEN_KEEPALIVE bool dbp_cut_fired(void) { return atomic_load(&g_cut_fired) != 0; }
EMSCRIPTEN_KEEPALIVE void dbp_cut_clear(void) { atomic_store(&g_cut_armed, 0); atomic_store(&g_cut_fired, 0); }

/* ---- device state (rtc offset, sd slot) ---- */
static uint8_t g_dev[DBP_CHUNK] __attribute__((aligned(64)));
static dbp_region_t *g_dev_r;
dbp_devstate_t *dbp_devstate(void)
{
    if (!g_dev_r) g_dev_r = dbp_register("dev-state", g_dev, sizeof g_dev, 0);
    if (!g_dev_r) return NULL;
    dbp_devstate_t *d = (dbp_devstate_t *)(void *)g_dev;
    if (d->magic != DBP_DEV_MAGIC) {              /* factory-fresh */
        memset(d, 0, sizeof *d);
        d->magic = DBP_DEV_MAGIC; d->version = 1;
        d->sd_inserted = 1; d->sd_capacity_mb = 8; d->sd_serial = 0x4B4F4445u; d->sd_generation = 1;
        dbp_dirty(g_dev_r, 0, sizeof *d);
    }
    return d;
}
void dbp_devstate_changed(void) { if (g_dev_r) dbp_dirty(g_dev_r, 0, sizeof(dbp_devstate_t)); }
__attribute__((constructor(111))) static void dev_ctor(void) { (void)dbp_devstate(); }

/* ---- exports for the host (index form; dbp_cut_* above are exported as they are) ---- */
EMSCRIPTEN_KEEPALIVE uint32_t dbpx_count(void) { return g_nreg; }
EMSCRIPTEN_KEEPALIVE const char *dbpx_name(uint32_t i) { return i < g_nreg ? g_reg[i].name : ""; }
EMSCRIPTEN_KEEPALIVE void *dbpx_ptr(uint32_t i) { return i < g_nreg ? g_reg[i].buf : 0; }
EMSCRIPTEN_KEEPALIVE uint32_t dbpx_size(uint32_t i) { return i < g_nreg ? g_reg[i].size : 0; }
EMSCRIPTEN_KEEPALIVE uint32_t dbpx_flags(uint32_t i) { return i < g_nreg ? g_reg[i].flags : 0; }
EMSCRIPTEN_KEEPALIVE uint32_t *dbpx_bits(uint32_t i) { return i < g_nreg ? g_reg[i].bits : 0; }
EMSCRIPTEN_KEEPALIVE uint32_t dbpx_gen(void) { return atomic_load(&g_gen); }
EMSCRIPTEN_KEEPALIVE int32_t dbpx_index_of(const void *ptr)
{
    for (uint32_t i = 0; i < g_nreg; i++) if ((const void *)g_reg[i].buf == ptr) return (int32_t)i;
    return -1;
}
