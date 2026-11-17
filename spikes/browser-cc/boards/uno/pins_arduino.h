// Arduino Uno pin numbers (the numbers the sketch uses; the part's manifest maps each `gpio` number to a named pin on its picture).
#pragma once
#include <stdint.h>
#define NUM_DIGITAL_PINS 20
#define NUM_ANALOG_INPUTS 6
static const uint8_t LED_BUILTIN = 13;
static const uint8_t A0 = 14, A1 = 15, A2 = 16, A3 = 17, A4 = 18, A5 = 19;
static const uint8_t SDA = 18, SCL = 19;            // A4, A5
static const uint8_t SS = 10, MOSI = 11, MISO = 12, SCK = 13;
#define digitalPinToInterrupt(p) (((p) == 2 || (p) == 3) ? (p) : -1)
#define analogInputToDigitalPin(p) ((p) + 14)
