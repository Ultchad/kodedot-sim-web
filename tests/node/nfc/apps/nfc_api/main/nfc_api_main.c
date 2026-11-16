/* SPDX-License-Identifier: GPL-3.0-or-later
 * nfc_api: a tiny kode.h app whose only job is to let the NFC tests call every kode_nfc_* function.
 *
 * The page (a Node test) posts one command line at a time into a small mailbox with nfcapp_cmd(); the app's
 * main task runs it and prints one result line, "[<seq>] ..." and then "[<seq>] done". Commands:
 *   id <ms>                     kode_nfc_read_id
 *   read <text|uri> <ms>        kode_nfc_read
 *   write <text|uri> <ms> <data>  kode_nfc_write (data is the rest of the line)
 *   profile <name> <type> <data>  kode_nfc_add_profile
 *   emu <name> | emustop        kode_nfc_emulate_start / kode_nfc_emulate_stop
 *   scanstart | scanstop        kode_nfc_scan_start / kode_nfc_scan_stop
 *   event <ms>                  kode_event_wait("nfc_tag")
 * Every "nfc_tag" event is also printed as it arrives, by a listener ("EVENT nfc_tag ..."). */
#include <emscripten.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "kode.h"

#define QN 8
#define QL 200
static char g_q[QN][QL];
static volatile unsigned g_head, g_tail;

EMSCRIPTEN_KEEPALIVE int nfcapp_cmd(const char *line)
{
    if (g_head - g_tail >= QN || strlen(line) >= QL) return -1;
    strcpy(g_q[g_head % QN], line);
    __atomic_store_n(&g_head, g_head + 1, __ATOMIC_RELEASE);
    return 0;
}

/* err() points into the task's own buffer and kode_print() clears it on entry (kode_enter), so copy first. */
static char g_err[128];
static const char *err(void)
{
    strncpy(g_err, kode_error(), sizeof g_err - 1);
    g_err[sizeof g_err - 1] = 0;
    return g_err;
}

static void on_tag(const kode_event_t *e) { kode_print("EVENT nfc_tag source=%s text=%s", e->source, e->text); }

static void run(unsigned seq, char *line)
{
    char *save = NULL;
    char *c = strtok_r(line, " ", &save);
    if (!c) return;
    if (!strcmp(c, "id")) {
        kode_tag_t t = kode_nfc_read_id((uint32_t)atoi(strtok_r(NULL, " ", &save)));
        if (t.ok) kode_print("[%u] ID ok %s | %s", seq, t.id, t.name);
        else kode_print("[%u] ID fail: %s", seq, err());
    } else if (!strcmp(c, "read")) {
        char *type = strtok_r(NULL, " ", &save);
        const char *r = kode_nfc_read(type, (uint32_t)atoi(strtok_r(NULL, " ", &save)));
        if (r[0]) kode_print("[%u] READ ok \"%s\"", seq, r);
        else kode_print("[%u] READ fail: %s", seq, err());
    } else if (!strcmp(c, "write")) {
        char *type = strtok_r(NULL, " ", &save);
        uint32_t ms = (uint32_t)atoi(strtok_r(NULL, " ", &save));
        const char *data = save ? save : "";
        if (kode_nfc_write(type, data, ms)) kode_print("[%u] WRITE ok", seq);
        else kode_print("[%u] WRITE fail: %s", seq, err());
    } else if (!strcmp(c, "profile")) {
        char *name = strtok_r(NULL, " ", &save);
        char *type = strtok_r(NULL, " ", &save);
        const char *data = save ? save : "";
        if (kode_nfc_add_profile(name, type, data)) kode_print("[%u] PROFILE ok", seq);
        else kode_print("[%u] PROFILE fail: %s", seq, err());
    } else if (!strcmp(c, "emu")) {
        if (kode_nfc_emulate_start(strtok_r(NULL, " ", &save))) kode_print("[%u] EMU ok", seq);
        else kode_print("[%u] EMU fail: %s", seq, err());
    } else if (!strcmp(c, "emustop")) {
        if (kode_nfc_emulate_stop()) kode_print("[%u] EMUSTOP ok", seq);
        else kode_print("[%u] EMUSTOP fail: %s", seq, err());
    } else if (!strcmp(c, "scanstart")) {
        if (kode_nfc_scan_start()) kode_print("[%u] SCANSTART ok", seq);
        else kode_print("[%u] SCANSTART fail: %s", seq, err());
    } else if (!strcmp(c, "scanstop")) {
        if (kode_nfc_scan_stop()) kode_print("[%u] SCANSTOP ok", seq);
        else kode_print("[%u] SCANSTOP fail: %s", seq, err());
    } else if (!strcmp(c, "event")) {
        kode_event_t e;
        if (kode_event_wait("nfc_tag", (uint32_t)atoi(strtok_r(NULL, " ", &save)), &e)) kode_print("[%u] EVENT ok %s", seq, e.text);
        else kode_print("[%u] EVENT timeout", seq);
    } else {
        kode_print("[%u] unknown command %s", seq, c);
    }
}

KODE_APP_MANIFEST("NFC API", "test");

/* A FreeRTOS task of its own: err() keeps its text per task, and the bare main thread has no task slot. */
static void worker(void *arg)
{
    (void)arg;
    kode_init();
    (void)kode_event_add_listener("nfc_tag", &on_tag);
    kode_print("nfc_api ready");
    for (;;) {
        if (g_tail != __atomic_load_n(&g_head, __ATOMIC_ACQUIRE)) {
            char line[QL];
            strcpy(line, g_q[g_tail % QN]);
            unsigned seq = 0;
            char *sp = strchr(line, ' ');
            if (sp) { *sp = 0; seq = (unsigned)atoi(line); memmove(line, sp + 1, strlen(sp + 1) + 1); }
            run(seq, line);
            kode_print("[%u] done", seq);
            __atomic_store_n(&g_tail, g_tail + 1, __ATOMIC_RELEASE);
        } else {
            kode_delay(10);
        }
    }
}

void app_main(void)
{
    xTaskCreate(&worker, "nfc_api", 8192, NULL, 5, NULL);
}
