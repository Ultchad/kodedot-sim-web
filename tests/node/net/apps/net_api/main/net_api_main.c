/* SPDX-License-Identifier: GPL-3.0-or-later
 * net_api: a bench-test app that exposes the task-side network calls of kode.h as console functions and prints the outcome
 * as one "RES ..." log line. A console function only records the request (it must not block); a task runs it.
 *   hget "url" | hpost "url|body" | hrange "url|offset|cap" | resolve "host" | ping "host|count" | udp "host|port|data"
 *   mconn "uri" | mpub "topic|text" | msub "topic" | munsub "topic" | mup | mdisc | mwait "ms"
 * The test types e.g.  hget arg="http://example.com/"  and waits for the matching RES line. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "kode.h"
#include "kode_functions.h"
#include "kode_log.h"

KODE_APP_MANIFEST("Net API", "test");

#define TAG "net_api"

typedef struct { volatile int cmd; char text[256]; } slot_t;
enum { C_NONE = 0, C_HGET, C_HPOST, C_HRANGE, C_RESOLVE, C_PING, C_UDP, C_MCONN, C_MPUB, C_MSUB, C_MUNSUB, C_MUP, C_MDISC, C_MWAIT };
static slot_t g_slot;
static uint8_t g_buf[4096];

/* split "a|b|c" in place; returns the next field or "" */
static char *field(char **p)
{
    char *s = *p, *bar;
    if (!s) return (char *)"";
    bar = strchr(s, '|');
    if (bar) { *bar = 0; *p = bar + 1; } else *p = NULL;
    return s;
}

static void show(const char *what, const char *body)
{
    char one[81];
    size_t n = body ? strlen(body) : 0, i;
    if (n > 80) n = 80;
    for (i = 0; i < n; i++) one[i] = (body[i] < 32 || body[i] > 126) ? '.' : body[i];
    one[n] = 0;
    KLOG_N(TAG, "RES %s body=[%s]", what, one);
}

static void task_main(void *arg)
{
    (void)arg;
    for (;;) {
        int cmd = g_slot.cmd;
        char *p, *a, *b, *c;
        if (cmd == C_NONE) { vTaskDelay(5); continue; }
        p = g_slot.text;
        switch (cmd) {
        case C_HGET: {
            const char *body = kode_http_get(p);
            if (body[0] == 0 && kode_http_status() == 0) KLOG_N(TAG, "RES hget ok=0 err=%s", kode_error());
            else { char w[64]; snprintf(w, sizeof w, "hget ok=1 status=%u len=%u", (unsigned)kode_http_status(), (unsigned)strlen(body)); show(w, body); }
            break;
        }
        case C_HPOST: {
            const char *body;
            a = field(&p); b = field(&p);
            body = kode_http_post(a, b);
            if (body[0] == 0 && kode_http_status() == 0) KLOG_N(TAG, "RES hpost ok=0 err=%s", kode_error());
            else { char w[64]; snprintf(w, sizeof w, "hpost ok=1 status=%u len=%u", (unsigned)kode_http_status(), (unsigned)strlen(body)); show(w, body); }
            break;
        }
        case C_HRANGE: {
            uint32_t got = 0, cap = 0;
            kode_http_off_t total = 0;
            bool ok;
            a = field(&p); b = field(&p); c = field(&p);
            cap = (uint32_t)atoi(c);
            if (cap > sizeof g_buf) cap = sizeof g_buf;
            memset(g_buf, 0, sizeof g_buf);
            ok = kode_http_get_range(a, (kode_http_off_t)atoi(b), g_buf, cap, &got, &total);
            if (ok) {
                char w[96];
                g_buf[got < sizeof g_buf ? got : sizeof g_buf - 1] = 0;
                snprintf(w, sizeof w, "hrange ok=1 status=%u got=%u total=%lu", (unsigned)kode_http_status(), (unsigned)got, (unsigned long)total);
                show(w, (const char *)g_buf);
            } else KLOG_N(TAG, "RES hrange ok=0 err=%s", kode_error());
            break;
        }
        case C_RESOLVE: {
            uint32_t ip = 0;
            if (kode_net_resolve(p, &ip)) KLOG_N(TAG, "RES resolve ok=1 ip=%u.%u.%u.%u", (unsigned)(ip & 255), (unsigned)((ip >> 8) & 255), (unsigned)((ip >> 16) & 255), (unsigned)(ip >> 24));
            else KLOG_N(TAG, "RES resolve ok=0 err=%s", kode_error());
            break;
        }
        case C_PING: {
            kode_net_ping_t r;
            a = field(&p); b = field(&p);
            r = kode_net_ping(a, (uint32_t)atoi(b));
            if (r.ok) KLOG_N(TAG, "RES ping ok=1 sent=%u received=%u avg=%u", (unsigned)r.sent, (unsigned)r.received, (unsigned)r.avg_ms);
            else KLOG_N(TAG, "RES ping ok=0 err=%s", kode_error());
            break;
        }
        case C_UDP: {
            a = field(&p); b = field(&p); c = field(&p);
            if (kode_udp_send(a, (uint16_t)atoi(b), c, (uint32_t)strlen(c))) KLOG_N(TAG, "RES udp ok=1");
            else KLOG_N(TAG, "RES udp ok=0 err=%s", kode_error());
            break;
        }
        case C_MCONN:
            if (kode_mqtt_connect(p)) KLOG_N(TAG, "RES mconn ok=1"); else KLOG_N(TAG, "RES mconn ok=0 err=%s", kode_error());
            break;
        case C_MPUB:
            a = field(&p); b = field(&p);
            if (kode_mqtt_publish(a, b)) KLOG_N(TAG, "RES mpub ok=1"); else KLOG_N(TAG, "RES mpub ok=0 err=%s", kode_error());
            break;
        case C_MSUB:
            if (kode_mqtt_subscribe(p)) KLOG_N(TAG, "RES msub ok=1"); else KLOG_N(TAG, "RES msub ok=0 err=%s", kode_error());
            break;
        case C_MUNSUB:
            if (kode_mqtt_unsubscribe(p)) KLOG_N(TAG, "RES munsub ok=1"); else KLOG_N(TAG, "RES munsub ok=0 err=%s", kode_error());
            break;
        case C_MUP:
            KLOG_N(TAG, "RES mup %d", (int)kode_mqtt_is_connected());
            break;
        case C_MDISC:
            if (kode_mqtt_disconnect()) KLOG_N(TAG, "RES mdisc ok=1"); else KLOG_N(TAG, "RES mdisc ok=0 err=%s", kode_error());
            break;
        case C_MWAIT: {
            kode_event_t ev;
            if (kode_event_wait("mqtt_message", (uint32_t)atoi(p), &ev)) KLOG_N(TAG, "RES mwait ok=1 topic=%s text=%s len=%d", ev.source, ev.text, (int)ev.value);
            else KLOG_N(TAG, "RES mwait ok=0 err=%s", kode_error());
            break;
        }
        default: break;
        }
        g_slot.cmd = C_NONE;
    }
}

