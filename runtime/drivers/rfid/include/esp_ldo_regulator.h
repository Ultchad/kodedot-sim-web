/* SPDX-License-Identifier: GPL-3.0-or-later
 * The slice of ESP-IDF's esp_ldo_regulator.h that kdrv_rfid_lf.c uses (VO4, the T5577 write boost).
 *
 * This header is also where the RFID bench takes over the driver's clock. kdrv_rfid_lf.c times a T5577 downlink
 * with esp_rom_delay_us() and the carrier gaps of khal_pwm_pause()/resume(); a wall clock under a loaded host
 * cannot be decoded reliably (a 192 us pulse can last 2 ms). Only in the translation unit of kdrv_rfid_lf.c
 * (guarded by KDRV_RFID_LF_H_, which that file includes first) the two calls the driver times itself with are
 * redirected to the bench: esp_rom_delay_us() advances a virtual microsecond clock (and still sleeps, so the
 * driver takes as long as on the board), and vTaskDelay() additionally tells the PCNT model how long the driver
 * meant to count. Nothing else in the driver changes; the gap decoder reads the virtual clock. */
#ifndef DOTBENCH_RFID_SHIM_ESP_LDO_REGULATOR_H
#define DOTBENCH_RFID_SHIM_ESP_LDO_REGULATOR_H
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct dotbench_ldo *esp_ldo_channel_handle_t;
typedef struct {
    int chan_id;
    int voltage_mv;
    struct { uint32_t adjustable : 1; uint32_t owned_by_hw : 1; } flags;
} esp_ldo_channel_config_t;
esp_err_t esp_ldo_acquire_channel(const esp_ldo_channel_config_t *cfg, esp_ldo_channel_handle_t *out);
esp_err_t esp_ldo_release_channel(esp_ldo_channel_handle_t h);

#ifdef KDRV_RFID_LF_H_
void dotbench_rfid_delay_us(uint32_t us);
void dotbench_rfid_vtaskdelay(uint32_t ticks);
#define esp_rom_delay_us dotbench_rfid_delay_us
#define vTaskDelay dotbench_rfid_vtaskdelay
#endif
#ifdef __cplusplus
}
#endif
#endif
