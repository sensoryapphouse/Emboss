// K32 (EMBOSS-TASKS.md): three index/glossary import problems found by K12 while building guide
// words (K12) on the anthology NIMAS book 9780544087507NIMAS.xml ("Index of Skills", "Index of
// Titles and Authors"). Fixtures below copy the anthology's own DTBook shapes.
//  1. A print alphabetical division letter ("A", "B", ...) arrives from DTBook as a bold
//     paragraph, not a heading (BANA Formats §21.2.3 "Center alphabetical division letters").
//     Emboss/input/parse.mjs's parseSingleList now recognises one — conservatively, a plain
//     paragraph whose whole text is a single letter, directly before the index/glossary list it
//     introduces — and converts it to a heading in place, so document.mjs's own division-letter
//     rules (isDivisionLetterBeforeReference) apply: centred, blank line before the FIRST
//     division only (21.2.3c), none before or after any later one (21.2.3d).
//  2. Every division after the first arrived as an ordinary ('plain') list, not an index list
//     (the DTBook reader's own ancestor-heading search stops at the first <list> sibling it
//     meets, walking back from a later division, without ever reaching the "Index of ..."
//     heading). Fixed by teaching that backward walk to tunnel through a (division-letter
//     paragraph, earlier division of the SAME index) chain. Separately, a real print page turn
//     landing INSIDE one <li> (the anthology's "characters" > "main" / "minor" split at page R84,
//     sometimes with the page's own repeated running head paragraph in between) used to fold the
//     next entry into the previous one's `item.blocks` (an indented continuation) instead of
//     making it a proper sibling entry at the same level — fixed the same way a page turn BETWEEN
//     two <li> already split a list into two chunks.
//  3. A BANA document whose very first block is a Glossary/Index heading got a blank first
//     braille page: the title's own trailing blank line was kept even though what follows it is
//     a forced-page-break block (BANA §21.2.1a, "start each alphabetic reference on a new page"),
//     which then genuinely broke — bodyPos was no longer 0 — stranding the title alone on page 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { parseDtbook } from '../input/parse.mjs';
import { formatDocument } from '../format/document.mjs';

globalThis.DOMParser = DOMParser;

const DTBOOK_NS = 'http://www.daisy.org/z3986/2005/dtbook/';
const wrap = (body) => `<?xml version="1.0" encoding="UTF-8"?>\n<dtbook xmlns="${DTBOOK_NS}" version="2005-3"><head><meta name="dtb:uid" content="t"/></head><book><bodymatter><level1>${body}</level1></bodymatter></book></dtbook>`;

const up = (s) => String(s).toUpperCase();
const upOpts = { mode: 'bana', standard: 'bana', width: 40, depth: 25, suppressHeader: true, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) };
// The blank-first-page bug (3) is specifically about page 1's own title/header machinery, which
// suppressHeader turns off — these two tests need "page headers on", per the task, so they use
// this instead (no suppressHeader).
const headerOpts = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) };
const pagesOf = (doc, o = upOpts) => (formatDocument(doc, o) || '').split('\x0c');
const bodyLines = (page) => page.split('\r\n');

test('a division letter arrives as a bold paragraph before an index list, not a heading (BANA 21.2.3a)', () => {
  const xml = wrap(`
    <h1>Index of Titles and Authors</h1>
    <p><strong>A</strong></p>
    <list type="pl">
      <li><p><em>Allied with Green</em>, <a href="#p149">149</a></p></li>
      <li><p>Arnold, Jeanne E., <a href="#p221">221</a></p></li>
    </list>
    <p><strong>B</strong></p>
    <list type="pl">
      <li><p>Bardoe, Cheryl, <a href="#p201">201</a></p></li>
    </list>
  `);
  const d = parseDtbook(xml);
  const kinds = d.blocks.map((b) => b.type);
  // Both division letters are headings, not paragraphs (was: 'para' with tf bold, BANA reads
  // this as a heading — §21.2.3a "Center alphabetical division letters").
  const letters = d.blocks.filter((b) => b.type === 'heading' && /^[AB]$/.test((b.text || '').trim()));
  assert.equal(letters.length, 2, JSON.stringify(kinds));
  assert.ok(!d.blocks.some((b) => b.type === 'para' && /^[AB]$/.test((b.text || '').trim())), 'no division letter left as a paragraph');
});

