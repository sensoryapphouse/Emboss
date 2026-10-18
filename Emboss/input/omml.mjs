// OMML -> MathML converter.
// Converts Office Math Markup Language (the `m:` namespace,
// http://schemas.openxmlformats.org/officeDocument/2006/math) equation
// elements, as found in word/document.xml inside a .docx package, into
// standard presentation MathML that a downstream engine (MathCAT) can
// transcribe to braille (Nemeth / UEB Maths).
//
// The walker operates on a generic DOM Element interface (localName,
// children, textContent, getElementsByTagNameNS, getAttribute) so it works
// against both the browser's native DOMParser output and any other
// DOM implementation exposing the same shape (e.g. @xmldom/xmldom in Node).
//
// Exports:
//   ommlElementToMathML(el) -> string   "<math ...>...</math>"

export const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

// ---------- small helpers ----------

// Namespace-agnostic direct-children-by-localName lookup (avoids relying on
// getElementsByTagNameNS's namespace matching for every caller, and avoids
// descending past nested oMath boundaries by accident for simple lookups).
function childrenByName(el, name) {
  const out = [];
  if (!el || !el.children) return out;
  for (const c of el.children) {
    if (c.localName === name) out.push(c);
  }
  return out;
}
function firstChildByName(el, name) {
  return childrenByName(el, name)[0] || null;
}

// The m:val attribute of an OMML property element (<m:chr m:val="x"/>, <m:grow m:val="0"/>), or null
// when the element or the attribute is absent. An EMPTY value ("") is a real value (an explicit
// "no bracket") and is returned as ''. Reads it by namespace first so a document that binds the math
// namespace to another prefix (or as the default namespace) works too.
function valOf(el) {
  if (!el) return null;
  if (el.hasAttributeNS && el.hasAttributeNS(MATH_NS, 'val')) return el.getAttributeNS(MATH_NS, 'val');
  if (el.hasAttribute && el.hasAttribute('m:val')) return el.getAttribute('m:val');
  if (el.hasAttribute && el.hasAttribute('val')) return el.getAttribute('val');
  return null;
}
// An on/off property (CT_OnOff): present with no value, or "1"/"true"/"on" = on; "0"/"false"/"off" = off.
function isOff(el) {
  const v = valOf(el);
  return v !== null && /^(0|false|off)$/i.test(v.trim());
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mrow(inner) {
  return `<mrow>${inner}</mrow>`;
}

// Wrap in <mrow> only when there's more than one "token" of content, so we
// don't clutter simple single-element output with redundant wrappers.
function wrapIfMultiple(parts) {
  const joined = parts.join('');
  if (parts.length <= 1) return joined;
  return mrow(joined);
}

// Characters that should render as <mo> when found in run text.
// Degree (°) and the prime family (′ ″ ‴) were tagged <mi> before this fix (fix 5 of the
// DOCX-equation-import work): a bare <mi> "just a letter/identifier" reading let MathCAT
// insert its usual identifier spacing/typeform around them, which is wrong for a postfix
// mark that must bind tight to what precedes it (90° stays "90°", f′ stays "f′" — see
// omml.test.mjs's degree/prime cases for the braille before/after).
const OPERATOR_CHARS = new Set([
  '+', '-', '−', '=', '<', '>', '≤', '≥', '≠',
  '×', '÷', '*', '/', '⁄',
  '→', '↔', '⇒', '⇔',
  '±', '∓',
  '∈', '∉', '∩', '∪', '⊂', '⊃', '⊆', '⊇',
  '(', ')', '[', ']', '{', '}', '|',
  ',', ';',
  '·', '∘',
  '°', '′', '″', '‴',
]);

// Split run text into a sensible token stream: runs of digits (incl. a
// decimal point between digits) -> <mn>; runs of letters -> <mi> (a run of
// multiple letters, e.g. "sin", is still wrapped as one <mi> per token,
// matching how word processors usually intend function-ish identifier runs
// that aren't already m:func); individual operator/punctuation chars -> <mo>;
// everything else (rare, e.g. other symbols) -> <mi> per character.
function textToMathML(text) {
  if (!text) return '';
  const tokens = [];
  const re = /(\d+(?:\.\d+)?)|([A-Za-zͰ-Ͽ℀-⅏]+)|(\s+)|(.)/gu;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, num, alpha, ws, other] = m;
    if (ws) continue; // whitespace in math runs carries no braille-relevant meaning here
    if (num) tokens.push(`<mn>${escapeXml(num)}</mn>`);
    else if (alpha) {
      if (alpha.length === 1) tokens.push(`<mi>${escapeXml(alpha)}</mi>`);
      else tokens.push(`<mi>${escapeXml(alpha)}</mi>`); // multi-letter identifier (e.g. "sin") as one <mi>
    } else if (other) {
      const ch = other === '−' ? '-' : other;
      if (OPERATOR_CHARS.has(other) || OPERATOR_CHARS.has(ch)) tokens.push(`<mo>${escapeXml(other)}</mo>`);
      else tokens.push(`<mi>${escapeXml(other)}</mi>`);
    }
  }
  return tokens.join('');
}

// ---------- function names (A84) ----------
// Word writes a function (sin, cos, log, lim ...) as <m:func><m:fName>name</m:fName><m:e>argument</m:e></m:func>,
// and the name run is normally in "Normal Text" style (m:sty p). That style is how this file reads an ordinary
// English word, so the name used to come out as <mtext>cos</mtext> (LaTeX \text{cos}, and braille that treated
// it as a word, with no function spacing). A function name is now <mi>name</mi> followed by U+2061
// (FUNCTION APPLICATION), the standard MathML form: MathCAT spaces a function name from the letters round it
// (UEB Guidelines for Technical Material 9.3; Nemeth: a space after the abbreviation), and the print view
// gets \cos / \operatorname{name}.
const APPLY_FUNCTION = '\u2061';

// Functions that take their limit below them (lim, max, min ...). Word writes a bare <m:limLow> round one of
// these (no m:func) when the equation is lim x->0 with nothing after it; the name is a function all the same.
const LIMIT_FUNCTION_NAMES = new Set(['lim', 'liminf', 'limsup', 'max', 'min', 'sup', 'inf', 'Pr', 'gcd', 'det']);

// The function name held by a list of m:r runs (Word sometimes splits one name over several runs), or null when
// they hold anything but letters.
function functionNameOfRuns(runs) {
  if (!runs.length) return null;
  let name = '';
  for (const r of runs) {
    if (r.localName !== 'r') return null;
    for (const t of childrenByName(r, 't')) name += t.textContent || '';
  }
  name = name.replace(/\s+/g, '');
  return /^\p{L}+$/u.test(name) ? name : null;
}
const childList = (el) => (el && el.children ? Array.from(el.children) : []);

