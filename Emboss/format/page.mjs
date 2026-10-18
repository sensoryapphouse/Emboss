// Page assembly + BRF serialisation.
// Turns a flat list of formatted content lines into BRF pages with a running
// head / page-information line, then serialises to the exact BRF byte format.

const NUMDIGITS = 'ABCDEFGHIJ';                 // 1->A ... 9->I, 0->J

// Braille page number in ASCII braille, e.g. 1 -> "#A", 10 -> "#AJ".
function brailleNumber(n) {
  return '#' + String(n).split('').map((d) => NUMDIGITS[(Number(d) + 9) % 10]).join('');
}

// Braille page-number series (BANA Formats §2.2.1b, §2.7.1b; §2.1.1: transcriber-generated
// pages "are distinguished from the book's front matter by a unique set of braille page
// numbers"). The prefix is the braille letter, upper-case in BRF ASCII: "T" is braille t,
// "P" is braille p. Body pages carry no prefix.
//   transcriber  t1, t2 ...  Title Page, Second Title Page, Special Symbols, Transcriber's Notes
//   front        p1, p2 ...  print front matter (BANA 2.7.1b, 2.10.2f)
//   body         1, 2 ...    unchanged
const PAGE_SERIES = Object.freeze({ body: '', transcriber: 'T', front: 'P' });

// e.g. seriesPageNumber('transcriber', 1) -> "T#A"; seriesPageNumber('body', 1) -> "#A".
function seriesPageNumber(series, n) {
  if (!Object.prototype.hasOwnProperty.call(PAGE_SERIES, series)) throw new Error(`unknown page series: ${series}`);
  return PAGE_SERIES[series] + brailleNumber(n);
}

// BANA 1.11.7c: continuation letters run a..z, then double letters aa, bb, ... zz ("use double
// letters, aa, bb, etc., when the continuation page number goes beyond z"). Past zz the same
// doubling pattern is extended by analogy (aaa, bbb, ...): the rule text gives no example (Q-15).
function continuationPrefix(idx) {
  if (!(idx > 0)) return '';
  const letter = String.fromCharCode(65 + ((idx - 1) % 26));
  return letter.repeat(Math.floor((idx - 1) / 26) + 1);
}

function formatPrintPageHeader(basePrintPageBrl, continuationIndex) {
  if (!basePrintPageBrl) return '';
  if (continuationIndex <= 0) return basePrintPageBrl;
  const prefix = continuationPrefix(continuationIndex);
  return prefix + basePrintPageBrl;
}

function overlay(line, text, at) {
  return line.slice(0, at) + text + line.slice(at + text.length);
}

// Running head (page information line), UKAAF: braille page number top-right
// (R11, B004 §7); running-head title centred with capitals dropped (R10, B004 §6)
// from page 2 onward (page 1 shows the title in the body). Right-stripped.
// `printBrl` (optional, B004 §6/§7 good practice "Print page number top left"): the print page number
// at cell 1; the title is then only shown if it still clears it by 2 cells.
function runningHead(pageNum, titleBrl, width, printBrl = null) {
  // Page 1 carries only the page number: the UKAAF gold sample (corpus/ukaaf/sample1.brf)
  // has no title on its first page information line.
  const num = brailleNumber(pageNum);
  let line = ' '.repeat(width);
  // Centre the running-head title, but only if it fits with ≥2 cells of clearance
  // before the page number. An over-long title is OMITTED rather than overflowing
  // the line or overwriting the page number (which must stay locatable at the
  // right margin — braille readers find it by touch there).
  const pl = printBrl ? String(printBrl) : '';
  if (pageNum > 1 && titleBrl) {
    const offset = Math.floor((width - titleBrl.length) / 2);
    if (offset >= pl.length + (pl ? 2 : 0) && offset + titleBrl.length + 2 <= width - num.length) {
      line = overlay(line, titleBrl, offset);
    }
  }
  if (pl && pl.length + 2 <= width - num.length) line = overlay(line, pl, 0);
  line = overlay(line, num, width - num.length);
  return line.replace(/\s+$/, '');
}

