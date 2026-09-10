import fs from 'node:fs';
import path from 'node:path';

const bbAuditPath = 'tests/bb_broad_corpus_audit.jsonl';
const emAuditPath = 'tests/broad_corpus_audit.jsonl';

if (!fs.existsSync(bbAuditPath) || !fs.existsSync(emAuditPath)) {
  console.log('Audit files not found.');
  process.exit(1);
}

const bbRecords = fs.readFileSync(bbAuditPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const emRecords = fs.readFileSync(emAuditPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

const emMap = new Map();
for (const r of emRecords) {
  emMap.set(r.file, r);
}

console.log('='.repeat(105));
console.log('SIDE-BY-SIDE COMPARISON: EMBOSS vs BRAILLEBLASTER ON BROAD CORPUS');
console.log('='.repeat(105));

const rows = [];
let totalBbPages = 0;
let totalEmPages = 0;
let totalBbLines = 0;
let totalEmLines = 0;

for (const bb of bbRecords) {
  const em = emMap.get(bb.file);
  if (!em) continue;

  totalBbPages += bb.bb_pages;
  totalEmPages += em.emboss_pages;
  totalBbLines += bb.bb_lines;
  totalEmLines += em.emboss_lines;

  const pageDiffPct = bb.bb_pages > 0 ? (((em.emboss_pages - bb.bb_pages) / bb.bb_pages) * 100).toFixed(1) : 'N/A';
  const lineDiffPct = bb.bb_lines > 0 ? (((em.emboss_lines - bb.bb_lines) / bb.bb_lines) * 100).toFixed(1) : 'N/A';

  rows.push({
    file: bb.file.length > 32 ? bb.file.slice(0, 29) + '...' : bb.file,
    'BB Pages': bb.bb_pages,
    'EM Pages': em.emboss_pages,
    'Page Diff%': pageDiffPct + '%',
    'BB Lines': bb.bb_lines,
    'EM Lines': em.emboss_lines,
    'Line Diff%': lineDiffPct + '%',
    'BB Time': bb.ms + 'ms',
    'EM Time': em.execution_time_ms + 'ms'
  });
}

console.table(rows);

console.log('='.repeat(105));
console.log(`TOTALS COMPARED SO FAR: ${rows.length} documents`);
console.log(`BrailleBlaster Totals: ${totalBbPages.toLocaleString()} pages, ${totalBbLines.toLocaleString()} lines`);
console.log(`Emboss Totals:         ${totalEmPages.toLocaleString()} pages, ${totalEmLines.toLocaleString()} lines`);
console.log('='.repeat(105));
