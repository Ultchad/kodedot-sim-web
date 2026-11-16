# Pasta inicial de peça do dotbench

Crie o seu próprio componente ("peça") para a bancada do dotbench, ligue-o ao conector de expansão do Kode Dot e veja funcionar. Uma peça pode ser **sem código** (um botão, um potenciômetro, um sensor I2C com registradores fixos) ou **código Arduino de verdade** (um ESP32 que se comporta como um sensor, um controlador de display, qualquer coisa que você consiga escrever em um `.ino`).

Outros idiomas: [English](README.md), [Español](README.es.md). Prefere deixar uma IA fazer? Use o [PROMPT.pt-BR.md](PROMPT.pt-BR.md).

## O que tem nesta pasta

| Arquivo | O que é |
|---|---|
| `manifest.json` | A descrição da peça: nome, pinos e onde ficam na imagem, campos editáveis, comportamento. Este modelo é um ESP32 funcionando como sensor de temperatura LM75. |
| `manifest.schema.json` | O JSON Schema que o `manifest.json` precisa seguir (seu editor pode usá-lo para dar dicas). |
| `picture.svg` | A imagem da peça. Troque pela sua (PNG, WebP ou SVG, até 1 MB). |
| `src/main.ino` | O sketch Arduino, código de verdade. |
| `tests/sensor.test.json` | Um cenário que testa a peça (texto de boot, leitura de registrador I2C, mudança de campo, um NACK). |
| `examples/` | Duas peças **sem código** prontas para copiar: um módulo LM75 e um botão. |
| `libraries/` | Coloque bibliotecas Arduino aqui (copie a pasta da biblioteca). |
| `PROMPT.md` (+ `.pt-BR`, `.es`) | Um prompt pronto para um assistente de código com IA. |

Você precisa da ferramenta de linha de comando `dotbench` (a mesma que compila apps do Kode Dot para a bancada; `dotbench part --help` lista os comandos de peça). Peças sem código não precisam de mais nada.

## Passo a passo, à mão

1. **Copie esta pasta** (`dotbench part new meu-sensor` faz isso) e abra no editor.
2. **Dê uma identidade à peça** no `manifest.json`: um `id` único (por exemplo `com.seunome.meu-sensor`, minúsculas, com pontos), `name` e `description` em inglês, português e espanhol, seu `author`, uma `license` (um id SPDX como `MIT`) e a `version`.
3. **Desenhe a imagem.** Abra o `picture.svg` no navegador ou faça um PNG. `picture.width` e `picture.height` no manifesto são o tamanho do desenho em pixels. Toda posição do manifesto (`pos`, `region`, `visuals`) usa essa caixa de pixels, com (0,0) no canto superior esquerdo.
4. **Liste os pinos.** Uma entrada para cada lugar onde um fio pode ser ligado:
   - `power_in` para a alimentação (informe `min_mv` e `max_mv`, por exemplo 3000 e 3600), `ground` para o GND, `io` para um sinal, `analog` para um sinal analógico.
   - `pos` é o centro do pad na sua imagem. Abra a imagem e leia as coordenadas.
   - Para código Arduino, `gpio` é o número do pino que o seu sketch usa (neste modelo `SDA` é 21 e `SCL` é 22).
   - Uma peça fica **desligada até o pino de alimentação estar em um trilho e o pino de terra estar ligado ao GND**. O app do Kode Dot precisa ligar o trilho antes (`kode_pin_power_3v3(true)`).
5. **Adicione campos** para tudo que você quiser mudar enquanto roda: um controle de temperatura, um endereço, uma chave. Cada um tem um `name` (minúsculas), um rótulo em três idiomas, um `default` e limites.
6. **Escolha o comportamento.**
   - **Sem código**: copie `examples/lm75-declarative.manifest.json` ou `examples/button-module.manifest.json` e altere. Elementos disponíveis: `switch`, `bridge`, `divider`, `source`, `drive`, `i2c_slave`, `h_bridge`, `servo`, `wireless`. Os valores vêm dos seus campos.
   - **Código Arduino**: edite o `src/main.ino`. Leia um campo com `dotbenchField(FIELD_TEMPERATURE)` e publique um valor na imagem com `dotbenchOutput(OUTPUT_READS, n)`. O cabeçalho `dotbench_fields.h` é gerado a partir do manifesto na hora de compilar.