// Running head (page information line), BANA (Formats 2016 §1.6 & §1.8):
// Print page number top-right on Line 1. Running head title centred with at least
// 3 cells of clearance before the print page number from page 2 onward.
// `titles` are the candidate forms in order of preference (Formats §1.8.2d follows print
// capitalization; §1.8.2e adjusts it when the title is too long). Page 1 carries the book
// title itself (§1.8.1: "Center the title on line 1"), with at least three blank cells
// before the print page number (§1.8.1d); a longer title continues in the body.
function banaRunningHead(printPageBrl, titles, width, pageNum, pageOneTitle = null) {
  let line = ' '.repeat(width);
  const pBrl = printPageBrl ? String(printPageBrl).trim() : '';
  if (pBrl) {
    line = overlay(line, pBrl, width - pBrl.length);
  }
  const rightLimit = pBrl ? (width - pBrl.length - 3) : width;
  const place = (t) => {
    let offset = Math.floor((width - t.length) / 2);
    if (offset + t.length > rightLimit) offset = rightLimit - t.length;   // keep the clearance, move left
    if (offset < 3 && pageNum === 1) offset = Math.min(3, rightLimit - t.length);
    if (offset < 0 || offset + t.length > rightLimit) return false;
    line = overlay(line, t, offset);
    return true;
  };
  if (pageNum === 1 && pageOneTitle) place(pageOneTitle);
  else if (pageNum > 1) for (const t of (Array.isArray(titles) ? titles : [titles]).filter(Boolean)) if (place(t)) break;
  return line.replace(/\s+$/, '');
}

// BANA 1.14.1c: the line that opens a spelled-out print page number: six cells of dots 36, then text.
const ALPHA_LEAD = 6;
const BANA_ALPHA_RE = /^-{6}[^-\s]/;
const UKAAF_PAGE_TURN_RE = /^\s*"3(\S+)\s*$/;
// UK-6 (28 Sep, James / decisions.md "UKAAF"): both end-marker forms document.mjs's indicatorLine()
// produces (the colons marker '"3' + ten '3's, the dot-2s marker '"3' + ten '1's) share the same
// '"3' + digits shape UKAAF_PAGE_TURN_RE reads as a print-page-turn indicator — a real page number is
// never a run of ten identical digits, so this tells the two apart. Without it, a document-end
// (docEndMarker) or after-table (tableEndMarker) marker — both on by default now — was mistaken for a
// genuine page-turn and its "page number" (3333333333 / 1111111111) shown in the running head.
// 1 Oct 2026: also a table's column separation line that runs unbroken ('"' + dots 25: the line under a two-tier heading group,
// BANA 11.4.2b/11.4.3, or a one-column table's) — its 3s were read as a print page number and shown top left in place of the
// running title. A real page number is translated (a numeric indicator and letters), never a run of 3s (colons) or 1s (commas),
// so any run of two or more is set aside; a lone "1" or "3" is still read (a test's untranslated page number)
// (tests/ukaaf_print_page_separator.test.mjs).
const IS_END_MARKER_DIGITS = /^(1{2,}|3{2,})$/;
const rightJustify = (text, width) => ' '.repeat(Math.max(0, width - text.length)) + text;

// BANA page change indicator (Formats 2016 §1.11.3, Example 1-9): "a line of
// unspaced dots 36 ... starting at the left margin and ending with the new page
// number at the right margin. There is no space between the page change
// indicator and the first symbol of the print page number", e.g.
// `-------------------------------------#bb`. Returns the page-number cells of
// such a line, or null. (A bare row of dots 36 with no number — §1.11.6a, an
// unnumbered print page change — is not a numbered indicator and returns null;
// nor is a spatial-table separator, which has spaces between its column rules.)
const BANA_PAGE_CHANGE_RE = /^-{3,}([^-\s]\S*)$/;
function banaPageChangeNumber(line) {
  if (typeof line !== 'string') return null;
  const m = BANA_PAGE_CHANGE_RE.exec(line.replace(/\s+$/, ''));
  return m ? m[1] : null;
}

