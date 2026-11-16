/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef DOTBENCH_FREERTOS_SEMPHR_H
#define DOTBENCH_FREERTOS_SEMPHR_H
#include "freertos/queue.h"

#define semBINARY_SEMAPHORE_QUEUE_LENGTH  ((uint8_t)1U)
#define semGIVE_BLOCK_TIME                ((TickType_t)0U)

#define xSemaphoreCreateBinary()  xQueueGenericCreate(1, 0, queueQUEUE_TYPE_BINARY_SEMAPHORE)
#define xSemaphoreCreateBinaryStatic(buf) \
    xQueueGenericCreateStatic(1, 0, NULL, (buf), queueQUEUE_TYPE_BINARY_SEMAPHORE)
#define vSemaphoreCreateBinary(h) do { (h) = xSemaphoreCreateBinary(); if ((h) != NULL) { (void)xSemaphoreGive(h); } } while (0)
#define xSemaphoreCreateCounting(max, init)  xQueueCreateCountingSemaphore((max), (init))
#define xSemaphoreCreateCountingStatic(max, init, buf) xQueueCreateCountingSemaphoreStatic((max), (init), (buf))
#define xSemaphoreCreateMutex()              xQueueCreateMutex(queueQUEUE_TYPE_MUTEX)
#define xSemaphoreCreateMutexStatic(buf)     xQueueCreateMutexStatic(queueQUEUE_TYPE_MUTEX, (buf))
#define xSemaphoreCreateRecursiveMutex()     xQueueCreateMutex(queueQUEUE_TYPE_RECURSIVE_MUTEX)
#define xSemaphoreCreateRecursiveMutexStatic(buf) xQueueCreateMutexStatic(queueQUEUE_TYPE_RECURSIVE_MUTEX, (buf))

#define xSemaphoreTake(s, t)            xQueueSemaphoreTake((s), (t))
#define xSemaphoreTakeFromISR(s, w)     xQueueReceiveFromISR((s), NULL, (w))
#define xSemaphoreTakeRecursive(s, t)   xQueueTakeMutexRecursive((s), (t))
#define xSemaphoreGive(s)               xQueueGenericSend((s), NULL, semGIVE_BLOCK_TIME, queueSEND_TO_BACK)
#define xSemaphoreGiveRecursive(s)      xQueueGiveMutexRecursive((s))
#define xSemaphoreGiveFromISR(s, w)     xQueueGiveFromISR((s), (w))
#define vSemaphoreDelete(s)             vQueueDelete((QueueHandle_t)(s))
#define xSemaphoreGetMutexHolder(s)     ((TaskHandle_t)xQueueGetMutexHolder((s)))
#define xSemaphoreGetMutexHolderFromISR(s) ((TaskHandle_t)xQueueGetMutexHolder((s)))
#define uxSemaphoreGetCount(s)          uxQueueMessagesWaiting((s))
#define uxSemaphoreGetCountFromISR(s)   uxQueueMessagesWaiting((s))
#endif
