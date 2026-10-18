#!/usr/bin/env node
// Measures import fidelity: for every real-world sample in Emboss/tests/real_samples/,
// parses it (parseFile), exports it to DTBook (exportToNimasXml), and counts a fixed set
// of structural/inline features on both the SOURCE side (raw markup/XML, regex-counted)
// and the IMPORTED side (the parsed docModel, walked recursively), printing
// "source -> imported" per file, plus a per-format and overall summary.
//
// This turns the one-off G4 real-file-import survey into a reusable, regularly-runnable
// check (Paul's instruction, 23 Sep 2026) — see Emboss/docs/g4-real-file-import.md for the
// method this reproduces and the findings/fixes it measures. Written in the style of
// Emboss/scripts/measure-save-fidelity.mjs (before -> after counts, per-file + totals
// tables), but source counts here come from the ORIGINAL FILE (docx/odt zip parts, raw
// html/epub/md/rtf text), not from a DTBook XML round trip.
//
//   node Emboss/scripts/measure-import-fidelity.mjs [--file NAME.ext] [--json] [--dump-xml DIR]
//
// --dump-xml DIR additionally writes each sample's exported DTBook XML to DIR (named
// <format>__<basename>.xml) — handy for feeding straight into daisy-validate.mjs.
//
// Requires the system `unzip` binary (macOS/Linux both ship one) to read parts out of a
// .docx/.odt/.epub for the source-side count — parse.mjs's own zip reader is internal and
// unexported, and this script must not modify application code to reach it.
//
// Exit code: non-zero if any tracked feature goes from a non-zero SOURCE count to a ZERO
// IMPORTED count in any file — a total loss, the kind of regression this check exists to
// catch. A partial loss (count reduced but not to zero) is reported but does not fail the
// run — see "What this script does not measure" printed at the end for why totals-only
// gating was chosen, and what it can't see.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SAMPLES_DIR = path.join(ROOT, 'tests', 'real_samples');

const { parseFile } = await import('../input/parse.mjs');
const { exportToNimasXml } = await import('../input/nimas-export.mjs');

const argv = process.argv.slice(2);
function flag(name) { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; }
const ONLY_FILE = flag('--file');
const AS_JSON = argv.includes('--json');
const DUMP_XML_DIR = flag('--dump-xml'); // optional: also write each export's DTBook XML here, e.g. for daisy-validate.mjs

const BINARY_EXTS = new Set(['docx', 'odt', 'epub']);

