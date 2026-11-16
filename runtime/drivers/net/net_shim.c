/* SPDX-License-Identifier: GPL-3.0-or-later
 * ESP-IDF's esp_http_client, esp-mqtt, ping, getaddrinfo/UDP sockets, SNTP and the certificate bundle, over the JS world (net.js).
 * The SDK's real kdrv_net.c runs on top. Every op is a dbh_call; nothing here busy-waits or blocks the page.
 * IPv4 addresses cross the bridge as u32 "as stored in memory" (a.b.c.d = a | b<<8 | c<<16 | d<<24), like in_addr.s_addr. */
#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include "dotbench_radio.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_netif_sntp.h"
#include "lwip/sockets.h"
#include "mqtt5_client.h"
#include "mqtt_client.h"
#include "ping/ping_sock.h"

#define NET_MS_SLACK 4000u
#define OP_MS 15000u

esp_err_t esp_crt_bundle_attach(void *conf) { (void)conf; return ESP_OK; }

static esp_err_t rcof(int rc)
{
    if (rc == 0) return ESP_OK;
    if (rc == DBH_ERR_TIMEOUT || rc == DBH_ERR_NOHOST || rc == DBH_ERR_NOOP) return ESP_ERR_TIMEOUT;
    return rc > 0 ? (esp_err_t)rc : ESP_FAIL;
}

/* ================= HTTP ================= */
#define H_MAX 24
#define H_READ_MAX 16384
struct hdr { char *k, *v; };
struct esp_http_client {
    uint32_t id;
    char *url;
    int method, timeout_ms;
    bool noredir, opened, fetched, complete, chunked, persistent, failed;
    esp_http_client_event_t evt;
    http_event_handle_cb cb;
    void *user;
    struct hdr h[H_MAX];
    int nh;
    uint8_t *body; size_t body_len, body_cap;
    int status; int64_t clen, received;
};
static uint32_t g_hid;
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;

esp_http_client_handle_t esp_http_client_init(const esp_http_client_config_t *cfg)
{
    if (!cfg || !cfg->url) return NULL;
    struct esp_http_client *c = calloc(1, sizeof(*c));
    if (!c) return NULL;
    c->url = strdup(cfg->url);
    c->method = cfg->method;
    c->timeout_ms = cfg->timeout_ms > 0 ? cfg->timeout_ms : 5000;
    c->noredir = cfg->disable_auto_redirect;
    c->cb = cfg->event_handler;
    c->user = cfg->user_data;
    pthread_mutex_lock(&g_mu); c->id = ++g_hid; pthread_mutex_unlock(&g_mu);
    c->clen = -1;
    return c;
}
esp_err_t esp_http_client_set_header(esp_http_client_handle_t c, const char *k, const char *v)
{
    if (!c || !k || !v) return ESP_ERR_INVALID_ARG;
    for (int i = 0; i < c->nh; i++)
        if (strcasecmp(c->h[i].k, k) == 0) { free(c->h[i].v); c->h[i].v = strdup(v); return ESP_OK; }
    if (c->nh >= H_MAX) return ESP_ERR_NO_MEM;
    c->h[c->nh].k = strdup(k); c->h[c->nh].v = strdup(v); c->nh++;
    return ESP_OK;
}
esp_err_t esp_http_client_set_timeout_ms(esp_http_client_handle_t c, int ms) { if (!c) return ESP_ERR_INVALID_ARG; c->timeout_ms = ms; return ESP_OK; }

