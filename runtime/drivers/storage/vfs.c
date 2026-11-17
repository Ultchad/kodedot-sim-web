/* SPDX-License-Identifier: GPL-3.0-or-later
 * dotbench VFS: FatFs volumes plus a small POSIX layer.
 *
 * Why this exists: the SDK's kdrv_storage.c reaches /storage and /sdcard through libc (fopen, stat, opendir,
 * rename ...). Emscripten's filesystem cannot be used from the firmware threads (it lives on the page's
 * main thread and is not exported), so include/dirent.h - which only kdrv_storage.c includes - redirects
 * those calls to dbfs_* here. Paths outside the two volumes fall through to the real libc.
 *
 * Locking: one mutex serialises every FatFs call (FF_FS_REENTRANT 0). The page-side API (dbfs_page_*) takes
 * it with a bounded try-lock, so the page never blocks behind the firmware: it gets -EBUSY and retries.
 *
 * errno mapping follows ESP-IDF's vfs_fat.c, with two POSIX corrections the SDK relies on: a missing parent
 * that is a file is ENOTDIR, and creating over a directory is EISDIR. */
#include <errno.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <dirent.h>
#include <time.h>
#include <emscripten.h>
#include "fatfs/ff.h"
#include "dotbench_vfs.h"

/* ---- FatFs glue ------------------------------------------------------------------------------------ */
void *ff_memalloc(size_t n) { return malloc(n); }
void  ff_memfree(void *p)   { free(p); }

DWORD get_fattime(void)
{
    struct timeval tv;
    gettimeofday(&tv, NULL);                     /* the wrapped one: includes the device clock offset */
    time_t t = tv.tv_sec;
    struct tm tm;
    localtime_r(&t, &tm);
    int y = tm.tm_year + 1900;
    if (y < 1980) y = 1980;
    return ((DWORD)(y - 1980) << 25) | ((DWORD)(tm.tm_mon + 1) << 21) | ((DWORD)tm.tm_mday << 16) |
           ((DWORD)tm.tm_hour << 11) | ((DWORD)tm.tm_min << 5) | ((DWORD)tm.tm_sec >> 1);
}

static pthread_mutex_t s_lock = PTHREAD_MUTEX_INITIALIZER;
static FATFS s_fs[DBV_COUNT];
static int   s_mnt[DBV_COUNT];
static uint32_t s_sd_gen;
static const char *const k_mount[DBV_COUNT] = { "/storage", "/sdcard" };
static const char *const k_drive[DBV_COUNT] = { "0:", "1:" };

#include "dotbench_persist.h"
static void lock(void) { pthread_mutex_lock(&s_lock); }
static void unlock(void) { pthread_mutex_unlock(&s_lock); }
static int try_lock(void)
{
    for (int i = 0; i < 2000; i++) { if (pthread_mutex_trylock(&s_lock) == 0) return 1; }
    return 0;
}

static int err_of(FRESULT r)
{
    switch (r) {
    case FR_OK: return 0;
    case FR_NO_FILE: case FR_NO_PATH: return ENOENT;
    case FR_INVALID_NAME: case FR_INVALID_PARAMETER: case FR_MKFS_ABORTED: return EINVAL;
    case FR_DENIED: return EACCES;
    case FR_EXIST: return EEXIST;
    case FR_INVALID_OBJECT: return EBADF;
    case FR_WRITE_PROTECTED: return EROFS;
    case FR_INVALID_DRIVE: case FR_NOT_ENABLED: case FR_NO_FILESYSTEM: return ENODEV;
    case FR_TIMEOUT: case FR_LOCKED: return EBUSY;
    case FR_NOT_ENOUGH_CORE: return ENOMEM;
    case FR_TOO_MANY_OPEN_FILES: return ENFILE;
    default: return EIO;
    }
}

/* ---- volumes --------------------------------------------------------------------------------------- */
int dbv_vol_of(const char *p)
{
    if (!p) return -1;
    for (int v = 0; v < DBV_COUNT; v++) {
        size_t n = strlen(k_mount[v]);
        if (!strncmp(p, k_mount[v], n) && (p[n] == 0 || p[n] == '/')) return v;
    }
    return -1;
}
const char *dbv_mount_point(int v) { return (v >= 0 && v < DBV_COUNT) ? k_mount[v] : NULL; }

int dbv_mounted(int v)
{
    if (v < 0 || v >= DBV_COUNT || !s_mnt[v]) return 0;
    if (v == DBV_SD) return dbd_sd_present() && dbp_devstate()->sd_generation == s_sd_gen;
    return 1;
}


