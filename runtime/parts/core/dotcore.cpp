// dotcore HAL: implements what ArduinoCore-API declares but does not define.
#include "Wire.h"
#include "SPI.h"
#include "Preferences.h"
#include "dotbench_abi.h"
#include "dotbench.h"
#include <string.h>
#include <stdlib.h>

// ---- time ----
static uint64_t g_boot_us;   // set when dp_start runs: millis()/micros() count from power-on, like a real MCU
// timed work the sketch does not call itself: tone() durations and library timers (LED matrix sequences)
struct ToneT { int16_t pin; uint64_t end; };
static ToneT g_tones[4];
typedef void (*PollFn)(void); typedef uint64_t (*DeadlineFn)(void);
static PollFn g_polls[4]; static DeadlineFn g_deadlines[4]; static int g_npolls = 0;
void dotcore_register_poll(PollFn f, DeadlineFn d) { if (g_npolls < 4) { g_polls[g_npolls] = f; g_deadlines[g_npolls++] = d; } }
static void pwm_stop_pin(int pin) { dp_pwm(pin, 0, 0); dp_pin_write(pin, 0); }
void dotcore_poll(void) {
  uint64_t now = 0; bool have = false;
  for (auto &t : g_tones) if (t.pin >= 0 && (have || (now = dp_time_us(), have = true)) && now >= t.end) { pwm_stop_pin(t.pin); t.pin = -1; }
  for (int i = 0; i < g_npolls; i++) g_polls[i]();
}
static uint64_t next_deadline(uint64_t limit) {
  uint64_t d = limit;
  for (auto &t : g_tones) if (t.pin >= 0 && t.end < d) d = t.end;
  for (int i = 0; i < g_npolls; i++) { uint64_t x = g_deadlines[i](); if (x < d) d = x; }
  return d;
}
unsigned long micros(void) { dotcore_poll(); return (unsigned long)(dp_time_us() - g_boot_us); }
unsigned long millis(void) { dotcore_poll(); return (unsigned long)((dp_time_us() - g_boot_us) / 1000ULL); }
int64_t esp_timer_get_time(void) { return (int64_t)(dp_time_us() - g_boot_us); }
static void wait_until(uint64_t target) {
  for (;;) {
    uint64_t now = dp_time_us(); if (now >= target) return;
    uint64_t next = next_deadline(target);
    dp_wait_until_us(next); dotcore_poll();
  }
}
void delay(unsigned long ms) { wait_until(dp_time_us() + (uint64_t)ms * 1000ULL); }
void delayMicroseconds(unsigned int us) { wait_until(dp_time_us() + us); }
void yield(void) { dp_yield(); dotcore_poll(); }

// ---- GPIO ----
void pinMode(pin_size_t p, PinMode m) { dp_pin_mode(p, (int)m); }
void digitalWrite(pin_size_t p, PinStatus s) { dp_pin_write(p, s == LOW ? 0 : 1); }
PinStatus digitalRead(pin_size_t p) { return dp_pin_read(p) ? HIGH : LOW; }

static voidFuncPtrParam g_isr[64]; static void *g_isr_arg[64];
void attachInterruptParam(pin_size_t p, voidFuncPtrParam cb, PinStatus mode, void *param) {
  if (p < 64) { g_isr[p] = cb; g_isr_arg[p] = param; dp_pin_irq(p, (int)mode); }
}
static void plain_trampoline(void *f) { ((voidFuncPtr)f)(); }
void attachInterrupt(pin_size_t p, voidFuncPtr cb, PinStatus mode) {
  attachInterruptParam(p, plain_trampoline, mode, (void *)cb);
}
void detachInterrupt(pin_size_t p) { if (p < 64) { g_isr[p] = nullptr; dp_pin_irq(p, 0); } }

