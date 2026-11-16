/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file nfc_ao.h
 * @brief The NFC app's Active Object.
 */
#ifndef NFC_AO_H_
#define NFC_AO_H_

#include "kode_sys.h"

#ifdef __cplusplus
extern "C" {
#endif

extern QActive * const AO_NfcKit;   /**< The one instance, opaque outside nfc_ao.c. */

/** @brief Construct the Active Object; call it after kode_init() and before NfcKitAo_start(). */
void NfcKitAo_ctor(void);

/** @brief Give the Active Object its task, queue and stack, and start it. */
void NfcKitAo_start(void);

#ifdef __cplusplus
}
#endif

#endif /* NFC_AO_H_ */