7. **Faça a imagem reagir** com `visuals` (um LED que brilha, um texto com um número) e deixe as pessoas interagirem com `controls` (um botão que dá para apertar na imagem).
8. **Verifique e teste.**
   ```
   dotbench part check .     # manifesto, imagem, referências de pinos e campos, traduções
   dotbench part test .      # compila seu código e roda tests/*.test.json
   ```
   Edite o `tests/sensor.test.json` para combinar com a sua peça. Passos: `advance_ms`, `set_field`, `expect_serial`, `i2c`, `expect_output`.
9. **Gere o arquivo da peça:** `dotbench part build .` produz `<id>-<version>.dotpart`.
10. **Teste no navegador.** Abra o dotbench, aba **Crie o seu**, solte o `.dotpart` em **Verificar minha peça**, leia o que o diálogo de importação diz (o que ela executa, quais pinos, o que ela não pode fazer) e importe. Adicione à bancada, ligue `3V3` e `GND`, depois os pinos de sinal ao conector (`EXP1` a `EXP14`), e rode o seu app do Kode Dot.

## O que é bom saber

- **O que o Kode Dot faz no conector:** entrada e saída digital, PWM de saída (1 a 40000 Hz), leitura analógica em `EXP8` a `EXP12` e `EXP14`, I2C **mestre**, SPI **mestre**, UART 8N1. Ele não pode ser escravo de I2C ou SPI, então a sua peça é o escravo.
- **Regras do Arduino:** escreva um sketch normal. Para um escravo I2C use `Wire.begin((uint8_t)endereco, SDA, SCL, 100000)` (com o cast). Suportado: GPIO, interrupções, `analogRead`, PWM (`analogWrite`, `ledc*`), `millis/delay`, `Serial` (aparece no console da peça), `Serial1/2`, `Wire`. Não suportado: tarefas FreeRTOS, WiFi, Bluetooth, SD, NeoPixel e outras bibliotecas com temporização de bits. SPI e `Preferences` estão planejados.
- **O tempo é virtual.** `delay()` e `millis()` seguem o relógio da bancada, então pausar ou avançar passo a passo a bancada pausa o seu sketch.
- **Bibliotecas:** copie a pasta da biblioteca em `libraries/`. Bibliotecas que mexem em registradores AVR não funcionam.
- **Limites da simulação:** os sinais são níveis DC e transações de barramento. PWM é frequência e ciclo, não bordas. Protocolos por bit-banging, alongamento de clock do I2C e corrente não são simulados.
- **Licença:** a peça é sua; escolha a `license` com honestidade e mantenha as licenças das bibliotecas que copiar.
- **Nada sai do seu navegador.** Uma peça não pode usar a rede.

## Se algo der errado

| Mensagem ou sintoma | Causa provável |
|---|---|
| a peça fica escura | trilho não ligado pelo app, `power_in` sem fio, ou `ground` sem ligação ao GND |
| a sondagem I2C não acha nada | SDA e SCL trocados ou em redes diferentes das do `kode_i2c_begin` do app; endereço errado; a peça está desligada |
| "duas saídas na mesma rede" / fio vermelho | duas saídas ligadas entre si, ou uma saída em um trilho |
| "5 V em pino de 3,3 V" | um trilho de 5 V ou uma peça de 5 V acionando um pino de 3,3 V |
| o `check` diz que uma posição está fora da imagem | `pos` ou uma região passa de `picture.width/height` |
| o `test` diz "undeclared identifier" para uma função | adicione um protótipo acima do primeiro uso |
| selo "travou" na peça | seu código deu erro (falta de memória, ponteiro inválido); ela reinicia até 3 vezes |
| selo "laço ocupado" | o `loop()` nunca chama `delay()` nem nada que bloqueie |