// ---------------------------------------------------------------------------------------
// zip helpers (source-side counting only): shells out to the system `unzip`, the same way
// a human/agent would inspect a docx/odt/epub part by hand — parse.mjs's own zip reader
// (listZipEntries/extractZipEntry) is internal and not exported, and per this task's rules
// this script may not modify parse.mjs to export it.
// ---------------------------------------------------------------------------------------
function zipList(file) {
  try {
    const out = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\n').filter(Boolean);
  } catch { return []; }
}
function zipRead(file, entry) {
  try {
    return execFileSync('unzip', ['-p', file, entry], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch { return ''; }
}

function countRe(text, re) {
  if (!text) return 0;
  const m = String(text).match(re);
  return m ? m.length : 0;
}

// ---------------------------------------------------------------------------------------
// Tracked features. Not every feature applies to every format (e.g. RTF has no columnar
// table model in this corpus, HTML/EPUB in this corpus carry no footnotes) — a format that
// doesn't measure a feature reports `null` on the source side and that row is skipped for
// that file (both in the printed table and in the total-loss check).
// ---------------------------------------------------------------------------------------
const KEYS = ['headings', 'lists', 'listItems', 'tables', 'tableRows', 'tableCols', 'images',
  'captions', 'footnotes', 'footnoteRefs', 'links', 'internalLinks', 'bold', 'italic', 'underline',
  'quotations', 'verseLines', 'pagenums', 'code', 'cellRich'];

const LABELS = {
  headings: 'Headings (total)', lists: 'Lists', listItems: 'List items', tables: 'Tables',
  tableRows: 'Table rows', tableCols: 'Table columns', images: 'Images', captions: 'Captions',
  footnotes: 'Footnotes', footnoteRefs: 'Footnote references', links: 'Links (external)', internalLinks: 'Internal links (info)', bold: 'Bold runs',
  italic: 'Italic runs', underline: 'Underline runs', quotations: 'Quotations',
  verseLines: 'Verse lines', pagenums: 'Page numbers', code: 'Code blocks',
  cellRich: 'Rich table cells (info)',
};

function emptySourceCounts() {
  const c = {};
  for (const k of KEYS) c[k] = null;
  return c;
}

// =========================================================================================
// SOURCE-SIDE counters, one per format — raw markup/XML text, regex-counted.
// =========================================================================================

// DOCX source counts are taken the way the importer models the document (23 Sep sort of the
// remaining Word gaps — see Emboss/docs/g4-real-file-import.md), not as raw tag counts, so a
// difference is a REAL loss and not a counting artefact. Walked with a DOM over
// word/document.xml (+ footnotes.xml / endnotes.xml for emphasis and links, which the
// importer reads from those parts too). Rules, each one confirmed against the real corpus:
//  * a paragraph inside a table cell (w:tc) is skipped for headings/lists/links/emphasis: cell
//    content is kept as flat cell text (known gap D8), the same "cell content not counted on
//    either side" rule the imported side follows;
//  * a text box's paragraphs (w:txbxContent) count for headings/links/emphasis but not lists,
//    and the duplicate copy Word writes in <mc:Fallback> is skipped (the importer keeps only
//    the <mc:Choice> copy);
//  * an EMPTY paragraph is never a heading/list item/link (the importer drops it) — 51 of the
//    corpus's list-item tags and 8 of its heading-style paragraphs were empty;
//  * a list item is a numPr paragraph OR a ListParagraph-styled one (the importer's test);
//  * table rows/tables: a table with no text at all (a layout spacer) and a row with no text
//    are not counted (the importer drops them); the header row is a row, so the imported
//    side counts it too (see walkModel);
//  * links: EXTERNAL (r:id) hyperlinks are the gated `links` count; internal bookmark links
//    (w:anchor: a table-of-contents entry, a "see Table One" cross-reference) are reported
//    separately as `internalLinks` (information only) because keeping them is an undecided
//    question, not a fault — the importer deliberately gives them no href;
//  * bold/italic/underline: a "run" here is a maximal stretch of consecutive text-bearing
//    runs in one paragraph with the same effective (b,i,u) and the same hyperlink — what the
//    importer merges into one segment. Effective = direct toggle, else the run's own character
//    style (rStyle) resolved up its basedOn chain, except Word's hyperlink styles and a style
//    with a w:link partner (an auto-created "Heading 4 Char"), which the importer also ignores.
//    Bold that comes only from a PARAGRAPH style (a Heading, a notes style) is not counted:
//    the importer does not read it either (a transcriber's call, listed as a question).
function sourceCountDocx(filePath) {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
  const doc = zipRead(filePath, 'word/document.xml');
  const footnotesXml = zipRead(filePath, 'word/footnotes.xml');
  const endnotesXml = zipRead(filePath, 'word/endnotes.xml');
  const c = emptySourceCounts();
  const kid = (el, ln) => Array.from(el.childNodes || []).find((n) => n.nodeType === 1 && n.localName === ln);
  const anc = (el, test) => { for (let q = el.parentNode; q; q = q.parentNode) if (q.nodeType === 1 && test(q)) return q; return null; };
  const isW = (n, ln) => n.namespaceURI === W && n.localName === ln;
  const text = (el) => Array.from(el.getElementsByTagNameNS(W, 't')).map((t) => t.textContent).join('').trim();
  const inCell = (el) => !!anc(el, (q) => isW(q, 'tc'));
  const inFallback = (el) => !!anc(el, (q) => q.namespaceURI === MC && q.localName === 'Fallback');
  const inTxbx = (el) => !!anc(el, (q) => isW(q, 'txbxContent'));
  const nearestP = (el) => anc(el, (q) => isW(q, 'p'));

  // character styles (rStyle emphasis), mirroring parse.mjs's charStyleEmphasis
  const styles = new Map();
  {
    const sd = new DOMParser().parseFromString(zipRead(filePath, 'word/styles.xml') || '<x/>', 'text/xml');
    for (const st of Array.from(sd.getElementsByTagNameNS(W, 'style'))) {
      if (st.getAttributeNS(W, 'type') !== 'character') continue;
      const rPr = kid(st, 'rPr');
      const tog = (ln) => { const e = rPr && kid(rPr, ln); if (!e) return null; const v = e.getAttributeNS(W, 'val'); return v == null || (v !== 'false' && v !== '0' && v !== 'none'); };
      const id = st.getAttributeNS(W, 'styleId');
      styles.set(id.toLowerCase(), { id, basedOn: (kid(st, 'basedOn')?.getAttributeNS(W, 'val') || '').toLowerCase(), linked: !!kid(st, 'link'), b: tog('b'), i: tog('i'), u: tog('u') });
    }
  }
  const styleEmph = (id) => {
    let cur = (id || '').toLowerCase(); const out = { b: null, i: null, u: null }; const seen = new Set(); let first = true;
    while (cur && !seen.has(cur)) {
      seen.add(cur); const st = styles.get(cur); if (!st) break;
      if (/^(followed)?hyperlink$/i.test(st.id) || (first && st.linked)) return { b: false, i: false, u: false };
      first = false;
      for (const k of ['b', 'i', 'u']) if (out[k] === null && st[k] !== null) out[k] = st[k];
      cur = st.basedOn;
    }
    return out;
  };
  const runEff = (r) => {
    const rPr = kid(r, 'rPr'); const e = { b: false, i: false, u: false };
    if (!rPr) return e;
    const rs = kid(rPr, 'rStyle'); const sty = rs ? styleEmph(rs.getAttributeNS(W, 'val')) : { b: null, i: null, u: null };
    for (const k of ['b', 'i', 'u']) {
      const t = kid(rPr, k);
      if (t) { const v = t.getAttributeNS(W, 'val'); e[k] = v == null || (v !== 'false' && v !== '0' && v !== 'none'); }
      else e[k] = !!sty[k];
    }
    return e;
  };

  let headings = 0, listItems = 0, tables = 0, tableRows = 0, tableCols = 0, links = 0, internal = 0, bold = 0, italic = 0, underline = 0;
  const parsed = new DOMParser().parseFromString(doc, 'text/xml');
  for (const p of Array.from(parsed.getElementsByTagNameNS(W, 'p'))) {
    if (inCell(p) || inFallback(p)) continue;
    if (!text(p)) continue;
    const pPr = kid(p, 'pPr');
    const styleId = (pPr && kid(pPr, 'pStyle')?.getAttributeNS(W, 'val')) || '';
    if (/[Hh]eading|[Tt]itle|[Ss]ubtitle/.test(styleId)) headings++;
    if (!inTxbx(p) && ((pPr && kid(pPr, 'numPr')) || styleId.toLowerCase().includes('listparagraph'))) listItems++;
  }
  for (const tbl of Array.from(parsed.getElementsByTagNameNS(W, 'tbl'))) {
    if (inCell(tbl) || inFallback(tbl)) continue;             // top-level tables only (importer)
    if (!text(tbl)) continue;                                  // empty layout table: dropped
    tables++;
    tableCols += tbl.getElementsByTagNameNS(W, 'gridCol').length;
    tableRows += Array.from(tbl.getElementsByTagNameNS(W, 'tr')).filter((tr) => text(tr)).length;
  }
  c.headings = headings; c.listItems = listItems; c.tables = tables; c.tableRows = tableRows; c.tableCols = tableCols;
  c.images = countRe(doc, /<w:drawing[\s>]/g) + countRe(doc, /<w:pict[\s>]/g);
  // links + emphasis, over the body and both note parts
  for (const part of [doc, footnotesXml, endnotesXml]) {
    if (!part) continue;
    const d = part === doc ? parsed : new DOMParser().parseFromString(part, 'text/xml');
    for (const h of Array.from(d.getElementsByTagNameNS(W, 'hyperlink'))) {
      if (inCell(h) || inFallback(h) || !text(h)) continue;
      if (h.getAttributeNS(R, 'id')) links++; else internal++;
    }
    for (const p of Array.from(d.getElementsByTagNameNS(W, 'p'))) {
      if (inCell(p) || inFallback(p)) continue;
      let prevKey = null;
      for (const r of Array.from(p.getElementsByTagNameNS(W, 'r'))) {
        if (nearestP(r) !== p) continue;
        // a run carries text if it has any w:t content, even blank, or a tab/break (the importer
        // reads those as a space and gives that space the run's emphasis, so a bold tab is a segment)
        const hasText = Array.from(r.childNodes).some((n) => n.nodeType === 1 && n.namespaceURI === W && ((n.localName === 't' && n.textContent) || ['tab', 'br', 'cr', 'noBreakHyphen'].includes(n.localName)));
        if (!hasText) continue;
        const e = runEff(r);
        const hl = anc(r, (q) => isW(q, 'hyperlink'));
        const key = `${e.b ? 1 : 0}${e.i ? 1 : 0}${e.u ? 1 : 0}|${hl && hl.getAttributeNS(R, 'id') ? 'L' + Array.from(hl.parentNode.childNodes).indexOf(hl) : ''}`;
        if (key !== prevKey) { if (e.b) bold++; if (e.i) italic++; if (e.u) underline++; }
        prevKey = key;
      }
    }
  }
  c.links = links; c.internalLinks = internal;
  c.bold = bold; c.italic = italic; c.underline = underline;
  c.footnoteRefs = countRe(doc, /<w:footnoteReference[\s>]/g) + countRe(doc, /<w:endnoteReference[\s>]/g);
  c.footnotes = countDocxNoteDefs(footnotesXml, 'footnote') + countDocxNoteDefs(endnotesXml, 'endnote');
  return c;
}
function countDocxNoteDefs(xml, kind) {
  if (!xml) return 0;
  // A real content footnote/endnote has no w:type (or an ordinary one); Word also writes
  // w:type="separator"/"continuationSeparator"/"continuationNotice" housekeeping entries
  // (the "-----" divider, the "continued on next page" notice) into the same part, each
  // with its own <w:footnote>/<w:endnote> element — none of those are content, so an id>0
  // check alone (which only excludes separator id=-1 and continuationSeparator id=0) still
  // counts a continuationNotice (id=1 or higher) as if it were a real footnote.
  const re = new RegExp(`<w:${kind}\\b([^>]*)>`, 'g');
  let m, n = 0;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const idM = attrs.match(/w:id="(-?\d+)"/);
    if (!idM || Number(idM[1]) <= 0) continue;
    if (/w:type="(separator|continuationSeparator|continuationNotice)"/.test(attrs)) continue;
    n++;
  }
  return n;
}

function sourceCountOdt(filePath) {
  const content = zipRead(filePath, 'content.xml');
  const stylesXml = zipRead(filePath, 'styles.xml');
  const c = emptySourceCounts();
  const headingLevels = {};
  { const re = /<text:h\b[^>]*\btext:outline-level="(\d+)"/g; let m; while ((m = re.exec(content))) { const l = Number(m[1]); headingLevels[l] = (headingLevels[l] || 0) + 1; } }
  c.headings = Object.values(headingLevels).reduce((a, b) => a + b, 0) || countRe(content, /<text:h[\s>]/g);
  c._headingLevels = headingLevels;
  // A57: counted the way the importer models lists, not raw tag counts. parseOdtList folds a
  // list nested in a list item into its parent as flat items carrying `level`, and skips an
  // item with no text of its own (a wrapper around a nested list, or a blank paragraph). So:
  // lists = text:list with no text:list ancestor; items = text:list-item (any depth) with
  // non-blank text outside its own nested lists. Raw tags (505 lists / 1,028 items in
  // model-services-contract-core-terms.odt) were 354 nested lists + 396 empty wrapper/blank items.
  {
    const ODT_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
    const odoc = new DOMParser().parseFromString(content, 'text/xml');
    const ownText = (el) => { let t = ''; (function w(n) { for (const ch of n.childNodes || []) { if (ch.nodeType === 3) t += ch.nodeValue; else if (ch.nodeType === 1 && ch.localName !== 'list') w(ch); } })(el); return t.trim(); };
    const nestedInList = (el) => { for (let p = el.parentNode; p; p = p.parentNode) if (p.localName === 'list' && p.namespaceURI === ODT_TEXT) return true; return false; };
    c.lists = Array.from(odoc.getElementsByTagNameNS(ODT_TEXT, 'list')).filter((l) => !nestedInList(l)).length;
    c.listItems = Array.from(odoc.getElementsByTagNameNS(ODT_TEXT, 'list-item')).filter((i) => ownText(i)).length;
  }
  c.tables = countRe(content, /<table:table[\s>]/g);
  c.tableRows = countRe(content, /<table:table-row[\s>]/g);
  c.tableCols = countRe(content, /<table:table-column[\s>]/g);
  c.images = countRe(content, /<draw:image[\s>]/g);
  c.links = countRe(content, /<text:a[\s>]/g);
  c.footnotes = countRe(content, /<text:note[\s>]/g);
  c.footnoteRefs = c.footnotes; // one citation mark per note in this corpus
  const bi = odtBoldItalicUnderline(content, stylesXml);
  c.bold = bi.bold; c.italic = bi.italic; c.underline = bi.underline;
  return c;
}
// Resolves each <text:span text:style-name="…"> against the style's own
// fo:font-weight/fo:font-style/style:text-underline-style, walking style:parent-style-name
// across both content.xml's automatic styles and styles.xml's named styles — mirrors the
// method the original G4 survey used by hand (see g4-real-file-import.md's own note that a
// cruder "any style definition anywhere" pass gave misleading numbers).
function odtBoldItalicUnderline(content, stylesXml) {
  const styleMap = new Map();
  function ingest(xml) {
    if (!xml) return;
    // DOM walk (like parse.mjs's buildOdtStyleMap) so a self-closing <style:style .../>
    // is its own style with no properties, never swallowing the next style's body.
    const STYLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
    const FO_NS = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0';
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    for (const el of Array.from(doc.getElementsByTagNameNS(STYLE_NS, 'style'))) {
      const name = el.getAttributeNS(STYLE_NS, 'name');
      if (!name) continue;
      const parent = el.getAttributeNS(STYLE_NS, 'parent-style-name') || null;
      let bold = null, italic = null, underline = null;
      for (const child of Array.from(el.childNodes || [])) {
        if (child.nodeType !== 1 || child.localName !== 'text-properties') continue;
        const fw = child.getAttributeNS(FO_NS, 'font-weight');
        const fs = child.getAttributeNS(FO_NS, 'font-style');
        const us = child.getAttributeNS(STYLE_NS, 'text-underline-style');
        if (fw) bold = fw === 'bold';
        if (fs) italic = fs === 'italic';
        if (us) underline = us !== 'none';
      }
      styleMap.set(name, { bold, italic, underline, parent });
    }
  }
  ingest(stylesXml); ingest(content);
  function resolve(name, seen = new Set()) {
    if (!name || seen.has(name)) return { bold: false, italic: false, underline: false };
    seen.add(name);
    const s = styleMap.get(name);
    if (!s) return { bold: false, italic: false, underline: false };
    const p = s.parent ? resolve(s.parent, seen) : { bold: false, italic: false, underline: false };
    return {
      bold: s.bold !== null ? s.bold : p.bold,
      italic: s.italic !== null ? s.italic : p.italic,
      underline: s.underline !== null ? s.underline : p.underline,
    };
  }
  let bold = 0, italic = 0, underline = 0;
  const spanRe = /<text:span\s[^>]*text:style-name="([^"]*)"/g;
  let m;
  while ((m = spanRe.exec(content))) {
    const r = resolve(m[1]);
    if (r.bold) bold++;
    if (r.italic) italic++;
    if (r.underline) underline++;
  }
  return { bold, italic, underline };
}

