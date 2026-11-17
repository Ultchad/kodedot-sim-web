/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file ble_ao.h
 * @brief The Bluetooth app's Active Object.
 */
#ifndef BLE_AO_H_
#define BLE_AO_H_

#include "kode_sys.h"

#ifdef __cplusplus
extern "C" {
#endif

extern QActive * const AO_BleKit;   /**< The one instance, opaque outside ble_ao.c. */

/** @brief Construct the Active Object; call it after kode_init() and before BleKitAo_start(). */
void BleKitAo_ctor(void);

/** @brief Give the Active Object its task, queue and stack, and start it. */
void BleKitAo_start(void);

#ifdef __cplusplus
}
#endif

#endif /* BLE_AO_H_ */
