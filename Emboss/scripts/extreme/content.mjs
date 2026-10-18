// Content generators for the extreme-document test set (A89 step 4; see ../check-extreme-documents.mjs).
//
// Everything here is DETERMINISTIC: a seeded PRNG (mulberry32) and no clocks, so `--seed N` always produces the same
// bytes. A document is first built as a small neutral "IR" (an iterable of blocks), then written out as NIMAS, HTML,
// Markdown, text, DOCX, RTF, ODT or EPUB by ./emit.mjs. IR blocks:
//   { t:'h', level, text }
//   { t:'p', parts:[ string | { m: mathObj } | { ref: noteId } ] }       paragraph; parts mix text, inline maths, note refs
//   { t:'list', ordered, items:[ { parts, sub: list|null } ] }            nested lists
//   { t:'table', rows:[ [ cell ] ] }                                     cell = { text, colspan?, rowspan?, header?, table? }
//   { t:'pagenum', n }                                                   a print page number
//   { t:'note', id, text }                                               a footnote body
//   { t:'math', m: mathObj }                                             a display equation
// colspan/rowspan may be ANY value (0, -1, 99999, 'abc'): emitters print them raw, which is how the span chaos is made.
// mathObj = { latex, mml (inner MathML, no <math> wrapper), omml (inner OMML), text }.

// ---------- PRNG ----------
export function makeRng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = () => next();
  rng.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));      // inclusive
  rng.pick = (arr) => arr[Math.floor(next() * arr.length)];
  rng.chance = (p) => next() < p;
  return rng;
}

// ---------- English text ----------
const WORDS = (
  'the of and to in is that it was for on are as with his they at be this from have or by one had not but what all were when we there can an your which their said if do will each about how up out them then she many some so these would other into has more her two like him see time could no make than first been its who now people my made over did down only way find use may water long little very after words called just where most know get through back much before go good new write our me man too any day same right look think also around another came come work three word must because does part even place well such here take why help put different away again off went old number great tell men say small every found still between name should home big give air line set own under read last never us left end along while might next sound below saw something thought both few those always looked show large often together asked house don\'t world going want school important until form food keep children feet land side without boy once animals life enough took sometimes four head above kind began almost live page got earth need far hand high year mother light country father let night picture being study second soon story since white ever paper hard near sentence better best across during today however sure knew try told young sun thing whole hear example heard several change answer room sea against top turned learn point city play toward five using himself usually'
).split(' ');

export function sentence(rng, min = 6, max = 16) {
  const n = rng.int(min, max);
  const out = [];
  for (let i = 0; i < n; i++) {
    let w = rng.pick(WORDS);
    if (i === 0) w = w[0].toUpperCase() + w.slice(1);
    else if (rng.chance(0.015)) w = String(rng.int(1, 2026));
    else if (rng.chance(0.01)) w = `“${w}”`;
    out.push(w);
    if (i < n - 1 && rng.chance(0.07)) out[out.length - 1] += ',';
  }
  return out.join(' ') + (rng.chance(0.1) ? '?' : '.');
}
export function paragraphText(rng, minS = 2, maxS = 6) {
  const n = rng.int(minS, maxS);
  const s = [];
  for (let i = 0; i < n; i++) s.push(sentence(rng));
  return s.join(' ');
}
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
export function randomLetters(rng, n) {
  // built in chunks: String concatenation of 1e6 single chars is fine in V8 (ropes), but join is steadier
  const parts = [];
  for (let i = 0; i < n; i += 4096) {
    const m = Math.min(4096, n - i);
    let s = '';
    for (let k = 0; k < m; k++) s += LETTERS[Math.floor(rng() * 26)];
    parts.push(s);
  }
  return parts.join('');
}

