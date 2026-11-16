import { Bench } from './host/bench.mjs';
import assert from 'node:assert/strict';
const b = new Bench('stepped');
const c = b.spawn('i2c_slave', new URL('./build/i2c_slave.wasm', import.meta.url).pathname);
await b.stepUntil(50_000n);                                   // let setup() run and loop() park in delay(10)
let serial = b.serialText(b.drain(c));
console.log('serial after boot:', JSON.stringify(serial));
assert.equal(serial, 'i2c slave ready at 0x42\r\n');

// 1. register read, the way kode_i2c_write_read() does it: write [reg], repeated start, read 4
let r = await b.i2c(c, 0x42, [0x01], 4);
console.log('write_read(0x42,[1],4) ->', r);
assert.deepEqual(r, { ack: true, data: [0x21, 0x32, 0x43, 0x54] });
// 2. a different register
r = await b.i2c(c, 0x42, [0x04], 4);
assert.deepEqual(r.data, [0x54, 0x65, 0x76, 0x87]);
// 3. nobody at another address: NACK, like kode_i2c_probe() false
r = await b.i2c(c, 0x50, [0x00], 1);
console.log('probe 0x50 ->', r);
assert.equal(r.ack, false);
// 4. write registers (reg ptr 2, then values), read back
r = await b.i2c(c, 0x42, [0x02, 0xAA, 0xBB], 0); assert.ok(r.ack);
r = await b.i2c(c, 0x42, [0x02], 3);
assert.deepEqual(r.data.slice(0, 2), [0xAA, 0xBB]);
// 5. read-only transaction (no write part): continues at the stored pointer
r = await b.i2c(c, 0x42, [], 2); assert.ok(r.ack);
await b.stepUntil(60_000n);
serial = b.serialText(b.drain(c));
console.log('serial after transactions:\n' + serial);
for (const want of ['onReceive len=1 reg=1', 'onRequest reg=1 (#1)', 'onRequest reg=4 (#2)', 'onReceive len=3 reg=2',
                    '  write regs[2]=0xAA', '  write regs[3]=0xBB']) assert.ok(serial.includes(want), 'serial has: ' + want);
console.log('i2c slave OK');
b.stop();
