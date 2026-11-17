// dotcore variant "uno-r4-wifi": Arduino Uno form factor. Pin numbers as on the board: D0..D13 are 0..13, A0..A5 are 14..19.
#pragma once
#include <stdint.h>
#define DP_ARM_UNO 1
#define DP_ADC_BITS 10               /* analogReadResolution() raises it to 12 or 14 */
#define DP_ADC_VREF_MV 5000
#define DP_ADC_SETTABLE 1
#define DP_PWM_BITS 8
#define DP_IS_PWM(p) ((p) == 3 || (p) == 5 || (p) == 6 || (p) == 9 || (p) == 10 || (p) == 11)
#define DP_PWM_HZ_FOR(p) 490
#define DP_IS_DAC(p) ((p) == 14)     /* A0 is the 12 bit DAC: analogWrite(A0, v) */
#define DP_EEPROM_SIZE 8192
#define DP_LOGIC_MV 5000
#define DP_HAS_SERIAL1 1             /* Serial is USB CDC (the console), Serial1 is on D0 (RX) and D1 (TX) */
#define DP_ANALOG_PIN(p) (((p) >= 0 && (p) < 6) ? (p) + 14 : (p))
#define digitalPinToInterrupt(p) (p)
#define DP_BOARD_NAME "Arduino Uno R4 WiFi"
#define DP_HAS_WIFI 1
#define DP_HAS_MATRIX 1              /* 12 x 8 LED matrix: Arduino_LED_Matrix.h, state in outputs[0..2] */
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
