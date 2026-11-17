// dotcore variant "esp32": the virtual ESP32 DevKit-style MCU. Arduino pin number == GPIO number, as in arduino-esp32.
#pragma once
#include <stdint.h>
#define DP_BOARD_NAME "ESP32"
#define DP_ESP_API 1            /* ledc*, dacWrite, ESP, Preferences, esp_random */
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
static const uint8_t A6 = 34;
static const uint8_t A7 = 35;
static const uint8_t DAC1 = 25;
static const uint8_t DAC2 = 26;
#define digitalPinToInterrupt(p) (p)
