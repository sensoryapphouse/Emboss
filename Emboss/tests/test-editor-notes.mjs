// A footnote of several paragraphs in the editor (import fix list #57c, Paul 1 Oct 2026).
//
// The readers give such a note as { type: 'footnote', id, blocks: [para, para] }. The editor used to join the paragraphs with a
// forced line break into ONE paragraph, so (a) the live braille gave the second paragraph no indent of its own (BANA 16.5.1d: 5-3
// margins; the reader's braille does) and (b) a save wrote one <p> with <br/>, losing the paragraph structure.
//
// Now each paragraph of the note is its own editor paragraph (all carrying the note's id), the live model has one footnote block per
// paragraph (so click-to-link and caret sync still find the right paragraph), the second and later blocks are marked `noteCont`
// so the formatter lays the run out as one note, and the save folds them back into one <note> with several <p>.
//
// Checked here: the editor's braille equals the braille of the reader's own model; the saved XML has the note's two <p>; every
// braille line of the note links to its own print paragraph and the caret in either paragraph links to its own braille; Enter at
// the end (or in the middle) of a note paragraph makes a further paragraph of the SAME note; Backspace at the start of a further
// paragraph joins it back; undo/redo; deleting the first paragraph leaves the second still tied to the note's reference mark.
//
// Usage: node Emboss/scripts/serve.mjs 8258 &   then   node Emboss/tests/test-editor-notes.mjs [port] [--show]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv.find((a) => /^\d+$/.test(a)) || process.env.PORT || 8137);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'import-audit');
const REAL = path.join(HERE, 'real_samples', 'rtf', 'inclusive-accessible-stadia-report.rtf');
const fixturePath = (rel) => (path.isAbsolute(rel) ? rel : path.join(FIX, rel));
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700) : ''}`); }
};

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
await context.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', standard: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {} });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

async function settle() {
  let prev = null;
  for (let k = 0; k < 25; k++) { await page.waitForTimeout(300); const b = await page.evaluate(() => window.lastBrf || ''); if (b === prev && k > 1) break; prev = b; }
}
async function open(rel) {
  await page.evaluate(() => { window.markDocumentClean(); window.__prevModel = window.lastModel; });
  await page.setInputFiles('#loadFileInput', fixturePath(rel));
  await page.waitForFunction(() => window.lastModel && window.lastModel !== window.__prevModel, null, { timeout: 60000 }).catch(() => {});
  await settle();
}
// The braille of the file as its reader models it, formatted in the page with the editor's own options (the same module).
async function readerBraille(rel) {
  const file = fixturePath(rel);
  const binary = /\.(docx|doc|odt|epub)$/i.test(rel);
  const buf = fs.readFileSync(file);
  return page.evaluate(async ({ name, payload, binary }) => {
    let arg = payload;
    if (binary) { const bin = atob(payload); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); arg = u.buffer; }
    const m = await window.parseFile(name, arg);
    const mod = await import('/format/document.mjs');
    const o = { ...window.lastFormatOpts }; delete o.trace;
    return await mod.formatDocumentAsync({ title: window.lastModel.title, blocks: m.blocks, metadata: m.metadata }, o);
  }, { name: path.basename(rel), payload: binary ? buf.toString('base64') : buf.toString('utf8'), binary });
}
const blocksOf = () => page.evaluate(() => window.lastModel.blocks.map((b, i) => ({ i, type: b.type, id: b.id || null, kind: b.kind || null, cont: !!b.noteCont, text: b.text != null ? b.text : (b.segments || []).map((s) => s.text || '').join('') })));
const noteBlocks = async (id) => (await blocksOf()).filter((b) => b.type === 'footnote' && b.id === id);
const xmlNote = async (id) => { const xml = await page.evaluate(() => window.exportCurrentDocumentXml()); const m = xml.match(new RegExp(`<note id="${id}"[^>]*>[\\s\\S]*?</note>`)); return m ? m[0] : null; };
const paraCount = (x) => (x ? (x.match(/<p>/g) || []).length : 0);
// The print paragraph (editor element) for a model block, and the braille rows of a block.
// A long document's braille pane draws only the pages near the view; bring a block's rows into the DOM.
const showBrailleBlock = async (bi) => {
  await page.evaluate((i) => { const el = document.querySelector('.braille'); if (el && el._virtualBraille && el._virtualBraille.isVirtualized()) el._virtualBraille.scrollToBlock(i, 0); }, bi);
  await page.waitForTimeout(400);
};
const printText = (bi) => page.evaluate((i) => { const el = document.querySelector(`#editor [data-block-idx="${i}"]`); return el ? el.textContent : null; }, bi);
// The editor's braille lines (page by page, as the braille pane numbers them) belonging to block `bi`, with each line's row number.
const linesOfBlock = (bi) => page.evaluate((i) => {
  const all = [];
  window.lastBrf.split('\f').forEach((pg) => { const ls = pg.split(/\r\n|\n/); if (ls.length && ls[ls.length - 1] === '') ls.pop(); all.push(...ls); });
  return window.lastTrace.rows.map((r, k) => (r === i ? { k, line: all[k] } : null)).filter(Boolean);
}, bi);
const rowsOf = (bi) => page.evaluate((i) => window.lastTrace.rows.map((r, k) => (r === i ? k : -1)).filter((k) => k >= 0), bi);
// Put the caret in the top-level paragraph whose text starts with `textStart`: at its 'start', its 'end', at a character offset, or
// (`select`) with all its text selected. Done through the editor's own selection (End/Home only reach the ends of a wrapped line).
async function placeCaretInParagraph(textStart, where) {
  const found = await page.evaluate(({ textStart, where }) => {
    let done = false;
    window.editor.update(() => {
      const p = window.editor.getEditorState()._nodeMap && [...window.editor.getEditorState()._nodeMap.values()].find((n) => n.getType && n.getType() === 'paragraph' && typeof n.getTextContent === 'function' && n.getTextContent().startsWith(textStart) && n.getParent() && n.getParent().getType() === 'root');
      if (!p) return;
      if (where === 'start') p.selectStart();
      else if (where === 'end') p.selectEnd();
      else if (where === 'select') { const t = p.getFirstChild(); if (t) t.select(0, t.getTextContent().length); }
      else if (typeof where === 'number') { const t = p.getFirstChild(); t.select(where, where); }
      done = true;
    }, { discrete: true });
    window.editor.focus();
    return done;
  }, { textStart, where });
  if (!found) throw new Error(`no paragraph starting "${textStart}"`);
  await page.waitForTimeout(150);
}

