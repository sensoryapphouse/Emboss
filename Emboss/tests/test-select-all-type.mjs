// A89, found by random-action testing (seed 614743370, Chrome and Firefox): in a real ODT contract, inserting a block with a slash
// command and then selecting everything and typing threw "node.getChildren is not a function" while the braille was being built
// (nodeToRuns ← paraBlock ← nodeToBlocks). The contract BEGINS WITH A BOX (a sidebar): select all + type kept the box and put
// the typed text loose inside it, where every other part of the editor expects a paragraph. Checked here: a document beginning
// with a box (and with a box inside a box), the real contract itself, and, for EVERY slash command, insert it, select all, type a
// letter — no error, and the letter is brailled.
//
// Runs in Chrome, WebKit and Firefox (EMBOSS_ENGINE=… for one; tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-select-all-type.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { readFileSync } from 'node:fs';
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const CONTRACT = readFileSync(new URL('./real_samples/odt/model-services-contract-core-terms.odt', import.meta.url));
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 400) : ''}`); }
};
for (const key of (ENGINE_SET ? [ENGINE] : ENGINES)) {
  const engine = LABELS[key];
  const browser = await launchBrowser({}, key);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en', transcriberTools: true })); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error' && !/ResizeObserver|warnings? issued|liblouis/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on('dialog', (d) => d.accept());
  try {
    await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(2000);
    const reset = async () => {
      await page.keyboard.press('Escape').catch(() => {});
      await page.evaluate(async () => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'heading', level: 2, text: 'Terms' }, { type: 'para', text: 'The parties agree as follows.' }] }); await window.render(); });
      await page.click('#editor p.ed-p >> nth=0');
      await page.keyboard.press('End');
    };
    const selectAllType = async () => {
      errors.length = 0;
      await page.click('#editor >> nth=0', { position: { x: 30, y: 30 } }).catch(() => {});
      await page.keyboard.press(`${MOD}+a`);
      await page.keyboard.type('G');
      await page.waitForTimeout(800);
      return page.evaluate(() => {
        const st = window.editor.getEditorState();
        const loose = [];
        st.read(() => { for (const n of st._nodeMap.values()) { const par = n.getParent?.(); if (par && n.getType() === 'text' && ['root', 'emboss-sidebar', 'emboss-tnpage', 'emboss-sympage'].includes(par.getType())) loose.push(par.getType()); } });
        return { loose, brf: (window.lastBrf || '').replace(/\s+/g, '') };
      });
    };
    for (const [label, blocks] of [
      ['a document beginning with a box', [{ type: 'box', blocks: [{ type: 'para', text: 'Boxed words.' }] }, { type: 'heading', level: 2, text: 'Terms' }, { type: 'para', text: 'The parties agree.' }]],
      ['a box inside a box first', [{ type: 'box', blocks: [{ type: 'box', blocks: [{ type: 'para', text: 'Inner.' }] }, { type: 'para', text: 'Outer.' }] }, { type: 'para', text: 'After.' }]],
    ]) {
      await page.evaluate(async (b) => { window.markDocumentClean(); window.modelToLexical({ blocks: b }); await window.render(); }, blocks);
      const r = await selectAllType();
      ok(`${engine}: ${label} — select all + type gives no error, no loose text, and brailles the letter`, !errors.length && !r.loose.length && /G/.test(r.brf), { errors, ...r });
    }
    await page.evaluate(async (a) => { window.markDocumentClean(); await window.importFile(new File([new Uint8Array(a)], 'contract.odt')); }, [...CONTRACT]);
    await page.waitForTimeout(3000);
    {
      const r = await selectAllType();
      ok(`${engine}: the real contract (begins with a box) — select all + type gives no error and brailles the letter`, !errors.length && !r.loose.length && /G/.test(r.brf), { errors, ...r });
    }

    await reset();
    await page.keyboard.type(' /');
    await page.waitForTimeout(200);
    const names = await page.evaluate(() => [...document.querySelectorAll('#slashList > *')].map((e) => e.id.replace(/^slash-opt-/, '')));
    await page.keyboard.press('Escape');
    ok(`${engine}: the slash menu lists its commands`, names.length > 20, names.length);
    const bad = [];
    for (const name of names) {
      await reset();
      errors.length = 0;
      await page.keyboard.type(' /');
      await page.waitForTimeout(120);
      await page.evaluate((id) => document.getElementById(`slash-opt-${id}`)?.click(), name);
      await page.waitForTimeout(250);
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()));
      await page.click('#editor >> nth=0', { position: { x: 30, y: 30 } }).catch(() => {});
      await page.keyboard.press(`${MOD}+a`);
      await page.keyboard.type('G');
      await page.waitForTimeout(600);
      const st = await page.evaluate(() => ({ text: document.getElementById('editor').innerText.trim(), brf: (window.lastBrf || '').replace(/\s+/g, '') }));
      if (errors.length || !/G/.test(st.brf)) bad.push({ name, errors: errors.slice(0, 2), text: st.text.slice(0, 40), brf: st.brf.slice(0, 40) });
    }
    ok(`${engine}: after every slash command, select all + type gives no error and brailles the letter`, bad.length === 0, bad);
  } finally {
    await browser.close();
  }
}
console.log(`\n=== Select all and type [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
