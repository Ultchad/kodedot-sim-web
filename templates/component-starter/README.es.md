# Carpeta inicial de pieza de dotbench

Crea tu propio componente ("pieza") para el banco de dotbench, conéctalo al conector de expansión del Kode Dot y míralo funcionar. Una pieza puede ser **sin código** (un botón, un potenciómetro, un sensor I2C con registros fijos) o **código Arduino real** (un ESP32 que se comporta como un sensor, un controlador de pantalla, cualquier cosa que puedas escribir en un `.ino`).

Otros idiomas: [English](README.md), [Português (Brasil)](README.pt-BR.md). ¿Prefieres que lo haga una IA? Usa [PROMPT.es.md](PROMPT.es.md).

## Qué hay en esta carpeta

| Archivo | Qué es |
|---|---|
| `manifest.json` | La descripción de la pieza: nombre, pines y dónde están en la imagen, campos editables, comportamiento. Esta plantilla es un ESP32 que actúa como sensor de temperatura LM75. |
| `manifest.schema.json` | El JSON Schema que `manifest.json` debe cumplir (tu editor puede usarlo para dar sugerencias). |
| `picture.svg` | La imagen de la pieza. Cámbiala por la tuya (PNG, WebP o SVG, hasta 1 MB). |
| `src/main.ino` | El sketch de Arduino, código real. |
| `tests/sensor.test.json` | Un escenario que prueba la pieza (texto de arranque, lectura de un registro I2C, cambio de un campo, un NACK). |
| `examples/` | Dos piezas **sin código** terminadas para copiar: un módulo LM75 y un pulsador. |
| `libraries/` | Pon aquí las bibliotecas de Arduino (copia la carpeta de la biblioteca). |
| `PROMPT.md` (+ `.pt-BR`, `.es`) | Un prompt listo para un asistente de código con IA. |

Necesitas la herramienta de línea de comandos `dotbench` (la misma que compila apps del Kode Dot para el banco; `dotbench part --help` lista los comandos de pieza). Las piezas sin código no necesitan nada más.

## Paso a paso, a mano

1. **Copia esta carpeta** (`dotbench part new mi-sensor` lo hace) y ábrela en un editor.
2. **Dale una identidad a la pieza** en `manifest.json`: un `id` único (por ejemplo `com.tunombre.mi-sensor`, minúsculas, con puntos), `name` y `description` en inglés, portugués y español, tu `author`, una `license` (un id SPDX como `MIT`) y la `version`.
3. **Dibuja la imagen.** Abre `picture.svg` en el navegador o haz un PNG. `picture.width` y `picture.height` en el manifiesto son el tamaño del dibujo en píxeles. Toda posición del manifiesto (`pos`, `region`, `visuals`) usa esa caja de píxeles, con (0,0) arriba a la izquierda.
4. **Lista los pines.** Una entrada por cada lugar donde se puede conectar un cable:
   - `power_in` para la alimentación (indica `min_mv` y `max_mv`, por ejemplo 3000 y 3600), `ground` para GND, `io` para una señal, `analog` para una señal analógica.
   - `pos` es el centro del pad en tu imagen. Abre la imagen y lee las coordenadas.
   - Para código Arduino, `gpio` es el número de pin que usa tu sketch (en esta plantilla `SDA` es 21 y `SCL` es 22).
   - Una pieza está **apagada hasta que su pin de alimentación esté en un riel y su pin de tierra esté conectado a GND**. La app del Kode Dot debe encender el riel primero (`kode_pin_power_3v3(true)`).
5. **Añade campos** para todo lo que quieras cambiar mientras funciona: un control de temperatura, una dirección, un interruptor. Cada uno tiene un `name` (minúsculas), una etiqueta en tres idiomas, un `default` y límites.
6. **Elige el comportamiento.**
   - **Sin código**: copia `examples/lm75-declarative.manifest.json` o `examples/button-module.manifest.json` y cámbialo. Elementos disponibles: `switch`, `bridge`, `divider`, `source`, `drive`, `i2c_slave`, `h_bridge`, `servo`, `wireless`. Los valores vienen de tus campos.
   - **Código Arduino**: edita `src/main.ino`. Lee un campo con `dotbenchField(FIELD_TEMPERATURE)` y publica un valor en la imagen con `dotbenchOutput(OUTPUT_READS, n)`. La cabecera `dotbench_fields.h` se genera a partir del manifiesto al compilar.
