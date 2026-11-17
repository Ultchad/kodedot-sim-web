#include <Arduino.h>
#include <avr/pgmspace.h>
const char hello[] PROGMEM = "hello";
const int tab[] PROGMEM = {1, 2, 3};
void setup() {
  Serial.begin(9600);
  String s = "x=" + String(42) + " y=" + String(3.14159, 3) + " z=" + String(255, HEX) + " " + String(-7L) + " " + String(12345UL);
  s.toUpperCase(); s.trim(); s.replace("X", "Q");
  Serial.println(s); Serial.println(s.length()); Serial.println(s.indexOf('Y'));
  Serial.println(String("12").toInt() + String("2.5").toFloat());
  char b[32]; ltoa(-123456L, b, 10); Serial.println(b); ultoa(123456UL, b, 16); Serial.println(b); itoa(-42, b, 10); Serial.println(b); utoa(42u, b, 2); Serial.println(b);
  dtostrf(3.14159, 8, 2, b); Serial.println(b);
  randomSeed(42); Serial.println(random(10)); Serial.println(random(5, 10));
  Serial.println(map(50, 0, 100, 0, 255)); Serial.println(constrain(300, 0, 255)); Serial.println(min(3, 4)); Serial.println(max(3, 4)); Serial.println(abs(-5)); Serial.println(sq(3));
  Serial.println(bitRead(5, 0)); uint8_t v = 0; bitSet(v, 3); bitClear(v, 3); bitWrite(v, 1, 1); Serial.println(v); Serial.println(_BV(3)); Serial.println(lowByte(0x1234)); Serial.println(highByte(0x1234));
  Serial.println(F("flash string")); Serial.println(pgm_read_byte(&hello[1])); Serial.println(pgm_read_word(&tab[2]));
  char t[8]; strcpy_P(t, hello); Serial.println(t); Serial.println(strlen_P(hello));
  Serial.println(1.5); Serial.println(2.0f, 3); Serial.println(radians(180.0)); Serial.println(sqrt(2.0)); Serial.println(pow(2, 10));
  Serial.print(255, BIN); Serial.print(" "); Serial.print(255, OCT); Serial.print(" "); Serial.println(0xBEEF, HEX);
  char fb[64]; snprintf(fb, sizeof fb, "%d %5.2f %s", 7, 2.5, "ok"); Serial.println(fb);
  Serial.println(sizeof(int)); Serial.println(sizeof(long));
}
void loop() { delay(10); }
