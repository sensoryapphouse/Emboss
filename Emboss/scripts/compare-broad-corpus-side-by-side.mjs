import fs from 'node:fs';
import path from 'node:path';

const refAuditPath = 'tests/reference_broad_corpus_audit.jsonl';
const emAuditPath = 'tests/broad_corpus_audit.jsonl';

if (!fs.existsSync(refAuditPath) || !fs.existsSync(emAuditPath)) {
  console.log('Audit files not found.');
  process.exit(1);
}

const refRecords = fs.readFileSync(refAuditPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const emRecords = fs.readFileSync(emAuditPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

const emMap = new Map();
for (const r of emRecords) {
  emMap.set(r.file, r);
}

console.log('='.repeat(105));
console.log('SIDE-BY-SIDE COMPARISON: EMBOSS vs REFERENCE ON BROAD CORPUS');
console.log('='.repeat(105));

const rows = [];
let totalRefPages = 0;
let totalEmPages = 0;
let totalRefLines = 0;
let totalEmLines = 0;

for (const ref of refRecords) {
  const em = emMap.get(ref.file);
  if (!em) continue;

  totalRefPages += ref.ref_pages;
  totalEmPages += em.emboss_pages;
  totalRefLines += ref.ref_lines;
  totalEmLines += em.emboss_lines;

  const pageDiffPct = ref.ref_pages > 0 ? (((em.emboss_pages - ref.ref_pages) / ref.ref_pages) * 100).toFixed(1) : 'N/A';
  const lineDiffPct = ref.ref_lines > 0 ? (((em.emboss_lines - ref.ref_lines) / ref.ref_lines) * 100).toFixed(1) : 'N/A';

  rows.push({
    file: ref.file.length > 32 ? ref.file.slice(0, 29) + '...' : ref.file,
    'Reference Pages': ref.ref_pages,
    'EM Pages': em.emboss_pages,
    'Page Diff%': pageDiffPct + '%',
    'Reference Lines': ref.ref_lines,
    'EM Lines': em.emboss_lines,
    'Line Diff%': lineDiffPct + '%',
    'Reference Time': ref.ms + 'ms',
    'EM Time': em.execution_time_ms + 'ms'
  });
}

console.table(rows);

console.log('='.repeat(105));
console.log(`TOTALS COMPARED SO FAR: ${rows.length} documents`);
console.log(`Reference Totals: ${totalRefPages.toLocaleString()} pages, ${totalRefLines.toLocaleString()} lines`);
console.log(`Emboss Totals:         ${totalEmPages.toLocaleString()} pages, ${totalEmLines.toLocaleString()} lines`);
console.log('='.repeat(105));