// The scripted/limit constructs (m:sSub, m:sSup, m:sSubSup, m:limLow, m:limUpp) whose BASE is a function name,
// found inside an m:fName: log_2, sin^2, lim below x->0. baseGroup() reads this.
const functionNameBases = new Set();

// ---------- element dispatch ----------

// Convert the children of `el` (in document order) to a MathML string,
// concatenating sibling results. This is the main recursive entry used
// wherever OMML allows a sequence of math-run-like children (m:e content,
// m:num content, etc).
function convertChildren(el) {
  const parts = [];
  let prev = null;                                   // the last sibling that produced anything
  for (const child of el.children) {
    const s = convertElement(child);
    if (s) {
      if (child.localName === 'func' && endsWithScriptedLetter(prev)) parts.push(FUNCTION_SPACE);
      parts.push(s);
      prev = child;
    }
  }
  return parts.join('');
}

// "a_n cos x": a function name directly after a subscript or superscript that ends in a Latin letter. UEB
// Guidelines for Technical Material 9.3.3 leave a space before a function name that follows a letter, and
// MathCAT does that for a plain letter (<mi>) but not when the letter is inside a script (<msub>), so the
// subscript n ran straight into "cos" ("a_ncos"). An explicit space (<mspace>, at least 0.25em, the smallest
// MathCAT keeps as a braille space) makes the gap; a Nemeth reading ignores it (Nemeth joins a letter and
// a following function abbreviation).
const FUNCTION_SPACE = '<mspace width="0.3em"/>';
// The same space for an equation from any reader (Markdown/LaTeX gives <mo>cos</mo>, HTML/ODT/the editor's maths field <mi>cos</mi>),
// added to the MathML just before MathCAT in UEB (engine/maths.mjs, format/node-maths-helper.mjs): a function name straight after a
// <msub>/<msup>/<msubsup> whose script ends in a Latin letter. Never added twice (an existing space stands between them already).
const UEB_FUNCTION_NAMES = 'arcsin|arccos|arctan|arccot|arcsec|arccsc|sinh|cosh|tanh|coth|sech|csch|sin|cos|tan|cot|sec|csc|liminf|limsup|lim|log|ln|lg|exp|max|min|sup|inf|det|gcd|deg|dim|ker|hom|arg|sgn|Pr';
const UEB_FUNCTION_SPACE_RE = new RegExp(`([A-Za-z]\\s*<\\/(?:\\w+:)?m[ion]>(?:\\s*<\\/(?:\\w+:)?mrow>)*\\s*<\\/(?:\\w+:)?m(?:sub|sup|subsup)>)(\\s*)(<(?:\\w+:)?m[io]\\b[^>]*>\\s*(?:${UEB_FUNCTION_NAMES})\\s*<\\/(?:\\w+:)?m[io]>)`, 'g');
export function uebFunctionSpaceInMathML(mathml) {
  if (typeof mathml !== 'string' || !/<\/(?:\w+:)?m(?:sub|sup|subsup)>/.test(mathml)) return mathml;
  return mathml.replace(UEB_FUNCTION_SPACE_RE, `$1$2${FUNCTION_SPACE}$3`);
}
function endsWithScriptedLetter(prev) {
  if (!prev) return false;
  const last = { sSub: 'sub', sSup: 'sup', sSubSup: 'sup' }[prev.localName];
  if (!last) return false;
  const script = firstChildByName(prev, last);
  return !!script && /[A-Za-z]\s*$/.test(script.textContent || '');
}

// Nesting depth (A89 step 4; Paul, 2 Oct 2026): an equation nested thousands deep (hostile) overflowed the stack here. Real equations nest a
// few dozen levels at most; an element deeper than OMML_MAX_DEPTH is not converted piece by piece: its text is kept as the plain tokens
// (digits, letters, operators) of that text, in order. Below the limit nothing changes.
export const OMML_MAX_DEPTH = 50;
let ommlDepth = 0;
function plainTextOf(el) {                           // the text under an element, in order, without recursion
  let text = '';
  const stack = [el];
  while (stack.length) {
    const n = stack.pop();
    if (n.nodeType === 3) { text += n.nodeValue; continue; }
    const kids = n.childNodes || [];
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
  }
  return text;
}
function convertElement(el) {
  if (ommlDepth >= OMML_MAX_DEPTH) return textToMathML(plainTextOf(el));
  ommlDepth++;
  try { return convertElementBody(el); } finally { ommlDepth--; }
}
function convertElementBody(el) {
  switch (el.localName) {
    case 'oMath':
    case 'oMathPara':
      return convertChildren(el);

    case 'r':
      return convertRun(el);

    case 'f':
      return convertFraction(el);

    case 'sSup':
      return convertSup(el);

    case 'sSub':
      return convertSub(el);

    case 'sSubSup':
      return convertSubSup(el);

    case 'sPre':
      return convertPre(el);

    case 'rad':
      return convertRadical(el);

    case 'd':
      return convertDelimiter(el);

    case 'nary':
      return convertNary(el);

    case 'func':
      return convertFunc(el);

    case 'eqArr':
      return convertEqArr(el);

    case 'phant':
      return `<mphantom>${convertChildren(el)}</mphantom>`;

    case 'e':
    case 'num':
    case 'den':
    case 'sub':
    case 'sup':
    case 'deg':
    case 'fName':
      // Content wrappers: caller (fraction/sup/sub/etc) consumes these
      // directly via firstChildByName, so if we ever land here (defensive)
      // just recurse into children.
      return convertChildren(el);

    case 'm':
      return convertMatrix(el);

    case 'acc':
      return convertAccent(el);

    case 'bar':
      return convertBar(el);

    case 'groupChr':
      return convertGroupChr(el);

    case 'limLow':
    case 'limUpp':
      return convertLimit(el);

    case 'box':
    case 'borderBox':
      return wrapIfMultiple(el.children.length ? [convertChildren(el)] : []);

    // Property elements (m:fPr, m:sSupPr, m:radPr, m:dPr, m:naryPr, m:funcPr,
    // m:ctrlPr, m:rPr, ...) carry formatting metadata, not math content.
    // They are consumed explicitly by their owning converter where needed
    // (e.g. m:dPr for delimiter chars) and otherwise skipped here.
    default:
      if (el.localName && /Pr$/.test(el.localName)) return '';
      // m:t (run text) is normally read directly by convertRun via childrenByName(el,'t'),
      // never through this switch — but a malformed/hand-edited document could put one
      // somewhere convertChildren reaches directly (e.g. a stray m:t that isn't inside an
      // m:r). convertChildren only looks at *element* children (el.children, not text
      // nodes), so without this case a stray m:t's own text content would be silently lost
      // rather than kept, same principle as the "unknown element" fallback just below.
      if (el.localName === 't') return textToMathML(el.textContent);
      // Unknown element (an OMML construct this converter doesn't specifically know about,
      // e.g. a future schema addition): don't lose its content. Recurse into children when
      // it has any (so content nested inside is still converted); when it has none but
      // carries text directly (no sub-elements at all — the same shape as m:t), fall back
      // to tokenizing that text instead of returning '' and dropping it.
      if (el.children && el.children.length) return convertChildren(el);
      const raw = el.textContent || '';
      return raw.trim() ? textToMathML(raw) : '';
  }
}

