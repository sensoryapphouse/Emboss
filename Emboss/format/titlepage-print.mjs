// Title Page print copy (K29 Stage 1d, design docs/transcriber-pages-customisation-design.md §4/§5 row
// "1d Print copy"; addendum 2.3.1/2.3.6e; KD round-2 answer 5d, questions-register.md).
//
// "Print title page…" makes an ink-print HTML copy of the braille title page (same lines, current field
// values, both notices — they are already lines within the BANA template's Publisher segment, see
// titlePageTemplateSegments in field-registry.mjs) and, following KD's answer, ALSO the Special Symbols
// and Transcriber's Notes pages, each on its own printed page. In UKAAF (decisions.md UK-8/UK-9) there is
// no Special Symbols page; the title page is followed by its own accessible-copy notice page and by the
// "Note to Braille Edition" page instead.
//
// Pure and Node-testable (tests/titlepage_print_copy.test.mjs): buildTitlePagePrintPages(doc, o) takes a
// plain document model (the same shape buildModel()/editor.mjs's lastModel produce: {title, blocks, ...})
// and returns plain page data; titlePagePrintHtml(doc, o) wraps that in a standalone, styled HTML page.
// Nothing here touches window/document — the editor (web/editor/editor.mjs) is the only caller that opens
// a window and calls print() on it.
import { titlePageFieldsFrom, collectSpecialSymbols, symbolMeaning } from './document.mjs';
import { titlePageTemplateSegments, refreshTitlePageValues, ukAccessibleCopyStatement } from './field-registry.mjs';

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function findBlock(doc, type) {
  const blocks = doc && Array.isArray(doc.blocks) ? doc.blocks : [];
  return blocks.find((b) => b && typeof b === 'object' && b.type === type) || null;
}

// A titlePageTemplateSegments()-shaped array -> plain text lines, one per logical line, with one blank
// line between segments (2.3.3e "blank lines between segments, spread evenly" — the print copy does not
// share the braille page's fixed depth, so an even single blank line between segments is all a plain
// print rendering needs). A segment with no lines contributes nothing (matches $fillTitlePage/traceTitlePage,
// which both skip an empty segment too).
function segmentsToLines(segments) {
  const lines = [];
  for (const seg of Array.isArray(segments) ? segments : []) {
    if (!seg || !Array.isArray(seg.lines) || !seg.lines.length) continue;
    if (lines.length) lines.push('');
    for (const l of seg.lines) {
      const text = (l.parts || []).map((p) => (p && 'fld' in p ? (p.value || '') : (p && p.lit) || '')).join('');
      if (text.trim()) lines.push(text);
    }
  }
  return lines;
}

// A tnpage entry ({text} or {segments}, optionally with further {paragraphs}) -> plain text line(s). Good
// enough for a plain-print rendering of the Transcriber's Notes/Note to Braille Edition page — this is not
// trying to reproduce the braille layout (3-1 paragraphs, no TN indicators, 2.6.1b), just give a sighted
// reader the same words.
function segPlainText(seg) {
  if (!seg || typeof seg !== 'object') return '';
  if (typeof seg.text === 'string') return seg.text;
  if (seg.type === 'math') return seg.latex || '';
  return '';
}
function entryPlainText(e) {
  if (!e) return '';
  if (Array.isArray(e.segments)) return e.segments.map(segPlainText).join('');
  return String(e.text || '');
}
function tnEntryLines(entry) {
  const lines = [entryPlainText(entry)];
  for (const p of (entry && Array.isArray(entry.paragraphs)) ? entry.paragraphs : []) lines.push(entryPlainText(p));
  return lines.filter((l) => l && l.trim());
}

// Special Symbols page content, BANA only (UK-8: none in UKAAF). `symBlock.entries` is what an EDITED
// page saved (editor.mjs's $symNodeEntries); an untouched (`auto`) page has none stored on the model —
// the same collectSpecialSymbols/symbolMeaning pass document.mjs's resolveSymPages uses for the braille
// derives them here too, so the print copy always matches what the braille page would show.
function symbolsPageLines(doc, symBlock, o) {
  let entries = Array.isArray(symBlock.entries) ? symBlock.entries : [];
  if (symBlock.auto === true || !entries.length) {
    const derived = collectSpecialSymbols(Array.isArray(doc.blocks) ? doc.blocks : [], o || {});
    entries = derived.map((d) => ({ print: d.print, braille: d.braille, description: symbolMeaning(d) }));
  }
  return entries.map((e) => [e.print, e.description].filter((s) => String(s || '').trim()).join(' — ')).filter(Boolean);
}

