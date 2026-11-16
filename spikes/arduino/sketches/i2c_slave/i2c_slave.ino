// I2C register-file slave, ESP32/Arduino style (Wire slave callbacks + Serial.printf).
#include <Wire.h>

#define I2C_DEV_ADDR 0x42

uint8_t regs[8] = {0x10, 0x21, 0x32, 0x43, 0x54, 0x65, 0x76, 0x87};
volatile uint8_t regPtr = 0;
uint32_t requests = 0;

void onReceive(int len) {
  regPtr = Wire.read();                       // first byte selects the register
  Serial.printf("onReceive len=%d reg=%u\n", len, regPtr);
  while (Wire.available()) {                  // further bytes are written to the file
    regs[regPtr & 7] = Wire.read();
    Serial.printf("  write regs[%u]=0x%02X\n", regPtr & 7, regs[regPtr & 7]);
    regPtr++;
  }
}

void onRequest() {
  requests++;
  Serial.printf("onRequest reg=%u (#%lu)\n", regPtr, (unsigned long)requests);
  Wire.write(&regs[regPtr & 7], 4);           // hand back 4 registers from the pointer
}

void setup() {
  Serial.begin(115200);
  Wire.onReceive(onReceive);
  Wire.onRequest(onRequest);
  Wire.begin((uint8_t)I2C_DEV_ADDR);
  Serial.println("i2c slave ready at 0x42");
}

void loop() {
  delay(10);
}
