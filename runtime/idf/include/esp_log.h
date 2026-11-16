/* SPDX-License-Identifier: GPL-3.0-or-later
 * ESP-IDF's logging front end, ESP_LOGx writing through a vprintf hook (klog
 * installs one with esp_log_set_vprintf) or, by default, into the bridge's log
 * channel. */
#ifndef DOTBENCH_ESP_LOG_H
#define DOTBENCH_ESP_LOG_H
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef enum {
    ESP_LOG_NONE = 0, ESP_LOG_ERROR, ESP_LOG_WARN, ESP_LOG_INFO, ESP_LOG_DEBUG, ESP_LOG_VERBOSE, ESP_LOG_MAX
} esp_log_level_t;
typedef int (*vprintf_like_t)(const char *, va_list);
void esp_log_level_set(const char *tag, esp_log_level_t level);
esp_log_level_t esp_log_level_get(const char *tag);
vprintf_like_t esp_log_set_vprintf(vprintf_like_t func);
uint32_t esp_log_timestamp(void);
uint32_t esp_log_early_timestamp(void);
void esp_log_write(esp_log_level_t level, const char *tag, const char *format, ...) __attribute__((format(printf, 3, 4)));
void esp_log_writev(esp_log_level_t level, const char *tag, const char *format, va_list args);
#define LOG_FORMAT(letter, format) #letter " (%" PRIu32 ") %s: " format "\n"
#include <inttypes.h>
#define ESP_LOG_LEVEL(level, tag, format, ...) do { \
        if ((level) == ESP_LOG_ERROR)        esp_log_write(ESP_LOG_ERROR,   tag, LOG_FORMAT(E, format), esp_log_timestamp(), tag, ##__VA_ARGS__); \
        else if ((level) == ESP_LOG_WARN)    esp_log_write(ESP_LOG_WARN,    tag, LOG_FORMAT(W, format), esp_log_timestamp(), tag, ##__VA_ARGS__); \
        else if ((level) == ESP_LOG_INFO)    esp_log_write(ESP_LOG_INFO,    tag, LOG_FORMAT(I, format), esp_log_timestamp(), tag, ##__VA_ARGS__); \
        else if ((level) == ESP_LOG_DEBUG)   esp_log_write(ESP_LOG_DEBUG,   tag, LOG_FORMAT(D, format), esp_log_timestamp(), tag, ##__VA_ARGS__); \
        else                                 esp_log_write(ESP_LOG_VERBOSE, tag, LOG_FORMAT(V, format), esp_log_timestamp(), tag, ##__VA_ARGS__); \
    } while (0)
#define ESP_LOGE(tag, format, ...) ESP_LOG_LEVEL(ESP_LOG_ERROR, tag, format, ##__VA_ARGS__)
#define ESP_LOGW(tag, format, ...) ESP_LOG_LEVEL(ESP_LOG_WARN, tag, format, ##__VA_ARGS__)
#define ESP_LOGI(tag, format, ...) ESP_LOG_LEVEL(ESP_LOG_INFO, tag, format, ##__VA_ARGS__)
#define ESP_LOGD(tag, format, ...) ESP_LOG_LEVEL(ESP_LOG_DEBUG, tag, format, ##__VA_ARGS__)
#define ESP_LOGV(tag, format, ...) ESP_LOG_LEVEL(ESP_LOG_VERBOSE, tag, format, ##__VA_ARGS__)
#define ESP_EARLY_LOGE ESP_LOGE
#define ESP_EARLY_LOGW ESP_LOGW
#define ESP_EARLY_LOGI ESP_LOGI
#define ESP_EARLY_LOGD ESP_LOGD
#define ESP_EARLY_LOGV ESP_LOGV
#define ESP_DRAM_LOGE ESP_LOGE
#define ESP_DRAM_LOGW ESP_LOGW
#define ESP_DRAM_LOGI ESP_LOGI
#define ESP_DRAM_LOGD ESP_LOGD
#define ESP_DRAM_LOGV ESP_LOGV
#ifdef __cplusplus
}
#endif
#endif