// Finds the matching '}' for the '{' at `startIdx`, honouring RTF's own escaping (\{, \}, \\).
function rtfGroupEnd(text, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return text.length - 1;
}
// Removes every `{\keyword ...}` destination group (e.g. `{\stylesheet …}`) from an RTF
// string. Used to keep the stylesheet's own style DEFINITIONS (which restate every style's
// \outlinelevel/\b/\i once, regardless of whether the style is ever applied to a body
// paragraph) from being counted as if they were body content — the original G4 survey hit
// exactly this for patent-journal-special-notices-6946.rtf ("confirmed no body use of its
// one heading 5 style"): a naive \outlinelevel count over the whole file finds the
// stylesheet's own definition and misreports a real, expected zero-recovery as a loss.
function stripRtfGroup(text, keyword) {
  let out = text;
  const needle = '{\\' + keyword;
  let from = 0;
  while (true) {
    const idx = out.indexOf(needle, from);
    if (idx === -1) break;
    const end = rtfGroupEnd(out, idx);
    out = out.slice(0, idx) + out.slice(end + 1);
    from = idx;
  }
  return out;
}

function sourceCountRtf(text) {
  const c = emptySourceCounts();
  const body = stripRtfGroup(text, 'stylesheet');
  const headingLevels = {};
  { const re = /\\outlinelevel([0-8])(?!\d)/g; let m; while ((m = re.exec(body))) { const l = Number(m[1]) + 1; headingLevels[l] = (headingLevels[l] || 0) + 1; } }
  c.headings = Object.values(headingLevels).reduce((a, b) => a + b, 0);
  c._headingLevels = headingLevels;
  c.listItems = countRe(body, /\\(?:listtext|pntext)\b/g);
  c.tableRows = countRe(body, /\\trowd\b/g);
  c.tables = c.tableRows > 0 ? 1 : 0; // raw text can't reliably separate distinct tables — see limitations
  c.images = countRe(body, /\\pict\b/g);
  c.footnotes = countRe(body, /\{\\footnote\b/g);
  c.footnoteRefs = countRe(body, /\\chftn\b/g);
  c.links = countRe(body, /\bHYPERLINK\b/g);
  c.bold = countRe(body, /\\b(?![a-zA-Z0-9])/g);
  c.italic = countRe(body, /\\i(?![a-zA-Z0-9])/g);
  c.underline = countRe(body, /\\ul(?![a-zA-Z0-9])/g);
  return c;
}

// HTML/EPUB source counts. `input` is one document's text or an array of them (an EPUB's
// content documents). Counted the way the importer models the markup:
//  * links: external (scheme:) hrefs are the gated count; fragment/relative ones (a table of
//    contents, "back to top") are `internalLinks`, information only — whether to keep them is
//    an open question, not a fault. Links inside a table cell are skipped (cell content is
//    flat text, known gap D8) and so are emphasis/links inside <pre> (a <pre> is a code block:
//    plain text by design);
//  * bold/italic/underline: outermost element with text (a nested <i><i> is one run), outside
//    <td>/<th>/<pre>;
//  * verse lines: non-blank lines of a poem/verse paragraph (a blank line between stanzas is a
//    stanza break, not a line — the importer turns it into a line indicator);
//  * an EPUB navigation document (epub:type="toc" — the machine-readable contents list) is not
//    reading content and is not imported, so its <li>/<a> are not counted.
function sourceCountHtml(input) {
  const docs = (Array.isArray(input) ? input : [input]).filter((t) => !/epub:type="toc"|role="doc-toc"/.test(t));
  const text = docs.join('\n');
  const c = emptySourceCounts();
  const headingLevels = {};
  for (let l = 1; l <= 6; l++) headingLevels[l] = countRe(text, new RegExp(`<h${l}[\\s>]`, 'gi'));
  c.headings = Object.values(headingLevels).reduce((a, b) => a + b, 0);
  c._headingLevels = headingLevels;
  c.lists = countRe(text, /<ul[\s>]/gi) + countRe(text, /<ol[\s>]/gi);
  c.listItems = countRe(text, /<li[\s>]/gi);
  c.tables = countRe(text, /<table[\s>]/gi);
  c.tableRows = countRe(text, /<tr[\s>]/gi);
  c.tableCols = countRe(text, /<th[\s>]/gi);
  c.images = countRe(text, /<img[\s>]/gi);
  c.underline = 0; c.bold = 0; c.italic = 0; c.links = 0; c.internalLinks = 0;
  const has = (el, names) => { for (let q = el.parentNode; q; q = q.parentNode) if (q.nodeType === 1 && names.includes((q.localName || '').toLowerCase())) return true; return false; };
  for (const t of docs) {
    const d = new DOMParser({ onError() {} }).parseFromString(t, 'text/html');
    for (const a of Array.from(d.getElementsByTagName('a'))) {
      const href = a.getAttribute('href');
      if (!href) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href.trim())) { if (!has(a, ['td', 'th', 'pre'])) c.links++; }
      else c.internalLinks++;
    }
    const outer = (tags) => Array.from(d.getElementsByTagName('*')).filter((el) => tags.includes((el.localName || '').toLowerCase()) && el.textContent.trim() && !has(el, tags) && !has(el, ['td', 'th', 'pre'])).length;
    c.bold += outer(['b', 'strong']); c.italic += outer(['i', 'em']); c.underline += outer(['u']);
  }
  c.quotations = countRe(text, /<blockquote[\s>]/gi);
  let verseLines = 0;
  const poemRe = /<p[^>]*class="[^"]*(?:poem|verse)[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = poemRe.exec(text))) {
    for (const line of m[1].split(/<br\s*\/?>/i)) {
      if (line.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').trim()) verseLines++;
    }
  }
  c.verseLines = verseLines;
  return c;
}

