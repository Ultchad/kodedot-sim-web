/* Compatibility shim for building kodeOS 7612a16 (pinned to kode-sdk 0910112) against kode-sdk c9568a3.
 * Force-included (-include) into kgui's sources only; the SDK and the kodeOS tree are not modified.
 * Each line below is one incompatibility found by compiling; see docs/STATUS-kodeos.md. */
#ifndef KODEOS_COMPAT_H
#define KODEOS_COMPAT_H

#include "kaos.h"

/* 1. storage_write_all_request() gained a `tag` argument (SDK a5195f1, "Copy the apps to the card ahead of an
 *    install"). kgui does not abandon writes, so it passes the "no tag" value. */
#define storage_write_all_request(path, data, len, who) \
    storage_write_all_request((path), (data), (len), (who), KODE_STORAGE_TAG_NONE)

/* 2. KFAIL_KEEP ("the card could not keep an app this install would have removed") was replaced by KFAIL_BUSY
 *    ("an app this install would remove has no copy on the card yet; ask again"). kgui only reads the code to choose
 *    a sentence for the failure sheet; the old sentence is wrong for BUSY, a cosmetic difference. */
#define KFAIL_KEEP KFAIL_BUSY

#endif
