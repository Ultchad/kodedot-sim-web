/* SPDX-License-Identifier: GPL-3.0-or-later
 * esp_wifi / esp_netif over the router bench objects (wifi.js). The SDK's real kdrv_wifi.c runs on top of this.
 *
 * Each call is one dbh_call "wifi.*" / "netif.*" to the JS world; the world answers rc 0 or an esp_err_t, and
 * delivers WIFI_EVENT / IP_EVENT as the event "wifi.event" (u8 base 0=WIFI 1=IP, i32 id, payload), which is posted
 * to the esp_event loop on the radio platform thread, where kdrv_wifi's handler runs. */
#include <pthread.h>
#include <string.h>

#include "dotbench_radio.h"
#include "esp_netif.h"
#include "esp_wifi.h"

#define WIFI_MS 15000u
#define ERR_NOT_CONNECT 0x3006

static pthread_once_t g_once = PTHREAD_ONCE_INIT;
static esp_netif_t *g_sta;
struct esp_netif_obj { int dummy; };
static struct esp_netif_obj g_sta_obj;

static esp_err_t rcof(int rc)
{
    if (rc == 0) return ESP_OK;
    if (rc == DBH_ERR_TIMEOUT || rc == DBH_ERR_NOHOST || rc == DBH_ERR_NOOP) return ESP_ERR_TIMEOUT;
    return rc > 0 ? (esp_err_t)rc : ESP_FAIL;
}
static esp_err_t call(const char *op, const void *in, size_t n, void *out, size_t cap, size_t *got)
{
    return rcof(dbh_call(op, in, n, out, cap, got, WIFI_MS));
}

static void on_wifi_event(const uint8_t *d, size_t n, void *ctx)
{
    (void)ctx;
    dbh_r_t r; dbh_r_init(&r, d, n);
    int base = dbh_r_u8(&r);
    int32_t id = (int32_t)dbh_r_u32(&r);
    if (r.bad) return;
    if (base == 0) {
        if (id == WIFI_EVENT_STA_DISCONNECTED) {
            wifi_event_sta_disconnected_t e; memset(&e, 0, sizeof(e));
            e.reason = (uint8_t)dbh_r_u16(&r);   /* IDF's field is 8 bit; 200+ reasons are mapped by the world */
            e.rssi = (int8_t)dbh_r_u8(&r);
            esp_event_post(WIFI_EVENT, id, &e, sizeof(e), 0);
        } else if (id == WIFI_EVENT_STA_CONNECTED) {
            wifi_event_sta_connected_t e; memset(&e, 0, sizeof(e));
            e.channel = dbh_r_u8(&r);
            esp_event_post(WIFI_EVENT, id, &e, sizeof(e), 0);
        } else {
            esp_event_post(WIFI_EVENT, id, NULL, 0, 0);
        }
    } else {
        ip_event_got_ip_t e; memset(&e, 0, sizeof(e));
        e.ip_info.ip.addr = dbh_r_u32(&r);
        e.ip_info.netmask.addr = dbh_r_u32(&r);
        e.ip_info.gw.addr = dbh_r_u32(&r);
        esp_event_post(IP_EVENT, id, &e, sizeof(e), 0);
    }
}
static void reg_once(void) { dbh_on_event("wifi.event", on_wifi_event, NULL); }

esp_err_t esp_wifi_init(const wifi_init_config_t *cfg) { (void)cfg; pthread_once(&g_once, reg_once); return call("wifi.init", NULL, 0, NULL, 0, NULL); }
esp_err_t esp_wifi_deinit(void) { return call("wifi.deinit", NULL, 0, NULL, 0, NULL); }
esp_err_t esp_wifi_start(void) { return call("wifi.start", NULL, 0, NULL, 0, NULL); }
esp_err_t esp_wifi_stop(void) { return call("wifi.stop", NULL, 0, NULL, 0, NULL); }
esp_err_t esp_wifi_set_mode(wifi_mode_t m) { uint8_t b = (uint8_t)m; return call("wifi.mode", &b, 1, NULL, 0, NULL); }

esp_err_t esp_wifi_set_config(wifi_interface_t ifx, wifi_config_t *c)
{
    (void)ifx;
    uint8_t buf[2 + 32 + 2 + 64 + 2]; dbh_w_t w; dbh_w_init(&w, buf, sizeof(buf));
    dbh_w_lp(&w, c->sta.ssid, strnlen((const char *)c->sta.ssid, 32));
    dbh_w_lp(&w, c->sta.password, strnlen((const char *)c->sta.password, 64));
    return call("wifi.config", buf, w.len, NULL, 0, NULL);
}
esp_err_t esp_wifi_connect(void) { return call("wifi.connect", NULL, 0, NULL, 0, NULL); }
esp_err_t esp_wifi_disconnect(void) { return call("wifi.disconnect", NULL, 0, NULL, 0, NULL); }

