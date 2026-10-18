// eBraille 1.0 export for Emboss - a REAL .ebrl, built by the shared writer, from the DOCUMENT MODEL.
//
// HISTORY. 2026-09-02: the first exporter wrote its own XML (`<ebraille xmlns="http://www.ebu.org/...">`,
// extension .ebrf), which no eBraille reader could open and the DAISY checker rejected outright; it was replaced
// by a real OCF container built by Translate/ebraille.mjs. That version wrote the EMBOSSER PAGES: one XHTML per
// volume (in practice one 3.5 MB file for a whole book), every braille line of every page a <p>, a table of
// contents of one entry, no page list, no headings. 2026-10-01, Paul (user feedback: "does not fully exploit the
// eBraille file format for large documents as it is monolithic"): that form is dropped, not kept as an option
// (BRF and PEF already cover embossing). Fixed lines cannot reflow on a braille display and cannot be navigated,
// and eBraille 1.0 asks for reflowable, structured braille (7: no fixed layout; 10: headings identified;
// 6.2.2: list markers inside the items; 8.3.2: a page list with the print number in `title`).
//
// WHAT IT WRITES NOW.
//   * SEVERAL CONTENT DOCUMENTS. One per top-level section: a level-1 heading starts one; a document with no
//     level-1 heading splits at level 2; with no headings at all there is one. Everything before the first
//     section heading (title page, transcriber's notes page, special symbols page, copyright matter) is a
//     document of its own, content/front-matter.html. A section that is still big (SPLIT_SOFT, SPLIT_HARD
//     below) is divided further - at the next heading or print page break once it passes SPLIT_SOFT, at any
//     block boundary once it reaches SPLIT_HARD - so no file grows past a few hundred kilobytes.
//   * STRUCTURED BRAILLE. h1-h6 with ids, p, ul/ol (the marker is part of each item's text, 6.2.2), table/th/td,
//     footnotes as aside role="doc-footnote" linked from their reference (role="doc-noteref"), transcriber's
//     notes, poetry as a list, code, tactile graphics as figures. Emphasis, contractions, maths, transcriber's
//     note indicators and the rest are in the cells: they come from the formatter (see below).
//   * PRINT PAGES as role="doc-pagebreak" markers, and a page list in the entry page whose entries carry the
//     print number in `title` (8.3.2); a11y:pageBreakSource is declared (the spec does so in its own example).
//   * A NESTED TABLE OF CONTENTS built from the headings, in braille, linking to each heading's id.
//   * A STYLE SHEET (css/ebraille.css) for the BANA or UKAAF layout, in ch/rem only (6.3.2).
//
// HOW THE BRAILLE IS MADE. Not by a second implementation of the braille rules. Translation, contractions,
// emphasis, maths, notes, margins and all the "blank line here, not there" rules are the formatter's
// (format/document.mjs). flowDocument() runs the formatter's own document preparation (note placement, the
// endnote section, special-symbol and transcriber's-note pages, word lists, print page numbers, poems,
// emphasis context) and hands each prepared block to us in page order instead of paginating; flowLines() asks
// for the block laid out at a width no block reaches, so each paragraph comes back as one flowing string with
// the cells of margin it began with. From those margins and blank lines this file writes CSS classes (m2-0 =
// first line at cell 3, runovers at cell 1; bb/ba = a blank line before/after), so the stylesheet says what
// the embosser pages said. Nothing here wraps a line.
//
// Braille only (spec 3; the checker's EBR-030): every piece of text, and the alt/aria-label/figcaption text, is
// pushed through the same `translate` the pages went through. The contents' labels are the headings' own braille.

import { brfToUnicodeBraille } from '../engine/brf-ascii.mjs';
import {
  flowDocument, flowLines, flowSegs, flowCell, flowJoins, flowHeadingStyle, flowListMargins, flowRunover,
  FLOW_MARKS, pageNumberText,
} from './document.mjs';
import { packageEbraille } from '../Translate/ebraille.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- when a section is divided further ----
// A content document should stay small enough for a reading system to open at once. Sizes are UTF-8 bytes of
// the XHTML (a braille cell is three).
const SPLIT_SOFT = 200 * 1024;   // past this, the part ends at the next heading or print page break
const SPLIT_HARD = 400 * 1024;   // past this, at the next block boundary of any kind
const FRONT = 'content/front-matter.html';
const CSS_HREF = 'css/ebraille.css';

// ---- braille text ----

// BRF ASCII -> the cells of the file. A single space stays a space (the only place a reading system may break a
// line); a run of blanks keeps its width as blank braille cells after the first space (a two-cell gap is
// meaningful and HTML would collapse real spaces).
// A run of four or more blanks is not text. In the formatter it is the padding that carries a print line number to the right
// margin (wrapNumbered), and at flow width the margin is 20000 cells away: it comes back as the two blanks the formatter
// itself always leaves before such a number. (`keep`: code, where a run of blanks is the code.)
const cells = (brf, keep = false) => String(brf ?? '').replace(/ +|[^ ]+/g, (m) => {
  if (m[0] !== ' ') return brfToUnicodeBraille(m);
  const n = !keep && m.length > 3 ? 2 : m.length;
  return n === 1 ? ' ' : ' ' + '⠀'.repeat(n - 1);               // U+2800, the blank braille cell
});

const BLANK_CELL = '⠀';                 // U+2800, the blank braille cell: a row of nothing
// S3b #20 (Paul C1): what stands in a cell or label whose translation failed - a transcriber's note, as "Equation could not be read" is.
const CELL_NOTE = 'Cell could not be brailled', LABEL_NOTE = 'Label could not be brailled';
function marker(o, text) {
  let t = '';
  try { t = String(o.translate(text) ?? '').trim(); } catch { /* the translator is failing on everything: the bare indicators still mark the place */ }
  return FLOW_MARKS.tnOpen + t + FLOW_MARKS.tnClose;
}

const REF_RE = new RegExp(`${FLOW_MARKS.open}([^${FLOW_MARKS.sep}]*)${FLOW_MARKS.sep}([\\s\\S]*?)${FLOW_MARKS.close}`, 'g');
// The formatter fences a note reference's cells with private-use marks (o.flowMarks); here they become the link.
function inline(brf, S) {
  let out = '', last = 0;
  for (const m of String(brf ?? '').matchAll(REF_RE)) {
    out += esc(cells(brf.slice(last, m.index)));
    const target = m[1];
    out += target
      ? `<a role="doc-noteref" epub:type="noteref" href="@@NOTE:${esc(target)}@@">${esc(cells(m[2]))}</a>`
      : esc(cells(m[2]));
    last = m.index + m[0].length;
  }
  return out + esc(cells(String(brf ?? '').slice(last)));
}
const plain = (brf) => cells(String(brf ?? '').replace(REF_RE, '$2'));