// True when a run's m:rPr marks it as Word's "Normal Text" (m:sty val="p") or the older
// m:nor toggle — an author-chosen "this is NOT a math variable" flag, used for an ordinary
// English word/phrase inside an equation ("if", "and", "is even") or a unit name, as
// opposed to the default italic single-letter-variable reading every other run gets.
function isPlainTextRun(el) {
  const rPr = firstChildByName(el, 'rPr');
  if (!rPr) return false;
  if (firstChildByName(rPr, 'nor')) return true;
  const sty = firstChildByName(rPr, 'sty');
  const val = sty && (sty.getAttribute('m:val') || sty.getAttribute('val'));
  return val === 'p';
}

// A run of plain (upright, non-math-variable) letters. textToMathML's ordinary tokenizer
// groups a run of letters into one <mi> per run already, but it always drops whitespace
// (see the `if (ws) continue` below) — harmless for maths notation, where nothing is ever
// deliberately spaced apart, but wrong for a plain-text word: adjacent plain runs and their
// neighbours end up mashed together with no word boundary ("if" next to "x" -> "ifx"; see
// AGENTS.md's DOCX-equation-import task, fix 2).
//
// A run trimming down to a single letter (the commonest real case: an upright "d" in a
// calculus "dx", or a one-letter unit like "m") becomes a normal-variant math token
// (<mi mathvariant="normal">) so it keeps binding tightly to whatever follows, exactly like
// an ordinary italic <mi> would ("dx" stays "dx", not "d x"). Anything longer becomes one
// <mtext> token, with the run's own literal spaces upgraded to non-breaking spaces (U+00A0):
// MathCAT (like MathML renderers generally) treats a plain U+0020 inside <mtext> as
// collapsible/insignificant and drops it — even with xml:space="preserve" — so a plain
// space leaves the words run together again in the braille; U+00A0 survives unchanged
// (verified against both UEB and Nemeth output — see omml.test.mjs).
//
// PROVISIONAL / open question for Paul: a single-letter unit ("5 m") only keeps a space
// before it if Word's own run text already carries one (this function trims before testing
// length, so a leading/trailing space on a true single letter is not preserved) — a
// two-letter-or-longer unit ("kg", "cm") is unambiguous and always gets its word-spacing.
function plainTextToMathML(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  if (/^[A-Za-zͰ-Ͽ℀-⅏]$/.test(trimmed)) return `<mi mathvariant="normal">${escapeXml(trimmed)}</mi>`;
  if (/^[A-Za-zͰ-Ͽ℀-⅏\s]+$/.test(text)) return `<mtext>${escapeXml(String(text).replace(/ /g, ' '))}</mtext>`;
  // Mixed content (letters plus digits/operators/punctuation, e.g. a plain run of ">0"):
  // no reliable "word" to protect here, so fall back to the ordinary per-token conversion
  // rather than guessing what it means.
  return textToMathML(text);
}

// ---------- m:r (run) ----------
function convertRun(el) {
  const texts = childrenByName(el, 't');
  if (!texts.length) return '';
  const plain = isPlainTextRun(el);
  let s = '';
  for (const t of texts) s += plain ? plainTextToMathML(t.textContent) : textToMathML(t.textContent);
  return s;
}

// ---------- m:f (fraction) ----------
// m:fPr/m:type: "bar" (the default — a normal horizontal-bar fraction), "noBar" (no bar at
// all, e.g. a binomial coefficient written as a fraction), "lin" (linear/inline "n/k", the
// same layout as when a fraction is typed with the autocorrect / built up from "n/k") and
// "skw" (a skewed/diagonal bar). Ignored entirely before this fix — every fraction came out
// as a plain <mfrac>, so e.g. a binomial coefficient's noBar fraction got a visible bar it
// should not have (BANA/UEB maths brailles a barred and a bar-less fraction differently —
// see omml.test.mjs for the binomial-coefficient before/after).
function convertFraction(el) {
  const fPr = firstChildByName(el, 'fPr');
  const typeEl = fPr ? firstChildByName(fPr, 'type') : null;
  const type = (typeEl && (typeEl.getAttribute('m:val') || typeEl.getAttribute('val'))) || 'bar';
  const num = firstChildByName(el, 'num');
  const den = firstChildByName(el, 'den');
  const numMml = num ? wrapAsSingleNode(convertChildren(num)) : mrow('');
  const denMml = den ? wrapAsSingleNode(convertChildren(den)) : mrow('');
  if (type === 'lin') {
    // Linear format: "num / den" as a plain row, not a stacked fraction at all.
    return mrow(`${numMml}<mo>/</mo>${denMml}`);
  }
  if (type === 'noBar') return `<mfrac linethickness="0">${numMml}${denMml}</mfrac>`;
  if (type === 'skw') return `<mfrac bevelled="true">${numMml}${denMml}</mfrac>`;
  return `<mfrac>${numMml}${denMml}</mfrac>`;
}

// mfrac/msup/msub/etc require exactly two (or three) child *nodes*, not an
// arbitrary run of siblings. If content produced more than one top-level
// node's worth of markup, wrap it in mrow; if empty, emit an empty mrow.
function ensureSingleNode(mmlFragment) {
  if (!mmlFragment) return mrow('');
  return mmlFragment;
}

function baseGroup(container) {
  const e = firstChildByName(container, 'e');
  if (e && functionNameBases.has(container)) {
    const name = functionNameOfRuns(childList(e));
    if (name) return `<mi>${escapeXml(name)}</mi>`;
  }
  const inner = e ? convertChildren(e) : '';
  return wrapAsSingleNode(inner);
}

