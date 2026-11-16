/* SPDX-License-Identifier: GPL-3.0-or-later
 * No ES8311 on the bench bus: kdrv_es8311_park() says what the SDK documents for that case,
 * "no ES8311 answered" (KODE_ERROR), without the not-implemented log line. The rest of
 * kdrv_es8311.h stays a generated stub. */
#include "kdrv_es8311.h"

kode_status_t kdrv_es8311_park(void) { return KODE_ERROR; }