/* One request to the world: url, method, headers, body in; status, length, flags, response headers out. */
static esp_err_t do_request(esp_http_client_handle_t c)
{
    size_t need = 64 + strlen(c->url) + c->body_len;
    for (int i = 0; i < c->nh; i++) need += 8 + strlen(c->h[i].k) + strlen(c->h[i].v);
    uint8_t *in = malloc(need), *out = malloc(DBH_OUT_MAX);
    if (!in || !out) { free(in); free(out); return ESP_ERR_NO_MEM; }
    dbh_w_t w; dbh_w_init(&w, in, need);
    dbh_w_u32(&w, c->id); dbh_w_u8(&w, (uint8_t)c->method); dbh_w_u8(&w, c->noredir); dbh_w_u32(&w, (uint32_t)c->timeout_ms);
    dbh_w_str(&w, c->url);
    dbh_w_u16(&w, (uint16_t)c->nh);
    for (int i = 0; i < c->nh; i++) { dbh_w_str(&w, c->h[i].k); dbh_w_str(&w, c->h[i].v); }
    dbh_w_u32(&w, (uint32_t)c->body_len);
    dbh_w_bytes(&w, c->body, c->body_len);
    size_t got = 0;
    int rc = dbh_call("net.http_do", in, w.len, out, DBH_OUT_MAX, &got, (uint32_t)c->timeout_ms + NET_MS_SLACK);
    free(in);
    c->fetched = true;
    if (rc != 0) { free(out); c->failed = true; return rc == DBH_ERR_NOHOST ? ESP_ERR_HTTP_CONNECT : (esp_err_t)(rc > 0 ? rc : ESP_ERR_HTTP_CONNECT); }
    dbh_r_t r; dbh_r_init(&r, out, got);
    c->status = (int32_t)dbh_r_u32(&r);
    int32_t cl = (int32_t)dbh_r_u32(&r);
    int flags = dbh_r_u8(&r);
    c->chunked = flags & 1; c->persistent = (flags & 2) != 0; c->complete = (flags & 4) != 0;
    c->clen = c->chunked ? 0 : cl;
    int n = dbh_r_u16(&r);
    for (int i = 0; i < n && !r.bad; i++) {
        size_t kl, vl;
        const uint8_t *k = dbh_r_lp(&r, &kl), *v = dbh_r_lp(&r, &vl);
        if (r.bad || !c->cb) continue;
        char *ks = malloc(kl + 1), *vs = malloc(vl + 1);
        if (ks && vs) {
            memcpy(ks, k, kl); ks[kl] = 0; memcpy(vs, v, vl); vs[vl] = 0;
            c->evt.event_id = HTTP_EVENT_ON_HEADER; c->evt.client = c; c->evt.user_data = c->user;
            c->evt.header_key = ks; c->evt.header_value = vs; c->evt.data = NULL; c->evt.data_len = 0;
            c->cb(&c->evt);
        }
        free(ks); free(vs);
    }
    free(out);
    if (r.bad) { c->failed = true; return ESP_ERR_HTTP_FETCH_HEADER; }
    return ESP_OK;
}

esp_err_t esp_http_client_open(esp_http_client_handle_t c, int write_len)
{
    if (!c) return ESP_ERR_INVALID_ARG;
    c->opened = true;
    c->fetched = false; c->failed = false; c->complete = false; c->received = 0; c->status = 0; c->clen = -1;
    c->body_len = 0;
    if (write_len > 0) {
        free(c->body);
        c->body_cap = (size_t)write_len; c->body = malloc(c->body_cap);
        if (!c->body) return ESP_ERR_NO_MEM;
        return ESP_OK;   /* the request goes out at fetch_headers, with the body */
    }
    /* No body: the connection is made now, so an unreachable host fails the open as it does on the chip. */
    return do_request(c) == ESP_OK ? ESP_OK : ESP_ERR_HTTP_CONNECT;
}
int esp_http_client_write(esp_http_client_handle_t c, const char *buf, int len)
{
    if (!c || !c->opened || len < 0 || c->body_len + (size_t)len > c->body_cap) return -1;
    memcpy(c->body + c->body_len, buf, (size_t)len);
    c->body_len += (size_t)len;
    return len;
}
int64_t esp_http_client_fetch_headers(esp_http_client_handle_t c)
{
    if (!c || !c->opened) return -1;
    if (!c->fetched && do_request(c) != ESP_OK) return -1;
    if (c->failed) return -1;
    return c->clen;
}
int esp_http_client_get_status_code(esp_http_client_handle_t c) { return c ? c->status : -1; }
int esp_http_client_read(esp_http_client_handle_t c, char *buf, int len)
{
    if (!c || !c->fetched || c->failed || len < 0) return -1;
    if (c->complete || len == 0) return 0;
    uint8_t in[16]; dbh_w_t w; dbh_w_init(&w, in, sizeof(in));
    dbh_w_u32(&w, c->id); dbh_w_u32(&w, (uint32_t)(len < H_READ_MAX ? len : H_READ_MAX)); dbh_w_u32(&w, (uint32_t)c->timeout_ms);
    uint8_t *out = malloc(H_READ_MAX + 8);
    if (!out) return -1;
    size_t got = 0;
    int rc = dbh_call("net.http_read", in, w.len, out, H_READ_MAX + 8, &got, (uint32_t)c->timeout_ms + NET_MS_SLACK);
    int ret;
    if (rc != 0 || got < 1) ret = -1;
    else if (out[0] == 2) { c->failed = true; ret = -1; }          /* the body broke off */
    else {
        size_t n = got - 1;
        memcpy(buf, out + 1, n);
        c->received += (int64_t)n;
        if (out[0] == 1) c->complete = true;                         /* end of body */
        if (c->clen > 0 && c->received >= c->clen) c->complete = true;
        ret = (int)n;                                                /* 0: nothing yet, the timeout expired */
    }
    free(out);
    return ret;
}
bool esp_http_client_is_complete_data_received(esp_http_client_handle_t c) { return c && c->complete; }
bool esp_http_client_is_chunked_response(esp_http_client_handle_t c) { return c && c->chunked; }
bool esp_http_client_is_persistent_connection(esp_http_client_handle_t c) { return c && c->persistent; }
esp_err_t esp_http_client_close(esp_http_client_handle_t c)
{
    if (!c) return ESP_ERR_INVALID_ARG;
    if (c->fetched) { uint32_t id = c->id; dbh_call("net.http_close", &id, 4, NULL, 0, NULL, OP_MS); }
    c->opened = false; c->fetched = false;
    return ESP_OK;
}
esp_err_t esp_http_client_cleanup(esp_http_client_handle_t c)
{
    if (!c) return ESP_ERR_INVALID_ARG;
    if (c->opened) esp_http_client_close(c);
    for (int i = 0; i < c->nh; i++) { free(c->h[i].k); free(c->h[i].v); }
    free(c->url); free(c->body); free(c);
    return ESP_OK;
}