// ---------- maths ----------
const VARS = ['x', 'y', 'z', 'a', 'b', 'c', 'n', 'm', 't'];
const r = (t) => `<m:r><m:t>${t}</m:t></m:r>`;
export function mathObj(rng) {
  const a = rng.pick(VARS), b = rng.pick(VARS), n = rng.int(2, 9), k = rng.int(1, 99);
  switch (rng.int(0, 7)) {
    case 0: return { latex: `${a}^{${n}}+${b}`, mml: `<msup><mi>${a}</mi><mn>${n}</mn></msup><mo>+</mo><mi>${b}</mi>`, omml: `<m:sSup><m:e>${r(a)}</m:e><m:sup>${r(n)}</m:sup></m:sSup>${r('+' + b)}`, text: `${a}^${n}+${b}` };
    case 1: return { latex: `\\frac{${a}}{${n}}`, mml: `<mfrac><mi>${a}</mi><mn>${n}</mn></mfrac>`, omml: `<m:f><m:num>${r(a)}</m:num><m:den>${r(n)}</m:den></m:f>`, text: `${a}/${n}` };
    case 2: return { latex: `\\sqrt{${a}^2+${b}^2}`, mml: `<msqrt><msup><mi>${a}</mi><mn>2</mn></msup><mo>+</mo><msup><mi>${b}</mi><mn>2</mn></msup></msqrt>`, omml: `<m:rad><m:deg/><m:e>${r(a + '^2+' + b + '^2')}</m:e></m:rad>`, text: `sqrt(${a}^2+${b}^2)` };
    case 3: return { latex: `${k}${a}+${n}=${k * n}`, mml: `<mn>${k}</mn><mi>${a}</mi><mo>+</mo><mn>${n}</mn><mo>=</mo><mn>${k * n}</mn>`, omml: r(`${k}${a}+${n}=${k * n}`), text: `${k}${a}+${n}=${k * n}` };
    case 4: return { latex: `${a}_{${n}}`, mml: `<msub><mi>${a}</mi><mn>${n}</mn></msub>`, omml: `<m:sSub><m:e>${r(a)}</m:e><m:sub>${r(n)}</m:sub></m:sSub>`, text: `${a}_${n}` };
    case 5: return { latex: `\\sum_{i=1}^{${n}} i`, mml: `<munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mn>${n}</mn></munderover><mi>i</mi>`, omml: `<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${r('i=1')}</m:sub><m:sup>${r(n)}</m:sup><m:e>${r('i')}</m:e></m:nary>`, text: `sum i=1..${n} i` };
    case 6: return { latex: `\\frac{${a}+${b}}{${n}}-${k}`, mml: `<mfrac><mrow><mi>${a}</mi><mo>+</mo><mi>${b}</mi></mrow><mn>${n}</mn></mfrac><mo>-</mo><mn>${k}</mn>`, omml: `<m:f><m:num>${r(a + '+' + b)}</m:num><m:den>${r(n)}</m:den></m:f>${r('-' + k)}`, text: `(${a}+${b})/${n}-${k}` };
    default: return { latex: `\\pi r^{2}`, mml: `<mi>π</mi><msup><mi>r</mi><mn>2</mn></msup>`, omml: `${r('π')}<m:sSup><m:e>${r('r')}</m:e><m:sup>${r('2')}</m:sup></m:sSup>`, text: 'pi r^2' };
  }
}

// ---------- block builders ----------
const P = (...parts) => ({ t: 'p', parts });
const para = (rng, a = 2, b = 6) => P(paragraphText(rng, a, b));

function simpleList(rng, ordered, n, sub) {
  const items = [];
  for (let i = 0; i < n; i++) items.push({ parts: [sentence(rng, 3, 10)], sub: sub && i === 1 ? simpleList(rng, !ordered, 3, null) : null });
  return { t: 'list', ordered, items };
}
function simpleTable(rng, rows, cols, opts = {}) {
  const out = [];
  for (let i = 0; i < rows; i++) {
    const row = [];
    for (let j = 0; j < cols; j++) {
      const header = i === 0;
      const empty = opts.emptyP && rng.chance(opts.emptyP);
      row.push({ text: empty ? '' : (header ? `Col ${j + 1}` : (rng.chance(0.4) ? String(rng.int(0, 9999)) : rng.pick(WORDS))), header });
    }
    out.push(row);
  }
  return { t: 'table', rows: out };
}

