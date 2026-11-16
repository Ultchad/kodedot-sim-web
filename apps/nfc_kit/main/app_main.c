/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file app_main.c
 * @brief The app's entry point: bring the system up, then start the app's Active Object.
 */
#include "kode.h"

#include "nfc_ao.h"

/* The name on the launcher's pill and the category it is filed under. */
KODE_APP_MANIFEST("NFC", "wireless");

/**
 * @brief ESP-IDF's entry point.
 */
void app_main(void)
{
    /* First, always: nothing may post to an Active Object before its queue exists. */
    kode_init();

    NfcKitAo_ctor();
    NfcKitAo_start();
}
