import path from "path"; import { fileURLToPath } from "url"; const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Validate page assembly (running head, top-right page number, pagination, form
// feeds, BRF bytes) by round-tripping the gold: take the gold's own content
// lines (everything but the running head), re-assemble, and require byte-exact
// reproduction of sample1.brf.
import fs from 'fs';

import * as louis from '../engine/louis.mjs';
import { assemble, toBRF } from './page.mjs';

const BR = path.join(__dirname, '..');
const projectRoot = fs.existsSync(path.join(__dirname, '../../liblouis/tables')) ? path.resolve(__dirname, '../..') : BR;
const GOLD = path.join(projectRoot, 'corpus', 'ukaaf', 'sample1.brf');

(async () => {
  await louis.init(path.join(projectRoot, 'liblouis', 'tables'));
  const translate = (t) => louis.translate(t, louis.TABLES.uebG2);

  const raw = fs.readFileSync(GOLD, 'latin1');
  const goldPages = raw.split('\x0c');
  // content lines per page = drop the running head (line 1); flatten in order.
  const content = [];
  for (const pg of goldPages) {
    const lines = pg.split('\r\n');
    if (lines[lines.length - 1] === '') lines.pop();       // trailing CRLF
    content.push(...lines.slice(1));                        // drop running head
  }

  const pages = assemble(content, { title: 'Sample 1', width: 38, depth: 25, translate });
  const ours = toBRF(pages);

  const ok = ours === raw;
  console.log(ok ? '✅ BYTE-EXACT reproduction of sample1.brf via page assembly'
                 : '❌ mismatch');
  if (!ok) {
    console.log(`lengths ours=${ours.length} gold=${raw.length}`);
    for (let i = 0; i < Math.max(ours.length, raw.length); i++) {
      if (ours[i] !== raw[i]) {
        const ctx = (s) => JSON.stringify(s.slice(Math.max(0, i - 20), i + 20));
        console.log(`first diff at byte ${i}:`);
        console.log('  ours:', ctx(ours));
        console.log('  gold:', ctx(raw));
        break;
      }
    }
  }
  process.exit(ok ? 0 : 1);
})();
