/* SPDX-License-Identifier: GPL-3.0-or-later
 *
 * dotbench RTOS layer: FreeRTOS (ESP-IDF flavour) API on Emscripten pthreads.
 *
 * Model
 *   - one task = one detached pthread (a Web Worker in the browser);
 *   - one global recursive mutex (g_crit) backs every taskENTER_CRITICAL();
 *   - one kernel mutex (g_k) protects every queue/semaphore/event-group/task
 *     notification state; each object owns one condition variable. Blocking
 *     calls wait on the object's condvar with a monotonic deadline;
 *   - priorities are recorded and reported but not honoured;
 *   - the tick count is derived from the monotonic clock (no tick thread):
 *     xTaskGetTickCount() = elapsed_us * CONFIG_FREERTOS_HZ / 1e6.
 *
 * Deviations from the real kernel are listed in runtime/rtos/README.md.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <pthread.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/event_groups.h"
#include "freertos/timers.h"
#include "freertos/idf_additions.h"

/* ======================================================================== */
/* Clock                                                                     */
/* ======================================================================== */
static uint64_t mono_us(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000ULL + (uint64_t)ts.tv_nsec / 1000ULL;
}

static uint64_t g_t0_us;
static pthread_once_t g_once = PTHREAD_ONCE_INIT;
static void init_once(void) { g_t0_us = mono_us(); }
static void ensure_init(void) { pthread_once(&g_once, init_once); }

static uint64_t ticks_to_us(TickType_t t)
{
    return (uint64_t)t * 1000000ULL / (uint64_t)configTICK_RATE_HZ;
}

TickType_t xTaskGetTickCount(void)
{
    ensure_init();
    return (TickType_t)(((mono_us() - g_t0_us) * (uint64_t)configTICK_RATE_HZ) / 1000000ULL);
}
TickType_t xTaskGetTickCountFromISR(void) { return xTaskGetTickCount(); }

/* ======================================================================== */
/* Locks                                                                     */
/* ======================================================================== */
static pthread_mutex_t g_k;      /* kernel state (recursive: a thread may be adopted while waiting) */
static pthread_mutex_t g_crit;   /* critical sections */
static pthread_mutex_t g_sched;  /* vTaskSuspendAll */

static void recursive_mutex_init(pthread_mutex_t *m)
{
    pthread_mutexattr_t a;
    pthread_mutexattr_init(&a);
    pthread_mutexattr_settype(&a, PTHREAD_MUTEX_RECURSIVE);
    pthread_mutex_init(m, &a);
    pthread_mutexattr_destroy(&a);
}
/* Runs before every other constructor, so even static initialisers elsewhere may call in. */
__attribute__((constructor(101))) static void rtos_locks_init(void)
{
    recursive_mutex_init(&g_k);
    recursive_mutex_init(&g_crit);
    recursive_mutex_init(&g_sched);
}

void vPortEnterCritical(portMUX_TYPE *mux) { (void)mux; pthread_mutex_lock(&g_crit); }
void vPortExitCritical(portMUX_TYPE *mux)  { (void)mux; pthread_mutex_unlock(&g_crit); }
BaseType_t xPortCanYield(void)                  { return pdTRUE; }
BaseType_t xPortInIsrContext(void)              { return pdFALSE; }
BaseType_t xPortInterruptedFromISRContext(void) { return pdFALSE; }
void vPortYield(void) { sched_yield(); }

static void cond_init(pthread_cond_t *c)
{
    pthread_condattr_t a;
    pthread_condattr_init(&a);
    pthread_condattr_setclock(&a, CLOCK_MONOTONIC);
    pthread_cond_init(c, &a);
    pthread_condattr_destroy(&a);
}

/* ======================================================================== */
/* Tasks                                                                     */
/* ======================================================================== */
typedef struct tskTaskControlBlock {
    void              *reserved;           /* StaticTask_t.pxDummy1 (the QP port's name slot) */
    struct tskTaskControlBlock *next;
    pthread_t          th;
    char               name[configMAX_TASK_NAME_LEN];
    TaskFunction_t     fn;
    void              *arg;
    UBaseType_t        prio;
    uint32_t           stack_bytes;
    pthread_cond_t     cv;                 /* notifications, delay, suspend */
    pthread_cond_t    *blocked_on;         /* condvar this task waits on (for delete) */
    uint32_t           notify_val;
    uint8_t            notify_pending;
    uint8_t            suspended;
    uint8_t            kill;
    uint8_t            dynamic;            /* tcb came from calloc */
    uint8_t            adopted;            /* thread not created by xTaskCreate */
    uint8_t            started;
    uint32_t           id;
    void              *tls[configNUM_THREAD_LOCAL_STORAGE_POINTERS];
    TlsDeleteCallbackFunction_t tls_cb[configNUM_THREAD_LOCAL_STORAGE_POINTERS];
    int                suspend_all_depth;
} tcb_t;

_Static_assert(sizeof(tcb_t) <= sizeof(StaticTask_t), "StaticTask_t too small for tcb_t");

static tcb_t *g_tasks;       /* list head, under g_k */
static uint32_t g_task_count;
static uint32_t g_next_id = 1;
static __thread tcb_t *t_self;

static void task_link(tcb_t *t)
{
    pthread_mutex_lock(&g_k);
    t->next = g_tasks;
    g_tasks = t;
    t->id = g_next_id++;
    g_task_count++;
    pthread_mutex_unlock(&g_k);
}

static void task_unlink(tcb_t *t)
{
    pthread_mutex_lock(&g_k);
    for (tcb_t **pp = &g_tasks; *pp != NULL; pp = &(*pp)->next) {
        if (*pp == t) { *pp = t->next; g_task_count--; break; }
    }
    pthread_mutex_unlock(&g_k);
}

