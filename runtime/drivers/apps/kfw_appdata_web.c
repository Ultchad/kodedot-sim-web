/* SPDX-License-Identifier: GPL-3.0-or-later
 * kdrv_kfw.c stays superseded (no firmware container decoder here: kfw_begin/feed/end are stubs that fail, so no session ever keeps an
 * app-data block). Two of its functions are still CALLED on paths that have nothing to do with a decoder, and a generated stub is the
 * wrong answer for them:
 *   kfw_appdata_release: AppMgr calls it at the end of every "tidy" (tidy_finish), among them the apps step of kodeOS's factory reset
 *     ("9 other app(s) removed"), on a block that is empty. The real one frees the block's buffer if there is one; so does this.
 *   kfw_appdata_take: AppMgr's block_discard() takes into an uninitialised struct and releases it. The generated stub leaves that struct
 *     untouched, so the release above would free garbage. With no session the real answer is "no block, no buffer" (KFW_AD_NONE).
 * Same bodies as the SDK's for these two; nothing is invented. */
#include <stddef.h>
#include "kdrv_kfw.h"
#include "khal_system.h"

void kfw_appdata_take(kfw_appdata_t *out)
{
    if (out != NULL) {
        out->kind     = KFW_AD_NONE;
        out->buf      = NULL;
        out->json_len = 0U;
        out->icon_len = 0U;
    }
}

void kfw_appdata_release(kfw_appdata_t *ad)
{
    if (ad != NULL) {
        if (ad->buf != NULL) {
            khal_free(ad->buf);
        }
        ad->buf      = NULL;
        ad->json_len = 0U;
        ad->icon_len = 0U;
    }
}
