// Playwright check for the transcription-warnings UI (Fable review #5,
// Emboss/docs/fable-review-26sep.md): the "N transcription warnings" indicator near the
// braille pane (editor.mjs's updateWarningsUI/renderWarningsPanel), its list (each item jumps
// to its block, closes the panel, and announces itself), keyboard reachability (Tab, Enter,
// Escape), and the pre-download notice ("Emboss had to skip or change N things — see details").
//
// A block whose formatter genuinely throws (block-skipped) does not reliably survive the
// editor's Lexical round-trip (modelToLexical -> buildModel coerces a malformed `segments`
// field back into a valid shape before it ever reaches the formatter) — that path is instead
// covered thoroughly by Emboss/tests/transcription_warnings.test.mjs, which calls
// formatDocument directly. This browser test drives the three kinds that DO survive the round
// trip and occur naturally through real liblouis + real layout: an untranslatable print
// character, a too-wide table falling back to Listed, and the trace-fallback that the
// untranslatable character's own LOU_UNDEFINED_CHAR_RE safety net produces alongside it.
//
// ICON-1 (Paul, 28 Sep 2026): BANA now gives a print character liblouis has no braille cell for
// its own transcriber-defined print symbol (Special Symbols page, no warning) instead of the old
// full-cell + lou-undefined-char treatment — see Emboss/tests/print_icons.test.mjs. That applies to
// EVERY distinct untranslatable character in BANA mode (up to the 7th; the name table only chooses
// the Special Symbols page WORDING, it does not gate whether a character becomes a symbol), so no
// character stays a genuine "untranslatable" warning in BANA any more — not even one outside the
// name table, and not a Private Use Area character either (tried U+E000 first: that collides with
// Emboss's OWN internal use of the PUA for markup — format/text-style.mjs's SCRIPT_MARKS.subOpen is
// exactly U+E000, format/cell-markup.mjs's own PUA marker is also 0xE000, and input/doc.mjs /
// input/parse.mjs reserve the whole 0xF000-0xF0FF range for Word's Wingdings/Symbol font glyphs —
// text-style.mjs's translateScripts intercepts it before it ever reaches liblouis, so it silently
// became a subscript indicator instead of an undefined-character escape, in EVERY mode). This
// document is loaded in UKAAF mode instead (UK-8: no Special Symbols page there, so the old
// full-cell + lou-undefined-char behaviour is unchanged), which is what actually keeps this test
// exercising a real warning — so ★ (U+2605, used here originally and still by the pre-ICON-1 F-213
// test) is kept as-is; UKAAF is untouched by ICON-1 either way.
//
// Needs the dev server:  node Emboss/scripts/serve.mjs <port> &
//   node Emboss/tests/test-transcription-warnings.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 400) : ''}`); }
};

const WARN_MODEL = {
  title: 'Warnings Demo',
  blocks: [
    { type: 'para', text: 'A star symbol: ★ here.' },
    { type: 'graphic', title: 'diagram', lines: ['*1*', 'zz*'] },
    {
      type: 'table',
      // A chosen layout (columnar) that cannot fit: three columns whose words can't be divided
      // need well over 30 cells. 'auto' or the editor's default 'spatial' falling back is not a warning.
      format: 'columnar',
      headers: ['Qwxzqwxzqwxz', 'Vbnkvbnkvbnk', 'Jhgfjhgfjhgf'],
      rows: [['Pmlkpmlkpmlk', 'Zxcvzxcvzxcv', 'Tyuityuityui']],
    },
  ],
};

const browser = await launchBrowser({ args: ['--no-sandbox'] });