/* ---- factory content ------------------------------------------------------------------------------------
 * A package may carry a factory tree for the internal volume (kodeOS: Kody's pack). The host copies it into the
 * wasm memory before main() (dbfs_seed_set: runtime/web-adapter/factory.js) as a flat archive:
 *     repeat { u16 path_len, path (no leading '/'), u32 size, bytes }      (little endian)
 * mount_locked() applies it exactly once per formatted volume: when it has just run mkfs on a BLANK internal volume
 * (a fresh device, "erase device", a damaged volume). A volume that mounts is never touched, and an explicit
 * format (dbv_format: page or firmware) is an empty volume on purpose. */
static const uint8_t *s_seed;
static uint32_t s_seed_len;
static struct { int files, errs; uint32_t bytes; } s_seed_res;

EMSCRIPTEN_KEEPALIVE void dbfs_seed_set(const uint8_t *p, uint32_t len) { s_seed = p; s_seed_len = p ? len : 0; }

static void seed_locked(int v)
{
    memset(&s_seed_res, 0, sizeof s_seed_res);
    if (v != DBV_FLASH || !s_seed || s_seed_len < 6) return;
    uint32_t o = 0;
    while (o + 2 <= s_seed_len) {
        uint32_t pl = s_seed[o] | (s_seed[o + 1] << 8);
        if (o + 2 + pl + 4 > s_seed_len || pl == 0 || pl > 200) { s_seed_res.errs++; break; }
        char path[256] = "0:/";
        memcpy(path + 3, s_seed + o + 2, pl); path[3 + pl] = 0;
        uint32_t sz = s_seed[o + 2 + pl] | (s_seed[o + 3 + pl] << 8) | (s_seed[o + 4 + pl] << 16) | ((uint32_t)s_seed[o + 5 + pl] << 24);
        const uint8_t *data = s_seed + o + 6 + pl;
        if ((uint64_t)o + 6 + pl + sz > s_seed_len) { s_seed_res.errs++; break; }
        o += 6 + pl + sz;
        for (char *q = path + 3; *q; q++) {           /* parent directories */
            if (*q == '/') { *q = 0; f_mkdir(path); *q = '/'; }
        }
        FIL f;
        if (f_open(&f, path, FA_CREATE_ALWAYS | FA_WRITE) != FR_OK) { s_seed_res.errs++; continue; }
        UINT w = 0;
        FRESULT r = sz ? f_write(&f, data, sz, &w) : FR_OK;
        FRESULT c = f_close(&f);
        if (r != FR_OK || c != FR_OK || w != sz) { s_seed_res.errs++; continue; }
        s_seed_res.files++; s_seed_res.bytes += sz;
    }
}
/* What the last format-time seeding did (files copied, bytes, errors). */
void dbv_seed_result(int *files, uint32_t *bytes, int *errs)
{
    if (files) *files = s_seed_res.files;
    if (bytes) *bytes = s_seed_res.bytes;
    if (errs) *errs = s_seed_res.errs;
}

/* mkfs parameters. The flash volume is a super-floppy (as IDF formats it). A microSD gets what a card has: an MBR with one
 * partition, FAT32 where the size needs it, and for big cards a large cluster (the way people format 64 / 128 GB cards for
 * devices that cannot read exFAT: 32 KiB), the data area aligned to 1 MiB. The sparse card (sd/sdcard.c) stores none of the zeros. */
static MKFS_PARM mkfs_opt(int v)
{
    MKFS_PARM o = { FM_ANY | FM_SFD, 0, 0, 0, (v == DBV_FLASH) ? 4096u : 0u };
    if (v == DBV_SD) {
        uint32_t mb = dbd_sd_sectors() >> 11;
        o.fmt = FM_ANY;                                      /* partitioned: MBR */
        if (mb >= 32768u) o.au_size = 32768u;                /* >= 32 GB: 32 KiB clusters */
        if (mb >= 256u) o.align = 2048u;                     /* 1 MiB */
    }
    return o;
}
#define MKFS_WORK 32768u

