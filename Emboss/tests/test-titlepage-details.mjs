// K29 Stage 1a: the "Book details…" dialog (design docs/transcriber-pages-customisation-design.md §4).
// Checks: it opens; labels and legends are present; it is hidden when Transcriber tools are off; values
// typed into it are saved into the document and survive a save/reload; the dc:Source -> ISBN and
// country -> reproduction-notice pre-fills work.
//
// "Save/reload" here follows the pattern already used by test-editor-save-fidelity.mjs and
// test-autosave.mjs in this suite: window.markDocumentClean() then window.importFile(new File([xml], …))
// with the document's own exported XML — a real save (export) followed by a real reload (import) of the
// same bytes, inside one page, rather than a full navigation reload (which a `.transcriberTools` change
// would also survive, since it is a document field, not something reload alone would prove).
//
// Needs the dev server:  node Emboss/scripts/serve.mjs <port> &
//   node Emboss/tests/test-titlepage-details.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const BASE = `http://localhost:${PORT}`;

let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 400) : ''}`); }
};

const settingsJson = (extra = {}) => JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en', ...extra });

const browser = await launchBrowser({ args: ['--no-sandbox'] });

async function freshContext(settingsExtra) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.addInitScript((json) => { try { localStorage.setItem('emboss-settings', json); } catch {} }, settingsJson(settingsExtra));
  return ctx;
}

async function openEditor(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.exportCurrentDocumentXml === 'function' && typeof window.markDocumentClean === 'function' && typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 });
  return { page, errors };
}

async function openSettings(page) {
  await page.click('#settingsBtn');
  await page.waitForSelector('#settingsDialog[open]', { timeout: 10000 });
  // The document tab holds "Book details…" (next to docOptionsGroup).
  await page.click('.settings-nav .tab-btn[data-tab="tab-document"]');
}

// ==================================================================================
// 1. Hidden when Transcriber tools are off; shown (and opens) when they are on
// ==================================================================================
console.log('--- Transcriber tools gate ---');
{
  const ctx = await freshContext({ transcriberTools: false });
  const { page, errors } = await openEditor(ctx);
  await openSettings(page);
  // A child of a display:none ancestor still resolves its OWN `display` CSS property (the
  // ancestor's fmt-transcriber rule is what actually hides it) — check rendered visibility
  // (getClientRects, the same idiom bfResolveTarget's "visible" helper uses in editor.mjs)
  // rather than the button's own computed display.
  const btnState = await page.evaluate(() => {
    const btn = document.getElementById('btnTitlepageDetails');
    return { exists: !!btn, rendered: !!(btn && btn.getClientRects().length), bodyHasClass: document.body.classList.contains('transcriber-tools') };
  });
  ok('Book details button exists in the markup even with Transcriber tools off', btnState.exists);
  ok('body has no transcriber-tools class while the setting is off', btnState.bodyHasClass === false);
  ok('Book details button is not rendered while Transcriber tools is off', btnState.rendered === false, btnState);

  // Turn Transcriber tools on (the checkbox is in the same tab-document panel, above Book details).
  await page.check('#set-transcriberTools');
  const btnAfter = await page.evaluate(() => {
    const btn = document.getElementById('btnTitlepageDetails');
    return { rendered: !!(btn && btn.getClientRects().length) };
  });
  ok('Book details button becomes visible once Transcriber tools is turned on', btnAfter.rendered === true, btnAfter);
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 2. It opens; labels and legends are present; accessible dialog markup
// ==================================================================================
console.log('--- Dialog opens with labels and legends ---');
{
  const ctx = await freshContext({ transcriberTools: true });
  const { page, errors } = await openEditor(ctx);
  await openSettings(page);
  await page.click('#btnTitlepageDetails');
  await page.waitForSelector('#titlepageDetailsDialog[open]', { timeout: 10000 });

  const info = await page.evaluate(() => {
    const dlg = document.getElementById('titlepageDetailsDialog');
    const legends = [...dlg.querySelectorAll('fieldset legend')].map((l) => l.textContent.trim());
    const labels = [...dlg.querySelectorAll('label')].map((l) => l.textContent.trim()).filter(Boolean);
    const labelsForInputs = [...dlg.querySelectorAll('input, textarea, select')].every((el) => {
      if (!el.id) return false;
      return !!dlg.querySelector(`label[for="${el.id}"]`);
    });
    return {
      isOpen: dlg.open,
      labelledby: dlg.getAttribute('aria-labelledby'),
      describedby: dlg.getAttribute('aria-describedby'),
      hasHeading: !!document.getElementById('titlepageDetailsTitle')?.textContent.trim(),
      legends, labelCount: labels.length, labelsForInputs,
      settingsClosed: !document.getElementById('settingsDialog').open,
    };
  });
  ok('Book details is a real, open <dialog>', info.isOpen === true, info);
  ok('dialog is wired to its heading (screen-reader accessible)', info.labelledby === 'titlepageDetailsTitle' && info.hasHeading, info);
  ok('dialog has a description (aria-describedby)', !!info.describedby, info);
  ok('opening it closes the Settings dialog underneath (no dialog stacking)', info.settingsClosed, info);
  ok('every segment has a legend, in BANA order (Title, Author, Publisher and copyright, Transcriber)',
    info.legends.length === 4 && /title/i.test(info.legends[0]) && /author/i.test(info.legends[1]) && /publisher/i.test(info.legends[2]) && /transcriber/i.test(info.legends[3]), info.legends);
  ok('every field control has a real <label for>', info.labelsForInputs, info);
  ok('the dialog has a good number of labelled fields (one per segment at least)', info.labelCount >= 15, info.labelCount);
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 3. Values are saved into the document and survive a save/reload
// ==================================================================================
console.log('--- Values save and survive a reload ---');
{
  const ctx = await freshContext({ transcriberTools: true });
  const { page, errors } = await openEditor(ctx);
  await openSettings(page);
  await page.click('#btnTitlepageDetails');
  await page.waitForSelector('#titlepageDetailsDialog[open]', { timeout: 10000 });

  const values = {
    tpTitle: 'Alice in Wonderland',
    tpSeries: 'Classics Series',
    tpGradeLevel: 'Grade 6',
    tpAuthors: 'Lewis Carroll',
    tpTranslator: 'Jane Translator',
    tpPublisher: 'Macmillan',
    tpPublisherCity: 'London',
    tpCopyright: 'Copyright © 1865 by Macmillan',
    tpIsbn: '978-0-14-143976-6',
    tpYear: '2026',
    tpTranscriber: 'Pat Transcriber',
    tpAgency: 'Example Braille Agency',
  };
  for (const [id, v] of Object.entries(values)) await page.fill(`#${id}`, v);
  await page.selectOption('#tpCountry', 'US');
  const usNotice = await page.inputValue('#tpReproductionNotice');
  ok('selecting country US pre-fills the 2020 reproduction-notice wording', /infringement/.test(usNotice), usNotice);
  const usWarning = await page.evaluate(() => document.getElementById('tpReproductionNoticeWarning').textContent);
  ok('the US reproduction notice shows a "set by law" warning (editable, TP-7/P3), not a locked field', /law/i.test(usWarning), usWarning);
  const noticeReadOnly = await page.evaluate(() => document.getElementById('tpReproductionNotice').hasAttribute('readonly') || document.getElementById('tpReproductionNotice').disabled);
  ok('the reproduction notice stays editable even with the warning shown', noticeReadOnly === false);

  await page.click('#titlepageDetailsSave');
  await page.waitForSelector('#titlepageDetailsDialog[open]', { state: 'hidden', timeout: 10000 });

  const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('the title (existing dc:Title, not a new field) round-trips into the document', xml.includes('Alice in Wonderland'), xml.slice(0, 300));
  ok('the author (existing <docauthor>) is saved', /<docauthor>Lewis Carroll<\/docauthor>/.test(xml), xml.slice(0, 400));
  ok('tpSeries is saved as bana-tp-series meta', /<meta name="bana-tp-series" content="Classics Series"/.test(xml), xml.match(/<meta name="bana-tp-series"[^/]*\/>/)?.[0]);
  ok('tpTranscriber is saved as bana-tp-transcriber meta', /<meta name="bana-tp-transcriber" content="Pat Transcriber"/.test(xml));
  ok('tpIsbn is saved as bana-tp-isbn meta', /<meta name="bana-tp-isbn" content="978-0-14-143976-6"/.test(xml));
  ok('tpCountry is saved as bana-tp-country meta', /<meta name="bana-tp-country" content="US"/.test(xml));

  // "Save/reload": export, mark clean, re-import the same bytes (the editor's own round-trip
  // pattern — test-editor-save-fidelity.mjs uses the same markDocumentClean()+importFile idiom).
  await page.evaluate(async (savedXml) => {
    window.markDocumentClean();
    await window.importFile(new File([savedXml], 'reload-test.xml', { type: 'text/xml' }));
  }, xml);
  await page.waitForFunction(() => (window.lastModel?.blocks || []).length > 0, null, { timeout: 20000 });

  await openSettings(page);
  await page.click('#btnTitlepageDetails');
  await page.waitForSelector('#titlepageDetailsDialog[open]', { timeout: 10000 });
  const after = await page.evaluate(() => ({
    tpTitle: document.getElementById('tpTitle').value,
    tpSeries: document.getElementById('tpSeries').value,
    tpAuthors: document.getElementById('tpAuthors').value,
    tpPublisher: document.getElementById('tpPublisher').value,
    tpCopyright: document.getElementById('tpCopyright').value,
    tpIsbn: document.getElementById('tpIsbn').value,
    tpCountry: document.getElementById('tpCountry').value,
    tpTranscriber: document.getElementById('tpTranscriber').value,
    tpAgency: document.getElementById('tpAgency').value,
  }));
  ok('title survives save/reload', after.tpTitle === 'Alice in Wonderland', after.tpTitle);
  ok('series survives save/reload', after.tpSeries === 'Classics Series', after.tpSeries);
  ok('authors survive save/reload', after.tpAuthors === 'Lewis Carroll', after.tpAuthors);
  ok('publisher survives save/reload', after.tpPublisher === 'Macmillan', after.tpPublisher);
  ok('copyright survives save/reload', after.tpCopyright === 'Copyright © 1865 by Macmillan', after.tpCopyright);
  ok('ISBN survives save/reload', after.tpIsbn === '978-0-14-143976-6', after.tpIsbn);
  ok('country survives save/reload', after.tpCountry === 'US', after.tpCountry);
  ok('transcriber survives save/reload', after.tpTranscriber === 'Pat Transcriber', after.tpTranscriber);
  ok('agency survives save/reload', after.tpAgency === 'Example Braille Agency', after.tpAgency);
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

