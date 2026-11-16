// Shared-memory layout between the bench (router side) and one component Worker. Spike version of
// the "mailbox" in docs/component-api.md. All integers little endian, accessed with Atomics.
export const CLOCK = { MODE: 0, VIRT_BASE: 1, REAL_BASE: 2, RATE_PPM: 3, PAUSED: 4, STEPPED_NOW: 5 }; // BigInt64 indices
export const MODE_REALTIME = 0n, MODE_STEPPED = 1n;
export const MB = { WAKE: 0, STATE: 1, DL_LO: 2, DL_HI: 3, REQ: 4, KIND: 5, ADDR: 6, WLEN: 7, RLEN: 8, RES: 9,
                    RDONE: 10, HEARTBEAT: 12, PIN_IN: 64 };       // Int32 indices
export const MB_WDATA = 512, MB_RDATA = 768, MB_FIELDS = 1024, MB_BYTES = 2048;   // 32 float64 fields at byte 1024       // byte offsets
export const REQ_I2C = 1;
export const RING_CAP = 2048, REC_WORDS = 8;                         // outbound ring: 32-byte records
export const K = { PIN_MODE: 1, PIN_WRITE: 2, UART: 3, PWM: 4, I2C_SLAVE: 5, I2C_MASTER: 6, UART_BEGIN: 7, PIN_IRQ: 8, OUTPUT: 9 };
export const nowRealUs = () => BigInt(Math.round((performance.timeOrigin + performance.now()) * 1000));
