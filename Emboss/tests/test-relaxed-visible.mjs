// Relaxed braille, Stage 3 (A91; Paul 3 Oct 2026, decisions F and I): making the template in use visible, in a real browser.
// Written before the feature existed: it failed (no label, no spelled-out note in the status bar).
//
// PAUL, 2 NOV 2026: "relaxed braille is part of the template (one name)". The old decisions F and I are now by TEMPLATE, and this file was changed for that
// reason only (its stories are the same; the profile manager they drove is gone):
// F  Quick Mode's header (where the page size is shown) and the editor's braille pane say "Template: <name>" - ONLY when relaxed braille is switched on
//    (?relaxed=1), the braille code is UEB contracted, and the template in use relaxes something (its ticks are not All). The name is the picker's name,
//    "(modified)" included. It follows at once: a template chosen in the picker, a change of ticks made with Choose contractions > Done, a change made in
//    another tab (storage event), the braille code. Quick Mode's header items are plain text, so it is plain text there; the editor's pane header holds
//    buttons, so it is a button that opens the Choose contractions dialog. No live region (a screen reader finds it in the normal reading order).
// I  The editor's status bar says which contractions of the word under the cursor the template spelled out ("ea spelled out. Not in template: Sam –
//    Dot-to-Dot 6."), as text and in the spoken description (Ctrl+Shift+D). With nothing spelled out, with All, or with relaxed braille off, the
//    explanation is EXACTLY what it was. "contracted" stays true: a word with every contraction spelled out is "spelt out, no contraction". The bar keeps
//    its two-line cap. Wording (Paul's answers Q1, Q2, 3 Oct 2026, by template since 2 Nov): "Not in template: Sam." and, when the whole word is one sign
//    (the, child, children), just "Spelled out. Not in template: Sam."
//
// Runs in Chrome by default; EMBOSS_ENGINE=webkit|firefox for another (tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8178 &   then   node Emboss/tests/test-relaxed-visible.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { seedEntries } from './lib/relaxed-seed.mjs';
import { UEB_CONTRACTION_SIGNS } from '../format/relaxed-signs.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 900) : ''}`); }
};

const SAM = 'Sam – Dot-to-Dot 6';
const STRONG = UEB_CONTRACTION_SIGNS.filter((x) => x.group === 'strong_contractions' || x.group === 'strong_wordsigns').map((x) => x.key);
const TEMPLATES = [{ name: SAM, contractions: STRONG }, { name: 'Empty', contractions: [] }];
// what localStorage holds when a given template is the one in use (its ticks are in force)
const entriesFor = (simple, active) => seedEntries({ settings: { simpleMode: simple }, templates: TEMPLATES, active });
const DOC = 'Garden\n\nThe teacher said that children should go.\n';

