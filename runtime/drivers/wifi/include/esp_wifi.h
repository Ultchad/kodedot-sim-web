/* The subset of ESP-IDF's esp_wifi.h (esp_wifi_remote's API) that the SDK's kdrv_wifi.c uses. The calls land in wifi_shim.c. */
#ifndef ESP_WIFI_H
#define ESP_WIFI_H
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "esp_event.h"
#include "esp_hosted.h"   /* esp_unregister_shutdown_handler / shutdown_handler_t, as esp_system.h has them in IDF */
#ifdef __cplusplus
extern "C" {
#endif

ESP_EVENT_DECLARE_BASE(WIFI_EVENT);

typedef enum { WIFI_MODE_NULL = 0, WIFI_MODE_STA, WIFI_MODE_AP, WIFI_MODE_APSTA } wifi_mode_t;
typedef enum { WIFI_IF_STA = 0, WIFI_IF_AP } wifi_interface_t;
typedef enum { WIFI_AUTH_OPEN = 0, WIFI_AUTH_WEP, WIFI_AUTH_WPA_PSK, WIFI_AUTH_WPA2_PSK, WIFI_AUTH_WPA_WPA2_PSK,
               WIFI_AUTH_ENTERPRISE, WIFI_AUTH_WPA3_PSK, WIFI_AUTH_WPA2_WPA3_PSK, WIFI_AUTH_WAPI_PSK, WIFI_AUTH_OWE,
               WIFI_AUTH_WPA3_ENT_192, WIFI_AUTH_WPA3_EXT_PSK, WIFI_AUTH_WPA3_EXT_PSK_MIXED_MODE, WIFI_AUTH_DPP,
               WIFI_AUTH_WPA3_ENTERPRISE, WIFI_AUTH_WPA2_WPA3_ENTERPRISE, WIFI_AUTH_MAX } wifi_auth_mode_t;
typedef enum { WIFI_SCAN_TYPE_ACTIVE = 0, WIFI_SCAN_TYPE_PASSIVE } wifi_scan_type_t;
typedef enum { WIFI_PS_NONE, WIFI_PS_MIN_MODEM, WIFI_PS_MAX_MODEM } wifi_ps_type_t;
typedef enum { WIFI_BAND_MODE_2G_ONLY = 1, WIFI_BAND_MODE_5G_ONLY, WIFI_BAND_MODE_AUTO } wifi_band_mode_t;

/* the reasons IDF numbers (only the values the SDK and the world use) */
typedef enum {
    WIFI_REASON_UNSPECIFIED = 1, WIFI_REASON_AUTH_EXPIRE = 2, WIFI_REASON_AUTH_LEAVE = 3, WIFI_REASON_ASSOC_EXPIRE = 4,
    WIFI_REASON_ASSOC_TOOMANY = 5, WIFI_REASON_NOT_AUTHED = 6, WIFI_REASON_NOT_ASSOCED = 7, WIFI_REASON_ASSOC_LEAVE = 8,
    WIFI_REASON_ASSOC_NOT_AUTHED = 9, WIFI_REASON_MIC_FAILURE = 14, WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT = 15,
    WIFI_REASON_HANDSHAKE_TIMEOUT = 204, WIFI_REASON_BEACON_TIMEOUT = 200, WIFI_REASON_NO_AP_FOUND = 201,
    WIFI_REASON_AUTH_FAIL = 202, WIFI_REASON_ASSOC_FAIL = 203, WIFI_REASON_CONNECTION_FAIL = 205,
    WIFI_REASON_NO_AP_FOUND_IN_RSSI_THRESHOLD = 211
} wifi_err_reason_t;

typedef enum { WIFI_EVENT_WIFI_READY = 0, WIFI_EVENT_SCAN_DONE, WIFI_EVENT_STA_START, WIFI_EVENT_STA_STOP,
               WIFI_EVENT_STA_CONNECTED, WIFI_EVENT_STA_DISCONNECTED } wifi_event_t;

typedef struct { uint8_t ssid[32]; uint8_t ssid_len; uint8_t bssid[6]; uint8_t channel; wifi_auth_mode_t authmode; }
    wifi_event_sta_connected_t;
typedef struct { uint8_t ssid[32]; uint8_t ssid_len; uint8_t bssid[6]; uint8_t reason; int8_t rssi; } wifi_event_sta_disconnected_t;

typedef struct { uint8_t bssid[6]; uint8_t ssid[33]; uint8_t primary; int second; int8_t rssi; wifi_auth_mode_t authmode;
                 wifi_auth_mode_t pairwise_cipher; wifi_auth_mode_t group_cipher; uint32_t phy_flags; } wifi_ap_record_t;

typedef struct { uint16_t ghz_2_channels; uint32_t ghz_5_channels; } wifi_scan_channel_bitmap_t;
typedef struct { struct { uint32_t min; uint32_t max; } active; uint32_t passive; } wifi_scan_time_t;
typedef struct {
    uint8_t *ssid; uint8_t *bssid; uint8_t channel; bool show_hidden; wifi_scan_type_t scan_type; wifi_scan_time_t scan_time;
    uint8_t home_chan_dwell_time; wifi_scan_channel_bitmap_t channel_bitmap;
} wifi_scan_config_t;

typedef struct { char cc[3]; uint8_t schan; uint8_t nchan; int8_t max_tx_power; int policy; } wifi_country_t;

typedef union {
    struct { uint8_t ssid[32]; uint8_t password[64]; int scan_method; bool bssid_set; uint8_t bssid[6]; uint8_t channel; } sta;
} wifi_config_t;

typedef struct { int dummy; } wifi_init_config_t;
#define WIFI_INIT_CONFIG_DEFAULT() { 0 }

esp_err_t esp_wifi_init(const wifi_init_config_t *cfg);
esp_err_t esp_wifi_deinit(void);
esp_err_t esp_wifi_start(void);
esp_err_t esp_wifi_stop(void);
esp_err_t esp_wifi_set_mode(wifi_mode_t mode);
esp_err_t esp_wifi_set_config(wifi_interface_t ifx, wifi_config_t *conf);
esp_err_t esp_wifi_connect(void);
esp_err_t esp_wifi_disconnect(void);
esp_err_t esp_wifi_scan_start(const wifi_scan_config_t *cfg, bool block);
esp_err_t esp_wifi_scan_stop(void);
esp_err_t esp_wifi_scan_get_ap_num(uint16_t *n);
esp_err_t esp_wifi_scan_get_ap_record(wifi_ap_record_t *rec);
esp_err_t esp_wifi_clear_ap_list(void);
esp_err_t esp_wifi_sta_get_ap_info(wifi_ap_record_t *ap);
esp_err_t esp_wifi_get_country(wifi_country_t *country);
esp_err_t esp_wifi_set_ps(wifi_ps_type_t type);
esp_err_t esp_wifi_set_band_mode(wifi_band_mode_t mode);

#ifdef __cplusplus
}
#endif
#endif
