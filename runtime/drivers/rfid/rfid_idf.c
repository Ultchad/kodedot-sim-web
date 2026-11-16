/* SPDX-License-Identifier: GPL-3.0-or-later
 * The ESP-IDF peripherals the SDK's real kdrv_rfid_lf.c drives, as the 125 kHz bench's world sees them:
 *   adc_continuous_*   the demod line, 80 kS/s on ADC2 channel 5, paced in real time, samples from rfid_bench.c
 *   khal_pwm_port_*    the LEDC timers/channels under the SDK's real khal_pwm.c; the carrier on RFID_OUT, and a timer
 *                      pause/resume is a T5577 write gap (weak symbols, see below)
 *   parlio_tx_*        the emulated tag's looped bit stream on RFID_PULL
 *   pcnt_*             the field-frequency count on RFID_CARRIER
 *   esp_ldo_*          VO4, the write boost
 *   gpio_*             accepted; RFID_PULL's level is recorded
 *   dotbench_rfid_delay_us / _vtaskdelay   the virtual clock (see include/esp_ldo_regulator.h)
 * Nothing here decodes a tag or knows an EM4100 frame: that is the SDK's job above and the world's below. */
#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "driver/gpio.h"
#include "driver/parlio_tx.h"
#include "driver/pulse_cnt.h"
#include "esp_adc/adc_continuous.h"
#include "esp_ldo_regulator.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "kode_defs.h"
#include "kbsp_pins.h"
#include "rfid_bench.h"

/* ---- virtual clock ---- */
static uint64_t g_vt_us;            /* advanced by the driver's busy waits; only the worker task runs them */
static __thread uint32_t t_last_delay_ticks;

static void real_sleep_us(uint64_t us)
{
    struct timespec ts = { (time_t)(us / 1000000u), (long)(us % 1000000u) * 1000 };
    while (nanosleep(&ts, &ts) == -1 && errno == EINTR) { }
}

void dotbench_rfid_delay_us(uint32_t us)
{
    g_vt_us += us;
    real_sleep_us(us);
}

void dotbench_rfid_vtaskdelay(uint32_t ticks)
{
    t_last_delay_ticks = ticks;
    vTaskDelay(ticks);
}

/* ---- gpio ---- */
esp_err_t gpio_config(const gpio_config_t *c) { (void)c; return ESP_OK; }
esp_err_t gpio_set_level(gpio_num_t pin, uint32_t level)
{
    if (pin == (gpio_num_t)KBSP_PIN_RFID_PULL) rb_dev_pull(level ? 1 : 0);
    return ESP_OK;
}
esp_err_t gpio_reset_pin(gpio_num_t pin) { (void)pin; return ESP_OK; }
esp_err_t gpio_set_direction(gpio_num_t pin, gpio_mode_t m) { (void)pin; (void)m; return ESP_OK; }
esp_err_t gpio_set_pull_mode(gpio_num_t pin, gpio_pull_mode_t m) { (void)pin; (void)m; return ESP_OK; }
esp_err_t gpio_set_drive_capability(gpio_num_t pin, gpio_drive_cap_t c) { (void)pin; (void)c; return ESP_OK; }

/* ---- esp_ldo (VO4) ---- */
static int g_ldo_held;
esp_err_t esp_ldo_acquire_channel(const esp_ldo_channel_config_t *cfg, esp_ldo_channel_handle_t *out)
{
    if (!cfg || !out || g_ldo_held) return g_ldo_held ? ESP_ERR_INVALID_STATE : ESP_ERR_INVALID_ARG;
    g_ldo_held = 1;
    *out = (esp_ldo_channel_handle_t)&g_ldo_held;
    rb_dev_boost(true);
    return ESP_OK;
}
esp_err_t esp_ldo_release_channel(esp_ldo_channel_handle_t h)
{
    if (!h) return ESP_ERR_INVALID_ARG;
    g_ldo_held = 0;
    rb_dev_boost(false);
    return ESP_OK;
}

/* ---- khal_pwm_port (the LEDC peripheral under the SDK's real khal_pwm.c) ----
 * khal_pwm.c keeps the timer/channel bookkeeping (own_timer, pause needing a timer of its own, bits and duty maths);
 * only the five port calls of khal_pwm_esp.c are replaced. Weak, so a pwm area that models the whole LEDC wins; the
 * carrier hook (pwm_report) would then have to move there. */
/* khal_pwm_port.h is private to components/khal/pwm/src, off the include path of the runtime: the five-plus-one port
 * calls it declares (SDK commit c9568a3), restated so that a signature drift fails the link, not silently. */
