/* SPDX-License-Identifier: GPL-3.0-or-later
 * rfid_api: a bench-test app that exposes every RFID call of the public API as a console function, and prints the
 * outcome as one "RES ..." log line. Console functions only record the request (they must not block):
 *   task API (kode.h):  read ms | write "ID;ms" | emu "ID" | emustop | isemu
 *   AO API (kode_sys.h): aread ms | awrite "ID;ms" | aemu "ID" | aemustop   (answered by RFID_OP_RSP_SIG / RFID_EMU_RSP_SIG)
 * The test types e.g.  read arg=2000  on the console and waits for the matching RES line. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "kode.h"
#include "kode_functions.h"
#include "kode_log.h"
#include "kode_sys.h"
#include "kqp.h"

KODE_APP_MANIFEST("RFID API", "test");

#define TAG "rfid_api"

/* ---- the task side: one pending request ---- */
typedef struct { volatile int cmd; int32_t ms; char text[64]; } slot_t;
enum { C_NONE = 0, C_READ, C_WRITE, C_EMU, C_EMUSTOP, C_ISEMU };
static slot_t g_slot;

static void hexid(const uint8_t *id, char *out)
{
    snprintf(out, 15, "%02X:%02X:%02X:%02X:%02X", id[0], id[1], id[2], id[3], id[4]);
}

static void task_main(void *arg)
{
    (void)arg;
    for (;;) {
        int cmd = g_slot.cmd;
        if (cmd == C_NONE) { vTaskDelay(5); continue; }
        slot_t s = g_slot;
        char *semi;
        switch (cmd) {
        case C_READ: {
            kode_tag_t t = kode_rfid_read_id((uint32_t)s.ms);
            if (t.ok) KLOG_N(TAG, "RES read ok=1 id=%s name=%s", t.id, t.name);
            else KLOG_N(TAG, "RES read ok=0 err=%s", kode_error());
            break;
        }
        case C_WRITE: {
            uint32_t ms = 3000;
            semi = strchr(s.text, ';');
            if (semi) { *semi = 0; ms = (uint32_t)atoi(semi + 1); }
            bool ok = kode_rfid_write(s.text, ms);
            if (ok) KLOG_N(TAG, "RES write ok=1");
            else KLOG_N(TAG, "RES write ok=0 err=%s", kode_error());
            break;
        }
        case C_EMU: {
            bool ok = kode_rfid_emulate_start(s.text);
            if (ok) KLOG_N(TAG, "RES emu ok=1 emulating=%d", (int)kode_sys_rfid_is_emulating());
            else KLOG_N(TAG, "RES emu ok=0 err=%s", kode_error());
            break;
        }
        case C_EMUSTOP: {
            bool ok = kode_rfid_emulate_stop();
            if (ok) KLOG_N(TAG, "RES emustop ok=1 emulating=%d", (int)kode_sys_rfid_is_emulating());
            else KLOG_N(TAG, "RES emustop ok=0 err=%s", kode_error());
            break;
        }
        case C_ISEMU:
            KLOG_N(TAG, "RES isemu %d", (int)kode_sys_rfid_is_emulating());
            break;
        default: break;
        }
        g_slot.cmd = C_NONE;
    }
}

static kode_status_t post(int cmd, int32_t ms, const char *text)
{
    if (g_slot.cmd != C_NONE) { KLOG_N(TAG, "RES busy"); return KODE_DENIED; }
    g_slot.ms = ms;
    snprintf(g_slot.text, sizeof g_slot.text, "%s", text ? text : "");
    g_slot.cmd = cmd;
    return KODE_OK;
}
static kode_status_t f_read(const kode_value_t *a) { return post(C_READ, a->i, NULL); }
static kode_status_t f_write(const kode_value_t *a) { return post(C_WRITE, 0, a->s); }
static kode_status_t f_emu(const kode_value_t *a) { return post(C_EMU, 0, a->s); }
static kode_status_t f_emustop(const kode_value_t *a) { (void)a; return post(C_EMUSTOP, 0, NULL); }
static kode_status_t f_isemu(const kode_value_t *a) { (void)a; return post(C_ISEMU, 0, NULL); }

/* ---- the AO side ---- */
enum { A_CMD_SIG = MAX_SIG, A_DUMMY_SIG };
typedef struct { QEvt super; int kind; int32_t ms; uint8_t id[KODE_SYS_RFID_ID_BYTES]; } CmdEvt;
enum { K_READ = 1, K_WRITE, K_EMU, K_EMUSTOP };
typedef struct { QActive super; } Api;
static QEvtPtr l_queue[KQP_AO_QUEUE_LEN];
static StackType_t l_stack[KQP_AO_STACK_BYTES / sizeof(StackType_t)];
static Api l_ao;
QActive * const AO_Api = &l_ao.super;
static QState Api_initial(Api * const me, void const * const par);
static QState Api_running(Api * const me, QEvt const * const e);

static kode_status_t parse_hex5(const char *t, uint8_t *id)
{
    unsigned v[5];
    if (sscanf(t, "%x:%x:%x:%x:%x", &v[0], &v[1], &v[2], &v[3], &v[4]) != 5) return KODE_DENIED;
    for (int i = 0; i < 5; i++) id[i] = (uint8_t)v[i];
    return KODE_OK;
}

