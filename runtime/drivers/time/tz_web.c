/* SPDX-License-Identifier: GPL-3.0-or-later
 * localtime_r() that honours the device's POSIX TZ string.
 *
 * Why: the SDK's zone code (khal_time_zone.c, kept real) does setenv("TZ", ...) + tzset() and then asks the C library for
 * local time. Emscripten's libc ignores TZ and renders local time in the HOST's zone (the browser's), so the device's
 * `config key="zone"` setting would have no effect and a device would show the zone of whoever opened the page. This
 * definition replaces libc's localtime_r (and so localtime(), which calls it) and implements the POSIX TZ grammar:
 *   std offset [dst [offset] [,start[/time],end[/time]]]       std/dst: ABC or <+03>;  offset: [+-]hh[:mm[:ss]], west positive
 *   rule: Mm.w.d | Jn | n.   Times may be negative or above 24 h (POSIX extension). No rule given with a DST name: US rules.
 * An unset or unparsable TZ is UTC, as on the board. */
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <stdint.h>

typedef struct { char type; int m, w, d; int64_t time; } rule_t;   /* type: 'M', 'J' (1..365, no leap day), 'N' (0..365) */
typedef struct {
    char std[8], dst[8]; int64_t std_off, dst_off;     /* seconds WEST of UTC, as written in TZ */
    int has_dst; rule_t start, end;
} zone_t;

static const char *name_of(const char *p, char *out)
{
    size_t n = 0;
    if (*p == '<') { p++; while (*p && *p != '>') { if (n < 7) out[n++] = *p; p++; } if (*p == '>') p++; else return NULL; }
    else { while ((*p >= 'A' && *p <= 'Z') || (*p >= 'a' && *p <= 'z')) { if (n < 7) out[n++] = *p; p++; } }
    out[n] = 0;
    return n >= 3 ? p : NULL;
}
static const char *num(const char *p, int64_t *v) { if (*p < '0' || *p > '9') return NULL; int64_t x = 0; while (*p >= '0' && *p <= '9') x = x * 10 + (*p++ - '0'); *v = x; return p; }
/* [+-]hh[:mm[:ss]] -> seconds */
static const char *hms(const char *p, int64_t *out)
{
    int sign = 1; int64_t h, m = 0, s = 0;
    if (*p == '+') p++; else if (*p == '-') { sign = -1; p++; }
    if (!(p = num(p, &h))) return NULL;
    if (*p == ':') { if (!(p = num(p + 1, &m))) return NULL; if (*p == ':') if (!(p = num(p + 1, &s))) return NULL; }
    *out = sign * (h * 3600 + m * 60 + s);
    return p;
}
static const char *rule(const char *p, rule_t *r)
{
    int64_t a, b, c;
    r->time = 7200;
    if (*p == 'M') {
        if (!(p = num(p + 1, &a)) || *p != '.' || !(p = num(p + 1, &b)) || *p != '.' || !(p = num(p + 1, &c))) return NULL;
        if (a < 1 || a > 12 || b < 1 || b > 5 || c > 6) return NULL;
        r->type = 'M'; r->m = (int)a; r->w = (int)b; r->d = (int)c;
    } else if (*p == 'J') {
        if (!(p = num(p + 1, &a)) || a < 1 || a > 365) return NULL;
        r->type = 'J'; r->d = (int)a;
    } else {
        if (!(p = num(p, &a)) || a > 365) return NULL;
        r->type = 'N'; r->d = (int)a;
    }
    if (*p == '/') { if (!(p = hms(p + 1, &r->time))) return NULL; }
    return p;
}
static int parse(const char *tz, zone_t *z)
{
    memset(z, 0, sizeof *z);
    const char *p = name_of(tz, z->std);
    if (!p || !(p = hms(p, &z->std_off))) return 0;
    if (!*p) return 1;
    if (!(p = name_of(p, z->dst))) return 0;
    z->has_dst = 1; z->dst_off = z->std_off - 3600;
    if (*p && *p != ',') { if (!(p = hms(p, &z->dst_off))) return 0; }
    if (*p == ',') {
        if (!(p = rule(p + 1, &z->start)) || *p != ',' || !(p = rule(p + 1, &z->end)) || *p) return 0;
    } else if (!*p) {
        z->start = (rule_t){ 'M', 3, 2, 0, 7200 }; z->end = (rule_t){ 'M', 11, 1, 0, 7200 };
    } else return 0;
    return 1;
}

