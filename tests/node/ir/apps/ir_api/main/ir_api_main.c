/* SPDX-License-Identifier: GPL-3.0-or-later
 * ir_api: a bench-test app that exposes the infrared calls of the public API (kode.h) as console functions and prints each
 * outcome as one "RES ..." log line. A console function only records the request (it must not block); a task does the call.
 *   send "nec;ADDR;CMD" | sendp "proto;ADDR;CMD"   kode_ir_send(protocol, addr, cmd)
 *   recv ms | last                                  kode_ir_receive(ms) | kode_ir_last()
 *   rxraw ms                                        kode_ir_receive_raw(ms): count, carrier, durations
 *   txraw "CARRIER;d1,d2,..."                       kode_ir_send_raw
 *   cat "path"                                     kode_file_read(path) with newlines shown as |
 *   capstart "path" | capstop | sendfile "path"     capture to a file / play it back
 * and every "ir_received" event is logged as "RES event source=.. value=.. text=..". */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "kode.h"
#include "kode_functions.h"
#include "kode_log.h"

KODE_APP_MANIFEST("IR API", "test");

#define TAG "ir_api"

typedef struct { volatile int cmd; int32_t ms; char text[1200]; } slot_t;
enum { C_NONE = 0, C_SEND, C_RECV, C_LAST, C_RXRAW, C_TXRAW, C_CAPSTART, C_CAPSTOP, C_SENDFILE, C_CAT };
static slot_t g_slot;

static void res_code(const char *what, kode_ir_code_t c)
{
    if (c.ok) KLOG_N(TAG, "RES %s ok=1 proto=%s addr=0x%04X cmd=0x%04X", what, c.protocol, (unsigned)c.address, (unsigned)c.command);
    else KLOG_N(TAG, "RES %s ok=0 err=%s", what, kode_error());
}

static void task_main(void *arg)
{
    (void)arg;
    static char line[KODE_IR_RAW_MAX * 6 + 64];
    static uint16_t us[KODE_IR_RAW_MAX];
    for (;;) {
        int cmd = g_slot.cmd;
        if (cmd == C_NONE) { vTaskDelay(5); continue; }
        slot_t *s = &g_slot;
        switch (cmd) {
        case C_SEND: {
            char proto[16] = "";
            unsigned a = 0, c = 0;
            char *p = s->text, *semi = strchr(p, ';');
            if (semi) { *semi = 0; snprintf(proto, sizeof proto, "%s", p); sscanf(semi + 1, "%i;%i", &a, &c); }
            bool ok = kode_ir_send(proto, a, c);
            if (ok) KLOG_N(TAG, "RES send ok=1");
            else KLOG_N(TAG, "RES send ok=0 err=%s", kode_error());
            break;
        }
        case C_RECV: res_code("recv", kode_ir_receive((uint32_t)s->ms)); break;
        case C_LAST: res_code("last", kode_ir_last()); break;
        case C_RXRAW: {
            const kode_ir_raw_t *r = kode_ir_receive_raw((uint32_t)s->ms);
            if (r && r->count) {
                int o = snprintf(line, sizeof line, "RES rxraw count=%u carrier=%u us=", (unsigned)r->count, (unsigned)r->carrier_hz);
                for (uint32_t i = 0; i < r->count && o < (int)sizeof line - 8; i++) o += snprintf(line + o, sizeof line - (size_t)o, "%s%u", i ? "," : "", (unsigned)r->us[i]);
                KLOG_N(TAG, "%s", line);
            } else KLOG_N(TAG, "RES rxraw count=0 err=%s", kode_error());
            break;
        }
        case C_TXRAW: {
            char *semi = strchr(s->text, ';');
            uint32_t carrier = 38000, n = 0;
            char *p = s->text;
            if (semi) { *semi = 0; carrier = (uint32_t)atoi(s->text); p = semi + 1; }
            while (*p && n < KODE_IR_RAW_MAX) { us[n++] = (uint16_t)strtoul(p, &p, 10); if (*p == ',') p++; }
            bool ok = kode_ir_send_raw(us, n, carrier);
            if (ok) KLOG_N(TAG, "RES txraw ok=1 n=%u", (unsigned)n);
            else KLOG_N(TAG, "RES txraw ok=0 err=%s", kode_error());
            break;
        }
        case C_CAPSTART: { bool ok = kode_ir_capture_start(s->text); if (ok) KLOG_N(TAG, "RES capstart ok=1"); else KLOG_N(TAG, "RES capstart ok=0 err=%s", kode_error()); break; }
        case C_CAPSTOP: { bool ok = kode_ir_capture_stop(); if (ok) KLOG_N(TAG, "RES capstop ok=1"); else KLOG_N(TAG, "RES capstop ok=0 err=%s", kode_error()); break; }
        case C_SENDFILE: { bool ok = kode_ir_send_file(s->text); if (ok) KLOG_N(TAG, "RES sendfile ok=1"); else KLOG_N(TAG, "RES sendfile ok=0 err=%s", kode_error()); break; }
        case C_CAT: {
            const char *t = kode_file_read(s->text);
            if (t) { int o = snprintf(line, sizeof line, "RES cat "); for (; *t && o < (int)sizeof line - 2; t++) line[o++] = (*t == '\n') ? '|' : *t; line[o] = 0; KLOG_N(TAG, "%s", line); }
            else KLOG_N(TAG, "RES cat err=%s", kode_error());
            break;
        }
        default: break;
        }
        g_slot.cmd = C_NONE;
    }
}

