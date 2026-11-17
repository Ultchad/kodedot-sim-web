// Button on IO4 (to GND, internal pull-up) toggles the LED on IO5 and the on-board LED (GPIO2).
// The press is noticed by a falling-edge interrupt; loop() debounces and acts.
#include <dotbench.h>
#include "dotbench_fields.h"        // OUTPUT_PRESSES

static const int BUTTON = 4, LED_EXT = 5, LED_BOARD = 2;
static volatile bool pending = false;
static bool ledOn = false;
static uint32_t presses = 0;

void IRAM_ATTR onFall() { pending = true; }

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED_EXT, OUTPUT);
  pinMode(LED_BOARD, OUTPUT);
  attachInterrupt(digitalPinToInterrupt(BUTTON), onFall, FALLING);
  Serial.println("button on IO4, LED on IO5");
}

void loop() {
  if (pending) {
    pending = false;
    delay(20);                                   // debounce
    if (digitalRead(BUTTON) == LOW) {
      ledOn = !ledOn;
      digitalWrite(LED_EXT, ledOn ? HIGH : LOW);
      digitalWrite(LED_BOARD, ledOn ? HIGH : LOW);
      dotbenchOutput(OUTPUT_PRESSES, (double)++presses);
      Serial.printf("press %u: LED %s\n", (unsigned)presses, ledOn ? "on" : "off");
    }
  }
  delay(1);
}
