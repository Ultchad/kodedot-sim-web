/** Small sketches to start from, offered in every board's editor. Titles are message keys (i18n). */
export interface Example {
  id: string;
  title: 'code.ex.blink' | 'code.ex.button' | 'code.ex.fade' | 'code.ex.servo' | 'code.ex.serial' | 'code.ex.knob';
  /** Boards (compiler ids) it suits; all when absent. */
  files: { name: string; text: string }[];
}

const ino = (text: string) => [{ name: 'main.ino', text: text.trimStart() }];

export const EXAMPLES: Example[] = [
  {
    id: 'blink',
    title: 'code.ex.blink',
    files: ino(`
// Blink: the board's own LED goes on and off twice a second.
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println("on");
  delay(250);
  digitalWrite(LED_BUILTIN, LOW);
  Serial.println("off");
  delay(250);
}
`),
  },
  {
    id: 'button',
    title: 'code.ex.button',
    files: ino(`
// Button: a push button between pin 2 and GND switches the board's LED.
const int BUTTON = 2;

void setup() {
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, digitalRead(BUTTON) == LOW ? HIGH : LOW);
  delay(10);
}
`),
  },
  {
    id: 'fade',
    title: 'code.ex.fade',
    files: ino(`
// Fade: an LED (with its resistor) on pin 9 gets brighter and dimmer.
const int LED = 9;
int level = 0;
int step = 5;

void setup() {
  pinMode(LED, OUTPUT);
}

void loop() {
  analogWrite(LED, level);
  level += step;
  if (level <= 0 || level >= 255) step = -step;
  delay(30);
}
`),
  },
  {
    id: 'servo',
    title: 'code.ex.servo',
    files: ino(`
// Servo: a servo on pin 9 sweeps from one side to the other and back.
#include <Servo.h>

Servo servo;

void setup() {
  servo.attach(9);
}

void loop() {
  for (int a = 0; a <= 180; a += 5) {
    servo.write(a);
    delay(40);
  }
  for (int a = 180; a >= 0; a -= 5) {
    servo.write(a);
    delay(40);
  }
}
`),
  },
  {
    id: 'knob',
    title: 'code.ex.knob',
    files: ino(`
// Knob: a potentiometer on A0 sets the brightness of an LED on pin 9.
void setup() {
  pinMode(9, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  int v = analogRead(A0);
  analogWrite(9, map(v, 0, 1023, 0, 255));
  Serial.println(v);
  delay(100);
}
`),
  },
  {
    id: 'serial',
    title: 'code.ex.serial',
    files: [
      {
        name: 'main.ino',
        text: `// Serial: what is typed in the monitor comes back in capitals. The helper lives in its own file.
#include "shout.h"

void setup() {
  Serial.begin(115200);
  Serial.println("Type something");
}

void loop() {
  if (Serial.available()) {
    String line = Serial.readStringUntil('\\n');
    Serial.println(shout(line));
  }
  delay(10);
}
`,
      },
      {
        name: 'shout.h',
        text: `#pragma once
#include <Arduino.h>

inline String shout(String s) {
  s.toUpperCase();
  return s;
}
`,
      },
    ],
  },
];