/**
 * Build the print copy's pages as plain data: [{ id, heading, lines }]. `doc` is a document model (title,
 * blocks, ...); `o.mode` is 'bana' or 'ukaaf' (defaults to 'bana'); `o` is otherwise passed through to
 * collectSpecialSymbols exactly as document.mjs's own formatting pipeline would (e.g. o.exhaustiveSymbols,
 * K13). Returns an empty array when the document has no title page (nothing to print).
 */
export function buildTitlePagePrintPages(doc, o = {}) {
  const mode = o && o.mode === 'ukaaf' ? 'ukaaf' : 'bana';
  const d = doc && typeof doc === 'object' ? doc : {};
  const tpBlock = findBlock(d, 'titlepage');
  if (!tpBlock) return [];
  const fields = titlePageFieldsFrom(d);
  // TP-6 "fields stay live": an edited page's OWN segments (structure/wording), refreshed to the
  // document's current field VALUES — the same rule editor.mjs's syncTitlePages and document.mjs's
  // traceTitlePage already apply; an untouched (auto) page uses the template straight.
  const segments = Array.isArray(tpBlock.segments) ? refreshTitlePageValues(tpBlock.segments, fields, undefined)
    : titlePageTemplateSegments(fields, undefined, mode);
  const pages = [{ id: 'titlepage', heading: null, lines: segmentsToLines(segments) }];

  if (mode === 'bana') {
    const symBlock = findBlock(d, 'sympage');
    if (symBlock) {
      pages.push({ id: 'symbols', heading: symBlock.heading || 'Special Symbols Used in This Volume', lines: symbolsPageLines(d, symBlock, o) });
    }
    const tnBlock = findBlock(d, 'tnpage');
    if (tnBlock) {
      const lines = [];
      for (const e of Array.isArray(tnBlock.entries) ? tnBlock.entries : []) lines.push(...tnEntryLines(e));
      pages.push({ id: 'notes', heading: tnBlock.heading || 'Transcriber’s Notes', lines });
    }
  } else {
    // UK-8/UK-9: no Special Symbols page. The title page is followed by its own accessible-copy notice
    // page (assembleUkTitleNoticePage's braille counterpart) and by "Note to Braille Edition" (tnpage in
    // UKAAF mode) — KD's answer 5d, read for UKAAF via UK-8's own page substitution.
    const notice = String(fields.reproductionNotice || '').trim() || ukAccessibleCopyStatement({ title: fields.title, authors: fields.authors });
    pages.push({ id: 'notice', heading: null, lines: [notice] });
    const tnBlock = findBlock(d, 'tnpage');
    if (tnBlock) {
      const lines = [];
      for (const e of Array.isArray(tnBlock.entries) ? tnBlock.entries : []) lines.push(...tnEntryLines(e));
      pages.push({ id: 'notes', heading: tnBlock.heading || 'Note to Braille Edition', lines });
    }
  }
  return pages;
}

// A plain, readable print style (design §4: "a large serif or sans font, one page each, no app chrome"):
// serif for a book-like title page, one <section> per printed page with a page-break after each so the
// browser's print dialog paginates the same way. Every value is escaped (names/titles/notices all come
// from transcriber-typed or document-imported text).
export function titlePagePrintHtml(doc, o = {}) {
  const pages = buildTitlePagePrintPages(doc, o);
  const bookTitle = String((doc && doc.title) || (pages[0] && pages[0].lines && pages[0].lines[0]) || 'Title Page').trim();
  const pageHtml = pages.map((p) => {
    const heading = p.heading ? `<h1>${escapeHtml(p.heading)}</h1>` : '';
    const body = (p.lines || []).map((l) => `<p>${escapeHtml(l)}</p>`).join('\n      ');
    return `    <section class="print-page">\n      ${heading}\n      ${body}\n    </section>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(bookTitle)} — Title Page</title>
<style>
  @page { margin: 2cm; }
  html, body { background: #fff; }
  body { font-family: Georgia, 'Times New Roman', 'Liberation Serif', serif; font-size: 15pt; line-height: 1.6; color: #000; margin: 0; }
  .print-page { page-break-after: always; padding: 2cm 1.5cm; box-sizing: border-box; min-height: 90vh; }
  .print-page:last-of-type { page-break-after: auto; }
  h1 { text-align: center; font-size: 1.15em; text-transform: uppercase; letter-spacing: .05em; margin: 0 0 1.2em; }
  p { margin: 0 0 0.7em; white-space: pre-wrap; }
  @media screen { body { background: #e8e8e8; } .print-page { background: #fff; max-width: 42em; margin: 1.5cm auto; box-shadow: 0 1px 4px rgba(0,0,0,.25); } }
</style>
</head>
<body>
${pageHtml}
</body>
</html>
`;
}