const ID_BAD = /[^A-Za-z0-9_-]+/g;
const sanitize = (s) => String(s ?? '').replace(ID_BAD, '-').replace(/^-+|-+$/g, '') || 'x';

// ---- the elements a block turns into ----
// A top-level element is kept as data until the sections are cut: the blank-line classes depend on the
// neighbour (the formatter drops a heading's trailing blank when text follows it directly), and the file an id
// ends up in is not known until the sections are cut.
function el(tag, { cls = [], attrs = '', inner = '', kind = 'block', ...rest } = {}) {
  return { tag, cls: new Set(cls), attrs, inner, kind, bb: false, ba: false, ids: [], ...rest };
}
function render(e) {
  const c = [...e.cls, ...(e.bb ? ['bb'] : []), ...(e.ba ? ['ba'] : [])];
  return `<${e.tag}${c.length ? ` class="${c.join(' ')}"` : ''}${e.attrs}>${e.inner}</${e.tag}>`;
}

// the margin class for a line that begins `first` cells in and runs over to `runover` (relative to a parent list item)
function marginClass(S, first, runover, parentRunover = 0) {
  first = Math.max(0, first | 0); runover = Math.max(0, runover | 0);
  if (!parentRunover) {
    if (first === 2 && runover === 0) return null;                     // the paragraph default, 3-1
    if (first === 0 && runover === 0) return 'left-aligned';
    if (first === 0 && runover === 2) return 'hanging';
  }
  const name = `m${first}-${runover}${parentRunover ? `-${parentRunover}` : ''}`;
  S.margins.set(name, { first, runover, parent: parentRunover });
  return name;
}
const isCentred = (indent) => indent > 200;                           // a centred line comes back with half the layout width as margin

// A block's lines as one run of text: hard breaks stay breaks.
const joinLines = (lines, S, sep = '<br/>') => lines.map((l) => inline(l.text, S)).join(sep);

// ---- sequences: joining, poems ----
class Seq {
  constructor() { this.els = []; this.prevBlock = null; this.prevIdx = -1; }
  // Add the elements of one block. The formatter drops the blank lines between a heading and the text that
  // follows it (joinsWithoutBlank); the same is done to the blank classes here.
  add(block, els, o, nb = null) {
    if (!els.length) return;
    const last = this.els[this.els.length - 1];
    if (last && this.prevBlock && flowJoins(this.prevBlock, block, o, nb || undefined)) {
      last.ba = false; els[0].bb = false;
    }
    this.els.push(...els);
    this.prevBlock = block;
  }
}

// ---- block conversion ----
function convertBlock(b, o, atStart, S, seq) {
  if (!b || typeof b !== 'object') return [];
  switch (b.type) {
    case 'heading': return heading(b, o, atStart, S);
    case 'pagenum': return pagenum(b, o, S);
    case 'list': return (b.kind === 'glossary' || b.style === 'glossary') ? glossary(b, o, atStart, S) : list(b, o, atStart, S);
    case 'glossary': return glossary(b, o, atStart, S);
    case 'table': return table(b, o, S);
    case 'box': case 'sidebar': return box(b, o, S);
    case 'footnote': return footnote(b, o, atStart, S);
    case 'graphic': case 'tactile': return graphic(b, o, atStart, S);
    case 'code': return code(b, o, atStart, S);
    case 'note': return note(b, o, atStart, S);
    case 'tnpage': case 'sympage': return specialPage(b, o, atStart, S);
    case 'titlepage': return titlePage(b, o, atStart, S);
    case 'indicator': case 'break': return indicator(b, o, atStart, S, seq);
    case 'blank': return [];
    case 'verse': case 'poem': case 'poetry': return verse(b, o, atStart, S, seq);
    case 'play': case 'dialogue':
      if (b.type === 'play' && (b.subtype === 'verse' || b.style === 'verse' || b.style === 'poem')) return verse(b, o, atStart, S, seq);
      if (b.type === 'dialogue' && (b.subtype === 'verse' || b.style === 'verse' || b.style === 'poem')) return verse(b, o, atStart, S, seq);
      return paragraph(b, o, atStart, S, b.type);
    case 'math': return paragraph(b, o, atStart, S, 'math');
    case 'title': return paragraph(b, o, atStart, S, 'title');
    case 'attribution': case 'caption': case 'xref': case 'stage': return paragraph(b, o, atStart, S, b.type);
    default: return paragraph(b, o, atStart, S, null);
  }
}

function blanks(e, r) { if (r.before) e.bb = true; if (r.after) e.ba = true; return e; }

function paragraph(b, o, atStart, S, kind) {
  const r = flowLines(b, o, atStart);
  if (!r.lines.length) return [];
  const first = r.lines[0].indent;
  const cls = kind && kind !== 'para' ? [kind] : [];
  if (isCentred(first)) cls.push('centered');
  else { const m = marginClass(S, first, flowRunover(b, o)); if (m) cls.push(m); }
  if (b.type === 'para' && b.style && !cls.includes(String(b.style))) cls.push(sanitize(b.style));
  return [blanks(el('p', { cls, inner: joinLines(r.lines, S) }), r)];
}

function heading(b, o, atStart, S) {
  const r = flowLines(b, o, atStart);
  if (!r.lines.length) return [];
  const level = Math.min(6, Math.max(1, Number(b.level) || 1));
  const st = flowHeadingStyle(b, o);
  const text = r.lines.map((l) => l.text).join(' ');
  const id = S.heading();
  const cls = [];
  if (st.centred) cls.push('centered'); else { const m = marginClass(S, st.first, st.runover); if (m) cls.push(m); }
  if (S.box) cls.push('box-heading');
  const e = blanks(el('h' + level, { cls, attrs: ` id="${id}"`, inner: inline(text, S), kind: 'heading', level, ids: [id] }), r);
  if (!S.box) S.headings.push({ el: e, id, level, label: plain(text) });
  return [e];
}

function pagenum(b, o, S) {
  const p = pageNumberText(b);
  if (!p) return [];
  const brl = cells((o.translate ? o.translate(p) : p).trim());
  const id = S.unique('pg-' + sanitize(p));
  // The indicator as the embosser pages carried it: BANA a line of dots 3-6 then the number, UKAAF dot 5, dots 25
  // then the number. The number alone is in aria-label for a reader that matches pages by it.
  const lead = S.bana ? '⠤⠤' : '⠐⠒';           // dots 36 36 / dot 5, dots 25
  const e = el('div', { cls: ['pagebreak'], attrs: ` role="doc-pagebreak" id="${id}" aria-label="${esc(brl)}"`, inner: esc(lead + brl), kind: 'page', ids: [id] });
  const pg = { el: e, id, title: p, label: brl };
  e.page = pg;
  S.pages.push(pg);
  return [e];
}