/* ================= sockets: DNS + UDP ================= */
static int g_fd[16];
static int g_fd_next = 3000;

int dbnet_getaddrinfo(const char *node, const char *service, const struct addrinfo *hints, struct addrinfo **res)
{
    if (!node || !res) return EAI_NONAME;
    uint8_t in[160], out[8]; dbh_w_t w; dbh_w_init(&w, in, sizeof(in)); dbh_w_str(&w, node);
    size_t got = 0;
    if (w.over || dbh_call("net.dns", in, w.len, out, sizeof(out), &got, OP_MS) != 0 || got < 4) return EAI_NONAME;
    struct { struct addrinfo ai; struct sockaddr_in sin; } *b = calloc(1, sizeof(*b));
    if (!b) return EAI_MEMORY;
    dbh_r_t r; dbh_r_init(&r, out, got);
    b->sin.sin_family = AF_INET;
    b->sin.sin_addr.s_addr = dbh_r_u32(&r);
    b->sin.sin_port = htons((uint16_t)(service ? atoi(service) : 0));
    b->ai.ai_family = AF_INET;
    b->ai.ai_socktype = hints ? hints->ai_socktype : 0;
    b->ai.ai_addrlen = sizeof(b->sin);
    b->ai.ai_addr = (struct sockaddr *)&b->sin;
    *res = &b->ai;
    return 0;
}
void dbnet_freeaddrinfo(struct addrinfo *ai) { free(ai); }
int dbnet_socket(int domain, int type, int protocol)
{
    (void)protocol;
    if (domain != AF_INET || type != SOCK_DGRAM) { errno = EAFNOSUPPORT; return -1; }   /* TCP sockets: HTTP and MQTT go through their clients */
    pthread_mutex_lock(&g_mu);
    for (int i = 0; i < 16; i++) if (!g_fd[i]) { g_fd[i] = ++g_fd_next; int fd = g_fd[i]; pthread_mutex_unlock(&g_mu); return fd; }
    pthread_mutex_unlock(&g_mu);
    errno = EMFILE;
    return -1;
}
ssize_t dbnet_sendto(int s, const void *data, size_t size, int flags, const struct sockaddr *to, socklen_t tolen)
{
    (void)flags;
    int ok = 0;
    pthread_mutex_lock(&g_mu);
    for (int i = 0; i < 16; i++) if (g_fd[i] == s) ok = 1;
    pthread_mutex_unlock(&g_mu);
    if (!ok) { errno = EBADF; return -1; }
    if (!to || tolen < sizeof(struct sockaddr_in) || size > 1400) { errno = EINVAL; return -1; }
    const struct sockaddr_in *sin = (const struct sockaddr_in *)to;
    uint8_t *in = malloc(size + 8);
    if (!in) { errno = ENOMEM; return -1; }
    dbh_w_t w; dbh_w_init(&w, in, size + 8);
    dbh_w_u32(&w, sin->sin_addr.s_addr); dbh_w_u16(&w, ntohs(sin->sin_port)); dbh_w_bytes(&w, data, size);
    int rc = dbh_call("net.udp_send", in, w.len, NULL, 0, NULL, OP_MS);
    free(in);
    if (rc != 0) { errno = ENETUNREACH; return -1; }
    return (ssize_t)size;
}
#undef close
int dbnet_close(int s)
{
    pthread_mutex_lock(&g_mu);
    for (int i = 0; i < 16; i++) if (g_fd[i] == s) { g_fd[i] = 0; pthread_mutex_unlock(&g_mu); return 0; }
    pthread_mutex_unlock(&g_mu);
    errno = EBADF;
    return -1;
}