// Blanks out fenced ``` code block BODIES (keeping line count/structure) before the prose
// regexes run, so a code sample's own underscores/asterisks/pipes/`>` (e.g. an info string
// like ```rust,does_not_compile, or a snake_case identifier) can't be mis-read as Markdown
// italic/bold/table/blockquote syntax. The fence markers themselves are also blanked; the
// `code` (block) count is taken from the raw, unstripped text instead.
function stripFencedCode(text) {
  let inFence = false;
  return text.split(/\r?\n/).map((line) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return ''; }
    return inFence ? '' : line;
  }).join('\n');
}

// Markdown source counts, the way the importer models the syntax:
//  * a table is a run of consecutive `| … |` lines whose SECOND line is the `|---|---|`
//    separator; the separator is not a row (it was: 15 "rows" for 13 real ones);
//  * a blockquote is a run of consecutive `>` lines, one quotation however long (24 quoted
//    lines in one Rust-book callout was "24 quotations");
//  * italic `_x_` follows the CommonMark flanking rule (not inside a word, not touching
//    whitespace on its inside) after inline `code` is blanked — snake_case identifiers and a
//    code span's underscores are not emphasis;
//  * `[text][ref]` and `[text](url)` are both links; an inline `<!-- comment -->` is not text.
function sourceCountMarkdown(text) {
  const c = emptySourceCounts();
  const prose = stripFencedCode(text).replace(/<!--[\s\S]*?-->/g, '');
  const lines = prose.split(/\r?\n/);
  // headings and list items are read with any leading `>` quote markers removed: the importer
  // now parses a blockquote's body as Markdown, so a `> ##### Title` or `> - item` inside a
  // callout is a heading / list item of the document
  const unquoted = lines.map((ln) => ln.replace(/^(?:\s*>)+ ?/, '')).join('\n');
  const headingLevels = {};
  { const re = /^(#{1,6})\s+\S/gm; let m; while ((m = re.exec(unquoted))) { const l = m[1].length; headingLevels[l] = (headingLevels[l] || 0) + 1; } }
  c.headings = Object.values(headingLevels).reduce((a, b) => a + b, 0);
  c._headingLevels = headingLevels;
  c.listItems = countRe(unquoted, /^[ \t]*[-*+][ \t]+\S/gm) + countRe(unquoted, /^[ \t]*\d+\.[ \t]+\S/gm);
  c.code = countRe(text, /^\s*```/gm) / 2;
  const SEP = /^\s*\|?\s*[: -]+(?:\s*\|\s*[: -]+)+\s*\|?\s*$/;
  const ROW = /^\s*\|.+\|\s*$/;
  let tables = 0, rows = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!ROW.test(lines[i]) || SEP.test(lines[i])) continue;
    if (i + 1 < lines.length && SEP.test(lines[i + 1])) {
      tables++;
      let j = i; rows++;
      while (j + 2 < lines.length && ROW.test(lines[j + 2]) && !SEP.test(lines[j + 2])) { rows++; j++; }
      i = j + 1;
    }
  }
  c.tables = tables; c.tableRows = rows;
  c.images = countRe(prose, /!\[[^\]]*\]\([^)]+\)/g);
  const noCode = prose.replace(/`[^`\n]*`/g, '');
  c.links = countRe(noCode, /(?<!!)\[[^\]]+\]\([^)]+\)/g) + countRe(noCode, /(?<!!)\[[^\]]+\]\[[^\]]*\]/g);
  c.internalLinks = 0;
  c.bold = countRe(noCode, /\*\*[^*\n]+\*\*/g);
  c.italic = countRe(noCode, /(?<![A-Za-z0-9_])_(?!\s)[^_\n]*?[^_\s]_(?![A-Za-z0-9_])/g) + countRe(noCode, /(?<!\*)\*(?![\s*])[^*\n]+?(?<![\s*])\*(?!\*)/g);
  let quotes = 0, inQ = false;
  for (const ln of lines) { const q = /^\s*>/.test(ln); if (q && !inQ) quotes++; inQ = q; }
  c.quotations = quotes;
  return c;
}

