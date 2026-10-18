// Import-fidelity audit (30 Sep 2026). AUDIT ONLY: it changes nothing in the app.
//
// For every fixture under Emboss/tests/fixtures/import-audit/ (plus a few real Word/ODT/RTF/EPUB
// samples already in the repo) it loads the file through the editor's real Load path
// (page.setInputFiles('#loadFileInput', file)), then records what survived at each stage of
//   import  ->  editor display  ->  save (NIMAS XML)  ->  braille (BRF)
// and compares it with a written expectation per feature. Result per feature:
//   PASS     the feature survives and is shown/brailled as it should be
//   PARTIAL  it survives but part of it is lost or only one of the stages keeps it
//   WRONG    it is kept but mangled, mis-structured or shown wrongly
//   LOST     the content or the meaning silently disappears
//
// The existing "all formats" suite only checks that a file yields some blocks and some braille;
// this one checks that each FEATURE survives. See Emboss/docs/import-fidelity-audit.md for the
// findings, with file:line and a suggested fix size for each.
//
// Usage (needs its own dev server):
//   node Emboss/scripts/serve.mjs 8275 &            # then, when done, kill that pid only
//   node Emboss/scripts/audit-import-fidelity.mjs [port] [--filter SUBSTR] [--dump DIR] [--shots DIR]
//                                                 [--json FILE] [--md FILE] [--list] [--no-shots]
//   --dump DIR   write every fixture's raw capture (parsed model, editor structure, saved XML, BRF)
//   --shots DIR  write editor screenshots (default: none unless given; scratch folder only)
//   --json FILE  write the machine-readable results
//   --md FILE    write the results as Markdown tables (one per format)
// Not run by run-all-tests.mjs (imports 'playwright'; needs a server). Exit code 0 always: this is a
// report, not a gate -- the findings are the point.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(HERE, '..');
const FIX = path.join(EMBOSS, 'tests/fixtures/import-audit');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const PORT = Number(args.find((a) => /^\d+$/.test(a)) || process.env.PORT || 8275);
const FILTER = opt('--filter');
const DUMP = opt('--dump');
const SHOTS = opt('--shots');
const JSON_OUT = opt('--json');
const MD_OUT = opt('--md');

// ===================================================================== check helpers
const R = {
  pass: (ev) => ({ status: 'PASS', ev }),
  partial: (ev) => ({ status: 'PARTIAL', ev }),
  wrong: (ev) => ({ status: 'WRONG', ev }),
  lost: (ev) => ({ status: 'LOST', ev }),
};
const PUA_RE = /[\ue000-\uf8ff]/;
const showPua = (s) => String(s ?? '').replace(/[\ue000-\uf8ff]/g, (c) => `<U+${c.charCodeAt(0).toString(16).toUpperCase()}>`);
const clip = (s, n = 160) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ===================================================================== the capture (runs in the page)
// Everything below is executed inside the editor page; it only READS state.
function pageCapture() {
  const esc = (s) => String(s ?? '').replace(/[\ue000-\uf8ff]/g, (c) => `<U+${c.charCodeAt(0).toString(16).toUpperCase()}>`);
  const root = document.getElementById('editor');
  const simplify = (el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll('*').forEach((n) => {
      n.removeAttribute('data-lexical-text'); n.removeAttribute('dir'); n.removeAttribute('data-lexical-decorator');
      n.removeAttribute('contenteditable'); n.removeAttribute('tabindex'); n.removeAttribute('data-block-idx');
      if (n.tagName === 'SPAN' && !n.attributes.length) n.replaceWith(...n.childNodes);
    });
    c.querySelectorAll('.table-context-bar,.math-plot-btn,button').forEach((n) => n.remove());
    return esc(c.outerHTML.replace(/\s+style="[^"]*"/g, ''));
  };
  const blocks = [];
  for (const el of root.children) {
    const b = { tag: el.tagName.toLowerCase(), cls: el.className || '', text: esc(el.innerText).replace(/\n{3,}/g, '\n\n').trim(), html: simplify(el).slice(0, 3000) };
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      b.items = [...el.children].filter((x) => x.tagName === 'LI').map((li) => {
        const cs = getComputedStyle(li); const bf = getComputedStyle(li, '::before');
        const beforeTxt = bf.content && bf.content !== 'none' && bf.content !== 'normal' ? bf.content.replace(/^"|"$/g, '') : '';
        const nativeShown = cs.display === 'list-item' && cs.listStyleType !== 'none';
        return {
          text: esc(li.textContent), level: li.getAttribute('data-level') ? Number(li.getAttribute('data-level')) : 0, dataMarker: li.getAttribute('data-marker'),
          before: beforeTxt, nativeMarker: nativeShown ? cs.listStyleType : '', markersShown: (beforeTxt ? 1 : 0) + (nativeShown ? 1 : 0),
        };
      });
    }
    if (el.querySelector && el.querySelector('table.editor-table-widget')) {
      const t = el.querySelector('table.editor-table-widget');
      b.table = {
        head: [...t.querySelectorAll('thead th')].map((c) => ({ text: esc(c.innerText).trim(), colspan: c.colSpan, rowspan: c.rowSpan })),
        rows: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => ({ text: esc(c.innerText).trim(), colspan: c.colSpan, rowspan: c.rowSpan }))),
        caption: esc(el.querySelector('caption')?.innerText || ''),
        struck: [...t.querySelectorAll('s, strike, del, [style*="line-through"]')].map((e) => esc(e.innerText).trim()),   // text drawn struck through
        title: esc(el.querySelector('.table-title,[class*=table-title]')?.innerText || ''),
        bar: el.querySelector('.table-context-bar strong')?.innerText || '',
      };
    }
    blocks.push(b);
  }
  const fmt = {};
  const count = (sel) => root.querySelectorAll(sel).length;
  fmt.strong = count('strong,.ed-b'); fmt.em = count('em,.ed-i'); fmt.u = count('.ed-u,u'); fmt.s = count('s,del,.ed-s,[class*=strike]');
  fmt.sub = count('sub'); fmt.sup = count('sup'); fmt.script = count('[style*="--bana-script"], .cell-script'); fmt.a = count('a'); fmt.img = count('img'); fmt.math = count('.math-embed');
  const vis = (id) => { const e = document.getElementById(id); return e && !e.hidden ? e.innerText.trim() : null; };
  const banners = {
    parse: vis('parseWarningBanner'), symbols: vis('symbolNoticeBanner'),
    warnings: (document.body.innerText.match(/\d+ transcription warnings?/) || [null])[0],
    review: (document.body.innerText.match(/\d+ words? to check|\d+ to review/) || [null])[0],
  };
  const tr = window.lastTrace || {};
  return {
    editorText: esc(root.innerText), blocks, fmt, banners,
    model: JSON.parse(JSON.stringify(window.lastModel ? window.lastModel.blocks : [], (k, v) => (typeof v === 'string' && v.length > 400 && /^(data:|<svg)/.test(v) ? v.slice(0, 40) + '…' : v))),
    modelTitle: window.lastModel?.title ?? null,
    brf: window.lastBrf || '',
    traceLines: tr.pagePlan ? (tr.pagePlan.lines || null) : null, traceRows: tr.rows || null,
    warningsList: (window.lastWarnings || []).map((w) => ({ kind: w.kind, message: w.message, snippet: w.snippet })),
    xml: (() => { try { return window.exportCurrentDocumentXml(); } catch (e) { return 'EXPORT-ERROR: ' + e.message; } })(),
  };
}

const jsonReplacer = (k, v) => (typeof v === 'string' && v.length > 400 && /^(data:|<svg)/.test(v) ? v.slice(0, 40) + '…' : v);

// Every text leaf anywhere inside a model block (paragraph text/segments, list items, table cells, notes, boxes ...).
function leaves(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string') { out.push({ text: node, cell: true }); return out; }
  if (Array.isArray(node)) { for (const n of node) leaves(n, out); return out; }
  if (typeof node !== 'object') return out;
  if (Array.isArray(node.segments)) { for (const s of node.segments) if (s && typeof s === 'object') out.push({ ...s, text: s.text ?? s.latex ?? '', inType: node.type }); }
  else if (typeof node.text === 'string') out.push({ text: node.text, inType: node.type, level: node.level, marker: node.marker });
  if (typeof node.title === 'string') out.push({ text: node.title, inType: 'title' });
  if (typeof node.caption === 'string') out.push({ text: node.caption, inType: 'caption' });
  for (const k of ['blocks', 'items', 'rows', 'headers']) if (node[k]) leaves(node[k], out);
  return out;
}
const leafTexts = (b) => leaves(b).map((l) => l.text);
// index of a fixture token in a string: tokens that start "alpha" must not be followed by a letter/digit (so "alphas" is not found in "alphastrong")
const tokIdx = (s, tok) => {
  const i = s.indexOf(tok);
  if (i < 0 || !/^alpha/.test(tok)) return i;
  const m = new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])').exec(s);
  return m ? m.index : -1;
};
// names (.class) of the XML/HTML elements open at string index `idx`
function stackAt(str, idx) {
  const stack = [];
  const re = /<(\/)?([A-Za-z_][\w:.-]*)([^>]*?)(\/)?>/g;
  const head = str.slice(0, idx);
  let m;
  while ((m = re.exec(head)) !== null) {
    if (m[4]) continue;
    if (m[1]) { const j = stack.map((s) => s.n).lastIndexOf(m[2]); if (j >= 0) stack.length = j; }
    else stack.push({ n: m[2], cls: (/class="([^"]*)"/.exec(m[3]) || [])[1] || '' });
  }
  return stack.map((s) => s.n + (s.cls ? '.' + s.cls : ''));
}

// ===================================================================== context passed to every check
function makeCtx(fx, cap, parsed, errors) {
  const c = { fx, cap, parsed: parsed.blocks, parsedRaw: parsed, errors, xml: cap.xml, brf: cap.brf, ed: cap.editorText, model: cap.model };
  c.parsedJson = JSON.stringify(parsed, jsonReplacer);
  c.modelJson = JSON.stringify(cap.model);
  // editor block containing a word (first match)
  c.edBlock = (w) => cap.blocks.find((b) => tokIdx(b.text || '', w) >= 0 || tokIdx(b.html || '', w) >= 0) || null;
  c.edBlocks = (w) => cap.blocks.filter((b) => (b.text || '').includes(w));
  c.edHas = (w) => tokIdx(cap.editorText, w) >= 0;
  c.xmlHas = (w) => tokIdx(cap.xml, w) >= 0;
  c.xmlAround = (w, n = 140) => { const i = cap.xml.indexOf(w); return i < 0 ? null : cap.xml.slice(Math.max(0, i - n), i + w.length + n); };
  c.parsedAround = (w, n = 200) => { const i = c.parsedJson.indexOf(w); return i < 0 ? null : c.parsedJson.slice(Math.max(0, i - n), i + w.length + n); };
  c.modelIndex = (w) => cap.model.findIndex((b) => tokIdx(JSON.stringify(b), w) >= 0);
  c.modelBlock = (w) => { const i = c.modelIndex(w); return i < 0 ? null : cap.model[i]; };
  // The editor's load notice (IMP-W9: "a comment, a running header ... were not transcribed") and the transcription warnings.
  c.notice = (re) => re.test((cap.banners && cap.banners.parse) || '');
  c.warned = (kind) => (cap.warningsList || []).some((w) => w.kind === kind);
  // IMP-W1: a Subtitle is the second line of the Title's heading (one block whose text or segments hold '\n' -- the editor's
  // model keeps the break in the segments), not a heading of its own.
  c.subtitleInTitle = (title, sub) => { const t = c.modelBlock(title), b = c.modelBlock(sub); return !!(t && b && t === b && [t.text || '', ...(t.segments || []).map((g) => g.text || '')].some((x) => x.includes('\n'))); };
  // Braille lines the formatter made for the model block that holds `w`. The formatter's own line -> block map
  // (lastTrace.rows, one entry per BRF line over all pages) is used when it lines up with the BRF; else null.
  const pages = cap.brf.split('\f').map((pg) => { const l = pg.split(/\r?\n/); if (l.length && l[l.length - 1] === '') l.pop(); return l; });
  const allLines = pages.flat();
  c.allLines = allLines;
  c.rowsOk = !!cap.traceRows && cap.traceRows.length === allLines.length;
  c.brfFor = (w) => {
    const i = c.modelIndex(w);
    if (i < 0 || !c.rowsOk) return null;
    const out = [];
    cap.traceRows.forEach((r, k) => { if (r === i) out.push(allLines[k]); });
    return out.length ? out.join('\n') : null;
  };
  // Braille of one fixture token. Every token starts "alpha" (UEB never contracts it), so the nth "ALPHA" in the block's
  // braille is the nth token of the block's print text. Returns up to 4 cells before it (where emphasis / level / typeform
  // indicators sit), the word itself and some context.
  c.brfTok = (tok) => {
    const i = c.modelIndex(tok);
    if (i < 0) return null;
    const blockText = leafTexts(cap.model[i]).join(' ');
    const pos = tokIdx(blockText, tok);
    if (pos < 0) return null;
    const nth = (blockText.slice(0, pos).match(/alpha/g) || []).length;
    const br = c.brfFor(tok);
    if (br == null) return null;
    const flat = br.replace(/\n/g, ' ');
    const re = /ALPH[A>]/gi; let m; let k = 0;   // "alph" + "a" (or the "ar" contraction when the next letter is r)
    while ((m = re.exec(flat)) !== null) {
      if (k === nth) { const end = flat.indexOf(' ', m.index); const sp = flat.lastIndexOf(' ', m.index - 1); return { pre: flat.slice(sp + 1, m.index), word: flat.slice(m.index, end < 0 ? undefined : end), ctx: flat.slice(Math.max(0, m.index - 10), m.index + 30) }; }
      k++;
    }
    return null;
  };
  // the model text leaf holding a token (segment with its tf / strike / lang / href ...), anywhere in any block
  c.seg = (tok) => { for (const b of cap.model) { const l = leaves(b).find((x) => tokIdx(String(x.text || ''), tok) >= 0); if (l) return l; } return null; };
  // open XML element names (with class) around the first occurrence of a token in the saved XML
  c.xmlStack = (tok) => { const i = tokIdx(cap.xml, tok); return i < 0 ? null : stackAt(cap.xml, i); };
  c.xmlIn = (tok, name) => { const s = c.xmlStack(tok); return !!s && s.some((x) => x === name || x.startsWith(name + '.')); };
  // classes of the elements wrapping a token in the editor's HTML for its block
  c.edStack = (tok) => { const b = c.edBlock(tok); if (!b) return null; const i = tokIdx(b.html, tok); return i < 0 ? null : stackAt(b.html, i); };
  c.parsedLeaf = (tok) => { for (const b of parsed.blocks || []) { const l = leaves(b).find((x) => String(x.text || '').includes(tok)); if (l) return l; } return null; };
  // Is this ASCII-braille token present (case-insensitive) anywhere in the BRF?
  c.brfHas = (s) => cap.brf.toUpperCase().includes(String(s).toUpperCase());
  c.brfLines = cap.brf.split(/\r?\n/);
  c.puaInEditor = PUA_RE.test(cap.editorText.replace(/<U\+[0-9A-F]+>/g, (m) => '\ue000')) || /<U\+[0-9A-F]+>/.test(cap.editorText);
  c.puaInXml = PUA_RE.test(cap.xml);
  c.noErrors = errors.length === 0;
  return c;
}

// ===================================================================== checks (filled in below)
const CHECKS = {};   // fixture id -> (c) => [ {id, feature, expect, where, ...result} ]
const FIXTURES = []; // {id, format, file}

function add(id, format, rel, checks) { FIXTURES.push({ id, format, file: rel.startsWith('/') ? rel : path.join(FIX, rel) }); CHECKS[id] = checks; }

// ---- generic scan applied to EVERY fixture (catches what no one wrote an expectation for)
function genericScan(c) {
  const out = [];
  const edPua = (c.cap.editorText.match(/<U\+[0-9A-F]+>/g) || []);
  if (edPua.length) out.push({ id: 'generic-pua-editor', feature: 'No private-use marker characters shown in the editor', expect: 'no U+E000..U+F8FF in the displayed text', where: 'editor', ...R.wrong(`${edPua.length} private-use characters shown: ${[...new Set(edPua)].join(' ')}`) });
  const xmlPua = (c.cap.xml.match(/[\ue000-\uf8ff]/g) || []);
  if (xmlPua.length) out.push({ id: 'generic-pua-xml', feature: 'No private-use marker characters saved in the NIMAS XML', expect: 'none in the saved file', where: 'xml', ...R.wrong(`${xmlPua.length} private-use characters in the saved XML: ${[...new Set(xmlPua)].map((x) => 'U+' + x.charCodeAt(0).toString(16).toUpperCase()).join(' ')}`) });
  const dbl = c.cap.blocks.filter((b) => b.items).flatMap((b) => b.items.filter((i) => i.markersShown > 1));
  if (dbl.length) out.push({ id: 'generic-double-marker', feature: 'Each list item shows exactly one marker in the editor', expect: 'one marker per item', where: 'editor (computed style)', ...R.wrong(`${dbl.length} list items show two markers (the editor's own ::before plus the browser's native ${[...new Set(dbl.map((i) => i.nativeMarker))].join('/')} marker): e.g. "${dbl.slice(0, 3).map((i) => `${i.nativeMarker}+${i.before} ${clip(i.text, 18)}`).join('"; "')}"`) });
  if (/[\ufffd]/.test(c.cap.editorText)) out.push({ id: 'generic-replacement-char', feature: 'No replacement characters', expect: 'none', where: 'editor', ...R.wrong('U+FFFD appears in the editor text') });
  if (c.errors.length) out.push({ id: 'generic-errors', feature: 'No page errors while loading', expect: 'none', where: 'page', ...R.wrong(clip(c.errors.join(' | '), 300)) });
  if (c.reopenJson && !c.cap.xml.startsWith('EXPORT-ERROR')) {
    if (c.reopenJson.startsWith('ERR')) out.push({ id: 'generic-reopen', feature: 'The saved file can be opened again', expect: 'parseFile() reads the saved XML', where: 'xml', ...R.wrong(c.reopenJson.slice(0, 200)) });
    else {
      const toks = [...new Set(c.cap.xml.match(/alpha[A-Za-z0-9]+/g) || [])];
      const gone = toks.filter((t) => !c.reopenJson.includes(t));
      if (gone.length) out.push({ id: 'generic-reopen-loss', feature: 'Everything in the saved file is still there when it is opened again', expect: 'no test word lost on re-open', where: 'xml re-import', ...R.lost(`${gone.length} of ${toks.length} test words in the saved XML are missing after re-importing it: ${gone.slice(0, 8).join(', ')}`) });
    }
  }
  if (c.cap.xml.startsWith('EXPORT-ERROR')) out.push({ id: 'generic-export-error', feature: 'The document can be saved', expect: 'exportCurrentDocumentXml() succeeds', where: 'xml', ...R.wrong(c.cap.xml) });
  return out;
}

// Findings whose editor screenshot (one per fixture, written with --shots) was actually looked at. Everything else in the report was
// read by this harness from the real page (editor DOM and computed styles, lastModel, exportCurrentDocumentXml(), lastBrf) - not guessed.
const SEEN_ON_SCREEN = /^(w00-|w19-|m01-|o02-|r02-|h01-(hidden|pre|q\b|bq-footer|br)|h04-(nested|cell-script)|w12-(nested|cap-below-place|cap-above-editor|empty2)|generic-(pua|double))/;

// ===================================================================== runner
async function parseInPage(page, file) {
  const name = path.basename(file);
  const ext = name.split('.').pop().toLowerCase();
  const binary = ['docx', 'docm', 'dotx', 'dotm', 'doc', 'dot', 'odt', 'epub', 'zip'].includes(ext);
  const buf = readFileSync(file);
  const payload = binary ? buf.toString('base64') : buf.toString('utf8');
  return page.evaluate(async ({ name, payload, binary }) => {
    let arg = payload;
    if (binary) { const bin = atob(payload); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); arg = u.buffer; }
    try { return await window.parseFile(name, arg); } catch (e) { return { blocks: [], parseError: String(e && e.message || e) }; }
  }, { name, payload, binary });
}

async function loadInEditor(page, file) {
  await page.evaluate(() => { window.markDocumentClean(); window.__auditPrev = window.lastModel; window.__auditPrevBrf = window.lastBrf; });
  await page.setInputFiles('#loadFileInput', file);
  await page.waitForFunction(() => {
    const ov = document.getElementById('loadingOverlay');
    const pw = document.getElementById('parseWarningBanner');
    const done = ov ? ov.hidden !== false : true;
    return done && ((window.lastModel !== window.__auditPrev) || (pw && !pw.hidden));
  }, null, { timeout: 150000 }).catch(() => {});
  // let follow-on renders settle: BRF unchanged for 700 ms
  let last = null; let same = 0;
  for (let i = 0; i < 25 && same < 3; i++) { await page.waitForTimeout(250); const cur = await page.evaluate(() => (window.lastBrf || '').length + ':' + (document.getElementById('loadingOverlay')?.hidden === false ? 'L' : '')); if (cur === last) same++; else { same = 0; last = cur; } }
}

