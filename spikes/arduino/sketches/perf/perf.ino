// CPU-bound probe: pure compute, then 3000 Serial.print calls (virtual calls through Print), timed with micros().
void setup() {
  Serial.begin(115200);
  uint32_t t0 = micros();
  volatile uint32_t acc = 0;
  for (int i = 0; i < 20000000; i++) acc += ((uint32_t)i * 2654435761u) >> 7;
  uint32_t t1 = micros();
  for (int i = 0; i < 3000; i++) { Serial.print(i); Serial.print(' '); if (i % 100 == 99) Serial.println(); }
  uint32_t t2 = micros();
  Serial.printf("PERF compute=%lu us prints=%lu us\n", (unsigned long)(t1 - t0), (unsigned long)(t2 - t1));
}
void loop() { delay(1000); }
