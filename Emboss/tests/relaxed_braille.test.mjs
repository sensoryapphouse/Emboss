// Relaxed braille, task 2 (A91): the relaxing step (Emboss/format/relaxed-braille.mjs) that sits on top of a translatePos result and
// spells out every contraction the reader's profile does not hold. New file, so there is no earlier expectation to change.
// It was first run before relaxed-braille.mjs existed and failed (ERR_MODULE_NOT_FOUND). Everything is checked against the real
// liblouis en-ueb-g2 table, not a stub (except where a test says it feeds in bad positions on purpose).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { relaxTranslation, spelledOutSigns } from '../format/relaxed-braille.mjs';
import { UEB_CONTRACTION_SIGNS, segmentWord, identifySigns } from '../format/relaxed-signs.mjs';
import { unicodeBrailleToBrf } from '../engine/brf-ascii.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const louis = await import('../engine/louis.mjs');
await louis.init(path.join(HERE, '..', 'liblouis', 'tables'));
const tp = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf);
const ALL_KEYS = UEB_CONTRACTION_SIGNS.map((s) => s.key);
const only = (...keys) => new Set(keys);
const allBut = (...keys) => new Set(ALL_KEYS.filter((k) => !keys.includes(k)));
const NONE = new Set();
const relax = (text, allowed, tf) => relaxTranslation(text, tp(text, tf), allowed, { translatePos: tp });
const out = (text, allowed, tf) => relax(text, allowed, tf).braille;
const fullBrf = (text, tf) => tp(text, tf).braille;

// ---- the sweep: every word the task 1 tests use, every catalogue print, and real paragraphs -------------------------------------------

const WORDS = [
  'teacher', 'Teacher', 'TEACHER', 'TEACHERs', 'teacher,', '(children)', '"the"', 'be;', 'be', 'begin', 'become', 'betray', 'belong', 'behind',
  'rabbit', 'accept', 'contain', 'dismiss', 'dismiss.', 'different', 'yes!', 'why?', 'his', 'his,', 'was', 'were', 'enough', 'into', 'in',
  'mother', 'Mother', 'Wednesday', 'however', 'godfather', 'adhere', 'known', 'landlord', 'surname', 'money', 'apart', 'bright', 'handsome',
  'pastime', 'thunder', 'network', 'youngster', 'there', 'character', 'throughout', 'somewhere', 'thought', 'upon', 'password', 'spirited',
  'worldwide', 'ground', 'dance', 'vision', 'careless', 'mount', 'fence', 'long', 'careful', 'kindness', 'moment', 'city', 'nation',
  'about', 'because', 'afternoon', 'little', 'children', 'Children', 'CHILDREN', 'together', "friend's", 'friends', "children's", 'blindfast',
  'cat', 'mad', 'dog', 'jump', 'pig', 'bat', 'fix', 'zip', '5', '12', '2024', 'a1', 'A1', 'x', 'z', 'b', 'x-ray', 'adherent', 'northeast',
  'thence', 'ARound', 'ARab', 'PDFs', 'McDonald', 'iPhone', "don't", 'well-known', 'C.A.T.', '1st', 'abandonee', 'ACtionably', 'captainess',
  "NATO's", '(b)', '"said,"', 'wherever', 'sing', 'cow', 'star', 'stop', 'thing', 'when', 'needed', 'ouch', 'sheep', 'ghost', 'tend', 'baggage',
  '3rd', 'COVID-19', 'e-mail', "o'clock", 'the', 'THE', 'and', 'for', 'of', 'with', 'but', 'can', 'so:', 'tea', 'tea,', 'lord', 'one', 'questionable',
];
const PRINTS = [...new Set(UEB_CONTRACTION_SIGNS.map((s) => s.print))];
const SWEEP = [...new Set([...WORDS, ...PRINTS, ...PRINTS.map((p) => p[0].toUpperCase() + p.slice(1)), ...PRINTS.map((p) => p.toUpperCase())])];