function wrapAsSingleNode(inner) {
  if (!inner) return mrow('');
  // Count top-level tags to decide whether wrapping is needed.
  const topLevelCount = countTopLevelNodes(inner);
  return topLevelCount <= 1 ? inner : mrow(inner);
}

// Rough top-level element counter for already-built MathML fragments: counts
// opening tags that are not nested inside another tag opened within this
// fragment. Good enough for our own generated, well-formed fragments.
function countTopLevelNodes(xml) {
  let depth = 0;
  let count = 0;
  const re = /<\/?[a-zA-Z][^>]*>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[0];
    const isClose = /^<\//.test(tag);
    const isSelfClose = /\/>$/.test(tag);
    if (isSelfClose) {
      if (depth === 0) count++;
      continue;
    }
    if (!isClose) {
      if (depth === 0) count++;
      depth++;
    } else {
      depth--;
    }
  }
  return count;
}

// ---------- m:sSup / m:sSub / m:sSubSup ----------
function convertSup(el) {
  const base = baseGroup(el);
  const sup = firstChildByName(el, 'sup');
  const supMml = wrapAsSingleNode(sup ? convertChildren(sup) : '');
  return `<msup>${base}${supMml}</msup>`;
}

function convertSub(el) {
  const base = baseGroup(el);
  const sub = firstChildByName(el, 'sub');
  const subMml = wrapAsSingleNode(sub ? convertChildren(sub) : '');
  return `<msub>${base}${subMml}</msub>`;
}

function convertSubSup(el) {
  const base = baseGroup(el);
  const sub = firstChildByName(el, 'sub');
  const sup = firstChildByName(el, 'sup');
  const subMml = wrapAsSingleNode(sub ? convertChildren(sub) : '');
  const supMml = wrapAsSingleNode(sup ? convertChildren(sup) : '');
  return `<msubsup>${base}${subMml}${supMml}</msubsup>`;
}

function convertPre(el) {
  const base = baseGroup(el);
  const sub = firstChildByName(el, 'sub');
  const sup = firstChildByName(el, 'sup');
  const subMml = wrapAsSingleNode(sub ? convertChildren(sub) : '');
  const supMml = wrapAsSingleNode(sup ? convertChildren(sup) : '');
  return `<mmultiscripts>${base}<mprescripts/>${subMml}${supMml}</mmultiscripts>`;
}

// ---------- m:rad (radical) ----------
function convertRadical(el) {
  const deg = firstChildByName(el, 'deg');
  const base = baseGroup(el);
  const degInner = deg ? convertChildren(deg) : '';
  const degText = deg ? deg.textContent.trim() : '';
  if (!deg || !degText) {
    return `<msqrt>${base}</msqrt>`;
  }
  const degMml = wrapAsSingleNode(degInner);
  return `<mroot>${base}${degMml}</mroot>`;
}

// ---------- m:d (delimiter) ----------
// <m:d> is Word's bracket construct: m:dPr/m:begChr and m:endChr choose the two brackets ("(" and ")" when
// absent, and an EMPTY value means no bracket on that side: {x with nothing closing it), m:sepChr the
// separator between several m:e arguments (the OOXML default is "|", not a comma; an empty value means none),
// and m:grow whether the brackets stretch to the height of what they enclose (on unless m:grow is 0).
// m:shp (centred / match: how a separator is sized against the content) changes nothing we can show or braille.
//
// Output is an <mrow> of  <mo fence="true" stretchy="...">(</mo> arguments <mo fence="true" ...>)</mo>: the
// fence flag is what lets the print view write \left( ... \right) instead of small brackets (mathml-to-latex.mjs
// reads it). A missing bracket is an EMPTY <mo fence="true"> so the LaTeX side still knows the group was
// fenced ("\left." / "\right."); MathCAT ignores it. The braille is unchanged by the flags.
const DELIM_DEFAULTS = { beg: '(', end: ')', sep: '|' };

function delimChar(propsEl, name, fallback) {
  const child = propsEl ? firstChildByName(propsEl, name) : null;
  const val = valOf(child);
  return val === null ? fallback : val;              // '' (explicit "no bracket") is kept as ''
}

function convertDelimiter(el) {
  const dPr = firstChildByName(el, 'dPr');
  const beg = delimChar(dPr, 'begChr', DELIM_DEFAULTS.beg);
  const end = delimChar(dPr, 'endChr', DELIM_DEFAULTS.end);
  const sep = delimChar(dPr, 'sepChr', DELIM_DEFAULTS.sep);
  const stretchy = !(dPr && isOff(firstChildByName(dPr, 'grow')));
  const fence = (ch) => `<mo fence="true" stretchy="${stretchy}">${escapeXml(ch)}</mo>`;
  const parts = [fence(beg)];
  const bodies = childrenByName(el, 'e');
  bodies.forEach((b, i) => {
    if (i > 0 && sep !== '') parts.push(`<mo separator="true">${escapeXml(sep)}</mo>`);
    parts.push(convertChildren(b));
  });
  parts.push(fence(end));
  return mrow(parts.join(''));
}