/* ================= ping ================= */
struct ping_sess {
    uint32_t id; esp_ping_config_t cfg; esp_ping_callbacks_t cbs;
    uint32_t seq, ttl, ms, req, rep, size, dur; bool live;
};
#define P_MAX 8
static struct ping_sess *g_ping[P_MAX];
static uint32_t g_pid;
static pthread_once_t g_once = PTHREAD_ONCE_INIT;

static void on_ping_event(const uint8_t *d, size_t n, void *ctx)
{
    (void)ctx;
    dbh_r_t r; dbh_r_init(&r, d, n);
    uint32_t id = dbh_r_u32(&r); int kind = dbh_r_u8(&r);
    uint32_t seq = dbh_r_u16(&r), ms = dbh_r_u32(&r), ttl = dbh_r_u8(&r);
    if (r.bad) return;
    struct ping_sess *s = NULL;
    pthread_mutex_lock(&g_mu);
    for (int i = 0; i < P_MAX; i++) if (g_ping[i] && g_ping[i]->id == id) s = g_ping[i];
    pthread_mutex_unlock(&g_mu);
    if (!s) return;
    s->seq = seq; s->ms = ms; s->ttl = ttl;
    if (kind == 0) { s->req++; s->rep++; if (s->cbs.on_ping_success) s->cbs.on_ping_success(s, s->cbs.cb_args); }
    else if (kind == 1) { s->req++; if (s->cbs.on_ping_timeout) s->cbs.on_ping_timeout(s, s->cbs.cb_args); }
    else { s->live = false; if (s->cbs.on_ping_end) s->cbs.on_ping_end(s, s->cbs.cb_args); }
}
static void sntp_event(const uint8_t *d, size_t n, void *ctx);

