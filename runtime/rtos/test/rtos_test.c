/* SPDX-License-Identifier: GPL-3.0-or-later
 * Unit tests of the dotbench RTOS layer. Built by runtime/rtos/test/run.sh with
 * emcc -pthread and run under Node. Prints "ALL PASSED" and exits 0 on success. */
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/event_groups.h"
#include "freertos/timers.h"
#include "freertos/idf_additions.h"

static int g_fail, g_checks;
#define CHECK(c) do { g_checks++; if (!(c)) { g_fail++; printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #c); } } while (0)
#define MS(x) pdMS_TO_TICKS(x)
static uint32_t elapsed_ms(TickType_t t0) { return pdTICKS_TO_MS(xTaskGetTickCount() - t0); }

/* ---- 1. ticks and delays ---- */
static void test_ticks(void)
{
    TickType_t t0 = xTaskGetTickCount();
    vTaskDelay(MS(50));
    uint32_t e = elapsed_ms(t0);
    CHECK(e >= 49 && e < 400);
    TickType_t last = xTaskGetTickCount();
    TickType_t prev = last;
    xTaskDelayUntil(&prev, MS(20));
    xTaskDelayUntil(&prev, MS(20));
    CHECK(elapsed_ms(last) >= 39);
}

/* ---- 2. queues ---- */
static QueueHandle_t g_q;
static void producer(void *arg)
{
    vTaskDelay(MS(40));
    int v = 77;
    xQueueSend(g_q, &v, 0);
    vTaskDelete(NULL);
}
static void test_queues(void)
{
    QueueHandle_t q = xQueueCreate(3, sizeof(int));
    int v;
    CHECK(q != NULL);
    CHECK(xQueueReceive(q, &v, 0) == pdFALSE);
    TickType_t t0 = xTaskGetTickCount();
    CHECK(xQueueReceive(q, &v, MS(30)) == pdFALSE);
    CHECK(elapsed_ms(t0) >= 29);
    for (int i = 1; i <= 3; i++) CHECK(xQueueSend(q, &i, 0) == pdTRUE);
    v = 4;
    CHECK(xQueueSend(q, &v, 0) == pdFALSE);
    t0 = xTaskGetTickCount();
    CHECK(xQueueSend(q, &v, MS(30)) == pdFALSE);
    CHECK(elapsed_ms(t0) >= 29);
    CHECK(uxQueueMessagesWaiting(q) == 3);
    CHECK(uxQueueSpacesAvailable(q) == 0);
    v = 0;
    CHECK(xQueuePeek(q, &v, 0) == pdTRUE && v == 1);
    for (int i = 1; i <= 3; i++) { CHECK(xQueueReceive(q, &v, 0) == pdTRUE && v == i); }
    int a = 10, b = 20, f = 5;
    xQueueSendToBack(q, &a, 0); xQueueSendToBack(q, &b, 0); xQueueSendToFront(q, &f, 0);
    CHECK(xQueueReceive(q, &v, 0) == pdTRUE && v == 5);
    CHECK(xQueueReceive(q, &v, 0) == pdTRUE && v == 10);
    CHECK(xQueueReceive(q, &v, 0) == pdTRUE && v == 20);
    /* overwrite on a length-1 queue */
    QueueHandle_t q1 = xQueueCreate(1, sizeof(int));
    a = 1; b = 2;
    xQueueOverwrite(q1, &a); xQueueOverwrite(q1, &b);
    CHECK(xQueueReceive(q1, &v, 0) == pdTRUE && v == 2);
    vQueueDelete(q1);
    /* a blocked receiver is woken by a producer task */
    g_q = q;
    xTaskCreate(producer, "producer", 4096, NULL, 5, NULL);
    t0 = xTaskGetTickCount();
    CHECK(xQueueReceive(q, &v, portMAX_DELAY) == pdTRUE && v == 77);
    CHECK(elapsed_ms(t0) >= 35 && elapsed_ms(t0) < 1000);
    CHECK(xQueueReset(q) == pdPASS);
    vQueueDelete(q);
}

