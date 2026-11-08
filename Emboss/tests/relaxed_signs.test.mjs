// Relaxed braille, task 1 (A91): the sign catalogue, the splitting of a word's braille into signs and the naming of each sign.
// New file, so there is no earlier expectation to change. It was first run before Emboss/format/relaxed-signs.mjs existed and failed
// (ERR_MODULE_NOT_FOUND). Everything below is checked against the real liblouis en-ueb-g2 table, not a stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UEB_CONTRACTION_GROUPS, UEB_CONTRACTION_SIGNS, signByKey, segmentWord, identifySigns } from '../format/relaxed-signs.mjs';
import { brfToUnicodeBraille } from '../engine/brf-ascii.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const louis = await import('../engine/louis.mjs');
await louis.init(path.join(HERE, '..', 'liblouis', 'tables'));
const tp = (t) => louis.translatePos(t, louis.TABLES.uebG2);
const pieces = (w) => identifySigns(w, segmentWord(w, tp));
const signs = (w) => pieces(w).map((p) => p.sign);
const keysOf = (w) => pieces(w).filter((p) => p.sign).map((p) => p.sign);
const uni = (brf) => brfToUnicodeBraille(brf);

// ---- the catalogue ---------------------------------------------------------------------------------------------------------------

test('catalogue: the nine contraction groups of Paige Learn, unique keys, cells held as Unicode and BRF', () => {
  assert.deepEqual(UEB_CONTRACTION_GROUPS.map((g) => g.id), [
    'alphabetic_wordsigns', 'strong_wordsigns', 'strong_contractions', 'strong_contraction_wordsigns', 'lower_wordsigns',
    'lower_contractions', 'initial_contractions', 'final_contractions', 'shortforms']);
  assert.ok(!UEB_CONTRACTION_GROUPS.some((g) => g.id === 'letters' || g.id === 'punctuation'));   // decision A: contractions only
  const keys = UEB_CONTRACTION_SIGNS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, 'keys are unique across groups');
  for (const g of UEB_CONTRACTION_GROUPS) {
    for (const s of g.signs) {
      assert.equal(s.key, `${g.id}:${s.print}`);
      assert.equal(s.group, g.id);
      assert.match(s.braille, /^[⠀-⣿]+$/u);
      assert.equal(uni(s.brf), s.braille, `${s.key}: brf and braille agree`);
      assert.equal(signByKey(s.key), s);
    }
  }
  // "ch" and "child", "in" and "enough"/"en": the same print text or cell in two groups is two different keys
  assert.notEqual(signByKey('strong_contractions:ch').key, signByKey('strong_contraction_wordsigns:child').key);
  assert.equal(signByKey('strong_contractions:ch').braille, signByKey('strong_contraction_wordsigns:child').braille);
});

const LEARN = '/Users/paulblenkhorn/Documents/Development/PWAs/To do next/Paige Learn/signs.js';
test('catalogue: agrees with Paige Learn signs.js (when that file is on this machine)', { skip: !fs.existsSync(LEARN) }, () => {
  const win = {};
  new Function('window', fs.readFileSync(LEARN, 'utf8'))(win);
  const learn = win.LEARN_SIGNS.groups;
  for (const g of UEB_CONTRACTION_GROUPS) {
    const lg = learn.find((x) => x.id === g.id);
    assert.ok(lg, g.id);
    assert.equal(g.label, lg.label);
    // Learn's "be-" (the groupsign "be" at the start of a word) is print "be" here: Emboss matches print letters
    assert.deepEqual(g.signs.map((s) => [s.learnKey, s.print, s.braille, s.wholeWord]), lg.signs.map((s) => [s.key, s.print.replace(/-$/, ''), s.braille, !!s.wholeWord]), g.id);
  }
});

// ---- every sign against liblouis ----------------------------------------------------------------------------------------------------