const browser = await launchBrowser();
// A fresh browser profile; the templates are put in localStorage (once per tab session) the way the app stores them.
const newPage = async ({ simple, active = SAM, ctx: given = null }) => {
  const ctx = given || await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'en-US' });
  await ctx.addInitScript(([entries]) => {
    try {
      if (!sessionStorage.getItem('rv-seeded')) {
        sessionStorage.setItem('rv-seeded', '1');
        for (const [k, v] of Object.entries(entries)) if (!localStorage.getItem(k)) localStorage.setItem(k, v);
      }
    } catch {}
  }, [entriesFor(simple, active)]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.__answer = true;
  page.on('dialog', async (d) => { if (page.__answer) await d.accept(); else await d.dismiss(); });
  return { ctx, page, errors };
};
// put another template in use from outside the page (what another tab's Settings would have stored)
const useTemplate = (page, simple, active) => page.evaluate((entries) => { for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v); }, entriesFor(simple, active));
const editorLoad = async (page, query = '', doc = true) => {
  if (page.url() !== 'about:blank') await page.evaluate(() => { try { window.markDocumentClean && window.markDocumentClean(); } catch {} }).catch(() => {});
  await page.goto(`${BASE}/web/editor/index.html${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.markDocumentClean === 'function', null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  if (!doc) return;
  await page.evaluate(async (text) => { window.markDocumentClean(); await window.importFile(new File([text], 'w.txt', { type: 'text/plain' })); }, DOC);
  await page.waitForFunction(() => /SAID|SD/.test(window.lastBrf || ''), null, { timeout: 30000 });
  await page.waitForTimeout(800);
};
const quickLoad = async (page, query = '') => {
  await page.goto(`${BASE}/web/index.html${query}`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
};
// the label: null if the page has none
const labelState = (page) => page.evaluate(() => {
  const l = document.getElementById('contractionsLabel');
  if (!l) return null;
  return { hidden: l.hidden || l.getClientRects().length === 0, text: l.textContent.trim(), tag: l.tagName };
});
const shown = (s, text) => !!s && !s.hidden && s.text === text;
const gone = (s) => !!s && s.hidden;
// Settings opens on the Template tab; the Contractions line is in the "Template settings" disclosure (closed at first, X1), directly under Braille code
const openSettings = async (page) => {
  await page.click('#settingsBtn'); await page.waitForSelector('#settingsDialog[open]');
  if (!(await page.evaluate(() => document.getElementById('tplSettings').open))) await page.click('#tplSettings > summary');
};
const openChoose = async (page) => { await openSettings(page); await page.click('#contractionsBtn'); await page.waitForSelector('#contractionsDialog[open]'); await page.waitForTimeout(150); };
const pickTemplate = async (page, label) => { await page.selectOption('#tplSelect', { label }); await page.waitForTimeout(500); };

// ---- both pages: the same story about the label ------------------------------------------------------------------------------------
async function labelStory(kind) {
  const isEditor = kind === 'editor';
  const name = isEditor ? 'editor' : 'Quick Mode';
  const load = isEditor ? (p, q) => editorLoad(p, q, false) : quickLoad;
  const codeSel = '#set-language'   // both pages: one shared Settings dialog since 17 Oct (item 9a);
  console.log(`--- the label: ${name} (${ENGINE_LABEL}) ---`);
  const { ctx, page, errors } = await newPage({ simple: !isEditor });
  try {
    await load(page, '?relaxed=0');
    let s = await labelState(page);
    ok(`${name}: relaxed braille switched off - no label (even with a template that relaxes contractions in use)`, gone(s), s);

    await load(page, '?relaxed=1');
    s = await labelState(page);
    ok(`${name}: ?relaxed=1 with the template "${SAM}" in use - the label says "Template: ${SAM}"`, shown(s, `Template: ${SAM}`), s);
    const where = await page.evaluate((editor) => {
      const l = document.getElementById('contractionsLabel');
      if (editor) {
        const b = document.getElementById('braille');
        return { inPaneHead: !!l.closest('#brailleLabel'), aboveBraille: !!(l.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING), samePane: l.closest('.pane-braille') === b.closest('.pane-braille') };
      }
      const size = document.getElementById('settingsSummary');
      return { inHeader: !!l.closest('header'), besideSize: l.parentElement === size.parentElement, afterSize: !!(size.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING) };
    }, isEditor);
    ok(`${name}: ${isEditor ? 'it is in the braille pane\'s heading, above the braille' : 'it is in the header, beside the page size'}`, isEditor ? where.inPaneHead && where.aboveBraille && where.samePane : where.inHeader && where.besideSize && where.afterSize, where);
    const sr = await page.evaluate(() => {
      const l = document.getElementById('contractionsLabel');
      const live = (e) => e.closest('[aria-live],[role=status],[role=alert],[role=log]');
      return { live: !!live(l), ariaHidden: !!l.closest('[aria-hidden=true]'), inert: !!l.closest('[inert]') };
    });
    ok(`${name}: it is in the normal reading order and not a live region (not announced on every render)`, !sr.live && !sr.ariaHidden && !sr.inert, sr);
    if (isEditor) {
      ok('editor: the label is a button (the pane heading holds buttons) ...', s.tag === 'BUTTON', s);
      await page.click('#contractionsLabel');
      await page.waitForSelector('#contractionsDialog[open]');
      const ticked = await page.evaluate(() => document.getElementById('rpCount').textContent);
      ok('editor: ... and it opens the Choose contractions dialog, on the ticks in force', new RegExp(`^${STRONG.length} of ${UEB_CONTRACTION_SIGNS.length} contractions ticked`).test(ticked), ticked);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      ok('editor: Escape closes it and the focus goes back to the label', await page.evaluate(() => document.activeElement && document.activeElement.id) === 'contractionsLabel');
    } else {
      ok('Quick Mode: the header items are plain text, so the label is plain text', s.tag === 'SPAN', s);
    }

    // the braille code: grade 1 and other codes have no contractions to choose
    await openSettings(page);
    await page.selectOption(codeSel, 'en-ueb-g1');
    await page.waitForTimeout(500);
    s = await labelState(page);
    ok(`${name}: UEB grade 1 selected - the label goes at once`, gone(s), s);
    await page.selectOption(codeSel, 'en-ueb-g2');
    await page.waitForTimeout(700);
    s = await labelState(page);
    ok(`${name}: UEB contracted again - the label is back`, shown(s, `Template: ${SAM}`), s);

    // the template picker: every change shows at once, with Settings still open
    await pickTemplate(page, 'BANA');
    s = await labelState(page);
    ok(`${name}: choosing the built-in BANA (all contractions) - the label goes (All is normal braille)`, gone(s), s);
    await pickTemplate(page, 'Empty');
    s = await labelState(page);
    ok(`${name}: choosing another template that relaxes - the label names it at once`, shown(s, 'Template: Empty'), s);
    await pickTemplate(page, SAM);
    s = await labelState(page);
    ok(`${name}: choosing ${SAM} again - the label names it`, shown(s, `Template: ${SAM}`), s);
    // a change of ticks in the dialog: Done makes the template "(modified)" and the label says so
    await page.click('#contractionsBtn');
    await page.waitForSelector('#contractionsDialog[open]');
    await page.locator('#contractionsDialog input[data-group="shortforms"]').check();
    await page.click('#rpDone');
    await page.waitForTimeout(500);
    s = await labelState(page);
    ok(`${name}: Choose contractions > Done with a changed tick - the label says "(modified)"`, shown(s, `Template: ${SAM} (modified)`), s);
    // Save as… keeps them under a new name (the template's own button), and the label names it
    await page.click('#tplSaveAs');
    await page.fill('#tplAskName', 'Lee');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    s = await labelState(page);
    ok(`${name}: the template's Save as… with the new ticks - the label names the new template, no longer modified`, shown(s, 'Template: Lee'), s);
    // Delete the template in use: back to the built-in of its standard, which relaxes nothing - the label is gone
    await page.click('#tplDelete');
    await page.click('#tplAskOk');
    await page.waitForTimeout(500);
    s = await labelState(page);
    ok(`${name}: deleting the template in use goes back to the built-in (all contractions) - the label is gone`, gone(s), s);
    await page.evaluate(() => document.getElementById('settingsDialog').close());
    await page.waitForTimeout(250);
    s = await labelState(page);
    ok(`${name}: ... and it stays gone when Settings is closed`, gone(s), s);
    ok(`${name}: no page errors`, errors.length === 0, errors);
  } catch (e) { ok(`${name} label run completed`, false, String(e && e.stack || e)); }
  await ctx.close();
}
await labelStory('quick');
await labelStory('editor');