static tcb_t *self(void)
{
    if (t_self == NULL) {
        /* A thread FreeRTOS did not create: the proxied main thread, the
         * browser main thread, the esp_timer thread. Adopt it. */
        tcb_t *t = calloc(1, sizeof(*t));
        t->adopted = 1;
        t->dynamic = 1;
        t->th = pthread_self();
        t->prio = 1;
        snprintf(t->name, sizeof(t->name), "ext%u", (unsigned)g_next_id);
        cond_init(&t->cv);
        task_link(t);
        t_self = t;
    }
    return t_self;
}

static void run_tls_callbacks(tcb_t *t)
{
    for (int i = 0; i < configNUM_THREAD_LOCAL_STORAGE_POINTERS; i++) {
        if (t->tls_cb[i] != NULL && t->tls[i] != NULL) {
            TlsDeleteCallbackFunction_t cb = t->tls_cb[i];
            void *p = t->tls[i];
            t->tls_cb[i] = NULL;
            cb(i, p);
        }
    }
}

static void task_exit(tcb_t *t)
{
    run_tls_callbacks(t);
    task_unlink(t);
    pthread_cond_destroy(&t->cv);
    if (t->dynamic) {
        free(t);
    }
    pthread_exit(NULL);
}

/* Called with g_k held, after a wait returned: honour a pending delete. */
static void check_kill_locked(tcb_t *t)
{
    if (t->kill) {
        pthread_mutex_unlock(&g_k);
        task_exit(t);
    }
}

/* Wait on `cv` (g_k held) until signalled or until deadline_us (0 = forever).
 * Returns true if the deadline passed. */
static bool wait_locked(pthread_cond_t *cv, uint64_t deadline_us)
{
    tcb_t *t = self();
    bool timed_out = false;
    t->blocked_on = cv;
    if (deadline_us == 0) {
        pthread_cond_wait(cv, &g_k);
    } else {
        struct timespec ts;
        ts.tv_sec = (time_t)(deadline_us / 1000000ULL);
        ts.tv_nsec = (long)((deadline_us % 1000000ULL) * 1000ULL);
        timed_out = (pthread_cond_timedwait(cv, &g_k, &ts) == ETIMEDOUT);
    }
    t->blocked_on = NULL;
    check_kill_locked(t);
    return timed_out;
}

/* ticks -> absolute deadline; returns 0 for "forever". `poll` set when ticks==0. */
static uint64_t deadline_of(TickType_t ticks, bool *poll)
{
    *poll = (ticks == 0);
    if (ticks == portMAX_DELAY) {
        return 0;
    }
    uint64_t d = mono_us() + ticks_to_us(ticks);
    return d == 0 ? 1 : d;
}

static void *task_entry(void *p)
{
    tcb_t *t = (tcb_t *)p;
    t_self = t;
    t->started = 1;
    pthread_mutex_lock(&g_k);
    bool killed = t->kill;
    pthread_mutex_unlock(&g_k);
    if (!killed) {
        t->fn(t->arg);
    }
    /* A FreeRTOS task must not return; ESP-IDF treats it as a delete. */
    task_exit(t);
    return NULL;
}

static BaseType_t task_start(tcb_t *t, uint32_t stackDepth)
{
    pthread_attr_t a;
    pthread_attr_init(&a);
    /* Stack depth is in bytes (StackType_t is uint8_t). WebAssembly frames are
     * bulkier than RISC-V ones and LVGL renders on an AO stack: give 4x, 64 KB min. */
    uint32_t sz = stackDepth * 4U;
    if (sz < 65536U) sz = 65536U;
    t->stack_bytes = stackDepth;
    pthread_attr_setstacksize(&a, sz);
    pthread_attr_setdetachstate(&a, PTHREAD_CREATE_DETACHED);
    int rc = pthread_create(&t->th, &a, task_entry, t);
    pthread_attr_destroy(&a);
    return rc == 0 ? pdPASS : pdFAIL;
}

static tcb_t *tcb_init(tcb_t *t, const char *name, void *arg, TaskFunction_t fn, UBaseType_t prio)
{
    memset(t, 0, sizeof(*t));
    strncpy(t->name, name ? name : "task", sizeof(t->name) - 1);
    t->fn = fn;
    t->arg = arg;
    t->prio = prio;
    cond_init(&t->cv);
    return t;
}

BaseType_t xTaskCreatePinnedToCore(TaskFunction_t fn, const char *name, uint32_t stackDepth, void *arg,
                                   UBaseType_t prio, TaskHandle_t *out, BaseType_t core)
{
    (void)core;
    ensure_init();
    tcb_t *t = calloc(1, sizeof(*t));
    if (t == NULL) return errCOULD_NOT_ALLOCATE_REQUIRED_MEMORY;
    tcb_init(t, name, arg, fn, prio);
    t->dynamic = 1;
    task_link(t);
    if (out != NULL) *out = t;
    if (task_start(t, stackDepth) != pdPASS) {
        task_unlink(t);
        pthread_cond_destroy(&t->cv);
        free(t);
        if (out != NULL) *out = NULL;
        return errCOULD_NOT_ALLOCATE_REQUIRED_MEMORY;
    }
    return pdPASS;
}

BaseType_t xTaskCreate(TaskFunction_t fn, const char *name, uint32_t stackDepth, void *arg,
                       UBaseType_t prio, TaskHandle_t *out)
{
    return xTaskCreatePinnedToCore(fn, name, stackDepth, arg, prio, out, tskNO_AFFINITY);
}