// Where the print text alone is not a word, or liblouis does not use the sign for the word alone, a word that has the sign in it.
const IN_A_WORD = {
  'strong_wordsigns:and': ['sand', 'and'], 'strong_wordsigns:for': ['forget', 'for'], 'strong_wordsigns:of': ['proof', 'of'],
  'strong_wordsigns:the': ['absinthe', 'the'], 'strong_wordsigns:with': ['bindwith', 'with'],
  'strong_contractions:ch': ['teacher'], 'strong_contractions:gh': ['ghost'], 'strong_contractions:sh': ['sheep'],
  'strong_contractions:th': ['thing'], 'strong_contractions:wh': ['when'], 'strong_contractions:ed': ['needed'],
  'strong_contractions:er': ['teacher'], 'strong_contractions:ou': ['ouch'], 'strong_contractions:ow': ['cow'],
  'strong_contractions:st': ['stop'], 'strong_contractions:ar': ['star'], 'strong_contractions:ing': ['sing'],
  'lower_contractions:ea': ['teacher'], 'lower_contractions:bb': ['rabbit'], 'lower_contractions:cc': ['accept'],
  'lower_contractions:ff': ['different'], 'lower_contractions:gg': ['baggage'], 'lower_contractions:en': ['tend'],
  'lower_contractions:in': ['into'], 'lower_contractions:be': ['begin'], 'lower_contractions:con': ['contain'], 'lower_contractions:dis': ['dismiss'],
  'initial_contractions:day': ['Wednesday', 'day'], 'initial_contractions:ever': ['however', 'ever'],
  'initial_contractions:father': ['godfather', 'father'], 'initial_contractions:here': ['adhere', 'here'],
  'initial_contractions:know': ['known', 'know'], 'initial_contractions:lord': ['landlord', 'lord'],
  'initial_contractions:mother': ['godmother', 'mother'], 'initial_contractions:name': ['surname', 'name'],
  'initial_contractions:one': ['money', 'one'], 'initial_contractions:part': ['apart', 'part'],
  'initial_contractions:question': ['questionable', 'question'], 'initial_contractions:right': ['bright', 'right'],
  'initial_contractions:some': ['handsome', 'some'], 'initial_contractions:time': ['pastime', 'time'],
  'initial_contractions:under': ['thunder', 'under'], 'initial_contractions:work': ['network', 'work'],
  'initial_contractions:young': ['youngster', 'young'], 'initial_contractions:there': ['there'],
  'initial_contractions:character': ['character'], 'initial_contractions:through': ['throughout', 'through'],
  'initial_contractions:where': ['somewhere', 'where'], 'initial_contractions:ought': ['thought', 'ought'],
  'initial_contractions:upon': ['upon'], 'initial_contractions:word': ['password', 'word'],
  'initial_contractions:spirit': ['spirited', 'spirit'], 'initial_contractions:world': ['worldwide', 'world'],
  'final_contractions:ound': ['ground'], 'final_contractions:ance': ['dance'], 'final_contractions:sion': ['vision'],
  'final_contractions:less': ['careless'], 'final_contractions:ount': ['mount'], 'final_contractions:ence': ['fence'],
  'final_contractions:ong': ['long'], 'final_contractions:ful': ['careful'], 'final_contractions:tion': ['nation'],
  'final_contractions:ness': ['kindness'], 'final_contractions:ment': ['moment'], 'final_contractions:ity': ['city'],
};

for (const s of UEB_CONTRACTION_SIGNS) {
  test(`liblouis agrees: ${s.key} ${s.braille}`, () => {
    // 1. the sign in a word, where the table uses it as a groupsign
    const words = IN_A_WORD[s.key] || [s.print];
    for (const w of words) {
      const hit = pieces(w).find((p) => p.sign === s.key);
      assert.ok(hit, `${s.key}: not found in "${w}" -> ${JSON.stringify(pieces(w))}`);
      assert.equal(uni(hit.cells).slice(uni(hit.prefix).length), s.braille, `${s.key} in "${w}"`);
      assert.equal(hit.chars.toLowerCase(), s.print);
    }
    // 2. a wholeWord sign (wordsign, shortform) standing alone is ONE piece covering the whole word
    if (s.wholeWord) {
      const ps = pieces(s.print);
      assert.equal(ps.length, 1, `${s.print}: ${JSON.stringify(ps)}`);
      assert.equal(ps[0].sign, s.key);
      assert.equal(ps[0].whole, true);
      assert.equal(ps[0].cells, s.brf, `${s.print} alone`);
      assert.equal(ps[0].chars, s.print);
    }
  });
}

// ---- splitting a word's braille into signs --------------------------------------------------------------------------------------------

test('segmentWord: teacher -> t | ea | ch | er, tiling the word', () => {
  const segs = segmentWord('teacher', tp);
  assert.deepEqual(segs.map((s) => s.chars), ['t', 'ea', 'ch', 'er']);
  assert.deepEqual(segs.map((s) => [s.start, s.end]), [[0, 1], [1, 3], [3, 5], [5, 7]]);
  assert.equal(segs.map((s) => s.cells).join(''), tp('teacher').braille);
});

