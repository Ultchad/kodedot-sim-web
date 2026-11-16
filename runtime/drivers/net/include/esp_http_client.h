/* The subset of ESP-IDF's esp_http_client.h that the SDK's kdrv_net.c uses (the low level open / write / fetch_headers / read API).
 * Behind it, net_shim.c hands each request to the JS world, which issues it with fetch() (or answers it from a router's local hosts). */
#ifndef ESP_HTTP_CLIENT_H
#define ESP_HTTP_CLIENT_H
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#ifdef __cplusplus
extern "C" {
#endif

#define ESP_ERR_HTTP_BASE 0x7000
#define ESP_ERR_HTTP_CONNECT (ESP_ERR_HTTP_BASE + 1)
#define ESP_ERR_HTTP_WRITE_DATA (ESP_ERR_HTTP_BASE + 2)
#define ESP_ERR_HTTP_FETCH_HEADER (ESP_ERR_HTTP_BASE + 3)
#define ESP_ERR_HTTP_EAGAIN (ESP_ERR_HTTP_BASE + 8)

typedef struct esp_http_client *esp_http_client_handle_t;
typedef enum { HTTP_METHOD_GET = 0, HTTP_METHOD_POST, HTTP_METHOD_PUT, HTTP_METHOD_PATCH, HTTP_METHOD_DELETE, HTTP_METHOD_HEAD } esp_http_client_method_t;
typedef enum { HTTP_EVENT_ERROR = 0, HTTP_EVENT_ON_CONNECTED, HTTP_EVENT_HEADERS_SENT, HTTP_EVENT_ON_HEADER, HTTP_EVENT_ON_DATA,
               HTTP_EVENT_ON_FINISH, HTTP_EVENT_DISCONNECTED, HTTP_EVENT_REDIRECT } esp_http_client_event_id_t;
typedef struct esp_http_client_event {
    esp_http_client_event_id_t event_id; esp_http_client_handle_t client; void *data; int data_len; void *user_data;
    char *header_key; char *header_value;
} esp_http_client_event_t;
typedef esp_err_t (*http_event_handle_cb)(esp_http_client_event_t *evt);
typedef struct {
    const char *url; const char *host; int port; const char *path; esp_http_client_method_t method; int timeout_ms;
    bool disable_auto_redirect; int max_redirection_count; http_event_handle_cb event_handler;
    esp_err_t (*crt_bundle_attach)(void *conf); void *user_data; int buffer_size; bool keep_alive_enable;
} esp_http_client_config_t;

esp_http_client_handle_t esp_http_client_init(const esp_http_client_config_t *config);
esp_err_t esp_http_client_cleanup(esp_http_client_handle_t client);
esp_err_t esp_http_client_set_header(esp_http_client_handle_t client, const char *key, const char *value);
esp_err_t esp_http_client_set_timeout_ms(esp_http_client_handle_t client, int timeout_ms);
esp_err_t esp_http_client_open(esp_http_client_handle_t client, int write_len);
int esp_http_client_write(esp_http_client_handle_t client, const char *buffer, int len);
int64_t esp_http_client_fetch_headers(esp_http_client_handle_t client);
int esp_http_client_get_status_code(esp_http_client_handle_t client);
int esp_http_client_read(esp_http_client_handle_t client, char *buffer, int len);
bool esp_http_client_is_complete_data_received(esp_http_client_handle_t client);
bool esp_http_client_is_chunked_response(esp_http_client_handle_t client);
bool esp_http_client_is_persistent_connection(esp_http_client_handle_t client);
esp_err_t esp_http_client_close(esp_http_client_handle_t client);

#ifdef __cplusplus
}
#endif
#endif
