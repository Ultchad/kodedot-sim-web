/*
  Blink  (the classic example from the Arduino IDE, only LED_BUILTIN pin comes from pins_arduino.h)
*/
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  delay(1000);
}