// ---- analog / PWM: resolution, reference and PWM pins come from the board variant (variants/<core>/pins_arduino.h) ----
static uint8_t g_adc_bits = DP_ADC_BITS, g_pwm_bits = DP_PWM_BITS; static uint32_t g_pwm_hz_override = 0;
void analogReadResolution(uint8_t b) {
#if DP_ADC_SETTABLE
  if (b >= 1 && b <= 14) g_adc_bits = b;
#else
  (void)b;       // the Uno R3 ADC is 10 bit, fixed
#endif
}
void analogWriteResolution(uint8_t b) { if (b >= 1 && b <= 16) g_pwm_bits = b; }
void analogWriteFrequency(uint32_t hz) { g_pwm_hz_override = hz; }
void analogReference(uint8_t) {}
int analogRead(pin_size_t p) {
#ifdef DP_ANALOG_PIN
  p = DP_ANALOG_PIN(p);
#endif
  long mv = dp_adc_mv(p); if (mv < 0) mv = 0; if (mv > DP_ADC_VREF_MV) mv = DP_ADC_VREF_MV;
  return (int)((mv * ((1L << g_adc_bits) - 1)) / DP_ADC_VREF_MV);
}
void analogWrite(pin_size_t p, int v) {
  const uint32_t full = (1UL << g_pwm_bits) - 1;
#ifdef DP_IS_DAC
  if (DP_IS_DAC(p)) { long mv = (long)v * DP_ADC_VREF_MV / (long)full; dp_dac_mv(p, (int)(mv < 0 ? 0 : mv > DP_ADC_VREF_MV ? DP_ADC_VREF_MV : mv)); return; }
#endif
#if !DP_PWM_ANY
  if (!DP_IS_PWM(p)) { dp_pin_mode(p, 1); dp_pin_write(p, v >= (int)((full + 1) / 2) ? 1 : 0); return; }   // a non-PWM pin: digital, as on the real board
#endif
  if (v <= 0) { dp_pin_mode(p, 1); dp_pwm(p, 0, 0); dp_pin_write(p, 0); return; }
  if ((uint32_t)v >= full) { dp_pin_mode(p, 1); dp_pwm(p, 0, 0); dp_pin_write(p, 1); return; }
  dp_pwm(p, g_pwm_hz_override ? g_pwm_hz_override : DP_PWM_HZ_FOR(p), (uint32_t)(((uint64_t)v << 16) / full));
}
#if DP_ESP_API
static void pwm_out(uint8_t p, uint32_t hz, uint32_t duty, uint8_t bits) {
  uint32_t full = (1UL << bits); if (duty > full) duty = full;
  dp_pwm(p, hz, (uint32_t)(((uint64_t)duty << 16) / full));
}
static uint8_t g_ledc_pin[16], g_ledc_bits[16]; static uint32_t g_ledc_hz[16];
uint32_t ledcSetup(uint8_t ch, uint32_t f, uint8_t bits) { g_ledc_hz[ch & 15] = f; g_ledc_bits[ch & 15] = bits; return f; }
void ledcAttachPin(uint8_t pin, uint8_t ch) { g_ledc_pin[ch & 15] = pin; }
void ledcWriteChannel(uint8_t ch, uint32_t duty) { pwm_out(g_ledc_pin[ch & 15], g_ledc_hz[ch & 15], duty, g_ledc_bits[ch & 15]); }
static uint32_t g_pinhz[64]; static uint8_t g_pinbits[64];
bool ledcAttach(uint8_t pin, uint32_t f, uint8_t bits) { if (pin < 64) { g_pinhz[pin] = f; g_pinbits[pin] = bits; } return true; }
void ledcWrite(uint8_t pin, uint32_t duty) { if (pin < 64) pwm_out(pin, g_pinhz[pin], duty, g_pinbits[pin]); }
void dacWrite(uint8_t pin, uint8_t v) { dp_dac_mv(pin, (int)v * 3300 / 255); }
void analogSetAttenuation(int) {}
uint32_t getCpuFrequencyMhz(void) { return 240; }
#endif
// tone(): a 50 % square wave as PWM on the net; with a duration it stops by itself (checked at every time call, delay and yield)
void tone(uint8_t pin, unsigned int f, unsigned long duration) {
  if (f == 0) { noTone(pin); return; }
  for (auto &t : g_tones) if (t.pin == pin) t.pin = -1;
  dp_pin_mode(pin, 1); dp_pwm(pin, f, 32768);
  if (duration) for (auto &t : g_tones) if (t.pin < 0) { t.pin = pin; t.end = dp_time_us() + (uint64_t)duration * 1000ULL; break; }
}
void noTone(uint8_t pin) { for (auto &t : g_tones) if (t.pin == pin) t.pin = -1; dp_pin_mode(pin, 1); pwm_stop_pin(pin); }

double dotbenchField(int i) { return dp_field_f64(i); }
void dotbenchOutput(int i, double v) { dp_output_f64(i, v); }

