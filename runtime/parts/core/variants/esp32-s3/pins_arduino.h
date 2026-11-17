// dotcore variant "esp32-s3": ESP32-S3-DevKitC-1. Arduino pin number == GPIO number (arduino-esp32 3.x); the on-board RGB LED is GPIO48.
#pragma once
#include <stdint.h>
#define DP_BOARD_NAME "ESP32-S3"
#define DP_ESP_API 1
#define DP_HAS_SERIAL1 1
#define DP_HAS_WIFI 1
#define DP_ADC_BITS 12
#define DP_ADC_VREF_MV 3300
#define DP_ADC_SETTABLE 1
#define DP_PWM_BITS 8
#define DP_PWM_ANY 1
#define DP_PWM_HZ_FOR(p) 1000
#define DP_EEPROM_SIZE 4096
#define DP_LOGIC_MV 3300
#define DP_S3 1
static const uint8_t LED_BUILTIN = 48;
#define BUILTIN_LED LED_BUILTIN
#define RGB_BUILTIN LED_BUILTIN
static const uint8_t TX = 43;
static const uint8_t RX = 44;
static const uint8_t SDA = 8;
static const uint8_t SCL = 9;
static const uint8_t SS = 10;
static const uint8_t MOSI = 11;
static const uint8_t SCK = 12;
static const uint8_t MISO = 13;
static const uint8_t A0 = 1, A1 = 2, A2 = 3, A3 = 4, A4 = 5, A5 = 6, A6 = 7, A7 = 8, A8 = 9, A9 = 10, A10 = 11, A11 = 12, A12 = 13, A13 = 14, A14 = 15, A15 = 16, A16 = 17, A17 = 18, A18 = 19, A19 = 20;
#define digitalPinToInterrupt(p) (p)
// The on-board RGB LED (arduino-esp32 neopixelWrite / rgbLedWrite). The part's outputs 0, 1, 2 are rgb_r, rgb_g, rgb_b (0 to 255), so a model shows the colour;
// the pin itself is also driven (any colour on = high) so the part's single LED visual keeps working.
void dotbenchOutput(int outputIndex, double v);
static inline void neopixelWrite(uint8_t pin, uint8_t r, uint8_t g, uint8_t b) {
  dotbenchOutput(0, r); dotbenchOutput(1, g); dotbenchOutput(2, b);
  pinMode(pin, OUTPUT); digitalWrite(pin, (r | g | b) ? HIGH : LOW);
}
static inline void rgbLedWrite(uint8_t pin, uint8_t r, uint8_t g, uint8_t b) { neopixelWrite(pin, r, g, b); }