// ---- lists ----
const BULLET_RE = /^[\p{S}\p{Pd}−*·∙‣⁃]$/u;
const isOrdered = (it) => !!it && !it.bullet && it.marker != null && String(it.marker).trim() !== '' && !BULLET_RE.test(String(it.marker).trim());

// Nest a flat run of rows {level, ordered, cls, inner, extra} into <ul>/<ol>. A deeper row opens a list inside the
// previous item; a jump of more than one level still opens one list at a time. Returns [{ tag, inner }] (a list
// that changes between ordered and unordered at its own level ends and a new one starts).
function emitList(rows) {
  const build = (i, lvl) => {
    const tag = rows[i].ordered ? 'ol' : 'ul';
    let html = '', first = true;
    while (i < rows.length && rows[i].level >= lvl) {
      if (rows[i].level > lvl) {                       // deeper with no item above it at this level
        const [sub, ni] = build(i, rows[i].level);
        html += `<li><${sub.tag}>${sub.html}</${sub.tag}></li>`; i = ni; first = false; continue;
      }
      if (!first && rows[i].ordered !== (tag === 'ol')) break;
      const row = rows[i];
      let inner = row.inner + (row.extra || ''); i++;          // the item's text, its further blocks, then its sub list
      if (i < rows.length && rows[i].level > lvl) {
        const [sub, ni] = build(i, lvl + 1);
        inner += `<${sub.tag}>${sub.html}</${sub.tag}>`; i = ni;
      }
      html += `<li${row.cls.length ? ` class="${row.cls.join(' ')}"` : ''}>${inner}</li>`;
      first = false;
    }
    return [{ tag, html }, i];
  };
  const out = [];
  let i = 0;
  while (i < rows.length) { const [l, ni] = build(i, rows[i].level); out.push({ tag: l.tag, inner: l.html }); i = ni; }
  return out;
}

function list(b, o, atStart, S) {
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.some(Boolean)) return [];
  const nested = [];                   // ids of the elements inside the items (page markers, notes), for the page list and links
  const extras = (it) => {
    // an item's further blocks (a table, more paragraphs) go inside its <li>
    if (!it || !Array.isArray(it.blocks) || !it.blocks.length) return '';
    const els = convertAll(it.blocks.filter((x) => x && typeof x === 'object'), o, S);
    nested.push(...els.flatMap((e) => e.ids));
    return '\n' + els.map(render).join('\n') + '\n';
  };
  const rows = [];
  let r;
  if (b.kind === 'toc') {
    // A contents list printed in the book: title and print page. Its page column and guide dots are embosser layout.
    const mg = flowListMargins(b, o);
    r = { before: 1, after: 1 };
    items.forEach((it) => {
      if (!it) return;
      const segs = Array.isArray(it.segments) && it.segments.length ? it.segments : [{ type: 'text', text: String(it.text ?? it.title ?? '') }];
      let t = flowSegs(segs, o);
      const pg = it.page != null && String(it.page).trim() ? o.translate(String(it.page)).trim() : '';
      if (pg) t = `${t} ${pg}`;
      if (!t.trim()) return;
      rows.push({ level: it.level || 0, ordered: false, cls: [], inner: inline(t.replace(/\n/g, ' '), S), extra: extras(it), margins: mg(it) });
    });
  } else {
    const lite = { ...b, items: items.map((it) => (it ? { ...it, blocks: undefined } : it)) };
    r = flowLines(lite, o, atStart);
    const mg = flowListMargins(lite, o);
    let cur = null;
    const seen = new Set();
    for (const l of r.lines) {
      if (l.u != null && cur && cur.u === l.u) { cur.lines.push(l); continue; }
      cur = { u: l.u, lines: [l] };
      rows.push(cur);
      if (l.u != null) seen.add(l.u);
    }
    rows.forEach((row) => {
      const it = row.u != null ? items[row.u] : null;
      row.level = it ? (it.level || 0) : 0;
      row.ordered = isOrdered(it);
      row.inner = joinLines(row.lines, S);
      row.extra = extras(it);
      row.margins = it ? mg(it) : { first: row.lines[0].indent, runover: 0 };
      row.cls = [];
    });
    // items that have blocks but no line of their own (an empty item holding a table) keep their place
    items.forEach((it, ui) => {
      if (!it || seen.has(ui) || !Array.isArray(it.blocks) || !it.blocks.length) return;
      const at = rows.findIndex((x) => x.u != null && x.u > ui);
      rows.splice(at < 0 ? rows.length : at, 0, { u: ui, level: it.level || 0, ordered: false, inner: '', extra: extras(it), margins: mg(it), cls: [] });
    });
  }
  if (!rows.length) return [];
  // margin classes, relative to the parent item
  const parentRun = [];
  rows.forEach((row) => {
    const lvl = row.level;
    parentRun.length = lvl;
    const pr = lvl > 0 ? (parentRun[lvl - 1] || 0) : 0;
    const m = row.margins;
    const cls = marginClassForItem(S, m.first, m.runover, pr);
    row.cls = cls ? [cls] : [];
    parentRun[lvl] = m.runover;
  });
  const kindCls = b.kind === 'toc' ? 'toc' : (b.kind && b.kind !== 'list' ? sanitize(b.kind) : null);
  const lists = emitList(rows);
  // each top-level list is an element of its own; the first carries the blank line before the block, the last the one after
  return lists.map((l, i) => {
    const e = el(l.tag, { cls: kindCls ? [kindCls] : [], inner: l.inner, ids: i === 0 ? nested : [] });
    if (i === 0) e.bb = !!r.before;
    if (i === lists.length - 1) e.ba = !!r.after;
    return e;
  });
}
// a list item's class: `li` itself is (0,2) in the stylesheet
function marginClassForItem(S, first, runover, parentRunover) {
  if (!parentRunover && first === 0 && runover === 2) return null;
  const name = `m${first}-${runover}${parentRunover ? `-${parentRunover}` : ''}`;
  S.margins.set(name, { first, runover, parent: parentRunover });
  return name;
}

function glossary(b, o, atStart, S) {
  const r = flowLines(b, o, atStart);
  if (!r.lines.length) return [];
  const rows = [];
  let cur = null;
  for (const l of r.lines) {
    if (l.u != null && cur && cur.u === l.u) { cur.lines.push(l); continue; }
    cur = { u: l.u, lines: [l] }; rows.push(cur);
  }
  const inner = rows.map((row) => {
    const m = marginClassForItem(S, row.lines[0].indent, row.lines[0].indent + 2, 0);
    return `<li${m ? ` class="${m}"` : ''}>${joinLines(row.lines, S)}</li>`;
  }).join('');
  return [blanks(el('ul', { cls: ['glossary'], inner }), r)];
}

