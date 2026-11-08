// Relaxed braille is part of the template: the Contractions line in Settings and the "Choose contractions" dialog, in a real browser - Quick Mode and the editor.
// (This file replaces tests/test-reader-profiles.mjs, which drove the reader-profile manager of A91 Stage 2; renamed because there are no separately named
// profiles now.) Written before the dialog existed: it failed (no Contractions line, no dialog).
//
// PAUL, 2 NOV 2026: "relaxed braille is part of the template (one name)". What must hold (his decisions of that day, EMBOSS-TASKS.md rows X1 and A91):
//  1. One name, the template: no profile picker, no Save / Save as / Rename / Delete / New profile in the dialog; a teacher makes a template per learner
//     ("Sam – Year 2") with the TEMPLATE's own Save as, and the template's one picker and buttons do the rest.
//  2. The ticks are part of the template: saved with it, saved with the document, reopened with it, exported and imported with the template file. A change of
//     ticks makes the template "(modified)" like any braille setting; Undo changes puts them back. BANA and UKAAF have All.
//  3. Settings: inside the closed "Template settings", directly under Braille code, ONE line - "Contractions: All" or "Contractions: 12 of 181" - with a
//     Choose… button, only when relaxed braille is on (?relaxed=1) and the braille code is UEB contracted. No checkboxes in Settings itself.
//  4. The dialog: sample and "Left out in this document" kept; every GROUP collapsed to one row (group checkbox - mixed when part-ticked - name, "6 of 12",
//     and a separate Show button with aria-expanded / aria-controls; never a checkbox inside a <summary>); Done applies (template "(modified)", braille made
//     again); Cancel throws the working ticks away; Escape or the close button with unapplied changes asks first; focus returns to Choose….
//  5. The template is named where the braille shows what is in use (tests/test-relaxed-visible.mjs).
//  6. Reader profiles stored by the earlier preview become templates, once.
//  7. Relaxed off: the ticks are kept but ignored (never "(modified)"); with it off - or on with All - the braille is as it always was.
//
// Runs in Chrome by default; EMBOSS_ENGINE=webkit|firefox for another (tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8175 &   then   node Emboss/tests/test-contractions-dialog.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { seedEntries } from './lib/relaxed-seed.mjs';
import { UEB_CONTRACTION_SIGNS, UEB_CONTRACTION_GROUPS } from '../format/relaxed-signs.mjs';
import { editorTranslators } from '../format/node-translate-helper.mjs';
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

const SENTENCE = 'The teacher said that children should go through the garden.';
const TOTAL = UEB_CONTRACTION_SIGNS.length;
const NGROUPS = UEB_CONTRACTION_GROUPS.length;
const STRONG_KEYS = UEB_CONTRACTION_SIGNS.filter((s) => s.group === 'strong_contractions').map((s) => s.key);
const CONTRACTED = editorTranslators(louis, {}).translate(SENTENCE);
const STRONG_ONLY = editorTranslators(louis, { relaxed: new Set(STRONG_KEYS) }).translate(SENTENCE);
const NOTHING_TICKED = editorTranslators(louis, { relaxed: new Set() }).translate(SENTENCE);
const flat = (brf) => String(brf).replace(/\s+/g, ' ');

const browser = await launchBrowser();
// The page starts with the built-in BANA (All) in use unless `templates` / `active` say otherwise; `extraStorage` is put in localStorage too (once per tab session).
const newPage = async ({ simple, templates = [], active = 'BANA', extraStorage = null, without = [], ctx: given = null }) => {
  const ctx = given || await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true, locale: 'en-US' });
  const entries = { ...seedEntries({ settings: { simpleMode: simple }, templates, active }), ...(extraStorage || {}) };
  for (const k of without) delete entries[k];
  await ctx.addInitScript(([ents]) => {
    try {
      if (!sessionStorage.getItem('cd-seeded')) {
        sessionStorage.setItem('cd-seeded', '1');
        for (const [k, v] of Object.entries(ents)) localStorage.setItem(k, v);
      }
    } catch {}
  }, [entries]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const dialogs = [];                                   // window.confirm questions: the test answers them with page.__answer
  page.__answer = true;
  page.on('dialog', async (d) => { dialogs.push(d.message()); if (page.__answer) await d.accept(); else await d.dismiss(); });
  return { ctx, page, errors, dialogs };
};

