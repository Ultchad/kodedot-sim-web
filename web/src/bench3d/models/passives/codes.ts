/**
 * The markings of passive parts, from their values: the colour bands of a resistor (IEC 60062, four bands), the
 * three-digit code of a small capacitor or a chip resistor, the plain print of an electrolytic. Pure functions.
 */

/** Band colours by index, the standard code (IEC 60062): digits 0..9 black to white, then gold (10) and silver (11). */
export const BAND_COLOURS = ['#1a1817', '#7d4a22', '#d3241c', '#f47a14', '#f4d016', '#259443', '#1f55c6', '#8a45c0', '#8d9298', '#f4f2ec', '#c49a2e', '#bdc2c8'] as const;
export const GOLD = 10;
export const SILVER = 11;

// the result of `twoDigits`, kept here so that asking for a value's digits allocates nothing (models call it from `animate`)
let d1 = 1, d2 = 0, exp = 0;
/** Two significant digits and a power of ten: value = (d1 * 10 + d2) * 10^exp. */
function twoDigits(value: number): void {
  exp = Math.floor(Math.log10(value)) - 1;
  let m = Math.round(value / Math.pow(10, exp));
  if (m >= 100) {
    m = Math.round(m / 10);
    exp++;
  }
  if (m < 10) {
    m *= 10;
    exp--;
  }
  d1 = Math.floor(m / 10);
  d2 = m % 10;
}

/**
 * The four bands of a resistor as one number: band 1 + 16 * band 2 + 256 * multiplier + 4096 * tolerance (indices into
 * BAND_COLOURS). 330 ohm 5 % is orange, orange, brown, gold. Below 10 ohm the multiplier is gold (x0.1) or silver
 * (x0.01). The value is held to what four bands can show: 0.1 ohm to 99 Gohm, two significant digits.
 */
export function resistorBands(ohms: number): number {
  const v = Math.min(99e9, Math.max(0.1, Number.isFinite(ohms) ? ohms : 0.1));
  twoDigits(v);
  const mult = exp >= 0 ? exp : exp === -1 ? GOLD : SILVER;
  return d1 + 16 * d2 + 256 * mult + 4096 * GOLD;
}
export const bandsOf = (code: number): [number, number, number, number] => [code & 15, (code >> 4) & 15, (code >> 8) & 15, (code >> 12) & 15];

/** The three-character code of a chip resistor: 330 -> "331", 4.7 -> "4R7", 10 k -> "103", 0 -> "000". */
export function chipResistorCode(ohms: number): string {
  if (!(ohms >= 0.1)) return '000';
  twoDigits(Math.min(99e6, ohms));
  if (exp === -1) return `${d1}R${d2}`;
  if (exp < -1) return `R${d1}${d2}`;
  return `${d1}${d2}${exp}`;
}

/** The code on a small capacitor, in picofarads: 0.1 uF -> "104", 22 pF -> "22", 4.7 pF -> "4p7", 100 uF -> "107". */
export function capacitorCode(uf: number): string {
  const pf = uf * 1e6;
  if (!(pf >= 1)) return '1';
  twoDigits(pf);
  if (exp === -1) return d2 ? `${d1}p${d2}` : `${d1}`;
  if (exp === 0) return `${d1}${d2}`;
  return `${d1}${d2}${Math.min(9, exp)}`;
}

/** The capacitance as printed on an electrolytic's sleeve: "100µF", "4.7µF", "2200µF". */
export function microfarads(uf: number): string {
  const v = uf >= 100 ? Math.round(uf) : Math.round(uf * 10) / 10;
  return `${v}µF`;
}
