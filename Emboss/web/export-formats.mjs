// Alternative saves of the editor's document: plain text, Markdown and HTML (S5d; audit 15 Oct 2026, "Dormant export APIs";
// Paul's decision E2: repair and test them rather than remove them).
//
// ONE traversal (buildExportDoc) turns the editor's block model (what buildModel() gives, after mergeListItemBlocks) into a small
// neutral tree; three serializers (exportToText, exportToMarkdown, exportToHtml) write that tree. Every block type the model has is
// handled in the traversal; a block whose type is not known is written from its text and counted in `warnings`
// (buildExportDoc(model).warnings), never dropped without a trace.
//
// FIDELITY POLICY (what each model type becomes; Emboss's own HTML and Markdown readers read the HTML and Markdown back, tests/s5d_exports.test.mjs)
//
//   model                    TXT                          MARKDOWN                              HTML
//   ------------------------ ---------------------------- ------------------------------------- ----------------------------------------
//   title (1-2 lines)        UPPERCASE, underlined ===    "# line" (read back as the title),    <h1 class="doc-title">, <br> between lines
//                                                         the next line in italics
//   heading 1-6              h1/h2 underlined, rest plain # .. ######                           <h1>..<h6> (inline structure kept)
//   paragraph                text                         text (emphasis, links, maths, notes)  <p>
//   emphasis/links/cite/lang dropped (text only)          ** * <u> ~~ <sub> <sup> [t](u) <cite> <strong> <em> <u> <s> <sub> <sup> <a> <cite>
//   code (own style)         indented                     fenced block, whitespace kept         <pre><code>
//   block quote              "> " lines                   "> " lines                            <blockquote>
//   list (bullet/numbered)   "*" / marker, indented       - / 1. nested by indentation          <ul>/<ol type start>, nested
//                                                         (a letter or roman marker becomes a number: Markdown has no other)
//   plain list (no marker)   indented lines               "-" bullets (the unmarked form is lost) <ul class="plain">
//   glossary list            "term - definition"          "- **term** — definition"             <dl><dt><dd>
//   item with only blocks    first block on the item line the first block on the marker's line  <li> holding the blocks
//   table + headers          tab-separated rows           pipe table (blank header if none)     <table><thead><tbody>, <caption>, colspan groups
//   table title / caption    lines above                  bold / italic lines above             <caption>
//   header groups            a row of the group names     "Group — header" in each header       a first <thead> row with colspan
//   box / sidebar            framed with "----"           one raw-HTML <aside class="box"> (read back as a box)  <aside class="box">
//   transcriber's note       [Note: ..]                   "> **Transcriber's note:** .."        <aside class="transcriber-note"> (read back as a box)
//   footnote / endnote       "[1] text" after its block   [^label] and [^label]: text           <a role="doc-noteref"> + <aside role="doc-footnote|endnote">
//   poem / verse drama       lines, blank between stanzas lines (two-space breaks)              <p class="poem|verse">line<br>line
//   print / production page  [Page 12]                    <span class="pagebreak">[Page 12]</span> (the reader keeps "[Page 12]" as text)
//                                                                                                <div role="doc-pagebreak" data-pagenum>
//   print line number        its digits                   <span class="linenum"> (dropped by the reader)  <span class="linenum">
//   picture / graphic        [Picture: alt] + caption     ![alt](src "caption") + description   <figure><img alt><figcaption>; the description is
//                                                         (a package picture is a data URI)     written for the page's reader (the HTML reader takes alt and caption)
//   maths                    $latex$                      $latex$ / $$latex$$                   MathML (the model's, else converted)
//   section break            * * *                        * * *                                 <hr>
//   transcriber pages        a section with its lines     a section with its lines              <section class="transcriber-...">
//                            (Transcriber's Notes, Special Symbols, an edited Title Page; an automatic Title Page is made by the
//                            braille formatter from the document's details and is not part of the text)
//
// Links and picture addresses are written only when safe (http, https, mailto, tel, ftp, a fragment, a relative path; a picture also
// as a PNG/JPEG/GIF/WebP/SVG data URI): never javascript:, data:text/html or the like. HTML escapes all text and the MathML is cleaned of
// script and event attributes.
//
// Nothing here uses the DOM: the module runs in the browser and in Node.

import { cellSegments } from '../format/cell-markup.mjs';
import { mathmlToLatex } from '../engine/mathml-to-latex.mjs';

const TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4;
// format/text-style.mjs SCRIPT_MARKS (kept equal by tests/s5d_exports.test.mjs): a sub/superscript run is bracketed in the text by these.
const SUB_OPEN = '', SUP_OPEN = '', SCRIPT_END = '';

// ---------------------------------------------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------------------------------------------
const isObj = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
const str = (x) => (x == null ? '' : String(x));
const isBulletMarker = (m) => typeof m === 'string' && m.length > 0 && m.length <= 2 && !/[\p{L}\p{N}]/u.test(m);
export function isOrderedList(b) {
  return !!(b && (b.ordered || (b.items || []).some((it) => it && it.marker && !isBulletMarker(it.marker))));
}

export const escapeHtml = (s) => str(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escapeAttr = (s) => str(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A link or picture address that can be written into a saved page: web, mail, a fragment, a relative path, a picture's data URI.
// javascript:, vbscript: and data:text/html are never written.
export function safeUrl(u, { image = false } = {}) {
  const s = str(u).trim();
  if (!s) return '';
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp)[;,]/i.test(s)) return image ? s : '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return /^(https?:|mailto:|tel:|ftp:)/i.test(s) ? s : '';
  return s;                                       // fragment, relative path
}

