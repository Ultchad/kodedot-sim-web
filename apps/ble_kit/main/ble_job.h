/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file ble_job.h
 * @brief The job the Bluetooth app's worker runs: kode_ble_scan(), which waits for the whole listen, off the Active Object.
 */
#ifndef BLE_JOB_H_
#define BLE_JOB_H_

#include <stdint.h>

#include "kode_sys.h"

#ifdef __cplusplus
extern "C" {
#endif

#define BLE_DEV_MAX     16U     /**< Devices a listen keeps (the strongest). */
#define BLE_NAME_MAX    30U     /**< Bytes of a name (KODE_BLE_NAME_MAX). */
#define BLE_ADDR_MAX    18U     /**< Bytes of an address as text (KODE_BLE_ADDR_MAX). */
#define BLE_LISTEN_MS   5000U   /**< How long one listen lasts. */
#define BLE_ERR_MAX     96U     /**< The longest reason kept. */

/** @brief Why a listen did not give a list. */
typedef enum {
    BLE_FAIL_NONE = 0,    /**< It gave a list (maybe an empty one). */
    BLE_FAIL_OFF,         /**< Bluetooth is off in Settings. */
    BLE_FAIL_BUSY,        /**< The radio is on something else. */
    BLE_FAIL_NOPE         /**< Anything else: the Dot cannot do it. */
} ble_fail_t;

/** @brief One device that was heard. */
typedef struct {
    char   name[BLE_NAME_MAX];   /**< Its name, empty when it gave none. */
    char   addr[BLE_ADDR_MAX];   /**< "c0:00:00:00:00:01". */
    int8_t rssi;                 /**< Strength, dBm. */
} ble_dev_t;

/** @brief The job: the listen's answer. */
typedef struct {
    ble_dev_t  dev[BLE_DEV_MAX];   /**< The devices, the strongest first. */
    uint8_t    n;                  /**< How many. */
    ble_fail_t fail;               /**< Why there is no list. */
    char       err[BLE_ERR_MAX];   /**< The Dot's own words for it. */
} ble_job_t;

/**
 * @brief What the worker runs: listen, and answer in the job.
 * @param arg   The ble_job_t.
 * @param value Unused.
 * @return KODE_OK: the answer is in the job.
 */
kode_status_t ble_run(void *arg, uint32_t *value);

#ifdef __cplusplus
}
#endif

#endif /* BLE_JOB_H_ */
