// DTBook / NIMAS XML Serializer for Emboss.
// Provides pure, deterministic serialization from the internal Document Model AST
// ({ title, blocks, metadata }) into standard ANSI/NISO Z39.86-2005 (DTBook 2005-3) XML.

import { cellSegments, cellPlainText, cellIsBlank } from '../format/cell-markup.mjs';
import { FIELDS, flagFieldTable, textFieldTable, docOptionTable, TITLE_SEP, titlePageTemplateSegments, refreshTitlePageValues } from '../format/field-registry.mjs';
// K29 Stage 1c: additive-only reuse of format/document.mjs's titlePageFieldsFrom (Stage 1b, unchanged) — see
// that export's own comment. No circular import: document.mjs never imports from input/.
import { titlePageFieldsFrom } from '../format/document.mjs';
import { htmlNamedCharsToText } from './omml.mjs';

const TF_ITALIC = 1;
const TF_UNDERLINE = 2;
const TF_BOLD = 4;
const TF_SCRIPT = 8;   // K5: UEB §9 script typeform (cell-markup.mjs TF_SCRIPT / engine TYPEFORM.script)

// ---------------------------------------------------------------------------
// Optional BANA formatter fields (document.mjs) carried through DTBook.
// One table shared by the exporter (writes the tokens), parse.mjs (reads them back) and the
// editor (which keeps the same field names on its nodes). A field is written ONLY when set, so a
// document without any of them serializes exactly as before. DTBook has no place for free
// attributes, so the fields ride on `class` (space separated tokens `bana-<field>`) and, for the
// few that carry text, on the element's own legal `title` attribute:
//   heading   bana-not-connected (notConnected, F-84) · bana-accompanies-box (accompaniesBox, 7.2.1e)
//   paragraph bana-directions / bana-directions-continued / bana-directions-labelled (BANA 10.3.2/3)
//             bana-ln-note-off (lnNoteOff) · bana-ln-note + title=text (lnNoteText, F-234)
//             bana-ln-margin (lnMargin) — on <p> (also verse / speaker lines written as <p class="bai-…">)
//   speaker   bana-speaker-gap (speakerGap, F-206) on <p class="bai-play …">
//   note      <prodnote class="bana-enclose-prefix" title="Cartoon"> (enclosePrefix, F-241)
//   xref      <prodnote class="bana-xref" title="optional heading"> (block type 'xref', F-104)
//   list      <list class="bana-columns-N"> (block.columns = N, F-34)
//   list item <li class="bana-bullet-dot|hollow-square|solid-square|hollow-circle|triangle|checkmark">
//             (item.bullet, beside an ordinal). A bullet-only item instead keeps its glyph as the
//             leading text of the <li> (□ ■ ○ ▲ ✓), which parse.mjs reads back as item.marker.
//             item.blocks (the item's further paragraphs / table after its first paragraph) -> <p> / <table>
//             children of the <li> after its own text (itemBlocksXml; DTBook li is (%flow; | lic)*).
// ---------------------------------------------------------------------------
// The tables below are DERIVED from format/field-registry.mjs (one entry per field: its class token / title part / meta
// name, block types, audience, dialog control ...). The exported names stay as thin aliases so parse.mjs, the editor and
// the tests keep working; add or change a field in the registry, not here. (A field's block types there only list blocks
// whose element takes a class -- see withBanaAttrs's tag list; a pagenum, code, stage, math, caption, attribution and quote
// block have no element that can carry one.)
export const BANA_FLAG_FIELDS = flagFieldTable();
// Array values ride in the same `title` as one string (ARR_SEP); several text fields on one element share the single
// `title`, values in title order joined with TITLE_SEP (both defined in the registry).
export const BANA_TEXT_FIELDS = textFieldTable();
/** Document-level options (model top level, read by document.mjs as doc.<name>): <meta name="bana-…" content="1"> in <head>.
 *  `off`: an opt-out of a default-on rule, written (content="0") only when the option is exactly false. `text`: the value itself is the content. */
export const BANA_DOC_OPTIONS = docOptionTable();
/** The <meta> content for one document option, or null when the option is not set. `o.enc` (K29 Stage 1a,
 *  tpEditors/tpIsbn): a list-valued option, encoded the same way as a text-field array (ARR_SEP-joined). */