static int leap(int64_t y) { return (y % 4 == 0 && y % 100 != 0) || y % 400 == 0; }
static int64_t days_from_civil(int64_t y, int m, int d)
{
    y -= m <= 2; int64_t era = (y >= 0 ? y : y - 399) / 400; int64_t yoe = y - era * 400;
    int64_t doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1, doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + doe - 719468;
}
static void civil_from_days(int64_t z, int64_t *y, int *m, int *d)
{
    z += 719468; int64_t era = (z >= 0 ? z : z - 146096) / 146097; int64_t doe = z - era * 146097;
    int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365, yy = yoe + era * 400;
    int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100), mp = (5 * doy + 2) / 153;
    *d = (int)(doy - (153 * mp + 2) / 5 + 1); *m = (int)(mp < 10 ? mp + 3 : mp - 9); *y = yy + (*m <= 2);
}
/* seconds since epoch of the rule's instant in year y, as LOCAL wall time (no offset applied) */
static int64_t rule_local(const rule_t *r, int64_t y)
{
    int64_t day;
    if (r->type == 'M') {
        int64_t first = days_from_civil(y, r->m, 1);
        int wd = (int)(((first % 7) + 11) % 7);               /* 1970-01-01 was a Thursday (4) */
        int d = 1 + ((r->d - wd + 7) % 7) + (r->w - 1) * 7;
        static const int mdays[] = { 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };
        int dim = mdays[r->m - 1] + (r->m == 2 && leap(y));
        while (d > dim) d -= 7;
        day = first + d - 1;
    } else if (r->type == 'J') {
        int n = r->d - 1; if (leap(y) && r->d >= 60) n++;      /* Jn never counts Feb 29 */
        day = days_from_civil(y, 1, 1) + n;
    } else day = days_from_civil(y, 1, 1) + r->d;
    return day * 86400 + r->time;
}

struct tm *localtime_r(const time_t *tp, struct tm *out)
{
    static __thread char cached[96]; static __thread zone_t zone; static __thread int valid;
    const char *tz = getenv("TZ");
    if (!tz) tz = "";
    if (strncmp(cached, tz, sizeof cached - 1) != 0 || strlen(tz) >= sizeof cached) {
        valid = strlen(tz) < sizeof cached && parse(tz, &zone);
        strncpy(cached, tz, sizeof cached - 1); cached[sizeof cached - 1] = 0;
    }
    int64_t t = (int64_t)*tp, off = 0; int isdst = 0; const char *abbr = "UTC";
    if (valid) {
        off = -zone.std_off; abbr = zone.std;
        if (zone.has_dst) {
            int64_t y; int m, d;
            civil_from_days((t + off) >= 0 ? (t + off) / 86400 : -((-(t + off) + 86399) / 86400), &y, &m, &d);
            int64_t s = rule_local(&zone.start, y) + zone.std_off;       /* UTC instants of the two transitions */
            int64_t e = rule_local(&zone.end, y) + zone.dst_off;
            int in = s < e ? (t >= s && t < e) : !(t >= e && t < s);
            if (in) { off = -zone.dst_off; abbr = zone.dst; isdst = 1; }
        }
    }
    int64_t lt = t + off, days = lt >= 0 ? lt / 86400 : -((-lt + 86399) / 86400), sod = lt - days * 86400;
    int64_t y; int mo, dd; civil_from_days(days, &y, &mo, &dd);
    out->tm_year = (int)(y - 1900); out->tm_mon = mo - 1; out->tm_mday = dd;
    out->tm_hour = (int)(sod / 3600); out->tm_min = (int)(sod % 3600 / 60); out->tm_sec = (int)(sod % 60);
    out->tm_wday = (int)(((days % 7) + 11) % 7);
    out->tm_yday = (int)(days - days_from_civil(y, 1, 1));
    out->tm_isdst = isdst; out->tm_gmtoff = (long)off;
    static __thread char zname[8]; strncpy(zname, abbr, 7); zname[7] = 0;
    out->tm_zone = zname;
    return out;
}
