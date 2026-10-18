// Import fix list #49 (found by the DTBook agent, D14, 30 Sep 2026): a poem opened in the editor and saved wrote its title as a
// section heading (<levelN><hN>) — the editor kept a verse line's fromPoem but not the poemRole / poemId the DTBook reader sets on
// a poem's own title, author and byline (and on its lines), so the exporter could not put them back inside the <poem>. Saved
// straight from the reader the same file keeps them inside. Now the editor carries poemRole and poemId on its nodes, and a poem
// saved from the editor has the same shape as one saved from the reader.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-editor-poem-save.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'fixtures', 'nimas-import-fixes', 'poems.xml');
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
await context.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', standard: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
const page = await context.newPage();
try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.markDocumentClean());
  await page.setInputFiles('#loadFileInput', FILE);
  await page.waitForTimeout(4000);
  const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  const poems = [...xml.matchAll(/<poem\b[\s\S]*?<\/poem>/g)].map((m) => m[0]);
  ok('seven poems saved (two adjacent titled poems stay two)', poems.length === 7, poems.length);
  const inPoem = (title, what = 'title') => poems.some((p) => new RegExp(`<${what}[^>]*>${title}</${what}>`).test(p));
  for (const t of ['Poem One Title', 'Only A Title', 'Adjacent Poem X', 'Adjacent Poem Y', 'Title Only Poem']) ok(`"${t}" is the poem's own <title>`, inPoem(t), poems.find((p) => p.includes(t)) || xml.slice(Math.max(0, xml.indexOf(t) - 200), xml.indexOf(t) + 80));
  for (const t of ['Poem One Title', 'Only A Title', 'Adjacent Poem X']) ok(`"${t}" is not also a section heading`, !new RegExp(`<h[1-6][^>]*>${t}</h[1-6]>`).test(xml));
  for (const a of ['Poet One', 'Only An Author', 'Poet X', 'Poet Y']) ok(`"${a}" is the poem's <author>`, inPoem(a, 'author'));
  ok('the byline after the lines stays inside its poem', poems.some((p) => /Bare poem line B[\s\S]*<byline[^>]*>Byline after the lines<\/byline>/.test(p)));
  ok('the two adjacent poems each have their own title, author and line', poems.some((p) => /Adjacent Poem X[\s\S]*Poet X[\s\S]*Adjacent X line/.test(p) && !/Adjacent Poem Y/.test(p)) && poems.some((p) => /Adjacent Poem Y[\s\S]*Poet Y[\s\S]*Adjacent Y line/.test(p) && !/Adjacent Poem X/.test(p)));
  ok('both stanzas of poem one are in the same <poem>', poems.some((p) => /Poem One Title[\s\S]*First line of one[\s\S]*<\/linegroup>[\s\S]*<linegroup>[\s\S]*Second stanza of one/.test(p)));
  // an undo after an edit keeps the roles (the fields ride through the node JSON, clone and the undo history)
  await page.click('#editor');
  await page.keyboard.press('End');
  await page.keyboard.type('x');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await page.waitForTimeout(800);
  const xml2 = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('after an edit and undo the poems save the same way', [...xml2.matchAll(/<poem\b/g)].length === 7 && /<poem>\s*<title[^>]*>Poem One Title<\/title>/.test(xml2), xml2.slice(xml2.indexOf('Poem One') - 200, xml2.indexOf('Poem One') + 100));
  // Verse drama (D5: a <p class="bai-verse"> line, playVerse) keeps its BANA 14.6.1a margins in the editor: the runover of a verse-play
  // line starts in cell 5 as the reader formats it, not in cell 3 as poetry (1 Oct 2026: the editor dropped playVerse).
  await page.evaluate(() => window.markDocumentClean());
  await page.setInputFiles('#loadFileInput', path.join(HERE, 'fixtures', 'nimas-import-fixes', 'verse-drama.xml'));
  await page.waitForTimeout(4000);
  const brf = await page.evaluate(() => window.lastBrf || '');
  ok('a verse-drama runover line starts in cell 5 (BANA 14.6.1a), as the reader formats it', /\n {4}NOBL\] 9 ! M9D TO SU6\]/.test(brf), brf.split(/\r?\n/).filter((l) => /NOBL/.test(l)));
  const dxml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('verse drama still saves as <p class="bai-verse">', (dxml.match(/<p class="bai-verse">/g) || []).length === 2);
} finally {
  await browser.close();
}
console.log(`\n=== Editor poem save [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
