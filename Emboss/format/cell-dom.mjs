// Table cell rich editing (G15). The editor used to show a cell's markup string verbatim
// in a plain <input> (`**bold**`, `*italic*`, `<u>…</u>`, `` `code` ``, `$latex$`) so a
// screen reader — and the word inspector — read out the punctuation as typed characters.
// This module converts a cell's inline segments (format/cell-markup.mjs: {type:'text',
// text, tf, uncontracted} / {type:'math', mathml, latex} / {type:'noteref', text, idref,
// annoref}) to and from the small HTML string a contenteditable table cell shows and edits,
// so the cell displays real <strong>/<em>/<u> formatting, a monospace span for uncontracted
// (grade-1) text, and an atomic, non-editable chip for maths and note references.
//
// The HTML dialect is entirely our own (only ever produced by segmentsToCellHtml, or typed
// text the browser inserts into it), so cellHtmlToSegments only needs to understand the
// handful of tags this module writes — it is not a general HTML parser. A maths or note
// chip carries every field it needs (data-mathml, data-latex, data-text, data-idref,
// data-annoref) so the round trip needs no "was this cell edited?" comparison against the
// previous value: MathML survives an edit to the cell's other text exactly, with no markup
// characters ever visible to a screen reader.
import { TF_ITALIC, TF_UNDERLINE, TF_BOLD, TF_SCRIPT, cellSegments, cellFromSegments } from './cell-markup.mjs';

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeHtml(s) {
  return String(s ?? '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body) => {
      if (body[0] === '#') {
        const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      const key = body.toLowerCase();
      return key in ENTITIES ? ENTITIES[key] : m;
    })
    .replace(/ /g, ' ');   // a non-breaking space the browser inserted for a trailing space
}

// A cell's plain-text math/noteref placeholder when a segment is missing its usual text
// (mirrors cellToMarkup's `\text{[equation]}` fallback, format/cell-markup.mjs).
const EMPTY_MATH_LABEL = '[equation]';

// ---- maths chip rendering: un-prefixed MathML for Chrome's native renderer ----------
// format/document.mjs's DTBook export (input/nimas-export.mjs normalizeMathMl/
// serializeMathMl) prefixes every element `m:` because the DTD binds that prefix. HTML's
// own parser recognises MathML "foreign content" only from the *bare* tag name
// (`<math>…</math>`, no prefix) — that is what triggers Chrome to render it natively
// instead of showing literal tag text — so this goes the other way: strip whatever prefix
// the source used (however it was parsed/typed) and drop the now-dangling xmlns declarations.
function bareMathMl(raw) {
  let m = String(raw || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
  if (!m) return '';
  m = m.replace(/<(\/?)(?:[A-Za-z][\w.-]*:)?([A-Za-z][\w.-]*)((?:\s[^<>]*?)?)(\/?)>/g, (all, slash, local, attrs, selfClose) => {
    const a = attrs
      .replace(/\s+xmlns(?::[\w.-]+)?\s*=\s*"[^"]*"/g, '')
      .replace(/\s+xmlns(?::[\w.-]+)?\s*=\s*'[^']*'/g, '');
    return `<${slash}${local}${a}${selfClose}>`;
  });
  if (!m.startsWith('<')) return '';
  if (!/^<math[\s>]/.test(m)) m = `<math>${m}</math>`;
  m = sanitizeMathMl(m);
  // A usable root: <math>…</math> with something left inside after sanitising (an
  // attribute fragment, a stray tag, or content that was entirely stripped as unsafe is
  // not worth handing to the HTML parser — the caller falls back to the LaTeX text).
  if (!/^<math\b[^>]*>[\s\S]*\S[\s\S]*<\/math>\s*$/.test(m)) return '';
  return m;
}

// MathML's `<annotation-xml encoding="text/html">` is a documented HTML *integration
// point* — content inside it runs as real HTML (including <script>) once parsed. An
// imported document's MathML is not fully trusted (same reasoning as the tactile SVG
// import's sanitizeSvgMarkup, web/editor/editor.mjs), so strip anything that could inject
// script before this ever reaches innerHTML.
function sanitizeMathMl(m) {
  return m
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<annotation-xml\b[^>]*\sencoding\s*=\s*["'](?:text\/html|application\/xhtml\+xml)["'][^>]*>[\s\S]*?<\/annotation-xml\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/(\s(?:href|xlink:href)\s*=\s*)(["'])\s*(?:javascript:|data:text\/html)[^"']*\2/gi, '$1$2$2');
}

// The chip's aria-label/title (build item 1 follow-up): the LaTeX when there is one,
// otherwise the MathML's own `alttext`, otherwise a generic label.
function mathAltText(g) {
  const latex = (g.latex || '').trim();
  if (latex) return `equation ${latex}`;
  const m = /\balttext\s*=\s*"([^"]*)"/.exec(String(g.mathml || '')) || /\balttext\s*=\s*'([^']*)'/.exec(String(g.mathml || ''));
  if (m && m[1] && m[1] !== 'math expression') return `equation ${decodeHtml(m[1])}`;
  return 'equation';
}

