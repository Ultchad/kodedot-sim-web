/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef DOTBENCH_FREERTOS_EVENT_GROUPS_H
#define DOTBENCH_FREERTOS_EVENT_GROUPS_H
#include "freertos/FreeRTOS.h"
#ifdef __cplusplus
extern "C" {
#endif
EventGroupHandle_t xEventGroupCreate(void);
EventGroupHandle_t xEventGroupCreateStatic(StaticEventGroup_t *buf);
EventBits_t xEventGroupWaitBits(EventGroupHandle_t g, EventBits_t bits, BaseType_t clearOnExit,
                                BaseType_t waitAll, TickType_t ticks);
EventBits_t xEventGroupSetBits(EventGroupHandle_t g, EventBits_t bits);
EventBits_t xEventGroupClearBits(EventGroupHandle_t g, EventBits_t bits);
EventBits_t xEventGroupGetBits(EventGroupHandle_t g);
EventBits_t xEventGroupSync(EventGroupHandle_t g, EventBits_t set, EventBits_t wait, TickType_t ticks);
void vEventGroupDelete(EventGroupHandle_t g);
#define xEventGroupGetBitsFromISR(g)       xEventGroupGetBits(g)
#define xEventGroupClearBitsFromISR(g, b)  xEventGroupClearBits((g), (b))
BaseType_t xEventGroupSetBitsFromISR(EventGroupHandle_t g, EventBits_t bits, BaseType_t *woken);
#ifdef __cplusplus
}
#endif
#endif
