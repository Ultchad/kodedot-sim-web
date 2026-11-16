// MQTT, second half: the broker's semantics at the packet level (QoS 0/1, retained, wills, persistent sessions, wildcards, auth, protocol level),
// and the task-side kode_mqtt_* calls of kode.h (through the net_api test app) against the router's in-page broker.
import { bootRadio, check, done, sleep } from "../radio/bench.mjs";

const a = await bootRadio("net_api");
const { Broker, encodePacket, decoder, topicMatches } = a.glue.net;
const T = { CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4, SUBSCRIBE: 8, SUBACK: 9, UNSUBSCRIBE: 10, UNSUBACK: 11, PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14 };

// ---- packet level, no firmware involved: a client is a recorder ----
const client = (b) => { const got = []; let closed = false; const h = b.accept({ send: (p) => got.push(p), close: () => { closed = true; } }); return { got, h, isClosed: () => closed }; };
const conn = (c, o = {}) => c.h.packet({ type: T.CONNECT, level: 4, clientId: "c", clean: true, keepalive: 60, ...o });
{
  const b = new Broker();
  const c = client(b); conn(c);
  check(c.got[0]?.type === T.CONNACK && c.got[0].code === 0 && c.got[0].sessionPresent === false, "broker: CONNECT is accepted, no session present on a clean start", c.got[0]);
  const bad = client(b); conn(bad, { level: 5 }); 
  check(bad.got[0]?.code === 1, "broker: an unsupported protocol level is refused (code 1)", bad.got[0]);
  const noid = client(b); conn(noid, { clientId: "", clean: false });
  check(noid.got[0]?.code === 2, "broker: an empty client id with a persistent session is refused (code 2)", noid.got[0]);

  c.h.packet({ type: T.SUBSCRIBE, id: 7, subs: [{ filter: "a/+/c", qos: 1 }, { filter: "x/#", qos: 0 }] });
  check(c.got[1]?.type === T.SUBACK && c.got[1].id === 7 && c.got[1].codes.join() === "1,0", "broker: SUBACK echoes the id and the granted QoS", c.got[1]);
  const p = client(b); conn(p, { clientId: "p" });
  p.h.packet({ type: T.PUBLISH, topic: "a/b/c", payload: Uint8Array.from([1, 2]), qos: 1, id: 9, retain: false });
  check(p.got.some((x) => x.type === T.PUBACK && x.id === 9), "broker: a QoS 1 publish is acknowledged to the publisher", p.got);
  const d = c.got.find((x) => x.type === T.PUBLISH);
  check(d && d.topic === "a/b/c" && d.qos === 1 && d.id > 0, "broker: '+' wildcard matches and the delivery keeps QoS 1 with a packet id", d);
  p.h.packet({ type: T.PUBLISH, topic: "x/y/z/w", payload: Uint8Array.from([3]), qos: 0, id: 0 });
  check(c.got.filter((x) => x.type === T.PUBLISH).length === 2, "broker: '#' matches several levels", c.got.length);
  p.h.packet({ type: T.PUBLISH, topic: "a/b/d", payload: Uint8Array.from([4]), qos: 0, id: 0 });
  check(c.got.filter((x) => x.type === T.PUBLISH).length === 2, "broker: a topic that matches no filter is not delivered");
  p.h.packet({ type: T.PUBLISH, topic: "a/b/c", payload: Uint8Array.from([5]), qos: 2 > 1 ? 1 : 0, id: 3 });
  c.h.packet({ type: T.UNSUBSCRIBE, id: 8, filters: ["a/+/c"] });
  check(c.got.at(-1)?.type === T.UNSUBACK && c.got.at(-1).id === 8, "broker: UNSUBACK");
  const n = c.got.length; p.h.packet({ type: T.PUBLISH, topic: "a/b/c", payload: Uint8Array.from([6]), qos: 0, id: 0 });
  check(c.got.length === n, "broker: after UNSUBSCRIBE nothing more arrives on that filter");
  c.h.packet({ type: T.PINGREQ });
  check(c.got.at(-1)?.type === T.PINGRESP, "broker: PINGREQ is answered");

  // retained
  p.h.packet({ type: T.PUBLISH, topic: "r/1", payload: Uint8Array.from([65]), qos: 0, id: 0, retain: true });
  const late = client(b); conn(late, { clientId: "late" });
  late.h.packet({ type: T.SUBSCRIBE, id: 1, subs: [{ filter: "r/#", qos: 0 }] });
  const rp = late.got.find((x) => x.type === T.PUBLISH);
  check(rp && rp.topic === "r/1" && rp.retain === true, "broker: a retained message goes to a late subscriber with the retain flag", rp);
  p.h.packet({ type: T.PUBLISH, topic: "r/1", payload: new Uint8Array(0), qos: 0, id: 0, retain: true });
  check(!b.retained.has("r/1"), "broker: an empty retained payload clears it");

  // will: dropped without DISCONNECT publishes it, a clean DISCONNECT does not
  const sub = client(b); conn(sub, { clientId: "sub" }); sub.h.packet({ type: T.SUBSCRIBE, id: 1, subs: [{ filter: "will/#", qos: 0 }] });
  const w1 = client(b); conn(w1, { clientId: "w1", will: { topic: "will/w1", payload: Uint8Array.from([111]), qos: 0, retain: false } });
  w1.h.closed(false);
  check(sub.got.some((x) => x.type === T.PUBLISH && x.topic === "will/w1"), "broker: a client that vanishes has its will published");
  const w2 = client(b); conn(w2, { clientId: "w2", will: { topic: "will/w2", payload: Uint8Array.from([111]), qos: 0, retain: false } });
  w2.h.packet({ type: T.DISCONNECT }); w2.h.closed(true);
  check(!sub.got.some((x) => x.topic === "will/w2"), "broker: a clean DISCONNECT discards the will");

  // persistent session: subscriptions kept, QoS 1 messages queued while away, sessionPresent on return
  const s1 = client(b); conn(s1, { clientId: "keep", clean: false }); s1.h.packet({ type: T.SUBSCRIBE, id: 1, subs: [{ filter: "q/#", qos: 1 }] });
  s1.h.closed(false);
  p.h.packet({ type: T.PUBLISH, topic: "q/1", payload: Uint8Array.from([81]), qos: 1, id: 5 });
  const s2 = client(b); conn(s2, { clientId: "keep", clean: false });
  check(s2.got[0].sessionPresent === true, "broker: a persistent session is found again (sessionPresent)", s2.got[0]);
  check(s2.got.some((x) => x.type === T.PUBLISH && x.topic === "q/1"), "broker: the QoS 1 message published while away is delivered on return", s2.got);
  const s3 = client(b); conn(s3, { clientId: "keep", clean: true });
  check(s3.got[0].sessionPresent === false, "broker: a clean start throws the old session away");
  // takeover
  const s4 = client(b); conn(s4, { clientId: "keep", clean: true });
  check(s3.isClosed(), "broker: a second connection with the same client id takes the first one over");

  // auth
  const bb = new Broker({ users: { alice: "wonderland" } });
  const x1 = client(bb); conn(x1, { username: "alice", password: "wonderland" });
  const x2 = client(bb); conn(x2, { username: "alice", password: "nope" });
  const x3 = client(bb); conn(x3);
  check(x1.got[0].code === 0 && x2.got[0].code === 4 && x3.got[0].code === 5, "broker: auth: good login 0, bad password 4 (bad credentials), no login 5 (not authorized)", [x1.got[0], x2.got[0], x3.got[0]].map((x) => x.code));

  // codec round trip
  const dec = decoder();
  const pkt = { type: T.PUBLISH, topic: "t/é", payload: Uint8Array.from([1, 2, 3]), qos: 1, retain: true, id: 300 };
  const back = dec(encodePacket(pkt));
  check(back.length === 1 && back[0].topic === "t/é" && back[0].qos === 1 && back[0].retain && back[0].id === 300 && back[0].payload.join() === "1,2,3", "codec: PUBLISH survives encode and decode", back[0]);
  const big = dec(encodePacket({ ...pkt, payload: new Uint8Array(20000).fill(7) }));
  check(back.length === 1 && big[0].payload.length === 20000, "codec: a 20 kB payload (multi-byte remaining length) survives");
  const two = Uint8Array.from([...encodePacket({ type: T.PINGREQ }), ...encodePacket({ type: T.PINGRESP })]);
  const split = decoder(); const r1 = split(two.subarray(0, 3)); const r2 = split(two.subarray(3));
  check(r1.length + r2.length === 2, "codec: packets glued together or cut in the middle of a stream are both handled", [r1.length, r2.length]);
  check(topicMatches("a/+/c", "a/x/c") && !topicMatches("a/+/c", "a/x/y/c") && topicMatches("a/#", "a") && !topicMatches("a/b", "a"), "topic filter: +, # and exact");
}