test('segmentWord: matches the status bar splitting (the same cells and chars as alignWord main path)', () => {
  for (const w of ['teacher', 'children', 'about', 'because', 'afternoon', 'little', 'the', 'ground', "it's", 'well-known', 'Teacher,']) {
    const r = tp(w);
    const expect = [];
    let j = 0;
    while (j < r.braille.length) {                       // alignWord's loop, copied
      const start = r.inputPos[j];
      let k = j;
      while (k + 1 < r.braille.length && r.inputPos[k + 1] === start) k++;
      const next = k + 1 < r.braille.length ? r.inputPos[k + 1] : w.length;
      expect.push({ cells: r.braille.slice(j, k + 1), chars: w.slice(start, next) });
      j = k + 1;
    }
    assert.deepEqual(segmentWord(w, tp).map((s) => ({ cells: s.cells, chars: s.chars })), expect, w);
  }
});

test('segmentWord: unusable positions give the whole word as one piece marked approx', () => {
  const bad = segmentWord('teacher', () => ({ braille: 'T1*]', inputPos: [0, 5, 3, 1] }));
  assert.equal(bad.length, 1);
  assert.equal(bad[0].chars, 'teacher');
  assert.equal(bad[0].approx, true);
  const thrown = segmentWord('teacher', () => { throw new Error('no table'); });
  assert.equal(thrown.length, 1);
  assert.equal(thrown[0].approx, true);
  assert.deepEqual(segmentWord('', tp), []);
});

test('shortforms and multi-cell signs come back from liblouis as ONE piece (no merging needed)', () => {
  for (const [w, cells] of [['about', 'AB'], ['because', '2C'], ['afternoon', 'AFN'], ['little', 'LL'], ['children', '*N'], ['together', 'TGR']]) {
    const segs = segmentWord(w, tp);
    assert.equal(segs.length, 1, `${w}: ${JSON.stringify(segs)}`);
    assert.equal(segs[0].cells, cells);
  }
});

// ---- the cells with several meanings ------------------------------------------------------------------------------------------------------

test('ambiguous cell ⠂: ea in a word, comma after it', () => {
  const ps = pieces('teacher,');
  assert.deepEqual(ps.map((p) => [p.chars, p.sign]), [['t', null], ['ea', 'lower_contractions:ea'], ['ch', 'strong_contractions:ch'], ['er', 'strong_contractions:er'], [',', null]]);
  assert.equal(ps[1].cells, ps[4].cells);                      // the very same cell
  assert.deepEqual(keysOf('tea'), []);                         // liblouis spells "tea" out (no ea at the end of a word before nothing)
  assert.deepEqual(signs(','), [null]);
});

test('ambiguous cell ⠆: bb, be (word and prefix), semicolon', () => {
  assert.deepEqual(keysOf('rabbit'), ['lower_contractions:bb']);
  assert.deepEqual(signs('be'), ['lower_wordsigns:be']);
  assert.equal(pieces('be')[0].whole, true);
  assert.deepEqual(keysOf('begin'), ['lower_contractions:be', 'lower_contractions:in']);   // the be- groupsign is a sign of its own (N1, Paul 3 Oct 2026)
  assert.equal(pieces('begin')[0].whole, false);
  assert.deepEqual(signs(';'), [null]);
  assert.deepEqual(pieces('begin;').map((p) => p.sign), ['lower_contractions:be', null, 'lower_contractions:in', null]);
  assert.deepEqual(keysOf('be;'), []);                         // UEB 10.3: not next to punctuation, so liblouis spells "be;" out
});

test('ambiguous cell ⠶: gg, were', () => {
  assert.deepEqual(keysOf('baggage'), ['lower_contractions:gg']);
  assert.deepEqual(signs('were'), ['lower_wordsigns:were']);
});

test('ambiguous cell ⠢: en, enough', () => {
  assert.deepEqual(keysOf('tend'), ['lower_contractions:en']);
  assert.deepEqual(signs('enough'), ['lower_wordsigns:enough']);
});

test('ambiguous cell ⠔: in (groupsign) and the word in', () => {
  assert.deepEqual(keysOf('into'), ['lower_contractions:in']);
  assert.deepEqual(signs('in'), ['lower_contractions:in']);
  assert.equal(pieces('in')[0].whole, true);
});

test('ambiguous cell ⠒: cc, con, colon', () => {
  assert.deepEqual(keysOf('accept'), ['lower_contractions:cc']);
  assert.deepEqual(keysOf('contain'), ['lower_contractions:con', 'lower_contractions:in']);
  assert.deepEqual(signs(':'), [null]);
  assert.deepEqual(pieces('so:').map((p) => p.sign), ['alphabetic_wordsigns:so', null]);
});

