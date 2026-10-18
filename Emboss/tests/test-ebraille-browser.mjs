// eBraille export from the real app (Chrome): Quick Mode (web/index.html) and the editor (web/editor/index.html),
// each through its own Download menu -> eBraille item, with a real file loaded; the download is saved and checked
// (structure, and the DAISY eBraille checker when the jar is on this machine).
//
// Paul, 1 Oct 2026: the eBraille export is structured and split into content documents (format/ebraille.mjs).
// This is the check that the two real export controls produce it, with the editor's and Quick Mode's own options
// (translator with positions, maths, geometry), not only the headless Node call in ebraille_structure.test.mjs.
//
// Needs the dev server:  node Emboss/scripts/serve.mjs 8299 &
//   node Emboss/tests/test-ebraille-browser.mjs [port]
// The checker: java -jar ~/tools/ebraille-checker/ebraille-checker.jar (override with EBRAILLE_CHECKER_JAR);
// PW_CHANNEL=chromium uses Playwright's bundled browser instead of installed Chrome.
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE, ENGINE_LABEL } from './lib/launch-browser.mjs';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzip } from '../../Translate/unmxl.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8299);
const BASE = `http://localhost:${PORT}`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(process.env.EBRL_OUT || path.join(tmpdir(), 'ebrl-browser'), String(process.pid));
mkdirSync(OUT, { recursive: true });
const JAR = process.env.EBRAILLE_CHECKER_JAR || path.join(homedir(), 'tools/ebraille-checker/ebraille-checker.jar');
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok    ${name}`); } else { failures.push(name); console.error(`  FAIL  ${name}${detail ? ': ' + String(detail).slice(0, 300) : ''}`); }
};

// real files: a docx with headings, lists, tables and notes, and a NIMAS book (headings, page numbers, notes, tables, boxes)
const FILES = [
  { name: 'w19-rich-contexts.docx', file: path.join(HERE, 'fixtures/import-audit/docx/w19-rich-contexts.docx'), minDocs: 1 },
  { name: '9780076996285NIMAS.xml', file: path.join(HERE, 'nimas_samples/9780076996285NIMAS.xml'), minDocs: 2, pages: true },
];
if (process.env.EBRL_BIG) FILES.push({ name: '9780544087507NIMAS.xml', file: path.join(HERE, 'nimas_samples/9780544087507NIMAS.xml'), minDocs: 8, pages: true });

async function inspect(label, ebrlPath, want) {
  const buf = readFileSync(ebrlPath);
  const files = await unzip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const dec = new TextDecoder();
  const text = (n) => (files.has(n) ? dec.decode(files.get(n)) : null);
  const opf = text('package.opf');
  const docs = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]*)"/g)].map((m) => {
    const item = new RegExp(`<item\\b[^>]*id="${m[1]}"[^>]*>`).exec(opf)[0];
    return /href="([^"]*)"/.exec(item)[1];
  });
  const html = docs.map(text).join('\n');
  ok(`${label}: the package records the exact braille code (sah:brailleCode, S5c / S3B-Q2)`, /<meta property="sah:brailleCode">en-ueb-g2<\/meta>/.test(opf), (/sah:brailleCode[^<]*<[^>]*>[^<]*/.exec(opf) || ['absent'])[0]);
  ok(`${label}: ${docs.length} content documents (at least ${want.minDocs})`, docs.length >= want.minDocs, docs.join(','));
  ok(`${label}: no embosser pages (no volume documents, no pages of lines)`, !files.has('volume-1.html') && !html.includes('sah-page'));
  ok(`${label}: headings are h1-h6 with ids`, /<h[1-6]\b[^>]*\bid="/.test(html));
  const index = text('index.html');
  ok(`${label}: a table of contents in braille`, /role="doc-toc"/.test(index) && /<a href="content\/[^"]+">[⠀-⣿ ]+<\/a>/.test(index));
  if (want.pages) {
    ok(`${label}: print page markers and a page list with title attributes`, /role="doc-pagebreak"/.test(html) && /epub:type="page-list"/.test(index) && /<a href="[^"]+" title="[^"]+">/.test(index));
  }
  const body = html.replace(/<head>[\s\S]*?<\/head>/g, '').replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot);/g, '');
  ok(`${label}: every piece of text is braille or whitespace`, /^[⠀-⣿\s]*$/.test(body));
  ok(`${label}: a style sheet is linked`, /<link rel="stylesheet" type="text\/css" href="\.\.\/css\/ebraille\.css"\/>/.test(html) && text('css/ebraille.css') !== null);
  console.log(`        ${label}: ${buf.length} bytes, ${docs.length} content documents`);
  if (existsSync(JAR)) {
    let out = '';
    try { out = execFileSync('java', ['-jar', JAR, ebrlPath, '--profile', 'ebraille'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
    const m = /Messages: (\d+) fatals \/ (\d+) errors \/ (\d+) warnings/.exec(out) || [];
    ok(`${label}: the DAISY eBraille checker reports 0 fatals, 0 errors, 0 warnings`, m[1] === '0' && m[2] === '0' && m[3] === '0', out.split('\n').filter((l) => /^(FATAL|ERROR|WARNING)/.test(l)).slice(0, 3).join(' | ') || out.slice(-300));
  } else console.log('        (checker jar not found: structure only)');
}

let browser;
try { browser = await launchBrowser(); }
catch (e) {
  if (ENGINE !== 'chrome') throw e;
  console.log('  (installed Chrome not available, using Playwright chromium: ' + String(e.message).split('\n')[0] + ')');
  browser = await launchBrowser({ channel: undefined });
}
const SETTINGS = { mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' };
async function newPage(simpleMode, extra = {}) {   // Quick Mode redirects to the editor unless simpleMode is on
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript((s) => { try { localStorage.setItem('emboss-settings', JSON.stringify(s)); } catch { /* storage blocked */ } }, { ...SETTINGS, ...extra, simpleMode });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { page, errors, ctx };
}
async function download(page, safe) {
  await page.click('#downloadBtn');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('#downloadEbrlItem')]);
  const dest = path.join(OUT, safe);
  await dl.saveAs(dest);
  return { dest, suggested: dl.suggestedFilename() };
}

console.log(`--- Quick Mode (${BASE}/web/index.html) ---`);
for (const f of FILES) {
  const { page, errors, ctx } = await newPage(true);
  await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
  await page.setInputFiles('#fileInput', f.file);
  // Changed 17 Oct 2026 (Paul, feedback item 9b): the Read / Emboss / Download row (#fileActions) is gone; Export is in the header and is enabled once there is braille.
  await page.waitForFunction(() => { const b = document.getElementById('downloadBtn'); return b && !b.disabled && !!window.lastBrf; }, null, { timeout: 120000 });
  await page.waitForFunction(() => (document.getElementById('resultMeta')?.textContent || '').trim().length > 0, null, { timeout: 120000 });
  const { dest, suggested } = await download(page, `quick-${f.name}.ebrl`);
  ok(`Quick Mode ${f.name}: the download is a .ebrl`, /\.ebrl$/.test(suggested), suggested);
  await inspect(`Quick Mode ${f.name}`, dest, f);
  ok(`Quick Mode ${f.name}: no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

