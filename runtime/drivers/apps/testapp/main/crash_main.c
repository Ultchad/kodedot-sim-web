/* SPDX-License-Identifier: GPL-3.0-or-later
 * An app that announces itself and aborts two seconds later (a crash in an app must bring kodeOS back). */
#include <stdlib.h>
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "kapp_desc.h"
#include "kdrv_slot.h"

KODE_APP_MANIFEST("Crash Test", "example");

void app_main(void)
{
    esp_rom_printf("crash_app: started, reset reason %d\n", kdrv_reset_reason());
    vTaskDelay(pdMS_TO_TICKS(2000));
    esp_rom_printf("crash_app: aborting\n");
    abort();
}
