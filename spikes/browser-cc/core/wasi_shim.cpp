// SPDX-License-Identifier: GPL-3.0-or-later
// Browser flavour only (wasm32-wasip1 + wasi-libc instead of Emscripten's musl). wasi-libc reaches the host through WASI imports for stdio, exit,
// clocks and so on. A part may import ONLY the `dotbench` module (ABI 1), so this file DEFINES those imports as ordinary functions: libc's
// undefined `__imported_wasi_snapshot_preview1_*` references resolve to the definitions below (all 45 names libc.a can reference), and the
// module stays a pure ABI 1 module.
//   stdout/stderr (fd 1, 2) -> the part's console (Serial pane), so printf()/puts() work like Serial.print
//   exit()/abort()          -> trap (the bench shows "crashed" and reboots like an ESP32 panic)
//   clocks                  -> the bench's virtual clock;  random_get -> xorshift;  stdin -> end of file;  files, sockets, paths -> error codes
#include <stddef.h>
#include <stdint.h>
#include "dotbench_abi.h"

#define W(n) __imported_wasi_snapshot_preview1_##n
typedef uint16_t err_t; typedef const void *P; typedef uint64_t u64; typedef uint32_t u32;
enum : err_t { OK = 0, BADF = 8, NOSYS = 52, SPIPE = 70 };
struct iov { const uint8_t *buf; size_t len; };

extern "C" {
err_t W(fd_write)(u32 fd, const iov *v, size_t n, size_t *nw) {
  if (fd != 1 && fd != 2) { *nw = 0; return BADF; }
  size_t t = 0; for (size_t i = 0; i < n; i++) { if (v[i].len) dp_uart_write(0, v[i].buf, v[i].len); t += v[i].len; }
  *nw = t; return OK;
}
err_t W(fd_read)(u32, P, size_t, size_t *nr) { *nr = 0; return OK; }
err_t W(fd_close)(u32) { return OK; }
err_t W(fd_seek)(u32, int64_t, u32, u64 *) { return SPIPE; }
void  W(proc_exit)(u32) { __builtin_trap(); }
err_t W(environ_sizes_get)(size_t *c, size_t *s) { *c = 0; *s = 0; return OK; }
err_t W(environ_get)(P, P) { return OK; }
err_t W(args_sizes_get)(size_t *c, size_t *s) { *c = 0; *s = 0; return OK; }
err_t W(args_get)(P, P) { return OK; }
err_t W(clock_time_get)(u32, u64, u64 *t) { *t = dp_time_us() * 1000ULL; return OK; }
err_t W(clock_res_get)(u32, u64 *r) { *r = 1000; return OK; }
err_t W(random_get)(uint8_t *b, size_t n) { static uint64_t s = 0x9E3779B97F4A7C15ULL; for (size_t i = 0; i < n; i++) { s ^= s << 13; s ^= s >> 7; s ^= s << 17; b[i] = (uint8_t)s; } return OK; }
err_t W(sched_yield)(void) { dp_yield(); return OK; }
// everything else: not supported
err_t W(fd_advise)(u32, u64, u64, u32) { return NOSYS; }
err_t W(fd_allocate)(u32, u64, u64) { return NOSYS; }
err_t W(fd_datasync)(u32) { return NOSYS; }
err_t W(fd_sync)(u32) { return NOSYS; }
err_t W(fd_fdstat_get)(u32, P) { return BADF; }
err_t W(fd_fdstat_set_flags)(u32, u32) { return BADF; }
err_t W(fd_fdstat_set_rights)(u32, u64, u64) { return BADF; }
err_t W(fd_filestat_get)(u32, P) { return BADF; }
err_t W(fd_filestat_set_size)(u32, u64) { return BADF; }
err_t W(fd_filestat_set_times)(u32, u64, u64, u32) { return BADF; }
err_t W(fd_pread)(u32, P, size_t, u64, size_t *) { return BADF; }
err_t W(fd_pwrite)(u32, P, size_t, u64, size_t *) { return BADF; }
err_t W(fd_prestat_get)(u32, P) { return BADF; }
err_t W(fd_prestat_dir_name)(u32, P, size_t) { return BADF; }
err_t W(fd_readdir)(u32, P, size_t, u64, size_t *) { return BADF; }
err_t W(fd_renumber)(u32, u32) { return BADF; }
err_t W(fd_tell)(u32, u64 *) { return SPIPE; }
err_t W(path_create_directory)(u32, P, size_t) { return NOSYS; }
err_t W(path_filestat_get)(u32, u32, P, size_t, P) { return NOSYS; }
err_t W(path_filestat_set_times)(u32, u32, P, size_t, u64, u64, u32) { return NOSYS; }
err_t W(path_link)(u32, u32, P, size_t, u32, P, size_t) { return NOSYS; }
err_t W(path_open)(u32, u32, P, size_t, u32, u64, u64, u32, P) { return NOSYS; }
err_t W(path_readlink)(u32, P, size_t, P, size_t, size_t *) { return NOSYS; }
err_t W(path_remove_directory)(u32, P, size_t) { return NOSYS; }
err_t W(path_rename)(u32, P, size_t, u32, P, size_t) { return NOSYS; }
err_t W(path_symlink)(P, size_t, u32, P, size_t) { return NOSYS; }
err_t W(path_unlink_file)(u32, P, size_t) { return NOSYS; }
err_t W(poll_oneoff)(P, P, size_t, size_t *) { return NOSYS; }
err_t W(sock_accept)(u32, u32, P) { return NOSYS; }
err_t W(sock_recv)(u32, P, size_t, u32, size_t *, P) { return NOSYS; }
err_t W(sock_send)(u32, P, size_t, u32, size_t *) { return NOSYS; }
err_t W(sock_shutdown)(u32, u32) { return NOSYS; }
}