test('every division of the index is an index list, not just the first (BANA 21.2.1b)', () => {
  const xml = wrap(`
    <h1>Index of Titles and Authors</h1>
    <p><strong>A</strong></p>
    <list type="pl"><li><p>Allied with Green, <a href="#p149">149</a></p></li></list>
    <p><strong>B</strong></p>
    <list type="pl"><li><p>Bardoe, Cheryl, <a href="#p201">201</a></p></li></list>
    <p><strong>C</strong></p>
    <list type="pl"><li><p>Cousteau, Philippe, <a href="#p193">193</a></p></li></list>
  `);
  const d = parseDtbook(xml);
  const lists = d.blocks.filter((b) => b.type === 'list');
  assert.equal(lists.length, 3, JSON.stringify(d.blocks));
  // Was: only the first list (right after the heading) came out kind 'index'; B and C came out
  // 'plain' — an ordinary list, with none of BANA §21's margins, guide words, or new-page rules.
  assert.deepEqual(lists.map((l) => l.kind), ['index', 'index', 'index']);
});

test('a nested subentry list under a LATER division is an index list too, with correct levels', () => {
  const xml = wrap(`
    <h1>Index of Skills</h1>
    <p><strong>A</strong></p>
    <list type="pl"><li><p>ad hominem, <a href="#pR27">R27</a></p></li></list>
    <p><strong>B</strong></p>
    <list type="pl">
      <li><p>ballad, <a href="#pR64">R64</a>, <a href="#pR68">R68</a></p>
        <list type="pl">
          <li><p>comparative forms of, <a href="#pR44">R44</a></p></li>
          <li><p>compound, <a href="#pR35">R35</a></p></li>
        </list>
      </li>
      <li><p>base word, <a href="#p88">88</a></p></li>
    </list>
  `);
  const d = parseDtbook(xml);
  const bList = d.blocks.filter((b) => b.type === 'list')[1];
  assert.equal(bList.kind, 'index', JSON.stringify(bList));
  assert.deepEqual(bList.items.map((it) => it.level || 0), [0, 1, 1, 0]);
});

test('a print page turn inside one <li> splits it into sibling entries, not a folded continuation (anthology "characters" > "main" / "minor", page R84)', () => {
  const xml = wrap(`
    <h1>Index of Skills</h1>
    <p><strong>C</strong></p>
    <list type="pl">
      <li><p>characters, <a href="#p107">107</a>, <a href="#pR65">R65</a>. <em>See also</em> characterization</p>
        <list type="pl">
          <li><p>action of, <a href="#p107">107</a>, <a href="#p333">333</a></p></li>
          <li><p>main, <a href="#p53">53&#x2013;55</a>, <a href="#p107">107</a></p>
            <pagenum id="pR84" page="special">R84</pagenum>
            <p>minor, <a href="#pR65">R65</a></p>
          </li>
          <li><p>motivations of, <a href="#p107">107</a></p></li>
        </list>
      </li>
      <li><p>chronological order, <a href="#p165">165</a></p></li>
    </list>
  `);
  const d = parseDtbook(xml);
  assert.equal(d.warnings, undefined, JSON.stringify(d.warnings));   // nothing silently lost (load-audit.mjs)
  const lists = d.blocks.filter((b) => b.type === 'list');
  assert.equal(lists.length, 2, JSON.stringify(d.blocks.map((b) => b.type)));   // split around the pagenum
  assert.equal(lists[0].kind, 'index'); assert.equal(lists[1].kind, 'index');
  const beforeTexts = lists[0].items.map((it) => it.text);
  const afterTexts = lists[1].items.map((it) => it.text);
  // "minor, R65" is its own sibling item, at the same level as "main" and "motivations of" —
  // was: folded into "main"'s own item.blocks (an indented continuation two cells further right,
  // as if it were explanatory prose attached to "main", not an entry of its own).
  assert.ok(beforeTexts.some((t) => /^main,/.test(t)) && !beforeTexts.some((t) => /^minor,/.test(t)), JSON.stringify(beforeTexts));
  assert.ok(afterTexts.some((t) => /^minor,/.test(t)), JSON.stringify(afterTexts));
  const minorItem = lists[1].items.find((it) => /^minor,/.test(it.text));
  assert.equal(minorItem.level, 1, JSON.stringify(minorItem));
  assert.ok(!minorItem.blocks, 'minor is a sibling item, not folded into another item.blocks');
  assert.equal(d.blocks.find((b) => b.type === 'pagenum').page, 'R84');
});

