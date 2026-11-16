/* Each boot: verify what the previous boot stored (all four types, a two-chunk blob), then store the next generation and restart. */
#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "khal_nvs.h"
#include "khal_system.h"

#define NS "persist"
#define BLOB_N 7000
static void pattern(uint8_t *b, uint64_t v) { for (int i = 0; i < BLOB_N; i++) b[i] = (uint8_t)((v * 31 + (uint64_t)i * 7) ^ (uint64_t)(i >> 8)); }

void app_main(void)
{
    static uint8_t blob[BLOB_N], want[BLOB_N];
    uint64_t cnt = 0; char s[32] = ""; uint8_t b8 = 0; size_t len = sizeof blob;
    int ok = 1;
    kode_status_t c = khal_nvs_get_u64(NS, "cnt", &cnt);
    if (c == KODE_OK) {
        snprintf(s, sizeof s, "gen-%llu", (unsigned long long)cnt);
        char got[32] = "";
        if (khal_nvs_get_str(NS, "name", got, sizeof got) != KODE_OK || strcmp(got, s)) ok = 0;
        if (khal_nvs_get_u8(NS, "b", &b8) != KODE_OK || b8 != (uint8_t)cnt) ok = 0;
        pattern(want, cnt);
        if (khal_nvs_get_blob(NS, "blob", blob, &len) != KODE_OK || len != BLOB_N || memcmp(blob, want, BLOB_N)) ok = 0;
    } else if (c != KODE_DENIED) ok = 0;
    cnt++;
    snprintf(s, sizeof s, "gen-%llu", (unsigned long long)cnt);
    pattern(want, cnt);
    if (khal_nvs_set_blob(NS, "blob", want, BLOB_N) != KODE_OK || khal_nvs_set_str(NS, "name", s) != KODE_OK
        || khal_nvs_set_u8(NS, "b", (uint8_t)cnt) != KODE_OK || khal_nvs_set_u64(NS, "cnt", cnt) != KODE_OK) ok = 0;
    esp_rom_printf("PERSIST gen=%llu verify=%s\n", (unsigned long long)cnt, ok ? "ok" : "BAD");
    vTaskDelay(pdMS_TO_TICKS(50));
    khal_restart();
}
