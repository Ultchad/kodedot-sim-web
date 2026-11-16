#!/usr/bin/env bash
# usage: mkmain.sh <name> "<Display>" <category[,category]> <Prefix> <header-basename> [extra source...]
# Writes main/CMakeLists.txt and main/app_main.c for an app whose Active Object is <Prefix>Ao in <header-basename>.c/.h
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
name="$1"; display="$2"; cat="$3"; pre="$4"; base="$5"; shift 5
app="$here/../$name/main"
srcs="\"app_main.c\" \"$base.c\" \"glyphs.c\" \"kit.c\" \"kit_name.c\" \"kit_store.c\""
for x in "$@"; do srcs="$srcs \"$x\""; done
cat > "$app/CMakeLists.txt" <<EOF
idf_component_register(
    SRCS $srcs
    INCLUDE_DIRS "."
    REQUIRES kode
    PRIV_REQUIRES kscreen
)
EOF
cat > "$app/app_main.c" <<EOF
/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file app_main.c
 * @brief The app's entry point: bring the system up, then start the app's Active Object.
 */
#include "kode.h"

#include "$base.h"

/* The name on the launcher's pill and the category it is filed under. */
KODE_APP_MANIFEST("$display", "$cat");

/**
 * @brief ESP-IDF's entry point.
 */
void app_main(void)
{
    /* First, always: nothing may post to an Active Object before its queue exists. */
    kode_init();

    ${pre}Ao_ctor();
    ${pre}Ao_start();
}
EOF
cat > "$app/$base.h" <<EOF
/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file $base.h
 * @brief The $display app's Active Object.
 */
#ifndef ${base^^}_H_
#define ${base^^}_H_

#include "kode_sys.h"

#ifdef __cplusplus
extern "C" {
#endif

extern QActive * const AO_${pre};   /**< The one instance, opaque outside $base.c. */

/** @brief Construct the Active Object; call it after kode_init() and before ${pre}Ao_start(). */
void ${pre}Ao_ctor(void);

/** @brief Give the Active Object its task, queue and stack, and start it. */
void ${pre}Ao_start(void);

#ifdef __cplusplus
}
#endif

#endif /* ${base^^}_H_ */
EOF
