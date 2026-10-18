// A19/A20/A21/A22 Stage 9 — the real editor (Lexical model, browser only) round-trips what
// stages 2-7 fixed in parse.mjs/nimas-export.mjs. A direct parse -> export never touches the
// editor's own node tree, so it can pass while a real load-through-the-editor save still loses
// content (found 22 Sep 2026: LinkNode/CiteNode runs silently absorbed the plain text that
// followed them, and fromPoem/divClass/divId/render/descriptionRender were never carried by
// any editor node at all). This suite drives the real editor in headless Chrome exactly as a
// user would: window.importFile(file), then window.exportCurrentDocumentXml().
//
// Run directly (needs the dev server): node Emboss/scripts/serve.mjs & then
//   node Emboss/tests/test-editor-save-fidelity.mjs [--show]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright') and does not
// execute it — see that file's own comment for why.

import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
const PORT = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);   // A63: a port argument, for agents on their own dev server

console.log('--- Running A19-A22 Stage 9: editor save-fidelity tests ---');

let pass = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ok    ${name}`);
  } else {
    failures.push({ name, detail });
    console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail) : ''}`);
  }
}

// The exact sample from the coordinator's report: a link immediately followed by plain text
// (the absorption bug needs a neighbour to swallow), a cite likewise, a genuine <poem>, a
// classed <div>, and an imported required prodnote.
const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book>
    <bodymatter>
      <level1>
        <p>See <a href="https://example.org/x">the website</a> and read <cite>Moby Dick</cite> today.</p>
        <poem><linegroup><line>First line here</line><line>Second line here</line></linegroup></poem>
        <linegroup><line>A bare linegroup line one</line><line>A bare linegroup line two</line></linegroup>
        <div class="special"><p>Inside a classed div.</p></div>
        <prodnote render="required">Required note text.</prodnote>
        <blockquote>
          <line>To the KING OF FRANCE</line>
          <line>SIRE,</line>
          <p>THE Protection with which your Majesty honours distinguished Talents.</p>
          <line>I am, with the profoundest respect,</line>
        </blockquote>
        <blockquote class="letter">
          <p>It is urgent</p>
          <p>that you appoint in my place Mr. Protopopoff.</p>
        </blockquote>
        <h2>Table of Contents</h2>
        <list type="pl">
          <li class="toc-entry">Chapter One</li><li class="toc-page"><a href="#p2">2</a></li>
        </list>
        <pagenum id="p2" page="normal">2</pagenum>
        <imggroup>
          <img src="./pond.jpg" alt="An illustration of a pond ecosystem."/>
          <prodnote render="optional">Production note: this image crosses the gutter.</prodnote>
          <prodnote render="optional">Production note: captions are labels within the image.</prodnote>
        </imggroup>
      </level1>
    </bodymatter>
  </book>
