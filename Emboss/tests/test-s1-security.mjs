// S1 security batch (ChatGPT audit of 15 Oct 2026, Paul's decision F2: security first) — the two items that live in the editor page.
//
// #24 (P1)  MathLive 0.101.2 let an imported equation run script (GHSA-qwj6-q94f-8425, fixed in 0.104.0; GHSA-fm7p-gw32-828p, fixed in
//           0.110.0): `$\htmlData{><img/onerror=window.X=1"src=}{}$` in a Markdown file set a marker when the equation was drawn.
//           Emboss now ships MathLive 0.111.1. Harmless markers only: every payload below sets a test-only window property and
//           nothing else; nothing is requested from outside localhost. The marker is trapped by a setter installed before the page
//           loads, so a hit says which payload fired, wherever it came from (import, rendering, editing, the read-aloud overlay).
//           Also: maths still works (an equation still draws, edits and is read back as LaTeX).
// #23 (P2)  An imported SVG's <style> was kept and the SVG put inline, so `body{--x:1}` or `*{display:none}` in a graphic reached the
//           application. Now the graphic's rules are scoped to the graphic, url() may only name a fragment of the same document,
//           and a graphic cannot start a request. A normal styled SVG still draws the same.
//
// Runs in the engine EMBOSS_ENGINE names (default Chrome; tests/lib/launch-browser.mjs).
// Usage: node Emboss/scripts/serve.mjs 8197 &   then   node Emboss/tests/test-s1-security.mjs [port]
// run-all-tests.mjs lists this as "browser (not run)" (it imports 'playwright').
import { launchBrowser, ENGINE_LABEL } from './lib/launch-browser.mjs';

