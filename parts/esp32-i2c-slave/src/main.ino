// An I2C slave the Kode Dot can read with kode_i2c_write_read(addr, &reg, 1, buf, n).
// Registers: 0 ID (0xA5), 1 uptime seconds, 2..3 "value" field (big endian), 4 LED (read/write).
#include <Wire.h>
#include <dotbench.h>
#include "dotbench_fields.h"

static const int LED_PIN = 2;
static uint8_t reg = 0, led = 0;
static uint32_t reads = 0;

void onReceive(int n) {
  reg = Wire.read();                          // the first byte selects the register
  while (Wire.available()) {
    uint8_t v = Wire.read();
    if (reg == 4) { led = v ? 1 : 0; digitalWrite(LED_PIN, led ? HIGH : LOW); }
    reg++;
  }
}

void onRequest() {
  uint16_t value = (uint16_t)dotbenchField(FIELD_VALUE);
  uint8_t image[5] = { 0xA5, (uint8_t)(millis() / 1000), (uint8_t)(value >> 8), (uint8_t)(value & 0xFF), led };
  for (uint8_t i = reg; i < sizeof image; i++) Wire.write(image[i]);   // a long read runs on into the next registers
  dotbenchOutput(OUTPUT_READS, (double)++reads);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Wire.onReceive(onReceive);
  Wire.onRequest(onRequest);
  Wire.begin((uint8_t)dotbenchField(FIELD_ADDRESS), SDA, SCL, 100000);
  Serial.printf("I2C slave ready at 0x%02X\n", (unsigned)dotbenchField(FIELD_ADDRESS));
}

void loop() { delay(10); }
