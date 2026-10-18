// The case table of the extreme-document test set (A89 step 4; see ../check-extreme-documents.mjs).
// A CASE is one kind of extreme document (the numbers follow Paul's brief of 2 Oct 2026); it is made of UNITS, one per file
// format. A unit is one child process: its file is generated just before it runs (`gen`), and it declares its own budget.
//   budget = { timeSec, heapMB, rssMB }
//     timeSec  wall-clock limit for the whole child (the parent kills it at that point: FAIL "timeout")
//     heapMB   the child's --max-old-space-size: a JavaScript heap beyond it is an out-of-memory crash (FAIL "OOM")
//     rssMB    the child's peak resident memory, WASM and buffers included (FAIL when over)
// A BATTERY unit holds many small items run one after another in one child (the malformed-input groups); each item has its
// own time limit (itemSec) and the parent re-runs the items after a crashed or hung one in a fresh child.
// Budgets were set from measured runs of the default set (2 Oct 2026, a 10-core Mac with load 5 from other sessions): 3 to 6 times the
// time measured, and about 2 times the peak resident memory measured, rounded. They are limits that mean "this is far outside normal"
// (a transcriber waits a minute for a big book, not ten), not targets; --time-scale multiplies every time budget for a slower machine.
// The heap limit (heapMB) is set a little above what the case really needs, so that a runaway allocation dies at it instead of
// swallowing the machine. A hostile battery's own budget is generous: it must cover the restarts after each hung item.
import { makeRng, bookBlocks, equationBlocks, tableBlocks, listBlocks, headingBlocks, longHeadingBlocks, hugeParagraphBlocks, longWordBlocks, tinyParagraphBlocks, unicodeBlocks, UNICODE_CATEGORIES, LONE_SURROGATES, sentence } from './content.mjs';
import { EMITTERS } from './emit.mjs';

const B = (timeSec, heapMB = 2048, rssMB = heapMB + 1536) => ({ timeSec, heapMB, rssMB });
const PIPE = { modes: ['bana', 'ukaaf'], roundTrip: true, expect: 'content' };

// One unit that writes `makeBlocks()` as `ext`.
const unit = (caseId, ext, makeBlocks, budget, pipe = {}, label = ext) => ({
  id: `${caseId}:${label}`, caseId, label, ext, budget,
  pipe: { ...PIPE, ...pipe },
  gen: () => EMITTERS[ext](makeBlocks(), { title: `Extreme ${caseId}` }),
});
const FIVE = ['xml', 'html', 'md', 'txt', 'docx'];          // NIMAS, HTML, Markdown, text, Word
const SEVEN = [...FIVE, 'rtf', 'odt'];

