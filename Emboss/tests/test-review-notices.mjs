// Feedback 30 Sep 2026, item 7 (Paul, 1 Oct: "do item 7"): in normal mode the notices about a document did not explain
// themselves, and the "to review" badge stayed after the text was cleared. With Paul's own test document (w00):
//  - the symbols notice names each symbol ("■ square bullet", not just "■") and says why it matters;
//  - the proofreading badge says "words to check", its tooltip says what the check is, and selecting it explains the word in the
//    explanation bar;
//  - no "Editor link degraded" (trace-fallback) warning: the editor now traces sub/superscript runs of more than one letter, and
//    that diagnostic (braille unaffected) is not shown to the user anyway;
//  - after Clear, or select-all and Delete, no notice or badge is left over.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-review-notices.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'fixtures', 'import-audit', 'docx', 'w00-paul-test-word-doc-2.docx');
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('rn')) { sessionStorage.setItem('rn', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } } catch {} });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
const state = () => page.evaluate(() => {
  const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.getClientRects().length > 0; };
  return {
    symbol: vis('symbolNoticeBanner') ? document.getElementById('symbolNoticeText').textContent : null,
    proof: vis('proofBadge') ? document.getElementById('proofBadge').textContent : null,
    proofTitle: document.getElementById('proofBadge')?.title || '',
    warn: vis('warnBadge') ? document.getElementById('warnBadge').textContent : null,
    kinds: (window.lastWarnings || []).map((w) => w.kind),
    blocks: (window.lastModel?.blocks || []).length,
  };
});
const load = async () => {
  await page.evaluate(() => { window.markDocumentClean(); window.__prevModel = window.lastModel; });
  await page.setInputFiles('#loadFileInput', FILE);
  await page.waitForFunction(() => window.lastModel && window.lastModel !== window.__prevModel, null, { timeout: 30000 }).catch(() => {});
  let prev = null;
  for (let k = 0; k < 30; k++) { await page.waitForTimeout(300); const s = JSON.stringify(await state()); if (s === prev) break; prev = s; }
};
try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await load();
  let s = await state();
  // Changed 18 Oct 2026 (Paul, 17 Oct: 15a): this document's nested bullets are Word's defaults (the circle and square at levels 2 and 3), now ordinary
  // bullets, so the one symbol left to explain is its dash bullet - named, as every listed symbol must be.
  ok('the symbols notice names each symbol it lists (the dash bullet, by name)', !!s.symbol && /dash bullet/.test(s.symbol) && !/[■○]/.test(s.symbol), s.symbol);
  ok('... and says why it matters', !!s.symbol && /no standard sign/.test(s.symbol), s.symbol);
  // Its only "words to review" were the words of its subscript and superscript line, which the read-back check cannot judge
  // (their braille is right): they are no longer flagged.
  ok('no words flagged for the subscript / superscript line (the check cannot read script indicators back)', s.proof === null, s.proof);
  ok('no "Editor link degraded" (trace-fallback): the scripts of more than one letter are traced now', !s.kinds.includes('trace-fallback'), s.kinds);
  ok('so no transcription-warnings badge for this document', s.warn === null, s);
  // A word the check does flag (the h03 list fixture's "alphareversed3", which liblouis cannot read back the same way).
  await page.evaluate(() => window.markDocumentClean());
  await page.setInputFiles('#loadFileInput', path.join(HERE, 'fixtures', 'import-audit', 'html', 'h03-lists.html'));
  await page.waitForFunction(() => !document.getElementById('proofBadge').hidden, null, { timeout: 20000 }).catch(() => {});
  s = await state();
  ok('the proofreading badge says "words to check" (was "to review")', !!s.proof && /\d+ words? to check/.test(s.proof), s.proof);
  ok('its tooltip says what the check is', /reading it back into print/.test(s.proofTitle) && /often still right/.test(s.proofTitle), s.proofTitle);
  await page.evaluate(() => document.getElementById('proofBadge').click());
  await page.waitForTimeout(500);
  const bar = await page.evaluate(() => document.getElementById('statusBar').innerText);
  ok('selecting the badge explains the word in the explanation bar', /Word 1 of \d+ to check: “[^”]+”\. Its braille does not read back as the same word/.test(bar), bar.slice(0, 300));
  // Clear: nothing left over
  await page.evaluate(() => document.getElementById('btnClear').click());
  await page.waitForTimeout(2500);
  s = await state();
  ok('after Clear: no "words to check" badge, no symbols notice, no warnings badge', s.blocks === 0 && s.proof === null && s.symbol === null && s.warn === null, s);
  // select all and delete: the same
  await load();
  await page.click('#editor');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(2500);
  s = await state();
  ok('after select-all and Delete: nothing left over either', s.proof === null && s.symbol === null && s.warn === null, s);
  ok('no page errors', errors.length === 0, errors);
} finally {
  await browser.close();
}
console.log(`\n=== Review notices [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
