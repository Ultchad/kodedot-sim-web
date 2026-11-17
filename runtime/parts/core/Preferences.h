// Preferences for dotcore (arduino-esp32 surface, the common calls). Kept in memory for one power-on of the part.
#pragma once
#include "Arduino.h"
#include <string.h>

class Preferences {
public:
  bool begin(const char *name, bool readOnly = false, const char *partition = nullptr);
  void end();
  bool clear();
  bool remove(const char *key);
  bool isKey(const char *key);
  size_t putBytes(const char *key, const void *value, size_t len);
  size_t getBytes(const char *key, void *buf, size_t maxLen);
  size_t getBytesLength(const char *key);
  size_t putString(const char *key, const char *value);
  size_t putString(const char *key, String value) { return putString(key, value.c_str()); }
  String getString(const char *key, String defaultValue = String());
#define DP_PREF(N, T) size_t put##N(const char *k, T v) { return putBytes(k, &v, sizeof v); } \
  T get##N(const char *k, T def = 0) { T v; return getBytes(k, &v, sizeof v) == sizeof v ? v : def; }
  DP_PREF(UChar, uint8_t) DP_PREF(Char, int8_t) DP_PREF(UShort, uint16_t) DP_PREF(Short, int16_t) DP_PREF(UInt, uint32_t) DP_PREF(Int, int32_t)
  DP_PREF(ULong, uint32_t) DP_PREF(Long, int32_t) DP_PREF(ULong64, uint64_t) DP_PREF(Long64, int64_t) DP_PREF(Float, float) DP_PREF(Double, double) DP_PREF(Bool, bool)
#undef DP_PREF
private:
  bool open_ = false;
};
