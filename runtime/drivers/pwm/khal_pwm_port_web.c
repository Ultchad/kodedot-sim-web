/* SPDX-License-Identifier: GPL-3.0-or-later
 * khal_pwm's port (replaces components/khal/pwm/src/khal_pwm_esp.c, the LEDC calls). The SDK's khal_pwm.c above it (channel
 * and timer allocation, frequency sharing, duty maths) is unmodified. A channel is a (frequency, duty) pair published to the
 * bench model: PWM is a property of the net there, never a stream of edges (docs/component-api.md 5.6). */
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>

#include "dotbench_exp.h"
#include "khal_gpio.h"
#include "kode_defs.h"

#define TIMERS 4
#define CHANS  8

static struct { uint32_t hz; uint8_t bits; bool paused; } g_t[TIMERS];
static struct { uint8_t gpio, timer; uint32_t duty; bool on; } g_c[CHANS];
static pthread_mutex_t g_mu = PTHREAD_MUTEX_INITIALIZER;

static void publish(int c)   /* caller holds the lock */
{
    uint8_t gpio = g_c[c].gpio; int t = g_c[c].timer;
    if (t >= TIMERS) return;
    if (g_t[t].paused) { dbx_pin_set(gpio, DBX_OUT, DBX_PULL_NONE, 0, 0, 0); return; }
    uint32_t full = 1u << g_t[t].bits;
    uint64_t q16 = ((uint64_t)g_c[c].duty << 16) / full;
    if (q16 > 65536u) q16 = 65536u;
    dbx_pin_set(gpio, DBX_PWM, DBX_PULL_NONE, 0, g_t[t].hz, (uint32_t)q16);
}

kode_status_t khal_pwm_port_timer_set(uint8_t timer, uint32_t hz, uint8_t bits)
{
    if (timer >= TIMERS || hz == 0 || bits == 0 || bits > 20) return KODE_ERROR;
    pthread_mutex_lock(&g_mu);
    g_t[timer].hz = hz; g_t[timer].bits = bits; g_t[timer].paused = false;
    for (int c = 0; c < CHANS; c++) if (g_c[c].on && g_c[c].timer == timer) publish(c);
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}
void khal_pwm_port_timer_stop(uint8_t timer)
{
    if (timer < TIMERS) { pthread_mutex_lock(&g_mu); g_t[timer].hz = 0; g_t[timer].paused = false; pthread_mutex_unlock(&g_mu); }
}
kode_status_t khal_pwm_port_timer_pause(uint8_t timer)
{
    if (timer >= TIMERS) return KODE_ERROR;
    pthread_mutex_lock(&g_mu);
    g_t[timer].paused = true;
    for (int c = 0; c < CHANS; c++) if (g_c[c].on && g_c[c].timer == timer) publish(c);
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}
kode_status_t khal_pwm_port_timer_resume(uint8_t timer)
{
    if (timer >= TIMERS) return KODE_ERROR;
    pthread_mutex_lock(&g_mu);
    g_t[timer].paused = false;
    for (int c = 0; c < CHANS; c++) if (g_c[c].on && g_c[c].timer == timer) publish(c);
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}
kode_status_t khal_pwm_port_chan_start(uint8_t chan, uint8_t gpio, uint8_t timer, uint32_t duty)
{
    if (chan >= CHANS || timer >= TIMERS) return KODE_ERROR;
    pthread_mutex_lock(&g_mu);
    g_c[chan].gpio = gpio; g_c[chan].timer = timer; g_c[chan].duty = duty; g_c[chan].on = true;
    publish(chan);
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}
kode_status_t khal_pwm_port_chan_bind(uint8_t chan, uint8_t timer, uint32_t duty)
{
    if (chan >= CHANS || timer >= TIMERS) return KODE_ERROR;
    pthread_mutex_lock(&g_mu);
    g_c[chan].timer = timer; g_c[chan].duty = duty;
    if (g_c[chan].on) publish(chan);
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}
kode_status_t khal_pwm_port_chan_duty(uint8_t chan, uint32_t duty)
{
    if (chan >= CHANS) return KODE_ERROR;
    pthread_mutex_lock(&g_mu);
    g_c[chan].duty = duty;
    if (g_c[chan].on) publish(chan);
    pthread_mutex_unlock(&g_mu);
    return KODE_OK;
}
void khal_pwm_port_chan_stop(uint8_t chan, uint8_t gpio)
{
    if (chan < CHANS) { pthread_mutex_lock(&g_mu); g_c[chan].on = false; pthread_mutex_unlock(&g_mu); }
    (void)khal_gpio_output(gpio, false);   /* as the LEDC port: the pin stays an output at the idle level */
}
