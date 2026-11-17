// avr/pgmspace.h for a flat address space: PROGMEM data is ordinary data, pgm_read_* are plain loads.
#pragma once
#include <stdint.h>
#include <string.h>
#define PROGMEM
#define PSTR(s) (s)
#define PGM_P const char *
#define pgm_read_byte(a) (*(const uint8_t *)(a))
#define pgm_read_word(a) (*(const uint16_t *)(a))
#define pgm_read_dword(a) (*(const uint32_t *)(a))
#define pgm_read_float(a) (*(const float *)(a))
#define pgm_read_ptr(a) (*(void *const *)(a))
#define strcpy_P strcpy
#define strlen_P strlen
#define memcpy_P memcpy
#define strcmp_P strcmp
