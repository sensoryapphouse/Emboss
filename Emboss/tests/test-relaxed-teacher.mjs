// Relaxed braille, Stage 4 (A91; Paul 3 Oct 2026, decision H "help teachers choose"), in a real browser - Quick Mode and the editor.
// Written before the feature existed: it failed (no sample, no list of what is left out in the profile manager).
//
// PAUL, 2 NOV 2026: "relaxed braille is part of the template (one name)". The profile manager is now the "Choose contractions" dialog (Settings > Template >
// Template settings > Contractions: ... [Choose…]): no profile picker and no Save / Save as / Rename / Delete, every group collapsed to one row, and the buttons
// are Done and Cancel. This file was changed for that reason only; what it checks about the sample and the list is the same:
//  - the dialog shows a SAMPLE: a short sentence brailled with the ticks on screen (the working copy), updated as each box and each group box is ticked;
//    the document's own braille does not change until Done (P1); the braille is plain text, not a live region;
//  - the teacher can type a sentence of their own; it is remembered (this computer, not per template) and "Use the standard sentence" goes back; with every
//    box ticked the sample is the full contracted braille;
//  - "Left out in this document": for the open document, the contractions the ticks leave out, commonest first, with how many times each occurs (print,
//    where it is used, group, times); the top 15 with a way to see all; it changes at once with the ticks; "counting" while a book is counted in the
//    background, and the page stays responsive; with no document it says so; with every box ticked, nothing is left out;
//  - the dialog is usable from the keyboard alone; axe WCAG 2 A/AA finds nothing in the open dialog with the new parts, nor on each page with the
//    "Template: ..." label showing (Quick Mode's header, above the editor's braille), light and dark.
//
// Runs in Chrome by default; EMBOSS_ENGINE=webkit|firefox for another (tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8180 &   then   node Emboss/tests/test-relaxed-teacher.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { brfToUnicodeBraille } from '../engine/brf-ascii.mjs';
import { seedEntries } from './lib/relaxed-seed.mjs';
import { UEB_CONTRACTION_SIGNS, UEB_CONTRACTION_GROUPS, signByKey } from '../format/relaxed-signs.mjs';
import { countSigns, leftOut, signUse, DEFAULT_SAMPLE } from '../format/relaxed-report.mjs';
import { makeTranslators, UEB_TABLES } from '../web/braille-table.mjs';
const louis = await import('../engine/louis.mjs');
const HERE = path.dirname(fileURLToPath(import.meta.url));
await louis.init(path.join(HERE, '..', 'liblouis', 'tables'));

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
const AXE = path.join(HERE, 'vendor', 'axe-core', 'axe.min.js');
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 900) : ''}`); }
};

// ---- what the page should show, worked out here with the same engine ------------------------------------------------------------------
const keysOf = (pred) => UEB_CONTRACTION_SIGNS.filter(pred).map((s) => s.key);
const STRONG = keysOf((s) => s.group === 'strong_contractions');
const SAM = 'Sam';
const EMPTY = 'Empty';
const unicodeFor = (sentence, keys) => brfToUnicodeBraille(makeTranslators(louis, UEB_TABLES.g2, { relaxed: keys == null ? null : new Set(keys) }).translate(sentence)).replace(/\s+/g, ' ').trim();
const DOC = [
  'The teacher said that the children should go through the garden.',
  'The children and the teacher went out into the garden, and the teacher was kind.',
  'Because the garden was full of rabbits, the little children were happy.',
].join('\n') + '\n';
const tp = makeTranslators(louis, UEB_TABLES.g2).translatePos;
const counted = await countSigns(DOC, tp);
const expectRows = (keys) => leftOut(counted.counts, new Set(keys)).map((x) => ({ print: x.sign.learnKey, times: String(x.count) }));
const flat = (s) => String(s).replace(/\s+/g, ' ').trim();

// The templates the page starts with (Paul, 2 Nov 2026): "Sam" holds the strong contractions, "Empty" none; Sam is in use, so its ticks are in force.
const TEMPLATES = [{ name: SAM, contractions: STRONG }, { name: EMPTY, contractions: [] }];
const browser = await launchBrowser();
const newPage = async ({ simple, active = SAM, extra = {}, ctx: given = null }) => {
  const ctx = given || await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true, locale: 'en-US' });
  const entries = seedEntries({ settings: { simpleMode: simple }, templates: TEMPLATES, active });
  await ctx.addInitScript(([ents, more]) => {
    try {
      if (!sessionStorage.getItem('rt-seeded')) {
        sessionStorage.setItem('rt-seeded', '1');
        for (const [k, v] of Object.entries(ents)) localStorage.setItem(k, v);
        for (const [k, v] of Object.entries(more || {})) localStorage.setItem(k, v);
      }
    } catch {}
  }, [entries, extra]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.__answer = true;
  page.on('dialog', async (d) => { if (page.__answer) await d.accept(); else await d.dismiss(); });
  return { ctx, page, errors };
};
const clean = (page) => page.evaluate(() => { try { window.markDocumentClean && window.markDocumentClean(); } catch {} }).catch(() => {});
const editorLoad = async (page, query = '?relaxed=1') => {
  if (page.url() !== 'about:blank') await clean(page);
  await page.goto(`${BASE}/web/editor/index.html${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.markDocumentClean === 'function', null, { timeout: 60000 });
  await page.waitForTimeout(1200);
};
const editorDoc = async (page, text = DOC, name = 'x.txt') => {
  await page.evaluate(async ([t, n]) => { window.markDocumentClean(); await window.importFile(new File([t], n, { type: 'text/plain' })); }, [text, name]);
  await page.waitForFunction(() => /\S/.test(window.lastBrf || ''), null, { timeout: 30000 });
  await page.waitForTimeout(600);
};
const quickLoad = async (page, query = '?relaxed=1') => { await page.goto(`${BASE}/web/index.html${query}`, { waitUntil: 'load' }); await page.waitForTimeout(1500); };
const quickDoc = async (page, text = DOC, name = 'x.txt') => {
  await page.setInputFiles('#fileInput', { name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.waitForFunction(() => !document.getElementById('result').hidden && (window.lastBrf || '').trim().length > 0, null, { timeout: 90000 });
  await page.waitForTimeout(600);
};
// both pages: window.lastBrf is the braille the page shows (Quick Mode's preview is the editor's renderer since 17 Oct, feedback item 8)
const docBraille = (kind, page) => page.evaluate(() => window.lastBrf || '');
// Settings opens on the Template tab; the Contractions line is in the "Template settings" disclosure (closed at first), directly under Braille code
const openChoose = async (page) => {
  if (!(await page.evaluate(() => document.getElementById('settingsDialog').open))) { await page.click('#settingsBtn'); await page.waitForSelector('#settingsDialog[open]'); }
  if (!(await page.evaluate(() => document.getElementById('tplSettings').open))) await page.click('#tplSettings > summary');
  await page.click('#contractionsBtn'); await page.waitForSelector('#contractionsDialog[open]');
  await page.waitForFunction(() => document.getElementById('rpSampleBrl') && document.getElementById('rpSampleBrl').textContent.trim().length > 0 || document.getElementById('rpSample').hidden === true, null, { timeout: 20000 });
  await page.waitForTimeout(150);
};
// the checkbox of one contraction (its group is opened first when it is closed: every group starts collapsed)
const box = async (page, key) => {
  const loc = page.locator(`#rpTable input[data-key="${key}"]`);
  if (!(await loc.isVisible())) await page.locator(`#rpTable button[data-expand="${key.split(':')[0]}"]`).click();
  return loc;
};
const tick = async (page, key, on = true) => { const b = await box(page, key); if (on) await b.check(); else await b.uncheck(); };
const tickAllGroups = (page, on) => page.locator('#rpTable input[data-group]').evaluateAll((els, v) => els.forEach((e) => { e.checked = v; e.dispatchEvent(new Event('change', { bubbles: true })); }), on);
const sampleNow = (page) => page.evaluate(() => ({ print: document.getElementById('rpSampleText').value, braille: document.getElementById('rpSampleBrl').textContent.replace(/\s+/g, ' ').trim(), hidden: document.getElementById('rpSample').hidden }));
const waitSample = async (page, want) => {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < 5000) { last = await sampleNow(page); if (last.braille === want) return { good: true, got: last.braille }; await page.waitForTimeout(100); }
  return { good: false, got: last && last.braille, want };
};
const leftState = (page) => page.evaluate(() => {
  const d = document.getElementById('rpLeft');
  const rows = [...document.querySelectorAll('#rpLeftRows tr')].map((tr) => ({ print: tr.querySelector('.rp-print').textContent, use: tr.children[1].textContent, group: tr.children[2].textContent, times: tr.children[3].textContent }));
  const more = document.getElementById('rpLeftMore');
  return {
    hidden: d.hidden, open: d.open, summary: document.getElementById('rpLeftSum').textContent, note: document.getElementById('rpLeftNote').textContent.trim(),
    rows, tableHidden: document.getElementById('rpLeftWrap').hidden, more: more.hidden ? null : { text: more.textContent, expanded: more.getAttribute('aria-expanded') },
    busy: d.getAttribute('aria-busy'),
  };
});
const waitLeft = async (page, pred, what) => {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < 30000) { last = await leftState(page); if (pred(last)) return { good: true, state: last }; await page.waitForTimeout(100); }
  return { good: false, state: last, what };
};
const openLeft = async (page) => { if (!(await page.evaluate(() => document.getElementById('rpLeft').open))) await page.click('#rpLeftSum'); };
// the editor opens with a short demonstration document; it is not counted (S1), so "no document" there means the demonstration or an emptied editor
const emptyEditor = async (page) => {
  await page.click('[contenteditable="true"]');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(600);
};
const cancelChoose = async (page) => { await page.click('#rpCancel'); await page.waitForTimeout(250); };
const doneChoose = async (page) => { await page.click('#rpDone'); await page.waitForTimeout(700); };

