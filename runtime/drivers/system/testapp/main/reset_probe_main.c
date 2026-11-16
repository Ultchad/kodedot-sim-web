/* SPDX-License-Identifier: GPL-3.0-or-later
 * Prints what survived the previous boot, then asks for a restart. */
#include <stdint.h>
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "khal_keep.h"
#include "khal_nvs.h"
#include "khal_system.h"
#include "kdrv_slot.h"

typedef struct { uint32_t magic, count; } keep_t;
static int g_ram;   /* RAM state: zero at every boot */

void app_main(void)
{
    keep_t *k = khal_keep();
    if (k->magic != 0x4B454550u) { k->magic = 0x4B454550u; k->count = 0; }
    k->count++;
    uint8_t n = 0;
    (void)khal_nvs_init();
    (void)khal_nvs_get_u8("probe", "boots", &n);
    n++;
    (void)khal_nvs_set_u8("probe", "boots", n);
    g_ram++;
    esp_rom_printf("probe boot reason=%d keep=%u nvs=%u ram=%d\n", kdrv_reset_reason(), (unsigned)k->count, (unsigned)n, g_ram);
    vTaskDelay(pdMS_TO_TICKS(100));
    khal_restart();
}