static kode_status_t post(int cmd, int32_t ms, const char *text)
{
    if (g_slot.cmd != C_NONE) { KLOG_N(TAG, "RES busy"); return KODE_DENIED; }
    g_slot.ms = ms;
    snprintf(g_slot.text, sizeof g_slot.text, "%s", text ? text : "");
    g_slot.cmd = cmd;
    return KODE_OK;
}
static kode_status_t f_send(const kode_value_t *a) { return post(C_SEND, 0, a->s); }
static kode_status_t f_recv(const kode_value_t *a) { return post(C_RECV, a->i, NULL); }
static kode_status_t f_last(const kode_value_t *a) { (void)a; return post(C_LAST, 0, NULL); }
static kode_status_t f_rxraw(const kode_value_t *a) { return post(C_RXRAW, a->i, NULL); }
static kode_status_t f_txraw(const kode_value_t *a) { return post(C_TXRAW, 0, a->s); }
static kode_status_t f_capstart(const kode_value_t *a) { return post(C_CAPSTART, 0, a->s); }
static kode_status_t f_capstop(const kode_value_t *a) { (void)a; return post(C_CAPSTOP, 0, NULL); }
static kode_status_t f_sendfile(const kode_value_t *a) { return post(C_SENDFILE, 0, a->s); }
static kode_status_t f_cat(const kode_value_t *a) { return post(C_CAT, 0, a->s); }

static const kode_function_t FUNCTIONS[] = {
    { .name = "send", .arg = KODE_TYPE_STRING, .run = f_send, .desc = "kode_ir_send(\"proto;addr;cmd\")" },
    { .name = "recv", .arg = KODE_TYPE_INT, .min = 0, .max = 600000, .run = f_recv, .desc = "kode_ir_receive(ms)" },
    { .name = "last", .run = f_last, .desc = "kode_ir_last()" },
    { .name = "rxraw", .arg = KODE_TYPE_INT, .min = 0, .max = 600000, .run = f_rxraw, .desc = "kode_ir_receive_raw(ms)" },
    { .name = "txraw", .arg = KODE_TYPE_STRING, .run = f_txraw, .desc = "kode_ir_send_raw(\"carrier;us,us,...\")" },
    { .name = "capstart", .arg = KODE_TYPE_STRING, .run = f_capstart, .desc = "kode_ir_capture_start(path)" },
    { .name = "capstop", .run = f_capstop, .desc = "kode_ir_capture_stop()" },
    { .name = "cat", .arg = KODE_TYPE_STRING, .run = f_cat, .desc = "kode_file_read(path), newlines shown as |" },
    { .name = "sendfile", .arg = KODE_TYPE_STRING, .run = f_sendfile, .desc = "kode_ir_send_file(path)" },
};

static void on_ir(const kode_event_t *e)
{
    KLOG_N(TAG, "RES event source=%s value=%d text=%s", e->source ? e->source : "", (int)e->value, e->text ? e->text : "");
}

void app_main(void)
{
    kode_init();
    (void)KODE_FUNCTIONS_ADD(FUNCTIONS);
    (void)kode_event_add_listener(KODE_EVENT_IR_RECEIVED, on_ir);
    xTaskCreate(&task_main, "ir_api_t", 6144, NULL, 5, NULL);
    KLOG_N(TAG, "ir_api up");
}
