// Compile-only check of the ESP32-flavoured calls a first version must accept.
#include <Wire.h>
const int LED_PIN = 4, POT_PIN = 32;
void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  ledcAttach(LED_PIN, 5000, 10);        // arduino-esp32 3.x
  Wire.begin(21, 22, 400000);           // master on SDA=21 SCL=22
}
void loop() {
  int v = analogRead(POT_PIN);
  ledcWrite(LED_PIN, map(v, 0, 4095, 0, 1023));
  Wire.beginTransmission(0x48); Wire.write(0x00); Wire.endTransmission(false);
  if (Wire.requestFrom(0x48, 2) == 2) { int hi = Wire.read(), lo = Wire.read(); Serial.printf("t=%d\n", (hi << 8) | lo); }
  delay(100);
}
