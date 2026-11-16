/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef DOTBENCH_FREERTOS_QUEUE_H
#define DOTBENCH_FREERTOS_QUEUE_H
#include "freertos/FreeRTOS.h"
#ifdef __cplusplus
extern "C" {
#endif

#define queueQUEUE_TYPE_BASE                 ((uint8_t)0U)
#define queueQUEUE_TYPE_SET                  ((uint8_t)0U)
#define queueQUEUE_TYPE_MUTEX                ((uint8_t)1U)
#define queueQUEUE_TYPE_COUNTING_SEMAPHORE   ((uint8_t)2U)
#define queueQUEUE_TYPE_BINARY_SEMAPHORE     ((uint8_t)3U)
#define queueQUEUE_TYPE_RECURSIVE_MUTEX      ((uint8_t)4U)

#define queueSEND_TO_BACK   ((BaseType_t)0)
#define queueSEND_TO_FRONT  ((BaseType_t)1)
#define queueOVERWRITE      ((BaseType_t)2)

QueueHandle_t xQueueGenericCreate(UBaseType_t len, UBaseType_t itemSize, uint8_t type);
QueueHandle_t xQueueGenericCreateStatic(UBaseType_t len, UBaseType_t itemSize, uint8_t *storage,
                                        StaticQueue_t *buf, uint8_t type);
BaseType_t xQueueGenericSend(QueueHandle_t q, const void *item, TickType_t ticks, BaseType_t pos);
BaseType_t xQueueGenericSendFromISR(QueueHandle_t q, const void *item, BaseType_t *woken, BaseType_t pos);
BaseType_t xQueueReceive(QueueHandle_t q, void *item, TickType_t ticks);
BaseType_t xQueueReceiveFromISR(QueueHandle_t q, void *item, BaseType_t *woken);
BaseType_t xQueuePeek(QueueHandle_t q, void *item, TickType_t ticks);
BaseType_t xQueuePeekFromISR(QueueHandle_t q, void *item);
UBaseType_t uxQueueMessagesWaiting(const QueueHandle_t q);
UBaseType_t uxQueueMessagesWaitingFromISR(const QueueHandle_t q);
UBaseType_t uxQueueSpacesAvailable(const QueueHandle_t q);
BaseType_t xQueueIsQueueEmptyFromISR(const QueueHandle_t q);
BaseType_t xQueueIsQueueFullFromISR(const QueueHandle_t q);
BaseType_t xQueueReset(QueueHandle_t q);
void vQueueDelete(QueueHandle_t q);

#define xQueueCreate(len, size)                  xQueueGenericCreate((len), (size), queueQUEUE_TYPE_BASE)
#define xQueueCreateStatic(len, size, st, buf)   xQueueGenericCreateStatic((len), (size), (st), (buf), queueQUEUE_TYPE_BASE)
#define xQueueSend(q, i, t)                      xQueueGenericSend((q), (i), (t), queueSEND_TO_BACK)
#define xQueueSendToBack(q, i, t)                xQueueGenericSend((q), (i), (t), queueSEND_TO_BACK)
#define xQueueSendToFront(q, i, t)               xQueueGenericSend((q), (i), (t), queueSEND_TO_FRONT)
#define xQueueOverwrite(q, i)                    xQueueGenericSend((q), (i), 0, queueOVERWRITE)
#define xQueueSendFromISR(q, i, w)               xQueueGenericSendFromISR((q), (i), (w), queueSEND_TO_BACK)
#define xQueueSendToBackFromISR(q, i, w)         xQueueGenericSendFromISR((q), (i), (w), queueSEND_TO_BACK)
#define xQueueSendToFrontFromISR(q, i, w)        xQueueGenericSendFromISR((q), (i), (w), queueSEND_TO_FRONT)
#define xQueueOverwriteFromISR(q, i, w)          xQueueGenericSendFromISR((q), (i), (w), queueOVERWRITE)

/* Internal entry points shared with semphr.h */
BaseType_t xQueueSemaphoreTake(QueueHandle_t q, TickType_t ticks);
BaseType_t xQueueGiveFromISR(QueueHandle_t q, BaseType_t *woken);
QueueHandle_t xQueueCreateCountingSemaphore(UBaseType_t max, UBaseType_t initial);
QueueHandle_t xQueueCreateCountingSemaphoreStatic(UBaseType_t max, UBaseType_t initial, StaticQueue_t *buf);
QueueHandle_t xQueueCreateMutex(uint8_t type);
QueueHandle_t xQueueCreateMutexStatic(uint8_t type, StaticQueue_t *buf);
void *xQueueGetMutexHolder(QueueHandle_t q);
BaseType_t xQueueTakeMutexRecursive(QueueHandle_t q, TickType_t ticks);
BaseType_t xQueueGiveMutexRecursive(QueueHandle_t q);

#ifdef __cplusplus
}
#endif
#endif
