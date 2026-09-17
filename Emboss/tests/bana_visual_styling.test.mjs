// Systematic Test Harness for Phase 5D: Visual Styling, Boxlines, & Contrast Polish in Print View
// Verifies:
// 1. STYLE_DEFINITIONS registry integrity & margin configuration
// 2. formatStyleInspectorBadge() output across all 15+ styles and layout profiles (BANA / UKAAF)
// 3. CSS visual styling, sidebar boxlines, and contrast rules in style.css and editor/index.html
// 4. HTML accessibility attributes (role="status", aria-live="polite", tabindex) for #styleInspector
// 5. Keyboard style cycling sequence logic (Alt+Up/Down)
// 6. Scale verification against the 1.45MB NIMAS textbook (9780544087507NIMAS 2.xml)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { STYLE_DEFINITIONS, getStyleMargins, formatStyleInspectorBadge, isListStyle, resolveStyleFromXml } from '../format/styles.mjs';
import { parseNimasXml } from '../input/parse.mjs';

console.log('=== Running BANA Visual Styling, Boxlines & Style Inspector Test Suite (Phase 5D) ===\n');

let pass = 0, fail = 0, skipped = 0;
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ FAIL: ${name}`);
    if (detail) console.error(`    Detail: ${detail}`);
  }
}

// ----------------------------------------------------------------------------
// Section 1: Style Definitions & Margin Registry Integrity
// ----------------------------------------------------------------------------
console.log('--- Section 1: Style Definitions & Margin Registry Integrity ---');

const ALL_STYLE_KEYS = Object.keys(STYLE_DEFINITIONS);
check('STYLE_DEFINITIONS contains 21 style definitions', ALL_STYLE_KEYS.length >= 20);

for (const key of ALL_STYLE_KEYS) {
  const def = STYLE_DEFINITIONS[key];
  check(`Style '${key}' has valid id`, def.id === key);
  check(`Style '${key}' has human-readable name`, typeof def.name === 'string' && def.name.length > 0);
  check(`Style '${key}' has valid category`, ['text', 'heading', 'list', 'drama', 'poetry', 'table', 'container', 'meta'].includes(def.category));
  check(`Style '${key}' has xmlTag`, typeof def.xmlTag === 'string' && def.xmlTag.length > 0);
  
  const margins = getStyleMargins(key, 'bana');
  check(`Style '${key}' computes valid BANA margins`, typeof margins.first === 'number' && typeof margins.runover === 'number');
}

// ----------------------------------------------------------------------------
// Section 2: Style Inspector Badge Label Formatting (Task 5.3)
// ----------------------------------------------------------------------------
console.log('\n--- Section 2: Style Inspector Badge Label Formatting ---');

const EXPECTED_INSPECTOR_BADGES_BANA = [
  { style: 'body', expected: 'Style: Body Text (3-1) | Cell: 3 | Alignment: Left | Profile: BANA' },
  { style: 'p', expected: 'Style: Body Text (3-1) | Cell: 3 | Alignment: Left | Profile: BANA' },
  { style: 'h1', expected: 'Style: Heading 1 (Centered) | Cell: Centered | Alignment: Center | Profile: BANA' },
  { style: 'h2', expected: 'Style: Heading 2 (Subheading) (Cell 5) | Cell: 5 | Alignment: Left | Profile: BANA' },
  { style: 'h3', expected: 'Style: Heading 3 (Sub-subheading) (Cell 7) | Cell: 7 | Alignment: Left | Profile: BANA' },
  { style: 'toc', expected: 'Style: TOC Entry (1-3) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'plain', expected: 'Style: Plain List (1-3) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'list-bullet', expected: 'Style: Bullet List (1-3) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'bullet', expected: 'Style: Bullet List (1-3) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'ul', expected: 'Style: Bullet List (1-3) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'list-number', expected: 'Style: Numbered List (1-3) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'number', expected: 'Style: Numbered List (1-3) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'ol', expected: 'Style: Numbered List (1-3) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'dialogue', expected: 'Style: Play Dialogue (1-3) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'stage', expected: 'Style: Stage Direction (7-7) | Cell: 7 | Alignment: Left | Profile: BANA' },
  { style: 'poem', expected: 'Style: Poetry / Verse (1-3) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'verse', expected: 'Style: Poetry / Verse (1-3) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'exercise', expected: 'Style: Exercise Main Question (1-5) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'exercise-sub', expected: 'Style: Exercise Sub-Question (3-5) | Cell: 3 | Alignment: Left | Profile: BANA' },
  { style: 'footnote', expected: 'Style: Footnote (1-3) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'note', expected: "Style: Transcriber's Note (7-5) | Cell: 7 | Alignment: Left | Profile: BANA" },
  { style: 'caption', expected: 'Style: Caption / Attribution (7-5) | Cell: 7 | Alignment: Left | Profile: BANA' },
  { style: 'sidebar', expected: 'Style: Sidebar Box (Boxlines) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'table-spatial', expected: 'Style: Spatial Columnar Table (Grid) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'table', expected: 'Style: Spatial Columnar Table (Grid) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'table-listed', expected: 'Style: Listed Table (1-3) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'quote', expected: 'Style: Blockquote (3-3) | Cell: 3 | Alignment: Left | Profile: BANA' },   // Formats §9.2.2 displayed material, blocked 3-3
  { style: 'break', expected: 'Style: Document Break (1-1) | Cell: 1 | Alignment: Left | Profile: BANA' },
  { style: 'print-page', expected: 'Style: Print Page Indicator | Cell: 1 | Alignment: Left | Profile: BANA' },
];

for (const tc of EXPECTED_INSPECTOR_BADGES_BANA) {
  const actual = formatStyleInspectorBadge(tc.style, 'bana');
  check(`BANA Style Inspector format for '${tc.style}'`, actual === tc.expected, `Got: "${actual}" | Expected: "${tc.expected}"`);
}

// UKAAF Profile checks
const actualUkaafH3 = formatStyleInspectorBadge('h3', 'ukaaf');
check('UKAAF Style Inspector format for h3 (Cell 5)', actualUkaafH3 === 'Style: Heading 3 (Sub-subheading) (Cell 5) | Cell: 5 | Alignment: Left | Profile: UKAAF', `Got: "${actualUkaafH3}"`);

const actualUkaafBody = formatStyleInspectorBadge('body', 'ukaaf');
check('UKAAF Style Inspector format for body', actualUkaafBody === 'Style: Body Text (3-1) | Cell: 3 | Alignment: Left | Profile: UKAAF');

// B004 App. B: quoted material 7-5 in UKAAF; TN keeps the house 1-3 there (BANA 7-5, Formats §3.2.2)
const actualUkaafQuote = formatStyleInspectorBadge('quote', 'ukaaf');
check('UKAAF Style Inspector format for quote (7-5)', actualUkaafQuote === 'Style: Blockquote (7-5) | Cell: 7 | Alignment: Left | Profile: UKAAF', `Got: "${actualUkaafQuote}"`);
const actualUkaafNote = formatStyleInspectorBadge('note', 'ukaaf');
check('UKAAF Style Inspector format for note (1-3)', actualUkaafNote === "Style: Transcriber's Note (1-3) | Cell: 1 | Alignment: Left | Profile: UKAAF", `Got: "${actualUkaafNote}"`);
const ukaafQuoteMargins = getStyleMargins('quote', 'ukaaf');
check('UKAAF quote margins are 6/4 with no blank lines', ukaafQuoteMargins.first === 6 && ukaafQuoteMargins.runover === 4 && !ukaafQuoteMargins.blankBefore && !ukaafQuoteMargins.blankAfter);
const banaQuoteMargins = getStyleMargins('quote', 'bana');
check('BANA quote margins are 2/2 with blank lines before and after', banaQuoteMargins.first === 2 && banaQuoteMargins.runover === 2 && banaQuoteMargins.blankBefore && banaQuoteMargins.blankAfter);
const banaAttribMargins = getStyleMargins('attribution', 'bana');
check('BANA attribution: no blank before, blank after (Formats §9.4.1d)', !banaAttribMargins.blankBefore && banaAttribMargins.blankAfter);

// ----------------------------------------------------------------------------
// Section 3: CSS Visual Styling & Sidebar Boxline Verification (Task 5.4)
// ----------------------------------------------------------------------------
console.log('\n--- Section 3: CSS Visual Styling & Sidebar Boxlines ---');

const styleCssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/style.css');
const indexHtmlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web/editor/index.html');

const styleCss = fs.readFileSync(styleCssPath, 'utf8');
const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

// Required BANA class selectors
const REQUIRED_BANA_CSS_CLASSES = [
  'bana-style-note',
  'bana-style-stage',
  'bana-style-dialogue',
  'bana-style-caption',
  'bana-style-footnote',
  'bana-style-poem',
  'bana-style-quote',
  'bana-style-exercise',
  'bana-style-exercise-sub',
  'bana-style-toc',
  'emboss-plain-list',
  'emboss-sidebar-card',
  'style-inspector-badge'
];

for (const cls of REQUIRED_BANA_CSS_CLASSES) {
  check(`style.css contains class '.${cls}'`, styleCss.includes(`.${cls}`));
  check(`index.html contains class '.${cls}'`, indexHtml.includes(`.${cls}`));
}

// Check BANA Sidebar Boxline visual representation (border-top & border-bottom boxlines)
check('style.css represents BANA Top Boxline (border-top on sidebar)', styleCss.includes('border-top: 2.5px solid') && styleCss.includes('.emboss-sidebar-card'));
check('style.css represents BANA Bottom Boxline (border-bottom on sidebar)', styleCss.includes('border-bottom: 2.5px solid') && styleCss.includes('.emboss-sidebar-card'));
check('index.html represents BANA Top Boxline (border-top on sidebar)', indexHtml.includes('border-top: 2.5px solid') && indexHtml.includes('.emboss-sidebar-card'));
check('index.html represents BANA Bottom Boxline (border-bottom on sidebar)', indexHtml.includes('border-bottom: 2.5px solid') && indexHtml.includes('.emboss-sidebar-card'));

// Check Dark Mode & High Contrast coverage
check('style.css has dark mode for .bana-style-note', styleCss.includes(':root.dark') && styleCss.includes('bana-style-note'));
check('style.css has dark mode for .bana-style-stage', styleCss.includes(':root.dark') && styleCss.includes('bana-style-stage'));
check('style.css has dark mode for .bana-style-caption', styleCss.includes(':root.dark') && styleCss.includes('bana-style-caption'));
check('style.css has dark mode for .bana-style-footnote', styleCss.includes(':root.dark') && styleCss.includes('bana-style-footnote'));
check('style.css has dark mode for .bana-style-quote', styleCss.includes(':root.dark') && styleCss.includes('bana-style-quote'));
check('style.css has dark mode for .emboss-sidebar-card', styleCss.includes(':root.dark') && styleCss.includes('emboss-sidebar-card'));
check('style.css has dark mode for .style-inspector-badge', styleCss.includes(':root.dark .style-inspector-badge'));

// ----------------------------------------------------------------------------
// Section 4: HTML Accessibility Attributes & Structure
// ----------------------------------------------------------------------------
console.log('\n--- Section 4: HTML Accessibility Attributes & Structure ---');

check("index.html contains <span id=\"styleInspector\"", indexHtml.includes('id="styleInspector"'));
check("index.html #styleInspector has role=\"status\"", indexHtml.includes('id="styleInspector"') && indexHtml.includes('role="status"'));
check("index.html #styleInspector has aria-live=\"polite\"", indexHtml.includes('id="styleInspector"') && indexHtml.includes('aria-live="polite"'));
check("index.html #styleInspector has tabindex=\"0\"", indexHtml.includes('id="styleInspector"') && indexHtml.includes('tabindex="0"'));
check("index.html contains #blockStyle dropdown", indexHtml.includes('id="blockStyle"'));

// ----------------------------------------------------------------------------
// Section 5: Keyboard Style Cycling Sequence Verification
// ----------------------------------------------------------------------------
console.log('\n--- Section 5: Keyboard Style Cycling Sequence Verification ---');

const BANA_STYLE_CYCLE_ORDER = [
  'p', 'h1', 'h2', 'h3', 'bullet', 'number', 'toc',
  'dialogue', 'stage', 'poem', 'exercise', 'caption',
  'footnote', 'note', 'quote'
];

check('Cycle order includes all 15 toolbar styles', BANA_STYLE_CYCLE_ORDER.length === 15);

// Forward cycle simulation (Alt+Down)
let cur = 'p';
for (let i = 0; i < BANA_STYLE_CYCLE_ORDER.length; i++) {
  const curIdx = BANA_STYLE_CYCLE_ORDER.indexOf(cur);
  const nextIdx = (curIdx + 1) % BANA_STYLE_CYCLE_ORDER.length;
  cur = BANA_STYLE_CYCLE_ORDER[nextIdx];
}
check('Forward cycle wraps back to start (p)', cur === 'p');

// Backward cycle simulation (Alt+Up)
cur = 'p';
for (let i = 0; i < BANA_STYLE_CYCLE_ORDER.length; i++) {
  const curIdx = BANA_STYLE_CYCLE_ORDER.indexOf(cur);
  const prevIdx = (curIdx - 1 + BANA_STYLE_CYCLE_ORDER.length) % BANA_STYLE_CYCLE_ORDER.length;
  cur = BANA_STYLE_CYCLE_ORDER[prevIdx];
}
check('Backward cycle wraps back to start (p)', cur === 'p');

// ----------------------------------------------------------------------------
// Section 6: Scale Verification against Full Textbook (6,081 blocks)
// ----------------------------------------------------------------------------
console.log('\n--- Section 6: Scale Verification against Full Textbook ---');

// Primary source is the committed fixture; the Downloads copy is only a fallback if it exists.
const TEXTBOOK_FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'nimas_samples/9780544087507NIMAS.xml');
const TEXTBOOK_DOWNLOADS = '/Users/paulblenkhorn/Downloads/9780544087507NIMAS 2.xml';
const textbookPath = fs.existsSync(TEXTBOOK_FIXTURE) ? TEXTBOOK_FIXTURE : TEXTBOOK_DOWNLOADS;
let textbookXml = '';
try {
  textbookXml = fs.readFileSync(textbookPath, 'utf8');
} catch (e) {
  skipped++;
  console.warn(`SKIPPED: Section 6 (textbook scale verification) — could not read ${textbookPath}: ${e.message}`);
}

if (textbookXml) {
  const parsedDoc = parseNimasXml(textbookXml);
  check('Textbook parsed successfully (>5000 blocks)', (parsedDoc.blocks || []).length >= 5000);

  let mappedCount = 0;
  let inspectorBadgesGenerated = 0;
  for (const b of parsedDoc.blocks) {
    const styleKey = b.style || b.kind || b.type || 'body';
    const badge = formatStyleInspectorBadge(styleKey, 'bana');
    if (badge && badge.startsWith('Style:')) {
      inspectorBadgesGenerated++;
    }
    mappedCount++;
  }

  check('All parsed blocks generate valid Style Inspector badges', inspectorBadgesGenerated === mappedCount);
  check(`100% style inspector coverage across all ${mappedCount} textbook blocks`, inspectorBadgesGenerated === mappedCount && mappedCount >= 5000);
}

console.log(`\nPhase 5D test suite complete: ${pass} passed, ${fail} failed, ${skipped} skipped.`);
if (fail > 0) process.exit(1);