kode_status_t khal_pwm_port_timer_set(uint8_t timer, uint32_t hz, uint8_t bits);
void khal_pwm_port_timer_stop(uint8_t timer);
kode_status_t khal_pwm_port_timer_pause(uint8_t timer);
kode_status_t khal_pwm_port_timer_resume(uint8_t timer);
kode_status_t khal_pwm_port_chan_start(uint8_t chan, uint8_t gpio, uint8_t timer, uint32_t duty);
kode_status_t khal_pwm_port_chan_bind(uint8_t chan, uint8_t timer, uint32_t duty);
kode_status_t khal_pwm_port_chan_duty(uint8_t chan, uint32_t duty);
void khal_pwm_port_chan_stop(uint8_t chan, uint8_t gpio);
#define PT 4
#define PC 8
static struct { int set; uint32_t hz; int paused; } g_pt[PT];
static struct { int on; uint8_t gpio, timer; uint32_t duty; } g_pc[PC];

static void pwm_report(int ch)
{
    int on = g_pc[ch].on && g_pc[ch].duty > 0 && g_pt[g_pc[ch].timer].set;
    if (g_pc[ch].gpio == (uint8_t)KBSP_PIN_RFID_OUT) rb_dev_carrier(on, g_pt[g_pc[ch].timer].hz);
}

__attribute__((weak)) kode_status_t khal_pwm_port_timer_set(uint8_t t, uint32_t hz, uint8_t bits)
{
    (void)bits;
    if (t >= PT || !hz) return KODE_ERROR;
    g_pt[t].set = 1; g_pt[t].hz = hz; g_pt[t].paused = 0;
    for (int c = 0; c < PC; c++) if (g_pc[c].on && g_pc[c].timer == t) pwm_report(c);
    return KODE_OK;
}

__attribute__((weak)) void khal_pwm_port_timer_stop(uint8_t t)
{
    if (t >= PT) return;
    g_pt[t].set = 0; g_pt[t].paused = 0;
    for (int c = 0; c < PC; c++) if (g_pc[c].on && g_pc[c].timer == t) pwm_report(c);
}

__attribute__((weak)) kode_status_t khal_pwm_port_timer_pause(uint8_t t)
{
    if (t >= PT || !g_pt[t].set) return KODE_ERROR;
    g_pt[t].paused = 1;
    for (int c = 0; c < PC; c++)
        if (g_pc[c].on && g_pc[c].timer == t && g_pc[c].gpio == (uint8_t)KBSP_PIN_RFID_OUT) rb_dev_gap(true, g_vt_us);
    return KODE_OK;
}

__attribute__((weak)) kode_status_t khal_pwm_port_timer_resume(uint8_t t)
{
    if (t >= PT || !g_pt[t].set) return KODE_ERROR;
    g_pt[t].paused = 0;
    for (int c = 0; c < PC; c++)
        if (g_pc[c].on && g_pc[c].timer == t && g_pc[c].gpio == (uint8_t)KBSP_PIN_RFID_OUT) rb_dev_gap(false, g_vt_us);
    return KODE_OK;
}

__attribute__((weak)) kode_status_t khal_pwm_port_chan_start(uint8_t c, uint8_t gpio, uint8_t t, uint32_t duty)
{
    if (c >= PC || t >= PT) return KODE_ERROR;
    if (gpio == (uint8_t)KBSP_PIN_RFID_OUT && (rb_fault() & 2u)) return KODE_ERROR;   /* fault: the carrier will not start */
    g_pc[c].on = 1; g_pc[c].gpio = gpio; g_pc[c].timer = t; g_pc[c].duty = duty;
    pwm_report(c);
    return KODE_OK;
}

__attribute__((weak)) kode_status_t khal_pwm_port_chan_bind(uint8_t c, uint8_t t, uint32_t duty)
{
    if (c >= PC || t >= PT || !g_pc[c].on) return KODE_ERROR;
    g_pc[c].timer = t; g_pc[c].duty = duty;
    pwm_report(c);
    return KODE_OK;
}

__attribute__((weak)) kode_status_t khal_pwm_port_chan_duty(uint8_t c, uint32_t duty)
{
    if (c >= PC || !g_pc[c].on) return KODE_ERROR;
    if (g_pc[c].gpio == (uint8_t)KBSP_PIN_RFID_OUT && duty && (rb_fault() & 2u)) return KODE_ERROR;
    g_pc[c].duty = duty;
    pwm_report(c);
    return KODE_OK;
}

__attribute__((weak)) void khal_pwm_port_chan_stop(uint8_t c, uint8_t gpio)
{
    (void)gpio;
    if (c >= PC) return;
    g_pc[c].duty = 0;
    pwm_report(c);
    g_pc[c].on = 0;
}

/* ---- adc_continuous ---- */
struct dotbench_adc_cont {
    int configured, running;
    uint32_t hz;
    uint64_t t0_ns, delivered;
};

