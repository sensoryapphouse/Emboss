// Browser maths engine: MathML -> braille via MathCAT (WASM), mapped to BRF ASCII.
// UKAAF mode -> UEB (Technical) maths; BANA mode -> Nemeth.
import init, { mathml_to_braille } from '/engine/mathcat/pkg-web/emboss_mathcat.js';
import { unicodeBrailleToBrf } from '/engine/brf-ascii.mjs';

let ready = false;

export async function initMaths() {
  if (ready) return;
  await init();                         // fetches emboss_mathcat_bg.wasm (rules embedded)
  ready = true;
}

export const isMathsReady = () => ready;

// BANA "UEB with Nemeth" code-switch (a Nemeth passage embedded in a UEB/print
// document): opening Nemeth Code indicator ⠸⠩ (dots 4-5-6, dots 1-4-6) then a
// space, the Nemeth braille, a space, then the terminator ⠸⠱ (dots 4-5-6,
// dots 1-5-6). Per the BANA "Nemeth Code within UEB Contexts" guidance. UEB maths
// needs no wrap: MathCAT already emits the UEB grade-1 switch (⠰⠰⠰ … ⠰⠄).
const NEMETH_OPEN = '⠸⠩ ';   // ⠸⠩ + space
const NEMETH_CLOSE = ' ⠸⠱'; // space + ⠸⠱

// ---- Empty MathML (audit E-3) ----
// MathCAT renders an equation with no content as ⠿ (Nemeth) / ⠬ (UEB) — which
// we would then wrap in full code-switch indicators, producing a spurious cell
// group for what is, in print, nothing at all (`<math></math>`, whitespace, or
// an editor's leftover `<math><mrow/></math>`). Detect that case up front and
// return '' — every caller (segmentsToBraille / formatMath) already skips an
// empty result. "Empty" means: after removing comments, processing
// instructions, `annotation`/`annotation-xml` (metadata, never rendered) and
// the pure wrapper tags math / mrow / semantics / mstyle, nothing but
// whitespace remains. A real token element, even an empty `<mi/>`, is still
// content and is left for MathCAT to render.
const XML_NOISE_RE = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
const ANNOTATION_RE = /<(?:\w+:)?annotation(?:-xml)?\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:\w+:)?annotation(?:-xml)?\s*>)/g;
const WRAPPER_TAG_RE = /<\/?(?:\w+:)?(?:math|mrow|semantics|mstyle)\b[^>]*>/g;
export function isEmptyMathML(mathml) {
  if (mathml == null) return true;
  const rest = String(mathml)
    .replace(XML_NOISE_RE, '')
    .replace(ANNOTATION_RE, '')
    .replace(WRAPPER_TAG_RE, '');
  return rest.trim() === '';
}

// ---- MathCAT output clean-up (audit E-1) ----
// MathCAT's Nemeth rules mark the start of every matrix row after the first
// with U+28CD (⣍, dots 1-3-4-7-8) — an 8-dot cell that no 6-dot BRF map can
// represent; brf-ascii.mjs masks it to dots 1-3-4 and an `M` appeared inside
// the matrix. Rows must go on separate braille lines, so the separator becomes
// a newline (dropping the braille blank MathCAT puts before it, which would
// otherwise trail the line); wrapCells / segmentsToBraille already split
// braille on '\n'. The full spatial layout (enlarged brackets down each row)
// is a formatter concern, not done here.
//
// Any OTHER dots-7/8 cell (U+2840–U+28FF) is unexpected — MathCAT uses the
// upper dots only for internal markers — so it is reported once per
// translation, naming the code point(s), and the cell is reduced to its 6-dot
// part rather than silently masked.
const NEMETH_ROW_SEP_RE = /[\u2800 ]*\u28CD[\u2800 ]*/g;   // U+2800 = braille blank
const EIGHT_DOT_RE = /[\u2840-\u28FF]/g;                  // any cell with dot 7 or 8 set
export function cleanMathCatBraille(braille) {
  let s = braille.replace(NEMETH_ROW_SEP_RE, '\n');
  if (EIGHT_DOT_RE.test(s)) {
    const seen = new Set();
    s = s.replace(EIGHT_DOT_RE, (ch) => {
      const cp = ch.codePointAt(0);
      seen.add('U+' + cp.toString(16).toUpperCase());
      return String.fromCharCode(0x2800 + (cp & 0x3f));
    });
    console.warn(`MathCAT emitted unexpected dots-7/8 braille cell(s) ${[...seen].join(', ')}; dots 7/8 stripped for 6-dot output`);
  }
  return s;
}

// Convert a MathML string to BRF-ASCII braille for the given mode/mathCode.
// Returns '' (and warns on the console) when MathCAT cannot translate the
// input: an error marker cell in the braille would be indistinguishable from
// real maths to the reader, whereas callers already skip an empty result.
export function mathmlToBrf(mathml, mode) {
  if (!ready) throw new Error('maths engine not initialised');
  const code = (mode === 'nemeth' || mode === 'bana') ? 'Nemeth' : 'UEB';
  if (isEmptyMathML(mathml)) return '';              // nothing in print → nothing in braille (no ⠿/⠬ wrapper)
  let braille;
  try {
    braille = mathml_to_braille(mathml, code);
  } catch (e) {
    console.warn('MathCAT translation error (equation skipped):', e);
    return '';
  }
  if (typeof braille !== 'string' || braille.startsWith('ERROR:')) {
    console.warn('MathCAT translation failed (equation skipped):', braille);
    return '';
  }
  braille = cleanMathCatBraille(braille);
  if (!braille.trim()) return '';                    // degenerate MathML → nothing (not an empty Nemeth wrapper)
  if (code === 'Nemeth') braille = NEMETH_OPEN + braille + NEMETH_CLOSE;
  return unicodeBrailleToBrf(braille);
}

// Convert a LaTeX string to BRF-ASCII braille for the given mode, via Temml
// (LaTeX -> MathML). Node callers pass their own `temml` (require('temml'));
// browser callers rely on globalThis.temml (vendored, loaded via <script>).
export function latexToBrf(latex, mode, temmlLib) {
  const temml = temmlLib || globalThis.temml;
  if (!temml) throw new Error('temml not available');
  const mathml = temml.renderToString(latex, { throwOnError: false });
  return mathmlToBrf(mathml, mode);
}

// Single entry point for a maths segment/block: { mathml } and/or { latex }.
// PREFER MathML — it's canonical and needs no Temml. The editor and the docx path
// both supply mathml (the editor converts LaTeX→MathML via MathLive), and a segment
// carrying BOTH must NOT take the Temml path: Temml isn't loaded in the editor, so it
// would throw and the equation would be silently dropped by the formatter. Fall back
// to LaTeX (via Temml) only when there is no MathML (e.g. md/txt `$…$` input).
export function mathToBrf(seg, mode) {
  if (!seg) throw new Error('mathToBrf: missing segment');
  if (seg.mathml != null) return mathmlToBrf(seg.mathml, mode);
  if (seg.latex != null) return latexToBrf(seg.latex, mode);
  throw new Error('mathToBrf: segment has neither mathml nor latex');
}