// ---- All in use, and a second tab ----------------------------------------------------------------------------------------------------
try {
  console.log(`--- the label: All, and a second tab (${ENGINE_LABEL}) ---`);
  const { ctx, page, errors } = await newPage({ simple: true, active: 'BANA' });
  await quickLoad(page, '?relaxed=1');
  let s = await labelState(page);
  ok('Quick Mode: ?relaxed=1 with a template that holds All - no label', gone(s), s);
  const other = await newPage({ simple: false, active: 'BANA', ctx });
  await page.evaluate((e) => localStorage.setItem('emboss-settings', e['emboss-settings']), entriesFor(false, 'BANA'));   // the editor tab must not go to Quick Mode
  await editorLoad(other.page, '?relaxed=1', false);
  s = await labelState(other.page);
  ok('editor: ?relaxed=1 with a template that holds All - no label', gone(s), s);
  await useTemplate(other.page, false, SAM);
  await page.waitForTimeout(500);
  s = await labelState(page);
  ok('two tabs: another tab puts a template that relaxes in use - Quick Mode\'s label appears at once (storage event)', shown(s, `Template: ${SAM}`), s);
  await useTemplate(other.page, false, 'BANA');
  await page.waitForTimeout(500);
  s = await labelState(page);
  ok('two tabs: ... and goes again when the other tab goes back to BANA', gone(s), s);
  await useTemplate(page, true, SAM);
  await other.page.waitForTimeout(500);
  s = await labelState(other.page);
  ok('two tabs: the editor\'s label follows Quick Mode too', shown(s, `Template: ${SAM}`), s);
  ok('two tabs: no page errors', errors.length === 0 && other.errors.length === 0, [errors, other.errors]);
  await other.page.evaluate(() => { try { window.markDocumentClean(); } catch {} });
  await ctx.close();
} catch (e) { ok('All / two-tab run completed', false, String(e && e.stack || e)); }

