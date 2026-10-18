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
// as actual braille cells (a "braille font" view). Line breaks pass through; a
// char not in the BRF set (e.g. a UI annotation) becomes an ASCII SPACE — NOT
// left as-is, which is what this comment claimed until 2026-09-26 and is not what
// the code has ever done. The claim had already been copied outwards: brlduet.mjs
// (~line 271) says "brfToUnicodeBraille('d') hands back 'd' unchanged, measured",
// and it did not — it handed back a space. Measure the function, not the comment.
// LOWER-CASE BRF IS ACCEPTED, NOT REFUSED — AND THE FOLD IS ALL 32 CHARACTERS.
// BRF ASCII is defined over 0x20-0x5F only, so a lower-case file is non-standard
// input; but it is not AMBIGUOUS input, and the two liblouis display tables BRF64
// itself was generated from settle what it means. text_nabcc.dis maps `a` (0x61)
// to dots 1 and `A` (0x41) to dots 1-7; ` (0x60) to dots 4 and @ (0x40) to dots
// 4-7; { to 246 against [ to 2467; | to 1256 against \ to 12567; } to 12456
// against ] to 124567; ~ to 45 against ^ to 457. EVERY CASE PAIR DIFFERS BY DOT 7
// ALONE, and en-us-brf.dis — this table's own source — says it "DOES NOT map
// combinations with dots 7 and/or 8". A 6-dot reading therefore collapses each
// pair onto ONE cell, and that cell is the one en-us-brf.dis already gives the
// upper-case twin: nabcc { = 246 = brf [ ; nabcc ~ = 45 = brf ^ . So the fold is
// a table lookup in both directions, not an inference. en-us-brf.dis also names
// the case outright: "if your device supports 8-dot braille, or you want to
// convert a lowercase braille file, you may want to use text_nabcc.dis table
// instead of this one" — a lower-case braille file is a recognised, convertible
// thing, not a malformed one. Decoding one to blanks was the only wrong answer.
//
// WHY ARITHMETIC AND NOT ch.toUpperCase(). The fold is the whole of 0x60-0x7E:
// a-z AND the five symbols ` { | } ~ . JavaScript's toUpperCase() does not touch
// those five, so every "upper-case it first" caller still blanked them. RNIB's
// 2009 Music Braille Course writes { | } ~ and its own sign dictionary gives | as
// dots 1-2-5-6 — which is the cell BRF spells \ , exactly as the fold predicts.
//
// WHAT DOES NOT CHANGE: a byte with no BRF meaning at all (tab, 0x7F, 0x80+)
// still declines exactly as before — ' ' from brfToUnicodeBraille, null from
// brfCharDots. And unicodeBrailleToBrf still EMITS canonical upper case: lower
// case is accepted on the way in, never produced on the way out.
const BRF_TO_DOTS = (() => {
  const m = new Map();
  for (let i = 0; i < 64; i++) m.set(BRF64[i], i);
  // 0x60-0x7E fold onto 0x40-0x5E; every target is inside BRF64, which is exactly
  // the contiguous range 0x20-0x5F with no gaps, so no lookup here can be undefined.
  for (let cp = 0x60; cp <= 0x7e; cp++) m.set(String.fromCharCode(cp), m.get(String.fromCharCode(cp - 0x20)));
  return m;
})();
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