static kode_status_t post_ao(int kind, int32_t ms, const char *text)
{
    CmdEvt *e = Q_NEW_X(CmdEvt, 0U, A_CMD_SIG);
    if (!e) return KODE_NO_RESOURCES;
    memset(e->id, 0, sizeof e->id);
    e->kind = kind; e->ms = ms;
    if (text) {
        char tmp[64];
        snprintf(tmp, sizeof tmp, "%s", text);
        char *semi = strchr(tmp, ';');
        if (semi) { *semi = 0; e->ms = atoi(semi + 1); }
        if (parse_hex5(tmp, e->id) != KODE_OK) { /* leave zeros */ }
    }
    if (!QACTIVE_POST_X(AO_Api, &e->super, 1U, (void *)0)) return KODE_NO_RESOURCES;
    return KODE_OK;
}
static kode_status_t f_aread(const kode_value_t *a) { return post_ao(K_READ, a->i, NULL); }
static kode_status_t f_awrite(const kode_value_t *a) { return post_ao(K_WRITE, 3000, a->s); }
static kode_status_t f_aemu(const kode_value_t *a) { return post_ao(K_EMU, 0, a->s); }
static kode_status_t f_aemustop(const kode_value_t *a) { (void)a; return post_ao(K_EMUSTOP, 0, NULL); }

static const kode_function_t FUNCTIONS[] = {
    { .name = "read", .arg = KODE_TYPE_INT, .min = 0, .max = 600000, .run = f_read, .desc = "kode_rfid_read_id(ms)" },
    { .name = "write", .arg = KODE_TYPE_STRING, .run = f_write, .desc = "kode_rfid_write(\"ID;ms\")" },
    { .name = "emu", .arg = KODE_TYPE_STRING, .run = f_emu, .desc = "kode_rfid_emulate_start(id)" },
    { .name = "emustop", .run = f_emustop, .desc = "kode_rfid_emulate_stop()" },
    { .name = "isemu", .run = f_isemu, .desc = "kode_sys_rfid_is_emulating()" },
    { .name = "aread", .arg = KODE_TYPE_INT, .min = 0, .max = 600000, .run = f_aread, .desc = "kode_sys_rfid_read(me, ms)" },
    { .name = "awrite", .arg = KODE_TYPE_STRING, .run = f_awrite, .desc = "kode_sys_rfid_write(me, id, 3000)" },
    { .name = "aemu", .arg = KODE_TYPE_STRING, .run = f_aemu, .desc = "kode_sys_rfid_emulate_start(me, id)" },
    { .name = "aemustop", .run = f_aemustop, .desc = "kode_sys_rfid_emulate_stop(me)" },
};

static QState Api_initial(Api * const me, void const * const par)
{
    (void)par; (void)me;
    return Q_TRAN(&Api_running);
}

static QState Api_running(Api * const me, QEvt const * const e)
{
    QState status = Q_SUPER(&QHsm_top);
    switch (e->sig) {
    case A_CMD_SIG: {
        CmdEvt const *c = (CmdEvt const *)e;
        kode_status_t rc = KODE_ERROR;
        if (c->kind == K_READ) rc = kode_sys_rfid_read(&me->super, (uint32_t)c->ms);
        else if (c->kind == K_WRITE) rc = kode_sys_rfid_write(&me->super, c->id, (uint32_t)c->ms);
        else if (c->kind == K_EMU) rc = kode_sys_rfid_emulate_start(&me->super, c->id);
        else if (c->kind == K_EMUSTOP) rc = kode_sys_rfid_emulate_stop(&me->super);
        KLOG_N(TAG, "RES ask kind=%d taken=%d", c->kind, (int)rc);
        status = Q_HANDLED();
        break;
    }
    case RFID_OP_RSP_SIG: {
        kode_sys_rfid_answer_t const *a = (kode_sys_rfid_answer_t const *)e;
        char id[16];
        hexid(a->id, id);
        KLOG_N(TAG, "RES op write=%d rc=%u id=%s rf=%u", (int)a->write, (unsigned)a->rc, id, (unsigned)a->rf_div);
        status = Q_HANDLED();
        break;
    }
    case RFID_EMU_RSP_SIG: {
        kode_sys_rfid_emu_answer_t const *a = (kode_sys_rfid_emu_answer_t const *)e;
        KLOG_N(TAG, "RES emursp stop=%d rc=%u emulating=%d", (int)a->stop, (unsigned)a->rc, (int)kode_sys_rfid_is_emulating());
        status = Q_HANDLED();
        break;
    }
    default: break;
    }
    return status;
}

void app_main(void)
{
    kode_init();
    QActive_ctor(&l_ao.super, Q_STATE_CAST(&Api_initial));
    QActive_setAttr(AO_Api, TASK_NAME_ATTR, "rfid_api");
    QACTIVE_START(AO_Api, KODE_PRIO_USER_LOW, l_queue, Q_DIM(l_queue), l_stack, sizeof(l_stack), (void *)0);
    (void)KODE_FUNCTIONS_ADD(FUNCTIONS);
    xTaskCreate(&task_main, "rfid_api_t", 4096, NULL, 5, NULL);
    KLOG_N(TAG, "rfid_api up");
}
