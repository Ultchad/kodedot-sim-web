/**
 * The compiler's sentences about what a sketch can use (runtime/cc/boards.mjs, English) in Portuguese and Spanish.
 * `of` is the fingerprint of the English sentence each one was written for (sketchData.ts `fingerprint`): when the
 * compiler's sentence changes, the fingerprint no longer matches, the page shows the compiler's English, and
 * sketchData.test.ts fails with the new fingerprint to put here once the sentence was rewritten.
 */
type Texts = Record<string, { of: string; text: string }>;

const ptBR: Texts = {
  'arduino-api': {
    of: 'ce91d14c',
    text: 'A linguagem e a API do Arduino: pinMode, digitalRead/Write, analogRead/Write, millis, micros, delay, tone, random, map, constrain, attachInterrupt, Serial, String, Print/Stream.',
  },
  cpp17: {
    of: '837e804a',
    text: 'C++17 com a biblioteca padrão libc++ (std::vector, std::string, std::map, std::function, lambdas, <algorithm>, <cmath>), e printf/puts saindo no monitor serial.',
  },
  'multi-file': {
    of: '225dd7e4',
    text: 'Vários arquivos .ino, arquivos .h/.cpp/.c ao lado do sketch e bibliotecas em pastas (libraries/Nome/src/*.cpp).',
  },
  'wire-spi': {
    of: 'a801d09c',
    text: 'Wire (I2C como mestre, e como escravo através da bancada), SPI, EEPROM, Servo, Stepper (cópias que já vêm com a bancada).',
  },
  'chip-registers': {
    of: 'c889cdd8',
    text: 'Nenhum chip é emulado: acesso direto a registradores (PORTB, DDRB, TCCR1A, ADCSRA, SREG), avr/io.h, avr/interrupt.h e vetores ISR(...) não existem. Use a API do Arduino.',
  },
  'exceptions-rtti': {
    of: 'f00fb8cc',
    text: 'Exceções e RTTI do C++ ficam desligadas (como na maioria dos cores Arduino): nada de try/catch/throw, typeid ou dynamic_cast.',
  },
  threads: {
    of: '69f9304f',
    text: 'Sem threads: std::thread, esperas de std::mutex que bloqueiam e tarefas do FreeRTOS (xTaskCreate, filas) não estão disponíveis.',
  },
  'esp-idf': {
    of: '81357f72',
    text: 'Sem os cabeçalhos do ESP-IDF (esp_*.h, driver/*.h, freertos/*.h) e sem Bluetooth.',
  },
  timing: {
    of: '94f0967a',
    text: 'O tempo é o relógio da bancada, em milissegundos. O custo de cada instrução em ciclos não é modelado, e um loop que nunca chama delay, millis nem faz entrada ou saída é apontado como ocupado.',
  },
  network: {
    of: '9d97d50d',
    text: 'As classes de WiFi existem só como fachada e respondem "não conectado"; nenhum tráfego de rede sai da bancada.',
  },
  'esp32-api': {
    of: 'cc284b09',
    text: 'Os extras do Arduino para ESP32 existem em parte (ledc*, dacWrite, Preferences, analogSetAttenuation, esp_random, esp_timer_get_time); o resto da API do ESP32, não.',
  },
  'wasm32-int': {
    of: '83e6f708',
    text: 'O sketch roda como WebAssembly (wasm32): int e unsigned têm 32 bits aqui e 16 bits num Uno de verdade, então código que conta com o estouro em 16 bits se comporta diferente.',
  },
  'no-ram-limit': {
    of: '41a30e0e',
    text: 'Os limites de 2 KB de RAM e 32 KB de flash do chip real não são impostos; a peça tem a própria memória (limits.memoryKb).',
  },
  'avr-headers': {
    of: 'd246609d',
    text: 'Dados em PROGMEM são dados comuns, pgm_read_* são leituras simples e F() funciona; não há avr/io.h, ISR() nem acesso direto às portas.',
  },
  'wasm32-uno-r4': {
    of: 'd7e5487d',
    text: 'O sketch roda como WebAssembly (wasm32). Os registradores do RA4M1 do R4, a calibração do DAC e do ADC e a HAL FSP não existem; analogReadResolution e analogWrite em A0 (DAC) são modelados.',
  },
};

