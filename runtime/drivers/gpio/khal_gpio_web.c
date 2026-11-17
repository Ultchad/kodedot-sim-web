/* SPDX-License-Identifier: GPL-3.0-or-later
 * khal_gpio over a virtual pin table. Inputs read the level something outside
 * drives (dotbench_gpio_drive), else the pull, else high. Interrupts follow the
 * ESP-IDF contract the SDK documents: a trigger disables the interrupt and runs
 * the callback once; khal_gpio_irq_enable() arms it again, and a level
 * interrupt whose condition still holds fires at once. Replaces
 * components/khal/gpio/src/khal_gpio_esp.c. */
#include <pthread.h>
#include <string.h>
#include "khal_gpio.h"
#include "kbsp.h"
#include "dotbench_board.h"
#include "dotbench_exp.h"   /* J3 positions publish their drive state to the bench model (runtime/drivers/exp) */

#define NPINS 64
typedef struct {
    bool is_output, out;
    bool ext_valid, ext;
    khal_gpio_pull_t pull;
    bool has_irq, armed;
    khal_gpio_irq_t kind;
    khal_gpio_cb_t cb;
    void *arg;
} pin_t;
static pin_t g_pin[NPINS];
static pthread_mutex_t g_mu;
static pthread_once_t g_once = PTHREAD_ONCE_INIT;
static void once(void)
{
    pthread_mutexattr_t a;
    pthread_mutexattr_init(&a);
    pthread_mutexattr_settype(&a, PTHREAD_MUTEX_RECURSIVE);
    pthread_mutex_init(&g_mu, &a);
}
#define LOCK()   do { pthread_once(&g_once, once); pthread_mutex_lock(&g_mu); } while (0)
#define UNLOCK() pthread_mutex_unlock(&g_mu)

static bool level_of(const pin_t *p)
{
    if (p->is_output) return p->out;
    if (p->ext_valid) return p->ext;
    return p->pull != KHAL_GPIO_PULL_DOWN;
}
/* Caller holds the lock; returns the callback to run (outside the lock) or NULL. */
static khal_gpio_cb_t take_trigger(pin_t *p, bool before, bool after, void **arg)
{
    if (!p->has_irq || !p->armed) return NULL;
    bool hit = false;
    switch (p->kind) {
    case KHAL_GPIO_IRQ_LOW_LEVEL:  hit = !after; break;
    case KHAL_GPIO_IRQ_HIGH_LEVEL: hit = after; break;
    case KHAL_GPIO_IRQ_ANY_EDGE:   hit = before != after; break;
    }
    if (!hit) return NULL;
    p->armed = false;
    *arg = p->arg;
    return p->cb;
}

void dotbench_gpio_drive(uint8_t pin, bool level)
{
    if (pin >= NPINS) return;
    LOCK();
    pin_t *p = &g_pin[pin];
    bool before = level_of(p);
    p->ext_valid = true;
    p->ext = level;
    void *arg = NULL;
    khal_gpio_cb_t cb = take_trigger(p, before, level_of(p), &arg);
    UNLOCK();
    if (cb) cb(arg);
}

kode_status_t khal_gpio_input(uint8_t pin, khal_gpio_pull_t pull)
{
    if (pin >= NPINS) return KODE_DENIED;
    LOCK();
    g_pin[pin].is_output = false;
    g_pin[pin].pull = pull;
    UNLOCK();
    dbx_pin_set(pin, DBX_IN, pull == KHAL_GPIO_PULL_UP ? DBX_PULL_UP : pull == KHAL_GPIO_PULL_DOWN ? DBX_PULL_DOWN : DBX_PULL_NONE, 0, 0, 0);
    return KODE_OK;
}
kode_status_t khal_gpio_output(uint8_t pin, bool level)
{
    if (pin >= NPINS) return KODE_DENIED;
    LOCK();
    g_pin[pin].is_output = true;
    g_pin[pin].out = level;
    UNLOCK();
    dbx_pin_set(pin, DBX_OUT, DBX_PULL_NONE, level, 0, 0);
    if (pin == KBSP_PIN_C5_EN && !level) dbx_set_v33_pulse(true);   /* the C5 reset lets go of J3's 3V3 enable */
    return KODE_OK;
}
kode_status_t khal_gpio_write(uint8_t pin, bool level)
{
    if (pin >= NPINS) return KODE_DENIED;
    LOCK();
    g_pin[pin].out = level;
    bool outp = g_pin[pin].is_output;
    UNLOCK();
    if (outp) dbx_pin_set(pin, DBX_OUT, DBX_PULL_NONE, level, 0, 0);
    return KODE_OK;
}
void khal_gpio_release(uint8_t pin)
{
    if (pin >= NPINS) return;
    LOCK();
    g_pin[pin].is_output = false;
    g_pin[pin].pull = KHAL_GPIO_PULL_NONE;
    UNLOCK();
    dbx_pin_set(pin, DBX_Z, DBX_PULL_NONE, 0, 0, 0);
}
bool khal_gpio_level(uint8_t pin)
{
    if (pin >= NPINS) return false;
    LOCK();
    bool v = level_of(&g_pin[pin]);
    UNLOCK();
    return v;
}
bool khal_gpio_driven_low(uint8_t pin)
{
    if (pin >= NPINS) return false;
    LOCK();
    bool v = g_pin[pin].is_output && !g_pin[pin].out;
    UNLOCK();
    return v;
}
kode_status_t khal_gpio_service(void) { return KODE_OK; }
kode_status_t khal_gpio_irq_attach(uint8_t pin, khal_gpio_irq_t kind, khal_gpio_cb_t cb, void *arg)
{
    if (pin >= NPINS || !cb) return KODE_DENIED;
    LOCK();
    pin_t *p = &g_pin[pin];
    p->has_irq = true; p->kind = kind; p->cb = cb; p->arg = arg; p->armed = true;
    bool v = level_of(p);
    void *a = NULL;
    /* Attaching arms it; a level condition that already holds fires now. */
    khal_gpio_cb_t fire = (kind == KHAL_GPIO_IRQ_ANY_EDGE) ? NULL : take_trigger(p, v, v, &a);
    UNLOCK();
    if (fire) fire(a);
    return KODE_OK;
}
void khal_gpio_irq_enable(uint8_t pin)
{
    if (pin >= NPINS) return;
    LOCK();
    pin_t *p = &g_pin[pin];
    p->armed = true;
    bool v = level_of(p);
    void *a = NULL;
    khal_gpio_cb_t fire = (p->kind == KHAL_GPIO_IRQ_ANY_EDGE) ? NULL : take_trigger(p, v, v, &a);
    UNLOCK();
    if (fire) fire(a);
}
kode_status_t khal_gpio_wake(uint8_t pin, bool on) { (void)pin; (void)on; return KODE_OK; }
kode_status_t khal_gpio_wake_low(uint8_t pin) { (void)pin; return KODE_OK; }