static int mount_locked(int v, int fmt, int *formatted)
{
    if (formatted) *formatted = 0;
    if (v == DBV_SD && !dbd_sd_present()) return FR_NOT_READY;
    f_mount(NULL, k_drive[v], 0);
    s_mnt[v] = 0;
    if (v == DBV_SD && !dbp_devstate()->sd_initialised) fmt = 1;   /* the factory card ships formatted */
    FRESULT r = f_mount(&s_fs[v], k_drive[v], 1);
    if (r == FR_NO_FILESYSTEM && fmt) {
        MKFS_PARM opt = mkfs_opt(v);
        void *work = malloc(MKFS_WORK);
        if (!work) return FR_NOT_ENOUGH_CORE;
        r = f_mkfs(k_drive[v], &opt, work, MKFS_WORK);
        free(work);
        if (r == FR_OK) { r = f_mount(&s_fs[v], k_drive[v], 1); if (formatted) *formatted = 1; if (r == FR_OK) seed_locked(v); }
    }
    if (r != FR_OK) { f_mount(NULL, k_drive[v], 0); return r; }
    s_mnt[v] = 1;
    if (v == DBV_SD) {
        s_sd_gen = dbp_devstate()->sd_generation;
        if (!dbp_devstate()->sd_initialised) { dbp_devstate()->sd_initialised = 1; dbp_devstate_changed(); }
    }
    return 0;
}
int dbv_mount(int v, int fmt, int *formatted)
{
    if (v < 0 || v >= DBV_COUNT) return FR_INVALID_DRIVE;
    lock(); int r = mount_locked(v, fmt, formatted); unlock(); return r;
}
void dbv_unmount(int v)
{
    if (v < 0 || v >= DBV_COUNT) return;
    lock(); f_mount(NULL, k_drive[v], 0); s_mnt[v] = 0; unlock();
}
int dbv_format(int v)
{
    if (v < 0 || v >= DBV_COUNT) return FR_INVALID_DRIVE;
    lock();
    int r;
    if (v == DBV_SD && !dbd_sd_present()) r = FR_NOT_READY;
    else {
        f_mount(NULL, k_drive[v], 0); s_mnt[v] = 0;
        MKFS_PARM opt = mkfs_opt(v);
        void *work = malloc(MKFS_WORK);
        r = work ? (int)f_mkfs(k_drive[v], &opt, work, MKFS_WORK) : FR_NOT_ENOUGH_CORE;
        free(work);
        if (r == FR_OK) r = mount_locked(v, 0, NULL);
    }
    unlock();
    return r;
}
int dbv_info(int v, uint64_t *total, uint64_t *freeb)
{
    if (!dbv_mounted(v)) return -1;
    lock();
    FATFS *fs = NULL; DWORD fc = 0;
    FRESULT r = f_getfree(k_drive[v], &fc, &fs);
    int rc = -1;
    if (r == FR_OK && fs) {
        uint64_t cb = (uint64_t)fs->csize * (v == DBV_FLASH ? 4096u : 512u);
        if (total) *total = (uint64_t)(fs->n_fatent - 2) * cb;
        if (freeb) *freeb = (uint64_t)fc * cb;
        rc = 0;
    }
    unlock();
    return rc;
}
uint32_t dbv_cluster_bytes(int v)
{
    if (!dbv_mounted(v)) return 0;
    return (uint32_t)s_fs[v].csize * (v == DBV_FLASH ? 4096u : 512u);
}

/* ---- path mapping ---------------------------------------------------------------------------------- */
/* "/storage/a/b" -> "0:/a/b"; the volume root -> "0:/". Returns the volume or -1. */
static int fpath(const char *p, char *out, size_t cap)
{
    int v = dbv_vol_of(p);
    if (v < 0) return -1;
    const char *rest = p + strlen(k_mount[v]);
    if (snprintf(out, cap, "%s%s", k_drive[v], *rest ? rest : "/") >= (int)cap) return -1;
    return v;
}
#define MAXP 160

static int is_root(const char *fp) { return fp[2] == '/' && fp[3] == 0; }

/* what is at this path: 0 nothing, 1 file, 2 dir */
static int kind_of(const char *fp, FILINFO *fi)
{
    FILINFO local;
    if (!fi) fi = &local;
    if (is_root(fp)) { memset(fi, 0, sizeof *fi); fi->fattrib = AM_DIR; return 2; }
    if (f_stat(fp, fi) != FR_OK) return 0;
    return (fi->fattrib & AM_DIR) ? 2 : 1;
}

/* After a failure with ENOENT: is some parent actually a file? (POSIX ENOTDIR). */
static int refine_noent(const char *fp, int e)
{
    if (e != ENOENT) return e;
    char tmp[MAXP];
    snprintf(tmp, sizeof tmp, "%s", fp);
    for (;;) {
        char *s = strrchr(tmp, '/');
        if (!s || s < tmp + 2) return e;
        if (s == tmp + 2) return e;
        *s = 0;
        int k = kind_of(tmp, NULL);
        if (k == 1) return ENOTDIR;
        if (k == 2) return e;
    }
}

static int no_space(int v)
{
    FATFS *fs; DWORD fc;
    return f_getfree(k_drive[v], &fc, &fs) == FR_OK && fc == 0;
}

