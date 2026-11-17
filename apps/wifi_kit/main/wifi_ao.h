/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file wifi_ao.h
 * @brief The Wi-Fi app's Active Object.
 */
#ifndef WIFI_AO_H_
#define WIFI_AO_H_

#include "kode_sys.h"

#ifdef __cplusplus
extern "C" {
#endif

extern QActive * const AO_WifiKit;   /**< The one instance, opaque outside wifi_ao.c. */

/** @brief Construct the Active Object; call it after kode_init() and before WifiKitAo_start(). */
void WifiKitAo_ctor(void);

/** @brief Give the Active Object its task, queue and stack, and start it. */
void WifiKitAo_start(void);

#ifdef __cplusplus
}
#endif

#endif /* WIFI_AO_H_ */
