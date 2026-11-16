# dotbench: bancada de teste web para apps do Kode Dot

Data: 2026-11-16. Dono: Murilo. Estado: aprovado na conversa (escopo e lista de objetos), detalhes técnicos são decisões do construtor.

## Intenção

O Kode Dot do Murilo só chega em 2027. Ele quer escrever os apps dele desde já, num site (Vercel, sem backend), vendo o aparelho na tela e interagindo com objetos simples de bancada: tag NFC, cartão RFID, leitor de porta, roteador, etc. Não é emulação da placa. É um ambiente de teste onde o hardware "finge que acontece".

## Objetivos

- Rodar o **código-fonte real** de um app kode-sdk (C, `kode.h` / `kode_sys.h`, LVGL, Active Objects QP/C) no navegador, sem alterar o app.
- Cobrir toda a API pública do SDK com hardware de mentira controlado pela página.
- Tudo local no navegador: apps e arquivos em IndexedDB, preferências em localStorage.
- Entrega em etapas, cada uma utilizável.

## Não objetivos

- Emular o ESP32-P4, registradores de chips, ou rodar binários `.bin` do apps.kode.diy.
- Fidelidade de tempo, memória ou rádio. O kode-sim local continua sendo o teste fiel.
- Compilar C dentro do site (por enquanto). A compilação é um comando no Mac.

## Anti-objetivos

- Reescrever o `kode.h` à mão em JS (divergiria do SDK a cada versão).
- Exigir servidor, conta ou banco.

## Abordagens consideradas

1. **Emulação real no navegador** (esp-emu em WebAssembly + firmware real). Descartada: lenta (estimado 10 a 50% do tempo real), build de navegador sem PSRAM configurável, sem UART1, sem SD nem tela, e NFC/RFID/Bluetooth continuariam faltando.
2. **Reimplementar `kode.h` em JS do zero.** Descartada: 171 funções, mais `kode_sys.h` e os Active Objects; divergência garantida.
3. **Escolhida: compilar as camadas de cima do kode-sdk para WebAssembly e trocar só os drivers.** O SDK é bem separado: `kode`, `kode_sys`, `kaos`, `kqp`, `kscreen`, `kode_screen`, `klog` quase não incluem ESP-IDF. A dependência de hardware fica em `khal` e `kdrv` (cerca de 540 funções chamadas pelas camadas de cima). O próprio SDK já compila essas camadas para Linux nos testes, com drivers falsos. Teste feito: 138 de 155 arquivos passam no `emcc -fsyntax-only` sem mudança; os demais falham por montagem (sdkconfig, macros do FreeRTOS).

## Arquitetura (decisões do construtor)

```
 app (C, sem mudança) ─┐
 kode / kode_sys / kaos / kqp / kscreen / LVGL / QP/C   (fontes reais do kode-sdk)
 ───────────────────────── costura ─────────────────────────
 runtime/rtos     FreeRTOS "de mentira" sobre pthreads do Emscripten
 runtime/idf      cabeçalhos e funções mínimas do ESP-IDF (esp_log, esp_timer, esp_err, nvs...)
 runtime/drivers  drivers web: implementam as funções khal_* / kdrv_* contra um estado compartilhado
 runtime/bridge   kweb_bridge.h: estado do aparelho + funções exportadas para a página
 ───────────────────────── WebAssembly ─────────────────────
 web/             página (React + Vite + TS + Tailwind): aparelho, bancada de objetos, console
```

- **Threads:** Emscripten com `-pthread` e `-sPROXY_TO_PTHREAD`. Cada tarefa FreeRTOS vira uma pthread (Web Worker). Mantém o port QP/C do SDK (`qf_port.c`) o mais intacto possível. Exige cabeçalhos COOP/COEP (configurados em `vercel.json`).
- **Costura:** quanto mais baixo, melhor. Onde um arquivo real de `khal`/`kdrv` for lógica pura, compila o real. Onde tocar hardware, entra um driver web.
- **Ponte C ↔ JS:** um `kweb_state_t` em memória compartilhada (framebuffer 410x502, contador de quadro, brilho, LED RGB, vibração, etc.) que a página lê a cada quadro; entradas por funções exportadas (`kweb_button`, `kweb_touch`, e uma função por objeto de bancada); saídas assíncronas (log, console) por uma fila circular.
- **Cada área de hardware é um módulo isolado:** `runtime/drivers/<area>/` (C + `exports.txt`), `web/src/device/<area>.ts` (invólucro tipado) e `web/src/bench/<area>/` (objetos de bancada). Áreas não editam arquivos umas das outras.
- **Empacote de app:** `tools/dotbench build <pasta-do-app>` compila os fontes de `main/` e liga com a biblioteca pré-compilada do SDK, gerando um `.dotbench` (zip: `.wasm`, `.js`, `app.json`, ícone). A página guarda em IndexedDB e carrega por blob URL.
- **Testes:** cada etapa tem teste automatizado em Node (carrega o wasm, aperta botão, lê estado) e, para a página, Chrome headless.
- **Versões presas:** kode-sdk `c9568a3`, LVGL 9.6.0, Emscripten 7.0.0.
- **Licença:** GPL-3.0-or-later (herdada do kode-sdk e do QP/C). Nome e imagem do Kode Dot são marca da Kode: uso pessoal; se for público, trocar nome e arte.

