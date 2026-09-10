import path from "path"; import fs from "fs"; import { fileURLToPath } from "url"; const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Validate the core paragraph formatter (wrap + 3-1) against the gold corpus:
// reproduce UKAAF Sample 1 story paragraphs P1-P4 (gold sample1.brf lines 11-24).

import * as louis from '../engine/louis.mjs';
import { formatParagraph } from './layout.mjs';

const BR = path.join(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : BR;
const TABLES_DIR = path.join(projectRoot, 'liblouis', 'tables');

// The four narrative paragraphs, as in the print source.
const paras = [
  'Once upon a time a poor woodman lived with his wife in the middle of a forest. Every day he went out to cut down trees and sold the timber to a local carpenter.',
  'One day he set off as usual and found a big old oak tree which would provide lots of wood. But as he swung his axe to strike the first blow, he heard a little voice begging him not to fell the tree. He looked down and there was a tiny fairy, pleading with him to stop what he was doing.',
  'The woodcutter was so surprised that he laid down his axe and promised to spare the tree.',
  'The fairy was so grateful that she granted him three wishes.',
];

// Gold lines 11-24 of sample1.brf (the P1-P4 body), verbatim.
const gold = [
  '  ,ONCE ^U A "T A POOR WOODMAN LIV$ )',
  '8 WIFE 9 ! MIDDLE ( A =E/4 ,E "D HE',
  'W5T \\ TO CUT D[N TREES & SOLD ! TIMB]',
  'TO A LOCAL C>P5T]4',
  '  ,"O "D HE SET (F Z USUAL & F.D A BIG',
  'OLD OAK TREE : WD PROVIDE LOTS ( WOOD4',
  ',B Z HE SWUNG 8 AXE TO /RIKE ! F/ BL[1',
  'HE HE>D A LL VOICE BE7+ HM N TO FELL !',
  'TREE4 ,HE LOOK$ D[N & "! 0 A T9Y',
  'FAIRY1 PL1D+ ) HM TO /OP :AT HE 0 DO+4',
  '  ,! WOODCUTT] 0 S SURPRIS$ T HE LAID',
  'D[N 8 AXE & PROMIS$ TO SP>E ! TREE4',
  '  ,! FAIRY 0 S GRATE;L T %E GRANT$ HM',
  '?REE WI%ES4',
];

(async () => {
  await louis.init(TABLES_DIR);
  const translate = (t) => louis.translate(t, louis.TABLES.uebG2);

  const ours = [];
  for (const p of paras) ours.push(...formatParagraph(p, translate));

  console.log('cells:  ' + Array.from({ length: 38 }, (_, i) => (i + 1) % 10).join(''));
  let pass = 0;
  const n = Math.max(ours.length, gold.length);
  for (let i = 0; i < n; i++) {
    const o = ours[i] ?? '<none>';
    const g = gold[i] ?? '<none>';
    const ok = o === g;
    if (ok) pass++;
    console.log(`${ok ? '✅' : '❌'} ${String(i + 1).padStart(2)} |${o}`);
    if (!ok) console.log(`      gold |${g}`);
  }
  console.log(`\nparagraph formatter: ${pass}/${n} lines match gold sample1 (lines 11-24)`);
  process.exit(pass === n && ours.length === gold.length ? 0 : 1);
})();
