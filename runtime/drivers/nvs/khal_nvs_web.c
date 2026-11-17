/* SPDX-License-Identifier: GPL-3.0-or-later
 * khal_nvs on a persistent region ("nvs", 64 KiB: the size of the `nvs` partition in
 * components/kbsp/partitions.csv). Replaces components/khal/nvs/src/khal_nvs_esp.c; the contract of
 * components/khal/nvs/include/khal_nvs.h is kept (namespaces and keys <= 15 chars, u8/u64/string/blob types
 * with type-mismatch errors, strings <= 4000 bytes with the NUL, KODE_DENIED = "nothing stored", every setter
 * is its own commit, listing of keys and namespaces, erase of keys and namespaces, errors when the store is full).
 *
 * Layout: a log of CRC-protected records over 16 pages of 4 KiB, like NVS itself (one page is kept free so
 * the oldest page can be compacted into it). A record is valid only when its CRC matches, so a write that is
 * cut anywhere (see dbp_cut_after) is either complete or invisible; the previous value stays. The newest
 * serial wins; erase writes a tombstone. A blob is written as chunk records plus one index record that is
 * written last: the index is the commit. Nothing is cached in RAM except a mutex and the serial counter, so
 * the region IS the store: the host can snapshot it at any time and a page-side editor (nvs.js) can use the
 * same entry points the firmware does.
 *
 *   page   : u32 magic "NVP1", u32 seq, u32 ~seq, u32 reserved   then records
 *   record : u16 magic 0x4B52, u8 type, u8 nslen, u8 keylen, u8 flags, u16 datalen, u32 serial, u32 aux, u32 crc,
 *            ns, key, data, padded to 4
 */
#include "page_lock.h"
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
#include <emscripten/threading.h>
#include "dotbench_persist.h"
#include "khal_nvs.h"

#define NVS_BYTES    0x10000u
#define PAGE         4096u
#define NPAGES       (NVS_BYTES / PAGE)
#define PAGE_MAGIC   0x3150564Eu      /* "NVP1" */
#define REC_MAGIC    0x4B52u
#define PAGE_HDR     16u
#define REC_HDR      20u
#define NAME_MAX_CH  15u
#define STR_MAX      4000u            /* with the NUL: ESP-IDF's limit */
#define BLOB_CHUNK   3968u

enum { T_U8 = 1, T_U64 = 2, T_STR = 3, T_BLOB_IDX = 4, T_BLOB_CHUNK = 5, T_TOMB_KEY = 0x7E, T_TOMB_NS = 0x7F };

static uint8_t g_nvs[NVS_BYTES] __attribute__((aligned(64)));
static dbp_region_t *g_r;
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
DB_PAGE_REGISTER(nvs, "nvs", g_mu, DB_LOCK_MUTEX)
static bool g_ready;
static uint32_t g_serial;            /* highest serial seen/used */

__attribute__((constructor(110))) static void nvs_register(void) { g_r = dbp_register("nvs", g_nvs, sizeof g_nvs, 0); }

/* ---- crc32 (IEEE) ---- */
static uint32_t crc32(uint32_t c, const void *p, size_t n)
{
    static uint32_t tab[256]; static bool init;
    if (!init) { for (uint32_t i = 0; i < 256; i++) { uint32_t x = i; for (int k = 0; k < 8; k++) x = (x & 1) ? 0xEDB88320u ^ (x >> 1) : x >> 1; tab[i] = x; } init = true; }
    const uint8_t *b = p; c = ~c;
    while (n--) c = tab[(c ^ *b++) & 0xFF] ^ (c >> 8);
    return ~c;
}

typedef struct { uint16_t magic; uint8_t type, nslen, keylen, flags; uint16_t datalen; uint32_t serial, aux, crc; } rec_hdr_t;
_Static_assert(sizeof(rec_hdr_t) == REC_HDR, "record header");
typedef struct { uint32_t magic, seq, nseq, rsv; } page_hdr_t;

static uint8_t *page_ptr(uint32_t p) { return g_nvs + (size_t)p * PAGE; }
static bool page_valid(uint32_t p, uint32_t *seq)
{
    page_hdr_t h; memcpy(&h, page_ptr(p), sizeof h);
    if (h.magic != PAGE_MAGIC || h.nseq != ~h.seq) return false;
    if (seq) *seq = h.seq;
    return true;
}
static uint32_t rec_total(const rec_hdr_t *h) { return (REC_HDR + h->nslen + h->keylen + h->datalen + 3u) & ~3u; }

