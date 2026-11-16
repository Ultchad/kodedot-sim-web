/* SPDX-License-Identifier: GPL-3.0-or-later
 * Shadow of <dirent.h> for the SDK's kdrv_storage.c - the only file in the build that includes it.
 * It leaves the real libc declarations alone and redirects the file calls that kdrv_storage.c makes to the
 * dotbench VFS (runtime/drivers/storage/vfs.c), which serves /storage and /sdcard from FatFs and forwards
 * every other path to the real libc. */
#ifndef DOTBENCH_SHADOW_DIRENT_H
#define DOTBENCH_SHADOW_DIRENT_H
#include_next <dirent.h>
#include <stdio.h>
#include <errno.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#ifdef __cplusplus
extern "C" {
#endif
FILE *dbfs_fopen(const char *path, const char *mode);
int dbfs_fclose(FILE *f);
size_t dbfs_fread(void *buf, size_t sz, size_t n, FILE *f);
size_t dbfs_fwrite(const void *buf, size_t sz, size_t n, FILE *f);
int dbfs_fseek(FILE *f, long off, int whence);
long dbfs_ftell(FILE *f);
int dbfs_ferror(FILE *f);
int dbfs_feof(FILE *f);
int dbfs_fflush(FILE *f);
int dbfs_remove(const char *path);
int dbfs_rmdir(const char *path);
int dbfs_mkdir(const char *path, mode_t mode);
int dbfs_rename(const char *from, const char *to);
int dbfs_stat(const char *path, struct stat *st);
DIR *dbfs_opendir(const char *path);
struct dirent *dbfs_readdir(DIR *d);
int dbfs_closedir(DIR *d);
#ifdef __cplusplus
}
#endif

#undef fopen
#undef fclose
#undef fread
#undef fwrite
#undef fseek
#undef ftell
#undef ferror
#undef feof
#undef fflush
#define fopen    dbfs_fopen
#define fclose   dbfs_fclose
#define fread    dbfs_fread
#define fwrite   dbfs_fwrite
#define fseek    dbfs_fseek
#define ftell    dbfs_ftell
#define ferror   dbfs_ferror
#define feof     dbfs_feof
#define fflush   dbfs_fflush
#define remove   dbfs_remove
#define rmdir    dbfs_rmdir
#define mkdir    dbfs_mkdir
#define rename   dbfs_rename
#define stat(p, s) dbfs_stat((p), (s))
#define opendir  dbfs_opendir
#define readdir  dbfs_readdir
#define closedir dbfs_closedir
#endif
