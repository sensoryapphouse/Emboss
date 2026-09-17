// DTBook / NIMAS XML Serializer for Emboss.
// Provides pure, deterministic serialization from the internal Document Model AST
// ({ title, blocks, metadata }) into standard ANSI/NISO Z39.86-2005 (DTBook 2005-3) XML.

import { cellSegments, cellPlainText } from '../format/cell-markup.mjs';

const TF_ITALIC = 1;
const TF_UNDERLINE = 2;
const TF_BOLD = 4;

/**
 * Coerces an arbitrary string into an XML NCName (`[A-Za-z_][\w.-]*`) so it is
 * usable as a DTD `ID` attribute value. Illegal characters become `_`; a
 * leading digit/`-`/`.` gets an `id_` prefix; empty input yields `id`.
 * @param {string} value
 * @returns {string}
 */
export function toNCName(value) {
  let v = String(value ?? '').trim().replace(/[^A-Za-z0-9_.\-]/g, '_');
  if (!v) return 'id';
  if (!/^[A-Za-z_]/.test(v)) v = `id_${v}`;
  return v;
}

/**
 * Deterministic ID allocator to guarantee uniqueness of XML ID attributes.
 * All ids handed out (and all ids registered) are sanitised to NCNames.
 */
export class IdAllocator {
  constructor() {
    this.usedIds = new Set();
  }
  /** Reserve an id that already exists in pass-through markup (e.g. MathML). */
  register(id) {
    if (id == null || id === '') return;
    this.usedIds.add(toNCName(id));
  }
  getId(preferred, prefix = 'id') {
    const wanted = preferred ? toNCName(preferred) : '';
    if (wanted && !this.usedIds.has(wanted)) {
      this.usedIds.add(wanted);
      return wanted;
    }
    const base = wanted || toNCName(prefix);
    if (!wanted && !this.usedIds.has(base)) {
      this.usedIds.add(base);
      return base;
    }
    let counter = 1;
    let candidate = `${base}-${counter}`;
    while (this.usedIds.has(candidate)) {
      counter++;
      candidate = `${base}-${counter}`;
    }
    this.usedIds.add(candidate);
    return candidate;
  }
}

// Characters that are not legal anywhere in an XML 1.0 document (even escaped):
// C0 controls other than TAB/LF/CR, plus U+FFFE and U+FFFF.
// eslint-disable-next-line no-control-regex
const XML_ILLEGAL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g;
// Lone surrogates (a high surrogate not followed by a low one, or a low one not preceded by a high one).
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Removes characters that cannot appear in a well-formed XML 1.0 document
 * (illegal control characters, U+FFFE/U+FFFF, and lone surrogates).
 * @param {string} str
 * @returns {string}
 */
export function stripXmlIllegalChars(str) {
  if (str == null) return '';
  return String(str).replace(XML_ILLEGAL_RE, '').replace(LONE_SURROGATE_RE, '');
}

/**
 * Escapes characters with special meaning in XML (for both text and attribute
 * values) after stripping characters XML cannot represent at all.
 * @param {string} str
 * @returns {string}
 */
export function escapeXml(str) {
  if (str == null) return '';
  return stripXmlIllegalChars(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// MathML helpers
// ---------------------------------------------------------------------------

const MATH_OPEN_RE = /<(m:|mml:|mathml:)?math\b/;

/**
 * Normalises a pass-through MathML fragment so that it validates against the
 * DAISY "MathML in DTBook" modular extension: every MathML element is written
 * with the `m:` prefix (bound once on the <dtbook> root), stray namespace
 * declarations are removed, `altimg`/`alttext` are guaranteed on <m:math>,
 * ids are coerced to NCNames, and a <semantics> whose first child is an
 * <annotation> gets a presentation <mrow> so the content model holds.
 * @param {string} raw
 * @param {string} altFallback
 * @returns {string}
 */
export function normalizeMathMl(raw, altFallback = 'math expression') {
  let m = stripXmlIllegalChars(raw).trim();
  if (!m) return m;
  // The editor's maths nodes carry presentation fragments (`<mrow>…</mrow>`) without a
  // <math> root; DTBook only admits MathML inside <m:math>, so give every fragment one.
  if (!MATH_OPEN_RE.test(m)) {
    if (!m.startsWith('<')) return m;
    m = `<math>${m}</math>`;
  }

  // Re-prefix every element tag to `m:` and drop xmlns declarations for the
  // MathML namespace (the DTD binds xmlns:m as a #FIXED attribute).
  m = m.replace(/<(\/?)(?:(?:m|mml|mathml):)?([A-Za-z][\w.-]*)((?:\s[^<>]*?)?)(\/?)>/g, (all, slash, local, attrs, selfClose) => {
    let a = attrs
      .replace(/\s+xmlns(?::(?:m|mml|mathml|xlink))?\s*=\s*"[^"]*"/g, '')
      .replace(/\s+xmlns(?::(?:m|mml|mathml|xlink))?\s*=\s*'[^']*'/g, '');
    if (selfClose) a = a.replace(/\s+$/, '');
    return `<${slash}m:${local}${a}${selfClose ? '/' : ''}>`;
  });

  m = wrapBareMathText(m);

  // Sanitise ids so they are legal ID tokens.
  m = m.replace(/(\sid\s*=\s*)"([^"]*)"/g, (all, pre, v) => `${pre}"${toNCName(v)}"`);

  if (!/<m:math\b[^>]*\saltimg\s*=/.test(m)) {
    m = m.replace(/<m:math\b/, '$& altimg="math.png"');
  }
  if (!/<m:math\b[^>]*\salttext\s*=/.test(m)) {
    m = m.replace(/<m:math\b/, `$& alttext="${escapeXml(altFallback || 'math expression')}"`);
  }
  if (/<m:semantics\b[^>]*>\s*<m:annotation\b/.test(m)) {
    m = m.replace(/(<m:semantics\b[^>]*>)\s*(<m:annotation\b[^>]*>)([\s\S]*?)(<\/m:annotation>)/g, (all, semTag, annOpen, innerText, annClose) => {
      return `${semTag}<m:mrow><m:mtext>${innerText}</m:mtext></m:mrow>${annOpen}${innerText}${annClose}`;
    });
  }
  return m;
}

// MathML 2 elements whose content model admits character data; everywhere else
// (mtd, mrow, mstyle, math…) text must sit inside a token element.
const MATH_TEXT_ELEMENTS = new Set(['mi', 'mn', 'mo', 'mtext', 'ms', 'annotation', 'annotation-xml', 'ci', 'cn', 'csymbol', 'mglyph']);

/**
 * Wraps character data that sits directly inside a non-token MathML element
 * (e.g. `<m:mtd>Total</m:mtd>`, emitted by the editor's LaTeX converter) in
 * `<m:mtext>`, which is the only way MathML 2 allows it. Expects m:-prefixed input.
 * @param {string} m
 * @returns {string}
 */
function wrapBareMathText(m) {
  const stack = [];
  return m.replace(/(<[^>]+>)|([^<]+)/g, (all, tag, text) => {
    if (tag) {
      const t = tag.match(/^<(\/?)m:([\w.-]+)[^>]*?(\/?)>$/);
      if (t) {
        if (t[1]) stack.pop();
        else if (!t[3]) stack.push(t[2]);
      }
      return tag;
    }
    const parent = stack[stack.length - 1];
    if (!parent || MATH_TEXT_ELEMENTS.has(parent) || !text.trim()) return text;
    const lead = text.match(/^\s*/)[0];
    const trail = text.match(/\s*$/)[0];
    return `${lead}<m:mtext>${text.trim()}</m:mtext>${trail}`;
  });
}

/**
 * Builds a minimal MathML island from LaTeX source.
 * @param {string} latex
 * @returns {string}
 */
function mathMlFromLatex(latex) {
  const esc = escapeXml(latex);
  return `<m:math alttext="${esc}" altimg="math.png"><m:semantics><m:mrow><m:mtext>${esc}</m:mtext></m:mrow><m:annotation encoding="application/x-tex">${esc}</m:annotation></m:semantics></m:math>`;
}

/**
 * Serialises one math segment/block to a normalised <m:math> island.
 * @param {{mathml?: string, latex?: string, text?: string}} seg
 * @returns {string}
 */
export function serializeMathMl(seg) {
  if (!seg) return '';
  if (seg.mathml) return normalizeMathMl(seg.mathml, seg.latex || seg.text || 'math expression');
  if (seg.latex) return mathMlFromLatex(seg.latex);
  return '';
}

/**
 * Returns every `id="…"` value found in a markup string.
 * @param {string} markup
 * @returns {string[]}
 */
function extractIds(markup) {
  const ids = [];
  const re = /\sid\s*=\s*"([^"]*)"/g;
  let mt;
  while ((mt = re.exec(markup)) !== null) ids.push(mt[1]);
  return ids;
}

