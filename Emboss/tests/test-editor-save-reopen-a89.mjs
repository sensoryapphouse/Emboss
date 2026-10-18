// A89 (Paul, 2 Oct 2026): the editor's real Save -> reopen for the three faults the random-action test (scripts/monkey-test.mjs,
// its `save-reopen` check) found, in Chrome, WebKit and Firefox (EMBOSS_ENGINE=chrome|webkit|firefox, tests/lib/launch-browser.mjs).
// The saved file is what window.exportCurrentDocumentXml() gives; it is opened in a FRESH browser context (a new editor) with
// window.importFile, and its braille (window.lastBrf) and model (window.lastModel) must be the first tab's.
//   6. an empty paragraph, an empty list item and an empty table row are saved and come back (an empty paragraph between two print
//      page numbers keeps them on two lines in BANA; an empty list item is a numbered line; an empty row a blank row)
//   7. a space at the edge of a paragraph, heading or run is kept
//   8. an equation holding only its TeX source is brailled as maths (Temml -> MathCAT), the same as the equation as presentation
//      MathML; TeX Temml cannot convert is brailled as a transcriber's note and flagged in the transcription warnings; both reopen the same
//
// Run (needs a dev server on a port of your own): node Emboss/scripts/serve.mjs 8294 &  then  node Emboss/tests/test-editor-save-reopen-a89.mjs 8294
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`--- A89 editor save -> reopen (empty blocks, edge spaces, TeX-only equations) [${ENGINE_LABEL}] ---`);
let pass = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok    ${name}`); } else { failures.push({ name, detail }); console.error(`  FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
}

const browser = await launchBrowser({ args: ['--no-sandbox'] });
const SETTINGS = { simpleMode: false, sixKeyInput: true, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en', transcriberTools: true };

async function openEditor(settings = SETTINGS) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  await context.addInitScript((s) => { try { localStorage.setItem('emboss-settings', JSON.stringify(s)); } catch {} }, settings);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('  page error:', e.message));
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.lastBrf === 'string' && window.lastBrf.length > 0 && typeof window.importFile === 'function' && typeof window.exportCurrentDocumentXml === 'function', null, { timeout: 60000 });
  // the maths engine loads a moment after the first render: wait until the braille stops changing
  await settle(page, 2500);
  return { context, page };
}
/** Wait (at least minMs) until a forced re-render gives the same braille twice running. */
async function settle(page, minMs = 0) {
  const t0 = Date.now();
  let prev = null, same = 0;
  while (Date.now() - t0 < 40000) {
    const brf = await page.evaluate(async () => { await window.render(); return window.lastBrf; });
    same = brf === prev ? same + 1 : 0;
    prev = brf;
    if (same >= 2 && Date.now() - t0 >= minMs) return brf;
    await wait(350);
  }
  return prev;
}
const load = async (page, model) => { await page.evaluate(async (m) => { window.markDocumentClean && window.markDocumentClean(); window.modelToLexical(m); await window.render(); }, model); return settle(page); };
const loadXml = async (page, xml) => { await page.evaluate(async (x) => { window.markDocumentClean && window.markDocumentClean(); await window.importFile(new File([x], 'a.xml', { type: 'text/xml' })); }, xml); return settle(page); };
const snapshot = (page) => page.evaluate(() => ({ brf: window.lastBrf, xml: window.exportCurrentDocumentXml(), warnings: (window.lastWarnings || []).map((w) => ({ kind: w.kind, message: w.message })),
  blocks: (window.lastModel.blocks || []).map((b) => ({ type: b.type, text: b.text, items: b.items && b.items.map((i) => i.text), rows: b.rows, segs: b.segments && b.segments.map((s) => [s.type === 'math' ? 'M' : s.text, s.tf || 0]) })) }));
/** Save in `a`, open the saved file in a fresh editor, return both snapshots. */
async function saveReopen(a, settings = SETTINGS) {
  const first = await snapshot(a.page);
  const b = await openEditor(settings);
  try {
    await loadXml(b.page, first.xml);
    const second = await snapshot(b.page);
    return { first, second };
  } finally { await b.context.close(); }
}
const showDiff = (x, y) => { const A = x.split('\r\n'), B = y.split('\r\n'); for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) return `line ${i}: ${JSON.stringify(A[i])} / ${JSON.stringify(B[i])}`; return ''; };