TaskHandle_t xTaskCreateStaticPinnedToCore(TaskFunction_t fn, const char *name, uint32_t stackDepth,
                                           void *arg, UBaseType_t prio, StackType_t *stack,
                                           StaticTask_t *buf, BaseType_t core)
{
    (void)core; (void)stack; /* the pthread owns its own stack */
    ensure_init();
    if (buf == NULL) return NULL;
    tcb_t *t = (tcb_t *)buf;
    /* the QP port parks the task name in pxDummy1 before creating: honour it */
    const char *nm = (name != NULL) ? name : (const char *)buf->pxDummy1;
    tcb_init(t, nm, arg, fn, prio);
    task_link(t);
    if (task_start(t, stackDepth) != pdPASS) {
        task_unlink(t);
        return NULL;
    }
    return t;
}

TaskHandle_t xTaskCreateStatic(TaskFunction_t fn, const char *name, uint32_t stackDepth, void *arg,
                               UBaseType_t prio, StackType_t *stack, StaticTask_t *buf)
{
    return xTaskCreateStaticPinnedToCore(fn, name, stackDepth, arg, prio, stack, buf, tskNO_AFFINITY);
}

BaseType_t xTaskCreatePinnedToCoreWithCaps(TaskFunction_t fn, const char *name, uint32_t stackDepth,
                                           void *arg, UBaseType_t prio, TaskHandle_t *out,
                                           BaseType_t core, uint32_t caps)
{
    (void)caps;
    return xTaskCreatePinnedToCore(fn, name, stackDepth, arg, prio, out, core);
}

void vTaskDelete(TaskHandle_t h)
{
    tcb_t *me = self();
    tcb_t *t = (h == NULL) ? me : (tcb_t *)h;
    if (t == me) {
        task_exit(me);
        return;
    }
    pthread_mutex_lock(&g_k);
    t->kill = 1;
    if (t->blocked_on != NULL) pthread_cond_broadcast(t->blocked_on);
    pthread_cond_broadcast(&t->cv);
    pthread_mutex_unlock(&g_k);
}
void vTaskDeleteWithCaps(TaskHandle_t h) { vTaskDelete(h); }

/* ---- delay -------------------------------------------------------------- */
void vTaskDelay(TickType_t ticks)
{
    if (ticks == 0) { sched_yield(); return; }
    tcb_t *t = self();
    uint64_t deadline = mono_us() + ticks_to_us(ticks);
    pthread_mutex_lock(&g_k);
    for (;;) {
        if (mono_us() >= deadline) break;
        if (wait_locked(&t->cv, deadline)) break;
    }
    pthread_mutex_unlock(&g_k);
}

BaseType_t xTaskDelayUntil(TickType_t *prev, TickType_t inc)
{
    TickType_t now = xTaskGetTickCount();
    TickType_t next = *prev + inc;
    bool delay;
    if (now < *prev) { /* tick counter wrapped since *prev was taken */
        delay = (next < *prev) && (next > now);
    } else {
        delay = (next < *prev) || (next > now);
    }
    *prev = next;
    if (delay) {
        vTaskDelay(next - now);
    }
    return delay ? pdTRUE : pdFALSE;
}
void vTaskDelayUntil(TickType_t *prev, TickType_t inc) { (void)xTaskDelayUntil(prev, inc); }

/* ---- scheduler ----------------------------------------------------------- */
void vTaskStartScheduler(void)
{
    /* The "scheduler" is the browser's: already running. The real call never returns. */
    for (;;) { sleep(3600); }
}
void vTaskSuspendAll(void)
{
    pthread_mutex_lock(&g_sched);
}
BaseType_t xTaskResumeAll(void)
{
    pthread_mutex_unlock(&g_sched);
    return pdFALSE;
}
BaseType_t xTaskGetSchedulerState(void) { return taskSCHEDULER_RUNNING; }
UBaseType_t uxTaskGetNumberOfTasks(void)
{
    pthread_mutex_lock(&g_k);
    UBaseType_t n = g_task_count;
    pthread_mutex_unlock(&g_k);
    return n;
}

/* ---- suspend / resume ---------------------------------------------------- */
void vTaskSuspend(TaskHandle_t h)
{
    tcb_t *me = self();
    tcb_t *t = (h == NULL) ? me : (tcb_t *)h;
    pthread_mutex_lock(&g_k);
    t->suspended = 1;
    if (t == me) {
        while (t->suspended) wait_locked(&t->cv, 0);
    }
    /* Another task is only flagged: it parks at its next blocking call. A busy
     * pthread cannot be stopped from outside (documented deviation). */
    pthread_mutex_unlock(&g_k);
}
void vTaskResume(TaskHandle_t h)
{
    tcb_t *t = (tcb_t *)h;
    if (t == NULL) return;
    pthread_mutex_lock(&g_k);
    t->suspended = 0;
    pthread_cond_broadcast(&t->cv);
    pthread_mutex_unlock(&g_k);
}
BaseType_t xTaskResumeFromISR(TaskHandle_t h) { vTaskResume(h); return pdFALSE; }

