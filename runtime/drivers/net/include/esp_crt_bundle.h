/* ESP-IDF's certificate bundle hook. Browsers verify TLS themselves: attaching is accepted and does nothing. */
#ifndef ESP_CRT_BUNDLE_H
#define ESP_CRT_BUNDLE_H
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
esp_err_t esp_crt_bundle_attach(void *conf);
#ifdef __cplusplus
}
#endif
#endif
