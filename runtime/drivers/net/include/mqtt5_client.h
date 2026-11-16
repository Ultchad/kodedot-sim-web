/* MQTT 5 connect property: accepted, and recorded by the world (the broker model speaks 3.1.1 on the wire; see STATUS-radio.md). */
#ifndef MQTT5_CLIENT_H
#define MQTT5_CLIENT_H
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "mqtt_client.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct { uint32_t session_expiry_interval; uint32_t maximum_packet_size; uint16_t receive_maximum; uint16_t topic_alias_maximum;
                 bool request_resp_info; bool request_problem_info; const char *will_topic; } esp_mqtt5_connection_property_config_t;
esp_err_t esp_mqtt5_client_set_connect_property(esp_mqtt_client_handle_t client, const esp_mqtt5_connection_property_config_t *prop);
#ifdef __cplusplus
}
#endif
#endif
