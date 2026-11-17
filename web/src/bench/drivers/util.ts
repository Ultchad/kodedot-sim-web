/** "04:A2-3B 91" or "04A23B91" -> bytes; null when it is not hex. */
export function parseHexBytes(s: string): number[] | null {
  const parts = s
    .trim()
    .split(/[:\s-]+/)
    .filter(Boolean)
    .flatMap((x) => (x.length > 2 ? (x.match(/.{1,2}/g) ?? []) : [x]));
  if (!parts.length || !parts.every((p) => /^[0-9a-fA-F]{1,2}$/.test(p))) return null;
  return parts.map((p) => parseInt(p, 16));
}

export const hexBytes = (b: ArrayLike<number>, sep = ':'): string => Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(sep);

/** `n` random bytes as upper-case hex, `lead` fixed first bytes. */
export function randomHex(n: number, lead: number[] = [], rnd: () => number = Math.random): string {
  const out = [...lead];
  while (out.length < n) out.push(Math.floor(rnd() * 256));
  return hexBytes(out);
}

/** A hex string of exactly `len` bytes, normalised to "AA:BB:..", or throws. */
export function needBytes(s: string, len: number | number[], what: string): string {
  const b = parseHexBytes(s);
  const ok = Array.isArray(len) ? len : [len];
  if (!b || !ok.includes(b.length)) throw new Error(`${what}: ${ok.join(' or ')} bytes of hex`);
  return hexBytes(b);
}

/** The number printed on an EM4100 fob: its 32-bit part, ten digits. */
export function printedNumber(id: string): string | null {
  const b = parseHexBytes(id);
  if (!b || b.length !== 5) return null;
  return String(((b[1] << 24) | (b[2] << 16) | (b[3] << 8) | b[4]) >>> 0).padStart(10, '0');
}