// ---- verse ----
function verse(b, o, atStart, S, seq) {
  const r = flowLines(b, o, atStart);
  if (!r.lines.length) return [];
  const run = flowRunover(b, o);
  const lis = r.lines.map((l) => {
    const m = marginClassForItem(S, l.indent, run, 0);
    const stanza = S.stanza ? ' stanza' : '';
    S.stanza = false;
    const c = [m, stanza.trim()].filter(Boolean).join(' ');
    return `<li${c ? ` class="${c}"` : ''}>${inline(l.text, S)}</li>`;
  }).join('');
  // consecutive lines of verse are one list
  const last = seq && seq.els[seq.els.length - 1];
  if (last && last.poem) { last.inner += lis; return []; }
  const e = el('ul', { cls: ['poetry'], inner: lis, poem: true });
  if (S.bana) { e.bb = true; e.ba = true; }
  return [e];
}

function indicator(b, o, atStart, S, seq) {
  if (b.kind === 'line' || b.kind === 'stanza') {
    const last = seq && seq.els[seq.els.length - 1];
    if (last && last.poem) S.stanza = true;
    return [];
  }
  const r = flowLines(b, o, atStart);
  if (!r.lines.length) return [];
  return [blanks(el('p', { cls: ['indicator', 'centered'], inner: joinLines(r.lines, S) }), r)];
}

// ---- notes ----
function footnote(b, o, atStart, S) {
  const r = flowLines(b, o, atStart);
  // the separator line the embosser pages draw above a note is layout (no source cells)
  let lines = r.lines.filter((l) => l.u != null);
  if (!lines.length) lines = r.lines;
  if (!lines.length) return [];
  const id = b.id ? S.unique('fn-' + sanitize(b.id)) : null;
  if (id && !S.notes.has(String(b.id))) S.notes.set(String(b.id), id);
  const inner = lines.map((l, i) => {
    const m = marginClass(S, l.indent, 2);
    return `<p${m ? ` class="${m}"` : ''}>${inline(l.text, S)}</p>`;
  }).join('');
  const e = el('aside', { cls: ['footnote'], attrs: ` role="doc-footnote"${id ? ` id="${id}"` : ''}`, inner, ids: id ? [id] : [] });
  if (b.inEndnoteSection) e.cls.add('endnote');
  return [blanks(e, r)];
}

function note(b, o, atStart, S) {
  const r = flowLines(b, o, atStart);
  if (!r.lines.length) return [];
  if (b.endnoteHead) {
    const id = S.heading();
    const text = r.lines.map((l) => l.text).join(' ');
    const e = blanks(el('h1', { cls: ['centered', 'endnote-heading'], attrs: ` id="${id}"`, inner: inline(text, S), kind: 'heading', level: 1, ids: [id] }), r);
    S.headings.push({ el: e, id, level: 1, label: plain(text) });
    return [e];
  }
  const run = flowRunover(b, o);
  return r.lines.map((l, i) => {
    const m = marginClass(S, l.indent, run);
    const e = el('p', { cls: ['transcriber-note', ...(m ? [m] : [])], inner: inline(l.text, S) });
    if (i === 0) e.bb = !!r.before;
    if (i === r.lines.length - 1) e.ba = !!r.after;
    return e;
  });
}

// ---- boxes (sidebars) ----
function box(b, o, S) {
  const kids = Array.isArray(b.blocks) ? b.blocks.filter((x) => x && typeof x === 'object') : [];
  const rawTitle = b.title != null ? String(b.title).trim()
    : (Array.isArray(b.titleSegments) ? b.titleSegments.map((s) => (s && typeof s.text === 'string' ? s.text : '')).join('').trim() : '');
  const dup = !!rawTitle && kids.some((c) => c.type === 'heading' && String(c.text ?? '').trim() === rawTitle);
  const content = (!rawTitle || dup) ? kids : [{ type: 'heading', level: 2, text: rawTitle, ...(Array.isArray(b.titleSegments) && b.titleSegments.length ? { segments: b.titleSegments, keepEmphasis: true } : {}) }, ...kids];
  const text = !kids.length && String(b.text ?? '').trim() ? [{ type: 'para', text: String(b.text) }] : [];
  const saved = S.box; S.box = true;
  let kidsEls;
  try { kidsEls = convertAll(content.length ? content : text, o, S); } finally { S.box = saved; }
  const inner = kidsEls.map(render).join('\n');
  if (!inner.trim()) return [];
  const e = el('aside', { cls: ['box'], inner: `\n${inner}\n`, ids: kidsEls.flatMap((k) => k.ids) });
  e.bb = true; e.ba = true;
  return [e];
}

// children of a box or list item, in the order given
function convertAll(blocks, o, S) {
  const seq = new Seq();
  let atStart = false;
  for (const b of blocks) {
    const els = convertBlock(b, o, atStart, S, seq);
    if (els.length) { seq.add(b, els, o); atStart = false; }
  }
  return seq.els;
}

// ---- tables ----
function table(b, o, S) {
  const headers = Array.isArray(b.headers) ? b.headers : [];
  const rows = (Array.isArray(b.rows) ? b.rows : []).map((r) => (Array.isArray(r) ? r : (r == null ? [] : [r])));
  const cols = Math.max(headers.length, ...rows.map((r) => r.length));
  if (!(cols > 0)) return [];
  // S3b #20 (Paul C1, 15 Oct 2026): a cell whose translation throws used to become '' - the table lost information and the package still said
  // it was complete. Now the cell holds a transcriber's-note marker (the style "equation could not be read" uses), the caller gets a warning, and
  // completeTranscription is false. Every cell is brailled once, here, so a failure is reported once.
  const cellTxt = (c, where, row, col) => {
    if (c == null) return '';
    try { return flowCell(c, o, b.dittoMarks); } catch (e) {
      S.untranslated(o, where, c, e, { row, col });   // row: 1-based among the body rows; undefined for a header
      return marker(o, CELL_NOTE);
    }
  };
  const headTxt = headers.map((h, i) => cellTxt(h, 'table header', undefined, i));
  const bodyTxt = rows.map((r, ri) => r.map((c, ci) => cellTxt(c, 'table cell', ri + 1, ci)));
  const cell = (t) => t.split('\n').map((x) => inline(x.trim(), S)).join('<br/>');   // a line break inside a cell stays a break
  let inner = '';
  const titles = (Array.isArray(b.title) ? b.title : [b.title]).map((t) => String(t ?? '').trim()).filter(Boolean);
  if (titles.length) inner += `<caption>${titles.map((t) => inline(flowSegs([{ type: 'text', text: t }], o), S)).join('<br/>')}</caption>`;
  const groups = (Array.isArray(b.headerGroups) ? b.headerGroups : [])
    .map((g) => ({ text: String(g && g.text || ''), from: Math.trunc(Number(g && g.from)), to: Math.trunc(Number(g && g.to)) }))
    .filter((g) => Number.isFinite(g.from) && Number.isFinite(g.to) && g.to >= g.from && g.text.trim());
  if (headTxt.some((t) => t) || groups.length) {
    inner += '<thead>';
    if (groups.length) {
      let row = '', c = 0;
      groups.sort((x, y) => x.from - y.from);
      for (const g of groups) {
        if (g.from > c) row += `<td colspan="${g.from - c}"></td>`;
        row += `<th scope="colgroup" colspan="${Math.min(cols - 1, g.to) - g.from + 1}">${inline(flowSegs([{ type: 'text', text: g.text }], o), S)}</th>`;
        c = Math.min(cols - 1, g.to) + 1;
      }
      if (c < cols) row += `<td colspan="${cols - c}"></td>`;
      inner += `<tr>${row}</tr>`;
    }
    inner += '<tr>' + Array.from({ length: cols }, (_, i) => `<th scope="col">${headers[i] != null ? cell(headTxt[i]) : ''}</th>`).join('') + '</tr></thead>';
  }
  inner += '<tbody>' + bodyTxt.map((r) => '<tr>' + Array.from({ length: cols }, (_, i) => `<td>${r[i] != null ? cell(r[i]) : ''}</td>`).join('') + '</tr>').join('') + '</tbody>';
  const out = [blanks(el('table', { inner }), { before: 1, after: 1 })];
  const tn = String(b.tabletn || b.note || '').trim();
  if (tn) {
    const t = FLOW_MARKS.tnOpen + flowSegs([{ type: 'text', text: tn }], o) + FLOW_MARKS.tnClose;
    out.push(el('p', { cls: ['transcriber-note'], inner: inline(t, S) }));
  }
  return out;
}

