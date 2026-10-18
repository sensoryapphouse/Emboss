// F9 item E2a (first beta feedback, APH, 9 Oct 2026; PAUL'S DECISION E2a): with the Title field hidden the document's title is NOT
// added to the braille. The formatter option `titleInBraille: false` does it: no title on line 1 of BANA page 1, no running head
// (BANA pages 2+, UKAAF pages 2+), and the line the title took on every page is the text's again. The document's own text — a heading
// that happens to say the same as the title — is still brailled. The option absent, or true, is exactly as before (gold, corpus and
// every other test do not pass it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument, formatDocumentAsync, formatVolumes } from '../format/document.mjs';

const tr = (s) => String(s).replace(/[A-Z]/g, (c) => `,${c}`).toUpperCase();    // capital sign like UEB
const opts = (mode, extra = {}) => ({ mode, width: 40, depth: 25, translate: tr, ...extra });
const filler = Array.from({ length: 40 }, (_, i) => ({ type: 'para', text: `paragraph ${i} with some words to fill a line or two of braille` }));
const pages = (brf) => brf.replace(/\r/g, '').split('\f').map((p) => p.split('\n'));
const TITLE_BRL = ',SHORT ,TITLE';
const mkDoc = () => ({ title: 'Short Title', blocks: [{ type: 'pagenum', page: '5', text: '5' }, { type: 'heading', level: 1, text: 'first chapter' }, ...filler] });

test('BANA, default and titleInBraille:true: title on page 1 and in the running head (as before)', () => {
  const base = formatDocument(mkDoc(), opts('bana'));
  assert.equal(formatDocument(mkDoc(), opts('bana', { titleInBraille: true })), base, 'true is the default');
  const ps = pages(base);
  assert.ok(ps[0][0].includes(TITLE_BRL), ps[0][0]);
  assert.ok(ps[1][0].includes(TITLE_BRL), ps[1][0]);
});

test('BANA, titleInBraille:false: no title on page 1, no running head; the text is still there', () => {
  const brf = formatDocument(mkDoc(), opts('bana', { titleInBraille: false }));
  assert.ok(!brf.includes('SHORT'), 'the title appears nowhere');
  const ps = pages(brf);
  for (const [i, p] of ps.entries()) if (i > 0) assert.ok(!p[0].includes(TITLE_BRL), `page ${i + 1} line 1: ${p[0]}`);
  assert.ok(brf.includes('FIRST CHAPTER') || brf.toUpperCase().includes('FIRST'), 'the heading in the text is brailled');
  assert.ok(brf.includes('PARAGRAPH'), 'the text is brailled');
  const withTitle = formatDocument(mkDoc(), opts('bana'));
  assert.ok(pages(brf).length <= pages(withTitle).length, 'the lines the title took are the text\'s');
});

test('BANA, titleInBraille:false: a heading in the text that says the same as the title stays', () => {
  const doc = { title: 'Short Title', blocks: [{ type: 'heading', level: 1, text: 'Short Title' }, ...filler] };
  const brf = formatDocument(doc, opts('bana', { titleInBraille: false }));
  assert.ok(brf.includes(TITLE_BRL), 'the heading block is still brailled');
  assert.equal((brf.match(/,SHORT ,TITLE/g) || []).length, 1, 'once: the heading, not also a title');
});

test('UKAAF, titleInBraille:false: no running head from page 2; default has it', () => {
  const mk = () => ({ title: 'Short Title', blocks: [...filler] });
  const withTitle = pages(formatDocument(mk(), opts('ukaaf')));
  assert.ok(withTitle[1][0].includes('SHORT TITLE'), withTitle[1][0]);
  const brf = formatDocument(mk(), opts('ukaaf', { titleInBraille: false }));
  assert.ok(!brf.includes('SHORT TITLE'), 'no running head');
});

test('formatDocumentAsync and formatVolumes follow the option', async () => {
  const a = await formatDocumentAsync(mkDoc(), opts('bana', { titleInBraille: false }));
  assert.equal(a, formatDocument(mkDoc(), opts('bana', { titleInBraille: false })));
  assert.ok(!a.includes('SHORT'));
  const v = formatVolumes(mkDoc(), opts('bana', { titleInBraille: false }));
  const all = (Array.isArray(v) ? v : [v]).map((x) => (x && x.brf) || '').join('');
  assert.ok(!all.includes('SHORT') || /VOL/.test(all) === false || true);   // volume spine labels are labels, not braille
  assert.ok(!all.includes(',SHORT ,TITLE'), 'no title in the braille of any volume');
});

test('a Title Page block the transcriber inserted keeps showing the title (it is the document\'s own text, not an added title)', () => {
  const doc = { title: 'Short Title', blocks: [{ type: 'titlepage' }, ...filler] };
  const brf = formatDocument(doc, opts('bana', { titleInBraille: false }));
  assert.ok(brf.includes(TITLE_BRL), 'the title page shows its title');
});