/** One text run's HTML: bold > italic > script > underline > uncontracted, a fixed nesting
 * order so every combination of `tf` bits round-trips through the same tag order every time. */
// Sub/superscript markers (format/text-style.mjs SCRIPT_MARKS, U+E000/U+E001 open, U+E002 close) inside a run's text
// are shown as real <sub>/<sup> in the cell and read back by cellHtmlToSegments (30 Sep: a cell showed them as boxes).
function scriptsToHtml(html) {
  return html.replace(/([\uE000\uE001])([^\uE000-\uE002]*)\uE002?/g, (_, open, inner) => (inner ? (open === '\uE000' ? `<sub>${inner}</sub>` : `<sup>${inner}</sup>`) : '')).replace(/\uE002/g, '');
}
function textRunHtml(text, tf, uncontracted, strike = false) {
  let html = scriptsToHtml(escapeHtml(text));
  if (!html) return '';
  if (uncontracted) html = `<span class="cell-code">${html}</span>`;
  if (strike) html = `<s>${html}</s>`;   // UEB 9.5.1 strikethrough (transcriberTypeform 'strike'): shown in the cell, as bold and underline are (audit w19)
  if (tf & TF_UNDERLINE) html = `<u>${html}</u>`;
  if (tf & TF_SCRIPT) html = `<span class="cell-script">${html}</span>`;   // K5: UEB §9 script typeform, no native tag
  if (tf & TF_ITALIC) html = `<em>${html}</em>`;
  if (tf & TF_BOLD) html = `<strong>${html}</strong>`;
  return html;
}

// K35: a picture kept in a data-table cell (parse.mjs's docxCellValue and friends,
// BANA 10.11.1) is an inline `imgnote` segment — the same embedded transcriber's-note shape
// exercise pictures use ({ type: 'imgnote', text: description, src?, prodnote?, render?,
// uncontracted?, spanTypeform? }: format/cell-markup.mjs, input/nimas-export.mjs's
// serializeInlineLeaf). Before this it fell through to the plain-text branch below, so
// editing anything else in the cell replaced the whole cell with the description text alone
// and silently dropped the picture (no src, no prodnote/render flags). It is now an atomic
// chip like the maths/note-reference chips above, carrying every field it needs in data-*
// attributes so cellHtmlToSegments rebuilds the exact same segment untouched by an edit
// elsewhere in the cell, plus a small thumbnail when the caller can resolve `src` to a
// displayable URL (the editor's loadedDocInfo.resourceUrls — see editor.mjs's makeTableCell).
function imgnoteChipHtml(g, resolveImgSrc) {
  const text = String(g.text ?? '');
  const attrs = [`data-text="${escapeHtml(text)}"`];
  if (g.src) attrs.push(`data-src="${escapeHtml(g.src)}"`);
  if (g.prodnote) attrs.push('data-prodnote="1"');
  if (g.render) attrs.push(`data-render="${escapeHtml(g.render)}"`);   // 'required' or 'optional' (parse.mjs reads either literally from <prodnote render>)
  if (g.uncontracted) attrs.push('data-uncontracted="1"');
  if (g.spanTypeform) attrs.push('data-span-typeform="1"');
  const label = text || 'picture';
  const thumbUrl = g.src && typeof resolveImgSrc === 'function' ? resolveImgSrc(g.src) : null;
  const thumb = thumbUrl ? `<img class="cell-imgnote-thumb" src="${escapeHtml(thumbUrl)}" alt="" aria-hidden="true"/>` : '🖼️ ';
  return `<span class="cell-imgnote-chip" contenteditable="false" role="img" aria-label="${escapeHtml(`picture: ${label}`)}" title="${escapeHtml(label)}" ${attrs.join(' ')}>${thumb}${escapeHtml(label)}</span>`;
}