// ---- graphics ----
function graphic(b, o, atStart, S) {
  const svg = typeof b.svg === 'string' && b.svg.trim();
  if (svg) {
    const n = S.graphics.push(b);
    const tr = (t) => cells((o.translate ? o.translate(String(t)) : String(t)).trim());
    const alt = tr(b.alt || b.title || 'Tactile graphic') || tr('Tactile graphic');
    const cap = tr(b.title || b.alt || 'Tactile graphic');
    const e = el('figure', { cls: ['tactile-graphic'], inner: `<img src="../graphics/graphic-${n}.svg" alt="${esc(alt)}"/><figcaption>${esc(cap)}</figcaption>`, svg: true });
    e.bb = true; e.ba = true;
    return [e];
  }
  const r = flowLines(b, o, atStart);
  if (!r.lines.length) return [];
  const raster = Array.isArray(b.lines) && b.lines.length;
  // a tactile graphic drawn in braille dots keeps its rows; a described picture is a note
  // S3b #19: a raster's blank rows are part of the picture (they set its vertical geometry). The formatter records a blank row as the `gap`
  // of the row after it, and a trailing blank row as one of the blank lines after the block (the block's own closing blank line is the last
  // of them, and is the `ba` margin below). Each is put back as a row of blank cells. A described picture is a note, not a pattern: unchanged.
  const blankRow = () => `<p>${BLANK_CELL}</p>`;
  const inner = r.lines.map((l) => {
    const c = isCentred(l.indent) ? 'centered' : marginClass(S, l.indent, raster ? l.indent : 4);   // a described picture: 7-5 (BANA), 5-5 (UKAAF)
    return (raster ? blankRow().repeat(l.gap || 0) : '') + `<p${c ? ` class="${c}"` : ''}>${inline(l.text, S)}</p>`;
  }).join('') + (raster ? blankRow().repeat(Math.max(0, (r.after || 0) - 1)) : '');
  return [blanks(el('div', { cls: [raster ? 'tactile-raster' : 'image-note'], inner }), r)];
}

// ---- code ----
function code(b, o, atStart, S) {
  const r = flowLines(b, o, atStart);
  if (!r.lines.length) return [];
  // S3b #19: the blank lines of the code are the code's. The formatter takes them out of its page lines (formatCodeBlock / traceBlock skip a
  // blank source line), so the gaps flowLines records are 0 and the source text says where they were: its lines, in order, are the lines between the
  // passage indicator (first) and the terminator (last). A formatter that kept them would show as gaps, and those are used instead.
  const p = (l) => `<p>${esc(cells(' '.repeat(l.indent) + l.text, true))}</p>`;
  const blank = `<p>${BLANK_CELL}</p>`;
  const L = r.lines, body = L.slice(1, -1);
  const src = String(b.text ?? '').split('\n');
  let inner;
  if (L.length >= 3 && !L.some((l) => l.gap > 0) && body.length === src.filter((x) => x.trim()).length) {
    let k = 0;
    inner = p(L[0]) + src.map((x) => (x.trim() ? p(body[k++]) : blank)).join('') + p(L[L.length - 1]);
  } else {
    inner = L.map((l) => blank.repeat(l.gap || 0) + p(l)).join('');
  }
  return [blanks(el('div', { cls: ['code'], inner }), r)];
}

// ---- front matter pages ----
function titlePage(b, o, atStart, S) {
  const r = flowLines(b, o, atStart);
  if (!r.lines.length) return [];
  const inner = r.lines.map((l) => {
    const c = isCentred(l.indent) ? 'centered' : marginClass(S, l.indent, l.indent);
    return `<p${c ? ` class="${c}"` : ''}>${inline(l.text, S)}</p>`;
  }).join('');
  return [el('div', { cls: ['title-page'], inner })];
}
function specialPage(b, o, atStart, S) {
  const r = flowLines(b, o, atStart);
  if (!r.lines.length) return [];
  const [head, ...rest] = r.lines;
  const id = S.heading();
  const h = el('h1', { cls: ['centered'], attrs: ` id="${id}"`, inner: inline(head.text, S), kind: 'heading', level: 1, ids: [id], front: true });
  h.bb = !!r.before;
  S.headings.push({ el: h, id, level: 1, label: plain(head.text) });
  const run = b.type === 'sympage' ? 2 : 0;
  const ps = rest.map((l) => {
    const m = marginClass(S, l.indent, b.type === 'sympage' ? l.indent + run : 0);
    return el('p', { cls: [b.type === 'sympage' ? 'symbol' : 'transcriber-note-page', ...(m ? [m] : [])], inner: inline(l.text, S) });
  });
  return [h, ...ps];
}

