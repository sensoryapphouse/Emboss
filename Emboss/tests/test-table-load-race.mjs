// A89 (the nightly random-action run, seed 1763563818, Chrome, Quick Mode): "Cannot resolve table 'digits6DotsPlusDot6.uti'" /
// "'en-chardefs.cti'". Changing a setting starts fetching the chosen code's tables without waiting (app.mjs), and the transcription
// that follows asks for the same tables. ensureTables marked a table present as soon as its own file was written, before the files
// it includes had arrived, so the second request saw it present, returned at once, and liblouis compiled a table with missing
// includes. Requests are now handled one after another: a second one waits for the first to finish with everything it includes.
//
// Runs in Chrome, WebKit and Firefox (EMBOSS_ENGINE=… for one; tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-table-load-race.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports './lib/launch-browser.mjs').
import { launchBrowser, ENGINE, ENGINE_SET, ENGINES, LABELS } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
for (const key of (ENGINE_SET ? [ENGINE] : ENGINES)) {
  const engine = LABELS[key];
  const browser = await launchBrowser({}, key);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: true, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
  const page = await ctx.newPage();
  const logged = [];
  page.on('console', (m) => { if (/Cannot resolve table|table fetch failed/i.test(m.text())) logged.push(m.text().slice(0, 200)); });
  try {
    await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => { const s = document.getElementById('status'); return s && !/Loading braille engine/.test(s.textContent || ''); }, null, { timeout: 60000 });
    // the second request starts a moment after the first (after its first file has arrived, while it fetches the files that one
    // includes), at several moments, each with a code not loaded yet
    const tables = ['de-comp6.utb', 'fr-bfu-comp6.utb', 'Es-Es-G0.utb', 'hu-hu-comp8.ctb', 'en-us-comp6.ctb', 'en-gb-comp8.ctb', 'it-it-comp6.utb', 'sv-1989.ctb'];
    const delays = [2, 5, 10, 20, 40, 80, 3, 8];
    const results = await page.evaluate(async ({ tables, delays }) => {
      const louis = await import('/engine/louis-browser.mjs');
      const out = [];
      for (let i = 0; i < tables.length; i++) {
        const t = `/tables/unicode.dis,/tables/${tables[i]}`;
        const first = louis.ensureTables(t).catch((e) => e);   // as a settings change does: not waited for
        await new Promise((r) => setTimeout(r, delays[i]));
        await louis.ensureTables(t);                            // as the transcription does
        let r = ''; try { r = louis.translate('Ab 12', t); } catch (e) { r = 'THREW ' + e.message; }
        await first;
        out.push([tables[i], delays[i], r]);
      }
      return out;
    }, { tables, delays });
    for (const [t, d, r] of results) ok(`${engine}: ${t}, second request ${d} ms after the first — it waits, and the table translates`, r && !/^THREW/.test(r), r);
    ok(`${engine}: no "Cannot resolve table"`, logged.length === 0, logged);
  } finally {
    await browser.close();
  }
}
console.log(`\n=== Table loading, two requests at once [${ENGINE_SET ? LABELS[ENGINE] : ENGINES.map((k) => LABELS[k]).join(' + ')}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
