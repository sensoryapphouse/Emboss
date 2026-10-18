// Findings batch C (formatter side, 24 Sep 2026): F-227 (word list moved before its exercise,
// 10.7.2e), F-233 (hyperlink indicator, 6.12.3.b(3)), F-4 (untitled-table caption identifier,
// 11.2.8b), F-16 (ditto marks, 11.6.6). Every new field is optional; a block/document without
// it is formatted exactly as before (checked per finding). F-30 (4.5.3 multi-column-list blank
// line) was investigated and found already built (`block.columns` + `columnedListPlan` in
// `joinsWithoutBlank`) — a regression check for it is included here too.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBlock, traceBlock, formatDocument, getBlockSignature } from '../format/document.mjs';

const up = (s) => String(s).toUpperCase();
// A stand-in translator that shows emphasis: an emphasised run comes out as "{...}".
const mark = (t, tf) => {
  const s = up(t);
  if (Array.isArray(tf)) { let r = '', open = false; for (let i = 0; i < s.length; i++) { const on = !!tf[i]; if (on && !open) r += '{'; if (!on && open) r += '}'; open = on; r += s[i]; } return open ? r + '}' : r; }
  return tf ? `{${s}}` : s;
};
// document.mjs's own header comment requires o.translatePos to mirror o.translate exactly
// ("o.translatePos... mirrors o.translate"); since the "one layout path" stage 2 task routes
// formatBlock's 'para'/'heading'/'list'/'box' cases through traceBlockCore too, formatBlock
// itself now prefers translatePos over translate whenever the caller supplies one, so
// o.translatePos must mirror `mark`, not just `up` (previously formatPara/etc. never looked
// at translatePos at all, so a typeform-blind stand-in was harmless here).
const markPos = (s, tf) => { const b = mark(s, tf); return { braille: b, inputPos: Array.from(b, (_, i) => Math.min(i, Math.max(0, String(s).length - 1))) }; };
const o = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate: mark, translatePos: markPos, suppressHeader: true };
const ob = { ...o, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }) };   // typeform-blind twin (traceBlock's own translatePos cannot see typeforms)
const rstrip = (l) => l.replace(/\s+$/, '');
const both = (block, opts = ob) => {
  const f = formatBlock(block, opts).map(rstrip);
  const t = traceBlock(block, opts).map((x) => rstrip(x.s));
  assert.deepEqual(t, f, 'traceBlock must match formatBlock');
  return f;
};
const sig = (b) => getBlockSignature(b, o, false);

describe('F-227 / BANA 10.7.2e: word list moved before its exercise', () => {
  const doc = (wordListBlock) => ({ blocks: [
    { type: 'para', text: 'Directions.' },
    { type: 'list', kind: 'exercise', items: [{ text: '1. Q one' }, { text: '2. Q two' }] },
    wordListBlock,
  ] });
  test('a plain word-list block after the exercise is moved before it', () => {
    const wl = { type: 'list', kind: 'list', wordList: true, items: [{ text: 'alpha' }, { text: 'beta' }] };
    const out = formatDocument(doc(wl), o);
    assert.ok(out.indexOf('ALPHA') < out.indexOf('1. Q ONE'), 'word list must render before the exercise');
  });
  test('a box-wrapped word list (answer choices in a box, 10.7.2f) moves as the whole box', () => {
    const wl = { type: 'box', blocks: [{ type: 'list', kind: 'list', wordList: true, items: [{ text: 'alpha' }, { text: 'beta' }] }] };
    const out = formatDocument(doc(wl), o);
    assert.ok(/7+/.test(out), 'box lines must still be present');
    assert.ok(out.indexOf('ALPHA') < out.indexOf('1. Q ONE'), 'boxed word list must render before the exercise');
  });
  test('no wordList flag: block order is unchanged (default behaviour)', () => {
    const plain = { type: 'list', kind: 'list', items: [{ text: 'alpha' }, { text: 'beta' }] };
    const out = formatDocument(doc(plain), o);
    assert.ok(out.indexOf('1. Q ONE') < out.indexOf('ALPHA'), 'without wordList, print order is kept');
  });
  test('a word list already before its exercise is left alone', () => {
    const wl = { type: 'list', kind: 'list', wordList: true, items: [{ text: 'alpha' }] };
    const docAlreadyOrdered = { blocks: [
      { type: 'para', text: 'Directions.' },
      wl,
      { type: 'list', kind: 'exercise', items: [{ text: '1. Q one' }] },
    ] };
    const out = formatDocument(docAlreadyOrdered, o);
    assert.ok(out.indexOf('ALPHA') < out.indexOf('1. Q ONE'));
  });
});

