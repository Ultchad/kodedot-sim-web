// Default sketch of Arduino Uno R3: blink the on-board LED (D13 / LED_BUILTIN) and print a line per toggle on the serial monitor.
// This board does not emulate its chip: the sketch is compiled to WebAssembly against ArduinoCore-API + dotcore for "uno-r3".
#include <dotbench.h>
#include "dotbench_fields.h"        // FIELD_BLINK_MS (generated from manifest.json)

static uint32_t last = 0; static bool on = false;

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.println("Arduino Uno R3: blinking LED_BUILTIN");
}

void loop() {
  uint32_t half = (uint32_t)dotbenchField(FIELD_BLINK_MS);
  if (millis() - last >= half) {
    last = millis(); on = !on;
    digitalWrite(LED_BUILTIN, on ? HIGH : LOW);
    Serial.println(on ? "LED on" : "LED off");
  }
  delay(1);
}