// ---- state ----
class State {
  constructor(bana) {
    this.bana = bana; this.box = false; this.stanza = false;
    this.margins = new Map(); this.headings = []; this.pages = []; this.notes = new Map(); this.graphics = [];
    this._used = new Set(); this._h = 0;
    this.warnings = [];            // S3b #20: what could not be brailled and was replaced by a marker (returned as bytes.warnings)
  }
  // Something the translator refused: a warning for the caller. `c` is the print text (a string, or a cell object with text).
  untranslated(o, where, c, err, at = {}) {
    const text = String(typeof c === 'string' ? c : (c && (c.text ?? (Array.isArray(c.segments) ? c.segments.map((s) => s && s.text || '').join('') : ''))) || '').replace(/\s+/g, ' ').trim();
    const place = at.row != null ? ` (row ${at.row}, column ${at.col + 1})` : (at.col != null ? ` (column ${at.col + 1})` : '');
    const snippet = text.length > 40 ? text.slice(0, 40) + '...' : text;
    this.warnings.push({
      kind: 'ebraille-untranslated', where, row: at.row ?? null, col: at.col ?? null, snippet,
      message: `A ${where} could not be brailled${place}${snippet ? `: "${snippet}"` : ''}. A transcriber's note stands in its place in the eBraille file, and the file is not marked as a complete transcription.`,
      detail: String((err && err.message) || err || ''),
    });
  }
  heading() { return `h-${++this._h}`; }
  unique(id) { let n = id, k = 1; while (this._used.has(n)) n = `${id}-${++k}`; this._used.add(n); return n; }
}

// ---- cutting into content documents ----
const enc = new TextEncoder();
const bytes = (s) => enc.encode(s).length;

function cutSections(els, splitLevel) {
  const sections = [];
  let cur = { front: true, els: [] };
  sections.push(cur);
  for (const e of els) {
    if (e.kind === 'heading' && !e.front && (e.level === splitLevel || e.cls.has('endnote-heading'))) {   // the end-of-book notes are a section of their own
      cur = { front: false, els: [] };
      sections.push(cur);
    }
    cur.els.push(e);
  }
  return sections.filter((s) => s.els.length);
}
// Divide a section that has grown big. A heading or a print page break is where a part ends once it is past
// SPLIT_SOFT; once it is past SPLIT_HARD any block boundary will do (but never inside a list or a table, which
// are single elements).
function cutParts(els) {
  const parts = [];
  let cur = [], size = 0;
  for (let i = 0; i < els.length; i++) {
    const e = els[i];
    const cand = i > 0 && cur.length && (e.kind === 'heading' || e.kind === 'page');
    if (cur.length && ((size >= SPLIT_SOFT && cand) || size >= SPLIT_HARD)) { parts.push(cur); cur = []; size = 0; }
    cur.push(e); size += e._bytes;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

// ---- the style sheet ----
// Written for the layout the document was made for. Lengths are ch (a braille cell) and rem (a line), as the
// Styling Best Practices ask; no font properties (6.3.2), no media queries that single out braille or screens (6.3.3).
function stylesheet(bana, margins) {
  const lines = [];
  const L = (s = '') => lines.push(s);
  // WHY NO text-indent AND NO text-align. The DAISY eBraille checker (EBR-051) warns about every property whose name
  // begins with `text-` (and `font-`, and `color`) - not only the font ones the spec lists in 6.3.2 - so text-indent and
  // text-align, which the Styling Best Practices use, warn. Layout is done without them: a first-line indent or a hanging
  // indent is an empty inline-block at the start of the first line (::before) that is as wide as the indent, or that has
  // a negative left margin; a centred block is as wide as its text and has auto margins. A reading system that ignores
  // generated boxes shows the text flush left, which loses the indent and nothing else.
  const shift = (sel, d) => `${sel}::before { content: ""; display: inline-block; ${d >= 0 ? `width: ${d}ch; margin-left: 0;` : `width: 0; margin-left: ${d}ch;`} }`;
  L(`/* eBraille style sheet, ${bana ? 'BANA' : 'UKAAF'} layout - written by Emboss. Lengths are cells (ch) and lines (rem). */`);
  L('html, body, h1, h2, h3, h4, h5, h6, p, ul, ol, li, figure, figcaption, aside, div, table, caption, blockquote { margin: 0; padding: 0; }');
  L('body { line-height: 1rem; }');
  L('ul, ol { list-style: none; }');
  L('');
  L(`/* Paragraphs: ${bana ? 'BANA' : 'UKAAF'} 3-1 (first line at cell 3, runovers at cell 1) */`);
  L(shift('p', 2));
  L('');
  L(bana ? '/* Headings: centred level 1; cell-5 and cell-7 headings carry the margin class the transcription chose */' : '/* Headings: centred level 1; sub-headings start at cell 1 or 3 with runovers at cell 5 (classes below) */');
  L('h1, h2, h3, h4, h5, h6 { break-after: avoid; break-inside: avoid; }');
  L('.centered { width: fit-content; max-width: calc(100% - 6ch); margin-left: auto; margin-right: auto; }');
  L('.centered::before { display: none; }');
  L('');
  L('/* Margin classes: flush left, hanging (cell 1, runovers at cell 3) */');
  L('.left-aligned::before { display: none; }');
  L('.hanging { margin-left: 2ch; }');
  L(shift('.hanging', -2));
  L('');
  L('/* Lists: the marker is part of each item; runover lines hang under the text */');
  L('li { margin-left: 2ch; }');
  L(shift('li', -2));
  L('ul.poetry li.stanza { margin-top: 1rem; }');
  L('');
  L('/* Blank lines the transcription puts before and after a block (they collapse, as the blank lines do) */');
  L('.bb { margin-top: 1rem; }');
  L('.ba { margin-bottom: 1rem; }');
  L('');
  L('/* Boxes, tables, graphics, code, page breaks */');
  L('aside.box { break-inside: avoid-page; }');
  L('.code p { white-space: pre-wrap; margin-left: 2ch; }');
  L(shift('.code p', -2));
  L('.pagebreak { width: fit-content; margin-left: auto; }');
  L('table { border-collapse: collapse; }');
  L('th, td { vertical-align: top; padding-right: 2ch; }');
  if (margins.size) {
    L('');
    L('/* Margins the formatter chose block by block: mFIRST-RUNOVER = first line at that cell, runovers at that cell */');
    L('/* (a third number is the runover margin of the list item it sits inside) */');
    for (const [name, m] of [...margins].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))) {
      L(`.${name} { margin-left: ${m.runover - (m.parent || 0)}ch; }`);
      L(shift(`.${name}`, m.first - m.runover));
    }
  }
  return lines.join('\n') + '\n';
}

// ---- what the package says about itself (S3b #17, #18) ----

// A BCP 47 tag reduced to what eBraille's language wants: the language and the region (the script subtag is Brai, added by the writer).
// '' for anything that is not a language tag. de_DE -> de-DE, zh-Hans-CN -> zh-CN, en-Brai-US -> en-US.
function langTag(tag) {
  const p = String(tag ?? '').trim().replace(/_/g, '-').split('-').filter(Boolean);
  if (!p.length || !/^[A-Za-z]{2,3}$/.test(p[0])) return '';
  const region = p.slice(1).find((x) => /^(?:[A-Za-z]{2}|\d{3})$/.test(x));
  return region ? `${p[0].toLowerCase()}-${region.toUpperCase()}` : p[0].toLowerCase();
}

