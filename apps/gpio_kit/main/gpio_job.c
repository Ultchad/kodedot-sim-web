/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file gpio_job.c
 * @brief The jobs the GPIO app's worker runs: the blocking kode.h calls, one at a time, off the Active Object.
 */
#include "gpio_job.h"

#include <stdio.h>

#include "kode.h"

/**
 * @brief Say why a call was refused, into the answer.
 * @param rs The answer.
 */
static void job_err(gp_res_t *rs)
{
    (void)snprintf(rs->err, sizeof(rs->err), "%s", kode_error());
    if ( '\0' == rs->err[0] )
    {
        (void)snprintf(rs->err, sizeof(rs->err), "The Dot would not do it");
    }
    rs->ok = false;
}

/**
 * @brief The I2C scan, on the worker: take the bus, probe every address, give the bus back.
 * @param rs The answer.
 */
static void job_i2c(gp_res_t *rs)
{
    rs->nfound = 0U;
    rs->ok     = true;
    if ( !kode_i2c_begin(GP_I2C_SDA, GP_I2C_SCL, GP_I2C_HZ) )
    {
        job_err(rs);
        return;
    }
    for ( uint8_t a = GP_I2C_FIRST; (a <= GP_I2C_LAST) && rs->ok; ++a )
    {
        if ( kode_i2c_probe(a) )
        {
            if ( rs->nfound < GP_I2C_MAX )
            {
                rs->found[rs->nfound] = a;
                rs->nfound++;
            }
        }
        else if ( '\0' != kode_error()[0] )
        {
            job_err(rs);
        }
        else
        {
            /* Nobody there. */
        }
    }
    (void)kode_i2c_end();
}

/**
 * @brief What the worker runs: one kode.h call, answered in the job.
 * @param arg   The gp_job_t.
 * @param value Unused.
 * @return KODE_OK: the answer is in the job.
 */
kode_status_t gp_run(void *arg, uint32_t *value)
{
    gp_job_t * const j = (gp_job_t *)arg;

    (void)value;
    j->rs.ok   = true;
    j->rs.err[0] = '\0';
    j->rs.nrx  = 0U;
    switch ( j->rq.op )
    {
        case GP_OP_READ:
        {
            j->rs.level = kode_pin_read(j->rq.pin);
            if ( '\0' != kode_error()[0] )
            {
                job_err(&j->rs);
            }
            break;
        }
        case GP_OP_WRITE:
        {
            if ( !kode_pin_write(j->rq.pin, j->rq.level) )
            {
                job_err(&j->rs);
            }
            break;
        }
        case GP_OP_PWM:
        {
            if ( !kode_pin_write_pwm(j->rq.pin, j->rq.hz, j->rq.duty) )
            {
                job_err(&j->rs);
            }
            break;
        }
        case GP_OP_ANALOG:
        {
            j->rs.mv = kode_pin_read_analog(j->rq.pin);
            if ( '\0' != kode_error()[0] )
            {
                job_err(&j->rs);
            }
            break;
        }
        case GP_OP_I2C:
        {
            job_i2c(&j->rs);
            break;
        }
        case GP_OP_UART_OPEN:
        {
            if ( !kode_uart_begin(GP_UART_TX, GP_UART_RX, j->rq.hz) )
            {
                job_err(&j->rs);
            }
            break;
        }
        case GP_OP_UART_CLOSE:
        {
            (void)kode_uart_end();
            break;
        }
        case GP_OP_UART_SEND:
        {
            static const uint8_t hello[] = { 'h', 'e', 'l', 'l', 'o', '\n' };

            if ( sizeof(hello) != kode_uart_write(hello, sizeof(hello)) )
            {
                job_err(&j->rs);
            }
            break;
        }
        case GP_OP_UART_TAKE:
        {
            j->rs.nrx = kode_uart_read(j->rs.rx, sizeof(j->rs.rx), 0U);
            if ( (0U == j->rs.nrx) && ('\0' != kode_error()[0]) )
            {
                job_err(&j->rs);
            }
            break;
        }
        default:
        {
            break;
        }
    }
    return KODE_OK;
}


