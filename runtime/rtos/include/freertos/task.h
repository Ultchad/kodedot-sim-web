/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef DOTBENCH_FREERTOS_TASK_H
#define DOTBENCH_FREERTOS_TASK_H
#include "freertos/FreeRTOS.h"
#ifdef __cplusplus
extern "C" {
#endif

#define taskSCHEDULER_SUSPENDED   ((BaseType_t)0)
#define taskSCHEDULER_NOT_STARTED ((BaseType_t)1)
#define taskSCHEDULER_RUNNING     ((BaseType_t)2)

typedef enum { eRunning = 0, eReady, eBlocked, eSuspended, eDeleted, eInvalid } eTaskState;
typedef enum { eNoAction = 0, eSetBits, eIncrement, eSetValueWithOverwrite, eSetValueWithoutOverwrite } eNotifyAction;

typedef struct xTASK_STATUS {
    TaskHandle_t   xHandle;
    const char    *pcTaskName;
    UBaseType_t    xTaskNumber;
    eTaskState     eCurrentState;
    UBaseType_t    uxCurrentPriority;
    UBaseType_t    uxBasePriority;
    uint32_t       ulRunTimeCounter;
    StackType_t   *pxStackBase;
    uint32_t       usStackHighWaterMark;
    BaseType_t     xCoreID;
} TaskStatus_t;

typedef void (*TlsDeleteCallbackFunction_t)(int, void *);

/* creation / deletion */
BaseType_t xTaskCreate(TaskFunction_t fn, const char *name, uint32_t stackDepth, void *arg,
                       UBaseType_t prio, TaskHandle_t *out);
BaseType_t xTaskCreatePinnedToCore(TaskFunction_t fn, const char *name, uint32_t stackDepth, void *arg,
                                   UBaseType_t prio, TaskHandle_t *out, BaseType_t core);
TaskHandle_t xTaskCreateStatic(TaskFunction_t fn, const char *name, uint32_t stackDepth, void *arg,
                               UBaseType_t prio, StackType_t *stack, StaticTask_t *tcb);
TaskHandle_t xTaskCreateStaticPinnedToCore(TaskFunction_t fn, const char *name, uint32_t stackDepth,
                                           void *arg, UBaseType_t prio, StackType_t *stack,
                                           StaticTask_t *tcb, BaseType_t core);
void vTaskDelete(TaskHandle_t t);

/* delay */
void vTaskDelay(TickType_t ticks);
BaseType_t xTaskDelayUntil(TickType_t *prevWake, TickType_t inc);
void vTaskDelayUntil(TickType_t *prevWake, TickType_t inc);

/* scheduler */
void vTaskStartScheduler(void);
void vTaskSuspendAll(void);
BaseType_t xTaskResumeAll(void);
BaseType_t xTaskGetSchedulerState(void);
TickType_t xTaskGetTickCount(void);
TickType_t xTaskGetTickCountFromISR(void);
UBaseType_t uxTaskGetNumberOfTasks(void);
#define taskYIELD() vPortYield()

/* task control */
void vTaskSuspend(TaskHandle_t t);
void vTaskResume(TaskHandle_t t);
BaseType_t xTaskResumeFromISR(TaskHandle_t t);
UBaseType_t uxTaskPriorityGet(const TaskHandle_t t);
void vTaskPrioritySet(TaskHandle_t t, UBaseType_t prio);
eTaskState eTaskGetState(TaskHandle_t t);
TaskHandle_t xTaskGetCurrentTaskHandle(void);
TaskHandle_t xTaskGetIdleTaskHandle(void);
TaskHandle_t xTaskGetHandle(const char *name);
char *pcTaskGetName(TaskHandle_t t);
UBaseType_t uxTaskGetStackHighWaterMark(TaskHandle_t t);
uint32_t uxTaskGetStackHighWaterMark2(TaskHandle_t t);
UBaseType_t uxTaskGetSystemState(TaskStatus_t *arr, UBaseType_t size, uint32_t *totalRunTime);
BaseType_t xTaskGetCoreID(TaskHandle_t t);
BaseType_t xTaskGetAffinity(TaskHandle_t t);

/* thread local storage */
void vTaskSetThreadLocalStoragePointer(TaskHandle_t t, BaseType_t idx, void *p);
void *pvTaskGetThreadLocalStoragePointer(TaskHandle_t t, BaseType_t idx);
void vTaskSetThreadLocalStoragePointerAndDelCallback(TaskHandle_t t, BaseType_t idx, void *p,
                                                      TlsDeleteCallbackFunction_t cb);

/* notifications (index 0 only is used by the SDK; indexed forms provided) */
BaseType_t xTaskGenericNotify(TaskHandle_t t, UBaseType_t idx, uint32_t value, eNotifyAction act,
                              uint32_t *prev);
BaseType_t xTaskGenericNotifyFromISR(TaskHandle_t t, UBaseType_t idx, uint32_t value,
                                     eNotifyAction act, uint32_t *prev, BaseType_t *woken);
BaseType_t xTaskGenericNotifyWait(UBaseType_t idx, uint32_t clearEntry, uint32_t clearExit,
                                  uint32_t *value, TickType_t ticks);
uint32_t ulTaskGenericNotifyTake(UBaseType_t idx, BaseType_t clearCount, TickType_t ticks);
BaseType_t xTaskGenericNotifyStateClear(TaskHandle_t t, UBaseType_t idx);
void vTaskGenericNotifyGiveFromISR(TaskHandle_t t, UBaseType_t idx, BaseType_t *woken);

#define tskDEFAULT_INDEX_TO_NOTIFY 0
#define xTaskNotify(t, v, a)            xTaskGenericNotify((t), 0, (v), (a), NULL)
#define xTaskNotifyAndQuery(t, v, a, p) xTaskGenericNotify((t), 0, (v), (a), (p))
#define xTaskNotifyGive(t)              xTaskGenericNotify((t), 0, 0, eIncrement, NULL)
#define xTaskNotifyFromISR(t, v, a, w)  xTaskGenericNotifyFromISR((t), 0, (v), (a), NULL, (w))
#define vTaskNotifyGiveFromISR(t, w)    vTaskGenericNotifyGiveFromISR((t), 0, (w))
#define xTaskNotifyWait(ce, cx, v, tk)  xTaskGenericNotifyWait(0, (ce), (cx), (v), (tk))
#define ulTaskNotifyTake(c, tk)         ulTaskGenericNotifyTake(0, (c), (tk))
#define xTaskNotifyStateClear(t)        xTaskGenericNotifyStateClear((t), 0)
#define xTaskNotifyIndexed(t, i, v, a)  xTaskGenericNotify((t), (i), (v), (a), NULL)
#define xTaskNotifyGiveIndexed(t, i)    xTaskGenericNotify((t), (i), 0, eIncrement, NULL)
#define ulTaskNotifyTakeIndexed(i, c, tk) ulTaskGenericNotifyTake((i), (c), (tk))
#define xTaskNotifyWaitIndexed(i, ce, cx, v, tk) xTaskGenericNotifyWait((i), (ce), (cx), (v), (tk))

#ifdef __cplusplus
}
#endif
#endif