// ---- the story, on both pages ---------------------------------------------------------------------------------------------------------
async function story(kind) {
  const isEditor = kind === 'editor';
  const label = isEditor ? 'editor' : 'Quick Mode';
  const load = isEditor ? editorLoad : quickLoad;
  const doc = isEditor ? editorDoc : quickDoc;
  console.log(`--- ${label} (${ENGINE_LABEL}) ---`);
  const { ctx, page, errors } = await newPage({ simple: !isEditor });
  const closeSettings = () => page.evaluate(() => { const d = document.getElementById('settingsDialog'); if (d && d.open) d.close(); });
  try {
    await load(page);

    // ---- no document: the list says so; the sample is there already
    if (isEditor) await emptyEditor(page);
    await openChoose(page);
    let sm = await sampleNow(page);
    ok(`${label}: the sample is shown, with the standard sentence`, !sm.hidden && sm.print === DEFAULT_SAMPLE, sm);
    ok(`${label}: the sample braille is the standard sentence brailled with the ticks in force (${SAM}: strong contractions only)`, sm.braille === unicodeFor(DEFAULT_SAMPLE, STRONG), { got: sm.braille, want: unicodeFor(DEFAULT_SAMPLE, STRONG) });
    let ls = await waitLeft(page, (s) => /no document/i.test(s.summary), 'no document');
    ok(`${label}: with no document open the list says so, briefly`, ls.good && /no document is open/i.test(ls.state.note) && ls.state.rows.length === 0 && ls.state.tableHidden, ls.state);
    await cancelChoose(page);
    await closeSettings();

    // ---- a document: the list, commonest first
    await doc(page);
    const brfBefore = await docBraille(kind, page);
    await openChoose(page);
    await openLeft(page);
    ls = await waitLeft(page, (s) => s.rows.length > 0, 'rows');
    const want = expectRows(STRONG);
    const got = ls.state && ls.state.rows.map((r) => ({ print: r.print, times: r.times }));
    ok(`${label}: Sam's ticks leave out ${want.length} different contractions of the document; the list shows them with their counts, commonest first, exactly as counted here`, ls.good && JSON.stringify(got.slice(0, 15)) === JSON.stringify(want.slice(0, 15)), { got: got && got.slice(0, 8), want: want.slice(0, 8) });
    ok(`${label}: the commonest is "the" (${want[0].times} times) and the counts never go up the list`, got && got[0].print === 'the' && got.every((r, i) => i === 0 || Number(r.times) <= Number(got[i - 1].times)), got && got.slice(0, 5));
    const the = ls.state.rows[0];
    ok(`${label}: a row says what the sign is for and its group ("the": a word, or part of a word; Strong Wordsigns)`, the.use === 'a word, or part of a word' && the.group === 'Strong Wordsigns', the);
    const rowOf = (p) => ls.state.rows.find((r) => r.print === p);
    ok(`${label}: a whole-word sign and a groupsign are different rows ("children" a whole word in Shortforms; "ch" none left out because Sam holds it)`, rowOf('children') && rowOf('children').use === 'a whole word' && rowOf('children').group === 'Shortforms' && !rowOf('ch'), ls.state.rows.slice(0, 12));
    ok(`${label}: the summary and the sentence under it give the totals`, new RegExp(`^Left out in this document: ${want.length} contractions$`).test(ls.state.summary) && ls.state.note.includes(`${want.length} contractions are left out, ${want.reduce((n, r) => n + Number(r.times), 0)} times in all`), ls.state);
    ok(`${label}: the list is a table with column headings for a screen reader`, await page.evaluate(() => [...document.querySelectorAll('#rpLeftTable thead th')].map((t) => t.textContent).join('|') === 'Contraction|Used for|Group|Times' && document.querySelector('#rpLeftRows tr th[scope="row"]') !== null));
    ok(`${label}: the list is not a live region and not inside one`, await page.evaluate(() => !document.getElementById('rpLeft').closest('[aria-live],[role=status],[role=alert],[role=log]') && !document.querySelector('#rpLeft [aria-live],#rpLeft [role=status]')));
    ok(`${label}: "Left out in this document" is below the groups (Paul, 2 Nov 2026: closed, below)`, await page.evaluate(() => !!(document.getElementById('rpTable').compareDocumentPosition(document.getElementById('rpLeft')) & Node.DOCUMENT_POSITION_FOLLOWING)));

    // ---- ticking changes the list and the sample at once; the document does not change until Done (P1)
    await tick(page, 'strong_wordsigns:the');
    const wantThe = expectRows([...STRONG, 'strong_wordsigns:the']);
    ls = await waitLeft(page, (s) => !s.rows.some((r) => r.print === 'the'), 'the gone');
    ok(`${label}: ticking "the" takes it out of the list at once; the others keep their counts and order`, ls.good && JSON.stringify(ls.state.rows.slice(0, 15).map((r) => ({ print: r.print, times: r.times }))) === JSON.stringify(wantThe.slice(0, 15)), { got: ls.state.rows.slice(0, 4), want: wantThe.slice(0, 4) });
    const afterThe = unicodeFor(DEFAULT_SAMPLE, [...STRONG, 'strong_wordsigns:the']);
    let w = await waitSample(page, afterThe);
    ok(`${label}: ... and the sample shows "the" as its sign`, w.good && afterThe !== unicodeFor(DEFAULT_SAMPLE, STRONG), w);
    await page.locator('#rpTable input[data-group="shortforms"]').check();
    const keysSF = [...STRONG, 'strong_wordsigns:the', ...keysOf((s) => s.group === 'shortforms')];
    w = await waitSample(page, unicodeFor(DEFAULT_SAMPLE, keysSF));
    ok(`${label}: ticking a whole group (Shortforms) changes the sample at once`, w.good && unicodeFor(DEFAULT_SAMPLE, keysSF) !== afterThe, w);
    ls = await waitLeft(page, (s) => !s.rows.some((r) => r.print === 'children'), 'children gone');
    ok(`${label}: ... and the group's signs leave the list ("children")`, ls.good, ls.state && ls.state.rows.slice(0, 6));
    await page.locator('#rpTable input[data-group="shortforms"]').uncheck();
    await page.locator('#rpTable input[data-group="strong_contractions"]').uncheck();
    w = await waitSample(page, unicodeFor(DEFAULT_SAMPLE, ['strong_wordsigns:the']));
    ok(`${label}: clearing the group Strong Contractions spells those signs out in the sample`, w.good, w);
    ls = await waitLeft(page, (s) => s.rows.some((r) => r.print === 'ch'), 'ch back');
    ok(`${label}: ... and they come into the list ("ch" is a groupsign, not "child")`, ls.good && ls.state.rows.find((r) => r.print === 'ch').use === 'part of a word', ls.state && ls.state.rows.slice(0, 8));
    ok(`${label}: the document's own braille has not changed (Done has not been pressed)`, flat(await docBraille(kind, page)) === flat(brfBefore));
    ok(`${label}: the sample braille and the ticks are not announced: the braille is plain text outside any live region`, await page.evaluate(() => {
      const b = document.getElementById('rpSampleBrl');
      return !b.closest('[aria-live],[role=status],[role=alert],[role=log]') && !b.hasAttribute('aria-live') && b.tagName === 'P';
    }));
    ok(`${label}: there is no live region in the dialog at all (the message line went with the profile buttons)`, await page.evaluate(() => document.querySelectorAll('#contractionsDialog [aria-live],#contractionsDialog [role=status],#contractionsDialog [role=alert]').length === 0));
    // Cancel throws the working ticks away: the document is as it was, and the dialog opens again on the ticks in force
    await cancelChoose(page);
    ok(`${label}: Cancel leaves the document's braille as it was`, flat(await docBraille(kind, page)) === flat(brfBefore));
    await closeSettings();
    await openChoose(page);
    ok(`${label}: ... and the dialog opens again on the ticks in force (Sam's ${STRONG.length}), not the thrown-away ones`, new RegExp(`^${STRONG.length} of `).test(await page.evaluate(() => document.getElementById('rpCount').textContent)));

    // ---- Done: the document is brailled again with the ticks (P1)
    await tick(page, 'strong_wordsigns:the');
    await page.click('#rpDone');
    await page.waitForTimeout(800);
    ok(`${label}: Done makes the document's braille again (it changes now)`, flat(await docBraille(kind, page)) !== flat(brfBefore));
    await openChoose(page);
    await tick(page, 'strong_wordsigns:the', false);
    await page.click('#rpDone');
    await page.waitForTimeout(800);
    ok(`${label}: ... and unticking it again and pressing Done brings the first braille back`, flat(await docBraille(kind, page)) === flat(brfBefore));
    await closeSettings();

    // ---- the teacher's own sentence: remembered, not per template; reset goes back
    await openChoose(page);
    await page.fill('#rpSampleText', 'Ben had a good day at school.');
    const own = unicodeFor('Ben had a good day at school.', STRONG);
    w = await waitSample(page, own);
    ok(`${label}: a sentence typed by the teacher is brailled with the ticks`, w.good, w);
    const keep = await page.evaluate(() => localStorage.getItem('emboss-relaxed-sample'));
    ok(`${label}: ... and remembered on this computer`, keep === 'Ben had a good day at school.', keep);
    await tickAllGroups(page, false);
    w = await waitSample(page, unicodeFor('Ben had a good day at school.', []));
    ok(`${label}: the same sentence stays when the ticks change (one sentence, not per template) and is brailled with them`, w.good && (await sampleNow(page)).print === 'Ben had a good day at school.', w);
    await cancelChoose(page);
    await closeSettings();
    await load(page);
    await doc(page);
    await openChoose(page);
    sm = await sampleNow(page);
    ok(`${label}: after a reload the teacher's sentence is still there`, sm.print === 'Ben had a good day at school.', sm);
    await page.click('#rpSampleReset');
    sm = await sampleNow(page);
    ok(`${label}: "Use the standard sentence" brings back the standard one and forgets the other`, sm.print === DEFAULT_SAMPLE && (await page.evaluate(() => localStorage.getItem('emboss-relaxed-sample'))) === null, sm);

    // ---- a changed document is counted again at the next opening (and an unchanged one is not)
    await cancelChoose(page);
    await closeSettings();
    const DOC2 = 'My mother and father went out to the shops with their friends.\n';
    await doc(page, DOC2);
    await openChoose(page);
    await openLeft(page);
    const counted2 = await countSigns(DOC2, tp);
    const want2 = leftOut(counted2.counts, new Set(STRONG)).map((x) => ({ print: x.sign.learnKey, times: String(x.count) }));
    ls = await waitLeft(page, (s) => s.rows.length > 0 && s.rows.length === want2.length, 'second document');
    ok(`${label}: a different document in the editor / Quick Mode is counted again when the dialog is opened again (${want2.length} left out)`, ls.good && JSON.stringify(ls.state.rows.map((r) => ({ print: r.print, times: r.times }))) === JSON.stringify(want2), ls.state && ls.state.rows.slice(0, 5));

    await cancelChoose(page);
    await closeSettings();
    await doc(page);                                                // the first document again: counted again, and not the second one's list
    await openChoose(page);
    ls = await waitLeft(page, (s) => s.rows.length > 0, 'first document again');
    await openLeft(page);
    ok(`${label}: and the first document is counted again when it comes back (the list is its own, not the other one's)`, ls.good && (await leftState(page)).rows.length === Math.min(15, expectRows(STRONG).length) && (await leftState(page)).rows[0].print === 'the', ls.state && ls.state.rows.slice(0, 3));

    // ---- many different contractions: the top 15 and "Show all"
    await tickAllGroups(page, false);
    await openLeft(page);
    const wantE = expectRows([]);
    ls = await waitLeft(page, (s) => s.rows.length > 0 && s.more, 'top 15');
    ok(`${label}: with nothing ticked ${wantE.length} different contractions are left out; the list shows the top 15 and "Show all ${wantE.length}"`, ls.good && ls.state.rows.length === 15 && ls.state.more.text === `Show all ${wantE.length}` && ls.state.more.expanded === 'false' && wantE.length > 15, ls.state && { n: ls.state.rows.length, more: ls.state.more });
    await page.click('#rpLeftMore');
    ls = await leftState(page);
    ok(`${label}: Show all lists every one, in the same order; the button then offers "Show only the top 15" (aria-expanded true)`, ls.rows.length === wantE.length && JSON.stringify(ls.rows.map((r) => ({ print: r.print, times: r.times }))) === JSON.stringify(wantE) && ls.more.text === 'Show only the top 15' && ls.more.expanded === 'true', { n: ls.rows.length, more: ls.more });
    await page.click('#rpLeftMore');
    ls = await leftState(page);
    ok(`${label}: ... and back to the top 15`, ls.rows.length === 15 && ls.more.expanded === 'false');

    // ---- every box ticked (All): full contracted braille in the sample; nothing is left out
    await tickAllGroups(page, true);
    w = await waitSample(page, unicodeFor(DEFAULT_SAMPLE, null));
    ok(`${label}: with every box ticked the sample is the full contracted braille`, w.good, w);
    ls = await waitLeft(page, (s) => /Nothing is left out: every contraction is ticked/.test(s.note), 'all ticked');
    ok(`${label}: ... and the list says nothing is left out ("Nothing is left out: every contraction is ticked.")`, ls.good && ls.state.rows.length === 0 && ls.state.summary === 'Left out in this document: nothing', ls.state);

    // ---- the keyboard alone
    await tickAllGroups(page, false);
    await page.evaluate(() => { if (!document.getElementById('rpLeft').open) document.getElementById('rpLeft').open = true; });
    await page.focus('#rpSampleText');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Mum went out.');
    w = await waitSample(page, unicodeFor('Mum went out.', []));
    ok(`${label}: typing a sentence with the keyboard updates the sample`, w.good, w);
    const order = [];
    await page.focus('#rpSampleText');
    for (let i = 0; i < 4 && order[order.length - 1] !== 'rpg-alphabetic_wordsigns'; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement.id || document.activeElement.tagName)); }
    ok(`${label}: Tab goes from the sample sentence to its button, then into the groups (the first group's checkbox)`, order[0] === 'rpSampleReset' && order[1] === 'rpg-alphabetic_wordsigns', order);
    await page.focus('#rpLeftSum');
    await page.keyboard.press('Space');
    const closedBySpace = await page.evaluate(() => !document.getElementById('rpLeft').open);
    await page.keyboard.press('Space');
    ok(`${label}: Space on "Left out in this document" closes and opens it`, closedBySpace && await page.evaluate(() => document.getElementById('rpLeft').open));
    await page.focus('#rpLeftMore');
    await page.keyboard.press('Enter');
    ok(`${label}: Enter on "Show all" shows the rest`, (await leftState(page)).more.expanded === 'true');
    await page.keyboard.press('Enter');
    await page.focus('#rpDone');
    await page.keyboard.press('Shift+Tab');
    const before = await page.evaluate(() => document.activeElement.id || document.activeElement.tagName);
    ok(`${label}: Shift+Tab from Done goes to Cancel (${before})`, before === 'rpCancel', before);
    page.__answer = true;
    await page.keyboard.press('Escape');                              // unapplied ticks: the question is answered yes
    await page.waitForTimeout(300);
    ok(`${label}: Escape closes the dialog`, await page.evaluate(() => !document.getElementById('contractionsDialog').open));
    ok(`${label}: no page errors`, errors.length === 0, errors);
  } catch (e) { ok(`${label} run completed`, false, String(e && e.stack || e)); }
  await clean(page);
  await ctx.close();
}
await story('editor');
await story('quick');