// ---- the task-side calls, against the router's in-page broker (no mapping, internet off) ----
const home = a.wifi.addRouter({ ssid: "Home", password: "hunter22", channel: 6, signal: -40, internet: false });
await a.cmd("radio_up");
await a.waitLog(/KODE services v3/, 10000);
const res = async (kind, arg, ms = 12000) => {
  const m = a.mark(); const r = await a.cmd(arg === undefined ? `function name="${kind}"` : `function name="${kind}" arg=${JSON.stringify(arg)}`, 5000);
  const x = await a.waitLog(new RegExp(`RES ${kind} ([^\\n]*)`), ms, m);
  return { ok: r.ok, line: x[1], kv: Object.fromEntries([...x[1].matchAll(/(\w+)=(\[[^\]]*\]|\S+)/g)].map((k) => [k[1], k[2]])) };
};
let r = await res("mconn", "mqtt://broker.test:1883");
check(r.kv.ok === "0", "kode_mqtt_connect with no network fails, with the SDK's reason", r.line);
await a.cmd('wifi_join ssid="Home" pass="hunter22"', 20000);
await a.waitLog(/joined 'Home' as/, 10000);
await sleep(300);
r = await res("mconn", "mqtt://broker.test:1883", 20000);
check(r.kv.ok === "1", "kode_mqtt_connect reaches the router's in-page broker", r.line);
const ib = a.net.brokerOf(home);
check(ib && ib.clients().length === 1, "the in-page broker has the task's client", ib?.clients());
r = await res("mup"); check(r.line.trim() === "1", "kode_mqtt_is_connected: yes", r.line);
r = await res("msub", "sensors/+/temp"); check(r.kv.ok === "1", "kode_mqtt_subscribe", r.line);
check([...ib.sessions.values()].some((s) => s.subs.has("sensors/+/temp")), "the broker holds the subscription");
// kode_event_wait only sees messages that arrive while it waits: start the wait, then publish from the bench
let m = a.mark(); a.type('function name="mwait" arg="6000"'); await sleep(400); ib.publish("sensors/kitchen/temp", "21.5");
{ const x = await a.waitLog(/RES mwait ([^\n]*)/, 8000, m); r = { line: x[1], kv: Object.fromEntries([...x[1].matchAll(/(\w+)=(\[[^\]]*\]|\S+)/g)].map((k) => [k[1], k[2]])) }; }
check(r.kv.ok === "1" && r.kv.topic === "sensors/kitchen/temp" && /21\.5/.test(r.line), "kode_event_wait(mqtt_message) returns the topic and the text", r.line);
r = await res("mpub", "out/hello|world");
const lastPub = ib.published.at(-1);
check(r.kv.ok === "1" && lastPub.topic === "out/hello" && Buffer.from(lastPub.payload).toString() === "world", "kode_mqtt_publish reaches the broker with topic and payload", lastPub && { t: lastPub.topic, p: Buffer.from(lastPub.payload).toString() });
r = await res("munsub", "sensors/+/temp"); check(r.kv.ok === "1", "kode_mqtt_unsubscribe", r.line);
ib.publish("sensors/kitchen/temp", "22");
r = await res("mwait", "700"); check(r.kv.ok === "0", "after unsubscribe no message arrives (kode_event_wait times out)", r.line);
r = await res("mdisc"); check(r.kv.ok === "1", "kode_mqtt_disconnect", r.line);
await sleep(300);
check(ib.clients().length === 0, "the broker sees the client leave");
r = await res("mup"); check(r.line.trim() === "0", "kode_mqtt_is_connected: no", r.line);
r = await res("mpub", "out/late|x"); check(r.kv.ok === "0", "publish after disconnect fails", r.line);

done(a, "mqtt api and broker");
