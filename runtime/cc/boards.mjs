// SPDX-License-Identifier: GPL-3.0-or-later
// What the page can say about each board, as DATA (the asset build puts it in manifest.json; the page reads it with createCompiler().info()).
// Pins, memory, ADC/PWM widths and the radio/serial flags are NOT written here: the asset build derives them from the board's own variant header
// (runtime/parts/core/variants/<core>/pins_arduino.h), the single source of truth the real compile also uses. This file only holds what a header
// cannot say: which part package the board comes from, and what the sketch compiler does and does not support.

/** board id (= dotcore variant) -> the part in parts/ whose manifest, picture and default sketch the board uses */
export const BOARDS = {
  "esp32":         { partDir: "esp32-blink-echo",   family: "esp32" },
  "esp32-s3":      { partDir: "esp32-s3-devkitc",   family: "esp32" },
  "uno-r3":        { partDir: "uno-r3",             family: "avr-like" },
  "uno-r4-minima": { partDir: "uno-r4-minima",      family: "arm-uno" },
  "uno-r4-wifi":   { partDir: "uno-r4-wifi",        family: "arm-uno" },
};

/** What works on every board. `id` is stable (the page can key translations on it). */
export const SUPPORTED = [
  { id: "arduino-api", text: "The Arduino language and API: pinMode, digitalRead/Write, analogRead/Write, millis, micros, delay, tone, random, map, constrain, attachInterrupt, Serial, String, Print/Stream." },
  { id: "cpp17", text: "C++17 with the libc++ standard library (std::vector, std::string, std::map, std::function, lambdas, <algorithm>, <cmath>), printf/puts to the serial monitor." },
  { id: "multi-file", text: "Several .ino files, .h/.cpp/.c files next to the sketch, and libraries as folders (libraries/Name/src/*.cpp)." },
  { id: "wire-spi", text: "Wire (I2C master, and slave through the bench), SPI, EEPROM, Servo, Stepper (header-only copies bundled with the bench)." },
];
/** What does not work anywhere, and why (shown to the user before they hit it). */
export const UNSUPPORTED = [
  { id: "chip-registers", text: "No chip is emulated: direct register access (PORTB, DDRB, TCCR1A, ADCSRA, SREG), avr/io.h, avr/interrupt.h and ISR(...) vectors do not exist. Use the Arduino API." },
  { id: "exceptions-rtti", text: "C++ exceptions and RTTI are off (as on most Arduino cores): no try/catch/throw, typeid or dynamic_cast." },
  { id: "threads", text: "No threads: std::thread, std::mutex waits that block and FreeRTOS tasks (xTaskCreate, queues) are not available." },
  { id: "esp-idf", text: "No ESP-IDF headers (esp_*.h, driver/*.h, freertos/*.h) and no Bluetooth." },
  { id: "timing", text: "Time is the bench's clock in milliseconds. The cycle cost of instructions is not modelled, and a loop that never calls delay, millis or any I/O is reported as busy." },
  { id: "network", text: "WiFi classes exist as stubs that report 'not connected'; no network traffic leaves the bench." },
];
/** per family, the semantics a sketch written for the real chip may trip over */
export const FAMILY_NOTES = {
  "esp32": [{ id: "esp32-api", text: "ESP32 Arduino extras are partly present (ledc*, dacWrite, Preferences, analogSetAttenuation, esp_random, esp_timer_get_time); the rest of the ESP32 API is not." }],
  "avr-like": [
    { id: "wasm32-int", text: "The sketch runs as WebAssembly (wasm32): int and unsigned are 32 bits here, 16 bits on a real Uno, so code that relies on 16-bit wraparound behaves differently." },
    { id: "no-ram-limit", text: "The 2 KB RAM and 32 KB flash limits of the real chip are not enforced; the part has its own memory (limits.memoryKb)." },
    { id: "avr-headers", text: "PROGMEM data is ordinary data, pgm_read_* are plain loads, F() works; no avr/io.h, no ISR(), no direct port access." },
  ],
  "arm-uno": [
    { id: "wasm32-uno-r4", text: "The sketch runs as WebAssembly (wasm32). The R4's RA4M1 registers, DAC/ADC calibration and its FSP HAL do not exist; analogReadResolution and analogWrite on A0 (DAC) are modelled." },
  ],
};