export function docOptionContent(o, value) {
  if (o.enc) { const v = o.enc(value); return v && String(v).trim() ? String(v).trim() : null; }
  if (o.text) return typeof value === 'string' && value.trim() ? value.trim() : null;
  if (o.off) return value === false ? '0' : null;
  return value ? '1' : null;
}
/** Value read back from a <meta> content (undefined = not a value this option can hold). */
export function docOptionValue(o, content) {
  if (o.dec) { const v = o.dec(content); return Array.isArray(v) && v.length ? v : undefined; }
  if (o.text) return content || undefined;
  if (o.off) return content === '0' ? false : undefined;
  return content === '0' ? undefined : true;
}
/** List items: `example` -> li class bana-example; `label`/`labelSegments` -> a leading <span class="bana-label"> (see itemBana*). */
const flagOn = (f, block) => ('value' in f ? block[f.field] === f.value : !!block[f.field]);
const CODE_FIELDS = FIELDS.filter((f) => f.where.includes('code')).map((f) => f.key);   // dotLocator, keepSpaces, spaceLetters
const hasCodeFlag = (b) => !!b && b.type === 'code' && CODE_FIELDS.some((f) => b[f]);
// G8 stage 2: block.symbols (glyph per list level, opt-in) as one class token bana-symbols-<name>_<name>_…
const SYMBOL_NAMES = { '•': 'dot', '◦': 'ring', '▪': 'small-square', '□': 'hollow-square', '■': 'solid-square', '○': 'hollow-circle', '▲': 'triangle', '✓': 'checkmark', '√': 'checkmark', '✔': 'checkmark' };
const SYMBOL_GLYPHS = { dot: '•', ring: '◦', 'small-square': '▪', 'hollow-square': '□', 'solid-square': '■', 'hollow-circle': '○', triangle: '▲', checkmark: '✓' };
export const symbolsToken = (arr) => {
  if (!Array.isArray(arr) || !arr.length) return null;
  const names = arr.map((g) => SYMBOL_NAMES[g]);
  return names.every(Boolean) ? `bana-symbols-${names.join('_')}` : null;
};
export const symbolsFromToken = (tok) => {
  const m = /^bana-symbols-(.+)$/.exec(tok || '');
  if (!m) return null;
  const g = m[1].split('_').map((n) => SYMBOL_GLYPHS[n]);
  return g.length && g.every(Boolean) ? g : null;
};
export const BANA_FIELD_NAMES = [...BANA_FLAG_FIELDS, ...BANA_TEXT_FIELDS].map((f) => f.field);
export const BULLET_NAMES = ['dot', 'hollow square', 'solid square', 'hollow circle', 'triangle', 'checkmark'];
const BULLET_GLYPH_NAME = { '•': 'dot', '□': 'hollow square', '■': 'solid square', '○': 'hollow circle', '▲': 'triangle', '√': 'checkmark', '✓': 'checkmark', '✔': 'checkmark' };
// IMP-W7 (Paul, 30 Sep 2026): a CUSTOM print bullet - an arrow, a dash, a star ... with no UEB sign of its own - is a single
// symbol that is not one of the bullets above and not a dot-like shape (small/black circle or square, middle dot ...). Kept in
// step with format/document.mjs `customBulletGlyph` (tests/custom_bullets.test.mjs compares the two over the symbol blocks).
const DOT_LIKE_BULLET_RE = /^[\u2022\u00B7\u2219\u2023\u2043\u25E6\u25AA\u25AB\u25CF\u26AB\u26AC\u2B24\u29BF\u2218\u25D8\u25D9]$/;
const CUSTOM_BULLET_RE = /^[\p{So}\p{Pd}\u2212\u2190-\u21FF\u2900-\u297F]$/u;
/** A custom print bullet glyph (one symbol, not a known bullet, not dot-like). */
export const isCustomBulletMarker = (m) => typeof m === 'string' && [...m].length === 1 && !Object.prototype.hasOwnProperty.call(BULLET_GLYPH_NAME, m) && !DOT_LIKE_BULLET_RE.test(m) && CUSTOM_BULLET_RE.test(m);
/** A print bullet glyph the formatter knows (the dot included), or a custom one (IMP-W7). */
export const isBulletMarker = (m) => typeof m === 'string' && (Object.prototype.hasOwnProperty.call(BULLET_GLYPH_NAME, m) || isCustomBulletMarker(m));
/** A KNOWN bullet glyph that is NOT the plain dot (a custom bullet is kept by class, not in the item text: see bulletClass). */
export const isNonDotBulletMarker = (m) => typeof m === 'string' && Object.prototype.hasOwnProperty.call(BULLET_GLYPH_NAME, m) && m !== '•';
// docx-parity fallout (item 2, 25 Sep 2026): the DOCX reader now correctly detects more
// paragraph-style-driven ordered lists (see Emboss/input/parse.mjs's paragraphNumPr/
// resolveStyleNumPr), including ones whose ONLY item(s) — a single-paragraph list, common
// for a style-based list interrupted by other content every other paragraph — carry a
// letter or Roman-numeral marker ("a.", "iii.") with no digit-marked sibling anywhere in
// the same list to give the shape away. `isOl` (below, both the "isGeneric" tree path and
// the older flat-list path) used to test ONLY `/^\d+/` — a marker starting with a digit —
// so a genuinely ordered letter/Roman list with no digit marker at all was written as
// `<list type="ul">` and its marker silently dropped on reopen (real regression found via
// tests/save_reopen_braille.test.mjs once the new list detection started exercising this
// path for the first time on a real document). A marker "looks ordered" here the same way
// classifyOrderedMarkerGroup's own `bodies` extraction (below) already treats one: not a
// bullet glyph, and ending in a literal "." with something before it ("1.", "a.", "iii.",
// "A." — never "•", "■", …).
// ODT import (30 Sep): a marker ending ")" ("1)", "(a)", "(iii)" — LibreOffice's num-prefix/num-suffix) is an ordered marker too; it was
// dropped on save (the list was written as a bullet list). classifyOrderedMarkerGroup keeps such a marker as literal item text and
// the reader (NUMBER_PREFIX_RE in parse.mjs) reads it back from there.
// The printed number of a list item that parse.mjs reads back from the start of the item's own text ("1. ", "a) ", "(iii) ").
export const NUMBER_PREFIX_RE = /^\s*\(?(\d+|[a-zA-Z]|[ivxlcdm]+)[\.\)]\s+/;   // "(1) " too (ODT num-prefix "(" + suffix ")", 30 Sep)
// A marker kept as literal item text that NUMBER_PREFIX_RE would not read back — legal numbering "1.1", a bare "1", "§2" — is named by
// the item itself (class="bana-marker", title = the marker), so the reopened item has that marker and not a second, counted one
// (a saved "1.1 text" item read back as marker "1." + text "1.1 text": the braille showed both numbers). The text still starts with it.
const namedMarkerOf = (item, keepMarkers, tagOpen) => {
  const m = item && item.marker;
  if (typeof m !== 'string' || !m || m === '\u0000') return null;
  const inOl = !!tagOpen && tagOpen.startsWith('<list type="ol"');
  // A bullet inside a numbered list (Markdown's "1. … • … 2. …") is named too: read back from the text it would take the next number.
  if (isBulletMarker(m)) return keepMarkers && inOl ? m : null;
  if (looksBulletGlyphText(m)) return null;
  const literal = keepMarkers || (tagOpen && tagOpen.startsWith('<list type="ul"'));     // a numbered item in a bullet list has no other place to go
  return literal && !NUMBER_PREFIX_RE.test(`${m} `) ? m : null;
};
const looksBulletGlyphText = (m) => /^[-*\u2022\u2023\u25E6\u2043\u2219\u25AA\u25AB\u25CF\u25CB\uF0B7\uF0A7\u00B7]+$/.test(m);
const looksOrderedMarker = (m) => typeof m === 'string' && !!m && !isBulletMarker(m) && /^.+[.)]$/.test(m);
/** item.bullet (glyph or name) -> canonical name, or null. */
export const bulletName = (v) => { const n = BULLET_GLYPH_NAME[v] ?? String(v ?? '').toLowerCase().trim(); return BULLET_NAMES.includes(n) ? n : null; };
// A custom bullet (IMP-W7) rides as `bana-bullet-glyph-<hex code point>`, so a reopened file gives back the same glyph (parse.mjs reads it).
const bulletClass = (item) => {
  const n = item && item.bullet ? bulletName(item.bullet) : null;
  if (n) return `bana-bullet-${n.replace(/ /g, '-')}`;
  return item && isCustomBulletMarker(item.marker) ? `bana-bullet-glyph-${item.marker.codePointAt(0).toString(16)}` : null;
};
/** class="…" tokens (and title text) a block's optional fields need. */
export function banaBlockAttrs(block) {
  const classes = [];
  let title = null;
  if (!block) return { classes, title };
  const t = block.type;
  for (const f of BANA_FLAG_FIELDS) if (f.types.includes(t) && flagOn(f, block) && (!f.when || f.when(block))) classes.push(f.token);
  if (t === 'title') classes.unshift('bana-title');   // an <h1> otherwise: the reopened block would be an ordinary level-1 heading
  if (hasCodeFlag(block) || (t === 'code' && block.text)) classes.unshift('bana-code');   // a plain code block too: else its \n lines re-read as one paragraph
  if (t === 'list') { const st = symbolsToken(block.symbols); if (st) classes.push(st); }
  const titles = [];
  for (const f of BANA_TEXT_FIELDS) {
    if (!f.types.includes(t) || block[f.field] == null) continue;
    const v = f.enc ? f.enc(block[f.field]) : String(block[f.field]);
    if (v != null && v.trim()) { classes.push(f.token); titles.push(v.split(TITLE_SEP).join(' ')); }
  }
  if (titles.length) title = titles.join(TITLE_SEP);
  if (t === 'list' && Math.floor(Number(block.columns)) > 1) classes.push(`bana-columns-${Math.floor(Number(block.columns))}`);
  if (t === 'xref') { classes.push('bana-xref'); if (block.heading && String(block.heading).trim()) title = String(block.heading); }
  return { classes, title };
}
/** Adds those tokens to the first opening tag of already-serialized XML (h1-6, p, prodnote, list). */
function withBanaAttrs(xml, block) {
  const { classes, title } = banaBlockAttrs(block);
  if (!classes.length && title == null) return xml;
  if (block.type === 'pagenum') return xml;                 // written by pagenumXml itself
  // A table may follow its own <prodnote class="tabletn">: the tokens belong on the <table>.
  // K11 / BANA 14.10.4b: 'caption' added so a cartoon caption's `afterNote` (field-registry.mjs)
  // round-trips as <caption class="bana-after-note">.
  const tags = block.type === 'table' ? 'table' : 'h[1-6]|p|prodnote|list|dl|note|img|imggroup|sidebar|caption';
  return xml.replace(new RegExp(`^(\\s*)(?:${block.type === 'table' ? '[\\s\\S]*?' : ''})<(${tags})((?:\\s[^>]*?)?)(\\/?)>`), (m, ws, tag, attrs, slash) => {
    let a = attrs;
    if (classes.length) {
      if (/\sclass="/.test(a)) a = a.replace(/\sclass="([^"]*)"/, (mm, c) => ` class="${c} ${classes.join(' ')}"`);
      else a += ` class="${classes.join(' ')}"`;
    }
    if (title != null) a += ` title="${escapeXml(title)}"`;
    const head = m.slice(0, m.length - (`<${tag}${attrs}${slash}>`).length);
    return `${head}<${tag}${a}${slash}>`;
  });
}
/** <hd> has no level in DTBook and reads back as level 2, so any other level rides as class="bana-level-N" (parse.mjs readBanaFlags). */
function hdLevelAttr(h) { const l = Number(h && h.level); return h && h.type === 'heading' && Number.isInteger(l) && l >= 1 && l <= 6 && l !== 2 ? ` class="bana-level-${l}"` : ''; }
/** Attribute text for a heading written by the level builder: ` class="…" title="…"` or ''. */
function banaAttrString(block) {
  const { classes, title } = banaBlockAttrs(block);
  return (classes.length ? ` class="${classes.join(' ')}"` : '') + (title != null ? ` title="${escapeXml(title)}"` : '');
}
/** parse.mjs: read the tokens back onto a block (only the field types the block's own type accepts). */
export function readBanaFlags(block, tokens, title) {
  if (!block || !tokens || !tokens.length) return;
  const has = (t) => tokens.includes(t);
  // bana-code: a code / puzzle block written as <p class="bana-code …">lines<br/>…</p> (DTBook has no <pre>).
  if (has('bana-code') && block.type === 'para' && !block.style) {
    const text = Array.isArray(block.segments) && block.segments.length ? block.segments.map((g) => (g && g.text) || '').join('') : (block.text || '');
    for (const k of Object.keys(block)) delete block[k];
    block.type = 'code';
    block.text = text;
  }
  if (has('bana-title') && block.type === 'heading') { block.type = 'title'; delete block.level; }
  const type = block.type;
  const lvTok = type === 'heading' ? tokens.map((t) => /^bana-level-([1-6])$/.exec(t)).find(Boolean) : null;
  if (lvTok) block.level = Number(lvTok[1]);
  for (const f of BANA_FLAG_FIELDS) if (has(f.token) && f.types.includes(type) && (!f.when || f.when(block))) block[f.field] = 'value' in f ? f.value : true;
  const present = BANA_TEXT_FIELDS.filter((f) => has(f.token) && f.types.includes(type));
  if (present.length && title) {
    const parts = present.length === 1 ? [title] : title.split(TITLE_SEP);
    present.forEach((f, i) => { if (parts[i]) block[f.field] = f.dec ? f.dec(parts[i]) : parts[i]; });
  }
  if (type === 'list') {
    const m = tokens.map((t) => /^bana-columns-(\d+)$/.exec(t)).find(Boolean);
    if (m && Number(m[1]) > 1) block.columns = Number(m[1]);
    const sym = tokens.map(symbolsFromToken).find(Boolean);
    if (sym) block.symbols = sym;
  }
  if (type === 'note' && has('bana-xref')) {
    block.type = 'xref';
    delete block.render;
    if (title) block.heading = title;
  }
}

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

// Any namespace prefix (m:, mml:, mathml:, ODF's own math:, ...) — all rewritten to m: below.
const MATH_OPEN_RE = /<(?:[A-Za-z_][\w.-]*:)?math\b/;

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
  let m = htmlNamedCharsToText(stripXmlIllegalChars(raw)).trim();   // &ne; &alpha; … (the editor's TeX converter): XML has no such names (A89)
  if (!m) return m;
  // The editor's maths nodes carry presentation fragments (`<mrow>…</mrow>`) without a
  // <math> root; DTBook only admits MathML inside <m:math>, so give every fragment one.
  if (!MATH_OPEN_RE.test(m)) {
    if (!m.startsWith('<')) return m;
    m = `<math>${m}</math>`;
  }

  // Re-prefix every element tag to `m:` and drop xmlns declarations for the
  // MathML namespace (the DTD binds xmlns:m as a #FIXED attribute).
  m = m.replace(/<(\/?)(?:[A-Za-z_][\w.-]*:)?([A-Za-z][\w.-]*)((?:\s[^<>]*?)?)(\/?)>/g, (all, slash, local, attrs, selfClose) => {
    let a = attrs
      .replace(/\s+xmlns(?::[A-Za-z_][\w.-]*)?\s*=\s*(["'])http:\/\/www\.w3\.org\/1998\/Math\/MathML\1/g, '')   // the MathML namespace under any prefix
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
 * A49: parse.mjs's parseTable() (BANA 11.2.5f / F-3) pushes a table's caption, then its
 * tabletn transcriber's note (if any — `{type:'note', kind:'tabletn'}`), then any leading
 * page-turn markers found inside the source `<table>` element (`{type:'pagenum'}`, from
 * collectPagenums' `pn.before`), before the table block itself — so a caption's table can be
 * more than one block away. Finds the table a caption at `blocks[idx]` belongs to by looking
 * past, in that fixed order, at most one tabletn note and any number of pagenum blocks;
 * returns -1 when nothing lines up (so the caption is exported as its own orphan
 * <imggroup><caption>, unchanged from before this fix).
 * @param {object[]} blocks
 * @param {number} idx index of the caption block
 * @param {number} endIdxExclusive upper bound to search within (a sub-range's own length)
 * @returns {number}
 */
function tableIndexForCaption(blocks, idx, endIdxExclusive) {
  // A caption with formatting (bold, maths …: the editor gives such a caption as runs, with no plain text) is written as a caption
  // of its own: a table's <caption> keeps plain text only, and folding it in from its plain text, which it did not have, lost it on
  // save (A89, the nightly random-action run).
  const cap = blocks[idx];
  if (cap && Array.isArray(cap.segments) && cap.segments.some((g) => g && (g.tf || g.uncontracted || g.transcriberTypeform || (g.type && g.type !== 'text')))) return -1;
  let j = idx + 1;
  if (j < endIdxExclusive && blocks[j]?.type === 'note' && blocks[j]?.kind === 'tabletn') j++;
  while (j < endIdxExclusive && blocks[j]?.type === 'pagenum') j++;
  // Import fix list #5 (audit w12): a DTBook table has room for ONE <caption> (its title, or its caption). When the
  // table already has a title or caption, the caption block in front of it is NOT folded in (that used to drop its
  // text on Save): it is written as a caption of its own, in front of the table, like any caption with no table.
  if (j < endIdxExclusive && blocks[j]?.type === 'table' && (blocks[j].title || blocks[j].caption)) return -1;
  return (j < endIdxExclusive && blocks[j]?.type === 'table') ? j : -1;
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
  // F-4 / BANA 11.2.8b: block.identifier rides on the <imggroup> wrapper (same tag the generic
  // bana- flag reader (parse.mjs's BANA_FLAG_TAGS/applyBanaFlags) already applies to whatever
  // block(s) an <imggroup> produced), not on the bare <caption> (not in withBanaAttrs's tag list).
  const { classes, title } = banaBlockAttrs(block);
  const attrs = (classes.length ? ` class="${classes.join(' ')}"` : '') + (title != null ? ` title="${escapeXml(title)}"` : '');
  return `${indent}<imggroup${attrs}><caption>${content}</caption></imggroup>`;
}

/**
 * <pagenum> for a print page turn block. The DTBook @page type comes from the parsed
 * source when known (block.pageType), otherwise it is inferred from the value.
 */
function pagenumXml(block, idAlloc = null) {
  // An implied page number with no value of its own (F-45: the formatter infers it) is written empty, not as a made-up "1".
  const noValue = !!(block.implied || block.unnumbered) && !block.page && !block.text;
  const pageVal = noValue ? '' : (block.page || block.text || '1');
  const cleanPage = noValue ? (block.implied ? 'implied' : 'unnumbered') : (String(pageVal).trim().replace(/[^a-zA-Z0-9_-]/g, '') || '1');
  const pageId = idAlloc ? idAlloc.getId(block.id, `p-${cleanPage}`) : (block.id || `p-${cleanPage}`);
  const trimmedVal = String(pageVal).trim();
  let pageType = block.pageType;
  if (pageType !== 'front' && pageType !== 'normal' && pageType !== 'special') {
    if (/^\d+$/.test(trimmedVal)) pageType = 'normal';
    else if (/^[ivxlcdm]+$/i.test(trimmedVal)) pageType = 'front';
    else pageType = 'special';
  }
  return `<pagenum id="${escapeXml(pageId)}" page="${pageType}"${banaAttrString(block)}>${escapeXml(pageVal)}</pagenum>`;
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
 * F-164: the editor keeps a multi-paragraph transcriber's note as one note block per paragraph,
 * consecutive ones sharing block.noteGroup. On export a run is folded back into the single
 * note block parse.mjs makes (block.blocks, one entry per <p>), so it saves as one <prodnote>.
 */
export function mergeNoteGroups(blocks) {
  if (!Array.isArray(blocks) || !blocks.some((b) => b && ((b.type === 'note' && b.noteGroup != null) || (b.type === 'footnote' && b.noteCont)))) return blocks;
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // #57c: a footnote of several paragraphs is one editor footnote block per paragraph, the second and later marked `noteCont`
    // (editor.mjs markNoteParts). Folded back into the single block the readers make: { type:'footnote', id, kind?, blocks:[para…] }.
    if (b && b.type === 'footnote') {
      const { noteCont, ...lead } = b;
      let j = i + 1;
      while (j < blocks.length && blocks[j] && blocks[j].type === 'footnote' && blocks[j].noteCont) j++;
      if (j === i + 1) { out.push(lead); continue; }
      const paras = blocks.slice(i, j).map((r) => {
        const para = { type: 'para', text: r.text ?? '' };
        if (Array.isArray(r.segments) && r.segments.length) para.segments = r.segments;
        return para;
      });
      const { text, segments, ...rest } = lead;
      out.push({ ...rest, blocks: paras });
      i = j - 1;
      continue;
    }
    if (!b || b.type !== 'note' || b.noteGroup == null) { out.push(b); continue; }
    let j = i;
    const run = [];
    while (j < blocks.length && blocks[j] && blocks[j].type === 'note' && blocks[j].noteGroup === b.noteGroup) run.push(blocks[j++]);
    const { noteGroup, tnPart, blocks: _ignored, ...rest } = b;
    const paras = run.map((r) => {
      const para = { type: 'para', text: r.text ?? '' };
      if (Array.isArray(r.segments) && r.segments.length) para.segments = r.segments;
      return para;
    });
    if (paras.length > 1) out.push({ ...rest, text: paras.map((x) => x.text).filter(Boolean).join(' '), blocks: paras });
    else out.push(rest);
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
    // A forced line break in plain text (RTF/ODT/HTML readers give `text` with "\n" and no segments) is <br/>, as it is for a
    // segment (serializeInlineLeaf); written as a raw newline it read back as a space and the line break was lost on reopening.
    return escapeXml(fallbackText).split('\n').join('<br/>');
  }

  // A19/A21 Stage 3/4: a text segment carrying `.href` (from an <a href>, parse.mjs's
  // walkInline) or `.cite` (from a <cite>) is otherwise a perfectly ordinary segment —
  // the braille formatter and every other consumer just ignore those two fields and
  // render the text as before. Only here do we look at them, to re-wrap a contiguous
  // run of segments that share the same href (or are all cite) in one <a href="…">/
  // <cite>…</cite>, instead of losing the wrapper the way the exporter used to.
  let out = '';
  let i = 0;
  while (i < segments.length) {
    const seg = segments[i];
    if (!seg) { i++; continue; }
    if (seg.href || seg.cite) {
      const href = seg.href || null;
      const cite = !!seg.cite;
      let j = i;
      let inner = '';
      while (j < segments.length && segments[j] && (segments[j].href || null) === href && !!segments[j].cite === cite) {
        inner += serializeInlineLeaf(segments[j], idAlloc);
        j++;
      }
      if (cite) {
        out += `<cite>${inner}</cite>`;
      } else {
        out += `<a href="${escapeXml(href)}">${inner}</a>`;
      }
      i = j;
      continue;
    }
    out += serializeInlineLeaf(seg, idAlloc);
    i++;
  }
  return out;
}

/** Renders one inline segment's own markup, without looking at `.href`/`.cite` (the
 * caller, serializeInlineSegments, handles grouping those into <a>/<cite> wrappers —
 * calling it recursively here would just regroup the same run forever). */
function serializeInlineLeaf(seg, idAlloc) {
  if (seg.type === 'pagenum') {
    // A print page turn inside running text (see mergePageTurnContinuations).
    return pagenumXml(seg.block || seg, idAlloc);
  }
  if (seg.type === 'math') {
    return serializeMathMl(seg);
  }
  if (seg.type === 'linenum') {
    // A print line number in prose (A30): DTBook's <linenum> belongs to <line>, so prose
    // keeps the class-marked span the source uses.
    return String(seg.text ?? '').trim() ? `<span class="linenum">${escapeXml(String(seg.text).trim())}</span>` : '';
  }
  if (seg.type === 'imgnote') {
    // BANA 10.11.1 embedded-picture TN (F-229): re-export as the <img> it came from,
    // so reloading regenerates the same embedded note instead of leaving its
    // description as bare running print text.
    if (!String(seg.text ?? '').trim()) return '';
    const uncAttr = (seg.uncontracted || seg.spanTypeform) ? ` class="${[seg.uncontracted ? 'bana-uncontracted' : '', seg.spanTypeform ? 'bana-span-typeform' : ''].filter(Boolean).join(' ')}"` : '';     // 17.11.2b: imgnote.uncontracted; 18.3.3c: imgnote.spanTypeform
    if (seg.prodnote) {                                             // F-S4-02: an embedded TN from an inline <prodnote>
      const rd = seg.render === 'required' ? 'required' : 'optional';
      return `<prodnote render="${rd}"${uncAttr}>${escapeXml(String(seg.text).trim())}</prodnote>`;
    }
    const srcAttr = seg.src ? ` src="${escapeXml(seg.src)}"` : '';
    return `<img${srcAttr} alt="${escapeXml(String(seg.text).trim())}"${uncAttr}/>`;
  }
  if (seg.type === 'brl') {
    // Literal braille cells (grouping indicators, transcriber-defined symbols, dot locators): cells in title, print text inside.
    return `<span class="bana-brl" title="${escapeXml(seg.brl ?? '')}">${escapeXml(seg.text ?? '')}</span>`;
  }
  if (seg.type === 'noteref') {
    // A reference to a note in this document keeps its link; one whose note is not in
    // the document (a dangling idref is not valid NIMAS) is kept as a marked span, so it
    // stays a note mark ("HTf" + "33", not "HTf33"; A2).
    const target = seg.idref && idAlloc && idAlloc.noteIds ? idAlloc.noteIds.get(seg.idref) : null;
    const tag = seg.annoref ? 'annoref' : 'noteref';
    return target ? `<${tag} idref="#${escapeXml(target)}">${escapeXml(seg.text ?? '')}</${tag}>` : `<span class="${tag}">${escapeXml(seg.text ?? '')}</span>`;
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
  // K5 / UEB §9: script typeform (⠈⠆/⠈⠂/⠈⠶/⠈⠄, its own indicator, not one of the five
  // transcriber-defined typeforms — rueb-2024.txt §9.1.2/9.5.1). Round-trips through
  // `<span class="script">`, read back by parse.mjs's parseDtbook walkInline (also read
  // leniently from HTML/EPUB's own class="script"/script-font signal on import, and never
  // confused with parse.mjs's unrelated `runScript`/`curScript`, which is sub/superscript).
  if (tf & TF_SCRIPT) {
    text = `<span class="script">${text}</span>`;
  }
  // UEB 9.5.1 transcriber-defined typeform (see format/document.mjs's segTf comment for the
  // model): 'strike' is Emboss's own strikethrough (single/double crossed-out print, the
  // editor's toolbar/Ctrl+Shift+X control — brailled as the SECOND transcriber-defined typeform,
  // not the first, which the hyperlink indicator below already claims) and round-trips through
  // `<span class="strikethrough">` (read back by parse.mjs's parseDtbook walkInline, which maps
  // that class back to 'strike'). A value shaped 'bai-transN' is BrailleBlaster's own import
  // (parse.mjs A24) — its print meaning is unknown to Emboss, and A24's own established
  // behaviour (braille_blaster_import.test.mjs, "keeps its text and records the loss") is that a
  // save keeps the plain text and lets the typeform go, same as every other field this run has
  // no representation for; it is deliberately NOT written back as a span here, so only 'strike'
  // (Emboss's own, known meaning) round-trips. (Strikethrough used to be written as the bare
  // value 'trans1', before links also needed the first transcriber-defined typeform slot; there
  // should be no saved files from that period, so no special reading is done for it here — a
  // segment still carrying it would simply lose its `<span class="strikethrough">` on save.)
  if (seg.transcriberTypeform === 'strike') {
    text = `<span class="strikethrough">${text}</span>`;
  }
  if (seg.ignoreFont) text = `<span class="bana-ignore-font">${text}</span>`;       // 5.3.2 / 5.3.3 / 5.3.11: this run's font is not brailled
  if (seg.hyperlink) text = `<span class="bana-hyperlink">${text}</span>`;          // F-233 / BANA 6.12.3b(3): braille hyperlink indicator, layered on top of any tf
  // A foreign-language run (seg.lang, a BCP-47 primary subtag — input/lang.mjs): DTBook's %attrs gives every inline element
  // xml:lang, and parseDtbook reads the nearest xml:lang back onto the run's text.
  if (seg.lang && /^[a-z]{2,3}$/i.test(String(seg.lang))) text = `<span xml:lang="${escapeXml(String(seg.lang).toLowerCase())}">${text}</span>`;
  return text;
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

// Optional list-item fields (BANA 10.8 exercise examples, 21.x glossary entries): `example` -> class bana-example on the <li>;
// `label` / `labelSegments` -> a leading <span class="bana-label"> (parse.mjs skips it in the text and reads it back);
// glossary entry `termSup` / `lead` -> class bana-term-sup / bana-lead + title on the <dt> (both: title "lead|sup", each URI-encoded).
const itemLabelXml = (item, idAlloc) => {
  if (!item) return '';
  const hasSegs = Array.isArray(item.labelSegments) && item.labelSegments.length;
  if (!hasSegs && !(item.label != null && String(item.label).trim())) return '';
  return `<span class="bana-label">${hasSegs ? serializeInlineSegments(item.labelSegments, '', idAlloc) : escapeXml(String(item.label))}</span>`;
};
const itemExampleClass = (item) => (item && item.example ? 'bana-example' : null);
const dtBanaAttrs = (item) => {
  const lead = item && item.lead != null && String(item.lead).trim() ? String(item.lead) : '';
  const sup = item && item.termSup != null && String(item.termSup).trim() ? String(item.termSup) : '';
  if (!lead && !sup) return '';
  const cls = [lead ? 'bana-lead' : null, sup ? 'bana-term-sup' : null].filter(Boolean).join(' ');
  const title = lead && sup ? `${encodeURIComponent(lead)}|${encodeURIComponent(sup)}` : (lead || sup);
  return ` class="${cls}" title="${escapeXml(title)}"`;
};
/** Explicit item.enum / item.start (on the first item of a sibling group) as a tag, when the markers agree with them (G8 stage 2). */
const enumStartTag = (items) => {
  const first = items && items[0];
  if (!first || (first.enum == null && first.start == null)) return null;
  const en = first.enum != null ? String(first.enum) : '1';
  if (!['1', 'a', 'A', 'i', 'I'].includes(en)) return null;
  const st = first.start != null ? Math.floor(Number(first.start)) : 1;
  if (!Number.isFinite(st) || st < 1) return null;
  if (!items.every((it, i) => !it.marker || it.marker === synthesizeOrderedMarker(st + i, en))) return null;
  return { tagOpen: `<list type="ol"${en !== '1' ? ` enum="${en}"` : ''}${st !== 1 ? ` start="${st}"` : ''}>`, keepMarkers: false };
};

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
  const explicit = enumStartTag(items);
  if (explicit) return explicit;
  if (items.every((it) => !it.marker || isBulletMarker(it.marker))) {
    // No item has a bullet: a plain list (type="pl"), which re-opens without bullets; type="ul" would give every item one.
    if (items.every((it) => !it.marker && !it.bullet && it.enum == null)) return { tagOpen: '<list type="pl">', keepMarkers: false };
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
// A list item's further content (item.blocks: more paragraphs, a table, a code block... after its first paragraph, see
// document.mjs formatItemBlocks) as block children of the <li>, after the item's own inline text: DTBook's
// <!ELEMENT li (%flow; | lic)*> takes <p>, <table>, <list>... mixed with text. parse.mjs reads each <p>/<table> of an
// <li> after its first paragraph back into item.blocks. '' when the item has none.
function itemBlocksXml(item, indentLevel, idAlloc) {
  if (!item || !Array.isArray(item.blocks) || !item.blocks.length) return '';
  const out = [];
  for (const b of item.blocks) {
    if (!b || typeof b !== 'object') continue;
    const xml = serializeBlock(b.type ? b : { ...b, type: 'para' }, indentLevel, idAlloc);
    if (xml) out.push(xml);
  }
  return out.join('\n');
}
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
    const named = namedMarkerOf(item, keepMarkers, tagOpen);
    const liCls = [trueLevel !== parentLevel + 1 ? `level-${trueLevel}` : null, bulletClass(item), itemExampleClass(item), item.ignoreFont ? 'bana-ignore-font' : null, (!item.marker && ((keepMarkers && tagOpen.startsWith('<list type="ol"')) || (!item.bullet && tagOpen.startsWith('<list type="ul"') && nodes.some((n) => n.item && (n.item.marker || n.item.bullet))))) ? 'bana-no-marker' : null, named ? 'bana-marker' : null].filter(Boolean);   // bana-no-marker: an unnumbered item inside a numbered list (else it is numbered on re-import), or an unmarked one in a bulleted list (#46: else it takes a bullet)
    const marker = (keepMarkers || named) && item.marker && item.marker !== '\u0000' ? `${escapeXml(item.marker)} ` : (!keepMarkers && isNonDotBulletMarker(item.marker) ? `${item.marker} ` : '');
    const emptyItem = isEmptyListItem(item);
    const body = itemLabelXml(item, idAlloc) + (emptyItem ? '' : serializeInlineSegments(item.segments, item.text, idAlloc));
    const blocksXml = itemBlocksXml(item, indentLevel + 4, idAlloc);   // the item's further paragraphs / table (li is (%flow; | lic)*)
    // A89: an empty item is kept (parse.mjs reads class="bana-empty" back as one) -- with its printed number when the list keeps its
    // numbers as printed (<li class="bana-empty">iii.</li>; without the mark the reader saw a number and no text, and dropped it).
    const emptyMarked = emptyItem && !body && !blocksXml && !node.children.length;
    if (emptyMarked) liCls.push(EMPTY_CLASS);
    const bodyContent = (emptyMarked ? marker.trimEnd() : marker) + body;
    const levelAttr = (liCls.length ? ` class="${liCls.join(' ')}"` : '') + (named ? ` title="${escapeXml(named)}"` : '');
    if (node.children.length || blocksXml) {
      lines.push(`${itemIndent}<li${levelAttr}>${bodyContent}`);
      if (blocksXml) lines.push(blocksXml);
      if (node.children.length) lines.push(renderListGroup(node.children, trueLevel, indentLevel + 4, idAlloc));
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
/** block.citation (string or { text, position }) of a table -> { text, position } or null (formatter: tableCitation). */
function tableCitationOf(block) {
  const c = block && block.citation;
  const text = typeof c === 'string' ? c : (c && typeof c === 'object' && typeof c.text === 'string' ? c.text : '');
  if (!text.trim()) return null;
  return { text: text.trim(), position: c && typeof c === 'object' && c.position === 'inside-box' ? 'inside-box' : 'below-box' };
}
// A heading's inline content. IMP-W1: a Title with its Subtitle is one heading whose text holds a forced line break; a
// plain-text heading writes it as <br/> too (the segment form already does, serializeInlineLeaf), else Save would turn
// the break into a space on reopening.
function headingContentXml(block, idAlloc) {
  if (!(Array.isArray(block.segments) && block.segments.length) && typeof block.text === 'string' && block.text.includes('\n')) {
    return block.text.split('\n').map((l) => escapeXml(l)).join('<br/>');
  }
  return serializeInlineSegments(block.segments, block.text, idAlloc);
}
// Feedback 30 Sep 2026, item 3 (Paul, 1 Oct): a paragraph of typed braille is laid out exactly as typed (format/document.mjs
// typedBrailleRuns), spaces included, but XML collapses a run of spaces and a line's leading spaces when the file is read back. Those
// spaces are saved as U+2800 blank cells, which are kept and lay out the same; a single space between cells stays a space.
const TYPED_BRAILLE_RE = /^[\u2800-\u28ff \n]*[\u2801-\u28ff][\u2800-\u28ff \n]*$/;
function keepTypedBrailleSpaces(block) {
  const segs = Array.isArray(block.segments) ? block.segments : null;
  if (segs ? !segs.every((g) => g && (g.type === undefined || g.type === 'text') && typeof g.text === 'string') : typeof block.text !== 'string') return block;
  const all = segs ? segs.map((g) => g.text).join('') : block.text;
  if (!TYPED_BRAILLE_RE.test(all)) return block;
  const blanks = (n) => '\u2800'.repeat(n);
  const fixed = all.replace(/(^|\n)( +)/g, (m, a, sp) => a + blanks(sp.length)).replace(/ {2,}/g, (sp) => blanks(sp.length));   // same length
  if (!segs) return { ...block, text: fixed };
  let at = 0;
  return { ...block, segments: segs.map((g) => { const t = fixed.slice(at, at + g.text.length); at += g.text.length; return { ...g, text: t }; }) };
}
/** The class token that marks an empty paragraph, list item or table row the writer saved on purpose (A89; parse.mjs reads it back). */
export const EMPTY_CLASS = 'bana-empty';
/** A plain paragraph with nothing in it: no text but spaces, no equation, note reference, picture note or literal braille. */
function isEmptyParagraph(block) {
  if (Array.isArray(block.segments) && block.segments.length) {
    return block.segments.every((g) => g && (g.type === undefined || g.type === 'text') && !String(g.text ?? '').trim() && !g.href && !g.cite);
  }
  return !String(block.text ?? '').trim();
}
/** A list item with no text (spaces only), no equation or other inline thing, and no further blocks of its own. */
function isEmptyListItem(item) {
  if (!item || typeof item !== 'object') return !String(item ?? '').trim();
  if (Array.isArray(item.blocks) && item.blocks.length) return false;
  if (item.term || item.def || item.page) return false;
  return isEmptyParagraph(item);
}
export function serializeBlock(block, indentLevel = 4, idAlloc = null) {
  const xml = serializeBlockCore(block, indentLevel, idAlloc);
  return xml ? withBanaAttrs(xml, block) : xml;
}
function serializeBlockCore(block, indentLevel = 4, idAlloc = null) {
  if (!block || !block.type) return '';
  const indent = ' '.repeat(indentLevel);
  const lvlClass = block.level ? ` level-${block.level}` : '';

  switch (block.type) {
    case 'heading':
    case 'title': {
      const lvl = Math.max(1, Math.min(6, block.level || 1));
      const content = headingContentXml(block, idAlloc);
      return `${indent}<h${lvl}${block.type === 'title' ? banaAttrString(block) : ''}>${content}</h${lvl}>`;
    }

    case 'para': {
      if (block.style === 'quote' || block.style === 'blockquote') {
        const content = serializeInlineSegments(block.segments, block.text, idAlloc);
        // K6 / BANA §9.2.2d (displayIndent, field-registry.mjs): `withBanaAttrs` (called by
        // serializeBlock, below) only ever matches the FIRST opening tag of already-serialized
        // XML — here that is <blockquote>, not <p> — so it can never add a class to this <p>
        // itself; the token is written here directly instead, on the SAME <p> the isInsideQuote
        // read-back check (parse.mjs) already keys off.
        const diCls = block.displayIndent ? ' bana-display-indent' : '';
        const clsAttr = ` class="quote${lvlClass}${diCls}"`;
        return `${indent}<blockquote class="quote"><p${clsAttr}>${content}</p></blockquote>`;
      }
      // F-94 / BANA §9.3.1c: an epigraph is NOT displayed material like <blockquote> — its
      // own DTD element (dtbook-2005-3.dtd: <!ELEMENT epigraph (%flow;)*>), round-tripped by
      // parse.mjs's `tag === 'epigraph'` branch and its 'p' dispatch's isInsideEpigraph check.
      if (block.style === 'epigraph') {
        const content = serializeInlineSegments(block.segments, block.text, idAlloc);
        const clsAttr = lvlClass ? ` class="${lvlClass.trim()}"` : '';
        return `${indent}<epigraph><p${clsAttr}>${content}</p></epigraph>`;
      }
      if (block.style === 'attribution') {
        const content = serializeInlineSegments(block.segments, block.text, idAlloc);
        return `${indent}<byline${block._afterHeading ? ' class="bana-attribution"' : ''}>${content}</byline>`;
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
      const kept = keepTypedBrailleSpaces(block);
      // A89 (Paul, 2 Oct 2026, "Empty paragraphs: yes"): an empty paragraph is a block of its own (it keeps two print page numbers
      // apart, say) and is saved as <p class="bana-empty"></p>, which the reader gives back as the same empty paragraph. The mark is
      // what tells it from the filler <p></p> this writer puts in an otherwise empty level, and from an unmarked <p/> in someone
      // else's file, which are not blocks (isEmptyParagraph).
      const emptyPara = isEmptyParagraph(kept);
      const content = emptyPara ? '' : serializeInlineSegments(kept.segments, kept.text, idAlloc);
      // BANA Formats §1.9.3 (F-39): the per-paragraph "blocked" (1-1 margins) flag round-trips
      // as class="blocked" (see parse.mjs's makeP, both the top-level and sidebar copies).
      const classTokens = [];
      if (block.blocked) classTokens.push('blocked');
      if (lvlClass) classTokens.push(lvlClass.trim());
      if (emptyPara) classTokens.push(EMPTY_CLASS);
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
          lines.push(`${itemIndent}<dt${dtBanaAttrs(item)}>${termContent}</dt>`);
          // K34: a repeated print running head pulled out of the definition's own text (a page
          // turn riding through the middle of this <dd>, parse.mjs's parseDefinitionList) is kept
          // as item.blocks, same as an ordinary list item's further paragraphs (itemBlocksXml) —
          // written back as a further <p> inside the SAME <dd> (DTBook's <dd> takes %flow;, the
          // same content model as <li>), so a reload finds it in the same place again.
          const ddBlocksXml = itemBlocksXml(item, indentLevel + 4, idAlloc);
          if (defContent || ddBlocksXml) {
            lines.push(`${itemIndent}<dd>${defContent}${ddBlocksXml ? `\n${ddBlocksXml}\n${itemIndent}` : ''}</dd>`);
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
      // A plain list with numbered or bulleted lists inside it (<list type="pl"> holding an <list type="ol">, read as one list whose
      // inner items keep "1." / "•") goes the same way, so the inner lists keep their numbers and bullets (A89, random-action testing).
      const plainWithMarkers = kind === 'plain' && (block.items || []).some((it) => it && (it.marker || it.bullet));
      const isGeneric = (kind !== 'toc' && kind !== 'exercise' && kind !== 'index' && kind !== 'plain') || plainWithMarkers;
      const hasPageItems = (block.items || []).some((it) => it.page);
      if (isGeneric && !hasPageItems) {
        const tree = buildListItemTree(block.items);
        // The root group is whatever buildListItemTree actually treats as top-level
        // siblings, not every item with level 0 — a list whose top <li>s carry no text
        // of their own (only a nested <list>, e.g. two empty wrapper levels) can end up
        // with no level-0 items at all, and rootItems.every(...) on an empty array is
        // vacuously true, which used to mis-detect a "clean" run and drop real markers.
        const rootItems = tree.map((n) => n.item);
        const isOl = block.ordered || block.style === 'ordered' || rootItems.some((it) => looksOrderedMarker(it.marker) || it.enum != null);
        let topTag;
        if (!isOl) {
          // Items with no bullet, marker or enum: a plain list (type="pl"), so re-opening does not add bullets.
          const plain = rootItems.length > 0 && rootItems.every((it) => !it.marker && !it.bullet && it.enum == null);
          topTag = { tagOpen: plain ? '<list type="pl">' : '<list type="ul">', keepMarkers: false };
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
          // G8 stage 2: an explicit item.enum/start wins; a clean letter or roman run ("a." "b." …) becomes enum + start like a nested group.
          const explicit = enumStartTag(rootItems);
          if (explicit) topTag = explicit;
          else if (!inOrder) {
            const c = classifyOrderedMarkerGroup(rootItems);
            if (!c.keepMarkers && c.tagOpen.startsWith('<list type="ol"')) topTag = c;
          }
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
        const isOl = block.ordered || block.style === 'ordered' || (block.items || []).some((it) => looksOrderedMarker(it.marker));
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
      const exNamed = kind === 'exercise' && (block.items || []).some((it) => it && it.marker) && (block.items || []).some((it, i) => (it && it.marker) !== `${i + 1}.`);
      const itemBlocksTail = (item) => { const bx = itemBlocksXml(item, indentLevel + 4, idAlloc); return bx ? `\n${bx}\n${itemIndent}` : ''; };   // item.blocks
      for (const item of block.items || []) {
        const itemLvlClass = item.level ? ` level-${item.level}` : '';
        if (kind === 'toc') {
          const textContent = serializeInlineSegments(item.segments, item.text, idAlloc);
          if (item.page) {
            // A36: a page number that was itself a link (<li class="toc-page"><a href>N</a></li>)
            // keeps that href, wrapped around the visible number in the same <lic>.
            const pageContent = item.pageHref ? `<a href="${escapeXml(item.pageHref)}">${escapeXml(item.page)}</a>` : escapeXml(item.page);
            itemsXml.push(`${itemIndent}<li class="bai-toc-entry${itemLvlClass}"><lic class="bai-toc-text">${textContent}</lic><lic class="bai-toc-page">${pageContent}</lic></li>`);
          } else {
            itemsXml.push(`${itemIndent}<li class="bai-toc-entry${itemLvlClass}">${textContent}</li>`);
          }
        } else if (kind === 'exercise') {
          const textContent = serializeInlineSegments(item.segments, item.text, idAlloc);
          // Markers that are not simply 1, 2, 3 … in order (bullets, numbering that restarts at a deeper level — a bulleted list
          // given the Exercise style) are named on the item, and an item without one is marked so; the reader numbers bare items
          // 1, 2, 3 … (A89, random-action testing). A plain numbered exercise list is written as before.
          const exMark = exNamed && item.marker && item.marker !== '\u0000' ? item.marker : null;
          const exEmpty = isEmptyListItem(item) && !textContent && !itemLabelXml(item, idAlloc) && !itemBlocksTail(item);   // an empty item is kept, as in any list (A89)
          const exCls = ['bai-exercise' + itemLvlClass, itemExampleClass(item), exMark ? 'bana-marker' : null, exNamed && !exMark ? 'bana-no-marker' : null, exEmpty ? EMPTY_CLASS : null].filter(Boolean).join(' ');
          itemsXml.push(`${itemIndent}<li class="${exCls}"${exMark ? ` title="${escapeXml(exMark)}"` : ''}>${exMark ? `${escapeXml(exMark)} ` : ''}${itemLabelXml(item, idAlloc)}${textContent}${itemBlocksTail(item)}</li>`);
        } else if (item.page) {
          // An index (or other) entry with page references keeps them as a page component (A2);
          // A36: and keeps the page number's own href, same as the toc case above.
          const textContent = serializeInlineSegments(item.segments, item.text, idAlloc);
          const cls = kind === 'index' ? `bai-index${itemLvlClass}` : itemLvlClass.trim();
          const pageContent = item.pageHref ? `<a href="${escapeXml(item.pageHref)}">${escapeXml(item.page)}</a>` : escapeXml(item.page);
          itemsXml.push(`${itemIndent}<li${cls ? ` class="${cls}"` : ''}><lic class="bai-index-text">${textContent}</lic><lic class="bai-index-page">${pageContent}</lic></li>`);
        } else if (kind === 'index') {
          const textContent = serializeInlineSegments(item.segments, item.text, idAlloc);
          itemsXml.push(`${itemIndent}<li class="bai-index${itemLvlClass}">${textContent}${itemBlocksTail(item)}</li>`);
        } else {
          const named2 = namedMarkerOf(item, keepMarkers, listTagOpen);
          const marker = (keepMarkers || named2) && item.marker && item.marker !== '\u0000' ? `${escapeXml(item.marker)} ` : (!keepMarkers && isNonDotBulletMarker(item.marker) ? `${item.marker} ` : '');
          const emptyItem2 = isEmptyListItem(item);
          const textContent = marker + itemLabelXml(item, idAlloc) + (emptyItem2 ? '' : serializeInlineSegments(item.segments, item.text, idAlloc));
          const noMarker2 = !item.marker && !item.bullet && listTagOpen.startsWith('<list type="ul"') && block.items.some((x) => x && (x.marker || x.bullet));   // #46: an unmarked item in a bulleted list (else it takes a bullet on re-import)
          const liCls2 = [itemLvlClass.trim() || null, bulletClass(item), itemExampleClass(item), item.ignoreFont ? 'bana-ignore-font' : null, named2 ? 'bana-marker' : null, noMarker2 ? 'bana-no-marker' : null].filter(Boolean);   // ignoreFont: a plain-list item kept it only in the generic path
          if (emptyItem2 && !textContent && !itemBlocksTail(item)) liCls2.push(EMPTY_CLASS);   // A89: an empty item is kept
          if (liCls2.length) {
            itemsXml.push(`${itemIndent}<li class="${liCls2.join(' ')}"${named2 ? ` title="${escapeXml(named2)}"` : ''}>${textContent}${itemBlocksTail(item)}</li>`);
          } else {
            itemsXml.push(`${itemIndent}<li>${textContent}${itemBlocksTail(item)}</li>`);
          }
        }
      }

      return `${indent}${listTagOpen}\n${itemsXml.join('\n')}\n${indent}</list>`;
    }

    case 'box':
    case 'sidebar': {
      if (Array.isArray(block.blocks)) block = { ...block, blocks: mergeNoteGroups(mergePageTurnContinuations(block.blocks)) };
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
        lines.push(`${' '.repeat(indentLevel + 2)}<hd${hdLevelAttr(firstHead)}>${content}</hd>`);
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
            const tableIdx = tableIndexForCaption(block.blocks, idx, block.blocks.length);
            if (tableIdx !== -1) {
              if (!block.blocks[tableIdx].caption && !block.blocks[tableIdx].title) {
                block.blocks[tableIdx].caption = child.text;
              }
              continue;
            }
            // <caption> is not allowed loose inside <sidebar>.
            lines.push(serializeOrphanCaption(child, ' '.repeat(indentLevel + 2), idAlloc));
            continue;
          }
          if (child.type === 'heading' || child.type === 'title') {
            const content = serializeInlineSegments(child.segments, child.text, idAlloc);
            lines.push(`${' '.repeat(indentLevel + 2)}<hd${hdLevelAttr(child)}>${content}</hd>`);
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
      // T4 (F-18): BANA §11.18 Stairstep / §11.17 Linear — class="bana-stairstep" / "bana-linear".
      // Stairstep subdivisions (§11.18.1j, block.subdivisionRows = 0-based body-row indexes,
      // block.subdivisionHeading = text): `<tr class="bana-subdivision">` on those rows and the
      // heading as the <table>'s own `title` attribute (DTBook %coreattrs;, schema-valid, no new
      // element). A cell's paragraphs ('\n') are written as <br/> and read back as '\n'.
      const isStairstep = block.format === 'stairstep';
      const isLinear = block.format === 'linear';
      const subRows = new Set(isStairstep && Array.isArray(block.subdivisionRows) ? block.subdivisionRows.map(Number) : []);
      const subTitle = subRows.size && block.subdivisionHeading ? ` title="${escapeXml(String(block.subdivisionHeading))}"` : '';
      // K15: BANA §11.13 / B004 App E facing pages — class="bana-facing".
      const isFacing = block.format === 'facing';
      // BANA §11.15 / B004 App E interchanged (transposed) columns and rows — class="bana-interchange". The print table
      // itself is kept as print has it; the interchange is a braille layout choice (format/document.mjs, interchangedTable).
      const isInterchange = block.format === 'interchange';
      const cls = isStairstep ? ` class="bana-stairstep"${subTitle}` : isLinear ? ' class="bana-linear"' : isFacing ? ' class="bana-facing"' : isInterchange ? ' class="bana-interchange"' : isListed ? ' class="bana-listed"' : (isVertical ? ' class="bana-vertical"' : (isSpatial ? ' class="bana-spatial"' : ''));
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

      // Import fix list #5: a table that has both a title and a caption keeps the caption too — the <caption> element
      // holds only the title, so the caption text goes in front of the table as a caption of its own.
      if (block.title && block.caption && String(block.caption).trim()) {
        lines.push(serializeOrphanCaption({ text: String(block.caption) }, indent, idAlloc));
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

      // K3 (BANA 11.6.1d, transcriber KD): print's own column alignment, round-tripped as
      // one <col> per column right after <caption> (DTD: table -> caption?, (col*|colgroup*),
      // thead?, ...) — align="right" or align="char" char="." (%cellhalign;, dtbook-2005-3.dtd)
      // — read back by parse.mjs's parseTable/directTableCols+markupCellAlign (K3).
      // K35: the transcriber's own override (block.columnAlign[c], numericAlignApplies —
      // distinct from print's own alignment above, and always wins over it either way) rides
      // the SAME <col> element as a class token, one of bana-col-align-left/-right/-decimal —
      // %attrs; (dtbook-2005-3.dtd) makes class valid on <col>, and the column is identified
      // by the <col>'s position exactly like the align attribute is, so no column-number needs
      // encoding in the token itself. Read back by parse.mjs's markupColumnAlignOverride.
      // Only columns up to the LAST one that carries either signal need a real <col>;
      // positional placeholders (plain <col/>) keep the earlier ones' indexes right.
      const printAlignOut = Array.isArray(block.printAlign) ? block.printAlign : [];
      const columnAlignOut = Array.isArray(block.columnAlign) ? block.columnAlign : [];
      const isColOverride = (v) => v === 'left' || v === 'right' || v === 'decimal';
      let lastAligned = -1;
      for (let c = Math.max(printAlignOut.length, columnAlignOut.length) - 1; c >= 0; c--) {
        if (printAlignOut[c] === 'right' || printAlignOut[c] === 'decimal' || isColOverride(columnAlignOut[c])) { lastAligned = c; break; }
      }
      for (let c = 0; c <= lastAligned; c++) {
        const a = printAlignOut[c];
        const ov = columnAlignOut[c];
        const alignAttr = a === 'decimal' ? ' align="char" char="."' : a === 'right' ? ' align="right"' : '';
        const classAttr = isColOverride(ov) ? ` class="bana-col-align-${ov}"` : '';
        lines.push(`${subIndent}<col${alignAttr}${classAttr}/>`);
      }

      // A table with a heading row and no body rows (e.g. Word's one-row table marked "repeat
      // as header row"): DTBook needs a <tbody> after a <thead>, and filling it with a row of
      // empty <td/>s (as before) invented a data row that was never in print and read back as
      // one. Instead the heading row is the table's one row, in <tbody>, as <th> cells —
      // valid (tbody → tr → th) and read back as the column headings (parseTable promotes a
      // leading all-<th> row), so the round trip gives headers and no rows again.
      const headOnly = !(Array.isArray(block.rows) && block.rows.length) && Array.isArray(block.headers) && block.headers.length
        && !(Array.isArray(block.headerGroups) && block.headerGroups.length) && !tableCitationOf(block);
      if (headOnly) {
        lines.push(`${subIndent}<tbody>`, `${rowIndent}<tr>`);
        for (const h of block.headers) lines.push(`${rowIndent}  <th>${cellXml(h)}</th>`);
        lines.push(`${rowIndent}</tr>`, `${subIndent}</tbody>`, `${indent}</table>`);
        return lines.join('\n');
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

      // Third batch (F-17, F-12, F-7): a source citation as a <tfoot> row (DTD: before the <tbody>), total rows and row
      // subheadings as class tokens on <tr> (a subheading is its own one-cell <tr class="bana-subheading"> before its row).
      const tblCite = tableCitationOf(block);
      if (tblCite) {
        lines.push(`${subIndent}<tfoot>`);
        lines.push(`${rowIndent}<tr class="bana-table-citation${tblCite.position === 'inside-box' ? ' bana-citation-inside' : ''}">`);
        lines.push(`${rowIndent}  <td>${escapeXml(tblCite.text)}</td>`);
        lines.push(`${rowIndent}</tr>`);
        lines.push(`${subIndent}</tfoot>`);
      }
      const nRows = Array.isArray(block.rows) ? block.rows.length : 0;
      const totalRowSet = new Set(Array.isArray(block.totalRows) ? block.totalRows.map((r) => Math.trunc(Number(r))).filter((n) => Number.isFinite(n) && n >= 0 && n < nRows) : []);
      const subHeadMap = new Map();
      if (Array.isArray(block.rowSubheadings)) {
        for (const e of block.rowSubheadings) {
          const n = Math.trunc(Number(e && e.row));
          const t = e && e.text != null ? String(e.text).trim() : '';
          if (Number.isFinite(n) && n >= 0 && n < nRows && t) subHeadMap.set(n, t);
        }
      }
      if (block.rows && Array.isArray(block.rows) && block.rows.length) {
        lines.push(`${subIndent}<tbody>`);
        for (const [ri, row] of block.rows.entries()) {
          if (subHeadMap.has(ri)) lines.push(`${rowIndent}<tr class="bana-subheading">`, `${rowIndent}  <td>${escapeXml(subHeadMap.get(ri))}</td>`, `${rowIndent}</tr>`);
          // A table with no heading row whose FIRST row is wholly bold: the reader would promote it to the heading row (BANA 11.16.1d-e,
          // for print with no <th>); class="bana-body-row" says it is a data row, as the model had it.
          const bodyRowCls = ri === 0 && !(Array.isArray(block.headers) && block.headers.length) && rowIsWhollyBold(row) ? 'bana-body-row' : '';
          // A89: a row with nothing in any cell is kept as <tr class="bana-empty"> (a blank row in the braille), not dropped on reading.
          const emptyRowCls = (row == null || (Array.isArray(row) && row.every(cellIsBlank))) ? EMPTY_CLASS : '';
          const rowCls = [subRows.has(ri) ? 'bana-subdivision' : '', totalRowSet.has(ri) ? 'bana-total' : '', bodyRowCls, emptyRowCls].filter(Boolean).join(' ');
          lines.push(`${rowIndent}<tr${rowCls ? ` class="${rowCls}"` : ''}>`);
          for (const cell of (row == null ? [''] : row)) {          // F-S4-04: a null row is one empty cell
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
        lines.push(`${itemIndent}<dt${dtBanaAttrs(item)}>${termContent}</dt>`);
        if (defContent) {
          lines.push(`${itemIndent}<dd>${defContent}</dd>`);
        }
      }
      lines.push(`${indent}</dl>`);
      return lines.join('\n');
    }

    case 'note': {
      // F-164: a multi-paragraph note (block.blocks, parse.mjs's pushProdnote) is one
      // <prodnote> with one <p> per paragraph (DTD: prodnote holds %flow;).
      const content = (Array.isArray(block.blocks) && block.blocks.length > 1)
        ? block.blocks.map((cb) => `<p>${serializeInlineSegments(cb.segments, cb.text, idAlloc)}</p>`).join('')
        : serializeInlineSegments(block.segments, block.text, idAlloc);
      // DTD: render (required | optional) #REQUIRED — never omit it.
      // D6/A43: a transcriber's note Emboss itself creates (no source value of its own) saves
      // as render="required" (DTD: essential content; BANA §3: always brailled) — the old
      // "optional" fallback was D6's own decision falling through unimplemented. A22's own
      // import behaviour is kept and made explicit both ways: block.render === 'required' or
      // 'optional' (whichever an imported source actually said) always wins over the default.
      // Today parse.mjs only ever captures an imported render="required" (never an explicit
      // "optional" — see its `renderAttr === 'required'` checks); an imported note whose
      // source said render="optional", or omitted the attribute altogether, is therefore
      // presently indistinguishable from one Emboss created itself and — until parse.mjs also
      // captures that explicit "optional" — necessarily gets this same required default too
      // (see save_fidelity.test.mjs's A43 "KNOWN LIMITATION" test). The explicit 'optional'
      // branch below is forward-compatible with that future parse.mjs change, at no cost now.
      const renderVal = block.render === 'required' ? 'required' : (block.render === 'optional' ? 'optional' : 'required');
      const renderAttr = ` render="${renderVal}"`;
      if (block.kind === 'tabletn') {
        return `${indent}<prodnote class="tabletn"${renderAttr}>${content}</prodnote>`;
      }
      return `${indent}<prodnote${renderAttr}>${content}</prodnote>`;
    }

    case 'xref': {
      // F-104: cross-reference / incidental note — print text, class="bana-xref" (added by
      // withBanaAttrs, with the optional heading as its title).
      const content = serializeInlineSegments(block.segments, block.text, idAlloc);
      return `${indent}<prodnote render="optional">${content}</prodnote>`;
    }

    case 'footnote': {
      const reserved = block.id && idAlloc && idAlloc.noteIds ? idAlloc.noteIds.get(block.id) : null;
      const noteId = reserved || (idAlloc ? idAlloc.getId(block.id, 'note') : (block.id ? toNCName(block.id) : 'note-1'));
      const cls = block.kind === 'endnote' ? 'endnote' : 'footnote';
      // F-113: a multi-paragraph note (block.blocks, from parse.mjs's pushNote) keeps each
      // paragraph as its own <p>, round-tripping the paragraph break BANA 16.5.1d / B004 D
      // need instead of collapsing back into one <p>.
      if (Array.isArray(block.blocks) && block.blocks.length) {
        const ps = block.blocks.map((cb) => `<p>${serializeInlineSegments(cb.segments, cb.text, idAlloc)}</p>`).join('');
        return `${indent}<note id="${escapeXml(noteId)}" class="${cls}">${ps}</note>`;
      }
      const content = serializeInlineSegments(block.segments, block.text, idAlloc);
      return `${indent}<note id="${escapeXml(noteId)}" class="${cls}"><p>${content}</p></note>`;
    }

    case 'caption': {
      const content = serializeInlineSegments(block.segments, block.text, idAlloc);
      return `${indent}<caption>${content}</caption>`;
    }

    case 'attribution': {
      const content = serializeInlineSegments(block.segments, block.text, idAlloc);
      return `${indent}<byline${block._afterHeading ? ' class="bana-attribution"' : ''}>${content}</byline>`;   // see markAfterHeading
    }

    case 'verse':
    case 'poem':
    case 'play': {
      // A35: a block tagged fromLineTag came from a genuine source <line>/<ln> element (not
      // D5's bare verse-drama <p class="bai-verse">, which never sets this flag — see
      // parse.mjs's tag==='line' branch) and must round-trip as <line>, not collapse to
      // <p class="bai-verse">. (A block from parsePoem is swept up into <poem>/<linegroup>
      // by buildDtbookHierarchy's own isPoemLineBlock check before ever reaching serializeBlock,
      // so fromPoem is excluded here defensively, not because it's ever actually seen.)
      if (block.fromLineTag && !block.fromPoem) {
        const clsAttr = block.level ? ` class="level-${block.level}"` : '';
        const content = serializeInlineSegments(block.segments, block.text, idAlloc)
          .replace(/<span class="linenum">([^<]*)<\/span>/g, '<linenum>$1</linenum>');
        return `${indent}<line${clsAttr}>${content}</line>`;
      }
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
        // A22: keep an imported render="required" (D6: a description Emboss itself wrote,
        // with no block.descriptionRender at all, keeps the "optional" default).
        // A34: several source <prodnote>s in one <imggroup> (parse.mjs's parseImgGroup) are kept
        // separately in block.descriptions — write one <prodnote> per entry, each with its own
        // render value, instead of the single merged block.description/descriptionRender pair
        // (still used, unchanged, by every other reader — the braille formatter, docx export,
        // the editor's display). A block with no descriptions array (an Emboss-created
        // description, or one built by hand with no source <prodnote> at all) keeps the old
        // single-<prodnote> shape exactly as before this fix.
        if (Array.isArray(block.descriptions) && block.descriptions.length) {
          for (const d of block.descriptions) {
            if (!d || !d.text) continue;
            parts.push(`<prodnote render="${d.render === 'required' ? 'required' : 'optional'}">${escapeXml(d.text)}</prodnote>`);
          }
        } else if (hasDescription) {
          parts.push(`<prodnote render="${block.descriptionRender === 'required' ? 'required' : 'optional'}">${escapeXml(block.description)}</prodnote>`);
        }
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

    case 'code': {
      // A code / puzzle block with a formatter flag (dotLocator, keepSpaces, spaceLetters): <p class="bana-code …"> with <br/> line breaks
      // (banaBlockAttrs adds the tokens). Without a flag it keeps the plain default below.
      // Every code block gets this form (banaBlockAttrs adds bana-code): as a plain <p> it re-read as a paragraph, not a grade-1 passage.
      if (block.text) return `${indent}<p>${String(block.text).split('\n').map((l) => escapeXml(l)).join('<br/>')}</p>`;
      return '';
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
// A19/A21/D5: a block parse.mjs's parsePoem read out of a genuine <poem> is tagged
// block.fromPoem (see parse.mjs). Only those are swept back up into <poem>/<linegroup>/<line>;
// an untagged play/verse block (BrailleBlaster's bai-verse — verse *drama*, or a hand-built AST
// with no source <poem> at all) keeps going through serializeBlock's ordinary
// <p class="bai-verse"> case below, per D5.
function isPoemLineBlock(b) {
  return !!(b && b.type === 'play' && b.subtype === 'verse' && b.fromPoem);
}
function isPoemBreakBlock(b) {
  return !!(b && b.type === 'indicator' && b.fromPoem && (b.kind === 'line' || b.kind === 'stanza'));
}
function isPoemPagenumBlock(b) {
  return !!(b && b.type === 'pagenum' && b.fromPoem);
}
/** True when every cell of the row that prints text is wholly bold (what parse.mjs's firstRowIsBoldHeader promotes to a heading row). */
function rowIsWhollyBold(row) {
  let sawText = false;
  for (const v of row || []) {
    for (const s of cellSegments(v)) {
      if (s.type !== 'text' || !s.text || !s.text.trim()) continue;
      sawText = true;
      if (!((s.tf || 0) & TF_BOLD)) return false;
    }
  }
  return sawText;
}
// 30d: a poem's own title / author / byline (parse.mjs's parsePoem tags them poemRole 'title' | 'author' | 'byline'). They are
// written back INSIDE the <poem> (DTD: poem (title | author | hd | … | byline | linegroup | …)*) so a save -> reopen reads the
// same model; written outside (a section heading and a <byline>) the reopened author line became a second, unconnected heading.
function isPoemHeadBlock(b) {
  if (!b || typeof b.poemRole !== 'string') return false;
  return (b.type === 'heading' && b.poemRole === 'title') || (b.type === 'attribution' && (b.poemRole === 'author' || b.poemRole === 'byline'));
}
/**
 * 30d: an attribution (byline) standing right before a poem's own lines is that poem's author: a copy of it tagged as one (else
 * null). The editor keeps a poem line's provenance (fromPoem) but not the poemRole of the title / author line above it, so a file
 * opened and saved from the editor would otherwise write the author as a <byline> straight after the poem title's <h2>, which the
 * reader takes for a second, unconnected heading (BANA 4.3.3, Example 4-2) — the braille changed on reopening. Written inside the
 * <poem> as <author> it is read back as the same attribution. (A byline before a poem that really was outside it reads back as an
 * attribution either way, so nothing else changes.)
 */
function adoptedAuthorOf(blocks, idx) {
  const b = blocks[idx];
  const next = blocks[idx + 1];
  if (!b || b.type !== 'attribution' || typeof b.poemRole === 'string' || !isPoemLineBlock(next) || next.bareLinegroup) return null;
  return { ...b, poemRole: 'author', poemId: next.poemId };
}
/** The element a poem's head block is written as: <title> (a level other than 2 rides as class="bana-level-N", as an <hd> does), <author> or <byline>. */
function renderPoemHead(b, indent, idAlloc) {
  const { classes, title } = banaBlockAttrs(b);
  if (b.type === 'heading') { const lv = Number(b.level); if (Number.isInteger(lv) && lv >= 1 && lv <= 6 && lv !== 2) classes.push(`bana-level-${lv}`); }
  const attrs = (classes.length ? ` class="${classes.join(' ')}"` : '') + (title != null ? ` title="${escapeXml(title)}"` : '');
  if (b.type === 'heading') return `${indent}<title${attrs}>${headingContentXml(b, idAlloc)}</title>`;
  return `${indent}<${b.poemRole}${attrs}>${serializeInlineSegments(b.segments, b.text, idAlloc)}</${b.poemRole}>`;
}

/**
 * Renders a contiguous run of fromPoem-tagged blocks (verse lines, stanza-break indicators,
 * and any print-page turns among them) as a single <poem>, DTD: `poem (title | author | hd |
 * dateline | epigraph | byline | linegroup | line | pagenum | img | imggroup | sidebar)*`.
 * Lines are grouped into <linegroup>s (DTD: `linegroup (hd | ... | line | pagenum | ...)*`) on
 * each stanza-break indicator, so a save -> reload keeps the same stanza boundaries — parsePoem
 * synthesizes an {type:'indicator'} between two <linegroup>s exactly as it does between a
 * <p class="bai-stanza-break"> pair, so either shape round-trips to the same AST.
 *
 * A42: when `wrapInPoem` is false (the run came from a bare <linegroup>/<stanza>, no <poem> in
 * the source — see block.bareLinegroup in parse.mjs) the <poem> wrapper itself is omitted, so a
 * bare source linegroup round-trips as a bare <linegroup>, not a newly-invented <poem>.
 */
function renderPoemRun(runBlocks, indentLevel, idAlloc, wrapInPoem = true) {
  const indent = ' '.repeat(indentLevel);
  const groupIndent = wrapInPoem ? ' '.repeat(indentLevel + 2) : indent;
  const lineIndent = ' '.repeat(indentLevel + (wrapInPoem ? 4 : 2));
  // The run in order: stanzas (split at each stanza-break indicator) and the poem's own title / author lines, which stand at the
  // poem's level between them (30d).
  const groups = [];
  let cur = null;
  for (const b of runBlocks) {
    if (isPoemBreakBlock(b)) { cur = null; continue; }
    if (isPoemHeadBlock(b)) { groups.push({ head: b }); cur = null; continue; }
    if (!cur) { cur = []; groups.push(cur); }
    cur.push(b);
  }
  const groupsXml = groups
    .map((g) => {
      if (!Array.isArray(g)) return renderPoemHead(g.head, groupIndent, idAlloc);
      const itemsXml = g.map((b) => {
        if (isPoemPagenumBlock(b)) return `${lineIndent}${pagenumXml(b, idAlloc)}`;
        const bb = banaBlockAttrs(b);                                  // a verse line's own fields (poemMethod, pageBreakBefore, ignoreFont …)
        const clsAttr = (b.level || bb.classes.length) ? ` class="${[b.level ? `level-${b.level}` : '', ...bb.classes].filter(Boolean).join(' ')}"` : '';
        const ttlAttr = bb.title != null ? ` title="${escapeXml(bb.title)}"` : '';
        // Inside a <line>, a print line number is DTBook's own <linenum> (DTD: line
        // (%inline; | linenum)*), not the class-marked span prose uses (F-182).
        const content = serializeInlineSegments(b.segments, b.text, idAlloc)
          .replace(/<span class="linenum">([^<]*)<\/span>/g, '<linenum>$1</linenum>');
        return `${lineIndent}<line${clsAttr}${ttlAttr}>${content}</line>`;
      }).join('\n');
      return `${groupIndent}<linegroup>\n${itemsXml}\n${groupIndent}</linegroup>`;
    })
    .join('\n');
  if (!groupsXml) return '';
  if (!wrapInPoem) return groupsXml;
  return `${indent}<poem>\n${groupsXml}\n${indent}</poem>`;
}

// A19/A21 Stage 5: a block.divClass/block.divId pair (see parse.mjs's walk(), the "unknown
// container" branch's `tag === 'div' && cls` case) marks a run of blocks that came from one
// generic <div class="…"> the parser could not otherwise attribute to a single block. Two
// blocks belong to the *same* <div> only when both fields match — divClass alone would also
// merge two separate, adjacent, identically-classed <div>s into one.
function isDivClassBlock(b) {
  return !!(b && typeof b.divClass === 'string' && b.divClass && b.divId != null);
}

/**
 * Renders a contiguous run of same-<div> blocks (see isDivClassBlock) wrapped in one
 * <div class="…">…</div>. DTD: `div (%docblockorinline;)+`. Reuses the same per-block
 * dispatch buildDtbookHierarchy's own loop uses (including the caption-belongs-to-the-
 * following-table pairing) so a div's content renders exactly as it would outside a div.
 */
function renderDivRun(blocks, startIdx, endIdxExclusive, indentLevel, idAlloc) {
  const indent = ' '.repeat(indentLevel);
  const innerIndent = indentLevel + 2;
  const parts = [];
  for (let idx = startIdx; idx < endIdxExclusive; idx++) {
    const block = blocks[idx];
    if (!block) continue;
    const tableIdx = isCaptionBlock(block) ? tableIndexForCaption(blocks, idx, endIdxExclusive) : -1;
    if (tableIdx !== -1) {
      if (!blocks[tableIdx].caption && !blocks[tableIdx].title) {
        blocks[tableIdx].caption = block.text;
      }
      continue;
    }
    const xml = isCaptionBlock(block)
      ? serializeOrphanCaption(block, ' '.repeat(innerIndent), idAlloc)
      : serializeBlock(block, innerIndent, idAlloc);
    if (xml) parts.push(xml);
  }
  if (!parts.length) return '';
  return `${indent}<div class="${escapeXml(blocks[startIdx].divClass)}">\n${parts.join('\n')}\n${indent}</div>`;
}

// A35/A40: block.blockquoteId (see parse.mjs's tag==='blockquote' branch) marks a run of blocks
// that came from one source <blockquote> whose direct children could not each keep their own
// wrapper — either because they mixed a <line> with other block content (A35, e.g. a quoted
// letter's salutation/signature lines alongside its body <p>, hauy_history_valid.xml's dtb380 —
// those blocks are additionally tagged fromBlockquoteLines) or simply because there was more
// than one block child at all (A40, e.g. a plain multi-paragraph quoted letter, dtb725/dtb785 —
// no <line> involved). Only set for a blockquote that actually needed it — an ordinary
// single-paragraph blockquote is untouched (isBlockquoteRunBlock is false for it) and keeps
// going through serializeBlock's own per-paragraph <blockquote class="quote"><p class="quote">
// self-wrap, unchanged from before either fix.
function isBlockquoteRunBlock(b) {
  return !!(b && b.blockquoteId != null);
}

/**
 * Renders a contiguous run of same-blockquoteId blocks (see isBlockquoteRunBlock) wrapped in one
 * <blockquote>…</blockquote>, matching the source's own shape (DTD: `blockquote
 * (pagenum | %block;)*`, which allows <line> and <p> as direct siblings). Reuses the ordinary
 * per-block dispatch (serializeBlock) for everything in the run — a <line>-tagged block already
 * renders as <line> there (see the fromLineTag check in the 'verse'/'poem'/'play' case) — except
 * a `style:'quote'` paragraph, which serializeBlock would otherwise self-wrap in its own
 * <blockquote class="quote"> (the shape used when a <p> is the *only* thing in its blockquote):
 * here it is already inside the run's own reconstructed <blockquote>, so it renders as a plain
 * <p>, matching the source's own unwrapped <p> exactly. The reconstructed <blockquote> itself
 * keeps the source's own class (block.blockquoteClass, A40) when it had one, or is written bare
 * (no class at all) otherwise — matching A35's own, already-shipped default for this run
 * renderer; the single-paragraph self-wrap's own class="quote" is a different code path (D6's
 * own default marker for a blockquote Emboss itself only ever produces one paragraph for) and is
 * deliberately not reused here, so this fix changes no existing A35 output.
 */
function renderBlockquoteRun(blocks, startIdx, endIdxExclusive, indentLevel, idAlloc) {
  const indent = ' '.repeat(indentLevel);
  const innerIndent = indentLevel + 2;
  const parts = [];
  for (let idx = startIdx; idx < endIdxExclusive; idx++) {
    const block = blocks[idx];
    if (!block) continue;
    if (block.type === 'para' && block.style === 'quote') {
      const content = serializeInlineSegments(block.segments, block.text, idAlloc);
      // K6 / BANA §9.2.2d (displayIndent): same reasoning as serializeBlockCore's own
      // single-paragraph <blockquote class="quote"><p> self-wrap — the token has to sit on
      // THIS <p>, which withBanaAttrs's generic pass never reaches inside a run like this.
      const cls = [block.level ? `level-${block.level}` : '', block.displayIndent ? 'bana-display-indent' : ''].filter(Boolean).join(' ');
      const clsAttr = cls ? ` class="${cls}"` : '';
      parts.push(`${' '.repeat(innerIndent)}<p${clsAttr}>${content}</p>`);
      continue;
    }
    const xml = isCaptionBlock(block)
      ? serializeOrphanCaption(block, ' '.repeat(innerIndent), idAlloc)
      : serializeBlock(block, innerIndent, idAlloc);
    if (xml) parts.push(xml);
  }
  if (!parts.length) return '';
  const bqClass = blocks[startIdx] && blocks[startIdx].blockquoteClass;
  const openTag = bqClass ? `<blockquote class="${escapeXml(bqClass)}">` : '<blockquote>';
  return `${indent}${openTag}\n${parts.join('\n')}\n${indent}</blockquote>`;
}

/**
 * Title Page (block `titlepage`, BANA Formats 2016 §2.3, K29 Stage 1c; design doc
 * transcriber-pages-customisation-design.md §3.2). DTBook form (a level1 with no <h1> — the DTD's
 * level1 ::= h1, (%docblockorinline; | level2)+ makes the heading optional, unlike tnpage/sympage):
 *   <level1 class="bana-title-page">                        (auto/unedited: "bana-title-page bana-tp-auto")
 *     <div class="bana-tp-segment" title="Title">
 *       <p><span class="bana-field" title="title">Prentice Hall Literature</span></p>
 *       <p>Published by <span class="bana-field" title="publisher">Pearson</span></p>   (literal wording + a chip, same line)
 *     </div>
 *     ...
 *   </level1>
 * ALWAYS written with real, current content (unlike sympage's marker-only auto save): design §3.2 "the
 * last value is readable to any NIMAS reader". An auto page's content is computed fresh here, from the
 * document's own book-detail fields via the ONE shared template (titlePageFieldsFrom +
 * titlePageTemplateSegments, format/field-registry.mjs — the SAME template format/document.mjs's
 * traceTitlePage lays out) — never stored on the block. An edited page's block.segments (the editor's
 * own last-saved structure/wording) are refreshed live here too (refreshTitlePageValues — TP-6 "fields
 * are always live" applies to the SAVED FILE, not only to the editor's own in-memory card), so a save
 * always reflects the current book details even if the editor's own sync happened to lag behind. A
 * field chip's index into a list field (authors/isbn — see titlePageTemplateSegments) rides on the
 * same `title` attribute as `fieldName:idx` (e.g. `title="authors:0"`); a scalar field has no `:idx`.
 * A leading titlepage block always goes FIRST in <frontmatter>, before sympage/tnpage (BANA 2.2.1,
 * design §3.4: "every volume gets the Title Page"), regardless of its position in `blocks` (design
 * §4/§3.4: at most one, forced to the very start when the editor inserts it) — the caller
 * (exportToNimasXml) pulls it out by type, not as part of the leading tnpage/sympage run.
 */
// UK-9 (28 Sep): `mode` ('bana'/'ukaaf', default 'bana' — see exportToNimasXml's own call site for
// where it comes from) picks WHICH template an auto/untouched page's saved wording is computed from
// (field-registry.mjs's titlePageTemplateSegments), so a UKAAF book's saved XML shows UK-9's own
// content ("In one volume", no Transcriber segment) rather than always falling back to BANA's — a bug
// found and fixed 28 Sep while checking a real UKAAF save against daisy-validate.mjs (this file's own
// report). An EDITED page (block.segments) is unaffected either way: its own saved lines/wording are
// replayed exactly, mode-independent, same as traceTitlePage/refreshTitlePageValues elsewhere.
export function renderTitlePageLevel(block, doc, indentLevel = 6, mode = 'bana') {
  const ind = ' '.repeat(indentLevel);
  const inner = ' '.repeat(indentLevel + 2);
  const inner2 = ' '.repeat(indentLevel + 4);
  const auto = block.auto === true;
  const fields = titlePageFieldsFrom(doc || {});
  const segments = (!auto && Array.isArray(block.segments))
    ? refreshTitlePageValues(block.segments, fields, fields)
    : titlePageTemplateSegments(fields, fields, mode);
  const lines = [`${ind}<level1 class="bana-title-page${auto ? ' bana-tp-auto' : ''}">`];
  const renderPart = (p) => ('fld' in p ? `<span class="bana-field" title="${escapeXml(p.idx != null ? `${p.fld}:${p.idx}` : p.fld)}">${escapeXml(String(p.value ?? ''))}</span>` : escapeXml(String(p.lit ?? '')));
  let any = false;
  for (const seg of segments) {
    if (!seg || !Array.isArray(seg.lines) || !seg.lines.length) continue;
    any = true;
    lines.push(`${inner}<div class="bana-tp-segment" title="${escapeXml(seg.name)}">`);
    for (const l of seg.lines) {
      // etAl (2.3.5e's uncontracted "et al." tail) / cell3 (2.3.6f's cell-3 ISBN indent) are LAYOUT
      // hints from the shared template (field-registry.mjs's titlePageTemplateSegments) — carried on
      // the <p> so an edited page's braille (traceTitlePage) still applies them after a save/reload.
      const cls = [l.etAl ? 'bana-tp-etal' : null, l.cell3 ? 'bana-tp-cell3' : null].filter(Boolean).join(' ');
      lines.push(`${inner2}<p${cls ? ` class="${cls}"` : ''}>${(l.parts || []).map(renderPart).join('')}</p>`);
    }
    lines.push(`${inner}</div>`);
  }
  if (!any) lines.push(`${inner}<p></p>`);   // DTD needs at least one child (mirrors renderTnPageLevel/renderSymPageLevel)
  lines.push(`${ind}</level1>`);
  return lines.join('\n');
}

/**
 * Transcriber's Notes page (block `tnpage`, transcriber-pages-plan.md stages 2-3 / F-137, F-167).
 * DTBook form: an ordinary <level1> that carries class="bana-transcriber-notes" (DTD: level1 ::=
 * h1, (%docblockorinline; | level2)+ ; class is a free CDATA attribute):
 *   <level1 class="bana-transcriber-notes">
 *     <h1>Transcriber's Notes</h1>            (the block's own `heading`, else the default wording)
 *     <p>entry</p>                            (one <p> per entry)
 *     <p class="bana-tn-continued">more</p>   (a further paragraph of the same entry)
 *   </level1>
 * A leading run of these pages is written inside <frontmatter> (after the doctitle/docauthor);
 * one later in the book is written in place, closing any open levels first. parse.mjs recognises
 * the class (and, in <frontmatter>, a level1 whose heading reads "Transcriber's Notes").
 * An entry-less page still gets an empty <p> (the DTD wants at least one child).
 */
const TNPAGE_DEFAULT_HEADING = 'Transcriber\u2019s Notes';
export function renderTnPageLevel(block, indentLevel = 6, idAlloc = null) {
  const ind = ' '.repeat(indentLevel);
  const inner = ' '.repeat(indentLevel + 2);
  const heading = String(block.heading ?? '').trim() || TNPAGE_DEFAULT_HEADING;
  const lines = [`${ind}<level1 class="bana-transcriber-notes">`, `${inner}<h1>${escapeXml(heading)}</h1>`];
  const para = (o, cont) => {
    const has = o.segments ? o.segments.length : String(o.text ?? '').trim();
    if (!has) return;
    lines.push(`${inner}<p${cont ? ' class="bana-tn-continued"' : ''}>${serializeInlineSegments(o.segments, o.text, idAlloc)}</p>`);
  };
  for (const e of Array.isArray(block.entries) ? block.entries : []) {
    if (!e || typeof e !== 'object') continue;
    const before = lines.length;
    para(e, false);
    const hadOwn = lines.length > before;
    (Array.isArray(e.paragraphs) ? e.paragraphs : []).forEach((pp, i) => { if (pp && typeof pp === 'object') para(pp, hadOwn || i > 0); });
  }
  if (lines.length === 2) lines.push(`${inner}<p></p>`);
  lines.push(`${ind}</level1>`);
  return lines.join('\n');
}

/**
 * Special Symbols page (block `sympage`, BANA Formats 2.5; G8 stage 5). DTBook form: a <level1> with
 * class="bana-special-symbols" (plus "bana-symbols-auto" for an automatic page, derived from the
 * document's symbols by the formatter):
 *   <level1 class="bana-special-symbols bana-symbols-auto">
 *     <h1>Custom heading</h1>                      (only when the block has its own `heading`)
 *     <p class="bana-symbol" title="CELLS‖GLYPH">Meaning</p>   (one per entry; title = braille cells, then the
 *   </level1>                                                    print glyph, joined by TITLE_SEP)
 * An automatic page carries no entries; an edited page carries them explicitly (the explicit list wins).
 * A leading run of these pages goes in <frontmatter> BEFORE the Transcriber's Notes page (BANA 2.2.1).
 */
export function renderSymPageLevel(block, indentLevel = 6) {
  const ind = ' '.repeat(indentLevel);
  const inner = ' '.repeat(indentLevel + 2);
  const lines = [`${ind}<level1 class="bana-special-symbols${block.auto === true ? ' bana-symbols-auto' : ''}">`];
  const heading = String(block.heading ?? '').trim();
  if (heading) lines.push(`${inner}<h1>${escapeXml(heading)}</h1>`);
  for (const e of Array.isArray(block.entries) ? block.entries : []) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const braille = String(e.braille ?? '').trim();
    const print = String(e.print ?? '').trim();
    const title = braille || print ? ` title="${escapeXml(print ? `${braille}${TITLE_SEP}${print}` : braille)}"` : '';
    lines.push(`${inner}<p class="bana-symbol"${title}>${escapeXml(String(e.description ?? '').trim())}</p>`);
  }
  if (lines.length === 1 + (heading ? 1 : 0)) lines.push(`${inner}<p></p>`);
  lines.push(`${ind}</level1>`);
  return lines.join('\n');
}

export function buildDtbookHierarchy(blocks, indentBase = 6, fallbackTitle = 'Emboss Document', idAlloc = null) {
  blocks = mergeNoteGroups(mergePageTurnContinuations(blocks));
  if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
    const ind = ' '.repeat(indentBase);
    const pInd = ' '.repeat(indentBase + 2);
    // An empty document: the DTD's one required paragraph, empty (the reader reads no block from it). Writing the title here made
    // a cleared document reopen with a paragraph of it (A89, the nightly random-action run).
    return `${ind}<level1>\n${pInd}<p></p>\n${ind}</level1>`;
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
        const content = headingContentXml(headingBlock, idAlloc);
        lines.push(`${hIndent}<h${l}${headingBlock ? banaAttrString(headingBlock) : ''}>${content}</h${l}>`);
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
    if (block.type === 'titlepage') continue;   // K29 Stage 1c: pulled out and rendered separately by exportToNimasXml, always first in <frontmatter>
    if (block.type === 'tnpage' || block.type === 'sympage') {
      // Transcriber's Notes / Special Symbols page: a level1 of its own, so close every open level first.
      while (stack.length > 0) {
        const closedLvl = stack.pop();
        if (!levelHasChildren.pop()) lines.push(`${' '.repeat(closedLvl * 2 + indentBase)}<p></p>`);
        lines.push(`${' '.repeat(closedLvl * 2 + indentBase - 2)}</level${closedLvl}>`);
      }
      lines.push(block.type === 'sympage' ? renderSymPageLevel(block, indentBase) : renderTnPageLevel(block, indentBase, idAlloc));
      continue;
    }
    const tableIdx = isCaptionBlock(block) ? tableIndexForCaption(blocks, idx, blocks.length) : -1;
    if (tableIdx !== -1) {
      if (!blocks[tableIdx].caption && !blocks[tableIdx].title) {
        blocks[tableIdx].caption = block.text;
      }
      continue;
    }
    if ((block.type === 'heading' || block.type === 'title') && !isPoemHeadBlock(block)) {
      const lvl = Math.max(1, Math.min(6, block.level || 1));
      openLevel(lvl, block);
    } else if (isPoemLineBlock(block) || isPoemHeadBlock(block) || adoptedAuthorOf(blocks, idx)) {
      ensureLevel1();
      if (levelHasChildren.length > 0) {
        levelHasChildren[levelHasChildren.length - 1] = true;
      }
      const currentIndent = stack[stack.length - 1] * 2 + indentBase;
      // A19/A21: sweep up the whole contiguous run of this poem's lines (and any stanza
      // breaks/page turns among them) into one <poem>, instead of serializeBlock's per-line
      // <p class="bai-verse"> (see isPoemLineBlock above).
      // A42: a bare run (block.bareLinegroup, no <poem> in the source) only continues while
      // the next block shares the same bareLinegroupId, so two separate, adjacent bare
      // <linegroup>s (no stanza-break between them) aren't merged into one on export — same
      // "same shape is fine" simplification as Stage 5's divClass/divId equality check.
      const runFirst = adoptedAuthorOf(blocks, idx) || block;
      const runIsBare = !!runFirst.bareLinegroup;
      let j = idx;
      const runBlocks = [];
      while (j < blocks.length) {
        const cand = j === idx ? runFirst : blocks[j];
        if (!(isPoemLineBlock(cand) || isPoemBreakBlock(cand) || isPoemPagenumBlock(cand) || isPoemHeadBlock(cand))
          || !!cand.bareLinegroup !== runIsBare
          || (runIsBare && cand.bareLinegroupId !== runFirst.bareLinegroupId)
          || cand.poemId !== runFirst.poemId) break;       // 30d: two titled poems in a row stay two poems
        runBlocks.push(cand);
        j++;
      }
      const xml = renderPoemRun(runBlocks, currentIndent, idAlloc, !runIsBare);
      if (xml) lines.push(xml);
      idx = j - 1;
    } else if (isDivClassBlock(block)) {
      ensureLevel1();
      if (levelHasChildren.length > 0) {
        levelHasChildren[levelHasChildren.length - 1] = true;
      }
      const currentIndent = stack[stack.length - 1] * 2 + indentBase;
      // A19/A21 Stage 5: sweep up the whole contiguous run of this <div>'s own blocks (see
      // isDivClassBlock above) into one <div class="…">, instead of each block's ordinary
      // serialization losing the wrapper.
      let j = idx;
      while (j < blocks.length && isDivClassBlock(blocks[j]) && blocks[j].divClass === block.divClass && blocks[j].divId === block.divId) j++;
      const xml = renderDivRun(blocks, idx, j, currentIndent, idAlloc);
      if (xml) lines.push(xml);
      idx = j - 1;
    } else if (isBlockquoteRunBlock(block)) {
      ensureLevel1();
      if (levelHasChildren.length > 0) {
        levelHasChildren[levelHasChildren.length - 1] = true;
      }
      const currentIndent = stack[stack.length - 1] * 2 + indentBase;
      // A35/A40: sweep up the whole contiguous run of this <blockquote>'s own blocks (see
      // isBlockquoteRunBlock above) into one <blockquote>, instead of a <line>-tagged block
      // losing its wrapper, or a style:'quote' paragraph self-wrapping in its own separate
      // <blockquote class="quote"> — one per paragraph (A40).
      let j = idx;
      while (j < blocks.length && isBlockquoteRunBlock(blocks[j]) && blocks[j].blockquoteId === block.blockquoteId) j++;
      const xml = renderBlockquoteRun(blocks, idx, j, currentIndent, idAlloc);
      if (xml) lines.push(xml);
      idx = j - 1;
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
    const v = String(value).replace(/\s+/g, ' ').trim();   // an attribute's newline is read back as a space
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
// Subscript/superscript arrive as private-use markers inside the text (format/text-style.mjs SCRIPT_MARKS — the
// readers bracket a sub/superscript run with them, and the braille step turns them into UEB level signs). A saved
// file carried them raw until 30 Sep (Paul: boxes in the text, and the "unknown symbols" notice listed them); they are
// written as DTBook <sub>/<sup> here, once, over the finished document, so no text-writing path can miss them.
// Markers inside an attribute value are dropped (their text kept). A marked run that crosses an inline tag (a
// superscript that is also italic, say) is closed before the tag and reopened after it, so the elements stay
// properly nested; at any other tag an unclosed run just ends. A run that is empty or only spaces (Word raises the
// space before a footnote number) is written as its plain space.
const SCRIPT_INLINE_TAGS = new Set(['em', 'strong', 'span', 'a', 'cite', 'code', 'abbr', 'acronym', 'q', 'dfn', 'kbd', 'samp', 'w', 'sent', 'noteref', 'annoref', 'br', 'sub', 'sup', 'bdo']);
export function scriptMarkersToXml(xml) {
  const OPEN_SUB = '', OPEN_SUP = '', END = '';
  if (typeof xml !== 'string' || !/[-]/.test(xml)) return xml;
  let out = '';
  let open = null;                                            // 'sub' | 'sup' | null
  let i = 0;
  while (i < xml.length) {
    const c = xml[i];
    if (c === '<') {
      const j = xml.indexOf('>', i);
      if (j < 0) { out += xml.slice(i); break; }
      const tag = xml.slice(i, j + 1).replace(/="[^"]*"/g, (a) => a.replace(/[-]/g, ''));   // no markers inside attribute values
      const name = (/^<\/?([A-Za-z][\w:.-]*)/.exec(tag) || [])[1] || '';
      const inline = SCRIPT_INLINE_TAGS.has(name.replace(/^.*:/, ''));
      if (open) out += `</${open}>`;
      out += tag;
      if (open && inline) out += `<${open}>`; else open = null;
      i = j + 1;
    } else if (c === OPEN_SUB || c === OPEN_SUP) {
      if (open) out += `</${open}>`;
      open = c === OPEN_SUB ? 'sub' : 'sup';
      out += `<${open}>`;
      i++;
    } else if (c === END) {
      if (open) { out += `</${open}>`; open = null; }
      i++;
    } else {
      out += c;
      i++;
    }
  }
  if (open) out += `</${open}>`;
  return out.replace(/<(sub|sup)>(\s*)<\/\1>/g, '$2');   // an empty or space-only run is just its space
}

export function exportToNimasXml(docModel, options = {}) {
  // F-S4-01: the writer pairs captions with tables by writing into the table block; work on a
  // copy so saving never changes the caller's live model.
  try { docModel = structuredClone(docModel); } catch { /* not cloneable: export in place as before */ }
  const blocks = Array.isArray(docModel) ? docModel : (docModel?.blocks || []);
  // F-S4-05: a null list item (or null segment) is dropped rather than thrown on.
  (function dropNulls(list) {
    for (const b of list || []) {
      if (!b || typeof b !== 'object') continue;
      if (Array.isArray(b.items) && b.items.some((x) => x == null)) b.items = b.items.filter((x) => x != null);
      if (Array.isArray(b.segments) && b.segments.some((x) => x == null)) b.segments = b.segments.filter((x) => x != null);
      dropNulls(b.items); dropNulls(b.blocks);
    }
  })(blocks);
  // An attribution straight after a heading is written as <byline class="bana-attribution">: a bare <byline> there is read back as
  // a second heading (K2 / BANA 4.3.3, an author's name under a title in a source book), so the attribution was lost (A89).
  (function markAfterHeading(list) {
    if (!Array.isArray(list)) return;
    list.forEach((b, i) => {
      if (!b || typeof b !== 'object') return;
      const attribution = b.type === 'attribution' || (b.type === 'para' && b.style === 'attribution');
      if (attribution && list[i - 1] && list[i - 1].type === 'heading') Object.defineProperty(b, '_afterHeading', { value: true });
      markAfterHeading(b.blocks);
    });
  })(blocks);
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

  // K29 Stage 1c: the Title Page (at most one, design §3.4) always goes FIRST in <frontmatter>,
  // ahead of Special Symbols/Transcriber's Notes (BANA 2.2.1), wherever it sits in `blocks` — the
  // editor only ever inserts it at the start of the book, but this does not depend on that.
  const titlePageBlock = blocks.find((b) => b && b.type === 'titlepage');
  const docForTitlePage = isModel ? docModel : { blocks };
  // UK-9: the caller's own format mode (editor.mjs passes `mode: settings.mode` — see
  // renderTitlePageLevel's own comment for why an auto page needs this); default 'bana' keeps every
  // existing caller that has not been updated (scripts, older tests) exactly as it was.
  const tpMode = options.mode === 'ukaaf' || options.standard === 'ukaaf' ? 'ukaaf' : 'bana';
  const titlePageXml = titlePageBlock ? renderTitlePageLevel(titlePageBlock, docForTitlePage, 6, tpMode) : '';
  // The titlepage block (if any) is transparent to the leading-run scan below: it is always its own
  // block rendered separately (above), never counted as part of `blocks` for "leading"/"in place"
  // purposes, so a Special Symbols/Transcriber's Notes page right after it is still "leading" too.
  const blocksNoTP = titlePageBlock ? blocks.filter((b) => !(b && b.type === 'titlepage')) : blocks;
  // A leading run of Transcriber's Notes pages goes in <frontmatter> (renderTnPageLevel).
  let lead = 0;
  while (lead < blocksNoTP.length && blocksNoTP[lead] && (blocksNoTP[lead].type === 'tnpage' || blocksNoTP[lead].type === 'sympage')) lead++;
  const leadBlocks = blocksNoTP.slice(0, lead);
  // Special Symbols pages come before the Transcriber's Notes pages (BANA 2.2.1); order otherwise kept.
  const frontPagesXml = [...(titlePageXml ? [titlePageXml] : []),
    ...leadBlocks.filter((b) => b.type === 'sympage').map((b) => renderSymPageLevel(b, 6)),
    ...leadBlocks.filter((b) => b.type === 'tnpage').map((b) => renderTnPageLevel(b, 6, idAlloc))].map((x) => `\n${x}`).join('');
  const bodyXml = lead && lead === blocksNoTP.length
    ? '      <level1>\n        <p></p>\n      </level1>'
    : markEdgeSpaces(buildDtbookHierarchy(lead ? blocksNoTP.slice(lead) : blocksNoTP, 6, title, idAlloc));
  let headXml = buildHeadMetadata(meta, { title, uid, lang, date });
  // Document-level formatter options (spacedEllipsis, elisionApostrophe, typeformWordPunct): written only when set.
  for (const o of BANA_DOC_OPTIONS) {
    const c = docOptionContent(o, isModel && docModel[o.field] !== undefined ? docModel[o.field] : meta[o.field]);
    if (c != null) headXml += `${headXml ? '\n' : ''}    <meta name="${o.meta}" content="${escapeXml(c)}" />`;
  }
  // Every author of the source (<docauthor> may repeat), unless the caller names one.
  const authors = !options.author && Array.isArray(meta.docauthors) && meta.docauthors.length ? meta.docauthors : (author ? [author] : []);
  const docauthorXml = authors.map((a) => `\n      <docauthor>${escapeXml(a)}</docauthor>`).join('');

  const fullXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd" [
${NIMAS_INTERNAL_SUBSET}
]>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML" version="2005-3" xml:lang="${escapeXml(lang)}">
  <head>
${headXml}
  </head>
  <book>
    <frontmatter>
      <doctitle>${escapeXml(title)}</doctitle>${docauthorXml}${frontPagesXml}
    </frontmatter>
    <bodymatter>
${bodyXml}
    </bodymatter>
  </book>
</dtbook>
`;
  return scriptMarkersToXml(dropDanglingInternalLinks(fullXml));
}

/**
 * A41: an internal `#id` link whose target id is nowhere in the saved document is not
 * valid NIMAS (e.g. glossary.xml, an excerpt whose page markers were cut out, leaving 305
 * `href="#p…"` with nothing to point at). Rather than lose the link's text, the export
 * drops just the wrapping `<a>` around it — as if the source had never wrapped those words
 * in a link — and keeps everything else untouched. An external link (anything not starting
 * with "#") and a link whose target id genuinely is in the document (before or after it —
 * a forward reference is fine) are left exactly as written, byte for byte.
 *
 * A post-pass over the fully serialized document, rather than tracking ids as they are
 * allocated, because `<a href>` is written from three separate places (the segment-grouping
 * in `serializeInlineSegments`, and the two TOC/index page-number columns in `serializeBlock`
 * that build their own `<a href="${item.pageHref}">` directly) — this runs after all three,
 * against the ids the document actually ends up with, so it can't miss one or run stale.
 * @param {string} xml the fully serialized document
 * @returns {string}
 */
function dropDanglingInternalLinks(xml) {
  if (!xml || xml.indexOf('<a href="#') === -1) return xml;
  const ids = new Set(extractIds(xml));
  return xml.replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, (whole, href, inner) => {
    if (!href.startsWith('#')) return whole;
    return ids.has(href.slice(1)) ? whole : inner;
  });
}

// A89 (Paul, 2 Oct 2026): a space at the start or end of a paragraph, heading, list item or cell (or of a bold/italic run at that edge)
// is in the model - an editor paragraph can start with " / " after an equation, say - but a reader trims the edges of such an element,
// as it must for the incidental whitespace of a pretty-printed file. The writer says the spaces are meant: xml:space="preserve" on the
// element (DTBook allows it on every element, coreattrs), which parse.mjs honours. An element without an edge space gets nothing.
// A pass over the finished markup, like scriptMarkersToXml, so no text-writing path can miss one.
const EDGE_TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hd', 'li', 'lic', 'td', 'th', 'dt', 'dd', 'caption', 'byline', 'line', 'prodnote', 'bridgehead']);
const EDGE_INLINE_TAGS = new Set(['em', 'strong', 'sub', 'sup', 'span', 'a', 'cite', 'q', 'abbr', 'acronym', 'dfn', 'code', 'kbd', 'samp', 'w', 'sent', 'bdo']);
const EDGE_TOKEN_RE = /<!--[\s\S]*?-->|<[?!][^>]*>|<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
export function markEdgeSpaces(xml) {
  if (typeof xml !== 'string' || xml.indexOf(' ') < 0) return xml;
  const stack = [];                                           // open elements: { name, text (is an EDGE_TEXT_TAGS element), open (index of its '>'), seen, lead, trail, hasSpace }
  const inserts = [];
  let m;
  EDGE_TOKEN_RE.lastIndex = 0;
  while ((m = EDGE_TOKEN_RE.exec(xml))) {
    if (m[5] !== undefined) {                                 // character data
      // belongs to the nearest text element, if only inline elements lie between it and here
      let f = null;
      for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].text) { f = stack[i]; break; } if (!stack[i].inline) break; }
      if (!f) continue;
      const t = m[5], nl = t.includes('\n');
      if (!f.seen && !(nl && !t.trim())) { f.seen = true; f.lead = /^[ \t]/.test(t); }   // indentation between tags is not text
      f.trail = /[ \t]$/.test(t) && !(nl && /\n[ \t]*$/.test(t));
      continue;
    }
    if (m[2] === undefined) continue;                        // comment, declaration
    const closing = m[1] === '/', selfClosing = m[4] === '/';
    const local = m[2].replace(/^.*:/, '');
    if (closing) {
      const f = stack.pop();
      if (f && f.text && (f.lead || f.trail) && !/xml:space\s*=/.test(f.attrs)) inserts.push(f.open);
      continue;
    }
    // an opening (or empty) tag: a text element before it that has not had text yet starts with this element; its trailing space ends here
    const inline = EDGE_INLINE_TAGS.has(local);
    if (!inline) for (let i = stack.length - 1; i >= 0; i--) { if (stack[i].text) { stack[i].seen = true; stack[i].trail = false; break; } if (!stack[i].inline) break; }
    if (!selfClosing) stack.push({ name: local, text: EDGE_TEXT_TAGS.has(local), inline, open: m.index + m[0].length - 1, attrs: m[3], seen: false, lead: false, trail: false });
  }
  if (!inserts.length) return xml;
  inserts.sort((a, b) => b - a);
  let out = xml;
  for (const at of inserts) out = out.slice(0, at) + ' xml:space="preserve"' + out.slice(at);
  return out;
}

export const exportToNimas = exportToNimasXml;