/* ---- attributes ---------------------------------------------------------- */
UBaseType_t uxTaskPriorityGet(const TaskHandle_t h)
{
    tcb_t *t = h ? (tcb_t *)h : self();
    return t->prio;
}
void vTaskPrioritySet(TaskHandle_t h, UBaseType_t prio)
{
    tcb_t *t = h ? (tcb_t *)h : self();
    t->prio = prio;
}
eTaskState eTaskGetState(TaskHandle_t h)
{
    tcb_t *t = (tcb_t *)h;
    if (t == self()) return eRunning;
    return t->suspended ? eSuspended : eBlocked;
}
TaskHandle_t xTaskGetCurrentTaskHandle(void) { return self(); }
TaskHandle_t xTaskGetIdleTaskHandle(void) { return NULL; }
TaskHandle_t xTaskGetHandle(const char *name)
{
    TaskHandle_t found = NULL;
    pthread_mutex_lock(&g_k);
    for (tcb_t *t = g_tasks; t != NULL; t = t->next) {
        if (strncmp(t->name, name, sizeof(t->name)) == 0) { found = t; break; }
    }
    pthread_mutex_unlock(&g_k);
    return found;
}
char *pcTaskGetName(TaskHandle_t h)
{
    tcb_t *t = h ? (tcb_t *)h : self();
    return t->name;
}
/* The pthread's stack use is not observable: report the whole requested stack as free. */
UBaseType_t uxTaskGetStackHighWaterMark(TaskHandle_t h)
{
    tcb_t *t = h ? (tcb_t *)h : self();
    return t->stack_bytes ? t->stack_bytes : 4096U;
}
uint32_t uxTaskGetStackHighWaterMark2(TaskHandle_t h) { return uxTaskGetStackHighWaterMark(h); }
BaseType_t xTaskGetCoreID(TaskHandle_t h) { (void)h; return 0; }
BaseType_t xTaskGetAffinity(TaskHandle_t h) { (void)h; return 0; }

UBaseType_t uxTaskGetSystemState(TaskStatus_t *arr, UBaseType_t size, uint32_t *total)
{
    UBaseType_t n = 0;
    pthread_mutex_lock(&g_k);
    for (tcb_t *t = g_tasks; t != NULL && n < size; t = t->next) {
        TaskStatus_t *s = &arr[n++];
        memset(s, 0, sizeof(*s));
        s->xHandle = t;
        s->pcTaskName = t->name;
        s->xTaskNumber = t->id;
        s->eCurrentState = t->suspended ? eSuspended : eBlocked;
        s->uxCurrentPriority = t->prio;
        s->uxBasePriority = t->prio;
        s->usStackHighWaterMark = t->stack_bytes;
    }
    pthread_mutex_unlock(&g_k);
    if (total != NULL) *total = 0;
    return n;
}

/* ---- thread local storage ------------------------------------------------- */
void vTaskSetThreadLocalStoragePointer(TaskHandle_t h, BaseType_t idx, void *p)
{
    tcb_t *t = h ? (tcb_t *)h : self();
    if (idx >= 0 && idx < configNUM_THREAD_LOCAL_STORAGE_POINTERS) { t->tls[idx] = p; t->tls_cb[idx] = NULL; }
}
void *pvTaskGetThreadLocalStoragePointer(TaskHandle_t h, BaseType_t idx)
{
    tcb_t *t = h ? (tcb_t *)h : self();
    return (idx >= 0 && idx < configNUM_THREAD_LOCAL_STORAGE_POINTERS) ? t->tls[idx] : NULL;
}
void vTaskSetThreadLocalStoragePointerAndDelCallback(TaskHandle_t h, BaseType_t idx, void *p,
                                                      TlsDeleteCallbackFunction_t cb)
{
    tcb_t *t = h ? (tcb_t *)h : self();
    if (idx >= 0 && idx < configNUM_THREAD_LOCAL_STORAGE_POINTERS) { t->tls[idx] = p; t->tls_cb[idx] = cb; }
}

/* ---- notifications -------------------------------------------------------- */
BaseType_t xTaskGenericNotify(TaskHandle_t h, UBaseType_t idx, uint32_t value, eNotifyAction act,
                              uint32_t *prev)
{
    tcb_t *t = h ? (tcb_t *)h : self();
    BaseType_t ok = pdPASS;
    if (idx != 0) return pdFAIL;
    pthread_mutex_lock(&g_k);
    if (prev != NULL) *prev = t->notify_val;
    switch (act) {
    case eSetBits:                 t->notify_val |= value; break;
    case eIncrement:               t->notify_val++; break;
    case eSetValueWithOverwrite:   t->notify_val = value; break;
    case eSetValueWithoutOverwrite:
        if (t->notify_pending) ok = pdFAIL; else t->notify_val = value;
        break;
    case eNoAction: default: break;
    }
    if (ok == pdPASS) {
        t->notify_pending = 1;
        pthread_cond_broadcast(&t->cv);
    }
    pthread_mutex_unlock(&g_k);
    return ok;
}
BaseType_t xTaskGenericNotifyFromISR(TaskHandle_t h, UBaseType_t idx, uint32_t value, eNotifyAction act,
                                     uint32_t *prev, BaseType_t *woken)
{
    if (woken != NULL) *woken = pdFALSE;
    return xTaskGenericNotify(h, idx, value, act, prev);
}
void vTaskGenericNotifyGiveFromISR(TaskHandle_t h, UBaseType_t idx, BaseType_t *woken)
{
    (void)xTaskGenericNotifyFromISR(h, idx, 0, eIncrement, NULL, woken);
}
BaseType_t xTaskGenericNotifyWait(UBaseType_t idx, uint32_t clearEntry, uint32_t clearExit,
                                  uint32_t *value, TickType_t ticks)
{
    tcb_t *t = self();
    bool poll;
    uint64_t dl = deadline_of(ticks, &poll);
    BaseType_t got = pdFALSE;
    if (idx != 0) return pdFAIL;
    pthread_mutex_lock(&g_k);
    if (!t->notify_pending) {
        t->notify_val &= ~clearEntry;
        while (!t->notify_pending && !poll) {
            if (wait_locked(&t->cv, dl)) break;
        }
    }
    if (t->notify_pending) {
        got = pdTRUE;
        if (value != NULL) *value = t->notify_val;
        t->notify_val &= ~clearExit;
        t->notify_pending = 0;
    }
    pthread_mutex_unlock(&g_k);
    return got;
}
uint32_t ulTaskGenericNotifyTake(UBaseType_t idx, BaseType_t clearCount, TickType_t ticks)
{
    tcb_t *t = self();
    bool poll;
    uint64_t dl = deadline_of(ticks, &poll);
    uint32_t ret = 0;
    if (idx != 0) return 0;
    pthread_mutex_lock(&g_k);
    while (t->notify_val == 0 && !poll) {
        if (wait_locked(&t->cv, dl)) break;
    }
    ret = t->notify_val;
    if (ret != 0) {
        t->notify_val = clearCount ? 0 : ret - 1;
    }
    t->notify_pending = 0;
    pthread_mutex_unlock(&g_k);
    return ret;
}
BaseType_t xTaskGenericNotifyStateClear(TaskHandle_t h, UBaseType_t idx)
{
    tcb_t *t = h ? (tcb_t *)h : self();
    BaseType_t was;
    if (idx != 0) return pdFAIL;
    pthread_mutex_lock(&g_k);
    was = t->notify_pending ? pdTRUE : pdFALSE;
    t->notify_pending = 0;
    pthread_mutex_unlock(&g_k);
    return was;
}