static void net_reg_once(void);
esp_err_t esp_ping_new_session(const esp_ping_config_t *cfg, const esp_ping_callbacks_t *cbs, esp_ping_handle_t *out)
{
    pthread_once(&g_once, net_reg_once);
    struct ping_sess *s = calloc(1, sizeof(*s));
    if (!s) return ESP_ERR_NO_MEM;
    s->cfg = *cfg; if (cbs) s->cbs = *cbs;
    esp_err_t e = ESP_ERR_NO_MEM;
    pthread_mutex_lock(&g_mu);
    s->id = ++g_pid;
    for (int i = 0; i < P_MAX; i++) if (!g_ping[i]) { g_ping[i] = s; e = ESP_OK; break; }
    pthread_mutex_unlock(&g_mu);
    if (e != ESP_OK) { free(s); return e; }
    *out = s;
    return ESP_OK;
}
esp_err_t esp_ping_start(esp_ping_handle_t h)
{
    struct ping_sess *s = h; uint8_t in[32]; dbh_w_t w; dbh_w_init(&w, in, sizeof(in));
    dbh_w_u32(&w, s->id); dbh_w_u32(&w, s->cfg.target_addr.u_addr.ip4.addr); dbh_w_u32(&w, s->cfg.count);
    dbh_w_u32(&w, s->cfg.interval_ms); dbh_w_u32(&w, s->cfg.timeout_ms); dbh_w_u8(&w, s->cfg.ttl);
    s->live = true;
    return rcof(dbh_call("ping.start", in, w.len, NULL, 0, NULL, OP_MS));
}
esp_err_t esp_ping_stop(esp_ping_handle_t h) { struct ping_sess *s = h; uint32_t id = s->id; return rcof(dbh_call("ping.stop", &id, 4, NULL, 0, NULL, OP_MS)); }
esp_err_t esp_ping_delete_session(esp_ping_handle_t h)
{
    struct ping_sess *s = h;
    pthread_mutex_lock(&g_mu);
    for (int i = 0; i < P_MAX; i++) if (g_ping[i] == s) g_ping[i] = NULL;
    pthread_mutex_unlock(&g_mu);
    uint32_t id = s->id; dbh_call("ping.stop", &id, 4, NULL, 0, NULL, OP_MS);
    free(s);
    return ESP_OK;
}
esp_err_t esp_ping_get_profile(esp_ping_handle_t h, esp_ping_profile_t p, void *data, uint32_t size)
{
    struct ping_sess *s = h; uint32_t v;
    switch (p) {
        case ESP_PING_PROF_SEQNO: v = s->seq; break;
        case ESP_PING_PROF_TTL: v = s->ttl; break;
        case ESP_PING_PROF_REQUEST: v = s->req; break;
        case ESP_PING_PROF_REPLY: v = s->rep; break;
        case ESP_PING_PROF_TIMEGAP: case ESP_PING_PROF_TRIPTIME: v = s->ms; break;
        case ESP_PING_PROF_SIZE: v = s->cfg.data_size; break;
        case ESP_PING_PROF_IPADDR: v = s->cfg.target_addr.u_addr.ip4.addr; break;
        default: return ESP_ERR_INVALID_ARG;
    }
    if (size > 4) size = 4;
    memcpy(data, &v, size);
    return ESP_OK;
}

/* ================= SNTP ================= */
static sntp_sync_time_cb_t g_sntp_cb;
static void sntp_event(const uint8_t *d, size_t n, void *ctx)
{
    (void)ctx;
    dbh_r_t r; dbh_r_init(&r, d, n);
    struct timeval tv; tv.tv_sec = (time_t)dbh_r_u32(&r); tv.tv_usec = 0;
    if (!r.bad && g_sntp_cb) g_sntp_cb(&tv);
}
esp_err_t esp_netif_sntp_init(const esp_sntp_config_t *cfg)
{
    pthread_once(&g_once, net_reg_once);
    g_sntp_cb = cfg ? cfg->sync_cb : NULL;
    return rcof(dbh_call("sntp.start", NULL, 0, NULL, 0, NULL, OP_MS));
}
esp_err_t esp_netif_sntp_start(void) { return rcof(dbh_call("sntp.start", NULL, 0, NULL, 0, NULL, OP_MS)); }
void esp_netif_sntp_deinit(void) { dbh_call("sntp.stop", NULL, 0, NULL, 0, NULL, OP_MS); }

/* ================= MQTT ================= */
#define M_MAX 4
struct esp_mqtt_client {
    uint32_t id; esp_event_handler_t handler; void *arg; bool live;
};
static struct esp_mqtt_client *g_mq[M_MAX];
static uint32_t g_mid;

