/* Power-cut hammer for a FAT volume (HAM_ROOT is "/storage" or "/sdcard"; HAM_MEDIUM the kdrv medium).
 * Rewrites SLOTS files forever, generation g into slot g % SLOTS; content and length are functions of g.
 * At start it verifies what the previous (possibly killed) run left: every file must be whole, except that the file being
 * written when the power went (the newest generation, slot maxWhole+1) may be torn. Prints
 *   FSHAM verify=<ok|BAD-...> maxWhole=<g> whole=<n> bad=<n>
 * and then "FSHAM DONE <g>" after every file whose close() returned. */
#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "kdrv_storage.h"

#define SLOTS 24u
#define DIR HAM_ROOT "/h"
static uint32_t g_next;
static uint32_t glen(uint32_t g) { return 600u + (g * 2654435761u >> 9) % 9000u; }
static void gfill(uint8_t *b, uint32_t g, uint32_t len)
{
    memcpy(b, "G", 1); memcpy(b + 1, &g, 4); memcpy(b + 5, &len, 4);
    for (uint32_t i = 9; i < len; i++) b[i] = (uint8_t)(g * 31u + i * 7u + (i >> 8));
}
static const char *slot_path(uint32_t slot) { static char p[64]; snprintf(p, sizeof p, DIR "/s%02u.bin", (unsigned)slot); return p; }

static int mount_it(void) { return kdrv_storage_mount(HAM_MEDIUM) != NULL; }

static void verify(void)
{
    static uint8_t buf[10000], want[10000];
    uint32_t whole = 0, bad = 0, maxw = 0, badslot = 0, badgen = 0; int have = 0, badhdr = 0;
    for (uint32_t s = 0; s < SLOTS; s++) {
        uint32_t size = 0;
        if (kdrv_storage_open_path(slot_path(s), &size) != KODE_OK) continue;
        size_t got = 0; memset(buf, 0, sizeof buf);
        if (size > sizeof buf) size = sizeof buf;
        (void)kdrv_storage_read(buf, size, &got);
        (void)kdrv_storage_close();
        uint32_t g = 0, len = 0;
        int ok = 0;
        if (got >= 9 && buf[0] == 'G') {
            memcpy(&g, buf + 1, 4); memcpy(&len, buf + 5, 4);
            if (len == glen(g) && got == len && g % SLOTS == s) { gfill(want, g, len); ok = !memcmp(buf, want, len); }
        }
        if (ok) { whole++; if (!have || g > maxw) maxw = g; have = 1; }
        else { bad++; badslot = s; badgen = (got >= 9 && buf[0] == 'G') ? g : 0; badhdr = got >= 9 && buf[0] == 'G'; }
    }
    const char *v = "ok";
    if (bad > 1) v = "BAD-many";
    else if (bad == 1 && have && badslot != (maxw + 1) % SLOTS) v = "BAD-slot";
    else if (bad == 1 && badhdr && have && badgen != maxw + 1) v = "BAD-gen";
    esp_rom_printf("FSHAM verify=%s maxWhole=%u whole=%u bad=%u\n", v, (unsigned)(have ? maxw : 0), (unsigned)whole, (unsigned)bad);
    /* continue after the newest whole generation (the torn one, if any, is rewritten) */
    g_next = have ? maxw + 1 : 1;
}

void app_main(void)
{
    static uint8_t buf[10000];
    while (!mount_it()) vTaskDelay(pdMS_TO_TICKS(20));
    (void)kdrv_storage_mkdir(DIR);
    verify();
    for (;;) {
        uint32_t g = g_next, len = glen(g);
        gfill(buf, g, len);
        kode_status_t st = kdrv_storage_create_path(slot_path(g % SLOTS), false);
        if (st == KODE_OK) {
            for (uint32_t o = 0; o < len && st == KODE_OK; o += 700u) st = kdrv_storage_write(buf + o, len - o < 700u ? len - o : 700u);
            kode_status_t cs = kdrv_storage_close();
            if (st == KODE_OK) st = cs;
        }
        if (st == KODE_OK) { esp_rom_printf("FSHAM DONE %u\n", (unsigned)g); g_next = g + 1; }
        else {
            esp_rom_printf("FSHAM ERR %u status=%d\n", (unsigned)g, (int)st);
            kdrv_storage_discard();
            /* card pulled / volume gone: remount, then verify again (the torn file is the one we rewrite) */
            kdrv_storage_unmount(HAM_MEDIUM);
            while (!mount_it()) vTaskDelay(pdMS_TO_TICKS(20));
            (void)kdrv_storage_mkdir(DIR);
            verify();
        }
        vTaskDelay(1);
    }
}
