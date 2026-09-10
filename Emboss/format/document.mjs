// Document formatter: a structured document model -> content lines -> BRF.
// Block layout follows the Rule Register (SETUP_AND_VALIDATION.md), switchable
// by mode ('ukaaf' | 'bana'). Paragraph wrapping and page assembly are the
// gold-validated primitives from layout.js / page.js.
import { formatParagraph, wrapCells, wrapCellsSrc } from './layout.mjs';
import { assemble, toBRF, brailleNumber, linesPerPage } from './page.mjs';
import { unicodeBrailleToBrf, BRF64 } from '../engine/brf-ascii.mjs';
import { STYLE_DEFINITIONS, getStyleMargins, isListStyle, resolveStyleFromXml } from './styles.mjs';

export { STYLE_DEFINITIONS, getStyleMargins, isListStyle, resolveStyleFromXml };

const rightJustify = (text, width) => ' '.repeat(Math.max(0, width - text.length)) + text;

// BRF indicators concatenated AFTER translation (never fed to the print translator):
// UEB transcriber's note @.< … @.> (dots 4,46,126 / 4,46,345; UEB §3.27, used by
// both B004 and Formats §3.2); grade-1 passage ;;; … ;' and grade-1 word ;; (UEB §5).
const TN_OPEN = '@.<', TN_CLOSE = '@.>';
const G1_PASSAGE_OPEN = ';;;', G1_TERMINATOR = ";'", G1_WORD = ';;';
// Any string that must land in the BRF as cells: Unicode braille is mapped to BRF
// ASCII (dots 7/8 masked) and anything else outside the 64-cell set becomes a blank.
const BRF_CHARS = new Set(BRF64);
const toBrfCells = (str) => unicodeBrailleToBrf(String(str ?? '')).split('').map((c) => (BRF_CHARS.has(c) ? c : ' ')).join('');

const centred = (text, width) =>
  ' '.repeat(Math.max(0, Math.floor((width - text.length) / 2))) + text;

// Centre a (possibly multi-line) block of text, wrapping first if it's wider
// than the page. Verified against corpus/ukaaf/sample3.brf: a headline/title
// longer than the geometry width is greedily word-wrapped (no indent) and
// EACH resulting line is centred independently, not left-blocked as a
// paragraph — see gold lines "SWITCHING TO CLEAN ENERGY WILL STOP GREAT /
// BARRIER REEF DESTRUCTION FROM GLOBAL WARMING, / SAYS WWF" (3 lines, each
// centred on its own). Also applies to a BANA/UKAAF centred (L1) heading,
// which uses the same centred-block presentation (B004 §5 / Formats §4.4).
function centredBlock(text, width, wrapWidth = width) {
  return wrapCells(text, wrapWidth, 0, 0).map((line) => centred(line.trim(), width));
}

// Indicator / break lines (B004 Glossary, R17: "An indicator line (or end
// marker) is a line which can be placed after a section is complete"). Three
// forms: a colons end marker (line indicator dot5,dots25 + 10 colons), a
// dot-2s end marker (same line indicator + 10 dot-2 signs), or 3 spaced
// centred asterisks ("usually a break in text" — no line-indicator prefix).
// Gold-verified (corpus/ukaaf/sample4.brf, the joke breaks): the asterisk
// form is the BRF-ASCII asterisk sign ("9) x3, single-space separated, then
// centred as a block — e.g. "               "9 "9 "9" at 38 cells.
const indicatorLine = (kind, width) => {
  if (kind === 'asterisks') return centred('"9 "9 "9', width).replace(/\s+$/, '');
  return centred('"3' + (kind === 'colons' ? '3' : '1').repeat(10), width).replace(/\s+$/, '');
};