static uint64_t mono_ns(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
}

esp_err_t adc_continuous_new_handle(const adc_continuous_handle_cfg_t *cfg, adc_continuous_handle_t *out)
{
    (void)cfg;
    if (!out) return ESP_ERR_INVALID_ARG;
    *out = (adc_continuous_handle_t)calloc(1, sizeof **out);
    return *out ? ESP_OK : ESP_ERR_NO_MEM;
}

esp_err_t adc_continuous_config(adc_continuous_handle_t h, const adc_continuous_config_t *cfg)
{
    if (!h || !cfg || cfg->pattern_num != 1 || !cfg->adc_pattern || cfg->adc_pattern[0].unit != ADC_UNIT_2) return ESP_ERR_INVALID_ARG;
    h->hz = cfg->sample_freq_hz; h->configured = 1;
    return ESP_OK;
}

esp_err_t adc_continuous_start(adc_continuous_handle_t h)
{
    if (!h || !h->configured || h->running) return ESP_ERR_INVALID_STATE;
    h->running = 1; h->t0_ns = mono_ns(); h->delivered = 0;
    rb_dev_adc_start();
    return ESP_OK;
}

esp_err_t adc_continuous_stop(adc_continuous_handle_t h)
{
    if (!h || !h->running) return ESP_ERR_INVALID_STATE;
    h->running = 0;
    return ESP_OK;
}

esp_err_t adc_continuous_deinit(adc_continuous_handle_t h)
{
    if (!h) return ESP_ERR_INVALID_ARG;
    free(h);
    return ESP_OK;
}

esp_err_t adc_continuous_read(adc_continuous_handle_t h, uint8_t *buf, uint32_t length_max, uint32_t *out_length, uint32_t timeout_ms)
{
    uint16_t smp[256];
    uint32_t n = length_max / SOC_ADC_DIGI_RESULT_BYTES;

    if (!h || !h->running || !buf || !out_length) return ESP_ERR_INVALID_STATE;
    *out_length = 0;
    if (rb_fault() & 1u) {                       /* the front end does not deliver: the read times out */
        real_sleep_us((uint64_t)(timeout_ms < 5 ? timeout_ms : 5) * 1000u);
        return ESP_ERR_TIMEOUT;
    }
    if (n > 256) n = 256;
    if (n == 0) return ESP_ERR_INVALID_ARG;
    /* real time: the converter delivers h->hz samples a second, so this blocks until those samples exist */
    uint64_t due = h->t0_ns + (h->delivered + n) * 1000000000ull / h->hz, now = mono_ns();
    if (due > now) real_sleep_us((due - now) / 1000u);
    rb_dev_adc_samples(smp, n);
    for (uint32_t i = 0; i < n; i++) {
        uint32_t w = (uint32_t)(smp[i] & 0xFFF) | ((uint32_t)ADC_CHANNEL_5 << 12) | ((uint32_t)ADC_UNIT_2 << 16);
        memcpy(buf + i * SOC_ADC_DIGI_RESULT_BYTES, &w, sizeof w);
    }
    h->delivered += n;
    *out_length = n * SOC_ADC_DIGI_RESULT_BYTES;
    return ESP_OK;
}

esp_err_t adc_continuous_parse_data(adc_continuous_handle_t h, const uint8_t *data, uint32_t num_bytes,
                                    adc_continuous_data_t *parsed, uint32_t *num_samples)
{
    uint32_t w;
    (void)h;
    if (!data || !parsed || !num_samples || num_bytes < SOC_ADC_DIGI_RESULT_BYTES) return ESP_ERR_INVALID_ARG;
    memcpy(&w, data, sizeof w);
    parsed->raw_data = (int)(w & 0xFFF);
    parsed->channel = (adc_channel_t)((w >> 12) & 0xF);
    parsed->unit = (adc_unit_t)((w >> 16) & 1);
    parsed->valid = true;
    *num_samples = 1;
    return ESP_OK;
}

/* ---- parlio (the emulated tag) ---- */
struct dotbench_parlio_tx {
    parlio_tx_unit_config_t cfg;
    int enabled, playing;
};

esp_err_t parlio_new_tx_unit(const parlio_tx_unit_config_t *cfg, parlio_tx_unit_handle_t *out)
{
    if (!cfg || !out || cfg->data_width != 1) return ESP_ERR_INVALID_ARG;
    *out = (parlio_tx_unit_handle_t)calloc(1, sizeof **out);
    if (!*out) return ESP_ERR_NO_MEM;
    (*out)->cfg = *cfg;
    return ESP_OK;
}

esp_err_t parlio_tx_unit_enable(parlio_tx_unit_handle_t u) { if (!u || u->enabled) return ESP_ERR_INVALID_STATE; u->enabled = 1; return ESP_OK; }

