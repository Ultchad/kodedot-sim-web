/* The subset of ESP-IDF's ping_sock.h the SDK uses. Echoes are answered by the router world (host table, then a fetch reachability check). */
#ifndef PING_SOCK_H
#define PING_SOCK_H
#include <stdint.h>
#include "esp_err.h"
#include "esp_netif.h"
#ifdef __cplusplus
extern "C" {
#endif
#define IPADDR_TYPE_V4 0U
typedef void *esp_ping_handle_t;
typedef struct { uint32_t count; uint32_t interval_ms; uint32_t timeout_ms; uint32_t data_size; uint8_t tos; uint8_t ttl;
                 ip_addr_t target_addr; uint32_t task_stack_size; uint32_t task_prio; uint32_t interface; } esp_ping_config_t;
#define ESP_PING_DEFAULT_CONFIG() { .count = 5, .interval_ms = 1000, .timeout_ms = 1000, .data_size = 64, .tos = 0, .ttl = 64, \
                                    .task_stack_size = 2048, .task_prio = 2, .interface = 0 }
typedef struct { void (*on_ping_success)(esp_ping_handle_t hdl, void *args); void (*on_ping_timeout)(esp_ping_handle_t hdl, void *args);
                 void (*on_ping_end)(esp_ping_handle_t hdl, void *args); void *cb_args; } esp_ping_callbacks_t;
typedef enum { ESP_PING_PROF_SEQNO, ESP_PING_PROF_TTL, ESP_PING_PROF_REQUEST, ESP_PING_PROF_REPLY, ESP_PING_PROF_IPADDR,
               ESP_PING_PROF_SIZE, ESP_PING_PROF_TIMEGAP, ESP_PING_PROF_TRIPTIME, ESP_PING_PROF_DURATION } esp_ping_profile_t;
esp_err_t esp_ping_new_session(const esp_ping_config_t *config, const esp_ping_callbacks_t *cbs, esp_ping_handle_t *hdl_out);
esp_err_t esp_ping_start(esp_ping_handle_t hdl);
esp_err_t esp_ping_stop(esp_ping_handle_t hdl);
esp_err_t esp_ping_delete_session(esp_ping_handle_t hdl);
esp_err_t esp_ping_get_profile(esp_ping_handle_t hdl, esp_ping_profile_t p, void *data, uint32_t size);
#ifdef __cplusplus
}
#endif
#endif