/* ---- 3. static queue layout the QP port depends on ---- */
static void test_static_layout(void)
{
    static StaticQueue_t sq;
    static int storage[4];
    QueueHandle_t q = xQueueCreateStatic(4, sizeof(int), (uint8_t *)storage, &sq);
    CHECK(q != NULL && (void *)q == (void *)&sq);
    CHECK(sq.uxDummy4[0] == 0 && sq.uxDummy4[1] == 4);
    int v = 1;
    xQueueSend(q, &v, 0); xQueueSend(q, &v, 0);
    CHECK(sq.uxDummy4[0] == 2 && sq.uxDummy4[1] - sq.uxDummy4[0] == 2);
    xQueueReceive(q, &v, 0);
    CHECK(sq.uxDummy4[0] == 1);
}

/* ---- 4. semaphores and mutexes ---- */
static SemaphoreHandle_t g_sem, g_mtx;
static volatile int g_shared;
static void giver(void *arg) { vTaskDelay(MS(30)); xSemaphoreGive(g_sem); vTaskDelete(NULL); }
static volatile int g_done;
static void incr(void *arg)
{
    for (int i = 0; i < 2000; i++) {
        xSemaphoreTake(g_mtx, portMAX_DELAY);
        int t = g_shared; sched_yield(); g_shared = t + 1;
        xSemaphoreGive(g_mtx);
    }
    __atomic_add_fetch(&g_done, 1, __ATOMIC_SEQ_CST);
    vTaskDelete(NULL);
}
static void test_semaphores(void)
{
    SemaphoreHandle_t b = xSemaphoreCreateBinary();
    CHECK(xSemaphoreTake(b, 0) == pdFALSE);               /* starts empty */
    CHECK(xSemaphoreGive(b) == pdTRUE);
    CHECK(xSemaphoreGive(b) == pdFALSE);                  /* already given */
    CHECK(xSemaphoreTake(b, 0) == pdTRUE);
    TickType_t t0 = xTaskGetTickCount();
    CHECK(xSemaphoreTake(b, MS(25)) == pdFALSE && elapsed_ms(t0) >= 24);
    g_sem = b;
    xTaskCreate(giver, "giver", 4096, NULL, 5, NULL);
    CHECK(xSemaphoreTake(b, portMAX_DELAY) == pdTRUE);
    vSemaphoreDelete(b);

    SemaphoreHandle_t c = xSemaphoreCreateCounting(3, 1);
    CHECK(uxSemaphoreGetCount(c) == 1);
    xSemaphoreGive(c); xSemaphoreGive(c);
    CHECK(xSemaphoreGive(c) == pdFALSE);
    for (int i = 0; i < 3; i++) CHECK(xSemaphoreTake(c, 0) == pdTRUE);
    CHECK(xSemaphoreTake(c, 0) == pdFALSE);
    vSemaphoreDelete(c);

    /* mutual exclusion across 3 tasks */
    g_mtx = xSemaphoreCreateMutex();
    g_shared = 0; g_done = 0;
    for (int i = 0; i < 3; i++) xTaskCreate(incr, "incr", 4096, NULL, 5, NULL);
    while (__atomic_load_n(&g_done, __ATOMIC_SEQ_CST) < 3) vTaskDelay(MS(5));
    CHECK(g_shared == 6000);
    CHECK(xSemaphoreGetMutexHolder(g_mtx) == NULL);
    xSemaphoreTake(g_mtx, 0);
    CHECK(xSemaphoreGetMutexHolder(g_mtx) == xTaskGetCurrentTaskHandle());
    xSemaphoreGive(g_mtx);
    vSemaphoreDelete(g_mtx);

    /* recursive mutex */
    SemaphoreHandle_t r = xSemaphoreCreateRecursiveMutex();
    CHECK(xSemaphoreTakeRecursive(r, 0) == pdTRUE);
    CHECK(xSemaphoreTakeRecursive(r, 0) == pdTRUE);
    CHECK(xSemaphoreGiveRecursive(r) == pdTRUE);
    CHECK(xSemaphoreGetMutexHolder(r) != NULL);
    CHECK(xSemaphoreGiveRecursive(r) == pdTRUE);
    CHECK(xSemaphoreGetMutexHolder(r) == NULL);
    vSemaphoreDelete(r);
}