// ---- no document in the editor ----------------------------------------------------------------------------------------------------------
try {
  console.log(`--- the editor with nothing written (${ENGINE_LABEL}) ---`);
  const { ctx, page, errors } = await newPage({ simple: false });
  await editorLoad(page);
  await openChoose(page);
  // Paul, 3 Oct 2026 (S1): the demonstration document the editor opens with is not counted - untouched, it is "no document".
  let ls = await waitLeft(page, (s) => /no document/i.test(s.summary), 'demo');
  ok('editor, the demonstration document it opens with: not counted (no document is open)', ls.good && /No document is open/.test(ls.state.note) && ls.state.rows.length === 0, ls.state);
  await cancelChoose(page);
  await page.evaluate(() => { const d = document.getElementById('settingsDialog'); if (d.open) d.close(); });
  await emptyEditor(page);
  await openChoose(page);
  ls = await waitLeft(page, (s) => /no document/i.test(s.summary), 'nodoc');
  ok('editor, empty page: the list says that no document is open', ls.good && /No document is open, so there is nothing to count/.test(ls.state.note), ls.state);
  ok('editor, empty page: no page errors', errors.length === 0, errors);
  await clean(page); await ctx.close();
} catch (e) { ok('empty editor run completed', false, String(e && e.stack || e)); }