static void on_mqtt_event(const uint8_t *d, size_t n, void *ctx)
{
    (void)ctx;
    dbh_r_t r; dbh_r_init(&r, d, n);
    uint32_t id = dbh_r_u32(&r); int ev = dbh_r_u8(&r);
    if (r.bad) return;
    struct esp_mqtt_client *c = NULL;
    esp_event_handler_t h = NULL; void *arg = NULL;
    pthread_mutex_lock(&g_mu);
    for (int i = 0; i < M_MAX; i++) if (g_mq[i] && g_mq[i]->id == id && g_mq[i]->live) { c = g_mq[i]; h = c->handler; arg = c->arg; }
    pthread_mutex_unlock(&g_mu);
    if (!c || !h) return;
    esp_mqtt_event_t e; esp_mqtt_error_codes_t ec; memset(&e, 0, sizeof(e)); memset(&ec, 0, sizeof(ec));
    e.event_id = (esp_mqtt_event_id_t)ev; e.client = c; e.user_context = arg; e.protocol_ver = MQTT_PROTOCOL_V_3_1_1;
    char *topic = NULL, *data = NULL;
    switch (ev) {
        case MQTT_EVENT_CONNECTED: e.session_present = dbh_r_u8(&r) != 0; break;
        case MQTT_EVENT_ERROR: ec.error_type = (esp_mqtt_error_type_t)dbh_r_u8(&r); ec.connect_return_code = dbh_r_u8(&r); e.error_handle = &ec; break;
        case MQTT_EVENT_PUBLISHED: case MQTT_EVENT_SUBSCRIBED: case MQTT_EVENT_UNSUBSCRIBED: e.msg_id = (int)dbh_r_u32(&r); break;
        case MQTT_EVENT_DATA: {
            size_t tl, dl; const uint8_t *t = dbh_r_lp(&r, &tl);
            e.retain = dbh_r_u8(&r) != 0; e.qos = dbh_r_u8(&r);
            uint32_t dl32 = dbh_r_u32(&r); const uint8_t *p = r.p + r.pos; dl = dl32;
            if (r.bad || r.pos + dl > r.len) return;
            topic = malloc(tl + 1); data = malloc(dl + 1);
            if (!topic || !data) { free(topic); free(data); return; }
            memcpy(topic, t, tl); topic[tl] = 0; memcpy(data, p, dl); data[dl] = 0;
            e.topic = topic; e.topic_len = (int)tl; e.data = data; e.data_len = (int)dl; e.total_data_len = (int)dl;
            e.current_data_offset = 0;
            break;
        }
        default: break;
    }
    if (!r.bad) h(arg, "MQTT_EVENTS", ev, &e);
    free(topic); free(data);
}
static void net_reg_once(void)
{
    dbh_on_event("ping.event", on_ping_event, NULL);
    dbh_on_event("sntp.time", sntp_event, NULL);
    dbh_on_event("mqtt.event", on_mqtt_event, NULL);
}

