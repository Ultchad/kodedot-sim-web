// <avr/pgmspace.h> for a flat address space (every board of the bench): PROGMEM data is ordinary data, pgm_read_* are plain loads.
// ArduinoCore-API already ships exactly that for non-AVR cores; this forwards a sketch's own #include <avr/pgmspace.h> to it.
#pragma once
#include "api/deprecated-avr-comp/avr/pgmspace.h"
