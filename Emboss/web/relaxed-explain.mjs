// Relaxed braille, Stage 3 (A91; Paul 3 Oct 2026, decisions F and I): making the ticks in use visible. Paul, 2 Nov 2026: relaxed braille is part of
// the template (one name), so both now name the TEMPLATE in use, not a reader profile. Pure helpers, no DOM, no
// settings; the pages (Quick Mode's header, the editor's braille pane and status bar) call them and put the words on screen.
//
//  F  templateLabelShown     - is "Template: <name>" shown where braille is made? Only with relaxed braille on, a UEB contracted code,
//                              and a template that relaxes something (ticks other than All: All is normal braille; nothing to flag).
//  I  spelledOutNote         - "ea, ch and er spelled out. Not in template: Sam.": which contractions of one word the template spelled
//                              out, from the spelledOut list relaxTranslation returns (translatePos of a relaxed translator).
//                              Paul's answers of 3 Oct 2026 (Stage 4): Q1 the template is named as "Not in template: Sam." (the name as
//                              stored, no quotes); Q2 shorter is better - when the whole word is ONE spelled-out sign (child,
//                              children, the) the word is not repeated: just "Spelled out. Not in template: Sam."
//
// The words come from the page's translator `tr(key, vars)` (web/contractions-ui.mjs: the page's t() with the English words as the
// fallback), so a translation in any locale file is used (keys app.relaxed.*).

/** The label is shown only with relaxed braille on, a UEB contracted code in force, and a template in force that relaxes something (`relaxes`: its ticks are not All). */
export function templateLabelShown({ enabled, relaxable, relaxes }) {
  return !!enabled && !!relaxable && !!relaxes;
}

/** The print of each sign that was spelled out, in word order, lower case, each once: [{start, chars}, ...] -> ['ea', 'ch', 'er']. */
export function spelledOutPrints(spelledOut) {
  if (!Array.isArray(spelledOut)) return [];
  const out = [];
  const seen = new Set();
  for (const s of [...spelledOut].sort((a, b) => (a.start || 0) - (b.start || 0))) {
    const p = String(s && s.chars != null ? s.chars : '').toLowerCase();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/** 'ea' / 'ea and er' / 'ea, ch and er' (no comma before the last "and"). `andWord` is the page's word for "and". */
export function joinList(items, andWord = 'and') {
  const a = (items || []).filter((x) => x !== '');
  if (a.length <= 1) return a.join('');
  return `${a.slice(0, -1).join(', ')} ${andWord} ${a[a.length - 1]}`;
}

/** True when the spelled-out list is ONE sign that stands for the whole word (its letters; punctuation round the word does not count). */
function isWholeWord(spelledOut, word) {
  if (!Array.isArray(spelledOut) || spelledOut.length !== 1) return false;
  const s = spelledOut[0];
  let from = s.wordStart, to = s.wordEnd;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (typeof word === 'string' && word.length >= to) {
    const slice = word.slice(from, to);
    const first = slice.search(/[\p{L}\p{N}]/u);
    if (first < 0) return false;
    let last = slice.length - 1;
    while (last > first && !/[\p{L}\p{N}]/u.test(slice[last])) last--;
    to = from + last + 1;
    from += first;
  } else if (typeof word === 'string' && word) {
    return false;                                  // the word given does not fit the positions: say the sign, never guess
  }
  return s.start === from && s.end === to;
}

/**
 * The sentence for the status bar and for the spoken description: "ea and er spelled out. Not in template: Sam." (Q1), or, when the
 * whole word is one spelled-out sign, "Spelled out. Not in template: Sam." (Q2). '' when nothing was spelled out (All, relaxed
 * braille off, or a word whose contractions the template holds). `word` (optional): the text that was translated, so that attached
 * punctuation ("the,") is not mistaken for part of the word; without it the word's extent as relaxTranslation reported it is used.
 */
export function spelledOutNote(spelledOut, templateName, tr, word) {
  const prints = spelledOutPrints(spelledOut);
  if (!prints.length) return '';
  if (isWholeWord(spelledOut, word)) return tr('app.relaxed.spelled_out_word', { name: templateName });
  return tr('app.relaxed.spelled_out', { signs: joinList(prints, tr('app.relaxed.and')), name: templateName });
}