try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1500);

  for (const [rel, id, first, second, light] of [
    ['docx/w05-notes-comments.docx', 'docx-fn-2', 'Footnote two first paragraph', 'Footnote two second paragraph'],
    ['md/m04-notes-images-html.md', 'md-fn-second', 'Second note alphanote2, first paragraph', 'Second paragraph of the note'],
    ['rtf/lo-w05-notes-comments.rtf', 'rtf-fn-3', 'Footnote two first paragraph', 'Footnote two second paragraph'],
    ['odt/lo-w05-notes-comments.odt', 'odt-note-ftn5', 'Footnote two first paragraph', 'Footnote two second paragraph'],
    // a real report: a footnote whose URL wraps into a second paragraph (two notes with the same text, so the click checks are skipped)
    [REAL, 'rtf-fn-6', 'See http://www.planningportal', 'approved#Download', true],
  ]) {
    console.log(`\n--- ${path.basename(rel)} ---`);
    await open(rel);
    const nb = await noteBlocks(id);
    ok(`${rel}: the note is two footnote blocks, one per paragraph`, nb.length === 2 && nb[0].text.startsWith(first) && nb[1].text.startsWith(second), nb);
    ok(`${rel}: the second block is marked as a further paragraph of the note, the first is not`, nb.length === 2 && !nb[0].cont && nb[1].cont, nb);
    const edBrf = await page.evaluate(() => window.lastBrf);
    const rdBrf = await readerBraille(rel);
    // The note's braille lines are lines of the reader's braille too: the second paragraph (cell 5 first line, cell 3 runover) as a
    // whole in a row, and the first paragraph's first line. (Not all in one row: the reader and the editor can differ elsewhere in the
    // document -- Markdown's title and code blocks, #57b / #40 -- which moves a page break through the note.)
    const l1 = nb.length === 2 ? (await linesOfBlock(nb[0].i)).map((x) => x.line) : [], l2 = nb.length === 2 ? (await linesOfBlock(nb[1].i)).map((x) => x.line) : [];
    ok(`${rel}: the second paragraph's braille (cell 5, runover cell 3) and the first's opening line are the reader's own`, l1.length > 0 && l2.length > 0 && /^ {4}\S/.test(l2[0]) && l2.slice(1).every((l) => /^ {2}\S/.test(l)) && rdBrf.includes(l2.join('\r\n')) && rdBrf.includes(l1[0]), { l1, l2 });
    // The whole document: Markdown's first heading is a title block in the reader and an ordinary heading in the editor (#57b) and its
    // code blocks are ordinary paragraphs there (#40), so for that file only the note's lines above are compared.
    if (!rel.startsWith('md/') && !light) ok(`${rel}: the editor's braille is the braille of the reader's own model`, edBrf === rdBrf, (() => { const a = edBrf.split(/\r?\n/), b = rdBrf.split(/\r?\n/); for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `line ${i}: editor ${JSON.stringify(a.slice(i, i + 3))} | reader ${JSON.stringify(b.slice(i, i + 3))}`; return ''; })());
    const note = await xmlNote(id);
    ok(`${rel}: the save writes the note's two <p> (and no <br/>)`, paraCount(note) === 2 && !/<br\/>/.test(note || ''), note);
    // two print paragraphs in the editor, both styled as footnote
    const paras = await page.evaluate(({ a, b }) => [...document.querySelectorAll('#editor p.bana-style-footnote')].filter((p) => p.textContent.startsWith(a) || p.textContent.startsWith(b)).map((p) => p.textContent), { a: first, b: second });
    ok(`${rel}: two footnote paragraphs in the editor`, light ? paras.length === 4 : paras.length === 2, paras);
    // Linking, braille -> print: each braille line of the note belongs to its own paragraph's block.
    const rows1 = nb.length === 2 ? await rowsOf(nb[0].i) : [], rows2 = nb.length === 2 ? await rowsOf(nb[1].i) : [];
    ok(`${rel}: both paragraphs have braille lines of their own, the second after the first`, rows1.length > 0 && rows2.length > 0 && Math.max(...rows1) < Math.min(...rows2), { rows1, rows2 });
    if (nb.length === 2 && !light) {
      const t1 = await printText(nb[0].i), t2 = await printText(nb[1].i);
      ok(`${rel}: the first paragraph's block is the first print paragraph, the second's the second`, (t1 || '').startsWith(first) && (t2 || '').startsWith(second), { t1, t2 });
      for (const [label, bi, want] of [['first', nb[0].i, first], ['second', nb[1].i, second]]) {
        const sel = `.braille .brl-row[data-block="${bi}"]`;
        await showBrailleBlock(bi);
        await page.evaluate((s) => document.querySelectorAll(s).forEach((r) => r.dispatchEvent(new Event('pointerover', { bubbles: true }))), sel);
        await page.locator(sel).first().click();
        await page.waitForTimeout(250);
        const linked = await page.evaluate(() => [...document.querySelectorAll('#editor .print-linked')].map((e) => e.textContent));
        const wordHl = await page.evaluate(() => (window.activeWordHighlight ? JSON.stringify(window.activeWordHighlight).length : 0));
        ok(`${rel}: clicking the ${label} paragraph's braille links that print paragraph`, linked.length >= 1 && linked.every((t) => t.startsWith(want)) || (linked.length === 0 && wordHl > 0), { linked, wordHl });
      }
      // Linking, print -> braille: the caret in each paragraph links that paragraph's braille lines.
      for (const [label, bi, start] of [['first', nb[0].i, first], ['second', nb[1].i, second]]) {
        await showBrailleBlock(bi);
        await placeCaretInParagraph(start, 'end');
        await page.waitForTimeout(300);
        const lit = await page.evaluate(() => [...document.querySelectorAll('.braille .brl-row.brl-linked')].map((r) => Number(r.dataset.block)));
        ok(`${rel}: the caret in the ${label} paragraph links that paragraph's braille lines`, lit.length > 0 && lit.every((b) => b === bi), { lit, bi });
      }
    }
  }

  // ---- editing, on the Word fixture ----
  console.log('\n--- editing a multi-paragraph footnote ---');
  await open('docx/w05-notes-comments.docx');
  const ID = 'docx-fn-2';
  // Enter at the end of the second paragraph: a third paragraph of the same note.
  await placeCaretInParagraph('Footnote two second paragraph', 'end');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Third para alphathreeparas.');
  await settle();
  let nb = await noteBlocks(ID);
  ok('Enter at the end of a note paragraph starts a further paragraph of the same note', nb.length === 3 && nb[2].text === 'Third para alphathreeparas.' && nb[1].cont && nb[2].cont, nb);
  let xn = await xmlNote(ID);
  ok('... and the save writes three <p> in the one <note>', paraCount(xn) === 3 && /alphathreeparas/.test(xn || ''), xn);
  let brf = await page.evaluate(() => window.lastBrf);
  const l3 = nb.length === 3 ? await linesOfBlock(nb[2].i) : [], l2 = nb.length === 3 ? await linesOfBlock(nb[1].i) : [];
  ok('... and its braille starts in cell 5 like the second (BANA 16.5.1d), runover in cell 3', l3.length > 0 && /^ {4}\S/.test(l3[0].line) && l2.length > 0 && /^ {4}\S/.test(l2[0].line) && l3.slice(1).every((x) => /^ {2}\S/.test(x.line)), { l2, l3 });
  ok('... and the document still has just the one note with that id', (await page.evaluate(() => window.exportCurrentDocumentXml())).split(`<note id="${ID}"`).length === 2);
  // Enter in the middle of the first paragraph: the rest becomes a further paragraph of the same note.
  await placeCaretInParagraph('Footnote two first paragraph', 'Footnote two first'.length);
  await page.keyboard.press('Enter');
  await settle();
  nb = await noteBlocks(ID);
  ok('Enter in the middle of a note paragraph splits it into two paragraphs of the same note', nb.length === 4 && nb[0].text === 'Footnote two first' && nb[1].text === 'paragraph alphafootnotetwo.' && nb[1].cont, nb);
  await page.keyboard.press(UNDO);
  await settle();
  nb = await noteBlocks(ID);
  ok('undo puts the split back (one Enter, one undo step)', nb.length === 3 && nb[0].text.startsWith('Footnote two first paragraph'), nb);
  await page.keyboard.press(REDO);
  await settle();
  nb = await noteBlocks(ID);
  ok('redo splits it again', nb.length === 4, nb);
  await page.keyboard.press(UNDO);
  await settle();
  // Backspace at the start of a further paragraph joins it to the one before.
  await placeCaretInParagraph('Third para', 'start');
  await page.keyboard.press('Backspace');
  await settle();
  nb = await noteBlocks(ID);
  ok('Backspace at the start of a further paragraph joins it to the one before, still one note', nb.length === 2 && /alphafootnotetwob\.Third para alphathreeparas\.$/.test(nb[1].text) && nb[1].cont, nb);
  xn = await xmlNote(ID);
  ok('... and the save has two <p> again', paraCount(xn) === 2, xn);
  await page.keyboard.press(UNDO);
  await settle();
  nb = await noteBlocks(ID);
  ok('undo of the join gives the three paragraphs back', nb.length === 3 && nb[2].text === 'Third para alphathreeparas.', nb);
  // The reference mark stays tied: the body paragraph's noteref still points at the note, whatever happens to its paragraphs.
  const refs = await page.evaluate((id) => [...document.querySelectorAll(`#editor [data-noteref="${id}"]`)].length, ID);
  ok('the note reference mark in the text still names the note', refs === 1, refs);
  // A way out: Enter on the still-empty further paragraph turns it into a body paragraph (as Enter on a blank list item ends the list).
  await placeCaretInParagraph('Third para', 'end');
  await page.keyboard.press('Enter');
  const emptyCont = await page.evaluate(() => { const ps = [...document.querySelectorAll('#editor p.bana-style-footnote')]; return ps.filter((p) => p.textContent === '').length; });
  ok('Enter at the end of the last paragraph opens an empty further paragraph (shown in the footnote style)', emptyCont === 1, emptyCont);
  await page.keyboard.press('Enter');
  await page.keyboard.type('Body after the note.');
  await settle();
  const after = await blocksOf();
  const ni = after.findIndex((b) => b.type === 'footnote' && b.id === ID && !b.cont);
  ok('a second Enter on the empty paragraph ends the note: what is typed next is a body paragraph after the note', after.filter((b) => b.id === ID).length === 3 && after[ni + 3] && after[ni + 3].type === 'para' && after[ni + 3].text === 'Body after the note.', after.slice(ni, ni + 5));
  xn = await xmlNote(ID);
  const xmlAll = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('... and the save has the note with its three <p>, then the body paragraph', paraCount(xn) === 3 && /<\/note>\s*<p>Body after the note\.<\/p>/.test(xmlAll), xn);
  // Deleting the first paragraph's whole text leaves the second paragraph as the note (still the same id).
  await placeCaretInParagraph('Footnote two first paragraph', 'select');
  await page.keyboard.press('Delete');
  await settle();
  nb = await noteBlocks(ID);
  ok('with the first paragraph emptied, the next paragraph is the note (same id, not a further paragraph)', nb.length === 2 && !nb[0].cont && nb[0].text.startsWith('Footnote two second paragraph'), nb);
  xn = await xmlNote(ID);
  ok('... and the save has one <note> with two <p>', paraCount(xn) === 2 && /^<note id="docx-fn-2"[^>]*><p>Footnote two second paragraph/.test(xn || ''), xn);
  brf = await page.evaluate(() => window.lastBrf);
  ok('... and the note braille opens with its reference mark and no stray indent', /\n;9#B,FOOTNOTE TWO SECOND/.test(brf), brf.split(/\r?\n/).slice(6, 16));

  // ---- a note with no id (Footnote style chosen by hand) is not a further paragraph of the note above it ----
  console.log('\n--- notes that are separate notes stay separate ---');
  await page.evaluate(() => window.modelToLexical({ blocks: [
    { type: 'para', segments: [{ type: 'text', text: 'Body' }, { type: 'noteref', text: '1', idref: 'a' }, { type: 'text', text: ' and' }, { type: 'noteref', text: '2', idref: 'b' }, { type: 'text', text: ' end.' }] },
    { type: 'footnote', id: 'a', text: 'Note A.' },
    { type: 'footnote', id: 'b', text: 'Note B.' },
    { type: 'footnote', text: 'No id one.' },
    { type: 'footnote', text: 'No id two.' },
  ] }));
  await settle();
  const sep = await blocksOf();
  ok('adjacent notes with different ids, or with no id, are not joined', sep.filter((b) => b.type === 'footnote').length === 4 && sep.every((b) => !b.cont), sep);
  const sx = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('... and each saves as its own <note>', (sx.match(/<note /g) || []).length === 4, sx.slice(sx.indexOf('<bodymatter>'), sx.indexOf('<bodymatter>') + 900));

  // ---- a multi-paragraph ENDNOTE ----
  console.log('\n--- a multi-paragraph endnote ---');
  await page.evaluate(() => window.modelToLexical({ blocks: [
    { type: 'para', segments: [{ type: 'text', text: 'Body' }, { type: 'noteref', text: '1', idref: 'e1' }, { type: 'text', text: ' text.' }] },
    { type: 'footnote', id: 'e1', kind: 'endnote', blocks: [{ type: 'para', text: 'End first.' }, { type: 'para', text: 'End second.' }] },
    { type: 'para', text: 'After.' },
  ] }));
  await settle();
  const en = await blocksOf();
  ok('a two-paragraph endnote is two blocks, the second a further paragraph', en.filter((b) => b.type === 'footnote').length === 2 && en.filter((b) => b.cont).length === 1 && en.filter((b) => b.type === 'footnote').every((b) => b.kind === 'endnote'), en);
  const enBrf = await page.evaluate(() => window.lastBrf);
  const enRows = enBrf.split(/\r?\n/);
  const e1 = await linesOfBlock(en.find((b) => b.type === 'footnote' && !b.cont).i), e2 = await linesOfBlock(en.find((b) => b.cont).i);
  ok('... both paragraphs reach the NOTES section after the heading, the second indented to cell 5, no blank line between', e1.length > 0 && e2.length > 0 && /^\S/.test(e1[0].line) && /^ {4}\S/.test(e2[0].line) && e2[0].k === e1[e1.length - 1].k + 1 && /@\.<,,NOTES@\.>/.test(enBrf), { e1, e2, rows: enRows.slice(0, 14) });
  const exn = await xmlNote('e1');
  ok('... and the save has the one endnote with two <p>', paraCount(exn) === 2 && /class="endnote"/.test(exn || ''), exn);
} finally {
  ok('no page errors', pageErrors.length === 0, pageErrors);
  await browser.close();
}
console.log(`\n=== Editor multi-paragraph notes [${ENGINE_LABEL}]: ${pass} passed, ${failures.length} failed ===`);
if (failures.length) process.exit(1);