/* ---- file handles ---------------------------------------------------------------------------------- */
#define WBUF 1024
typedef struct { int used, vol, err, eof, writing; FIL f; uint16_t wn; uint8_t wb[WBUF]; } dbf_t;
typedef struct { int used; FF_DIR d; struct dirent ent; } dbd_t;
static dbf_t s_files[8];
static dbd_t s_dirs[8];
static int in_pool(const void *p) { return (const dbf_t *)p >= s_files && (const dbf_t *)p < s_files + 8; }
static int in_dpool(const void *p) { return (const dbd_t *)p >= s_dirs && (const dbd_t *)p < s_dirs + 8; }

static int fl_flush(dbf_t *h)
{
    if (!h->wn) return 0;
    UINT bw = 0;
    FRESULT r = f_write(&h->f, h->wb, h->wn, &bw);
    int ok = (r == FR_OK && bw == h->wn);
    if (!ok) { h->err = (r == FR_OK) ? ENOSPC : err_of(r); if (r == FR_DENIED) h->err = ENOSPC; }
    h->wn = 0;
    return ok ? 0 : -1;
}

/* ---- the POSIX surface (names the shadow dirent.h maps libc onto) ------------------------------------ */
FILE *dbfs_fopen(const char *path, const char *mode)
{
    char fp[MAXP];
    int v = fpath(path, fp, sizeof fp);
    if (v < 0) return fopen(path, mode);
    int plus = strchr(mode, '+') != NULL;
    BYTE fm;
    switch (mode[0]) {
    case 'r': fm = FA_READ | (plus ? FA_WRITE : 0); break;
    case 'w': fm = FA_WRITE | FA_CREATE_ALWAYS | (plus ? FA_READ : 0); break;
    case 'a': fm = FA_WRITE | FA_OPEN_APPEND | (plus ? FA_READ : 0); break;
    default: errno = EINVAL; return NULL;
    }
    lock();
    FILE *ret = NULL;
    if (!dbv_mounted(v)) { errno = EIO; goto out; }
    dbf_t *h = NULL;
    for (int i = 0; i < 8; i++) if (!s_files[i].used) { h = &s_files[i]; break; }
    if (!h) { errno = ENFILE; goto out; }
    if (is_root(fp) || kind_of(fp, NULL) == 2) { errno = EISDIR; goto out; }
    memset(h, 0, sizeof *h);
    FRESULT r = f_open(&h->f, fp, fm);
    if (r != FR_OK) {
        int e = refine_noent(fp, err_of(r));
        if (r == FR_DENIED && no_space(v)) e = ENOSPC;
        errno = e; goto out;
    }
    h->used = 1; h->vol = v; h->writing = (fm & FA_WRITE) != 0;
    ret = (FILE *)(void *)h;
out:
    unlock();
    return ret;
}

int dbfs_fclose(FILE *f)
{
    if (!in_pool(f)) return fclose(f);
    dbf_t *h = (dbf_t *)(void *)f;
    lock();
    int bad = 0;
    if (h->writing && fl_flush(h) != 0) bad = h->err;
    FRESULT r = f_close(&h->f);
    if (r != FR_OK && !bad) bad = err_of(r);
    h->used = 0;
    unlock();
    if (bad) { errno = bad; return EOF; }
    return 0;
}

size_t dbfs_fread(void *buf, size_t sz, size_t n, FILE *f)
{
    if (!in_pool(f)) return fread(buf, sz, n, f);
    dbf_t *h = (dbf_t *)(void *)f;
    size_t want = sz * n;
    if (!want) return 0;
    lock();
    if (h->writing) fl_flush(h);
    UINT br = 0;
    FRESULT r = f_read(&h->f, buf, (UINT)want, &br);
    if (r != FR_OK) { h->err = err_of(r); errno = h->err; }
    else if (br < want) h->eof = 1;
    unlock();
    return br / sz;
}

size_t dbfs_fwrite(const void *buf, size_t sz, size_t n, FILE *f)
{
    if (!in_pool(f)) return fwrite(buf, sz, n, f);
    dbf_t *h = (dbf_t *)(void *)f;
    size_t len = sz * n, done = 0;
    if (!len) return 0;
    lock();
    if (!h->writing) { h->err = EBADF; errno = EBADF; unlock(); return 0; }
    const uint8_t *p = buf;
    while (done < len) {
        size_t room = WBUF - h->wn, k = len - done < room ? len - done : room;
        memcpy(h->wb + h->wn, p + done, k);
        h->wn += (uint16_t)k; done += k;
        if (h->wn == WBUF && fl_flush(h) != 0) { errno = h->err; break; }
    }
    unlock();
    return done / sz;
}