/* A record at `off` of page p, or false when the page data ends here (erased, torn or garbage). */
static bool rec_at(uint32_t p, uint32_t off, rec_hdr_t *h, const char **ns, const char **key, const uint8_t **data)
{
    if (off + REC_HDR > PAGE) return false;
    const uint8_t *b = page_ptr(p) + off;
    memcpy(h, b, REC_HDR);
    if (h->magic != REC_MAGIC) return false;
    uint32_t tot = rec_total(h);
    if (off + tot > PAGE || h->nslen == 0 || h->nslen > NAME_MAX_CH || h->keylen > NAME_MAX_CH) return false;
    uint32_t want = h->crc;
    rec_hdr_t z = *h; z.crc = 0;
    uint32_t c = crc32(0, &z, REC_HDR);
    c = crc32(c, b + REC_HDR, h->nslen + h->keylen + h->datalen);
    if (c != want) return false;
    *ns = (const char *)b + REC_HDR; *key = *ns + h->nslen; *data = (const uint8_t *)*key + h->keylen;
    return true;
}

/* Iterate every valid record of every valid page, in page-sequence then offset order. */
typedef struct { uint32_t p, off; } cur_t;
static int pages_sorted(uint32_t *order)   /* valid pages, oldest first; returns count */
{
    uint32_t seqs[NPAGES]; int n = 0;
    for (uint32_t p = 0; p < NPAGES; p++) {
        uint32_t s; if (!page_valid(p, &s)) continue;
        int i = n++; while (i > 0 && seqs[i - 1] > s) { seqs[i] = seqs[i - 1]; order[i] = order[i - 1]; i--; }
        seqs[i] = s; order[i] = p;
    }
    return n;
}
#define FOR_EACH_REC(P, OFF, H, NS, KEY, DATA) \
    uint32_t _ord[NPAGES]; int _n = pages_sorted(_ord); \
    for (int _i = 0; _i < _n; _i++) for (uint32_t P = _ord[_i], OFF = PAGE_HDR; ; ) { \
        rec_hdr_t H; const char *NS, *KEY; const uint8_t *DATA; \
        if (!rec_at(P, OFF, &H, &NS, &KEY, &DATA)) break; \
        uint32_t _next = OFF + rec_total(&H); (void)_next;

#define END_EACH(OFF) OFF = _next; } /* end of for-P, one page */

static uint32_t page_tail(uint32_t p)   /* offset of the first free byte of a valid page */
{
    uint32_t off = PAGE_HDR; rec_hdr_t h; const char *ns, *key; const uint8_t *d;
    while (rec_at(p, off, &h, &ns, &key, &d)) off += rec_total(&h);
    return off;
}

/* ---- append machinery ---- */
static int newest_page(void)
{
    uint32_t ord[NPAGES]; int n = pages_sorted(ord);
    return n ? (int)ord[n - 1] : -1;
}
static int free_pages(void) { int f = 0; for (uint32_t p = 0; p < NPAGES; p++) if (!page_valid(p, NULL)) f++; return f; }
static int open_page(void)   /* wipe a free page and give it the next sequence; -1 if none */
{
    uint32_t ord[NPAGES]; int n = pages_sorted(ord); uint32_t seq = 1;
    if (n) { uint32_t s; page_valid(ord[n - 1], &s); seq = s + 1; }
    for (uint32_t p = 0; p < NPAGES; p++) {
        if (page_valid(p, NULL)) continue;
        dbp_fill(g_r, p * PAGE, 0xFF, PAGE);
        page_hdr_t h = { PAGE_MAGIC, seq, ~seq, 0xFFFFFFFFu };
        dbp_write(g_r, p * PAGE, &h, sizeof h);
        return (int)p;
    }
    return -1;
}
static void wipe_page(uint32_t p) { dbp_fill(g_r, p * PAGE, 0xFF, PAGE); }

static bool write_rec(uint32_t p, uint32_t off, uint8_t type, const char *ns, const char *key, const void *data, uint32_t dlen, uint32_t serial, uint32_t aux)
{
    rec_hdr_t h = { REC_MAGIC, type, (uint8_t)strlen(ns), (uint8_t)strlen(key), 0, (uint16_t)dlen, serial, aux, 0 };
    uint32_t tot = rec_total(&h);
    uint8_t buf[PAGE]; memset(buf, 0, tot);
    memcpy(buf, &h, REC_HDR); memcpy(buf + REC_HDR, ns, h.nslen); memcpy(buf + REC_HDR + h.nslen, key, h.keylen);
    if (dlen) memcpy(buf + REC_HDR + h.nslen + h.keylen, data, dlen);
    uint32_t c = crc32(0, buf, REC_HDR);                       /* crc field is zero here */
    c = crc32(c, buf + REC_HDR, h.nslen + h.keylen + dlen);
    memcpy(buf + offsetof(rec_hdr_t, crc), &c, 4);
    dbp_write(g_r, p * PAGE + off, buf, tot);
    return true;
}

static bool is_live(const rec_hdr_t *h, const char *ns, const char *key);
static bool compact_oldest(void)
{
    uint32_t ord[NPAGES]; int n = pages_sorted(ord);
    if (n < 2 || free_pages() < 1) return false;
    uint32_t oldest = ord[0];
    int dst = open_page(); if (dst < 0) return false;
    uint32_t doff = PAGE_HDR;
    uint32_t off = PAGE_HDR; rec_hdr_t h; const char *ns, *key; const uint8_t *d;
    while (rec_at(oldest, off, &h, &ns, &key, &d)) {
        uint32_t tot = rec_total(&h);
        if (h.type != T_TOMB_KEY && h.type != T_TOMB_NS && is_live(&h, ns, key)) {
            if (doff + tot > PAGE) return false;                 /* cannot happen: a page's live data fits a page */
            char nsb[16], keyb[16]; memcpy(nsb, ns, h.nslen); nsb[h.nslen] = 0; memcpy(keyb, key, h.keylen); keyb[h.keylen] = 0;
            write_rec((uint32_t)dst, doff, h.type, nsb, keyb, d, h.datalen, h.serial, h.aux);
            doff += tot;
        }
        off += tot;
    }
    wipe_page(oldest);
    return true;
}

/* Make room for `need` bytes in the newest page, opening or compacting as needed. Returns page or -1. */
static int reserve(uint32_t need)
{
    for (int guard = 0; guard < 2 * (int)NPAGES + 2; guard++) {
        int p = newest_page();
        if (p >= 0 && page_tail((uint32_t)p) + need <= PAGE) return p;
        if (free_pages() >= 2) { if (open_page() < 0) return -1; continue; }   /* the last free page is the compaction reserve */
        if (!compact_oldest()) return -1;
    }
    return -1;
}
static kode_status_t append(uint8_t type, const char *ns, const char *key, const void *data, uint32_t dlen, uint32_t serial, uint32_t aux)
{
    rec_hdr_t h = { 0, 0, (uint8_t)strlen(ns), (uint8_t)strlen(key), 0, (uint16_t)dlen, 0, 0, 0 };
    uint32_t tot = rec_total(&h);
    int p = reserve(tot);
    if (p < 0) return KODE_ERROR;
    write_rec((uint32_t)p, page_tail((uint32_t)p), type, ns, key, data, dlen, serial, aux);
    return KODE_OK;
}

/* ---- queries ---- */
typedef struct { bool found; uint8_t type; uint32_t serial, aux, dlen; uint32_t p, off; } ent_t;

/* The newest key-defining record of ns/key (a tombstone counts as "not found"), honouring namespace tombstones. */
static ent_t lookup(const char *ns, const char *key)
{
    ent_t best = { 0 }; uint32_t nstomb = 0;
    FOR_EACH_REC(p, off, h, rns, rkey, rdata)
        if (h.nslen == strlen(ns) && !memcmp(rns, ns, h.nslen)) {
            if (h.type == T_TOMB_NS) { if (h.serial > nstomb) nstomb = h.serial; }
            else if (h.type != T_BLOB_CHUNK && h.keylen == strlen(key) && !memcmp(rkey, key, h.keylen)) {
                if (!best.found || h.serial > best.serial) { best.found = true; best.type = h.type; best.serial = h.serial; best.aux = h.aux; best.dlen = h.datalen; best.p = p; best.off = off; }
            }
        }
        (void)rdata;
    END_EACH(off)
    if (best.found && (best.type == T_TOMB_KEY || best.serial < nstomb)) best.found = false;
    return best;
}
static bool is_live(const rec_hdr_t *h, const char *ns, const char *key)
{
    char nsb[16], keyb[16]; memcpy(nsb, ns, h->nslen); nsb[h->nslen] = 0; memcpy(keyb, key, h->keylen); keyb[h->keylen] = 0;
    ent_t e = lookup(nsb, keyb);
    if (!e.found) return false;
    if (h->type == T_BLOB_CHUNK) return e.type == T_BLOB_IDX && e.serial == h->serial && h->aux < e.aux;
    return e.serial == h->serial && e.type == h->type;
}

static void init_locked(void)
{
    if (g_ready) return;
    g_ready = true;
    uint32_t mx = 0; int any = 0;
    { FOR_EACH_REC(p, off, h, ns, key, d) if (h.serial > mx) mx = h.serial; any = 1; (void)d; (void)ns; (void)key; END_EACH(off) }
    g_serial = mx;
    /* Recovery. Ordinary writes never take the last free page (it is the compaction target), so no free page at all
     * means a compaction was cut after it opened its target and before it wiped the old page. The newest page is that
     * target and holds only copies of records the old page still has: drop it, and the next write compacts again. */
    if (newest_page() >= 0 && free_pages() == 0) wipe_page((uint32_t)newest_page());
    if (newest_page() < 0) { (void)any; for (uint32_t p = 0; p < NPAGES; p++) wipe_page(p); (void)open_page(); }
}

/* ---- validation helpers ---- */
static bool name_ok(const char *s) { return s && *s && strlen(s) <= NAME_MAX_CH; }

/* The store is shared by firmware tasks and by the page (dbnvs_*, which call the same khal_nvs_* code): on the page's thread the lock is a
 * bounded try, and a refused call answers an error plus the busy flag (the glue asks again), see page_lock.h. */
static bool nvs_enter(void)
{
    if (emscripten_is_main_browser_thread()) { if (!db_page_trylock(&g_mu, DB_PAGE_BUDGET_MS)) return false; }
    else pthread_mutex_lock(&g_mu);
    init_locked();
    return true;
}
#define LOCK_OR(busy_ret) do { if (!nvs_enter()) return busy_ret; } while (0)
#define UNLOCK() pthread_mutex_unlock(&g_mu)

/* Read a key-defining record's data into out (cap) and set *len. Statuses follow nvs_get_*: NOT_FOUND = DENIED, mismatch/length = ERROR. */
static kode_status_t get_typed(const char *ns, const char *key, uint8_t type, void *out, size_t cap, size_t *len_out, bool exact)
{
    LOCK_OR(KODE_ERROR);
    kode_status_t st = KODE_DENIED;
    ent_t e = lookup(ns, key);
    if (e.found) {
        if (e.type != type) st = KODE_ERROR;
        else if (type == T_BLOB_IDX) {
            uint32_t total; rec_hdr_t h; const char *rns, *rkey; const uint8_t *d;
            rec_at(e.p, e.off, &h, &rns, &rkey, &d); memcpy(&total, d, 4);
            if (len_out) { if (cap < total) { *len_out = total; st = KODE_ERROR; goto done; } }
            uint32_t got = 0;
            FOR_EACH_REC(p, off, ch, cns, ckey, cd)
                if (ch.type == T_BLOB_CHUNK && ch.serial == e.serial && ch.nslen == strlen(ns) && !memcmp(cns, ns, ch.nslen)
                    && ch.keylen == strlen(key) && !memcmp(ckey, key, ch.keylen) && ch.aux < e.aux) {
                    uint32_t o = ch.aux * BLOB_CHUNK;
                    if (o + ch.datalen <= total) { memcpy((uint8_t *)out + o, cd, ch.datalen); got += ch.datalen; }
                }
            END_EACH(off)
            if (got == total) { *len_out = total; st = KODE_OK; } else st = KODE_ERROR;
        } else {
            uint32_t n = e.dlen;
            if (exact && n != cap) st = KODE_ERROR;
            else if (!exact && n > cap) { if (len_out) *len_out = n; st = KODE_ERROR; }
            else {
                rec_hdr_t h; const char *rns, *rkey; const uint8_t *d;
                rec_at(e.p, e.off, &h, &rns, &rkey, &d); memcpy(out, d, n); if (len_out) *len_out = n; st = KODE_OK;
            }
        }
    }
done:
    UNLOCK();
    return st;
}

static kode_status_t put_small(const char *ns, const char *key, uint8_t type, const void *v, uint32_t len)
{
    LOCK_OR(KODE_ERROR);
    kode_status_t st = append(type, ns, key, v, len, ++g_serial, 0);
    UNLOCK();
    return st;
}

kode_status_t khal_nvs_init(void) { LOCK_OR(KODE_ERROR); UNLOCK(); return KODE_OK; }

kode_status_t khal_nvs_get_str(const char *ns, const char *key, char *out, size_t cap)
{
    if (!out || !cap) return KODE_ERROR;
    if (!name_ok(ns)) return KODE_DENIED;
    if (!name_ok(key)) return KODE_ERROR;
    size_t n = 0;
    return get_typed(ns, key, T_STR, out, cap, &n, false);
}
kode_status_t khal_nvs_set_str(const char *ns, const char *key, const char *value)
{
    if (!value || !name_ok(ns) || !name_ok(key)) return KODE_ERROR;
    size_t n = strlen(value) + 1;
    if (n > STR_MAX) return KODE_ERROR;
    return put_small(ns, key, T_STR, value, (uint32_t)n);
}
kode_status_t khal_nvs_get_u8(const char *ns, const char *key, uint8_t *out)
{
    if (!out) return KODE_ERROR;
    if (!name_ok(ns)) return KODE_DENIED;
    if (!name_ok(key)) return KODE_ERROR;
    return get_typed(ns, key, T_U8, out, 1, NULL, true);
}
kode_status_t khal_nvs_set_u8(const char *ns, const char *key, uint8_t value)
{
    if (!name_ok(ns) || !name_ok(key)) return KODE_ERROR;
    return put_small(ns, key, T_U8, &value, 1);
}
kode_status_t khal_nvs_get_u64(const char *ns, const char *key, uint64_t *out)
{
    if (!out) return KODE_ERROR;
    if (!name_ok(ns)) return KODE_DENIED;
    if (!name_ok(key)) return KODE_ERROR;
    return get_typed(ns, key, T_U64, out, 8, NULL, true);
}
kode_status_t khal_nvs_set_u64(const char *ns, const char *key, uint64_t value)
{
    if (!name_ok(ns) || !name_ok(key)) return KODE_ERROR;
    return put_small(ns, key, T_U64, &value, 8);
}
kode_status_t khal_nvs_get_blob(const char *ns, const char *key, void *out, size_t *len)
{
    if (!out || !len) return KODE_ERROR;
    if (!name_ok(ns)) return KODE_DENIED;
    if (!name_ok(key)) return KODE_ERROR;
    return get_typed(ns, key, T_BLOB_IDX, out, *len, len, false);
}
kode_status_t khal_nvs_set_blob(const char *ns, const char *key, const void *value, size_t len)
{
    if (!value || !len || !name_ok(ns) || !name_ok(key)) return KODE_ERROR;
    if (len > 0x7FFFFFu) return KODE_ERROR;
    LOCK_OR(KODE_ERROR);
    uint32_t ver = ++g_serial, nch = (uint32_t)((len + BLOB_CHUNK - 1) / BLOB_CHUNK);
    kode_status_t st = KODE_OK;
    for (uint32_t i = 0; i < nch && st == KODE_OK; i++) {
        uint32_t o = i * BLOB_CHUNK, n = (uint32_t)len - o; if (n > BLOB_CHUNK) n = BLOB_CHUNK;
        st = append(T_BLOB_CHUNK, ns, key, (const uint8_t *)value + o, n, ver, i);
    }
    if (st == KODE_OK) { uint32_t total = (uint32_t)len; st = append(T_BLOB_IDX, ns, key, &total, 4, ver, nch); }   /* the commit */
    UNLOCK();
    return st;
}
kode_status_t khal_nvs_erase(const char *ns, const char *key)
{
    if (!name_ok(ns) || !name_ok(key)) return KODE_OK;     /* nothing there: the postcondition holds */
    LOCK_OR(KODE_ERROR);
    kode_status_t st = KODE_OK;
    if (lookup(ns, key).found) st = append(T_TOMB_KEY, ns, key, NULL, 0, ++g_serial, 0);
    UNLOCK();
    return st;
}
kode_status_t khal_nvs_erase_namespace(const char *ns)
{
    if (!ns || !name_ok(ns)) return KODE_ERROR;
    LOCK_OR(KODE_ERROR);
    bool any = false;
    { FOR_EACH_REC(p, off, h, rns, rkey, rd) if (h.type != T_TOMB_NS && h.nslen == strlen(ns) && !memcmp(rns, ns, h.nslen)) any = true; (void)rkey; (void)rd; END_EACH(off) }
    kode_status_t st = KODE_OK;
    if (any) st = append(T_TOMB_NS, ns, "", NULL, 0, ++g_serial, 0);
    UNLOCK();
    return st;
}

/* Visit every live key (blob counted once) of one namespace, or of all (ns == NULL), in log order. cb returns false to stop. */
typedef bool (*visit_fn)(const char *ns, const char *key, uint8_t type, uint32_t size, void *ctx);
static void visit_live(const char *only_ns, visit_fn cb, void *ctx)
{
    FOR_EACH_REC(p, off, h, rns, rkey, rd)
        if (h.type != T_BLOB_CHUNK && h.type != T_TOMB_KEY && h.type != T_TOMB_NS) {
            char nsb[16], keyb[16]; memcpy(nsb, rns, h.nslen); nsb[h.nslen] = 0; memcpy(keyb, rkey, h.keylen); keyb[h.keylen] = 0;
            if ((!only_ns || !strcmp(only_ns, nsb)) && is_live(&h, rns, rkey)) {
                uint32_t sz = h.type == T_BLOB_IDX ? (uint32_t)(rd[0] | rd[1] << 8 | rd[2] << 16 | (uint32_t)rd[3] << 24) : h.datalen;
                if (!cb(nsb, keyb, h.type, sz, ctx)) return;
            }
        }
    END_EACH(off)
}
typedef struct { uint16_t idx, i; char *out; size_t cap; kode_status_t st; const char *skip_before_ns[1]; } nth_t;
static bool nth_key(const char *ns, const char *key, uint8_t t, uint32_t sz, void *c)
{
    (void)ns; (void)t; (void)sz; nth_t *n = c;
    if (n->i++ != n->idx) return true;
    if (strlen(key) + 1 > n->cap) n->st = KODE_ERROR; else { strcpy(n->out, key); n->st = KODE_OK; }
    return false;
}
kode_status_t khal_nvs_key(const char *ns, uint16_t idx, char *out, size_t cap)
{
    if (!out || !cap) return KODE_ERROR;
    if (!name_ok(ns)) return KODE_DENIED;
    LOCK_OR(KODE_ERROR);
    nth_t n = { idx, 0, out, cap, KODE_DENIED, { 0 } };
    visit_live(ns, nth_key, &n);
    UNLOCK();
    return n.st;
}
typedef struct { uint16_t idx, i; char *out; size_t cap; kode_status_t st; char seen[64][16]; int nseen; } nsl_t;
static bool nth_ns(const char *ns, const char *key, uint8_t t, uint32_t sz, void *c)
{
    (void)key; (void)t; (void)sz; nsl_t *n = c;
    for (int k = 0; k < n->nseen; k++) if (!strcmp(n->seen[k], ns)) return true;
    if (n->nseen < 64) strcpy(n->seen[n->nseen++], ns);
    if (n->i++ != n->idx) return true;
    if (strlen(ns) + 1 > n->cap) n->st = KODE_ERROR; else { strcpy(n->out, ns); n->st = KODE_OK; }
    return false;
}
kode_status_t khal_nvs_namespace(uint16_t idx, char *out, size_t cap)
{
    if (!out || !cap) return KODE_ERROR;
    LOCK_OR(KODE_ERROR);
    nsl_t *n = calloc(1, sizeof *n);
    if (!n) { UNLOCK(); return KODE_ERROR; }
    n->idx = idx; n->out = out; n->cap = cap; n->st = KODE_DENIED;
    visit_live(NULL, nth_ns, n);
    kode_status_t st = n->st; free(n);
    UNLOCK();
    return st;
}

/* ---- page-side entry points (runtime/drivers/nvs/nvs.js): the same code the firmware runs, under the same lock ---- */
typedef struct { char *buf; size_t cap, n; } dump_t;
static bool dump_cb(const char *ns, const char *key, uint8_t t, uint32_t sz, void *c)
{
    dump_t *d = c; char line[80];
    int k = snprintf(line, sizeof line, "%s\t%s\t%s\t%u\n", ns, key, t == T_U8 ? "u8" : t == T_U64 ? "u64" : t == T_STR ? "str" : "blob", (unsigned)sz);
    if (d->n + (size_t)k < d->cap) { memcpy(d->buf + d->n, line, (size_t)k); d->n += (size_t)k; }
    return true;
}
/* "ns\tkey\ttype\tsize\n" lines into out (NUL-terminated); returns bytes or -1 if it did not fit whole. */
EMSCRIPTEN_KEEPALIVE int dbnvs_list(char *out, uint32_t cap)
{
    LOCK_OR(-1);
    dump_t d = { out, cap ? cap - 1 : 0, 0 };
    visit_live(NULL, dump_cb, &d);
    if (cap) out[d.n] = 0;
    UNLOCK();
    return (int)d.n;
}
/* Value of a key as raw bytes (strings without the NUL; u8/u64 little endian). Returns length, -1 absent, -2 too small. */
EMSCRIPTEN_KEEPALIVE int dbnvs_get(const char *ns, const char *key, uint8_t *out, uint32_t cap)
{
    LOCK_OR(-1);
    ent_t e = lookup(ns, key);
    int r = -1;
    if (e.found) {
        if (e.type == T_BLOB_IDX) {
            UNLOCK();
            size_t len = cap;
            kode_status_t st = khal_nvs_get_blob(ns, key, out, &len);
            return st == KODE_OK ? (int)len : -2;
        }
        uint32_t n = e.dlen;
        rec_hdr_t h; const char *rns, *rkey; const uint8_t *d; rec_at(e.p, e.off, &h, &rns, &rkey, &d);
        if (e.type == T_STR && n) n--;
        if (n > cap) r = -2; else { memcpy(out, d, n); r = (int)n; }
    }
    UNLOCK();
    return r;
}
EMSCRIPTEN_KEEPALIVE int dbnvs_type(const char *ns, const char *key)
{
    LOCK_OR(-1); ent_t e = lookup(ns, key); UNLOCK();
    return !e.found ? 0 : e.type == T_U8 ? 1 : e.type == T_U64 ? 2 : e.type == T_STR ? 3 : 4;
}
EMSCRIPTEN_KEEPALIVE int dbnvs_set(const char *ns, const char *key, int type, const uint8_t *data, uint32_t len)
{
    kode_status_t st;
    switch (type) {
    case 1: { uint8_t v = len ? data[0] : 0; st = khal_nvs_set_u8(ns, key, v); break; }
    case 2: { uint64_t v = 0; memcpy(&v, data, len < 8 ? len : 8); st = khal_nvs_set_u64(ns, key, v); break; }
    case 3: { char *s = malloc(len + 1); if (!s) return -1; memcpy(s, data, len); s[len] = 0; st = khal_nvs_set_str(ns, key, s); free(s); break; }
    default: st = khal_nvs_set_blob(ns, key, data, len); break;
    }
    return st == KODE_OK ? 0 : -1;
}
EMSCRIPTEN_KEEPALIVE int dbnvs_erase(const char *ns, const char *key) { return khal_nvs_erase(ns, key) == KODE_OK ? 0 : -1; }
EMSCRIPTEN_KEEPALIVE int dbnvs_erase_ns(const char *ns) { return khal_nvs_erase_namespace(ns) == KODE_OK ? 0 : -1; }
/* Factory reset of the whole store. */
EMSCRIPTEN_KEEPALIVE int dbnvs_wipe(void)
{
    DB_PAGE_LOCK(&g_mu, -1);
    for (uint32_t p = 0; p < NPAGES; p++) wipe_page(p);
    g_ready = false; g_serial = 0;
    init_locked();
    UNLOCK();
    return 0;
}
/* Capacity, in bytes: live payload and total. */
EMSCRIPTEN_KEEPALIVE int dbnvs_usage(uint32_t *used_pages, uint32_t *total_pages)
{
    LOCK_OR(-1);
    if (used_pages) *used_pages = (uint32_t)(NPAGES - (uint32_t)free_pages());
    if (total_pages) *total_pages = NPAGES;
    UNLOCK();
    return 0;
}
