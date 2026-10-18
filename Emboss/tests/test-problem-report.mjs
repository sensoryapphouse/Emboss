// A89 step 2 (robustness programme; Paul, 2 Oct): "Report a problem…" in Help, in the editor and in Quick Mode, saves one .zip a
// tester can email: README.txt, report.json (what they wrote, version, browser, settings, every error since the page opened)
// and — unless they untick it — the document and its braille (the editor: the NIMAS file and the editor's own state; Quick Mode:
// the very file they loaded, even one Emboss could not read). Nothing is sent: the page makes no request to any other site.
//
// Runs in Chrome, WebKit and Firefox (EMBOSS_ENGINE=… for one; tests/lib/launch-browser.mjs). Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-problem-report.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';
import { readFileSync } from 'node:fs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const ORIGIN = `http://localhost:${PORT}`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};

// the STORE-only zips web/zip.mjs writes: name -> Buffer
function unzip(buf) {
  const out = {};
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18), nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28);
    const name = buf.slice(p + 30, p + 30 + nlen).toString('utf8');
    out[name] = buf.slice(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
    p += 30 + nlen + xlen + size;
  }
  return out;
}

for (const key of (ENGINE_SET ? [ENGINE] : ENGINES)) {
  const engine = LABELS[key];
  const launch = () => launchBrowser({}, key);
  const browser = await launch();
  const offsite = [];
  const errors = [];
  const newPage = async (simple) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    await ctx.addInitScript((simple) => { try { if (!sessionStorage.getItem('pr')) { sessionStorage.setItem('pr', '1'); localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: simple, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } } catch {} }, simple);
    const page = await ctx.newPage();
    page.on('request', (r) => { if (!r.url().startsWith(ORIGIN) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) offsite.push(r.url()); });
    page.on('pageerror', (e) => { if (!String(e).includes('deliberate test error')) errors.push(String(e)); });
    page.on('dialog', (d) => d.accept());
    return page;
  };
  // open Help, then Report a problem…, fill it in, save; returns the zip's files
  const report = async (page, { description = '', includeDocument = true } = {}) => {
    await page.click('#helpBtn');
    await page.waitForSelector('#reportProblemBtn', { state: 'visible', timeout: 5000 });
    await page.click('#reportProblemBtn');
    await page.waitForSelector('#problemDialog[open]', { timeout: 5000 });
    if (description) await page.fill('#problemDesc', description);
    if (!includeDocument) await page.uncheck('#problemIncludeDoc');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#problemSave')]);
    const files = unzip(readFileSync(await dl.path()));
    return { name: dl.suggestedFilename(), files, report: files['report.json'] ? JSON.parse(files['report.json'].toString('utf8')) : null };
  };
  try {
    // ---- the editor
    let page = await newPage(false);
    await page.goto(`${ORIGIN}/web/editor/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.importFile === 'function', null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.evaluate(async () => { const t = await (await fetch('/web/test_samples/nimas_comprehensive_structures_sample.xml')).text(); window.markDocumentClean(); await window.importFile(new File([t], 'sample.xml')); });
    await page.waitForTimeout(3000);
    await page.evaluate(() => { setTimeout(() => { throw new Error('deliberate test error'); }, 0); });
    await page.waitForTimeout(300);
    let r = await report(page, { description: 'The caret stuck after the equation.' });
    ok(`${engine} editor: the file is named emboss-problem-report-<date>-<time>.zip`, /^emboss-problem-report-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/.test(r.name), r.name);
    ok(`${engine} editor: README.txt, report.json, the NIMAS document, the editor state and the braille`, ['README.txt', 'report.json', 'document.xml', 'editor-state.json', 'braille.brf'].every((n) => r.files[n]), Object.keys(r.files));
    ok(`${engine} editor: what the tester wrote is in the report`, r.report?.description === 'The caret stuck after the equation.', r.report?.description);
    ok(`${engine} editor: the error that happened is in the report`, (r.report?.errors || []).some((e) => /deliberate test error/.test(e.message)), r.report?.errors);
    ok(`${engine} editor: page, settings and browser are in the report`, r.report?.page === 'editor' && r.report?.settings?.mode === 'bana' && /Mozilla/.test(r.report?.environment?.userAgent || ''), { page: r.report?.page, s: r.report?.settings?.mode });
    ok(`${engine} editor: the document saved is the one on screen`, /Comprehensive NIMAS Structural Showcase/.test(r.files['document.xml']?.toString('utf8') || ''), (r.files['document.xml'] || '').toString().slice(0, 200));
    ok(`${engine} editor: the braille is there`, (r.files['braille.brf']?.length || 0) > 500, r.files['braille.brf']?.length);
    ok(`${engine} editor: the dialog closes after saving, and the page says where the file went`, await page.evaluate(() => !document.getElementById('problemDialog').open));
    r = await report(page, { includeDocument: false });
    ok(`${engine} editor: with "Include my document" unticked, no document and no braille`, Object.keys(r.files).sort().join() === 'README.txt,report.json' && r.report?.includedDocument === false, Object.keys(r.files));
    // Escape closes it, nothing saved
    await page.click('#helpBtn'); await page.click('#reportProblemBtn'); await page.waitForSelector('#problemDialog[open]');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    ok(`${engine} editor: Escape closes the dialog`, await page.evaluate(() => !document.getElementById('problemDialog').open));
    await page.context().close();

    // ---- Quick Mode, a document that reads
    page = await newPage(true);
    await page.goto(`${ORIGIN}/web/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    const xml = await page.evaluate(async () => (await fetch('/web/test_samples/nimas_comprehensive_structures_sample.xml')).text());
    await page.setInputFiles('#fileInput', { name: 'my-book.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
    await page.waitForFunction(() => (document.getElementById('preview')?.textContent || '').trim().length > 50, null, { timeout: 60000 });
    r = await report(page, { description: 'Quick Mode test' });
    ok(`${engine} Quick Mode: the file the tester loaded, its braille, and the report`, r.files['original/my-book.xml'] && r.files['braille.brf'] && r.report?.page === 'quick', Object.keys(r.files));
    ok(`${engine} Quick Mode: the loaded file is saved byte for byte`, r.files['original/my-book.xml']?.toString('utf8') === xml);
    // ---- Quick Mode, a file Emboss cannot read: that file is exactly what is needed
    await page.setInputFiles('#fileInput', { name: 'broken.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK\u0003\u0004 this is not really a Word file') });
    await page.waitForTimeout(2500);
    r = await report(page);
    ok(`${engine} Quick Mode: a file that could not be read is in the report too`, !!r.files['original/broken.docx'], Object.keys(r.files));
    ok(`${engine} Quick Mode: …with the reading error`, (r.report?.errors || []).length > 0 || /could not|read/i.test(JSON.stringify(r.report?.extra || {})), { errors: r.report?.errors, extra: r.report?.extra });
    await page.context().close();

    ok(`${engine}: nothing was sent to any other site`, offsite.length === 0, offsite);
    ok(`${engine}: no page errors (other than the deliberate one)`, errors.length === 0, errors);
  } finally {
    await browser.close();
  }
}
console.log(`\n=== Report a problem [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
