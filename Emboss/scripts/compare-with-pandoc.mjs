// Emboss's document readers checked against Pandoc (Paul, 30 Sep 2026: "how do we know this import is feature
// complete?"). Pandoc is a widely used, well-tested converter; it is used here only as a TEST-TIME checker, never
// shipped. For each file both readers' results are reduced to the same inventory, and every place they disagree is
// listed:
//   words          every word of text, notes included (a word Pandoc finds that Emboss does not = lost text)
//   headings       level and text
//   list items     count, deepest nesting, numbered vs bulleted
//   tables         rows x columns
//   notes          footnotes and endnotes
//   equations      count (and Pandoc's LaTeX, for reference)
//   emphasis       bold, italic, underline, strikethrough, superscript, subscript: the words in each
//   links, images  link targets; image descriptions
// A difference is not automatically an Emboss bug — Pandoc has its own gaps and conventions (it never reads a Word
// text box, for one) — but each one is worth a look, and "words lost" nearly always is one.
//
// Usage: node Emboss/scripts/compare-with-pandoc.mjs [files...] [--json out.json] [--quiet]
//   With no files: every file Pandoc can read under tests/real_samples and tests/fixtures (docx, odt, rtf, html, md,
//   epub). Needs `pandoc` on the PATH (brew install pandoc). Exit code 0 always: this is a report, not a gate.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = globalThis.DOMParser || DOMParser;
const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parseFile } = await import(path.join(EMBOSS, 'input', 'parse.mjs'));

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const quiet = args.includes('--quiet');
const PANDOC_FORMAT = { docx: 'docx', odt: 'odt', rtf: 'rtf', html: 'html', htm: 'html', md: 'markdown', markdown: 'markdown', epub: 'epub' };

try { execFileSync('pandoc', ['--version'], { stdio: 'ignore' }); } catch { console.error('pandoc is not installed (brew install pandoc)'); process.exit(0); }

function defaultFiles() {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (PANDOC_FORMAT[path.extname(e.name).slice(1).toLowerCase()]) out.push(p);
    }
  };
  walk(path.join(EMBOSS, 'tests', 'real_samples'));
  walk(path.join(EMBOSS, 'tests', 'fixtures'));
  return out.sort();
}
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');
const list = files.length ? files.map((f) => path.resolve(f)) : defaultFiles();

