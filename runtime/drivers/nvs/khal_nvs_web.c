/* SPDX-License-Identifier: GPL-3.0-or-later
 * khal_nvs over one flat arena (a persist region named "nvs", so it survives a restart and
 * the host can mirror it to IndexedDB). Records are appended:
 *   [ns 16][key 16][len u32][live u32][data, padded to 4]
 * An overwrite of equal length is in place, anything else kills the old record and appends;
 * a full arena is compacted once. Replaces components/khal/nvs/src/khal_nvs_esp.c. */
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "khal_nvs.h"
#include "kweb_bridge.h"

#define ARENA_BYTES (128u * 1024u)
#define MAGIC 0x4E565331u   /* "NVS1" */
typedef struct { uint32_t magic, used; uint8_t data[ARENA_BYTES - 8]; } arena_t;
typedef struct { char ns[16], key[16]; uint32_t len, live; } rec_t;   /* data follows */

static arena_t g_arena __attribute__((aligned(8)));
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
__attribute__((constructor(110))) static void nvs_register(void) { kweb_persist_register("nvs", &g_arena, sizeof g_arena); }

static void ensure(void)
{
    if (g_arena.magic != MAGIC) { memset(&g_arena, 0, sizeof g_arena); g_arena.magic = MAGIC; }
}
static uint32_t rec_size(const rec_t *r) { return (uint32_t)sizeof(rec_t) + ((r->len + 3u) & ~3u); }
static rec_t *next_rec(rec_t *r)
{
    uint8_t *n = (uint8_t *)r + rec_size(r);
    return (n < g_arena.data + g_arena.used) ? (rec_t *)(void *)n : NULL;
}
static rec_t *first_rec(void) { return g_arena.used ? (rec_t *)(void *)g_arena.data : NULL; }
static uint8_t *rec_data(rec_t *r) { return (uint8_t *)r + sizeof(rec_t); }
static bool name_ok(const char *s) { return s && *s && strlen(s) <= 15; }

static rec_t *find(const char *ns, const char *key)
{
    for (rec_t *r = first_rec(); r; r = next_rec(r))
        if (r->live && !strcmp(r->ns, ns) && !strcmp(r->key, key)) return r;
    return NULL;
}
static void compact(void)
{
    uint8_t *tmp = malloc(g_arena.used ? g_arena.used : 1);
    if (!tmp) return;
    uint32_t w = 0;
    for (rec_t *r = first_rec(); r; r = next_rec(r)) {
        if (!r->live) continue;
        memcpy(tmp + w, r, rec_size(r));
        w += rec_size(r);
    }
    memcpy(g_arena.data, tmp, w);
    memset(g_arena.data + w, 0, g_arena.used - w);
    g_arena.used = w;
    free(tmp);
}
static kode_status_t put(const char *ns, const char *key, const void *v, size_t len)
{
    if (!name_ok(ns) || !name_ok(key) || (!v && len)) return KODE_ERROR;
    pthread_mutex_lock(&g_mu);
    ensure();
    rec_t *e = find(ns, key);
    if (e && e->len == len) { if (len) memcpy(rec_data(e), v, len); pthread_mutex_unlock(&g_mu); return KODE_OK; }
    if (e) e->live = 0;
    uint32_t need = (uint32_t)sizeof(rec_t) + (((uint32_t)len + 3u) & ~3u);
    if (g_arena.used + need > sizeof g_arena.data) compact();
    if (g_arena.used + need > sizeof g_arena.data) { pthread_mutex_unlock(&g_mu); return KODE_ERROR; }
    rec_t *r = (rec_t *)(void *)(g_arena.data + g_arena.used);
    memset(r, 0, need);
    strcpy(r->ns, ns); strcpy(r->key, key);
    r->len = (uint32_t)len; r->live = 1;
    if (len) memcpy(rec_data(r), v, len);
    g_arena.used += need;
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}
kode_status_t khal_nvs_init(void) { pthread_mutex_lock(&g_mu); ensure(); pthread_mutex_unlock(&g_mu); return KODE_OK; }