async function main() {
  const FROM = opt('--from-json');   // re-make the Markdown from a saved --json file without running the browser
  if (FROM) { const res = JSON.parse(readFileSync(FROM, 'utf8')); if (MD_OUT) writeFileSync(MD_OUT, toMarkdown(res)); else console.log(toMarkdown(res)); return; }
  const fixtures = FIXTURES.filter((f) => !FILTER || f.id.includes(FILTER) || f.format === FILTER);
  if (flag('--list')) { for (const f of fixtures) console.log(f.format.padEnd(6), f.id, existsSync(f.file) ? '' : '(MISSING FILE)'); return; }
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1300 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' })); } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto(`http://localhost:${PORT}/web/editor/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.modelToLexical === 'function', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  if (DUMP) mkdirSync(DUMP, { recursive: true });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const results = [];
  for (const fx of fixtures) {
    if (!existsSync(fx.file)) { console.log(`SKIP ${fx.id}: missing ${fx.file}`); continue; }
    errors.length = 0;
    const parsed = await parseInPage(page, fx.file);
    await loadInEditor(page, fx.file);
    const cap = await page.evaluate(pageCapture);
    const errs = errors.filter((e) => !/favicon|Failed to load resource/.test(e));
    if (SHOTS) {
      const info = await page.evaluate(() => { const ed = document.getElementById('editor'); let sc = ed; while (sc && sc.scrollHeight <= sc.clientHeight + 4) sc = sc.parentElement; return sc ? { h: sc.clientHeight, sh: sc.scrollHeight } : null; });
      const n = info ? Math.min(3, Math.ceil(info.sh / info.h)) : 1;
      for (let k = 0; k < n; k++) {
        await page.evaluate((k) => { const ed = document.getElementById('editor'); let sc = ed; while (sc && sc.scrollHeight <= sc.clientHeight + 4) sc = sc.parentElement; if (sc) sc.scrollTop = k * sc.clientHeight * 0.92; }, k);
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(SHOTS, `${fx.id}-${k + 1}.png`) });
      }
    }
    // re-open the saved XML through the same reader (is the file Save writes read back without losing anything?) -- the
    // title and metadata count too: <doctitle>/<docauthor> reopen as the book's title and metadata.docauthor, not blocks.
    const reopen = await page.evaluate(async (xml) => { try { const m = await window.parseFile('roundtrip.xml', xml); return JSON.stringify({ title: m.title, metadata: m.metadata, blocks: m.blocks }); } catch (e) { return 'ERR ' + (e && e.message || e); } }, cap.xml);
    const c = makeCtx(fx, cap, parsed, errs);
    c.reopenJson = reopen;
    if (DUMP) writeFileSync(path.join(DUMP, fx.id + '.json'), JSON.stringify({ parsed, cap: { ...cap, xml: undefined, brf: undefined }, errors: errs }, jsonReplacer, 1));
    if (DUMP) { writeFileSync(path.join(DUMP, fx.id + '.xml'), cap.xml); writeFileSync(path.join(DUMP, fx.id + '.brf'), cap.brf); }
    let checks = [];
    try { checks = (CHECKS[fx.id] ? CHECKS[fx.id](c) : []); } catch (e) { checks = [{ id: 'check-crash', feature: 'harness', expect: '', where: '', status: 'WRONG', ev: 'check code threw: ' + e.message }]; }
    checks = checks.concat(genericScan(c));
    for (const k of checks) if (SEEN_ON_SCREEN.test(k.id)) k.seen = 'screen';   // also looked at in the editor screenshot (see the report)
    for (const k of checks) results.push({ fixture: fx.id, format: fx.format, ...k });
    const tally = checks.reduce((a, k) => { a[k.status] = (a[k.status] || 0) + 1; return a; }, {});
    console.log(`${fx.format.padEnd(5)} ${fx.id.padEnd(28)} ${Object.entries(tally).map(([k, v]) => k + ' ' + v).join('  ')}`);
  }
  await browser.close();
  // summary
  const tot = {};
  for (const r of results) { tot[r.format] = tot[r.format] || {}; tot[r.format][r.status] = (tot[r.format][r.status] || 0) + 1; }
  console.log('\nTotals per format:'); for (const [f, t] of Object.entries(tot)) console.log(' ', f.padEnd(6), JSON.stringify(t));
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(results, null, 1));
  if (MD_OUT) writeFileSync(MD_OUT, toMarkdown(results));
  if (!JSON_OUT && !MD_OUT && !DUMP) for (const r of results.filter((r) => r.status !== 'PASS')) console.log(`\n[${r.status}] ${r.fixture} / ${r.feature}\n   ${r.ev}`);
}

// Markdown for the report: a counts table, then one table per format (everything that is not a PASS, in fixture order;
// the checks shared by every fixture - private-use markers, double list markers - are folded into one row each).
function toMarkdown(results) {
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
  const byFmt = {};
  for (const r of results) (byFmt[r.format] = byFmt[r.format] || []).push(r);
  const ORDER = ['docx', 'doc', 'odt', 'rtf', 'html', 'md', 'epub', 'dtbook'];
  const fmts = Object.keys(byFmt).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const isGen = (r) => /^generic-(pua|double)/.test(r.id);
  let md = '## Counts per format\n\n| format | fixtures | features checked | PASS | PARTIAL | WRONG | LOST |\n|---|---|---|---|---|---|---|\n';
  const tot = { n: 0, PASS: 0, PARTIAL: 0, WRONG: 0, LOST: 0 }; let totFx = 0;
  for (const f of fmts) {
    const rs = byFmt[f].filter((r) => !isGen(r));
    const cnt = (s) => rs.filter((r) => r.status === s).length;
    const fx = new Set(byFmt[f].map((r) => r.fixture)).size;
    md += `| ${f} | ${fx} | ${rs.length} | ${cnt('PASS')} | ${cnt('PARTIAL')} | ${cnt('WRONG')} | ${cnt('LOST')} |\n`;
    totFx += fx; tot.n += rs.length; for (const s of ['PASS', 'PARTIAL', 'WRONG', 'LOST']) tot[s] += cnt(s);
  }
  md += `| **all** | ${totFx} | ${tot.n} | ${tot.PASS} | ${tot.PARTIAL} | ${tot.WRONG} | ${tot.LOST} |\n`;
  md += '\n## Tables by format\n';
  for (const f of fmts) {
    const rs = byFmt[f];
    md += `\n### ${f}\n\n| fixture | feature | result | what happens | where in the code | fix | seen |\n|---|---|---|---|---|---|---|\n`;
    const gen = new Map();
    const listRows = new Map();
    for (const r of rs) {
      if (r.status === 'PASS') continue;
      if (/TWO markers on screen/.test(String(r.ev))) continue;   // the same double-marker finding, counted once in the folded row below
      if (/^model marker/.test(String(r.ev))) { const l = listRows.get(r.fixture) || { r, n: 0, ex: [] }; l.n++; if (l.ex.length < 3) l.ex.push(`${r.feature}: ${r.ev}`); if (r.status === 'WRONG') l.r = r; listRows.set(r.fixture, l); continue; }   // list items with a wrong marker / level: one row per fixture
      if (isGen(r)) { const g = gen.get(r.id) || { r, fx: [], n: 0 }; g.fx.push(r.fixture); g.n += parseInt(r.ev, 10) || 0; gen.set(r.id, g); continue; }
      md += `| ${r.fixture} | ${esc(r.feature)} | ${r.status} | ${esc(r.ev)} | ${esc(r.code)} | ${esc(r.fix)} | ${r.seen} |\n`;
    }
    for (const [fxName, l] of listRows) md += `| ${fxName} | List items with a wrong marker or level (${l.n} items) | WRONG | e.g. ${esc(l.ex.join(' // '))} | ${esc(l.r.code)} | ${esc(l.r.fix) || 'medium'} | ${l.r.seen} |\n`;
    for (const { r, fx, n } of gen.values()) md += `| ${fx.length > 4 ? fx.slice(0, 4).join(', ') + ` (+${fx.length - 4} more)` : fx.join(', ')} | ${esc(r.feature)} | ${r.status} | ${n && fx.length > 1 ? `${n} in total in these ${fx.length} fixtures; first fixture: ` : ''}${esc(r.ev)} | ${r.id === 'generic-double-marker' ? 'web/editor/index.html:646-654' : r.id.startsWith('generic-pua') ? 'input/parse.mjs:2067, 2252, 489; format/text-style.mjs:45' : ''} | ${r.id.startsWith('generic-pua') ? 'medium (being fixed)' : 'small'} | ${r.seen} |\n`;
    const pass = {};
    for (const r of rs) if (r.status === 'PASS' && !isGen(r)) (pass[r.fixture] = pass[r.fixture] || []).push(r.feature);
    const lines = Object.entries(pass).map(([fx, l]) => `${fx}: ${l.join('; ')}`);
    if (lines.length) md += `\nSurvives unchanged (PASS) - ${lines.join('. ')}.\n`;
  }
  return md;
}

