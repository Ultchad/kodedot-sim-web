/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef DOTBENCH_FREERTOS_TIMERS_H
#define DOTBENCH_FREERTOS_TIMERS_H
#include "freertos/FreeRTOS.h"
#ifdef __cplusplus
extern "C" {
#endif
TimerHandle_t xTimerCreate(const char *name, TickType_t period, BaseType_t autoReload, void *id,
                           TimerCallbackFunction_t cb);
TimerHandle_t xTimerCreateStatic(const char *name, TickType_t period, BaseType_t autoReload, void *id,
                                 TimerCallbackFunction_t cb, StaticTimer_t *buf);
BaseType_t xTimerStart(TimerHandle_t t, TickType_t block);
BaseType_t xTimerStop(TimerHandle_t t, TickType_t block);
BaseType_t xTimerReset(TimerHandle_t t, TickType_t block);
BaseType_t xTimerChangePeriod(TimerHandle_t t, TickType_t period, TickType_t block);
BaseType_t xTimerDelete(TimerHandle_t t, TickType_t block);
BaseType_t xTimerIsTimerActive(TimerHandle_t t);
void *pvTimerGetTimerID(const TimerHandle_t t);
void vTimerSetTimerID(TimerHandle_t t, void *id);
const char *pcTimerGetName(TimerHandle_t t);
TickType_t xTimerGetPeriod(TimerHandle_t t);
void vTimerSetReloadMode(TimerHandle_t t, BaseType_t autoReload);
#define xTimerStartFromISR(t, w)   xTimerStart((t), 0)
#define xTimerStopFromISR(t, w)    xTimerStop((t), 0)
#define xTimerResetFromISR(t, w)   xTimerReset((t), 0)
#ifdef __cplusplus
}
#endif
#endif
