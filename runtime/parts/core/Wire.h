// Wire for dotcore: master and slave, mirrors arduino-esp32's TwoWire surface (incl. the
// begin() overloads, so overload resolution matches real code: begin(0x42) is SDA 0x42,
// begin((uint8_t)0x42) is slave address 0x42).
#pragma once
#include "Arduino.h"
#include <string.h>

class TwoWire : public HardwareI2C {
public:
  explicit TwoWire(uint8_t port) : port_(port) {}
  bool begin(int sda = -1, int scl = -1, uint32_t frequency = 0);
  bool begin(uint8_t slaveAddr, int sda, int scl, uint32_t frequency);
  void begin() override { begin(-1, -1, 0); }
  void begin(uint8_t address) override { begin(address, -1, -1, 0); }
  void end() override {}
  void setClock(uint32_t f) override { hz_ = f; }
  uint32_t getClock() { return hz_; }
  bool setPins(int sda, int scl) { sda_ = sda; scl_ = scl; return true; }
  size_t setBufferSize(size_t) { return 128; }
  void setTimeOut(uint16_t) {}

  void beginTransmission(uint8_t address) override { txAddr_ = address; txn_ = 0; }
  void beginTransmission(int address) { beginTransmission((uint8_t)address); }
  uint8_t endTransmission(bool stop) override;
  uint8_t endTransmission(void) override { return endTransmission(true); }
  size_t requestFrom(uint8_t address, size_t len, bool stop) override;
  size_t requestFrom(uint8_t address, size_t len) override { return requestFrom(address, len, true); }
  uint8_t requestFrom(uint8_t a, uint8_t q, uint8_t s) { return (uint8_t)requestFrom(a, (size_t)q, (bool)s); }
  uint8_t requestFrom(int a, int q) { return (uint8_t)requestFrom((uint8_t)a, (size_t)q, true); }
  uint8_t requestFrom(int a, int q, int s) { return (uint8_t)requestFrom((uint8_t)a, (size_t)q, (bool)s); }

  size_t write(uint8_t c) override;
  size_t write(const uint8_t *d, size_t n) override;
  using Print::write;
  // arduino-esp32 adds these so that Wire.write(0x00) is not ambiguous with Print::write(const char*)
  inline size_t write(const char *s) { return write((const uint8_t *)s, strlen(s)); }
  inline size_t write(unsigned long n) { return write((uint8_t)n); }
  inline size_t write(long n) { return write((uint8_t)n); }
  inline size_t write(unsigned int n) { return write((uint8_t)n); }
  inline size_t write(int n) { return write((uint8_t)n); }
  int available(void) override { return rxn_ - rxi_; }
  int read(void) override { return rxi_ < rxn_ ? rx_[rxi_++] : -1; }
  int peek(void) override { return rxi_ < rxn_ ? rx_[rxi_] : -1; }
  void flush(void) override {}
  void onReceive(void (*cb)(int)) override { onRecv_ = cb; }
  void onRequest(void (*cb)(void)) override { onReq_ = cb; }
  size_t slaveWrite(const uint8_t *d, size_t n) { return write(d, n); }   // arduino-esp32 name

  // called by the bench through the dp_i2c_slave_event export
  int slaveEvent(int addr, const uint8_t *w, int wn, uint8_t *r, int rn);
private:
  uint8_t port_, slaveAddr_ = 0; bool isSlave_ = false;
  int sda_ = -1, scl_ = -1; uint32_t hz_ = 100000;
  uint8_t txAddr_ = 0; uint8_t tx_[256]; uint16_t txn_ = 0;          // master write buffer / slave response
  uint8_t rx_[256]; uint16_t rxn_ = 0, rxi_ = 0;                     // master read result / slave received bytes
  bool inRequest_ = false;
  void (*onRecv_)(int) = nullptr; void (*onReq_)(void) = nullptr;
};
extern TwoWire Wire, Wire1;