// A book: chapters of headings, paragraphs, lists, tables, print page numbers, notes and some maths, until about `targetChars`
// characters of text exist. (Emitters add markup: the NIMAS file comes out about 1.3x larger than the text.)
export function* bookBlocks(rng, { targetChars, math = true, tables = true } = {}) {
  let chars = 0, page = 1, noteId = 0, chapter = 0;
  const count = (b) => { chars += 60; return b; };
  while (chars < targetChars) {
    chapter++;
    const h = { t: 'h', level: 1, text: `Chapter ${chapter}: ${sentence(rng, 2, 5).replace(/[.?]$/, '')}` };
    chars += h.text.length; yield h;
    const sections = rng.int(2, 5);
    for (let s = 0; s < sections; s++) {
      const h2 = { t: 'h', level: 2, text: sentence(rng, 2, 6).replace(/[.?]$/, '') };
      chars += h2.text.length; yield h2;
      const blocks = rng.int(4, 10);
      for (let b = 0; b < blocks; b++) {
        const x = rng();
        if (x < 0.62) {
          const parts = [paragraphText(rng, 2, 7)];
          if (math && rng.chance(0.08)) parts.push(' where ', { m: mathObj(rng) }, ' holds. ');
          let note = null;
          if (rng.chance(0.06)) { note = `n${++noteId}`; parts.push({ ref: note }); }
          yield count({ t: 'p', parts });
          chars += parts.reduce((n, p) => n + (typeof p === 'string' ? p.length : 10), 0);
          if (note) { const nt = sentence(rng, 5, 14); chars += nt.length; yield { t: 'note', id: note, text: nt }; }
        } else if (x < 0.75) {
          const l = simpleList(rng, rng.chance(0.5), rng.int(3, 9), rng.chance(0.3));
          chars += l.items.length * 70; yield count(l);
        } else if (x < 0.83 && tables) {
          const t = simpleTable(rng, rng.int(3, 9), rng.int(2, 5));
          chars += t.rows.length * t.rows[0].length * 12; yield count(t);
        } else if (x < 0.88 && math) {
          yield count({ t: 'math', m: mathObj(rng) });
        } else {
          const q = para(rng, 1, 3); chars += 200; yield count(q);
        }
        if (rng.chance(0.18)) yield { t: 'pagenum', n: ++page };
      }
    }
  }
}

// n inline equations, 4 per paragraph, a heading every 100 paragraphs.
export function* equationBlocks(rng, n) {
  let made = 0, p = 0;
  while (made < n) {
    if (p % 100 === 0) yield { t: 'h', level: 1, text: `Equations ${p / 100 + 1}` };
    const parts = [];
    const k = Math.min(4, n - made);
    for (let i = 0; i < k; i++) { parts.push(sentence(rng, 2, 5).replace(/\.$/, ' '), { m: mathObj(rng) }, ' '); made++; }
    parts.push('end.');
    yield { t: 'p', parts };
    p++;
  }
}

// The table zoo: `count` tables in all, cycling through the kinds below, plus one 5,000-row table and several 60-column ones.
// Mild junk only (up to 1000): the huge values (100,000 and over, which crash or hang the readers and formatter) are case 03b's own battery.
export const SPAN_JUNK = [0, -1, -5, 99, 1000, 'abc', '', 2];
export function* tableBlocks(rng, count, { tallRows = 5000 } = {}) {
  const kinds = ['tiny', 'normal', 'wide', 'empty', 'chaos', 'nested', 'normal', 'tiny'];
  yield { t: 'h', level: 1, text: 'Tables' };
  for (let i = 0; i < count; i++) {
    if (i % 25 === 0) yield { t: 'p', parts: [sentence(rng)] };
    if (i === 3) { yield simpleTable(rng, tallRows, 3); continue; }          // tall
    const kind = kinds[i % kinds.length];
    let t;
    switch (kind) {
      case 'tiny': t = rng.chance(0.5) ? { t: 'table', rows: [[{ text: rng.pick(WORDS) }]] } : simpleTable(rng, 2, 2); break;
      case 'wide': t = simpleTable(rng, rng.int(2, 4), 60); break;                        // too wide for any page: listed/paragraph fallback
      case 'empty': t = simpleTable(rng, rng.int(3, 8), rng.int(2, 6), { emptyP: 0.6 }); if (i % 16 === 3) t.rows = [[], [{ text: '' }], []]; break;
      case 'chaos': {
        t = simpleTable(rng, rng.int(3, 7), rng.int(3, 6));
        for (const row of t.rows) for (const c of row) {
          if (rng.chance(0.3)) c.colspan = rng.pick(SPAN_JUNK);
          if (rng.chance(0.3)) c.rowspan = rng.pick(SPAN_JUNK);
        }
        if (rng.chance(0.5)) t.rows[0][0].colspan = 1000;                                   // far past the table edge
        break;
      }
      case 'nested': {
        t = simpleTable(rng, 3, 3);
        let inner = simpleTable(rng, 2, 2);
        const depth = rng.int(1, 4);
        for (let d = 0; d < depth; d++) { const outer = simpleTable(rng, 2, 2); outer.rows[1][1] = { text: 'x', table: inner }; inner = outer; }
        t.rows[1][1] = { text: 'nested', table: inner };
        break;
      }
      default: t = simpleTable(rng, rng.int(3, 12), rng.int(2, 6));
    }
    yield t;
  }
}

