/* Prints how the C library renders two instants after khal_time_zone_set(): July and January 2026, noon UTC. */
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <sys/time.h>
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "khal_time.h"

static void show(const char *tag, time_t t)
{
    struct tm tm; localtime_r(&t, &tm);
    esp_rom_printf("TZ %s %04d-%02d-%02d %02d:%02d dst=%d\n", tag, tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_isdst);
}
void app_main(void)
{
    struct timeval tv; gettimeofday(&tv, NULL);
    esp_rom_printf("TIME now=%lld\n", (long long)tv.tv_sec);
    bool ok = khal_time_zone_set("CET-1CEST,M3.5.0,M10.5.0/3");
    esp_rom_printf("TZ set=%d\n", ok);
    show("july", 1782907200);      /* 2026-07-01 12:00:00 UTC */
    show("jan", 1768478400);       /* 2026-01-15 12:00:00 UTC */
    khal_time_zone_set("EST5EDT,M3.2.0,M11.1.0");
    show("july-ny", 1782907200);
    for (;;) { gettimeofday(&tv, NULL); esp_rom_printf("TIME now=%lld\n", (long long)tv.tv_sec); vTaskDelay(pdMS_TO_TICKS(300)); }
}