## Bancada (aprovada)

| Área | Objetos |
|---|---|
| NFC | tag (texto ou link), cartão, leitor (para o Kode emulando cartão) |
| RFID 125 kHz | cartão EM4100, tag T5577 regravável, leitor de porta |
| Wi-Fi | roteador (nome, senha, com ou sem internet) |
| Bluetooth | aparelho simples (sensor), celular |
| Infravermelho | TV que recebe, controle que envia |
| Resto | microSD, cabo USB com computador, carregador/bateria, inclinar e chacoalhar |

## Etapas

0. **Fundação:** RTOS sobre pthreads, script de build, tudo ligando, `buttons_led` e `display_lvgl` rodando em Node com LED, botões e tela falsos. Casca da página com aparelho e bancada vazia.
1. **Base:** tela, toque, botões, LED, vibração, hora, arquivos (IndexedDB), console, carregar app pelo arrastar. Template e exemplos básicos rodando na página.
2. **NFC e RFID.**
3. **Wi-Fi, HTTP, MQTT e Bluetooth.** HTTP via `fetch` (sujeito a CORS), MQTT via WebSocket.
4. **Infravermelho, microSD, USB, bateria, movimento, áudio.**
5. **Módulos de expansão** (pinos, I2C/SPI/UART virtuais; Maker e Robotics primeiro).

## Acréscimos pedidos depois (2026-11-16)

- **Visual:** aparelho em 3D com o render oficial da frente (vem no kode-sdk, GPL) e a geometria do `kode-dot.json`; botões e tela clicáveis; modo 2D pixel a pixel. Espessura estimada (12 mm), laterais e traseira lisas. Não usar o modelo 3D do site kode.diy.
- **Responsivo:** no celular, "modo aparelho": a frente ocupa a tela, sensores reais do telefone alimentam o IMU, instalável na tela de início.
- **Etapa 6, componentes personalizados ("Tinkercad do Kode Dot"):**
  - Um componente é um pacote (`.dotpart`): manifesto (nome, imagem ou modelo, pinos e portas sem fio, campos editáveis) + comportamento em código, rodando isolado num Worker.
  - **Fiação:** o usuário liga pinos do componente aos 14 GPIOs do conector de expansão (GPIO8 a GPIO21) e às alimentações. O driver falso do conector roteia nível de GPIO, I2C (por endereço), SPI, UART, PWM e tensão analógica entre o app e os componentes ligados.
  - Os módulos oficiais (Maker, Robotics, Camera, Mesh, F*CK) da etapa 5 são construídos com a mesma API, como componentes embutidos. Objetos sem fio (tag, roteador, periférico BLE) usam a mesma API com "portas sem fio".
  - **Manual dentro do site:** como criar, testar, exportar e importar um componente, com exemplos copiáveis.
  - **Microcontrolador programável (ex.: ESP32):** decidido pelo Murilo: código **Arduino/C/C++ de verdade** (`.ino`, `.cpp`), o mesmo que iria para a placa real, compilado para WebAssembly contra uma implementação web da API do Arduino (GPIO, PWM, ADC, Serial, Wire mestre e escravo, SPI, interrupções, tempo). Compilação pelo mesmo comando `dotbench` no Mac; compilar dentro do site é melhoria futura. Emular firmware binário de ESP32 não está planejado.
  - **Dois jeitos de criar um componente, na aba "Crie o seu":** manual (documentação + pasta modelo para baixar) e assistido por IA (a mesma pasta traz um prompt pronto, que termina em "Escreva aqui o que você quer:", para colar no Claude Code ou em outra IA junto com a pasta).
- **Idiomas:** site em inglês por padrão, com português (Brasil) e espanhol. Todo texto de interface passa pela camada de tradução.

## O que fica para o construtor

Detalhes do shim FreeRTOS, formato exato do `kweb_state_t`, geração do `sdkconfig.h`, ordem interna de cada etapa, e o visual da página.

## Riscos conhecidos

- Ligar e rodar ainda não foi provado (só a análise de sintaxe).
- 25+ Workers por causa das tarefas; pode pesar em máquina fraca.
- Chamadas bloqueantes do `kode.h` dependem do shim de semáforos estar correto.
- HTTP real limitado por CORS do navegador.
