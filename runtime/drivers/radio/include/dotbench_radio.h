/* SPDX-License-Identifier: GPL-3.0-or-later
 * The radio core's host bridge: how firmware-side shims (esp_hosted, esp_wifi, esp_http_client, mqtt_client, ...,
 * and the BLE / IR areas that come after) talk to the JS world of the glue (radio.js), and back.
 *
 *   firmware thread --dbh_call("op.name", in, out)--> slot + doorbell --> JS handler (async allowed) --> DONE
 *   JS world --event ring "event.name" + bytes--> radio platform thread --> dbh_on_event handler
 *
 * Rules (docs/DRIVER-AREA-GUIDE.md section 7): dbh_call blocks the calling firmware thread on a futex, never the page;
 * the page only writes shared memory and notifies. Nothing here busy-waits. With no glue attached dbh_call fails at
 * once with DBH_ERR_NOHOST ("radio absent"). */
#ifndef DOTBENCH_RADIO_H
#define DOTBENCH_RADIO_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

#define DBH_ERR_NOHOST   (-1000)  /* no glue attached: the radio world does not exist             */
#define DBH_ERR_TIMEOUT  (-1001)  /* the world did not complete the call in time (abandoned)      */
#define DBH_ERR_BUSY     (-1002)  /* all call slots in use                                         */
#define DBH_ERR_NOOP     (-1003)  /* the world has no handler for that op name                     */
#define DBH_OUT_MAX      20480    /* largest reply of one call                                     */
#define DBH_IN_MAX       (1u << 20)

/**
 * One blocking request to the JS world. `op` names a handler registered in the glue (w.ops.set(op, fn)).
 * @return the handler's rc (>= 0 means the handler ran; its meaning is the op's), or a DBH_ERR_*.
 * `out` receives at most out_cap bytes; *out_len is what the handler returned (may be NULL).
 * Never call from the page's thread. May block up to timeout_ms.
 */
int dbh_call(const char *op, const void *in, size_t in_len, void *out, size_t out_cap, size_t *out_len,
             uint32_t timeout_ms);

/** true once the glue has attached (the page asked for a radio world). */
bool dbh_host_attached(void);

/** Handler of a JS event; runs on the radio platform thread, serialised with esp_event handlers. data valid for the call. */
typedef void (*dbh_event_fn)(const uint8_t *data, size_t len, void *ctx);
/** Register a handler for `name` (<= 31 chars; one handler per name). Idempotent for the same fn. Starts the thread. */
bool dbh_on_event(const char *name, dbh_event_fn fn, void *ctx);

/** Run fn(arg) on the platform thread (queued, never blocks; false when the queue is full). */
bool dbh_post(void (*fn)(void *), void *arg);
/** Start the platform thread if it is not running (idempotent). */
void dbh_start(void);

/* ---- tiny binary writer/reader for op payloads (little endian) ---- */
typedef struct { uint8_t *p; size_t cap, len; bool over; } dbh_w_t;
static inline void dbh_w_init(dbh_w_t *w, void *buf, size_t cap) { w->p = (uint8_t *)buf; w->cap = cap; w->len = 0; w->over = false; }
static inline void dbh_w_bytes(dbh_w_t *w, const void *b, size_t n)
{ if (w->len + n > w->cap) { w->over = true; return; } for (size_t i = 0; i < n; i++) w->p[w->len + i] = ((const uint8_t *)b)[i]; w->len += n; }
static inline void dbh_w_u8(dbh_w_t *w, uint8_t v) { dbh_w_bytes(w, &v, 1); }
static inline void dbh_w_u16(dbh_w_t *w, uint16_t v) { uint8_t b[2] = { (uint8_t)v, (uint8_t)(v >> 8) }; dbh_w_bytes(w, b, 2); }
static inline void dbh_w_u32(dbh_w_t *w, uint32_t v)
{ uint8_t b[4] = { (uint8_t)v, (uint8_t)(v >> 8), (uint8_t)(v >> 16), (uint8_t)(v >> 24) }; dbh_w_bytes(w, b, 4); }
/** length-prefixed (u16) bytes */
static inline void dbh_w_lp(dbh_w_t *w, const void *b, size_t n) { dbh_w_u16(w, (uint16_t)n); dbh_w_bytes(w, b, n); }
static inline void dbh_w_str(dbh_w_t *w, const char *s) { size_t n = 0; while (s && s[n]) n++; dbh_w_lp(w, s, n); }

typedef struct { const uint8_t *p; size_t len, pos; bool bad; } dbh_r_t;
static inline void dbh_r_init(dbh_r_t *r, const void *buf, size_t len) { r->p = (const uint8_t *)buf; r->len = len; r->pos = 0; r->bad = false; }
static inline uint32_t dbh_r_u(dbh_r_t *r, int n)
{ uint32_t v = 0; if (r->pos + (size_t)n > r->len) { r->bad = true; return 0; } for (int i = 0; i < n; i++) v |= (uint32_t)r->p[r->pos + (size_t)i] << (8 * i); r->pos += (size_t)n; return v; }
static inline uint8_t dbh_r_u8(dbh_r_t *r) { return (uint8_t)dbh_r_u(r, 1); }
static inline uint16_t dbh_r_u16(dbh_r_t *r) { return (uint16_t)dbh_r_u(r, 2); }
static inline uint32_t dbh_r_u32(dbh_r_t *r) { return dbh_r_u(r, 4); }
/** length-prefixed bytes: returns pointer into the buffer (valid as long as the buffer) and the length */
static inline const uint8_t *dbh_r_lp(dbh_r_t *r, size_t *n)
{ size_t l = dbh_r_u16(r); if (r->pos + l > r->len) { r->bad = true; *n = 0; return r->p; } const uint8_t *s = r->p + r->pos; r->pos += l; *n = l; return s; }

#ifdef __cplusplus
}
#endif
#endif