int dbfs_fseek(FILE *f, long off, int whence)
{
    if (!in_pool(f)) return fseek(f, off, whence);
    dbf_t *h = (dbf_t *)(void *)f;
    lock();
    if (h->writing) fl_flush(h);
    long base = whence == SEEK_CUR ? (long)f_tell(&h->f) : whence == SEEK_END ? (long)f_size(&h->f) : 0;
    long to = base + off;
    int rc = -1;
    if (to < 0) errno = EINVAL;
    else {
        FRESULT r = f_lseek(&h->f, (FSIZE_t)to);
        if (r != FR_OK) errno = err_of(r);
        else if ((long)f_tell(&h->f) != to) errno = EINVAL;      /* read-only files cannot grow */
        else { rc = 0; h->eof = 0; }
    }
    unlock();
    return rc;
}

long dbfs_ftell(FILE *f)
{
    if (!in_pool(f)) return ftell(f);
    dbf_t *h = (dbf_t *)(void *)f;
    return (long)f_tell(&h->f) + (long)h->wn;
}

int dbfs_ferror(FILE *f) { return in_pool(f) ? ((dbf_t *)(void *)f)->err != 0 : ferror(f); }
int dbfs_feof(FILE *f) { return in_pool(f) ? ((dbf_t *)(void *)f)->eof : feof(f); }
int dbfs_fflush(FILE *f)
{
    if (!f) return fflush(f);
    if (!in_pool(f)) return fflush(f);
    dbf_t *h = (dbf_t *)(void *)f;
    lock(); int rc = h->writing ? fl_flush(h) : 0; if (!rc && h->writing) f_sync(&h->f); unlock();
    if (rc) errno = h->err;
    return rc ? EOF : 0;
}

int dbfs_remove(const char *path)
{
    char fp[MAXP];
    int v = fpath(path, fp, sizeof fp);
    if (v < 0) return remove(path);
    lock();
    int rc = -1;
    if (!dbv_mounted(v)) errno = EIO;
    else if (is_root(fp)) errno = EBUSY;
    else {
        FRESULT r = f_unlink(fp);
        if (r == FR_OK) rc = 0;
        else {
            int e = refine_noent(fp, err_of(r));
            if (r == FR_DENIED) e = (kind_of(fp, NULL) == 2) ? ENOTEMPTY : EACCES;
            errno = e;
        }
    }
    unlock();
    return rc;
}

int dbfs_rmdir(const char *path)
{
    char fp[MAXP];
    int v = fpath(path, fp, sizeof fp);
    if (v < 0) return rmdir(path);
    lock();
    int rc = -1;
    if (!dbv_mounted(v)) errno = EIO;
    else if (is_root(fp)) errno = EBUSY;
    else {
        int k = kind_of(fp, NULL);
        if (k == 0) errno = refine_noent(fp, ENOENT);
        else if (k == 1) errno = ENOTDIR;
        else {
            FRESULT r = f_unlink(fp);
            if (r == FR_OK) rc = 0; else errno = (r == FR_DENIED) ? ENOTEMPTY : err_of(r);
        }
    }
    unlock();
    return rc;
}

int dbfs_mkdir(const char *path, mode_t mode)
{
    char fp[MAXP];
    int v = fpath(path, fp, sizeof fp);
    if (v < 0) return mkdir(path, mode);
    lock();
    int rc = -1;
    if (!dbv_mounted(v)) errno = EIO;
    else if (is_root(fp)) errno = EEXIST;
    else {
        FRESULT r = f_mkdir(fp);
        if (r == FR_OK) rc = 0;
        else {
            int e = refine_noent(fp, err_of(r));
            if (r == FR_DENIED && no_space(v)) e = ENOSPC;
            errno = e;
        }
    }
    unlock();
    return rc;
}

int dbfs_rename(const char *from, const char *to)
{
    char a[MAXP], b[MAXP];
    int va = fpath(from, a, sizeof a), vb = fpath(to, b, sizeof b);
    if (va < 0 && vb < 0) return rename(from, to);
    if (va != vb) { errno = EXDEV; return -1; }
    lock();
    int rc = -1;
    if (!dbv_mounted(va)) errno = EIO;
    else {
        FRESULT r = f_rename(a, b);
        if (r == FR_OK) rc = 0; else errno = refine_noent(b, err_of(r));
    }
    unlock();
    return rc;
}

static void fill_stat(struct stat *st, const FILINFO *fi)
{
    memset(st, 0, sizeof *st);
    st->st_mode = (fi->fattrib & AM_DIR) ? (S_IFDIR | 0777) : (S_IFREG | 0666);
    st->st_size = (off_t)fi->fsize;
    st->st_nlink = 1;
    struct tm tm; memset(&tm, 0, sizeof tm);
    tm.tm_year = (fi->fdate >> 9) + 80; tm.tm_mon = ((fi->fdate >> 5) & 15) - 1; tm.tm_mday = fi->fdate & 31;
    tm.tm_hour = fi->ftime >> 11; tm.tm_min = (fi->ftime >> 5) & 63; tm.tm_sec = (fi->ftime & 31) * 2; tm.tm_isdst = -1;
    if (fi->fdate) st->st_mtime = mktime(&tm);
    st->st_atime = st->st_ctime = st->st_mtime;
}

