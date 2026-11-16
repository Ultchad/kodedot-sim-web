/* SPDX-License-Identifier: GPL-3.0-or-later
 * The slice of ESP-IDF's esp_adc/adc_continuous.h that kdrv_rfid_lf.c uses (the demod line, 80 kS/s on ADC2).
 * One DMA result is SOC_ADC_DIGI_RESULT_BYTES (4) long: bits 0..11 the count, 12..15 the channel, bit 16 the unit
 * (this bench's own layout; adc_continuous_parse_data() is the only reader, as in the driver). */
#ifndef DOTBENCH_RFID_SHIM_ADC_CONTINUOUS_H
#define DOTBENCH_RFID_SHIM_ADC_CONTINUOUS_H
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
#define SOC_ADC_DIGI_RESULT_BYTES 4
typedef enum { ADC_UNIT_1 = 0, ADC_UNIT_2 = 1 } adc_unit_t;
typedef enum { ADC_CHANNEL_0 = 0, ADC_CHANNEL_1, ADC_CHANNEL_2, ADC_CHANNEL_3, ADC_CHANNEL_4, ADC_CHANNEL_5,
               ADC_CHANNEL_6, ADC_CHANNEL_7 } adc_channel_t;
typedef enum { ADC_ATTEN_DB_0 = 0, ADC_ATTEN_DB_2_5, ADC_ATTEN_DB_6, ADC_ATTEN_DB_12 } adc_atten_t;
typedef enum { ADC_BITWIDTH_12 = 12 } adc_bitwidth_t;
typedef enum { ADC_DIGI_OUTPUT_FORMAT_TYPE1 = 0, ADC_DIGI_OUTPUT_FORMAT_TYPE2 = 1 } adc_digi_output_format_t;
typedef enum { ADC_CONV_SINGLE_UNIT_1 = 1, ADC_CONV_SINGLE_UNIT_2 = 2 } adc_digi_convert_mode_t;
typedef struct dotbench_adc_cont *adc_continuous_handle_t;
typedef struct { uint32_t max_store_buf_size; uint32_t conv_frame_size; } adc_continuous_handle_cfg_t;
typedef struct { adc_atten_t atten; adc_channel_t channel; adc_unit_t unit; adc_bitwidth_t bit_width; } adc_digi_pattern_config_t;
typedef struct {
    uint32_t pattern_num;
    adc_digi_pattern_config_t *adc_pattern;
    uint32_t sample_freq_hz;
    adc_digi_convert_mode_t conv_mode;
    adc_digi_output_format_t format;
} adc_continuous_config_t;
typedef struct { adc_unit_t unit; adc_channel_t channel; int raw_data; bool valid; } adc_continuous_data_t;
esp_err_t adc_continuous_new_handle(const adc_continuous_handle_cfg_t *cfg, adc_continuous_handle_t *out);
esp_err_t adc_continuous_config(adc_continuous_handle_t h, const adc_continuous_config_t *cfg);
esp_err_t adc_continuous_start(adc_continuous_handle_t h);
esp_err_t adc_continuous_stop(adc_continuous_handle_t h);
esp_err_t adc_continuous_read(adc_continuous_handle_t h, uint8_t *buf, uint32_t length_max, uint32_t *out_length, uint32_t timeout_ms);
esp_err_t adc_continuous_deinit(adc_continuous_handle_t h);
esp_err_t adc_continuous_parse_data(adc_continuous_handle_t h, const uint8_t *data, uint32_t num_bytes,
                                    adc_continuous_data_t *parsed, uint32_t *num_samples);
#ifdef __cplusplus
}
#endif
#endif