/**
 * Walks the document model and reserves every id that lives inside
 * pass-through MathML so generated ids (notes, sidebars, pagenums) never
 * collide with them.
 * @param {Array<object>} blocks
 * @param {IdAllocator} idAlloc
 */
export function registerMathIds(blocks, idAlloc) {
  if (!idAlloc || !Array.isArray(blocks)) return;
  const visitSegments = (segments) => {
    if (!Array.isArray(segments)) return;
    for (const seg of segments) {
      if (seg && seg.type === 'math' && seg.mathml) {
        for (const id of extractIds(normalizeMathMl(seg.mathml))) idAlloc.register(id);
      }
    }
  };
  const visit = (list) => {
    if (!Array.isArray(list)) return;
    for (const b of list) {
      if (!b) continue;
      if (b.type === 'math' && b.mathml) {
        for (const id of extractIds(normalizeMathMl(b.mathml))) idAlloc.register(id);
      }
      visitSegments(b.segments);
      if (Array.isArray(b.items)) {
        for (const it of b.items) {
          if (!it) continue;
          visitSegments(it.segments);
          visitSegments(it.termSegments);
          visitSegments(it.defSegments);
        }
      }
      if (b.type === 'table') {
        for (const cell of [...(b.headers || []), ...(b.rows || []).flat()]) {
          if (cell && typeof cell === 'object') visitSegments(cell.segments);
        }
      }
      if (Array.isArray(b.blocks)) visit(b.blocks);
    }
  };
  visit(blocks);
}

// ---------------------------------------------------------------------------
// Graphics helpers
// ---------------------------------------------------------------------------

function utf8ToBase64(str) {
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    return Buffer.from(str, 'utf8').toString('base64');
  }
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/**
 * Encodes SVG markup as a `data:image/svg+xml;base64,…` URI.
 * @param {string} svg
 * @returns {string}
 */
