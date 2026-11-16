/* SPDX-License-Identifier: GPL-3.0-or-later
 * Placeholder for ESP-IDF's soc/soc_caps.h so that kdrv_rfid_lf.c compiles. The one constant it needs
 * (SOC_ADC_DIGI_RESULT_BYTES) lives in esp_adc/adc_continuous.h of this bench. If another area adds its own
 * soc/soc_caps.h, either one satisfies the RFID driver. */
#ifndef DOTBENCH_RFID_SHIM_SOC_CAPS_H
#define DOTBENCH_RFID_SHIM_SOC_CAPS_H
#endif
