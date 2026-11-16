/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file rfid_ao.h
 * @brief The RFID app's Active Object.
 */
#ifndef RFID_AO_H_
#define RFID_AO_H_

#include "kode_sys.h"

#ifdef __cplusplus
extern "C" {
#endif

extern QActive * const AO_RfidKit;   /**< The one instance, opaque outside rfid_ao.c. */

/** @brief Construct the Active Object; call it after kode_init() and before RfidKitAo_start(). */
void RfidKitAo_ctor(void);

/** @brief Give the Active Object its task, queue and stack, and start it. */
void RfidKitAo_start(void);

#ifdef __cplusplus
}
#endif

#endif /* RFID_AO_H_ */