/* ======================================================================== */
/* Queues, semaphores, mutexes                                               */
/* ======================================================================== */
typedef struct QueueDefinition {
    UBaseType_t   waiting;      /* MUST stay first three: qf_port.c reads them */
    UBaseType_t   length;       /* through StaticQueue_t.uxDummy4[0..1]        */
    UBaseType_t   item_size;
    uint8_t       type;
    uint8_t       static_obj;   /* object memory is the caller's */
    uint8_t       storage_owned;/* item storage allocated by us */
    uint8_t      *buf;
    UBaseType_t   head;         /* index of next item to read  */
    UBaseType_t   tail;         /* index of next slot to write */
    pthread_cond_t cv;
    tcb_t        *holder;
    UBaseType_t   recursion;
} Queue_t;

_Static_assert(sizeof(Queue_t) <= sizeof(StaticQueue_t), "StaticQueue_t too small for Queue_t");

static Queue_t *queue_setup(Queue_t *q, UBaseType_t len, UBaseType_t item, uint8_t *storage, uint8_t type)
{
    memset(q, 0, sizeof(*q));
    q->length = len;
    q->item_size = item;
    q->type = type;
    q->buf = storage;
    cond_init(&q->cv);
    return q;
}

QueueHandle_t xQueueGenericCreate(UBaseType_t len, UBaseType_t item, uint8_t type)
{
    if (len == 0) return NULL;
    Queue_t *q = calloc(1, sizeof(*q));
    if (q == NULL) return NULL;
    uint8_t *st = NULL;
    if (item > 0) {
        st = calloc(len, item);
        if (st == NULL) { free(q); return NULL; }
    }
    queue_setup(q, len, item, st, type);
    q->storage_owned = (st != NULL);
    return q;
}

QueueHandle_t xQueueGenericCreateStatic(UBaseType_t len, UBaseType_t item, uint8_t *storage,
                                        StaticQueue_t *buf, uint8_t type)
{
    if (len == 0 || buf == NULL) return NULL;
    if (item > 0 && storage == NULL) return NULL;
    Queue_t *q = (Queue_t *)buf;
    queue_setup(q, len, item, storage, type);
    q->static_obj = 1;
    return q;
}

QueueHandle_t xQueueCreateWithCaps(UBaseType_t len, UBaseType_t item, uint32_t caps)
{
    (void)caps;
    return xQueueGenericCreate(len, item, queueQUEUE_TYPE_BASE);
}
void vQueueDeleteWithCaps(QueueHandle_t q) { vQueueDelete(q); }

QueueHandle_t xQueueCreateCountingSemaphore(UBaseType_t max, UBaseType_t initial)
{
    Queue_t *q = xQueueGenericCreate(max, 0, queueQUEUE_TYPE_COUNTING_SEMAPHORE);
    if (q != NULL) q->waiting = initial;
    return q;
}
QueueHandle_t xQueueCreateCountingSemaphoreStatic(UBaseType_t max, UBaseType_t initial, StaticQueue_t *buf)
{
    Queue_t *q = xQueueGenericCreateStatic(max, 0, NULL, buf, queueQUEUE_TYPE_COUNTING_SEMAPHORE);
    if (q != NULL) q->waiting = initial;
    return q;
}
QueueHandle_t xQueueCreateMutex(uint8_t type)
{
    Queue_t *q = xQueueGenericCreate(1, 0, type);
    if (q != NULL) q->waiting = 1; /* a mutex starts free */
    return q;
}
QueueHandle_t xQueueCreateMutexStatic(uint8_t type, StaticQueue_t *buf)
{
    Queue_t *q = xQueueGenericCreateStatic(1, 0, NULL, buf, type);
    if (q != NULL) q->waiting = 1;
    return q;
}

void vQueueDelete(QueueHandle_t h)
{
    Queue_t *q = h;
    if (q == NULL) return;
    pthread_cond_destroy(&q->cv);
    if (q->storage_owned) free(q->buf);
    if (!q->static_obj) free(q);
}

static bool is_sem(const Queue_t *q) { return q->item_size == 0; }

static void copy_in(Queue_t *q, const void *item, BaseType_t pos)
{
    if (q->item_size > 0 && item != NULL) {
        if (pos == queueSEND_TO_FRONT) {
            q->head = (q->head == 0) ? q->length - 1 : q->head - 1;
            memcpy(q->buf + (size_t)q->head * q->item_size, item, q->item_size);
        } else {
            memcpy(q->buf + (size_t)q->tail * q->item_size, item, q->item_size);
            q->tail = (q->tail + 1 == q->length) ? 0 : q->tail + 1;
        }
    }
    q->waiting++;
}

