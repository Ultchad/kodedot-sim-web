// SPDX-License-Identifier: GPL-3.0-or-later
// What ArduinoCore-API's String.cpp needs from the C library and neither wasi-libc nor the Emscripten sysroot provides:
// itoa, ltoa, utoa, ultoa, dtostrf. FINDING: the same two link errors happen today with `dotbench part build` (any sketch that uses String
// fails to link: undefined symbol itoa / dtostrf), so these belong in runtime/parts/core/dotcore.cpp for both flavours.
#include <stdio.h>
#include <stdlib.h>
static char *conv(unsigned long long v, bool neg, char *out, int radix) {
  if (radix < 2 || radix > 36) { out[0] = 0; return out; }
  char tmp[66]; int n = 0;
  do { int d = (int)(v % (unsigned)radix); tmp[n++] = (char)(d < 10 ? '0' + d : 'a' + d - 10); v /= (unsigned)radix; } while (v);
  int k = 0; if (neg) out[k++] = '-';
  while (n) out[k++] = tmp[--n];
  out[k] = 0; return out;
}
extern "C" {
char *itoa(int v, char *s, int r) { return (v < 0 && r == 10) ? conv((unsigned long long)(-(long long)v), true, s, r) : conv((unsigned)v, false, s, r); }
char *ltoa(long v, char *s, int r) { return (v < 0 && r == 10) ? conv((unsigned long long)(-(long long)v), true, s, r) : conv((unsigned long)v, false, s, r); }
char *utoa(unsigned v, char *s, int r) { return conv(v, false, s, r); }
char *ultoa(unsigned long v, char *s, int r) { return conv(v, false, s, r); }
char *dtostrf(double val, signed char width, unsigned char prec, char *sout) { snprintf(sout, 64, "%*.*f", (int)width, (int)prec, val); return sout; }
}