export function svgToDataUri(svg) {
  if (!svg || typeof svg !== 'string') return '';
  return `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
}

/**
 * Resolves the `src` for a graphic block: an explicit src wins; otherwise a
 * tactile graphic carrying `svg` is embedded as a data URI.
 * @param {object} block
 * @returns {string}
 */
function graphicSrc(block) {
  if (block.src) return String(block.src);
  if (typeof block.svg === 'string' && block.svg.trim()) return svgToDataUri(block.svg);
  return '';
}

/**
 * True for a block that is a caption in the model (either a dedicated caption
 * block or a paragraph styled as one).
 * @param {object} block
 * @returns {boolean}
 */
function isCaptionBlock(block) {
  return !!block && (block.type === 'caption' || (block.type === 'para' && block.style === 'caption'));
}

/**
 * A caption that is not attached to a table cannot be a bare <caption> in
 * DTBook (it is only allowed inside <table> and <imggroup>). It is emitted as
 * a figure caption inside an <imggroup>, which is valid both at block level
 * and inside sidebars/list items, and which parse.mjs restores as a caption
 * block.
 * @param {object} block
 * @param {string} indent
 * @returns {string}
 */
function serializeOrphanCaption(block, indent, idAlloc = null) {
  const content = serializeInlineSegments(block.segments, block.text, idAlloc);
  return `${indent}<imggroup><caption>${content}</caption></imggroup>`;
}

/**
 * <pagenum> for a print page turn block. The DTBook @page type comes from the parsed
 * source when known (block.pageType), otherwise it is inferred from the value.
 */
function pagenumXml(block, idAlloc = null) {
  const pageVal = block.page || block.text || '1';
  const cleanPage = String(pageVal).trim().replace(/[^a-zA-Z0-9_-]/g, '') || '1';
  const pageId = idAlloc ? idAlloc.getId(block.id, `p-${cleanPage}`) : (block.id || `p-${cleanPage}`);
  const trimmedVal = String(pageVal).trim();
  let pageType = block.pageType;
  if (pageType !== 'front' && pageType !== 'normal' && pageType !== 'special') {
    if (/^\d+$/.test(trimmedVal)) pageType = 'normal';
    else if (/^[ivxlcdm]+$/i.test(trimmedVal)) pageType = 'front';
    else pageType = 'special';
  }
  return `<pagenum id="${escapeXml(pageId)}" page="${pageType}">${escapeXml(pageVal)}</pagenum>`;
}

/**
 * The parser splits a paragraph around a print page turn into
 * para{continued} · pagenum · para{continuation} so the formatter can resume the text in
 * cell 1. On export the pieces are rejoined into the single <p> the source had, with the
 * <pagenum> inline — otherwise the round trip would turn one paragraph into two.
 */
export function mergePageTurnContinuations(blocks) {
  if (!Array.isArray(blocks)) return blocks;
  const toSegs = (b) => (Array.isArray(b.segments) && b.segments.length ? b.segments : [{ type: 'text', text: b.text ?? '' }]);
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b || b.type !== 'para' || !b.continued) { out.push(b); continue; }
    // Gather: this para, then (pagenum+ para{continuation})* while the chain holds.
    const merged = { ...b };
    delete merged.continued;
    const segs = [...toSegs(b)];
    let j = i + 1;
    let joined = false;
    while (j < blocks.length && blocks[j] && blocks[j].type === 'pagenum') {
      const pns = [];
      while (j < blocks.length && blocks[j] && blocks[j].type === 'pagenum') pns.push(blocks[j++]);
      const next = blocks[j];
      if (!next || next.type !== 'para' || !next.continuation) { j -= pns.length; break; }
      segs.push({ type: 'text', text: ' ' });
      for (const pn of pns) segs.push({ type: 'pagenum', block: pn });
      segs.push({ type: 'text', text: ' ' });
      segs.push(...toSegs(next));
      joined = true;
      j++;
      if (!next.continued) break;
    }
    if (!joined) { out.push(b); continue; }
    merged.segments = segs;
    merged.text = segs.map((s) => (s.type === 'text' ? s.text : '')).join('').replace(/\s+/g, ' ').trim();
    out.push(merged);
    i = j - 1;
  }
  return out;
}

/**
 * Serializes an array of inline segments into XML markup.
 * @param {Array<object>} segments
 * @param {string} fallbackText
 * @returns {string}
 */
export function serializeInlineSegments(segments, fallbackText = '', idAlloc = null) {
  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return escapeXml(fallbackText);
  }

  let out = '';
  for (const seg of segments) {
    if (!seg) continue;
    if (seg.type === 'pagenum') {
      // A print page turn inside running text (see mergePageTurnContinuations).
      out += pagenumXml(seg.block || seg, idAlloc);
      continue;
    }
    if (seg.type === 'math') {
      out += serializeMathMl(seg);
      continue;
    }
    if (seg.type === 'linenum') {
      // A print line number in prose (A30): DTBook's <linenum> belongs to <line>, so prose
      // keeps the class-marked span the source uses.
      if (String(seg.text ?? '').trim()) out += `<span class="linenum">${escapeXml(String(seg.text).trim())}</span>`;
      continue;
    }
    if (seg.type === 'noteref') {
      // A reference to a note in this document keeps its link; one whose note is not in
      // the document (a dangling idref is not valid NIMAS) is kept as a marked span, so it
      // stays a note mark ("HTf" + "33", not "HTf33"; A2).
      const target = seg.idref && idAlloc && idAlloc.noteIds ? idAlloc.noteIds.get(seg.idref) : null;
      const tag = seg.annoref ? 'annoref' : 'noteref';
      out += target ? `<${tag} idref="#${escapeXml(target)}">${escapeXml(seg.text ?? '')}</${tag}>` : `<span class="${tag}">${escapeXml(seg.text ?? '')}</span>`;
      continue;
    }

    let text = escapeXml(seg.text ?? '');
    if (text.includes('\n')) {
      text = text.split('\n').join('<br/>');
    }
    if (seg.uncontracted) {
      text = `<code class="uncontracted">${text}</code>`;
    }
    const tf = seg.tf || 0;
    if (tf & TF_BOLD) {
      text = `<strong>${text}</strong>`;
    }
    if (tf & TF_ITALIC) {
      text = `<em>${text}</em>`;
    }
    if (tf & TF_UNDERLINE) {
      text = `<span class="underline">${text}</span>`;
    }
    out += text;
  }
  return out;
}

// --- Nested-list marker helpers (A31) ---------------------------------------
// DTBook's @enum on <list type="ol"> selects how a reading system spells out
// numbering: "a"/"A" (letters), "i"/"I" (roman numerals), or the digit default.
// Both nimas-export (deciding @enum from markers already on an item) and
// parse.mjs (synthesizing a marker from a counter + @enum on reload) share
// these conversions so the two stay in lock-step.
const ROMAN_VALUES = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
const ROMAN_TABLE = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];

/** Converts a positive integer to a lowercase roman numeral ("" for n<=0). */
export function intToRoman(n) {
  let res = '';
  let x = n | 0;
  if (x <= 0) return res;
  for (const [v, s] of ROMAN_TABLE) {
    while (x >= v) { res += s; x -= v; }
  }
  return res;
}

/** Parses a lowercase roman numeral back to an integer, or null if not valid. */
export function romanToInt(s) {
  const str = String(s || '').toLowerCase();
  if (!str || !/^[ivxlcdm]+$/.test(str)) return null;
  let total = 0, prev = 0;
  for (let i = str.length - 1; i >= 0; i--) {
    const v = ROMAN_VALUES[str[i]];
    if (v < prev) total -= v; else { total += v; prev = v; }
  }
  return intToRoman(total) === str ? total : null;   // reject malformed forms ("iiii")
}

/** 1 -> "a", 2 -> "b", … (26-letter wrap only; beyond that the digit is kept). */
export function numberToLetter(n) {
  return n >= 1 && n <= 26 ? String.fromCharCode(96 + n) : String(n);
}

/** Inverse of numberToLetter for a single a-z/A-Z character. */
export function letterToNumber(letter) {
  return String(letter || '').toLowerCase().charCodeAt(0) - 96;
}

/**
 * Synthesizes the marker text a reading system would show for position `counter`
 * of a <list type="ol"> with the given @enum ("a"/"A"/"i"/"I"/null=digits).
 * Mirrors the punctuation ("N.") nimas-export uses when it keeps markers implicit.
 */
export function synthesizeOrderedMarker(counter, enumAttr) {
  switch (enumAttr) {
    case 'a': return `${numberToLetter(counter)}.`;
    case 'A': return `${numberToLetter(counter).toUpperCase()}.`;
    case 'i': return `${intToRoman(counter)}.`;
    case 'I': return `${intToRoman(counter).toUpperCase()}.`;
    default: return `${counter}.`;
  }
}

/**
 * Groups a flat, level-tagged item array into a tree so a list's structure can
 * be written as real nested <list> elements (A31) instead of flat class="level-N"
 * siblings. Each item is attached under the nearest preceding item whose level
 * is smaller (the "deepest open item"); an item deeper by more than one level
 * still nests this way — nimas-export then writes an explicit class="level-N" on
 * it (see renderListGroup) since one step of nesting alone can't record the jump.
 * @param {Array<object>} items
 * @returns {Array<{item: object, children: Array}>}
 */
export function buildListItemTree(items) {
  const roots = [];
  const stack = [];   // { level, node }
  for (const item of items || []) {
    const lvl = item.level || 0;
    const node = { item, children: [] };
    while (stack.length && stack[stack.length - 1].level >= lvl) stack.pop();
    (stack.length ? stack[stack.length - 1].node.children : roots).push(node);
    stack.push({ level: lvl, node });
  }
  return roots;
}

/**
 * Decides the DTBook @type/@enum/@start for a <list> wrapping `items` (a group
 * of sibling list items, top-level or nested) purely from their own markers, and
 * whether the marker text must stay embedded in the item text (A31). Only a
 * marker ending "." that forms a clean digit/letter/roman run starting at
 * `start` is turned into implicit (@enum + @start) numbering; anything else
 * (bullets, gaps, ")" punctuation, mixed forms) keeps its literal text so the
 * exact source marker always survives the round trip.
 * @param {Array<object>} items
 * @returns {{tagOpen: string, keepMarkers: boolean}}
 */
export function classifyOrderedMarkerGroup(items) {
  if (items.every((it) => !it.marker || it.marker === '•')) {
    return { tagOpen: '<list type="ul">', keepMarkers: false };
  }
  const bodies = items.map((it) => (it.marker && /^(.+)\.$/.test(it.marker)) ? it.marker.slice(0, -1) : null);
  if (bodies.some((b) => b == null)) return { tagOpen: '<list type="ol">', keepMarkers: true };

  if (bodies.every((b) => /^\d+$/.test(b))) {
    const nums = bodies.map(Number);
    const first = nums[0];
    if (nums.every((n, i) => n === first + i)) {
      return { tagOpen: first !== 1 ? `<list type="ol" start="${first}">` : '<list type="ol">', keepMarkers: false };
    }
    return { tagOpen: '<list type="ol">', keepMarkers: true };
  }

  // Roman numerals are tried before single letters: "i", "v", "x"… are valid as either.
  if (bodies.every((b) => /^[ivxlcdmIVXLCDM]+$/.test(b))) {
    const isUpper = /^[A-Z]+$/.test(bodies[0]);
    const vals = bodies.map((b) => romanToInt(b));
    if (vals.every((v, i) => v != null && intToRoman(v) === bodies[i].toLowerCase())) {
      const first = vals[0];
      if (vals.every((v, i) => v === first + i)) {
        const enumAttr = isUpper ? 'I' : 'i';
        return { tagOpen: `<list type="ol" enum="${enumAttr}"${first !== 1 ? ` start="${first}"` : ''}>`, keepMarkers: false };
      }
    }
  }

  if (bodies.every((b) => /^[a-zA-Z]$/.test(b))) {
    const isUpper = /^[A-Z]$/.test(bodies[0]);
    const vals = bodies.map((b) => letterToNumber(b));
    const first = vals[0];
    if (vals.every((v, i) => v === first + i)) {
      const enumAttr = isUpper ? 'A' : 'a';
      return { tagOpen: `<list type="ol" enum="${enumAttr}"${first !== 1 ? ` start="${first}"` : ''}>`, keepMarkers: false };
    }
  }

  return { tagOpen: '<list type="ol">', keepMarkers: true };
}

/**
 * Renders a group of sibling list items (from buildListItemTree) as one <list>,
 * recursing into a nested <list> for any item with children (A31). `parentLevel`
 * is the resolved level of the <li> this group lives inside (-1 for the root
 * group), so a level that isn't exactly parentLevel+1 — a jump of more than one
 * level — gets an explicit class="level-N" override (DTBook's <li> has no
 * @level attribute) that parse.mjs's getElementLevel already honours as a
 * fallback ahead of nesting depth, the same way it reads an older flat list.
 * @param {Array<{item: object, children: Array}>} nodes
 * @param {number} parentLevel
 * @param {number} indentLevel
 * @param {IdAllocator|null} idAlloc
 * @param {{tagOpen: string, keepMarkers: boolean}|null} topTag decision to use in place of classifyOrderedMarkerGroup (top-level list only)
 * @returns {string}
 */
export function renderListGroup(nodes, parentLevel, indentLevel, idAlloc, topTag = null) {
  const { tagOpen, keepMarkers } = topTag || classifyOrderedMarkerGroup(nodes.map((n) => n.item));
  const indent = ' '.repeat(indentLevel);
  const itemIndent = ' '.repeat(indentLevel + 2);
  const lines = [`${indent}${tagOpen}`];
  for (const node of nodes) {
    const item = node.item;
    const trueLevel = item.level || 0;
    // DTBook's <li> has no @level attribute (only @class is legal there), so a jump of more
    // than one level -- nesting alone can't record it -- falls back to the same class="level-N"
    // form older flat lists used; getElementLevel reads it ahead of the nesting depth.
    const levelAttr = trueLevel !== parentLevel + 1 ? ` class="level-${trueLevel}"` : '';
    const marker = keepMarkers && item.marker && item.marker !== '\u0000' ? `${escapeXml(item.marker)} ` : '';
    const bodyContent = marker + serializeInlineSegments(item.segments, item.text, idAlloc);
    if (node.children.length) {
      lines.push(`${itemIndent}<li${levelAttr}>${bodyContent}`);
      lines.push(renderListGroup(node.children, trueLevel, indentLevel + 4, idAlloc));
      lines.push(`${itemIndent}</li>`);
    } else {
      lines.push(`${itemIndent}<li${levelAttr}>${bodyContent}</li>`);
    }
  }
  lines.push(`${indent}</list>`);
  return lines.join('\n');
}

/**
 * Serializes an individual AST block into DTBook XML element(s).
 * @param {object} block
 * @param {number} indentLevel
 * @param {IdAllocator|null} idAlloc
 * @returns {string}
 */
export function serializeBlock(block, indentLevel = 4, idAlloc = null) {
  if (!block || !block.type) return '';
  const indent = ' '.repeat(indentLevel);
  const lvlClass = block.level ? ` level-${block.level}` : '';

  switch (block.type) {
    case 'heading':
    case 'title': {
      const lvl = Math.max(1, Math.min(6, block.level || 1));
      const content = serializeInlineSegments(block.segments, block.text, idAlloc);
      return `${indent}<h${lvl}>${content}</h${lvl}>`;
    }

    case 'para': {
      if (block.style === 'quote' || block.style === 'blockquote') {
        const content = serializeInlineSegments(block.segments, block.text, idAlloc);
        const clsAttr = lvlClass ? ` class="quote${lvlClass}"` : ' class="quote"';
        return `${indent}<blockquote class="quote"><p${clsAttr}>${content}</p></blockquote>`;
      }
      if (block.style === 'attribution') {
        const content = serializeInlineSegments(block.segments, block.text, idAlloc);
        return `${indent}<byline>${content}</byline>`;
      }
      if (block.style === 'dialogue' || block.style === 'play' || block.style === 'play-speaker') {
        const content = serializeInlineSegments(block.segments, block.text, idAlloc);
        return `${indent}<p class="bai-play${lvlClass}">${content}</p>`;
      }
      if (block.style === 'verse' || block.style === 'poem' || block.style === 'play-verse') {
        const content = serializeInlineSegments(block.segments, block.text, idAlloc);
        return `${indent}<p class="bai-verse${lvlClass}">${content}</p>`;
      }
      if (block.style === 'stage' || block.style === 'play-stage') {
        const content = serializeInlineSegments(block.segments, block.text, idAlloc);
        return `${indent}<p class="bai-stage${lvlClass}">${content}</p>`;
      }
      if (block.style === 'caption') {
        const content = serializeInlineSegments(block.segments, block.text, idAlloc);
        return `${indent}<caption>${content}</caption>`;
      }
      if (block.style === 'footnote') {
        const content = serializeInlineSegments(block.segments, block.text, idAlloc);
        const noteId = idAlloc ? idAlloc.getId(block.id, 'note') : (block.id || 'note-1');
        return `${indent}<note id="${escapeXml(noteId)}" class="footnote"><p>${content}</p></note>`;
      }
      if (block.style === 'note') {
        const content = serializeInlineSegments(block.segments, block.text, idAlloc);
        const renderAttr = block.render ? ` render="${escapeXml(block.render)}"` : ' render="optional"';
        return `${indent}<prodnote${renderAttr}>${content}</prodnote>`;
      }
      const content = serializeInlineSegments(block.segments, block.text, idAlloc);
      // BANA Formats §1.9.3 (F-39): the per-paragraph "blocked" (1-1 margins) flag round-trips
      // as class="blocked" (see parse.mjs's makeP, both the top-level and sidebar copies).
      const classTokens = [];
      if (block.blocked) classTokens.push('blocked');
      if (lvlClass) classTokens.push(lvlClass.trim());
      if (classTokens.length) {
        return `${indent}<p class="${classTokens.join(' ')}">${content}</p>`;
      }
      return `${indent}<p>${content}</p>`;
    }

    case 'list': {
      const kind = block.kind || block.style || '';
      // DTD: <list> and <dl> both require at least one child; an empty list has nothing to say.
      if (!Array.isArray(block.items) || block.items.length === 0) return '';
      if (kind === 'glossary') {
        const lines = [`${indent}<dl>`];
        const itemIndent = ' '.repeat(indentLevel + 2);
        for (const item of block.items || []) {
          let termContent = '';
          let defContent = '';
          if (item.term != null && item.def != null && (item.term || item.def)) {
            termContent = item.termSegments ? serializeInlineSegments(item.termSegments, item.term, idAlloc) : escapeXml(item.term);
            defContent = item.defSegments ? serializeInlineSegments(item.defSegments, item.def, idAlloc) : escapeXml(item.def);
          } else if (item.text) {
            const sepIdx = item.text.indexOf(' — ');
            if (sepIdx !== -1) {
              termContent = escapeXml(item.text.slice(0, sepIdx));
              defContent = escapeXml(item.text.slice(sepIdx + 3));
            } else {
              termContent = serializeInlineSegments(item.segments, item.text, idAlloc);
            }
          }
          lines.push(`${itemIndent}<dt>${termContent}</dt>`);
          if (defContent) {
            lines.push(`${itemIndent}<dd>${defContent}</dd>`);
          }
        }
        lines.push(`${indent}</dl>`);
        return lines.join('\n');
      }

      // A generic (non-toc/exercise/index/plain/glossary) list nests real <list>
      // elements for deeper items (A31) so numbering/bulleting can't run together
      // across levels on reload -- see buildListItemTree/renderListGroup above.
      // toc/exercise/index/plain already round-trip correctly with flat
      // class="level-N" siblings (their items carry no position-derived marker),
      // so they, and an item with a <lic> page component, keep that simpler form.
      const isGeneric = kind !== 'toc' && kind !== 'exercise' && kind !== 'index' && kind !== 'plain';
      const hasPageItems = (block.items || []).some((it) => it.page);
      if (isGeneric && !hasPageItems) {
        const tree = buildListItemTree(block.items);
        // The root group is whatever buildListItemTree actually treats as top-level
        // siblings, not every item with level 0 — a list whose top <li>s carry no text
        // of their own (only a nested <list>, e.g. two empty wrapper levels) can end up
        // with no level-0 items at all, and rootItems.every(...) on an empty array is
        // vacuously true, which used to mis-detect a "clean" run and drop real markers.
        const rootItems = tree.map((n) => n.item);
        const isOl = block.ordered || block.style === 'ordered' || rootItems.some((it) => it.marker && /^\d+/.test(it.marker));
        let topTag;
        if (!isOl) {
          topTag = { tagOpen: '<list type="ul">', keepMarkers: false };
        } else if (!rootItems.length) {
          topTag = { tagOpen: '<list type="ol">', keepMarkers: false };
        } else {
          // Numbers that run on from N (a list split around a page turn starts at 2...) are
          // written as start="N"; any other markers ("b.", nested numbering) stay in the item
          // text, where the parser reads them back (A2: they were lost on save).
          const nums = rootItems.map((it) => /^(\d+)\.$/.exec(it.marker || ''));
          const first = nums[0] ? Number(nums[0][1]) : 1;
          const inOrder = nums.every((m, i) => m && Number(m[1]) === first + i);
          topTag = { tagOpen: inOrder && first !== 1 ? `<list type="ol" start="${first}">` : '<list type="ol">', keepMarkers: !inOrder };
        }
        return renderListGroup(tree, -1, indentLevel, idAlloc, topTag);
      }

      let listTagOpen = '<list>';
      let keepMarkers = false;
      if (kind === 'toc') {
        listTagOpen = '<list type="pl" class="toc">';
      } else if (kind === 'exercise') {
        listTagOpen = '<list type="ol" class="bai-exercise">';
      } else if (kind === 'index') {
        listTagOpen = '<list type="pl" class="bai-index">';
      } else if (kind === 'plain') {
        listTagOpen = '<list type="pl">';
      } else {
        const isOl = block.ordered || block.style === 'ordered' || (block.items || []).some((it) => it.marker && /^\d+/.test(it.marker));
        listTagOpen = isOl ? '<list type="ol">' : '<list type="ul">';
        if (isOl) {
          // Numbers that run on from N (a list split around a page turn starts at 2...) are
          // written as start="N"; any other markers ("b.", nested numbering) stay in the item
          // text, where the parser reads them back (A2: they were lost on save).
          const nums = (block.items || []).map((it) => /^(\d+)\.$/.exec(it.marker || ''));
          const first = nums[0] ? Number(nums[0][1]) : 1;
          const inOrder = nums.every((m, i) => m && Number(m[1]) === first + i);
          if (inOrder && first !== 1) listTagOpen = `<list type="ol" start="${first}">`;
          if (!inOrder) keepMarkers = true;
        }
      }

      const itemsXml = [];
      const itemIndent = ' '.repeat(indentLevel + 2);
      for (const item of block.items || []) {
        const itemLvlClass = item.level ? ` level-${item.level}` : '';
        if (kind === 'toc') {
          const textContent = serializeInlineSegments(item.segments, item.text, idAlloc);
          if (item.page) {
            itemsXml.push(`${itemIndent}<li class="bai-toc-entry${itemLvlClass}"><lic class="bai-toc-text">${textContent}</lic><lic class="bai-toc-page">${escapeXml(item.page)}</lic></li>`);
          } else {
            itemsXml.push(`${itemIndent}<li class="bai-toc-entry${itemLvlClass}">${textContent}</li>`);
          }
        } else if (kind === 'exercise') {
          const textContent = serializeInlineSegments(item.segments, item.text, idAlloc);
          itemsXml.push(`${itemIndent}<li class="bai-exercise${itemLvlClass}">${textContent}</li>`);
        } else if (item.page) {
          // An index (or other) entry with page references keeps them as a page component (A2).
          const textContent = serializeInlineSegments(item.segments, item.text, idAlloc);
          const cls = kind === 'index' ? `bai-index${itemLvlClass}` : itemLvlClass.trim();
          itemsXml.push(`${itemIndent}<li${cls ? ` class="${cls}"` : ''}><lic class="bai-index-text">${textContent}</lic><lic class="bai-index-page">${escapeXml(item.page)}</lic></li>`);
        } else if (kind === 'index') {
          const textContent = serializeInlineSegments(item.segments, item.text, idAlloc);
          itemsXml.push(`${itemIndent}<li class="bai-index${itemLvlClass}">${textContent}</li>`);
        } else {
          const marker = keepMarkers && item.marker && item.marker !== '\u0000' ? `${escapeXml(item.marker)} ` : '';
          const textContent = marker + serializeInlineSegments(item.segments, item.text, idAlloc);
          if (itemLvlClass) {
            itemsXml.push(`${itemIndent}<li class="${itemLvlClass.trim()}">${textContent}</li>`);
          } else {
            itemsXml.push(`${itemIndent}<li>${textContent}</li>`);
          }
        }
      }

      return `${indent}${listTagOpen}\n${itemsXml.join('\n')}\n${indent}</list>`;
    }

    case 'box':
    case 'sidebar': {
      if (Array.isArray(block.blocks)) block = { ...block, blocks: mergePageTurnContinuations(block.blocks) };
      const sideId = block.id ? (idAlloc ? idAlloc.getId(block.id, 'sidebar') : toNCName(block.id)) : null;
      const idAttr = sideId ? ` id="${escapeXml(sideId)}"` : '';
      // DTD: render (required | optional) #REQUIRED — boxed material is required reading by default.
      const renderVal = block.render === 'optional' ? 'optional' : 'required';
      const renderAttr = ` render="${renderVal}"`;
      const lines = [`${indent}<sidebar${idAttr}${renderAttr}>`];
      let titleBlockHandled = false;

      // When the first child block is a heading, serialize its full formatted content into <hd>
      if (block.blocks && Array.isArray(block.blocks) && block.blocks.length > 0 && block.blocks[0]?.type === 'heading') {
        const firstHead = block.blocks[0];
        const content = serializeInlineSegments(firstHead.segments, firstHead.text || block.title, idAlloc);
        lines.push(`${' '.repeat(indentLevel + 2)}<hd>${content}</hd>`);
        titleBlockHandled = true;
      } else if (block.title) {
        lines.push(`${' '.repeat(indentLevel + 2)}<hd>${escapeXml(block.title)}</hd>`);
      }

      if (block.blocks && Array.isArray(block.blocks)) {
        for (let idx = 0; idx < block.blocks.length; idx++) {
          if (idx === 0 && titleBlockHandled) continue;
          const child = block.blocks[idx];
          if (!child) continue;
          if (isCaptionBlock(child)) {
            if (idx + 1 < block.blocks.length && block.blocks[idx + 1]?.type === 'table') {
              if (!block.blocks[idx + 1].caption && !block.blocks[idx + 1].title) {
                block.blocks[idx + 1].caption = child.text;
              }
              continue;
            }
            // <caption> is not allowed loose inside <sidebar>.
            lines.push(serializeOrphanCaption(child, ' '.repeat(indentLevel + 2), idAlloc));
            continue;
          }
          if (child.type === 'heading' || child.type === 'title') {
            const content = serializeInlineSegments(child.segments, child.text, idAlloc);
            lines.push(`${' '.repeat(indentLevel + 2)}<hd>${content}</hd>`);
            continue;
          }
          const childXml = serializeBlock(child, indentLevel + 2, idAlloc);
          if (childXml) lines.push(childXml);
        }
      }
      lines.push(`${indent}</sidebar>`);
      return lines.join('\n');
    }

    case 'table': {
      const isListed = block.format === 'listed' || block.style === 'table-listed';
      // T4 (EMBOSS-TASKS.md, Paul's decision 17 Sep 2026): BANA §11.14 Wide Tables:
      // Vertical Division — round-tripped as class="bana-vertical" (parse.mjs's
      // parseTable reads it back).
      const isVertical = block.format === 'vertical';
      const isSpatial = block.format === 'spatial' || block.format === 'columnar' || block.style === 'table-spatial';
      const cls = isListed ? ' class="bana-listed"' : (isVertical ? ' class="bana-vertical"' : (isSpatial ? ' class="bana-spatial"' : ''));
      const lines = [];
      const subIndent = ' '.repeat(indentLevel + 2);
      const rowIndent = ' '.repeat(indentLevel + 4);
      // A cell's markup or { text, segments } becomes inline DTBook (em/strong/code/MathML).
      const cellXml = (cell) => (cell == null ? '' : serializeInlineSegments(cellSegments(cell), cellPlainText(cell), idAlloc));

      if (block.tabletn) {
        // Table transcriber notes are always a <prodnote class="tabletn"> (there is no <tabletn> element in DTBook).
        const tnRender = block.tabletnRender === 'required' ? 'required' : 'optional';
        lines.push(`${indent}<prodnote render="${tnRender}" class="tabletn">${escapeXml(block.tabletn)}</prodnote>`);
      }

      lines.push(`${indent}<table${cls}>`);

      // BANA §11.3.1a's HEADING (block.title, centred) vs §11.2.8's CAPTION (block.caption,
      // 7-5 margins, never centred) round-trips through the same <caption> element DTBook
      // offers, distinguished by class — see parse.mjs's parseTable for the read side (F-4).
      // A multi-line title (block.title as an array — a real, hard print line break, e.g. a
      // sequence number on its own line above the title proper, BANA Example 11-4) becomes
      // <br/>-separated lines; a plain caption's own line breaks are not preserved (they are
      // cosmetic for a caption, joined back to one flowing paragraph on re-parse).
      if (block.title) {
        const titleLines = Array.isArray(block.title) ? block.title : [block.title];
        const cls2 = block.titlePosition === 'before-box' ? ' class="bana-heading bana-heading-before-box"' : ' class="bana-heading"';
        lines.push(`${subIndent}<caption${cls2}>${titleLines.map(escapeXml).join('<br/>')}</caption>`);
      } else if (block.caption) {
        lines.push(`${subIndent}<caption>${escapeXml(block.caption)}</caption>`);
      }

      if (block.headers && Array.isArray(block.headers) && block.headers.length) {
        lines.push(`${subIndent}<thead>`);
        // BANA §11.4.3: a two-row header (a primary heading spanning its sub-columns,
        // §11.4.3a-c) round-trips as two <tr> of <th> — a group becomes
        // <th colspan="n"> on row 1 over its plain <th> sub-columns on row 2; a column
        // with no group (a single-tier heading beside the group, e.g. BANA Sample
        // 11-2's "Fiscal Year") becomes one <th rowspan="2"> on row 1 with no cell of
        // its own on row 2 — read back by parse.mjs's parseTable (F-12).
        const groups = Array.isArray(block.headerGroups) ? block.headerGroups : [];
        if (groups.length) {
          const colCount = block.headers.length;
          const groupOf = Array(colCount).fill(null);
          groups.forEach((g, gi) => { for (let c = g.from; c <= g.to && c < colCount; c++) groupOf[c] = gi; });
          lines.push(`${rowIndent}<tr>`);
          for (let c = 0; c < colCount;) {
            const gi = groupOf[c];
            if (gi != null) {
              const g = groups[gi];
              const span = g.to - g.from + 1;
              lines.push(`${rowIndent}  <th colspan="${span}">${cellXml(g.text)}</th>`);
              c = g.to + 1;
            } else {
              lines.push(`${rowIndent}  <th rowspan="2">${cellXml(block.headers[c])}</th>`);
              c++;
            }
          }
          lines.push(`${rowIndent}</tr>`);
          lines.push(`${rowIndent}<tr>`);
          for (let c = 0; c < colCount; c++) {
            if (groupOf[c] != null) lines.push(`${rowIndent}  <th>${cellXml(block.headers[c])}</th>`);
          }
          lines.push(`${rowIndent}</tr>`);
        } else {
          lines.push(`${rowIndent}<tr>`);
          for (const h of block.headers) {
            lines.push(`${rowIndent}  <th>${cellXml(h)}</th>`);
          }
          lines.push(`${rowIndent}</tr>`);
        }
        lines.push(`${subIndent}</thead>`);
      }

      if (block.rows && Array.isArray(block.rows) && block.rows.length) {
        lines.push(`${subIndent}<tbody>`);
        for (const row of block.rows) {
          lines.push(`${rowIndent}<tr>`);
          for (const cell of row) {
            lines.push(`${rowIndent}  <td>${cellXml(cell)}</td>`);
          }
          lines.push(`${rowIndent}</tr>`);
        }
        lines.push(`${subIndent}</tbody>`);
      } else if (block.headers && Array.isArray(block.headers) && block.headers.length) {
        // DTBook table content model requires tbody or tr rows following thead
        lines.push(`${subIndent}<tbody>`);
        lines.push(`${rowIndent}<tr>`);
        for (const h of block.headers) {
          lines.push(`${rowIndent}  <td></td>`);
        }
        lines.push(`${rowIndent}</tr>`);
        lines.push(`${subIndent}</tbody>`);
      } else {
        // DTD: table requires (tbody+ | (tr|pagenum)+) — keep an empty table well-formed and valid.
        lines.push(`${subIndent}<tbody>`);
        lines.push(`${rowIndent}<tr>`);
        lines.push(`${rowIndent}  <td></td>`);
        lines.push(`${rowIndent}</tr>`);
        lines.push(`${subIndent}</tbody>`);
      }

      lines.push(`${indent}</table>`);
      return lines.join('\n');
    }

    case 'quote': {
      const content = serializeInlineSegments(block.segments, block.text, idAlloc);
      const clsAttr = lvlClass ? ` class="quote${lvlClass}"` : ' class="quote"';
      return `${indent}<blockquote class="quote"><p${clsAttr}>${content}</p></blockquote>`;
    }

    case 'glossary': {
      if (!Array.isArray(block.items) || block.items.length === 0) return '';
      const lines = [`${indent}<dl>`];
      const itemIndent = ' '.repeat(indentLevel + 2);
      for (const item of block.items || []) {
        let termContent = '';
        let defContent = '';
        if (item.term != null && item.def != null && (item.term || item.def)) {
          termContent = item.termSegments ? serializeInlineSegments(item.termSegments, item.term, idAlloc) : escapeXml(item.term);
          defContent = item.defSegments ? serializeInlineSegments(item.defSegments, item.def, idAlloc) : escapeXml(item.def);
        } else if (item.text) {
          const sepIdx = item.text.indexOf(' — ');
          if (sepIdx !== -1) {
            termContent = escapeXml(item.text.slice(0, sepIdx));
            defContent = escapeXml(item.text.slice(sepIdx + 3));
          } else {
            termContent = serializeInlineSegments(item.segments, item.text, idAlloc);
          }
        }
        lines.push(`${itemIndent}<dt>${termContent}</dt>`);
        if (defContent) {
          lines.push(`${itemIndent}<dd>${defContent}</dd>`);
        }
      }
      lines.push(`${indent}</dl>`);
      return lines.join('\n');
    }

    case 'note': {
      const content = serializeInlineSegments(block.segments, block.text, idAlloc);
      // DTD: render (required | optional) #REQUIRED — never omit it.
      const renderVal = block.render === 'required' ? 'required' : 'optional';
      const renderAttr = ` render="${renderVal}"`;
      if (block.kind === 'tabletn') {
        return `${indent}<prodnote class="tabletn"${renderAttr}>${content}</prodnote>`;
      }
      return `${indent}<prodnote${renderAttr}>${content}</prodnote>`;
    }

    case 'footnote': {
      const content = serializeInlineSegments(block.segments, block.text, idAlloc);
      const reserved = block.id && idAlloc && idAlloc.noteIds ? idAlloc.noteIds.get(block.id) : null;
      const noteId = reserved || (idAlloc ? idAlloc.getId(block.id, 'note') : (block.id ? toNCName(block.id) : 'note-1'));
      const cls = block.kind === 'endnote' ? 'endnote' : 'footnote';
      return `${indent}<note id="${escapeXml(noteId)}" class="${cls}"><p>${content}</p></note>`;
    }

    case 'caption': {
      const content = serializeInlineSegments(block.segments, block.text, idAlloc);
      return `${indent}<caption>${content}</caption>`;
    }

    case 'attribution': {
      const content = serializeInlineSegments(block.segments, block.text, idAlloc);
      return `${indent}<byline>${content}</byline>`;
    }

    case 'verse':
    case 'poem':
    case 'play': {
      const cls = (block.subtype === 'verse' || block.style === 'verse' || block.style === 'poem' || block.style === 'play-verse' || block.type === 'verse' || block.type === 'poem') ? 'bai-verse' : 'bai-play';
      const content = serializeInlineSegments(block.segments, block.text, idAlloc);
      return `${indent}<p class="${cls}${lvlClass}">${content}</p>`;
    }

    case 'stage': {
      const content = serializeInlineSegments(block.segments, block.text, idAlloc);
      return `${indent}<p class="bai-stage${lvlClass}">${content}</p>`;
    }

    case 'graphic': {
      // <img> is both a %block; and a %special; inline element in DTBook, so a
      // bare <img> is valid at level, sidebar, list-item and note level alike.
      const src = graphicSrc(block);
      const alt = block.alt || '';
      const img = `<img src="${escapeXml(src)}" alt="${escapeXml(alt)}"/>`;
      if (typeof block.svg === 'string' && block.svg.trim() && alt) {
        // Tactile graphic: group the embedded SVG with its required description.
        return `${indent}<imggroup>${img}<prodnote render="required">${escapeXml(alt)}</prodnote></imggroup>`;
      }
      // A print image with its caption and/or description (A26): <imggroup> keeps them together.
      const hasCaption = block.caption && String(block.caption).trim();
      const hasDescription = block.description && String(block.description).trim();
      if (hasCaption || hasDescription) {
        // A source group with only a caption/production note has no image to write (A29).
        const parts = src || alt ? [img] : [];
        if (hasCaption) parts.push(`<caption>${serializeInlineSegments(block.captionSegments, block.caption, idAlloc)}</caption>`);
        if (hasDescription) parts.push(`<prodnote render="optional">${escapeXml(block.description)}</prodnote>`);
        return `${indent}<imggroup>${parts.join('')}</imggroup>`;
      }
      return `${indent}${img}`;
    }

    case 'pagenum':
      return indent + pagenumXml(block, idAlloc);

    case 'math': {
      let m = serializeMathMl(block);
      if (!m) return '';
      if (!/<m:math\b[^>]*\sdisplay\s*=/.test(m)) {
        m = m.replace(/<m:math\b/, '$& display="block"');
      }
      // m:math is an %externalFlow; element: block-level math lives inside <p>.
      return `${indent}<p>${m}</p>`;
    }

    case 'indicator':
    case 'break': {
      if (block.kind === 'line' || block.kind === 'stanza') {
        return `${indent}<p class="bai-stanza-break"></p>`;
      }
      if (block.kind === 'asterisks') {
        return `${indent}<p class="bana-break-asterisks">***</p>`;
      }
      if (block.kind === 'asterism') {
        return `${indent}<p class="bana-break-asterism">⁂ ⁂ ⁂</p>`;
      }
      if (block.kind === 'dot2s') {
        return `${indent}<p class="bana-break-dot2s">&#x2802;&#x2802;&#x2802;</p>`;
      }
      return `${indent}<p class="bai-break"></p>`;
    }

    default: {
      if (block.text) {
        return `${indent}<p>${escapeXml(block.text)}</p>`;
      }
      return '';
    }
  }
}