static void copy_out(Queue_t *q, void *item, bool peek)
{
    if (q->item_size > 0) {
        if (item != NULL) memcpy(item, q->buf + (size_t)q->head * q->item_size, q->item_size);
        if (!peek) q->head = (q->head + 1 == q->length) ? 0 : q->head + 1;
    }
    if (!peek) q->waiting--;
}

static BaseType_t send_common(Queue_t *q, const void *item, TickType_t ticks, BaseType_t pos, bool fromisr)
{
    bool poll;
    uint64_t dl = deadline_of(fromisr ? 0 : ticks, &poll);
    BaseType_t ok = pdFALSE;
    pthread_mutex_lock(&g_k);
    if (pos == queueOVERWRITE && q->length == 1) {
        if (q->waiting == 1) { q->waiting = 0; q->head = q->tail = 0; }
        copy_in(q, item, queueSEND_TO_BACK);
        ok = pdTRUE;
    } else {
        while (q->waiting >= q->length && !poll) {
            if (wait_locked(&q->cv, dl)) break;
        }
        if (q->waiting < q->length) {
            copy_in(q, item, pos);
            ok = pdTRUE;
        }
    }
    if (ok) pthread_cond_broadcast(&q->cv);
    pthread_mutex_unlock(&g_k);
    return ok;
}

BaseType_t xQueueGenericSend(QueueHandle_t h, const void *item, TickType_t ticks, BaseType_t pos)
{
    Queue_t *q = h;
    if (q == NULL) return pdFALSE;
    if (q->type == queueQUEUE_TYPE_MUTEX || q->type == queueQUEUE_TYPE_RECURSIVE_MUTEX) {
        /* xSemaphoreGive() on a mutex: release */
        pthread_mutex_lock(&g_k);
        BaseType_t ok = pdFALSE;
        if (q->waiting == 0) {
            q->waiting = 1; q->holder = NULL; q->recursion = 0;
            pthread_cond_broadcast(&q->cv);
            ok = pdTRUE;
        }
        pthread_mutex_unlock(&g_k);
        return ok;
    }
    return send_common(q, item, ticks, pos, false);
}
BaseType_t xQueueGenericSendFromISR(QueueHandle_t h, const void *item, BaseType_t *woken, BaseType_t pos)
{
    if (woken != NULL) *woken = pdFALSE;
    Queue_t *q = h;
    if (q == NULL) return pdFALSE;
    return send_common(q, item, 0, pos, true);
}
BaseType_t xQueueGiveFromISR(QueueHandle_t h, BaseType_t *woken)
{
    return xQueueGenericSendFromISR(h, NULL, woken, queueSEND_TO_BACK);
}

static BaseType_t recv_common(Queue_t *q, void *item, TickType_t ticks, bool peek)
{
    bool poll;
    uint64_t dl = deadline_of(ticks, &poll);
    BaseType_t ok = pdFALSE;
    tcb_t *me = self();
    pthread_mutex_lock(&g_k);
    while (q->waiting == 0 && !poll) {
        if (wait_locked(&q->cv, dl)) break;
    }
    if (q->waiting > 0) {
        copy_out(q, item, peek);
        if (!peek && (q->type == queueQUEUE_TYPE_MUTEX || q->type == queueQUEUE_TYPE_RECURSIVE_MUTEX)) {
            q->holder = me;
            q->recursion = 1;
        }
        ok = pdTRUE;
        pthread_cond_broadcast(&q->cv);
    }
    pthread_mutex_unlock(&g_k);
    return ok;
}

BaseType_t xQueueReceive(QueueHandle_t q, void *item, TickType_t ticks)
{
    return q ? recv_common(q, item, ticks, false) : pdFALSE;
}
BaseType_t xQueueReceiveFromISR(QueueHandle_t q, void *item, BaseType_t *woken)
{
    if (woken != NULL) *woken = pdFALSE;
    return q ? recv_common(q, item, 0, false) : pdFALSE;
}
BaseType_t xQueuePeek(QueueHandle_t q, void *item, TickType_t ticks)
{
    return q ? recv_common(q, item, ticks, true) : pdFALSE;
}
BaseType_t xQueuePeekFromISR(QueueHandle_t q, void *item)
{
    return q ? recv_common(q, item, 0, true) : pdFALSE;
}
BaseType_t xQueueSemaphoreTake(QueueHandle_t q, TickType_t ticks)
{
    return q ? recv_common(q, NULL, ticks, false) : pdFALSE;
}

BaseType_t xQueueTakeMutexRecursive(QueueHandle_t h, TickType_t ticks)
{
    Queue_t *q = h;
    tcb_t *me = self();
    if (q == NULL) return pdFALSE;
    pthread_mutex_lock(&g_k);
    if (q->holder == me && q->waiting == 0) {
        q->recursion++;
        pthread_mutex_unlock(&g_k);
        return pdTRUE;
    }
    pthread_mutex_unlock(&g_k);
    return recv_common(q, NULL, ticks, false);
}
BaseType_t xQueueGiveMutexRecursive(QueueHandle_t h)
{
    Queue_t *q = h;
    BaseType_t ok = pdFALSE;
    if (q == NULL) return pdFALSE;
    pthread_mutex_lock(&g_k);
    if (q->waiting == 0 && q->recursion > 0) {
        q->recursion--;
        if (q->recursion == 0) {
            q->waiting = 1; q->holder = NULL;
            pthread_cond_broadcast(&q->cv);
        }
        ok = pdTRUE;
    }
    pthread_mutex_unlock(&g_k);
    return ok;
}
void *xQueueGetMutexHolder(QueueHandle_t h)
{
    Queue_t *q = h;
    void *holder = NULL;
    if (q == NULL) return NULL;
    pthread_mutex_lock(&g_k);
    if (q->waiting == 0) holder = q->holder;
    pthread_mutex_unlock(&g_k);
    return holder;
}

