// Audit batch S2b, the two items that need a real browser (ChatGPT audit 15 Oct 2026, Emboss/docs/chatgpt-audit-15oct.md):
//   #8   a Word file whose word/document.xml is damaged. A browser's DOMParser does not throw on bad XML (Node's xmldom does), and the reader
//        used to recover by parsing it as HTML and found no Word paragraphs: an EMPTY, SUCCESSFUL document. It is a damaged-file error now, in
//        the parser (native DOMParser) and in the editor (the red error banner; the document that was open is untouched).
//   #11  the real browser maths wrapper (engine/maths.mjs with the real MathCAT WASM): a rejected non-empty equation throws a mathRejected
//        failure; an empty one is ''; the formatter marks the rejected equation with the "Equation could not be read" note and a
//        math-unreadable warning, inline and display, one-pass and async.
//
// Needs the dev server:  node Emboss/scripts/serve.mjs 8203 &      then   node Emboss/tests/test-s2b-browser.mjs 8203
// Chrome by default (EMBOSS_ENGINE=webkit|firefox to try another). run-all-tests.mjs lists this as "browser (not run)".
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8203);
const BASE = `http://localhost:${PORT}`;
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); } else { failures.push(name); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 400) : ''}`); }
};

const browser = await launchBrowser();
const ctx = await browser.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' })); } catch { /* storage may be blocked */ } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(`${BASE}/web/editor/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 });