int dbfs_stat(const char *path, struct stat *st)
{
    char fp[MAXP];
    int v = fpath(path, fp, sizeof fp);
    if (v < 0) return stat(path, st);
    lock();
    int rc = -1;
    if (!dbv_mounted(v)) errno = EIO;
    else {
        FILINFO fi;
        int k = kind_of(fp, &fi);
        if (k) { fill_stat(st, &fi); rc = 0; }
        else errno = refine_noent(fp, ENOENT);
    }
    unlock();
    return rc;
}

DIR *dbfs_opendir(const char *path)
{
    char fp[MAXP];
    int v = fpath(path, fp, sizeof fp);
    if (v < 0) return opendir(path);
    lock();
    DIR *ret = NULL;
    if (!dbv_mounted(v)) errno = EIO;
    else {
        dbd_t *d = NULL;
        for (int i = 0; i < 8; i++) if (!s_dirs[i].used) { d = &s_dirs[i]; break; }
        if (!d) errno = ENFILE;
        else {
            int k = kind_of(fp, NULL);
            if (k == 1) errno = ENOTDIR;
            else if (k == 0) errno = refine_noent(fp, ENOENT);
            else {
                FRESULT r = f_opendir(&d->d, fp);
                if (r != FR_OK) errno = err_of(r); else { d->used = 1; ret = (DIR *)(void *)d; }
            }
        }
    }
    unlock();
    return ret;
}

struct dirent *dbfs_readdir(DIR *dir)
{
    if (!in_dpool(dir)) return readdir(dir);
    dbd_t *d = (dbd_t *)(void *)dir;
    FILINFO fi;
    lock();
    FRESULT r = f_readdir(&d->d, &fi);
    unlock();
    if (r != FR_OK || fi.fname[0] == 0) return NULL;
    memset(&d->ent, 0, sizeof d->ent);
    snprintf(d->ent.d_name, sizeof d->ent.d_name, "%s", fi.fname);
    d->ent.d_type = (fi.fattrib & AM_DIR) ? DT_DIR : DT_REG;
    return &d->ent;
}

int dbfs_closedir(DIR *dir)
{
    if (!in_dpool(dir)) return closedir(dir);
    dbd_t *d = (dbd_t *)(void *)dir;
    lock(); f_closedir(&d->d); d->used = 0; unlock();
    return 0;
}

/* ---- page-side API ------------------------------------------------------------------------------------
 * The page thread calls these while the firmware runs. A 64 KiB scratch holds the arguments and data:
 *   [0,512) path A   [512,1024) path B   [1024,65536) data.
 * Every call returns a value >= 0 or -errno; -EBUSY means the firmware held the volume lock: retry. */
#define SCR 65536
#define SCR_DATA 1024
static uint8_t s_scr[SCR];
EMSCRIPTEN_KEEPALIVE uint8_t *dbfs_scratch(void) { return s_scr; }
EMSCRIPTEN_KEEPALIVE int dbfs_scratch_size(void) { return SCR; }

#define PG_ENTER(path, fpv, vv) char fpv[MAXP]; int vv = fpath(path, fpv, sizeof fpv); \
    if (vv < 0) return -EINVAL; if (!try_lock()) return -EBUSY; \
    if (!dbv_mounted(vv)) { if (vv == DBV_SD) { unlock(); return -ENODEV; } \
        if (mount_locked(vv, 1, NULL)) { unlock(); return -ENODEV; } }

EMSCRIPTEN_KEEPALIVE int dbfs_page_mounted(int vol) { return dbv_mounted(vol); }

/* list: "<d|f>\t<size>\t<name>\n" lines into scratch data; returns bytes (truncated at the buffer end) */
EMSCRIPTEN_KEEPALIVE int dbfs_page_list(void)
{
    const char *path = (const char *)s_scr;
    PG_ENTER(path, fp, v)
    FF_DIR d; FILINFO fi; int n = 0;
    int kd = kind_of(fp, NULL);
    if (kd == 1) { unlock(); return -ENOTDIR; }
    FRESULT r = f_opendir(&d, fp);
    if (r != FR_OK) { int e = refine_noent(fp, err_of(r)); unlock(); return -e; }
    while (f_readdir(&d, &fi) == FR_OK && fi.fname[0]) {
        int k = snprintf((char *)s_scr + SCR_DATA + n, SCR - SCR_DATA - n, "%c\t%u\t%s\n",
                         (fi.fattrib & AM_DIR) ? 'd' : 'f', (unsigned)fi.fsize, fi.fname);
        if (k < 0 || k >= SCR - SCR_DATA - n) break;
        n += k;
    }
    f_closedir(&d);
    unlock();
    return n;
}