console.log(`--- Editor (${BASE}/web/editor/index.html) ---`);
for (const f of FILES) {
  const { page, errors, ctx } = await newPage(false);
  await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 });
  const arr = Array.from(readFileSync(f.file));
  await page.evaluate(async ({ name, arr }) => {
    window.markDocumentClean();
    const before = window.lastBrf;
    await window.importFile(new File([new Uint8Array(arr)], name));
    const t0 = Date.now();
    while (window.lastBrf === before && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1500));
  }, { name: f.name, arr });
  const { dest, suggested } = await download(page, `editor-${f.name}.ebrl`);
  ok(`Editor ${f.name}: the download is a .ebrl`, /\.ebrl$/.test(suggested), suggested);
  await inspect(`Editor ${f.name}`, dest, f);
  ok(`Editor ${f.name}: no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// S3b #17 / #18 (ChatGPT audit 15 Oct 2026): the package declares the braille system and language of the braille code in force, in BOTH modes
// (the editor used to declare "ueb grade2" whatever code was selected). The docx has no language of its own, so the code's language is used,
// not the browser's (Paul B1). Each package is also run through the DAISY checker.
const WORD = FILES[0];
async function readOpf(file) {
  const buf = readFileSync(file);
  const files = await unzip(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return new TextDecoder().decode(files.get('package.opf'));
}
function checkJar(label, file) {
  if (!existsSync(JAR)) return;
  let out = '';
  try { out = execFileSync('java', ['-jar', JAR, file, '--profile', 'ebraille'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const m = /Messages: (\d+) fatals \/ (\d+) errors \/ (\d+) warnings/.exec(out) || [];
  ok(`${label}: the DAISY eBraille checker reports 0 fatals, 0 errors, 0 warnings`, m[1] === '0' && m[2] === '0' && m[3] === '0', out.split('\n').filter((l) => /^(FATAL|ERROR|WARNING)/.test(l)).slice(0, 3).join(' | '));
}
for (const sc of [{ code: 'en-ueb-g1', grade: 'g1', system: 'ueb grade1', lang: /^en-Brai/ }, { code: 'de-g2', grade: 'g2', system: 'de-g2', lang: /^de-Brai/ }]) {
  for (const mode of ['Quick Mode', 'Editor']) {
    const { page, errors, ctx } = await newPage(mode === 'Quick Mode', { brailleCode: sc.code, grade: sc.grade });
    let dest;
    if (mode === 'Quick Mode') {
      await page.goto(`${BASE}/web/index.html`, { waitUntil: 'load' });
      await page.setInputFiles('#fileInput', WORD.file);
      await page.waitForFunction(() => (document.getElementById('resultMeta')?.textContent || '').trim().length > 0, null, { timeout: 120000 });
      ({ dest } = await download(page, `quick-${sc.code}.ebrl`));
    } else {
      await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
      await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 });
      const arr = Array.from(readFileSync(WORD.file));
      await page.evaluate(async ({ name, arr }) => {
        window.markDocumentClean();
        const before = window.lastBrf;
        await window.importFile(new File([new Uint8Array(arr)], name));
        const t0 = Date.now();
        while (window.lastBrf === before && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
        await new Promise((r) => setTimeout(r, 1500));
      }, { name: WORD.name, arr });
      ({ dest } = await download(page, `editor-${sc.code}.ebrl`));
    }
    const opf = await readOpf(dest);
    const systems = [...opf.matchAll(/<meta property="a11y:brailleSystem">([^<]*)<\/meta>/g)].map((m) => m[1]);
    ok(`${mode} with braille code ${sc.code}: declares ${sc.system} (not always ueb grade2)`, systems[0] === sc.system, systems.join(','));
    ok(`${mode} with braille code ${sc.code}: dc:language follows the code's language, not the browser's`, sc.lang.test(/<dc:language>([^<]*)</.exec(opf)?.[1] || ''), /<dc:language>([^<]*)</.exec(opf)?.[1]);
    checkJar(`${mode} ${sc.code}`, dest);
    ok(`${mode} ${sc.code}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}
await browser.close();
console.log(`\n=== eBraille [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed (downloads kept in ${OUT}) ===`);
if (failures.length) { console.error('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
