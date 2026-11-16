/* esp_netif_sntp: the time client. The shim answers with the host's clock through the router (internet on). */
#ifndef ESP_NETIF_SNTP_H
#define ESP_NETIF_SNTP_H
#include <stdbool.h>
#include <sys/time.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef void (*sntp_sync_time_cb_t)(struct timeval *tv);
typedef struct { bool smooth_sync; bool server_from_dhcp; bool wait_for_sync; bool start; bool renew_servers_after_new_IP;
                 int ip_event_to_renew; int index_of_first_server; int num_of_servers; const char *servers[1];
                 sntp_sync_time_cb_t sync_cb; } esp_sntp_config_t;
#define ESP_NETIF_SNTP_DEFAULT_CONFIG(server) { .start = true, .num_of_servers = 1, .servers = { server } }
esp_err_t esp_netif_sntp_init(const esp_sntp_config_t *config);
esp_err_t esp_netif_sntp_start(void);
void esp_netif_sntp_deinit(void);
#ifdef __cplusplus
}
#endif
#endif
