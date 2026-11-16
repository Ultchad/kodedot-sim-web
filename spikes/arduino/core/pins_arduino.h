// Pin numbers of the virtual ESP32 DevKit-style MCU: Arduino pin number == GPIO number,
// as in arduino-esp32. The manifest maps these numbers to named pins on the picture.
#pragma once
#include <stdint.h>
static const uint8_t LED_BUILTIN = 2;
#define BUILTIN_LED LED_BUILTIN
static const uint8_t SDA = 21;
static const uint8_t SCL = 22;
static const uint8_t SS = 5;
static const uint8_t MOSI = 23;
static const uint8_t MISO = 19;
static const uint8_t SCK = 18;
static const uint8_t TX = 1;
static const uint8_t RX = 3;
static const uint8_t A0 = 36;
static const uint8_t A3 = 39;
static const uint8_t A4 = 32;
static const uint8_t A5 = 33;
#define digitalPinToInterrupt(p) (p)
