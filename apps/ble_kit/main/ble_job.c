/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file ble_job.c
 * @brief The job the Bluetooth app's worker runs: kode_ble_scan(), which waits for the whole listen, off the Active Object.
 */
#include "ble_job.h"

#include <stdio.h>
#include <string.h>

#include "kode.h"

kode_status_t ble_run(void *arg, uint32_t *value)
{
    ble_job_t * const j = (ble_job_t *)arg;
    kode_ble_device_t heard[BLE_DEV_MAX];
    int               n;

    (void)value;
    j->n       = 0U;
    j->fail    = BLE_FAIL_NONE;
    j->err[0]  = '\0';
    n = kode_ble_scan(heard, BLE_DEV_MAX, BLE_LISTEN_MS);
    if ( n < 0 )
    {
        (void)snprintf(j->err, sizeof(j->err), "%s", kode_error());
        j->fail = BLE_FAIL_NOPE;
        if ( (NULL != strstr(j->err, "busy")) || (NULL != strstr(j->err, "Busy")) )
        {
            j->fail = BLE_FAIL_BUSY;
        }
        else if ( (NULL != strstr(j->err, "Settings")) || (NULL != strstr(j->err, " off")) )
        {
            j->fail = BLE_FAIL_OFF;
        }
        else
        {
            /* The Dot cannot do it. */
        }
        return KODE_OK;
    }
    for ( int i = 0; (i < n) && (i < (int)BLE_DEV_MAX); ++i )
    {
        (void)snprintf(j->dev[i].name, sizeof(j->dev[i].name), "%s", heard[i].name);
        (void)snprintf(j->dev[i].addr, sizeof(j->dev[i].addr), "%s", heard[i].address);
        j->dev[i].rssi = heard[i].rssi;
        j->n++;
    }
    return KODE_OK;
}