/**
 * Builds hierarchical DTBook level1-level6 tree elements from flat AST blocks.
 * @param {Array<object>} blocks
 * @param {number} indentBase
 * @param {string} fallbackTitle
 * @param {IdAllocator|null} idAlloc
 * @returns {string} XML string
 */
export function buildDtbookHierarchy(blocks, indentBase = 6, fallbackTitle = 'Emboss Document', idAlloc = null) {
  blocks = mergePageTurnContinuations(blocks);
  if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
    const ind = ' '.repeat(indentBase);
    const pInd = ' '.repeat(indentBase + 2);
    return `${ind}<level1>\n${pInd}<p>${escapeXml(fallbackTitle)}</p>\n${ind}</level1>`;
  }

  const stack = []; // active level depths: [1, 2, ...]
  const levelHasChildren = []; // tracks if a level has child blocks or sublevels
  const lines = [];

  function openLevel(targetLvl, headingBlock = null) {
    // If targetLvl <= top of stack, close down to targetLvl - 1
    while (stack.length > 0 && stack[stack.length - 1] >= targetLvl) {
      const closedLvl = stack.pop();
      const hasChild = levelHasChildren.pop();
      if (!hasChild) {
        // DTBook DTD requires (%docblockorinline; | levelN+1)+ for every level container.
        lines.push(`${' '.repeat(closedLvl * 2 + indentBase)}<p></p>`);
      }
      const indent = ' '.repeat(closedLvl * 2 + indentBase - 2);
      lines.push(`${indent}</level${closedLvl}>`);
    }

    if (levelHasChildren.length > 0) {
      levelHasChildren[levelHasChildren.length - 1] = true;
    }

    // Open any missing ancestor levels
    const startFrom = stack.length > 0 ? stack[stack.length - 1] + 1 : 1;
    for (let l = startFrom; l <= targetLvl; l++) {
      stack.push(l);
      levelHasChildren.push(false);
      const indent = ' '.repeat(l * 2 + indentBase - 2);
      lines.push(`${indent}<level${l}>`);
      if (l === targetLvl && headingBlock) {
        const hIndent = ' '.repeat(l * 2 + indentBase);
        const content = serializeInlineSegments(headingBlock.segments, headingBlock.text, idAlloc);
        lines.push(`${hIndent}<h${l}>${content}</h${l}>`);
      }
    }
  }

  function ensureLevel1() {
    if (stack.length === 0) {
      openLevel(1, null);
    }
  }

  for (let idx = 0; idx < blocks.length; idx++) {
    const block = blocks[idx];
    if (!block) continue;
    const captionForTable = isCaptionBlock(block) && idx + 1 < blocks.length && blocks[idx + 1]?.type === 'table';
    if (captionForTable) {
      if (!blocks[idx + 1].caption && !blocks[idx + 1].title) {
        blocks[idx + 1].caption = block.text;
      }
      continue;
    }
    if (block.type === 'heading' || block.type === 'title') {
      const lvl = Math.max(1, Math.min(6, block.level || 1));
      openLevel(lvl, block);
    } else {
      ensureLevel1();
      if (levelHasChildren.length > 0) {
        levelHasChildren[levelHasChildren.length - 1] = true;
      }
      const currentIndent = stack[stack.length - 1] * 2 + indentBase;
      const xml = isCaptionBlock(block)
        ? serializeOrphanCaption(block, ' '.repeat(currentIndent), idAlloc)
        : serializeBlock(block, currentIndent, idAlloc);
      if (xml) lines.push(xml);
    }
  }

  // Close any remaining open levels
  while (stack.length > 0) {
    const closedLvl = stack.pop();
    const hasChild = levelHasChildren.pop();
    if (!hasChild) {
      lines.push(`${' '.repeat(closedLvl * 2 + indentBase)}<p></p>`);
    }
    const indent = ' '.repeat(closedLvl * 2 + indentBase - 2);
    lines.push(`${indent}</level${closedLvl}>`);
  }

  return lines.join('\n');
}