// Running-head title forms, in order of preference (see assemble): UKAAF uses `titleBrl` (capitals dropped, B004 §6);
// BANA tries print capitalization, then lowercase, then the transcriber's key words (Formats §1.8.2d-e, F-61).
function banaTitleForms(opts = {}) {
  const titleBrl = opts.title && opts.translate ? opts.translate(String(opts.title).toLowerCase()).trim() : null;
  const kw = opts.title && opts.translate && typeof opts.runningHeadKeyWords === 'string' ? opts.runningHeadKeyWords.trim() : '';
  const banaTitles = opts.title && opts.translate ? [opts.translate(String(opts.title)).trim(), titleBrl, ...(kw ? [opts.translate(kw).trim(), opts.translate(kw.toLowerCase()).trim()] : [])] : [];
  return { titleBrl, banaTitles };
}

// Line 1 of a BANA braille page. A page change indicator that falls on the FIRST line of a braille page is not shown in
// the body: its number goes to the end of line 1 (Formats §1.11.2), and a spelled-out number straight after it joins it
// there when the page has no running head (§1.14.1c). Only that first line is lifted: a second indicator stacked under
// it takes a body line. assemble() and applyPageBoundaries (document.mjs, which plans the page breaks) both use this, so
// the lines the planner counts on a page are exactly the lines assemble puts there. `opts` are assemble's options.
//   top(lines, at, pageNum) -> { n: 0 | 1 | 2 lines lifted onto line 1, topNum, alpha }
//   showsTitle(printPageHeader, pageNum) -> whether line 1 carries a running-head title (not only the print page number)
function banaLineOne(opts = {}) {
  const width = opts.width ?? 38;
  const { banaTitles } = banaTitleForms(opts);
  const pageOneTitle = opts.pageOneTitle || null;
  const off = !!(opts.suppressHeader || opts.pageHeaders === false) || (opts.mode ?? 'ukaaf') !== 'bana';
  const none = { n: 0, topNum: null, alpha: null };
  return {
    titles: banaTitles,
    top(lines, at, pageNum) {
      if (off) return none;
      const topNum = banaPageChangeNumber(lines[at]);
      if (topNum === null) return none;
      const next = lines[at + 1] || '';
      if (BANA_ALPHA_RE.test(next) && banaRunningHead(null, banaTitles, width, pageNum, pageOneTitle) === '') {
        const alpha = next.slice(ALPHA_LEAD);
        if (alpha.length + 1 + topNum.length <= width - ALPHA_LEAD) return { n: 2, topNum, alpha };
      }
      return { n: 1, topNum, alpha: null };
    },
    showsTitle(printPageHeader, pageNum) {
      if (off) return false;
      return banaRunningHead(printPageHeader, banaTitles, width, pageNum, pageOneTitle) !== banaRunningHead(printPageHeader, [], width, pageNum, null);
    },
  };
}

// Rewrite the braille page number on an assembled page — BANA on the last line
// (Formats §1.15.1a), UKAAF at the end of the line-1 page information line
// (B004 §7) — leaving the rest of the page (running head, print page number,
// body) untouched. Used by volume splitting: "Begin the main text of each
// volume with braille page 1" (Formats §1.15.1d); "Braille page numbering must
// always start at 1 (for each volume)" (B004 §7). The new number is never longer
// than the old one (it is smaller), so the running-head clearance is preserved.
function renumberPage(page, fromNum, toNum, opts = {}) {
  const width = opts.width ?? 38;
  const mode = opts.mode ?? 'ukaaf';
  if (opts.suppressHeader || opts.pageHeaders === false || !page.length || fromNum === toNum) return page;
  const oldNum = brailleNumber(fromNum), newNum = brailleNumber(toNum);
  const at = mode === 'bana' ? page.length - 1 : 0;
  const line = page[at];
  if (typeof line !== 'string' || !line.endsWith(oldNum)) return page;
  const rest = line.slice(0, line.length - oldNum.length);
  const out = [...page];
  out[at] = overlay(rest.padEnd(width), newNum, width - newNum.length).replace(/\s+$/, '');
  return out;
}

