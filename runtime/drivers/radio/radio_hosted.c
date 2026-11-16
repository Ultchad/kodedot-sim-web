/* SPDX-License-Identifier: GPL-3.0-or-later
 * esp-hosted's host API over the faked ESP32-C5 (radio.js). The SDK's real kdrv_radio.c / kdrv_c5.c / kdrv_c5svc.c run on top.
 *
 * Every call is one dbh_call to the JS world. Ops (payloads little endian, see radio.js for the matching reader):
 *   hosted.init / hosted.deinit / hosted.connect          rc 0 = ok, else an esp_err_t
 *   hosted.rpc   in: u8 sub, args      out: reply bytes    rc 0 = ok, ESP_ERR_TIMEOUT = the C5 did not answer
 *   hosted.send  in: u32 msg_id, bytes                      peer data to the C5 (esp_hosted_send_custom_data)
 * JS events:
 *   hosted.event   u8 id, i32 reason        -> esp_event ESP_HOSTED_EVENT (transport up/down/failure, CP_INIT)
 *   hosted.peer    u32 msg_id, bytes        -> the callback registered for msg_id, on the platform thread */
#include <pthread.h>
#include <string.h>

#include "dotbench_radio.h"
#include "esp_chip_info.h"
#include "esp_hosted.h"
#include "esp_hosted_transport_config.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "rpc_slave_if.h"
#include "sdkconfig.h"

extern int kdrv_reset_reason(void);

ESP_EVENT_DEFINE_BASE(ESP_HOSTED_EVENT);

enum { RPC_FWVER = 1, RPC_CP_INFO, RPC_APP_DESC, RPC_MEM, RPC_MAC, RPC_GPIO_CFG, RPC_GPIO_SET, RPC_GPIO_GET, RPC_GPIO_IN,
       RPC_OTA_BEGIN, RPC_OTA_WRITE, RPC_OTA_END, RPC_OTA_ACTIVATE };

#define RPC_MS 20000u   /* safety net only: the world answers a silent C5 itself (radio.js rpcTimeoutMs) */

/* ---- reset reason / shutdown handlers ---- */
esp_reset_reason_t esp_reset_reason(void) { return (esp_reset_reason_t)kdrv_reset_reason(); }
esp_err_t esp_unregister_shutdown_handler(shutdown_handler_t h) { (void)h; return ESP_ERR_INVALID_STATE; }

/* ---- the pools and RPC wrappers kdrv_radio.c / kdrv_radio_rpc.c wrap at link time: nothing of esp-hosted is here ---- */
SemaphoreHandle_t hosted_port_mutex;
void *__real_hosted_mempool_create(void *config) { (void)config; return NULL; }
void __real_hosted_mempool_destroy(void *pool) { (void)pool; }
int __real_rpc_send_req(ctrl_cmd_t *r) { (void)r; return -1; }
ctrl_cmd_t *__real_rpc_wait_and_parse_sync_resp(ctrl_cmd_t *r) { (void)r; return NULL; }

/* ---- state ---- */
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;
static int g_inited;
static struct { uint32_t id; esp_hosted_custom_data_callback_t cb; void *ctx; } g_cb[8];
static pthread_once_t g_once = PTHREAD_ONCE_INIT;

static void on_event(const uint8_t *d, size_t n, void *ctx)
{
    (void)ctx;
    dbh_r_t r; dbh_r_init(&r, d, n);
    int id = dbh_r_u8(&r);
    esp_hosted_event_init_t ev = { (int32_t)dbh_r_u32(&r) };
    if (r.bad) return;
    esp_event_post(ESP_HOSTED_EVENT, id, &ev, sizeof(ev), 0);
}
static void on_peer(const uint8_t *d, size_t n, void *ctx)
{
    (void)ctx;
    dbh_r_t r; dbh_r_init(&r, d, n);
    uint32_t id = dbh_r_u32(&r);
    if (r.bad) return;
    esp_hosted_custom_data_callback_t cb = NULL; void *c = NULL;
    pthread_mutex_lock(&g_mu);
    for (int i = 0; i < 8; i++) if (g_cb[i].cb && g_cb[i].id == id) { cb = g_cb[i].cb; c = g_cb[i].ctx; break; }
    pthread_mutex_unlock(&g_mu);
    if (cb) cb(id, d + 4, n - 4, c);
}
static void reg_once(void)
{
    dbh_on_event("hosted.event", on_event, NULL);
    dbh_on_event("hosted.peer", on_peer, NULL);
}