/** Inline segments → the HTML a contenteditable table cell shows. `resolveImgSrc(src)` (optional)
 * turns an imgnote segment's own `src` into a displayable URL for its thumbnail (K35); with none,
 * or when it returns nothing, the chip still shows a picture glyph and its description. */
export function segmentsToCellHtml(segments, resolveImgSrc) {
  const segs = Array.isArray(segments) ? segments : [];
  return segs.map((g) => {
    if (g.type === 'math') {
      const latex = g.latex || '';
      const attrs = [`data-latex="${escapeHtml(latex)}"`];
      // data-mathml keeps the *original* (unprocessed) MathML exactly, for the save —
      // separate from the cleaned, un-prefixed copy rendered as the chip's content below.
      if (g.mathml) attrs.push(`data-mathml="${escapeHtml(g.mathml)}"`);
      const altText = mathAltText(g);
      const rendered = g.mathml ? bareMathMl(g.mathml) : '';
      const inner = rendered || escapeHtml(latex || EMPTY_MATH_LABEL);
      return `<span class="cell-math-chip" contenteditable="false" role="img" aria-label="${escapeHtml(altText)}" title="${escapeHtml(altText)}" ${attrs.join(' ')}>${inner}</span>`;
    }
    if (g.type === 'noteref') {
      const mark = g.text || '';
      const attrs = [`data-text="${escapeHtml(mark)}"`];
      if (g.idref) attrs.push(`data-idref="${escapeHtml(g.idref)}"`);
      if (g.annoref) attrs.push('data-annoref="1"');
      return `<span class="cell-noteref-chip" contenteditable="false" role="img" aria-label="${escapeHtml(`note reference ${mark}`)}" ${attrs.join(' ')}>${escapeHtml(mark)}</span>`;
    }
    if (g.type === 'imgnote') return imgnoteChipHtml(g, resolveImgSrc);
    return textRunHtml(g.text || '', g.tf || 0, !!g.uncontracted, g.transcriberTypeform === 'strike');
  }).join('');
}

/** The HTML a cell's contenteditable should show, from a cell (string or {text, segments}).
 * `resolveImgSrc` is passed straight through to segmentsToCellHtml (K35). */
export function cellToEditableHtml(cell, resolveImgSrc) {
  return segmentsToCellHtml(cellSegments(cell), resolveImgSrc);
}

const TAG_TF = { strong: TF_BOLD, b: TF_BOLD, em: TF_ITALIC, i: TF_ITALIC, u: TF_UNDERLINE };
const ATTR = (attrs, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? decodeHtml(m[1]) : '';
};