static kode_status_t get_exact(const char *ns, const char *key, void *out, size_t n)
{
    if (!out || !name_ok(ns) || !name_ok(key)) return KODE_ERROR;
    pthread_mutex_lock(&g_mu); ensure();
    rec_t *e = find(ns, key);
    kode_status_t st = KODE_DENIED;
    if (e) { if (e->len == n) { memcpy(out, rec_data(e), n); st = KODE_OK; } else st = KODE_ERROR; }
    pthread_mutex_unlock(&g_mu);
    return st;
}
kode_status_t khal_nvs_get_str(const char *ns, const char *key, char *out, size_t cap)
{
    if (!out || !cap || !name_ok(ns) || !name_ok(key)) return KODE_ERROR;
    pthread_mutex_lock(&g_mu); ensure();
    rec_t *e = find(ns, key);
    kode_status_t st = KODE_DENIED;
    if (e) { if (e->len > cap) st = KODE_ERROR; else { memcpy(out, rec_data(e), e->len); st = KODE_OK; } }
    pthread_mutex_unlock(&g_mu);
    return st;
}
kode_status_t khal_nvs_set_str(const char *ns, const char *key, const char *v) { return v ? put(ns, key, v, strlen(v) + 1) : KODE_ERROR; }
kode_status_t khal_nvs_get_u8(const char *ns, const char *key, uint8_t *out) { return get_exact(ns, key, out, 1); }
kode_status_t khal_nvs_set_u8(const char *ns, const char *key, uint8_t v) { return put(ns, key, &v, 1); }
kode_status_t khal_nvs_get_u64(const char *ns, const char *key, uint64_t *out) { return get_exact(ns, key, out, 8); }
kode_status_t khal_nvs_set_u64(const char *ns, const char *key, uint64_t v) { return put(ns, key, &v, 8); }
kode_status_t khal_nvs_get_blob(const char *ns, const char *key, void *out, size_t *len)
{
    if (!len || !out) return KODE_ERROR;
    pthread_mutex_lock(&g_mu); ensure();
    rec_t *e = find(ns, key);
    kode_status_t st = KODE_DENIED;
    if (e) { if (e->len > *len) st = KODE_ERROR; else { memcpy(out, rec_data(e), e->len); *len = e->len; st = KODE_OK; } }
    pthread_mutex_unlock(&g_mu);
    return st;
}
kode_status_t khal_nvs_set_blob(const char *ns, const char *key, const void *v, size_t len) { return put(ns, key, v, len); }
kode_status_t khal_nvs_erase(const char *ns, const char *key)
{
    if (!name_ok(ns) || !name_ok(key)) return KODE_ERROR;
    pthread_mutex_lock(&g_mu); ensure();
    rec_t *e = find(ns, key);
    if (e) e->live = 0;
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}
static kode_status_t name_out(const char *s, char *out, size_t cap)
{
    if (!out || !cap || strlen(s) + 1 > cap) return KODE_ERROR;
    strcpy(out, s);
    return KODE_OK;
}
kode_status_t khal_nvs_key(const char *ns, uint16_t idx, char *out, size_t cap)
{
    if (!name_ok(ns)) return KODE_ERROR;
    kode_status_t st = KODE_DENIED;
    pthread_mutex_lock(&g_mu); ensure();
    uint16_t i = 0;
    for (rec_t *r = first_rec(); r; r = next_rec(r)) {
        if (!r->live || strcmp(r->ns, ns)) continue;
        if (i++ == idx) { st = name_out(r->key, out, cap); break; }
    }
    pthread_mutex_unlock(&g_mu);
    return st;
}
kode_status_t khal_nvs_namespace(uint16_t idx, char *out, size_t cap)
{
    kode_status_t st = KODE_DENIED;
    pthread_mutex_lock(&g_mu); ensure();
    uint16_t i = 0;
    for (rec_t *r = first_rec(); r; r = next_rec(r)) {
        if (!r->live) continue;
        bool seen = false;
        for (rec_t *p = first_rec(); p != r; p = next_rec(p))
            if (p->live && !strcmp(p->ns, r->ns)) { seen = true; break; }
        if (seen) continue;
        if (i++ == idx) { st = name_out(r->ns, out, cap); break; }
    }
    pthread_mutex_unlock(&g_mu);
    return st;
}
kode_status_t khal_nvs_erase_namespace(const char *ns)
{
    if (!ns) return KODE_ERROR;
    pthread_mutex_lock(&g_mu); ensure();
    for (rec_t *r = first_rec(); r; r = next_rec(r)) if (r->live && !strcmp(r->ns, ns)) r->live = 0;
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}