esp_mqtt_client_handle_t esp_mqtt_client_init(const esp_mqtt_client_config_t *cfg)
{
    pthread_once(&g_once, net_reg_once);
    if (!cfg || !cfg->broker.address.uri) return NULL;
    struct esp_mqtt_client *c = calloc(1, sizeof(*c));
    if (!c) return NULL;
    int slot = -1;
    pthread_mutex_lock(&g_mu);
    c->id = ++g_mid; c->live = true;
    for (int i = 0; i < M_MAX; i++) if (!g_mq[i]) { g_mq[i] = c; slot = i; break; }
    pthread_mutex_unlock(&g_mu);
    if (slot < 0) { free(c); return NULL; }
    uint8_t in[1100]; dbh_w_t w; dbh_w_init(&w, in, sizeof(in));
    dbh_w_u32(&w, c->id); dbh_w_str(&w, cfg->broker.address.uri); dbh_w_str(&w, cfg->credentials.client_id);
    dbh_w_str(&w, cfg->credentials.username); dbh_w_str(&w, cfg->credentials.authentication.password);
    dbh_w_u8(&w, cfg->session.disable_clean_session); dbh_w_u8(&w, (uint8_t)cfg->session.protocol_ver);
    dbh_w_u8(&w, !cfg->network.disable_auto_reconnect);
    dbh_w_str(&w, cfg->session.last_will.topic);
    dbh_w_lp(&w, cfg->session.last_will.msg, cfg->session.last_will.msg ? (size_t)cfg->session.last_will.msg_len : 0);
    dbh_w_u8(&w, (uint8_t)cfg->session.last_will.qos); dbh_w_u8(&w, (uint8_t)cfg->session.last_will.retain);
    dbh_w_u32(&w, cfg->network.reconnect_timeout_ms > 0 ? (uint32_t)cfg->network.reconnect_timeout_ms : 10000u);
    dbh_w_u16(&w, cfg->session.keepalive > 0 ? (uint16_t)cfg->session.keepalive : 120);
    if (w.over || rcof(dbh_call("mqtt.init", in, w.len, NULL, 0, NULL, OP_MS)) != ESP_OK) {
        pthread_mutex_lock(&g_mu); g_mq[slot] = NULL; pthread_mutex_unlock(&g_mu);
        free(c);
        return NULL;
    }
    return c;
}
esp_err_t esp_mqtt_client_register_event(esp_mqtt_client_handle_t c, esp_mqtt_event_id_t ev, esp_event_handler_t h, void *arg)
{
    (void)ev;
    if (!c) return ESP_ERR_INVALID_ARG;
    pthread_mutex_lock(&g_mu); c->handler = h; c->arg = arg; pthread_mutex_unlock(&g_mu);
    return ESP_OK;
}
static esp_err_t simple(esp_mqtt_client_handle_t c, const char *op)
{
    if (!c) return ESP_ERR_INVALID_ARG;
    uint32_t id = c->id;
    return rcof(dbh_call(op, &id, 4, NULL, 0, NULL, OP_MS));
}
esp_err_t esp_mqtt_client_start(esp_mqtt_client_handle_t c) { return simple(c, "mqtt.start"); }
esp_err_t esp_mqtt_client_stop(esp_mqtt_client_handle_t c) { return simple(c, "mqtt.stop"); }
esp_err_t esp_mqtt_client_destroy(esp_mqtt_client_handle_t c)
{
    if (!c) return ESP_ERR_INVALID_ARG;
    esp_err_t e = simple(c, "mqtt.destroy");
    pthread_mutex_lock(&g_mu);
    c->live = false;
    for (int i = 0; i < M_MAX; i++) if (g_mq[i] == c) g_mq[i] = NULL;
    pthread_mutex_unlock(&g_mu);
    free(c);
    return e;
}
esp_err_t esp_mqtt5_client_set_connect_property(esp_mqtt_client_handle_t c, const esp_mqtt5_connection_property_config_t *p)
{
    if (!c || !p) return ESP_ERR_INVALID_ARG;
    uint8_t in[12]; dbh_w_t w; dbh_w_init(&w, in, sizeof(in));
    dbh_w_u32(&w, c->id); dbh_w_u32(&w, p->session_expiry_interval); dbh_w_u16(&w, p->receive_maximum);
    return rcof(dbh_call("mqtt.prop", in, w.len, NULL, 0, NULL, OP_MS));
}
int esp_mqtt_client_publish(esp_mqtt_client_handle_t c, const char *topic, const char *data, int len, int qos, int retain)
{
    if (!c || !topic || len < 0) return -1;
    size_t need = 16 + strlen(topic) + (size_t)len;
    uint8_t *in = malloc(need);
    if (!in) return -1;
    dbh_w_t w; dbh_w_init(&w, in, need);
    dbh_w_u32(&w, c->id); dbh_w_u8(&w, (uint8_t)qos); dbh_w_u8(&w, retain != 0); dbh_w_str(&w, topic); dbh_w_bytes(&w, data, (size_t)len);
    int rc = dbh_call("mqtt.publish", in, w.len, NULL, 0, NULL, OP_MS);
    free(in);
    return rc >= 0 ? rc : -1;
}
int esp_mqtt_client_enqueue(esp_mqtt_client_handle_t c, const char *topic, const char *data, int len, int qos, int retain, bool store)
{
    (void)store;
    return esp_mqtt_client_publish(c, topic, data, len, qos, retain);
}
static int sub_op(esp_mqtt_client_handle_t c, const char *op, const char *topic, int qos)
{
    if (!c || !topic) return -1;
    uint8_t in[160]; dbh_w_t w; dbh_w_init(&w, in, sizeof(in));
    dbh_w_u32(&w, c->id); dbh_w_u8(&w, (uint8_t)qos); dbh_w_str(&w, topic);
    if (w.over) return -1;
    int rc = dbh_call(op, in, w.len, NULL, 0, NULL, OP_MS);
    return rc >= 0 ? rc : -1;
}
int esp_mqtt_client_subscribe(esp_mqtt_client_handle_t c, const char *topic, int qos) { return sub_op(c, "mqtt.subscribe", topic, qos); }
int esp_mqtt_client_unsubscribe(esp_mqtt_client_handle_t c, const char *topic) { return sub_op(c, "mqtt.unsubscribe", topic, 0); }
