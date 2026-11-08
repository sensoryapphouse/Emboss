// X9 / W16 (Paul, 4 Nov 2026: A1, B1, C1, D1 and the later addition): braille typed with the six keys over selected print (or an equation)
// keeps the print it replaced, and every run of six-key braille shows what it reads as. Typed with the real S D F / J K L keys:
//   - a word selected and braille typed over it: a light dotted underline, a small box on hover and while the caret is in the run with
//     "Replaced print: cat" and "Reads as: …", the explanation bar saying the same; more braille at the end extends the same run
//   - braille typed with nothing selected: the underline and the box with "Reads as" only, no "Put the print back"
//   - an equation replaced: the box shows it as maths
//   - the box never takes the keyboard focus, goes with Escape and when the caret and pointer leave
//   - "Put the print back": the print returns as one undoable step (Undo brings the braille back), the caret after it
//   - saved with the document, back after reopening and after autosave recovery; the BRF is exactly what it was without the marks
//   - light and dark; an axe WCAG 2 A/AA scan with the box open
// Chrome and WebKit (both unless EMBOSS_ENGINE names one).
//
// Usage: node Emboss/scripts/serve.mjs 8261 &   then   node Emboss/tests/test-sixkey-replaced.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, ENGINE_SET, ENGINE } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const AXE = fileURLToPath(new URL('./vendor/axe-core/axe.min.js', import.meta.url));
let pass = 0;
const failures = [];
let label = '';
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    [${label}] ${name}`); }
  else { failures.push({ name: `[${label}] ${name}`, detail }); console.error(`  ✖ FAIL  [${label}] ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
};
const DOTS = { 1: 'KeyF', 2: 'KeyD', 3: 'KeyS', 4: 'KeyJ', 5: 'KeyK', 6: 'KeyL' };
const CELL = { a: [1], b: [1, 2], c: [1, 4], d: [1, 4, 5] };
const SETTINGS = JSON.stringify({ simpleMode: false, sixKeyInput: true, mode: 'bana', standard: 'bana', grade: 'g2', uiLanguage: 'en' });