// ---- helpers shared by the two pages -------------------------------------------------------------------------------------------------
const editorLoad = async (page, query = '') => {
  if (page.url() !== 'about:blank') await page.evaluate(() => { try { window.markDocumentClean && window.markDocumentClean(); } catch {} }).catch(() => {});
  await page.goto(`${BASE}/web/editor/index.html${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.markDocumentClean === 'function', null, { timeout: 60000 });
  await page.waitForTimeout(1200);
};
const editorDoc = async (page) => {
  await page.evaluate(async (text) => { window.markDocumentClean(); await window.importFile(new File([text], 'sentence.txt', { type: 'text/plain' })); }, SENTENCE + '\n');
  await page.waitForFunction(() => /GARDEN|G>D/.test(window.lastBrf || ''), null, { timeout: 30000 });
  await page.waitForTimeout(600);
};
const quickLoad = async (page, query = '') => { await page.goto(`${BASE}/web/index.html${query}`, { waitUntil: 'load' }); await page.waitForTimeout(1500); };
const quickDoc = async (page) => {
  await page.setInputFiles('#fileInput', { name: 'sentence.txt', mimeType: 'text/plain', buffer: Buffer.from(SENTENCE + '\n') });
  await page.waitForFunction(() => !document.getElementById('result').hidden && (window.lastBrf || '').trim().length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(600);
};
const brfNow = (page) => page.evaluate(() => (window.lastBrf || '').replace(/\r/g, ''));
const waitBrf = async (page, pred) => {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < 20000) { last = await brfNow(page); if (pred(flat(last))) return { good: true, brf: last }; await page.waitForTimeout(250); }
  return { good: false, brf: last };
};
// Settings opens on the Template tab; the Contractions line is in the "Template settings" disclosure (closed at first), directly under Braille code
const openSettings = async (page, disclosure = true) => {
  if (!(await page.evaluate(() => document.getElementById('settingsDialog').open))) { await page.click('#settingsBtn'); await page.waitForSelector('#settingsDialog[open]'); }
  if (disclosure && !(await page.evaluate(() => document.getElementById('tplSettings').open))) await page.click('#tplSettings > summary');
};
const closeSettings = async (page) => { await page.evaluate(() => { const d = document.getElementById('settingsDialog'); if (d.open) d.close(); }); await page.waitForTimeout(300); };
const lineState = (page) => page.evaluate(() => {
  const f = document.getElementById('contractionsField'), b = document.getElementById('contractionsBtn'), l = document.getElementById('contractionsLine');
  return f && b ? { hidden: f.hidden || f.getClientRects().length === 0, line: l.textContent.trim(), button: b.textContent.trim() } : null;
});
const openChoose = async (page) => { await openSettings(page); await page.click('#contractionsBtn'); await page.waitForSelector('#contractionsDialog[open]'); await page.waitForTimeout(150); };
const pickerState = (page) => page.evaluate(() => { const sel = document.getElementById('tplSelect'); return { shown: sel.options[sel.selectedIndex]?.textContent, options: [...sel.options].map((o) => o.textContent), state: document.getElementById('tplState').textContent.trim() }; });
const storedSettings = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('emboss-settings') || '{}'));
const storedTemplates = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('emboss-templates') || 'null'));
const focusId = (page) => page.evaluate(() => document.activeElement && document.activeElement.id);
const msgs = (d) => d.splice(0, d.length);
const groupBox = (page, id) => page.locator(`#rpTable input[data-group="${id}"]`);
const showBtn = (page, id) => page.locator(`#rpTable button[data-expand="${id}"]`);
const signBox = async (page, key) => {            // a contraction's checkbox, opening its group first when it is closed
  const loc = page.locator(`#rpTable input[data-key="${key}"]`);
  if (!(await loc.isVisible())) await showBtn(page, key.split(':')[0]).click();
  return loc;
};
const dialogInfo = (page) => page.evaluate(() => {
  const d = document.getElementById('contractionsDialog');
  const visible = (e) => !!e && e.getClientRects().length > 0 && !e.closest('[hidden]');
  const groups = [...d.querySelectorAll('#rpTable .rp-grouprow')].map((row) => {
    const cb = row.querySelector('input[data-group]'), btn = row.querySelector('button[data-expand]'), panel = row.querySelector('.rp-signs');
    const nameEl = document.getElementById(cb.getAttribute('aria-labelledby')), countEl = document.getElementById(cb.getAttribute('aria-describedby'));
    return { id: cb.dataset.group, name: nameEl && nameEl.textContent, count: countEl && countEl.textContent, checked: cb.checked, mixed: cb.indeterminate,
      expanded: btn.getAttribute('aria-expanded'), controls: btn.getAttribute('aria-controls'), panelId: panel.id, panelHidden: panel.hidden, btnText: btn.textContent.trim(),
      btnName: btn.getAttribute('aria-labelledby'), nSigns: panel.querySelectorAll('input[data-key]').length, inSummary: !!cb.closest('summary') };
  });
  return {
    title: d.querySelector('h2').textContent, labelled: d.getAttribute('aria-labelledby'), modal: d.matches(':modal'), groups,
    visibleBoxes: [...d.querySelectorAll('input[type="checkbox"]')].filter(visible).length, nBoxes: d.querySelectorAll('#rpTable input[data-key]').length,
    ids: ['rpSelect', 'rpSave', 'rpSaveAs', 'rpRename', 'rpDelete', 'rpNew', 'rpName'].filter((i) => d.querySelector('#' + i)),
    buttons: [...d.querySelectorAll('.dialog-foot button')].map((b) => b.textContent.trim()), count: d.querySelector('#rpCount').textContent, dirty: d.querySelector('#rpDirty').textContent,
    focus: document.activeElement && document.activeElement.id, nestedInSummary: d.querySelectorAll('summary input, summary button').length,
  };
});

// ---- both pages: the same story ------------------------------------------------------------------------------------------------------
async function story(kind) {
  const isEditor = kind === 'editor';
  const label = isEditor ? 'editor' : 'Quick Mode';
  const load = isEditor ? editorLoad : quickLoad;
  const doc = isEditor ? editorDoc : quickDoc;
  console.log(`--- ${label} (${ENGINE_LABEL}) ---`);
  const { ctx, page, errors, dialogs } = await newPage({ simple: !isEditor });
  try {
    // off: nothing shows
    await load(page, '?relaxed=0');
    await openSettings(page);
    let b = await lineState(page);
    ok(`${label}: relaxed braille switched off - the Contractions line is hidden`, b && b.hidden, b);
    ok(`${label}: relaxed braille switched off - no Choose contractions dialog exists`, await page.evaluate(() => !document.getElementById('contractionsDialog')));
    await closeSettings(page);

    // on + UEB contracted: shown; grade 1 and other codes: hidden; back: shown
    await load(page, '?relaxed=1');
    await openSettings(page);
    const sel = '#set-language';
    b = await lineState(page);
    ok(`${label}: ?relaxed=1 with UEB contracted - the line says "Contractions: All" and has a Choose… button`, b && !b.hidden && b.line === 'Contractions: All' && b.button === 'Choose…', b);
    const place = await page.evaluate((s) => {
      const f = document.getElementById('contractionsField'), code = document.querySelector(s).closest('.field');
      return { under: code.nextElementSibling === f, inDetails: !!f.closest('details#tplSettings'), checkboxes: f.querySelectorAll('input').length, line: f.querySelectorAll('#contractionsLine').length, buttons: f.querySelectorAll('button').length };
    }, sel);
    ok(`${label}: it sits directly under Braille code, inside Template settings, as ONE line and ONE button - no checkbox in Settings itself`, place.under && place.inDetails && place.checkboxes === 0 && place.line === 1 && place.buttons === 1, place);
    ok(`${label}: Settings holds no contraction checkbox anywhere`, await page.evaluate(() => document.querySelectorAll('#settingsDialog input[data-key], #settingsDialog input[data-group]').length === 0));
    ok(`${label}: the button is named with its line for a screen reader ("Choose… Contractions: All")`, await page.evaluate(() => { const b = document.getElementById('contractionsBtn'); return b.getAttribute('aria-labelledby') === 'contractionsBtn contractionsLine' && b.getAttribute('aria-haspopup') === 'dialog'; }));
    await page.selectOption(sel, 'en-ueb-g1');
    await page.waitForTimeout(500);
    b = await lineState(page);
    ok(`${label}: UEB grade 1 selected - the line is hidden`, b && b.hidden, b);
    const other = await page.evaluate((s) => [...document.querySelector(s).options].map((o) => o.value).find((v) => v && v !== '__more__' && !/^en-ueb/.test(v)), sel);
    await page.selectOption(sel, other);
    await page.waitForTimeout(700);
    b = await lineState(page);
    ok(`${label}: another braille code (${other}) selected - the line is hidden`, b && b.hidden, b);
    await page.selectOption(sel, 'en-ueb-g2');
    await page.waitForTimeout(700);
    b = await lineState(page);
    ok(`${label}: UEB contracted again - the line is back`, b && !b.hidden && b.line === 'Contractions: All', b);
    await closeSettings(page);

    // the dialog, with All
    await load(page, '');
    await doc(page);
    let r = await waitBrf(page, (f) => f.includes(flat(CONTRACTED)));
    ok(`${label}: with All the braille is today's contracted braille`, r.good, { got: r.brf, want: CONTRACTED });
    await openChoose(page);
    let info = await dialogInfo(page);
    ok(`${label}: the dialog is a modal named "Choose contractions" and opens with the focus on the first group's checkbox`, info.title === 'Choose contractions' && info.labelled === 'rpTitle' && info.modal && info.focus === 'rpg-alphabetic_wordsigns', info);
    ok(`${label}: it opens as ${NGROUPS} rows (one per group), every group collapsed - ${NGROUPS} checkboxes on screen, not ${TOTAL}`, info.groups.length === NGROUPS && info.visibleBoxes === NGROUPS && info.groups.every((g) => g.expanded === 'false' && g.panelHidden) && info.nBoxes === TOTAL, { n: info.groups.length, visible: info.visibleBoxes, nBoxes: info.nBoxes });
    ok(`${label}: the rows are in the catalogue's order, named by the groups' labels`, JSON.stringify(info.groups.map((g) => g.name)) === JSON.stringify(UEB_CONTRACTION_GROUPS.map((g) => g.label)), info.groups.map((g) => g.name));
    ok(`${label}: every group checkbox is labelled by the group's name and described by its count ("12 of 12"), all ticked, none mixed`, info.groups.every((g, i) => g.count === `${UEB_CONTRACTION_GROUPS[i].signs.length} of ${UEB_CONTRACTION_GROUPS[i].signs.length}` && g.checked && !g.mixed), info.groups);
    ok(`${label}: each Show button has aria-expanded="false", aria-controls its group's region, and is named "Show" + the group (aria-labelledby)`, info.groups.every((g) => g.controls === g.panelId && g.btnText === 'Show' && g.btnName === `rpe-${g.id} rpgn-${g.id}`), info.groups.slice(0, 2));
    ok(`${label}: no checkbox or button inside a <summary> that is part of the group rows (nested interactive controls break screen readers)`, info.groups.every((g) => !g.inSummary) && info.nestedInSummary === 0, info.nestedInSummary);
    ok(`${label}: no profile picker, no Save / Save as / Rename / Delete / New profile; the buttons are Cancel and Done`, info.ids.length === 0 && JSON.stringify(info.buttons) === JSON.stringify(['Cancel', 'Done']), { ids: info.ids, buttons: info.buttons });
    ok(`${label}: the count says all ${TOTAL} are ticked and nothing is waiting`, new RegExp(`^${TOTAL} of ${TOTAL} contractions ticked`).test(info.count) && info.dirty === '', info);
    ok(`${label}: "Left out in this document" is closed and below the groups; the sample is above them`, await page.evaluate(() => {
      const t = document.getElementById('rpTable'), l = document.getElementById('rpLeft'), s = document.getElementById('rpSample');
      return !l.open && !!(t.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(s.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
    }));

    // expanding one group
    await showBtn(page, 'strong_contractions').click();
    info = await dialogInfo(page);
    const sc = info.groups.find((g) => g.id === 'strong_contractions');
    ok(`${label}: Show opens that group only - aria-expanded true, its ${sc.nSigns} checkboxes appear, the button now says "Hide", the others stay closed`, sc.expanded === 'true' && !sc.panelHidden && sc.btnText === 'Hide' && info.groups.filter((g) => g.expanded === 'true').length === 1 && info.visibleBoxes === NGROUPS + sc.nSigns, { sc, visible: info.visibleBoxes });
    const chBox = page.getByRole('checkbox', { name: 'ch, dots 1 6', exact: true });
    ok(`${label}: a contraction's checkbox is named by its print and its cells ("ch, dots 1 6")`, await chBox.count() === 1 && await chBox.isVisible());
    await signBox(page, 'initial_contractions:day'); await signBox(page, 'lower_contractions:be'); await signBox(page, 'lower_wordsigns:be');      // (a closed group's boxes are not in the page's reading order)
    ok(`${label}: a two-cell contraction is described cell by cell ("day, dot 5, then dots 1 4 5")`, await page.getByRole('checkbox', { name: 'day, dot 5, then dots 1 4 5', exact: true }).count() === 1);
    ok(`${label}: the groupsign "be-" and the wordsign "be" are told apart`, await page.getByRole('checkbox', { name: 'be-, dots 2 3', exact: true }).count() === 1 && await page.getByRole('checkbox', { name: 'be, dots 2 3', exact: true }).count() === 1);
    for (const gid of ['initial_contractions', 'lower_contractions', 'lower_wordsigns']) await showBtn(page, gid).click();
    ok(`${label}: the cells are drawn (⠡ for ch)`, await page.evaluate(() => /⠡/.test(document.querySelector('#rpTable input[data-key="strong_contractions:ch"]').closest('label').textContent)));
    // group checkbox: mixed when part of the group is ticked
    await chBox.uncheck();
    info = await dialogInfo(page);
    let g = info.groups.find((x) => x.id === 'strong_contractions');
    ok(`${label}: unticking one contraction makes its group checkbox mixed, and the count says "11 of 12"`, g.mixed && !g.checked && g.count === '11 of 12', g);
    ok(`${label}: ... and the dialog says the change is not applied yet`, /Not applied yet/.test(info.dirty) && new RegExp(`^${TOTAL - 1} of ${TOTAL} `).test(info.count), info);
    await chBox.check();
    g = (await dialogInfo(page)).groups.find((x) => x.id === 'strong_contractions');
    ok(`${label}: ticking it again makes the group checkbox ticked again`, g.checked && !g.mixed && g.count === '12 of 12', g);
    await groupBox(page, 'strong_contractions').uncheck();
    ok(`${label}: the group checkbox clears the whole group (and the open boxes follow)`, await page.evaluate(() => [...document.querySelectorAll('#rpTable input[data-key^="strong_contractions:"]')].every((x) => !x.checked)));
    await groupBox(page, 'strong_contractions').check();
    ok(`${label}: ... and ticks it again`, await page.evaluate(() => [...document.querySelectorAll('#rpTable input[data-key^="strong_contractions:"]')].every((x) => x.checked)));
    await showBtn(page, 'strong_contractions').click();
    ok(`${label}: Hide closes the group again`, (await dialogInfo(page)).groups.every((x) => x.expanded === 'false' && x.panelHidden));

    // Cancel: the working ticks are thrown away
    await groupBox(page, 'strong_contractions').uncheck();
    msgs(dialogs);
    await page.click('#rpCancel');
    await page.waitForTimeout(200);
    ok(`${label}: Cancel closes the dialog with no question, and the focus is back on Choose…`, dialogs.length === 0 && await page.evaluate(() => !document.getElementById('contractionsDialog').open) && (await focusId(page)) === 'contractionsBtn', { dialogs, focus: await focusId(page) });
    b = await lineState(page);
    r = await waitBrf(page, (f) => f.includes(flat(CONTRACTED)));
    ok(`${label}: ... and nothing changed: the line still says All, the braille is as it was, the template is not modified`, b.line === 'Contractions: All' && r.good && !/modified/.test((await pickerState(page)).shown), { b, picker: await pickerState(page) });

    // Done: the ticks apply
    await page.click('#contractionsBtn');
    await page.waitForSelector('#contractionsDialog[open]');
    ok(`${label}: the dialog opens again on the ticks in force (all ${TOTAL}), not the thrown-away ones`, new RegExp(`^${TOTAL} of ${TOTAL} `).test((await dialogInfo(page)).count));
    for (const gr of UEB_CONTRACTION_GROUPS) if (gr.id !== 'strong_contractions') await groupBox(page, gr.id).uncheck();
    ok(`${label}: unticking every group but Strong Contractions is not applied yet: the braille has not changed`, flat(await brfNow(page)).includes(flat(CONTRACTED)));
    await page.click('#rpDone');
    r = await waitBrf(page, (f) => f.includes(flat(STRONG_ONLY)) && !f.includes(flat(CONTRACTED)));
    ok(`${label}: Done brailles the document again at once with the strong contractions only ("teacher" = TEA*], t e a ch er)`, r.good && flat(r.brf).includes('TEA*]'), { got: r.brf, want: STRONG_ONLY });
    ok(`${label}: after Done the focus is back on Choose…`, (await focusId(page)) === 'contractionsBtn', await focusId(page));
    b = await lineState(page);
    ok(`${label}: the line now says "Contractions: ${STRONG_KEYS.length} of ${TOTAL}"`, b.line === `Contractions: ${STRONG_KEYS.length} of ${TOTAL}`, b);
    let p = await pickerState(page);
    ok(`${label}: the template shows "BANA (modified)" and says "contractions" changed`, p.shown === 'BANA (modified)' && /contractions/.test(p.state), p);
    let st = await storedSettings(page);
    ok(`${label}: the ticks in force are stored in the settings (the strong contractions, in catalogue order)`, JSON.stringify(st.contractions) === JSON.stringify(STRONG_KEYS), st.contractions);
    // a reload: still in force
    await closeSettings(page);
    await load(page, '');
    await doc(page);
    r = await waitBrf(page, (f) => f.includes(flat(STRONG_ONLY)));
    ok(`${label}: after a reload the ticks are still in force (stored on this computer)`, r.good, r.brf);
    await openSettings(page);
    p = await pickerState(page);
    ok(`${label}: ... and the template is still "BANA (modified)"`, p.shown === 'BANA (modified)', p);
    // Undo changes puts the ticks back
    await page.click('#tplRevert');
    r = await waitBrf(page, (f) => f.includes(flat(CONTRACTED)));
    b = await lineState(page);
    ok(`${label}: Undo changes puts the ticks back to the template's (All): braille, line and name`, r.good && b.line === 'Contractions: All' && (await pickerState(page)).shown === 'BANA' && (await storedSettings(page)).contractions === null, { b, picker: await pickerState(page) });

    // Escape, and the close button, ask first when there is something to lose
    await page.click('#contractionsBtn');
    await page.waitForSelector('#contractionsDialog[open]');
    msgs(dialogs);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    ok(`${label}: Escape with nothing changed closes at once, with no question, and the focus is back on Choose…`, dialogs.length === 0 && await page.evaluate(() => !document.getElementById('contractionsDialog').open) && (await focusId(page)) === 'contractionsBtn', { dialogs, focus: await focusId(page) });
    await page.click('#contractionsBtn');
    await page.waitForSelector('#contractionsDialog[open]');
    await groupBox(page, 'shortforms').uncheck();
    page.__answer = false; msgs(dialogs);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    ok(`${label}: Escape with unapplied ticks asks first; answering no keeps the dialog open and the ticks`, dialogs.length === 1 && /not been applied/.test(dialogs[0]) && await page.evaluate(() => document.getElementById('contractionsDialog').open) && !(await groupBox(page, 'shortforms').isChecked()), { dialogs });
    await page.click('#rpClose');
    await page.waitForTimeout(250);
    ok(`${label}: the close button asks the same question; no again keeps it open`, dialogs.length === 2 && await page.evaluate(() => document.getElementById('contractionsDialog').open), dialogs);
    page.__answer = true; msgs(dialogs);
    await page.click('#rpClose');
    await page.waitForTimeout(300);
    ok(`${label}: answering yes closes it, applies nothing, and the focus is back on Choose…`, dialogs.length === 1 && await page.evaluate(() => !document.getElementById('contractionsDialog').open) && (await focusId(page)) === 'contractionsBtn' && (await lineState(page)).line === 'Contractions: All' && (await storedSettings(page)).contractions === null, { dialogs, focus: await focusId(page) });
    // Settings behind it is still open, and the template state is untouched
    ok(`${label}: Settings stays open behind the dialog`, await page.evaluate(() => document.getElementById('settingsDialog').open));
    await closeSettings(page);
    ok(`${label}: no page errors`, errors.length === 0, errors);
  } catch (e) { ok(`${label} run completed`, false, String(e && e.stack || e)); }
  await page.evaluate(() => { try { window.markDocumentClean && window.markDocumentClean(); } catch {} }).catch(() => {});
  await ctx.close();
}
await story('editor');
await story('quick');

// ---- the template carries the ticks (editor): Save as per learner, pick, export, import, the document ---------------------------------------
try {
  console.log(`--- a template per learner (${ENGINE_LABEL}) ---`);
  const { ctx, page, errors } = await newPage({ simple: false });
  await editorLoad(page, '?relaxed=1');
  await editorDoc(page);
  await openChoose(page);
  for (const gr of UEB_CONTRACTION_GROUPS) if (gr.id !== 'strong_contractions') await groupBox(page, gr.id).uncheck();
  await page.click('#rpDone');
  await waitBrf(page, (f) => f.includes(flat(STRONG_ONLY)));
  // the template's own Save as keeps them under a learner's name
  await page.click('#tplSaveAs');
  await page.fill('#tplAskName', 'Sam – Year 2');
  await page.click('#tplAskOk');
  await page.waitForTimeout(500);
  let p = await pickerState(page);
  let store = await storedTemplates(page);
  const sam = store.list.find((t) => t.name === 'Sam – Year 2');
  ok('the template\'s Save as keeps the ticks in the new template "Sam – Year 2" (no separate profile is made), and it is no longer modified', p.shown === 'Sam – Year 2' && sam && JSON.stringify(sam.contractions) === JSON.stringify(STRONG_KEYS), { p, sam });
  ok('... and the old profile store is untouched (nothing is written to it)', await page.evaluate(() => localStorage.getItem('emboss-reader-profiles') === null && localStorage.getItem('emboss-reader-profile') === null));
  // pick BANA: All; pick Sam: the strong contractions
  await page.selectOption('#tplSelect', 'bana');
  let r = await waitBrf(page, (f) => f.includes(flat(CONTRACTED)));
  ok('choosing BANA puts All in force: the line says All and the braille is full contraction', r.good && (await lineState(page)).line === 'Contractions: All' && (await storedSettings(page)).contractions === null, await lineState(page));
  await page.selectOption('#tplSelect', sam.id);
  r = await waitBrf(page, (f) => f.includes(flat(STRONG_ONLY)));
  ok('choosing "Sam – Year 2" puts its ticks in force: the line says 12 of 181 and the braille is Sam\'s', r.good && (await lineState(page)).line === `Contractions: ${STRONG_KEYS.length} of ${TOTAL}` && (await pickerState(page)).shown === 'Sam – Year 2', { line: await lineState(page), picker: await pickerState(page) });
  // export carries the ticks
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#tplExport')]);
  const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  ok('Export writes the ticks in the template file (a "contractions" list of the catalogue keys)', exported.name === 'Sam – Year 2' && JSON.stringify(exported.contractions) === JSON.stringify(STRONG_KEYS), exported);
  // the document records them
  const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  const meta = /<meta name="emboss-template-contractions" content="([^"]*)" \/>/.exec(xml);
  ok('the saved document records the template and its ticks (emboss-template-contractions)', /<meta name="emboss-template" content="Sam – Year 2" \/>/.test(xml) && meta && JSON.stringify(JSON.parse(meta[1].replace(/&quot;/g, '"'))) === JSON.stringify(STRONG_KEYS), xml.match(/<meta name="emboss-template[^>]*>/g));
  // reopen it under another template
  await page.selectOption('#tplSelect', 'bana');
  await waitBrf(page, (f) => f.includes(flat(CONTRACTED)));
  await closeSettings(page);
  await page.evaluate(async (x) => { window.markDocumentClean(); await window.importFile(new File([x], 'saved.xml', { type: 'application/xml' })); }, xml);
  r = await waitBrf(page, (f) => f.includes(flat(STRONG_ONLY)));
  await openSettings(page);
  p = await pickerState(page);
  ok('reopening the document makes "Sam – Year 2" the template again, with its ticks in force (braille, line, no "(modified)")', r.good && p.shown === 'Sam – Year 2' && (await lineState(page)).line === `Contractions: ${STRONG_KEYS.length} of ${TOTAL}`, { p, line: await lineState(page) });
  // a document from a computer that has no such template: "from document" keeps the ticks, and Save as keeps them under a name
  await closeSettings(page);
  const xml2 = xml.replace('content="Sam – Year 2"', 'content="Kim – Year 3"');
  await page.evaluate(async (x) => { window.markDocumentClean(); await window.importFile(new File([x], 'kim.xml', { type: 'application/xml' })); }, xml2);
  await waitBrf(page, (f) => f.includes(flat(STRONG_ONLY)));
  await openSettings(page);
  p = await pickerState(page);
  ok('a document whose template is not here shows "Kim – Year 3 (from document)" with the ticks it was saved with', p.shown === 'Kim – Year 3 (from document)' && (await lineState(page)).line === `Contractions: ${STRONG_KEYS.length} of ${TOTAL}`, { p, line: await lineState(page) });
  await page.click('#tplSaveAs');
  await page.fill('#tplAskName', 'Kim – Year 3');
  await page.click('#tplAskOk');
  await page.waitForTimeout(400);
  store = await storedTemplates(page);
  ok('... and Save as keeps the ticks in a template of its own', store.list.some((t) => t.name === 'Kim – Year 3' && JSON.stringify(t.contractions) === JSON.stringify(STRONG_KEYS)), store.list.map((t) => t.name));
  // a document with no ticks recorded opens as All
  const plain = xml.replace(/\s*<meta name="emboss-template-contractions"[^>]*>/, '');
  await closeSettings(page);
  await page.evaluate(async (x) => { window.markDocumentClean(); await window.importFile(new File([x], 'plain.xml', { type: 'application/xml' })); }, plain);
  r = await waitBrf(page, (f) => f.includes(flat(CONTRACTED)));
  ok('a document that records no ticks is made with All (the template of that name is then "(modified)")', r.good && (await storedSettings(page)).contractions === null, { stored: (await storedSettings(page)).contractions });
  // import into a fresh computer: the template arrives with its ticks
  const fresh = await newPage({ simple: false });
  await editorLoad(fresh.page, '?relaxed=1');
  await openSettings(fresh.page);
  await fresh.page.setInputFiles('#tplImportFile', { name: 'Sam.emboss-template.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await fresh.page.waitForTimeout(900);
  const fp = await pickerState(fresh.page);
  ok('Import on another computer brings the template with its ticks and puts them in force', fp.shown === 'Sam – Year 2' && (await lineState(fresh.page)).line === `Contractions: ${STRONG_KEYS.length} of ${TOTAL}` && JSON.stringify((await storedSettings(fresh.page)).contractions) === JSON.stringify(STRONG_KEYS), { fp, line: await lineState(fresh.page) });
  await fresh.page.evaluate(() => { try { window.markDocumentClean(); } catch {} });
  await fresh.ctx.close();
  // Delete the template in use: back to the built-in, All
  await openSettings(page);
  await page.selectOption('#tplSelect', sam.id);
  await page.waitForTimeout(500);
  await page.click('#tplDelete');
  await page.click('#tplAskOk');
  r = await waitBrf(page, (f) => f.includes(flat(CONTRACTED)));
  ok('deleting the template in use goes back to BANA: All in force, braille full contraction', r.good && (await lineState(page)).line === 'Contractions: All', await lineState(page));
  ok('template story: no page errors', errors.length === 0, errors);
  await page.evaluate(() => { try { window.markDocumentClean(); } catch {} });
  await ctx.close();
} catch (e) { ok('template story completed', false, String(e && e.stack || e)); }

// ---- relaxed off: the ticks are kept but ignored ----------------------------------------------------------------------------------------
try {
  console.log(`--- relaxed braille off: kept but ignored (${ENGINE_LABEL}) ---`);
  const templates = [{ name: 'Sam – Year 2', contractions: STRONG_KEYS }];
  const { ctx, page, errors } = await newPage({ simple: false, templates, active: 'Sam – Year 2' });
  await editorLoad(page, '?relaxed=0');
  await editorDoc(page);
  let r = await waitBrf(page, (f) => f.includes(flat(CONTRACTED)));
  ok('?relaxed=0 with a template that holds ticks in use: the braille is full contraction (the ticks are ignored)', r.good, r.brf);
  await openSettings(page);
  let p = await pickerState(page);
  ok('... the template is NOT "(modified)" - the ticks do not count while relaxed braille is off', p.shown === 'Sam – Year 2', p);
  ok('... and the ticks are still stored in the settings and the template (kept)', JSON.stringify((await storedSettings(page)).contractions) === JSON.stringify(STRONG_KEYS) && JSON.stringify((await storedTemplates(page)).list[0].contractions) === JSON.stringify(STRONG_KEYS));
  const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('... and a document saved now still records them', /emboss-template-contractions/.test(xml));
  await closeSettings(page);
  await editorLoad(page, '?relaxed=1');
  await editorDoc(page);
  r = await waitBrf(page, (f) => f.includes(flat(STRONG_ONLY)));
  await openSettings(page);
  ok('?relaxed=1 again: the ticks apply at once, and the template is still not modified', r.good && (await pickerState(page)).shown === 'Sam – Year 2' && (await lineState(page)).line === `Contractions: ${STRONG_KEYS.length} of ${TOTAL}`, { picker: await pickerState(page), line: await lineState(page) });
  ok('relaxed off: no page errors', errors.length === 0, errors);
  await page.evaluate(() => { try { window.markDocumentClean(); } catch {} });
  await ctx.close();
} catch (e) { ok('relaxed-off run completed', false, String(e && e.stack || e)); }

// ---- the earlier reader profiles become templates, once ------------------------------------------------------------------------------------
try {
  console.log(`--- profiles of the earlier preview become templates (${ENGINE_LABEL}) ---`);
  const oldProfiles = JSON.stringify({ v: 1, profiles: [{ name: 'Strong only', keys: STRONG_KEYS }, { name: 'BANA', keys: [] }, { name: 'Sam – Dot-to-Dot 6', keys: STRONG_KEYS.slice(0, 3) }] });
  // settings exist (a computer that has been used), no templates yet; the profile "Strong only" was in use
  const { ctx, page, errors } = await newPage({ simple: false, without: ['emboss-templates'], extraStorage: { 'emboss-reader-profiles': oldProfiles, 'emboss-reader-profile': 'Strong only' } });
  await editorLoad(page, '?relaxed=1');
  await editorDoc(page);
  const r = await waitBrf(page, (f) => f.includes(flat(STRONG_ONLY)));
  ok('the profile that was in use is in force: the braille is the strong contractions only', r.good, r.brf);
  await openSettings(page);
  let p = await pickerState(page);
  ok('its template is the active one, not "(modified)", and the other profiles are templates too (a clash with BANA is renamed "BANA (2)")', p.shown === 'Strong only' && ['Sam – Dot-to-Dot 6', 'BANA (2)'].every((n) => p.options.includes(n)) && p.options.includes('Strong only'), p);
  const store = await storedTemplates(page);
  const sam = store.list.find((t) => t.name === 'Sam – Dot-to-Dot 6');
  ok('each template holds its profile\'s ticks', sam && sam.contractions.length === 3 && store.list.find((t) => t.name === 'BANA (2)').contractions.length === 0, store.list.map((t) => [t.name, t.contractions && t.contractions.length]));
  ok('the old profile keys are left in place (not deleted)', await page.evaluate((v) => localStorage.getItem('emboss-reader-profiles') === v && localStorage.getItem('emboss-reader-profile') === 'Strong only', oldProfiles));
  // once: a reload makes no more
  await closeSettings(page);
  await editorLoad(page, '?relaxed=1');
  await openSettings(page);
  const again = await pickerState(page);
  ok('a second load makes no more templates', again.options.length === p.options.length && again.shown === 'Strong only', again);
  ok('migration: no page errors', errors.length === 0, errors);
  await page.evaluate(() => { try { window.markDocumentClean(); } catch {} });
  await ctx.close();
} catch (e) { ok('migration run completed', false, String(e && e.stack || e)); }

// ---- keyboard only (editor) ---------------------------------------------------------------------------------------------------------
try {
  console.log(`--- keyboard only, editor (${ENGINE_LABEL}) ---`);
  const { ctx, page, errors, dialogs } = await newPage({ simple: false });
  await editorLoad(page, '?relaxed=1');
  await editorDoc(page);
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) await page.keyboard.press(k); };
  const active = () => page.evaluate(() => { const a = document.activeElement; return a ? { id: a.id, group: a.dataset && a.dataset.group, key: a.dataset && a.dataset.key, tag: a.tagName } : null; });
  await openSettings(page);
  await page.focus('#contractionsBtn');
  await key('Enter');
  await page.waitForSelector('#contractionsDialog[open]');
  ok('keyboard: Enter on Choose… opens the dialog, focus on the first group\'s checkbox', (await active()).id === 'rpg-alphabetic_wordsigns');
  await key('Space');
  ok('keyboard: Space on a group checkbox clears the whole group (a tick state the sample and counts follow)', await page.evaluate(() => [...document.querySelectorAll('#rpTable input[data-key^="alphabetic_wordsigns:"]')].every((x) => !x.checked)) && (await dialogInfo(page)).groups[0].count === '0 of 23');
  await key('Tab');
  const onShow = await active();
  ok('keyboard: Tab goes to that group\'s Show button (not into a closed group)', onShow.id === 'rpe-alphabetic_wordsigns', onShow);
  await key('Enter');
  ok('keyboard: Enter on Show opens the group (aria-expanded true)', (await dialogInfo(page)).groups[0].expanded === 'true');
  await key('Tab');
  ok('keyboard: Tab then goes into the group\'s own checkboxes (the first is "but")', (await active()).key === 'alphabetic_wordsigns:but', await active());
  await key('Space');
  const one = await page.evaluate(() => { const c = document.querySelector('#rpTable input[data-key="alphabetic_wordsigns:but"]'), g = document.querySelector('#rpTable input[data-group="alphabetic_wordsigns"]'); return { but: c.checked, mixed: g.indeterminate }; });
  ok('keyboard: Space ticks "but" - the group checkbox is mixed', one.but && one.mixed, one);
  await key('Shift+Tab', 2);
  ok('keyboard: Shift+Tab goes back to the group checkbox', (await active()).id === 'rpg-alphabetic_wordsigns', await active());
  page.__answer = false; msgs(dialogs);
  await key('Escape');
  await page.waitForTimeout(300);
  ok('keyboard: Escape with unapplied ticks asks first; no keeps the dialog open', dialogs.length === 1 && await page.evaluate(() => document.getElementById('contractionsDialog').open), dialogs);
  // Done by keyboard
  await page.focus('#rpDone');
  await key('Enter');
  await page.waitForTimeout(700);
  ok('keyboard: Enter on Done applies the ticks and closes; the focus is back on Choose…', await page.evaluate(() => !document.getElementById('contractionsDialog').open) && (await active()).id === 'contractionsBtn' && (await storedSettings(page)).contractions.length === TOTAL - 22, { stored: (await storedSettings(page)).contractions && (await storedSettings(page)).contractions.length });
  // reopen: Cancel by keyboard
  await key('Enter');
  await page.waitForSelector('#contractionsDialog[open]');
  await page.focus('#rpCancel');
  await key('Space');
  await page.waitForTimeout(300);
  ok('keyboard: Space on Cancel closes the dialog and the focus is back on Choose…', await page.evaluate(() => !document.getElementById('contractionsDialog').open) && (await active()).id === 'contractionsBtn');
  ok('keyboard: no page errors', errors.length === 0, errors);
  await page.evaluate(() => { try { window.markDocumentClean(); } catch {} });
  await ctx.close();
} catch (e) { ok('keyboard run completed', false, String(e && e.stack || e)); }

// ---- the help (Paul, 3 Oct 2026): a section on relaxed braille, there only when it is switched on ------------------------------------------
try {
  console.log(`--- the help (${ENGINE_LABEL}) ---`);
  const { ctx, page, errors } = await newPage({ simple: false });
  const helpState = () => page.evaluate(() => { const h = document.getElementById('helpRelaxed'); return h ? { hidden: h.hidden, text: h.textContent.replace(/\s+/g, ' ') } : null; });
  for (const [label, load] of [['editor', editorLoad], ['Quick Mode', quickLoad]]) {
    await load(page, '?relaxed=0');
    const off = await helpState();
    ok(`help, ${label}: with relaxed braille off the section is hidden`, off && off.hidden, off);
    await load(page, '?relaxed=1');
    const on = await helpState();
    ok(`help, ${label}: with it on the section is shown and tells how: Choose…, a group's box and Show, Done, Save as for a learner`, on && !on.hidden && /Choose…/.test(on.text) && /Show/.test(on.text) && /Done/.test(on.text) && /Save as/.test(on.text) && !/Reader profile|New profile/.test(on.text), on);
  }
  await page.goto(`${BASE}/web/index.html?relaxed=0`, { waitUntil: 'load' });
  // WebKit reports a download the page had not finished when it was left (tables, the language file: this step leaves each page after 1.5 s)
  // as "Fetch API cannot load … due to access control checks"; only that is let through here, every other error still fails.
  const realErrors = errors.filter((m) => !/^Fetch API cannot load .* due to access control checks\.$/.test(m));
  ok('help: no page errors', realErrors.length === 0, realErrors);
  await ctx.close();
} catch (e) { ok('help run completed', false, String(e && e.stack || e)); }

// ---- damaged storage -----------------------------------------------------------------------------------------------------------------
try {
  console.log(`--- damaged stored ticks (${ENGINE_LABEL}) ---`);
  const entries = seedEntries({ settings: { simpleMode: false }, templates: [], active: 'BANA' });
  const bad = JSON.parse(entries['emboss-settings']); bad.contractions = 'junk';
  const { ctx, page, errors } = await newPage({ simple: false, extraStorage: { 'emboss-settings': JSON.stringify(bad) } });
  await editorLoad(page, '?relaxed=1');
  await editorDoc(page);
  const r = await waitBrf(page, (f) => f.includes(flat(CONTRACTED)));
  ok('damaged stored ticks: the editor opens with All and full contraction', r.good, r.brf);
  await openSettings(page);
  ok('damaged stored ticks: the line says "Contractions: All"', (await lineState(page)).line === 'Contractions: All');
  ok('damaged stored ticks: no page errors', errors.length === 0, errors);
  await page.evaluate(() => { try { window.markDocumentClean(); } catch {} });
  await ctx.close();
} catch (e) { ok('damaged-storage run completed', false, String(e && e.stack || e)); }

// ---- a second tab ---------------------------------------------------------------------------------------------------------------------
try {
  console.log(`--- two tabs (${ENGINE_LABEL}) ---`);
  const a = await newPage({ simple: false });
  const b = await newPage({ simple: false, ctx: a.ctx });
  await editorLoad(a.page, '?relaxed=1');
  await editorDoc(a.page);
  await editorLoad(b.page, '?relaxed=1');
  await editorDoc(b.page);
  await openChoose(b.page);
  for (const gr of UEB_CONTRACTION_GROUPS) if (gr.id !== 'strong_contractions') await groupBox(b.page, gr.id).uncheck();
  await b.page.click('#rpDone');
  const rb = await waitBrf(b.page, (f) => f.includes(flat(STRONG_ONLY)));
  ok('two tabs: the tab that applied the ticks brailles with them at once', rb.good, rb.brf);
  const ra = await waitBrf(a.page, (f) => f.includes(flat(STRONG_ONLY)));
  ok('two tabs: the other tab (no click, no reload) is brailled again with the new ticks at once (storage event)', ra.good, ra.brf);
  await openSettings(a.page);
  ok('two tabs: ... and its line says how many are ticked', (await lineState(a.page)).line === `Contractions: ${STRONG_KEYS.length} of ${TOTAL}`, await lineState(a.page));
  ok('two tabs: no page errors', a.errors.length === 0 && b.errors.length === 0, [a.errors, b.errors]);
  await a.page.evaluate(() => { try { window.markDocumentClean(); } catch {} });
  await b.page.evaluate(() => { try { window.markDocumentClean(); } catch {} });
  await a.ctx.close();
} catch (e) { ok('two-tab run completed', false, String(e && e.stack || e)); }

// ---- axe: Settings with the line, and the dialog (collapsed, a group open, a mixed box), light and dark --------------------------------------
async function axeScan(page, include) {
  await page.evaluate(() => document.fonts.ready);
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ path: AXE });
  const r = await page.evaluate((inc) => window.axe.run({ include: [inc] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }), include);
  return r.violations.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} — ${(n.any[0]?.message || n.failureSummary || '').slice(0, 140)}`) }));
}
for (const kind of ['editor', 'quick']) {
  for (const scheme of ['light', 'dark']) {
    try {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, colorScheme: scheme, locale: 'en-US' });
      const { page, errors } = await newPage({ simple: kind === 'quick', ctx, templates: [{ name: 'Axe check', contractions: STRONG_KEYS }], active: 'Axe check' });
      if (kind === 'editor') await editorLoad(page, '?relaxed=1'); else await quickLoad(page, '?relaxed=1');
      await openSettings(page);
      let v = await axeScan(page, '#contractionsField');
      ok(`axe WCAG 2 A/AA, ${kind}, ${scheme}: the Contractions line and its button have no violation`, v.length === 0, v);
      v = await axeScan(page, '#tplSettings');
      ok(`axe WCAG 2 A/AA, ${kind}, ${scheme}: Template settings with the line showing has no violation`, v.length === 0, v);
      await page.click('#contractionsBtn');
      await page.waitForSelector('#contractionsDialog[open]');
      await page.waitForTimeout(200);
      v = await axeScan(page, '#contractionsDialog');
      ok(`axe WCAG 2 A/AA, ${kind}, ${scheme}: the dialog with every group collapsed has no violation`, v.length === 0, v);
      await showBtn(page, 'strong_contractions').click();
      await page.getByRole('checkbox', { name: 'sh, dots 1 4 6', exact: true }).uncheck();       // a mixed group box, the not-applied note, a group open
      await groupBox(page, 'shortforms').check();
      v = await axeScan(page, '#contractionsDialog');
      ok(`axe WCAG 2 A/AA, ${kind}, ${scheme}: ... with a group open, a mixed group box and the not-applied note has no violation`, v.length === 0, v);
      await page.click('#rpCancel');
      ok(`axe ${kind} ${scheme}: no page errors`, errors.length === 0, errors);
      await page.evaluate(() => { window.markDocumentClean && window.markDocumentClean(); });
      await ctx.close();
    } catch (e) { ok(`axe ${kind} ${scheme} run completed`, false, String(e && e.stack || e)); }
  }
}

await browser.close();
console.log(`\n=== Contractions dialog [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