function realParagraphs(limit) {
  const dir = path.join(HERE, 'real_samples');
  const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, '’').replace(/&#8220;|&ldquo;/g, '“').replace(/&#8221;|&rdquo;/g, '”').replace(/&#?\w+;/g, ' ');
  const paras = [];
  for (const [file, kind] of [['html/alice-in-wonderland-pg11.html', 'html'], ['html/sherlock-holmes-pg1661.html', 'html'],
    ['md/ch03-02-data-types.md', 'md'], ['md/ch08-01-vectors.md', 'md'], ['md/ch10-01-syntax.md', 'md']]) {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) continue;
    let src = fs.readFileSync(p, 'utf8');
    let ps;
    if (kind === 'html') {
      src = src.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
      ps = [...src.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => decode(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim());
    } else ps = src.split(/\n\s*\n/).map((x) => x.replace(/[`#*>]/g, '').replace(/\s+/g, ' ').trim());
    const good = ps.filter((x) => x.length >= 40 && x.length <= 600 && !/[^\x00-ɏ‘-”—…]/.test(x));
    // an even spread through the book, not just its first pages
    const step = Math.max(1, Math.floor(good.length / limit));
    for (let i = 0; i < good.length && paras.length < limit * 6; i += step) paras.push(good[i]);
  }
  return paras;
}
const PARAS = realParagraphs(40);

// ---- 1. All: nothing changes, nothing is segmented -----------------------------------------------------------------------------------------

test('All (null) and a Set of every key return the translation unchanged, byte for byte, for words and real paragraphs', () => {
  assert.ok(PARAS.length >= 100, `real paragraphs found: ${PARAS.length}`);
  const full = new Set(ALL_KEYS);
  const texts = [...SWEEP, ...PARAS, 'the cat and dog', 'Teacher, the TEACHERS ARE here.\nNext line', 'THE CAT SAT ON THE MAT TODAY OK', ''];
  for (const t of texts) {
    const r = tp(t);
    for (const allowed of [null, full]) {
      const x = relaxTranslation(t, r, allowed, { translatePos: tp });
      assert.equal(x.braille, r.braille, t);
      assert.deepEqual(x.inputPos, r.inputPos, t);
      assert.deepEqual(x.spelledOut, [], t);
    }
  }
});

test('All is the fast path: no segmentation at all (a translatePos that throws is never called), and undefined behaves as All', () => {
  const r = tp('the teacher');
  const boom = () => { throw new Error('should not be called'); };
  for (const allowed of [null, undefined, new Set(ALL_KEYS)]) {
    const x = relaxTranslation('the teacher', r, allowed, { translatePos: boom });
    assert.equal(x.braille, r.braille);
  }
  assert.equal(relaxTranslation('the teacher', r, null).braille, r.braille);   // no options object at all
});

// ---- 2. the empty set ----------------------------------------------------------------------------------------------------------------------

test('empty Set: "teacher" is t e a c h e r', () => {
  assert.equal(out('teacher', NONE), 'TEACHER');
});

test('empty Set: every plain lower-case word of the sweep is its letters (a grade 1 indicator liblouis put first is kept)', () => {
  let n = 0;
  const skipped = [];
  for (const w of SWEEP) {
    if (!/^[a-z]{2,}$/.test(w)) continue;
    const r = relax(w, NONE);
    if (r.unresolved.length) { skipped.push(w); continue; }     // liblouis gave no usable positions and the word could not be parsed
    assert.equal(r.braille.replace(/^;/, ''), w.toUpperCase(), `${w}: ${fullBrf(w)} -> ${r.braille}`);
    n++;
  }
  assert.ok(n > 150, `only ${n} words checked`);
  assert.deepEqual(skipped, ['captainess']);                    // the one word of the sweep liblouis braille cannot be taken apart (listed, not hidden)
});

test('empty Set: every sign liblouis used is spelled out - each spelled-out sign has its letters in the braille at their own text positions', () => {
  let signs = 0;
  for (const t of [...SWEEP, ...PARAS.slice(0, 60)]) {
    const r = relax(t, NONE);
    assert.equal(r.braille.length, r.inputPos.length, t);
    for (const s of r.spelledOut) {
      assert.ok(ALL_KEYS.includes(s.sign), `${t}: ${s.sign}`);
      assert.equal(t.slice(s.start, s.end), s.chars, t);
      for (let k = s.start; k < s.end; k++) {
        const has = r.inputPos.some((q, at) => q === k && r.braille[at] === t[k].toUpperCase());
        assert.ok(has, `${t}: letter ${t[k]} of ${s.sign} at ${k}: ${r.braille} ${r.inputPos}`);
      }
      signs++;
    }
    // and it is shorter or longer only by the signs: every cell that is not a letter of a spelled-out sign was in the contracted braille
    const full = tp(t).braille;
    const spelledLetters = r.spelledOut.reduce((n, s) => n + (s.end - s.start), 0);
    const cellsLost = full.length - (r.braille.length - spelledLetters);
    assert.ok(cellsLost >= 0, `${t}: ${full} -> ${r.braille}`);
  }
  assert.ok(signs > 500, `only ${signs} signs`);
});

// ---- 3. selected profiles ------------------------------------------------------------------------------------------------------------------

test('only strong_contractions:ch allowed: "teacher" is t e a ch e r', () => {
  assert.equal(out('teacher', only('strong_contractions:ch')), 'TEA*ER');
  assert.equal(fullBrf('teacher'), 'T1*]');
});

test('alphabetic wordsigns: "but" unticked is b u t; ticked it stays', () => {
  assert.equal(fullBrf('but'), 'B');
  assert.equal(out('but', allBut('alphabetic_wordsigns:but')), 'BUT');
  assert.equal(out('but', only('alphabetic_wordsigns:but')), 'B');
  assert.equal(out('but', NONE), 'BUT');
});

test('strong wordsigns: "the" unticked is t h e; "the" ticked but "and" unticked in "the cat and dog"', () => {
  assert.equal(out('the', allBut('strong_wordsigns:the')), 'THE');
  assert.equal(out('the cat and dog', allBut('strong_wordsigns:and')), '! CAT AND DOG');
  assert.equal(out('the cat and dog', allBut('strong_wordsigns:the')), 'THE CAT & DOG');
  assert.equal(out('the cat and dog', allBut('strong_wordsigns:the', 'strong_wordsigns:and')), 'THE CAT AND DOG');
  assert.equal(out('the cat and dog', only('strong_wordsigns:the', 'strong_wordsigns:and')), '! CAT & DOG');
});

test('shortforms unticked: because, children, about (and a ticked one stays)', () => {
  assert.equal(out('because', allBut('shortforms:because')), 'BECAUSE');
  assert.equal(out('children', allBut('shortforms:children')), 'CHILDREN');
  assert.equal(out('about', allBut('shortforms:about')), 'ABOUT');
  assert.equal(out('because', NONE), 'BECAUSE');
  assert.equal(out('because', only('shortforms:because')), '2C');
  // the letters of an unticked shortform are NOT re-contracted even when their groupsigns are held (out of scope, task brief)
  assert.equal(out('children', allBut('shortforms:children')), 'CHILDREN');
});

test('a wordsign and a groupsign with the same cell are two signs: "ch" ticked, "child" unticked', () => {
  const a = allBut('strong_contraction_wordsigns:child');
  assert.equal(out('child', a), 'CHILD');
  assert.equal(fullBrf('child'), '*');
  assert.equal(out('teacher', a), 'T1*]');
});

test('be: the groupsign unticked but the wordsign ticked: "begin" is b e g in, "be" stays 2', () => {
  const a = allBut('lower_contractions:be');
  assert.equal(fullBrf('begin'), '2G9');
  assert.equal(out('begin', a), 'BEG9');
  assert.equal(out('be', a), '2');
  assert.equal(out('be', allBut('lower_wordsigns:be')), 'BE');
  assert.equal(out('begin', allBut('lower_wordsigns:be')), '2G9');
});

// ---- 4. capitals ---------------------------------------------------------------------------------------------------------------------------

test('capitals: Teacher, TEACHER, TEACHERs keep their capital indicators and terminators', () => {
  assert.equal(fullBrf('Teacher'), ',T1*]');
  assert.equal(out('Teacher', NONE), ',TEACHER');
  assert.equal(out('Teacher', only('strong_contractions:ch')), ',TEA*ER');
  assert.equal(fullBrf('TEACHER'), ',,T1*]');
  assert.equal(out('TEACHER', NONE), ',,TEACHER');
  assert.equal(out('TEACHER', only('strong_contractions:er')), ',,TEACH]');
  assert.equal(fullBrf('TEACHERs'), ',,T1*],\'S');
  assert.equal(out('TEACHERs', NONE), ",,TEACHER,'S");
  assert.equal(out('TEACHERs', only('strong_contractions:er')), ",,TEACH],'S");
  assert.equal(out('Children', allBut('shortforms:children')), ',CHILDREN');
  assert.equal(out('CHILDREN', allBut('shortforms:children')), ',,CHILDREN');
  assert.equal(out('THE', NONE), ',,THE');
  assert.equal(out('The', NONE), ',THE');
  assert.equal(out('Mother', NONE), ',MOTHER');
});

test('a capital passage: the passage indicator and its terminator are untouched, words inside it are spelled out', () => {
  const t = 'THE CAT SAT ON THE MAT TODAY OK';
  assert.equal(fullBrf(t), ",,,! CAT SAT ON ! MAT TD OK,'");
  assert.equal(out(t, NONE), ",,,THE CAT SAT ON THE MAT TODAY OK,'");
  assert.equal(out(t, allBut('shortforms:today')), ",,,! CAT SAT ON ! MAT TODAY OK,'");
});

test('mixed capitals inside a word: ARound, ARab keep their terminators', () => {
  for (const w of ['ARound', 'ARab', 'PDFs']) {
    const f = fullBrf(w);
    const r = out(w, NONE);
    assert.equal(r.replace(/[^A-Z,']/g, '').length > 0, true);
    // the indicator/terminator cells are the same cells, in the same order
    assert.equal(r.replace(/[A-Z]/g, '').replace(/[^,';]/g, ''), f.replace(/[A-Z]/g, '').replace(/[^,';]/g, ''), `${w}: ${f} -> ${r}`);
  }
  assert.equal(out('ARound', NONE).replace(/[^A-Z]/g, ''), 'AROUND');
});

// ---- 5. punctuation ------------------------------------------------------------------------------------------------------------------------

test('punctuation stays: "teacher," "(children)" "\\"the\\"" "be;" and the cells with several meanings', () => {
  assert.equal(fullBrf('teacher,'), 'T1*]1');                    // ea and the comma are the same cell, ⠂ = BRF 1
  assert.equal(out('teacher,', NONE), 'TEACHER1');                // the comma is NOT spelled out
  assert.equal(out('teacher,', only('strong_contractions:ch', 'strong_contractions:er')), 'TEA*]1');
  assert.equal(out('teacher,', allBut('lower_contractions:ea')), 'TEA*]1');
  assert.equal(fullBrf('(children)'), '"<*N">');
  assert.equal(out('(children)', allBut('shortforms:children')), '"<CHILDREN">');
  assert.equal(out('(children)', NONE), '"<CHILDREN">');
  assert.equal(out('"the"', allBut('strong_wordsigns:the')), '8THE0');
  assert.equal(out('"the"', NONE), '8THE0');
  assert.equal(fullBrf('be;'), 'BE2');                            // UEB 10.3: liblouis spells "be;" out; the semicolon is not a "bb"/"be"
  assert.equal(out('be;', NONE), 'BE2');
  assert.equal(out('be;', allBut('lower_wordsigns:be')), 'BE2');
});

test('ea against the comma, bb/be against the semicolon, con/cc against the colon, dis against the full stop, kept apart', () => {
  // ⠂ ea / comma
  assert.equal(out('tea, teacher,', NONE), 'TEA1 TEACHER1');
  assert.equal(out('tea, teacher,', only('lower_contractions:ea')), 'TEA1 T1CHER1');
  // ⠆ bb / be / semicolon
  assert.equal(fullBrf('rabbit;'), 'RA2IT2');
  assert.equal(out('rabbit;', NONE), 'RABBIT2');
  assert.equal(out('rabbit; begin', allBut('lower_contractions:bb')), 'RABBIT2 2G9');
  assert.equal(out('rabbit; begin', only('lower_contractions:bb')), 'RA2IT2 BEGIN');
  assert.equal(out('rabbit; begin', only('lower_contractions:be')), 'RABBIT2 2GIN');
  // ⠒ cc / con / colon
  assert.equal(fullBrf('so: accept: contain:'), 'S3 A3EPT3 3TA93');
  assert.equal(out('so: accept: contain:', NONE), 'SO3 ACCEPT3 CONTAIN3');
  assert.equal(out('so: accept: contain:', allBut('lower_contractions:con')), 'S3 A3EPT3 CONTA93');
  assert.equal(out('so: accept: contain:', allBut('lower_contractions:cc')), 'S3 ACCEPT3 3TA93');
  // ⠲ dis / full stop
  assert.equal(fullBrf('dismiss. dismiss'), '4MISS4 4MISS');
  assert.equal(out('dismiss. dismiss', NONE), 'DISMISS4 DISMISS');
  assert.equal(out('dismiss. dismiss', allBut('lower_contractions:dis')), 'DISMISS4 DISMISS');
  assert.equal(out('dismiss. dismiss', only('lower_contractions:dis')), '4MISS4 4MISS');
  // ⠖ ff / exclamation mark, ⠦ his / question mark
  assert.equal(out('different!', NONE), 'DIFFERENT6');
  assert.equal(fullBrf('different!'), 'DI6]5T6');
  assert.equal(out('different!', allBut('lower_contractions:ff')), 'DIFF]5T6');         // only ff is spelled out; er and en stay
});

test('punctuation next to the lower wordsigns his, was, were, enough: liblouis does not contract them there, so nothing to spell out', () => {
  assert.equal(out('his, was was?', NONE), 'HIS1 WAS WAS8');
  assert.equal(fullBrf('his, was was?'), 'HIS1 0 WAS8');
  assert.equal(out('his, was was?', allBut('lower_wordsigns:was')), 'HIS1 WAS WAS8');
  assert.equal(out('yes! why?', NONE), 'YES6 WHY8');
  assert.equal(out('yes! why?', allBut('strong_contractions:wh')), 'YES6 WHY8');
});

// ---- 6. numbers and mixed ------------------------------------------------------------------------------------------------------------------

test('numbers and mixed words: 3rd, COVID-19, e-mail, don\'t, o\'clock', () => {
  for (const t of ['3rd', 'COVID-19', 'e-mail', "don't", "o'clock", '1st', 'x-ray', 'A1', '2024']) {
    const f = fullBrf(t);
    const r = out(t, NONE);
    // no letter contraction in these, or only ones spelled out: the number signs, hyphens, apostrophes, indicators survive
    for (const ch of ['#', '-', "'", ';', ',']) assert.equal(r.split(ch).length, f.split(ch).length, `${t}: ${f} -> ${r} (${ch})`);
  }
  assert.equal(out('3rd', NONE), fullBrf('3rd'));
  assert.equal(out('COVID-19', NONE), fullBrf('COVID-19'));
  assert.equal(out('e-mail', NONE), fullBrf('e-mail'));
  assert.equal(out("don't", NONE), "DON'T");
  assert.equal(out("o'clock", NONE), "O'CLOCK");
  assert.equal(out('well-known', NONE), 'WELL-KNOWN');
});

// ---- 7. emphasis ---------------------------------------------------------------------------------------------------------------------------

test('typeform: the emphasis indicators are kept when a contraction inside is spelled out', () => {
  const bold = (text, from, to) => [...text].map((c, i) => (i >= from && i < to ? louis.TYPEFORM.bold : 0));
  // a bold word: the word indicator ^1 and the terminator, around spelled-out letters
  let tf = bold('the bold teacher here', 4, 8);
  assert.equal(fullBrf('the bold teacher here', tf), '! ^1BOLD T1*] "H');
  assert.equal(out('the bold teacher here', NONE, tf), 'THE ^1BOLD TEACHER HERE');
  // "the" bold: ^1 stays in front of the spelled-out word
  tf = bold('the cat', 0, 7);
  assert.equal(fullBrf('the cat', tf), '^1! ^1CAT');
  assert.equal(out('the cat', NONE, tf), '^1THE ^1CAT');
  assert.equal(out('the cat', allBut('strong_wordsigns:the'), tf), '^1THE ^1CAT');
  assert.equal(out('the cat', only('strong_wordsigns:the'), tf), '^1! ^1CAT');
  // bold passage with its terminator
  const t = 'teacher the cat dog bird';
  tf = bold(t, 0, t.length);
  assert.equal(fullBrf(t, tf), "^7T1*] ! CAT DOG BIRD^'");
  assert.equal(out(t, NONE, tf), "^7TEACHER THE CAT DOG BIRD^'");
  // part of a word bold: liblouis puts a word indicator and terminator round "ch"; spelled out they stay round c h
  tf = bold('teacher', 3, 5);
  assert.equal(fullBrf('teacher', tf), "TEA^1*^']");
  assert.equal(out('teacher', NONE, tf), "TEA^1CH^'ER");
  assert.equal(out('teacher', only('strong_contractions:ch'), tf), "TEA^1*^'ER");
  // italic
  const it = [...'the end'].map((c, i) => (i < 3 ? louis.TYPEFORM.italic : 0));
  const fi = fullBrf('the end', it);
  assert.equal(fi, '.1! 5D');
  assert.equal(out('the end', NONE, it), '.1THE END');
});

test('typeform: a bold SYMBOL indicator in front of a spelled-out sign is kept as liblouis placed it (it then covers the first letter, as the print does)', () => {
  const bold = (text, from, to) => [...text].map((c, i) => (i >= from && i < to ? louis.TYPEFORM.bold : 0));
  // only the "c" of teacher is bold: liblouis puts the symbol indicator ^2 before the ch sign; spelled out, ^2 covers the c only
  assert.equal(fullBrf('teacher', bold('teacher', 3, 4)), 'TEA^2*]');
  assert.equal(out('teacher', NONE, bold('teacher', 3, 4)), 'TEA^2CHER');
  assert.equal(out('the end', NONE, bold('the end', 0, 1)), '^2THE END');
  // bold "ea": liblouis uses the word indicator and terminator; they stay round the letters
  assert.equal(fullBrf('teacher', bold('teacher', 1, 3)), "T^1EA^'*]");
  assert.equal(out('teacher', NONE, bold('teacher', 1, 3)), "T^1EA^'CHER");
});

// ---- 8. inputPos ---------------------------------------------------------------------------------------------------------------------------

test('inputPos: same length as the braille; spelled-out letters point at their own characters; other cells keep their positions', () => {
  const t = 'the teacher';
  const f = tp(t);                       // ! T1*]   positions [0,3,4,5,7,9] : "the"=0, space=3, T=4, ea=5, ch=7, er=9
  assert.equal(f.braille, '! T1*]');
  assert.deepEqual(f.inputPos, [0, 3, 4, 5, 7, 9]);
  const r = relax(t, NONE);
  assert.equal(r.braille, 'THE TEACHER');
  assert.equal(r.inputPos.length, r.braille.length);
  assert.deepEqual(r.inputPos, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const c = relax(t, only('strong_contractions:ch'));
  assert.equal(c.braille, 'THE TEA*ER');
  assert.deepEqual(c.inputPos, [0, 1, 2, 3, 4, 5, 6, 7, 9, 10]);
  const th = relax(t, allBut('strong_wordsigns:the'));
  assert.equal(th.braille, 'THE T1*]');
  assert.deepEqual(th.inputPos, [0, 1, 2, 3, 4, 5, 7, 9]);
});

test('inputPos with capitals and a later word: the prefix cells keep liblouis\'s position, the letters their own', () => {
  const t = 'Teacher, the end';
  const f = tp(t);
  const r = relax(t, NONE);
  assert.equal(r.braille.length, r.inputPos.length);
  assert.equal(r.braille, ',TEACHER1 THE END');
  // the capital sign is still at the position liblouis gave it; each letter is at its own character
  assert.equal(r.inputPos[0], f.inputPos[0]);
  assert.deepEqual(r.inputPos.slice(1, 8), [0, 1, 2, 3, 4, 5, 6].map((i) => i));
  assert.deepEqual(r.inputPos.slice(1, 8), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(r.inputPos[8], 7);        // the comma
  // everything is a valid index into the text and positions never go backwards
  for (let i = 1; i < r.inputPos.length; i++) assert.ok(r.inputPos[i] >= r.inputPos[i - 1], `${i}: ${r.inputPos}`);
});

test('inputPos stays valid and ordered over the sweep and real paragraphs, for several profiles', () => {
  const profiles = [NONE, only('strong_contractions:ch', 'strong_contractions:er'), allBut('shortforms:because', 'strong_wordsigns:the'),
    new Set(UEB_CONTRACTION_SIGNS.filter((s) => s.group === 'lower_contractions' || s.group === 'strong_contractions').map((s) => s.key))];
  for (const t of [...SWEEP, ...PARAS.slice(0, 80)]) {
    const f = tp(t);
    for (const p of profiles) {
      const r = relaxTranslation(t, f, p, { translatePos: tp });
      assert.equal(r.inputPos.length, r.braille.length, t);
      for (let i = 0; i < r.inputPos.length; i++) {
        assert.ok(Number.isInteger(r.inputPos[i]) && r.inputPos[i] >= 0 && r.inputPos[i] <= t.length, `${t} [${i}] ${r.inputPos[i]}`);
        if (i) assert.ok(r.inputPos[i] >= r.inputPos[i - 1], `${t}: positions go backwards at ${i}: ${r.inputPos}`);
      }
      // the input object is not touched
      assert.equal(f.braille, tp(t).braille);
    }
  }
});

// ---- 9. the list of what was spelled out --------------------------------------------------------------------------------------------------------

test('spelledOut: what was spelled out in a sample sentence, with text positions (for the status bar and the report)', () => {
  const t = 'The teacher said the children were here.';
  const r = relax(t, only('strong_contractions:ch', 'strong_contractions:er', 'strong_wordsigns:the'));
  assert.deepEqual(r.spelledOut.map((s) => [s.chars, s.sign, s.start, s.end]), [
    ['ea', 'lower_contractions:ea', 5, 7],
    ['said', 'shortforms:said', 12, 16],
    ['children', 'shortforms:children', 21, 29],
    ['were', 'lower_wordsigns:were', 30, 34],
    ['here', 'initial_contractions:here', 35, 39],
  ]);
  for (const s of r.spelledOut) assert.equal(t.slice(s.start, s.end), s.chars);
  assert.deepEqual(r.spelledOut.map((s) => t.slice(s.wordStart, s.wordEnd)), ['teacher', 'said', 'children', 'were', 'here.']);
  assert.deepEqual(spelledOutSigns(t, tp(t), only('strong_contractions:ch', 'strong_contractions:er', 'strong_wordsigns:the'), { translatePos: tp }), r.spelledOut);
  // everything ticked: nothing spelled out
  assert.deepEqual(spelledOutSigns(t, tp(t), null, { translatePos: tp }), []);
  // the capital is not part of the sign
  const c = relax('Children', allBut('shortforms:children')).spelledOut;
  assert.deepEqual(c.map((s) => [s.chars, s.start, s.end]), [['Children', 0, 8]]);
});

// ---- 10. words that cannot be taken apart (approx / unusable positions) ------------------------------------------------------------------------

// A translation whose positions are useless: every cell claims the first character of the text (so each word's cells are found by a
// word that holds the first character only; here one word at a time).
const badPositions = (w) => { const f = tp(w); return { braille: f.braille, inputPos: f.inputPos.map(() => 0) }; };

test('CHOICE for a word with unusable positions that cannot be parsed: without translatePos it stays contracted and is reported as unresolved', () => {
  for (const w of ['it,', 'States,', 'whatsoever.', 'www.gutenberg.org', 'I.']) {
    const bad = badPositions(w);
    const r = relaxTranslation(w, bad, NONE, {});
    assert.equal(r.braille, bad.braille, w);                              // left exactly as it was
    assert.deepEqual(r.inputPos, bad.inputPos, w);
    assert.deepEqual(r.spelledOut, [], w);
    assert.deepEqual(r.unresolved.map((u) => u.chars), [w], w);
    assert.equal(r.unresolved[0].start, 0);
    assert.equal(r.unresolved[0].end, w.length);
  }
});

test('CHOICE: with translatePos the word alone is translated and used when its cells are the very cells of the full translation', () => {
  const words = ['it,', 'States,', 'whatsoever.', 'www.gutenberg.org', 'updated:', '"and', 'the,', 'her.', 'Teacher,', 'children;', '(Which', 'distance\u2014but'];
  for (const w of words) {
    const good = relaxTranslation(w, tp(w), NONE, { translatePos: tp });
    const r = relaxTranslation(w, badPositions(w), NONE, { translatePos: tp });
    assert.deepEqual(r.unresolved, [], w);
    assert.equal(r.braille, good.braille, w);
    assert.deepEqual(r.spelledOut.map((s) => [s.chars, s.sign]), good.spelledOut.map((s) => [s.chars, s.sign]), w);
  }
  // a translatePos that gives different cells (here: nothing) cannot be trusted: the word stays contracted and is reported
  const lie = relaxTranslation('it,', badPositions('it,'), NONE, { translatePos: () => ({ braille: 'Q', inputPos: [0] }) });
  assert.equal(lie.braille, badPositions('it,').braille);
  assert.equal(lie.unresolved.length, 1);
  const boom = relaxTranslation('it,', badPositions('it,'), NONE, { translatePos: () => { throw new Error('no table'); } });
  assert.equal(boom.braille, badPositions('it,').braille);
  assert.equal(boom.unresolved.length, 1);
});

test('liblouis\'s own repairs still work with bad positions: a plain word is parsed from its cells and letters (teacher)', () => {
  const r = relaxTranslation('teacher', badPositions('teacher'), only('strong_contractions:ch'), {});
  assert.equal(r.braille, 'TEA*ER');
  assert.deepEqual(r.unresolved, []);
});

test('a word liblouis gives no positions for and that cannot be parsed ("captainess") is left contracted and reported', () => {
  const r = relax('captainess', NONE);
  assert.equal(r.braille, fullBrf('captainess'));
  assert.deepEqual(r.unresolved.map((u) => u.chars), ['captainess']);
});

test('only the unresolved word is left alone: its neighbours in the same text are still spelled out', () => {
  const t = 'the captainess the';
  const r = relax(t, NONE);
  assert.equal(r.braille, 'THE ' + fullBrf('captainess') + ' THE');
  assert.deepEqual(r.unresolved.map((u) => u.chars), ['captainess']);
  assert.equal(r.unresolved[0].start, 4);
});

test('unusable global positions (length differs from the braille, or none): returned as they are, one unresolved entry, nothing thrown', () => {
  const r = relaxTranslation('teacher', { braille: 'T1*]', inputPos: [0, 1] }, NONE, { translatePos: tp });
  assert.equal(r.braille, 'T1*]');
  assert.deepEqual(r.inputPos, [0, 1]);
  assert.equal(r.unresolved.length, 1);
  const r2 = relaxTranslation('teacher', null, NONE, { translatePos: tp });
  assert.equal(r2.braille, '');
  const r3 = relaxTranslation('teacher', { braille: 'T1*]' }, NONE, { translatePos: tp });
  assert.equal(r3.braille, 'T1*]');
});

test('a cell between a word\'s cells that belongs to white space makes the word unusable: left alone, reported', () => {
  const t = 'ab cd';
  const r = relaxTranslation(t, { braille: 'A1B C', inputPos: [0, 2, 1, 3] }, NONE, {});
  assert.equal(r.braille, 'A1B C');
  assert.ok(r.unresolved.length >= 1);
});

// ---- 11. the result is valid braille: it reads back as the same text ---------------------------------------------------------------------------

test('round trip: the relaxed braille back-translates to the same text as the contracted braille does (sweep, several profiles)', () => {
  const back = (b) => louis.backTranslate(b, louis.TABLES.uebG2);
  const profiles = [NONE, only('strong_contractions:ch'), allBut('shortforms:because', 'shortforms:children', 'strong_wordsigns:the'),
    new Set(UEB_CONTRACTION_SIGNS.filter((s) => s.group === 'lower_contractions').map((s) => s.key))];
  let checked = 0;
  const bad = [];
  for (const w of SWEEP.filter((x) => /^[A-Za-z]+$/.test(x))) {
    const base = back(fullBrf(w));
    if (base.toLowerCase() !== w.toLowerCase()) continue;           // the contracted braille itself does not read back: nothing to compare
    for (const p of profiles) {
      checked++;
      const got = back(out(w, p));
      if (got.toLowerCase() !== w.toLowerCase()) bad.push(`${w}: ${fullBrf(w)} -> ${out(w, p)} reads as ${got}`);
    }
  }
  assert.ok(checked > 400, `checked ${checked}`);
  assert.deepEqual(bad, [], bad.join('\n'));
});