async function run(engine, scheme) {
  label = `${engine} ${scheme}`;
  console.log(`--- ${label} ---`);
  const browser = await launchBrowser({}, engine);
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1300, height: 900 }, colorScheme: scheme });
    await context.addInitScript((json) => { try { localStorage.setItem('emboss-settings', json); } catch {} }, SETTINGS);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    const chord = async (letter) => {
      const keys = CELL[letter].map((d) => DOTS[d]);
      for (const k of keys) await page.keyboard.down(k);
      for (const k of keys) await page.keyboard.up(k);
      await page.waitForTimeout(120);
    };
    const settle = async () => { let prev = null; for (let k = 0; k < 25; k++) { await page.waitForTimeout(300); const b = await page.evaluate(() => window.lastBrf || ''); if (b === prev) return b; prev = b; } return prev; };
    const load = async (blocks) => {
      await page.evaluate((bl) => { window.markDocumentClean(); window.modelToLexical({ title: '', blocks: bl }); }, blocks);
      await settle();
    };
    // a DOM selection over `needle` (or, with end=true and collapsed, a caret after it) inside the editor; Lexical follows it
    const select = (needle, { caret = false } = {}) => page.evaluate(([needle, caret]) => {
      const root = document.getElementById('editor');
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const i = n.nodeValue.indexOf(needle);
        if (i < 0) continue;
        const r = document.createRange();
        if (caret) { r.setStart(n, i + needle.length); r.collapse(true); } else { r.setStart(n, i); r.setEnd(n, i + needle.length); }
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        return true;
      }
      return false;
    }, [needle, caret]);
    const selectBetween = (afterText, beforeText) => page.evaluate(([a, b]) => {
      const root = document.getElementById('editor');
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n, s1 = null, s2 = null;
      while ((n = w.nextNode())) {
        if (!s1 && n.nodeValue.includes(a)) s1 = n;
        else if (s1 && !s2 && n.nodeValue.includes(b)) s2 = n;
      }
      if (!s1 || !s2) return false;
      const r = document.createRange();
      r.setStart(s1, s1.nodeValue.indexOf(a) + a.length); r.setEnd(s2, s2.nodeValue.indexOf(b));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      return true;
    }, [afterText, beforeText]);
    const sixOn = async () => { if (!(await page.$eval('#btnSixKey', (b) => b.getAttribute('aria-pressed') === 'true'))) await page.click('#btnSixKey'); await page.focus('#editor'); };
    const sixOff = async () => { if (await page.$eval('#btnSixKey', (b) => b.getAttribute('aria-pressed') === 'true')) await page.click('#btnSixKey'); await page.focus('#editor'); };
    const box = () => page.evaluate(() => {
      const b = document.getElementById('sixkeyBox');
      return { visible: !!b && !b.hidden && b.getClientRects().length > 0, text: b ? b.innerText.replace(/\s+/g, ' ').trim() : '', hasBtn: !!(b && b.querySelector('.skb-btn')), eq: !!(b && b.querySelector('.skb-eq')), rect: b ? b.getBoundingClientRect().toJSON() : null };
    });
    const bar = () => page.evaluate(() => (document.getElementById('ruleInfoBody')?.textContent || '').replace(/\s+/g, ' ').trim());
    const runs = () => page.evaluate(() => [...document.querySelectorAll('#editor .ed-sixkey')].map((e) => e.textContent));
    const runPara = () => page.evaluate(() => document.querySelector('#editor .ed-sixkey')?.closest('p')?.textContent || '');
    const paraText = (i) => page.evaluate((i) => document.querySelectorAll('#editor > p, #editor > .ed-p')[i]?.textContent || '', i);
    const axe = async () => {
      if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ path: AXE });
      const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
      const known = (id, n) => id === 'nested-interactive' && n.target.join(' ').includes('math-field');   // MathLive's own keyboard sink (test-brand-style.mjs)
      return r.violations.map((v) => ({ id: v.id, nodes: v.nodes.filter((n) => !known(v.id, n)).map((n) => n.target.join(' ')) })).filter((v) => v.nodes.length);
    };

    await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const DOC = [
      { type: 'para', text: 'The cat sat on the mat.' },
      { type: 'para', segments: [{ type: 'text', text: 'Solve ' }, { type: 'math', latex: 'x^2+1' }, { type: 'text', text: ' now.' }] },
      { type: 'para', text: 'Last line.' },
    ];
    await load(DOC);
    const brfPlain = await settle();

    // ---- typing over a selected word
    await page.click('#editor');
    await sixOn();
    ok('a selected word is found', await select('cat'));
    await page.waitForTimeout(250);
    await chord('a');
    await page.waitForTimeout(500);
    let r = await runs();
    ok('braille typed over the word is one run of its own', JSON.stringify(r) === '["⠁"]', r);
    ok('the word is gone from the paragraph, the cells are in', (await paraText(0)) === 'The ⠁ sat on the mat.', await paraText(0));
    const deco = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#editor .ed-sixkey')); return { line: c.textDecorationLine, style: c.textDecorationStyle, color: c.textDecorationColor }; });
    ok('the run has a dotted underline', /underline/.test(deco.line) && deco.style === 'dotted', deco);
    let b = await box();
    ok('the box is up while the caret is in the run, with the replaced print', b.visible && /Replaced print:\s*cat/.test(b.text), b);
    ok('the box says what the braille reads as', /Reads as:\s*a\b/.test(b.text), b);
    ok('the box offers Put the print back', b.hasBtn && /Put the print back/.test(b.text), b);
    let bt = await bar();
    ok('the explanation bar says the same', /Replaced print:\s*cat/.test(bt) && /Reads as:\s*a\b/.test(bt) && /put the print back/i.test(bt), bt);
    ok('the box did not take the focus', await page.evaluate(() => document.activeElement && document.activeElement.id === 'editor' || !!document.activeElement?.closest('#editor')));
    const rect = await page.evaluate(() => document.querySelector('#editor .ed-sixkey').getBoundingClientRect().toJSON());
    ok('the box does not cover the run', b.rect.top >= rect.bottom - 1 || b.rect.bottom <= rect.top + 1, { box: b.rect, run: rect });
    // more braille at the end of the run extends the same run (and keeps the print)
    await chord('b');
    r = await runs();
    ok('more braille at the end extends the same run', JSON.stringify(r) === '["⠁⠃"]', r);
    b = await box();
    ok('the print is still the word, the reading follows the run', /Replaced print:\s*cat/.test(b.text) && /Reads as:/.test(b.text), b);
    // the axe scan with the box open
    ok('no WCAG 2 A/AA problems with the box open (caret)', (await axe()).length === 0, await axe());

    // ---- Escape and leaving
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    ok('Escape puts the box away', !(await box()).visible, await box());
    await sixOff();
    ok('a caret elsewhere: no box', await select('mat', { caret: true }) && (await page.waitForTimeout(300), !(await box()).visible), await box());
    ok('and the explanation bar is free again', !/Replaced print/.test(await bar()), await bar());
    // ---- hover
    await page.hover('#editor .ed-sixkey');
    await page.waitForTimeout(350);
    b = await box();
    ok('hovering the run shows the box', b.visible && /Replaced print:\s*cat/.test(b.text) && b.hasBtn, b);
    ok('hover alone does not change the explanation bar', !/Replaced print/.test(await bar()), await bar());
    ok('no WCAG 2 A/AA problems with the box open (hover)', (await axe()).length === 0, await axe());
    await page.mouse.move(5, 5);
    await page.waitForTimeout(500);
    ok('moving the pointer away hides it', !(await box()).visible, await box());

    // ---- Put the print back, with the mouse; one undo step
    await page.hover('#editor .ed-sixkey');
    await page.waitForTimeout(350);
    await page.click('#sixkeyBox .skb-btn');
    await page.waitForTimeout(500);
    ok('Put the print back restores the print', (await paraText(0)) === 'The cat sat on the mat.' && (await runs()).length === 0, await paraText(0));
    ok('the box is gone', !(await box()).visible, await box());
    // Undo is one step: it brings the braille back, with its print
    await page.click('#btnUndo');
    await page.waitForTimeout(600);
    let undone = await runs();
    ok('Undo brings the braille back (with its print)', JSON.stringify(undone) === '["⠁⠃"]', { undone, para: await paraText(0) });
    await select('⠁⠃', { caret: true }); await page.waitForTimeout(400);
    ok('and the print is still kept after undo', /Replaced print:\s*cat/.test((await box()).text), await box());

    // ---- keyboard: Put the print back from the caret; the caret is left after the print
    await page.focus('#editor');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+KeyP' : 'Control+Alt+KeyP');
    await page.waitForTimeout(500);
    ok('Ctrl/Cmd+Alt+P puts the print back from the keyboard', (await paraText(0)) === 'The cat sat on the mat.', await paraText(0));
    await sixOff();
    await page.keyboard.type('Z');
    await page.waitForTimeout(300);
    ok('the caret is after the restored print', (await paraText(0)) === 'The catZ sat on the mat.', await paraText(0));

    // ---- inserted braille: no print, "Reads as" only
    await load(DOC);
    await page.click('#editor');
    await select('Last line.', { caret: true });
    await page.keyboard.press('Enter');
    await sixOn();
    await chord('c'); await chord('d');
    r = await runs();
    ok('braille typed with nothing selected is a run too', JSON.stringify(r) === '["⠉⠙"]', r);
    b = await box();
    ok('its box says only what it reads as', b.visible && /Reads as:/.test(b.text) && !/Replaced print/.test(b.text) && !b.hasBtn, b);
    bt = await bar();
    ok('its explanation bar line says only what it reads as', /Reads as:/.test(bt) && !/Replaced print/.test(bt) && !/Put the print back/.test(bt), bt);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Alt+KeyP' : 'Control+Alt+KeyP');
    await page.waitForTimeout(300);
    ok('the put-back key does nothing for a run that replaced nothing', JSON.stringify(await runs()) === '["⠉⠙"]');

    // ordinary typing after a run is plain print: the run stays the braille that was typed
    await sixOff();
    await page.keyboard.type('xy');
    await page.waitForTimeout(300);
    ok('ordinary typing at the end of a run starts plain text, not more of the run', JSON.stringify(await runs()) === '["⠉⠙"]' && (await runPara()) === '⠉⠙xy', { runs: await runs(), para: await runPara() });

    // ---- an equation replaced
    await load(DOC);
    await page.click('#editor');
    await sixOn();
    ok('the equation is selected', await selectBetween('Solve ', ' now.'));
    await page.waitForTimeout(300);
    await chord('a');
    await page.waitForTimeout(500);
    b = await box();
    ok('typing over an equation: the box shows the equation as maths', b.visible && /Replaced print:/.test(b.text) && b.eq, b);
    ok('the equation is gone from the paragraph', (await page.evaluate(() => document.querySelectorAll('#editor math-field').length)) === 0);
    ok('no WCAG 2 A/AA problems with an equation shown in the box', (await axe()).length === 0, await axe());
    const eqModel = await page.evaluate(() => window.lastModel.blocks.find((x) => x.type === 'para' && /Solve/.test(JSON.stringify(x))));
    ok('the model carries the run beside the text', JSON.stringify(eqModel).includes('"sixkey"'), eqModel);

    // ---- save, the BRF, reopen
    await select('Last', { caret: true });
    await sixOff();
    await page.waitForTimeout(300);
    const brfMarked = await settle();
    const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
    ok('the saved file holds the run and the equation it replaced', /<span class="bana-sixkey" title="[^"]*latex[^"]*">⠁<\/span>/.test(xml), xml.slice(xml.indexOf('<bodymatter'), xml.indexOf('<bodymatter') + 500));
    // the BRF is as the same document without any mark would give
    await load([{ type: 'para', text: 'The cat sat on the mat.' }, { type: 'para', text: 'Solve ⠁ now.' }, { type: 'para', text: 'Last line.' }]);
    const brfUnmarked = await settle();
    ok('the BRF is exactly what the same text gives without the marks', brfMarked === brfUnmarked, { marked: brfMarked.slice(0, 200), unmarked: brfUnmarked.slice(0, 200) });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sixkey-replaced-')), 'doc.xml');
    fs.writeFileSync(file, xml);
    await page.evaluate(() => { window.markDocumentClean(); window.__prevModel = window.lastModel; });
    await page.setInputFiles('#loadFileInput', file);
    await page.waitForFunction(() => window.lastModel && window.lastModel !== window.__prevModel, null, { timeout: 30000 }).catch(() => {});
    const brfReopened = await settle();
    r = await runs();
    ok('reopened, the run is still marked', JSON.stringify(r) === '["⠁"]', r);
    ok('reopened, the BRF is the same', brfReopened === brfMarked, { reopened: brfReopened.slice(0, 200), marked: brfMarked.slice(0, 200) });
    await page.hover('#editor .ed-sixkey');
    await page.waitForTimeout(350);
    b = await box();
    ok('reopened, the box still shows the replaced equation', b.visible && /Replaced print:/.test(b.text) && b.eq && b.hasBtn, b);
    await page.click('#sixkeyBox .skb-btn');
    await page.waitForTimeout(600);
    ok('reopened, Put the print back brings the equation back', (await page.evaluate(() => document.querySelectorAll('#editor .math-embed').length)) === 1 && (await runs()).length === 0);

    // ---- autosave and recovery
    await load(DOC);
    await page.click('#editor');
    await sixOn();
    await select('mat');
    await page.waitForTimeout(250);
    await chord('c');
    await page.waitForTimeout(500);
    await sixOff();
    await page.evaluate(() => window.__forceAutosaveTick());
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#autosaveRecoverBtn', { timeout: 30000 });
    await page.click('#autosaveRecoverBtn');
    await page.waitForFunction(() => typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 20000 });
    await settle();
    r = await runs();
    ok('after autosave recovery the run is back', JSON.stringify(r) === '["⠉"]', r);
    await page.hover('#editor .ed-sixkey');
    await page.waitForTimeout(350);
    ok('and its replaced print with it', /Replaced print:\s*mat/.test((await box()).text), await box());

    ok('no page errors', errors.length === 0, errors);
  } finally {
    await browser.close();
  }
}

const engines = ENGINE_SET ? [ENGINE] : ['chrome', 'webkit'];
for (const engine of engines) for (const scheme of ['light', 'dark']) await run(engine, scheme);
console.log(`\n=== Six-key replaced print: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) { for (const f of failures) console.error(`FAILED ${f.name}`); process.exit(1); }
