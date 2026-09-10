// Unicode 6-dot braille -> North-American Braille ASCII (BRF), generated from
// liblouis en-us-brf.dis. Index = 6-dot value (codepoint - 0x2800).
export const BRF64 = " A1B'K2L@CIF/MSP\"E3H9O6R^DJG>NTQ,*5<-U8V.%[$+X!&;:4\\0Z7(_?W]#Y)=";
// Map a Unicode-braille string (MathCAT output) to BRF ASCII. Dots 7/8 masked
// to 6-dot; non-braille chars (spaces etc.) pass through.
export function unicodeBrailleToBrf(s) {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    out += (cp >= 0x2800 && cp <= 0x28ff) ? BRF64[cp & 0x3f] : ch;
  }
  return out;
}

// Inverse: BRF ASCII -> Unicode 6-dot braille (U+2800 + dot value), for *display*
// as actual braille cells (a "braille font" view). Line breaks pass through; any
// char not in the BRF set (e.g. UI annotations) is left as-is.
const BRF_TO_DOTS = (() => { const m = new Map(); for (let i = 0; i < 64; i++) m.set(BRF64[i], i); return m; })();
// Dot bitmask (bit0=dot1 … bit5=dot6) for a BRF ASCII char; null if not a braille
// cell (e.g. a UI annotation). ' ' (blank cell) → 0. Used by the dot renderer.
export function brfCharDots(ch) { const d = BRF_TO_DOTS.get(ch); return d === undefined ? null : d; }
export function brfToUnicodeBraille(s) {
  let out = "";
  for (const ch of s) {
    if (ch === "\r" || ch === "\n" || ch === "\f") { out += ch; continue; }
    const cp = ch.codePointAt(0);
    if (cp >= 0x2800 && cp <= 0x28ff) { out += ch; continue; }
    const dots = BRF_TO_DOTS.get(ch);
    out += dots === undefined ? ' ' : String.fromCharCode(0x2800 + dots);
  }
  return out;
}
