// dotcore variant "uno-r3": Arduino Uno form factor. Pin numbers as on the board: D0..D13 are 0..13, A0..A5 are 14..19.
#pragma once
#include <stdint.h>
#define DP_BOARD_NAME "Arduino Uno R3"
#define DP_AVR_LIKE 1
#define DP_ADC_BITS 10
#define DP_ADC_VREF_MV 5000
#define DP_PWM_BITS 8
#define DP_IS_PWM(p) ((p) == 3 || (p) == 5 || (p) == 6 || (p) == 9 || (p) == 10 || (p) == 11)
#define DP_PWM_HZ_FOR(p) (((p) == 5 || (p) == 6) ? 980 : 490)
#define DP_EEPROM_SIZE 1024
#define DP_LOGIC_MV 5000
#define DP_SERIAL0_PINS 1            /* Serial is the USB console and also drives D0 (RX) and D1 (TX) */
#define DP_ANALOG_PIN(p) (((p) >= 0 && (p) < 6) ? (p) + 14 : (p))
#define NOT_AN_INTERRUPT (-1)
#define digitalPinToInterrupt(p) (((p) == 2 || (p) == 3) ? (p) : NOT_AN_INTERRUPT)
static const uint8_t LED_BUILTIN = 13;
#define BUILTIN_LED LED_BUILTIN
#define PIN_LED LED_BUILTIN
static const uint8_t A0 = 14, A1 = 15, A2 = 16, A3 = 17, A4 = 18, A5 = 19;
static const uint8_t SDA = 18;
static const uint8_t SCL = 19;
static const uint8_t SS = 10;
static const uint8_t MOSI = 11;
static const uint8_t MISO = 12;
static const uint8_t SCK = 13;
static const uint8_t TX = 1;
static const uint8_t RX = 0;