// ==================================================================================
// 4. ISBN pre-fills from dc:Source when no book details have been saved yet
// ==================================================================================
console.log('--- ISBN pre-fill from dc:Source ---');
{
  const dtbook = `<?xml version="1.0"?>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3">
  <head>
    <meta name="dc:Title" content="A Source ISBN Book"/>
    <meta name="dc:Source" content="978-3-16-148410-0"/>
  </head>
  <book><bodymatter><level1>
    <h1>A Source ISBN Book</h1>
    <p>Some text.</p>
  </level1></bodymatter></book>
</dtbook>`;

  const ctx = await freshContext({ transcriberTools: true });
  const { page, errors } = await openEditor(ctx);
  await page.evaluate(async (xml) => {
    window.markDocumentClean();
    await window.importFile(new File([xml], 'source-isbn-test.xml', { type: 'text/xml' }));
  }, dtbook);
  await page.waitForFunction(() => (window.lastModel?.blocks || []).some((b) => /A Source ISBN Book/.test(b.text || '')), null, { timeout: 20000 });

  await openSettings(page);
  await page.click('#btnTitlepageDetails');
  await page.waitForSelector('#titlepageDetailsDialog[open]', { timeout: 10000 });
  const info = await page.evaluate(() => ({
    isbn: document.getElementById('tpIsbn').value,
    noteHidden: document.getElementById('tpIsbnComputed').hidden,
    noteText: document.getElementById('tpIsbnComputed').textContent,
  }));
  ok('ISBN pre-fills from dc:Source when bana-tp-isbn is absent', info.isbn === '978-3-16-148410-0', info);
  ok('the pre-filled ISBN is marked as coming from the document', info.noteHidden === false && info.noteText.length > 0, info);
  ok('no console/page errors', !errors.length, errors);
  await ctx.close();
}

await browser.close();
console.log(`\n=== titlepage-details [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.error('Failures:', failures);
  process.exit(1);
} else {
  console.log('All titlepage-details checks passed.');
}