// Lists nested `depth` deep (alternating bullets and numbers, a long item every few levels), `chains` times, and a flat 10,000-item list.
export function* listBlocks(rng, { depth, chains = 5, flat = 10000 }) {
  yield { t: 'h', level: 1, text: `Lists nested ${depth} deep` };
  for (let c = 0; c < chains; c++) {
    let node = null;
    for (let d = depth; d >= 1; d--) {
      const long = d % 7 === 0 ? paragraphText(rng, 8, 14) : sentence(rng, 3, 9);
      const items = [{ parts: [long], sub: node }];
      if (d % 3 === 0) items.push({ parts: [sentence(rng, 2, 5)], sub: null });
      node = { t: 'list', ordered: (d + c) % 2 === 0, items };
    }
    yield node;
    yield { t: 'p', parts: [sentence(rng)] };
  }
  if (flat) {
    const items = [];
    for (let i = 0; i < flat; i++) items.push({ parts: [sentence(rng, 3, 8)], sub: null });
    yield { t: 'list', ordered: true, items };
  }
}

export function* headingBlocks(rng, n) {
  let level = 1;
  for (let i = 0; i < n; i++) {
    level = Math.max(1, Math.min(6, level + rng.pick([-2, -1, 0, 1, 1, 1])));
    yield { t: 'h', level, text: `${rng.pick(WORDS)} ${rng.pick(WORDS)} ${i + 1}` };
  }
}
export function* longHeadingBlocks(rng, chars) {
  const words = [];
  let n = 0;
  while (n < chars) { const w = rng.pick(WORDS); words.push(w); n += w.length + 1; }
  yield { t: 'h', level: 1, text: words.join(' ').slice(0, chars) };
  yield { t: 'p', parts: [sentence(rng)] };
}

// Pathological text.
export function* hugeParagraphBlocks(rng, chars) {
  yield { t: 'h', level: 1, text: 'One huge paragraph' };
  yield { t: 'p', parts: [randomLetters(rng, chars)] };
  yield { t: 'p', parts: ['The end.'] };
}
export function* longWordBlocks(rng, letters) {
  yield { t: 'h', level: 1, text: 'A very long word' };
  yield { t: 'p', parts: [`Before ${randomLetters(rng, letters)} after.`] };
  yield { t: 'p', parts: [`${'a'.repeat(letters)}`] };
}
export function* tinyParagraphBlocks(rng, n) {
  yield { t: 'h', level: 1, text: 'Tiny paragraphs' };
  for (let i = 0; i < n; i++) yield { t: 'p', parts: [LETTERS[i % 26]] };
}