UBaseType_t uxQueueMessagesWaiting(const QueueHandle_t h)
{
    Queue_t *q = h;
    pthread_mutex_lock(&g_k);
    UBaseType_t n = q->waiting;
    pthread_mutex_unlock(&g_k);
    return n;
}
UBaseType_t uxQueueMessagesWaitingFromISR(const QueueHandle_t q) { return uxQueueMessagesWaiting(q); }
UBaseType_t uxQueueSpacesAvailable(const QueueHandle_t h)
{
    Queue_t *q = h;
    pthread_mutex_lock(&g_k);
    UBaseType_t n = q->length - q->waiting;
    pthread_mutex_unlock(&g_k);
    return n;
}
BaseType_t xQueueIsQueueEmptyFromISR(const QueueHandle_t q) { return uxQueueMessagesWaiting(q) == 0; }
BaseType_t xQueueIsQueueFullFromISR(const QueueHandle_t h)
{
    return uxQueueSpacesAvailable(h) == 0;
}
BaseType_t xQueueReset(QueueHandle_t h)
{
    Queue_t *q = h;
    pthread_mutex_lock(&g_k);
    q->head = q->tail = 0;
    q->waiting = (q->type == queueQUEUE_TYPE_MUTEX || q->type == queueQUEUE_TYPE_RECURSIVE_MUTEX) ? 1 : 0;
    q->holder = NULL;
    q->recursion = 0;
    pthread_cond_broadcast(&q->cv);
    pthread_mutex_unlock(&g_k);
    return pdPASS;
}

/* ======================================================================== */
/* Event groups                                                              */
/* ======================================================================== */
struct EventGroupDef_t {
    EventBits_t    bits;
    pthread_cond_t cv;
    uint8_t        static_obj;
};
_Static_assert(sizeof(struct EventGroupDef_t) <= sizeof(StaticEventGroup_t), "StaticEventGroup_t too small");

EventGroupHandle_t xEventGroupCreate(void)
{
    struct EventGroupDef_t *g = calloc(1, sizeof(*g));
    if (g != NULL) cond_init(&g->cv);
    return g;
}
EventGroupHandle_t xEventGroupCreateStatic(StaticEventGroup_t *buf)
{
    struct EventGroupDef_t *g = (struct EventGroupDef_t *)buf;
    if (g == NULL) return NULL;
    memset(g, 0, sizeof(*g));
    g->static_obj = 1;
    cond_init(&g->cv);
    return g;
}
void vEventGroupDelete(EventGroupHandle_t g)
{
    if (g == NULL) return;
    pthread_mutex_lock(&g_k);
    pthread_cond_broadcast(&g->cv);
    pthread_mutex_unlock(&g_k);
    pthread_cond_destroy(&g->cv);
    if (!g->static_obj) free(g);
}
#define EG_CONTROL_MASK 0xff000000u
static bool eg_satisfied(EventBits_t have, EventBits_t want, BaseType_t all)
{
    return all ? ((have & want) == want) : ((have & want) != 0);
}
EventBits_t xEventGroupWaitBits(EventGroupHandle_t g, EventBits_t bits, BaseType_t clearOnExit,
                                BaseType_t waitAll, TickType_t ticks)
{
    bool poll;
    uint64_t dl = deadline_of(ticks, &poll);
    EventBits_t ret;
    pthread_mutex_lock(&g_k);
    while (!eg_satisfied(g->bits, bits, waitAll) && !poll) {
        if (wait_locked(&g->cv, dl)) break;
    }
    ret = g->bits;
    if (eg_satisfied(g->bits, bits, waitAll)) {
        if (clearOnExit) g->bits &= ~bits;
    }
    pthread_mutex_unlock(&g_k);
    return ret;
}
EventBits_t xEventGroupSetBits(EventGroupHandle_t g, EventBits_t bits)
{
    EventBits_t ret;
    pthread_mutex_lock(&g_k);
    g->bits |= (bits & ~EG_CONTROL_MASK);
    ret = g->bits;
    pthread_cond_broadcast(&g->cv);
    pthread_mutex_unlock(&g_k);
    return ret;
}
BaseType_t xEventGroupSetBitsFromISR(EventGroupHandle_t g, EventBits_t bits, BaseType_t *woken)
{
    if (woken != NULL) *woken = pdFALSE;
    (void)xEventGroupSetBits(g, bits);
    return pdPASS;
}
EventBits_t xEventGroupClearBits(EventGroupHandle_t g, EventBits_t bits)
{
    EventBits_t ret;
    pthread_mutex_lock(&g_k);
    ret = g->bits;
    g->bits &= ~bits;
    pthread_mutex_unlock(&g_k);
    return ret;
}
EventBits_t xEventGroupGetBits(EventGroupHandle_t g)
{
    return xEventGroupClearBits(g, 0);
}
EventBits_t xEventGroupSync(EventGroupHandle_t g, EventBits_t set, EventBits_t wait, TickType_t ticks)
{
    bool poll;
    uint64_t dl = deadline_of(ticks, &poll);
    EventBits_t ret;
    pthread_mutex_lock(&g_k);
    g->bits |= set;
    pthread_cond_broadcast(&g->cv);
    while ((g->bits & wait) != wait && !poll) {
        if (wait_locked(&g->cv, dl)) break;
    }
    ret = g->bits;
    if ((g->bits & wait) == wait) g->bits &= ~wait;
    pthread_mutex_unlock(&g_k);
    return ret;
}