static esp_err_t simple(const char *op)
{
    int rc = dbh_call(op, NULL, 0, NULL, 0, NULL, RPC_MS);
    return rc == 0 ? ESP_OK : (rc == DBH_ERR_TIMEOUT || rc == DBH_ERR_NOHOST) ? ESP_ERR_TIMEOUT : (esp_err_t)(rc ? rc : ESP_FAIL);
}

esp_err_t esp_hosted_init(void)
{
    pthread_once(&g_once, reg_once);
    esp_err_t e = simple("hosted.init");
    if (e == ESP_OK) g_inited = 1;
    return e;
}
esp_err_t esp_hosted_deinit(void)
{
    if (!g_inited) return ESP_ERR_INVALID_STATE;
    g_inited = 0;
    return simple("hosted.deinit");
}
esp_err_t esp_hosted_connect_to_slave(void)
{
    if (!g_inited) return ESP_ERR_INVALID_STATE;
    return simple("hosted.connect");
}

/* One RPC: sub-op + args in, bytes out. */
static esp_err_t rpc(uint8_t sub, const void *args, size_t n, void *out, size_t cap, size_t *got)
{
    uint8_t buf[64];
    if (n > sizeof(buf) - 1) return ESP_ERR_INVALID_SIZE;
    buf[0] = sub;
    if (n) memcpy(buf + 1, args, n);
    int rc = dbh_call("hosted.rpc", buf, n + 1, out, cap, got, RPC_MS);
    if (rc == 0) return ESP_OK;
    if (rc == DBH_ERR_TIMEOUT || rc == DBH_ERR_NOHOST) return ESP_ERR_TIMEOUT;
    return rc > 0 ? rc : ESP_FAIL;
}

int esp_hosted_get_coprocessor_fwversion(esp_hosted_coprocessor_fwver_t *v)
{
    uint32_t o[3]; size_t g = 0;
    esp_err_t e = rpc(RPC_FWVER, NULL, 0, o, sizeof(o), &g);
    if (e != ESP_OK || g < sizeof(o)) return e ? e : ESP_FAIL;
    memset(v, 0, sizeof(*v));
    v->major1 = o[0]; v->minor1 = o[1]; v->patch1 = o[2]; v->revision = -1; v->prerelease = -1; v->build = -1;
    return ESP_OK;
}
int esp_hosted_get_cp_info(uint32_t *chip, char *name, size_t cap)
{
    uint8_t o[32]; size_t g = 0;
    esp_err_t e = rpc(RPC_CP_INFO, NULL, 0, o, sizeof(o), &g);
    if (e != ESP_OK || g < 5) return e ? e : ESP_FAIL;
    dbh_r_t r; dbh_r_init(&r, o, g);
    *chip = dbh_r_u32(&r);
    size_t n; const uint8_t *s = dbh_r_lp(&r, &n);
    if (r.bad) return ESP_FAIL;
    if (cap) { size_t c = n < cap - 1 ? n : cap - 1; memcpy(name, s, c); name[c] = 0; }
    return ESP_OK;
}
esp_err_t esp_hosted_get_coprocessor_app_desc(esp_hosted_app_desc_t *d)
{
    size_t g = 0;
    esp_err_t e = rpc(RPC_APP_DESC, NULL, 0, d, sizeof(*d), &g);
    return e != ESP_OK ? e : (g == sizeof(*d) ? ESP_OK : ESP_ERR_NOT_SUPPORTED);
}
esp_err_t esp_hosted_set_mem_monitor(esp_hosted_config_mem_monitor_t *cfg, esp_hosted_curr_mem_info_t *info)
{
    uint32_t o[4]; size_t g = 0;
    (void)cfg;
    esp_err_t e = rpc(RPC_MEM, NULL, 0, o, sizeof(o), &g);
    if (e != ESP_OK || g < sizeof(o)) return e ? e : ESP_FAIL;
    memset(info, 0, sizeof(*info));
    info->curr_internal.cap_8bit.free_size = o[0];
    info->curr_internal.cap_8bit.largest_free_block = o[1];
    info->curr_internal.cap_dma.free_size = o[2];
    info->curr_internal.cap_dma.largest_free_block = o[3];
    return ESP_OK;
}
esp_err_t esp_hosted_iface_mac_addr_get(uint8_t *mac, size_t len, esp_mac_type_t type)
{
    uint8_t m[6]; size_t g = 0; uint8_t t = (uint8_t)type;
    esp_err_t e = rpc(RPC_MAC, &t, 1, m, 6, &g);
    if (e != ESP_OK || g < 6) return e ? e : ESP_FAIL;
    memcpy(mac, m, len < 6 ? len : 6);
    return ESP_OK;
}