/**
 * Internal DTD subset that enables the DAISY "MathML in DTBook" modular
 * extension (Z39.86-2005 §3 "Modular Extension to the DTD"). The parameter
 * entities are the ones documented at
 * https://www.daisy.org/projects/mathml/mathml-in-daisy-spec.html and used by
 * the DAISY Pipeline; %Schema.prefix; / %XLINK.prefix; move the MathML DTD's
 * xsi/xlink namespace attributes onto non-clashing prefixes.
 *
 * NOTE: MathML validation only works when the validator honours the internal
 * subset (xmllint --valid with an XML catalog); see references/dtd/README.md.
 */
export const NIMAS_INTERNAL_SUBSET = `  <!ENTITY % MATHML.prefixed "INCLUDE">
  <!ENTITY % MATHML.prefix "m">
  <!ENTITY % Schema.prefix "sch">
  <!ENTITY % XLINK.prefix "xlp">
  <!ENTITY % MATHML.Common.attrib "xlink:href CDATA #IMPLIED xlink:type CDATA #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED id ID #IMPLIED xref IDREF #IMPLIED other CDATA #IMPLIED xmlns:dtbook CDATA #FIXED 'http://www.daisy.org/z3986/2005/dtbook/' dtbook:smilref CDATA #IMPLIED">
  <!ENTITY % mathML2 PUBLIC "-//W3C//DTD MathML 2.0//EN" "http://www.w3.org/Math/DTD/mathml2/mathml2.dtd">
  %mathML2;
  <!ENTITY % externalFlow "| m:math">
  <!ENTITY % externalNamespaces "xmlns:m CDATA #FIXED 'http://www.w3.org/1998/Math/MathML'">`;