// ---------- m:nary (n-ary operator: sum, integral, product, ...) ----------
// m:naryPr/m:limLoc: "undOvr" stacks the limits directly above/below the operator (∑ with
// i=1 under it and n over it); "subSup" sets them to the side, like an ordinary sub/
// superscript. Per the OOXML math schema the attribute's own default (when m:limLoc is
// absent) is "undOvr" for every n-ary operator — but Word's own default DISPLAY for an
// integral (∫ and the multiple/contour variants) is side limits, "subSup": a stacked
// integral sign is the unusual case, not what typing/inserting a plain ∫ produces. An
// explicit m:limLoc (either value) always wins over both defaults.
const INTEGRAL_CHARS = new Set(['∫', '∬', '∭', '∮', '∯', '∰', '∱', '∲', '∳']);
function convertNary(el) {
  const naryPr = firstChildByName(el, 'naryPr');
  const chrEl = naryPr ? firstChildByName(naryPr, 'chr') : null;
  const opChar = (chrEl && (chrEl.getAttribute('m:val') || chrEl.getAttribute('val'))) || '∑';
  const limLocEl = naryPr ? firstChildByName(naryPr, 'limLoc') : null;
  const limLocVal = limLocEl && (limLocEl.getAttribute('m:val') || limLocEl.getAttribute('val'));
  const limLoc = limLocVal || (INTEGRAL_CHARS.has(opChar) ? 'subSup' : 'undOvr');
  const sub = firstChildByName(el, 'sub');
  const sup = firstChildByName(el, 'sup');
  const base = baseGroup(el);
  const op = `<mo>${escapeXml(opChar)}</mo>`;

  const hasSub = sub && sub.children.length;
  const hasSup = sup && sup.children.length;

  let opWithScripts;
  if (limLoc === 'subSup') {
    if (hasSub && hasSup) {
      opWithScripts = `<msubsup>${op}${wrapAsSingleNode(convertChildren(sub))}${wrapAsSingleNode(convertChildren(sup))}</msubsup>`;
    } else if (hasSub) {
      opWithScripts = `<msub>${op}${wrapAsSingleNode(convertChildren(sub))}</msub>`;
    } else if (hasSup) {
      opWithScripts = `<msup>${op}${wrapAsSingleNode(convertChildren(sup))}</msup>`;
    } else {
      opWithScripts = op;
    }
  } else if (hasSub && hasSup) {
    opWithScripts = `<munderover>${op}${wrapAsSingleNode(convertChildren(sub))}${wrapAsSingleNode(convertChildren(sup))}</munderover>`;
  } else if (hasSub) {
    opWithScripts = `<munder>${op}${wrapAsSingleNode(convertChildren(sub))}</munder>`;
  } else if (hasSup) {
    opWithScripts = `<mover>${op}${wrapAsSingleNode(convertChildren(sup))}</mover>`;
  } else {
    opWithScripts = op;
  }
  return mrow(opWithScripts + base);
}

// ---------- m:func (named function application, e.g. sin(x)) ----------
// <m:func><m:fName>name</m:fName><m:e>argument</m:e></m:func> becomes
//   <mrow> name U+2061 argument </mrow>
// the standard MathML function application (three children, which is the shape MathCAT's UEB spacing rule
// looks for). The name is an <mi>: a plain-letter name (sin, cos, log, lim, or one split over several runs) is
// read as the function name whatever its style; a name with a script or limit (log_2, sin^2, lim below x->0)
// keeps the function name as the base of the script. An empty argument leaves just the name.
function convertFuncName(fName) {
  const kids = childList(fName);
  const name = functionNameOfRuns(kids);
  if (name) return `<mi>${escapeXml(name)}</mi>`;
  const bases = kids.filter((k) => /^(sSub|sSup|sSubSup|limLow|limUpp)$/.test(k.localName));
  bases.forEach((k) => functionNameBases.add(k));
  try {
    return wrapAsSingleNode(convertChildren(fName));
  } finally {
    bases.forEach((k) => functionNameBases.delete(k));
  }
}

function convertFunc(el) {
  const fName = firstChildByName(el, 'fName');
  const body = firstChildByName(el, 'e');
  const nameMml = fName ? convertFuncName(fName) : '';
  const bodyMml = body ? convertChildren(body) : '';
  if (!nameMml) return bodyMml;
  if (!bodyMml) return nameMml;
  return mrow(`${nameMml}<mo>${APPLY_FUNCTION}</mo>${wrapAsSingleNode(bodyMml)}`);
}

// ---------- m:m (matrix) ----------
function convertMatrix(el) {
  const rows = childrenByName(el, 'mr');
  const rowsMml = rows.map((row) => {
    const cells = childrenByName(row, 'e');
    const cellsMml = cells.map((c) => `<mtd>${convertChildren(c)}</mtd>`).join('');
    return `<mtr>${cellsMml}</mtr>`;
  }).join('');
  return `<mtable>${rowsMml}</mtable>`;
}

// ---------- m:eqArr (equation array) ----------
function convertEqArr(el) {
  const rows = childrenByName(el, 'e');
  const rowsMml = rows.map((e) => `<mtr><mtd>${convertChildren(e)}</mtd></mtr>`).join('');
  return `<mtable>${rowsMml}</mtable>`;
}

