// A small harness for the browser suites written for the 17 Oct 2026 feedback batch: ok(), a page that opens the editor (or Quick Mode) with
// the saved settings given, and the summary line the other suites print (run-browser-suites.mjs reads "N passed, M failed").
//   const s = await openSuite('Name', { port, settings: { simpleMode: false } });   // s.page, s.ok(), s.finish()
import { launchBrowser, ENGINE_LABEL } from './launch-browser.mjs';

export const PORT = Number(process.argv[2] || process.env.PORT || 8137);
export const URL_BASE = `http://localhost:${PORT}`;

export async function openSuite(name, { settings = { simpleMode: false, mode: 'bana' }, viewport = { width: 1400, height: 900 }, colorScheme = 'light', context = {} } = {}) {
  let pass = 0;
  const failures = [];
  const ok = (label, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✓ ok    ${label}`); }
    else { failures.push({ label, detail }); console.error(`  ✖ FAIL  ${label}${detail !== '' ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
  };
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport, colorScheme, ...context });
  // the settings are put in once per tab session, so a reload inside a test keeps what the test changed
  await ctx.addInitScript((s) => { try { if (!sessionStorage.getItem('suite-init')) { sessionStorage.setItem('suite-init', '1'); localStorage.setItem('emboss-settings', JSON.stringify(s)); } } catch { /* no storage */ } }, settings);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  const finish = async () => {
    ok('no page errors', errors.length === 0, errors);
    await browser.close();
    console.log(`\n=== ${name} [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
    if (failures.length) process.exit(1);
  };
  return { browser, ctx, page, ok, errors, finish, ENGINE_LABEL };
}

export async function openEditor(page, path = '/web/editor/index.html') {
  await page.goto(`${URL_BASE}${path}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 30000 });
  await page.waitForTimeout(1200);
}

// Load a document into the editor from memory and wait until it has been brailled.
export async function loadIntoEditor(page, name, body, mimeType = 'text/html') {
  await page.evaluate(() => { window.markDocumentClean?.(); window.__prevModel = window.lastModel; });
  await page.setInputFiles('#loadFileInput', { name, mimeType, buffer: Buffer.from(body) });
  await page.waitForFunction(() => window.lastModel && window.lastModel !== window.__prevModel && (window.lastModel.blocks || []).length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
}