/* stat: returns size (>=0); sets scratch[1024] = 1 file / 2 dir */
EMSCRIPTEN_KEEPALIVE int dbfs_page_stat(void)
{
    const char *path = (const char *)s_scr;
    PG_ENTER(path, fp, v)
    FILINFO fi; int k = kind_of(fp, &fi);
    int rc = k ? (int)fi.fsize : -ENOENT;
    if (k) s_scr[SCR_DATA] = (uint8_t)k;
    unlock();
    return rc;
}

/* read up to len (<= 63 KiB) bytes at off into scratch data; returns bytes read */
EMSCRIPTEN_KEEPALIVE int dbfs_page_read(uint32_t off, int len)
{
    const char *path = (const char *)s_scr;
    if (len < 0 || len > SCR - SCR_DATA) return -EINVAL;
    PG_ENTER(path, fp, v)
    FIL f; FRESULT r = f_open(&f, fp, FA_READ);
    if (r != FR_OK) { int e = refine_noent(fp, err_of(r)); unlock(); return -e; }
    UINT br = 0;
    r = f_lseek(&f, off);
    if (r == FR_OK) r = f_read(&f, s_scr + SCR_DATA, (UINT)len, &br);
    f_close(&f);
    unlock();
    return r == FR_OK ? (int)br : -err_of(r);
}

/* write len bytes of scratch data at off. flags: 1 = truncate the file first (create/replace), 2 = append */
EMSCRIPTEN_KEEPALIVE int dbfs_page_write(uint32_t off, int len, int flags)
{
    const char *path = (const char *)s_scr;
    if (len < 0 || len > SCR - SCR_DATA) return -EINVAL;
    PG_ENTER(path, fp, v)
    FILINFO fi;
    if (kind_of(fp, &fi) == 2) { unlock(); return -EISDIR; }
    FIL f; FRESULT r = f_open(&f, fp, FA_WRITE | ((flags & 1) ? FA_CREATE_ALWAYS : FA_OPEN_ALWAYS));
    if (r != FR_OK) {
        int e = refine_noent(fp, err_of(r)); if (r == FR_DENIED && no_space(v)) e = ENOSPC;
        unlock(); return -e;
    }
    UINT bw = 0;
    r = (flags & 2) ? f_lseek(&f, f_size(&f)) : f_lseek(&f, off);
    if (r == FR_OK && len) r = f_write(&f, s_scr + SCR_DATA, (UINT)len, &bw);
    FRESULT rc = f_close(&f);
    int out = (r != FR_OK) ? -err_of(r) : (rc != FR_OK) ? -err_of(rc) : (bw < (UINT)len ? -ENOSPC : (int)bw);
    unlock();
    return out;
}

EMSCRIPTEN_KEEPALIVE int dbfs_page_truncate(uint32_t len)
{
    const char *path = (const char *)s_scr;
    PG_ENTER(path, fp, v)
    FIL f; FRESULT r = f_open(&f, fp, FA_WRITE | FA_READ);
    int out;
    if (r != FR_OK) out = -refine_noent(fp, err_of(r));
    else {
        if (len <= f_size(&f)) { r = f_lseek(&f, len); if (r == FR_OK) r = f_truncate(&f); }
        else {                                      /* grow: f_lseek would expose old cluster data, so write the zeros */
            r = f_lseek(&f, f_size(&f));
            static const uint8_t zeros[512];
            while (r == FR_OK && f_tell(&f) < len) {
                UINT n = (UINT)((len - f_tell(&f)) < sizeof zeros ? (len - f_tell(&f)) : sizeof zeros), bw = 0;
                r = f_write(&f, zeros, n, &bw);
                if (r == FR_OK && bw < n) r = FR_DENIED;
            }
        }
        FRESULT rc = f_close(&f);
        out = r != FR_OK ? -(no_space(v) ? ENOSPC : err_of(r)) : rc != FR_OK ? -err_of(rc) : 0;
    }
    unlock();
    return out;
}

EMSCRIPTEN_KEEPALIVE int dbfs_page_remove(void) { return dbfs_remove((const char *)s_scr) == 0 ? 0 : -errno; }
EMSCRIPTEN_KEEPALIVE int dbfs_page_mkdir(void)  { return dbfs_mkdir((const char *)s_scr, 0777) == 0 ? 0 : -errno; }
EMSCRIPTEN_KEEPALIVE int dbfs_page_rename(void) { return dbfs_rename((const char *)s_scr, (const char *)s_scr + 512) == 0 ? 0 : -errno; }

