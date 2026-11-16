/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * dotbench RTOS layer: a FreeRTOS-compatible API (ESP-IDF flavour) on top of
 * Emscripten pthreads. One task = one pthread. See runtime/rtos/README.md.
 */
#ifndef DOTBENCH_FREERTOS_H
#define DOTBENCH_FREERTOS_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <string.h>
#include "sdkconfig.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ---- configuration ----------------------------------------------------- */
#ifndef CONFIG_FREERTOS_HZ
#define CONFIG_FREERTOS_HZ 1000
#endif
#define configTICK_RATE_HZ                       ((TickType_t)CONFIG_FREERTOS_HZ)
#define configMAX_PRIORITIES                     (25)
#define configMINIMAL_STACK_SIZE                 (768)
#define configSUPPORT_STATIC_ALLOCATION          1
#define configSUPPORT_DYNAMIC_ALLOCATION         1
#define configNUM_THREAD_LOCAL_STORAGE_POINTERS  2
#define configUSE_MUTEXES                        1
#define configUSE_RECURSIVE_MUTEXES              1
#define configUSE_COUNTING_SEMAPHORES            1
#define configUSE_TASK_NOTIFICATIONS             1
#define configUSE_TIMERS                         1
#define configUSE_TRACE_FACILITY                 1
#define configUSE_IDLE_HOOK                      0
#define configUSE_TICK_HOOK                      0
#define configCHECK_FOR_STACK_OVERFLOW           0
#define configTASK_NOTIFICATION_ARRAY_ENTRIES    1
#define configTIMER_TASK_PRIORITY                (configMAX_PRIORITIES - 1)
#define configTIMER_QUEUE_LENGTH                 10
#define configTIMER_TASK_STACK_DEPTH             2048
#define configMAX_TASK_NAME_LEN                  (16)

#define tskIDLE_PRIORITY                         ((UBaseType_t)0U)
#define tskNO_AFFINITY                           ((BaseType_t)0x7FFFFFFF)
#define portNUM_PROCESSORS                       1
#define portNO_AFFINITY                          tskNO_AFFINITY

/* ---- base types (ESP-IDF RISC-V flavour) ------------------------------- */
typedef int32_t  BaseType_t;
typedef uint32_t UBaseType_t;
typedef uint32_t TickType_t;
/* ESP-IDF counts stack depths in bytes (StackType_t is uint8_t). */
#define portSTACK_TYPE   uint8_t
typedef portSTACK_TYPE StackType_t;
#define portBASE_TYPE    int32_t
#define portCHAR         char
#define portPOINTER_SIZE_TYPE uintptr_t

#define pdFALSE          ((BaseType_t)0)
#define pdTRUE           ((BaseType_t)1)
#define pdPASS           (pdTRUE)
#define pdFAIL           (pdFALSE)
#define errQUEUE_EMPTY   ((BaseType_t)0)
#define errQUEUE_FULL    ((BaseType_t)0)
#define errCOULD_NOT_ALLOCATE_REQUIRED_MEMORY (-1)
#define errQUEUE_BLOCKED (-4)
#define errQUEUE_YIELD   (-5)

#define portMAX_DELAY            ((TickType_t)0xffffffffUL)
#define portTICK_PERIOD_MS       ((TickType_t)(1000 / CONFIG_FREERTOS_HZ))
#define pdMS_TO_TICKS(ms)        ((TickType_t)(((uint64_t)(ms) * (uint64_t)configTICK_RATE_HZ) / 1000ULL))
#define pdTICKS_TO_MS(t)         ((uint32_t)(((uint64_t)(t) * 1000ULL) / (uint64_t)configTICK_RATE_HZ))
#define pdUS_TO_TICKS(us)        ((TickType_t)(((uint64_t)(us) * (uint64_t)configTICK_RATE_HZ) / 1000000ULL))

#define pdMEM_ALIGNMENT          8

typedef void (*TaskFunction_t)(void *);
typedef void (*TimerCallbackFunction_t)(void *xTimer);

/* ---- static allocation carriers ---------------------------------------
 * The QP port reaches into two of them (qf_port.c, "FREERTOS_QUEUE_GET_FREE"
 * reads uxDummy4[0] = messages waiting and uxDummy4[1] = length; and it stores
 * the task name in task.pxDummy1 before xTaskCreateStatic). The layouts below
 * keep exactly those fields in those places; the rest is opaque space for the
 * implementation's own state (checked by _Static_assert in rtos.c). */
typedef struct xSTATIC_TCB {
    void     *pxDummy1;
    uint64_t  opaque[24];
} StaticTask_t;

typedef struct xSTATIC_QUEUE {
    UBaseType_t uxDummy4[3];      /* [0]=waiting, [1]=length, [2]=item size */
    uint64_t    opaque[40];
} StaticQueue_t;
typedef StaticQueue_t StaticSemaphore_t;

