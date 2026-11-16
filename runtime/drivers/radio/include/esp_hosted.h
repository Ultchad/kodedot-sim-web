/* SPDX-License-Identifier: GPL-3.0-or-later
 * esp-hosted's host API (v2.12.9) as far as the SDK calls it. The implementation is radio_hosted.c: every call is
 * answered by the faked ESP32-C5 in the JS glue (runtime/drivers/radio/radio.js) over the host bridge.
 * Also declares esp_reset_reason() (ESP-IDF's esp_system.h, which dotbench's own does not carry). */
#ifndef DOTBENCH_ESP_HOSTED_H
#define DOTBENCH_ESP_HOSTED_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "esp_event.h"
#include "esp_mac.h"
#ifdef __cplusplus
extern "C" {
#endif

/* ---- esp_reset_reason (esp_system.h) -------------------------------------- */
typedef enum {
    ESP_RST_UNKNOWN = 0, ESP_RST_POWERON, ESP_RST_EXT, ESP_RST_SW, ESP_RST_PANIC, ESP_RST_INT_WDT, ESP_RST_TASK_WDT,
    ESP_RST_WDT, ESP_RST_DEEPSLEEP, ESP_RST_BROWNOUT, ESP_RST_SDIO, ESP_RST_USB, ESP_RST_JTAG, ESP_RST_EFUSE,
    ESP_RST_PWR_GLITCH, ESP_RST_CPU_LOCKUP,
} esp_reset_reason_t;
esp_reset_reason_t esp_reset_reason(void);
typedef void (*shutdown_handler_t)(void);
esp_err_t esp_unregister_shutdown_handler(shutdown_handler_t handler);

#define ESP_HOSTED_VERSION_MAJOR_1 2
#define ESP_HOSTED_VERSION_MINOR_1 12
#define ESP_HOSTED_VERSION_PATCH_1 9

typedef struct {
    uint32_t major1; uint32_t minor1; uint32_t patch1; int32_t revision; int32_t prerelease; int32_t build;
} esp_hosted_coprocessor_fwver_t;

/* ---- lifecycle and events ---------------------------------------------------- */
ESP_EVENT_DECLARE_BASE(ESP_HOSTED_EVENT);
typedef enum {
    ESP_HOSTED_EVENT_TRANSPORT_UP = 0, ESP_HOSTED_EVENT_TRANSPORT_DOWN, ESP_HOSTED_EVENT_TRANSPORT_FAILURE,
    ESP_HOSTED_EVENT_CP_INIT, ESP_HOSTED_EVENT_CP_HEARTBEAT, ESP_HOSTED_EVENT_CP_DEINIT,
} esp_hosted_event_t;
typedef struct { int32_t reason; } esp_hosted_event_init_t;

esp_err_t esp_hosted_init(void);
esp_err_t esp_hosted_deinit(void);
esp_err_t esp_hosted_connect_to_slave(void);

int esp_hosted_get_coprocessor_fwversion(esp_hosted_coprocessor_fwver_t *ver_info);
int esp_hosted_get_cp_info(uint32_t *cp_chip_id, char *cp_target_name, size_t cp_target_name_len);

/* ---- peer data ------------------------------------------------------------------ */
typedef void (*esp_hosted_custom_data_callback_t)(uint32_t msg_id, const uint8_t *data, size_t len, void *ctx);
esp_err_t esp_hosted_register_custom_callback(uint32_t msg_id, esp_hosted_custom_data_callback_t callback, void *ctx);
esp_err_t esp_hosted_send_custom_data(uint32_t msg_id, const uint8_t *data, size_t len);

/* ---- misc ----------------------------------------------------------------------- */
typedef enum { ESP_HOSTED_MEMMONITOR_NO_CHANGE = 0, ESP_HOSTED_MEMMONITOR_DISABLE = 1, ESP_HOSTED_MEMMONITOR_ENABLE = 2,
} esp_hosted_mem_monitor_config_t;
typedef struct { uint32_t threshold_mem_dma; uint32_t threshold_mem_8bit; } esp_hosted_mem_monitor_threshold_t;
typedef struct { uint32_t free_size; uint32_t largest_free_block; } esp_hosted_mem_info_t;
typedef struct { esp_hosted_mem_info_t cap_dma; esp_hosted_mem_info_t cap_8bit; } esp_hosted_cap_info_t;
typedef struct {
    esp_hosted_mem_monitor_config_t config; bool report_always; uint32_t interval_sec;
    esp_hosted_mem_monitor_threshold_t internal_mem; esp_hosted_mem_monitor_threshold_t external_mem;
} esp_hosted_config_mem_monitor_t;
typedef struct {
    esp_hosted_mem_monitor_config_t config; bool report_always; uint32_t interval_sec; uint32_t curr_total_heap_size;
    esp_hosted_cap_info_t curr_internal; esp_hosted_cap_info_t curr_external;
} esp_hosted_curr_mem_info_t;
typedef struct {
    uint32_t magic_word; uint32_t secure_version; uint32_t reserv1[2]; char version[32]; char project_name[32];
    char time[16]; char date[16]; char idf_ver[32]; uint8_t app_elf_sha256[32]; uint16_t min_efuse_blk_rev_full;
    uint16_t max_efuse_blk_rev_full; uint8_t mmu_page_size; uint8_t reserv3[3]; uint32_t reserv2[18];
} esp_hosted_app_desc_t;
esp_err_t esp_hosted_iface_mac_addr_get(uint8_t *mac, size_t mac_len, esp_mac_type_t type);
esp_err_t esp_hosted_get_coprocessor_app_desc(esp_hosted_app_desc_t *app_desc);
esp_err_t esp_hosted_set_mem_monitor(esp_hosted_config_mem_monitor_t *config, esp_hosted_curr_mem_info_t *curr_mem_info);

/* ---- the C5's own GPIO ----------------------------------------------------------- */
typedef struct { uint64_t pin_bit_mask; uint32_t mode; uint32_t pull_up_en; uint32_t pull_down_en; uint32_t intr_type; }
    esp_hosted_cp_gpio_config_t;
#define H_CP_GPIO_MODE_DEF_INPUT   (1ULL << 0)
#define H_CP_GPIO_MODE_DEF_OUTPUT  (1ULL << 1)
enum { H_CP_GPIO_MODE_DISABLE = 0, H_CP_GPIO_MODE_INPUT = H_CP_GPIO_MODE_DEF_INPUT,
       H_CP_GPIO_MODE_OUTPUT = H_CP_GPIO_MODE_DEF_OUTPUT,
       H_CP_GPIO_MODE_INPUT_OUTPUT = (H_CP_GPIO_MODE_DEF_INPUT | H_CP_GPIO_MODE_DEF_OUTPUT) };
esp_err_t esp_hosted_cp_gpio_config(const esp_hosted_cp_gpio_config_t *cfg);
esp_err_t esp_hosted_cp_gpio_set_level(uint32_t gpio_num, uint32_t level);
esp_err_t esp_hosted_cp_gpio_get_level(uint32_t gpio_num, int *level);
esp_err_t esp_hosted_cp_gpio_input_enable(uint32_t gpio_num);

/* ---- coprocessor OTA ------------------------------------------------------------- */
esp_err_t esp_hosted_slave_ota_begin(void);
esp_err_t esp_hosted_slave_ota_write(uint8_t *ota_data, uint32_t ota_data_len);
esp_err_t esp_hosted_slave_ota_end(void);
esp_err_t esp_hosted_slave_ota_activate(void);

/* ---- Bluetooth controller (for the BLE area; see docs/STATUS-radio.md) ------------ */
esp_err_t esp_hosted_bt_controller_init(void);
esp_err_t esp_hosted_bt_controller_deinit(bool mem_release);
esp_err_t esp_hosted_bt_controller_enable(void);
esp_err_t esp_hosted_bt_controller_disable(void);
#ifdef __cplusplus
}
#endif
#endif