// Heading formatter. levels 1..3.
//  UKAAF (B004 §5, R4-R7): L1 centred (preceded by an indicator line);
//    L2 cell 1 / runover cell 5; L3 cell 3 / runover cell 5; blank line before L2/L3.
//  BANA (Formats §4.4-4.6, R4-R6): centred (blank before+after); cell-5; cell-7.
function formatHeading(block, o, atStart) {
  const t = block.segments ? segmentsToBraille(block.segments, o) : o.translate(block.text ?? '');
  const w = o.width;
  const L = block.level || 1;
  const out = [];
  if (o.mode === 'bana') {
    if (L === 1) { out.push('', ...centredBlock(t, w, Math.max(1, w - 6)), ''); }     // §4.4.1; §4.4.2 >=3 blank cells each side
    else if (L === 2) { out.push('', ...wrapCells(t, w, 4, 4)); } // cell-5 (§4.5)
    else { out.push('', ...wrapCells(t, w, 6, 6)); }             // cell-7 (§4.6)
  } else {
    // §5: an L1 heading is centred and preceded by an indicator line. The indicator is an
    // "end marker … placed after a section is complete" (B004 R17), so there is nothing for
    // it to close at the very top of a document — emit the heading alone (and no leading
    // blank line) when it opens the document.
    if (L === 1) {
      if (atStart) out.push(...centredBlock(t, w));
      else out.push('', indicatorLine('dot2s', w), ...centredBlock(t, w));
    } else if (L === 2) { out.push('', ...wrapCells(t, w, 0, 4)); } // cell 1 / runover 5
    else { out.push('', ...wrapCells(t, w, 2, 4)); }             // cell 3 / runover 5
  }
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Centred title used once at the top of a document (B004 §5 / Formats §2.10).
// Wrapped + each line centred independently if longer than the page width
// (see centredBlock; gold-verified against sample3's multi-line headline).
function formatTitle(block, o) {
  return centredBlock(o.translate(block.text ?? ''), o.width).map((l) => l.replace(/\s+$/, ''));
}

// List (B004 §10, R2/R3). Two standard house styles, chosen by o.listStyle:
//   'spaced' (default, B004 Ex1): blank line before & after; entry cell 1,
//       runover cell 3 (1-3); print marker kept in cell 1; nested +2/+2 per level.
//   'compact'  (B004 Ex2): entry cell 5, runover cell 1 (5-1); print markers
//       ignored; no blank lines; nested further indents cell 7, 9 (5/1, 7/1, 9/1).
function formatList(block, o) {
  const items = block.items ?? [];
  if (!items.length) return [];
  const compact = o.listStyle === 'compact';
  const kind = block.kind;
  const out = compact ? [] : [''];                     // Ex1 has a blank line before
  for (const item of items) {
    if (!item) continue;
    const lvl = item.level || 0;
    let first = 0;
    let runover = 2;
    if (kind === 'exercise') {
      first = lvl === 0 ? 0 : 2 + (lvl - 1) * 2;
      runover = 4 + (lvl > 1 ? (lvl - 1) * 2 : 0);
    } else if (kind === 'index' || kind === 'toc') {
      first = lvl === 0 ? 0 : 2 + (lvl - 1) * 2;
      runover = 2 + lvl * 2;
    } else {
      first = compact ? 4 + lvl * 2 : lvl * 2;     // Ex2: cell 5+; Ex1: cell 1,3,5…
      runover = compact ? 0 : first + 2;           // Ex2: cell 1; Ex1: first+2
    }
    if (kind === 'toc' && item.page) {
      const transTitle = item.segments
        ? segmentsToBraille(item.segments, o)
        : o.translate(item.title ?? item.text ?? '').trim();
      const transPage = o.translate(item.page).trim();
      const w = o.width || 38;
      const titleWidth = Math.min(w, Math.max(first + 4, runover + 4, w - transPage.length - 2));   // never wider than the page
      const wrappedTitle = wrapCells(transTitle, titleWidth, first, runover);
      const lastLine = wrappedTitle[wrappedTitle.length - 1] || '';
      const neededLeaders = w - lastLine.length - transPage.length;

      if (neededLeaders >= 2) {
        const spaceCount = Math.max(0, Math.min(1, neededLeaders - 2));
        const dotCount = Math.max(1, neededLeaders - spaceCount);
        const leaders = ' '.repeat(spaceCount) + '"'.repeat(dotCount);
        wrappedTitle[wrappedTitle.length - 1] = lastLine + leaders + transPage;
        out.push(...wrappedTitle);
      } else {
        const room = w - runover - transPage.length;               // cells left for guide dots
        if (room >= 2) wrappedTitle.push(' '.repeat(runover) + '"'.repeat(room) + transPage);
        else wrappedTitle.push(...wrapCells(transPage, w, runover, runover));   // number too wide: wrap it, never overflow
        out.push(...wrappedTitle);
      }
      continue;
    }

    const marker = compact ? '' : (item.marker ? item.marker + ' ' : '');  // Ex2 ignores markers
    const body = item.segments                                             // list item with inline maths
      ? (marker ? o.translate(marker).trim() + ' ' : '') + segmentsToBraille(item.segments, o)
      : o.translate(marker + (item.text ?? ''));
    out.push(...wrapCells(body, o.width, first, runover));
  }
  if (!compact) out.push('');                          // Ex1 has a blank line after
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Paragraph (R1): 3-1, no blank line between paragraphs (default 'indented').
// Or 1-1 with blank line between paragraphs ('block').
function formatPara(block, o) {
  if (block.segments) return formatSegmentedPara(block.segments, o);
  const text = block.text ?? '';
  if (!text.trim()) return [];                          // empty paragraph -> no lines
  const isBlock = o.paragraphStyle === 'block';
  const first = isBlock ? 0 : 2;
  const lines = formatParagraph(text, o.translate, { width: o.width, first, runover: 0 });
  if (isBlock) lines.push('');
  return lines;
}

// Render a mixed run of text/math segments into one braille string (no wrapping).
// Shared by paragraphs, list items and headings that contain inline maths.
function segmentsToBraille(segments, o) {
  let braille = '';
  for (const seg of segments) {
    if (!seg) continue;
    if (seg.type === 'math') {
      if (!o.mathToBrf) continue;
      try { const brf = o.mathToBrf(seg); if (brf) braille += brf; }
      catch (e) { if (typeof console !== 'undefined') console.warn('[maths] inline equation skipped:', (e && e.message) || e); }
    } else {
      const t = String(seg.text ?? '').replace(/[^\S\n]+/g, ' ');    // collapse horizontal space runs; keep \n
      if (!t) continue;
      const translateRun = (str, tf, isUncontracted) => {
        if (isUncontracted) {
          // Uncontracted (grade 1) run inside grade-2 text: translate with the G1 table
          // when the caller supplies one, then mark it with the UEB grade-1 word
          // indicator (single word) or passage indicator + terminator (UEB §5.4-5.5).
          const g1 = o.translateG1 || o.translateUncontracted;
          const tr = g1 ? g1(str) : (tf ? o.translate(str, Array(str.length).fill(tf)) : o.translate(str));
          return str.includes(' ') ? `${G1_PASSAGE_OPEN}${tr}${G1_TERMINATOR}` : `${G1_WORD}${tr}`;
        }
        return tf ? o.translate(str, Array(str.length).fill(tf)) : o.translate(str);
      };

      if (t.includes('\n')) {
        const transLines = t.split('\n').map((l) => {
          if (!l) return '';
          return translateRun(l, seg.tf, seg.uncontracted);
        });
        braille += transLines.join('\n');
      } else {
        braille += translateRun(t, seg.tf, seg.uncontracted);
      }
    }
  }
  return braille.replace(/^[^\S\n]+|[^\S\n]+$/g, '');          // trim boundary spaces, keep newlines
}

function formatSegmentedPara(segments, o) {
  const braille = segmentsToBraille(segments, o);
  if (!braille) return [];
  const isBlock = o.paragraphStyle === 'block';
  const first = isBlock ? 0 : 2;
  const lines = wrapCells(braille, o.width, first, 0);
  if (isBlock) lines.push('');
  return lines;
}

// Transcriber Note formatting (UKAAF / BANA)
function formatTranscriberNote(block, o) {
  const text = String(block.text ?? '');
  if (!text.trim()) return [];
  const w = o.width || 38;
  const formatted = TN_OPEN + o.translate(text).trim() + TN_CLOSE;   // indicators are BRF, added after translation
  return wrapCells(formatted, w, 0, 2).map((l) => l.replace(/\s+$/, ''));
}

// Footnote / Endnote formatting per BANA Formats §12 (1-3 margin: first cell 1, runover cell 3)
function formatFootnote(block, o) {
  const w = o.width || 38;
  const out = [''];
  if (Array.isArray(block.blocks) && block.blocks.length) {
    for (const cb of block.blocks) {
      const lines = formatBlock(cb, o);
      for (const l of lines) {
        if (l !== '') out.push(l);
      }
    }
  } else if (Array.isArray(block.segments)) {
    const body = segmentsToBraille(block.segments, o);
    out.push(...wrapCells(body, w, 0, 2));
  } else if (block.text != null && String(block.text).trim()) {
    out.push(...wrapCells(o.translate(String(block.text)), w, 0, 2));
  }
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Attribution formatting per BANA Formats §9 (preceded by blank line, cell 5 / 4 spaces indent)
function formatAttribution(block, o) {
  const body = block.segments ? segmentsToBraille(block.segments, o) : o.translate(block.text || '');
  if (!body.trim()) return [];
  const w = o.width || 38;
  const out = ['', ...wrapCells(body, w, 4, 4)];
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Caption formatting per BANA Formats §5 & §11 (7-5 margin: cell 7 first, cell 5 runover)
function formatCaption(block, o) {
  const body = block.segments ? segmentsToBraille(block.segments, o) : o.translate(block.text || '');
  if (!body.trim()) return [];
  const w = o.width || 38;
  const first = o.mode === 'bana' ? 6 : 4;
  const runover = o.mode === 'bana' ? 4 : 4;
  const out = ['', ...wrapCells(body, w, first, runover)];
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Play / Drama Dialogue formatting per BANA Formats §13
function formatPlay(block, o) {
  const text = block.text || '';
  if (!text.trim()) return [];
  const w = o.width || 38;
  const isVerse = block.subtype === 'verse';
  const lvl = block.level || 0;
  const first = isVerse ? (lvl === 0 ? 0 : 2) : (lvl === 0 ? 0 : 4);
  const runover = isVerse ? 4 : 2;
  return wrapCells(o.translate(text), w, first, runover).map((l) => l.replace(/\s+$/, ''));
}

// Stage Directions formatting per BANA Formats §13 (7-7 or 9-7)
function formatStage(block, o) {
  const text = block.text || '';
  if (!text.trim()) return [];
  const w = o.width || 38;
  const lvl = block.level || 0;
  const first = lvl === 0 ? 6 : 8;
  const runover = 6;
  return wrapCells(o.translate(text), w, first, runover).map((l) => l.replace(/\s+$/, ''));
}

// Boxline formatting per BANA Formats §12 (top border dots 2-5 '3', bottom border dots 2-3-5-6 '7')
function formatBox(block, o) {
  const w = o.width || 38;
  const text = String(block.text ?? '');
  const title = block.title ? o.translate(String(block.title)).trim() : '';
  const topBorder = title
    ? '333 ' + title + ' ' + '3'.repeat(Math.max(3, w - title.length - 5))
    : '3'.repeat(w);
  const bottomBorder = '7'.repeat(w);
  const out = ['', topBorder.slice(0, w)];
  if (Array.isArray(block.blocks) && block.blocks.length) {
    for (const cb of block.blocks) {
      if (!cb || typeof cb !== 'object') continue;
      if (block.title && cb.type === 'heading' && cb.text === block.title) continue;
      const lines = formatBlock(cb, o);
      for (const l of lines) {
        if (l !== '') out.push(l);
      }
    }
  } else if (text.trim()) {
    out.push(...wrapCells(o.translate(text), w, 0, 2));
  }
  out.push(bottomBorder, '');
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Glossary definition list formatting per BANA Formats §19 (1-3 runover)
function formatGlossary(block, o) {
  const items = block.items || [];
  if (!items.length) return [];
  const out = [''];
  const w = o.width || 38;
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const term = it.term != null ? String(it.term).trim() : '';
    const def = it.def != null ? String(it.def).trim() : '';
    // Translate the whole print entry so the colon is the UEB colon (dots 25), not a
    // raw ':' cell (dots 156) glued on after translation.
    if (term && def) out.push(...wrapCells(o.translate(`${term}: ${def}`), w, 0, 2));
    else if (it.text != null && String(it.text).trim()) out.push(...wrapCells(o.translate(String(it.text)), w, 0, 2));
    else if (term || def) out.push(...wrapCells(o.translate(term || def), w, 0, 2));
  }
  out.push('');
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Print page number indicator line per UKAAF B004 §8 and BANA Formats §1.6
function formatPageNum(block, o) {
  const p = String(block.page ?? block.text ?? '').trim();
  if (!p) return [];
  const w = o.width || 38;
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  const pageBrl = o.translate ? o.translate(p).trim() : p;
  if (isBana) {
    // BANA Formats 2016 §1.6: Cell 1 has dot 5, dots 25 ("3), followed by continuous hyphens, ending with space + page number
    const pagePart = ' ' + pageBrl;
    const leaderLen = Math.max(3, w - 2 - pagePart.length);
    const leader = '-'.repeat(leaderLen);
    const line = ('"3' + leader + pagePart).slice(0, w);
    return [line];
  } else {
    // UKAAF B004 §8: Centred line with dot 5, dots 25 ("3) immediately followed by the page number in braille
    const indicator = '"3' + pageBrl;
    return [centred(indicator, w).replace(/\s+$/, '')];
  }
}

// Table formatting: Spatial Columnar Table (BANA §11 / UKAAF §8) or Listed Table Format
function formatTable(block, o) {
  const rawHeaders = Array.isArray(block.headers) ? block.headers : [];
  const rawRows = (Array.isArray(block.rows) ? block.rows : []).map((r) => (Array.isArray(r) ? r : (r == null ? [] : [r])));
  const w = o.width || 38;

  // Format mode resolution: block-level format/style takes highest priority
  let mode = block.format || block.style || o.tableFormat || 'auto';
  if (mode === 'table-listed') mode = 'listed';
  if (mode === 'table-spatial') mode = 'spatial';
  if (mode === 'spatial') mode = 'columnar';

  const colCount = Math.max(rawHeaders.length, ...rawRows.map((r) => r.length));
  if (!(colCount > 0)) return [];

  // Translate all cells
  const has = (v) => v != null && String(v).trim() !== '';
  const tr = (v) => (has(v) ? o.translate(String(v)).replace(/\s+$/, '') : '');
  const headers = rawHeaders.map(tr);
  while (headers.length < colCount) headers.push('');
  const rows = rawRows.map((r) => {
    const row = r.map(tr);
    while (row.length < colCount) row.push('');
    return row;
  });

  // Calculate natural column widths
  const colWidths = Array(colCount).fill(1);
  for (let c = 0; c < colCount; c++) {
    if (headers[c]) colWidths[c] = Math.max(colWidths[c], headers[c].length);
    for (const r of rows) {
      if (r[c]) colWidths[c] = Math.max(colWidths[c], r[c].length);
    }
  }

  // Inter-column gutter: 2 spaces per standard
  const gutter = 2;
  const totalSpatialWidth = colWidths.reduce((a, b) => a + b, 0) + (colCount - 1) * gutter;

  // Title / Caption helper
  const title = block.title || block.caption;
  const formatTitle = () => {
    if (!title || !String(title).trim()) return [];
    const tStr = o.translate(String(title).trim());
    return [centred(tStr, w).replace(/\s+$/, '')];
  };

  // Listed Table Format (Formats §11.9 / B004 §8): a TN announcing the format, then
  // each row as its first cell (label in 1-3) followed by "header: value" lines (3-5).
  const formatListed = () => {
    const out = [''];
    const titleLines = formatTitle();
    if (titleLines.length) out.push(...titleLines, '');

    // Transcriber's note announcing format
    const tnText = block.tabletn || block.note || 'Table: Listed Table Format';
    out.push(...wrapCells(TN_OPEN + o.translate(tnText).trim() + TN_CLOSE, w, 6, 4), '');

    rawRows.forEach((rawRow, ri) => {
      const label = has(rawRow[0]) ? String(rawRow[0]) : `Row ${ri + 1}`;
      out.push(...wrapCells(o.translate(label), w, 0, 2));
      for (let ci = 1; ci < colCount; ci++) {
        const h = has(rawHeaders[ci]) ? String(rawHeaders[ci]) : `Col ${ci + 1}`;
        const line = has(rawRow[ci]) ? o.translate(`${h}: ${rawRow[ci]}`) : o.translate(`${h}:`) + ' ---';
        out.push(...wrapCells(line, w, 2, 4));
      }
      if (ri < rawRows.length - 1) out.push('');
    });
    out.push('');
    return out;
  };

  const formatColumnar = () => {
    let actualWidths = [...colWidths];
    if (totalSpatialWidth > w) {
      const avail = Math.max(colCount * 2, w - (colCount - 1) * gutter);
      let remainingAvail = avail;
      const remainingCols = [];
      const computed = Array(colCount).fill(0);

      for (let c = 0; c < colCount; c++) {
        if (colWidths[c] <= Math.max(3, Math.floor(avail / colCount))) {
          computed[c] = Math.max(2, colWidths[c]);
          remainingAvail -= computed[c];
        } else {
          remainingCols.push(c);
        }
      }

      if (remainingCols.length > 0 && remainingAvail > 0) {
        const sumRemainingNatural = remainingCols.reduce((sum, c) => sum + colWidths[c], 0);
        for (const c of remainingCols) {
          computed[c] = Math.max(2, Math.floor((colWidths[c] / sumRemainingNatural) * remainingAvail));
        }
        actualWidths = computed;
      } else {
        const sumNatural = colWidths.reduce((a, b) => a + b, 0);
        actualWidths = colWidths.map((cw) => Math.max(2, Math.floor((cw / sumNatural) * avail)));
      }
    }
    // Even squeezed, the columns may not fit the line (many columns at a 2-cell
    // minimum). Never slice columns off the right edge: fall back to the listed format.
    if (actualWidths.reduce((a, b) => a + b, 0) + (colCount - 1) * gutter > w) return formatListed();

    const out = [''];
    const titleLines = formatTitle();
    if (titleLines.length) out.push(...titleLines, '');

    // If there is an explicit transcriber note for the spatial table
    if (block.tabletn || block.note) {
      out.push(...wrapCells(TN_OPEN + o.translate(block.tabletn || block.note).trim() + TN_CLOSE, w, 6, 4), '');
    }

    // Render Headers (multi-line wrapped within column if needed)
    if (headers.some((h) => h.trim())) {
      const headerWrapped = headers.map((h, ci) => wrapCells(h, actualWidths[ci], 0, 0));
      const maxHdrLines = Math.max(...headerWrapped.map((l) => l.length));
      for (let li = 0; li < maxHdrLines; li++) {
        const lineCols = headerWrapped.map((lines, ci) => (lines[li] || '').padEnd(actualWidths[ci], ' '));
        out.push(lineCols.join(' '.repeat(gutter)).slice(0, w));
      }
      // Separation line (dots 2-5, '-' in ASCII BRF)
      const sepCols = actualWidths.map((cw) => '-'.repeat(cw));
      out.push(sepCols.join(' '.repeat(gutter)).slice(0, w));
    }

    // Check if any row has multi-line cells (BANA §11.3.4 inter-row spacing rule)
    const rowWrappedData = rows.map((row) => row.map((cell, ci) => wrapCells(cell, actualWidths[ci], 0, 0)));
    const hasMultiLine = rowWrappedData.some((cellWrapped) => Math.max(1, ...cellWrapped.map((l) => l.length)) > 1);

    // Render Data Rows
    rowWrappedData.forEach((cellWrapped, ri) => {
      const maxLines = Math.max(1, ...cellWrapped.map((l) => l.length));
      for (let li = 0; li < maxLines; li++) {
        const lineCols = cellWrapped.map((lines, ci) => (lines[li] || '').padEnd(actualWidths[ci], ' '));
        out.push(lineCols.join(' '.repeat(gutter)).slice(0, w));
      }
      if (hasMultiLine && ri < rowWrappedData.length - 1) {
        out.push('');
      }
    });

    out.push('');
    return out;
  };

  if (mode === 'listed') return formatListed();
  if (mode === 'columnar') return formatColumnar();
  if (totalSpatialWidth <= w) return formatColumnar();
  return formatListed();
}

// Computer Code Block formatting with UEB indicators
function formatCodeBlock(block, o) {
  const text = String(block.text ?? '');
  if (!text.trim()) return [];
  const w = o.width || 38;
  const lines = text.split('\n');
  // Displayed computer code is a grade-1 passage (UEB Technical §17): the passage
  // indicator and terminator stand on their own lines around the code, which is
  // translated uncontracted when the caller supplies a grade-1 translate.
  const g1 = o.translateG1 || o.translateUncontracted || o.translate;
  const out = ['', G1_PASSAGE_OPEN];
  lines.forEach((l) => {
    if (l.trim()) out.push(...wrapCells(g1(l), w, 0, 2));
  });
  out.push(G1_TERMINATOR, '');
  return out.map((l) => l.replace(/\s+$/, ''));
}

// Convert pixel array (RGBA) to 2x3 dot braille matrix line-art. SIX-dot cells: BRF
// (en-us-brf.dis) has no dots 7/8, so an 8-dot raster would lose its bottom row at
// the embosser.
export function convertImageToBrailleMatrix(pixels, width, height, targetCellsW = 20) {
  if (!pixels || !width || !height) return [];
  const cellWidth = targetCellsW;
  const cellHeight = Math.max(1, Math.floor((height / width) * cellWidth * (2 / 3)));   // a cell is 2 dots wide x 3 tall
  const resultLines = [];
  const dotWidth = cellWidth * 2;
  const dotHeight = cellHeight * 3;

  for (let cy = 0; cy < cellHeight; cy++) {
    let line = '';
    for (let cx = 0; cx < cellWidth; cx++) {
      let code = 0;
      const dotMap = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20]];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 2; c++) {
          const px = Math.min(width - 1, Math.floor(((cx * 2 + c) / dotWidth) * width));
          const py = Math.min(height - 1, Math.floor(((cy * 3 + r) / dotHeight) * height));
          const idx = (py * width + px) * 4;
          const lum = (pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114);
          if (lum < 128) code |= dotMap[r][c]; // dark pixels become tactile dots
        }
      }
      line += String.fromCharCode(0x2800 + code);
    }
    resultLines.push(line);
  }
  return resultLines;
}

// Tactile Graphic raster / BRF placeholder rendering
function formatTactileGraphic(block, o) {
  const w = o.width || 38;
  const tr = typeof o?.translate === 'function' ? o.translate : (t) => t;
  const desc = String(block.title || block.alt || 'Tactile Graphic');
  const label = `[Tactile graphic: ${desc}]`;
  const brl = tr(label);
  const out = ['', ...wrapCells(brl, w, 0, 2)];

  if (block.lines && Array.isArray(block.lines) && block.lines.length) {
    block.lines.forEach((l) => {
      // '*' = a full cell (dots 123456 = '=' in BRF); Unicode braille is mapped to
      // BRF ASCII; anything else becomes a blank; the row is clamped to the width.
      const cells = toBrfCells(String(l ?? '').replace(/\*/g, '=')).replace(/\s/g, ' ').slice(0, w);
      out.push(centred(cells, w).replace(/\s+$/, ''));
    });
  }
  out.push('');
  return out;
}

function traceTactileGraphic(block, o) {
  const w = o.width || 38;
  const desc = String(block.title || block.alt || 'Tactile Graphic');
  const label = `[Tactile graphic: ${desc}]`;
  let body;
  if (o.translatePos) {
    const { braille, inputPos } = o.translatePos(label, null);
    body = { s: braille, src: inputPos.map((p) => ({ u: 0, c: p })) };
  } else {
    const tr = typeof o?.translate === 'function' ? o.translate : (t) => t;
    const braille = tr(label);
    body = { s: braille, src: Array.from(braille, () => ({ u: 0, c: 0 })) };
  }
  const out = [tcBlank, ...tcWrap(o, body, w, 0, 2)];

  if (block.lines && Array.isArray(block.lines) && block.lines.length) {
    block.lines.forEach((l) => {
      const cells = toBrfCells(String(l ?? '').replace(/\*/g, '=')).replace(/\s/g, ' ').slice(0, w);
      out.push(tcDeco(centred(cells, w).replace(/\s+$/, '')));
    });
  }
  out.push(tcBlank);
  return out.map((x) => tcRstrip(x));
}

// Maths: transcribe the MathML via the maths engine (UEB/Nemeth per mode) to BRF
// ASCII, then set it off as a displayed block (blank line before; blocked at
// cell 1, runover cell 3). Requires o.mathToBrf (maths engine ready); if absent
// or it errors, the equation is skipped rather than breaking the document.
function formatMath(block, o) {
  if (!o.mathToBrf || (!block.mathml && !block.latex)) return [];
  let brf;
  try { brf = o.mathToBrf(block); } catch { return []; }
  if (!brf) return [];
  return ['', ...wrapCells(brf, o.width, 0, 2)].map((l) => l.replace(/\s+$/, ''));
}

// A malformed block (null/undefined, or missing a usable `type`) is skipped
// rather than thrown on — one bad block in a document shouldn't take down
// the whole conversion.
function formatBlock(block, o, atStart) {
  if (!block || typeof block !== 'object') return [];
  try {
    return formatBlockUnguarded(block, o, atStart);
  } catch (e) {
    if (typeof console !== 'undefined') console.warn(`[format] ${block.type ?? 'para'} block skipped:`, (e && e.message) || e);
    return [];
  }
}
function formatBlockUnguarded(block, o, atStart) {
  switch (block.type) {
    case 'title': return formatTitle(block, o);
    case 'heading': return formatHeading(block, o, atStart);
    case 'para': return formatPara(block, o);
    case 'list': return formatList(block, o);
    case 'glossary': return formatGlossary(block, o);
    case 'box': return formatBox(block, o);
    case 'pagenum': return formatPageNum(block, o);
    case 'attribution': return formatAttribution(block, o);
    case 'caption': return formatCaption(block, o);
    case 'play': return formatPlay(block, o);
    case 'stage': return formatStage(block, o);
    case 'note': return formatTranscriberNote(block, o);
    case 'footnote': return formatFootnote(block, o);
    case 'table': return formatTable(block, o);
    case 'code': return formatCodeBlock(block, o);
    case 'graphic': case 'tactile': return formatTactileGraphic(block, o);
    case 'math': return formatMath(block, o);
    case 'indicator': return block.text ? wrapCells(o.translate(block.text), o.width, 0, 0) : [indicatorLine(block.kind || 'dot2s', o.width)];
    case 'blank': return [''];
    default: return formatPara(block, o);
  }
}

// ===================== cell trace (editor word/cell linking) =====================
// Parallel to formatBlock: every cell carries a source coordinate {u,c} (u = unit
// index — 0 for a block, item index for a list; c = char index into that unit's
// flat text) or null for a decoration/space cell. traceBlock returns [{ s, src }]
// per content line; its `s` is asserted === formatBlock's line before the map is
// used (buildDocPages guard + test-celltrace), so a drift can only fall back to
// block-level linking, never mis-tag. o.translatePos(text, tf) → { braille,
// inputPos } is supplied by the caller (the editor) and mirrors o.translate.
function tcRstrip(o) { let b = o.s.length; while (b > 0 && o.s[b - 1] === ' ') b--; return { s: o.s.slice(0, b), src: o.src.slice(0, b) }; }
function tcTrimBoth(s, src) { let a = 0, b = s.length; while (a < b && s[a] === ' ') a++; while (b > a && s[b - 1] === ' ') b--; return { s: s.slice(a, b), src: src.slice(a, b) }; }
function tcRun(o, text, tf, unit, base) {                    // one translated text run
  const { braille, inputPos } = o.translatePos(text, tf || null);
  return { s: braille, src: inputPos.map((p) => ({ u: unit, c: base + p })) };
}
const tcDeco = (str) => ({ s: str, src: Array.from(str, () => null) });   // no source (rule line, marker, maths)
const tcBlank = { s: '', src: [] };
function tcSegs(o, segments, unit) {                         // mirror segmentsToBraille
  let s = '', src = [], base = 0;
  for (const seg of segments || []) {
    if (!seg) continue;
    if (seg.type === 'math') {
      if (!o.mathToBrf) continue;
      let brf = ''; try { brf = o.mathToBrf(seg) || ''; } catch { brf = ''; }
      const mathStr = seg.latex ? `$${seg.latex}$` : '⟨equation⟩';
      s += brf;
      for (let i = 0; i < brf.length; i++) {
        src.push({ u: unit, c: base + Math.min(i, mathStr.length - 1) });
      }
      base += mathStr.length;
    } else {
      const t = (seg.text ?? '').replace(/\s+/g, ' '); if (!t) continue;
      const r = tcRun(o, t, seg.tf ? Array(t.length).fill(seg.tf) : null, unit, base);
      s += r.s; for (const x of r.src) src.push(x); base += t.length;
    }
  }
  return tcTrimBoth(s, src);                                 // segmentsToBraille trims block edges only
}
function tcWrap(o, tr, width, first, runover) {              // mirror wrapCells (+ trailing strip)
  const { lines, srcs } = wrapCellsSrc(tr.s, tr.src, width, first, runover);
  return lines.map((line, i) => tcRstrip({ s: line, src: srcs[i] }));
}
function tcCentredBlock(o, tr, width, wrapWidth = width) {   // mirror centredBlock: wrap 0/0 then centre(trim)
  const { lines, srcs } = wrapCellsSrc(tr.s, tr.src, wrapWidth, 0, 0);
  return lines.map((line, i) => {
    let a = 0, b = line.length; while (a < b && line[a] === ' ') a++; while (b > a && line[b - 1] === ' ') b--;
    const trimmed = line.slice(a, b);
    const pad = Math.max(0, Math.floor((width - trimmed.length) / 2));
    const src = []; for (let k = 0; k < pad; k++) src.push(null); for (let k = a; k < b; k++) src.push(srcs[i][k]);
    return tcRstrip({ s: ' '.repeat(pad) + trimmed, src });
  });
}
function traceBlock(block, o, atStart) {
  if (!block || typeof block !== 'object') return [];
  const w = o.width;
  const paraLike = (block) => {
    const text = block.text ?? '';
    if (!text.trim()) return [];
    const isBlock = o.paragraphStyle === 'block';
    const first = isBlock ? 0 : 2;
    const res = tcWrap(o, tcRun(o, text, null, 0, 0), w, first, 0);
    if (isBlock) res.push(tcBlank);
    return res;
  };
  switch (block.type) {
    case 'title': return tcCentredBlock(o, tcRun(o, block.text ?? '', null, 0, 0), w).map((x) => tcRstrip(x));
    case 'heading': {
      const tr = block.segments ? tcSegs(o, block.segments, 0) : tcRun(o, block.text ?? '', null, 0, 0);
      const L = block.level || 1; const out = [];
      if (o.mode === 'bana') {
        if (L === 1) out.push(tcBlank, ...tcCentredBlock(o, tr, w, Math.max(1, w - 6)), tcBlank);
        else if (L === 2) out.push(tcBlank, ...tcWrap(o, tr, w, 4, 4));
        else out.push(tcBlank, ...tcWrap(o, tr, w, 6, 6));
      } else {
        if (L === 1) {                                   // mirror formatHeading: no end marker at the document start
          if (atStart) out.push(...tcCentredBlock(o, tr, w));
          else out.push(tcBlank, tcDeco(indicatorLine('dot2s', w)), ...tcCentredBlock(o, tr, w));
        } else if (L === 2) out.push(tcBlank, ...tcWrap(o, tr, w, 0, 4));
        else out.push(tcBlank, ...tcWrap(o, tr, w, 2, 4));
      }
      return out.map((x) => tcRstrip(x));
    }
    case 'para': {
      if (block.segments) {
        const tr = tcSegs(o, block.segments, 0);
        if (!tr.s) return [];
        const isBlock = o.paragraphStyle === 'block';
        const first = isBlock ? 0 : 2;
        const res = tcWrap(o, tr, w, first, 0);
        if (isBlock) res.push(tcBlank);
        return res;
      }
      return paraLike(block);
    }
    case 'attribution': {
      const tr = block.segments ? tcSegs(o, block.segments, 0) : tcRun(o, block.text || '', null, 0, 0);
      if (!tr.s) return [];
      return [tcBlank, ...tcWrap(o, tr, w, 4, 4)].map((x) => tcRstrip(x));
    }
    case 'caption': {
      const first = o.mode === 'bana' ? 6 : 4;
      const runover = o.mode === 'bana' ? 4 : 4;
      const tr = block.segments ? tcSegs(o, block.segments, 0) : tcRun(o, block.text || '', null, 0, 0);
      if (!tr.s) return [];
      return [tcBlank, ...tcWrap(o, tr, w, first, runover)].map((x) => tcRstrip(x));
    }
    case 'play': {
      const text = block.text || '';
      if (!text.trim()) return [];
      const isVerse = block.subtype === 'verse';
      const lvl = block.level || 0;
      const first = isVerse ? (lvl === 0 ? 0 : 2) : (lvl === 0 ? 0 : 4);
      const runover = isVerse ? 4 : 2;
      const tr = tcRun(o, text, null, 0, 0);
      return tcWrap(o, tr, w, first, runover).map((x) => tcRstrip(x));
    }
    case 'stage': {
      const text = block.text || '';
      if (!text.trim()) return [];
      const lvl = block.level || 0;
      const first = lvl === 0 ? 6 : 8;
      const runover = 6;
      const tr = tcRun(o, text, null, 0, 0);
      return tcWrap(o, tr, w, first, runover).map((x) => tcRstrip(x));
    }
    case 'note': {
      const text = String(block.text ?? '');
      if (!text.trim()) return [];
      const w = o.width || 38;
      const openDeco = tcDeco(TN_OPEN);
      const closeDeco = tcDeco(TN_CLOSE);
      const tr = tcRun(o, text, null, 0, 0);
      const full = {
        s: openDeco.s + tr.s.trim() + closeDeco.s,
        src: [...openDeco.src, ...tr.src.slice(0, tr.s.trim().length), ...closeDeco.src]
      };
      return tcWrap(o, full, w, 0, 2).map((x) => tcRstrip(x));
    }
    case 'footnote': {
      const w = o.width || 38;
      const out = [tcBlank];
      if (block.blocks && block.blocks.length) {
        for (const cb of block.blocks) {
          const clines = traceBlock(cb, o);
          for (const cl of clines) {
            if (cl.length) out.push(cl);
          }
        }
      } else if (block.segments) {
        const seg = tcSegs(o, block.segments, 0);
        out.push(...tcWrap(o, seg, w, 0, 2));
      } else if (block.text && block.text.trim()) {
        const tr = tcRun(o, block.text, null, 0, 0);
        out.push(...tcWrap(o, tr, w, 0, 2));
      }
      return out.map((x) => tcRstrip(x));
    }
    case 'list': {
      const items = block.items ?? []; if (!items.length) return [];
      const compact = o.listStyle === 'compact'; const out = compact ? [] : [tcBlank];
      const kind = block.kind;
      items.forEach((item, ui) => {
        if (!item) return;
        const lvl = item.level || 0;
        let first = 0;
        let runover = 2;
        if (kind === 'exercise') {
          first = lvl === 0 ? 0 : 2 + (lvl - 1) * 2;
          runover = 4 + (lvl > 1 ? (lvl - 1) * 2 : 0);
        } else if (kind === 'index' || kind === 'toc') {
          first = lvl === 0 ? 0 : 2 + (lvl - 1) * 2;
          runover = 2 + lvl * 2;
        } else {
          first = compact ? 4 + lvl * 2 : lvl * 2;
          runover = compact ? 0 : first + 2;
        }
        if (kind === 'toc' && item.page) {
          const transTitle = item.title ?? item.text ?? '';
          let titleBody;
          if (item.segments) {
            titleBody = tcSegs(o, item.segments, ui);
          } else {
            const { braille, inputPos } = o.translatePos(transTitle, null);
            titleBody = { s: braille, src: inputPos.map((p) => ({ u: ui, c: p })) };
          }
          const { braille: pageBrl, inputPos: pagePos } = o.translatePos(item.page, null);
          const wrappedTitle = tcWrap(o, titleBody, w - pageBrl.length - 2, first, runover);
          const lastLine = wrappedTitle[wrappedTitle.length - 1] || [];
          const neededLeaders = w - lastLine.length - pageBrl.length;
          const pageCells = pageBrl.split('').map((ch, pi) => ({ ch, unit: ui, off: pagePos[pi] ?? 0, index: lastLine.length + pi }));

          if (neededLeaders >= 2) {
            const spaceCount = Math.min(1, neededLeaders - 2);
            const leaderCount = neededLeaders - 1;
            const leaderCells = [
              ...Array.from({ length: spaceCount }, () => ({ ch: ' ', unit: 0, off: 0, index: 0 })),
              ...Array.from({ length: leaderCount }, () => ({ ch: '"', unit: 0, off: 0, index: 0 })),
              { ch: ' ', unit: 0, off: 0, index: 0 },
              ...pageCells,
            ];
            wrappedTitle[wrappedTitle.length - 1] = [...lastLine, ...leaderCells];
            out.push(...wrappedTitle);
          } else {
            const leaderCells = [
              ...Array.from({ length: runover }, () => ({ ch: ' ', unit: 0, off: 0, index: 0 })),
              ...Array.from({ length: Math.max(2, w - runover - pageBrl.length - 1) }, () => ({ ch: '"', unit: 0, off: 0, index: 0 })),
              { ch: ' ', unit: 0, off: 0, index: 0 },
              ...pageCells,
            ];
            wrappedTitle.push(leaderCells);
            out.push(...wrappedTitle);
          }
          return;
        }

        const marker = compact ? '' : (item.marker ? item.marker + ' ' : '');
        let body;
        if (item.segments) {
          const mkBrl = marker ? o.translatePos(marker, null).braille : '';
          const seg = tcSegs(o, item.segments, ui);
          body = { s: mkBrl + seg.s, src: [...Array.from(mkBrl, () => null), ...seg.src] };
        } else {
          const { braille, inputPos } = o.translatePos(marker + (item.text ?? ''), null);
          body = { s: braille, src: inputPos.map((p) => (p < marker.length ? null : { u: ui, c: p - marker.length })) };
        }
        out.push(...tcWrap(o, body, w, first, runover));
      });
      if (!compact) out.push(tcBlank);
      return out.map((x) => tcRstrip(x));
    }
    case 'glossary': {
      const items = block.items || [];
      if (!items.length) return [];
      const out = [tcBlank];
      items.forEach((item, ui) => {
        const text = item.text || (item.term && item.def ? `${item.term}: ${item.def}` : (item.term || item.def || ''));
        const { braille, inputPos } = o.translatePos(text, null);
        const body = { s: braille, src: inputPos.map((p) => ({ u: ui, c: p })) };
        out.push(...tcWrap(o, body, w, 0, 2));
      });
      out.push(tcBlank);
      return out.map((x) => tcRstrip(x));
    }
    case 'box': {
      const text = block.text || '';
      const title = block.title ? o.translate(block.title).trim() : '';
      const topBorder = title
        ? '333 ' + title + ' ' + '3'.repeat(Math.max(3, w - title.length - 5))
        : '3'.repeat(w);
      const bottomBorder = '7'.repeat(w);
      const out = [tcBlank, tcDeco(topBorder.slice(0, w))];
      if (block.blocks && block.blocks.length) {
        for (const cb of block.blocks) {
          if (block.title && cb.type === 'heading' && cb.text === block.title) continue;
          const childLines = traceBlock(cb, o);
          for (const line of childLines) {
            if (line.length) out.push(line);
          }
        }
      } else if (text.trim()) {
        const { braille, inputPos } = o.translatePos(text, null);
        const body = { s: braille, src: inputPos.map((p) => ({ u: 0, c: p })) };
        out.push(...tcWrap(o, body, w, 0, 2));
      }
      out.push(tcDeco(bottomBorder), tcBlank);
      return out.map((x) => tcRstrip(x));
    }
    case 'pagenum': {
      const p = String(block.page ?? block.text ?? '').trim();
      if (!p) return [];
      const isBana = (o.standard === 'bana' || o.mode === 'bana');
      const pageBrl = o.translate ? o.translate(p).trim() : p;
      if (isBana) {
        const pagePart = ' ' + pageBrl;
        const leaderLen = Math.max(3, w - 2 - pagePart.length);
        const leader = '-'.repeat(leaderLen);
        const line = ('"3' + leader + pagePart).slice(0, w);
        return [tcDeco(line)];
      } else {
        const indicator = '"3' + pageBrl;
        return [tcDeco(centred(indicator, w).replace(/\s+$/, ''))];
      }
    }
    case 'math': {
      if (!o.mathToBrf || (!block.mathml && !block.latex)) return [];
      let brf; try { brf = o.mathToBrf(block); } catch { return []; }
      if (!brf) return [];
      return [tcBlank, ...tcWrap(o, tcDeco(brf), w, 0, 2)].map((x) => tcRstrip(x));
    }
    case 'indicator': return [tcDeco(indicatorLine(block.kind || 'dot2s', w))];
    case 'blank': return [tcBlank];
    case 'table': return traceTable(block, o);
    case 'graphic': case 'tactile': return traceTactileGraphic(block, o);
    default: return paraLike(block);
  }
}

// Traced counterpart to formatTable for character-to-cell coordinate mapping
function traceTable(block, o) {
  const rawHeaders = Array.isArray(block.headers) ? block.headers : [];
  const rawRows = (Array.isArray(block.rows) ? block.rows : []).map((r) => (Array.isArray(r) ? r : (r == null ? [] : [r])));
  const w = o.width || 38;

  let mode = block.format || block.style || o.tableFormat || 'auto';
  if (mode === 'table-listed') mode = 'listed';
  if (mode === 'table-spatial') mode = 'spatial';
  if (mode === 'spatial') mode = 'columnar';

  const colCount = Math.max(rawHeaders.length, ...rawRows.map((r) => r.length));
  if (!(colCount > 0)) return [];

  const has = (v) => v != null && String(v).trim() !== '';

  const headerCount = rawHeaders.length;
  const headerTrs = [];
  for (let ci = 0; ci < colCount; ci++) {
    const rawH = rawHeaders[ci];
    if (has(rawH)) {
      headerTrs.push(tcRun(o, String(rawH).replace(/\s+$/, ''), null, ci, 0));
    } else {
      headerTrs.push({ s: '', src: [] });
    }
  }

  const rowTrs = [];
  rawRows.forEach((r, ri) => {
    const row = [];
    for (let ci = 0; ci < colCount; ci++) {
      const rawCell = r[ci];
      const unit = headerCount + ri * colCount + ci;
      if (has(rawCell)) {
        row.push(tcRun(o, String(rawCell).replace(/\s+$/, ''), null, unit, 0));
      } else {
        row.push({ s: '', src: [] });
      }
    }
    rowTrs.push(row);
  });

  const headers = headerTrs.map((h) => h.s);
  const rows = rowTrs.map((r) => r.map((c) => c.s));

  const colWidths = Array(colCount).fill(1);
  for (let c = 0; c < colCount; c++) {
    if (headers[c]) colWidths[c] = Math.max(colWidths[c], headers[c].length);
    for (const r of rows) {
      if (r[c]) colWidths[c] = Math.max(colWidths[c], r[c].length);
    }
  }

  const gutter = 2;
  const totalSpatialWidth = colWidths.reduce((a, b) => a + b, 0) + (colCount - 1) * gutter;

  const title = block.title || block.caption;
  const traceTitle = () => {
    if (!title || !String(title).trim()) return [];
    return tcCentredBlock(o, tcRun(o, String(title).trim(), null, 0, 0), w);
  };

  const traceListed = () => {
    const out = [tcBlank];
    const titleLines = traceTitle();
    if (titleLines.length) out.push(...titleLines, tcBlank);

    const tnText = block.tabletn || block.note || 'Table: Listed Table Format';
    const openDeco = tcDeco(TN_OPEN);
    const closeDeco = tcDeco(TN_CLOSE);
    const tnRun = tcRun(o, tnText.trim(), null, 0, 0);
    const tnFull = {
      s: openDeco.s + tnRun.s + closeDeco.s,
      src: [...openDeco.src, ...tnRun.src, ...closeDeco.src]
    };
    out.push(...tcWrap(o, tnFull, w, 6, 4), tcBlank);

    rawRows.forEach((rawRow, ri) => {
      const unit0 = headerCount + ri * colCount;
      const label = has(rawRow[0]) ? String(rawRow[0]) : `Row ${ri + 1}`;
      const labelRun = has(rawRow[0]) ? tcRun(o, label, null, unit0, 0) : tcDeco(o.translate(label));
      out.push(...tcWrap(o, labelRun, w, 0, 2));

      for (let ci = 1; ci < colCount; ci++) {
        const h = has(rawHeaders[ci]) ? String(rawHeaders[ci]) : `Col ${ci + 1}`;
        const unit = headerCount + ri * colCount + ci;
        if (has(rawRow[ci])) {
          const fullText = `${h}: ${rawRow[ci]}`;
          const { braille, inputPos } = o.translatePos(fullText, null);
          const prefixLen = h.length + 2;
          const src = inputPos.map((p) => (p < prefixLen ? (has(rawHeaders[ci]) ? { u: ci, c: p } : null) : { u: unit, c: p - prefixLen }));
          out.push(...tcWrap(o, { s: braille, src }, w, 2, 4));
        } else {
          const fullText = `${h}:`;
          const { braille, inputPos } = o.translatePos(fullText, null);
          const src = inputPos.map((p) => (has(rawHeaders[ci]) ? { u: ci, c: p } : null));
          const fullLine = { s: braille + ' ---', src: [...src, null, null, null, null] };
          out.push(...tcWrap(o, fullLine, w, 2, 4));
        }
      }
      if (ri < rawRows.length - 1) out.push(tcBlank);
    });
    out.push(tcBlank);
    return out;
  };

  const traceColumnar = () => {
    let actualWidths = [...colWidths];
    if (totalSpatialWidth > w) {
      const avail = Math.max(colCount * 2, w - (colCount - 1) * gutter);
      let remainingAvail = avail;
      const remainingCols = [];
      const computed = Array(colCount).fill(0);

      for (let c = 0; c < colCount; c++) {
        if (colWidths[c] <= Math.max(3, Math.floor(avail / colCount))) {
          computed[c] = Math.max(2, colWidths[c]);
          remainingAvail -= computed[c];
        } else {
          remainingCols.push(c);
        }
      }

      if (remainingCols.length > 0 && remainingAvail > 0) {
        const sumRemainingNatural = remainingCols.reduce((sum, c) => sum + colWidths[c], 0);
        for (const c of remainingCols) {
          computed[c] = Math.max(2, Math.floor((colWidths[c] / sumRemainingNatural) * remainingAvail));
        }
        actualWidths = computed;
      } else {
        const sumNatural = colWidths.reduce((a, b) => a + b, 0);
        actualWidths = colWidths.map((cw) => Math.max(2, Math.floor((cw / sumNatural) * avail)));
      }
    }

    if (actualWidths.reduce((a, b) => a + b, 0) + (colCount - 1) * gutter > w) return traceListed();

    const out = [tcBlank];
    const titleLines = traceTitle();
    if (titleLines.length) out.push(...titleLines, tcBlank);

    if (block.tabletn || block.note) {
      const tnText = block.tabletn || block.note;
      const openDeco = tcDeco(TN_OPEN);
      const closeDeco = tcDeco(TN_CLOSE);
      const tnRun = tcRun(o, tnText.trim(), null, 0, 0);
      const tnFull = {
        s: openDeco.s + tnRun.s + closeDeco.s,
        src: [...openDeco.src, ...tnRun.src, ...closeDeco.src]
      };
      out.push(...tcWrap(o, tnFull, w, 6, 4), tcBlank);
    }

    const formatTracedRow = (cellTrList) => {
      const wrappedCells = cellTrList.map((cTr, ci) => wrapCellsSrc(cTr.s, cTr.src, actualWidths[ci], 0, 0));
      const maxLines = Math.max(1, ...wrappedCells.map((wc) => wc.lines.length));
      const rowOut = [];

      for (let li = 0; li < maxLines; li++) {
        let lineStr = '';
        const lineSrc = [];
        for (let ci = 0; ci < colCount; ci++) {
          const wc = wrappedCells[ci];
          const cellLine = (wc.lines[li] || '');
          const cellSrc = (wc.srcs[li] || []);
          const targetW = actualWidths[ci];
          
          lineStr += cellLine.padEnd(targetW, ' ');
          lineSrc.push(...cellSrc);
          for (let k = cellLine.length; k < targetW; k++) lineSrc.push(null);

          if (ci < colCount - 1) {
            lineStr += ' '.repeat(gutter);
            for (let g = 0; g < gutter; g++) lineSrc.push(null);
          }
        }
        rowOut.push({
          s: lineStr.slice(0, w),
          src: lineSrc.slice(0, w)
        });
      }
      return { lines: rowOut, maxLines };
    };

    if (headers.some((h) => h.trim())) {
      const hdrFormatted = formatTracedRow(headerTrs);
      out.push(...hdrFormatted.lines);

      const sepCols = actualWidths.map((cw) => '-'.repeat(cw));
      const sepLine = sepCols.join(' '.repeat(gutter)).slice(0, w);
      out.push(tcDeco(sepLine));
    }

    const rowFormatted = rowTrs.map((r) => formatTracedRow(r));
    const hasMultiLine = rowFormatted.some((rf) => rf.maxLines > 1);

    rowFormatted.forEach((rf, ri) => {
      out.push(...rf.lines);
      if (hasMultiLine && ri < rowFormatted.length - 1) {
        out.push(tcBlank);
      }
    });

    out.push(tcBlank);
    return out;
  };

  if (mode === 'listed') return traceListed();
  if (mode === 'columnar') return traceColumnar();
  if (totalSpatialWidth <= w) return traceColumnar();
  return traceListed();
}

// Collapse a leading blank line at the very top (nothing to separate from).
function trimLeadingBlank(lines) {
  while (lines.length && lines[0] === '') lines.shift();
  return lines;
}

// A Table of Contents from the document's headings and their braille page
// numbers, as preliminary page(s) numbered with a 'p' prefix (a separate
// sequence, so the body still starts at braille page 1 — the braille convention
// that avoids the TOC-length-changes-body-numbers circularity). Entry indent by
// heading level; page number right-justified. A first pass, guide dots TBD.
function buildToc(headings, o) {
  if (!headings.length) return [];
  const w = o.width;
  const lines = [...centredBlock(o.translate('Contents'), w).map((l) => l.replace(/\s+$/, '')), ''];
  for (const h of headings) {
    const num = brailleNumber(h.page);
    const indent = (h.level - 1) * 2;
    // Wrap a long entry (runover indented 2 further) so it never overflows the
    // page; put the page number right-justified on the last line, or on its own
    // line if it won't fit there.
    const wrapped = wrapCells(o.translate(h.text), w, indent, indent + 2);
    const li = wrapped.length - 1;
    if (wrapped[li].length + 2 + num.length <= w) {
      wrapped[li] += ' '.repeat(w - wrapped[li].length - num.length) + num;
    } else {
      wrapped.push(rightJustify(num, w));
    }
    for (const l of wrapped) lines.push(l.replace(/\s+$/, ''));
  }
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  const hideHeader = !!(o.suppressHeader || o.pageHeaders === false);
  const perPage = linesPerPage(o.depth, hideHeader, isBana ? 'bana' : 'ukaaf');
  const pages = [];
  for (let i = 0; i < lines.length; i += perPage) {
    const pnum = 'P' + brailleNumber(pages.length + 1);          // preliminary page number, e.g. P#A
    const chunk = lines.slice(i, i + perPage);
    // Match the body's per-mode page-number placement: BANA on the last line
    // (bottom-right), UKAAF on the first line (top-right). (Was always top-right.)
    // With page furniture suppressed the prelim pages carry no number line either,
    // so a TOC page never exceeds the depth.
    if (hideHeader) {
      pages.push(chunk);
    } else if (isBana) {
      while (chunk.length < perPage) chunk.push('');
      pages.push(['', ...chunk, rightJustify(pnum, w)]);
    } else {
      pages.push([rightJustify(pnum, w), ...chunk]);
    }
  }
  return pages;
}

function getBlockSignature(block, o, atStart) {
  if (!block) return '';
  const key = block._key ?? '';
  const type = block.type ?? 'para';
  const text = block.text ?? '';
  const lvl = block.level ?? 0;
  const kind = block.kind ?? '';
  const marker = block.marker ?? '';
  const segs = block.segments ? JSON.stringify(block.segments) : '';
  const items = block.items ? JSON.stringify(block.items) : '';
  const w = o.width || 38;
  const pStyle = o.paragraphStyle ?? '';
  const lStyle = o.listStyle ?? '';
  const mode = o.mode ?? '';
  const trace = o.trace ? '1' : '0';
  return `${key}|${type}|${lvl}|${kind}|${marker}|${atStart ? '1' : '0'}|${w}|${pStyle}|${lStyle}|${mode}|${trace}|${text}|${segs}|${items}`;
}

// Page-boundary rules (Rule Register R8: B004 §5 "must not appear on the bottom
// line" / Formats §4.3.9 & §1.15.2 "followed by at least one line of text"; and no blank line
// at the top of a page). Walks the content in page order: a blank that would open a
// page is dropped; a heading or print page number block (its indicator line, its wrapped lines and one
// following text line) that would not fit on the current page is pushed to the next
// page with blank filler. Blocks taller than a page are left alone. The three
// parallel arrays stay aligned (filler = block -1, no cells).
function applyPageBoundaries(content, contentBlock, contentCells, blocks, perPage, isBana = false) {
  const n = content.length;
  const out = [], outBlock = [], outCells = [];
  const push = (l, b, c) => { out.push(l); outBlock.push(b); outCells.push(c); };
  const isHeading = (bi) => bi >= 0 && blocks[bi] && typeof blocks[bi] === 'object' && blocks[bi].type === 'heading';
  const isPageNum = (bi) => bi >= 0 && blocks[bi] && typeof blocks[bi] === 'object' && blocks[bi].type === 'pagenum';
  const isGraphic = (bi) => bi >= 0 && blocks[bi] && typeof blocks[bi] === 'object' && (blocks[bi].type === 'graphic' || blocks[bi].type === 'tactile');
  const seenBoundaryBlock = new Set();
  
  let bodyPos = 0;
  for (let i = 0; i < n; i++) {
    if (bodyPos === 0 && content[i] === '') continue;                              // no blank at the top of a page
    const bi = contentBlock[i];
    if ((isHeading(bi) || isPageNum(bi) || isGraphic(bi)) && content[i] !== '' && !seenBoundaryBlock.has(bi)) {
      seenBoundaryBlock.add(bi);
      let end = i; while (end + 1 < n && contentBlock[end + 1] === bi) end++;  // last line of the block
      while (end > i && content[end] === '') end--;                            // minus its trailing blanks
      let next = end + 1; while (next < n && content[next] === '') next++;     // the text line that must follow
      
      // If a print page indicator is followed by a heading (or chain of headings/pagenums),
      // the heading itself must not be orphaned. Per UKAAF B004 §8 and BANA Formats §1.15.2,
      // a print page indicator cannot immediately precede a heading that is carried over.
      if (isPageNum(bi)) {
        let curNext = next;
        while (curNext < n && (isHeading(contentBlock[curNext]) || isPageNum(contentBlock[curNext]))) {
          const nextBi = contentBlock[curNext];
          let hEnd = curNext; while (hEnd + 1 < n && contentBlock[hEnd + 1] === nextBi) hEnd++;
          while (hEnd > curNext && content[hEnd] === '') hEnd--;
          let hNext = hEnd + 1; while (hNext < n && content[hNext] === '') hNext++;
          curNext = hNext;
          next = hNext < n ? hNext : hEnd;
        }
      }
      
      const need = isGraphic(bi) ? (end - i + 1) : ((next < n ? next : end) - i + 1);
      if (bodyPos > 0 && need > perPage - bodyPos && need <= perPage) {
        while (bodyPos < perPage) {
          push('', -1, null);
          bodyPos++;
        }
        bodyPos = 0;
      }
    }
    push(content[i], bi, contentCells[i]);
    if (isBana && isPageNum(bi) && bodyPos === 0) {
      // In BANA mode, top-of-page transition line moves to Line 1 running head and takes 0 body lines
    } else {
      bodyPos++;
      if (bodyPos === perPage) bodyPos = 0;
    }
  }
  return { content: out, contentBlock: outBlock, contentCells: outCells };
}

// Text cleaning applied to everything that reaches the translator: house
// normalisation: tabs and C0/DEL control characters become spaces (which
// preserves exact 1:1 character positions for translatePos source-linking). Newlines are kept.
const cleanForTranslate = (text) => String(text || '').replace(/\t/g, ' ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ');

// Assemble the document's body lines and TOC prelims, ready to convert to BRF or
// split into volumes. `empty` when there's nothing to format. `opts` is the
// normalised option set (clamped geometry, cleaning translate) for callers that
// build further pages (volume title pages) — never reuse the raw caller options.
function buildDocPages(doc, o) {
  o = o ? { ...o } : {};
  if (typeof o.translate !== 'function') throw new Error('formatDocument: opts.translate must be the braille translate function');
  if (typeof o.translate === 'function') {
    const rawTr = o.translate;
    o.translate = (text, typeform) => rawTr(cleanForTranslate(text), typeform);
  }
  if (typeof o.translatePos === 'function') {
    const rawTrPos = o.translatePos;
    o.translatePos = (text, typeform) => rawTrPos(cleanForTranslate(text), typeform);
  }
  if (typeof o.translateG1 === 'function') {
    const rawG1 = o.translateG1;
    o.translateG1 = (text) => rawG1(cleanForTranslate(text));
  }
  o.width = Math.max(10, Math.min(60, Number(o.width) || 38));
  o.depth = Math.max(10, Math.min(45, Number(o.depth) || 25));
  const blocks = Array.isArray(doc?.blocks) ? doc.blocks : [];
  const hasPrintPages = blocks.some((b) => b && typeof b === 'object' && b.type === 'pagenum');
  const hasTitle = !!(doc?.title && String(doc.title).trim());
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  const hideHeader = !!(o.suppressHeader || o.pageHeaders === false);
  const perPage = linesPerPage(o.depth, hideHeader, isBana ? 'bana' : 'ukaaf', hasPrintPages, hasTitle);
  const headings = [];
  let content = [], contentBlock = [], contentCells = [];
  let atStart = true;
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    if (!block || typeof block !== 'object') continue;
    let lines = null, srcs = null;
    const cacheKey = o.blockCache ? getBlockSignature(block, o, atStart) : null;
    if (cacheKey && o.blockCache.has(cacheKey)) {
      const cached = o.blockCache.get(cacheKey);
      lines = cached.lines;
      srcs = cached.srcs;
      if (lines.length) atStart = false;
    }
    if (lines === null) {
      lines = formatBlock(block, o, atStart);
      if (o.translatePos) {
        try {
          const tr = traceBlock(block, o, atStart);
          if (tr.length === lines.length && tr.every((t, i) => t.s === lines[i])) {
            srcs = tr.map((t) => t.src);
          }
        } catch { srcs = null; }
      }
      if (lines.length) atStart = false;
      if (o.blockCache && cacheKey) {
        o.blockCache.set(cacheKey, { lines, srcs });
      }
    }

    const headingText = block.text || (block.segments ? block.segments.map(s => s.text || '').join('') : '');
    if (o.toc && block && block.type === 'heading' && String(headingText ?? '').trim()) {
      headings.push({ text: String(headingText), level: block.level || 1, bi });
    }
    for (let li = 0; li < lines.length; li++) {
      if (lines[li] === '' && content.length && content[content.length - 1] === '') continue;
      content.push(lines[li]); contentBlock.push(bi); contentCells.push(srcs ? srcs[li] : null);
    }
  }
  const preLen = content.length;
  trimLeadingBlank(content);
  const shift = preLen - content.length;
  if (shift) { contentBlock.splice(0, shift); contentCells.splice(0, shift); }
  if (!content.length) return { empty: true, opts: o };
  ({ content, contentBlock, contentCells } = applyPageBoundaries(content, contentBlock, contentCells, blocks, perPage, isBana));
  const bodyPages = assemble(content, {
    title: doc?.title ?? null, width: o.width, depth: o.depth, mode: isBana ? 'bana' : 'ukaaf', translate: o.translate,
    suppressHeader: o.suppressHeader, pageHeaders: o.pageHeaders, hasPrintPages,
  });
  let tocPages = [];
  if (o.toc && headings.length) {
    for (const h of headings) {
      let line = contentBlock.indexOf(h.bi);
      while (line >= 0 && line + 1 < content.length && content[line] === '' && contentBlock[line + 1] === h.bi) line++;
      h.line = Math.max(0, line);
      h.page = Math.floor(h.line / perPage) + 1;
    }
    tocPages = buildToc(headings, o);
  }
  return { empty: false, content, contentBlock, contentCells, headings, tocPages, bodyPages, hasPrintPages, hasTitle, opts: o };
}

function formatDocument(doc, o) {
  const b = buildDocPages(doc, o);
  if (b.empty) return '';
  if (o.trace) { const t = traceRows(b.content, b.contentBlock, b.contentCells, b.tocPages, b.opts, b.hasPrintPages, b.hasTitle); o.trace.rows = t.rows; o.trace.rowCells = t.rowCells; }
  return toBRF([...b.tocPages, ...b.bodyPages]);
}

// Print a braille page with a centered title, a volume number, and border rows
// top and bottom. Standard UK/US library prelim layout.
function volumeTitlePage(vol, of, title, o) {
  const w = o.width, depth = o.depth;
  const tr = (s) => o.translate(s);
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  if (isBana) {
    const border = '='.repeat(w);
    const lines = [border, ''];
    if (title) { for (const l of centredBlock(tr(title), w)) lines.push(l.replace(/\s+$/, '')); lines.push(''); }
    for (const l of centredBlock(tr(`VOLUME ${vol} OF ${of}`), w)) lines.push(l.replace(/\s+$/, ''));
    while (lines.length < depth - 1) lines.push('');
    while (lines.length > depth - 1) lines.splice(lines.length - 1, 1);   // over-long title: trim above the bottom border
    lines.push(border);
    return lines;
  }
  const lines = [''];
  if (title) { for (const l of centredBlock(tr(title), w)) lines.push(l.replace(/\s+$/, '')); lines.push(''); lines.push(''); }
  for (const l of centredBlock(tr(`Volume ${vol} of ${of}`), w)) lines.push(l.replace(/\s+$/, ''));
  return lines.slice(0, depth);
}

// Split a document into braille volumes of at most o.volumePages *body* pages each
// (0/undefined = a single volume). Page numbering is continuous across volumes (we
// split AFTER assembly, so the numbers are already baked in — the braille
// convention). The TOC prelim pages ride with volume 1. Returns
// [{ volume, of, brf, spineLabel }]. Splits on braille-page boundaries only.
function formatVolumes(doc, o) {
  const b = buildDocPages(doc, o);
  o = b.opts;
  const title = doc?.title != null ? String(doc.title) : 'DOCUMENT';
  if (b.empty) return [{ volume: 1, of: 1, brf: '', spineLabel: `${title} - VOL 1/1` }];
  const maxV = Math.max(0, o.volumePages | 0);
  if (!maxV || b.bodyPages.length <= maxV) {
    return [{ volume: 1, of: 1, brf: toBRF([...b.tocPages, ...b.bodyPages]), spineLabel: `${title} - VOL 1/1` }];
  }
  const chunks = [];
  for (let i = 0; i < b.bodyPages.length; i += maxV) chunks.push(b.bodyPages.slice(i, i + maxV));
  const of = chunks.length;
  return chunks.map((chunk, idx) => ({
    volume: idx + 1, of,
    spineLabel: `${title} - VOL ${idx + 1}/${of}`,
    brf: toBRF([volumeTitlePage(idx + 1, of, title, o), ...(idx === 0 ? b.tocPages : []), ...chunk]),
  }));
}

// Reconstruct assemble()'s per-page row layout to label each output row with its
// source block. Must mirror assemble() + buildToc() exactly.
function traceRows(content, contentBlock, contentCells, tocPages, o, hasPrintPages = false, hasTitle = false) {
  const rows = [], rowCells = [];
  const push = (b, c) => { rows.push(b); rowCells.push(c); };
  for (const page of tocPages) for (let i = 0; i < page.length; i++) push(-1, null);
  const hideHeader = o.suppressHeader || o.pageHeaders === false;
  const isBana = (o.standard === 'bana' || o.mode === 'bana');
  const hasFurniture = hasPrintPages || hasTitle;
  const perPage = linesPerPage(o.depth, hideHeader, isBana ? 'bana' : 'ukaaf', hasPrintPages, hasTitle);
  
  let lineIdx = 0;
  while (lineIdx < content.length) {
    if (hideHeader) {
      const chunk = content.slice(lineIdx, lineIdx + perPage);
      for (let k = 0; k < chunk.length; k++) push(contentBlock[lineIdx + k], contentCells[lineIdx + k]);
      lineIdx += perPage;
    } else if (isBana) {
      if (!hasFurniture) {
        const chunk = content.slice(lineIdx, lineIdx + perPage);
        for (let k = 0; k < chunk.length; k++) push(contentBlock[lineIdx + k], contentCells[lineIdx + k]);
        for (let k = chunk.length; k < perPage; k++) push(-1, null);
        push(-1, null);
        lineIdx += perPage;
      } else {
        if (typeof content[lineIdx] === 'string' && content[lineIdx].startsWith('"3-')) {
          lineIdx += 1;
        }
        push(-1, null);                          // Line 1: print page / running head
        const chunk = content.slice(lineIdx, lineIdx + perPage);
        for (let k = 0; k < chunk.length; k++) push(contentBlock[lineIdx + k], contentCells[lineIdx + k]);
        for (let k = chunk.length; k < perPage; k++) push(-1, null);
        push(-1, null);                          // Line 25: braille page number
        lineIdx += chunk.length;
      }
    } else {
      push(-1, null);                            // Line 1: running-head line
      const chunk = content.slice(lineIdx, lineIdx + perPage);
      for (let k = 0; k < chunk.length; k++) push(contentBlock[lineIdx + k], contentCells[lineIdx + k]);
      lineIdx += perPage;
    }
  }
  return { rows, rowCells };
}

export { formatDocument, formatVolumes, formatBlock, traceBlock, centred, indicatorLine };
