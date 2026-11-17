// Blink the on-board LED (GPIO2) and echo UART1 back to the sender: the Kode Dot talks to this part over UART.
#include <dotbench.h>
#include "dotbench_fields.h"        // FIELD_BLINK_MS, OUTPUT_ECHOED (generated from manifest.json)

static const int LED_PIN = 2, RX_PIN = 16, TX_PIN = 17;
static uint32_t lastBlink = 0, echoed = 0;
static bool ledOn = false;

void setup() {
  Serial.begin(115200);                                  // the console pane, not a pin
  pinMode(LED_PIN, OUTPUT);
  Serial1.begin(115200, SERIAL_8N1, RX_PIN, TX_PIN);     // the pins on the header
  Serial1.println("ESP32 ready");
  Serial.println("echoing UART1: RX GPIO16, TX GPIO17, 115200 8N1");
}

void loop() {
  uint32_t half = (uint32_t)dotbenchField(FIELD_BLINK_MS);
  if (millis() - lastBlink >= half) { lastBlink = millis(); ledOn = !ledOn; digitalWrite(LED_PIN, ledOn ? HIGH : LOW); }
  while (Serial1.available()) {
    Serial1.write((uint8_t)Serial1.read());
    dotbenchOutput(OUTPUT_ECHOED, (double)++echoed);
  }
  delay(1);
}
