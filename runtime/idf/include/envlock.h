/* SPDX-License-Identifier: GPL-3.0-or-later
 * picolibc's environment lock, which khal_sync_esp.c wraps. Here the C library
 * is Emscripten's musl; the "lock" is one recursive mutex of our own. */
#ifndef DOTBENCH_ENVLOCK_H
#define DOTBENCH_ENVLOCK_H
#ifdef __cplusplus
extern "C" {
#endif
void dotbench_env_lock(void);
void dotbench_env_unlock(void);
#define ENV_LOCK   dotbench_env_lock()
#define ENV_UNLOCK dotbench_env_unlock()
#ifdef __cplusplus
}
#endif
#endif
