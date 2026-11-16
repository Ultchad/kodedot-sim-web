/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef DOTBENCH_FREERTOS_IDF_ADDITIONS_H
#define DOTBENCH_FREERTOS_IDF_ADDITIONS_H
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#ifdef __cplusplus
extern "C" {
#endif
/* The capability flags select where ESP-IDF puts memory (PSRAM or internal).
 * Linear memory has no such distinction here; the argument is accepted and ignored. */
BaseType_t xTaskCreatePinnedToCoreWithCaps(TaskFunction_t fn, const char *name, uint32_t stackDepth,
                                           void *arg, UBaseType_t prio, TaskHandle_t *out,
                                           BaseType_t core, uint32_t caps);
#define xTaskCreateWithCaps(fn, name, depth, arg, prio, out, caps) \
    xTaskCreatePinnedToCoreWithCaps((fn), (name), (depth), (arg), (prio), (out), tskNO_AFFINITY, (caps))
void vTaskDeleteWithCaps(TaskHandle_t t);
QueueHandle_t xQueueCreateWithCaps(UBaseType_t len, UBaseType_t itemSize, uint32_t caps);
void vQueueDeleteWithCaps(QueueHandle_t q);
#define xSemaphoreCreateBinaryWithCaps(caps)    xSemaphoreCreateBinary()
#define xSemaphoreCreateMutexWithCaps(caps)     xSemaphoreCreateMutex()
#define vSemaphoreDeleteWithCaps(s)             vQueueDelete((s))
#ifdef __cplusplus
}
#endif
#endif