/* ---- 5. event groups ---- */
static EventGroupHandle_t g_eg;
static void setter(void *arg)
{
    vTaskDelay(MS(30)); xEventGroupSetBits(g_eg, 0x1);
    vTaskDelay(MS(30)); xEventGroupSetBits(g_eg, 0x2);
    vTaskDelete(NULL);
}
static void test_event_groups(void)
{
    EventGroupHandle_t g = xEventGroupCreate();
    g_eg = g;
    CHECK(xEventGroupGetBits(g) == 0);
    TickType_t t0 = xTaskGetTickCount();
    EventBits_t r = xEventGroupWaitBits(g, 0x3, pdTRUE, pdTRUE, MS(20));
    CHECK(r == 0 && elapsed_ms(t0) >= 19);                 /* timeout, nothing set */
    xTaskCreate(setter, "setter", 4096, NULL, 5, NULL);
    r = xEventGroupWaitBits(g, 0x1 | 0x2, pdFALSE, pdFALSE, portMAX_DELAY);   /* any */
    CHECK((r & 0x1) != 0);
    r = xEventGroupWaitBits(g, 0x1 | 0x2, pdTRUE, pdTRUE, portMAX_DELAY);     /* all, clear */
    CHECK((r & 0x3) == 0x3);
    CHECK(xEventGroupGetBits(g) == 0);
    xEventGroupSetBits(g, 0x4);
    CHECK(xEventGroupClearBits(g, 0x4) == 0x4);
    CHECK(xEventGroupGetBits(g) == 0);
    vEventGroupDelete(g);
}

/* ---- 6. task notifications ---- */
static TaskHandle_t g_main_task;
static void notifier(void *arg)
{
    /* Gaps are wide on purpose: on a loaded machine a thread can sleep past a short gap and the
     * notifications would then coalesce, which is correct behaviour but not what this test checks. */
    vTaskDelay(MS(30)); xTaskNotifyGive(g_main_task);
    vTaskDelay(MS(200)); xTaskNotifyGive(g_main_task);
    vTaskDelay(MS(200)); xTaskNotify(g_main_task, 0x50, eSetBits);
    vTaskDelete(NULL);
}
static void test_notify(void)
{
    g_main_task = xTaskGetCurrentTaskHandle();
    xTaskCreate(notifier, "notifier", 4096, NULL, 5, NULL);
    CHECK(ulTaskNotifyTake(pdTRUE, MS(2000)) >= 1);
    uint32_t n = ulTaskNotifyTake(pdTRUE, MS(2000));       /* the second give, counted */
    CHECK(n >= 1);
    uint32_t val = 0;
    CHECK(xTaskNotifyWait(0, 0xffffffffu, &val, MS(2000)) == pdTRUE);
    CHECK((val & 0x50) == 0x50);
    CHECK(ulTaskNotifyTake(pdTRUE, 0) == 0);
    CHECK(ulTaskNotifyTake(pdTRUE, MS(15)) == 0);
}

/* ---- 7. critical sections ---- */
static portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;
static volatile int g_crit_counter;
static void crit_task(void *arg)
{
    for (int i = 0; i < 5000; i++) {
        taskENTER_CRITICAL(&g_mux);
        taskENTER_CRITICAL(&g_mux);            /* nests */
        int t = g_crit_counter; g_crit_counter = t + 1;
        taskEXIT_CRITICAL(&g_mux);
        taskEXIT_CRITICAL(&g_mux);
    }
    __atomic_add_fetch(&g_done, 1, __ATOMIC_SEQ_CST);
    vTaskDelete(NULL);
}
static void test_critical(void)
{
    g_done = 0; g_crit_counter = 0;
    for (int i = 0; i < 4; i++) xTaskCreate(crit_task, "crit", 4096, NULL, 5, NULL);
    while (__atomic_load_n(&g_done, __ATOMIC_SEQ_CST) < 4) vTaskDelay(MS(5));
    CHECK(g_crit_counter == 20000);
}

