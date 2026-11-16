/* SPDX-License-Identifier: GPL-3.0-or-later */
#include "dotbench_stub.h"
#include "kweb_bridge.h"
void dotbench_unimplemented(const char *fn)
{
    kweb_text_printf(KWEB_CH_LOG, "dotbench: %s not implemented\n", fn);
}