typedef struct xSTATIC_EVENT_GROUP {
    uint64_t opaque[16];
} StaticEventGroup_t;

typedef struct xSTATIC_TIMER {
    uint64_t opaque[24];
} StaticTimer_t;

typedef struct tskTaskControlBlock *TaskHandle_t;
typedef struct QueueDefinition     *QueueHandle_t;
typedef struct QueueDefinition     *QueueSetHandle_t;
typedef struct QueueDefinition     *SemaphoreHandle_t;
typedef struct EventGroupDef_t     *EventGroupHandle_t;
typedef struct tmrTimerControl     *TimerHandle_t;
typedef uint32_t EventBits_t;

/* ---- ports: critical sections ------------------------------------------
 * ESP-IDF's SMP kernel takes a spinlock argument. Here the argument is kept
 * (so every call site compiles unchanged) but ALL critical sections are one
 * global recursive mutex; see rtos.c. */
typedef struct {
    uint32_t owner;
    uint32_t count;
} portMUX_TYPE;
#define portMUX_FREE_VAL         0xB33FFFFFu
#define portMUX_INITIALIZER_UNLOCKED { .owner = portMUX_FREE_VAL, .count = 0 }
#define portMUX_NO_TIMEOUT       (-1)
#define portMUX_TRY_LOCK         0

void vPortEnterCritical(portMUX_TYPE *mux);
void vPortExitCritical(portMUX_TYPE *mux);
static inline void vPortCPUInitializeMutex(portMUX_TYPE *mux) { mux->owner = portMUX_FREE_VAL; mux->count = 0; }
#define portMUX_INITIALIZE(m)    vPortCPUInitializeMutex(m)

#define portENTER_CRITICAL(m)          vPortEnterCritical(m)
#define portEXIT_CRITICAL(m)           vPortExitCritical(m)
#define portENTER_CRITICAL_ISR(m)      vPortEnterCritical(m)
#define portEXIT_CRITICAL_ISR(m)       vPortExitCritical(m)
#define portENTER_CRITICAL_SAFE(m)     vPortEnterCritical(m)
#define portEXIT_CRITICAL_SAFE(m)      vPortExitCritical(m)
#define portENTER_CRITICAL_NESTED()    ({ vPortEnterCritical(NULL); (UBaseType_t)0; })
#define portEXIT_CRITICAL_NESTED(s)    do { (void)(s); vPortExitCritical(NULL); } while (0)
#define portSET_INTERRUPT_MASK_FROM_ISR()   ({ vPortEnterCritical(NULL); (UBaseType_t)0; })
#define portCLEAR_INTERRUPT_MASK_FROM_ISR(s) do { (void)(s); vPortExitCritical(NULL); } while (0)

#define taskENTER_CRITICAL(m)          portENTER_CRITICAL(m)
#define taskEXIT_CRITICAL(m)           portEXIT_CRITICAL(m)
#define taskENTER_CRITICAL_ISR(m)      portENTER_CRITICAL_ISR(m)
#define taskEXIT_CRITICAL_ISR(m)       portEXIT_CRITICAL_ISR(m)
#define taskENTER_CRITICAL_SAFE(m)     portENTER_CRITICAL_SAFE(m)
#define taskEXIT_CRITICAL_SAFE(m)      portEXIT_CRITICAL_SAFE(m)
#define taskENTER_CRITICAL_FROM_ISR()  portSET_INTERRUPT_MASK_FROM_ISR()
#define taskEXIT_CRITICAL_FROM_ISR(s)  portCLEAR_INTERRUPT_MASK_FROM_ISR(s)
/* "Disable interrupts" is the same global lock, so the pair stays balanced. */
#define portDISABLE_INTERRUPTS()       vPortEnterCritical(NULL)
#define portENABLE_INTERRUPTS()        vPortExitCritical(NULL)
#define taskDISABLE_INTERRUPTS()       portDISABLE_INTERRUPTS()
#define taskENABLE_INTERRUPTS()        portENABLE_INTERRUPTS()

/* There is no interrupt context in the browser: everything is a task. */
BaseType_t xPortCanYield(void);
BaseType_t xPortInIsrContext(void);
BaseType_t xPortInterruptedFromISRContext(void);
void vPortYield(void);
#define portYIELD()                    vPortYield()
#define portYIELD_WITHIN_API()         vPortYield()
#define portYIELD_FROM_ISR(...)        ((void)0)
#define portYIELD_FROM_ISR_NO_ARG()    ((void)0)
#define portASSERT_IF_IN_ISR()         ((void)0)
#define portGET_CORE_ID()              0
#define xPortGetCoreID()               0
#define portTICK_TYPE_IS_ATOMIC        1

#define configASSERT(x)                ((void)(x))

#define pdFREERTOS_ERRNO_NONE 0

#ifdef __cplusplus
}
#endif
#endif /* DOTBENCH_FREERTOS_H */
