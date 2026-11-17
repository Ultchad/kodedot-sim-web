/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file gpio_job.h
 * @brief The jobs the GPIO app's worker runs: the blocking kode.h calls, one at a time, off the Active Object.
 */
#ifndef GPIO_JOB_H_
#define GPIO_JOB_H_

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "kode_sys.h"

#ifdef __cplusplus
extern "C" {
#endif

#define GP_PIN_FIRST    1U       /**< The first pin, as printed on the connector (KODE_PIN_FIRST). */
#define GP_PIN_LAST     14U      /**< The last pin (KODE_PIN_LAST). */
#define GP_I2C_SDA      4U       /**< The I2C data pin; 1 to 3 stay free for a C5 flasher. */
#define GP_I2C_SCL      5U       /**< The I2C clock pin. */
#define GP_I2C_HZ       100000U  /**< The I2C clock. */
#define GP_I2C_FIRST    0x08U    /**< The first address probed. */
#define GP_I2C_LAST     0x77U    /**< The last address probed. */
#define GP_I2C_MAX      32U      /**< Devices kept. */
#define GP_UART_TX      6U       /**< The UART's transmit pin. */
#define GP_UART_RX      7U       /**< The UART's receive pin. */
#define GP_UART_CHUNK   64U      /**< The most bytes one tick takes. */
#define GP_ERR_MAX      96U      /**< The longest reason kept. */

/** @brief What a job does. */
typedef enum {
    GP_OP_READ = 0,   /**< kode_pin_read. */
    GP_OP_WRITE,      /**< kode_pin_write. */
    GP_OP_PWM,        /**< kode_pin_write_pwm. */
    GP_OP_ANALOG,     /**< kode_pin_read_analog. */
    GP_OP_I2C,        /**< A whole I2C scan. */
    GP_OP_UART_OPEN,  /**< kode_uart_begin. */
    GP_OP_UART_CLOSE, /**< kode_uart_end. */
    GP_OP_UART_SEND,  /**< kode_uart_write. */
    GP_OP_UART_TAKE   /**< kode_uart_read, without waiting. */
} gp_op_t;

/** @brief What the AO asks of the worker. */
typedef struct {
    gp_op_t  op;      /**< What to do. */
    uint8_t  pin;     /**< The pin. */
    bool     level;   /**< The level to drive. */
    uint8_t  duty;    /**< The PWM duty, percent. */
    uint32_t hz;      /**< The PWM frequency, or the UART's baud. */
} gp_req_t;

/** @brief What the worker answers. */
typedef struct {
    bool     ok;                        /**< The call was taken. */
    bool     level;                     /**< The level read. */
    uint32_t mv;                        /**< The voltage read. */
    char     err[GP_ERR_MAX];           /**< Why it was refused. */
    uint8_t  found[GP_I2C_MAX];         /**< The I2C addresses that answered. */
    uint8_t  nfound;                    /**< How many. */
    uint8_t  rx[GP_UART_CHUNK];         /**< What the UART gave. */
    size_t   nrx;                       /**< How many bytes. */
} gp_res_t;

/** @brief The one job in flight: the worker reads the request and writes the answer. */
typedef struct {
    gp_req_t rq;   /**< Asked. */
    gp_res_t rs;   /**< Answered. */
} gp_job_t;

/**
 * @brief What the worker runs: one kode.h call, answered in the job.
 * @param arg   The gp_job_t.
 * @param value Unused.
 * @return KODE_OK: the answer is in the job.
 */
kode_status_t gp_run(void *arg, uint32_t *value);

#ifdef __cplusplus
}
#endif

#endif /* GPIO_JOB_H_ */
