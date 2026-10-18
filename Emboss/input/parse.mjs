// Input parsers: various document formats -> the structured document model.
// Model: { title: string|null, blocks: [{type, ...}] }
//   types: title | heading{level} | para{text|segments} | list{items:[{text,level,marker}]}
//        | note{text} | math{mathml|latex}
// A `para` block carries EITHER a plain `text` string (the original,
// unchanged path) OR a `segments` array of
//   { type: 'text', text } | { type: 'math', mathml } | { type: 'math', latex }
// for a paragraph with inline maths mixed into running text.
import { ommlElementToMathML, MATH_NS, texOnlyMathToMathML } from './omml.mjs';
import { readOleEquation } from './mtef.mjs';
import { metafileToSvg, dibToPngBytes } from './metafile.mjs';
import { parseDoc, isWordBinary } from './doc.mjs';
import { pictureNameAsAlt } from './doc-art.mjs';
import { SCRIPT_MARKS } from '../format/text-style.mjs';
import { mathmlToLatex } from '../engine/mathml-to-latex.mjs';
import { cellFromSegments, cellIsBlank, cellSegments } from '../format/cell-markup.mjs';
import { classifyTable } from './table-kind.mjs';
import { loadWarnings } from './load-audit.mjs';
import { docxLangContext, docxRunLang, odtLangContext, odtTextLang, primaryLang, lcidLang, scriptSlot, foreignLangOf, setMarkupMainLang, markupForeignLang, markupHasForeignLang, keepLangOn, langAttrOf, markdownInlineLang, finishLanguages } from './lang.mjs';
import { NUMBER_PREFIX_RE, synthesizeOrderedMarker, readBanaFlags, isNonDotBulletMarker, isBulletMarker, isCustomBulletMarker, bulletName, BULLET_NAMES, BANA_DOC_OPTIONS, docOptionValue, classifyOrderedMarkerGroup } from './nimas-export.mjs';

// ---------- $-delimited LaTeX (shared by parseText / parseMarkdown) ----------
//
// $$...$$ -> a standalone display-math block ({type:'math', latex}), splitting
// the surrounding text (if any) into separate paragraph block(s) before/after.
// Inline $...$ -> split the paragraph into segments (text and {type:'math',
// latex}), keeping the maths in the flow of the running text. To avoid
// misreading a currency amount ("$5 and $10") as inline math, a $ pair only
// counts as a delimiter when the content between the two $ is non-empty and
// does NOT start or end with whitespace or a digit (a real LaTeX span like
// $x^2$ or $\pi$ starts with a letter/backslash, never a digit the way "$5"
// does) — this also stops a run like "$5 and $10" from ever matching, since
// every candidate span there starts or ends on a digit. A single, unmatched
// "$" (or one with no valid partner) is left as plain text untouched.
// ---------- List items with more than one paragraph (item.blocks) ----------
// A list item may carry `blocks: [...]`: its further content after the first paragraph (more paragraphs, a table...),
// formatted by document.mjs formatItemBlocks (BANA §10.3.3 / §16.3d: further paragraphs two cells right of the
// runover). parseDtbook's list-item reader marks each <p> boundary with ITEM_PARA_SEP (a private-use character, never
// real text) and each table with an {type:'itemblock', el} segment; splitItemParagraphs cuts the item there.
// U+E010, not U+E000: U+E000–U+E002 are the sub/superscript markers (format/text-style.mjs SCRIPT_MARKS) — sharing U+E000
// split a list item at every subscript (found 30 Sep).
const ITEM_PARA_SEP = '\ue010';
// ---------- Box/sidebar colour naming (K7, BANA 7.5.1-7.5.2) ----------
// Word/HTML give a box's colour as a hex triplet (or an HTML/VML named colour); K7's own field
// (format/field-registry.mjs `boxColor`) expects one plain word - "blue", "grey" - read aloud in
// a transcriber's note, never a hex or a compound CSS name ("steelblue"). CSS_NAMED_RGB resolves
// the common named colours (HTML/CSS keywords, and the handful of legacy VML/Word names actually
// seen in the wild) to RGB; hexToColorName then classifies ANY RGB triplet by HUE (converted to
// HSL) rather than by raw RGB distance to a fixed palette — RGB-distance was tried first and
// mis-scored real Word/HTML box tints: a typical light pastel shading colour (Word's own
// "Light Blue" cell shading, #ADD8E6/CSS "lightblue") sits, in raw RGB terms, roughly as close
// to pink as to blue (both have a high red channel), even though it plainly reads as blue to a
// sighted reader. Hue is independent of how light or dark a colour is, so a pale tint and its
// saturated version land in the same named band. A colour indistinguishable from plain paper
// (near-white) or ink (near-black... actually named "black") is handled by lightness alone
// before hue is even consulted: a box merely shaded a whisper off pure white has nothing worth
// naming, and a false "white" box colour would be actively misleading (BANA only wants the
// colour named when it visibly sets one box apart from another - K7 / document.mjs's
// boxColorPrefix + computeBoxColorsUniform); a very low-saturation colour of any lightness is
// "grey" regardless of its nominal hue (a hue computation on a near-grey RGB triplet is noisy
// and meaningless — hue is undefined at s=0).
const CSS_NAMED_RGB = {
  black: [0, 0, 0], white: [255, 255, 255], silver: [192, 192, 192], gray: [128, 128, 128], grey: [128, 128, 128],
  red: [255, 0, 0], maroon: [128, 0, 0], orange: [255, 165, 0], yellow: [255, 255, 0], gold: [255, 215, 0],
  green: [0, 128, 0], lime: [0, 255, 0], olive: [128, 128, 0], teal: [0, 128, 128], cyan: [0, 255, 255], aqua: [0, 255, 255],
  blue: [0, 0, 255], navy: [0, 0, 128], purple: [128, 0, 128], violet: [238, 130, 238], indigo: [75, 0, 130],
  pink: [255, 192, 203], magenta: [255, 0, 255], fuchsia: [255, 0, 255], brown: [165, 42, 42], tan: [210, 180, 140],
  beige: [245, 245, 220], khaki: [240, 230, 140], salmon: [250, 128, 114], coral: [255, 127, 80], crimson: [220, 20, 60],
  turquoise: [64, 224, 208], lavender: [230, 230, 250], plum: [221, 160, 221], orchid: [218, 112, 214],
  chocolate: [210, 105, 30], sienna: [160, 82, 45], peru: [205, 133, 63], skyblue: [135, 206, 235], lightskyblue: [135, 206, 250],
  steelblue: [70, 130, 180], royalblue: [65, 105, 225], slateblue: [106, 90, 205], darkgreen: [0, 100, 0],
  darkred: [139, 0, 0], darkblue: [0, 0, 139], darkorange: [255, 140, 0], darkgoldenrod: [184, 134, 11],
  lightgreen: [144, 238, 144], lightblue: [173, 216, 230], lightyellow: [255, 255, 224], lightpink: [255, 182, 193],
  lightgrey: [211, 211, 211], lightgray: [211, 211, 211], darkgray: [169, 169, 169], darkgrey: [169, 169, 169], dimgray: [105, 105, 105], dimgrey: [105, 105, 105],
};
// Parses a hex triplet (#rgb / #rrggbb, with or without '#'), an rgb()/rgba() function, or one
// of CSS_NAMED_RGB's keywords into [r,g,b]; null for "auto"/"none"/"transparent"/anything else
// unrecognised (a theme-colour reference with no literal RGB, e.g., is left deliberately silent
// rather than guessing).
function parseCssColorToRgb(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v || v === 'auto' || v === 'none' || v === 'transparent' || v === 'inherit' || v === 'nil') return null;
  let m = /^#?([0-9a-f]{6})$/.exec(v);
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  m = /^#?([0-9a-f]{3})$/.exec(v);
  if (m) { const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16)); return [r, g, b]; }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  if (CSS_NAMED_RGB[v]) return CSS_NAMED_RGB[v];
  return null;
}
// [r,g,b] (0-255 each) -> [hue 0-360, saturation 0-1, lightness 0-1], the standard HSL
// conversion (hue is undefined/irrelevant at s=0 — never consulted in that case; see hexToColorName).
function rgbToHsl(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}
export function hexToColorName(raw) {
  const rgb = parseCssColorToRgb(raw);
  if (!rgb) return null;
  const [h, s, l] = rgbToHsl(...rgb);
  if (l >= 0.94) return null;    // near-white: nothing worth naming (see comment above)
  if (l <= 0.08) return 'black';
  if (s <= 0.12) return 'grey';  // low saturation, any hue: grey (hue is noise here)
  if (h >= 8 && h < 45 && l <= 0.35) return 'brown';   // dark, muted red-orange (chocolate/sienna/maroon-brown)
  if (h < 16 || h >= 350) return 'red';
  if (h < 45) return 'orange';
  if (h < 65) return 'yellow';
  if (h < 165) return 'green';
  if (h < 190) return 'cyan';
  if (h < 260) return 'blue';
  if (h < 320) return 'purple';
  return 'pink';
}

// ---------- Box/sidebar title (shared by every box source) ----------
// A box's own heading - a short bold run-in title, e.g. "Warning" or "Did you know?" - becomes
// the box's `title` field (the same field parseDtbook's <sidebar> reader, parseSidebar, already
// fills from a leading <hd>/<h*>; nimas-export/document.mjs's formatBox already know how to
// render it). Reused by every reader that builds a box from raw markup with no native "box"
// element of its own (DOCX pBdr paragraph runs, a bordered/shaded single-cell table, a DrawingML/
// VML text box, and HTML/EPUB's <aside>/role/epub:type/class boxes) so the heuristic - and its
// limits - live in exactly one place.
// Recognises two shapes for the leading block, conservatively:
//   1. a real heading (`{type:'heading', ...}`, any level) or a DOCX/HTML document "Title" style
//      block - always a title, however long: an explicit heading IS the box's title by
//      construction.
//   2. a short (<=60 character) plain paragraph whose every non-blank text run is bold
//      (segment.tf & TF_BOLD) - a title with no native heading style, common in Word/HTML boxes
//      built by hand. A paragraph with no segments at all (plain string only - no bold/italic/
//      link information survived) is deliberately left alone: there is no signal either way, so
//      guessing "first paragraph = title" would as often as not turn an ordinary opening
//      sentence of the box's body into a bogus title.
// Mutates `innerBlocks` (removes the title block) and returns the title text, or null.
export function extractBoxTitle(innerBlocks) {
  const first = innerBlocks[0];
  if (!first) return null;
  // A block built from `segments` alone (any inline emphasis/link/math at all) does not always
  // also carry a flattened `text` string (parseHtml's/parseDocx's own paragraph push skips it
  // whenever segments are kept) — recomputed here rather than depending on it being present.
  const flatText = (b) => (typeof b.text === 'string' ? b.text : (Array.isArray(b.segments) ? b.segments.map((s) => s.text || '').join('').replace(/\s+/g, ' ').trim() : ''));
  if (first.type === 'heading' || first.type === 'title') {
    const t = flatText(first);
    if (t) { innerBlocks.shift(); return t; }
    return null;
  }
  if (first.type === 'para' && Array.isArray(first.segments) && first.segments.length) {
    const t = flatText(first);
    if (t && t.length <= 60) {
      const textSegs = first.segments.filter((s) => s.type === 'text' && s.text && s.text.trim());
      if (textSegs.length && textSegs.every((s) => ((s.tf || 0) & 4) === 4)) {   // TF_BOLD === 4 (defined later in this file; the literal avoids a forward-reference)
        innerBlocks.shift();
        return t;
      }
    }
  }
  return null;
}

function trimPieceEdges(segs) {
  const out = segs.slice();
  while (out.length && out[0].type === 'text' && !/\S/.test(out[0].text || '')) out.shift();
  while (out.length && out[out.length - 1].type === 'text' && !/\S/.test(out[out.length - 1].text || '')) out.pop();
  if (out.length && out[0].type === 'text') out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, '') };
  const z = out.length - 1;
  if (z >= 0 && out[z].type === 'text') out[z] = { ...out[z], text: out[z].text.replace(/\s+$/, '') };
  return out;
}
// segments -> [{ segs } | { el }] in order: each paragraph's own segments, or a table element. Empty paragraphs are dropped.
function splitItemParagraphs(segs, keepEdges = false) {   // keepEdges (A89): the item says xml:space="preserve"
  const pieces = [];
  let cur = [];
  const close = () => { const t = keepEdges ? cur : trimPieceEdges(cur); if (t.some((s) => s.type !== 'text' || /\S/.test(s.text || ''))) pieces.push({ segs: t }); cur = []; };
  for (const s of segs || []) {
    if (!s) continue;
    if (s.type === 'itemblock') { close(); pieces.push({ el: s.el }); continue; }
    if (s.type === 'text' && typeof s.text === 'string' && s.text.includes(ITEM_PARA_SEP)) {
      s.text.split(ITEM_PARA_SEP).forEach((part, i) => { if (i > 0) close(); if (part) cur.push({ ...s, text: part }); });
      continue;
    }
    cur.push(s);
  }
  close();
  return pieces;
}

// A list item that already has a bullet marker must not also begin with its own bullet glyph
// (Project Gutenberg's "<li>• You pay ...</li>"): braille would show "_4 _4". The glyph is stripped only
// when it is a bullet glyph followed by whitespace, so "-1", "–5" (a range) and "*emphasis*" stay.
const DUP_BULLET_RE = /^\s*[•\-\*\u2022\u2023\u25E6\u2043\u2219\u25AA\u25AB\u25CF\u25CB\uF0B7\uF0A7\u00B7\u25A1\u25A0\u25B2\u2713\u2714]+\s+/;
// APH feedback 17 Oct 2026, point 16: an ARIA bulleted list - <div role="list"> whose children are all <div role="listitem"> each
// starting with a typed bullet (SAGE's EPUBs mark their bulleted lists so, "● …") - is a list: it is rebuilt as <ul>/<li> before the walk, so it reads
// exactly as one (and stripDuplicateBullet drops the typed bullet). Innermost lists first, so a nested one becomes a nested <ul>.
function htmlAriaListsToLists(root) {
  const d = root && root.ownerDocument;
  if (!d || !d.createElement || !root.getElementsByTagName) return;
  const role = (n) => (n && n.nodeType === 1 && n.getAttribute ? (n.getAttribute('role') || '').trim().toLowerCase() : '');
  const tagName = (n) => (n.tagName || n.localName || '').toLowerCase();
  const make = (like, name) => (d.createElementNS && like.namespaceURI ? d.createElementNS(like.namespaceURI, name) : d.createElement(name));
  const keep = (from, to) => { for (const a of ['id', 'lang', 'xml:lang', 'dir', 'class']) { const v = from.getAttribute(a); if (v != null && v !== '') to.setAttribute(a, v); } };
  const lists = [...root.getElementsByTagName('*')].filter((n) => role(n) === 'list' && !['ul', 'ol', 'li'].includes(tagName(n)));
  for (const listEl of lists.reverse()) {
    const kids = [...(listEl.childNodes || [])].filter((c) => c.nodeType === 1);
    if (!kids.length || !kids.every((c) => role(c) === 'listitem') || !listEl.parentNode) continue;
    // only a list whose every item starts with a typed bullet: a numbered one ("(1) …") or a reference list (no marker in print)
    // stays as it was, paragraphs with their own text
    if (!kids.every((c) => DUP_BULLET_RE.test(c.textContent || ''))) continue;
    const ul = make(listEl, 'ul');
    keep(listEl, ul);
    for (const c of [...listEl.childNodes]) {
      if (c.nodeType !== 1) { ul.appendChild(c); continue; }
      const li = make(c, 'li');
      keep(c, li);
      while (c.firstChild) li.appendChild(c.firstChild);
      ul.appendChild(li);
    }
    listEl.parentNode.replaceChild(ul, listEl);
  }
}
function stripDuplicateBullet(item) {
  if (!item || !item.marker || !(item.marker === '•' || isBulletMarker(item.marker) || isNonDotBulletMarker(item.marker))) return item;
  if (typeof item.text === 'string') item.text = item.text.replace(DUP_BULLET_RE, '');
  if (Array.isArray(item.segments)) {
    for (const g of item.segments) {
      if (!g) continue;
      if (g.type !== 'text') break;                      // maths / note ref first: nothing to strip
      if (g.text && g.text.trim()) { g.text = g.text.replace(DUP_BULLET_RE, ''); break; }
    }
  }
  return item;
}
const DISPLAY_MATH_RE = /\$\$([\s\S]+?)\$\$/g;
const INLINE_MATH_RE = /\$([^\s$](?:[^$]*[^\s$])?)\$/g;

// Split `chunk` on $$...$$ into a flat list of { text } / { latex, display:true }
// pieces, in order. Returns the original chunk as a single { text } piece if no
// $$ pair is found.
function splitDisplayMath(chunk) {
  const pieces = [];
  let i = 0, m;
  DISPLAY_MATH_RE.lastIndex = 0;
  while ((m = DISPLAY_MATH_RE.exec(chunk))) {
    if (m.index > i) pieces.push({ text: chunk.slice(i, m.index) });
    if (m[1].trim()) pieces.push({ latex: m[1].trim(), display: true });
    i = m.index + m[0].length;
  }
  if (i < chunk.length) pieces.push({ text: chunk.slice(i) });
  return pieces.length ? pieces : [{ text: chunk }];
}

// Reduce $...$ false positives on ordinary prose: a pure number is currency
// ("$100$"), and a multi-word span with no maths operator is prose ("$Profit rose$").
// Single tokens ($x$, $variable$) and anything with a maths operator/brace are kept.
function looksLikeMath(s) {
  if (!s) return false;
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return false;                        // pure number -> currency
  if (/\s/.test(s) && !/[\\^_{}=+*/<>|~×·±≤≥∑∫√-]/.test(s)) return false; // multi-word, no maths token -> prose
  return true;
}

// Split a piece of plain text on inline $...$ into segments (text / math).
// Returns null if there's no valid inline-math delimiter pair in it.
function splitInlineMath(text) {
  if (!text.includes('$')) return null;
  const segments = [];
  let i = 0, any = false;
  INLINE_MATH_RE.lastIndex = 0;
  let m;
  while ((m = INLINE_MATH_RE.exec(text))) {
    const content = m[1].trim();
    if (!looksLikeMath(content)) continue;   // currency/prose false positive: leave the $...$ as literal text
    any = true;
    // Keep the raw between-text (incl. its boundary spaces) so the formatter can
    // reproduce the source spacing faithfully — trimming here is what wrongly
    // detached a trailing "." from the preceding equation. formatSegmentedPara
    // collapses internal runs and trims the paragraph edges.
    if (m.index > i) {
      const t = text.slice(i, m.index);
      if (t) segments.push({ type: 'text', text: t });
    }
    segments.push({ type: 'math', latex: content });
    i = m.index + m[0].length;
  }
  if (!any) return null;
  if (i < text.length) {
    const t = text.slice(i);
    if (t) segments.push({ type: 'text', text: t });
  }
  return segments;
}

// Turn a chunk of text into one or more blocks, extracting $$ display math
// (as standalone math blocks) and $ inline math (as segments within a
// paragraph). Falls back to a plain `{type:'para', text}` block wherever
// there's no (valid) math delimiter, so ordinary text (incl. a lone "$" or
// an apostrophe) is completely unaffected — same output as before this
// feature existed.
function textChunkToBlocks(chunk) {
  if (!chunk.includes('$')) return [{ type: 'para', text: chunk }];
  const blocks = [];
  for (const piece of splitDisplayMath(chunk)) {
    if (piece.display) { blocks.push({ type: 'math', latex: piece.latex }); continue; }
    const t = piece.text;
    if (!t.trim()) continue;
    const segments = splitInlineMath(t);
    if (segments && segments.length) blocks.push({ type: 'para', segments });
    else blocks.push({ type: 'para', text: t.replace(/\s+/g, ' ').trim() });
  }
  return blocks.length ? blocks : [{ type: 'para', text: chunk }];
}

// ---------- plain text ----------
// Blank-line-separated chunks become paragraphs. A lone first line followed by a
// blank line is treated as the title.
export function parseText(str) {
  const chunks = (str ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
  const blocks = [];
  let title = null;
  chunks.forEach((chunk, i) => {
    const oneLine = !chunk.includes('\n');
    if (i === 0 && oneLine && chunks.length > 1) { title = chunk; blocks.push({ type: 'title', text: chunk }); }
    else blocks.push(...textChunkToBlocks(chunk.replace(/\n/g, ' ')));
  });
  return { title, blocks };
}

// ---------- HTML (browser) ----------
// Serialize a <math> element back to a MathML string. Prefers XMLSerializer
// (available in both browsers and @xmldom/xmldom) over outerHTML, since
// outerHTML on an HTML-parsed <math> island may not be well-formed XML.
function mathOuterXml(el) {
  if (!el) return '';
  if (typeof XMLSerializer !== 'undefined') {
    try { return new XMLSerializer().serializeToString(el); } catch { /* fall through */ }
  }
  if (typeof el.toString === 'function') {
    try {
      const s = el.toString();
      if (s && s !== '[object Object]' && s !== '[object Element]') return s;
    } catch { /* fall through */ }
  }
  return el.outerHTML || '';
}

// A46: also true when a descendant carries emphasis (<b>/<strong>/<i>/<em>/<u>) or a
// real link (<a href>) — otherwise htmlParagraphSegments' caller falls back to the
// plain-text path (node.textContent), which is exactly how bold/italic/links were
// being silently dropped on HTML/EPUB import (verified: `<p>Plain <b>bold</b> and
// <i>italic</i> and <a href="…">a link</a>.</p>` produced one paragraph with no
// segments at all before this fix).
// UEB 9.5.1: text-decoration[-line]: line-through (htmlParagraphSegments's own copy of this
// regex, below, is what actually reads it — this one only has to answer "is there one at
// all", for hasInlineElements' gate). Declared here (used by both) rather than duplicated.
const HAS_LINE_THROUGH_STYLE_RE = /text-decoration(-line)?\s*:\s*[^;"']*\bline-through\b/i;
// LINK-2 (Paul, 28 Sep 2026, KD round-2 Q1): the CSS-only spelling of underline (no <u> tag),
// same shape as HAS_LINE_THROUGH_STYLE_RE just above — a book's stylesheet setting
// `text-decoration: underline` directly on an <a> (or an ancestor of one) means print showed
// that link underlined, exactly like a literal <u> does (walk, below, treats them the same).
// A bare <a href> with neither is NOT underlined (browsers' own default link underline is not
// a signal the print stylesheet actually chose to keep).
const HAS_UNDERLINE_STYLE_RE = /text-decoration(-line)?\s*:\s*[^;"']*\bunderline\b/i;
// K5 (UEB §9): an HTML/EPUB signal for script/cursive text. Two reasonably clear signals only
// (transcription-policy.md's own bar for a reader-detected typeform) — a `class="script"` token
// (also nimas-export.mjs's own DTBook/NIMAS round-trip convention, §K5) or a `style="font-family:
// …"` naming the CSS generic family `cursive` or a known script/handwriting face name
// (SCRIPT_FONT_RE, shared with the .docx run-font reader). A font merely *looking* stylised with
// no such name, or a class that happens to contain "script" as a substring ("postscript",
// "description"), is deliberately NOT matched.
const SCRIPT_CLASS_RE = /(^|\s)script(\s|$)/;
// Quotes are NOT excluded from the captured value (a multi-word font name is almost always
// quoted, e.g. `font-family: 'Segoe Script', cursive`) — SCRIPT_FONT_RE's own \b boundaries
// still match correctly either side of a quote character, since a quote is not a word character.
const FONT_FAMILY_RE = /font-family\s*:\s*([^;]+)/i;
function elementIsScript(el) {
  if (!el || !el.getAttribute) return false;
  if (SCRIPT_CLASS_RE.test(el.getAttribute('class') || '')) return true;
  const m = FONT_FAMILY_RE.exec(el.getAttribute('style') || '');
  return !!(m && (/\bcursive\b/i.test(m[1]) || SCRIPT_FONT_RE.test(m[1])));
}
// ---------- HTML presentation: CSS from style="…" and <style> rules (import fix list #33, #19) ----------
// The look a browser would give the text, for the cases that matter to braille: bold, italic, underline, line-through,
// upper case (text-transform, small caps: RUEB 9.6.1) and hidden (display:none, visibility:hidden). Word and Google Docs
// "web page" HTML write their bold/italic this way (`<span style="font-weight:700">`, `.c1{font-weight:700}`).
// Only simple selectors are understood: a tag, .class, #id, tag.class and lists of those. A rule with a combinator,
// an attribute or a pseudo-class (a:hover), and an @media block, is skipped.
const HTML_CSS_PROPS = new Set(['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'text-transform', 'font-variant', 'font-variant-caps', 'font', 'display', 'visibility']);
let HTML_RULES = [];                        // the rules of the document being read (parseHtml sets them)
let HTML_CTX = null;                        // the per-document reading context (notes, page numbers to place); see parseHtmlDoc
const HTML_CSS_CACHE = new WeakMap();       // element -> its resolved declarations
const HTML_FLAGS_CACHE = new WeakMap();     // element -> { bold, italic, underline, strike, upper, hidden }
const HTML_STATE_CACHE = new WeakMap();     // element -> the typeform it and its ancestors give its text
const HTML_PARENT = new WeakMap();          // a synthetic wrapper -> the element its children were cloned from
const htmlTag = (el) => ((el && (el.tagName || el.localName)) || '').toLowerCase();
const htmlTokens = (el, attr) => String((el && el.getAttribute && el.getAttribute(attr)) || '').toLowerCase().split(/\s+/).filter(Boolean);
const htmlParentOf = (n) => HTML_PARENT.get(n) || n.parentNode;
function parseCssDecls(body) {
  const out = {};
  for (const d of String(body || '').split(';')) {
    const k = d.indexOf(':');
    if (k < 0) continue;
    const prop = d.slice(0, k).trim().toLowerCase();
    if (!HTML_CSS_PROPS.has(prop)) continue;
    const raw = d.slice(k + 1).trim();
    out[prop] = { val: raw.replace(/!\s*important\s*$/i, '').trim().toLowerCase(), imp: /!\s*important\s*$/i.test(raw) };
  }
  return out;
}
function parseHtmlCss(text) {
  const rules = [];
  const src = String(text || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--|-->/g, '').replace(/@(charset|import|namespace)\b[^;{}]*;/gi, '');
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const prelude = src.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < src.length && depth > 0) { const c = src[j]; if (c === '{') depth++; else if (c === '}') depth--; j++; }
    const body = src.slice(open + 1, depth === 0 ? j - 1 : j);
    i = j;
    if (!prelude || prelude[0] === '@') continue;                       // @media, @font-face…: not read
    const decls = parseCssDecls(body);
    if (!Object.keys(decls).length) continue;
    for (const selText of prelude.split(',')) {
      const m = /^([a-z][a-z0-9-]*|\*)?((?:[.#][\w-]+)*)$/i.exec(selText.trim());
      if (!m || (!m[1] && !m[2])) continue;
      const parts = m[2] ? m[2].match(/[.#][\w-]+/g) : [];
      const classes = parts.filter((p) => p[0] === '.').map((p) => p.slice(1).toLowerCase());
      const ids = parts.filter((p) => p[0] === '#').map((p) => p.slice(1));
      const tag = m[1] && m[1] !== '*' ? m[1].toLowerCase() : null;
      rules.push({ tag, classes, ids, spec: ids.length * 100 + classes.length * 10 + (tag ? 1 : 0), decls });
    }
  }
  return rules;
}
// the rules bucketed by the one thing they select on, so an element is only checked against rules that could match it
function htmlRuleIndex(rules) {
  const idx = { byId: new Map(), byClass: new Map(), byTag: new Map(), any: [] };
  const add = (m, k, r) => { const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); };
  for (const r of rules) {
    if (r.ids.length) add(idx.byId, r.ids[0], r);
    else if (r.classes.length) add(idx.byClass, r.classes[0], r);
    else if (r.tag) add(idx.byTag, r.tag, r);
    else idx.any.push(r);
  }
  return idx;
}
function htmlCssOf(el) {
  let r = HTML_CSS_CACHE.get(el);
  if (r) return r;
  r = {};
  const prio = {};
  const put = (prop, d, pr) => { if (prio[prop] === undefined || pr >= prio[prop]) { prio[prop] = pr; r[prop] = d.val; } };
  if (el.getAttribute) {
    if (HTML_RULES.length) {
      const idx = HTML_RULES.index || (HTML_RULES.index = htmlRuleIndex(HTML_RULES));
      const tag = htmlTag(el);
      const classList = htmlTokens(el, 'class');
      const classes = new Set(classList);
      const id = el.getAttribute('id') || '';
      const cands = [...idx.any, ...(idx.byTag.get(tag) || []), ...(id ? idx.byId.get(id) || [] : [])];
      for (const c of classList) { const l = idx.byClass.get(c); if (l) cands.push(...l); }
      cands.sort((a, b) => a.order - b.order);
      for (const rule of cands) {
        if (rule.tag && rule.tag !== tag) continue;
        if (rule.ids.length && rule.ids.some((x) => x !== id)) continue;
        if (rule.classes.length && !rule.classes.every((c) => classes.has(c))) continue;
        for (const p in rule.decls) put(p, rule.decls[p], (rule.decls[p].imp ? 100000 : 0) + rule.spec);
      }
    }
    const st = el.getAttribute('style');
    if (st) { const d = parseCssDecls(st); for (const p in d) put(p, d[p], (d[p].imp ? 100000 : 0) + 10000); }
  }
  HTML_CSS_CACHE.set(el, r);
  return r;
}
// `font: italic small-caps bold 12px/1.2 Georgia`: the words before the size
function htmlFontShorthand(v) {
  const out = {};
  for (const t of String(v || '').split(/\s+/)) {
    if (/^(italic|oblique)$/.test(t)) out.style = 'italic';
    else if (/^(bold|bolder)$/.test(t) || /^[1-9]00$/.test(t)) out.weight = t;
    else if (t === 'small-caps') out.variant = t;
    else if (/\d/.test(t) || /^((xx?|x)-)?(small|large)$|^medium$|^smaller$|^larger$/.test(t)) break;   // the size: the rest is the family
  }
  return out;
}
function htmlFlagsOf(el) {
  let f = HTML_FLAGS_CACHE.get(el);
  if (f) return f;
  f = {};
  const c = htmlCssOf(el);
  const sh = c.font ? htmlFontShorthand(c.font) : {};
  const w = c['font-weight'] !== undefined ? c['font-weight'] : sh.weight;
  if (w !== undefined) {
    if (/^(bold|bolder)$/.test(w) || (/^\d+$/.test(w) && +w >= 600)) f.bold = true;
    else if (/^(normal|lighter)$/.test(w) || /^\d+$/.test(w)) f.bold = false;
  }
  const s = c['font-style'] !== undefined ? c['font-style'] : sh.style;
  if (s !== undefined) { if (/^(italic|oblique)\b/.test(s)) f.italic = true; else if (s === 'normal') f.italic = false; }
  const deco = `${c['text-decoration'] || ''} ${c['text-decoration-line'] || ''}`;
  if (/\bunderline\b/.test(deco)) f.underline = true;
  if (/\bline-through\b/.test(deco)) f.strike = true;
  const tt = c['text-transform'];
  const fv = c['font-variant-caps'] !== undefined ? c['font-variant-caps'] : (c['font-variant'] !== undefined ? c['font-variant'] : sh.variant);
  if (tt !== undefined) { if (tt === 'uppercase') f.upper = true; else if (/^(none|lowercase|capitalize)$/.test(tt)) f.upper = false; }
  if (f.upper === undefined && fv !== undefined) { if (/small-caps/.test(fv)) f.upper = true; else if (fv === 'normal') f.upper = false; }
  if (c.display === 'none' || c.visibility === 'hidden' || c.visibility === 'collapse') f.hidden = true;
  HTML_FLAGS_CACHE.set(el, f);
  return f;
}
const HTML_TAG_ITALIC = new Set(['i', 'em', 'cite', 'var', 'dfn']);
// The typeform (liblouis bits) and upper-case flag that text inside `el` has, given what `el`'s parent gave it. A heading's own
// bold is the heading, not emphasis (a stylesheet that says h2 {font-weight:bold} must not bold every heading).
function htmlApplyFmt(el, tag, tf, up) {
  const f = htmlFlagsOf(el);
  let bold = f.bold;
  if (bold === undefined && (tag === 'b' || tag === 'strong')) bold = true;
  if (/^h[1-6]$/.test(tag) && bold === true) bold = undefined;
  let italic = f.italic;
  if (italic === undefined && HTML_TAG_ITALIC.has(tag)) italic = true;
  if (bold === true) tf |= TF_BOLD; else if (bold === false) tf &= ~TF_BOLD;
  if (italic === true) tf |= TF_ITALIC; else if (italic === false) tf &= ~TF_ITALIC;
  if (f.underline || tag === 'u') tf |= TF_UNDERLINE;
  if (f.upper !== undefined) up = f.upper;
  return [tf, up];
}
// What the text in `el` inherits from `el` itself and every ancestor (a bold <div> around a <p>; Google Docs' <b style="font-weight:normal"> wrapper)
function htmlInheritedState(el) {
  let s = HTML_STATE_CACHE.get(el);
  if (s) return s;
  const chain = [];
  for (let n = el; n && n.nodeType === 1; n = htmlParentOf(n)) chain.push(n);
  let tf = 0, up = false;
  for (let k = chain.length - 1; k >= 0; k--) [tf, up] = htmlApplyFmt(chain[k], htmlTag(chain[k]), tf, up);
  s = { tf, up };
  HTML_STATE_CACHE.set(el, s);
  return s;
}
const htmlStateActive = (st) => !!(st.tf || st.up);
// an element that changes the look of its own text (so its paragraph needs segments)
function htmlElemStyled(el) {
  const f = htmlFlagsOf(el);
  return !!(f.bold || f.italic || f.underline || f.upper);
}
const HTML_BLOCK_TAGS = new Set(['p', 'div', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'caption', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'figure', 'figcaption', 'address', 'hr', 'details', 'summary', 'form', 'fieldset', 'main', 'center']);
const htmlHasBlockDescendant = (el) => {
  const all = el.getElementsByTagName ? el.getElementsByTagName('*') : [];
  for (let i = 0; i < all.length; i++) if (HTML_BLOCK_TAGS.has(htmlTag(all[i]))) return true;
  return false;
};

// hidden: what a browser does not show is not transcribed (import fix list #19)
function htmlIsHidden(el, tag) {
  if (!el.getAttribute) return false;
  if (el.hasAttribute ? el.hasAttribute('hidden') : el.getAttribute('hidden') != null) return true;
  if ((el.getAttribute('aria-hidden') || '').trim().toLowerCase() === 'true') return true;   // decorative icons, duplicated text: aria-hidden is hidden
  if (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'hidden') return true;
  if (tag === 'dialog' && !(el.hasAttribute ? el.hasAttribute('open') : el.getAttribute('open') != null)) return true;
  return !!htmlFlagsOf(el).hidden;
}
// annotation: MathML's TeX source, not a second copy of the formula. video / audio (overnight question 4, #47; Paul, 1 Oct 2026):
// their content is the browser's fallback ("Your browser does not support the video tag"), not print; <object>, <canvas> and
// <iframe> fallback can be real content and is kept.
const HTML_DROP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'datalist', 'annotation', 'annotation-xml', 'video', 'audio']);
const HTML_BACKLINK_TEXT = new Set(['↩', '↩︎', '↩️', '↵', '⏎']);
const htmlIsBacklink = (el, tag) => tag === 'a' && (htmlTokens(el, 'role').includes('doc-backlink') || htmlTokens(el, 'epub:type').includes('backlink') || HTML_BACKLINK_TEXT.has((el.textContent || '').trim())
  || !!(HTML_CTX && HTML_CTX.backKeys.size && el.getAttribute && HTML_CTX.backKeys.has(htmlNoteIdref(el.getAttribute('href')))));   // a link to a note reference: "back"

const HTML_TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'submit', 'button', 'reset']);
// Makes the DOM say what a reader would see: hidden parts gone, a <q> with its quotation marks, a form control as the text it shows
// (a check box as [x] / [ ], an input as its value, a select as its selected option), MathML annotations and note back-links gone.
function prepareHtmlDom(root) {
  const doc = root.ownerDocument;
  const mk = (s) => doc.createTextNode(s);
  const visit = (parent, qDepth) => {
    for (const el of Array.from(parent.childNodes || [])) {
      if (el.nodeType !== 1) continue;
      const tag = htmlTag(el);
      if (HTML_DROP_TAGS.has(tag) || htmlIsHidden(el, tag) || htmlIsBacklink(el, tag)) { parent.removeChild(el); continue; }
      if (tag === 'input') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        const on = el.hasAttribute ? el.hasAttribute('checked') : el.getAttribute('checked') != null;
        let rep = null;
        if (type === 'checkbox') rep = on ? '[x] ' : '[ ] ';
        else if (type === 'radio') rep = on ? '(x) ' : '( ) ';
        else if (HTML_TEXT_INPUTS.has(type)) { const v = (el.getAttribute('value') || '').trim(); rep = v ? ` ${v} ` : null; }   // a box of its own on screen: never glued to the label beside it
        if (rep) parent.replaceChild(mk(rep), el); else parent.removeChild(el);
        continue;
      }
      if (tag === 'select') {
        const opts = [...el.getElementsByTagName('option')];
        const chosen = opts.filter((o) => (o.hasAttribute ? o.hasAttribute('selected') : o.getAttribute('selected') != null));
        const label = (chosen.length ? chosen : opts.slice(0, 1)).map((o) => (o.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(', ');
        if (label) parent.replaceChild(mk(` ${label} `), el); else parent.removeChild(el);
        continue;
      }
      if (tag === 'q') {                                              // a browser draws the marks: “ ” outside, ‘ ’ inside one
        el.insertBefore(mk(qDepth % 2 === 0 ? '“' : '‘'), el.firstChild);
        el.appendChild(mk(qDepth % 2 === 0 ? '”' : '’'));
        visit(el, qDepth + 1);
        continue;
      }
      visit(el, qDepth);
    }
  };
  visit(root, 0);
}

// ---------- notes: a footnote/endnote element and the references to it (import fix list #29, #30a) ----------
// A note reference (htmlIsNoterefAnchor) points with #id at its note, in the same file or (EPUB) another one. The note element is lifted
// out of the page and read where its first reference is, as the Word reader places a footnote: a { type:'footnote', id } block right after
// the paragraph that holds the reference, and a { type:'noteref', text, idref } segment in the paragraph. A note that nothing refers to, but that
// says it is one (epub:type footnote / endnote / rearnote, role doc-footnote / doc-endnote), is still a note in the place it stands — never a box.
function htmlNoteKindOf(el) {
  const words = [...htmlTokens(el, 'epub:type'), ...htmlTokens(el, 'role')];
  if (words.some((t) => t === 'endnote' || t === 'rearnote' || t === 'doc-endnote')) return 'endnote';
  if (words.some((t) => t === 'footnote' || t === 'doc-footnote')) return 'footnote';
  return null;
}
const htmlNotesContainerKind = (el) => {
  const words = [...htmlTokens(el, 'epub:type'), ...htmlTokens(el, 'role')];
  if (words.some((t) => t === 'endnotes' || t === 'rearnotes' || t === 'doc-endnotes')) return 'endnote';
  if (words.some((t) => t === 'footnotes' || t === 'doc-footnotes')) return 'footnote';
  return null;
};
// the <li>s of a list, when every one of them says it is a note (else null)
function htmlNoteListItems(list) {
  const lis = [...(list.childNodes || [])].filter((c) => c.nodeType === 1 && htmlTag(c) === 'li');
  return lis.length && lis.every((li) => htmlNoteKindOf(li)) ? lis : null;
}
// the text of a <pre>: its lines and indentation kept, a <br> a new line, a tab four spaces (as the Word reader's code paragraph has it)
function htmlPreText(el) {
  let t = '';
  (function walk(n) {
    for (const c of n.childNodes || []) {
      if (c.nodeType === 3) t += c.nodeValue || '';
      else if (c.nodeType === 1) { if (htmlTag(c) === 'br') t += '\n'; else walk(c); }
    }
  })(el);
  return t.replace(/\r\n?/g, '\n').replace(/^\n/, '').replace(/\t/g, '    ').replace(/\s+$/, '');
}
function htmlTextOutsideHeadings(el) {
  let t = '';
  (function walk(n) {
    for (const c of n.childNodes || []) {
      if (c.nodeType === 3) t += c.nodeValue || '';
      else if (c.nodeType === 1 && !/^h[1-6]$/.test(htmlTag(c))) walk(c);
    }
  })(el);
  return t;
}
function extractHtmlNotes(root, ctx, refTargets) {
  const all = root.getElementsByTagName ? [...root.getElementsByTagName('*')] : [];
  const anchors = all.filter((a) => htmlTag(a) === 'a' && htmlIsNoterefAnchor(a));
  const wanted = new Set();
  if (refTargets) for (const k of refTargets) wanted.add(k);
  else for (const a of anchors) { const k = htmlNoteIdref(a.getAttribute('href')); if (k) wanted.add(k); }
  if (!wanted.size) return;
  const prefix = `html-${ctx.file}#`;
  const byId = new Map();
  for (const el of all) { const id = el.getAttribute && el.getAttribute('id'); if (id && !byId.has(id)) byId.set(id, el); }
  const touched = [];
  for (const key of wanted) {
    if (!key.startsWith(prefix)) { if (refTargets) ctx.noteKeys.add(key); continue; }      // a note in another file: its own file lifts it out
    const el = byId.get(key.slice(prefix.length));
    if (!el || el === root || !el.parentNode) continue;
    if (/^h[1-6]$/.test(htmlTag(el)) || [...el.getElementsByTagName('*')].some((c) => /^h[1-6]$/.test(htmlTag(c)) || (htmlTag(c) === 'a' && htmlIsNoterefAnchor(c)))) continue;   // a section, or a note that holds note references: not a note
    const kind = htmlNoteKindOf(el) || (() => { for (let n = el.parentNode; n && n.nodeType === 1; n = n.parentNode) { const k = htmlNotesContainerKind(n); if (k) return k; } return null; })() || 'footnote';
    const parent = el.parentNode;
    HTML_PARENT.set(el, parent);
    parent.removeChild(el);
    touched.push(parent);
    ctx.noteEls.push({ key, el, kind });
    ctx.noteKeys.add(key);
  }
  for (const start of touched) {                                   // the list or "Notes" section the notes were in, if nothing else is left
    for (let n = start; n && n !== root && n.parentNode;) {
      const tg = htmlTag(n);
      const emptyList = (tg === 'ol' || tg === 'ul') && ![...n.childNodes].some((c) => c.nodeType === 1 || (c.nodeType === 3 && c.nodeValue.trim()));
      const emptyContainer = !!htmlNotesContainerKind(n) && !htmlTextOutsideHeadings(n).trim();
      if (!emptyList && !emptyContainer) break;
      const up = n.parentNode;
      up.removeChild(n);
      n = up;
    }
  }
}
// the plain paragraphs of a note's body blocks -> { type:'footnote' } (one paragraph as text+segments, several as blocks)
function htmlMakeNote(body, kind, id) {
  const flat = (b) => {
    if (!b) return '';
    if (b.segments) return htmlSegsFlat(b.segments);
    let t = b.text || '';
    if (b.items) t += ' ' + b.items.map((it) => `${it.marker ? it.marker + ' ' : ''}${flat(it)}`).join(' ');
    if (b.rows) t += ' ' + [...(b.headers || []), ...b.rows.flat()].map((c) => (c && typeof c === 'object' ? (c.text || '') : (c || ''))).join(' ');
    if (b.blocks) t += ' ' + b.blocks.map(flat).join(' ');
    return t.replace(/\s+/g, ' ').trim();
  };
  const paras = [];
  for (const b of body) {
    if (b.type === 'pagenum' || b.type === 'graphic') continue;
    const text = flat(b);
    if (!text) continue;
    paras.push(b.type === 'para' && b.segments ? { type: 'para', text, segments: b.segments } : { type: 'para', text });
  }
  if (!paras.length) return null;
  const note = paras.length === 1 ? { type: 'footnote', text: paras[0].text, ...(paras[0].segments ? { segments: paras[0].segments } : {}) } : { type: 'footnote', blocks: paras };
  note.id = id;
  if (kind === 'endnote') note.kind = 'endnote';
  return note;
}
function htmlNoterefsIn(v, out = [], seen = new Set()) {
  if (!v || typeof v !== 'object' || seen.has(v)) return out;
  seen.add(v);
  if (v.type === 'noteref' && v.idref) out.push(v.idref);
  else for (const k in v) if (v[k] && typeof v[k] === 'object') htmlNoterefsIn(v[k], out, seen);
  return out;
}
// Puts each note after the block that holds its first reference; a note none of the kept blocks refers to goes at the end (nothing is dropped).
function placeHtmlNotes(blocks, notes) {
  if (!notes || !notes.size) return;
  const out = [];
  let pending = [];                                   // notes of a paragraph that a print page number cuts in two wait for its last piece
  for (const b of blocks) {
    out.push(b);
    if (!b || b.type === 'footnote') continue;
    for (const idref of htmlNoterefsIn(b)) {
      const e = notes.get(idref);
      if (e && !e.placed) { e.placed = true; pending.push(e.block); }
    }
    if (b.continued || b.type === 'pagenum') continue;
    for (const n of pending) out.push(n);
    pending = [];
  }
  for (const n of pending) out.push(n);
  for (const e of notes.values()) if (!e.placed) { e.placed = true; out.push(e.block); }
  blocks.length = 0;
  for (const b of out) blocks.push(b);
}

function hasInlineElements(node) {
  if (!node) return false;
  if (node.nodeType === 1 && (htmlStateActive(htmlInheritedState(node)) || htmlPagebreakValue(node) !== null)) return true;   // bold / italic / upper case from its own or an ancestor's CSS; a print page number
  if (markupHasForeignLang(node)) return true;          // a foreign-language passage (lang/xml:lang, input/lang.mjs) keeps its segments
  // getElementsByTagName (one tag at a time) is checked first, not a combined
  // querySelector('a, b, i, …') selector list — format/test-maths.mjs's own
  // browser-DOM polyfill (needed because parseHtml targets the real browser DOM, which
  // @xmldom/xmldom does not implement) treats querySelector's argument as one bare tag
  // name, so a comma-separated selector silently matches nothing there. Individual
  // single-tag lookups work under both the polyfill and the real DOM.
  if (node.getElementsByTagName) {
    for (const t of ['math', 'sub', 'sup', 'br', 'ruby', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'cite', 'var', 'dfn', 'svg', 'code']) {   // S5D-Q4: code
      if (node.getElementsByTagName(t).length > 0) return true;
    }
    const as = node.getElementsByTagName('a');
    for (let i = 0; i < as.length; i++) {
      if (as[i].getAttribute && as[i].getAttribute('href')) return true;
    }
    // UEB 9.5.1: a `style="text-decoration:line-through"` run (no dedicated tag) — checked
    // over every descendant, same one-tag-at-a-time shape as the loop above. K5: a script
    // signal (class="script" or a script/cursive font-family) shares the same loop. LINK-2:
    // `style="text-decoration:underline"` (no <u>) shares it too — see HAS_UNDERLINE_STYLE_RE.
    const all = node.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      if (all[i].getAttribute && (HAS_LINE_THROUGH_STYLE_RE.test(all[i].getAttribute('style') || '') || HAS_UNDERLINE_STYLE_RE.test(all[i].getAttribute('style') || '') || elementIsScript(all[i]))) return true;
      if (all[i].getAttribute && (htmlElemStyled(all[i]) || htmlFlagsOf(all[i]).strike || htmlPagebreakValue(all[i]) !== null)) return true;   // CSS from a class rule; an inline print page number
    }
    return false;
  }
  if (node.querySelector) {
    if (node.querySelector('math') || node.querySelector('sub') || node.querySelector('sup') || node.querySelector('br') || node.querySelector('ruby')
      || node.querySelector('b') || node.querySelector('strong') || node.querySelector('i') || node.querySelector('em') || node.querySelector('u')
      || node.querySelector('s') || node.querySelector('strike') || node.querySelector('del')) return true;
    const a = node.querySelector('a');
    if (a && a.getAttribute && a.getAttribute('href')) return true;
    const styled = node.querySelector('[style*="line-through"]');
    if (styled && styled.getAttribute && HAS_LINE_THROUGH_STYLE_RE.test(styled.getAttribute('style') || '')) return true;
    // LINK-2: `style="text-decoration:underline"` (no <u>), same "is there one at all" gate.
    const underlined = node.querySelector('[style*="underline"]');
    if (underlined && underlined.getAttribute && HAS_UNDERLINE_STYLE_RE.test(underlined.getAttribute('style') || '')) return true;
    // K5: class="script" token or a font-family style naming a script/cursive face.
    const scriptCls = node.querySelector('[class~="script"]');
    if (scriptCls) return true;
    const scriptStyle = node.querySelector('[style*="font-family"]');
    return !!(scriptStyle && scriptStyle.getAttribute && elementIsScript(scriptStyle));
  }
  return false;
}

// Walk a <p>'s child nodes (text + elements) in document order, building a
// segments array: text -> {type:'text'}, a <math> element -> {type:'math',
// mathml}, <sub>/<sup> -> UEB sub/sup script marks in text, <br> -> space.
// A46: <b>/<strong> -> tf|=TF_BOLD, <i>/<em> -> tf|=TF_ITALIC, <u> -> tf|=TF_UNDERLINE
// (nesting combines bits, matching parseDtbook's walkInline/TYPEFORM model — see
// TF_ITALIC/TF_UNDERLINE/TF_BOLD above), and <a href="…"> stamps `.href` onto every
// text segment it produced, exactly as walkInline does for DTBook's own <a>.
// K5: elementIsScript(child) (class="script" or a script/cursive font-family) -> tf|=TF_SCRIPT,
// same nesting/combination as the three above.
// UEB 9.5.1: <s>/<strike>/<del> (in HTML, <del> means "removed text", but on the printed
// page it still shows as crossed out, so it is treated the same way here — noted, not a
// silent guess) and CSS `text-decoration[-line]: line-through` (inline style="…") all mark
// Emboss's own strikethrough (segment.transcriberTypeform = 'strike'; see
// format/document.mjs's segTf comment for the full model — the SECOND transcriber-defined
// typeform, kept off the first slot because that one is the hyperlink indicator). Threaded alongside `tf`
// (italic/underline/bold) exactly the same way — a separate field, so a struck-through bold
// word keeps both. (Regex shared with hasInlineElements' own gate, above: HAS_LINE_THROUGH_STYLE_RE.)
const LINE_THROUGH_STYLE_RE = HAS_LINE_THROUGH_STYLE_RE;
// epub:type / ARIA print page break: its page number ('' for a break that carries none), or null when `el` is not a page break
function htmlPagebreakValue(el) {
  if (!el || el.nodeType !== 1 || !el.getAttribute) return null;
  const dp = el.getAttribute('data-pagenum');
  if (!(dp || htmlTokens(el, 'role').includes('doc-pagebreak') || htmlTokens(el, 'epub:type').includes('pagebreak'))) return null;
  return (el.textContent || '').replace(/\s+/g, ' ').trim() || dp || el.getAttribute('aria-label') || el.getAttribute('title') || '';
}
// A note reference: a link with role doc-noteref, epub:type noteref, or the class footnote-ref / noteref. Its note is the element its #fragment names.
function htmlIsNoterefAnchor(a) {
  if (!a || !a.getAttribute || !a.getAttribute('href')) return false;
  const cls = htmlTokens(a, 'class');
  return htmlTokens(a, 'role').includes('doc-noteref') || htmlTokens(a, 'epub:type').includes('noteref') || cls.includes('footnote-ref') || cls.includes('noteref');
}
// the id a note reference and its note share: "html-<file of the note>#<id>" (a note in another EPUB file is found by the same key)
function htmlNoteKey(file, dir, href) {
  const s = String(href || '');
  const i = s.indexOf('#');
  if (i < 0) return null;
  const pathPart = s.slice(0, i);
  let id = s.slice(i + 1);
  try { id = decodeURIComponent(id); } catch { /* keep the literal id */ }
  if (!id) return null;
  if (pathPart && /^[a-z][a-z0-9+.-]*:/i.test(pathPart)) return null;           // an external address
  return `html-${pathPart ? resolveZipPath(dir, pathPart) : file}#${id}`;
}
const htmlNoteIdref = (href) => (HTML_CTX ? htmlNoteKey(HTML_CTX.file, HTML_CTX.dir, href) : null);
// the mark a reader sees: 1, *, [2] -> 2
function htmlNoterefMark(a) {
  const t = (a.textContent || '').replace(/\s+/g, ' ').trim();
  return t.replace(/^[[(]\s*(.*?)\s*[\])]$/, '$1') || null;
}
function htmlKnownNoteref(a) {
  return !!(HTML_CTX && htmlIsNoterefAnchor(a) && HTML_CTX.noteKeys.has(htmlNoteIdref(a.getAttribute('href'))) && htmlNoterefMark(a));
}
// <sup><a role="doc-noteref">1</a></sup>: the reference is already raised; no second superscript around it
function htmlSoleNoteref(el) {
  const t = (el.textContent || '').trim();
  for (const a of el.getElementsByTagName('a')) if (htmlKnownNoteref(a) && (a.textContent || '').trim() === t) return true;
  return false;
}
// S5D-Q4 (Paul, 17 Oct 2026): a picture from an <img>. Its alt text is the description for the braille reader (`alt`, the field the
// editor's card edits). An alt="" written on purpose (or role="presentation"/"none" with no alt) is a decorative picture, as the
// Word reader's IMP-W12 marks one (`decorative: true`: no "picture has no description" warning); no alt attribute at all is not.
function htmlImgGraphic(img) {
  const get = (n) => (img.getAttribute ? img.getAttribute(n) : null);
  const rawAlt = get('alt') || '';
  const alt = rawAlt.trim() ? rawAlt : '';                // (an alt of spaces only is no description)
  const g = { type: 'graphic', src: get('src') || '', alt };
  const role = String(get('role') || '').toLowerCase().trim();
  const hasAlt = img.hasAttribute ? img.hasAttribute('alt') : get('alt') != null;
  if (!alt.trim() && (hasAlt || role === 'presentation' || role === 'none')) g.decorative = true;
  return g;
}
// The pictures in a list item's own text (not in its nested lists): <li>Apples <img alt="…"></li>, a linked <a><img></a>, or an item that is
// only a picture. Each as htmlImgGraphic makes it; one with neither a source nor a description is left out.
function htmlItemOwnPictures(li) {
  const pics = [];
  const collect = (n) => {
    for (const c of n.childNodes || []) {
      if (c.nodeType !== 1) continue;
      const tg = (c.tagName || c.localName || '').toLowerCase();
      if (tg === 'ul' || tg === 'ol') continue;
      if (tg === 'img') pics.push(htmlImgGraphic(c)); else collect(c);
    }
  };
  collect(li);
  return pics.filter((g) => g.src || g.alt);
}
// S5D-Q4: Emboss's own HTML export writes a picture's production-note description as <p class="image-description"> inside its <figure>.
function htmlFigureDescription(figure) {
  if (!figure.getElementsByTagName) return '';
  const parts = [];
  for (const el of figure.getElementsByTagName('*')) {
    if (/(^|\s)image-description(\s|$)/.test((el.getAttribute && el.getAttribute('class')) || '')) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) parts.push(t);
    }
  }
  return parts.join(' ');
}
// An inline <svg> with a title, aria-label or desc (or an <image>, as an EPUB cover page writes one) is a picture with that description.
function htmlSvgGraphics(svg) {
  if (!svg || !svg.getAttribute) return null;
  const doc = svg.ownerDocument;
  const textOfEl = (e) => ((e && e.textContent) || '').replace(/\s+/g, ' ').trim();
  const direct = (name) => { for (const c of svg.childNodes || []) if (c.nodeType === 1 && htmlTag(c) === name) return c; return null; };
  let label = (svg.getAttribute('aria-label') || '').trim();
  if (!label) {
    const ids = (svg.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    if (ids.length && doc && doc.getElementById) label = ids.map((id) => textOfEl(doc.getElementById(id))).filter(Boolean).join(' ');
  }
  const title = textOfEl(direct('title'));
  const desc = textOfEl(direct('desc'));
  const base = label || title;
  const alt = base && desc && desc !== base ? `${base} ${desc}` : (base || desc);
  const out = [];
  for (const im of svg.getElementsByTagName('image')) out.push({ type: 'graphic', src: im.getAttribute('xlink:href') || im.getAttribute('href') || '', alt });
  if (!out.length && alt) out.push({ type: 'graphic', src: '', alt });
  return out.length ? out : null;
}
// do these segments need the segment form (emphasis, a link, maths, a note mark, a forced line break…) or is plain text enough?
function htmlSegsCarryMarkup(segments) {
  return segments.some((s) => s.type === 'math' || s.type === 'noteref' || s.type === 'pagenum' || s.uncontracted || s.tf || s.href || s.transcriberTypeform || s.lang
    || (s.text && (s.text.includes(SCRIPT_MARKS.subOpen) || s.text.includes(SCRIPT_MARKS.supOpen) || s.text.includes('\n'))));
}
const htmlSegsFlat = (segments) => segments.map((s) => (s.type === 'math' ? '' : (s.text || ''))).join('').replace(/\s+/g, ' ').trim();
// the segments without their blank edges
function htmlTrimSegs(segments) {
  const segs = segments.filter((s) => !(s.type === 'text' && !s.text));
  if (segs[0]?.type === 'text') segs[0] = { ...segs[0], text: segs[0].text.replace(/^\s+/, '') };
  const last = segs.length - 1;
  if (last >= 0 && segs[last].type === 'text') segs[last] = { ...segs[last], text: segs[last].text.replace(/\s+$/, '') };
  return segs.filter((s) => !(s.type === 'text' && !s.text));
}

function htmlParagraphSegments(p, opts) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  const pnSegs = !!(opts && opts.pagenumSegments);                    // print page numbers stay in the segments (the caller splits the paragraph there)
  const pTag = htmlTag(p);
  const cellMode = pTag === 'td' || pTag === 'th' || !!(opts && opts.spaceBreaks);   // a line break in a table cell (or a heading, a glossary entry, an attribution) is a space
  const segments = [];
  let text = '';
  let curScript = null;
  let curTf = 0;
  let curTtf = null;
  let curLang = null;                                    // foreign language (lang/xml:lang) of the accumulating run — recorded only (input/lang.mjs)
  let curUnc = false;                                    // S5D-Q4: inside a <code>: computer code, read uncontracted (as the Markdown and NIMAS readers mark it)
  let lastCh = '';                                       // the last character put in the text, across format changes
  let sepPending = false;                                // a block element (paragraph, list item, div…) sat here: its words are not glued to the next
  const flushText = () => {
    if (curScript) { text += end; curScript = null; }
    if (text) {
      const seg = { type: 'text', text };
      if (curTf) seg.tf = curTf;
      if (curUnc) seg.uncontracted = true;
      if (curTtf) seg.transcriberTypeform = curTtf;
      if (curLang) seg.lang = curLang;
      segments.push(seg);
    }
    text = '';
  };
  const setTf = (tf, ttf, lang = curLang) => { if (tf !== curTf || (ttf || null) !== curTtf || lang !== curLang) { flushText(); curTf = tf; curTtf = ttf || null; curLang = lang; } };
  const emit = (val) => {
    if (!val) return;
    if (sepPending) { sepPending = false; if (lastCh && lastCh !== ' ' && lastCh !== '\n' && val[0] !== ' ' && val[0] !== '\n') val = ' ' + val; }
    if ((lastCh === ' ' || lastCh === '\n') && val[0] === ' ') val = val.replace(/^ +/, '');   // no double space, none after a line break
    if (!val) return;
    text += val;
    lastCh = val[val.length - 1];
  };
  const walk = (node, tf, ttf, up) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3) {                      // text node
        // Collapse whitespace runs (including a source pretty-printer's own newlines/
        // indentation, e.g. "The quick\n      <em>brown</em>") to a single space, exactly
        // like the flat-text path's own node.textContent.replace(/\s+/g, ' ') — otherwise a
        // literal \n here becomes a *forced* line break downstream (format/document.mjs's
        // groupSegments treats \n as one) instead of ordinary flowing text.
        if (child.textContent) {
          let val = child.textContent.replace(/\s+/g, ' ');
          if (val) {
            if (up) val = val.toUpperCase();              // text-transform:uppercase, small caps
            setTf(tf, ttf, markupForeignLang(child.parentNode));
            emit(val);
          }
        }
      } else if (child.nodeType === 1) {
        const tag = htmlTag(child);
        const blockish = HTML_BLOCK_TAGS.has(tag);
        if (blockish) sepPending = true;
        element(child, tag, tf, ttf, up);
        if (blockish) sepPending = true;
      }
    }
  };
  const element = (child, tag, tf, ttf, up) => {
    // BrailleBlaster test fixtures (TablesTestXml.xml): a <brl> child holds pre-supplied
    // braille for the print text beside it, not print text of its own (see
    // textExcludingBrl/brlTextOf, used by parseHtml's own table-cell reader) — matches
    // parseDtbook's own inlineSegments, which excludes <brl> the same way.
    if (tag === 'brl') return;
    if (pTag === 'li' && (tag === 'ul' || tag === 'ol')) return;   // a nested list is its own items, not this item's words
    const styleStrike = !!(child.getAttribute && LINE_THROUGH_STYLE_RE.test(child.getAttribute('style') || '')) || htmlFlagsOf(child).strike === true;
    // bold / italic / underline / upper case from the tag, the style attribute and the style rules (#33); LINK-2: a styled underline is read
    // here, so a styled link (or any other underlined run) carries TF_UNDERLINE the same way a literal <u> does.
    const [etf, eup] = htmlApplyFmt(child, tag, tf, up);
    const nextTtf = (tag === 's' || tag === 'strike' || tag === 'del' || styleStrike) ? 'strike' : ttf;
    const pv = htmlPagebreakValue(child);
    if (pv !== null) {                               // a print page number (epub:type="pagebreak", role="doc-pagebreak")
      if (pv) {
        const block = { type: 'pagenum', page: pv, text: pv };
        if (pnSegs) { flushText(); segments.push({ type: 'pagenum', block }); } else if (HTML_CTX) HTML_CTX.after.push(block);
      }
      return;
    }
    if (tag === 'a' && htmlKnownNoteref(child)) {   // a note reference: the mark, pointing at its note
      flushText();
      segments.push({ type: 'noteref', text: htmlNoterefMark(child), idref: htmlNoteIdref(child.getAttribute('href')) });
      lastCh = 'n';
      return;
    }
    if (tag === 'svg') {                             // a picture follows the paragraph (like a picture in a table cell follows the table)
      const gs = htmlSvgGraphics(child);
      if (gs && HTML_CTX) { HTML_CTX.after.push(...gs); return; }
    }
    if (tag === 'math') {
      flushText();
      curTf = etf;
      curTtf = nextTtf;
      const mathml = texOnlyMathToMathML(mathOuterXml(child)) || mathOuterXml(child);   // A89: an equation holding only its TeX is converted
      const latex = mathmlToLatex(mathml);
      const seg = { type: 'math', mathml };
      if (latex) seg.latex = latex;
      segments.push(seg);
      lastCh = 'm';
    } else if (tag === 'br') {
      setTf(etf, nextTtf);
      if (cellMode) emit(' ');
      else { if (lastCh === ' ') text = text.replace(/ +$/, ''); text += '\n'; lastCh = '\n'; }   // a forced line break, as the Word and DTBook readers have it
    } else if (tag === 'sub' || tag === 'sup') {
      if (htmlSoleNoteref(child)) { walk(child, etf, nextTtf, eup); return; }
      const prevScript = curScript;
      setTf(etf, nextTtf);
      if (curScript) { text += end; curScript = null; }
      text += (tag === 'sub' ? subOpen : supOpen);
      curScript = tag;
      walk(child, etf, nextTtf, eup);
      if (curScript) { text += end; curScript = null; }
      curScript = prevScript;
      if (curScript) {
        text += (curScript === 'sub' ? subOpen : supOpen);
      }
    } else if (tag === 'a') {
      const href = (child.getAttribute && child.getAttribute('href')) || null;
      if (href) {
        flushText();
        const before = segments.length;
        walk(child, etf, nextTtf, eup);
        flushText();
        for (let k = before; k < segments.length; k++) {
          if (segments[k] && segments[k].type === 'text') segments[k].href = href;
        }
      } else {
        walk(child, etf, nextTtf, eup);
      }
    } else if (tag === 'code') {
      // S5D-Q4 (Paul, 17 Oct 2026): <code> in running text is computer code: its text is its own uncontracted segment(s)
      flushText();
      const wasUnc = curUnc;
      curUnc = true;
      walk(child, etf, nextTtf, eup);
      flushText();
      curUnc = wasUnc;
    } else if (tag === 'b' || tag === 'strong' || tag === 'i' || tag === 'em' || tag === 'u') {
      walk(child, etf, nextTtf, eup);
    } else if (elementIsScript(child)) {          // K5: class="script" or a script/cursive font-family
      walk(child, etf | TF_SCRIPT, nextTtf, eup);
    } else if (tag === 's' || tag === 'strike' || tag === 'del' || styleStrike) {
      walk(child, etf, nextTtf, eup);
    } else if (tag === 'rp') {
      // IMP-W11: the fallback brackets of a <ruby> are not text (the guide gets its own brackets, below)
    } else if (tag === 'rt') {
      // IMP-W11 (Paul, 30 Sep 2026): a ruby guide follows its base text in brackets: "漢字 (かんじ)"
      setTf(etf, nextTtf);
      emit(' (');
      walk(child, etf, nextTtf, eup);
      emit(')');
    } else if (tag === 'ruby' || hasInlineElements(child)) {
      walk(child, etf, nextTtf, eup);                // descend to find the <math>/<sub>/<sup>/<br>/<b>/<i>/<a>/<s>/<ruby>… in place
    } else {
      let val = child.textContent.replace(/\s+/g, ' ');
      if (val) { if (eup) val = val.toUpperCase(); setTf(etf, nextTtf, markupForeignLang(child)); emit(val); }
    }
  };
  const st0 = htmlInheritedState(p);                  // what the paragraph itself and everything around it gives its text
  walk(p, st0.tf, null, st0.up);
  flushText();
  if (segments[0]?.type === 'text') segments[0].text = segments[0].text.replace(/^\s*\n\s*/, '');   // a line break at either end is not content
  const lastSeg = segments[segments.length - 1];
  if (lastSeg?.type === 'text') lastSeg.text = lastSeg.text.replace(/\s*\n\s*$/, '');
  const out = segments.filter((s) => !(s.type === 'text' && !s.text));
  // APH feedback 17 Oct 2026, point 16: a link whose text is its own address, written straight after a word with no space (a SAGE
  // article's ORCID link: "D’Andrea" + "https://orcid.org/…", shown in print as a small icon) is kept apart from that word.
  for (let i = 1; i < out.length; i++) {
    const s = out[i], prev = out[i - 1];
    if (s.type === 'text' && s.href && /^(https?:\/\/|www\.)/i.test(s.text || '') && prev.type === 'text' && /[\p{L}\p{N}]$/u.test(prev.text || '')) prev.text += ' ';
  }
  return out;
}

// A47/D10: split a `<p class="poem">line one<br>line two<br>…</p>` verse paragraph into
// one {type:'play', subtype:'verse', style:'verse'} block per line (the shape
// nimas-export.mjs's 'verse'/'poem'/'play' case already writes back as
// `<p class="bai-verse">`, no <poem> wrapper invented for text that never had one — see
// the fromPoem/fromLineTag comments there), instead of collapsing every <br> to a single
// space and losing the line structure. A run of consecutive blank lines between two real
// verse lines (a stanza break, e.g. the double-<br> gap Gutenberg's poems use) becomes an
// {type:'indicator', kind:'line'} block — the same shape parsePoem's own blank-line
// handling already produces — instead of being silently dropped; a leading/trailing blank
// line (no verse line before/after it yet) is dropped, matching what a stanza break would
// mean at the very start/end of the paragraph (nothing to break).
function pushVerseLines(node, blocks) {
  const lines = [[]];
  for (const child of node.childNodes || []) {
    const tag = child.nodeType === 1 ? (child.tagName || child.localName || '').toLowerCase() : '';
    if (tag === 'br') lines.push([]);
    else lines[lines.length - 1].push(child);
  }
  const lineText = (ln) => ln.map((n) => n.textContent || '').join('').replace(/\s+/g, ' ').trim();
  const nonEmptyIdx = [];
  lines.forEach((ln, i) => { if (lineText(ln)) nonEmptyIdx.push(i); });
  if (!nonEmptyIdx.length) return;
  const first = nonEmptyIdx[0];
  const last = nonEmptyIdx[nonEmptyIdx.length - 1];
  const doc = node.ownerDocument;
  for (let i = first; i <= last; i++) {
    const ln = lines[i];
    const t = lineText(ln);
    // #50 (1 Oct 2026): a class-marked poem paragraph IS a poem in print, so its lines and stanza breaks are tagged fromPoem — the shape
    // the DTBook reader gives a <poem>'s lines — and a save writes them as a <poem>. Untagged, they were saved as <p class="bai-verse">,
    // which reads back as verse drama (D5), and the braille changed on reopening (Alice: runover lines in cell 5 instead of cell 3).
    if (!t) { blocks.push({ type: 'indicator', kind: 'line', fromPoem: true }); continue; }
    const wrapper = keepLangOn(doc.createElement('span'), node);   // the clones keep the paragraph's language
    HTML_PARENT.set(wrapper, node);
    for (const n of ln) wrapper.appendChild(n.cloneNode(true));
    const segs = htmlParagraphSegments(wrapper);
    const hasFmt = segs.some((s) => s.type === 'math' || s.tf || s.href || s.transcriberTypeform || s.lang);
    if (hasFmt) blocks.push({ type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segs, fromPoem: true });
    else blocks.push({ type: 'play', subtype: 'verse', style: 'verse', text: t, fromPoem: true });
  }
}

// F-1 (Emboss/docs/standards-findings.md): a rowspanned cell occupies its column in every
// row it covers, not just the row it's declared on — BANA 11.5.3a requires the covered
// area(s) to stay BLANK, never repeated, and never shifted into by the next real cell.
// parseTable (parseDtbook's own table reader, below) already gets this right for DTBook/
// NIMAS via its own readSpannedRow/rowSpans map; this is the same algorithm, extracted so
// the HTML and ODT table readers — which each keep their own much simpler {headers, rows}
// model and, before this fix, only handled colspan (HTML) or nothing at all (ODT) — can
// share it rather than reimplement (and re-break) it. DOCX's table reader needs no
// equivalent: unlike HTML's rowspan (which omits the cell from later <tr>s outright) and
// unlike ODT's own row/column span (which needs table:covered-table-cell recognised, see
// parseOdt below), OOXML's w:vMerge keeps one real (normally empty) w:tc per row per
// column even for a continuation cell, so the grid parseDocx already reads stays
// rectangular without any special vMerge handling — confirmed with a scratch repro
// (vMerge restart + continue) before deciding not to touch parseDocx for this finding.
function createSpanReader() {
  // IMP-W5 (Paul, 30 Sep 2026): a merged cell repeats its text in every cell it covers, so no column is left empty (this replaces
  // F-1's BANA 11.5.3a blank for the HTML reader; parseTable, the DTBook reader, is unchanged). rowSpans: column -> { left, text }.
  const rowSpans = new Map();              // column -> the rows still covered, and the text they repeat
  const pending = (col) => rowSpans.has(col);
  const consume = (col) => { const cur = rowSpans.get(col); const text = cur.text; if (cur.left - 1 > 0) rowSpans.set(col, { left: cur.left - 1, text }); else rowSpans.delete(col); return text; };
  const register = (col, rowspan, text) => { if (rowspan > 1) rowSpans.set(col, { left: rowspan - 1, text }); };
  const copy = (v) => (v && typeof v === 'object' ? { ...v } : v);
  // cells: array of {text, colspan, rowspan} already read from the DOM by the caller (each
  // format reads its own span attribute names before calling this: HTML colspan/rowspan,
  // ODT table:number-columns-spanned/table:number-rows-spanned).
  // `tableColCount` (optional, 0 = unknown/no clamp): the table's real column count — see
  // mostCommonRowWidth below. Only an EXTREME colspan (more than double the table's typical
  // width — a BrailleBlaster test fixture uses colspan="20" on a table whose other rows are
  // 4 columns wide, to exercise exactly this) is clamped to whatever columns are actually
  // left in its row; a modest colspan that simply runs a column or two past the rest of the
  // table (real, intentional padding) is left exactly as before.
  // `onPlace(col, cell)` (optional, K3): called once per REAL cell (never a blank-filled
  // span continuation) with the column index this shared span bookkeeping worked out for
  // it — the only place that column index is correctly known once rowspans are in play.
  // The HTML table reader uses it to vote a column's print alignment (cell.align) against
  // the right physical column even when an earlier row's rowspan has shifted things.
  return function readSpannedRow(cells, tableColCount = 0, onPlace) {
    const out = [];
    let col = 0;
    for (const cell of cells) {
      while (pending(col)) { out.push(copy(consume(col))); col++; }
      const colspan = tableColCount > 0 && cell.colspan > tableColCount * 2 ? Math.max(1, Math.min(cell.colspan, tableColCount - col)) : cell.colspan;
      out.push(cell.text);
      if (onPlace) onPlace(col, cell);
      register(col, cell.rowspan, cell.text);
      col++;
      for (let k = 1; k < colspan; k++) {
        while (pending(col)) { out.push(copy(consume(col))); col++; }
        out.push(copy(cell.text));
        register(col, cell.rowspan, cell.text);
        col++;
      }
    }
    while (pending(col)) { out.push(copy(consume(col))); col++; }
    return out;
  };
}

// K3 (BANA 11.6.1d, transcriber KD): print's own column alignment, read from markup that
// carries it explicitly — HTML/EPUB or DTBook `align="right"` / `align="char" char="…"`, or
// CSS `style="text-align:right"` (also accepted as "end", RTL-safe) — shared by the HTML
// table reader and the DTBook parseTable reader below, since both markups use the same
// attribute names (DTBook's %cellhalign; entity is HTML 4's own table model). A positive
// detection only: 'right' or 'decimal' (align="char"); anything else (left/center/justify,
// no attribute at all) returns null so the column is left undetected — §11.6.1c's plain
// left-adjustment then applies, never a punctuation guess.
const TEXT_ALIGN_RIGHT_RE = /text-align\s*:\s*(right|end)\b/i;
function markupCellAlign(el) {
  if (!el || !el.getAttribute) return null;
  const a = (el.getAttribute('align') || '').trim().toLowerCase();
  if (a === 'char') return 'decimal';
  if (a === 'right') return 'right';
  if (TEXT_ALIGN_RIGHT_RE.test(el.getAttribute('style') || '')) return 'right';
  return null;
}
// K35 (BANA 11.6.1c/d, transcriber KD): the transcriber's own per-column alignment override
// (distinct from print's own alignment markupCellAlign reads above), round-tripped by
// nimas-export.mjs as a class token on the SAME DTBook <col> element: bana-col-align-left /
// -right / -decimal. Read from a <col>'s class only — this is our own save format, not a
// print-source signal, so it is not looked for on HTML/EPUB <col>/<td> or any other reader.
const COL_ALIGN_OVERRIDE_RE = /(?:^|\s)bana-col-align-(left|right|decimal)(?:\s|$)/;
function markupColumnAlignOverride(el) {
  if (!el || !el.getAttribute) return null;
  const m = COL_ALIGN_OVERRIDE_RE.exec(el.getAttribute('class') || '');
  return m ? m[1] : null;
}
// This table's own DIRECT <col> elements, in column order, expanding a <col span="n"> (or a
// <colgroup>'s own <col> children) to one entry per physical column it covers — shared by
// the HTML and DTBook table readers (K3). getElementsByTagName is a DEEP search, which would
// also pick up a nested table's own <col>s; direct-children-only walk avoids that the same
// way parseDocx's docxDirect/directTagNS does for <w:tr>.
function directTableCols(tableEl) {
  const out = [];
  for (let c = tableEl.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 1) continue;
    const tag = (c.localName || c.tagName || '').toLowerCase();
    if (tag === 'col') {
      const span = htmlSpan(c, 'span');
      for (let k = 0; k < span; k++) out.push(c);
    } else if (tag === 'colgroup') {
      for (let g = c.firstChild; g; g = g.nextSibling) {
        if (g.nodeType !== 1 || (g.localName || g.tagName || '').toLowerCase() !== 'col') continue;
        const span = htmlSpan(g, 'span');
        for (let k = 0; k < span; k++) out.push(g);
      }
    }
  }
  return out;
}

// The table's real column count, used to clamp an over-wide colspan (see createSpanReader's
// readSpannedRow and parseDtbook's own parseTable, which both take this as an optional
// clamp bound): the MOST COMMON row width among all of a table's rows (header and body
// alike), each row's width being the raw, unclamped sum of its own cells' colspans. A
// single outlier row (e.g. a stray colspan="20" on an otherwise 4-column table) does not
// get a vote of its own once every other row already agrees on the real width. Returns 0
// ("unknown / do not clamp") when there is no clear majority (e.g. every row a different
// width, or fewer than one row).
function mostCommonRowWidth(widths) {
  const counts = new Map();
  for (const w of widths) { if (w > 0) counts.set(w, (counts.get(w) || 0) + 1); }
  let best = 0, bestCount = 0;
  for (const [w, n] of counts) { if (n > bestCount) { best = w; bestCount = n; } }
  return best;
}

// BrailleBlaster's own table-test-fixture convention (e.g. Emboss/tests/nimas_samples/
// TablesTestXml.xml): a <brl>…</brl> inside a table cell holds pre-supplied braille for
// the print text beside it, not print text of its own — excluded from any plain-text read
// the same way parseDtbook's own getCleanText/inlineSegments already exclude it (see the
// `tag === 'brl'` checks there). <brl> is not a real HTML element, so this is safe outside
// tables too; it only ever appears in these fixtures, and only inside table cells.
function textExcludingBrl(el) {
  let t = '';
  // A paragraph, list item or line break inside the element separates words (import fix list #15b: "p1p2", "l1l2", "ab");
  // upper case (text-transform / small caps) is applied as the segment reader applies it.
  (function walk(n, up) {
    for (const c of n.childNodes || []) {
      if (c.nodeType === 3) t += up ? (c.nodeValue || '').toUpperCase() : (c.nodeValue || '');
      else if (c.nodeType === 1) {
        const tag = (c.tagName || c.localName || '').toLowerCase();
        if (tag === 'brl' || tag === 'rp') continue;
        if (tag === 'rt') { t += ' ('; walk(c, up); t += ')'; continue; }   // IMP-W11: a ruby guide follows its base in brackets
        const sep = tag === 'br' || HTML_BLOCK_TAGS.has(tag);
        if (sep) t += ' ';
        walk(c, htmlApplyFmt(c, tag, 0, up)[1]);
        if (sep) t += ' ';
      }
    }
  })(el, htmlInheritedState(el).up);
  return t;
}

// The literal braille of a cell's own <brl> child/children (concatenated; a cell normally
// has at most one). Used only when the cell has NO print text of its own (see
// textExcludingBrl above / getCleanText's tag==='brl' exclusion) — the print+brl case
// keeps discarding the pre-supplied braille exactly as before (Emboss translates the print
// text itself rather than trusting an externally supplied transcription).
function brlTextOf(el) {
  const brlEls = el.getElementsByTagName ? [...el.getElementsByTagName('brl')] : [];
  return brlEls.map((b) => b.textContent || '').join('');
}

// ---------- Box/sidebar detection (HTML/EPUB) — BANA §7 box lines, K7 box colour ----------
// HTML/EPUB give several explicit signals a box exists (none of which a plain paragraph or
// wrapper <div> ever carries): the semantic <aside> element; ARIA role="complementary" (the
// exact role EPUB/HTML accessibility guidance recommends for a sidebar) or role="note";
// epub:type="sidebar"/"tip"/"note" (EPUB's own structural-semantics vocabulary); a handful of
// common class names (sidebar/box/callout/tip/note/panel — checked as a whole WORD, via \b, so
// "footnote"/"endnote"/"notebox" do NOT match, only "note", "note-box", "side-note" etc. do); and
// a genuine CSS border (the `border` shorthand, or all four `border-<side>` longhands) in an
// inline `style`. A background-colour alone is deliberately NOT one of the triggers — many
// plain paragraphs/wrappers carry a highlight tint with no box intended — it is only read once
// one of the signals above has already decided the element is a box, to name that box's colour
// (K7). Kept deliberately narrow: role/epub:type apply to any element, but the class-name and
// border checks are scoped to div/section/article — a <p>/<span> with a border is far more
// often a decorative rule (BANA: "a plain paragraph with a bottom border only is NOT a box") or
// an inline highlight than a real sidebar, and <blockquote>'s own border-ish styling is already
// read as a displayed quotation (this walk's own earlier `tag === 'blockquote'` branch, never
// reaching this check at all).
// "note" alone is NOT a box class (26 Sep, main session): Project Gutenberg marks every marginal sidenote
// `<div class="note">` (britannica_39001: 31 one-paragraph "boxes"). A compound like "note-box" still matches
// via "box"; role="note" / epub:type="note" and a full CSS border still count.
const BOX_CLASS_RE = /\b(sidebar|box|callout|tip|panel)\b/i;
function htmlHasVisibleBorder(style) {
  const s = String(style || '');
  const isNone = (v) => !v || /^none\b/i.test(v.trim()) || /^0(\.0+)?(px|pt|em|%)?(\s+none)?$/i.test(v.trim());
  const shorthand = /(?:^|;)\s*border\s*:\s*([^;]+)/i.exec(s);
  if (shorthand && !isNone(shorthand[1])) return true;
  const sideVals = ['top', 'right', 'bottom', 'left'].map((side) => {
    const m = new RegExp(`(?:^|;)\\s*border-${side}\\s*:\\s*([^;]+)`, 'i').exec(s);
    return m ? m[1] : null;
  });
  return sideVals.every((v) => v !== null && !isNone(v));   // all FOUR sides, not just a bottom rule (see file comment)
}
function htmlBoxSignal(node) {
  if (!node.getAttribute) return false;
  const tag = (node.tagName || node.localName || '').toLowerCase();
  if (tag === 'aside') return true;
  const role = (node.getAttribute('role') || '').toLowerCase().split(/\s+/);
  if (role.includes('complementary') || role.includes('note')) return true;
  const epubType = (node.getAttribute('epub:type') || '').toLowerCase().split(/\s+/);
  if (epubType.includes('sidebar') || epubType.includes('tip') || epubType.includes('note')) return true;
  if (tag === 'div' || tag === 'section' || tag === 'article') {
    const cls = (node.getAttribute('class') || '').replace(/_/g, '-');
    if (BOX_CLASS_RE.test(cls)) return true;
    if (htmlHasVisibleBorder(node.getAttribute('style') || '')) return true;
  }
  return false;
}
// The box's own background colour (K7) — background-color, or the background shorthand's own
// first token when it is plainly a colour (never a `url(...)` image).
function htmlBackgroundColor(style) {
  const s = String(style || '');
  let m = /(?:^|;)\s*background-color\s*:\s*([^;]+)/i.exec(s);
  if (m) return m[1].trim();
  m = /(?:^|;)\s*background\s*:\s*([^;]+)/i.exec(s);
  if (m && !/url\(/i.test(m[1])) return m[1].trim().split(/\s+/)[0];
  return null;
}

// `opts` (optional): { mainLang, rawLang } — parseEpub passes the book's dc:language as the main language and finishes the
// language tags itself over the whole book (input/lang.mjs); a lone HTML file uses its own <html>/<body> lang.
// Also (EPUB): { file, refTargets, notes, deferNotes, extraCss } — the chapter's own path in the package, the ids every note reference in the book
// points at, the map the notes are collected in (placed after the whole book is read), and the text of the style sheets the chapter links.
export function parseHtml(str, opts = null) {
  const prevCtx = HTML_CTX, prevRules = HTML_RULES;
  try { return parseHtmlDoc(str, opts); } finally { HTML_CTX = prevCtx; HTML_RULES = prevRules; }
}
// XHTML (an EPUB chapter) is read by the HTML parser, which takes <span .../> as an OPEN tag and puts everything after it inside: a page-break marker
// <span epub:type="pagebreak" title="12"/> would swallow the rest of its paragraph. XML's empty-element form is written out for every non-void element.
const HTML_VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
function expandXhtmlEmptyElements(html) {
  if (!/^\s*<\?xml|xmlns\s*=\s*["']http:\/\/www\.w3\.org\/1999\/xhtml/i.test(String(html).slice(0, 2000))) return html;
  return html.replace(/<([a-zA-Z][\w:.-]*)((?:\s+[^<>]*?)?)\s*\/>/g, (m, tag, attrs) => (HTML_VOID_TAGS.has(tag.toLowerCase()) ? m : `<${tag}${attrs}></${tag}>`));
}
function parseHtmlDoc(str, opts) {
  const raw = expandXhtmlEmptyElements(str ?? '');
  const htmlToParse = (raw.includes('<html') || raw.includes('<body')) ? raw : `<body>${raw}</body>`;
  const Parser = typeof DOMParser !== 'undefined' ? DOMParser : globalThis.DOMParser;
  if (!Parser) throw new Error('No DOMParser available');
  const doc = new Parser().parseFromString(htmlToParse, 'text/html');
  setMarkupMainLang((opts && opts.mainLang) || langAttrOf(doc.documentElement) || langAttrOf(doc.body) || null);   // foreign-language passages (input/lang.mjs)
  // The style sheets (#33, #19), then what a reader would not see is taken out of the DOM, and notes are lifted out to be placed at their references (#29).
  HTML_RULES = [];
  for (const css of [opts && opts.extraCss, ...[...(doc.getElementsByTagName ? doc.getElementsByTagName('style') : [])].filter((st) => { const m = (st.getAttribute && st.getAttribute('media')) || ''; return !m || /\b(all|screen)\b/i.test(m); }).map((st) => st.textContent)]) {
    if (css) for (const r of parseHtmlCss(css)) { r.order = HTML_RULES.length; HTML_RULES.push(r); }
  }
  const bodyEl = doc.body || (doc.getElementsByTagName ? doc.getElementsByTagName('body')[0] : null) || doc.documentElement;
  const file = (opts && opts.file) || '';
  const ctx = HTML_CTX = { file, dir: file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '', noteKeys: new Set(), backKeys: new Set((opts && opts.backTargets) || []), notes: (opts && opts.notes) || new Map(), after: [], noteEls: [] };
  if (!(opts && opts.backTargets)) {                 // the ids of the note references: a link back to one of them, inside a note, is a back-link
    for (const a of (bodyEl.getElementsByTagName ? bodyEl.getElementsByTagName('a') : [])) {
      const id = a.getAttribute && a.getAttribute('id');
      if (id && htmlIsNoterefAnchor(a)) ctx.backKeys.add(`html-${file}#${id}`);
    }
  }
  prepareHtmlDom(bodyEl);
  extractHtmlNotes(bodyEl, ctx, opts && opts.refTargets);
  const titleEl = (doc.querySelector ? doc.querySelector('title') : doc.getElementsByTagName('title')[0])
    || (doc.querySelector ? doc.querySelector('h1') : doc.getElementsByTagName('h1')[0]);
  const title = (titleEl?.textContent || '').trim() || null;
  const blocks = [];
  // A47/D9: groups a multi-paragraph <blockquote>'s own style:'quote' blocks under one
  // id (mirrors parseDtbook's blockquoteRunSeq/blockquoteId, A35/A40) so nimas-export's
  // renderBlockquoteRun wraps them in a single <blockquote>…</blockquote> instead of each
  // paragraph self-wrapping in its own.
  let blockquoteRunSeq = 0;
  const root = doc.body || (doc.getElementsByTagName ? doc.getElementsByTagName('body')[0] : null) || doc.documentElement;
  // Real-file gap (23 Sep, Word/EPUB/HTML/MD import sort): a container (<div>, <section>…)
  // whose OWN children mix text with a link or emphasis — Gutenberg's licence boilerplate,
  // `<div>… at <a href="…">www.gutenberg.org</a>. If you …</div>` — was split into one
  // paragraph per text node and one per element, and the recursive walk of the <a> then
  // built a plain para from its text, so the link (and any <em>/<b>) was lost and the
  // sentence was broken into pieces. groupInlineRuns gathers each run of consecutive
  // inline nodes (text, links, emphasis, spans…) that contains at least one link or
  // emphasis element into ONE synthetic wrapper, which the walk then reads as a <p>. A run
  // with no link/emphasis, and a <br> (always a boundary, so a div of <br>-separated lines
  // keeps one paragraph per line), keep their old behaviour exactly.
  const RUN_INLINE = new Set(['a', 'abbr', 'acronym', 'b', 'bdi', 'bdo', 'big', 'cite', 'code', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var', 'ins', 'del', 'strike', 'font', 'label', 'data']);
  const RUN_FMT = new Set(['a', 'b', 'strong', 'i', 'em', 'u', 'sub', 'sup']);
  const hasRunFmt = (n) => {
    const tg = (n.tagName || n.localName || '').toLowerCase();
    if (tg === 'a') return !!(n.getAttribute && n.getAttribute('href'));
    if (RUN_FMT.has(tg)) return true;
    return hasInlineElements(n);
  };
  const groupInlineRuns = (el) => {
    const out = [];
    let run = [];
    let runHasFmt = false;
    // APH feedback 17 Oct 2026, point 16: a run of two or more pieces with content (a SAGE article's masthead and keyword list:
    // <span>braille literacy</span>, <span>blind</span>, …) is one line in a browser, so it is one paragraph here too - it was one
    // paragraph per piece ("braille literacy" / "," / "blind" …). A single piece, and a <br>, behave as before.
    // A real line of inline pieces has a handful; a run of thousands (the extreme set's 100,000 sibling <span>s) is a hostile document, and cloning it
    // into one paragraph ran a browser-like DOM (jsdom) out of memory: such a run is read one piece per paragraph, as before.
    const MAX_JOINED_RUN = 1000;
    const filled = (n) => (n.nodeType === 3 ? /\S/.test(n.nodeValue || '') : /\S/.test(n.textContent || '') || hasInlineElements(n));
    const flushRun = () => {
      if (run.length) {
        if ((runHasFmt || (run.length <= MAX_JOINED_RUN && run.filter(filled).length > 1)) && (el.ownerDocument || doc).createElement) {
          const wrapper = keepLangOn((el.ownerDocument || doc).createElement('span'), el);   // the clones keep the container's language
          HTML_PARENT.set(wrapper, el);                                                      // … and the container's look (bold, italic, upper case)
          for (const n of run) wrapper.appendChild(n.cloneNode(true));
          out.push({ inlineRun: wrapper });
        } else out.push(...run);
      }
      run = []; runHasFmt = false;
    };
    for (const node of el.childNodes || []) {
      const isText = node.nodeType === 3;
      const tg = node.nodeType === 1 ? (node.tagName || node.localName || '').toLowerCase() : '';
      // an inline element that holds paragraphs, lists or tables (Google Docs wraps its page in <b style="font-weight:normal">) is a container, not a run
      if (isText || (node.nodeType === 1 && RUN_INLINE.has(tg) && !htmlHasBlockDescendant(node))) {
        run.push(node);
        if (!isText && hasRunFmt(node)) runHasFmt = true;
      } else { flushRun(); out.push(node); }
    }
    flushRun();
    return out;
  };
  // A list item with more than one paragraph (or a table, <pre>, quotation... among its paragraphs): { head, rest } —
  // head is the element holding the item's first paragraph, rest a <div> with everything after it (not the item's own
  // nested lists), walked like the body into item.blocks. null = read the <li> as before (inline text, or one <p>/<div>,
  // or an item that starts with a table).
  const LI_BLOCK_TAGS = new Set(['p', 'div', 'table', 'pre', 'blockquote', 'figure', 'dl', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
  const htmlListItemSplit = (li) => {
    const tagOf = (n) => (n.nodeType === 1 ? (n.tagName || n.localName || '').toLowerCase() : '');
    const kids = [...(li.childNodes || [])].filter((c) => (c.nodeType === 1 && tagOf(c) !== 'ul' && tagOf(c) !== 'ol') || (c.nodeType === 3 && c.textContent.trim()));
    const blockKids = kids.filter((c) => LI_BLOCK_TAGS.has(tagOf(c)));
    if (!blockKids.length || (kids.length === 1 && (tagOf(kids[0]) === 'p' || tagOf(kids[0]) === 'div'))) return null;
    const ownerDoc = li.ownerDocument || doc;
    if (!ownerDoc || !ownerDoc.createElement) return null;
    const mk = (tag, nodes) => { const el = keepLangOn(ownerDoc.createElement(tag), li); HTML_PARENT.set(el, li); for (const n of nodes) el.appendChild(n.cloneNode(true)); return el; };
    const firstBlock = kids.indexOf(blockKids[0]);
    let head, restNodes;
    if (firstBlock === 0 && (tagOf(kids[0]) === 'p' || tagOf(kids[0]) === 'div')) { head = kids[0]; restNodes = kids.slice(1); }
    else if (firstBlock > 0) { head = mk('span', kids.slice(0, firstBlock)); restNodes = kids.slice(firstBlock); }
    else return null;
    if (!restNodes.length) return null;
    return { head, rest: mk('div', restNodes) };
  };
  // Blocks the reading of a paragraph left for after it: a print page number inside a heading or list item, a picture (svg) in a paragraph.
  const flushAfter = () => { if (ctx.after.length) blocks.push(...ctx.after.splice(0)); };
  // A paragraph from segments that may hold print page numbers: split there (para … pagenum … para), linked with continued / continuation,
  // as the DTBook reader splits a paragraph at a page turn.
  const pushParaParts = (segments, make) => {
    let cur = [];
    let prev = null;
    const flushCur = () => {
      const part = htmlTrimSegs(cur);
      cur = [];
      if (!htmlSegsFlat(part) && !part.some((g) => g.type === 'math' || g.type === 'noteref')) return;
      const blk = make(part);
      if (!blk) return;
      if (prev) { prev.continued = true; blk.continuation = true; }
      blocks.push(blk);
      prev = blk;
    };
    for (const g of segments) { if (g.type === 'pagenum') { flushCur(); blocks.push(g.block); } else cur.push(g); }
    flushCur();
  };
  let noteSeq = 0;
  const walk = (el) => {
    for (const node of groupInlineRuns(el)) {
      flushAfter();
      if (node.inlineRun) {
        // S5D-Q4: a picture inside a run of inline pieces (a linked image: <a href><img alt></a>) is a picture before the line, as a picture
        // in a <p> is; it was dropped with its description.
        if (node.inlineRun.getElementsByTagName) for (const im of node.inlineRun.getElementsByTagName('img')) blocks.push(htmlImgGraphic(im));
        pushParaParts(htmlParagraphSegments(node.inlineRun, { pagenumSegments: true }), (segments) => (htmlSegsCarryMarkup(segments) ? { type: 'para', segments } : { type: 'para', text: htmlSegsFlat(segments) }));
        continue;
      }
      if (node.nodeType === 3) {           // text node sitting directly in a container
        let t = node.textContent.replace(/\s+/g, ' ').trim();
        const lg = t ? markupForeignLang(el) : null;   // a container in a foreign language (input/lang.mjs)
        const inh = t ? htmlInheritedState(el) : null; // a container that is bold / italic / upper case (CSS)
        if (t && inh.up) t = t.toUpperCase();
        if (t) blocks.push(lg || (inh && inh.tf) ? { type: 'para', segments: [{ type: 'text', text: t, ...(inh.tf ? { tf: inh.tf } : {}), ...(lg ? { lang: lg } : {}) }] } : { type: 'para', text: t });
        continue;
      }
      if (node.nodeType !== 1) continue;   // skip comments / processing instructions
      const tag = (node.tagName || node.localName || '').toLowerCase();
      if (tag === 'head' || tag === 'title' || tag === 'script' || tag === 'style' || tag === 'meta' || tag === 'link' || tag === 'template') continue;
      const pageValue = htmlPagebreakValue(node);        // epub:type="pagebreak" / role="doc-pagebreak" / data-pagenum: a print page number (never the paragraph "2")
      if (pageValue !== null) { if (pageValue) blocks.push({ type: 'pagenum', page: pageValue, text: pageValue }); continue; }
      const noteKind = htmlNoteKindOf(node);             // a note nothing refers to (epub:type footnote / endnote, role doc-footnote): a note where it stands, not a box
      if (noteKind) {
        const start = blocks.length;
        walk(node);
        flushAfter();
        const note = htmlMakeNote(blocks.splice(start), noteKind, `html-${ctx.file}#${(node.getAttribute && node.getAttribute('id')) || `note${++noteSeq}`}`);
        if (note) blocks.push(note);
        continue;
      }
      if (tag === 'svg') {                               // a picture with a description (or an <image>, as an EPUB cover page has it)
        const gs = htmlSvgGraphics(node);
        if (gs) { blocks.push(...gs); continue; }
      }
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (tag === 'math') {                // block-level <math> (not inside a <p>/etc)
        const mathml = texOnlyMathToMathML(mathOuterXml(node)) || mathOuterXml(node);   // A89
        const latex = mathmlToLatex(mathml);
        const blk = { type: 'math', mathml };
        if (latex) blk.latex = latex;
        blocks.push(blk);
      } else if (/^h[1-6]$/.test(tag)) {
        if (!text) continue;
        if (hasInlineElements(node)) {
          const segments = htmlParagraphSegments(node, { spaceBreaks: true });
          const hasEmphOrMath = htmlSegsCarryMarkup(segments);
          if (hasEmphOrMath) blocks.push({ type: 'heading', level: Number(tag[1]), segments, text: segments.some((g) => g.type === 'math') ? text : (htmlSegsFlat(segments) || text) });
          else {
            const flat = segments.map((s) => s.text || '').join('').replace(/\s+/g, ' ').trim();
            blocks.push({ type: 'heading', level: Number(tag[1]), text: flat || text });
          }
        } else {
          blocks.push({ type: 'heading', level: Number(tag[1]), text });
        }
      } else if (tag === 'p') {
        // A54: was `{type:'note', kind:'image', text:'Image: '+alt}` — an empty,
        // alt-text-only placeholder a transcriber could act on but the editor/format layer
        // could never render as a picture (no `src` at all). Now a real `{type:'graphic'}`
        // block, the same shape A45 established for DOCX/ODT — `src` resolved against the
        // chapter (parseHtml) or embedded from the package (parseEpub, below).
        const img = node.getElementsByTagName ? node.getElementsByTagName('img')[0] : null;
        if (img) blocks.push(htmlImgGraphic(img));
        const clsList = (node.getAttribute ? (node.getAttribute('class') || '') : '').split(/\s+/);
        const isG1 = clsList.includes('g1');
        // A47/D10: Gutenberg's verse convention is `<p class="poem">line one<br>line
        // two<br>…</p>` — a <br>-separated run of lines inside one paragraph. Emboss
        // already models a verse line as its own {type:'play', subtype:'verse',
        // style:'verse'} block (see parsePoem/nimas-export.mjs's 'verse'/'poem'/'play'
        // case, which serializes an untagged one as `<p class="bai-verse">` — no <poem>
        // wrapper invented for text that never had one). Only a class-marked
        // poem/verse paragraph is treated this way; an ordinary paragraph with a
        // stray <br> keeps its existing (space-joined) behaviour.
        const isVerse = clsList.some((c) => c.includes('poem') || c.includes('verse'));
        // A one-line verse paragraph (`<p class="poem">“Wow! wow! wow!”</p>`, a refrain between
        // two stanzas — 2 in the corpus's Alice) has no <br> and was read as prose; a paragraph
        // whose class is exactly `poem`/`verse` is verse line even with a single line.
        const isExactVerse = clsList.includes('poem') || clsList.includes('verse');
        if (isVerse && node.getElementsByTagName && (node.getElementsByTagName('br').length > 0 || isExactVerse)) {
          pushVerseLines(node, blocks);
        } else if (hasInlineElements(node)) {
          pushParaParts(htmlParagraphSegments(node, { pagenumSegments: true }), (segments) => {
            if (isG1) segments.forEach((g) => { g.uncontracted = true; });
            if (htmlSegsCarryMarkup(segments)) return { type: 'para', segments };
            const flat = htmlSegsFlat(segments);
            return flat ? { type: 'para', text: flat } : null;
          });
        } else if (text) {
          if (isG1) blocks.push({ type: 'para', segments: [{ type: 'text', text, uncontracted: true }] });
          else blocks.push({ type: 'para', text });
        }
      } else if (tag === 'img') {
        blocks.push(htmlImgGraphic(node));
      } else if (tag === 'figure') {
        const img = node.getElementsByTagName ? node.getElementsByTagName('img')[0] : null;
        const caption = node.getElementsByTagName ? node.getElementsByTagName('figcaption')[0] : null;
        const capText = caption ? caption.textContent.replace(/\s+/g, ' ').trim() : '';
        const g = img ? htmlImgGraphic(img) : { type: 'graphic', src: '', alt: '' };
        if (capText) g.caption = capText;
        const descText = htmlFigureDescription(node);        // S5D-Q4: the production-note description Emboss's own HTML export writes
        if (descText) g.description = descText;
        if (g.src || capText) blocks.push(g);
      } else if (tag === 'pre') {
        const code = htmlPreText(node);                 // keeps its lines and indentation (a code block, as the DTBook and Word readers make)
        if (code) blocks.push({ type: 'code', text: code });
      } else if (tag === 'code') {
        if (text) blocks.push({ type: 'code', text });
      } else if ((tag === 'ul' || tag === 'ol') && htmlNoteListItems(node)) {
        for (const li of htmlNoteListItems(node)) {     // a list whose items are all notes (epub:type footnote / endnote): notes, not a list
          const start = blocks.length;
          walk(li);
          flushAfter();
          const note = htmlMakeNote(blocks.splice(start), htmlNoteKindOf(li), `html-${ctx.file}#${li.getAttribute('id') || `note${++noteSeq}`}`);
          if (note) blocks.push(note);
        }
      } else if (tag === 'ul' || tag === 'ol') {
        const parseList = (listEl, lvl = 0) => {
          const isOl = (listEl.tagName || listEl.localName || '').toLowerCase() === 'ol';
          // <ol start>, <ol reversed> (counts down from the number of items) and <li value> number the items as print does
          const hasAttr = (el, n) => (el.hasAttribute ? el.hasAttribute(n) : (el.getAttribute && el.getAttribute(n) != null));
          const reversed = isOl && hasAttr(listEl, 'reversed');
          const intAttr = (el, n) => { const v = el.getAttribute ? parseInt(el.getAttribute(n), 10) : NaN; return Number.isNaN(v) ? null : v; };
          const itemCount = [...(listEl.childNodes || [])].filter((c) => c.nodeType === 1 && (c.tagName || c.localName || '').toLowerCase() === 'li').length;
          const startAttr = isOl ? intAttr(listEl, 'start') : null;
          const startVal = isOl ? (startAttr !== null ? startAttr : (reversed ? itemCount : 1)) : 1;
          let counter = startVal;
          const items = [];
          // <ol type="a|A|i|I"> (G8 stage 2): letters / roman numerals, counted from @start (a number, as in HTML).
          const typeAttr = isOl && listEl.getAttribute ? (listEl.getAttribute('type') || '') : '';
          const enumType = ['a', 'A', 'i', 'I'].includes(typeAttr) ? typeAttr : null;
          for (const li of listEl.childNodes || []) {
            // #46: text straight inside the list, between its items (invalid, but a browser shows it): an item with no marker, in its
            // place, as the DTBook reader keeps loose text in a <list> (A2)
            if (li.nodeType === 3 && /\S/.test(li.nodeValue || '')) {
              const loose = { text: li.nodeValue.replace(/\s+/g, ' ').trim() };
              if (lvl > 0) loose.level = lvl;
              items.push(loose);
              continue;
            }
            if (li.nodeType !== 1 || (li.tagName || li.localName || '').toLowerCase() !== 'li') continue;
            if (isOl && intAttr(li, 'value') !== null) counter = intAttr(li, 'value');
            const nestedLists = [];
            // An <li> holding several paragraphs, or a table / <pre> / quotation among its paragraphs: the first
            // paragraph is the item, the rest become item.blocks (read by the same walk as the body; see
            // document.mjs formatItemBlocks). An <li> of inline text, or with one <p>/<div>, reads as before.
            const liSplit = htmlListItemSplit(li);
            const headEl = liSplit ? liSplit.head : li;
            let itemText = '';
            for (const c of li.childNodes || []) {
              if (c.nodeType === 1 && ['ul', 'ol'].includes((c.tagName || c.localName || '').toLowerCase())) nestedLists.push(c);
            }
            for (const c of headEl.childNodes || []) {
              if (c.nodeType === 3) itemText += c.textContent;
              else if (c.nodeType === 1) {
                const cTag = (c.tagName || c.localName || '').toLowerCase();
                if (cTag === 'ul' || cTag === 'ol') continue;
                else if (cTag === 'br') itemText += ' ';
                else itemText += c.textContent;
              }
            }
            itemText = itemText.replace(/\s+/g, ' ').trim();
            // an item that is only a picture is kept (a bullet and the picture's note), not skipped as an empty item
            const ownPictures = liSplit ? [] : htmlItemOwnPictures(headEl);
            const onlyPicture = !itemText && ownPictures.length > 0;
            if (itemText || onlyPicture) {
              let item;
              if (hasInlineElements(headEl)) {
                const segments = htmlParagraphSegments(headEl);
                const hasEmphOrMath = htmlSegsCarryMarkup(segments);
                const segText = segments.some((s) => s.type === 'math') ? '' : htmlSegsFlat(segments);   // upper-cased text, a line break read as a space
                item = hasEmphOrMath ? { segments, text: segText || itemText } : { text: segText || itemText };
              } else {
                item = { text: itemText };
              }
              if (isOl) {
                item.marker = enumType && counter >= 1 ? synthesizeOrderedMarker(counter, enumType) : `${counter}.`;
                if (enumType && !items.some((x) => (x.level || 0) === lvl)) { item.enum = enumType; if (listEl.getAttribute('start')) item.start = startVal; }   // first item of a lettered group
                counter += reversed ? -1 : 1;
              } else {
                item.marker = '•';                     // <ul>: braille keeps the print bullet (BANA 8.6.2, primary bullet dots 456,3)
                stripDuplicateBullet(item);
              }
              if (lvl > 0) item.level = lvl;
              if (liSplit) {
                const start = blocks.length;
                walk(liSplit.rest);
                const ib = blocks.splice(start);
                if (ib.length) item.blocks = ib;
              } else {
                // A picture in the item's own text (<li>Apples <img alt="…"> …</li>, or a linked one) was dropped with its description (found
                // 17 Oct 2026, S5D-Q4): it is a picture of the item, after its text - where a picture after a paragraph in the item already goes.
                if (ownPictures.length) item.blocks = ownPictures;
              }
              items.push(item);
            }
            for (const nl of nestedLists) {
              items.push(...parseList(nl, lvl + 1));
            }
          }
          return items;
        };
        const items = parseList(node, 0);
        if (items.length) blocks.push({ type: 'list', items });
      } else if (tag === 'dl') {
        const items = [];
        let curTerm = null;
        let curTermSegs = null;
        let lastDdItem = null;                          // the item the last <dd> went into: a further <dd> is another definition of the same term
        for (const child of node.childNodes || []) {
          if (child.nodeType !== 1) continue;
          const cTag = (child.tagName || child.localName || '').toLowerCase();
          if (cTag === 'dt' || cTag === 'dfn') {
            lastDdItem = null;
            if (curTerm) {
              const item = { term: curTerm, def: '', text: curTerm };
              if (curTermSegs?.length) { item.termSegments = curTermSegs; item.segments = curTermSegs; }
              items.push(item);
            }
            curTerm = textExcludingBrl(child).replace(/\s+/g, ' ').trim();   // a <br> or a paragraph inside a term separates words
            curTermSegs = hasInlineElements(child) ? htmlParagraphSegments(child, { spaceBreaks: true }) : null;
          } else if (cTag === 'dd') {
            const defText = textExcludingBrl(child).replace(/\s+/g, ' ').trim();
            const defSegs = hasInlineElements(child) ? htmlParagraphSegments(child, { spaceBreaks: true }) : null;
            if (!curTerm && lastDdItem && defText) {     // a second <dd> for one <dt>: more of that term's definition (joined with a space), not a term of its own
              const it = lastDdItem;                     // (the formatter sets a glossary entry from term + def; it does not read item.blocks)
              const oldSegs = it.defSegments || [{ type: 'text', text: it.def }];
              it.def = `${it.def} ${defText}`.trim();
              it.text = it.term ? `${it.term} \u2014 ${it.def}` : it.def;
              if (it.defSegments || defSegs?.length) {
                it.defSegments = [...oldSegs, { type: 'text', text: ' ' }, ...(defSegs?.length ? defSegs : [{ type: 'text', text: defText }])];
                it.segments = [...(it.termSegments || [{ type: 'text', text: it.term || '' }]), { type: 'text', text: ' \u2014 ' }, ...it.defSegments];
              }
              continue;
            }
            if (curTerm || defText) {
              const item = {
                term: curTerm || '',
                def: defText || '',
                text: curTerm ? `${curTerm} — ${defText}` : defText
              };
              if (curTermSegs?.length) item.termSegments = curTermSegs;
              if (defSegs?.length) item.defSegments = defSegs;
              if (curTermSegs?.length || defSegs?.length) {
                item.segments = [...(curTermSegs || [{ type: 'text', text: curTerm || '' }]), { type: 'text', text: ' — ' }, ...(defSegs || [{ type: 'text', text: defText || '' }])];
              }
              items.push(item);
              lastDdItem = item;
              curTerm = null;
              curTermSegs = null;
            }
          }
        }
        if (curTerm) {
          const item = { term: curTerm, def: '', text: curTerm };
          if (curTermSegs?.length) { item.termSegments = curTermSegs; item.segments = curTermSegs; }
          items.push(item);
        }
        if (items.length) blocks.push({ type: 'list', kind: 'glossary', style: 'glossary', items });
      } else if (tag === 'table') {
        // IMP-W6: only THIS table's own caption, rows and cells (a nested table's are its own; it follows this table as a table).
        const captionEl = htmlOwnDescendants(node, ['caption'])[0] || null;
        const captionText = captionEl ? captionEl.textContent.replace(/\s+/g, ' ').trim() : null;
        const rows = htmlOwnDescendants(node, ['tr']);
        const rowCellEls = (tr) => htmlOwnDescendants(tr, ['th', 'td']);
        const nestedQueue = [];
        const colspanOf = (el) => htmlSpan(el, 'colspan');
        // F-1 companion: the table's real column count (mostCommonRowWidth, above), used
        // below to clamp an over-wide colspan to whatever columns are actually left in its
        // row — see readSpannedRow's own tableColCount parameter.
        const tableColCount = mostCommonRowWidth(rows.map((tr) => rowCellEls(tr).reduce((a, c) => a + colspanOf(c), 0)));
        const headers = [];
        const tableRows = [];
        let headerRowFound = false;
        // D8: a cell keeps emphasis, links and maths (a { text, segments } object; plain stays
        // a string); a picture in a cell becomes a graphic block after the table.
        const cellPictures = [];
        const htmlCellValue = (cell0) => {
          // IMP-W6: a table nested in this cell is replaced, in a copy of the cell, by a placeholder; the table itself follows this one.
          let cell = cell0;
          const innerTables = htmlOwnDescendants(cell0, ['table']);
          if (innerTables.length) {
            cell = htmlCopyWithoutNestedTables(cell0, cell0.ownerDocument || doc);
            for (const nt of innerTables) nestedQueue.push(nt);
          }
          const flat = textExcludingBrl(cell).replace(/\s+/g, ' ').trim();
          for (const im of (cell.getElementsByTagName ? [...cell.getElementsByTagName('img')] : [])) {
            const cg = htmlImgGraphic(im);
            if (cg.src || cg.alt) cellPictures.push(cg);
          }
          const cellSegs = htmlParagraphSegments(cell);
          const rich = richCellFromSegments(cellSegs);
          if (rich) return rich;
          // #54: a plain cell holding a sub/superscript keeps its level markers (the flat text reads "H2O"), as a paragraph does
          if (flat && cellSegs.some((g) => g.type === 'text' && /[\uE000-\uE002]/.test(g.text || ''))) {
            const marked = cellSegs.map((g) => (g.type === 'text' ? g.text || '' : '')).join('').replace(/\s+/g, ' ').trim();
            if (marked.replace(/[\uE000-\uE002]/g, '') === flat) return marked;
          }
          if (flat) return flat;
          // BrailleBlaster test fixtures (TablesTestXml.xml): a cell whose only content is
          // a <brl> (no print text at all) holds LITERAL braille — modelled the same way
          // document.mjs's {type:'brl'} segment already does elsewhere (F-187/F-188/F-222),
          // not silently dropped (an empty <brl></brl>, i.e. genuinely no braille either,
          // still falls through to the plain '' below, same as a truly empty cell).
          const brlText = brlTextOf(cell);
          return brlText ? { text: '', segments: [{ type: 'brl', text: '', brl: brlText }] } : flat;
        };
        const thead = htmlOwnDescendants(node, ['thead'])[0] || null;
        // #4: the <thead> rows read as headings (the rest of a <thead>'s rows lead the body below, as the DTBook reader's A28)
        const headRowsRead = new Set();
        let headerGroups = null;
        if (thead) {
          const theadTrs = htmlOwnDescendants(thead, ['tr']);
          // #4: two head rows of <th> whose first row has a spanning cell are a two-tier heading (BANA 11.4.3), read as the DTBook
          // reader reads it (parseTable isTwoTierHeader): a colspan cell of row 1 is a group over its sub-columns (headerGroups), a
          // rowspan cell a heading of its own column beside the groups; row 2 gives the column headings.
          const tagOf = (el) => (el.localName || el.tagName || '').toLowerCase();
          const rowspanOf = (el) => htmlSpan(el, 'rowspan');
          const row1 = theadTrs.length ? htmlOwnDescendants(theadTrs[0], ['th', 'td']) : [];
          const row2 = theadTrs.length > 1 ? htmlOwnDescendants(theadTrs[1], ['th', 'td']) : [];
          const twoTier = theadTrs.length === 2 && row1.length > 0 && row2.length > 0 && row1.every((el) => tagOf(el) === 'th') && row2.every((el) => tagOf(el) === 'th')
            && row1.some((el) => colspanOf(el) > 1 || rowspanOf(el) > 1);
          if (twoTier) {
            const groups = [], spanning = new Map(), flat = [];
            let col = 0;
            for (const el of row1) {
              const v = htmlCellValue(el), cs = colspanOf(el);
              if (rowspanOf(el) > 1) spanning.set(col, v);
              else if (cs > 1) groups.push({ text: v, from: col, to: col + cs - 1 });
              else if (v) groups.push({ text: v, from: col, to: col });
              col += cs;
            }
            let col2 = 0;
            for (const el of row2) {
              while (spanning.has(col2)) col2++;
              const v = htmlCellValue(el);
              for (let k = 0; k < colspanOf(el); k++) { flat[col2] = v && typeof v === 'object' ? { ...v } : v; col2++; }   // IMP-W5: a merged heading repeats
            }
            for (const [c, v] of spanning) flat[c] = v;
            const n = Math.max(col, col2, ...groups.map((g) => g.to + 1), 0);
            for (let c = 0; c < n; c++) if (flat[c] === undefined) flat[c] = '';
            headers.push(...flat);
            headerGroups = groups;
            headerRowFound = true;
            headRowsRead.add(theadTrs[0]); headRowsRead.add(theadTrs[1]);
          } else if (theadTrs.length) {
            headRowsRead.add(theadTrs[0]);
            const cells = htmlOwnDescendants(theadTrs[0], ['th', 'td']);
            // IMP-W5: a header cell with colspan repeats its text over the columns it covers (an empty header cell was dropped before
            // and still is, unless it spans columns).
            for (const c of cells) {
              const v = htmlCellValue(c);
              const span = colspanOf(c);
              if (!v && span === 1) continue;
              for (let k = 0; k < span; k++) headers.push(v && typeof v === 'object' ? { ...v } : v);
            }
            headerRowFound = true;
          }
        }
        // BUG (24 Sep, EMBOSS-TASKS.md section T): the same leading-spanning-title-row
        // check as parseTable's own DTBook reader, mirrored here for the HTML path — a
        // first row of ONE cell spanning every column is the table's TITLE, not its column
        // heading; moved to `tbl.title` below so the real heading row (an all-<th> row, or
        // one wholly bold — firstRowIsBoldHeader) is read as the table's first row instead.
        let spanningTitleRow = null;
        let spanningTitleText = null;
        if (!thead) {
          if (rows.length >= 2) {
            const firstCells = rowCellEls(rows[0]);
            if (firstCells.length === 1) {
              let colCount = 0;
              for (let k = 1; k < rows.length; k++) {
                const sum = rowCellEls(rows[k]).reduce((a, c) => a + colspanOf(c), 0);
                if (sum > colCount) colCount = sum;
              }
              const firstColspan = colspanOf(firstCells[0]);
              if (colCount >= 2 && (firstColspan === colCount || firstColspan <= 1)) {
                spanningTitleRow = rows[0];
              }
            }
          }
        }
        // F-1: a rowspanned cell is read once, on its own <tr>, and BANA 11.5.3a requires
        // every row it covers to keep that column blank rather than let the next real cell
        // shift into it — readSpannedRow (shared with the ODT table reader, above) tracks
        // that across the rows loop the same way parseTable/readSpannedRow does for DTBook.
        const readSpannedRow = createSpanReader();
        const colAlignVotes = [];   // K3: column index -> Set of aligns seen across data cells
        for (let i = 0; i < rows.length; i++) {
          const tr = rows[i];
          if (headRowsRead.has(tr)) continue;   // #4: a further <thead> row not read as a heading leads the body
          if (tr === spanningTitleRow) {
            const titleCell = htmlOwnDescendants(tr, ['th', 'td'])[0];
            spanningTitleText = titleCell ? titleCell.textContent.replace(/\s+/g, ' ').trim() : null;
            continue;
          }
          const ths = htmlOwnDescendants(tr, ['th']);
          const tds = htmlOwnDescendants(tr, ['td']);
          // IMP-W5: a header cell with colspan repeats its text over the columns it covers.
          const spanHeaders = (els, vals) => els.forEach((el, n) => { for (let k = 0; k < colspanOf(el); k++) headers.push(vals[n] && typeof vals[n] === 'object' ? { ...vals[n] } : vals[n]); });
          if (!headerRowFound && ths.length && !tds.length) {
            spanHeaders(ths, ths.map(htmlCellValue));
            headerRowFound = true;
          } else {
            // Bug 2: no <thead>/<th> row, but the FIRST row is the print heading row —
            // wholly bold cells (see firstRowIsBoldHeader). cellVals is computed once (not
            // re-derived per branch) so htmlCellValue's cellPictures side effect fires only
            // once per cell.
            const cellEls = [...ths, ...tds];
            const cellVals = cellEls.map(htmlCellValue);
            if (!headerRowFound && tableRows.length === 0 && cellEls.length && firstRowIsBoldHeader(cellVals)) {
              spanHeaders(cellEls, cellVals);
              headerRowFound = true;
            } else {
              const cells = cellEls.map((cell, idx) => ({
                text: cellVals[idx],
                colspan: htmlSpan(cell, 'colspan'),
                rowspan: htmlSpan(cell, 'rowspan'),
                align: markupCellAlign(cell),   // K3: this data cell's own align/style (td/th)
              }));
              const rowCells = readSpannedRow(cells, tableColCount, (col, cell) => {
                if (cell.align) (colAlignVotes[col] ||= new Set()).add(cell.align);
              });
              if (rowCells.some(Boolean)) tableRows.push(rowCells);
            }
          }
        }
        if (captionText) {
          blocks.push({ type: 'caption', text: captionText });
        }
        if (headers.length || tableRows.length) {
          const tbl = { type: 'table', headers, rows: tableRows };
          if (headerGroups && headerGroups.length) tbl.headerGroups = headerGroups;   // #4: BANA 11.4.3 two-tier heading
          if (spanningTitleText) { tbl.title = spanningTitleText; tbl.titlePosition = 'in-box'; }
          // K3: <col>/<colgroup> (column-level, explicit authorial intent) wins over the
          // per-cell vote (a column whose own td/th cells disagree, or carry no signal).
          const colsAlign = directTableCols(node).map(markupCellAlign);
          const alignCols = Math.max(colsAlign.length, colAlignVotes.length);
          const printAlign = Array.from({ length: alignCols }, (_, c) => {
            const s = colAlignVotes[c];
            return colsAlign[c] || (s && s.size === 1 ? [...s][0] : undefined);
          });
          if (printAlign.some(Boolean)) tbl.printAlign = printAlign;
          blocks.push(tbl);
        }
        blocks.push(...cellPictures);
        // IMP-W6: each table nested in this one follows it as a table of its own (and any nested in those, after them).
        for (const nt of nestedQueue) walk({ childNodes: [nt], ownerDocument: doc });
      } else if (tag === 'tbody' || tag === 'thead' || tag === 'tfoot') {
        walk(node);
      } else if (tag === 'tr') {
        walk(node);
      } else if (tag === 'blockquote') {
        // A47/D9: a <blockquote> is Emboss's displayed-quotation block (the one <blockquote>
        // in DTBook maps to — see parseDtbook's tag==='blockquote' branch and
        // nimas-export.mjs's `style==='quote'` -> <blockquote class="quote"><p>…</p></blockquote>),
        // NOT a transcriber's note (<prodnote>, read aloud as one — wrong and misleading for
        // quoted material). A single <p> child (or plain/wrapped inline content, e.g. Gutenberg's
        // `<blockquote><div>…</div></blockquote>`) becomes one style:'quote' paragraph; more than
        // one block is grouped under one blockquoteId (matching parseDtbook's own A40
        // multi-paragraph handling) so the exporter wraps them all in a single <blockquote>.
        // Import fix list #9: EVERYTHING in the quotation is kept, in order — paragraphs, headings, a <footer> / <cite> attribution
        // (an attribution line, as the DTBook reader makes it), <div>s, lists, tables, pictures — and all of it shares the quotation's id.
        // K6 / BANA §9.2.2d: a displayed paragraph's own CSS `text-indent` (positive, non-zero)
        // means print indents that paragraph's own first line -> the "indented" form
        // (optional `displayIndent`, field-registry.mjs); a blockquote <p> with none (the
        // ordinary case) stays "blocked", unchanged from before this fix.
        const hasPositiveTextIndent = (el) => {
          const style = (el.getAttribute && el.getAttribute('style')) || '';
          const m = /text-indent\s*:\s*(-?[\d.]+)/i.exec(style);
          return !!(m && Number(m[1]) > 0);
        };
        const pushQuotePara = (target) => {
          const t = target.textContent.replace(/\s+/g, ' ').trim();
          if (!t) return;
          let b;
          if (hasInlineElements(target)) {
            const segs = htmlParagraphSegments(target);
            b = htmlSegsCarryMarkup(segs) ? { type: 'para', style: 'quote', text: segs.some((g) => g.type === 'math') ? t : (htmlSegsFlat(segs) || t), segments: segs } : { type: 'para', style: 'quote', text: htmlSegsFlat(segs) || t };
          } else {
            b = { type: 'para', style: 'quote', text: t };
          }
          if (target.nodeType === 1 && hasPositiveTextIndent(target)) b.displayIndent = true;
          blocks.push(b);
        };
        const pushAttribution = (target) => {
          const t = target.textContent.replace(/\s+/g, ' ').trim();
          if (!t) return;
          const segs = hasInlineElements(target) ? htmlParagraphSegments(target, { spaceBreaks: true }) : null;
          blocks.push(segs && htmlSegsCarryMarkup(segs) ? { type: 'attribution', text: t, segments: segs } : { type: 'attribution', text: t });
        };
        const QUOTE_CONTAINERS = new Set(['div', 'section', 'article', 'center', 'main', 'header', 'address']);
        const isQuoteBlock = (c) => {
          if (c.nodeType !== 1) return false;
          const tg = htmlTag(c);
          if (QUOTE_CONTAINERS.has(tg)) return htmlHasBlockDescendant(c);       // a <div> of plain text is part of the quoted words
          return HTML_BLOCK_TAGS.has(tg) || tg === 'img' || tg === 'svg' || tg === 'math';
        };
        const quoteContent = (container) => {
          let run = [];
          const flushRun = () => {
            const nodes = run;
            run = [];
            if (!nodes.some((n) => (n.textContent || '').trim() || n.nodeType === 1)) return;     // blanks only
            const els = nodes.filter((n) => n.nodeType === 1);
            const wrapper = keepLangOn(doc.createElement('span'), container);
            HTML_PARENT.set(wrapper, container);
            for (const n of nodes) wrapper.appendChild(n.cloneNode(true));
            // a run that is only a <cite> is the attribution line (parseDtbook reads a <cite> directly inside a blockquote the same way)
            if (els.length === 1 && htmlTag(els[0]) === 'cite' && nodes.every((n) => n === els[0] || (n.nodeType === 3 && !n.textContent.trim()))) pushAttribution(els[0]);
            else pushQuotePara(wrapper);
          };
          for (const c of container.childNodes || []) {
            if (c.nodeType !== 1 && c.nodeType !== 3) continue;
            if (!isQuoteBlock(c)) { run.push(c); continue; }
            flushRun();
            const tg = htmlTag(c);
            const hm = /^h([1-6])$/.exec(tg);
            if (tg === 'p') pushQuotePara(c);
            else if (hm) { const ht = c.textContent.replace(/\s+/g, ' ').trim(); if (ht) blocks.push({ type: 'heading', level: Number(hm[1]), text: ht, displayed: true }); }
            else if (tg === 'footer' || tg === 'figcaption') pushAttribution(c);
            else if (QUOTE_CONTAINERS.has(tg)) quoteContent(c);
            else walk({ childNodes: [c], ownerDocument: doc });               // a list, table, <pre>, figure, nested quotation, picture, formula…
          }
          flushRun();
        };
        const start = blocks.length;
        quoteContent(node);
        flushAfter();
        const made = blocks.slice(start);
        // K6 / BANA 9.1.2 (lists within displayed material use its adjusted margins), as the DTBook reader tags them: a list (and a
        // heading) inside the quotation is displayed (#50: the HTML reader left lists untagged, so the braille changed on reopening)
        for (const b of made) if (b && (b.type === 'list' || b.type === 'heading')) b.displayed = true;
        if (made.length > 1 || (made.length === 1 && made[0].type !== 'para')) {
          const id = ++blockquoteRunSeq;
          const bqClass = (node.getAttribute && node.getAttribute('class')) || null;
          for (const b of made) {
            b.blockquoteId = id;
            if (bqClass) b.blockquoteClass = bqClass;
          }
        }
      } else if (tag === 'pagenum' || (node.dataset && node.dataset.pagenum) || (node.getAttribute && node.getAttribute('role') === 'doc-pagebreak')) {
        const pVal = text || node.dataset?.pagenum || (node.getAttribute ? (node.getAttribute('aria-label') || node.getAttribute('title')) : '') || '';
        if (pVal) blocks.push({ type: 'pagenum', page: pVal, text: pVal });
      } else if (node.getAttribute && (
        (node.getAttribute('class') || '').toLowerCase().split(/\s+/).includes('dedication')
        || (node.getAttribute('epub:type') || '').toLowerCase().split(/\s+/).includes('dedication')
        || (node.getAttribute('role') || '').toLowerCase().split(/\s+/).includes('doc-dedication')
      )) {
        // K30 / BANA 2.9.1f: a dedication wrapper (HTML class="dedication", EPUB
        // epub:type="dedication", or ARIA role="doc-dedication") — every block it produces is
        // marked `dedication` so document.mjs's emphasisContext (K1) groups them for decorative
        // emphasis, the same shape the blockquoteId tagging above uses.
        const start = blocks.length;
        walk(node);
        for (let i = start; i < blocks.length; i++) blocks[i].dedication = true;
      } else if (htmlBoxSignal(node)) {
        // K7/BANA §7 (box/sidebar detection — see the file comment above htmlBoxSignal): every
        // block the wrapper produces (headings, lists, pictures, paragraphs — the ordinary walk,
        // completely unchanged) is gathered into one { type: 'box' }, exactly like a DTBook
        // <sidebar> (parseDtbook's parseSidebar) or a bordered DOCX paragraph run/table/text box
        // (parseDocx, above) — the same extractBoxTitle heuristic pulls a leading heading or
        // short bold paragraph out as the box's own title.
        const start = blocks.length;
        walk(node);
        const inner = blocks.splice(start, blocks.length - start);
        if (inner.length) {
          const box = { type: 'box' };
          const boxTitle = extractBoxTitle(inner);
          if (boxTitle) box.title = boxTitle;
          if (!inner.length) inner.push({ type: 'para', text: boxTitle || text });   // a box that was only ever a title
          const bg = htmlBackgroundColor(node.getAttribute('style') || '');
          if (bg) { const name = hexToColorName(bg); if (name) box.boxColor = name; }
          box.blocks = inner;
          blocks.push(box);
        }
      } else if (node.children?.length || node.childNodes?.length) {
        walk(node);                       // descend into wrappers (div, section, article...)
      } else if (text) {
        blocks.push({ type: 'para', text });
      }
    }
  };
  for (const ne of ctx.noteEls) {                // the notes lifted out of the page: read, then placed at their references
    const start = blocks.length;
    walk(ne.el);
    flushAfter();
    const note = htmlMakeNote(blocks.splice(start), ne.kind, ne.key);
    if (note) ctx.notes.set(ne.key, { block: note, placed: false });
  }
  htmlAriaListsToLists(root);
  walk(root);
  flushAfter();
  if (!(opts && opts.deferNotes)) placeHtmlNotes(blocks, ctx.notes);   // (an EPUB places them once every chapter is read)
  return opts && opts.rawLang ? { title, blocks } : finishLanguages({ title, blocks });   // foreign-language noise dropped (input/lang.mjs)
}

// ---------- docx ----------
// ---------- limits for hostile files (A89 step 4; Paul, 2 Oct 2026: Emboss never crashes, hangs or runs out of memory) ----------
// Every limit is far beyond anything a real document has (measured on the real samples in tests/: the biggest deflated part is 3 MB, the
// biggest archive 13 MB inflated; the 60 MB test book of check-extreme-documents.mjs --heavy is one part of 60 MB).
// A table span (colspan, rowspan, w:gridSpan, table:number-columns-spanned, <col span>) is clamped to 1,000, as browsers clamp colspan.
export const MAX_TABLE_SPAN = 1000;
// A span read from a file: a whole number from 1 to MAX_TABLE_SPAN (zero, negative and non-numbers are 1, as browsers read them).
function clampSpan(n, max = MAX_TABLE_SPAN) { return !(n >= 1) ? 1 : n > max ? max : n; }
// a rowspan only counts the rows a cell covers (never a loop over them), so it may be as large as a browser allows: 65,534
export const MAX_ROW_SPAN = 65534;
function htmlSpan(el, name) { return clampSpan(parseInt(el.getAttribute ? (el.getAttribute(name) || '1') : '1', 10) || 1, name === 'rowspan' ? MAX_ROW_SPAN : MAX_TABLE_SPAN); }
// One deflated part of a zip may inflate to 512 MB, all the parts of one archive together to 1 GB; beyond that the file is refused (a zip bomb:
// 1 MB of file that inflates to 1 GB, or more).
export const MAX_ZIP_PART_BYTES = 512 * 1024 * 1024;
export const MAX_ZIP_TOTAL_BYTES = 1024 * 1024 * 1024;
// XML entity references (a DOCTYPE's <!ENTITY name "value">) may add 32 MB of text to a file in all.
export const MAX_ENTITY_EXPANSION_CHARS = 32 * 1024 * 1024;
// Nesting depths (groups of an RTF file; equations; content controls; lists; tables): real documents nest a few dozen levels at most, a stack
// overflows at a few thousand. Below the limit a file is read as before; deeper parts are read flat (the text kept), and the load notice says so.
const RTF_MAX_DEPTH = 200;
const ODT_MAX_LIST_DEPTH = 200;

// A file Emboss could not read, with a message the editor and Quick Mode show as it is (userFacing: see docxUserError, below).
const ZIP_DAMAGED_MSG = 'This file is damaged or incomplete and could not be read.';
const ZIP_TOO_BIG_MSG = 'This file expands to far more data than any real document holds, so Emboss stopped reading it. It may be damaged, or made on purpose to overload a program.';
// A damaged part is named (audit batch S2b item 21): "... could not be read. The damaged part is "word/document.xml"."
function zipDamagedError(detail, part) { const e = new Error(part ? `${ZIP_DAMAGED_MSG} The damaged part is "${part}".` : ZIP_DAMAGED_MSG); e.userFacing = true; e.zipDamaged = true; if (detail) e.detail = detail; if (part) e.part = part; return e; }
// A part Emboss cannot unpack (a compression it does not have, or encryption): said as that, not as damage (audit batch S2b item 21).
function zipUnsupportedError(message, part) { const e = new Error(message); e.userFacing = true; e.zipUnsupported = true; if (part) e.part = part; return e; }
function zipTooBigError() { const e = new Error(ZIP_TOO_BIG_MSG); e.userFacing = true; e.zipTooBig = true; return e; }

// Inflates a raw deflate stream, stopping (zipTooBigError) once it has made more than `limit` bytes; a stream that is corrupt or cut short is
// a damaged file (zipDamagedError), never the library's own error ("TypeError", Z_DATA_ERROR).
async function inflateRaw(bytes, limit = MAX_ZIP_PART_BYTES) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { reader.cancel().catch(() => {}); throw zipTooBigError(); }
      chunks.push(value);
    }
  } catch (e) {
    if (e && e.zipTooBig) throw e;
    throw zipDamagedError(String((e && (e.message || e.code)) || e));
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

// Normalise to a Uint8Array view over a real ArrayBuffer (accepts an ArrayBuffer or any
// typed-array view over one).
function zipBytes(buf) {
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (buf && buf.buffer instanceof ArrayBuffer) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return new Uint8Array(buf);
}

// CRC-32 (the zip checksum), eight bytes at a time (a 13 MB book is checked in a few tens of milliseconds).
const CRC_TABLES = (() => {
  const t = new Uint32Array(256 * 8);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[i] = c; }
  for (let i = 0; i < 256; i++) { let c = t[i]; for (let k = 1; k < 8; k++) { c = t[c & 0xFF] ^ (c >>> 8); t[k * 256 + i] = c; } }
  return t;
})();
function crc32(u8) {
  const T = CRC_TABLES;
  let c = -1, i = 0;
  const n = u8.length, end8 = n - (n % 8);
  for (; i < end8; i += 8) {
    const lo = c ^ (u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16) | (u8[i + 3] << 24));
    c = T[1792 + (lo & 0xFF)] ^ T[1536 + ((lo >>> 8) & 0xFF)] ^ T[1280 + ((lo >>> 16) & 0xFF)] ^ T[1024 + (lo >>> 24)]
      ^ T[768 + u8[i + 4]] ^ T[512 + u8[i + 5]] ^ T[256 + u8[i + 6]] ^ T[u8[i + 7]];
  }
  for (; i < n; i++) c = (c >>> 8) ^ T[(c ^ u8[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

// Minimal ZIP reader: scan the central directory once and list every entry (name, storage
// method, compressed size, local-header offset). Shared by unzipEntry (docx/odt/epub, below)
// and, since A3, the NIMAS package importer, which needs to probe/list entries rather than
// just pull one out by name.
function listZipEntries(buf) {
  const u8 = zipBytes(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // find End Of Central Directory (sig 0x06054b50), scanning back
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw zipDamagedError('not a zip (no EOCD)');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = [];
  for (let n = 0; n < count; n++) {
    // every offset and length read from the file is checked against the file's own size: a directory that points outside the
    // file is a damaged file (zipDamagedError), never a raw "Offset is outside the bounds of the DataView"
    if (off + 46 > u8.length) throw zipDamagedError('the central directory points outside the file');
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const flags = dv.getUint16(off + 8, true);
    const method = dv.getUint16(off + 10, true);
    const crc = dv.getUint32(off + 16, true);
    const compSize = dv.getUint32(off + 20, true);
    const size = dv.getUint32(off + 24, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    if (off + 46 + nameLen + extraLen + commentLen > u8.length) throw zipDamagedError('a central directory entry runs past the end of the file');
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
    entries.push({ name, method, compSize, localOff, flags, crc, size });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Extract one already-located entry's bytes (inflating if needed).
// What has been inflated from one archive so far (keyed by the archive's own buffer, so it lasts as long as the document): each part's
// size once (a part is read several times), and the parts that failed (read again they fail at once, not after inflating 512 MB again).
const ZIP_STATE = new WeakMap();
function zipState(u8) {
  let st = ZIP_STATE.get(u8.buffer);
  if (!st) { st = { sizes: new Map(), bad: new Map(), verified: new Set() }; ZIP_STATE.set(u8.buffer, st); }
  return st;
}
async function extractZipEntry(buf, entry) {
  const u8 = zipBytes(buf);
  const st = zipState(u8);
  if (st.bad.has(entry.localOff)) throw st.bad.get(entry.localOff);
  try {
    // An encrypted part, or a compression Emboss does not have, is said as that (audit batch S2b item 21), not guessed at as damage.
    if ((entry.flags & 1) || (entry.flags & 0x40)) throw zipUnsupportedError(`This file contains an encrypted part ("${entry.name}"), and Emboss cannot read encrypted files. Open it in the program that made it, save an unprotected copy, and load that.`, entry.name);
    if (entry.method !== 0 && entry.method !== 8) throw zipUnsupportedError(`This file contains a part ("${entry.name}") that is compressed in a way Emboss cannot read (method ${entry.method}). Open it in the program that made it, save it again as an ordinary file, and load that.`, entry.name);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (entry.localOff + 30 > u8.length || dv.getUint32(entry.localOff, true) !== 0x04034b50) throw zipDamagedError('a part\'s header is not where the directory says', entry.name);
    const lNameLen = dv.getUint16(entry.localOff + 26, true);
    const lExtraLen = dv.getUint16(entry.localOff + 28, true);
    const dataStart = entry.localOff + 30 + lNameLen + lExtraLen;
    if (dataStart + entry.compSize > u8.length) throw zipDamagedError('a part runs past the end of the file', entry.name);
    const data = u8.subarray(dataStart, dataStart + entry.compSize);
    let out;
    if (entry.method === 0) out = data;
    else {
      let others = 0;
      for (const [off, size] of st.sizes) if (off !== entry.localOff) others += size;
      try { out = await inflateRaw(data, Math.min(MAX_ZIP_PART_BYTES, MAX_ZIP_TOTAL_BYTES - others)); }
      catch (e) { if (e && e.zipDamaged && !e.part) e.message = `${ZIP_DAMAGED_MSG} The damaged part is "${entry.name}".`, e.part = entry.name; throw e; }
      st.sizes.set(entry.localOff, out.byteLength);
    }
    // The size and the CRC-32 the directory declares (audit batch S2b item 21): a part whose bytes changed, or that was cut short or
    // extended, is damaged, however cleanly it unpacked. (A size of 0xFFFFFFFF belongs to Zip64: not checked.) Checked once per part.
    if (!st.verified.has(entry.localOff)) {
      if (entry.size !== 0xFFFFFFFF && out.byteLength !== entry.size) throw zipDamagedError(`the part is ${out.byteLength} bytes, not the ${entry.size} the file says`, entry.name);
      if (crc32(out) !== entry.crc) throw zipDamagedError('the part does not match its checksum', entry.name);
      st.verified.add(entry.localOff);
    }
    return out;
  } catch (e) {
    if (e && (e.zipDamaged || e.zipTooBig || e.zipUnsupported)) st.bad.set(entry.localOff, e);
    throw e;
  }
}

// Per-archive replacement parts (see prepareDocxPackage): a normalised copy of a part, or a part under the name the
// readers expect. Keyed by the archive's own buffer, so it lasts exactly as long as that document.
const ZIP_OVERRIDES = new WeakMap();
async function unzipEntry(buf, wanted) {
  const over = buf && typeof buf === 'object' ? ZIP_OVERRIDES.get(buf) : null;
  if (over && over.has(wanted)) return over.get(wanted);
  const entry = listZipEntries(buf).find((e) => e.name === wanted);
  if (!entry) throw new Error(`entry not found in zip: ${wanted}`);
  return extractZipEntry(buf, entry);
}

// Direct child element by namespace + local name. Uses childNodes (not
// .children) so it works in both the browser DOM and @xmldom/xmldom (Node).
function firstChildNS(el, ns, ln) {
  for (const c of el.childNodes || []) {
    if (c.nodeType === 1 && c.localName === ln && c.namespaceURI === ns) return c;
  }
  return null;
}

// docx-parity item 3: the run whose `<w:r>` this is sits somewhere inside exactly one
// `<w:p>` (possibly nested several levels down — a hyperlink, an sdt, a smartTag — none of
// which carry paragraph properties of their own), so walking straight up to the nearest
// ancestor `w:p` and reading ITS `w:pPr/w:pStyle` gives the run's own paragraph style id
// regardless of how deep the run sits. Returns '' (never null) when the paragraph has no
// style at all, matching every other paragraph-style-id read in this file (e.g. `styleEl?.
// getAttributeNS(W, 'val') || ''`).
function nearestParagraphStyleId(r, W) {
  let n = r.parentNode;
  while (n) {
    if (n.namespaceURI === W && n.localName === 'p') {
      const pPr = firstChildNS(n, W, 'pPr');
      const pStyle = pPr && firstChildNS(pPr, W, 'pStyle');
      return pStyle ? (pStyle.getAttributeNS(W, 'val') || '') : '';
    }
    n = n.parentNode;
  }
  return '';
}

// docx-parity item 3: resolve one property up a PARAGRAPH style's own w:basedOn chain (the
// same walk resolveStyleNumPr/resolveStyleTabs already do for numPr/tabs) — the nearest
// style in the chain that set `prop` (non-null/undefined) wins. `styleMap` is parseDocxStyles'
// own map, now also carrying each paragraph style's OWN w:rPr toggles (vanish/specVanish/
// vertAlign/caps/smallCaps/strike/dstrike — see parseDocxStyles). No hyperlink special case
// here: that exclusion is specific to CHARACTER styles (a hyperlink's underline meaning
// "this is a link", not emphasis) and has no paragraph-style equivalent.
function paraStyleFlag(styleId, styleMap, prop) {
  if (!styleId || !styleMap) return null;
  let cur = String(styleId).toLowerCase();
  const seen = new Set();
  while (cur && !seen.has(cur) && seen.size < 20) {
    seen.add(cur);
    const st = styleMap.get(cur);
    if (!st) break;
    const v = st[prop];
    if (v !== null && v !== undefined) return v;
    cur = (st.basedOn || '').toLowerCase();
  }
  return null;
}

// A run's vertical alignment from w:rPr/w:vertAlign/@w:val: 'sub' | 'sup' | null. Direct
// formatting on the run wins outright (including an explicit "baseline", which stops the
// cascade rather than falling through); failing that, docx-parity item 3 falls back to the
// run's character style (rStyle, via charStyleVertAlign — walks the SAME w:basedOn chain
// charStyleCapsSmallCaps/charStyleStrike already use), then its paragraph style
// (nearestParagraphStyleId + paraStyleFlag, above), then finally styles.xml's own
// `w:docDefaults/w:rPrDefault/w:rPr` (parseDocxRunDefaults) — the same low-to-high
// precedence .doc's own resolveChp uses (paragraph style chp as the base, character style
// chain layered on top, direct sprm formatting last — see doc.mjs). `charStyles` (optional)
// carries `.paraStyles` (parseDocxStyles' map) and `.docDefaults` bundled onto it by
// parseDocx, once per document, so every caller already passing `charStyles` through gets
// this fallback for free with no other signature changes.
function runScript(r, W, charStyles = null) {
  const rPr = firstChildNS(r, W, 'rPr');
  const va = rPr && firstChildNS(rPr, W, 'vertAlign');
  if (va) {
    const val = (va.getAttributeNS(W, 'val') || '').toLowerCase();
    return val === 'subscript' ? 'sub' : val === 'superscript' ? 'sup' : null;
  }
  if (charStyles && charStyles.size) {
    const rs = rPr && firstChildNS(rPr, W, 'rStyle');
    if (rs) { const v = charStyleVertAlign(rs.getAttributeNS(W, 'val'), charStyles); if (v !== null) return v; }
  }
  const paraStyles = charStyles && charStyles.paraStyles;
  if (paraStyles && paraStyles.size) {
    const v = paraStyleFlag(nearestParagraphStyleId(r, W), paraStyles, 'vertAlign');
    if (v) return v;
  }
  const docDefaults = charStyles && charStyles.docDefaults;
  return (docDefaults && docDefaults.vertAlign) || null;
}

// liblouis typeform bits (match louis.TYPEFORM used by the editor): italic=1, underline=2, bold=4,
// script=8 (K5, UEB §9: liblouis's en-ueb-g1.ctb `emphclass script`, engine/louis.mjs TYPEFORM.script).
const TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4, TF_SCRIPT = 8;

// K5 / UEB §9 (rueb-2024.txt §9.1.2's own "script does not need a transcriber-defined typeform"):
// a run's FONT NAME is the only signal .docx gives for "this text is set in a script/handwriting
// face" (there is no w:script toggle the way there is w:b/w:i/w:u). Conservative by design: only
// font names that themselves say script/handwriting/cursive/chancery/calligraphic (or the small
// set of very well-known named faces below, none of which say so directly) match — a body font
// that merely LOOKS a bit stylised is left alone, and Comic Sans (casual but not a script face) is
// deliberately excluded, matching Emboss/docs/transcription-policy.md's own "only if a reasonably
// clear signal exists" rule for reader-detected typeforms. `\b` boundaries avoid the classic
// substring trap ("description" contains "script").
// Exported so doc.mjs's legacy .doc reader (which reaches this module as `parseMod`) can
// apply the identical rule to a run's font-table name instead of keeping its own copy.
export const SCRIPT_FONT_RE = /\b(script|handwriting|chancery|calligraph|cursive|corsiva|vivaldi|mistral)\b/i;

// Bug 2 (Emboss/docs/real-book-validation-24sep.md): a listed table with no <thead>/<th>
// heading row still needs the print's column headings when the FIRST row is the heading
// row in print — bold text in <td> cells, no <th> at all (e.g. "Word | Definition |
// Related Forms"). BANA 11.16.1d-e: the column heading is the print heading. A first row
// is promoted only when EVERY non-empty cell is wholly bold (no plain-text segment); a
// first row with any plain text stays a data row, so a genuinely header-less table is
// unaffected. Shared by parseHtml's inline table branch and parseDtbook's parseTable.
function firstRowIsBoldHeader(cellValues) {
  let sawText = false;
  for (const v of cellValues) {
    for (const s of cellSegments(v)) {
      if (s.type !== 'text' || !s.text || !s.text.trim()) continue;
      sawText = true;
      if (!((s.tf || 0) & TF_BOLD)) return false;
    }
  }
  return sawText;
}
// K5: the run's own direct w:rFonts (ascii, falling back to hAnsi/cs for a run whose ascii
// range is unset) — deliberately DIRECT-ONLY, not resolved through the character/paragraph
// style chain the way bold/italic/underline are: "a run font" (the brief's own wording) is
// something a writer picks for specific text via the font-name box, not a style property
// documents commonly inherit a script face from, and staying direct-only avoids ever reading
// a whole style-based document (e.g. one themed in a stylised body font) as "all script".
function runFontName(r, W) {
  const rPr = firstChildNS(r, W, 'rPr');
  const rf = rPr ? firstChildNS(rPr, W, 'rFonts') : null;
  if (!rf) return null;
  return rf.getAttributeNS(W, 'ascii') || rf.getAttributeNS(W, 'hAnsi') || rf.getAttributeNS(W, 'cs') || null;
}

// A run's emphasis (bold/italic/underline/script) from w:rPr → liblouis typeform bits, so the
// formatter emits real UEB emphasis indicators. A toggle element with no val (or val
// "true"/"1") is on; val "false"/"0"/"none" is off. Script (K5) is not a toggle: it is read
// from the run's own font name (runFontName/SCRIPT_FONT_RE above), UEB §9.1.2/9.2.
// `runText` (optional, the caller's already-read getRunText result): needed only for LINK-2's
// own style-inferred underline, below — a whitespace-only run never receives it (see that
// comment for why).
function runEmphasis(r, W, charStyles = null, runText = null) {
  const rPr = firstChildNS(r, W, 'rPr');
  const font = runFontName(r, W);
  const scriptBit = font && SCRIPT_FONT_RE.test(font) ? TF_SCRIPT : 0;
  if (!rPr) return scriptBit;
  // A direct toggle wins (including an explicit "off"); otherwise fall back to the run's
  // character style (rStyle) if the caller supplied styles.xml's character styles.
  const direct = (ln) => { const e = firstChildNS(rPr, W, ln); if (!e) return null; const v = e.getAttributeNS(W, 'val'); return v == null || (v !== 'false' && v !== '0' && v !== 'none'); };
  let styled = null;
  if (charStyles && charStyles.size) {
    const rs = firstChildNS(rPr, W, 'rStyle');
    if (rs) styled = charStyleEmphasis(rs.getAttributeNS(W, 'val'), charStyles, nearestParagraphStyleId(r, W));
  }
  const eff = (ln, bit) => { const d = direct(ln); return d === null ? !!(styled && styled.tf & bit) : d; };
  let tf = scriptBit;
  if (eff('b', TF_BOLD)) tf |= TF_BOLD;
  if (eff('i', TF_ITALIC)) tf |= TF_ITALIC;
  if (eff('u', TF_UNDERLINE)) tf |= TF_UNDERLINE;
  // LINK-2: charStyleEmphasis (styled, above) deliberately skips the Hyperlink/
  // FollowedHyperlink character style's own formatting entirely — but its underline
  // specifically means "print showed this link underlined" (KD, round-2 Q1), so read it
  // here, same direct-wins precedence (a run's own w:u, checked first via `eff`/`direct`
  // above, always wins over the style). Real-corpus fallout (statutory-guidance-probation-
  // roles.docx): a hyperlinked cross-reference's own trailing/leading whitespace run shares
  // the SAME rStyle="Hyperlink", so without the `runText.trim()` guard this bit would also
  // land on a run that is nothing but spaces — which then wrongly tripped the UNRELATED
  // §10.6.1 "underlined run of nothing but spaces = a print fill-in-the-blank line" rule
  // (processRun, below) for ordinary link spacing that was never meant as one. A run with
  // real, non-blank text keeps the style-inferred underline as before; whitespace never gets
  // it from the STYLE (an explicit direct w:u on a blank run, `eff('u', ...)` above, is
  // unaffected — that IS the deliberate §10.6.1 signal).
  if (!(tf & TF_UNDERLINE) && direct('u') === null && charStyles && charStyles.size && (runText == null || runText.trim())) {
    const rs = firstChildNS(rPr, W, 'rStyle');
    if (rs && charStyleLinkUnderline(rs.getAttributeNS(W, 'val'), charStyles)) tf |= TF_UNDERLINE;
  }
  return tf;
}

// Real-file gap (23 Sep import sort): a run styled with a CHARACTER style that itself sets
// bold/italic/underline (Word's own "Strong"/"Emphasis", or an organisation's custom
// "KeyTerm" style) had no direct w:b/w:i/w:u, so runEmphasis read it as plain text. Resolves
// the style's toggles up its w:basedOn chain (nearest style that sets one wins). Two
// deliberate exclusions, both confirmed against the real corpus: (1) Word's hyperlink
// character styles (Hyperlink / FollowedHyperlink carry an underline that only means "this
// is a link" — the link itself is modelled by href, so underlining it too would put an
// emphasis indicator in front of every URL — LINK-2 (Paul, 28 Sep 2026, KD round-2 Q1)
// revisits exactly this underline for a run inside a real hyperlink: see
// charStyleLinkUnderline/runEmphasis's own use of it, below, which reads that SAME excluded
// style's w:u separately, because for a link specifically it is meaningful — "print showed
// this link underlined"); (2) a style with a w:link partner (Word's auto-created "Heading 4
// Char" / "Notes Char" twin of a PARAGRAPH style: its bold is the paragraph style's own look,
// applied whole-paragraph, not an author's inline emphasis — e.g. the corpus's
// Heading4Char/FWKNotesChar). Whole-paragraph bold from a paragraph style is still NOT read
// (a heading is already a heading; a transcriber decides the rest).
// Import fix list #34 (probation-roles.docx): exclusion (2) is only right when the run sits in a paragraph OF the
// partner paragraph style (or one based on it) — there the twin's bold/italic is the paragraph's own look. The same
// "Heading 4 Char" style on words inside, say, a numbered-list paragraph is an author's deliberate inline bold italic
// (print shows it), and was being read as plain text. `paraStyleId` = the run's paragraph style id ('' = none); omitted
// (null) keeps the old rule (always skip a linked twin).
function linkedTwinIsParagraphLook(st, charStyles, paraStyleId) {
  if (!st.linked) return false;
  if (paraStyleId == null) return true;
  const link = String(st.linkId || '').toLowerCase();
  const paraStyles = charStyles && charStyles.paraStyles;
  if (!link || !paraStyles || !paraStyles.size) return true;
  let cur = String(paraStyleId).toLowerCase();
  const seen = new Set();
  while (cur && !seen.has(cur) && seen.size < 20) {
    if (cur === link) return true;
    seen.add(cur);
    cur = ((paraStyles.get(cur) || {}).basedOn || '').toLowerCase();
  }
  return false;
}
function charStyleEmphasis(id, charStyles, paraStyleId = null) {
  if (!id) return null;
  let cur = String(id).toLowerCase();
  const seen = new Set();
  const out = { b: null, i: null, u: null };
  let first = true;
  while (cur && !seen.has(cur) && seen.size < 20) {
    seen.add(cur);
    const st = charStyles.get(cur);
    if (!st) break;
    if (first && (linkedTwinIsParagraphLook(st, charStyles, paraStyleId) || /^(followed)?hyperlink$/i.test(st.id))) return null;
    first = false;
    if (/^(followed)?hyperlink$/i.test(st.id)) break;
    for (const k of ['b', 'i', 'u']) if (out[k] === null && st[k] !== null) out[k] = st[k];
    cur = (st.basedOn || '').toLowerCase();
  }
  const tf = (out.b ? TF_BOLD : 0) | (out.i ? TF_ITALIC : 0) | (out.u ? TF_UNDERLINE : 0);
  return tf ? { tf } : null;
}

// LINK-2 (Paul, 28 Sep 2026, KD round-2 Q1): unlike charStyleEmphasis just above (which
// treats a Hyperlink/FollowedHyperlink character style's own formatting as "this is a link",
// not emphasis, and skips it outright), a run styled with Hyperlink/FollowedHyperlink IS read
// for underline here — the real docx corpus confirms Word's built-in "Hyperlink" style's own
// <w:rPr> carries <w:u w:val="single"/> (Emboss/tests/real_samples/docx/*, word/styles.xml),
// matching what Word actually shows print-side (blue + underlined). KD (round-2 Q1): a link
// whose print is underlined takes UEB's own underline typeform indicator, not the
// transcriber-defined hyperlink one (format/document.mjs's groupSegments decides which, from
// this bit — see its `linkUnderline`). Same basedOn-chain walk as charStyleEmphasis, but
// stops at the first style that actually sets w:u (own rPr) rather than skipping Hyperlink
// outright; a w:link partner style (a paragraph style's auto-generated character twin, not a
// link at all) still answers nothing here, same as charStyleEmphasis.
function charStyleLinkUnderline(id, charStyles) {
  if (!id) return null;
  let cur = String(id).toLowerCase();
  const seen = new Set();
  while (cur && !seen.has(cur) && seen.size < 20) {
    seen.add(cur);
    const st = charStyles.get(cur);
    if (!st) break;
    if (st.linked) return null;
    if (st.u !== null) return !!st.u;
    cur = (st.basedOn || '').toLowerCase();
  }
  return null;
}

// docx-fix item 4: resolve a run's character style (rStyle) up its w:basedOn chain for
// w:caps/w:smallCaps, the same walk charStyleEmphasis (above) does for b/i/u — nearest
// style in the chain that sets the toggle wins; a hyperlink character style is skipped for
// the same reason charStyleEmphasis skips it (its formatting means "this is a link", not an
// author's own emphasis/caps choice).
function charStyleCapsSmallCaps(id, charStyles) {
  if (!id) return null;
  let cur = String(id).toLowerCase();
  const seen = new Set();
  const out = { caps: null, smallCaps: null };
  let first = true;
  while (cur && !seen.has(cur) && seen.size < 20) {
    seen.add(cur);
    const st = charStyles.get(cur);
    if (!st) break;
    if (first && (st.linked || /^(followed)?hyperlink$/i.test(st.id))) return null;
    first = false;
    if (/^(followed)?hyperlink$/i.test(st.id)) break;
    if (out.caps === null && st.caps !== null) out.caps = st.caps;
    if (out.smallCaps === null && st.smallCaps !== null) out.smallCaps = st.smallCaps;
    cur = (st.basedOn || '').toLowerCase();
  }
  return (out.caps || out.smallCaps) ? out : null;
}
// docx-fix item 4: a run's own w:caps/w:smallCaps (direct rPr wins), falling back to its
// rStyle chain via charStyleCapsSmallCaps above. `charStyles` is optional (null when the
// caller has none in scope) so this degrades to "direct rPr only", never throws.
// docx-parity item 3: still null after the character-style chain falls back further, to the
// run's PARAGRAPH style chain (paraStyleFlag, same `charStyles.paraStyles` bundle
// runScript/runVanish use) and finally styles.xml's own docDefaults — same precedence as
// vertAlign/vanish, below.
function runCapsSmallCaps(r, W, charStyles) {
  const rPr = firstChildNS(r, W, 'rPr');
  const direct = (ln) => { const e = rPr && firstChildNS(rPr, W, ln); if (!e) return null; const v = e.getAttributeNS(W, 'val'); return v == null || (v !== 'false' && v !== '0' && v !== 'none'); };
  let caps = direct('caps');
  let smallCaps = direct('smallCaps');
  if ((caps === null || smallCaps === null) && charStyles && charStyles.size && rPr) {
    const rs = firstChildNS(rPr, W, 'rStyle');
    if (rs) {
      const resolved = charStyleCapsSmallCaps(rs.getAttributeNS(W, 'val'), charStyles);
      if (caps === null) caps = !!(resolved && resolved.caps);
      if (smallCaps === null) smallCaps = !!(resolved && resolved.smallCaps);
    }
  }
  if (caps === null || smallCaps === null) {
    const paraStyles = charStyles && charStyles.paraStyles;
    if (paraStyles && paraStyles.size) {
      const styleId = nearestParagraphStyleId(r, W);
      if (caps === null) { const v = paraStyleFlag(styleId, paraStyles, 'caps'); if (v !== null) caps = v; }
      if (smallCaps === null) { const v = paraStyleFlag(styleId, paraStyles, 'smallCaps'); if (v !== null) smallCaps = v; }
    }
  }
  if (caps === null || smallCaps === null) {
    const docDefaults = charStyles && charStyles.docDefaults;
    if (docDefaults) {
      if (caps === null) caps = !!docDefaults.caps;
      if (smallCaps === null) smallCaps = !!docDefaults.smallCaps;
    }
  }
  return { caps: !!caps, smallCaps: !!smallCaps };
}

// Strikethrough wiring for the DOCX reader (w:strike/w:dstrike), direct rPr or via character
// style — same rStyle chain / hyperlink-skip rule runEmphasis/charStyleEmphasis already use.
// A run struck through either way sets transcriberTypeform:'strike' on its text segment (the
// SECOND transcriber-defined typeform slot — 'trans1' is now reserved for links/other use —
// see Emboss/tests/strikethrough.test.mjs) shared by the HTML/ODT/RTF/Markdown readers and
// the formatter/editor.
function charStyleStrike(id, charStyles) {
  if (!id) return null;
  let cur = String(id).toLowerCase();
  const seen = new Set();
  let first = true;
  while (cur && !seen.has(cur) && seen.size < 20) {
    seen.add(cur);
    const st = charStyles.get(cur);
    if (!st) break;
    if (first && (st.linked || /^(followed)?hyperlink$/i.test(st.id))) return null;
    first = false;
    if (/^(followed)?hyperlink$/i.test(st.id)) break;
    if (st.strike !== null || st.dstrike !== null) return !!(st.strike || st.dstrike);
    cur = (st.basedOn || '').toLowerCase();
  }
  return null;
}
// docx-parity item 3: same rStyle-chain/hyperlink-skip walk as charStyleCapsSmallCaps/
// charStyleStrike above, for w:vanish/w:specVanish (a CHARACTER style, e.g. an
// organisation's own "Internal" or "Redline" style, can hide text just as directly as
// w:rPr can) and w:vertAlign (a character style used purely to mark footnote-reference-style
// superscript/subscript text).
function charStyleVanish(id, charStyles) {
  if (!id) return null;
  let cur = String(id).toLowerCase();
  const seen = new Set();
  let first = true;
  while (cur && !seen.has(cur) && seen.size < 20) {
    seen.add(cur);
    const st = charStyles.get(cur);
    if (!st) break;
    if (first && (st.linked || /^(followed)?hyperlink$/i.test(st.id))) return null;
    first = false;
    if (/^(followed)?hyperlink$/i.test(st.id)) break;
    if (st.vanish !== null || st.specVanish !== null) return !!(st.vanish || st.specVanish);
    cur = (st.basedOn || '').toLowerCase();
  }
  return null;
}
function charStyleVertAlign(id, charStyles) {
  if (!id) return null;
  let cur = String(id).toLowerCase();
  const seen = new Set();
  let first = true;
  while (cur && !seen.has(cur) && seen.size < 20) {
    seen.add(cur);
    const st = charStyles.get(cur);
    if (!st) break;
    if (first && (st.linked || /^(followed)?hyperlink$/i.test(st.id))) return null;
    first = false;
    if (/^(followed)?hyperlink$/i.test(st.id)) break;
    if (st.vertAlign !== null && st.vertAlign !== undefined) return st.vertAlign;
    cur = (st.basedOn || '').toLowerCase();
  }
  return null;
}
// docx-parity item 3: falls further, when still unset after direct + character style, to the
// run's paragraph style chain and finally docDefaults — same precedence as runScript/
// runCapsSmallCaps/runVanish.
function runStrike(r, W, charStyles) {
  const rPr = firstChildNS(r, W, 'rPr');
  const direct = (ln) => { const e = rPr && firstChildNS(rPr, W, ln); if (!e) return null; const v = e.getAttributeNS(W, 'val'); return v == null || (v !== 'false' && v !== '0' && v !== 'none'); };
  const dStrike = direct('strike'), dDstrike = direct('dstrike');
  if (dStrike !== null || dDstrike !== null) return !!(dStrike || dDstrike);
  if (charStyles && charStyles.size && rPr) {
    const rs = firstChildNS(rPr, W, 'rStyle');
    if (rs) {
      const v = charStyleStrike(rs.getAttributeNS(W, 'val'), charStyles);
      if (v !== null) return v;
    }
  }
  const paraStyles = charStyles && charStyles.paraStyles;
  if (paraStyles && paraStyles.size) {
    const v = paraStyleFlag(nearestParagraphStyleId(r, W), paraStyles, 'strike');
    const vd = paraStyleFlag(nearestParagraphStyleId(r, W), paraStyles, 'dstrike');
    if (v || vd) return true;
  }
  const docDefaults = charStyles && charStyles.docDefaults;
  return !!(docDefaults && (docDefaults.strike || docDefaults.dstrike));
}

async function parseDocxCharStyles(arrayBuffer, W) {
  // docx-parity item 3: vanish/specVanish (tri-state, same tog() convention) and vertAlign
  // ('sub'/'sup'/null, mirroring runScript's own direct-rPr reading) added alongside the
  // existing toggles, so a CHARACTER style can hide text or mark it sub/superscript too —
  // see charStyleVanish/charStyleVertAlign and runVanish/runScript, above.
  const map = new Map();                                // id (lowercased) -> {id, basedOn, linked, b, i, u, caps, smallCaps, strike, dstrike, vanish, specVanish, vertAlign}
  let xml;
  try { xml = new TextDecoder().decode(await unzipEntry(arrayBuffer, 'word/styles.xml')); }
  catch { return map; }
  let doc; try { doc = parseXml(xml); } catch { return map; }
  for (const styleEl of doc.getElementsByTagNameNS(W, 'style')) {
    if (styleEl.getAttributeNS(W, 'type') !== 'character') continue;
    const id = styleEl.getAttributeNS(W, 'styleId') || '';
    if (!id) continue;
    const basedOn = firstChildNS(styleEl, W, 'basedOn')?.getAttributeNS(W, 'val') || '';
    const rPr = firstChildNS(styleEl, W, 'rPr');
    const tog = (ln) => { const e = rPr && firstChildNS(rPr, W, ln); if (!e) return null; const v = e.getAttributeNS(W, 'val'); return v == null || (v !== 'false' && v !== '0' && v !== 'none'); };
    const va = rPr && firstChildNS(rPr, W, 'vertAlign');
    const vaVal = va && (va.getAttributeNS(W, 'val') || '').toLowerCase();
    const vertAlign = vaVal === 'subscript' ? 'sub' : vaVal === 'superscript' ? 'sup' : null;
    map.set(id.toLowerCase(), {
      id, basedOn, linked: !!firstChildNS(styleEl, W, 'link'), linkId: firstChildNS(styleEl, W, 'link')?.getAttributeNS(W, 'val') || '', b: tog('b'), i: tog('i'), u: tog('u'),
      caps: tog('caps'), smallCaps: tog('smallCaps'), strike: tog('strike'), dstrike: tog('dstrike'),
      vanish: tog('vanish'), specVanish: tog('specVanish'), vertAlign, font: styleRFont(rPr),
    });
  }
  return map;
}
// A style's own run font (w:rPr/w:rFonts: ascii, else hAnsi) — used to tell a monospaced ("code") paragraph (import fix list, audit w10).
function styleRFont(rPr) {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const rf = rPr && firstChildNS(rPr, W, 'rFonts');
  if (!rf) return null;
  return rf.getAttributeNS(W, 'ascii') || rf.getAttributeNS(W, 'hAnsi') || null;
}
// Monospaced ("typewriter") faces: a paragraph set wholly in one of these is a code/computer-text paragraph.
const MONO_FONT_RE = /^(courier|consolas|menlo|monaco|lucida console|lucida sans typewriter|andale mono|source code|fira (code|mono)|dejavu sans mono|liberation mono|cascadia|roboto mono|ubuntu mono|sf mono|monospace|inconsolata|anonymous pro|droid sans mono|noto (sans )?mono)|\bmono\b|typewriter/i;
// Is every non-blank run of `p` set in a monospaced font? Font = the run's own w:rFonts, else its character style's (via
// basedOn), else its paragraph style's (via basedOn). A paragraph with no text at all is not.
function paragraphIsMonospaced(p, W, charStyles) {
  let any = false;
  for (const r of p.getElementsByTagNameNS(W, 'r')) {
    if (isInsideTxbxContent(r, p, W) || isInsideMoveFrom(r, p, W) || isInsideRuby(r, p, W) || isInsideRejectedMcBranch(r, p) || isInsideUnfilledSdt(r, p, W)) continue;
    if (!getRunText(r, W).trim()) continue;
    if (runVanish(r, W, charStyles)) continue;
    let font = styleRFont(firstChildNS(r, W, 'rPr'));
    if (!font && charStyles && charStyles.size) {
      const rs = firstChildNS(r, W, 'rPr') && firstChildNS(firstChildNS(r, W, 'rPr'), W, 'rStyle');
      let cur = rs ? String(rs.getAttributeNS(W, 'val') || '').toLowerCase() : '';
      const seen = new Set();
      while (cur && !font && !seen.has(cur) && seen.size < 20) { seen.add(cur); const st = charStyles.get(cur); if (!st) break; font = st.font || null; cur = (st.basedOn || '').toLowerCase(); }
    }
    if (!font && charStyles && charStyles.paraStyles && charStyles.paraStyles.size) font = paraStyleFlag(nearestParagraphStyleId(r, W), charStyles.paraStyles, 'font');
    if (!font || !MONO_FONT_RE.test(String(font).trim())) return false;
    any = true;
  }
  return any;
}
// Does any visible run of `p` sit raised or lowered (sub/superscript)?
function paragraphHasScript(p, W, charStyles) {
  for (const r of p.getElementsByTagNameNS(W, 'r')) {
    if (isInsideTxbxContent(r, p, W) || isInsideMoveFrom(r, p, W) || isInsideRuby(r, p, W) || isInsideRejectedMcBranch(r, p) || isInsideUnfilledSdt(r, p, W)) continue;
    if (!getRunText(r, W).trim() || runVanish(r, W, charStyles)) continue;
    if (runScript(r, W, charStyles)) return true;
  }
  return false;
}
// The text of a code paragraph with its layout kept (indentation, Shift+Enter line breaks as new lines, tabs as spaces):
// the { type: 'code', text } block's lines, as the HTML reader's <pre> gives them.
function paragraphCodeText(p, W, charStyles) {
  let text = '';
  for (const r of p.getElementsByTagNameNS(W, 'r')) {
    if (isInsideTxbxContent(r, p, W) || isInsideMoveFrom(r, p, W) || isInsideRuby(r, p, W) || isInsideRejectedMcBranch(r, p) || isInsideUnfilledSdt(r, p, W)) continue;
    if (runVanish(r, W, charStyles)) continue;
    for (const child of r.childNodes || []) {
      if (child.nodeType !== 1 || child.namespaceURI !== W) continue;
      const ln = child.localName;
      if (ln === 't') text += symbolFontText(r, W, child.textContent);
      else if (ln === 'fldChar') text += docxFormFieldText(child, W) ?? '';   // #51
      else if (ln === 'tab') text += '    ';
      else if (ln === 'cr' || (ln === 'br' && (!child.getAttributeNS(W, 'type') || child.getAttributeNS(W, 'type') === 'textWrapping'))) text += '\n';
      else if (ln === 'noBreakHyphen') text += '-';
      else if (ln === 'sym') text += wordSymGlyph(child.getAttributeNS(W, 'font') || '', child.getAttributeNS(W, 'char') || '');
    }
  }
  return text.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
}

// A55: true if `node` sits inside a `<w:txbxContent>` somewhere between it and `stopAt`
// (exclusive of `stopAt` itself) — a floating text box's own body, walked separately and
// in place by parseDocx (see docxTxbxParagraphs), never as part of the paragraph its
// anchoring `<w:drawing>`/`<w:pict>` happens to sit in.
function isInsideTxbxContent(node, stopAt, W) {
  let n = node.parentNode;
  while (n && n !== stopAt) {
    if (n.namespaceURI === W && n.localName === 'txbxContent') return true;
    n = n.parentNode;
  }
  return false;
}

// docx-fix item 2: true if `node` sits inside a `<w:moveFrom>` somewhere between it and
// `stopAt` — tracked-change "moved away from here" content. Word stores a moveFrom run
// with an ordinary `<w:t>` (not `<w:delText>` the way `<w:del>` does), so the plain-text
// path (paragraphRunText's own deep `w:r` search, below) would otherwise read it as real
// text and, since the SAME text also appears at its destination inside `<w:moveTo>`,
// produce a visible duplicate. `<w:moveTo>` is deliberately NOT checked here: its text must
// appear (it's real, current content) and paragraphSegments' own walkNode already descends
// into it (see the `moveTo` case there) — this guard only ever needs to suppress moveFrom.
function isInsideMoveFrom(node, stopAt, W) {
  let n = node.parentNode;
  while (n && n !== stopAt) {
    if (n.namespaceURI === W && n.localName === 'moveFrom') return true;
    n = n.parentNode;
  }
  return false;
}

// docx-fix item 12: true if `node` sits inside a `<w:ruby>` somewhere between it and
// `stopAt`. A ruby run's OWN text comes from `<w:rubyBase>` only (getRunText, below, reads
// straight into rubyBase and ignores `<w:rt>`); this guard stops paragraphRunText's deep
// `w:r` search (which would otherwise independently re-visit the very `w:r` elements nested
// inside rubyBase/rt) from double-counting the base text or leaking the ruby annotation text.
function isInsideRuby(node, stopAt, W) {
  let n = node.parentNode;
  while (n && n !== stopAt) {
    if (n.namespaceURI === W && n.localName === 'ruby') return true;
    n = n.parentNode;
  }
  return false;
}

// docx-fix item 3: true if a run is hidden text (`w:rPr/w:vanish` or the rarer
// `w:specVanish`, used for a handful of Word-internal marks but honoured the same way) and
// must not be transcribed anywhere a run's text is read. A toggle with no `w:val` (or
// val "true"/"1") is on; "false"/"0"/"none" is off, same convention as runEmphasis's `direct`.
// Paragraph-MARK vanish (`w:pPr/w:rPr/w:vanish`) is deliberately NOT checked anywhere: per
// the OOXML spec it only hides the paragraph mark (pilcrow) Word shows when formatting marks
// are visible, never the paragraph's own run content — Emboss never renders a pilcrow, so
// there is nothing for it to affect, and treating it as "hide this whole paragraph" would be
// wrong.
// docx-parity item 3: direct formatting on the run still wins outright (a run with an
// explicit `<w:vanish w:val="false"/>` un-hides itself even inside a hidden style, exactly
// like every other toggle in this file); only when the run's OWN rPr has NEITHER vanish NOR
// specVanish at all does this fall back to the run's character style (charStyleVanish), then
// its paragraph style (paraStyleFlag against `charStyles.paraStyles`), then finally
// styles.xml's own docDefaults — same precedence/bundle as runScript/runCapsSmallCaps/
// runStrike, above.
function runVanish(r, W, charStyles = null) {
  const rPr = firstChildNS(r, W, 'rPr');
  const direct = (ln) => {
    const e = rPr && firstChildNS(rPr, W, ln);
    if (!e) return null;
    const v = e.getAttributeNS(W, 'val');
    return v == null || (v !== 'false' && v !== '0' && v !== 'none');
  };
  const dv = direct('vanish'), dsv = direct('specVanish');
  if (dv !== null || dsv !== null) return !!(dv || dsv);
  if (charStyles && charStyles.size && rPr) {
    const rs = firstChildNS(rPr, W, 'rStyle');
    if (rs) {
      const v = charStyleVanish(rs.getAttributeNS(W, 'val'), charStyles);
      if (v !== null) return v;
    }
  }
  const paraStyles = charStyles && charStyles.paraStyles;
  if (paraStyles && paraStyles.size) {
    const styleId = nearestParagraphStyleId(r, W);
    const v = paraStyleFlag(styleId, paraStyles, 'vanish');
    const vsv = paraStyleFlag(styleId, paraStyles, 'specVanish');
    if (v || vsv) return true;
  }
  const docDefaults = charStyles && charStyles.docDefaults;
  return !!(docDefaults && (docDefaults.vanish || docDefaults.specVanish));
}

// Import fix list #51: a legacy form field's value, from the w:ffData on its begin mark (a check box and a drop-down have no
// result text; Word draws them from here): a check box is "[x]" / "[ ]" (w:checked, else w:default), a drop-down its selected
// item (w:result, else w:default, else the first) — the forms the .doc reader (D15) and the HTML reader give. Else null.
function docxFormFieldText(fldChar, W) {
  if (!fldChar || fldChar.getAttributeNS(W, 'fldCharType') !== 'begin') return null;
  const ff = firstChildNS(fldChar, W, 'ffData');
  if (!ff) return null;
  const on = (el) => { if (!el) return null; const v = (el.getAttributeNS(W, 'val') || '').toLowerCase(); return v === '' || v === '1' || v === 'true' || v === 'on'; };
  const cb = firstChildNS(ff, W, 'checkBox');
  if (cb) { const checked = on(firstChildNS(cb, W, 'checked')); return (checked != null ? checked : !!on(firstChildNS(cb, W, 'default'))) ? '[x]' : '[ ]'; }
  const dd = firstChildNS(ff, W, 'ddList');
  if (dd) {
    const items = [...(dd.childNodes || [])].filter((c) => c.nodeType === 1 && c.localName === 'listEntry').map((c) => c.getAttributeNS(W, 'val') || '');
    const idxOf = (el) => (el ? parseInt(el.getAttributeNS(W, 'val') || '', 10) : NaN);
    let i = idxOf(firstChildNS(dd, W, 'result'));
    if (!Number.isInteger(i)) i = idxOf(firstChildNS(dd, W, 'default'));
    if (!Number.isInteger(i)) i = 0;
    return i >= 0 && i < items.length ? items[i] : '';
  }
  return null;
}

function getRunText(r, W) {
  let text = '';
  for (const child of r.childNodes || []) {
    if (child.nodeType === 1 && child.namespaceURI === W) {
      if (child.localName === 't') text += symbolFontText(r, W, child.textContent);
      else if (child.localName === 'fldChar') text += docxFormFieldText(child, W) ?? '';   // #51
      else if (child.localName === 'br' && DOCX_KEEP_LINE_BREAKS && (!child.getAttributeNS(W, 'type') || child.getAttributeNS(W, 'type') === 'textWrapping')) text += '\n';   // IMP-W2
      else if (child.localName === 'tab' || child.localName === 'br' || child.localName === 'cr') text += ' ';
      else if (child.localName === 'noBreakHyphen') text += '-';
      // docx-fix item 12: <w:ruby><w:rubyPr/><w:rt>…</w:rt><w:rubyBase>…</w:rubyBase></w:ruby>
      // sits as a run-level child of THIS <w:r> (schema-wise an alternative to a plain <w:t>).
      // Keep only rubyBase's own run text (isInsideRuby, above, keeps the deep w:r search
      // from re-reading these same nested runs a second time); w:rt (the ruby annotation,
      // e.g. a kanji's kana reading) is never wanted in braille and is simply skipped.
      // IMP-W11 (Paul, 30 Sep 2026): the guide follows its base text, in brackets ("漢字 (かんじ)").
      else if (child.localName === 'ruby') {
        const base = firstChildNS(child, W, 'rubyBase');
        if (base) for (const br of base.getElementsByTagNameNS(W, 'r')) text += getRunText(br, W);
        const rt = firstChildNS(child, W, 'rt');
        let guide = '';
        if (rt) for (const gr of rt.getElementsByTagNameNS(W, 'r')) guide += getRunText(gr, W);
        if (guide.trim()) text += ` (${guide.trim()})`;
      }
      // docx-fix item 5: <w:sym w:font="Wingdings" w:char="F0E0"/> — a symbol-font glyph
      // (Wingdings/Webdings/Symbol/…), never a <w:t>, so it silently vanished before.
      else if (child.localName === 'sym') {
        text += wordSymGlyph(child.getAttributeNS(W, 'font') || '', child.getAttributeNS(W, 'char') || '');
      }
    }
  }
  return text;
}

// Legacy Equation Editor 3.0 / MathType OLE equation, embedded the pre-OOXML-math way as
// `<w:object>` inside a run: `<w:object><v:shapetype/><v:shape><v:imagedata r:id="…"/>
// </v:shape><o:OLEObject ProgID="Equation.3"/></w:object>` (MathType writes ProgID
// "Equation.DSMT4"/"Equation.DSMT..."). getRunText (above) only understands w:t/tab/br/cr/
// noBreakHyphen, so a run holding nothing but one of these returns '' and the whole run
// silently vanishes from the model — not just the equation, the run itself, so no trace of
// it survives (docxParagraphImages, above/below, also never looks for `w:object`: it only
// finds a picture via `w:drawing` or the legacy-VML `w:pict`/`v:imagedata`, a different
// element). The equation's own content is genuinely unrecoverable here: `v:imagedata`
// points at a preview image that is EMF/WMF (a vector metafile a browser can't display,
// unlike the PNG/JPEG/GIF a real picture uses) and the actual equation lives in the
// `o:OLEObject`'s binary OLE stream (`word/embeddings/oleObject*.bin`), an old binary
// format this parser doesn't implement. Detected here purely so the caller can drop in a
// placeholder instead of losing the run without a trace — see LEGACY_EQUATION_PLACEHOLDER.
// A non-equation OLE object (an embedded spreadsheet, a Visio drawing, ...) has some other
// ProgID: docx-fix item 8 (docxNonEquationOleProgId, below) now gives it its OWN placeholder
// in processRun, in a separate branch next to the equation one here — it is a different kind
// of embed (a whole other document/file, not an unrenderable formula) and gets its own
// generic wording plus the ProgID's friendly name, not the equation placeholder.
const LEGACY_EQUATION_PROGID_RE = /^equation(\.\d+|\.dsmt\d*)?$/i;
// PROVISIONAL wording (Emboss-authored placeholder text, like other Emboss-generated
// wording elsewhere in this file) — open question for Paul if he wants different phrasing.
const LEGACY_EQUATION_PLACEHOLDER = 'equation not transcribed';
// docx-fix item 7 / BANA §10.6.1: "If print uses empty space to show an omission, substitute
// three dot 5s [and insert a transcriber's note explaining the change from print]." `{type:
// 'brl'}`'s own `brl` field is literal ASCII braille (bypasses translate() entirely, same as
// the table-guide-dot convention elsewhere in this codebase) — '"' is dot 5 alone, matching
// §10.6.1's own worked example (braille-formats-2016.txt, Example 10-13: `""" o'clock`).
const BANA_BLANK_LINE_DOTS5 = '"""';
// PROVISIONAL wording (as LEGACY_EQUATION_PLACEHOLDER above) — open question for Paul; phrased
// like the existing guide-dot transcriber's notes (STAIRSTEP_BLANK_TN/LISTED_BLANK_TN in
// format/document.mjs) rather than inventing a new style of note wording.
const BANA_BLANK_LINE_TN = 'A series of three guide dots indicates a blank to be filled in, shown in print as empty space.';
function docxLegacyEquationProgId(r) {
  if (!r || !r.getElementsByTagNameNS) return null;
  for (const ole of r.getElementsByTagNameNS('*', 'OLEObject')) {
    const progId = (ole.getAttribute && ole.getAttribute('ProgID')) || '';
    if (LEGACY_EQUATION_PROGID_RE.test(progId.trim())) return progId;
  }
  return null;
}

// Old-style equations are now READ (mtef.mjs: OLE compound file -> "Equation Native" ->
// MTEF -> MathML), not just flagged: the placeholder above is kept only for an equation
// that cannot be read. paragraphSegments is synchronous, so every OLE object under
// word/embeddings/ is converted once, up front, into legacyEq.ole (zip path, lower-cased ->
// { mathml } | { error }); the run then looks its own object up through its o:OLEObject's
// r:id and the part's relationships.
async function readDocxOleEquations(arrayBuffer) {
  const out = new Map();
  let entries;
  try { entries = listZipEntries(arrayBuffer); } catch { return out; }
  for (const e of entries) {
    if (!/^word\/embeddings\/[^/]+\.bin$/i.test(e.name) || e.compSize > 4 * 1024 * 1024) continue;
    try { out.set(e.name.toLowerCase(), readOleEquation(await extractZipEntry(arrayBuffer, e))); }
    catch (err) { out.set(e.name.toLowerCase(), { error: String((err && err.message) || err) }); }
  }
  return out;
}
const DOCX_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
// The MathML of the legacy equation in run `r`, or null when it cannot be read.
function docxLegacyEquationMathml(r, rels, legacyEq) {
  if (!legacyEq || !legacyEq.ole || !rels) return null;
  for (const ole of r.getElementsByTagNameNS('*', 'OLEObject')) {
    if (!LEGACY_EQUATION_PROGID_RE.test(((ole.getAttribute && ole.getAttribute('ProgID')) || '').trim())) continue;
    const rid = (ole.getAttributeNS && ole.getAttributeNS(DOCX_REL_NS, 'id')) || ole.getAttribute('r:id');
    const target = rid && rels.get(rid);
    if (!target) return null;
    const path = (target.startsWith('/') ? normalizeHref(target) : resolveZipPath('word', target)).toLowerCase();
    const hit = legacyEq.ole.get(path);
    return hit && hit.mathml ? hit.mathml : null;
  }
  return null;
}

// docx-fix item 8: a non-equation embedded OLE object — Excel.Sheet/Word.Document/
// PowerPoint.Show/Visio.Drawing/a generic "Package" (Object > "Create from file" often
// writes plain "Package") — same underlying `<w:object>`/`<o:OLEObject>` shape as the legacy
// equation above, but a genuinely different kind of thing (a whole other embedded
// file/document, not an unrenderable formula) and never previously given any placeholder at
// all (the run just silently vanished, same as the equation case used to). Kept as a
// SEPARATE small function/branch from the equation one throughout, per this task's brief.
function docxNonEquationOleProgId(r) {
  if (!r || !r.getElementsByTagNameNS) return null;
  for (const ole of r.getElementsByTagNameNS('*', 'OLEObject')) {
    const progId = ((ole.getAttribute && ole.getAttribute('ProgID')) || '').trim();
    if (!progId || LEGACY_EQUATION_PROGID_RE.test(progId)) continue;   // no ProgID, or an equation (handled above)
    return progId;
  }
  return null;
}
// Friendly names for the ProgIDs real documents actually embed. Matched by prefix (a version
// suffix like ".12" or ".8" varies by Office version). Anything unrecognised still gets a
// placeholder — just with the generic label rather than a wrong guess.
const OLE_FRIENDLY_NAME_RULES = [
  [/^excel\.sheet/i, 'Excel spreadsheet'],
  [/^word\.document/i, 'Word document'],
  [/^powerpoint\.(show|slide)/i, 'PowerPoint presentation'],
  [/^visio\.drawing/i, 'Visio drawing'],
  [/^acroexch\./i, 'PDF document'],
  [/^mspublisher/i, 'Publisher document'],
  [/^msprojectdocument/i, 'Project file'],
  // docx-parity item 5: the old Microsoft Graph chart applet (MSGraph.Chart* — Word 97-2003's
  // "Insert > Chart", the ProgID it always wrote) and an embedded Excel chart sheet
  // (Excel.Chart* — as distinct from Excel.Sheet*, an embedded chart rather than a
  // worksheet) both read to a reader as "a chart", same friendly name doc.mjs's own copy of
  // this table now also uses.
  [/^msgraph\.chart/i, 'chart'],
  [/^excel\.chart/i, 'chart'],
  [/^package$/i, 'embedded file'],
];
function oleFriendlyName(progId) {
  for (const [re, name] of OLE_FRIENDLY_NAME_RULES) if (re.test(progId)) return name;
  return 'embedded object';
}
// PROVISIONAL wording (as LEGACY_EQUATION_PLACEHOLDER above) — open question for Paul.
function oleNotTranscribedPlaceholder(progId) {
  return `embedded object not transcribed (${oleFriendlyName(progId)})`;
}

// Concatenate a paragraph's run text, bracketing subscript/superscript runs with
// the script markers the formatter's translate step turns into UEB level
// indicators (so e.g. the "2" of CO2 gets the ";5" subscript sign). Adjacent
// runs of the same alignment share one marker pair.
function paragraphRunText(p, W, charStyles = null) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  let text = '';
  let cur = null;                                         // baseline | 'sub' | 'sup'
  for (const r of p.getElementsByTagNameNS(W, 'r')) {
    // A55: getElementsByTagNameNS is a DEEP search — without this guard, a <w:r> that
    // actually lives inside a floating text box's own <w:txbxContent> (nested many levels
    // down inside this paragraph's <w:drawing>/<w:pict>) would get flattened into THIS
    // paragraph's plain text, unstyled and duplicated (Word usually stores the same box
    // twice — DrawingML in mc:Choice, VML in mc:Fallback — so a naive deep walk picks up
    // both copies). The text box's own paragraphs are walked separately, in place, by
    // docxTxbxParagraphs/pushDocxTxbxParagraph below — this paragraph's own text must stay
    // exactly what it would be with no text box attached at all.
    if (isInsideTxbxContent(r, p, W)) continue;
    // docx-fix item 2: same DEEP-search problem for <w:moveFrom> — its runs use a real
    // <w:t> (not <w:delText>), so without this they read as ordinary text and duplicate
    // the same words already present (correctly) at the <w:moveTo> destination.
    if (isInsideMoveFrom(r, p, W)) continue;
    // docx-fix item 12: skip the runs nested inside a <w:ruby>'s own rubyBase/rt — getRunText
    // on the OUTER run (the one that directly wraps <w:ruby>) already reads rubyBase's text.
    if (isInsideRuby(r, p, W)) continue;
    // Import fix list #15d / #2: only ONE branch of an mc:AlternateContent is read, and the prompt of an unfilled
    // content control is not text (same guards as paragraphSegments' walk).
    if (isInsideRejectedMcBranch(r, p) || isInsideUnfilledSdt(r, p, W)) continue;
    // docx-fix item 3: hidden text (w:vanish/w:specVanish) is never transcribed.
    if (runVanish(r, W, charStyles)) continue;
    let runText = getRunText(r, W);
    if (!runText) continue;
    // docx-fix item 4 / RUEB 9.6.1: w:caps (display all-caps) AND w:smallCaps (per Paul's
    // decision, following RUEB 9.6.1 "[text in small capitals] is best transcribed as
    // capitals" — 9.6.2's optional transcriber-defined typeform for emphatic small caps is
    // left to transcribers, not applied automatically) both upper-case the run's print text
    // so braille follows what a sighted reader sees. Direct run rPr wins; failing that, the
    // run's character style (rStyle), resolved up its w:basedOn chain, same precedence
    // runEmphasis/charStyleEmphasis already use for bold/italic/underline.
    const capsInfo = runCapsSmallCaps(r, W, charStyles);
    if (capsInfo.caps || capsInfo.smallCaps) runText = runText.toUpperCase();
    // A raised or lowered run of spaces only (Word raises the space before a footnote number) marks nothing (30 Sep).
    const script = /\S/.test(runText) ? runScript(r, W, charStyles) : cur;
    if (script !== cur) {
      if (cur) text += end;
      if (script) text += script === 'sub' ? subOpen : supOpen;
      cur = script;
    }
    text += runText;
  }
  if (cur) text += end;
  return text;
}

// Walk a paragraph's direct children in document order, building a segments
// array that interleaves run text (w:r, with sub/superscript markers exactly
// as paragraphRunText) and inline equations (m:oMath, a sibling of w:r inside
// w:p). Text is accumulated and flushed as one 'text' segment whenever a math
// element is hit (or at the end), so adjacent runs still collapse into a
// single segment the same way paragraphRunText collapses them into one string.
// A46/D4: `rels` (parseDocxRelationships's Id -> Target map) and `R` (the relationships
// namespace URI) let a `w:hyperlink`'s `r:id` resolve to a real URL, stamped onto the
// text segment(s) its runs produced — same shape/contract as walkInline's <a href>
// handling for DTBook (nimas-export's serializeInlineSegments re-wraps a contiguous
// href-sharing run in one <a href="…">). An internal bookmark hyperlink (`w:anchor`,
// no `r:id`) or a missing rels part resolves to no href, leaving the run's text exactly
// as before this fix.
// A45/D3: a run holding `<w:footnoteReference w:id="N"/>` (or `w:endnoteReference`) has
// no `w:t` of its own — Word draws the visible mark (superscript "1", "2"…) purely from
// note order, never stores it in the XML — so `getRunText` returns '' for it and the
// reference silently vanished. `noteMarks` (shared across every call for one document, so
// numbering stays sequential across paragraphs) assigns each first-seen w:id the next
// number and produces the same `{type:'noteref', text, idref}` shape parseDtbook's own
// walkInline builds for a DTBook <noteref> — the exporter re-wraps it as <noteref
// idref="…">, and parseDocx's caller (below) uses the same idref to place the matching
// <note> block right after the paragraph that referenced it.
// F4-04: the run character styles the DOCX writer (web/docx-export.mjs) uses for inline
// text that Word has no native form for: a print line/reference number and uncontracted text.
const EMBOSS_RUN_FLAGS = { embosslinenumber: 'linenum', embossuncontracted: 'uncontracted' };
function runEmbossFlag(r, W) {
  const rPr = firstChildNS(r, W, 'rPr');
  const rs = rPr ? firstChildNS(rPr, W, 'rStyle') : null;
  return rs ? (EMBOSS_RUN_FLAGS[String(rs.getAttributeNS(W, 'val') || '').toLowerCase()] || null) : null;
}

// Math segments read from an m:oMathPara inside a w:p (paragraphSegments): display equations.
const DOCX_DISPLAY_MATH_SEGS = new WeakSet();
function paragraphSegments(p, W, rels = null, R = null, noteMarks = null, charStyles = null, legacyEq = null) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  const segments = [];
  let text = '';
  let cur = null;                                          // baseline | 'sub' | 'sup'
  let curTf = 0;                                           // emphasis of the accumulating run (bold/italic/underline)
  let curFlag = null;                                      // F4-04: Emboss character style ('linenum' | 'uncontracted') of the accumulating run
  let curStrike = false;                                   // docx w:strike/w:dstrike -> transcriberTypeform 'strike' (strikethrough agent's convention)
  let curLang = null;                                      // foreign language of the accumulating run (w:lang; input/lang.mjs — recorded only, braille unchanged)
  // docx-fix item 6: set right after a footnote/endnote reference with
  // w:customMarkFollows="1" — Word's own convention is that the VERY NEXT run holds the
  // visible reference mark (an asterisk, dagger, …), not auto-numbered and never ALSO body
  // text. Consumed once, by whichever run comes right after (see processRun, below).
  let pendingCustomMarkSeg = null;
  const flushText = () => {
    if (cur) { text += end; cur = null; }
    if (text) {
      if (curFlag === 'linenum') segments.push({ type: 'linenum', text });
      else {
        const seg = curTf ? { type: 'text', text, tf: curTf } : { type: 'text', text };
        if (curFlag === 'uncontracted') seg.uncontracted = true;
        if (curStrike) seg.transcriberTypeform = 'strike';
        if (curLang) seg.lang = curLang;
        segments.push(seg);
      }
    }
    text = '';
  };
  const noteRefEl = (r) => {
    if (!r.getElementsByTagNameNS) return null;
    const fn = r.getElementsByTagNameNS(W, 'footnoteReference')[0];
    if (fn) return { el: fn, isEndnote: false };
    const en = r.getElementsByTagNameNS(W, 'endnoteReference')[0];
    if (en) return { el: en, isEndnote: true };
    return null;
  };
  const processRun = (r) => {
    // docx-fix item 3: hidden text (w:vanish/w:specVanish) is never transcribed, in any
    // segment form (plain text, note reference, equation placeholder — none of it).
    if (runVanish(r, W, charStyles)) return;
    const noteRef = noteMarks && noteRefEl(r);
    if (noteRef) {
      const wid = noteRef.el.getAttributeNS(W, 'id');
      if (wid != null && wid !== '') {
        flushText();
        // docx-fix item 6: w:customMarkFollows="1" — Word shows this reference's own
        // hand-picked mark (the next run's text — set below, outside this branch), never an
        // auto-incremented number. `w:footnotePr/w:endnotePr`'s own numFmt (sectPr/settings.xml
        // — see parseDocx's noteMarks.fnFmt/enFmt) governs the AUTO-numbered case.
        const isCustom = noteRef.el.getAttributeNS(W, 'customMarkFollows') === '1';
        const marks = noteRef.isEndnote ? noteMarks.enMarks : noteMarks.fnMarks;
        const firstTime = !marks.has(wid);
        if (firstTime) {
          if (isCustom) marks.set(wid, '');                // filled in from the very next run, below
          else {
            const n = noteRef.isEndnote ? ++noteMarks.en : ++noteMarks.fn;
            marks.set(wid, formatNoteNum(n, noteRef.isEndnote ? noteMarks.enFmt : noteMarks.fnFmt));
          }
        }
        const seg = { type: 'noteref', text: marks.get(wid), idref: (noteRef.isEndnote ? 'docx-en-' : 'docx-fn-') + wid };
        segments.push(seg);
        if (isCustom && noteMarks.customIds) noteMarks.customIds.add(seg.idref);   // S5D-Q4: this note's own text repeats the mark (collectNoteBlocks drops it there)
        if (isCustom && firstTime) pendingCustomMarkSeg = { seg, marks, wid };
      }
      return;                                              // a note-reference run carries nothing else
    }
    if (pendingCustomMarkSeg) {
      // docx-fix item 6: this run IS the customMarkFollows mark (Word's own convention —
      // see the noteRef branch above) — its text becomes the noteref's own displayed mark,
      // consumed here so it is never ALSO pushed as ordinary body text right after the
      // reference (the duplicate "* continues." bug this fixes).
      const markRunText = getRunText(r, W).trim();
      if (markRunText) { pendingCustomMarkSeg.seg.text = markRunText; pendingCustomMarkSeg.marks.set(pendingCustomMarkSeg.wid, markRunText); }
      pendingCustomMarkSeg = null;
      return;
    }
    // Legacy Equation Editor 3.0 / MathType OLE equation (see docxLegacyEquationProgId,
    // above): keep a visible embedded transcriber's note right where it sat, exactly the
    // shape BANA §10.11.1's embedded-picture-note convention already uses (F-229) — the
    // model has this inline note type already, so this reuses it rather than inventing a
    // new segment kind. `prodnote: true` + `render: 'required'` (matching the imggroup
    // alt-text convention just below, in docxParagraphImages) makes it export as a real
    // `<prodnote render="required">` on NIMAS save (nimas-export.mjs's serializeInlineLeaf),
    // which parseDtbook already reads straight back into the same segment shape on reopen
    // (see the `tag === 'prodnote' && elTag === 'p'` case above) — no new round-trip code
    // needed either way.
    if (docxLegacyEquationProgId(r)) {
      flushText(); curTf = 0; curFlag = null; curStrike = false;
      // Readable (the usual case): exactly the segment an inline m:oMath produces (walkNode,
      // below), so the editor, NIMAS export and braille treat it as a modern equation.
      const mathml = docxLegacyEquationMathml(r, rels, legacyEq);
      if (mathml) {
        const seg = { type: 'math', mathml };
        const latex = mathmlToLatex(mathml);
        if (latex) seg.latex = latex;
        segments.push(seg);
        if (legacyEq) (legacyEq.readSegs || (legacyEq.readSegs = new Set())).add(seg);
        return;
      }
      segments.push({ type: 'imgnote', text: LEGACY_EQUATION_PLACEHOLDER, prodnote: true, render: 'required' });
      if (legacyEq) legacyEq.count++;
      return;
    }
    // docx-fix item 8: a non-equation embedded OLE object — SEPARATE branch from the
    // equation one just above (see docxNonEquationOleProgId), same placeholder mechanism.
    const oleProgId = docxNonEquationOleProgId(r);
    if (oleProgId) {
      flushText(); curTf = 0; curFlag = null; curStrike = false;
      segments.push({ type: 'imgnote', text: oleNotTranscribedPlaceholder(oleProgId), prodnote: true, render: 'required' });
      if (legacyEq) legacyEq.oleCount = (legacyEq.oleCount || 0) + 1;
      return;
    }
    let runText = getRunText(r, W);
    if (!runText) return;
    // docx-fix item 4 / RUEB 9.6.1: see paragraphRunText's matching comment above — w:caps
    // and w:smallCaps both upper-case the run's text.
    const capsInfo = runCapsSmallCaps(r, W, charStyles);
    if (capsInfo.caps || capsInfo.smallCaps) runText = runText.toUpperCase();
    const tf = runEmphasis(r, W, charStyles, runText);
    // docx-fix item 7 / BANA §10.6.1: an underlined run of NOTHING but spaces (or an
    // underlined w:tab, which getRunText already turns into a single space) is Word's own
    // "print uses empty space to show an omission" write-on-line convention: no underscore or
    // other visible character survives a plain print/braille read at all, so left as ordinary
    // whitespace it silently vanishes (a braille line never keeps trailing/collapsed blank
    // cells). §10.6.1's own literal fix: "substitute three dot 5s and insert a transcriber's
    // note explaining the change from print" — the note uses the same embedded inline-note
    // convention already used just above for other things print can't itself carry (the
    // legacy-equation/OLE-object placeholders).
    if ((tf & TF_UNDERLINE) && !runText.trim()) {
      flushText(); curTf = 0; curFlag = null; curStrike = false;
      segments.push({ type: 'brl', text: '', brl: BANA_BLANK_LINE_DOTS5 });
      segments.push({ type: 'imgnote', text: BANA_BLANK_LINE_TN, prodnote: true, render: 'required' });
      return;
    }
    const flag = runEmbossFlag(r, W);
    // Strikethrough (w:strike/w:dstrike, direct or via character style — same rStyle chain
    // runEmphasis/runCapsSmallCaps already resolve) -> transcriberTypeform 'strike', the
    // strikethrough agent's own segment-field convention (see Emboss/tests/strikethrough.test.mjs).
    const strike = runStrike(r, W, charStyles);
    const lang = docxRunLang(charStyles && charStyles.langCtx, r, p, W, runText);   // foreign language (input/lang.mjs)
    if (tf !== curTf || flag !== curFlag || strike !== curStrike || lang !== curLang) { flushText(); curTf = tf; curFlag = flag; curStrike = strike; curLang = lang; }
    // A raised or lowered run of spaces only (Word raises the space before a footnote number) marks nothing (30 Sep).
    const script = /\S/.test(runText) ? runScript(r, W, charStyles) : cur;
    if (script !== cur) {
      if (cur) text += end;
      if (script) text += script === 'sub' ? subOpen : supOpen;
      cur = script;
    }
    text += runText;
  };
  // A51: <w:sdt> as a run-level sibling inside a paragraph's own child sequence (the
  // inline form of a content control — schema-distinct from the block-level <w:sdt> the
  // body walk in parseDocx unwraps via flattenSdtChildren, above). Unwrapped here, at the
  // point its content would otherwise have appeared, by recursing into walkNode for each
  // of its <w:sdtContent>'s own children — so nested inline controls, and a run/hyperlink/
  // oMath inside one, are all processed exactly as if the wrapper weren't there. No
  // <w:sdtContent> (or an empty one) contributes nothing and never throws.
  const walkNode = (node) => {
    if (node.nodeType !== 1) return;
    if (node.namespaceURI === W && node.localName === 'sdt') {
      if (sdtShowsPlaceholder(node, W)) return;            // import fix list #2: an unfilled control's prompt is not text
      const sdtContent = [...node.children].find((c) => c.namespaceURI === W && c.localName === 'sdtContent');
      if (sdtContent) for (const child of sdtContent.childNodes || []) walkNode(child);
      return;
    }
    // Import fix list #15d: a run-level mc:AlternateContent — ONE branch (the understood Choice, else the Fallback).
    if (node.namespaceURI === MC_NS && node.localName === 'AlternateContent') {
      const branch = mcSelectedBranch(node);
      if (branch) for (const child of branch.childNodes || []) walkNode(child);
      return;
    }
    if (node.namespaceURI === MATH_NS && node.localName === 'oMath') {
      flushText(); curTf = 0; curFlag = null; curStrike = false;
      const mathml = ommlElementToMathML(node);
      const latex = mathmlToLatex(mathml);
      const seg = { type: 'math', mathml };
      if (latex) seg.latex = latex;
      segments.push(seg);
      return;
    }
    // A display equation inside the paragraph (<w:p><m:oMathPara><m:oMath>…) — how Word and
    // LibreOffice both write one: each of its equations, marked as display math (parseDocx
    // gives a paragraph holding nothing else the same `math` blocks a body-level m:oMathPara
    // gives). Was not walked at all, so the equation was silently dropped.
    if (node.namespaceURI === MATH_NS && node.localName === 'oMathPara') {
      for (const child of node.childNodes || []) {
        if (child.nodeType !== 1 || child.namespaceURI !== MATH_NS || child.localName !== 'oMath') continue;
        const before = segments.length;
        walkNode(child);
        for (let k = before; k < segments.length; k++) if (segments[k].type === 'math') DOCX_DISPLAY_MATH_SEGS.add(segments[k]);
      }
      return;
    }
    if (node.localName === 'hyperlink') {
      const rid = R && node.getAttributeNS ? node.getAttributeNS(R, 'id') : null;
      const href = (rid && rels && rels.get(rid)) || null;
      if (href) flushText();
      const before = segments.length;
      // Recurse through walkNode itself (was: a deep getElementsByTagNameNS(W,'r') scan
      // that only ever found w:r) so an oMath, a legacy-equation w:object, or a run wrapped
      // in w:ins/smartTag/fldSimple/customXml inside the hyperlink is handled exactly like
      // it would be outside one, instead of silently vanishing.
      for (const child of node.childNodes || []) walkNode(child);
      if (href) {
        flushText();
        for (let k = before; k < segments.length; k++) {
          if (segments[k] && segments[k].type === 'text') segments[k].href = href;
        }
      }
      return;
    }
    if (node.namespaceURI === W && node.localName === 'r') {
      processRun(node);
      return;
    }
    // Run-level wrappers Word puts around ordinary runs — a tracked insertion (w:ins /
    // w:moveTo), a smart tag, a simple field (w:fldSimple), a custom XML island: their runs
    // are real text (paragraphRunText already reads them), but this walk only looked at
    // direct w:r children, so a paragraph with any emphasis/link elsewhere lost that text
    // from its segments. Descend, exactly like the content-control case above. (w:del holds
    // w:delText, never w:t, so it contributes nothing either way.)
    if (node.namespaceURI === W && (node.localName === 'ins' || node.localName === 'moveTo' || node.localName === 'smartTag' || node.localName === 'fldSimple' || node.localName === 'customXml')) {
      for (const child of node.childNodes || []) walkNode(child);
    }
  };
  for (const node of p.childNodes || []) walkNode(node);
  flushText();
  return segments;
}

// The browser's native DOMParser does NOT throw on malformed XML — it returns a
// document whose root (or a child) is a <parsererror>. Left unchecked, the callers
// below would fall back to that error node and silently produce an empty/garbage
// document with no error shown to the user. Detect it and throw so the caller's
// try/catch surfaces a real "could not read that file". (@xmldom, used in the Node
// tests, throws directly — so this path is browser-only.)
const COMMON_HTML_ENTITIES = {
  nbsp: '&#160;', mdash: '&#8212;', ndash: '&#8211;', hellip: '&#8230;',
  lsquo: '&#8216;', rsquo: '&#8217;', ldquo: '&#8220;', rdquo: '&#8221;',
  copy: '&#169;', reg: '&#174;', trade: '&#8482;', bull: '&#8226;',
  deg: '&#176;', plusmn: '&#177;', times: '&#215;', divide: '&#247;',
  micro: '&#181;', para: '&#182;', middot: '&#183;', frac12: '&#189;',
  frac14: '&#188;', frac34: '&#190;', euro: '&#8364;', pound: '&#163;',
  yen: '&#165;', cent: '&#162;', sect: '&#167;', laquo: '&#171;', raquo: '&#187;',
  aacute: '&#225;', eacute: '&#233;', iacute: '&#237;', oacute: '&#243;', uacute: '&#250;',
  agrave: '&#224;', egrave: '&#232;', igrave: '&#236;', ograve: '&#242;', ugrave: '&#249;',
  auml: '&#228;', euml: '&#235;', iuml: '&#239;', ouml: '&#246;', uuml: '&#252;',
  ntilde: '&#241;', ccedil: '&#231;',
};

export const LEADING_BULLET_RE = /^\s*[•\-\*\u2022\u2023\u25E6\u2043\u2219\u25AA\u25AB\u25CF\u25CB\uF0B7\uF0A7\u00B7]+\s+/;
export function stripLeadingBullet(str) {
  if (!str) return str;
  return String(str).replace(LEADING_BULLET_RE, '').trim();
}

function sanitizeXmlEntities(xml) {
  let s = xml || '';
  const dtdEntities = {};
  const entityDeclRe = /<!ENTITY\s+(?:%\s+)?([a-zA-Z0-9_\-\.:]+)\s+["']([^"']*)["']\s*>/g;
  let em;
  while ((em = entityDeclRe.exec(s)) !== null) {
    dtdEntities[em[1]] = em[2];
  }
  // A DOCTYPE entity used thousands of times (one 10 KB entity, 10,000 uses = 100 MB from a 125 KB file) is refused once the text it adds
  // passes MAX_ENTITY_EXPANSION_CHARS; each entity is expanded once, never again inside its own value (no "billion laughs").
  let added = 0;
  s = s.replace(/&([a-zA-Z0-9_\-\.:]+);/g, (match, name) => {
    if (name === 'amp' || name === 'lt' || name === 'gt' || name === 'quot' || name === 'apos') return match;
    if (dtdEntities[name] !== undefined) {
      added += dtdEntities[name].length;
      if (added > MAX_ENTITY_EXPANSION_CHARS) {
        const e = new Error('This file uses entity references to repeat text so many times that it would grow by more than 32 MB, so Emboss stopped reading it. It may be damaged, or made on purpose to overload a program.');
        e.userFacing = true;
        throw e;
      }
      return dtdEntities[name];
    }
    if (COMMON_HTML_ENTITIES[name] !== undefined) return COMMON_HTML_ENTITIES[name];
    return `&amp;${name};`;
  });
  return s;
}

// `opts.strict` (audit batch S2b item 8): no recovery as HTML. A structured container part (a Word document.xml, an ODT content.xml, an EPUB's
// OPF) that is not well-formed XML is a damaged file; a browser's HTML recovery used to turn it into a successful empty document, because the
// readers look for namespaced elements that an HTML parse does not keep.
function parseXml(xml, opts) {
  const Parser = typeof DOMParser !== 'undefined' ? DOMParser : globalThis.DOMParser;
  if (!Parser) throw new Error('No DOMParser available');
  let cleanXml = (xml ?? '').replace(/^\uFEFF/, '').trim();
  cleanXml = sanitizeXmlEntities(cleanXml);
  let doc = new Parser().parseFromString(cleanXml, 'application/xml');
  let err = doc.getElementsByTagName('parsererror')[0]
    || (doc.documentElement && doc.documentElement.nodeName === 'parsererror' ? doc.documentElement : null);
  
  if (err) {
    cleanXml = sanitizeXmlEntities(cleanXml);
    doc = new Parser().parseFromString(cleanXml, 'application/xml');
    err = doc.getElementsByTagName('parsererror')[0]
      || (doc.documentElement && doc.documentElement.nodeName === 'parsererror' ? doc.documentElement : null);
  }

  if (err && !(opts && opts.strict) && typeof document !== 'undefined') {
    try {
      const htmlDoc = new Parser().parseFromString(cleanXml, 'text/html');
      if (htmlDoc && (htmlDoc.body || htmlDoc.documentElement)) return htmlDoc;
    } catch { /* ignore and throw XML error */ }
  }

  if (err) throw new Error('malformed XML: ' + (err.textContent || 'parse error').replace(/\s+/g, ' ').trim().slice(0, 200));
  return doc;
}

// A structured part (document.xml, content.xml, an OPF) read strictly: not well-formed, or without the element every real one has, is a
// damaged file with a plain message naming the part (audit batch S2b item 8). `hasBody(doc)` finds that element.
function parseStructuredPart(xml, partName, damagedMsg, hasBody) {
  let doc;
  try { doc = parseXml(xml, { strict: true }); }
  catch (e) {
    if (e && e.userFacing) throw e;                      // e.g. the entity-expansion refusal keeps its own words
    const err = zipDamagedError(String((e && e.message) || e).slice(0, 200), partName);
    err.message = `${damagedMsg} The damaged part is "${partName}".`;
    throw err;
  }
  if (hasBody && !hasBody(doc)) {
    const err = zipDamagedError('the part has no document body', partName);
    err.message = `${damagedMsg} The damaged part is "${partName}".`;
    throw err;
  }
  return doc;
}

// ---- Word list numbering (word/numbering.xml) → running list markers ----
// Word stores only that a paragraph belongs to list numId at level ilvl; the actual
// "1." / "a)" / "iii." text has to be computed from numbering.xml (numFmt + lvlText +
// start) plus a running counter. Without the numbering part we can't tell an ordered
// list from a bullet one, so we emit NO marker (unchanged behaviour) rather than guess.
const _ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function toRoman(n) { if (n < 1 || n > 3999) return String(n); let s = ''; for (const [v, g] of _ROMAN) while (n >= v) { s += g; n -= v; } return s; }
function toAlpha(n) { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s || 'a'; }
// Word's letter numbering repeats the letter rather than counting in base 26: a, b, … z, aa, bb, cc, … (27th = "aa", 28th = "bb").
function wordLetters(n) { const i = (n - 1) % 26, rep = Math.floor((n - 1) / 26) + 1; return String.fromCharCode(97 + i).repeat(rep); }
// English ordinal numbers ("1st", "2nd", "3rd", "4th", "11th", "21st").
function englishOrdinal(n) {
  const r100 = n % 100, r10 = n % 10;
  return n + (r100 >= 11 && r100 <= 13 ? 'th' : r10 === 1 ? 'st' : r10 === 2 ? 'nd' : r10 === 3 ? 'rd' : 'th');
}
const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_ORD_ONES = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'];
const EN_ORD_TENS = ['', '', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth'];
// "twenty-one" / "twenty-first"; `ordinal` makes the LAST word ordinal. null beyond 999 (the caller falls back to digits).
function englishNumberWords(n, ordinal) {
  if (!(n >= 1 && n <= 999)) return null;
  const parts = [];
  const h = Math.floor(n / 100), rest = n % 100;
  if (h) parts.push(EN_ONES[h], rest || !ordinal ? 'hundred' : 'hundredth');
  if (rest) {
    if (rest < 20) parts.push((ordinal ? EN_ORD_ONES : EN_ONES)[rest]);
    else {
      const t = Math.floor(rest / 10), o = rest % 10;
      parts.push(o ? `${EN_TENS[t]}-${(ordinal ? EN_ORD_ONES : EN_ONES)[o]}` : (ordinal ? EN_ORD_TENS : EN_TENS)[t]);
    }
  }
  return parts.join(' ');
}
const capFirst = (w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);
const CHICAGO_LIST_SYMBOLS = ['*', '†', '‡', '§'];   // Word's "chicago": * † ‡ §, then doubled, tripled …
// Circled / parenthesised / full-stopped digits (Unicode has them only up to 20, or 50 for the circled ones).
const enclosed = (n, start, max) => (n >= 1 && n <= max ? String.fromCodePoint(start + n - 1) : null);
function formatCounter(n, numFmt) {
  switch (numFmt) {
    case 'decimal': case 'decimalhalfwidth': return String(n);
    case 'decimalzero': return n < 10 ? '0' + n : String(n);
    case 'lowerletter': return wordLetters(n);
    case 'upperletter': return wordLetters(n).toUpperCase();
    case 'lowerroman': return toRoman(n);
    case 'upperroman': return toRoman(n).toUpperCase();
    // Import fix list #30b: the other number formats Word can show in English (and the ones that are only digits in another
    // form). What Word shows is what the marker is, so the braille keeps the print's "1st" / "One" / "①".
    case 'ordinal': return englishOrdinal(n);
    case 'cardinaltext': { const w = englishNumberWords(n, false); return w ? capFirst(w) : String(n); }
    case 'ordinaltext': { const w = englishNumberWords(n, true); return w ? capFirst(w) : englishOrdinal(n); }
    case 'decimalenclosedcircle': return n <= 20 ? enclosed(n, 0x2460, 20) : n <= 35 ? enclosed(n - 20, 0x3251, 15) : n <= 50 ? enclosed(n - 35, 0x32B1, 15) : String(n);
    case 'decimalenclosedparen': return enclosed(n, 0x2474, 20) || String(n);
    case 'decimalenclosedfullstop': return enclosed(n, 0x2488, 20) || String(n);
    case 'decimalfullwidth': case 'decimalfullwidth2': return String(n).replace(/[0-9]/g, (d) => String.fromCharCode(0xFF10 + Number(d)));
    case 'chicago': return CHICAGO_LIST_SYMBOLS[(n - 1) % CHICAGO_LIST_SYMBOLS.length].repeat(Math.floor((n - 1) / CHICAGO_LIST_SYMBOLS.length) + 1);
    case 'hex': return n.toString(16).toUpperCase();
    case 'numberindash': return `- ${n} -`;
    case '': case 'bullet': case 'none': return null;      // not a counting format
    // Everything else Word offers counts in a script this reader has no table for (Japanese, Chinese, Korean, Thai, Hindi,
    // Arabic, Hebrew, Russian … or a "custom" format): the number is kept as plain digits, so the list is still numbered.
    default: return String(n);
  }
}

// docx-fix item 6: a footnote/endnote's AUTO-numbered mark, per w:footnotePr/w:endnotePr's
// own w:numFmt (sectPr — a section's own override — or settings.xml's document-wide
// default; see parseDocx's noteMarks.fnFmt/enFmt). 'chicago' is the classic footnote-symbol
// cycle (*, †, ‡, §, ‖, ¶, then doubled) some house styles still use; anything else not
// listed here (or simply absent) is Word's own default, plain decimal.
const CHICAGO_NOTE_SYMBOLS = ['*', '†', '‡', '§', '‖', '¶'];
function formatNoteNum(n, numFmt) {
  switch (String(numFmt || 'decimal').toLowerCase()) {
    case 'lowerroman': return toRoman(n);
    case 'upperroman': return toRoman(n).toUpperCase();
    case 'lowerletter': return toAlpha(n);
    case 'upperletter': return toAlpha(n).toUpperCase();
    case 'chicago': {
      const i = (n - 1) % CHICAGO_NOTE_SYMBOLS.length;
      const rep = Math.floor((n - 1) / CHICAGO_NOTE_SYMBOLS.length) + 1;
      return CHICAGO_NOTE_SYMBOLS[i].repeat(rep);
    }
    case 'decimal': default: return String(n);
  }
}

async function parseDocxNumbering(arrayBuffer, W) {
  let xml;
  try { xml = new TextDecoder().decode(await unzipEntry(arrayBuffer, 'word/numbering.xml')); }
  catch { return null; }                               // no numbering part
  let doc; try { doc = parseXml(xml); } catch { return null; }
  const abstract = new Map();                          // abstractNumId → Map(ilvl → {numFmt,lvlText,start})
  for (const an of doc.getElementsByTagNameNS(W, 'abstractNum')) {
    const levels = new Map();
    for (const lvl of an.getElementsByTagNameNS(W, 'lvl')) {
      const numFmt = (lvl.getElementsByTagNameNS(W, 'numFmt')[0]?.getAttributeNS(W, 'val') || '').toLowerCase();
      const lvlText = lvl.getElementsByTagNameNS(W, 'lvlText')[0]?.getAttributeNS(W, 'val') || '';
      const start = Number(lvl.getElementsByTagNameNS(W, 'start')[0]?.getAttributeNS(W, 'val') || '1') || 1;
      // docx-fix item 2a: <w:isLgl/> ("legal style numbering", Word's Multilevel List ›
      // "Legal Style Numbering" checkbox) forces THIS level's number to be shown as a plain
      // Arabic/decimal numeral in the finished marker, regardless of numFmt (upperRoman/
      // lowerLetter/… still governs the level's OWN counter for any OTHER level's lvlText
      // that inherits it — isLgl only overrides how it is finally FORMATTED for display).
      const isLgl = lvl.getElementsByTagNameNS(W, 'isLgl').length > 0;
      // docx-fix item 2b: <w:lvlRestart w:val="N"/> — the level number whose OWN counter
      // incrementing restarts this level; Word's default when absent is "one less than this
      // level" (ilvl-1, i.e. restart whenever the immediately-enclosing level advances — see
      // listMarker's own reset loop, which already does exactly that by default). An explicit
      // val="0" means never automatically restart.
      const lvlRestartEl = lvl.getElementsByTagNameNS(W, 'lvlRestart')[0];
      const lvlRestart = lvlRestartEl ? Number(lvlRestartEl.getAttributeNS(W, 'val')) : null;
      const lvlRf = lvl.getElementsByTagNameNS(W, 'rPr')[0]?.getElementsByTagNameNS(W, 'rFonts')[0];   // IMP-W7: the bullet's own font (Wingdings...) tells which shape a symbol-font code point is
      const font = lvlRf ? (lvlRf.getAttributeNS(W, 'ascii') || lvlRf.getAttributeNS(W, 'hAnsi') || lvlRf.getAttributeNS(W, 'cs') || '') : '';
      levels.set(String(lvl.getAttributeNS(W, 'ilvl')), { numFmt, lvlText, start, isLgl, lvlRestart, font });
    }
    abstract.set(String(an.getAttributeNS(W, 'abstractNumId')), levels);
  }
  const numToAbstract = new Map();                     // numId → {aId, startOverrides:Map(ilvl→start)}
  for (const num of doc.getElementsByTagNameNS(W, 'num')) {
    const aId = String(num.getElementsByTagNameNS(W, 'abstractNumId')[0]?.getAttributeNS(W, 'val'));
    const startOverrides = new Map();
    for (const ov of num.getElementsByTagNameNS(W, 'lvlOverride')) {
      const so = ov.getElementsByTagNameNS(W, 'startOverride')[0]?.getAttributeNS(W, 'val');
      if (so != null) startOverrides.set(String(ov.getAttributeNS(W, 'ilvl')), Number(so) || 1);
    }
    numToAbstract.set(String(num.getAttributeNS(W, 'numId')), { aId, startOverrides });
  }
  return function level(numId, ilvl) {
    const rec = numToAbstract.get(String(numId)); if (!rec) return null;
    const levels = abstract.get(rec.aId); if (!levels) return null;
    const lv = levels.get(String(ilvl)); if (!lv) return null;
    const so = rec.startOverrides.get(String(ilvl));
    return so != null ? { ...lv, start: so } : lv;
  };
}

// A46/D4: word/_rels/document.xml.rels maps each `w:hyperlink`'s `r:id` to its actual
// target URL — parseDocx's own paragraph walk only ever sees the `r:id`, never the URL,
// so without this the link text survived but the href never did. Returns an empty Map
// (not an error) when the part is missing — a docx with no hyperlinks at all has no
// rels part, and every `r:id` lookup against an empty Map is just a no-op (the run's
// text still comes through the ordinary, non-hyperlink path).
// A45: also used to resolve a `w:drawing`'s blip `r:embed` to its media part, and (given
// `partName`) a footnote's/endnote's own hyperlinks — footnotes.xml and endnotes.xml each
// carry a separate `_rels` part of their own, distinct from the body's.
async function parseDocxRelationships(arrayBuffer, partName = 'word/_rels/document.xml.rels') {
  const map = new Map();
  let xml;
  try { xml = new TextDecoder().decode(await unzipEntry(arrayBuffer, partName)); }
  catch { return map; }
  let doc; try { doc = parseXml(xml); } catch { return map; }
  for (const rel of doc.getElementsByTagNameNS('*', 'Relationship')) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target) map.set(id, target);
  }
  return map;
}

// Compute the marker for a list item at (numId, ilvl), advancing `counters` (a Map
// keyed "numId:ilvl") and resetting deeper levels so nested lists restart. Returns
// '•' for bullets, null for unresolved numbering (caller then omits the marker).
// The print bullet a Word/RTF bullet glyph stands for, when it is certain; anything else stays the plain dot.
// Wingdings private-use code points (U+F000 + the font's byte): F0A7 = small black square (-> solid square),
// F0A8 = white square (-> hollow square), F0FC = check mark (-> check mark). Courier New "o" = hollow circle.
// IMP-W7 (Paul, 30 Sep 2026): any other bullet shape - an arrow (Wingdings F0D8 / F0E8 ..., or ➢ typed in any font), an en dash,
// a hyphen, a star, a diamond... - KEEPS its print glyph as the item's marker, so the braille can give it a transcriber-defined
// symbol (BANA 8.6.2a) listed on the Special Symbols page (format/document.mjs customBullet). What stays the ordinary dot: the
// dot-like shapes (Symbol F0B7, the bullet, middle dot, black/small circle and square ◦ ▪ ● ...), and a symbol-font code point with no
// Unicode shape here (e.g. Wingdings F076).
// Feedback 17 Oct 2026, 15a (Paul): Word gives EVERY nested bullet list the same default shapes - the dot at level 1, Courier New
// "o" at level 2, Wingdings' small square (U+F0A7) at level 3, then round again (levels 4-6, 7-9). At exactly those levels they are
// Word's default look, not a shape the author chose, so they are the ordinary bullet ("•", Emboss's own nested list) - not a
// hollow circle and a solid square needing explanation. A circle or square at any other level (e.g. a top-level list of "o"), and
// every arrow, tick, star... still keeps its shape (IMP-W7). `ilvl` is the 0-based list level, when the caller knows it.
const WORD_DEFAULT_LEVEL_BULLET = (t, ilvl) => Number.isInteger(ilvl) && ((t === 'o' && ilvl % 3 === 1) || ((t === '\uF0A7' || t === '\u25AA' || t === '\u25A0') && ilvl % 3 === 2));
const WORD_BULLET_GLYPHS = { '\uF0A7': '\u25A0', '\uF0A8': '\u25A1', '\uF0FC': '\u2713', 'o': '\u25CB' };
function wordBulletGlyph(ch, font, ilvl) {
  let t = String(ch ?? '').trim();
  if (WORD_DEFAULT_LEVEL_BULLET(t, ilvl)) return '\u2022';
  if (isNonDotBulletMarker(t)) return t;                       // a literal ■ □ ○ ▲ ✓ … in the numbering definition
  if (Object.prototype.hasOwnProperty.call(WORD_BULLET_GLYPHS, t)) return WORD_BULLET_GLYPHS[t];
  // A symbol-font code point (Word writes Wingdings' arrowhead as U+F0D8 in a level set in Wingdings) is that font's shape.
  if (/^[\uF020-\uF0FF]$/.test(t) && String(font || '').trim().toLowerCase() === 'wingdings') {
    if (!Object.prototype.hasOwnProperty.call(WINGDINGS_GLYPHS, t)) return '\u2022';
    t = WINGDINGS_GLYPHS[t];
    if (isNonDotBulletMarker(t)) return t;
  }
  t = t.replace(/\uFE0F/g, '');
  return isCustomBulletMarker(t) ? t : '\u2022';
}

// docx-fix item 5: w:sym (`<w:sym w:font="Wingdings" w:char="F0E0"/>`, a "typed symbol" --
// Insert > Symbol in Word) -> Unicode. w:char is a hex code point in the FONT's own internal
// encoding: for the classic Windows symbol fonts (Wingdings/Wingdings 2/Wingdings
// 3/Webdings/Symbol/Monotype Sorts) that slot sits in the Private Use Area with no fixed
// Unicode meaning at all -- only a curated, font-specific table can map it, and an entry not
// in the table is genuinely unrecoverable, not just unimplemented. For any OTHER font (MS
// Gothic, Arial, a plain Unicode font Word still routed through w:sym) w:char IS the
// character's real Unicode code point directly, decoded as-is.
// Wingdings table: reuses WORD_BULLET_GLYPHS' three already-certain glyphs (F0A7/F0A8/F0FC,
// used for list bullets above) plus the four cardinal arrows (F0E0-F0E3) and the two ballot
// marks F0FB/F0FD (heavy X / ballot box with X) and F0FE (ballot box with check) -- the
// "arrows/ticks/boxes" a real transcriber hits constantly. Anything else in Wingdings/
// Wingdings 2/Wingdings 3/Webdings/Monotype Sorts (no confidently-sourced mapping to hand)
// and Symbol characters outside the Greek-letter/minus-sign set below fall back to a visible
// hollow-square placeholder (SYMBOL_FALLBACK_GLYPH) -- keeping "something was here" rather
// than the run silently vanishing, same reasoning as the legacy-equation placeholder above.
// (Emboss/tests/real_samples/docx/fungal-skin-nail-infections-guidance.docx uses Wingdings
// F0FE seven times, standalone/centred -- now reads as U+2611 ☑; see this task's final report.)
// docx-fix item 9: F0FD/F0FE (checkbox glyphs, Insert Symbol's "ballot box with X"/"ballot
// box with check") were missing entirely \u2014 verified against Wikipedia's own Wingdings
// character table (0xA8/0xFB: BALLOT BOX WITH CHECK/WITH X) and cross-checked for
// consistency against the two entries already confirmed correct here (0xFC -> U+2713 check
// mark, 0xFB -> U+2717 heavy ballot X: both already the plain BMP symbol, not an exotic
// supplementary-plane "bold ballot script" variant some vendor tables list instead) \u2014 the
// same simple, widely-supported family is used for 0xFD/0xFE too, consistent with 0xA8's own
// plain hollow square rather than a checkbox-specific glyph.
const WINGDINGS_GLYPHS = {
  '': '■', '': '□', '': '✓',      // solid/hollow square, check (as WORD_BULLET_GLYPHS)
  '': '✗',                                              // heavy ballot X
  '': '☒',                                              // ballot box with X (☒)
  '': '☑',                                              // ballot box with check (☑)
  // Import fix list #36 (audit w03): the arrows (0xDF-0xF8) and the arrowhead bullet (0xD8), after Unicode's Wingdings
  // mapping as published in Pandoc's Symbols.hs (references/pandoc-src/.../Readers/Docx/Symbols.hs). Unicode puts most of
  // these in the Supplemental Arrows-C plane (U+1F8xx), which almost no font draws; the plain Arrows / Misc Symbols and
  // Arrows / Dingbats twin of each is used instead (a left/right/up/down arrow stays a left/right/up/down arrow).
  // Thin triangle-headed arrows: left, right, up, down, NW, NE, SW, SE.
  '': '←', '': '→', '': '↑', '': '↓',
  '': '↖', '': '↗', '': '↙', '': '↘',
  // Heavy arrows: left, right (Word's arrow bullet), up, down, NW, NE, SW, SE.
  '': '⬅', '': '➔', '': '⬆', '': '⬇',
  '': '⬉', '': '⬈', '': '⬋', '': '⬊',
  // Outline arrows: left, right, up, down, left-right, up-down, NE, NW, SW, SE.
  '': '⇦', '': '⇨', '': '⇧', '': '⇩',
  '': '⬄', '': '⇳', '': '⬀', '': '⬁', '': '⬃', '': '⬂',
  '': '➢',                                              // arrowhead (the bullet Word types as "Ø" in Wingdings)
};
// Symbol font (the Adobe Symbol encoding, stable since PostScript and still what Word writes): byte code -> Unicode.
// Import fix list #36: the whole table, after Unicode's mapping as published in Pandoc's Symbols.hs — Greek letters (the
// old table had w, V, W and J wrong), maths signs, arrows, card suits, the bullet (0xB7). Codes whose Unicode form is a
// private-use character (the big-bracket pieces) are left out, and so become the placeholder. ASCII that Symbol leaves as
// itself is SYMBOL_SAME_AS_ASCII.
const SYMBOL_BY_CODE = {
  0x22: '\u2200', 0x24: '\u2203', 0x27: '\u220B', 0x2A: '\u2217', 0x2D: '\u2212', 0x40: '\u2245',
  0x41: '\u0391', 0x42: '\u0392', 0x43: '\u03A7', 0x44: '\u0394', 0x45: '\u0395', 0x46: '\u03A6',
  0x47: '\u0393', 0x48: '\u0397', 0x49: '\u0399', 0x4A: '\u03D1', 0x4B: '\u039A', 0x4C: '\u039B',
  0x4D: '\u039C', 0x4E: '\u039D', 0x4F: '\u039F', 0x50: '\u03A0', 0x51: '\u0398', 0x52: '\u03A1',
  0x53: '\u03A3', 0x54: '\u03A4', 0x55: '\u03A5', 0x56: '\u03C2', 0x57: '\u03A9', 0x58: '\u039E',
  0x59: '\u03A8', 0x5A: '\u0396', 0x5C: '\u2234', 0x5E: '\u22A5', 0x61: '\u03B1', 0x62: '\u03B2',
  0x63: '\u03C7', 0x64: '\u03B4', 0x65: '\u03B5', 0x66: '\u03C6', 0x67: '\u03B3', 0x68: '\u03B7',
  0x69: '\u03B9', 0x6A: '\u03D5', 0x6B: '\u03BA', 0x6C: '\u03BB', 0x6D: '\u03BC', 0x6E: '\u03BD',
  0x6F: '\u03BF', 0x70: '\u03C0', 0x71: '\u03B8', 0x72: '\u03C1', 0x73: '\u03C3', 0x74: '\u03C4',
  0x75: '\u03C5', 0x76: '\u03D6', 0x77: '\u03C9', 0x78: '\u03BE', 0x79: '\u03C8', 0x7A: '\u03B6',
  0x7E: '\u223C', 0xA0: '\u20AC', 0xA1: '\u03D2', 0xA2: '\u2032', 0xA3: '\u2264', 0xA4: '\u2215',
  0xA5: '\u221E', 0xA6: '\u0192', 0xA7: '\u2663', 0xA8: '\u2666', 0xA9: '\u2665', 0xAA: '\u2660',
  0xAB: '\u2194', 0xAC: '\u2190', 0xAD: '\u2191', 0xAE: '\u2192', 0xAF: '\u2193', 0xB0: '\u00B0',
  0xB1: '\u00B1', 0xB2: '\u2033', 0xB3: '\u2265', 0xB4: '\u00D7', 0xB5: '\u221D', 0xB6: '\u2202',
  0xB7: '\u2022', 0xB8: '\u00F7', 0xB9: '\u2260', 0xBA: '\u2261', 0xBB: '\u2248', 0xBC: '\u2026',
  0xBF: '\u21B5', 0xC0: '\u2135', 0xC1: '\u2111', 0xC2: '\u211C', 0xC3: '\u2118', 0xC4: '\u2297',
  0xC5: '\u2295', 0xC6: '\u2205', 0xC7: '\u2229', 0xC8: '\u222A', 0xC9: '\u2283', 0xCA: '\u2287',
  0xCB: '\u2284', 0xCC: '\u2282', 0xCD: '\u2286', 0xCE: '\u2208', 0xCF: '\u2209', 0xD0: '\u2220',
  0xD1: '\u2207', 0xD5: '\u220F', 0xD6: '\u221A', 0xD7: '\u22C5', 0xD8: '\u00AC', 0xD9: '\u2227',
  0xDA: '\u2228', 0xDB: '\u21D4', 0xDC: '\u21D0', 0xDD: '\u21D1', 0xDE: '\u21D2', 0xDF: '\u21D3',
  0xE0: '\u25CA', 0xE1: '\u2329', 0xE5: '\u2211', 0xF1: '\u232A', 0xF2: '\u222B', 0xF3: '\u2320',
  0xF5: '\u2321',
};
const SYMBOL_SAME_AS_ASCII = /^[ !#%&(),+.\/0-9:;<=>?\[\]_{|}]$/;
const KNOWN_SYMBOL_FONTS = new Set(['wingdings', 'wingdings 2', 'wingdings 3', 'webdings', 'symbol', 'monotype sorts']);
// A symbol that has no Unicode equivalent here (an unmapped Wingdings / Wingdings 2 / 3 / Webdings / Symbol code) becomes
// U+FFFD, the replacement character — visible in the editor, and a character the braille tables have no cell for, so the
// formatter's own untranslatable-character handling reports it (a full cell and a "no braille cell" warning; in BANA a
// transcriber-defined print symbol). It used to become U+25A1, the white square, which braille translates as a real
// white-square sign: a wrong symbol, silently. Each one is also listed in DOCX_SYM_LOG so the import can warn by name.
const SYMBOL_FALLBACK_GLYPH = '�';
let DOCX_SYM_LOG = null;   // Map of "Font Fhhhh" -> reads, set per parseDocx call (the distinct keys are what is reported)
function symbolFallback(font, code) {
  if (DOCX_SYM_LOG) {
    const name = `${String(font || 'symbol font').trim()} ${Number.isFinite(code) && code > 0 ? code.toString(16).toUpperCase().padStart(4, '0') : '?'}`;
    DOCX_SYM_LOG.set(name, (DOCX_SYM_LOG.get(name) || 0) + 1);
  }
  return SYMBOL_FALLBACK_GLYPH;
}
// The .doc reader (doc.mjs) uses the same tables and the same log: it sets its own around a read.
export function setDocxSymbolLog(map) { const prev = DOCX_SYM_LOG; DOCX_SYM_LOG = map; return prev; }
// The load warning for the symbols in a log (null when there are none).
export function symbolLogWarning(symLog) {
  if (!symLog || !symLog.size) return null;
  // (Each symbol is read more than once — plain text and segments — so the log counts distinct symbols, not occurrences.)
  const names = [...symLog.keys()];
  const n = names.length;
  const shown = names.slice(0, 6).join(', ') + (n > 6 ? `, and ${n - 6} more` : '');
  return `${n} symbol${n === 1 ? '' : 's'} typed in a symbol font (${shown}) ${n === 1 ? 'has' : 'have'} no known equivalent and ${n === 1 ? 'is' : 'are'} shown as a replacement mark (\uFFFD); ` +
    `check ${n === 1 ? 'it' : 'them'} against the print`;
}
export function wordSymGlyph(font, hexChar) {
  const fontLower = String(font || '').trim().toLowerCase();
  const code = parseInt(hexChar, 16);
  if (!Number.isFinite(code) || code <= 0) return symbolFallback(font, code);
  if (fontLower === 'wingdings') {
    // WINGDINGS_GLYPHS is keyed by the actual PUA character Word writes (0xF0xx, matching
    // WORD_BULLET_GLYPHS' own convention just above) — looked up directly, no ASCII reduction.
    const ch = String.fromCharCode(code);
    return Object.prototype.hasOwnProperty.call(WINGDINGS_GLYPHS, ch) ? WINGDINGS_GLYPHS[ch] : symbolFallback(font, code);
  }
  if (fontLower === 'symbol') {
    // The Symbol font's byte: undo the font's 0xF000 Private-Use-Area offset first.
    const base = code >= 0xF000 ? code - 0xF000 : code;
    if (Object.prototype.hasOwnProperty.call(SYMBOL_BY_CODE, base)) return SYMBOL_BY_CODE[base];
    const ascii = base >= 0x20 && base <= 0x7E ? String.fromCharCode(base) : '';
    return ascii && SYMBOL_SAME_AS_ASCII.test(ascii) ? ascii : symbolFallback(font, code);
  }
  if (KNOWN_SYMBOL_FONTS.has(fontLower)) return symbolFallback(font, code);   // Wingdings 2/3, Webdings, Monotype Sorts: no confidently-sourced table at all
  return String.fromCharCode(code);   // not a symbol font: w:char IS the real Unicode code point
}
// A private-use character U+F020-U+F0FF typed straight into w:t text of a run set in a symbol font (Word writes a Symbol
// bullet as U+F0B7 in a run with w:rFonts="Symbol", no w:sym) means that font's character at that byte: the same tables as
// w:sym. `font` is the run's own w:rFonts (ascii / hAnsi / cs); without a symbol font the text is left alone.
const SYMBOL_PUA_RE = /[-]/;
function symbolFontText(r, W, s) {
  const rPr = firstChildNS(r, W, 'rPr');
  const rf = rPr && firstChildNS(rPr, W, 'rFonts');
  if (!rf) return s;
  // Ordinary characters typed and then set in the Symbol or Wingdings font (Format > Font on "ab"): print shows that font's shapes
  // (Symbol "ab" is αβ), as the .doc reader reads them (D15). Only the run's ASCII font counts; a space or control character has no
  // shape. A Wingdings character with no Unicode form is U+FFFD and named in the load warning, as one typed with Insert > Symbol.
  const asciiFont = String(rf.getAttributeNS(W, 'ascii') || '').trim();
  if (/^(?:symbol|wingdings)$/i.test(asciiFont) && /[\x21-\x7e]/.test(s)) {
    const wing = /^wingdings$/i.test(asciiFont);
    s = s.replace(/[\x21-\x7e]/g, (ch) => wordSymGlyph(asciiFont, (wing ? 0xF000 + ch.charCodeAt(0) : ch.charCodeAt(0)).toString(16)));
  }
  if (!SYMBOL_PUA_RE.test(s)) return s;
  let font = null;
  for (const a of ['ascii', 'hAnsi', 'cs']) { const v = rf.getAttributeNS(W, a); if (v && KNOWN_SYMBOL_FONTS.has(v.trim().toLowerCase())) { font = v; break; } }
  if (!font) return s;
  return s.replace(/[-]/g, (ch) => wordSymGlyph(font, ch.charCodeAt(0).toString(16)));
}
function listMarker(level, counters, numId, ilvl) {
  if (!level || numId == null) return null;
  const lv = level(numId, ilvl);
  if (lv && lv.numFmt === 'bullet') return wordBulletGlyph(lv.lvlText, lv.font, Number(ilvl));    // any Word bullet (symbol-font U+F0B7/U+F0A7, o, §, •): braille keeps the print bullet (BANA 8.6.2)
  // docx-fix item 2a: isLgl forces the DISPLAYED numeral to decimal regardless of numFmt.
  // docx-parity item 1: isLgl is a property of the LEVEL BEING DISPLAYED (`lv`, i.e. `ilvl`
  // itself), not of whichever other level a %n placeholder happens to reference — Word's own
  // "Legal Style Numbering" forces EVERY numeral in the marker to Arabic the moment the level
  // actually being shown has isLgl set, even when the marker's lvlText also pulls in a
  // higher level's own number (e.g. ilvl 1's lvlText "%1.%2" showing "1.1" instead of "I.1"
  // when ilvl 0 is upperRoman but ilvl 1 has isLgl). See the placeholder loop below, which
  // now applies `lv.isLgl` (this level's own flag) uniformly instead of each referenced
  // level's (`llv`'s) own isLgl.
  if (!lv || formatCounter(1, lv.isLgl ? 'decimal' : lv.numFmt) == null) return null;   // not an ordered format
  const key = (i) => `${numId}:${i}`;
  // docx-fix item 2b: `counters` is now a single Map shared for the WHOLE document (never
  // reset when a non-list paragraph, table or image interrupts a list — see parseDocx's own
  // pendingList handling), keyed by numId:ilvl exactly as before — so a paragraph reusing the
  // SAME numId picks its count back up where it left off (Word's own "continue numbering"
  // behaviour), while a genuinely different numId (Word's "restart numbering" writes a new
  // <w:num> instance, often with its own lvlOverride/startOverride) starts fresh at its own
  // start value, since no entry for that numId exists in the Map yet.
  counters.set(key(ilvl), counters.has(key(ilvl)) ? counters.get(key(ilvl)) + 1 : lv.start);
  // A deeper level's own counter resets on a shallower level's increment ONLY per that
  // deeper level's OWN w:lvlRestart: absent (the common case) keeps this function's original,
  // unconditional "any shallower level increments -> reset every deeper one" behaviour
  // (Word's own default: restart whenever the immediately-enclosing level advances); an
  // explicit lvlRestart val="0" means that level never restarts itself; any other explicit
  // value names the one (0-based) level whose own increment is the only thing that restarts it.
  for (let j = ilvl + 1; j <= 8; j++) {
    const jlv = level(numId, j);
    const restart = jlv && jlv.lvlRestart != null ? jlv.lvlRestart : null;
    if (restart === 0) continue;                        // never auto-restarts
    if (restart != null && restart !== ilvl) continue;   // only that specific level's own increment restarts it
    counters.delete(key(j));
  }
  return (lv.lvlText || `%${ilvl + 1}.`).replace(/%([1-9])/g, (_, d) => {
    const li = Number(d) - 1;
    const llv = level(numId, li) || lv;
    const val = counters.has(key(li)) ? counters.get(key(li)) : (llv.start ?? 1);
    // docx-parity item 1: `lv.isLgl` (the level actually being displayed, `ilvl`), not
    // `llv.isLgl` (whichever level THIS placeholder happens to reference) — see the comment
    // above. `llv.numFmt` is still the right format to fall back to when `lv` itself has no
    // isLgl at all: each level keeps its own numbering style unless the displayed level
    // forces decimal.
    return formatCounter(val, lv.isLgl ? 'decimal' : llv.numFmt) ?? String(val);
  });
}

// A45/D2: a picture sits inside a run (`w:r > w:drawing`, or the legacy VML `w:pict`), not
// at paragraph/body level, so a paragraph holding only an image has no `w:t` at all and
// `parseDocx`'s existing "no text → skip" gate silently dropped it before this ever ran.
// Produces the same {type:'graphic', src, alt} shape `parseDtbook`'s own `pushImage`
// builds for a DTBook <img> (A26/A29) — src is the relationship's own Target (relative to
// `word/`, e.g. "media/image1.png"), resolved to real bytes afterwards by
// embedGraphicResources so the model shape matches a NIMAS package import exactly
// (model.resources + a package-relative graphic.src — see parseNimasZip, below). Alt text
// prefers the docPr's own `descr` (the actual alt text a real author wrote); a picture
// with none at all still keeps its Word-assigned `name` ("Picture 12") rather than being
// left with nothing — better than an empty alt, though not a substitute for real alt text.
// docx-fix item 6: word/diagrams/dataN.xml (a SmartArt's own data part, linked from the
// body's `<dgm:relIds r:dm="…">` via word/_rels/document.xml.rels) holds the diagram's node
// text as plain DrawingML `<a:t>` runs. Read once per document (every diagram data part the
// rels map points at) so docxParagraphImages, below, can use it as the diagram's
// description when the author left no docPr `descr`/`name` — "the diagram's text… if
// simple", per this task's brief. Best-effort: an unreadable/malformed part just yields no
// entry for that rId, never throws.
async function parseDocxDiagramTexts(arrayBuffer, rels, W) {
  const map = new Map();                                  // r:dm relationship id -> joined node text
  for (const [rid, target] of rels) {
    if (!/diagrams\/data/i.test(target || '')) continue;
    try {
      const xml = new TextDecoder().decode(await unzipEntry(arrayBuffer, resolveZipPath('word', target)));
      const doc = parseXml(xml);
      const texts = [...doc.getElementsByTagNameNS('*', 't')].map((t) => (t.textContent || '').trim()).filter(Boolean);
      if (texts.length) map.set(rid, texts.join(', '));
    } catch { /* unreadable diagram data part: no description from it, nothing else affected */ }
  }
  return map;
}

// docx-fix item 3: Word's own auto-generated docPr `name` for a picture with no real alt
// text — "Picture 3", "Image 2", "Graphic 1" (English) plus a handful of common localised
// equivalents (French/Spanish/German/Italian/Portuguese/Dutch/Nordic) — never text an author
// actually wrote, so it must not stand in for a real description (see docxParagraphImages).
// (The rule itself, with file-like names added for feedback item 8, is pictureNameAsAlt in doc-art.mjs, shared with the .doc reader.)
function docxParagraphImages(p, W, R, diagramTexts = null) {
  const out = [];
  const drawings = p.getElementsByTagNameNS ? [...p.getElementsByTagNameNS(W, 'drawing')] : [];
  for (const dr of drawings) {
    const docPr = dr.getElementsByTagNameNS('*', 'docPr')[0];
    const descr = ((docPr && docPr.getAttribute('descr')) || '').replace(/\s+/g, ' ').trim();
    const name = ((docPr && docPr.getAttribute('name')) || '').replace(/\s+/g, ' ').trim();
    const blip = dr.getElementsByTagNameNS('*', 'blip')[0];
    if (!blip) {
      // docx-fix item 6: a SmartArt/diagram (`dgm:relIds`) or chart (`c:chart`/`cx:chart`)
      // drawing has no picture blip at all — genuinely different content, not a picture with
      // a missing fill, so a bare `continue` (the old behaviour) lost it without a trace. A
      // floating text box's own `w:drawing` (handled separately by docxTxbxParagraphs) also
      // has no blip, so this only fires for a graphicData `uri` that is actually a diagram
      // or chart namespace — anything else (a text box, or a drawing kind this parser
      // doesn't otherwise recognise) still falls through to the original "not a picture,
      // skip" behaviour.
      const graphicData = dr.getElementsByTagNameNS('*', 'graphicData')[0];
      const uri = (graphicData && graphicData.getAttribute('uri')) || '';
      const isDiagram = /\/diagram$/i.test(uri) || dr.getElementsByTagNameNS('*', 'relIds').length > 0;
      const isChart = !isDiagram && (/\/chart$/i.test(uri) || dr.getElementsByTagNameNS('*', 'chart').length > 0);
      if (!isDiagram && !isChart) continue;                // a text box or other non-picture drawing: handled elsewhere/not a target of this fix
      // NOT `name` here (unlike the real-picture path below): Word auto-assigns docPr `name`
      // a generic "Chart 1"/"Diagram 1" for EVERY chart/diagram whether or not the author
      // wrote a real description, so it is never a meaningful placeholder — `title` (a
      // genuine, separate, author-facing docPr attribute, OOXML's own alt-text "title" field)
      // is the second choice the brief actually asks for ("descr/title").
      const title = ((docPr && docPr.getAttribute('title')) || '').replace(/\s+/g, ' ').trim();
      let alt = descr || title;
      if (!alt && isDiagram && diagramTexts) {
        const relIds = dr.getElementsByTagNameNS('*', 'relIds')[0];
        const dmId = relIds && R ? relIds.getAttributeNS(R, 'dm') : null;
        if (dmId && diagramTexts.has(dmId)) alt = diagramTexts.get(dmId);
      }
      if (!alt) alt = isDiagram ? 'diagram' : 'chart';      // generic label: no author descr/title and no (simple) diagram text to fall back to
      out.push({ rid: null, alt });
      continue;
    }
    const rid = R ? blip.getAttributeNS(R, 'embed') : null;
    // docx-fix item 3: `<wp:docPr>…<a:extLst><a:ext …><adec:decorative val="1"/></a:ext>
    // </a:extLst></wp:docPr>` — Word's "Mark as Decorative" picture option (Office 2019+,
    // the OOXML extension a real screen reader/Word itself SKIPS the picture for entirely).
    // BANA §6.4.1 already omits an uncaptioned, undescribed illustration (see isPrintImage/
    // printImageParts in format/document.mjs, and pushImage's own HTML/EPUB convention just
    // above this file's parseHtml/parseDtbook code) — matched here the SAME way: give the
    // block no alt text at all (never the Word-assigned name), so the existing
    // formatter-level §6.4.1 omission applies exactly as it would to an HTML <img alt="">.
    const decorative = !!docPr && [...docPr.getElementsByTagNameNS('*', 'decorative')].some((d) => {
      const v = (d.getAttribute('val') || '1').trim().toLowerCase();
      return v === '1' || v === 'true' || v === 'on';
    });
    // A picture whose only "alt" is Word's OWN auto-generated placeholder name ("Picture 3",
    // "Image 2", "Graphic 1", and a handful of common localised equivalents — never text a
    // real author wrote) is, for braille purposes, exactly as undescribed as one with no
    // name at all; using it as alt would print a meaningless "[Picture 3]". Not exhaustive
    // (Word's UI string is localised per install language) but covers the common cases.
    const alt = decorative ? '' : (descr || pictureNameAsAlt(name));   // automatic and file-like names are no description (doc-art.mjs, feedback item 8)
    out.push({ rid, alt, ...(decorative ? { decorative: true } : {}) });   // IMP-W12: the author's own "decorative" mark is kept, so the formatter does not ask for a description
  }
  // Legacy VML picture (older/converted .doc → .docx): <w:pict><v:shape alt="…"><v:imagedata r:id="…"/></v:shape></w:pict>.
  const picts = p.getElementsByTagNameNS ? [...p.getElementsByTagNameNS(W, 'pict')] : [];
  for (const pict of picts) {
    const imagedata = pict.getElementsByTagNameNS('*', 'imagedata')[0];
    if (!imagedata) continue;
    const shape = pict.getElementsByTagNameNS('*', 'shape')[0];
    const alt = ((shape && shape.getAttribute('alt')) || '').replace(/\s+/g, ' ').trim();
    const rid = R ? imagedata.getAttributeNS(R, 'id') : null;
    out.push({ rid, alt });
  }
  return out;
}

// IMP-W6: the elements with one of `tags` below `root` in document order, not going into a nested <table> (its rows and cells belong
// to it, not to `root`'s table). The nested <table> elements themselves are returned when 'table' is in `tags`.
// A copy of `root` in which every table nested in it (not `root` itself) is replaced by the nested-table placeholder text (IMP-W6). Built
// directly instead of as cloneNode(true) followed by replaceChild for each table: for tables nested 400 deep that copied everything below
// the cell at every level (and in jsdom every node inserted climbs to the document root), 85 s for 400 levels; this copies only what is
// left, and in a loop (no recursion).
function htmlCopyWithoutNestedTables(root, ownerDoc) {
  const copy = root.cloneNode(false);
  const stack = [[root, copy]];
  while (stack.length) {
    const [src, dst] = stack.pop();
    for (let c = src.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && (c.localName || c.tagName || '').toLowerCase() === 'table') { dst.appendChild(ownerDoc.createTextNode(` ${NESTED_TABLE_PLACEHOLDER} `)); continue; }
      const cc = c.cloneNode(false);
      dst.appendChild(cc);
      if (c.firstChild) stack.push([c, cc]);
    }
  }
  return copy;
}
function htmlOwnDescendants(root, tags) {
  const out = [];
  const walk = (n) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const t = (c.localName || c.tagName || '').toLowerCase();
      if (tags.includes(t)) out.push(c);
      if (t !== 'table') walk(c);
    }
  };
  walk(root);
  return out;
}
// IMP-W9 (Paul, 30 Sep 2026): comments, headers and footers stay out of the braille, with a load notice saying what was left out.
// `n` = { comments, headers, footers } (counts; a header or footer is counted only when it holds real text).
export function leftOutNotice({ comments = 0, headers = 0, footers = 0 } = {}) {
  const parts = [];
  if (comments) parts.push(comments === 1 ? 'a comment' : `${comments} comments`);
  if (headers) parts.push(headers === 1 ? 'a running header' : `${headers} running headers`);
  if (footers) parts.push(footers === 1 ? 'a running footer' : `${footers} running footers`);
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const plural = parts.length > 1 || comments > 1 || headers > 1 || footers > 1;
  return `${list} ${plural ? 'were' : 'was'} not transcribed.`;
}
// Real text in a comment, header or footer: at least one letter, and not just "Page 3 of 9"-style page furniture.
export function isRealLeftOutText(t) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return /\p{L}/u.test(s) && !/^(?:page|pages|of|p|pp|no|nr|number|seite|\d|\s|[-\u2013\u2014./:()|])*$/iu.test(s);
}
// The number of distinct texts (whitespace and case ignored) among `texts` that are real.
export function countDistinctRealTexts(texts) {
  return new Set(texts.map((t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()).filter(isRealLeftOutText)).size;
}
// Word: the comments, running headers and running footers of a .docx that are not transcribed. Fields that give a page number, a
// count or a date are not text (a footer of only "Page {PAGE} of {NUMPAGES}" holds none).
const DOCX_FURNITURE_FIELD_RE = /^\s*(?:PAGE|NUMPAGES|SECTIONPAGES|SECTION|DATE|TIME|SAVEDATE|PRINTDATE|CREATEDATE)\b/i;
function docxPartText(p, W) {
  // text of one paragraph with the results of page-number / date fields left out
  const fieldStack = [];
  let out = '';
  for (const r of p.getElementsByTagNameNS(W, 'r')) {
    for (const c of r.childNodes || []) {
      if (c.nodeType !== 1 || c.namespaceURI !== W) continue;
      if (c.localName === 'fldChar') {
        const t = c.getAttributeNS(W, 'fldCharType');
        if (t === 'begin') fieldStack.push({ instr: '', result: false });
        else if (t === 'separate' && fieldStack.length) fieldStack[fieldStack.length - 1].result = true;
        else if (t === 'end') fieldStack.pop();
      } else if (c.localName === 'instrText' && fieldStack.length) fieldStack[fieldStack.length - 1].instr += c.textContent || '';
      else if (c.localName === 't') {
        if (fieldStack.some((f) => f.result && DOCX_FURNITURE_FIELD_RE.test(f.instr))) continue;
        let anc = r.parentNode, inSimple = false;
        while (anc && anc !== p) { if (anc.namespaceURI === W && anc.localName === 'fldSimple' && DOCX_FURNITURE_FIELD_RE.test(anc.getAttributeNS(W, 'instr') || '')) { inSimple = true; break; } anc = anc.parentNode; }
        if (!inSimple) out += c.textContent || '';
      }
    }
  }
  return out;
}
async function docxLeftOut(arrayBuffer, W) {
  const n = { comments: 0, headers: 0, footers: 0 };
  let entries;
  try { entries = listZipEntries(arrayBuffer); } catch { return n; }
  const dec = new TextDecoder();
  const readDoc = async (name) => { try { return parseXml(dec.decode(await unzipEntry(arrayBuffer, name))); } catch { return null; } };
  const partTexts = (d) => [...d.getElementsByTagNameNS(W, 'p')].map((p) => docxPartText(p, W)).join(' ');
  if (entries.some((e) => e.name === 'word/comments.xml')) {
    const d = await readDoc('word/comments.xml');
    if (d) n.comments = [...d.getElementsByTagNameNS(W, 'comment')].filter((c) => isRealLeftOutText(partTexts(c))).length;
  }
  const hdr = [], ftr = [];
  for (const e of entries) {
    const m = /^word\/(header|footer)\d*\.xml$/.exec(e.name);
    if (!m) continue;
    const d = await readDoc(e.name);
    if (d) (m[1] === 'header' ? hdr : ftr).push(partTexts(d));
  }
  n.headers = countDistinctRealTexts(hdr);
  n.footers = countDistinctRealTexts(ftr);
  return n;
}
// IMP-W1 (Paul, 30 Sep 2026): a Subtitle is the second line of the Title's own heading. A title block that can take one: a plain one (its
// text, or a single plain text segment). The merged title keeps `text` with a '\n' (what the formatter centres line by line) and a
// plain `segments` copy of it, which is what the editor shows (a block with no segments has its line break collapsed to a space there).
export function titleTakesSubtitle(b) {
  return !!(b && b.type === 'title' && (!b.segments || (b.segments.length === 1 && b.segments[0].type === 'text' && !b.segments[0].tf && !b.segments[0].href)));
}
export function mergeSubtitleIntoTitle(b, subtitleText) {
  b.text = `${b.text}\n${subtitleText}`;
  b.segments = [{ type: 'text', text: b.text }];
}
// IMP-W6 (Paul, 30 Sep 2026): what stands in a table cell where a nested table was; the nested table follows the outer table as a
// table of its own. Shared by every reader that reads nested tables.
export const NESTED_TABLE_PLACEHOLDER = '(table follows)';

// docx-fix item 7: true if `p` contains a Shift+Enter line break — `<w:br/>` with no
// `w:type` at all, or `w:type="textWrapping"` (Word's own two spellings for the same thing;
// `w:type="page"`/`"column"` are a real page/column break and stay exactly as before, i.e.
// ignored). getRunText (above) still folds any w:br to a single space for the PLAIN text
// path (paragraphRunText/a heading's own `text`) — deliberately unchanged, matching how a
// print reader would read the words if spoken as one flowing line — but the segmented/
// block-level path below now keeps each line separate instead of running them together.
function docxHasShiftBreak(p, W) {
  if (!p.getElementsByTagNameNS) return false;
  for (const br of p.getElementsByTagNameNS(W, 'br')) {
    if (isInsideTxbxContent(br, p, W)) continue;              // a text box's own line breaks are handled by its own paragraph walk
    const t = br.getAttributeNS(W, 'type');
    if (!t || t === 'textWrapping') return true;
  }
  return false;
}
// IMP-W2: a paragraph style that is a poem / verse style (id or display name, along its w:basedOn chain, contains poem, poetry,
// verse or lyric — any case): the one place a Shift+Enter break still splits the paragraph into verse lines.
function docxIsVerseStyle(styleId, styleMap) {
  if (!styleId) return false;
  return docxStyleFamilies(styleId, styleMap).some((fam) => /poem|poetry|verse|lyric/.test(fam));
}
// IMP-W2: paragraphSegments with each Shift+Enter break kept as a '\n' in the run text (getRunText reads it as a space otherwise).
let DOCX_KEEP_LINE_BREAKS = false;
function paragraphSegmentsKeepingBreaks(p, W, rels, R, noteMarks, charStyles, legacyEq) {
  DOCX_KEEP_LINE_BREAKS = true;
  try { return paragraphSegments(p, W, rels, R, noteMarks, charStyles, legacyEq); } finally { DOCX_KEEP_LINE_BREAKS = false; }
}
// IMP-W2: tidy the '\n' breaks in a paragraph's segments — spaces either side of a break dropped, a run of breaks (an empty line)
// one break, a break at the very start or end of the paragraph dropped. Each break is a plain text segment of its own ('\n', no
// emphasis), so no bold/italic/underline is carried onto the line end.
export function tidyForcedBreakSegments(segments) {
  const out = [];
  let pending = false;
  const trimTail = () => {
    while (out.length) {
      const l = out[out.length - 1];
      if (l.type !== 'text' || typeof l.text !== 'string') return;
      l.text = l.text.replace(/[ \t]+$/, '');
      if (l.text === '') out.pop(); else return;
    }
  };
  const flush = () => {
    if (pending && out.length) { trimTail(); if (out.length) out.push({ type: 'text', text: '\n' }); }
    pending = false;
  };
  for (const seg of segments) {
    if (!seg || seg.type !== 'text' || typeof seg.text !== 'string') { flush(); out.push(seg); continue; }
    seg.text.split('\n').forEach((part, k) => {
      if (k > 0) pending = true;
      if (pending) part = part.replace(/^[ \t]+/, '');
      if (!part) return;
      flush();
      out.push(k === 0 && seg.text === part ? seg : { ...seg, text: part });
    });
  }
  return out;
}
// docx-fix item 7: split `p`'s direct children into "lines" at each Shift+Enter `<w:br>`.
// A `<w:br>` is nested one level inside a `<w:r>` (unlike HTML's `<br>`, which sits as a
// direct child of `<p>` — see pushVerseLines, above, which this mirrors for docx), and Word
// can put text before AND after the break in the very SAME run (`<w:r><w:t>a</w:t><w:br/>
// <w:t>b</w:t></w:r>`) as well as as a run of its own — so a run that contains a break is
// itself split into two synthetic runs (shallow clones of the original `<w:r>`, so its own
// rPr/formatting carries to both halves) rather than assuming the break always has a run to
// itself. Returns an array of node arrays, one per line, in document order.
function docxSplitParagraphAtBreaks(p, W) {
  const lines = [[]];
  for (const child of p.childNodes || []) {
    if (child.nodeType !== 1) { continue; }
    if (child.namespaceURI === W && child.localName === 'r') {
      const kids = [...child.childNodes];
      let segStart = 0, sawBreak = false;
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        const isBreak = k.nodeType === 1 && k.namespaceURI === W && k.localName === 'br'
          && (!k.getAttributeNS(W, 'type') || k.getAttributeNS(W, 'type') === 'textWrapping');
        if (!isBreak) continue;
        const before = kids.slice(segStart, i);
        if (before.length) {
          const rClone = child.cloneNode(false);
          for (const n of before) rClone.appendChild(n.cloneNode(true));
          lines[lines.length - 1].push(rClone);
        }
        lines.push([]);
        segStart = i + 1;
        sawBreak = true;
      }
      if (sawBreak) {
        const after = kids.slice(segStart);
        if (after.length) {
          const rClone = child.cloneNode(false);
          for (const n of after) rClone.appendChild(n.cloneNode(true));
          lines[lines.length - 1].push(rClone);
        }
        continue;
      }
    }
    lines[lines.length - 1].push(child);
  }
  return lines;
}

// A45/D3: word/footnotes.xml and word/endnotes.xml hold the note bodies referenced from
// the body by w:id — parseDocx never opened either part before this, so a
// <w:footnoteReference>/<w:endnoteReference> had nowhere to resolve to even once the
// reference mark itself (above) stopped being silently dropped. w:id -1/0/1 are Word's own
// separator/continuationSeparator/continuationNotice pseudo-notes (marked by @w:type, never
// real content) and are skipped, matching what a reader actually sees. Multi-paragraph
// notes keep each <w:p> as its own paragraph block (blk.blocks), the same shape
// parseDtbook's own pushNote builds for a multi-<p> DTBook <note> (F-113/BANA 16.5.1d).
async function parseDocxNotesPart(arrayBuffer, W, R, partName, relsPartName, idPrefix, charStyles = null, legacyEq = null) {
  const map = new Map();
  let xml;
  try { xml = new TextDecoder().decode(await unzipEntry(arrayBuffer, partName)); }
  catch { return map; }
  let doc; try { doc = parseXml(xml); } catch { return map; }
  const rels = await parseDocxRelationships(arrayBuffer, relsPartName);
  const tag = idPrefix === 'docx-en-' ? 'endnote' : 'footnote';
  for (const noteEl of doc.getElementsByTagNameNS(W, tag)) {
    const wid = noteEl.getAttributeNS(W, 'id');
    if (wid == null || wid === '' || noteEl.getAttributeNS(W, 'type')) continue;   // separator/etc pseudo-notes
    // Import fix list #1b / #1c: the note's paragraphs in reading order — including those inside a table, a content
    // control or a tracked insertion, which the old direct-children filter missed (a note cannot hold a table, so a
    // table's cells come through as paragraphs, row by row, cell by cell: no text is lost).
    const paras = docxContainerParas(noteEl, W);
    const paraBlock = (p) => {
      const t = paragraphRunText(p, W, charStyles).replace(/\s+/g, ' ').trim();
      // A footnote/endnote paragraph holding ONLY an equation (or only a legacy-equation
      // placeholder) has no w:t at all — paragraphRunText only reads w:t, so `t` alone
      // used to gate this whole paragraph out before the equation was ever looked at, and
      // even when there WAS other text, the old `s.tf || s.href` hasSeg check dropped an
      // inline equation/placeholder silently (segments were computed but never used).
      const hasMath = p.getElementsByTagNameNS(MATH_NS, 'oMath').length > 0;
      const segs = paragraphSegments(p, W, rels, R, null, charStyles, legacyEq);
      const hasSeg = !!(segs.length && (hasMath || segs.some((s) => s.tf || s.href || s.type === 'imgnote' || s.type === 'math' || s.type === 'linenum' || s.uncontracted || s.transcriberTypeform || s.lang)));
      if (!t && !hasSeg) return null;
      return hasSeg ? { type: 'para', text: t, segments: segs } : { type: 'para', text: t };
    };
    if (paras.length > 1) {
      const blocks = paras.map(paraBlock).filter(Boolean);
      if (blocks.length) map.set(wid, { blocks });
    } else if (paras.length === 1) {
      const blk = paraBlock(paras[0]);
      if (blk) map.set(wid, blk.segments ? { text: blk.text, segments: blk.segments } : { text: blk.text });
    }
  }
  return map;
}

// docx-fix item 6: the auto-number FORMAT for footnotes/endnotes (lowerRoman, upperRoman,
// lowerLetter, chicago, …) — Word writes this on `w:footnotePr`/`w:endnotePr`'s own
// `w:numFmt`, either on a section's `w:sectPr` (that section's own override) or, as the
// document-wide default, in `word/settings.xml`. Emboss has no per-section model, so the
// LAST `w:sectPr` in the body (the common single-section case, and Word's own "final
// section's settings win" convention) is checked first; settings.xml is the fallback when a
// section doesn't set its own. Missing either part, or no footnotePr/endnotePr/numFmt at
// all, leaves the format null — formatNoteNum's own default (plain decimal) then applies,
// unchanged from before this fix.
async function parseDocxNoteNumFmts(arrayBuffer, W, doc) {
  const readFmt = (scope, tag) => {
    const el = scope && scope.getElementsByTagNameNS(W, tag)[0];
    return el ? (el.getElementsByTagNameNS(W, 'numFmt')[0]?.getAttributeNS(W, 'val') || null) : null;
  };
  const sectPrs = doc.getElementsByTagNameNS(W, 'sectPr');
  const sectPr = sectPrs[sectPrs.length - 1];
  let fnFmt = readFmt(sectPr, 'footnotePr');
  let enFmt = readFmt(sectPr, 'endnotePr');
  if (fnFmt == null || enFmt == null) {
    try {
      const sdoc = parseXml(new TextDecoder().decode(await unzipEntry(arrayBuffer, 'word/settings.xml')));
      if (fnFmt == null) fnFmt = readFmt(sdoc, 'footnotePr');
      if (enFmt == null) enFmt = readFmt(sdoc, 'endnotePr');
    } catch { /* no settings.xml part: leave the format null (formatNoteNum's own decimal default) */ }
  }
  return { fnFmt, enFmt };
}

// After a heading/paragraph/list's segments are finalised, emit the <note>/<footnote>
// block for every not-yet-seen noteref they carry, right after — the same "note sits where
// it's referenced" placement a real DTBook document uses (A45/D3; avoids A44/D6's mistake
// of merging a note's text into the surrounding sentence instead of keeping it a separate,
// clearly-bounded block).
// S5D-Q4 (Paul, 17 Oct 2026): Word writes a custom mark (w:customMarkFollows: "*", "i", a dagger) as the first run of the
// note's own text as well as after the reference. The reference keeps the mark; here it is taken off the front of the note's
// text, with the space after it. `units` is a list of { text, segments? } (the note's one paragraph, or its first). Only a
// mark that really starts the text is dropped; a note that does not repeat its mark is left as it is.
function dropLeadingNoteMark(unit, mark) {
  const m = String(mark || '');
  if (!m || !unit) return unit;
  const esc = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^[\\s\\uE000\\uE001]*${esc}(?:\\uE002\\s*|\\s+|$)`);   // the mark is a word of its own: "i" does not take the "i" off "in the beginning"
  const cut = (str) => { const r = re.exec(str); return r && r[0].length ? str.slice(r[0].length) : null; };
  if (Array.isArray(unit.segments) && unit.segments.length) {
    const flat = unit.segments.map((g) => (g && g.type === 'text' ? g.text || '' : '\u0000')).join('');
    const hit = re.exec(flat);
    if (!hit) return unit;
    let drop = hit[0].length;
    const segments = [];
    for (const g of unit.segments) {
      const len = g && g.type === 'text' ? (g.text || '').length : 1;
      if (drop >= len) { drop -= len; continue; }
      segments.push(drop && g.type === 'text' ? { ...g, text: g.text.slice(drop) } : g);
      drop = 0;
    }
    const text = cut(unit.text || '');
    return { ...unit, text: text == null ? unit.text : text, segments };
  }
  const text = cut(unit.text || '');
  return text == null ? unit : { ...unit, text };
}
function collectNoteBlocks(segs, seen, footnoteMap, endnoteMap) {
  const out = [];
  for (const s of segs || []) {
    if (!s || s.type !== 'noteref' || !s.idref || seen.has(s.idref)) continue;
    seen.add(s.idref);
    const isEndnote = s.idref.startsWith('docx-en-');
    const wid = s.idref.slice(isEndnote ? 'docx-en-'.length : 'docx-fn-'.length);
    let entry = (isEndnote ? endnoteMap : footnoteMap).get(wid);
    if (!entry) continue;
    if (footnoteMap.customIds && footnoteMap.customIds.has(s.idref) && s.text) {   // S5D-Q4: a custom mark is the reference's, not also the note's first word
      if (Array.isArray(entry.blocks)) {
        const first = dropLeadingNoteMark(entry.blocks[0], s.text);
        entry = { ...entry, blocks: first === entry.blocks[0] ? entry.blocks : [first, ...entry.blocks.slice(1)].filter((b) => b && (b.text || (b.segments && b.segments.length))) };
      } else entry = dropLeadingNoteMark(entry, s.text);
    }
    const blk = Array.isArray(entry.blocks) ? { type: 'footnote', blocks: entry.blocks } : { type: 'footnote', text: entry.text, ...(entry.segments ? { segments: entry.segments } : {}) };
    blk.id = s.idref;
    if (isEndnote) blk.kind = 'endnote';
    out.push(blk);
  }
  return out;
}

// A45/D2: shared by parseDocx and parseOdt — every `{type:'graphic'}` block anywhere in
// the model (collectGraphics already walks nested boxes/list-items/table cells generically)
// has its `src` resolved from a raw, format-specific reference (a docx relationship Target,
// relative to word/; an odt xlink:href, already package-root-relative) into real bytes plus
// a package-relative path, exactly the shape parseNimasZip already builds for a NIMAS
// package's own images (model.resources: [{path, mime, bytes}], graphic.src → that path —
// see parseNimasZip below and editor.mjs's setLoadedDocInfo, which already turns
// model.resources into <img> object URLs). Carrying the real bytes (not just a placeholder)
// is deliberate: Emboss's editor displays a graphic block's own image, and tactile-graphics
// work needs the actual picture, not just alt text — see this task's own final report for
// why a decorative-but-heavy corpus file (hundreds of images, mostly inside table cells —
// D8, unaffected by this fix) was an acceptable tradeoff rather than a reason to drop bytes
// project-wide. An image whose bytes can't be found (an external/broken reference) keeps
// its block — alt text and all — with no resource entry, never silently disappearing.
async function embedGraphicResources(arrayBuffer, blocks, resolvePath) {
  const resources = [];
  const seen = new Map();
  for (const g of collectGraphics(blocks)) {
    const raw = g.src || '';
    if (!raw || /^(data:|https?:|blob:|cid:)/i.test(raw)) continue;
    const path = normalizeHref(raw);
    if (!path) continue;
    if (seen.has(path)) { g.src = seen.get(path).path; continue; }
    let bytes;
    try { bytes = new Uint8Array(await unzipEntry(arrayBuffer, resolvePath(path))); }
    catch { continue; }                                    // keep the block (alt text and all); no resource to attach
    // WMF/EMF/DIB: a Windows metafile or bare device-independent bitmap has no native
    // web-displayable form at all — converted exactly the way the RTF/.doc readers already
    // do (metafile.mjs's metafileToSvg/dibToPngBytes; see doc.mjs's own finishResource),
    // rather than embedding bytes the editor could never render as an <img>/<svg>. A
    // metafile/DIB that fails to convert (metafileToSvg/dibToPngBytes returns null) falls
    // through to the SAME "no resource, block kept (alt text and all)" behaviour as an
    // unresolvable image, above.
    let finalPath = path, mime = mimeForPath(path);
    const ext = (path.split('.').pop() || '').toLowerCase();
    if (ext === 'wmf' || ext === 'emf') {
      const svg = metafileToSvg(bytes);
      if (!svg) continue;
      bytes = new TextEncoder().encode(svg);
      finalPath = path.replace(/\.[^./]+$/, '.svg');
      mime = 'image/svg+xml';
    } else if (ext === 'dib') {
      const png = dibToPngBytes(bytes);
      if (!png) continue;
      bytes = png;
      finalPath = path.replace(/\.[^./]+$/, '.png');
      mime = 'image/png';
    }
    const resource = { path: finalPath, mime, bytes };
    resources.push(resource);
    seen.set(path, resource);
    g.src = finalPath;
  }
  return resources;
}

// A48/D1: word/styles.xml is where a paragraph style's real identity lives — an
// organisation's own style (`PHEHeading`, `TitleGrey`, …) very often shares no naming
// convention with Word's own `Heading1`-`Heading9` ids, but Word still records the
// paragraph's outline level in the style's own `w:pPr/w:outlineLvl` (0-based: 0 =
// Heading 1) and/or a `w:basedOn` chain back to a built-in style. Missing → an empty
// Map, so a docx with no styles.xml at all (a hand-built test fixture, or a genuinely
// minimal document) falls back to parseDocx's original id-only checks, unchanged.
// docx-fix item 10: docProps/core.xml (OPC's own package metadata part — cp:coreProperties,
// dc:title/dc:creator from the Dublin Core namespace) is a fallback source for a document's
// title/author when the body itself has none, same convention parseEpub's own OPF metadata
// reader and parseDtbook's dc:title/dc:creator meta tags already use (see parseDtbookXml's
// `lname === 'dc:title'`/`'dc:creator'` cases, and dtbookMetadataFromOpf). No namespace
// prefix assumption on the element lookup (`getElementsByTagNameNS('*', …)`): real files use
// "dc:title"/"dc:creator" but the prefix itself isn't guaranteed.
async function parseDocxCoreProps(arrayBuffer) {
  let xml;
  try { xml = new TextDecoder().decode(await unzipEntry(arrayBuffer, 'docProps/core.xml')); }
  catch { return null; }                                   // no core.xml part
  let doc; try { doc = parseXml(xml); } catch { return null; }
  const textOf = (ln) => {
    const el = doc.getElementsByTagNameNS('*', ln)[0];
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  };
  const title = textOf('title');
  const creator = textOf('creator');
  return (title || creator) ? { title: title || null, creator: creator || null } : null;
}

async function parseDocxStyles(arrayBuffer, W) {
  const map = new Map();                                // id (lowercased) -> {id, name, basedOn, outlineLvl, numId, ilvl, tabs, vanish, specVanish, vertAlign, caps, smallCaps, strike, dstrike}
  let xml;
  try { xml = new TextDecoder().decode(await unzipEntry(arrayBuffer, 'word/styles.xml')); }
  catch { return map; }                                  // no styles.xml part
  let doc; try { doc = parseXml(xml); } catch { return map; }
  for (const styleEl of doc.getElementsByTagNameNS(W, 'style')) {
    if ((styleEl.getAttributeNS(W, 'type') || 'paragraph') !== 'paragraph') continue;
    const id = styleEl.getAttributeNS(W, 'styleId') || '';
    if (!id) continue;
    const name = styleEl.getElementsByTagNameNS(W, 'name')[0]?.getAttributeNS(W, 'val') || '';
    const basedOn = styleEl.getElementsByTagNameNS(W, 'basedOn')[0]?.getAttributeNS(W, 'val') || '';
    const pPr = styleEl.getElementsByTagNameNS(W, 'pPr')[0];
    const outlineEl = pPr ? pPr.getElementsByTagNameNS(W, 'outlineLvl')[0] : null;
    const outlineRaw = outlineEl ? Number(outlineEl.getAttributeNS(W, 'val')) : NaN;
    // docx-fix item 1: a Heading style's own numbering default (Word's Multilevel List ›
    // "Link Level to Style" writes this on the STYLE, not on every paragraph that uses it) —
    // read here so paragraphNumPr/resolveStyleNumPr (below) can find it by walking basedOn.
    const styleNumPr = pPr ? pPr.getElementsByTagNameNS(W, 'numPr')[0] : null;
    const numId = styleNumPr ? styleNumPr.getElementsByTagNameNS(W, 'numId')[0]?.getAttributeNS(W, 'val') ?? null : null;
    const ilvl = styleNumPr ? Number(styleNumPr.getElementsByTagNameNS(W, 'ilvl')[0]?.getAttributeNS(W, 'val') || 0) || 0 : 0;
    // docx-fix items 4/5: a style's own tab stops (e.g. a custom "Contents 1" style based on
    // TOC1, or a house style used for manual dot-leader lines) — resolveStyleTabs (below)
    // walks basedOn the same way, for a paragraph with no w:pPr/w:tabs of its own.
    const tabsEl = pPr ? pPr.getElementsByTagNameNS(W, 'tabs')[0] : null;
    const tabs = tabsEl ? [...tabsEl.getElementsByTagNameNS(W, 'tab')].map((t) => ({
      val: t.getAttributeNS(W, 'val') || '', leader: t.getAttributeNS(W, 'leader') || '', pos: Number(t.getAttributeNS(W, 'pos')) || 0,
    })) : [];
    // docx-parity item 3: a PARAGRAPH style's own `<w:rPr>` (a sibling of `<w:pPr>`, direct
    // child of `<w:style>` — Word's "add to this style" run-level defaults, e.g. a "Hidden
    // Note"/"Redline" paragraph style whose whole body is vanish, or a "Superscript Caption"
    // paragraph style) — read the same tri-state way parseDocxCharStyles reads a CHARACTER
    // style's rPr, so runVanish/runScript/runCapsSmallCaps/runStrike can fall back to it via
    // paraStyleFlag, walking this SAME basedOn chain.
    const styleRPr = firstChildNS(styleEl, W, 'rPr');
    const tog = (ln) => { const e = styleRPr && firstChildNS(styleRPr, W, ln); if (!e) return null; const v = e.getAttributeNS(W, 'val'); return v == null || (v !== 'false' && v !== '0' && v !== 'none'); };
    const va = styleRPr && firstChildNS(styleRPr, W, 'vertAlign');
    const vaVal = va && (va.getAttributeNS(W, 'val') || '').toLowerCase();
    const vertAlign = vaVal === 'subscript' ? 'sub' : vaVal === 'superscript' ? 'sup' : null;
    map.set(id.toLowerCase(), {
      id, name, basedOn, outlineLvl: Number.isFinite(outlineRaw) ? outlineRaw : null, numId, ilvl, tabs,
      vanish: tog('vanish'), specVanish: tog('specVanish'), vertAlign, font: styleRFont(styleRPr),
      caps: tog('caps'), smallCaps: tog('smallCaps'), strike: tog('strike'), dstrike: tog('dstrike'),
    });
  }
  return map;
}

// docx-parity item 3: styles.xml's own `w:docDefaults/w:rPrDefault/w:rPr` — the run-level
// defaults every paragraph/character style (and so every run) ultimately falls back to when
// NOTHING in its own chain sets a given property at all (Word always writes this element,
// but real documents vary in what it actually sets). Read once per document; a missing/
// unreadable styles.xml or docDefaults part yields an all-null/false object, the same
// "nothing to fall back to" result an empty styles.xml would give runVanish/runScript/etc.
async function parseDocxRunDefaults(arrayBuffer, W) {
  const empty = { vanish: false, specVanish: false, vertAlign: null, caps: false, smallCaps: false, strike: false, dstrike: false };
  let xml;
  try { xml = new TextDecoder().decode(await unzipEntry(arrayBuffer, 'word/styles.xml')); }
  catch { return empty; }
  let doc; try { doc = parseXml(xml); } catch { return empty; }
  const docDefaults = doc.getElementsByTagNameNS(W, 'docDefaults')[0];
  const rPrDefault = docDefaults && firstChildNS(docDefaults, W, 'rPrDefault');
  const rPr = rPrDefault && firstChildNS(rPrDefault, W, 'rPr');
  if (!rPr) return empty;
  const tog = (ln) => { const e = firstChildNS(rPr, W, ln); if (!e) return false; const v = e.getAttributeNS(W, 'val'); return v == null || (v !== 'false' && v !== '0' && v !== 'none'); };
  const va = firstChildNS(rPr, W, 'vertAlign');
  const vaVal = va && (va.getAttributeNS(W, 'val') || '').toLowerCase();
  return {
    vanish: tog('vanish'), specVanish: tog('specVanish'),
    vertAlign: vaVal === 'subscript' ? 'sub' : vaVal === 'superscript' ? 'sup' : null,
    caps: tog('caps'), smallCaps: tog('smallCaps'), strike: tog('strike'), dstrike: tog('dstrike'),
  };
}

// docx-fix item 1: a paragraph's own numbering — its direct w:pPr/w:numPr, or (task: "directly
// or via style") inherited from its paragraph style's own pPr/numPr default, resolved by
// walking styles.xml's w:basedOn chain exactly like classifyDocxStyle does. An explicit
// `<w:numId w:val="0"/>` directly on the paragraph is Word's own "remove numbering from this
// paragraph" override and always wins, even when the style itself defines numbering.
function resolveStyleNumPr(styleId, styleMap) {
  if (!styleId) return null;
  let id = String(styleId).toLowerCase();
  const seen = new Set();
  while (id && !seen.has(id) && seen.size < 20) {
    seen.add(id);
    const st = styleMap.get(id);
    if (!st) break;
    if (st.numId != null) return { numId: st.numId, ilvl: st.ilvl || 0 };
    id = (st.basedOn || '').toLowerCase();
  }
  return null;
}
function paragraphNumPr(p, W, styleId, styleMap) {
  const numPr = p.getElementsByTagNameNS(W, 'numPr')[0];
  if (numPr) {
    const numId = numPr.getElementsByTagNameNS(W, 'numId')[0]?.getAttributeNS(W, 'val');
    if (numId === '0') return null;                      // explicit "no numbering" override
    if (numId != null) {
      const ilvl = Number(numPr.getElementsByTagNameNS(W, 'ilvl')[0]?.getAttributeNS(W, 'val') || 0) || 0;
      return { numId, ilvl };
    }
  }
  return resolveStyleNumPr(styleId, styleMap);
}

// docx-fix items 4/5: a paragraph's own tab stops (w:pPr/w:tabs), or — same basedOn-chain
// fallback as paragraphNumPr — the nearest style in its chain that defines any at all.
function resolveStyleTabs(styleId, styleMap) {
  if (!styleId) return [];
  let id = String(styleId).toLowerCase();
  const seen = new Set();
  while (id && !seen.has(id) && seen.size < 20) {
    seen.add(id);
    const st = styleMap.get(id);
    if (!st) break;
    if (st.tabs && st.tabs.length) return st.tabs;
    id = (st.basedOn || '').toLowerCase();
  }
  return [];
}
function paragraphTabs(p, W, styleId, styleMap) {
  const pPr = p.getElementsByTagNameNS(W, 'pPr')[0];
  const tabsEl = pPr ? pPr.getElementsByTagNameNS(W, 'tabs')[0] : null;
  if (tabsEl) {
    const tabs = [...tabsEl.getElementsByTagNameNS(W, 'tab')].map((t) => ({
      val: t.getAttributeNS(W, 'val') || '', leader: t.getAttributeNS(W, 'leader') || '', pos: Number(t.getAttributeNS(W, 'pos')) || 0,
    }));
    if (tabs.length) return tabs;
  }
  return resolveStyleTabs(styleId, styleMap);
}
const hasDotLeaderTab = (tabs) => (tabs || []).some((t) => t.leader === 'dot');

// docx-fix items 4/5: a variant of paragraphRunText (same run-walk/guards) that keeps a
// literal w:tab as a real tab character instead of collapsing it to a space, so a contents
// entry ("Introduction<TAB>1") or a TOC1-9 paragraph's own entry-text/page-number columns can
// be split at the LAST tab — the print column break a dot-leader tab stop marks. No tab at
// all -> `after` is null (caller keeps the single-space behaviour it already has).
function paragraphTextTabSplit(p, W, charStyles = null) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  let text = '';
  let cur = null;
  for (const r of p.getElementsByTagNameNS(W, 'r')) {
    if (isInsideTxbxContent(r, p, W)) continue;
    if (isInsideMoveFrom(r, p, W)) continue;
    if (isInsideRuby(r, p, W)) continue;
    if (isInsideRejectedMcBranch(r, p) || isInsideUnfilledSdt(r, p, W)) continue;   // import fix list #15d / #2
    if (runVanish(r, W, charStyles)) continue;
    let runText = '';
    for (const child of r.childNodes || []) {
      if (child.nodeType === 1 && child.namespaceURI === W) {
        if (child.localName === 't') runText += symbolFontText(r, W, child.textContent);
        else if (child.localName === 'fldChar') runText += docxFormFieldText(child, W) ?? '';   // #51
        else if (child.localName === 'tab') runText += '\t';
        else if (child.localName === 'br' || child.localName === 'cr') runText += ' ';
        else if (child.localName === 'noBreakHyphen') runText += '-';
        else if (child.localName === 'sym') runText += wordSymGlyph(child.getAttributeNS(W, 'font') || '', child.getAttributeNS(W, 'char') || '');
      }
    }
    if (!runText) continue;
    const capsInfo = runCapsSmallCaps(r, W, charStyles);
    if (capsInfo.caps || capsInfo.smallCaps) runText = runText.toUpperCase();
    // A raised or lowered run of spaces only (Word raises the space before a footnote number) marks nothing (30 Sep).
    const script = /\S/.test(runText) ? runScript(r, W, charStyles) : cur;
    if (script !== cur) {
      if (cur) text += end;
      if (script) text += script === 'sub' ? subOpen : supOpen;
      cur = script;
    }
    text += runText;
  }
  if (cur) text += end;
  const i = text.lastIndexOf('\t');
  if (i < 0) return { before: text.replace(/\s+/g, ' ').trim(), after: null };
  return { before: text.slice(0, i).replace(/\s+/g, ' ').trim(), after: text.slice(i + 1).replace(/\s+/g, ' ').trim() };
}

// A48/D1: resolve a paragraph's own style id to {kind:'heading', level} | {kind:'title'} |
// null, walking styles.xml's w:basedOn chain. Precedence, worked out against the real G4
// corpus (template-framework-document-executive-agencies.docx — see the task's own final
// report for the counts this produced):
//   1. an explicit w:outlineLvl (0-8) on the NEAREST style in the chain that sets one at
//      all — Word's own inheritance rule (a style that doesn't set it inherits its
//      resolved parent's), and the most reliable signal there is (it's what Word's own
//      Navigation pane / TOC use). Word's sentinel value 9 ("Body Text — no real outline
//      level") is deliberately never treated as a heading — the corpus's own default
//      styles use it on ordinary body-text styles, and treating it as "level 10" would
//      silently turn body text into headings document-wide.
//   2. failing that, a built-in Heading1-9/Title/Subtitle id anywhere in the chain (very
//      common: a custom style is based on a built-in heading, directly or through an
//      intermediate custom style — e.g. this corpus's TitlePage2 -> TitleGrey -> Title).
//   3. failing that, the style's OWN name (never an ancestor's, so a name match can't leak
//      across an unrelated chain) against Word's own default display name ("heading 1",
//      "Title", "Subtitle") — catches a style Word (or an author) renamed on copy without
//      keeping the id, or a hand-edited custom id that kept the stock name.
//   4. Title only, as a last resort: the style's own name contains the whole word "title"
//      anywhere (e.g. "PHE Front Page Main Title", "Cover Title" — both real corpus style
//      names). Checked against every paragraph style actually used across all three real
//      DOCX corpus files: nothing that is NOT a document/section title contains "title" in
//      its name. Deliberately NOT extended to headings — the same corpus's own
//      `TableHeading`/`ColumnHeading`/`BoxHeading`/`FigureHeading`/`AnnexTableHeading` etc.
//      style names all contain "Heading" and are caption styles for a table/figure/box, not
//      document structure — a loose "contains heading" match would wrongly promote one of
//      those to a document heading the moment a real file used it at body level.
// A style with none of the above (e.g. this corpus's `AnnexHeading`/`HeadingSpacer` — no
// outlineLvl, not based on a built-in heading or Title, and a name that doesn't match the
// strict "heading N" pattern) is deliberately left as an ordinary paragraph rather than
// guessed at: a missed heading loses less than a false one, which corrupts the braille page
// structure — see the task's own final report for exactly which real-corpus styles this
// leaves unrecovered, and why.
function classifyDocxStyle(styleId, styleMap) {
  if (!styleId) return null;
  // K6: Word's own built-in "Quote" / "Intense Quote" paragraph style (styleId 'quote' /
  // 'intensequote', or a style whose declared name is exactly that) is Emboss's
  // displayed-quotation block (BANA §9). Checked directly on the style itself, not walked
  // up a basedOn chain like heading/title below — a quote style is ordinarily based on
  // Normal, with nothing above it worth checking, and walking up risks a false match on
  // an unrelated style further up the chain.
  const st0First = styleMap.get(String(styleId).toLowerCase());
  // Audit w10: Word's "Block Text" style is a block quotation exactly as "Quote" is.
  if (/^(quote|intensequote|blocktext)$/i.test(String(styleId)) || (st0First && /^(quote|intense quote|block text)$/i.test(st0First.name || ''))) return { kind: 'quote' };
  let id = String(styleId).toLowerCase();
  const seen = new Set();
  let first = true;
  while (id && !seen.has(id) && seen.size < 20) {
    seen.add(id);
    const st = styleMap.get(id);
    if (!st) break;
    if (Number.isFinite(st.outlineLvl) && st.outlineLvl >= 0 && st.outlineLvl <= 8) {
      return { kind: 'heading', level: st.outlineLvl + 1 };
    }
    const hm = /^heading([1-9])/i.exec(st.id);
    if (hm) return { kind: 'heading', level: Number(hm[1]) };
    if (/^(title|subtitle)$/i.test(st.id)) return { kind: 'title', subtitle: /^subtitle$/i.test(st.id) };   // IMP-W1: a Subtitle goes with its Title
    if (first) {
      const nameHm = /^heading\s*([1-9])\b/i.exec(st.name || '');
      if (nameHm) return { kind: 'heading', level: Number(nameHm[1]) };
      if (/^(title|subtitle)$/i.test(st.name || '')) return { kind: 'title', subtitle: /^subtitle$/i.test(st.name || '') };
    }
    first = false;
    id = (st.basedOn || '').toLowerCase();
  }
  const st0 = styleMap.get(String(styleId).toLowerCase());
  if (st0 && /\btitle\b/i.test(st0.name || '')) return { kind: 'title' };
  // Audit w10: a style that IS (or is based on, through w:basedOn) one of Word's quotation styles is a block quotation;
  // one of its computer-text styles ("Source Code", "HTML Preformatted", "Plain Text", "Macro Text") is a code block —
  // the block the HTML reader makes for <pre>. Ids and names are matched without case or spaces. Headings and titles
  // (above) still win over these.
  for (const fam of docxStyleFamilies(styleId, styleMap)) {
    if (/^(quote|intensequote|blocktext)$/.test(fam)) return { kind: 'quote' };
    if (/^(sourcecode|htmlpreformatted|plaintext|macrotext)$/.test(fam)) return { kind: 'code' };
  }
  return null;
}
// Every id and name, lower-cased with spaces removed, along a paragraph style's basedOn chain (nearest first).
function docxStyleFamilies(styleId, styleMap) {
  const out = [];
  let id = String(styleId || '').toLowerCase();
  const seen = new Set();
  while (id && !seen.has(id) && seen.size < 20) {
    seen.add(id);
    out.push(id.replace(/\s+/g, ''));
    const st = styleMap.get(id);
    if (!st) break;
    if (st.name) out.push(String(st.name).toLowerCase().replace(/\s+/g, ''));
    id = (st.basedOn || '').toLowerCase();
  }
  return out;
}

// A48: a paragraph's OWN w:pPr/w:outlineLvl (as opposed to its style's — see
// classifyDocxStyle above) is a direct, explicit author override and always wins, same
// 0-8/9-is-body-text rule as the style-level check.
function paragraphOutlineLvl(p, W) {
  const pPr = p.getElementsByTagNameNS(W, 'pPr')[0];
  const el = pPr ? pPr.getElementsByTagNameNS(W, 'outlineLvl')[0] : null;
  if (!el) return null;
  const val = Number(el.getAttributeNS(W, 'val'));
  return Number.isFinite(val) && val >= 0 && val <= 8 ? val : null;
}

// A51: a Word content control (<w:sdt>, "structured document tag" — a cover-page title
// placeholder, a TOC field, a template author's locked-down boilerplate block) wraps
// ordinary body content in <w:sdtContent>, and until this fix the block-level body walk
// below only recognised a fixed set of element names (oMathPara/oMath, tbl, p) — an
// <w:sdt> matched none of them and fell through the `if (ln !== 'p') continue;` gate,
// silently dropping every paragraph, image and table inside it. Fixes that by flattening
// <w:sdt> out of the body's (and any table cell's) child list before the walk ever sees
// it, splicing <w:sdtContent>'s own children in at the same position — so a wrapped
// paragraph/table/image is processed exactly as if the wrapping control weren't there.
// Recurses so nested content controls (an <w:sdt> inside another <w:sdt>'s content, or
// inside a table cell's content) unwrap fully, and a control with no <w:sdtContent> at
// all (or an empty one — an unfilled placeholder, which Word leaves behind constantly)
// simply contributes nothing rather than throwing. The inline form — <w:sdt> as a run-level
// sibling inside a paragraph's own child sequence — is a separate construct in the schema
// and is handled separately, inside paragraphSegments (see there).
// Import fix list #1b, #2 (30 Sep 2026): the same unwrapping is now done for the other block-level wrappers Word
// puts around whole paragraphs, tables, rows and cells, so none of their content disappears:
//   - mc:AlternateContent: ONE branch is read — the first mc:Choice whose Requires namespaces are understood, else the
//     mc:Fallback (never both: Word writes the same content twice, once for new readers and once for old ones);
//   - w:customXml (and w:ins / w:moveTo, the tracked insertions): their content is kept; w:del / w:moveFrom (tracked
//     deletions) are dropped — the accepted view, as docxMergeDeletedParaMarks already does for paragraph marks;
//   - a content control still showing its placeholder prompt (w:sdtPr/w:showingPlcHdr: "Click here to enter text") is
//     dropped — the prompt is not the author's text.
// Used for the body, table rows and cells, footnote/endnote bodies and text boxes (every caller passes a list of
// block-level children; the run-level forms are handled in paragraphSegments / paragraphRunText).
function flattenSdtChildren(nodes, W) {
  const out = [];
  // An explicit stack of [list, next index] instead of recursion: content controls nested thousands deep (hostile) overflowed the stack, and
  // a spread of a long list into push(...) does the same. The order of the result is the same as the recursive reading had.
  const stack = [[nodes, 0]];
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top[1] >= top[0].length) { stack.pop(); continue; }
    const el = top[0][top[1]++];
    if (!el || el.nodeType !== 1) continue;
    if (el.namespaceURI === W) {
      const ln = el.localName;
      if (ln === 'sdt') {
        const sdtContent = [...el.children].find((c) => c.namespaceURI === W && c.localName === 'sdtContent');
        if (sdtShowsPlaceholder(el, W)) {                  // an unfilled control: its prompt is not content...
          // ...but a control that wraps a table CELL still holds its place in the row, as an empty cell (else the columns shift)
          for (const c of sdtContent ? [...sdtContent.children] : []) {
            if (c.namespaceURI === W && c.localName === 'tc' && el.ownerDocument) out.push(el.ownerDocument.createElementNS(W, 'w:tc'));
          }
          continue;
        }
        if (sdtContent) stack.push([[...sdtContent.children], 0]);
        continue;                                          // no sdtContent, or empty → contributes nothing
      }
      if (ln === 'customXml' || ln === 'ins' || ln === 'moveTo') { stack.push([[...el.children], 0]); continue; }
      if (ln === 'del' || ln === 'moveFrom') continue;     // tracked deletion: gone in the accepted view
    } else if (el.namespaceURI === MC_NS && el.localName === 'AlternateContent') {
      const branch = mcSelectedBranch(el);
      if (branch) stack.push([[...branch.children], 0]);
      continue;
    }
    out.push(el);
  }
  return out;
}

// Markup Compatibility (ECMA-376 Part 3): <mc:AlternateContent> holds one or more <mc:Choice Requires="w14 wps …"> and an
// optional <mc:Fallback>. A reader takes the first Choice whose required namespaces it understands, else the Fallback.
// "Understood" here = the namespaces Word itself writes for features this reader knows how to read (the WordprocessingML
// family and its 2010+ extensions, DrawingML text boxes and groups); anything else (chart extensions, unknown vendors)
// sends the reader to the Fallback.
const MC_DENIED_URI_RE = /chartex/i;
function mcChoiceUnderstood(choice) {
  const req = String((choice.getAttribute && choice.getAttribute('Requires')) || '').trim();
  if (!req) return true;
  return req.split(/\s+/).every((prefix) => {
    const uri = choice.lookupNamespaceURI ? choice.lookupNamespaceURI(prefix) : null;
    if (!uri) return /^(w|wp|a|pic|r|m|v|o|w1[0-9]|w16[a-z]*|wp14|wpc|wpg|wpi|wps|wne|a14)$/.test(prefix);
    if (MC_DENIED_URI_RE.test(uri)) return false;
    return /^http:\/\/schemas\.openxmlformats\.org\//.test(uri) || /^http:\/\/schemas\.microsoft\.com\/office\/(word|drawing)\//.test(uri)
      || uri === 'urn:schemas-microsoft-com:vml' || uri === 'urn:schemas-microsoft-com:office:office';
  });
}
function mcSelectedBranch(alt) {
  let fallback = null;
  for (const c of alt.children || []) {
    if (c.namespaceURI !== MC_NS) continue;
    if (c.localName === 'Choice' && mcChoiceUnderstood(c)) return c;
    if (c.localName === 'Fallback') fallback = c;
  }
  return fallback;
}
// True if `node` sits inside an mc:Choice / mc:Fallback that is NOT the branch mcSelectedBranch picks, somewhere between
// it and `stopAt` (exclusive).
function isInsideRejectedMcBranch(node, stopAt) {
  let n = node.parentNode;
  while (n && n !== stopAt) {
    if (n.namespaceURI === MC_NS && (n.localName === 'Choice' || n.localName === 'Fallback')) {
      const alt = n.parentNode;
      if (alt && alt.namespaceURI === MC_NS && alt.localName === 'AlternateContent' && mcSelectedBranch(alt) !== n) return true;
    }
    n = n.parentNode;
  }
  return false;
}
// A content control (w:sdt) that is showing its placeholder prompt: <w:sdtPr><w:showingPlcHdr/></w:sdtPr>
// (w:val="0"/"false" means it is not).
function sdtShowsPlaceholder(sdt, W) {
  const pr = [...sdt.children].find((c) => c.namespaceURI === W && c.localName === 'sdtPr');
  const el = pr && [...pr.children].find((c) => c.namespaceURI === W && c.localName === 'showingPlcHdr');
  if (!el) return false;
  const v = el.getAttributeNS(W, 'val');
  return v == null || v === '' || !/^(0|false|off)$/i.test(v);
}
function isInsideUnfilledSdt(node, stopAt, W) {
  let n = node.parentNode;
  while (n && n !== stopAt) {
    if (n.namespaceURI === W && n.localName === 'sdt' && sdtShowsPlaceholder(n, W)) return true;
    n = n.parentNode;
  }
  return false;
}
// The paragraphs of a table cell, footnote/endnote or text-box body in reading order: block wrappers unwrapped
// (flattenSdtChildren), tracked deletions and unfilled controls left out, and the paragraphs of a nested table included
// (row by row, cell by cell) — the same paragraphs the old deep search found, minus the ones the wrappers hide.
// `maxNest` (A89 step 4): how many tables deep inside the container the paragraphs are collected (default: all). The table-kind
// description (docxTableDescription) is made for every table, and for one nested 1,000 deep each description read everything below it
// (cubic time: 10-17 s for 1,000 levels, over 30 s for 3,000). It asks for DOCX_DESCRIBE_NEST levels: real documents nest a few at most.
// (The tables below that are described when the walk reaches them, and their paragraphs are read then, whole.)
const DOCX_DESCRIBE_NEST = 20;
function docxContainerParas(container, W, nestedTablesAsMarkers = false, maxNest = Infinity) {
  const out = [];
  const walk = (nodes, nest) => {
    for (const el of flattenSdtChildren(nodes, W)) {
      if (el.namespaceURI !== W) continue;
      if (el.localName === 'p') out.push(el);
      else if (el.localName === 'tbl' && nestedTablesAsMarkers) out.push({ nestedTable: el });   // IMP-W6: a nested table is one marker, not its paragraphs
      else if (el.localName === 'tbl') {
        if (nest >= maxNest) continue;
        for (const tr of flattenSdtChildren([...el.children], W)) {
          if (tr.namespaceURI !== W || tr.localName !== 'tr') continue;
          for (const cell of flattenSdtChildren([...tr.children], W)) if (cell.namespaceURI === W && cell.localName === 'tc') walk([...cell.children], nest + 1);
        }
      }
    }
  };
  walk([...container.children], 0);
  return out;
}

// docx-parity item 4: true if THIS paragraph's own mark (the pilcrow ending it, distinct
// from any tracked-change marks on its runs) is itself tracked as deleted
// (`w:pPr/w:rPr/w:del`) or moved away (`w:pPr/w:rPr/w:moveFrom`) — Word's own convention
// for "with changes accepted, this paragraph joins the one after it": deleting the mark
// between two paragraphs merges them into one, and a moved-from mark behaves the same way
// once the move itself is accepted (see docxMergeDeletedParaMarks, just below, which does
// the actual joining). Deliberately does NOT look at the paragraph's own run content (a run
// wrapped in `<w:del>` already reads as nothing at all — it uses `<w:delText>`, never
// `<w:t>`, and getRunText only ever reads `<w:t>` — so deleted body text needs no separate
// handling here).
function docxParaMarkJoined(p, W) {
  const pPr = firstChildNS(p, W, 'pPr');
  const rPr = pPr && firstChildNS(pPr, W, 'rPr');
  return !!(rPr && (firstChildNS(rPr, W, 'del') || firstChildNS(rPr, W, 'moveFrom')));
}

// docx-parity item 4: pre-processing pass over the body's (already sdt-flattened)
// direct-child list — run once, before the main paragraph walk in parseDocx even starts —
// that joins every `<w:p>` whose OWN mark is deleted/moved-from (docxParaMarkJoined, above)
// onto the START of the very next paragraph, exactly as Word itself displays the document
// once every tracked change is accepted. A run of SEVERAL consecutive deleted/moved-from
// marks (deleting three paragraph breaks in a row) all join into the one paragraph that
// keeps the first surviving mark after them. The survivor's own `<w:pPr>` (style, numbering,
// outline level, alignment…) is the one that comes through — matching Word, where the
// paragraph mark that is NOT deleted is the one whose formatting the merged paragraph keeps
// — so only its runs/hyperlinks/maths are copied from the deleted-mark paragraphs, never
// their `<w:pPr>`. A deleted/moved-from mark with no following paragraph at all (the very
// last thing in the body) has nothing to join with and is left as an ordinary paragraph,
// rather than silently losing its text. Every OTHER body-level child (`<w:tbl>`,
// `<m:oMathPara>`, …) passes through untouched, and is never itself a join target — a
// paragraph mark can only ever join with another paragraph.
function docxMergeDeletedParaMarks(children, W) {
  const isP = (el) => el && el.namespaceURI === W && el.localName === 'p';
  let anyJoined = false;
  for (const el of children) if (isP(el) && docxParaMarkJoined(el, W)) { anyJoined = true; break; }
  if (!anyJoined) return children;                          // common case: no tracked paragraph-mark changes at all
  const out = [];
  let i = 0;
  while (i < children.length) {
    const el = children[i];
    if (isP(el) && docxParaMarkJoined(el, W)) {
      const runEls = [el];
      let j = i + 1;
      while (j < children.length && isP(children[j]) && docxParaMarkJoined(children[j], W)) { runEls.push(children[j]); j++; }
      const survivor = isP(children[j]) ? children[j] : null;
      if (survivor) {
        const merged = survivor.cloneNode(false);            // survivor's own <w:pPr>/attributes; children rebuilt below
        // Import fix list #8 (Pandoc paragraph_insertion_deletion.docx): where two paragraphs are joined, the last word
        // of the first and the first word of the next must not run together ("split" + "Paragraph." -> "splitParagraph.")
        // — a space is put between them unless one side already has whitespace there (or is empty). Word itself would
        // show them fused; Pandoc's accepted view, and a transcriber, read two words.
        const tChars = (para) => [...para.getElementsByTagNameNS(W, 't')].map((t) => t.textContent || '').join('');
        const joined = [...runEls, survivor];
        for (let k = 0; k < joined.length; k++) {
          const src = joined[k];
          if (k > 0) {
            const left = tChars(joined[k - 1]), right = tChars(src);
            if (left && right && !/\s$/.test(left) && !/^\s/.test(right)) {
              const sp = survivor.ownerDocument.createElementNS(W, 'w:r');
              const t = survivor.ownerDocument.createElementNS(W, 'w:t');
              t.setAttribute('xml:space', 'preserve');
              t.appendChild(survivor.ownerDocument.createTextNode(' '));
              sp.appendChild(t);
              merged.appendChild(sp);
            }
          }
          for (const child of [...src.childNodes]) {
            if (src !== survivor && child.nodeType === 1 && child.namespaceURI === W && child.localName === 'pPr') continue;   // a joined-away paragraph's own pPr never survives; the survivor's does
            merged.appendChild(child.cloneNode(true));
          }
        }
        out.push(merged);
        i = j + 1;
        continue;
      }
      out.push(el);                                          // nothing to join with: keep it rather than lose its text
      i++;
      continue;
    }
    out.push(el);
    i++;
  }
  return out;
}

const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

// A55: a floating (anchored or legacy-VML) text box's own body — `<w:txbxContent>`, found
// either inside `<w:drawing>/<wp:anchor>/…/<wps:txbx>` (modern DrawingML) or inside
// `<w:pict>/<v:shape>/<v:textbox>` (legacy VML, still emitted for a `.doc` → `.docx`
// conversion or an older Word) — sits nested many levels inside the `<w:p>` its anchor is
// attached to, so parseDocx's own body walk (which only visits `body`'s direct-child
// `<w:p>`/`<w:tbl>` elements) never reaches its own paragraphs at all. `<w:txbxContent>`
// itself is always in the WordprocessingML namespace even under a `wps:`/`v:` wrapper, so
// one `getElementsByTagNameNS(W, 'txbxContent')` finds every copy.
// Word commonly stores the SAME text box twice — once as DrawingML inside an
// `<mc:AlternateContent>`'s `<mc:Choice Requires="wps">`, once as legacy VML inside its
// `<mc:Fallback>` — so a Choice's txbxContent is kept and a Fallback's own copy is
// dropped, never both (a copy that isn't part of any mc:AlternateContent at all, the
// common case for a plain legacy .doc conversion, is always kept).
// K7/BANA §7: returns one GROUP per distinct text box ({ el: txbxContent, paras: [w:p, …] })
// rather than one flat paragraph list, so the caller (parseDocx's own p-anchor handling, below)
// can decide box-worthiness (docxTxbxBoxInfo) per text box — two text boxes anchored to the
// same paragraph must not be merged into one box just because docxTxbxParagraphs used to return
// them as a single flat array.
function docxTxbxParagraphs(p, W) {
  const groups = [];
  const seen = new Set();
  for (const txbx of (p.getElementsByTagNameNS ? [...p.getElementsByTagNameNS(W, 'txbxContent')] : [])) {
    if (seen.has(txbx) || isInsideRejectedMcBranch(txbx, p)) continue;     // the Fallback copy of a box the Choice already gave (import fix list #15d)
    seen.add(txbx);
    // A55 (found re-measuring the real corpus file): a text box's own paragraph is very
    // often ALSO wrapped in its own <w:sdt> content control (real corpus:
    // txbxContent > sdt > sdtContent > p, not a direct txbxContent > p) — the exact same
    // wrapper A51 already unwraps at body level. Reusing flattenSdtChildren here, rather
    // than only ever looking for a direct <w:p> child, is what actually recovers this
    // file's TitleGrey/HMTtitlep2 running-head text; without it docxTxbxParagraphs finds
    // the txbxContent element but never its paragraph.
    const paras = [];
    for (const child of flattenSdtChildren([...txbx.children || []], W)) {
      if (child.namespaceURI === W && child.localName === 'p') paras.push(child);
    }
    if (paras.length) groups.push({ el: txbx, paras });
  }
  return groups;
}

// Import fix list #1e: WordArt. The legacy (VML) kind keeps its text in an ATTRIBUTE — <w:pict><v:shape><v:textpath
// string="Big title"/></v:shape></w:pict> — not in a run, so nothing read it. The DrawingML kind (Word 2010+) keeps its text in
// a text box (<wps:txbx>), which docxTxbxParagraphs already reads. Returns the WordArt strings of a paragraph, in order; a
// copy in the unused branch of an mc:AlternateContent, or inside a text box's own paragraphs, is not counted.
const VML_NS = 'urn:schemas-microsoft-com:vml';
function docxWordArtTexts(p, W) {
  const out = [];
  if (!p.getElementsByTagNameNS) return out;
  for (const tp of p.getElementsByTagNameNS(VML_NS, 'textpath')) {
    if (isInsideRejectedMcBranch(tp, p) || isInsideTxbxContent(tp, p, W)) continue;
    if ((tp.getAttribute('on') || '').toLowerCase() === 'f') continue;     // the text path is switched off
    const t = (tp.getAttribute('string') || '').replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  return out;
}

// D8: a table cell built from several paragraphs' segments (Word / ODT). Returns null when
// nothing in the cell is richer than plain text (the caller then keeps its own plain string
// exactly as before); otherwise a { text, segments } cell (format/cell-markup.mjs) that keeps
// emphasis, links, note references and maths. Paragraphs are joined by a space: a '\n' in a
// cell is only understood by the stairstep format, so it is not used here.
function richCellFromSegments(segs) {
  if (!segs.some((g) => g.tf || g.href || g.type === 'noteref' || g.type === 'math' || g.type === 'imgnote' || g.type === 'brl' || g.transcriberTypeform || g.lang)) return null;
  const norm = segs
    .map((g) => (g.type === 'text' ? { ...g, text: g.text.replace(/\s+/g, ' ') } : g))
    .filter((g) => g.type !== 'text' || g.text);
  if (norm.length && norm[0].type === 'text') norm[0] = { ...norm[0], text: norm[0].text.replace(/^\s+/, '') };
  const last = norm.length - 1;
  if (last >= 0 && norm[last].type === 'text') norm[last] = { ...norm[last], text: norm[last].text.replace(/\s+$/, '') };
  const kept = [];
  for (const g of norm) {
    if (g.type === 'text' && !g.text) continue;
    const prev = kept[kept.length - 1];
    if (g.type === 'text' && prev && prev.type === 'text' && (prev.tf || 0) === (g.tf || 0) && !!prev.uncontracted === !!g.uncontracted && !prev.href && !g.href && (prev.transcriberTypeform || null) === (g.transcriberTypeform || null) && (prev.lang || null) === (g.lang || null)) {
      kept[kept.length - 1] = { ...prev, text: (prev.text + g.text).replace(/\s+/g, ' ') };
    } else kept.push(g);
  }
  if (!kept.length) return null;
  const plain = kept.map((g) => (g.type === 'math' ? (g.latex || '') : g.text)).join('');
  return cellFromSegments(plain, kept);
}

// F4-04: paragraph styles (style id, lower-cased) the DOCX writer (web/docx-export.mjs) emits for
// block types Word has no native form for -> the block each one reads back as.
const EMBOSS_PARA_STYLES = {
  embosscaption: { type: 'caption' },
  embossbyline: { type: 'attribution' },
  embossnote: { type: 'note' },
  embossnoterequired: { type: 'note', render: 'required' },
  embossnoteoptional: { type: 'note', render: 'optional' },
  embossnotetabletn: { type: 'note', kind: 'tabletn' },
  embossfootnote: { type: 'footnote' },
  embossverse: { type: 'play', subtype: 'verse', style: 'verse', fromPoem: true },
  embossglossary: { type: 'glossary' },
  embosstnheading: { type: 'tnpage-heading' },
  embosstnentry: { type: 'tnpage-entry' },
  embosstncontinued: { type: 'tnpage-cont' },
};
const TNPAGE_HEADING_RE_DOCX = /^transcriber['\u2019\u2018`\u00B4]?s\s+notes$/i;
// Plain text of a segment list; a print line number is set off as its own word.
function docxSegmentsText(segments) {
  return segments.map((s) => (s.type === 'linenum' ? ` ${s.text} ` : (s.text || ''))).join('').replace(/\s+/g, ' ').trim();
}
// A glossary paragraph is "term — definition" (the writer's own separator); split at the first one.
function docxGlossaryItem(segments, text, hasSeg) {
  const SEP = ' \u2014 ';
  const split = (segs) => {
    const a = [], d = []; let found = false;
    for (const s of segs) {
      if (found || s.type !== 'text') { (found ? d : a).push(s); continue; }
      const i = s.text.indexOf(SEP);
      if (i < 0) { a.push(s); continue; }
      found = true;
      const left = s.text.slice(0, i), right = s.text.slice(i + SEP.length);
      if (left) a.push({ ...s, text: left });
      if (right) d.push({ ...s, text: right });
    }
    return found ? { a, d } : null;
  };
  const parts = hasSeg ? split(segments) : null;
  const plain = (segs) => segs.map((s) => s.text || '').join('');
  let term, def, termSegments, defSegments;
  if (parts) { termSegments = parts.a; defSegments = parts.d; term = plain(parts.a); def = plain(parts.d); }
  else {
    const i = text.indexOf(SEP);
    term = i < 0 ? text : text.slice(0, i); def = i < 0 ? '' : text.slice(i + SEP.length);
    termSegments = [{ type: 'text', text: term }]; defSegments = def ? [{ type: 'text', text: def }] : [];
  }
  const item = { term, def, text, termSegments, defSegments };
  item.segments = [...termSegments, { type: 'text', text: SEP }, ...defSegments];
  return item;
}

// The boundary between two cells of a layout table unwrapped into parseDocx's body walk
// (table-kind.mjs): not an element — the walk flushes any open list at it and moves on.
const DOCX_LAYOUT_CELL_BREAK = Object.freeze({ nodeType: 1, localName: '#layout-cell-break', namespaceURI: null, children: [] });
// Closes a box opened directly by the `tbl` branch (a boxed single-cell table, docxTcBoxInfo) —
// used in place of DOCX_LAYOUT_CELL_BREAK for that one cell; no '#box-start' sentinel is needed
// there since the branch pushes onto pendingBoxWraps itself, synchronously, right before
// splicing the cell's content into `children` (nothing else can run in between).
const DOCX_BOX_END = Object.freeze({ nodeType: 1, localName: '#box-end', namespaceURI: null, children: [] });

// ---------- Box/sidebar detection (DOCX) — BANA §7 box lines, K7 box colour ----------
// OOXML has no "this is a sidebar" element; Word authors build one of three ways, none tagged
// as such — so each is read from the same raw formatting a sighted reader would notice:
//
//  1. A paragraph "box" border (docxParaBorderInfo/docxParaShadeFill, used by parseDocx's own
//     pre-pass, below): Word's Borders-and-Shading dialog writes an identical <w:pBdr> (all
//     four sides, non-nil, non-zero width) onto every paragraph in the box, and Word itself
//     already treats a run of paragraphs with matching pBdr as ONE seamless bordered box, not
//     one border per line — exactly the rule reproduced here. Requiring all FOUR sides (not
//     just, say, a bottom rule) is what keeps a plain "rule line" paragraph (a bottom border
//     only, common under a running head) from being misread as a box.
//  2. A single-cell table whose cell is bordered and/or shaded (docxTcBoxInfo) — Word's other
//     common way to fake a sidebar with no native box element. table-kind.mjs already classifies
//     a 1x1 table as a "layout" table (colCount<=1, "single column") on structural grounds alone
//     and parseDocx already flattens a layout table's cell into plain paragraphs; this only
//     changes what those paragraphs are wrapped in when the cell ALSO carries a border/shading,
//     never table-kind.mjs's own data/layout classification (a bordered single-cell table with
//     only one short paragraph — a boxed page number, a decorative rule — stays a plain
//     paragraph: "several paragraphs" is required, see docxTcBoxInfo).
//  3. A floating text box (wps:txbx / legacy VML v:textbox, docxTxbxBoxInfo) with an explicit
//     border and/or fill on its own shape. docxTxbxParagraphs (A55, above) already finds every
//     text box's paragraphs; today they are spliced into the body as flat paragraphs in reading
//     order regardless of the shape's own formatting (real corpus use: running heads and titles,
//     e.g. TitleGrey/HMTtitlep2, sitting in an invisible box purely for page placement) — adding
//     a box wrapper for an UNDECORATED text box would misread every one of those as a sidebar.
//     Both DrawingML and legacy VML require an EXPLICIT, positive border/fill signal (a real
//     <a:ln>/<a:solidFill>, or an explicit VML stroked="t"/filled="t" WITH a colour) — never a
//     format's mere default — for exactly that reason.
//
// All three funnel through the same two-sentinel mechanism the main body walk already has for
// splicing a layout table's cell into the walk (DOCX_LAYOUT_CELL_BREAK, above): a '#box-start'
// sentinel records where the box's own blocks begin (pendingBoxWraps, in parseDocx), ordinary
// paragraph/heading/image/table/note processing continues completely unchanged in between (so a
// box gets every one of those, exactly as if it were the top-level body), and a '#box-end'
// sentinel closes it — wrapping whatever was produced into one { type: 'box' } block and pulling
// a title out of its first block (extractBoxTitle, above), the same way parseDtbook's own
// <sidebar> reader (parseSidebar) already does for DTBook/NIMAS XML.
function docxParaBorderInfo(p, W) {
  const pPr = firstChildNS(p, W, 'pPr');
  const pBdr = pPr ? firstChildNS(pPr, W, 'pBdr') : null;
  if (!pBdr) return null;
  const parts = [];
  for (const side of ['top', 'left', 'bottom', 'right']) {
    const s = firstChildNS(pBdr, W, side);
    if (!s) return null;
    const val = (s.getAttributeNS(W, 'val') || '').toLowerCase();
    const sz = parseInt(s.getAttributeNS(W, 'sz') || '0', 10) || 0;
    if (!val || val === 'nil' || val === 'none' || sz === 0) return null;
    parts.push(`${val}|${sz}|${(s.getAttributeNS(W, 'color') || '').toLowerCase()}`);
  }
  return parts.join(';');
}
// A paragraph's own shading fill (w:pPr/w:shd/@w:fill), or null when unshaded/"auto" — the
// colour named in the box's K7 transcriber's note (paragraph border colour itself is a LINE
// colour, not the box's fill, and is not used for K7).
function docxParaShadeFill(p, W) {
  const pPr = firstChildNS(p, W, 'pPr');
  const shd = pPr ? firstChildNS(pPr, W, 'shd') : null;
  const fill = shd ? shd.getAttributeNS(W, 'fill') : null;
  return fill && fill.toLowerCase() !== 'auto' ? fill : null;
}
// A single-cell table's cell: box-worthy when it is bordered (all four tcBorders sides, falling
// back to the table's own tblBorders per side when tcBorders omits one) and/or shaded (tcPr/shd),
// AND holds at least two non-empty paragraphs ("several" — see the file comment above; a single
// short line in a bordered cell is far more often a decorative rule/page-number box than a real
// sidebar, so it is left as the plain paragraph it already was).
// Import fix list #10 (audit w11): Word's "Table Grid" (and every other table style with borders) draws the lines from
// the table STYLE (word/styles.xml: <w:style w:type="table"><w:tblPr><w:tblBorders>…, through w:basedOn), not from
// borders written on the table or cell itself — a single-cell table made with the default Table Grid style is a box that
// has no direct border markup at all. parseDocxTableStyles reads those, per style id (lower-cased).
async function parseDocxTableStyles(arrayBuffer, W) {
  const map = new Map();
  let xml;
  try { xml = new TextDecoder().decode(await unzipEntry(arrayBuffer, 'word/styles.xml')); }
  catch { return map; }
  let doc; try { doc = parseXml(xml); } catch { return map; }
  const SIDES = ['top', 'left', 'bottom', 'right', 'start', 'end'];
  const readBorders = (bordersEl, into) => {
    if (!bordersEl) return;
    for (const side of SIDES) {
      const e = firstChildNS(bordersEl, W, side);
      if (e) into[side === 'start' ? 'left' : side === 'end' ? 'right' : side] = { val: (e.getAttributeNS(W, 'val') || '').toLowerCase(), sz: parseInt(e.getAttributeNS(W, 'sz') || '0', 10) || 0 };
    }
  };
  for (const styleEl of doc.getElementsByTagNameNS(W, 'style')) {
    if (styleEl.getAttributeNS(W, 'type') !== 'table') continue;
    const id = styleEl.getAttributeNS(W, 'styleId') || '';
    if (!id) continue;
    const borders = {};
    const tblPr = firstChildNS(styleEl, W, 'tblPr');
    readBorders(tblPr && firstChildNS(tblPr, W, 'tblBorders'), borders);
    // the conditional "whole table" formatting of a style can carry the same borders (table- or cell-level)
    for (const sp of styleEl.children || []) {
      if (sp.namespaceURI !== W || sp.localName !== 'tblStylePr' || sp.getAttributeNS(W, 'type') !== 'wholeTbl') continue;
      const spTblPr = firstChildNS(sp, W, 'tblPr');
      readBorders(spTblPr && firstChildNS(spTblPr, W, 'tblBorders'), borders);
      const spTcPr = firstChildNS(sp, W, 'tcPr');
      readBorders(spTcPr && firstChildNS(spTcPr, W, 'tcBorders'), borders);
    }
    map.set(id.toLowerCase(), {
      id, basedOn: firstChildNS(styleEl, W, 'basedOn')?.getAttributeNS(W, 'val') || '', borders,
      isDefault: styleEl.getAttributeNS(W, 'default') === '1' || styleEl.getAttributeNS(W, 'default') === 'true',
    });
  }
  return map;
}
// One side ('top' | 'left' | 'bottom' | 'right') of a table style's border, walking w:basedOn (the most derived style
// that says anything about that side wins); `styleId` null = the document's default table style.
function tableStyleBorder(tableStyles, styleId, side) {
  if (!tableStyles || !tableStyles.size) return null;
  let id = styleId ? String(styleId).toLowerCase() : null;
  if (!id) { for (const st of tableStyles.values()) if (st.isDefault) { id = st.id.toLowerCase(); break; } }
  const seen = new Set();
  while (id && !seen.has(id) && seen.size < 20) {
    seen.add(id);
    const st = tableStyles.get(id);
    if (!st) break;
    if (st.borders[side]) return st.borders[side];
    id = (st.basedOn || '').toLowerCase();
  }
  return null;
}
function docxTcBoxInfo(tc, tbl, W, tableStyles = null) {
  const tcPr = firstChildNS(tc, W, 'tcPr');
  const tblPr = firstChildNS(tbl, W, 'tblPr');
  const tblBorders = tblPr ? firstChildNS(tblPr, W, 'tblBorders') : null;
  const tcBorders = tcPr ? firstChildNS(tcPr, W, 'tcBorders') : null;
  const tblStyleId = tblPr ? firstChildNS(tblPr, W, 'tblStyle')?.getAttributeNS(W, 'val') || null : null;
  const sideOk = (side) => {
    const direct = (tcBorders && firstChildNS(tcBorders, W, side)) || (tblBorders && firstChildNS(tblBorders, W, side));
    // a border written on the cell or table wins; otherwise the table style's own border for that side counts
    const src = direct ? { val: (direct.getAttributeNS(W, 'val') || '').toLowerCase(), sz: parseInt(direct.getAttributeNS(W, 'sz') || '0', 10) || 0 } : tableStyleBorder(tableStyles, tblStyleId, side);
    if (!src) return false;
    const val = src.val, sz = src.sz;
    return !!val && val !== 'nil' && val !== 'none' && sz > 0;
  };
  const bordered = ['top', 'left', 'bottom', 'right'].every(sideOk);
  const shd = tcPr ? firstChildNS(tcPr, W, 'shd') : null;
  const fillAttr = shd ? shd.getAttributeNS(W, 'fill') : null;
  const shdVal = shd ? (shd.getAttributeNS(W, 'val') || '').toLowerCase() : '';
  const hasFill = (!!fillAttr && fillAttr.toLowerCase() !== 'auto') || (!!shdVal && shdVal !== 'clear' && shdVal !== 'nil');
  if (!bordered && !hasFill) return null;
  let textParas = 0;
  for (const cp of docxContainerParas(tc, W)) {
    if (paragraphRunText(cp, W).trim()) textParas++;
    if (textParas >= 2) break;
  }
  if (textParas < 2) return null;
  const boxColor = fillAttr && fillAttr.toLowerCase() !== 'auto' ? hexToColorName(fillAttr) : null;
  return { boxColor };
}
// A floating text box's enclosing shape (its parent up the tree from txbxContent — wps:wsp for
// modern DrawingML, v:shape/v:rect for legacy VML) — box-worthy only on an EXPLICIT, positive
// border/fill signal (see the file comment above for why "explicit" matters here specifically).
function docxTxbxBoxInfo(txbxContentEl, W) {
  let shape = txbxContentEl.parentNode;
  while (shape && shape.localName !== 'wsp' && shape.localName !== 'shape' && shape.localName !== 'rect') shape = shape.parentNode;
  if (!shape || !shape.children) return null;
  if (shape.localName === 'wsp') {
    let spPr = null;
    for (const c of shape.children) if (c.localName === 'spPr') { spPr = c; break; }
    if (!spPr) return null;
    let ln = null, fill = null;
    for (const c of spPr.children || []) {
      if (c.localName === 'ln') ln = c;
      else if (c.localName === 'solidFill') fill = c;
    }
    let bordered = false;
    if (ln) {
      // A missing @w means "use the default line width" (a real, visible line), NOT zero —
      // only an EXPLICIT w="0" turns the line off; found comparing this repo's own
      // lo-textbox.docx fixture (LibreOffice's <a:ln> carries no @w at all for its default
      // text-box border, which still renders as a visible line).
      const wAttr = ln.getAttribute('w');
      const w = wAttr != null ? parseInt(wAttr, 10) : null;
      const lnHasFill = [...(ln.children || [])].some((c) => c.localName === 'solidFill');
      bordered = lnHasFill && w !== 0;
    }
    if (!bordered && !fill) return null;
    let boxColor = null;
    if (fill) {
      const srgb = [...(fill.children || [])].find((c) => c.localName === 'srgbClr');
      if (srgb) boxColor = hexToColorName(srgb.getAttribute('val'));
    }
    return { boxColor };
  }
  // legacy VML (v:shape / v:rect): only an EXPLICIT "on" signal counts (attribute or child
  // element), never VML's own default rendering — see the file comment above.
  const attrStroked = (shape.getAttribute('stroked') || '').toLowerCase();
  const attrFilled = (shape.getAttribute('filled') || '').toLowerCase();
  let strokeOnChild = false, strokeOffChild = false, fillOnChild = false, fillOffChild = false;
  for (const c of shape.children) {
    if (c.localName === 'stroke') { const on = (c.getAttribute('on') || '').toLowerCase(); if (on === 'f') strokeOffChild = true; else if (on === 't') strokeOnChild = true; }
    if (c.localName === 'fill') { const on = (c.getAttribute('on') || '').toLowerCase(); if (on === 'f') fillOffChild = true; else if (on === 't') fillOnChild = true; }
  }
  const strokeColor = shape.getAttribute('strokecolor');
  const fillColor = shape.getAttribute('fillcolor');
  const bordered = (attrStroked === 't' || strokeOnChild) && attrStroked !== 'f' && !strokeOffChild && !!strokeColor;
  const filled = (attrFilled === 't' || fillOnChild) && attrFilled !== 'f' && !fillOffChild && !!fillColor;
  if (!bordered && !filled) return null;
  return { boxColor: filled ? hexToColorName(fillColor) : null };
}

// Two kinds of Word file came in completely empty (import fix list #1, 30 Sep 2026):
//  - Strict Open XML (Word's "Strict Open XML Document" save type, w:conformance="strict"; ECMA-376 Part 1 §A): every
//    namespace is http://purl.oclc.org/ooxml/<group>/<name> instead of the usual (Transitional)
//    http://schemas.openxmlformats.org/<group>/2006/<name>, and measurements carry units ("36pt") instead of plain twips;
//  - a main document part not called word/document.xml (its real name is the officeDocument relationship in
//    _rels/.rels).
// Rather than teach every reader function both, the package is normalised once: the Strict namespaces are renamed to
// their Transitional twins (a one-for-one renaming), unit measurements become the plain numbers the readers expect, and
// the main part (and its relationships) are also offered under the usual names. Ordinary files are left untouched.
const STRICT_NS_RE = /http:\/\/purl\.oclc\.org\/ooxml\/([A-Za-z]+)\//g;
const UNIT_TWIPS = { pt: 20, pc: 240, pi: 240, in: 1440, cm: 1440 / 2.54, mm: 1440 / 25.4 };
function strictToTransitional(xml) {
  return xml
    .replace(STRICT_NS_RE, 'http://schemas.openxmlformats.org/$1/2006/')
    // font sizes (half-points): <w:sz w:val="11pt"/> -> 22
    .replace(/(<w:(?:sz|szCs)\b[^>]*\bw:val=")(-?\d+(?:\.\d+)?)pt"/g, (_, a, n) => `${a}${Math.round(parseFloat(n) * 2)}"`)
    // any other measurement with a unit (indents, spacing, tab stops, widths...): twips
    .replace(/(\bw:[A-Za-z]+=")(-?\d+(?:\.\d+)?)(pt|pc|pi|in|cm|mm)"/g, (_, a, n, u) => `${a}${Math.round(parseFloat(n) * UNIT_TWIPS[u])}"`);
}
async function prepareDocxPackage(buf) {
  const entries = listZipEntries(buf);
  const names = new Set(entries.map((e) => e.name));
  const dec = new TextDecoder(), enc = new TextEncoder();
  const read = async (name) => dec.decode(await extractZipEntry(buf, entries.find((e) => e.name === name)));
  let main = 'word/document.xml';
  if (names.has('_rels/.rels')) {
    const rels = await read('_rels/.rels');
    const m = /<Relationship\b[^>]*\bType="[^"]*\/officeDocument"[^>]*>/.exec(rels) || null;
    const target = m && /\bTarget="([^"]+)"/.exec(m[0]);
    if (target) main = target[1].replace(/^\//, '');
  }
  if (!names.has(main)) main = 'word/document.xml';
  const mainXml = names.has(main) ? await read(main) : '';
  const strict = /purl\.oclc\.org\/ooxml\//.test(mainXml);
  if (!strict && main === 'word/document.xml') return;   // an ordinary file: nothing to do
  const over = new Map();
  if (strict) {
    for (const e of entries) {
      if (!/\.(xml|rels)$/i.test(e.name)) continue;
      const x = await read(e.name);
      if (/purl\.oclc\.org\/ooxml\//.test(x)) over.set(e.name, enc.encode(strictToTransitional(x)));
    }
  }
  if (main !== 'word/document.xml') {
    const dir = main.includes('/') ? main.slice(0, main.lastIndexOf('/') + 1) : '';
    const base = main.slice(dir.length);
    over.set('word/document.xml', over.get(main) || enc.encode(mainXml));
    const relName = `${dir}_rels/${base}.rels`;
    if (names.has(relName)) over.set('word/_rels/document.xml.rels', over.get(relName) || enc.encode(await read(relName)));
  }
  ZIP_OVERRIDES.set(buf, over);
}

export async function parseDocx(arrayBuffer) {
  const symLog = new Map();                               // import fix list #36: symbols with no Unicode equivalent, reported at the end
  DOCX_SYM_LOG = symLog;
  try { await prepareDocxPackage(arrayBuffer); } catch { /* not a readable package: the reads below report it as before */ }
  const xmlBytes = await unzipEntry(arrayBuffer, 'word/document.xml');
  const xml = new TextDecoder().decode(xmlBytes);
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  // Audit batch S2b item 8: strict. A document.xml that is not well-formed, or has no w:body, is a damaged file - never an empty document.
  const doc = parseStructuredPart(xml, 'word/document.xml', DOCX_DAMAGED_MSG, (d) => d.getElementsByTagNameNS(W, 'body')[0]);
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const numbering = await parseDocxNumbering(arrayBuffer, W);      // null if no numbering.xml
  const rels = await parseDocxRelationships(arrayBuffer);          // empty Map if no rels part (A46/D4)
  const diagramTexts = await parseDocxDiagramTexts(arrayBuffer, rels, W);   // docx-fix item 6: SmartArt data-part text, keyed by r:dm id
  const docxStyles = await parseDocxStyles(arrayBuffer, W);        // empty Map if no styles.xml (A48/D1)
  const docxTableStyles = await parseDocxTableStyles(arrayBuffer, W);   // table styles' borders (import fix list #10)
  // A45/D3: footnotes.xml/endnotes.xml, opened once per document (missing → empty Map, same
  // graceful fallback as the rels part above — most of the corpus has no endnotes at all).
  const charStyles = await parseDocxCharStyles(arrayBuffer, W);    // empty Map if no styles.xml
  // Foreign-language runs (w:lang, input/lang.mjs): the styles' and docDefaults' languages, read by paragraphSegments.
  try { charStyles.langCtx = docxLangContext(parseXml(new TextDecoder().decode(await unzipEntry(arrayBuffer, 'word/styles.xml'))), W); }
  catch { charStyles.langCtx = docxLangContext(null, W); }
  // docx-parity item 3: bundled onto the SAME `charStyles` Map instance (as plain extra
  // properties, not `.set()` entries — never collides with its id-keyed entries) rather than
  // threading two more parameters through paragraphRunText/paragraphSegments/
  // paragraphTextTabSplit/parseDocxNotesPart and their dozen-plus call sites: `charStyles` is
  // already the one shared reference passed everywhere a run's formatting is resolved, so
  // runVanish/runScript/runCapsSmallCaps/runStrike (above) can reach `charStyles.paraStyles`
  // (this document's paragraph styles, docxStyles — already computed just above) and
  // `charStyles.docDefaults` from every one of those call sites with no signature changes.
  charStyles.paraStyles = docxStyles;
  charStyles.docDefaults = await parseDocxRunDefaults(arrayBuffer, W);
  // Legacy Equation Editor 3.0 / MathType OLE equations found anywhere in the document
  // (body, table cells, text boxes, footnotes, endnotes — every paragraphSegments call
  // below shares this one counter), so the load warning after the walk can say how many.
  // `count` is the ones that could NOT be read (placeholders); `ole` holds every embedded
  // OLE object already converted by mtef.mjs (see readDocxOleEquations).
  const legacyEq = { count: 0, ole: await readDocxOleEquations(arrayBuffer) };
  const footnoteMap = await parseDocxNotesPart(arrayBuffer, W, R, 'word/footnotes.xml', 'word/_rels/footnotes.xml.rels', 'docx-fn-', charStyles, legacyEq);
  const endnoteMap = await parseDocxNotesPart(arrayBuffer, W, R, 'word/endnotes.xml', 'word/_rels/endnotes.xml.rels', 'docx-en-', charStyles, legacyEq);
  const noteNumFmts = await parseDocxNoteNumFmts(arrayBuffer, W, doc);   // docx-fix item 6: sectPr/settings.xml footnotePr/endnotePr numFmt
  const noteMarks = { fn: 0, en: 0, fnMarks: new Map(), enMarks: new Map(), fnFmt: noteNumFmts.fnFmt, enFmt: noteNumFmts.enFmt, customIds: new Set() };   // shared → sequential numbering across the whole doc
  footnoteMap.customIds = endnoteMap.customIds = noteMarks.customIds;   // S5D-Q4: the notes whose reference has a custom mark (collectNoteBlocks)
  const seenNotes = new Set();
  let listCounters = new Map();
  const body = doc.getElementsByTagNameNS(W, 'body')[0] || doc.documentElement;
  // docx-parity item 4: docxMergeDeletedParaMarks joins a deleted/moved-from paragraph mark
  // onto the paragraph after it (see there) — run right after the sdt-flattening pass, so
  // the whole rest of parseDocx (list/heading/table-caption/image classification, all
  // below) only ever sees already-joined paragraphs.
  const children = docxMergeDeletedParaMarks(flattenSdtChildren([...body.children], W), W);   // A51: unwrap block-level content controls
  const blocks = [];
  // K7/BANA §7 (box/sidebar detection, see the file comment above docxParaBorderInfo): a stack
  // of { start, boxColor } — one entry per currently-open box — popped by a '#box-end' sentinel
  // in `children` (or, for a single-cell boxed table, pushed and closed within the very same
  // `tbl` branch below, no sentinel needed since nothing else can intervene there). A stack
  // (not a single pending value) so a box nested inside another box's own single-cell table
  // closes before the outer one, in document order.
  const pendingBoxWraps = [];
  // A run of consecutive top-level paragraphs sharing the identical <w:pBdr> (all four sides —
  // Word's own "box" grouping rule, see the file comment above) is wrapped in '#box-start'/
  // '#box-end' sentinels BEFORE the main walk below ever sees `children`, exactly like the
  // splice-in-place trick the table branch (below) already uses for a layout table's cell — the
  // main walk then treats a run's paragraphs exactly as if they were ordinary top-level body
  // paragraphs (headings, images, notes and all), with the sentinels only marking where to cut
  // the resulting blocks out into one box afterwards.
  {
    let i = 0;
    while (i < children.length) {
      const c0 = children[i];
      if (!(c0.namespaceURI === W && c0.localName === 'p')) { i++; continue; }
      const key = docxParaBorderInfo(c0, W);
      if (!key) { i++; continue; }
      let j = i + 1;
      while (j < children.length && children[j].namespaceURI === W && children[j].localName === 'p' && docxParaBorderInfo(children[j], W) === key) j++;
      const fills = new Set();
      for (let k = i; k < j; k++) { const f = docxParaShadeFill(children[k], W); if (f) fills.add(f.toLowerCase()); }
      const boxColor = fills.size === 1 ? hexToColorName([...fills][0]) : null;
      children.splice(j, 0, { nodeType: 1, localName: '#box-end', namespaceURI: null, children: [] });
      children.splice(i, 0, { nodeType: 1, localName: '#box-start', namespaceURI: null, children: [], boxColor });
      i = j + 2;   // resume scanning right after the run and both sentinels just inserted
    }
  }
  let title = null;
  let pendingList = null;
  const flushList = () => {
    if (pendingList) {
      blocks.push(pendingList);
      for (const item of pendingList.items) {
        blocks.push(...collectNoteBlocks(item.segments, seenNotes, footnoteMap, endnoteMap));
        for (const b of item.blocks || []) if (b && Array.isArray(b.segments)) blocks.push(...collectNoteBlocks(b.segments, seenNotes, footnoteMap, endnoteMap));
      }
      pendingList = null;
    }
  };
  // List items with more than one paragraph, or with a table inside them (item.blocks; document.mjs formatItemBlocks).
  const docxLastItem = () => (pendingList && pendingList.items.length ? pendingList.items[pendingList.items.length - 1] : null);
  // A paragraph with no numbering of its own (no numId at all — neither a direct w:numPr nor
  // one inherited from its style — or an explicit numId "0") continues the item before it
  // when that item was numbered. Takes the already-RESOLVED numId (docx-parity item 2: a
  // style-inherited numId counts as "numbering of its own" here too, same as a direct one —
  // see the isList paragraph-numbering block below, which resolves style numbering before
  // calling this), not the raw w:numPr DOM node.
  const docxContinuesItem = (numId) => {
    const last = docxLastItem();
    if (!last || !last._numbered) return false;
    if (numId == null) return true;
    return numId === '0';
  };
  const docxAddItemPara = (b) => { (docxLastItem().blocks ||= []).push(b); };
  const docxParaIndentLeft = (p) => {
    const pPr = [...(p.children || [])].find((c) => c.namespaceURI === W && c.localName === 'pPr');
    const ind = pPr ? [...(pPr.children || [])].find((c) => c.namespaceURI === W && c.localName === 'ind') : null;
    const v = ind ? Number(ind.getAttributeNS(W, 'left') || ind.getAttributeNS(W, 'start')) : NaN;
    return Number.isFinite(v) ? v : 0;
  };
  // K6 / BANA §9.2.2d (displayIndent, field-registry.mjs): w:ind's own firstLine (twips) on a
  // paragraph styled Quote/Intense Quote — a positive value means print indents THIS
  // paragraph's first line further than its own left margin, the "indented" displayed form;
  // 0, absent, or a negative firstLine (a hanging indent, not a first-line one) is "blocked".
  const docxParaFirstLineIndent = (p) => {
    const pPr = [...(p.children || [])].find((c) => c.namespaceURI === W && c.localName === 'pPr');
    const ind = pPr ? [...(pPr.children || [])].find((c) => c.namespaceURI === W && c.localName === 'ind') : null;
    const v = ind ? Number(ind.getAttributeNS(W, 'firstLine')) : NaN;
    return Number.isFinite(v) ? v : 0;
  };
  // A data table directly after a numbered item and indented like the list (w:tblInd >= 360 twips) is inside that
  // item: the table branch below reads it as usual, and the next loop turn moves what it produced into the item's
  // blocks and lets the list go on. A table that is not indented ends the list, as before.
  let pendingInItemTable = null;
  const docxTblIndent = (tbl) => {
    const tblPr = [...(tbl.children || [])].find((c) => c.namespaceURI === W && c.localName === 'tblPr');
    const ind = tblPr ? [...(tblPr.children || [])].find((c) => c.namespaceURI === W && c.localName === 'tblInd') : null;
    const type = ind ? (ind.getAttributeNS(W, 'type') || 'dxa') : '';
    const v = ind && type === 'dxa' ? Number(ind.getAttributeNS(W, 'w')) : NaN;
    return Number.isFinite(v) ? v : 0;
  };
  const settleInItemTable = () => {
    const t = pendingInItemTable;
    pendingInItemTable = null;
    if (!t) return;
    const added = blocks.slice(t.start);
    if (!added.some((b) => b && b.type === 'table') || added.some((b) => !b || !['table', 'footnote', 'note'].includes(b.type))) return;
    blocks.splice(t.start);
    const last = t.list.items[t.list.items.length - 1];
    (last.blocks ||= []).push(...added);
    if (!pendingList && blocks[blocks.length - 1] === t.list) { blocks.pop(); pendingList = t.list; }   // the list goes on after the table
  };
  const pushMath = (omEl) => {
    const mathml = ommlElementToMathML(omEl);
    const latex = mathmlToLatex(mathml);
    const blk = { type: 'math', mathml };
    if (latex) blk.latex = latex;
    blocks.push(blk);
  };
  // A45/D1 caption convention: a paragraph immediately following an image, styled "Caption"
  // (Word's own built-in caption style — real corpus files add no custom name for it),
  // becomes the image's caption/description instead of a separate, orphaned paragraph.
  const isCaptionStyle = (p) => {
    const styleEl = p.getElementsByTagNameNS(W, 'pStyle')[0];
    return /caption/i.test(styleEl?.getAttributeNS(W, 'val') || '');
  };
  let skipNextCaption = -1;
  let pendingDropCap = null;   // docx-fix item 9: { text, hasSeg, segments } waiting to be merged onto the next paragraph
  let lastCodeBlock = null, codeBlankPending = 0;   // audit w10: consecutive code paragraphs are the lines of ONE code block

  // ---- Tables: layout or data (Emboss/input/table-kind.mjs), and table captions ----
  // docxTableDescription builds table-kind.mjs's neutral description of one <w:tbl>;
  // docxTableKind classifies it (cached per element, since a caption paragraph just before
  // a table asks about the table before the walk reaches it).
  const docxDirect = (parent, ln2) => flattenSdtChildren([...parent.children || []], W).filter((c) => c.namespaceURI === W && c.localName === ln2);
  const docxWVal = (parent, ln2) => {
    const e = parent ? [...parent.children || []].find((c) => c.namespaceURI === W && c.localName === ln2) : null;
    return e ? (e.getAttributeNS(W, 'val') ?? '') : null;
  };
  const docxOn = (v) => v != null && !/^(0|false|off)$/i.test(v);
  const docxParaIsHeading = (cp) => {
    if (paragraphOutlineLvl(cp, W) != null) return true;
    const sid = docxWVal(docxFirstChild(cp, 'pPr'), 'pStyle') || '';
    const k = classifyDocxStyle(sid, docxStyles)?.kind;
    return k === 'heading' || k === 'title' || /^(heading[1-9]|title)$/i.test(sid);
  };
  const docxFirstChild = (parent, ln2) => [...parent.children || []].find((c) => c.namespaceURI === W && c.localName === ln2) || null;
  const docxTableDescription = (tbl, extra = {}) => {
    const tblPr = docxFirstChild(tbl, 'tblPr');
    const trs = docxDirect(tbl, 'tr');
    const rows = trs.map((tr) => docxDirect(tr, 'tc').map((tc) => {
      const cell = { text: '', paragraphs: 0, images: 0, headings: 0, lists: 0, tables: 0, span: 1 };
      const tcPr = docxFirstChild(tc, 'tcPr');
      cell.span = clampSpan(parseInt(docxWVal(tcPr, 'gridSpan') || '1', 10) || 1);
      cell.tables = tc.getElementsByTagNameNS(W, 'tbl').length;
      const texts = [];
      for (const cp of docxContainerParas(tc, W, false, DOCX_DESCRIBE_NEST)) {
        if (isInsideTxbxContent(cp, tc, W)) continue;
        const t = paragraphRunText(cp, W, charStyles).replace(/\s+/g, ' ').trim();
        const imgs = docxParagraphImages(cp, W, R, diagramTexts).filter((d) => !d.decorative).length;
        cell.images += imgs;
        if (!t) continue;
        texts.push(t);
        cell.paragraphs++;
        if (docxParaIsHeading(cp)) cell.headings++;
        const pPr = docxFirstChild(cp, 'pPr');
        if ((pPr && docxFirstChild(pPr, 'numPr')) || /listparagraph/i.test(docxWVal(pPr, 'pStyle') || '')) cell.lists++;
      }
      cell.text = texts.join(' ');
      return cell;
    }));
    const firstTrPr = trs[0] ? docxFirstChild(trs[0], 'trPr') : null;
    return {
      rows,
      headerRow: !!(firstTrPr && docxOn(docxWVal(firstTrPr, 'tblHeader'))),
      altText: !!(String(docxWVal(tblPr, 'tblCaption') || '').trim() || String(docxWVal(tblPr, 'tblDescription') || '').trim()) || !!extra.captioned,
      styleName: docxWVal(tblPr, 'tblStyle') || null,
      role: null,
    };
  };
  // IMP-W6: tables nested in a table kept as a table (they are read as tables whatever their shape), and the decision that a SMALL
  // table (cells of a few words each) holding a nested table is a table, not page layout: table-kind.mjs calls a one-row / one-column
  // table or one with a nested-table cell layout, which would flatten both tables to paragraphs; Paul's decision is that the outer
  // stays a table and the inner follows it as its own. A table whose cells hold headings, lists, pictures or prose stays layout.
  const docxForcedTables = new Set();
  const docxNestedTableKeeps = (tbl, kind) => {
    if (!/^(single row|single column|a cell holds a nested table)$/.test(kind.reason || '')) return kind;
    let cells = 0, nested = 0;
    for (const tr of docxDirect(tbl, 'tr')) {
      for (const tc of docxDirect(tr, 'tc')) {
        cells++;
        const items = docxContainerParas(tc, W, true);
        if (items.some((i) => i.nestedTable)) nested++;
        const own = items.filter((i) => !i.nestedTable);
        if (own.some((cp) => paragraphOutlineLvl(cp, W) != null || docxParaIsHeading(cp) || docxParagraphImages(cp, W, R, diagramTexts).length)) return kind;
        if (own.length > 2 || own.map((cp) => paragraphRunText(cp, W, charStyles).replace(/\s+/g, ' ').trim()).join(' ').length > 120) return kind;
      }
    }
    return nested && cells >= 2 ? { kind: 'data', reason: 'holds a nested table (IMP-W6)' } : kind;
  };
  const docxTableKinds = new Map();
  const docxTableKind = (tbl, extra) => {
    if (!docxTableKinds.has(tbl)) docxTableKinds.set(tbl, classifyTable(docxTableDescription(tbl, extra)));
    return docxTableKinds.get(tbl);
  };
  // A table caption: Word's Caption style (not Emboss's own EmbossCaption, which already
  // reads back as a standalone caption block) or any paragraph holding a SEQ Table field.
  // `label` = it names the table ("Table 3: …", or the SEQ Table field) — BANA §11.3.1-11.3.2:
  // that is the table's HEADING (block.title, centred by the formatter). A Caption-style
  // paragraph that is not a label is a CAPTION proper (§11.2.8: "a brief explanation"),
  // placed before the table "regardless of its print location" (§11.2.8a) as the standalone
  // caption block the formatter sets in 7-5 margins. A source line ("Source: …") is neither
  // and stays where it is.
  const docxTableCaptionInfo = (p) => {
    if (!p || p.namespaceURI !== W || p.localName !== 'p') return null;
    const sid = docxWVal(docxFirstChild(p, 'pPr'), 'pStyle') || '';
    const instr = [...p.getElementsByTagNameNS(W, 'instrText')].map((x) => x.textContent || '').join(' ')
      + ' ' + [...p.getElementsByTagNameNS(W, 'fldSimple')].map((x) => x.getAttributeNS(W, 'instr') || '').join(' ');
    const seqTable = /\bSEQ\s+Table\b/i.test(instr);
    const captionStyle = /caption/i.test(sid) && !/^embosscaption$/i.test(sid);
    if (!seqTable && !captionStyle) return null;
    const text = paragraphRunText(p, W, charStyles).replace(/\s+/g, ' ').trim();
    if (!text || /^sources?\b/i.test(text)) return null;
    return { text, label: seqTable || /^table\s+[0-9A-Za-z]/i.test(text) };
  };
  let pendingTableCaption = null;   // a caption paragraph just before a table: { text, label, el }
  const docxTableLog = [];          // every table's classification, in document order (result.tableKinds, not enumerable)
  const docxCellPictures = [];      // imgnote segments of pictures in data-table cells, for embedGraphicResources
  let skipTableCaptionIdx = -1;     // a caption paragraph just after a table, already used

  // A55: classify and push ONE paragraph, the same title/heading/para logic the main body
  // walk (below) applies to its own `<w:p>` children — reused so a floating text box's own
  // paragraphs (docxTxbxParagraphs) come out as real heading/title/para blocks, with their
  // own style's outline level, instead of the flat unstyled text a naive dump would give.
  // Deliberately narrower than the main walk: no image/caption folding, no list-item
  // handling and no document-title assignment — a text box is a page decoration (real
  // corpus use is running heads/titles like TitleGrey/Subtitle/HMTtitlep2), not a place a
  // list or the document's own title would legitimately live, and keeping this simple
  // avoids the ordering complexity a shared pendingList/skipNextCaption would need across
  // two independent walks.
  const pushDocxTxbxParagraph = (tp, targetBlocks) => {
    const hasMath = tp.getElementsByTagNameNS(MATH_NS, 'oMath').length > 0;
    const segments = paragraphSegments(tp, W, rels, R, noteMarks, charStyles, legacyEq);
    const hasSeg = !!(segments.length && (hasMath || segments.some((s) => s.tf || s.href || s.type === 'noteref' || s.type === 'imgnote' || s.type === 'math' || s.type === 'linenum' || s.uncontracted || s.transcriberTypeform || s.lang)));
    const text = paragraphRunText(tp, W, charStyles).replace(/\s+/g, ' ').trim();
    if (!text && !hasSeg) return;
    const styleEl = tp.getElementsByTagNameNS(W, 'pStyle')[0];
    const style = (styleEl?.getAttributeNS(W, 'val') || '').toLowerCase();
    const pOutline = paragraphOutlineLvl(tp, W);
    const styleClass = classifyDocxStyle(styleEl?.getAttributeNS(W, 'val') || '', docxStyles);
    let headingLevel = pOutline != null ? Math.min(6, pOutline + 1) : (styleClass?.kind === 'heading' ? Math.min(6, styleClass.level) : null);
    let isTitleStyle = pOutline == null && styleClass?.kind === 'title';
    if (headingLevel == null && !isTitleStyle) {
      if (style === 'title') isTitleStyle = true;
      else if (/^heading([1-9])/.test(style)) headingLevel = Math.min(6, Number(style.match(/^heading([1-9])/)[1]));
    }
    const lastTarget = targetBlocks[targetBlocks.length - 1];
    if (isTitleStyle && styleClass?.subtitle === true && titleTakesSubtitle(lastTarget) && text) mergeSubtitleIntoTitle(lastTarget, text);   // IMP-W1
    else if (isTitleStyle && styleClass?.subtitle === true && targetBlocks.length) targetBlocks.push({ type: 'para', text });   // IMP-W1: not a chapter of its own
    else if (isTitleStyle) targetBlocks.push({ type: 'title', text });
    else if (headingLevel != null) targetBlocks.push(hasSeg ? { type: 'heading', level: headingLevel, segments, text } : { type: 'heading', level: headingLevel, text });
    else targetBlocks.push(hasSeg ? { type: 'para', segments } : { type: 'para', text });
    if (hasSeg) targetBlocks.push(...collectNoteBlocks(segments, seenNotes, footnoteMap, endnoteMap));
  };

  // docx-fix item 7: push one {type:'play', subtype:'verse', style:'verse'} block per line
  // of a Shift+Enter-broken paragraph — the exact shape pushVerseLines (above, HTML/EPUB's
  // own `<p class="poem">line one<br>line two</p>` fix, A47/D10) already produces and the
  // formatter/nimas-export.mjs already know how to lay out and round-trip; reused rather
  // than inventing a second representation for "a paragraph that keeps its own line breaks".
  // A synthetic per-line `<w:p>` (docxSplitParagraphAtBreaks's node groups, wrapped in a
  // shallow clone of `p` so paragraphRunText/paragraphSegments need no changes at all) is
  // built and read exactly like any other paragraph. An interior blank line becomes an
  // {type:'indicator', kind:'line'} block (a stanza-break marker, same as pushVerseLines);
  // a leading/trailing blank line is dropped — nothing to break at the very start/end.
  // Returns false (nothing pushed) when every line was blank, so the caller falls back to
  // the ordinary single-paragraph push.
  const docxPushShiftBreakLines = (p, targetBlocks) => {
    const groups = docxSplitParagraphAtBreaks(p, W);
    const lineParas = groups.map((kids) => { const c = p.cloneNode(false); for (const k of kids) c.appendChild(k.cloneNode(true)); return c; });
    const texts = lineParas.map((lp) => paragraphRunText(lp, W, charStyles).replace(/\s+/g, ' ').trim());
    const nonEmptyIdx = [];
    texts.forEach((t, i) => { if (t) nonEmptyIdx.push(i); });
    if (!nonEmptyIdx.length) return false;
    const first = nonEmptyIdx[0], last = nonEmptyIdx[nonEmptyIdx.length - 1];
    for (let i = first; i <= last; i++) {
      const t = texts[i];
      // #50: poem-style lines (IMP-W2: this split is only for a poem / verse style) are a poem's lines, tagged fromPoem as the DTBook and
      // HTML readers tag them, so a save writes a <poem> (as <p class="bai-verse"> they reopened as verse drama, D5, and the braille changed)
      if (!t) { targetBlocks.push({ type: 'indicator', kind: 'line', fromPoem: true }); continue; }
      const lp = lineParas[i];
      const hasMathL = lp.getElementsByTagNameNS(MATH_NS, 'oMath').length > 0;
      const segsL = paragraphSegments(lp, W, rels, R, noteMarks, charStyles, legacyEq);
      const hasSegL = !!(segsL.length && (hasMathL || segsL.some((s) => s.tf || s.href || s.type === 'noteref' || s.type === 'imgnote' || s.type === 'math' || s.type === 'linenum' || s.uncontracted || s.transcriberTypeform || s.lang)));
      targetBlocks.push(hasSegL ? { type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segsL, fromPoem: true } : { type: 'play', subtype: 'verse', style: 'verse', text: t, fromPoem: true });
      if (hasSegL) targetBlocks.push(...collectNoteBlocks(segsL, seenNotes, footnoteMap, endnoteMap));
    }
    return true;
  };

  // Walk the body's children in document order so equations land in place.
  for (let idx = 0; idx < children.length; idx++) {
    settleInItemTable();                                // the table just read belongs inside the list item before it?
    const el = children[idx];
    const ln = el.localName;
    // Layout tables (table-kind.mjs): the boundary between two cells of an unwrapped layout
    // table — a list never runs on from one cell into the next.
    if (el === DOCX_LAYOUT_CELL_BREAK) { flushList(); continue; }
    // K7/BANA §7 box/sidebar detection (see the file comment above docxParaBorderInfo): the
    // pre-pass above (a bordered paragraph run) and the `tbl` branch below (a boxed single-cell
    // table) both open a box by pushing onto pendingBoxWraps, then either splice in a matching
    // '#box-end' (the pre-pass) or push one directly among the table's own spliced-in pieces.
    if (ln === '#box-start') { flushList(); pendingBoxWraps.push({ start: blocks.length, boxColor: el.boxColor || null }); continue; }
    if (ln === '#box-end') {
      flushList();
      const pend = pendingBoxWraps.pop();
      if (pend) {
        const inner = blocks.splice(pend.start, blocks.length - pend.start);
        if (inner.length) {
          const box = { type: 'box', render: 'required' };
          const boxTitle = extractBoxTitle(inner);
          if (boxTitle) box.title = boxTitle;
          if (pend.boxColor) box.boxColor = pend.boxColor;
          box.blocks = inner;
          blocks.push(box);
        }
      }
      continue;
    }

    // display equations: m:oMathPara (block) or a bare m:oMath at body level
    if (ln === 'oMathPara' || ln === 'oMath') {
      flushList();
      const maths = ln === 'oMath' ? [el] : [...el.getElementsByTagNameNS(MATH_NS, 'oMath')];
      maths.forEach(pushMath);
      continue;
    }
    // docx-fix item 11: <w:altChunk r:id="…"/> — a body-level sibling of <w:p>/<w:tbl>
    // (Insert > Object > Text from File, or a mail-merge/converter's embedded sub-document)
    // that splices in a WHOLE separate part (HTML/RTF/plain text; a DOCX/XML altChunk would
    // need this parser's own DOCX reader recursively, which this fix does not attempt) by
    // relationship id. Read via the SAME relationships map/target-resolution `rels`/
    // resolveZipPath already use for images, then handed to Emboss's own HTML/RTF/plain-text
    // parser (parseHtml/parseRtf/parseText, all in this same file) purely for its `.blocks`
    // — never a new, separate implementation. An unresolvable relationship, an unreadable
    // part, or a content type none of the three parsers recognise all fall through to
    // `continue` silently: no worse than before this fix (an altChunk was never read at all).
    if (ln === 'altChunk') {
      flushList();
      const rid = el.getAttributeNS ? el.getAttributeNS(R, 'id') : null;
      const target = rid && rels.get(rid);
      if (target) {
        try {
          const chunkBytes = await unzipEntry(arrayBuffer, resolveZipPath('word', target));
          const chunkText = new TextDecoder().decode(chunkBytes);
          const ext = (target.split('.').pop() || '').toLowerCase();
          let sub = null;
          if (ext === 'html' || ext === 'htm' || ext === 'xhtml') sub = parseHtml(chunkText);
          else if (ext === 'rtf') sub = parseRtf(chunkText);
          else if (ext === 'txt') sub = parseText(chunkText);
          if (sub && sub.blocks && sub.blocks.length) blocks.push(...sub.blocks);
        } catch { /* unreadable altChunk part: skip it, same as before this fix */ }
      }
      continue;
    }
    // tables: w:tbl -> table block
    if (ln === 'tbl') {
      const itemList = docxLastItem() && docxLastItem()._numbered && docxTblIndent(el) >= 360 ? pendingList : null;
      flushList();
      if (itemList) pendingInItemTable = { list: itemList, start: blocks.length };   // settled at the next turn (settleInItemTable)
      // docx-fix item 1: DIRECT rows only. `el.getElementsByTagNameNS(W,'tr')` (the old
      // deep search) walked into a nested `<w:tbl>` sitting inside one of THIS table's own
      // cells (repro 38/44: a `<w:tc>` holding its own `<w:tr>`/`<w:tc>` as a genuine
      // nested table) and returned the inner table's rows too, in document order right after
      // the outer row that contains them — so the inner table's row was then processed as if
      // it were the OUTER table's second row (real corruption: extra "row" with the wrong
      // cells, and — because the header-row `tc` scan below was ALSO a deep search — the
      // inner table's cells leaking into the outer header row as extra columns). A `<w:tr>`
      // is only ever a genuine row of `el` when it is `el`'s own DIRECT child.
      const directTagNS = (parent, ln2) => flattenSdtChildren([...parent.children || []], W).filter((c) => c.namespaceURI === W && c.localName === ln2);   // import fix list #2: rows/cells inside a content control or tracked insertion count
      const trs = directTagNS(el, 'tr');
      // Table caption (BANA §11.2.8 / §11.3): the caption paragraph just before this table
      // (held back by the paragraph branch below) or the one just after it.
      let tblCaption = pendingTableCaption;
      pendingTableCaption = null;
      const isNestedForTable = docxForcedTables.has(el);           // IMP-W6: a table nested in a table we keep is a table in its own right
      const nextCap = isNestedForTable ? null : docxTableCaptionInfo(children[idx + 1]);
      // Layout or data (table-kind.mjs). A "Table n" caption says the author made a table.
      let tblKind = (tblCaption && tblCaption.label) || (nextCap && nextCap.label)
        ? { kind: 'data', reason: 'table caption' }
        : (trs.length ? docxTableKind(el) : null);
      if (isNestedForTable && trs.length) tblKind = { kind: 'data', reason: 'nested table (IMP-W6)' };
      else if (tblKind && tblKind.kind === 'layout' && trs.length) tblKind = docxNestedTableKeeps(el, tblKind);
      docxTableLog.push({ kind: tblKind ? tblKind.kind : 'none', reason: tblKind ? tblKind.reason : 'no rows' });
      if (!trs.length || tblKind.kind === 'layout') {
        // A layout table is not a table (BANA §11.1.1, §11.2.3): its cells' own content is
        // read in reading order — row by row, cell by cell — by splicing it into the body
        // walk in the table's place, so every heading, list, picture (with its caption),
        // equation and paragraph inside a cell comes out exactly as it would outside a table.
        // A nested table is spliced in too and classified in its own turn.
        // TODO (BANA §10.6.1 / §6.7.3e, forms): a "Label: | [blank]" form row keeps only its
        // label for now; the blank should become the write-on-line convention (an underscore)
        // the DOCX blanks work uses — to be joined up through the main session.
        const pieces = [];
        if (tblCaption) pieces.push(tblCaption.el);   // a caption held back for a table that is not one: back in place
        // K7/BANA §7: a single-cell table (Word's other common way to fake a sidebar, see the
        // file comment above docxTcBoxInfo) whose cell is bordered/shaded and holds several
        // paragraphs becomes a box, not plain flattened paragraphs — checked only for a TRUE
        // 1x1 table (one row, one cell); a caption on the table would already have sent it
        // down the "data" branch above, never here. pendingBoxWraps is pushed directly (not
        // via a '#box-start' sentinel) since nothing else can run before the matching
        // DOCX_BOX_END, spliced in below, closes it.
        const rowTcs = trs.length === 1 ? docxDirect(trs[0], 'tc') : [];
        const singleTc = rowTcs.length === 1 ? rowTcs[0] : null;
        const boxInfo = singleTc ? docxTcBoxInfo(singleTc, el, W, docxTableStyles) : null;
        if (boxInfo) pendingBoxWraps.push({ start: blocks.length, boxColor: boxInfo.boxColor });
        for (const tr of docxDirect(el, 'tr')) {
          for (const tc of docxDirect(tr, 'tc')) {
            pieces.push(...flattenSdtChildren([...tc.children], W).filter((c) => !(c.namespaceURI === W && c.localName === 'tcPr')), boxInfo ? DOCX_BOX_END : DOCX_LAYOUT_CELL_BREAK);
          }
        }
        children.splice(idx, 1, ...pieces);
        idx--;
        continue;
      }
      // A label ("Table 3: …") is the table's heading (block.title); any other caption is a
      // standalone caption block before the table (§11.2.8a). One of each at most; the
      // paragraph after the table is only used for a slot the one before left free.
      let tblTitleCap = tblCaption && tblCaption.label ? tblCaption : null;
      const tblPlainCap = tblCaption && !tblCaption.label ? tblCaption : (nextCap && !nextCap.label ? nextCap : null);
      if (nextCap && nextCap.label && !tblTitleCap) tblTitleCap = nextCap;
      if (nextCap && (nextCap === tblTitleCap || nextCap === tblPlainCap)) skipTableCaptionIdx = idx + 1;
      // Import fix list #5 was NOT made here: a caption below the table is moved above it on purpose (BANA 11.2.8a,
      // "regardless of its print location", tests/layout_tables.test.mjs). What was wrong was Save dropping it when the table
      // already had a title — fixed in nimas-export.mjs (tableIndexForCaption) — so the caption is kept either way.
      if (tblPlainCap) blocks.push({ type: 'caption', text: tblPlainCap.text });
      if (trs.length) {
        const headers = [];
        const tableRows = [];
        const firstTr = trs[0];
        // D8: emphasis, links, note references and maths inside a cell are kept (a rich cell
        // is a { text, segments } object; a plain one stays a string). A picture in a cell
        // is an inline picture note in the cell (below); a note's body follows the table.
        const afterTable = [];
        const cellParasDone = new Set();
        // docx-fix item 1: `trs`/`tcs` here are direct children only, so a nested `<w:tbl>` inside `tc` is never also walked as bogus extra
        // outer rows or cells. (Until 30 Sep 2026 its paragraphs were flattened into the outer cell's text, as in every reader; see
        // IMP-W6, just below, for what a nested table is now.)
        // IMP-W6 (Paul, 30 Sep 2026): the outer table stays a table; a nested table's place in its cell holds a short placeholder
        // (NESTED_TABLE_PLACEHOLDER) and the nested table itself follows the outer table as a table of its own (queued here, spliced in
        // after the outer table's block below). No text is lost or repeated.
        const nestedQueue = [];
        const docxCellValue = (tc) => {
          const segs = [];
          const paraTexts = [];
          for (const cp of docxContainerParas(tc, W, true)) {
            if (cp.nestedTable) {
              nestedQueue.push(cp.nestedTable);
              paraTexts.push(NESTED_TABLE_PLACEHOLDER);
              if (segs.length) segs.push({ type: 'text', text: ' ' });
              segs.push({ type: 'text', text: NESTED_TABLE_PLACEHOLDER });
              continue;
            }
            if (isInsideTxbxContent(cp, tc, W)) continue;
            paraTexts.push(paragraphRunText(cp, W, charStyles).replace(/\s+/g, ' ').trim());
            const ps = paragraphSegments(cp, W, rels, R, noteMarks, charStyles, legacyEq);
            // A picture in a data table's cell stays in its cell (it used to be moved out to
            // a graphic block after the table, away from its row and column): an embedded
            // transcriber's note with its description (BANA §10.11.1), the same inline
            // `imgnote` segment exercise pictures use, exported as the cell's own <img>. Its
            // bytes are embedded with the document's other pictures (docxCellPictures).
            if (!cellParasDone.has(cp)) {
              cellParasDone.add(cp);
              for (const d of docxParagraphImages(cp, W, R, diagramTexts)) {
                if (d.decorative) continue;
                const src = (d.rid && rels.get(d.rid)) || '';
                const seg = { type: 'imgnote', text: d.alt || 'picture' };
                if (src) { seg.src = src; docxCellPictures.push(seg); } else { seg.prodnote = true; seg.render = 'optional'; }   // no picture file (a chart/diagram): a production note, since DTBook <img> needs a src
                if (ps.length && !(ps[ps.length - 1].type === 'text' && /\s$/.test(ps[ps.length - 1].text || ''))) ps.push({ type: 'text', text: ' ' });
                ps.push(seg);
              }
            }
            if (segs.length && ps.length) segs.push({ type: 'text', text: ' ' });
            segs.push(...ps);
            for (const wa of docxWordArtTexts(cp, W)) {            // import fix list #1e: WordArt text in a cell
              paraTexts.push(wa);
              if (segs.length) segs.push({ type: 'text', text: ' ' });
              segs.push({ type: 'text', text: wa });
            }
          }
          const t = paraTexts.filter(Boolean).join(' ');   // paragraphs are separated, not run together
          const rich = richCellFromSegments(segs);
          if (!rich) return t;
          afterTable.push(...collectNoteBlocks(segs, seenNotes, footnoteMap, endnoteMap));
          return rich;
        };
        // IMP-W5 (Paul, 30 Sep 2026): a merged cell (w:gridSpan across columns, w:vMerge down rows) repeats its content in every cell it
        // covers, so no column is left empty. vCarry holds, per grid column, the value of the vertically merged cell covering it.
        const vCarry = [];
        const cloneCell = (v) => (v && typeof v === 'object' ? { ...v } : v);
        const docxRowValues = (tr, onCell) => {
          const out = [];
          let col = 0;
          for (const tc of directTagNS(tr, 'tc')) {
            const tcPr = docxFirstChild(tc, 'tcPr');
            const gridSpan = clampSpan(parseInt(docxWVal(tcPr, 'gridSpan') || '1', 10) || 1);
            const vm = tcPr ? [...tcPr.children || []].find((c) => c.namespaceURI === W && c.localName === 'vMerge') : null;
            const vmVal = vm ? (vm.getAttributeNS(W, 'val') || 'continue') : null;
            const own = docxCellValue(tc);
            const value = vmVal === 'continue' && vCarry[col] !== undefined ? vCarry[col] : own;
            for (let k = 0; k < gridSpan; k++) {
              out.push(k === 0 ? value : cloneCell(value));
              vCarry[col + k] = vm ? value : undefined;
            }
            if (onCell) onCell(tc, col);
            col += gridSpan;
          }
          return out;
        };
        for (const hv of docxRowValues(firstTr)) headers.push(hv);   // (a loop: a spread of a huge row overflows the stack)
        // K3 (BANA 11.6.1d, transcriber KD): print's own column alignment, read from a data
        // cell's own paragraph(s) — w:jc val="right"/"end" (§11.6.1c's "print text shows
        // column entries... right-adjusted"), or a decimal tab stop (w:tabs/w:tab
        // val="decimal", the classic "align figures on the decimal point" convention) —
        // never from the digits themselves (that was F-7's superseded punctuation guess).
        // Voted per column across the data rows only (a header cell's own centring says
        // nothing about how print aligned the data below it); a column whose cells disagree
        // is left undetected, same as one with no markup signal at all — §11.6.1c's plain
        // left-adjustment then applies, exactly K3's "if print does not have place value
        // alignment, do not align in braille".
        const docxCellAlign = (tc) => {
          for (const cp of docxContainerParas(tc, W)) {
            const pPr = firstChildNS(cp, W, 'pPr');
            if (!pPr) continue;
            const jc = firstChildNS(pPr, W, 'jc');
            const jcVal = jc ? jc.getAttributeNS(W, 'val') : null;
            if (jcVal === 'right' || jcVal === 'end') return 'right';
            const tabs = firstChildNS(pPr, W, 'tabs');
            if (tabs) {
              for (const t of tabs.getElementsByTagNameNS(W, 'tab')) {
                if (t.getAttributeNS(W, 'val') === 'decimal') return 'decimal';
              }
            }
          }
          return null;
        };
        const colAlignVotes = [];
        for (let i = 1; i < trs.length; i++) {
          const rowCells = docxRowValues(trs[i], (tc, col) => {
            const al = docxCellAlign(tc);
            if (al) (colAlignVotes[col] ||= new Set()).add(al);
          });
          if (rowCells.some(Boolean)) tableRows.push(rowCells);
        }
        // Real-file gap (23 Sep): a table whose every cell is empty (Word's layout tables — a
        // reserved TOC slot, a cover-page spacer — carry text in nothing) has no content to
        // keep; it was emitted as an empty <table> shell. Dropped, so nothing is lost.
        if (headers.some(Boolean) || tableRows.length) {
          const tblBlock = { type: 'table', headers, rows: tableRows };
          if (tblTitleCap) tblBlock.title = tblTitleCap.text;   // BANA §11.3.1a/§11.3.2: the table heading, centred by the formatter
          const printAlign = colAlignVotes.map((s) => (s && s.size === 1 ? [...s][0] : undefined));
          if (printAlign.some(Boolean)) tblBlock.printAlign = printAlign;
          blocks.push(tblBlock);
        } else if (tblTitleCap) blocks.push({ type: 'para', text: tblTitleCap.text });
        blocks.push(...afterTable);   // D8: a note's body follows the table
        // IMP-W6: the tables nested in this one follow it, each as a table of its own (and any table nested in those after them).
        if (nestedQueue.length) {
          for (const nt of nestedQueue) docxForcedTables.add(nt);
          children.splice(idx + 1, 0, ...nestedQueue);
          if (skipTableCaptionIdx === idx + 1) skipTableCaptionIdx += nestedQueue.length;   // the caption after the outer table is now further on
        }
      }
      continue;
    }
    if (ln !== 'p') continue;

    const p = el;
    if (idx === skipNextCaption) continue;                // already folded into the previous image as its caption
    if (idx === skipTableCaptionIdx) continue;            // already the previous table's title/caption
    // A caption paragraph just before a data table is held for that table (its title or its
    // caption — see docxTableCaptionInfo); the table branch puts it back if it has no rows.
    if (children[idx + 1] && children[idx + 1].namespaceURI === W && children[idx + 1].localName === 'tbl') {
      const cap = docxTableCaptionInfo(p);
      if (cap && (cap.label || docxTableKind(children[idx + 1]).kind === 'data')) {
        flushList();
        pendingTableCaption = { ...cap, el: p };
        continue;
      }
    }

    // A45/D2: image(s) in this paragraph, regardless of whether the paragraph has any text
    // of its own (a dedicated image paragraph has none, and would otherwise hit the
    // "no text → skip" gate below before we ever looked at it).
    const imgDescs = docxParagraphImages(p, W, R, diagramTexts);
    if (imgDescs.length) {
      flushList();
      const next = children[idx + 1];
      const nextIsCaption = next && next.localName === 'p' && isCaptionStyle(next);
      const captionText = nextIsCaption ? paragraphRunText(next, W, charStyles).replace(/\s+/g, ' ').trim() : '';
      imgDescs.forEach((d, i) => {
        const g = { type: 'graphic', src: (d.rid && rels.get(d.rid)) || '', alt: d.alt || '' };
        if (d.decorative) g.decorative = true;   // IMP-W12: marked decorative in Word
        if (captionText && i === imgDescs.length - 1) g.caption = captionText;   // caption belongs with the last/only image
        blocks.push(g);
      });
      if (nextIsCaption) skipNextCaption = idx + 1;
    }

    // A55: this paragraph's own floating text box(es), walked in place — right where its
    // anchor sits, same "content sits where it's referenced" placement A45/D2 already uses
    // for an image's own note/caption. Checked before the "no text → skip" gate below,
    // same reason as the image check above: the anchor paragraph itself is very often
    // empty (all the real content is inside the box).
    const txbxGroups = docxTxbxParagraphs(p, W);
    if (txbxGroups.length) {
      flushList();
      for (const g of txbxGroups) {
        // K7/BANA §7: a text box with an explicit border/fill on its own shape is a box (see
        // the file comment above docxTxbxBoxInfo) — an undecorated one (the common case: a
        // running head/title in an invisible placement box) is read exactly as before this
        // fix, flat paragraphs in reading order.
        const boxInfo = docxTxbxBoxInfo(g.el, W);
        if (boxInfo) {
          const start = blocks.length;
          for (const tp of g.paras) pushDocxTxbxParagraph(tp, blocks);
          const inner = blocks.splice(start, blocks.length - start);
          if (inner.length) {
            const box = { type: 'box', render: 'required' };
            const title = extractBoxTitle(inner);
            if (title) box.title = title;
            if (boxInfo.boxColor) box.boxColor = boxInfo.boxColor;
            box.blocks = inner;
            blocks.push(box);
          }
        } else {
          for (const tp of g.paras) pushDocxTxbxParagraph(tp, blocks);
        }
      }
    }

    // Import fix list #1e: WordArt text (VML v:textpath) stands as a paragraph of its own, where its anchor is.
    for (const wa of docxWordArtTexts(p, W)) { flushList(); blocks.push({ type: 'para', text: wa }); }

    const hasMath = p.getElementsByTagNameNS(MATH_NS, 'oMath').length > 0;
    let segments = paragraphSegments(p, W, rels, R, noteMarks, charStyles, legacyEq);  // run order: text <-> math, with emphasis tf/href/noteref
    // Use the segment path when there's inline maths OR any emphasis run OR a note
    // reference OR an embedded note (e.g. a legacy-equation placeholder), so bold/italic/
    // underline/footnote marks — and a placeholder that has no plain-text equivalent at
    // all — survive as more than flat text.
    let hasSeg = !!(segments.length && (hasMath || segments.some((s) => s.tf || s.href || s.type === 'noteref' || s.type === 'linenum' || s.type === 'imgnote' || s.type === 'math' || s.uncontracted || s.transcriberTypeform || s.lang)));
    let text = paragraphRunText(p, W, charStyles);        // w:t only, with sub/superscript markers
    text = text.replace(/\s+/g, ' ').trim();
    if (segments.some((s) => s.type === 'linenum')) text = docxSegmentsText(segments);   // F4-04: a line number is its own word
    // docx-fix item 9: a drop cap sitting in `pendingDropCap` (set by the PREVIOUS
    // paragraph — see below) merges onto the START of THIS paragraph's text/segments, no
    // space (the drop cap is the first letter(s) of this paragraph's own first word, not a
    // separate word) — see the fuller comment at the detection point below.
    if (pendingDropCap) {
      const dcHasSeg = pendingDropCap.hasSeg, dcText = pendingDropCap.text;
      // Only build a merged segments array (and force hasSeg on) when one side actually NEEDS
      // it (real emphasis/math/href/note/etc.) — otherwise leave this an ordinary plain-text
      // paragraph, same shape it would have been with no drop cap at all.
      if (dcHasSeg || hasSeg) {
        const dcSegs = dcHasSeg ? pendingDropCap.segments : (dcText ? [{ type: 'text', text: dcText }] : []);
        const curSegs = hasSeg ? segments : (text ? [{ type: 'text', text }] : []);
        segments = [...dcSegs, ...curSegs];
        hasSeg = true;
      }
      text = dcText + text;
      pendingDropCap = null;
    }
    const styleEl = p.getElementsByTagNameNS(W, 'pStyle')[0];
    const style = (styleEl?.getAttributeNS(W, 'val') || '').toLowerCase();
    const isPlainListItem = style === 'embossplainlist';   // the writer's marker-less (BANA plain list) item: list indent, no bullet or number
    // K30 / BANA 2.9.1f: a paragraph styled "Dedication" (Word's own style name, not just the
    // style id) becomes `dedication: true` on the plain-paragraph push below.
    const isDedicationStyle = /dedication/i.test((docxStyles.get(style) && docxStyles.get(style).name) || style);
    // A48/D1: classify by styles.xml first (outlineLvl / basedOn chain / style name — see
    // classifyDocxStyle for the full precedence and why); a direct paragraph-level
    // w:outlineLvl (paragraphOutlineLvl) always wins over the style, since it's the
    // author's own explicit override on this one paragraph. Falls back to the original
    // id-only checks (style === 'title' / /^heading([1-9])/) when styles.xml has nothing
    // for this style id at all (e.g. no styles.xml part), so a document that already
    // worked before this fix behaves identically.
    // docx-fix item 1: computed HERE, before `isList` below, rather than after it — a Heading-
    // styled paragraph that also carries w:numPr (Word's "numbered heading": a multilevel
    // list definition linked to the Heading styles, "1 Introduction" / "Chapter 1") must be
    // classified as a heading, not a list item; `isList` needs to already know that.
    const pOutline = paragraphOutlineLvl(p, W);
    const styleClass = classifyDocxStyle(styleEl?.getAttributeNS(W, 'val') || '', docxStyles);
    // K6 / BANA §9: Word's built-in Quote / Intense Quote style (classifyDocxStyle) is
    // Emboss's displayed-quotation paragraph — a positive w:ind firstLine (docxParaFirstLineIndent,
    // above) follows print into the "indented" displayed form (BANA 9.2.2d); 0/absent is "blocked".
    const isQuoteStyle = pOutline == null && styleClass?.kind === 'quote';
    const isCodeStyle = pOutline == null && styleClass?.kind === 'code';   // audit w10: Source Code / HTML Preformatted / Plain Text / Macro Text
    let headingLevel = pOutline != null ? Math.min(6, pOutline + 1) : (styleClass?.kind === 'heading' ? Math.min(6, styleClass.level) : null);
    let isTitleStyle = pOutline == null && styleClass?.kind === 'title';
    if (headingLevel == null && !isTitleStyle) {
      if (style === 'title') isTitleStyle = true;
      else if (/^heading([1-9])/.test(style)) headingLevel = Math.min(6, Number(style.match(/^heading([1-9])/)[1]));
    }
    // docx-fix item 1: this heading's own numbering — w:numPr directly on the paragraph, or
    // (per the task's "directly or via style") inherited from its style's own pPr/numPr
    // default, resolved by walking the SAME w:basedOn chain classifyDocxStyle uses. An
    // explicit `<w:numPr><w:numId w:val="0"/></w:numPr>` on the paragraph itself still means
    // "no numbering" (paragraphNumPr honours that), same as Word.
    const headingNumPr = headingLevel != null ? paragraphNumPr(p, W, styleEl?.getAttributeNS(W, 'val') || '', docxStyles) : null;
    const directNumPr = p.getElementsByTagNameNS(W, 'numPr')[0];
    // docx-parity item 2: a paragraph with NO w:numPr of its own but styled "List Bullet" /
    // "List Number" / a house style based on one of those (or any other style whose OWN
    // w:pPr/w:numPr default is never overridden) is still a numbered/bulleted list item —
    // exactly what .doc's own STSH-driven list detection already does (a paragraph's list
    // membership there comes from its style's ilfo/ilvl, same as any other paragraph
    // property). Resolved via resolveStyleNumPr, the SAME basedOn-chain walk headingNumPr
    // (just above) already uses for numbered HEADINGS — so this can never re-classify a
    // heading/title paragraph as a list (headingLevel/isTitleStyle are already known by
    // here, and a paragraph carrying its own direct numPr keeps using that, unchanged).
    // Word's direct `<w:numId w:val="0"/>` override on the paragraph itself already stops a
    // style's list numbering from applying at all (resolveStyleNumPr only runs when there is
    // no w:numPr element whatsoever — see `!directNumPr`); no separate "cancel" case is
    // needed here.
    const listStyleNumPr = (!directNumPr && headingLevel == null && !isTitleStyle && !Object.prototype.hasOwnProperty.call(EMBOSS_PARA_STYLES, style))
      ? resolveStyleNumPr(styleEl?.getAttributeNS(W, 'val') || '', docxStyles) : null;
    const isList = !headingNumPr && (isPlainListItem || !!directNumPr || style.includes('listparagraph') || listStyleNumPr != null);

    // docx-fix items 4/5: TOC1-9 paragraph styles — what Word itself applies to every entry
    // when Insert > Table of Contents builds one (or a paragraph sitting inside a TOC
    // field's own result carries, in practice, the very same styles) — become 'toc'
    // contents-list items: the same shape/kind a manual or HTML contents list already uses
    // (item.text + item.page + item.level; dot leaders/guide dots and the page number are
    // rendered by format/document.mjs's existing kind==='toc' list handling, not built here).
    // Entry text and the trailing page number are split at the paragraph's own LAST tab
    // (paragraphTextTabSplit, above — the print column break a right dot-leader tab stop
    // marks). Checked before dropCap/isList/heading: a TOC-styled paragraph is never any of
    // those.
    const tocStyleLevel = /^toc([1-9])$/.exec(style);
    if (tocStyleLevel) {
      flushList();
      const { before, after } = paragraphTextTabSplit(p, W, charStyles);
      if (before || after) {
        let last = blocks[blocks.length - 1];
        if (!last || last.type !== 'list' || last.kind !== 'toc') { last = { type: 'list', kind: 'toc', style: 'toc', items: [] }; blocks.push(last); }
        const item = { text: before };
        if (after) item.page = after;
        const lvl = Number(tocStyleLevel[1]) - 1;
        if (lvl > 0) item.level = lvl;
        last.items.push(item);
      }
      continue;
    }
    // docx-fix item 5: a paragraph NOT styled TOC1-9 but whose own (or style-inherited)
    // w:tabs defines a dot-leader tab stop, with a trailing page-number-like token after the
    // LAST tab — a manually-typed contents line ("Introduction<TAB, dot leader>1"), the only
    // other shape the formatter can turn into real guide dots. Anything else (an ordinary
    // tab with no dot leader, e.g. "Name:<TAB>__________") keeps the CURRENT behaviour: the
    // tab collapses to a single space, unchanged.
    if (hasDotLeaderTab(paragraphTabs(p, W, styleEl?.getAttributeNS(W, 'val') || '', docxStyles))) {
      const { before, after } = paragraphTextTabSplit(p, W, charStyles);
      if (before && after && /^(?:\d+|[ivxlcdm]+)$/i.test(after)) {
        flushList();
        let last = blocks[blocks.length - 1];
        if (!last || last.type !== 'list' || last.kind !== 'toc') { last = { type: 'list', kind: 'toc', style: 'toc', items: [] }; blocks.push(last); }
        last.items.push({ text: before, page: after });
        continue;
      }
    }

    // docx-fix item 9: `w:pPr/w:framePr[@w:dropCap]` — Word models a drop cap as its OWN
    // tiny paragraph (just the dropped letter(s)), immediately followed by a plain paragraph
    // holding the rest of that word/sentence — print readers see one paragraph, the XML has
    // two. Defer this paragraph entirely (no block of its own — not even as a heading/list/
    // title, all of which would be wrong for a single dropped capital) and merge its text
    // onto the NEXT paragraph via `pendingDropCap`, above. If nothing ever consumes it (this
    // is the very last paragraph, or is followed by a table/image-only paragraph rather than
    // a plain one) the fallback push right after this loop still keeps the text — see there.
    const framePr = p.getElementsByTagNameNS(W, 'framePr')[0];
    const dropCapVal = framePr ? framePr.getAttributeNS(W, 'dropCap') : '';
    if (dropCapVal && dropCapVal !== 'none') {
      pendingDropCap = { text, hasSeg, segments };
      continue;
    }

    // Classify by STYLE first, then attach inline-maths segments — so a heading or
    // list item with an equation keeps its heading level / list membership (a
    // heading stays in the TOC; a list isn't split apart) instead of collapsing to
    // a plain paragraph.
    if (!text && !hasSeg) {
      if (isCodeStyle && lastCodeBlock && blocks[blocks.length - 1] === lastCodeBlock) codeBlankPending++;   // a blank line inside a code block
      flushList(); continue;
    }
    // An old-style equation (read by mtef.mjs) standing alone in an ordinary paragraph is a
    // display equation: the same `math` block a body-level m:oMathPara gives (pushMath).
    // (Tabs/spaces used to centre it do not count as other content.)
    const legacyAlone = segments.filter((s) => !(s.type === 'text' && !String(s.text || '').trim()));
    if (!isList && !text && legacyAlone.length === 1 && legacyEq.readSegs && legacyEq.readSegs.has(legacyAlone[0])
      && paragraphOutlineLvl(p, W) == null && !/^(heading|title)/.test(style)
      && !['heading', 'title'].includes(classifyDocxStyle(styleEl?.getAttributeNS(W, 'val') || '', docxStyles)?.kind)
      && !Object.prototype.hasOwnProperty.call(EMBOSS_PARA_STYLES, style)) {
      flushList();
      blocks.push({ ...legacyAlone[0] });
      continue;
    }
    // A paragraph holding only display equations (<w:p><m:oMathPara>…): the same `math`
    // blocks a body-level m:oMathPara gives (pushMath), one per equation.
    if (!isList && !text && legacyAlone.length && legacyAlone.every((s) => DOCX_DISPLAY_MATH_SEGS.has(s))
      && paragraphOutlineLvl(p, W) == null && !/^(heading|title)/.test(style)
      && !['heading', 'title'].includes(classifyDocxStyle(styleEl?.getAttributeNS(W, 'val') || '', docxStyles)?.kind)
      && !Object.prototype.hasOwnProperty.call(EMBOSS_PARA_STYLES, style)) {
      flushList();
      for (const s of legacyAlone) blocks.push({ ...s });
      continue;
    }
    if (isList) {
      // docx-fix item 2b: `listCounters` is now a single document-level Map, never reset here
      // — a NEW pendingList run (this paragraph, an interrupting table/image, or a plain
      // paragraph flushed the previous one) must NOT restart numbering for a numId that was
      // already counting; listMarker (above) only starts a numId fresh the first time it is
      // ever seen, exactly matching Word's own "same numId continues, new numId restarts"
      // rule. See parseDocx's own `let listCounters = new Map();` at the top of the function.
      // docx-parity item 2: `numId`/`ilvl` come from this paragraph's OWN w:numPr when it has
      // one, else (directNumPr is only null when isList became true via listStyleNumPr —
      // see above) from the style-inherited numbering resolved there.
      const numId = directNumPr ? (directNumPr.getElementsByTagNameNS(W, 'numId')[0]?.getAttributeNS(W, 'val') ?? null)
        : (listStyleNumPr ? listStyleNumPr.numId : null);
      // A list-styled paragraph with no numbering of its own at all (Word's ListParagraph with no numPr and no
      // style-inherited numbering either, or a direct numId 0) right after a numbered item is that item's further
      // paragraph (Word: "indent to the list text" continuation), kept in item.blocks — not a new, unmarked item
      // flush left (document.mjs formatItemBlocks, BANA §10.3.3).
      if (!isPlainListItem && docxContinuesItem(numId)) { docxAddItemPara(hasSeg ? { type: 'para', text, segments } : { type: 'para', text }); continue; }
      if (!pendingList) pendingList = { type: 'list', items: [] };
      let ilvl = directNumPr ? Number(directNumPr.getElementsByTagNameNS(W, 'ilvl')[0]?.getAttributeNS(W, 'val') || 0) || 0
        : (listStyleNumPr ? listStyleNumPr.ilvl : 0);
      if (isPlainListItem) {                            // level = indent steps beyond the style's own 720-twip list indent (as the writer wrote it)
        const left = Number(p.getElementsByTagNameNS(W, 'ind')[0]?.getAttributeNS(W, 'left'));
        ilvl = Number.isFinite(left) ? Math.max(0, Math.min(8, Math.round((left - 720) / 360))) : 0;
      }
      const marker = listMarker(numbering, listCounters, numId, ilvl);
      const item = hasSeg ? { segments } : { text };
      if (marker) item.marker = marker;               // ordered list → "1." / "a)" / "iii." etc.
      if (ilvl) item.level = ilvl;                     // nested lists indent per level
      if (numId && numId !== '0') Object.defineProperty(item, '_numbered', { value: true });   // may take further paragraphs (docxContinuesItem)
      pendingList.items.push(item);
      continue;
    }
    // An ordinary paragraph indented at least as far as a list's text (w:ind left >= 360 twips), with no numbering,
    // directly after a numbered item: that item's further paragraph too. A paragraph that is not indented ends the list.
    if (headingLevel == null && !isTitleStyle && !Object.prototype.hasOwnProperty.call(EMBOSS_PARA_STYLES, style)
      && docxParaIndentLeft(p) >= 360 && docxContinuesItem(null)) {
      docxAddItemPara(hasSeg ? { type: 'para', text, segments } : { type: 'para', text });
      continue;
    }
    flushList();
    // F4-04: the paragraph styles the DOCX writer uses for block types Word has no native form for.
    const embKind = Object.prototype.hasOwnProperty.call(EMBOSS_PARA_STYLES, style) ? EMBOSS_PARA_STYLES[style] : null;
    if (embKind && (text || hasSeg)) {
      const withSeg = (b) => { b.text = text; if (hasSeg) b.segments = segments; return b; };
      if (embKind.type === 'glossary') {
        const item = docxGlossaryItem(segments, text, hasSeg);
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'list' && last.kind === 'glossary') last.items.push(item);
        else blocks.push({ type: 'list', kind: 'glossary', style: 'glossary', items: [item] });
      } else if (embKind.type === 'tnpage-heading') {
        blocks.push({ type: 'tnpage', matter: 'transcriber', entries: [], ...(TNPAGE_HEADING_RE_DOCX.test(text) ? {} : { heading: text }) });
      } else if (embKind.type === 'tnpage-entry' || embKind.type === 'tnpage-cont') {
        const one = withSeg({});
        let last = blocks[blocks.length - 1];
        if (!last || last.type !== 'tnpage') { last = { type: 'tnpage', matter: 'transcriber', entries: [] }; blocks.push(last); }
        if (embKind.type === 'tnpage-cont' && last.entries.length) (last.entries[last.entries.length - 1].paragraphs ||= []).push(one);
        else last.entries.push(one);
      } else {
        blocks.push(withSeg({ ...embKind }));
      }
      if (hasSeg) blocks.push(...collectNoteBlocks(segments, seenNotes, footnoteMap, endnoteMap));
      continue;
    }
    // Audit w10: a paragraph in one of Word's computer-text styles, or set wholly in a monospaced font, is a code block — the
    // block the HTML reader makes for <pre> — with its indentation and line breaks kept; consecutive such paragraphs are
    // the lines of one block.
    // (A paragraph with a raised or lowered run stays an ordinary paragraph: a code block is plain text and would lose the level
    // — Pandoc's verbatim_subsuper.docx, "m" + superscript "2" both in a typewriter face.)
    if (headingLevel == null && !isTitleStyle && (isCodeStyle || (!isQuoteStyle && paragraphIsMonospaced(p, W, charStyles))) && !paragraphHasScript(p, W, charStyles)) {
      const codeText = paragraphCodeText(p, W, charStyles);
      if (codeText.trim()) {
        if (lastCodeBlock && blocks[blocks.length - 1] === lastCodeBlock) lastCodeBlock.text += '\n'.repeat(codeBlankPending + 1) + codeText;
        else { lastCodeBlock = { type: 'code', text: codeText }; blocks.push(lastCodeBlock); }
        codeBlankPending = 0;
        if (hasSeg) blocks.push(...collectNoteBlocks(segments, seenNotes, footnoteMap, endnoteMap));
        continue;
      }
    }
    // docx-fix item 7: a plain (not title/heading) paragraph with a Shift+Enter break is
    // pushed as separate verse-line blocks instead (docxPushShiftBreakLines, above), which
    // already collects its own per-line notes — `shiftBreakHandled` skips the whole-paragraph
    // `text`/`segments` push AND the trailing collectNoteBlocks call below for it (that would
    // otherwise re-collect against the un-split whole-paragraph `segments`, which is not what
    // actually got pushed, or a noteref idref already marked `seen` by the per-line pass).
    // IMP-W1 (Paul, 30 Sep 2026): a Subtitle goes WITH the Title just before it, as the second line of the same heading
    // (a title block whose text holds a forced line break) — never a title block, i.e. a chapter, of its own. A Subtitle with
    // no Title right before it is an ordinary paragraph (it is the document's first block: a title).
    const isSubtitleStyle = isTitleStyle && styleClass?.subtitle === true;
    const prevBlock = blocks[blocks.length - 1];
    const mergeSubtitle = isSubtitleStyle && titleTakesSubtitle(prevBlock) && !!text;
    if (isSubtitleStyle && !mergeSubtitle && blocks.length) isTitleStyle = false;
    // IMP-W2 (Paul, 30 Sep 2026): Shift+Enter (w:br with no type, or a text-wrapping w:br with w:clear) in an ordinary paragraph is a
    // forced line break inside that ONE paragraph ('\n' in the segment text, as <br/> is); the verse-line split (one play/verse block per
    // line) is kept only when the paragraph's style is a poem / verse style (docxIsVerseStyle).
    let shiftBreakHandled = false;
    if (!isTitleStyle && headingLevel == null && docxHasShiftBreak(p, W)) {
      if (docxIsVerseStyle(styleEl?.getAttributeNS(W, 'val') || '', docxStyles)) shiftBreakHandled = docxPushShiftBreakLines(p, blocks);
      else {
        const brokenSegs = tidyForcedBreakSegments(paragraphSegmentsKeepingBreaks(p, W, rels, R, noteMarks, charStyles, legacyEq));
        if (brokenSegs.some((sg) => sg.type === 'text' && sg.text === '\n')) { segments = brokenSegs; hasSeg = true; }
      }
    }
    if (mergeSubtitle) mergeSubtitleIntoTitle(prevBlock, text);
    else if (isTitleStyle) { title = title || text; blocks.push({ type: 'title', text }); }  // title: text only
    else if (headingLevel != null) {
      // docx-fix item 1: a numbered heading keeps its number at the START of the heading
      // text, exactly as Word displays it ("1.2 Introduction", "Chapter 1") — listMarker
      // shares the SAME numId-keyed `listCounters` map ordinary list items use (item 2b), so
      // a numbered-heading numId that is also used by ordinary list paragraphs (or is
      // interrupted by body text/tables/images between headings) still counts correctly.
      let headingText = text, headingSegments = segments;
      if (headingNumPr) {
        const marker = listMarker(numbering, listCounters, headingNumPr.numId, headingNumPr.ilvl);
        if (marker) {
          headingText = `${marker} ${text}`;
          if (hasSeg) headingSegments = [{ type: 'text', text: `${marker} ` }, ...segments];
        }
      }
      blocks.push(hasSeg ? { type: 'heading', level: headingLevel, segments: headingSegments, text: headingText } : { type: 'heading', level: headingLevel, text: headingText });
    } else if (!shiftBreakHandled && isQuoteStyle) {
      // K6: Quote/Intense Quote style -> a displayed-quotation paragraph (BANA §9), not a
      // plain body paragraph; see isQuoteStyle/docxParaFirstLineIndent above.
      const qb = hasSeg ? { type: 'para', style: 'quote', segments, text } : { type: 'para', style: 'quote', text };
      if (docxParaFirstLineIndent(p) > 0) qb.displayIndent = true;
      blocks.push(qb);
    } else if (!shiftBreakHandled) {
      blocks.push(hasSeg ? (segments.some((s) => s.type === 'linenum') ? { type: 'para', segments, text } : { type: 'para', segments }) : { type: 'para', text });   // F4-04: a line-number paragraph keeps its text (the number as its own word)
      if (isDedicationStyle) blocks[blocks.length - 1].dedication = true;   // K30
    }
    if (hasSeg && !shiftBreakHandled) blocks.push(...collectNoteBlocks(segments, seenNotes, footnoteMap, endnoteMap));
  }
  settleInItemTable();
  flushList();
  // docx-fix item 9: a drop-cap paragraph that was never consumed by a following plain
  // paragraph (it was the document's last paragraph, or the next thing was a table/list/
  // image-only paragraph) — keep its text rather than silently drop it.
  if (pendingDropCap) {
    const { text: dcText, hasSeg: dcHasSeg, segments: dcSegs } = pendingDropCap;
    if (dcText || dcHasSeg) blocks.push(dcHasSeg ? { type: 'para', segments: dcSegs, text: dcText } : { type: 'para', text: dcText });
    pendingDropCap = null;
  }
  const result = { title, blocks };
  const resources = await embedGraphicResources(arrayBuffer, blocks, (p) => resolveZipPath('word', p));
  if (docxCellPictures.length) {
    // Pictures kept inside data-table cells (imgnote segments with a src): embedded the same
    // way, through stand-in graphic objects, so a saved NIMAS package carries their files.
    const standIns = docxCellPictures.map((seg) => ({ type: 'graphic', src: seg.src }));
    for (const r of await embedGraphicResources(arrayBuffer, standIns, (p) => resolveZipPath('word', p))) {
      if (!resources.some((x) => x.path === r.path)) resources.push(r);
    }
    standIns.forEach((g, i) => { docxCellPictures[i].src = g.src; });
  }
  if (resources.length) result.resources = resources;
  Object.defineProperty(result, 'tableKinds', { value: docxTableLog, enumerable: false, configurable: true, writable: true });   // table-kind.mjs decisions, for tests and audits
  // docx-fix item 10: docProps/core.xml's dc:title/dc:creator, used purely as a FALLBACK —
  // the body's own title/heading (above) always wins, same precedence parseEpub/parseOdt
  // give their own body-vs-metadata title. dc:creator has nowhere of its own on a docx
  // model (unlike DTBook's dedicated `metadata.creator`/`docauthor`), so it goes on
  // `result.metadata.creator` — the same optional, additive field parseDtbook already uses
  // for its own dc:creator (see the `lname === 'dc:creator'` case, and parseNimasZip's own
  // `model.metadata` augmentation) — rather than inventing a new top-level field.
  const coreProps = await parseDocxCoreProps(arrayBuffer);
  if (coreProps) {
    if (!result.title && coreProps.title) result.title = coreProps.title;
    if (coreProps.creator) (result.metadata || (result.metadata = {})).creator = coreProps.creator;
  }
  // Fix 1(b): surface the legacy-equation count through Emboss's existing import-warning
  // mechanism (model.warnings, shown by the editor's parse-warning banner — see
  // showParseWarning in web/editor/editor.mjs and the missingImages warning above in
  // parseNimasZip for the same convention) rather than leaving the reader to notice the
  // "equation not transcribed" placeholders on their own.
  if (legacyEq.count) {
    (result.warnings || (result.warnings = [])).push(
      `${legacyEq.count} old-style equation${legacyEq.count === 1 ? '' : 's'} (Equation Editor 3.0 / MathType) could not be read; ` +
      `${legacyEq.count === 1 ? 'it has' : 'they have'} been replaced with a placeholder and must be re-entered with the equation editor`);
  }
  // docx-fix item 8: same warning mechanism, for the non-equation OLE-object placeholder.
  if (legacyEq.oleCount) {
    (result.warnings || (result.warnings = [])).push(
      `${legacyEq.oleCount} embedded object${legacyEq.oleCount === 1 ? '' : 's'} (e.g. a spreadsheet, another document, or another embedded file) could not be read; ` +
      `${legacyEq.oleCount === 1 ? 'it has' : 'they have'} been replaced with a placeholder.`);
  }
  // Import fix list #36: symbols typed in a symbol font (Wingdings, Webdings, Symbol, …) that have no known Unicode
  // equivalent show as the replacement character (U+FFFD); say which ones, so they can be checked against the print.
  if (symLog.size) (result.warnings || (result.warnings = [])).push(symbolLogWarning(symLog));
  if (DOCX_SYM_LOG === symLog) DOCX_SYM_LOG = null;
  // IMP-W9: comments, running headers and footers are not transcribed; say so.
  const leftOut = leftOutNotice(await docxLeftOut(arrayBuffer, W));
  if (leftOut) (result.warnings || (result.warnings = [])).push(leftOut);
  return finishLanguages(result);                          // foreign-language runs: noise dropped (input/lang.mjs)
}

// ---------- Markdown ----------
// A real CommonMark / GitHub-Flavoured-Markdown reader (import fix list rows 15f, 28, 37; 30 Sep 2026), replacing the old
// line-by-line one. It works in two passes, as CommonMark itself does:
//   1. the BLOCK pass (mdParseBlocks) cuts the text into paragraphs, headings, thematic breaks, code, HTML blocks, quotations,
//      lists (by each item's content column), GFM tables and footnote definitions, and collects the link reference definitions
//      and footnote definitions wherever they stand (a definition may come after its use);
//   2. the RENDER pass (mdRenderBlocks) reads each paragraph's inline content (mdInline: code spans, maths, escapes, entities,
//      emphasis by the CommonMark delimiter-run rules, links, images, autolinks, footnote references, inline HTML) and builds
//      the SAME model shapes as the HTML reader (parseHtml): a picture is a { type:'graphic', src, alt } block placed before
//      its paragraph, a note is a noteref segment plus a footnote block placed right after the citing block (placeHtmlNotes),
//      a <sub>/<sup> is the U+E000 / U+E001 / U+E002 script markers, a <br> or a backslash / two-space break is a forced line
//      break "\n", a check box is "[x] " / "[ ] ", and an HTML block is read by parseHtml itself.
// Nothing is dropped that carries words: an unknown tag loses its tag but keeps its text, an undefined reference stays as typed.
// (The Pandoc-only extensions - definition lists, [text]{.class} spans, citations, ==mark==, ~sub~ and ^sup^ - are not read; they stay as typed.)

// The HTML 4 named character references (252), &apos; and the HTML 5 names of ASCII punctuation (&ast;, &lowbar;, &num;... - the ones used
// to keep a character from being read as Markdown), as name:hex[+hex]. Only Markdown needs the table, so it is a string parsed on first use.
const MD_ENTITY_DATA = 'nbsp:a0,iexcl:a1,cent:a2,pound:a3,curren:a4,yen:a5,brvbar:a6,sect:a7,uml:a8,copy:a9,ordf:aa,laquo:ab,not:ac,shy:ad,reg:ae,macr:af,deg:b0,plusmn:b1,sup2:b2,sup3:b3,acute:b4,micro:b5,para:b6,middot:b7,cedil:b8,sup1:b9,ordm:ba,raquo:bb,frac14:bc,frac12:bd,frac34:be,iquest:bf,Agrave:c0,Aacute:c1,Acirc:c2,Atilde:c3,Auml:c4,Aring:c5,AElig:c6,Ccedil:c7,Egrave:c8,Eacute:c9,Ecirc:ca,Euml:cb,Igrave:cc,Iacute:cd,Icirc:ce,Iuml:cf,ETH:d0,Ntilde:d1,Ograve:d2,Oacute:d3,Ocirc:d4,Otilde:d5,Ouml:d6,times:d7,Oslash:d8,Ugrave:d9,Uacute:da,Ucirc:db,Uuml:dc,Yacute:dd,THORN:de,szlig:df,agrave:e0,aacute:e1,acirc:e2,atilde:e3,auml:e4,aring:e5,aelig:e6,ccedil:e7,egrave:e8,eacute:e9,ecirc:ea,euml:eb,igrave:ec,iacute:ed,icirc:ee,iuml:ef,eth:f0,ntilde:f1,ograve:f2,oacute:f3,ocirc:f4,otilde:f5,ouml:f6,divide:f7,oslash:f8,ugrave:f9,uacute:fa,ucirc:fb,uuml:fc,yacute:fd,thorn:fe,yuml:ff,fnof:192,Alpha:391,Beta:392,Gamma:393,Delta:394,Epsilon:395,Zeta:396,Eta:397,Theta:398,Iota:399,Kappa:39a,Lambda:39b,Mu:39c,Nu:39d,Xi:39e,Omicron:39f,Pi:3a0,Rho:3a1,Sigma:3a3,Tau:3a4,Upsilon:3a5,Phi:3a6,Chi:3a7,Psi:3a8,Omega:3a9,alpha:3b1,beta:3b2,gamma:3b3,delta:3b4,epsilon:3b5,zeta:3b6,eta:3b7,theta:3b8,iota:3b9,kappa:3ba,lambda:3bb,mu:3bc,nu:3bd,xi:3be,omicron:3bf,pi:3c0,rho:3c1,sigmaf:3c2,sigma:3c3,tau:3c4,upsilon:3c5,phi:3c6,chi:3c7,psi:3c8,omega:3c9,thetasym:3d1,upsih:3d2,piv:3d6,bull:2022,hellip:2026,prime:2032,Prime:2033,oline:203e,frasl:2044,weierp:2118,image:2111,real:211c,trade:2122,alefsym:2135,larr:2190,uarr:2191,rarr:2192,darr:2193,harr:2194,crarr:21b5,lArr:21d0,uArr:21d1,rArr:21d2,dArr:21d3,hArr:21d4,forall:2200,part:2202,exist:2203,empty:2205,nabla:2207,isin:2208,notin:2209,ni:220b,prod:220f,sum:2211,minus:2212,lowast:2217,radic:221a,prop:221d,infin:221e,ang:2220,and:2227,or:2228,cap:2229,cup:222a,int:222b,there4:2234,sim:223c,cong:2245,asymp:2248,ne:2260,equiv:2261,le:2264,ge:2265,sub:2282,sup:2283,nsub:2284,sube:2286,supe:2287,oplus:2295,otimes:2297,perp:22a5,sdot:22c5,lceil:2308,rceil:2309,lfloor:230a,rfloor:230b,lang:27e8,rang:27e9,loz:25ca,spades:2660,clubs:2663,hearts:2665,diams:2666,quot:22,amp:26,lt:3c,gt:3e,apos:27,OElig:152,oelig:153,Scaron:160,scaron:161,Yuml:178,circ:2c6,tilde:2dc,ensp:2002,emsp:2003,thinsp:2009,zwnj:200c,zwj:200d,lrm:200e,rlm:200f,ndash:2013,mdash:2014,lsquo:2018,rsquo:2019,sbquo:201a,ldquo:201c,rdquo:201d,bdquo:201e,dagger:2020,Dagger:2021,permil:2030,lsaquo:2039,rsaquo:203a,euro:20ac,ast:2a,lowbar:5f,num:23,excl:21,lbrack:5b,lsqb:5b,rbrack:5d,rsqb:5d,lpar:28,rpar:29,bsol:5c,grave:60,lcub:7b,lbrace:7b,rcub:7d,rbrace:7d,vert:7c,verbar:7c,colon:3a,semi:3b,comma:2c,period:2e,quest:3f,percnt:25,dollar:24,plus:2b,equals:3d,sol:2f,commat:40,Hat:5e,hyphen:2010,dash:2010,check:2713,cross:2717,star:2606,starf:2605';
let MD_ENTITY_MAP = null;
function mdNamedEntity(name) {
  if (!MD_ENTITY_MAP) {
    MD_ENTITY_MAP = new Map();
    for (const kv of MD_ENTITY_DATA.split(',')) { const [nm, cp] = kv.split(':'); MD_ENTITY_MAP.set(nm, String.fromCodePoint(...cp.split('+').map((h) => parseInt(h, 16)))); }
  }
  return MD_ENTITY_MAP.get(name);
}
// The character reference at s[i] ("&amp;", "&#8364;", "&#x20AC;"): { text, len }, or null when it is not one (an unknown name stays as typed).
// A no-break space reads as an ordinary space, as the HTML reader reads it (its whitespace collapse).
function mdEntityAt(s, i) {
  const m = /^&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/.exec(s.slice(i, i + 40));
  if (!m) return null;
  const body = m[1];
  let ch;
  if (body[0] === '#') {
    const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    ch = (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) ? '\uFFFD' : String.fromCodePoint(cp);
  } else {
    ch = mdNamedEntity(body);
    if (ch === undefined) return null;
  }
  if (ch === '\u00a0') ch = ' ';
  return { text: ch, len: m[0].length };
}
// backslash escapes and character references in a link address or title
const mdUnescape = (s) => String(s).replace(/\\([!-\/:-@\[-`{-~])|&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g, (m, esc) => (esc !== undefined ? esc : (mdEntityAt(m, 0) || { text: m }).text));
const mdNormLabel = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase();
const MD_PUNCT_RE = /[\p{P}\p{S}]/u;
const mdIsWs = (c) => c === '' || /\s/.test(c);
const mdIsPunct = (c) => c !== '' && MD_PUNCT_RE.test(c);
const MD_TAG_NAME_OK = /^[A-Za-z][A-Za-z0-9-]*$/;

// Leading tabs are read as four-column tab stops, so indentation is always counted in spaces (the rest of the line is untouched).
function mdExpandTabs(line) {
  if (line.indexOf('\t') < 0) return line;
  let col = 0, k = 0;
  for (; k < line.length; k++) {
    const c = line[k];
    if (c === ' ') col++;
    else if (c === '\t') col += 4 - (col % 4);
    else break;
  }
  return ' '.repeat(col) + line.slice(k);
}
const mdIndent = (line) => { let k = 0; while (line[k] === ' ') k++; return k; };
const mdBlank = (line) => !/[^ \t]/.test(line);
const mdStripIndent = (line, n) => line.slice(Math.min(n, mdIndent(line)));

// ---- block starts ----
const MD_HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const MD_ATX_RE = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const MD_FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const MD_FNDEF_RE = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
const MD_REFDEF_RE = /^ {0,3}\[((?:[^\]\\]|\\.)+)\]:[ \t]*(?:<([^<>\n]*)>|(\S+))(?:[ \t]+(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|\(((?:[^)\\]|\\.)*)\)))?[ \t]*$/;
const MD_HEAD_ATTR_RE = /[ \t]*\{(?:[ \t]*(?:[#.][\w:.-]+|[\w:-]+=(?:"[^"]*"|'[^']*'|[^\s}]+)))+[ \t]*\}[ \t]*$/;
const MD_BLOCK_HTML_NAMES = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const MD_HTML6_RE = new RegExp(`^ {0,3}</?(?:${MD_BLOCK_HTML_NAMES})(?:[ \\t]|/?>|$)`, 'i');
const MD_HTML7_RE = /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>|<\/[A-Za-z][A-Za-z0-9-]*\s*>)[ \t]*$/;
// CommonMark's seven kinds of HTML block (0 = this line does not start one)
function mdHtmlStartType(line) {
  if (!/^ {0,3}</.test(line)) return 0;
  if (/^ {0,3}<(?:script|pre|style|textarea)(?:[ \t>]|$)/i.test(line)) return 1;
  if (/^ {0,3}<!--/.test(line)) return 2;
  if (/^ {0,3}<\?/.test(line)) return 3;
  if (/^ {0,3}<![A-Za-z]/.test(line)) return 4;
  if (/^ {0,3}<!\[CDATA\[/.test(line)) return 5;
  if (MD_HTML6_RE.test(line)) return 6;
  if (MD_HTML7_RE.test(line) && !/^ {0,3}<\/?(?:script|style|pre|textarea)\b/i.test(line)) return 7;
  return 0;
}
// A list marker: { indent, bullet, num, delim, contentCol, rest } or null. contentCol is where the item's content starts.
function mdListMarker(line) {
  if (line.indexOf('\t') > 0) line = line.replace(/^( {0,3}(?:[-+*]|\d{1,9}[.)]))\t/, (mm, a) => a + ' '.repeat(4 - (a.length % 4)));   // a tab after the marker reaches the next tab stop
  const m = /^( {0,3})(?:([-+*])|(\d{1,9})([.)]))(?:( {1,})(.*)|$)/.exec(line);
  if (!m) return null;
  const indent = m[1].length;
  const width = m[2] ? 1 : m[3].length + 1;
  let spaces = m[5] ? m[5].length : 0;
  let rest = m[6] || '';
  if (!m[5] || !rest.trim()) return { indent, bullet: !!m[2], num: m[3] ? parseInt(m[3], 10) : 0, delim: m[4] || '', contentCol: indent + width + 1, rest: '' };
  if (spaces > 4) { rest = ' '.repeat(spaces - 1) + rest; spaces = 1; }          // five or more spaces: the content is indented code
  return { indent, bullet: !!m[2], num: m[3] ? parseInt(m[3], 10) : 0, delim: m[4] || '', contentCol: indent + width + spaces, rest };
}
// Can this line (indented less than four) interrupt a paragraph? (CommonMark 4.8: a fence, heading, break, quotation, a list item with content
// - an ordered one only if it starts at 1 - or an HTML block of kind 1-6)
function mdInterrupts(line) {
  if (!/^ {0,3}\S/.test(line)) return false;
  const f = MD_FENCE_RE.exec(line);
  if (f && !(f[2][0] === '`' && f[3].includes('`'))) return true;
  if (MD_ATX_RE.test(line) || MD_HR_RE.test(line) || /^ {0,3}>/.test(line)) return true;
  const lm = mdListMarker(line);
  if (lm && lm.rest.trim() && (lm.bullet || lm.num === 1)) return true;
  const ht = mdHtmlStartType(line);
  if (ht >= 1 && ht <= 6) return true;
  return MD_FNDEF_RE.test(line);
}
// GFM pipe-table rows: split on the pipes that are not escaped, dropping one leading and one trailing pipe
function mdSplitRow(line) {
  let s = line.trim();
  if (s[0] === '|') s = s.slice(1);
  const cells = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '\\' && k + 1 < s.length) { cur += c + s[k + 1]; k++; continue; }
    if (c === '`') {                                          // a pipe inside a code span belongs to the code (Pandoc's rule; GFM would split there unless it is escaped)
      let e = k;
      while (s[e] === '`') e++;
      const len = e - k;
      let close = -1;
      for (let x = s.indexOf('`', e); x >= 0; ) {
        let y = x;
        while (s[y] === '`') y++;
        if (y - x === len) { close = x; break; }
        x = s.indexOf('`', y);
      }
      if (close >= 0) { cur += s.slice(k, e) + s.slice(e, close).replace(/\\\|/g, '|') + s.slice(close, close + len); k = close + len - 1; }
      else { cur += s.slice(k, e); k = e - 1; }
      continue;
    }
    if (c === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() || !/\|\s*$/.test(line)) cells.push(cur.trim());          // a trailing pipe ends the last cell; text after the last pipe is one more
  return cells;
}
const MD_PIPE_RE = /(^|[^\\])(\\\\)*\|/;
function mdDelimRow(line) {
  if (!line.includes('|') && !/^\s*:?-+:?\s*$/.test(line)) return null;
  if (!/^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(line)) return null;
  if (!line.includes('|')) return null;                                     // a lone "-----" is a setext underline or a break, never a table delimiter
  const cells = mdSplitRow(line);
  return cells.length && cells.every((c) => /^:?-+:?$/.test(c)) ? cells : null;
}
function mdTableAt(lines, i, n) {
  if (i + 1 >= n) return null;
  const head = mdExpandTabs(lines[i]);
  if (mdIndent(head) >= 4 || !MD_PIPE_RE.test(head)) return null;
  const delim = mdDelimRow(mdExpandTabs(lines[i + 1]));
  if (!delim) return null;
  const header = mdSplitRow(head);
  if (header.length !== delim.length) return null;
  const rows = [];
  let j = i + 2;
  while (j < n) {
    const l = mdExpandTabs(lines[j]);
    if (mdBlank(l) || mdIndent(l) >= 4 || mdInterrupts(l)) break;
    rows.push(mdSplitRow(l));
    j++;
  }
  return { node: { k: 'table', header, rows }, next: j };
}

// Does this run of lines end inside an open paragraph (so that a line without the ">" marker would be its lazy continuation)?
function mdEndsInParagraph(lines) {
  let fence = null, open = false;
  for (const raw of lines) {
    const l = mdExpandTabs(raw);
    if (fence) {
      if (new RegExp(`^ {0,3}\\${fence[0]}{${fence.length},}[ \\t]*$`).test(l)) fence = null;
      continue;
    }
    if (mdBlank(l)) { open = false; continue; }
    const f = MD_FENCE_RE.exec(l);
    if (f && !(f[2][0] === '`' && f[3].includes('`'))) { fence = f[2]; open = false; continue; }
    if (mdIndent(l) >= 4) continue;                          // indented code, or more of the paragraph already open
    open = !(MD_ATX_RE.test(l) || MD_HR_RE.test(l) || mdHtmlStartType(l));
  }
  return !fence && open;
}

// ---- the block pass ----
const MD_MAX_DEPTH = 24;                                                   // quotations / lists nested deeper than this are read as plain text
function mdParseBlocks(lines, ctx, depth) {
  const nodes = [];
  const n = lines.length;
  const deep = depth >= MD_MAX_DEPTH;
  let para = null;
  const closePara = () => { if (para) { nodes.push({ k: 'para', lines: para }); para = null; } };
  let i = 0;
  while (i < n) {
    const line = mdExpandTabs(lines[i]);
    if (mdBlank(line)) { closePara(); i++; continue; }
    const ind = mdIndent(line);
    if (ind >= 4) {
      if (para) { para.push(line.replace(/^ +/, '')); i++; continue; }        // an indented line continues a paragraph
      const code = [];
      let j = i;
      while (j < n) {
        const l = mdExpandTabs(lines[j]);
        if (mdBlank(l)) { code.push(''); j++; continue; }
        if (mdIndent(l) < 4) break;
        code.push(l.slice(4));
        j++;
      }
      while (code.length && code[code.length - 1] === '') code.pop();
      if (code.length) nodes.push({ k: 'code', text: code.join('\n') });
      i = j;
      continue;
    }
    let m;
    // fenced code
    if ((m = MD_FENCE_RE.exec(line)) && !(m[2][0] === '`' && m[3].includes('`'))) {
      closePara();
      const fch = m[2][0], flen = m[2].length, find = m[1].length;
      const closeRe = new RegExp(`^ {0,3}\\${fch}{${flen},}[ \\t]*$`);
      const code = [];
      let j = i + 1;
      while (j < n) {
        const l = mdExpandTabs(lines[j]);
        j++;
        if (closeRe.test(l)) break;
        code.push(mdStripIndent(l, find));
      }
      while (code.length && !code[code.length - 1].trim()) code.pop();
      if (code.length) nodes.push({ k: 'code', text: code.join('\n') });
      i = j;
      continue;
    }
    // setext heading: all the paragraph's lines are the heading (CommonMark 4.3)
    if (para && (m = /^ {0,3}(=+|-+)[ \t]*$/.exec(line))) {
      const src = para.join('\n').replace(/[ \t]+$/, '').replace(MD_HEAD_ATTR_RE, '').trim();
      if (src) nodes.push({ k: 'heading', level: m[1][0] === '=' ? 1 : 2, src });
      para = null; i++;
      continue;
    }
    // ATX heading, with its closing # marks and {#id .class} attributes removed
    if ((m = MD_ATX_RE.exec(line))) {
      closePara();
      let text = m[2].trim().replace(MD_HEAD_ATTR_RE, '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '').replace(MD_HEAD_ATTR_RE, '').trim();   // {#id} may follow or precede the closing # marks
      if (text) nodes.push({ k: 'heading', level: m[1].length, src: text });
      i++;
      continue;
    }
    if (MD_HR_RE.test(line)) { closePara(); nodes.push({ k: 'hr' }); i++; continue; }
    // block quotation
    if (!deep && /^ {0,3}>/.test(line)) {
      closePara();
      const inner = [];
      let j = i;
      while (j < n) {
        const l = mdExpandTabs(lines[j]);
        const qm = /^ {0,3}> ?(.*)$/.exec(l);
        if (qm) { inner.push(qm[1]); j++; continue; }
        if (mdBlank(l) || mdInterrupts(l) || !mdEndsInParagraph(inner)) break;
        inner.push(l.replace(/^ +/, ''));                    // a lazy continuation line: more of the quoted paragraph
        j++;
      }
      nodes.push({ k: 'quote', children: mdParseBlocks(inner, ctx, depth + 1) });
      i = j;
      continue;
    }
    // list
    const lm = !deep && mdListMarker(line);
    if (lm && !(para && !(lm.rest.trim() && (lm.bullet || lm.num === 1)))) {
      closePara();
      const r = mdParseList(lines, i, n, ctx, depth);
      nodes.push(r.node);
      i = r.next;
      continue;
    }
    // HTML block
    const ht = mdHtmlStartType(line);
    if (ht && !(ht === 7 && para)) {
      closePara();
      const lo = [];
      let j = i;
      const endRe = ht === 1 ? /<\/(?:script|pre|style|textarea)>/i : ht === 2 ? /-->/ : ht === 3 ? /\?>/ : ht === 4 ? />/ : ht === 5 ? /\]\]>/ : null;
      if (endRe) {
        while (j < n) { const l = lines[j]; lo.push(l); j++; if (endRe.test(l)) break; }
      } else {
        // kinds 6 and 7 end at a blank line; a <table> goes on to its </table> so its rows stay together
        const isTable = /^ {0,3}<table\b/i.test(line);
        let open = 0;
        while (j < n) {
          const l = lines[j];
          if (mdBlank(l) && open <= 0) break;
          lo.push(l); j++;
          if (isTable) open += (l.match(/<table\b/gi) || []).length - (l.match(/<\/table\s*>/gi) || []).length;
        }
      }
      nodes.push({ k: 'html', text: lo.join('\n') });
      i = j;
      continue;
    }
    // footnote definition: [^label]: text, more paragraphs indented four spaces
    if ((m = MD_FNDEF_RE.exec(line))) {
      closePara();
      const def = [m[2]];
      let j = i + 1;
      while (j < n) {
        const l = mdExpandTabs(lines[j]);
        if (mdBlank(l)) {
          let k = j + 1;
          while (k < n && mdBlank(lines[k])) k++;
          if (k < n && mdIndent(mdExpandTabs(lines[k])) >= 4) { for (; j < k; j++) def.push(''); continue; }
          break;
        }
        if (mdIndent(l) >= 4) { def.push(l.slice(4)); j++; continue; }
        if (def[def.length - 1] !== '' && !mdInterrupts(l) && !MD_REFDEF_RE.test(l)) { def.push(l.replace(/^ +/, '')); j++; continue; }   // a wrapped line
        break;
      }
      if (!ctx.fndefs.has(m[1])) ctx.fndefs.set(m[1], { nodes: mdParseBlocks(def, ctx, depth + 1), order: ctx.fndefs.size });
      i = j;
      continue;
    }
    // link reference definition (only at the start of a paragraph); it is used, never shown
    if (!para && (m = MD_REFDEF_RE.exec(line)) && m[1][0] !== '^') {
      const key = mdNormLabel(m[1]);
      if (key && !ctx.refs.has(key)) ctx.refs.set(key, { dest: mdUnescape(m[2] !== undefined ? m[2] : m[3]), title: m[4] ?? m[5] ?? m[6] ?? null });
      i++;
      continue;
    }
    // GFM table
    if (line.includes('|')) {
      const tb = mdTableAt(lines, i, n);
      if (tb) { closePara(); nodes.push(tb.node); i = tb.next; continue; }
      // a pipe-delimited line with no separator row is not a table (A53: its cells read as one paragraph); a lone separator row is dropped
      if (/^ {0,3}\|.*\|[ \t]*$/.test(line)) {
        closePara();
        if (!/^[ \t|:-]*$/.test(line) || !/-/.test(line)) {
          const cells = mdSplitRow(line);
          if (cells.some(Boolean)) nodes.push({ k: 'para', lines: [cells.join(' | ')] });
        }
        i++;
        continue;
      }
    }
    (para ||= []).push(line.replace(/^ +/, ''));
    i++;
  }
  closePara();
  return nodes;
}

// A list: the items of one kind (bullet or numbered) at one level, however they are spaced. An item's content column decides what
// belongs to it; a marker line indented at least two columns past the item's own marker starts a sub-list (so a sub-list under "1."
// may be indented 2, 3 or 4 spaces), and a line wrapped without a marker joins the item (CommonMark 5.2-5.4; a blank line between
// items does not end the list).
function mdParseList(lines, i, n, ctx, depth) {
  const first = mdListMarker(mdExpandTabs(lines[i]));
  const node = { k: 'list', ordered: !first.bullet, start: first.num, items: [] };
  let cur = i;
  while (cur < n) {
    const mk = mdListMarker(mdExpandTabs(lines[cur]));
    if (!mk || mk.bullet !== first.bullet || MD_HR_RE.test(mdExpandTabs(lines[cur]))) break;
    const itemLines = [mk.rest];
    let effCol = mk.contentCol;
    let blanks = 0;
    let sub = false;                                       // a sub-list has begun inside this item
    let j = cur + 1;
    while (j < n) {
      const l = mdExpandTabs(lines[j]);
      if (mdBlank(l)) { blanks++; j++; continue; }
      const ind = mdIndent(l);
      if (!sub && ind >= effCol + 4 && blanks === 0) {     // a marker far to the right, straight under the item's text (a nested list written with tabs or wide steps): a sub-list at that indent, never a jump of levels
        const deep = mdListMarker(l.slice(ind));
        if (deep && deep.rest.trim() && !MD_HR_RE.test(l.slice(ind)) && mdEndsInParagraph(itemLines)) { effCol = ind; sub = true; itemLines.push(l.slice(effCol)); j++; continue; }
      }
      if (ind >= effCol) {
        for (; blanks > 0; blanks--) itemLines.push('');
        const piece = l.slice(effCol);
        if (!sub && mdListMarker(piece)) sub = true;
        itemLines.push(piece);
        j++;
        continue;
      }
      const lm = mdListMarker(l);
      if (lm && !MD_HR_RE.test(l)) {
        if (ind >= mk.indent + 2) {                       // a sub-list indented a little less than this item's content column
          for (; blanks > 0; blanks--) itemLines.push('');
          effCol = ind;
          sub = true;
          itemLines.push(l.slice(effCol));
          j++;
          continue;
        }
        break;                                            // a sibling item (or a list of the other kind)
      }
      const prev = itemLines[itemLines.length - 1];
      if (blanks === 0 && !mdInterrupts(l) && prev !== undefined && prev.trim() && !/^ *(?:`{3,}|~{3,})/.test(prev) && !MD_ATX_RE.test(prev) && !MD_HR_RE.test(prev)) {
        itemLines.push(l.replace(/^ +/, ''));             // a wrapped line of the item's paragraph
        j++;
        continue;
      }
      break;
    }
    node.items.push({ children: mdParseBlocks(itemLines, ctx, depth + 1), num: mk.num, delim: mk.delim });
    cur = j;
  }
  return { node, next: cur };
}

// ---- the inline pass ----
const MD_AUTOLINK_RE = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/y;
const MD_EMAIL_RE = /<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/y;
const MD_OPEN_TAG_RE = /<([A-Za-z][A-Za-z0-9-]*)((?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*)\s*(\/?)>/y;
const MD_CLOSE_TAG_RE = /<\/([A-Za-z][A-Za-z0-9-]*)\s*>/y;
const MD_KNOWN_TAGS = new Set(('a abbr acronym address area article aside audio b base bdi bdo big blockquote body br button canvas caption center cite code col colgroup data datalist dd del details dfn dialog dir div dl dt em embed fieldset figcaption figure font footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p param picture pre progress q rp rt ruby s samp script section select small source span strike strong style sub summary sup svg table tbody td template textarea tfoot th thead time title tr track tt u ul var video wbr').split(' '));
const MD_BOOLEAN_ATTRS = new Set('checked disabled hidden open selected readonly required controls autoplay loop muted async defer download multiple novalidate reversed itemscope'.split(' '));
// Is what looks like a tag at this place really one, or is it prose such as "a<b and c>d" or "Vec<T>"? (CommonMark reads both as tags and so would
// hide their words.) A tag has a familiar name, a hyphen in it (a custom element), a closing tag later in the text or a name="value" attribute,
// and no bare word among its attributes except the boolean ones (checked, hidden...).
function mdRealTag(name, attrs, src, end) {
  const nm = name.toLowerCase();
  const re = /([A-Za-z_:][A-Za-z0-9_.:-]*)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  let am;
  while ((am = re.exec(attrs))) if (!am[2] && !MD_BOOLEAN_ATTRS.has(am[1].toLowerCase())) return false;
  return MD_KNOWN_TAGS.has(nm) || nm.includes('-') || /=/.test(attrs) || src.toLowerCase().indexOf(`</${nm}`, end) >= 0;
}
function mdTagAttrs(str) {
  const at = {};
  const re = /([A-Za-z_:][A-Za-z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(str))) at[m[1].toLowerCase()] = mdUnescape((m[2] ?? m[3] ?? m[4] ?? '').replace(/\\/g, '\\\\'));
  return at;
}
// "(dest "title")" after a link's "]": { dest, title, end } or null (CommonMark 6.3)
// `budget` ({ left }, optional) is the text mdInline lets the link reader scan in all for one paragraph: a text built so that every "](" scans on to
// the end of the paragraph (an unclosed "![a](" repeated, "x \"" repeated) would take quadratic time; once the budget (a few times the
// paragraph's length, far more than any real text needs: a link's scan stops at its first space) is spent, a further "](" is plain text.
function mdLinkTail(src, pos, budget) {
  if (budget && budget.left < 0) return null;
  const n = src.length;
  let k = pos;
  const skipWs = () => { while (k < n && (src[k] === ' ' || src[k] === '\t' || src[k] === '\n')) k++; };
  skipWs();
  let dest;
  if (src[k] === '<') {
    let e = k + 1;
    while (e < n && src[e] !== '>' && src[e] !== '<' && src[e] !== '\n') { if (src[e] === '\\') e++; e++; }
    if (budget) budget.left -= e - k;
    if (src[e] !== '>') return null;
    dest = src.slice(k + 1, e);
    k = e + 1;
  } else {
    let depth = 0, e = k;
    while (e < n) {
      const c = src[e];
      if (c === '\\' && e + 1 < n) { e += 2; continue; }
      if (c === '(') depth++;
      else if (c === ')') { if (depth === 0) break; depth--; }
      else if (c === ' ' || c === '\t' || c === '\n' || c < ' ') break;
      e++;
    }
    if (budget) budget.left -= e - k;
    if (depth !== 0) return null;
    dest = src.slice(k, e);
    k = e;
  }
  const afterDest = k;
  skipWs();
  let title = null;
  if (k > afterDest && (src[k] === '"' || src[k] === "'" || src[k] === '(')) {
    const close = src[k] === '(' ? ')' : src[k];
    let e = k + 1;
    while (e < n && src[e] !== close) { if (src[e] === '\\') e++; e++; }
    if (budget) budget.left -= e - k;
    if (e >= n) return null;
    title = mdUnescape(src.slice(k + 1, e));
    k = e + 1;
    skipWs();
  }
  if (src[k] !== ')') return null;
  return { dest: mdUnescape(dest), title, end: k + 1 };
}
// CommonMark's "process emphasis": the delimiter runs ("*", "_", "~~") inside `nodes` are paired by the flanking and rule-of-3 rules,
// each pair wrapping what lies between them in an em / strong / del node; what is not paired stays as literal text.
function mdProcessEmphasis(nodes, delims) {
  const bottoms = new Map();
  let ci = 0;
  while (ci < delims.length) {
    const closer = delims[ci];
    if (!closer.canClose || closer.n === 0) { ci++; continue; }
    const key = `${closer.ch}${closer.canOpen ? 1 : 0}${closer.orig % 3}`;
    const bottom = bottoms.has(key) ? bottoms.get(key) : -1;
    let found = -1;
    for (let oi = ci - 1; oi > bottom; oi--) {
      const op = delims[oi];
      if (op.ch !== closer.ch || !op.canOpen || op.n === 0) continue;
      if (closer.ch === '~') { found = oi; break; }
      const odd = (closer.canOpen || op.canClose) && closer.orig % 3 !== 0 && (op.orig + closer.orig) % 3 === 0;
      if (!odd) { found = oi; break; }
    }
    if (found < 0) {
      bottoms.set(key, ci - 1);
      if (!closer.canOpen) delims.splice(ci, 1); else ci++;
      continue;
    }
    const op = delims[found];
    const use = closer.ch === '~' ? 2 : (closer.n >= 2 && op.n >= 2 ? 2 : 1);
    const a = nodes.indexOf(op.node), b = nodes.indexOf(closer.node);
    const wrap = { t: closer.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em'), kids: nodes.slice(a + 1, b) };
    nodes.splice(a + 1, b - a - 1, wrap);
    op.n -= use; closer.n -= use;
    op.node.s = op.node.s.slice(0, op.n);                 // the characters nearest the content are the ones used up
    closer.node.s = closer.node.s.slice(use);
    delims.splice(found + 1, ci - found - 1);             // delimiters inside the new span can no longer pair
    ci = found + 1;
    bottoms.clear();
    if (op.n === 0) { nodes.splice(nodes.indexOf(op.node), 1); delims.splice(found, 1); ci--; }
    if (closer.n === 0) { nodes.splice(nodes.indexOf(closer.node), 1); delims.splice(ci, 1); }
  }
}
// Inline source -> nodes: { t:'text', s } | code | math | br | em | strong | del | link | img | html | fnref | inote.
function mdInline(src, ctx) {
  const out = [];
  const delims = [];
  const brackets = [];
  const n = src.length;
  let buf = '';
  let i = 0;
  const linkBudget = { left: n * 4 + 4096 };                     // what mdLinkTail may scan in all (see there)
  const failedTick = new Set();                                  // backtick run lengths with no closing run later in the text (so each search is made once)
  let noDisplayMath = false, noParenMath = false, noBracketMath = false, noComment = false;
  const openTags = new Set();                                    // the unfamiliar tag names opened so far (their closing tags are tags too)
  // `trail` is how many spaces buf ends with, kept up to date by put() so the end of a line never has to read the whole buffer (reading a long
// string built by += copies it all each time: a paragraph of 100,000 lines took 17 s)
  let trail = 0;
  const put = (t) => {
    buf += t;
    const L = t.length;
    if (L && t.charCodeAt(L - 1) === 32) { let k = L; while (k > 0 && t.charCodeAt(k - 1) === 32) k--; trail = k === 0 ? trail + L : L - k; } else if (L) trail = 0;
  };
  const pushText = () => { if (buf) { out.push({ t: 'text', s: buf }); buf = ''; } trail = 0; };
  while (i < n) {
    const c = src[i];
    if (c === '\\') {
      const nx = src[i + 1];
      if (nx === '\n') {                                          // a backslash at the end of a line is a hard break
        pushText(); out.push({ t: 'br' });
        i += 2;
        while (src[i] === ' ' || src[i] === '\t') i++;
        continue;
      }
      if (nx === '(' && !noParenMath) {                           // \( ... \) is inline maths when it holds LaTeX
        const close = src.indexOf('\\)', i + 2);
        if (close < 0) noParenMath = true;
        else if (close > i + 2 && /\\[A-Za-z]|[\^_{}]/.test(src.slice(i + 2, close))) { pushText(); out.push({ t: 'math', latex: src.slice(i + 2, close).trim() }); i = close + 2; continue; }
      } else if (nx === '[' && !noBracketMath) {                  // \[ ... \] likewise (ordinary \[ and \] are escaped brackets)
        const close = src.indexOf('\\]', i + 2);
        if (close < 0) noBracketMath = true;
        else if (close > i + 2 && /\\[A-Za-z]|[\^_{}]/.test(src.slice(i + 2, close))) { pushText(); out.push({ t: 'math', latex: src.slice(i + 2, close).trim() }); i = close + 2; continue; }
      }
      if (nx !== undefined && /[!-\/:-@\[-`{-~]/.test(nx)) { put(nx); i += 2; continue; }   // an escaped punctuation character is that character
      put('\\'); i++;
      continue;
    }
    if (c === '\n') {
      // two or more spaces before the end of the line: a hard break (the spaces dropped); one space already is the soft break; none: add one
      if (trail >= 2) { buf = buf.slice(0, buf.length - trail); trail = 0; pushText(); out.push({ t: 'br' }); }
      else if (trail === 0) put(' ');
      i++;
      while (src[i] === ' ' || src[i] === '\t') i++;
      continue;
    }
    if (c === '`') {                                              // code span: a run of backticks up to the next run of the same length
      let j = i;
      while (src[j] === '`') j++;
      const len = j - i;
      let found = -1;
      if (!failedTick.has(len)) {
        let k = j;
        for (;;) {
          const idx = src.indexOf('`', k);
          if (idx < 0) { failedTick.add(len); break; }
          let e = idx;
          while (src[e] === '`') e++;
          if (e - idx === len) { found = idx; break; }
          k = e;
        }
      }
      if (found >= 0) {
        let code = src.slice(j, found).replace(/\n/g, ' ');
        if (code.length >= 2 && code[0] === ' ' && code[code.length - 1] === ' ' && /[^ ]/.test(code)) code = code.slice(1, -1);
        pushText(); out.push({ t: 'code', s: code });
        i = found + len;
      } else { put(src.slice(i, j)); i = j; }
      continue;
    }
    if (c === '$') {                                              // maths, by Pandoc's rule for "$": the opening one is followed and the closing one preceded by a non-space, the closing one by no digit
      if (src[i + 1] === '$') {
        if (!noDisplayMath) {
          const e = src.indexOf('$$', i + 2);
          if (e < 0) noDisplayMath = true;
          else if (src.slice(i + 2, e).trim()) { pushText(); out.push({ t: 'math', latex: src.slice(i + 2, e).trim() }); i = e + 2; continue; }
        }
        put('$$'); i += 2;
        continue;
      }
      const nx = src[i + 1];
      if (nx !== undefined && !/\s/.test(nx)) {
        let j = i + 1;
        while (j < n && src[j] !== '$') { if (src[j] === '\\') j++; j++; }
        if (j < n && !/\s/.test(src[j - 1]) && !/[0-9]/.test(src[j + 1] || '')) { pushText(); out.push({ t: 'math', latex: src.slice(i + 1, j).trim() }); i = j + 1; continue; }
      }
      put('$'); i++;
      continue;
    }
    if (c === '&') {
      const e = mdEntityAt(src, i);
      if (e) { put(e.text); i += e.len; } else { put('&'); i++; }
      continue;
    }
    if (c === '<') {
      let m;
      MD_AUTOLINK_RE.lastIndex = i;
      if ((m = MD_AUTOLINK_RE.exec(src))) { pushText(); out.push({ t: 'link', href: m[1], kids: [{ t: 'text', s: m[1] }] }); i += m[0].length; continue; }
      MD_EMAIL_RE.lastIndex = i;
      if ((m = MD_EMAIL_RE.exec(src))) { pushText(); out.push({ t: 'link', href: `mailto:${m[1]}`, kids: [{ t: 'text', s: m[1] }] }); i += m[0].length; continue; }
      if (src.startsWith('<!--', i)) {                            // a comment is removed
        const e = noComment ? -1 : src.indexOf('-->', i + 4);
        if (e < 0) noComment = true;
        else { pushText(); i = e + 3; continue; }
      } else if (src[i + 1] === '?' || (src[i + 1] === '!' && /[A-Za-z[]/.test(src[i + 2] || ''))) {   // a processing instruction, declaration or CDATA section
        const closer = src[i + 1] === '?' ? '?>' : (src.startsWith('<![CDATA[', i) ? ']]>' : '>');
        const e = src.indexOf(closer, i + 2);
        if (e >= 0) { pushText(); i = e + closer.length; continue; }
      }
      MD_OPEN_TAG_RE.lastIndex = i;
      if ((m = MD_OPEN_TAG_RE.exec(src)) && mdRealTag(m[1], m[2], src, i + m[0].length)) { pushText(); openTags.add(m[1].toLowerCase()); out.push({ t: 'html', name: m[1].toLowerCase(), close: false, self: !!m[3], attrs: mdTagAttrs(m[2]) }); i += m[0].length; continue; }
      MD_CLOSE_TAG_RE.lastIndex = i;
      if ((m = MD_CLOSE_TAG_RE.exec(src)) && (MD_KNOWN_TAGS.has(m[1].toLowerCase()) || m[1].includes('-') || openTags.has(m[1].toLowerCase()))) { pushText(); out.push({ t: 'html', name: m[1].toLowerCase(), close: true }); i += m[0].length; continue; }
      put('<'); i++;
      continue;
    }
    if (c === '*' || c === '_' || c === '~') {                    // a delimiter run (GFM strikethrough is a run of exactly two tildes)
      let j = i;
      while (src[j] === c) j++;
      const len = j - i;
      if (c === '~' && len !== 2) { put(src.slice(i, j)); i = j; continue; }
      const before = i === 0 ? '' : src[i - 1], after = j >= n ? '' : src[j];
      const wsB = mdIsWs(before), wsA = mdIsWs(after), pB = mdIsPunct(before), pA = mdIsPunct(after);
      const left = !wsA && (!pA || wsB || pB);
      const right = !wsB && (!pB || wsA || pA);
      const canOpen = c === '_' ? left && (!right || pB) : left;
      const canClose = c === '_' ? right && (!left || pA) : right;
      pushText();
      const node = { t: 'text', s: src.slice(i, j) };
      out.push(node);
      delims.push({ node, ch: c, n: len, orig: len, canOpen, canClose });
      i = j;
      continue;
    }
    if (c === '!' && src[i + 1] === '[') {
      pushText();
      const node = { t: 'text', s: '![' };
      out.push(node);
      brackets.push({ node, image: true, active: true, delimIdx: delims.length, pos: i + 2 });
      i += 2;
      continue;
    }
    if (c === '[') {
      if (src[i + 1] === '^' && !ctx.inNote) {                    // a footnote reference [^label] (when the note is defined)
        const fm = /^\[\^([^\]\s]+)\]/.exec(src.slice(i, i + 200));
        if (fm && ctx.fndefs.has(fm[1])) { pushText(); out.push({ t: 'fnref', label: fm[1] }); i += fm[0].length; continue; }
      }
      pushText();
      const node = { t: 'text', s: '[' };
      out.push(node);
      brackets.push({ node, image: false, active: true, delimIdx: delims.length, pos: i + 1 });
      i++;
      continue;
    }
    if (c === '^' && src[i + 1] === '[' && !ctx.inNote) {         // a Pandoc inline note ^[text]
      let depth = 1, j = i + 2;
      while (j < n && depth > 0) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') depth++; else if (d === ']') depth--;
        j++;
      }
      if (depth === 0 && j - 1 > i + 2 && src.slice(i + 2, j - 1).trim()) { pushText(); out.push({ t: 'inote', src: src.slice(i + 2, j - 1) }); i = j; continue; }
      put('^'); i++;
      continue;
    }
    if (c === ']') {
      pushText();
      const op = brackets.pop();
      if (!op || !op.active) { put(']'); i++; continue; }
      const after = i + 1;
      let dest = null, title = null, endPos = -1;
      if (src[after] === '(') { const r = mdLinkTail(src, after + 1, linkBudget); if (r) { dest = r.dest; title = r.title; endPos = r.end; } }
      if (endPos < 0) {                                           // a reference: [text][label], [text][] or [text]
        const own = src.slice(op.pos, i);
        let key = null, end2 = -1;
        if (src[after] === '[') {
          const mm = /^\[((?:[^\[\]\\]|\\.){1,999})\]/.exec(src.slice(after, after + 1002));
          if (mm) { key = mdNormLabel(mm[1]); end2 = after + mm[0].length; }
          else if (src[after + 1] === ']') { key = mdNormLabel(own); end2 = after + 2; }
        } else { key = mdNormLabel(own); end2 = after; }
        const ref = key && ctx.refs.get(key);
        if (ref) { dest = ref.dest; title = ref.title; endPos = end2; }
      }
      if (endPos < 0) { put(']'); i++; continue; }              // not a link: the "[" stays as typed
      const opIdx = out.lastIndexOf(op.node);
      const kids = out.splice(opIdx + 1);
      out.pop();
      mdProcessEmphasis(kids, delims.splice(op.delimIdx));
      out.push(op.image ? { t: 'img', kids, src: dest, title } : { t: 'link', kids, href: dest, title });
      if (!op.image) for (const b of brackets) if (!b.image) b.active = false;   // a link never holds a link
      i = endPos;
      continue;
    }
    put(c); i++;
  }
  pushText();
  mdProcessEmphasis(out, delims);
  return out;
}

const MD_FORMAT_TAGS = {
  b: { tf: 4 }, strong: { tf: 4 }, i: { tf: 1 }, em: { tf: 1 }, cite: { tf: 1 }, var: { tf: 1 }, dfn: { tf: 1 }, u: { tf: 2 },
  s: { ttf: 'strike' }, strike: { ttf: 'strike' }, del: { ttf: 'strike' },
  code: { unc: true }, kbd: { unc: true }, samp: { unc: true }, tt: { unc: true },
};
const MD_VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const MD_HIDDEN_TAGS = new Set(['script', 'style', 'noscript', 'template', 'datalist', 'rp', 'video', 'audio']);   // video / audio: the browser's fallback text, as HTML_DROP_TAGS (#47, Paul 1 Oct 2026)
// the plain words of inline nodes (the alt text of an image, the words of a link label)
function mdPlain(nodes) {
  let s = '';
  for (const nd of nodes) {
    if (nd.t === 'text' || nd.t === 'code') s += nd.s;
    else if (nd.t === 'math') s += nd.latex;
    else if (nd.t === 'br') s += ' ';
    else if (nd.kids) s += mdPlain(nd.kids);
  }
  return s.replace(/\s+/g, ' ').trim();
}
// Inline nodes -> text / math / noteref segments, the way htmlParagraphSegments builds them: emphasis in `tf`, strike in
// `transcriberTypeform`, code in `uncontracted`, a link's address in `href`, a foreign language in `lang`, <sub>/<sup> as the script
// markers inside the text, a forced line break as "\n" (a space where `spaceBreaks`: headings and table cells).
function mdFlatten(nodes, ctx, opts) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  const segs = [];
  let text = '', cur = null, started = false, lastCh = '', openMark = null, qDepth = 0;
  const scripts = [];
  const hst = [];                                                // open inline HTML elements
  const effective = (md) => {
    let { tf, href, ttf, unc, lang } = md;
    let hide = false;
    for (const e of hst) {
      tf |= e.tf || 0;
      if (e.href) href = e.href;
      if (e.ttf) ttf = e.ttf;
      if (e.unc) unc = true;
      if (e.lang !== undefined) lang = e.lang;
      if (e.hide) hide = true;
    }
    return { tf, href, ttf, unc, lang, hide };
  };
  const sameState = (a, b) => a.tf === b.tf && a.href === b.href && a.ttf === b.ttf && a.lang === b.lang && a.unc === b.unc;
  const closeScriptInRun = () => {
    if (openMark === null) return;
    if (text.endsWith(openMark)) text = text.slice(0, -1); else text += end;      // an empty <sup></sup> leaves nothing
    openMark = null;
  };
  const flushRun = () => {
    if (!started) return;
    closeScriptInRun();
    if (text) {
      const seg = { type: 'text', text };
      if (cur.tf) seg.tf = cur.tf;
      if (cur.ttf) seg.transcriberTypeform = cur.ttf;
      if (cur.lang) seg.lang = cur.lang;
      if (cur.unc) seg.uncontracted = true;
      if (cur.href) seg.href = cur.href;
      const prev = segs[segs.length - 1];
      if (prev && prev.type === 'text' && (prev.tf || 0) === (seg.tf || 0) && prev.href === seg.href && prev.transcriberTypeform === seg.transcriberTypeform && prev.lang === seg.lang && !prev.uncontracted === !seg.uncontracted) prev.text += seg.text;
      else segs.push(seg);
    }
    text = ''; started = false; cur = null;
  };
  const startRun = (st) => {
    if (started && !sameState(cur, st)) flushRun();
    if (!started) {
      started = true; cur = st; text = '';
      if (scripts.length) { openMark = scripts[scripts.length - 1] === 'sub' ? subOpen : supOpen; text = openMark; }   // a new run inside a script re-opens it
    }
  };
  const add = (val, md, raw) => {
    const st = effective(md);
    if (st.hide || !val) return;
    if (!raw) val = val.replace(/[ \t]+/g, ' ');
    startRun(st);
    if (!raw && (lastCh === '' || lastCh === ' ' || lastCh === '\n') && val[0] === ' ') val = val.replace(/^ +/, '');   // no double space, none after a line break
    if (!val) return;
    text += val;
    lastCh = val[val.length - 1];
  };
  const br = (md) => {
    if (opts.spaceBreaks) { add(' ', md); return; }
    const st = effective(md);
    if (st.hide) return;
    startRun(st);
    if (lastCh === ' ') text = text.replace(/ +$/, '');         // (only when a space can be there: a regex over the whole text at every break made a long text quadratic)
    text += '\n';                                               // a forced line break, as the HTML <br>
    lastCh = '\n';
  };
  const scriptOpen = (tag, md) => {
    startRun(effective(md));
    if (openMark !== null) closeScriptInRun();                    // a subscript inside a superscript closes the outer one first
    openMark = tag === 'sub' ? subOpen : supOpen;
    text += openMark;
    scripts.push(tag);
  };
  const scriptClose = () => {
    if (!scripts.length) return;
    closeScriptInRun();
    scripts.pop();
    if (scripts.length && started) { openMark = scripts[scripts.length - 1] === 'sub' ? subOpen : supOpen; text += openMark; }
  };
  const nonText = (seg, md) => {
    if (effective(md).hide) return;
    flushRun();
    segs.push(seg);
    lastCh = seg.type === 'math' ? 'm' : 'n';
  };
  const picture = (src, alt, title, md) => {
    if (effective(md).hide) return;
    ctx.pics.push({ type: 'graphic', src: src || '', alt: alt || title || '' });   // the picture is a block before its paragraph (as the HTML reader puts it); a title is the description when there is no alt text
  };
  const htmlTag = (nd, md) => {
    const name = nd.name;
    if (nd.close) {
      let k = hst.length - 1;
      while (k >= 0 && hst[k].name !== name) k--;
      if (k < 0) { if (HTML_BLOCK_TAGS.has(name)) add(' ', md); return; }
      while (hst.length > k) {
        const e = hst.pop();
        if (e.script) scriptClose();
        if (e.q) { qDepth--; add(qDepth % 2 === 0 ? '”' : '’', md); }
        if (e.rt) add(')', md);
      }
      if (HTML_BLOCK_TAGS.has(name)) add(' ', md);
      return;
    }
    const at = nd.attrs || {};
    if (name === 'br') { br(md); return; }
    if (name === 'wbr' || name === 'hr') return;
    if (name === 'img') { picture(at.src, at.alt, at.title, md); return; }
    if (name === 'input') {
      const type = (at.type || 'text').toLowerCase();
      const on = 'checked' in at;
      if (type === 'checkbox') add(on ? '[x] ' : '[ ] ', md);
      else if (type === 'radio') add(on ? '(x) ' : '( ) ', md);
      return;
    }
    if (HTML_BLOCK_TAGS.has(name)) add(' ', md);
    if (MD_VOID_TAGS.has(name) || nd.self) return;
    const e = { name };
    if (MD_FORMAT_TAGS[name]) Object.assign(e, MD_FORMAT_TAGS[name]);
    if (name === 'a' && at.href) e.href = at.href;
    if (at.lang !== undefined) e.lang = foreignLangOf(at.lang, ctx.mainLang) || null;
    if (MD_HIDDEN_TAGS.has(name) || 'hidden' in at) e.hide = true;
    if (name === 'sub' || name === 'sup') { scriptOpen(name, md); e.script = true; }
    if (name === 'q') { add(qDepth % 2 === 0 ? '“' : '‘', md); qDepth++; e.q = true; }
    if (name === 'rt') { add(' (', md); e.rt = true; }
    hst.push(e);
  };
  const walk = (list, md) => {
    for (const nd of list) {
      switch (nd.t) {
        case 'text': add(nd.s, md); break;
        case 'code': add(nd.s, { ...md, unc: true }, true); break;
        case 'math': nonText({ type: 'math', latex: nd.latex }, md); break;
        case 'br': br(md); break;
        case 'em': walk(nd.kids, { ...md, tf: md.tf | TF_ITALIC }); break;
        case 'strong': walk(nd.kids, { ...md, tf: md.tf | TF_BOLD }); break;
        case 'del': walk(nd.kids, { ...md, ttf: 'strike' }); break;
        case 'link': walk(nd.kids, nd.href ? { ...md, href: nd.href } : md); break;
        case 'img': picture(nd.src, mdPlain(nd.kids), nd.title, md); break;
        case 'html': htmlTag(nd, md); break;
        case 'fnref': { const e = ctx.noteFor(nd.label); nonText({ type: 'noteref', text: e.mark, idref: e.idref }, md); break; }
        case 'inote': { const e = ctx.inlineNote(nd.src); nonText({ type: 'noteref', text: e.mark, idref: e.idref }, md); break; }
        default: break;
      }
    }
  };
  walk(nodes, { tf: 0, href: null, ttf: null, unc: false, lang: null });
  while (hst.length) { const e = hst.pop(); if (e.script) scriptClose(); }
  flushRun();
  return htmlTrimSegs(segs);
}

// ---- the render pass: block nodes -> model blocks ----
const mdFlatSegs = (segs) => segs.map((g) => (g.type === 'math' ? `$${g.latex}$` : (g.text || ''))).join('').replace(/\s+/g, ' ').trim();
// one paragraph-like piece of inline source -> its segments and the pictures it held
function mdInlineBlock(src, ctx, spaceBreaks) {
  const saved = ctx.pics;
  ctx.pics = [];
  const segs = mdFlatten(mdInline(src, ctx), ctx, { spaceBreaks });
  const pics = ctx.pics;
  ctx.pics = saved;
  return { segs, pics };
}
const mdParaBlock = (segs) => {
  // A paragraph that is only one equation ($$…$$ on its own line, or $…$) is displayed maths, as the editor and the NIMAS reader
  // take it — else a trip to the Advanced editor and back changed Quick Mode's braille (A89, the nightly random-action run).
  const solid = segs.filter((g) => g && (g.type !== 'text' || String(g.text || '').trim()));
  if (solid.length === 1 && solid[0].type === 'math') { const { type, ...m } = solid[0]; return { type: 'math', ...m }; }
  if (htmlSegsCarryMarkup(segs)) return { type: 'para', segments: segs };
  const t = htmlSegsFlat(segs);
  return t ? { type: 'para', text: t } : null;
};
// An HTML block is cut where Markdown cuts it (at a blank line), so it may open a tag that a later block closes, or close one opened earlier:
// the open tags are closed and the stray closing tags dropped, so the HTML reader is given a whole fragment.
const MD_HTML_TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))?)*)\s*(\/?)>/g;
function mdBalanceHtml(src) {
  const stack = [];
  const out = src.replace(MD_HTML_TAG_RE, (m, slash, name, attrs, self) => {
    const nm = name.toLowerCase();
    if (MD_VOID_TAGS.has(nm) || self) return m;
    if (!slash) { stack.push(nm); return m; }
    const k = stack.lastIndexOf(nm);
    if (k < 0) return '';                                                            // a closing tag with no opening tag here
    const closed = stack.splice(k).slice(1).reverse().map((t) => `</${t}>`).join('');   // what was open inside it is closed first
    return closed + m;
  });
  return out + stack.reverse().map((t) => `</${t}>`).join('');
}
// An HTML block is read by the HTML reader itself; an <hr> (which it leaves out) is a break; comments are removed.
function mdHtmlBlocks(text, ctx) {
  const clean = text.replace(/<!--[\s\S]*?-->/g, '');
  if (!clean.trim()) return [];
  const out = [];
  clean.split(/<hr\b[^>]*>/gi).forEach((piece, k) => {
    if (k) out.push({ type: 'break', kind: 'line' });
    if (!piece.trim()) return;
    const whole = mdBalanceHtml(piece);
    try {
      out.push(...parseHtml(whole, { mainLang: ctx.mainLang, rawLang: true }).blocks);
    } catch {
      const t = whole.replace(/<(?:style|script)\b[\s\S]*?<\/(?:style|script)>/gi, ' ').replace(MD_HTML_TAG_RE, ' ').replace(/\s+/g, ' ').trim();   // a fragment the parser will not take: its words
      if (t) out.push({ type: 'para', text: t });
    }
  });
  return out;
}
const MD_ATTRIBUTION_RE = /^(?:[—―]|--+[ \t])[ \t]*\S/;
function mdRenderQuote(node, ctx) {
  let kids = node.children;
  let attribution = null;
  const last = kids[kids.length - 1];
  if (last && last.k === 'para') {                                // an attribution line ("— Name", "-- Name") closing the quotation is its own block, as the HTML reader makes a <footer> / <cite>
    const ln = last.lines[last.lines.length - 1];
    if (MD_ATTRIBUTION_RE.test(ln) && (last.lines.length > 1 || kids.length > 1)) {
      attribution = ln;
      kids = last.lines.length > 1 ? [...kids.slice(0, -1), { k: 'para', lines: last.lines.slice(0, -1) }] : kids.slice(0, -1);
    }
  }
  const made = mdRenderBlocks(kids, ctx);
  if (attribution) {
    const { segs, pics } = mdInlineBlock(attribution, ctx, true);
    made.push(...pics);
    if (segs.length) {
      const t = mdFlatSegs(segs);
      made.push(htmlSegsCarryMarkup(segs) ? { type: 'attribution', text: t, segments: segs } : { type: 'attribution', text: t });
    }
  }
  for (const b of made) {
    if (b.type === 'para' && !b.style) b.style = 'quote';
    else if (b.type === 'heading') b.displayed = true;
  }
  if (made.length > 1 || (made.length === 1 && made[0].type !== 'para')) {       // one id for everything in the quotation, nested quotations included (as the HTML reader)
    const id = ++ctx.bq;
    for (const b of made) b.blockquoteId = id;
  }
  return made;
}
// A list node -> flat items with `level`: an item's first paragraph is its text, its other blocks are item.blocks, its sub-lists follow at level + 1.
function mdRenderList(node, ctx, level, items) {
  let counter = node.start;
  for (const it of node.items) {
    const kids = it.children;
    let head = null, rest = kids;
    if (kids.length && (kids[0].k === 'para' || kids[0].k === 'heading')) { head = kids[0]; rest = kids.slice(1); }
    const subLists = rest.filter((k) => k.k === 'list');
    const others = rest.filter((k) => k.k !== 'list');
    let raw = head ? (head.k === 'para' ? head.lines.join('\n').replace(/[ \t]+$/, '') : head.src) : '';
    if (head && head.k === 'para') raw = raw.replace(/^\[([ xX])\][ \t]+(?=\S)/, (m, ch) => (ch === ' ' ? '\\[ \\] ' : '\\[x\\] '));   // a task-list box reads "[ ]" / "[x]", as the HTML reader reads a check box
    const { segs, pics } = mdInlineBlock(raw, ctx, false);
    const mark = node.ordered ? `${counter}${it.delim}` : '•';
    counter++;
    const inner = others.length ? mdRenderBlocks(others, ctx) : [];
    const blocks = [...pics, ...inner];
    if (segs.length || blocks.length) {
      const text = mdFlatSegs(segs);
      const item = segs.length && htmlSegsCarryMarkup(segs) ? { segments: segs, text } : { text };
      item.marker = mark;
      if (!node.ordered) stripDuplicateBullet(item);
      if (level > 0) item.level = level;
      if (blocks.length) item.blocks = blocks;
      items.push(item);
    }
    for (const sub of subLists) mdRenderList(sub, ctx, level + 1, items);
  }
}
function mdRenderBlocks(nodes, ctx) {
  const out = [];
  ctx.renderDepth++;
  for (const node of nodes) {
    switch (node.k) {
      case 'para': {
        const { segs, pics } = mdInlineBlock(node.lines.join('\n').replace(/[ \t]+$/, ''), ctx, false);
        out.push(...pics);
        const b = segs.length ? mdParaBlock(segs) : null;
        if (b) out.push(b);
        break;
      }
      case 'heading': {
        const { segs, pics } = mdInlineBlock(node.src, ctx, true);
        out.push(...pics);
        if (!segs.length) break;
        const text = mdFlatSegs(segs);
        const carry = htmlSegsCarryMarkup(segs);
        if (node.level === 1 && !ctx.title && ctx.renderDepth === 1) {
          ctx.title = text;
          out.push(carry ? { type: 'title', segments: segs, text } : { type: 'title', text });
        } else out.push(carry ? { type: 'heading', level: node.level, segments: segs, text } : { type: 'heading', level: node.level, text });
        break;
      }
      case 'hr': out.push({ type: 'break', kind: 'line' }); break;
      case 'code': out.push({ type: 'code', text: node.text }); break;
      case 'html': out.push(...mdHtmlBlocks(node.text, ctx)); break;
      case 'quote': out.push(...mdRenderQuote(node, ctx)); break;
      case 'list': {
        const items = [];
        mdRenderList(node, ctx, 0, items);
        if (items.length) out.push({ type: 'list', items });
        break;
      }
      case 'table': {
        const saved = ctx.pics;
        ctx.pics = [];
        const cell = (raw) => {
          const segs = mdFlatten(mdInline(raw, ctx), ctx, { spaceBreaks: true });
          return richCellFromSegments(segs) || htmlSegsFlat(segs);
        };
        const headers = node.header.map(cell);
        const rows = [];
        for (const r of node.rows) {
          const cells = r.map(cell);
          while (cells.length < headers.length) cells.push('');
          if (cells.some(Boolean)) rows.push(cells);
        }
        out.push({ type: 'table', headers, rows }, ...ctx.pics);       // a picture in a cell follows the table, as in the HTML reader
        ctx.pics = saved;
        break;
      }
      default: break;
    }
  }
  ctx.renderDepth--;
  return out;
}

// mdBook's <Listing number="8-1" caption="…"> … </Listing> (the Rust book; overnight question 5, import fix list #53, Paul 1 Oct
// 2026): the caption is read as a caption block after the listing's contents, where mdBook shows it — "Listing 8-1: caption" — its
// text read as Markdown (inline code stays code). The tag lines become blank lines (the contents are parsed as they were); the
// caption line goes in marked with MD_LISTING_MARK and mdListingCaptions makes it a caption block. Not inside a code fence.
const MD_LISTING_MARK = '\uE0F1';
const mdAttr = (attrs, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs); return m ? String(m[2] ?? m[3] ?? '').replace(/&[#A-Za-z0-9]{1,32};/g, (e) => { const r = mdEntityAt(e, 0); return r ? r.text : e; }) : null; };
function mdBookListings(lines) {
  const out = [], open = [];
  let fence = null;
  for (const line of lines) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; out.push(line); continue; }
    if (fence) { out.push(line); continue; }
    let m;
    if ((m = /^ {0,3}<Listing\b([^>]*)>\s*$/.exec(line))) {
      const num = mdAttr(m[1], 'number'), cap = mdAttr(m[1], 'caption');
      open.push(num || cap ? `Listing${num ? ` ${num}` : ''}${cap ? `: ${cap}` : ''}` : null);
      out.push('');
      continue;
    }
    if (/^ {0,3}<\/Listing>\s*$/.test(line)) {
      const cap = open.pop();
      out.push('');
      if (cap) out.push(MD_LISTING_MARK + cap.replace(/^[ \t]+/, ''), '');
      continue;
    }
    out.push(line);
  }
  return out;
}
function mdListingCaptions(blocks) {
  return blocks.map((b) => {
    if (!b || typeof b !== 'object') return b;
    if (Array.isArray(b.blocks)) b = { ...b, blocks: mdListingCaptions(b.blocks) };
    if (b.type !== 'para') return b;
    const lead = Array.isArray(b.segments) && b.segments.length ? String(b.segments[0].text ?? '') : String(b.text ?? '');
    if (!lead.startsWith(MD_LISTING_MARK)) return b;
    const cap = { ...b, type: 'caption' };
    if (typeof cap.text === 'string') cap.text = cap.text.replace(MD_LISTING_MARK, '');
    if (Array.isArray(cap.segments) && cap.segments.length) cap.segments = [{ ...cap.segments[0], text: String(cap.segments[0].text).replace(MD_LISTING_MARK, '') }, ...cap.segments.slice(1)];
    return cap;
  });
}
export function parseMarkdown(str, _opts = null) {
  let s = String(str ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let title = null;
  // YAML front matter at the very top (---, then "key: value" lines, then --- or ...): its title and language are used. A top "---" with
  // no such block after it is a thematic break.
  const fmMatch = s.match(/^---[ \t]*\n(?=[^\s#][^:\n]*:(?:[ \t]|\n|$))([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/);
  // Foreign-language passages: inline `<span lang="fr">…</span>` (input/lang.mjs); the document's own language is the front matter's
  // `lang:` / `language:`, else English.
  const mainLang = (fmMatch && (fmMatch[1].match(/^lang(?:uage)?:\s*["']?([A-Za-z-]+)/m) || [])[1]) || null;
  if (fmMatch) {
    const titleMatch = fmMatch[1].match(/^title:\s*(.+)$/m);
    if (titleMatch) title = titleMatch[1].replace(/^["']|["']$/g, '').trim();
    s = s.slice(fmMatch[0].length);
  }
  const ctx = {
    refs: new Map(),                 // link reference definitions: label -> { dest, title }
    fndefs: new Map(),               // footnote definitions: label -> { nodes, order }
    notes: new Map(),                // built notes, for placeHtmlNotes: idref -> { block, placed }
    noteByLabel: new Map(), noteOrder: [], noteSeq: 0,
    pics: [], inNote: false, bq: 0, title, mainLang, renderDepth: 0,
  };
  ctx.noteFor = (label) => {         // a footnote reference: numbered in order of first reference
    let e = ctx.noteByLabel.get(label);
    if (!e) { e = { mark: String(++ctx.noteSeq), idref: `md-fn-${label}` }; ctx.noteByLabel.set(label, e); ctx.noteOrder.push(label); }
    return e;
  };
  ctx.inlineNote = (content) => {    // a Pandoc inline note ^[text]
    const n = ++ctx.noteSeq;
    const idref = `md-inl-${n}`;
    const saved = ctx.inNote;
    ctx.inNote = true;
    const { segs } = mdInlineBlock(content, ctx, true);
    ctx.inNote = saved;
    const para = segs.length ? mdParaBlock(segs) : null;
    const note = para ? htmlMakeNote([para], 'footnote', idref) : null;
    if (note) ctx.notes.set(idref, { block: note, placed: false });
    return { mark: String(n), idref };
  };
  const nodes = mdParseBlocks(mdBookListings(s.split('\n')), ctx, 0);
  const blocks = mdListingCaptions(mdRenderBlocks(nodes, ctx));
  // the notes: read where they are cited (placeHtmlNotes puts each right after the block that cites it); a definition nobody cites is kept at the end
  const buildNote = (label, idref) => {
    ctx.inNote = true;
    const saved = ctx.renderDepth;
    ctx.renderDepth = 1;
    const body = mdRenderBlocks(ctx.fndefs.get(label).nodes, ctx);
    ctx.renderDepth = saved;
    ctx.inNote = false;
    const note = htmlMakeNote(body, 'footnote', idref);
    if (note) ctx.notes.set(idref, { block: note, placed: false });
  };
  for (const label of ctx.noteOrder) buildNote(label, ctx.noteByLabel.get(label).idref);
  for (const [label] of [...ctx.fndefs].sort((a, b) => a[1].order - b[1].order)) if (!ctx.noteByLabel.has(label)) buildNote(label, `md-fn-${label}`);
  placeHtmlNotes(blocks, ctx.notes);
  return finishLanguages({ title: ctx.title, blocks });   // foreign-language noise dropped over the whole document (input/lang.mjs)
}

// ---------- RTF ----------
// A44/D5/D6: a real recursive-descent RTF reader, replacing the old flat "strip every
// control word, split on \par" approach that produced title+para blocks only and — worse —
// spliced a {\footnote…} destination's own text into the middle of the paragraph that
// referenced it (D6). RTF is brace-nested, not a tree, so this walks the token stream with
// one recursive function per group: `parseContent` consumes tokens until ITS OWN matching
// '}' (every '{' it meets is fully consumed, matching close included, by `handleGroup`
// before the loop continues), so brace-scoped state — character formatting (`ctx.tf`/
// `ctx.href`), destinations (footnote/field/pict/list marker) — falls out of normal JS call
// nesting instead of a hand-rolled stack. `ctx` (tf/href/fieldHrefBox) is cloned per group,
// exactly matching RTF's own group-scoped formatting; `collector` (blocks/para-in-progress/
// paragraph-level style state) is passed by reference and represents one text stream — the
// main document, or a `{\footnote…}`'s own body, which gets its own collector so its blocks
// come out separately instead of merging into the surrounding paragraph (the D6 fix).
// Produces the SAME block/segment shapes A45/A46/A47/A48 already established for DOCX/ODT/
// HTML — {type:'heading'|'title'|'para'|'list'|'table'|'graphic'|'footnote'}, segments
// carrying `.tf` (liblouis TYPEFORM bits) / `.href`, `{type:'noteref'}` in place plus a
// `{type:'footnote'}` block right after — no new shapes invented.
function extractRtfStylesheet(s) {
  // A48-style precedence needs the stylesheet's own heading/title styles (\s<N> with an
  // \outlinelevel, or named "heading N"/"Title"/"Subtitle") available BEFORE the main token
  // walk reaches a paragraph using them, so this is a separate first pass over the raw
  // string — the {\stylesheet …} group itself is later just an ordinary skipped destination
  // to the main walk (see SKIP_KEYWORDS).
  const map = new Map();                                  // id (string) -> {outlineLvl, basedOn, name}
  const m = /\{\\(?:\*\\)?stylesheet\b/i.exec(s);
  if (!m) return map;
  const start = m.index;
  let depth = 0, end = s.length;
  for (let k = start; k < s.length; k++) {
    const c = s[k];
    if (c === '\\') { k++; continue; }                    // skip escaped char so \{ \} \\ never miscount depth
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  const group = s.slice(start, end);
  let d = 0, childStart = -1;
  for (let k = 0; k < group.length; k++) {
    const c = group[k];
    if (c === '\\') { k++; continue; }
    if (c === '{') { d++; if (d === 2) childStart = k; }
    else if (c === '}') {
      if (d === 2 && childStart >= 0) {
        parseRtfStyleEntry(group.slice(childStart, k + 1), map);
        childStart = -1;
      }
      d--;
    }
  }
  return map;
}

function parseRtfStyleEntry(child, map) {
  const sm = /^\{\\s(\d+)\b/.exec(child);
  if (!sm) return;                                        // a character style ({\*\cs…}) or other destination -> not ours
  const outlineM = /\\outlinelevel(\d+)/.exec(child);
  const basedOnM = /\\sbasedon(\d+)/.exec(child);
  const liM = /\\li(-?\d+)/.exec(child);                  // the style's left indent (twips): a list item's further paragraph is indented
  // Pre-existing bug found while fixing the RTF title fallback (26 Sep 2026): `child` is the
  // WHOLE destination, its own outer { } included (extractRtfStylesheet's own slice, above) —
  // stripping "any {…} with no braces inside" over-matched that outer pair too whenever the
  // entry had no nested group of its own (the overwhelmingly common case: "{\s17 Title;}" has
  // none), wiping the entry's own text and leaving `name` permanently ''. Outline-level
  // detection (outlineM, just above) never depended on `stripped`, so it kept working — only
  // the two NAME-based signals (a "heading N" style name, and "Title"/"Subtitle" — the second
  // one this task's own real-title-signal list needs working) were silently broken. Dropping
  // the entry's own outer braces first, so the nested-group regex only ever sees genuine
  // nested groups, fixes both without changing outline-level handling at all.
  const stripped = child.slice(1, -1)
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
    .replace(/\\[a-zA-Z]+-?\d*/g, ' ')
    .replace(/[{}]/g, ' ')
    .trim();
  const nameM = /([^;]+);\s*$/.exec(stripped);
  map.set(sm[1], {
    outlineLvl: outlineM ? Number(outlineM[1]) : null,
    basedOn: basedOnM ? basedOnM[1] : null,
    name: nameM ? nameM[1].trim() : '',
    li: liM ? Number(liM[1]) : null,
  });
}

// A48-equivalent precedence for RTF: an explicit \outlinelevel (0-8; 9 is Word's own "body
// text, no real level" sentinel and is deliberately never a heading) on the NEAREST style in
// the \sbasedon chain that sets one at all; failing that a "heading N" name on the style's
// own name (never an ancestor's, so it can't leak across an unrelated chain); failing that
// "Title"/"Subtitle" as an exact id/name match. A direct per-paragraph \outlinelevel (see
// endParagraph) always wins over all of this — the author's own explicit override.
function classifyRtfStyle(id, styleMap) {
  if (id == null) return null;
  let cur = String(id);
  const seen = new Set();
  let first = true;
  while (cur != null && !seen.has(cur) && seen.size < 20) {
    seen.add(cur);
    const st = styleMap.get(cur);
    if (!st) break;
    if (Number.isFinite(st.outlineLvl) && st.outlineLvl >= 0 && st.outlineLvl <= 8) return { kind: 'heading', level: st.outlineLvl + 1 };
    if (first) {
      const nameHm = /^heading\s*([1-9])\b/i.exec(st.name || '');
      if (nameHm) return { kind: 'heading', level: Number(nameHm[1]) };
      if (/^(title|subtitle)$/i.test(st.name || '')) return { kind: 'title', subtitle: /^subtitle$/i.test(st.name || '') };   // IMP-W1
    }
    // Import fix list #43: Word's Quote / Intense Quote / Block Text, LibreOffice's Quotations, and any style based on one of
    // them, is a quotation paragraph, as the Word (classifyDocxStyle) and ODT readers make it.
    if (/^(quote|intense quote|block text|quotations?)$/i.test(String(st.name || '').trim())) return { kind: 'quote' };
    first = false;
    cur = st.basedOn;
  }
  return null;
}

// Import fix list #48: Word's Caption style (a name holding "caption": Caption, Figure Caption, LibreOffice's "caption"), or a style based on
// one — the paragraph style parseDocx (isCaptionStyle, A45/D1) joins to the picture before it.
function rtfStyleIsCaption(id, styleMap) {
  if (id == null) return false;
  let cur = String(id);
  const seen = new Set();
  while (cur != null && !seen.has(cur) && seen.size < 20) {
    seen.add(cur);
    const st = styleMap.get(cur);
    if (!st) return false;
    if (/caption/i.test(st.name || '')) return true;
    cur = st.basedOn;
  }
  return false;
}

// Destinations with no \* prefix that a strict-spec writer may still emit unmarked (a \*
// version of any of these is also caught, generically, by the "unknown ignorable \*
// destination -> skip" rule in handleGroup). `object` (OLE) is handled separately, by
// handleObject/handleGroup below — see the RTF \object section just above parseRtf's own
// closing brace for what it now reads.
const RTF_SKIP_KEYWORDS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'generator', 'header', 'headerf', 'headerl', 'headerr',
  'footer', 'footerf', 'footerl', 'footerr', 'listtable', 'listoverridetable', 'xmlnstbl',
  'revtbl', 'rsidtbl', 'themedata', 'colorschememapping', 'latentstyles', 'panose', 'datafield',
  'bkmkstart', 'bkmkend', 'template', 'doccomm', 'filetbl',
]);
const RTF_BLIP_KEYWORDS = new Set(['pngblip', 'jpegblip', 'emfblip', 'wmetafile', 'dibitmap', 'macpict', 'pmmetafile']);
// pngblip/jpegblip carry their bytes straight through. emfblip/wmetafile (metafile.mjs:
// metafileToSvg) and dibitmap (metafile.mjs: dibToPngBytes) are converted below, in
// handlePicture; macpict/pmmetafile (legacy Mac PICT) are still not decoded.
const RTF_BLIP_EXT = { pngblip: 'png', jpegblip: 'jpg' };
const RTF_BLIP_MIME = { png: 'image/png', jpg: 'image/jpeg' };

// RTF hex-data destinations (\pict, \objdata) as plain text -> raw bytes: strip everything
// but hex digits (real files wrap the hex in \r\n every so often), then decode byte pairs.
function hexToBytes(hex) {
  const clean = String(hex).replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let k = 0; k < out.length; k++) out[k] = parseInt(clean.substr(k * 2, 2), 16);
  return out;
}

// RTF \object: `{\object\objemb{\*\objclass Equation.3}…{\*\objdata <hex>}{\result …}}` (or
// \objlink for a LINKED, not embedded, object — RTF_LINKED_OBJECT_PLACEHOLDER below, never
// read: a link has no native data of its own worth decoding here). \objdata hex-decodes to
// an OLE1 "ObjectHeader"/"EmbeddedObject" structure ([MS-OLEDS] 2.2.4/2.2.5): OLEVersion (4
// bytes) + FormatID (4 bytes, neither used here), three LengthPrefixedAnsiString fields
// (ClassName/TopicName/ItemName — a little-endian u32 byte count INCLUDING the trailing NUL,
// then that many ANSI bytes; their content is unused here, objClass already comes from the
// sibling \*\objclass destination), then NativeDataSize (4 bytes) and that many bytes of
// NativeData — for a Word-embedded object (an Equation Editor 3.0 / MathType equation, an
// Excel range, …) an OLE2 compound file (cfb.mjs), exactly like a .docx's own
// word/embeddings/oleObjectN.bin (see docxLegacyEquationMathml/readDocxOleEquations, above,
// for the same structure one layer up). Throws on anything truncated/malformed; the caller
// (handleObject, below) treats that exactly like mtef.mjs's own "could not be read".
function parseOle1EmbeddedObject(bytes) {
  if (bytes.length < 8) throw new Error('RTF \\objdata: OLE1 object header is too short');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;                                              // OLEVersion(4) + FormatID(4): not needed here
  const skipLenStr = () => {
    if (pos + 4 > bytes.length) throw new Error('RTF \\objdata: OLE1 object header is truncated');
    const len = dv.getUint32(pos, true);
    pos += 4;
    if (pos + len > bytes.length) throw new Error('RTF \\objdata: OLE1 object header string is truncated');
    pos += len;
  };
  skipLenStr(); skipLenStr(); skipLenStr();                 // ClassName, TopicName, ItemName
  if (pos + 4 > bytes.length) throw new Error('RTF \\objdata: OLE1 object header has no NativeDataSize');
  const nativeSize = dv.getUint32(pos, true);
  pos += 4;
  if (pos + nativeSize > bytes.length) throw new Error('RTF \\objdata: OLE1 native data is truncated');
  return bytes.subarray(pos, pos + nativeSize);
}
// PROVISIONAL wording (as LEGACY_EQUATION_PLACEHOLDER/oleNotTranscribedPlaceholder above) —
// open question for Paul. A linked (not embedded) object carries no native data of its own
// in \objdata worth reading (it is a pointer to an external file/location), so this is never
// even attempted — unlike the embedded-but-unreadable case, there is nothing here that
// COULD have been read.
const RTF_LINKED_OBJECT_PLACEHOLDER = 'linked object not included';

// ---- RTF import batch (30 Sep 2026): fonts, code pages, lists, shapes --------------------------------------------------
// A font's Windows character set (\fcharsetN) -> the code page its \'hh bytes are written in (RTF 1.9.1, "Font Table").
// Charset 0/1 (ANSI/default) means the document's own \ansicpgN; 2 is the symbol charset (handled as a symbol font).
const RTF_CHARSET_CP = { 77: 10000, 128: 932, 129: 949, 134: 936, 136: 950, 161: 1253, 162: 1254, 163: 1258, 177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250 };
// The WHATWG TextDecoder label of each code page the reader knows (Windows code pages, the four East Asian double-byte
// ones, Mac Roman). Anything else falls back to Windows-1252, as before.
const RTF_CP_LABEL = {
  1250: 'windows-1250', 1251: 'windows-1251', 1252: 'windows-1252', 1253: 'windows-1253', 1254: 'windows-1254',
  1255: 'windows-1255', 1256: 'windows-1256', 1257: 'windows-1257', 1258: 'windows-1258', 874: 'windows-874',
  932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 10000: 'macintosh', 866: 'ibm866', 65001: 'utf-8',
};
const rtfDecoders = new Map();
function rtfDecodeBytes(bytes, cp) {
  const label = RTF_CP_LABEL[cp] || 'windows-1252';
  let dec = rtfDecoders.get(label);
  if (!dec) {
    try { dec = new TextDecoder(label); } catch { dec = new TextDecoder('windows-1252'); }
    rtfDecoders.set(label, dec);
  }
  return dec.decode(Uint8Array.from(bytes));
}
// {\fonttbl{\f0\fswiss\fcharset0 Arial;}{\f3\fnil\fcharset2 Symbol;}} (or the bare \f0\fswiss Arial; form) -> Map of font
// number (string) -> { name, charset, cpg }. Read from the raw text, like the stylesheet: the main walk skips the table.
function extractRtfFonts(s) {
  const map = new Map();
  const m = /\{\\(?:\*\\)?fonttbl\b/.exec(s);
  if (!m) return map;
  let depth = 0, cur = null, skipDepth = 0;
  const done = () => {
    if (cur) { cur.name = cur.name.replace(/\s+/g, ' ').trim(); if (!map.has(cur.id)) map.set(cur.id, cur); }
    cur = null;
  };
  for (let k = m.index; k < s.length; k++) {
    const c = s[k];
    if (c === '{') {
      depth++;
      if (depth > 1 && /^\{\\\*/.test(s.slice(k, k + 4)) && !skipDepth) skipDepth = depth;   // \*\falt, \*\panose: not the name
      continue;
    }
    if (c === '}') {
      if (skipDepth && depth === skipDepth) skipDepth = 0;
      depth--;
      if (depth === 0) break;
      if (depth === 1 && cur) done();                 // a wrapped entry closed without its ';'
      continue;
    }
    if (skipDepth || depth > 3) continue;
    if (c === '\\') {
      const w = /^\\([a-zA-Z]+)(-?\d+)?/.exec(s.slice(k, k + 40));
      if (w) {
        k += w[0].length - 1;
        if (s[k + 1] === ' ') k++;
        if (w[1] === 'f' && w[2] != null) { done(); cur = { id: w[2], name: '', charset: null, cpg: null }; }
        else if (cur && w[1] === 'fcharset' && w[2] != null) cur.charset = Number(w[2]);
        else if (cur && w[1] === 'cpg' && w[2] != null) cur.cpg = Number(w[2]);
      } else if (s[k + 1] === "'") { k += 3; }
      else k++;
      continue;
    }
    if (c === '\r' || c === '\n' || !cur) continue;
    if (c === ';') { done(); continue; }
    cur.name += c;
  }
  done();
  return map;
}
const rtfIsSymbolFont = (f) => !!f && (f.charset === 2 || KNOWN_SYMBOL_FONTS.has(String(f.name || '').trim().toLowerCase()));
// A character U+F020-U+F0FF (how LibreOffice writes a Symbol/Wingdings bullet: \u-3913) or a raw byte read in a symbol font
// is that font's character at that byte: the same tables as the Word reader's w:sym (wordSymGlyph). An unmapped one becomes
// U+FFFD, as there. A font that is not one of the known symbol fonts has no table at all, so that is the only possible answer.
function rtfSymbolText(font, text) {
  const name = String(font.name || '').trim();
  const known = KNOWN_SYMBOL_FONTS.has(name.toLowerCase());
  // In a known symbol font the plain printable ASCII characters are symbols too (a Word SYMBOL field's result is the bare character 'a' for alpha).
  const re = known ? /[\u0021-\u007E\uF020-\uF0FF]/g : /[\uF020-\uF0FF]/g;
  return text.replace(re, (ch) => {
    const code = ch.charCodeAt(0);
    return known ? wordSymGlyph(name, (code < 0xF000 ? code + 0xF000 : code).toString(16)) : symbolFallback(name, code);
  });
}
// \levelnfcN (RTF 1.9.1, "List Table") -> the number-format names the Word reader's formatCounter/listMarker use. A format
// with no table here (Kanji, Hebrew, Arabic, Chinese … counting) is 'custom': plain digits, so the list stays numbered.
const RTF_NFC_NUMFMT = {
  0: 'decimal', 1: 'upperroman', 2: 'lowerroman', 3: 'upperletter', 4: 'lowerletter', 5: 'ordinal', 6: 'cardinaltext', 7: 'ordinaltext',
  14: 'decimalfullwidth', 15: 'decimalhalfwidth', 18: 'decimalenclosedcircle', 22: 'decimalzero', 23: 'bullet', 255: 'none',
};
// Underline kinds (RTF 1.9.1, "Character Formatting Properties"): every one is underlined print.
const RTF_UNDERLINE_WORDS = new Set(['ul', 'uld', 'uldash', 'uldashd', 'uldashdd', 'uldb', 'ulhwave', 'ulldash', 'ulth', 'ulthd', 'ulthdash', 'ulthdashd', 'ulthdashdd', 'ulthldash', 'ululdbwave', 'ulw', 'ulwave', 'ulhair']);
const RTF_PICTURE_ONLY_EQUATION_ALT = 'equation not transcribed';


// IMP-W5: the merges of a finished RTF table. `meta[r]` = { v: per-cell vertical merge flag ('first' | 'cont' | null), x: per-cell right
// edge (\cellxN) }. A cell whose right edge reaches over several of the table's grid columns (the other rows' edges: how LibreOffice
// writes a merged cell — one cell, no placeholder) repeats in each of them; then a vertically merged cell repeats down its column.
function settleRtfTableMerges(rows, meta) {
  const copy = (v) => (v && typeof v === 'object' ? { ...v } : v);
  const TOL = 40;                                          // twips: edges closer than this are one grid line
  const edges = meta.flatMap((m) => (m && m.x) || []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const grid = [];
  for (const x of edges) if (!grid.length || x - grid[grid.length - 1] > TOL) grid.push(x);
  const colOf = (x) => { let best = 0; for (let i = 0; i < grid.length; i++) if (Math.abs(grid[i] - x) < Math.abs(grid[best] - x)) best = i; return best; };
  const flags = [];
  rows.forEach((cells, r) => {
    const m = meta[r];
    const v = [];
    if (m && m.x && m.x.length === cells.length && m.x.every((x) => Number.isFinite(x)) && grid.length) {
      const out = [];
      let prev = -1;
      cells.forEach((c, i) => {
        const col = colOf(m.x[i]);
        const span = Math.max(1, col - prev);
        for (let k = 0; k < span; k++) { out.push(k === 0 ? c : copy(c)); v.push(m.v[i]); }
        prev = Math.max(prev, col);
      });
      rows[r] = out;
    } else cells.forEach((_, i) => v.push((m && m.v[i]) || null));
    flags[r] = v;
  });
  const carry = [];
  rows.forEach((cells, r) => {
    cells.forEach((c, i) => {
      const v = flags[r][i];
      if (v === 'first') carry[i] = c;
      else if (v === 'cont' && carry[i] !== undefined) cells[i] = copy(carry[i]);
      else carry[i] = undefined;
    });
  });
}

// ---- RTF Office Math (RTF 1.9.1 "Office Open XML Math"; import fix list #45) ---------------------------------------------------------
// Each math control word is "\m" + the OMML element name (\mf = m:f, \msSub = m:sSub, \mr = m:r ...). An OMML property that holds one
// value is written as a group holding the value ({\mchr ∑}, {\mtype skw}) or, for an on/off property, as a control word with a number
// (\mdegHide1, \mgrow0); the properties of a run are control words in the run ({\mr\mscr0\msty2 a}). Rebuilt as OMML and read by
// omml.mjs, the reader the .docx equations go through, so an equation reads the same from either format.
const RTF_MATH_CHAR_PROPS = new Set(['chr', 'begChr', 'endChr', 'sepChr']);                  // the value is a literal character (never a number)
const RTF_MATH_ONOFF_PROPS = new Set(['grow', 'degHide', 'subHide', 'supHide', 'hideLeft', 'hideRight', 'hideTop', 'hideBot', 'strikeH', 'strikeV', 'strikeBLTR', 'strikeTLBR', 'transp', 'zeroAsc', 'zeroDesc', 'zeroWid', 'show', 'opEmu', 'noBreak', 'diff', 'lit', 'nor', 'aln', 'alnScr', 'plcHide', 'smallFrac', 'dispDef']);
// An enumeration given as a number counts the values in the order of the OOXML schema's enumeration (ST_Style p b i bi: Murray Sargent's
// "Mathematical RTF" has Word write \msty2 for a math-italic letter); given as a word it is the word.
const RTF_MATH_ENUMS = {
  sty: ['p', 'b', 'i', 'bi'],
  scr: ['roman', 'script', 'fraktur', 'double-struck', 'sans-serif', 'monospace'],
  type: ['bar', 'skw', 'lin', 'noBar'],
  limLoc: ['undOvr', 'subSup'],
  pos: ['top', 'bot'],
  shp: ['centered', 'match'],
};
const RTF_MATH_VALUE_PROPS = new Set([...RTF_MATH_CHAR_PROPS, ...RTF_MATH_ONOFF_PROPS, ...Object.keys(RTF_MATH_ENUMS), 'brk', 'maxDist', 'objDist', 'rSp', 'rSpRule', 'baseJc', 'vertJc', 'cGp', 'cGpRule', 'cSp', 'count', 'mcJc', 'cs', 'jc', 'interSp', 'intraSp', 'postSp', 'preSp', 'lMargin', 'rMargin', 'defJc', 'wrapIndent', 'wrapRight', 'intLim', 'naryLim', 'brkBin', 'brkBinSub']);
const RTF_MATH_RUN_PROPS = new Set(['nor', 'lit', 'scr', 'sty', 'aln', 'brk']);
// The OMML element for a value property: raw is the text of its group, or the number of its control word (null: none given).
function rtfMathValueXml(name, raw) {
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let val = null;
  if (RTF_MATH_CHAR_PROPS.has(name)) {
    val = raw == null ? '' : String(raw);                                  // an empty value is a real value: "no bracket" / "no separator"
    if (val.trim()) val = val.trim();
  } else {
    const s = raw == null ? '' : String(raw).trim();
    const num = /^-?\d+$/.test(s) ? Number(s) : null;
    if (RTF_MATH_ONOFF_PROPS.has(name)) val = num != null ? (num === 0 ? '0' : '1') : (/^(0|false|off)$/i.test(s) ? '0' : null);
    else if (RTF_MATH_ENUMS[name] && num != null) val = RTF_MATH_ENUMS[name][num] ?? String(num);
    else if (s) val = s;
  }
  return val == null ? `<m:${name}/>` : `<m:${name} m:val="${esc(val)}"/>`;
}

export function parseRtf(str) {
  const prevSymLog = DOCX_SYM_LOG;                          // (an RTF chunk can be read while a Word file is being read)
  try { return parseRtfBody(str); } finally { DOCX_SYM_LOG = prevSymLog; }
}
function parseRtfBody(str) {
  const s = str ?? '';
  const n = s.length;
  let i = 0;

  const styleMap = extractRtfStylesheet(s);
  const fonts = extractRtfFonts(s);
  // The document's own ANSI code page (\ansicpgN; \mac = Mac Roman) and default font (\deffN).
  const docCp = (() => {
    const head = s.slice(0, 6000);
    const a = /\\ansicpg(\d+)/.exec(head);
    if (a) return Number(a[1]);
    return /^\s*\{\\rtf\d*\\mac\b/.test(head) ? 10000 : 1252;
  })();
  const defFontId = (() => { const d = /\\deff(\d+)/.exec(s.slice(0, 6000)); return d ? d[1] : null; })();
  const fontOf = (ctx) => fonts.get(String(ctx && ctx.font != null ? ctx.font : defFontId));
  const cpOfFont = (f) => (f && (f.cpg || RTF_CHARSET_CP[f.charset])) || docCp;
  // A run of \'hh bytes in the font of `ctx`: through the font's code page, or its symbol table.
  const decodeRtfBytes = (bytes, font) => {
    if (rtfIsSymbolFont(font)) return rtfSymbolText(font, bytes.map((b) => (b >= 0x20 ? String.fromCharCode(0xF000 + b) : String.fromCharCode(b))).join(''));
    return rtfDecodeBytes(bytes, cpOfFont(font));
  };
  // Symbol-font symbols typed as \u escapes; an unmapped one is listed in the file's load warning (as the Word reader does).
  const symLog = new Map();
  DOCX_SYM_LOG = symLog;
  let rtfPictureOnlyEqCount = 0;
  const rtfDisplayMath = new WeakSet();                    // math segments written as {\moMathPara …}: display equations (as the .docx reader's DOCX_DISPLAY_MATH_SEGS)
  const resources = [];
  let footnoteCounter = 0;
  let imageCounter = 0;
  // \object counts, surfaced through model.warnings exactly like DOCX's own
  // legacyEq.count/legacyEq.oleCount (see parseDocx, above) — an unreadable equation, and a
  // non-equation embed that fell back to the plain "not transcribed" placeholder (no \result
  // picture to show instead).
  let rtfUnreadableEqCount = 0;
  let rtfOleCount = 0;
  const rtfLeftOut = { comments: 0, headers: [], footers: [] };   // IMP-W9: comments, running headers and footers: not transcribed, counted for the load notice
  let rtfMainLid = null;                                   // \deflang: the document's own language (foreign runs, input/lang.mjs)

  // ---- tokenizer: one control word / control symbol / literal char / brace per call ----
  function readToken() {
    while (i < n) {
      const c = s[i];
      if (c === '\r' || c === '\n') { i++; continue; }     // raw source formatting, never meaningful outside hex data
      if (c === '{') { i++; return { t: 'open' }; }
      if (c === '}') { i++; return { t: 'close' }; }
      if (c === '\\') {
        i++;
        if (i >= n) return null;
        const nc = s[i];
        if (nc === '\\' || nc === '{' || nc === '}') { i++; return { t: 'text', ch: nc }; }
        if (nc === '~') { i++; return { t: 'text', ch: ' ' }; }
        if (nc === '_') { i++; return { t: 'text', ch: '-' }; }
        // A backslash followed by a line break IS \par (RTF 1.9.1, "Control Symbols"; how Cocoa/TextEdit ends every paragraph).
        if (nc === '\r' || nc === '\n') { i++; if (nc === '\r' && s[i] === '\n') i++; return { t: 'ctrl', word: 'par', param: null }; }
        if (nc === "'") {
          // A run of adjacent \'hh bytes is decoded together (a double-byte character is two of them) by whoever reads
          // the token, through the code page of the font the text is in (decodeRtfBytes).
          const bytes = [];
          while (s[i] === "'" && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) {
            bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
            i += 3;
            if (s[i] === '\\' && s[i + 1] === "'") i++; else break;
          }
          if (!bytes.length) { i++; return { t: 'text', ch: '' }; }       // a malformed \'
          return { t: 'bytes', bytes };
        }
        if (/[a-zA-Z]/.test(nc)) {
          let word = '';
          while (i < n && /[a-zA-Z]/.test(s[i])) { word += s[i]; i++; }
          let param = null;
          if (i < n && (s[i] === '-' || /[0-9]/.test(s[i]))) {
            let ps = '';
            if (s[i] === '-') { ps += '-'; i++; }
            while (i < n && /[0-9]/.test(s[i])) { ps += s[i]; i++; }
            param = parseInt(ps, 10);
          }
          if (i < n && s[i] === ' ') i++;                  // the one delimiter space, discarded
          return { t: 'ctrl', word, param };
        }
        const sym = nc; i++;
        return { t: 'sym', ch: sym };
      }
      i++;
      return { t: 'text', ch: c };
    }
    return null;
  }

  function skipToMatchingClose() {
    let depth = 1;
    for (;;) {
      const tok = readToken();
      if (!tok) return;
      if (tok.t === 'open') depth++;
      else if (tok.t === 'close') { depth--; if (depth === 0) return; }
    }
  }

  // Plain-text extraction for a destination whose visible text still matters (\*\fldinst's
  // HYPERLINK target, \listtext/\pntext's marker) but whose formatting doesn't: recurses
  // into an ordinary nested group (real files wrap \*\fldinst's own text in a \rtlch/\ltrch
  // formatting subgroup) but skips a nested IGNORABLE (`\*`) subgroup whole — e.g.
  // \*\fldinst's own \*\datafield binary blob — never emitting its raw bytes as text.
  function captureGroupPlainText() {
    return rtfItemsText(captureRtfItems(1), null);
  }

  // The `\ucN` fallback characters that follow a \uN: N of them, a \'hh counting as one. They end at a brace or a control word.
  function skipUcFallback(count) {
    for (let k = 0; k < count && i < n; k++) {
      while (i < n && (s[i] === '\r' || s[i] === '\n')) i++;
      if (i >= n) return;
      if (s[i] === '\\' && s[i + 1] === "'") i += 4;
      else if (s[i] === '{' || s[i] === '}' || s[i] === '\\') return;
      else i++;
    }
  }
  // The character of \uN, its fallback skipped. N is a signed 16-bit number (a negative one is N + 65536); a high surrogate
  // followed by the \uN of a low surrogate is ONE character — how Word writes an emoji (a negative number, then another).
  function rtfUnicodeChar(param, uc) {
    let code = param == null ? 0 : param;
    if (code < 0) code = ((code % 65536) + 65536) % 65536;
    let ch = String.fromCodePoint(code > 0x10FFFF ? (code & 0xFFFF) : code);
    skipUcFallback(uc);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const m = /^[\r\n]*\\u(-?\d+) ?/.exec(s.slice(i, i + 30));
      if (m) {
        let lo = Number(m[1]);
        if (lo < 0) lo += 65536;
        if (lo >= 0xDC00 && lo <= 0xDFFF) { i += m[0].length; ch += String.fromCharCode(lo); skipUcFallback(uc); }
      }
    }
    return ch;
  }
  // One destination's text (a list label, a list level's text, a field instruction) as items — literal characters {k:'c'},
  // \'hh bytes {k:'b'}, \uN characters {k:'u'}, \fN font changes {k:'f'} — decoded by rtfItemsText once the font is known.
  // A nested ignorable (\*) group is skipped whole (a \*\datafield blob is never text). A Symbol-font bullet is written
  // as a \uN character of U+F0xx with a '?' fallback, which is why the fallback has to be skipped here.
  // Nesting depth (A89 step 4): groups inside groups are read by recursion, which a hostile file (4,000 nested groups, or 3,000 unclosed braces)
  // overflowed the stack with. Real files nest a few dozen levels at most; below RTF_MAX_DEPTH the groups are read as before, deeper ones are
  // read FLAT in the loop of the group at the limit (their text kept, their own formatting and structure not), and the load notice says so.
  let rtfDepth = 0, rtfCapDepth = 0, rtfDeepSeen = false;
  function captureRtfItems(uc = 1) {
    const items = [];
    let flat = 0;                                            // groups open below the depth limit, read here in this loop
    for (;;) {
      const tok = readToken();
      if (!tok) return items;
      if (tok.t === 'close') { if (flat > 0) { flat--; continue; } return items; }
      if (tok.t === 'open') {
        const startPos = i;
        const t2 = readToken();
        if (t2 && t2.t === 'sym' && t2.ch === '*') { skipToMatchingClose(); continue; }
        i = startPos;
        if (rtfCapDepth >= RTF_MAX_DEPTH) { flat++; rtfDeepSeen = true; continue; }
        rtfCapDepth++;
        try { for (const x of captureRtfItems(uc)) items.push(x); } finally { rtfCapDepth--; }
        continue;
      }
      if (tok.t === 'text') items.push({ k: 'c', ch: tok.ch });
      else if (tok.t === 'bytes') { for (const b of tok.bytes) items.push({ k: 'b', b }); }
      else if (tok.t === 'ctrl') {
        if (tok.word === 'bullet') items.push({ k: 'c', ch: '•' });
        else if (tok.word === 'u' && tok.param != null) items.push({ k: 'u', ch: rtfUnicodeChar(tok.param, uc) });
        else if (tok.word === 'uc') uc = tok.param == null ? 1 : tok.param;
        else if (tok.word === 'f' && tok.param != null) items.push({ k: 'f', n: tok.param });
      }
    }
  }
  function rtfItemsText(items, fontId) {
    let out = '', run = [];
    let font = fonts.get(String(fontId != null ? fontId : defFontId));
    const flush = () => { if (run.length) { out += decodeRtfBytes(run, font); run = []; } };
    for (const it of items) {
      if (it.k === 'b') run.push(it.b);
      else if (it.k === 'f') { flush(); font = fonts.get(String(it.n)); }
      else { flush(); out += it.k === 'u' && rtfIsSymbolFont(font) ? rtfSymbolText(font, it.ch) : it.ch; }
    }
    flush();
    return out;
  }

  function extractHyperlinkHref(fldinstText) {
    // A field's \l bookmark switch ("link to a place in this document", e.g. every TOC
    // entry) is itself written as RTF-escaped text INSIDE the field instruction string —
    // \\l in the source decodes to the two literal characters '\' 'l' (captureGroupPlainText
    // has already turned \\ into a literal backslash by the time this runs) — so it sits
    // between "HYPERLINK" and the quoted target as real, non-whitespace text, not as a
    // control word; checked first (more specific) so an internal link gets a '#'-prefixed
    // fragment href instead of a bare bookmark NAME that would look like (and fall through
    // to) an external one.
    let m = /HYPERLINK\s+\\l\s+"([^"]+)"/.exec(fldinstText);
    if (m) return '#' + m[1];
    m = /HYPERLINK\s+"([^"]+)"/.exec(fldinstText);
    return m ? m[1] : null;
  }

  // ---- run/paragraph text accumulation (per collector — see parseRtf's own doc comment) ----
  function emitText(collector, ctx, chunk) {
    if (!chunk) return;
    // Hidden text (\v) and a tracked deletion (\deleted) are not transcribed; a tracked insertion (\revised) is kept.
    if (ctx.hidden || ctx.deleted) return;
    const font = fontOf(ctx);
    // A symbol-font character written as a \uN of U+F0xx (LibreOffice's Symbol bullet): that font's glyph (as the Word reader's w:sym).
    if (font && rtfIsSymbolFont(font)) chunk = rtfSymbolText(font, chunk);
    // \caps and \scaps: the print text is in capitals (RUEB 9.6.1, as the Word reader does for w:caps / w:smallCaps).
    if (ctx.caps) chunk = chunk.toUpperCase();
    if (!collector.para) collector.para = { segments: [], curTf: 0, curTtf: null, curHref: null, buf: '', started: false };
    const p = collector.para;
    // A script-style font (Brush Script MT, Lucida Handwriting …) is the script typeform, as the Word reader's SCRIPT_FONT_RE.
    const tf = (ctx.tf || 0) | (font && SCRIPT_FONT_RE.test(font.name || '') ? TF_SCRIPT : 0), href = ctx.href || null, ttf = ctx.ttf || null;
    // Foreign language (\lang / \langfe against \deflang; LCID 1024 = no proofing — input/lang.mjs), recorded only.
    const lang = foreignLangOf(lcidLang(scriptSlot(chunk) === 'ea' ? ctx.lidFe : ctx.lid), lcidLang(rtfMainLid));
    if (!p.started || p.curTf !== tf || p.curHref !== href || p.curTtf !== ttf || (p.curLang || null) !== lang) {
      flushRun(p);
      p.curTf = tf; p.curHref = href; p.curTtf = ttf; p.curLang = lang; p.started = true;
    }
    // Subscript / superscript (\sub \super \dn \up): the text is bracketed with the script markers the formatter turns into UEB
    // level indicators (format/text-style.mjs SCRIPT_MARKS), as the Word reader does. A raised or lowered run of only spaces
    // marks nothing.
    const script = /\S/.test(chunk) ? (ctx.va || null) : (p.curScript || null);
    if (script !== (p.curScript || null)) {
      if (p.curScript) closeScriptRun(p);
      if (script) p.buf += script === 'sub' ? SCRIPT_MARKS.subOpen : SCRIPT_MARKS.supOpen;
      p.curScript = script;
    }
    p.buf += chunk;
  }
  // Ends an open sub/superscript bracket just before any spaces the run ends in (a raised space is only a space).
  function closeScriptRun(p) {
    if (!p.curScript) return;
    const cut = p.buf.search(/\s*$/);
    p.buf = p.buf.slice(0, cut) + SCRIPT_MARKS.end + p.buf.slice(cut);
    p.curScript = null;
  }
  function flushRun(p) {
    closeScriptRun(p);
    if (p.buf) {
      const seg = { type: 'text', text: p.buf };
      if (p.curTf) seg.tf = p.curTf;
      if (p.curHref) seg.href = p.curHref;
      if (p.curTtf) seg.transcriberTypeform = p.curTtf;
      if (p.curLang) seg.lang = p.curLang;
      p.segments.push(seg);
    }
    p.buf = '';
  }
  function pushSegment(collector, seg) {
    if (!collector.para) collector.para = { segments: [], curTf: 0, curHref: null, buf: '', started: false };
    else flushRun(collector.para);
    collector.para.segments.push(seg);
  }

  function finalizeTableIfPending(collector) {
    if (collector.tableRows && collector.tableRows.length && (!collector.tableCells || collector.tableCells.length === 0)) {
      settleRtfTableMerges(collector.tableRows, collector.tableRowMeta || []);
      const [headers, ...rows] = collector.tableRows;
      const tblBlock = { type: 'table', headers, rows };
      const votes = collector.tableAlignVotes;   // K3
      if (votes && votes.length) {
        const printAlign = votes.map((s) => (s && s.size === 1 ? [...s][0] : undefined));
        if (printAlign.some(Boolean)) tblBlock.printAlign = printAlign;
      }
      collector.blocks.push(tblBlock);
      if (collector.nestedTables && collector.nestedTables.length) collector.blocks.push(...collector.nestedTables);   // IMP-W6
      collector.nestedTables = null;
      collector.tableRows = null;
      collector.tableAlignVotes = null;
      collector.tableRowMeta = null;
    }
  }

  // ---- lists (import fix list #17): {\*\listtable}, {\*\listoverridetable}, \ls / \ilvl, and the older \pn forms ------------
  // The same model as the Word reader: each item has its marker ("1.", "a.", "•") and, when nested, its level; the marker of
  // a numbered list is what Word would show — the label the file wrote (\listtext) when it wrote one, else counted from the
  // list table with the Word reader's own listMarker/formatCounter. A bullet is the print bullet (wordBulletGlyph).
  const rtfLists = new Map();             // \listid -> { levels: [ { nfc, start, legal, norestart, font, items } ] }
  const rtfOverrides = new Map();         // \ls -> { listId, starts: Map(ilvl -> start), levels: Map(ilvl -> level) }
  const rtfCounters = new Map();          // running numbers, one per list instance (\ls) and level: a list keeps counting after an interruption
  const rtfPnCounters = new Map();
  const rtfWritesLabels = /\\(?:\*\\)?(?:listtext|pntext)(?![a-zA-Z])/.test(s);   // does this file write a label (\listtext / \pntext) on its numbered paragraphs at all?
  function readListLevel(uc0 = 1) {
    const lv = { nfc: null, nfcn: null, start: 1, legal: false, norestart: false, font: null, items: [] };
    for (;;) {
      const tok = readToken();
      if (!tok || tok.t === 'close') break;
      if (tok.t === 'ctrl') {
        if (tok.word === 'levelnfc') lv.nfc = tok.param;
        else if (tok.word === 'levelnfcn') lv.nfcn = tok.param;
        else if (tok.word === 'levelstartat') lv.start = tok.param == null ? 1 : tok.param;
        else if (tok.word === 'levellegal') lv.legal = tok.param !== 0;
        else if (tok.word === 'levelnorestart') lv.norestart = tok.param !== 0;
        else if (tok.word === 'f') lv.font = tok.param;
        continue;
      }
      if (tok.t !== 'open') continue;
      const startPos = i;
      let t2 = readToken();
      if (t2 && t2.t === 'sym' && t2.ch === '*') t2 = readToken();
      if (t2 && t2.t === 'ctrl' && t2.word === 'leveltext') { lv.items = captureRtfItems(uc0); continue; }
      i = startPos;
      skipToMatchingClose();
    }
    return lv;
  }
  function readListTable(uc0 = 1) {
    for (;;) {
      const tok = readToken();
      if (!tok || tok.t === 'close') return;
      if (tok.t !== 'open') continue;
      const startPos = i;
      let t2 = readToken();
      if (t2 && t2.t === 'sym' && t2.ch === '*') t2 = readToken();
      if (t2 && t2.t === 'ctrl' && t2.word === 'list') {
        const lst = { id: null, levels: [] };
        for (;;) {
          const tk = readToken();
          if (!tk || tk.t === 'close') break;
          if (tk.t === 'ctrl') { if (tk.word === 'listid') lst.id = tk.param; continue; }
          if (tk.t !== 'open') continue;
          const sp = i;
          let t3 = readToken();
          if (t3 && t3.t === 'sym' && t3.ch === '*') t3 = readToken();
          if (t3 && t3.t === 'ctrl' && t3.word === 'listlevel') { lst.levels.push(readListLevel(uc0)); continue; }
          i = sp;
          skipToMatchingClose();
        }
        if (lst.id != null) { rtfLists.set(String(lst.id), lst); rtfLevelCache.clear(); }
        continue;
      }
      i = startPos;
      skipToMatchingClose();
    }
  }
  function readListOverrideTable(uc0 = 1) {
    for (;;) {
      const tok = readToken();
      if (!tok || tok.t === 'close') return;
      if (tok.t !== 'open') continue;
      const startPos = i;
      const t2 = readToken();
      if (!(t2 && t2.t === 'ctrl' && t2.word === 'listoverride')) { i = startPos; skipToMatchingClose(); continue; }
      const ov = { listId: null, ls: null, starts: new Map(), levels: new Map() };
      let idx = 0;
      for (;;) {
        const tk = readToken();
        if (!tk || tk.t === 'close') break;
        if (tk.t === 'ctrl') { if (tk.word === 'listid') ov.listId = tk.param; else if (tk.word === 'ls') ov.ls = tk.param; continue; }
        if (tk.t !== 'open') continue;
        const sp = i;
        const t3 = readToken();
        if (!(t3 && t3.t === 'ctrl' && t3.word === 'lfolevel')) { i = sp; skipToMatchingClose(); continue; }
        // {\lfolevel \listoverridestartat \levelstartat5 … {\listlevel …}}: a restarted level, and/or a whole replacement level
        let restart = false, startAt = null;
        for (;;) {
          const t4 = readToken();
          if (!t4 || t4.t === 'close') break;
          if (t4.t === 'ctrl') {
            if (t4.word === 'listoverridestartat') restart = true;
            else if (t4.word === 'levelstartat') startAt = t4.param;
            continue;
          }
          if (t4.t !== 'open') continue;
          const sp2 = i;
          let t5 = readToken();
          if (t5 && t5.t === 'sym' && t5.ch === '*') t5 = readToken();
          if (t5 && t5.t === 'ctrl' && t5.word === 'listlevel') { ov.levels.set(idx, readListLevel(uc0)); continue; }
          i = sp2;
          skipToMatchingClose();
        }
        if (restart && startAt != null) ov.starts.set(idx, startAt);
        idx++;
      }
      if (ov.ls != null) { rtfOverrides.set(String(ov.ls), ov); rtfLevelCache.clear(); }
    }
  }
  // The level Word's listMarker wants: { numFmt, lvlText, start, isLgl, lvlRestart }. The level text is the template with the level
  // numbers as placeholders (a byte 0-8 is level 1-9) — %1, %2 … as in numbering.xml; a bullet's is its glyph, through the level's font.
  const rtfLevelCache = new Map();
  function rtfLevelOf(ls, ilvl) {
    const key = `${ls}:${ilvl}`;
    if (rtfLevelCache.has(key)) return rtfLevelCache.get(key);
    const lv = rtfLevelOfUncached(ls, ilvl);
    rtfLevelCache.set(key, lv);
    return lv;
  }
  function rtfLevelOfUncached(ls, ilvl) {
    const ov = rtfOverrides.get(String(ls));
    if (!ov) return null;
    const list = rtfLists.get(String(ov.listId));
    const lv = ov.levels.get(Number(ilvl)) || (list && list.levels[Number(ilvl)]);
    if (!lv) return null;
    const nfc = lv.nfc != null ? lv.nfc : lv.nfcn;
    const numFmt = Object.prototype.hasOwnProperty.call(RTF_NFC_NUMFMT, nfc == null ? 0 : nfc) ? RTF_NFC_NUMFMT[nfc == null ? 0 : nfc] : 'custom';
    let tmpl = rtfItemsText(lv.items, lv.font).replace(/;$/, '');
    if (tmpl.length && (tmpl.charCodeAt(0) === tmpl.length - 1 || tmpl.charCodeAt(0) < 0x20)) tmpl = tmpl.slice(1);   // the first character is the template's length
    const lvlText = numFmt === 'bullet' ? tmpl : tmpl.replace(/[\x00-\x08]/g, (c) => `%${c.charCodeAt(0) + 1}`);
    const so = ov.starts.get(Number(ilvl));
    return { numFmt, lvlText, start: so != null ? so : (lv.start == null ? 1 : lv.start), isLgl: !!lv.legal, lvlRestart: lv.norestart ? 0 : null };
  }
  // {\*\pn \pnlvlblt \pnf3 \pnstart1 {\pntxtb …}}: the old (Word 6-97) list description. The label itself is written too (\pntext).
  const RTF_PN_FORMATS = { pndec: 'decimal', pnucrm: 'upperroman', pnlcrm: 'lowerroman', pnucltr: 'upperletter', pnlcltr: 'lowerletter', pnord: 'ordinal', pnordt: 'ordinaltext', pncard: 'cardinaltext' };
  function readPn(uc0 = 1) {
    const pn = { kind: 'number', fmt: 'decimal', start: 1, level: null, font: null, before: '', after: '', hasFmt: false };
    for (;;) {
      const tok = readToken();
      if (!tok || tok.t === 'close') break;
      if (tok.t === 'ctrl') {
        if (tok.word === 'pnlvlblt') pn.kind = 'bullet';
        else if (tok.word === 'pnlvlbody') pn.kind = 'number';
        else if (tok.word === 'pnlvlcont') pn.kind = 'none';
        else if (tok.word === 'pnlvl' && tok.param != null) pn.level = Math.max(0, tok.param - 1);
        else if (tok.word === 'pnstart') pn.start = tok.param == null ? 1 : tok.param;
        else if (tok.word === 'pnf') pn.font = tok.param;
        else if (RTF_PN_FORMATS[tok.word]) { pn.fmt = RTF_PN_FORMATS[tok.word]; pn.hasFmt = true; }
        continue;
      }
      if (tok.t !== 'open') continue;
      const startPos = i;
      const t2 = readToken();
      const w = t2 && t2.t === 'ctrl' ? t2.word : null;
      if (w === 'pntxta' || w === 'pntxtb') {
        const txt = rtfItemsText(captureRtfItems(uc0), pn.font).replace(/\s+/g, ' ');
        if (w === 'pntxta') pn.after = txt; else pn.before = txt;
        continue;
      }
      i = startPos;
      skipToMatchingClose();
    }
    return pn;
  }
  function pnMarker(pn) {
    if (pn.kind === 'none') return null;
    if (pn.kind === 'bullet') return pn.before.trim() || '•';
    const key = `pn:${pn.level == null ? 0 : pn.level}`;
    const num = rtfPnCounters.has(key) ? rtfPnCounters.get(key) + 1 : pn.start;
    rtfPnCounters.set(key, num);
    return `${pn.before}${formatCounter(num, pn.fmt) ?? num}${pn.after}`.trim();
  }
  // The paragraph's left indent in twips: \li (or \lin) written on the paragraph, else its style's (through \sbasedon).
  function rtfIndentOf(collector, styleId) {
    if (collector.liLeft != null) return collector.liLeft;
    let cur = styleId == null ? null : String(styleId);
    const seen = new Set();
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      const st = styleMap.get(cur);
      if (!st) break;
      if (st.li != null) return st.li;
      cur = st.basedOn;
    }
    return 0;
  }
  // { marker, level, numbered } for the paragraph being ended, or null when it is not a list paragraph.
  function rtfListInfo(collector) {
    const label = collector.pendingMarker;                     // what \listtext / \pntext wrote, or null
    const ls = collector.lsId;
    const hasLs = ls != null && ls > 0;
    let level = hasLs ? (collector.ilvl || 0) : (collector.pn && collector.pn.level != null ? collector.pn.level : 0);
    level = Math.max(0, Math.min(8, level));
    let lv = null, computed = null;
    if (hasLs) {
      lv = rtfLevelOf(ls, level);
      if (lv) computed = listMarker(rtfLevelOf, rtfCounters, String(ls), level);      // always run: it advances the count
    } else if (collector.pn) {
      computed = pnMarker(collector.pn);
    }
    const numbered = hasLs || !!collector.pn || label != null;
    // A list paragraph with no label: where the file writes labels for its list paragraphs (every Word/LibreOffice/Cocoa file does) this one is
    // simply not numbered — the further paragraph of the item before it (Pandoc's list_multiparagraph.rtf); where the file writes none, the
    // number is counted from the list table.
    if (label == null) return computed == null || rtfWritesLabels ? null : { marker: computed, level, numbered };
    if (lv && lv.numFmt === 'bullet') return { marker: computed, level, numbered };     // the level's own bullet, through its font
    const t = label.replace(/\s+/g, ' ').trim();
    if (t === '') {
      if (lv && computed == null) return null;                 // a level that shows no number (\levelnfc255): an ordinary paragraph
      return { marker: '', level, numbered };                  // (an empty label is a bullet — endParagraph gives it the dot)
    }
    // One or two characters that are not letters or digits (•, –, ➢, ◦, ■) are a bullet; so is a lone "o" (Courier New's bullet).
    // (A Wingdings solid square, byte A7, read without its font, is "§": still the solid square, as before.)
    if (/^[^\p{L}\p{N}\s]{1,2}$/u.test(t) || t === 'o') return { marker: wordBulletGlyph(t === '\u00A7' ? String.fromCharCode(0x25A0) : t, undefined, level), level, numbered };
    return { marker: t, level, numbered };
  }

  // `midParagraph`: the paragraph is being cut short by a picture that comes in the middle of it (pushGraphic), not ended by \par.
  function endParagraph(collector, midParagraph = false) {
    finalizeTableIfPending(collector);
    const p = collector.para;
    collector.para = null;
    // Import fix list #48: the paragraph right after one that held a picture may be that picture's caption (parseDocx's rule: the
    // NEXT paragraph, in Word's Caption style, joins the last picture of the one before; an empty paragraph between breaks the pair).
    const captionOf = collector.captionFor;
    if (!midParagraph) { collector.captionFor = collector.picGraphic || null; collector.picGraphic = null; }
    const styleId = collector.styleId, outlineLvl = collector.outlineLvl;
    collector.skipNonShp = false;
    // List membership (import fix list #17): a written label (\listtext / \pntext) and/or \ls + \ilvl against the list table.
    const li = rtfListInfo(collector);
    let marker = li ? li.marker : null;
    // A bullet paragraph (empty marker, Symbol/Wingdings glyph, o, §, ·, •) keeps a print bullet in braille (BANA 8.6.2).
    if (marker != null && !isBulletMarker(marker) && /^(?:[o§\u00A7\u2022\u2219\uF000-\uF8FF\u25A0-\u25FF\u2043-]|)$/.test(marker)) marker = wordBulletGlyph(marker === '§' ? '\u25A0' : marker, undefined, li.level);   // Wingdings byte A7 decodes as § in RTF
    collector.styleId = null; collector.outlineLvl = null; collector.pendingMarker = null;

    let segments = [];
    if (p) { flushRun(p); segments = p.segments; }
    let text = segments.filter((seg) => seg.type === 'text').map((seg) => seg.text).join('');
    text = text.replace(/[ \t]+/g, ' ').trim();
    const hasNonText = segments.some((seg) => seg.type !== 'text');
    if (!text && !hasNonText) {                              // (a list label with nothing after it, a blank numbered paragraph, is not an item)
      if (collector.pendingNotes.length) { collector.blocks.push(...collector.pendingNotes); collector.pendingNotes = []; }
      return;
    }
    // RTF \object: a math segment (a readable equation) or an imgnote segment (an
    // unreadable equation's or a non-equation embed's placeholder) must count as "rich" here
    // too, or a paragraph/heading/list item whose ONLY inline content is one of these (no
    // bold/italic/href/footnote-ref of its own) collapses to plain `text` and silently drops
    // it — `text` above only ever concatenates `type === 'text'` segments.
    const hasFmt = segments.some((seg) => seg.tf || seg.href || seg.type === 'noteref' || seg.type === 'math' || seg.type === 'imgnote' || seg.transcriberTypeform || seg.lang);

    // A heading or title that carries a list number keeps its heading-ness; the number becomes the start of its text (as the Word reader does
    // for numbered headings). A bullet on a heading is dropped.
    let headingCls = null;
    let isQuoteStyle = false;
    if (outlineLvl != null) { if (outlineLvl >= 0 && outlineLvl <= 8) headingCls = { kind: 'heading', level: Math.min(6, outlineLvl + 1) }; }
    else if (styleId != null) { const c = classifyRtfStyle(styleId, styleMap); if (c?.kind === 'heading') headingCls = { kind: 'heading', level: Math.min(6, c.level) }; else if (c?.kind === 'title') headingCls = { kind: 'title', subtitle: c.subtitle === true }; else if (c?.kind === 'quote') isQuoteStyle = true; }   // subtitle: IMP-W1; quote: #43
    if (captionOf && marker == null && !headingCls && text && styleId != null && rtfStyleIsCaption(styleId, styleMap)) {
      captionOf.caption = text;                              // #48: the picture's caption, not a paragraph of its own
      collector.captionFor = null;
      if (collector.pendingNotes.length) { collector.blocks.push(...collector.pendingNotes); collector.pendingNotes = []; }
      return;
    }
    if (marker != null && headingCls) {
      if (!isBulletMarker(marker) && /[\p{L}\p{N}]/u.test(marker) && text) {
        text = `${marker} ${text}`;
        if (hasFmt) segments.unshift({ type: 'text', text: `${marker} ` });
      }
      marker = null;
    }

    if (marker != null) {
      const item = hasFmt ? { segments } : { text };
      item.marker = marker;
      if (li.level > 0) item.level = li.level;                 // nested lists indent per level (as the Word reader)
      if (li.numbered) Object.defineProperty(item, '_numbered', { value: true });   // may take further paragraphs (below)
      stripDuplicateBullet(item);
      if (collector.pendingListOpen && collector.pendingList) {
        collector.pendingList.items.push(item);
      } else {
        collector.pendingList = { type: 'list', items: [item] };
        collector.blocks.push(collector.pendingList);
        collector.pendingListOpen = true;
      }
    } else {
      const level = headingCls && headingCls.kind === 'heading' ? headingCls.level : null;
      const isTitle = !!headingCls && headingCls.kind === 'title';
      const isSubtitle = !!headingCls && headingCls.kind === 'title' && headingCls.subtitle === true;   // IMP-W1
      let block, extraBlocks = null;
      // IMP-W1: a Subtitle goes with the Title just before it (the second line of the same heading); with no Title before it, it is an
      // ordinary paragraph, never a chapter of its own.
      const prevBlock = collector.blocks[collector.blocks.length - 1];
      if (isTitle && isSubtitle && titleTakesSubtitle(prevBlock) && text) {
        mergeSubtitleIntoTitle(prevBlock, text);
        if (collector.pendingNotes.length) { collector.blocks.push(...collector.pendingNotes); collector.pendingNotes = []; }
        return;
      }
      if (isTitle && isSubtitle && collector.blocks.length) isTitle = false;
      if (isTitle) {
        block = { type: 'title', text };
        collector.title = collector.title || text;
      } else if (level != null) {
        block = hasFmt ? { type: 'heading', level, segments, text } : { type: 'heading', level, text };
        // Real title signal (3 of 3 — see parseRtf's own title-fallback comment, below): the
        // document's first Heading-1-level paragraph (outline level 0, or a "heading 1"-
        // named style), the RTF/Word structural counterpart of HTML's own <title>-else-<h1>
        // fallback (parseHtml, above) — recorded here, used only as a last resort once the
        // whole document has been read (a later, better signal — a Title-style paragraph
        // that hasn't been seen yet — must still be able to win).
        if (level === 1 && collector.h1Title == null) collector.h1Title = text;
      } else {
        // An \object equation standing alone in an ordinary paragraph (no other real text)
        // is a display equation — the same `math` block DOCX gives an m:oMathPara or a
        // paragraph holding only a readable legacy equation (see parseDocx's own
        // `legacyAlone` check, above). Tabs/spaces used to centre it do not count as other
        // content (the blank-text filter below matches `text`'s own trim/collapse above).
        const nonBlank = segments.filter((seg) => !(seg.type === 'text' && !String(seg.text || '').trim()));
        // A paragraph holding only equations written as {\moMathPara …} is one display block per equation (the .docx reader's rule for
        // <w:p><m:oMathPara>…); a lone bare equation in its paragraph is display too (LibreOffice writes its display equations that way).
        if (nonBlank.length && nonBlank.every((seg) => seg.type === 'math') && (nonBlank.length === 1 || nonBlank.every((seg) => rtfDisplayMath.has(seg)))) {
          block = { ...nonBlank[0] };
          if (nonBlank.length > 1) extraBlocks = nonBlank.slice(1).map((seg) => ({ ...seg }));
        } else {
          block = hasFmt ? { type: 'para', segments } : { type: 'para', text };
          if (isQuoteStyle) block.style = 'quote';   // #43: a quotation paragraph (BANA 9), as Word's Quote style
        }
      }
      // An ordinary paragraph indented at least as far as a list's text (\li of 360 twips or more), with no number of its own, directly after a
      // numbered or bulleted item is that item's further paragraph (kept in item.blocks — BANA 10.3.3); the Word reader's rule. A paragraph
      // that is not indented ends the list.
      const lastItem = collector.pendingListOpen && collector.pendingList ? collector.pendingList.items[collector.pendingList.items.length - 1] : null;
      if (lastItem && lastItem._numbered && block.type === 'para' && (rtfIndentOf(collector, styleId) >= 360 || (collector.lsId > 0 && rtfWritesLabels))) {
        (lastItem.blocks ||= []).push(block);
      } else {
        collector.pendingListOpen = false;
        collector.blocks.push(block);
        if (extraBlocks) collector.blocks.push(...extraBlocks);
      }
    }
    if (collector.pendingNotes.length) { collector.blocks.push(...collector.pendingNotes); collector.pendingNotes = []; }
  }

  // Real title signal (1 of 3 — see parseRtf's own title-fallback comment, below):
  // \info{\title …}, RTF's own document-properties destination — the same kind of pure
  // metadata DOCX's docProps/core.xml dc:title (docCoreTitle, above) and HTML's <title>
  // element are. \info's other children (\author, \subject, \operator, \creatim, …) are
  // metadata Emboss has no use for and are skipped along with it, whole; only \title's own
  // plain text is kept. This never creates or promotes a body block of its own — \info sits
  // outside the document's actual text, so (like docProps/core.xml) it can only ever fill in
  // a title nothing else already gave.
  function handleInfo(collector) {
    for (;;) {
      const tok = readToken();
      if (!tok || tok.t === 'close') return;
      if (tok.t !== 'open') continue;                       // \info holds only nested destinations
      const startPos = i;
      let t2 = readToken();
      if (t2 && t2.t === 'sym' && t2.ch === '*') t2 = readToken();   // a \*\title is spec-legal too
      const w = t2 && t2.t === 'ctrl' ? t2.word : null;
      if (w === 'title' && !collector.infoTitle) {
        const t = captureGroupPlainText().replace(/\s+/g, ' ').trim();
        if (t) collector.infoTitle = t;
        continue;
      }
      i = startPos;
      skipToMatchingClose();
    }
  }

  function handleFootnote(collector, ctx) {
    const idref = 'rtf-fn-' + (++footnoteCounter);
    pushSegment(collector, { type: 'noteref', text: String(footnoteCounter), idref });
    // IMP-W3: `{\footnote\ftnalt ...}` is an ENDNOTE (RTF spec: \ftnalt "Indicates an endnote"); the formatter collects it into the
    // endnote section (BANA 16.9), as it does a Word, ODT or .doc endnote (kind 'endnote').
    const afterFootnote = i;
    const altTok = readToken();
    const isEndnote = !!(altTok && altTok.t === 'ctrl' && altTok.word === 'ftnalt');
    if (!isEndnote) i = afterFootnote;
    const noteCollector = newCollector();
    parseContent(noteCollector, { tf: 0, href: null, fieldHrefBox: null, uc: ctx.uc, font: ctx.font });   // (the note text is read with the document's \uc and font, not with the reference mark's raised position)
    if (noteCollector.para || noteCollector.pendingMarker) endParagraph(noteCollector);
    finalizeTableIfPending(noteCollector);
    let noteBlock;
    if (noteCollector.blocks.length > 1) noteBlock = { type: 'footnote', blocks: noteCollector.blocks };
    else if (noteCollector.blocks.length === 1) {
      const b = noteCollector.blocks[0];
      noteBlock = b.segments ? { type: 'footnote', text: b.text, segments: b.segments } : { type: 'footnote', text: b.text || '' };
    } else {
      noteBlock = { type: 'footnote', text: '' };
    }
    noteBlock.id = idref;
    if (isEndnote) noteBlock.kind = 'endnote';
    collector.pendingNotes.push(noteBlock);
  }

  // Decodes a \pict destination's own bytes into { ext, mime, bytes }, or null when the
  // picture format is undecodable (macpict/pmmetafile, or a malformed WMF/EMF/DIB —
  // metafileToSvg/dibToPngBytes never throw, they just return null). Called with the \pict
  // group's own tokens not yet read (same as this function's callers always leave it: right
  // after the '\pict' control word itself). Split out of handlePicture (which now just calls
  // this and pushes the block/resource) so the RTF \object \result destination's own
  // fallback picture (findPictureInGroup/handleObject, below) can reuse exactly the same
  // decoding, not a second copy of it.
  function readPictureData() {
    let kind = null, hexBuf = '', alt = '';
    let depth = 1;
    while (depth > 0) {
      const tok = readToken();
      if (!tok) break;
      if (tok.t === 'open') {
        // {\*\picprop {\sp{\sn wzDescription}{\sv text}} …}: the picture's properties as Word and LibreOffice write them; the
        // description is its alt text (RTF 1.9.1, "Pictures"). wzName is the picture's name/title, not a description.
        const startPos = i;
        let t2 = readToken();
        if (t2 && t2.t === 'sym' && t2.ch === '*') t2 = readToken();
        if (t2 && t2.t === 'ctrl' && t2.word === 'picprop') {
          const props = readShapeProps();
          if (props.has('wzDescription')) alt = props.get('wzDescription').text.replace(/\s+/g, ' ').trim();
          continue;
        }
        i = startPos;
        skipToMatchingClose();
        continue;
      }
      if (tok.t === 'close') { depth--; continue; }
      if (tok.t === 'ctrl' && RTF_BLIP_KEYWORDS.has(tok.word)) { kind = tok.word; continue; }
      if (tok.t === 'text') { hexBuf += tok.ch; continue; }
    }
    const bytes = hexToBytes(hexBuf);
    if (bytes.length < 1) return null;

    let ext = RTF_BLIP_EXT[kind], mime = RTF_BLIP_MIME[ext], outBytes = bytes;
    if (!ext) {
      // WMF/EMF (incl. an EMF+ "dual mode" GDI fallback, or a minimal best-effort EMF+-only
      // render — see metafile.mjs) -> SVG; a bare DIB (RTF's \dibitmap has no 14-byte
      // BITMAPFILEHEADER, just the BITMAPINFOHEADER onward, same as metafile.mjs expects)
      // -> PNG. Both return null (never throw) on a malformed/unsupported picture, in which
      // case this falls through to the same "not decoded" placeholder as macpict/pmmetafile.
      if (kind === 'wmetafile' || kind === 'emfblip') {
        const svg = metafileToSvg(bytes);
        if (svg) { ext = 'svg'; mime = 'image/svg+xml'; outBytes = new TextEncoder().encode(svg); }
      } else if (kind === 'dibitmap') {
        const png = dibToPngBytes(bytes);
        if (png) { ext = 'png'; mime = 'image/png'; outBytes = png; }
      }
      if (!ext) return null; // undecodable, or macpict/pmmetafile: bytes not carried (see final report)
    }
    return { ext, mime, bytes: outBytes, alt };
  }

  // The properties of a shape or a picture: the rest of the current group read as {\sp{\sn name}{\sv value}} pairs, in a Map of
  // name -> { text, pict } (pict is the decoded picture of a value that is a {\pict …}: the shape's picture, name pib).
  function readShapeProps() {
    const props = new Map();
    for (;;) {
      const tok = readToken();
      if (!tok || tok.t === 'close') return props;
      if (tok.t !== 'open') continue;
      const startPos = i;
      const t2 = readToken();
      if (t2 && t2.t === 'ctrl' && t2.word === 'sp') {
        const sp = readSpGroup();
        if (sp.name) props.set(sp.name, sp);
        continue;
      }
      i = startPos;
      skipToMatchingClose();
    }
  }
  function readSpGroup() {                                   // after '{\sp'; reads to that group's close
    const sp = { name: '', text: '', pict: null };
    for (;;) {
      const tok = readToken();
      if (!tok || tok.t === 'close') return sp;
      if (tok.t !== 'open') continue;
      const startPos = i;
      const t2 = readToken();
      const w = t2 && t2.t === 'ctrl' ? t2.word : null;
      if (w === 'sn') { sp.name = captureGroupPlainText().trim(); continue; }
      if (w !== 'sv') { i = startPos; skipToMatchingClose(); continue; }
      let txt = '';
      for (;;) {
        const t3 = readToken();
        if (!t3 || t3.t === 'close') break;
        if (t3.t === 'open') {
          const sp2 = i;
          const t4 = readToken();
          if (t4 && t4.t === 'ctrl' && t4.word === 'pict') { const d = readPictureData(); if (d && !sp.pict) sp.pict = d; continue; }
          i = sp2;
          skipToMatchingClose();
          continue;
        }
        if (t3.t === 'text') txt += t3.ch;
        else if (t3.t === 'bytes') txt += rtfDecodeBytes(t3.bytes, docCp);
        else if (t3.t === 'ctrl' && t3.word === 'u' && t3.param != null) txt += rtfUnicodeChar(t3.param, 1);
      }
      sp.text = txt;
    }
  }

  // A decoded picture becomes a graphic block, with its description as alt text (an empty one stays "decorative", as in the Word reader).
  function pushGraphic(collector, data, alt) {
    const path = `rtf-image-${++imageCounter}.${data.ext}`;
    if (collector.para) endParagraph(collector, true);
    const graphic = { type: 'graphic', src: path, alt: alt || '' };
    collector.blocks.push(graphic);
    collector.picGraphic = graphic;                          // the last picture of the paragraph being read (#48: its caption may follow)
    resources.push({ path, mime: data.mime, bytes: data.bytes });
  }
  function handlePicture(collector, ctx) {
    const data = readPictureData();
    if (!data) return;
    if (ctx && (ctx.hidden || ctx.deleted)) return;
    pushGraphic(collector, data, data.alt);
  }

  // The text of a text box ({\shptxt …} of a shape, {\dptxbxtext …} of an old drawing object) read as a document of its own.
  function readBoxText(ctx) {
    const box = newCollector();
    parseContent(box, { tf: 0, href: null, fieldHrefBox: null, uc: ctx.uc, font: ctx.font });
    if (box.para || box.pendingMarker) endParagraph(box);
    finalizeTableIfPending(box);
    if (box.pendingNotes.length) { box.blocks.push(...box.pendingNotes); box.pendingNotes = []; }
    return box.blocks;
  }
  // Text boxes (import fix list #1e): the text is kept where the shape is anchored, in front of the paragraph holding the anchor (as the
  // Word reader does). A box with an explicit outline is a box (BANA 7: a { type: 'box' } block); one without — page placement,
  // a running head — is plain paragraphs.
  function pushBoxText(collector, blocks, bordered) {
    if (!blocks.length) return;
    finalizeTableIfPending(collector);
    collector.pendingListOpen = false;
    if (bordered) {
      const box = { type: 'box', render: 'required' };
      const title = extractBoxTitle(blocks);
      if (title) box.title = title;
      box.blocks = blocks;
      collector.blocks.push(box);
    } else {
      collector.blocks.push(...blocks);
    }
  }
  // {\shp{\*\shpinst … {\sp{\sn name}{\sv value}} … {\shptxt …}}{\shprslt …}}: a drawing shape. Kept: its text box, its picture
  // (name pib, with the shape's description as alt text), WordArt text. \shprslt is the fallback for readers that do not know shapes.
  let rtfShapeDepth = 0;                                     // shapes inside shapes (see rtfDepth): deeper than RTF_MAX_DEPTH they are skipped
  function handleShape(collector, ctx) {
    if (rtfShapeDepth >= RTF_MAX_DEPTH) { rtfDeepSeen = true; skipToMatchingClose(); return; }
    rtfShapeDepth++;
    try { handleShapeBody(collector, ctx); } finally { rtfShapeDepth--; }
  }
  function handleShapeBody(collector, ctx) {
    const parts = [];
    const props = new Map();
    const walk = () => {
      if (rtfShapeDepth >= RTF_MAX_DEPTH) { rtfDeepSeen = true; skipToMatchingClose(); return; }
      rtfShapeDepth++;
      try { walkBody(); } finally { rtfShapeDepth--; }
    };
    const walkBody = () => {
      for (;;) {
        const tok = readToken();
        if (!tok || tok.t === 'close') return;
        if (tok.t !== 'open') continue;
        const startPos = i;
        let t2 = readToken();
        if (t2 && t2.t === 'sym' && t2.ch === '*') t2 = readToken();
        const w = t2 && t2.t === 'ctrl' ? t2.word : null;
        if (w === 'shpinst') { walk(); continue; }
        if (w === 'sp') {
          const sp = readSpGroup();
          if (sp.name) props.set(sp.name, sp);
          if (sp.name === 'pib' && sp.pict) parts.push({ pict: sp.pict });
          continue;
        }
        if (w === 'shptxt') { const blocks = readBoxText(ctx); if (blocks.length) parts.push({ text: blocks }); continue; }
        if (w === 'shp') { handleShape(collector, ctx); continue; }
        i = startPos;
        skipToMatchingClose();                               // \shprslt and anything else
      }
    };
    walk();
    if (ctx.hidden || ctx.deleted) return;
    const alt = props.has('wzDescription') ? props.get('wzDescription').text.replace(/\s+/g, ' ').trim() : '';
    const bordered = props.has('fLine') && props.get('fLine').text.trim() === '1';
    const wordArt = props.has('gtextUNICODE') ? props.get('gtextUNICODE').text.replace(/\s+/g, ' ').trim() : '';
    if (wordArt && !parts.some((o) => o.text)) parts.push({ text: [{ type: 'para', text: wordArt }] });
    for (const o of parts) {
      if (o.pict) pushGraphic(collector, o.pict, alt);
      else pushBoxText(collector, o.text, bordered);
    }
  }
  // {\*\do … \dptxbx {\dptxbxtext …}}: an old (Word 97) drawing object; its text box is kept as handleShape keeps a shape's.
  function handleDrawingObject(collector, ctx) {
    let line = null;
    const texts = [];
    for (;;) {
      const tok = readToken();
      if (!tok || tok.t === 'close') break;
      if (tok.t === 'ctrl') {
        if (tok.word === 'dplinehollow') line = false;
        else if (/^dpline(solid|dot|dash)/.test(tok.word)) line = true;
        continue;
      }
      if (tok.t !== 'open') continue;
      const startPos = i;
      const t2 = readToken();
      if (t2 && t2.t === 'ctrl' && t2.word === 'dptxbxtext') { const blocks = readBoxText(ctx); if (blocks.length) texts.push(blocks); continue; }
      i = startPos;
      skipToMatchingClose();
    }
    if (ctx.hidden || ctx.deleted) return;
    for (const blocks of texts) pushBoxText(collector, blocks, line === true);
  }

  // Walks a \result destination's own content (called right after its '\result' control
  // word — the same "tokens not yet read" convention as readPictureData) looking for the
  // first \pict inside it: RTF's usual print-fallback picture for an object a reader that
  // doesn't understand \object (or, here, whose \objdata this parser couldn't read) can
  // still show — e.g. a WMF/EMF render of an Excel range or a Visio drawing. Recurses into
  // EVERY nested group, ignorable or not (an ordinary \*\shppict/\nonshppict wrapper, or a
  // plain formatting subgroup some writers use), since we're hunting for a picture, not
  // otherwise interpreting \result's content — unlike handleGroup's own generic destination
  // handling, nothing else in \result is transcribable. Always consumes exactly up to this
  // destination's own matching close, whether or not a picture was found, so the caller
  // (handleObject) can keep reading \object's own remaining tokens correctly afterwards.
  function findPictureInGroup() {
    let found = null;
    for (;;) {
      const tok = readToken();
      if (!tok || tok.t === 'close') return found;
      if (tok.t !== 'open') continue;                        // stray text/ctrl/sym: no picture here
      const startPos = i;
      let t2 = readToken();
      if (t2 && t2.t === 'sym' && t2.ch === '*') t2 = readToken();
      const word = t2 && t2.t === 'ctrl' ? t2.word : null;
      if (word === 'pict') {
        const data = readPictureData();
        if (data && !found) found = data;
        continue;
      }
      i = startPos;
      const nested = findPictureInGroup();
      if (nested && !found) found = nested;
    }
  }

  // RTF \object: see parseOle1EmbeddedObject/RTF_LINKED_OBJECT_PLACEHOLDER (above parseRtf)
  // for \objdata's own OLE1 layout. Reuses the DOCX legacy-equation machinery wholesale
  // (LEGACY_EQUATION_PROGID_RE / LEGACY_EQUATION_PLACEHOLDER / oleNotTranscribedPlaceholder,
  // all module-level, above) so an RTF equation/non-equation placeholder reads identically to
  // the .docx one — same wording, same segment shape. Called right after the '\object'
  // control word (handleGroup's own dispatch below), with \object's own group still open.
  function handleObject(collector, ctx) {
    let isLink = false;
    let objClass = null;
    let objDataHex = '';
    let resultPicture = null;
    for (;;) {
      const tok = readToken();
      if (!tok || tok.t === 'close') break;
      if (tok.t === 'ctrl') {
        if (tok.word === 'objemb') isLink = false;
        else if (tok.word === 'objlink') isLink = true;
        continue;                                            // every other \obj* control word (objw, objh, objscalex, …): appearance only
      }
      if (tok.t !== 'open') continue;                         // stray text/sym at this level: never meaningful
      const startPos = i;
      let t2 = readToken();
      if (t2 && t2.t === 'sym' && t2.ch === '*') t2 = readToken();
      const word = t2 && t2.t === 'ctrl' ? t2.word : null;
      if (word === 'objclass') { objClass = captureGroupPlainText().trim(); continue; }
      if (word === 'objdata') {
        let buf = '';
        for (;;) {
          const tk = readToken();
          if (!tk || tk.t === 'close') break;
          if (tk.t === 'open') { skipToMatchingClose(); continue; }
          if (tk.t === 'text') buf += tk.ch;
        }
        objDataHex += buf;
        continue;
      }
      if (word === 'result') { resultPicture = findPictureInGroup(); continue; }
      i = startPos;
      skipToMatchingClose();                                  // \objalias, an appearance subgroup, …: nothing else here is transcribable
    }

    if (isLink) {
      pushSegment(collector, { type: 'imgnote', text: RTF_LINKED_OBJECT_PLACEHOLDER, prodnote: true, render: 'required' });
      return;
    }

    const isEquation = !!objClass && LEGACY_EQUATION_PROGID_RE.test(objClass);
    if (isEquation) {
      let mathml = null;
      if (objDataHex) {
        try {
          const nativeData = parseOle1EmbeddedObject(hexToBytes(objDataHex));
          const eq = readOleEquation(nativeData);
          if (eq.mathml) mathml = eq.mathml;
        } catch { /* mathml stays null: the OLE1 header/CFB/MTEF could not be read — same outcome as mtef.mjs's own errors */ }
      }
      if (mathml) {
        const seg = { type: 'math', mathml };
        const latex = mathmlToLatex(mathml);
        if (latex) seg.latex = latex;
        pushSegment(collector, seg);
        return;
      }
      pushSegment(collector, { type: 'imgnote', text: LEGACY_EQUATION_PLACEHOLDER, prodnote: true, render: 'required' });
      rtfUnreadableEqCount++;
      return;
    }

    // Non-equation embed (Excel, Package, Visio, …): the DOCX docx-fix-item-8 placeholder,
    // UNLESS \result offered a real fallback picture — then that picture IS the transcribable
    // content (a graphic, same as any other RTF picture), with the placeholder text kept as
    // its description rather than discarded.
    const placeholderText = oleNotTranscribedPlaceholder(objClass || '');
    if (resultPicture) {
      const path = `rtf-image-${++imageCounter}.${resultPicture.ext}`;
      if (collector.para) endParagraph(collector);
      collector.blocks.push({ type: 'graphic', src: path, alt: placeholderText });
      resources.push({ path, mime: resultPicture.mime, bytes: resultPicture.bytes });
      return;
    }
    pushSegment(collector, { type: 'imgnote', text: placeholderText, prodnote: true, render: 'required' });
    rtfOleCount++;
  }

  // RTF math: {\mmath{\*\moMath …}{\mmathPict <fallback picture>}} — how Word (2007 and later)
  // and LibreOffice write an Office Math equation in RTF (RTF 1.9.1, "Office Open XML Math").
  // The groups spell out the OMML tree: each control word \mX is the OMML element m:X (\mf →
  // m:f, \msSubSup → m:sSubSup, \mr → m:r); a run's text is its m:t, its own properties control
  // words ({\mr\mscr0\msty2 a}); a property that holds a value is a group holding it
  // ({\mbegChr (} → <m:begChr m:val="("/>, an empty one {\mbegChr } → m:val="") or, when it is
  // on/off, a control word (\mgrow0, \mdegHide1) — see RTF_MATH_VALUE_PROPS above. Rebuilt as
  // OMML and read by the same omml.mjs the .docx reader uses, so an equation reads the same
  // from either format (import fix list #45; tests/rtf_math_caption_1oct.test.mjs rebuilds the
  // Word fixtures' OMML as RTF and compares the MathML). The \mmathPict fallback picture is
  // shown only when the file holds no equation text at all (LibreOffice does that for some).
  // Called right after the '\mmath' control word, with its group still open.
  let rtfMathDepth = 0;                                      // math groups inside math groups (see rtfDepth): deeper than RTF_MAX_DEPTH they are left out
  function readRtfMathElement(name, uc0 = 1) {
    if (rtfMathDepth >= RTF_MAX_DEPTH) { rtfDeepSeen = true; skipToMatchingClose(); return ''; }
    rtfMathDepth++;
    try { return readRtfMathElementBody(name, uc0); } finally { rtfMathDepth--; }
  }
  function readRtfMathElementBody(name, uc0) {
    const xmlEsc = (v) => String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const isRun = name === 'r';
    const isValue = RTF_MATH_VALUE_PROPS.has(name);
    const isPr = /Pr$/.test(name);
    let uc = uc0, inner = '', text = '', hasChild = false, rPr = '';
    const readInto = () => {
      if (rtfMathDepth >= RTF_MAX_DEPTH) { rtfDeepSeen = true; skipToMatchingClose(); return; }
      rtfMathDepth++;
      try { readIntoBody(); } finally { rtfMathDepth--; }
    };
    const readIntoBody = () => {
      for (;;) {
        const tok = readToken();
        if (!tok || tok.t === 'close') return;
        if (tok.t === 'text') { text += tok.ch; continue; }
        if (tok.t === 'bytes') { text += rtfDecodeBytes(tok.bytes, docCp); continue; }
        if (tok.t === 'ctrl') {
          if (tok.word === 'u' && tok.param != null) { text += rtfUnicodeChar(tok.param, uc); continue; }
          if (tok.word === 'uc') { uc = tok.param == null ? 1 : tok.param; continue; }
          // A run's own math properties are control words in the run ({\mr\mscr0\msty2 a}, {\mr \mnor text}); an on/off property of a
          // property group is a control word with a number (\mdegHide1, \mgrow0) — the OMML property it spells.
          if (/^m[A-Za-z]+$/.test(tok.word)) {
            const prop = tok.word.slice(1);
            if (isRun && RTF_MATH_RUN_PROPS.has(prop)) {
              if (!RTF_MATH_ONOFF_PROPS.has(prop) || tok.param !== 0) rPr += rtfMathValueXml(prop, tok.param);
            } else if (isPr && RTF_MATH_VALUE_PROPS.has(prop)) { hasChild = true; inner += rtfMathValueXml(prop, tok.param); }
          }
          continue;                                            // character formatting (\i, \f3, \fs24 …): appearance only
        }
        if (tok.t !== 'open') continue;
        const startPos = i;
        let t2 = readToken();
        let star = false;
        if (t2 && t2.t === 'sym' && t2.ch === '*') { star = true; t2 = readToken(); }
        const w = t2 && t2.t === 'ctrl' ? t2.word : null;
        if (w && /^m[A-Za-z]/.test(w) && w !== 'mmathPict') {
          const child = w.slice(1);
          if (isRun && RTF_MATH_RUN_PROPS.has(child)) { rPr += readRtfMathElement(child, uc); continue; }
          hasChild = true;
          inner += readRtfMathElement(child, uc);
          continue;
        }
        if (star) { i = startPos; skipToMatchingClose(); continue; }       // an ignorable group that is not math (\*\insrsid …): never read as text
        i = startPos;                                          // a plain formatting group: its text is this element's
        readInto();
      }
    };
    readInto();
    const run = (t) => `<m:r><m:t xml:space="preserve">${xmlEsc(t)}</m:t></m:r>`;
    if (isRun) return `<m:r>${rPr ? `<m:rPr>${rPr}</m:rPr>` : ''}<m:t xml:space="preserve">${xmlEsc(text)}</m:t></m:r>`;
    if (isValue && !hasChild) return rtfMathValueXml(name, text);
    if (isPr) return `<m:${name}>${inner}</m:${name}>`;
    // text written straight into an argument with no \mr round it is that argument's run
    return `<m:${name}>${text.trim() && !hasChild ? run(text) : ''}${inner}${text.trim() && hasChild ? run(text) : ''}</m:${name}>`;
  }
  function handleMath(collector, ctx) {
    const uc = ctx && ctx.uc != null ? ctx.uc : 1;
    const found = [], direct = [];                             // found: { xml, display } — display: written as {\moMathPara …}
    let fallbackPicture = null;
    // The equations of a {\*\moMathPara {\moMathParaPr …}{\*\moMath …}{\*\moMath …}}: each is a display equation of its own (the .docx
    // reader gives each m:oMath of an m:oMathPara its own block).
    const readMathPara = () => {
      const own = [];
      for (;;) {
        const tok = readToken();
        if (!tok || tok.t === 'close') break;
        if (tok.t !== 'open') continue;
        const startPos = i;
        let t2 = readToken();
        let ignorable = false;
        if (t2 && t2.t === 'sym' && t2.ch === '*') { ignorable = true; t2 = readToken(); }
        const word = t2 && t2.t === 'ctrl' ? t2.word : null;
        if (word === 'moMath') { found.push({ xml: readRtfMathElement('oMath', uc), display: true }); continue; }
        if (word && /^m[A-Za-z]+$/.test(word) && word !== 'moMathParaPr' && word !== 'mmathPr' && !ignorable) { own.push(readRtfMathElement(word.slice(1), uc)); continue; }
        i = startPos;
        skipToMatchingClose();                                 // \moMathParaPr …
      }
      if (own.length) found.push({ xml: `<m:oMath>${own.join('')}</m:oMath>`, display: true });
    };
    for (;;) {
      const tok = readToken();
      if (!tok || tok.t === 'close') break;
      if (tok.t !== 'open') continue;
      const startPos = i;
      let t2 = readToken();
      let ignorable = false;
      if (t2 && t2.t === 'sym' && t2.ch === '*') { ignorable = true; t2 = readToken(); }
      const word = t2 && t2.t === 'ctrl' ? t2.word : null;
      if (word === 'moMath') { found.push({ xml: readRtfMathElement('oMath', uc), display: false }); continue; }
      if (word === 'moMathPara') { readMathPara(); continue; }
      if (word === 'mmathPict') { i = startPos; const pic = findPictureInGroup(); if (pic && !fallbackPicture) fallbackPicture = pic; continue; }
      // Math written straight inside \mmath, with no \moMath around it (an inline equation as some writers give it): the
      // children are the equation's own elements, read as one m:oMath.
      if (word && /^m[A-Za-z]+$/.test(word) && word !== 'mmathPr' && !ignorable) { direct.push(readRtfMathElement(word.slice(1), uc)); continue; }
      i = startPos;
      skipToMatchingClose();                                  // \mmathPr …
    }
    if (!found.length && direct.length) found.push({ xml: `<m:oMath>${direct.join('')}</m:oMath>`, display: false });
    if (ctx && (ctx.hidden || ctx.deleted)) return;            // (hidden text and a tracked deletion are not transcribed)
    const pictureOnly = () => { rtfPictureOnlyEqCount++; pushGraphic(collector, fallbackPicture, RTF_PICTURE_ONLY_EQUATION_ALT); };
    // An equation the writer gave ONLY as its fallback picture (LibreOffice writes just {\mmathPict …} for some of its formulas —
    // fractions, roots, functions with subscripts — with no \moMath at all): there is no equation text to read, but the picture is
    // kept, marked "equation not transcribed", and the load warning says so; it used to vanish without a trace.
    if (!found.length && fallbackPicture) { pictureOnly(); return; }
    for (const { xml, display } of found) {
      let mathml = null;
      try {
        const doc = parseXml(xml.replace(/^<m:(\w+)/, `<m:$1 xmlns:m="${MATH_NS}"`));
        mathml = ommlElementToMathML(doc.documentElement);
      } catch { mathml = null; }
      if (!mathml) {
        // (cannot be read: the picture the writer gave, if any, is kept instead — once; else the placeholder)
        if (fallbackPicture) { pictureOnly(); fallbackPicture = null; }
        else pushSegment(collector, { type: 'imgnote', text: LEGACY_EQUATION_PLACEHOLDER, prodnote: true, render: 'required' });
        continue;
      }
      const seg = { type: 'math', mathml };
      const latex = mathmlToLatex(mathml);
      if (latex) seg.latex = latex;
      if (display) rtfDisplayMath.add(seg);
      pushSegment(collector, seg);
    }
  }

  function handleCtrl(collector, ctx, word, param) {
    switch (word) {
      case 'par': endParagraph(collector); return;
      // \pard resets the paragraph properties — the list ones too (\ls \ilvl the \pn group, the left indent). Between \pard's they
      // persist from paragraph to paragraph, as the spec says (Cocoa writes one \pard for a whole list).
      case 'pard': collector.styleId = null; collector.outlineLvl = null; collector.align = null; collector.lsId = null; collector.ilvl = 0; collector.pn = null; collector.liLeft = null; return;
      case 'ls': collector.lsId = param; return;
      case 'ilvl': collector.ilvl = param == null ? 0 : param; return;
      case 'li': case 'lin': collector.liLeft = param == null ? 0 : param; return;
      // K3 (BANA 11.6.1d/11.6.1c, transcriber KD): print's own column alignment for a table
      // cell's paragraph — \qr (the whole cell right-adjusted, §11.6.1c's "print text shows
      // column entries... right-adjusted") or \tqdec (a decimal tab stop declared for this
      // paragraph, the classic typewriter "align figures on the decimal point" convention,
      // matching DOCX's w:tab val="decimal"). Read at \cell (below) and reset there; \ql/
      // \qc/\qj are NOT a place-value signal but do clear a stray \qr from earlier in the
      // same paragraph (a \tqdec already seen is kept — a decimal tab stop can coexist with
      // general \ql/\qj alignment).
      case 'qr': collector.align = 'right'; return;
      case 'tqdec': collector.align = 'decimal'; return;
      case 'ql': case 'qc': case 'qj': if (collector.align !== 'decimal') collector.align = null; return;
      case 'plain': ctx.tf = 0; ctx.href = null; ctx.ttf = null; ctx.lid = null; ctx.lidFe = null; ctx.font = null; ctx.va = null; ctx.hidden = false; ctx.deleted = false; ctx.caps = false; return;
      case 'f': ctx.font = param; return;
      // Sub/superscript: \sub \super (\nosupersub ends either), and the raised/lowered position \up N / \dn N in half-points (0 = baseline).
      case 'sub': ctx.va = 'sub'; return;
      case 'super': ctx.va = 'sup'; return;
      case 'nosupersub': ctx.va = null; return;
      case 'up': ctx.va = param === 0 ? null : 'sup'; return;
      case 'dn': ctx.va = param === 0 ? null : 'sub'; return;
      // Hidden text and a tracked deletion are not transcribed (a tracked insertion, \revised, is kept).
      case 'v': ctx.hidden = param !== 0; return;
      case 'deleted': ctx.deleted = param !== 0; return;
      // \caps and \scaps: capitals in print, capitals in braille (RUEB 9.6.1; small capitals are "best transcribed as capitals").
      case 'caps': case 'scaps': ctx.caps = param !== 0; return;
      // Language of the run (Windows LCIDs; input/lang.mjs): \lang / \langnp (Latin text), \langfe / \langfenp (East Asian
      // text), \deflang the document default. Recorded as seg.lang only; braille is unchanged.
      case 'lang': case 'langnp': ctx.lid = param; return;
      case 'langfe': case 'langfenp': ctx.lidFe = param; return;
      case 'deflang': rtfMainLid = param; return;
      case 'b': ctx.tf = param === 0 ? (ctx.tf & ~TF_BOLD) : (ctx.tf | TF_BOLD); return;
      case 'i': ctx.tf = param === 0 ? (ctx.tf & ~TF_ITALIC) : (ctx.tf | TF_ITALIC); return;
      // Every underline kind (single, double \uldb, dotted \uld, words \ulw, thick \ulth, wave, dash …) is underlined print.
      case 'ulnone': ctx.tf = ctx.tf & ~TF_UNDERLINE; return;
      // UEB 9.5.1 "crossed-out type": RTF's own strikethrough control words (single \strike,
      // double \striked1 — both print the same way, so both map to the same 'strike' slot).
      // UEB 9.5.1 "crossed-out type": RTF's own strikethrough control words — single \strike,
      // and double strikethrough, spelled \strikedl (letters s-t-r-i-k-e-d-L, RTF 1.9.1 spec)
      // but this tokenizer's readToken (above) reads a control word's letters and any trailing
      // digits separately, so a producer that writes the easily-confused digit spelling
      // \striked1 reaches here as word "striked" + param 1, not a distinct word — handled
      // the same as \strikedl. Both print the same way, so both map to the same 'strike' slot.
      case 'strike': case 'strikedl': case 'striked': ctx.ttf = param === 0 ? null : 'strike'; return;
      case 's': collector.styleId = param; return;
      case 'outlinelevel': collector.outlineLvl = param == null ? 0 : param; return;
      case 'tab': emitText(collector, ctx, ' '); return;
      case 'line': emitText(collector, ctx, '\n'); return;
      case 'ldblquote': emitText(collector, ctx, '“'); return;
      case 'rdblquote': emitText(collector, ctx, '”'); return;
      case 'lquote': emitText(collector, ctx, '‘'); return;
      case 'rquote': emitText(collector, ctx, '’'); return;
      case 'emdash': emitText(collector, ctx, '—'); return;
      case 'endash': emitText(collector, ctx, '–'); return;
      case 'bullet': emitText(collector, ctx, '• '); return;
      // \ucN: how many fallback characters follow each \uN — group-scoped, like the other character properties.
      case 'uc': ctx.uc = param == null ? 1 : param; return;
      case 'u': emitText(collector, ctx, rtfUnicodeChar(param, ctx.uc == null ? 1 : ctx.uc)); return;
      case 'trowd': if (!collector.tableRows) collector.tableRows = []; collector.tableCells = []; collector.cellDefs = []; collector.pendingCl = null; return;
      // IMP-W5: the cell definitions' merge flags (horizontal \clmgf first / \clmrg continued; vertical \clvmgf first / \clvmrg
      // continued), each applying to the next \cellx; used at \row to repeat a merged cell's content in every cell it covers.
      case 'clmgf': (collector.pendingCl ||= {}).h = 'first'; return;
      case 'clmrg': (collector.pendingCl ||= {}).h = 'cont'; return;
      case 'clvmgf': (collector.pendingCl ||= {}).v = 'first'; return;
      case 'clvmrg': (collector.pendingCl ||= {}).v = 'cont'; return;
      case 'cellx': (collector.cellDefs ||= []).push({ ...(collector.pendingCl || {}), x: param }); collector.pendingCl = null; return;
      // IMP-W6: the end of a cell of a NESTED table (\itap2 and deeper): its value is kept for the nested row, which \nesttableprops /
      // \nestrow closes (handleNestTableProps); the outer cell's own \cell then holds a placeholder and the nested table follows the outer.
      case 'nestcell': {
        let v = '';
        if (collector.para) {
          flushRun(collector.para);
          const segs = collector.para.segments;
          v = richCellFromSegments(segs) ?? segs.filter((seg) => seg.type === 'text').map((seg) => seg.text).join('').replace(/[ \t]+/g, ' ').trim();
        }
        collector.para = null;
        (collector.nestCells ||= []).push(v);
        return;
      }
      case 'cell': {
        if (!collector.tableRows) collector.tableRows = [];
        let cellValue = '';
        if (collector.para) {
          flushRun(collector.para);
          const segs = collector.para.segments;
          const plainText = segs.filter((seg) => seg.type === 'text').map((seg) => seg.text).join('').replace(/[ \t]+/g, ' ').trim();
          // An \object equation/placeholder inside a table cell (docx-style data table, not
          // the BANA stairstep path): richCellFromSegments (D8, above) is the SAME { text,
          // segments } cell shape the DOCX/ODT table readers already build for a cell with
          // maths/emphasis/links — reused rather than duplicated, so cell-markup.mjs's own
          // formatter/exporter/editor support for a rich cell covers this for free.
          cellValue = richCellFromSegments(segs) ?? plainText;
        }
        collector.para = null;
        // IMP-W6: a nested table ended in this cell: a placeholder stands here, the nested table follows the outer one.
        if (collector.nestCells && collector.nestCells.length) (collector.nestRows ||= []).push(collector.nestCells.splice(0));   // cells with no \nestrow
        if (collector.nestRows && collector.nestRows.length) {
          const [head, ...body] = collector.nestRows;
          (collector.nestedTables ||= []).push({ type: 'table', headers: head, rows: body });
          collector.nestRows = [];
          cellValue = typeof cellValue === 'string' ? (cellValue ? `${cellValue} ${NESTED_TABLE_PLACEHOLDER}` : NESTED_TABLE_PLACEHOLDER)
            : { ...cellValue, text: `${cellValue.text || ''} ${NESTED_TABLE_PLACEHOLDER}`.trim(), segments: [...(cellValue.segments || []), { type: 'text', text: ` ${NESTED_TABLE_PLACEHOLDER}` }] };
        }
        (collector.tableCells ||= []).push(cellValue);
        (collector.cellAlignBuf ||= []).push(collector.align || null);   // K3
        collector.align = null;
        return;
      }
      case 'row': {
        if (collector.tableCells && collector.tableCells.length) {
          // IMP-W5: repeat a merged cell's content in every cell it covers (across: \clmgf + \clmrg...; down: \clvmgf + \clvmrg...).
          const defs = collector.cellDefs || [], cells = collector.tableCells;
          const copy = (v) => (v && typeof v === 'object' ? { ...v } : v);
          for (let c = 0; c < cells.length; c++) {
            if (defs[c] && defs[c].h === 'first') for (let d = c + 1; d < cells.length && defs[d] && defs[d].h === 'cont'; d++) cells[d] = copy(cells[c]);
          }
          // (the vertical merges, and cells that span several grid columns, are settled when the table ends: finalizeTableIfPending)
          (collector.tableRowMeta ||= []).push({ v: cells.map((_, c) => (defs[c] && defs[c].v) || null), x: cells.map((_, c) => (defs[c] && Number.isFinite(defs[c].x) ? defs[c].x : null)) });
          // K3: the FIRST completed row becomes finalizeTableIfPending's `headers`, so only
          // vote a column's alignment from a row that will land in `rows` (already ≥ 1 row).
          if (collector.tableRows && collector.tableRows.length >= 1) {
            const votes = (collector.tableAlignVotes ||= []);
            (collector.cellAlignBuf || []).forEach((al, ci) => { if (al) (votes[ci] ||= new Set()).add(al); });
          }
          (collector.tableRows ||= []).push(collector.tableCells);
        }
        collector.tableCells = [];
        collector.cellAlignBuf = [];
        return;
      }
      default:
        if (RTF_UNDERLINE_WORDS.has(word)) ctx.tf = param === 0 ? (ctx.tf & ~TF_UNDERLINE) : (ctx.tf | TF_UNDERLINE);
        return;                                             // every other control word: no structural meaning we track
    }
  }

  // Consumes tokens up to and including THIS group/stream's own matching close (or end of
  // input at the top level, which has none). Every '{' met here is fully consumed —
  // including its own matching '}' — by handleGroup before the loop continues, so the first
  // 'close' this loop itself sees is guaranteed to belong to this call, not a descendant's.
  function parseContent(collector, ctx) {
    let flat = 0;                                            // groups open below the depth limit, read here in this loop (see rtfDepth)
    for (;;) {
      const tok = readToken();
      if (!tok) return;
      if (tok.t === 'close') { if (flat > 0) { flat--; continue; } return; }
      if (tok.t === 'open') {
        if (rtfDepth >= RTF_MAX_DEPTH) { flat++; rtfDeepSeen = true; continue; }
        rtfDepth++;
        try { handleGroup(collector, ctx); } finally { rtfDepth--; }
        continue;
      }
      if (tok.t === 'text') { emitText(collector, ctx, tok.ch); continue; }
      if (tok.t === 'bytes') { emitText(collector, ctx, decodeRtfBytes(tok.bytes, fontOf(ctx))); continue; }   // \'hh through the font's code page
      if (tok.t === 'ctrl') { handleCtrl(collector, ctx, tok.word, tok.param); continue; }
      // tok.t === 'sym': \* is only meaningful right after '{' (handleGroup's own peek);
      // mid-group control symbols (\:, \|, …) carry no structure we track.
    }
  }

  // IMP-W6: {\*\nesttableprops \trowd … \cellx … \nestrow}: the nested row's definition, which ends the nested row — the cells read so
  // far (\nestcell) are that row. Nothing else in the group is needed (the table's cell widths are not modelled).
  function handleNestTableProps(collector) {
    for (;;) {
      const tok = readToken();
      if (!tok) return;
      if (tok.t === 'close') return;
      if (tok.t === 'open') { skipToMatchingClose(); continue; }
      if (tok.t === 'ctrl' && tok.word === 'nestrow') (collector.nestRows ||= []).push((collector.nestCells || []).splice(0));
    }
  }

  function handleGroup(collector, ctx) {
    const startPos = i;
    let tok = readToken();
    let ignorable = false;
    if (tok && tok.t === 'sym' && tok.ch === '*') { ignorable = true; tok = readToken(); }
    const word = tok && tok.t === 'ctrl' ? tok.word : null;

    // The list table and the list override table (import fix list #17) are read, not skipped.
    if (word === 'listtable') { readListTable(ctx.uc == null ? 1 : ctx.uc); return; }
    if (word === 'listoverridetable') { readListOverrideTable(ctx.uc == null ? 1 : ctx.uc); return; }
    // IMP-W9: a running header / footer, and a comment (\*\annotation): read for the load notice only, never into the text.
    if (word === 'header' || word === 'headerl' || word === 'headerr' || word === 'headerf') { rtfLeftOut.headers.push(captureGroupPlainText()); return; }
    if (word === 'footer' || word === 'footerl' || word === 'footerr' || word === 'footerf') { rtfLeftOut.footers.push(captureGroupPlainText()); return; }
    if (word === 'annotation') { if (isRealLeftOutText(captureGroupPlainText())) rtfLeftOut.comments++; return; }
    if (word && RTF_SKIP_KEYWORDS.has(word)) { skipToMatchingClose(); return; }
    if (word === 'nesttableprops') { handleNestTableProps(collector); return; }
    if (word === 'info') { handleInfo(collector); return; }
    if (word === 'footnote') {
      if (ctx.hidden || ctx.deleted) { skipToMatchingClose(); return; }     // a hidden or deleted reference has no note
      handleFootnote(collector, ctx);
      return;
    }
    if (word === 'field') { parseContent(collector, { ...ctx, fieldHrefBox: { value: null } }); return; }
    if (word === 'fldinst') {
      const href = extractHyperlinkHref(captureGroupPlainText());
      if (href && ctx.fieldHrefBox) ctx.fieldHrefBox.value = href;
      return;
    }
    if (word === 'fldrslt') {
      parseContent(collector, { ...ctx, href: (ctx.fieldHrefBox && ctx.fieldHrefBox.value) || ctx.href || null });
      return;
    }
    if (word === 'pict') { handlePicture(collector, ctx); return; }
    // A picture is written twice for readers of different vintage: {\*\shppict {\pict …}} (Word 2000 and later) and
    // {\nonshppict {\pict …}} (the same picture for older readers) — the first that gives a picture is read, the other skipped.
    if (word === 'shppict') {
      const before = imageCounter;
      parseContent(collector, { ...ctx });
      if (imageCounter > before) collector.skipNonShp = true;
      return;
    }
    if (word === 'nonshppict') {
      if (collector.skipNonShp) { collector.skipNonShp = false; skipToMatchingClose(); return; }
      parseContent(collector, { ...ctx });
      return;
    }
    if (word === 'shp') { handleShape(collector, ctx); return; }
    if (word === 'do') { handleDrawingObject(collector, ctx); return; }
    if (word === 'object') { handleObject(collector, ctx); return; }
    if (word === 'mmath') { handleMath(collector, ctx); return; }
    // The label a list paragraph was written with — "1.", "a)", a bullet, through the font it is in (a Symbol or Wingdings byte is that
    // font's glyph) — kept as it is; rtfListInfo (endParagraph) turns it into the item's marker and level.
    if (word === 'listtext' || word === 'pntext') {
      collector.pendingMarker = rtfItemsText(captureRtfItems(ctx.uc == null ? 1 : ctx.uc), ctx.font).replace(/\s+/g, ' ').trim();
      return;
    }
    if (word === 'pn') { collector.pn = readPn(ctx.uc == null ? 1 : ctx.uc); return; }
    if (ignorable) { skipToMatchingClose(); return; }       // spec: an unknown \*-marked destination is always skippable

    i = startPos;                                            // ordinary nested formatting group: replay its own tokens
    parseContent(collector, { ...ctx });
  }

  function newCollector() {
    return {
      blocks: [], para: null, styleId: null, outlineLvl: null, pendingMarker: null,
      lsId: null, ilvl: 0, pn: null, liLeft: null, skipNonShp: false, picGraphic: null, captionFor: null,      // list membership and indent of the current paragraph (until \pard)
      pendingNotes: [], pendingListOpen: false, pendingList: null, title: null, infoTitle: null, h1Title: null,
      tableRows: null, tableCells: null, align: null, cellAlignBuf: [], tableAlignVotes: null,
    };
  }

  const collector = newCollector();
  const rootCtx = { tf: 0, href: null, fieldHrefBox: null };
  const first = readToken();
  if (first && first.t === 'open') handleGroup(collector, rootCtx);
  else parseContent(collector, rootCtx);                    // malformed/non-brace input: best effort
  if (collector.para || collector.pendingMarker) endParagraph(collector);
  finalizeTableIfPending(collector);
  if (collector.pendingNotes.length) { collector.blocks.push(...collector.pendingNotes); collector.pendingNotes = []; }

  // Title precedence, real signals only (a guessed "first short paragraph" used to stand in
  // for a real one here — checked in over a lo-math-char.rtf's own plain label paragraph,
  // "Fraction:", becoming a false title — the same "a false title is worse than a missed
  // one" reasoning as A48's whole precedence chain, but a guess never satisfies it): a
  // Title-style paragraph (isTitle, above — already a real, typographic signal, so it's
  // already set collector.title directly and needs no fallback here); else \info{\title …},
  // RTF's own document-properties title (handleInfo, above — DOCX's docProps/core.xml dc:title
  // and HTML's <title> element's counterpart); else the document's first Heading-1-level
  // paragraph (h1Title, above — RTF/Word's structural counterpart of HTML's own
  // <title>-else-<h1> fallback, parseHtml, above).
  if (!collector.title) collector.title = collector.infoTitle || collector.h1Title || null;

  const result = { title: collector.title || null, blocks: collector.blocks };
  if (resources.length) result.resources = resources;
  // Surface the \object placeholder counts through the same model.warnings mechanism as
  // DOCX's own legacy-equation/non-equation-OLE placeholders (parseDocx, above) — same
  // wording, so the editor's parse-warning banner reads identically for both formats.
  if (rtfUnreadableEqCount) {
    (result.warnings || (result.warnings = [])).push(
      `${rtfUnreadableEqCount} old-style equation${rtfUnreadableEqCount === 1 ? '' : 's'} (Equation Editor 3.0 / MathType) could not be read; ` +
      `${rtfUnreadableEqCount === 1 ? 'it has' : 'they have'} been replaced with a placeholder and must be re-entered with the equation editor`);
  }
  if (rtfOleCount) {
    (result.warnings || (result.warnings = [])).push(
      `${rtfOleCount} embedded object${rtfOleCount === 1 ? '' : 's'} (e.g. a spreadsheet, another document, or another embedded file) could not be read; ` +
      `${rtfOleCount === 1 ? 'it has' : 'they have'} been replaced with a placeholder.`);
  }
  if (rtfDeepSeen) {
    (result.warnings || (result.warnings = [])).push(
      `Parts of this file are nested far deeper than any real document (more than ${RTF_MAX_DEPTH} levels of groups); the text there was read without its formatting or structure.`);
  }
  // An equation the file holds only as a picture (see handleMath) cannot be brailled: it stays as a picture, marked as not transcribed.
  if (rtfPictureOnlyEqCount) {
    (result.warnings || (result.warnings = [])).push(
      `${rtfPictureOnlyEqCount} equation${rtfPictureOnlyEqCount === 1 ? ' is' : 's are'} in this file only as a picture (the program that saved it wrote no equation text), so ` +
      `${rtfPictureOnlyEqCount === 1 ? 'it cannot' : 'they cannot'} be brailled: ${rtfPictureOnlyEqCount === 1 ? 'it has' : 'they have'} been kept as a picture marked "${RTF_PICTURE_ONLY_EQUATION_ALT}" and must be re-entered with the equation editor.`);
  }
  // Symbols typed in a symbol font (Wingdings, Symbol, …) with no known Unicode equivalent are shown as a replacement mark (as the Word reader says).
  if (symLog.size) {
    const names = [...symLog.keys()];
    const cnt = names.length;
    const shown = names.slice(0, 6).join(', ') + (cnt > 6 ? `, and ${cnt - 6} more` : '');
    (result.warnings || (result.warnings = [])).push(
      `${cnt} symbol${cnt === 1 ? '' : 's'} typed in a symbol font (${shown}) ${cnt === 1 ? 'has' : 'have'} no known equivalent and ${cnt === 1 ? 'is' : 'are'} shown as a replacement mark (�); ` +
      `check ${cnt === 1 ? 'it' : 'them'} against the print`);
  }
  {
    const leftOut = leftOutNotice({ comments: rtfLeftOut.comments, headers: countDistinctRealTexts(rtfLeftOut.headers), footers: countDistinctRealTexts(rtfLeftOut.footers) });
    if (leftOut) (result.warnings || (result.warnings = [])).push(leftOut);
  }
  return finishLanguages(result);                          // foreign-language runs: noise dropped (input/lang.mjs)
}

// ---------- ODT (OpenDocument text) ----------
const ODT_TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const ODT_STYLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
const ODT_FO_NS = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0';
const ODT_XLINK_NS = 'http://www.w3.org/1999/xlink';
const ODT_DRAW_NS = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';

// A45/D3: a <text:note> (footnote/endnote) is genuinely inline — its <text:note-body> sits
// right inside the surrounding <text:p> — so before this fix getOdtText's generic
// "anything unrecognised just recurses" fallback (below) walked straight into it, splicing
// the note's own text into the enclosing paragraph's flat text exactly like the RTF D6 bug
// this task was told not to repeat. Skipped here (and in odtInlineSegments, below) so the
// note is only ever produced once, as its own separate block, by odtNoteBlock. Same
// reasoning for A45/D2's <draw:frame> (a picture, also inline): its svg:title/svg:desc
// wording has no business appearing as body prose either.
// Elements nested deeper than this inside one paragraph or list item are not walked one by one (the walk recurses): their text is taken whole.
const ODT_MAX_TEXT_DEPTH = 300;
function odtPlainText(el) {
  let text = '';
  const stack = [el];
  while (stack.length) {
    const n = stack.pop();
    if (n.nodeType === 3) { text += n.nodeValue || ''; continue; }
    const kids = n.childNodes || [];
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
  }
  return text;
}
function getOdtText(el, depth = 0) {
  let res = '';
  if (depth > ODT_MAX_TEXT_DEPTH) return odtPlainText(el);          // nested thousands deep (hostile): the text under it, read without a recursion of its own
  if (odtHiddenEl(el)) return '';                          // import fix list #19: hidden text is never transcribed
  for (const child of el.childNodes || []) {
    if (child.nodeType === 3) {
      if (odtDeleted(child)) continue;
      res += odtTextValue(child);                          // #18 / RUEB 9.6.1: sub/superscript markers, small/all capitals
    } else if (child.nodeType === 1) {
      const ln = child.localName;
      if (odtHiddenEl(child)) continue;
      if (ln === 's') {
        const c = odtSpaceCount(child.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:text:1.0', 'c') || child.getAttribute('text:c'));
        res += ' '.repeat(c);
      } else if (ln === 'tab' || ln === 'line-break') {
        res += ' ';
      } else if (ln === 'note' || ln === 'frame') {
        continue;                                          // handled separately — see odtNoteBlock/odtFrameImages
      } else if (ln === 'annotation' || ln === 'annotation-end') {
        continue;                                          // IMP-W9: a comment (office:annotation) is not transcribed (parseOdt counts it for the load notice)
      } else if (ln === 'ruby-text') {
        res += ` (${getOdtText(child, depth + 1)})`;                  // IMP-W11: a ruby guide follows its base text in brackets
      } else {
        res += getOdtText(child, depth + 1);
      }
    }
  }
  return odtMergeScripts(res);
}

// ---- Import fix list (30 Sep 2026): what a text node / element looks like to the reader, from its styles ----------------
// `odtCtx` is set by parseOdt around its (synchronous) walk, like odtSeenFrames below: { styleMap, deleted } where
// `deleted` is a WeakSet of the nodes inside a tracked deletion written as a text:change-start .. text:change-end range.
// Without it (a helper called on its own) nothing is hidden, raised or capitalised.
let odtCtx = null;
const odtAttr = (el, ns, name) => (el && el.getAttributeNS ? el.getAttributeNS(ns, name) : null) || '';
// The value of one style property, nearest style first: the style named, then its parent-style-name chain. undefined = no style says.
function odtStyleProp(styleMap, name, prop) {
  let cur = name;
  const seen = new Set();
  while (cur && styleMap && !seen.has(cur)) {
    seen.add(cur);
    const s = styleMap.get(cur);
    if (!s) return undefined;
    if (s[prop] !== undefined && s[prop] !== null) return s[prop];
    cur = s.parent || null;
  }
  return undefined;
}
// Hidden, raised/lowered and capitalised text, for the text node or element `node`: the nearest of the spans (and links) around
// it, then its paragraph's style, says (as Word: run style, then paragraph style).
function odtTextProps(node) {
  const out = { script: null, caps: false, hidden: false };
  const sm = odtCtx && odtCtx.styleMap;
  if (!sm) return out;
  let scriptSet = false, capsSet = false, hiddenSet = false;
  for (let n = node.nodeType === 3 ? node.parentNode : node; n && n.nodeType === 1; n = n.parentNode) {
    const ln = n.localName;
    const name = ln === 'span' || ln === 'a' || ln === 'p' || ln === 'h' ? odtAttr(n, ODT_TEXT_NS, 'style-name') : '';
    if (name) {
      if (!scriptSet) { const v = odtStyleProp(sm, name, 'script'); if (v !== undefined) { scriptSet = true; out.script = v === 'sub' || v === 'sup' ? v : null; } }
      if (!capsSet) { const v = odtStyleProp(sm, name, 'caps'); if (v !== undefined) { capsSet = true; out.caps = !!v; } }
      if (!hiddenSet) { const v = odtStyleProp(sm, name, 'hidden'); if (v !== undefined) { hiddenSet = true; out.hidden = !!v; } }
    }
    if (ln === 'p' || ln === 'h') break;
  }
  return out;
}
function odtDeleted(node) { return !!(odtCtx && odtCtx.deleted && odtCtx.deleted.has(node)); }
// Is this element's content never transcribed? A paragraph/heading/span/link whose style is hidden (text:display="none"), a
// hidden-text / hidden-paragraph field that is currently hidden, a paragraph holding a hidden-paragraph field, a hidden
// section, the tracked-changes list (its deleted text is not in the document any more), or a marker inside a deletion range.
function odtHiddenEl(el) {
  if (!el || el.nodeType !== 1) return false;
  const ln = el.localName;
  switch (ln) {
    case 'tracked-changes': return true;
    case 'hidden-text': case 'hidden-paragraph': return odtAttr(el, ODT_TEXT_NS, 'is-hidden') === 'true';
    case 'section': return odtAttr(el, ODT_TEXT_NS, 'display') === 'none';
    case 'p': case 'h': case 'span': case 'a': {
      if (odtDeleted(el)) return true;
      const sm = odtCtx && odtCtx.styleMap;
      const name = odtAttr(el, ODT_TEXT_NS, 'style-name');
      if (sm && name && odtStyleProp(sm, name, 'hidden') === true) return true;
      if (ln === 'p' || ln === 'h') {
        for (const c of el.childNodes || []) if (c.nodeType === 1 && c.localName === 'hidden-paragraph' && odtAttr(c, ODT_TEXT_NS, 'is-hidden') === 'true') return true;
      }
      return false;
    }
    default: return odtDeleted(el);
  }
}
// A text node's text as the reader keeps it: capitals applied (small capitals and all capitals both upper-case, RUEB 9.6.1 —
// Word's w:smallCaps / w:caps), and a raised or lowered run bracketed with the script markers (format/text-style.mjs SCRIPT_MARKS)
// the formatter turns into UEB level indicators. A raised or lowered run of only spaces marks nothing.
function odtTextValue(node) {
  const v = node.nodeValue || '';
  if (!odtCtx || !v) return v;
  const p = odtTextProps(node);
  let t = p.caps ? v.toUpperCase() : v;
  if (p.script && /\S/.test(t)) t = (p.script === 'sub' ? SCRIPT_MARKS.subOpen : SCRIPT_MARKS.supOpen) + t + SCRIPT_MARKS.end;
  return t;
}
// Adjacent runs of the same level share one marker pair (Word: paragraphRunText); a space between two runs of the same level
// stays inside the pair.
function odtMergeScripts(s) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  if (!s || s.indexOf(end) < 0) return s;
  let out = '', cur = null, pend = null;
  const flush = () => { if (pend) { out += end + pend.ws; pend = null; } };
  for (const ch of s) {
    if (ch === subOpen || ch === supOpen) {
      if (pend && pend.kind === ch) { out += pend.ws; pend = null; cur = ch; continue; }
      flush(); out += ch; cur = ch;
    } else if (ch === end) {
      if (cur) { flush(); pend = { kind: cur, ws: '' }; cur = null; } else { flush(); out += ch; }
    } else if (pend && /\s/.test(ch)) {
      pend.ws += ch;
    } else { flush(); out += ch; }
  }
  flush();
  return out;
}
// The nodes inside a tracked deletion written as a text:change-start .. text:change-end range (the deleted text itself is in
// text:tracked-changes, which is never read; this covers a range that still holds text in the body). Text nodes and the
// inline markers/objects are marked; a range may run over several paragraphs.
function odtCollectDeleted(body) {
  const deleted = new WeakSet();
  const delIds = new Set();
  for (const cr of body.getElementsByTagNameNS(ODT_TEXT_NS, 'changed-region')) {
    if ([...cr.childNodes].some((c) => c.nodeType === 1 && c.localName === 'deletion')) delIds.add(odtAttr(cr, ODT_TEXT_NS, 'id') || odtAttr(cr, 'http://www.w3.org/XML/1998/namespace', 'id'));
  }
  if (!delIds.size) return deleted;
  const open = new Set();
  const walk = (n) => {
    for (const c of n.childNodes || []) {
      if (c.nodeType === 3) { if (open.size) deleted.add(c); continue; }
      if (c.nodeType !== 1) continue;
      const ln = c.localName;
      if (ln === 'change-start' || ln === 'change-end') {
        const id = odtAttr(c, ODT_TEXT_NS, 'change-id');
        if (delIds.has(id)) { if (ln === 'change-start') open.add(id); else open.delete(id); }
        continue;
      }
      if (open.size && (ln === 'note' || ln === 'frame' || ln === 'tab' || ln === 's' || ln === 'line-break')) deleted.add(c);
      walk(c);
    }
  };
  walk(body);
  return deleted;
}

// A45/D2: a <draw:frame> (anchored inline in a <text:p>, real corpus files never anchor one
// at body level) wrapping a <draw:image> — its own <svg:title>/<svg:desc> are ODT's alt
// text/description (same idea as DOCX's docPr descr, D2's DOCX half, above), and
// draw:name is the shape's own name, used as a fallback when there's no real alt text at
// all (never left with nothing — see docxParagraphImages' identical reasoning). A frame
// with no <draw:image> inside (a text box, a custom shape) is not a picture and produces
// nothing here — table/shape decoration, not lost content.
// G4/D9: what a frame yields is now a list of BLOCKS in document order: {type:'graphic'} for
// pictures and ordinary para/heading/list blocks for the text of a <draw:text-box> (before,
// a text-only box was dropped). `seen` (set per parseOdt call) stops one text-box frame
// from being emitted twice (same node, or the same non-empty draw:name anchored again).
let odtSeenFrames = null;
// M1: a LibreOffice Math formula's own <draw:frame> element -> its MathML (a string, or
// absent when the frame's <draw:object> isn't a readable formula) — read up front by
// parseOdt (one unzipEntry per object part; the walk below has no `await` to do it inline)
// and consulted by odtFrameImages.own so a formula's own content fully replaces the
// <draw:image> ObjectReplacements bitmap it would otherwise show, the same "a readable
// equation replaces its placeholder/picture entirely" rule the DOCX/RTF legacy-equation
// paths use. Set/cleared by parseOdt around each call, exactly like odtSeenFrames above.
let odtObjectMath = null;
// A LibreOffice-written formula object's own zip part (Object N/content.xml) is a
// <math:math> document — real MathML already (ODF's own, unlike DOCX's OMML, which needs
// ommlElementToMathML to build MathML from scratch) — usually wrapped
// <semantics>PRESENTATION<annotation encoding="StarMath 5.0">…</annotation></semantics>.
// The annotation is LibreOffice's own StarMath source: never braille-relevant, and (per
// this task) not something to keep, so it — and any <annotation-xml> — is dropped, and a
// <semantics> left holding just the survivor is unwrapped so the segment's shape matches
// the OMML path's (no semantics wrapper). Namespaces are otherwise left exactly as ODF
// wrote them; MathCAT already accepts a namespaced <math> (parseHtml's own real <math>
// islands, read via mathOuterXml, keep theirs too).
function odtMathObjectToMathml(xmlStr) {
  let mathDoc;
  try { mathDoc = parseXml(xmlStr); } catch { return null; }
  const root = mathDoc && mathDoc.documentElement;
  if (!root || root.localName !== 'math') return null;
  const drop = [];
  (function collect(el) {
    for (const c of el.childNodes || []) {
      if (c.nodeType !== 1) continue;
      if (c.localName === 'annotation' || c.localName === 'annotation-xml') drop.push(c);
      else collect(c);
    }
  })(root);
  for (const el of drop) { if (el.parentNode) el.parentNode.removeChild(el); }
  for (const child of [...root.childNodes]) {
    if (child.nodeType === 1 && child.localName === 'semantics') {
      const kids = [...child.childNodes].filter((k) => k.nodeType === 1);
      if (kids.length === 1) root.replaceChild(kids[0], child);
    }
  }
  return mathOuterXml(root) || null;
}
// K36d (BANA §7 box/sidebar detection): a <draw:frame draw:style-name="…"> holding a
// <draw:text-box>, whose own graphic style (buildOdtStyleMap's stroke/fill/fillColor, above)
// carries an explicit, positive border and/or background — parity with parse.mjs's
// docxTxbxBoxInfo (the DOCX floating text-box half of the same K7 detection): a text box used
// only for page placement (no draw:style-name, or one with no stroke/fill at all — the common
// case, e.g. a running head positioned by an invisible frame) is left exactly as before, flat
// paragraphs in reading order — never boxed. Returns null (no box) or { boxColor }.
function odtFrameBoxInfo(frameEl, styleMap) {
  const styleName = (frameEl.getAttributeNS(ODT_DRAW_NS, 'style-name') || '').trim();
  const s = styleName && styleMap ? styleMap.get(styleName) : null;
  if (!s) return null;
  const bordered = !!s.stroke && s.stroke !== 'none';
  const filled = !!s.fill && s.fill !== 'none';
  if (!bordered && !filled) return null;
  const boxColor = filled && s.fillColor ? hexToColorName(s.fillColor) : null;
  return { boxColor };
}
function odtFrameImages(frameEl, depth = 0, styleMap = null) {
  const imgEls = [...frameEl.childNodes].filter((c) => c.nodeType === 1 && c.localName === 'image');
  const own = imgEls.length ? odtFrameImages.own(frameEl, imgEls) : [];
  if (depth >= 8) return own;
  const boxes = [...frameEl.childNodes].filter((c) => c.nodeType === 1 && c.localName === 'text-box');
  if (!boxes.length) return own;
  if (odtSeenFrames) {
    const nm = (frameEl.getAttributeNS(ODT_DRAW_NS, 'name') || '').trim();
    const key = nm ? 'n:' + nm : null;
    if (odtSeenFrames.has(frameEl) || (key && odtSeenFrames.has(key))) return own;
    odtSeenFrames.add(frameEl);
    if (key) odtSeenFrames.add(key);
  }
  const sm = styleMap || new Map();
  const paraFrames = (el, acc) => {
    for (const c of el.childNodes || []) {
      if (c.nodeType !== 1) continue;
      if (c.localName === 'frame') acc.push(c); else paraFrames(c, acc);
    }
    return acc;
  };
  const boxBlocks = (el, out) => {
    for (const c of el.childNodes || []) {
      if (c.nodeType !== 1) continue;
      const ln = c.localName;
      if (ln === 'p' || ln === 'h') {
        const sub = [];
        for (const f of paraFrames(c, [])) sub.push(...odtFrameImages(f, depth + 1, sm));
        const text = getOdtText(c).replace(/\s+/g, ' ').trim();
        const pics = sub.filter((b) => b.type === 'graphic');
        if (pics.length) {
          // captioned figure: the paragraph's text is the last picture's caption
          if (text && !pics[pics.length - 1].caption) pics[pics.length - 1].caption = text;
          out.push(...sub);
          continue;
        }
        const notes = [];
        // M1: a formula frame with no graphic sibling (pics.length === 0 above) already
        // went into odtFrameImages' own `sub` as a `{type:'math'}` block — when there's
        // paragraph text too, odtInlineSegments (below) puts that SAME frame's math inline
        // in `segs` instead (the right place for "Label: <formula>" prose), so `sub`'s own
        // copy is dropped here to avoid pushing it twice.
        let dropMathFromSub = false;
        if (text) {
          const segs = odtInlineSegments(c, sm, notes);
          const hasFmt = segs.some((x) => x.tf || x.href || x.type === 'noteref' || x.type === 'math' || x.transcriberTypeform || x.lang);
          if (ln === 'h') {
            const lvl = Number(c.getAttributeNS(ODT_TEXT_NS, 'outline-level') || 1);
            const h = { type: 'heading', level: Math.min(6, lvl || 1), text };
            if (hasFmt) h.segments = segs;
            out.push(h);
          } else {
            const pb = { type: 'para', text };
            if (hasFmt) pb.segments = segs;
            out.push(pb);
          }
          out.push(...notes);
          dropMathFromSub = true;
        }
        out.push(...(dropMathFromSub ? sub.filter((b) => b.type !== 'math') : sub));
      } else if (ln === 'frame') {
        out.push(...odtFrameImages(c, depth + 1, sm));
      } else if (ln === 'list') {
        const items = [];
        const rd = (listEl, lvl) => {
          for (const li of listEl.childNodes || []) {
            if (li.nodeType !== 1 || li.localName !== 'list-item') continue;
            const txt = [];
            const nested = [];
            for (const k of li.childNodes || []) {
              if (k.nodeType !== 1) continue;
              if (k.localName === 'list') nested.push(k);
              else { const t = getOdtText(k).replace(/\s+/g, ' ').trim(); if (t) txt.push(t); }
            }
            if (txt.length) { const it = { text: txt.join(' ') }; if (lvl > 0) it.level = lvl; items.push(it); }
            for (const nl of nested) rd(nl, lvl + 1);
          }
        };
        rd(c, 0);
        if (items.length) out.push({ type: 'list', items });
      } else if (ln === 'table') {
        // a table inside a text box: a table block here, in document order (plain-text cells; the frame's
        // odtSeenFrames guard above already stops the box being read twice)
        const cellText = (tc) => getOdtText(tc).replace(/\s+/g, ' ').trim();
        const rowCells = (tr) => [...(tr.childNodes || [])].filter((x) => x.nodeType === 1 && /^(table-cell|covered-table-cell)$/.test(x.localName)).map((x) => x.localName === 'covered-table-cell' ? '' : cellText(x));
        const headers = [], rows = [];
        for (const r of c.childNodes || []) {
          if (r.nodeType !== 1) continue;
          if (r.localName === 'table-header-rows') { for (const tr of r.childNodes || []) if (tr.nodeType === 1 && tr.localName === 'table-row') headers.push(...rowCells(tr)); }
          else if (r.localName === 'table-row') { const cells = rowCells(r); if (cells.length) rows.push(cells); }
        }
        if (headers.length || rows.length) out.push({ type: 'table', headers, rows });
      } else if (ln !== 'note' && ln !== 'annotation') {
        boxBlocks(c, out);           // text:section and other wrappers
      }
    }
    return out;
  };
  const nested = [];
  for (const box of boxes) boxBlocks(box, nested);
  // K36d: this frame's own graphic style says the text box is a real bordered/filled box, not
  // page-placement scaffolding — wrap everything it produced (paragraphs, headings, lists,
  // tables, pictures — all read exactly as above) into one { type: 'box' } block, the same
  // extractBoxTitle heuristic every other box source (DOCX pBdr run/one-cell table/text box,
  // HTML box) already uses to pull a leading heading or short bold paragraph out as its title.
  const boxInfo = nested.length ? odtFrameBoxInfo(frameEl, sm) : null;
  if (boxInfo) {
    const boxTitle = extractBoxTitle(nested);
    const box = { type: 'box' };
    if (boxTitle) box.title = boxTitle;
    if (boxInfo.boxColor) box.boxColor = boxInfo.boxColor;
    box.blocks = nested;
    return [...own, box];
  }
  return [...own, ...nested];
}
// A picture stored inline (.fodt): its base64 bytes become a package-style path plus a resource, like a zipped ODT's picture.
let odtInlineImages = null;              // Map path -> { bytes, mime }, set by parseOdt around the walk
function odtInlineImage(imgEl) {
  const bin = [...imgEl.childNodes].find((c) => c.nodeType === 1 && c.localName === 'binary-data');
  const b64 = bin ? (bin.textContent || '').replace(/\s+/g, '') : '';
  if (!b64 || !odtInlineImages) return '';
  let bytes;
  try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return ''; }
  const sniff = (b) => (b[0] === 0x89 && b[1] === 0x50 ? ['png', 'image/png'] : b[0] === 0xFF && b[1] === 0xD8 ? ['jpg', 'image/jpeg']
    : b[0] === 0x47 && b[1] === 0x49 ? ['gif', 'image/gif'] : b[0] === 0x42 && b[1] === 0x4D ? ['bmp', 'image/bmp']
    : b[0] === 0x3C ? ['svg', 'image/svg+xml'] : ['bin', 'application/octet-stream']);
  const [ext, mime] = sniff(bytes);
  const path = `Pictures/inline-${odtInlineImages.size + 1}.${ext}`;
  odtInlineImages.set(path, { bytes, mime });
  return path;
}
odtFrameImages.own = function (frameEl, imgEls) {
  // M1: a formula frame — the pre-read MathML (odtObjectMath, above) fully replaces the
  // <draw:image> ObjectReplacements bitmap `imgEls` would otherwise turn into here; a
  // frame whose object isn't a readable formula (odtObjectMath has no entry) falls through
  // to the ordinary picture reading below, unchanged.
  if (odtObjectMath && odtObjectMath.has(frameEl)) return [{ type: 'math', mathml: odtObjectMath.get(frameEl) }];
  const out = [];
  const name = (frameEl.getAttributeNS(ODT_DRAW_NS, 'name') || '').trim();
  const titleEl = [...frameEl.childNodes].find((c) => c.nodeType === 1 && c.localName === 'title');
  const descEl = [...frameEl.childNodes].find((c) => c.nodeType === 1 && c.localName === 'desc');
  const title = titleEl ? (titleEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const desc = descEl ? (descEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
  for (const imgEl of imgEls) {
    // A flat XML ODT (.fodt) holds the picture itself, base64, in office:binary-data; a zipped one points at a package part.
    const href = imgEl.getAttributeNS(ODT_XLINK_NS, 'href') || odtInlineImage(imgEl);
    // Import fix list #35 (audit #21): the frame's own name ("Image2", "graphics1") is the shape's label, not a description —
    // a picture with no svg:title / svg:desc has no alt text (Word: its auto-generated "Picture 3" name is never the alt text).
    const g = { type: 'graphic', src: href, alt: title };
    if (desc) g.description = desc;
    out.push(g);
  }
  return out;
}

// A45/D3: <text:note-citation> is the visible mark ("1"), <text:note-body> the note's own
// content — one or more <text:p>. Produces the same {type:'noteref', text, idref} segment
// and {type:'footnote', text|blocks, id, kind} block shapes parseDtbook's own walkInline/
// pushNote build for a DTBook <noteref>/<note> (F-113's multi-paragraph note.blocks
// included), keyed by the note's own text:id so a noteref and its note always match.
// Import fix list #1c (ODT): the paragraphs of a note body in reading order, including those inside a list, a table or a
// section (a note cannot hold a table or a list: a table's cells come through as paragraphs, row by row; a list's items keep
// their text but not their numbers — as the Word reader does). Headings count as paragraphs.
function odtNoteParas(container) {
  const out = [];
  const walk = (el) => {
    for (const c of el.childNodes || []) {
      if (c.nodeType !== 1) continue;
      const ln = c.localName;
      if (ln === 'p' || ln === 'h') out.push(c);
      else if (ln === 'note' || ln === 'frame' || ln === 'annotation') continue;
      else walk(c);
    }
  };
  walk(container);
  return out;
}
// ---- Import fix list #1d: ODT table structure — row groups and repeated columns/rows ---------------------------------------
const ODT_TABLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const ODT_REPEAT_EMPTY_CAP = 64;       // the most a repeat of EMPTY cells or rows is expanded to in the middle of a table
const ODT_REPEAT_CAP = 1000;           // the most a repeat of cells or rows with content is expanded to
// <text:s text:c="n"/> is n spaces; n comes from the file (2,000,000,000 made a string too long to build), so it is at most 1,000 - far wider than any page.
const odtSpaceCount = (v) => Math.min(1000, Math.max(1, parseInt(v || '1', 10) || 1));
const odtRepeat = (el, attr) => Math.max(1, parseInt(el.getAttributeNS(ODT_TABLE_NS, attr) || '1', 10) || 1);
// The columns the table declares (table:table-column, also inside table:table-columns / header-columns / column groups).
function odtDeclaredColumns(tableEl) {
  let n = 0;
  const walk = (el) => {
    for (const c of el.childNodes || []) {
      if (c.nodeType !== 1) continue;
      if (c.localName === 'table-column') n += odtRepeat(c, 'number-columns-repeated');
      else if (/^table-(columns|header-columns|column-group)$/.test(c.localName)) walk(c);
    }
  };
  walk(tableEl);
  return n;
}
function odtCellIsEmpty(tc) {
  if (tc.localName === 'covered-table-cell') return true;
  if (getOdtText(tc).trim()) return false;
  return !(tc.getElementsByTagNameNS(ODT_DRAW_NS, 'frame').length || tc.getElementsByTagNameNS(ODT_TEXT_NS, 'note').length || tc.getElementsByTagNameNS(ODT_TABLE_NS, 'table').length);
}
// The cells of a row, each repeated table:number-columns-repeated times. A repeat of empty cells is capped: at the end of a row
// it stops at the table's declared width (a spreadsheet-like "1024 empty columns" adds nothing), elsewhere at ODT_REPEAT_EMPTY_CAP.
function odtExpandCells(tr, declaredCols = 0) {
  const entries = [];
  for (const c of tr.childNodes || []) {
    if (c.nodeType !== 1 || (c.localName !== 'table-cell' && c.localName !== 'covered-table-cell')) continue;
    entries.push({ c, n: odtRepeat(c, 'number-columns-repeated'), empty: odtCellIsEmpty(c) });
  }
  let lastFull = -1;
  entries.forEach((e, i) => { if (!e.empty) lastFull = i; });
  const out = [];
  entries.forEach((e, i) => {
    let n = e.n;
    if (n > 1) {
      if (!e.empty) n = Math.min(n, ODT_REPEAT_CAP);
      else if (i > lastFull) n = Math.max(1, Math.min(n, declaredCols - out.length, ODT_REPEAT_EMPTY_CAP));
      else n = Math.min(n, ODT_REPEAT_EMPTY_CAP);
    }
    for (let k = 0; k < n; k++) out.push(e.c);
  });
  return out;
}
// The rows of a table in document order as { tr, header }, row groups, table:table-rows and header rows unwrapped and
// table:number-rows-repeated expanded. Empty rows repeated at the end of the table are dropped, in the middle capped.
function odtTableRows(tableEl, declaredCols = 0) {
  const entries = [];
  const walk = (el, header) => {
    for (const c of el.childNodes || []) {
      if (c.nodeType !== 1) continue;
      const ln = c.localName;
      if (ln === 'table-row') entries.push({ tr: c, header, n: odtRepeat(c, 'number-rows-repeated') });
      else if (ln === 'table-header-rows') walk(c, true);
      else if (ln === 'table-rows' || ln === 'table-row-group') walk(c, header);
    }
  };
  walk(tableEl, false);
  for (const e of entries) e.empty = e.n > 1 && odtExpandCells(e.tr, declaredCols).every(odtCellIsEmpty);
  let lastFull = -1;
  entries.forEach((e, i) => { if (!e.empty) lastFull = i; });
  const out = [];
  entries.forEach((e, i) => {
    let n = e.n;
    if (e.empty) n = i > lastFull ? 0 : Math.min(n, ODT_REPEAT_EMPTY_CAP);
    else n = Math.min(n, ODT_REPEAT_CAP);
    for (let k = 0; k < n; k++) out.push({ tr: e.tr, header: e.header });
  });
  return out;
}
function odtNoteBlock(noteEl, styleMap) {
  const citation = [...noteEl.childNodes].find((c) => c.nodeType === 1 && c.localName === 'note-citation');
  const bodyEl = [...noteEl.childNodes].find((c) => c.nodeType === 1 && c.localName === 'note-body');
  const mark = citation ? (citation.textContent || '').replace(/\s+/g, ' ').trim() : '';
  const noteClass = (noteEl.getAttributeNS(ODT_TEXT_NS, 'note-class') || '').toLowerCase();
  const kind = noteClass === 'endnote' ? 'endnote' : null;
  const idAttr = noteEl.getAttributeNS(ODT_TEXT_NS, 'id') || '';
  const idref = idAttr ? 'odt-note-' + idAttr : null;
  let block = null;
  if (bodyEl) {
    const paras = odtNoteParas(bodyEl);
    const paraBlock = (p) => {
      const t = getOdtText(p).replace(/\s+/g, ' ').trim();
      if (!t) return null;
      const segs = odtInlineSegments(p, styleMap);
      const hasFmt = segs.some((s) => s.tf || s.href || s.type === 'math' || s.transcriberTypeform || s.lang);
      return hasFmt ? { type: 'para', text: t, segments: segs } : { type: 'para', text: t };
    };
    if (paras.length > 1) {
      const pblocks = paras.map(paraBlock).filter(Boolean);
      if (pblocks.length) block = { type: 'footnote', blocks: pblocks };
    } else if (paras.length === 1) {
      const pb = paraBlock(paras[0]);
      if (pb) block = pb.segments ? { type: 'footnote', text: pb.text, segments: pb.segments } : { type: 'footnote', text: pb.text };
    } else {
      const t = getOdtText(bodyEl).replace(/\s+/g, ' ').trim();
      if (t) block = { type: 'footnote', text: t };
    }
  }
  if (block) {
    if (idref) block.id = idref;
    if (kind) block.kind = kind;
  }
  return { mark: mark || '*', idref, block };
}

// A46/D7 (ODT half): a <style:style style:family="text"> element (an "automatic" style
// in content.xml's <office:automatic-styles>, or a named one in styles.xml's
// <office:styles>) carries bold/italic/underline as its own <style:text-properties>
// (fo:font-weight="bold", fo:font-style="italic"/"oblique",
// style:text-underline-style!="none") — a <text:span text:style-name="…"> only
// references the style by name, so resolving it is required, not optional (a cruder
// "any definition anywhere" pass over-counts, per the corpus survey). Indexes every
// <style:style> in both documents by name; family is not filtered on lookup since names
// are unique within a document.
function buildOdtStyleMap(contentDoc, stylesDoc) {
  const map = new Map();               // name -> { bold, italic, underline, strike, align, parent, script, caps, hidden, scriptFont, borders, bg, listStyle, displayName }
  // Declared fonts: style:font-name -> svg:font-family, so a script/handwriting face is recognised by its real family name.
  const fontFaces = new Map();
  for (const root of [contentDoc, stylesDoc]) {
    if (!root) continue;
    for (const ff of root.getElementsByTagNameNS(ODT_STYLE_NS, 'font-face')) {
      const fn = ff.getAttributeNS(ODT_STYLE_NS, 'name');
      if (fn) fontFaces.set(fn, (ff.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0', 'font-family') || '').replace(/['"]/g, ''));
    }
  }
  const collect = (root) => {
    if (!root) return;
    for (const styleEl of root.getElementsByTagNameNS(ODT_STYLE_NS, 'style')) {
      const name = styleEl.getAttributeNS(ODT_STYLE_NS, 'name');
      if (!name) continue;
      const parent = styleEl.getAttributeNS(ODT_STYLE_NS, 'parent-style-name') || null;
      let bold = false, italic = false, underline = false, underlineSet = false, strike = false, align = null, stroke = null, fill = null, fillColor = null;
      // Import fix list #16/#18/#19/#27: raised/lowered, capitals, hidden, script face, paragraph borders and fill, the list style a paragraph style names
      let script, caps, hidden, scriptFont, bg;
      const borders = {};
      const listStyle = styleEl.getAttributeNS(ODT_STYLE_NS, 'list-style-name') || undefined;
      const displayName = styleEl.getAttributeNS(ODT_STYLE_NS, 'display-name') || undefined;
      for (const child of styleEl.childNodes || []) {
        if (child.nodeType !== 1) continue;
        if (child.localName === 'paragraph-properties') {
          // A paragraph bordered on a side: fo:border (all four) and the per-side overrides; "none" / a zero width is no border.
          const bval = (v) => { const t = String(v).trim(); return !t || /^none\b/i.test(t) || !(parseFloat(t) > 0) ? null : t.toLowerCase(); };
          const all = child.getAttributeNS(ODT_FO_NS, 'border');
          if (all) for (const sd of ['top', 'bottom', 'left', 'right']) borders[sd] = bval(all);
          for (const sd of ['top', 'bottom', 'left', 'right']) { const v = child.getAttributeNS(ODT_FO_NS, 'border-' + sd); if (v) borders[sd] = bval(v); }
          const bgc = child.getAttributeNS(ODT_FO_NS, 'background-color');
          if (bgc) bg = /^transparent$/i.test(bgc) ? null : bgc;
          // K3 (BANA 11.6.1d/11.6.1c, transcriber KD): fo:text-align "end"/"right" is print's
          // own column alignment for a table cell's paragraph — ODF has no char/decimal-tab
          // alignment concept the way DOCX/DTBook/HTML do, so only a positive right/end signal
          // is recorded here (the task's own list: "ODT paragraph style fo:text-align end/right").
          const ta = (child.getAttributeNS(ODT_FO_NS, 'text-align') || '').toLowerCase();
          if (ta === 'end' || ta === 'right') align = 'right';
          continue;
        }
        // K36d: a <draw:frame draw:style-name="…">'s own <style:graphic-properties> — read
        // here (any style family is indexed, same as text-properties above; names are unique
        // per document) so odtFrameBoxInfo (below) can tell a bordered/filled text box from a
        // plain layout frame. draw:stroke/"none" (or absent) is no line; draw:fill/"none" (or
        // absent) is no background — the same "explicit, positive signal only" rule
        // docxTxbxBoxInfo already applies to a DOCX floating text box's own <a:ln>/<a:solidFill>.
        if (child.localName === 'graphic-properties') {
          const st = (child.getAttributeNS(ODT_DRAW_NS, 'stroke') || '').toLowerCase();
          const fl = (child.getAttributeNS(ODT_DRAW_NS, 'fill') || '').toLowerCase();
          if (st) stroke = st;
          if (fl) fill = fl;
          const fc = child.getAttributeNS(ODT_DRAW_NS, 'fill-color');
          if (fc) fillColor = fc;
          continue;
        }
        if (child.localName !== 'text-properties') continue;
        // #18: style:text-position "sub 58%" / "super 58%" / "33% 58%" / "-25% 58%" / "0% 100%": below the line is a subscript,
        // above it a superscript, 0 the baseline (an explicit baseline stops a parent style's raising).
        const tpos = (child.getAttributeNS(ODT_STYLE_NS, 'text-position') || '').trim().toLowerCase();
        if (tpos) {
          const first = tpos.split(/\s+/)[0];
          const pct = parseFloat(first);
          script = first === 'sub' ? 'sub' : first === 'super' ? 'sup' : Number.isFinite(pct) ? (pct > 0 ? 'sup' : pct < 0 ? 'sub' : 'base') : script;
        }
        // #19: text:display="none" hides the text (true / condition show it).
        const disp = (child.getAttributeNS(ODT_TEXT_NS, 'display') || '').toLowerCase();
        if (disp) hidden = disp === 'none';
        // Audit o01/lo-w02: small capitals and all capitals both print as capitals (RUEB 9.6.1, as Word's w:smallCaps / w:caps).
        const fvar = (child.getAttributeNS(ODT_FO_NS, 'font-variant') || '').toLowerCase();
        const ttr = (child.getAttributeNS(ODT_FO_NS, 'text-transform') || '').toLowerCase();
        if (fvar === 'small-caps' || ttr === 'uppercase') caps = true;
        else if (fvar === 'normal' || ttr === 'none' || ttr === 'lowercase' || ttr === 'capitalize') caps = false;
        // A script or handwriting face (Word's SCRIPT_FONT_RE) is the script typeform (UEB section 9).
        const fnm = child.getAttributeNS(ODT_STYLE_NS, 'font-name');
        const ffam = child.getAttributeNS(ODT_FO_NS, 'font-family');
        if (fnm || ffam) scriptFont = [fnm, fnm && fontFaces.get(fnm), (ffam || '').replace(/['"]/g, '')].some((f) => f && SCRIPT_FONT_RE.test(f));
        const fw = (child.getAttributeNS(ODT_FO_NS, 'font-weight') || '').toLowerCase();
        const fs = (child.getAttributeNS(ODT_FO_NS, 'font-style') || '').toLowerCase();
        const us = (child.getAttributeNS(ODT_STYLE_NS, 'text-underline-style') || '').toLowerCase();
        // UEB 9.5.1 "crossed-out type": ODT's own strikethrough (style:text-line-through-style,
        // any value other than "none" — "solid", "double", ... all print as crossed-out).
        const ls = (child.getAttributeNS(ODT_STYLE_NS, 'text-line-through-style') || '').toLowerCase();
        if (fw === 'bold') bold = true;
        if (fs === 'italic' || fs === 'oblique') italic = true;
        // A79/LINK-2: `underlineSet` records that THIS style level made an explicit choice
        // (either way) about underline, distinct from `underline` (the resulting boolean) —
        // resolveOdtStyleLinkUnderline (below) needs to know a nearer style explicitly said
        // "none" so it can stop there rather than falling through to a parent's "solid", the
        // same nearest-wins walk charStyleLinkUnderline already does for DOCX's w:u.
        if (us) { underlineSet = true; underline = us !== 'none'; }
        if (ls && ls !== 'none') strike = true;
      }
      map.set(name, { bold, italic, underline, underlineSet, strike, align, parent, stroke, fill, fillColor, script, caps, hidden, scriptFont, borders, bg, listStyle, displayName });
    }
  };
  collect(contentDoc);
  collect(stylesDoc);
  return map;
}
// Same chain-walk as resolveOdtStyleTf/resolveOdtStyleStrike (K3): a style with no
// fo:text-align of its own inherits its parent's.
function resolveOdtStyleAlign(map, name, seen) {
  if (!name || !map) return null;
  seen = seen || new Set();
  if (seen.has(name)) return null;
  seen.add(name);
  const s = map.get(name);
  if (!s) return null;
  if (s.align) return s.align;
  return s.parent ? resolveOdtStyleAlign(map, s.parent, seen) : null;
}

// A79 (LINK-2, decisions.md): a <text:a>'s OWN style (its `text:style-name`, e.g.
// LibreOffice's built-in "Internet_20_link", or a document author's own link character
// style), walked up its parent-style-name chain the same nearest-style-wins way
// charStyleLinkUnderline (above) walks a DOCX run's w:basedOn chain — the first style in the
// chain that explicitly sets style:text-underline-style (`underlineSet`, either "none" or a
// real value) decides; a style that says nothing about underline at all falls through to its
// parent. Returns null when no style in the chain ever said either way (LINK-1 default: keep
// the transcriber-defined typeform), never true/false by assumption from the style's family
// or name — an author who redefined "Internet_20_link" with no underline must get no
// underline, and one who removed it explicitly (`underlineSet` true, `underline` false) must
// stay plain even if a parent default style is itself underlined.
function resolveOdtStyleLinkUnderline(map, name) {
  if (!name || !map) return null;
  let cur = name;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const s = map.get(cur);
    if (!s) break;
    if (s.underlineSet) return !!s.underline;
    cur = s.parent || null;
  }
  return null;
}

function resolveOdtStyleTf(map, name, seen) {
  if (!name || !map) return 0;
  seen = seen || new Set();
  if (seen.has(name)) return 0;
  seen.add(name);
  const s = map.get(name);
  if (!s) return 0;
  let tf = 0;
  if (s.bold) tf |= TF_BOLD;
  if (s.italic) tf |= TF_ITALIC;
  if (s.underline) tf |= TF_UNDERLINE;
  if (s.scriptFont) tf |= TF_SCRIPT;
  if (s.parent) tf |= resolveOdtStyleTf(map, s.parent, seen);
  return tf;
}
// Same chain-walk as resolveOdtStyleTf, for the one flag that is not a `tf` bit
// (transcriberTypeform, not the italic/underline/bold bitmask — see format/document.mjs's
// segTf comment for why the two are kept separate).
function resolveOdtStyleStrike(map, name, seen) {
  if (!name || !map) return false;
  seen = seen || new Set();
  if (seen.has(name)) return false;
  seen.add(name);
  const s = map.get(name);
  if (!s) return false;
  return !!s.strike || (s.parent && resolveOdtStyleStrike(map, s.parent, seen));
}

// Walk a <text:h>/<text:p>'s children, building a segments array with the same
// {type:'text', tf, href} shape htmlParagraphSegments/walkInline produce: a <text:span
// text:style-name="…"> resolves via buildOdtStyleMap/resolveOdtStyleTf into tf bits
// (nested spans combine, matching TYPEFORM's bitmask), and a <text:a xlink:href="…">
// stamps `.href` onto the text segment(s) it produced (A46/D4 — link text already
// survived via getOdtText; only the destination was ever dropped).
// A45: `notesOut`/`imagesOut` (optional arrays) collect the {type:'footnote'} and
// {type:'graphic'} blocks a <text:note>/<draw:frame> hit anywhere in this element produces
// — parseOdt pushes them as their own blocks right after the paragraph/heading that
// contained them, the same "note/image sits where it's referenced" placement parseDocx
// uses (D2/D3). A caller with no need for them (odtNoteBlock building a note's own inner
// paragraphs) simply omits the arrays; a nested note/frame inside a note body is walked by
// getOdtText/its own odtInlineSegments call instead, never by this one.
function odtInlineSegments(el, styleMap, notesOut = null, imagesOut = null) {
  const segments = [];
  let text = '';
  let curTf = 0;
  let curTtf = null;
  let curLang = null;                                    // foreign language (fo:language …) of the accumulating run — recorded only (input/lang.mjs)
  if (odtHiddenEl(el)) return segments;                  // #19: a hidden paragraph/heading yields nothing
  const flush = () => {
    if (text) {
      text = odtMergeScripts(text);                      // #18: adjacent runs of one level share a marker pair
      const seg = { type: 'text', text };
      if (curTf) seg.tf = curTf;
      if (curTtf) seg.transcriberTypeform = curTtf;
      if (curLang) seg.lang = curLang;
      segments.push(seg);
    }
    text = '';
  };
  const setTf = (tf, ttf, lang = curLang) => { if (tf !== curTf || (ttf || null) !== curTtf || lang !== curLang) { flush(); curTf = tf; curTtf = ttf || null; curLang = lang; } };
  const walk = (node, tf, ttf) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3) {
        if (child.nodeValue && !odtDeleted(child)) { setTf(tf, ttf, odtTextLang(styleMap && styleMap.langCtx, child, el)); text += odtTextValue(child); }
      } else if (child.nodeType === 1) {
        const ln = child.localName;
        if (odtHiddenEl(child)) continue;                // #19: hidden spans, fields and tracked deletions
        if (ln === 's') {
          const c = odtSpaceCount(child.getAttributeNS(ODT_TEXT_NS, 'c'));
          setTf(tf, ttf);
          text += ' '.repeat(c);
        } else if (ln === 'tab' || ln === 'line-break') {
          setTf(tf, ttf);
          text += ' ';
        } else if (ln === 'annotation' || ln === 'annotation-end') {
          continue;                                        // IMP-W9: a comment is not transcribed (it used to be read into the paragraph, author and date with it)
        } else if (ln === 'ruby-text') {
          setTf(tf, ttf);                                  // IMP-W11: a ruby guide follows its base text in brackets
          text += ' (';
          walk(child, tf, ttf);
          text += ')';
        } else if (ln === 'span') {
          const styleName = child.getAttributeNS(ODT_TEXT_NS, 'style-name');
          const nextTtf = resolveOdtStyleStrike(styleMap, styleName) ? 'strike' : ttf;
          walk(child, tf | resolveOdtStyleTf(styleMap, styleName), nextTtf);
        } else if (ln === 'a') {
          const href = child.getAttributeNS(ODT_XLINK_NS, 'href') || null;
          if (href) {
            flush();
            const before = segments.length;
            // A79/LINK-2: the <text:a>'s OWN text:style-name (LibreOffice's styles.xml carries
            // its built-in "Internet_20_link" as underlined; buildOdtStyleMap/
            // resolveOdtStyleLinkUnderline, above, walk its parent-style-name chain the same
            // nearest-wins way the DOCX reader's charStyleLinkUnderline does) — a nested span
            // inside the link can still carry its own explicit underline via the ordinary
            // resolveOdtStyleTf walk in the `span` branch above, so this only adds the bit
            // when the LINK itself says so; it never removes one a nested span set.
            const linkStyleName = child.getAttributeNS(ODT_TEXT_NS, 'style-name');
            const linkUnderline = resolveOdtStyleLinkUnderline(styleMap, linkStyleName);
            walk(child, tf | (linkUnderline ? TF_UNDERLINE : 0), ttf);
            flush();
            for (let k = before; k < segments.length; k++) {
              if (segments[k] && segments[k].type === 'text') segments[k].href = href;
            }
          } else {
            walk(child, tf, ttf);
          }
        } else if (ln === 'note' && notesOut) {
          const { mark, idref, block } = odtNoteBlock(child, styleMap);
          flush();
          const seg = { type: 'noteref', text: mark };
          if (idref) seg.idref = idref;
          segments.push(seg);
          if (block) notesOut.push(block);
        } else if (ln === 'frame') {
          flush();                    // a frame's own text never joins the running text
          // M1: a formula frame is a `math` segment right here, inline in the running
          // text — the same segment shape/position a DOCX inline m:oMath gets
          // (paragraphSegments' own oMath branch) — never routed through `imagesOut` (which
          // parseOdt's own `p` handling turns into separate `graphic` blocks after the
          // paragraph, the right place for a real picture but not for a formula the reader
          // should see where it's actually referenced). A frame whose object isn't a
          // readable formula still becomes a picture via imagesOut, unchanged.
          const mathml = odtObjectMath && odtObjectMath.get(child);
          if (mathml) segments.push({ type: 'math', mathml });
          else if (imagesOut) imagesOut.push(...odtFrameImages(child, 0, styleMap));
        } else {
          walk(child, tf, ttf);
        }
      }
    }
  };
  walk(el, 0, null);
  flush();
  return segments;
}

// Import fix list #15e: parseOdt reads a zipped ODT (.odt, and a template .ott, which is the same package) and a flat XML ODT
// (.fodt: content, styles and meta in one XML file, given as text or as bytes that are not a zip).
// Only a real flat OpenDocument file (an <office:document> root) is read as .fodt. Anything else that is not a zip —
// a corrupt or mis-named .odt — is reported as unreadable, as before (30 Sep: a broken .odt was being read as text).
const FLAT_ODF_RE = /<office:document[\s>]/;
function odtFlatText(data) {
  if (typeof data === 'string') {
    if (!FLAT_ODF_RE.test(data)) throw new Error('not an OpenDocument file (neither a zip package nor flat OpenDocument XML)');
    return data;
  }
  const u8 = zipBytes(data);
  if (u8.length > 1 && u8[0] === 0x50 && u8[1] === 0x4B) return null;
  const text = new TextDecoder().decode(u8);
  if (!FLAT_ODF_RE.test(text.slice(0, 20000))) throw new Error('not an OpenDocument file (neither a zip package nor flat OpenDocument XML)');
  return text;
}
export async function parseOdt(arrayBuffer) {
  const flatText = odtFlatText(arrayBuffer);
  const flat = flatText !== null;
  const xml = flat ? flatText : new TextDecoder().decode(await unzipEntry(arrayBuffer, 'content.xml'));
  const doc = parseStructuredPart(xml, flat ? 'the OpenDocument XML' : 'content.xml', 'This OpenDocument file is damaged or incomplete and could not be read.', (d) => d.getElementsByTagNameNS('*', 'body')[0]);   // strict (audit batch S2b item 8)
  const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const TABLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
  const body = doc.getElementsByTagNameNS('*', 'text')[0] || doc.documentElement;
  const blocks = [];
  let title = null;
  // A46/D7: styles.xml's <office:styles>/<office:automatic-styles> holds named/parent
  // styles a content.xml automatic style can chain to via style:parent-style-name; the
  // part is optional (missing -> empty map, same graceful fallback as parseDocxRelationships).
  let stylesDoc = null;
  if (!flat) { try { stylesDoc = parseXml(new TextDecoder().decode(await unzipEntry(arrayBuffer, 'styles.xml'))); } catch { /* no styles.xml */ } }
  // The document's metadata (dc:title, the author): meta.xml, or office:meta in a flat file. Only a fallback, like Word's core.xml.
  let metaDoc = flat ? doc : null;
  if (!flat) { try { metaDoc = parseXml(new TextDecoder().decode(await unzipEntry(arrayBuffer, 'meta.xml'))); } catch { /* no meta.xml */ } }
  const styleMap = buildOdtStyleMap(doc, stylesDoc);
  styleMap.langCtx = odtLangContext(doc, stylesDoc);         // foreign-language runs (fo:language …, input/lang.mjs), read by odtInlineSegments

  // M1: every <draw:object> in the package is a formula candidate — read its own zip part
  // (Object N/content.xml) up front, one unzipEntry per object, since the synchronous walk
  // below (odtFrameImages/odtInlineSegments) has no `await` to do this inline. Keyed by the
  // enclosing <draw:frame> element (there is always exactly one object per frame, the same
  // frame odtFrameImages/odtInlineSegments see) so those functions can tell a readable
  // formula from anything else a <draw:object> might hold (a non-formula OLE object, or one
  // LibreOffice didn't write MathML for) — see odtObjectMath/odtMathObjectToMathml, above.
  const objectMath = new Map();
  for (const obj of doc.getElementsByTagNameNS(ODT_DRAW_NS, 'object')) {
    const frame = obj.parentNode;
    if (!frame || frame.localName !== 'frame') continue;
    const href = (obj.getAttributeNS(ODT_XLINK_NS, 'href') || '').replace(/^\.\//, '');
    if (!href && flat) {                                     // a flat XML ODT holds the formula's MathML right inside the object
      const mathEl = obj.getElementsByTagNameNS('*', 'math')[0];
      const mathml = mathEl ? odtMathObjectToMathml(mathOuterXml(mathEl)) : null;
      if (mathml) objectMath.set(frame, mathml);
      continue;
    }
    if (!href) continue;
    try {
      const objXml = new TextDecoder().decode(await unzipEntry(arrayBuffer, href + '/content.xml'));
      const mathml = odtMathObjectToMathml(objXml);
      if (mathml) objectMath.set(frame, mathml);
    } catch { /* not a math object (no content.xml part, or not <math:math>) — picture fallback */ }
  }

  // A52: parseOdtList used to read every list item through getOdtText alone — plain text
  // only, so bold/italic/underline and links (and any note/frame odtInlineSegments would
  // otherwise catch) were silently dropped (629 of 681 bold runs lost this way in the real
  // corpus's model-services-contract-core-terms.odt). Each text-bearing child (almost
  // always one <text:p>, occasionally a <text:h> — LibreOffice allows a heading directly
  // inside a list item) is now walked with odtInlineSegments, the same function
  // headings/paragraphs already use, so its formatting survives into `item.segments` —
  // same `{text, segments?}` item shape every other format's list-item parsing already
  // uses (see parseDocx/parseMarkdown/parseHtml's own `item.segments = …` sites).
  // Bullet vs numbered: the list's own text:style-name (or the outermost list's, which nested lists
  // inherit) names a <text:list-style> in content.xml/styles.xml whose level-N child is either
  // <text:list-level-style-bullet> (braille keeps the print bullet, BANA 8.6.2) or ...-number / -image.
  const odtListStyles = new Map();
  for (const d of [doc, stylesDoc]) {
    if (!d || !d.getElementsByTagNameNS) continue;
    for (const ls of d.getElementsByTagNameNS(TEXT, 'list-style')) {
      const nm = ls.getAttribute('style:name') || ls.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:style:1.0', 'name');
      if (nm && !odtListStyles.has(nm)) odtListStyles.set(nm, ls);
    }
  }
  function odtListIsBullet(listEl, lvl, inherited) {
    const nm = listEl.getAttribute('text:style-name') || listEl.getAttributeNS(TEXT, 'style-name') || inherited;
    const ls = nm ? odtListStyles.get(nm) : null;
    if (!ls) return { bullet: false, style: nm };
    for (const lv of ls.childNodes || []) {
      if (lv.nodeType !== 1) continue;
      const lvNo = lv.getAttribute('text:level') || lv.getAttributeNS(TEXT, 'level');
      if (Number(lvNo) === lvl + 1) return { bullet: lv.localName === 'list-level-style-bullet', style: nm };
    }
    return { bullet: false, style: nm };
  }
  // Import fix list #41: the bullet a level of the list style prints (text:bullet-char), through its font as Word's
  // (wordBulletGlyph: a Symbol-font dot is "•", Courier New "o" "○", Wingdings U+F0A7 "■"; a custom arrow, tick or dash
  // keeps its shape, IMP-W7). A level with no character is the ordinary bullet.
  function odtBulletMarker(styleName, lvl) {
    const ls = styleName ? odtListStyles.get(styleName) : null;
    if (!ls) return '•';
    for (const lv of ls.childNodes || []) {
      if (lv.nodeType !== 1 || lv.localName !== 'list-level-style-bullet' || Number(lv.getAttributeNS(TEXT, 'level')) !== lvl + 1) continue;
      const ch = lv.getAttributeNS(TEXT, 'bullet-char') || '';
      if (!ch.trim()) return '•';
      const tp = [...(lv.childNodes || [])].find((c) => c.nodeType === 1 && c.localName === 'text-properties');
      const font = tp ? (tp.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0', 'font-family') || tp.getAttributeNS(ODT_STYLE_NS, 'font-name') || '') : '';
      return wordBulletGlyph(ch, font.replace(/^['"]|['"]$/g, ''), lvl) || '•';
    }
    return '•';
  }
  // Import fix list #16 (audit #1): numbered lists. A level of the list style is <text:list-level-style-number>: its number
  // format (style:num-format 1 / a / A / i / I), prefix and suffix, the start value (text:start-value) and how many levels'
  // numbers it shows (text:display-levels: 2 gives "1.1."). Counting follows ODF: an item takes the next number of its level;
  // text:list-item/@text:start-value sets it; a deeper level starts again; text:continue-numbering / text:continue-list carry
  // the count of an earlier list on. The marker is the same kind of string Word's lists give ("1.", "a.", "(i)", "2.1.").
  const ODT_NUM_FORMATS = { 1: 'decimal', a: 'lowerletter', A: 'upperletter', i: 'lowerroman', I: 'upperroman' };
  function odtNumLevel(styleName, lvl) {
    const ls = styleName ? odtListStyles.get(styleName) : null;
    if (!ls) return null;
    for (const lv of ls.childNodes || []) {
      if (lv.nodeType !== 1 || Number(lv.getAttributeNS(TEXT, 'level')) !== lvl + 1) continue;
      if (lv.localName !== 'list-level-style-number') return null;          // bullet / picture: not numbered
      const f = lv.getAttributeNS(ODT_STYLE_NS, 'num-format');
      if (!f) return null;                                                   // an empty format shows no number
      return {
        fmt: ODT_NUM_FORMATS[f] || 'decimal',                               // a script with no table here (Greek, CJK …) keeps plain digits
        prefix: lv.getAttributeNS(ODT_STYLE_NS, 'num-prefix') || '',
        suffix: lv.getAttributeNS(ODT_STYLE_NS, 'num-suffix') || '',
        display: Math.max(1, parseInt(lv.getAttributeNS(TEXT, 'display-levels') || '1', 10) || 1),
        start: parseInt(lv.getAttributeNS(TEXT, 'start-value') || '1', 10) || 1,
      };
    }
    return null;
  }
  function odtNextMarker(state, styleName, lvl, startAttr) {
    const lv = odtNumLevel(styleName, lvl);
    if (!lv) return null;
    const c = state.counts;
    c[lvl] = startAttr != null ? startAttr : (c[lvl] === undefined ? lv.start : c[lvl] + 1);
    c.length = lvl + 1;                                                      // a deeper level starts again
    const parts = [];
    for (let k = Math.max(0, lvl - lv.display + 1); k <= lvl; k++) {
      const lk = odtNumLevel(styleName, k) || lv;
      parts.push(formatCounter(c[k] ?? lk.start, lk.fmt));
    }
    return lv.prefix + parts.join('.') + lv.suffix;
  }
  const odtListStates = new Map();          // xml:id of a list -> its numbering state (text:continue-list)
  const odtLastListState = new Map();       // list style name -> the state of the last list that used it (text:continue-numbering)
  // The list style a list takes from its first paragraph's paragraph style (style:list-style-name), when the list names none.
  function odtParaListStyle(listEl) {
    const p = listEl.getElementsByTagNameNS(TEXT, 'p')[0] || listEl.getElementsByTagNameNS(TEXT, 'h')[0];
    return p ? odtStyleProp(styleMap, p.getAttributeNS(TEXT, 'style-name'), 'listStyle') || null : null;
  }
  function parseOdtList(listEl, lvl = 0, imgOut = null, inheritedStyle = null, numState = null) {
    const items = [];
    if (!listEl.getAttributeNS(TEXT, 'style-name') && !inheritedStyle) inheritedStyle = odtParaListStyle(listEl);
    const { bullet: isBulletList, style: listStyleName } = odtListIsBullet(listEl, lvl, inheritedStyle);
    if (!numState) {
      const xmlId = listEl.getAttribute('xml:id') || '';
      const contId = listEl.getAttributeNS(TEXT, 'continue-list') || '';
      if (contId && odtListStates.has(contId)) numState = odtListStates.get(contId);
      else if (listEl.getAttributeNS(TEXT, 'continue-numbering') === 'true' && odtLastListState.has(listStyleName || '')) numState = odtLastListState.get(listStyleName || '');
      else numState = { counts: [] };
      if (xmlId) odtListStates.set(xmlId, numState);
      odtLastListState.set(listStyleName || '', numState);
    }
    for (const child of listEl.childNodes || []) {
      if (child.nodeType !== 1 || (child.localName !== 'list-item' && child.localName !== 'list-header' && child.tagName !== 'text:list-item')) continue;
      // Import fix list #7: a list header is an item with no number of its own (and not counted) — its text is kept.
      const isHeader = child.localName === 'list-header';
      let numMarker = null;
      if (!isBulletList && !isHeader && [...child.childNodes].some((c) => c.nodeType === 1 && (c.localName === 'p' || c.localName === 'h') && !odtHiddenEl(c))) {
        const sv = child.getAttributeNS(TEXT, 'start-value');
        numMarker = odtNextMarker(numState, listStyleName, lvl, sv ? parseInt(sv, 10) : null);
      }
      let directText = '';
      let segs = [];
      const nestedLists = [];
      // A <text:list-item> with several <text:p>/<text:h>: the first is the item, each later one a further paragraph
      // of the same item (item.blocks; document.mjs formatItemBlocks), not text run on into the first.
      const extraParas = [];
      let paraSeen = false;
      for (const c of child.childNodes || []) {
        if (c.nodeType === 3) {
          directText += c.nodeValue;
          if (c.nodeValue && c.nodeValue.trim()) segs.push({ type: 'text', text: c.nodeValue });
        } else if (c.nodeType === 1) {
          const cLn = c.localName;
          if (cLn === 'list') {
            nestedLists.push(c);
          } else if ((cLn === 'p' || cLn === 'h') && paraSeen && getOdtText(c).trim()) {
            extraParas.push(c);
          } else {
            if (cLn === 'p' || cLn === 'h') paraSeen = !!getOdtText(c).trim() || paraSeen;
            if (segs.length) segs.push({ type: 'text', text: ' ' });
            segs.push(...odtInlineSegments(c, styleMap, null, imgOut));
            directText += getOdtText(c) + ' ';
          }
        }
      }
      directText = directText.replace(/\s+/g, ' ').trim();
      // K36c/M1: a list item whose only content is a formula (a <draw:frame> read as math by
      // odtInlineSegments, above — getOdtText skips frames the same way it skips notes, so
      // directText stays '') used to be dropped here outright: the `if (directText)` guard
      // below never ran, so the whole item — and its equation — vanished. Kept the same
      // "alone in its own block" way a paragraph/heading with only a formula already is
      // (parseOdt's own M1 handling, below, for `ln === 'p'`/`ln === 'h'`): `hasMathOnly`
      // spots it (every non-blank seg is a math segment) so the item is still pushed, with an
      // empty `text` and the formula as `item.segments` — document.mjs's list renderer
      // already treats `item.segments` alone as enough to lay an item out (K16 "list item
      // with inline maths"), so no text is needed for it to braille.
      const nonBlankSegs = segs.filter((s) => !(s.type === 'text' && !String(s.text || '').trim()));
      const hasMathOnly = !directText && nonBlankSegs.length > 0 && nonBlankSegs.every((s) => s.type === 'math');
      if (directText || hasMathOnly) {
        const it = { text: directText };
        if (segs.some((s) => s.tf || s.href || s.type === 'noteref' || s.type === 'math' || s.transcriberTypeform || s.lang)) it.segments = segs;
        if (isBulletList) it.marker = odtBulletMarker(listStyleName, lvl);   // #41: the list style's own bullet
        if (numMarker) {
          // A marker the save (NIMAS XML) and re-open can carry — a number, a single letter or a roman numeral with "." or ")" or
          // in brackets — is the item's marker, as Word's. Any other print label ("Section A:", "1.1.", "Article 3") is written
          // into the item's text instead (as a numbered Word heading's number is), so it is saved and brailled as printed.
          if (/^\(?(\d+|[a-zA-Z]|[ivxlcdmIVXLCDM]+)[.)]$/.test(numMarker)) it.marker = numMarker;
          else {
            it.text = numMarker + ' ' + it.text;
            if (it.segments) it.segments = [{ type: 'text', text: numMarker + ' ' }, ...it.segments];
          }
        }
        if (isBulletList) stripDuplicateBullet(it);
        if (lvl > 0) it.level = lvl;
        const ib = [];
        for (const pe of extraParas) {
          const t = getOdtText(pe).replace(/\s+/g, ' ').trim();
          const ps = odtInlineSegments(pe, styleMap, null, imgOut);
          ib.push(ps.some((s) => s.tf || s.href || s.type === 'noteref' || s.type === 'math' || s.transcriberTypeform || s.lang) ? { type: 'para', text: t, segments: ps } : { type: 'para', text: t });
        }
        if (ib.length) it.blocks = ib;
        items.push(it);
      }
      for (const nl of nestedLists) {
        if (lvl + 1 >= ODT_MAX_LIST_DEPTH) {
          // Lists nested deeper than ODT_MAX_LIST_DEPTH (3,000 deep overflowed the stack, and each level searched everything below it) are
          // not read level by level: their paragraphs, in order, become plain items at the limit level, with no marker.
          odtDeepListSeen = true;
          const todo = [nl];                                  // (a walk with a stack of its own: the paragraphs in document order)
          while (todo.length) {
            const nd = todo.pop();
            if (nd.nodeType === 1 && nd.namespaceURI === TEXT && (nd.localName === 'p' || nd.localName === 'h')) {
              const t = getOdtText(nd).replace(/\s+/g, ' ').trim();
              if (t) items.push({ text: t, level: ODT_MAX_LIST_DEPTH });
              continue;
            }
            const kids = nd.childNodes || [];
            for (let k = kids.length - 1; k >= 0; k--) if (kids[k].nodeType === 1) todo.push(kids[k]);
          }
          continue;
        }
        for (const x of parseOdtList(nl, lvl + 1, imgOut, listStyleName, numState)) items.push(x);
      }
    }
    return items;
  }
  let odtDeepListSeen = false;

  // A45/D1 caption convention (ODT half): a <text:p> styled "Caption" (or a style whose own
  // parent-style chain leads to "Caption" — LibreOffice's own built-in figure/illustration/
  // table caption styles, e.g. the real corpus's "Figure" → parent "Caption") immediately
  // following an image-only paragraph becomes that image's caption instead of an orphaned
  // paragraph of its own.
  const isCaptionStyle = (node) => {
    const style = node.getAttributeNS(TEXT, 'style-name') || '';
    // buildOdtStyleMap indexes every <style:style> regardless of family (names are unique
    // per document), so a paragraph style's own parent-style chain is already in styleMap.
    let seen = new Set(), name = style;
    while (name && !seen.has(name)) {
      if (/^caption$/i.test(name)) return true;
      seen.add(name);
      name = styleMap.get(name)?.parent || null;
    }
    return false;
  };
  let skipNextCaption = null;

  // Import fix list #27 (ODT part). Paragraph styles by family name, names decoded ("Preformatted_20_Text" -> "preformattedtext"):
  // "Quotations" (and styles based on it) is a block quotation like Word's Quote; "Preformatted Text" (Source Text, …) a code
  // block like Word's Source Code. A paragraph bordered on all four sides is a box like Word's w:pBdr; consecutive paragraphs
  // with the same border are one box. Alignment stays ignored (Paul's IMP-W8).
  const odtStyleFamilies = (node) => {
    const out = [];
    const seen = new Set();
    let name = node.getAttributeNS(TEXT, 'style-name') || '';
    while (name && !seen.has(name)) {
      seen.add(name);
      const norm = (x) => String(x).replace(/_20_/g, ' ').replace(/\s+/g, '').toLowerCase();
      out.push(norm(name));
      const st = styleMap.get(name);
      if (!st) break;
      if (st.displayName) out.push(norm(st.displayName));
      name = st.parent || null;
    }
    return out;
  };
  const odtIsQuoteStyle = (node) => odtStyleFamilies(node).some((f) => /^(quotations?|blockquotation|blockquote|blocktext|quote|intensequote)$/.test(f));
  const odtIsCodeStyle = (node) => odtStyleFamilies(node).some((f) => /^(preformattedtext|sourcecode|sourcetext|htmlpreformatted|plaintext|macrotext)$/.test(f));
  // The border of a paragraph as a key when all four sides have one, else null; and its fill colour.
  const odtParaBorder = (node) => {
    const name = node.getAttributeNS(TEXT, 'style-name') || '';
    if (!name) return null;
    const sides = ['top', 'bottom', 'left', 'right'].map((sd) => {
      let cur = name; const seen = new Set();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const st = styleMap.get(cur);
        if (!st) return null;
        if (Object.prototype.hasOwnProperty.call(st.borders || {}, sd)) return st.borders[sd];
        cur = st.parent || null;
      }
      return null;
    });
    if (sides.some((x) => !x)) return null;
    return { key: sides.join(';'), fill: odtStyleProp(styleMap, name, 'bg') || null };
  };
  // The text of a code paragraph with its layout kept (as paragraphCodeText for Word): repeated spaces, a tab as four spaces,
  // a line break as a new line.
  const odtCodeText = (p) => {
    let t = '';
    const rd = (n) => {
      for (const c of n.childNodes || []) {
        if (c.nodeType === 3) { if (!odtDeleted(c)) t += c.nodeValue; continue; }
        if (c.nodeType !== 1 || odtHiddenEl(c)) continue;
        const l = c.localName;
        if (l === 's') t += ' '.repeat(odtSpaceCount(c.getAttributeNS(TEXT, 'c')));
        else if (l === 'tab') t += '    ';
        else if (l === 'line-break') t += '\n';
        else if (l === 'note' || l === 'frame' || l === 'annotation') continue;
        else rd(c);
      }
    };
    rd(p);
    return t.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');
  };
  let lastCodeBlock = null, codeBlankPending = 0;
  // A contents list (text:table-of-content): Word's TOC1-9 paragraphs become { type:'list', kind:'toc' } with item.page; the
  // index title ("Contents") is not an entry — it stays as an ordinary paragraph before the list.
  const odtPushToc = (tocEl) => {
    const bodyEl = [...tocEl.childNodes].find((c) => c.nodeType === 1 && c.localName === 'index-body');
    if (!bodyEl) return;
    const items = [];
    for (const c of bodyEl.childNodes) {
      if (c.nodeType !== 1 || odtHiddenEl(c)) continue;
      if (c.localName === 'index-title') {
        const t = getOdtText(c).replace(/\s+/g, ' ').trim();
        if (t) blocks.push({ type: 'para', text: t });
      } else if (c.localName === 'p' || c.localName === 'h') {
        for (const tab of [...c.getElementsByTagNameNS(TEXT, 'tab')]) tab.parentNode.replaceChild(doc.createTextNode('\t'), tab);
        const raw = getOdtText(c);
        const i = raw.lastIndexOf('\t');
        const clean = (x) => x.replace(/\s+/g, ' ').trim();
        let entry = clean(raw), page = null;
        if (i >= 0 && /^(?:\d+|[ivxlcdm]+)$/i.test(clean(raw.slice(i + 1)))) { entry = clean(raw.slice(0, i)); page = clean(raw.slice(i + 1)); }
        if (!entry && !page) continue;
        const item = { text: entry };
        if (page) item.page = page;
        const lvlFam = odtStyleFamilies(c).map((f) => /contents(\d+)$/.exec(f)).find(Boolean);
        const lvl = lvlFam ? Number(lvlFam[1]) - 1 : 0;
        if (lvl > 0) item.level = lvl;
        items.push(item);
      }
    }
    if (items.length) blocks.push({ type: 'list', kind: 'toc', style: 'toc', items });
  };

  const walk = (el) => {
    let openBox = null;                                      // { key, fill, start }: the run of bordered paragraphs being gathered
    const closeBox = () => {
      if (!openBox) return;
      const inner = blocks.splice(openBox.start, blocks.length - openBox.start);
      if (inner.length) {
        const box = { type: 'box', render: 'required' };
        const boxTitle = extractBoxTitle(inner);
        if (boxTitle) box.title = boxTitle;
        const col = openBox.fill ? hexToColorName(openBox.fill) : null;
        if (col) box.boxColor = col;
        box.blocks = inner;
        blocks.push(box);
      }
      openBox = null;
    };
    for (const node of el.childNodes || []) {
      if (node.nodeType !== 1) continue;
      const ln = node.localName;
      if (odtHiddenEl(node)) continue;                       // #19: hidden paragraphs/sections, the tracked-changes list
      const bd = ln === 'p' || ln === 'h' ? odtParaBorder(node) : null;
      if (openBox && (!bd || bd.key !== openBox.key)) closeBox();
      if (bd && !openBox) openBox = { key: bd.key, fill: bd.fill, start: blocks.length };
      if (ln === 'table-of-content') { odtPushToc(node); continue; }
      const text = getOdtText(node).replace(/\s+/g, ' ').trim();
      if (ln === 'h') {
        const hFrames = node.getElementsByTagNameNS(ODT_DRAW_NS, 'frame').length > 0;
        if (!text && !hFrames) continue;
        const lvl = Number(node.getAttributeNS(TEXT, 'outline-level') || 1);
        const notesOut = [], hImages = [];
        const segs = odtInlineSegments(node, styleMap, notesOut, hImages);
        blocks.push(...hImages);
        if (!text) {
          // M1: a heading holding only a formula (no heading text of its own) — same
          // alone-in-its-block display-math rule as the paragraph case, above.
          const nonBlank = segs.filter((s) => !(s.type === 'text' && !String(s.text || '').trim()));
          if (nonBlank.length && nonBlank.every((s) => s.type === 'math')) {
            for (const s of nonBlank) blocks.push({ ...s });
          }
          blocks.push(...notesOut);
          continue;
        }
        const hasFmt = segs.some((s) => s.tf || s.href || s.type === 'noteref' || s.transcriberTypeform || s.lang || s.type === 'math');
        blocks.push(hasFmt ? { type: 'heading', level: Math.min(6, lvl || 1), text, segments: segs } : { type: 'heading', level: Math.min(6, lvl || 1), text });
        blocks.push(...notesOut);
      } else if (ln === 'p') {
        const hasNote = node.getElementsByTagNameNS(ODT_TEXT_NS, 'note').length > 0;
        const hasFrame = node.getElementsByTagNameNS(ODT_DRAW_NS, 'frame').length > 0;
        const codeP = odtIsCodeStyle(node);
        // a blank paragraph inside a code block is a blank line of it
        if (codeP && !text && !hasNote && !hasFrame) { if (lastCodeBlock && blocks[blocks.length - 1] === lastCodeBlock) codeBlankPending++; continue; }
        if (!text && !hasNote && !hasFrame) continue;
        if (node === skipNextCaption) { skipNextCaption = null; continue; }   // already folded into the previous image
        const notesOut = [], imagesOut = [];
        const segs = odtInlineSegments(node, styleMap, notesOut, imagesOut);
        if (imagesOut.length) {
          let next = node.nextSibling;
          while (next && next.nodeType !== 1) next = next.nextSibling;
          const nextIsCaption = next && next.localName === 'p' && isCaptionStyle(next);
          const captionText = nextIsCaption ? getOdtText(next).replace(/\s+/g, ' ').trim() : '';
          const lastPic = imagesOut.map((g) => g.type).lastIndexOf('graphic');
          imagesOut.forEach((g, i) => {
            if (captionText && i === lastPic) g.caption = captionText;
            blocks.push(g);
          });
          if (nextIsCaption) skipNextCaption = next;
        }
        const style = (node.getAttributeNS(TEXT, 'style-name') || '').toLowerCase();
        if (!text) {
          // M1: a paragraph whose only real content is one or more formulas (a
          // <draw:frame> read as math by odtInlineSegments, above, contributes nothing to
          // `text` — getOdtText skips frames the same way it skips notes) is a display
          // equation, the same `math` block rule DOCX's m:oMathPara/a lone legacy equation
          // gets (parseDocx's DOCX_DISPLAY_MATH_SEGS / legacyAlone) and parseRtf's own
          // `nonBlank` check for a lone \object equation (paragraphSegments below). Tabs/
          // spaces used to centre the frame don't count as other content.
          const nonBlank = segs.filter((s) => !(s.type === 'text' && !String(s.text || '').trim()));
          if (nonBlank.length && nonBlank.every((s) => s.type === 'math')) {
            for (const s of nonBlank) blocks.push({ ...s });
          }
          blocks.push(...notesOut);
          continue;                                          // image-only paragraph: nothing else to push
        }
        // Import fix list #27: a Preformatted Text paragraph is a code block, its layout kept; consecutive ones are one block
        // (a paragraph with a raised or lowered run stays an ordinary paragraph: a code block is plain text and would lose the level).
        if (codeP && !/title/.test(style) && !text.includes(SCRIPT_MARKS.subOpen) && !text.includes(SCRIPT_MARKS.supOpen)) {
          const codeText = odtCodeText(node);
          if (codeText.trim()) {
            if (lastCodeBlock && blocks[blocks.length - 1] === lastCodeBlock) lastCodeBlock.text += '\n'.repeat(codeBlankPending + 1) + codeText;
            else { lastCodeBlock = { type: 'code', text: codeText }; blocks.push(lastCodeBlock); }
            codeBlankPending = 0;
            blocks.push(...notesOut);
            continue;
          }
        }
        // IMP-W1: a Subtitle goes with the Title just before it; with no Title before it, it is an ordinary paragraph.
        const prevTitle = blocks[blocks.length - 1];
        if (/subtitle/.test(style) && titleTakesSubtitle(prevTitle)) { mergeSubtitleIntoTitle(prevTitle, text); }
        else if (/title/.test(style) && !title && !(/subtitle/.test(style) && blocks.length)) { title = text; blocks.push({ type: 'title', text }); }
        else {
          const hasFmt = segs.some((s) => s.tf || s.href || s.type === 'noteref' || s.transcriberTypeform || s.lang || s.type === 'math');
          const pb = hasFmt ? { type: 'para', text, segments: segs } : { type: 'para', text };
          if (odtIsQuoteStyle(node)) pb.style = 'quote';     // Quotations: a displayed quotation (BANA section 9), as Word's Quote style
          blocks.push(pb);
        }
        blocks.push(...notesOut);
      } else if (ln === 'list') {
        const listImgs = [];
        const items = parseOdtList(node, 0, listImgs);
        if (items.length) blocks.push({ type: 'list', items });
        blocks.push(...listImgs);        // pictures/text boxes in list items follow the list
      } else if (ln === 'table') {
        const headers = [];
        const rows = [];
        // F-1: before this fix, only <table:table-cell> was read — a covered position from
        // a row or column span was skipped outright rather than blanked, so the row came
        // out short and every later real cell shifted left into the wrong column, exactly
        // the same data-corruption pattern F-1 names for HTML/DTBook rowspan. Unlike HTML
        // (whose rowspan/colspan omits the covered <td> from later <tr>s, needing the
        // pending-span bookkeeping createSpanReader provides for the HTML table reader
        // above) ODF's table:number-rows-spanned/table:number-columns-spanned always keep
        // the grid physically rectangular: the spec requires one real
        // <table:covered-table-cell> per covered position, in-place, for both a row span
        // and a column span (the same reason parseDocx's own w:vMerge needs no special
        // handling either — see createSpanReader's own comment). So the fix here is just to
        // stop skipping that element and read it as an empty cell, not to reimplement span
        // bookkeeping: the span attributes themselves are read from the spanning cell only
        // to record its extent (nothing downstream needs it), never to synthesise blanks.
        // D8: a cell keeps emphasis, links and note references (a { text, segments } object;
        // plain stays a string), and its paragraphs are separated by a space. A picture in a
        // cell (LibreOffice's layout tables hold most of a page's pictures) becomes a graphic
        // block after the table; a note's body follows the table too.
        const afterTable = [];
        const declaredCols = odtDeclaredColumns(node);
        // IMP-W6: with `markers`, a nested <table:table> is one { nestedTable } marker (it follows the outer table as a table of its own).
        const nestedQueue = [];
        const cellParas = (el, out, markers = false) => {
          for (const c of el.childNodes || []) {
            if (c.nodeType !== 1) continue;
            const l = c.localName;
            if (l === 'p' || l === 'h') out.push(c);
            else if (l === 'table' && markers) out.push({ nestedTable: c });
            else if (l !== 'note' && l !== 'frame' && l !== 'annotation') cellParas(c, out, markers);
          }
          return out;
        };
        const odtCellValue = (tc) => {
          const paras = cellParas(tc, [], true);
          if (!paras.length) return getOdtText(tc).replace(/\s+/g, ' ').trim();
          const segs = [], notesOut = [], imagesOut = [], paraTexts = [];
          for (const cp of paras) {
            if (cp.nestedTable) {
              nestedQueue.push(cp.nestedTable);
              paraTexts.push(NESTED_TABLE_PLACEHOLDER);
              if (segs.length) segs.push({ type: 'text', text: ' ' });
              segs.push({ type: 'text', text: NESTED_TABLE_PLACEHOLDER });
              continue;
            }
            paraTexts.push(getOdtText(cp).replace(/\s+/g, ' ').trim());
            const ps = odtInlineSegments(cp, styleMap, notesOut, imagesOut);
            if (segs.length && ps.length) segs.push({ type: 'text', text: ' ' });
            segs.push(...ps);
          }
          afterTable.push(...imagesOut);
          const rich = richCellFromSegments(segs);
          if (!rich) return paraTexts.filter(Boolean).join(' ');
          afterTable.push(...notesOut);
          return rich;
        };
        // K3 (BANA 11.6.1d, transcriber KD): print's own column alignment — the FIRST
        // paragraph's own resolved fo:text-align (buildOdtStyleMap/resolveOdtStyleAlign) —
        // voted per column, body rows only (`votes`, when passed, omitted for header rows).
        const colAlignVotes = [];
        // IMP-W5 (Paul, 30 Sep 2026): a merged cell repeats its content in every covered position (table:covered-table-cell), so no
        // column is left empty. vCarry: column -> { left, value } for the rows a row span still covers; hLeft/hVal the columns the
        // current row's last spanning cell still covers.
        const vCarry = [];
        const copyCell = (v) => (v && typeof v === 'object' ? { ...v } : v);
        const readCells = (tr, votes) => {
          const cells = [];
          let col = 0, hLeft = 0, hVal = '';
          for (const tc of odtExpandCells(tr, declaredCols)) {   // #1d: table:number-columns-repeated expanded (huge empty repeats capped) — one entry per column, covered cells included
            if (tc.nodeType !== 1) continue;
            if (tc.localName === 'covered-table-cell') {
              const reps = 1;   // odtExpandCells (above) already gives one entry per repeated column
              for (let r = 0; r < reps; r++) {
                let v = '';
                if (hLeft > 0) { v = hVal; hLeft--; }
                else if (vCarry[col] && vCarry[col].left > 0) { v = vCarry[col].value; vCarry[col].left--; }
                cells.push(copyCell(v));
                col++;
              }
              continue;
            }
            if (tc.localName !== 'table-cell') continue;
            const value = odtCellValue(tc);
            cells.push(value);
            const cSpan = clampSpan(parseInt(tc.getAttributeNS(TABLE_NS, 'number-columns-spanned') || '1', 10) || 1);
            const rSpan = clampSpan(parseInt(tc.getAttributeNS(TABLE_NS, 'number-rows-spanned') || '1', 10) || 1, MAX_ROW_SPAN);
            for (let k = 0; k < cSpan; k++) vCarry[col + k] = rSpan > 1 ? { left: rSpan - 1, value } : null;
            hLeft = cSpan - 1; hVal = value;
            if (votes) {
              const paras = cellParas(tc, []);
              const sName = paras.length ? paras[0].getAttributeNS(TEXT, 'style-name') : null;
              const al = sName ? resolveOdtStyleAlign(styleMap, sName) : null;
              if (al) (votes[col] ||= new Set()).add(al);
            }
            col++;
          }
          return cells;
        };
        // #1d: rows may sit in table:table-header-rows, table:table-rows and (nested) table:table-row-group, and be repeated
        // (table:number-rows-repeated); odtTableRows lists them in document order with repeats expanded.
        for (const { tr, header } of odtTableRows(node, declaredCols)) {
          const cells = readCells(tr, header ? undefined : colAlignVotes);
          if (!cells.length) continue;
          if (header) { for (const hc of cells) headers.push(hc); } else rows.push(cells);
        }
        if (headers.length || rows.length) {
          const tblBlock = { type: 'table', headers, rows };
          const printAlign = colAlignVotes.map((s) => (s && s.size === 1 ? [...s][0] : undefined));
          if (printAlign.some(Boolean)) tblBlock.printAlign = printAlign;
          blocks.push(tblBlock);
        }
        blocks.push(...afterTable);   // D8: cell pictures and notes follow the table
        for (const nt of nestedQueue) walk({ childNodes: [nt] });   // IMP-W6: each nested table follows this one as a table of its own
      } else if (ln === 'frame') {
        // a frame anchored at body level (not inside a paragraph): its own picture(s) here,
        // its text-box content through the ordinary walk below
        const own = [...node.childNodes].filter((c) => c.nodeType === 1 && c.localName === 'image');
        if (own.length) blocks.push(...odtFrameImages.own(node, own));
        walk(node);
      } else if (node.childNodes?.length) {
        walk(node);
      }
    }
    closeBox();
  };
  odtSeenFrames = new Set();
  odtObjectMath = objectMath;
  odtInlineImages = new Map();
  odtCtx = { styleMap, deleted: odtCollectDeleted(body) };
  try { walk(body); } finally { odtSeenFrames = null; odtObjectMath = null; odtCtx = null; }
  const inlineImages = odtInlineImages;
  odtInlineImages = null;
  // Import fix list #12: the title is the first Title paragraph (above); meta.xml's dc:title only when there is none — the same
  // precedence as Word's core.xml title. The author (meta:initial-creator, else dc:creator) goes to metadata.creator.
  const metaText = (ns, ln) => { const e = metaDoc && metaDoc.getElementsByTagNameNS(ns, ln)[0]; return e ? (e.textContent || '').replace(/\s+/g, ' ').trim() : ''; };
  const DC = 'http://purl.org/dc/elements/1.1/', META = 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0';
  const metaTitle = metaText(DC, 'title');
  const metaCreator = metaText(META, 'initial-creator') || metaText(DC, 'creator');
  const result = { title: title || metaTitle || null, blocks };
  if (metaCreator) result.metadata = { creator: metaCreator };
  // A45/D2: an odt image's xlink:href is already package-root-relative (Pictures/… or
  // media/…, per the producer — both seen in the real corpus), so it's fetched as-is.
  const resources = flat ? [] : await embedGraphicResources(arrayBuffer, blocks, (p) => p);
  for (const [path, r] of inlineImages) resources.push({ path, mime: r.mime, bytes: r.bytes });   // a flat XML ODT's own pictures
  if (resources.length) result.resources = resources;
  // IMP-W9: comments (office:annotation), running headers and footers (the master pages in styles.xml) are not transcribed; say so.
  {
    const ODT_OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0', ODT_STYLE = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
    const plain = (el) => {
      let t = '';
      for (const c of el.childNodes || []) {
        if (c.nodeType === 3) t += c.nodeValue;
        else if (c.nodeType === 1 && !['creator', 'date', 'meta', 'page-number', 'page-count', 'date', 'time', 'file-name'].includes(c.localName)) t += plain(c) + (c.localName === 'p' || c.localName === 'h' ? ' ' : '');
      }
      return t;
    };
    const n = { comments: [...doc.getElementsByTagNameNS(ODT_OFFICE, 'annotation')].filter((a) => isRealLeftOutText(plain(a))).length, headers: 0, footers: 0 };
    if (stylesDoc) {
      const hdr = [], ftr = [];
      for (const ln of ['header', 'header-left', 'header-first']) for (const e of stylesDoc.getElementsByTagNameNS(ODT_STYLE, ln)) hdr.push(plain(e));
      for (const ln of ['footer', 'footer-left', 'footer-first']) for (const e of stylesDoc.getElementsByTagNameNS(ODT_STYLE, ln)) ftr.push(plain(e));
      n.headers = countDistinctRealTexts(hdr);
      n.footers = countDistinctRealTexts(ftr);
    }
    const leftOut = leftOutNotice(n);
    if (leftOut) (result.warnings || (result.warnings = [])).push(leftOut);
    if (odtDeepListSeen) (result.warnings || (result.warnings = [])).push(`Lists in this file are nested far deeper than any real document (more than ${ODT_MAX_LIST_DEPTH} levels); the items below that were read as plain items without numbers or bullets.`);
  }
  return finishLanguages(result);                          // foreign-language noise dropped over the whole document (input/lang.mjs)
}

// ---------- EPUB (spine of XHTML) ----------
export async function parseEpub(arrayBuffer) {
  const dec = new TextDecoder();
  const container = dec.decode(await unzipEntry(arrayBuffer, 'META-INF/container.xml'));
  const EPUB_DAMAGED = 'This EPUB book is damaged or incomplete and could not be read.';
  const cdoc = parseStructuredPart(container, 'META-INF/container.xml', EPUB_DAMAGED);   // strict (audit batch S2b item 8)
  const opfPath = cdoc.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('epub: container has no rootfile');
  const opf = dec.decode(await unzipEntry(arrayBuffer, opfPath));
  const odoc = parseStructuredPart(opf, opfPath, EPUB_DAMAGED);
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = {};
  for (const it of odoc.getElementsByTagNameNS('*', 'item')) {
    manifest[it.getAttribute('id')] = {
      href: it.getAttribute('href'),
      props: (it.getAttribute('properties') || '').toLowerCase(),
      mediaType: (it.getAttribute('media-type') || '').toLowerCase()
    };
  }
  const title = odoc.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() || null;
  const bookLang = odoc.getElementsByTagNameNS('*', 'language')[0]?.textContent?.trim() || null;   // dc:language: the book's main language (input/lang.mjs)
  const blocks = [];
  // Every spine item is read, in the spine's order — linear="no" too. A cover page and a notes file are often marked that way; skipping them
  // lost every note an EPUB 3 keeps there, and the cover (import fix list #3). Only the navigation document is left out: the contents list is rebuilt.
  const chapters = [];
  // Audit batch S2b, items 9 and 10: EVERY item of the reading order is accounted for. One that is not in the package's list, or whose file is
  // not in the archive, or whose data is damaged, is named in a warning; a book with no readable chapter at all is an error, never an empty
  // success. A chapter's href is resolved against the OPF's folder the way a browser resolves a URL: "./" and "../" collapsed, a #fragment
  // dropped, %-encoding decoded (the name as written is tried first, as it always was).
  const baseDir = base ? base.slice(0, -1) : '';
  const collapse = (path) => {
    const out = [];
    for (const part of path.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') { if (out.length) out.pop(); else return null; }   // above the archive's root: not a place in it
      else out.push(part);
    }
    return out.join('/');
  };
  const chapterCandidates = (href) => {
    const raw = String(href).split('#')[0].split('?')[0];
    const joined = baseDir ? `${baseDir}/${raw}` : raw;
    const literal = collapse(joined);
    let decoded = null;
    try { decoded = collapse(decodeURIComponent(joined)); } catch { /* a % that is not an escape: the literal name only */ }
    return [...new Set([literal, decoded].filter(Boolean))];
  };
  const notInPackage = [], notInFile = [], damagedNames = [];
  let spineItems = 0;
  for (const ref of odoc.getElementsByTagNameNS('*', 'itemref')) {
    spineItems++;
    const idref = ref.getAttribute('idref') || '';
    const item = manifest[idref];
    if (!item || !item.href) { notInPackage.push(idref || '(no id)'); continue; }
    if (item.props.includes('nav')) continue;
    let entryBytes = null, targetPath = null, failure = null;
    const candidates = chapterCandidates(item.href);
    for (const cand of candidates) {
      try { entryBytes = await unzipEntry(arrayBuffer, cand); targetPath = cand; break; }
      catch (e1) {
        if (e1 && e1.zipTooBig) throw e1;                    // a chapter that inflates to far more than any chapter holds: the whole file is refused
        if (e1 && (e1.zipDamaged || e1.zipUnsupported)) { failure = 'damaged'; break; }   // a chapter whose data is corrupt: left out, and the load notice says so
      }
    }
    if (entryBytes) {
      const file = normalizeHref(targetPath);
      chapters.push({ targetPath, file, dir: file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '', html: dec.decode(entryBytes) });
    } else if (failure === 'damaged') damagedNames.push(item.href.split('#')[0]);
    else notInFile.push(item.href.split('#')[0]);
  }
  const damagedChapters = damagedNames.length;
  if (damagedChapters && !chapters.length) throw zipDamagedError('every chapter of the book is damaged');
  if (!chapters.length) {
    throw docxUserError(spineItems && (notInFile.length || notInPackage.length)
      ? `This EPUB book has no readable chapters: its reading order lists ${spineItems} item${spineItems === 1 ? '' : 's'}, and none of them is in the file. The file may be damaged or incomplete.`
      : 'This EPUB book has no readable chapters: its reading order is empty. The file may be damaged or incomplete.');
  }
  // The notes of the whole book: which ids any note reference in any chapter points at (a note may sit in another file), then each chapter lifts
  // its notes out of the page and they are placed at their references once every chapter is read (import fix list #29).
  const refTargets = new Set();
  const backTargets = new Set();                       // the ids of the note references themselves (what a note's "back" link points at)
  for (const ch of chapters) {
    for (const tagText of ch.html.match(/<a\b[^>]*>/gi) || []) {
      if (!/(?:role\s*=\s*["'][^"']*\bdoc-noteref\b|epub:type\s*=\s*["'][^"']*\bnoteref\b|class\s*=\s*["'][^"']*\b(?:footnote-ref|noteref)\b)/i.test(tagText)) continue;
      const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tagText);
      const key = href ? htmlNoteKey(ch.file, ch.dir, href[1].replace(/&amp;/g, '&')) : null;
      if (key) refTargets.add(key);
      const id = /[\s"']id\s*=\s*["']([^"']*)["']/i.exec(tagText);
      if (key && id) backTargets.add(`html-${ch.file}#${id[1]}`);
    }
  }
  const notes = new Map();
  const cssCache = new Map();
  // A54 (EPUB half): an <img>/<figure> `src` from parseHtml is relative to THIS
  // chapter's own file, not the package root embedGraphicResources (below) expects —
  // resolve it per chapter, before its blocks are merged into the book's one flat
  // list, the same way A45/D2 resolves a docx relationship Target against `word/`.
  const resolveGraphics = (list, chapterDir) => {
    for (const g of collectGraphics(list)) {
      if (!g.src || /^(data:|https?:|blob:|cid:)/i.test(g.src)) continue;
      g.src = resolveZipPath(chapterDir, g.src);
    }
  };
  for (const ch of chapters) {
    // the style sheets the chapter links: a class the book hides (.hidden{display:none}) or makes bold is read from them (#19, #33)
    let extraCss = '';
    for (const tagText of ch.html.match(/<link\b[^>]*>/gi) || []) {
      if (!/\brel\s*=\s*["'][^"']*stylesheet/i.test(tagText)) continue;
      const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tagText);
      if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href[1])) continue;
      const cssPath = resolveZipPath(ch.dir, href[1]);
      if (!cssCache.has(cssPath)) {
        let css = '';
        try { css = dec.decode(await unzipEntry(arrayBuffer, cssPath)); } catch { /* a missing style sheet changes nothing */ }
        cssCache.set(cssPath, css);
      }
      extraCss += '\n' + cssCache.get(cssPath);
    }
    const chapterBlocks = parseHtml(ch.html, { mainLang: bookLang, rawLang: true, file: ch.file, refTargets, backTargets, notes, deferNotes: true, extraCss }).blocks;   // language tags finished over the whole book, below
    resolveGraphics(chapterBlocks, ch.targetPath.includes('/') ? ch.targetPath.slice(0, ch.targetPath.lastIndexOf('/')) : '');
    blocks.push(...chapterBlocks);
  }
  placeHtmlNotes(blocks, notes);
  const result = { title, blocks };
  // S3b #18 (ChatGPT audit 15 Oct 2026): what the package document says about the book is kept on the model, as the DTBook reader keeps its
  // <head> (metadata.creator, .language, .lang, .identifier, .publisher), so a braille edition (eBraille, NIMAS) can carry the book's author,
  // language, identifier and publisher instead of "Unknown" and the browser's language. The identifier is the one the package names as its
  // unique-identifier, else the first. Nothing is added when the OPF has none of them, and no `package` marker (that is for a NIMAS package).
  const dcAll = (ln) => [...odoc.getElementsByTagNameNS('*', ln)].map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const uidRef = odoc.documentElement && odoc.documentElement.getAttribute ? odoc.documentElement.getAttribute('unique-identifier') : null;
  const uidEl = uidRef ? [...odoc.getElementsByTagNameNS('*', 'identifier')].find((e) => e.getAttribute('id') === uidRef) : null;
  const epubMeta = {};
  const creators = dcAll('creator');
  if (creators.length) epubMeta.creator = creators.join(', ');
  const langs = dcAll('language');
  if (langs.length) { epubMeta.language = langs[0]; epubMeta.lang = langs[0]; }
  const uidText = uidEl ? (uidEl.textContent || '').trim() : '';
  const ids = dcAll('identifier');
  if (uidText || ids.length) epubMeta.identifier = uidText || ids[0];
  const publishers = dcAll('publisher');
  if (publishers.length) epubMeta.publisher = publishers[0];
  if (Object.keys(epubMeta).length) result.metadata = epubMeta;
  const nameList = (names) => names.length <= 5 ? names.join(', ') : `${names.slice(0, 5).join(', ')} and ${names.length - 5} more`;
  const epubWarnings = [];
  if (damagedChapters) epubWarnings.push(`${damagedChapters} part${damagedChapters === 1 ? '' : 's'} of the book ${damagedChapters === 1 ? 'is' : 'are'} damaged and ${damagedChapters === 1 ? 'was' : 'were'} left out (${nameList(damagedNames)}).`);
  if (notInFile.length) epubWarnings.push(`${notInFile.length} chapter${notInFile.length === 1 ? '' : 's'} in the book's reading order ${notInFile.length === 1 ? 'is' : 'are'} missing from the file and ${notInFile.length === 1 ? 'was' : 'were'} left out (${nameList(notInFile)}).`);
  if (notInPackage.length) epubWarnings.push(`${notInPackage.length} item${notInPackage.length === 1 ? '' : 's'} in the book's reading order ${notInPackage.length === 1 ? 'is' : 'are'} not listed in its package and ${notInPackage.length === 1 ? 'was' : 'were'} left out (${nameList(notInPackage)}).`);
  if (epubWarnings.length) result.warnings = epubWarnings;
  // A54: carries the image bytes into model.resources, the same {path, mime, bytes} shape
  // A45/D2 built for DOCX/ODT — an EPUB's cover/illustration images are real package parts
  // (the manifest above), not external references, so there's no reason the editor/tactile
  // workflow should see alt-text-only blocks the way parseHtml alone (no package to read
  // bytes from) has to settle for.
  const resources = await embedGraphicResources(arrayBuffer, blocks, (p) => p);
  if (resources.length) result.resources = resources;
  return finishLanguages(result);                          // foreign-language noise dropped over the whole document (input/lang.mjs)
}

// ---------- DAISY 3 / NIMAS DTBook XML ----------

/**
 * Decodes a `data:image/svg+xml[;base64],…` URI (as written by the NIMAS
 * exporter for tactile graphics) back into SVG markup. Returns null for any
 * other src.
 * @param {string} src
 * @returns {string|null}
 */
function svgFromDataUri(src) {
  if (typeof src !== 'string' || !/^data:image\/svg\+xml/i.test(src)) return null;
  const comma = src.indexOf(',');
  if (comma === -1) return null;
  const header = src.slice(5, comma);
  const payload = src.slice(comma + 1);
  try {
    let svg;
    if (/;base64/i.test(header)) {
      if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        svg = Buffer.from(payload, 'base64').toString('utf8');
      } else {
        const bin = atob(payload);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        svg = new TextDecoder('utf-8').decode(bytes);
      }
    } else {
      svg = decodeURIComponent(payload);
    }
    return svg && /<svg[\s>]/i.test(svg) ? svg : null;
  } catch {
    return null;
  }
}

// <q> in a DTBook file: print shows quotation marks round the text, so the reader puts them in the text — “ ” outside, ‘ ’ inside
// one, as the HTML reader does (see the `tag === 'q'` case of its quote pass) — unless the text already carries them (it starts with
// an opening quotation mark: the author typed the marks inside the <q>, as NIMAS_valid_baseline.xml's <q>"Desperate times … jobs."
// (CRF …)</q> does, where the closing mark is not even last). A save writes the marks as plain text and no <q>, so reopening the
// saved file cannot add them twice.
const DTBOOK_Q_OPEN = /^\s*["“‘'«‹„‚「『]/;
// The text node a mark should go INTO at the start (first) or end of a <q>: the text itself, or the text of a <cite>/<author> that opens
// or closes it (the reader spaces those like blocks, which would leave "Romain ”"). null = put the mark beside the <q>'s content.
function dtbookQEdgeText(q, first) {
  let n = q;
  for (;;) {
    let c = first ? n.firstChild : n.lastChild;
    while (c && c.nodeType === 3 && !(c.nodeValue || '').trim()) c = first ? c.nextSibling : c.previousSibling;
    if (!c) return null;
    if (c.nodeType === 3) return c;
    const t = c.nodeType === 1 ? (c.localName || c.tagName || '').toLowerCase() : '';
    if (t === 'cite' || t === 'author') { n = c; continue; }
    return null;
  }
}
function dtbookDrawQuotes(root, doc) {
  const visit = (el, depth) => {
    let next;
    for (let c = el.firstChild; c; c = next) {
      next = c.nextSibling;
      if (c.nodeType !== 1) continue;
      if ((c.localName || c.tagName || '').toLowerCase() !== 'q') { visit(c, depth); continue; }
      const text = c.textContent || '';
      // ... nor when the file writes the marks just outside the <q> (“<q>text</q>”): the text right before it ends with an opening mark
      const prev = c.previousSibling && c.previousSibling.nodeType === 3 ? (c.previousSibling.nodeValue || '') : '';
      if (text.trim() && !DTBOOK_Q_OPEN.test(text) && !/["“‘'«‹„‚「『]$/.test(prev)) {
        const open = depth % 2 === 0 ? '“' : '‘', close = depth % 2 === 0 ? '”' : '’';
        const firstText = dtbookQEdgeText(c, true);
        if (firstText) firstText.nodeValue = open + (firstText.nodeValue || '').replace(/^\s+/, ''); else c.insertBefore(doc.createTextNode(open), c.firstChild);
        const lastText = dtbookQEdgeText(c, false);
        if (lastText) lastText.nodeValue = (lastText.nodeValue || '').replace(/\s+$/, '') + close; else c.appendChild(doc.createTextNode(close));
      }
      visit(c, depth + 1);
    }
  };
  visit(root, 0);
}

export function parseDtbook(xmlStr) {
  const doc = parseXml(xmlStr);
  const root = doc.documentElement;
  const rootTag = (root?.localName || root?.tagName || '').toLowerCase();
  if (root && doc.createTextNode) dtbookDrawQuotes(root, doc);
  const metadata = {};
  if (root?.getAttribute) {
    const lang = root.getAttribute('xml:lang') || root.getAttribute('lang');
    if (lang) metadata.lang = lang;
  }
  // Foreign-language passages (xml:lang on inline/block elements, input/lang.mjs): the book's own language is the root's
  // xml:lang, else its dc:Language meta.
  setMarkupMainLang(metadata.lang || ([...(doc.getElementsByTagName ? doc.getElementsByTagName('meta') : [])].find((m) => /^dc:language$/i.test((m.getAttribute && m.getAttribute('name')) || '')) || { getAttribute: () => null }).getAttribute('content') || null);
  const doctitle = doc.getElementsByTagName ? (doc.getElementsByTagName('doctitle')[0] || doc.getElementsByTagName('title')[0]) : null;
  // Line breaks (<br/>) in a title separate words (A28: "UIRNTTDINCOO<br/>À" ran together).
  const textOf = (el) => {
    let t = '';
    (function walk(n) { for (let k = n.firstChild; k; k = k.nextSibling) { if (k.nodeType === 3) t += k.nodeValue; else if (k.nodeType === 1) { if ((k.localName || k.tagName || '').toLowerCase() === 'br') t += ' '; else walk(k); } } })(el);
    return t.replace(/\s+/g, ' ').trim();
  };
  let title = (doctitle && textOf(doctitle)) || null;
  let placeholderTitle = false;   // the exporter's 'Emboss Document' stand-in for a title the source never had
  const docOptions = [];
  if (doc.getElementsByTagName) {
    const metaTags = [...doc.getElementsByTagName('meta')];
    for (const m of metaTags) {
      const name = m.getAttribute ? m.getAttribute('name') : null;
      const content = m.getAttribute ? (m.getAttribute('content') || '').trim() : '';
      if (!name || !content) continue;
      const lname = name.toLowerCase();
      if (lname === 'dtb:uid') metadata.uid = content;
      else if (lname === 'dc:title') {
        metadata.title = content;
        if (!title) title = content;
      } else if (lname === 'dc:publisher') metadata.publisher = content;
      else if (lname === 'dc:date') metadata.date = content;
      else if (lname === 'dc:creator') metadata.creator = content;
      else if (lname === 'dc:identifier') metadata.identifier = content;
      else if (lname === 'dc:language') metadata.language = content;
      else if (lname === 'dc:source') metadata.source = content;
      else if (lname === 'dc:rights') metadata.rights = content;
      else if (lname === 'dc:format') metadata.format = content;
      else if (lname === 'dc:subject') metadata.subject = content;
      else if (BANA_DOC_OPTIONS.some((o) => o.meta === lname)) { const o = BANA_DOC_OPTIONS.find((x) => x.meta === lname), v = docOptionValue(o, content); if (v !== undefined) docOptions.push([o.field, v]); }   // formatter options (spacedEllipsis …)
      else if (lname.startsWith('nimas-')) {
        if (!metadata.nimas) metadata.nimas = {};
        metadata.nimas[name] = content;
      }
    }
    if (!metadata.lang && metadata.language) metadata.lang = metadata.language;
    // The exporter writes 'Emboss Document' when the source had no title; reading that placeholder back
    // as a real title would put a title page / running head on a document that never had one.
    if (title === 'Emboss Document') { title = null; placeholderTitle = true; }
    if (metadata.title === 'Emboss Document') delete metadata.title;
    // <docauthor> is book content (the exporter writes it back from metadata.docauthor).
    // Every <docauthor> (a book may have several; A28).
    const docauthors = [...doc.getElementsByTagName('docauthor')].map((el) => textOf(el)).filter(Boolean);
    if (docauthors.length) {
      metadata.docauthor = docauthors[0];
      if (docauthors.length > 1) metadata.docauthors = docauthors;
    }
  }
  const blocks = [];
  // A19/A21 Stage 5: each generic <div class="…"> walk() falls through to its "unknown
  // container" branch gets a fresh id here, tagged (with the class) onto every block it
  // produces — see that branch, below — purely so nimas-export.mjs's contiguous-run sweep
  // can tell two adjacent, identically-classed-but-separate <div>s apart from one <div>'s own
  // contiguous content; the id itself is never written back out.
  let divRunSeq = 0;
  // A35: each <blockquote> whose direct children mix a <line> with other block content
  // (a quoted letter's salutation/signature lines alongside its body <p>, e.g.
  // hauy_history_valid.xml's dtb380) gets a fresh id here, tagged onto every block that
  // blockquote's own walk() produces — see the tag==='blockquote' branch, below — so
  // nimas-export.mjs's contiguous-run sweep can rebuild one <blockquote> around them all,
  // the same "same shape is fine" simplification as Stage 5's divClass/divId.
  let blockquoteRunSeq = 0;
  // A42: each top-level source element parsePoem is entered for that is NOT itself a <poem>
  // (a bare <linegroup>/<stanza>, or a poem/verse/stanza-classed <div>) gets a fresh id here,
  // tagged (with block.bareLinegroup = true) onto every block that call's own walk produces —
  // see parsePoem's call sites, below — so nimas-export.mjs knows to write the run back without
  // inventing a <poem> wrapper the source never had, and so two separate, adjacent bare
  // linegroups (no stanza-break between them) aren't merged into one on export — same
  // "same shape is fine" simplification as Stage 5's divClass/divId.
  let poemRunSeq = 0;
  // 30d: a real <poem> that has its own <title>/<author> (or a <byline> among its lines) gets a fresh id, tagged onto every block it
  // produces (block.poemId), so nimas-export.mjs can write the run back as ONE <poem> holding its own title and author, and keep two
  // adjacent titled poems apart.
  let poemHeadSeq = 0;

  if (rootTag === 'math' || rootTag.endsWith(':math')) {
    const mathml = texOnlyMathToMathML(mathOuterXml(root)) || mathOuterXml(root);   // A89
    const latex = mathmlToLatex(mathml);
    const blk = { type: 'math', mathml };
    if (latex) blk.latex = latex;
    blocks.push(blk);
    return { title: null, blocks };
  }

  const TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4, TF_SCRIPT = 8;   // K5: TF_SCRIPT, matching cell-markup.mjs/engine TYPEFORM.script=8

  const BLOCK_TAGS = new Set(['p', 'div', 'li', 'lic', 'tr', 'td', 'th', 'hd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'sidebar', 'note', 'caption', 'prodnote', 'dt', 'dd', 'line', 'ln', 'speaker', 'stage', 'blockquote', 'byline', 'author', 'cite', 'attrib']);
  const LIST_TAGS = new Set(['list', 'ul', 'ol']);
  const INLINE_IN_TEXT = new Set(['cite', 'author']);
  const TEXT_PARENTS = new Set(['p', 'li', 'lic', 'td', 'th', 'dd', 'dt', 'hd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'caption', 'line', 'ln', 'span', 'em', 'strong', 'q', 'a', 'sent', 'w', 'dfn', 'sub', 'sup']);
  const LIST_AND_TABLE_TAGS = new Set(['list', 'ul', 'ol', 'table', 'note']);
  const LI_SPLIT_TAGS = new Set(['note', 'imggroup', 'img', 'image']); // split out of a list item (tables are skipped by inlineSegments already)
  const IMAGE_TAGS = new Set(['imggroup', 'img', 'image']);
  // A decorative inline <img>/<image> — empty/missing alt text, or role="presentation"/"none"
  // (WAI-ARIA's own convention for "carries no content") — has nothing for braille to say
  // (BANA 6.4.1 already omits an uncaptioned, undescribed illustration entirely). Bug 7 /
  // real-book-validation-24sep.md: such a glyph inside a glossary <dt>/<dd> (the anthology's
  // decorative ōō) was collected the same way a real content image is (tablesIn, parseDefinition
  // List), forcing the glossary to split into a separate list/page around it. Used to recognise
  // it and keep it from splitting the list — see parseDefinitionList's own comment for how the
  // image itself is still kept (queued, not dropped) so the model's image count is unaffected.
  const isDecorativeImg = (el) => {
    if (!el || !el.getAttribute) return true;
    const alt = (el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
    const role = (el.getAttribute('role') || '').toLowerCase().trim();
    if (role === 'presentation' || role === 'none') return true;
    return !alt;
  };
  // A print line number: <linenum>, or an element classed "linenum" / "line-number".
  const isLinenumEl = (el) => {
    const t = (el.localName || el.tagName || '').toLowerCase();
    const c = ((el.getAttribute && el.getAttribute('class')) || '').toLowerCase();
    return t === 'linenum' || c.includes('linenum') || c.includes('line-number');
  };
  const findLinenum = (el) => {
    for (let k = el.firstChild; k; k = k.nextSibling) {
      if (k.nodeType !== 1) continue;
      if (isLinenumEl(k)) return k;
      const inner = findLinenum(k);
      if (inner) return inner;
    }
    return null;
  };
  // Verse lines carry their number as a prefix (parsePoem); elsewhere it is a segment (A30).
  const inVerseLine = (el) => {
    for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) {
      const t = (p.localName || p.tagName || '').toLowerCase();
      if (t === 'line' || t === 'ln') return true;
    }
    return false;
  };
  const guessedPages = new WeakMap();                     // contents item → its text before a trailing number was taken as the page
  // Inline (phrase) elements; any other child element starts a block.
  const INLINE_TAGS = new Set(['a', 'abbr', 'acronym', 'annoref', 'author', 'b', 'bdo', 'big', 'br', 'cite', 'code', 'dfn', 'em', 'i', 'kbd', 'linenum', 'math', 'noteref', 'q', 'samp', 'sent', 'small', 'span', 'strong', 'sub', 'sup', 'tt', 'u', 'var', 'w']);
  const hasBlockChild = (el) => [...(el.childNodes || [])].some((n) => {
    if (n.nodeType !== 1) return false;
    const t = (n.localName || n.tagName || '').toLowerCase();
    return !INLINE_TAGS.has(t) && !PAGENUM_TAGS.has(t) && !t.endsWith(':math');
  });
  const PAGENUM_TAGS = new Set(['pagenum', 'print-page']);
  // A89 (Paul, 2 Oct 2026): what Emboss's own save says about an element's edges. xml:space="preserve" (the writer puts it on an element
  // that starts or ends with a space that is meant) keeps the spaces at its edges; class="bana-empty" marks an empty paragraph, list
  // item or table row as a block of its own. An element without them is read as ever: its edges are trimmed, an empty one is no block.
  const hasPreserve = (el) => !!(el && el.getAttribute && el.getAttribute('xml:space') === 'preserve');
  const hasEmptyMark = (el) => !!(el && el.getAttribute && /(^|\s)bana-empty(\s|$)/.test(el.getAttribute('class') || ''));
  function getCleanText(el, excludeTags = null) {
    if (!el) return '';
    const hasExclude = excludeTags && typeof excludeTags.has === 'function';
    let text = '';
    function collect(node) {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          text += child.nodeValue || '';
        } else if (child.nodeType === 1) {
          const tag = (child.localName || child.tagName || '').toLowerCase();
          if (hasExclude && excludeTags.has(tag)) {
            if (IMAGE_TAGS.has(tag)) text += ' ';
            continue;
          }
          const cls = (child.getAttribute ? (child.getAttribute('class') || '') : '').toLowerCase();
          if (tag === 'img' || tag === 'image') { text += ' '; continue; }
          if (tag === 'brl' || tag === 'linenum' || cls.includes('linenum') || cls.includes('line-number')) continue;
          // A print page turn is never part of the running text ("…know, xxixtake a moment…");
          // pagenumBlock() / inlineSegments() carry it as its own block or segment instead.
          if (PAGENUM_TAGS.has(tag)) continue;
          // <cite>/<author> are inline inside running text ("…of <cite>Broca's Brain</cite>."
          // must not become "Brain ."); as a direct child of a blockquote/poem they are lines.
          const parentTag = (node.localName || node.tagName || '').toLowerCase();
          const isBlock = BLOCK_TAGS.has(tag) && !(INLINE_IN_TEXT.has(tag) && TEXT_PARENTS.has(parentTag));
          if (isBlock) text += ' ';
          collect(child);
          if (isBlock) text += ' ';
        }
      }
    }
    collect(el);
    return hasPreserve(el) ? text.replace(/\s+/g, ' ') : text.replace(/\s+/g, ' ').trim();
  }

  // getCleanText with each <br/> kept as a '\n' line break (words on either side trimmed; an empty line is dropped).
  function textWithBreaks(el) {
    const c = el.cloneNode(true);
    const owner = c.ownerDocument || el.ownerDocument;
    for (const br of [...(c.getElementsByTagName ? c.getElementsByTagName('br') : [])]) br.parentNode.replaceChild(owner.createTextNode('\u0001'), br);
    return getCleanText(c).split('\u0001').map((l) => l.trim()).filter(Boolean).join('\n');
  }

  // A page column: several linked references side by side (<a>p. 98</a><a>p. 101</a>) are
  // separate references, joined with ", " (they ran together as "p. 98p. 101").
  function pageColumnText(el, excludeTags = null) {
    const kids = [...(el.childNodes || [])];
    const links = kids.filter((k) => k.nodeType === 1 && (k.localName || k.tagName || '').toLowerCase() === 'a');
    const onlyLinks = kids.every((k) => (k.nodeType === 3 ? !k.nodeValue.trim() : k.nodeType !== 1 || links.includes(k)));
    if (links.length > 1 && onlyLinks) return links.map((a) => getCleanText(a, excludeTags)).filter(Boolean).join(', ');
    return getCleanText(el, excludeTags);
  }

  // A36: the page-number column's own <a href> (a ToC/index entry whose visible page number is
  // itself a link, e.g. <li class="toc-page"><a href="#p2">2</a></li>, or the <p>-wrapped
  // <lic class="bai-toc-page"><p><a href="#p3">3</a></p></lic> variant) — kept alongside the
  // plain-text page number in item.pageHref (see the two toc-page/lic-page callers below), so a
  // save can put the href back around the visible number instead of silently dropping it (the
  // number itself always survived via pageColumnText/getCleanText; only the link target was
  // lost). Deliberately narrower than pageColumnText: only when the column has *exactly one*
  // link of its own is its target unambiguous. pageColumnText's own ", "-joined case — several
  // *separate* page references side by side, e.g. <a href="#a">p. 141</a><a href="#b">p. 192</a>
  // — has no single href to hang the combined text on, so it is left exactly as before this fix
  // (no href at all; see index_page_references.test.mjs's "linked page references" case).
  // excludeTags (same contract as getCleanText's) matters too: a <li class="toc-page"> that is
  // *itself* the page column for one entry can also carry the nested <list> of that entry's own
  // sub-items (9780076996285NIMAS.xml's shape — see parseSingleList's toc-page branch, which
  // already excludes LIST_AND_TABLE_TAGS from pVal for the same reason) — those sub-items' own
  // <a href>s must not be counted as "more than one link" and blank out this entry's own href.
  function pageColumnHref(el, excludeTags = null) {
    if (!el) return null;
    const hasExclude = excludeTags && excludeTags.size;
    const found = [];
    (function walk(node) {
      for (const child of [...(node.childNodes || [])]) {
        if (child.nodeType !== 1) continue;
        const tag = (child.localName || child.tagName || '').toLowerCase();
        if (hasExclude && excludeTags.has(tag)) continue;
        if (tag === 'a' && child.getAttribute && child.getAttribute('href')) found.push(child.getAttribute('href'));
        walk(child);
      }
    })(el);
    return found.length === 1 ? found[0] : null;
  }

  // ---- print page turns (<pagenum>) inside running text ----
  // DTBook allows <pagenum> anywhere a print page changes: between blocks, but also inside
  // <p>, <h2>, <li>, <td>… The formatter needs it as a block (BANA §1.11.3 page change
  // indicator; B004 §8 print page turn indicator), so the helpers below lift it out of
  // inline content: a paragraph is split around it (text resumes in cell 1 — both standards),
  // anything that cannot be split (heading, verse line, note, list item) gets the turn hoisted
  // before it when it precedes all content, otherwise after it.
  function pagenumBlock(el) {
    if (!el) return null;
    const attr = (name) => (el.getAttribute ? (el.getAttribute(name) || '') : '');
    const banaTokens = attr('class').toLowerCase().split(/\s+/).filter((t) => t.startsWith('bana-'));
    let value = getCleanText(el);
    const noNumber = banaTokens.includes('bana-implied') || banaTokens.includes('bana-unnumbered');   // F-45 / F-51: no number of its own
    if (!value && !noNumber) {
      // Empty element: the number is often only in the id ("page_12", "p-xiv").
      const m = attr('id').match(/(\d+|[ivxlcdm]+)\s*$/i);
      value = m ? m[1] : '';
    }
    if (!value && !noNumber) return null;     // an implied page number may have no value of its own (F-45)
    const block = value ? { type: 'pagenum', text: value, page: value } : { type: 'pagenum' };
    const id = attr('id').trim();
    if (id) block.id = id;                              // kept so a round trip preserves the source ids
    const pageType = attr('page').toLowerCase();       // front | normal | special (DTBook @page)
    if (pageType === 'front' || pageType === 'normal' || pageType === 'special') block.pageType = pageType;
    else block.pageType = /^\d+$/.test(value.trim()) ? 'normal' : /^[ivxlcdm]+$/i.test(value.trim()) ? 'front' : 'special';   // F-S4-03: the type the save would write, so a reload is identical
    if (banaTokens.length) readBanaFlags(block, banaTokens, attr('title') || null);   // implied, combineWithNext, through, spelled
    return block;
  }

  // Trim leading/trailing whitespace-only text at the edges of a segment run (in place).
  function trimSegmentEdges(split) {
    while (split.length > 0 && split[0].type === 'text' && !split[0].tf && !split[0].uncontracted && /^\s*$/.test(split[0].text || '')) {
      split.shift();
    }
    if (split.length > 0 && split[0].type === 'text' && split[0].text) {
      split[0].text = split[0].text.replace(/^\s+/, '');
      if (!split[0].text) split.shift();
    }
    while (split.length > 0 && split[split.length - 1].type === 'text' && !split[split.length - 1].tf && !split[split.length - 1].uncontracted && /^\s*$/.test(split[split.length - 1].text || '')) {
      split.pop();
    }
    if (split.length > 0 && split[split.length - 1].type === 'text' && split[split.length - 1].text) {
      split[split.length - 1].text = split[split.length - 1].text.replace(/\s+$/, '');
      if (!split[split.length - 1].text) split.pop();
    }
    return split;
  }

  function segsHavePagenum(segs) {
    return segs.some((s) => s && s.type === 'pagenum');
  }

  // For content whose page turns are collected separately (collectPagenums): drop the
  // pagenum segments so they are not also carried inside the block's segments.
  function segsWithoutPagenums(segs) {
    if (!segsHavePagenum(segs)) return segs;
    // A page turn between "…word " and " next…" leaves two spaces once it is gone; keep one (a saved file
    // re-reads the same way, so the first save is already stable).
    const out = [];
    let afterPagenum = false;
    for (const s of segs) {
      if (s.type === 'pagenum') { afterPagenum = true; continue; }
      const prev = out[out.length - 1];
      if (afterPagenum && s.type === 'text' && s.text && prev && prev.type === 'text' && /(^|[^\n]) $/.test(prev.text || '') && s.text.startsWith(' ') && !/^ *\n/.test(s.text)) {   // spaces only: a line break (\n, from <br/>) stays
        const t = s.text.replace(/^ +/, '');
        afterPagenum = false;
        if (!t) continue;
        out.push({ ...s, text: t });
        continue;
      }
      afterPagenum = false;
      out.push(s);
    }
    return trimSegmentEdges(out);
  }

  // paragraphBreaks (bug 3) can hand a whitespace-only ('\n' from breakParagraph, or a plain
  // ' ' between sibling tags) run its OWN segment carrying a typeform it does not really
  // "belong" to — a styled run whose <p> ends right at a page turn or another element gets an
  // early flush() (e.g. <br/> always flushes first, so "Index of Skills<br/>" inside <em>
  // flushes "Index of Skills" one moment and the bare "\n" the next, both tf-tagged) that the
  // FIRST parse of the source XML never hit, but a SECOND parse of the exported XML does (the
  // exporter writes the '\n' back as a literal <br/> element, forcing that same early flush) —
  // an instability that left the export not a fixed point (same content, different segment
  // shape) though the braille it produces is identical either way. A whitespace-only segment
  // carries no content of its own, so it is folded into a same-format neighbour instead.
  function mergeWhitespaceRuns(segs) {
    if (!Array.isArray(segs) || segs.length < 2) return segs;
    const sameFormat = (a, b) => a.type === 'text' && b.type === 'text' && (a.tf || 0) === (b.tf || 0)
      && !!a.uncontracted === !!b.uncontracted && (a.href || null) === (b.href || null)
      && !!a.cite === !!b.cite && !!a.hyperlink === !!b.hyperlink && !!a.ignoreFont === !!b.ignoreFont && (a.lang || null) === (b.lang || null);
    const out = [];
    for (const s of segs) {
      const prev = out[out.length - 1];
      if (prev && s && s.type === 'text' && prev.type === 'text' && sameFormat(prev, s)) {
        // Collapsing the join the same way inlineSegments' own [^\S\r\n]+ pass already does
        // (spaces/tabs run together, a '\n' kept): two insignificant whitespace-only segments
        // in a row (each already clean on its own — a gap either side of a skipped nested
        // <list>, say) must not simply concatenate into a widening run of plain spaces.
        if (!s.text.trim()) { prev.text = (prev.text + s.text).replace(/[^\S\r\n]+/g, ' '); continue; }   // s is whitespace-only: absorb into prev
        if (!prev.text.trim()) { out[out.length - 1] = { ...s, text: (prev.text + s.text).replace(/[^\S\r\n]+/g, ' ') }; continue; }   // prev was whitespace-only: absorb into s, keep s's own (identical) format
      }
      out.push(s);
    }
    return out;
  }

  function segsHaveEmphOrMath(segs) {
    // A19/A21 Stage 3/4: a segment carrying `.href` (<a href>) or `.cite` (<cite>) must
    // keep its own segments array too, or the block falls back to plain flat text and the
    // href/cite marking (set by walkInline, above) is lost before it ever reaches the exporter.
    // A24: same reasoning for `.transcriberTypeform` (<bai-trans1>…<bai-trans5>, walkInline
    // above) — without this, a block with no other formatting would fall back to plain text
    // and the record of which run lost its typeform would disappear before any caller sees it.
    // 30 Sep: <sub>/<sup> read back as the script markers (walkInline) — a block holding them keeps them too.
    return segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || s.type === 'noteref' || s.type === 'linenum' || s.type === 'brl' || (s.type === 'imgnote' && (s.prodnote || s.uncontracted)) || s.href || s.cite || s.ignoreFont || s.hyperlink || s.transcriberTypeform || s.lang || (s.text && (s.text.includes('\n') || /[\ue000\ue001]/.test(s.text))));
  }

  function segsText(segs) {
    return segs.map((s) => (s.type === 'math' ? (s.latex || '') : (s.text || ''))).join('').replace(/\s+/g, ' ').trim();
  }

  // Page turns before any content → `before`; all others → `after`; `segs` is the content.
  function hoistPagenums(segs, keepEdges = false) {   // keepEdges (A89): the element says xml:space="preserve"
    const before = [], after = [], rest = [];
    let seen = false;
    for (const s of segs) {
      if (s.type === 'pagenum') (seen ? after : before).push(s.block);
      else { seen = true; rest.push(s); }
    }
    return { before, after, segs: keepEdges ? rest : trimSegmentEdges(rest) };
  }

  // Split a paragraph's segments around its page turns and push the pieces:
  // para … pagenum … para(continuation). makeBlock(text, segmentsOrUndefined) builds each
  // piece; pieces on either side of a turn are linked with `continued` / `continuation` so
  // the formatter resumes in cell 1 and the exporter can rejoin them into one <p>.
  function pushParaParts(segs, target, makeBlock) {
    let cur = [];
    let prevPara = null;
    const flushCur = () => {
      const part = trimSegmentEdges(cur);
      cur = [];
      const t = segsText(part);
      if (!t) return;
      const blk = makeBlock(t, segsHaveEmphOrMath(part) && part.length ? part : undefined);
      if (!blk) return;
      if (prevPara) { prevPara.continued = true; blk.continuation = true; }
      target.push(blk);
      prevPara = blk;
    };
    for (const s of segs) {
      if (s.type === 'pagenum') { flushCur(); target.push(s.block); }
      else cur.push(s);
    }
    flushCur();
  }

  // Page turns anywhere under `el` (document order) for elements whose content is only read
  // with getCleanText(); nested block containers listed in `skipTags` handle their own.
  function collectPagenums(el, skipTags = null) {
    const before = [], after = [];
    let seen = false;
    function visit(node) {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          if ((child.nodeValue || '').trim()) seen = true;
        } else if (child.nodeType === 1) {
          const tag = (child.localName || child.tagName || '').toLowerCase();
          if (skipTags && skipTags.has(tag)) continue;
          if (PAGENUM_TAGS.has(tag)) {
            const pn = pagenumBlock(child);
            if (pn) (seen ? after : before).push(pn);
            continue;
          }
          visit(child);
        }
      }
    }
    visit(el);
    return { before, after };
  }

  // Emit one block built from an element's inline content, with its page turns hoisted
  // around it. build(text, segmentsOrUndefined) returns the block (or null to emit nothing).
  function pushAtomic(target, el, build, opts = {}) {
    const pn = hoistPagenums(inlineSegments(el, !!opts.skipLists, opts.excludeTags || null), hasPreserve(el));
    const t = getCleanText(el, opts.excludeTags || null);
    target.push(...pn.before);
    const blk = build(t, segsHaveEmphOrMath(pn.segs) && pn.segs.length ? pn.segs : undefined);
    if (blk) target.push(blk);
    target.push(...pn.after);
  }

  // <imggroup> (A26): one graphic block per image, the group's caption(s) and production
  // note(s) on the first — caption with its inline segments (note references…), the prodnote
  // as the image description (BANA Formats §6.2–6.3). A caption-only group (the exporter's
  // loose figure caption) stays a caption block.
  function parseImgGroup(el, target) {
    const kids = [];
    (function walk(n) {
      for (let k = n.firstChild; k; k = k.nextSibling) {
        if (k.nodeType !== 1) continue;
        const t = (k.localName || k.tagName || '').toLowerCase();
        if (t === 'img' || t === 'image' || t === 'caption' || t === 'prodnote' || PAGENUM_TAGS.has(t)) kids.push([t, k]);
        else walk(k);
      }
    })(el);
    const imgs = kids.filter(([t]) => t === 'img' || t === 'image').map(([, k]) => k);
    const caps = kids.filter(([t]) => t === 'caption').map(([, k]) => k);
    const notes = kids.filter(([t]) => t === 'prodnote').map(([, k]) => k);
    if (!imgs.length && caps.length && !notes.length) {
      for (const cap of caps) pushAtomic(target, cap, (t, segs) => (t ? (segs ? { type: 'caption', text: t, segments: segs } : { type: 'caption', text: t }) : null));
      return;
    }
    const pn = collectPagenums(el);
    target.push(...pn.before);
    const graphics = imgs.map((img) => {
      const src = (img.getAttribute && img.getAttribute('src')) || '';
      const alt = (img.getAttribute && img.getAttribute('alt')) || '';
      const g = { type: 'graphic', src, alt };
      const svg = svgFromDataUri(src);
      if (svg) g.svg = svg;                                  // the editor's tactile graphic
      return g;
    });
    const first = graphics[0] || { type: 'graphic', src: '', alt: (el.getAttribute && el.getAttribute('alt')) || '' };
    if (caps.length) {
      const joined = caps.flatMap((cap, i) => [...(i ? [{ type: 'text', text: ' ' }] : []), ...segsWithoutPagenums(inlineSegments(cap))]);
      const segs = [];                                       // adjacent runs of the same form merge (as a re-parse does)
      for (const g of joined) {
        const last = segs[segs.length - 1];
        if (g.type === 'text' && last && last.type === 'text' && (last.tf || 0) === (g.tf || 0) && !!last.uncontracted === !!g.uncontracted && (last.transcriberTypeform || null) === (g.transcriberTypeform || null)) segs[segs.length - 1] = { ...last, text: last.text + g.text };
        else segs.push(g);
      }
      const text = caps.map((cap) => getCleanText(cap)).filter(Boolean).join(' ');
      if (text) {
        first.caption = text;
        if (segsHaveEmphOrMath(segs)) first.captionSegments = segs;
      }
    }
    // A22/A19 Stage 7: a prodnote's text is usually its own content, but some real-world
    // files (the stage-1 tableOfContents.xml anomaly) put it in a non-standard `description`
    // attribute instead and leave the element empty — read that as a fallback so the note
    // isn't silently dropped (getCleanText(n) alone returns '' for it).
    const noteText = (n) => getCleanText(n) || ((n.getAttribute && n.getAttribute('description')) || '').replace(/\s+/g, ' ').trim();
    const description = notes.map(noteText).filter(Boolean).join(' ');
    // The exporter writes a tactile graphic's alt text as its prodnote: not a separate description.
    if (description && !(first.svg && description === first.alt)) {
      first.description = description;
      // A22: keep an imported render="required" (D6: Emboss's own default, for a description
      // it wrote itself with no source <prodnote> at all, stays "optional" — see nimas-export.mjs).
      if (notes.some((n) => (n.getAttribute && n.getAttribute('render')) === 'required')) first.descriptionRender = 'required';
      // A34: an <imggroup> with more than one <prodnote> used to have their text merged into
      // this single description string, losing the element boundary between two source notes
      // on export (no text lost, just where one note ends and the next begins). Keep each
      // note separately too — descriptions (plural) — so nimas-export.mjs's `case 'graphic':`
      // can write one <prodnote> per entry, each with its own render value; graphic.description
      // (singular, joined) stays exactly as before for every other reader (the braille
      // formatter, docx export, the editor's own display), which is why it is still built above
      // unchanged rather than derived from this array at read time. No `id` field: the source
      // <prodnote>'s own id (when it has one, e.g. tableOfContents.xml's anomaly case) is not
      // written back out by the exporter — carrying it here without exporting it would make a
      // fresh parse -> export -> reparse of the very same document disagree with itself
      // (nimas_roundtrip.test.mjs's own AST-equality check), for a field nothing reads.
      const descEntries = notes.map((n) => {
        const text = noteText(n);
        if (!text) return null;
        const entry = { text };
        if ((n.getAttribute && n.getAttribute('render')) === 'required') entry.render = 'required';
        return entry;
      }).filter(Boolean);
      if (descEntries.length) first.descriptions = descEntries;
    }
    if (!graphics.length) {
      if (first.caption || first.description) target.push(first);
    } else target.push(...graphics);
    target.push(...pn.after);
  }

  // An <imggroup>, or a loose <img>, as graphic blocks.
  function pushImage(target, el) {
    const t = (el.localName || el.tagName || '').toLowerCase();
    if (t === 'imggroup') { parseImgGroup(el, target); return; }
    const src = (el.getAttribute && el.getAttribute('src')) || '';
    const alt = (el.getAttribute && el.getAttribute('alt')) || '';
    const g = { type: 'graphic', src, alt };
    const svg = svgFromDataUri(src);
    if (svg) g.svg = svg;
    target.push(g);
  }

  // The images inside a text element (a heading, a sidebar sentence…): the outermost
  // imggroups and loose imgs, in document order, as graphic blocks (A29).
  function imagesWithin(el) {
    const out = [];
    (function walk(n) {
      for (let k = n.firstChild; k; k = k.nextSibling) {
        if (k.nodeType !== 1) continue;
        if (IMAGE_TAGS.has((k.localName || k.tagName || '').toLowerCase())) pushImage(out, k);
        else walk(k);
      }
    })(el);
    return out;
  }

  // A DTBook <note> is always a footnote or endnote (transcriber's notes are <prodnote>):
  // kept with its id (the target of <noteref>) and its inline segments.
  //
  // F-113 / BANA 16.5.1d ("for additional paragraphs in a note, use 5-3 margins") / B004 D
  // ("notes containing more than one paragraph are treated as such"): a <note> with more
  // than one direct <p> child keeps each <p> as its own paragraph block (blk.blocks), the
  // shape formatFootnote already renders with the second-paragraph 5-3 indent — instead of
  // getCleanText() flattening every <p> into one joined string with the paragraph break
  // discarded. A note with a single <p> (the common case) keeps the plain text/segments
  // shape unchanged.
  function pushNote(target, el) {
    const cls = ((el.getAttribute && el.getAttribute('class')) || '').toLowerCase();
    const id = (el.getAttribute && el.getAttribute('id')) || '';
    const kind = (cls.includes('endnote') || cls.includes('rearnote')) ? 'endnote' : null;
    const directPs = [...el.childNodes].filter((c) => c.nodeType === 1 && (c.localName || c.tagName || '').toLowerCase() === 'p');
    if (directPs.length > 1) {
      const paras = directPs.map((p) => {
        const t = getCleanText(p, NOTE_SPLIT_TAGS);
        if (!t) return null;
        const segs = inlineSegments(p, false, NOTE_SPLIT_TAGS);
        const para = { type: 'para', text: t };
        if (segsHaveEmphOrMath(segs) && segs.length) para.segments = segs;
        return para;
      }).filter(Boolean);
      if (paras.length) {
        const blk = { type: 'footnote', blocks: paras };
        if (id) blk.id = id;
        if (kind) blk.kind = kind;
        target.push(blk);
      }
    } else {
      pushAtomic(target, el, (t, segs) => {
        if (!t) return null;
        const blk = { type: 'footnote', text: t };
        if (segs) blk.segments = segs;
        if (id) blk.id = id;
        if (kind) blk.kind = kind;
        return blk;
      }, { excludeTags: NOTE_SPLIT_TAGS });
    }
    // A note's tables and images follow it as their own blocks (A2).
    (function split(n) {
      for (let k = n.firstChild; k; k = k.nextSibling) {
        if (k.nodeType !== 1) continue;
        const t = (k.localName || k.tagName || '').toLowerCase();
        if (t === 'table') parseTable(k, target);
        else if (IMAGE_TAGS.has(t)) pushImage(target, k);
        else split(k);
      }
    })(el);
  }
  const NOTE_SPLIT_TAGS = new Set(['table', 'imggroup', 'img', 'image']);

  // Same for elements read only with getCleanText() (notes, captions, definitions…).
  function pushTextOnly(target, el, build, skipTags = null) {
    const pn = collectPagenums(el, skipTags);
    target.push(...pn.before);
    const blk = build(getCleanText(el));
    if (blk) target.push(blk);
    target.push(...pn.after);
  }

  // F-164 / BANA 3.2.1b: a <prodnote> with several <p> is ONE transcriber's note of several
  // paragraphs. `build(text)` makes the note block exactly as pushTextOnly's callers always did
  // (text = the flattened text, so every reader that ignores `blocks` behaves as before); when
  // the note has more than one non-empty direct <p>, the block also carries
  // `blocks: [{type:'para', text, segments?}, …]` -- the same shape a multi-paragraph footnote
  // uses (F-113) -- which formatTranscriberNote, nimas-export and the editor honour.
  function pushProdnote(target, el, build) {
    const ps = [...el.childNodes].filter((c) => c.nodeType === 1 && (c.localName || c.tagName || '').toLowerCase() === 'p');
    const paras = ps.length > 1 ? ps.map((p) => {
      const t = getCleanText(p);
      if (!t) return null;
      const segs = inlineSegments(p);
      const para = { type: 'para', text: t };
      if (segsHaveEmphOrMath(segs) && segs.length) para.segments = segs;
      return para;
    }).filter(Boolean) : [];
    if (paras.length < 2) {
      // A one-paragraph note keeps its emphasis and maths too (A89, random-action testing: bold put into a table's transcriber's
      // note was saved, then read back as plain text).
      const one = ps.length === 1 ? ps[0] : el;
      const segs = inlineSegments(one);
      const keep = segs.length && segsHaveEmphOrMath(segs) ? segs : null;
      pushTextOnly(target, el, (t) => { const blk = build(t); if (blk && keep && blk.text) blk.segments = keep; return blk; });
      return;
    }
    pushTextOnly(target, el, (t) => {
      const blk = build(t);
      if (blk) blk.blocks = paras;
      return blk;
    });
  }

  const PHONETIC_KEY_REGEX = /\(([a-zA-Z\u0080-\u02FF\u0300-\u036F\u0400-\u04FF\s\u00B4\u0060\-\/]+)\)/g;
  function isPhoneticKey(inner) {
    if (!inner || !inner.includes('-')) return false;
    return /[\u00B4\u0060\u02C8\u02CC\u0300-\u036F\u04D0-\u04D9\u0100-\u024F\u0250-\u02AFāăēĕīĭōŏūŭəәǝ]/i.test(inner);
  }

  function splitPhoneticSegments(segs) {
    const result = [];
    for (const seg of segs) {
      if (!seg || seg.type !== 'text' || seg.uncontracted || !seg.text) {
        result.push(seg);
        continue;
      }
      const str = seg.text;
      PHONETIC_KEY_REGEX.lastIndex = 0;
      let match;
      let lastIdx = 0;
      let hasPhonetic = false;
      while ((match = PHONETIC_KEY_REGEX.exec(str)) !== null) {
        if (isPhoneticKey(match[1])) {
          hasPhonetic = true;
          const before = str.slice(lastIdx, match.index);
          if (before) {
            const s = { type: 'text', text: before };
            if (seg.tf) s.tf = seg.tf;
            result.push(s);
          }
          const pSeg = { type: 'text', text: match[0], uncontracted: true };
          if (seg.tf) pSeg.tf = seg.tf;
          result.push(pSeg);
          lastIdx = match.index + match[0].length;
        }
      }
      if (hasPhonetic) {
        const after = str.slice(lastIdx);
        if (after) {
          const s = { type: 'text', text: after };
          if (seg.tf) s.tf = seg.tf;
          result.push(s);
        }
      } else {
        result.push(seg);
      }
    }
    return result;
  }

  // paragraphBreaks (bug 3 / real-book-validation-24sep.md): a list item read as one flat run
  // merged several <p>/<br/> into a single paragraph (109 items across the three real books,
  // e.g. three separate exercise prompts run together as one). formatList (document.mjs) has
  // no multi-paragraph item shape of its own (unlike a note's block.blocks, F-113/16.5.1d) but
  // a literal '\n' inside item.segments IS already understood everywhere a <br/> puts one there
  // — groupSegments splits a text run's g.lines on '\n' (document.mjs) and wrapCells forces a
  // line break at it (layout.mjs) — so a <p>/block-child boundary inside a list item reuses
  // exactly that shape instead of the plain word-space breakWord() below. Opt-in (only the
  // list-item readers pass true) so every other caller (paragraphs, notes, table cells,
  // headings…) keeps its existing "block child = one word space" behaviour unchanged.
  function inlineSegments(el, skipLists = false, excludeTags = null, imageAsNote = false, paragraphBreaks = false) {
    const hasExclude = excludeTags && typeof excludeTags.has === 'function';
    const elTag = (el.localName || el.tagName || '').toLowerCase();
    const segments = [];
    let text = '';
    let curTf = 0;
    let curUnc = false;
    let curLang = null;                                  // foreign language (xml:lang) of the accumulating run — recorded only (input/lang.mjs)

    function flush() {
      if (text) {
        // A run that begins with a space right after one that ends with a space (a link or emphasis run
        // inside prose): one space, taken off the earlier run, so the saved file re-reads to the same text.
        const prev = segments[segments.length - 1];
        if (prev && prev.type === 'text' && text.startsWith(' ') && /(^|[^\n]) $/.test(prev.text || '')) {   // a line break (\n, from <br/>) is not a space
          prev.text = prev.text.replace(/ +$/, '');
          if (!prev.text) segments.pop();
        }
        const seg = { type: 'text', text };
        if (curTf) seg.tf = curTf;
        if (curUnc) seg.uncontracted = true;
        if (curLang) seg.lang = curLang;
        segments.push(seg);
        text = '';
      }
    }

    // A block-level child (a <p> or <div> in a list item…) is a word boundary (A2: "amberbq").
    function breakWord() {
      if (text) { if (!/\s$/.test(text)) text += ' '; return; }
      const last = segments[segments.length - 1];
      if (last && last.type === 'text' && last.text && !/\s$/.test(last.text)) last.text += ' ';
    }
    // Same, but a genuine paragraph break (bug 3 above): a forced '\n', not a plain space —
    // the same mark <br/> already writes below. Idempotent against a boundary that already
    // ends in '\n' (two block children in a row must not open a blank line between them; a
    // list item has no "blank line between paragraphs" shape at all, matching plain <br/>).
    function breakParagraph() {
      // Only genuine content ends with a paragraph break. A run of pure whitespace in `text`
      // (or the last flushed segment) is not a paragraph's own trailing text — it is an
      // insignificant text node between sibling tags in the source markup (e.g. the newline
      // DTBook/BrailleBlaster puts between <p>, <pagenum> and <p> siblings for readability) —
      // so it is left exactly as breakWord() would leave it (a single joining space, or
      // untouched if it already ends in whitespace), never turned into a break of its own.
      // paragraphBreaks === 'blocks' (list items, see ITEM_PARA_SEP): the break is a paragraph separator the caller
      // splits the item on (its further paragraphs become item.blocks), not a '\n' line break inside one paragraph.
      const mark = paragraphBreaks === 'blocks' ? ITEM_PARA_SEP : '\n';
      if (text) {
        if (text.endsWith('\n') || text.endsWith(ITEM_PARA_SEP)) return;   // already broken (e.g. an earlier call on the same accumulator)
        if (/\S/.test(text)) text = text.replace(/[ \t]+$/, '') + mark;
        else if (mark === ITEM_PARA_SEP) {
          // Only source whitespace since the last run (the paragraph ended in a link, emphasis...): the break still counts.
          const lastSeg = segments[segments.length - 1];
          const broken = lastSeg && lastSeg.type === 'text' && /[\n\ue010]$/.test(lastSeg.text || '');
          if (!broken && segments.some((g) => g.type !== 'text' || /\S/.test(g.text || ''))) text = ITEM_PARA_SEP;
        }
        else if (!/\s$/.test(text)) text += ' ';
        return;
      }
      const last = segments[segments.length - 1];
      if (last && last.type === 'text' && last.text && /\S/.test(last.text) && !last.text.endsWith('\n') && !last.text.endsWith(ITEM_PARA_SEP)) last.text = last.text.replace(/[ \t]+$/, '') + mark;
      else if (mark === ITEM_PARA_SEP && last && last.type !== 'text' && last.type !== 'itemblock') segments.push({ type: 'text', text: ITEM_PARA_SEP });   // a paragraph ending in maths
    }

    let pendingScript = '';                              // a <sub>/<sup> opening marker waiting for its first text (walkInline)
    function walkInline(node, parentTf, parentUnc) {
      const parentTag = (node.localName || node.tagName || '').toLowerCase();
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          let val = child.nodeValue;
          if (val) {
            val = val.replace(/\s+/g, ' ');
            const lg = markupForeignLang(child.parentNode);   // nearest xml:lang (input/lang.mjs)
            if (parentTf !== curTf || parentUnc !== curUnc || lg !== curLang) {
              flush();
              curTf = parentTf;
              curUnc = parentUnc;
              curLang = lg;
            }
            if (text.endsWith(' ') && val.startsWith(' ')) {
              val = val.slice(1);
            }
            if (pendingScript && val.trim()) { text += pendingScript; pendingScript = ''; }   // a <sub>/<sup>'s opening marker, with its first text
            text += val;
          }
        } else if (child.nodeType === 1) {
          const tag = (child.localName || child.tagName || '').toLowerCase();
          const cls = (child.getAttribute ? (child.getAttribute('class') || '') : '').toLowerCase();
          if (tag === 'table' && paragraphBreaks === 'blocks') {   // a table inside a list item: one of the item's blocks, where it stands
            flush();
            segments.push({ type: 'itemblock', el: child });
            continue;
          }
          // a code block among the item's blocks (saved as <p class="bana-code">, lines split by <br/>): one of its blocks too, read
          // back as code as the top-level reader reads it (found merging the Markdown reader, 1 Oct)
          if (tag === 'p' && paragraphBreaks === 'blocks' && /(^|\s)bana-code(\s|$)/.test(cls)) {
            flush();
            segments.push({ type: 'itemblock', el: child });
            continue;
          }
          // #50: a quotation among the item's blocks (saved as <blockquote><p class="quote">): one of its blocks, read back as quotation
          // paragraphs (it was read as ordinary text, the quote style lost)
          if (tag === 'blockquote' && paragraphBreaks === 'blocks') {
            flush();
            segments.push({ type: 'itemblock', el: child });
            continue;
          }
          if (tag === 'table' || tag === 'sidebar' || tag === 'brl' || (skipLists && (tag === 'list' || tag === 'ul' || tag === 'ol'))) continue;
          if (hasExclude && excludeTags.has(tag)) {
            // BANA Formats §10.11.1 ("An embedded transcriber's note (TN) with a brief
            // description is used in material that is partially or totally pictures",
            // Example 10-31: `,! @.<butt]fly@.> flew s\? = ! w9t]4` for print "The
            // [picture of a] butterfly flew south for the winter."): an exercise item's
            // own <img>/<image> becomes an embedded-TN segment right where it sat, not a
            // silently dropped word — only when the caller opts in (imageAsNote) and the
            // image actually has a description to show; a decorative image with no alt
            // text is still just a word boundary, as before.
            if (imageAsNote && (tag === 'img' || tag === 'image')) {
              const alt = ((child.getAttribute && child.getAttribute('alt')) || '').replace(/\s+/g, ' ').trim();
              if (alt) {
                flush();
                const seg = { type: 'imgnote', text: alt };
                if (/(^|\s)bana-uncontracted(\s|$)/.test(cls)) seg.uncontracted = true;
                if (/(^|\s)bana-span-typeform(\s|$)/.test(cls)) seg.spanTypeform = true;
                const src = (child.getAttribute && child.getAttribute('src')) || '';
                if (src) seg.src = src;                        // round-trip only (A29/A26 convention); not rendered
                segments.push(seg);
                continue;
              }
            }
            if (IMAGE_TAGS.has(tag)) breakWord();
            continue;
          }   // "kr<img/>n" is not "krn"
          if (PAGENUM_TAGS.has(tag)) {
            flush();
            const pn = pagenumBlock(child);
            if (pn) segments.push({ type: 'pagenum', block: pn });
            continue;
          }
          let nextTf = parentTf;
          let nextUnc = parentUnc;

          if (tag === 'linenum' || cls.includes('linenum') || cls.includes('line-number')) {
            // A print line number in prose (BANA Formats §15.4; A30) is kept as a segment.
            const num = (child.textContent || '').replace(/\s+/g, ' ').trim();
            if (num && !inVerseLine(child)) {
              flush();
              segments.push({ type: 'linenum', text: num });
            }
            continue;
          }
          if (tag === 'img' || tag === 'image') { breakWord(); continue; }
          if (tag === 'span' && /(^|\s)bana-ignore-font(\s|$)/.test(cls)) {           // one run whose font is not brailled (exporter's seg.ignoreFont)
            flush();
            const before = segments.length;
            walkInline(child, nextTf, nextUnc);
            flush();
            for (let k = before; k < segments.length; k++) if (segments[k] && segments[k].type === 'text') segments[k].ignoreFont = true;
            continue;
          }
          if (tag === 'span' && /(^|\s)bana-hyperlink(\s|$)/.test(cls)) {            // F-233: braille hyperlink indicator (exporter's seg.hyperlink)
            flush();
            const before = segments.length;
            walkInline(child, nextTf, nextUnc);
            flush();
            for (let k = before; k < segments.length; k++) if (segments[k] && segments[k].type === 'text') segments[k].hyperlink = true;
            continue;
          }
          if (tag === 'span' && /(^|\s)bana-label(\s|$)/.test(cls)) continue;      // a list item's exercise label (read back by the list reader)
          if (tag === 'span' && /(^|\s)bana-brl(\s|$)/.test(cls)) {                  // literal braille cells written by the exporter
            flush();
            segments.push({ type: 'brl', brl: (child.getAttribute && child.getAttribute('title')) || '', text: child.textContent || '' });
            continue;
          }

          // F-S4-02 / BANA 3.2.3: a <prodnote> inside a <p> is an embedded transcriber's note.
          // Keep it as an embedded-note segment (like the F-229 picture note) that remembers it
          // came from a <prodnote>, so it is enclosed as a TN in braille and saved back inline.
          if (tag === 'prodnote' && elTag === 'p') {
            const noteText = (child.textContent || '').replace(/\s+/g, ' ').trim();
            if (noteText) {
              if (text && !text.endsWith(' ')) text += ' ';        // a note is a word boundary on both sides
              flush();
              const seg = { type: 'imgnote', text: noteText, prodnote: true };
              const rd = (child.getAttribute && child.getAttribute('render')) || '';
              if (rd) seg.render = rd;
              if (/(^|\s)bana-uncontracted(\s|$)/.test(cls)) seg.uncontracted = true;
              if (/(^|\s)bana-span-typeform(\s|$)/.test(cls)) seg.spanTypeform = true;
              segments.push(seg);
              // LINK-2 fallout fix: the boundary space just set below is neutral prose, not a
              // continuation of whatever inline typeform (e.g. underline, LINK-2's own new
              // source of one right before a note in the real corpus — "outlined in Table
              // One" + a §10.6.1 blank-to-fill-in note) the LAST run before the note carried.
              // Nothing above resets curTf/curUnc for this branch (every OTHER branch here
              // either recurses through walkInline, which re-syncs curTf against its own
              // parentTf on the next text node, or never sets `text` directly the way this one
              // does) — so without this, the stray space (and, via flush()'s "prev ends in
              // space" merge, the run right after it) silently inherited that leftover
              // typeform. Reset to this call's own ambient tf/uncontracted (parentTf/parentUnc)
              // instead of the run that happened to precede the note.
              curTf = parentTf; curUnc = parentUnc;
              text = ' ';
              continue;
            }
          }

          // Separate list-item components and inline production notes from the text around them.
          const spaced = tag === 'lic' || tag === 'prodnote' || tag === 'annotation';
          if (spaced && text && !text.endsWith(' ')) {
            flush();
            text += ' ';
          }

          const unlinkedRef = tag === 'span' && /(^|\s)(noteref|annoref)(\s|$)/.test(cls);   // the exporter's unlinked reference
          if (tag === 'noteref' || tag === 'annoref' || unlinkedRef) {
            // A note reference keeps its mark and target (A5): braille superscripts it
            // (BANA Formats §16.2.2) and the save writes it back as <noteref>.
            const mark = (child.textContent || '').replace(/\s+/g, ' ').trim();
            // BrailleBlaster's own files put the target in @id; DTBook uses @idref="#…".
            const idref = String((child.getAttribute && (child.getAttribute('idref') || child.getAttribute('id'))) || '').replace(/^#/, '');
            if (mark) {
              flush();
              const seg = { type: 'noteref', text: mark };
              if (idref) seg.idref = idref;
              if (tag === 'annoref' || (unlinkedRef && cls.includes('annoref'))) seg.annoref = true;
              segments.push(seg);
            }
            continue;
          }
          if (tag === 'a') {
            // A19/A21 Stage 3: an <a href> survives a save. The braille formatter still
            // ignores it (renders the link text as ordinary text, as today) because we only
            // stamp `.href` onto the produced text segment(s) — nothing reads that field
            // except nimas-export's serializeInlineSegments, which re-wraps a contiguous run
            // sharing the same href in one <a href="…">. An <a> with no href is unaffected:
            // it falls through to the generic inline handling below, exactly as before.
            const href = (child.getAttribute && child.getAttribute('href')) || null;
            if (href) {
              flush();
              const before = segments.length;
              walkInline(child, nextTf, nextUnc);
              flush();
              for (let k = before; k < segments.length; k++) {
                if (segments[k] && segments[k].type === 'text') segments[k].href = href;
              }
              continue;
            }
          }
          if (tag === 'cite') {
            // A19/A21 Stage 4: same shape as Stage 3's link fix — mark the produced text
            // segment(s) so the exporter can re-wrap them in <cite>…</cite>.
            flush();
            const before = segments.length;
            walkInline(child, nextTf, nextUnc);
            flush();
            for (let k = before; k < segments.length; k++) {
              if (segments[k] && segments[k].type === 'text') segments[k].cite = true;
            }
            continue;
          }
          // A24: BrailleBlaster's own <bai-trans1>…<bai-trans5> elements. A `<span
          // class="bai-transN">` is read the same leniently, though nimas-export.mjs (below)
          // deliberately never writes one back — like the rest of A24, the PRINT MEANING of
          // bai-trans1-5 is unknown to Emboss (Emboss's own strikethrough is a separate value,
          // 'strike', never one of these bai-transN tag names), so a save
          // keeps the run's plain text and lets the typeform tag go rather than round-trip a
          // label whose meaning Emboss cannot vouch for a second time
          // (braille_blaster_import.test.mjs, "keeps its text and records the loss"; a save
          // must also never contain the literal BrailleBlaster element, assertNoBaiElements).
          const baiTransSpan = tag === 'span' ? /(^|\s)(bai-trans[1-5])(\s|$)/.exec(cls) : null;
          const baiTransTag = /^bai-trans[1-5]$/.test(tag) ? tag : (baiTransSpan ? baiTransSpan[2] : null);
          if (baiTransTag) {
            // The five BANA-5.1.4/5.5.1–5.5.3/5.9.1 "transcriber-defined typeform" runs UEB
            // reserves after italic/bold/underline/script (standards-map.md BANA 5.5.1/5.5.2,
            // F-86/F-87). Rather than drop the run's content, or silently borrow bold/italic/
            // underline (braille the source never asked for), keep the run as plain, contracted
            // text and tag every text segment it produced with the source element name, so the
            // loss is visible to a caller/test instead of silent (task requirement: "keep the
            // text and record what was lost").
            flush();
            const before = segments.length;
            walkInline(child, nextTf, nextUnc);
            flush();
            for (let k = before; k < segments.length; k++) {
              if (segments[k] && segments[k].type === 'text') segments[k].transcriberTypeform = baiTransTag;
            }
            continue;
          }
          // UEB 9.5.1 round-trip: nimas-export.mjs writes Emboss's own strikethrough as
          // `<span class="strikethrough">` (the same "span carries a class" shape as its
          // noteref/annoref/uncontracted spans above); `<s>`/`<strike>`/`<del>` are read the
          // same way in case a DTBook file from elsewhere uses them directly (parity with
          // parseHtml's own reading of those tags). Unlike bai-trans1-5 above, the meaning IS
          // known here (Emboss's own default: crossed-out text), so it is always 'strike', not
          // the source tag name. (A file saved before this slot split could in principle still
          // hold a bare 'trans1' value from `<span class="strikethrough">` — there should be
          // none yet — but that shape is never written any more and is not specially read back;
          // the class-based span above is what round-trips.)
          if (tag === 's' || tag === 'strike' || tag === 'del' || (tag === 'span' && /(^|\s)strikethrough(\s|$)/.test(cls))) {
            flush();
            const before = segments.length;
            walkInline(child, nextTf, nextUnc);
            flush();
            for (let k = before; k < segments.length; k++) {
              if (segments[k] && segments[k].type === 'text') segments[k].transcriberTypeform = 'strike';
            }
            continue;
          }
          // <sub>/<sup> (DTBook's own, and what nimas-export writes for the sub/superscript markers since 30 Sep):
          // read back into the same markers (format/text-style.mjs SCRIPT_MARKS) the other readers produce.
          if (tag === 'sub' || tag === 'sup') {
            // The opening marker waits for the first text inside (see pendingScript), so it lands in the same segment as
            // the text it raises or lowers even when that text is bold (<sup><strong>1</strong></sup>); an empty run
            // leaves no marker at all.
            pendingScript = tag === 'sub' ? SCRIPT_MARKS.subOpen : SCRIPT_MARKS.supOpen;
            walkInline(child, nextTf, nextUnc);
            if (pendingScript) pendingScript = '';
            else text += SCRIPT_MARKS.end;
            continue;
          }
          if (tag === 'b' || tag === 'strong') nextTf |= TF_BOLD;
          else if (tag === 'i' || tag === 'em') nextTf |= TF_ITALIC;
          else if (tag === 'u' || cls.includes('underline')) nextTf |= TF_UNDERLINE;
          // K5 / UEB §9: nimas-export.mjs's own round-trip convention (serializeInlineLeaf)
          // writes Emboss's script typeform as `<span class="script">`; a bare `<script>` tag
          // (DTBook has no native element of that name, so no ambiguity) is read the same
          // leniently, matching how a bare `<u>` is read alongside `class="underline"` above.
          else if (tag === 'script' || /(^|\s)script(\s|$)/.test(cls)) nextTf |= TF_SCRIPT;
          else if (tag === 'code' || cls.includes('uncontracted') || cls.includes('bai-trans4') || cls.includes('phonetic') || cls.includes('pronunciation') || cls.includes('pron') || cls.includes('ipa')) nextUnc = true;
          else if (tag === 'br') {
            flush();
            text += '\n';
            continue;
          } else if (tag === 'math' || tag.endsWith(':math')) {
            flush();
            let mathml = mathOuterXml(child);
            const alttext = child.getAttribute ? child.getAttribute('alttext') : null;
            let latex = alttext || null;
            const ann = child.getElementsByTagName ? [...child.getElementsByTagName('annotation'), ...child.getElementsByTagName('m:annotation')] : [];
            const texAnn = ann.find(a => (a.getAttribute ? (a.getAttribute('encoding') || '') : '').includes('tex'));
            if (texAnn && texAnn.textContent) latex = texAnn.textContent.trim();
            if (texAnn && mathml) mathml = texOnlyMathToMathML(mathml, latex) || mathml;   // A89: an equation holding only its TeX is converted (Temml), or marked unreadable
            if (!latex && mathml) latex = mathmlToLatex(mathml);
            const mathSeg = { type: 'math', mathml };
            if (latex) mathSeg.latex = latex;
            segments.push(mathSeg);
            continue;
          }
          const blockChild = !spaced && tag !== 'br' && BLOCK_TAGS.has(tag) && !(INLINE_IN_TEXT.has(tag) && TEXT_PARENTS.has(parentTag));
          const brk = (paragraphBreaks && tag === 'p') ? breakParagraph : breakWord;
          if (blockChild) brk();
          walkInline(child, nextTf, nextUnc);
          if (blockChild) brk();
          if (spaced && (tag === 'prodnote' || tag === 'annotation') && text && !text.endsWith(' ')) text += ' ';
        }
      }
    }

    walkInline(el, 0, false);
    flush();
    const split = splitPhoneticSegments(segments);
    for (const seg of split) {
      if (seg.type === 'text' && seg.text) {
        seg.text = seg.text.replace(/[^\S\r\n]+/g, ' ');
      }
    }
    return hasPreserve(el) ? split : trimSegmentEdges(split);   // A89: xml:space="preserve" keeps the edge spaces
  }

  function getElementLevel(node) {
    if (!node || !node.getAttribute) return 0;
    const cls = (node.getAttribute('class') || '').toLowerCase();
    const match = cls.match(/\blevel-(\d+)\b/) || cls.match(/\btoc-level-(\d+)\b/);
    if (match) return parseInt(match[1], 10) || 0;
    const attr = node.getAttribute('level');
    if (attr) return parseInt(attr, 10) || 0;
    return 0;
  }

  // K32 / BANA 21.2.3: an index/glossary "alphabetical division" is a paragraph whose whole
  // text is a single letter, its print capital-and-lowercase pair, or a short range ("A",
  // "A a", "A-B") — DTBook always marks it bold, even though print treats it as a heading
  // (§21.2.3a: "Center alphabetical division letters"), not body text. Recognised
  // conservatively: this is the ONLY test — no class, no ancestor check — so it is applied
  // only where a division letter can actually occur (see the two uses below).
  const DIVISION_LETTER_PARA_RE = /^\p{L}(\s\p{L}|\s?[-–—]\s?\p{L})?$/u;
  const isDivisionLetterParaText = (t) => DIVISION_LETTER_PARA_RE.test(String(t || '').trim());
  // Remembers which <list> elements this parseDtbook call already classified as an index
  // division (isIndex, below) — so a LATER division of the SAME index, separated from the
  // first only by its own division-letter paragraph (never by anything else), can be
  // recognised too. See the backward walk inside parseSingleList: "an earlier division of
  // the same index" tunnels through one of these instead of stopping at the first list it meets.
  const listIsIndexDivision = new WeakMap();

  function parseSingleList(child, listLvl = 0, targetBlocks = blocks, parentKind = null) {
    const listClass = (child.getAttribute ? child.getAttribute('class') : '') || '';
    const listTypeAttr = (child.getAttribute ? child.getAttribute('type') : '') || '';
    const isOl = listTypeAttr.toLowerCase() === 'ordered' || listTypeAttr.toLowerCase() === 'ol' || (child.getAttribute && child.getAttribute('enum') != null);
    // @enum ("a"/"A"/"i"/"I") picks letters/roman numerals over plain digits when a
    // marker has to be synthesized below (A31: nimas-export writes it for a clean
    // nested run instead of embedding the marker text in every item).
    const enumAttr = (child.getAttribute && child.getAttribute('enum')) || null;

    // Check for child <hd> / heading inside <list> and emit it as a preceding heading
    for (let c = child.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const cTag = (c.localName || c.tagName || '').toLowerCase();
      if (cTag === 'hd' || cTag === 'title' || /^h[1-6]$/.test(cTag)) {
        if (targetBlocks) pushAtomic(targetBlocks, c, (t, segs) => (t ? (segs ? { type: 'heading', level: 3, text: t, segments: segs } : { type: 'heading', level: 3, text: t }) : null));
      }
    }
    
    let isToc = listClass.toLowerCase().includes('toc') || (child.getAttribute && (child.getAttribute('id') || '').toLowerCase().includes('toc'));
    let isIndex = listClass.toLowerCase().includes('index') || (child.getAttribute && (child.getAttribute('id') || '').toLowerCase().includes('index'));
    if (!isToc && !isIndex) {
      // Check parent container (e.g., <level1 class="toc"> or <sidebar id="toc"> or previous sibling heading)
      let p = child.parentNode;
      while (p && p.nodeType === 1) {
        const pCls = (p.getAttribute ? (p.getAttribute('class') || '') : '').toLowerCase();
        const pId = (p.getAttribute ? (p.getAttribute('id') || '') : '').toLowerCase();
        if (pCls.includes('toc') || pId.includes('toc')) {
          isToc = true;
          break;
        }
        if (pCls.includes('index') || pId.includes('index')) {
          isIndex = true;
          break;
        }
        const pTag = (p.localName || p.tagName || '').toLowerCase();
        if (/^level[1-6]$/.test(pTag) || pTag === 'sidebar' || pTag === 'div' || pTag === 'section') {
          // Check preceding sibling headings inside the container. A contents/index heading
          // governs only the list that directly follows it: once another list (or table/box)
          // intervenes, this one is ordinary — UNLESS what intervenes is only a chain of
          // (division-letter paragraph, earlier division of the SAME index) pairs (K32 / BANA
          // 21.2.3): the anthology's "Index of Titles and Authors" repeats
          // <p><strong>B</strong></p><list type="pl">... for every letter, and only the first
          // division's list sits right after the heading — every later one must still be
          // recognised as the same index, or it renders as an ordinary list (wrong margins, no
          // guide words, no BANA 21.2.1a "start on a new page" grouping). `listIsIndexDivision`
          // (set just below, once isIndex is known) remembers a division's own answer so a later
          // sibling can walk straight through it instead of stopping there.
          for (let sib = child.previousSibling; sib; sib = sib.previousSibling) {
            if (sib.nodeType !== 1) continue;
            const sTag = (sib.localName || sib.tagName || '').toLowerCase();
            if (sTag === 'p' && isDivisionLetterParaText(getCleanText(sib))) continue;   // transparent: a division letter of the same index
            if (sTag === 'list') {
              if (listIsIndexDivision.get(sib)) continue;   // an earlier division of the same index: keep looking back through it
              break;
            }
            if (sTag === 'dl' || sTag === 'table' || sTag === 'sidebar') break;
            if (sTag === 'hd' || /^h[1-6]$/.test(sTag)) {
              const hdText = getCleanText(sib).toLowerCase();
              if (/^index\b/i.test(hdText)) isIndex = true;
              if (/^(table of contents|contents|toc)$/i.test(hdText) || /^contents\b/i.test(hdText)) isToc = true;
              break;
            }
            break;
          }
          break;
        }
        p = p.parentNode;
      }
    }
    // Index components (<lic class="index-line">/<lic class="index-pg">) make an index (A2).
    if (!isToc && !isIndex) {
      isIndex = [...(child.childNodes || [])].some((li) => li.nodeType === 1 && [...(li.childNodes || [])].some((c) => c.nodeType === 1
        && (c.localName || c.tagName || '').toLowerCase() === 'lic' && /(^|[-_\s])index([-_\s]|$)/.test(((c.getAttribute && c.getAttribute('class')) || '').toLowerCase())));
    }
    // K32: a nested <list> (subentries) inherits its enclosing item's own index/toc-ness — its
    // own ancestor walk above only ever sees as far back as the <li> that holds it, never the
    // heading that governs the whole reference (see the recursive parseSingleList calls below,
    // which pass the parent's own detectedKind down as `parentKind`).
    if (!isToc && !isIndex && parentKind === 'toc') isToc = true;
    if (!isToc && !isIndex && (parentKind === 'index' || parentKind === 'glossary')) isIndex = true;
    if (isIndex) listIsIndexDivision.set(child, true);
    // A DTBook source can mark exercise material with class="bai-exercise" on the whole
    // <list> (one class, applying to every <li>) or on each <li> individually — the
    // per-item check below already handles the latter; this handles the former so a real
    // `<list class="bai-exercise" type="ol">` with plain, unclassed <li> children still
    // takes the exercise-item path (BANA §10.11, F-229) instead of falling through to an
    // ordinary numbered list that drops any inline <img>.
    const listIsExercise = listClass.toLowerCase().includes('bai-exercise');
    let items = [];
    let counter = isOl ? (parseInt((child.getAttribute && child.getAttribute('start')) || '1', 10) || 1) : 1;   // DTBook @start
    let detectedKind = isToc ? 'toc' : (isIndex ? 'index' : (listTypeAttr.toLowerCase() === 'pl' ? 'plain' : null));
    // K32 / BANA 21.2.3a: a print alphabetical division letter arrives as an ordinary bold
    // paragraph (isDivisionLetterParaText, above), not a heading. Recognised here, conservatively,
    // as a plain paragraph matching that shape, directly before the index/glossary list it
    // introduces (the most recently pushed block, since sibling blocks are pushed in document
    // order) — converted in place to a heading so the formatter's own division-letter rules
    // (isDivisionLetterBeforeReference, joinsWithoutBlank in document.mjs) apply to it. The bold
    // itself is print's own way of marking a heading, not braille styling to keep — 21.2.3e's
    // "follow print for capitalization" is still honoured, by the plain uppercase translation
    // every heading gets. Shares the level of the reference's own title heading (or the nearest
    // heading above, for a later division) so it lands in the same BANA tier (centred).
    if ((detectedKind === 'index' || detectedKind === 'glossary') && targetBlocks && targetBlocks.length) {
      const prevBlock = targetBlocks[targetBlocks.length - 1];
      if (prevBlock && prevBlock.type === 'para' && !prevBlock.blocked && isDivisionLetterParaText(prevBlock.text)
        && (!Array.isArray(prevBlock.segments) || prevBlock.segments.every((s) => s && s.type === 'text' && !s.href))) {
        let lvl = 1;
        for (let k = targetBlocks.length - 2; k >= 0; k--) {
          const pb = targetBlocks[k];
          if (pb && pb.type === 'heading') { lvl = pb.level || 1; break; }
        }
        prevBlock.type = 'heading';
        prevBlock.level = lvl;
        delete prevBlock.segments;
      }
    }
    let lastTopItem = null;

    // Print page turns (and tables) inside a list: a list cannot hold a pagenum or table block, so the list is
    // split around it (BANA §8.3.3b puts a blank line between the indicator and a list
    // anyway). Nested calls (targetBlocks === null) cannot emit blocks, so they hand the
    // turn up to the parent as a `{ pagenum }` marker item.
    const emitListBlock = () => {
      if (items.length && targetBlocks) {
        annotateGroup(items.filter((g) => !g.pagenum));   // the chunk's shallowest items (annotateGroup narrows them): a chunk that starts inside a sub-list is a group of its own
        const listBlock = { type: 'list', items };
        if (detectedKind) {
          listBlock.kind = detectedKind;
          listBlock.style = detectedKind;
        }
        if (isOl && detectedKind !== 'toc' && detectedKind !== 'index') listBlock.ordered = true;   // contents and index lists are not numbered
        targetBlocks.push(listBlock);
        items = [];
      }
    };
    const emitPagenum = (pn) => {
      if (!pn) return;
      if (targetBlocks) { emitListBlock(); targetBlocks.push(pn); }
      else items.push({ pagenum: pn });
    };
    const addSubItems = (subItems) => {
      for (const si of subItems) {
        if (si && si.pagenum) emitPagenum(si.pagenum);
        else items.push(si);
      }
    };

    // NUMBER_PREFIX_RE: the printed number at the start of an item's text (nimas-export.mjs, which decides what needs naming).
    // A bai-exercise item's own printed marker can be plain ("1.", "a.") like
    // NUMBER_PREFIX_RE, or parenthesized ("(1)", "(a)") — BANA §10.4.2b's own worked
    // sub-item convention (see nimas_exercise_index.test.mjs) — so the exercise-item
    // marker-synthesis fallback below must recognise both, or it would double-number an
    // already-marked parenthesized sub-item.
    const EXERCISE_MARKER_RE = /^\s*\(?(\d+|[a-zA-Z]|[ivxlcdm]+)[\.\)]\s+/;
    // A leading bullet glyph. Besides the dot-like glyphs (all folded into the primary bullet '•') it now
    // knows the other five print bullets of BANA Formats §8.6.2a — hollow square □, solid square ■, hollow
    // circle ○, triangle ▲, checkmark ✓/✔ — which are kept as the item's marker (see bulletMarkerOf).
    const BULLET_PREFIX_RE = /^\s*[•\-\*\u2022\u2023\u25E6\u2043\u2219\u25AA\u25AB\u25CF\u25CB\uF0B7\uF0A7\u00B7\u25A1\u25A0\u25B2\u2713\u2714]+\s+/;   // no U+221A: a line starting with the square-root sign is maths, not a checkmark bullet
    const bulletMarkerOf = (prefix) => [...prefix].find(isNonDotBulletMarker) || '•';
    let groupFirst = null;                                       // first item of this sibling group: carries enum / start (G8 stage 2)
    const groupItems = [];
    // G8 stage 2: a sibling group's enum / start ride on its first item so a save need not guess them from marker text. What the
    // markers themselves say wins (a save writes exactly that, so a reload equals the first load); the attributes are used
    // when the markers say nothing (no clean run). The defaults (enum "1", start 1) are not recorded. A list split around a
    // page turn or table is several groups, each starting at its own first item.
    const annotateGroup = (own) => {
      // Only the shallowest siblings form the group: items that precede it at a deeper level (flat class="level-N" <li>s from a
      // save, where the same items were nested sub-lists on the first load) are not its members, so both loads see the same group.
      if (own.length) { const minLvl = Math.min(...own.map((g) => g.level || 0)); own = own.filter((g) => (g.level || 0) === minLvl); }
      if (!own.length || !isOl || detectedKind === 'toc' || detectedKind === 'index' || !child.getAttribute) return;
      let en = child.getAttribute('enum'), st = parseInt(child.getAttribute('start') || '', 10);
      const c = classifyOrderedMarkerGroup(own);
      if (!c.keepMarkers && c.tagOpen.startsWith('<list type="ol"')) {
        const em = /enum="([^"]+)"/.exec(c.tagOpen), sm = /start="(\d+)"/.exec(c.tagOpen);
        en = em ? em[1] : null; st = sm ? Number(sm[1]) : NaN;
      } else if (own[0] !== groupFirst) { en = null; st = NaN; }   // a later chunk with no clean run: the list's attributes described its first chunk
      if (en && ['a', 'A', 'i', 'I'].includes(en)) own[0].enum = en;
      if (Number.isFinite(st) && st > 1) own[0].start = st;
    };
    // Optional item fields written by nimas-export.mjs: class bana-example, and a leading <span class="bana-label">.
    const applyItemBana = (li, item) => {
      const c = ((li.getAttribute && li.getAttribute('class')) || '').toLowerCase();
      if (/(^|\s)bana-example(\s|$)/.test(c)) item.example = true;
      if (/(^|\s)bana-ignore-font(\s|$)/.test(c)) item.ignoreFont = true;
      if (/(^|\s)bana-no-marker(\s|$)/.test(c)) delete item.marker;   // an unnumbered item inside a numbered list
      for (let k = li.firstChild; k; k = k.nextSibling) {
        if (k.nodeType !== 1 || (k.localName || k.tagName || '').toLowerCase() !== 'span' || !/(^|\s)bana-label(\s|$)/.test(((k.getAttribute && k.getAttribute('class')) || '').toLowerCase())) continue;
        const ls = inlineSegments(k);
        if (ls.some((g) => g.tf || g.uncontracted || g.type !== 'text')) item.labelSegments = ls; else item.label = ls.map((g) => g.text || '').join('');
        break;
      }
    };

    // An <li>'s pieces after its first paragraph (splitItemParagraphs) -> item.blocks: a <p> is a paragraph block, a
    // <table> its own table block. A page turn inside such a table is not kept inside the item (the document's print
    // page sequence is read from top-level blocks): it is handed back in `pagenums`, to follow the item.
    // Which of an item's tables stay inside it: those before its first sub-list with nothing split out of the item (a
    // picture, a note, a sidebar) ahead of them -- those still follow the item, so a table after one stays after it too
    // and the print order is kept. `skip`: elements that are not split out after all (an exercise item's described picture).
    const tablesKeptInItem = (before, pieces, skip = () => false) => {
      const want = new Set(pieces.filter((pc) => pc.el).map((pc) => pc.el));
      const ok = new Set();
      for (const el of before) { if (skip(el)) continue; if (want.has(el)) ok.add(el); else break; }
      return ok;
    };
    const isCodePiece = (pc) => !!pc.el && ['p', 'blockquote'].includes((pc.el.localName || pc.el.tagName || '').toLowerCase());   // <p class="bana-code">, <blockquote> (#50): always the item's own blocks
    const liItemBlocks = (pieces, pagenums) => {
      const out = [];
      for (const p of pieces) {
        if (p.el && (p.el.localName || p.el.tagName || '').toLowerCase() === 'blockquote') {   // #50: its paragraphs are quotation paragraphs
          const paras = [...(p.el.childNodes || [])].filter((c) => c.nodeType === 1 && (c.localName || c.tagName || '').toLowerCase() === 'p');
          for (const para of (paras.length ? paras : [p.el])) {
            const segs = inlineSegments(para);
            const t = segsText(segs);
            if (!t && !segs.some((g) => g.type !== 'text')) continue;
            out.push(segsHaveEmphOrMath(segs) ? { type: 'para', style: 'quote', text: t, segments: segs } : { type: 'para', style: 'quote', text: t });
          }
          continue;
        }
        if (p.el && (p.el.localName || p.el.tagName || '').toLowerCase() === 'p') {   // <p class="bana-code">: a code block, its <br/> the line breaks
          let text = '';
          const walk = (n) => { for (let c = n.firstChild; c; c = c.nextSibling) { if (c.nodeType === 3) text += c.nodeValue; else if (c.nodeType === 1) { if ((c.localName || c.tagName || '').toLowerCase() === 'br') text += '\n'; else walk(c); } } };
          walk(p.el);
          const blk = { type: 'para', text: text.replace(/\r\n?/g, '\n') };
          const toks = String((p.el.getAttribute && p.el.getAttribute('class')) || '').split(/\s+/).filter((t) => t.startsWith('bana-'));
          readBanaFlags(blk, toks, (p.el.getAttribute && p.el.getAttribute('title')) || null);
          if (blk.text) out.push(blk);
          continue;
        }
        if (p.el) {
          const tb = [];
          parseTable(p.el, tb);
          for (const b of tb) (b && b.type === 'pagenum' ? pagenums : out).push(b);
          continue;
        }
        const t = segsText(p.segs);
        if (!t && !p.segs.some((s) => s.type !== 'text')) continue;
        out.push(segsHaveEmphOrMath(p.segs) || p.segs.some((s) => s.type === 'imgnote') ? { type: 'para', text: t, segments: p.segs } : { type: 'para', text: t });
      }
      return out;
    };
    for (let li = child.firstChild; li; li = li.nextSibling) {
      if (li.nodeType === 3 && li.nodeValue.trim()) {           // loose text in a list (invalid, but kept; A2)
        const item = { text: li.nodeValue.replace(/\s+/g, ' ').trim() };
        if (listLvl > 0) item.level = listLvl;
        items.push(item);
        continue;
      }
      if (li.nodeType !== 1) continue;
      const liTag = (li.localName || li.tagName || '').toLowerCase();
      if (PAGENUM_TAGS.has(liTag)) { emitPagenum(pagenumBlock(li)); continue; }
      if (liTag === 'prodnote' || liTag === 'annotation') {   // a list's production note (A2)
        const out = [];
        // A22: an *imported* <prodnote render="required"> keeps that value (D6: only a note
        // block Emboss itself creates, with no block.render at all, gets the exporter's own
        // default of "optional" — see nimas-export.mjs's `case 'note':`).
        const renderAttr = (li.getAttribute && li.getAttribute('render')) || null;
        pushProdnote(out, li, (t) => (t ? (renderAttr === 'required' || renderAttr === 'optional' ? { type: 'note', text: t, render: renderAttr } : { type: 'note', text: t }) : null));
        out.forEach(emitPagenum);
        continue;
      }
      if (liTag !== 'li' && liTag !== 'item') continue;

      const liClass = (li.getAttribute ? li.getAttribute('class') : '') || '';
      const liLevel = getElementLevel(li);
      const effLevel = liLevel || listLvl;

      const childLists = [];
      for (let c = li.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 1 && (c.localName || c.tagName || '').toLowerCase() === 'list') {
          childLists.push(c);
        }
      }

      // Tables in the item (not in its sub-lists) become their own blocks, split out of the
      // list like page turns: those before the first sub-list follow the item's text, the
      // rest follow its sub-lists. They were dropped before, with any maths in them.
      const liTables = { before: [], after: [] };
      (function findTables(node, afterList) {
        for (let c = node.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          const t = (c.localName || c.tagName || '').toLowerCase();
          if (LIST_TAGS.has(t)) { afterList = true; continue; }
          if (t === 'table' || t === 'note' || t === 'sidebar' || IMAGE_TAGS.has(t)) (afterList ? liTables.after : liTables.before).push(c);
          else afterList = findTables(c, afterList);
        }
        return afterList;
      })(li, false);
      // Tables and notes (a DTBook <note> may sit in a list item) are split out the same way.
      const emitTables = (els) => {
        for (const el of els) {
          const out = [];
          const t = (el.localName || el.tagName || '').toLowerCase();
          if (t === 'note') pushNote(out, el);
          else if (IMAGE_TAGS.has(t)) pushImage(out, el);
          else if (t === 'sidebar') parseSidebar(el, out);
          else parseTable(el, out);
          out.forEach(emitPagenum);
        }
      };

      // This item's own components — not those of its sub-lists (an entry took the page of
      // its last nested entry, A28).
      const lics = li.getElementsByTagName ? [...li.getElementsByTagName('lic')].filter((l) => {
        for (let p = l.parentNode; p && p !== li; p = p.parentNode) if (LIST_TAGS.has((p.localName || p.tagName || '').toLowerCase())) return false;
        return true;
      }) : [];
      const PAGE_CLASS = /(^|[-_\s])(page|pagenum|pg|pageno)([-_\s]|$)/;
      // <lic> is DTBook's general "list item component": it makes a contents entry only when
      // one component is a page reference (class or pagenum), or the list is a contents list,
      // or the last of several components is a bare page number. "1." + an equation is an
      // ordinary numbered item (its maths was lost when every <lic> item was read as contents).
      const hasMathml = (el) => !!(el.getElementsByTagNameNS && el.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math').length);
      const licIsPage = (l) => {
        const c = ((l.getAttribute && l.getAttribute('class')) || '').toLowerCase();
        return c.includes('page') || PAGE_CLASS.test(c) || (l.getElementsByTagName && (l.getElementsByTagName('pagenum').length > 0 || l.getElementsByTagName('print-page').length > 0));
      };
      const PAGE_NO = /^\s*[\divxlcdm]+[a-z]?\s*$/i;           // "12", "xiv", "12a"
      const ITEM_NO = /^\s*[\divxlcdm]+[.)]\s*$/i;              // "1." / "iv)" — an item number, not a page
      const lastLic = lics[lics.length - 1];
      const licsAreContents = lics.length >= 2 && !hasMathml(lastLic) && PAGE_NO.test(getCleanText(lastLic)) && !ITEM_NO.test(getCleanText(lics[0]));
      const hasLics = lics.length > 0 && (isToc || lics.some(licIsPage) || licsAreContents);
      const isLiToc = isToc || liClass.includes('toc-entry') || liClass.includes('bai-toc-entry') || hasLics;
      // Page turns in this item (nested lists handle their own): before the item's text
      // → emitted before it; anywhere else → after it (an item cannot be split).
      const liPn = collectPagenums(li, LIST_AND_TABLE_TAGS);
      for (const b of liPn.before) emitPagenum(b);

      if (liClass.includes('bai-toc-center')) {
        const t = getCleanText(li, LIST_AND_TABLE_TAGS);
        if (t && targetBlocks) { emitListBlock(); targetBlocks.push({ type: 'heading', level: 1, text: t }); }
        emitTables(liTables.after);
        for (const b of liPn.after) emitPagenum(b);
        continue;
      }

      if (liClass.includes('toc-page') || liClass.includes('bai-toc-page')) {
        detectedKind = isIndex ? 'index' : 'toc';
        const pVal = getCleanText(li, LIST_AND_TABLE_TAGS);
        const pHref = pageColumnHref(li, LIST_AND_TABLE_TAGS);   // A36
        const target = lastTopItem || items[items.length - 1];
        if (pVal && target) {
          // The entry's own trailing number ("…November 21, 1963") was not its page (A2).
          const g = guessedPages.get(target);
          if (g && g.text.endsWith(target.page || '')) {
            target.text = g.text;
            if (target.segments) target.segments = g.segs;
            guessedPages.delete(target);
          }
          target.page = pVal;
          if (pHref) target.pageHref = pHref;                // A36: the page number's own link
        }
        emitTables(liTables.before);
        for (const cl of childLists) {
          addSubItems(parseSingleList(cl, effLevel + 1, null, detectedKind));
        }
        emitTables(liTables.after);
        for (const b of liPn.after) emitPagenum(b);
        continue;
      }

      if (isLiToc) {
        detectedKind = isIndex ? 'index' : 'toc';
        let itemText = '';
        let pageVal = null;
        let pageHrefVal = null;                               // A36: the page column's own <a href>
        let guessed = null;                                   // page read from the end of the text
        let textTargetNode = li;
        let textEl = null;
        let pageEl = null;
        const TOC_EXCLUDE = new Set(['list', 'ul', 'ol', 'pagenum', 'print-page', 'sidebar', 'table', 'prodnote']);

        if (hasLics) {
          textEl = lics.find(l => {
            const cls = ((l.getAttribute && l.getAttribute('class')) || '').toLowerCase();
            return cls.includes('toc-text') || cls.includes('bai-toc-text') || cls.includes('entry') || cls.includes('title');
          });
          pageEl = lics.find(l => {
            const cls = ((l.getAttribute && l.getAttribute('class')) || '').toLowerCase();
            const hasPageTag = l.getElementsByTagName ? (l.getElementsByTagName('pagenum').length > 0 || l.getElementsByTagName('print-page').length > 0) : false;
            return cls.includes('toc-page') || cls.includes('bai-toc-page') || cls.includes('page') || cls.includes('pagenum') || PAGE_CLASS.test(cls) || hasPageTag;
          });
          if (!textEl && !pageEl) {
            if (lics.length >= 2) {
              textEl = lics[0];
              pageEl = lics[lics.length - 1];
            } else if (lics.length === 1) {
              textEl = lics[0];
            }
          } else if (!textEl && lics.length >= 2 && pageEl) {
            textEl = lics.find(l => l !== pageEl);
          } else if (!pageEl && lics.length >= 2 && textEl) {
            pageEl = lics.find(l => l !== textEl);
          }

          if (textEl) {
            itemText = getCleanText(textEl, TOC_EXCLUDE);
            textTargetNode = textEl;
          }
          if (pageEl) {
            pageVal = pageColumnText(pageEl, TOC_EXCLUDE);
            pageHrefVal = pageColumnHref(pageEl, TOC_EXCLUDE);    // A36
          }
        }

        // A <pagenum> inside a contents entry is a print page turn, not the entry's page
        // column (that is <lic class="pagenum">); it is hoisted around the item like any other.
        const segs = inlineSegments(textTargetNode, true, TOC_EXCLUDE);
        
        if (!itemText) {
          const directText = segs.map(s => s.text || '').join('').replace(/\s+/g, ' ').trim();
          const pageMatch = directText.match(/\s+(\d+|[ivxlcdm]+)$/i);
          if (pageMatch) {
            itemText = directText.slice(0, pageMatch.index).trim();
            if (!pageVal) { pageVal = pageMatch[1]; guessed = { text: directText, segs: segs.map((g) => ({ ...g })) }; }
          } else {
            itemText = directText || getCleanText(li, TOC_EXCLUDE);
          }
        }

        if (!textEl && pageVal && segs.length > 0) {
          const lastSeg = segs[segs.length - 1];
          if (lastSeg.type === 'text' && lastSeg.text) {
            const re = new RegExp(`\\s*${pageVal}\\s*$`);
            lastSeg.text = lastSeg.text.replace(re, '');
            if (!lastSeg.text) {
              segs.pop();
            }
          }
        }
        const hasEmphOrMath = segs.some(s => s.tf || s.uncontracted || s.type === 'math' || s.type === 'noteref' || s.type === 'linenum' || s.href || s.cite || s.ignoreFont || s.transcriberTypeform || (s.text && s.text.includes('\n')));
        const item = { text: itemText };
        if (pageVal) item.page = pageVal;
        if (pageVal && pageHrefVal) item.pageHref = pageHrefVal;   // A36
        if (effLevel > 0) item.level = effLevel;
        if (segs.length && hasEmphOrMath) item.segments = segs;
        if (guessed) guessedPages.set(item, guessed);
        items.push(item);
        lastTopItem = item;

        emitTables(liTables.before);
        for (const cl of childLists) {
          addSubItems(parseSingleList(cl, effLevel + 1, null, detectedKind));
        }
        emitTables(liTables.after);
        for (const b of liPn.after) emitPagenum(b);
        continue;
      }

      if (liClass.includes('bai-exercise') || listIsExercise) {
        detectedKind = 'exercise';
        // imageAsNote (BANA §10.11.1/Example 10-31): an <img> inside an exercise item
        // becomes an embedded transcriber's-note segment instead of being dropped (F-229).
        // Several <p> (or a <table>) in an exercise item: the first paragraph is the item, the rest its blocks (§10.3.3).
        const exPieces = splitItemParagraphs(mergeWhitespaceRuns(segsWithoutPagenums(inlineSegments(li, true, LI_SPLIT_TAGS, true, 'blocks'))));
        const exHead = exPieces.find((pc) => pc.segs) || null;
        const segs = exHead ? exHead.segs : [];
        const exKept = tablesKeptInItem(liTables.before, exPieces, (el) => /^(img|image)$/.test((el.localName || el.tagName || '').toLowerCase()) && !!((el.getAttribute && el.getAttribute('alt')) || '').trim());
        const exRest = exHead ? exPieces.filter((pc) => pc !== exHead && (!pc.el || isCodePiece(pc) || exKept.has(pc.el))) : [];
        const exPagenums = [];
        const t = segs.map(s => s.text || '').join('').replace(/\s+/g, ' ').trim() || getCleanText(li, LIST_AND_TABLE_TAGS);
        const item = { text: t };
        if (effLevel > 0) item.level = effLevel;
        if (segs.length && segs.some(s => s.tf || s.uncontracted || s.type === 'math' || s.type === 'noteref' || s.type === 'linenum' || s.type === 'imgnote' || s.type === 'brl' || s.href || s.cite || s.ignoreFont || s.transcriberTypeform || (s.text && s.text.includes('\n')))) item.segments = segs;
        // BANA §10.4: an exercise item's own printed number/letter is usually baked
        // directly into its text ("1. Which…" — kept verbatim, no separate marker field,
        // matching the real bai-exercise convention this schema otherwise preserves
        // unchanged) but a genuinely ordered list (type="ol") whose item text carries no
        // such literal marker still needs its print numbering shown — synthesize one
        // exactly like the ordinary numbered-list branch below does, so a bai-exercise
        // list marked only at the <list> level (not per-<li>) doesn't silently lose it.
        // A marker a save named on the item (class="bana-marker" title="•": a bulleted list given the Exercise style, A89) is its
        // marker, not part of its text, and not replaced by a number.
        const exNamed = /(^|\s)bana-marker(\s|$)/.test(liClass) ? ((li.getAttribute && li.getAttribute('title')) || '').trim() : '';
        if (exNamed && item.text.startsWith(exNamed)) {
          item.marker = exNamed;
          item.text = item.text.slice(exNamed.length).trim();
          if (item.segments && item.segments.length && typeof item.segments[0].text === 'string' && item.segments[0].text.trimStart().startsWith(exNamed)) item.segments[0] = { ...item.segments[0], text: item.segments[0].text.trimStart().slice(exNamed.length).replace(/^\s+/, '') };
          if (isOl) counter++;
        } else if (isOl) {
          if (!EXERCISE_MARKER_RE.test(t)) item.marker = synthesizeOrderedMarker(counter, enumAttr);
          counter++;
        }
        applyItemBana(li, item);
        if (!item.text && !item.segments && hasEmptyMark(li)) item.keptEmpty = true;   // A89: saved empty on purpose
        if (exRest.length) { const ib = liItemBlocks(exRest, exPagenums); if (ib.length) item.blocks = ib; }
        items.push(item);
        lastTopItem = item;

        // An <img> already folded into this item's own embedded TN segment (above) must
        // not also be split out as a separate standalone graphic block — same criteria
        // (has alt text) as the imageAsNote branch of inlineSegments used to consume it.
        const consumedByImgNote = (el) => {
          const et = (el.localName || el.tagName || '').toLowerCase();
          if (et !== 'img' && et !== 'image') return false;
          return !!(((el.getAttribute && el.getAttribute('alt')) || '').replace(/\s+/g, ' ').trim());
        };
        const exTables = new Set(exRest.filter((pc) => pc.el).map((pc) => pc.el));   // already in item.blocks
        emitTables(liTables.before.filter((el) => !consumedByImgNote(el) && !exTables.has(el)));
        for (const cl of childLists) {
          addSubItems(parseSingleList(cl, effLevel + 1, null, detectedKind));
        }
        emitTables(liTables.after.filter((el) => !consumedByImgNote(el) && !exTables.has(el)));
        for (const b of exPagenums) emitPagenum(b);
        for (const b of liPn.after) emitPagenum(b);
        continue;
      }

      if (liClass.includes('bai-index')) {
        detectedKind = 'index';
        // Several <p> in an index entry: the first is the entry, the rest its further paragraphs (item.blocks).
        const ixPieces = splitItemParagraphs(mergeWhitespaceRuns(segsWithoutPagenums(inlineSegments(li, true, LI_SPLIT_TAGS, false, 'blocks'))));
        const ixHead = ixPieces.find((pc) => pc.segs) || null;
        const ixRest = ixHead ? ixPieces.filter((pc) => pc !== ixHead && pc.segs) : [];   // a table stays split out, as before
        const segs = ixHead ? ixHead.segs : [];
        const t = segs.map(s => s.text || '').join('').replace(/\s+/g, ' ').trim() || getCleanText(li, LIST_AND_TABLE_TAGS);
        const item = { text: t };
        if (effLevel > 0) item.level = effLevel;
        if (segs.length && segs.some(s => s.tf || s.uncontracted || s.type === 'math' || s.type === 'noteref' || s.type === 'linenum' || s.href || s.cite || s.ignoreFont || s.transcriberTypeform || (s.text && s.text.includes('\n')))) item.segments = segs;
        if (ixRest.length) { const ib = liItemBlocks(ixRest, []); if (ib.length) item.blocks = ib; }
        items.push(item);
        lastTopItem = item;

        emitTables(liTables.before);
        for (const cl of childLists) {
          addSubItems(parseSingleList(cl, effLevel + 1, null, detectedKind));
        }
        emitTables(liTables.after);
        for (const b of liPn.after) emitPagenum(b);
        continue;
      }

      // An <li> with several <p> (or a <table> among them): the first paragraph is the item, the rest its blocks.
      const keepEdge = hasPreserve(li);                    // A89: xml:space="preserve" keeps a space at the item's edge
      const liPieces = splitItemParagraphs(mergeWhitespaceRuns(segsWithoutPagenums(inlineSegments(li, true, LI_SPLIT_TAGS, false, 'blocks'))), keepEdge);
      const headPiece = liPieces.find((pc) => pc.segs) || null;
      const segs = headPiece ? headPiece.segs : [];
      const consumedTables = new Set();                    // tables that went into item.blocks (not split out of the list)
      const blockPagenums = [];
      let directText = segs.map(s => s.text || (s.latex ? s.latex : (s.mathml ? s.mathml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : ''))).join('').replace(/\s+/g, ' ');
      if (!keepEdge || !directText.trim()) directText = directText.trim();
      if (!directText) directText = getCleanText(li, LIST_AND_TABLE_TAGS);
      const emptyKept = !directText && !segs.length && hasEmptyMark(li);   // A89: <li class="bana-empty"/> is an empty item of its own
      // A89: <li class="bana-empty">iii.</li> holds only its printed number: read it as a number followed by nothing
      if (hasEmptyMark(li) && directText && segs.length <= 1) { directText += ' '; if (segs.length && typeof segs[0].text === 'string') segs[0].text += ' '; }

      let itemMarker = null;
      // A marker the save could not leave to NUMBER_PREFIX_RE ("1.1", a bare "1") is named by the item: class="bana-marker" title="1.1".
      const namedMarker = /(^|\s)bana-marker(\s|$)/.test(liClass) ? (((li.getAttribute && li.getAttribute('title')) || '').trim()) : '';
      const namedLead = namedMarker ? (segs.length ? ((segs[0].type === 'text' || !segs[0].type) ? String(segs[0].text || '') : null) : directText) : null;
      if (namedMarker && namedLead != null && namedLead.trimStart().startsWith(namedMarker)) {
        const dropMarker = (t) => t.trimStart().slice(namedMarker.length).replace(/^\s+/, '');
        itemMarker = namedMarker;
        directText = dropMarker(directText).trim();
        if (segs.length && segs[0].text) segs[0].text = dropMarker(segs[0].text);
        if (isOl) counter++;
      } else if (isOl) {
        // The printed number is looked for only in the item's own leading TEXT, never inside an equation: an item that
        // starts with maths such as "(100) • (…)" was numbered "(100)" (30 Sep; the maths' text is part of directText).
        const lead = segs.length ? ((segs[0].type === 'text' || !segs[0].type) ? String(segs[0].text || '') : null) : directText;
        const match = lead != null ? lead.match(NUMBER_PREFIX_RE) : null;
        if (match) {
          itemMarker = match[0].trim();
          directText = directText.replace(NUMBER_PREFIX_RE, '').trim();
          if (segs.length && segs[0].text) {
            segs[0].text = segs[0].text.replace(NUMBER_PREFIX_RE, '');
          }
        } else {
          itemMarker = synthesizeOrderedMarker(counter, enumAttr);
        }
        counter++;
      } else if (detectedKind !== 'plain' && !isToc) {
        const match = directText.match(BULLET_PREFIX_RE);
        if (match) {
          itemMarker = bulletMarkerOf(match[0]);
          directText = directText.slice(match[0].length).trim();
          if (segs.length && segs[0].text) {
            segs[0].text = segs[0].text.replace(BULLET_PREFIX_RE, '');
          }
        } else if (listTypeAttr.toLowerCase() === 'ul') {
          // A6 / BANA 8.6.2 ("Retain bullets whenever they are used in lists"): a
          // `<list type="ul">` item whose print bullet is not a literal leading
          // character in the source text (e.g. a CSS/print bullet with no glyph
          // captured in the markup) still needs a bullet in braille — default to the
          // primary bullet symbol (formatList already renders '•' as '_4') rather than
          // silently dropping it. nimas-export.mjs already treats a plain '•' marker as
          // implicit (keepMarkers:false, `<list type="ul">` only) so this round-trips
          // without ever writing a literal bullet glyph into the exported text.
          itemMarker = '•';
        }
      }

      const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || s.type === 'noteref' || s.type === 'linenum' || s.type === 'brl' || s.href || s.cite || s.ignoreFont || s.transcriberTypeform || s.lang || (s.text && (s.text.includes('\n') || /[\ue000\ue001]/.test(s.text))));   // sub/superscript markers too (30 Sep)
      if (directText || emptyKept || (itemMarker && hasEmptyMark(li) && !directText)) {   // A89: <li class="bana-empty">iii.</li>, an empty item with its printed number
        // segs already excludes nested lists (inlineSegments(li, true, …)), so an item that has
        // a sub-list keeps its own emphasis and maths too (they were dropped before).
        const item = (hasEmphOrMath && segs.length > 0) ? { segments: segs, text: directText } : { text: directText };
        if (itemMarker) item.marker = itemMarker;
        if (!directText && hasEmptyMark(li)) item.keptEmpty = true;   // A89: saved empty on purpose
        // <li class="bana-bullet-triangle">: the item's own bullet beside (or instead of) an ordinal.
        const bulletTok = /(?:^|\s)bana-bullet-([a-z-]+)(?=\s|$)/i.exec(liClass);
        const bName = bulletTok ? bulletName(bulletTok[1].toLowerCase().replace(/-/g, ' ')) : null;
        if (bName) { item.bullet = bName; if (!isOl && item.marker === '•') delete item.marker; }
        const glyphTok = !isOl && !bName ? /(?:^|\s)bana-bullet-glyph-([0-9a-f]{2,6})(?=\s|$)/i.exec(liClass) : null;   // IMP-W7: a custom print bullet a save wrote as a class
        if (glyphTok) { const cp = parseInt(glyphTok[1], 16); if (cp > 0x1F && cp <= 0x10FFFF) item.marker = String.fromCodePoint(cp); }
        if (effLevel > 0) item.level = effLevel;
        applyItemBana(li, item);
        const keptTables = tablesKeptInItem(liTables.before, liPieces);
        const rest = liPieces.filter((pc) => pc !== headPiece && (!pc.el || isCodePiece(pc) || keptTables.has(pc.el)));
        // K32 / BANA 21.4.4: a real print page turn INSIDE this <li>, in an index or glossary
        // list, means any further paragraph here is really the NEXT sibling entry, wrongly
        // merged into this one by the DTBook producer — the anthology's "characters" > "main" /
        // "minor" split at page R84 (a nested subentry list; effLevel already carries down via
        // parentKind, above). A genuine index/glossary entry never has a second paragraph of its
        // own ("An index entry consists of the word or phrase with all its page references"), so
        // this is conservative: it only fires when a page turn was actually found after the
        // item's own text (liPn.after), and only for plain paragraph pieces — a table stays
        // item.blocks, as before.
        const siblingRest = (detectedKind === 'index' || detectedKind === 'glossary') && liPn.after.length && rest.length && rest.every((pc) => !pc.el);
        if (rest.length && !siblingRest) {
          const ib = liItemBlocks(rest, blockPagenums);
          if (ib.length) item.blocks = ib;
          for (const pc of rest) if (pc.el) consumedTables.add(pc.el);
        }
        if (!groupFirst) groupFirst = item;
        groupItems.push(item);
        items.push(item);
        lastTopItem = item;
        if (siblingRest) {
          // The page turn sometimes carries its own repeated running head along (bold+italic
          // "Index of Skills" / "Glossary of ...") — decorative page furniture, not a further
          // sibling entry. Kept as this item's OWN item.blocks (as any other further paragraph
          // already was, before this fix, for every list) rather than dropped outright — a
          // load must never lose real source text (load-audit.mjs's own "nothing lost" fidelity
          // check), even text this deliberately does not treat as an index/glossary entry.
          const isRunningHeadPiece = (pc) => {
            const s = Array.isArray(pc.segs) && pc.segs.length === 1 ? pc.segs[0] : null;
            return !!s && s.type === 'text' && ((s.tf || 0) & TF_BOLD) && ((s.tf || 0) & TF_ITALIC) && /^(glossary|index)\b/i.test(String(s.text || '').trim());
          };
          const headRest = rest.filter(isRunningHeadPiece);
          const siblings = rest.filter((pc) => !isRunningHeadPiece(pc));
          if (headRest.length) {
            const ib = liItemBlocks(headRest, blockPagenums);
            if (ib.length) item.blocks = ib;
          }
          emitPagenum(liPn.after.shift());
          for (const pc of siblings) {
            const t = segsText(pc.segs);
            if (!t) continue;
            const sib = segsHaveEmphOrMath(pc.segs) ? { segments: pc.segs, text: t } : { text: t };
            if (effLevel > 0) sib.level = effLevel;
            groupItems.push(sib);
            items.push(sib);
            lastTopItem = sib;
          }
        }
      }

      emitTables(liTables.before.filter((el) => !consumedTables.has(el)));
      for (const cl of childLists) {
        addSubItems(parseSingleList(cl, effLevel + 1, null, detectedKind));
      }
      emitTables(liTables.after.filter((el) => !consumedTables.has(el)));
      for (const b of blockPagenums) emitPagenum(b);
      for (const b of liPn.after) emitPagenum(b);
    }

    if (!targetBlocks) annotateGroup(groupItems);          // a nested call hands its items up; a top call annotates each chunk as it is emitted
    emitListBlock();
    return items;
  }

  function parseDefinitionList(dlEl, targetBlocks = blocks) {
    let items = [];
    // A table inside a definition becomes its own block after that definition, splitting
    // the glossary around it (it was folded into the definition's text before).
    // Tables and images inside a definition are split out after it (A28/A29: the Coyotes
    // glossary's pictures were dropped and their captions folded into the definition).
    const SPLIT = new Set(['table', 'imggroup', 'img', 'image']);
    // Bug 7 / real-book-validation-24sep.md: a decorative <img>/<image> (isDecorativeImg) inside
    // a <dt>/<dd> was forcing the glossary onto its own page around it (tablesIn used to collect
    // it like a real content image, splitting the list wherever one sat — about 9 extra page
    // breaks, each with 1-4 entries, in the anthology's literary glossary). The image's own
    // inline word-space is untouched here (inlineSegments' plain breakWord() still runs for it,
    // same as any other <img>): a decorative glyph standing in for a letter/sound inside a word
    // ("kr<img/>n") still reads as two words rather than the glued, unreadable "krn" — the
    // load_warnings.test.mjs case this file's own "kr<img/>n" is not "krn" comment (inlineSegments)
    // already protects, and load-audit.mjs/measure-import-fidelity.mjs's "no row may drop" gate
    // would otherwise flag the merged word as lost content. Only the STRUCTURAL half of the bug
    // — being pulled out of its <dd> as a page-breaking block of its own — is fixed: the image
    // is queued here and appended as an ordinary graphic block (imagesWithin's own A29 pattern:
    // "an image in a heading follows it") once the WHOLE <dl> is done, so it cannot interrupt any
    // glossary chunk the way tablesIn's old undifferentiated collection did (dropping it outright
    // instead would silently shrink the model's own image count — "no row may drop" again — a
    // decorative graphic with no caption/description/alt prints no lines at all, printImageParts,
    // so where exactly among the trailing blocks it lands is not visible in the braille either way).
    const pendingDecoImages = [];
    const collectDecorativeImages = (el) => {
      (function walk(n) {
        for (let k = n.firstChild; k; k = k.nextSibling) {
          if (k.nodeType !== 1) continue;
          const kt = (k.localName || k.tagName || '').toLowerCase();
          if ((kt === 'img' || kt === 'image') && isDecorativeImg(k)) { pendingDecoImages.push(k); continue; }
          walk(k);
        }
      })(el);
    };
    const tablesIn = (el) => {
      const out = [];
      (function walk(n) {
        for (let k = n.firstChild; k; k = k.nextSibling) {
          if (k.nodeType !== 1) continue;
          const kt = (k.localName || k.tagName || '').toLowerCase();
          if ((kt === 'img' || kt === 'image') && isDecorativeImg(k)) continue;   // queued above, not split out here
          if (SPLIT.has(kt)) out.push(k); else walk(k);
        }
      })(el);
      return out;
    };
    const flushGlossary = () => {
      if (items.length && targetBlocks) targetBlocks.push({ type: 'list', kind: 'glossary', style: 'glossary', items });
      items = [];
    };
    let curTerm = null;
    let curTermSegs = null;
    let curMeta = null;                                        // entry-word lead / superscript from the <dt> (bana-lead, bana-term-sup)
    const dtMeta = (dt) => {
      const c = ((dt.getAttribute && dt.getAttribute('class')) || '').toLowerCase().split(/\s+/);
      const t = (dt.getAttribute && dt.getAttribute('title')) || '';
      const hasL = c.includes('bana-lead'), hasS = c.includes('bana-term-sup');
      if (!t || (!hasL && !hasS)) return null;
      if (hasL && hasS) { const [l, sp] = t.split('|'); try { return { lead: decodeURIComponent(l), termSup: decodeURIComponent(sp ?? '') }; } catch { return null; } }
      return hasL ? { lead: t } : { termSup: t };
    };
    for (let c = dlEl.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const cTag = (c.localName || c.tagName || '').toLowerCase();
      if (cTag === 'brl') continue;
      // Bug 4 / real-book-validation-24sep.md: a print page turn between two entries (a
      // <pagenum> sibling of <dt>/<dd>, not nested in either) used to be picked up by the old
      // whole-list collectPagenums() sweep below, which treated the ENTIRE <dl> as one run of
      // text — so every page turn after the very first one landed in its "after" bucket and
      // was pushed at the very end of the whole glossary (the anthology's R65-R78: 14 turns
      // stacked on one page). Handled here instead, at its own position: split the glossary
      // (like an ordinary list splits around a page turn, see parseSingleList's emitPagenum)
      // and push the turn between the two chunks.
      if (PAGENUM_TAGS.has(cTag)) {
        const pnBlock = pagenumBlock(c);
        if (pnBlock && targetBlocks) { flushGlossary(); targetBlocks.push(pnBlock); }
        continue;
      }
      if (cTag === 'dt' || cTag === 'dfn') {
        if (curTerm) {
          const item = {
            term: curTerm,
            def: '',
            text: curTerm
          };
          if (curTermSegs?.length) {
            item.termSegments = curTermSegs;
            item.segments = curTermSegs;
          }
          if (curMeta) Object.assign(item, curMeta);
          items.push(item);
        }
        curMeta = dtMeta(c);
        curTerm = getCleanText(c);
        curTermSegs = segsWithoutPagenums(inlineSegments(c));
        collectDecorativeImages(c);   // bug 7: queued, not dropped (fidelity)
      } else if (cTag === 'dd') {
        collectDecorativeImages(c);   // bug 7: queued, not dropped (fidelity) — tablesIn (below) no longer collects these itself
        // Bug 4 (continued): a page turn NESTED inside this <dd> (the real anthology shape —
        // R65-R78 sit right at the end of their own <dd>, just before the next <dt>) is
        // hoisted the same way an ordinary paragraph hoists one around itself (hoistPagenums):
        // one before any of this definition's own text, split the glossary before the item;
        // one after, split it after — instead of falling through to the old whole-list sweep.
        const rawDefSegs = inlineSegments(c, false, SPLIT);
        const { before: pnBefore, after: pnAfter } = hoistPagenums(rawDefSegs);
        let defSegs = segsWithoutPagenums(rawDefSegs);
        // K34 (found by K32): the print page's REPEATED RUNNING HEAD ("Glossary of Literary and
        // Informational Terms" / "Index of …", bold+italic — same test as parseSingleList's own
        // isRunningHeadPiece above) sometimes rides along with a page turn INSIDE a <dd>'s own
        // definition (the anthology's "Biography" entry: …person.<pagenum/><br/><running
        // head/><br/>As such, biographies…) rather than at the end of an item the way K32 found
        // for <li> — the definition here is one continuous run of text either side of it, so
        // (unlike K32) nothing here is a further sibling entry. Pulled out (from the pagenum's
        // own SPLIT already above, so the pagenum itself is untouched — Bug 4) so the running
        // head's own words cannot land spliced into the middle of "Biography"'s definition, but
        // kept — same fidelity principle as K32 — as this item's own trailing block
        // (load-audit.mjs's "nothing lost" check).
        const isRunningHeadSeg = (s) => s && s.type === 'text' && ((s.tf || 0) & TF_BOLD) && ((s.tf || 0) & TF_ITALIC) && /^(glossary|index)\b/i.test(String(s.text || '').trim());
        const runningHeadSegs = defSegs.filter(isRunningHeadSeg);
        if (runningHeadSegs.length) {
          const isWs = (s) => s && s.type === 'text' && /^\s*$/.test(s.text || '');
          // Same format test as mergeWhitespaceRuns' own sameFormat (above): when the text
          // either side of the removed run matches, join it into ONE segment (matching what a
          // reparse of the exported plain text — one continuous run, no element boundary where
          // the running head used to sit — produces) rather than leaving three, an instability
          // that broke the parse → export → reparse round trip (nimas_roundtrip.test.mjs).
          const sameFormat = (a, b) => a.type === 'text' && b.type === 'text' && (a.tf || 0) === (b.tf || 0)
            && !!a.uncontracted === !!b.uncontracted && (a.href || null) === (b.href || null)
            && !!a.cite === !!b.cite && !!a.hyperlink === !!b.hyperlink && !!a.ignoreFont === !!b.ignoreFont && (a.lang || null) === (b.lang || null);
          const kept = [];
          let i = 0;
          while (i < defSegs.length) {
            const s = defSegs[i];
            if (isRunningHeadSeg(s)) {
              // The <br/>s either side of the running head are page layout, not a real
              // paragraph break in the definition's own words: drop them (whatever typeform a
              // whitespace-only run happened to pick up — the same instability
              // mergeWhitespaceRuns already guards against elsewhere for a run that "does not
              // really belong" to its neighbour's format) along with the running head itself,
              // collapsing the whole gap to a single space between real content either side.
              while (kept.length && isWs(kept[kept.length - 1])) kept.pop();
              i++;
              while (i < defSegs.length && isWs(defSegs[i])) i++;
              const before = kept[kept.length - 1];
              const after = defSegs[i];
              if (before && after && sameFormat(before, after)) {
                kept[kept.length - 1] = { ...before, text: before.text.replace(/\s+$/, '') + ' ' + after.text.replace(/^\s+/, '') };
                i++;
              } else if (before && after) {
                kept.push({ type: 'text', text: ' ' });
              }
              continue;
            }
            kept.push(s);
            i++;
          }
          defSegs = trimSegmentEdges(kept);
        }
        let defText = getCleanText(c, SPLIT);
        for (const h of runningHeadSegs) {
          const t = (h.text || '').trim();
          if (t) defText = defText.replace(t, '').replace(/\s+/g, ' ').trim();
        }
        if (targetBlocks && pnBefore.length) { flushGlossary(); pnBefore.forEach((b) => targetBlocks.push(b)); }
        if (curTerm || defText || runningHeadSegs.length) {
          const item = {
            term: curTerm || '',
            def: defText || '',
            text: curTerm ? `${curTerm} — ${defText}` : defText
          };
          if (curTermSegs?.length) item.termSegments = curTermSegs;
          if (defSegs?.length) item.defSegments = defSegs;
          if (curTermSegs?.length || defSegs?.length) {
            item.segments = [...(curTermSegs || [{ type: 'text', text: curTerm || '' }]), { type: 'text', text: ' — ' }, ...(defSegs || [{ type: 'text', text: defText || '' }])];
          }
          if (curMeta) Object.assign(item, curMeta);
          if (runningHeadSegs.length) {
            // K34: keep the running head for fidelity (see comment above) as the item's own
            // trailing block — the exact shape liItemBlocks (parseSingleList) builds for a
            // further paragraph, so formatItemBlocks/isItemParaBlock render and round-trip it
            // the same way K32 already relies on for the <li> case.
            const headText = segsText(runningHeadSegs);
            if (headText) item.blocks = [segsHaveEmphOrMath(runningHeadSegs) ? { type: 'para', text: headText, segments: runningHeadSegs } : { type: 'para', text: headText }];
          }
          items.push(item);
          curTerm = null;
          curTermSegs = null;
          curMeta = null;
        }
        if (targetBlocks && pnAfter.length) { flushGlossary(); pnAfter.forEach((b) => targetBlocks.push(b)); }
        // Bug 7 (continued): a decorative <img>/<image> in this <dd> (isDecorativeImg) is no
        // longer collected by tablesIn below (collectDecorativeImages queued it instead, above)
        // — so it can no longer force the glossary to split into a separate list/page around it.
        const ddTables = targetBlocks ? tablesIn(c) : [];
        if (ddTables.length) {
          flushGlossary();
          for (const t of ddTables) {
            const tag = (t.localName || t.tagName || '').toLowerCase();
            if (tag === 'table') parseTable(t, targetBlocks);
            else if (tag === 'imggroup') parseImgGroup(t, targetBlocks);
            else {
              const src = (t.getAttribute && t.getAttribute('src')) || '';
              const g = { type: 'graphic', src, alt: (t.getAttribute && t.getAttribute('alt')) || '' };
              const svg = svgFromDataUri(src);
              if (svg) g.svg = svg;
              targetBlocks.push(g);
            }
          }
        }
      }
    }
    if (curTerm) {
      const item = {
        term: curTerm,
        def: '',
        text: curTerm
      };
      if (curTermSegs?.length) {
        item.termSegments = curTermSegs;
        item.segments = curTermSegs;
      }
      if (curMeta) Object.assign(item, curMeta);
      items.push(item);
    }
    // Bug 4: no longer collectPagenums(dlEl, SPLIT) here — that walked the WHOLE <dl> as one
    // run and was the actual cause (every page turn nested in a <dt>/<dd> or sibling of one,
    // after the very first, landed in its "after" bucket here, at the very end of the whole
    // glossary). Every page turn this function can reach is now consumed at its own position,
    // above (the sibling branch, and hoistPagenums inside the <dd> branch), so there is
    // nothing left to sweep up here.
    flushGlossary();
    // Bug 7 (continued): every decorative image queued above, now that no glossary chunk is
    // still open to split — imagesWithin's own A29 pattern ("an image in a heading follows it").
    if (targetBlocks) for (const img of pendingDecoImages) pushImage(targetBlocks, img);
  }

  function parsePoem(poemEl, targetBlocks = blocks, poemOpts = {}) {
    // A19/A21/D5: everything this call pushes that is actually poem *verse* (a line, a
    // stanza-break indicator, or a pagenum inside one) is tagged fromPoem so nimas-export.mjs
    // can tell a genuine poem apart from BrailleBlaster's bai-verse (verse *drama*, which has
    // no <poem> source and must keep saving as <p class="bai-verse">, per D5) and write it back
    // as <poem>/<linegroup>/<line> instead of flattening it to paragraphs. Marked by scanning
    // the range this call (including any nested parsePoem recursion into the same array) pushes,
    // rather than touching every push site individually, since parsePoem has many of them.
    // A42: poemOpts.bare is true when the element passed to THIS call was not itself a <poem>
    // (a bare <linegroup>/<stanza>, or a poem/verse/stanza-classed <div> — see the call sites)
    // so the same tagged range is also marked block.bareLinegroup/bareLinegroupId, telling
    // nimas-export.mjs to write the run back without a <poem> wrapper the source never had.
    const { bare: bareLinegroup = false, runId: bareLinegroupId = null } = poemOpts;
    // A verse line's own optional fields (poemMethod, pageBreakBefore, ignoreFont …): bana-<field> tokens on the <line> / <p>.
    const lineBana = (blk, el) => {
      const toks = ((el.getAttribute && el.getAttribute('class')) || '').toLowerCase().split(/\s+/).filter((t) => t.startsWith('bana-'));
      if (toks.length) readBanaFlags(blk, toks, (el.getAttribute && el.getAttribute('title')) || null);
    };
    const poemStart = targetBlocks ? targetBlocks.length : 0;
    let pendingLinenum = '';
    for (let c = poemEl.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const cTag = (c.localName || c.tagName || '').toLowerCase();
      const cCls = (c.getAttribute ? (c.getAttribute('class') || '') : '').toLowerCase();

      if (cTag === 'title' || cTag === 'hd' || /^h[1-6]$/.test(cTag)) {
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : (/^h[1-6]$/.test(cTag) ? parseInt(cTag.slice(1), 10) : 2);
        // 30d: the poem's own title stays the poem's (poemRole), so a save writes it back as the poem's <title>, not as a section heading.
        if (targetBlocks) pushAtomic(targetBlocks, c, (t, segs) => {
          if (!t) return null;
          const blk = segs ? { type: 'heading', level: lvl, text: t, segments: segs } : { type: 'heading', level: lvl, text: t };
          lineBana(blk, c);                                   // a level written as class="bana-level-N", and the heading's own fields
          if (!bareLinegroup) blk.poemRole = 'title';
          return blk;
        });
      } else if (PAGENUM_TAGS.has(cTag)) {
        const pn = pagenumBlock(c);
        if (pn && targetBlocks) targetBlocks.push(pn);
      } else if (cTag === 'byline' || cTag === 'author' || cTag === 'cite' || cTag === 'attrib') {
        // 30d: likewise the poem's <author> / <byline> (poemRole 'author' | 'byline'): a save writes it back inside the <poem>.
        if (targetBlocks) pushAtomic(targetBlocks, c, (t, segs) => {
          if (!t) return null;
          const blk = segs ? { type: 'attribution', text: t, segments: segs } : { type: 'attribution', text: t };
          lineBana(blk, c);
          if (!bareLinegroup) blk.poemRole = cTag === 'author' ? 'author' : 'byline';
          return blk;
        });
      } else if (cTag === 'linegroup' || cTag === 'stanza' || (cTag === 'div' && (cCls.includes('stanza') || cCls.includes('linegroup') || cCls.includes('line-group') || cCls.includes('verse') || cCls.includes('poem')))) {
        let stanzaLinenum = '';
        let hasLinesInGroup = false;
        for (let ln = c.firstChild; ln; ln = ln.nextSibling) {
          if (ln.nodeType !== 1) continue;
          const lnTag = (ln.localName || ln.tagName || '').toLowerCase();
          const lnCls = (ln.getAttribute ? (ln.getAttribute('class') || '') : '').toLowerCase();
          if (PAGENUM_TAGS.has(lnTag)) {
            const pn = pagenumBlock(ln);
            if (pn && targetBlocks) targetBlocks.push(pn);
          } else if (lnTag === 'linenum' || lnCls.includes('linenum')) {
            stanzaLinenum = (ln.textContent || '').trim();
          } else if (lnTag === 'title' || lnTag === 'hd' || /^h[1-6]$/.test(lnTag)) {
            if (targetBlocks) pushTextOnly(targetBlocks, ln, (t) => (t ? { type: 'heading', level: 3, text: t } : null));
          } else if (lnTag === 'line' || lnTag === 'ln' || lnTag === 'p') {
            if (lnCls.includes('bai-stanza-break') || lnCls.includes('stanza-break')) {
              if (targetBlocks) targetBlocks.push({ type: 'indicator', kind: 'line' });
            } else {
              const lvlAttr = ln.getAttribute ? ln.getAttribute('level') : null;
              const lnLvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
              const pn = hoistPagenums(inlineSegments(ln));
              let segs = pn.segs;
              let t = getCleanText(ln);
              let innerLinenum = '';
              if (ln.getElementsByTagName) {
                const numNode = findLinenum(ln);
                if (numNode) innerLinenum = (numNode.textContent || '').trim();
              }
              const lineNum = innerLinenum || stanzaLinenum;
              if (lineNum) {
                // BANA 15.7.2c/d ("place each letter...at the right margin"), 15.7.3c ("place
                // line numbers...at the right margin") — F-182: a genuine `linenum` segment,
                // not left-margin prefix text; wrapNumbered (via formatPlay's wrapBody, F-181)
                // moves it to the right margin of the braille line this print line begins on.
                // `.text` keeps the old "N " prefix for plain-text consumers (search, TTS)
                // that read the flat text field — only the RENDERING path (`.segments`)
                // changes here.
                t = lineNum + ' ' + t;
                segs = [{ type: 'linenum', text: lineNum }, ...segs];
                stanzaLinenum = '';
              }
              if (targetBlocks) targetBlocks.push(...pn.before);
              if (t && targetBlocks) {
                const blk = segsHaveEmphOrMath(segs) && segs.length
                  ? { type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segs }
                  : { type: 'play', subtype: 'verse', style: 'verse', text: t };
                if (lnLvl > 0) blk.level = lnLvl;
                lineBana(blk, ln);
                targetBlocks.push(blk);
                hasLinesInGroup = true;
              }
              if (targetBlocks) targetBlocks.push(...pn.after);
            }
          } else if (lnTag === 'byline' || lnTag === 'author' || lnTag === 'cite' || lnTag === 'attrib' || lnCls.includes('attribution') || lnCls.includes('byline')) {
            if (targetBlocks) pushAtomic(targetBlocks, ln, (t, segs) => (t ? (segs ? { type: 'attribution', text: t, segments: segs } : { type: 'attribution', text: t }) : null));
          } else if (lnTag === 'note') {
            if (targetBlocks) pushNote(targetBlocks, ln);
          } else if (lnTag === 'prodnote') {
            if (targetBlocks) pushProdnote(targetBlocks, ln, (t) => (t ? { type: 'note', text: t } : null));
          } else if (targetBlocks && !INLINE_TAGS.has(lnTag) && lnTag !== 'brl') {
            // Any other child keeps its content (A2): a container is read like a poem, text as a line.
            if (hasBlockChild(ln)) parsePoem(ln, targetBlocks, { bare: bareLinegroup, runId: bareLinegroupId });
            else pushAtomic(targetBlocks, ln, (t, segs) => (t ? (segs ? { type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segs } : { type: 'play', subtype: 'verse', style: 'verse', text: t }) : null));
          }
        }
        let nextSibling = c.nextSibling;
        let hasMoreStanzas = false;
        while (nextSibling) {
          if (nextSibling.nodeType === 1) {
            const nsTag = (nextSibling.localName || nextSibling.tagName || '').toLowerCase();
            const nsCls = (nextSibling.getAttribute ? (nextSibling.getAttribute('class') || '') : '').toLowerCase();
            if (nsTag === 'linegroup' || nsTag === 'stanza' || (nsTag === 'div' && (nsCls.includes('stanza') || nsCls.includes('linegroup') || nsCls.includes('verse')))) {
              hasMoreStanzas = true;
              break;
            }
          }
          nextSibling = nextSibling.nextSibling;
        }
        if (hasLinesInGroup && hasMoreStanzas && targetBlocks) {
          targetBlocks.push({ type: 'indicator', kind: 'line' });
        }
      } else if (cTag === 'line' || cTag === 'ln') {
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lnLvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        const pn = hoistPagenums(inlineSegments(c));
        let segs = pn.segs;
        let t = getCleanText(c);
        let innerLinenum = '';
        if (c.getElementsByTagName) {
          const numNode = findLinenum(c);
          if (numNode) innerLinenum = (numNode.textContent || '').trim();
        }
        const lineNum = innerLinenum || pendingLinenum;
        if (lineNum) {
          // F-182 — see the matching branch inside the <linegroup> handling above.
          t = lineNum + ' ' + t;
          segs = [{ type: 'linenum', text: lineNum }, ...segs];
          pendingLinenum = '';
        }
        if (targetBlocks) targetBlocks.push(...pn.before);
        if (t && targetBlocks) {
          const blk = segsHaveEmphOrMath(segs) && segs.length
            ? { type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segs }
            : { type: 'play', subtype: 'verse', style: 'verse', text: t };
          if (lnLvl > 0) blk.level = lnLvl;
          lineBana(blk, c);
          targetBlocks.push(blk);
        }
        if (targetBlocks) targetBlocks.push(...pn.after);
      } else if (cTag === 'linenum' || cCls.includes('linenum')) {
        pendingLinenum = (c.textContent || '').trim();
      } else if (cTag === 'p') {
        if (cCls.includes('bai-stanza-break') || cCls.includes('stanza-break')) {
          if (targetBlocks) targetBlocks.push({ type: 'indicator', kind: 'line' });
        } else if (targetBlocks) {
          const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
          const pLvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
          pushAtomic(targetBlocks, c, (t, segs) => {
            if (!t) return null;
            const blk = segs
              ? { type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segs }
              : { type: 'play', subtype: 'verse', style: 'verse', text: t };
            if (pLvl > 0) blk.level = pLvl;
            lineBana(blk, c);
            return blk;
          });
        }
      } else if (cTag === 'sidebar') {
        parseSidebar(c, targetBlocks);
      } else if (!targetBlocks) {
        // (nothing to emit into)
      } else if (cTag === 'imggroup') {                     // other block content a poem may hold (A28)
        parseImgGroup(c, targetBlocks);
      } else if (cTag === 'img' || cTag === 'image') {
        const src = (c.getAttribute && c.getAttribute('src')) || '';
        const alt = (c.getAttribute && c.getAttribute('alt')) || '';
        const g = { type: 'graphic', src, alt };
        const svg = svgFromDataUri(src);
        if (svg) g.svg = svg;
        targetBlocks.push(g);
      } else if (cTag === 'note') {
        pushNote(targetBlocks, c);
      } else if (cTag === 'prodnote' || cTag === 'annotation') {
        // A22: keep an imported render="required" (see the liTag branch above for D6's note).
        const renderAttr = (c.getAttribute && c.getAttribute('render')) || null;
        pushProdnote(targetBlocks, c, (t) => (t ? (renderAttr === 'required' || renderAttr === 'optional' ? { type: 'note', text: t, render: renderAttr } : { type: 'note', text: t }) : null));
      } else if (cTag === 'list') {
        parseSingleList(c, 0, targetBlocks);
      } else if (cTag === 'table') {
        parseTable(c, targetBlocks);
      } else if (cTag === 'epigraph') {
        // F-94 / §9.3.1c: not treated as displayed material like <blockquote> — its own style.
        pushAtomic(targetBlocks, c, (t, segs) => (t ? (segs ? { type: 'para', style: 'epigraph', text: t, segments: segs } : { type: 'para', style: 'epigraph', text: t }) : null));
      } else if (cTag === 'blockquote') {
        pushAtomic(targetBlocks, c, (t, segs) => (t ? (segs ? { type: 'para', style: 'quote', text: t, segments: segs } : { type: 'para', style: 'quote', text: t }) : null));
      } else if (c.textContent && c.textContent.trim()) {     // dateline and anything else with text
        pushAtomic(targetBlocks, c, (t, segs) => (t ? (segs ? { type: 'para', text: t, segments: segs } : { type: 'para', text: t }) : null));
      }
    }
    if (targetBlocks) {
      let poemId = 0;
      for (let i = poemStart; i < targetBlocks.length; i++) if (targetBlocks[i] && targetBlocks[i].poemRole) { poemId = ++poemHeadSeq; break; }
      for (let i = poemStart; i < targetBlocks.length; i++) {
        const b = targetBlocks[i];
        if (b && (b.type === 'pagenum' || b.type === 'indicator' || (b.type === 'play' && b.subtype === 'verse'))) {
          b.fromPoem = true;
          if (bareLinegroup) {
            b.bareLinegroup = true;
            b.bareLinegroupId = bareLinegroupId;
          }
        }
        if (poemId && b && (b.fromPoem || b.poemRole)) b.poemId = poemId;
      }
    }
  }

  function parseSidebar(sidebarEl, targetBlocks = blocks) {
    let boxTitle = null;
    const innerBlocks = [];
    const id = sidebarEl.getAttribute ? sidebarEl.getAttribute('id') : null;
    const render = sidebarEl.getAttribute ? sidebarEl.getAttribute('render') : null;

    let pend = null;                                        // see walk(): optional BANA fields of the previous element
    for (let c = sidebarEl.firstChild; c; c = c.nextSibling) {
      if (pend) { applyBanaFlags(pend.el, pend.tag, innerBlocks, pend.from); pend = null; }
      if (c.nodeType !== 1) continue;
      const cTag = (c.localName || c.tagName || '').toLowerCase();
      if ((c.getAttribute ? (c.getAttribute('class') || '') : '').toLowerCase().includes('bana-')) pend = { el: c, tag: cTag, from: innerBlocks.length };
      if (cTag === 'hd' || /^h[1-6]$/.test(cTag)) {
        const hdText = getCleanText(c);
        if (!boxTitle) {
          boxTitle = hdText;
        }
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : (/^h[1-6]$/.test(cTag) ? parseInt(cTag.slice(1), 10) : 2);
        pushAtomic(innerBlocks, c, (t, segs) => (segs ? { type: 'heading', level: lvl, text: t, segments: segs } : { type: 'heading', level: lvl, text: t }), { excludeTags: IMAGE_TAGS });
        innerBlocks.push(...imagesWithin(c));
      } else if (cTag === 'p') {
        const cls = (c.getAttribute ? (c.getAttribute('class') || '') : '').toLowerCase();
        const pLevel = getElementLevel(c);
        for (const im of (c.getElementsByTagName ? [...c.getElementsByTagName('img'), ...c.getElementsByTagName('image')] : [])) {
          innerBlocks.push({ type: 'graphic', src: (im.getAttribute && im.getAttribute('src')) || '', alt: (im.getAttribute && im.getAttribute('alt')) || '' });
        }
        const rawSegs = inlineSegments(c);
        const makeP = (t, segs) => {
          if (cls.includes('bai-play') || cls.includes('play-speaker') || cls.includes('speaker')) {
            return { type: 'play', subtype: 'prose', style: 'play-speaker', level: pLevel, text: t, segments: segs };
          } else if (cls.includes('bai-verse') || cls.includes('play-verse') || cls.includes('verse') || cls.includes('poem')) {
            // BANA §14.6.1a (F-180): D5's own "verse drama" class marker (bai-verse/play-verse,
            // the ONE thing that tells a verse-PLAY line apart from a genuine <poem> line, which
            // never reaches here — it goes through parsePoem instead) needs the wider 1-5/3-5
            // margin floor formatPlay applies only when block.playVerse is set; the more
            // ambiguous bare "verse"/"poem" class (an occasional prose-imported poem-as-<p>
            // fallback, not drama) keeps the plain poetry-nesting default, unchanged.
            const blk = { type: 'play', subtype: 'verse', style: 'verse', level: pLevel, text: t, segments: segs };
            if (cls.includes('bai-verse') || cls.includes('play-verse')) blk.playVerse = true;
            return blk;
          } else if (cls.includes('bai-stage') || cls.includes('play-stage') || cls.includes('stage')) {
            return { type: 'stage', style: 'play-stage', level: pLevel, text: t, segments: segs };
          } else if (cls.includes('bai-stanza-break') || cls.includes('stanza-break')) {
            return { type: 'indicator', kind: 'line' };
          } else if (cls.includes('bana-break-asterisks')) {
            return { type: 'break', kind: 'asterisks' };
          } else if (cls.includes('bana-break-dot2s')) {
            return { type: 'break', kind: 'dot2s' };
          } else if (t || (!segs && hasEmptyMark(c))) {   // A89: <p class="bana-empty"/> is an empty paragraph of its own
            // BANA Formats §1.9.3 (F-39): per-paragraph "blocked" flag, e.g. a box paragraph
            // (Example 4-6) that carries class="blocked" (see parse.mjs's top-level makeP).
            const blk = segs ? { type: 'para', segments: segs, text: t } : { type: 'para', text: t };
            if (cls.includes('blocked')) blk.blocked = true;
            if (!t && !segs) blk.keptEmpty = true;   // A89: saved empty on purpose (the editor gives it back as an empty paragraph the user made)
            return blk;
          }
          return null;
        };
        const t = getCleanText(c);
        if (rawSegs.length === 1 && rawSegs[0].type === 'math') {   // displayed equation in its own <p>
          const mathBlock = { type: 'math', mathml: rawSegs[0].mathml };
          if (rawSegs[0].latex) mathBlock.latex = rawSegs[0].latex;
          innerBlocks.push(mathBlock);
          continue;
        }
        if (segsHavePagenum(rawSegs)) {
          const probe = makeP(t, undefined);
          if (probe && probe.type === 'para') {
            pushParaParts(rawSegs, innerBlocks, makeP);
          } else {
            const pn = hoistPagenums(rawSegs);
            innerBlocks.push(...pn.before);
            const blk = makeP(t, segsHaveEmphOrMath(pn.segs) && pn.segs.length ? pn.segs : undefined);
            if (blk) innerBlocks.push(blk);
            innerBlocks.push(...pn.after);
          }
        } else {
          const blk = makeP(t, segsHaveEmphOrMath(rawSegs) && rawSegs.length ? rawSegs : undefined);
          if (blk) innerBlocks.push(blk);
        }
      } else if (cTag === 'speaker') {
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        pushAtomic(innerBlocks, c, (t, segs) => {
          if (!t) return null;
          const blk = segs
            ? { type: 'play', subtype: 'prose', style: 'play-speaker', text: t, segments: segs }
            : { type: 'play', subtype: 'prose', style: 'play-speaker', text: t };
          if (lvl > 0) blk.level = lvl;
          return blk;
        });
      } else if (cTag === 'stage') {
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        pushAtomic(innerBlocks, c, (t, segs) => {
          if (!t) return null;
          const blk = segs
            ? { type: 'stage', style: 'play-stage', text: t, segments: segs }
            : { type: 'stage', style: 'play-stage', text: t };
          if (lvl > 0) blk.level = lvl;
          return blk;
        });
      } else if (cTag === 'poem' || cTag === 'linegroup') {
        // A42: only a bare <linegroup> (no <poem> wrapper) is tagged — a real <poem> keeps
        // round-tripping with its wrapper, unchanged.
        parsePoem(c, innerBlocks, cTag === 'linegroup' ? { bare: true, runId: ++poemRunSeq } : {});
      } else if (cTag === 'line' || cTag === 'ln') {
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        pushAtomic(innerBlocks, c, (t, segs) => {
          if (!t) return null;
          const blk = segs
            ? { type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segs }
            : { type: 'play', subtype: 'verse', style: 'verse', text: t };
          if (lvl > 0) blk.level = lvl;
          return blk;
        });
      } else if (cTag === 'list' || cTag === 'ul' || cTag === 'ol') {
        parseSingleList(c, 0, innerBlocks);
      } else if (cTag === 'dl') {
        parseDefinitionList(c, innerBlocks);
      } else if (cTag === 'table') {
        parseTable(c, innerBlocks);
      } else if (cTag === 'caption') {
        pushTextOnly(innerBlocks, c, (t) => (t ? { type: 'caption', text: t } : null));
      } else if (cTag === 'note') {
        pushNote(innerBlocks, c);
      } else if (cTag === 'prodnote' || cTag === 'annotation') {
        const cls = (c.getAttribute ? (c.getAttribute('class') || '') : '').toLowerCase();
        // A22: keep an imported render="required" (see the liTag branch above for D6's note).
        const renderAttr = (c.getAttribute && c.getAttribute('render')) || null;
        pushProdnote(innerBlocks, c, (t) => {
          if (!t) return null;
          const blk = cls.includes('tabletn') ? { type: 'note', kind: 'tabletn', text: t } : { type: 'note', text: t };
          // A22/A43: keep the source's own value, either way — an Emboss-created note (no
          // value at all) is the only one the exporter defaults to required (D6).
          if (renderAttr === 'required' || renderAttr === 'optional') blk.render = renderAttr;
          return blk;
        });
      } else if (cTag === 'byline' || cTag === 'author' || cTag === 'cite' || cTag === 'attrib') {
        pushAtomic(innerBlocks, c, (t, segs) => (t ? (segs ? { type: 'attribution', text: t, segments: segs } : { type: 'attribution', text: t }) : null));
      } else if (cTag === 'sidebar' || (cTag === 'div' && (c.getAttribute ? (c.getAttribute('class') || '') : '').toLowerCase().includes('sidebar'))) {
        parseSidebar(c, innerBlocks);
      } else if (cTag === 'math' || cTag.endsWith(':math')) {
        let mathml = mathOuterXml(c);
        const alttext = c.getAttribute ? c.getAttribute('alttext') : null;
        let latex = alttext || null;
        const ann = c.getElementsByTagName ? [...c.getElementsByTagName('annotation'), ...c.getElementsByTagName('m:annotation')] : [];
        const texAnn = ann.find(a => (a.getAttribute ? (a.getAttribute('encoding') || '') : '').includes('tex'));
        if (texAnn && texAnn.textContent) latex = texAnn.textContent.trim();
        if (texAnn && mathml) mathml = texOnlyMathToMathML(mathml, latex) || mathml;   // A89
        if (!latex && mathml) latex = mathmlToLatex(mathml);
        const mathBlock = { type: 'math', mathml };
        if (latex) mathBlock.latex = latex;
        innerBlocks.push(mathBlock);
      } else if (cTag === 'imggroup') {
        parseImgGroup(c, innerBlocks);
      } else if (cTag === 'img' || cTag === 'image' || cTag === 'graphic') {
        const src = (c.getAttribute ? c.getAttribute('src') : '') || '';
        const alt = (c.getAttribute ? c.getAttribute('alt') : '') || '';
        const graphic = { type: 'graphic', src, alt };
        const svg = svgFromDataUri(src);
        if (svg) graphic.svg = svg;
        innerBlocks.push(graphic);
      } else if (cTag === 'blockquote') {
        const hasElements = Array.from(c.childNodes || []).some((childNode) => childNode.nodeType === 1);
        if (hasElements) {
          for (let bcn = c.firstChild; bcn; bcn = bcn.nextSibling) {
            if (bcn.nodeType !== 1) continue;
            const bcnTag = (bcn.localName || bcn.tagName || '').toLowerCase();
            if (PAGENUM_TAGS.has(bcnTag)) {
              const pn = pagenumBlock(bcn);
              if (pn) innerBlocks.push(pn);
              continue;
            }
            if (bcnTag === 'byline' || bcnTag === 'author' || bcnTag === 'cite' || bcnTag === 'attrib') {
              pushAtomic(innerBlocks, bcn, (t, segs) => (t ? (segs ? { type: 'attribution', text: t, segments: segs } : { type: 'attribution', text: t }) : null));
            } else {
              pushParaParts(inlineSegments(bcn), innerBlocks, (t, segs) => (segs ? { type: 'para', style: 'quote', text: t, segments: segs } : { type: 'para', style: 'quote', text: t }));
            }
          }
        } else {
          pushParaParts(inlineSegments(c), innerBlocks, (t, segs) => (segs ? { type: 'para', style: 'quote', text: t, segments: segs } : { type: 'para', style: 'quote', text: t }));
        }
      } else if (PAGENUM_TAGS.has(cTag)) {
        const pn = pagenumBlock(c);
        if (pn) innerBlocks.push(pn);
      } else if (cTag === 'hr' || cTag === 'break') {
        const cls = (c.getAttribute ? (c.getAttribute('class') || '') : '').toLowerCase();
        if (cls.includes('stanza')) innerBlocks.push({ type: 'indicator', kind: 'line' });
        else if (cls.includes('asterisks')) innerBlocks.push({ type: 'break', kind: 'asterisks' });
        else if (cls.includes('dot2s')) innerBlocks.push({ type: 'break', kind: 'dot2s' });
        else innerBlocks.push({ type: 'break', kind: 'line' });
      } else if (!INLINE_TAGS.has(cTag) && cTag !== 'brl') {
        // Any other child (<div>, <epigraph>, <address>…) keeps its content (A2): a container
        // is read like a sidebar body, anything else is a paragraph.
        if (hasBlockChild(c)) {
          const tmp = [];
          parseSidebar(c, tmp);
          innerBlocks.push(...(tmp[0].blocks || []));
        } else {
          pushParaParts(inlineSegments(c), innerBlocks, (t, segs) => (t ? (segs ? { type: 'para', text: t, segments: segs } : { type: 'para', text: t }) : null));
        }
      }
    }

    if (pend) applyBanaFlags(pend.el, pend.tag, innerBlocks, pend.from);
    const box = { type: 'box' };
    if (id) box.id = id;
    box.render = render || 'required';                     // F4-02: the save always writes one (DTD #REQUIRED; default required), so record it now
    if (boxTitle) box.title = boxTitle;
    if (innerBlocks.length) box.blocks = innerBlocks;
    else {
      const fullText = getCleanText(sidebarEl);
      if (fullText) box.blocks = [{ type: 'para', text: fullText }];
    }
    targetBlocks.push(box);
  }

  // BANA Formats §11.3.1a distinguishes a table's HEADING (its own title, e.g. "Table 12:
  // Populations" — centred, §11.3.1a) from its CAPTION (§11.2.8: an explanatory blurb, 7-5
  // margins, never centred). DTBook gives exactly one element, <caption>, for both (F-4) —
  // so a `class="bana-heading"` on it is the signal this table's heading is a heading, not a
  // caption; `bana-heading-before-box` additionally marks BANA 11.3.1b's "before" placement
  // (the heading rendered outside/above an enclosing box's top line) — omitted, the default
  // is 'in-box' (right after the top line, formatTable's own centred rendering; see
  // document.mjs formatBox/formatTable). A <br/> inside a heading <caption> is a real,
  // hard print line break (e.g. a sequence number on its own line above the title proper,
  // BANA Example 11-4) — getTextLines keeps each one separate; a plain caption's own <br/>
  // stays cosmetic (getCleanText merges it to a space, unchanged).
  function getTextLines(el) {
    if (!el) return [];
    const lines = [''];
    (function collect(node) {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          lines[lines.length - 1] += child.nodeValue || '';
        } else if (child.nodeType === 1) {
          const tag = (child.localName || child.tagName || '').toLowerCase();
          if (tag === 'br') { lines.push(''); continue; }
          if (tag === 'img' || tag === 'image') { lines[lines.length - 1] += ' '; continue; }
          collect(child);
        }
      }
    })(el);
    return lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  function parseTable(tableEl0, targetBlocks = blocks) {
    // IMP-W6 (Paul, 30 Sep 2026), the same rule the other readers follow: a table nested in a cell leaves the outer table a table, its
    // place in the cell holds "(table follows)", and the inner table follows the outer as a table of its own (the tables nested in
    // that one after it). The rest of this function reads a copy of the table with each nested table replaced by the placeholder, so
    // its own rows, caption, page numbers and pictures are not read twice (they belong to the nested table, read on its own below).
    const nestedTables = htmlOwnDescendants(tableEl0, ['table']);
    let tableEl = tableEl0;
    if (nestedTables.length) {
      tableEl = htmlCopyWithoutNestedTables(tableEl0, tableEl0.ownerDocument || doc);
    }
    parseTableOwn(tableEl, targetBlocks, nestedTables);
  }
  function parseTableOwn(tableEl, targetBlocks, nestedTables) {
    let tabletnText = null;
    let captionText = null;
    let headingLines = null;             // set instead of captionText when class="bana-heading"
    let headingBeforeBox = false;

    for (let c = tableEl.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const cTag = (c.localName || c.tagName || '').toLowerCase();
      if (cTag === 'tabletn' || cTag.includes('tabletn')) {
        tabletnText = getCleanText(c);
      } else if (cTag === 'caption' || cTag === 'figcaption') {
        const cls = (c.getAttribute ? (c.getAttribute('class') || '') : '');
        if (cls.includes('bana-heading')) {
          headingLines = getTextLines(c);
          headingBeforeBox = cls.includes('bana-heading-before-box');
        } else {
          captionText = getCleanText(c);
        }
      }
    }

    // BANA 11.2.5f: "Insert print notes pertaining to a table after the table
    // title/label, but before the body of the table and any transcriber's notes." The
    // table's own caption/title IS the print "title/label" (§11.2.8/11.3.1); a
    // <tabletn> is the transcriber's note the rule says comes AFTER it — so the caption
    // block must be pushed first, then the tabletn note, then (by the caller) the table
    // body itself (F-3; standards-findings.md). Previously pushed tabletn before
    // caption, exactly backwards.
    if (captionText) {
      targetBlocks.push({ type: 'caption', text: captionText });
    }
    if (tabletnText) {
      targetBlocks.push({ type: 'note', kind: 'tabletn', text: tabletnText });
    }

    // A cell keeps its emphasis and maths (A25): plain text stays a string, anything
    // richer becomes { text, segments } (see format/cell-markup.mjs).
    // Stairstep (BANA §11.18.1f: a cell's later paragraphs sit two cells in) and listed
    // (§11.16.1g, KD 28 Sep 2026: a cell with several entries, one per print line — Sample
    // 11-24's Sec of State/Treasury/War/Navy columns): a <br/> in a cell is a paragraph/entry
    // break, kept as '\n' (nimas-export writes '\n' as <br/>, and document.mjs's
    // splitCellEntries reads it back to lay the entries out at 3-5 under a 1-5 heading).
    // Every other table format keeps the older <br/> -> space reading, unchanged.
    let brAsNewline = false;
    const BR_MARK = '\u0001';
    const cellValue = (el) => {
      if (!brAsNewline) return cellValueRaw(el);
      const brs = el.getElementsByTagName ? [...el.getElementsByTagName('br')] : [];
      for (const br of brs) br.parentNode.replaceChild(el.ownerDocument.createTextNode(BR_MARK), br);
      const v = cellValueRaw(el);
      const fix = (t) => String(t).split(' ' + BR_MARK + ' ').join('\n').split(BR_MARK + ' ').join('\n').split(' ' + BR_MARK).join('\n').split(BR_MARK).join('\n');
      if (typeof v === 'string') return fix(v);
      return { ...v, text: fix(v.text), segments: (v.segments || []).map((g) => (g.type === 'text' ? { ...g, text: fix(g.text) } : g)) };
    };
    const cellValueRaw = (el) => {
      const segs = segsWithoutPagenums(inlineSegments(el, false, new Set(['pagenum'])))
        .map((g) => (g.type === 'text' ? { ...g, text: g.text.replace(/\s+/g, ' ') } : g))
        .filter((g) => g.type !== 'text' || g.text);
      const keepEdge = hasPreserve(el);                      // A89: xml:space="preserve" keeps a space at the cell's edge
      if (!keepEdge && segs.length && segs[0].type === 'text') segs[0] = { ...segs[0], text: segs[0].text.replace(/^\s+/, '') };
      const last = segs.length - 1;
      if (!keepEdge && last >= 0 && segs[last].type === 'text') segs[last] = { ...segs[last], text: segs[last].text.replace(/\s+$/, '') };
      const kept = [];
      for (const g of segs) {
        if (g.type === 'text' && !g.text) continue;
        const last = kept[kept.length - 1];
        // A table-cell counterpart of the Stage 9 nodeToRuns fix: a plain merge-adjacent-runs
        // step must not swallow a link/cite segment into its plain-text neighbour (that would
        // either drop the href/cite — when the neighbour merged in has none — or wrongly widen
        // it over text that was never part of the link/cite).
        if (g.type === 'text' && last && last.type === 'text' && (last.tf || 0) === (g.tf || 0) && !!last.uncontracted === !!g.uncontracted && !last.href && !last.cite && !g.href && !g.cite && (last.transcriberTypeform || null) === (g.transcriberTypeform || null)) {
          kept[kept.length - 1] = { ...last, text: (last.text + g.text).replace(/\s+/g, ' ') };
        } else kept.push(g);
      }
      // BrailleBlaster test fixtures (TablesTestXml.xml): inlineSegments/getCleanText both
      // exclude <brl> from a cell's print text (above, and getCleanText's own tag==='brl'
      // exclusion) — right when the cell ALSO has real print text (the pre-supplied braille
      // is simply discarded; Emboss translates the print text itself). But a cell whose
      // ONLY content is a <brl> then reads as completely empty (`kept` empty, `getCleanText`
      // empty), and an all-empty row is dropped — silently losing the whole table when
      // every cell is brl-only (e.g. TablesTestXml.xml's "Examples from Braille Formats
      // 2011" tables). That <brl> content is the cell's actual content: literal braille,
      // modelled as a {type:'brl'} segment (F-187/F-188/F-222; document.mjs's groupSegments/
      // segmentsToBraille already render it). An empty <brl></brl> (genuinely no braille
      // either) still falls through to the plain '' cell below, same as before.
      if (!kept.length) {
        const brlEls = el.getElementsByTagName ? [...el.getElementsByTagName('brl')] : [];
        const brlText = brlEls.map((b) => b.textContent || '').join('');
        if (brlText) return cellFromSegments('', [{ type: 'brl', text: '', brl: brlText }]);
      }
      if (!kept.some((g) => g.type === 'math')) {
        const plain = getCleanText(el);
        // A19 Stage 3/4's own predicate gap: a cell whose only "rich" content is a <a href>/
        // <cite> segment (no tf/uncontracted/noteref) must still keep its segments, same as
        // every other href/cite consumer parse.mjs already covers — see the Stage 3 note on the
        // four other list-item predicates that needed this same s.href || s.cite addition.
        // type==='brl': the round-trip shape (<span class="bana-brl" title="…"> above) for a
        // brl-only cell — same gap, or the segment this function's own caller (cellValue) just
        // built survives one save/reload and is dropped again on the next (nimas_roundtrip
        // .test.mjs's AST1/AST2 parity: exportToNimasXml -> parseDtbook must keep it).
        // Sub/superscript (<sub>/<sup> in the cell, 30 Sep): the level markers stay in the cell's text, as the Word reader leaves
        // them — a cell whose only richness is a level is a plain string carrying the markers. getCleanText reads the digits only,
        // so without this a saved "x²" in a cell was a plain "x2" when the file was opened again (save -> reopen braille test).
        const withMarkers = kept.some((g) => g.type === 'text' && /[\uE000-\uE002]/.test(g.text || ''));
        return cellFromSegments(withMarkers ? kept.map((g) => g.text || '').join('') : plain, kept.some((g) => g.tf || g.uncontracted || g.type === 'noteref' || g.type === 'brl' || g.href || g.cite || g.transcriberTypeform || g.lang) ? kept : null);
      }
      const plain = kept.map((g) => (g.type === 'math' ? (g.latex || '') : g.text)).join('');
      return cellFromSegments(plain, kept);
    };
    // A cell counts as having content when it prints something (a non-empty string, or an
    // object cell with real `.text`) OR carries a rich segment with no print equivalent of
    // its own — literal braille (a <brl>-only cell above; F-187/F-188/F-222) is exactly
    // this: `text` is deliberately '' (there is no print this braille stands for), so the
    // plain `v.text` truthiness check below would wrongly call it blank and drop its whole
    // row. cellFromSegments only ever returns a `{text, segments}` object when something in
    // it is genuinely rich, so any non-empty segments array here is real content.
    const cellHasContent = (v) => (typeof v === 'string' ? !!v : !!(v && (v.text || (Array.isArray(v.segments) && v.segments.length))));

    const cls = tableEl.getAttribute ? (tableEl.getAttribute('class') || '') : '';
    let format = null;
    if (cls.includes('bana-listed') || cls.includes('listed')) { format = 'listed'; brAsNewline = true; }
    // T4 (EMBOSS-TASKS.md, Paul's decision 17 Sep 2026): BANA §11.14 Wide Tables: Vertical
    // Division, round-tripped as class="bana-vertical" (see nimas-export.mjs's table case).
    else if (cls.includes('bana-vertical') || cls.includes('vertical')) format = 'vertical';
    // BANA §11.18 Stairstep / §11.17 Linear (T4, F-18): class="bana-stairstep" / "bana-linear".
    // Stairstep's subdivision data (§11.18.1j) is `<tr class="bana-subdivision">` on each
    // subdivision row plus the heading's text in the table's own DTBook `title` attribute
    // (allowed on <table> via %coreattrs; — see nimas-export.mjs's table case).
    else if (cls.includes('bana-stairstep')) { format = 'stairstep'; brAsNewline = true; }
    else if (cls.includes('bana-linear')) format = 'linear';
    else if (cls.includes('bana-facing')) format = 'facing';   // K15: BANA §11.13 facing pages (nimas-export.mjs)
    else if (cls.includes('bana-interchange')) format = 'interchange';   // BANA §11.15 interchanged columns and rows (nimas-export.mjs)
    else if (cls.includes('bana-spatial') || cls.includes('spatial')) format = 'spatial';
    const subdivisionRows = [];
    const totalRows = [];                                    // bana-total rows (F-17)
    const rowSubheadings = [];                               // bana-subheading rows (F-12): { row, text } above data row `row`
    let citation = null;                                     // <tfoot> bana-table-citation row (F-7)
    const trHas = (tr, token) => new RegExp(`(^|\\s)${token}(\\s|$)`).test(tr.getAttribute ? (tr.getAttribute('class') || '') : '');

    const trs = tableEl.getElementsByTagName ? [...tableEl.getElementsByTagName('tr')] : [];
    const headers = [];
    const rows = [];

    // F-1 companion (BrailleBlaster test fixtures use colspan="20" on a table whose other
    // rows are 4 columns wide, to exercise exactly this): the table's real column count —
    // mostCommonRowWidth (shared with the HTML table reader's own colspan clamp, above) —
    // used below to clamp an over-wide colspan to whatever columns are actually left in
    // its row, rather than let it balloon the whole table out to an artificial width.
    const trColspanSum = (tr) => {
      let sum = 0;
      for (let c = tr.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        const t = (c.localName || c.tagName || '').toLowerCase();
        if (t !== 'td' && t !== 'th') continue;
        sum += htmlSpan(c, 'colspan');
      }
      return sum;
    };
    const tableColCount = mostCommonRowWidth(trs.map(trColspanSum));
    // Only an EXTREME overflow (more than double the table's typical width — the
    // BrailleBlaster fixture's colspan="20" on a 4-column table is 5x) is clamped. A modest
    // colspan that simply runs a column or two past the header (parse-regressions.test.mjs
    // #12: a plain colspan="2" cell widens a 2-column table to 4 — real, intentional
    // padding, not a bug) is left exactly as before; only a colspan so large it can only be
    // a mistake gets capped to whatever columns are actually left in its row.
    const clampColspan = (raw, col) => (tableColCount > 0 && raw > tableColCount * 2 ? Math.max(1, Math.min(raw, tableColCount - col)) : raw);

    // A rowspanned cell occupies its column in every row it covers, not just its own <tr>
    // (F-1: parseTable used to read colspan but never rowspan, so a later row lost a cell
    // and everything after it shifted left). BANA 11.5.3a: "When a row heading is not
    // repeated but refers to more than one column entry, leave the area(s) where the
    // inferred row heading(s) belong blank" — Emboss applies the same blank fill to any
    // rowspanned cell (row heading or column entry) so later columns never shift. rowSpans
    // tracks, per column, how many further rows still owe a blank; it is shared across the
    // whole table (thead rows, then body rows) since a span can run from one into the other.
    const rowSpans = new Map();
    const spanPending = (col) => rowSpans.has(col);
    const consumeSpan = (col) => {
      const left = rowSpans.get(col) - 1;
      if (left > 0) rowSpans.set(col, left); else rowSpans.delete(col);
    };
    const registerSpan = (col, rowspan) => { if (rowspan > 1) rowSpans.set(col, rowspan - 1); };
    // New problem 4 (real-book re-check, 24 Sep): the blank fill above is right for SPATIAL
    // format (BANA 11.5.3a, quoted above), but a LISTED table has no rule allowing a row to
    // go without its cell-5 heading — 11.16.1e: "Format the first column heading... as a
    // cell-5 heading" for every entry. With the print giving no text of its own for the
    // rows a first-column rowspan covers, the spanning cell's own text is the only text
    // there is to use, so it is repeated into column 0 of every row it covers (bana-listed
    // tables only — column 0 only; every other spanned column keeps the 11.5.3a blank
    // exactly as before, and non-listed formats are untouched).
    const rowHeadingFill = new Map(); // column 0 rowspan text, listed format only
    const blankFor = (col) => (format === 'listed' && col === 0 && rowHeadingFill.has(0) ? rowHeadingFill.get(0) : '');
    // K3 (BANA 11.6.1d, transcriber KD): print's own column alignment, voted from each data
    // cell's own align/style (markupCellAlign, shared with the HTML table reader above) —
    // only from BODY rows (readSpannedRow is only ever called for those; the header row(s)
    // are read separately below), same convention as every other reader's K3 work.
    const colAlignVotes = [];
    // Reads one <tr>'s th/td elements into a column-aligned row: colspan pads a blank cell
    // after the cell it belongs to (pre-existing), a pending rowspan from an earlier row
    // blanks its column here (F-1), and any rowspan on this row's own cells is registered
    // for the rows still to come — including a rowspan on the last cell, which is beyond
    // the reach of the cell-by-cell loop and only cleared by the trailing while below. A
    // rowspan reaching past the table's last row simply leaves rowSpans non-empty when
    // parsing ends, which is harmless.
    const readSpannedRow = (cellEls) => {
      const out = [];
      let col = 0;
      for (const cellEl of cellEls) {
        while (spanPending(col)) { out.push(blankFor(col)); consumeSpan(col); col++; }
        const value = cellValue(cellEl);
        const colspan = clampColspan(htmlSpan(cellEl, 'colspan'), col);
        const rowspan = htmlSpan(cellEl, 'rowspan');
        out.push(value);
        const al = markupCellAlign(cellEl);
        if (al) (colAlignVotes[col] ||= new Set()).add(al);
        registerSpan(col, rowspan);
        if (col === 0 && rowspan > 1 && format === 'listed') rowHeadingFill.set(0, value);
        else if (col === 0 && !spanPending(0)) rowHeadingFill.delete(0);
        col++;
        for (let k = 1; k < colspan; k++) {
          while (spanPending(col)) { out.push(blankFor(col)); consumeSpan(col); col++; }
          out.push('');
          registerSpan(col, rowspan);
          col++;
        }
      }
      while (spanPending(col)) { out.push(blankFor(col)); consumeSpan(col); col++; }
      return out;
    };

    const thead = tableEl.getElementsByTagName ? tableEl.getElementsByTagName('thead')[0] : null;
    let headerRowFound = false;
    // BANA §11.4.3 (Complex Tables with Column and Sub-column Headings): a second, primary
    // heading tier — set when `<thead>` has exactly two rows of nothing but `<th>` cells
    // (see below). `headerGroups` = [{ text, from, to }], 0-based inclusive column span;
    // `headers` stays the flat sub-column/single-tier row (F-12's data model — a column
    // with no group over it, e.g. a `th[rowspan]` heading beside a two-tier group, BANA
    // Sample 11-2's "Fiscal Year", has no headerGroups entry at all).
    let headerGroups = null;

    const extraHeadRows = [];                                // further <thead> rows lead the body (A28)
    if (thead) {
      const theadTrs = [...thead.getElementsByTagName('tr')];
      const thCellsOf = (tr) => {
        const cells = [];
        for (let c = tr.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          const tag = (c.localName || c.tagName || '').toLowerCase();
          if (tag === 'th' || tag === 'td') cells.push({ tag, el: c });
        }
        return cells;
      };
      const row1Cells = theadTrs.length > 0 ? thCellsOf(theadTrs[0]) : [];
      const row2Cells = theadTrs.length > 1 ? thCellsOf(theadTrs[1]) : [];
      const hasSpanSignal = row1Cells.some(({ el }) => {
        const colspan = htmlSpan(el, 'colspan');
        const rowspan = htmlSpan(el, 'rowspan');
        return colspan > 1 || rowspan > 1;
      });
      // BANA §11.4.3 is specifically a HIERARCHICAL relationship — a primary heading
      // spanning two or more sub-columns (colspan), or a single-tier heading spanning
      // both header rows (rowspan) beside such a group. Two plain <th> rows with
      // neither (no span signal at all) encode no such hierarchy — e.g.
      // corpus_word_losses.test.mjs's "every <thead> row is kept" case, a table whose
      // second head row is just a second row of plain sub-labels — so that shape keeps
      // the pre-existing behaviour (second row leads the body, extraHeadRows below)
      // rather than being guessed into a headerGroups structure the markup never signalled.
      const isTwoTierHeader = theadTrs.length === 2
        && row1Cells.length > 0 && row2Cells.length > 0
        && row1Cells.every((x) => x.tag === 'th') && row2Cells.every((x) => x.tag === 'th')
        && hasSpanSignal;

      if (isTwoTierHeader) {
        // Row 1: a `colspan > 1` cell is a GROUP's primary heading over its sub-columns
        // (11.4.3); a `rowspan > 1` cell is a single-tier heading that spans both header
        // rows (no group; its text is the flat heading for that column, e.g. "Fiscal
        // Year" or "Year" beside a two-tier group — Samples 11-2/11-9/11-13/11-15). A
        // plain (colspan=1, rowspan=1) cell with real text is not exercised by any BANA
        // §11 gold sample; kept as its own one-column group rather than dropped.
        const groups = [];
        const spanningText = new Map();          // column -> row-1 cell's own text (rowspan)
        const flatHeaders = [];
        let col = 0;
        for (const { el } of row1Cells) {
          const colspan = htmlSpan(el, 'colspan');
          const rowspan = htmlSpan(el, 'rowspan');
          const value = cellValue(el);
          if (rowspan > 1) {
            spanningText.set(col, value);
          } else if (colspan > 1) {
            groups.push({ text: value, from: col, to: col + colspan - 1 });
          } else if (!cellIsBlank(value)) {
            groups.push({ text: value, from: col, to: col });
          }
          col += colspan;
        }
        // Row 2: its cells map, left to right, onto every column NOT already claimed by
        // a row-1 rowspan (F-1's own rowspan-bookkeeping approach, applied to headers).
        let col2 = 0;
        for (const { el } of row2Cells) {
          while (spanningText.has(col2)) col2++;
          const colspan = htmlSpan(el, 'colspan');
          flatHeaders[col2] = cellValue(el);
          col2++;
          for (let k = 1; k < colspan; k++) { flatHeaders[col2] = ''; col2++; }
        }
        for (const [c, text] of spanningText) flatHeaders[c] = text;
        const colCount2 = Math.max(col, col2, ...groups.map((g) => g.to + 1), 0);
        for (let c = 0; c < colCount2; c++) if (flatHeaders[c] === undefined) flatHeaders[c] = '';
        headers.push(...flatHeaders);
        headerGroups = groups;
        headerRowFound = true;
      } else if (theadTrs.length) {
        // theadTrs[0] is read first, and its rowspans registered, before theadTrs.slice(1)
        // below reads any later head row — a rowspan on the first header row (F-1) must
        // already be in rowSpans by the time a later row checks for it. `col` tracks the
        // intended column position for span bookkeeping even where it runs ahead of
        // headers.length.
        //
        // New problem 4 (real-book re-check, 24 Sep): a single-row `<th colspan>` here is
        // NOT the isTwoTierHeader case above (no second all-<th> row of sub-headings), so
        // there is no sub-heading text for the columns it covers. BANA 11.16.1d requires
        // every column to have a heading, so the spanning cell's own text is repeated for
        // each column it covers rather than left for the formatter to invent "Col n".
        let col = 0;
        for (let c = theadTrs[0].firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          const tag = (c.localName || c.tagName || '').toLowerCase();
          if (tag === 'th' || tag === 'td') {
            const value = cellValue(c);
            const colspan = htmlSpan(c, 'colspan');
            const rowspan = htmlSpan(c, 'rowspan');
            for (let k = 0; k < colspan; k++) headers.push(value);
            for (let k = 0; k < colspan; k++) registerSpan(col + k, rowspan);
            col += colspan;
          }
        }
        headerRowFound = true;
      }
      if (!isTwoTierHeader) {
        for (const tr of theadTrs.slice(1)) {
          const cellEls = [];
          for (let c = tr.firstChild; c; c = c.nextSibling) {
            if (c.nodeType !== 1) continue;
            const tag = (c.localName || c.tagName || '').toLowerCase();
            if (tag === 'th' || tag === 'td') cellEls.push(c);
          }
          const rowCells = readSpannedRow(cellEls);
          if (rowCells.some(cellHasContent)) extraHeadRows.push(rowCells);
        }
      }
    }

    // BUG (24 Sep, EMBOSS-TASKS.md section T): a table's first row can be its TITLE, not
    // its column heading — ONE cell spanning every column (BANA §11.3.1a; e.g. the NIMAS
    // anthology's own "Present-Tense Verb Forms", colspan="2" over a 2-column body —
    // 9780544087507NIMAS.xml). Recognised only when no <thead> has already supplied a
    // header, and the row genuinely has just the one cell — its colspan matching the
    // table's real column count (the widest colspan total among the OTHER rows), or simply
    // no colspan at all on a >=2-column table, since a lone cell already spans every column
    // there is. Moved to `tblBlock.title` below (the same field a `bana-heading` <caption>
    // already round-trips through <caption class="bana-heading">, nimas-export.mjs) so the
    // loop's existing header checks just below — an all-<th> row, or one wholly bold
    // (firstRowIsBoldHeader) — see the REAL heading (e.g. "Singular" / "Plural") as the
    // table's first row instead of a fake one-cell data row. A spanning row further down
    // (more than one cell in the row, or not the table's leading row) is left alone — row-
    // subheading territory, not a title.
    let spanningTitleRow = null;
    if (!thead) {
      const rowCellEls = (tr) => {
        const out = [];
        for (let c = tr.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          const t = (c.localName || c.tagName || '').toLowerCase();
          if (t === 'td' || t === 'th') out.push(c);
        }
        return out;
      };
      const colspanOf = (el) => htmlSpan(el, 'colspan');
      const bodyTrs = trs.filter((tr) => !trHas(tr, 'bana-table-citation') && !trHas(tr, 'bana-subheading'));
      if (bodyTrs.length >= 2) {
        const firstCells = rowCellEls(bodyTrs[0]);
        if (firstCells.length === 1) {
          let colCount = 0;
          for (let k = 1; k < bodyTrs.length; k++) {
            const sum = rowCellEls(bodyTrs[k]).reduce((a, c) => a + colspanOf(c), 0);
            if (sum > colCount) colCount = sum;
          }
          const firstColspan = colspanOf(firstCells[0]);
          if (colCount >= 2 && (firstColspan === colCount || firstColspan <= 1)) {
            spanningTitleRow = bodyTrs[0];
          }
        }
      }
    }
    let spanningTitleText = null;

    rows.push(...extraHeadRows);
    for (let i = 0; i < trs.length; i++) {
      const tr = trs[i];
      if (thead && tr.parentNode === thead) continue;
      if (trHas(tr, 'bana-table-citation')) {
        const t = getCleanText(tr).replace(/\s+/g, ' ').trim();
        if (t) citation = trHas(tr, 'bana-citation-inside') ? { text: t, position: 'inside-box' } : t;
        continue;
      }
      if (trHas(tr, 'bana-subheading')) {
        const t = getCleanText(tr).replace(/\s+/g, ' ').trim();
        if (t) rowSubheadings.push({ row: rows.length, text: t });
        continue;
      }
      const cells = [];
      for (let c = tr.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        const tag = (c.localName || c.tagName || '').toLowerCase();
        if (tag === 'th' || tag === 'td') {
          cells.push(c);
        }
      }

      if (tr === spanningTitleRow) {
        spanningTitleText = getCleanText(cells[0]);
        continue;
      }

      // New problem 4 (real-book re-check, 24 Sep): both header-promotion branches below
      // used to push exactly one `headers` entry per <th>/<td>, ignoring colspan — a
      // heading spanning two columns left the last column with no heading at all, so
      // formatListed invented "Col n" for it. Neither branch has a second header row to
      // draw distinct sub-headings from (that is the isTwoTierHeader/headerGroups case in
      // the <thead> branch above, BANA §11.4.3), so per BANA 11.16.1d ("each column
      // heading is followed by a colon" — every column needs one) the spanning cell's own
      // text is repeated for each column it covers.
      if (!headerRowFound && cells.length && cells.every(c => (c.localName || c.tagName || '').toLowerCase() === 'th')) {
        let col = 0;
        for (const c of cells) {
          const value = cellValue(c);
          const colspan = clampColspan(htmlSpan(c, 'colspan'), col);
          const rowspan = htmlSpan(c, 'rowspan');
          for (let k = 0; k < colspan; k++) headers.push(value);
          for (let k = 0; k < colspan; k++) registerSpan(col + k, rowspan);
          col += colspan;
        }
        headerRowFound = true;
      } else if (!headerRowFound && rows.length === 0 && cells.length && !trHas(tr, 'bana-body-row') && firstRowIsBoldHeader(cells.map(cellValue))) {
        // Bug 2 (Emboss/docs/real-book-validation-24sep.md): no <thead>/<th>, but this
        // table's FIRST row is the print heading row — every non-empty cell wholly bold
        // (e.g. "Word | Definition | Related Forms" in bold <td>s). BANA 11.16.1d-e: the
        // column heading is the print heading, so promote it instead of reading it as a
        // data row (which would otherwise make formatListed invent "Col n:"/"Row n").
        let col = 0;
        for (const c of cells) {
          const value = cellValue(c);
          const colspan = clampColspan(htmlSpan(c, 'colspan'), col);
          const rowspan = htmlSpan(c, 'rowspan');
          for (let k = 0; k < colspan; k++) headers.push(value);
          for (let k = 0; k < colspan; k++) registerSpan(col + k, rowspan);
          col += colspan;
        }
        headerRowFound = true;
      } else {
        const rowCells = readSpannedRow(cells);
        if (rowCells.some(cellHasContent) || (trHas(tr, 'bana-empty') && rowCells.length)) {   // A89: <tr class="bana-empty"> is a blank row
          if (format === 'stairstep' && /(^|\s)bana-subdivision(\s|$)/.test(tr.getAttribute ? (tr.getAttribute('class') || '') : '')) subdivisionRows.push(rows.length);
          if (trHas(tr, 'bana-total')) totalRows.push(rows.length);
          rows.push(rowCells);
        }
      }
    }

    // Cells cannot be split: page turns inside the table are placed before/after it.
    const pn = collectPagenums(tableEl);
    targetBlocks.push(...pn.before);
    if (headers.length || rows.length) {
      const tblBlock = { type: 'table', headers, rows };
      // K3: <col>/<colgroup> (nimas-export.mjs's own round-trip form, column-level, explicit
      // authorial intent) wins over the per-cell vote (a column whose td/th cells disagree,
      // or carry no signal at all).
      {
        const directCols = directTableCols(tableEl);
        const colsAlign = directCols.map(markupCellAlign);
        const alignCols = Math.max(colsAlign.length, colAlignVotes.length);
        const printAlign = Array.from({ length: alignCols }, (_, c) => {
          const s = colAlignVotes[c];
          return colsAlign[c] || (s && s.size === 1 ? [...s][0] : undefined);
        });
        if (printAlign.some(Boolean)) tblBlock.printAlign = printAlign;
        // K35: the transcriber's own override, the same <col>'s class (nimas-export.mjs).
        const columnAlign = directCols.map(markupColumnAlignOverride);
        if (columnAlign.some(Boolean)) tblBlock.columnAlign = columnAlign;
      }
      if (headerGroups && headerGroups.length) tblBlock.headerGroups = headerGroups;
      if (format) {
        tblBlock.format = format;
        tblBlock.style = `table-${format}`;
      }
      if (subdivisionRows.length) {
        tblBlock.subdivisionRows = subdivisionRows;
        const sh = tableEl.getAttribute ? (tableEl.getAttribute('title') || '') : '';
        if (sh) tblBlock.subdivisionHeading = sh;
      }
      if (totalRows.length) tblBlock.totalRows = totalRows;
      if (rowSubheadings.length) tblBlock.rowSubheadings = rowSubheadings;
      if (citation) tblBlock.citation = citation;
      if (headingLines && headingLines.length) {
        tblBlock.title = headingLines.length > 1 ? headingLines : headingLines[0];
        tblBlock.titlePosition = headingBeforeBox ? 'before-box' : 'in-box';
      } else if (spanningTitleText) {
        // Match the headingLines branch above exactly (round-trip stability, F-4-style): a
        // saved-then-reopened table reads this same text back through <caption
        // class="bana-heading"> with no "-before-box" modifier, which always sets
        // titlePosition — so the FIRST parse must set it too, not leave it undefined.
        tblBlock.title = spanningTitleText;
        tblBlock.titlePosition = 'in-box';
      }
      targetBlocks.push(tblBlock);
    }
    targetBlocks.push(...imagesWithin(tableEl));           // a cell holds text only: its images follow the table (A2)
    targetBlocks.push(...pn.after);
    for (const nt of nestedTables) parseTable(nt, targetBlocks);     // IMP-W6: each nested table follows, as a table of its own
  }

  // <hd> (a DTBook "generic heading", used inside <level1>...<level6> containers,
  // <sidebar>, <list>, etc.) carries no level of its own — its level is implied by
  // how deep its nearest <levelN> ancestor nests. Walk up to the first level1..level6
  // and use N; if <hd> isn't inside any <levelN> (e.g. a bare <sidebar>/<list> box),
  // keep the pre-existing default of 2.
  function nearestLevelDepth(node, fallback) {
    for (let p = node.parentNode; p && p.nodeType === 1; p = p.parentNode) {
      const pTag = (p.localName || p.tagName || '').toLowerCase();
      const m = pTag.match(/^level([1-6])$/);
      if (m) return parseInt(m[1], 10);
    }
    return fallback;
  }

  // Transcriber's Notes page (block `tnpage`; nimas-export.mjs's renderTnPageLevel writes it):
  // a <level1 class="bana-transcriber-notes">, or -- in <frontmatter> -- any level1 whose
  // heading reads "Transcriber's Notes" (any case, straight or curly apostrophe).
  const TNPAGE_HEADING_RE = /^transcriber['\u2019\u2018`\u00B4]?s\s+notes$/i;
  function tnPageHeadingEl(el) {
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const t = (c.localName || c.tagName || '').toLowerCase();
      if (/^h[1-6]$/.test(t) || t === 'hd') return c;
      if (t === 'pagenum' || t === 'print-page') continue;
      return null;
    }
    return null;
  }
  function isTnPageLevel(el) {
    const cls = (el.getAttribute ? (el.getAttribute('class') || '') : '').toLowerCase().split(/\s+/);
    if (cls.includes('bana-transcriber-notes')) return true;
    const par = el.parentNode && el.parentNode.nodeType === 1 ? (el.parentNode.localName || el.parentNode.tagName || '').toLowerCase() : '';
    if (par !== 'frontmatter') return false;
    const h = tnPageHeadingEl(el);
    return !!h && TNPAGE_HEADING_RE.test(getCleanText(h).replace(/\s+/g, ' ').trim());
  }
  function parseTnPage(el) {
    const h = tnPageHeadingEl(el);
    const headText = h ? getCleanText(h).replace(/\s+/g, ' ').trim() : '';
    const entries = [];
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1 || c === h) continue;
      const t = (c.localName || c.tagName || '').toLowerCase();
      if (PAGENUM_TAGS.has(t)) continue;
      const text = getCleanText(c);
      if (!text) continue;
      const one = { text };
      if (t === 'p') {
        const segs = inlineSegments(c);
        if (segsHaveEmphOrMath(segs) && segs.length) one.segments = segs;
      }
      const cont = t === 'p' && ((c.getAttribute && c.getAttribute('class')) || '').toLowerCase().split(/\s+/).includes('bana-tn-continued');
      if (cont && entries.length) (entries[entries.length - 1].paragraphs ||= []).push(one);
      else entries.push(one);
    }
    const blk = { type: 'tnpage', matter: 'transcriber', entries };
    if (headText && !TNPAGE_HEADING_RE.test(headText)) blk.heading = headText;
    blocks.push(blk);
  }

  // Special Symbols page (block `sympage`; nimas-export.mjs's renderSymPageLevel writes it): a
  // <level1 class="bana-special-symbols"> (class bana-symbols-auto = automatic page), or -- in
  // <frontmatter> -- any level1 headed "Special Symbols (used in this volume)". Each
  // <p class="bana-symbol" title="CELLS<U+2016>GLYPH">meaning</p> is one entry.
  const SYMPAGE_HEADING_RE = /^special\s+symbols(\s+used\s+in\s+this\s+(volume|book))?$/i;
  function isSymPageLevel(el) {
    const cls = (el.getAttribute ? (el.getAttribute('class') || '') : '').toLowerCase().split(/\s+/);
    if (cls.includes('bana-special-symbols')) return true;
    const par = el.parentNode && el.parentNode.nodeType === 1 ? (el.parentNode.localName || el.parentNode.tagName || '').toLowerCase() : '';
    if (par !== 'frontmatter') return false;
    const h = tnPageHeadingEl(el);
    return !!h && SYMPAGE_HEADING_RE.test(getCleanText(h).replace(/\s+/g, ' ').trim());
  }
  function parseSymPage(el) {
    const h = tnPageHeadingEl(el);
    const headText = h ? getCleanText(h).replace(/\s+/g, ' ').trim() : '';
    const cls = (el.getAttribute('class') || '').toLowerCase().split(/\s+/);
    const entries = [];
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1 || c === h) continue;
      const t = (c.localName || c.tagName || '').toLowerCase();
      if (PAGENUM_TAGS.has(t)) continue;
      const desc = getCleanText(c).replace(/\s+/g, ' ').trim();
      const isSym = t === 'p' && ((c.getAttribute && c.getAttribute('class')) || '').toLowerCase().split(/\s+/).includes('bana-symbol');
      if (!isSym && !desc) continue;
      const [braille, print] = isSym ? String((c.getAttribute && c.getAttribute('title')) || '').split('\u2016') : ['', ''];
      const e = { braille: (braille || '').trim() };
      if ((print || '').trim()) e.print = print.trim();
      if (desc) e.description = desc;
      entries.push(e);
    }
    const blk = { type: 'sympage', matter: 'transcriber' };
    if (headText && !SYMPAGE_HEADING_RE.test(headText)) blk.heading = headText;
    if (cls.includes('bana-symbols-auto')) blk.auto = true;
    if (entries.length || !blk.auto) blk.entries = entries;
    blocks.push(blk);
  }

  // Title Page (block `titlepage`; nimas-export.mjs's renderTitlePageLevel writes it): a
  // <level1 class="bana-title-page"> (plus "bana-tp-auto" for an untouched page, same convention as
  // sympage's "bana-symbols-auto"), no heading. Each <div class="bana-tp-segment" title="Name"> holds
  // that segment's <p> lines; each line mixes plain text with <span class="bana-field" title="key">
  // chips (K29 Stage 1c, design §3.2) — title="key:idx" for a list field's (authors/isbn) entry.
  function isTitlePageLevel(el) {
    const cls = (el.getAttribute ? (el.getAttribute('class') || '') : '').toLowerCase().split(/\s+/);
    return cls.includes('bana-title-page');
  }
  function parseTitlePage(el) {
    const cls = (el.getAttribute('class') || '').toLowerCase().split(/\s+/);
    const auto = cls.includes('bana-tp-auto');
    const blk = { type: 'titlepage', matter: 'transcriber' };
    if (auto) { blk.auto = true; blocks.push(blk); return; }
    const segments = [];
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const t = (c.localName || c.tagName || '').toLowerCase();
      if (t !== 'div' || !((c.getAttribute('class') || '').toLowerCase().split(/\s+/).includes('bana-tp-segment'))) continue;
      const name = c.getAttribute('title') || '';
      const lines = [];
      for (let p = c.firstChild; p; p = p.nextSibling) {
        if (p.nodeType !== 1 || (p.localName || p.tagName || '').toLowerCase() !== 'p') continue;
        const parts = [];
        for (let n = p.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 3) { const text = n.nodeValue || ''; if (text) parts.push({ lit: text }); }
          else if (n.nodeType === 1 && (n.localName || n.tagName || '').toLowerCase() === 'span'
            && (n.getAttribute('class') || '').toLowerCase().split(/\s+/).includes('bana-field')) {
            const raw = n.getAttribute('title') || '';
            const m = /^(.*):(\d+)$/.exec(raw);   // a list field (authors/isbn) carries its index as "field:idx"
            parts.push(m ? { fld: m[1], idx: Number(m[2]), value: getCleanText(n) } : { fld: raw, value: getCleanText(n) });
          }
        }
        if (parts.length) {
          const pCls = (p.getAttribute('class') || '').toLowerCase().split(/\s+/);
          lines.push({ parts, ...(pCls.includes('bana-tp-etal') ? { etAl: true } : {}), ...(pCls.includes('bana-tp-cell3') ? { cell3: true } : {}) });
        }
      }
      segments.push({ name, lines });
    }
    blk.segments = segments;
    blocks.push(blk);
  }

  // Optional BANA formatter fields (bana-<field> class tokens; see nimas-export.mjs's BANA_FLAG_FIELDS):
  // applied to whatever blocks one element produced, once the element has been read.
  // K11 / BANA 14.10.4b: 'caption' added so <caption class="bana-after-note"> (a single-frame
  // cartoon's caption running straight on from its scene-setting note) reads back afterNote.
  const BANA_FLAG_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hd', 'p', 'prodnote', 'list', 'speaker', 'bai-play', 'bai-verse', 'dl', 'note', 'table', 'img', 'imggroup', 'sidebar', 'caption']);
  function applyBanaFlags(el, tag, arr, from) {
    if (!BANA_FLAG_TAGS.has(tag) || !el.getAttribute) return;
    const tokens = (el.getAttribute('class') || '').toLowerCase().split(/\s+/).filter((t) => t.startsWith('bana-'));
    if (!tokens.length) return;
    const title = el.getAttribute('title') || null;
    for (let i = from; i < arr.length; i++) readBanaFlags(arr[i], tokens, title);
  }

  function walk(node) {
    let pend = null;                                        // the previous element, whose blocks are complete once the next iteration starts
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (pend) { applyBanaFlags(pend.el, pend.tag, blocks, pend.from); pend = null; }
      if (child.nodeType !== 1) continue;
      const tag = (child.localName || child.tagName || '').toLowerCase();
      const cls = (child.getAttribute ? (child.getAttribute('class') || '') : '').toLowerCase();
      if (tag === 'doctitle' || tag === 'docauthor' || tag === 'head') continue;
      if (cls.includes('bana-')) pend = { el: child, tag, from: blocks.length };
      if (/^level[1-6]$/.test(tag) && isTitlePageLevel(child)) { parseTitlePage(child); continue; }
      if (/^level[1-6]$/.test(tag) && isSymPageLevel(child)) { parseSymPage(child); continue; }
      if (/^level[1-6]$/.test(tag) && isTnPageLevel(child)) { parseTnPage(child); continue; }

      if (/^h[1-6]$/.test(tag) || tag === 'hd' || tag === 'bridgehead') {
        const lvl = tag === 'bridgehead' ? 2 : (tag === 'hd' ? nearestLevelDepth(child, 2) : (parseInt(tag.slice(1), 10) || 1));
        // IMP-W1: a <br/> in a heading is a forced line break (a Title with its Subtitle is saved this way), kept as '\n'.
        const hBreaks = child.getElementsByTagName ? child.getElementsByTagName('br').length > 0 : false;
        const hText = hBreaks ? textWithBreaks(child) : null;
        pushAtomic(blocks, child, (t, segs) => { if (hText && t) { t = hText; if (!segs) segs = [{ type: 'text', text: hText }]; } return t ? (segs ? { type: 'heading', level: lvl, segments: segs, text: t } : { type: 'heading', level: lvl, text: t }) : null; }, { excludeTags: IMAGE_TAGS });
        blocks.push(...imagesWithin(child));                 // an image in a heading follows it (A29)
      } else if (tag === 'caption' || tag === 'figcaption') {
        pushTextOnly(blocks, child, (t) => (t ? { type: 'caption', text: t } : null));
      } else if (tag === 'tabletn' || tag === 'bai-tabletn') {
        pushProdnote(blocks, child, (t) => (t ? { type: 'note', kind: 'tabletn', text: t } : null));
      } else if (tag === 'sidebar') {
        parseSidebar(child);
      } else if (tag === 'table') {
        parseTable(child);
      } else if (tag === 'dl') {
        parseDefinitionList(child);
      } else if (tag === 'poem' || tag === 'linegroup' || tag === 'stanza' || (tag === 'div' && (cls.includes('poem') || cls.includes('verse') || cls.includes('stanza')))) {
        // A42: a bare <linegroup>/<stanza>, or a poem/verse/stanza-classed <div> (no <poem>
        // wrapper in the source), is tagged so the exporter writes it back without inventing
        // one — a real <poem> (tag === 'poem') keeps round-tripping with its wrapper, unchanged.
        parsePoem(child, blocks, tag !== 'poem' ? { bare: true, runId: ++poemRunSeq } : {});
      } else if (tag === 'speaker') {
        const lvlAttr = child.getAttribute ? child.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        pushAtomic(blocks, child, (t, segs) => {
          if (!t) return null;
          const blk = segs
            ? { type: 'play', subtype: 'prose', style: 'play-speaker', text: t, segments: segs }
            : { type: 'play', subtype: 'prose', style: 'play-speaker', text: t };
          if (lvl > 0) blk.level = lvl;
          return blk;
        });
      } else if (tag === 'stage') {
        const lvlAttr = child.getAttribute ? child.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        pushAtomic(blocks, child, (t, segs) => {
          if (!t) return null;
          const blk = segs
            ? { type: 'stage', style: 'play-stage', text: t, segments: segs }
            : { type: 'stage', style: 'play-stage', text: t };
          if (lvl > 0) blk.level = lvl;
          return blk;
        });
      } else if (tag === 'blockquote') {
        const elementChildren = Array.from(child.childNodes || []).filter((c) => c.nodeType === 1 && !PAGENUM_TAGS.has((c.localName || c.tagName || '').toLowerCase()));
        if (elementChildren.length > 0) {
          // A35: a blockquote whose direct children mix in a real <line> (a quoted letter's
          // salutation/signature lines alongside its body <p>, e.g. hauy_history_valid.xml's
          // dtb380) must round-trip as one <blockquote> containing real <line> elements — not
          // have its lines silently reparsed by the generic tag==='line' handler below into
          // D5's bare-verse-drama shape (<p class="bai-verse">), which would both lose the
          // <line> element identity and drop the <blockquote> wrapper around it entirely.
          // Only a real DTBook <line> child triggers this half — see the fromLineTag note in
          // the tag==='line' branch below for why <ln> (not a DTBook element) is excluded.
          const hasLineChild = elementChildren.some((c) => (c.localName || c.tagName || '').toLowerCase() === 'line');
          // A40: *any* blockquote with more than one direct block child — most commonly two or
          // more plain <p>s (a multi-paragraph quoted letter, e.g. hauy_history_valid.xml's
          // dtb725/dtb785, no <line> involved at all) — has the same "each block loses its
          // wrapper" problem as A35's mixed-line case, just without a <line> in it: every block
          // serializeBlock produces on its own self-wraps in its *own* separate
          // <blockquote class="quote">, so N source paragraphs become N exported <blockquote>s.
          // A lone <p> (elementChildren.length === 1, no <line>) is the one case left alone —
          // it already round-trips correctly as one <blockquote> via that same per-paragraph
          // self-wrap, so leaving it untagged keeps its exact existing shape (no behaviour
          // change for the overwhelmingly common single-paragraph case).
          const start = blocks.length;
          walk(child);
          // K6 / BANA §9.1.2 ("Lists within displayed material are part of that displayed
          // material and must use adjusted margins") and §9.2.2c (a cell-5/cell-7 heading
          // nested in displayed material shifts outward): tag every heading/list this
          // blockquote's own walk produced — regardless of whether the run below also needs
          // a shared blockquoteId — so formatHeading/formatList (document.mjs) apply the
          // adjusted-margin offset (block.displayed; see field-registry.mjs).
          for (let i = start; i < blocks.length; i++) {
            if (blocks[i] && (blocks[i].type === 'heading' || blocks[i].type === 'list')) blocks[i].displayed = true;
          }
          if (hasLineChild || elementChildren.length > 1) {
            const id = ++blockquoteRunSeq;
            const blockquoteClass = child.getAttribute ? (child.getAttribute('class') || null) : null;
            for (let i = start; i < blocks.length; i++) {
              blocks[i].blockquoteId = id;
              if (hasLineChild) blocks[i].fromBlockquoteLines = true;
              if (blockquoteClass) blocks[i].blockquoteClass = blockquoteClass;
            }
          }
        } else {
          const segs = inlineSegments(child);
          pushParaParts(segs, blocks, (t, partSegs) => (partSegs ? { type: 'para', style: 'quote', segments: partSegs, text: t } : { type: 'para', style: 'quote', text: t }));
        }
      } else if (tag === 'epigraph') {
        // BANA §9.3.1c (F-94): "Do not treat epigraphs as displayed material" — unlike
        // <blockquote>, an epigraph keeps its own print format (§9.3.1b: "a poem in poetry
        // format, 3-1 margins for indented paragraphs, etc."). A block child (DTD:
        // <epigraph> is `(%flow;)*`, so it may hold a <poem>, several <p>s, etc.) is walked
        // as itself — a <poem> child routes to the ordinary parsePoem dispatch below, not a
        // style:'epigraph' paragraph, satisfying 9.3.1b's "a poem in poetry format" case
        // automatically; a <p> child is tagged style:'epigraph' by the isInsideEpigraph
        // check in the 'p' branch below. Only plain running text (no block children) is
        // built directly here. Only 9.3.1d's blank line before/after is common with
        // Blockquote (see quoteMargins/withEpigraphBlanks, format/document.mjs). An
        // inline-only child (a bare <span>/<em> alongside running text, no <p>) does not
        // itself count as block content — same test wrapInlineRuns/the "unknown container"
        // fallback below uses — or the loose text beside it would be silently dropped by
        // walk(), which only visits ELEMENT children.
        const hasElements = Array.from(child.childNodes || []).some((c) => c.nodeType === 1
          && !PAGENUM_TAGS.has((c.localName || c.tagName || '').toLowerCase())
          && !INLINE_TAGS.has((c.localName || c.tagName || '').toLowerCase()));
        if (hasElements) {
          walk(child);
        } else {
          const segs = inlineSegments(child);
          pushParaParts(segs, blocks, (t, partSegs) => (partSegs ? { type: 'para', style: 'epigraph', segments: partSegs, text: t } : { type: 'para', style: 'epigraph', text: t }));
        }
      } else if (tag === 'dt' || tag === 'dfn') {
        pushTextOnly(blocks, child, (t) => (t ? { type: 'para', style: 'dt', text: t } : null));
      } else if (tag === 'dd') {
        pushTextOnly(blocks, child, (t) => (t ? { type: 'para', style: 'dd', text: t } : null));
      } else if (tag === 'byline' || tag === 'author' || tag === 'cite' || tag === 'attrib') {
        // K2 / BANA 4.3.3, Example 4-2 (EMBOSS-TASKS G1/13b, KD's answer): a <byline> whose
        // immediately preceding block is a heading is the author's name printed right under a
        // title — a title and its author are TWO SEPARATE ITEMS, so BANA lays this out as a
        // SECOND CENTRED HEADING (same tier, blank line before it), never as a cell-5
        // attribution ("folding the author line into the heading" the old reading). Scoped to
        // the dedicated <byline> element only — <cite>/<attrib> keep their ordinary attribution
        // role (source citations, §9.4/9.5), and a <byline> reached from inside a poem
        // (parsePoem's own byline branches, §13) is unaffected, both unchanged. `notConnected:
        // true` opts back into the default blank line that document.mjs's HEADING_JOIN_TIERS
        // centred>centred join would otherwise drop (see its own comment for why Example 4-2 is
        // NOT one of the genuinely connected pairs).
        const prevHeading = blocks.length && blocks[blocks.length - 1].type === 'heading' ? blocks[blocks.length - 1] : null;
        // …except one a save marked as an attribution (class="bana-attribution": an attribution the user put under a heading, A89)
        if (tag === 'byline' && prevHeading && !/(^|\s)bana-attribution(\s|$)/.test((child.getAttribute && child.getAttribute('class')) || '')) {
          pushAtomic(blocks, child, (t, segs) => (t ? (segs ? { type: 'heading', level: prevHeading.level, segments: segs, text: t, notConnected: true } : { type: 'heading', level: prevHeading.level, text: t, notConnected: true }) : null));
        } else {
          pushAtomic(blocks, child, (t, segs) => (t ? (segs ? { type: 'attribution', text: t, segments: segs } : { type: 'attribution', text: t }) : null));
        }
      } else if (tag === 'math' || tag.endsWith(':math')) {
        let mathml = mathOuterXml(child);
        const alttext = child.getAttribute ? child.getAttribute('alttext') : null;
        let latex = alttext || null;
        const ann = child.getElementsByTagName ? [...child.getElementsByTagName('annotation'), ...child.getElementsByTagName('m:annotation')] : [];
        const texAnn = ann.find(a => (a.getAttribute ? (a.getAttribute('encoding') || '') : '').includes('tex'));
        if (texAnn && texAnn.textContent) latex = texAnn.textContent.trim();
        if (texAnn && mathml) mathml = texOnlyMathToMathML(mathml, latex) || mathml;   // A89
        if (!latex && mathml) latex = mathmlToLatex(mathml);
        const mathBlock = { type: 'math', mathml };
        if (latex) mathBlock.latex = latex;
        blocks.push(mathBlock);
      } else if (tag === 'line' || tag === 'ln') {
        const lvlAttr = child.getAttribute ? child.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        pushAtomic(blocks, child, (t, segs) => {
          if (!t) return null;
          const blk = segs
            ? { type: 'play', subtype: 'verse', style: 'verse', segments: segs, text: t }
            : { type: 'play', subtype: 'verse', style: 'verse', text: t };
          if (lvl > 0) blk.level = lvl;
          // F-180: a bare <line>/<ln> reaching here (i.e. NOT inside a <poem> — parsePoem
          // handles that case separately and never reaches this branch) is D5's own "verse
          // drama, no <poem> source" shape — the exporter already round-trips it as
          // <p class="bai-verse">, which reparses with playVerse:true (see the makeP branches
          // above); setting it here too keeps a fresh parse and a parse-export-reparse
          // consistent (round_trip's own AST diff, nimas_roundtrip.test.mjs).
          blk.playVerse = true;
          // A35: `tag === 'line'` is DTBook's own real element (dtbook-2005-3.dtd: <!ELEMENT
          // line (%inline; | linenum)*>) and must round-trip as <line>, not collapse to D5's
          // bare-verse-drama <p class="bai-verse">. `tag === 'ln'` is NOT a DTBook element at
          // all (no <!ELEMENT ln> in the DTD) — it only reaches here from a non-DTBook input
          // (BrailleBlaster's own shorthand poem markup, e.g. bb_firstline_input.xml's
          // <verse role="poem"><lngroup><ln>) that F-180/D5 already treats as verse drama on
          // purpose, so it is deliberately left untagged here, unchanged from before this fix.
          // Tagged separately from playVerse so the exporter can tell a real <line> apart from
          // D5's verse drama (playVerse alone, no fromLineTag), which keeps round-tripping as
          // <p class="bai-verse"> exactly as before this fix.
          if (tag === 'line') blk.fromLineTag = true;
          return blk;
        });
      } else if (tag === 'imggroup') {
        parseImgGroup(child, blocks);
      } else if (tag === 'img' || tag === 'image') {
        const src = (child.getAttribute ? child.getAttribute('src') : '') || '';
        const alt = (child.getAttribute ? child.getAttribute('alt') : '') || '';
        const graphic = { type: 'graphic', src, alt };
        const svg = svgFromDataUri(src);
        if (svg) graphic.svg = svg;
        blocks.push(graphic);
      } else if (tag === 'p' || tag === 'bai-play' || tag === 'bai-verse' || tag === 'bai-stage') {
        // A24: BrailleBlaster writes its own <bai-play level="N">/<bai-verse level="N">/
        // <bai-stage level="N"> elements where Emboss (D5, nimas-style-mapping.md "Class
        // names — Decided (D5)") writes valid DTBook <p class="bai-play|bai-verse|bai-stage">:
        // "BrailleBlaster ... expects its own elements ... those are not DTBook elements, so a
        // file using them fails NIMAS validation ... never write BrailleBlaster's custom
        // elements; read them on import." Folding the element name into the same `cls` string
        // the ordinary <p class="bai-*"> path already matches on below means one makeP() keeps
        // producing the same play/verse/stage block for both spellings; level comes from the
        // same getElementLevel() just below, which already reads a bare `level` attribute (not
        // only `class="level-N"`) — so a save always round-trips to valid DTBook <p
        // class="bai-*">, never the source's own <bai-*> element.
        const cls = ((child.getAttribute ? (child.getAttribute('class') || '') : '') + (tag !== 'p' ? ' ' + tag : '')).toLowerCase();
        const pLevel = getElementLevel(child);
        const isInsideQuote = child.parentNode && (child.parentNode.localName || child.parentNode.tagName || '').toLowerCase() === 'blockquote';
        // F-94 / BANA §9.3.1c: a <p> directly inside <epigraph> (with no more specific class
        // of its own) is the epigraph's own text — style:'epigraph', not style:'quote' — see
        // the 'epigraph' tag branch above for the container itself.
        const isInsideEpigraph = child.parentNode && (child.parentNode.localName || child.parentNode.tagName || '').toLowerCase() === 'epigraph';
        
        const imgs = child.getElementsByTagName ? [...child.getElementsByTagName('img'), ...child.getElementsByTagName('image')] : [];
        for (const im of imgs) {
          const src = (im.getAttribute ? im.getAttribute('src') : '') || '';
          const alt = (im.getAttribute ? im.getAttribute('alt') : '') || '';
          blocks.push({ type: 'graphic', src, alt });
        }

        const directPText = getCleanText(child);

        const rawSegs = inlineSegments(child);
        const hasSpeakerChild = (child.getElementsByTagName ? child.getElementsByTagName('speaker').length > 0 : false) || (child.getElementsByClassName ? child.getElementsByClassName('speaker').length > 0 : false);
        const hasStageChild = (child.getElementsByTagName ? child.getElementsByTagName('stage').length > 0 : false) || (child.getElementsByClassName ? child.getElementsByClassName('stage').length > 0 : false);
        // Builds the block for this <p> from (text, segments-or-undefined); null = nothing.
        const makeP = (t, segs) => {
          if (cls.includes('bai-play') || cls.includes('play-speaker') || cls.includes('speaker') || hasSpeakerChild) {
            return { type: 'play', subtype: 'prose', style: 'play-speaker', level: pLevel, text: t, segments: segs };
          } else if (cls.includes('bai-verse') || cls.includes('play-verse') || cls.includes('verse') || cls.includes('poem') || cls.includes('line')) {
            // F-180 — see the matching branch in parseSidebar's makeP just above.
            const blk = { type: 'play', subtype: 'verse', style: 'verse', level: pLevel, text: t, segments: segs };
            if (cls.includes('bai-verse') || cls.includes('play-verse')) blk.playVerse = true;
            return blk;
          } else if (cls.includes('bai-stage') || cls.includes('play-stage') || cls.includes('stage') || hasStageChild) {
            return { type: 'stage', style: 'play-stage', level: pLevel, text: t, segments: segs };
          } else if (cls.includes('byline') || cls.includes('attribution') || cls.includes('author')) {
            return { type: 'attribution', text: t, segments: segs };
          } else if (cls.includes('quote') || cls.includes('blockquote') || cls.includes('extract') || isInsideQuote) {
            return { type: 'para', style: 'quote', level: pLevel, text: t, segments: segs };
          } else if (isInsideEpigraph) {
            return { type: 'para', style: 'epigraph', level: pLevel, text: t, segments: segs };
          } else if (cls.includes('bai-stanza-break') || cls.includes('stanza-break')) {
            return { type: 'indicator', kind: 'line' };
          } else if (cls.includes('bana-break-asterism') || ((cls.includes('doc-break') || cls === 'break') && /^[⁂\s]+$/.test(t || '') && t.includes('⁂')) || /^⁂(\s+⁂)*$/.test(t || '')) {
            // A print asterism (⁂) is kept as its own kind: BANA Formats §1.9.5 follows the
            // print symbol (a transcriber-defined symbol in braille); UKAAF uses asterisks.
            return { type: 'break', kind: 'asterism' };
          } else if (cls.includes('bana-break-asterisks') || cls.includes('doc-break') || cls === 'break' || t === '* * *' || t === '∗ ∗ ∗') {
            return { type: 'break', kind: 'asterisks' };
          } else if (cls.includes('bana-break-dot2s')) {
            return { type: 'break', kind: 'dot2s' };
          } else if (t || (!segs && hasEmptyMark(child))) {
            // BANA Formats §1.9.3 (F-39): a per-paragraph "blocked" (1-1 margins) flag,
            // round-tripped as class="blocked" (see nimas-export.mjs's matching 'para' case).
            // A89: <p class="bana-empty"/> is an empty paragraph of its own (nimas-export.mjs saves one that way).
            const blk = segs ? { type: 'para', segments: segs, text: t } : { type: 'para', text: t };
            if (cls.includes('blocked')) blk.blocked = true;
            if (!t && !segs) blk.keptEmpty = true;   // A89: saved empty on purpose (the editor gives it back as an empty paragraph the user made)
            return blk;
          }
          return null;
        };
        // Display maths: DTBook only allows <m:math> inline, so the exporter (and many
        // producers) wrap a displayed equation in a <p> of its own. Keep it a math block.
        if (rawSegs.length === 1 && rawSegs[0].type === 'math') {
          const mathBlock = { type: 'math', mathml: rawSegs[0].mathml };
          if (rawSegs[0].latex) mathBlock.latex = rawSegs[0].latex;
          blocks.push(mathBlock);
          continue;
        }
        if (segsHavePagenum(rawSegs)) {
          const probe = makeP(directPText, undefined);
          if (probe && probe.type === 'para') {
            // Ordinary paragraph: split around the page turn(s), text resumes in cell 1.
            pushParaParts(rawSegs, blocks, makeP);
          } else {
            const pn = hoistPagenums(rawSegs);
            blocks.push(...pn.before);
            const blk = makeP(directPText, segsHaveEmphOrMath(pn.segs) && pn.segs.length ? pn.segs : undefined);
            if (blk) blocks.push(blk);
            blocks.push(...pn.after);
          }
        } else {
          const blk = makeP(directPText, segsHaveEmphOrMath(rawSegs) && rawSegs.length ? rawSegs : undefined);
          if (blk) blocks.push(blk);
        }
      } else if (tag === 'hr' || tag === 'break') {
        const cls = (child.getAttribute ? (child.getAttribute('class') || '') : '').toLowerCase();
        if (cls.includes('stanza')) blocks.push({ type: 'indicator', kind: 'line' });
        else if (cls.includes('asterisks')) blocks.push({ type: 'break', kind: 'asterisks' });
        else if (cls.includes('dot2s')) blocks.push({ type: 'break', kind: 'dot2s' });
        else blocks.push({ type: 'break', kind: 'line' });
      } else if (tag === 'list') {
        parseSingleList(child);
      } else if (tag === 'note') {
        pushNote(blocks, child);
      } else if (tag === 'annotation' || tag === 'prodnote') {
        const cls = (child.getAttribute ? (child.getAttribute('class') || '') : '').toLowerCase();
        // A22: keep an imported render="required" (see the liTag branch above for D6's note).
        const renderAttr = (child.getAttribute && child.getAttribute('render')) || null;
        pushProdnote(blocks, child, (t) => {
          if (!t) return null;
          const blk = cls.includes('tabletn') ? { type: 'note', kind: 'tabletn', text: t } : { type: 'note', text: t };
          // A22/A43: keep the source's own value, either way — an Emboss-created note (no
          // value at all) is the only one the exporter defaults to required (D6).
          if (renderAttr === 'required' || renderAttr === 'optional') blk.render = renderAttr;
          return blk;
        });
      } else if (PAGENUM_TAGS.has(tag)) {
        const pn = pagenumBlock(child);
        if (pn) blocks.push(pn);
      } else if (tag === 'page') {
        pushTextOnly(blocks, child, (t) => (t ? { type: 'para', text: t } : null));
      } else if (tag === 'dedication' || (tag === 'div' && cls.split(/\s+/).includes('dedication'))) {
        // K30 / BANA 2.9.1f: a real DTBook <dedication> (frontmatter) element, or a
        // <div class="dedication"> fallback — every block it produces is marked `dedication`
        // so document.mjs's emphasisContext (K1) groups them for decorative emphasis, the
        // same way parsePoem/parseBlockquote tag their own runs above.
        const start = blocks.length;
        walk(child);
        for (let i = start; i < blocks.length; i++) blocks[i].dedication = true;
      } else if (tag === 'div' && cls) {
        // A19/A21 Stage 5: a <div class="…"> whose class none of the branches above
        // recognise (stanza/poem/verse/sidebar/toc/index — all checked earlier in this
        // chain) still needs its class kept somewhere, or a save silently drops the wrapper
        // (DTD: `div (%docblockorinline;)+`, @class free text). The flat block-array model
        // has no nested-wrapper block type, so — the same shape parsePoem/fromPoem (Stage 2)
        // already established for <poem> — every block this div's content produces is tagged
        // with the div's own class and a fresh instance id (divRunSeq, above); nimas-export.mjs
        // sweeps a contiguous run sharing both back into one <div class="…">. The id (not the
        // class alone) is what stops two separate, adjacent, identically-classed <div>s from
        // being merged into one on export.
        const id = ++divRunSeq;
        const origClass = (child.getAttribute && child.getAttribute('class')) || cls;   // keep source casing
        const start = blocks.length;
        const hasElementChild = Array.from(child.childNodes || []).some((c) => c.nodeType === 1);
        if (hasElementChild) {
          wrapInlineRuns(child);
          walk(child);
        } else {
          const t = getCleanText(child);
          if (t) blocks.push({ type: 'para', text: t });
        }
        for (let i = start; i < blocks.length; i++) {
          const b = blocks[i];
          // A nested div (its own recursive walk() call already tagged its own blocks with
          // its own class/id) keeps its own, closer tagging — only tag what this div's own
          // walk left untagged.
          if (b && b.divClass == null) { b.divClass = origClass; b.divId = id; }
        }
      } else {
        const hasElementChild = Array.from(child.childNodes || []).some((c) => c.nodeType === 1);
        if (hasElementChild) {
          wrapInlineRuns(child);
          walk(child);
        } else {
          const t = getCleanText(child);
          if (t) blocks.push({ type: 'para', text: t });
        }
      }
    }
    if (pend) applyBanaFlags(pend.el, pend.tag, blocks, pend.from);
  }

  // A container the walker does not know (div, a, span, sent…) may hold running text next to
  // (or instead of) block elements — "<div><a> Part A <code>…</code> Part B</a></div>". The
  // walker only visits elements, so each run of inline content is wrapped in a synthetic <p>
  // first; block children are left for the walker as before.
  // DTBook 2005-3 inline elements (%inline; minus the ones the walker handles itself) and
  // their common HTML equivalents.
  const INLINE_CHILD = new Set(['a', 'abbr', 'acronym', 'bdo', 'cite', 'code', 'dfn', 'em', 'i', 'b', 'u', 'strong', 'kbd', 'q', 'samp', 'span', 'sub', 'sup', 'sent', 'w', 'noteref', 'annoref', 'br', 'linenum', 'small', 'big', 'tt', 'var', 'mark', 'ins', 'del', 's', 'time', 'label']);
  function wrapInlineRuns(el) {
    const kids = Array.from(el.childNodes || []);
    const isInline = (n) => n.nodeType === 3 || (n.nodeType === 1 && INLINE_CHILD.has((n.localName || n.tagName || '').toLowerCase()));
    const hasText = (run) => run.some((n) => (n.nodeType === 3 ? n.nodeValue : n.textContent || '').trim());
    // Only when some inline content carries text: plain element-only containers keep the old path.
    if (!kids.some((n) => isInline(n) && hasText([n]))) return;
    let run = [];
    const flush = () => {
      if (run.length && hasText(run) && el.ownerDocument && el.ownerDocument.createElementNS) {
        const p = el.ownerDocument.createElementNS(el.namespaceURI || null, 'p');
        el.insertBefore(p, run[0]);
        for (const n of run) p.appendChild(n);
      }
      run = [];
    };
    for (const n of kids) {
      if (isInline(n)) run.push(n); else flush();
    }
    flush();
  }

  const book = doc.getElementsByTagName('book')[0] || doc.documentElement;
  walk(book);
  if (!title && !placeholderTitle && blocks.length && blocks[0].type === 'heading') {
    title = blocks[0].text;
  }
  // A49: a table's caption has to live inside <table> (the DTD makes it the table's own
  // first child), while a tabletn note can only be a sibling before it — so a saved file
  // reads back as note, caption, table. BANA 11.2.5f puts the caption first (F-3), and the
  // block order is what the braille follows, so restore it here.
  for (let i = 0; i + 2 < blocks.length; i++) {
    const [note, caption, table] = [blocks[i], blocks[i + 1], blocks[i + 2]];
    if (note && note.type === 'note' && note.kind === 'tabletn'
        && caption && caption.type === 'caption'
        && table && table.type === 'table') {
      blocks[i] = caption;
      blocks[i + 1] = note;
    }
  }

  const result = { title, blocks };
  if (Object.keys(metadata).length > 0) result.metadata = metadata;
  for (const [f, v] of docOptions) result[f] = v;            // document-level formatter options, read by document.mjs as doc.<name>
  finishLanguages(result);                                   // foreign-language passages: noise dropped (input/lang.mjs)
  // Nothing is dropped silently (A2): anything the model lacks is reported to the user.
  if (rootTag === 'dtbook') {
    try {
      const warnings = loadWarnings(doc, result);
      if (warnings.length) result.warnings = warnings;
    } catch { /* the check never stops a load */ }
  }
  return result;
}

export const parseNimasXml = parseDtbook;

// ---------- NIMAS package (zip of OPF + DTBook + images; A3) ----------

// Decode a possibly percent-encoded href, drop any #fragment, and collapse "./" / "../"
// segments *within the href itself* — the "folder-relative" form used for model.resources
// paths and the graphic's own src (A3d).
function normalizeHref(href) {
  let raw = String(href || '').split('#')[0];
  try { raw = decodeURIComponent(raw); } catch { /* keep literal % sequences that aren't valid escapes */ }
  const out = [];
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else out.push('..'); }
    else out.push(part);
  }
  return out.join('/');
}

// Resolve an href against a zip-internal base folder (no trailing slash) into the zip entry
// name that actually holds it.
function resolveZipPath(baseDir, href) {
  const rel = normalizeHref(href);
  if (!rel) return '';
  return baseDir ? normalizeHref(`${baseDir}/${rel}`) : rel;
}

// Every descendant element (any depth, any namespace) whose local name matches, case-
// insensitively: OPF metadata mixes OEB 1.2's <dc:Title> with OPF 2's lowercase <dc:title>,
// and the manifest's <item> needs the same tolerance for stray casing (A3a/c).
function elementsByLocalName(root, name) {
  const out = [];
  const ln = name.toLowerCase();
  (function walk(n) {
    for (let c = n && n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) {
        if ((c.localName || c.tagName || '').toLowerCase() === ln) out.push(c);
        walk(c);
      }
    }
  })(root);
  return out;
}

// dc-metadata / x-metadata from an OEB/OPF package document: dc: fields (creators joined
// with "; "), nimas-* metas, and any other named meta kept for reference (A3c); plus a few
// simple dc: attributes NIMAS's own package-doc-common.sch checks for structurally
// (dc:Date/@event="DCTERMS.created", dc:Creator/@role, dc:Identifier/@scheme — A4).
function readOpfMetadata(opfDoc) {
  const textOf = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const byLocal = (name) => elementsByLocalName(opfDoc.documentElement, name);
  const first = (name) => textOf(byLocal(name)[0]);
  const attrOf = (name, attr) => { const el = byLocal(name)[0]; return (el && el.getAttribute && el.getAttribute(attr)) || ''; };
  const dc = {
    title: first('title'),
    creator: byLocal('creator').map(textOf).filter(Boolean).join('; '),
    publisher: first('publisher'),
    date: first('date'),
    identifier: first('identifier'),
    language: first('language'),
    rights: first('rights'),
    source: first('source'),
    subject: first('subject'),
    format: first('format'),
  };
  const dcAttrs = {};
  const dateEvent = attrOf('date', 'event'); if (dateEvent) dcAttrs.dateEvent = dateEvent;
  const creatorRole = attrOf('creator', 'role'); if (creatorRole) dcAttrs.creatorRole = creatorRole;
  const identifierScheme = attrOf('identifier', 'scheme'); if (identifierScheme) dcAttrs.identifierScheme = identifierScheme;

  // x-metadata metas (nimas-* and everything else, e.g. DCTERMS.*): a name that repeats
  // (the CAST corpus has two DCTERMS.description.note) becomes an array, in source order;
  // empty content (nimas-SourceEdition="" in the CAST corpus) is kept, not dropped, so A4's
  // save can write the same, structurally-complete x-metadata back out.
  const nimas = {}, opfMeta = {};
  const addMeta = (bucket, name, content) => {
    if (Object.prototype.hasOwnProperty.call(bucket, name)) {
      bucket[name] = Array.isArray(bucket[name]) ? [...bucket[name], content] : [bucket[name], content];
    } else {
      bucket[name] = content;
    }
  };
  for (const m of byLocal('meta')) {
    const name = m.getAttribute ? m.getAttribute('name') : null;
    if (!name) continue;
    const content = m.getAttribute ? (m.getAttribute('content') || '').trim() : '';
    addMeta(name.toLowerCase().startsWith('nimas-') ? nimas : opfMeta, name, content);
  }
  return { dc, dcAttrs, nimas, opfMeta };
}

const IMAGE_MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
};
function mimeForPath(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] || 'application/octet-stream';
}

// Every graphic block anywhere in the model — nested in a box/sidebar's `blocks`, a list
// item, a table cell, wherever — via the same generic object walk load-audit.mjs uses to
// count images, rather than duplicating the block tree's shape here (A3d).
function collectGraphics(blocks) {
  const out = [];
  const seen = new Set();
  (function deep(v) {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v.type === 'graphic') out.push(v);
    for (const k in v) if (v[k] && typeof v[k] === 'object') deep(v[k]);
  })(blocks);
  return out;
}

export async function parseNimasZip(arrayBuffer) {
  const entries = listZipEntries(arrayBuffer);
  const entryByName = new Map(entries.filter((e) => !e.name.endsWith('/')).map((e) => [e.name, e]));
  const dec = new TextDecoder();

  // The OPF (there should be exactly one; NIMAS/DAISY packages don't carry more).
  const opfEntry = entries.find((e) => /\.opf$/i.test(e.name));
  let opfDoc = null, opfPath = null, opfDir = '';
  if (opfEntry) {
    opfPath = opfEntry.name;
    opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
    try { opfDoc = parseXml(dec.decode(await extractZipEntry(arrayBuffer, opfEntry))); }
    catch { /* a broken .opf still leaves the <dtbook> fallback below */ }
  }

  // Choose the book: the manifest's DTBook item (by media-type, else its first plain-XML
  // item), resolved against the OPF's folder and checked against what's actually in the zip
  // — a package can *claim* a book file it doesn't include (the opf-exemplar test package).
  // 1a: a book may be split over SEVERAL content files (NIMAS allows it). Every manifest item of type dtbook is a content file, read in
  // the OPF's spine order (a dtbook item the spine does not list follows, in manifest order; with no spine, manifest order), and the
  // parts are joined into one model below. `bookPaths` are their zip paths, `missingContent` counts the listed ones the zip lacks.
  const bookPaths = [];
  const missingPaths = new Set();
  let missingContent = 0;
  if (opfDoc) {
    const items = elementsByLocalName(opfDoc.documentElement, 'item')
      .map((it) => ({ id: it.getAttribute('id') || '', href: it.getAttribute('href') || '', mediaType: (it.getAttribute('media-type') || '').toLowerCase() }))
      .filter((it) => it.href);
    const dtbookItems = items.filter((it) => it.mediaType.includes('dtbook'));
    const contentItems = [];
    if (dtbookItems.length) {
      for (const ref of elementsByLocalName(opfDoc.documentElement, 'itemref')) {
        const it = dtbookItems.find((x) => x.id && x.id === (ref.getAttribute('idref') || ''));
        if (it && !contentItems.includes(it)) contentItems.push(it);
      }
      for (const it of dtbookItems) if (!contentItems.includes(it)) contentItems.push(it);
    } else {
      const plain = items.find((it) => /\.xml$/i.test(it.href) && !/\.(opf|ncx|smil)$/i.test(it.href));
      if (plain) contentItems.push(plain);
    }
    for (const it of contentItems) {
      const resolved = resolveZipPath(opfDir, it.href);
      if (entryByName.has(resolved)) { if (!bookPaths.includes(resolved)) bookPaths.push(resolved); }
      else missingPaths.add(resolved || it.href);
    }
    if (bookPaths.length) missingContent = missingPaths.size;   // (nothing usable listed: the fallback below looks for the book itself)
  }
  let bookPath = bookPaths[0] || null;
  if (!bookPath) {
    // No usable OPF, or its manifest entry is missing from the zip: fall back to whichever
    // .xml entry actually has a <dtbook> root (a package can carry other XML — an NCX, a
    // math exemplar fragment — that isn't the book itself).
    for (const e of entries) {
      if (!/\.xml$/i.test(e.name) || e.name.toLowerCase().endsWith('container.xml')) continue;
      try {
        const root = parseXml(dec.decode(await extractZipEntry(arrayBuffer, e))).documentElement;
        if (root && (root.localName || root.tagName || '').toLowerCase() === 'dtbook') { bookPath = e.name; break; }
      } catch { /* not well-formed XML: not the book */ }
    }
  }
  if (!bookPath) {
    const names = entries.filter((e) => !e.name.endsWith('/')).map((e) => e.name.split('/').pop()).slice(0, 6);
    throw new Error(`This package has no DTBook book file (it contains: ${names.join(', ')}). A NIMAS package must include the book's .xml file.`);
  }

  if (!bookPaths.length) bookPaths.push(bookPath);
  const dirOfZipPath = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

  // Read every content file (1a). One file: a read error stops the load, as it always did. Several: a file that cannot be read is
  // left out and named in a warning, the others are still read (the load stops only when none can be read).
  const parts = [];
  const unreadable = [];
  let firstReadError = null;
  for (const p of bookPaths) {
    try {
      parts.push({ path: p, model: parseDtbook(dec.decode(await extractZipEntry(arrayBuffer, entryByName.get(p)))) });
    } catch (e) {
      if (bookPaths.length === 1) throw e;
      if (!firstReadError) firstReadError = e;
      unreadable.push(p);
    }
  }
  if (!parts.length) throw firstReadError;
  bookPath = parts[0].path;
  const bookDir = dirOfZipPath(bookPath);
  const model = parts[0].model;
  const multi = bookPaths.length > 1;

  // OPF metadata fills in whatever the DTBook <head> left empty — the DTBook always wins.
  const metadata = model.metadata || (model.metadata = {});
  if (opfDoc) {
    const { dc, dcAttrs, nimas, opfMeta } = readOpfMetadata(opfDoc);
    for (const [k, v] of Object.entries(dc)) if (v && !metadata[k]) metadata[k] = v;
    if (Object.keys(dcAttrs).length) metadata.dcAttrs = { ...dcAttrs, ...(metadata.dcAttrs || {}) };
    if (Object.keys(nimas).length) metadata.nimas = { ...nimas, ...(metadata.nimas || {}) };
    if (Object.keys(opfMeta).length) metadata.opfMeta = opfMeta;
    if (!metadata.lang && metadata.language) metadata.lang = metadata.language;
    if (!model.title && dc.title) model.title = dc.title;
  }
  metadata.package = { opf: opfPath, book: bookPath };
  if (multi) metadata.package.books = parts.map((x) => x.path);

  // Images: pull every graphic's bytes out of the zip and point its src at a package-
  // relative path; saving the package back out is A4. A file's image paths are resolved
  // against THAT file's folder (1a) and kept relative to the first file's folder (as for a
  // one-file package), so a picture two files share is one resource.
  const resources = [];
  const resourceByPath = new Map();
  let missingImages = 0;
  const damagedFiles = [];
  const modelPathOf = (zipPath) => {
    const from = bookDir ? bookDir.split('/') : [];
    const to = zipPath.split('/');
    let i = 0;
    while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
    return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/');
  };
  const pullImages = async (partModel, partPath) => {
    const partDir = dirOfZipPath(partPath);
    for (const g of collectGraphics(partModel.blocks)) {
      const src = g.src || '';
      if (!src || /^(data:|https?:|blob:)/i.test(src)) continue;
      const zipPath = resolveZipPath(partDir, src);
      const relPath = partDir === bookDir ? normalizeHref(src) : (zipPath ? modelPathOf(zipPath) : '');
      if (!relPath) continue;
      if (resourceByPath.has(relPath)) { g.src = relPath; continue; }
      const entry = entryByName.get(zipPath);
      if (!entry) { missingImages++; continue; }
      let bytes;
      try { bytes = new Uint8Array(await extractZipEntry(arrayBuffer, entry)); }
      catch (e) { if (e && (e.zipDamaged || e.zipUnsupported)) { damagedFiles.push(zipPath); continue; } throw e; }   // a picture that fails its checksum is left out and named (audit batch S2b item 21)
      const resource = { path: relPath, mime: mimeForPath(relPath), bytes };
      resources.push(resource);
      resourceByPath.set(relPath, resource);
      g.src = relPath;
    }
  };

  // Join the parts (1a): the first file's model is the book (title, metadata, options); the later files add their blocks, in order.
  // A note id a later file shares with an earlier file ("n1" in each) is renamed, with the note references that point at it in
  // that file, so every reference still reaches its own note. A warning a file raised is kept, naming the file.
  const usedNoteIds = new Set();
  const noteBlocksIn = (blocks) => {
    const out = [];
    const seen = new Set();
    (function deep(v) {
      if (!v || typeof v !== 'object' || seen.has(v)) return;
      seen.add(v);
      if (v.type === 'footnote' && v.id) out.push(v);
      for (const k in v) if (v[k] && typeof v[k] === 'object') deep(v[k]);
    })(blocks);
    return out;
  };
  const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
  const joinedWarnings = [];
  for (let k = 0; k < parts.length; k++) {
    const { path: partPath, model: partModel } = parts[k];
    await pullImages(partModel, partPath);
    const notes = noteBlocksIn(partModel.blocks);
    if (k > 0) {
      const renamed = new Map();
      for (const n of notes) {
        if (!usedNoteIds.has(n.id)) continue;
        let fresh = `${n.id}-part${k + 1}`;
        for (let i = 2; usedNoteIds.has(fresh) || notes.some((x) => x.id === fresh); i++) fresh = `${n.id}-part${k + 1}-${i}`;
        renamed.set(n.id, fresh);
      }
      if (renamed.size) {
        const seen = new Set();
        (function deep(v) {
          if (!v || typeof v !== 'object' || seen.has(v)) return;
          seen.add(v);
          if (v.type === 'noteref' && renamed.has(v.idref)) v.idref = renamed.get(v.idref);
          for (const key in v) if (v[key] && typeof v[key] === 'object') deep(v[key]);
        })(partModel.blocks);
        for (const n of notes) if (renamed.has(n.id)) n.id = renamed.get(n.id);
      }
      model.blocks.push(...partModel.blocks);
      for (const key of Object.keys(partModel)) if (!['title', 'blocks', 'metadata', 'warnings'].includes(key) && model[key] === undefined) model[key] = partModel[key];
    }
    for (const n of noteBlocksIn(partModel.blocks)) usedNoteIds.add(n.id);
    if (partModel.warnings) for (const w of partModel.warnings) joinedWarnings.push(multi ? `In ${baseName(partPath)}: ${w}` : w);
  }
  if (multi) {
    for (const p of unreadable) joinedWarnings.push(`The content file ${baseName(p)} could not be read and was left out`);
  }
  if (missingContent) joinedWarnings.push(`${missingContent} content file${missingContent === 1 ? '' : 's'} listed in the package ${missingContent === 1 ? 'is' : 'are'} missing from it`);
  if (multi || missingContent) { if (joinedWarnings.length) model.warnings = joinedWarnings; else delete model.warnings; }
  // The package's own source PDF(s) (A4 writes them back out on save): the OPF manifest's
  // application/pdf item(s), resolved against the OPF's folder like any other manifest href;
  // failing that (no usable OPF), any .pdf entry that sits in the book's own folder. Kept
  // with a package-relative path (like an image's), so save can put it back at the same spot.
  const pdfZipPaths = new Set();
  if (opfDoc) {
    const pdfItems = elementsByLocalName(opfDoc.documentElement, 'item')
      .map((it) => ({ href: it.getAttribute('href') || '', mediaType: (it.getAttribute('media-type') || '').toLowerCase() }))
      .filter((it) => it.href && it.mediaType.includes('pdf'));
    for (const it of pdfItems) {
      const resolved = resolveZipPath(opfDir, it.href);
      if (entryByName.has(resolved)) pdfZipPaths.add(resolved);
    }
  }
  if (!pdfZipPaths.size) {
    for (const e of entries) {
      if (!/\.pdf$/i.test(e.name)) continue;
      const dir = e.name.includes('/') ? e.name.slice(0, e.name.lastIndexOf('/')) : '';
      if (dir === bookDir) pdfZipPaths.add(e.name);
    }
  }
  for (const zipPath of pdfZipPaths) {
    const entry = entryByName.get(zipPath);
    if (!entry) continue;
    const bookPrefix = bookDir ? `${bookDir}/` : '';
    const relPath = bookPrefix && zipPath.startsWith(bookPrefix) ? zipPath.slice(bookPrefix.length) : zipPath;
    let bytes;
    try { bytes = new Uint8Array(await extractZipEntry(arrayBuffer, entry)); }
    catch (e) { if (e && (e.zipDamaged || e.zipUnsupported)) { damagedFiles.push(zipPath); continue; } throw e; }
    resources.push({ path: relPath, mime: 'application/pdf', bytes, role: 'source-pdf' });
  }

  if (resources.length) model.resources = resources;
  if (missingImages) {
    (model.warnings || (model.warnings = [])).push(
      `${missingImages} image${missingImages === 1 ? '' : 's'} referenced by the book ${missingImages === 1 ? 'is' : 'are'} missing from the package`);
  }
  if (damagedFiles.length) {
    const uniq = [...new Set(damagedFiles)];
    (model.warnings || (model.warnings = [])).push(
      `${uniq.length} file${uniq.length === 1 ? '' : 's'} in the package ${uniq.length === 1 ? 'is' : 'are'} damaged and ${uniq.length === 1 ? 'was' : 'were'} left out (${uniq.slice(0, 5).join(', ')}${uniq.length > 5 ? ` and ${uniq.length - 5} more` : ''})`);
  }
  return model;
}

// Formats that need the raw bytes (ArrayBuffer) rather than text.
// .docm/.dotx/.dotm are the same OOXML package as .docx; .doc/.dot are Word 97–2003 binary (doc.mjs).
export const BINARY_EXTS = new Set(['docx', 'docm', 'dotx', 'dotm', 'doc', 'dot', 'odt', 'ott', 'epub', 'zip', 'ebrl', 'ebraille']);   // ott: an ODT template (.fodt, flat XML, is text)

// docx-fix item 8: sniff for the CFB (Compound File Binary/OLE2) container signature BEFORE
// ever treating the bytes as a zip. A password-protected .docx isn't an OOXML zip package any
// more — Word re-wraps the whole encrypted package inside a legacy CFB compound file (the same
// container .doc/.xls/.ppt use), and every CFB file starts with this exact 8-byte magic number
// regardless of what it contains. Left unhandled, listZipEntries's own "not a zip (no EOCD)" —
// true, but meaningless to a reader who has no idea what "EOCD" means — was the only error a
// password-protected docx ever produced.
const CFB_SIGNATURE = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
function looksLikeCfb(buf) {
  try {
    const u8 = zipBytes(buf);
    if (u8.length < CFB_SIGNATURE.length) return false;
    return CFB_SIGNATURE.every((b, i) => u8[i] === b);
  } catch { return false; }
}
const DOCX_PASSWORD_PROTECTED_MSG = 'This Word document is password-protected. Open it in Word, remove the password (File › Info › Protect Document), save, and load it again.';
const DOCX_DAMAGED_MSG = 'This Word document is damaged or incomplete and could not be read.';
// A genuinely truncated/corrupt .docx (cut mid-download/mid-copy, or simply not a zip at all —
// random bytes given a .docx extension) fails the SAME low-level way either way: listZipEntries
// can't find a End-Of-Central-Directory record at all, so "not a zip (no EOCD)" is the only
// signal available — re-worded here into something a reader can actually act on.
// A hard failure — the file could not be read at all, as opposed to a partial parse that still
// produced a document. Flagged `.userFacing` (the same convention doc.mjs's userError() uses for
// the equivalent .doc failures: password-protected, damaged, Word 6/95, not a Word file) so the
// editor and Quick Mode can show the reader's own plain message instead of the "partial parse,
// continue editing" wording, and leave the current document untouched.
function docxUserError(message) { const e = new Error(message); e.userFacing = true; return e; }
async function parseDocxSniffed(dataOrText) {
  if (typeof dataOrText !== 'string' && looksLikeCfb(dataOrText)) {
    if (isWordBinary(dataOrText)) return parseDoc(dataOrText);   // a Word 97–2003 .doc saved/renamed as .docx: read it as what it is
    throw docxUserError(DOCX_PASSWORD_PROTECTED_MSG);
  }
  try { return await parseDocx(dataOrText); }
  catch (e) {
    if (e && e.userFacing) throw e;
    if (typeof dataOrText !== 'string' && /not a zip/i.test(String((e && e.message) || e))) throw docxUserError(DOCX_DAMAGED_MSG);
    throw e;
  }
}

// Paul's decision (25 Sep 2026): every link out of the document (web, email, ftp) in an imported document gets the
// hyperlink indicator (F-233, `seg.hyperlink`) automatically. He chose this over the advice that BANA 6.12.3b(3) uses the
// indicator only when describing screenshots. Not applied to DTBook/NIMAS (Emboss's own saved files carry the
// transcriber's choice as class="bana-hyperlink", so a removed indicator stays removed) or to internal jump links.
const EXTERNAL_LINK_RE = /^(?:https?:|mailto:|ftp:|www\.)/i;
function markImportedLinks(model) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (!v || typeof v !== 'object' || seen.has(v) || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (v.type === 'text' && typeof v.href === 'string' && EXTERNAL_LINK_RE.test(v.href.trim())) v.hyperlink = true;
    for (const k in v) if (k !== 'resources' && k !== 'bytes') walk(v[k]);
  };
  if (model && model.blocks) walk(model.blocks);
  return model;
}

// dispatch by filename / extension
export async function parseFile(name, dataOrText) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const isDtbook = ext === 'xml' || ext === 'nimas' || ext === 'dtbook' || ext === 'zip' || (typeof dataOrText === 'string' && (dataOrText.includes('<dtbook') || dataOrText.includes('xmlns="http://www.daisy.org/z3986/2005/dtbook/')));
  const model = await parseFileByExt(name, dataOrText);
  return isDtbook ? model : markImportedLinks(model);
}
// A zip that is damaged (its directory points outside the file, a part's deflate stream is corrupt or cut short, the main part is not
// there) is reported in the words for the kind of file the reader was given: "This Word document is damaged or incomplete ...".
const ZIP_KIND_NAMES = { docx: 'Word document', docm: 'Word document', dotx: 'Word document', dotm: 'Word document', odt: 'OpenDocument file', ott: 'OpenDocument file', epub: 'EPUB book', ebrl: 'eBraille book', ebraille: 'eBraille book', zip: 'zip file' };
async function parseFileByExt(name, dataOrText) {
  try { return addDamagedPartWarnings(name, dataOrText, await parseFileByExtOf(name, dataOrText)); }
  catch (e) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const kind = ZIP_KIND_NAMES[ext];
    const missing = e && !e.userFacing ? /^entry not found in zip: (.+)$/.exec(String(e.message)) : null;
    if (kind && e && (e.zipDamaged || missing)) {
      // the part is named (audit batch S2b item 21): the damaged one, or the one the file lacks
      const named = e.zipDamaged && e.part ? ` The damaged part is "${e.part}".` : missing ? ` The part "${missing[1]}" is missing.` : '';
      if (ext === 'docx' || ext === 'docm' || ext === 'dotx' || ext === 'dotm') throw docxUserError(DOCX_DAMAGED_MSG + named);
      throw docxUserError(`This ${kind} is damaged or incomplete and could not be read.${named}`);
    }
    // The last net under every reader (A89 step 4): a structure nested so deeply, or a list so long, that a reader's own recursion or an
    // array ran out ("Maximum call stack size exceeded", "Invalid array length") is a file Emboss cannot read, said in plain words, not a
    // raw error. (The readers' own limits - spans, nesting depths, zip sizes - catch the cases known; this one catches the rest.)
    if (e instanceof RangeError && /call stack|Invalid (array|string|typed array) length|Array buffer allocation/i.test(String(e.message))) {
      throw docxUserError('This file is nested far more deeply, or is far bigger, than Emboss can read. It may be damaged, or made on purpose to overload a program.');
    }
    throw e;
  }
}
// A part of a Word or OpenDocument file that is damaged but not needed to read the text (its styles, its numbering, a picture) is left out,
// as it always was; the load notice now says so, naming the part (audit batch S2b item 21). An EPUB names its own damaged chapters (skipped here).
const DAMAGED_PART_KINDS = new Set(['docx', 'docm', 'dotx', 'dotm', 'odt', 'ott', 'epub', 'ebrl', 'ebraille']);
function addDamagedPartWarnings(name, data, model) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (!model || typeof data === 'string' || !DAMAGED_PART_KINDS.has(ext)) return model;
  let st = null;
  try { st = ZIP_STATE.get(zipBytes(data).buffer); } catch { /* not a zip */ }
  if (!st) return model;
  const already = (model.warnings || []).join('\n');                // (an EPUB has named its damaged chapters already)
  const parts = [...new Set([...st.bad.values()].filter((e) => e && e.zipDamaged && e.part).map((e) => e.part))]
    .filter((part) => !already.includes(part.slice(part.lastIndexOf('/') + 1)));
  if (!parts.length) return model;
  const msg = parts.length === 1
    ? `A part of this file is damaged and was left out (${parts[0]}), so some of its formatting or content may be missing.`
    : `${parts.length} parts of this file are damaged and were left out (${parts.join(', ')}), so some of its formatting or content may be missing.`;
  (model.warnings || (model.warnings = [])).push(msg);
  return model;
}
async function parseFileByExtOf(name, dataOrText) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'xml' || ext === 'nimas' || ext === 'dtbook' || (typeof dataOrText === 'string' && (dataOrText.includes('<dtbook') || dataOrText.includes('xmlns="http://www.daisy.org/z3986/2005/dtbook/')))) {
    return parseDtbook(dataOrText);
  }
  switch (ext) {
    case 'docx': case 'docm': case 'dotx': case 'dotm': return parseDocxSniffed(dataOrText);
    case 'doc': case 'dot': return parseDoc(dataOrText);
    case 'odt': case 'ott': case 'fodt': return parseOdt(dataOrText);   // .ott: a template, the same package; .fodt: flat XML ODT
    case 'epub':
    case 'ebrl':
    case 'ebraille': return parseEpub(dataOrText);
    case 'zip':  return parseNimasZip(dataOrText);
    case 'html': case 'htm': case 'xhtml': return parseHtml(dataOrText);
    case 'md': case 'markdown': return parseMarkdown(dataOrText);
    case 'rtf':  return parseRtf(dataOrText);
    default: {                                                   // txt / fallback — unless it is a kind of file Emboss cannot read
      const refusal = unsupportedFileMessage(name, ext, dataOrText);
      if (refusal) throw docxUserError(refusal);
      return parseText(dataOrText);
    }
  }
}

// Feedback 30 Sep 2026, item 2: a file Emboss cannot read fell through to the plain-text reader, so a dropped PDF was brailled as its
// raw bytes ("%PDF-1.4 1 0 obj…") with no warning (drag-and-drop skips the file picker's type list). Such a file is now refused with a
// plain message (userFacing: Quick Mode and the editor show it as it is). A text file with any other extension is still read as text.
const SUPPORTED_FORMATS_TEXT = 'Word (.docx, .doc), OpenDocument (.odt), EPUB, HTML, Markdown, RTF, plain text and NIMAS/DAISY';
const PICTURE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'heic', 'heif', 'svg', 'ico']);
const OTHER_KINDS = {
  xlsx: 'spreadsheet', xls: 'spreadsheet', xlsm: 'spreadsheet', ods: 'spreadsheet', numbers: 'spreadsheet',
  pptx: 'presentation', ppt: 'presentation', odp: 'presentation', key: 'presentation',
  pages: 'Pages document',
};
function unsupportedFileMessage(name, ext, data) {
  let head = '';
  if (typeof data === 'string') head = data.slice(0, 2048);
  else if (data && (data instanceof ArrayBuffer || ArrayBuffer.isView(data))) {
    const u = data instanceof ArrayBuffer ? new Uint8Array(data, 0, Math.min(2048, data.byteLength)) : new Uint8Array(data.buffer, data.byteOffset, Math.min(2048, data.byteLength));
    head = String.fromCharCode(...u);
  }
  const fileName = String(name || 'This file');
  if (ext === 'pdf' || head.startsWith('%PDF')) return `Emboss can't read PDF files yet. Open the PDF in Word or Google Docs, save it as a Word document (.docx), and load that.`;
  if (PICTURE_EXTS.has(ext) || /^(\x89PNG|\xFF\xD8\xFF|GIF8|BM)/.test(head)) return `"${fileName}" is a picture, not a document. Emboss reads ${SUPPORTED_FORMATS_TEXT} files.`;
  if (OTHER_KINDS[ext]) return `Emboss can't read .${ext} files (a ${OTHER_KINDS[ext]}). If it holds a document, save it as a Word document (.docx) and load that. Emboss reads ${SUPPORTED_FORMATS_TEXT} files.`;
  // any other binary file: control characters (other than tab / line ends) or a NUL in the first 2 KB
  const ctl = (head.match(/[\x00-\x08\x0e-\x1f]/g) || []).length;
  if (head && (head.includes('\x00') || ctl > Math.max(2, head.length * 0.02))) return `Emboss can't read this kind of file ("${fileName}"). It reads ${SUPPORTED_FORMATS_TEXT} files.`;
  return null;
}