esp_err_t esp_wifi_scan_start(const wifi_scan_config_t *cfg, bool block)
{
    uint8_t buf[32]; dbh_w_t w; dbh_w_init(&w, buf, sizeof(buf));
    dbh_w_u8(&w, cfg ? cfg->channel : 0);
    dbh_w_u8(&w, cfg ? cfg->show_hidden : 0);
    dbh_w_u8(&w, cfg ? (uint8_t)cfg->scan_type : 0);
    dbh_w_u32(&w, cfg ? cfg->scan_time.active.min : 0);
    dbh_w_u32(&w, cfg ? cfg->scan_time.active.max : 0);
    dbh_w_u32(&w, cfg ? cfg->scan_time.passive : 0);
    dbh_w_u16(&w, cfg ? cfg->channel_bitmap.ghz_2_channels : 0);
    dbh_w_u32(&w, cfg ? cfg->channel_bitmap.ghz_5_channels : 0);
    dbh_w_u8(&w, block);
    return call("wifi.scan", buf, w.len, NULL, 0, NULL);
}
esp_err_t esp_wifi_scan_stop(void) { return call("wifi.scan_stop", NULL, 0, NULL, 0, NULL); }
esp_err_t esp_wifi_scan_get_ap_num(uint16_t *n)
{
    uint8_t o[2]; size_t g = 0;
    esp_err_t e = call("wifi.scan_num", NULL, 0, o, 2, &g);
    if (e != ESP_OK || g < 2) return e ? e : ESP_FAIL;
    *n = (uint16_t)(o[0] | (o[1] << 8));
    return ESP_OK;
}
/* the record: lp ssid, bssid[6], u8 primary, i8 rssi, u8 auth */
static esp_err_t read_rec(const char *op, wifi_ap_record_t *rec)
{
    uint8_t o[64]; size_t g = 0;
    esp_err_t e = call(op, NULL, 0, o, sizeof(o), &g);
    if (e != ESP_OK) return e;
    dbh_r_t r; dbh_r_init(&r, o, g);
    size_t n; const uint8_t *s = dbh_r_lp(&r, &n);
    memset(rec, 0, sizeof(*rec));
    if (n > 32) n = 32;
    memcpy(rec->ssid, s, n);
    for (int i = 0; i < 6; i++) rec->bssid[i] = dbh_r_u8(&r);
    rec->primary = dbh_r_u8(&r);
    rec->rssi = (int8_t)dbh_r_u8(&r);
    rec->authmode = (wifi_auth_mode_t)dbh_r_u8(&r);
    return r.bad ? ESP_FAIL : ESP_OK;
}
esp_err_t esp_wifi_scan_get_ap_record(wifi_ap_record_t *rec) { return read_rec("wifi.scan_rec", rec); }
esp_err_t esp_wifi_clear_ap_list(void) { return call("wifi.scan_clear", NULL, 0, NULL, 0, NULL); }
esp_err_t esp_wifi_sta_get_ap_info(wifi_ap_record_t *ap) { return read_rec("wifi.ap_info", ap); }
esp_err_t esp_wifi_get_country(wifi_country_t *c)
{
    uint8_t o[4]; size_t g = 0;
    esp_err_t e = call("wifi.country", NULL, 0, o, sizeof(o), &g);
    if (e != ESP_OK || g < 2) return e ? e : ESP_FAIL;
    memset(c, 0, sizeof(*c));
    c->cc[0] = 'X'; c->cc[1] = 'X';
    c->schan = o[0]; c->nchan = o[1];
    return ESP_OK;
}
esp_err_t esp_wifi_set_ps(wifi_ps_type_t t) { uint8_t b = (uint8_t)t; return call("wifi.ps", &b, 1, NULL, 0, NULL); }
esp_err_t esp_wifi_set_band_mode(wifi_band_mode_t m) { uint8_t b = (uint8_t)m; return call("wifi.band", &b, 1, NULL, 0, NULL); }

/* ---- esp_netif: one station interface, its address from the router that has us ---- */
esp_err_t esp_netif_init(void) { return ESP_OK; }
esp_netif_t *esp_netif_create_default_wifi_sta(void) { g_sta = &g_sta_obj; return g_sta; }
esp_netif_t *esp_netif_get_handle_from_ifkey(const char *key)
{
    return (g_sta && key && strcmp(key, "WIFI_STA_DEF") == 0) ? g_sta : NULL;
}
static esp_err_t read_ip(uint32_t v[4])
{
    uint8_t o[16]; size_t g = 0;
    esp_err_t e = call("netif.ip", NULL, 0, o, sizeof(o), &g);
    if (e != ESP_OK || g < 16) return e ? e : ERR_NOT_CONNECT;
    dbh_r_t r; dbh_r_init(&r, o, g);
    for (int i = 0; i < 4; i++) v[i] = dbh_r_u32(&r);
    return ESP_OK;
}
esp_err_t esp_netif_get_ip_info(esp_netif_t *n, esp_netif_ip_info_t *info)
{
    uint32_t v[4];
    (void)n;
    esp_err_t e = read_ip(v);
    if (e != ESP_OK) return e;
    info->ip.addr = v[0]; info->netmask.addr = v[1]; info->gw.addr = v[2];
    return ESP_OK;
}
esp_err_t esp_netif_get_dns_info(esp_netif_t *n, esp_netif_dns_type_t t, esp_netif_dns_info_t *dns)
{
    uint32_t v[4];
    (void)n; (void)t;
    esp_err_t e = read_ip(v);
    if (e != ESP_OK) return e;
    memset(dns, 0, sizeof(*dns));
    dns->ip.u_addr.ip4.addr = v[3];
    return ESP_OK;
}
