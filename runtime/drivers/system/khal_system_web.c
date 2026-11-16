/* SPDX-License-Identifier: GPL-3.0-or-later
 * khal_system for the web bench: restart/panic go to the bridge, tasks are the
 * rtos layer's tasks, heap numbers are fixed plausible values. Replaces
 * components/khal/system/src/khal_system_esp.c. */
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "khal_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "kweb_bridge.h"
#include "esp_random.h"
#include "esp_heap_caps.h"

void khal_restart(void)
{
    kweb_text_printf(KWEB_CH_LOG, "dotbench: khal_restart()\n");
    __atomic_fetch_or(&kweb_state()->events, KWEB_EVT_RESTART_REQUESTED, __ATOMIC_SEQ_CST);
    exit(0);
}

void khal_panic(const char *why)
{
    kweb_text_printf(KWEB_CH_LOG, "PANIC: %s\n", why ? why : "(null)");
    __atomic_fetch_or(&kweb_state()->events, KWEB_EVT_PANIC, __ATOMIC_SEQ_CST);
    abort();
}

uint32_t khal_random(void) { return esp_random(); }

void khal_panic_print(const char *fmt, ...)
{
    char buf[256];
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, sizeof buf, fmt, ap);
    va_end(ap);
    if (n > 0) kweb_text_write(KWEB_CH_LOG, buf, (unsigned)(n >= (int)sizeof buf ? sizeof buf - 1 : n));
}

/* ---- heap figures: constants, the linear memory is not partitioned ---- */
size_t khal_heap_free(void)             { return 8u << 20; }
size_t khal_psram_free(void)            { return 24u << 20; }
size_t khal_psram_largest(void)         { return 16u << 20; }
size_t khal_heap_internal_free(void)    { return 400u << 10; }
size_t khal_heap_internal_largest(void) { return 300u << 10; }
size_t khal_heap_internal_low(void)     { return 380u << 10; }
void   khal_heap_watch(void)            { }
uint32_t khal_heap_alloc_failures(void) { return 0; }

/* ---- tasks ---- */
size_t khal_task_list(khal_task_info_t *out, size_t max, size_t *total)
{
    TaskStatus_t st[48];
    UBaseType_t n = uxTaskGetSystemState(st, 48, NULL);
    if (total) *total = n;
    size_t w = 0;
    for (UBaseType_t i = 0; i < n && out && w < max; i++) {
        memset(&out[w], 0, sizeof out[w]);
        snprintf(out[w].name, sizeof out[w].name, "%s", st[i].pcTaskName ? st[i].pcTaskName : "");
        out[w].prio = (uint8_t)st[i].uxCurrentPriority;
        out[w].stack_free = st[i].usStackHighWaterMark;
        w++;
    }
    return w;
}
uint32_t khal_task_stack_free(void) { return uxTaskGetStackHighWaterMark(NULL); }
uint32_t khal_task_priority_set(uint32_t p)
{
    uint32_t old = (uint32_t)uxTaskPriorityGet(NULL);
    vTaskPrioritySet(NULL, p);
    return old;
}
const char *khal_task_name(void) { return pcTaskGetName(NULL); }
bool khal_task_stack_in_psram(void) { return false; }

typedef struct { khal_task_fn_t fn; void *arg; } start_t;
static void task_tramp(void *a)
{
    start_t s = *(start_t *)a;
    free(a);
    s.fn(s.arg);
    vTaskDelete(NULL);
}
kode_status_t khal_task_start(khal_task_fn_t fn, const char *name, uint32_t stack_bytes, uint32_t prio, void *arg)
{
    if (!fn) return KODE_DENIED;
    start_t *s = malloc(sizeof *s);
    if (!s) return KODE_NO_RESOURCES;
    s->fn = fn; s->arg = arg;
    if (xTaskCreate(task_tramp, name ? name : "task", stack_bytes, s, prio, NULL) != pdPASS) {
        free(s);
        return KODE_NO_RESOURCES;
    }
    return KODE_OK;
}
void *khal_task_self(void) { return xTaskGetCurrentTaskHandle(); }
void *khal_task_slot_get(void) { return pvTaskGetThreadLocalStoragePointer(NULL, KHAL_TASK_SLOT_INDEX); }
void khal_task_slot_set(void *p) { vTaskSetThreadLocalStoragePointer(NULL, KHAL_TASK_SLOT_INDEX, p); }
static khal_task_slot_free_t g_slot_free;
static void slot_deleted(int idx, void *p) { (void)idx; if (p && g_slot_free) g_slot_free(p); }
void khal_task_slot_set_owned(void *p, khal_task_slot_free_t f)
{
    g_slot_free = f;
    vTaskSetThreadLocalStoragePointerAndDelCallback(NULL, KHAL_TASK_SLOT_INDEX, p, slot_deleted);
}

/* ---- the supervisor: a task that runs pass() every period ---- */
static void (*g_pass)(void);
static uint32_t g_period_ms;
static volatile bool g_rest;
static TaskHandle_t g_watch;
static void watch_task(void *a)
{
    (void)a;
    for (;;) {
        (void)ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(g_period_ms));
        if (!g_rest) g_pass();
    }
}
kode_status_t khal_watch_start(void (*pass)(void), uint32_t period_ms)
{
    if (g_watch || !pass || !period_ms) return KODE_DENIED;
    g_pass = pass; g_period_ms = period_ms;
    if (xTaskCreate(watch_task, "khal.watch", 4096, NULL, configMAX_PRIORITIES - 1, &g_watch) != pdPASS) {
        g_watch = NULL;
        return KODE_ERROR;
    }
    return KODE_OK;
}
void khal_watch_rest(bool rest)
{
    g_rest = rest;
    if (!rest && g_watch) (void)xTaskNotifyGive(g_watch);
}

kode_status_t khal_chip_info(khal_chip_info_t *out)
{
    if (!out) return KODE_DENIED;
    memset(out, 0, sizeof *out);
    out->model = "ESP32-P4 (dotbench)";
    out->rev_major = 1;
    out->flash_bytes = 16u << 20;
    out->psram_bytes = 32u << 20;
    static const uint8_t mac[KHAL_CHIP_MAC_LEN] = { 0x02, 0xD0, 0x7B, 0xE9, 0x00, 0x01 };
    memcpy(out->mac, mac, sizeof mac);
    return KODE_OK;
}