function epubXhtmlConcat(fullPath) {
  const entries = zipList(fullPath);
  const xhtmlEntries = entries.filter((e) => /\.(xhtml|html|htm)$/i.test(e));
  return xhtmlEntries.map((e) => zipRead(fullPath, e));
}

// =========================================================================================
// IMPORTED-SIDE counter: walks the parsed docModel recursively.
// =========================================================================================
// An href with no URL scheme (a "#chap01" fragment, a bare "chapter-2.xhtml#x" file path) points
// inside the document/package; http(s):, mailto: etc. point outside it.
function isInternalHref(h) { return !/^[a-z][a-z0-9+.-]*:/i.test(String(h).trim()); }

function walkModel(model, cellsInTotals = false) {
  const c = {}; for (const k of KEYS) c[k] = 0;
  const quoteGroups = new Set();
  const headingLevels = {};
  let titles = 0;

  function walkSegments(segments) {
    for (const s of segments || []) {
      if (!s) continue;
      if (s.type === 'noteref') c.footnoteRefs++;
      if (s.href) { c.links++; if (isInternalHref(s.href)) c.internalLinks++; }
      if (s.tf) {
        if (s.tf & 4) c.bold++;
        if (s.tf & 1) c.italic++;
        if (s.tf & 2) c.underline++;
      }
    }
  }
  function walkBlocks(blocks) {
    for (const b of blocks || []) {
      if (!b || !b.type) continue;
      switch (b.type) {
        case 'heading': {
          c.headings++;
          const lvl = b.level || 1;
          headingLevels[lvl] = (headingLevels[lvl] || 0) + 1;
          walkSegments(b.segments);
          break;
        }
        case 'title':
          // Folded into `headings` for the source comparison: the source-side regex for
          // DOCX/ODT/RTF deliberately matches style NAMES containing "title"/"subtitle" too
          // (real custom title styles, e.g. PHEFrontPageMainTitle), so a title-styled
          // paragraph is counted on the source side as a "heading-like" paragraph. Counting
          // it only under a separate, source-less `titles` bucket here would make a document
          // whose headings recovered perfectly (some as `heading`, some as `title` blocks)
          // look like a partial loss. `titles` is still tracked separately for the printed
          // breakdown.
          c.headings++;
          titles++;
          walkSegments(b.segments);
          break;
        case 'para':
          // one quotation per blockquote: a multi-paragraph quote's paragraphs share a
          // blockquoteId (the export wraps them in a single <blockquote>)
          if (b.style === 'quote' || b.style === 'blockquote') { if (b.blockquoteId != null) quoteGroups.add(b.blockquoteId); else c.quotations++; }
          walkSegments(b.segments);
          break;
        case 'note':
          // A bare `{type:'note'}` (no `kind`) is what Markdown's own blockquote handling
          // produces (parse.mjs's parseMarkdown, no dedicated blockquote block type) — the
          // content survives, just mapped to <prodnote> instead of <blockquote> (the same
          // kind of semantic mis-mapping D9 already named for pre-fix HTML). Counted as a
          // quotation here since the text is not lost. `kind: 'image'`/`kind: 'tabletn'`
          // notes are unrelated (image-alt placeholder / table transcriber note) and not
          // counted as quotations.
          if (!b.kind) c.quotations++;
          walkSegments(b.segments);
          break;
        case 'list':
          c.lists++;
          for (const item of b.items || []) {
            c.listItems++;
            if (item.segments) walkSegments(item.segments);
            if (Array.isArray(item.blocks)) walkBlocks(item.blocks);
            if (item.term != null || item.def != null) { /* glossary item: plain text only, no segments to walk beyond above */ }
          }
          break;
        case 'table': {
          c.tables++;
          // the importer keeps a table's header row in `headers`, not `rows`, and the source
          // counts every <tr>/w:tr/pipe row — so a non-empty header row is a row too
          const rows = (Array.isArray(b.rows) ? b.rows.length : 0) + (Array.isArray(b.headers) && b.headers.some(Boolean) ? 1 : 0);
          c.tableRows += rows;
          const cols = Array.isArray(b.headers) && b.headers.length
            ? b.headers.length
            : (Array.isArray(b.rows) && b.rows[0] ? b.rows[0].length : 0);
          c.tableCols += cols;
          if (b.title || b.caption) c.captions++;
          // D8: a cell that kept emphasis / links / notes / maths is a { text, segments } object.
          // Reported as information (no source-side count). ODT's source counts include cell
          // content, so for ODT the cell segments also go into the bold/italic/link/note totals;
          // the DOCX and HTML source counts exclude cells, so theirs stay out of the totals.
          for (const cell of [...(b.headers || []), ...(b.rows || []).flat()]) {
            if (!cell || typeof cell !== 'object' || !Array.isArray(cell.segments)) continue;
            if (cell.segments.some((g) => g.tf || g.href || g.type === 'noteref' || g.type === 'math')) c.cellRich++;
            if (cellsInTotals) walkSegments(cell.segments);
          }
          break;
        }
        case 'graphic':
          c.images++;
          if (b.caption) c.captions++;
          break;
        case 'footnote':
          c.footnotes++;
          if (Array.isArray(b.blocks)) walkBlocks(b.blocks);
          else if (b.segments) walkSegments(b.segments);
          break;
        case 'play':
          if (b.subtype === 'verse') c.verseLines++;
          walkSegments(b.segments);
          break;
        case 'pagenum':
          c.pagenums++;
          break;
        case 'code':
          c.code++;
          break;
        default:
          break;
      }
    }
  }
  walkBlocks(model && model.blocks);
  c.quotations += quoteGroups.size;
  return { counts: c, headingLevels, titles };
}