// Give an assembled page a number in another series (BANA 2.2.1b: transcriber-generated pages carry
// t1, t2 ...; body pages after them are renumbered from 1). Same place as renumberPage (BANA line 25,
// UKAAF end of line 1), but the new number may be LONGER (a "T" prefix), so it is written right-aligned
// over whatever was there. `fromNum` is the number the page carries now, in `opts.fromSeries` (default
// 'body': what assemble() gave it).
function renumberPageSeries(page, fromNum, series, toNum, opts = {}) {
  const width = opts.width ?? 38;
  const mode = opts.mode ?? 'ukaaf';
  if (opts.suppressHeader || opts.pageHeaders === false || !page.length) return page;
  const oldNum = seriesPageNumber(opts.fromSeries ?? 'body', fromNum), newNum = seriesPageNumber(series, toNum);
  if (oldNum === newNum) return page;
  const at = mode === 'bana' ? page.length - 1 : 0;
  const line = page[at];
  if (typeof line !== 'string' || !line.endsWith(oldNum)) return page;
  const rest = line.slice(0, line.length - oldNum.length);
  const out = [...page];
  out[at] = overlay(rest.padEnd(width), newNum, width - newNum.length).replace(/\s+$/, '');
  return out;
}

// Content lines per page:
// UKAAF reserves line 1 for the running head/braille page number (depth - 1).
// BANA with print pages or running head reserves line 1 (header) AND line 25 (braille page) (depth - 2).
// BANA without print pages and without running head starts text on line 1 and reserves line 25 (depth - 1).
function linesPerPage(depth, hideHeader, mode = 'ukaaf', hasPrintPages = false, hasTitle = false) {
  const clampedDepth = Math.max(1, Math.min(Number.isFinite(depth) ? depth : 1, 1000));
  if (hideHeader) return clampedDepth;
  if (mode === 'bana') {
    return (hasPrintPages || hasTitle) ? Math.max(1, clampedDepth - 2) : Math.max(1, clampedDepth - 1);
  }
  return Math.max(1, clampedDepth - 1);
}

