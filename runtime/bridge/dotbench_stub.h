/* SPDX-License-Identifier: GPL-3.0-or-later
 * Support macros for the generated stubs (tools/gen_stubs.py). */
#ifndef DOTBENCH_STUB_H
#define DOTBENCH_STUB_H
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include "esp_err.h"
void dotbench_unimplemented(const char *fn);
#define DOTBENCH_UNIMPLEMENTED(fn) do { static int once_; if (!once_) { once_ = 1; dotbench_unimplemented(#fn); } } while (0)
#endif