// =========================================================================================
// Driver
// =========================================================================================
function listSampleFiles() {
  const out = [];
  for (const sub of fs.readdirSync(SAMPLES_DIR)) {
    const full = path.join(SAMPLES_DIR, sub);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const f of fs.readdirSync(full)) out.push(path.join(sub, f));
  }
  return out.filter((f) => !ONLY_FILE || path.basename(f) === ONLY_FILE).sort();
}

async function measureFile(relPath) {
  const ext = path.extname(relPath).slice(1).toLowerCase();
  const fullPath = path.join(SAMPLES_DIR, relPath);
  const name = path.basename(relPath);
  const dataOrText = BINARY_EXTS.has(ext) ? fs.readFileSync(fullPath) : fs.readFileSync(fullPath, 'utf8');

  let model = null, xml = null, error = null;
  try {
    model = await parseFile(name, dataOrText);
    xml = exportToNimasXml(model);
  } catch (e) {
    error = e;
  }

  let src;
  if (ext === 'docx') src = sourceCountDocx(fullPath);
  else if (ext === 'odt') src = sourceCountOdt(fullPath);
  else if (ext === 'rtf') src = sourceCountRtf(dataOrText);
  else if (ext === 'html' || ext === 'htm') src = sourceCountHtml(dataOrText);
  else if (ext === 'epub') src = sourceCountHtml(epubXhtmlConcat(fullPath));
  else if (ext === 'md' || ext === 'markdown') src = sourceCountMarkdown(dataOrText);
  else src = emptySourceCounts();

  if (!error && DUMP_XML_DIR) {
    fs.mkdirSync(DUMP_XML_DIR, { recursive: true });
    const outName = `${ext}__${path.basename(relPath, path.extname(relPath))}.xml`;
    fs.writeFileSync(path.join(DUMP_XML_DIR, outName), xml, 'utf8');
  }

  const imported = error ? null : walkModel(model, ext === 'odt');
  // Formats whose source counter separates external from internal links: `links` is external
  // only on both sides, `internalLinks` is information (not gated).
  if (imported && ['docx', 'html', 'htm', 'epub'].includes(ext)) imported.counts.links -= imported.counts.internalLinks;
  else if (imported) imported.counts.internalLinks = 0;
  return { relPath, ext, error, src, imported, xmlLength: xml ? xml.length : 0 };
}