7. **Haz que la imagen reaccione** con `visuals` (un LED que brilla, un texto con un número) y deja que la gente interactúe con `controls` (un botón que se puede pulsar en la imagen).
8. **Comprueba y prueba.**
   ```
   dotbench part check .     # manifiesto, imagen, referencias de pines y campos, traducciones
   dotbench part test .      # compila tu código y ejecuta tests/*.test.json
   ```
   Edita `tests/sensor.test.json` para que coincida con tu pieza. Pasos: `advance_ms`, `set_field`, `expect_serial`, `i2c`, `expect_output`.
9. **Genera el archivo de la pieza:** `dotbench part build .` produce `<id>-<version>.dotpart`.
10. **Pruébalo en el navegador.** Abre dotbench, pestaña **Crea la tuya**, suelta el `.dotpart` en **Comprobar mi pieza**, lee lo que dice el diálogo de importación (qué ejecuta, qué pines, qué no puede hacer) e impórtala. Añádela al banco, conecta `3V3` y `GND`, luego los pines de señal al conector (`EXP1` a `EXP14`), y ejecuta tu app del Kode Dot.

## Conviene saber

- **Qué hace el Kode Dot en el conector:** entrada y salida digital, PWM de salida (1 a 40000 Hz), lectura analógica en `EXP8` a `EXP12` y `EXP14`, I2C **maestro**, SPI **maestro**, UART 8N1. No puede ser esclavo de I2C ni de SPI, así que tu pieza es el esclavo.
- **Reglas de Arduino:** escribe un sketch normal. Para un esclavo I2C usa `Wire.begin((uint8_t)direccion, SDA, SCL, 100000)` (con el cast). Soportado: GPIO, interrupciones, `analogRead`, PWM (`analogWrite`, `ledc*`), `millis/delay`, `Serial` (se ve en la consola de la pieza), `Serial1/2`, `Wire`. No soportado: tareas FreeRTOS, WiFi, Bluetooth, SD, NeoPixel y otras bibliotecas con temporización de bits. SPI y `Preferences` están planeados.
- **El tiempo es virtual.** `delay()` y `millis()` siguen el reloj del banco, así que pausar o avanzar paso a paso el banco pausa tu sketch.
- **Bibliotecas:** copia la carpeta de la biblioteca en `libraries/`. Las bibliotecas que tocan registros AVR no funcionan.
- **Límites de la simulación:** las señales son niveles DC y transacciones de bus. El PWM es frecuencia y ciclo de trabajo, no flancos. Los protocolos por bit-banging, el estiramiento del reloj I2C y la corriente no se simulan.
- **Licencia:** la pieza es tuya; elige la `license` con honestidad y conserva las licencias de las bibliotecas que copies.
- **Nada sale de tu navegador.** Una pieza no puede usar la red.

## Si algo sale mal

| Mensaje o síntoma | Causa probable |
|---|---|
| la pieza se queda oscura | riel no encendido por la app, `power_in` sin cable, o `ground` sin conexión a GND |
| el sondeo I2C no encuentra nada | SDA y SCL intercambiados o en redes distintas a las del `kode_i2c_begin` de la app; dirección incorrecta; la pieza está apagada |
| "dos salidas en la misma red" / cable rojo | dos salidas conectadas entre sí, o una salida en un riel |
| "5 V en un pin de 3,3 V" | un riel de 5 V o una pieza de 5 V alimentando un pin de 3,3 V |
| `check` dice que una posición está fuera de la imagen | `pos` o una región supera `picture.width/height` |
| `test` dice "undeclared identifier" para una función | añade un prototipo antes del primer uso |
| insignia "falló" en la pieza | tu código se detuvo (sin memoria, puntero inválido); se reinicia hasta 3 veces |
| insignia "bucle ocupado" | `loop()` nunca llama a `delay()` ni a nada que bloquee |