const es: Texts = {
  'arduino-api': {
    of: 'ce91d14c',
    text: 'El lenguaje y la API de Arduino: pinMode, digitalRead/Write, analogRead/Write, millis, micros, delay, tone, random, map, constrain, attachInterrupt, Serial, String, Print/Stream.',
  },
  cpp17: {
    of: '837e804a',
    text: 'C++17 con la biblioteca estándar libc++ (std::vector, std::string, std::map, std::function, lambdas, <algorithm>, <cmath>), y printf/puts hacia el monitor serie.',
  },
  'multi-file': {
    of: '225dd7e4',
    text: 'Varios archivos .ino, archivos .h/.cpp/.c junto al sketch y bibliotecas en carpetas (libraries/Nombre/src/*.cpp).',
  },
  'wire-spi': {
    of: 'a801d09c',
    text: 'Wire (I2C como maestro, y como esclavo a través del banco), SPI, EEPROM, Servo, Stepper (copias que ya vienen con el banco).',
  },
  'chip-registers': {
    of: 'c889cdd8',
    text: 'No se emula ningún chip: el acceso directo a registros (PORTB, DDRB, TCCR1A, ADCSRA, SREG), avr/io.h, avr/interrupt.h y los vectores ISR(...) no existen. Usa la API de Arduino.',
  },
  'exceptions-rtti': {
    of: 'f00fb8cc',
    text: 'Las excepciones y el RTTI de C++ están desactivados (como en la mayoría de los cores de Arduino): no hay try/catch/throw, typeid ni dynamic_cast.',
  },
  threads: {
    of: '69f9304f',
    text: 'Sin hilos: std::thread, las esperas de std::mutex que bloquean y las tareas de FreeRTOS (xTaskCreate, colas) no están disponibles.',
  },
  'esp-idf': {
    of: '81357f72',
    text: 'Sin las cabeceras de ESP-IDF (esp_*.h, driver/*.h, freertos/*.h) y sin Bluetooth.',
  },
  timing: {
    of: '94f0967a',
    text: 'El tiempo es el reloj del banco, en milisegundos. No se modela el coste en ciclos de cada instrucción, y un bucle que nunca llama a delay, a millis ni hace entrada o salida se señala como ocupado.',
  },
  network: {
    of: '9d97d50d',
    text: 'Las clases de WiFi existen solo como fachada y responden "no conectado"; ningún tráfico de red sale del banco.',
  },
  'esp32-api': {
    of: 'cc284b09',
    text: 'Los extras de Arduino para ESP32 están en parte (ledc*, dacWrite, Preferences, analogSetAttenuation, esp_random, esp_timer_get_time); el resto de la API del ESP32, no.',
  },
  'wasm32-int': {
    of: '83e6f708',
    text: 'El sketch se ejecuta como WebAssembly (wasm32): int y unsigned tienen 32 bits aquí y 16 bits en un Uno real, así que el código que cuenta con el desbordamiento a 16 bits se comporta distinto.',
  },
  'no-ram-limit': {
    of: '41a30e0e',
    text: 'Los límites de 2 KB de RAM y 32 KB de flash del chip real no se aplican; la pieza tiene su propia memoria (limits.memoryKb).',
  },
  'avr-headers': {
    of: 'd246609d',
    text: 'Los datos en PROGMEM son datos corrientes, pgm_read_* son lecturas simples y F() funciona; no hay avr/io.h, ISR() ni acceso directo a los puertos.',
  },
  'wasm32-uno-r4': {
    of: 'd7e5487d',
    text: 'El sketch se ejecuta como WebAssembly (wasm32). Los registros del RA4M1 del R4, la calibración del DAC y del ADC y su HAL FSP no existen; analogReadResolution y analogWrite en A0 (DAC) están modelados.',
  },
};

export const SKETCH_TEXTS: Record<string, Texts> = { 'pt-BR': ptBR, es };