/* ======================================================================== */
/* Software timers: one service thread, started on first use                 */
/* ======================================================================== */
struct tmrTimerControl {
    const char     *name;
    TickType_t      period;
    uint8_t         reload;
    uint8_t         active;
    uint8_t         deleted;
    uint8_t         static_obj;
    void           *id;
    TimerCallbackFunction_t cb;
    uint64_t        expiry_us;
    struct tmrTimerControl *next;
};
_Static_assert(sizeof(struct tmrTimerControl) <= sizeof(StaticTimer_t), "StaticTimer_t too small");

static struct tmrTimerControl *g_timers;
static pthread_cond_t g_tmr_cv;
static bool g_tmr_started;

static void *timer_service(void *unused)
{
    (void)unused;
    pthread_mutex_lock(&g_k);
    for (;;) {
        uint64_t now = mono_us();
        struct tmrTimerControl *due = NULL;
        uint64_t next = 0;
        for (struct tmrTimerControl *t = g_timers; t != NULL; t = t->next) {
            if (!t->active) continue;
            if (t->expiry_us <= now) { due = t; break; }
            if (next == 0 || t->expiry_us < next) next = t->expiry_us;
        }
        if (due != NULL) {
            if (due->reload) due->expiry_us = now + ticks_to_us(due->period ? due->period : 1);
            else due->active = 0;
            TimerCallbackFunction_t cb = due->cb;
            pthread_mutex_unlock(&g_k);
            cb(due);
            pthread_mutex_lock(&g_k);
            continue;
        }
        if (next == 0) pthread_cond_wait(&g_tmr_cv, &g_k);
        else {
            struct timespec ts = { .tv_sec = (time_t)(next / 1000000ULL), .tv_nsec = (long)((next % 1000000ULL) * 1000ULL) };
            pthread_cond_timedwait(&g_tmr_cv, &g_k, &ts);
        }
    }
    return NULL;
}

static void timer_service_ensure_locked(void)
{
    if (!g_tmr_started) {
        g_tmr_started = true;
        cond_init(&g_tmr_cv);
        pthread_t th;
        pthread_attr_t a;
        pthread_attr_init(&a);
        pthread_attr_setdetachstate(&a, PTHREAD_CREATE_DETACHED);
        pthread_create(&th, &a, timer_service, NULL);
        pthread_attr_destroy(&a);
    }
}

static TimerHandle_t timer_make(struct tmrTimerControl *t, const char *name, TickType_t period,
                                BaseType_t reload, void *id, TimerCallbackFunction_t cb)
{
    t->name = name; t->period = period; t->reload = reload != 0; t->id = id; t->cb = cb;
    pthread_mutex_lock(&g_k);
    timer_service_ensure_locked();
    t->next = g_timers;
    g_timers = t;
    pthread_mutex_unlock(&g_k);
    return t;
}
TimerHandle_t xTimerCreate(const char *name, TickType_t period, BaseType_t reload, void *id,
                           TimerCallbackFunction_t cb)
{
    struct tmrTimerControl *t = calloc(1, sizeof(*t));
    return t ? timer_make(t, name, period, reload, id, cb) : NULL;
}
TimerHandle_t xTimerCreateStatic(const char *name, TickType_t period, BaseType_t reload, void *id,
                                 TimerCallbackFunction_t cb, StaticTimer_t *buf)
{
    struct tmrTimerControl *t = (struct tmrTimerControl *)buf;
    memset(t, 0, sizeof(*t));
    t->static_obj = 1;
    return timer_make(t, name, period, reload, id, cb);
}
BaseType_t xTimerReset(TimerHandle_t t, TickType_t block)
{
    (void)block;
    pthread_mutex_lock(&g_k);
    t->active = 1;
    t->expiry_us = mono_us() + ticks_to_us(t->period ? t->period : 1);
    pthread_cond_broadcast(&g_tmr_cv);
    pthread_mutex_unlock(&g_k);
    return pdPASS;
}
BaseType_t xTimerStart(TimerHandle_t t, TickType_t block) { return xTimerReset(t, block); }
BaseType_t xTimerStop(TimerHandle_t t, TickType_t block)
{
    (void)block;
    pthread_mutex_lock(&g_k);
    t->active = 0;
    pthread_mutex_unlock(&g_k);
    return pdPASS;
}
BaseType_t xTimerChangePeriod(TimerHandle_t t, TickType_t period, TickType_t block)
{
    t->period = period;
    return xTimerReset(t, block);
}
BaseType_t xTimerDelete(TimerHandle_t t, TickType_t block)
{
    (void)block;
    pthread_mutex_lock(&g_k);
    for (struct tmrTimerControl **pp = &g_timers; *pp != NULL; pp = &(*pp)->next) {
        if (*pp == t) { *pp = t->next; break; }
    }
    t->active = 0;
    pthread_mutex_unlock(&g_k);
    if (!t->static_obj) free(t);
    return pdPASS;
}
BaseType_t xTimerIsTimerActive(TimerHandle_t t) { return t->active ? pdTRUE : pdFALSE; }
void *pvTimerGetTimerID(const TimerHandle_t t) { return t->id; }
void vTimerSetTimerID(TimerHandle_t t, void *id) { t->id = id; }
const char *pcTimerGetName(TimerHandle_t t) { return t->name; }
TickType_t xTimerGetPeriod(TimerHandle_t t) { return t->period; }
void vTimerSetReloadMode(TimerHandle_t t, BaseType_t r) { t->reload = r != 0; }
