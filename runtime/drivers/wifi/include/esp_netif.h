/* The subset of ESP-IDF's esp_netif.h the SDK uses: the station netif's address, DNS and its creation. */
#ifndef ESP_NETIF_H
#define ESP_NETIF_H
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "esp_event.h"
#ifdef __cplusplus
extern "C" {
#endif

ESP_EVENT_DECLARE_BASE(IP_EVENT);
typedef enum { IP_EVENT_STA_GOT_IP = 0, IP_EVENT_STA_LOST_IP } ip_event_t;

typedef struct esp_netif_obj esp_netif_t;
typedef struct { uint32_t addr; } esp_ip4_addr_t;
typedef struct { esp_ip4_addr_t ip; esp_ip4_addr_t netmask; esp_ip4_addr_t gw; } esp_netif_ip_info_t;
typedef struct { esp_netif_ip_info_t ip_info; bool ip_changed; } ip_event_got_ip_t;

typedef struct { uint8_t type; union { struct { uint32_t addr; } ip4; } u_addr; } esp_ip_addr_t;
typedef esp_ip_addr_t ip_addr_t;
typedef enum { ESP_NETIF_DNS_MAIN = 0, ESP_NETIF_DNS_BACKUP, ESP_NETIF_DNS_FALLBACK, ESP_NETIF_DNS_MAX } esp_netif_dns_type_t;
typedef struct { esp_ip_addr_t ip; } esp_netif_dns_info_t;

esp_err_t esp_netif_init(void);
esp_netif_t *esp_netif_create_default_wifi_sta(void);
esp_netif_t *esp_netif_get_handle_from_ifkey(const char *key);
esp_err_t esp_netif_get_ip_info(esp_netif_t *n, esp_netif_ip_info_t *info);
esp_err_t esp_netif_get_dns_info(esp_netif_t *n, esp_netif_dns_type_t t, esp_netif_dns_info_t *dns);

#ifdef __cplusplus
}
#endif
#endif