// ------------------------------------------------------------------------------------------------ #8
console.log(`--- #8 damaged Word XML (${ENGINE_LABEL}) ---`);
const r8 = await page.evaluate(async () => {
  const { parseFile } = await import('/input/parse.mjs');
  const { makeZip } = await import('/web/zip.mjs');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const docx = (xml) => makeZip([
    { name: '[Content_Types].xml', text: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>' },
    { name: '_rels/.rels', text: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', text: xml },
  ]).arrayBuffer();
  const body = (inner) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${inner}</w:body></w:document>`;
  const attempt = async (name, xml) => {
    try { const m = await parseFile(name, await docx(xml)); return { ok: true, blocks: (m.blocks || []).length, text: JSON.stringify(m.blocks) }; }
    catch (e) { return { ok: false, userFacing: !!e.userFacing, message: String(e.message) }; }
  };
  // the browser really does not throw on bad XML (the cause of the bug): its XML parse gives a parsererror, its HTML parse a body
  const bad = body('<w:p><w:r><w:t>Important text</w:r></w:p>');
  const doc = new DOMParser().parseFromString(bad, 'application/xml');
  return {
    nativeParserError: !!doc.getElementsByTagName('parsererror').length,
    mismatched: await attempt('bad.docx', bad),
    noBody: await attempt('nobody.docx', `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:p><w:r><w:t>Important text</w:t></w:r></w:p></w:document>`),
    html: await attempt('html.docx', '<html><body><p>Important text</p></body></html>'),
    empty: await attempt('empty.docx', body('')),
    good: await attempt('good.docx', body('<w:p><w:r><w:t>Important text</w:t></w:r></w:p>')),
  };
});
ok('the browser\'s own XML parser reports the mismatched tag (so the old HTML fallback was the only way it "worked")', r8.nativeParserError);
ok('mismatched tags: a damaged-file error naming word/document.xml', !r8.mismatched.ok && r8.mismatched.userFacing && /Word document is damaged or incomplete/.test(r8.mismatched.message) && /word\/document\.xml/.test(r8.mismatched.message), r8.mismatched);
ok('no w:body: a damaged-file error', !r8.noBody.ok && /damaged or incomplete/.test(r8.noBody.message), r8.noBody);
ok('an HTML page as document.xml: a damaged-file error', !r8.html.ok && /damaged or incomplete/.test(r8.html.message), r8.html);
ok('a genuinely empty Word body is an empty document, not an error', r8.empty.ok && r8.empty.blocks === 0, r8.empty);
ok('a good document still reads', r8.good.ok && /Important text/.test(r8.good.text), r8.good);

// in the editor: the red error banner, and the document that was open is untouched
const brfBefore = await page.evaluate(() => window.lastBrf);
const ui = await page.evaluate(async () => {
  const { makeZip } = await import('/web/zip.mjs');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const buf = await makeZip([
    { name: '[Content_Types].xml', text: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>' },
    { name: 'word/document.xml', text: `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Important text</w:r></w:p></w:body></w:document>` },
  ]).arrayBuffer();
  window.markDocumentClean();
  await window.importFile(new File([buf], 'damaged.docx'));
  await new Promise((r) => setTimeout(r, 800));
  const banner = document.getElementById('parseWarningBanner');
  return { hidden: banner.hidden, isError: banner.classList.contains('is-error'), text: document.getElementById('parseWarningText').textContent, brf: window.lastBrf };
});
ok('the editor shows the red error banner with the plain message', !ui.hidden && ui.isError && /Word document is damaged or incomplete/.test(ui.text), ui);
ok('the document that was open is untouched (its braille did not become empty)', ui.brf === brfBefore && ui.brf.length > 0);

// ------------------------------------------------------------------------------------------------ #11
console.log(`--- #11 rejected equation, the real maths wrapper (${ENGINE_LABEL}) ---`);
const r11 = await page.evaluate(async () => {
  const maths = await import('/engine/maths.mjs');
  const { formatDocument, formatDocumentAsync } = await import('/format/document.mjs');
  await maths.initMaths();
  const NS = 'xmlns="http://www.w3.org/1998/Math/MathML"';
  const BAD = `<math ${NS}><mfrac><mn>1</mn></mfrac></math>`;
  const EMPTY = `<math ${NS}><mrow/></math>`;
  const out = {};
  const warn = console.warn; console.warn = () => {};            // MathCAT's own diagnostic line is expected
  try {
    for (const mode of ['nemeth', 'ueb']) {
      try { out[`reject_${mode}`] = { returned: maths.mathToBrf({ mathml: BAD }, mode) }; } catch (e) { out[`reject_${mode}`] = { threw: true, mathRejected: e.mathRejected === true, message: String(e.message) }; }
      out[`empty_${mode}`] = maths.mathToBrf({ mathml: EMPTY }, mode);
    }
    const up = (s) => String(s).toUpperCase();
    const optsFor = (mode) => ({ mode: mode === 'nemeth' ? 'bana' : 'ukaaf', width: 40, depth: 25, translate: up, translatePos: (s) => ({ braille: up(s), inputPos: Array.from(s, (_, i) => i) }), mathToBrf: (seg) => maths.mathToBrf(seg, mode) });
    const docs = {
      display: { title: null, blocks: [{ type: 'para', text: 'BEFORE' }, { type: 'math', mathml: BAD }, { type: 'para', text: 'AFTER' }] },
      inline: { title: null, blocks: [{ type: 'para', segments: [{ type: 'text', text: 'BEFORE ' }, { type: 'math', mathml: BAD }, { type: 'text', text: ' AFTER' }] }] },
    };
    for (const [kind, doc] of Object.entries(docs)) {
      for (const [fname, fmt] of [['sync', formatDocument], ['async', formatDocumentAsync]]) {
        const o = optsFor('nemeth');
        const brf = String(await fmt(structuredClone(doc), o)).replace(/[\r\n\f]/g, '');
        out[`${kind}_${fname}`] = { hasBefore: brf.includes('BEFORE'), hasAfter: brf.includes('AFTER'), note: brf.includes('@.<'), warnings: (o.warnings || []).filter((w) => w.kind === 'math-unreadable').length, skipped: (o.warnings || []).filter((w) => w.kind === 'block-skipped').length };
      }
    }
  } finally { console.warn = warn; }
  return out;
});
for (const mode of ['nemeth', 'ueb']) {
  ok(`${mode}: a rejected equation throws a mathRejected failure (not '')`, r11[`reject_${mode}`].threw === true && r11[`reject_${mode}`].mathRejected === true, r11[`reject_${mode}`]);
  ok(`${mode}: a genuinely empty equation is ''`, r11[`empty_${mode}`] === '', r11[`empty_${mode}`]);
}
for (const kind of ['display', 'inline']) {
  for (const fname of ['sync', 'async']) {
    const r = r11[`${kind}_${fname}`];
    ok(`${kind} equation, ${fname} formatter: the text round it is kept, the note stands for it, one warning`, r.hasBefore && r.hasAfter && r.note && r.warnings === 1 && r.skipped === 0, r);
  }
}

ok('no page errors', pageErrors.length === 0, pageErrors);
await browser.close();
console.log(`\n${ENGINE_LABEL}: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.error('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