esp_err_t esp_hosted_cp_gpio_config(const esp_hosted_cp_gpio_config_t *c)
{
    uint8_t a[16]; dbh_w_t w; dbh_w_init(&w, a, sizeof(a));
    dbh_w_u32(&w, (uint32_t)c->pin_bit_mask); dbh_w_u32(&w, (uint32_t)(c->pin_bit_mask >> 32)); dbh_w_u32(&w, c->mode);
    return rpc(RPC_GPIO_CFG, a, w.len, NULL, 0, NULL);
}
esp_err_t esp_hosted_cp_gpio_set_level(uint32_t io, uint32_t level)
{
    uint8_t a[8]; dbh_w_t w; dbh_w_init(&w, a, sizeof(a)); dbh_w_u32(&w, io); dbh_w_u32(&w, level);
    return rpc(RPC_GPIO_SET, a, w.len, NULL, 0, NULL);
}
esp_err_t esp_hosted_cp_gpio_get_level(uint32_t io, int *level)
{
    uint8_t o[4]; size_t g = 0;
    esp_err_t e = rpc(RPC_GPIO_GET, &io, 4, o, 4, &g);
    if (e != ESP_OK || g < 1) return e ? e : ESP_FAIL;
    *level = o[0];
    return ESP_OK;
}
esp_err_t esp_hosted_cp_gpio_input_enable(uint32_t io) { return rpc(RPC_GPIO_IN, &io, 4, NULL, 0, NULL); }

esp_err_t esp_hosted_slave_ota_begin(void) { return rpc(RPC_OTA_BEGIN, NULL, 0, NULL, 0, NULL); }
esp_err_t esp_hosted_slave_ota_write(uint8_t *d, uint32_t n)
{
    /* the bytes ride as a pointer-free count: the world only needs the length (it keeps a running size and checksum
       taken from the first 4 bytes of the chunk, enough to tell a sane image from garbage in tests) */
    uint8_t a[16]; dbh_w_t w; dbh_w_init(&w, a, sizeof(a)); dbh_w_u32(&w, n);
    dbh_w_bytes(&w, d, n < 8 ? n : 8);
    return rpc(RPC_OTA_WRITE, a, w.len, NULL, 0, NULL);
}
esp_err_t esp_hosted_slave_ota_end(void) { return rpc(RPC_OTA_END, NULL, 0, NULL, 0, NULL); }
esp_err_t esp_hosted_slave_ota_activate(void) { return rpc(RPC_OTA_ACTIVATE, NULL, 0, NULL, 0, NULL); }

/* ---- the transport's own description: nothing to ask the C5 ---- */
esp_hosted_transport_err_t esp_hosted_sdio_get_config(struct esp_hosted_sdio_config **config)
{
    static struct esp_hosted_sdio_config c;
    c.clock_freq_khz = CONFIG_ESP_HOSTED_SDIO_CLOCK_FREQ_KHZ;
    c.bus_width = 4;
    c.slot = 1;
    *config = &c;
    return ESP_TRANSPORT_OK;
}

/* ---- peer data ---- */
esp_err_t esp_hosted_register_custom_callback(uint32_t id, esp_hosted_custom_data_callback_t cb, void *ctx)
{
    pthread_once(&g_once, reg_once);
    esp_err_t rc = ESP_ERR_NO_MEM;
    pthread_mutex_lock(&g_mu);
    for (int i = 0; i < 8; i++) if (g_cb[i].cb && g_cb[i].id == id) { g_cb[i].cb = cb; g_cb[i].ctx = ctx; rc = ESP_OK; break; }
    for (int i = 0; i < 8 && rc != ESP_OK; i++) if (!g_cb[i].cb) { g_cb[i].id = id; g_cb[i].cb = cb; g_cb[i].ctx = ctx; rc = ESP_OK; }
    pthread_mutex_unlock(&g_mu);
    return rc;
}
esp_err_t esp_hosted_send_custom_data(uint32_t id, const uint8_t *data, size_t len)
{
    if (len > 4096) return ESP_ERR_INVALID_SIZE;
    static __thread uint8_t buf[4096 + 8];
    dbh_w_t w; dbh_w_init(&w, buf, sizeof(buf)); dbh_w_u32(&w, id); dbh_w_bytes(&w, data, len);
    int rc = dbh_call("hosted.send", buf, w.len, NULL, 0, NULL, RPC_MS);
    return rc == 0 ? ESP_OK : ESP_FAIL;
}
