// Unit tests of the fake kdrv_ir itself (ir_fake.c): its page-side exports and the rules it shares with the real driver, called
// directly on the module. The firmware above it is the real AO_Ir (which arms the receiver by itself once up).
import { bootIr, check, done, sleep, needRadio } from "./bench.mjs";

const a = await bootIr("ir_api");
needRadio(a, "fake");
const M = a.M, st = () => a.ir.state();
const put = (arr) => { const p = M._malloc(arr.length * 2); new Uint16Array(M.HEAPU8.buffer, p, arr.length).set(arr); return p; };
const inject = (arr, hz = 38000) => { const p = put(arr); const rc = M._ir_rx_inject(p, arr.length / 2, hz); M._free(p); return rc; };
await a.waitArmed();

check(a.ir.config().link && a.ir.config().rxFitted && a.ir.config().restHigh && !a.ir.config().echo && a.ir.config().agcUs === 0, "defaults: link up, receiver fitted, output rests high, no echo, no stretch", a.ir.config());
check(M._ir_get(99) === -1 && M._ir_get(-1) === -1, "ir_get with a bad key answers -1");
M._ir_set(99, 1); M._ir_set(-1, 1);
check(JSON.stringify(a.ir.config()) === JSON.stringify({ link: true, rxDeaf: false, txDark: false, rxFitted: true, restHigh: true, echo: false, agcUs: 0 }), "ir_set with a bad key changes nothing");

check(inject([]) === -5 && M._ir_rx_inject(0, 4, 38000) === -5, "an empty or null train is -5");
check(inject([560, 560], 20000) === -3 && inject([560, 560], 60000) === -3, "carriers outside 36..40 kHz are -3");
check(inject([560, 560, 560, 0], 36000) === 1, "36 kHz is inside the band; delivered (1)");
await sleep(200);
check(st().captures === 1, "one capture stored", st());
// one capture per arming: until the owner re-arms, the next is lost
const lost = inject([560, 560, 560, 560]);
check(lost === 0 || lost === 1, "a second train right after is delivered only if AO_Ir re-armed in time, else lost (0)", lost);
a.ir.configure({ rxFitted: false });
check(inject([560, 560]) === -2, "receiver not fitted: -2");
a.ir.configure({ rxFitted: true, rxDeaf: true });
check(inject([560, 560]) === -2, "receiver deaf: -2");
a.ir.configure({ rxDeaf: false, link: false });
check(inject([560, 560]) === -1, "link down: -1");
a.ir.configure({ link: true });
check(st().dropped.carrier === 2 && st().dropped.deaf === 2 && st().dropped.link === 1, "every refusal is counted by cause", st().dropped);

// transmit side: zero mark is 1 us, zero space is the longest the RMT expresses (32767)
a.ir.reset();
const ev0 = a.events.length;
await a.txRaw([0, 0, 500, 700, 0, 0], 38000);
const tx = await a.waitEvent((e) => e.type === "tx", 3000, ev0);
check(tx.n === 3 && tx.carrier === 38000, "txraw of 6 durations is 3 symbols", tx);
const hdr = M._malloc(24), sym = M._malloc(4 * 256);
check(M._ir_tx_pop(hdr, sym) === 0, "the glue already drained the queue: ir_tx_pop answers 0");
M._free(hdr); M._free(sym);
check(a.ir.state().sends === 1, "one send counted", a.ir.state());
const d = a.events.filter((e) => e.type === "tx").at(-1);
check(d.durUs === 1 + 32767 + 500 + 700 + 1 + 32767, "zero mark became 1 us and zero space 32767 us (duration sums to 66736 us)", d.durUs);

// blob: too big is refused, a small one is kept
check(M._ir_blob_commit(1 << 20) === -1, "a blob bigger than the region is refused");
check(M._ir_blob_commit(2) === 0 && M._ir_blob_len() === 2, "a small blob is accepted and its length reads back");

check(a.stubLines().filter((l) => /ir_|knec|rmt|radio/i.test(l)).length === 0, "no stub fired for an IR function", a.stubLines().slice(0, 4));
done(a, "fake");