test('a repeated print running head between the page turn and the next entry is kept (fidelity) but is not itself an entry', () => {
  // Anthology shape: <li><p>for narrative, ...</p><pagenum/><p><strong><em>Index of Skills</em></strong></p><p>in news story, ...</p></li>
  const xml = wrap(`
    <h1>Index of Skills</h1>
    <p><strong>D</strong></p>
    <list type="pl">
      <li><p>details, <a href="#p209">209</a></p>
        <list type="pl">
          <li><p>for narrative, <a href="#pR6">R6&#x2013;R7</a></p>
            <pagenum id="pR85" page="special">R85</pagenum>
            <p><strong><em>Index of Skills</em></strong></p>
            <p>in news story, <a href="#p23">23</a></p>
          </li>
          <li><p>organizing, <a href="#p165">165</a></p></li>
        </list>
      </li>
      <li><p>dictionary, <a href="#p109">109</a></p></li>
    </list>
  `);
  const d = parseDtbook(xml);
  assert.equal(d.warnings, undefined, JSON.stringify(d.warnings));   // the running head's own words are still somewhere in the model
  const lists = d.blocks.filter((b) => b.type === 'list');
  assert.equal(lists.length, 2);
  const afterTexts = lists[1].items.map((it) => it.text);
  assert.ok(afterTexts.some((t) => /^in news story,/.test(t)), JSON.stringify(afterTexts));
  assert.ok(!afterTexts.some((t) => /Index of Skills/i.test(t)), 'the running head is not its own index entry');
  const forNarrative = lists[0].items.find((it) => /^for narrative,/.test(it.text));
  assert.ok(forNarrative.blocks && forNarrative.blocks.some((b) => /Index of Skills/i.test(b.text || '')), 'running head text is kept, folded into the preceding entry');
});

test('BANA 21.2.3c/d: blank line before the FIRST division only; none before or after any later one', () => {
  const doc = { title: null, blocks: [
    { type: 'heading', level: 1, text: 'Index' },
    { type: 'heading', level: 1, text: 'A' },
    { type: 'list', kind: 'index', items: [{ text: 'apple', page: '3' }] },
    { type: 'heading', level: 1, text: 'B' },
    { type: 'list', kind: 'index', items: [{ text: 'banana', page: '5' }] },
  ] };
  const lines = bodyLines(pagesOf(doc)[0]);
  const iA = lines.findIndex((l) => l.trim() === 'A');
  const iApple = lines.findIndex((l) => /APPLE/.test(l));
  const iB = lines.findIndex((l) => l.trim() === 'B');
  const iBanana = lines.findIndex((l) => /BANANA/.test(l));
  assert.ok(iA > 0 && lines[iA - 1] === '', 'blank line before the first division');
  assert.equal(iApple, iA + 1, 'no blank line after the first division letter');
  assert.equal(iB, iApple + 1, 'no blank line before a later division letter (21.2.3d)');
  assert.equal(iBanana, iB + 1, 'no blank line after a later division letter');
});

test('a BANA document whose first block is a Glossary heading does not get a blank first page', () => {
  const doc = { title: 'Test Book', blocks: [
    { type: 'heading', level: 1, text: 'Glossary' },
    { type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'apple', def: 'a fruit' }] },
  ] };
  const pages = pagesOf(doc, headerOpts);
  assert.equal(pages.length, 1, 'title and glossary share page 1 — was: a blank page 1, glossary pushed to page 2');
  const lines = bodyLines(pages[0]);
  assert.ok(lines.some((l) => /GLOSS/.test(l)));
  assert.ok(lines.some((l) => /APPLE/.test(l)));
});

test('a Glossary/Index heading LATER in the document still forces its own new page (21.2.1a unaffected)', () => {
  const doc = { title: 'Test Book', blocks: [
    { type: 'heading', level: 1, text: 'Chapter One' },
    { type: 'para', text: 'Once upon a time.' },
    { type: 'heading', level: 1, text: 'Glossary' },
    { type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'apple', def: 'a fruit' }] },
  ] };
  const pages = pagesOf(doc, headerOpts);
  assert.equal(pages.length, 2, JSON.stringify(pages.map(bodyLines)));
  assert.ok(bodyLines(pages[0]).some((l) => /CHAPTER ONE/.test(l)));
  assert.ok(bodyLines(pages[1]).some((l) => /GLOSS/.test(l)));
});