// ==================================================================================
// Editor: indicator, list, jump-to-block, keyboard reachability, export notice
// ==================================================================================
console.log('--- Editor: transcription-warnings UI ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'ukaaf', grade: 'g2', cells: 30, lines: 25, uiLanguage: 'en' })); } catch {}
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 });

  // No warnings yet (the seeded demo document) -> the badge is hidden.
  const badgeHiddenInitially = await page.evaluate(() => document.getElementById('warnBadge')?.hidden === true);
  ok('badge hidden with no warnings', badgeHiddenInitially);

  // Load the warning-triggering document and re-render.
  const { count, warnings, badgeHidden, badgeText, badgeAriaLabel } = await page.evaluate(async (model) => {
    window.modelToLexical(model);
    await window.render();
    const b = document.getElementById('warnBadge');
    return { count: window.lastWarnings.length, warnings: window.lastWarnings, badgeHidden: b.hidden, badgeText: b.textContent, badgeAriaLabel: b.getAttribute('aria-label') };
  }, WARN_MODEL);

  // IMP-W12 (Paul, 30 Sep 2026): the model's "graphic" comes back from the editor as a picture with no description (the editor's
  // picture block keeps no tactile `lines`), so a fourth warning, 'picture-no-description', is expected; it was three before.
  ok('four warnings collected (lou-undefined-char, trace-fallback, picture-no-description, table-fallback)', count === 4, warnings);
  ok('warning kinds are the expected set', JSON.stringify(warnings.map((w) => w.kind).sort()) === JSON.stringify(['lou-undefined-char', 'picture-no-description', 'table-fallback', 'trace-fallback']), warnings.map((w) => w.kind));
  ok('badge is shown once there are warnings', badgeHidden === false);
  // Changed 1 Oct 2026 (feedback 30 Sep item 7, Paul): 'trace-fallback' (the editor could not link a block's cells; braille
  // unchanged) is a diagnostic and is no longer shown — the badge and the list count the other three. Was: 4.
  ok('badge text names the count of warnings shown (3: trace-fallback is not shown)', badgeText.includes('3') && !badgeText.includes('4'), badgeText);
  ok('badge carries an aria-label (screen-reader announced on its own)', !!badgeAriaLabel && badgeAriaLabel.includes('3'), badgeAriaLabel);

  // The indicator is keyboard-reachable and opens the list with Enter (via a real click on the
  // focused element, matching native <button> activation); the panel then closes on Escape and
  // returns focus to the badge.
  const kb = await page.evaluate(async () => {
    const badge = document.getElementById('warnBadge');
    badge.focus();
    const focusedIsBadge = document.activeElement === badge;
    badge.click();
    await new Promise((r) => setTimeout(r, 80));
    const openedHidden = document.getElementById('warnPanel').hidden;
    const ariaExpanded = badge.getAttribute('aria-expanded');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
    const closedHidden = document.getElementById('warnPanel').hidden;
    const focusReturnedToBadge = document.activeElement === badge;
    return { focusedIsBadge, openedHidden, ariaExpanded, closedHidden, focusReturnedToBadge };
  });
  ok('badge is a focusable, keyboard-reachable control', kb.focusedIsBadge);
  ok('activating the badge opens the warnings panel', kb.openedHidden === false);
  ok('aria-expanded reflects the open panel', kb.ariaExpanded === 'true');
  ok('Escape closes the panel', kb.closedHidden === true);
  ok('Escape returns focus to the badge', kb.focusReturnedToBadge);

  // The list: one item per warning, each with a readable label and an aria-label a screen
  // reader would announce; each item's kind label uses the localized en.json string, not the
  // raw internal kind identifier.
  const list = await page.evaluate(() => {
    document.getElementById('warnBadge').click();
    const items = Array.from(document.querySelectorAll('#warnPanelList .warn-item'));
    return items.map((b) => ({ text: b.textContent, aria: b.getAttribute('aria-label'), hasKind: !!b.querySelector('.warn-item-kind'), hasMsg: !!b.querySelector('.warn-item-msg') }));
  });
  ok('the list has one item per warning shown (3; trace-fallback is not shown, 1 Oct 2026)', list.length === 3, list);
  ok('every item has a kind label and a message', list.every((i) => i.hasKind && i.hasMsg));
  ok('every item has a non-empty aria-label', list.every((i) => i.aria && i.aria.length > 5));
  ok('no item leaks the raw internal kind string (e.g. "table-fallback") as its visible label', !list.some((i) => /table-fallback|lou-undefined-char|trace-fallback|picture-no-description/.test(i.text)), list.map((i) => i.text));

  // Jump-to-block: clicking the table-fallback item closes the panel, focuses the table's print
  // block (data-block-idx="2" — the model's third block), and announces the jump.
  const jump = await page.evaluate(async () => {
    const items = Array.from(document.querySelectorAll('#warnPanelList .warn-item'));
    const tableItem = items.find((b) => b.querySelector('.warn-item-kind')?.textContent.includes('Table'));
    tableItem.click();
    await new Promise((r) => setTimeout(r, 150));
    return {
      panelClosedAfterJump: document.getElementById('warnPanel').hidden,
      activeBlockIdx: document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-block-idx'),
      announce: document.getElementById('announce')?.textContent || '',
    };
  });
  ok('clicking a warning closes the panel', jump.panelClosedAfterJump === true);
  ok('clicking a warning focuses its block in the print pane (data-block-idx="2")', jump.activeBlockIdx === '2', jump.activeBlockIdx);
  ok('the jump is announced to screen readers', /Warning \d+ of \d+/.test(jump.announce), jump.announce);

  // Export notice: triggering a BRF download shows "Emboss had to skip or change N things —
  // see details" before/alongside the download, and "View details" reopens the same panel.
  const exportNotice = await page.evaluate(async () => {
    document.getElementById('downloadBrfItem').click();
    await new Promise((r) => setTimeout(r, 150));
    const noticeHidden = document.getElementById('exportWarnNotice').hidden;   // snapshot BEFORE "View details" hides it again
    const text = document.getElementById('exportWarnNoticeText').textContent;
    document.getElementById('exportWarnNoticeView').click();
    await new Promise((r) => setTimeout(r, 80));
    const panelHiddenAfterView = document.getElementById('warnPanel').hidden;
    return { noticeHidden, text, panelHiddenAfterView };
  });
  ok('a BRF download shows the pre-download notice', exportNotice.noticeHidden === false);
  ok('the notice names the count of warnings shown (3; trace-fallback is not shown, 1 Oct 2026)', /\b3\b/.test(exportNotice.text), exportNotice.text);
  ok('"View details" opens the same warnings panel', exportNotice.panelHiddenAfterView === false);

  // Clearing the document (no warnings) hides the badge again.
  const cleared = await page.evaluate(async () => {
    window.modelToLexical({ title: 'Clean', blocks: [{ type: 'para', text: 'All good here.' }] });
    await window.render();
    return { count: window.lastWarnings.length, badgeHidden: document.getElementById('warnBadge').hidden };
  });
  ok('an ordinary document clears the indicator', cleared.count === 0 && cleared.badgeHidden === true, cleared);

  ok('no uncaught page errors during any of this', pageErrors.length === 0, pageErrors);
  await ctx.close();
}

