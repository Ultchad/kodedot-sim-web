/* SPDX-License-Identifier: GPL-3.0-or-later
 * The slice of ESP-IDF's driver/pulse_cnt.h that kdrv_rfid_lf.c uses (counting a reader's field edges). */
#ifndef DOTBENCH_RFID_SHIM_PULSE_CNT_H
#define DOTBENCH_RFID_SHIM_PULSE_CNT_H
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct dotbench_pcnt_unit *pcnt_unit_handle_t;
typedef struct dotbench_pcnt_chan *pcnt_channel_handle_t;
typedef enum { PCNT_CHANNEL_EDGE_ACTION_HOLD = 0, PCNT_CHANNEL_EDGE_ACTION_INCREASE = 1, PCNT_CHANNEL_EDGE_ACTION_DECREASE = 2 } pcnt_channel_edge_action_t;
typedef struct {
    int low_limit;
    int high_limit;
    struct { uint32_t accum_count : 1; } flags;
} pcnt_unit_config_t;
typedef struct {
    int edge_gpio_num;
    int level_gpio_num;
} pcnt_chan_config_t;
esp_err_t pcnt_new_unit(const pcnt_unit_config_t *cfg, pcnt_unit_handle_t *out);
esp_err_t pcnt_del_unit(pcnt_unit_handle_t unit);
esp_err_t pcnt_new_channel(pcnt_unit_handle_t unit, const pcnt_chan_config_t *cfg, pcnt_channel_handle_t *out);
esp_err_t pcnt_del_channel(pcnt_channel_handle_t ch);
esp_err_t pcnt_channel_set_edge_action(pcnt_channel_handle_t ch, pcnt_channel_edge_action_t pos, pcnt_channel_edge_action_t neg);
esp_err_t pcnt_unit_enable(pcnt_unit_handle_t unit);
esp_err_t pcnt_unit_disable(pcnt_unit_handle_t unit);
esp_err_t pcnt_unit_start(pcnt_unit_handle_t unit);
esp_err_t pcnt_unit_stop(pcnt_unit_handle_t unit);
esp_err_t pcnt_unit_clear_count(pcnt_unit_handle_t unit);
esp_err_t pcnt_unit_get_count(pcnt_unit_handle_t unit, int *value);
#ifdef __cplusplus
}
#endif
#endif