/**
 * Builds the <head> metadata block. Dublin Core values come from
 * docModel.metadata when present so a parsed NIMAS file round-trips its
 * original identifiers; dc:Format stays the DTBook value mandated by
 * Z39.86-2005 §8.1 ("ANSI/NISO Z39.86-2005") unless the source carried its own.
 * Any nimas-* metas captured by the parser are emitted verbatim.
 * @param {object} meta
 * @param {{title:string, uid:string, lang:string, date:string}} core
 * @returns {string}
 */
function buildHeadMetadata(meta, core) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const lines = [];
  const push = (name, value) => {
    if (value == null) return;
    const v = String(value).trim();
    if (!v) return;
    lines.push(`    <meta name="${escapeXml(name)}" content="${escapeXml(v)}" />`);
  };
  push('dtb:uid', core.uid);
  push('dc:Title', core.title);
  push('dc:Creator', m.creator || m.author || m.docauthor);
  push('dc:Identifier', m.identifier || core.uid);
  push('dc:Language', m.language || core.lang);
  push('dc:Publisher', m.publisher || 'Emboss Braille Editor');
  push('dc:Date', m.date || core.date);
  push('dc:Format', m.format || 'ANSI/NISO Z39.86-2005');
  push('dc:Source', m.source);
  push('dc:Rights', m.rights);
  push('dc:Subject', m.subject);
  if (m.nimas && typeof m.nimas === 'object') {
    for (const key of Object.keys(m.nimas).sort()) {
      if (/^nimas-[A-Za-z0-9_.:-]+$/.test(key)) push(key, m.nimas[key]);
    }
  }
  return lines.join('\n');
}

