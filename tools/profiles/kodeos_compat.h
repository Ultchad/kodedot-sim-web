/* Compatibility shim for building a kodeOS release against the kode-sdk release it was not made for.
 * Force-included (-include) into kgui's sources only; the SDK and the kodeOS tree are not modified.
 * KodeOS v0.1.2 pins kode-sdk v0.1.2, the pair dotbench uses, so nothing is needed (the two shims that the older
 * 7612a16 + c9568a3 pair required, for storage_write_all_request()'s tag and KFAIL_KEEP, were removed).
 * Add a line here only when a pin pair breaks kgui's compile, and say why in docs/STATUS-kodeos.md. */
#ifndef KODEOS_COMPAT_H
#define KODEOS_COMPAT_H

#include "kaos.h"

#endif