// ==================================================================================
// Quick Mode: the export notice on a BRF download (no persistent editor document to
// jump within, per the task brief — only the pre-download notice applies here).
// ==================================================================================
console.log('--- Quick Mode: export notice ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: true, mode: 'ukaaf', grade: 'g2', cells: 30, lines: 25, uiLanguage: 'en' })); } catch {}
  });
  const page = await ctx.newPage();
  const qErrors = [];
  page.on('pageerror', (e) => qErrors.push(e.message));
  await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('engineVer')?.textContent, null, { timeout: 60000 });

  // A NIMAS/DTBook document with a print character liblouis has no cell for (★; this context's
  // localStorage above is UKAAF, same reason as the editor section — see this file's header
  // comment), loaded through the real import + transcribe path (setInputFiles, like
  // test-doc-import-browser.mjs), so this exercises the same code a real file drives. Quick Mode
  // has no window.* test hooks (unlike the editor), so this checks the DOM directly — the same way
  // that existing test does.
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1><h1>Warnings Demo</h1><p>A star symbol: ★ here.</p></level1></bodymatter></book>
</dtbook>`;
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'emboss-warn-'));
  const xmlPath = path.join(tmpDir, 'warn-demo.xml');
  writeFileSync(xmlPath, XML, 'utf-8');

  await page.setInputFiles('#fileInput', xmlPath);
  await page.waitForFunction(() => (document.getElementById('preview')?.textContent || '').length > 20, null, { timeout: 60000 }).catch(() => {});
  const badge = await page.evaluate(() => {
    const b = document.getElementById('quickWarnBadge');
    return { hidden: b ? b.hidden : null, text: b ? b.textContent : null };
  });
  ok('Quick Mode shows its own transcription-warnings badge for the same real character', badge.hidden === false && /\d/.test(badge.text || ''), badge);

  const exportState = await page.evaluate(async () => {
    document.getElementById('downloadBrfItem')?.click();
    await new Promise((r) => setTimeout(r, 200));
    const notice = document.getElementById('exportWarnNotice');
    return { noticeHidden: notice ? notice.hidden : null, noticeText: document.getElementById('exportWarnNoticeText')?.textContent || '' };
  });
  ok('Quick Mode shows the pre-download notice too', exportState.noticeHidden === false, exportState);
  ok('the notice text is non-empty and mentions a count', /\d/.test(exportState.noticeText), exportState.noticeText);
  ok('no uncaught page errors in Quick Mode either', qErrors.length === 0, qErrors);

  // IMP-W12 (Paul, 30 Sep 2026): a picture with no description is reported in Quick Mode too.
  const XML_PIC = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1><h1>Picture Demo</h1><p>Plain text only.</p><img src="a.png" alt=""/></level1></bodymatter></book>
</dtbook>`;
  const picPath = path.join(tmpDir, 'pic-demo.xml');
  writeFileSync(picPath, XML_PIC, 'utf-8');
  const cleanPath = path.join(tmpDir, 'clean-demo.xml');
  writeFileSync(cleanPath, XML_PIC.replace('<img src="a.png" alt=""/>', '<img src="a.png" alt="A red triangle"/>'), 'utf-8');
  await page.setInputFiles('#fileInput', cleanPath);   // the same picture WITH a description: no warning, so the badge below is this picture's
  await page.waitForTimeout(1500);
  const cleanBadge = await page.evaluate(() => { const b = document.getElementById('quickWarnBadge'); return { hidden: b ? b.hidden : null, text: b ? b.textContent : null }; });
  ok('Quick Mode: a picture WITH a description raises no warning', cleanBadge.hidden === true, cleanBadge);
  await page.setInputFiles('#fileInput', picPath);
  await page.waitForFunction(() => (document.getElementById('preview')?.textContent || '').includes('PICTURE') || (document.getElementById('preview')?.textContent || '').length > 20, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  const picBadge = await page.evaluate(() => {
    const b = document.getElementById('quickWarnBadge');
    return { hidden: b ? b.hidden : null, text: b ? b.textContent : null };
  });
  ok('Quick Mode reports a picture with no description (one warning)', picBadge.hidden === false && /\b1\b/.test(picBadge.text || ''), picBadge);

  await ctx.close();
}

await browser.close();

console.log('');
console.log(`=== Transcription warnings [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) {
  console.error('FAILED:', failures.join(', '));
  process.exit(1);
}