static kode_status_t post(int cmd, const char *text)
{
    if (g_slot.cmd != C_NONE) { KLOG_N(TAG, "RES busy"); return KODE_DENIED; }
    snprintf(g_slot.text, sizeof g_slot.text, "%s", text ? text : "");
    g_slot.cmd = cmd;
    return KODE_OK;
}
#define F(name, cmd) static kode_status_t name(const kode_value_t *a) { return post(cmd, a ? a->s : NULL); }
F(f_hget, C_HGET) F(f_hpost, C_HPOST) F(f_hrange, C_HRANGE) F(f_resolve, C_RESOLVE) F(f_ping, C_PING) F(f_udp, C_UDP)
F(f_mconn, C_MCONN) F(f_mpub, C_MPUB) F(f_msub, C_MSUB) F(f_munsub, C_MUNSUB) F(f_mwait, C_MWAIT)
static kode_status_t f_mup(const kode_value_t *a) { (void)a; return post(C_MUP, NULL); }
static kode_status_t f_mdisc(const kode_value_t *a) { (void)a; return post(C_MDISC, NULL); }

static const kode_function_t FUNCTIONS[] = {
    { .name = "hget", .arg = KODE_TYPE_STRING, .run = f_hget, .desc = "kode_http_get(url)" },
    { .name = "hpost", .arg = KODE_TYPE_STRING, .run = f_hpost, .desc = "kode_http_post(\"url|body\")" },
    { .name = "hrange", .arg = KODE_TYPE_STRING, .run = f_hrange, .desc = "kode_http_get_range(\"url|offset|cap\")" },
    { .name = "resolve", .arg = KODE_TYPE_STRING, .run = f_resolve, .desc = "kode_net_resolve(host)" },
    { .name = "ping", .arg = KODE_TYPE_STRING, .run = f_ping, .desc = "kode_net_ping(\"host|count\")" },
    { .name = "udp", .arg = KODE_TYPE_STRING, .run = f_udp, .desc = "kode_udp_send(\"host|port|data\")" },
    { .name = "mconn", .arg = KODE_TYPE_STRING, .run = f_mconn, .desc = "kode_mqtt_connect(uri)" },
    { .name = "mpub", .arg = KODE_TYPE_STRING, .run = f_mpub, .desc = "kode_mqtt_publish(\"topic|text\")" },
    { .name = "msub", .arg = KODE_TYPE_STRING, .run = f_msub, .desc = "kode_mqtt_subscribe(topic)" },
    { .name = "munsub", .arg = KODE_TYPE_STRING, .run = f_munsub, .desc = "kode_mqtt_unsubscribe(topic)" },
    { .name = "mup", .run = f_mup, .desc = "kode_mqtt_is_connected()" },
    { .name = "mdisc", .run = f_mdisc, .desc = "kode_mqtt_disconnect()" },
    { .name = "mwait", .arg = KODE_TYPE_STRING, .run = f_mwait, .desc = "kode_event_wait(mqtt_message, ms)" },
};

void app_main(void)
{
    kode_init();
    (void)KODE_FUNCTIONS_ADD(FUNCTIONS);
    xTaskCreate(&task_main, "net_api_t", 8192, NULL, 5, NULL);
    KLOG_N(TAG, "net_api up");
}