describe('F-233 / BANA 6.12.3.b(3): hyperlink indicator layered on top of typeform', () => {
  const segs = () => [{ type: 'text', text: 'Click ' }, { type: 'text', text: 'here', hyperlink: true, tf: 1 }, { type: 'text', text: ' now.' }];
  test('a hyperlinked segment is wrapped in @#7 ... @#\', typeform kept inside', () => {
    const out = formatBlock({ type: 'para', segments: segs() }, o).join('\n');
    assert.ok(out.includes("@#7{HERE}@#'"), out);
  });
  test('formatBlock/traceBlock parity (A39)', () => {
    both({ type: 'para', segments: segs() });
  });
  test('a plain segment (no hyperlink field) is unaffected (default behaviour)', () => {
    const plain = { type: 'para', segments: [{ type: 'text', text: 'No links here.' }] };
    assert.ok(!formatBlock(plain, o).join('\n').includes('@#7'));
  });
  test('cache key changes with the hyperlink flag', () => {
    const a = { type: 'para', segments: [{ type: 'text', text: 'here' }] };
    const b = { type: 'para', segments: [{ type: 'text', text: 'here', hyperlink: true }] };
    assert.notEqual(sig(a), sig(b));
  });
});

describe('F-4 / BANA 11.2.8b: untitled-table caption gets a transcriber’s-note identifier', () => {
  test('block.identifier === true wraps the caption text as given (print already names it)', () => {
    const b = { type: 'caption', text: 'Figure 24-7 The APY is the best indicator.', identifier: true };
    const out = formatBlock(b, ob).join('\n');
    assert.ok(out.includes('@.<FIGURE 24-7'), out);
    assert.ok(out.trim().endsWith('@.>'), out);
  });
  test('block.identifier as a string is translated and prefixed on the same line', () => {
    const b = { type: 'caption', text: 'A summary of results.', identifier: 'Table' };
    const out = formatBlock(b, ob).join('\n');
    assert.ok(out.includes('@.<TABLE A SUMMARY OF RESULTS.@.>'), out);
  });
  test('formatBlock/traceBlock parity (A39)', () => {
    both({ type: 'caption', text: 'Figure 24-7 The APY is the best indicator.', identifier: true });
    both({ type: 'caption', text: 'A summary of results.', identifier: 'Table' });
  });
  test('no identifier field: caption renders exactly as before (default behaviour)', () => {
    const b = { type: 'caption', text: 'An ordinary caption.' };
    const out = formatBlock(b, ob).join('\n');
    assert.ok(!out.includes('@.<'), out);
  });
  test('cache key changes with the identifier field', () => {
    const a = { type: 'caption', text: 'X.' };
    const b = { type: 'caption', text: 'X.', identifier: true };
    assert.notEqual(sig(a), sig(b));
  });
});

describe('F-16 / BANA 11.6.6: ditto marks (dots 5, 2), left-adjusted, opt-in per table', () => {
  const table = (dittoMarks) => ({
    type: 'table', format: 'columnar', dittoMarks,
    headers: ['Price', 'Surplus/Shortage', 'Price Will'],
    rows: [['1.00', 'Surplus', 'Fall'], ['0.90', '"', '"'], ['0.80', '"', '"']],
  });
  test('dittoMarks: true renders a lone quote cell as the literal ditto ("1), not a translated quotation mark', () => {
    const out = formatBlock(table(true), ob).join('\n');
    const rows = out.split('\n').filter((l) => l.trim().startsWith('0.9') || l.trim().startsWith('0.8'));
    assert.ok(rows.length === 2, out);
    for (const r of rows) assert.ok(r.includes('"1'), r);
  });
  test('default (no dittoMarks field): a lone quote cell keeps today’s translated-quote behaviour', () => {
    const out = formatBlock(table(undefined), ob).join('\n');
    assert.ok(!out.includes('"1'), out);
  });
  test('formatBlock/traceBlock parity (A39)', () => {
    both(table(true));
    both(table(undefined));
  });
  test('cache key changes with dittoMarks', () => {
    assert.notEqual(sig(table(true)), sig(table(undefined)));
  });
});

describe('F-30 / BANA 4.5.3: multi-column list keeps its blank line after a heading (already built, regression check)', () => {
  test('a single-column list after a heading drops the blank line (unchanged base rule)', () => {
    const docSingle = { blocks: [{ type: 'heading', level: 2, text: 'Heading' }, { type: 'list', kind: 'list', items: [{ text: 'alpha' }] }] };
    const out = formatDocument(docSingle, o);
    const lines = out.split('\n');
    const headingIdx = lines.findIndex((l) => l.includes('HEADING'));
    assert.ok(lines[headingIdx + 1].trim() !== '', 'no blank line should follow the heading');
  });
  test('a multi-column list (block.columns > 1) after a heading keeps the blank line (the exception)', () => {
    const docCols = { blocks: [{ type: 'heading', level: 5, text: 'Heading' }, { type: 'list', kind: 'list', columns: 2, items: [{ text: 'alpha' }, { text: 'beta' }, { text: 'gamma' }, { text: 'delta' }] }] };
    const out = formatDocument(docCols, o);
    const lines = out.split('\n');
    const headingIdx = lines.findIndex((l) => l.includes('HEADING'));
    assert.ok(lines[headingIdx + 1].trim() === '', 'blank line must follow the heading');
  });
});