test('ambiguous cell ⠲: dis, full stop', () => {
  assert.deepEqual(keysOf('dismiss'), ['lower_contractions:dis']);
  assert.deepEqual(signs('.'), [null]);
  assert.deepEqual(pieces('dismiss.').map((p) => p.sign), ['lower_contractions:dis', null, null, null, null, null]);
  const stop = pieces('dismiss.');
  assert.equal(stop[0].cells, stop[5].cells);                  // the very same cell
});

test('ambiguous cell ⠖: ff, exclamation mark', () => {
  assert.deepEqual(keysOf('different'), ['lower_contractions:ff', 'strong_contractions:er', 'lower_contractions:en']);
  assert.deepEqual(signs('!'), [null]);
  assert.deepEqual(keysOf('yes!'), []);
  assert.equal(pieces('different')[2].cells, pieces('!')[0].cells);   // the very same cell
});

test('ambiguous cell ⠦: his, question mark', () => {
  assert.deepEqual(signs('his'), ['lower_wordsigns:his']);
  assert.deepEqual(signs('?'), [null]);
  assert.deepEqual(keysOf('why?'), ['strong_contractions:wh']);
  const his = pieces('his')[0], q = pieces('?')[0];           // a lone "?" gets a grade 1 indicator (its prefix); "his" here does not
  assert.equal(his.cells.slice(his.prefix.length), q.cells.slice(q.prefix.length));   // the very same cell
  // UEB 10.3: the lower wordsign his is not used next to punctuation: liblouis spells "his," out, so there is no sign
  assert.deepEqual(keysOf('his,'), []);
});

test('ambiguous cell ⠐ and ⠠: initial contractions and capitals are told apart by their letters', () => {
  assert.deepEqual(keysOf('mother'), ['initial_contractions:mother']);
  assert.deepEqual(keysOf('Mother'), ['initial_contractions:mother']);
  assert.equal(pieces('Mother')[0].prefix, ',');               // capital sign, BRF
});

test('ambiguous cells ⠰: grade 1 indicator against the final contractions ence, ong, ful ...', () => {
  const b = pieces('b');                                       // a lone letter gets the grade 1 indicator in contracted braille
  assert.deepEqual(b.map((p) => [p.sign, p.prefix, p.cells]), [[null, ';', ';B']]);
  assert.deepEqual(keysOf('fence'), ['final_contractions:ence']);
  assert.equal(pieces('x-ray')[0].prefix, ';');
  assert.equal(pieces('x-ray')[0].sign, null);
});

// ---- capitals, punctuation, numbers, letters --------------------------------------------------------------------------------------------------

test('capitals: Teacher and TEACHER keep the signs; the capital cells are the prefix, not the sign', () => {
  for (const w of ['Teacher', 'TEACHER']) {
    const ps = pieces(w);
    assert.deepEqual(ps.map((p) => p.sign), [null, 'lower_contractions:ea', 'strong_contractions:ch', 'strong_contractions:er'], w);
    assert.equal(ps[0].prefix, w === 'Teacher' ? ',' : ',,');
    assert.equal(ps.map((p) => p.chars).join(''), w);
    assert.equal(ps[1].chars.toLowerCase(), 'ea');
  }
  const the = pieces('THE');
  assert.deepEqual(the.map((p) => [p.sign, p.prefix, p.whole]), [['strong_wordsigns:the', ',,', true]]);
  assert.deepEqual(signs('Children'), ['shortforms:children']);
  assert.equal(pieces('Children')[0].prefix, ',');
});

test('capitals in the middle of a word: terminator cells belong to neither sign (TEACHERs, PDFs, ARab)', () => {
  const t = pieces('TEACHERs');
  assert.deepEqual(t.map((p) => p.sign), [null, 'lower_contractions:ea', 'strong_contractions:ch', 'strong_contractions:er', null]);
  assert.equal(t[3].suffix, ',\'');                             // capital terminator ⠠⠄ as BRF
  assert.equal(t.map((p) => p.chars).join(''), 'TEACHERs');
  assert.deepEqual(keysOf('ARab'), ['strong_contractions:ar']);
  assert.deepEqual(keysOf('ARound'), ['strong_contractions:ar', 'strong_contractions:ou']);   // the ar was split across two of liblouis's pieces
  assert.deepEqual(keysOf('PDFs'), []);
});