/** The contenteditable cell's HTML → inline segments (the inverse of segmentsToCellHtml). */
export function cellHtmlToSegments(html) {
  const s = String(html || '');
  const segments = [];
  let tf = 0, unc = false, strike = false;
  const push = (seg) => {
    const last = segments[segments.length - 1];
    if (seg.type === 'text' && last && last.type === 'text' && (last.tf || 0) === (seg.tf || 0) && !!last.uncontracted === !!seg.uncontracted && (last.transcriberTypeform || null) === (seg.transcriberTypeform || null)) {
      last.text += seg.text;
    } else {
      segments.push(seg);
    }
  };
  const pushText = (raw) => {
    // A pasted newline never reaches here (the paste handler strips it); a stray one
    // (a browser-inserted <br>/<div>, defensively handled below) becomes a plain space —
    // a cell stays single-paragraph, as the old single-line <input> enforced.
    const text = decodeHtml(raw).replace(/\r\n|\r|\n/g, ' ');
    if (!text) return;
    const seg = { type: 'text', text };
    if (tf) seg.tf = tf;
    if (unc) seg.uncontracted = true;
    if (strike) seg.transcriberTypeform = 'strike';
    push(seg);
  };
  const tokenRe = /<(\/)?(strong|b|em|i|u|s|strike|del|span|div|br|sub|sup)\b([^>]*)>|([^<]+)/gi;
  let m;
  while ((m = tokenRe.exec(s)) !== null) {
    if (m[4] !== undefined) { pushText(m[4]); continue; }
    const isClose = !!m[1];
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    if (tag === 'br') { continue; }
    if (tag === 's' || tag === 'strike' || tag === 'del') { strike = !isClose; continue; }
    if (tag === 'sub' || tag === 'sup') {   // back to the markers the rest of Emboss uses (scriptsToHtml, above)
      const mark = isClose ? '\uE002' : (tag === 'sub' ? '\uE000' : '\uE001');
      const seg = { type: 'text', text: mark };
      if (tf) seg.tf = tf;
      if (unc) seg.uncontracted = true;
      if (strike) seg.transcriberTypeform = 'strike';
      push(seg);
      continue;
    }
    if (tag === 'div') { continue; }
    if (tag === 'span') {
      if (!isClose && /class="[^"]*\bcell-math-chip\b/.test(attrs)) {
        const closeIdx = s.indexOf('</span>', tokenRe.lastIndex);
        const seg = { type: 'math', latex: ATTR(attrs, 'data-latex') };
        const mathml = ATTR(attrs, 'data-mathml');
        if (mathml) seg.mathml = mathml;
        segments.push(seg);
        if (closeIdx >= 0) tokenRe.lastIndex = closeIdx + 7;
        continue;
      }
      if (!isClose && /class="[^"]*\bcell-noteref-chip\b/.test(attrs)) {
        const closeIdx = s.indexOf('</span>', tokenRe.lastIndex);
        const seg = { type: 'noteref', text: ATTR(attrs, 'data-text') };
        const idref = ATTR(attrs, 'data-idref');
        if (idref) seg.idref = idref;
        if (/\bdata-annoref="1"/.test(attrs)) seg.annoref = true;
        segments.push(seg);
        if (closeIdx >= 0) tokenRe.lastIndex = closeIdx + 7;
        continue;
      }
      // K35: a picture kept in the cell (imgnoteChipHtml above) — its thumbnail <img>, if
      // any, is inside the span and is skipped the same way a maths chip's rendered MathML
      // is: jump straight to the matching </span> rather than tokenizing the chip's content.
      if (!isClose && /class="[^"]*\bcell-imgnote-chip\b/.test(attrs)) {
        const closeIdx = s.indexOf('</span>', tokenRe.lastIndex);
        const seg = { type: 'imgnote', text: ATTR(attrs, 'data-text') };
        const src = ATTR(attrs, 'data-src');
        if (src) seg.src = src;
        if (/\bdata-prodnote="1"/.test(attrs)) seg.prodnote = true;
        const render = ATTR(attrs, 'data-render');
        if (render) seg.render = render;
        if (/\bdata-uncontracted="1"/.test(attrs)) seg.uncontracted = true;
        if (/\bdata-span-typeform="1"/.test(attrs)) seg.spanTypeform = true;
        segments.push(seg);
        if (closeIdx >= 0) tokenRe.lastIndex = closeIdx + 7;
        continue;
      }
      // A plain (cell-code / cell-script) span: only its open/close toggles the run. Neither
      // ever nests inside the other (uncontracted text and script text are set separately in
      // the editor), so a closing </span> with no class simply clears whichever was open —
      // the same simplification segmentsToCellHtml's fixed nesting order already relies on.
      if (!isClose && /class="[^"]*\bcell-code\b/.test(attrs)) unc = true;
      else if (!isClose && /class="[^"]*\bcell-script\b/.test(attrs)) tf |= TF_SCRIPT;
      else if (isClose) { unc = false; tf &= ~TF_SCRIPT; }
      continue;
    }
    const bit = TAG_TF[tag];
    if (bit) { if (isClose) tf &= ~bit; else tf |= bit; }
  }
  return segments;
}

/** The cell to store after editing a contenteditable cell's HTML (cellFromSegments already
 * decides plain string vs. an object that keeps segments — format/cell-markup.mjs). */
export function cellFromEditableHtml(html) {
  const segments = cellHtmlToSegments(html);
  const plain = segments.map((g) => (g.type === 'text' ? g.text : (g.latex || g.text || ''))).join('');
  return cellFromSegments(plain, segments);
}