/**
 * Serializes a full Document Model AST into complete, valid DTBook/NIMAS XML.
 * @param {object|Array<object>} docModel
 * @param {object} options
 * @returns {string} XML string
 */
export function exportToNimasXml(docModel, options = {}) {
  const blocks = Array.isArray(docModel) ? docModel : (docModel?.blocks || []);
  const isModel = typeof docModel === 'object' && docModel !== null && !Array.isArray(docModel);
  const meta = (isModel && docModel.metadata && typeof docModel.metadata === 'object') ? docModel.metadata : {};
  const title = (isModel ? docModel.title : null) || meta.title || 'Emboss Document';
  const lang = options.lang || meta.lang || 'en-US';
  const uid = options.uid || meta.uid || `emboss-${Date.now()}`;
  const date = options.date || new Date().toISOString().slice(0, 10);
  const author = options.author || meta.author || meta.docauthor || null;
  const idAlloc = new IdAllocator();

  // Reserve ids that already exist inside pass-through MathML before allocating our own.
  registerMathIds(blocks, idAlloc);
  // Notes get their ids first, so every <noteref> can point at its note's final id.
  idAlloc.noteIds = new Map();
  (function reserveNotes(list) {
    for (const b of list || []) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'footnote' && b.id && !idAlloc.noteIds.has(b.id)) idAlloc.noteIds.set(b.id, idAlloc.getId(b.id, 'note'));
      reserveNotes(b.blocks);
    }
  })(blocks);

  const bodyXml = buildDtbookHierarchy(blocks, 6, title, idAlloc);
  const headXml = buildHeadMetadata(meta, { title, uid, lang, date });
  // Every author of the source (<docauthor> may repeat), unless the caller names one.
  const authors = !options.author && Array.isArray(meta.docauthors) && meta.docauthors.length ? meta.docauthors : (author ? [author] : []);
  const docauthorXml = authors.map((a) => `\n      <docauthor>${escapeXml(a)}</docauthor>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd" [
${NIMAS_INTERNAL_SUBSET}
]>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML" version="2005-3" xml:lang="${escapeXml(lang)}">
  <head>
${headXml}
  </head>
  <book>
    <frontmatter>
      <doctitle>${escapeXml(title)}</doctitle>${docauthorXml}
    </frontmatter>
    <bodymatter>
${bodyXml}
    </bodymatter>
  </book>
</dtbook>
`;
}

export const exportToNimas = exportToNimasXml;

