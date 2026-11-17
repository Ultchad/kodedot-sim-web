// dotbench "dotcore": Arduino core for the web. API layer = arduino/ArduinoCore-API (LGPL-2.1+),
// HAL = dotcore.cpp over the imports in dotbench_abi.h. ESP32-flavoured where sketches expect it.
#pragma once
#define SPIClass DP_API_SPIClass   // the API typedefs SPIClass to HardwareSPI; ours (SPI.h) is the real class
#include "api/ArduinoAPI.h"
#include "api/HardwareSerial.h"
#include "api/HardwareI2C.h"
#include "api/HardwareSPI.h"
#undef SPIClass
#include <stdio.h>
#include <stdarg.h>
#include "pins_arduino.h"

using namespace arduino;

#define IRAM_ATTR
#define ICACHE_RAM_ATTR
#define DRAM_ATTR
#define RTC_DATA_ATTR
#ifndef PROGMEM
#define PROGMEM
#endif
typedef bool boolean;

// --- analog, as every board's core has them: resolution comes from the board's variant (pins_arduino.h) ---
void analogReadResolution(uint8_t bits);
void analogWriteResolution(uint8_t bits);
void analogWriteFrequency(uint32_t hz);
int64_t esp_timer_get_time(void);
void dotcore_poll(void);          // timed work (tone() durations, LED matrix sequences) the sketch does not call itself: runs at every time call and yield

#if DP_ESP_API
// --- ESP32 Arduino extras (first-version scope: see docs/component-api.md) ---
void analogSetAttenuation(int att);
bool ledcAttach(uint8_t pin, uint32_t freq, uint8_t resolution);          // arduino-esp32 3.x
void ledcWrite(uint8_t pin, uint32_t duty);                               // 3.x: by pin
uint32_t ledcSetup(uint8_t channel, uint32_t freq, uint8_t resolution);   // 2.x
void ledcAttachPin(uint8_t pin, uint8_t channel);                         // 2.x
void ledcWriteChannel(uint8_t channel, uint32_t duty);
void dacWrite(uint8_t pin, uint8_t value);
uint32_t getCpuFrequencyMhz(void);
uint32_t esp_random(void);
#define ADC_11db 3

class EspClass { public: void restart(); uint32_t getFreeHeap(); const char *getChipModel() { return DP_BOARD_NAME; }
  uint32_t getChipRevision() { return 1; } uint32_t getCpuFreqMHz() { return 240; } uint32_t getFlashChipSize() { return 4u << 20; } const char *getSdkVersion() { return "dotbench"; } };
extern EspClass ESP;
#endif

class DPSerial : public HardwareSerial {
public:
  explicit DPSerial(int port) : port_(port) {}
  void begin(unsigned long baud) override { begin(baud, SERIAL_8N1, -1, -1); }
  void begin(unsigned long baud, uint16_t config) override { begin(baud, config, -1, -1); }
  void begin(unsigned long baud, uint32_t config, int8_t rx, int8_t tx);
  void end() override {}
  int available(void) override;
  int peek(void) override;
  int read(void) override;
  void flush(void) override;
  size_t write(uint8_t c) override;
  size_t write(const uint8_t *buf, size_t n) override;
  using Print::write;
  operator bool() override { return true; }
  size_t printf(const char *fmt, ...) __attribute__((format(printf, 2, 3)));
  void setRxBufferSize(size_t) {}
  int availableForWrite() override { return 64; }
  void rxPush(uint8_t b);
private:
  int port_;
  uint8_t tx_[64]; uint8_t txn_ = 0;
  uint8_t rx_[256]; uint16_t rxh_ = 0, rxt_ = 0;
  void flushTx();
};
extern DPSerial Serial;
#if DP_HAS_SERIAL1
extern DPSerial Serial1;
#endif
#if DP_ESP_API
extern DPSerial Serial2;
#endif
void serialEvent() __attribute__((weak));
