// Braille layout primitives. Works on BRF ASCII braille (1 char = 1 cell).
// Rule citations refer to the Rule Register in SETUP_AND_VALIDATION.md.

// Greedy word-wrap into a fixed cell width, honouring a first-line indent and a
// (possibly different) runover indent. Words are never split. Braille words are
// separated by single spaces in the translated stream.
function wrapCells(braille, width = 38, firstIndent = 0, runoverIndent = 0) {
  if (!braille) return [];
  // Clamp indents INTO the page (indent <= width-1). An over-deep list level or a
  // bad caller value must narrow the text, never widen the line past the width.
  width = Math.max(1, Number(width) || 38);
  firstIndent = Math.min(Math.max(0, Number(firstIndent) || 0), width - 1);
  runoverIndent = Math.min(Math.max(0, Number(runoverIndent) || 0), width - 1);
  if (braille.includes('\n')) {
    const paragraphs = braille.split('\n');
    const allLines = [];
    paragraphs.forEach((p, idx) => {
      if (!p) {
        allLines.push('');
      } else {
        const curFirst = idx === 0 ? firstIndent : runoverIndent;
        allLines.push(...wrapCells(p, width, curFirst, runoverIndent));
      }
    });
    return allLines;
  }
  const words = braille.split(' ').filter((w) => w.length > 0);
  const lines = [];
  let indent = firstIndent;
  let cur = '';
  for (let w of words) {
    // If a single word is longer than available width, hard-chunk it across lines
    while (w.length > width - (cur === '' ? indent : runoverIndent)) {
      if (cur !== '') {
        lines.push(' '.repeat(Math.max(0, indent)) + cur);
        indent = runoverIndent;
        cur = '';
      }
      const chunkSize = Math.max(1, width - indent);
      lines.push(' '.repeat(Math.max(0, indent)) + w.slice(0, chunkSize));
      indent = runoverIndent;
      w = w.slice(chunkSize);
    }
    const avail = width - indent;
    if (cur === '') {
      cur = w;                                   // first word on the line
    } else if (cur.length + 1 + w.length <= avail) {
      cur += ' ' + w;                            // fits
    } else {
      lines.push(' '.repeat(indent) + cur);      // flush line
      indent = runoverIndent;
      cur = w;
    }
  }
  if (cur !== '') lines.push(' '.repeat(indent) + cur);
  return lines;
}

// Format a plain-text paragraph: translate the whole paragraph (so contractions
// get correct context), then wrap. UKAAF/BANA paragraphs are 3-1 (R1): first
// line cell 3 (indent 2), runovers cell 1 (indent 0).
function formatParagraph(text, translate, opts = {}) {
  const width = opts.width ?? 38;
  const first = opts.first ?? 2;                 // cell 3
  const runover = opts.runover ?? 0;             // cell 1
  return wrapCells(translate(text), width, first, runover);
}

// Traced sibling of wrapCells: wraps `braille` IDENTICALLY (same greedy packing,
// same indents) while carrying a parallel per-cell source array `src` through the
// wrap. Returns { lines, srcs } where lines[i] === wrapCells(...)[i] byte-for-byte
// and srcs[i] is parallel to lines[i] (null for indent + inter-word join spaces).
// Used only by the cell-trace (editor linking); the gold path uses wrapCells.
function wrapCellsSrc(braille, src, width, firstIndent, runoverIndent) {
  firstIndent = Math.min(Math.max(0, firstIndent | 0), Math.max(0, width - 1));
  runoverIndent = Math.min(Math.max(0, runoverIndent | 0), Math.max(0, width - 1));
  if (braille.includes('\n')) {
    const allLines = [], allSrcs = [];
    let start = 0;
    const parts = braille.split('\n');
    parts.forEach((part, idx) => {
      const subSrc = src ? src.slice(start, start + part.length) : [];
      start += part.length + 1;
      if (!part) {
        allLines.push('');
        allSrcs.push([]);
      } else {
        const curFirst = idx === 0 ? firstIndent : runoverIndent;
        const { lines, srcs } = wrapCellsSrc(part, subSrc, width, curFirst, runoverIndent);
        allLines.push(...lines);
        allSrcs.push(...srcs);
      }
    });
    return { lines: allLines, srcs: allSrcs };
  }
  const words = [], wsrc = [];
  for (let i = 0; i < braille.length;) {
    if (braille[i] === ' ') { i++; continue; }
    let j = i; while (j < braille.length && braille[j] !== ' ') j++;
    words.push(braille.slice(i, j)); wsrc.push(src ? src.slice(i, j) : []); i = j;
  }
  const lines = [], srcs = [];
  let indent = firstIndent, cur = '', curSrc = [];
  const flush = () => { lines.push(' '.repeat(indent) + cur); const ls = []; for (let k = 0; k < indent; k++) ls.push(null); for (const x of curSrc) ls.push(x); srcs.push(ls); };
  for (let k = 0; k < words.length; k++) {
    let w = words[k], ws = wsrc[k];
    while (w.length > width - (cur === '' ? indent : runoverIndent)) {
      if (cur !== '') {
        flush();
        indent = runoverIndent;
        cur = '';
        curSrc = [];
      }
      const chunkSize = Math.max(1, width - indent);
      cur = w.slice(0, chunkSize);
      curSrc = ws.slice(0, chunkSize);
      flush();
      indent = runoverIndent;
      w = w.slice(chunkSize);
      ws = ws.slice(chunkSize);
      cur = '';
      curSrc = [];
    }
    if (cur === '') { cur = w; curSrc = ws.slice(); }
    else if (cur.length + 1 + w.length <= width - indent) { cur += ' ' + w; curSrc.push(null); for (const x of ws) curSrc.push(x); }
    else { flush(); indent = runoverIndent; cur = w; curSrc = ws.slice(); }
  }
  if (cur !== '') flush();
  return { lines, srcs };
}

export { wrapCells, wrapCellsSrc, formatParagraph };