test('punctuation attached: "teacher," "(children)" "\\"the\\"" keep the sign and give punctuation sign null', () => {
  let ps = pieces('teacher,');
  assert.deepEqual(ps.map((p) => p.sign), [null, 'lower_contractions:ea', 'strong_contractions:ch', 'strong_contractions:er', null]);
  assert.equal(ps[ps.length - 1].chars, ',');
  ps = pieces('(children)');
  assert.deepEqual(ps.map((p) => [p.chars, p.sign, p.whole]), [['(', null, false], ['children', 'shortforms:children', true], [')', null, false]]);
  ps = pieces('"the"');
  assert.deepEqual(ps.map((p) => p.sign), [null, 'strong_wordsigns:the', null]);
  assert.equal(ps[1].whole, true);
  assert.deepEqual(pieces('Children,').map((p) => [p.sign, p.whole]), [['shortforms:children', true], [null, false]]);
  assert.deepEqual(keysOf("friend's"), ['shortforms:friend']);
  assert.deepEqual(keysOf('friends'), ['shortforms:friend']);
  assert.deepEqual(keysOf("children's"), ['shortforms:children']);
});

test('a shortform at the start of a compound is the shortform, with whole false', () => {
  const ps = pieces('blindfast');
  assert.equal(ps[0].sign, 'shortforms:blind');
  assert.equal(ps[0].whole, false);
});

test('numbers and letters give sign null', () => {
  for (const w of ['5', '12', '2024', 'a1', 'A1', 'x', 'z', 'cat', 'mad']) {
    assert.ok(signs(w).every((s) => s === null), `${w}: ${JSON.stringify(signs(w))}`);
  }
  assert.deepEqual(signs('12').length, 2);
});

test('words with no contractions: every piece is a letter', () => {
  for (const w of ['cat', 'mad', 'dog', 'jump', 'pig', 'bat', 'fix', 'zip']) {
    const ps = pieces(w);
    assert.equal(ps.length, w.length, w);
    assert.ok(ps.every((p) => p.sign === null), w);
  }
});

// ---- liblouis's positions repaired ---------------------------------------------------------------------------------------------------------------

test('a piece liblouis reports as several signs at one position is taken apart (adherent, northeast, thence)', () => {
  const raw = segmentWord('adherent', tp);
  assert.ok(raw.some((s) => s.chars.length > 2), 'liblouis really does give one piece for "herent"');
  assert.deepEqual(keysOf('adherent'), ['strong_contractions:er', 'lower_contractions:en']);
  assert.deepEqual(keysOf('northeast'), ['strong_contractions:th', 'lower_contractions:ea', 'strong_contractions:st']);
  assert.deepEqual(keysOf('thence'), ['strong_contractions:th', 'final_contractions:ence']);
});

test('the pieces always tile the word, whatever the word (a sweep of words, capitals and punctuation)', () => {
  const words = ['teacher', 'Teacher', 'TEACHER', 'McDonald', 'iPhone', 'PDFs', "don't", 'well-known', 'C.A.T.', '1st', 'A1', 'abandonee',
    'adherent', 'northeast', 'thence', 'ARound', 'ACtionably', 'captainess', "NATO's", '(b)', '"said,"', 'wherever', 'Wednesday', 'x-ray'];
  for (const w of words) {
    const ps = pieces(w);
    let pos = ps[0].start;
    for (const p of ps) {
      assert.equal(p.start, pos, `${w}: gap before ${JSON.stringify(p)}`);
      assert.equal(p.chars, w.slice(p.start, p.end), w);
      pos = p.end;
    }
    assert.equal(pos, w.length, w);
  }
});

test('identifySigns copes with a bad segment list', () => {
  assert.deepEqual(identifySigns('x', []), []);
  assert.deepEqual(identifySigns('x', null), []);
});

// N1 (Paul, 3 Oct 2026): "be" at the beginning of a word is the lower groupsign, a sign of its own beside con and dis; the word
// "be" alone is the lower wordsign. A profile can hold one without the other.
test('be: the groupsign at the start of a word and the wordsign alone are two signs', () => {
  const signsOf = (w) => identifySigns(w, segmentWord(w, tp)).map((p) => p.sign).filter(Boolean);
  assert.ok(signsOf('begin').includes('lower_contractions:be'), JSON.stringify(signsOf('begin')));
  for (const w of ['become', 'betray', 'belong']) assert.ok(signsOf(w).includes('lower_contractions:be'), w + ' ' + JSON.stringify(signsOf(w)));
  assert.deepEqual(signsOf('behind'), ['shortforms:behind']);   // a shortform stays one sign
  assert.deepEqual(signsOf('be'), ['lower_wordsigns:be']);
  assert.ok(!signsOf('begin').includes('lower_wordsigns:be'));
});

