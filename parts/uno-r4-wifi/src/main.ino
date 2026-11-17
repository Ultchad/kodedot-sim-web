// Default sketch of Arduino Uno R4 WiFi: blink the on-board LED (D13 / LED_BUILTIN) and print a line per toggle on the serial monitor.
// This board does not emulate its chip: the sketch is compiled to WebAssembly against ArduinoCore-API + dotcore for "uno-r4-wifi".
#include <dotbench.h>
#include "dotbench_fields.h"        // FIELD_BLINK_MS, OUTPUT_MATRIX0.. (generated from manifest.json)
#include <Arduino_LED_Matrix.h>
ArduinoLEDMatrix matrix;
static const uint32_t HEART[3] = { 0x3184a444, 0x44042081, 0x100a0040 };

static uint32_t last = 0; static bool on = false;

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
  matrix.begin();
  Serial.println("Arduino Uno R4 WiFi: blinking LED_BUILTIN");
}

void loop() {
  uint32_t half = (uint32_t)dotbenchField(FIELD_BLINK_MS);
  if (millis() - last >= half) {
    last = millis(); on = !on;
    digitalWrite(LED_BUILTIN, on ? HIGH : LOW);
    if (on) matrix.loadFrame(HEART); else matrix.clear();
    Serial.println(on ? "LED on" : "LED off");
  }
  delay(1);
}
