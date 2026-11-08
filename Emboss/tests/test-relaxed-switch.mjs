// Relaxed braille, task 3 (A91; Paul 3 Oct 2026, decision L): the switch. Relaxed braille is OFF unless a link says ?relaxed=1 (then
// remembered on that computer); ?relaxed=0 turns it off again.
// STAGE 2 (Paul's plan, 3 Oct 2026) replaced the temporary ?profile=none|all|groupsigns|strong chooser by real reader profiles; then
// PAUL, 2 NOV 2026: "relaxed braille is part of the template (one name)" - there are no separately named profiles now; the contractions a reader
// has learned are the ticks of the template in force, kept in the setting `contractions` of emboss-settings (web/settings.mjs). This file puts
// the ticks in localStorage the way the app stores them (prime() below) - "none" is nothing ticked, "strong" the strong contractions, "all" no ticks
// (All) - and the expectations are otherwise the same as before; only the way the ticks are put in force changed, for that reason.
//
// For a known sentence, in Quick Mode and in the editor:
//   - with no ?relaxed (a fresh browser) the braille is today's contracted braille;
//   - ?relaxed=1 with nothing ticked spells every contraction out, and is remembered on the next visit with no query;
//   - All ticked (no ticks) with the switch on is today's braille again (All = unchanged);
//   - ?relaxed=0 turns it off again, remembered too;
//   - the braille shown (Quick Mode's preview, the editor's braille pane) is the braille of the downloaded .brf;
//   - the editor's status bar explains a word with the same braille the document shows (alignWord matches it).
// Written before the wiring existed: it failed (the braille stayed contracted with nothing ticked).
//
// Runs in Chrome by default; EMBOSS_ENGINE=webkit|firefox for another (tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-relaxed-switch.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import fs from 'node:fs';
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unicodeBrailleToBrf, brfToUnicodeBraille } from '../engine/brf-ascii.mjs';
import { UEB_CONTRACTION_SIGNS } from '../format/relaxed-signs.mjs';
import { editorTranslators } from '../format/node-translate-helper.mjs';
const louis = await import('../engine/louis.mjs');
await louis.init(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'liblouis', 'tables'));

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
};

const SENTENCE = 'The teacher said that children should go through the garden.';
const CONTRACTED = ',! T1*] SD T *N %D G "? ! G>D54';                              // today's braille of SENTENCE (UEB grade 2)
const SPELLED = ',THE TEACHER SAID THAT CHILDREN SHOULD GO THROUGH THE GARDEN4';      // every contraction spelled out
const NONE_SET = new Set();
const STRONG = new Set(UEB_CONTRACTION_SIGNS.filter((x) => x.group === 'strong_contractions' || x.group === 'strong_wordsigns').map((x) => x.key));
const flat = (brf) => String(brf).replace(/\s+/g, ' ');
// The ticks as the app stores them (the setting `contractions` of emboss-settings): 'none' = nothing ticked, 'strong' = the strong
// contractions and wordsigns; 'all' = no ticks (All). Written from a page of this origin before the page under test loads.
const TICKS = { none: [], strong: [...STRONG], all: null };
const prime = async (page, which) => {
  await page.evaluate(() => { try { window.markDocumentClean && window.markDocumentClean(); } catch {} }).catch(() => {});
  await page.goto(`${BASE}/web/no-such-page`, { waitUntil: 'load' });
  await page.evaluate(([ticks]) => {
    const s = JSON.parse(localStorage.getItem('emboss-settings') || '{}');
    s.contractions = ticks;
    localStorage.setItem('emboss-settings', JSON.stringify(s));
  }, [TICKS[which]]);
};

const browser = await launchBrowser();
const newPage = async (simpleMode) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript((simple) => { try { if (!sessionStorage.getItem('rx-seeded')) { sessionStorage.setItem('rx-seeded', '1'); if (!localStorage.getItem('emboss-settings')) localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: simple, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } } catch {} }, simpleMode);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page, errors };
};
const downloadBrf = async (page) => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), (async () => { await page.click('#downloadBtn'); await page.click('#downloadBrfItem'); })()]);
  return fs.readFileSync(await dl.path(), 'utf8');
};
// Quick Mode's preview text (Unicode braille, page breaks as a ruled line) as BRF lines
const previewAsBrf = (text) => text.replace(/\n──────── page break ────────\n/g, '\x0c').split('\n').map((l) => unicodeBrailleToBrf(l.replace(/\r/g, '')));
const rtrimLines = (s) => s.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));

