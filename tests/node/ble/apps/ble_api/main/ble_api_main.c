/* SPDX-License-Identifier: GPL-3.0-or-later
 * ble_api: a bench-test app that exposes the Bluetooth calls of the public API (kode.h) as console functions and prints each
 * outcome as one "RES ..." log line. A console function only records the request; a task does the call.
 *   scan MS            kode_ble_scan: "RES scan n=N" then one "RES dev name=.. addr=.. rssi=.." per device (strongest first)
 *   name NAME          kode_ble_set_name      mfg HEX    kode_ble_set_manufacturer_data
 * and every ble_written / ble_connected / ble_disconnected event is logged as "RES event ...". The app serves one service:
 *   "5e7f0001-..." with `val` (read, write, notify) so a Phone has something to talk to. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "kode.h"
#include "kode_functions.h"
#include "kode_log.h"

KODE_APP_MANIFEST("BLE API", "test");

#define TAG "ble_api"

static const kode_ble_characteristic_t s_chars[] = {
    { "val", "5e7f0002-1111-4222-8333-444455556666", KODE_BLE_READ | KODE_BLE_WRITE | KODE_BLE_NOTIFY },
};
KODE_BLE_SERVICE("5e7f0001-1111-4222-8333-444455556666", s_chars);

typedef struct { volatile int cmd; int32_t ms; char text[200]; } slot_t;
enum { C_NONE = 0, C_SCAN, C_NAME, C_MFG, C_NOTIFY, C_SET };
static slot_t g_slot;

static void task_main(void *arg)
{
    (void)arg;
    static kode_ble_device_t devs[24];
    for (;;) {
        int cmd = g_slot.cmd;
        if (cmd == C_NONE) { vTaskDelay(5); continue; }
        slot_t *s = &g_slot;
        switch (cmd) {
        case C_SCAN: {
            int n = kode_ble_scan(devs, 24, (uint32_t)s->ms);
            if (n < 0) { KLOG_N(TAG, "RES scan n=-1 err=%s", kode_error()); break; }
            KLOG_N(TAG, "RES scan n=%d", n);
            for (int i = 0; i < n; i++) KLOG_N(TAG, "RES dev name=%s addr=%s rssi=%d", devs[i].name, devs[i].address, (int)devs[i].rssi);
            break;
        }
        case C_NAME: KLOG_N(TAG, "RES name ok=%d", kode_ble_set_name(s->text) ? 1 : 0); break;
        case C_MFG: {
            uint8_t b[32]; size_t n = 0;
            for (const char *p = s->text; p[0] && p[1] && n < sizeof b; p += 2) { char h[3] = { p[0], p[1], 0 }; b[n++] = (uint8_t)strtoul(h, NULL, 16); }
            KLOG_N(TAG, "RES mfg ok=%d", kode_ble_set_manufacturer_data(b, n) ? 1 : 0);
            break;
        }
        case C_NOTIFY: {
            uint8_t v[2] = { (uint8_t)s->ms, 0x55 };
            bool ok = kode_ble_notify("val", v, 2);
            KLOG_N(TAG, "RES notify ok=%d%s%s", ok ? 1 : 0, ok ? "" : " err=", ok ? "" : kode_error());
            break;
        }
        case C_SET: {
            uint8_t v[2] = { (uint8_t)s->ms, 0xAA };
            bool ok = kode_ble_set_value("val", v, 2);
            KLOG_N(TAG, "RES set ok=%d%s%s", ok ? 1 : 0, ok ? "" : " err=", ok ? "" : kode_error());
            break;
        }
        default: break;
        }
        g_slot.cmd = C_NONE;
    }
}

static kode_status_t post(int cmd, int32_t ms, const char *text)
{
    if (g_slot.cmd != C_NONE) { KLOG_N(TAG, "RES busy"); return KODE_OK; }
    g_slot.ms = ms;
    snprintf(g_slot.text, sizeof g_slot.text, "%s", text ? text : "");
    g_slot.cmd = cmd;
    return KODE_OK;
}
static kode_status_t f_scan(const kode_value_t *a) { return post(C_SCAN, a->i, NULL); }
static kode_status_t f_name(const kode_value_t *a) { return post(C_NAME, 0, a->s); }
static kode_status_t f_mfg(const kode_value_t *a) { return post(C_MFG, 0, a->s); }
static kode_status_t f_notify(const kode_value_t *a) { return post(C_NOTIFY, a->i, NULL); }
static kode_status_t f_set(const kode_value_t *a) { return post(C_SET, a->i, NULL); }

static const kode_function_t FUNCTIONS[] = {
    { .name = "scan", .arg = KODE_TYPE_INT, .min = 0, .max = 30000, .run = f_scan, .desc = "kode_ble_scan(ms)" },
    { .name = "name", .arg = KODE_TYPE_STRING, .run = f_name, .desc = "kode_ble_set_name" },
    { .name = "mfg", .arg = KODE_TYPE_STRING, .run = f_mfg, .desc = "kode_ble_set_manufacturer_data(hex)" },
    { .name = "notify", .arg = KODE_TYPE_INT, .min = 0, .max = 255, .run = f_notify, .desc = "kode_ble_notify(val, [n, 0x55])" },
    { .name = "set", .arg = KODE_TYPE_INT, .min = 0, .max = 255, .run = f_set, .desc = "kode_ble_set_value(val, [n, 0xAA])" },
};

static void on_ble(const kode_event_t *e)
{
    KLOG_N(TAG, "RES event %s source=%s value=%d", e->name ? e->name : "", e->source ? e->source : "", (int)e->value);
}

void app_main(void)
{
    kode_init();
    (void)KODE_FUNCTIONS_ADD(FUNCTIONS);
    (void)kode_event_add_listener(KODE_EVENT_BLE_WRITTEN, on_ble);
    (void)kode_event_add_listener(KODE_EVENT_BLE_CONNECTED, on_ble);
    (void)kode_event_add_listener(KODE_EVENT_BLE_DISCONNECTED, on_ble);
    xTaskCreate(&task_main, "ble_api_t", 6144, NULL, 5, NULL);
    KLOG_N(TAG, "ble_api up");
}
