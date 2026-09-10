import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDocument } from '../format/document.mjs';
import { styledTranslate, exchangeQuotes } from '../format/text-style.mjs';
import { transpileTactileSvg, createGraphicBlock } from '../format/tactile-svg.mjs';
import { makeMathToBrf } from '../format/node-maths-helper.mjs';

const mathToBrf = makeMathToBrf('ukaaf');

const opts = {
  mode: 'ukaaf',
  width: 38,
  depth: 25,
  paragraphStyle: 'indented',
  translate: (s) => (s || '').toUpperCase(),
  mathToBrf: (seg) => {
    try { return mathToBrf(seg.mathml || seg.latex || ''); } catch { return '???'; }
  }
};

test('Fuzz: Unicode & Typography Torture Strings', () => {
  const tortureStrings = [
    '',
    '\u0000\u0001\u0002\u0003\u0004\u0005',
    'Zalgo: Ṯ̴͌ë̸́ͅx̷̭͠t̴̍ͅ ̸̝͝ẅ̴̮ḯ̴̥t̷̟̋h̴̤͝ ̶̈́ͅc̸̭̈́o̷̞̿m̵͈̈́b̸̝͌i̸̮͋n̴̯̍ḯ̴̯n̸͕͒g̸͓̑ ̸̮̀m̸͕̈́ä̵̖́r̸̒ͅk̸͍̈s̷͇̾',
    'RTL Override: \u202eThis is reversed text\u202c and normal text',
    'Zero Widths: A\u200bB\u200cC\u200dD\ufeffE',
    'Surrogates & Emojis: 👨‍👩‍👧‍👦 🏳️‍⚧️ 🦼 🌍 🚀 🧪 🧮 📐',
    'Unmatched Quotes: "This \'is a "crazy \'unclosed «quote» string”',
    'Consecutive punctuation: ...... !?!?!?!? --- ::: ;;; ;;; ,,,',
    'Huge single unbroken word: ' + 'A'.repeat(500),
    'Whitespace madness: \t\t\n\r\n   \u00a0\u2000\u2001\u2002\u2003\u2009\u200a   ',
    'Mixed scripts: English, Русский, Ελληνικά, 日本語, العربية, עברית, 中文',
    'Extreme symbols: © ® ™ § ¶ † ‡ • ‰ ‱ ′ ″ ‴ ‼ ⁇ ⁈ ⁉',
  ];

  for (const s of tortureStrings) {
    assert.doesNotThrow(() => {
      const brf = formatDocument({
        title: 'Fuzz Test',
        blocks: [
          { type: 'para', text: s },
          { type: 'heading', level: 1, text: s },
          { type: 'list', items: [{ text: s }, { text: s }] }
        ]
      }, opts);
      assert.equal(typeof brf, 'string');
    }, `Failed on torture string: ${s.slice(0, 30)}`);
  }
});

test('Fuzz: Malformed & Pathological LaTeX / MathML', () => {
  const badMath = [
    { latex: '\\frac{1}{' },
    { latex: '\\sqrt[3]' },
    { latex: '\\begin{matrix} 1 & 2 \\\\ 3 \\end{matrix}' },
    { latex: '\\int_{0}^{' },
    { latex: '\\unknowncommand{xyz}' },
    { latex: '\\left( \\frac{1}{2} \\right.' },
    { latex: 'a^b^c^d^e^f^g' },
    { mathml: '<mrow><mfrac><mi>x</mi></mfrac></mrow>' },
    { mathml: '<math><unclosed>' },
    { mathml: '<math><msubsup><mi>x</mi></msubsup></math>' },
    { mathml: 'not xml at all <<>> & &amp;' },
    { latex: 'x'.repeat(1000) }
  ];

  for (const m of badMath) {
    assert.doesNotThrow(() => {
      const brf = formatDocument({
        title: 'Math Fuzz',
        blocks: [
          { type: 'para', segments: [
            { type: 'text', text: 'Equation: ' },
            { type: 'math', ...m },
            { type: 'text', text: ' done.' }
          ]},
          { type: 'math', ...m }
        ]
      }, opts);
      assert.equal(typeof brf, 'string');
    }, `Failed on bad math: ${JSON.stringify(m)}`);
  }
});

test('Fuzz: Corrupt & Pathological SVGs in Tactile Transpiler', () => {
  const badSvgs = [
    '',
    '<svg></svg>',
    '<svg viewBox="0 0 0 0"><rect width="0" height="0"/></svg>',
    '<svg viewBox="0 0 -100 -100"><circle r="-10"/></svg>',
    '<svg width="100000" height="100000"><path d="M 0 0 L 100000 100000"/></svg>',
    '<svg><path d="M 10 10 Q 20 20 T 30 30 C 40 40 50 50 60 60 A 10 10 0 0 1 70 70 Z"/></svg>',
    '<svg><g transform="matrix(0,0,0,0,0,0)"><rect width="10" height="10"/></g></svg>',
    '<svg><defs><pattern id="p"><use href="#p"/></pattern></defs><rect fill="url(#p)" width="10" height="10"/></svg>',
    '<div>Not even an SVG</div>',
    '<?xml version="1.0"?><svg viewBox="0 0 100 100"><text x="10" y="20">Hello &amp; < > " \'</text></svg>'
  ];

  for (const svg of badSvgs) {
    assert.doesNotThrow(() => {
      const transpiled = transpileTactileSvg(svg, {
        target: 'viewplus',
        widthCells: 38,
        heightLines: 15,
        brailleTranslator: (s) => s.toUpperCase()
      });
      assert.ok(transpiled && typeof transpiled.svg === 'string');
    }, `Failed on SVG: ${svg.slice(0, 30)}`);
  }
});

test('Fuzz: Degenerate Spatial Tables', () => {
  const badTables = [
    { headers: [], rows: [] },
    { headers: ['Col 1'], rows: [] },
    { headers: [], rows: [['Cell 1', 'Cell 2']] },
    { headers: ['A', 'B', 'C'], rows: [['1'], ['1', '2', '3', '4', '5'], []] },
    { headers: ['A'.repeat(100), 'B'.repeat(100)], rows: [['1'.repeat(100), '2'.repeat(100)]] },
    { headers: [''], rows: [[''], ['']] },
  ];

  for (const tbl of badTables) {
    assert.doesNotThrow(() => {
      const brf = formatDocument({
        title: 'Table Fuzz',
        blocks: [
          { type: 'table', headers: tbl.headers, rows: tbl.rows }
        ]
      }, opts);
      assert.equal(typeof brf, 'string');
    }, `Failed on degenerate table: ${JSON.stringify(tbl)}`);
  }
});
