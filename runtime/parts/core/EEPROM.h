// EEPROM for dotcore: per part instance, kept by the bench with the layout (survives power off and "Compile and upload"),
// size from the board (Uno R3 1 KB, R4 8 KB, ESP32 4 KB). AVR and R4 write through at once; the ESP32 flavour needs begin(size) and commit() like the real one.
#pragma once
#include "Arduino.h"
#include "dotbench_abi.h"

class EEPROMClass;
struct EERef {
  EERef(EEPROMClass &e, int i) : e_(e), i_(i) {}
  inline operator uint8_t() const; inline EERef &operator=(uint8_t v); inline EERef &operator=(const EERef &r) { return *this = (uint8_t)r; }
  inline EERef &update(uint8_t v); 
  EERef &operator+=(uint8_t v) { return *this = (uint8_t)*this + v; } EERef &operator-=(uint8_t v) { return *this = (uint8_t)*this - v; }
  EERef &operator++() { return *this += 1; } EERef &operator--() { return *this -= 1; }
  EEPROMClass &e_; int i_;
};
class EEPROMClass {
public:
  bool begin(size_t size = DP_EEPROM_SIZE) { n_ = size > DP_EEPROM_SIZE ? DP_EEPROM_SIZE : size; load(); return true; }
  uint8_t read(int i) { load(); return ok(i) ? buf_[i] : 0xFF; }
  void write(int i, uint8_t v) {
    load(); if (!ok(i)) return; buf_[i] = v;
#if !DP_ESP_API
    dp_nvs_set(i, &buf_[i], 1);          // AVR and R4: every write reaches the cells at once
#else
    dirty_ = true;
#endif
  }
  void update(int i, uint8_t v) { if (read(i) != v) write(i, v); }
  bool commit() { load(); if (dirty_) { dp_nvs_set(0, buf_, (int)n_); dirty_ = false; } return true; }
  bool end() { return commit(); }
  size_t length() { return n_; }
  EERef operator[](int i) { return EERef(*this, i); }
  template <typename T> T &get(int i, T &t) { uint8_t *p = (uint8_t *)&t; for (size_t k = 0; k < sizeof(T); k++) p[k] = read(i + (int)k); return t; }
  template <typename T> const T &put(int i, const T &t) { const uint8_t *p = (const uint8_t *)&t; for (size_t k = 0; k < sizeof(T); k++) update(i + (int)k, p[k]); return t; }
  template <typename T> T readAll(int i, T &t) { return get(i, t); }
private:
  bool ok(int i) const { return i >= 0 && (size_t)i < n_; }
  void load() { if (!loaded_) { loaded_ = true; dp_nvs_get(0, buf_, (int)n_); } }
  uint8_t buf_[DP_EEPROM_SIZE]; size_t n_ = DP_EEPROM_SIZE; bool loaded_ = false, dirty_ = false;
};
EERef::operator uint8_t() const { return e_.read(i_); }
EERef &EERef::operator=(uint8_t v) { e_.write(i_, v); return *this; }
EERef &EERef::update(uint8_t v) { e_.update(i_, v); return *this; }
static EEPROMClass EEPROM;