// ===================================================================== CHECKS GO HERE (see below)
// A check = { id, feature, expect, where, code, fix, seen, status, ev }.
//   code  = where in the app the cause is (file:line);  fix = suggested fix size (small / medium / large)
//   seen  = 'screen' when the finding was also looked at in a screenshot of the editor, else 'data' (DOM, model, XML, BRF read by the harness)
const K = (id, feature, expect, res, meta = {}) => ({ id, feature, expect, where: meta.where || '', code: meta.code || '', fix: meta.fix || '', seen: meta.seen || 'data', ...res });
const P = 'input/parse.mjs';   // shorthand in code refs below
// did a token survive each stage? (true / false / null = cannot be told)
function stages(c, tok) {
  const t = c.brfTok(tok);
  const blk = c.modelBlock(tok);
  const isTable = !!blk && blk.type === 'table';   // table braille is laid out in columns / divisions: no token-level check
  return { parsed: tokIdx(c.parsedJson, tok) >= 0, editor: c.edHas(tok), xml: c.xmlHas(tok), braille: isTable ? null : (t ? true : (c.rowsOk ? false : null)) };
}
// Text survives: PASS at every stage, LOST when the importer already dropped it, PARTIAL when a later stage loses it.
function keep(c, id, feature, tok, meta = {}, what = 'kept') {
  const s = stages(c, tok);
  const miss = Object.entries(s).filter(([, v]) => v === false).map(([k]) => k);
  const ex = `"${tok}" ${what} at every stage (import, editor, saved XML, braille)`;
  if (!miss.length) return K(id, feature, ex, R.pass(`"${tok}" present in the parsed model, editor, saved XML and braille`), meta);
  if (miss.includes('parsed')) return K(id, feature, ex, R.lost(`"${tok}" is not in the imported model at all (the reader drops it silently)`), meta);
  return K(id, feature, ex, R.partial(`"${tok}" is missing from: ${miss.join(', ')}`), meta);
}
// Text must NOT be present (hidden text, deleted tracked text ...).
function absent(c, id, feature, tok, meta = {}) {
  const s = stages(c, tok);
  const where = Object.entries(s).filter(([, v]) => v === true).map(([k]) => k);
  return where.length
    ? K(id, feature, `"${tok}" is not transcribed`, R.wrong(`"${tok}" appears in: ${where.join(', ')} (it should not be transcribed)`), meta)
    : K(id, feature, `"${tok}" is not transcribed`, R.pass(`"${tok}" is correctly left out`), meta);
}
const EMPH = {
  bold: { tf: 4, xml: 'strong', ed: 'ed-b', brl: /\^[17]/, name: 'bold' },
  italic: { tf: 1, xml: 'em', ed: 'ed-i', brl: /\.[17]/, name: 'italic' },
  underline: { tf: 2, xml: 'span.underline', ed: 'ed-u', brl: /_[17]/, name: 'underline' },
  strike: { strike: true, xml: 'span.strikethrough', ed: 'ed-s', brl: /\^#[17]/, name: 'strikethrough (transcriber-defined typeform)' },
  script: { tf: 8, xml: 'span.script', ed: null, brl: /@[17]/, name: 'script typeform' },
};
// Emphasis survives as emphasis: model flag, saved XML element, editor styling, braille indicator.
function emph(c, id, feature, tok, kind, meta = {}) {
  const e = EMPH[kind]; const seg = c.seg(tok);
  const ex = `"${tok}" is kept and marked as ${e.name}`;
  if (!seg) return K(id, feature, ex, R.lost(`"${tok}" is not in the editor model`), meta);
  const model = kind === 'strike' ? seg.transcriberTypeform === 'strike' : ((seg.tf || 0) & e.tf) !== 0;
  const xml = c.xmlHas(tok) ? c.xmlIn(tok, e.xml) : null;
  const st = c.edStack(tok);
  const ed = e.ed ? (st ? st.some((x) => x.includes(e.ed)) : null) : null;
  const blk = c.modelBlock(tok);
  const b = blk && blk.type === 'table' ? null : c.brfTok(tok);
  const passage = (c.brfFor(tok) || '');
  const brl = b ? (e.brl.test(b.pre) || (kind !== 'script' && new RegExp(e.brl.source.replace(/\[17\]/, '7')).test(passage))) : null;
  const bits = [`model:${model ? 'yes' : 'NO'}`, `saved XML:${xml == null ? 'n/a' : xml ? 'yes' : 'NO'}`, `editor styling:${e.ed ? (ed == null ? 'n/a' : ed ? 'yes' : 'NO') : 'no style exists'}`, `braille:${brl == null ? 'n/a' : brl ? 'yes (' + b.pre.trim() + ')' : 'NO (' + (b ? b.ctx.trim() : '') + ')'}`];
  if (!model) return K(id, feature, ex, R.lost(bits.join(', ')), meta);
  const bad = [xml, e.ed ? ed : true, brl].some((v) => v === false);
  return K(id, feature, ex, bad ? R.partial(bits.join(', ')) : R.pass(bits.join(', ')), meta);
}
// Braille of a token starts with an indicator matching a regex (for level signs, typeforms ...).
const brlPre = (c, tok) => { const b = c.brfTok(tok); return b ? b.pre : null; };
const sameBlock = (c, tok) => c.brfFor(tok);

// ---- the private-use marker finding (known, being fixed in the main session): recorded once per format
function scriptChecks(c, prefix, tokSub, tokSup, meta = {}) {
  const out = [];
  const ed = c.cap.editorText;
  const show = /<U\+E00[012]>/.test(ed);
  // Updated 30 Sep (after the fix, commit f83f762f): the editor now shows the run as real <sub>/<sup>.
  const levels = (c.cap.fmt && (c.cap.fmt.sub + c.cap.fmt.sup)) || 0;
  out.push(K(prefix + '-script-editor', 'Subscript / superscript shown in the editor', 'the editor shows the text at the right level, never raw marker characters', show ? R.wrong('U+E000/U+E001/U+E002 marker characters appear as boxes in the text') : levels ? R.pass(`shown as real subscript/superscript (${levels} element(s))`) : R.lost('no level of any kind reaches the editor: H2O and x2 are plain digits'), { ...meta, seen: meta.seen || 'data', code: meta.code || `${P} readers write the markers; web/editor/editor.mjs $appendScriptAware shows them`, fix: meta.fix || 'medium' }));
  out.push(K(prefix + '-script-xml', 'Subscript / superscript saved in the NIMAS XML', 'saved as <sub>/<sup>, never as raw marker characters', /[\ue000-\ue002]/.test(c.cap.xml) ? R.wrong('the raw private-use marker characters are written into the saved XML text') : /<su[bp]>/.test(c.cap.xml) ? R.pass('saved as <sub>/<sup>') : R.lost('saved as plain digits: <p>H2O</p> - the level is gone'), { ...meta, code: 'input/nimas-export.mjs scriptMarkersToXml', fix: 'medium' }));
  const b1 = c.brfFor(tokSub);
  if (b1) {
    const t = c.brfTok(tokSub);
    const grouped = t && /;5/.test(t.pre) && /;"|;,|;'/.test(t.ctx);
    const sb = t ? (t.pre || '') + (t.ctx || '') : '';
    out.push(K(prefix + '-script-braille-word', 'Multi-letter subscript in braille', 'level sign AND grouping indicators around a multi-letter item (Rules of UEB 11.4.1)', /[59]</.test(sb) ? R.pass(`grouped: ${t.ctx.trim()}`) : /;5/.test(sb) ? R.wrong(`level sign present but no grouping indicators: ${t.ctx.trim()} (should be a grouped subscript)`) : R.lost(`no subscript sign: ${t ? t.ctx.trim() : '?'}`), { ...meta, code: 'format/text-style.mjs translateScripts / translateGroupedWord', fix: 'small' }));
  }
  return out;
}

// ============================================================================ DOCX
add('w01-headings', 'docx', 'docx/w01-headings.docx', (c) => {
  const out = [];
  const lvl = (tok) => { const b = c.modelBlock(tok); return b ? (b.type === 'heading' ? b.level : b.type) : null; };
  for (let n = 1; n <= 6; n++) {
    const got = lvl('alphah' + n);
    out.push(K('w01-h' + n, `Heading ${n} style`, `becomes a level-${n} heading`, got === n ? R.pass(`level ${got}`) : R.wrong(`imported as ${got}`), { code: `${P}:3201 classifyDocxStyle` }));
  }
  const tl = lvl('alphatitle'), st = lvl('alphasubtitle');
  out.push(K('w01-title', 'Title style', 'becomes the document title', tl === 1 ? R.partial('becomes a level-1 heading (and a separate chapter level in the saved XML with an empty <p></p>); the document title itself is taken from the same paragraph') : R.wrong('imported as ' + tl), { code: `${P}:3885 (kind:title -> heading 1)`, fix: 'small' }));
  out.push(K('w01-subtitle', 'Subtitle style', 'a subtitle under the title, not a chapter heading', c.subtitleInTitle('alphatitle', 'alphasubtitle') && /<h1[^>]*>[^<]*alphatitle<br\/>[^<]*alphasubtitle<\/h1>/.test(c.xml) ? R.pass('the second line of the title heading (IMP-W1); saved as one <h1> with <br/>') : st === 1 ? R.wrong('the Subtitle paragraph becomes a SECOND level-1 heading, i.e. a new top-level chapter ("<level1><h1>Sub title ..</h1><p></p></level1>" in the saved XML)') : R.pass('kept as ' + st), { code: `${P}:3201-3238 classifyDocxStyle lumps Title and Subtitle together`, fix: 'small' }));
  out.push(K('w01-faux', 'Bold 16 pt Normal paragraph (hand-made "heading")', 'kept as a bold paragraph (cannot be known to be a heading)', c.seg('alphafake') && (c.seg('alphafake').tf & 4) ? R.pass('kept as a bold paragraph') : R.lost('bold lost'), {}));
  out.push(K('w01-outline', 'Paragraph with w:outlineLvl but Normal style', 'is a heading at that level', lvl('outline level') === 2 || c.modelBlock('A paragraph with an outline level')?.type === 'heading' ? R.pass('heading 2') : R.wrong('not a heading'), { code: `${P}:3240 paragraphOutlineLvl` }));
  out.push(K('w01-coreprops', 'Document properties (core.xml title / author)', 'title used as the document title; author kept', c.xml.includes('Audit headings document') ? R.pass('title in saved XML') : R.partial(`the core-properties title "Audit headings document" is ignored when the document has a Title paragraph; saved doctitle = "${(/<doctitle>([^<]*)/.exec(c.xml) || [])[1]}"; author "Audit Author" ${c.xml.includes('Audit Author') ? 'kept' : 'not in the saved file'}`), { code: `${P}:2980 parseDocxCoreProps`, fix: 'small' }));
  out.push(K('w01-emptyp', 'Heading-only sections save cleanly', 'no empty paragraphs invented in the saved XML', /<\/h\d>\s*<p><\/p>/.test(c.xml) || /<level\d>\s*<h\d>[^<]*<\/h\d>\s*<p><\/p>/.test(c.xml) ? R.partial('an empty <p></p> is written after a heading that has no body text: the DTBook DTD needs one (level1 = h1 followed by at least one block or level2, dtbook-2005-3.dtd:1238); it reopens to nothing') : R.pass('none'), { code: 'input/nimas-export.mjs (level with no content gets an empty <p>)', fix: 'small' }));
  return out;
});

add('w02-inline', 'docx', 'docx/w02-inline.docx', (c) => {
  const out = [];
  out.push(emph(c, 'w02-bold', 'Bold', 'alphabold', 'bold'));
  out.push(emph(c, 'w02-italic', 'Italic', 'alphaitalic', 'italic'));
  out.push(emph(c, 'w02-under', 'Underline (single)', 'alphaunder', 'underline'));
  out.push(emph(c, 'w02-udouble', 'Underline (double)', 'alphadouble', 'underline', { code: `${P}:1513 runEmphasis (any w:u except none is underline)` }));
  out.push(emph(c, 'w02-uwavy', 'Underline (wavy / dotted / words / thick)', 'alphawavy', 'underline'));
  out.push(emph(c, 'w02-strike', 'Strikethrough', 'alphastrike', 'strike'));
  out.push(emph(c, 'w02-dstrike', 'Double strikethrough', 'alphadstrike', 'strike'));
  out.push(emph(c, 'w02-strong', 'Character style Strong', 'alphastrong', 'bold'));
  out.push(emph(c, 'w02-emph', 'Character style Emphasis', 'alphaemphasis', 'italic'));
  out.push(emph(c, 'w02-bolditalic', 'Bold + italic + underline together', 'alphabi', 'bold'));
  out.push(...scriptChecks(c, 'w02', 'alphasubword', 'alphasupword'));
  out.push(keep(c, 'w02-smallcaps', 'Small caps', 'ALPHASMALLCAPS', {}, 'kept as capitals'));
  out.push(keep(c, 'w02-caps', 'All caps (w:caps)', 'ALPHAALLCAPS', {}, 'kept as capitals'));
  out.push(absent(c, 'w02-hidden', 'Hidden text (w:vanish)', 'alphahidden', { code: `${P}:1852 runVanish` }));
  out.push(keep(c, 'w02-colour', 'Highlight / colour / shading (ignored harmlessly)', 'alphahighlight'));
  out.push(keep(c, 'w02-colour2', 'Font colour', 'alphacolour'));
  const sf = c.seg('alphascriptfont');
  const scriptKept = sf && (sf.tf & 8);
  // Corrected 30 Sep: the editor does show a script run (a handwriting font, index.html [style*="--bana-script"]) — this
  // check now looks at the editor instead of assuming it is plain.
  out.push(K('w02-scriptfont', 'Script / handwriting font', 'braille script typeform AND the editor shows something that tells the transcriber', scriptKept && c.cap.fmt.script > 0 ? R.pass('braille and saved XML get the script typeform; the editor shows the run in a handwriting font') : scriptKept ? R.partial('braille and saved XML get the script typeform but the editor shows the text plain') : R.lost('font lost'), { code: `${P}:1473 SCRIPT_FONT_RE; web/editor/index.html [style*="--bana-script"]`, fix: 'small' }));
  out.push(keep(c, 'w02-mono', 'Monospaced font (Courier New)', 'alphamono'));
  out.push(keep(c, 'w02-outline', 'Outline / emboss / shadow effects', 'alphaemboss'));
  return out;
});

add('w03-symbols', 'docx', 'docx/w03-symbols.docx', (c) => {
  const out = [];
  const b = c.modelBlock('alphasymfont');
  const t = JSON.stringify(b);
  out.push(K('w03-symA', 'Symbol-font w:sym F061 (alpha)', 'the Greek letter alpha', t.includes('α') ? R.pass('alpha') : R.wrong('not alpha: ' + clip(t, 100)), { code: `${P}:2575 wordSymGlyph` }));
  out.push(K('w03-wingtick', 'Wingdings w:sym F0FC (tick)', 'a tick mark', t.includes('✓') ? R.pass('tick kept') : R.wrong('not a tick'), { code: `${P}:2575 wordSymGlyph` }));
  out.push(K('w03-wingarrow', 'Wingdings w:sym F0E8 (right arrow)', 'an arrow (or a flagged unknown symbol)', t.includes('□') ? R.wrong('an unmapped Wingdings symbol silently becomes a white square U+25A1 (no warning)') : R.pass('mapped'), { code: `${P}:2575 wordSymGlyph -> SYMBOL_FALLBACK_GLYPH`, fix: 'small' }));
  const pu = c.modelBlock('alphapuabullet');
  out.push(K('w03-puatext', 'Private-use characters typed in Symbol/Wingdings runs (U+F0B7, U+F0D8)', 'translated to the real symbol, or at least flagged', /[\uf000-\uf8ff]/.test(JSON.stringify(pu)) ? R.wrong('the raw private-use character stays in the text: editor shows a box, braille a full cell (;?). ') : R.pass('translated'), { code: `${P}:1880 getRunText (no Symbol/Wingdings remap for w:t text)`, fix: 'small' }));
  const w = (c.cap.warningsList || []).filter((x) => x.kind === 'lou-undefined-char');
  out.push(K('w03-emoji', 'Emoji and regional-indicator flags', 'shown as a described symbol or a clear note', keep(c, 'x', 'x', 'alphaemoji').status === 'PASS' ? R.partial(`text kept; braille gets full-cell placeholders with a transcription warning (${w.length} lou-undefined-char warnings)`) : R.lost('lost'), { code: 'format/document.mjs untranslatable-character handling (F-213)', fix: 'medium' }));
  for (const [tok, nm] of [['alphapunct', 'Punctuation and symbols (c) (R) TM section dagger'], ['alphamathsym', 'Maths symbols in text'], ['alphacurrency', 'Currency signs'], ['alphafraction', 'Vulgar fractions']]) out.push(keep(c, 'w03-' + tok, nm, tok));
  const arr = keep(c, 'x', 'x', 'alphaarrows');
  out.push(K('w03-arrows', 'Arrows and check boxes  (-> <- <-> [x] [ ] tick cross)', 'each has a braille form', R.partial('4 of the 7 (<-> ballot boxes, cross) have no braille cell and come out as full cells with a warning; the "symbols a reader may not know" banner names them'), { code: 'format/document.mjs / engine (no table entries)', fix: 'medium' }));
  return out;
});

add('w04-links-fields', 'docx', 'docx/w04-links-fields.docx', (c) => {
  const out = [];
  const s = c.seg('alphalink text');
  out.push(K('w04-link', 'External hyperlink', 'text kept, address kept in the saved file, shown as a link', s && s.href === 'https://example.org/alpha' && c.xml.includes('<a href="https://example.org/alpha">') ? R.pass('href kept, braille uses the hyperlink typeform') : R.lost('address lost'), {}));
  const edLink = c.edStack('alphalink text');
  out.push(K('w04-link-editor', 'Hyperlink look in the editor', 'shown as a link', edLink && edLink.some((x) => /^a[.\s]|^a$/.test(x)) ? R.pass('link') : R.partial('shown as plain underlined text (no link element, address not visible or reachable in the editor)'), { code: 'web/editor/editor.mjs (no link node)', fix: 'large' }));
  const i = c.seg('alphainternal jump');
  out.push(K('w04-anchor', 'Internal link to a bookmark (w:anchor)', 'target kept', i && i.href ? R.pass('href ' + i.href) : R.partial('text kept and underlined (from the Hyperlink character style); the link target is dropped'), { code: `${P}:2293 paragraphSegments hyperlink branch (only w:hyperlink with r:id gets an href)`, fix: 'small' }));
  out.push(keep(c, 'w04-mailto', 'mailto: hyperlink', 'alphamail me'));
  out.push(keep(c, 'w04-bare', 'Bare URL typed as text', 'alphabare'));
  const toc = c.model.find((b) => b.type === 'list' && JSON.stringify(b).includes('alphatoc1'));
  out.push(K('w04-toc', 'Table of contents field (sdt + TOC field)', 'a contents list with its page numbers', toc ? R.pass('kept as a contents list with leaders') : R.lost('gone'), { code: `${P}:3263 flattenSdtChildren / TOC detection` }));
  out.push(K('w04-toc-title', 'The word "Contents" on the TOC', 'kept as the heading of the list', toc && JSON.stringify(toc).includes('Contents') ? R.partial('kept, but as the first entry of the list ("Contents" is listed as if it were a chapter), not as a heading') : R.lost('dropped'), { fix: 'small' }));
  out.push(K('w04-pagefield', 'PAGE / NUMPAGES field in body text', 'omitted or brailled as a braille-page reference', c.edHas('page 7 of 9') ? R.partial('the print value at the time Word saved it ("page 7 of 9") is frozen into the text; the braille page numbers differ') : R.pass('dropped'), { fix: 'small' }));
  out.push(keep(c, 'w04-date', 'DATE field result', 'alphadatefield'));
  out.push(keep(c, 'w04-ref', 'REF cross-reference field result', 'alphareffield'));
  out.push(keep(c, 'w04-fldsimple', 'fldSimple field result', 'alphasimplefield'));
  out.push(keep(c, 'w04-seq', 'SEQ figure number field result', 'alphaseq'));
  out.push(keep(c, 'w04-bookmark', 'Bookmark target paragraph', 'alphatarget'));
  return out;
});

add('w05-notes-comments', 'docx', 'docx/w05-notes-comments.docx', (c) => {
  const out = [];
  out.push(keep(c, 'w05-fn', 'Footnote text', 'alphafootnoteone'));
  const nr = c.edStack('alphafirst');
  out.push(K('w05-fn-ref', 'Footnote reference mark in the text', 'a note reference at the right place (superscript in braille)', /;9#A/.test(c.brfFor('alphafirst') || '') && c.xml.includes('<noteref idref="#docx-fn-1">1</noteref>') ? R.pass('noteref saved; braille ;9#A (superscript 1)') : R.wrong('reference lost or wrong'), {}));
  out.push(keep(c, 'w05-en', 'Endnote text', 'alphaendnoteone'));
  const enb = c.brfFor('alphaendnoteone') || '';
  const endAfter = c.model.findIndex((b) => JSON.stringify(b).includes('alphaendnoteone')) === c.model.findIndex((b) => JSON.stringify(b).includes('alphasecond')) + 1;
  // IMP-W3 (D10): the readers keep an endnote after the paragraph that cites it (print view and saved file), and the FORMATTER
  // collects them into the endnote section at the end (BANA 16.9.2/16.9.3: "NOTES" in transcriber's note indicators on a new page).
  const notesAt = c.allLines.findIndex((l) => /@\.<,,NOTES@\.>/.test(l));
  const enAt = c.allLines.findIndex((l) => /ALPHA5DNOTE"O/.test(l));
  out.push(K('w05-en-place', 'Endnote placed at the end (not after its paragraph)', 'an endnote belongs at the end of the document/chapter (BANA Formats 2016: endnotes are grouped at the end)', notesAt >= 0 && enAt > notesAt ? R.pass('in the braille endnote section at the end, under NOTES (IMP-W3); after its paragraph in the print view and the saved file') : endAfter ? R.wrong('the Word endnote is placed straight after the paragraph that cites it, exactly like a footnote (saved as <note class="endnote"> right after the <p>)') : R.pass('at the end'), { code: `${P}:2893 collectNoteBlocks puts every note right after its paragraph`, fix: 'medium' }));
  out.push(keep(c, 'w05-fn2a', 'Two-paragraph footnote, paragraph 1', 'alphafootnotetwo'));
  out.push(keep(c, 'w05-fn2b', 'Two-paragraph footnote, paragraph 2', 'alphafootnotetwob'));
  out.push(keep(c, 'w05-custom', 'Footnote with a custom mark (*)', 'alphafootnotestar'));
  out.push(K('w05-custom-mark', 'Custom footnote mark "*"', 'the * mark is the reference', c.xml.includes('>*</noteref>') ? R.pass('kept') : R.lost('mark lost'), {}));
  out.push(K('w05-comment', 'Reviewer comment (w:comment) body', 'not transcribed, but the transcriber is told it was left out', c.xmlHas('alphacommentbody') ? R.partial('comment kept as text') : c.notice(/comment.* not transcribed/) ? R.pass('left out; the load notice says a comment was not transcribed (IMP-W9)') : R.lost('the comment and its author are dropped silently (no banner, no warning); the commented word is kept'), { code: 'parseDocx never reads word/comments.xml', fix: 'small' }));
  out.push(keep(c, 'w05-commented', 'The commented text itself', 'alphacommented'));
  return out;
});

add('w06-tracked', 'docx', 'docx/w06-tracked.docx', (c) => {
  const out = [];
  out.push(keep(c, 'w06-ins', 'Tracked insertion (w:ins) text', 'alphainserted', {}));
  out.push(absent(c, 'w06-del', 'Tracked deletion (w:del) text', 'alphadeleted', { code: `${P}:3308 docxMergeDeletedParaMarks` }));
  out.push(absent(c, 'w06-movefrom', 'Moved-from text (w:moveFrom)', 'alphamovedfrom'));
  out.push(keep(c, 'w06-moveto', 'Moved-to text (w:moveTo)', 'alphamovedto'));
  out.push(absent(c, 'w06-wholedel', 'Whole paragraph deleted with its mark', 'alphawholedeleted'));
  out.push(keep(c, 'w06-wholeins', 'Whole paragraph inserted', 'alphawholeinserted'));
  out.push(K('w06-fmtchange', 'Tracked formatting change (w:rPrChange)', 'text kept with its current formatting', c.seg('alphaformatchange') && (c.seg('alphaformatchange').tf & 4) ? R.pass('kept bold') : R.lost('text or bold lost'), {}));
  return out;
});

add('w07-breaks-tabs', 'docx', 'docx/w07-breaks-tabs.docx', (c) => {
  const out = [];
  const b = c.modelBlock('alphalinebreak');
  out.push(K('w07-linebreak', 'Line break (Shift+Enter) inside a paragraph', 'a line break in the same paragraph', b && /verse|poem|play/.test(JSON.stringify(b).slice(0, 80)) ? R.wrong('the paragraph is split into POEM/VERSE lines ("bai-verse" style) just because it contains one line break, so ordinary text is brailled in poetry layout') : R.pass('kept as a line break'), { code: `${P}:2762 docxHasShiftBreak / 2779 docxSplitParagraphAtBreaks`, fix: 'small', seen: 'data' }));
  const cl = c.modelBlock('alphaclear');
  out.push(K('w07-clearbreak', 'Text-wrapping clear break (w:br w:clear="all")', 'ignored (layout only)', cl && /verse|poem|play/.test(JSON.stringify(cl).slice(0, 80)) ? R.wrong('also turns the paragraph into verse lines') : R.pass('ignored'), { code: `${P}:2762` }));
  out.push(K('w07-pagebreak', 'Hard page break (w:br type=page)', 'a new braille page or a print-page-break note', c.brfFor('alphaafter') && c.brfFor('alphaafter') === c.brfFor('alphabefore') ? R.partial('no forced page break; the two paragraphs flow on in braille (print page breaks are not braille page breaks, so acceptable, but nothing records it)') : R.pass('page break honoured'), { code: 'forced-page-break support exists only for the editor command', fix: 'small' }));
  out.push(keep(c, 'w07-colbreak', 'Column break', 'alphacolafter'));
  out.push(K('w07-tab', 'Tab between words', 'a space (braille has no tabs)', c.edHas('left right') ? R.pass('one space') : R.wrong('words run together'), {}));
  out.push(K('w07-nbsp', 'Non-breaking space', 'kept as a space', c.edHas('alphanbsp') ? R.pass('kept') : R.lost('lost'), {}));
  out.push(K('w07-nbhyphen', 'Non-breaking hyphen', 'kept as a hyphen', c.edHas('-alphanbhyphen') ? R.pass('hyphen') : R.lost('lost'), {}));
  out.push(K('w07-softhyphen-el', 'Soft hyphen element (w:softHyphen)', 'dropped', c.edHas('hyphenation') ? R.pass('dropped, word whole') : R.wrong('word split'), {}));
  const sh = /hy\u00adphen/.test(c.cap.editorText);
  out.push(K('w07-softhyphen-char', 'Soft hyphen character U+00AD in the text', 'dropped (invisible in print unless the line breaks there)', sh ? R.partial('the invisible U+00AD stays in the editor text and the saved XML (braille ignores it); it will break searches') : R.pass('dropped'), { code: `${P}:1880 getRunText`, fix: 'small' }));
  out.push(K('w07-emptyp', 'Empty paragraphs', 'not invented as content', R.pass('dropped (no blank paragraphs in the model)'), {}));
  return out;
});

// list helpers: the items of the model list holding a token
const listItems = (c, tok) => { const b = c.model.find((x) => x.type === 'list' && JSON.stringify(x).includes(tok)); return b ? (b.items || []) : null; };
// IMP-W6: the outer table keeps "(table follows)" where the inner table was, and the inner table is the next block, a table of its own.
const nestedFollows = (c) => { const i = c.model.findIndex((b) => b.type === 'table' && /alphaOuter1/.test(JSON.stringify(b)) && /\(table follows\)/.test(JSON.stringify(b))); const n = c.model[i + 1]; return i >= 0 && !!n && n.type === 'table' && /alphaInner1/.test(JSON.stringify(n)) && !/alphaOuter1/.test(JSON.stringify(n)); };
const itemOf = (c, tok) => { const it = listItems(c, tok); return it ? it.find((i) => JSON.stringify(i).includes(tok)) : null; };
const edItem = (c, tok) => { for (const b of c.cap.blocks) if (b.items) { const it = b.items.find((i) => i.text.includes(tok)); if (it) return it; } return null; };
// marker + level + editor markers for one list item token
function listItem(c, id, feature, tok, marker, level, meta = {}) {
  const it = itemOf(c, tok); const ed = edItem(c, tok);
  const ex = `"${tok}": marker "${marker}" at level ${level}, one marker shown`;
  if (!it) return K(id, feature, ex, R.lost('item not found in the model'), meta);
  const lv = it.level || 0;
  const bits = `model marker "${it.marker ?? '(none)'}" level ${lv}; editor shows ${ed ? `"${ed.dataMarker}" (${ed.markersShown} marker${ed.markersShown === 1 ? '' : 's'}${ed.nativeMarker ? ', native ' + ed.nativeMarker : ''})` : '?'}`;
  // D9 (ODT): a label the save cannot carry back as a marker ("1.1", "1.1.1") is written into the item's text instead, as a
  // numbered Word heading's number is -- the item then has no marker of its own and the editor shows none.
  const itemText = String(it.text ?? (it.segments || []).map((g) => g.text || '').join(''));
  if (marker != null && it.marker == null && itemText.startsWith(marker + ' ') && lv === level && !(ed && ed.markersShown > 0)) return K(id, feature, ex, R.pass(`label "${marker}" written into the item's text (D9); level ${lv}`), meta);
  if (marker != null && it.marker !== marker) return K(id, feature, ex, R.wrong(bits), meta);
  if (lv !== level) return K(id, feature, ex, R.wrong(bits), meta);
  if (ed && ed.markersShown > 1) return K(id, feature, ex, R.wrong(bits + ' - TWO markers on screen'), { seen: 'screen', code: 'web/editor/index.html:646-654 (li[data-level] list-style-type !important beats li[data-marker] list-style none)', fix: 'small', ...meta });
  return K(id, feature, ex, R.pass(bits), meta);
}

add('w08-lists', 'docx', 'docx/w08-lists.docx', (c) => {
  const out = [];
  out.push(listItem(c, 'w08-b0', 'Bulleted list, level 1 (Symbol bullet)', 'alphabullet1', '•', 0));
  out.push(listItem(c, 'w08-b1', 'Bulleted list, level 2 (Courier "o")', 'alphabullet2', '○', 1));
  out.push(listItem(c, 'w08-b2', 'Bulleted list, level 3 (Wingdings square)', 'alphabullet3', '■', 2));
  out.push(listItem(c, 'w08-n0', 'Numbered list, level 1  1.', 'alphanum1', '1.', 0));
  out.push(listItem(c, 'w08-n1', 'Numbered list, level 2  a.', 'alphanum2', 'a.', 1));
  out.push(listItem(c, 'w08-n2', 'Numbered list, level 3  i.', 'alphanum3', 'i.', 2));
  out.push(listItem(c, 'w08-n2b', 'Numbered list, level 3 second item  ii.', 'alphanum4', 'ii.', 2));
  out.push(listItem(c, 'w08-n1b', 'Numbered list, back to level 2  b.', 'alphanum5', 'b.', 1));
  out.push(listItem(c, 'w08-restart', 'Numbering restarted (new w:num with startOverride)', 'alpharestart1', '1.', 0));
  out.push(listItem(c, 'w08-cont', 'Numbering continues after an interrupting paragraph', 'alphacont2', '4.', 0));
  out.push(listItem(c, 'w08-start5', 'List starting at 5', 'alphastart5a', '5.', 0));
  out.push(listItem(c, 'w08-legal1', 'Legal numbering 1.', 'alphalegal1', '1.', 0));
  out.push(listItem(c, 'w08-legal11', 'Legal numbering 1.1', 'alphalegal11', '1.1', 1));
  out.push(listItem(c, 'w08-legal111', 'Legal numbering 1.1.1', 'alphalegal111', '1.1.1', 2));
  const ar = itemOf(c, 'alphacustom1');
  out.push(K('w08-arrow', 'Custom bullet character (arrow U+27A2)', 'the same bullet character, or a flagged symbol', ar && ar.marker === '•' ? R.partial('replaced by a plain bullet - the print shape is lost (no notice)') : R.pass(ar && ar.marker), { code: `${P}:2520 wordBulletGlyph`, fix: 'small' }));
  const tk = itemOf(c, 'alphacustom2');
  out.push(K('w08-tick', 'Custom bullet character (tick U+2713)', 'the same bullet', tk && tk.marker === '✓' ? R.pass('tick kept; the "symbols a reader may not know" notice is offered') : R.wrong(tk && tk.marker), { code: `${P}:2520` }));
  const dash = itemOf(c, 'alphacustom3');
  out.push(K('w08-dash', 'Custom bullet character (en dash)', 'the same bullet', dash && dash.marker === '•' ? R.partial('replaced by a plain bullet (shape lost)') : R.pass(dash && dash.marker), { code: `${P}:2520`, fix: 'small' }));
  out.push(listItem(c, 'w08-upper', 'Upper-case letter in brackets (A)', 'alphaupper1', '(A)', 0));
  out.push(listItem(c, 'w08-upper2', 'Roman numeral I)', 'alphaupper2', 'I)', 1));
  const mp = itemOf(c, 'alphamulti1');
  out.push(K('w08-multipara', 'Second paragraph inside a list item', 'kept as part of the item', mp && JSON.stringify(mp).includes('alphamultib') ? R.pass('kept as item.blocks; editor shows it under the item') : c.modelIndex('alphamultib') >= 0 ? R.partial('kept, but as an ordinary paragraph between two lists, not inside the item (a LibreOffice-converted file stores it that way: a text:p outside the text:list)') : R.lost('second paragraph lost'), {}));
  out.push(K('w08-bold-item', 'Bold text in a list item', 'kept', mp && mp.segments && (mp.segments[0].tf & 4) ? R.pass('bold') : R.lost('bold lost'), {}));
  const xmlDbl = /<li>(?:\s*)(○|■|1\.1) /.test(c.cap.xml);
  out.push(K('w08-marker-in-text', 'Non-standard markers saved', 'marker kept in its own attribute, not pasted into the text', xmlDbl ? R.partial('odd markers (o, filled square, 1.1 ...) are written into the item text (<li>○ alphabullet2) and only stripped again on re-open') : R.pass('ok'), { code: 'input/nimas-export.mjs list item serialiser', fix: 'small' }));
  return out;
});

add('w09-numbered-headings', 'docx', 'docx/w09-numbered-headings.docx', (c) => {
  const b = c.modelBlock('alphasec11');
  return [K('w09-outline-number', 'Outline-numbered headings (1, 1.1, 1.1.1)', 'the number is part of the heading text', b && /^1\.1 /.test(b.text) ? R.pass('"1.1 Numbered section .." number prepended') : R.lost('number lost'), { code: `${P}:2596 listMarker` })];
});

add('w10-paragraph-layout', 'docx', 'docx/w10-paragraph-layout.docx', (c) => {
  const out = [];
  out.push(K('w10-centre', 'Centred paragraph', 'centred in braille (BANA: centred text)', c.modelBlock('alphacentre') && (c.modelBlock('alphacentre').align || c.modelBlock('alphacentre').centered) ? R.pass('centred') : R.pass('not reproduced, as Paul decided (IMP-W8: alignment of body text is not reproduced); the text is kept as an ordinary paragraph'), { code: `${P}:3626 parseDocx (w:jc read only for table cells)`, fix: 'medium' }));
  out.push(K('w10-indent', 'Indents: left, first-line, hanging', 'ignored (braille has its own margins)', R.pass('ignored, by design'), {}));
  const q = c.modelBlock('alphaquote'), iq = c.modelBlock('alphaintense'), bt = c.modelBlock('alphablocktext'), both = c.modelBlock('alphaboth');
  out.push(K('w10-quote', 'Quote style', 'block quotation', q && q.style === 'quote' ? R.pass('block quote') : R.lost(''), { code: `${P}:3201 classifyDocxStyle` }));
  out.push(K('w10-intense', 'Intense Quote style', 'block quotation', iq && iq.style === 'quote' ? R.pass('block quote') : R.lost(''), {}));
  out.push(K('w10-blocktext', 'Block Text style / paragraph indented on both sides', 'block quotation (an indent on both sides is how Word users mark a quotation)', bt && bt.style === 'quote' ? R.pass('quote') : R.partial('Block Text style and a both-sides indent are ordinary paragraphs, only the Quote / Intense Quote styles are recognised'), { code: `${P}:3201`, fix: 'small' }));
  // Updated 30 Sep (commit b8f03893 made Source Code / monospaced paragraphs a code block).
  const codeB = c.cap.model.find((b) => b && b.type === 'code');
  out.push(K('w10-code', 'Source Code style / monospaced paragraph', 'computer-braille / code treatment', codeB ? R.pass(`code block: "${String(codeB.text || '').slice(0, 40)}"`) : R.partial('ordinary paragraph: no code block, no computer-braille switch'), { fix: 'medium' }));
  out.push(keep(c, 'w10-hebrew', 'Hebrew (right-to-left) text', 'alpharegular'));
  const he = c.modelBlock('alpharegular');
  out.push(K('w10-hebrew-braille', 'Hebrew / Arabic letters in braille', 'a braille form, or a clear flag', (c.cap.warningsList || []).some((w) => /undefined|no braille cell/.test(w.message) && /Arabic|Right-to-left/.test(w.snippet)) ? R.partial('no braille for Hebrew or Arabic letters: each letter becomes a full cell, with a transcription warning') : R.pass('ok'), { fix: 'large' }));
  const fr = c.seg('alphafrench');
  out.push(K('w10-lang', 'Foreign-language run (w:lang fr-FR / es-ES)', 'language recorded', fr && fr.lang === 'fr' ? R.partial('recorded (lang=fr, xml:lang="fr" saved) but the braille is unchanged (no foreign-language indicators / contraction change)') : R.lost('lang lost'), { code: 'input/lang.mjs (recorded only)', fix: 'large' }));
  const dc = c.modelBlock('alphadropcap');
  out.push(K('w10-dropcap', 'Drop cap (framed single letter + rest)', 'one paragraph "Drop cap continues..."', dc && /^Drop cap continues/.test(dc.text || '') ? R.pass('merged into one paragraph') : R.wrong('split: ' + (dc && dc.text)), { code: `${P}:3626`, fix: 'small' }));
  return out;
});

add('w11-boxes', 'docx', 'docx/w11-boxes.docx', (c) => {
  const out = [];
  const isBox = (tok) => { const b = c.modelBlock(tok); return !!b && /sidebar|box/.test(b.type); };
  out.push(K('w11-pbdr', 'Paragraph with borders on all four sides', 'a braille box', isBox('alphabordered') ? R.pass('sidebar box with box lines') : R.lost('no box'), { code: `${P}:3518 docxParaBorderInfo` }));
  out.push(K('w11-pbdr2', 'Two consecutive bordered paragraphs', 'one box holding both', isBox('alphabox1') && c.modelIndex('alphabox1') === c.modelIndex('alphabox2') ? R.pass('one box') : R.wrong('two boxes or none'), {}));
  out.push(K('w11-shade', 'Shaded paragraph', 'ignored (or a box if the shading is the box signal)', R.pass('plain paragraph, shading ignored'), {}));
  out.push(K('w11-bottom', 'Bottom border only (a rule)', 'not a box', isBox('alpharule') ? R.wrong('box') : R.pass('plain paragraph'), {}));
  out.push(K('w11-tcbox', 'Single-cell table used as a box (Table Grid style, title + text)', 'a braille box', isBox('alphasidebartext') ? R.pass('box') : R.lost('the table disappears: its two paragraphs come out as plain paragraphs, no box lines (borders that come from the Table Grid STYLE are not seen; only direct tblBorders/tcBorders count)'), { code: `${P}:3547 docxTcBoxInfo`, fix: 'small' }));
  out.push(keep(c, 'w11-textbox', 'Text box (DrawingML wps + VML fallback) contents', 'alphatextbox'));
  out.push(K('w11-textbox-dup', 'Text box not duplicated', 'once', (c.cap.editorText.match(/alphatextbox/g) || []).length === 1 ? R.pass('once') : R.wrong('duplicated'), {}));
  out.push(keep(c, 'w11-frame', 'Framed paragraph (w:framePr)', 'alphaframe'));
  return out;
});

add('w12-tables', 'docx', 'docx/w12-tables.docx', (c) => {
  const out = [];
  const tbl = (tok) => c.model.find((b) => b.type === 'table' && JSON.stringify(b).includes(tok));
  const t1 = tbl('alphaH1');
  out.push(K('w12-header', 'Table, repeat-header row (w:tblHeader)', 'first row is the header row', t1 && JSON.stringify(t1.headers).includes('alphaH1') ? R.pass('headers') : R.wrong('no header'), {}));
  const t2 = tbl('alphaBoldH1');
  out.push(K('w12-boldheader', 'Table, header row only bold (no tblHeader)', 'bold first row treated as header', t2 && t2.headers && t2.headers.length ? R.pass('treated as header') : R.wrong('no header'), { code: `${P}:1482 firstRowIsBoldHeader` }));
  const t3 = tbl('alphaSpanHead');
  out.push(K('w12-hspan', 'Merged cells across columns (gridSpan 2) in the header', 'one heading spanning two columns', t3 && t3.headers && t3.headers.length === 3 && t3.headers[1] === '' ? R.partial('the spanned heading sits over column 1 and column 2 gets an EMPTY header cell; the span itself is gone (the table model has no cell spans)') : R.pass('span kept'), { code: `${P}:4111-4113 (gridSpan pads empty header cells)`, fix: 'large' }));
  out.push(K('w12-vspan', 'Merged cells down rows (vMerge)', 'one cell spanning the rows', t3 && t3.rows[1] && t3.rows[1][0] === '' ? R.partial('the continued cell is an empty cell in the next row; "alphaVM" sits only in its first row') : R.pass('kept'), { fix: 'large' }));
  out.push(keep(c, 'w12-empty', 'Empty cells', 'alphaE1'));
  const te = tbl('alphaE1');
  out.push(K('w12-empty2', 'Empty cells keep their column', 'blank cell stays in its column', te && te.rows[0][0] === '' && te.rows[0][1] === 'g2' ? R.pass('columns aligned') : R.wrong('columns shifted'), {}));
  const nested = tbl('alphaInner1');
  out.push(K('w12-nested', 'Nested table', 'kept as a table, or its cells kept in order', nested ? R.pass('kept in a table') : R.wrong('the outer and inner tables are turned into three separate paragraphs (alphaOuter1, alphaInner1, alphaInner2); the table structure is lost'), { code: `${P}:4068 docxCellValue / table-or-paragraphs decision (docxTableDescription 3803)`, fix: 'large' }));
  const cap6 = tbl('alphaC1');
  out.push(K('w12-cap-above', 'Table caption ABOVE (Caption style)', 'the table title', cap6 && cap6.title && /alphacapabove/.test(cap6.title) ? R.pass('kept as the table title') : R.lost('lost'), { code: `${P}:3847 docxTableCaptionInfo` }));
  out.push(K('w12-cap-above-editor', 'Table title (caption above) visible in the editor', 'the title is shown with the table', c.edHas('alphacapabove') ? R.pass('shown') : R.partial('the title is in the model, the saved XML and the braille, but the editor table widget does not show it anywhere (seen on screen: no title line above Table 6; only the ordinary paragraph for the caption BELOW is visible)'), { code: 'web/editor/editor.mjs table widget (title / caption only in the Braille formatting dialog)', fix: 'medium', seen: 'screen' }));
  const ci = c.model.findIndex((b) => JSON.stringify(b).includes('alphacapbelow')), ti = c.model.findIndex((b) => b.type === 'table' && JSON.stringify(b).includes('alphaC1'));
  out.push(K('w12-cap-below-place', 'Table caption BELOW the table', 'stays below the table', ci >= 0 && ci < ti ? R.pass('moved before the table, as Paul decided (IMP-W4: BANA 11.2.8a places a caption before its table "regardless of its print location"); the saved file keeps it') : R.pass('below'), { code: `${P}:4053-4058 (tblPlainCap pushed before the table)`, fix: 'small' }));
  out.push(K('w12-cap-below-save', 'Table caption below: survives Save', 'present in the saved XML', c.xmlHas('alphacapbelow') ? R.pass('saved') : R.lost('NOT in the saved XML: the paragraph exists in the editor and in braille but is dropped by Save (the table already has a <caption>)'), { code: 'input/nimas-export.mjs table branch (only one caption per table)', fix: 'small' }));
  out.push(K('w12-complex', 'Table whose cells hold several paragraphs, a list, bold/italic', 'a table, cells keep their content', tbl('alphaPara1') ? R.pass('table') : R.partial('turned into plain paragraphs/list (column association lost); content, bold and italic kept'), { code: `${P}:3803 docxTableDescription (cells with lists/paragraphs -> layout table)`, fix: 'large' }));
  const t8 = tbl('alphaPrice');
  out.push(K('w12-numeric', 'Numeric columns', 'kept as text; braille aligns', t8 ? R.pass('kept') : R.lost('lost'), {}));
  out.push(keep(c, 'w12-wide', '8-column table', 'alphaW8'));
  return out;
});

add('w13-images', 'docx', 'docx/w13-images.docx', (c) => {
  const out = [];
  const g = (tok) => c.model.find((b) => b.type === 'graphic' && JSON.stringify(b).includes(tok));
  out.push(K('w13-alt', 'Picture with alt text', 'alt text transcribed as a description note', g('alphaalttext') && /alphaalttext/.test(c.cap.brf.toUpperCase().replace(/ /g, '') ) || c.brfHas('ALPHAALTTEXT') ? R.pass('description note in braille') : R.lost('no description'), {}));
  out.push(K('w13-title-attr', 'Picture title (wp:docPr title)', 'kept or ignored', R.pass('ignored (the alt text is used)'), {}));
  const noalt = c.model.find((b) => b.type === 'graphic' && (b.alt === '' || b.alt == null) && !b.caption);
  out.push(K('w13-noalt', 'Picture with NO alt text', 'flagged to the transcriber (a description is needed) - a picture may not simply vanish', noalt && c.warned('picture-no-description') ? R.pass('a transcription warning asks for a description (IMP-W12)') : noalt ? R.partial('treated as decorative: the editor says "Decorative image - omitted in braille", but no banner/warning asks for a description and the saved XML has alt=""') : R.pass('flagged'), { code: `${P}:2682 docxParagraphImages / 2724`, fix: 'small', seen: 'screen' }));
  out.push(keep(c, 'w13-caption', 'Caption under a picture (SEQ field)', 'alphacaption'));
  const g4 = g('alphacapimg');
  out.push(K('w13-caption-join', 'Caption joined to its picture', 'imggroup with caption', g4 && g4.caption ? R.pass('caption attached') : R.wrong('separate'), { code: `${P}:3774 A45/D1 caption convention` }));
  out.push(K('w13-float', 'Floating (anchored) picture', 'kept with its description', g('alphafloatalt') ? R.pass('kept, placed just before its paragraph') : R.lost('lost'), {}));
  const inl = c.model.findIndex((b) => b.type === 'graphic' && JSON.stringify(b).includes('alphainlinealt')), para = c.modelIndex('alphainlinetext');
  out.push(K('w13-inline', 'Picture in the middle of a sentence', 'description note inside the sentence, at the picture position', inl >= 0 && inl < para ? R.partial('the picture is moved out in front of the paragraph; the sentence reads "before after" with no sign of where it was') : R.pass('in place'), { fix: 'medium' }));
  return out;
});

add('w14-equations', 'docx', 'docx/w14-equations.docx', (c) => {
  const out = [];
  const eq = (label) => {
    const i = c.model.findIndex((b) => JSON.stringify(b).includes('alpha' + label + ':'));
    if (i < 0) return null;
    const b = c.model[i];
    const m = (b.segments || []).find((s) => s.type === 'math') || (c.model[i + 1] && c.model[i + 1].type === 'math' ? c.model[i + 1] : null);
    return m ? { latex: m.latex || '', mathml: m.mathml || '' } : null;
  };
  // An equation the file holds only as its picture (LibreOffice's RTF writes some as {\mmathPict} with no equation text, #45): the
  // reader keeps the picture marked "equation not transcribed", with a load notice -- not lost, but no equation to read.
  const picOnly = (label) => { const i = c.model.findIndex((b) => JSON.stringify(b).includes('alpha' + label + ':')); return i >= 0 && [c.model[i], c.model[i + 1]].some((b) => b && /equation not transcribed/.test(JSON.stringify(b))); };
  const chk = (id, feature, label, want, meta = {}) => { const e = eq(label); out.push(K(id, feature, `latex ${want}`, !e ? (picOnly(label) ? R.partial('the file holds this equation only as a picture (no equation text: LibreOffice writes some RTF equations that way); kept as the picture, marked "equation not transcribed", with a load notice') : R.lost('equation not found')) : (typeof want === 'string' ? e.latex === want : want.test(e.latex)) ? R.pass(e.latex) : R.wrong(e.latex), meta)); };
  chk('w14-frac', 'Fraction', 'EQfrac', '\\frac{1}{2}');
  chk('w14-rad', 'Square root', 'EQradical', '\\sqrt{x + 1}');
  chk('w14-root3', 'Cube root (degree 3)', 'EQcuberoot', '\\sqrt[3]{x}');
  chk('w14-sup', 'Superscript x^2', 'EQsup', 'x^{2}');
  chk('w14-sub', 'Subscript x_i', 'EQsub', 'x_{i}');
  chk('w14-subsup', 'Sub + superscript', 'EQsubsup', 'x_{i}^{2}');
  const fn = eq('EQsin');
  out.push(K('w14-func-sin', 'Function name sin (m:func / m:fName)', 'a real function: \\sin x (so braille can separate it from a neighbouring subscript)', fn && /\\text\{sin\}/.test(fn.latex) ? R.wrong(`imported as plain text ${fn.latex} - the function-name semantics (m:func) are lost in the LaTeX`) : R.pass(fn && fn.latex), { code: 'input/omml.mjs:114 convertElement (m:func -> <mtext>); engine/mathml-to-latex.mjs:193 (mtext -> \\text{})', fix: 'small' }));
  chk('w14-func-log', 'Function name log', 'EQlog', /^\\log x$|^\\log\s*x$/, { code: 'input/omml.mjs (m:func)', fix: 'small' });
  const lb = eq('EQlogbase');
  out.push(K('w14-func-logbase', 'log with a subscript base (log_2 x)', '\\log_{2}x', lb && /\\text\{log\}/.test(lb.latex) ? R.wrong(lb.latex) : R.pass(lb && lb.latex), { code: 'input/omml.mjs (m:func)', fix: 'small' }));
  chk('w14-sum', 'Summation with limits', 'EQsum', /\\sum_\{n = 1\}\^\{.*\} a_\{n\}/);
  chk('w14-int', 'Integral with limits', 'EQint', /\\int.*_\{0\}\^\{1\}|_\{0\}\^\{1\}/);
  const dp = eq('EQparen');
  out.push(K('w14-delim', 'Brackets m:d ( ), [ ], { }, | |', 'stretchy delimiters (\\left( .. \\right)) - m:d grows by default', dp && /\\left/.test(dp.latex) ? R.pass(dp.latex) : R.wrong(`plain small brackets ${dp && dp.latex}; MathML <mo>(</mo> has no stretchy/fence flag, so a bracket around a tall fraction is not enlarged`), { code: 'input/omml.mjs:396 convertDelimiter', fix: 'small' }));
  const sf = eq('EQstretchy');
  out.push(K('w14-delim-tall', 'Bracket around a fraction', 'enlarged bracket', sf && /\\left/.test(sf.latex) ? R.pass(sf.latex) : R.wrong(sf && sf.latex), { code: 'input/omml.mjs:396', fix: 'small' }));
  chk('w14-sepdelim', 'Delimiter with separators (a,b,c)', 'EQsepdelim', /^\\left\(a, b, c\\right\)$|^\(a, b, c\)$/);   // 30 Sep: stretchy fences \left( … \right) are correct now
  chk('w14-matrix', 'Matrix with brackets', 'EQmatrix', /\\begin\{[bp]?matrix\}/);
  chk('w14-hat', 'Accent: hat', 'EQhat', /\\hat\{x\}/);
  const vec = eq('EQvec');
  out.push(K('w14-vec', 'Accent: vector arrow (U+20D7)', 'vector accent in braille', vec && /\\vec\{v\}/.test(vec.latex) ? (/0020D/.test(c.brfFor('alphaEQvec:') || '') ? R.wrong(`LaTeX is right (${vec.latex}) but the braille contains the garbage "${(/[^ ]*0020D[^ ]*/.exec(c.brfFor('alphaEQvec:') || '') || [])[0]}": the combining character U+20D7 is spelled out in hex`) : R.pass(vec.latex)) : R.wrong(vec && vec.latex), { code: 'input/omml.mjs (m:acc chr U+20D7 as combining <mo>); braille via MathCAT', fix: 'small', seen: 'data' }));
  chk('w14-bar', 'Bar over a letter', 'EQbar', /\\bar\{x\}|\\overline/);
  chk('w14-limit', 'Limit (lim, x->0 underneath)', 'EQlimit', /underset|lim/);
  chk('w14-eqarr', 'Equation array (two aligned equations)', 'EQeqarr', /x \+ y = 1/);
  chk('w14-quad', 'Quadratic formula', 'EQquadratic', 'x = \\frac{- b\\pm \\sqrt{b^{2} - 4\\mathrm{ac}}}{2a}');
  chk('w14-text', 'Text inside an equation (m:nor)', 'EQtext', /\\text\{distance over time\}/);
  chk('w14-greek', 'Greek letters', 'EQgreek', '\\alpha + \\beta = \\gamma');
  chk('w14-chem', 'Chemical formula H2O (roman subscript)', 'EQchem', /\\mathrm\{H\}_\{2\}\\mathrm\{O\}/);
  const disp = c.model.filter((b) => b.type === 'math').length;
  out.push(K('w14-display', 'Display equations (m:oMathPara) are display maths', 'separate display math blocks', disp >= 10 ? R.pass(`${disp} display blocks`) : R.wrong(`${disp}`), {}));
  return out;
});

add('w15-content-controls', 'docx', 'docx/w15-content-controls.docx', (c) => {
  const out = [];
  for (const [tok, nm] of [['alphablocksdt', 'Block content control (plain text)'], ['alphainlinesdt', 'Inline content control'], ['alphadropdown', 'Drop-down content control'], ['alphadate', 'Date picker content control'], ['alphasdttable1', 'Table inside a content control']]) out.push(keep(c, 'w15-' + tok, nm, tok));
  const pl = c.modelBlock('alphaplaceholder');
  out.push(K('w15-placeholder', 'Unfilled content control (showing its placeholder text)', 'placeholder text ("Click here to enter text") not transcribed', pl ? R.wrong('the placeholder prompt is transcribed as if it were the author\'s text (<w:showingPlcHdr/> ignored)') : R.pass('dropped'), { code: `${P}:3263 flattenSdtChildren / 2261 (no showingPlcHdr test)`, fix: 'small' }));
  out.push(K('w15-checkbox', 'Check box content control', 'checked / unchecked state', R.partial('the ballot-box character is kept but has no braille (full cell + warning)'), { fix: 'small' }));
  const tt = c.model.find((b) => b.type === 'table' && JSON.stringify(b).includes('alphasdttable1'));
  out.push(K('w15-sdt-table', 'Table inside a content control', 'still a table', tt ? R.pass('table') : R.wrong('the table is flattened into two plain paragraphs (alphasdttable1, alphasdttable2): the column structure is lost'), { code: `${P}:3263 flattenSdtChildren then the table-vs-paragraph decision`, fix: 'medium' }));
  return out;
});

add('w16-sections', 'docx', 'docx/w16-sections.docx', (c) => {
  const out = [];
  out.push(absent(c, 'w16-header', 'Running header text (w:hdr)', 'alphaheader', { code: 'not read' }));
  out.push(K('w16-hdr-lost', 'Headers and footers', 'either transcribed once or reported as skipped', c.cap.editorText.includes('alphaheader') || c.cap.editorText.includes('alphafooter') ? R.pass('present') : c.notice(/running (header|footer)s?.* not transcribed/) ? R.pass('left out; the load notice names the running headers and footer (IMP-W9)') : R.lost('running header / footer / first-page header text is dropped silently (correct for page furniture, but a header holding real content, e.g. a classification or the document title, vanishes with no notice)'), { code: 'parseDocx never opens header*.xml / footer*.xml', fix: 'small' }));
  out.push(keep(c, 'w16-sec2', 'Text in a two-column section', 'alphasec2'));
  out.push(keep(c, 'w16-sec3', 'Text in a landscape section', 'alphasec3'));
  return out;
});

add('w17-nested-lists', 'docx', 'docx/w17-nested-lists.docx', (c) => {
  const out = [];
  out.push(listItem(c, 'w17-b1', 'Three-level bulleted list, level 2 item', 'alphaB2', '○', 1));
  out.push(listItem(c, 'w17-b2', 'Three-level bulleted list, level 3 item', 'alphaB3', '■', 2));
  out.push(listItem(c, 'w17-n1', 'Three-level numbered list, level 2 item', 'alphaN2', 'a.', 1));
  out.push(listItem(c, 'w17-n2', 'Three-level numbered list, level 3 item', 'alphaN3', 'i.', 2));
  out.push(listItem(c, 'w17-m2', 'Bullets containing numbers containing bullets: level 2', 'alphaM2', 'a.', 1));
  // The item uses numId 5, whose level 2 bullet is "–" (numbering.xml); IMP-W7 keeps a custom bullet's shape (was "•").
  out.push(listItem(c, 'w17-m3', 'Bullets containing numbers containing bullets: level 3', 'alphaM3', '–', 2));
  const fmt = c.cap.blocks.filter((b) => b.items).map((b) => b.tag);
  out.push(K('w17-mixed', 'Mixed bullet / number nesting stays mixed', 'an ordered item under a bullet, a bullet under it', c.xml.includes('<list type="ul">') && /<list type="ol" enum="a">/.test(c.xml) ? R.pass('saved as nested ul > ol > ul') : R.wrong('mixed lists flattened'), {}));
  return out;
});

add('w18-misc', 'docx', 'docx/w18-misc.docx', (c) => {
  const out = [];
  out.push(keep(c, 'w18-ruby', 'Ruby / phonetic guide (w:ruby)', 'alpharuby', { code: `${P}:1826 (ruby base kept, guide dropped)` }, 'kept'));
  out.push(keep(c, 'w18-smarttag', 'Smart tag', 'alphasmarttag'));
  out.push(keep(c, 'w18-proof', 'Proofing marks', 'alphaproof'));
  out.push(keep(c, 'w18-long', 'Very long word', 'alphalongword'));
  out.push(keep(c, 'w18-numbers', 'Numbers, dates and times', 'alphanumbers'));
  return out;
});

add('w19-rich-contexts', 'docx', 'docx/w19-rich-contexts.docx', (c) => {
  const out = [];
  out.push(...scriptChecks(c, 'w19-heading', 'alphaheadsub', 'alphaheadsub', { seen: 'data' }).slice(0, 1).map((k) => ({ ...k, id: 'w19-heading-script', feature: 'Subscript/superscript in a heading' })));
  const cell = c.cap.blocks.find((b) => b.table);
  const sup = JSON.stringify(cell ? cell.table : '');
  out.push(K('w19-cell-sup', 'Superscript inside a table cell', 'superscript kept and shown as a superscript', !/alphaCellsup_2`/.test(sup) && /alphaCellsup<sup>2<\/sup>/.test(c.cap.xml) && !/<U\+E00[012]>/.test(c.cap.editorText) ? R.pass('kept: <sup> in the saved file, no marker characters on screen') : /alphaCellsup_2`/.test(sup) ? R.wrong('the superscript markers collide with the table-cell markup escape characters: the cell text becomes "alphaCellsup_2`" (a real underscore and backtick) in the editor, the saved XML and the braille. Looked at on screen.') : R.partial('see editor text'), { code: 'format/cell-markup.mjs:19-22 (park/unpark reuse U+E000-E005 for escapes) vs format/text-style.mjs:45 SCRIPT_MARKS', fix: 'small', seen: 'screen' }));
  out.push(K('w19-cell-sub', 'Subscript inside a table header cell', 'subscript kept', /<U\+E00[012]>/.test(c.cap.editorText) ? R.wrong('raw private-use marker characters in the header cell (shown as boxes)') : /alphaTH(<\/strong>)?<sub>1<\/sub>/.test(c.cap.xml) ? R.pass('kept: <sub> in the saved file, shown as a subscript') : R.partial('?'), { code: `${P}:3400 richCellFromSegments`, fix: 'medium' }));
  out.push(emph(c, 'w19-cell-strike', 'Strikethrough inside a table cell', 'alphaCellstrike', 'strike'));
  out.push(K('w19-cell-strike-ed', 'Strikethrough shown in a table cell in the editor', 'visible in the cell', cell && (cell.table.struck || []).some((t) => /alphaCellstrike/.test(t)) ? R.pass('drawn struck through in the editor cell (<s>)') : R.partial('bold and underline are drawn inside an editor table cell, strikethrough is not (seen on screen: alphaCellstrike looks plain); the model, the saved XML and the braille have it'), { code: 'format/cell-dom.mjs', fix: 'small', seen: 'screen' }));
  out.push(K('w19-cell-link', 'Hyperlink inside a table cell', 'kept', c.xml.includes('href="https://example.org/cell"') ? R.pass('saved') : R.lost('lost'), {}));
  out.push(K('w19-cell-note', 'Footnote reference inside a table cell', 'noteref + note', c.xml.includes('idref="#docx-fn-1"') && c.xmlHas('alphacellnote1') ? R.pass('kept') : R.lost('lost'), {}));
  out.push(emph(c, 'w19-list-bold', 'Bold inside a list item', 'alphalistbold', 'bold'));
  out.push(K('w19-list-sub', 'Subscript inside a list item', 'subscript kept', /<U\+E000>/.test(c.cap.editorText) ? R.wrong('private-use markers in the list item') : (c.cap.fmt.sub > 0 ? R.pass('shown as a subscript') : R.partial('?')), { fix: 'medium' }));
  out.push(K('w19-note-sub', 'Subscript inside a footnote', 'subscript kept', /<U\+E000>/.test(c.cap.editorText.match(/alphanotesub/) ? c.cap.editorText : '') || c.cap.editorText.includes('H<U+E000>2<U+E002>O alphanotesub') ? R.wrong('private-use markers in the note') : (/H<sub>2<\/sub>O/.test(c.cap.xml) ? R.pass('kept: <sub> in the saved note') : R.partial('?')), { fix: 'medium' }));
  return out;
});

add('w20-equation-contexts', 'docx', 'docx/w20-equation-contexts.docx', (c) => {
  const out = [];
  const eqIn = (tok) => { const b = c.modelBlock(tok); const m = leaves(b).concat(b && b.segments ? b.segments : []); const s = (b && b.segments ? b.segments : []).find((x) => x.type === 'math'); return s || null; };
  const sf = eqIn('alphafuncsub');
  out.push(K('w20-funcsub-latex', 'a_n cos(n pi x / L): function after a subscript', 'LaTeX uses \\cos so a function is recognised', sf && /\\cos/.test(sf.latex) ? R.pass(sf.latex) : R.wrong(`LaTeX is ${sf && sf.latex} - "cos" is plain text, not the function`), { code: 'input/omml.mjs:114 convertElement (m:func); engine/mathml-to-latex.mjs:193', fix: 'small', seen: 'screen' }));
  const br = c.brfFor('alphafuncsub') || '';
  out.push(K('w20-funcsub-braille', 'Braille: space between the subscript and the function name', 'a_n then cos separated (Nemeth: a function abbreviation is preceded by a space)', /A;N"COS/.test(br) ? R.partial('left as MathCAT writes it, "' + (/A;N"COS[^ ]*/.exec(br) || [])[0] + '" (Paul, IMP-W10: a question for KD in round 3)') : R.pass(br.slice(0, 80)), { code: 'same cause as above; MathCAT gets <mtext>cos</mtext> not a function-application', fix: 'small', seen: 'screen' }));
  const t = eqIn('alphaEQtrig') || eqIn('alphaEQtrig:');
  out.push(K('w20-trig', 'tan x = sin x / cos x', 'functions recognised', t && /\\text\{tan\}/.test(t.latex) ? R.wrong(t.latex) : R.pass(t && t.latex), { code: 'input/omml.mjs:114', fix: 'small' }));
  const pf = eqIn('alphaEQparenfrac');
  out.push(K('w20-parenfrac', 'Brackets around fractions ( a/b ) + [ c/d ]', 'stretchy brackets', pf && /\\left/.test(pf.latex) ? R.pass(pf.latex) : R.wrong(`plain brackets: ${pf && pf.latex}; braille "${(/\(\?A\/B#\)[^ ]*/.exec(c.brfFor('alphaEQparenfrac') || '') || [])[0]}" shows an ordinary bracket around a fraction`), { code: 'input/omml.mjs:396 convertDelimiter', fix: 'small' }));
  const li = c.model.find((b) => b.type === 'list');
  out.push(K('w20-list-eq', 'Equation inside a list item', 'equation kept in the item', li && JSON.stringify(li).includes('"type":"math"') ? R.pass('kept') : R.lost('lost'), {}));
  out.push(K('w20-table-eq', 'Equation inside a table cell', 'equation kept', c.edHas('alphatableq') ? R.partial('the table is flattened to paragraphs; equation kept') : R.lost(''), {}));
  out.push(K('w20-heading-eq', 'Equation inside a heading', 'equation kept in the heading', c.model.find((b) => b.type === 'heading' && JSON.stringify(b).includes('math')) ? R.pass('kept') : R.lost(''), {}));
  return out;
});

add('w00-paul-test-word-doc-2', 'docx', 'docx/w00-paul-test-word-doc-2.docx', (c) => {
  const out = [];
  out.push(...scriptChecks(c, 'w00', 'Subscript', 'Superscript', { seen: 'screen' }).slice(0, 2));
  const nested = c.cap.blocks.filter((b) => b.items).flatMap((b) => b.items).filter((i) => i.markersShown > 1);
  out.push(K('w00-double-markers', 'Nested bulleted and numbered lists (the real Word test file)', 'one marker per item', nested.length ? R.wrong(`${nested.length} items show two markers, e.g. "${nested.slice(0, 3).map((i) => i.nativeMarker + ' ' + i.before + ' ' + i.text).join('", "')}"`) : R.pass('one marker each'), { seen: 'screen', code: 'web/editor/index.html:646-654', fix: 'small' }));
  const cos = c.model.flatMap((b) => (b.segments || [])).concat(c.model).map((b) => b && (b.latex || '')).filter((l) => /cos/.test(l));
  out.push(K('w00-func', 'Equation with cos / sin (m:func)', 'recognised functions (\\cos)', cos.length && /\\text\{cos\}/.test(cos[0]) ? R.wrong(cos[0]) : R.pass(cos[0]), { code: 'input/omml.mjs:114', fix: 'small', seen: 'screen' }));
  return out;
});

// ============================================================================ HTML
const H = `${P}:785 parseHtml`;
add('h01-structure', 'html', 'html/h01-structure.html', (c) => {
  const out = [];
  for (let n = 1; n <= 6; n++) { const b = c.modelBlock('alphah' + n); out.push(K('h01-h' + n, `<h${n}>`, `level-${n} heading`, b && b.type === 'heading' && b.level === n ? R.pass('ok') : R.wrong(JSON.stringify(b).slice(0, 80)), {})); }
  for (const [tok, nm] of [['alphaheader', 'Page <header> text'], ['alphanav', '<nav> list'], ['alphafooter', 'Page <footer> text'], ['alphaarticle', '<article> paragraph'], ['alphasection', '<section> heading'], ['alphaaddress', '<address>'], ['alphasummary', '<details><summary> text'], ['alphadetails', '<details> body']]) out.push(keep(c, 'h01-' + tok, nm, tok));
  out.push(K('h01-br', '<br> inside a paragraph', 'a line break kept', /alphabr line two/.test(c.cap.editorText) ? R.wrong('the <br> becomes a space: "Line one alphabr line two after br." (only a <p class="poem"> or an <address> keeps lines)') : R.pass('kept'), { code: `${P}:492 htmlParagraphSegments (br -> ' ')`, fix: 'small', seen: 'data' }));
  out.push(K('h01-hr', '<hr> rule', 'a transcriber break or ignored', R.pass('ignored'), {}));
  out.push(K('h01-aside', '<aside>', 'a box/sidebar', c.modelBlock('alphaaside') && /box|sidebar/.test(c.modelBlock('alphaaside').type) ? R.pass('sidebar box') : R.wrong('not a box'), {}));
  const bq = c.modelBlock('alphablockquote');
  out.push(K('h01-bq', '<blockquote>', 'block quotation', bq && bq.style === 'quote' ? R.pass('quote') : R.wrong(''), {}));
  out.push(K('h01-bq-footer', 'Attribution <footer> / <cite> inside a blockquote', 'the attribution is kept', c.parsedJson.includes('alphacite') ? R.pass('kept') : R.lost('the <footer>Attribution ..</footer> inside the <blockquote> is dropped silently (not in the parsed model, editor, XML or braille)'), { code: `${P}:785 parseHtml blockquote branch`, fix: 'small', seen: 'data' }));
  const q = c.cap.editorText.match(/alphaquote text/);
  out.push(K('h01-q', 'Inline <q> quotation', 'the quotation marks that print shows around <q>', /[“"]alphaquote text/.test(c.cap.editorText) ? R.pass('quote marks added') : R.lost('no quotation marks are added: "Inline quote: alphaquote text end." (browsers draw “ ” around <q>)'), { code: `${P}:812 RUN_INLINE includes q`, fix: 'small' }));
  const pre = c.modelBlock('alphapre');
  out.push(K('h01-pre', '<pre> with line breaks and spaces', 'line structure kept (BANA: computer/preformatted lines)', pre && /\n/.test(pre.text || '') ? R.pass('newlines kept') : pre && (pre.segments || []).some((g) => /\n/.test(g.text || '')) ? R.partial(`line breaks kept (in the segments), but the editor's model is an ordinary "${pre.type}" -- the parsed code block is not a code block in the editor, so no computer-braille treatment (see w10-code)`) : R.wrong(`collapsed to one line: "${pre && pre.text}" - the line break and the indentation of the second line are lost`), { code: `${P}:968 (pre/code -> code block, whitespace collapsed)`, fix: 'small' }));
  out.push(keep(c, 'h01-code', '<pre><code>', 'alphacodeblock'));
  out.push(absent(c, 'h01-hidden-css', 'Paragraph hidden by a CSS class (display:none in <style>)', 'alphacsshidden', { code: `${H} (no hidden handling anywhere)`, fix: 'medium' }));
  out.push(absent(c, 'h01-hidden-attr', 'Paragraph with the hidden attribute', 'alphahiddenattr', { code: H, fix: 'small' }));
  out.push(absent(c, 'h01-hidden-style', 'Paragraph with style="display:none"', 'alphadisplaynone', { code: H, fix: 'small' }));
  out.push(absent(c, 'h01-hidden-aria', 'Paragraph with aria-hidden="true"', 'alphaariahidden', { code: H, fix: 'small' }));
  out.push(absent(c, 'h01-noscript', '<noscript> text', 'alphanoscript', { code: H, fix: 'small' }));
  out.push(absent(c, 'h01-script', '<script> code', 'alphascript'));
  out.push(K('h01-centre', 'Centred / indented paragraph (style)', 'ignored or centred', R.pass('ignored'), {}));
  const bd = c.modelBlock('alphaboxdiv');
  out.push(K('h01-border', '<div> with a visible border', 'braille box', bd && /box/.test(bd.type) ? R.pass('box') : R.lost('no box'), {}));
  out.push(absent(c, 'h01-comment', 'HTML comment', 'alphacomment'));
  out.push(K('h01-title', '<title>', 'document title', /<doctitle>Audit HTML structure/.test(c.xml) ? R.pass('doctitle') : R.lost(''), {}));
  return out;
});

add('h02-inline', 'html', 'html/h02-inline.html', (c) => {
  const out = [];
  out.push(emph(c, 'h02-b', '<b>', 'alphab', 'bold')); out.push(emph(c, 'h02-strong', '<strong>', 'alphastrong', 'bold'));
  out.push(emph(c, 'h02-i', '<i>', 'alphai', 'italic')); out.push(emph(c, 'h02-em', '<em>', 'alphaem', 'italic'));
  out.push(emph(c, 'h02-u', '<u>', 'alphau', 'underline'));
  out.push(emph(c, 'h02-s', '<s>', 'alphas', 'strike')); out.push(emph(c, 'h02-del', '<del>', 'alphadel', 'strike')); out.push(emph(c, 'h02-spanstrike', 'style="text-decoration:line-through"', 'alphaspanstrike', 'strike'));
  out.push(emph(c, 'h02-spanunder', 'style="text-decoration:underline"', 'alphaspanunder', 'underline'));
  out.push(emph(c, 'h02-script', 'style font-family cursive', 'alphascriptspan', 'script', { code: `${P}:1473 elementIsScript` }));
  const ins = c.seg('alphains'), cite = c.seg('alphacite'), sb = c.seg('alphaspanbold'), si = c.seg('alphaspanitalic');
  out.push(K('h02-ins', '<ins> (underlined in print)', 'underlined', ins && (ins.tf & 2) ? R.pass('underline') : ins ? R.pass('plain text, as decided for the HTML batch (D11: <ins> keeps its text; underlined only when styled)') : R.lost('<ins> text lost'), { code: `${P}:422-540 htmlParagraphSegments (no ins/cite/var/dfn)`, fix: 'small' }));
  out.push(K('h02-cite', '<cite>, <var>, <dfn> (italic in print)', 'italic', cite && (cite.tf & 1) ? R.pass('italic') : R.lost('plain text - italic lost (browsers italicise cite, var, dfn)'), { code: `${P}:422-540`, fix: 'small' }));
  out.push(K('h02-spanbold', 'style="font-weight:bold" on a <span>', 'bold (this is what Word / Google Docs "save as web page" writes)', sb && (sb.tf & 4) ? R.pass('bold') : R.lost('plain text - bold lost (only text-decoration and font-family styles are read)'), { code: `${P}:422-540 htmlParagraphSegments`, fix: 'small', seen: 'data' }));
  out.push(K('h02-spanitalic', 'style="font-style:italic" on a <span>', 'italic', si && (si.tf & 1) ? R.pass('italic') : R.lost('plain text - italic lost'), { code: `${P}:422-540`, fix: 'small' }));
  // D11 (RUEB 9.6.1): small capitals are brailled as capitals, so the reader upper-cases the text.
  out.push(K('h02-sc', 'style font-variant:small-caps', 'capitals (RUEB 9.6.1)', c.edHas('ALPHASMALLCAPS') && c.xmlHas('ALPHASMALLCAPS') ? R.pass('upper-cased in the editor and the saved file (D11)') : c.edHas('alphasmallcaps') ? R.partial('kept, not upper-cased') : R.lost('"alphasmallcaps" not in the editor'), {}));
  const tr = c.cap.editorText.includes('ALPHATRANSFORM');
  out.push(K('h02-transform', 'style text-transform:uppercase', 'capitals (as print shows)', tr ? R.pass('capitals') : R.lost('kept in lower case (docx w:caps is upper-cased, CSS text-transform is not)'), { code: P, fix: 'small' }));
  out.push(...scriptChecks(c, 'h02', 'alphasubword', 'alphasupword'));
  out.push(K('h02-mark', '<mark> / <small> / <big> / <font color>', 'ignored harmlessly', c.edHas('alphamark') ? R.pass('kept as plain text') : R.lost(''), {}));
  out.push(keep(c, 'h02-abbr', '<abbr title=..>', 'alphaPDF'));
  const fr = c.seg('alphafrench');
  out.push(K('h02-lang', 'lang="fr" span', 'language recorded', fr && fr.lang === 'fr' ? R.partial('recorded, braille unchanged') : R.lost(''), { code: 'input/lang.mjs', fix: 'large' }));
  const ru = c.edHas('alpharubyalphaphonetic');
  out.push(K('h02-ruby', '<ruby> with <rt>', 'base text kept, phonetic guide dropped or separated', ru ? R.wrong('the guide text is glued to the base word: "alpharubyalphaphonetic" (one nonsense word in print and in braille)') : R.pass('ok'), { code: `${P}:422-540 (rt text concatenated)`, fix: 'small' }));
  out.push(K('h02-shy', '&shy; soft hyphen', 'dropped', /soft\u00adhyphen/.test(c.cap.editorText) ? R.partial('invisible U+00AD stays in the editor text and the saved XML') : R.pass('dropped'), { fix: 'small' }));
  out.push(K('h02-zw', 'Zero-width characters and BOM in text', 'dropped', /[\u200b\u200c\u200d\ufeff]/.test(c.cap.editorText) ? R.partial('U+200B/200C/200D/FEFF stay in the editor text and the saved XML (invisible, but they break search and word counts)') : R.pass('dropped'), { fix: 'small' }));
  out.push(absent(c, 'h02-hidden-span', '<span style="display:none">', 'alphaspanhidden', { code: H, fix: 'small' }));
  out.push(keep(c, 'h02-entities', 'Named and numeric character references', 'alphaentities'));
  out.push(keep(c, 'h02-emoji', 'Emoji', 'alphaemoji'));
  out.push(K('h02-form', 'Form controls (button, input, select, textarea)', 'not transcribed, or only visible labels', c.edHas('alphabutton') && c.edHas('alphaoption') && c.edHas('alphatextarea') ? R.pass('what the page shows is kept, as print shows it (D11): the button caption, the input value, the selected (here the only) option and the textarea text; an unselected option and a hidden input are left out') : R.pass('ok'), { code: H, fix: 'small' }));
  return out;
});

add('h03-lists', 'html', 'html/h03-lists.html', (c) => {
  const out = [];
  out.push(listItem(c, 'h03-b2', 'Nested <ul>, level 2', 'alphaB2', '•', 1));
  out.push(listItem(c, 'h03-b3', 'Nested <ul>, level 3', 'alphaB3', '•', 2));
  out.push(listItem(c, 'h03-n2', 'Nested <ol>, level 2 (starts at 1.)', 'alphaN2', '1.', 1));
  out.push(listItem(c, 'h03-start5', '<ol start=5>', 'alphastart5a', '5.', 0));
  out.push(listItem(c, 'h03-typea', '<ol type=a>', 'alphatypea1', 'a.', 0));
  out.push(listItem(c, 'h03-typeI', '<ol type=I>', 'alphatypeI1', 'I.', 0));
  out.push(K('h03-reversed', '<ol reversed>', 'counts down 3, 2, 1', itemOf(c, 'alphareversed1').marker === '3.' ? R.pass('3.') : R.wrong('numbered 1. 2. 3. (print counts 3, 2, 1)'), { code: `${P}:981-1030 (ol reversed ignored)`, fix: 'small' }));
  out.push(K('h03-value', '<li value=10>', 'item numbered 10, then 11', itemOf(c, 'alphavalue10').marker === '10.' ? R.pass('10.') : R.wrong(`numbered ${itemOf(c, 'alphavalue10').marker} (print shows 10 and 11)`), { code: `${P}:981-1030`, fix: 'small' }));
  out.push(K('h03-square', 'list-style-type square / none', 'ignored', R.pass('plain bullet'), {}));
  const dl = c.model.find((b) => JSON.stringify(b).includes('alphaterm2'));
  out.push(K('h03-dd2', '<dl> with two <dd> for one <dt>', 'both definitions under the term', /<dt>alphadef2b<\/dt>/.test(c.cap.xml) ? R.wrong('the second <dd> is saved as a new <dt> (a term with no definition): <dt>alphadef2b</dt>') : R.pass('ok'), { code: `${P}:1042-1060 (dt/dd pairing)`, fix: 'small' }));
  out.push(keep(c, 'h03-paraitem', 'Two paragraphs inside one <li>', 'alphaparaitem'));
  const bq = itemOf(c, 'alphaitemquote');
  out.push(K('h03-bq', 'Block quote inside a list item', 'kept inside the item', (c.xmlStack('alphaitembq') || []).includes('li') ? R.pass('kept inside the <li> in the saved XML (the editor shows it as a separate quote block after the item)') : R.lost('lost or moved out of the item'), {}));
  const tl = itemOf(c, 'alphaitemtable');
  out.push(K('h03-table', 'Table inside a list item', 'kept inside the item', (c.xmlStack('alphalt1') || []).includes('li') ? R.pass('kept inside the <li> in the saved XML (the editor shows the table after the item)') : R.lost('lost or moved out of the item'), {}));
  out.push(K('h03-task', 'Checked / unchecked checkbox in a list item', 'the state is shown', /alphachecked task/.test(c.cap.editorText) && !/\[x\]|☑|☐/.test(c.cap.editorText) ? R.lost('the checkbox is dropped: "alphachecked task" and "alphaunchecked task" look identical (checked vs unchecked is lost)') : R.pass(''), { code: `${P}:981-1030`, fix: 'small' }));
  out.push(keep(c, 'h03-menu', '<menu>', 'alphamenu1'));
  out.push(K('h03-loose', 'Text directly inside <ul> between items', 'kept', c.parsedJson.includes('alphaloose') ? R.pass('kept') : R.lost('dropped (invalid HTML, but browsers show it)'), { fix: 'small' }));
  out.push(K('h03-gaps', 'Empty paragraphs between adjacent lists in the editor', 'none', R.partial('consecutive lists are separated by an empty editor paragraph (not saved)'), { fix: 'small', seen: 'data' }));
  out.push(K('h03-link', 'Link inside a list item', 'hyperlink kept', c.xml.includes('href="http://example.org/x"') ? R.pass('saved') : R.lost('address lost'), {}));
  out.push(...scriptChecks(c, 'h03', 'alphaitemwith', 'alphaitemwith').slice(0, 1).map((k) => ({ ...k, id: 'h03-script', feature: 'Superscript inside a list item' })));
  return out;
});

add('h04-tables', 'html', 'html/h04-tables.html', (c) => {
  const out = [];
  const tbl = (tok) => c.model.find((b) => b.type === 'table' && JSON.stringify(b).includes(tok));
  const t1 = tbl('alphaH1');
  out.push(K('h04-thead', '<thead> header row', 'header row', t1 && t1.headers.length === 3 ? R.pass('headers') : R.wrong('no header'), {}));
  out.push(K('h04-tfoot', '<tfoot> row', 'kept as the last row', t1 && JSON.stringify(t1.rows).includes('alphafoot') ? R.pass('last row') : R.lost('lost'), {}));
  out.push(K('h04-caption', '<caption>', 'table caption / title', c.model.some((b) => b.type === 'caption' && /alphacaption1/.test(b.text)) || (t1 && /alphacaption1/.test(JSON.stringify(t1))) ? R.pass('kept') : R.lost(''), {}));
  const t2 = tbl('alphaSpanHead');
  out.push(K('h04-colspan-head', '<th colspan=2> in <thead>', 'the heading stays over its two columns and the next heading over column 3', t2 && t2.headers.length === 2 ? R.wrong('the header row has only 2 cells for 3 columns: "alphaSpanHead" over column 1, "alphaH3b" over column 2 - the third column\'s heading is now over the wrong column (data body rows are padded, the header row is not)') : R.pass('ok'), { code: `${P}:1111-1118 (thead: first row only, colspan not padded)`, fix: 'small', seen: 'data' }));
  out.push(K('h04-colspan-body', '<td colspan=2> in the body', 'spans; padded cell', t2 && t2.rows[2] && t2.rows[2].length === 3 ? R.pass('padded with an empty cell') : R.wrong(''), {}));
  // IMP-W5 (Paul, 30 Sep): merged cells repeat their text in every cell they cover (was: blank in the next row, BANA 11.5.3a).
  const cellText = (v) => (v && typeof v === 'object' ? v.text : v);
  out.push(K('h04-rowspan', '<td rowspan=2>', 'the merged text repeated in the next row (IMP-W5)', t2 && t2.rows[1] && t2.rows[0] && cellText(t2.rows[1][0]) && cellText(t2.rows[1][0]) === cellText(t2.rows[0][0]) ? R.pass('repeated in the next row (IMP-W5)') : R.wrong(JSON.stringify(t2 && t2.rows.slice(0, 2))), {}));
  const t3 = tbl('alphaCorner');
  out.push(K('h04-rowheaders', '<th scope=row> first column', 'row headings recognised', t3 && /alphaRowHead/.test(JSON.stringify(t3.rows)) ? R.partial('read as ordinary first-column cells (no row-heading semantics)') : R.lost(''), { fix: 'medium' }));
  const t4 = tbl('alphaE1');
  out.push(K('h04-cell-fmt', 'Bold / italic / link in a cell', 'kept', t4 && /"tf":4/.test(JSON.stringify(t4)) && /"tf":1/.test(JSON.stringify(t4)) ? R.pass('bold and italic kept as cell segments') : R.lost(''), {}));
  out.push(...scriptChecks(c, 'h04', 'alphabold', 'alphabold').slice(0, 1).map((k) => ({ ...k, id: 'h04-cell-script', feature: 'Sub/superscript inside a table cell' })));
  const t5 = tbl('alphaInner1');
  const inner = JSON.stringify(t5 && t5.rows);
  out.push(K('h04-nested', 'Nested table', 'inner table kept once, in order', (inner.match(/alphaInner1/g) || []).length > 1 ? R.wrong(`the inner cells are added to the outer table AND repeated: "alphaInner1" occurs ${(inner.match(/alphaInner1/g) || []).length} times in the imported table (${clip(inner, 140)})`) : R.pass(''), { code: `${P}:1075-1200 parseHtml table branch (getElementsByTagName reaches nested <tr>/<td>)`, fix: 'medium' }));
  const t6 = tbl('alphaCL1');
  out.push(K('h04-cell-blocks', 'Cell holding a bullet list and two paragraphs', 'items kept apart', /alphacellbullet1alphacellbullet2/.test(inner + JSON.stringify(t6)) ? R.wrong('the list items and paragraphs are run together with NO space: "alphacellbullet1alphacellbullet2", "alphacellp1alphacellp2" (two words become one in print, editor and braille)') : R.pass('separated'), { code: `${P}:1075-1200 (cell text = textContent)`, fix: 'small' }));
  const t9 = tbl('alphalayout');
  out.push(K('h04-layout', 'Layout table (one cell, two paragraphs)', 'paragraphs kept apart', /paragraph onealphalayout/.test(JSON.stringify(t9)) ? R.wrong('kept as a one-cell table with the two paragraphs joined without a space ("paragraph onealphalayout")') : R.pass(''), { code: `${P}:1075-1200`, fix: 'small' }));
  const t10 = tbl('alphaGroup');
  out.push(K('h04-head2', 'Second header row in <thead>', 'both header rows kept', t10 && /alphaSub1/.test(JSON.stringify(t10)) ? R.pass('kept') : R.lost('"alphaSub1" and "alphaSub2" (the second <thead> row) are dropped silently'), { code: `${P}:1111-1118 (only theadTrs[0] read)`, fix: 'medium' }));
  const t8 = tbl('alphaPrice');
  out.push(K('h04-align', 'text-align:right on numeric cells', 'column alignment read', t8 && t8.printAlign ? R.pass('printAlign kept') : R.lost(''), {}));
  return out;
});

add('h05-media-maths-links', 'html', 'html/h05-media-maths-links.html', (c) => {
  const out = [];
  const g = (tok) => c.model.find((b) => b.type === 'graphic' && JSON.stringify(b).includes(tok));
  out.push(K('h05-alt', '<img alt=..>', 'description note', g('alphaalt red') ? R.pass('kept') : R.lost(''), {}));
  out.push(K('h05-noalt', '<img> with no alt attribute', 'flagged for a description', c.model.some((b) => b.type === 'graphic' && !b.alt && !b.caption) ? (c.warned('picture-no-description') ? R.pass('a transcription warning asks for a description (IMP-W12)') : R.partial('treated as decorative and left out of braille; no warning')) : R.pass(''), { fix: 'small' }));
  out.push(K('h05-title', '<img title=..> only', 'used when alt is empty', R.partial('title ignored; image left out as decorative'), { fix: 'small' }));
  out.push(K('h05-figcap', '<figure><figcaption>', 'image with caption', g('alphafigalt') && g('alphafigalt').caption ? R.pass('caption joined') : R.wrong(''), {}));
  out.push(K('h05-svg', 'Inline <svg> with <title>/<desc>', 'a described graphic', g('alphasvg') ? R.pass('kept') : R.wrong('the graphic is dropped; only the <desc> text survives as a bare paragraph, <title> is lost'), { code: `${P}:785 parseHtml (svg not handled as a graphic)`, fix: 'medium' }));
  // Paul, 1 Oct 2026 (overnight question 4): <video>/<audio> fallback is left out; <object>/<canvas>/<iframe> fallback can be real content and is kept.
  out.push(K('h05-fallback', 'Fallback text of <video>/<audio> (left out) and of <canvas>/<object> (kept, can be real content)', '<video>/<audio> fallback not transcribed; <canvas>/<object> fallback transcribed', (c.edHas('alphavideofallback') || c.edHas('alphaaudiofallback')) ? R.wrong('the <video>/<audio> fallback is transcribed') : (!c.edHas('alphacanvasfallback') || !c.edHas('alphaobjectfallback')) ? R.wrong('the <canvas>/<object> fallback is lost') : R.pass(''), { fix: 'small' }));
  const m = c.model.find((b) => JSON.stringify(b).includes('alphainlinemath'));
  out.push(K('h05-inline-math', 'Inline MathML', 'math kept inline', m && JSON.stringify(m).includes('"type":"math"') ? R.pass('kept') : R.lost(''), {}));
  out.push(K('h05-display-math', 'Display MathML block', 'math block', c.model.some((b) => b.type === 'math') ? R.pass('kept') : R.lost(''), {}));
  const cosm = c.model.flatMap((b) => b.segments || []).find((s) => s.type === 'math' && /cos/.test(s.latex || ''));
  out.push(K('h05-mathml-cos', 'MathML <mi>cos</mi> after a subscript', 'braille separates subscript and function', cosm && /\\cos/.test(cosm.latex) ? R.pass(cosm.latex) : R.wrong(cosm && cosm.latex), {}));
  const ann = c.model.flatMap((b) => b.segments || []).find((s) => s.type === 'math' && /y/.test(s.latex || '') && /semantics/.test(s.mathml || ''));
  out.push(K('h05-annotation', 'MathML <semantics> with an <annotation> (LaTeX source)', 'the maths once: y', ann && /^yy$/.test(ann.latex) ? R.wrong('the annotation text is added to the expression: LaTeX "yy" and alttext="yy" saved (the braille shows one y)') : R.pass(''), { code: 'engine/mathml-to-latex.mjs (annotation text included)', fix: 'small' }));
  const i = c.seg('alphainternal');
  out.push(K('h05-internal', 'Internal link (#target)', 'text kept', i ? R.partial('kept as text with href, not marked in braille or editor') : R.lost(''), {}));
  out.push(K('h05-imglink', 'Image inside a link', 'image kept', g('alphalinkimg') ? R.partial('the image is kept (moved before the paragraph); the link around it is lost') : R.lost(''), {}));
  const fn = c.cap.editorText.match(/note(.)(.)1/);
  out.push(K('h05-noteref', 'Footnote reference (<sup><a role="doc-noteref">1</a></sup>)', 'a note reference linked to its note', /<U\+E001><U\+E002>1/.test(c.cap.editorText) ? R.wrong('an EMPTY superscript pair (U+E001 U+E002, shown as boxes) followed by a plain "1": the superscript markers wrap nothing because the link text is emitted outside them') : R.partial('plain number'), { code: `${P}:490-500 htmlParagraphSegments (sub/sup around <a>)`, fix: 'small', seen: 'data' }));
  out.push(K('h05-fn-body', 'Footnote body (<aside role="doc-footnote"> / <ol class=footnotes>)', 'a footnote tied to its reference', c.model.some((b) => b.type === 'footnote') ? R.pass('footnote') : R.partial('the aside becomes a BOX (sidebar) and the ordered list a numbered list with the word "back"; no link between reference and note (only <a role=doc-noteref> patterns would need recognising)'), { code: `${P}:785 parseHtml`, fix: 'medium' }));
  out.push(absent(c, 'h05-hidden-input', '<input type=hidden>', 'alphahiddeninput'));
  return out;
});

// ============================================================================ MARKDOWN
const M = `${P}:4589 parseMarkdown`;
add('m01-inline-blocks', 'md', 'md/m01-inline-blocks.md', (c) => {
  const out = [];
  for (let n = 1; n <= 6; n++) { const b = c.modelBlock('alphah' + n); out.push(K('m01-h' + n, `ATX heading ${'#'.repeat(n)}`, `level-${n}`, b && b.type === 'heading' && b.level === n ? R.pass('ok') : R.wrong(JSON.stringify(b)), {})); }
  out.push(K('m01-setext', 'Setext headings', 'level 1 and 2', c.modelBlock('alphasetext') && c.modelBlock('alphasetext').level === 1 && c.modelBlock('alphasetext2').level === 2 ? R.pass('ok') : R.wrong(''), {}));
  out.push(emph(c, 'm01-italic', '*italic*', 'alphaitalic', 'italic'));
  out.push(emph(c, 'm01-under', '_italic_ (underscore form)', 'alphaunder', 'italic'));
  out.push(emph(c, 'm01-bold', '**bold**', 'alphabold', 'bold'));
  out.push(emph(c, 'm01-bold2', '__bold__', 'alphabold2', 'bold'));
  const bi = c.edHas('*alphabi*');
  out.push(K('m01-bolditalic', '***bold italic***', 'bold and italic', bi ? R.wrong('mangled: literal asterisks left around a bold word: "*alphabi*"') : R.pass('ok'), { code: `${M}`, fix: 'small', seen: 'screen' }));
  out.push(emph(c, 'm01-strike', '~~strikethrough~~', 'alphastrike', 'strike'));
  out.push(K('m01-code', '`inline code`', 'uncontracted / code text', c.seg('alphacode') && c.seg('alphacode').uncontracted ? R.pass('uncontracted') : R.lost(''), {}));
  out.push(K('m01-escape', 'Backslash escapes (\\*text\\*)', 'the literal asterisks, no emphasis', /\\alphaescaped/.test(c.cap.editorText) ? R.wrong('the backslash is kept and the "escaped" text is italicised: "\\alphaescaped\\"; "1\\." and "\\#" also keep their backslash') : R.pass('ok'), { code: M, fix: 'small', seen: 'screen' }));
  out.push(K('m01-hardbreak', 'Hard line break (two spaces / backslash)', 'a line break', /alphaspaces and backslash\\/.test(c.cap.editorText) ? R.wrong('both forms become a space, and the backslash form leaves a literal "\\"') : R.pass('ok'), { code: M, fix: 'small', seen: 'screen' }));
  out.push(K('m01-html-inline', 'Inline HTML (<sub>, <sup>, <kbd>, <mark>, <u>, <s>, <br>)', 'interpreted, or dropped', /<(sub|kbd)>/.test(c.cap.editorText) || /&lt;(sub|kbd)&gt;/.test(c.cap.xml) ? R.wrong('the tags are shown and brailled as literal text: "H<sub>2</sub>O ... <kbd>alphakbd</kbd>" (braille @<SUB@>)') : R.pass('ok'), { code: M, fix: 'medium', seen: 'screen' }));
  out.push(K('m01-link-title', '[text](url "title")', 'link with address only', /alphatitle/.test(c.cap.xml.match(/<a href="[^"]*"/g)?.join('') || '') ? R.wrong('the title text and quote marks end up INSIDE the saved link address: href="https://example.org/alpha &quot;alphatitle&quot;"') : R.pass('ok'), { code: M, fix: 'small' }));
  out.push(K('m01-refs', 'Reference-style link', 'link kept', c.xml.includes('href="https://example.org/ref"') ? R.pass('kept') : R.lost(''), {}));
  out.push(K('m01-autolink', '<https://..> autolink', 'the URL without angle brackets', /<https:\/\/example\.org\/autolink>/.test(c.cap.editorText) ? R.wrong('angle brackets kept: "<https://example.org/autolink>" (and no link)') : R.pass('ok'), { code: M, fix: 'small', seen: 'screen' }));
  out.push(K('m01-image', '![alt](data:..."title") inline image', 'an image block with alt text', c.model.some((b) => b.type === 'graphic') ? R.pass('image') : R.wrong('no image: the alt text becomes a link whose address is the whole data URI, and the second image (no alt) is left as raw "![](data:image/png;base64,....)" text that is BRAILLED (hundreds of cells of base64). Looked at on screen.'), { code: M, fix: 'medium', seen: 'screen' }));
  out.push(K('m01-quote', 'Block quote (nested >)', 'block quotation(s)', c.modelBlock('alphablockquote').style === 'quote' ? R.pass('quote (nesting flattened)') : R.wrong(''), {}));
  out.push(K('m01-hr', '--- thematic break', 'ignored or a break', /^---$/m.test(c.cap.editorText) ? R.wrong('shown and brailled as the literal text "---"') : R.pass('ok'), { code: M, fix: 'small', seen: 'screen' }));
  out.push(keep(c, 'm01-fenced', 'Fenced code block', 'alphafenced'));
  const ic = c.modelBlock('alphaindented');
  out.push(K('m01-indented', 'Indented code block (4 spaces, two lines)', 'code block, lines kept', ic && ic.type === 'code' ? R.pass('code') : c.parsed.some((b) => b.type === 'code' && /alphaindented[\s\S]*\n/.test(b.text || '')) && ic && (ic.segments || []).some((g) => /\n/.test(g.text || '')) ? R.partial('a code block in the reader, lines kept; the editor holds it as an ordinary paragraph with its line breaks (the editor has no code block: import fix list #40)') : R.wrong(`a plain paragraph with the lines run together: "${ic && ic.text}"`), { code: M, fix: 'small' }));
  out.push(K('m01-entities', 'HTML entities (&copy; &amp; &lt;)', 'decoded', /&copy;/.test(c.cap.editorText) ? R.wrong('not decoded: the editor, the braille (@&COPY2) and the saved file (&amp;copy;) all carry the literal text "&copy; &amp; &lt;"') : R.pass('ok'), { code: M, fix: 'small', seen: 'screen' }));
  out.push(absent(c, 'm01-comment', 'HTML comment', 'alphamdcomment'));
  out.push(K('m01-htmlblock', 'HTML block (<div>..</div>)', 'interpreted', /<div class/.test(c.cap.editorText) ? R.wrong('shown as literal "<div class="note">HTML block alphahtmlblock</div>"') : R.pass('ok'), { code: M, fix: 'medium', seen: 'screen' }));
  out.push(K('m01-footnote', 'Footnotes [^1] / [^note]', 'notes', c.model.some((b) => b.type === 'footnote') ? R.pass('notes') : R.wrong('not supported: "[^1]" stays in the text and the definitions become a paragraph "[^1]: Footnote one text.."'), { code: M, fix: 'medium', seen: 'screen' }));
  out.push(K('m01-deflist', 'Definition list (Term / : Definition)', 'definition list', c.model.some((b) => b.type === 'list' && b.kind === 'glossary') ? R.pass('glossary') : R.partial('term and ": Definition" joined in one paragraph (extension syntax; acceptable)'), { fix: 'small' }));
  out.push(K('m01-frontmatter', 'YAML front matter', 'title/author used, not shown as text', /<doctitle>Audit markdown front matter/.test(c.xml) && !c.edHas('author: Audit Author') ? R.pass('title used, front matter removed') : R.wrong(''), {}));
  out.push(K('m01-emoji', ':smile: shortcode', 'kept or converted', R.pass('kept as text'), {}));
  return out;
});

add('m02-lists', 'md', 'md/m02-lists.md', (c) => {
  const out = [];
  out.push(listItem(c, 'm02-b2', 'Nested bullets, level 2', 'alphaB2', '•', 1));
  out.push(listItem(c, 'm02-b3', 'Nested bullets, level 3', 'alphaB3', '•', 2));
  out.push(listItem(c, 'm02-n2', 'Nested numbers, level 2 (3-space indent)', 'alphaN2', '1.', 1));
  out.push(listItem(c, 'm02-n3', 'Nested numbers, level 3', 'alphaN3', '1.', 2, { code: `${M} (list nesting from indent width)`, fix: 'small' }));
  out.push(listItem(c, 'm02-start5', 'Numbered list starting at 5', 'alphastart5a', '5.', 0));
  out.push(listItem(c, 'm02-paren', 'Numbers with ")" (1) 2))', 'alphaparen1', '1)', 0));
  out.push(listItem(c, 'm02-mixed', 'Bullets containing numbers: level 2', 'alphaM2', '1.', 1));
  const lo1 = c.model.filter((b) => b.type === 'list' && /alphaloose/.test(JSON.stringify(b))).length;
  out.push(K('m02-loose', 'Loose list (blank lines between items)', 'one list', lo1 === 1 ? R.pass('one list') : R.wrong(`${lo1} separate lists (one per item; for a NUMBERED loose list the numbering would restart at 1. in each)`), { code: M, fix: 'small' }));
  out.push(K('m02-task', 'Task list  - [x] / - [ ]', 'checked state shown', /\[x\]/.test(c.cap.editorText) ? R.pass('the state kept as "[x]" / "[ ]", as the HTML reader writes a check box (D11)') : R.partial('state not shown'), { fix: 'small' }));
  out.push(keep(c, 'm02-itempara', 'Second paragraph inside a list item', 'alphaitempara'));
  out.push(K('m02-itemcode', 'Code block inside a list item', 'kept with the item', c.modelBlock('alphaitemcode') && c.modelBlock('alphaitemcode').type !== 'list' ? R.partial(c.parsed.some((b) => b.type === 'list' && /alphaitemcode/.test(JSON.stringify(b))) ? 'kept with its item by the reader (item.blocks), but the editor moves it out of the list, after it, as an ordinary paragraph (the editor has no code block: import fix list #40)' : 'kept, but moved out of the list (after it)') : R.pass(''), { fix: 'small' }));
  out.push(K('m02-itembold', '**bold** and a link in a list item', 'kept', c.xml.includes('<strong>bold</strong>') && c.xml.includes('href="https://example.org/l"') ? R.pass('kept') : R.lost(''), {}));
  return out;
});

add('m03-tables-maths', 'md', 'md/m03-tables-maths.md', (c) => {
  const out = [];
  const tbl = (tok) => c.model.find((b) => b.type === 'table' && JSON.stringify(b).includes(tok));
  const t1 = tbl('alphaH1');
  out.push(K('m03-table', 'GFM table', 'header + rows', t1 && t1.headers.length === 3 ? R.pass('ok') : R.wrong(''), {}));
  const t2 = tbl('alphalink');
  out.push(K('m03-cell-fmt', '**bold**, *italic*, `code`, [link](..) inside a table cell', 'kept', /"tf":4/.test(JSON.stringify(t2)) ? R.pass('kept') : R.lost('the inline markup is stripped: "alphabold", "alphaitalic", "alphacode" lose their bold / italic / code, "alphalink" loses its link address'), { code: `${M} (table cells: markup removed, not parsed)`, fix: 'medium', seen: 'data' }));
  out.push(K('m03-cell-html', '<sub>/<sup> inside a table cell', 'interpreted', /Hsub>2\/sub>O/.test(c.cap.editorText) ? R.wrong('the "<" characters are eaten by the cell-markup parser: "Hsub>2/sub>O and xsup>2/sup>"') : R.pass(''), { code: 'format/cell-markup.mjs (escape handling)', fix: 'small', seen: 'screen' }));
  out.push(K('m03-pipe', 'Escaped pipe \\| in a cell', 'a pipe in the cell', /escaped \| pipe/.test(JSON.stringify(t2)) ? R.pass('ok') : R.wrong(''), {}));
  out.push(K('m03-nopipes', 'Table without outer pipes', 'a table', tbl('alphaX') ? R.pass('table') : R.wrong('not recognised: "alphaX | alphaY" and "1 | 2" are plain paragraphs'), { code: M, fix: 'small' }));
  const maths = c.model.flatMap((b) => b.segments || []).filter((s) => s.type === 'math');
  out.push(K('m03-inline-math', '$x^2 + y^2 = z^2$', 'inline maths', maths.some((s) => /x\^2/.test(s.latex)) ? R.pass('maths') : R.lost(''), {}));
  out.push(K('m03-display-math', '$$ ... $$ display maths', 'display maths', c.model.some((b) => (b.segments || []).some((s) => s.type === 'math' && /frac/.test(s.latex))) ? R.pass('maths') : R.lost(''), {}));
  out.push(K('m03-paren-math', '\\( .. \\) and \\[ .. \\] maths delimiters', 'maths', maths.some((s) => /a_n/.test(s.latex) && /cos/.test(s.latex)) && maths.some((s) => /\\sum/.test(s.latex) && /a_n/.test(s.latex) && !/cos/.test(s.latex)) ? R.pass('maths, both forms') : R.wrong('not recognised: shown as literal text "\\(a_n \\cos x\\)" and "[\\sum_{n=1}^{\\infty} a_n]" (backslashes partly eaten)'), { code: M, fix: 'small', seen: 'screen' }));
  out.push(K('m03-dollars', 'Two dollar amounts "$5 and $10"', 'plain text', maths.some((s) => /5 and/.test(s.latex)) ? R.wrong('"$5 and $" is taken as maths: the text "5 and" becomes an equation (5 a n d with invisible times) and the dollar signs disappear') : R.pass('ok'), { code: `${M} protectMathSpans 4559`, fix: 'small' }));
  const fn = maths.find((s) => /cos/.test(s.latex || ''));
  out.push(K('m03-cos', '\\cos in $..$ after a subscript', 'braille separates the function', fn && /a_\{?n\}?\s*\\cos/.test(fn.latex) ? R.pass(fn.latex) : R.wrong(fn && fn.latex), {}));
  return out;
});

// ============================================================================ RTF
const RT = `${P}:5094 parseRtf`;
const RTF_CW = `${P}:5625-5665 (character-property switch has no sub/super/v/scaps/caps/deleted/uldb ...)`;
add('r01-inline', 'rtf', 'rtf/r01-inline.rtf', (c) => {
  const out = [];
  out.push(K('r01-title', 'Title / Subtitle styles', 'title and subtitle', c.subtitleInTitle('alphatitle', 'alphasubtitle') ? R.pass('the second line of the title heading (IMP-W1)') : c.modelBlock('alphasubtitle') && c.modelBlock('alphasubtitle').type === 'heading' ? R.wrong('Subtitle becomes a second level-1 heading (same as Word)') : R.pass(''), { code: `${P}:5307`, fix: 'small' }));
  for (let n = 1; n <= 3; n++) { const b = c.modelBlock('alphah' + n); out.push(K('r01-h' + n, `Heading ${n} style`, `level ${n}`, b && b.type === 'heading' && b.level === n ? R.pass('ok') : R.wrong(JSON.stringify(b)), {})); }
  out.push(K('r01-quote', 'Quote style', 'block quotation', c.modelBlock('alphaquote').style === 'quote' ? R.pass('quote') : R.lost('the Quote paragraph style is not recognised (Word .docx and .doc do)'), { code: `${P}:5008 classifyRtfStyle`, fix: 'small' }));
  out.push(emph(c, 'r01-bold', '\\b bold', 'alphabold', 'bold')); out.push(emph(c, 'r01-italic', '\\i italic', 'alphaitalic', 'italic')); out.push(emph(c, 'r01-under', '\\ul underline', 'alphaunder', 'underline'));
  out.push(emph(c, 'r01-uldb', '\\uldb double underline', 'alphadouble', 'underline', { code: RTF_CW, fix: 'small' }));
  out.push(emph(c, 'r01-uldot', '\\uld dotted / \\ulw words / \\ulth thick underline', 'alphadotted', 'underline', { code: RTF_CW, fix: 'small' }));
  out.push(emph(c, 'r01-strike', '\\strike', 'alphastrike', 'strike')); out.push(emph(c, 'r01-dstrike', '\\striked1', 'alphadstrike', 'strike'));
  out.push(...scriptChecks(c, 'r01', 'alphasubword', 'alphasupword', { code: RTF_CW, fix: 'small' }));
  out.push(K('r01-caps', '\\scaps small caps / \\caps all caps', 'capitals (as in Word files)', c.edHas('ALPHASMALLCAPS') ? R.pass('capitals') : R.lost('not upper-cased (the .docx and .doc readers do upper-case them)'), { code: RTF_CW, fix: 'small' }));
  out.push(absent(c, 'r01-hidden', 'Hidden text (\\v)', 'alphahidden', { code: RTF_CW, fix: 'small' }));
  out.push(absent(c, 'r01-deleted', 'Tracked deletion (\\deleted)', 'alphadeleted', { code: RTF_CW, fix: 'medium' }));
  out.push(keep(c, 'r01-inserted', 'Tracked insertion (\\revised)', 'alphainserted'));
  out.push(K('r01-script-font', 'Script font (\\f2 \\fscript Brush Script MT)', 'script typeform', c.seg('alphascriptfont') && (c.seg('alphascriptfont').tf & 8) ? R.pass('script') : R.lost('plain (the .docx and HTML readers give it the script typeform)'), { code: RTF_CW, fix: 'small' }));
  out.push(K('r01-linebreak', '\\line', 'line break kept', /alphaline\s*\nline two/.test(c.cap.editorText) ? R.pass('a line break in the editor (and its braille)') : /alphaline\nline two/.test(c.modelJson.replace(/\\n/g, '\n')) || c.edHas('alphaline line two') ? R.partial('kept as a newline in the model, shown as a space in the editor') : R.lost(''), { fix: 'small' }));
  out.push(K('r01-specials', 'Non-breaking space, optional hyphen, non-breaking hyphen, dashes, curly quotes, bullet', 'all kept', c.edHas('non-breaking') && c.edHas('hyphen alphaopt') ? R.pass('kept') : R.wrong('lost'), {}));
  out.push(K('r01-euro', 'Unicode escape \\u8364? (euro) and accented \\\'e9', 'EURO sign and e-acute', c.cap.editorText.includes('€') && c.cap.editorText.includes('café') ? R.pass('kept') : R.wrong(''), {}));
  out.push(K('r01-emoji', 'Emoji as a surrogate pair \\u-10179?\\u-8704?', 'the emoji (how Word writes one)', c.cap.editorText.includes(String.fromCodePoint(0x1F600)) ? R.pass('kept') : R.wrong('the second half of the pair is dropped when the two \\u escapes follow each other with no space: a lone high surrogate (U+D83D) is left in the text'), { code: `${P}:5667 case 'u' (skips the fallback "?" by taking the next character)`, fix: 'small' }));
  out.push(K('r01-align', 'Centred / right-aligned paragraph', 'centred', c.modelIndex('alphacentre') >= 0 || c.edHas('alphacentre') ? R.pass('not reproduced, as Paul decided (IMP-W8: alignment of body text is not reproduced); the text is kept as an ordinary paragraph') : R.lost('text lost'), { fix: 'medium' }));
  const l = c.seg('alphalink');
  out.push(K('r01-link', 'HYPERLINK field', 'address kept', l && l.href ? R.pass(l.href) : R.lost(''), {}));
  out.push(K('r01-lang', '\\lang1036 (French)', 'recorded', c.seg('alphafrench') && c.seg('alphafrench').lang === 'fr' ? R.partial('recorded; braille unchanged') : R.lost(''), { fix: 'large' }));
  out.push(K('r01-pagebreak', '\\page', 'page break / note', R.partial('ignored; the two halves are joined into one paragraph "..alphabeforealphaafter" (no space between them)'), { fix: 'small' }));
  out.push(K('r01-comment', 'Comment (\\annotation)', 'dropped with a notice', c.edHas('alphacommentbody') ? R.wrong('comment body transcribed') : c.notice(/comment.* not transcribed/) ? R.pass('left out with a load notice (IMP-W9)') : R.lost('dropped silently (no notice)'), { fix: 'small' }));
  return out;
});

add('r02-lists-tables', 'rtf', 'rtf/r02-lists-tables.rtf', (c) => {
  const out = [];
  out.push(listItem(c, 'r02-b1', 'Bullet list, level 1 (Symbol bullet via \\listtext)', 'alphabullet1', '•', 0, { code: `${P}:5757 listtext/pntext`, fix: 'small' }));
  out.push(listItem(c, 'r02-b2', 'Bullet list, level 2 (ilvl 1)', 'alphabullet2', '○', 1, { code: `${P}:5757 (\\ilvl is never read: every item is level 1)`, fix: 'medium' }));
  out.push(listItem(c, 'r02-b3', 'Bullet list, level 3 (ilvl 2)', 'alphabullet3', '■', 2, { code: `${P}:5757`, fix: 'medium' }));
  out.push(listItem(c, 'r02-n1', 'Numbered level 1', 'alphanum1', '1.', 0));
  out.push(listItem(c, 'r02-n2', 'Numbered level 2 (a.)', 'alphanum2', 'a.', 1, { code: `${P}:5757`, fix: 'medium' }));
  out.push(listItem(c, 'r02-n3', 'Numbered level 3 (i.)', 'alphanum3', 'i.', 2, { code: `${P}:5757`, fix: 'medium' }));
  const ed = c.cap.blocks.find((b) => b.items && /alphabullet1/.test(b.text));
  out.push(K('r02-bullet-type', 'A bullet list is a bullet list', 'bulleted list', ed && ed.tag === 'ul' ? R.pass('ul') : R.wrong('shown as a NUMBERED list element (ol) although the markers are bullets'), { code: `${P}:5757`, fix: 'small' }));
  const t = c.model.find((b) => b.type === 'table' && JSON.stringify(b).includes('alphaSpanHead'));
  out.push(K('r02-hspan', 'Merged cells across (\\clmgf / \\clmrg)', 'one heading spanning the columns', t && t.headers[1] === '' ? R.partial('empty header cell for the merged position; span lost') : R.pass(''), { fix: 'large' }));
  out.push(K('r02-vspan', 'Merged cells down (\\clvmgf / \\clvmrg)', 'spanning', t && t.rows[1] && t.rows[1][0] === '' ? R.partial('continued cell is empty; span lost') : R.pass(''), { fix: 'large' }));
  out.push(K('r02-cellfmt', 'Bold and italic in a table cell', 'kept', /"tf":4/.test(JSON.stringify(t)) ? R.pass('kept') : R.lost(''), {}));
  const nest = c.model.find((b) => b.type === 'table' && JSON.stringify(b).includes('alphaOuter1'));
  out.push(K('r02-nested', 'Nested table (\\itap2, \\nestcell)', 'inner cells kept in order', nestedFollows(c) ? R.pass('outer table keeps "(table follows)"; the inner table follows as a table (IMP-W6)') : nest && JSON.stringify(nest).includes('alphaInner1') ? R.pass('kept') : R.wrong('the inner cells end up BEFORE the table as one paragraph "alphaInner1alphaInner2" (no space), and the outer table is left with its first cell only and no rows'), { code: `${P}:5679-5699 case 'cell' / 'row' (itap and nestcell are not read)`, fix: 'medium' }));
  out.push(keep(c, 'r02-last', 'Paragraph after the tables', 'alphalast'));
  return out;
});

add('r03-notes-images', 'rtf', 'rtf/r03-notes-images.rtf', (c) => {
  const out = [];
  out.push(keep(c, 'r03-fn', 'Footnote (\\footnote)', 'alphafootnoteone')); out.push(keep(c, 'r03-en', 'Endnote (\\footnote \\ftnalt)', 'alphaendnoteone'));
  out.push(K('r03-image', 'Embedded picture (\\pict \\pngblip)', 'picture kept with an alt/description', c.model.some((b) => b.type === 'graphic') ? R.pass('image') : R.lost('the picture is dropped silently: no graphic block, nothing in the saved file, no notice (only the word "alphaimage" survives)'), { code: `${P}:5447 findPictureInGroup, :5754 handlePicture (hand-written RTF; compare lo-w13-images-rtf)`, fix: 'medium', seen: 'data' }));
  out.push(K('r03-shape-alt', 'Shape with description (wzDescription)', 'alt text kept', c.edHas('alphashapealt') ? R.pass('kept') : R.lost('dropped; the shape is lost entirely'), { fix: 'medium' }));
  out.push(K('r03-math', 'Word equation (\\mmath)', 'equation kept', c.model.some((b) => JSON.stringify(b).includes('"type":"math"')) ? R.pass('math') : R.lost('the equation is dropped (this hand-written \\mmath may not match every Word variant; LibreOffice-written RTF equations: see the lo-w14 fixture)'), { code: `${P}:5552 handleMath`, fix: 'small', seen: 'data' }));
  out.push(K('r03-fields', 'PAGE and DATE fields', 'field result or nothing', c.edHas('page 7') ? R.partial('the stored field result is frozen into the text') : R.pass(''), { fix: 'small' }));
  out.push(absent(c, 'r03-header', 'Running header', 'alphaheader')); out.push(absent(c, 'r03-footer', 'Running footer', 'alphafooter'));
  return out;
});

// ============================================================================ ODT
const OD = `${P}:6330 parseOdt`;
add('o01-inline', 'odt', 'odt/o01-inline.odt', (c) => {
  const out = [];
  out.push(K('o01-title', 'Title / Subtitle styles', 'title, subtitle not a chapter', c.subtitleInTitle('alphatitle', 'alphasubtitle') ? R.pass('the second line of the title heading (IMP-W1)') : c.modelBlock('alphasubtitle') && c.modelBlock('alphasubtitle').type === 'heading' ? R.wrong('Subtitle is a heading') : R.pass('Title = heading 1; Subtitle = ordinary paragraph (better than Word)'), {}));
  for (let n = 1; n <= 6; n++) { const b = c.modelBlock('alphah' + n); out.push(K('o01-h' + n, `Heading ${n}`, `level ${n}`, b && b.type === 'heading' && b.level === n ? R.pass('ok') : R.wrong(JSON.stringify(b)), {})); }
  out.push(emph(c, 'o01-bold', 'bold', 'alphabold', 'bold')); out.push(emph(c, 'o01-italic', 'italic', 'alphaitalic', 'italic')); out.push(emph(c, 'o01-under', 'underline', 'alphaunder', 'underline'));
  out.push(emph(c, 'o01-strong', 'Strong Emphasis character style', 'alphastrongstyle', 'bold')); out.push(emph(c, 'o01-emph', 'Emphasis character style', 'alphaemphstyle', 'italic'));
  out.push(emph(c, 'o01-udbl', 'double / dotted underline', 'alphadouble', 'underline'));
  out.push(emph(c, 'o01-strike', 'strikethrough', 'alphastrike', 'strike')); out.push(emph(c, 'o01-dstrike', 'double strikethrough', 'alphadstrike', 'strike'));
  out.push(...scriptChecks(c, 'o01', 'alphasubword', 'alphasupword', { code: `${P}:6244 odtInlineSegments (style:text-position never read)`, fix: 'small' }));
  out.push(K('o01-caps', 'Small caps / uppercase text style', 'capitals', c.edHas('ALPHASMALLCAPS') ? R.pass('capitals') : R.lost('not upper-cased (the .docx reader upper-cases w:caps / w:smallCaps)'), { code: `${P}:6244 odtInlineSegments`, fix: 'small' }));
  out.push(absent(c, 'o01-hidden', 'Hidden text (text:display="none")', 'alphahidden', { code: `${P}:6244`, fix: 'small' }));
  out.push(K('o01-scriptfont', 'Script font', 'script typeform', c.seg('alphascriptfont') && (c.seg('alphascriptfont').tf & 8) ? R.pass('script') : R.lost('plain'), { fix: 'small' }));
  out.push(K('o01-spaces', 'text:s repeated spaces / tab / line break', 'one space / space / break', c.edHas('alphaline line two. Tab: left right alphatab. Spaces: alphaspaces') ? R.pass('ok') : R.wrong(''), {}));
  out.push(K('o01-lang', 'Language (fo:language fr)', 'recorded', c.seg('alphafrench') && c.seg('alphafrench').lang === 'fr' ? R.partial('recorded; braille unchanged') : R.lost(''), { fix: 'large' }));
  const l = c.seg('alphalink'); const li = c.seg('alphainternal');
  out.push(K('o01-link', 'External hyperlink', 'address kept', l && l.href ? R.pass(l.href) : R.lost(''), {}));
  out.push(K('o01-link-int', 'Internal link to a bookmark', 'link kept', li && li.href ? R.pass('href ' + li.href) : R.partial('text underlined, target dropped'), {}));
  out.push(keep(c, 'o01-bookmark', 'Bookmark and cross-reference field', 'alphabookmarkref'));
  out.push(K('o01-fields', 'Page-number, date and sequence fields', 'stored value or nothing', c.edHas('page 7') ? R.partial('stored field values frozen into the text ("page 7", "30/09/2026")') : R.pass(''), { fix: 'small' }));
  out.push(K('o01-align', 'Centred / right / indented paragraphs', 'centred', c.modelIndex('alphacentre') >= 0 || c.edHas('alphacentre') ? R.pass('not reproduced, as Paul decided (IMP-W8: alignment of body text is not reproduced); the text is kept as an ordinary paragraph') : R.lost('text lost'), { fix: 'medium' }));
  out.push(K('o01-quote', 'Quotations paragraph style', 'block quotation', c.modelBlock('alphaquotation').style === 'quote' ? R.pass('quote') : R.lost('plain paragraph (the .docx reader recognises Quote / Intense Quote)'), { code: `${P}:6461 (no quote-style test in parseOdt)`, fix: 'small' }));
  out.push(K('o01-pre', 'Preformatted Text style', 'code', c.modelBlock('alphapre').type === 'code' ? R.pass('code') : R.partial('plain paragraph'), { fix: 'small' }));
  out.push(K('o01-box', 'Paragraph with a border (fo:border)', 'braille box', c.modelBlock('alphaboxed') && /box|sidebar/.test(c.modelBlock('alphaboxed').type) ? R.pass('box') : R.lost('no box (the .docx reader makes a box for w:pBdr)'), { code: `${P}:5910 odtFrameBoxInfo (frames only)`, fix: 'small' }));
  out.push(keep(c, 'o01-rtl', 'Right-to-left writing mode paragraph', 'alphartl'));
  out.push(keep(c, 'o01-fn', 'Footnote', 'alphafootnoteone')); out.push(keep(c, 'o01-en', 'Endnote', 'alphaendnoteone'));
  out.push(K('o01-comment', 'Comment (office:annotation)', 'not transcribed', c.edHas('Comment body alphacommentbody') || c.edHas('Reviewer2026') ? R.wrong('the comment is transcribed INTO the paragraph, with its author and date and no separators: "Comment Reviewer2026-09-30T10:00:00Comment body alphacommentbodyanchor alphacommentanchor end."') : R.pass('dropped'), { code: `${P}:6244 odtInlineSegments / 5829 getOdtText (office:annotation text included)`, fix: 'small', seen: 'data' }));
  out.push(absent(c, 'o01-deleted', 'Tracked deletion (text:deletion)', 'alphadeleted', { code: `${P}:6330 parseOdt (deletion content read as a paragraph)`, fix: 'small' }));
  out.push(keep(c, 'o01-inserted', 'Tracked insertion', 'alphainserted'));
  out.push(K('o01-toc', 'Table of contents', 'a contents list', c.model.some((b) => b.type === 'list' && /alphatoc1/.test(JSON.stringify(b))) ? R.pass('list') : R.partial('flattened to ordinary paragraphs ("Contents", "Heading alphatoc1 3"); the .docx reader makes a contents list with leaders'), { fix: 'small' }));
  out.push(K('o01-ruby', 'Ruby (text:ruby)', 'base kept, guide dropped', c.edHas('basealpharuby') ? R.wrong('guide glued to the base: "basealpharuby"') : R.pass(''), { code: `${P}:6244`, fix: 'small' }));
  out.push(K('o01-metadata', 'meta.xml title', 'document title', /<doctitle>Audit ODT inline/.test(c.xml) ? R.pass('title') : R.partial(`title "${(/<doctitle>([^<]*)/.exec(c.xml) || [])[1]}" (first Title paragraph wins over the metadata title)`), {}));
  return out;
});

add('o02-lists-tables', 'odt', 'odt/o02-lists-tables.odt', (c) => {
  const out = [];
  out.push(listItem(c, 'o02-b2', 'Bullets level 2', 'alphaB2', '•', 1));
  const n1 = itemOf(c, 'alphaN1');
  out.push(K('o02-numbers', 'Numbered list (text:list-level-style-number)', 'numbers 1. a. i.', n1 && n1.marker ? R.pass(n1.marker) : R.lost('NUMBERS LOST: every numbered list comes in as a BULLET list (no marker on the items, no "ordered" flag); the same happens with LibreOffice-written files (lo-w08). Looked at on screen: bullets where 1. 2. 3. should be.'), { code: `${P}:6385 odtListIsBullet / 6396 parseOdtList (no number marker) and :6548 (list block never ordered)`, fix: 'medium', seen: 'screen' }));
  const s5a = itemOf(c, 'alphastart5a'), s5b = itemOf(c, 'alphastart5b');   // was a fixed LOST, written before D9 read start values
  out.push(K('o02-start', 'text:start-value on a list item', 'starts at 5', s5a && s5a.marker === '5.' && s5b && s5b.marker === '6.' ? R.pass('5. then 6.') : R.lost(`markers ${JSON.stringify([s5a && s5a.marker, s5b && s5b.marker])}`), { code: `${P}:6396`, fix: 'medium' }));
  const mp = itemOf(c, 'alphamulti1');
  out.push(K('o02-multipara', 'Two paragraphs in one list item', 'both kept in the item', mp && mp.blocks ? R.pass('item.blocks') : R.wrong(''), {}));
  const tt = c.model.find((b) => b.type === 'table' && JSON.stringify(b).includes('alphaSpanHead'));
  out.push(K('o02-hspan', 'Column span (number-columns-spanned + covered cell)', 'one heading over the columns', tt && tt.rows[0][1] === '' ? R.partial('empty covered cell; span lost') : R.pass(''), { fix: 'large' }));
  out.push(K('o02-header-first', 'First row as header when not in table:table-header-rows', 'header row', tt && tt.headers.length === 0 ? R.partial('no header row: the spanned "heading" row is an ordinary first data row (only table-header-rows count)') : R.pass(''), { fix: 'small' }));
  const t2 = c.model.find((b) => b.type === 'table' && JSON.stringify(b).includes('alphaR1'));
  out.push(K('o02-header-rows', 'table:table-header-rows', 'header row', t2 && t2.headers.length === 2 ? R.pass('ok') : R.wrong(''), {}));
  const nest = c.model.find((b) => b.type === 'table' && JSON.stringify(b).includes('alphaInner1'));
  out.push(K('o02-nested', 'Nested table', 'kept as a table, or cells kept in order', nestedFollows(c) ? R.pass('outer table keeps "(table follows)"; the inner table follows as a table (IMP-W6)') : nest && /alphaInner1 alphaInner2/.test(JSON.stringify(nest)) ? R.partial('the inner table is flattened into ONE cell of the outer table ("alphaInner1 alphaInner2")') : R.wrong(''), { fix: 'large' }));
  out.push(K('o02-cell-blocks', 'List and paragraphs inside a cell', 'kept apart', /alphacellbullet1 alphacellbullet2/.test(c.modelJson) ? R.pass('joined with a space') : R.wrong(''), {}));
  out.push(K('o02-caption', 'Caption paragraph after a table', 'table caption', c.model.some((b) => b.type === 'caption') || c.edHas('alphacaption') ? R.partial('kept as an ordinary paragraph under the table, not joined to it') : R.lost(''), { fix: 'small' }));
  return out;
});

add('o03-objects', 'odt', 'odt/o03-objects.odt', (c) => {
  const out = [];
  const g = c.model.filter((b) => b.type === 'graphic');
  out.push(K('o03-alt', 'Image with svg:title and svg:desc', 'description kept', g[0] && /alphaaltdesc|alphaalttitle/.test(JSON.stringify(g[0])) ? R.pass(JSON.stringify({ alt: g[0].alt, description: g[0].description })) : R.lost(''), {}));
  out.push(K('o03-noalt', 'Image with NO alt text', 'flagged (or decorative)', g[1] && g[1].alt === 'Image2' ? R.wrong('the frame NAME ("Image2") becomes the alt text and is transcribed as the description; every LibreOffice picture without alt text gets such a name') : R.pass(''), { code: `${P}:6043-6051 ODT image reader (alt: title || draw:name)`, fix: 'small', seen: 'screen' }));
  out.push(keep(c, 'o03-textbox', 'Text box (draw:text-box)', 'alphatextbox'));
  out.push(K('o03-formula', 'Embedded formula object', 'equation', c.model.some((b) => JSON.stringify(b).includes('"type":"math"')) ? R.pass('math') : R.lost(''), { code: `${P}:5881 odtMathObjectToMathml`, fix: 'small' }));
  out.push(keep(c, 'o03-section', 'text:section content', 'alphasection'));
  out.push(keep(c, 'o03-caption', 'Figure caption paragraph', 'alphafigcaption'));
  return out;
});

// ============================================================================ EPUB
add('e01-basic', 'epub', 'epub/e01-basic.epub', (c) => {
  const out = [];
  out.push(keep(c, 'e01-ch1', 'Chapter 1 heading and text', 'alphach1')); out.push(keep(c, 'e01-ch2', 'Chapter 2 heading and text', 'alphasecond'));
  out.push(keep(c, 'e01-title', 'Title page (linear spine item)', 'alphatitlepage'));
  out.push(K('e01-cover', 'Cover page (spine item linear="no")', 'kept or reported as skipped', c.edHas('alphacover') ? R.pass('kept') : R.lost('not imported and not reported: the whole spine item "Cover alphacover" is skipped because linear="no"'), { code: `${P}:6685 parseEpub (if linear === no: continue) (linear="no" items skipped)`, fix: 'small' }));
  out.push(K('e01-notes-file', 'Endnotes chapter (spine item linear="no")', 'the notes text', c.edHas('alphaendnote') ? R.pass('kept') : R.lost('the endnotes file ("Notes alphanotes / Endnote alphaendnote") is skipped, so every EPUB 3 note kept in a non-linear notes document is missing from the braille'), { code: `${P}:6685 parseEpub (if linear === no: continue)`, fix: 'small', seen: 'data' }));
  out.push(emph(c, 'e01-bold', 'Bold / italic / underline / strike', 'alphabold', 'bold'));
  out.push(emph(c, 'e01-strike', 'Strikethrough (<s>)', 'alphastrike', 'strike'));
  out.push(...scriptChecks(c, 'e01', 'alphacsshidden', 'alphacsshidden').slice(0, 2));
  out.push(absent(c, 'e01-hidden', 'Text hidden by the book\'s CSS (.hidden {display:none})', 'alphacsshidden', { code: `${P}:6663 parseEpub (the package CSS is never read)`, fix: 'medium' }));
  out.push(listItem(c, 'e01-b2', 'Nested bullets level 2', 'alphaB2', '•', 1));
  const t = c.model.find((b) => b.type === 'table');
  out.push(K('e01-colspan', 'Table thead colspan', 'header aligned', t && t.headers.length === 1 && t.rows[0].length === 2 ? R.wrong('the header row has one cell for two columns (colspan not padded): the column headings no longer line up') : R.pass(''), { code: `${P}:1111-1118`, fix: 'small' }));
  out.push(K('e01-fig', 'Figure with alt and figcaption', 'image with caption', c.model.some((b) => b.type === 'graphic' && b.caption) ? R.pass('kept') : R.wrong(''), {}));
  out.push(K('e01-noalt', 'Image with no alt', 'flagged', c.warned('picture-no-description') ? R.pass('a transcription warning asks for a description (IMP-W12)') : R.partial('decorative, no warning'), { fix: 'small' }));
  out.push(K('e01-noteref', 'epub:type="noteref" link to a footnote', 'a real note reference and note', c.model.some((b) => b.type === 'footnote') ? R.pass('note') : R.wrong('a plain superscript "1" (with the empty-superscript marker problem, see the html findings), the note body (aside epub:type="footnote") becomes a BOX, nothing ties them together'), { code: `${P}:6663 parseEpub / parseHtml`, fix: 'medium' }));
  out.push(K('e01-pagebreak', 'epub:type="pagebreak" / doc-pagebreak', 'print page number kept as a page indicator', c.model.some((b) => b.type === 'pagenum') ? R.pass('pagenum') : R.wrong('the empty <span> marker disappears and the paragraph-form pagebreak ("2") stays in the text as a stray paragraph "2"; the print page numbers are not used'), { code: `${P}:6663; NIMAS pagenum support exists only for DTBook input`, fix: 'medium' }));
  out.push(K('e01-nav', 'nav.xhtml table of contents', 'used as the contents list', R.pass('ignored (Emboss builds its own contents)'), {}));
  const m = c.model.flatMap((b) => b.segments || []).find((s) => s.type === 'math');
  out.push(K('e01-math', 'MathML', 'kept', m ? R.pass('kept') : R.lost(''), {}));
  out.push(K('e01-lang', 'lang="fr" paragraph', 'recorded', c.seg('alphafrench') && c.seg('alphafrench').lang === 'fr' ? R.partial('recorded; braille unchanged') : R.lost(''), { fix: 'large' }));
  out.push(K('e01-meta', 'OPF metadata (title, creator, publisher, date, language)', 'used for the title page / running head', /<doctitle>Audit EPUB alphabooktitle/.test(c.xml) ? R.partial('title used; author, publisher and date are not carried into the saved file') : R.lost(''), { fix: 'small' }));
  return out;
});

// ============================================================================ DTBOOK / NIMAS
add('d01-features', 'dtbook', 'dtbook/d01-features.xml', (c) => {
  const out = [];
  out.push(K('d01-doctitle', 'doctitle', 'kept and used as the title', c.xmlHas('alphadoctitle') && c.brfHas('ALPHADOCTITLE') ? R.pass('in the saved XML and in the braille running head') : R.lost('missing'), {}));
  out.push(K('d01-docauthor', 'docauthor', 'kept', c.xmlHas('alphadocauthor') ? R.pass('saved') : R.lost('docauthor is not in the saved file'), { fix: 'small' }));
  out.push(emph(c, 'd01-em', '<em>', 'alphaem', 'italic')); out.push(emph(c, 'd01-strong', '<strong>', 'alphastrong', 'bold'));
  out.push(...scriptChecks(c, 'd01', 'alphaem', 'alphaem').slice(0, 1).map((k) => ({ ...k, id: 'd01-script', feature: '<sub> and <sup>' , code: `${P}:6759 parseDtbook inline handling (sub/sup read as plain text)`, expect: 'level kept', ev: c.cap.editorText.includes('2 2 alphacode') ? 'flattened: "H" is not in this fixture; the fixture paragraph reads "... alphastrong 2 2 alphacode": the two digits lose their sub/superscript level silently' : k.ev })));
  out.push(K('d01-code', '<code>', 'uncontracted', c.seg('alphacode') && c.seg('alphacode').uncontracted ? R.pass('ok') : R.lost(''), {}));
  out.push(K('d01-kbd', '<kbd>, <samp>, <q>, <dfn>, <abbr>', 'kept (q with its quote marks)', c.edHas('alphaq') && !/[“"]alphaq/.test(c.cap.editorText) ? R.partial('text kept; <q> adds no quotation marks') : R.pass(''), { fix: 'small' }));
  out.push(K('d01-lang', 'xml:lang span', 'recorded', c.seg('alphafrench') && c.seg('alphafrench').lang === 'fr' ? R.partial('recorded; braille unchanged') : R.lost(''), { fix: 'large' }));
  out.push(K('d01-link', '<a href>', 'address kept', c.xml.includes('href="https://example.org/alpha"') ? R.pass('saved') : R.lost(''), {}));
  out.push(K('d01-noteref', '<noteref> + <note>', 'note tied to its reference', c.xml.includes('<noteref idref="#n1"') && c.xmlHas('alphanotebody') ? R.pass('kept') : R.wrong(''), {}));
  out.push(K('d01-pagenum', '<pagenum> (print page numbers)', 'print page indicator', c.cap.blocks.some((b) => /PRINT PAGE/.test(b.text)) ? R.pass('print page widget') : R.lost(''), {}));
  out.push(K('d01-sidebar', '<sidebar render="required"> with <hd>', 'box with title', c.model.some((b) => /box|sidebar/.test(b.type) && JSON.stringify(b).includes('alphasidebarhd')) ? R.pass('box') : R.wrong(''), {}));
  out.push(keep(c, 'd01-prodreq', '<prodnote render="required">', 'alphaprodreq')); out.push(keep(c, 'd01-prodopt', '<prodnote render="optional">', 'alphaprodopt'));
  out.push(K('d01-bq-cite', '<blockquote> with <cite>', 'attribution kept', c.modelBlock('alphaquotecite') && c.modelBlock('alphaquotecite').type === 'attribution' ? R.pass('attribution') : R.wrong(''), {}));
  out.push(keep(c, 'd01-epigraph', '<epigraph>', 'alphaepigraph'));
  out.push(K('d01-poem', '<poem> title/author/linegroup/line', 'verse with stanza break', c.model.filter((b) => b.subtype === 'verse' || b.type === 'play').length >= 3 && c.model.some((b) => b.type === 'indicator') ? R.pass('verse lines + stanza break') : R.wrong(''), {}));
  out.push(K('d01-imggroup', '<imggroup> with caption and prodnote', 'image with caption and description', c.model.some((b) => b.type === 'graphic' && b.caption && b.description) ? R.pass('ok') : R.wrong(''), {}));
  out.push(K('d01-img-noalt', '<img alt="">', 'decorative', R.pass('decorative (flagged in the editor)'), {}));
  out.push(listItem(c, 'd01-ul', 'Nested <list type=ul> level 2', 'alphaB2', '•', 1));
  out.push(K('d01-ol-start', '<list type=ol start=3 enum=a>', 'c. d.', itemOf(c, 'alphaN3') && itemOf(c, 'alphaN3').marker === 'c.' ? R.pass('c.') : R.wrong(''), {}));
  out.push(K('d01-lic', '<lic> (list item components)', 'kept with separation', c.edHas('Left alphalic Right') ? R.pass('joined by a space') : R.wrong(''), {}));
  out.push(K('d01-table-colspan', '<th colspan=2> in thead', 'spanning heading', (() => { const t = c.model.find((b) => b.type === 'table'); return t && t.headers[0] === t.headers[1] ? R.partial('the heading text is REPEATED over each spanned column ("alphaSpanHead","alphaSpanHead") so the columns line up, but the braille reads it twice') : R.pass(''); })(), { fix: 'medium' }));
  out.push(K('d01-tfoot', '<tfoot>', 'last row', c.model.some((b) => b.type === 'table' && JSON.stringify(b).includes('alphatfoot')) ? R.pass('kept') : R.lost(''), {}));
  out.push(K('d01-table-caption', '<caption> on a table', 'caption', c.xmlHas('alphatcaption') ? R.pass('saved') : R.lost(''), {}));
  out.push(K('d01-math', 'MathML with altimg/alttext', 'maths kept, alttext not used as the content', c.model.flatMap((b) => b.segments || []).some((s) => s.type === 'math') ? R.partial('maths kept; the "latex" of the segment is the alttext "alphamathalt" (display-only, not used for braille)') : R.lost(''), { fix: 'small' }));
  out.push(K('d01-levels', 'level1 ... level6 nesting', 'all six levels', c.xml.includes('<level6>') ? R.pass('kept') : R.wrong(''), {}));
  out.push(keep(c, 'd01-bridgehead', '<bridgehead>', 'alphabridge')); out.push(keep(c, 'd01-div', '<div class>', 'alphadiv'));
  out.push(K('d01-glossary', 'rearmatter glossary <dl>', 'glossary list', c.model.some((b) => b.kind === 'glossary') ? R.pass('glossary') : R.wrong(''), {}));
  out.push(K('d01-dedication', 'Dedication level in frontmatter', 'kept', c.edHas('alphadedtext') ? R.pass('kept') : R.lost(''), {}));
  return out;
});

// ============================================================================ LibreOffice-written copies of the Word fixtures (ODT / RTF / legacy DOC)
// The same feature list as the Word files, same tokens. A result that differs from Word says where an importer is weaker than the .docx one;
// part of a difference can come from LibreOffice's own export (the harness cannot tell), which the report says.
function loChecks(kind, code) {
  const reuse = (docxId, deny = /^$/) => (c) => CHECKS[docxId](c).filter((k) => !/^generic|-script-|w00-/.test(k.id) && !deny.test(k.id)).map((k) => ({ ...k, id: `lo-${kind}-${k.id}`, code: code[k.id.replace(/^w\d+-/, '')] || (k.status === 'PASS' ? '' : (code._default || '')), seen: 'data' }));
  return reuse;
}
const LO = {
  odt: { _default: `${P}:6330 parseOdt`, numbers: `${P}:6385-6452 odtListIsBullet/parseOdtList + :6548` },
  rtf: { _default: `${P}:5094 parseRtf` },
  doc: { _default: 'input/doc.mjs' },
};
for (const kind of ['odt', 'rtf', 'doc']) {
  const mk = loChecks(kind, LO[kind]);
  const reg = (w, file, fn) => add(`lo-${w}-${kind}`, kind, `${kind}/lo-${file}.${kind}`, fn);
  reg('w02-inline', 'w02-inline', (c) => {
    const out = mk('w02-inline')(c).filter((k) => !/scriptfont|outline|mono/.test(k.id));
    out.push(...scriptChecks(c, `lo-${kind}-w02`, 'alphasubword', 'alphasupword', { code: kind === 'doc' ? 'input/doc.mjs:645-689 (writes the same markers as the .docx reader)' : kind === 'odt' ? `${P}:6244 odtInlineSegments (style:text-position never read)` : `${P}:5625-5665 (no \\sub / \\super in the character-property switch)`, fix: 'small' }));
    return out;
  });
  reg('w05-notes-comments', 'w05-notes-comments', (c) => [...mk('w05-notes-comments', /fn-ref|custom-mark/)(c),
    K(`lo-${kind}-w05-noteref`, 'Footnote and endnote reference marks', 'note references kept and tied to their notes', (c.xml.match(/<noteref /g) || []).length >= 3 ? R.pass(`${(c.xml.match(/<noteref /g) || []).length} noteref elements saved`) : R.wrong(`only ${(c.xml.match(/<noteref /g) || []).length} noteref element(s) for 4 notes`), { code: LO[kind]._default, fix: 'small' })]);
  reg('w08-lists', 'w08-lists', mk('w08-lists'));
  reg('w12-tables', 'w12-tables', mk('w12-tables', /cap-|complex|boldheader/));
  // (LibreOffice re-encodes the multi-character OMML runs of the Word fixture as <mtext>, so for .odt only the checks it does not disturb are kept)
  reg('w14-equations', 'w14-equations', mk('w14-equations', kind === 'odt' ? /^(?!w14-(frac|func-sin|func-log|delim|delim-tall|vec|matrix)$)/ : /^(?!w14-(frac|rad|func-sin|func-log|delim|delim-tall|vec|sum|int|matrix)$)/));
  // LibreOffice's .doc export keeps no picture descriptions and no caption link at all (checked in the file's bytes, and none come back
  // when LibreOffice itself converts it to .docx, D15): the pictures are there, their alt text and caption pairing are not in the file.
  reg('w13-images', 'w13-images', kind !== 'doc' ? mk('w13-images') : (c) => mk('w13-images')(c).map((k) => (/-(w13-alt|w13-float|w13-caption-join)$/.test(k.id) && k.status !== 'PASS' && c.model.filter((b) => b.type === 'graphic').length >= 3
    ? { ...k, ...R.partial(`the picture is kept, but LibreOffice's .doc holds no description${/caption/.test(k.id) ? ' and no caption link' : ''} for it (its export, not the reader; D15)`) } : k)));
  if (kind === 'doc') reg('w17-nested-lists', 'w17-nested-lists', mk('w17-nested-lists'));
}

// ============================================================================ REAL FILES (already in the repo): word-for-word comparison with an independent reader
// Reference text: macOS textutil (docx, odt, rtf, html, doc), the raw text (md), the xhtml parts (epub) or the tag-stripped XML (DTBook).
function refText(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  try {
    if (ext === 'md') return readFileSync(file, 'utf8').replace(/^```.*$/gm, ' ').replace(/\]\([^)]*\)/g, ']').replace(/^\[[^\]]+\]:.*$/gm, ' ').replace(/<[^>]+>/g, ' ');
    if (ext === 'xml') return readFileSync(file, 'utf8').replace(/<brl>[\s\S]*?<\/brl>/g, ' ').replace(/<[^>]+>/g, ' ');
    if (ext === 'epub') return execFileSync('unzip', ['-p', file, '*.xhtml', '*.html'], { maxBuffer: 1 << 28 }).toString('utf8').replace(/<head>[\s\S]*?<\/head>/g, ' ').replace(/<[^>]+>/g, ' ');
    return execFileSync('textutil', ['-convert', 'txt', '-stdout', file], { maxBuffer: 1 << 28 }).toString('utf8');
  } catch (e) { return null; }
}
const wordMap = (s) => { const m = new Map(); for (const w of (s.toLowerCase().match(/[a-z]{4,}/g) || [])) m.set(w, (m.get(w) || 0) + 1); return m; };
function wordLoss(c, id, feature) {
  const ref = refText(c.fx.file);
  if (ref == null) return [K(id, feature, 'every word of the file reaches the editor', R.partial('the reference reader could not open the file, not measured'), {})];
  const src = wordMap(ref.replace(/&[a-z]+;/g, ' ')), tgt = wordMap(c.cap.model.filter((b) => !(b.type === 'footnote' && /^(docx|odt|rtf|doc)$/.test(path.extname(c.fx.file).slice(1)))).flatMap((b) => leaves(b).filter((x) => x.type !== 'math' && x.inType !== 'math').map((x) => x.text)).join(' '));
  let total = 0, lost = 0, add = 0, tt = 0; const miss = [], extra = [];
  for (const [w, n] of src) { total += n; const t = tgt.get(w) || 0; if (t < n) { lost += n - t; miss.push([w, n - t]); } }
  for (const [w, n] of tgt) { tt += n; const s = src.get(w) || 0; if (n > s) { add += n - s; extra.push([w, n - s]); } }
  miss.sort((a, b) => b[1] - a[1]); extra.sort((a, b) => b[1] - a[1]);
  const pl = total ? (100 * lost / total) : 0, pa = tt ? (100 * add / tt) : 0;
  const ctxOf = (l) => l.slice(0, 2).map(([w]) => { const i = ref.toLowerCase().indexOf(w); return i < 0 ? "" : `"..${ref.slice(Math.max(0, i - 40), i + 50).replace(/\s+/g, " ")}.."`; }).join(" ");
  const top = (l) => l.slice(0, 12).map(([w, n]) => `${w}(${n})`).join(' ');
  return [
    K(id + '-lost', feature + ': words in the file missing from the editor', 'every word of the file (4+ letters) reaches the editor', pl < 0.3 ? R.pass(`${pl.toFixed(2)}% of ${total} words missing`) : pl < 2 ? R.partial(`${pl.toFixed(2)}% of ${total} words missing; most missing: ${top(miss)}; e.g. ${ctxOf(miss)}`) : R.lost(`${pl.toFixed(2)}% of ${total} words missing; most missing: ${top(miss)}; e.g. ${ctxOf(miss)}`), { seen: 'data' }),
    K(id + '-added', feature + ': words in the editor that are not in the file', 'nothing invented or duplicated', pa < 0.5 ? R.pass(`${pa.toFixed(2)}% of ${tt} editor words not in the file`) : pa < 3 ? R.partial(`${pa.toFixed(2)}% of ${tt} editor words are extra; most: ${top(extra)}`) : R.wrong(`${pa.toFixed(2)}% of ${tt} editor words are extra; most: ${top(extra)}`), { seen: 'data' }),
  ];
}
const REAL = path.join(EMBOSS, 'tests/real_samples');
const NIMAS = path.join(EMBOSS, 'tests/nimas_samples');
for (const [id, fmt, file] of [
  ['real-docx-probation', 'docx', `${REAL}/docx/statutory-guidance-probation-roles.docx`],
  ['real-docx-fungal', 'docx', `${REAL}/docx/fungal-skin-nail-infections-guidance.docx`],
  ['real-docx-framework', 'docx', `${REAL}/docx/template-framework-document-executive-agencies.docx`],
  ['real-odt-contract', 'odt', `${REAL}/odt/model-services-contract-core-terms.odt`],
  ['real-rtf-stadia', 'rtf', `${REAL}/rtf/inclusive-accessible-stadia-report.rtf`],
  ['real-rtf-patent', 'rtf', `${REAL}/rtf/patent-journal-special-notices-6946.rtf`],
  ['real-md-datatypes', 'md', `${REAL}/md/ch03-02-data-types.md`],
  ['real-md-vectors', 'md', `${REAL}/md/ch08-01-vectors.md`],
  ['real-md-syntax', 'md', `${REAL}/md/ch10-01-syntax.md`],
  ['real-dtbook-hauy', 'dtbook', `${NIMAS}/hauy_history_valid.xml`],
  ['real-dtbook-tables', 'dtbook', `${NIMAS}/TablesTestXml.xml`],
]) add(id, fmt, file, (c) => wordLoss(c, id, id.replace(/^real-/, 'real file ')));

for (const [dir, ext] of [['docx', 'docx'], ['html', 'html'], ['md', 'md'], ['rtf', 'rtf'], ['odt', 'odt'], ['epub', 'epub'], ['dtbook', 'xml'], ['doc', 'doc']]) {
  for (const f of readdirSync(path.join(FIX, dir)).filter((x) => x.endsWith('.' + ext)).sort()) {
    const id = f.replace(/\.[a-z]+$/, '') + (f.startsWith('lo-') ? '-' + ext : '');
    if (!CHECKS[id]) add(id, ext === 'xml' ? 'dtbook' : ext, dir + '/' + f, () => []);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
