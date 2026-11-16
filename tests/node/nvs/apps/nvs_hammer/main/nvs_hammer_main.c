/* Verifies the store left by a previous (possibly killed) run, then rewrites it forever: a 6000-byte blob whose bytes
 * are a function of its version, then a u64 with the same version. A cut can only leave blob version >= u64 version. */
#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "khal_nvs.h"

#define NS "hammer"
#define N 6000
static void fill(uint8_t *b, uint64_t v) { memcpy(b, &v, 8); for (int i = 8; i < N; i++) b[i] = (uint8_t)(v * 13 + (uint64_t)i * 5); }
void app_main(void)
{
    static uint8_t blob[N], want[N];
    uint64_t v = 0, cnt = 0; size_t len = sizeof blob;
    const char *verdict = "fresh";
    kode_status_t sb = khal_nvs_get_blob(NS, "blob", blob, &len);
    kode_status_t sc = khal_nvs_get_u64(NS, "cnt", &cnt);
    if (sb == KODE_OK) {
        memcpy(&v, blob, 8); fill(want, v);
        if (len != N || memcmp(blob, want, N)) verdict = "BAD-blob";
        else if (sc != KODE_OK || cnt > v || v - cnt > 1) verdict = "BAD-cnt";
        else verdict = "ok";
    } else if (sb != KODE_DENIED || sc == KODE_OK) verdict = "BAD-state";
    esp_rom_printf("HAMMER verify=%s v=%llu cnt=%llu\n", verdict, (unsigned long long)v, (unsigned long long)cnt);
    if (sb == KODE_OK && cnt < v) khal_nvs_set_u64(NS, "cnt", v);   /* repair: the previous run was cut between its two writes */
    v++;
    for (;;) {
        fill(want, v);
        khal_nvs_set_blob(NS, "blob", want, N);
        khal_nvs_set_u64(NS, "cnt", v);
        khal_nvs_set_str(NS, "pad", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
        v++;
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}
