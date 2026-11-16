/* Runs the SDK's host_nvs test cases (compiled in unchanged) on the dotbench khal_nvs, then prints a summary line. */
#include <stdlib.h>
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "unity.h"
#include "kode_defs.h"

#define MAXC 128
static struct { const char *name; unity_case_fn fn; } g_cases[MAXC];
static int g_n, g_failed, g_cur_failed;
jmp_buf unity_jmp;
void unity_register(const char *name, const char *tags, unity_case_fn fn) { (void)tags; if (g_n < MAXC) { g_cases[g_n].name = name; g_cases[g_n].fn = fn; g_n++; } }
void unity_fail(const char *file, int line, const char *msg)
{
    const char *f = strrchr(file, '/'); f = f ? f + 1 : file;
    esp_rom_printf("FAIL %s:%d %s\n", f, line, msg);
    g_cur_failed = 1;
    longjmp(unity_jmp, 1);
}
void app_main(void)
{
    /* constructors register in link order; the SDK sorts its cases, we keep file order */
    for (int i = 0; i < g_n; i++) {
        g_cur_failed = 0;
        if (setjmp(unity_jmp) == 0) g_cases[i].fn();
        if (g_cur_failed) { g_failed++; esp_rom_printf("case FAILED: %s\n", g_cases[i].name); }
        else esp_rom_printf("case ok: %s\n", g_cases[i].name);
    }
    esp_rom_printf("NVS_CASES done n=%d failed=%d\n", g_n, g_failed);
    for (;;) vTaskDelay(pdMS_TO_TICKS(1000));
}
