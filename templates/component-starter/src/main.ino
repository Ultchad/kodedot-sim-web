// LM75-style temperature sensor, running as real Arduino code (ESP32 flavour).
//
// Registers (like the LM75): 0 = temperature, 2 bytes, 1/256 degree per count, big endian;
//                            1 = configuration, 1 byte, read/write (stored, no other effect).
// The temperature comes from the "temperature" field of manifest.json, so you can change it
// while the part runs. The Kode Dot reads it with kode_i2c_write_read(addr, &reg, 1, buf, 2).
#include <Wire.h>
#include <dotbench.h>
#include "dotbench_fields.h"        // generated from manifest.json by `dotbench part build`

static const int LED_PIN = 2;       // on-board LED: no terminal, shown by the "act_led" visual

static uint8_t regPtr = 0;
static uint8_t configReg = 0;
static uint32_t reads = 0;

void onReceive(int n) {
  regPtr = Wire.read();                        // first byte selects the register
  while (Wire.available()) {
    uint8_t v = Wire.read();
    if (regPtr == 1) configReg = v;            // only the config register is writable
  }
}

void onRequest() {
  reads++;
  if (regPtr == 0) {
    int16_t raw = (int16_t)(dotbenchField(FIELD_TEMPERATURE) * 256.0);
    Wire.write((uint8_t)(raw >> 8));
    Wire.write((uint8_t)(raw & 0xFF));
  } else {
    Wire.write(configReg);
  }
  digitalWrite(LED_PIN, (reads & 1) ? HIGH : LOW);   // blink once per read
  dotbenchOutput(OUTPUT_READS, reads);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Wire.onReceive(onReceive);
  Wire.onRequest(onRequest);
  Wire.begin((uint8_t)dotbenchField(FIELD_ADDRESS), SDA, SCL, 100000);
  Serial.printf("LM75 sensor ready at 0x%02X, %.2f C\n", (unsigned)dotbenchField(FIELD_ADDRESS),
                dotbenchField(FIELD_TEMPERATURE));
}

void loop() {
  delay(10);   // all the work happens in the I2C callbacks
}
