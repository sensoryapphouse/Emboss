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

  console.log(`\nTOC gate: ${pass}/${pass + fail} checks pass`);
  process.exit(fail ? 1 : 0);
})();