// ---- misc API functions the layer leaves to the core ----
unsigned long pulseIn(uint8_t pin, uint8_t state, unsigned long timeout) {
  uint64_t t0 = dp_time_us();
  while (dp_pin_read(pin) == state) { if (dp_time_us() - t0 > timeout) return 0; }
  while (dp_pin_read(pin) != state) { if (dp_time_us() - t0 > timeout) return 0; }
  uint64_t s = dp_time_us();
  while (dp_pin_read(pin) == state) { if (dp_time_us() - t0 > timeout) return 0; }
  return (unsigned long)(dp_time_us() - s);
}
unsigned long pulseInLong(uint8_t pin, uint8_t state, unsigned long timeout) { return pulseIn(pin, state, timeout); }
void shiftOut(pin_size_t d, pin_size_t c, BitOrder o, uint8_t v) {
  for (uint8_t i = 0; i < 8; i++) {
    digitalWrite(d, (o == LSBFIRST ? !!(v & (1 << i)) : !!(v & (1 << (7 - i)))) ? HIGH : LOW);
    digitalWrite(c, HIGH); digitalWrite(c, LOW);
  }
}
uint8_t shiftIn(pin_size_t d, pin_size_t c, BitOrder o) {
  uint8_t v = 0;
  for (uint8_t i = 0; i < 8; ++i) {
    digitalWrite(c, HIGH);
    if (o == LSBFIRST) v |= digitalRead(d) << i; else v |= digitalRead(d) << (7 - i);
    digitalWrite(c, LOW);
  }
  return v;
}
static unsigned long g_seed = 1;
void randomSeed(unsigned long s) { g_seed = s ? s : 1; }
static unsigned long rnd() { g_seed = g_seed * 1103515245UL + 12345UL; return (g_seed >> 8) & 0x7fffffffUL; }
long random(long hi) { return hi <= 0 ? 0 : (long)(rnd() % (unsigned long)hi); }
long random(long lo, long hi) { return lo >= hi ? lo : lo + random(hi - lo); }
void init(void) __attribute__((weak)); void init(void) {}
void initVariant(void) __attribute__((weak)); void initVariant(void) {}
#if DP_ESP_API
void EspClass::restart() { dp_yield(); }
uint32_t EspClass::getFreeHeap() { return 200000; }
EspClass ESP;
uint32_t esp_random(void) { return (uint32_t)(rnd() << 1) ^ (uint32_t)rnd(); }
#endif
void serialEvent() {}

// ---- Serial ----
DPSerial Serial(0);
#if DP_HAS_SERIAL1
DPSerial Serial1(1);
#endif
#if DP_ESP_API
DPSerial Serial2(2);
#endif
void DPSerial::begin(unsigned long baud, uint32_t, int8_t rx, int8_t tx) { dp_uart_begin(port_, (uint32_t)baud, rx, tx); }
void DPSerial::flushTx() { if (txn_) { dp_uart_write(port_, tx_, txn_); txn_ = 0; } }
// every write goes out at once (a real UART starts sending immediately); the 64 byte buffer only batches one call's bytes
size_t DPSerial::write(uint8_t c) { tx_[txn_++] = c; flushTx(); return 1; }
size_t DPSerial::write(const uint8_t *b, size_t n) { for (size_t i = 0; i < n; i++) { tx_[txn_++] = b[i]; if (txn_ == sizeof tx_) flushTx(); } flushTx(); return n; }
void DPSerial::flush() { flushTx(); }
int DPSerial::available() { dp_yield(); return (rxt_ - rxh_) & 255; }
int DPSerial::peek() { dp_yield(); return rxh_ == rxt_ ? -1 : rx_[rxh_]; }
int DPSerial::read() { dp_yield(); if (rxh_ == rxt_) return -1; uint8_t b = rx_[rxh_]; rxh_ = (rxh_ + 1) & 255; return b; }
void DPSerial::rxPush(uint8_t b) { uint16_t n = (rxt_ + 1) & 255; if (n != rxh_) { rx_[rxt_] = b; rxt_ = n; } }
size_t DPSerial::printf(const char *fmt, ...) {
  char buf[256]; va_list ap; va_start(ap, fmt); int n = vsnprintf(buf, sizeof buf, fmt, ap); va_end(ap);
  if (n < 0) return 0; if (n > (int)sizeof buf - 1) n = sizeof buf - 1;
  return write((const uint8_t *)buf, n);
}

