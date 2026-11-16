/* SPDX-License-Identifier: GPL-3.0-or-later
 * The 125 kHz front end is not modelled yet. kdrv_rfid_lf_init() is the park path every app
 * runs at boot ("wires no peripheral hot"): on the bench there is nothing to wire, so it
 * succeeds quietly. The rest of kdrv_rfid_lf.h stays a generated stub. */
#include "kdrv_rfid_lf.h"

kode_status_t kdrv_rfid_lf_init(void) { return KODE_OK; }
