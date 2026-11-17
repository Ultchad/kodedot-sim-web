// Servo for dotcore: the Arduino Servo library API over the bench model. A servo is a 50 Hz PWM on the pin with a 544..2400 us pulse
// by default (the library's MIN_PULSE_WIDTH / MAX_PULSE_WIDTH), so write(0..180) lands where the real library would put the pulse.
#pragma once
#include "Arduino.h"
#define MIN_PULSE_WIDTH 544
#define MAX_PULSE_WIDTH 2400
#define DEFAULT_PULSE_WIDTH 1500
#define REFRESH_INTERVAL 20000

class Servo {
public:
  uint8_t attach(int pin) { return attach(pin, MIN_PULSE_WIDTH, MAX_PULSE_WIDTH); }
  uint8_t attach(int pin, int minUs, int maxUs) {
    pin_ = pin; min_ = minUs; max_ = maxUs; us_ = 0;
    pinMode(pin, OUTPUT);
    return 1;                      // the library returns the servo index; 0 would mean "no free channel"
  }
  uint8_t attach(int pin, int minUs, int maxUs, int, int) { return attach(pin, minUs, maxUs); }
  void detach() { if (pin_ >= 0) { dp_pwm(pin_, 0, 0); dp_pin_write(pin_, 0); } pin_ = -1; }
  void write(int v) {
    if (v < MIN_PULSE_WIDTH) { if (v < 0) v = 0; if (v > 180) v = 180; v = map(v, 0, 180, min_, max_); }   // like the library: small numbers are degrees, big ones microseconds
    writeMicroseconds(v);
  }
  void writeMicroseconds(int us) {
    if (pin_ < 0) return;
    if (us < min_) us = min_; if (us > max_) us = max_;
    us_ = us; dp_pwm(pin_, 50, (uint32_t)((uint64_t)us * 65536ULL / REFRESH_INTERVAL));
  }
  int read() { return map(us_, min_, max_, 0, 180); }
  int readMicroseconds() { return us_; }
  bool attached() { return pin_ >= 0; }
private:
  int pin_ = -1, min_ = MIN_PULSE_WIDTH, max_ = MAX_PULSE_WIDTH, us_ = 0;
};