// ---------- Unicode categories ----------
const cp = (...codes) => String.fromCodePoint(...codes);
const range = (lo, hi) => (rng) => cp(rng.int(lo, hi));
function words(rng, gen, wordLen, nWords) {
  const out = [];
  for (let i = 0; i < nWords; i++) { let w = ''; const L = rng.int(wordLen[0], wordLen[1]); for (let k = 0; k < L; k++) w += gen(rng); out.push(w); }
  return out.join(' ');
}
const COMBINING = Array.from({ length: 112 }, (_, i) => cp(0x300 + i));
const ZERO_WIDTH = ['​', '‌', '‍', '‎', '‏', '⁠', '⁡', '⁢', '⁣', '⁤', '﻿', '­', '‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩', '؜', '᠎', '͏'];
const EMOJI = ['\u{1F600}', '\u{1F44D}', '\u{1F680}', '\u{1F9D1}‍\u{1F680}', '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}', '\u{1F3F3}️‍\u{1F308}', '\u{1F1EC}\u{1F1E7}', '\u{1F1FA}\u{1F1F8}', '\u{1F44B}\u{1F3FD}', '1️⃣', '❤️', '\u{1F9D1}\u{1F3FF}‍\u{1F9B0}', '\u{1FAE0}', '©️'];
export const UNICODE_CATEGORIES = {
  hebrew: (rng) => words(rng, (g) => (g.chance(0.15) ? cp(g.int(0x5b0, 0x5c7)) : cp(g.int(0x5d0, 0x5ea))), [2, 7], 40),
  arabic: (rng) => words(rng, (g) => (g.chance(0.15) ? cp(g.int(0x64b, 0x652)) : cp(g.int(0x621, 0x64a))), [2, 7], 40),
  bidi_mixed: (rng) => {
    const seg = [];
    for (let i = 0; i < 12; i++) {
      const k = rng.int(0, 5);
      seg.push(k === 0 ? sentence(rng, 2, 5) : k === 1 ? words(rng, range(0x5d0, 0x5ea), [2, 5], 4) : k === 2 ? words(rng, range(0x621, 0x64a), [2, 5], 4)
        : k === 3 ? `‫${sentence(rng, 2, 4)}‬` : k === 4 ? `‮${words(rng, range(0x41, 0x5a), [3, 6], 3)}‭` : `⁧${rng.int(10, 99999)}⁩ ‏‎`);
    }
    return seg.join(' ');
  },
  zalgo: (rng) => {
    let s = '';
    for (let w = 0; w < 25; w++) { for (let k = 0; k < rng.int(3, 8); k++) { s += LETTERS[rng.int(0, 25)]; for (let c = 0; c < 50; c++) s += COMBINING[rng.int(0, COMBINING.length - 1)]; } s += ' '; }
    return s;
  },
  emoji: (rng) => { let s = ''; for (let i = 0; i < 40; i++) s += rng.pick(EMOJI) + (rng.chance(0.4) ? ' ' : '') + (rng.chance(0.2) ? rng.pick(WORDS) + ' ' : ''); return s; },
  astral: (rng) => {
    const planes = [[0x1d400, 0x1d7ff], [0x10000, 0x1000b], [0x20000, 0x2a6df], [0x1f300, 0x1f5ff], [0x10400, 0x1044f], [0x1d100, 0x1d126], [0xe0100, 0xe01ef]];
    let s = '';
    for (let i = 0; i < 60; i++) { const [lo, hi] = rng.pick(planes); s += cp(rng.int(lo, hi)) + (rng.chance(0.2) ? ' ' : ''); }
    return s + ' \u{10FFFF}\u{10FFFE}';
  },
  zero_width: (rng) => { let s = ''; for (let i = 0; i < 40; i++) { s += rng.pick(WORDS); for (let k = 0; k < rng.int(0, 4); k++) s += rng.pick(ZERO_WIDTH); s += ' '; } return s; },
  controls: (rng) => {
    let s = '';
    for (let i = 0; i < 40; i++) {
      s += rng.pick(WORDS);
      const c = rng.int(0, 3);
      s += c === 0 ? cp(rng.pick([0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31])) : c === 1 ? cp(rng.int(0x80, 0x9f)) : c === 2 ? '\x7f' : '\u0000';
      s += ' ';
    }
    return s;
  },
  mid_bom: (rng) => `${sentence(rng)}﻿${sentence(rng)}﻿﻿${rng.pick(WORDS)}﻿x`,
  noncharacters: (rng) => { let s = ''; for (let i = 0; i < 30; i++) s += rng.pick(WORDS) + rng.pick(['￾', '￿', '﷐', '﷯', '\u{1fffe}', '\u{10ffff}', '\u{2ffff}', '�']) + ' '; return s; },
  cjk: (rng) => words(rng, (g) => cp(g.chance(0.8) ? g.int(0x4e00, 0x9fff) : g.chance(0.5) ? g.int(0x3041, 0x3096) : g.int(0xac00, 0xd7a3)), [2, 6], 30) + '。',
  no_table_script: (rng) => words(rng, (g) => cp(g.pick([g.int(0x13000, 0x1342e), g.int(0x12000, 0x12399), g.int(0x1680, 0x169a), g.int(0x16a0, 0x16ea), g.int(0x1200, 0x1248), g.int(0x1100, 0x11ff), g.int(0x0f40, 0x0f6c)])), [2, 6], 40),
};
// Lone surrogates cannot live in a UTF-8 file (they become U+FFFD or invalid bytes); they are used by the model-level items.
export const LONE_SURROGATES = (rng) => `${sentence(rng, 2, 4)} \ud800 ${rng.pick(WORDS)} \udc00\ud800 ${rng.pick(WORDS)} \udfff end \ud83d`;

export function* unicodeBlocks(rng, categories, paragraphsPerCategory = 60) {
  yield { t: 'h', level: 1, text: 'Unicode stress document' };
  for (const name of categories) {
    yield { t: 'h', level: 2, text: `Section ${name}` };
    for (let i = 0; i < paragraphsPerCategory; i++) yield { t: 'p', parts: [UNICODE_CATEGORIES[name](rng)] };
    yield { t: 'p', parts: ['Plain ASCII paragraph after the stress section.'] };
  }
}

// Collects an IR iterable into an array (callers that need two passes).
export const toArray = (it) => Array.from(it);
export { WORDS };
