// Stepper for dotcore: the Arduino Stepper library (2, 4 wire), same sequences and timing, over the bench. step() blocks like the real one;
// the wait is delayMicroseconds(), so it costs virtual time, not a spinning loop.
#pragma once
#include "Arduino.h"

class Stepper {
public:
  Stepper(int steps, int p1, int p2) : steps_(steps), p_{p1, p2, 0, 0}, wires_(2) { init(); }
  Stepper(int steps, int p1, int p2, int p3, int p4) : steps_(steps), p_{p1, p2, p3, p4}, wires_(4) { init(); }
  void setSpeed(long rpm) { delay_ = rpm > 0 ? 60L * 1000L * 1000L / steps_ / rpm : 0; }
  void step(int n) {
    int left = n < 0 ? -n : n; dir_ = n > 0;
    while (left > 0) {
      unsigned long now = micros();
      if (now - last_ >= (unsigned long)delay_) {
        last_ = now;
        pos_ += dir_ ? 1 : -1;
        if (dir_) { if (pos_ == steps_) pos_ = 0; } else if (pos_ == 0) pos_ = steps_;
        left--;
        stepMotor(pos_ % (wires_ == 2 ? 4 : 4));
      } else delayMicroseconds((unsigned int)(delay_ - (now - last_)));
    }
  }
  int version() { return 5; }
private:
  void init() {
    for (int i = 0; i < wires_; i++) pinMode(p_[i], OUTPUT);
    delay_ = 0; last_ = micros();
  }
  void stepMotor(int s) {
    if (wires_ == 2) {
      static const uint8_t t[4][2] = {{0, 1}, {1, 1}, {1, 0}, {0, 0}};
      for (int i = 0; i < 2; i++) digitalWrite(p_[i], t[s][i] ? HIGH : LOW);
    } else {
      static const uint8_t t[4][4] = {{1, 0, 1, 0}, {0, 1, 1, 0}, {0, 1, 0, 1}, {1, 0, 0, 1}};
      for (int i = 0; i < 4; i++) digitalWrite(p_[i], t[s][i] ? HIGH : LOW);
    }
  }
  int steps_, p_[4], wires_, pos_ = 0; bool dir_ = true; unsigned long delay_ = 0, last_ = 0;
};
