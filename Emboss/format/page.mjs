// Page assembly + BRF serialisation.
// Turns a flat list of formatted content lines into BRF pages with a running
// head / page-information line, then serialises to the exact BRF byte format.

const NUMDIGITS = 'ABCDEFGHIJ';                 // 1->A ... 9->I, 0->J

// Braille page number in ASCII braille, e.g. 1 -> "#A", 10 -> "#AJ".
function brailleNumber(n) {
  return '#' + String(n).split('').map((d) => NUMDIGITS[(Number(d) + 9) % 10]).join('');
}

function continuationPrefix(idx) {
  let s = '';
  while (idx > 0) {
    const rem = (idx - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    idx = Math.floor((idx - 1) / 26);
  }
  return s;
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
function runningHead(pageNum, titleBrl, width) {
  const num = brailleNumber(pageNum);
  let line = ' '.repeat(width);
  // Centre the running-head title, but only if it fits with ≥2 cells of clearance
  // before the page number. An over-long title is OMITTED rather than overflowing
  // the line or overwriting the page number (which must stay locatable at the
  // right margin — braille readers find it by touch there).
  if (pageNum > 1 && titleBrl) {
    const offset = Math.floor((width - titleBrl.length) / 2);
    if (offset >= 0 && offset + titleBrl.length + 2 <= width - num.length) {
      line = overlay(line, titleBrl, offset);
    }
  }
  line = overlay(line, num, width - num.length);
  return line.replace(/\s+$/, '');
}

// Running head (page information line), BANA (Formats 2016 §1.6 & §1.8):
// Print page number top-right on Line 1. Running head title centred with at least
// 3 cells of clearance before the print page number from page 2 onward.
function banaRunningHead(printPageBrl, titleBrl, width, pageNum) {
  let line = ' '.repeat(width);
  const pBrl = printPageBrl ? String(printPageBrl).trim() : '';
  if (pBrl) {
    line = overlay(line, pBrl, width - pBrl.length);
  }
  if (pageNum > 1 && titleBrl) {
    const offset = Math.floor((width - titleBrl.length) / 2);
    const rightLimit = pBrl ? (width - pBrl.length - 3) : width;
    if (offset >= 0 && offset + titleBrl.length <= rightLimit) {
      line = overlay(line, titleBrl, offset);
    }
  }
  return line.replace(/\s+$/, '');
}

const rightJustify = (text, width) => ' '.repeat(Math.max(0, width - text.length)) + text;

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
  const titleBrl = opts.title && opts.translate ? opts.translate(String(opts.title).toLowerCase()).trim() : null;

  const lines = [...contentLines];

  // Detect whether print page furniture is present in BANA mode
  const detectedPrintPages = opts.hasPrintPages || opts.initialPrintPageBrl != null || lines.some((l) => typeof l === 'string' && l.startsWith('"3-'));
  const hasFurniture = detectedPrintPages || Boolean(titleBrl);
  const perPage = linesPerPage(depth, hideHeader, mode, detectedPrintPages, Boolean(titleBrl));

  const pages = [];

  // For BANA mode: track print page state across braille pages
  let currentPrintPageBrl = opts.initialPrintPageBrl ?? null;
  let printPageStartBraillePage = 1;

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
        while (chunk.length < perPage) chunk.push('');
        const footLine = rightJustify(brailleNumber(pageNum), width);
        pages.push([...chunk, footLine]);
        lineIdx += perPage;
        continue;
      }

      let newPrintPageBrl = null;
      let newPrintPageMidPage = false;

      // 1. Check if lines[lineIdx] is a BANA transition line at top of page -> suppress in body
      if (typeof lines[lineIdx] === 'string' && lines[lineIdx].startsWith('"3-')) {
        const match = lines[lineIdx].match(/#?[A-Z0-9\-]+$/i);
        if (match) {
          currentPrintPageBrl = match[0];
          printPageStartBraillePage = pageNum;
        }
        lineIdx += 1;
      }

      const chunk = lines.slice(lineIdx, lineIdx + perPage);
      lineIdx += chunk.length;

      // 2. Check remaining lines in chunk for mid-page transitions
      for (let ci = 0; ci < chunk.length; ci++) {
        const l = chunk[ci];
        if (typeof l === 'string' && l.startsWith('"3-')) {
          const match = l.match(/#?[A-Z0-9\-]+$/i);
          if (match) {
            newPrintPageBrl = match[0];
            newPrintPageMidPage = true;
          }
        }
      }

      // Compute continuation index
      const continuationIdx = currentPrintPageBrl ? (pageNum - printPageStartBraillePage) : 0;
      const printPageHeader = currentPrintPageBrl ? formatPrintPageHeader(currentPrintPageBrl, continuationIdx) : null;

      const headLine = banaRunningHead(printPageHeader, titleBrl, width, pageNum);

      // Pad chunk to perPage so footer lands on line depth
      while (chunk.length < perPage) chunk.push('');
      const footLine = rightJustify(brailleNumber(pageNum), width);

      pages.push([headLine, ...chunk, footLine]);

      // If a new print page started mid-page on this braille page:
      if (newPrintPageBrl && newPrintPageMidPage) {
        currentPrintPageBrl = newPrintPageBrl;
        printPageStartBraillePage = pageNum;
      }
    } else {
      // UKAAF mode
      const chunk = lines.slice(lineIdx, lineIdx + perPage);
      pages.push([runningHead(pageNum, titleBrl, width), ...chunk]);
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
        const headLine = banaRunningHead(null, titleBrl, width, 1);
        const footLine = rightJustify(brailleNumber(1), width);
        const emptyChunk = Array(perPage).fill('');
        pages.push([headLine, ...emptyChunk, footLine]);
      }
    } else {
      pages.push([runningHead(1, titleBrl, width)]);
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

export { brailleNumber, continuationPrefix, formatPrintPageHeader, runningHead, banaRunningHead, assemble, toBRF, linesPerPage };
