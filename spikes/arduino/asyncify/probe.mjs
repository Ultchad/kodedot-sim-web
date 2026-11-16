// Asyncify alternative, main-thread, single module instance (no Atomics). Used only to compare with the Worker design.
import { readFileSync } from 'node:fs';
const nowUs = () => BigInt(Math.round(performance.now() * 1000));
async function load(path, onSerial) {
  let X, deadline = 0n, pending = false; const DATA = () => X.dp_asyncify_buf();
  let serial = '';
  const imp = { dotbench: {
    time_us: () => nowUs(), yield() {}, pin_mode() {}, pin_write() {}, pin_read: () => 0, pin_irq() {}, pwm() {}, adc_mv: () => 0,
    uart_begin() {}, i2c_master_begin() {}, i2c_xfer: () => 2, i2c_slave_begin() {},
    uart_write(port, p, n) { serial += Buffer.from(new Uint8Array(X.memory.buffer, p, n)).toString(); },
    wait_until_us(d) {
      if (X.asyncify_get_state() === 2) { X.asyncify_stop_rewind(); return; }       // woke up
      deadline = d; const dv = new DataView(X.memory.buffer), b = DATA();
      dv.setInt32(b, b + 8, true); dv.setInt32(b + 4, b + 32768, true);             // asyncify data: {cur,end}
      X.asyncify_start_unwind(b); pending = true;
    } } };
  const { instance } = await WebAssembly.instantiate(readFileSync(path), imp); X = instance.exports; X._initialize();
  return { X, get serial() { return serial; }, async run(onSleep) {
    X.dp_start();
    while (X.asyncify_get_state() === 1) {
      X.asyncify_stop_unwind();
      await onSleep(deadline);                                                      // host may call exports here
      X.asyncify_start_rewind(DATA()); X.dp_start();
    } } };
}
// ---- 1. CPU cost ----
{
  const m = await load(new URL('../build/perf.asyncify.wasm', import.meta.url).pathname);
  await m.run(async () => { throw new Error('stop'); }).catch(() => {});
  console.log('asyncify  :', m.serial.trim().split('\n').pop());
}
// ---- 2. can a slave transaction be served while the sketch sleeps in delay()? ----
{
  const m = await load(new URL('../build/i2c_slave.asyncify.wasm', import.meta.url).pathname);
  let rounds = 0, result = null;
  await m.run(async () => {
    if (++rounds === 3) {
      const X = m.X, sc = X.dp_scratch(); new Uint8Array(X.memory.buffer)[sc] = 1;
      const n = X.dp_i2c_slave_event(0, 0x42, 1, 4);
      result = Array.from(new Uint8Array(X.memory.buffer, sc + 256, n));
      throw new Error('stop');
    }
  }).catch(() => {});
  console.log('asyncify  : slave read while sleeping ->', JSON.stringify(result), '(expected [33,50,67,84])');
  console.log('asyncify  : serial:', JSON.stringify(m.serial));
}
