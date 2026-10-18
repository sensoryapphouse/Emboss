// Feedback 17 Oct 2026, item 9a (Paul's decision): Quick Mode's Settings are the editor's — the same sections, options, labels, help text and order, built from one
// source (web/settings-panes.mjs) — with the controls that mean nothing without an editor or a document left out, the transcriber-only ones hidden unless
// Transcriber tools is on (as in the editor), and "Interline Print View" gone. Changing a setting in Quick Mode changes the braille at once and is the setting the
// editor uses too. This compares the two pages' dialogs control by control, with Transcriber tools off and on, and exercises the controls in Quick Mode.
// Run: node Emboss/scripts/serve.mjs 8261 &   node Emboss/tests/test-quickmode-settings.mjs 8261     (EMBOSS_ENGINE=webkit for Safari's engine)
import { openSuite, openEditor, URL_BASE } from './lib/suite.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SMALL = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'feedback-17oct', 'small-nimas-test.xml');

// what a person sees in the dialog: for each tab (in order), each visible field's label, kind, options and help
const SNAPSHOT = () => {
  const dlg = document.getElementById('settingsDialog');
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const out = [];
  const tabs = [...dlg.querySelectorAll('.settings-nav .tab-btn')].filter((b) => getComputedStyle(b).display !== 'none');
  for (const tab of tabs) {
    tab.click();
    const panel = dlg.querySelector('#' + tab.dataset.tab);
    const items = [];
    for (const el of panel.querySelectorAll('select, input, button, h3, small, legend, p.fmt-help')) {
      if (!vis(el)) continue;
      if (el.tagName === 'H3') { items.push(['h3', el.textContent.replace(/\s+/g, ' ').trim()]); continue; }
      if (el.tagName === 'SMALL' || el.tagName === 'LEGEND' || el.tagName === 'P') { items.push([el.tagName.toLowerCase(), el.textContent.replace(/\s+/g, ' ').trim()]); continue; }
      const label = (el.closest('label') ? el.closest('label').textContent : (el.labels && el.labels[0] ? el.labels[0].textContent : el.textContent)).replace(/\s+/g, ' ').trim();
      const opts = el.tagName === 'SELECT' ? [...el.options].filter((o) => !o.hidden).map((o) => o.textContent.replace(/\s+/g, ' ').trim()).filter((t) => !/more languages|English UEB \(Grade/.test(t) || true) : undefined;
      items.push([el.tagName === 'SELECT' ? 'select' : el.type || el.tagName.toLowerCase(), el.id.replace(/^set-/, ''), label, opts]);
    }
    out.push({ tab: tab.textContent.replace(/\s+/g, ' ').trim(), id: tab.dataset.tab, items });
  }
  return out;
};

const { page, ok, finish, ENGINE_LABEL } = await openSuite('Quick Mode Settings', { settings: { simpleMode: true, mode: 'bana' }, viewport: { width: 1200, height: 900 } });
try {
  for (const tools of [false, true]) {
    await page.evaluate((t) => { localStorage.setItem('emboss-settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('emboss-settings') || '{}'), simpleMode: true, mode: 'bana', transcriberTools: t })); }, tools).catch(() => {});
    await page.goto(`${URL_BASE}/web/index.html`, { waitUntil: 'load' });
    await page.evaluate((t) => { localStorage.setItem('emboss-settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('emboss-settings') || '{}'), simpleMode: true, mode: 'bana', transcriberTools: t })); }, tools);
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1200);
    await page.click('#settingsBtn');
    const quick = await page.evaluate(SNAPSHOT);
    await page.keyboard.press('Escape');
    await page.goto(`${URL_BASE}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 }); await page.waitForTimeout(1200);
    await page.click('#settingsBtn');
    const edit = await page.evaluate(SNAPSHOT);
    await page.keyboard.press('Escape');
    // the editor's own extras: remove from its snapshot what is marked data-scope="editor" (voice, rate, Title field, explanation bar, Book details, the document's Braille formatting options: doc*)
    const EDITOR_ONLY = ['voice', 'rate', 'showTitleField', 'showExplanationBar', 'btnTitlepageDetails', 'btnConnectTactile', 'btnConnectHid', 'btnDisconnectTactile', 'btnSimulateTactile', 'btnSimulateDotPad'];
    const strip = (snap) => snap.map((t) => ({ ...t, items: t.items.filter((it) => !EDITOR_ONLY.includes(it[1]) && !/^(fmt|bf|doc)/.test(it[1] || '')) }));
    const names = (snap) => snap.map((t) => t.tab);
    ok(`[Transcriber tools ${tools ? 'on' : 'off'}] the same tabs, in the same order: ${names(quick).join(' | ')}`, JSON.stringify(names(quick)) === JSON.stringify(names(edit)), { quick: names(quick), edit: names(edit) });
    for (let i = 0; i < quick.length; i++) {
      const q = strip(quick)[i].items.filter((it) => it[0] !== 'small' || true), e = strip(edit)[i].items;
      // the editor's tab also holds headings/notes of the editor-only fields (a <small> beside Voice ...) — compare the controls, labels and options, and the headings
      const keep = (items) => items.filter((it) => ['select', 'checkbox', 'number', 'text', 'range', 'h3', 'button'].includes(it[0])).map((it) => JSON.stringify(it));
      const qs = keep(q), es = keep(e);
      ok(`[Transcriber tools ${tools ? 'on' : 'off'}] "${quick[i].tab}": the same controls, labels and options as the editor's, in the same order (${qs.length})`, JSON.stringify(qs) === JSON.stringify(es), { onlyQuick: qs.filter((x) => !es.includes(x)).slice(0, 4), onlyEditor: es.filter((x) => !qs.includes(x)).slice(0, 4) });
    }
    if (!tools) ok('with Transcriber tools off neither page offers Paragraph Style or Quotation Marks', ![...quick, ...edit].some((t) => t.items.some((it) => ['paragraphStyle', 'quoteStyle'].includes(it[1]))));
    else ok('with Transcriber tools on both pages offer Paragraph Style and Quotation Marks', [quick, edit].every((snap) => ['paragraphStyle', 'quoteStyle'].every((id) => snap.some((t) => t.items.some((it) => it[1] === id)))));
    if (tools) {
      // switch it off again in the page itself: the controls go at once
      await page.goto(`${URL_BASE}/web/index.html`, { waitUntil: 'load' }); await page.waitForTimeout(1200);
      await page.click('#settingsBtn'); await page.click('.tab-btn[data-tab="tab-document"]');
      await page.uncheck('#set-transcriberTools'); await page.click('.tab-btn[data-tab="tab-rules"]');
      ok('switching Transcriber tools off in Quick Mode hides the transcriber-only settings at once, and it is saved for the editor', await page.evaluate(() => !document.getElementById('set-paragraphStyle').offsetParent && JSON.parse(localStorage.getItem('emboss-settings')).transcriberTools === false));
      await page.keyboard.press('Escape');
    }
  }

  // the dialog in Quick Mode has no Interline, and keeps the editor's help text
  await page.goto(`${URL_BASE}/web/index.html`, { waitUntil: 'load' }); await page.waitForTimeout(1200);
  await page.click('#settingsBtn');
  ok('"Interline Print View" is gone from Quick Mode\'s Settings', await page.evaluate(() => !/interline/i.test(document.getElementById('settingsDialog').textContent) && !document.getElementById('interline')));
  await page.click('.tab-btn[data-tab="tab-display"]');
  ok('User Interface: language, BRF letters, and "Start in Quick Mode" (the Title field, the explanation bar and the reading voice are the editor\'s)', await page.evaluate(() => ['set-uiLanguage', 'set-asciiBraille', 'set-simpleMode'].every((id) => !!document.getElementById(id)) && !document.getElementById('set-voice') && !document.getElementById('set-showTitleField') && !document.getElementById('set-showExplanationBar')));
  await page.keyboard.press('Escape');

  // the controls work in Quick Mode: change the page size and standard, watch the braille and the summary line, and see the editor agree
  await page.setInputFiles('#fileInput', SMALL);
  await page.waitForFunction(() => window.lastBrf && document.querySelector('#preview .brl-row'), null, { timeout: 60000 });
  const widthOf = (brf) => Math.max(...brf.split(/\r?\n/).map((l) => l.replace(/\f/g, '').length));
  const before = await page.evaluate(() => ({ brf: window.lastBrf, summary: document.getElementById('settingsSummary').textContent }));
  await page.click('#settingsBtn'); await page.click('.tab-btn[data-tab="tab-document"]');
  await page.selectOption('#set-pageSize', 'uk-28x27');
  await page.waitForFunction((b) => window.lastBrf && window.lastBrf !== b, before.brf, { timeout: 30000 });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ brf: window.lastBrf, summary: document.getElementById('settingsSummary').textContent, cells: document.getElementById('set-cells').value, lines: document.getElementById('set-lines').value, saved: JSON.parse(localStorage.getItem('emboss-settings')) }));
  ok('picking "UK A4 (28 × 27)" fills Cells and Lines, re-brailles the document at that size, and the line under the name says so', after.cells === '28' && after.lines === '27' && widthOf(after.brf) <= 28 && /28×27/.test(after.summary) && after.saved.cells === 28 && after.saved.lines === 27, { after: { ...after, brf: undefined }, w: widthOf(after.brf) });
  await page.click('.tab-btn[data-tab="tab-rules"]');
  await page.selectOption('#set-mode', 'ukaaf');
  await page.waitForTimeout(800);
  const std = await page.evaluate(() => ({ summary: document.getElementById('settingsSummary').textContent, cells: document.getElementById('set-cells').value, lines: document.getElementById('set-lines').value }));
  ok('changing the standard to UKAAF takes its page size (38 × 27), as in the editor', /UKAAF/.test(std.summary) && std.cells === '38' && std.lines === '27', std);
  await page.keyboard.press('Escape');
  await page.goto(`${URL_BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 }); await page.waitForTimeout(1200);
  await page.click('#settingsBtn');
  ok('the editor\'s Settings show what Quick Mode set (UKAAF, 38 × 27)', await page.evaluate(() => document.getElementById('set-mode').value === 'ukaaf' && document.getElementById('set-cells').value === '38' && document.getElementById('set-lines').value === '27'));
} finally { await finish(); }