// ---- Quick Mode ------------------------------------------------------------------------------------------------------------------
// Quick Mode's braille is read from window.lastBrf, what its preview is drawn from: since 17 Oct (feedback item 8) the preview is the editor's renderer, not a <pre> of text.
async function quickBrf(page, query) {
  await page.goto(`${BASE}/web/index.html${query}`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.setInputFiles('#fileInput', { name: 'sentence.txt', mimeType: 'text/plain', buffer: Buffer.from(SENTENCE + '\n') });
  await page.waitForFunction(() => !document.getElementById('result').hidden && (window.lastBrf || '').trim().length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const shown = await page.evaluate(() => window.lastBrf || '');
  const file = await downloadBrf(page);
  return { shown: shown.replace(/\r/g, ''), file };
}
try {
  console.log(`--- Quick Mode (${ENGINE_LABEL}) ---`);
  const { ctx, page, errors } = await newPage(true);
  let r = await quickBrf(page, '');
  ok('Quick Mode, no ?relaxed: today\'s contracted braille', flat(r.shown).includes(CONTRACTED), r.shown);
  ok('Quick Mode, no ?relaxed: the downloaded .brf is the braille shown', JSON.stringify(rtrimLines(r.file).filter((l) => l)) === JSON.stringify(r.shown.replace(/\x0c/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l)), { file: r.file, shown: r.shown });
  await prime(page, 'none');
  r = await quickBrf(page, '?relaxed=1');
  ok('Quick Mode, ?relaxed=1 with nothing ticked: every contraction spelled out', flat(r.shown).includes(SPELLED) && !flat(r.shown).includes(CONTRACTED), r.shown);
  ok('Quick Mode, relaxed: the downloaded .brf is the braille shown', flat(r.file).includes(SPELLED) && JSON.stringify(rtrimLines(r.file).filter((l) => l)) === JSON.stringify(r.shown.replace(/\x0c/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l)), { file: r.file, shown: r.shown });
  r = await quickBrf(page, '');
  ok('Quick Mode, a later visit with no query: still spelled out (remembered)', flat(r.shown).includes(SPELLED), r.shown);
  await prime(page, 'all');
  r = await quickBrf(page, '');
  ok('Quick Mode, All ticked (switch on): today\'s braille', flat(r.shown).includes(CONTRACTED), r.shown);
  await prime(page, 'none');
  r = await quickBrf(page, '');
  ok('Quick Mode, nothing ticked again: spelled out again', flat(r.shown).includes(SPELLED), r.shown);
  r = await quickBrf(page, '?relaxed=0');
  ok('Quick Mode, ?relaxed=0: contracted again', flat(r.shown).includes(CONTRACTED), r.shown);
  r = await quickBrf(page, '');
  ok('Quick Mode, a later visit with no query: still contracted (?relaxed=0 is remembered)', flat(r.shown).includes(CONTRACTED), r.shown);
  ok('Quick Mode: no page errors', errors.length === 0, errors);
  await ctx.close();
} catch (e) { ok('Quick Mode run completed', false, String(e && e.stack || e)); }

// ---- the editor --------------------------------------------------------------------------------------------------------------------
async function editorState(page, query) {
  if (page.url() !== 'about:blank') await page.evaluate(() => { try { window.markDocumentClean && window.markDocumentClean(); } catch {} }).catch(() => {});
  await page.goto(`${BASE}/web/editor/index.html${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.markDocumentClean === 'function', null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.evaluate(async (text) => { window.markDocumentClean(); await window.importFile(new File([text], 'sentence.txt', { type: 'text/plain' })); }, SENTENCE + '\n');
  await page.waitForFunction(() => /GARDEN|G>D/.test(window.lastBrf || ''), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const brf = await page.evaluate(() => window.lastBrf);
  // the braille pane: each braille line as Unicode cells (then as BRF), the way it is shown
  const pane = await page.evaluate(() => document.getElementById('braille').innerText);
  const paneLines = pane.split('\n').filter((l) => /^[⠀-⣿]+$/.test(l)).map((l) => unicodeBrailleToBrf(l).replace(/\s+$/, ''));
  const file = await downloadBrf(page);
  return { brf, paneLines, file };
}
const noBlank = (lines) => lines.filter((l) => l);
try {
  console.log(`--- the editor (${ENGINE_LABEL}) ---`);
  const { ctx, page, errors } = await newPage(false);
  let r = await editorState(page, '');
  ok('editor, no ?relaxed: today\'s contracted braille', flat(r.brf).includes(CONTRACTED), r.brf);
  ok('editor, no ?relaxed: the braille pane and the downloaded .brf are the document\'s braille', JSON.stringify(noBlank(r.paneLines)) === JSON.stringify(noBlank(rtrimLines(r.file))) && JSON.stringify(noBlank(rtrimLines(r.brf))) === JSON.stringify(noBlank(rtrimLines(r.file))), r);
  await prime(page, 'none');
  r = await editorState(page, '?relaxed=1');
  ok('editor, ?relaxed=1 with nothing ticked: every contraction spelled out', flat(r.brf).includes(SPELLED) && !flat(r.brf).includes(CONTRACTED), r.brf);
  ok('editor, relaxed: the braille pane and the downloaded .brf are the document\'s braille', flat(r.file).includes(SPELLED) && JSON.stringify(noBlank(r.paneLines)) === JSON.stringify(noBlank(rtrimLines(r.file))) && JSON.stringify(noBlank(rtrimLines(r.brf))) === JSON.stringify(noBlank(rtrimLines(r.file))), r);
  r = await editorState(page, '');
  ok('editor, a later visit with no query: still spelled out (remembered)', flat(r.brf).includes(SPELLED), r.brf);
  await prime(page, 'all');
  r = await editorState(page, '');
  ok('editor, All ticked (switch on): today\'s braille', flat(r.brf).includes(CONTRACTED), r.brf);
  r = await editorState(page, '?relaxed=0');
  ok('editor, ?relaxed=0: contracted again', flat(r.brf).includes(CONTRACTED), r.brf);
  r = await editorState(page, '');
  ok('editor, a later visit with no query: still contracted (?relaxed=0 is remembered)', flat(r.brf).includes(CONTRACTED), r.brf);
  // groupsigns / strong: the sentence changes, and "teacher" keeps only the signs ticked
  await prime(page, 'strong');
  r = await editorState(page, '?relaxed=1');
  const strongBrf = editorTranslators(louis, { relaxed: STRONG }).translate(SENTENCE);
  ok('editor, the "strong" ticks in use: only the strong contractions (ch, sh, th, ou ...) are kept - the braille is the ticks\'', strongBrf !== SPELLED && strongBrf !== CONTRACTED && flat(r.brf).includes(strongBrf), { want: strongBrf, got: r.brf });
  // the word explanation (status bar) is made from the same translators as the document: the cells it shows for "teacher" are the
  // cells the document has for it - contracted, spelled out, or the strong-contractions-only form - in segments that tile the word
  for (const [query, profile, stored] of [['?relaxed=0', null, 'all'], ['?relaxed=1', NONE_SET, 'none'], ['?relaxed=1', STRONG, 'strong'], ['?relaxed=1', null, 'all']]) {
    await page.evaluate(() => window.markDocumentClean());
    await prime(page, stored);
    await page.goto(`${BASE}/web/editor/index.html${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.importFile === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.evaluate(async (text) => { window.markDocumentClean(); await window.importFile(new File([text], 'w.txt', { type: 'text/plain' })); }, 'Garden\n\nThe teacher said that children should go.\n');
    await page.waitForFunction(() => /SAID|SD/.test(window.lastBrf || ''), null, { timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.locator('#braille .brl-row[data-block="1"]').first().hover();
    await page.waitForTimeout(300);
    await page.locator('#braille .brl-row[data-block="1"] .bcell[data-char="4"]').first().click();
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const b = document.getElementById('ruleInfoBody');
      const brl = b && b.querySelector('.ri-brl');
      const txt = b && b.querySelector('.ri-word');
      return { cells: brl ? [...brl.querySelectorAll('.ri-seg')].map((x) => x.textContent) : [], chars: txt ? [...txt.querySelectorAll('.ri-seg')].map((x) => x.textContent) : [], text: b ? b.innerText : null };
    });
    const trW = editorTranslators(louis, { relaxed: profile });
    const want = trW.translate('teacher');
    const nSegs = new Set(trW.translatePos('teacher').inputPos).size;    // one segment per print piece: t · ea · ch · er; t e a ch er; t e a c h e r
    ok(`editor, status bar, "teacher" with ${query} and the ${stored} ticks in use: its cells are the document's cells for the word (${want}) in ${nSegs} segments that tile the word`,
      info.cells.join('') === brfToUnicodeBraille(want) && info.chars.join('') === 'teacher' && info.cells.length === nSegs && info.chars.length === nSegs, { want, nSegs, info });
  }
  // a live profile change (no page load): paragraphs whose braille was cached must be brailled again with the new ticks. Two
  // paragraphs; the second is edited, so the first can only be right if the cache was emptied when the ticks changed.
  await page.evaluate(() => window.markDocumentClean());
  await page.goto(`${BASE}/web/editor/index.html?relaxed=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.importFile === 'function', null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.evaluate(async (text) => { window.markDocumentClean(); await window.importFile(new File([text], 'two.txt', { type: 'text/plain' })); }, 'Garden\n\n' + SENTENCE + '\n\nA second paragraph.\n');
  await page.waitForFunction(() => /G>D54/.test(window.lastBrf || ''), null, { timeout: 30000 });
  await page.evaluate(() => { history.replaceState(null, '', location.pathname); localStorage.setItem('emboss-relaxed', '1'); const st = JSON.parse(localStorage.getItem('emboss-settings') || '{}'); st.contractions = []; localStorage.setItem('emboss-settings', JSON.stringify(st)); });
  await page.click('#editor p.ed-p >> nth=1');
  await page.keyboard.press('End'); await page.keyboard.type('x');
  await page.waitForFunction(() => /SECOND/.test(window.lastBrf || '') || /X/.test(window.lastBrf || ''), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const live = await page.evaluate(() => window.lastBrf);
  ok('editor: ticks changed live (no reload) is used by the next render - the unedited paragraph is not served from the old cache', flat(live).includes(SPELLED), live);
  ok('editor: no page errors', errors.length === 0, errors);
  await ctx.close();
} catch (e) { ok('editor run completed', false, String(e && e.stack || e)); }

await browser.close();
console.log(`\n=== Relaxed switch [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