// ---- the status bar (the editor) ---------------------------------------------------------------------------------------------------
async function explain(page, word) {
  return page.evaluate((w) => {
    window.showRuleInfo(w);
    const b = document.getElementById('ruleInfoBody');
    const sb = document.getElementById('statusBar');
    const em = parseFloat(getComputedStyle(sb).fontSize);
    return { text: b.innerText.replace(/\s+/g, ' ').trim(), html: b.innerHTML, h: sb.clientHeight, scrollH: sb.scrollHeight, em };
  }, word);
}
try {
  console.log(`--- the status bar (${ENGINE_LABEL}) ---`);
  const { ctx, page, errors } = await newPage({ simple: false });
  // today's explanations: relaxed braille off
  await editorLoad(page, '?relaxed=0');
  const off = { teacher: await explain(page, 'teacher'), the: await explain(page, 'the'), garden: await explain(page, 'garden') };
  ok('relaxed off: the explanation of "teacher" is the usual one (contracted, no spelled-out note)', /contracted/.test(off.teacher.text) && !/spelled out/.test(off.teacher.text), off.teacher.text);
  // All, switch on: the same, byte for byte
  await useTemplate(page, false, 'BANA');
  await editorLoad(page, '?relaxed=1');
  const all = { teacher: await explain(page, 'teacher'), the: await explain(page, 'the'), garden: await explain(page, 'garden') };
  ok('All in use: the explanations are exactly what they were with the switch off (teacher, the, garden)', ['teacher', 'the', 'garden'].every((w) => all[w].html === off[w].html), { off: off.teacher.html, all: all.teacher.html });
  // the strong-contractions-only template
  await useTemplate(page, false, SAM);
  await editorLoad(page, '?relaxed=1');
  const strong = { teacher: await explain(page, 'teacher'), the: await explain(page, 'the'), garden: await explain(page, 'garden') };
  const NOTE = (signs) => `${signs} spelled out. Not in template: ${SAM}.`;   // Q1 (Paul, 3 Oct 2026), by template (Paul, 2 Nov 2026)
  ok(`strong-only template: "teacher" says "${NOTE('ea')}"`, strong.teacher.text.includes(NOTE('ea')), strong.teacher.text);
  ok('strong-only template: "teacher" is still "contracted" (ch and er are kept)', /contracted/.test(strong.teacher.text) && !/spelt out, no contraction/.test(strong.teacher.text), strong.teacher.text);
  ok('strong-only template: "garden" names its one spelled-out sign ("en")', strong.garden.text.includes(NOTE('en')), strong.garden.text);
  ok('strong-only template: "the" (kept) has no note and the same explanation as with the switch off', !/spelled out/.test(strong.the.text) && strong.the.html === off.the.html, strong.the.text);
  ok('the note is in the bar\'s two-line cap (≤ 6.8 em + border) and does not scroll', strong.teacher.h <= Math.ceil(6.8 * strong.teacher.em) + 2 && strong.teacher.scrollH <= strong.teacher.h + 1, { h: strong.teacher.h, scrollH: strong.teacher.scrollH, em: strong.teacher.em });
  // the template with nothing ticked: everything spelled out
  await useTemplate(page, false, 'Empty');
  await editorLoad(page, '?relaxed=1');
  const none = { teacher: await explain(page, 'teacher'), garden: await explain(page, 'garden'), cap: await explain(page, 'Teacher,') };
  const NOTE_E = (signs) => `${signs} spelled out. Not in template: Empty.`;
  ok(`empty template: "teacher" says "${NOTE_E('ea, ch and er')}"`, none.teacher.text.includes(NOTE_E('ea, ch and er')), none.teacher.text);
  ok('empty template: every contraction spelled out, so "teacher" is NOT called contracted ("spelt out, no contraction")', /spelt out, no contraction/.test(none.teacher.text) && !/contracted/.test(none.teacher.text), none.teacher.text);
  ok('empty template: "garden" says "ar and en spelled out"', none.garden.text.includes(NOTE_E('ar and en')), none.garden.text);
  ok('empty template: a capital and a comma do not matter ("Teacher,")', none.cap.text.includes(NOTE_E('ea, ch and er')), none.cap.text);
  // Q2 (Paul, 3 Oct 2026): the whole word is one sign -> the word is not repeated
  const whole = { the: await explain(page, 'the'), child: await explain(page, 'child'), comma: await explain(page, 'children,') };
  const WHOLE_E = 'Spelled out. Not in template: Empty.';
  ok('empty template: "the" (the whole word is one sign) says "Spelled out. Not in template: Empty." and does not repeat the word', whole.the.text.includes(WHOLE_E) && !/the spelled out/.test(whole.the.text), whole.the.text);
  ok('empty template: "child" and "children," likewise', whole.child.text.includes(WHOLE_E) && whole.comma.text.includes(WHOLE_E) && !/child(ren)? spelled out/.test(whole.child.text + whole.comma.text), [whole.child.text, whole.comma.text]);
  ok('empty template: three signs still fit the two-line cap', none.teacher.h <= Math.ceil(6.8 * none.teacher.em) + 2 && none.teacher.scrollH <= none.teacher.h + 1, { h: none.teacher.h, scrollH: none.teacher.scrollH, em: none.teacher.em });
  // grade 1: no contraction, no note, whatever the ticks
  await openSettings(page);
  await page.selectOption('#set-language', 'en-ueb-g1');
  await page.waitForTimeout(700);
  await page.evaluate(() => document.getElementById('settingsDialog').close());
  const g1 = await explain(page, 'teacher');
  ok('UEB grade 1 with a template that relaxes in use: no spelled-out note', !/spelled out/.test(g1.text), g1.text);
  await openSettings(page);
  await page.selectOption('#set-language', 'en-ueb-g2');
  await page.waitForTimeout(700);
  await page.evaluate(() => document.getElementById('settingsDialog').close());

  // a real click on a word in the braille, then the spoken description (Ctrl+Shift+D) - the visible and the spoken text agree
  await useTemplate(page, false, 'Empty');
  await editorLoad(page, '?relaxed=1');
  await page.locator('#braille .brl-row[data-block="1"]').first().hover();
  await page.waitForTimeout(300);
  await page.locator('#braille .brl-row[data-block="1"] .bcell[data-char="4"]').first().click();
  await page.waitForTimeout(500);
  const clicked = await page.evaluate(() => document.getElementById('ruleInfoBody').innerText.replace(/\s+/g, ' '));
  ok('a click on "teacher" in the braille shows the note', clicked.includes(NOTE_E('ea, ch and er')), clicked);
  await page.evaluate(() => {
    const ed = document.getElementById('editor');
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
    let n, hit = null;
    while ((n = w.nextNode())) if (n.nodeValue.includes('teacher')) { hit = n; break; }
    ed.focus();
    const r = document.createRange(); r.setStart(hit, hit.nodeValue.indexOf('teacher') + 3); r.collapse(true);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  await page.keyboard.press('Control+Shift+D');
  await page.waitForTimeout(400);
  const spoken = await page.evaluate(() => document.getElementById('announce').textContent);
  ok('Ctrl+Shift+D speaks the note too', spoken.startsWith('teacher:') && spoken.includes(NOTE_E('ea, ch and er')), spoken);
  ok('... and the spoken text still says what the cells are ("spelt out in 7 cells")', /spelt out in 7 cells/.test(spoken), spoken);
  ok('no page errors', errors.length === 0, errors);
  await page.evaluate(() => { try { window.markDocumentClean(); } catch {} });
  await ctx.close();
} catch (e) { ok('status bar run completed', false, String(e && e.stack || e)); }

await browser.close();
console.log(`\n=== Relaxed braille made visible [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
