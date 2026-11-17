# Bancada de prototipagem ("Tinkercad do Kode Dot")

Pedido do Murilo (17/11/2026): os objetos da bancada (tag NFC, leitor, roteador...) com modelo 3D, aproximados pela chave ou arrastando; e os componentes como um Tinkercad: uma bancada 3D onde tudo fica em cima, arrastando só "colado" na mesa, com fios, componentes (resistor, capacitor, placas, antenas), código nas placas, biblioteca do site com as peças mais comuns e importação de peça própria. Tudo no navegador, sem servidor (Vercel Hobby, site estático).

## Intenção

Poder montar um protótipo inteiro em volta do Kode Dot antes de ter o hardware: o Dot de verdade (kodeOS e apps reais) no meio de uma mesa, com as coisas sem fio por perto e as peças ligadas por fio no conector de expansão, programando as placas ali mesmo.

## Decisões

1. **Uma cena 3D só, a Bancada.** Uma mesa; o Dot deitado nela, funcionando (tela e botões continuam clicáveis). Tudo o que existe no banco mora nessa mesa. A vista de hoje (só o aparelho) continua existindo como modo "Aparelho" e é o padrão no celular. Alternar entre os dois modos não reinicia nada.
2. **Movimento preso à mesa.** Arrastar desliza no plano da mesa; girar em passos de 90 graus; grade de encaixe (2,54 mm onde fizer sentido). Nada flutua. Câmera: orbitar, mover, zoom, "focar no Dot".
3. **Objetos sem fio.** Tag/cartão/leitor NFC, cartão/tag/leitor RFID, roteador, TV e controle de IR, celular e sensor Bluetooth, cartão microSD, cabo USB com computador, carregador. Cada um com modelo 3D próprio. "Perto do Dot" vira distância na mesa, com um alcance visível: arrastar para dentro/fora muda a chave, e a chave move o objeto para perto/longe. A fonte da verdade continua sendo o estado da bancada que a página já guarda e reaplica a cada programa.
4. **Componentes com fio.** Clicar num terminal e em outro cria um fio (cor escolhível, apagar, o fio deita na mesa). Protoboard com as ligações internas de uma de verdade. Ligação direta nos pinos do conector J3 do Dot.
5. **Biblioteca do site.** Placas: Arduino Uno R3, Uno R4 Minima, Uno R4 WiFi, ESP32-S3 (além da ESP32 que já existe). Peças: LED, LED RGB, resistor, capacitor, botão, chave, potenciômetro, buzzer, servo, motor DC, ponte H (L298N), motor de passo com driver, sensor I2C, antena, bateria/fonte, protoboard. Busca e categorias; arrastar da biblioteca para a mesa. Peça própria: importar `.dotpart`, ou criar no site a partir de uma placa com código próprio; a aba "Faça a sua" mantém manual, pasta inicial e prompt de IA.
6. **Código dentro do site.** Editor por placa, "Compilar e enviar", monitor serial. O compilador roda no navegador (clang/lld em WebAssembly, baixado só quando alguém abre o editor); sem servidor. O sketch roda de verdade compilado para WebAssembly contra a ArduinoCore-API e o nosso core; não é emulação do chip da placa (código que mexe em registrador do chip não funciona). Enquanto o compilador no navegador não estiver provado, o caminho de compilar no computador (`dotbench part build`) continua valendo.
7. **Simulação elétrica.** Corrente contínua com resistências (já existe) mais um transitório simples para capacitor (RC). Avisos visuais como no Tinkercad: curto, LED sem resistor queimando, conflito de saída. Não é um SPICE; o que o modelo não representa fica escrito.
8. **Modelos 3D.** Feitos por código (placa, barras de pinos, chips, corpo das peças), no mesmo padrão de qualidade do aparelho. Peça importada pode trazer um GLB; sem GLB, a página gera uma placa a partir da figura da peça.
9. **Guardar.** A bancada inteira (posições, fios, código, peças importadas) fica no navegador e pode ser exportada/importada num arquivo.

## Não objetivos

Emular os chips das placas; simulação analógica completa; multiusuário; servidor de qualquer tipo.

## Antiobjetivos

Peças "de enfeite" que fingem funcionar; uma cena pesada que trave em notebook comum; quebrar o modo Aparelho ou o uso no celular.

## Abordagens consideradas

- **Compilar no computador do usuário (o que existia):** simples e já funciona, mas não é "tipo Tinkercad". Fica como plano B.
- **Servidor de compilação:** leve para o usuário, mas exige serviço rodando; descartado (Vercel Hobby, site estático).
- **Compilador no navegador (escolhida):** mantém tudo local; custo é um download grande na primeira vez e o risco técnico, que será provado primeiro num teste isolado.

## Frentes

- A. Prova do compilador no navegador.
- B. Motor: novas peças, placas, protoboard, transitório RC, bibliotecas Arduino usuais.
- C. Página: a cena da Bancada, modelos 3D, arrastar, alcance, fios, biblioteca, editor de código, importação.