// ---- the shared inventory ----
const words = (s) => (String(s || '').normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
const blankInventory = () => ({ paras: [], words: [], headings: [], items: [], tables: [], notes: [], math: [], emph: { bold: [], italic: [], underline: [], strike: [], sup: [], sub: [] }, links: [], images: [] });

// ---- Pandoc's JSON AST ----
function pandocInventory(file, fmt) {
  const json = execFileSync('pandoc', ['-f', fmt, '-t', 'json', '--track-changes=accept', file], { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
  const ast = JSON.parse(json);
  const inv = blankInventory();
  const inlineText = (xs) => {
    let t = '';
    for (const x of xs || []) {
      if (!x || typeof x !== 'object') continue;
      switch (x.t) {
        case 'Str': t += x.c; break;
        case 'Space': case 'SoftBreak': case 'LineBreak': t += ' '; break;
        case 'Code': t += x.c[1]; break;
        case 'Math': break;
        case 'Note': break;
        case 'RawInline': break;
        case 'Image': break;
        case 'Link': t += inlineText(x.c[1]); break;
        case 'Quoted': t += inlineText(x.c[1]); break;
        case 'Cite': t += inlineText(x.c[1]); break;
        case 'Span': t += inlineText(x.c[1]); break;
        default: if (Array.isArray(x.c)) t += inlineText(x.c); break;   // Strong, Emph, Underline, Strikeout, Superscript, Subscript, SmallCaps
      }
    }
    return t;
  };
  // A paragraph's words from its whole text: Pandoc splits a word into fragments wherever the formatting changes inside
  // it ("aut|hority"), which would show as lost words that are not lost.
  const blockWords = (xs) => { const t = inlineText(xs); inv.paras.push(t); inv.words.push(...words(t)); };
  const EMPH = { Strong: 'bold', Emph: 'italic', Underline: 'underline', Strikeout: 'strike', Superscript: 'sup', Subscript: 'sub' };
  const inlines = (xs) => {
    for (const x of xs || []) {
      if (!x || typeof x !== 'object') continue;
      if (x.t === 'Str' || x.t === 'Code') continue;   // words are counted per block (see blockWords), not per fragment
      else if (x.t === 'Math') inv.math.push(x.c[1]);
      else if (x.t === 'Note') { inv.notes.push(words(blocksText(x.c)).join(' ')); blocks(x.c); }
      else if (x.t === 'Image') inv.images.push(inlineText(x.c[1]).trim());
      else if (x.t === 'Link') { inv.links.push(x.c[2][0]); inlines(x.c[1]); }
      else if (EMPH[x.t]) { inv.emph[EMPH[x.t]].push(...words(inlineText(x.c))); inlines(x.c); }
      else if (x.t === 'Quoted' || x.t === 'Cite' || x.t === 'Span') inlines(x.c[1]);
      else if (x.t === 'SmallCaps') inlines(x.c);
    }
  };
  const blocksText = (bs) => (bs || []).map((b) => (b && (b.t === 'Para' || b.t === 'Plain' || b.t === 'Header')) ? inlineText(b.t === 'Header' ? b.c[2] : b.c) : '').join(' ');
  const listItems = (items, depth, ordered) => {
    for (const item of items) {
      inv.items.push({ depth, ordered, text: words(blocksText(item.filter((b) => b.t !== 'BulletList' && b.t !== 'OrderedList'))).join(' ') });
      for (const b of item) {
        if (b.t === 'BulletList') listItems(b.c, depth + 1, false);
        else if (b.t === 'OrderedList') listItems(b.c[1], depth + 1, true);
        else blocks([b]);
      }
    }
  };
  const cellBlocks = (cell) => cell[4];   // Cell: [attr, align, rowspan, colspan, blocks]
  const blocks = (bs) => {
    for (const b of bs || []) {
      if (!b || typeof b !== 'object') continue;
      switch (b.t) {
        case 'Para': case 'Plain': blockWords(b.c); inlines(b.c); break;
        case 'LineBlock': for (const l of b.c) { blockWords(l); inlines(l); } break;
        case 'Header': inv.headings.push({ level: b.c[0], text: words(inlineText(b.c[2])).join(' ') }); blockWords(b.c[2]); inlines(b.c[2]); break;
        case 'CodeBlock': inv.words.push(...words(b.c[1])); break;
        case 'BlockQuote': case 'Div': blocks(b.t === 'Div' ? b.c[1] : b.c); break;
        case 'BulletList': listItems(b.c, 0, false); break;
        case 'OrderedList': listItems(b.c[1], 0, true); break;
        case 'DefinitionList': for (const [term, defs] of b.c) { blockWords(term); inlines(term); for (const d of defs) blocks(d); } break;
        case 'Figure': blocks(b.c[2]); break;
        case 'Table': {
          const [, caption, colspecs, head, bodies, foot] = b.c;
          blocks(caption[1]);
          const rows = [...head[1], ...bodies.flatMap((body) => [...body[2], ...body[3]]), ...foot[1]];
          inv.tables.push({ rows: rows.length, cols: colspecs.length });
          for (const r of rows) for (const cell of r[1]) blocks(cellBlocks(cell));
          break;
        }
        default: break;
      }
    }
  };
  blocks(ast.blocks);
  return inv;
}

// ---- Emboss's document model ----
const TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4;
const SUB_OPEN = '\ue000', SUP_OPEN = '\ue001', SCRIPT_END = '\ue002';
async function embossInventory(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const buf = fs.readFileSync(file);
  const input = /^(html?|md|markdown|rtf)$/.test(ext) ? buf.toString('utf8') : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const model = await parseFile(path.basename(file), input);
  const inv = blankInventory();
  const segText = (segs) => (segs || []).filter((s) => s && (s.type === 'text' || s.type === undefined) && typeof s.text === 'string').map((s) => s.text).join('');
  const clean = (s) => String(s || '').replace(/[\ue000-\ue002]/g, '').replace(/\ue010/g, ' ');   // markers joined, as Pandoc's paragraph text is
  const scriptRuns = (s, open) => { const out = []; let i = 0; while ((i = s.indexOf(open, i)) >= 0) { const j = s.indexOf(SCRIPT_END, i + 1); out.push(s.slice(i + 1, j < 0 ? s.length : j)); i = i + 1; } return out; };
  const textOf = (o) => (o == null ? '' : typeof o === 'string' ? o : Array.isArray(o.segments) && o.segments.length ? segText(o.segments) : (o.text ?? (Array.isArray(o.lines) ? o.lines.join(' ') : '')));
  const addText = (o) => {
    if (o == null) return;
    if (typeof o === 'string') { inv.words.push(...words(clean(o))); for (const r of scriptRuns(o, SUP_OPEN)) inv.emph.sup.push(...words(r)); for (const r of scriptRuns(o, SUB_OPEN)) inv.emph.sub.push(...words(r)); return; }
    if (Array.isArray(o.segments) && o.segments.length) {
      // words from the paragraph's joined text (the same as Pandoc's side), everything else per segment
      inv.words.push(...words(clean(o.segments.filter((s) => s && !['math', 'noteref', 'pagenum', 'linenum', 'itemblock', 'imgnote'].includes(s.type)).map((s) => String(s.text || '')).join(''))));
      for (const s of o.segments) {
        if (!s) continue;
        if (s.type === 'math') { inv.math.push(s.latex || ''); continue; }
        if (s.type === 'noteref' || s.type === 'pagenum' || s.type === 'linenum' || s.type === 'itemblock') continue;
        if (s.type === 'imgnote') { inv.images.push(String(s.text || '').trim()); continue; }
        const t = String(s.text || '');
        const w = words(clean(t));
        if ((s.tf || 0) & TF_BOLD) inv.emph.bold.push(...w);
        if ((s.tf || 0) & TF_ITALIC) inv.emph.italic.push(...w);
        if ((s.tf || 0) & TF_UNDERLINE) inv.emph.underline.push(...w);
        if (s.transcriberTypeform === 'strike') inv.emph.strike.push(...w);
        if (s.href) inv.links.push(s.href);
        for (const r of scriptRuns(t, SUP_OPEN)) inv.emph.sup.push(...words(r));
        for (const r of scriptRuns(t, SUB_OPEN)) inv.emph.sub.push(...words(r));
      }
      return;
    }
    if (typeof o.text === 'string') addText(o.text);
    else if (Array.isArray(o.lines)) for (const l of o.lines) addText(typeof l === 'string' ? l : l && l.text);
    if (o.speaker) addText(o.speaker);
    if (o.speech) addText(o.speech);
  };
  const NOTE_TYPES = new Set(['footnote', 'note', 'endnote', 'rearnote', 'annotation']);
  const walkBlocks = (bs) => {
    for (const b of bs || []) {
      if (!b || typeof b !== 'object') continue;
      const type = b.type;
      if (type === 'pagenum' || type === 'break' || type === 'toc-marker') continue;
      if (type === 'math') { inv.math.push(b.latex || ''); continue; }
      if (type === 'graphic' || type === 'image' || type === 'imggroup') { if (b.alt) inv.images.push(String(b.alt).trim()); if (b.caption) addText(b.caption); if (Array.isArray(b.blocks)) walkBlocks(b.blocks); continue; }
      if (type === 'heading' || type === 'title') { inv.headings.push({ level: b.level || 1, text: words(clean(textOf(b))).join(' ') }); addText(b); continue; }
      if (NOTE_TYPES.has(type)) {
        const before = inv.words.length;
        if (Array.isArray(b.blocks) && b.blocks.length && !b.segments) walkBlocks(b.blocks); else addText(b);
        inv.notes.push(inv.words.slice(before).join(' '));
        continue;
      }
      if (type === 'list') {
        for (const it of b.items || []) {
          const marker = String(it.marker || '');
          inv.items.push({ depth: it.level || 0, ordered: /^[(\[]?([0-9]+|[a-z]|[ivxlcdm]+)[.)\]]?$/i.test(marker), text: words(clean(textOf(it))).join(' ') });
          addText(it);
          if (it.page != null && it.page !== '') addText(String(it.page));   // a contents entry's page number is kept as item.page
          if (Array.isArray(it.blocks)) walkBlocks(it.blocks);
        }
        continue;
      }
      if (type === 'table') {
        const rows = [...(Array.isArray(b.headers) && b.headers.length ? [b.headers] : []), ...(b.rows || [])];
        inv.tables.push({ rows: rows.length, cols: Math.max(0, ...rows.map((r) => (Array.isArray(r) ? r.length : 0))) });
        if (b.caption) addText(b.caption);
        if (b.title) addText(b.title);   // a table's caption is kept as its title
        for (const r of rows) for (const c of (Array.isArray(r) ? r : [])) addText(c);
        continue;
      }
      if (Array.isArray(b.blocks) && !b.segments && typeof b.text !== 'string') { if (b.title) addText(b.title); walkBlocks(b.blocks); continue; }
      addText(b);
      if (Array.isArray(b.blocks)) walkBlocks(b.blocks);
    }
  };
  if (model.title && !(model.blocks || []).some((b) => b && b.type === 'title')) { /* a metadata title is not body text */ }
  walkBlocks(model.blocks || []);
  return inv;
}

// ---- compare ----
const multiset = (arr) => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); return m; };
function minus(a, b) {   // what a has that b lacks, with counts
  const mb = multiset(b); const out = [];
  for (const [k, n] of multiset(a)) { const d = n - (mb.get(k) || 0); if (d > 0) out.push(d > 1 ? `${k}×${d}` : k); }
  return out;
}
function compare(p, e) {
  const issues = [];
  const lost = minus(p.words, e.words), extra = minus(e.words, p.words);
  const lostCount = p.words.length - e.words.length;
  if (lost.length) {
    // where they are: the first few Pandoc paragraphs holding a lost word
    const lostSet = new Set(lost.map((w) => w.replace(/×\d+$/, '')));
    const where = [];
    for (const t of p.paras) { if (where.length >= 4) break; if (words(t).some((w) => lostSet.has(w))) where.push(t.trim().slice(0, 140)); }
    issues.push({ kind: 'words lost', severity: 1, detail: `${lost.length} distinct word(s) Pandoc reads that Emboss does not: ${lost.slice(0, 40).join(', ')}${lost.length > 40 ? ', …' : ''}` + (where.length ? `\n        e.g. in: ${where.map((w) => `“${w}”`).join('\n                 ')}` : '') });
  }
  if (extra.length) issues.push({ kind: 'words added', severity: 3, detail: `${extra.length} distinct word(s) only Emboss has: ${extra.slice(0, 25).join(', ')}${extra.length > 25 ? ', …' : ''}` });
  const hp = p.headings.map((h) => `${h.level}:${h.text}`), he = e.headings.map((h) => `${h.level}:${h.text}`);
  const hl = minus(hp, he), ha = minus(he, hp);
  if (hl.length || ha.length) issues.push({ kind: 'headings', severity: 2, detail: `Pandoc ${p.headings.length}, Emboss ${e.headings.length}` + (hl.length ? `; only Pandoc: ${hl.slice(0, 8).join(' | ')}` : '') + (ha.length ? `; only Emboss: ${ha.slice(0, 8).join(' | ')}` : '') });
  const depth = (xs) => xs.reduce((m, x) => Math.max(m, x.depth), 0);
  if (p.items.length !== e.items.length || depth(p.items) !== depth(e.items)) issues.push({ kind: 'list items', severity: 2, detail: `Pandoc ${p.items.length} item(s), deepest level ${depth(p.items)}; Emboss ${e.items.length}, deepest ${depth(e.items)}` });
  const ordP = p.items.filter((x) => x.ordered).length, ordE = e.items.filter((x) => x.ordered).length;
  if (p.items.length === e.items.length && ordP !== ordE) issues.push({ kind: 'numbered lists', severity: 2, detail: `numbered items: Pandoc ${ordP}, Emboss ${ordE}` });
  const tp = p.tables.map((t) => `${t.rows}x${t.cols}`), te = e.tables.map((t) => `${t.rows}x${t.cols}`);
  if (tp.join() !== te.join()) issues.push({ kind: 'tables', severity: 2, detail: `Pandoc [${tp.join(', ')}], Emboss [${te.join(', ')}]` });
  if (p.notes.length !== e.notes.length) issues.push({ kind: 'notes', severity: 2, detail: `Pandoc ${p.notes.length}, Emboss ${e.notes.length}` });
  if (p.math.length !== e.math.length) issues.push({ kind: 'equations', severity: 1, detail: `Pandoc ${p.math.length}, Emboss ${e.math.length}` });
  else {
    // Equation by equation: a function name Pandoc reads as one (\cos) that Emboss has as plain text, and stretchy
    // brackets (\left … \right) that Emboss has as ordinary ones. Both change the braille (task A84).
    const FN = /\\(sin|cos|tan|sec|csc|cot|arcsin|arccos|arctan|sinh|cosh|tanh|log|ln|lg|exp|lim|max|min|sup|inf|det|gcd|arg|deg|dim|ker|Pr)(?![A-Za-z])/g;
    const notes = [];
    p.math.forEach((pm, k) => {
      const em = e.math[k] || '';
      const fns = [...new Set([...pm.matchAll(FN)].map((m) => m[1]))].filter((f) => !new RegExp(`\\\\(?:operatorname\\{)?${f}(?![A-Za-z])`).test(em));
      const stretchy = /\\left\b/.test(pm) && !/\\left\b/.test(em);
      if (fns.length || stretchy) notes.push(`#${k + 1}: ${fns.length ? `not read as functions: ${fns.join(', ')}` : ''}${fns.length && stretchy ? '; ' : ''}${stretchy ? 'stretchy brackets read as plain ones' : ''}`);
    });
    if (notes.length) issues.push({ kind: 'equation content', severity: 2, detail: notes.slice(0, 6).join(' | ') });
  }
  for (const k of Object.keys(p.emph)) {
    const l = minus(p.emph[k], e.emph[k]), a = minus(e.emph[k], p.emph[k]);
    if (l.length || a.length) issues.push({ kind: `${k}`, severity: 3, detail: `Pandoc ${p.emph[k].length} word(s), Emboss ${e.emph[k].length}` + (l.length ? `; not marked by Emboss: ${l.slice(0, 12).join(', ')}` : '') + (a.length ? `; only Emboss: ${a.slice(0, 12).join(', ')}` : '') });
  }
  const ll = minus(p.links, e.links);
  if (ll.length) issues.push({ kind: 'links', severity: 3, detail: `Pandoc ${p.links.length}, Emboss ${e.links.length}; not kept: ${ll.slice(0, 6).join(', ')}` });
  if (p.images.length !== e.images.length) issues.push({ kind: 'images', severity: 3, detail: `Pandoc ${p.images.length}, Emboss ${e.images.length}` });
  return { issues, wordsPandoc: p.words.length, wordsEmboss: e.words.length, lostCount };
}

const results = [];
for (const file of list) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const fmt = PANDOC_FORMAT[ext];
  const rel = path.relative(process.cwd(), file);
  let r;
  try {
    const p = pandocInventory(file, fmt);
    const e = await embossInventory(file);
    r = { file: rel, format: ext, ...compare(p, e) };
  } catch (err) {
    const msg = String(err && err.stderr || err && err.message || err);
    r = { file: rel, format: ext, error: /not a zip|Couldn't unpack|zip/i.test(msg) ? 'Pandoc cannot read it (not a real zip-based file: an old .doc renamed?)' : msg.split('\n')[0] };
  }
  results.push(r);
  if (!quiet) {
    if (r.error) { console.log(`\n■ ${rel}\n    could not compare: ${r.error}`); continue; }
    console.log(`\n■ ${rel}  (words: Pandoc ${r.wordsPandoc}, Emboss ${r.wordsEmboss})${r.issues.length ? '' : '  — no differences'}`);
    for (const i of r.issues.sort((a, b) => a.severity - b.severity)) console.log(`    ${i.kind}: ${i.detail}`);
  }
}
const withIssues = results.filter((r) => r.issues && r.issues.length);
const lostWords = results.filter((r) => r.issues && r.issues.some((i) => i.kind === 'words lost'));
console.log(`\n=== compare-with-pandoc: ${results.length} file(s); ${results.length - withIssues.length} with no differences; ${lostWords.length} where Emboss loses words; ${results.filter((r) => r.error).length} could not be compared ===`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2));
