// Braille layout primitives. Works on BRF ASCII braille (1 char = 1 cell).
// Rule citations refer to the Rule Register in SETUP_AND_VALIDATION.md.

// A fixed two-blank-cell gap (BANA 17.6.1c: entry word and definition, two blank cells apart).
// It travels through the braille stream as a word of its own, " GAP_CELL ", so the wrappers keep
// both blanks (they normally collapse every run of spaces to one) and drop the gap if the line
// breaks there.
const GAP_CELL = '\u0003';   // not \u0001/\u0002: those are LN_OPEN/LN_CLOSE (line numbers), and a gap sent a paragraph down the line-number wrapper (F-206 verification, 23 Sep)
// F-206 / BANA 14.6.2a, 15.5.2b: the same idea with three blank cells (a significant print gap after a speaker's name).
const GAP3_CELL = '\u0004';

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
  let gap = 0;                                     // a GAP_CELL word was just seen: the next join takes two blanks (GAP3_CELL: three)
  for (let w of words) {
    if (w === GAP_CELL || w === GAP3_CELL) { gap = cur !== '' ? (w === GAP3_CELL ? 3 : 2) : 0; continue; }
    const sepLen = gap || 1, sep = ' '.repeat(sepLen);
    gap = 0;
    // If a single word is longer than available width, hard-chunk it across lines.
    // S3a #31: a cursor `at` walks the word and only each emitted chunk is cut out of it (the tail used to be re-sliced for every
    // line, so a huge unbroken token took time quadratic in its length); the remainder is cut off once, after the loop.
    let at = 0;
    while (w.length - at > width - (cur === '' ? indent : runoverIndent)) {
      if (cur !== '') {
        lines.push(' '.repeat(Math.max(0, indent)) + cur);
        indent = runoverIndent;
        cur = '';
      }
      const chunkSize = Math.max(1, width - indent);
      lines.push(' '.repeat(Math.max(0, indent)) + w.slice(at, at + chunkSize));
      indent = runoverIndent;
      at += chunkSize;
    }
    if (at) w = w.slice(at);
    const avail = width - indent;
    if (cur === '') {
      cur = w;                                   // first word on the line
    } else if (cur.length + sepLen + w.length <= avail) {
      cur += sep + w;                            // fits
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
  let gap = 0;
  for (let k = 0; k < words.length; k++) {
    let w = words[k], ws = wsrc[k];
    if (w === GAP_CELL || w === GAP3_CELL) { gap = cur !== '' ? (w === GAP3_CELL ? 3 : 2) : 0; continue; }
    const sepLen = gap || 1;
    gap = 0;
    let at = 0;                                    // S3a #31: cursor into w/ws (see wrapCells) - no re-slicing of the whole tail per line
    while (w.length - at > width - (cur === '' ? indent : runoverIndent)) {
      if (cur !== '') {
        flush();
        indent = runoverIndent;
        cur = '';
        curSrc = [];
      }
      const chunkSize = Math.max(1, width - indent);
      cur = w.slice(at, at + chunkSize);
      curSrc = ws.slice(at, at + chunkSize);
      flush();
      indent = runoverIndent;
      at += chunkSize;
      cur = '';
      curSrc = [];
    }
    if (at) { w = w.slice(at); ws = ws.slice(at); }
    if (cur === '') { cur = w; curSrc = ws.slice(); }
    else if (cur.length + sepLen + w.length <= width - indent) { cur += ' '.repeat(sepLen) + w; for (let q = 0; q < sepLen; q++) curSrc.push(null); for (const x of ws) curSrc.push(x); }
    else { flush(); indent = runoverIndent; cur = w; curSrc = ws.slice(); }
  }
  if (cur !== '') flush();
  return { lines, srcs };
}

// Line-numbered text (BANA Formats §15.3–15.4; A30). A print line number travels in the
// braille stream as LN_OPEN + number + LN_CLOSE, a word of its own, in front of the word
// that begins the numbered print line. wrapNumbered() wraps the text so that
//  - the text ends at least two blank cells before the widest line number (numWidth)
//    (§15.3.1c), and the number stands at the right margin of the braille line on which
//    its print line begins (§15.3.1b); it is not repeated on runover lines (§15.3.1d);
//  - only one numbered print line begins on a braille line (§15.4.1e);
//  - a numbered print line that begins in the middle of a braille line is preceded by
//    three blank cells (§15.4.1c). Only the lines print numbers are known, so only those
//    are marked (a transcriber's note says so).
// `src` (optional) is the per-cell source array of the cell trace; the result is
// { lines, srcs } with srcs parallel to lines (null for spacing and numbers).
const LN_OPEN = String.fromCharCode(1), LN_CLOSE = String.fromCharCode(2);
const LN_ANY = new RegExp(`${LN_OPEN}([^${LN_CLOSE}]*)${LN_CLOSE}`, 'g');
const LN_WORD = new RegExp(`^${LN_OPEN}([^${LN_CLOSE}]*)${LN_CLOSE}$`);
const hasLineNumbers = (braille) => typeof braille === 'string' && braille.includes(LN_OPEN);
const stripLineNumbers = (braille) => String(braille).replace(new RegExp(`[ ]*${LN_OPEN}[^${LN_CLOSE}]*${LN_CLOSE}[ ]*`, 'g'), ' ').replace(/^ +| +$/g, '');
function lineNumberWidth(braille) {
  let w = 0;
  for (const m of String(braille).matchAll(LN_ANY)) w = Math.max(w, m[1].length);
  return w;
}
function wrapNumbered(braille, src, width, firstIndent, runoverIndent, numWidth) {
  width = Math.max(1, Number(width) || 38);
  const numW = Math.max(numWidth || 0, lineNumberWidth(braille));
  const textW = Math.max(8, width - numW - 2);
  firstIndent = Math.min(Math.max(0, firstIndent | 0), textW - 1);
  runoverIndent = Math.min(Math.max(0, runoverIndent | 0), textW - 1);
  // Words (with their sources) and forced breaks; a number attaches to the next word.
  const words = [];
  let pending = null;
  for (let i = 0; i < braille.length;) {
    const ch = braille[i];
    if (ch === ' ') { i++; continue; }
    if (ch === '\n') { words.push({ br: true }); i++; continue; }
    let j = i; while (j < braille.length && braille[j] !== ' ' && braille[j] !== '\n') j++;
    const w = braille.slice(i, j);
    const m = w.match(LN_WORD);
    if (m) pending = m[1];
    else {
      // A number glued inside a word (no space in print) still marks that word.
      let text = w, ks = [];
      for (let k = i; k < j; k++) ks.push(k);
      const a = w.indexOf(LN_OPEN);
      if (a >= 0) {
        const b = w.indexOf(LN_CLOSE, a) + 1;
        if (pending == null) pending = w.slice(a + 1, b - 1);
        text = w.slice(0, a) + w.slice(b);
        ks = ks.filter((_, x) => x < a || x >= b);
      }
      if (text) { words.push({ w: text, src: src ? ks.map((k) => src[k] ?? null) : [], num: pending }); pending = null; }
    }
    i = j;
  }
  if (pending != null) words.push({ w: '', src: [], num: pending });   // a number after the last word
  const lines = [], srcs = [];
  let indent = firstIndent, cur = '', curSrc = [], curNum = null;
  const flush = () => {
    let line = ' '.repeat(indent) + cur;
    const ls = [...Array(indent).fill(null), ...curSrc];
    if (curNum != null) {
      const pad = Math.max(2, width - curNum.length - line.length);
      line += ' '.repeat(pad) + curNum;
      ls.push(...Array(pad + curNum.length).fill(null));
    }
    lines.push(line); srcs.push(ls);
    cur = ''; curSrc = []; curNum = null; indent = runoverIndent;
  };
  const add = (w, ws) => {
    if (cur === '') { cur = w; curSrc = [...ws]; return; }
    cur += ' ' + w; curSrc.push(null, ...ws);
  };
  for (const x of words) {
    if (x.br) { if (cur || curNum != null) flush(); indent = runoverIndent; continue; }
    if (x.num != null) {
      // A second numbered print line on this braille line, or no room for the three blank
      // cells and the word: the numbered print line starts a new braille line.
      if (curNum != null || (cur !== '' && cur.length + 3 + x.w.length > textW - indent)) flush();
      curNum = x.num;
      if (!x.w) continue;
      if (cur === '') { cur = x.w; curSrc = [...x.src]; }
      else { cur += '   ' + x.w; curSrc.push(null, null, null, ...x.src); }
      continue;
    }
    let w = x.w, ws = x.src;
    let at = 0;                                                            // S3a #31: cursor into w/ws, not a re-slice of the tail per line
    while (w.length - at > textW - (cur === '' ? indent : runoverIndent)) {    // hard-chunk an over-long word
      if (cur !== '') flush();
      const size = Math.max(1, textW - indent);
      cur = w.slice(at, at + size); curSrc = ws.slice(at, at + size);
      flush();
      at += size;
    }
    if (at) { w = w.slice(at); ws = ws.slice(at); }
    if (!w) continue;
    if (cur === '' || cur.length + 1 + w.length <= textW - indent) add(w, ws);
    else { flush(); add(w, ws); }
  }
  if (cur !== '' || curNum != null) flush();
  return { lines, srcs };
}

// Counted words (BANA Formats §15.8.1a, F-208; Sample 15-9). Each count follows the print line it counts
// (the number is the words read at the END of that print line), so a marker word in the stream belongs to the
// word before it. The number stands at the right margin of the braille line on which the print line ENDS;
// three blank cells follow the end of a print line when more text follows on that braille line. The text stops
// two cells before the widest number, as in the rule's own Sample 15-9 (the rows there show a 2-cell minimum). A braille line carries one number: a print line that
// would end on a line already holding one starts a new line.
function wrapCounted(braille, src, width, firstIndent, runoverIndent, numWidth) {
  width = Math.max(1, Number(width) || 38);
  const numW = Math.max(numWidth || 0, lineNumberWidth(braille));
  const textW = Math.max(8, width - numW - 2);
  firstIndent = Math.min(Math.max(0, firstIndent | 0), textW - 1);
  runoverIndent = Math.min(Math.max(0, runoverIndent | 0), textW - 1);
  const words = [];
  for (let i = 0; i < braille.length;) {
    const ch = braille[i];
    if (ch === ' ') { i++; continue; }
    if (ch === '\n') { words.push({ br: true }); i++; continue; }
    let j = i; while (j < braille.length && braille[j] !== ' ' && braille[j] !== '\n') j++;
    const w = braille.slice(i, j);
    const m = w.match(LN_WORD);
    const prev = words[words.length - 1];
    if (m) { if (prev && !prev.br && prev.end == null) prev.end = m[1]; }
    else {
      let text = w, ks = [];
      for (let k = i; k < j; k++) ks.push(k);
      const a = w.indexOf(LN_OPEN);
      let end = null;
      if (a >= 0) {
        const b = w.indexOf(LN_CLOSE, a) + 1;
        end = w.slice(a + 1, b - 1);
        text = w.slice(0, a) + w.slice(b);
        ks = ks.filter((_, x) => x < a || x >= b);
      }
      if (text) words.push({ w: text, src: src ? ks.map((k) => src[k] ?? null) : [], end });
    }
    i = j;
  }
  words.forEach((x, i) => { if (!x.br) x.starts = i === 0 || words[i - 1].br || words[i - 1].end != null; });
  const lineLen = (i) => {                                    // width of the print line that starts at words[i], or Infinity if it never ends
    let n = 0;
    for (let k = i; k < words.length; k++) {
      if (words[k].br) return Infinity;
      n += words[k].w.length + (k > i ? 1 : 0);
      if (words[k].end != null) return n;
    }
    return Infinity;
  };
  const lines = [], srcs = [];
  let indent = firstIndent, cur = '', curSrc = [], curNum = null;
  const flush = () => {
    let line = ' '.repeat(indent) + cur;
    const ls = [...Array(indent).fill(null), ...curSrc];
    if (curNum != null) {
      const pad = Math.max(2, width - curNum.length - line.length);
      line += ' '.repeat(pad) + curNum;
      ls.push(...Array(pad + curNum.length).fill(null));
    }
    lines.push(line); srcs.push(ls);
    cur = ''; curSrc = []; curNum = null; indent = runoverIndent;
  };
  words.forEach((x, i) => {
    if (x.br) { if (cur || curNum != null) flush(); indent = runoverIndent; return; }
    if (cur !== '' && x.starts && curNum != null && lineLen(i) <= textW - indent - cur.length - 3) flush();
    let w = x.w, ws = x.src;
    let at = 0;                                                            // S3a #31: cursor into w/ws, not a re-slice of the tail per line
    while (w.length - at > textW - (cur === '' ? indent : runoverIndent)) {
      if (cur !== '') flush();
      const size = Math.max(1, textW - indent);
      cur = w.slice(at, at + size); curSrc = ws.slice(at, at + size);
      flush();
      at += size;
    }
    if (at) { w = w.slice(at); ws = ws.slice(at); }
    if (!w) return;
    let sep = cur === '' ? 0 : (x.starts ? 3 : 1);
    if (cur !== '' && cur.length + sep + w.length > textW - indent) { flush(); sep = 0; }
    if (x.end != null && curNum != null) { flush(); sep = 0; }
    if (sep) { cur += ' '.repeat(sep); curSrc.push(...Array(sep).fill(null)); }
    cur += w; curSrc.push(...ws);
    if (x.end != null) curNum = x.end;
  });
  if (cur !== '' || curNum != null) flush();
  return { lines, srcs };
}

export { GAP_CELL, GAP3_CELL, wrapCells, wrapCellsSrc, formatParagraph, LN_OPEN, LN_CLOSE, hasLineNumbers, stripLineNumbers, lineNumberWidth, wrapNumbered, wrapCounted };