// ---------- m:acc (accent, e.g. hat/bar/vector over a base) ----------
// Word stores the accent as a COMBINING character (U+0302 hat, U+20D7 vector arrow ...). A combining
// character is meant to be drawn on the letter before it; alone, as the second child of <mover>, MathCAT has
// no braille for most of them and spells the code point out in hex ("0020D7"). So it is replaced by the
// SPACING character MathML uses for the same accent, which MathCAT knows: vector arrow -> U+2192 (rightwards
// arrow), hat -> "^", tilde -> "~", bar -> macron, dot -> U+02D9. Double and triple dot become two / three
// full stops: MathCAT brailles those as two / three dots in both codes, but has no Nemeth entry for the
// diaeresis U+00A8. An accent already given as some other spacing character is kept. Accents MathCAT has no
// braille for even in spacing form (caron, breve, ring; acute and grave in UEB) still become the spacing
// character, so a later MathCAT release that knows them needs no change here.
const COMBINING_TO_SPACING = {
  '\u0300': '`', '\u0301': '\u00B4', '\u0302': '^', '\u0303': '~',       // grave, acute, hat, tilde
  '\u0304': '\u00AF', '\u0305': '\u00AF', '\u033F': '\u00AF',            // macron, overline, double overline -> macron
  '\u0306': '\u02D8', '\u0307': '\u02D9', '\u0308': '..', '\u00A8': '..', // breve, dot, double dot
  '\u030A': '\u02DA', '\u030C': '\u02C7',                                 // ring, caron
  '\u20D0': '\u21BC', '\u20D1': '\u21C0',                                 // left / right harpoon
  '\u20D6': '\u2190', '\u20D7': '\u2192', '\u20E1': '\u2194',             // left arrow, vector arrow, left-right arrow
  '\u20DB': '...',                                                        // triple dot
};
// Import fix list #44: the same mapping for MathML from any reader (LibreOffice's ODT equations, MathML in HTML/EPUB/DTBook,
// MathType): an <mo> holding only a combining accent (as a character or a numeric reference) becomes its spacing form. Applied to
// every equation just before MathCAT (engine/maths.mjs mathmlToBrf, format/node-maths-helper.mjs). A combining mark inside a token
// together with its letter is left alone.
export function spacingAccentsInMathML(mathml) {
  if (typeof mathml !== 'string' || !/<(?:\w+:)?mo\b/.test(mathml)) return mathml;
  return mathml.replace(/(<(?:\w+:)?mo\b[^>]*>)\s*([^<]*?)\s*(<\/(?:\w+:)?mo>)/g, (m, open, body, close) => {
    const ch = body.replace(/^&#x([0-9a-f]+);$/i, (x, h) => String.fromCodePoint(parseInt(h, 16))).replace(/^&#(\d+);$/, (x, d) => String.fromCodePoint(Number(d)));
    return [...ch].length === 1 && Object.prototype.hasOwnProperty.call(COMBINING_TO_SPACING, ch) ? `${open}${escapeXml(COMBINING_TO_SPACING[ch])}${close}` : m;
  });
}
function convertAccent(el) {
  const accPr = firstChildByName(el, 'accPr');
  const val = accPr ? valOf(firstChildByName(accPr, 'chr')) : null;
  const accChar = val || '\u0302';                   // no m:chr (or an empty one): Word's default is a hat
  const spacing = COMBINING_TO_SPACING[accChar] || accChar;
  const base = baseGroup(el);
  return `<mover accent="true">${base}<mo>${escapeXml(spacing)}</mo></mover>`;
}

// ---------- m:bar (overbar/underbar) ----------
function convertBar(el) {
  const barPr = firstChildByName(el, 'barPr');
  const posEl = barPr ? firstChildByName(barPr, 'pos') : null;
  const pos = (posEl && (posEl.getAttribute('m:val') || posEl.getAttribute('val'))) || 'top';
  const base = baseGroup(el);
  return pos === 'bot'
    ? `<munder accent="true">${base}<mo>&#175;</mo></munder>`
    : `<mover accent="true">${base}<mo>&#175;</mo></mover>`;
}

// ---------- m:groupChr (grouping character above/below, e.g. overbrace) ----------
function convertGroupChr(el) {
  const gPr = firstChildByName(el, 'groupChrPr');
  const chrEl = gPr ? firstChildByName(gPr, 'chr') : null;
  const ch = (chrEl && (chrEl.getAttribute('m:val') || chrEl.getAttribute('val'))) || '⏞';
  const posEl = gPr ? firstChildByName(gPr, 'pos') : null;
  const pos = (posEl && (posEl.getAttribute('m:val') || posEl.getAttribute('val'))) || 'top';
  const base = baseGroup(el);
  return pos === 'bot'
    ? `<munder>${base}<mo>${escapeXml(ch)}</mo></munder>`
    : `<mover>${base}<mo>${escapeXml(ch)}</mo></mover>`;
}

// ---------- m:limLow / m:limUpp (limit expressions, e.g. lim_{x->0}) ----------
function convertLimit(el) {
  // A bare lim/max/min (no m:func round it) is a function name all the same.
  const eEl = firstChildByName(el, 'e');
  const limName = eEl ? functionNameOfRuns(childList(eEl)) : null;
  const base = limName && LIMIT_FUNCTION_NAMES.has(limName) ? `<mi>${escapeXml(limName)}</mi>` : baseGroup(el);
  const lim = firstChildByName(el, 'lim');
  const limMml = wrapAsSingleNode(lim ? convertChildren(lim) : '');
  return el.localName === 'limLow'
    ? `<munder>${base}${limMml}</munder>`
    : `<mover>${base}${limMml}</mover>`;
}

// ---------- protecting MathCAT from nesting it cannot take (A89 step 4) ----------
// MathCAT (third-party, engine/mathcat) takes time that grows about 4 times with every level of a script whose BASE is itself a script:
// x^2^2^2 ... as <msup><msup><msup>... measured 7 ms at 10 levels, 0.5 s at 18, 2.4 s at 20, 40 s at 24 and over two minutes at 40 (UEB and
// Nemeth alike; a script's exponent nested the other way, an <mrow>, fraction, root, <mover>/<munder> or <munderover> nest linearly, 100 deep
// in a few ms). So every equation is checked just before MathCAT (engine/maths.mjs, format/node-maths-helper.mjs): a script (msub, msup,
// msubsup) that is the MATHML_MAX_SCRIPT_BASE_CHAIN-th-plus-one script in a chain of bases (counted through <mrow>s and the like) is
// replaced by the plain tokens of its text (its numbers, letters and operators in order, no script structure), and so is anything nested
// more than MATHML_MAX_DEPTH elements deep. An equation within the limits - every real one - is returned unchanged, the same string.
export const MATHML_MAX_SCRIPT_BASE_CHAIN = 8;
export const MATHML_MAX_DEPTH = 200;
const MATHML_SCRIPTS = new Set(['msub', 'msup', 'msubsup']);
const MATHML_TAG_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
function decodeMathMLText(t) {
  return t.replace(/&#x([0-9a-f]+);/gi, (m, h) => { const c = parseInt(h, 16); return c > 0 && c <= 0x10FFFF ? String.fromCodePoint(c) : ''; })
    .replace(/&#(\d+);/g, (m, d) => { const c = Number(d); return c > 0 && c <= 0x10FFFF ? String.fromCodePoint(c) : ''; })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
export function limitMathMLNesting(mathml) {
  if (typeof mathml !== 'string' || mathml.length < 40) return mathml;
  // a cheap look first: no script, and fewer than MATHML_MAX_DEPTH tags in all, cannot exceed a limit
  let tags = 0;
  for (let at = mathml.indexOf('<'); at >= 0; at = mathml.indexOf('<', at + 1)) { tags++; }
  if (tags < MATHML_MAX_SCRIPT_BASE_CHAIN * 2 + 2) return mathml;
  MATHML_TAG_RE.lastIndex = 0;
  const stack = [];                                   // open elements: { name, chain (script ancestors in base position), index (children so far), start }
  const cuts = [];                                    // [start, end) of every subtree to flatten (outermost only)
  let m;
  while ((m = MATHML_TAG_RE.exec(mathml)) !== null) {
    if (m[2] === undefined) continue;                 // a comment, CDATA or processing instruction
    const closing = m[1] === '/', selfClosing = m[4] === '/';
    const name = m[2].replace(/^.*:/, '');
    if (closing) {
      const top = stack.pop();
      if (!top || top.name !== name) return mathml;   // not well-formed: leave it to MathCAT, as before
      if (top.cut) cuts.push([top.start, MATHML_TAG_RE.lastIndex]);
      continue;
    }
    const parent = stack[stack.length - 1] || null;
    let chain = 0;
    if (parent) {
      const isFirst = parent.index === 0;
      chain = MATHML_SCRIPTS.has(parent.name) ? (isFirst ? parent.chain + 1 : 0) : parent.chain;
      parent.index++;
    }
    const insideCut = parent && (parent.cut || parent.inCut);
    const el = { name, chain, index: 0, start: m.index, cut: false, inCut: !!insideCut };
    if (!insideCut && ((MATHML_SCRIPTS.has(name) && chain >= MATHML_MAX_SCRIPT_BASE_CHAIN) || stack.length >= MATHML_MAX_DEPTH)) el.cut = true;
    if (selfClosing) { if (el.cut) cuts.push([el.start, MATHML_TAG_RE.lastIndex]); continue; }
    stack.push(el);
  }
  if (stack.length || !cuts.length) return mathml;
  let out = "", at = 0;
    for (const [a, b] of cuts) {
      out += mathml.slice(at, a);
      const text = decodeMathMLText(mathml.slice(a, b).replace(/<!--[\s\S]*?-->|<[^>]*>/g, ' '));
      const toks = textToMathML(text);
      out += toks ? `<mrow>${toks}</mrow>` : '';
      at = b;
    }
  return out + mathml.slice(at);
}

// ---------- public entry point ----------

// Convert an m:oMath or m:oMathPara Element into a full MathML string:
// "<math display="block">...</math>".
export function ommlElementToMathML(el) {
  if (!el) return '<math display="block"></math>';
  const inner = convertChildren(el);
  return `<math display="block">${inner}</math>`;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Equations that hold only their TeX source (A89; Paul, 2 Oct 2026)
//
// Some MathML (the generated "Large Academic Textbook" corpus has 11,000 of it) is only
//   <math><semantics><annotation encoding="application/x-tex">TEX</annotation></semantics></math>
// with no presentation MathML at all: the maths engine finds nothing to braille in it (isEmptyMathML, engine/maths.mjs, ignores
// annotations), and a save wrote the TeX as the equation's text so the reopened file brailled the TeX as ordinary text. Paul's
// decision: convert the TeX to MathML with Temml, the converter Emboss already uses for $...$ maths, and braille that through MathCAT like
// any other equation. TeX Temml cannot convert is kept as an <merror> equation: the formatter brailles it as a transcriber's note "equation
// could not be read" and raises a transcription warning (format/document.mjs, kind math-unreadable), like a picture with no description.
// Either way the TeX annotation stays in the MathML beside the result, so a save writes both and a reopen reads the same equation again.
// texOnlyMathToMathML runs when a reader builds a math segment (input/parse.mjs).
// ---------------------------------------------------------------------------------------------------------------------------
const TEX_ANNOTATION_RE = /<(?:[\w.-]+:)?annotation\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?annotation\s*>/g;
const MATH_COMMENT_RE = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
const MATH_WRAPPER_RE = /<\/?(?:[\w.-]+:)?(?:math|mrow|semantics|mstyle)\b[^>]*>/g;
const decodeMathText = (t) => String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
const encodeMathText = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let nodeTemml;                                                    // the Temml of Node (tests, scripts); undefined until looked for, null when there is none
/** Temml (LaTeX -> MathML): the page's own copy in a browser (vendor/temml.min.js, loaded by every page that reads documents), the package in Node. */
function getTemml() {
  if (globalThis.temml && typeof globalThis.temml.renderToString === 'function') return globalThis.temml;
  if (nodeTemml === undefined) {
    nodeTemml = null;
    try {
      const mod = globalThis.process && typeof globalThis.process.getBuiltinModule === 'function' ? globalThis.process.getBuiltinModule('module') : null;
      if (mod) nodeTemml = mod.createRequire(import.meta.url)('temml');
    } catch { nodeTemml = null; }
  }
  return nodeTemml;
}
const texConversions = new Map();                                 // TeX -> presentation MathML (the inside of Temml's <math>), or null when Temml refuses it
/** The presentation MathML (the content of <math>) for a TeX string, or null when Temml cannot convert it (or is not there). */
export function texToPresentationMathML(tex) {
  const key = String(tex);
  if (texConversions.has(key)) return texConversions.get(key);
  let out = null;
  const temml = getTemml();
  if (temml) {
    try {
      const m = /^<math\b[^>]*>([\s\S]*)<\/math>$/.exec(String(temml.renderToString(key, { throwOnError: true })).trim());   // throwOnError: an unknown command or a broken group is an error, not a red word in the equation
      if (m && m[1].trim()) out = m[1].trim();
    } catch { out = null; }
  }
  if (texConversions.size > 5000) texConversions.clear();
  texConversions.set(key, out);
  return out;
}

/**
 * `mathml` (a string) with a TeX annotation and no presentation MathML of its own becomes real MathML (Temml's, with the annotation kept), or an
 * <merror> equation when the TeX cannot be converted. Anything else (presentation MathML of its own, even only the TeX typed out as an <mtext>)
 * is not touched: null for "nothing to do".
 * @param {string} mathml
 * @param {string} [latex] the TeX annotation's text when the caller already has it (decoded); read from the annotation otherwise
 * @returns {string|null}
 */
export function texOnlyMathToMathML(mathml, latex) {
  if (typeof mathml !== 'string' || mathml.indexOf('annotation') < 0) return null;
  let tex = null;
  TEX_ANNOTATION_RE.lastIndex = 0;
  for (let m; (m = TEX_ANNOTATION_RE.exec(mathml));) {
    if (/encoding\s*=\s*["'][^"']*tex/i.test(m[1])) { tex = decodeMathText(m[2]).trim(); break; }
  }
  if (!tex) return null;
  const rest = mathml.replace(MATH_COMMENT_RE, '').replace(TEX_ANNOTATION_RE, '').replace(/<(?:[\w.-]+:)?annotation-xml\b[\s\S]*?<\/(?:[\w.-]+:)?annotation-xml\s*>/g, '').replace(MATH_WRAPPER_RE, '').trim();
  if (rest) return null;                                          // presentation content of its own: real maths, left as it is
  const root = /<((?:[\w.-]+:)?math)\b([^>]*)>/.exec(mathml);
  const keep = root ? root[2].replace(/\s+xmlns(?::[\w.-]+)?\s*=\s*(["'])[^"']*\1/g, '').replace(/\/\s*$/, '') : '';
  const presentation = texToPresentationMathML(latex && String(latex).trim() === tex ? latex : tex);
  const body = presentation
    ? (/^<mrow\b/.test(presentation) && /<\/mrow>$/.test(presentation) ? presentation : `<mrow>${presentation}</mrow>`)
    : `<merror><mtext>${encodeMathText(tex)}</mtext></merror>`;
  return `<math${keep} xmlns="http://www.w3.org/1998/Math/MathML"><semantics>${body}<annotation encoding="application/x-tex">${encodeMathText(tex)}</annotation></semantics></math>`;
}

// A89 (random-action testing): MathML as the maths engine gets it from the editor can be a bare fragment (no <math> root) with
// loose text where MathML admits none (an empty slot's "?" directly inside an <mfrac>); MathCAT rejects it and the equation was
// missing from the braille, while a save (nimas-export.mjs normalizeMathMl) wraps it and puts the text in <mtext>, so it appeared
// after reopening. The same two repairs, before MathCAT sees it; well-formed MathML comes back unchanged.
const MATH_TOKEN_ELEMENTS = new Set(['mi', 'mn', 'mo', 'mtext', 'ms', 'annotation', 'annotation-xml', 'ci', 'cn', 'csymbol', 'mglyph']);
export function tidyMathMLForBraille(mathml) {
  if (typeof mathml !== 'string') return mathml;
  let m = mathml.trim();
  if (!m.startsWith('<')) return mathml;
  if (!/^(?:<\?[^>]*\?>\s*)?<(?:[\w.-]+:)?math\b/.test(m)) m = `<math>${m}</math>`;
  const stack = [];
  return m.replace(/(<[^>]+>)|([^<]+)/g, (all, tag, text) => {
    if (tag) {
      const t = /^<(\/?)(?:[\w.-]+:)?([\w.-]+)[^>]*?(\/?)>$/.exec(tag);
      if (t && !tag.startsWith('<!') && !tag.startsWith('<?')) { if (t[1]) stack.pop(); else if (!t[3]) stack.push(t[2]); }
      return tag;
    }
    const parent = stack[stack.length - 1];
    if (!parent || MATH_TOKEN_ELEMENTS.has(parent) || !text.trim()) return text;
    return text.replace(/^(\s*)([\s\S]*?)(\s*)$/, '$1<mtext>$2</mtext>$3');
  });
}

// HTML named characters in MathML (A89, random-action testing): the editor's TeX converter (MathLive) writes some symbols as
// &ne; &alpha; &times; &infin; &nbsp; …, which XML does not know — a saved file kept them and the reopened equation brailled "&ne;"
// as text. They become the characters themselves; XML's own five (&amp; &lt; &gt; &quot; &apos;) and numeric references stay.
const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho', '', 'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega'];
const HTML_NAMED_CHARS = (() => {
  const m = Object.create(null);
  GREEK.forEach((n, i) => { if (!n) return; m[n] = String.fromCodePoint(0x391 + i); m[n.toLowerCase()] = String.fromCodePoint(0x3B1 + i); });
  Object.assign(m, {
    sigmaf: '\u03C2', thetasym: '\u03D1', upsih: '\u03D2', piv: '\u03D6', epsiv: '\u03F5', phiv: '\u03D5',
    nbsp: '\u00A0', ne: '\u2260', times: '\u00D7', divide: '\u00F7', infin: '\u221E', le: '\u2264', ge: '\u2265', plusmn: '\u00B1',
    minus: '\u2212', middot: '\u00B7', sdot: '\u22C5', deg: '\u00B0', prime: '\u2032', Prime: '\u2033', sum: '\u2211', prod: '\u220F',
    int: '\u222B', radic: '\u221A', part: '\u2202', nabla: '\u2207', isin: '\u2208', notin: '\u2209', ni: '\u220B', sub: '\u2282',
    sup: '\u2283', sube: '\u2286', supe: '\u2287', cap: '\u2229', cup: '\u222A', and: '\u2227', or: '\u2228', not: '\u00AC',
    forall: '\u2200', exist: '\u2203', empty: '\u2205', rarr: '\u2192', larr: '\u2190', harr: '\u2194', uarr: '\u2191', darr: '\u2193',
    rArr: '\u21D2', lArr: '\u21D0', hArr: '\u21D4', asymp: '\u2248', cong: '\u2245', equiv: '\u2261', prop: '\u221D', ang: '\u2220',
    perp: '\u22A5', there4: '\u2234', sim: '\u223C', hellip: '\u2026', micro: '\u00B5', lceil: '\u2308', rceil: '\u2309',
    lfloor: '\u230A', rfloor: '\u230B', lang: '\u27E8', rang: '\u27E9', oplus: '\u2295', otimes: '\u2297', loz: '\u25CA',
    frac12: '\u00BD', frac14: '\u00BC', frac34: '\u00BE', sup2: '\u00B2', sup3: '\u00B3', sup1: '\u00B9', ndash: '\u2013', mdash: '\u2014',
    ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', InvisibleTimes: '\u2062', it: '\u2062', ApplyFunction: '\u2061', af: '\u2061',
  });
  return m;
})();
export function htmlNamedCharsToText(s) {
  if (typeof s !== 'string' || s.indexOf('&') < 0) return s;
  return s.replace(/&([A-Za-z][A-Za-z0-9]*);/g, (all, name) => (/^(amp|lt|gt|quot|apos)$/.test(name) ? all : (HTML_NAMED_CHARS[name] ?? all)));
}

export default ommlElementToMathML;

// ---- Empty MathML, and a rejected equation (shared by engine/maths.mjs, the browser wrapper, and format/node-maths-helper.mjs, the Node one) ----
// Audit batch S2b, item 11 (15 Oct 2026): "nothing" and "rejected" are two different results. An equation with no content in print
// (`<math></math>`, whitespace, an editor's leftover `<math><mrow/></math>`) is nothing in braille. An equation that has content but
// that MathCAT refuses (a fraction with one child, MathML that is not well-formed) used to come back as '' too, and the formatter, which
// skips an empty result, dropped it with no word to anyone. A rejected equation is now a thrown error marked `mathRejected`, which the
// formatter (format/document.mjs) turns into the transcriber's note "Equation could not be read" and a transcription warning.
//
// MathCAT renders an equation with no content as ⠿ (Nemeth) / ⠬ (UEB), which would then be wrapped in full code-switch indicators for
// what is, in print, nothing at all. "Empty" means: after removing comments, processing instructions, `annotation`/`annotation-xml`
// (metadata, never rendered) and the pure wrapper tags math / mrow / semantics / mstyle, nothing but whitespace remains. A real token
// element, even an empty `<mi/>`, is still content and is left for MathCAT to render. (Moved here from engine/maths.mjs, which re-exports it.)
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
// The failure for a non-empty equation MathCAT rejected. `detail` is MathCAT's own words (its first line is kept for the warning).
export function mathRejectedError(detail) {
  const first = String(detail ?? '').replace(/^ERROR:\s*/, '').split('\n')[0].trim().slice(0, 200);
  const e = new Error(`MathCAT could not translate the equation${first ? `: ${first}` : ''}`);
  e.mathRejected = true;
  e.detail = first;
  return e;
}