// ---- Wire ----
TwoWire Wire(0), Wire1(1);
bool TwoWire::begin(int sda, int scl, uint32_t f) {
  isSlave_ = false; sda_ = sda < 0 ? SDA : sda; scl_ = scl < 0 ? SCL : scl; if (f) hz_ = f;
  dp_i2c_master_begin(port_, sda_, scl_, hz_); return true;
}
bool TwoWire::begin(uint8_t addr, int sda, int scl, uint32_t f) {
  isSlave_ = true; slaveAddr_ = addr; sda_ = sda < 0 ? SDA : sda; scl_ = scl < 0 ? SCL : scl; if (f) hz_ = f;
  dp_i2c_slave_begin(port_, addr, sda_, scl_); return true;
}
size_t TwoWire::write(uint8_t c) { if (txn_ >= sizeof tx_) return 0; tx_[txn_++] = c; return 1; }
size_t TwoWire::write(const uint8_t *d, size_t n) { size_t i = 0; while (i < n && write(d[i])) i++; return i; }
uint8_t TwoWire::endTransmission(bool stop) {
  int r = dp_i2c_xfer(port_, txAddr_, tx_, txn_, nullptr, 0, stop); txn_ = 0; return (uint8_t)r;
}
size_t TwoWire::requestFrom(uint8_t addr, size_t len, bool stop) {
  if (len > sizeof rx_) len = sizeof rx_;
  int r = dp_i2c_xfer(port_, addr, nullptr, 0, rx_, len, stop);
  rxi_ = 0; rxn_ = r == 0 ? len : 0; return rxn_;
}
// One transaction aimed at our slave address: optional write part, then optional read part
// (what a repeated-start register read is). Returns bytes produced, or -1 for "nobody home" (NACK).
int TwoWire::slaveEvent(int addr, const uint8_t *w, int wn, uint8_t *r, int rn) {
  if (!isSlave_ || addr != slaveAddr_) return -1;
  if (wn > 0) {
    memcpy(rx_, w, wn); rxn_ = wn; rxi_ = 0;
    if (onRecv_) onRecv_(wn);
  }
  int out = 0;
  if (rn > 0) {
    txn_ = 0; inRequest_ = true;
    if (onReq_) onReq_();
    inRequest_ = false;
    for (; out < rn; out++) r[out] = out < txn_ ? tx_[out] : 0xFF;   // pad like an idle bus
    txn_ = 0;
  }
  return out;
}

// ---- SPI (master) ----
SPIClass SPI(0);
void SPIClass::begin(int sck, int miso, int mosi, int ss) {
  sck_ = sck < 0 ? SCK : sck; miso_ = miso < 0 ? MISO : miso; mosi_ = mosi < 0 ? MOSI : mosi; ss_ = ss < 0 ? SS : ss;
  hz_ = 1000000; mode_ = 0; open_ = true; dp_spi_begin(port_, sck_, miso_, mosi_, ss_, hz_, mode_);
}
void SPIClass::beginTransaction(SPISettings s) {
  if (!open_) begin();
  hz_ = s.getClockFreq(); mode_ = (int)s.getDataMode(); msb_ = s.getBitOrder() == MSBFIRST;
  dp_spi_begin(port_, sck_, miso_, mosi_, ss_, hz_, mode_);
}
static uint8_t rev8(uint8_t b) { b = (b & 0xF0) >> 4 | (b & 0x0F) << 4; b = (b & 0xCC) >> 2 | (b & 0x33) << 2; return (b & 0xAA) >> 1 | (b & 0x55) << 1; }
void SPIClass::transfer(void *buf, size_t n) {
  uint8_t *p = (uint8_t *)buf, tmp[64];
  for (size_t off = 0; off < n; off += sizeof tmp) {
    size_t c = n - off < sizeof tmp ? n - off : sizeof tmp;
    if (!open_) begin();
    if (!msb_) for (size_t i = 0; i < c; i++) p[off + i] = rev8(p[off + i]);
    dp_spi_xfer(port_, p + off, tmp, c);
    for (size_t i = 0; i < c; i++) p[off + i] = msb_ ? tmp[i] : rev8(tmp[i]);
  }
}
uint8_t SPIClass::transfer(uint8_t d) { transfer(&d, 1); return d; }
uint16_t SPIClass::transfer16(uint16_t d) { uint8_t b[2] = { (uint8_t)(d >> 8), (uint8_t)d }; if (!msb_) { uint8_t t = b[0]; b[0] = b[1]; b[1] = t; } transfer(b, 2); return msb_ ? (uint16_t)(b[0] << 8 | b[1]) : (uint16_t)(b[1] << 8 | b[0]); }
void SPIClass::transferBytes(const uint8_t *out, uint8_t *in, uint32_t n) { for (uint32_t i = 0; i < n; i++) { uint8_t b = out ? out[i] : 0xFF; transfer(&b, 1); if (in) in[i] = b; } }