try {
  // ------------------------------------------------------------------------------------------------ 6. empty blocks
  {
    const a = await openEditor();
    // keptEmpty: the empties arrive as the reader gives back ones a user made and saved (<p class="bana-empty"/>); a plain empty
    // paragraph in a model (a new box's, say) is left empty and not kept (the main session, 2 Oct: test-empty-containers).
    await load(a.page, { blocks: [
      { type: 'para', text: 'before' }, { type: 'pagenum', page: '3' }, { type: 'para', text: '', keptEmpty: true }, { type: 'pagenum', page: '1' }, { type: 'para', text: 'after' },
      { type: 'list', ordered: true, items: [{ text: 'a', marker: '1.' }, { text: '', marker: '2.', keptEmpty: true }, { text: 'c', marker: '3.' }] },
      { type: 'table', headers: ['H1', 'H2'], rows: [['a', 'b'], ['', ''], ['c', 'd']], format: 'spatial', style: 'table-spatial' },
    ] });
    const f = await snapshot(a.page);
    ok('empties: the first tab holds an empty paragraph, an empty list item and an empty table row', f.blocks.some((b) => b.type === 'para' && b.text === '') && f.blocks.some((b) => b.type === 'list' && b.items.includes('')) && f.blocks.some((b) => b.type === 'table' && b.rows.some((r) => r.every((c) => c === ''))), f.blocks);
    ok('empties: the saved file marks them class="bana-empty"', /<p class="bana-empty"><\/p>/.test(f.xml) && /<li class="bana-empty"><\/li>/.test(f.xml) && /<tr class="bana-empty">/.test(f.xml), f.xml.slice(f.xml.indexOf('<bodymatter')));
    const { second } = await saveReopen(a);
    ok('empties: the reopened tab has the same braille', second.brf === f.brf, showDiff(f.brf, second.brf));
    ok('empties: and the same blocks (empty ones included)', JSON.stringify(second.blocks) === JSON.stringify(f.blocks), [second.blocks, f.blocks]);
    const noUid = (x) => x.replace(/emboss-\d+/g, 'emboss-UID');
    ok('empties: saving the reopened document gives the same file', noUid(second.xml) === noUid(f.xml), showDiff(noUid(f.xml).replace(/>\s*</g, '>\r\n<'), noUid(second.xml).replace(/>\s*</g, '>\r\n<')));
    // typed, as a person makes one: Enter, Space, Enter
    await load(a.page, { blocks: [{ type: 'para', text: 'start' }] });
    const box = await a.page.locator('#editor').getByText('start', { exact: true }).first().boundingBox();
    await a.page.mouse.click(box.x + box.width + 40, box.y + box.height / 2);   // beyond the end of the line: the caret goes to its end
    await a.page.keyboard.press('Enter');
    await a.page.keyboard.press('Space');
    await a.page.keyboard.press('Enter');
    await a.page.keyboard.type('two');
    await settle(a.page);
    const typed = await snapshot(a.page);
    ok('empties: a typed empty paragraph (Enter, Space, Enter) is in the model', typed.blocks.map((b) => b.text).join('|') === 'start||two', typed.blocks);
    const re = await saveReopen(a);
    ok('empties: ... and survives save -> reopen', re.second.blocks.map((b) => b.text).join('|') === 'start||two' && re.second.brf === typed.brf, [re.second.blocks, showDiff(typed.brf, re.second.brf)]);
    await a.context.close();
  }

  // ------------------------------------------------------------------------------------------------ 7. edge spaces
  {
    const a = await openEditor();
    const T = (text, tf) => ({ type: 'text', text, tf: tf || 0 });
    await load(a.page, { blocks: [
      { type: 'para', text: 'zz' },
      { type: 'para', segments: [T(' / '), T('any', 4), T(' word here and the other way round.')] },
      { type: 'para', segments: [T('x '), T('howe ', 1)] },
      { type: 'heading', level: 1, segments: [T('quick '), T('b', 4), T(' ')] },
      { type: 'para', segments: [T(' lead', 1), T(' and more')] },
    ] });
    const f = await snapshot(a.page);
    const edge = f.blocks.filter((b) => b.segs && b.segs.some((s) => /^\s|\s$/.test(s[0]))).length;
    ok('edge spaces: the first tab keeps the spaces at the edges of its paragraphs and heading', edge >= 3, f.blocks);
    ok('edge spaces: the saved file says they are meant (xml:space="preserve")', (f.xml.match(/xml:space="preserve"/g) || []).length >= 3, f.xml.slice(f.xml.indexOf('<bodymatter')));
    const { second } = await saveReopen(a);
    ok('edge spaces: the reopened tab has the same braille', second.brf === f.brf, showDiff(f.brf, second.brf));
    const runs = (blocks) => JSON.stringify(blocks.map((b) => b.segs && b.segs.reduce((o, s) => { const l = o[o.length - 1]; if (l && l[1] === s[1] && s[0] !== 'M' && l[0] !== 'M') l[0] += s[0]; else o.push([...s]); return o; }, [])));
    ok('edge spaces: and the same runs, spaces included', runs(second.blocks) === runs(f.blocks), [runs(second.blocks), runs(f.blocks)]);
    await a.context.close();
  }

  // ------------------------------------------------------------------------------------------------ 8. TeX-only equations
  {
    const TEX = 'f(x) = \\int_{-\\infty}^{\\infty} e^{-x^2} dx';
    const BAD = '\\frac{a}{b';
    const doc = (body) => `<?xml version="1.0" encoding="UTF-8"?>\n<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML"><head><meta name="dc:Title" content="T"/></head><book><bodymatter><level1><h1>Equations</h1>${body}</level1></bodymatter></book></dtbook>`;
    const texOnly = (tex) => `<m:math alttext="${tex}"><m:semantics><m:annotation encoding="application/x-tex">${tex}</m:annotation></m:semantics></m:math>`;
    for (const mode of ['bana', 'ukaaf']) {
      const settings = { ...SETTINGS, mode };
      const a = await openEditor(settings);
      const blank = await loadXml(a.page, doc('<p>nothing here</p>'));
      await loadXml(a.page, doc(`<p>Take ${texOnly('a_1+b')} as given.</p>${texOnly(TEX)}`));
      const f = await snapshot(a.page);
      // the same equation as presentation MathML (what Temml gives), as the editor gets it from any other source
      const ref = await a.page.evaluate(async (tex) => { window.markDocumentClean && window.markDocumentClean(); const mathml = globalThis.temml.renderToString(tex); window.modelToLexical({ blocks: [{ type: 'heading', level: 1, text: 'Equations' }, { type: 'para', segments: [{ type: 'text', text: 'Take ' }, { type: 'math', mathml: globalThis.temml.renderToString('a_1+b'), latex: 'a_1+b' }, { type: 'text', text: ' as given.' }] }, { type: 'math', mathml, latex: tex }] }); await window.render(); return null; }, TEX);
      const refBrf = await settle(a.page);
      ok(`TeX-only [${mode}]: the equations are brailled (the editor left them out before)`, f.brf !== blank && f.brf.replace(/\s/g, '').length > blank.replace(/\s/g, '').length + 20, showDiff(blank, f.brf));
      ok(`TeX-only [${mode}]: the braille is that of the same equations as presentation MathML`, f.brf === refBrf, showDiff(f.brf, refBrf));
      ok(`TeX-only [${mode}]: no equation is flagged unreadable`, !f.warnings.some((w) => w.kind === 'math-unreadable'), f.warnings);
      // save -> reopen, from the first tab's own state
      await loadXml(a.page, doc(`<p>Take ${texOnly('a_1+b')} as given.</p>${texOnly(TEX)}`));
      const { second } = await saveReopen(a, settings);
      ok(`TeX-only [${mode}]: the saved file keeps the TeX annotation and the MathML`, /encoding="application\/x-tex">f\(x\) = \\int_/.test(f.xml) && /<m:msubsup|<m:msup/.test(f.xml) && !/<m:mtext>f\(x\)/.test(f.xml), f.xml.slice(f.xml.indexOf('<bodymatter'), f.xml.indexOf('<bodymatter') + 900));
      ok(`TeX-only [${mode}]: the reopened tab has the same braille`, second.brf === f.brf, showDiff(f.brf, second.brf));
      await a.context.close();

      // TeX that cannot be converted
      const u = await openEditor(settings);
      await loadXml(u.page, doc(`<p>before</p>${texOnly(BAD)}<p>after</p>`));
      const g = await snapshot(u.page);
      ok(`TeX-only [${mode}]: TeX Temml cannot convert is brailled as a transcriber's note`, g.brf.replace(/[\r\n\f]/g, '').includes('@.<'), g.brf.split('\r\n').slice(0, 8));
      ok(`TeX-only [${mode}]: ... and flagged in the transcription warnings (math-unreadable)`, g.warnings.filter((w) => w.kind === 'math-unreadable').length === 1, g.warnings);
      const again = await saveReopen(u, settings);
      ok(`TeX-only [${mode}]: ... it reopens the same (braille and flag)`, again.second.brf === g.brf && again.second.warnings.filter((w) => w.kind === 'math-unreadable').length === 1, [showDiff(g.brf, again.second.brf), again.second.warnings]);
      ok(`TeX-only [${mode}]: ... and the TeX stays in the saved file`, g.xml.includes('application/x-tex">' + BAD), g.xml.slice(g.xml.indexOf('<bodymatter')));
      await u.context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`\n=== A89 editor save -> reopen [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) { console.error('Failures:', failures); process.exit(1); }
console.log('All A89 editor save -> reopen checks passed.');