/* ---- 8. static task, names, TLS, delete ---- */
static StaticTask_t g_tcb;
static volatile int g_static_ran;
static volatile TaskHandle_t g_static_self;
static void tls_free(int idx, void *p) { (void)idx; __atomic_add_fetch(&g_static_ran, 100, __ATOMIC_SEQ_CST); (void)p; }
static void static_task(void *arg)
{
    g_static_self = xTaskGetCurrentTaskHandle();
    vTaskSetThreadLocalStoragePointerAndDelCallback(NULL, 1, (void *)0x1234, tls_free);
    CHECK(pvTaskGetThreadLocalStoragePointer(NULL, 1) == (void *)0x1234);
    __atomic_add_fetch(&g_static_ran, 1, __ATOMIC_SEQ_CST);
    vTaskDelete(NULL);
}
static void blocked_task(void *arg)
{
    QueueHandle_t q = (QueueHandle_t)arg;
    int v;
    xQueueReceive(q, &v, portMAX_DELAY);           /* never satisfied: vTaskDelete must end it */
    __atomic_add_fetch(&g_static_ran, 1000, __ATOMIC_SEQ_CST);
}
static void test_tasks(void)
{
    static StackType_t stack[2048];
    g_tcb.pxDummy1 = (void *)"qp-name";             /* the QP port parks the name here */
    TaskHandle_t h = xTaskCreateStatic(static_task, NULL, sizeof(stack), NULL, 3, stack, &g_tcb);
    CHECK(h == (TaskHandle_t)&g_tcb);
    CHECK(strcmp(pcTaskGetName(h), "qp-name") == 0);
    vTaskDelay(MS(80));
    CHECK(g_static_ran == 101);
    CHECK(g_static_self == h);
    CHECK(xTaskGetHandle("qp-name") == NULL);       /* deleted tasks leave the list */

    QueueHandle_t q = xQueueCreate(1, sizeof(int));
    TaskHandle_t b = NULL;
    CHECK(xTaskCreate(blocked_task, "blocked", 4096, q, 4, &b) == pdPASS);
    vTaskDelay(MS(40));
    CHECK(xTaskGetHandle("blocked") == b);
    CHECK(uxTaskPriorityGet(b) == 4);
    TaskStatus_t st[32];
    UBaseType_t n = uxTaskGetSystemState(st, 32, NULL);
    int seen = 0;
    for (UBaseType_t i = 0; i < n; i++) if (strcmp(st[i].pcTaskName, "blocked") == 0) seen = 1;
    CHECK(seen);
    vTaskDelete(b);
    vTaskDelay(MS(60));
    CHECK(g_static_ran == 101);                     /* blocked_task never got past its receive */
    CHECK(xTaskGetHandle("blocked") == NULL);
    vQueueDelete(q);
}

/* ---- 9. software timers ---- */
static volatile int g_tmr_hits;
static void tmr_cb(void *t) { (void)t; __atomic_add_fetch(&g_tmr_hits, 1, __ATOMIC_SEQ_CST); }
static void test_timers(void)
{
    TimerHandle_t p = xTimerCreate("periodic", MS(20), pdTRUE, (void *)7, tmr_cb);
    CHECK(pvTimerGetTimerID(p) == (void *)7);
    g_tmr_hits = 0;
    xTimerStart(p, 0);
    vTaskDelay(MS(130));
    xTimerStop(p, 0);
    int hits = g_tmr_hits;
    CHECK(hits >= 4 && hits <= 8);
    vTaskDelay(MS(60));
    CHECK(g_tmr_hits == hits);
    TimerHandle_t o = xTimerCreate("once", MS(20), pdFALSE, NULL, tmr_cb);
    xTimerStart(o, 0);
    vTaskDelay(MS(100));
    CHECK(g_tmr_hits == hits + 1);
    CHECK(xTimerIsTimerActive(o) == pdFALSE);
    xTimerDelete(p, 0); xTimerDelete(o, 0);
}

/* ---- 10. scheduler state, suspend-all ---- */
static void test_misc(void)
{
    CHECK(xTaskGetSchedulerState() == taskSCHEDULER_RUNNING);
    CHECK(xPortCanYield() == pdTRUE && xPortInIsrContext() == pdFALSE);
    vTaskSuspendAll(); vTaskSuspendAll();
    xTaskResumeAll(); xTaskResumeAll();
    CHECK(pdMS_TO_TICKS(1500) == 1500);
    CHECK(configTICK_RATE_HZ == 1000);
}

int main(void)
{
    test_ticks();
    test_queues();
    test_static_layout();
    test_semaphores();
    test_event_groups();
    test_notify();
    test_critical();
    test_tasks();
    test_timers();
    test_misc();
    printf("%d checks, %d failed\n", g_checks, g_fail);
    if (g_fail == 0) printf("ALL PASSED\n");
    fflush(stdout);
    return g_fail == 0 ? 0 : 1;
}