// Paginate content lines into pages.
//  UKAAF (R11, B004 §7, §8): braille page number top-right on line 1; centred print
//    page indicators in body; content fills lines 2..depth.
//  BANA (R11, Formats §1.6, §1.8, §1.15): print page number top-right on line 1 with
//    continuation prefixes (1, a1, b1...); braille page number bottom-right on line 25;
//    mid-page print page transitions have full-width leader lines; top-of-page transition
//    lines in body are suppressed.
function assemble(contentLines, opts = {}) {
  const width = opts.width ?? 38;
  const depth = opts.depth ?? 25;
  const mode = opts.mode ?? 'ukaaf';
  const hideHeader = opts.suppressHeader || opts.pageHeaders === false;
  // UKAAF (B004 §6): "Capitals may be omitted to maximise the use of space". BANA: print
  // capitalization, lowercase only when the capitalised form does not fit (Formats §1.8.2d-e).
  // F-61 / BANA 1.8.2e ("If a title is too long to use as the running head, either adjust capitalization or choose key words from the
  // title"): optional `opts.runningHeadKeyWords`, the transcriber's own choice of key words, is tried last (print case, then lowercase)
  // when neither form of the full title fits. Which words to choose stays the transcriber's judgement; without the field nothing changes.
  const lineOne = banaLineOne(opts);                         // line 1 of a BANA page: what is lifted there (shared with applyPageBoundaries)
  const { titleBrl } = banaTitleForms(opts);
  const banaTitles = lineOne.titles;

  const lines = [...contentLines];

  // Detect whether print page furniture is present in BANA mode
  const detectedPrintPages = opts.hasPrintPages || opts.initialPrintPageBrl != null || lines.some((l) => banaPageChangeNumber(l) !== null);
  const hasFurniture = detectedPrintPages || Boolean(titleBrl);
  const perPage = linesPerPage(depth, hideHeader, mode, detectedPrintPages, Boolean(titleBrl));

  const pages = [];
  // F-13 (BANA §11.3.2b): opts.lineNotes[i] = { id, text } on a nonblank line of a sequentially numbered table; on every braille page
  // after the first one the table occupies, its (already translated) "Table n (cont.)" is centred on the last line (line 25), beside the page number.
  const seenNoteIds = new Set();
  const noteFor = (from, to) => {
    if (!opts.lineNotes) return null;
    let found = null;
    const ids = [];
    for (let k = from; k < to; k++) { const nt = opts.lineNotes[k]; if (nt) { if (seenNoteIds.has(nt.id)) found = nt; ids.push(nt.id); } }
    for (const id of ids) seenNoteIds.add(id);
    return found;
  };
  const withNote = (foot, note, pageNum) => {
    if (!note) return foot;
    const num = brailleNumber(pageNum);
    const room = width - num.length - 3;                     // three blank cells before the braille page number
    if (note.text.length > room) return foot;
    const at = Math.max(0, Math.min(Math.floor((width - note.text.length) / 2), room - note.text.length));
    return overlay(' '.repeat(width), note.text, at).replace(/\s+$/, '').padEnd(width - num.length) + num;
  };
  // F-64 / BANA 1.15.1f ("Some agencies suppress the even braille page number in interpoint braille"): optional
  // `opts.interpointOmitEven` (BANA only, default off) leaves the number off every even braille page; only a table's
  // "(cont.)" note (F-13), if any, stays on that last line.
  const omitEven = !!opts.interpointOmitEven && mode === 'bana';
  const footFor = (pageNum, note) => {
    if (omitEven && pageNum % 2 === 0) {
      if (!note) return '';
      const at = Math.max(0, Math.floor((width - note.text.length) / 2));
      return overlay(' '.repeat(width), note.text, at).replace(/\s+$/, '');
    }
    return withNote(rightJustify(brailleNumber(pageNum), width), note, pageNum);
  };
  pages.alphaMerged = new Set();      // page indexes whose line 1 also carries a spelled-out print page number (BANA 1.14.1c)

  // For BANA mode: track print page state across braille pages
  let currentPrintPageBrl = opts.initialPrintPageBrl ?? null;
  let printPageStartBraillePage = 1;
  let ukPrintPageBrl = opts.initialPrintPageBrl ?? null;   // UKAAF, optional PIL print page number (B004 §6/§7)

  let lineIdx = 0;
  while (lineIdx < lines.length) {
    const pageNum = pages.length + 1;

    if (hideHeader) {
      const chunk = lines.slice(lineIdx, lineIdx + perPage);
      pages.push(chunk);
      lineIdx += perPage;
      continue;
    }

    if (mode === 'bana') {
      if (!hasFurniture) {
        // Plain BANA page without print pages or running head: text starts on line 1
        const chunk = lines.slice(lineIdx, lineIdx + perPage);
        const contNote = noteFor(lineIdx, lineIdx + chunk.length);
        while (chunk.length < perPage) chunk.push('');
        const footLine = footFor(pageNum, contNote);
        pages.push([...chunk, footLine]);
        lineIdx += perPage;
        continue;
      }

      let newPrintPageBrl = null;
      let newPrintPageMidPage = false;
      let alphaFirst = null;

      // 1. A page change indicator at the top of a braille page is suppressed in
      //    the body: the new print page number goes to the end of line 1 instead
      //    (Formats §1.11.2).
      //    Spelled-out number (BANA 1.14.1c) straight after the numeric indicator: line 1 when there is no
      //    running head (beside the numeric number), otherwise it stays as line 2 of the page body.
      const top = lineOne.top(lines, lineIdx, pageNum);
      if (top.n > 0) {
        currentPrintPageBrl = top.topNum;
        printPageStartBraillePage = pageNum;
        lineIdx += 1;
        alphaFirst = null;
        if (top.n === 2) { alphaFirst = top.alpha; pages.alphaMerged.add(pages.length); lineIdx += 1; }
      }

      const chunkFrom = lineIdx;
      const chunk = lines.slice(lineIdx, lineIdx + perPage);
      lineIdx += chunk.length;
      const contNote = noteFor(chunkFrom, lineIdx);

      // 2. Check remaining lines in chunk for mid-page transitions (Formats §1.11.3)
      for (let ci = 0; ci < chunk.length; ci++) {
        const midNum = banaPageChangeNumber(chunk[ci]);
        if (midNum !== null) {
          newPrintPageBrl = midNum;
          newPrintPageMidPage = true;
        }
      }

      // Compute continuation index
      const continuationIdx = currentPrintPageBrl ? (pageNum - printPageStartBraillePage) : 0;
      const printPageHeader = currentPrintPageBrl ? formatPrintPageHeader(currentPrintPageBrl, continuationIdx) : null;

      let headLine = banaRunningHead(printPageHeader, banaTitles, width, pageNum, opts.pageOneTitle || null);
      if (alphaFirst !== null) headLine = overlay(overlay(' '.repeat(width), '-'.repeat(ALPHA_LEAD) + alphaFirst, 0), printPageHeader, width - printPageHeader.length).replace(/\s+$/, '');

      // Pad chunk to perPage so footer lands on line depth
      while (chunk.length < perPage) chunk.push('');
      const footLine = footFor(pageNum, contNote);

      pages.push([headLine, ...chunk, footLine]);

      // If a new print page started mid-page on this braille page:
      if (newPrintPageBrl && newPrintPageMidPage) {
        currentPrintPageBrl = newPrintPageBrl;
        printPageStartBraillePage = pageNum;
      }
    } else {
      // UKAAF mode
      const chunk = lines.slice(lineIdx, lineIdx + perPage);
      // B004 §7 N.B.: "If a braille page carries material from print pages 61 and 62, then the print page
      // number shown is 62" — the last print page number in effect on the page (the §8 turn indicators
      // `"3` + number are the source).
      if (opts.pilPrintPage) for (const l of chunk) { const m = UKAAF_PAGE_TURN_RE.exec(l); if (m && !IS_END_MARKER_DIGITS.test(m[1])) ukPrintPageBrl = m[1]; }   // UK-6: skip end-marker lines, not a real page-turn
      pages.push([runningHead(pageNum, titleBrl, width, opts.pilPrintPage ? ukPrintPageBrl : null), ...chunk]);
      lineIdx += perPage;
    }
  }

  // Handle empty document: return at least 1 empty page with headers if headers enabled
  if (pages.length === 0) {
    if (hideHeader) {
      pages.push([]);
    } else if (mode === 'bana') {
      if (!hasFurniture) {
        const footLine = rightJustify(brailleNumber(1), width);
        const emptyChunk = Array(perPage).fill('');
        pages.push([...emptyChunk, footLine]);
      } else {
        const headLine = banaRunningHead(null, banaTitles, width, 1, opts.pageOneTitle || null);
        const footLine = rightJustify(brailleNumber(1), width);
        const emptyChunk = Array(perPage).fill('');
        pages.push([headLine, ...emptyChunk, footLine]);
      }
    } else {
      pages.push([runningHead(1, titleBrl, width, opts.pilPrintPage ? ukPrintPageBrl : null)]);
    }
  }

  return pages;
}

// Serialise to BRF: every line right-stripped + CRLF; pages separated by a bare
// form feed (0x0C); no trailing form feed.
function toBRF(pages) {
  return pages
    .map((page) => page.map((line) => line.replace(/\s+$/, '') + '\r\n').join(''))
    .join('\x0c');
}

export { banaLineOne, brailleNumber, PAGE_SERIES, seriesPageNumber, continuationPrefix, formatPrintPageHeader, runningHead, banaRunningHead, assemble, toBRF, linesPerPage, banaPageChangeNumber, renumberPage, renumberPageSeries };