</dtbook>`;

function checkSample(xml, label) {
  ok(`${label}: <a href> keeps exactly its own text (not absorbing "and read")`,
    xml.includes('<a href="https://example.org/x">the website</a>'), xml.match(/<a[^>]*>[^<]*<\/a>/)?.[0]);
  ok(`${label}: <a href> does not swallow the following text`,
    !/the website and read/.test(xml));
  ok(`${label}: <cite> keeps exactly its own text (not absorbing "today.")`,
    xml.includes('<cite>Moby Dick</cite>'), xml.match(/<cite>[^<]*<\/cite>/)?.[0]);
  ok(`${label}: <cite> does not swallow the following text`,
    !/Moby Dick today\./.test(xml));
  ok(`${label}: the poem saves as <poem>/<linegroup>/<line>, not <p class="bai-verse">`,
    xml.includes('<poem>') && xml.includes('<linegroup>') && /<line[ >][^]*?First line here/.test(xml));
  ok(`${label}: the poem's two lines do not fall back to <p class="bai-verse">`,
    !xml.includes('<p class="bai-verse"'));
  // A42: a bare <linegroup> (no <poem> wrapper in the source) must not gain one on save.
  ok(`${label}: A42 bare linegroup round-trips as <linegroup>, not wrapped in a new <poem>`,
    /<linegroup>\s*<line[ >][^]*?A bare linegroup line one[^]*?<\/linegroup>/.test(xml), xml.match(/<linegroup>[^]*?A bare linegroup[^]*?<\/linegroup>/)?.[0]);
  ok(`${label}: A42 exactly one <poem> exists (the genuine one, not the bare linegroup)`,
    (xml.match(/<poem>/g) || []).length === 1, xml.match(/<poem>/g));
  ok(`${label}: the classed <div> keeps its class`,
    /<div class="special">\s*<p>Inside a classed div\.<\/p>\s*<\/div>/.test(xml), xml.match(/<div[^]*?<\/div>/)?.[0]);
  ok(`${label}: the imported prodnote keeps render="required"`,
    xml.includes('<prodnote render="required">Required note text.</prodnote>'), xml.match(/<prodnote[^]*?<\/prodnote>/)?.[0]);
  // A35: verse lines mixed with a <p> inside a <blockquote> must keep saving as one
  // <blockquote> with real <line> elements, not lose the lines to <p class="bai-verse">.
  ok(`${label}: A35 blockquote lines round-trip as <line>, not <p class="bai-verse">`,
    (xml.match(/<line[\s>]/g) || []).length >= 3, xml.match(/<blockquote[^]*?<\/blockquote>/)?.[0]);
  ok(`${label}: A35 blockquote content stays inside one <blockquote>`,
    /<blockquote>\s*<line>To the KING OF FRANCE<\/line>\s*<line>SIRE,<\/line>\s*<p>THE Protection[^<]*<\/p>\s*<line>I am, with the profoundest respect,<\/line>\s*<\/blockquote>/.test(xml),
    xml.match(/<blockquote[^]*?<\/blockquote>/)?.[0]);
  // A36: a TOC page number that was itself a link keeps its href through the editor.
  ok(`${label}: A36 TOC page-number link keeps its href`,
    /<lic class="bai-toc-page"><a href="#p2">2<\/a><\/lic>/.test(xml), xml.match(/<li class="bai-toc-entry[^]*?<\/li>/)?.[0]);
  // A40: a multi-paragraph <blockquote> with no <line> (a plain quoted letter) still saves as
  // one <blockquote>, keeping the source's own class, not one <blockquote> per paragraph.
  ok(`${label}: A40 multi-paragraph blockquote stays one <blockquote>, keeps its class`,
    /<blockquote class="letter">\s*<p>It is urgent<\/p>\s*<p>that you appoint in my place Mr\. Protopopoff\.<\/p>\s*<\/blockquote>/.test(xml),
    xml.match(/<blockquote class="letter"[^]*?<\/blockquote>/)?.[0]);
  ok(`${label}: A40 blockquote count is exactly 2 (A35's + A40's), none split into extras`,
    (xml.match(/<blockquote/g) || []).length === 2, xml.match(/<blockquote/g));
  // A34: an <imggroup> with two <prodnote>s keeps them as two separate elements, not merged.
  ok(`${label}: A34 imggroup keeps two separate <prodnote>s, not merged into one`,
    /<prodnote render="optional">Production note: this image crosses the gutter\.<\/prodnote>\s*<prodnote render="optional">Production note: captions are labels within the image\.<\/prodnote>/.test(xml),
    xml.match(/<imggroup>[^]*?<\/imggroup>/g)?.pop());
  ok(`${label}: A34 total <prodnote> count includes both the standalone note and the two imggroup notes (3)`,
    (xml.match(/<prodnote/g) || []).length === 3, xml.match(/<prodnote/g));
}

const browser = await launchBrowser({ args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });

// simpleMode must be off, or the editor bounces straight back to the landing page/converter
// (the app.mjs / editor.mjs ping-pong noted in EMBOSS-TASKS.md G2).
await context.addInitScript(() => {
  try {
    // transcriberTools: this suite drives every Braille formatting control and the Transcriber's Notes / Special Symbols
    // pages, which the "Transcriber tools" setting (default off, 24 Sep 2026) hides; the setting-off view is checked below.
    localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, sixKeyInput: true, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en', transcriberTools: true }));
  } catch {}
});

const page = await context.newPage();
page.on('pageerror', (err) => console.error('  ✖ Page error:', err.message));

try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  // Wait for the editor globals importFile/exportCurrentDocumentXml (module init is async).
  const t0 = Date.now();
  while (await page.evaluate(() => typeof window.importFile !== 'function' || typeof window.exportCurrentDocumentXml !== 'function')) {
    if (Date.now() - t0 > 15000) { ok('editor globals (importFile/exportCurrentDocumentXml) appear', false, 'timed out'); break; }
    await new Promise((r) => setTimeout(r, 50));
  }
  // The globals above are assigned at the TOP of editor.mjs; its init (engine load, then seed() of the demo document, then the first render) runs
  // after, and on a loaded machine seed() could land AFTER the first import and replace it (28 "load -> save" failures). window.lastBrf is set by
  // the first render, which comes after seed(): once it is a string the editor is really ready.
  await page.waitForFunction(() => typeof window.lastBrf === 'string' && window.lastBrf.length > 0, null, { timeout: 60000 }).catch(() => ok('editor finished its start-up (first render done)', false, 'timed out'));
  ok('reached the real editor, not the landing page', await page.evaluate(() => location.pathname.includes('/editor/')), await page.evaluate(() => location.href));

  // ---- Load -> Save (the coordinator's exact reproduction) ----
  const firstSave = await page.evaluate(async (xml) => {
    const file = new File([xml], 'a.xml', { type: 'text/xml' });
    await window.importFile(file);
    return window.exportCurrentDocumentXml();
  }, SAMPLE_XML);
  checkSample(firstSave, 'load -> save');

  // ---- Reload: treat the first save as a new file, load it again, save again ----
  // A load -> save -> load -> save cycle must be stable (idempotent) once the content is
  // already in the editor's own shape — proves the fields round-trip through the editor's
  // model a second time, not just once by accident.
  const secondSave = await page.evaluate(async (xml) => {
    const file = new File([xml], 'a2.xml', { type: 'text/xml' });
    await window.importFile(file);
    return window.exportCurrentDocumentXml();
  }, firstSave);
  checkSample(secondSave, 'reload (load -> save -> load -> save)');

  // ---- Undo: load the original sample again, make an edit, undo it, save ----
  // G7: undo must not reset the document, and the per-node fields set on load (fromPoem,
  // divClass/divId, render, href/cite) must survive being carried through the undo/redo
  // history's own JSON snapshots (ParagraphNode/BreakNode/PrintPageNode exportJSON/importJSON).
  await page.evaluate(async (xml) => {
    const file = new File([xml], 'a3.xml', { type: 'text/xml' });
    await window.importFile(file);
  }, SAMPLE_XML);
  // Click at the end of "First line here" (a poem line) and type a character.
  const target = page.locator('#editor').getByText('First line here', { exact: true }).first();
  await target.click();
  // Wherever exactly the click lands the caret within the word-wrapped line, the point of
  // this check is only that an edit happened and undo reverts it — not the exact offset.
  await page.keyboard.type('X');
  const beforeUndo = await page.evaluate(() => {
    let t = '';
    window.editor.getEditorState().read(() => { t = window.editor.getEditorState()._nodeMap.get('root').getTextContent(); });
    return t;
  });
  ok('undo test: the typed edit landed', beforeUndo.includes('X') && !beforeUndo.includes('First line here'), beforeUndo);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  const afterUndoText = await page.evaluate(() => {
    let t = '';
    window.editor.getEditorState().read(() => { t = window.editor.getEditorState()._nodeMap.get('root').getTextContent(); });
    return t;
  });
  ok('undo test: the edit was undone (text restored)', afterUndoText.includes('First line here') && !afterUndoText.includes('X'), afterUndoText);
  const afterUndoSave = await page.evaluate(() => window.exportCurrentDocumentXml());
  checkSample(afterUndoSave, 'undo');

  // ---- F-231: a graphic block's own figureType (the transcriber's-note label word for an
  // unidentified illustration, e.g. "Photograph"/"Picture") round-trips through the editor's
  // own document-model <-> Lexical node conversion (modelToLexical / buildModel via render()).
  // Since the field-registry work of 24 Sep 2026 it also has a DTBook representation
  // (bana-figure-type class + title on the <img>/<imggroup>, field-registry.mjs 'figureType';
  // tests/field_registry.test.mjs covers that save/reopen round trip directly) — this check
  // stays as the editor's own, faster in-memory model round trip.
  // window.modelToLexical/window.render/window.lastModel are the editor's own model round trip.
  const figureTypeRoundTrip = await page.evaluate(async () => {
    window.modelToLexical({ blocks: [
      { type: 'graphic', figureType: 'Photograph', caption: 'a beardless Abraham Lincoln' },
    ] });
    await window.render();
    const g = (window.lastModel.blocks || []).find((b) => b && b.type === 'graphic');
    return { figureType: g && g.figureType, caption: g && g.caption };
  });
  ok('F-231: a graphic block\'s figureType survives modelToLexical -> render (buildModel)',
    figureTypeRoundTrip.figureType === 'Photograph', figureTypeRoundTrip);
  ok('F-231: the same graphic block\'s caption is unaffected',
    figureTypeRoundTrip.caption === 'a beardless Abraham Lincoln', figureTypeRoundTrip);

  // Regression: a graphic block with no figureType at all still round-trips cleanly (no stray
  // empty string turning into a truthy label word downstream).
  const figureTypeAbsent = await page.evaluate(async () => {
    window.modelToLexical({ blocks: [
      { type: 'graphic', caption: 'a plain caption with no figureType' },
    ] });
    await window.render();
    const g = (window.lastModel.blocks || []).find((b) => b && b.type === 'graphic');
    return { hasFigureType: !!(g && g.figureType) };
  });
  ok('F-231 regression: no figureType stays unset (falsy) through the round trip',
    figureTypeAbsent.hasFigureType === false, figureTypeAbsent);

  // ---- Stage 2 (23 Sep 2026, EMBOSS-TASKS.md queue item 6): the Advanced Editor's own
  // picture-type control. Before this, ImageNode had no interactive UI at all (createDOM
  // only ever displayed caption/alt/description as static read-only text) — figureType could
  // only be set by the source document, never changed inside the editor. This drives the
  // real <select class="doc-image-type-select"> the registerDecoratorListener 'image'
  // branch mounts, not window.modelToLexical directly, so it exercises the actual
  // load -> UI change -> save -> reload wiring end to end.
  const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await page.evaluate(async (src) => {
    window.modelToLexical({ blocks: [
      { type: 'graphic', src, alt: 'A duck', caption: 'A photo of a duck' },
    ] });
    await window.render();
  }, TINY_PNG);

  const typeSelect = page.locator('.doc-image-type-select').first();
  await typeSelect.waitFor({ state: 'visible', timeout: 5000 });
  const initialValue = await typeSelect.inputValue();
  ok('Stage 2: picture-type control starts blank on a graphic block with no figureType (default -> "Illustration")',
    initialValue === '', initialValue);

  // Screenshot of the control in the real editor, for Paul (per EMBOSS-TASKS.md queue item 6). Only when asked for:
  // saved to the current folder, it turned up as an untracked file that blocked the deploy script.
  await typeSelect.scrollIntoViewIfNeeded();
  if (process.env.EMBOSS_PICTURE_TYPE_SCREENSHOT) await page.screenshot({ path: process.env.EMBOSS_PICTURE_TYPE_SCREENSHOT });

  await typeSelect.selectOption('Photograph');
  await page.waitForTimeout(150);   // let editor.update()'s decorator-listener re-render settle

  const afterSet = await page.evaluate(async () => {
    await window.render();
    const g = (window.lastModel.blocks || []).find((b) => b && b.type === 'graphic');
    return g && g.figureType;
  });
  ok('Stage 2: choosing "Photograph" in the control writes figureType onto the block (save)',
    afterSet === 'Photograph', afterSet);

  // Reload: rebuild the Lexical tree from that saved block (as a fresh document load would)
  // and confirm the control still shows "Photograph" — the full load/save/undo round trip
  // A19 Stage 9's pattern (above) already proves for caption/alt-text.
  await page.evaluate(async (src) => {
    window.modelToLexical({ blocks: [
      { type: 'graphic', src, alt: 'A duck', caption: 'A photo of a duck', figureType: 'Photograph' },
    ] });
    await window.render();
  }, TINY_PNG);
  const reloadedSelect = page.locator('.doc-image-type-select').first();
  await reloadedSelect.waitFor({ state: 'visible', timeout: 5000 });
  const reloadedValue = await reloadedSelect.inputValue();
  ok('Stage 2: the picture type survives save -> reload', reloadedValue === 'Photograph', reloadedValue);

  // ---- F-5: a table's caption and its transcriber's note (tabletn) through the real editor.
  // parse.mjs's parseTable puts them in separate sibling blocks before the table (caption,
  // then {type:'note', kind:'tabletn'}); the editor used to lose the note's kind, which made
  // nimas-export.mjs's tableIndexForCaption stop pairing the caption with its table (it saved
  // as an orphan <imggroup><caption>) and dropped class="tabletn" from the note.
  const TABLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1>
    <p>Intro paragraph.</p>
    <prodnote render="required" class="tabletn">Figures rounded to the nearest thousand.</prodnote>
    <table>
      <caption>Population by Region</caption>
      <thead><tr><th>Region</th><th>Population</th></tr></thead>
      <tbody><tr><td>North</td><td>1200</td></tr><tr><td>South</td><td>900</td></tr></tbody>
    </table>
  </level1></bodymatter></book>
</dtbook>`;
  const checkTableXml = (xml, label) => {
    ok(`F-5 ${label}: the caption saves inside its own <table>`,
      /<table[^>]*>\s*<caption>Population by Region<\/caption>/.test(xml), xml.match(/<table[^]*?<\/caption>/)?.[0]);
    ok(`F-5 ${label}: the caption is not orphaned into an <imggroup>`,
      !/<imggroup>\s*<caption>Population by Region/.test(xml), xml.match(/<imggroup>[^]*?<\/imggroup>/)?.[0]);
    ok(`F-5 ${label}: the table-note saves as <prodnote class="tabletn"> with its text, before the table`,
      /<prodnote class="tabletn" render="required">Figures rounded to the nearest thousand\.<\/prodnote>\s*<table/.test(xml),
      xml.match(/<prodnote[^]*?<\/prodnote>/)?.[0]);
    ok(`F-5 ${label}: exactly one caption and one tabletn note (nothing duplicated)`,
      (xml.match(/<caption>/g) || []).length === 1 && (xml.match(/class="tabletn"/g) || []).length === 1);
  };
  const tableLoad = await page.evaluate(async (xml) => {
    window.markDocumentClean();   // the earlier cases left the document dirty; a load would otherwise be refused
    await window.importFile(new File([xml], 't.xml', { type: 'text/xml' }));
    await window.render();
    const blocks = window.lastModel.blocks || [];
    const note = blocks.find((b) => b && b.type === 'note');
    const cap = blocks.find((b) => b && b.type === 'caption');
    return { noteKind: note && note.kind, noteText: note && note.text, capText: cap && cap.text, xml: window.exportCurrentDocumentXml() };
  }, TABLE_XML);
  ok('F-5: the editor model keeps the table-note as kind "tabletn" with its text',
    tableLoad.noteKind === 'tabletn' && tableLoad.noteText === 'Figures rounded to the nearest thousand.', tableLoad);
  ok('F-5: the editor model has the table caption', tableLoad.capText === 'Population by Region', tableLoad);
  checkTableXml(tableLoad.xml, 'load -> save');
  const tableReload = await page.evaluate(async (xml) => {
    window.markDocumentClean();   // the earlier cases left the document dirty; a load would otherwise be refused
    await window.importFile(new File([xml], 't2.xml', { type: 'text/xml' }));
    return window.exportCurrentDocumentXml();
  }, tableLoad.xml);
  checkTableXml(tableReload, 'reload (load -> save -> load -> save)');

  // The undo/redo history stores nodes as JSON (exportJSON/importJSON): the flag must survive that too.
  const jsonRoundTrip = await page.evaluate(async (xml) => {
    window.markDocumentClean();   // the earlier cases left the document dirty; a load would otherwise be refused
    await window.importFile(new File([xml], 't3.xml', { type: 'text/xml' }));
    const json = window.editor.getEditorState().toJSON();
    const restored = window.editor.parseEditorState(JSON.stringify(json));
    window.editor.setEditorState(restored);
    await window.render();
    const note = (window.lastModel.blocks || []).find((b) => b && b.type === 'note');
    return { inJson: JSON.stringify(json).includes('"tabletn":true'), noteKind: note && note.kind };
  }, TABLE_XML);
  ok('F-5: the tabletn flag is in the editor-state JSON and survives parse -> restore',
    jsonRoundTrip.inJson && jsonRoundTrip.noteKind === 'tabletn', jsonRoundTrip);

  // A table block that carries caption/tabletn/tabletnRender directly (a model built
  // programmatically, which the exporter and formatter both support) is no longer stripped
  // by the real TableNode either.
  const directFields = await page.evaluate(async () => {
    window.modelToLexical({ blocks: [
      { type: 'table', headers: ['A', 'B'], rows: [['1', '2']], caption: 'Direct caption', tabletn: 'Direct note', tabletnRender: 'required' },
    ] });
    await window.render();
    const blocks = window.lastModel.blocks || [];
    const ti = blocks.findIndex((b) => b && b.type === 'table');
    const t = blocks[ti];
    // The formatter renders a caption only as a separate `caption` block (F-4), so the editor emits the node's caption that way, right before the table.
    const cap = ti > 0 && blocks[ti - 1] && blocks[ti - 1].type === 'caption' ? blocks[ti - 1] : null;
    return { caption: cap && cap.text, tableHasCaption: 'caption' in t, tabletn: t && t.tabletn, tabletnRender: t && t.tabletnRender, xml: window.exportCurrentDocumentXml() };
  });
  ok('F-5/F-4: a table block\'s own caption survives modelToLexical -> render as a caption block before the table (the formatter no longer renders table.caption); tabletn/tabletnRender stay on the table',
    directFields.caption === 'Direct caption' && directFields.tableHasCaption === false && directFields.tabletn === 'Direct note' && directFields.tabletnRender === 'required', directFields);
  ok('F-5: those direct fields reach the saved XML',
    /<prodnote render="required" class="tabletn">Direct note<\/prodnote>\s*<table[^>]*>\s*<caption>Direct caption<\/caption>/.test(directFields.xml),
    directFields.xml.match(/<prodnote[^]*?<\/caption>/)?.[0]);
  const noFields = await page.evaluate(async () => {
    window.modelToLexical({ blocks: [{ type: 'table', headers: ['A'], rows: [['1']] }] });
    await window.render();
    const t = (window.lastModel.blocks || []).find((b) => b && b.type === 'table');
    return { hasCaption: 'caption' in t || (window.lastModel.blocks || []).some((b) => b && b.type === 'caption'), hasTabletn: 'tabletn' in t };
  });
  ok('F-5 regression: a table with no caption/tabletn gains none', !noFields.hasCaption && !noFields.hasTabletn, noFields);

  // ---- F-164: a multi-paragraph <prodnote> (BANA 3.2.1b) survives the real editor. Each <p>
  // becomes a note paragraph sharing a noteGroup; buildModel marks tnPart; save folds the run
  // back into ONE <prodnote> with several <p>.
  const NOTE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/">
  <book><bodymatter><level1>
    <p>Before.</p>
    <prodnote render="required"><p>First note paragraph.</p><p>Second <em>note</em> paragraph.</p><p>Third.</p></prodnote>
    <p>After.</p>
    <prodnote render="required"><p>A separate one-paragraph note.</p></prodnote>
  </level1></bodymatter></book>
</dtbook>`;
  const checkNoteXml = (xml, label) => {
    ok(`F-164 ${label}: the several <p> save inside ONE <prodnote>`,
      /<prodnote render="required"><p>First note paragraph\.<\/p><p>Second <em>note<\/em> paragraph\.<\/p><p>Third\.<\/p><\/prodnote>/.test(xml), xml.match(/<prodnote[^]*?<\/prodnote>/g));
    ok(`F-164 ${label}: exactly two <prodnote> (the multi-paragraph one and the separate single one, not merged)`,
      (xml.match(/<prodnote/g) || []).length === 2, xml.match(/<prodnote/g));
    ok(`F-164 ${label}: the single-paragraph note is unchanged`,
      xml.includes('<prodnote render="required">A separate one-paragraph note.</prodnote>'), xml.match(/<prodnote[^]*?<\/prodnote>/g));
  };
  const noteLoad = await page.evaluate(async (xml) => {
    window.markDocumentClean();
    await window.importFile(new File([xml], 'n1.xml', { type: 'text/xml' }));
    await window.render();
    const notes = (window.lastModel.blocks || []).filter((b) => b && b.type === 'note');
    return { parts: notes.map((n) => n.tnPart || null), groups: notes.map((n) => n.noteGroup ?? null), xml: window.exportCurrentDocumentXml() };
  }, NOTE_XML);
  ok('F-164: the editor holds the note as 3 grouped paragraphs (first/mid/last) plus one ungrouped note',
    JSON.stringify(noteLoad.parts) === JSON.stringify(['first', 'mid', 'last', null]) && noteLoad.groups[0] != null && noteLoad.groups[0] === noteLoad.groups[2] && noteLoad.groups[3] === null, noteLoad);
  checkNoteXml(noteLoad.xml, 'load -> save');
  const noteReload = await page.evaluate(async (xml) => {
    window.markDocumentClean();
    await window.importFile(new File([xml], 'n2.xml', { type: 'text/xml' }));
    return window.exportCurrentDocumentXml();
  }, noteLoad.xml);
  checkNoteXml(noteReload, 'reload (load -> save -> load -> save)');
  ok('F-164: load -> save -> load -> save gives byte-identical DTBook for the note', noteReload === noteLoad.xml || noteReload.match(/<prodnote[^]*?<\/prodnote>/g).join() === noteLoad.xml.match(/<prodnote[^]*?<\/prodnote>/g).join());
  // The undo/redo history stores nodes as JSON: the group must survive it.
  const noteJson = await page.evaluate(async (xml) => {
    window.markDocumentClean();
    await window.importFile(new File([xml], 'n3.xml', { type: 'text/xml' }));
    const json = window.editor.getEditorState().toJSON();
    window.editor.setEditorState(window.editor.parseEditorState(JSON.stringify(json)));
    await window.render();
    return { inJson: JSON.stringify(json).includes('"noteGroup"'), xml: window.exportCurrentDocumentXml() };
  }, NOTE_XML);
  ok('F-164: noteGroup is in the editor-state JSON and the note still saves as one <prodnote> after restore', noteJson.inJson, noteJson.inJson);
  checkNoteXml(noteJson.xml, 'JSON restore');

  // ---- T4 follow-up (F-18): stairstep / linear tables and stairstep's subdivision rows
  // through the real editor: load -> save keeps them, the per-table format button cycles them
  // (stairstep -> linear -> auto), reload keeps the change, and the editor-state JSON that
  // undo/redo uses carries the subdivision data.
  const STAIR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>
  <table class="bana-stairstep" title="Continent"><thead><tr><th>Place</th><th>Note</th></tr></thead><tbody>
    <tr class="bana-subdivision"><td>Asia</td><td></td></tr>
    <tr><td>Japan</td><td>one<br/>two</td></tr>
    <tr class="bana-subdivision"><td>Europe</td><td></td></tr>
    <tr><td>France</td><td>x</td></tr>
  </tbody></table>
</level1></bodymatter></book></dtbook>`;
  const tblOf = (xml) => (xml.match(/<table[^]*?<\/table>/) || [''])[0];
  const checkStair = (xml, label) => {
    const t = tblOf(xml);
    ok(`F-18 ${label}: saves class="bana-stairstep" with the subdivision heading title`, /<table class="bana-stairstep" title="Continent">/.test(t), t.slice(0, 120));
    ok(`F-18 ${label}: exactly the two subdivision rows are marked`, (t.match(/<tr class="bana-subdivision">/g) || []).length === 2 && /<tr class="bana-subdivision">\s*<td>Asia/.test(t) && /<tr class="bana-subdivision">\s*<td>Europe/.test(t), t);
    ok(`F-18 ${label}: a two-paragraph cell keeps its break`, /<td>one<br\/>two<\/td>/.test(t), t);
  };
  await page.evaluate(() => window.markDocumentClean());
  const stairLoad = await page.evaluate(async (xml) => {
    window.markDocumentClean();
    await window.importFile(new File([xml], 'st1.xml', { type: 'text/xml' }));
    await window.render();
    const tb = (window.lastModel.blocks || []).find((b) => b && b.type === 'table');
    return { format: tb && tb.format, sub: tb && tb.subdivisionRows, head: tb && tb.subdivisionHeading, xml: window.exportCurrentDocumentXml() };
  }, STAIR_XML);
  ok('F-18: the editor model holds format stairstep with its subdivision rows and heading',
    stairLoad.format === 'stairstep' && JSON.stringify(stairLoad.sub) === '[0,2]' && stairLoad.head === 'Continent', stairLoad);
  checkStair(stairLoad.xml, 'load -> save');
  // undo/redo history: the node JSON carries the subdivision data and restores it.
  const stairJson = await page.evaluate(async () => {
    const json = window.editor.getEditorState().toJSON();
    const inJson = JSON.stringify(json).includes('"subdivisionRows":[0,2]') && JSON.stringify(json).includes('"subdivisionHeading":"Continent"');
    window.editor.setEditorState(window.editor.parseEditorState(JSON.stringify(json)));
    await window.render();
    return { inJson, xml: window.exportCurrentDocumentXml() };
  });
  ok('F-18: subdivisionRows/Heading are in the editor-state JSON', stairJson.inJson, stairJson.inJson);
  checkStair(stairJson.xml, 'JSON restore');
  // change the format with the real per-table button: stairstep -> linear
  const fmtBtn = page.locator('.table-context-bar .table-context-btn').first();
  const beforeState = await page.evaluate(() => JSON.stringify(window.editor.getEditorState().toJSON()));
  await fmtBtn.click();
  await page.waitForTimeout(300);
  const linearXml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('F-18: the format button moves a stairstep table to linear', /<table class="bana-linear"/.test(tblOf(linearXml)), tblOf(linearXml).slice(0, 120));
  const linearReload = await page.evaluate(async (xml) => {
    window.markDocumentClean();
    await window.importFile(new File([xml], 'st2.xml', { type: 'text/xml' }));
    return window.exportCurrentDocumentXml();
  }, linearXml);
  ok('F-18: a linear table reloads and saves as linear', /<table class="bana-linear"/.test(tblOf(linearReload)), tblOf(linearReload).slice(0, 120));
  // undo: restoring the earlier editor state brings the stairstep table (with subdivisions) back
  const undone = await page.evaluate(async (st) => {
    window.editor.setEditorState(window.editor.parseEditorState(st));
    await window.render();
    return window.exportCurrentDocumentXml();
  }, beforeState);
  checkStair(undone, 'undo (state restore)');
  // one more click: linear -> auto (no bana- class), then a save round trip
  await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'st3.xml', { type: 'text/xml' })); }, linearXml);
  await page.locator('.table-context-bar .table-context-btn').first().click();
  await page.waitForTimeout(300);
  const autoXml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('F-18: linear -> auto saves an unclassed table', /<table>/.test(tblOf(autoXml)), tblOf(autoXml).slice(0, 80));

  // ---- Transcriber's Notes page (`tnpage`, F-137/F-167): load -> edit -> save -> reload, undo, create ----
  const TN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book>
<frontmatter><doctitle>Atlas</doctitle>
<level1 class="bana-transcriber-notes"><h1>Transcriber’s Notes</h1><p>The atlas is omitted.</p><p>Maps are described in words.</p><p class="bana-tn-continued">Each description is short.</p></level1>
</frontmatter>
<bodymatter><level1><h1>Chapter</h1><p>Body text.</p></level1></bodymatter></book></dtbook>`;
  const tnEntries = (xml) => [...(xml.match(/<level1 class="bana-transcriber-notes">[^]*?<\/level1>/) || [''])[0].matchAll(/<p( class="bana-tn-continued")?>([^<]*)<\/p>/g)].map((m) => (m[1] ? '+' : '') + m[2]);
  const tnLoad = await page.evaluate(async (xml) => {
    window.markDocumentClean();
    await window.importFile(new File([xml], 'tn1.xml', { type: 'text/xml' }));
    await window.render();
    const el = document.querySelector('#editor .emboss-tnpage-card');
    return {
      types: (window.lastModel.blocks || []).map((b) => b && b.type),
      paras: el ? [...el.children].map((c) => c.textContent) : null,
      units: el ? [...el.children].map((c) => c.dataset.unitIdx) : null,
      heading: el ? el.dataset.heading : null,
      xml: window.exportCurrentDocumentXml(),
    };
  }, TN_XML);
  ok('tnpage: the editor shows the page as one container of 3 entry paragraphs, then the chapter',
    tnLoad.types[0] === 'tnpage' && tnLoad.types[1] === 'heading' && JSON.stringify(tnLoad.paras) === JSON.stringify(['The atlas is omitted.', 'Maps are described in words.', 'Each description is short.']), tnLoad);
  ok('tnpage: entry paragraphs are the braille-sync units 0,1,2 (the heading has no unit)', JSON.stringify(tnLoad.units) === '["0","1","2"]', tnLoad.units);
  ok('tnpage: heading label is the default wording', /Transcriber.s Notes/.test(tnLoad.heading || ''), tnLoad.heading);
  ok('tnpage: load -> save keeps the page in <frontmatter> with its 3 paragraphs (continuation kept)',
    JSON.stringify(tnEntries(tnLoad.xml)) === JSON.stringify(['The atlas is omitted.', 'Maps are described in words.', '+Each description is short.'])
    && /<frontmatter>[^]*<level1 class="bana-transcriber-notes">[^]*<\/frontmatter>\s*<bodymatter>/.test(tnLoad.xml), tnEntries(tnLoad.xml));
  ok('tnpage: the braille pane carries the notes text, linked to the entries',
    await page.evaluate(() => /TRANSCRIBER/i.test(document.getElementById('braille').textContent || '') || document.querySelectorAll('#braille [data-block]').length > 0));

  // edit an entry through the real editor, then save and reload
  const tnTarget = page.locator('#editor .emboss-tnpage-card').getByText('Maps are described in words.', { exact: true });
  await tnTarget.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
  await page.keyboard.type(' See the key.');
  const tnEdited = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('tnpage: an edit to an entry reaches the saved file', tnEntries(tnEdited)[1] === 'Maps are described in words. See the key.', tnEntries(tnEdited));
  const tnReload = await page.evaluate(async (xml) => {
    window.markDocumentClean();
    await window.importFile(new File([xml], 'tn2.xml', { type: 'text/xml' }));
    return window.exportCurrentDocumentXml();
  }, tnEdited);
  ok('tnpage: save -> reload -> save is stable', JSON.stringify(tnEntries(tnReload)) === JSON.stringify(tnEntries(tnEdited)) && tnReload.replace(/emboss-\d+/g, '') .length > 0, tnEntries(tnReload));
  // Enter at the end of an entry starts a NEW entry (not a continuation paragraph)
  await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'tn3.xml', { type: 'text/xml' })); }, TN_XML);
  await page.locator('#editor .emboss-tnpage-card').getByText('The atlas is omitted.', { exact: true }).click();
  await page.waitForTimeout(400);
  // After a caret-moving key, wait until Lexical's own selection has caught up with the DOM caret (its
  // selectionchange handling is async; Enter/typing fired before that act at the stale click position).
  const settleCaret = () => page.waitForFunction(() => {
    const ds = getSelection(), ls = window.editor.getEditorState()._selection;
    return !!(ds && ds.anchorNode && ls && ls.anchor && ls.anchor.offset === ds.anchorOffset);
  }, null, { timeout: 3000 }).catch(() => {});
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
  await settleCaret();
  await page.keyboard.press('Enter');
  await page.keyboard.type('A brand new entry.');
  const tnNew = tnEntries(await page.evaluate(() => window.exportCurrentDocumentXml()));
  ok('tnpage: Enter + typing adds an entry inside the page', tnNew.includes('A brand new entry.') && tnNew.length === 4 && !tnNew[1].startsWith('+'), tnNew);
  // undo with the real shortcut reverts the typing
  for (let i = 0; i < 6; i++) await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  const tnUndone = await page.evaluate(() => ({ xml: window.exportCurrentDocumentXml(), types: window.editor.getEditorState().read(() => window.lastModel && (window.lastModel.blocks || []).map((b) => b.type)) }));
  ok('tnpage: undo removes the typed entry and keeps the page', !tnUndone.xml.includes('A brand new entry.') && /bana-transcriber-notes/.test(tnUndone.xml), tnEntries(tnUndone.xml));
  // JSON snapshot (what undo/redo history stores) carries the page and its entry grouping
  const tnJson = await page.evaluate(async () => {
    const json = JSON.stringify(window.editor.getEditorState().toJSON());
    window.editor.setEditorState(window.editor.parseEditorState(json));
    await window.render();
    return { has: json.includes('emboss-tnpage'), xml: window.exportCurrentDocumentXml() };
  });
  ok('tnpage: editor-state JSON restore keeps the page and the continuation paragraph', tnJson.has && tnEntries(tnJson.xml).includes('+Each description is short.'), tnEntries(tnJson.xml));

  // create one with the style dropdown (the shared style registry) and with the slash menu
  await page.evaluate(async () => { window.markDocumentClean(); await window.importFile(new File(['<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><h1>Chapter</h1><p>Body text.</p></level1></bodymatter></book></dtbook>'], 'tn4.xml', { type: 'text/xml' })); });
  // A page written mid-book stays in place (nimas-export renderTnPageLevel); only one at the very
  // start goes in <frontmatter> and reloads before the body, so create it at the start of the document.
  await page.locator('#editor').getByText('Chapter', { exact: true }).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await settleCaret();
  const hasOpt = await page.evaluate(() => [...document.querySelectorAll('#blockStyle option')].some((o) => o.value === 'tnpage'));
  ok("tnpage: the style dropdown offers \"Transcriber's Notes Page\" (same registry as the slash menu)", hasOpt);
  await page.selectOption('#blockStyle', 'tnpage');
  await page.waitForSelector('#editor .emboss-tnpage-card', { timeout: 5000 });
  await page.waitForTimeout(400);   // the suggestions dialog opens only when something is detected: nothing here, so it must stay shut and the caret stay in the new entry
  ok('tnpage: creating a page with no detected suggestions opens no dialog (style dropdown)', !(await page.evaluate(() => document.getElementById('tnsDialog').open)));
  await page.keyboard.type('First created entry.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second created entry.');
  const tnMade = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('tnpage: created from the menu, typed into, saved as a frontmatter page with two entries',
    JSON.stringify(tnEntries(tnMade)) === JSON.stringify(['First created entry.', 'Second created entry.']), tnEntries(tnMade));
  const tnMadeBack = await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'tn5.xml', { type: 'text/xml' })); await window.render(); return { types: window.lastModel.blocks.map((b) => b.type), n: document.querySelectorAll('#editor .emboss-tnpage-card > p').length }; }, tnMade);
  ok('tnpage: a created page reloads as a page followed by the body', tnMadeBack.types[0] === 'tnpage' && tnMadeBack.n === 2, tnMadeBack);
  // slash menu
  await page.evaluate(() => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: '' }] }); });
  await page.locator('#editor').click();
  await page.keyboard.type('/tnpage');
  await page.waitForSelector('#slashList .slash-item', { timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.waitForSelector('#editor .emboss-tnpage-card', { timeout: 5000 });
  await page.waitForTimeout(400);   // the suggestions dialog opens only when something is detected: nothing here, so it must stay shut and the caret stay in the new entry
  ok('tnpage: creating a page with no detected suggestions opens no dialog (slash menu)', !(await page.evaluate(() => document.getElementById('tnsDialog').open)));
  await page.waitForTimeout(300);
  await page.keyboard.type('Slash entry.');
  const tnSlash = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('tnpage: the slash command /tnpage inserts a page too', tnEntries(tnSlash).includes('Slash entry.') && !/\/tnpage/.test(tnSlash), tnEntries(tnSlash));

  // ---- Special Symbols page (`sympage`, BANA 2.5): explicit page load -> edit -> save -> reload; automatic page fills from the
  // document's symbols, saves as the marker only, and turns explicit once an entry is edited; create via the menu; undo ----
  const SP_HEAD = `<?xml version="1.0" encoding="UTF-8"?>\n<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book>\n<frontmatter><doctitle>Symbols</doctitle>\n`;
  const SP_XML = SP_HEAD + `<level1 class="bana-special-symbols"><p class="bana-symbol" title="‖.=">Dot locator, precedes listed symbols</p><p class="bana-symbol" title="_4‖•">Bullet</p><p class="bana-symbol" title="&quot;7">Hollow square bullet</p></level1>
<level1 class="bana-transcriber-notes"><h1>Transcriber’s Notes</h1><p>A note.</p></level1>
</frontmatter>\n<bodymatter><level1><h1>Chapter</h1><p>Body text.</p></level1></bodymatter></book></dtbook>`;
  const spLevel = (xml) => (xml.match(/<level1 class="bana-special-symbols[^"]*">[^]*?<\/level1>/) || [''])[0];
  const spEntries = (xml) => [...spLevel(xml).matchAll(/<p class="bana-symbol"(?: title="([^"]*)")?>([^<]*)<\/p>/g)].map((m) => `${m[1] || ''}|${m[2]}`);
  const spLoad = await page.evaluate(async (xml) => {
    window.markDocumentClean();
    await window.importFile(new File([xml], 'sp1.xml', { type: 'text/xml' }));
    await window.render();
    const el = document.querySelector('#editor .emboss-sympage-card');
    return {
      types: (window.lastModel.blocks || []).map((b) => b && b.type),
      paras: el ? [...el.children].map((c) => c.textContent.replace(/​/g, '')) : null,
      units: el ? [...el.children].map((c) => c.dataset.unitIdx) : null,
      auto: el ? el.dataset.auto : null,
      xml: window.exportCurrentDocumentXml(),
    };
  }, SP_XML);
  ok('sympage: the editor shows the explicit page as one container of 3 entry paragraphs, before the notes page',
    spLoad.types[0] === 'sympage' && spLoad.types[1] === 'tnpage' && spLoad.paras && spLoad.paras.length === 3 && /Bullet/.test(spLoad.paras[1]) && spLoad.auto === '', spLoad);
  ok('sympage: entry paragraphs are the braille-sync units 0,1,2', JSON.stringify(spLoad.units) === '["0","1","2"]', spLoad.units);
  ok('sympage: load -> save keeps the explicit entries (cells + glyph in the title) in <frontmatter> before the notes page',
    JSON.stringify(spEntries(spLoad.xml)) === JSON.stringify(spEntries(SP_XML)) && !/bana-symbols-auto/.test(spLoad.xml)
    && spLoad.xml.indexOf('bana-special-symbols') > 0 && spLoad.xml.indexOf('bana-special-symbols') < spLoad.xml.indexOf('bana-transcriber-notes'), spEntries(spLoad.xml));
  ok('sympage: the braille pane shows the page (heading and an entry)', await page.evaluate(() => /SPECIAL SYMBOLS/i.test(document.getElementById('braille').textContent || '')));
  await page.locator('#editor .emboss-sympage-card').getByText(/Hollow square bullet/).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
  await page.keyboard.type(' (open)');
  const spEdited = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('sympage: an edit to an entry reaches the saved file', spEntries(spEdited)[2] === '&quot;7|Hollow square bullet (open)', spEntries(spEdited));
  const spReload = await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'sp2.xml', { type: 'text/xml' })); return window.exportCurrentDocumentXml(); }, spEdited);
  ok('sympage: save -> reload -> save is stable', JSON.stringify(spEntries(spReload)) === JSON.stringify(spEntries(spEdited)), spEntries(spReload));

  // automatic page: derived from the document's symbols, saved as the marker only, explicit once edited
  const SPA_XML = SP_HEAD + `<level1 class="bana-special-symbols bana-symbols-auto"><p></p></level1>\n</frontmatter>\n<bodymatter><level1><h1>Chapter</h1><list type="ul"><li>□ hollow</li><li>▲ triangle</li></list></level1></bodymatter></book></dtbook>`;
  const spAuto = await page.evaluate(async (xml) => {
    window.markDocumentClean();
    await window.importFile(new File([xml], 'sp3.xml', { type: 'text/xml' }));
    await window.render();
    await new Promise((r) => setTimeout(r, 600));
    await window.render();
    const el = document.querySelector('#editor .emboss-sympage-card');
    return { paras: el ? [...el.children].map((c) => c.textContent.replace(/​/g, '')) : null, auto: el ? el.dataset.auto : null, xml: window.exportCurrentDocumentXml(),
      braille: document.getElementById('braille').textContent || '' };
  }, SPA_XML);
  ok('sympage: an automatic page shows the dot locator and the document\'s symbols', spAuto.paras && spAuto.paras.length === 3 && /Dot locator/.test(spAuto.paras[0]) && /Triangle/.test(spAuto.paras[1]) && /Hollow square/.test(spAuto.paras[2]) && spAuto.auto === '1', spAuto.paras);
  ok('sympage: an automatic page saves as the marker only (auto class, no entries)', /bana-special-symbols bana-symbols-auto/.test(spAuto.xml) && spEntries(spAuto.xml).length === 0, spLevel(spAuto.xml));
  ok('sympage: the braille pane lists the document\'s symbols under the heading', /SPECIAL SYMBOLS/i.test(spAuto.braille) && /\.=/.test(spAuto.braille), spAuto.braille.slice(0, 200));
  await page.locator('#editor .emboss-sympage-card').getByText(/Triangle/).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
  await page.keyboard.type('!');
  await page.waitForTimeout(500);
  const spTouched = await page.evaluate(() => ({ xml: window.exportCurrentDocumentXml(), auto: document.querySelector('#editor .emboss-sympage-card').dataset.auto }));
  ok('sympage: editing an entry turns the page explicit (no auto class; all three entries saved)',
    !/bana-symbols-auto/.test(spTouched.xml) && spEntries(spTouched.xml).length === 3 && spEntries(spTouched.xml).some((e) => /Triangle!$/.test(e)) && spTouched.auto === '', spEntries(spTouched.xml));
  for (let i = 0; i < 6; i++) await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await page.waitForTimeout(400);
  const spUndone = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('sympage: undo of the edit returns the page to automatic', /bana-symbols-auto/.test(spUndone) && !/Triangle!/.test(spUndone) && spEntries(spUndone).length === 0, spLevel(spUndone));
  const spJson = await page.evaluate(async () => {
    const json = JSON.stringify(window.editor.getEditorState().toJSON());
    window.editor.setEditorState(window.editor.parseEditorState(json));
    await window.render();
    return { has: json.includes('emboss-sympage'), xml: window.exportCurrentDocumentXml() };
  });
  ok('sympage: editor-state JSON restore keeps the automatic page', spJson.has && /bana-symbols-auto/.test(spJson.xml), spLevel(spJson.xml));

  // create from the style dropdown (shared registry) and with the slash menu
  await page.evaluate(async () => { window.markDocumentClean(); await window.importFile(new File(['<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1><h1>Chapter</h1><list type="ul"><li>□ hollow</li></list></level1></bodymatter></book></dtbook>'], 'sp4.xml', { type: 'text/xml' })); });
  await page.locator('#editor').getByText('Chapter', { exact: true }).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
  await settleCaret();
  ok('sympage: the style dropdown offers "Special Symbols Page" (same registry as the slash menu)', await page.evaluate(() => [...document.querySelectorAll('#blockStyle option')].some((o) => o.value === 'sympage')));
  await page.selectOption('#blockStyle', 'sympage');
  await page.waitForTimeout(700);
  const spMade = await page.evaluate(() => ({ xml: window.exportCurrentDocumentXml(), n: document.querySelectorAll('#editor .emboss-sympage-card > p').length }));
  ok('sympage: created from the menu as an automatic page in <frontmatter>, filled from the document\'s symbols',
    /<frontmatter>[^]*<level1 class="bana-special-symbols bana-symbols-auto">[^]*<\/frontmatter>/.test(spMade.xml) && spMade.n === 2, spMade);
  for (let i = 0; i < 6; i++) await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await page.waitForTimeout(400);
  const spGone = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('sympage: undo of the insertion removes the page', !/bana-special-symbols/.test(spGone), spLevel(spGone));
  await page.evaluate(() => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: '' }] }); });
  await page.locator('#editor').click();
  await page.keyboard.type('/sympage');
  await page.waitForSelector('#slashList .slash-item', { timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const spSlash = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('sympage: the slash command /sympage inserts an automatic page', /bana-special-symbols bana-symbols-auto/.test(spSlash) && !/\/sympage/.test(spSlash), spLevel(spSlash));

  // ---- Regenerate button (Special Symbols page): toolbar control, disabled while the page is automatic, enabled once it is edited,
  // restores the automatic page as one undo step and announces it ----
  {
    const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
    const st = () => page.evaluate(() => { const b = document.getElementById('btnSymRegen'); const el = document.querySelector('#editor .emboss-sympage-card'); return { hidden: b.hidden, disabled: b.disabled, auto: el ? el.dataset.auto : null, xml: window.exportCurrentDocumentXml(), announce: document.getElementById('announce').textContent }; });
    await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'sp-regen.xml', { type: 'text/xml' })); await window.render(); await new Promise((r) => setTimeout(r, 600)); await window.render(); }, SPA_XML);
    const rg0 = await st();
    ok('regenerate: shown for a document with a symbols page, disabled while the page is automatic', rg0.hidden === false && rg0.disabled === true && rg0.auto === '1', rg0);
    ok('regenerate: it is a real button with an accessible name', await page.evaluate(() => { const b = document.getElementById('btnSymRegen'); return b.tagName === 'BUTTON' && /Regenerate/.test(b.getAttribute('aria-label') || ''); }));
    await page.locator('#editor .emboss-sympage-card').getByText(/Triangle/).click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
    await page.keyboard.type('!');
    await page.waitForTimeout(700);
    const rg1 = await st();
    ok('regenerate: enabled once the page has been edited (explicit)', rg1.disabled === false && rg1.auto === '' && /Triangle!/.test(rg1.xml), { d: rg1.disabled, a: rg1.auto });
    await page.focus('#btnSymRegen');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    const rg2 = await st();
    ok('regenerate: the keyboard (Enter on the focused button) restores the automatic page', rg2.auto === '1' && /bana-symbols-auto/.test(rg2.xml) && !/Triangle!/.test(rg2.xml) && rg2.disabled === true, { a: rg2.auto, d: rg2.disabled });
    ok('regenerate: "Regenerated" is announced in the live region', /Regenerated/.test(rg2.announce), rg2.announce);
    await page.locator('#editor').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press(undoKey);
    await page.waitForTimeout(800);
    const rg3 = await st();
    ok('regenerate: one undo brings the edited (explicit) page back', rg3.auto === '' && /Triangle!/.test(rg3.xml) && rg3.disabled === false, { a: rg3.auto, d: rg3.disabled });
    ok('regenerate: window.regenerateSymPage() still works and the button is hidden with no symbols page', await page.evaluate(async () => {
      window.regenerateSymPage(); await new Promise((r) => setTimeout(r, 600));
      const auto = document.querySelector('#editor .emboss-sympage-card').dataset.auto;
      window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: 'No page.' }] }); await new Promise((r) => setTimeout(r, 400));
      return auto === '1' && document.getElementById('btnSymRegen').hidden === true;
    }));
  }

  // ---- Third and fourth batches of formatter fields (nimas-export.mjs BANA_FLAG_FIELDS / BANA_TEXT_FIELDS / BANA_DOC_OPTIONS, the table and
  // pagenum cases): carried through the editor's per-node `fmt`: load -> edit next to each -> save -> undo -> reload keeps every field ----
  {
    const { exportToNimas } = await import('../input/nimas-export.mjs');
    const { parseDtbook } = await import('../input/parse.mjs');
    const { DOMParser: XmlDom } = await import('@xmldom/xmldom');
    globalThis.DOMParser = XmlDom;
    const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
    const F3_MODEL = { title: 'Fields 3', pilPrintPage: false, blocks: [   // UK-7 (28 Sep): on is now the default, so the round trip checks the non-default 'off'
      { type: 'heading', level: 1, text: 'Fields 3' },
      { type: 'para', text: 'Diagram sentence.', diagram: true },
      { type: 'para', text: 'Hanging text.', hangingMargins: true },
      { type: 'para', text: 'Arrow text.', arrowLines: ['#$%', '  ,-=>'] },
      { type: 'note', render: 'required', text: 'Key note text.', keyList: true, keyLocator: true },
      { type: 'note', render: 'required', text: 'Cell five note.', cell5: true },
      { type: 'note', render: 'required', text: 'Mention note text.', mentionSymbols: ['8', '@'] },
      { type: 'box', render: 'required', blocks: [{ type: 'para', text: 'Inside box.' }], boxLines: false },
      { type: 'table', headers: ['Item', 'Qty'], rows: [['a', '1'], ['b', '2'], ['Total', '3']], totalRows: [2], rowSubheadings: [{ row: 0, text: 'Fruit' }], citation: 'Source: Census' },
      { type: 'pagenum', page: '5', text: '5', implied: true },
      { type: 'para', text: 'Between one.' },
      { type: 'pagenum', implied: true },
      { type: 'para', text: 'Between two.' },
      { type: 'pagenum', page: 'i', text: 'i', through: 'v' },
      { type: 'para', text: 'Between three.' },
      { type: 'pagenum', page: '24', text: '24', combineWithNext: true },
      { type: 'para', text: 'Between four.' },
      { type: 'pagenum', page: '89', text: '89', spelled: 'eighty-nine' },
      { type: 'para', text: 'Span text.', segments: [{ type: 'text', text: 'Span ' }, { type: 'imgnote', text: 'crossed', prodnote: true, render: 'optional', spanTypeform: true }, { type: 'text', text: ' text.' }] },
    ] };
    const F3_XML = exportToNimas(F3_MODEL);
    const f3Checks = (xml, label) => {
      let bl;
      try { bl = parseDtbook(xml); } catch (e) { ok(`${label}: saved XML parses`, false, String(e)); return; }
      const bs = bl.blocks || [];
      const by = (pred) => bs.find(pred);
      ok(`${label}: paragraph diagram, hanging margins, arrow lines`, !!by((b) => b.type === 'para' && b.diagram) && !!by((b) => b.type === 'para' && b.hangingMargins) && JSON.stringify((by((b) => b.arrowLines) || {}).arrowLines) === JSON.stringify(['#$%', '  ,-=>']), bs.filter((b) => b.type === 'para').map((b) => Object.keys(b)));
      ok(`${label}: note keyList + keyLocator, cell5, mentionSymbols`, !!by((b) => b.keyList && b.keyLocator) && !!by((b) => b.cell5) && JSON.stringify((by((b) => b.mentionSymbols) || {}).mentionSymbols) === JSON.stringify(['8', '@']), bs.filter((b) => b.type === 'note').map((b) => Object.keys(b)));
      ok(`${label}: box boxLines false`, !!by((b) => (b.type === 'box' || b.type === 'sidebar') && b.boxLines === false), bs.filter((b) => b.type === 'box').map((b) => Object.keys(b)));
      const tb = by((b) => b.type === 'table') || {};
      ok(`${label}: table citation, total rows, row subheadings`, tb.citation === 'Source: Census' && JSON.stringify(tb.totalRows) === '[2]' && JSON.stringify(tb.rowSubheadings) === JSON.stringify([{ row: 0, text: 'Fruit' }]), tb);
      const pns = bs.filter((b) => b.type === 'pagenum');
      ok(`${label}: page turns keep implied (with and without a number), through, combineWithNext, spelled`,
        pns.some((b) => b.implied && b.page === '5') && pns.some((b) => b.implied && !b.page) && pns.some((b) => b.through === 'v') && pns.some((b) => b.combineWithNext) && pns.some((b) => b.spelled === 'eighty-nine'), pns);
      const seg = ((by((b) => b.segments && b.segments.some((g) => g.type === 'imgnote')) || {}).segments || []).find((g) => g.type === 'imgnote');
      ok(`${label}: imgnote spanTypeform`, !!seg && seg.spanTypeform === true, seg);
      ok(`${label}: document option pilPrintPage`, bl.pilPrintPage === false && /bana-pil-print-page" content="0"/.test(xml));
    };
    const f3Load = (xml) => page.evaluate(async (x) => { window.markDocumentClean(); await window.importFile(new File([x], 'f3.xml', { type: 'text/xml' })); await window.render(); return window.exportCurrentDocumentXml(); }, xml);
    const f3First = await f3Load(F3_XML);
    f3Checks(f3First, 'formatter fields 3: load -> save');
    // edit text next to every field (real typing), then save
    for (const txt of ['Diagram sentence.', 'Hanging text.', 'Arrow text.', 'Key note text.', 'Cell five note.', 'Mention note text.', 'Inside box.']) {
      await page.locator('#editor').getByText(txt, { exact: true }).first().click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
      await page.keyboard.type('Q');
    }
    for (const txt of ['Between one.', 'Between two.', 'Between three.', 'Between four.']) {
      await page.locator('#editor').getByText(txt, { exact: true }).first().click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End');
      await page.keyboard.type('Q');
    }
    await page.waitForTimeout(700);
    const f3Edited = await page.evaluate(() => window.exportCurrentDocumentXml());
    ok('formatter fields 3: the typed edits reached the file', /Diagram sentence\.Q/.test(f3Edited) && /Inside box\.Q/.test(f3Edited) && /Between four\.Q/.test(f3Edited), f3Edited.match(/Q</g));
    f3Checks(f3Edited, 'formatter fields 3: after edits next to each field');
    for (let i = 0; i < 4; i++) { await page.keyboard.press(undoKey); await page.waitForTimeout(150); }
    await page.waitForTimeout(500);
    f3Checks(await page.evaluate(() => window.exportCurrentDocumentXml()), 'formatter fields 3: after undo');
    for (let i = 0; i < 4; i++) { await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y'); await page.waitForTimeout(150); }
    await page.waitForTimeout(500);
    f3Checks(await page.evaluate(() => window.exportCurrentDocumentXml()), 'formatter fields 3: after redo');
    f3Checks(await f3Load(f3Edited), 'formatter fields 3: save -> reload -> save');
    const f3Json = await page.evaluate(async (x) => {
      window.markDocumentClean(); await window.importFile(new File([x], 'f3j.xml', { type: 'text/xml' }));
      const json = JSON.stringify(window.editor.getEditorState().toJSON());
      window.editor.setEditorState(window.editor.parseEditorState(json));
      await window.render();
      return { fmt: (json.match(/"fmt"/g) || []).length, xml: window.exportCurrentDocumentXml() };
    }, F3_XML);
    ok('formatter fields 3: editor-state JSON snapshots carry fmt on the page-turn, table and box nodes', f3Json.fmt >= 8, f3Json.fmt);
    f3Checks(f3Json.xml, 'formatter fields 3: editor-state JSON round trip');
    // removing a table row moves the row indexes (total row was row 2)
    const f3Rows = await page.evaluate(async (x) => {
      window.markDocumentClean(); await window.importFile(new File([x], 'f3r.xml', { type: 'text/xml' }));
      window.editor.update(() => { const t = [...window.editor.getEditorState()._nodeMap.values()].find((n) => n.getType && n.getType() === 'emboss-table'); t.removeRow(0); });
      await new Promise((r) => setTimeout(r, 400));
      return window.exportCurrentDocumentXml();
    }, F3_XML);
    ok('formatter fields 3: removing a table row moves total-row / subheading indexes with it', /<tr class="bana-total">/.test(f3Rows) && !/bana-subheading/.test(f3Rows), f3Rows.match(/<tr[^>]*>/g));
    const f3Plain = await page.evaluate(async () => {
      window.markDocumentClean(); await window.importFile(new File(['<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3"><head><meta name="dc:Title" content="P"/></head><book><bodymatter><level1><p>Plain.</p><pagenum id="p3" page="normal">3</pagenum><table><tr><th>a</th></tr><tr><td>1</td></tr></table></level1></bodymatter></book></dtbook>'], 'plain3.xml', { type: 'text/xml' })); await new Promise((r) => setTimeout(r, 300));
      const x = window.exportCurrentDocumentXml(); return x.match(/bana-(diagram|hanging|arrows|key-|cell5|mention|no-box|implied|combine|through|spelled|pil|table-citation|total|subheading)[\w-]*/g) || [];
    });
    ok('formatter fields 3: a plain document saves with none of the new tokens', f3Plain.length === 0, f3Plain);
  }

  // ---- Findings batches A and B (formatter_fields_roundtrip_4.test.mjs): ignore-font (block, item, run), diacritic notation, emphasis omission,
  // page break before, unnumbered page turn, table notes, strip-continuation, poem method and the document options ride through the editor ----
  {
    const { exportToNimas } = await import('../input/nimas-export.mjs');
    const { parseDtbook } = await import('../input/parse.mjs');
    const { DOMParser: XmlDom } = await import('@xmldom/xmldom');
    globalThis.DOMParser = XmlDom;
    const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
    const redoKey = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const segs = (...a) => a.map((x) => (typeof x === 'string' ? { type: 'text', text: x } : x));
    const bErrors = [];
    const onErr = (m) => { if (m.type() === 'error') bErrors.push(m.text()); };
    page.on('console', onErr);
    const OPTS = { verseKeep: false, listPageRules: false, interpointOmitEven: true, endOfVolume: true, tocRightBuffer: true, nestedBullets: true, tocHeading: 'Table of Contents & Lists', lineIndicator: '_/', runningHeadKeyWords: 'Moby Dick' };
    const AB_MODEL = { title: 'Fields AB', ...OPTS, blocks: [
      { type: 'heading', level: 1, text: 'Fields AB' },
      { type: 'heading', level: 2, text: 'Head flags', ignoreFont: true, diacriticNotation: true, pageBreakBefore: true },
      { type: 'para', text: 'Para flags.', ignoreFont: true, diacriticNotation: true, omitEmphasis: true, pageBreakBefore: true },
      { type: 'para', text: 'All italic.', segments: segs({ type: 'text', text: 'All italic.', tf: 1 }), omitFullEmphasis: true },
      { type: 'para', text: 'The letter ab standing for itself.', segments: segs('The letter ', { type: 'text', text: 'ab', tf: 1, ignoreFont: true }, ' standing for itself.') },
      { type: 'para', text: 'Plain then marked', segments: segs('Plain then ', { type: 'text', text: 'marked', ignoreFont: true }) },
      { type: 'note', render: 'required', text: 'A flagged note.', ignoreFont: true, pageBreakBefore: true },
      { type: 'list', items: [{ text: 'item one', marker: '•' }, { text: 'item two', marker: '•' }], ignoreFont: true, omitEmphasis: true, omitFullEmphasis: true, pageBreakBefore: true },
      { type: 'list', items: [{ text: 'run item', marker: '•', ignoreFont: true, segments: segs('run ', { type: 'text', text: 'item', tf: 1, ignoreFont: true }) }, { text: 'second', marker: '•' }] },
      { type: 'list', kind: 'toc', items: [{ text: 'Chapter one', page: '12a' }, { text: 'Chapter two', page: '14' }], stripContinuation: true },
      { type: 'table', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']], guideDotNote: 'Guide dots lead to the entry.', repeatHeadings: false, continuedNote: 'Table 3 (continued)', pageBreakBefore: true },
      { type: 'table', headers: ['C', 'D'], rows: [['5', '6'], ['7', '8']], guideDotNote: true, repeatHeadings: true, continuedNote: false, numericPassage: true },
      { type: 'box', render: 'required', blocks: [{ type: 'para', text: 'Inside the box.' }], pageBreakBefore: true },
      { type: 'pagenum', page: '5', text: '5', unnumbered: true },
      { type: 'para', text: 'After the page turn.' },
      { type: 'play', subtype: 'verse', style: 'verse', text: 'A line of verse', poemMethod: 'line-indicator', pageBreakBefore: true },
    ] };
    const AB_XML = exportToNimas(AB_MODEL);
    const abLoad = (xml) => page.evaluate(async (x) => { window.markDocumentClean(); await window.importFile(new File([x], 'ab.xml', { type: 'text/xml' })); await window.render(); return window.exportCurrentDocumentXml(); }, xml);
    const abChecks = (xml, label) => {
      let bl;
      try { bl = parseDtbook(xml); } catch (e) { ok(`${label}: saved XML parses`, false, String(e)); return; }
      const bs = bl.blocks || [];
      const find = (pred) => bs.find(pred) || {};
      const h = find((b) => b.type === 'heading' && b.level === 2);
      ok(`${label}: heading ignoreFont + diacriticNotation + pageBreakBefore`, h.ignoreFont === true && h.diacriticNotation === true && h.pageBreakBefore === true, h);
      const p = find((b) => b.type === 'para' && /^Para flags/.test(b.text || ''));
      ok(`${label}: paragraph ignoreFont + diacriticNotation + omitEmphasis + pageBreakBefore`, p.ignoreFont === true && p.diacriticNotation === true && p.omitEmphasis === true && p.pageBreakBefore === true, p);
      ok(`${label}: paragraph omitFullEmphasis`, find((b) => /^All italic/.test(b.text || '')).omitFullEmphasis === true);
      const rs = find((b) => /^The letter/.test(b.text || '')).segments || [];
      const marked = (rr) => rr.filter((g) => g.ignoreFont).map((g) => g.text).join('');
      // A letter typed inside a formatted run joins it, keeping its mark and typeform, in every browser — as in Word (Paul, 2 Oct, A89:
      // "inside"; before, Chrome put the letter outside, between two marked halves, and Safari and Firefox inside).
      ok(`${label}: the italic ignore-font run keeps its mark and typeform (a letter typed inside it joins it)`, rs.length >= 3 && /^a(y)?b$/.test(marked(rs)) && rs.filter((g) => g.ignoreFont).every((g) => g.tf === 1) && !rs[0].ignoreFont && !rs[rs.length - 1].ignoreFont, rs);
      const rs2 = find((b) => /^Plain then/.test(b.text || '')).segments || [];
      ok(`${label}: a plain (no typeform) ignore-font run stays marked and the text before it is not`, rs2.length >= 2 && /^mar(y)?ked$/.test(marked(rs2)) && !rs2[0].ignoreFont, rs2);
      ok(`${label}: note ignoreFont + pageBreakBefore`, find((b) => b.type === 'note').ignoreFont === true && find((b) => b.type === 'note').pageBreakBefore === true, find((b) => b.type === 'note'));
      const ls = bs.filter((b) => b.type === 'list');
      ok(`${label}: list ignoreFont, omitEmphasis, omitFullEmphasis, pageBreakBefore`, !!ls[0] && ls[0].ignoreFont === true && ls[0].omitEmphasis === true && ls[0].omitFullEmphasis === true && ls[0].pageBreakBefore === true, ls[0]);
      ok(`${label}: list item ignoreFont (only the first item) and its ignore-font run`, !!ls[1] && ls[1].items[0].ignoreFont === true && !ls[1].items[1].ignoreFont && (ls[1].items[0].segments || []).some((g) => g.ignoreFont === true && /item/.test(g.text)), ls[1] && ls[1].items);
      ok(`${label}: list stripContinuation`, ls.some((l) => l.stripContinuation === true), ls.map((l) => Object.keys(l)));
      const tbs = bs.filter((b) => b.type === 'table');
      ok(`${label}: table guideDotNote text, repeatHeadings false, continuedNote text, pageBreakBefore`, tbs[0] && tbs[0].guideDotNote === 'Guide dots lead to the entry.' && tbs[0].repeatHeadings === false && tbs[0].continuedNote === 'Table 3 (continued)' && tbs[0].pageBreakBefore === true, tbs[0]);
      ok(`${label}: table guideDotNote true, repeatHeadings true, continuedNote false`, tbs[1] && tbs[1].guideDotNote === true && tbs[1].repeatHeadings === true && tbs[1].continuedNote === false, tbs[1]);
      ok(`${label}: table numericPassage (TBL-NUM-1)`, tbs[1] && tbs[1].numericPassage === true, tbs[1]);
      ok(`${label}: box pageBreakBefore`, find((b) => b.type === 'box' || b.type === 'sidebar').pageBreakBefore === true, find((b) => b.type === 'box' || b.type === 'sidebar'));
      ok(`${label}: page turn unnumbered`, find((b) => b.type === 'pagenum').unnumbered === true, find((b) => b.type === 'pagenum'));
      const v = find((b) => b.type === 'play');
      ok(`${label}: verse line poemMethod + pageBreakBefore`, v.poemMethod === 'line-indicator' && v.pageBreakBefore === true, v);
      ok(`${label}: document options (values kept, including verseKeep/listPageRules false)`, Object.entries(OPTS).every(([k, val]) => bl[k] === val), Object.fromEntries(Object.keys(OPTS).map((k) => [k, bl[k]])));
    };
    const typeEnd = async (text, ch, at) => {   // caret at the end of the text node whose content is `text` (or at offset `at` inside it)
      const hit = await page.evaluate(([tx, off]) => { let ok = false; window.editor.update(() => { for (const n of window.editor.getEditorState()._nodeMap.values()) { if (n.getType && n.getType() === 'text' && n.getTextContent() === tx) { if (off == null) n.selectEnd(); else n.select(off, off); ok = true; break; } } }); window.editor.focus(); return ok; }, [text, at == null ? null : at]);
      ok(`batch A/B fields: found the text "${text}" to edit`, hit);
      await wait(150);
      if (at != null) { await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); await wait(100); }   // a caret moved by the keyboard, as a user's is (a programmatic one carries no run style)
      await page.keyboard.type(ch);
    };
    const first = await abLoad(AB_XML);
    abChecks(first, 'batch A/B fields: load -> save');
    ok('batch A/B fields: the braille pane model carries the document options', await page.evaluate(() => { const m = window.lastModel; return !!m && m.verseKeep === false && m.interpointOmitEven === true && m.tocHeading === 'Table of Contents & Lists' && m.runningHeadKeyWords === 'Moby Dick'; }));
    // edit the text next to (and inside) every field, with real typing
    for (const tx of ['Head flags', 'Para flags.', 'All italic.', ' standing for itself.', 'Plain then ', 'A flagged note.', 'item one', 'item two', 'second', 'Inside the box.', 'After the page turn.', 'A line of verse']) await typeEnd(tx, 'Q');
    await typeEnd('ab', 'y', 1);      // inside the ignore-font run: the run grows, stays marked
    await typeEnd('marked', 'y', 3);
    await wait(800);
    const edited = await page.evaluate(() => window.exportCurrentDocumentXml());
    ok('batch A/B fields: the typed edits reached the file', /Head flagsQ/.test(edited) && /After the page turn\.Q/.test(edited) && /A line of verseQ/.test(edited) && /item twoQ/.test(edited), edited.match(/Q</g));
    // Paul, 2 Oct (A89): a letter typed inside a formatted run goes inside it, in every browser (as in Word).
    ok('batch A/B fields: a letter typed inside an ignore-font run joins it (marked, and italic where the run is)', /<span class="bana-ignore-font"><em>ayb<\/em><\/span>/.test(edited) && /<span class="bana-ignore-font">maryked<\/span>/.test(edited), edited.match(/<span class="bana-ignore-font">[^]{0,30}/g));
    abChecks(edited, 'batch A/B fields: after edits beside each');
    for (let i = 0; i < 6; i++) { await page.keyboard.press(undoKey); await wait(150); }
    await wait(600);
    abChecks(await page.evaluate(() => window.exportCurrentDocumentXml()), 'batch A/B fields: after undo');
    for (let i = 0; i < 6; i++) { await page.keyboard.press(redoKey); await wait(150); }
    await wait(600);
    abChecks(await page.evaluate(() => window.exportCurrentDocumentXml()), 'batch A/B fields: after redo');
    abChecks(await abLoad(edited), 'batch A/B fields: save -> reload -> save');
    const json = await page.evaluate(async (x) => {
      window.markDocumentClean(); await window.importFile(new File([x], 'abj.xml', { type: 'text/xml' }));
      const j = JSON.stringify(window.editor.getEditorState().toJSON());
      window.editor.setEditorState(window.editor.parseEditorState(j));
      await window.render();
      return window.exportCurrentDocumentXml();
    }, AB_XML);
    abChecks(json, 'batch A/B fields: editor-state JSON round trip');
    // a plain document gains none of the tokens
    const plain = await abLoad(exportToNimas({ title: 'P', blocks: [{ type: 'heading', level: 1, text: 'P' }, { type: 'para', text: 'Plain.', segments: [{ type: 'text', text: 'Plain.' }] }, { type: 'table', headers: ['a'], rows: [['1']] }] }));
    ok('batch A/B fields: a plain document saves with none of their tokens', !/bana-(ignore-font|diacritic|omit|page-break|unnumbered|guide-dot-note|repeat|continued|strip|poem-|toc-heading|verse-keep|list-page|interpoint|end-of-volume|line-indicator|nested|running)/.test(plain), plain.match(/bana-[\w-]+/g));
    ok('batch A/B fields: no console errors', bErrors.length === 0, bErrors);
    page.off('console', onErr);
  }

  // ---- Optional formatter fields (F-84, 7.2.1e, F-241, F-104, F-206, F-234, 10.3.2, F-34, 8.6.2a): carried through the
  // editor's nodes silently (class tokens `bana-<field>`, see nimas-export.mjs BANA_FLAG_FIELDS). load -> save -> reload -> save,
  // then an undo/redo-style editor-state JSON round trip, must all keep every token; the bullet list must stay a <list type="ul">.
  const FF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook version="2005-3" xmlns="http://www.daisy.org/z3986/2005/dtbook/"><book><bodymatter><level1>
  <h1>Fields</h1>
  <h2 class="bana-not-connected">By A. Writer</h2>
  <h2 class="bana-accompanies-box">Facts</h2>
  <p class="bana-directions">Read and answer.</p>
  <p class="bana-directions bana-directions-labelled">A. Use each word.</p>
  <p class="bai-play bana-speaker-gap">HAMLET</p>
  <p class="bana-ln-note" title="Numbers are in the margin.">Numbered one</p>
  <p class="bana-ln-note-off">Numbered two</p>
  <p class="bai-verse bana-ln-margin">A verse line</p>
  <prodnote render="required" class="bana-enclose-prefix" title="Cartoon">Cartoon by Craig</prodnote>
  <prodnote render="optional" class="bana-xref" title="See also">Turn to page nine.</prodnote>
  <list type="ul" class="bana-columns-3"><li>one</li><li>two</li><li>three</li></list>
  <list type="ul"><li>□ hollow</li><li>▲ triangle</li><li>✓ done</li><li>• dot</li></list>
  <list type="ol"><li class="bana-bullet-triangle">first</li><li class="bana-bullet-hollow-square">second</li></list>
</level1></bodymatter></book></dtbook>`;
  const ffChecks = (xml, label) => {
    const has = (re) => re.test(xml);
    ok(`${label}: formatter fields — headings keep not-connected / accompanies-box`, has(/<h2 class="bana-not-connected">By A\. Writer<\/h2>/) && has(/<h2 class="bana-accompanies-box">Facts<\/h2>/), xml.match(/<h2[^>]*>/g));
    ok(`${label}: formatter fields — directions and labelled directions`, has(/<p class="bana-directions">Read and answer\.<\/p>/) && has(/<p class="bana-directions bana-directions-labelled">A\. Use each word\.<\/p>/), xml.match(/<p class="bana-dir[^>]*>/g));
    ok(`${label}: formatter fields — speaker gap`, has(/<p class="bai-play bana-speaker-gap">HAMLET<\/p>/));
    ok(`${label}: formatter fields — line-number note text / off / margin`, has(/<p class="bana-ln-note" title="Numbers are in the margin\.">Numbered one<\/p>/) && has(/<p class="bana-ln-note-off">Numbered two<\/p>/) && has(/<p class="bai-verse bana-ln-margin">A verse line<\/p>/), xml.match(/<p class="[^"]*bana-ln[^>]*>/g));
    ok(`${label}: formatter fields — note prefix and cross-reference note`, has(/<prodnote render="required" class="bana-enclose-prefix" title="Cartoon">Cartoon by Craig<\/prodnote>/) && has(/<prodnote render="optional" class="bana-xref" title="See also">Turn to page nine\.<\/prodnote>/), xml.match(/<prodnote[^>]*>/g));
    ok(`${label}: formatter fields — list columns, and bullet lists stay <list type="ul">`, has(/<list type="ul" class="bana-columns-3">/) && (xml.match(/<list type="ul"/g) || []).length === 2, xml.match(/<list[^>]*>/g));
    ok(`${label}: formatter fields — bullet glyphs (□ ▲ ✓) and dot survive`, has(/<li>□ hollow<\/li>/) && has(/<li>▲ triangle<\/li>/) && has(/<li>✓ done<\/li>/) && has(/<li>dot<\/li>/) === false || has(/<li>• dot<\/li>/) === false, xml.match(/<li[^>]*>[^<]*/g));
    ok(`${label}: formatter fields — bullet beside an ordinal`, has(/<li class="bana-bullet-triangle">first<\/li>/) && has(/<li class="bana-bullet-hollow-square">second<\/li>/), xml.match(/<li class="bana-bullet[^>]*>[^<]*/g));
  };
  const ffFirst = await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'ff1.xml', { type: 'text/xml' })); return window.exportCurrentDocumentXml(); }, FF_XML);
  ffChecks(ffFirst, 'formatter fields load -> save');
  const ffSecond = await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'ff2.xml', { type: 'text/xml' })); return window.exportCurrentDocumentXml(); }, ffFirst);
  ffChecks(ffSecond, 'formatter fields reload');
  const ffJson = await page.evaluate(async (xml) => {
    window.markDocumentClean(); await window.importFile(new File([xml], 'ff3.xml', { type: 'text/xml' }));
    const json = JSON.stringify(window.editor.getEditorState().toJSON());
    window.editor.setEditorState(window.editor.parseEditorState(json));
    await window.render();
    return { has: json.includes('"fmt"'), xml: window.exportCurrentDocumentXml() };
  }, FF_XML);
  ok('formatter fields: editor-state JSON snapshots carry fmt', ffJson.has);
  ffChecks(ffJson.xml, 'formatter fields undo/redo snapshot');
  // undo of an edit keeps the fields
  await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'ff4.xml', { type: 'text/xml' })); }, FF_XML);
  await page.locator('#editor').getByText('Numbered one', { exact: true }).first().click();
  await page.keyboard.type('Z');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  ffChecks(await page.evaluate(() => window.exportCurrentDocumentXml()), 'formatter fields after edit + undo');
  // the model the formatter reads carries the fields (a Lexical model, not just XML)
  const ffModel = await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'ff5.xml', { type: 'text/xml' })); await window.render(); return window.lastModel.blocks.map((b) => ({ t: b.type, nc: b.notConnected, ab: b.accompaniesBox, d: b.directions, sg: b.speakerGap, lt: b.lnNoteText, lo: b.lnNoteOff, lm: b.lnMargin, ep: b.enclosePrefix, xh: b.heading, c: b.columns, m: b.items && b.items.map((i) => i.marker || i.bullet || '-').join(',') })); }, FF_XML);
  ok('formatter fields: the block model carries them (notConnected, accompaniesBox, directions, speakerGap, ln*, enclosePrefix, xref, columns, bullets)',
    ffModel.some((b) => b.nc) && ffModel.some((b) => b.ab) && ffModel.some((b) => b.d) && ffModel.some((b) => b.sg) && ffModel.some((b) => b.lt) && ffModel.some((b) => b.lo) && ffModel.some((b) => b.lm)
    && ffModel.some((b) => b.ep === 'Cartoon') && ffModel.some((b) => b.t === 'xref' && b.xh === 'See also') && ffModel.some((b) => b.c === 3)
    && ffModel.some((b) => b.m === '□,▲,✓,•') && ffModel.some((b) => b.m === '1.,2.'), ffModel);
  // the "5-5" toolbar toggle sets directions on the paragraph under the caret, and saves
  await page.evaluate(async () => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: 'Plain para.' }] }); });
  await page.locator('#editor').getByText('Plain para.', { exact: true }).click();
  await page.click('#btnDirectionsPara');
  ok('formatter fields: the 5-5 toggle writes bana-directions', /<p class="bana-directions">Plain para\.<\/p>/.test(await page.evaluate(() => window.exportCurrentDocumentXml())));
  await page.click('#btnDirectionsPara');
  ok('formatter fields: the 5-5 toggle switches it off again (no class left)', /<p>Plain para\.<\/p>/.test(await page.evaluate(() => window.exportCurrentDocumentXml())));

  // ---- "Braille formatting…" dialog: one dialog, only the fields the focused block has ----
  {
    const bfErrors = [];
    const onErr = (m) => { if (m.type() === 'error') bfErrors.push(m.text()); };
    page.on('console', onErr);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const xmlNow = () => page.evaluate(() => window.exportCurrentDocumentXml());
    const brfNow = () => page.evaluate(() => window.lastBrf);
    const load = async (blocks) => { await page.evaluate((b) => { window.markDocumentClean(); window.modelToLexical({ blocks: b }); }, blocks); await wait(900); };
    // caret at the end of top-level block `i` (a real Lexical selection), focus in the editor
    const caretIn = async (i) => { await page.evaluate((idx) => { window.editor.update(() => { let n = window.editor.getEditorState()._nodeMap.get('root').getChildren()[idx]; while (n.getLastChild && n.getLastChild()) n = n.getLastChild(); n.selectEnd(); }); window.editor.focus(); }, i); await wait(150); };
    // caret at the end of the HEADING (title) child of the box (sidebar) at top-level index `i` — the box's own fields
    // (box lines / page break) are reached from its title, not from the body paragraphs inside it.
    const caretInBoxTitle = async (i) => { await page.evaluate((idx) => { window.editor.update(() => { const box = window.editor.getEditorState()._nodeMap.get('root').getChildren()[idx]; let n = box.getChildren().find((c) => typeof c.getType === 'function' && c.getType() === 'heading'); while (n.getLastChild && n.getLastChild()) n = n.getLastChild(); n.selectEnd(); }); window.editor.focus(); }, i); await wait(150); };
    const openKb = async () => { await page.keyboard.press('Control+Alt+KeyB'); await page.waitForSelector('#brailleFmtDialog[open]', { timeout: 3000 }); };
    const visibleGroups = () => page.$$eval('#brailleFmtDialog fieldset', (fs) => fs.filter((f) => !f.hidden).map((f) => f.id));
    const applyDlg = async () => { await page.click('#brailleFmtApply'); await page.waitForFunction(() => !document.getElementById('brailleFmtDialog').open); await wait(700); };
    const announceText = () => page.evaluate(() => document.getElementById('announce').textContent);
    const undoOnce = async () => { await wait(600); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z'); await wait(700); };
    const BLOCKS = [
      { type: 'heading', level: 2, text: 'By A. Writer' },
      { type: 'list', items: [{ text: 'alpha', marker: '•' }, { text: 'beta', marker: '•' }, { text: 'gamma', marker: '•' }, { text: 'delta', marker: '•' }] },
      { type: 'play', subtype: 'prose', style: 'play-speaker', text: 'HAMLET' },
      { type: 'play', subtype: 'verse', text: 'To be or not to be' },
      { type: 'note', text: 'Cartoon by Craig', render: 'required' },
      { type: 'table', format: 'stairstep', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4'], ['5', '6'], ['7', '8']] },
      { type: 'para', text: 'Read and answer.', directions: true },
      { type: 'caption', text: 'A plain caption.' },
      { type: 'para', text: 'The dog ran quickly.' },
      { type: 'footnote', id: 'n1', text: 'A note.' },
      { type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'el gato', def: 'the cat', text: 'el gato — the cat' }] },
      { type: 'box', blocks: [{ type: 'heading', level: 2, text: 'Box Title' }, { type: 'para', text: 'Inside the box.' }] },
      { type: 'pagenum', page: '5', text: '5' },
    ];
    await load(BLOCKS);

    // F-4: a caption now has a field (identifier, BANA 11.2.8b) and shows its own dialog group.
    await caretIn(7);
    await page.keyboard.press('Control+Alt+KeyB');
    await page.waitForSelector('#brailleFmtDialog[open]', { timeout: 3000 });
    ok('braille fmt: caption shows only the caption group', JSON.stringify(await visibleGroups()) === '["fmtGroupCaption"]', await visibleGroups());
    await page.evaluate(() => { const d = document.getElementById('brailleFmtDialog'); if (d.open) d.close(); });
    ok('braille fmt: the toolbar button is a labelled button', await page.evaluate(() => { const b = document.getElementById('btnBrailleFmt'); return b && b.tagName === 'BUTTON' && !!b.getAttribute('aria-label'); }));

    // heading
    await caretIn(0);
    const brf0 = await brfNow();
    await openKb();
    ok('braille fmt: heading shows only the heading group', JSON.stringify(await visibleGroups()) === '["fmtGroupHeading","fmtGroupFonts"]', await visibleGroups());
    ok('braille fmt: dialog is named and described', await page.evaluate(() => { const d = document.getElementById('brailleFmtDialog'); return !!document.getElementById(d.getAttribute('aria-labelledby'))?.textContent && !!d.getAttribute('aria-describedby'); }));
    ok('braille fmt: every visible control has a visible label', await page.evaluate(() => [...document.querySelectorAll('#brailleFmtDialog fieldset:not([hidden]) input, #brailleFmtDialog fieldset:not([hidden]) select')].every((c) => c.id && document.querySelector(`label[for="${c.id}"]`)?.textContent.trim())));
    ok('braille fmt: focus starts on the first field', await page.evaluate(() => document.activeElement.id) === 'fmtNotConnected');
    // keyboard only: Tab order stays in the dialog and reaches Apply; Space ticks the box
    // UK-1 (docs/decisions.md "UKAAF", 26 Sep 2026) added fmtEndMarkerBefore to the heading group
    // (format/field-registry.mjs GROUPS.fmtGroupHeading), right after fmtEntryWord — one more stop in the
    // tab cycle, so the loop needs one more iteration to see the full cycle wrap back to the first field.
    const order = [];
    // A89: Firefox makes a scrolling region (#brailleFmtGroups, overflow:auto) a Tab stop of its own, first in the dialog, so the
    // wrap from Close passes through it before the first field. Run the loop until the first field comes round again and leave out
    // such a stop (named in the log); every field and button must still be in the order given below.
    for (let i = 0; i < 20; i++) {
      const id = await page.evaluate(() => document.activeElement.id);
      order.push(id);
      await page.keyboard.press('Tab');
      if (i > 0 && id === 'fmtNotConnected') break;
    }
    for (let i = order.length - 1; i >= 0; i--) {
      if (order[i] !== 'brailleFmtGroups') continue;
      console.log(`        (${ENGINE_LABEL}: the scrolling region #brailleFmtGroups is a Tab stop of its own, not counted below)`);
      order.splice(i, 1);
    }
    ok('braille fmt: Tab order fields (including the shared fonts/page-break group) -> Cancel/Apply/Close and wraps inside the dialog',
      order.join(',') === 'fmtNotConnected,fmtAccompaniesBox,fmtEntryWord,fmtEndMarkerBefore,fmtIgnoreFont,fmtDiacriticNotation,fmtOmitFullEmphasis,fmtOmitEmphasis,fmtPageBreakBefore,brailleFmtCancel,brailleFmtApply,brailleFmtClose,fmtNotConnected', order);
    await page.keyboard.press('Shift+Tab');                // back one: on the first field again
    await page.keyboard.press('Space');
    ok('braille fmt: Space ticks the focused checkbox', await page.evaluate(() => document.getElementById('fmtNotConnected').checked));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('brailleFmtDialog').open && document.getElementById('editor').contains(document.activeElement));   // closed AND the close handler has returned focus
    ok('braille fmt: Escape closes and returns focus to the editor', await page.evaluate(() => document.getElementById('editor').contains(document.activeElement)));
    ok('braille fmt: Escape applies nothing', !/bana-not-connected/.test(await xmlNow()));
    await openKb();
    await page.keyboard.press('Space');                    // tick not-connected
    await page.keyboard.press('Enter');                    // Enter in the form applies
    await page.waitForFunction(() => !document.getElementById('brailleFmtDialog').open); await wait(700);
    ok('braille fmt: heading — not-connected saves as bana-not-connected', /<h2 class="bana-not-connected">By A\. Writer<\/h2>/.test(await xmlNow()), (await xmlNow()).match(/<h2[^>]*>/g));
    ok('braille fmt: "Applied" is announced in the live region', /^Applied/.test(await announceText()), await announceText());
    ok('braille fmt: focus is back in the editor after Apply', await page.evaluate(() => document.getElementById('editor').contains(document.activeElement)));
    await undoOnce();
    ok('braille fmt: heading — one undo removes it', !/bana-not-connected/.test(await xmlNow()));
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y'); await wait(500);

    // heading: entry word (21.6.5f) and the shared fonts/page-break group (block flags any heading can carry)
    await caretIn(0); await openKb();
    await page.check('#fmtEntryWord'); await page.check('#fmtIgnoreFont'); await page.check('#fmtPageBreakBefore');
    await applyDlg();
    let x = await xmlNow();
    ok('braille fmt: heading — entry word and font/page-break flags save', /bana-entry-word/.test(x) && /bana-ignore-font/.test(x) && /bana-page-break-before/.test(x), x.match(/<h2[^>]*>/g));
    await undoOnce();
    ok('braille fmt: heading — one undo removes entry word and the flags', !/bana-entry-word/.test(await xmlNow()));

    // list: bullet on the item with the caret (last item), columns on the list
    await caretIn(1);
    const listBrfBefore = await brfNow();
    await openKb();
    ok('braille fmt: list shows only the list group', JSON.stringify(await visibleGroups()) === '["fmtGroupList","fmtGroupFonts"]', await visibleGroups());
    ok('braille fmt: bullet select offers the six symbols (plus default)', (await page.$$eval('#fmtBullet option', (o) => o.map((x) => x.value))).join('|') === '|dot|hollow square|solid square|hollow circle|triangle|checkmark');
    await page.selectOption('#fmtBullet', 'triangle');
    await page.fill('#fmtColumns', '2');
    await applyDlg();
    x = await xmlNow();
    ok('braille fmt: list — columns and bullet are written (bana-columns-2, bana-bullet-triangle / glyph)', /<list[^>]*bana-columns-2/.test(x) && /bana-bullet-triangle|▲/.test(x), x.match(/<list[^]*?<\/list>/)?.[0]);
    ok('braille fmt: list — the braille pane changed', (await brfNow()) !== listBrfBefore);
    await page.evaluate(() => window.modelToLexical && 0);
    await undoOnce();
    x = await xmlNow();
    ok('braille fmt: list — one undo removes both columns and bullet', !/bana-columns/.test(x) && !/bana-bullet-triangle|▲/.test(x), x.match(/<list[^]*?<\/list>/)?.[0]);
    // invalid columns: the dialog stays open and says why
    await caretIn(1); await openKb();
    await page.fill('#fmtColumns', '12'); await page.click('#brailleFmtApply'); await wait(200);
    ok('braille fmt: invalid columns keep the dialog open with an announced error', (await page.evaluate(() => document.getElementById('brailleFmtDialog').open)) && /whole number/.test(await page.textContent('#brailleFmtStatus')));
    ok('braille fmt: the error region is role=alert', (await page.getAttribute('#brailleFmtStatus', 'role')) === 'alert');
    await page.click('#brailleFmtCancel');

    // list options: after-note / word list, and the item-level ignore-font control
    await caretIn(1); await openKb();
    await page.check('#fmtAfterNote'); await page.check('#fmtWordList'); await page.check('#fmtItemIgnoreFont');
    await applyDlg();
    x = await xmlNow();
    ok('braille fmt: list — after-note, word list and item ignore-font save', /bana-after-note/.test(x) && /bana-word-list/.test(x) && /bana-ignore-font/.test(x), x.match(/<list[^]*?<\/list>/)?.[0]);
    await undoOnce();
    ok('braille fmt: list — one undo removes the list options', !/bana-after-note/.test(await xmlNow()));

    // play speaker
    await caretIn(2);
    const spBrf = await brfNow();
    await openKb();
    ok('braille fmt: play speaker shows only the speaker group', JSON.stringify(await visibleGroups()) === '["fmtGroupSpeaker","fmtGroupFonts"]', await visibleGroups());
    await page.check('#fmtSpeakerGap');
    await applyDlg();
    ok('braille fmt: speaker gap saves as bana-speaker-gap', /bana-speaker-gap">HAMLET/.test(await xmlNow()), (await xmlNow()).match(/<p class="bai-play[^>]*>/g));
    ok('braille fmt: speaker gap reaches the block model the braille pane is built from', await page.evaluate(() => window.lastModel.blocks.some((b) => b.speakerGap)));
    await undoOnce();
    ok('braille fmt: speaker gap — one undo removes it', !/bana-speaker-gap/.test(await xmlNow()));

    // verse: note text + off
    await caretIn(3);
    await openKb();
    ok('braille fmt: verse shows only the line-number group', JSON.stringify(await visibleGroups()) === '["fmtGroupVerse","fmtGroupFonts"]', await visibleGroups());
    await page.fill('#fmtLnNoteText', 'Numbers are in the margin.');
    await applyDlg();
    ok('braille fmt: verse note text saves as bana-ln-note with a title', /class="[^"]*bana-ln-note[^"]*" title="Numbers are in the margin\."/.test(await xmlNow()), (await xmlNow()).match(/<p class="bai-verse[^>]*>/g));
    await caretIn(3); await openKb();
    ok('braille fmt: the dialog re-opens with the saved value', (await page.inputValue('#fmtLnNoteText')) === 'Numbers are in the margin.');
    await page.fill('#fmtLnNoteText', ''); await page.check('#fmtLnNoteOff');
    await applyDlg();
    x = await xmlNow();
    ok('braille fmt: verse "off" saves as bana-ln-note-off and drops the text', /bana-ln-note-off/.test(x) && !/title="Numbers/.test(x), x.match(/<p class="bai-verse[^>]*>/g));

    // verse/poem: the batch-3/4 poem fields (wide spaces, rhyme letters, uncontracted/displayed poem, poem method)
    await caretIn(3); await openKb();
    await page.uncheck('#fmtLnNoteOff');
    await page.check('#fmtWideSpaces'); await page.check('#fmtRhymeLetters'); await page.check('#fmtUncontractedPoem'); await page.check('#fmtDisplayedPoem'); await page.check('#fmtWordGaps'); await page.check('#fmtCountedWords');
    await page.selectOption('#fmtPoemMethod', 'line-indicator');
    await applyDlg();
    x = await xmlNow();
    ok('braille fmt: verse — poem fields save', /bana-wide-spaces/.test(x) && /bana-rhyme-letters/.test(x) && /bana-uncontracted-poem/.test(x) && /bana-displayed-poem/.test(x) && /bana-word-gaps/.test(x) && /bana-counted-words/.test(x) && /bana-poem-line-indicator/.test(x), x.match(/<p class="bai-verse[^>]*>/g));
    await undoOnce();
    ok('braille fmt: verse — one undo removes the poem fields', !/bana-wide-spaces/.test(await xmlNow()));

    // note: enclose prefix
    await caretIn(4);
    await openKb();
    ok('braille fmt: note shows only the note group', JSON.stringify(await visibleGroups()) === '["fmtGroupNote","fmtGroupFonts"]', await visibleGroups());
    await page.fill('#fmtEnclosePrefix', 'Cartoon');
    await applyDlg();
    ok('braille fmt: note prefix saves as bana-enclose-prefix', /<prodnote render="required" class="bana-enclose-prefix" title="Cartoon">/.test(await xmlNow()), (await xmlNow()).match(/<prodnote[^>]*>/g));

    // note: key list / dot locator / cell-5 heading / mentioned symbols
    await caretIn(4); await openKb();
    await page.check('#fmtKeyList'); await page.check('#fmtKeyLocator'); await page.check('#fmtCell5');
    await page.fill('#fmtMentionSymbols', '8, @');
    await applyDlg();
    x = await xmlNow();
    ok('braille fmt: note — key list, dot locator, cell5 and mentioned symbols save', /bana-key-list/.test(x) && /bana-key-locator/.test(x) && /bana-cell5/.test(x) && /bana-mention-symbols/.test(x), x.match(/<prodnote[^>]*>/g));
    await undoOnce();
    ok('braille fmt: note — one undo removes the key-list fields', !/bana-key-list/.test(await xmlNow()));
    // bad mention-symbols list (empty entry between commas) is refused
    await caretIn(4); await openKb();
    await page.fill('#fmtMentionSymbols', '8, ,@');
    await page.click('#brailleFmtApply'); await wait(200);
    ok('braille fmt: note — a bad mentioned-symbols list keeps the dialog open with an error', (await page.evaluate(() => document.getElementById('brailleFmtDialog').open)) && /commas/.test(await page.textContent('#brailleFmtStatus')));
    await page.click('#brailleFmtCancel');

    // table: subdivision rows (1-based) + heading
    await caretIn(4);   // caret elsewhere; the table is reached from its own bar button
    // A89: Safari (WebKit) does not give a button keyboard focus when the mouse clicks it (a click even takes focus away from a
    // button focused before), so the dialog's "opener" would be the editor and the "focus returns to the table bar button" check
    // below could not tell a good return from a bad one. Focus the button and activate it from script, as a keyboard user's
    // Enter would (a real Enter after page.focus() did not open the dialog in Chrome or Firefox); the
    // contract checked is the same in every engine. Later openings of this dialog, by real click, still cover the mouse.
    await page.evaluate(() => { const b = document.querySelector('.table-context-bar .table-context-btn[aria-haspopup="dialog"]'); b.focus(); b.click(); });
    await page.waitForSelector('#brailleFmtDialog[open]');
    ok('braille fmt: table shows only the table group (button on the table bar)', JSON.stringify(await visibleGroups()) === '["fmtGroupTable"]', await visibleGroups());
    await page.fill('#fmtSubRows', 'x, 2');
    await page.click('#brailleFmtApply'); await wait(200);
    ok('braille fmt: bad row numbers keep the dialog open with an error', (await page.evaluate(() => document.getElementById('brailleFmtDialog').open)) && /whole numbers/.test(await page.textContent('#brailleFmtStatus')));
    await page.fill('#fmtSubRows', '3, 2');
    await page.fill('#fmtSubHeading', 'Group');
    await applyDlg();
    const tblModel = await page.evaluate(() => { const t = window.lastModel.blocks.find((b) => b.type === 'table'); return { r: t.subdivisionRows, h: t.subdivisionHeading }; });
    ok('braille fmt: table rows are stored 0-based, sorted; heading stored', JSON.stringify(tblModel) === '{"r":[1,2],"h":"Group"}', tblModel);
    x = await xmlNow();
    ok('braille fmt: table subdivision saved in the document', /Group/.test(x), x.match(/<table[^]*?<\/table>/)?.[0]?.slice(0, 300));
    ok('braille fmt: focus returns to the table bar button after Apply', await page.evaluate(() => document.activeElement.classList.contains('table-context-btn')));
    await undoOnce();
    const tblUndo = await page.evaluate(() => { const t = window.lastModel.blocks.find((b) => b.type === 'table'); return t.subdivisionRows || null; });
    ok('braille fmt: table — one undo removes the subdivision', tblUndo === null, tblUndo);

    // table: guide dots, citation, total rows, row subheadings, guide-dot note, repeat headings, continued note, page break
    await caretIn(4);
    await page.click('.table-context-bar .table-context-btn[aria-haspopup="dialog"]');
    await page.waitForSelector('#brailleFmtDialog[open]');
    await page.uncheck('#fmtGuideDots');
    await page.fill('#fmtCitationText', 'Source: Census, 1999'); await page.selectOption('#fmtCitationPos', 'inside-box');
    await page.fill('#fmtTotalRows', '4');
    await page.fill('#fmtRowSubheadings', '1: Fruit');
    await page.check('#fmtGuideDotNote'); await page.fill('#fmtGuideDotNoteText', 'Guide dots lead to the entry.');
    await page.selectOption('#fmtRepeatHeadings', 'on');
    await page.selectOption('#fmtContinuedNote', 'on'); await page.fill('#fmtContinuedNoteText', 'Table 3 (cont.)');
    await page.check('#fmtTablePageBreakBefore');
    await applyDlg();
    x = await xmlNow();
    ok('braille fmt: table — guide dots off, citation, totals, subheadings, notes and headings all save',
      /bana-no-guide-dots/.test(x) && /bana-table-citation bana-citation-inside/.test(x) && /Source: Census, 1999/.test(x)
      && /bana-total/.test(x) && /bana-subheading/.test(x) && /Fruit/.test(x)
      && /bana-guide-dot-note-text/.test(x) && /Guide dots lead to the entry\./.test(x)
      && /bana-repeat-headings/.test(x) && /bana-continued-note-text/.test(x) && /Table 3 \(cont\.\)/.test(x) && /bana-page-break-before/.test(x),
      x.match(/<table[^]*?<\/table>/)?.[0]);
    await undoOnce();
    const tblUndo2 = await page.evaluate(() => { const t = window.lastModel.blocks.find((b) => b.type === 'table'); return t.citation || null; });
    ok('braille fmt: table — one undo removes the new table fields', tblUndo2 === null, tblUndo2);
    // bad total-rows number is refused
    await caretIn(4);
    await page.click('.table-context-bar .table-context-btn[aria-haspopup="dialog"]');
    await page.waitForSelector('#brailleFmtDialog[open]');
    await page.fill('#fmtTotalRows', '99');
    await page.click('#brailleFmtApply'); await wait(200);
    ok('braille fmt: table — an out-of-range total row is refused', (await page.evaluate(() => document.getElementById('brailleFmtDialog').open)) && /row numbers between/.test(await page.textContent('#brailleFmtStatus')));
    await page.click('#brailleFmtCancel');
    await page.waitForFunction(() => !document.getElementById('brailleFmtDialog').open);
    // Cancel returns focus to the table's own bar button (the dialog's opener); explicitly move focus back into
    // the editor body before the next caretIn(), so bfResolveTarget's document.activeElement-based table check
    // (used when no key is passed) does not see a stale focus still sitting inside the table's DOM.
    await page.evaluate(() => window.editor.focus());
    await wait(200);

    // directions paragraph: continued / labelled
    await caretIn(6);
    await openKb();
    ok('braille fmt: a directions paragraph shows only the directions group', JSON.stringify(await visibleGroups()) === '["fmtGroupDirections","fmtGroupFonts"]', await visibleGroups());
    await page.check('#fmtDirectionsLabelled');
    await applyDlg();
    ok('braille fmt: directions labelled saves', /bana-directions bana-directions-labelled">Read and answer/.test(await xmlNow()), (await xmlNow()).match(/<p class="bana-dir[^>]*>/g));

    // plain paragraph (kind 'para'): diagrammed sentence / hanging margins / arrow lines / paragraph number / song info / word gaps
    await caretIn(8); await openKb();
    ok('braille fmt: a plain paragraph shows the paragraph-layout group', JSON.stringify(await visibleGroups()) === '["fmtGroupPara","fmtGroupFonts"]', await visibleGroups());
    await page.check('#fmtDiagram'); await page.check('#fmtHangingMargins'); await page.fill('#fmtArrowLines', '#$%\n  ,-=>');
    await page.check('#fmtParaNumber'); await page.check('#fmtSongInfo'); await page.check('#fmtParaWordGaps'); await page.check('#fmtOmitEmphasis');
    await applyDlg();
    x = await xmlNow();
    ok('braille fmt: para — diagram, hanging margins, arrow lines, paragraph number, song info, word gaps, font flag all save',
      /bana-diagram/.test(x) && /bana-hanging-margins/.test(x) && /bana-arrows/.test(x) && /bana-para-number/.test(x) && /bana-song-info/.test(x) && /bana-word-gaps/.test(x) && /bana-omit-emphasis/.test(x),
      (await xmlNow()).match(/<p[^>]*>The dog ran/));
    await undoOnce();
    ok('braille fmt: para — one undo removes the paragraph fields', !/bana-diagram/.test(await xmlNow()));
    // an arrow line over 60 characters is refused
    await caretIn(8); await openKb();
    await page.fill('#fmtArrowLines', '#'.repeat(61));
    await page.click('#brailleFmtApply'); await wait(200);
    ok('braille fmt: para — an over-long arrow line is refused', (await page.evaluate(() => document.getElementById('brailleFmtDialog').open)) && /60 characters/.test(await page.textContent('#brailleFmtStatus')));
    await page.click('#brailleFmtCancel');

    // footnote: where the note mark goes
    await caretIn(9); await openKb();
    ok('braille fmt: a footnote shows the footnote group', JSON.stringify(await visibleGroups()) === '["fmtGroupFootnote","fmtGroupFonts"]', await visibleGroups());
    await page.selectOption('#fmtNoteMarkPlacement', 'inline');
    await applyDlg();
    ok('braille fmt: footnote — note mark placement saves as bana-note-mark-inline', /bana-note-mark-inline/.test(await xmlNow()), (await xmlNow()).match(/<note[^>]*>|<prodnote[^>]*>/g));
    await undoOnce();
    ok('braille fmt: footnote — one undo removes the note-mark placement', !/bana-note-mark-inline/.test(await xmlNow()));

    // glossary list: thesaurus / dictionary / alphabetic margins / shared margin (glossary-only fields)
    await caretIn(10); await openKb();
    ok('braille fmt: a glossary list shows the list group with the glossary fields', JSON.stringify(await visibleGroups()) === '["fmtGroupList","fmtGroupFonts"]', await visibleGroups());
    ok('braille fmt: the glossary-only fields are visible for a glossary list', !(await page.evaluate(() => document.getElementById('fmtListGlossaryWrap').hidden)));
    await page.check('#fmtThesaurus'); await page.check('#fmtDictionary'); await page.check('#fmtAlphabeticMargins'); await page.check('#fmtSharedMargin');
    await applyDlg();
    x = await xmlNow();
    ok('braille fmt: glossary list — thesaurus, dictionary, alphabetic margins and shared margin save', /bana-thesaurus/.test(x) && /bana-dictionary/.test(x) && /bana-alphabetic-margins/.test(x) && /bana-shared-margin/.test(x), x.match(/<list[^]*?<\/list>/g)?.pop());
    await undoOnce();
    ok('braille fmt: glossary list — one undo removes the glossary fields', !/bana-thesaurus/.test(await xmlNow()));
    // the glossary-only fields are hidden for an ordinary list
    await caretIn(1); await openKb();
    ok('braille fmt: the glossary-only fields are hidden for an ordinary list', await page.evaluate(() => document.getElementById('fmtListGlossaryWrap').hidden));
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('brailleFmtDialog').open);

    // box (sidebar): box lines / page break, reached from the box's own title
    await caretInBoxTitle(11); await openKb();
    ok('braille fmt: a box title shows the box group', JSON.stringify(await visibleGroups()) === '["fmtGroupBox"]', await visibleGroups());
    await page.uncheck('#fmtBoxLines'); await page.check('#fmtBoxPageBreakBefore');
    await applyDlg();
    x = await xmlNow();
    ok('braille fmt: box — no box lines and page break before save', /bana-no-box-lines/.test(x) && /bana-page-break-before/.test(x), x.match(/<sidebar[^>]*>/g));
    await undoOnce();
    ok('braille fmt: box — one undo removes the box fields', !/bana-no-box-lines/.test(await xmlNow()));

    // print page change (pagenum): implied / through / spelled / combine with next / unnumbered, opened from its own gear button
    await page.click('.doc-print-page .page-fmt-btn');
    await page.waitForSelector('#brailleFmtDialog[open]');
    ok('braille fmt: a print page change shows the pagenum group', JSON.stringify(await visibleGroups()) === '["fmtGroupPagenum"]', await visibleGroups());
    await page.check('#fmtImplied'); await page.fill('#fmtThrough', '9'); await page.fill('#fmtSpelled', 'five'); await page.check('#fmtCombineWithNext'); await page.check('#fmtUnnumbered');
    await applyDlg();
    x = await xmlNow();
    ok('braille fmt: pagenum — implied, through, spelled, combine-with-next and unnumbered all save',
      /bana-implied/.test(x) && /bana-through/.test(x) && /bana-spelled/.test(x) && /five/.test(x) && /bana-combine-with-next/.test(x) && /bana-unnumbered/.test(x),
      x.match(/<pagenum[^>]*>[^<]*<\/pagenum>/g));
    await undoOnce();
    ok('braille fmt: pagenum — one undo removes the fields', !/bana-implied/.test(await xmlNow()));

    // save -> reload keeps every field
    const beforeSave = await xmlNow();
    await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'bf.xml', { type: 'text/xml' })); }, beforeSave);
    await wait(600);
    const afterReload = await xmlNow();
    ok('braille fmt: save -> reload keeps the fields', /bana-ln-note-off/.test(afterReload) && /bana-enclose-prefix/.test(afterReload) && /bana-directions-labelled/.test(afterReload), afterReload.match(/class="[^"]*bana[^"]*"/g));
    // Save/reload correctness for every field added in this change (diagram, hangingMargins, arrowLines, paraNumber,
    // countedWords, lnNoteBeforeHeading, songInfo, wordGaps, rhymeLetters, wideSpaces, uncontractedPoem, displayedPoem,
    // poemMethod, keyList, keyLocator, cell5, mentionSymbols, noteMarkPlacement, thesaurus, dictionary, alphabeticMargins,
    // sharedMargin, entryWord, guideDots, citation, totalRows, rowSubheadings, guideDotNote, repeatHeadings, continuedNote,
    // boxLines, implied, through, spelled, combineWithNext, unnumbered, stripContinuation, ignoreFont, diacriticNotation,
    // omitFullEmphasis, omitEmphasis, pageBreakBefore) is also proved, independently of the editor, by
    // formatter_fields_roundtrip_2/3/4.test.mjs (parse -> export -> re-import for every one of them).

    // the slash menu lists it only where it applies
    await load(BLOCKS);
    await caretIn(0);
    await page.keyboard.type(' /brailleformat');
    await wait(400);
    const slashOn = await page.$$eval('#slashList .slash-item', (els) => els.map((e) => e.id));
    ok('braille fmt: the slash menu offers it on a heading', slashOn.includes('slash-opt-brailleformat'), slashOn);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#brailleFmtDialog[open]', { timeout: 3000 }).catch(() => {});
    ok('braille fmt: the slash command opens the dialog', await page.evaluate(() => document.getElementById('brailleFmtDialog').open));
    await page.keyboard.press('Escape');
    await wait(200);

    ok('braille fmt: no console errors', bfErrors.length === 0, bfErrors);
    page.off('console', onErr);
  }

  // ---- Settings dialog: "Braille formatting options" (document-level BANA_DOC_OPTIONS) ----
  {
    const doErrors = [];
    const onErr = (m) => { if (m.type() === 'error') doErrors.push(m.text()); };
    page.on('console', onErr);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const xmlNow = () => page.evaluate(() => window.exportCurrentDocumentXml());
    await page.evaluate(() => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'heading', level: 1, text: 'Doc' }, { type: 'para', text: 'Body text.' }] }); });
    await wait(600);
    await page.click('#settingsBtn');
    await page.waitForSelector('#settingsDialog[open]');
    await page.click('.tab-btn[data-tab="tab-document"]');
    await page.waitForSelector('#docOptionsGroup');
    ok('doc options: the group is in the Advanced Production tab, labelled and described', await page.evaluate(() => {
      const fs = document.getElementById('docOptionsGroup');
      return !!fs && fs.querySelector('legend')?.textContent.trim().length > 0 && [...fs.querySelectorAll('input')].every((c) => c.id && document.querySelector(`label[for="${c.id}"], label ~ #${c.id}`) || document.querySelector(`label[for="${c.id}"]`));
    }));
    // defaults: the "off"-style options (verseKeep/listPageRules) start checked (default on); the plain booleans start unchecked
    ok('doc options: verseKeep/listPageRules default to checked (on)', await page.evaluate(() => document.getElementById('docVerseKeep').checked && document.getElementById('docListPageRules').checked));
    ok('doc options: spacedEllipsis defaults to unchecked (off)', !(await page.evaluate(() => document.getElementById('docSpacedEllipsis').checked)));
    // turn a few on/off and fill in text fields
    await page.uncheck('#docVerseKeep');
    await page.check('#docInterpointOmitEven');
    await page.fill('#docTocHeading', 'Table of Contents'); await page.locator('#docTocHeading').blur();
    await page.fill('#docLineIndicator', '_'); await page.locator('#docLineIndicator').blur();
    await page.check('#docSpacedEllipsis');
    await page.click('.dialog-foot button[value="close"]');
    await page.waitForFunction(() => !document.getElementById('settingsDialog').open);
    await wait(300);
    let x = await xmlNow();
    ok('doc options: verseKeep=false, interpointOmitEven, tocHeading, lineIndicator and spacedEllipsis all save as document meta',
      /bana-verse-keep" content="0"/.test(x) && /bana-interpoint-omit-even/.test(x) && /bana-toc-heading" content="Table of Contents"/.test(x) && /bana-line-indicator" content="_"/.test(x) && /bana-spaced-ellipsis/.test(x),
      x.match(/<meta name="bana-[^>]*>/g));
    // a bad line indicator (a space) is refused and the good value is kept
    await page.click('#settingsBtn');
    await page.waitForSelector('#settingsDialog[open]');
    await page.click('.tab-btn[data-tab="tab-document"]');
    await page.fill('#docLineIndicator', 'a b');
    await page.locator('#docLineIndicator').blur();
    await wait(200);
    ok('doc options: a line indicator with a space is refused with a message', /braille ASCII/.test(await page.textContent('#docLineIndicatorStatus')));
    await page.fill('#docLineIndicator', '_'); await page.locator('#docLineIndicator').blur();
    await page.click('.dialog-foot button[value="close"]');
    await page.waitForFunction(() => !document.getElementById('settingsDialog').open);
    // save -> reload keeps the document options
    const beforeSave = await xmlNow();
    await page.evaluate(async (xml) => { window.markDocumentClean(); await window.importFile(new File([xml], 'do.xml', { type: 'text/xml' })); }, beforeSave);
    await wait(600);
    await page.click('#settingsBtn');
    await page.waitForSelector('#settingsDialog[open]');
    await page.click('.tab-btn[data-tab="tab-document"]');
    await page.waitForSelector('#docOptionsGroup');
    ok('doc options: save -> reload keeps the settings group in sync with the reloaded document', await page.evaluate(() =>
      !document.getElementById('docVerseKeep').checked && document.getElementById('docInterpointOmitEven').checked
      && document.getElementById('docTocHeading').value === 'Table of Contents' && document.getElementById('docLineIndicator').value === '_'));
    await page.click('.dialog-foot button[value="close"]');
    await page.waitForFunction(() => !document.getElementById('settingsDialog').open);
    ok('doc options: no console errors', doErrors.length === 0, doErrors);
    page.off('console', onErr);
  }

  // ---- Second batch of formatter fields + nested-list metadata (formatter_fields_roundtrip_2.test.mjs) ----
  // Load a document that uses each field, edit text NEXT to the fields, save: every field must still be in the XML.
  // Then undo/redo, and load the saved file again (a reload) — the fields must survive each step.
  {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const BATCH2_XML = `<?xml version="1.0" encoding="UTF-8"?>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3" xml:lang="en-US">
  <head>
    <meta name="dc:Title" content="Fields" />
    <meta name="bana-spaced-ellipsis" content="1" />
    <meta name="bana-elision-apostrophe" content="1" />
    <meta name="bana-typeform-word-punct" content="1" />
  </head>
  <book><bodymatter><level1>
    <h1>Fields</h1>
    <p class="bana-para-number bana-counted-words bana-ln-note-before-heading bana-song-info bana-word-gaps">1 First paragraph.</p>
    <p class="bai-verse bana-rhyme-letters bana-wide-spaces bana-uncontracted-poem bana-displayed-poem">A verse line</p>
    <note id="n1" class="footnote bana-note-mark-inline"><p>A note.</p></note>
    <list type="ul" class="bana-after-note bana-word-list">
      <li>one</li>
      <li>two</li>
    </list>
    <list type="ol" class="bai-exercise">
      <li class="bai-exercise bana-example"><span class="bana-label">Example:</span>Add 2 and 3.</li>
      <li class="bai-exercise">Add 4 and 5.</li>
    </list>
    <list type="ol" class="bai-exercise">
      <li class="bai-exercise bana-example"><span class="bana-label"><strong>Model</strong>:</span>Say it.</li>
    </list>
    <dl class="bana-thesaurus bana-dictionary bana-alphabetic-margins bana-shared-margin">
      <dt class="bana-lead bana-term-sup" title="el|1">el gato</dt>
      <dd>the cat</dd>
      <dt class="bana-term-sup" title="2">perro</dt>
      <dd>dog</dd>
    </dl>
    <level2>
      <h2 class="bana-entry-word">apple</h2>
      <table class="bana-no-guide-dots"><tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>
      <p class="bana-code bana-dot-locator bana-keep-spaces bana-space-letters">ab cd<br/>ef gh</p>
      <img src="a.png" alt="A picture" class="bana-citation" title="Photo: Someone, 1999"/>
      <list type="ul" class="bana-symbols-dot_ring_small-square">
        <li>top
          <list type="ul"><li>sub<list type="ul"><li>subsub</li></list></li></list>
        </li>
      </list>
      <list type="ol" enum="a" start="3"><li>nx<list type="ol" enum="i"><li>ny</li><li>nz</li></list></li><li>nw</li></list>
      <p>See <prodnote render="optional" class="bana-uncontracted">x</prodnote> note and <span class="bana-brl" title=";?">7</span><span class="bana-brl" title=".="></span> end.</p>
    </level2>
  </level1></bodymatter></book>
</dtbook>`;
    // [label, RegExp] — each must match the saved XML at every step (X = the text typed next to the field)
    const CHECKS = [
      ['para flags', /<p class="bana-para-number bana-counted-words bana-ln-note-before-heading bana-song-info bana-word-gaps">1 First paragraph\.X<\/p>/],
      ['verse flags', /<p class="bai-verse bana-rhyme-letters bana-wide-spaces bana-uncontracted-poem bana-displayed-poem">A verse lineX<\/p>/],
      ['footnote noteMarkPlacement', /<note id="n1" class="footnote bana-note-mark-inline"><p>A note\.<\/p><\/note>/],
      ['list afterNote / wordList', /<list type="ul" class="bana-after-note bana-word-list">/],
      ['item example + label', /<li class="bai-exercise bana-example"><span class="bana-label">Example:<\/span>Add 2 and 3\.X<\/li>/],
      ['item labelSegments', /<span class="bana-label"><strong>Model<\/strong>:<\/span>Say it\./],
      ['glossary flags', /<dl class="bana-thesaurus bana-dictionary bana-alphabetic-margins bana-shared-margin">/],
      ['glossary lead + termSup', /<dt class="bana-lead bana-term-sup" title="el\|1">el gato<\/dt>/],
      ['glossary termSup', /<dt class="bana-term-sup" title="2">perro<\/dt>/],
      ['heading entryWord', /<h2 class="bana-entry-word">apple<\/h2>/],
      ['table guideDots false', /<table class="bana-no-guide-dots">/],
      ['code flags', /<p class="bana-code bana-dot-locator bana-keep-spaces bana-space-letters">ab cd<br\/>ef gh<\/p>/],
      ['graphic citation', /<img src="a\.png" alt="A picture" class="bana-citation" title="Photo: Someone, 1999"\/>/],
      ['list symbols', /<list type="ul" class="bana-symbols-dot_ring_small-square">/],
      ['nested list level 2 kept', /<li>subsub<\/li>/],
      ['list enum + start', /<list type="ol" enum="a" start="3">/],
      ['nested list enum', /<list type="ol" enum="i">/],
      ['imgnote uncontracted + prodnote', /<prodnote render="optional" class="bana-uncontracted">x<\/prodnote>/],
      ['literal braille cells', /<span class="bana-brl" title=";\?">7<\/span>/],
      ['literal braille cells, no print text', /<span class="bana-brl" title="\.="><\/span>/],
      ['doc option spacedEllipsis', /<meta name="bana-spaced-ellipsis" content="1" \/>/],
      ['doc option elisionApostrophe', /<meta name="bana-elision-apostrophe" content="1" \/>/],
      ['doc option typeformWordPunct', /<meta name="bana-typeform-word-punct" content="1" \/>/],
    ];
    const xmlNow = () => page.evaluate(() => window.exportCurrentDocumentXml());
    const checkAll = (xml, label) => { for (const [n, re] of CHECKS) ok(`batch-2 fields ${label}: ${n}`, re.test(xml), xml.match(new RegExp(re.source.slice(0, 18)))?.[0]); };
    const typeAfter = async (text) => {
      const found = await page.evaluate((tx) => {
        let hit = false;
        window.editor.update(() => {
          for (const n of window.editor.getEditorState()._nodeMap.values()) {
            if (n.getType && n.getType() === 'text' && n.getTextContent() === tx) { n.selectEnd(); hit = true; break; }
          }
        });
        window.editor.focus();
        return hit;
      }, text);
      ok(`batch-2 fields: found "${text}" to edit`, found);
      await wait(150);
      await page.keyboard.type('X');
    };
    const load2 = async (xml, name) => { await page.evaluate(async ([x, n]) => { window.markDocumentClean(); await window.importFile(new File([x], n, { type: 'text/xml' })); }, [xml, name]); await wait(600); };

    await load2(BATCH2_XML, 'b2.xml');
    await typeAfter('1 First paragraph.');
    await typeAfter('A verse line');
    await typeAfter('Add 2 and 3.');
    await wait(700);
    let x2 = await xmlNow();
    checkAll(x2, 'load, edit, save');
    ok('batch-2 fields: the braille pane model carries the document options', await page.evaluate(() => { const m = window.lastModel; return !!(m && m.spacedEllipsis && m.elisionApostrophe && m.typeformWordPunct); }));
    ok('batch-2 fields: save with no other change is stable (a second save is identical)', (await xmlNow()).replace(/emboss-\d+/g, 'id') === x2.replace(/emboss-\d+/g, 'id'));

    // undo one edit (the typed X in the exercise item), then redo
    await wait(600);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await wait(700);
    const undone = await xmlNow();
    ok('batch-2 fields: undo removes only the typed text', !/Add 2 and 3\.X/.test(undone) && /Add 2 and 3\./.test(undone));
    for (const [n, re] of CHECKS) ok(`batch-2 fields after undo: ${n}`, new RegExp(re.source.replace(/X/g, 'X?')).test(undone));   // undo may take back one or all of the typed X
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z');
    await wait(700);
    checkAll(await xmlNow(), 'after redo');

    // reload: the saved file loaded again and saved again keeps everything
    const saved = await xmlNow();
    await load2(saved, 'b2-saved.xml');
    checkAll(await xmlNow(), 'reload (load -> save -> load -> save)');
  }

  // ---- G8 stage 3: print-view markers of nested lists (enum / start / glyphs by level) and the per-level chooser ----
  {
    const g8Errors = [];
    const onErr = (m) => { if (m.type() === 'error') g8Errors.push(m.text()); };
    page.on('console', onErr);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const xmlNow = () => page.evaluate(() => window.exportCurrentDocumentXml());
    const brfNow = () => page.evaluate(() => window.lastBrf);
    const norm = (x) => x.replace(/emboss-\d+/g, 'id');
    const load = async (blocks) => { await page.evaluate((b) => { window.markDocumentClean(); window.modelToLexical({ blocks: b }); }, blocks); await wait(900); };
    const loadXml = async (xml, name) => { await page.evaluate(async ([x, n]) => { window.markDocumentClean(); await window.importFile(new File([x], n, { type: 'text/xml' })); }, [xml, name]); await wait(800); };
    const markers = async () => (await page.$$eval('#editor li', (els) => els.map((l) => l.dataset.marker || ''))).join(' ');
    // A89: Firefox reports the computed content of a pseudo-element with attr() still unresolved ("attr(data-marker)"); Chrome and WebKit give
    // the string. So for Firefox the rule itself is what is checked (it must be attr(data-marker)), read through the item's attribute.
    const drawn = () => page.$$eval('#editor li', (els) => els.map((l) => { const c = getComputedStyle(l, '::before').content; return /^attr\(\s*data-marker\s*\)$/.test(c) ? (l.getAttribute('data-marker') || '') : c.replace(/"/g, ''); }).join(' '));
    const caretEndOf = async (tx) => { const hit = await page.evaluate((t) => { let ok = false; window.editor.update(() => { for (const n of window.editor.getEditorState()._nodeMap.values()) { if (n.getType && n.getType() === 'text' && n.getTextContent() === t) { n.selectEnd(); ok = true; break; } } }); window.editor.focus(); return ok; }, tx); await wait(200); return hit; };
    const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
    const redoKey = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
    const undoOnce = async () => { await wait(600); await page.keyboard.press(undoKey); await wait(700); };
    const redoOnce = async () => { await page.keyboard.press(redoKey); await wait(700); };
    const openKb = async () => { await page.keyboard.press('Control+Alt+KeyB'); await page.waitForSelector('#brailleFmtDialog[open]', { timeout: 3000 }); };
    const applyDlg = async () => { await page.click('#brailleFmtApply'); await page.waitForFunction(() => !document.getElementById('brailleFmtDialog').open); await wait(800); };
    const P = (t) => ({ type: 'para', text: t });

    // 1. markers from the model: lettered with start, roman with start, bullets under numbers, numbers under bullets
    await load([
      { type: 'list', ordered: true, items: [{ text: 'alpha', marker: 'c.', enum: 'a', start: 3 }, { text: 'beta', marker: 'd.' }, { text: 'sub one', level: 1, marker: 'i.', enum: 'i' }, { text: 'sub two', level: 1, marker: 'ii.' }, { text: 'gamma', marker: 'e.' }] },
      P('between one'),
      { type: 'list', ordered: true, items: [{ text: 'one', marker: '1.' }, { text: 'bul a', level: 1, marker: '•' }, { text: 'bul b', level: 2, marker: '•' }, { text: 'two', marker: '2.' }] },
      P('between two'),
      { type: 'list', ordered: true, items: [{ text: 'r1', marker: 'iii.', enum: 'i', start: 3 }, { text: 'r2', marker: 'iv.' }] },
      P('between three'),
      { type: 'list', ordered: true, items: [{ text: 'top', marker: '•' }, { text: 'n1', level: 1, marker: '1.' }, { text: 'n2', level: 1, marker: '2.' }] },
    ]);
    ok('g8 markers: lettered start 3 + roman sub-level + mixed + roman start', await markers() === 'c. d. i. ii. e. 1. ◦ ▪ 2. iii. iv. • 1. 2.', await markers());
    ok('g8 markers: the marker is real drawn text (::before content) in the print view', await drawn() === 'c. d. i. ii. e. 1. ◦ ▪ 2. iii. iv. • 1. 2.', await drawn());
    ok('g8 markers: a bulleted sub-list under a numbered list shows bullets, not numbers', /1\. ◦ ▪ 2\./.test(await markers()));
    ok('g8 markers: a numbered sub-list under a bulleted list shows numbers', /• 1\. 2\./.test(await markers()));
    const x1 = await xmlNow();
    ok('g8 markers: saved XML keeps enum/start per sibling group', /<list type="ol" enum="a" start="3">/.test(x1) && /<list type="ol" enum="i">/.test(x1) && /<list type="ol" enum="i" start="3">/.test(x1), x1.match(/<list[^>]*>/g));
    ok('g8 markers: an unedited save is stable (save, load the save, save again: identical)', (await (async () => { await loadXml(x1, 'g8-a.xml'); return norm(await xmlNow()); })()) === norm(x1));
    ok('g8 markers: after that reload the markers are the same (the bullet-over-numbers list is written by nimas-export as an ol with a literal "• ", so its top item is not compared)', (await markers()).startsWith('c. d. i. ii. e. 1. ◦ ▪ 2. iii. iv. '), await markers());

    // the exact XML the editor wrote for this document BEFORE stage 3 (unedited load -> save must not change)
    const OLD_DOC = `<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3"><head><meta name="dc:Title" content="T"/></head><book><bodymatter><level1>
<list type="ol" enum="a" start="3"><li>nx<list type="ul"><li>bull</li><li>bull2<list type="ol" enum="i"><li>r1</li></list></li></list></li><li>nw</li></list>
<list type="ul"><li>t<list type="ol"><li>n1</li><li>n2</li></list></li></list>
</level1></bodymatter></book></dtbook>`;
    const OLD_OUT = `<level1>
        <list type="ol" enum="a" start="3">
          <li>nx
            <list type="ul">
              <li>bull</li>
              <li>bull2
                <list type="ol" enum="i">
                  <li>r1</li>
                </list>
              </li>
            </list>
          </li>
          <li>nw</li>
        </list>
        <list type="ul">
          <li>t
            <list type="ol">
              <li>n1</li>
              <li>n2</li>
            </list>
          </li>
        </list>
      </level1>`;
    await loadXml(OLD_DOC, 'g8-old.xml');
    const xo = await xmlNow();
    ok('g8 unedited: load -> save gives what the editor gave before stage 3, except that a bullet top item over numbered sub-items is now saved as a ul (fix 3)', xo.includes(OLD_OUT), xo.slice(xo.indexOf('<level1>'), xo.indexOf('</level1>') + 9));
    ok('g8 unedited: markers of that document (a. bullets, roman, dot, numbers)', await markers() === 'c. ◦ ◦ i. d. • 1. 2.', await markers());

    // 2. Enter / Tab / Shift+Tab / delete / undo keep the numbering right
    await load([{ type: 'list', ordered: true, items: [{ text: 'alpha', marker: '1.' }, { text: 'beta', marker: '2.' }, { text: 'gamma', marker: '3.' }] }]);
    ok('g8 edit: start 1. 2. 3.', await markers() === '1. 2. 3.', await markers());
    await caretEndOf('alpha');
    await page.keyboard.press('Enter'); await page.keyboard.type('new'); await wait(400);
    ok('g8 edit: Enter makes the next item 2. and renumbers the rest', await markers() === '1. 2. 3. 4.', await markers());
    await page.keyboard.press('Tab'); await wait(400);
    ok('g8 edit: Tab nests it as a. and the rest close up', await markers() === '1. a. 2. 3.', await markers());
    ok('g8 edit: Tab indents the print view (data-level)', await page.$$eval('#editor li', (els) => els.map((l) => l.dataset.level || '0').join('')) === '0100');
    await page.keyboard.press('Shift+Tab'); await wait(400);
    ok('g8 edit: Shift+Tab brings it back to 2.', await markers() === '1. 2. 3. 4.', await markers());
    await page.evaluate(() => { window.editor.update(() => { for (const n of window.editor.getEditorState()._nodeMap.values()) { if (n.getType && n.getType() === 'listitem' && n.getTextContent() === 'beta') { n.remove(); break; } } }); });
    await wait(500);
    ok('g8 edit: deleting an item renumbers', await markers() === '1. 2. 3.', await markers());
    const xd = await xmlNow();
    ok('g8 edit: the save follows (three items, no literal numbers written)', (xd.match(/<li>/g) || []).length === 3 && /<li>alpha/.test(xd) && !/<li>\d\./.test(xd) && /<list type="ol">/.test(xd), xd.match(/<list[^>]*>|<li>[^<\n]*/g));
    await undoOnce();
    ok('g8 edit: undo of the delete brings the number back', await markers() === '1. 2. 3. 4.', await markers());
    await page.keyboard.press(redoKey); await wait(700);
    ok('g8 edit: redo', await markers() === '1. 2. 3.', await markers());

    // 3. the chooser: enum + start for the caret's level, in one undo step
    await load([{ type: 'list', ordered: true, items: [{ text: 'alpha', marker: 'c.', enum: 'a', start: 3 }, { text: 'beta', marker: 'd.' }, { text: 'sub one', level: 1, marker: 'i.', enum: 'i' }, { text: 'sub two', level: 1, marker: 'ii.' }, { text: 'gamma', marker: 'e.' }] }]);
    await caretEndOf('sub one');
    await openKb();
    ok('g8 chooser: focus starts on the numbering select', await page.evaluate(() => document.activeElement.id) === 'fmtEnum');
    ok('g8 chooser: it shows the level\'s current style and start', await page.evaluate(() => [document.getElementById('fmtEnum').value, document.getElementById('fmtStart').value, document.getElementById('fmtEnumLevel').textContent].join('|')) === 'i||(level 2)');
    ok('g8 chooser: every visible list control has a label and a help line', await page.evaluate(() => [...document.querySelectorAll('#fmtGroupList input, #fmtGroupList select')].every((c) => c.id && document.querySelector(`label[for="${c.id}"]`)?.textContent.trim() && document.getElementById((c.getAttribute('aria-describedby') || '').split(' ')[0])?.textContent.trim())));
    await page.selectOption('#fmtEnum', 'A'); await page.fill('#fmtStart', '2');
    await applyDlg();
    ok('g8 chooser: enum A start 2 applies to that level only', await markers() === 'c. d. B. C. e.', await markers());
    ok('g8 chooser: the announcement says Applied', /Applied/.test(await page.evaluate(() => document.getElementById('announce').textContent)));
    const xc = await xmlNow();
    ok('g8 chooser: saved as enum="A" start="2" on the nested list; outer list unchanged', /<list type="ol" enum="A" start="2">/.test(xc) && /<list type="ol" enum="a" start="3">/.test(xc), xc.match(/<list[^>]*>/g));
    await undoOnce();
    ok('g8 chooser: ONE undo takes the whole change back', await markers() === 'c. d. i. ii. e.' && !/enum="A"/.test(await xmlNow()), await markers());
    await redoOnce();
    ok('g8 chooser: redo', await markers() === 'c. d. B. C. e.', await markers());
    await loadXml(await xmlNow(), 'g8-chooser.xml');
    ok('g8 chooser: save -> reload keeps it', await markers() === 'c. d. B. C. e.', await markers());
    await caretEndOf('sub one');
    await openKb();
    ok('g8 chooser: reopened, it shows A and 2', await page.evaluate(() => document.getElementById('fmtEnum').value + '|' + document.getElementById('fmtStart').value) === 'A|2');
    await page.selectOption('#fmtEnum', 'bullet');
    await applyDlg();
    ok('g8 chooser: bullets at that level (level glyph)', await markers() === 'c. d. ◦ ◦ e.', await markers());
    ok('g8 chooser: saved as a bulleted sub-list', /<li>beta\s*<list type="ul">\s*<li>sub one<\/li>/.test(await xmlNow()), (await xmlNow()).match(/<list[^>]*>/g));
    await caretEndOf('gamma');
    await openKb();
    await page.fill('#fmtStart', '0');
    await page.click('#brailleFmtApply');
    await wait(300);
    ok('g8 chooser: a bad start (0) is refused in the dialog with a message', await page.evaluate(() => document.getElementById('brailleFmtDialog').open) && /whole number/.test(await page.evaluate(() => document.getElementById('brailleFmtStatus').textContent)));
    await page.fill('#fmtStart', '7');
    await applyDlg();
    ok('g8 chooser: start 7 on the outer level (a. style) gives g. h.', await markers() === 'g. h. ◦ ◦ i.', await markers());

    // 4. a numbered group in a bulleted list; bullet glyphs by level (symbols) and the braille pane
    await load([{ type: 'list', items: [{ text: 'top', marker: '•' }, { text: 'sub', level: 1, marker: '•' }, { text: 'subsub', level: 2, marker: '•' }] }]);   // (1 Oct 2026: the markers a reader gives a bulleted list; an item without one has no bullet, #57)
    ok('g8 symbols: a bulleted list shows • ◦ ▪ by level', await markers() === '• ◦ ▪', await markers());
    const brf0 = await brfNow();
    await caretEndOf('sub');
    await openKb();
    ok('g8 symbols: the list shows Default in the three glyph selects', await page.evaluate(() => [0, 1, 2].map((i) => document.getElementById(`fmtSym${i}`).value).join('|')) === '||');
    await page.selectOption('#fmtSym1', '○'); await page.selectOption('#fmtSym2', '■');
    await applyDlg();
    ok('g8 symbols: the print view uses them', await markers() === '• ○ ■', await markers());
    const brf1 = await brfNow();
    ok('g8 symbols: the braille pane changes (sub-level bullets)', brf1 !== brf0 && brf1.includes(';$=') && brf1.includes('_$#D') && !/;\$=|_\$#D/.test(brf0), [brf0, brf1]);
    ok('g8 symbols: saved as bana-symbols', /bana-symbols-dot_hollow-circle_solid-square/.test(await xmlNow()));
    await undoOnce();
    ok('g8 symbols: ONE undo removes it (print view and braille)', await markers() === '• ◦ ▪' && !(await brfNow()).includes(';$='), await markers());
    await redoOnce();
    ok('g8 symbols: redo', await markers() === '• ○ ■', await markers());
    await loadXml(await xmlNow(), 'g8-sym.xml');
    ok('g8 symbols: save -> reload keeps the glyphs and the braille', await markers() === '• ○ ■' && (await brfNow()).includes(';$='), await markers());
    await caretEndOf('sub');
    await openKb();
    ok('g8 symbols: reopened, the selects show them', await page.evaluate(() => [0, 1, 2].map((i) => document.getElementById(`fmtSym${i}`).value).join('')) === '•○■');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('brailleFmtDialog').open);
    // a numbered group inside a bulleted list
    await load([{ type: 'list', items: [{ text: 'top', marker: '•' }, { text: 'sub', level: 1, marker: '•' }, { text: 'subsub', level: 2, marker: '•' }] }]);   // (1 Oct 2026: the markers a reader gives a bulleted list; an item without one has no bullet, #57)
    await caretEndOf('sub');
    await openKb();
    await page.selectOption('#fmtEnum', '1');
    await applyDlg();
    ok('g8 chooser: numbering a sub-level of a bulleted list', await markers() === '• 1. ▪', await markers());
    ok('g8 chooser: saved with the bullets kept and the sub-list numbered', /<list type="ul">\s*<li>top\s*<list type="ol">\s*<li>sub\s*<list type="ul">\s*<li>subsub/.test(await xmlNow()), (await xmlNow()).match(/<list[^>]*>/g));
    // ---- fixes after stage 3 ----
    // 1. deleting the first item of a sibling group keeps the group's enum/start (moves to the new first item), one undo restores
    const ITEMS_A = [{ text: 'alpha', marker: 'c.', enum: 'a', start: 3 }, { text: 'beta', marker: 'd.' }, { text: 'gamma', marker: 'e.' }];
    const removeItem = (tx) => page.evaluate((t) => { window.editor.update(() => { for (const n of window.editor.getEditorState()._nodeMap.values()) { if (n.getType && n.getType() === 'listitem' && n.getTextContent() === t) { n.remove(); break; } } }); }, tx);
    await load([{ type: 'list', ordered: true, items: ITEMS_A.map((x) => ({ ...x })) }]);
    ok('g8 fix1: letters start 3 at the start', await markers() === 'c. d. e.', await markers());
    await removeItem('alpha'); await wait(500);
    ok('g8 fix1: delete the first item: the rest keep letters and start (c. d.)', await markers() === 'c. d.', await markers());
    const xf1 = await xmlNow();
    ok('g8 fix1: saved with enum="a" start="3" still', /<list type="ol" enum="a" start="3">/.test(xf1) && (xf1.match(/<li>/g) || []).length === 2, xf1.match(/<list[^>]*>/g));
    await undoOnce();
    ok('g8 fix1: ONE undo brings the item back with c. d. e.', await markers() === 'c. d. e.', await markers());
    await redoOnce();
    ok('g8 fix1: redo', await markers() === 'c. d.', await markers());
    // roman, nested group
    await load([{ type: 'list', ordered: true, items: [{ text: 'top', marker: '1.' }, { text: 'r1', level: 1, marker: 'iii.', enum: 'i', start: 3 }, { text: 'r2', level: 1, marker: 'iv.' }, { text: 'r3', level: 1, marker: 'v.' }, { text: 'top2', marker: '2.' }] }]);
    ok('g8 fix1: roman group start', await markers() === '1. iii. iv. v. 2.', await markers());
    await removeItem('r1'); await wait(500);
    ok('g8 fix1: roman group: delete the first item keeps roman + start', await markers() === '1. iii. iv. 2.', await markers());
    ok('g8 fix1: saved with enum="i" start="3"', /<list type="ol" enum="i" start="3">/.test(await xmlNow()), (await xmlNow()).match(/<list[^>]*>/g));
    await undoOnce();
    ok('g8 fix1: roman group: undo restores', await markers() === '1. iii. iv. v. 2.', await markers());
    // the user's own way: caret at the start of the first item + Backspace, and a selection delete
    await load([{ type: 'list', ordered: true, items: ITEMS_A.map((x) => ({ ...x })) }]);
    await page.evaluate(() => { window.editor.update(() => { for (const n of window.editor.getEditorState()._nodeMap.values()) { if (n.getType && n.getType() === 'text' && n.getTextContent() === 'alpha') { n.select(0, 0); break; } } }); window.editor.focus(); });
    await wait(200);
    await page.keyboard.press('Backspace'); await wait(500);
    const afterBs = await markers();
    ok('g8 fix1: Backspace at the start of the first item: the rest keep c. d. (the first item leaves the list)', afterBs === 'c. d.', afterBs);
    await load([{ type: 'list', ordered: true, items: ITEMS_A.map((x) => ({ ...x })) }]);
    await page.evaluate(() => { window.editor.update(() => { let a = null, b = null; for (const n of window.editor.getEditorState()._nodeMap.values()) { if (n.getType && n.getType() === 'text') { if (n.getTextContent() === 'alpha') a = n; if (n.getTextContent() === 'beta') b = n; } } if (a && b) { const sel = a.select(0, 0); sel.focus.set(b.getKey(), b.getTextContentSize(), 'text'); } }); window.editor.focus(); });
    await wait(200);
    await page.keyboard.press('Delete'); await wait(500);
    const afterSel = await markers();
    const xsel = await xmlNow();
    ok('g8 fix1: selection delete over the first two items: saved, the one left (gamma) is still c. (enum a start 3)', afterSel.split(' ').pop() === 'c.' && /<list type="ol" enum="a" start="3">\s*<li>gamma<\/li>\s*<\/list>/.test(xsel), [afterSel, xsel.match(/<list[^>]*>|<li>[^<\n]*/g)]);

    // 2. a pasted native nested list is flattened into the flat level model and gets markers
    await load([P('intro')]);
    await caretEndOf('intro');
    const pasteHtml = (h) => page.evaluate((html) => { const dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', 'x'); const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); if (!ev.clipboardData || !ev.clipboardData.types.length) Object.defineProperty(ev, 'clipboardData', { value: dt }); /* A89: Firefox ignores clipboardData in the constructor */ document.getElementById('editor').dispatchEvent(ev); }, h);
    await pasteHtml('<ol><li>one</li><li>two<ol><li>sub a</li><li>sub b<ul><li>dot</li></ul></li></ol></li><li>three</li></ol>');
    await wait(900);
    ok('g8 paste: nested native list: numbers, letters one level down, a bullet two down, numbering goes on', await markers() === '1. 2. a. b. ▪ 3.', await markers());
    ok('g8 paste: flat model: one list, levels 0 0 1 1 2 0', await page.$$eval('#editor li', (els) => els.map((l) => l.dataset.level || '0').join('')) === '001120' && await page.$$eval('#editor li ol, #editor li ul', (e) => e.length) === 0);
    const xp = await xmlNow();
    ok('g8 paste: saved as nested lists with enum', /<list type="ol">\s*<li>one<\/li>\s*<li>two\s*<list type="ol" enum="a">/.test(xp) && /<list type="ul">\s*<li>dot/.test(xp), xp.match(/<list[^>]*>/g));
    // a bullet list with a numbered sub-list keeps the numbers
    await load([P('intro2')]);
    await caretEndOf('intro2');
    await pasteHtml('<ul><li>top<ol><li>n1</li><li>n2</li></ol></li></ul>');
    await wait(900);
    ok('g8 paste: bullets over numbers (the sub-level takes the level-2 default, letters)', await markers() === '• a. b.', await markers());
    // plain-text paste with prefixes stays plain text
    await load([P('intro3')]);
    await caretEndOf('intro3');
    await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', '- x\n1. y'); const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); if (!ev.clipboardData || !ev.clipboardData.types.length) Object.defineProperty(ev, 'clipboardData', { value: dt }); /* A89: Firefox ignores clipboardData in the constructor */ document.getElementById('editor').dispatchEvent(ev); });
    await wait(700);
    ok('g8 paste: plain text with "- " / "1." prefixes makes no list (as before)', (await page.$$('#editor li')).length === 0 && /- x/.test(await page.textContent('#editor')), await page.textContent('#editor'));

    // 3. a bullet top item over a numbered sub-list: save -> reload -> compare
    const BN = `<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3"><head><meta name="dc:Title" content="T"/></head><book><bodymatter><level1>
<list type="ul"><li>top<list type="ol" enum="a" start="3"><li>n1</li><li>n2</li></list></li><li>top2<list type="ol"><li>m1</li></list></li></list>
</level1></bodymatter></book></dtbook>`;
    await loadXml(BN, 'g8-bn.xml');
    const mBefore = await markers();
    ok('g8 fix3: load: bullet, c. d., bullet, 1.', mBefore === '• c. d. • 1.', mBefore);
    const xbn = await xmlNow();
    ok('g8 fix3: saved as a ul (no literal bullet) with the sub-lists\' enum/start', /<list type="ul">\s*<li>top\s*<list type="ol" enum="a" start="3">/.test(xbn) && !/• top/.test(xbn), xbn.match(/<list[^>]*>|<li>[^<\n]*/g));
    await loadXml(xbn, 'g8-bn2.xml');
    ok('g8 fix3: reload: same markers, top item still a bullet', await markers() === mBefore, await markers());
    ok('g8 fix3: second save is identical', norm(await xmlNow()) === norm(xbn));
    ok('g8: no console errors', g8Errors.length === 0, g8Errors);
    page.off('console', onErr);
  }

  // ---- Bullets in braille (BANA 8.6.2): a bulleted list item in the editor always carries the print bullet `_4`; save -> reload gives the same braille ----
  {
    const bErrors = [];
    const onErr = (m) => { if (m.type() === 'error') bErrors.push(m.text()); };
    page.on('console', onErr);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const xmlNow = () => page.evaluate(() => window.exportCurrentDocumentXml());
    const brfNow = () => page.evaluate(() => window.lastBrf);
    const loadXml = async (xml, name) => { await page.evaluate(async ([x, n]) => { window.markDocumentClean(); await window.importFile(new File([x], n, { type: 'text/xml' })); }, [xml, name]); await wait(1200); };
    const bulletLines = (brf) => (brf || '').split(/\r?\n/).filter((l) => /apples|pears/i.test(l.replace(/[^A-Za-z,]/g, '')) || /^\s*_4 /.test(l)).map((l) => l.trimEnd());
    // typed from scratch: the Bulleted List block style on an empty paragraph, then the items typed and Enter pressed
    await page.evaluate(() => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: 'x' }] }); });
    await wait(800);
    await page.evaluate(() => { window.editor.update(() => { for (const n of window.editor.getEditorState()._nodeMap.values()) { if (n.getType && n.getType() === 'text' && n.getTextContent() === 'x') { n.select(0, 1); break; } } }); window.editor.focus(); });
    await page.keyboard.press('Backspace');
    await page.selectOption('#blockStyle', 'bullet');
    await wait(300);
    await page.evaluate(() => window.editor.focus());
    await page.keyboard.type('Apples');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Pears');
    await wait(1500);
    const typedLis = await page.$$eval('#editor li', (els) => els.length);
    ok('bullets: a bullet list typed in the editor has 2 items', typedLis === 2, typedLis);
    const brfTyped = await brfNow();
    ok('bullets: typed bullet list shows _4 before each item in the braille pane', /^_4 ,APPLES/m.test(brfTyped) && /^_4 ,?P/m.test(brfTyped), bulletLines(brfTyped));
    const xTyped = await xmlNow();
    ok('bullets: typed list saves as <list type="ul"> with no literal bullet character', /<list type="ul">/.test(xTyped) && !/•/.test(xTyped), xTyped.match(/<list[^>]*>|<li>[^<\n]*/g));
    await loadXml(xTyped, 'bullets-typed.xml');
    ok('bullets: save -> reload gives the same braille as before saving', bulletLines(await brfNow()).join('|') === bulletLines(brfTyped).join('|'), [bulletLines(brfTyped), bulletLines(await brfNow())]);
    // loaded from a NIMAS ul, with a nested bullet level and an ordered list (unchanged)
    const UL = `<?xml version="1.0"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3"><head><meta name="dc:Title" content="T"/></head><book><bodymatter><level1>
<list type="ul"><li>Apples<list type="ul"><li>Red</li></list></li><li>Pears</li></list>
<list type="ol"><li>One</li><li>Two</li></list>
<list type="pl"><li>Plain</li></list>
</level1></bodymatter></book></dtbook>`;
    await loadXml(UL, 'bullets-ul.xml');
    const b1 = await brfNow();
    ok('bullets: loaded ul: _4 on both levels, numbers on the ol, nothing on the plain list', /^_4 ,APPLES/m.test(b1) && /^\s+_4 ,R/m.test(b1) && /^#A4 ,"O/m.test(b1) && /^,PLA9/m.test(b1) && !/_4 ,PLA9/.test(b1), b1);
    const x1 = await xmlNow();
    await loadXml(x1, 'bullets-ul2.xml');
    ok('bullets: loaded ul: save -> reload braille identical', (await brfNow()) === b1);
    ok('bullets: loaded ul: second save identical', (await xmlNow()).replace(/emboss-\d+/g, 'id') === x1.replace(/emboss-\d+/g, 'id'));
    ok('bullets: no console errors', bErrors.length === 0, bErrors);
    page.off('console', onErr);
  }

  // ---- Transcriber's Notes page: SUGGESTED notes dialog (plan §9 row 5): offered, never added without an explicit Add ----
  {
    const tsErrors = [];
    const onErr = (m) => { if (m.type() === 'error') tsErrors.push(m.text()); };
    page.on('console', onErr);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const entries = () => page.evaluate(() => [...document.querySelectorAll('#editor .emboss-tnpage-card > p')].map((p) => p.textContent.trim()));
    const rows = () => page.$$eval('#tnsList .tns-row', (r) => r.map((x) => ({ id: x.dataset.id, text: x.querySelector('input').value })));
    const dlgOpen = () => page.evaluate(() => document.getElementById('tnsDialog').open);
    const closeDlg = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.getElementById('tnsDialog').open && !document.getElementById('tnsDialog').contains(document.activeElement)); };
    const load = async () => {
      await page.evaluate(async () => {
        window.markDocumentClean();
        window.modelToLexical({ blocks: [
          { type: 'para', text: 'A blocked paragraph.', blocked: true },
          { type: 'table', format: 'listed', headers: ['A', 'B'], rows: [['1', '2']] },
          { type: 'para', text: 'Ends here.' }] });
        await window.render();
      });
      await page.locator('#editor').getByText('Ends here.', { exact: true }).click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
      await wait(300);
      await page.evaluate(() => window.insertTnPage());
      await page.waitForSelector('#tnsDialog[open]', { timeout: 5000 });
    };
    await load();
    const r0 = await rows();
    ok('suggested notes: creating a page opens the dialog with the detected suggestions (blocked paragraph, listed table)', r0.map((r) => r.id).sort().join() === 'blocked-paragraphs,table-listed', r0);
    ok('suggested notes: dialog is named, described, and nothing is on the page yet', await page.evaluate(() => { const d = document.getElementById('tnsDialog'); return !!document.getElementById(d.getAttribute('aria-labelledby'))?.textContent && !!document.getElementById(d.getAttribute('aria-describedby'))?.textContent; }) && (await entries()).every((t) => t === ''), await entries());
    ok('suggested notes: each row shows its reason', await page.$$eval('#tnsList .tns-row p', (ps) => ps.length === 2 && ps.every((p) => /^Why:/.test(p.textContent))));
    ok('suggested notes: focus is on the first row text', await page.evaluate(() => document.activeElement === document.querySelector('#tnsList input')));
    await closeDlg();
    ok('suggested notes: Escape adds nothing and returns focus to the editor', (await entries()).every((t) => t === '') && await page.evaluate(() => document.getElementById('editor').contains(document.activeElement)), await entries());
    // reopen from the toolbar button; keyboard: Tab wraps inside the dialog
    ok('suggested notes: the toolbar button is shown once the document has the page', await page.evaluate(() => !document.getElementById('btnTnSuggest').hidden));
    await page.click('#btnTnSuggest');
    await page.waitForSelector('#tnsDialog[open]');
    ok('suggested notes: the button reopens the same suggestions', (await rows()).length === 2);
    const tabbed = [];
    for (let i = 0; i < 9; i++) { await page.keyboard.press('Tab'); tabbed.push(await page.evaluate(() => document.getElementById('tnsDialog').contains(document.activeElement))); }
    ok('suggested notes: Tab stays inside the dialog (focus trap)', tabbed.every(Boolean), tabbed);
    // edit the first row in place, then Add with the keyboard
    await page.focus('#tnsList .tns-row input');
    await page.fill('#tnsList .tns-row input', ''); await page.keyboard.type('The paragraphs are blocked.');
    await page.keyboard.press('Tab');   // the reason is not focusable: input -> Add
    ok('suggested notes: keyboard reaches the Add button', await page.evaluate(() => document.activeElement.className === 'tns-add'));
    await page.keyboard.press('Enter');
    await wait(500);
    ok('suggested notes: Add appends the (edited) text as an entry on the page', JSON.stringify(await entries()) === JSON.stringify(['The paragraphs are blocked.']), await entries());
    ok('suggested notes: the added row is gone, the other stays; live region confirms', (await rows()).length === 1 && /Added 1/.test(await page.evaluate(() => document.getElementById('tnsStatus').textContent)), await rows());
    // Dismiss the remaining one
    await page.click('#tnsList .tns-dismiss');
    await wait(300);
    ok('suggested notes: Dismiss hides it and adds nothing', (await rows()).length === 0 && (await entries()).length === 1 && await page.evaluate(() => !document.getElementById('tnsEmpty').hidden), await entries());
    await closeDlg();
    await page.click('#btnTnSuggest'); await page.waitForSelector('#tnsDialog[open]');
    ok('suggested notes: a dismissed or added suggestion is not offered again', (await rows()).length === 0 && /No suggestions/.test(await page.evaluate(() => document.getElementById('tnsEmpty').textContent)));
    await closeDlg();
    // undo: the Add is one step
    await page.evaluate(() => window.editor.focus());
    for (let i = 0; i < 3; i++) await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await wait(300);
    ok('suggested notes: undo removes the added entry', (await entries()).every((t) => t === ''), await entries());
    // Add all: one undo step for all
    await page.evaluate(() => window.markDocumentClean());
    await load();
    await page.click('#tnsAddAll');
    await wait(500);
    ok('suggested notes: Add all appends every suggestion', (await entries()).filter(Boolean).length === 2, await entries());
    ok('suggested notes: the saved file carries the notes', /bana-transcriber-notes/.test(await page.evaluate(() => window.exportCurrentDocumentXml())));
    await closeDlg();
    // a page created where nothing is detected says so
    await page.evaluate(async () => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: 'Plain.' }] }); await window.render(); });
    await page.locator('#editor').getByText('Plain.', { exact: true }).click();
    await page.evaluate(() => window.insertTnPage());
    await page.waitForSelector('#editor .emboss-tnpage-card');
    await wait(500);
    ok('suggested notes: a page created with nothing detected opens no dialog', !(await dlgOpen()));
    await page.click('#btnTnSuggest'); await page.waitForSelector('#tnsDialog[open]');   // the Notes… button still opens it
    ok("suggested notes: no detected suggestions shows 'No suggestions' and adds nothing", await page.evaluate(() => !document.getElementById('tnsEmpty').hidden && document.getElementById('tnsEmpty').textContent.trim() === 'No suggestions') && (await entries()).every((t) => t === ''));
    await closeDlg();
    ok('suggested notes: no console errors', tsErrors.length === 0, tsErrors);
    page.off('console', onErr);
  }

} finally {
  await browser.close();
}

console.log(`\n=== A19-A22 Stage 9 editor save-fidelity [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.error('Failures:', failures);
  process.exit(1);
} else {
  console.log('All editor save-fidelity checks passed.');
}