export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}
// A picture's address as a page can hold it: a data URI as is, a package picture (model.resources) embedded as a data URI.
function pictureHref(model, src) {
  const s = str(src);
  if (!s) return '';
  const res = (model && Array.isArray(model.resources) ? model.resources : []).find((r) => r && r.path === s && r.bytes);
  if (res) return `data:${/^image\/[a-z0-9.+-]+$/i.test(res.mime || '') ? res.mime : 'application/octet-stream'};base64,${bytesToBase64(res.bytes instanceof Uint8Array ? res.bytes : new Uint8Array(res.bytes))}`;
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// inline atoms: the segments of a paragraph, heading, list item or table cell, in one flat form every serializer reads
//   { k:'t', text, bold, italic, underline, strike, code, sub, sup, href, cite, lang }
//   { k:'math', latex, mathml } { k:'ref', mark, idref } { k:'linenum', text } { k:'imgnote', text, src } { k:'br' }
// ---------------------------------------------------------------------------------------------------------------------------------
function textAtoms(text, base, out) {
  // split a text on its script brackets and its line breaks
  let sub = false, sup = false, buf = '';
  const flush = () => { if (buf) { out.push({ k: 't', text: buf, ...base, ...(sub ? { sub: true } : {}), ...(sup ? { sup: true } : {}) }); buf = ''; } };
  for (const ch of str(text)) {
    if (ch === SUB_OPEN) { flush(); sub = true; sup = false; }
    else if (ch === SUP_OPEN) { flush(); sup = true; sub = false; }
    else if (ch === SCRIPT_END) { flush(); sub = sup = false; }
    else if (ch === '\n') { flush(); out.push({ k: 'br' }); }
    else buf += ch;
  }
  flush();
}
export function atomsOf(x) {
  const out = [];
  const segs = Array.isArray(x) ? x : (isObj(x) && Array.isArray(x.segments) && x.segments.length ? x.segments : null);
  if (!segs) {
    const text = isObj(x) ? (x.text != null ? x.text : '') : x;
    textAtoms(text, {}, out);
    return mergeAtoms(out);
  }
  for (const s of segs) {
    if (s == null) continue;
    if (typeof s === 'string') { textAtoms(s, {}, out); continue; }
    switch (s.type) {
      case 'math': out.push({ k: 'math', latex: str(s.latex), mathml: str(s.mathml) }); break;
      case 'noteref': out.push({ k: 'ref', mark: str(s.text), idref: str(s.idref) }); break;
      case 'linenum': out.push({ k: 'linenum', text: str(s.text) }); break;
      case 'imgnote': out.push({ k: 'imgnote', text: str(s.text), src: str(s.src) }); break;
      case 'gap': out.push({ k: 't', text: '  ' }); break;
      case 'brl': textAtoms(s.text || s.brl || '', {}, out); break;
      default: {
        const tf = Number(s.tf) || 0;
        const base = {
          ...(tf & TF_BOLD ? { bold: true } : {}), ...(tf & TF_ITALIC ? { italic: true } : {}), ...(tf & TF_UNDERLINE ? { underline: true } : {}),
          ...(s.transcriberTypeform === 'strike' ? { strike: true } : {}), ...(s.uncontracted ? { code: true } : {}),
          ...(s.href ? { href: str(s.href) } : {}), ...(s.cite ? { cite: true } : {}), ...(s.lang ? { lang: str(s.lang) } : {}),
        };
        textAtoms(s.text, base, out);
      }
    }
  }
  return mergeAtoms(out);
}
// neighbouring text atoms of one format are one atom (so "**a** **b**" is not "**a****b**")
function mergeAtoms(atoms) {
  const out = [];
  for (const a of atoms) {
    const p = out[out.length - 1];
    if (p && p.k === 't' && a.k === 't' && ['bold', 'italic', 'underline', 'strike', 'code', 'sub', 'sup', 'href', 'cite', 'lang'].every((f) => p[f] === a[f])) p.text += a.text;
    else out.push({ ...a });
  }
  return out;
}
const plainOf = (atoms) => atoms.map((a) => (a.k === 't' ? a.text : a.k === 'br' ? ' ' : a.k === 'math' ? (a.latex || '') : a.k === 'ref' ? '' : a.text || '')).join('');
const atomsEmpty = (atoms) => !atoms.some((a) => (a.k === 't' && a.text.trim()) || a.k === 'math' || a.k === 'imgnote' || a.k === 'linenum');
// LaTeX of an equation: the model's own, else converted from its MathML (one place, so every format agrees)
function latexOfMath(a) {
  if (a.latex) return a.latex;
  if (a.mathml) { try { return mathmlToLatex(a.mathml) || ''; } catch { return ''; } }
  return '';
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the traversal
// ---------------------------------------------------------------------------------------------------------------------------------
const POEM_PARA_TYPES = new Set(['verse', 'poem', 'poetry']);
const isVerseLine = (b) => b && b.type === 'play' && (b.subtype === 'verse' || b.style === 'verse' || b.style === 'poem');

export function buildExportDoc(model, opts = {}) {
  const warnings = [];
  const marks = new Map();      // note idref -> the mark the reader sees
  const collectMarks = (blocks) => {
    for (const b of blocks || []) {
      if (!b || typeof b !== 'object') continue;
      const look = (segs) => { for (const s of segs || []) if (s && s.type === 'noteref' && s.idref && !marks.has(s.idref)) marks.set(s.idref, str(s.text)); };
      look(b.segments);
      for (const it of b.items || []) { if (it) { look(it.segments); collectMarks(it.blocks); } }
      for (const row of [b.headers || [], ...(b.rows || [])]) if (Array.isArray(row)) for (const c of row) look(cellSegments(c));
      if (Array.isArray(b.blocks)) collectMarks(b.blocks);
    }
  };
  collectMarks(model && model.blocks);

  const paraTexts = (b) => {   // a block holding one text or several paragraphs (b.blocks)
    if (Array.isArray(b.blocks) && b.blocks.length && !b.text && !(b.segments && b.segments.length)) return b.blocks.map((x) => atomsOf(x)).filter((a) => !atomsEmpty(a));
    const a = atomsOf(b);
    return atomsEmpty(a) ? [] : [a];
  };

  function convert(blocks) {
    const out = [];
    let verse = null;     // the poem or verse drama being gathered: { k:'verse', stanzas:[[atoms]], poem }
    let quote = null;
    const flush = () => { verse = null; quote = null; };
    const list = Array.isArray(blocks) ? blocks : [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b || typeof b !== 'object') continue;
      const t = b.type;
      // --- verse (a poem's lines and its stanza breaks, verse drama)
      if (isVerseLine(b)) {
        const a = atomsOf(b);
        if (!verse) { verse = { k: 'verse', stanzas: [[]], poem: !!b.fromPoem }; out.push(verse); quote = null; }
        if (!atomsEmpty(a)) verse.stanzas[verse.stanzas.length - 1].push(a);
        continue;
      }
      if (verse && t === 'indicator' && b.fromPoem) { if (verse.stanzas[verse.stanzas.length - 1].length) verse.stanzas.push([]); continue; }
      if (verse && t === 'pagenum' && b.fromPoem) { /* a page turn inside a poem is written where the poem ends */ }
      if (POEM_PARA_TYPES.has(t)) {
        const lines = Array.isArray(b.lines) ? b.lines : str(b.text).split('\n');
        flush();
        out.push({ k: 'verse', stanzas: [lines.map((l) => atomsOf(l)).filter((a) => !atomsEmpty(a))], poem: true });
        continue;
      }
      verse = null;
      // --- block quotes: consecutive quoted paragraphs are one quotation
      if (t === 'para' && b.style === 'quote') {
        const a = atomsOf(b);
        if (atomsEmpty(a)) continue;
        if (!quote) { quote = { k: 'quote', paras: [] }; out.push(quote); }
        quote.paras.push(a);
        continue;
      }
      quote = null;
      switch (t) {
        case 'title': {
          const a = atomsOf(b);
          const lines = [[]];
          for (const x of a) { if (x.k === 'br') lines.push([]); else lines[lines.length - 1].push(x); }
          const ls = lines.filter((l) => !atomsEmpty(l));
          if (ls.length) out.push({ k: 'title', lines: ls });
          break;
        }
        case 'heading': {
          const a = atomsOf(b);
          if (atomsEmpty(a)) break;
          out.push({ k: 'heading', level: Math.max(1, Math.min(6, Number(b.level) || 1)), atoms: a, ...(b.poemRole === 'title' ? { poemTitle: true } : {}) });
          break;
        }
        case 'para': {
          const a = atomsOf(b);
          if (!atomsEmpty(a)) out.push({ k: 'p', atoms: a });
          break;
        }
        case 'code': {
          const text = str(b.text).replace(/\r\n?/g, '\n').replace(/\n+$/, '');
          if (text.trim()) out.push({ k: 'code', text });
          break;
        }
        case 'math': {
          if (b.latex || b.mathml) out.push({ k: 'math', latex: str(b.latex), mathml: str(b.mathml) });
          break;
        }
        case 'list': case 'glossary': {
          const n = convertList(b);
          if (n) out.push(n);
          break;
        }
        case 'table': {
          let pending = null;
          const prev = out[out.length - 1];
          if (prev && prev.k === 'p' && prev.cls === 'caption' && prev.pendingForTable) { pending = prev.atoms; out.pop(); }
          out.push(convertTable(b, pending));
          break;
        }
        case 'caption': {
          const a = atomsOf(b);
          if (atomsEmpty(a)) break;
          const nxt = list[i + 1];
          const prev = out[out.length - 1];
          if (nxt && nxt.type === 'table') out.push({ k: 'p', atoms: a, cls: 'caption', pendingForTable: true });
          else if (prev && prev.k === 'figure' && !prev.caption) prev.caption = a;
          else out.push({ k: 'p', atoms: a, cls: 'caption' });
          break;
        }
        case 'note': {
          const prev = out[out.length - 1];
          const paras = paraTexts(b);
          if (!paras.length) break;
          if (prev && prev.k === 'note' && b.noteGroup != null && prev.group === b.noteGroup) prev.paras.push(...paras);
          else out.push({ k: 'note', paras, kind: b.kind === 'tabletn' ? 'table' : 'transcriber', group: b.noteGroup != null ? b.noteGroup : undefined });
          break;
        }
        case 'footnote': {
          const paras = paraTexts(b);
          if (!paras.length) break;
          const prev = out[out.length - 1];
          if (b.noteCont && prev && prev.k === 'footnote' && prev.id === b.id) { prev.paras.push(...paras); break; }
          out.push({ k: 'footnote', id: str(b.id), kind: b.kind === 'endnote' ? 'endnote' : 'footnote', mark: marks.get(str(b.id)) || '', paras });
          break;
        }
        case 'attribution': case 'stage': case 'xref': {
          const a = atomsOf(b);
          if (!atomsEmpty(a)) out.push({ k: 'p', atoms: a, cls: t === 'xref' ? 'xref' : t });
          break;
        }
        case 'play': {                       // verse drama is gathered above; this is a speaker's line or a prose line
          const a = atomsOf(b);
          if (!atomsEmpty(a)) out.push({ k: 'p', atoms: a, cls: 'speech' });
          break;
        }
        case 'indicator': case 'break': case 'gap': case 'blank':
          if (t !== 'gap' && t !== 'blank') out.push({ k: 'rule' });
          break;
        case 'pagenum':
          out.push({ k: 'pagebreak', page: str(b.page != null && b.page !== '' ? b.page : b.text), pageType: str(b.pageType), id: str(b.id) });
          break;
        case 'graphic': case 'tactile': case 'image': {
          const caption = b.captionSegments ? atomsOf(b.captionSegments) : (b.caption ? atomsOf(str(b.caption)) : null);
          const descs = Array.isArray(b.descriptions) && b.descriptions.length ? b.descriptions : (b.description ? [b.description] : []);
          out.push({ k: 'figure', alt: str(b.alt || b.title), src: str(b.src), caption: caption && !atomsEmpty(caption) ? caption : null, descriptions: descs.map(str).filter((d) => d.trim()), decorative: !!b.decorative });
          break;
        }
        case 'box': case 'sidebar': {
          const kids = convert(b.blocks);
          const first = kids[0];
          const title = str(b.title).trim();
          // a box's title IS its first heading when it has one: not written twice
          const titleIsHeading = first && first.k === 'heading' && plainOf(first.atoms).trim() === title;
          if (!title && !kids.length) break;
          out.push({ k: 'box', title: title && !titleIsHeading ? atomsOf(title) : null, children: kids });
          break;
        }
        case 'tnpage': {
          const kids = [];
          for (const e of b.entries || []) {
            const a = atomsOf(e); if (!atomsEmpty(a)) kids.push({ k: 'p', atoms: a });
            for (const c of e && e.paragraphs ? e.paragraphs : []) { const ca = atomsOf(c); if (!atomsEmpty(ca)) kids.push({ k: 'p', atoms: ca }); }
          }
          if (b.heading || kids.length) out.push({ k: 'section', cls: 'transcriber-notes', title: atomsOf(str(b.heading || "Transcriber's Notes")), children: kids });
          break;
        }
        case 'sympage': {
          const items = b.auto ? (b._shown || []).map((s) => ({ atoms: atomsOf(str(s)), children: [] }))
            : (b.entries || []).map((e) => ({ atoms: atomsOf(`${e.braille || ''}${e.braille && (e.print || e.description) ? '  ' : ''}${e.print || ''}${e.print && e.description ? ' — ' : ''}${e.description || ''}`), children: [] }));
          if (items.length || b.heading) out.push({ k: 'section', cls: 'transcriber-symbols', title: atomsOf(str(b.heading || 'Special Symbols')), children: items.length ? [{ k: 'list', ordered: false, plain: true, items }] : [] });
          break;
        }
        case 'titlepage': {
          if (b.auto) break;                 // made from the document's details by the braille formatter: not part of the text
          const kids = [];
          for (const sg of b.segments || []) for (const ln of (sg && sg.lines) || []) {
            const text = (ln.parts || []).map((p) => (p.lit != null ? p.lit : p.value != null ? p.value : '')).join('');
            if (text.trim()) kids.push({ k: 'p', atoms: atomsOf(text) });
          }
          if (kids.length) out.push({ k: 'section', cls: 'transcriber-titlepage', title: null, children: kids });
          break;
        }
        default: {
          const paras = paraTexts(b);
          if (paras.length) { warnings.push(`block type "${t}" written as paragraphs`); for (const a of paras) out.push({ k: 'p', atoms: a }); }
          else if (Array.isArray(b.blocks) && b.blocks.length) { warnings.push(`block type "${t}" written as its contents`); out.push(...convert(b.blocks)); }
          else warnings.push(`block type "${t}" has no text and was left out`);
        }
      }
    }
    return out;
  }

  function convertList(b) {
    const glossary = b.type === 'glossary' || b.kind === 'glossary' || b.style === 'glossary';
    const items = (b.items || []).filter((it) => it && typeof it === 'object');
    const mk = (it) => {
      const node = { atoms: atomsOf(it), children: convert(it.blocks), level: Math.max(0, Number(it.level) || 0), marker: it.marker != null ? str(it.marker) : null, sub: [] };
      if (glossary && (it.term != null || it.termSegments)) {
        node.term = atomsOf({ text: it.term, segments: it.termSegments });
        node.def = atomsOf({ text: it.def, segments: it.defSegments });
        node.atoms = [];
      }
      if (it.page) { node.page = str(it.page); if (it.pageHref) node.pageHref = str(it.pageHref); }
      return node;
    };
    const flat = items.map(mk).filter((n) => !atomsEmpty(n.atoms) || (n.term && !atomsEmpty(n.term)) || n.children.length || n.page);
    if (!flat.length) return null;
    // nest by level: an item with a deeper level than the one before it opens a sub-list under that item
    const root = { k: 'list', glossary, ordered: false, plain: false, items: [] };
    const stack = [{ level: Math.min(...flat.map((n) => n.level)), list: root }];
    for (const n of flat) {
      let top = stack[stack.length - 1];
      while (stack.length > 1 && n.level < top.level) { stack.pop(); top = stack[stack.length - 1]; }
      const owner = top.list.items[top.list.items.length - 1];
      if (n.level > top.level && owner) {          // (an item deeper than the first one of its list has no item to sit under: it stays in the list)
        const sub = { k: 'list', glossary, ordered: false, plain: false, items: [] };
        owner.sub.push(sub);
        stack.push({ level: n.level, list: sub });
        top = stack[stack.length - 1];
      }
      top.list.items.push(n);
    }
    const classify = (l) => {
      const marked = l.items.filter((it) => it.marker != null && it.marker !== '');
      const numbered = marked.find((it) => !isBulletMarker(it.marker));
      l.ordered = !glossary && (!!numbered || (!!b.ordered && l === root && !marked.length));
      l.plain = !glossary && !l.ordered && !marked.length && !b.ordered && (b.kind === 'toc' || b.kind === 'index' || b.kind === 'plain' || items.every((it) => it.marker == null));
      if (l.ordered && numbered) l.markerSample = numbered.marker;
      for (const it of l.items) for (const s of it.sub) classify(s);
    };
    classify(root);
    return root;
  }

  function convertTable(b, pendingCaption) {
    const row = (cells) => (Array.isArray(cells) ? cells : []).map((c) => atomsOf(cellSegments(c)));
    const groups = Array.isArray(b.headerGroups) ? b.headerGroups.filter((g) => g && g.text != null && Number.isInteger(g.from) && Number.isInteger(g.to)) : [];
    return {
      k: 'table',
      title: b.title != null && String(b.title).trim() ? atomsOf(str(b.title)) : null,
      caption: pendingCaption || (b.caption ? atomsOf(typeof b.caption === 'string' ? b.caption : b.caption.text) : null),
      groups: groups.map((g) => ({ text: atomsOf(str(g.text)), from: g.from, to: g.to })),
      headers: row(b.headers),
      rows: (b.rows || []).map(row),
      note: b.tabletn != null && String(b.tabletn).trim() ? atomsOf(str(b.tabletn)) : null,
    };
  }

  const nodes = convert(model && model.blocks);
  const m = (model && model.metadata) || {};
  const author = str(m.creator || m.author || (Array.isArray(m.docauthors) ? m.docauthors.join(', ') : m.docauthor)).trim();
  const language = str(m.language || m.lang || (model && (model.language || model.lang))).trim();
  const title = str(model && model.title).trim() || str(opts.title).trim();
  return { title, author, language, publisher: str(m.publisher).trim(), nodes, warnings, marks, model };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// plain text
// ---------------------------------------------------------------------------------------------------------------------------------
function txtInline(atoms, ctx) {
  let s = '';
  for (const a of atoms) {
    if (a.k === 't') {
      if (a.sup) s += '^' + (/^\w+$/.test(a.text) ? a.text : `(${a.text})`);
      else if (a.sub) s += '_' + (/^\w+$/.test(a.text) ? a.text : `(${a.text})`);
      else s += a.text;
    } else if (a.k === 'br') s += '\n';
    else if (a.k === 'math') { const l = latexOfMath(a); s += l ? `$${l}$` : '[equation]'; }
    else if (a.k === 'ref') s += a.mark ? `[${a.mark}]` : '';
    else if (a.k === 'linenum') s += a.text;
    else if (a.k === 'imgnote') s += `[Picture: ${a.text}]`;
  }
  return s;
}
const indentLines = (text, pad) => text.split('\n').map((l) => (l ? pad + l : l)).join('\n');

export function exportToText(model, opts = {}) {
  const doc = buildExportDoc(model, opts);
  const chunks = [];
  const render = (nodes, depth = 0) => {
    const out = [];
    for (const n of nodes) {
      switch (n.k) {
        case 'title': {
          const lines = n.lines.map((l) => txtInline(l).replace(/\n/g, ' '));
          const first = lines[0].toUpperCase();
          out.push(`${first}\n${'='.repeat(Math.max(3, [...first].length))}${lines.length > 1 ? '\n' + lines.slice(1).join('\n') : ''}`);
          break;
        }
        case 'heading': {
          const t = txtInline(n.atoms).replace(/\n/g, ' ');
          out.push(n.level === 1 ? `${t.toUpperCase()}\n${'='.repeat(Math.max(3, [...t].length))}` : n.level === 2 ? `${t}\n${'-'.repeat(Math.max(3, [...t].length))}` : t);
          break;
        }
        case 'p': {
          const t = txtInline(n.atoms);
          out.push(n.cls === 'stage' ? `(${t})` : n.cls === 'caption' ? `[${t}]` : n.cls === 'attribution' ? `-- ${t}` : t);
          break;
        }
        case 'quote': out.push(n.paras.map((p) => indentLines(txtInline(p), '> ')).join('\n>\n')); break;
        case 'code': out.push(indentLines(n.text, '    ')); break;
        case 'math': { const l = latexOfMath(n); out.push(l ? `$$${l}$$` : '[equation]'); break; }
        case 'verse': out.push(n.stanzas.filter((s) => s.length).map((s) => s.map((l) => txtInline(l)).join('\n')).join('\n\n')); break;
        case 'rule': out.push('* * *'); break;
        case 'pagebreak': out.push(n.page ? `[Page ${n.page}]` : '[Page break]'); break;
        case 'list': out.push(txtList(n, 0, ctx0)); break;
        case 'table': {
          const rows = [];
          if (n.title) rows.push(txtInline(n.title).replace(/\n/g, ' '));
          if (n.caption) rows.push(txtInline(n.caption).replace(/\n/g, ' '));
          const cell = (c) => txtInline(c).replace(/\s*\n\s*/g, ' ').replace(/\t/g, ' ');
          if (n.groups.length) {
            const cols = Math.max(n.headers.length, ...n.rows.map((r) => r.length), 0);
            const g = Array(cols).fill('');
            for (const x of n.groups) for (let c = x.from; c <= Math.min(x.to, cols - 1); c++) g[c] = cell(x.text);
            rows.push(g.join('\t'));
          }
          if (n.headers.length) rows.push(n.headers.map(cell).join('\t'));
          for (const r of n.rows) rows.push(r.map(cell).join('\t'));
          if (n.note) rows.push(`[Note: ${txtInline(n.note).replace(/\n/g, ' ')}]`);
          out.push(rows.join('\n'));
          break;
        }
        case 'note': out.push(`[${n.kind === 'table' ? 'Table note' : 'Note'}: ${n.paras.map((p) => txtInline(p)).join(' ')}]`); break;
        case 'footnote': out.push(n.paras.map((p, i) => (i === 0 && n.mark ? `[${n.mark}] ` : n.mark ? '    ' : '') + txtInline(p)).join('\n')); break;
        case 'figure': {
          const bits = [`[Picture: ${n.alt || (n.decorative ? 'decorative' : 'no description')}]`];
          if (n.caption) bits.push(txtInline(n.caption));
          for (const d of n.descriptions) bits.push(d);
          out.push(bits.join('\n'));
          break;
        }
        case 'box': {
          const inner = render(n.children, depth + 1);
          const head = n.title ? txtInline(n.title) + '\n' : '';
          out.push(`----\n${head}${inner.join('\n\n')}\n----`);
          break;
        }
        case 'section': {
          const inner = n.children.map((c) => (c.k === 'list' ? txtList(c, 0, ctx0) : c.k === 'p' ? txtInline(c.atoms) : '')).filter(Boolean);
          out.push((n.title ? txtInline(n.title) + '\n' + '-'.repeat(3) + '\n' : '') + inner.join('\n'));
          break;
        }
      }
    }
    return out;
  };
  const ctx0 = {};
  function txtList(n, level, ctx) {
    const lines = [];
    let seq = 0;
    for (const it of n.items) {
      seq++;
      const bullet = n.glossary || n.plain ? '' : n.ordered ? `${it.marker && !isBulletMarker(it.marker) ? it.marker : seq + '.'} ` : '* ';
      const head = it.term ? `${txtInline(it.term)} - ${txtInline(it.def || [])}` : txtInline(it.atoms);
      const page = it.page ? ` ... ${it.page}` : '';
      const pad = '    '.repeat(level);
      const kids = it.children.map((c) => render([c]).join('\n\n')).filter(Boolean);
      const parts = [head + page, ...kids].filter((x, i) => i > 0 || x.trim());   // an item holding only blocks starts with its first block
      const inner = ' '.repeat(bullet.length);
      lines.push(indentLines(`${bullet}${parts.join('\n\n').replace(/\n/g, '\n' + inner)}`, pad));
      for (const s of it.sub) lines.push(txtList(s, level + 1, ctx));
    }
    return lines.join('\n');
  }
  chunks.push(...render(doc.nodes));
  return chunks.join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Markdown (CommonMark + GFM tables + footnotes + $maths$, which Emboss's own Markdown reader reads back)
// ---------------------------------------------------------------------------------------------------------------------------------
const mdEsc = (s) => s.replace(/[\\`*_\[\]<>$|~]/g, (c) => '\\' + c);
function mdLineStart(line) {
  // a line that would start a heading, list, quotation, rule or code block is escaped at its first character
  return line
    .replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3')
    .replace(/^(\s*)([-+])(\s|$)/, '$1\\$2$3')
    .replace(/^(\s*)(\d+)([.)])(\s|$)/, '$1$2\\$3$4')
    .replace(/^(\s*)(={2,}|-{2,})\s*$/, '$1\\$2')
    .replace(/^ {4,}/, (m) => '&#32;'.repeat(1) + m.slice(1));
}
function noteLabel(ctx, idref, fallbackIndex) {
  let l = ctx.labels.get(idref);
  if (!l) {
    const base = str(idref).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || `n${fallbackIndex}`;
    l = base; let k = 2;
    while (ctx.used.has(l)) l = `${base}-${k++}`;
    ctx.used.add(l); ctx.labels.set(idref, l);
  }
  return l;
}
function mdInline(atoms, ctx, { cell = false } = {}) {
  let s = '';
  for (const a of atoms) {
    if (a.k === 't') {
      let body = a.text;
      if (a.code) {
        const fence = '`'.repeat((Math.max(0, ...(body.match(/`+/g) || []).map((m) => m.length)) || 0) + 1);
        body = `${fence}${/^`|`$/.test(body) ? ' ' + body + ' ' : body}${fence}`;
      } else body = mdEsc(body);
      const lead = (/^\s+/.exec(a.text) || [''])[0], trail = (/\s+$/.exec(a.text) || [''])[0];
      const inner = a.code ? body : body.slice(lead.length ? lead.length : 0, body.length - trail.length);
      const open = (a.bold && a.italic ? '***' : a.bold ? '**' : a.italic ? '*' : '');
      let w = a.text.trim() ? (a.code ? body : `${open}${inner}${open}`) : mdEsc(a.text);
      if (a.text.trim() && !a.code) w = lead + w + trail;
      if (a.text.trim()) {
        if (a.underline) w = `<u>${w}</u>`;
        if (a.sub) w = `<sub>${w}</sub>`;
        if (a.sup) w = `<sup>${w}</sup>`;
        if (a.strike) w = `~~${w}~~`;
        if (a.cite) w = `<cite>${w}</cite>`;
        if (a.lang) w = `<span lang="${escapeAttr(a.lang)}">${w}</span>`;
        const href = safeUrl(a.href);
        if (href) w = `[${w}](${/[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, encodeURIComponent)}>` : href})`;
      }
      s += w;
    } else if (a.k === 'br') s += cell ? '<br>' : '  \n';
    else if (a.k === 'math') { const l = latexOfMath(a); s += l ? `$${l.replace(/\n/g, ' ')}$` : '[equation]'; }
    else if (a.k === 'ref') {
      if (ctx.noted.has(a.idref)) s += `[^${noteLabel(ctx, a.idref, ctx.labels.size + 1)}]`;
      else if (a.mark) s += `<sup>${mdEsc(a.mark)}</sup>`;
    } else if (a.k === 'linenum') s += `<span class="linenum">${mdEsc(a.text)}</span>`;
    else if (a.k === 'imgnote') s += `[Picture: ${mdEsc(a.text)}]`;
  }
  return s;
}
const mdBlockLines = (text) => text.split('\n').map((l) => mdLineStart(l)).join('\n');

export function exportToMarkdown(model, opts = {}) {
  const doc = buildExportDoc(model, opts);
  const ctx = { labels: new Map(), used: new Set(), noted: new Set() };
  const walkNotes = (nodes) => { for (const n of nodes) { if (n.k === 'footnote') ctx.noted.add(n.id); if (n.children) walkNotes(n.children); if (n.items) for (const it of n.items) walkNotes(it.children || []); } };
  walkNotes(doc.nodes);
  const q = (t) => (/^[\w .,'()&-]+$/.test(t) && !/^[\s-]|[:#]|^(true|false|null|yes|no)$/i.test(t) ? t : JSON.stringify(t));
  const front = [];
  // Emboss's Markdown reader makes the first "# " line the title when the front matter gives none; so a document that opens with its
  // title block writes it as that line (and no title: in the front matter, which would turn the line into an ordinary heading).
  const leadTitle = doc.nodes[0] && doc.nodes[0].k === 'title' && (!doc.title || plainOf(doc.nodes[0].lines[0]).trim() === doc.title.replace(/\s+/g, ' '));
  if (doc.title && !leadTitle) front.push(`title: ${q(doc.title.replace(/\s+/g, ' '))}`);
  if (doc.author) front.push(`author: ${q(doc.author)}`);
  if (doc.language) front.push(`lang: ${doc.language.replace(/[^A-Za-z-]/g, '')}`);
  const renderList = (n, indent) => {
    const lines = [];
    let seq = 0;
    for (const it of n.items) {
      seq++;
      const startNo = n.ordered && it.marker && /^\d+/.test(it.marker) ? parseInt(it.marker, 10) : null;
      if (n.ordered && seq === 1 && startNo != null) n.startAt = startNo;
      const marker = n.ordered ? `${(n.startAt || 1) + seq - 1}.` : '-';
      const head = it.term ? `**${mdInline(it.term, ctx)}** — ${mdInline(it.def || [], ctx)}` : mdInline(it.atoms, ctx);
      const page = it.page ? ` … ${it.pageHref && safeUrl(it.pageHref) ? `[${mdEsc(it.page)}](${safeUrl(it.pageHref)})` : mdEsc(it.page)}` : '';
      const pad = ' '.repeat(marker.length + 1);
      // an item holding only blocks begins with its first block, on the marker's line
      const parts = [head + page, ...it.children.map(renderBlock)].filter((x, i) => i > 0 || x.trim());
      lines.push(indent + `${marker} ${parts.join('\n\n').replace(/\n(?=.)/g, '\n' + pad).replace(/\n$/, '')}`.replace(/\n/g, '\n' + indent));
      for (const s of it.sub) lines.push(renderList(s, indent + pad));
    }
    return lines.join('\n');
  };
  const renderBlock = (n) => {
    switch (n.k) {
      case 'title': return n.lines.map((l, i) => (i === 0 ? `# ${mdInline(l, ctx).replace(/\s*\n\s*/g, ' ')}` : `*${mdInline(l, ctx)}*`)).join('\n\n');
      case 'heading': return `${'#'.repeat(n.level)} ${mdInline(n.atoms, ctx).replace(/\s*\n\s*/g, ' ').replace(/(\s)#+\s*$/, '$1\\#')}`;
      case 'p': {
        const t = mdBlockLines(mdInline(n.atoms, ctx));
        return n.cls === 'caption' ? `*${t.replace(/^\s+|\s+$/g, '')}*` : n.cls === 'stage' ? `*${t}*` : n.cls === 'attribution' ? `— ${t}` : t;
      }
      case 'quote': return n.paras.map((p) => mdBlockLines(mdInline(p, ctx)).split('\n').map((l) => `> ${l}`).join('\n')).join('\n>\n');
      case 'code': {
        const fence = '`'.repeat(Math.max(3, ...(n.text.match(/`+/g) || []).map((m) => m.length + 1)));
        return `${fence}\n${n.text}\n${fence}`;
      }
      case 'math': { const l = latexOfMath(n); return l ? `$$\n${l}\n$$` : '[equation]'; }
      case 'verse': return n.stanzas.filter((s) => s.length).map((s) => s.map((l) => mdBlockLines(mdInline(l, ctx))).join('  \n')).join('\n\n');
      case 'rule': return '* * *';
      case 'pagebreak': return `<span class="pagebreak" role="doc-pagebreak"${n.page ? ` title="${escapeAttr(n.page)}"` : ''}${n.id ? ` id="${escapeAttr(n.id)}"` : ''}>${n.page ? `[Page ${escapeHtml(n.page)}]` : '[Page break]'}</span>`;
      case 'list': return renderList(n, '');
      case 'table': {
        const cols = Math.max(n.headers.length, ...n.rows.map((r) => r.length), 1);
        const cell = (c) => (c ? mdInline(c, ctx, { cell: true }) : '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|') || ' ';
        let heads = Array.from({ length: cols }, (_, i) => n.headers[i]);
        if (n.groups.length) heads = heads.map((h, i) => {
          const g = n.groups.find((x) => i >= x.from && i <= x.to);
          return g ? [...g.text, { k: 't', text: ' — ' }, ...(h || [])] : h;
        });
        const hasHead = n.headers.length > 0;
        const lines = [];
        if (n.title) lines.push(`**${mdInline(n.title, ctx).replace(/\n/g, ' ')}**`, '');
        if (n.caption) lines.push(`*${mdInline(n.caption, ctx).replace(/\n/g, ' ')}*`, '');
        lines.push(`| ${heads.map((h) => (hasHead ? cell(h) : ' ')).join(' | ')} |`);
        lines.push(`| ${Array(cols).fill('---').join(' | ')} |`);
        for (const r of n.rows) lines.push(`| ${Array.from({ length: cols }, (_, i) => cell(r[i])).join(' | ')} |`);
        if (n.note) lines.push('', `> **Transcriber's note:** ${mdInline(n.note, ctx).replace(/\n/g, ' ')}`);
        return lines.join('\n');
      }
      case 'note': return n.paras.map((p, i) => `> ${i === 0 ? `**${n.kind === 'table' ? 'Table note' : "Transcriber's note"}:** ` : ''}${mdInline(p, ctx).replace(/\n/g, '\n> ')}`).join('\n>\n');
      case 'footnote': {
        const label = noteLabel(ctx, n.id, ctx.labels.size + 1);
        return n.paras.map((p, i) => (i === 0 ? `[^${label}]: ${mdInline(p, ctx).replace(/\n/g, '\n    ')}` : `    ${mdInline(p, ctx).replace(/\n/g, '\n    ')}`)).join('\n\n');
      }
      case 'figure': {
        const href = safeUrl(pictureHref(doc.model, n.src), { image: true });
        const cap = n.caption ? mdInline(n.caption, ctx).replace(/\n/g, ' ') : '';
        const img = `![${mdEsc(n.alt).replace(/\n/g, ' ')}](${href && /[\s()]/.test(href) ? `<${href}>` : href}${cap && !/"/.test(cap) ? ` "${plainOf(n.caption)}"` : ''})`;
        return [img, cap ? `*${cap}*` : '', ...n.descriptions.map((d) => `*Description: ${mdEsc(d)}*`)].filter(Boolean).join('\n\n');
      }
      case 'box': {
        // one raw-HTML block with no blank line in it (CommonMark ends an HTML block at a blank line): the contents are written in HTML,
        // which Emboss's Markdown reader reads back as a box with its title
        const w = htmlWriter(doc, opts, [n]);
        return w.renderBlock(n).replace(/\n\n+/g, (m) => '\n' + '&#10;\n'.repeat(m.length - 1));
      }
      case 'section': {
        const head = n.title ? `## ${mdInline(n.title, ctx).replace(/\n/g, ' ')}\n\n` : '';
        return head + n.children.map(renderBlock).join('\n\n');
      }
    }
    return '';
  };
  const body = doc.nodes.map(renderBlock).filter((x) => x !== '');
  // two lists side by side would read as one: a comment between them keeps them apart (CommonMark)
  const joined = [];
  body.forEach((b, i) => {
    if (i && doc.nodes[i].k === 'list' && doc.nodes[i - 1].k === 'list') joined.push('<!-- -->');
    joined.push(b);
  });
  return (front.length ? `---\n${front.join('\n')}\n---\n\n` : '') + joined.join('\n\n') + '\n';
}

// ---------------------------------------------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------------------------------------------
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
function cleanMathml(m) {
  let s = str(m).trim().replace(/^<\?xml[^>]*\?>\s*/i, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  if (!/^<(?:\w+:)?math\b/i.test(s)) return '';
  if (!/<math\b[^>]*\bxmlns\s*=/i.test(s)) s = s.replace(/^<math\b/i, `<math xmlns="${MATHML_NS}"`);
  // nothing active survives: no script, frame, style or foreign content, no event attribute, no link (MathML's own href)
  return s.replace(/<(script|iframe|object|embed|style|foreignObject|annotation-xml|annotation)\b[\s\S]*?<\/\1>/gi, '').replace(/<(script|iframe|object|embed|style|foreignObject)\b[^>]*\/>/gi, '')
    .replace(/\s(?:on\w+|(?:\w+:)?href|src)\s*=\s*("[^"]*"|'[^']*')/gi, '');
}
function htmlInline(atoms, ctx) {
  let s = '';
  for (const a of atoms) {
    if (a.k === 't') {
      let w = escapeHtml(a.text);
      if (!a.text.trim()) { s += w; continue; }
      if (a.code) w = `<code>${w}</code>`;
      if (a.bold) w = `<strong>${w}</strong>`;
      if (a.italic) w = `<em>${w}</em>`;
      if (a.underline) w = `<u>${w}</u>`;
      if (a.sub) w = `<sub>${w}</sub>`;
      if (a.sup) w = `<sup>${w}</sup>`;
      if (a.strike) w = `<s>${w}</s>`;
      if (a.cite) w = `<cite>${w}</cite>`;
      if (a.lang) w = `<span lang="${escapeAttr(a.lang)}">${w}</span>`;
      const href = safeUrl(a.href);
      if (href) w = `<a href="${escapeAttr(href)}">${w}</a>`;
      s += w;
    } else if (a.k === 'br') s += '<br>\n';   // (the newline keeps the words apart for a reader that takes only the text of a caption)
    else if (a.k === 'math') {
      let ml = cleanMathml(a.mathml);
      if (!ml && a.latex && ctx.opts.latexToMathml) { try { ml = cleanMathml(ctx.opts.latexToMathml(a.latex)); } catch { ml = ''; } }
      s += ml || `<span class="math-latex">${escapeHtml(a.latex ? `$${a.latex}$` : '[equation]')}</span>`;
    } else if (a.k === 'ref') {
      if (ctx.noted.has(a.idref)) s += `<a class="noteref" id="ref-${escapeAttr(ctx.ids.get(a.idref))}" href="#${escapeAttr(ctx.ids.get(a.idref))}" role="doc-noteref" epub:type="noteref"><sup>${escapeHtml(a.mark)}</sup></a>`;
      else if (a.mark) s += `<sup>${escapeHtml(a.mark)}</sup>`;
    } else if (a.k === 'linenum') s += `<span class="linenum">${escapeHtml(a.text)}</span>`;
    else if (a.k === 'imgnote') s += `<span class="image-note">[Picture: ${escapeHtml(a.text)}]</span>`;
  }
  return s;
}

// The HTML writer for a list of nodes (the whole document, or one box inside a Markdown file). Notes found in `nodes` are written as
// HTML notes; a reference to a note outside them is written as its mark.
function htmlWriter(doc, opts, nodes) {
  const ctx = { opts, noted: new Set(), ids: new Map() };
  const usedIds = new Set();
  const walkNotes = (nodes) => {
    for (const n of nodes) {
      if (n.k === 'footnote') {
        ctx.noted.add(n.id);
        let id = str(n.id).replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '') || `note-${ctx.ids.size + 1}`;
        if (!/^[A-Za-z]/.test(id)) id = 'n-' + id;
        let u = id, k = 2; while (usedIds.has(u)) u = `${id}-${k++}`;
        usedIds.add(u); ctx.ids.set(n.id, u);
      }
      if (n.children) walkNotes(n.children);
      if (n.items) { const w = (items) => { for (const it of items) { walkNotes(it.children || []); for (const s of it.sub || []) w(s.items); } }; w(n.items); }
    }
  };
  walkNotes(nodes);
  const I = (atoms) => htmlInline(atoms, ctx);
  const renderList = (n) => {
    if (n.glossary) {
      return `<dl>${n.items.map((it) => (it.term
        ? `<dt>${I(it.term)}</dt><dd>${I(it.def || [])}${it.children.map(renderBlock).join('')}</dd>`
        : `<dd>${I(it.atoms)}${it.children.map(renderBlock).join('')}</dd>`)).join('')}</dl>`;
    }
    let tag = n.ordered ? 'ol' : 'ul', attrs = '';
    if (n.ordered && n.markerSample) {
      const m = /^\(?([0-9]+|[a-z]+|[A-Z]+)[.)]?$/.exec(n.markerSample.trim());
      if (m) {
        const tok = m[1];
        if (/^\d+$/.test(tok)) { if (tok !== '1') attrs = ` start="${tok}"`; }
        else if (/^[ivxlcdm]+$/.test(tok) && tok.length > 1) attrs = ' type="i"';
        else if (/^[IVXLCDM]+$/.test(tok) && tok.length > 1) attrs = ' type="I"';
        else attrs = tok === tok.toLowerCase() ? ' type="a"' : ' type="A"';
        if (attrs.includes('type') && tok.length === 1 && /[a-zA-Z]/.test(tok)) {
          const off = tok.toLowerCase().charCodeAt(0) - 96;
          if (off > 1) attrs += ` start="${off}"`;
        }
      }
    }
    if (n.plain) attrs += ' class="plain"';
    return `<${tag}${attrs}>${n.items.map((it) => {
      const page = it.page ? ` <span class="page">${it.pageHref && safeUrl(it.pageHref) ? `<a href="${escapeAttr(safeUrl(it.pageHref))}">${escapeHtml(it.page)}</a>` : escapeHtml(it.page)}</span>` : '';
      return `<li>${I(it.atoms)}${page}${it.children.map(renderBlock).join('')}${it.sub.map(renderList).join('')}</li>`;
    }).join('')}</${tag}>`;
  };
  const renderBlock = (n) => {
    switch (n.k) {
      case 'title': return `<h1 class="doc-title">${n.lines.map(I).join('<br>')}</h1>`;
      case 'heading': return `<h${n.level}${n.poemTitle ? ' class="poem-title"' : ''}>${I(n.atoms)}</h${n.level}>`;
      case 'p': return `<p${n.cls ? ` class="${n.cls}"` : ''}>${I(n.atoms)}</p>`;
      case 'quote': return `<blockquote>${n.paras.map((p) => `<p>${I(p)}</p>`).join('')}</blockquote>`;
      case 'code': return `<pre><code>${escapeHtml(n.text)}</code></pre>`;
      case 'math': {
        const inner = I([{ k: 'math', latex: n.latex, mathml: n.mathml }]).replace(/^<math\b/, '<math display="block"');
        return `<div class="math-block">${inner}</div>`;
      }
      case 'verse': return n.stanzas.filter((s) => s.length).map((s) => `<p class="${n.poem ? 'poem' : 'verse'}">${s.map(I).join('<br>')}</p>`).join('');
      case 'rule': return '<hr>';
      case 'pagebreak': return `<div class="pagebreak" role="doc-pagebreak" epub:type="pagebreak"${n.page ? ` title="${escapeAttr(n.page)}" data-pagenum="${escapeAttr(n.page)}"` : ''}${n.id ? ` id="${escapeAttr(n.id)}"` : ''}></div>`;
      case 'list': return renderList(n);
      case 'table': {
        const cols = Math.max(n.headers.length, ...n.rows.map((r) => r.length), 0);
        const cap = [n.title, n.caption].filter(Boolean).map(I).join(' — ');
        let head = '';
        if (n.groups.length) {
          const cells = []; let c = 0;
          const sorted = [...n.groups].sort((a, b) => a.from - b.from);
          for (const g of sorted) {
            if (g.from > c) cells.push(`<th colspan="${g.from - c}"></th>`.replace(' colspan="1"', ''));
            cells.push(`<th scope="colgroup" colspan="${g.to - g.from + 1}">${I(g.text)}</th>`);
            c = g.to + 1;
          }
          if (c < cols) cells.push(`<th colspan="${cols - c}"></th>`);
          head += `<tr>${cells.join('')}</tr>`;
        }
        if (n.headers.length) head += `<tr>${n.headers.map((h) => `<th scope="col">${I(h)}</th>`).join('')}</tr>`;
        return `<table>${cap ? `<caption>${cap}</caption>` : ''}${head ? `<thead>${head}</thead>` : ''}<tbody>${n.rows.map((r) => `<tr>${r.map((c) => `<td>${I(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
          + (n.note ? `<aside class="transcriber-note"><p>${I(n.note)}</p></aside>` : '');
      }
      case 'note': return `<aside class="transcriber-note${n.kind === 'table' ? ' table-note' : ''}">${n.paras.map((p) => `<p>${I(p)}</p>`).join('')}</aside>`;
      case 'footnote': {
        const id = ctx.ids.get(n.id);
        const role = n.kind === 'endnote' ? 'doc-endnote' : 'doc-footnote';
        return `<aside id="${escapeAttr(id)}" class="${n.kind}" role="${role}" epub:type="${n.kind}">${n.paras.map((p, i) => `<p>${i === 0 && n.mark ? `<a class="backlink" href="#ref-${escapeAttr(id)}" role="doc-backlink" epub:type="backlink">${escapeHtml(n.mark)}</a> ` : ''}${I(p)}</p>`).join('')}</aside>`;
      }
      case 'figure': {
        const href = safeUrl(pictureHref(doc.model, n.src), { image: true });
        const cap = n.caption ? `<figcaption>${I(n.caption)}</figcaption>` : '';
        const img = href ? `<img src="${escapeAttr(href)}" alt="${escapeAttr(n.decorative && !n.alt ? '' : n.alt)}">` : `<span class="no-image">[Picture: ${escapeHtml(n.alt || 'no description')}]</span>`;
        return `<figure>${img}${cap}${n.descriptions.map((d) => `<p class="image-description">${escapeHtml(d)}</p>`).join('')}</figure>`;
      }
      case 'box': return `<aside class="box">${n.title ? `<p class="box-title"><strong>${I(n.title)}</strong></p>` : ''}${n.children.map(renderBlock).join('\n')}</aside>`;
      case 'section': return `<section class="${n.cls}">${n.title ? `<h2>${I(n.title)}</h2>` : ''}${n.children.map(renderBlock).join('\n')}</section>`;
    }
    return '';
  };
  return { renderBlock, I };
}

export function exportToHtml(model, opts = {}) {
  const doc = buildExportDoc(model, opts);
  const { renderBlock, I } = htmlWriter(doc, opts, doc.nodes);
  const lang = doc.language.replace(/[^A-Za-z-]/g, '') || 'en';
  const title = doc.title || 'Document';
  const css = 'body{font-family:system-ui,-apple-system,sans-serif;max-width:800px;margin:2rem auto;line-height:1.6;padding:0 1rem;}table{border-collapse:collapse;width:100%;margin:1rem 0;}th,td{border:1px solid #ccc;padding:8px;text-align:left;}th{background:#f4f5f8;}caption{font-weight:bold;text-align:left;}pre{background:#f8f9fa;padding:8px 12px;overflow:auto;}.transcriber-note,.box{background:#f8f9fa;border-left:4px solid #0284c7;padding:8px 16px;margin:1rem 0;}.poem,.verse{margin:1rem 0 1rem 1.5rem;}figure{margin:1rem 0;}img{max-width:100%;}.pagebreak::before{content:attr(title);color:#777;font-size:.8em;}ul.plain{list-style:none;padding-left:1.5rem;}';
  return `<!DOCTYPE html>\n<html lang="${escapeAttr(lang)}" xmlns:epub="http://www.idpf.org/2007/ops">\n<head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${doc.author ? `<meta name="author" content="${escapeAttr(doc.author)}">` : ''}${doc.publisher ? `<meta name="publisher" content="${escapeAttr(doc.publisher)}">` : ''}<style>${css}</style></head>\n<body>\n${doc.nodes.map(renderBlock).filter(Boolean).join('\n')}\n</body>\n</html>\n`;
}
