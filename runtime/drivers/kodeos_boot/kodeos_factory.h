/* SPDX-License-Identifier: GPL-3.0-or-later
 * The factory FAT content of kodeOS, generated into build/kodeos/gen/kodeos_factory.c by tools/dotbench. */
#ifndef KODEOS_FACTORY_H
#define KODEOS_FACTORY_H
#include <stddef.h>
typedef struct { const char *path; const unsigned char *data; size_t size; } kodeos_factory_file_t;
extern const kodeos_factory_file_t kodeos_factory_files[];
extern const unsigned kodeos_factory_count;
#endif
