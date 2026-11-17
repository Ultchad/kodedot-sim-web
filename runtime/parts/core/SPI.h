// SPI for dotcore: master only (a part acting as SPI controller). Mirrors arduino-esp32's SPIClass surface.
#pragma once
#include "Arduino.h"

class SPIClass : public HardwareSPI {
public:
  explicit SPIClass(uint8_t port = 0) : port_(port) {}
  void begin() override { begin(-1, -1, -1, -1); }
  void begin(int sck, int miso = -1, int mosi = -1, int ss = -1);
  void end() override { open_ = false; }
  void setFrequency(uint32_t hz) { hz_ = hz; }
  void setDataMode(uint8_t m) { mode_ = m; }
  void setBitOrder(uint8_t o) { msb_ = o == MSBFIRST; }
  void beginTransaction(SPISettings s) override;
  void endTransaction(void) override {}
  uint8_t transfer(uint8_t d) override;
  uint16_t transfer16(uint16_t d) override;
  void transfer(void *buf, size_t n) override;
  void transferBytes(const uint8_t *out, uint8_t *in, uint32_t n);
  void usingInterrupt(int) override {}
  void notUsingInterrupt(int) override {}
  void attachInterrupt() override {}
  void detachInterrupt() override {}
private:
  uint8_t port_; bool open_ = false, msb_ = true; uint32_t hz_ = 1000000; int mode_ = 0, sck_ = -1, miso_ = -1, mosi_ = -1, ss_ = -1;
};
extern SPIClass SPI;
