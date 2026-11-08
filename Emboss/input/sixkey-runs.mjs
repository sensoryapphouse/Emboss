// Six-key braille runs (X9 / W16, Paul, 4 Nov 2026: A1, B1, C1, D1 and the later addition).
//
// A "run" is braille typed with the six keys (S D F / J K L) into the document. A run that REPLACED print (a selected word, or an
// equation) keeps that print with it, so the transcriber can see it and put it back; a run typed with nothing selected has no
// print. Both kinds are marked in the editor and saved with the document, and neither ever reaches the braille output: the cells
// are brailled exactly as typed, as before. This module holds the parts that need no editor or DOM, shared by the editor
// (web/editor/editor.mjs), the DTBook writer (input/nimas-export.mjs) and the reader (input/parse.mjs):
//
//   print      the replaced print: an array of parts, each a string (print text) or { latex, mathml? } (an equation)
//   segment    in the model a run is a text segment carrying `sixkey: { print? }` (like a link's `href`; the formatter ignores it)
//   sidecar    a paragraph kept as plain `text` (the usual case, so its braille is laid out exactly as before) carries its runs as
//              `sixkey: [{ start, end, print? }]`, offsets into that `text`; the writer turns it into segments
//   file       <span class="bana-sixkey" title='["word"]'>⠁⠃</span>; the title is the print as JSON (absent for a run with none)

const isEq = (p) => p && typeof p === 'object' && !Array.isArray(p) && (typeof p.latex === 'string' || typeof p.mathml === 'string');

/** Cleans a print: strings joined when adjacent, empty strings and anything that is not text or an equation dropped; null when nothing is left. */
export function normalizePrint(parts) {
  if (!Array.isArray(parts)) return null;
  const out = [];
  for (const p of parts) {
    if (typeof p === 'string') {
      if (!p) continue;
      if (typeof out[out.length - 1] === 'string') out[out.length - 1] += p; else out.push(p);
    } else if (isEq(p)) {
      const e = {};
      if (typeof p.latex === 'string' && p.latex) e.latex = p.latex;
      if (typeof p.mathml === 'string' && p.mathml) e.mathml = p.mathml;
      if (e.latex || e.mathml) out.push(e);
    }
  }
  return out.length ? out : null;
}

/** The print as plain text (an equation as its LaTeX in $…$), for a message, a tooltip or a screen reader. */
export function printText(parts) {
  const p = normalizePrint(parts);
  if (!p) return '';
  return p.map((x) => (typeof x === 'string' ? x : `$${x.latex || ''}$`)).join('');
}

/** The print as the text of the file's title attribute (JSON), or null when there is none. */
export function printToAttr(parts) {
  const p = normalizePrint(parts);
  return p ? JSON.stringify(p) : null;
}

/** Reads the title attribute back; null for nothing, or for text that is not a print (never throws). */
export function printFromAttr(str) {
  if (typeof str !== 'string' || !str.trim()) return null;
  try { return normalizePrint(JSON.parse(str)); } catch { return null; }
}

/**
 * The print a selection leaves behind when braille is typed over it. `pieces` are the selected pieces in order:
 *   { text }                       selected print text (or a line break as "\n")
 *   { latex, mathml? }             a selected equation
 *   { run: true, text, print?, whole }  a selected stretch of an earlier run; when the WHOLE run is selected and it has a print, that
 *                                  print is what is kept (the original, not the braille that replaced it); otherwise its cells are
 * Returns the normalised print, or null when nothing printable was selected.
 */
export function capturePrint(pieces) {
  const parts = [];
  for (const p of pieces || []) {
    if (!p) continue;
    if (p.run) {
      const kept = p.whole ? normalizePrint(p.print) : null;
      if (kept) parts.push(...kept); else if (p.text) parts.push(String(p.text));
    } else if (isEq(p)) parts.push(p);
    else if (typeof p.text === 'string' && p.text) parts.push(p.text);
  }
  const out = normalizePrint(parts);
  // Only blanks selected: nothing worth keeping
  if (out && out.every((x) => typeof x === 'string' && !x.trim())) return null;
  return out;
}

/** raw → { text: raw with whitespace runs as one space and the ends trimmed, map: for each raw offset 0…raw.length its offset in text }. */
export function collapseWithMap(raw) {
  raw = String(raw ?? '');
  let out = '';
  const map = new Array(raw.length + 1);
  let pendingSpace = false;
  for (let i = 0; i < raw.length; i++) {
    map[i] = out.length + (pendingSpace && out ? 1 : 0);
    if (/\s/.test(raw[i])) { pendingSpace = true; continue; }
    if (pendingSpace && out) out += ' ';
    pendingSpace = false;
    out += raw[i];
  }
  map[raw.length] = out.length;
  return { text: out, map };
}

/**
 * Runs measured in a paragraph's raw text → the same runs measured in the `text` the model carries for it.
 * `ranges` = [{ start, end, print? }] over `raw`; `exact` = the paragraph is typed braille only, whose text keeps its spaces
 * (only trailing blanks dropped), else spaces are collapsed and the ends trimmed. Runs left empty are dropped.
 */
export function sixkeyForText(raw, ranges, exact) {
  raw = String(raw ?? '');
  let text, map;
  if (exact) { text = raw.replace(/\s+$/, ''); map = null; }
  else ({ text, map } = collapseWithMap(raw));
  const sixkey = [];
  for (const r of ranges || []) {
    let s = map ? map[r.start] : r.start, e = map ? map[r.end] : r.end;
    s = Math.max(0, Math.min(s, text.length)); e = Math.max(0, Math.min(e, text.length));
    if (e <= s) continue;
    const run = { start: s, end: e };
    const print = normalizePrint(r.print);
    if (print) run.print = print;
    sixkey.push(run);
  }
  return { text, sixkey };
}

/** The sidecar (plain text + [{ start, end, print? }]) as text segments; `sixkey` is on the run's own segment. Overlaps and bad ranges are ignored. */
export function splitTextBySixkey(text, sixkey) {
  text = String(text ?? '');
  const runs = (Array.isArray(sixkey) ? sixkey : []).filter((r) => r && Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.end > r.start && r.end <= text.length)
    .sort((a, b) => a.start - b.start);
  const segs = [];
  let at = 0;
  for (const r of runs) {
    if (r.start < at) continue;
    if (r.start > at) segs.push({ type: 'text', text: text.slice(at, r.start) });
    const mark = {};
    const print = normalizePrint(r.print);
    if (print) mark.print = print;
    segs.push({ type: 'text', text: text.slice(r.start, r.end), sixkey: mark });
    at = r.end;
  }
  if (at < text.length) segs.push({ type: 'text', text: text.slice(at) });
  return segs;
}

/** Cuts a text into pieces at the runs: [{ text, run? }] where run is { print? } for a run's piece (the editor's loader uses it). */
export function piecesOfText(text, sixkey) {
  return splitTextBySixkey(text, sixkey).map((s) => (s.sixkey ? { text: s.text, run: s.sixkey } : { text: s.text }));
}