function fmt(n) { return n == null ? '—' : String(n); }

async function main() {
  if (!fs.existsSync(SAMPLES_DIR)) {
    console.error(`Samples directory not found: ${SAMPLES_DIR}`);
    process.exit(2);
  }
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch {
    console.error('The `unzip` command is required (for docx/odt/epub source counting) but was not found on PATH.');
    process.exit(2);
  }

  const files = listSampleFiles();
  if (!files.length) {
    console.error(ONLY_FILE ? `No sample matched --file ${ONLY_FILE}` : `No sample files found under ${SAMPLES_DIR}`);
    process.exit(2);
  }

  const results = [];
  for (const relPath of files) results.push(await measureFile(relPath));

  let anyTotalLoss = false;
  const lossDetails = [];

  // Totals: overall and per-format (by extension).
  const overallSrc = {}; const overallImp = {};
  const byFormatSrc = {}; const byFormatImp = {};
  for (const k of KEYS) { overallSrc[k] = 0; overallImp[k] = 0; }

  for (const r of results) {
    if (!byFormatSrc[r.ext]) { byFormatSrc[r.ext] = {}; byFormatImp[r.ext] = {}; for (const k of KEYS) { byFormatSrc[r.ext][k] = 0; byFormatImp[r.ext][k] = 0; } }
  }

  if (!AS_JSON) console.log('=== Import-fidelity element counts (source file -> imported docModel) ===\n');

  for (const r of results) {
    if (r.error) {
      if (!AS_JSON) console.log(`${r.relPath}: ERROR ${r.error.message}\n`);
      continue;
    }
    const rowFlags = [];
    if (!AS_JSON) console.log(r.relPath);
    for (const k of KEYS) {
      const s = r.src[k];
      const i = r.imported.counts[k];
      if (s == null && i === 0) continue; // not measured on either side for this file
      overallSrc[k] += (s || 0); overallImp[k] += i;
      byFormatSrc[r.ext][k] += (s || 0); byFormatImp[r.ext][k] += i;
      let flag = '';
      if (s != null) {
        if (s > 0 && i === 0 && k !== 'internalLinks') { flag = '  *** TOTAL LOSS ***'; anyTotalLoss = true; lossDetails.push(`${r.relPath}: ${LABELS[k]} ${s} -> 0`); }
        else if (i < s) flag = '  (partial loss)';
        else if (i > s) flag = '  (+)';
      }
      if (!AS_JSON) console.log(`  ${LABELS[k].padEnd(24)} ${fmt(s)} -> ${i}${flag}`);
      if (flag) rowFlags.push(k);
    }
    // heading level breakdown
    if (!AS_JSON) {
      const srcLevels = r.src._headingLevels || {};
      const impLevels = r.imported.headingLevels || {};
      const levelKeys = new Set([...Object.keys(srcLevels), ...Object.keys(impLevels)]);
      if (levelKeys.size) {
        const parts = [...levelKeys].map(Number).sort((a, b) => a - b)
          .map((l) => `h${l}: ${fmt(srcLevels[l] || (srcLevels[l] === 0 ? 0 : null))}->${impLevels[l] || 0}`);
        console.log(`  ${'Heading levels'.padEnd(24)} ${parts.join(', ')}`);
      }
      console.log(`  ${'  of which titles'.padEnd(24)} — -> ${r.imported.titles} (included in Headings total above)`);
      console.log('');
    }
  }

  if (!AS_JSON) {
    console.log('=== Totals by format ===\n');
    for (const ext of Object.keys(byFormatSrc).sort()) {
      console.log(`-- ${ext} --`);
      for (const k of KEYS) {
        const s = byFormatSrc[ext][k], i = byFormatImp[ext][k];
        if (s === 0 && i === 0) continue;
        console.log(`  ${LABELS[k].padEnd(24)} ${s} -> ${i}`);
      }
      console.log('');
    }

    console.log('=== Totals across all samples ===\n');
    for (const k of KEYS) {
      if (overallSrc[k] === 0 && overallImp[k] === 0) continue;
      console.log(`  ${LABELS[k].padEnd(24)} ${overallSrc[k]} -> ${overallImp[k]}`);
    }
    console.log('');

    if (anyTotalLoss) {
      console.log('RESULT: total losses found (source > 0, imported = 0):');
      for (const d of lossDetails) console.log(`  - ${d}`);
    } else {
      console.log('RESULT: no total losses (every feature that was present in the source recovered at least one instance).');
    }

    console.log('\n=== What this script does not measure ===');
    console.log([
      '- DOCX source heading counts are TOTALS only, not level-resolved (and count every',
      '  Heading/Title/Subtitle-NAMED style, including two the importer deliberately does not',
      '  promote — AnnexHeading and ContentsHeading — so 2 DOCX headings always read as missing): precise level',
      '  resolution needs styles.xml\'s own outline-level + basedOn chain walking, which',
      '  Emboss\'s own application code (A48) does — duplicating it here was out of scope for',
      '  a measurement script. RTF heading levels ARE broken down and level-accurate for a',
      '  DIRECT per-paragraph \\outlinelevelN override (the \\stylesheet group itself is',
      '  stripped before counting, so a defined-but-unused style is correctly 0, not a false',
      '  hit) — but a heading that relies ONLY on its style\'s own outline level, with no',
      '  direct per-paragraph override (confirmed real in the corpus: one stadia-report',
      '  heading), is invisible to this regex count and undercounts by that amount; the',
      '  imported side resolves the full style chain (mirroring A48) and is not affected.',
      '- RTF/Markdown "tables" source count is a 0/1 presence flag, not a distinct-table count',
      '  (raw text can\'t reliably tell two adjacent tables apart without a real parser).',
      '- Table CELL content: emphasis, links, note references and pictures inside a cell are now',
      '  imported (D8); ODT counts them in the totals (its source counts include cells), DOCX/HTML',
      '  do not (their source counts exclude cells) and show them only as "Rich table cells". Not',
      '  counted at all: lists, headings and nested structure inside a cell (known gap D8).',
      '- ODT/DOCX bold/italic/underline are resolved through the style parent-chain (ODT) or',
      '  run properties (DOCX), but a directly-applied AutoFormat / theme override outside the',
      '  named-style system would not be seen.',
      '- HTML/EPUB and Markdown footnotes, captions and page numbers are not measured (this',
      '  corpus has none in those formats).',
      '- Citations (<cite>) and nested/nested-list numbering correctness are not counted.',
      '- No end-to-end check that a surviving <graphic>/<img> reference points at real,',
      '  readable image bytes — daisy-validate.mjs --check-images does that separately.',
      '- DOCX image SOURCE counts (<w:drawing> + legacy <w:pict>) can be inflated for a picture',
      '  Word wrapped in <mc:AlternateContent>: a modern DrawingML <w:drawing> in <mc:Choice>',
      '  plus a VML <w:pict> fallback in <mc:Fallback> for the SAME picture both match, roughly',
      '  doubling that file\'s count (confirmed real in this corpus\'s own',
      '  template-framework-document-executive-agencies.docx: 6 raw tag matches, 3 actual',
      '  pictures per PROVENANCE.md) — not consistent across files (the other two DOCX corpus',
      '  files show no doubling), so treat a DOCX source image count as an upper bound too.',
      '- DOCX bold/italic/underline/link/heading/list SOURCE counts are model-aware (see the',
      '  comment on sourceCountDocx): table-cell content, empty paragraphs and the <mc:Fallback>',
      '  duplicate of a text box are excluded, a "run" is a merged stretch as the importer builds',
      '  segments. Not read on either side: bold that comes only from a PARAGRAPH style (a heading',
      '  or notes style), internal (bookmark) links — reported separately as information — and',
      '  anything in a table cell (known gap D8: cell text is kept, its lists/links/emphasis/',
      '  images/headings are not). A whitespace-only bold run counts on the imported side only,',
      '  so DOCX bold can read a couple higher imported than source.',
      '- HTML/EPUB emphasis and links inside <pre> and table cells are excluded from the source',
      '  count (a <pre> is imported as a plain code block; cells are flat text).',
      '- Markdown source counts follow the importer\'s own reading of the syntax (tables need a',
      '  separator row; a blockquote is one quotation; flanking-rule underscore emphasis), so they',
      '  confirm nothing was dropped rather than independently test the syntax rules.',
    ].join('\n'));
  } else {
    console.log(JSON.stringify({ results: results.map((r) => ({ relPath: r.relPath, ext: r.ext, error: r.error ? r.error.message : null, src: r.src, importedCounts: r.imported ? r.imported.counts : null, headingLevels: r.imported ? r.imported.headingLevels : null, titles: r.imported ? r.imported.titles : null })), overallSrc, overallImp, byFormatSrc, byFormatImp, anyTotalLoss, lossDetails }, null, 2));
  }

  process.exit(anyTotalLoss ? 1 : 0);
}

main();
