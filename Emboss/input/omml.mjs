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
const OPERATOR_CHARS = new Set([
  '+', '-', '−', '=', '<', '>', '≤', '≥', '≠',
  '×', '÷', '*', '/', '⁄',
  '→', '↔', '⇒', '⇔',
  '±', '∓',
  '∈', '∉', '∩', '∪', '⊂', '⊃', '⊆', '⊇',
  '(', ')', '[', ']', '{', '}', '|',
  ',', ';',
  '·', '∘',
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

// ---------- element dispatch ----------

// Convert the children of `el` (in document order) to a MathML string,
// concatenating sibling results. This is the main recursive entry used
// wherever OMML allows a sequence of math-run-like children (m:e content,
// m:num content, etc).
function convertChildren(el) {
  const parts = [];
  for (const child of el.children) {
    const s = convertElement(child);
    if (s) parts.push(s);
  }
  return parts.join('');
}

function convertElement(el) {
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
      // Unknown element: don't lose text — recurse into children.
      return convertChildren(el);
  }
}

// ---------- m:r (run) ----------
function convertRun(el) {
  const texts = childrenByName(el, 't');
  if (!texts.length) return '';
  let s = '';
  for (const t of texts) s += textToMathML(t.textContent);
  return s;
}

// ---------- m:f (fraction) ----------
function convertFraction(el) {
  const num = firstChildByName(el, 'num');
  const den = firstChildByName(el, 'den');
  const numMml = num ? wrapIfMultiple([convertChildren(num)]) || mrow('') : mrow('');
  const denMml = den ? wrapIfMultiple([convertChildren(den)]) || mrow('') : mrow('');
  return `<mfrac>${ensureSingleNode(numMml)}${ensureSingleNode(denMml)}</mfrac>`;
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
const DELIM_DEFAULTS = { beg: '(', end: ')' };

function delimChar(propsEl, attrName, fallback) {
  if (!propsEl) return fallback;
  const child = firstChildByName(propsEl, attrName);
  if (!child) return fallback;
  const val = child.getAttribute ? child.getAttribute('m:val') || child.getAttribute('val') : null;
  if (val === '' ) return ''; // explicit empty delimiter (no visible char)
  return val || fallback;
}

function convertDelimiter(el) {
  const dPr = firstChildByName(el, 'dPr');
  const beg = delimChar(dPr, 'begChr', DELIM_DEFAULTS.beg);
  const end = delimChar(dPr, 'endChr', DELIM_DEFAULTS.end);
  const parts = [];
  if (beg !== '') parts.push(`<mo>${escapeXml(beg)}</mo>`);
  const bodies = childrenByName(el, 'e');
  if (bodies.length > 1) {
    // Multiple m:e children inside one m:d are separated (e.g. by a comma) —
    // represent them as a comma-separated sequence, matching common usage.
    const sepPr = dPr ? firstChildByName(dPr, 'sepChr') : null;
    const sep = sepPr ? (sepPr.getAttribute('m:val') || sepPr.getAttribute('val') || ',') : ',';
    bodies.forEach((b, i) => {
      if (i > 0) parts.push(`<mo>${escapeXml(sep)}</mo>`);
      parts.push(convertChildren(b));
    });
  } else if (bodies.length === 1) {
    parts.push(convertChildren(bodies[0]));
  }
  if (end !== '') parts.push(`<mo>${escapeXml(end)}</mo>`);
  return mrow(parts.join(''));
}

// ---------- m:nary (n-ary operator: sum, integral, product, ...) ----------
function convertNary(el) {
  const naryPr = firstChildByName(el, 'naryPr');
  const chrEl = naryPr ? firstChildByName(naryPr, 'chr') : null;
  const opChar = (chrEl && (chrEl.getAttribute('m:val') || chrEl.getAttribute('val'))) || '∑';
  const sub = firstChildByName(el, 'sub');
  const sup = firstChildByName(el, 'sup');
  const base = baseGroup(el);
  const op = `<mo>${escapeXml(opChar)}</mo>`;

  const hasSub = sub && sub.children.length;
  const hasSup = sup && sup.children.length;

  let opWithScripts;
  if (hasSub && hasSup) {
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
function convertFunc(el) {
  const fName = firstChildByName(el, 'fName');
  const body = firstChildByName(el, 'e');
  const nameMml = fName ? convertChildren(fName) : '';
  const bodyMml = body ? convertChildren(body) : '';
  return mrow(nameMml + bodyMml);
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

// ---------- m:acc (accent, e.g. hat/bar over a base) ----------
function convertAccent(el) {
  const accPr = firstChildByName(el, 'accPr');
  const chrEl = accPr ? firstChildByName(accPr, 'chr') : null;
  const accChar = (chrEl && (chrEl.getAttribute('m:val') || chrEl.getAttribute('val'))) || '̂';
  const base = baseGroup(el);
  return `<mover accent="true">${base}<mo>${escapeXml(accChar)}</mo></mover>`;
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
  const base = baseGroup(el);
  const lim = firstChildByName(el, 'lim');
  const limMml = wrapAsSingleNode(lim ? convertChildren(lim) : '');
  return el.localName === 'limLow'
    ? `<munder>${base}${limMml}</munder>`
    : `<mover>${base}${limMml}</mover>`;
}

// ---------- public entry point ----------

// Convert an m:oMath or m:oMathPara Element into a full MathML string:
// "<math display="block">...</math>".
export function ommlElementToMathML(el) {
  if (!el) return '<math display="block"></math>';
  const inner = convertChildren(el);
  return `<math display="block">${inner}</math>`;
}

export default ommlElementToMathML;
