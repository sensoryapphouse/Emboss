// Gate for volume splitting (formatVolumes) against the real engine.
import path from 'path';
import * as louis from '../engine/louis.mjs';
import { formatDocument, formatVolumes } from './document.mjs';
import { styledTranslate } from './text-style.mjs';

await louis.init(path.join(process.cwd(), 'liblouis', 'tables'));
const translate = styledTranslate((s, tf) => louis.translate(s, louis.TABLES.uebG2, tf), 'faithful');
const base = { mode: 'ukaaf', width: 38, depth: 25, listStyle: 'spaced', toc: false, translate };

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

// A document long enough to span several braille pages.
const blocks = [{ type: 'heading', level: 1, text: 'A Long Book' }];
for (let i = 1; i <= 120; i++) blocks.push({ type: 'para', text: `This is paragraph number ${i}. It carries enough words to occupy a fair amount of space on the braille page so the whole document runs to many pages.` });
const doc = { title: 'A Long Book', blocks };

// One-file output = concatenation baseline.
const whole = formatDocument(doc, { ...base });
const wholePages = whole.split('\f').length;
ok(wholePages > 6, `test doc should be many pages, got ${wholePages}`);

// 1) volumePages 0 → a single volume, identical to formatDocument.
const single = formatVolumes(doc, { ...base, volumePages: 0 });
ok(single.length === 1 && single[0].brf === whole, 'volumePages:0 → single volume identical to formatDocument');

// 2) Split at 3 body pages per volume.
const V = 3;
const vols = formatVolumes(doc, { ...base, volumePages: V });
ok(vols.length > 1, `should split into >1 volume, got ${vols.length}`);
ok(vols.every((v) => v.of === vols.length), 'every volume knows the total (of)');
ok(vols.map((v) => v.volume).join(',') === vols.map((_, i) => i + 1).join(','), 'volumes numbered 1..N');

// Each volume: 1 title page + at most V body pages.
for (const v of vols) {
  const pages = v.brf.split('\f');
  ok(pages.length <= V + 1, `vol ${v.volume}: ≤ ${V}+1 pages (title), got ${pages.length}`);
  ok(/,VOLUME/i.test(pages[0]) || /VOL/i.test(pages[0]) || pages[0].includes(louis.translate('Volume', louis.TABLES.uebG2)), `vol ${v.volume}: title page names the volume`);
}

// 3) Body page numbering is CONTINUOUS across volumes (not restarted). The last
// content page of the whole doc must appear in the last volume.
const lastWholePage = whole.split('\f').slice(-1)[0];
const lastVolPage = vols.slice(-1)[0].brf.split('\f').slice(-1)[0];
ok(lastWholePage === lastVolPage, 'last page of the book == last page of the last volume (continuous numbering)');

// 4) Total body pages across volumes == whole-doc pages (title pages are extra).
const bodyAcross = vols.reduce((n, v) => n + v.brf.split('\f').length - 1, 0);  // minus the title page each
ok(bodyAcross === wholePages, `body pages preserved across volumes: ${bodyAcross} vs ${wholePages}`);

console.log(`\nvolumes gate: ${pass}/${pass + fail} checks pass`);
process.exit(fail ? 1 : 0);