/**
 * The publication metadata, one precedence for Quick Mode and the editor (Paul's decision B1, 15 Oct 2026).
 *  creator    the model's own author/creator, then what an importer found: metadata.creator, .author, .docauthor, .docauthors[0]; else 'Unknown'
 *  language   the document's own (metadata.language / .lang, or doc.language / .lang), then the language of the selected braille code
 *             (opts.codeLanguage), and the browser's (opts.language, else navigator.language) only as the last fallback; 'en' if none.
 *             When the code and the browser speak the same language the browser's region is kept (UEB in an en-GB browser: en-Brai-GB).
 *  identifier / publisher   metadata.identifier (or .uid) / metadata.publisher where the document has them; else made from the content / ours.
 */
export function ebrailleMetadata(doc, opts = {}) {
  const m = (doc && typeof doc.metadata === 'object' && doc.metadata) || {};
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  const creator = text(doc?.author) || text(doc?.creator) || text(m.creator) || text(m.author) || text(m.docauthor)
    || text(Array.isArray(m.docauthors) ? m.docauthors[0] : '') || 'Unknown';
  const own = langTag(m.language) || langTag(m.lang) || langTag(doc?.language) || langTag(doc?.lang);
  const browser = langTag(opts.language) || langTag(typeof navigator !== 'undefined' ? navigator.language : '');
  const code = langTag(opts.codeLanguage);
  let language = own;
  if (!language) language = code ? ((!code.includes('-') && browser && browser.split('-')[0] === code) ? browser : code) : (browser || 'en');
  return { creator, language, identifier: text(m.identifier) || text(m.uid), publisher: text(m.publisher) };
}

/** The sentence a caller shows after an export whose `warnings` is not empty (S3b #20, Paul C1): what was replaced, and that the file says so. */
export function ebrailleWarningText(warnings, file) {
  const list = Array.isArray(warnings) ? warnings : [];
  const labels = list.filter((w) => w && w.where === 'label').length, cellsN = list.length - labels;
  const parts = [];
  if (cellsN) parts.push(`${cellsN} table cell${cellsN === 1 ? '' : 's'}`);
  if (labels) parts.push(`${labels} label${labels === 1 ? '' : 's'}`);
  return `Exported ${file}, but ${parts.join(' and ')} could not be brailled. A transcriber's note marks ${list.length === 1 ? 'its place' : 'each place'} in the file, and the file is marked as not a complete transcription.`;
}

// True if the model has an equation anywhere in it (a maths block, or maths in a paragraph, list item, table cell or box) that is not one Emboss
// already replaced by a note because it could not be read.
function hasMaths(node, seen = new WeakSet(), depth = 0) {
  if (!node || typeof node !== 'object' || depth > 200 || seen.has(node)) return false;
  seen.add(node);
  if (Array.isArray(node)) return node.some((x) => hasMaths(x, seen, depth + 1));
  if (node.type === 'math') {
    const src = typeof node.mathml === 'string' && node.mathml.trim() ? node.mathml : (typeof node.latex === 'string' ? node.latex.trim() : '');
    if (src && !/<(?:[\w.-]+:)?merror\b/.test(String(node.mathml ?? ''))) return true;
  }
  for (const k of Object.keys(node)) if (k !== 'resources' && k !== 'keys' && hasMaths(node[k], seen, depth + 1)) return true;
  return false;
}

// a11y:brailleSystem values: the system of the text (opts.brailleSystem, from the braille code in force; UEB grade 2 when the caller names none),
// and the maths code the document's equations were brailled in. The registry has "Nemeth no-grade math"; UEB maths is UEB technical, written
// uncontracted, so it is declared as "ueb grade1" (as Translate's writer does), once. Only declared when the maths was really brailled.
function ebrailleSystems(doc, fo, bana) {
  const systems = [fo.brailleSystem || 'ueb grade2'];
  if (typeof fo.mathToBrf === 'function' && hasMaths(doc && doc.blocks)) {
    const code = fo.mathCode === 'nemeth' || fo.mathCode === 'ueb' ? fo.mathCode : (bana ? 'nemeth' : 'ueb');
    const sys = code === 'nemeth' ? 'Nemeth no-grade math' : 'ueb grade1';
    if (!systems.includes(sys)) systems.push(sys);
  }
  return systems;
}

/**
 * Build a .ebrl (eBraille 1.0) from an Emboss document model.
 * @param {Object} doc  - Emboss document model ({ title, author?, blocks })
 * @param {Object} opts - the formatting options the preview used (mode, translate, ...) plus, optionally:
 *                        brailleSystem  a Braille Codes Registry value (web/braille-table.mjs registryName(settings))
 *                        brailleCode    the id of the braille code whose liblouis table list the text was made with (web/braille-table.mjs
 *                                       settingsForTable(table).brailleCode); written as sah:brailleCode, which Translate reads back. S5c / S3B-Q2
 *                        mathCode       'nemeth' | 'ueb': the maths code the equations were brailled in (default: by the layout standard)
 *                        codeLanguage   the language of the selected braille code (web/braille-table.mjs codeLanguage(settings))
 *                        language       the browser's language, BCP 47 WITHOUT the Brai subtag: the LAST fallback (ebrailleMetadata)
 *                        (width and depth are not used: the file has no fixed lines or pages)
 * @returns {Uint8Array} the packaged file - save it as .ebrl, application/epub+zip. Its `warnings` property lists what could not be brailled
 *                        and was replaced by a marker ([] when nothing); the package then says completeTranscription false.
 */
