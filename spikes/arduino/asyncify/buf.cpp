#include <stdint.h>
static uint8_t g_buf[32768] __attribute__((aligned(16)));
extern "C" __attribute__((export_name("dp_asyncify_buf"), used)) uint8_t *dp_asyncify_buf(void) { return g_buf; }
