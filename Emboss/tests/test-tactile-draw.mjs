// W14 (Paul, 4 Nov 2026): the tactile drawing tool, ported from his SwiftUI SVG editor (Emboss/web/tactile-draw/). The whole path through the editor:
//  - the entry is a Transcriber tool: Insert > "Draw a tactile graphic" is hidden with Transcriber tools off, and there with it on;
//  - draw a rectangle and a line with the mouse, add a braille label (translated by the document's code), apply a texture, move with the arrow keys,
//    undo, put the key on the drawing, see the checks, view the dots;
//  - save: the graphic block holds the SVG (title and description kept), it is saved with the document (NIMAS), and its braille label line is in the braille;
//  - reopen with a double-click (and with Enter, and with the Edit drawing button), change it, save the change;
//  - open an SVG file in the tool (colours become textures; Undo brings the old drawing back);
//  - keyboard only: tools by key, a cursor moved by the arrows, Enter to place, Tab between shapes, Delete, Ctrl+Z, Escape;
//  - an axe-core WCAG 2 A/AA scan of the dialog, light and dark; no page errors.
//
// Usage: node Emboss/scripts/serve.mjs 8291 &   then   [EMBOSS_ENGINE=chrome|webkit] node Emboss/tests/test-tactile-draw.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { fileURLToPath } from 'node:url';
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8291);
const AXE = fileURLToPath(new URL('./vendor/axe-core/axe.min.js', import.meta.url));
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
};
const SETTINGS = (tools) => ({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en', expertHardware: false, transcriberTools: tools, cells: 38, lines: 25 });
const browser = await launchBrowser();
const errors = [];

async function open(scheme, tools) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, colorScheme: scheme, acceptDownloads: true });
  await ctx.addInitScript((s) => { try { if (!sessionStorage.getItem('td')) { sessionStorage.setItem('td', '1'); localStorage.setItem('emboss-settings', JSON.stringify(s)); } } catch {} }, SETTINGS(tools));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${scheme}/${tools}: ${e}`));
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  return { ctx, page };
}
const td = (page) => page.evaluate(() => { const d = document.getElementById('tactileDrawDialog'); return d && d.open ? { shapes: d._td.doc.shapes.map((s) => JSON.parse(JSON.stringify(s))), legend: d._td.doc.legend, tool: d._td.state.tool, sel: [...d._td.doc.selection], canUndo: d._td.doc.canUndo(), cells: d._td.doc.cells } : null; });
const px = async (page, x, y) => page.evaluate(([x, y]) => { const d = document.getElementById('tactileDrawDialog')._td; const r = d.stage.svg.getBoundingClientRect(); return { x: r.left + (x / d.doc.width) * r.width, y: r.top + (y / d.doc.height) * r.height }; }, [x, y]);
const drag = async (page, a, b) => { const p = await px(page, a[0], a[1]), q = await px(page, b[0], b[1]); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 }); await page.mouse.move(q.x, q.y, { steps: 4 }); await page.mouse.up(); };
const click = async (page, x, y) => { const p = await px(page, x, y); await page.mouse.click(p.x, p.y); };
const status = async (page) => { await page.waitForTimeout(90); return page.evaluate(() => document.getElementById('tdStatus').textContent); };
const tool = (page, id) => page.click(`#tactileDrawDialog [data-tool="${id}"]`);
const insertMenuItemShown = (page) => page.evaluate(() => { const b = document.getElementById('btnDrawGraphic'); return !!b && getComputedStyle(b).display !== 'none'; });
async function axeScan(page) {
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.addScriptTag({ path: AXE });
  const r = await page.evaluate(() => window.axe.run(document.getElementById('tactileDrawDialog'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
  return r.violations.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} — ${(n.any[0]?.message || n.failureSummary || '').slice(0, 140)}`) }));
}
const lastGraphic = (page) => page.evaluate(() => { const b = (window.lastModel?.blocks || []).filter((x) => x.type === 'graphic'); return b.length ? { n: b.length, svg: b[b.length - 1].svg, title: b[b.length - 1].title, alt: b[b.length - 1].alt } : null; });

try {
  console.log(`--- ${ENGINE_LABEL}: Transcriber tools off ---`);
  {
    const { ctx, page } = await open('light', false);
    await page.click('#btnInsertMenu');
    ok('the Draw a tactile graphic entry exists in the Insert menu but is hidden with Transcriber tools off', await page.evaluate(() => !!document.getElementById('btnDrawGraphic')) && !(await insertMenuItemShown(page)));
    ok('the slash menu has no Draw a Tactile Graphic with Transcriber tools off', !(await page.evaluate(() => { const e = document.querySelector('.slash-item[data-id="drawgraphic"]'); return !!e; })));
    await ctx.close();
  }

  console.log(`--- ${ENGINE_LABEL}: the drawing path (light) ---`);
  const { ctx, page } = await open('light', true);
  await page.evaluate(() => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: 'Before the drawing.' }] }); });
  await page.waitForTimeout(600);
  await page.click('#btnInsertMenu');
  ok('with Transcriber tools on, Insert has Draw a tactile graphic', await insertMenuItemShown(page));
  await page.click('#btnDrawGraphic');
  await page.waitForSelector('#tactileDrawDialog[open]');
  let s = await td(page);
  ok('the drawing dialog opens on the template\'s page (38 cells), empty', s && s.cells === 38 && s.shapes.length === 0, s);
  ok('the toolbar buttons are real labelled buttons with pressed state', await page.evaluate(() => [...document.querySelectorAll('#tactileDrawDialog [data-tool]')].every((b) => b.tagName === 'BUTTON' && b.textContent.trim() && b.hasAttribute('aria-pressed'))));
  ok('the dialog is named', await page.evaluate(() => document.getElementById('tactileDrawDialog').getAttribute('aria-labelledby') === 'tdTitleHead' && !!document.getElementById('tdTitleHead').textContent));

  // mouse: rectangle, line
  await tool(page, 'rect');
  await drag(page, [30, 30], [100, 80]);
  s = await td(page);
  ok('a rectangle drawn by mouse: one rect, snapped to the dot grid, back to the Select tool', s.shapes.length === 1 && s.shapes[0].kind === 'rect' && s.shapes[0].x === 30 && s.shapes[0].y === 30 && s.shapes[0].width === 70 && s.shapes[0].height === 50 && s.tool === 'select', s);
  ok('the status line said what was added', /Added Rectangle 1/.test(await status(page)), await status(page));
  await tool(page, 'line');
  await drag(page, [20, 120], [120, 120]);
  s = await td(page);
  ok('a line drawn by mouse', s.shapes.length === 2 && s.shapes[1].kind === 'line' && s.shapes[1].x1 === 20 && s.shapes[1].x2 === 120 && s.shapes[1].y1 === 120, s.shapes[1]);

  // texture on the rectangle (select it by clicking inside)
  await click(page, 60, 55);
  s = await td(page);
  ok('a click inside the rectangle selects it', s.sel.length === 1 && s.sel[0] === s.shapes[0].id, s);
  await page.selectOption('#tactileDrawDialog .td-side select >> nth=1', 'hatch').catch(() => {});
  s = await td(page);
  if (s.shapes[0].texture !== 'hatch') {   // find the texture select by its label
    const id = await page.evaluate(() => [...document.querySelectorAll('#tactileDrawDialog label')].find((l) => l.textContent === 'Area texture')?.htmlFor);
    await page.selectOption(`#${id}`, 'hatch');
    s = await td(page);
  }
  ok('applying a texture in the inspector sets it (and it is in the saved SVG)', s.shapes[0].texture === 'hatch', s.shapes[0]);
  ok('the key lists the texture, and the checks panel is there', await page.evaluate(() => /Key/.test(document.getElementById('tdKeyH').textContent) && /Checks \(\d+\)/.test(document.getElementById('tdChkH').textContent)));

  // label
  await tool(page, 'text');
  await click(page, 40, 150);
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'tdLabelText');
  await page.keyboard.type('Lake');
  await page.keyboard.press('Enter');
  s = await td(page);
  const lab = s.shapes.find((x) => x.kind === 'text');
  ok('a label typed in print is stored with its braille (the document\'s code), print kept', lab && lab.text === 'Lake' && /^[⠀-⣿]+$/.test(lab.braille) && lab.braille.length >= 4, lab);
  ok('the label\'s braille is shown in the inspector', await page.evaluate(() => /[⠀-⣿]/.test(document.getElementById('tdLabelBraille')?.textContent || '')));

  // move with arrows, undo
  await click(page, 60, 55);
  await page.focus('#tactileDrawDialog .td-svg');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
  s = await td(page);
  ok('arrow keys move the selection by the dot-grid step (2.5 mm)', s.shapes[0].x === 35 && s.shapes[0].y === 32.5, s.shapes[0]);
  ok('the move was announced', /Moved to 35, 32.5/.test(await status(page)), await status(page));
  await page.keyboard.press('Control+z');
  s = await td(page);
  ok('undo puts the run of arrow presses back in one step', s.shapes[0].x === 30 && s.shapes[0].y === 30, s.shapes[0]);
  await page.keyboard.press('Control+Shift+z');
  s = await td(page);
  ok('redo moves it again', s.shapes[0].x === 35, s.shapes[0]);
  await page.keyboard.press('Control+z');

  // key on drawing + checks + dots
  await page.click('#tactileDrawDialog button:has-text("Put key on drawing")');
  s = await td(page);
  ok('"Put key on drawing" adds a Key group (texture sample, line sample, labels)', s.shapes.some((x) => x.kind === 'group' && x.role === 'key' && x.children.length >= 4), s.shapes.map((x) => x.kind));
  await page.keyboard.press('Control+z');
  await page.click('#tactileDrawDialog button:has-text("Show as dots")');
  await page.waitForTimeout(700);
  const dots = await page.evaluate(() => { const c = document.querySelector('#tactileDrawDialog canvas.td-dots'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 3] > 200) ink++; return { ink, label: c.getAttribute('aria-label'), shown: !c.parentElement.hidden }; });
  ok('the dot preview shows the drawing as dots (ink drawn, named for a screen reader)', dots.shown && dots.ink > 200 && /raised dots: \d+ dots/.test(dots.label), dots);
  await page.click('#tactileDrawDialog button:has-text("Show as dots")');

  // axe, light
  await page.evaluate(() => { document.querySelector('#tactileDrawDialog .td-svg').focus(); });
  const axeLight = await axeScan(page);
  ok('axe WCAG 2 A/AA: nothing to fix in the drawing dialog (light)', axeLight.length === 0, axeLight);

  // save into the document
  await page.fill('#tactileDrawDialog .td-meta input >> nth=0', 'Pond');
  await page.fill('#tactileDrawDialog .td-meta input >> nth=1', 'A pond with a lake label');
  await page.click('#tactileDrawDialog .td-btn.primary');
  await page.waitForFunction(() => !document.getElementById('tactileDrawDialog'));
  await page.waitForFunction(() => (window.lastModel?.blocks || []).some((b) => b.type === 'graphic'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  let g = await lastGraphic(page);
  ok('saving puts the SVG on the graphic block, with the title and description', g && /data-tactile-draw="1"/.test(g.svg) && g.title === 'Pond' && g.alt === 'A pond with a lake label', g && { title: g.title, alt: g.alt });
  ok('the saved SVG carries the rectangle, line, label and the hatch pattern', g && /<rect[^>]*url\(#tx-hatch\)/.test(g.svg) && /<line /.test(g.svg) && /data-print="Lake"/.test(g.svg) && /<pattern id="tx-hatch"/.test(g.svg), g && g.svg.slice(0, 300));
  const brf = await page.evaluate(() => window.lastBrf || '');
  ok('the braille has the graphic\'s label line', /POND/i.test(brf), brf.slice(0, 300));
  const xml = await page.evaluate(() => window.exportCurrentDocumentXml());
  ok('it is saved with the document (NIMAS img holds the SVG as a data URI)', /<img[^>]*src="data:image\/svg\+xml;base64,/.test(xml), xml.slice(0, 200));
  ok('the graphic block in the editor shows the drawing (not re-converted: patterns and strokes as drawn)', await page.evaluate(() => { const w = document.querySelector('#editor .graphic-preview-svg-wrap svg'); return !!w && w.querySelector('pattern#tx-hatch, pattern[id^="tx-hatch"]') !== null && w.getAttribute('data-tactile-draw') === '1'; }));

  // reopen: double-click, then Enter, then the button
  await page.dblclick('#editor .graphic-preview-svg-wrap');
  await page.waitForSelector('#tactileDrawDialog[open]');
  s = await td(page);
  ok('a double-click on the graphic reopens the drawing with everything in it', s.shapes.length === 3 && s.shapes.map((x) => x.kind).sort().join() === 'line,rect,text', s.shapes.map((x) => x.kind));
  ok('the title and description are kept', await page.evaluate(() => { const i = document.querySelectorAll('#tactileDrawDialog .td-meta input'); return i[0].value === 'Pond' && i[1].value === 'A pond with a lake label'; }));
  await page.focus('#tactileDrawDialog .td-svg');
  await page.keyboard.press('Control+a'); await page.keyboard.press('ArrowRight');
  await page.click('#tactileDrawDialog .td-btn.primary');
  await page.waitForFunction(() => !document.getElementById('tactileDrawDialog'));
  await page.waitForTimeout(800);
  const g2 = await lastGraphic(page);
  ok('saving the change replaces the drawing in the same block (still one graphic)', g2 && g2.n === 1 && g2.svg !== g.svg && /x="3[0-9.]+"/.test(g2.svg), g2 && g2.n);
  await page.focus('#editor .graphic-preview-svg-wrap');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tactileDrawDialog[open]');
  ok('Enter on the graphic opens the drawing (keyboard)', true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('tactileDrawDialog') || !document.getElementById('tactileDrawDialog').open);
  // the dialog removes itself on its 'close' event, which the browser fires a moment after close() (a queued task): wait for it
  await page.waitForFunction(() => !document.getElementById('tactileDrawDialog'), null, { timeout: 3000 }).catch(() => {});
  ok('Escape closes an unchanged drawing at once', await page.evaluate(() => !document.getElementById('tactileDrawDialog')));
  await page.click('#editor .graphic-context-btn:has-text("Edit drawing")');
  await page.waitForSelector('#tactileDrawDialog[open]');
  ok('the Edit drawing button opens it too', true);

  // import an SVG file
  const SAMPLE = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100" viewBox="0 0 150 100"><rect x="10" y="10" width="60" height="40" fill="#2563eb" stroke="#000" stroke-width="2"/><circle cx="110" cy="50" r="25" fill="#e11d48" stroke="#000"/><line x1="10" y1="90" x2="140" y2="90" stroke="#000" stroke-dasharray="8,4"/><image href="x.png" x="0" y="0" width="5" height="5"/></svg>';
  await page.setInputFiles('#tactileDrawDialog input[type=file]', { name: 'sample.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(SAMPLE) });
  await page.waitForFunction(() => document.getElementById('tactileDrawDialog')._td.doc.shapes.length === 3 && document.getElementById('tactileDrawDialog')._td.doc.shapes[0].kind === 'rect');
  s = await td(page);
  ok('an SVG file opens in the tool: colours became two textures, the dash a dashed line', s.shapes[0].texture !== 'none' && s.shapes[1].texture !== 'none' && s.shapes[0].texture !== s.shapes[1].texture && s.shapes[2].line === 'dashed', s.shapes.map((x) => [x.kind, x.texture, x.line]));
  ok('what could not be imported is said', /image/.test(await status(page)), await status(page));
  await page.focus('#tactileDrawDialog .td-svg');
  await page.keyboard.press('Control+z');
  s = await td(page);
  ok('Undo brings the old drawing back after an import', s.shapes.length === 3 && s.shapes.map((x) => x.kind).sort().join() === 'line,rect,text', s.shapes.map((x) => x.kind));
  const dl = page.waitForEvent('download');
  await page.click('#tactileDrawDialog button:has-text("Save as SVG file")');
  const d = await dl;
  ok('Save as SVG file downloads an .svg', /\.svg$/.test(d.suggestedFilename()), d.suggestedFilename());

  // keyboard only, in a fresh drawing
  await page.keyboard.press('Escape');                         // an unchanged-since-open drawing? it has changes (import then undo): asks
  await page.waitForTimeout(200);
  if (await page.evaluate(() => !!document.querySelector('#tactileDrawDialog .td-confirm'))) await page.click('#tactileDrawDialog button:has-text("Discard changes")');
  await page.waitForFunction(() => !document.getElementById('tactileDrawDialog'));
  await page.evaluate(() => { window.openTactileDrawing(); });
  await page.waitForSelector('#tactileDrawDialog[open]');
  await page.focus('#tactileDrawDialog .td-svg');
  await page.keyboard.press('r');
  ok('the R key chooses the Rectangle tool and says so', (await td(page)).tool === 'rect' && /Rectangle tool/.test(await status(page)), await status(page));
  await page.keyboard.press('Enter');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  s = await td(page);
  ok('a rectangle drawn with the keyboard alone (cursor, Enter, arrows, Enter)', s.shapes.length === 1 && s.shapes[0].kind === 'rect' && s.shapes[0].width === 15 && s.shapes[0].height === 10, s.shapes);
  await page.keyboard.press('l');
  await page.keyboard.press('Enter'); for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  s = await td(page);
  ok('a line with the keyboard alone', s.shapes.length === 2 && s.shapes[1].kind === 'line' && s.shapes[1].x2 - s.shapes[1].x1 === 20, s.shapes);
  await page.keyboard.press('p');
  await page.keyboard.press('Enter'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.keyboard.press(' ');
  s = await td(page);
  ok('a polyline by keyboard: Enter adds corners, Space finishes', s.shapes.length === 3 && s.shapes[2].kind === 'polyline' && s.shapes[2].points.length >= 3, s.shapes[2]);
  await page.keyboard.press('Escape');                           // clears the new polyline's selection
  await page.keyboard.press('Tab');
  s = await td(page);
  ok('Tab selects the first shape, Tab again the next', s.sel.length === 1 && s.sel[0] === s.shapes[0].id, s.sel);
  await page.keyboard.press('Tab');
  s = await td(page);
  ok('Tab walks on through the shapes', s.sel[0] === s.shapes[1].id, s.sel);
  await page.keyboard.press('Delete');
  s = await td(page);
  ok('Delete removes the selected shape; the status says so', s.shapes.length === 2 && /Deleted/.test(await status(page)), await status(page));
  await page.keyboard.press('Control+z');
  ok('Ctrl+Z brings it back', (await td(page)).shapes.length === 3);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  ok('Escape clears the selection first, and does not close the dialog', await page.evaluate(() => document.getElementById('tactileDrawDialog').open && document.getElementById('tactileDrawDialog')._td.doc.selection.size === 0));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  ok('Escape on a changed drawing asks before discarding (and keeps it open)', await page.evaluate(() => document.getElementById('tactileDrawDialog').open && !!document.querySelector('#tactileDrawDialog .td-confirm')));
  const widths = await page.evaluate(() => { const d = document.getElementById('tactileDrawDialog'); return [d.querySelector('.td-svg').getAttribute('aria-label'), d.querySelector('#tdKeys').textContent.length > 20]; });
  ok('the drawing area has a name and a keyboard description', widths[0] === 'Drawing area' && widths[1], widths);
  await page.click('#tactileDrawDialog button:has-text("Keep editing")');
  await page.click('#tactileDrawDialog button:has-text("Cancel")');
  await page.click('#tactileDrawDialog button:has-text("Discard changes")');
  await page.waitForFunction(() => !document.getElementById('tactileDrawDialog'));
  ok('Cancel then Discard leaves the document as it was (one graphic)', (await lastGraphic(page)).n === 1);
  await ctx.close();

  console.log(`--- ${ENGINE_LABEL}: axe in the dark scheme ---`);
  {
    const { ctx: c2, page: p2 } = await open('dark', true);
    await p2.evaluate(() => { window.openTactileDrawing(); });
    await p2.waitForSelector('#tactileDrawDialog[open]');
    await p2.click('#tactileDrawDialog [data-tool="rect"]');
    await drag(p2, [30, 30], [100, 80]);
    await p2.click('#tactileDrawDialog button:has-text("Put key on drawing")');
    const a = await axeScan(p2);
    ok('axe WCAG 2 A/AA: nothing to fix in the drawing dialog (dark)', a.length === 0, a);
    await c2.close();
  }
  ok('no page errors', errors.length === 0, errors);
} catch (e) {
  failures.push({ name: 'test crashed', detail: String(e && e.stack || e) });
  console.error(e);
}
await browser.close();
console.log(`\n${ENGINE_LABEL}: ${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error(' -', f.name, JSON.stringify(f.detail).slice(0, 400)); process.exit(1); }