export function exportToEbraille(doc, opts = {}) {
  const title = doc?.title || 'Untitled Document';
  // NO SILENT DEFAULT TRANSLATOR - the rule the PEF exporter follows (#1) and the old exporter kept: a file that
  // "translated" by upper-casing would be print in braille clothing, and nobody would be told.
  if (typeof opts.translate !== 'function') {
    throw new Error('exportToEbraille: opts.translate must be the braille translate function used for the preview');
  }
  const fo = { ...opts };
  const bana = fo.standard === 'bana' || fo.mode === 'bana';
  // The SAME translator the pages went through, so a label is in the same code as the text it labels.
  const brl = (print) => {
    try { return cells(String(fo.translate(print) ?? '').trim()); } catch (e) {
      S.untranslated(fo, 'label', String(print), e);       // S3b #20: not an empty label in silence
      return cells(marker(fo, LABEL_NOTE));
    }
  };

  const S = new State(bana);
  const top = new Seq();
  let prevBi = -1;                     // the last block that produced content (the formatter's contentBlock tail)
  const sink = ({ bi, block, o, fb, atStart, blocks }) => {
    const els = convertBlock(fb, o, atStart, S, top);
    if (!els.length) return false;
    top.add(block, els, o, prevBi >= 0 ? { before: blocks[prevBi - 1], after: blocks[bi + 1] } : null);
    prevBi = bi;
    return true;
  };
  flowDocument(doc && typeof doc === 'object' ? doc : { blocks: [] }, fo, sink);
  const all = top.els;
  for (const e of all) { e._html = render(e); e._bytes = bytes(e._html); }

  // ---- sections ----
  const levels = new Set(all.filter((e) => e.kind === 'heading' && !e.front && !e.cls.has('endnote-heading')).map((e) => e.level));
  const splitLevel = levels.has(1) ? 1 : (levels.has(2) ? 2 : 0);
  const sections = splitLevel ? cutSections(all, splitLevel) : [{ front: false, els: all }];
  // Front matter that is nothing but print page markers (a book that opens with the page number of its cover) is not a
  // document: the markers go with the first section.
  if (sections.length > 1 && sections[0].front && sections[0].els.every((e) => e.kind === 'page')) {
    sections[1].els.unshift(...sections.shift().els);
  }
  const files = [];                      // { href, els, front }
  const bodySections = sections.filter((s) => !s.front);
  const pad = String(Math.max(1, bodySections.length)).length;
  let n = 0;
  for (const s of sections) {
    if (s.front) { files.push({ href: FRONT, els: s.els, front: true }); continue; }
    n++;
    const base = `content/section-${String(n).padStart(Math.max(2, pad), '0')}`;
    cutParts(s.els).forEach((part, pi) => files.push({ href: `${base}${pi ? `-${pi + 1}` : ''}.html`, els: part, front: false }));
  }
  if (!files.length) files.push({ href: 'content/section-01.html', els: [], front: false });

  // ---- where each id lives ----
  const where = new Map();
  files.forEach((f) => f.els.forEach((e) => { for (const id of e.ids) where.set(id, f.href); }));
  const locate = (id) => `${where.get(id)}#${id}`;     // from the entry page, which is in the root

  // ---- the contents, from the headings ----
  const heads = S.headings.filter((h) => h.label.trim() && where.has(h.id));
  const tree = [];
  const stack = [];
  for (const h of heads) {
    const node = { href: locate(h.id), label: h.label, level: h.level, children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    (stack.length ? stack[stack.length - 1].children : tree).push(node);
    stack.push(node);
  }
  const titleBraille = brl(title);
  const hasFront = files.some((f) => f.front);
  const toc = tree.length ? tree : [{ href: files[0].href, label: titleBraille || files[0].href, children: [] }];
  if (tree.length && hasFront && !toc[0].href.startsWith(FRONT)) toc.unshift({ href: FRONT, label: titleBraille || tree[0].label, children: [] });
  const stripLevel = (t) => ({ href: t.href, label: t.label, children: (t.children || []).map(stripLevel) });

  // ---- page list ----
  const pageList = S.pages.filter((p) => where.has(p.id) || p.el.ids.some((id) => where.has(id)))
    .map((p) => ({ href: locate(p.id), title: p.title, label: p.label }));

  // ---- the files ----
  const hrefFrom = (from, id) => {
    const to = where.get(id); if (!to) return null;
    return to === from ? `#${id}` : `${to.split('/').pop()}#${id}`;
  };
  const resolveNotes = (html, from) => html.replace(/<a role="doc-noteref" epub:type="noteref" href="@@NOTE:([^@]*)@@">([\s\S]*?)<\/a>/g, (m, ref, text) => {
    const id = S.notes.get(ref);
    const href = id && hrefFrom(from, id);
    return href ? `<a role="doc-noteref" epub:type="noteref" href="${href}">${text}</a>` : text;
  });
  const documents = files.map((f) => {
    const body = f.els.map((e) => '  ' + e._html).join('\n');
    return {
      href: f.href,
      body: resolveNotes(body, f.href),
      svg: f.els.some((e) => e.svg || /<img\b/.test(e.inner)),
      stylesheets: ['../' + CSS_HREF],
    };
  });
  const encode = (s) => enc.encode(s);
  const resources = [
    { href: CSS_HREF, mediaType: 'text/css', data: encode(stylesheet(bana, S.margins)) },
    ...S.graphics.map((g, gi) => ({ href: `graphics/graphic-${gi + 1}.svg`, mediaType: 'image/svg+xml', data: encode(String(g.svg)) })),
  ];
  const landmarks = hasFront && bodySections.length ? [{
    href: files.find((f) => !f.front).href, type: 'bodymatter', label: brl('Start of body matter') || titleBraille,
  }] : undefined;

  // What the package says it offers (schema.org accessibilityFeature, as the spec's own metadata example does). The page
  // numbers are declared here and NOT with a11y:pageBreakSource: the spec's example shows that property, but it is not in the
  // a11y vocabulary (§A.2 lists brailleCellType, brailleSystem, completeTranscription, producer, tactileGraphics,
  // minimumCells, minimumLines) and the DAISY checker rejects it (OPF-027).
  const features = ['readingOrder', 'tableOfContents', ...(heads.length ? ['structuralNavigation'] : []),
    ...(pageList.length ? ['printPageNumbers'] : []), ...(S.graphics.length ? ['alternativeText'] : [])];

  const meta = ebrailleMetadata(doc, opts);
  const pkg = packageEbraille({
    title,
    titleBraille,
    creator: meta.creator,
    producer: 'Sensory App House Ltd',
    ...(meta.publisher ? { publisher: meta.publisher } : {}),
    ...(meta.identifier ? { identifier: meta.identifier } : {}),
    language: meta.language,
    systems: ebrailleSystems(doc, fo, bana),
    ...(fo.brailleCode ? { brailleCode: String(fo.brailleCode) } : {}),   // S5c / S3B-Q2: the exact table (Translate's writer writes it as sah:brailleCode)
    completeTranscription: !S.warnings.length,       // S3b #20: not "complete" when something was replaced by a marker
    tactileGraphics: S.graphics.length ? 'SVG' : 'none',
    identitySeed: JSON.stringify([title, documents.map((d) => d.body)]),
    toc: toc.map(stripLevel),
    pageList: pageList.length ? pageList : undefined,
    pageListHeading: pageList.length ? brl('Page list') || titleBraille : undefined,
    accessibilityFeatures: features,
    landmarks,
    landmarksHeading: landmarks ? brl('Landmarks') || titleBraille : undefined,
    documents,
    resources,
  });
  pkg.warnings = S.warnings;                      // S3b #20: what could not be brailled (empty when nothing); the callers show it
  return pkg;
}