// ---- not UEB contracted: no sample, no list (the button is not even there; the dialog's parts are hidden if it is opened) -----------------
try {
  console.log(`--- a book in Quick Mode: counted in the background (${ENGINE_LABEL}) ---`);
  const bookPath = path.join(HERE, 'nimas_samples', '9780544087507NIMAS.xml');
  const { ctx, page, errors } = await newPage({ simple: true, active: EMPTY });
  await quickLoad(page);
  await page.setInputFiles('#fileInput', bookPath);
  await page.waitForFunction(() => !document.getElementById('result').hidden && (window.lastBrf || '').trim().length > 0, null, { timeout: 240000 });
  await page.waitForTimeout(500);
  // watch the page's responsiveness and the text of the summary while the dialog counts
  await page.evaluate(() => {
    window.__stall = { max: 0, last: performance.now(), seen: [] };
    setInterval(() => { const n = performance.now(); window.__stall.max = Math.max(window.__stall.max, n - window.__stall.last); window.__stall.last = n; }, 20);
    new MutationObserver(() => { const s = document.getElementById('rpLeftSum'); if (s) window.__stall.seen.push([Math.round(performance.now()), s.textContent]); }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const t0 = Date.now();
  await page.click('#settingsBtn'); await page.waitForSelector('#settingsDialog[open]');
  await page.click('#tplSettings > summary');
  await page.click('#contractionsBtn'); await page.waitForSelector('#contractionsDialog[open]');
  await page.waitForFunction(() => /contractions$|nothing$/.test(document.getElementById('rpLeftSum').textContent) && !/counting/.test(document.getElementById('rpLeftSum').textContent), null, { timeout: 120000, polling: 100 });
  const took = Date.now() - t0;
  const info = await page.evaluate(() => ({ stall: Math.round(window.__stall.max), seen: window.__stall.seen.map((x) => x[1]).filter((x, i, a) => a.indexOf(x) === i), sum: document.getElementById('rpLeftSum').textContent }));
  console.log(`      the book (about 150,000 words): the list was ready ${took} ms after opening the dialog; the longest the page was stuck: ${info.stall} ms; summary: ${info.sum}`);
  ok('a whole book: "counting…" is shown while it is counted, then the totals', info.seen.some((x) => /counting/.test(x)) && /^Left out in this document: \d[\d,]* contractions$/.test(info.sum), info);
  ok('a whole book: the page is never stuck for more than half a second while it is counted', info.stall < 500, info.stall);
  // ticking is instant once counted
  await openLeft(page);
  const t1 = Date.now();
  await tick(page, 'strong_wordsigns:the');
  await page.waitForFunction(() => !([...document.querySelectorAll('#rpLeftRows .rp-print')].some((e) => e.textContent === 'the')), null, { timeout: 5000, polling: 20 });
  const tickMs = Date.now() - t1;
  console.log(`      a tick changes the list of the whole book in ${tickMs} ms`);
  ok('a whole book: a tick changes the list at once (no new count)', tickMs < 1500, tickMs);
  await page.click('#rpCancel').catch(() => {});
  await page.evaluate(() => { const d = document.getElementById('contractionsDialog'); if (d.open) d.close(); });
  await page.waitForTimeout(200);
  // opening again with the same document is instant (cached)
  await page.evaluate(() => { document.getElementById('settingsDialog').open || document.getElementById('settingsBtn').click(); });
  await page.waitForTimeout(300);
  await page.click('#contractionsBtn').catch(() => {});
  const t2 = Date.now();
  await page.waitForFunction(() => /contractions$|nothing$/.test(document.getElementById('rpLeftSum').textContent) && !/counting/.test(document.getElementById('rpLeftSum').textContent), null, { timeout: 20000, polling: 20 });
  console.log(`      the same book again: the list is there after ${Date.now() - t2} ms (counted once)`);
  ok('a whole book: opening the dialog again is instant: the count is kept while the text is the same', Date.now() - t2 < 1500, Date.now() - t2);
  ok('a whole book: no page errors', errors.length === 0, errors);
  await page.evaluate(() => { const d = document.getElementById('contractionsDialog'); if (d && d.open) { d.close(); } });
  await clean(page); await ctx.close();
} catch (e) { ok('book run completed', false, String(e && e.stack || e)); }

// ---- grade 1: the dialog cannot be reached; if the table is not UEB contracted the new parts are hidden ----------------------------------
try {
  console.log(`--- UEB grade 1 (${ENGINE_LABEL}) ---`);
  const { ctx, page, errors } = await newPage({ simple: false });
  await editorLoad(page);
  await openChoose(page);
  await page.evaluate(() => { document.getElementById('rpCancel').click(); });
  await page.selectOption('#set-language', 'en-ueb-g1');
  await page.waitForTimeout(800);
  const hidden = await page.evaluate(() => ({ field: document.getElementById('contractionsField').hidden }));
  ok('grade 1: the Contractions line (and with it the sample and the list) is not offered', hidden.field, hidden);
  // force the dialog open on a grade-1 table: the parts that need UEB contracted stay hidden
  await page.evaluate(() => { document.getElementById('contractionsField').hidden = false; });
  await page.click('#contractionsBtn');
  await page.waitForSelector('#contractionsDialog[open]');
  await page.waitForTimeout(600);
  const parts = await page.evaluate(() => ({ sample: document.getElementById('rpSample').hidden, left: document.getElementById('rpLeft').hidden }));
  ok('grade 1: if the Choose contractions dialog is opened anyway, the sample and the list stay hidden', parts.sample && parts.left, parts);
  await page.evaluate(() => { document.getElementById('rpCancel').click(); });
  await page.selectOption('#set-language', 'en-ueb-g2');
  await page.waitForTimeout(600);
  ok('grade 1: no page errors', errors.length === 0, errors);
  await clean(page); await ctx.close();
} catch (e) { ok('grade 1 run completed', false, String(e && e.stack || e)); }

// ---- axe: the open dialog with the new parts, and each page with the "Template: ..." label showing -------------------------------
async function axeRun(page, include) {
  await page.evaluate(() => document.fonts.ready);
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ path: AXE });
  const r = await page.evaluate((inc) => window.axe.run(inc ? { include: [inc] } : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }), include);
  return r.violations.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} — ${(n.any[0]?.message || n.failureSummary || '').slice(0, 160)}`) }));
}
for (const kind of ['editor', 'quick']) {
  for (const scheme of ['light', 'dark']) {
    try {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, colorScheme: scheme, locale: 'en-US' });
      const { page, errors } = await newPage({ simple: kind === 'quick', ctx });
      if (kind === 'editor') { await editorLoad(page); await editorDoc(page); } else { await quickLoad(page); await quickDoc(page); }
      // the page with the label showing
      const labelShown = await page.evaluate(() => { const l = document.getElementById('contractionsLabel'); return !!l && !l.hidden && l.getClientRects().length > 0 ? l.textContent : null; });
      ok(`axe ${kind} ${scheme}: the label "Template: ${SAM}" is showing`, labelShown === `Template: ${SAM}`, labelShown);
      let v = await axeRun(page, null);
      ok(`axe WCAG 2 A/AA, ${kind}, ${scheme}: the whole page with the template label showing has no violation`, v.length === 0, v);
      v = await axeRun(page, '#contractionsLabel');
      ok(`axe WCAG 2 A/AA, ${kind}, ${scheme}: the label itself has no violation`, v.length === 0, v);
      // the dialog: Sam's ticks, the list open and counted, a group open, an unapplied tick, the long list
      await openChoose(page);
      await openLeft(page);
      await waitLeft(page, (s) => s.rows.length > 0, 'rows');
      v = await axeRun(page, '#contractionsDialog');
      ok(`axe WCAG 2 A/AA, ${kind}, ${scheme}: the dialog (every group collapsed) with the sample and the list open has no violation`, v.length === 0, v);
      await tick(page, 'strong_contractions:sh', false);                         // a group opened, a mixed group box, the not-applied note
      v = await axeRun(page, '#contractionsDialog');
      ok(`axe WCAG 2 A/AA, ${kind}, ${scheme}: ... with a group open, a mixed group box and the not-applied note has no violation`, v.length === 0, v);
      await tickAllGroups(page, false);
      await waitLeft(page, (s) => s.more, 'more');
      await page.click('#rpLeftMore');
      v = await axeRun(page, '#contractionsDialog');
      ok(`axe WCAG 2 A/AA, ${kind}, ${scheme}: ... with every row shown and nothing ticked has no violation`, v.length === 0, v);
      await page.fill('#rpSampleText', (DEFAULT_SAMPLE + ' ' + DEFAULT_SAMPLE).slice(0, 160));            // the longest sentence the field takes
      await tickAllGroups(page, true);
      await page.waitForTimeout(300);
      v = await axeRun(page, '#contractionsDialog');
      ok(`axe WCAG 2 A/AA, ${kind}, ${scheme}: ... with every box ticked (nothing left out) has no violation`, v.length === 0, v);
      // Paul, 7 Oct 2026: one scrolling area — the sample is not pinned, and the table never gets a small scrolling box of its own (on a
      // colleague's window it was squeezed). At several window heights: the dialog fits; the dialog body is what scrolls; the table is laid out whole.
      await page.evaluate(() => { document.getElementById('rpLeft').open = false; });
      await page.click('#rpSampleReset');
      for (const h of [1000, 800, 650]) {
        await page.setViewportSize({ width: 1280, height: h });
        await page.waitForTimeout(200);
        const fits = await page.evaluate(() => {
          const dlg = document.getElementById('contractionsDialog'), body = dlg.querySelector('.rp-body'), sc = document.getElementById('rpScroll'), sm = document.getElementById('rpSample'), tb = document.getElementById('rpTable');
          return { dlgBottom: Math.round(dlg.getBoundingClientRect().bottom), vh: innerHeight, bodyScrolls: body.scrollHeight > body.clientHeight + 1 && getComputedStyle(body).overflowY === 'auto',
            innerScroll: sc.scrollHeight > sc.clientHeight + 1, tableWhole: tb.scrollHeight <= tb.clientHeight + 1, pinned: getComputedStyle(sm).position };
        });
        ok(`axe ${kind} ${scheme}, window ${h}px high: the dialog fits, the whole dialog scrolls as one when it must, and the groups are laid out whole (no small scrolling box)`, fits.dlgBottom <= fits.vh && !fits.innerScroll && fits.tableWhole && fits.pinned !== 'sticky' && (h > 700 || fits.bodyScrolls), fits);
      }
      await page.setViewportSize({ width: 1400, height: 1000 });
      ok(`axe ${kind} ${scheme}: no page errors`, errors.length === 0, errors);
      await page.evaluate(() => { const d = document.getElementById('contractionsDialog'); if (d.open) d.close(); });
      await clean(page);
      await ctx.close();
    } catch (e) { ok(`axe ${kind} ${scheme} run completed`, false, String(e && e.stack || e)); }
  }
}

await browser.close();
console.log(`\n=== Relaxed braille, helping teachers choose [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