#if DP_ESP_API
// ---- Preferences: in memory, for the life of this power-on (the bench does not persist it yet) ----
namespace { struct PrefEnt { char key[16]; uint8_t type; uint32_t n; uint8_t *data; }; PrefEnt g_prefs[32]; int g_np = 0; }
static PrefEnt *pref_find(const char *k) { for (int i = 0; i < g_np; i++) if (!strncmp(g_prefs[i].key, k, 15)) return &g_prefs[i]; return nullptr; }
static PrefEnt *pref_put(const char *k, const void *d, uint32_t n, uint8_t type) {
  PrefEnt *e = pref_find(k);
  if (!e) { if (g_np >= 32) return nullptr; e = &g_prefs[g_np++]; strncpy(e->key, k, 15); e->key[15] = 0; e->data = nullptr; }
  free(e->data); e->data = (uint8_t *)malloc(n ? n : 1); memcpy(e->data, d, n); e->n = n; e->type = type; return e;
}
bool Preferences::begin(const char *, bool, const char *) { open_ = true; return true; }
void Preferences::end() { open_ = false; }
bool Preferences::clear() { for (int i = 0; i < g_np; i++) free(g_prefs[i].data); g_np = 0; return true; }
bool Preferences::remove(const char *k) { PrefEnt *e = pref_find(k); if (!e) return false; free(e->data); *e = g_prefs[--g_np]; return true; }
bool Preferences::isKey(const char *k) { return pref_find(k) != nullptr; }
size_t Preferences::putBytes(const char *k, const void *v, size_t n) { return pref_put(k, v, (uint32_t)n, 1) ? n : 0; }
size_t Preferences::getBytes(const char *k, void *v, size_t cap) { PrefEnt *e = pref_find(k); if (!e) return 0; size_t n = e->n < cap ? e->n : cap; memcpy(v, e->data, n); return n; }
size_t Preferences::getBytesLength(const char *k) { PrefEnt *e = pref_find(k); return e ? e->n : 0; }
size_t Preferences::putString(const char *k, const char *v) { return pref_put(k, v, (uint32_t)strlen(v) + 1, 2) ? strlen(v) : 0; }
String Preferences::getString(const char *k, String def) { PrefEnt *e = pref_find(k); return e && e->type == 2 ? String((const char *)e->data) : def; }

#endif

// ---- exports: how the bench reaches into the component ----
static uint8_t g_scratch[512];
extern "C" {
DP_EXPORT(dp_scratch) uint8_t *dp_scratch(void) { return g_scratch; }
// scratch[0..wn) holds the write bytes; read bytes are returned in scratch[256..256+rn)
DP_EXPORT(dp_i2c_slave_event) int dp_i2c_slave_event(int port, int addr, int wn, int rn) {
  TwoWire &w = port == 0 ? Wire : Wire1;
  return w.slaveEvent(addr, g_scratch, wn, g_scratch + 256, rn);
}
DP_EXPORT(dp_pin_event) void dp_pin_event(int pin, int level) {
  (void)level; if (pin >= 0 && pin < 64 && g_isr[pin]) g_isr[pin](g_isr_arg[pin]);
}
DP_EXPORT(dp_uart_rx) void dp_uart_rx(int port, int byte) {
  if (port == 0) Serial.rxPush((uint8_t)byte);
#if DP_HAS_SERIAL1
  else if (port == 1) Serial1.rxPush((uint8_t)byte);
#endif
#if DP_ESP_API
  else if (port == 2) Serial2.rxPush((uint8_t)byte);
#endif
}
DP_EXPORT(dp_start) void dp_start(void) {
  g_boot_us = dp_time_us();
  init(); initVariant(); setup();
  for (;;) { loop(); if (serialEvent) serialEvent(); dp_yield(); }
}
}
