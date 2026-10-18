// Paul, 7 Oct 2026: in Settings, Paragraph Style and Quotation Marks are transcriber settings — shown only with Transcriber tools on
// (the editor's switch; the setting is shared, so Quick Mode follows it). A beta build keeps Transcriber tools off, so they are hidden
// there too unless ?tools=1 unlocks it. The braille code, the layout standard and the maths code stay for everyone. The editor's help
// mentions the two only with Transcriber tools on. The Title field above the text follows Transcriber tools too, unless its own setting
// (Settings > User Interface) is ticked or unticked.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-transcriber-settings.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const browser = await launchBrowser();
const open = async (beta, settings) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(({ beta, settings }) => { if (beta) window.EMBOSS_BETA = true; try { if (!sessionStorage.getItem('ts')) { sessionStorage.setItem('ts', '1'); localStorage.setItem('emboss-settings', JSON.stringify(settings)); } } catch {} }, { beta, settings });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page, errors };
};
// is each Settings field shown (in the closed dialog: its own computed display)
const shown = (page, ids) => page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
  const f = document.getElementById(id)?.closest('.field');
  return [id, !!f && getComputedStyle(f).display !== 'none'];
})), ids);
const helpMentions = (page) => page.evaluate(() => [...document.querySelectorAll('#helpDialog .fmt-transcriber')]
  .some((n) => /paragraph format/.test(n.textContent) && getComputedStyle(n).display !== 'none'));
const PAGES = [
  { label: 'editor', url: '/web/editor/index.html', simpleMode: false, transcriber: ['set-paragraphStyle', 'set-quoteStyle'], everyone: ['set-language', 'set-mode', 'set-mathCode'] },
  // Changed 17 Oct 2026 (Paul, feedback item 9a): Quick Mode's Settings are the editor's, one shared markup (web/settings-panes.mjs), so its controls carry the
  // editor's ids (set-paragraphStyle ...); they were paragraphStyle, quoteStyle, language and mode.
  { label: 'Quick Mode', url: '/web/index.html', simpleMode: true, transcriber: ['set-paragraphStyle', 'set-quoteStyle'], everyone: ['set-language', 'set-mode', 'set-mathCode'] },
];
const base = { mode: 'bana', grade: 'g2', uiLanguage: 'en' };

try {
  for (const p of PAGES) {
    for (const [what, tt, beta] of [['Transcriber tools off', false, false], ['Transcriber tools on', true, false], ['a beta build, Transcriber tools saved on', true, true]]) {
      console.log(`--- ${p.label}: ${what} (${ENGINE_LABEL}) ---`);
      const { ctx, page, errors } = await open(beta, { ...base, simpleMode: p.simpleMode, transcriberTools: tt });
      await page.goto(BASE + p.url, { waitUntil: 'load' });
      await page.waitForTimeout(1800);
      const want = tt && !beta;
      const t = await shown(page, p.transcriber);
      ok(`${p.label}, ${what}: Paragraph Style and Quotation Marks are ${want ? 'shown' : 'hidden'}`, Object.values(t).every((v) => v === want), t);
      const e = await shown(page, p.everyone);
      ok(`${p.label}, ${what}: the braille code, layout standard${p.label === 'editor' ? ' and maths code' : ''} are shown`, Object.values(e).every(Boolean), e);
      if (p.label === 'editor') ok(`editor, ${what}: the help mentions the paragraph format only with Transcriber tools on`, (await helpMentions(page)) === want);
      ok(`${p.label}, ${what}: no page errors`, errors.length === 0, errors);
      await ctx.close();
    }
  }
  // The Title field above the text (Paul, 7 Oct 2026): hidden unless Transcriber tools is on, or "Show the Title field above the
  // text" (Settings > User Interface) is ticked; unticking hides it even for a transcriber. Hidden, no title is added to the braille (F9 E2a, Paul 9 Oct 2026).
  const titleShown = (page) => page.evaluate(() => { const r = document.getElementById('docTitleRow'); return !!r && !r.hidden && getComputedStyle(r).display !== 'none'; });
  const boxTicked = (page) => page.evaluate(() => document.getElementById('set-showTitleField').checked);
  for (const [what, extra, beta, want] of [
    ['Transcriber tools off', {}, false, false],
    ['Transcriber tools on', { transcriberTools: true }, false, true],
    ['Transcriber tools off, the setting ticked', { showTitleField: true }, false, true],
    ['Transcriber tools on, the setting unticked', { transcriberTools: true, showTitleField: false }, false, false],
    ['a beta build', { transcriberTools: true }, true, false],
  ]) {
    console.log(`--- the Title field: ${what} (${ENGINE_LABEL}) ---`);
    const { ctx, page, errors } = await open(beta, { ...base, simpleMode: false, ...extra });
    await page.goto(BASE + '/web/editor/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1800);
    ok(`Title field, ${what}: ${want ? 'shown' : 'hidden'}, and the setting's box says so`, (await titleShown(page)) === want && (await boxTicked(page)) === want, { shown: await titleShown(page), ticked: await boxTicked(page) });
    if (what === 'Transcriber tools off') {
      await page.click('#settingsBtn');
      await page.click('#settingsDialog .tab-btn[data-tab="tab-display"]');
      await page.check('#set-showTitleField');
      ok('Title field: ticking "Show the Title field above the text" shows it at once, and it is remembered', (await titleShown(page)) && await page.evaluate(() => JSON.parse(localStorage.getItem('emboss-settings')).showTitleField === true));
      // Settings closes and the page brailles again: with the field shown the title ("Chapter One" in the demonstration document) is added
      // to the braille (page 1, running heads); count its braille ",*APT]" there.
      const closeSettings = async () => { await page.click('#settingsDialog button:has-text("Done")'); await page.waitForTimeout(2500); };
      const countChapter = () => page.evaluate(() => ((window.lastBrf || '').match(/,\*APT\]/g) || []).length);
      await closeSettings();
      const withTitle = await countChapter();
      await page.click('#settingsBtn');
      await page.click('#settingsDialog .tab-btn[data-tab="tab-display"]');
      await page.uncheck('#set-showTitleField');
      ok('Title field: unticking hides it again', !(await titleShown(page)));
      await closeSettings();
      const withoutTitle = await countChapter();
      // F9 E2a (PAUL'S DECISION, 9 Oct 2026): this used to say "hidden, the title is still brailled". Now, with the field hidden, no title is
      // added to the braille; the document's own text (its "Chapter One" heading) is still there, so the count drops but does not vanish.
      ok('Title field: hidden, no title is added to the braille (only the text\'s own "Chapter One" heading is left; E2a)', withTitle > 0 && withoutTitle > 0 && withoutTitle < withTitle, { withTitle, withoutTitle });
    }
    ok(`Title field, ${what}: no page errors`, errors.length === 0, errors);
    await ctx.close();
  }
} catch (e) { ok('run completed', false, String(e && e.stack || e)); }

await browser.close();
console.log(`\n=== Transcriber settings [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