export function buildCases({ seed, heavy, hostile, canaryInfo }) {
  const cases = [];
  const add = (id, title, units) => cases.push({ id, title, units });

  // ---- 1. big book ----
  {
    const id = '01-bigbook';
    const book = (chars) => () => bookBlocks(makeRng(seed + 1), { targetChars: chars });
    const u = [unit(id, 'xml', book(11.9e6), B(240, 3072, 3000), { ebraille: true, minBlocks: 20000 }, 'xml-10MB')];
    for (const ext of ['html', 'md', 'txt', 'docx']) u.push(unit(id, ext, book(3e6), B(150, 2048, 2200), { minBlocks: 3000, editor: ext === 'html' }, `${ext}-3M`));
    for (const ext of ['epub', 'odt', 'rtf']) u.push(unit(id, ext, book(1.0e6), B(60, 1536, 1200), { minBlocks: 1000 }, `${ext}-1M`));
    if (heavy) {
      u.push(unit(id, 'xml', book(68e6), B(900, 8192, 10000), { roundTrip: true, minBlocks: 100000 }, 'xml-60MB'));
      u.push(unit(id, 'html', book(24e6), B(600, 6144, 7000), { modes: ['ukaaf'], roundTrip: false, minBlocks: 40000 }, 'html-20MB'));
      for (const ext of ['md', 'txt', 'docx']) u.push(unit(id, ext, book(24e6), B(600, ext === 'docx' ? 4096 : 3072, ext === 'docx' ? 4500 : 2000), { modes: ['ukaaf'], roundTrip: false, minBlocks: 30000 }, `${ext}-20MB`));
    }
    add(id, 'Big book: chapters, headings, paragraphs, lists, tables, page numbers, notes (NIMAS about 10 MB; 60 MB with --heavy)', u);
  }

  // ---- 2. 10,000 inline equations ----
  {
    const id = '02-equations';
    const eq = () => equationBlocks(makeRng(seed + 2), 10000);
    const u = [];
    for (const ext of ['xml', 'html', 'md', 'txt', 'docx']) u.push(unit(id, ext, eq, B(60, 1536, 1200), { minInlineMath: 8000, minBlocks: 2000 }, ext));
    add(id, '10,000 inline equations: MathML in NIMAS and HTML, LaTeX in Markdown and text, OMML in Word', u);
  }

  // ---- 3. 500 tables ----
  {
    const id = '03-tables';
    const tb = () => tableBlocks(makeRng(seed + 3), 500);
    const u = [];
    for (const ext of SEVEN) u.push(unit(id, ext, tb, B(60, 1536, 1200), { minBlocks: 100, ebraille: ext === 'xml', editor: ext === 'xml', g1: ext === 'xml' }, ext));
    // Span values far past the table edge, each in a tiny table of its own (a 60-byte file): the way to find where a reader or the
    // formatter gives up. A table holds two rows of two cells; the first cell carries the value.
    u.push({
      id: `${id}:span-extremes`, caseId: id, label: 'span-extremes', ext: 'mixed', battery: true, budget: B(300, 2048, 3000), itemSec: 25,
      items: async () => {
        const out = [];
        const table = (cell) => [{ t: 'table', rows: [[{ text: 'a', ...cell }, { text: 'b' }], [{ text: 'c' }, { text: 'd' }]] }];
        for (const ext of ['html', 'xml', 'docx', 'odt']) {
          for (const v of [100000, 1000000, 100000000, 4294967296]) out.push({ id: `${ext}-colspan-${v}`, name: `colspan.${ext}`, pipe: { ...PIPE, expect: 'tolerant' }, make: () => EMITTERS[ext](table({ colspan: v })) });
          out.push({ id: `${ext}-rowspan-1000000000`, name: `rowspan.${ext}`, pipe: { ...PIPE, expect: 'tolerant' }, make: () => EMITTERS[ext](table({ rowspan: 1000000000 })) });
        }
        return out;
      },
    });
    add(id, '500 tables: tiny, wide (60 columns), tall (5,000 rows), empty cells, span chaos, nested; and spans of 100,000 and more', u);
  }

  // ---- 4. nested lists ----
  {
    const u = [];
    const id = '04-lists';
    for (const depth of [20, 200]) {
      const ls = () => listBlocks(makeRng(seed + 4 + depth), { depth, chains: depth > 50 ? 3 : 5, flat: depth > 50 ? 0 : 10000 });
      for (const ext of [...FIVE, 'odt']) u.push(unit(id, ext, ls, B(45, 1536, 1200), { minBlocks: 3, ebraille: ext === 'xml', editor: ext === 'xml' }, `depth${depth}-${ext}`));
    }
    add(id, 'Lists nested 20 and 200 deep, mixed bullets and numbers, very long items', u);
  }

  // ---- 5. headings ----
  {
    const id = '05-headings';
    const u = [];
    for (const ext of SEVEN) u.push(unit(id, ext, () => headingBlocks(makeRng(seed + 5), 5000), B(30, 1024, 800), { minBlocks: 1000, ebraille: ext === 'xml', editor: ext === 'xml' }, `5000-${ext}`));
    for (const ext of SEVEN) u.push(unit(id, ext, () => longHeadingBlocks(makeRng(seed + 55), 10000), B(30, 1024, 800), { minBlocks: 1 }, `10000chars-${ext}`));
    add(id, '5,000 headings and nothing else; a heading 10,000 characters long', u);
  }

  // ---- 6. pathological text ----
  {
    const id = '06-text';
    const u = [];
    for (const ext of FIVE) u.push(unit(id, ext, () => hugeParagraphBlocks(makeRng(seed + 6), 1 << 20), B(45, 1536, 1200), { minBlocks: 2 }, `1MB-no-spaces-${ext}`));
    for (const ext of FIVE) u.push(unit(id, ext, () => longWordBlocks(makeRng(seed + 66), 100000), B(45, 1536, 1200), { minBlocks: 2 }, `100k-letter-word-${ext}`));
    for (const ext of FIVE) u.push(unit(id, ext, () => tinyParagraphBlocks(makeRng(seed + 666), 50000), B(45, 1536, 2400), { minBlocks: 1000 }, `50k-tiny-paragraphs-${ext}`));
    add(id, 'One paragraph of 1 MB with no spaces; a word of 100,000 letters; 50,000 one-character paragraphs', u);
  }

  // ---- 7. scripts and Unicode ----
  {
    const id = '07-unicode';
    const clean = ['hebrew', 'arabic', 'bidi_mixed', 'zalgo', 'emoji', 'astral', 'zero_width', 'cjk', 'no_table_script'];
    const raw = ['controls', 'mid_bom'];
    const nonchar = ['noncharacters'];     // one category on its own: U+FFFF currently reaches the BRF (see the report), and would fail every mix it was in
    const u = [];
    for (const ext of SEVEN) u.push(unit(id, ext, () => unicodeBlocks(makeRng(seed + 7), clean, 25), B(90, 1024, 800), { minBlocks: 20, ebraille: ext === 'xml', editor: ext === 'xml' }, `scripts-${ext}`));
    for (const ext of FIVE) u.push(unit(id, ext, () => unicodeBlocks(makeRng(seed + 77), raw, 25), B(60, 1024, 800), { expect: 'tolerant' }, `control-chars-${ext}`));
    // one text file per category: a failure points at the category
    u.push({
      id: `${id}:each-category-txt`, caseId: id, label: 'each-category-txt', ext: 'txt', battery: true, budget: B(90, 1024, 800), itemSec: 45,
      items: async () => [...clean, ...raw, ...nonchar].map((name) => ({
        id: `category-${name}`, name: `${name}.txt`, pipe: { ...PIPE, expect: raw.includes(name) || nonchar.includes(name) ? 'tolerant' : 'content', g1: name === 'zalgo' || name === 'hebrew' },
        make: () => EMITTERS.txt(unicodeBlocks(makeRng(seed + 777), [name], 30)),
      })),
    });
    // model level: strings no file can carry (lone surrogates) and odd models, straight into the formatter and the NIMAS writer
    u.push({
      id: `${id}:model-level`, caseId: id, label: 'model-level', ext: 'json', battery: true, budget: B(60, 1536, 1200), itemSec: 30,
      items: async () => {
        const r = makeRng(seed + 7777);
        const j = (blocks) => Buffer.from(JSON.stringify({ title: null, blocks }), 'utf8');
        return [
          { id: 'lone-surrogates-in-paragraphs-and-headings', make: () => j([{ type: 'heading', level: 1, text: `Head \ud800 ${sentence(r)}` }, { type: 'para', text: LONE_SURROGATES(r) }, { type: 'list', items: [{ text: `\udc00 item ${sentence(r)}`, level: 0 }] }]) },
          { id: 'lone-surrogates-in-table-cells-and-notes', make: () => j([{ type: 'para', text: 'ok' }, { type: 'table', rows: [[{ text: '\ud800' }, { text: '\udfff\ud800' }]] }, { type: 'note', text: '\ud83d' }]) },
          { id: 'nul-and-c0-controls-in-text', make: () => j([{ type: 'heading', level: 1, text: 'a\u0000b\u0001c' }, { type: 'para', text: 'x\u0000y\u0007z\u001b[31m\u007f\u0085end' }]) },
          { id: 'noncharacters-and-fffd', make: () => j([{ type: 'para', text: 'a￾b￿c﷐d�e' }]) },
          { id: 'huge-code-point-combining-run-100000', make: () => j([{ type: 'para', text: 'e' + '́'.repeat(100000) + ' end' }]) },
          { id: 'segments-with-unknown-types-and-nulls', make: () => j([{ type: 'para', segments: [{ type: 'text', text: 'a' }, null, { type: 'mystery' }, { type: 'math' }, { type: 'text' }] }, { type: 'para' }, { type: 'mystery' }, null, { type: 'list', items: [null, {}, { text: 'x' }] }]) },
          { id: 'tables-ragged-and-null-cells', make: () => j([{ type: 'table', rows: [[{ text: 'a' }, null, { text: 'c' }], [], [{ text: 'd', colspan: 99 }], null] }, { type: 'table', rows: [] }, { type: 'table' }]) },
          { id: 'heading-levels-out-of-range', make: () => j([{ type: 'heading', level: 0, text: 'zero' }, { type: 'heading', level: 99, text: 'ninety-nine' }, { type: 'heading', level: -3, text: 'negative' }, { type: 'heading', level: 'x', text: 'text level' }, { type: 'para', text: 'end' }]) },
        ].map((it) => ({ ...it, name: `${it.id}.model.json`, modelJson: true, pipe: { ...PIPE, expect: 'tolerant', modes: ['bana', 'ukaaf'] } }));
      },
    });
    add(id, 'Scripts and Unicode: Hebrew, Arabic, bidi, Zalgo, emoji and ZWJ, astral, zero-width and bidi controls, C0/C1 controls, BOM, lone surrogates, non-characters, CJK, scripts with no table', u);
  }

  // ---- 8. malformed and hostile input ----
  {
    const id = '08-hostile';
    const u = [];
    const bat = (group, label, itemSec = 30, budget = B(600, 2048, 4000)) => u.push({
      id: `${id}:${label}`, caseId: id, label, ext: group, battery: true, budget, itemSec,
      items: async () => (await hostile())[group].map((h) => ({ ...h, pipe: { ...PIPE, expect: 'tolerant', modes: ['bana', 'ukaaf'] }, ...(h.extra || {}) })),
    });
    bat('xml', 'nimas-xml'); bat('html', 'html'); bat('md', 'markdown'); bat('txt', 'text'); bat('rtf', 'rtf');
    bat('docx', 'docx'); bat('odt', 'odt'); bat('epub', 'epub'); bat('lies', 'extension-lies'); bat('zero', 'zero-and-one-byte-files', 20);
    const SOLO = [
      ['zip-bomb-1gb-inflates-in-docx', B(180, 2048, 2200)], ['zip-bomb-1gb-inflates-in-odt', B(180, 2048, 2200)], ['zip-bomb-1gb-inflates-in-epub', B(180, 2048, 2200)],
    ];
    const soloBudget = (itemId) => (itemId.startsWith('nest-') ? B(30, 1024, 800) : B(60, 2048, 2200));      // a 125 KB entity file must not need more than the heap limit; a 400-deep file is 20 KB
    // one unit per solo item; the list is known without building anything (ids are fixed here)
    const soloIds = [
      ...SOLO.map((s) => s[0]),
      'entity-billion-laughs-in-nimas', 'entity-quadratic-blowup-in-nimas', 'entity-billion-laughs-in-html', 'entity-billion-laughs-in-docx', 'entity-billion-laughs-in-odt', 'entity-billion-laughs-in-epub-chapter',
      'xxe-file-entity-in-nimas', 'xxe-http-entity-in-nimas', 'xxe-external-dtd-in-nimas', 'xxe-parameter-entity-in-nimas', 'xxe-xinclude-in-nimas', 'xxe-file-entity-in-html', 'xxe-file-entity-in-docx', 'xxe-file-entity-in-odt', 'xxe-file-entity-in-epub-package',
      ...[400, 5000].flatMap((n) => [`nest-${n}-nimas-level`, `nest-${n}-nimas-list`, `nest-${n}-nimas-inline-em`, `nest-${n}-nimas-blockquote`, `nest-${n}-nimas-table`, `nest-${n}-nimas-mathml`, `nest-${n}-html-div`, `nest-${n}-html-span`, `nest-${n}-html-list`, `nest-${n}-html-table`, `nest-${n}-html-blockquote`, `nest-${n}-html-font-unclosed`]),
    ];
    for (const sid of soloIds) {
      const budget = (SOLO.find((s) => s[0] === sid) || [null, soloBudget(sid)])[1];
      u.push({
        id: `${id}:${sid}`, caseId: id, label: sid, ext: 'solo', battery: true, solo: true, budget, itemSec: budget.timeSec,
        items: async () => [{ ...(await hostile()).solo.find((h) => h.id === sid), pipe: { ...PIPE, expect: 'tolerant' } }].map((h) => ({ ...h, ...(h.extra || {}) })),
      });
    }
    add(id, 'Malformed and hostile input in every reader: truncation, bad bytes, lying zips, zip bombs, entity bombs, XXE, deep nesting, extension lies, empty files', u);
  }
  return cases;
}
