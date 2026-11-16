/* SPDX-License-Identifier: GPL-3.0-or-later
 * khal_nvs: an in-memory key/value store (namespaces of typed entries).
 * Replaces components/khal/nvs/src/khal_nvs_esp.c. Not persistent yet. */
#include <pthread.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include "khal_nvs.h"

typedef struct ent { char ns[16], key[16]; uint8_t *data; size_t len; struct ent *next, *prev; } ent_t;
static ent_t *g_head, *g_tail;
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;

static ent_t *find(const char *ns, const char *key)
{
    for (ent_t *e = g_head; e; e = e->next)
        if (!strcmp(e->ns, ns) && !strcmp(e->key, key)) return e;
    return NULL;
}
static bool name_ok(const char *s) { return s && *s && strlen(s) <= 15; }
static kode_status_t put(const char *ns, const char *key, const void *v, size_t len)
{
    if (!name_ok(ns) || !name_ok(key) || (!v && len)) return KODE_ERROR;
    pthread_mutex_lock(&g_mu);
    ent_t *e = find(ns, key);
    uint8_t *d = malloc(len ? len : 1);
    if (!d) { pthread_mutex_unlock(&g_mu); return KODE_ERROR; }
    if (len) memcpy(d, v, len);
    if (e) { free(e->data); }
    else {
        e = calloc(1, sizeof *e);
        if (!e) { free(d); pthread_mutex_unlock(&g_mu); return KODE_ERROR; }
        strcpy(e->ns, ns); strcpy(e->key, key);
        e->prev = g_tail;
        if (g_tail) g_tail->next = e; else g_head = e;
        g_tail = e;
    }
    e->data = d; e->len = len;
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}
static void unlink_ent(ent_t *e)
{
    if (e->prev) e->prev->next = e->next; else g_head = e->next;
    if (e->next) e->next->prev = e->prev; else g_tail = e->prev;
    free(e->data); free(e);
}
kode_status_t khal_nvs_init(void) { return KODE_OK; }

kode_status_t khal_nvs_get_str(const char *ns, const char *key, char *out, size_t cap)
{
    if (!out || !cap || !name_ok(ns) || !name_ok(key)) return KODE_ERROR;
    pthread_mutex_lock(&g_mu);
    ent_t *e = find(ns, key);
    kode_status_t st = KODE_DENIED;
    if (e) {
        if (e->len > cap) st = KODE_ERROR;
        else { memcpy(out, e->data, e->len); st = KODE_OK; }
    }
    pthread_mutex_unlock(&g_mu);
    return st;
}
kode_status_t khal_nvs_set_str(const char *ns, const char *key, const char *v)
{
    return v ? put(ns, key, v, strlen(v) + 1) : KODE_ERROR;
}
static kode_status_t get_fixed(const char *ns, const char *key, void *out, size_t n)
{
    if (!out) return KODE_ERROR;
    pthread_mutex_lock(&g_mu);
    ent_t *e = find(ns, key);
    kode_status_t st = KODE_DENIED;
    if (e) { if (e->len == n) { memcpy(out, e->data, n); st = KODE_OK; } else st = KODE_ERROR; }
    pthread_mutex_unlock(&g_mu);
    return st;
}
kode_status_t khal_nvs_get_u8(const char *ns, const char *key, uint8_t *out) { return get_fixed(ns, key, out, 1); }
kode_status_t khal_nvs_set_u8(const char *ns, const char *key, uint8_t v) { return put(ns, key, &v, 1); }
kode_status_t khal_nvs_get_u64(const char *ns, const char *key, uint64_t *out) { return get_fixed(ns, key, out, 8); }
kode_status_t khal_nvs_set_u64(const char *ns, const char *key, uint64_t v) { return put(ns, key, &v, 8); }
kode_status_t khal_nvs_get_blob(const char *ns, const char *key, void *out, size_t *len)
{
    if (!len || !out) return KODE_ERROR;
    pthread_mutex_lock(&g_mu);
    ent_t *e = find(ns, key);
    kode_status_t st = KODE_DENIED;
    if (e) {
        if (e->len > *len) st = KODE_ERROR;
        else { memcpy(out, e->data, e->len); *len = e->len; st = KODE_OK; }
    }
    pthread_mutex_unlock(&g_mu);
    return st;
}
kode_status_t khal_nvs_set_blob(const char *ns, const char *key, const void *v, size_t len) { return put(ns, key, v, len); }
kode_status_t khal_nvs_erase(const char *ns, const char *key)
{
    if (!name_ok(ns) || !name_ok(key)) return KODE_ERROR;
    pthread_mutex_lock(&g_mu);
    ent_t *e = find(ns, key);
    if (e) unlink_ent(e);
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
    pthread_mutex_lock(&g_mu);
    uint16_t i = 0;
    for (ent_t *e = g_head; e; e = e->next) {
        if (strcmp(e->ns, ns)) continue;
        if (i++ == idx) { st = name_out(e->key, out, cap); break; }
    }
    pthread_mutex_unlock(&g_mu);
    return st;
}
kode_status_t khal_nvs_namespace(uint16_t idx, char *out, size_t cap)
{
    kode_status_t st = KODE_DENIED;
    pthread_mutex_lock(&g_mu);
    uint16_t i = 0;
    for (ent_t *e = g_head; e; e = e->next) {
        bool seen = false;
        for (ent_t *p = g_head; p != e; p = p->next) if (!strcmp(p->ns, e->ns)) { seen = true; break; }
        if (seen) continue;
        if (i++ == idx) { st = name_out(e->ns, out, cap); break; }
    }
    pthread_mutex_unlock(&g_mu);
    return st;
}
kode_status_t khal_nvs_erase_namespace(const char *ns)
{
    if (!ns) return KODE_ERROR;
    pthread_mutex_lock(&g_mu);
    for (ent_t *e = g_head, *n; e; e = n) { n = e->next; if (!strcmp(e->ns, ns)) unlink_ent(e); }
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}