const PORT = Number(process.argv[2] || process.env.PORT || 8137);
let pass = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ok    ${name}`); }
  else { failures.push({ name, detail }); console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail).slice(0, 700) : ''}`); }
};

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, serviceWorkers: 'block' });
await ctx.addInitScript(() => {
  try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', uiLanguage: 'en' })); } catch {}
  // The harmless marker: a setter that only records the value written.
  Object.defineProperty(window, '__embossS1', { configurable: true, get() { return undefined; }, set(v) { (window.__s1hits = window.__s1hits || []).push(v); } });
});
// Anything asked of a host other than the dev server is recorded and refused; a path containing __probe is the SVG test's tripwire.
const outside = [];
const probed = [];
await ctx.route('**/*', (route) => {
  const u = new URL(route.request().url());
  if (/__probe/.test(route.request().url())) probed.push(route.request().url());
  if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
  outside.push(u.origin);
  return route.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
page.on('dialog', (d) => d.accept());
const wait = (ms) => page.waitForTimeout(ms);
// The hits since the last look (then cleared), each payload's number once.
const hits = () => page.evaluate(() => { const h = [...new Set(window.__s1hits || [])]; window.__s1hits = []; return h; });
const noMarker = async (name) => { const h = await hits(); ok(name, h.length === 0, { markersSet: h }); };

// ---- payloads: each writes its own number into the marker ----
const PAYLOADS = [
  String.raw`\htmlData{><img/onerror=window.__embossS1=1"src=}{}`,                      // the audit's own (GHSA-qwj6-q94f-8425)
  String.raw`\htmlData{a=b"><img src=x onerror="window.__embossS1=2">}{x}`,
  String.raw`\text{<img src=x onerror=window.__embossS1=3>}`,                            // text reflection (GHSA-fm7p-gw32-828p)
  String.raw`\mathrm{<img src=x onerror=window.__embossS1=4>}`,
  String.raw`\href{"><img src=x onerror=window.__embossS1=5>}{x}`,
  String.raw`\class{"><img src=x onerror=window.__embossS1=6>}{x}`,
  String.raw`\htmlId{"><img src=x onerror=window.__embossS1=7>}{x}`,
  String.raw`\htmlStyle{"><img src=x onerror=window.__embossS1=8>}{x}`,
  String.raw`\mathrm{</span><img src=x onerror=window.__embossS1=9>}`,
  String.raw`\mbox{<svg onload=window.__embossS1=10>}`,
  String.raw`x<img src=x onerror=window.__embossS1=11>`,
];

try {
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.importFile === 'function' && typeof window.modelToLexical === 'function', null, { timeout: 60000 });
  await wait(2000);
  await page.waitForFunction(() => customElements.get('math-field'), null, { timeout: 20000 });

  // ================= #24 MathLive =================
  await hits();
  console.log('--- #24: the shipped MathLive ---');
  const ver = await page.evaluate(() => (window.MathfieldElement && window.MathfieldElement.version) || (window.MathLive && window.MathLive.version) || null);
  const src = await (await fetch(`http://localhost:${PORT}/web/vendor/mathlive.min.js`)).text();
  const banner = /MathLive (\d+)\.(\d+)\.(\d+)/.exec(src.slice(0, 200));
  const minor = banner ? Number(banner[2]) : -1;
  ok('the vendored file says it is MathLive 0.110 or later (fixes both advisories)', !!banner && Number(banner[1]) === 0 && minor >= 110, banner && banner[0]);
  ok('the running library reports the same version', !banner || ver == null || String(ver).startsWith(`${banner[1]}.${banner[2]}.${banner[3]}`), { ver, banner: banner && banner[0] });

  console.log('--- #24: imported maths (Markdown, HTML, NIMAS) sets no marker ---');
  const importMd = async (text) => { await page.evaluate(async (t) => { window.markDocumentClean(); await window.importFile(new File([t], 'eq.md', { type: 'text/markdown' })); }, text); await wait(1200); };
  await importMd('Equation: $' + PAYLOADS[0] + '$');
  ok('the audit payload is imported as an equation (the field exists)', (await page.evaluate(() => document.querySelectorAll('#editor math-field').length)) >= 1);
  await noMarker('Markdown import of the audit payload sets no marker');
  ok('…and no element in the page (shadow roots included) carries an event-handler attribute',
    (await page.evaluate(() => {
      const bad = [];
      const scan = (root) => { for (const el of root.querySelectorAll('*')) { for (const a of el.attributes) if (/^on/i.test(a.name)) bad.push(el.tagName + '@' + a.name); if (el.shadowRoot) scan(el.shadowRoot); } };
      scan(document); return bad;
    })).length === 0);
  for (const [i, p] of PAYLOADS.entries()) {
    await importMd('Equation: $' + p + '$ and more.');
    await noMarker(`Markdown import, payload ${i + 1}: no marker`);
  }
  // HTML with MathML (an annotation that carries TeX, and plain text in <mtext>), and a NIMAS book
  for (const [i, p] of PAYLOADS.slice(0, 4).entries()) {
    const esc = p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    await page.evaluate(async (h) => { window.markDocumentClean(); await window.importFile(new File([h], 'eq.html', { type: 'text/html' })); }, `<html><body><p>Before <math><mtext>${esc}</mtext></math> after.</p><p>Tex <math><semantics><mi>x</mi><annotation encoding="application/x-tex">${esc}</annotation></semantics></math></p></body></html>`);
    await wait(1000);
    await noMarker(`HTML/MathML import, payload ${i + 1}: no marker`);
  }
  for (const [i, p] of PAYLOADS.slice(0, 4).entries()) {
    const esc = p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const nimas = `<?xml version="1.0" encoding="UTF-8"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML" version="2005-3" xml:lang="en"><head><meta name="dc:Title" content="T"/><meta name="dc:Identifier" content="x"/></head><book><frontmatter><doctitle>T</doctitle></frontmatter><bodymatter><level1><h1>One</h1><p>See <m:math alttext="${esc}"><m:mtext>${esc}</m:mtext><m:annotation encoding="application/x-tex">${esc}</m:annotation></m:math> here.</p></level1></bodymatter></book></dtbook>`;
    await page.evaluate(async (x) => { window.markDocumentClean(); await window.importFile(new File([x], 'book.xml', { type: 'text/xml' })); }, nimas);
    await wait(1200);
    await noMarker(`NIMAS import, payload ${i + 1}: no marker`);
  }

  console.log('--- #24: rendering and editing ---');
  const modelWith = (latex) => ({ blocks: [{ type: 'para', segments: [{ type: 'text', text: 'Eq ' }, { type: 'math', latex }, { type: 'text', text: ' end.' }] }] });
  for (const [i, p] of PAYLOADS.entries()) {
    await page.evaluate(async (m) => { window.markDocumentClean(); window.modelToLexical(m); await window.render(); }, modelWith(p));
    await wait(700);
    await noMarker(`drawing an equation loaded from the model, payload ${i + 1}: no marker`);
  }
  // edit: set the value of a live field, insert at the caret, and type it through the keyboard
  await page.evaluate(async (m) => { window.markDocumentClean(); window.modelToLexical(m); await window.render(); }, modelWith('x+1'));
  await wait(700);
  for (const [i, p] of PAYLOADS.entries()) {
    await page.evaluate((v) => { const mf = document.querySelector('#editor math-field'); mf.value = v; mf.dispatchEvent(new Event('input', { bubbles: true })); }, p);
    await wait(300);
    await page.evaluate((v) => { const mf = document.querySelector('#editor math-field'); mf.focus(); mf.executeCommand(['insert', v]); }, p);
    await wait(300);
    await noMarker(`setting and inserting into a live field, payload ${i + 1}: no marker`);
  }
  await page.evaluate(async (m) => { window.markDocumentClean(); window.modelToLexical(m); await window.render(); }, modelWith('a'));
  await wait(500);
  await page.click('#editor math-field');
  await page.keyboard.type(String.raw`\text{<img src=x onerror=window.__embossS1=12>}`, { delay: 5 });
  await page.keyboard.press('Enter');
  await wait(500);
  await noMarker('typing a payload into an equation with the keyboard: no marker');
  // the other places the editor hands MathLive output to the page
  await page.evaluate(async (ps) => {
    const host = document.createElement('div'); document.body.appendChild(host);
    for (const p of ps) {
      try { host.innerHTML = window.MathLive.convertLatexToMarkup(p); } catch {}
      try { const d = document.createElement('div'); d.innerHTML = window.MathLive.convertLatexToMathMl(p); host.appendChild(d); } catch {}
      try { window.MathLive.convertLatexToSpeakableText(p); } catch {}
    }
    await new Promise((r) => setTimeout(r, 800));
    host.remove();
  }, PAYLOADS);
  await noMarker('convertLatexToMarkup / MathML / speech output of every payload, put into the page, sets no marker');

  console.log('--- #24: maths still works ---');
  await page.evaluate(async (m) => { window.markDocumentClean(); window.modelToLexical(m); await window.render(); }, modelWith('\\frac{a}{b}+\\sqrt{x}'));
  await wait(800);
  const mathState = await page.evaluate(() => {
    const mf = document.querySelector('#editor math-field');
    const sr = mf && mf.shadowRoot;
    return { exists: !!mf, value: mf && mf.value, drawn: !!(sr && sr.querySelector('.ML__latex, .ML__mathlive, .ML__base')), frac: !!(sr && sr.querySelector('.ML__mfrac')), w: mf ? mf.getBoundingClientRect().width : 0 };
  });
  ok('an equation is drawn (fraction and root present)', mathState.exists && mathState.drawn && mathState.frac && mathState.w > 20, mathState);
  ok('its value reads back as the LaTeX that was loaded', /\\frac\{a\}\{b\}/.test(mathState.value || '') && /\\sqrt\{x\}/.test(mathState.value || ''), mathState.value);
  await page.click('#editor math-field');
  await wait(300);
  await page.keyboard.press('End');
  await page.keyboard.type('+z');
  await page.waitForFunction(() => /z/.test(document.querySelector('#editor math-field')?.value || ''), null, { timeout: 5000 }).catch(() => {});
  const after = await page.evaluate(() => ({ v: document.querySelector('#editor math-field').value, act: document.activeElement.tagName, para: document.querySelector('#editor p')?.textContent }));
  ok('typing in an equation changes its value', /\+z$/.test(after.v), after);
  ok('MathLive converts LaTeX to MathML and to speech', await page.evaluate(() => /<(math|msup)/.test(window.MathLive.convertLatexToMathMl('x^2')) && /squared|x/i.test(window.MathLive.convertLatexToSpeakableText('x^2'))));

  // ================= #23 SVG =================
  console.log('--- #23: an imported graphic cannot restyle or call out of the app ---');
  const PROBE = `http://localhost:${PORT}/__probe/`;
  const EXT = 'http://example.invalid/__probe/';
  const hostileSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <style>
      @import url(${PROBE}import.css);
      @font-face { font-family: F; src: url(${PROBE}font.woff2); }
      body { --s1-leak: APPLIED; background: red !important; }
      html, :root { --s1-root: APPLIED; }
      * { display: none !important; }
      #btnMath, button, .toolbar, #editor { display: none !important; visibility: hidden !important; }
      .box { fill: url(${EXT}fill.svg#a); stroke: url("${PROBE}stroke.svg"); }
      .ok { fill: rgb(255, 0, 0); stroke: #0000ff; stroke-width: 2; }
      svg .ok2 { fill: green; }
      rect { background-image: url(${PROBE}bg.png); }
    </style>
    <defs><linearGradient id="g1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs>
    <rect class="ok" x="2" y="2" width="16" height="16"/>
    <rect class="ok2" x="22" y="2" width="16" height="16"/>
    <rect class="box" x="2" y="22" width="16" height="16" style="filter:url(${PROBE}filter.svg#f); fill:url(${EXT}inline.svg#z); background:url(${PROBE}style.png)"/>
    <rect x="22" y="22" width="16" height="16" fill="url(${PROBE}attr.svg#a)" filter="url(${PROBE}attr2.svg#a)" mask="url(${PROBE}mask.svg#m)"/>
    <rect x="22" y="22" width="4" height="4" fill="url(#g1)"/>
  </svg>`;
  const plainSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><style>.ok{fill:rgb(255,0,0);stroke:#0000ff;stroke-width:2} svg .ok2{fill:green} g > rect.k {fill:#123456}</style><rect class="ok" x="2" y="2" width="16" height="16"/><rect class="ok2" x="22" y="2" width="16" height="16"/><g><rect class="k" x="2" y="22" width="16" height="16"/></g></svg>`;
  const loadGraphic = async (svg) => {
    await page.evaluate(async (s) => { window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'para', text: 'Before.' }, { type: 'graphic', svg: s, alt: 'Style test' }, { type: 'para', text: 'After.' }] }); await window.render(); }, svg);
    await wait(900);
  };
  const bodyBefore = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, btn: getComputedStyle(document.querySelector('#btnMath') || document.body).display }));
  await loadGraphic(hostileSvg);
  const probe = await page.evaluate(() => ({
    leak: getComputedStyle(document.body).getPropertyValue('--s1-leak').trim(),
    root: getComputedStyle(document.documentElement).getPropertyValue('--s1-root').trim(),
    bg: getComputedStyle(document.body).backgroundColor,
    btn: getComputedStyle(document.querySelector('#btnMath') || document.body).display,
    editor: getComputedStyle(document.querySelector('#editor')).display,
    editorVisible: document.querySelector('#editor').getBoundingClientRect().height,
    paraVisible: [...document.querySelectorAll('#editor p')].every((p) => getComputedStyle(p).display !== 'none'),
    svgCount: document.querySelectorAll('#editor .graphic-preview-svg-wrap svg').length,
  }));
  ok('the graphic is on the page', probe.svgCount === 1, probe);
  ok('a body{--x:1} rule in the graphic does not reach the body', probe.leak === '', probe.leak);
  ok('…nor html/:root', probe.root === '', probe.root);
  ok('…the body background is untouched', probe.bg === bodyBefore.bg, { before: bodyBefore.bg, after: probe.bg });
  ok('a *{display:none} / #editor / button rule does not hide the application', probe.editor !== 'none' && probe.editorVisible > 20 && probe.paraVisible && probe.btn === bodyBefore.btn, probe);
  ok('the graphic makes no request (CSS @import, @font-face, url() in a rule, a style attribute or a presentation attribute)', probed.length === 0 && outside.length === 0, { probed, outside });
  const innards = await page.evaluate(() => {
    const w = document.querySelector('#editor .graphic-preview-svg-wrap');
    return { css: [...w.querySelectorAll('style')].map((s) => s.textContent).join('\n'), attrs: [...w.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => a.name + '=' + a.value)).join('\n') };
  });
  ok('no url() left in the live graphic points anywhere but into the document', !/url\(\s*["']?\s*(?!#)/i.test(innards.css + '\n' + innards.attrs), innards);
  ok('no @import left', !/@import/i.test(innards.css));
  ok('the gradient fill that refers to #g1 is kept', /url\(#g1\)/.test(innards.attrs));

  console.log('--- #23: a normal graphic still draws the same ---');
  await loadGraphic(plainSvg);
  const draw = await page.evaluate(() => {
    const rs = [...document.querySelectorAll('#editor .graphic-preview-svg-wrap svg rect')];
    const cs = (r) => { const c = getComputedStyle(r); return { fill: c.fill, stroke: c.stroke, sw: c.strokeWidth }; };
    return { n: rs.length, a: rs[0] && cs(rs[0]), b: rs[1] && cs(rs[1]), c: rs[2] && cs(rs[2]) };
  });
  ok('three shapes drawn', draw.n === 3, draw);
  ok('a class rule still colours its shape (fill red, stroke blue, width 2)', draw.a && draw.a.fill === 'rgb(255, 0, 0)' && draw.a.stroke === 'rgb(0, 0, 255)' && parseFloat(draw.a.sw) === 2, draw.a);
  ok('an "svg .class" rule still works', draw.b && draw.b.fill === 'rgb(0, 128, 0)', draw.b);
  ok('a child-combinator rule still works', draw.c && draw.c.fill === 'rgb(18, 52, 86)', draw.c);
  // two graphics: one's rule must not colour the other
  await page.evaluate(async (a) => {
    const b = a.replace('rgb(255,0,0)', 'rgb(0,200,200)');
    window.markDocumentClean(); window.modelToLexical({ blocks: [{ type: 'graphic', svg: a, alt: 'one' }, { type: 'graphic', svg: b, alt: 'two' }] }); await window.render();
  }, plainSvg);
  await wait(900);
  const two = await page.evaluate(() => [...document.querySelectorAll('#editor .graphic-preview-svg-wrap')].map((w) => getComputedStyle(w.querySelector('rect.ok')).fill));
  ok('two graphics with the same class names keep their own colours', two.length === 2 && two[0] === 'rgb(255, 0, 0)' && two[1] === 'rgb(0, 200, 200)', two);

  ok('no uncaught page errors', errors.length === 0, errors);
  ok('nothing was requested from outside localhost', outside.length === 0, outside);
} catch (e) {
  failures.push({ name: 'suite crashed', detail: String(e && e.stack || e).slice(0, 800) });
  console.error('  ✖ CRASH', e);
} finally {
  await browser.close();
}
console.log(`\n${ENGINE_LABEL}: ${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error(' -', f.name); process.exit(1); }