/* usage: total and free bytes as two u32 pairs in scratch data: [total_lo, total_hi, free_lo, free_hi] */
EMSCRIPTEN_KEEPALIVE int dbfs_page_usage(int vol)
{
    uint64_t t = 0, f = 0;
    if (!dbv_mounted(vol) || dbv_info(vol, &t, &f) != 0) return -ENODEV;
    uint32_t *o = (uint32_t *)(void *)(s_scr + SCR_DATA);
    o[0] = (uint32_t)t; o[1] = (uint32_t)(t >> 32); o[2] = (uint32_t)f; o[3] = (uint32_t)(f >> 32);
    return 0;
}
EMSCRIPTEN_KEEPALIVE int dbfs_page_format(int vol) { return dbv_format(vol) == 0 ? 0 : -EIO; }

/* ---- the card, from the page --------------------------------------------------------------------------- */
int dbsd_set_inserted(int ins)
{
    dbp_devstate_t *d = dbp_devstate();
    if ((d->sd_inserted != 0) == (ins != 0)) return 0;
    d->sd_inserted = ins ? 1 : 0;
    __atomic_add_fetch(&d->sd_generation, 1, __ATOMIC_SEQ_CST);
    dbp_devstate_changed();
    return 0;
}
int dbsd_set_write_protect(int wp)
{
    dbp_devstate_t *d = dbp_devstate();
    d->sd_write_protect = wp ? 1 : 0; dbp_devstate_changed(); return 0;
}
/* A different card: new capacity and serial, blank or FAT formatted. Lock-free: the page only writes the slot state and asks
 * the firmware side to reset the card's table (sdcard.c, at its next access). A formatted card is made at its first
 * mount (sd_initialised = 0 means "format at the first mount", as for the factory card); a blank one has no FAT. */
int dbsd_new_card(int mb, int format)
{
    if (mb < (int)DBV_SD_MIN_MB || mb > (int)DBV_SD_MAX_MB) return -EINVAL;
    dbp_devstate_t *d = dbp_devstate();
    d->sd_capacity_mb = (uint32_t)mb; d->sd_serial += 0x01010101u; d->sd_write_protect = 0;
    d->sd_initialised = format ? 0 : 1;
    d->sd_inserted = 1;
    __atomic_add_fetch(&d->sd_generation, 1, __ATOMIC_SEQ_CST);
    dbp_devstate_changed();
    dbsd_card_changed();
    return 0;
}
EMSCRIPTEN_KEEPALIVE int dbfs_page_sd_mount(void)
{
    if (!try_lock()) return -EBUSY;
    int r = mount_locked(DBV_SD, 0, NULL);
    unlock();
    return r == 0 ? 0 : -err_of((FRESULT)r);
}
EMSCRIPTEN_KEEPALIVE int dbfs_page_sd_unmount(void) { dbv_unmount(DBV_SD); return 0; }
EMSCRIPTEN_KEEPALIVE int dbsd_page_set_inserted(int i) { return dbsd_set_inserted(i); }
EMSCRIPTEN_KEEPALIVE int dbsd_page_new_card(int mb, int format) { return dbsd_new_card(mb, format); }
/* stats: [stored lo, stored hi, bound lo, bound hi, layout (1 sparse, 2 dense), known, pool bytes, 0] into scratch data */
EMSCRIPTEN_KEEPALIVE int dbsd_page_stats(void) { dbsd_stats((uint32_t *)(void *)(s_scr + SCR_DATA)); return 0; }
/* Raw sectors from the page (tests, a future "load a card image"): write != 0 stores `count` sectors from `buf`. 0 or -EIO. */
EMSCRIPTEN_KEEPALIVE int dbsd_page_sectors(int write, uint32_t first, uint32_t count, void *buf)
{
    return (write ? dbd_sd_write(first, count, buf) : dbd_sd_read(first, count, buf)) == 0 ? 0 : -EIO;
}
EMSCRIPTEN_KEEPALIVE int dbsd_page_set_wp(int wp) { return dbsd_set_write_protect(wp); }
/* state: [inserted, capacity_mb, serial, write_protect, generation, mounted] into scratch data */
EMSCRIPTEN_KEEPALIVE int dbsd_page_state(void)
{
    dbp_devstate_t *d = dbp_devstate();
    uint32_t *o = (uint32_t *)(void *)(s_scr + SCR_DATA);
    o[0] = d->sd_inserted; o[1] = d->sd_capacity_mb; o[2] = d->sd_serial; o[3] = d->sd_write_protect;
    o[4] = d->sd_generation; o[5] = (uint32_t)dbv_mounted(DBV_SD);
    return 0;
}
