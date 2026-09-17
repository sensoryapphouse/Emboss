// Table-of-Contents gate. Verifies that o.toc prepends a "Contents" preliminary
// page whose entries carry the braille page number where each heading ACTUALLY
// lands in the body (found by scanning the assembled body pages — not assumed),
// including a heading forced onto page 2, and level-based indentation.
import path from 'path'; import { fileURLToPath } from 'url';
import * as louis from '../engine/louis.mjs';
import { formatDocument } from './document.mjs';
import { brailleNumber } from './page.mjs';

import fs from 'fs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BR = path.join(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : BR;

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? '  — ' + detail : ''}`); }
};

(async () => {
  await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
  const T = louis.TABLES.uebG2;
  const tr = (t) => louis.translate(t, T);

  // A doc with two headings separated by enough body to push the 2nd to page 2.
  const filler = [];
  for (let i = 0; i < 30; i++) filler.push({ type: 'para', text: `Filler paragraph number ${i + 1} here.` });
  const model = { title: null, blocks: [
    { type: 'heading', level: 1, text: 'Chapter' },
    ...filler,
    { type: 'heading', level: 2, text: 'Subsection' },
    { type: 'para', text: 'A little more text.' },
  ] };
  const opts = { mode: 'ukaaf', width: 38, depth: 25, listStyle: 'spaced', translate: tr };

  // --- body only (no TOC): find each heading's ACTUAL braille page ---
  const bodyPages = formatDocument(model, opts).split('\f');
  const pageOf = (headingText) => {
    const b = tr(headingText);
    for (let i = 0; i < bodyPages.length; i++) if (bodyPages[i].includes(b)) return i + 1;
    return -1;
  };
  const chapterPage = pageOf('Chapter');
  const subsecPage = pageOf('Subsection');
  check('body: "Chapter" heading is on page 1', chapterPage === 1, 'page=' + chapterPage);
  check('body: "Subsection" heading spilled to page ≥2 (multi-page case)', subsecPage >= 2, 'page=' + subsecPage);

  // --- with TOC ---
  const tocPages = formatDocument(model, { ...opts, toc: true }).split('\f');
  const contentsBrl = tr('Contents');
  const tocPage = tocPages.find((p) => p.includes(contentsBrl));
  check('a "Contents" preliminary page is prepended', !!tocPage);
  check('preliminary page number is P-prefixed (P#A)', !!tocPage && /P#A/.test(tocPage), tocPage && tocPage.split('\r\n')[0]);
  check('body still starts at braille page #A (TOC did not renumber it)',
    tocPages.some((p) => p.includes(tr('Chapter')) && !p.includes(contentsBrl) && p.split('\r\n')[0].trim().endsWith('#A')));

  const tocLines = (tocPage || '').split('\r\n');
  const chLine = tocLines.find((l) => l.includes(tr('Chapter')));
  const ssLine = tocLines.find((l) => l.includes(tr('Subsection')));
  check('TOC has a "Chapter" entry', !!chLine);
  check('TOC has a "Subsection" entry', !!ssLine);
  check('Chapter entry shows its real body page number', !!chLine && chLine.replace(/\s+$/, '').endsWith(brailleNumber(chapterPage)), chLine);
  check('Subsection entry shows its real body page number', !!ssLine && ssLine.replace(/\s+$/, '').endsWith(brailleNumber(subsecPage)), ssLine);

  const indentOf = (l) => l.length - l.replace(/^ +/, '').length;
  check('L2 heading is indented 2 cells more than L1 in the TOC',
    !!chLine && !!ssLine && indentOf(ssLine) === indentOf(chLine) + 2, `L1=${chLine && indentOf(chLine)} L2=${ssLine && indentOf(ssLine)}`);

  // --- no-TOC path is unaffected ---
  const noToc = formatDocument(model, opts);
  check('without o.toc there is no Contents page', !noToc.includes(contentsBrl));

  // --- BANA contents pages are exactly `depth` lines with no entry on line 1 or
  // line 25 (Formats §2.10.5). Was 26 lines: depth−1 entries plus two furniture lines.
  {
    const blocks = [];
    for (let i = 1; i <= 40; i++) { blocks.push({ type: 'heading', level: 2, text: `Heading ${i}` }); blocks.push({ type: 'para', text: `Body ${i}.` }); }
    const brf = formatDocument({ blocks }, { mode: 'bana', width: 40, depth: 25, translate: tr, toc: true });
    const pages = brf.split('\f').map((p) => { const a = p.split('\r\n'); a.pop(); return a; });
    const toc = pages.filter((p) => /P#[A-J]+$/.test(p[p.length - 1]));
    check('BANA: several P-numbered contents pages', toc.length >= 2, `toc pages=${toc.length}`);
    check('BANA: every contents page is exactly depth (25) lines', toc.every((p) => p.length === 25), toc.map((p) => p.length).join(','));
    check('BANA: every page of the document is ≤ depth lines', pages.every((p) => p.length <= 25), pages.map((p) => p.length).join(','));
    check('BANA: contents line 1 carries no entry', toc.every((p) => p[0] === ''));
    check('BANA: contents line 25 is the braille page number only', toc.every((p) => /^\s+P#[A-J]+$/.test(p[24])));
    check('BANA: contents pages are numbered P#A, P#B ...', toc.every((p, i) => p[24].endsWith('P' + brailleNumber(i + 1))));
    check('BANA: all 40 entries present', toc.flat().filter((l) => /^\s{2}\S/.test(l) && /#[A-J]+$/.test(l)).length === 40);
  }

  console.log(`\nTOC gate: ${pass}/${pass + fail} checks pass`);
  process.exit(fail ? 1 : 0);
})();
