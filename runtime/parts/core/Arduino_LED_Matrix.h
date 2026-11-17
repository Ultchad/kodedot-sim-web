// Arduino_LED_Matrix for dotcore (Uno R4 WiFi): the 12 x 8 matrix is part state. The 96 pixels are three 32 bit words in outputs 0..2
// (bit 31 of word 0 is the top left LED, row by row), the same packing loadFrame() takes on the real board. Sequences (loadSequence/play)
// and ArduinoGraphics text are not implemented.
#pragma once
#include "Arduino.h"
#include "dotbench_abi.h"

class ArduinoLEDMatrix {
public:
  void begin() { clear(); }
  void end() {}
  void clear() { w_[0] = w_[1] = w_[2] = 0; push(); }
  void loadFrame(const uint32_t f[3]) { w_[0] = f[0]; w_[1] = f[1]; w_[2] = f[2]; push(); }
  void renderBitmap(const uint8_t bmp[8][12], uint8_t rows = 8, uint8_t cols = 12) {
    w_[0] = w_[1] = w_[2] = 0;
    for (uint8_t r = 0; r < rows && r < 8; r++) for (uint8_t c = 0; c < cols && c < 12; c++) if (bmp[r][c]) { int i = r * 12 + c; w_[i / 32] |= 0x80000000UL >> (i % 32); }
    push();
  }
  void renderBitmap(const uint8_t *flat, uint8_t rows, uint8_t cols) { renderBitmap((const uint8_t (*)[12])flat, rows, cols); }
  void setPixel(uint8_t x, uint8_t y, bool on) { if (x >= 12 || y >= 8) return; int i = y * 12 + x; if (on) w_[i / 32] |= 0x80000000UL >> (i % 32); else w_[i / 32] &= ~(0x80000000UL >> (i % 32)); push(); }
private:
  void push() { for (int i = 0; i < 3; i++) dp_output_f64(i, (double)w_[i]); }
  uint32_t w_[3] = {0, 0, 0};
};