esp_err_t parlio_tx_unit_disable(parlio_tx_unit_handle_t u)
{
    if (!u || !u->enabled) return ESP_ERR_INVALID_STATE;
    if (u->playing) { u->playing = 0; rb_dev_emu(false, NULL, 0, false, 0, 0); }
    u->enabled = 0;
    return ESP_OK;
}

esp_err_t parlio_del_tx_unit(parlio_tx_unit_handle_t u)
{
    if (!u) return ESP_ERR_INVALID_ARG;
    if (u->enabled) return ESP_ERR_INVALID_STATE;
    free(u);
    return ESP_OK;
}

esp_err_t parlio_tx_unit_transmit(parlio_tx_unit_handle_t u, const void *payload, size_t bits, const parlio_transmit_config_t *tc)
{
    if (!u || !u->enabled || !payload || !bits || !tc || !tc->flags.loop_transmission) return ESP_ERR_INVALID_ARG;
    if (u->cfg.data_gpio_nums[0] != (int)KBSP_PIN_RFID_PULL) return ESP_ERR_INVALID_ARG;
    if (bits / 8 > u->cfg.max_transfer_size) return ESP_ERR_INVALID_ARG;
    u->playing = 1;
    rb_dev_emu(true, (const uint8_t *)payload, (uint32_t)bits, u->cfg.clk_src == PARLIO_CLK_SRC_EXTERNAL,
               u->cfg.input_clk_src_freq_hz, u->cfg.output_clk_freq_hz);
    return ESP_OK;
}

/* ---- pcnt (the reader's field) ---- */
struct dotbench_pcnt_unit { int enabled, started; };
struct dotbench_pcnt_chan { struct dotbench_pcnt_unit *unit; int gpio; };

esp_err_t pcnt_new_unit(const pcnt_unit_config_t *cfg, pcnt_unit_handle_t *out)
{
    if (!cfg || !out) return ESP_ERR_INVALID_ARG;
    *out = (pcnt_unit_handle_t)calloc(1, sizeof **out);
    return *out ? ESP_OK : ESP_ERR_NO_MEM;
}
esp_err_t pcnt_del_unit(pcnt_unit_handle_t u) { free(u); return ESP_OK; }
esp_err_t pcnt_new_channel(pcnt_unit_handle_t u, const pcnt_chan_config_t *cfg, pcnt_channel_handle_t *out)
{
    if (!u || !cfg || !out) return ESP_ERR_INVALID_ARG;
    *out = (pcnt_channel_handle_t)calloc(1, sizeof **out);
    if (!*out) return ESP_ERR_NO_MEM;
    (*out)->unit = u; (*out)->gpio = cfg->edge_gpio_num;
    return ESP_OK;
}
esp_err_t pcnt_del_channel(pcnt_channel_handle_t c) { free(c); return ESP_OK; }
esp_err_t pcnt_channel_set_edge_action(pcnt_channel_handle_t c, pcnt_channel_edge_action_t p, pcnt_channel_edge_action_t n)
{ (void)p; (void)n; return c ? ESP_OK : ESP_ERR_INVALID_ARG; }
esp_err_t pcnt_unit_enable(pcnt_unit_handle_t u) { if (!u) return ESP_ERR_INVALID_ARG; u->enabled = 1; return ESP_OK; }
esp_err_t pcnt_unit_disable(pcnt_unit_handle_t u) { if (!u) return ESP_ERR_INVALID_ARG; u->enabled = 0; return ESP_OK; }
esp_err_t pcnt_unit_start(pcnt_unit_handle_t u) { if (!u || !u->enabled) return ESP_ERR_INVALID_STATE; u->started = 1; return ESP_OK; }
esp_err_t pcnt_unit_stop(pcnt_unit_handle_t u) { if (!u) return ESP_ERR_INVALID_ARG; u->started = 0; return ESP_OK; }
esp_err_t pcnt_unit_clear_count(pcnt_unit_handle_t u) { return u ? ESP_OK : ESP_ERR_INVALID_ARG; }

/* The driver counts rising edges for a window it times with vTaskDelay(); the count is the reader's frequency times
 * the window the driver MEANT (not the wall time it took), so a loaded host cannot move a reading across a class. */
esp_err_t pcnt_unit_get_count(pcnt_unit_handle_t u, int *value)
{
    if (!u || !value) return ESP_ERR_INVALID_ARG;
    uint32_t ticks = t_last_delay_ticks ? t_last_delay_ticks : 10;
    uint64_t ms = (uint64_t)ticks * portTICK_PERIOD_MS;
    *value = u->started ? (int)((uint64_t)rb_dev_field_hz() * ms / 1000u) : 0;
    return ESP_OK;
}
