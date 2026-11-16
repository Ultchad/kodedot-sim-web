/* SPDX-License-Identifier: GPL-3.0-or-later
 * Process entry. Emscripten runs main() on a worker (PROXY_TO_PTHREAD), which
 * stands in for ESP-IDF's main task: it calls app_main() and, like IDF's main
 * task, may simply return while the FreeRTOS tasks it created keep running. */
#include <stdio.h>
#include "kweb_bridge.h"

extern void app_main(void);

int main(void)
{
    (void)kweb_state();                       /* header, framebuffer geometry */
    kweb_text_printf(KWEB_CH_LOG, "dotbench: app_main()\n");
    app_main();
    return 0;
}
