// Input parsers: various document formats -> the structured document model.
// Model: { title: string|null, blocks: [{type, ...}] }
//   types: title | heading{level} | para{text|segments} | list{items:[{text,level,marker}]}
//        | note{text} | math{mathml|latex}
// A `para` block carries EITHER a plain `text` string (the original,
// unchanged path) OR a `segments` array of
//   { type: 'text', text } | { type: 'math', mathml } | { type: 'math', latex }
// for a paragraph with inline maths mixed into running text.
import { ommlElementToMathML, MATH_NS } from './omml.mjs';
import { SCRIPT_MARKS } from '../format/text-style.mjs';
import { mathmlToLatex } from '../engine/mathml-to-latex.mjs';
import { cellFromSegments } from '../format/cell-markup.mjs';
import { loadWarnings } from './load-audit.mjs';
import { synthesizeOrderedMarker } from './nimas-export.mjs';

// ---------- $-delimited LaTeX (shared by parseText / parseMarkdown) ----------
//
// $$...$$ -> a standalone display-math block ({type:'math', latex}), splitting
// the surrounding text (if any) into separate paragraph block(s) before/after.
// Inline $...$ -> split the paragraph into segments (text and {type:'math',
// latex}), keeping the maths in the flow of the running text. To avoid
// misreading a currency amount ("$5 and $10") as inline math, a $ pair only
// counts as a delimiter when the content between the two $ is non-empty and
// does NOT start or end with whitespace or a digit (a real LaTeX span like
// $x^2$ or $\pi$ starts with a letter/backslash, never a digit the way "$5"
// does) — this also stops a run like "$5 and $10" from ever matching, since
// every candidate span there starts or ends on a digit. A single, unmatched
// "$" (or one with no valid partner) is left as plain text untouched.
const DISPLAY_MATH_RE = /\$\$([\s\S]+?)\$\$/g;
const INLINE_MATH_RE = /\$([^\s$](?:[^$]*[^\s$])?)\$/g;

// Split `chunk` on $$...$$ into a flat list of { text } / { latex, display:true }
// pieces, in order. Returns the original chunk as a single { text } piece if no
// $$ pair is found.
function splitDisplayMath(chunk) {
  const pieces = [];
  let i = 0, m;
  DISPLAY_MATH_RE.lastIndex = 0;
  while ((m = DISPLAY_MATH_RE.exec(chunk))) {
    if (m.index > i) pieces.push({ text: chunk.slice(i, m.index) });
    if (m[1].trim()) pieces.push({ latex: m[1].trim(), display: true });
    i = m.index + m[0].length;
  }
  if (i < chunk.length) pieces.push({ text: chunk.slice(i) });
  return pieces.length ? pieces : [{ text: chunk }];
}

// Reduce $...$ false positives on ordinary prose: a pure number is currency
// ("$100$"), and a multi-word span with no maths operator is prose ("$Profit rose$").
// Single tokens ($x$, $variable$) and anything with a maths operator/brace are kept.
function looksLikeMath(s) {
  if (!s) return false;
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return false;                        // pure number -> currency
  if (/\s/.test(s) && !/[\\^_{}=+*/<>|~×·±≤≥∑∫√-]/.test(s)) return false; // multi-word, no maths token -> prose
  return true;
}

// Split a piece of plain text on inline $...$ into segments (text / math).
// Returns null if there's no valid inline-math delimiter pair in it.
function splitInlineMath(text) {
  if (!text.includes('$')) return null;
  const segments = [];
  let i = 0, any = false;
  INLINE_MATH_RE.lastIndex = 0;
  let m;
  while ((m = INLINE_MATH_RE.exec(text))) {
    const content = m[1].trim();
    if (!looksLikeMath(content)) continue;   // currency/prose false positive: leave the $...$ as literal text
    any = true;
    // Keep the raw between-text (incl. its boundary spaces) so the formatter can
    // reproduce the source spacing faithfully — trimming here is what wrongly
    // detached a trailing "." from the preceding equation. formatSegmentedPara
    // collapses internal runs and trims the paragraph edges.
    if (m.index > i) {
      const t = text.slice(i, m.index);
      if (t) segments.push({ type: 'text', text: t });
    }
    segments.push({ type: 'math', latex: content });
    i = m.index + m[0].length;
  }
  if (!any) return null;
  if (i < text.length) {
    const t = text.slice(i);
    if (t) segments.push({ type: 'text', text: t });
  }
  return segments;
}

// Turn a chunk of text into one or more blocks, extracting $$ display math
// (as standalone math blocks) and $ inline math (as segments within a
// paragraph). Falls back to a plain `{type:'para', text}` block wherever
// there's no (valid) math delimiter, so ordinary text (incl. a lone "$" or
// an apostrophe) is completely unaffected — same output as before this
// feature existed.
function textChunkToBlocks(chunk) {
  if (!chunk.includes('$')) return [{ type: 'para', text: chunk }];
  const blocks = [];
  for (const piece of splitDisplayMath(chunk)) {
    if (piece.display) { blocks.push({ type: 'math', latex: piece.latex }); continue; }
    const t = piece.text;
    if (!t.trim()) continue;
    const segments = splitInlineMath(t);
    if (segments && segments.length) blocks.push({ type: 'para', segments });
    else blocks.push({ type: 'para', text: t.replace(/\s+/g, ' ').trim() });
  }
  return blocks.length ? blocks : [{ type: 'para', text: chunk }];
}

// ---------- plain text ----------
// Blank-line-separated chunks become paragraphs. A lone first line followed by a
// blank line is treated as the title.
export function parseText(str) {
  const chunks = (str ?? '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
  const blocks = [];
  let title = null;
  chunks.forEach((chunk, i) => {
    const oneLine = !chunk.includes('\n');
    if (i === 0 && oneLine && chunks.length > 1) { title = chunk; blocks.push({ type: 'title', text: chunk }); }
    else blocks.push(...textChunkToBlocks(chunk.replace(/\n/g, ' ')));
  });
  return { title, blocks };
}

// ---------- HTML (browser) ----------
// Serialize a <math> element back to a MathML string. Prefers XMLSerializer
// (available in both browsers and @xmldom/xmldom) over outerHTML, since
// outerHTML on an HTML-parsed <math> island may not be well-formed XML.
function mathOuterXml(el) {
  if (!el) return '';
  if (typeof XMLSerializer !== 'undefined') {
    try { return new XMLSerializer().serializeToString(el); } catch { /* fall through */ }
  }
  if (typeof el.toString === 'function') {
    try {
      const s = el.toString();
      if (s && s !== '[object Object]' && s !== '[object Element]') return s;
    } catch { /* fall through */ }
  }
  return el.outerHTML || '';
}

function hasInlineElements(node) {
  if (!node) return false;
  if (node.getElementsByTagName) {
    return node.getElementsByTagName('math').length > 0
      || node.getElementsByTagName('sub').length > 0
      || node.getElementsByTagName('sup').length > 0
      || node.getElementsByTagName('br').length > 0;
  }
  if (node.querySelector) {
    return !!(node.querySelector('math') || node.querySelector('sub') || node.querySelector('sup') || node.querySelector('br'));
  }
  return false;
}

// Walk a <p>'s child nodes (text + elements) in document order, building a
// segments array: text -> {type:'text'}, a <math> element -> {type:'math',
// mathml}, <sub>/<sup> -> UEB sub/sup script marks in text, <br> -> space.
function htmlParagraphSegments(p) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  const segments = [];
  let text = '';
  let curScript = null;
  const flushText = () => {
    if (curScript) { text += end; curScript = null; }
    if (text) segments.push({ type: 'text', text });
    text = '';
  };
  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType === 3) {                      // text node
        text += child.textContent;
      } else if (child.nodeType === 1) {
        const tag = (child.tagName || child.localName || '').toLowerCase();
        if (tag === 'math') {
          flushText();
          const mathml = mathOuterXml(child);
          const latex = mathmlToLatex(mathml);
          const seg = { type: 'math', mathml };
          if (latex) seg.latex = latex;
          segments.push(seg);
        } else if (tag === 'br') {
          text += ' ';
        } else if (tag === 'sub' || tag === 'sup') {
          const prevScript = curScript;
          if (curScript) { text += end; curScript = null; }
          text += (tag === 'sub' ? subOpen : supOpen);
          curScript = tag;
          walk(child);
          if (curScript) { text += end; curScript = null; }
          curScript = prevScript;
          if (curScript) {
            text += (curScript === 'sub' ? subOpen : supOpen);
          }
        } else if (hasInlineElements(child)) {
          walk(child);                                  // descend to find the <math>/<sub>/<sup>/<br> in place
        } else {
          text += child.textContent;
        }
      }
    }
  };
  walk(p);
  flushText();
  return segments;
}

export function parseHtml(str) {
  const raw = str ?? '';
  const htmlToParse = (raw.includes('<html') || raw.includes('<body')) ? raw : `<body>${raw}</body>`;
  const Parser = typeof DOMParser !== 'undefined' ? DOMParser : globalThis.DOMParser;
  if (!Parser) throw new Error('No DOMParser available');
  const doc = new Parser().parseFromString(htmlToParse, 'text/html');
  const titleEl = (doc.querySelector ? doc.querySelector('title') : doc.getElementsByTagName('title')[0])
    || (doc.querySelector ? doc.querySelector('h1') : doc.getElementsByTagName('h1')[0]);
  const title = (titleEl?.textContent || '').trim() || null;
  const blocks = [];
  const root = doc.body || (doc.getElementsByTagName ? doc.getElementsByTagName('body')[0] : null) || doc.documentElement;
  const walk = (el) => {
    for (const node of el.childNodes || []) {
      if (node.nodeType === 3) {           // text node sitting directly in a container
        const t = node.textContent.replace(/\s+/g, ' ').trim();
        if (t) blocks.push({ type: 'para', text: t });
        continue;
      }
      if (node.nodeType !== 1) continue;   // skip comments / processing instructions
      const tag = (node.tagName || node.localName || '').toLowerCase();
      if (tag === 'head' || tag === 'title' || tag === 'script' || tag === 'style' || tag === 'meta' || tag === 'link' || tag === 'template') continue;
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (tag === 'math') {                // block-level <math> (not inside a <p>/etc)
        const mathml = mathOuterXml(node);
        const latex = mathmlToLatex(mathml);
        const blk = { type: 'math', mathml };
        if (latex) blk.latex = latex;
        blocks.push(blk);
      } else if (/^h[1-6]$/.test(tag)) {
        if (!text) continue;
        if (hasInlineElements(node)) {
          const segments = htmlParagraphSegments(node);
          const hasEmphOrMath = segments.some((s) => s.type === 'math' || (s.text && (s.text.includes(SCRIPT_MARKS.subOpen) || s.text.includes(SCRIPT_MARKS.supOpen))));
          if (hasEmphOrMath) blocks.push({ type: 'heading', level: Number(tag[1]), segments, text });
          else {
            const flat = segments.map((s) => s.text || '').join('').replace(/\s+/g, ' ').trim();
            blocks.push({ type: 'heading', level: Number(tag[1]), text: flat || text });
          }
        } else {
          blocks.push({ type: 'heading', level: Number(tag[1]), text });
        }
      } else if (tag === 'p') {
        const img = node.getElementsByTagName ? node.getElementsByTagName('img')[0] : null;
        if (img) {
          const alt = (img.getAttribute ? img.getAttribute('alt') : '') || '';
          blocks.push({ type: 'note', kind: 'image', text: 'Image: ' + alt });
        }
        const clsList = (node.getAttribute ? (node.getAttribute('class') || '') : '').split(/\s+/);
        const isG1 = clsList.includes('g1');
        if (hasInlineElements(node)) {
          const segments = htmlParagraphSegments(node);
          if (isG1) {
            segments.forEach(s => s.uncontracted = true);
          }
          const hasEmphOrMath = segments.some((s) => s.type === 'math' || s.uncontracted || (s.text && (s.text.includes(SCRIPT_MARKS.subOpen) || s.text.includes(SCRIPT_MARKS.supOpen))));
          if (hasEmphOrMath) blocks.push({ type: 'para', segments });
          else {
            const flat = segments.map((s) => s.text || '').join('').replace(/\s+/g, ' ').trim();
            if (flat) blocks.push({ type: 'para', text: flat });
          }
        } else if (text) {
          if (isG1) blocks.push({ type: 'para', segments: [{ type: 'text', text, uncontracted: true }] });
          else blocks.push({ type: 'para', text });
        }
      } else if (tag === 'img') {
        const alt = (node.getAttribute ? node.getAttribute('alt') : '') || '';
        blocks.push({ type: 'note', kind: 'image', text: 'Image: ' + alt });
      } else if (tag === 'figure') {
        const caption = node.getElementsByTagName ? node.getElementsByTagName('figcaption')[0] : null;
        const capText = caption ? caption.textContent.replace(/\s+/g, ' ').trim() : '';
        blocks.push({ type: 'note', kind: 'image', text: 'Image: ' + capText });
      } else if (tag === 'pre' || tag === 'code') {
        if (text) blocks.push({ type: 'code', text });
      } else if (tag === 'ul' || tag === 'ol') {
        const parseList = (listEl, lvl = 0) => {
          const isOl = (listEl.tagName || listEl.localName || '').toLowerCase() === 'ol';
          const startVal = isOl ? (parseInt(listEl.getAttribute ? (listEl.getAttribute('start') || '1') : '1', 10) || 1) : 1;
          let counter = startVal;
          const items = [];
          for (const li of listEl.childNodes || []) {
            if (li.nodeType !== 1 || (li.tagName || li.localName || '').toLowerCase() !== 'li') continue;
            const nestedLists = [];
            let itemText = '';
            for (const c of li.childNodes || []) {
              if (c.nodeType === 3) itemText += c.textContent;
              else if (c.nodeType === 1) {
                const cTag = (c.tagName || c.localName || '').toLowerCase();
                if (cTag === 'ul' || cTag === 'ol') nestedLists.push(c);
                else if (cTag === 'br') itemText += ' ';
                else itemText += c.textContent;
              }
            }
            itemText = itemText.replace(/\s+/g, ' ').trim();
            if (itemText) {
              let item;
              if (hasInlineElements(li)) {
                const segments = htmlParagraphSegments(li);
                const hasEmphOrMath = segments.some((s) => s.type === 'math' || (s.text && (s.text.includes(SCRIPT_MARKS.subOpen) || s.text.includes(SCRIPT_MARKS.supOpen))));
                item = hasEmphOrMath ? { segments, text: itemText } : { text: itemText };
              } else {
                item = { text: itemText };
              }
              if (isOl) {
                item.marker = `${counter}.`;
                counter++;
              }
              if (lvl > 0) item.level = lvl;
              items.push(item);
            }
            for (const nl of nestedLists) {
              items.push(...parseList(nl, lvl + 1));
            }
          }
          return items;
        };
        const items = parseList(node, 0);
        if (items.length) blocks.push({ type: 'list', items });
      } else if (tag === 'dl') {
        const items = [];
        let curTerm = null;
        let curTermSegs = null;
        for (const child of node.childNodes || []) {
          if (child.nodeType !== 1) continue;
          const cTag = (child.tagName || child.localName || '').toLowerCase();
          if (cTag === 'dt' || cTag === 'dfn') {
            if (curTerm) {
              const item = { term: curTerm, def: '', text: curTerm };
              if (curTermSegs?.length) { item.termSegments = curTermSegs; item.segments = curTermSegs; }
              items.push(item);
            }
            curTerm = child.textContent.replace(/\s+/g, ' ').trim();
            curTermSegs = hasInlineElements(child) ? htmlParagraphSegments(child) : null;
          } else if (cTag === 'dd') {
            const defText = child.textContent.replace(/\s+/g, ' ').trim();
            const defSegs = hasInlineElements(child) ? htmlParagraphSegments(child) : null;
            if (curTerm || defText) {
              const item = {
                term: curTerm || '',
                def: defText || '',
                text: curTerm ? `${curTerm} — ${defText}` : defText
              };
              if (curTermSegs?.length) item.termSegments = curTermSegs;
              if (defSegs?.length) item.defSegments = defSegs;
              if (curTermSegs?.length || defSegs?.length) {
                item.segments = [...(curTermSegs || [{ type: 'text', text: curTerm || '' }]), { type: 'text', text: ' — ' }, ...(defSegs || [{ type: 'text', text: defText || '' }])];
              }
              items.push(item);
              curTerm = null;
              curTermSegs = null;
            }
          }
        }
        if (curTerm) {
          const item = { term: curTerm, def: '', text: curTerm };
          if (curTermSegs?.length) { item.termSegments = curTermSegs; item.segments = curTermSegs; }
          items.push(item);
        }
        if (items.length) blocks.push({ type: 'list', kind: 'glossary', style: 'glossary', items });
      } else if (tag === 'table') {
        const captionEl = node.getElementsByTagName ? node.getElementsByTagName('caption')[0] : null;
        const captionText = captionEl ? captionEl.textContent.replace(/\s+/g, ' ').trim() : null;
        const rows = node.querySelectorAll ? [...node.querySelectorAll('tr')]
          : [...(node.getElementsByTagName ? node.getElementsByTagName('tr') : [])];
        const headers = [];
        const tableRows = [];
        let headerRowFound = false;
        const thead = node.getElementsByTagName ? node.getElementsByTagName('thead')[0] : null;
        if (thead) {
          const theadTrs = [...thead.getElementsByTagName('tr')];
          if (theadTrs.length) {
            const cells = [...theadTrs[0].getElementsByTagName('th'), ...theadTrs[0].getElementsByTagName('td')];
            headers.push(...cells.map(c => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean));
            headerRowFound = true;
          }
        }
        for (let i = 0; i < rows.length; i++) {
          const tr = rows[i];
          if (thead && tr.parentNode === thead) continue;
          const ths = [...(tr.getElementsByTagName ? tr.getElementsByTagName('th') : [])];
          const tds = [...(tr.getElementsByTagName ? tr.getElementsByTagName('td') : [])];
          if (!headerRowFound && ths.length && !tds.length) {
            headers.push(...ths.map(c => c.textContent.replace(/\s+/g, ' ').trim()));
            headerRowFound = true;
          } else {
            const rowCells = [];
            for (const cell of [...ths, ...tds]) {
              const cellText = cell.textContent.replace(/\s+/g, ' ').trim();
              const colspan = parseInt(cell.getAttribute ? (cell.getAttribute('colspan') || '1') : '1', 10) || 1;
              rowCells.push(cellText);
              for (let k = 1; k < colspan; k++) rowCells.push('');
            }
            if (rowCells.some(Boolean)) tableRows.push(rowCells);
          }
        }
        if (captionText) {
          blocks.push({ type: 'caption', text: captionText });
        }
        if (headers.length || tableRows.length) {
          const tbl = { type: 'table', headers, rows: tableRows };
          blocks.push(tbl);
        }
      } else if (tag === 'tbody' || tag === 'thead' || tag === 'tfoot') {
        walk(node);
      } else if (tag === 'tr') {
        walk(node);
      } else if (tag === 'blockquote') {
        if (text) blocks.push({ type: 'note', text });
      } else if (tag === 'pagenum' || (node.dataset && node.dataset.pagenum) || (node.getAttribute && node.getAttribute('role') === 'doc-pagebreak')) {
        const pVal = text || node.dataset?.pagenum || (node.getAttribute ? (node.getAttribute('aria-label') || node.getAttribute('title')) : '') || '';
        if (pVal) blocks.push({ type: 'pagenum', page: pVal, text: pVal });
      } else if (node.children?.length || node.childNodes?.length) {
        walk(node);                       // descend into wrappers (div, section, article...)
      } else if (text) {
        blocks.push({ type: 'para', text });
      }
    }
  };
  walk(root);
  return { title, blocks };
}

// ---------- docx ----------
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Normalise to a Uint8Array view over a real ArrayBuffer (accepts an ArrayBuffer or any
// typed-array view over one).
function zipBytes(buf) {
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (buf && buf.buffer instanceof ArrayBuffer) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return new Uint8Array(buf);
}

// Minimal ZIP reader: scan the central directory once and list every entry (name, storage
// method, compressed size, local-header offset). Shared by unzipEntry (docx/odt/epub, below)
// and, since A3, the NIMAS package importer, which needs to probe/list entries rather than
// just pull one out by name.
function listZipEntries(buf) {
  const u8 = zipBytes(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // find End Of Central Directory (sig 0x06054b50), scanning back
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (no EOCD)');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
    entries.push({ name, method, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Extract one already-located entry's bytes (inflating if needed).
async function extractZipEntry(buf, entry) {
  const u8 = zipBytes(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const lNameLen = dv.getUint16(entry.localOff + 26, true);
  const lExtraLen = dv.getUint16(entry.localOff + 28, true);
  const dataStart = entry.localOff + 30 + lNameLen + lExtraLen;
  const data = u8.subarray(dataStart, dataStart + entry.compSize);
  return entry.method === 0 ? data : inflateRaw(data);
}

async function unzipEntry(buf, wanted) {
  const entry = listZipEntries(buf).find((e) => e.name === wanted);
  if (!entry) throw new Error(`entry not found in zip: ${wanted}`);
  return extractZipEntry(buf, entry);
}

// Direct child element by namespace + local name. Uses childNodes (not
// .children) so it works in both the browser DOM and @xmldom/xmldom (Node).
function firstChildNS(el, ns, ln) {
  for (const c of el.childNodes || []) {
    if (c.nodeType === 1 && c.localName === ln && c.namespaceURI === ns) return c;
  }
  return null;
}

// A run's vertical alignment from w:rPr/w:vertAlign/@w:val: 'sub' | 'sup' | null.
function runScript(r, W) {
  const rPr = firstChildNS(r, W, 'rPr');
  const va = rPr && firstChildNS(rPr, W, 'vertAlign');
  const val = va && (va.getAttributeNS(W, 'val') || '').toLowerCase();
  return val === 'subscript' ? 'sub' : val === 'superscript' ? 'sup' : null;
}

// liblouis typeform bits (match louis.TYPEFORM used by the editor): italic=1, underline=2, bold=4.
const TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4;
// A run's emphasis (bold/italic/underline) from w:rPr → liblouis typeform bits, so the
// formatter emits real UEB emphasis indicators. A toggle element with no val (or val
// "true"/"1") is on; val "false"/"0"/"none" is off.
function runEmphasis(r, W) {
  const rPr = firstChildNS(r, W, 'rPr');
  if (!rPr) return 0;
  const on = (ln) => { const e = firstChildNS(rPr, W, ln); if (!e) return false; const v = e.getAttributeNS(W, 'val'); return v == null || (v !== 'false' && v !== '0' && v !== 'none'); };
  let tf = 0;
  if (on('b')) tf |= TF_BOLD;
  if (on('i')) tf |= TF_ITALIC;
  if (on('u')) tf |= TF_UNDERLINE;
  return tf;
}

function getRunText(r, W) {
  let text = '';
  for (const child of r.childNodes || []) {
    if (child.nodeType === 1 && child.namespaceURI === W) {
      if (child.localName === 't') text += child.textContent;
      else if (child.localName === 'tab' || child.localName === 'br' || child.localName === 'cr') text += ' ';
      else if (child.localName === 'noBreakHyphen') text += '-';
    }
  }
  return text;
}

// Concatenate a paragraph's run text, bracketing subscript/superscript runs with
// the script markers the formatter's translate step turns into UEB level
// indicators (so e.g. the "2" of CO2 gets the ";5" subscript sign). Adjacent
// runs of the same alignment share one marker pair.
function paragraphRunText(p, W) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  let text = '';
  let cur = null;                                         // baseline | 'sub' | 'sup'
  for (const r of p.getElementsByTagNameNS(W, 'r')) {
    const runText = getRunText(r, W);
    if (!runText) continue;
    const script = runScript(r, W);
    if (script !== cur) {
      if (cur) text += end;
      if (script) text += script === 'sub' ? subOpen : supOpen;
      cur = script;
    }
    text += runText;
  }
  if (cur) text += end;
  return text;
}

// Walk a paragraph's direct children in document order, building a segments
// array that interleaves run text (w:r, with sub/superscript markers exactly
// as paragraphRunText) and inline equations (m:oMath, a sibling of w:r inside
// w:p). Text is accumulated and flushed as one 'text' segment whenever a math
// element is hit (or at the end), so adjacent runs still collapse into a
// single segment the same way paragraphRunText collapses them into one string.
function paragraphSegments(p, W) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  const segments = [];
  let text = '';
  let cur = null;                                          // baseline | 'sub' | 'sup'
  let curTf = 0;                                           // emphasis of the accumulating run (bold/italic/underline)
  const flushText = () => {
    if (cur) { text += end; cur = null; }
    if (text) segments.push(curTf ? { type: 'text', text, tf: curTf } : { type: 'text', text });
    text = '';
  };
  const processRun = (r) => {
    const runText = getRunText(r, W);
    if (!runText) return;
    const tf = runEmphasis(r, W);
    if (tf !== curTf) { flushText(); curTf = tf; }
    const script = runScript(r, W);
    if (script !== cur) {
      if (cur) text += end;
      if (script) text += script === 'sub' ? subOpen : supOpen;
      cur = script;
    }
    text += runText;
  };
  for (const node of p.childNodes || []) {
    if (node.nodeType !== 1) continue;
    if (node.namespaceURI === MATH_NS && node.localName === 'oMath') {
      flushText(); curTf = 0;
      const mathml = ommlElementToMathML(node);
      const latex = mathmlToLatex(mathml);
      const seg = { type: 'math', mathml };
      if (latex) seg.latex = latex;
      segments.push(seg);
      continue;
    }
    if (node.localName === 'hyperlink') {
      for (const r of node.getElementsByTagNameNS ? node.getElementsByTagNameNS(W, 'r') : (node.getElementsByTagName ? node.getElementsByTagName('w:r') : [])) {
        processRun(r);
      }
      continue;
    }
    if (node.namespaceURI === W && node.localName === 'r') {
      processRun(node);
    }
  }
  flushText();
  return segments;
}

// The browser's native DOMParser does NOT throw on malformed XML — it returns a
// document whose root (or a child) is a <parsererror>. Left unchecked, the callers
// below would fall back to that error node and silently produce an empty/garbage
// document with no error shown to the user. Detect it and throw so the caller's
// try/catch surfaces a real "could not read that file". (@xmldom, used in the Node
// tests, throws directly — so this path is browser-only.)
const COMMON_HTML_ENTITIES = {
  nbsp: '&#160;', mdash: '&#8212;', ndash: '&#8211;', hellip: '&#8230;',
  lsquo: '&#8216;', rsquo: '&#8217;', ldquo: '&#8220;', rdquo: '&#8221;',
  copy: '&#169;', reg: '&#174;', trade: '&#8482;', bull: '&#8226;',
  deg: '&#176;', plusmn: '&#177;', times: '&#215;', divide: '&#247;',
  micro: '&#181;', para: '&#182;', middot: '&#183;', frac12: '&#189;',
  frac14: '&#188;', frac34: '&#190;', euro: '&#8364;', pound: '&#163;',
  yen: '&#165;', cent: '&#162;', sect: '&#167;', laquo: '&#171;', raquo: '&#187;',
  aacute: '&#225;', eacute: '&#233;', iacute: '&#237;', oacute: '&#243;', uacute: '&#250;',
  agrave: '&#224;', egrave: '&#232;', igrave: '&#236;', ograve: '&#242;', ugrave: '&#249;',
  auml: '&#228;', euml: '&#235;', iuml: '&#239;', ouml: '&#246;', uuml: '&#252;',
  ntilde: '&#241;', ccedil: '&#231;',
};

export const LEADING_BULLET_RE = /^\s*[•\-\*\u2022\u2023\u25E6\u2043\u2219\u25AA\u25AB\u25CF\u25CB\uF0B7\uF0A7\u00B7]+\s+/;
export function stripLeadingBullet(str) {
  if (!str) return str;
  return String(str).replace(LEADING_BULLET_RE, '').trim();
}

function sanitizeXmlEntities(xml) {
  let s = xml || '';
  const dtdEntities = {};
  const entityDeclRe = /<!ENTITY\s+(?:%\s+)?([a-zA-Z0-9_\-\.:]+)\s+["']([^"']*)["']\s*>/g;
  let em;
  while ((em = entityDeclRe.exec(s)) !== null) {
    dtdEntities[em[1]] = em[2];
  }
  s = s.replace(/&([a-zA-Z0-9_\-\.:]+);/g, (match, name) => {
    if (name === 'amp' || name === 'lt' || name === 'gt' || name === 'quot' || name === 'apos') return match;
    if (dtdEntities[name] !== undefined) return dtdEntities[name];
    if (COMMON_HTML_ENTITIES[name] !== undefined) return COMMON_HTML_ENTITIES[name];
    return `&amp;${name};`;
  });
  return s;
}

function parseXml(xml) {
  const Parser = typeof DOMParser !== 'undefined' ? DOMParser : globalThis.DOMParser;
  if (!Parser) throw new Error('No DOMParser available');
  let cleanXml = (xml ?? '').replace(/^\uFEFF/, '').trim();
  cleanXml = sanitizeXmlEntities(cleanXml);
  let doc = new Parser().parseFromString(cleanXml, 'application/xml');
  let err = doc.getElementsByTagName('parsererror')[0]
    || (doc.documentElement && doc.documentElement.nodeName === 'parsererror' ? doc.documentElement : null);
  
  if (err) {
    cleanXml = sanitizeXmlEntities(cleanXml);
    doc = new Parser().parseFromString(cleanXml, 'application/xml');
    err = doc.getElementsByTagName('parsererror')[0]
      || (doc.documentElement && doc.documentElement.nodeName === 'parsererror' ? doc.documentElement : null);
  }

  if (err && typeof document !== 'undefined') {
    try {
      const htmlDoc = new Parser().parseFromString(cleanXml, 'text/html');
      if (htmlDoc && (htmlDoc.body || htmlDoc.documentElement)) return htmlDoc;
    } catch { /* ignore and throw XML error */ }
  }

  if (err) throw new Error('malformed XML: ' + (err.textContent || 'parse error').replace(/\s+/g, ' ').trim().slice(0, 200));
  return doc;
}

// ---- Word list numbering (word/numbering.xml) → running list markers ----
// Word stores only that a paragraph belongs to list numId at level ilvl; the actual
// "1." / "a)" / "iii." text has to be computed from numbering.xml (numFmt + lvlText +
// start) plus a running counter. Without the numbering part we can't tell an ordered
// list from a bullet one, so we emit NO marker (unchanged behaviour) rather than guess.
const _ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function toRoman(n) { if (n < 1 || n > 3999) return String(n); let s = ''; for (const [v, g] of _ROMAN) while (n >= v) { s += g; n -= v; } return s; }
function toAlpha(n) { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return s || 'a'; }
function formatCounter(n, numFmt) {
  switch (numFmt) {
    case 'decimal': return String(n);
    case 'decimalzero': return n < 10 ? '0' + n : String(n);
    case 'lowerletter': return toAlpha(n);
    case 'upperletter': return toAlpha(n).toUpperCase();
    case 'lowerroman': return toRoman(n);
    case 'upperroman': return toRoman(n).toUpperCase();
    default: return null;                              // bullet / none / unsupported → not ordered
  }
}

async function parseDocxNumbering(arrayBuffer, W) {
  let xml;
  try { xml = new TextDecoder().decode(await unzipEntry(arrayBuffer, 'word/numbering.xml')); }
  catch { return null; }                               // no numbering part
  let doc; try { doc = parseXml(xml); } catch { return null; }
  const abstract = new Map();                          // abstractNumId → Map(ilvl → {numFmt,lvlText,start})
  for (const an of doc.getElementsByTagNameNS(W, 'abstractNum')) {
    const levels = new Map();
    for (const lvl of an.getElementsByTagNameNS(W, 'lvl')) {
      const numFmt = (lvl.getElementsByTagNameNS(W, 'numFmt')[0]?.getAttributeNS(W, 'val') || '').toLowerCase();
      const lvlText = lvl.getElementsByTagNameNS(W, 'lvlText')[0]?.getAttributeNS(W, 'val') || '';
      const start = Number(lvl.getElementsByTagNameNS(W, 'start')[0]?.getAttributeNS(W, 'val') || '1') || 1;
      levels.set(String(lvl.getAttributeNS(W, 'ilvl')), { numFmt, lvlText, start });
    }
    abstract.set(String(an.getAttributeNS(W, 'abstractNumId')), levels);
  }
  const numToAbstract = new Map();                     // numId → {aId, startOverrides:Map(ilvl→start)}
  for (const num of doc.getElementsByTagNameNS(W, 'num')) {
    const aId = String(num.getElementsByTagNameNS(W, 'abstractNumId')[0]?.getAttributeNS(W, 'val'));
    const startOverrides = new Map();
    for (const ov of num.getElementsByTagNameNS(W, 'lvlOverride')) {
      const so = ov.getElementsByTagNameNS(W, 'startOverride')[0]?.getAttributeNS(W, 'val');
      if (so != null) startOverrides.set(String(ov.getAttributeNS(W, 'ilvl')), Number(so) || 1);
    }
    numToAbstract.set(String(num.getAttributeNS(W, 'numId')), { aId, startOverrides });
  }
  return function level(numId, ilvl) {
    const rec = numToAbstract.get(String(numId)); if (!rec) return null;
    const levels = abstract.get(rec.aId); if (!levels) return null;
    const lv = levels.get(String(ilvl)); if (!lv) return null;
    const so = rec.startOverrides.get(String(ilvl));
    return so != null ? { ...lv, start: so } : lv;
  };
}

// Compute the marker for a list item at (numId, ilvl), advancing `counters` (a Map
// keyed "numId:ilvl") and resetting deeper levels so nested lists restart. Returns
// null for bullets / unresolved numbering (caller then omits the marker).
function listMarker(level, counters, numId, ilvl) {
  if (!level || numId == null) return null;
  const lv = level(numId, ilvl);
  if (!lv || formatCounter(1, lv.numFmt) == null) return null;   // not an ordered format
  const key = (i) => `${numId}:${i}`;
  counters.set(key(ilvl), counters.has(key(ilvl)) ? counters.get(key(ilvl)) + 1 : lv.start);
  for (let j = ilvl + 1; j <= 8; j++) counters.delete(key(j));
  return (lv.lvlText || `%${ilvl + 1}.`).replace(/%([1-9])/g, (_, d) => {
    const li = Number(d) - 1;
    const llv = level(numId, li) || lv;
    const val = counters.has(key(li)) ? counters.get(key(li)) : (llv.start ?? 1);
    return formatCounter(val, llv.numFmt) ?? String(val);
  });
}

export async function parseDocx(arrayBuffer) {
  const xmlBytes = await unzipEntry(arrayBuffer, 'word/document.xml');
  const xml = new TextDecoder().decode(xmlBytes);
  const doc = parseXml(xml);
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const numbering = await parseDocxNumbering(arrayBuffer, W);      // null if no numbering.xml
  let listCounters = new Map();
  const body = doc.getElementsByTagNameNS(W, 'body')[0] || doc.documentElement;
  const blocks = [];
  let title = null;
  let pendingList = null;
  const flushList = () => { if (pendingList) { blocks.push(pendingList); pendingList = null; } };
  const pushMath = (omEl) => {
    const mathml = ommlElementToMathML(omEl);
    const latex = mathmlToLatex(mathml);
    const blk = { type: 'math', mathml };
    if (latex) blk.latex = latex;
    blocks.push(blk);
  };

  // Walk the body's children in document order so equations land in place.
  for (const el of body.children) {
    const ln = el.localName;

    // display equations: m:oMathPara (block) or a bare m:oMath at body level
    if (ln === 'oMathPara' || ln === 'oMath') {
      flushList();
      const maths = ln === 'oMath' ? [el] : [...el.getElementsByTagNameNS(MATH_NS, 'oMath')];
      maths.forEach(pushMath);
      continue;
    }
    // tables: w:tbl -> table block
    if (ln === 'tbl') {
      flushList();
      const trs = [...el.getElementsByTagNameNS(W, 'tr')];
      if (trs.length) {
        const headers = [];
        const tableRows = [];
        const firstTr = trs[0];
        for (const tc of firstTr.getElementsByTagNameNS(W, 'tc')) {
          const t = paragraphRunText(tc, W).replace(/\s+/g, ' ').trim();
          const gridSpan = parseInt(tc.getElementsByTagNameNS(W, 'gridSpan')[0]?.getAttributeNS(W, 'val') || '1', 10) || 1;
          headers.push(t);
          for (let k = 1; k < gridSpan; k++) headers.push('');
        }
        for (let i = 1; i < trs.length; i++) {
          const rowCells = [];
          for (const tc of trs[i].getElementsByTagNameNS(W, 'tc')) {
            const t = paragraphRunText(tc, W).replace(/\s+/g, ' ').trim();
            const gridSpan = parseInt(tc.getElementsByTagNameNS(W, 'gridSpan')[0]?.getAttributeNS(W, 'val') || '1', 10) || 1;
            rowCells.push(t);
            for (let k = 1; k < gridSpan; k++) rowCells.push('');
          }
          if (rowCells.some(Boolean)) tableRows.push(rowCells);
        }
        blocks.push({ type: 'table', headers, rows: tableRows });
      }
      continue;
    }
    if (ln !== 'p') continue;

    const p = el;
    const hasMath = p.getElementsByTagNameNS(MATH_NS, 'oMath').length > 0;
    const segments = paragraphSegments(p, W);                     // run order: text <-> math, with emphasis tf
    // Use the segment path when there's inline maths OR any emphasis run, so bold/italic/
    // underline survive as typeform. Plain text stays on the unchanged plain path (byte-exact).
    const hasSeg = !!(segments.length && (hasMath || segments.some((s) => s.tf)));
    let text = paragraphRunText(p, W);                    // w:t only, with sub/superscript markers
    text = text.replace(/\s+/g, ' ').trim();
    const styleEl = p.getElementsByTagNameNS(W, 'pStyle')[0];
    const style = (styleEl?.getAttributeNS(W, 'val') || '').toLowerCase();
    const isList = p.getElementsByTagNameNS(W, 'numPr').length > 0 || style.includes('listparagraph');

    // Classify by STYLE first, then attach inline-maths segments — so a heading or
    // list item with an equation keeps its heading level / list membership (a
    // heading stays in the TOC; a list isn't split apart) instead of collapsing to
    // a plain paragraph.
    if (!text && !hasSeg) { flushList(); continue; }
    if (isList) {
      if (!pendingList) { pendingList = { type: 'list', items: [] }; listCounters = new Map(); }  // fresh list → restart numbering
      const numPr = p.getElementsByTagNameNS(W, 'numPr')[0];
      const ilvl = numPr ? Number(numPr.getElementsByTagNameNS(W, 'ilvl')[0]?.getAttributeNS(W, 'val') || 0) || 0 : 0;
      const numId = numPr ? numPr.getElementsByTagNameNS(W, 'numId')[0]?.getAttributeNS(W, 'val') : null;
      const marker = listMarker(numbering, listCounters, numId, ilvl);
      const item = hasSeg ? { segments } : { text };
      if (marker) item.marker = marker;               // ordered list → "1." / "a)" / "iii." etc.
      if (ilvl) item.level = ilvl;                     // nested lists indent per level
      pendingList.items.push(item);
      continue;
    }
    flushList();
    if (style === 'title') { title = title || text; blocks.push({ type: 'title', text }); }  // title: text only
    else if (/^heading([1-9])/.test(style)) {
      const level = Math.min(6, Number(style.match(/^heading([1-9])/)[1]));
      blocks.push(hasSeg ? { type: 'heading', level, segments, text } : { type: 'heading', level, text });
    } else {
      blocks.push(hasSeg ? { type: 'para', segments } : { type: 'para', text });
    }
  }
  flushList();
  return { title, blocks };
}

// ---------- Markdown ----------
// Protect $...$ / $$...$$ spans from markdown emphasis-stripping (inline(),
// below) by pulling them out to placeholders before inline() runs and
// splicing the literal span back in afterwards. Without this, LaTeX like
// $x_1$ or $a*b$ would have its underscores/asterisks stripped as markdown
// emphasis before textChunkToBlocks ever sees the paragraph.
const MATH_PLACEHOLDER_RE = /\x00(\d+)\x00/g;
function protectMathSpans(line) {
  let text = line
    .replace(/\\\\\$/g, '\x00BS\x00\x00DOLLAR\x00')
    .replace(/\\\$/g, '\x00DOLLAR\x00')
    .replace(/\\\*/g, '\x00ASTERISK\x00')
    .replace(/\\_/g, '\x00UNDERSCORE\x00')
    .replace(/\\`/g, '\x00BACKTICK\x00')
    .replace(/\\\[/g, '\x00OBRACKET\x00')
    .replace(/\\\]/g, '\x00CBRACKET\x00');

  const spans = [];
  const masked = text.replace(/\$\$[\s\S]+?\$\$|\$[^\s$](?:[^$]*[^\s$])?\$/g, (m) => {
    spans.push(m);
    return `\x00${spans.length - 1}\x00`;
  });
  // Fall back to the literal placeholder if the index doesn't resolve (e.g. raw NUL
  // bytes in the source coincidentally match the placeholder pattern) → never inject "undefined".
  return {
    masked,
    restore: (s) => s.replace(MATH_PLACEHOLDER_RE, (m, i) => spans[Number(i)] ?? m)
      .replace(/\x00DOLLAR\x00/g, '$')
      .replace(/\x00ASTERISK\x00/g, '*')
      .replace(/\x00UNDERSCORE\x00/g, '_')
      .replace(/\x00BACKTICK\x00/g, '`')
      .replace(/\x00OBRACKET\x00/g, '[')
      .replace(/\x00CBRACKET\x00/g, ']')
      .replace(/\x00BS\x00/g, '\\')
  };
}

export function parseMarkdown(str) {
  let s = str ?? '';
  let title = null;
  // Strip YAML frontmatter at start of file if present (e.g. ---\ntitle: ...\n---)
  const fmMatch = s.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (fmMatch) {
    const yaml = fmMatch[1];
    const titleMatch = yaml.match(/^title:\s*(.+)$/m);
    if (titleMatch) {
      title = titleMatch[1].replace(/^["']|["']$/g, '').trim();
    }
    s = s.slice(fmMatch[0].length);
  }

  const TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4;
  const markdownToSegments = (str) => {
    if (!str) return [];
    const hasFormatting = /[*_`$\[]/.test(str);
    if (!hasFormatting) return [{ type: 'text', text: str }];

    const segments = [];
    const regex = /(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$|\*\*[^*]+?\*\*|__(?:[A-Za-z0-9 _]+?)__|\*[^*\n]+?\*|(?<=\s|^)_(?:[^\s_]+?)_(?=\s|$|[.,;:!?])|`[^`\n]+?`|\[([^\]]+)\]\([^)]+\))/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(str)) !== null) {
      if (match.index > lastIndex) {
        const plain = str.slice(lastIndex, match.index);
        if (plain) segments.push({ type: 'text', text: plain });
      }
      const token = match[0];
      if (token.startsWith('$$') && token.endsWith('$$')) {
        segments.push({ type: 'math', latex: token.slice(2, -2).trim() });
      } else if (token.startsWith('$') && token.endsWith('$')) {
        segments.push({ type: 'math', latex: token.slice(1, -1).trim() });
      } else if (token.startsWith('**') && token.endsWith('**')) {
        segments.push({ type: 'text', text: token.slice(2, -2), tf: TF_BOLD });
      } else if (token.startsWith('__') && token.endsWith('__')) {
        segments.push({ type: 'text', text: token.slice(2, -2), tf: TF_BOLD });
      } else if (token.startsWith('*') && token.endsWith('*')) {
        segments.push({ type: 'text', text: token.slice(1, -1), tf: TF_ITALIC });
      } else if (token.startsWith('_') && token.endsWith('_')) {
        segments.push({ type: 'text', text: token.slice(1, -1), tf: TF_ITALIC });
      } else if (token.startsWith('`') && token.endsWith('`')) {
        segments.push({ type: 'text', text: token.slice(1, -1), uncontracted: true });
      } else if (match[2] !== undefined) {
        segments.push({ type: 'text', text: match[2] });
      }
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < str.length) {
      const plain = str.slice(lastIndex);
      if (plain) segments.push({ type: 'text', text: plain });
    }
    const merged = [];
    for (const seg of segments) {
      const prev = merged[merged.length - 1];
      if (prev && prev.type === 'text' && seg.type === 'text' && !prev.tf && !seg.tf && !prev.uncontracted && !seg.uncontracted) {
        prev.text += seg.text;
      } else {
        merged.push(seg);
      }
    }
    return merged;
  };

  const inline = (t) => {
    const { masked, restore } = protectMathSpans(t);
    const stripped = masked
      .replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1')
      .replace(/\*(.+?)\*/g, '$1').replace(/_(.+?)_/g, '$1')
      .replace(/`(.+?)`/g, '$1').replace(/\[(.+?)\]\((?:.+?)\)/g, '$1').trim();
    return restore(stripped);
  };
  const blocks = [];
  let para = [], list = null, quote = [];
  let inCodeBlock = false, codeBlockLines = [];
  const flushPara = () => {
    if (para.length) {
      const rawChunk = para.join(' ');
      const segs = markdownToSegments(rawChunk);
      const hasEmphOrMath = segs.some(s => s.tf || s.uncontracted || s.type === 'math');
      if (hasEmphOrMath) {
        blocks.push({ type: 'para', segments: segs });
      } else {
        blocks.push(...textChunkToBlocks(inline(rawChunk)));
      }
    }
    para = [];
  };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  const flushQuote = () => {
    if (quote.length) {
      blocks.push({ type: 'note', text: quote.join(' ') });
      quote = [];
    }
  };
  const flushCode = () => {
    if (codeBlockLines.length) {
      blocks.push({ type: 'code', text: codeBlockLines.join('\n') });
      codeBlockLines = [];
    }
  };
  const flush = () => { flushPara(); flushList(); flushQuote(); flushCode(); };
  for (const raw of s.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        inCodeBlock = false;
        flushCode();
      } else {
        flush();
        inCodeBlock = true;
        codeBlockLines = [];
      }
      continue;
    }
    if (inCodeBlock) {
      codeBlockLines.push(raw);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      const level = m[1].length, text = inline(m[2]);
      const segs = markdownToSegments(m[2]);
      const hasEmphOrMath = segs.some(s => s.tf || s.uncontracted || s.type === 'math');
      if (level === 1 && !title) {
        title = text;
        blocks.push(hasEmphOrMath && segs.length ? { type: 'title', segments: segs, text } : { type: 'title', text });
      } else {
        blocks.push(hasEmphOrMath && segs.length ? { type: 'heading', level, segments: segs, text } : { type: 'heading', level, text });
      }
    } else if (/^\s*\|?\s*[: -]+(?:\s*\|\s*[: -]+)+\s*\|?\s*$/.test(line)) {
      flush(); // skip table separator | --- | --- |
    } else if (/^\s*\|(.+)\|\s*$/.test(line)) {
      const rowMatch = line.match(/^\s*\|(.+)\|\s*$/);
      const inner = rowMatch[1];
      const { masked, restore } = protectMathSpans(inner.replace(/\\\|/g, '\x00PIPE\x00'));
      const cells = masked.split('|').map((c) => {
        const restored = restore(c).replace(/\x00PIPE\x00/g, '|');
        return inline(restored).trim();
      });
      if (cells.length && cells.some(Boolean)) {
        flush();
        blocks.push({ type: 'para', text: cells.join(' | ') });
      }
    } else if ((m = line.match(/^(\s*)(?:([-*+])|(\d+[.)]))\s+(.*)$/))) {
      flushPara(); flushQuote();
      const indent = m[1].length;
      const lvl = Math.min(3, Math.floor(indent / 2));
      const marker = m[3] || null;
      const itText = inline(m[4]);
      const segs = markdownToSegments(m[4]);
      const hasEmphOrMath = segs.some(s => s.tf || s.uncontracted || s.type === 'math');
      const item = (hasEmphOrMath && segs.length) ? { segments: segs, text: itText } : { text: itText };
      if (marker) item.marker = marker;
      if (lvl > 0) item.level = lvl;
      (list ||= { type: 'list', items: [] }).items.push(item);
    } else if (/^\s*>/.test(line)) {
      flushPara(); flushList();
      quote.push(inline(line.replace(/^\s*>\s?/, '')));
    } else if (para.length > 0 && /^\s*(=+|-+)\s*$/.test(line)) {
      const hRaw = para.pop();
      flushPara();
      const level = line.trim().startsWith('=') ? 1 : 2;
      const text = inline(hRaw);
      const segs = splitInlineMath(text);
      if (level === 1 && !title) {
        title = text;
        blocks.push(segs && segs.length ? { type: 'title', segments: segs, text } : { type: 'title', text });
      } else {
        blocks.push(segs && segs.length ? { type: 'heading', level, segments: segs, text } : { type: 'heading', level, text });
      }
    } else {
      flushList(); flushQuote();
      para.push(line);
    }
  }
  flush();
  return { title, blocks };
}

// ---------- RTF (best-effort: strip control words/groups, \par -> paragraph) ----------
// Remove balanced {...} groups whose opening matches `startRe`. A real RTF font/
// colour table nests per-item subgroups ({\fonttbl{\f0 Arial;}{\f1 ...}}), which a
// simple [^{}] regex can't span — leaving font names as visible body text.
function stripRtfGroups(s, startRe) {
  let m;
  while ((m = startRe.exec(s))) {
    let depth = 0, end = s.length;
    for (let i = m.index; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}' && --depth === 0) { end = i + 1; break; }
    }
    s = s.slice(0, m.index) + s.slice(end);
  }
  return s;
}

export function parseRtf(str) {
  let s = str ?? '';
  s = stripRtfGroups(s, /\{\\\*/);                               // ignorable \* destinations (nested-safe)
  s = stripRtfGroups(s, /\{\\(?:fonttbl|colortbl|stylesheet|info|generator|pict|header|footer|listtable|listoverridetable)\b/i);

  const CP1252_MAP = {
    0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E', 0x85: '\u2026', 0x86: '\u2020', 0x87: '\u2021',
    0x88: '\u02C6', 0x89: '\u2030', 0x8A: '\u0160', 0x8B: '\u2039', 0x8C: '\u0152', 0x8E: '\u017D',
    0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
    0x98: '\u02DC', 0x99: '\u2122', 0x9A: '\u0161', 0x9B: '\u203A', 0x9C: '\u0153', 0x9E: '\u017E', 0x9F: '\u0178'
  };
  const decodeByte = (b) => (b >= 0x80 && b <= 0x9F) ? (CP1252_MAP[b] || String.fromCharCode(b)) : String.fromCharCode(b);

  let out = '';
  let uc = 1;
  let i = 0;
  while (i < s.length) {
    if (s[i] === '{' || s[i] === '}') {
      i++;
      continue;
    }
    if (s[i] === '\\') {
      i++;
      if (i >= s.length) break;
      const nextChar = s[i];
      if (nextChar === '\\' || nextChar === '{' || nextChar === '}') {
        out += nextChar;
        i++;
      } else if (nextChar === '~') {
        out += ' ';
        i++;
      } else if (nextChar === '_') {
        out += '-';
        i++;
      } else if (nextChar === '\'') {
        i++;
        const hex = s.slice(i, i + 2);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          out += decodeByte(parseInt(hex, 16));
          i += 2;
        }
      } else if (/[a-zA-Z]/.test(nextChar)) {
        let word = '';
        while (i < s.length && /[a-zA-Z]/.test(s[i])) {
          word += s[i];
          i++;
        }
        let param = '';
        if (i < s.length && (s[i] === '-' || /[0-9]/.test(s[i]))) {
          if (s[i] === '-') { param += '-'; i++; }
          while (i < s.length && /[0-9]/.test(s[i])) {
            param += s[i];
            i++;
          }
        }
        if (i < s.length && s[i] === ' ') {
          i++;
        }

        if (word === 'uc') {
          uc = parseInt(param || '1', 10);
        } else if (word === 'u') {
          const code = parseInt(param || '0', 10);
          out += String.fromCodePoint(((code % 65536) + 65536) % 65536);
          for (let k = 0; k < uc && i < s.length; k++) {
            if (s[i] === '\\' && s[i + 1] === '\'') {
              i += 4;
            } else if (s[i] === '{' || s[i] === '}') {
              break;
            } else {
              i++;
            }
          }
        } else if (word === 'par' || word === 'pard' || word === 'line') {
          out += '\n';
        } else if (word === 'tab') {
          out += ' ';
        } else if (word === 'ldblquote') {
          out += '“';
        } else if (word === 'rdblquote') {
          out += '”';
        } else if (word === 'lquote') {
          out += '‘';
        } else if (word === 'rquote') {
          out += '’';
        } else if (word === 'emdash') {
          out += '—';
        } else if (word === 'endash') {
          out += '–';
        } else if (word === 'bullet') {
          out += '• ';
        } else if (word === 'cell' || word === 'nestcell') {
          out += ' | ';
        } else if (word === 'row' || word === 'nestrow') {
          out += '\n';
        }
      } else {
        i++;
      }
    } else {
      out += s[i];
      i++;
    }
  }

  const paras = out.split('\n').map((t) => t.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  const blocks = [];
  let title = null;
  paras.forEach((p, i) => {
    if (i === 0 && p.length <= 60 && paras.length > 1) { title = p; blocks.push({ type: 'title', text: p }); }
    else blocks.push(...textChunkToBlocks(p));
  });
  return { title, blocks };
}

// ---------- ODT (OpenDocument text) ----------
function getOdtText(el) {
  let res = '';
  for (const child of el.childNodes || []) {
    if (child.nodeType === 3) {
      res += child.nodeValue;
    } else if (child.nodeType === 1) {
      const ln = child.localName;
      if (ln === 's') {
        const c = parseInt(child.getAttributeNS('urn:oasis:names:tc:opendocument:xmlns:text:1.0', 'c') || child.getAttribute('text:c') || '1', 10) || 1;
        res += ' '.repeat(c);
      } else if (ln === 'tab' || ln === 'line-break') {
        res += ' ';
      } else {
        res += getOdtText(child);
      }
    }
  }
  return res;
}

export async function parseOdt(arrayBuffer) {
  const xml = new TextDecoder().decode(await unzipEntry(arrayBuffer, 'content.xml'));
  const doc = parseXml(xml);
  const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
  const body = doc.getElementsByTagNameNS('*', 'text')[0] || doc.documentElement;
  const blocks = [];
  let title = null;

  function parseOdtList(listEl, lvl = 0) {
    const items = [];
    for (const child of listEl.childNodes || []) {
      if (child.nodeType !== 1 || (child.localName !== 'list-item' && child.tagName !== 'text:list-item')) continue;
      let directText = '';
      const nestedLists = [];
      for (const c of child.childNodes || []) {
        if (c.nodeType === 3) {
          directText += c.nodeValue;
        } else if (c.nodeType === 1) {
          const cLn = c.localName;
          if (cLn === 'list') {
            nestedLists.push(c);
          } else {
            directText += getOdtText(c) + ' ';
          }
        }
      }
      directText = directText.replace(/\s+/g, ' ').trim();
      if (directText) {
        const it = { text: directText };
        if (lvl > 0) it.level = lvl;
        items.push(it);
      }
      for (const nl of nestedLists) {
        items.push(...parseOdtList(nl, lvl + 1));
      }
    }
    return items;
  }

  const walk = (el) => {
    for (const node of el.childNodes || []) {
      if (node.nodeType !== 1) continue;
      const ln = node.localName;
      const text = getOdtText(node).replace(/\s+/g, ' ').trim();
      if (ln === 'h') {
        if (!text) continue;
        const lvl = Number(node.getAttributeNS(TEXT, 'outline-level') || 1);
        blocks.push({ type: 'heading', level: Math.min(6, lvl || 1), text });
      } else if (ln === 'p') {
        if (!text) continue;
        const style = (node.getAttributeNS(TEXT, 'style-name') || '').toLowerCase();
        if (/title/.test(style) && !title) { title = text; blocks.push({ type: 'title', text }); }
        else blocks.push({ type: 'para', text });
      } else if (ln === 'list') {
        const items = parseOdtList(node, 0);
        if (items.length) blocks.push({ type: 'list', items });
      } else if (ln === 'table') {
        const headers = [];
        const rows = [];
        for (const child of node.childNodes || []) {
          if (child.nodeType !== 1) continue;
          if (child.localName === 'table-header-rows') {
            for (const tr of child.childNodes || []) {
              if (tr.nodeType !== 1 || tr.localName !== 'table-row') continue;
              const cells = [];
              for (const tc of tr.childNodes || []) {
                if (tc.nodeType !== 1 || tc.localName !== 'table-cell') continue;
                cells.push(getOdtText(tc).replace(/\s+/g, ' ').trim());
              }
              if (cells.length) headers.push(...cells);
            }
          } else if (child.localName === 'table-row') {
            const cells = [];
            for (const tc of child.childNodes || []) {
              if (tc.nodeType !== 1 || tc.localName !== 'table-cell') continue;
              cells.push(getOdtText(tc).replace(/\s+/g, ' ').trim());
            }
            if (cells.length) rows.push(cells);
          }
        }
        if (headers.length || rows.length) {
          blocks.push({ type: 'table', headers, rows });
        }
      } else if (node.childNodes?.length) {
        walk(node);
      }
    }
  };
  walk(body);
  return { title, blocks };
}

// ---------- EPUB (spine of XHTML) ----------
export async function parseEpub(arrayBuffer) {
  const dec = new TextDecoder();
  const container = dec.decode(await unzipEntry(arrayBuffer, 'META-INF/container.xml'));
  const cdoc = parseXml(container);
  const opfPath = cdoc.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('epub: container has no rootfile');
  const opf = dec.decode(await unzipEntry(arrayBuffer, opfPath));
  const odoc = parseXml(opf);
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = {};
  for (const it of odoc.getElementsByTagNameNS('*', 'item')) {
    manifest[it.getAttribute('id')] = {
      href: it.getAttribute('href'),
      props: (it.getAttribute('properties') || '').toLowerCase(),
      mediaType: (it.getAttribute('media-type') || '').toLowerCase()
    };
  }
  const title = odoc.getElementsByTagNameNS('*', 'title')[0]?.textContent?.trim() || null;
  const blocks = [];
  for (const ref of odoc.getElementsByTagNameNS('*', 'itemref')) {
    const linear = ref.getAttribute('linear');
    if (linear === 'no') continue;
    const item = manifest[ref.getAttribute('idref')];
    if (!item || !item.href) continue;
    if (item.props.includes('nav')) continue;
    const targetPath = base + item.href.split('#')[0];
    let entryBytes = null;
    try {
      entryBytes = await unzipEntry(arrayBuffer, targetPath);
    } catch {
      try {
        entryBytes = await unzipEntry(arrayBuffer, decodeURIComponent(targetPath));
      } catch { /* skip missing part */ }
    }
    if (entryBytes) {
      const html = dec.decode(entryBytes);
      blocks.push(...parseHtml(html).blocks);
    }
  }
  return { title, blocks };
}

// ---------- DAISY 3 / NIMAS DTBook XML ----------

/**
 * Decodes a `data:image/svg+xml[;base64],…` URI (as written by the NIMAS
 * exporter for tactile graphics) back into SVG markup. Returns null for any
 * other src.
 * @param {string} src
 * @returns {string|null}
 */
function svgFromDataUri(src) {
  if (typeof src !== 'string' || !/^data:image\/svg\+xml/i.test(src)) return null;
  const comma = src.indexOf(',');
  if (comma === -1) return null;
  const header = src.slice(5, comma);
  const payload = src.slice(comma + 1);
  try {
    let svg;
    if (/;base64/i.test(header)) {
      if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        svg = Buffer.from(payload, 'base64').toString('utf8');
      } else {
        const bin = atob(payload);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        svg = new TextDecoder('utf-8').decode(bytes);
      }
    } else {
      svg = decodeURIComponent(payload);
    }
    return svg && /<svg[\s>]/i.test(svg) ? svg : null;
  } catch {
    return null;
  }
}

export function parseDtbook(xmlStr) {
  const doc = parseXml(xmlStr);
  const root = doc.documentElement;
  const rootTag = (root?.localName || root?.tagName || '').toLowerCase();
  const metadata = {};
  if (root?.getAttribute) {
    const lang = root.getAttribute('xml:lang') || root.getAttribute('lang');
    if (lang) metadata.lang = lang;
  }
  const doctitle = doc.getElementsByTagName ? (doc.getElementsByTagName('doctitle')[0] || doc.getElementsByTagName('title')[0]) : null;
  // Line breaks (<br/>) in a title separate words (A28: "UIRNTTDINCOO<br/>À" ran together).
  const textOf = (el) => {
    let t = '';
    (function walk(n) { for (let k = n.firstChild; k; k = k.nextSibling) { if (k.nodeType === 3) t += k.nodeValue; else if (k.nodeType === 1) { if ((k.localName || k.tagName || '').toLowerCase() === 'br') t += ' '; else walk(k); } } })(el);
    return t.replace(/\s+/g, ' ').trim();
  };
  let title = (doctitle && textOf(doctitle)) || null;
  if (doc.getElementsByTagName) {
    const metaTags = [...doc.getElementsByTagName('meta')];
    for (const m of metaTags) {
      const name = m.getAttribute ? m.getAttribute('name') : null;
      const content = m.getAttribute ? (m.getAttribute('content') || '').trim() : '';
      if (!name || !content) continue;
      const lname = name.toLowerCase();
      if (lname === 'dtb:uid') metadata.uid = content;
      else if (lname === 'dc:title') {
        metadata.title = content;
        if (!title) title = content;
      } else if (lname === 'dc:publisher') metadata.publisher = content;
      else if (lname === 'dc:date') metadata.date = content;
      else if (lname === 'dc:creator') metadata.creator = content;
      else if (lname === 'dc:identifier') metadata.identifier = content;
      else if (lname === 'dc:language') metadata.language = content;
      else if (lname === 'dc:source') metadata.source = content;
      else if (lname === 'dc:rights') metadata.rights = content;
      else if (lname === 'dc:format') metadata.format = content;
      else if (lname === 'dc:subject') metadata.subject = content;
      else if (lname.startsWith('nimas-')) {
        if (!metadata.nimas) metadata.nimas = {};
        metadata.nimas[name] = content;
      }
    }
    if (!metadata.lang && metadata.language) metadata.lang = metadata.language;
    // <docauthor> is book content (the exporter writes it back from metadata.docauthor).
    // Every <docauthor> (a book may have several; A28).
    const docauthors = [...doc.getElementsByTagName('docauthor')].map((el) => textOf(el)).filter(Boolean);
    if (docauthors.length) {
      metadata.docauthor = docauthors[0];
      if (docauthors.length > 1) metadata.docauthors = docauthors;
    }
  }
  const blocks = [];

  if (rootTag === 'math' || rootTag.endsWith(':math')) {
    const mathml = mathOuterXml(root);
    const latex = mathmlToLatex(mathml);
    const blk = { type: 'math', mathml };
    if (latex) blk.latex = latex;
    blocks.push(blk);
    return { title: null, blocks };
  }

  const TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4;

  const BLOCK_TAGS = new Set(['p', 'div', 'li', 'lic', 'tr', 'td', 'th', 'hd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'sidebar', 'note', 'caption', 'prodnote', 'dt', 'dd', 'line', 'ln', 'speaker', 'stage', 'blockquote', 'byline', 'author', 'cite', 'attrib']);
  const LIST_TAGS = new Set(['list', 'ul', 'ol']);
  const INLINE_IN_TEXT = new Set(['cite', 'author']);
  const TEXT_PARENTS = new Set(['p', 'li', 'lic', 'td', 'th', 'dd', 'dt', 'hd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'caption', 'line', 'ln', 'span', 'em', 'strong', 'q', 'a', 'sent', 'w', 'dfn', 'sub', 'sup']);
  const LIST_AND_TABLE_TAGS = new Set(['list', 'ul', 'ol', 'table', 'note']);
  const LI_SPLIT_TAGS = new Set(['note', 'imggroup', 'img', 'image']); // split out of a list item (tables are skipped by inlineSegments already)
  const IMAGE_TAGS = new Set(['imggroup', 'img', 'image']);
  // A print line number: <linenum>, or an element classed "linenum" / "line-number".
  const isLinenumEl = (el) => {
    const t = (el.localName || el.tagName || '').toLowerCase();
    const c = ((el.getAttribute && el.getAttribute('class')) || '').toLowerCase();
    return t === 'linenum' || c.includes('linenum') || c.includes('line-number');
  };
  const findLinenum = (el) => {
    for (let k = el.firstChild; k; k = k.nextSibling) {
      if (k.nodeType !== 1) continue;
      if (isLinenumEl(k)) return k;
      const inner = findLinenum(k);
      if (inner) return inner;
    }
    return null;
  };
  // Verse lines carry their number as a prefix (parsePoem); elsewhere it is a segment (A30).
  const inVerseLine = (el) => {
    for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) {
      const t = (p.localName || p.tagName || '').toLowerCase();
      if (t === 'line' || t === 'ln') return true;
    }
    return false;
  };
  const guessedPages = new WeakMap();                     // contents item → its text before a trailing number was taken as the page
  // Inline (phrase) elements; any other child element starts a block.
  const INLINE_TAGS = new Set(['a', 'abbr', 'acronym', 'annoref', 'author', 'b', 'bdo', 'big', 'br', 'cite', 'code', 'dfn', 'em', 'i', 'kbd', 'linenum', 'math', 'noteref', 'q', 'samp', 'sent', 'small', 'span', 'strong', 'sub', 'sup', 'tt', 'u', 'var', 'w']);
  const hasBlockChild = (el) => [...(el.childNodes || [])].some((n) => {
    if (n.nodeType !== 1) return false;
    const t = (n.localName || n.tagName || '').toLowerCase();
    return !INLINE_TAGS.has(t) && !PAGENUM_TAGS.has(t) && !t.endsWith(':math');
  });
  const PAGENUM_TAGS = new Set(['pagenum', 'print-page']);
  function getCleanText(el, excludeTags = null) {
    if (!el) return '';
    const hasExclude = excludeTags && typeof excludeTags.has === 'function';
    let text = '';
    function collect(node) {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          text += child.nodeValue || '';
        } else if (child.nodeType === 1) {
          const tag = (child.localName || child.tagName || '').toLowerCase();
          if (hasExclude && excludeTags.has(tag)) { if (IMAGE_TAGS.has(tag)) text += ' '; continue; }
          const cls = (child.getAttribute ? (child.getAttribute('class') || '') : '').toLowerCase();
          if (tag === 'img' || tag === 'image') { text += ' '; continue; }
          if (tag === 'brl' || tag === 'linenum' || cls.includes('linenum') || cls.includes('line-number')) continue;
          // A print page turn is never part of the running text ("…know, xxixtake a moment…");
          // pagenumBlock() / inlineSegments() carry it as its own block or segment instead.
          if (PAGENUM_TAGS.has(tag)) continue;
          // <cite>/<author> are inline inside running text ("…of <cite>Broca's Brain</cite>."
          // must not become "Brain ."); as a direct child of a blockquote/poem they are lines.
          const parentTag = (node.localName || node.tagName || '').toLowerCase();
          const isBlock = BLOCK_TAGS.has(tag) && !(INLINE_IN_TEXT.has(tag) && TEXT_PARENTS.has(parentTag));
          if (isBlock) text += ' ';
          collect(child);
          if (isBlock) text += ' ';
        }
      }
    }
    collect(el);
    return text.replace(/\s+/g, ' ').trim();
  }

  // A page column: several linked references side by side (<a>p. 98</a><a>p. 101</a>) are
  // separate references, joined with ", " (they ran together as "p. 98p. 101").
  function pageColumnText(el, excludeTags = null) {
    const kids = [...(el.childNodes || [])];
    const links = kids.filter((k) => k.nodeType === 1 && (k.localName || k.tagName || '').toLowerCase() === 'a');
    const onlyLinks = kids.every((k) => (k.nodeType === 3 ? !k.nodeValue.trim() : k.nodeType !== 1 || links.includes(k)));
    if (links.length > 1 && onlyLinks) return links.map((a) => getCleanText(a, excludeTags)).filter(Boolean).join(', ');
    return getCleanText(el, excludeTags);
  }

  // ---- print page turns (<pagenum>) inside running text ----
  // DTBook allows <pagenum> anywhere a print page changes: between blocks, but also inside
  // <p>, <h2>, <li>, <td>… The formatter needs it as a block (BANA §1.11.3 page change
  // indicator; B004 §8 print page turn indicator), so the helpers below lift it out of
  // inline content: a paragraph is split around it (text resumes in cell 1 — both standards),
  // anything that cannot be split (heading, verse line, note, list item) gets the turn hoisted
  // before it when it precedes all content, otherwise after it.
  function pagenumBlock(el) {
    if (!el) return null;
    const attr = (name) => (el.getAttribute ? (el.getAttribute(name) || '') : '');
    let value = getCleanText(el);
    if (!value) {
      // Empty element: the number is often only in the id ("page_12", "p-xiv").
      const m = attr('id').match(/(\d+|[ivxlcdm]+)\s*$/i);
      value = m ? m[1] : '';
    }
    if (!value) return null;
    const block = { type: 'pagenum', text: value, page: value };
    const id = attr('id').trim();
    if (id) block.id = id;                              // kept so a round trip preserves the source ids
    const pageType = attr('page').toLowerCase();       // front | normal | special (DTBook @page)
    if (pageType === 'front' || pageType === 'normal' || pageType === 'special') block.pageType = pageType;
    return block;
  }

  // Trim leading/trailing whitespace-only text at the edges of a segment run (in place).
  function trimSegmentEdges(split) {
    while (split.length > 0 && split[0].type === 'text' && !split[0].tf && !split[0].uncontracted && /^\s*$/.test(split[0].text || '')) {
      split.shift();
    }
    if (split.length > 0 && split[0].type === 'text' && split[0].text) {
      split[0].text = split[0].text.replace(/^\s+/, '');
      if (!split[0].text) split.shift();
    }
    while (split.length > 0 && split[split.length - 1].type === 'text' && !split[split.length - 1].tf && !split[split.length - 1].uncontracted && /^\s*$/.test(split[split.length - 1].text || '')) {
      split.pop();
    }
    if (split.length > 0 && split[split.length - 1].type === 'text' && split[split.length - 1].text) {
      split[split.length - 1].text = split[split.length - 1].text.replace(/\s+$/, '');
      if (!split[split.length - 1].text) split.pop();
    }
    return split;
  }

  function segsHavePagenum(segs) {
    return segs.some((s) => s && s.type === 'pagenum');
  }

  // For content whose page turns are collected separately (collectPagenums): drop the
  // pagenum segments so they are not also carried inside the block's segments.
  function segsWithoutPagenums(segs) {
    return segsHavePagenum(segs) ? trimSegmentEdges(segs.filter((s) => s.type !== 'pagenum')) : segs;
  }

  function segsHaveEmphOrMath(segs) {
    return segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || s.type === 'noteref' || s.type === 'linenum' || (s.text && s.text.includes('\n')));
  }

  function segsText(segs) {
    return segs.map((s) => (s.type === 'math' ? (s.latex || '') : (s.text || ''))).join('').replace(/\s+/g, ' ').trim();
  }

  // Page turns before any content → `before`; all others → `after`; `segs` is the content.
  function hoistPagenums(segs) {
    const before = [], after = [], rest = [];
    let seen = false;
    for (const s of segs) {
      if (s.type === 'pagenum') (seen ? after : before).push(s.block);
      else { seen = true; rest.push(s); }
    }
    return { before, after, segs: trimSegmentEdges(rest) };
  }

  // Split a paragraph's segments around its page turns and push the pieces:
  // para … pagenum … para(continuation). makeBlock(text, segmentsOrUndefined) builds each
  // piece; pieces on either side of a turn are linked with `continued` / `continuation` so
  // the formatter resumes in cell 1 and the exporter can rejoin them into one <p>.
  function pushParaParts(segs, target, makeBlock) {
    let cur = [];
    let prevPara = null;
    const flushCur = () => {
      const part = trimSegmentEdges(cur);
      cur = [];
      const t = segsText(part);
      if (!t) return;
      const blk = makeBlock(t, segsHaveEmphOrMath(part) && part.length ? part : undefined);
      if (!blk) return;
      if (prevPara) { prevPara.continued = true; blk.continuation = true; }
      target.push(blk);
      prevPara = blk;
    };
    for (const s of segs) {
      if (s.type === 'pagenum') { flushCur(); target.push(s.block); }
      else cur.push(s);
    }
    flushCur();
  }

  // Page turns anywhere under `el` (document order) for elements whose content is only read
  // with getCleanText(); nested block containers listed in `skipTags` handle their own.
  function collectPagenums(el, skipTags = null) {
    const before = [], after = [];
    let seen = false;
    function visit(node) {
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          if ((child.nodeValue || '').trim()) seen = true;
        } else if (child.nodeType === 1) {
          const tag = (child.localName || child.tagName || '').toLowerCase();
          if (skipTags && skipTags.has(tag)) continue;
          if (PAGENUM_TAGS.has(tag)) {
            const pn = pagenumBlock(child);
            if (pn) (seen ? after : before).push(pn);
            continue;
          }
          visit(child);
        }
      }
    }
    visit(el);
    return { before, after };
  }

  // Emit one block built from an element's inline content, with its page turns hoisted
  // around it. build(text, segmentsOrUndefined) returns the block (or null to emit nothing).
  function pushAtomic(target, el, build, opts = {}) {
    const pn = hoistPagenums(inlineSegments(el, !!opts.skipLists, opts.excludeTags || null));
    const t = getCleanText(el, opts.excludeTags || null);
    target.push(...pn.before);
    const blk = build(t, segsHaveEmphOrMath(pn.segs) && pn.segs.length ? pn.segs : undefined);
    if (blk) target.push(blk);
    target.push(...pn.after);
  }

  // <imggroup> (A26): one graphic block per image, the group's caption(s) and production
  // note(s) on the first — caption with its inline segments (note references…), the prodnote
  // as the image description (BANA Formats §6.2–6.3). A caption-only group (the exporter's
  // loose figure caption) stays a caption block.
  function parseImgGroup(el, target) {
    const kids = [];
    (function walk(n) {
      for (let k = n.firstChild; k; k = k.nextSibling) {
        if (k.nodeType !== 1) continue;
        const t = (k.localName || k.tagName || '').toLowerCase();
        if (t === 'img' || t === 'image' || t === 'caption' || t === 'prodnote' || PAGENUM_TAGS.has(t)) kids.push([t, k]);
        else walk(k);
      }
    })(el);
    const imgs = kids.filter(([t]) => t === 'img' || t === 'image').map(([, k]) => k);
    const caps = kids.filter(([t]) => t === 'caption').map(([, k]) => k);
    const notes = kids.filter(([t]) => t === 'prodnote').map(([, k]) => k);
    if (!imgs.length && caps.length && !notes.length) {
      for (const cap of caps) pushAtomic(target, cap, (t, segs) => (t ? (segs ? { type: 'caption', text: t, segments: segs } : { type: 'caption', text: t }) : null));
      return;
    }
    const pn = collectPagenums(el);
    target.push(...pn.before);
    const graphics = imgs.map((img) => {
      const src = (img.getAttribute && img.getAttribute('src')) || '';
      const alt = (img.getAttribute && img.getAttribute('alt')) || '';
      const g = { type: 'graphic', src, alt };
      const svg = svgFromDataUri(src);
      if (svg) g.svg = svg;                                  // the editor's tactile graphic
      return g;
    });
    const first = graphics[0] || { type: 'graphic', src: '', alt: (el.getAttribute && el.getAttribute('alt')) || '' };
    if (caps.length) {
      const joined = caps.flatMap((cap, i) => [...(i ? [{ type: 'text', text: ' ' }] : []), ...segsWithoutPagenums(inlineSegments(cap))]);
      const segs = [];                                       // adjacent runs of the same form merge (as a re-parse does)
      for (const g of joined) {
        const last = segs[segs.length - 1];
        if (g.type === 'text' && last && last.type === 'text' && (last.tf || 0) === (g.tf || 0) && !!last.uncontracted === !!g.uncontracted) segs[segs.length - 1] = { ...last, text: last.text + g.text };
        else segs.push(g);
      }
      const text = caps.map((cap) => getCleanText(cap)).filter(Boolean).join(' ');
      if (text) {
        first.caption = text;
        if (segsHaveEmphOrMath(segs)) first.captionSegments = segs;
      }
    }
    const description = notes.map((n) => getCleanText(n)).filter(Boolean).join(' ');
    // The exporter writes a tactile graphic's alt text as its prodnote: not a separate description.
    if (description && !(first.svg && description === first.alt)) first.description = description;
    if (!graphics.length) {
      if (first.caption || first.description) target.push(first);
    } else target.push(...graphics);
    target.push(...pn.after);
  }

  // An <imggroup>, or a loose <img>, as graphic blocks.
  function pushImage(target, el) {
    const t = (el.localName || el.tagName || '').toLowerCase();
    if (t === 'imggroup') { parseImgGroup(el, target); return; }
    const src = (el.getAttribute && el.getAttribute('src')) || '';
    const alt = (el.getAttribute && el.getAttribute('alt')) || '';
    const g = { type: 'graphic', src, alt };
    const svg = svgFromDataUri(src);
    if (svg) g.svg = svg;
    target.push(g);
  }

  // The images inside a text element (a heading, a sidebar sentence…): the outermost
  // imggroups and loose imgs, in document order, as graphic blocks (A29).
  function imagesWithin(el) {
    const out = [];
    (function walk(n) {
      for (let k = n.firstChild; k; k = k.nextSibling) {
        if (k.nodeType !== 1) continue;
        if (IMAGE_TAGS.has((k.localName || k.tagName || '').toLowerCase())) pushImage(out, k);
        else walk(k);
      }
    })(el);
    return out;
  }

  // A DTBook <note> is always a footnote or endnote (transcriber's notes are <prodnote>):
  // kept with its id (the target of <noteref>) and its inline segments.
  function pushNote(target, el) {
    const cls = ((el.getAttribute && el.getAttribute('class')) || '').toLowerCase();
    const id = (el.getAttribute && el.getAttribute('id')) || '';
    pushAtomic(target, el, (t, segs) => {
      if (!t) return null;
      const blk = { type: 'footnote', text: t };
      if (segs) blk.segments = segs;
      if (id) blk.id = id;
      if (cls.includes('endnote') || cls.includes('rearnote')) blk.kind = 'endnote';
      return blk;
    }, { excludeTags: NOTE_SPLIT_TAGS });
    // A note's tables and images follow it as their own blocks (A2).
    (function split(n) {
      for (let k = n.firstChild; k; k = k.nextSibling) {
        if (k.nodeType !== 1) continue;
        const t = (k.localName || k.tagName || '').toLowerCase();
        if (t === 'table') parseTable(k, target);
        else if (IMAGE_TAGS.has(t)) pushImage(target, k);
        else split(k);
      }
    })(el);
  }
  const NOTE_SPLIT_TAGS = new Set(['table', 'imggroup', 'img', 'image']);

  // Same for elements read only with getCleanText() (notes, captions, definitions…).
  function pushTextOnly(target, el, build, skipTags = null) {
    const pn = collectPagenums(el, skipTags);
    target.push(...pn.before);
    const blk = build(getCleanText(el));
    if (blk) target.push(blk);
    target.push(...pn.after);
  }

  const PHONETIC_KEY_REGEX = /\(([a-zA-Z\u0080-\u02FF\u0300-\u036F\u0400-\u04FF\s\u00B4\u0060\-\/]+)\)/g;
  function isPhoneticKey(inner) {
    if (!inner || !inner.includes('-')) return false;
    return /[\u00B4\u0060\u02C8\u02CC\u0300-\u036F\u04D0-\u04D9\u0100-\u024F\u0250-\u02AFāăēĕīĭōŏūŭəәǝ]/i.test(inner);
  }

  function splitPhoneticSegments(segs) {
    const result = [];
    for (const seg of segs) {
      if (!seg || seg.type !== 'text' || seg.uncontracted || !seg.text) {
        result.push(seg);
        continue;
      }
      const str = seg.text;
      PHONETIC_KEY_REGEX.lastIndex = 0;
      let match;
      let lastIdx = 0;
      let hasPhonetic = false;
      while ((match = PHONETIC_KEY_REGEX.exec(str)) !== null) {
        if (isPhoneticKey(match[1])) {
          hasPhonetic = true;
          const before = str.slice(lastIdx, match.index);
          if (before) {
            const s = { type: 'text', text: before };
            if (seg.tf) s.tf = seg.tf;
            result.push(s);
          }
          const pSeg = { type: 'text', text: match[0], uncontracted: true };
          if (seg.tf) pSeg.tf = seg.tf;
          result.push(pSeg);
          lastIdx = match.index + match[0].length;
        }
      }
      if (hasPhonetic) {
        const after = str.slice(lastIdx);
        if (after) {
          const s = { type: 'text', text: after };
          if (seg.tf) s.tf = seg.tf;
          result.push(s);
        }
      } else {
        result.push(seg);
      }
    }
    return result;
  }

  function inlineSegments(el, skipLists = false, excludeTags = null) {
    const hasExclude = excludeTags && typeof excludeTags.has === 'function';
    const segments = [];
    let text = '';
    let curTf = 0;
    let curUnc = false;

    function flush() {
      if (text) {
        const seg = { type: 'text', text };
        if (curTf) seg.tf = curTf;
        if (curUnc) seg.uncontracted = true;
        segments.push(seg);
        text = '';
      }
    }

    // A block-level child (a <p> or <div> in a list item…) is a word boundary (A2: "amberbq").
    function breakWord() {
      if (text) { if (!/\s$/.test(text)) text += ' '; return; }
      const last = segments[segments.length - 1];
      if (last && last.type === 'text' && last.text && !/\s$/.test(last.text)) last.text += ' ';
    }

    function walkInline(node, parentTf, parentUnc) {
      const parentTag = (node.localName || node.tagName || '').toLowerCase();
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          let val = child.nodeValue;
          if (val) {
            val = val.replace(/\s+/g, ' ');
            if (parentTf !== curTf || parentUnc !== curUnc) {
              flush();
              curTf = parentTf;
              curUnc = parentUnc;
            }
            if (text.endsWith(' ') && val.startsWith(' ')) {
              val = val.slice(1);
            }
            text += val;
          }
        } else if (child.nodeType === 1) {
          const tag = (child.localName || child.tagName || '').toLowerCase();
          const cls = (child.getAttribute ? (child.getAttribute('class') || '') : '').toLowerCase();
          if (tag === 'table' || tag === 'sidebar' || tag === 'brl' || (skipLists && (tag === 'list' || tag === 'ul' || tag === 'ol'))) continue;
          if (hasExclude && excludeTags.has(tag)) { if (IMAGE_TAGS.has(tag)) breakWord(); continue; }   // "kr<img/>n" is not "krn"
          if (PAGENUM_TAGS.has(tag)) {
            flush();
            const pn = pagenumBlock(child);
            if (pn) segments.push({ type: 'pagenum', block: pn });
            continue;
          }
          let nextTf = parentTf;
          let nextUnc = parentUnc;

          if (tag === 'linenum' || cls.includes('linenum') || cls.includes('line-number')) {
            // A print line number in prose (BANA Formats §15.4; A30) is kept as a segment.
            const num = (child.textContent || '').replace(/\s+/g, ' ').trim();
            if (num && !inVerseLine(child)) {
              flush();
              segments.push({ type: 'linenum', text: num });
            }
            continue;
          }
          if (tag === 'img' || tag === 'image') { breakWord(); continue; }

          // Separate list-item components and inline production notes from the text around them.
          const spaced = tag === 'lic' || tag === 'prodnote' || tag === 'annotation';
          if (spaced && text && !text.endsWith(' ')) {
            flush();
            text += ' ';
          }

          const unlinkedRef = tag === 'span' && /(^|\s)(noteref|annoref)(\s|$)/.test(cls);   // the exporter's unlinked reference
          if (tag === 'noteref' || tag === 'annoref' || unlinkedRef) {
            // A note reference keeps its mark and target (A5): braille superscripts it
            // (BANA Formats §16.2.2) and the save writes it back as <noteref>.
            const mark = (child.textContent || '').replace(/\s+/g, ' ').trim();
            // BrailleBlaster's own files put the target in @id; DTBook uses @idref="#…".
            const idref = String((child.getAttribute && (child.getAttribute('idref') || child.getAttribute('id'))) || '').replace(/^#/, '');
            if (mark) {
              flush();
              const seg = { type: 'noteref', text: mark };
              if (idref) seg.idref = idref;
              if (tag === 'annoref' || (unlinkedRef && cls.includes('annoref'))) seg.annoref = true;
              segments.push(seg);
            }
            continue;
          }
          if (tag === 'b' || tag === 'strong') nextTf |= TF_BOLD;
          else if (tag === 'i' || tag === 'em') nextTf |= TF_ITALIC;
          else if (tag === 'u' || cls.includes('underline')) nextTf |= TF_UNDERLINE;
          else if (tag === 'code' || cls.includes('uncontracted') || cls.includes('bai-trans4') || cls.includes('phonetic') || cls.includes('pronunciation') || cls.includes('pron') || cls.includes('ipa')) nextUnc = true;
          else if (tag === 'br') {
            flush();
            text += '\n';
            continue;
          } else if (tag === 'math' || tag.endsWith(':math')) {
            flush();
            const mathml = mathOuterXml(child);
            const alttext = child.getAttribute ? child.getAttribute('alttext') : null;
            let latex = alttext || null;
            const ann = child.getElementsByTagName ? [...child.getElementsByTagName('annotation'), ...child.getElementsByTagName('m:annotation')] : [];
            const texAnn = ann.find(a => (a.getAttribute ? (a.getAttribute('encoding') || '') : '').includes('tex'));
            if (texAnn && texAnn.textContent) latex = texAnn.textContent.trim();
            if (!latex && mathml) latex = mathmlToLatex(mathml);
            const mathSeg = { type: 'math', mathml };
            if (latex) mathSeg.latex = latex;
            segments.push(mathSeg);
            continue;
          }
          const blockChild = !spaced && tag !== 'br' && BLOCK_TAGS.has(tag) && !(INLINE_IN_TEXT.has(tag) && TEXT_PARENTS.has(parentTag));
          if (blockChild) breakWord();
          walkInline(child, nextTf, nextUnc);
          if (blockChild) breakWord();
          if (spaced && (tag === 'prodnote' || tag === 'annotation') && text && !text.endsWith(' ')) text += ' ';
        }
      }
    }

    walkInline(el, 0, false);
    flush();
    const split = splitPhoneticSegments(segments);
    for (const seg of split) {
      if (seg.type === 'text' && seg.text) {
        seg.text = seg.text.replace(/[^\S\r\n]+/g, ' ');
      }
    }
    return trimSegmentEdges(split);
  }

  function getElementLevel(node) {
    if (!node || !node.getAttribute) return 0;
    const cls = (node.getAttribute('class') || '').toLowerCase();
    const match = cls.match(/\blevel-(\d+)\b/) || cls.match(/\btoc-level-(\d+)\b/);
    if (match) return parseInt(match[1], 10) || 0;
    const attr = node.getAttribute('level');
    if (attr) return parseInt(attr, 10) || 0;
    return 0;
  }

  function parseSingleList(child, listLvl = 0, targetBlocks = blocks) {
    const listClass = (child.getAttribute ? child.getAttribute('class') : '') || '';
    const listTypeAttr = (child.getAttribute ? child.getAttribute('type') : '') || '';
    const isOl = listTypeAttr.toLowerCase() === 'ordered' || listTypeAttr.toLowerCase() === 'ol' || (child.getAttribute && child.getAttribute('enum') != null);
    // @enum ("a"/"A"/"i"/"I") picks letters/roman numerals over plain digits when a
    // marker has to be synthesized below (A31: nimas-export writes it for a clean
    // nested run instead of embedding the marker text in every item).
    const enumAttr = (child.getAttribute && child.getAttribute('enum')) || null;

    // Check for child <hd> / heading inside <list> and emit it as a preceding heading
    for (let c = child.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const cTag = (c.localName || c.tagName || '').toLowerCase();
      if (cTag === 'hd' || cTag === 'title' || /^h[1-6]$/.test(cTag)) {
        if (targetBlocks) pushAtomic(targetBlocks, c, (t, segs) => (t ? (segs ? { type: 'heading', level: 3, text: t, segments: segs } : { type: 'heading', level: 3, text: t }) : null));
      }
    }
    
    let isToc = listClass.toLowerCase().includes('toc') || (child.getAttribute && (child.getAttribute('id') || '').toLowerCase().includes('toc'));
    let isIndex = listClass.toLowerCase().includes('index') || (child.getAttribute && (child.getAttribute('id') || '').toLowerCase().includes('index'));
    if (!isToc && !isIndex) {
      // Check parent container (e.g., <level1 class="toc"> or <sidebar id="toc"> or previous sibling heading)
      let p = child.parentNode;
      while (p && p.nodeType === 1) {
        const pCls = (p.getAttribute ? (p.getAttribute('class') || '') : '').toLowerCase();
        const pId = (p.getAttribute ? (p.getAttribute('id') || '') : '').toLowerCase();
        if (pCls.includes('toc') || pId.includes('toc')) {
          isToc = true;
          break;
        }
        if (pCls.includes('index') || pId.includes('index')) {
          isIndex = true;
          break;
        }
        const pTag = (p.localName || p.tagName || '').toLowerCase();
        if (/^level[1-6]$/.test(pTag) || pTag === 'sidebar' || pTag === 'div' || pTag === 'section') {
          // Check preceding sibling headings inside the container
          for (let sib = child.previousSibling; sib; sib = sib.previousSibling) {
            if (sib.nodeType === 1) {
              const sTag = (sib.localName || sib.tagName || '').toLowerCase();
              // A contents/index heading governs only the list that directly follows it:
              // once another list (or table/box) intervenes, this one is ordinary.
              if (sTag === 'list' || sTag === 'dl' || sTag === 'table' || sTag === 'sidebar') break;
              if (sTag === 'hd' || /^h[1-6]$/.test(sTag)) {
                const hdText = getCleanText(sib).toLowerCase();
                if (/^index\b/i.test(hdText)) isIndex = true;
                if (/^(table of contents|contents|toc)$/i.test(hdText) || /^contents\b/i.test(hdText)) isToc = true;
                break;
              }
            }
          }
          break;
        }
        p = p.parentNode;
      }
    }
    // Index components (<lic class="index-line">/<lic class="index-pg">) make an index (A2).
    if (!isToc && !isIndex) {
      isIndex = [...(child.childNodes || [])].some((li) => li.nodeType === 1 && [...(li.childNodes || [])].some((c) => c.nodeType === 1
        && (c.localName || c.tagName || '').toLowerCase() === 'lic' && /(^|[-_\s])index([-_\s]|$)/.test(((c.getAttribute && c.getAttribute('class')) || '').toLowerCase())));
    }
    let items = [];
    let counter = isOl ? (parseInt((child.getAttribute && child.getAttribute('start')) || '1', 10) || 1) : 1;   // DTBook @start
    let detectedKind = isToc ? 'toc' : (isIndex ? 'index' : (listTypeAttr.toLowerCase() === 'pl' ? 'plain' : null));
    let lastTopItem = null;

    // Print page turns (and tables) inside a list: a list cannot hold a pagenum or table block, so the list is
    // split around it (BANA §8.3.3b puts a blank line between the indicator and a list
    // anyway). Nested calls (targetBlocks === null) cannot emit blocks, so they hand the
    // turn up to the parent as a `{ pagenum }` marker item.
    const emitListBlock = () => {
      if (items.length && targetBlocks) {
        const listBlock = { type: 'list', items };
        if (detectedKind) {
          listBlock.kind = detectedKind;
          listBlock.style = detectedKind;
        }
        if (isOl && detectedKind !== 'toc' && detectedKind !== 'index') listBlock.ordered = true;   // contents and index lists are not numbered
        targetBlocks.push(listBlock);
        items = [];
      }
    };
    const emitPagenum = (pn) => {
      if (!pn) return;
      if (targetBlocks) { emitListBlock(); targetBlocks.push(pn); }
      else items.push({ pagenum: pn });
    };
    const addSubItems = (subItems) => {
      for (const si of subItems) {
        if (si && si.pagenum) emitPagenum(si.pagenum);
        else items.push(si);
      }
    };

    const NUMBER_PREFIX_RE = /^\s*(\d+|[a-zA-Z]|[ivxlcdm]+)[\.\)]\s+/;
    const BULLET_PREFIX_RE = /^\s*[•\-\*\u2022\u2023\u25E6\u2043\u2219\u25AA\u25AB\u25CF\u25CB\uF0B7\uF0A7\u00B7]+\s+/;

    for (let li = child.firstChild; li; li = li.nextSibling) {
      if (li.nodeType === 3 && li.nodeValue.trim()) {           // loose text in a list (invalid, but kept; A2)
        const item = { text: li.nodeValue.replace(/\s+/g, ' ').trim() };
        if (listLvl > 0) item.level = listLvl;
        items.push(item);
        continue;
      }
      if (li.nodeType !== 1) continue;
      const liTag = (li.localName || li.tagName || '').toLowerCase();
      if (PAGENUM_TAGS.has(liTag)) { emitPagenum(pagenumBlock(li)); continue; }
      if (liTag === 'prodnote' || liTag === 'annotation') {   // a list's production note (A2)
        const out = [];
        pushTextOnly(out, li, (t) => (t ? { type: 'note', text: t } : null));
        out.forEach(emitPagenum);
        continue;
      }
      if (liTag !== 'li' && liTag !== 'item') continue;

      const liClass = (li.getAttribute ? li.getAttribute('class') : '') || '';
      const liLevel = getElementLevel(li);
      const effLevel = liLevel || listLvl;

      const childLists = [];
      for (let c = li.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 1 && (c.localName || c.tagName || '').toLowerCase() === 'list') {
          childLists.push(c);
        }
      }

      // Tables in the item (not in its sub-lists) become their own blocks, split out of the
      // list like page turns: those before the first sub-list follow the item's text, the
      // rest follow its sub-lists. They were dropped before, with any maths in them.
      const liTables = { before: [], after: [] };
      (function findTables(node, afterList) {
        for (let c = node.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          const t = (c.localName || c.tagName || '').toLowerCase();
          if (LIST_TAGS.has(t)) { afterList = true; continue; }
          if (t === 'table' || t === 'note' || t === 'sidebar' || IMAGE_TAGS.has(t)) (afterList ? liTables.after : liTables.before).push(c);
          else afterList = findTables(c, afterList);
        }
        return afterList;
      })(li, false);
      // Tables and notes (a DTBook <note> may sit in a list item) are split out the same way.
      const emitTables = (els) => {
        for (const el of els) {
          const out = [];
          const t = (el.localName || el.tagName || '').toLowerCase();
          if (t === 'note') pushNote(out, el);
          else if (IMAGE_TAGS.has(t)) pushImage(out, el);
          else if (t === 'sidebar') parseSidebar(el, out);
          else parseTable(el, out);
          out.forEach(emitPagenum);
        }
      };

      // This item's own components — not those of its sub-lists (an entry took the page of
      // its last nested entry, A28).
      const lics = li.getElementsByTagName ? [...li.getElementsByTagName('lic')].filter((l) => {
        for (let p = l.parentNode; p && p !== li; p = p.parentNode) if (LIST_TAGS.has((p.localName || p.tagName || '').toLowerCase())) return false;
        return true;
      }) : [];
      const PAGE_CLASS = /(^|[-_\s])(page|pagenum|pg|pageno)([-_\s]|$)/;
      // <lic> is DTBook's general "list item component": it makes a contents entry only when
      // one component is a page reference (class or pagenum), or the list is a contents list,
      // or the last of several components is a bare page number. "1." + an equation is an
      // ordinary numbered item (its maths was lost when every <lic> item was read as contents).
      const hasMathml = (el) => !!(el.getElementsByTagNameNS && el.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math').length);
      const licIsPage = (l) => {
        const c = ((l.getAttribute && l.getAttribute('class')) || '').toLowerCase();
        return c.includes('page') || PAGE_CLASS.test(c) || (l.getElementsByTagName && (l.getElementsByTagName('pagenum').length > 0 || l.getElementsByTagName('print-page').length > 0));
      };
      const PAGE_NO = /^\s*[\divxlcdm]+[a-z]?\s*$/i;           // "12", "xiv", "12a"
      const ITEM_NO = /^\s*[\divxlcdm]+[.)]\s*$/i;              // "1." / "iv)" — an item number, not a page
      const lastLic = lics[lics.length - 1];
      const licsAreContents = lics.length >= 2 && !hasMathml(lastLic) && PAGE_NO.test(getCleanText(lastLic)) && !ITEM_NO.test(getCleanText(lics[0]));
      const hasLics = lics.length > 0 && (isToc || lics.some(licIsPage) || licsAreContents);
      const isLiToc = isToc || liClass.includes('toc-entry') || liClass.includes('bai-toc-entry') || hasLics;
      // Page turns in this item (nested lists handle their own): before the item's text
      // → emitted before it; anywhere else → after it (an item cannot be split).
      const liPn = collectPagenums(li, LIST_AND_TABLE_TAGS);
      for (const b of liPn.before) emitPagenum(b);

      if (liClass.includes('bai-toc-center')) {
        const t = getCleanText(li, LIST_AND_TABLE_TAGS);
        if (t && targetBlocks) { emitListBlock(); targetBlocks.push({ type: 'heading', level: 1, text: t }); }
        emitTables(liTables.after);
        for (const b of liPn.after) emitPagenum(b);
        continue;
      }

      if (liClass.includes('toc-page') || liClass.includes('bai-toc-page')) {
        detectedKind = isIndex ? 'index' : 'toc';
        const pVal = getCleanText(li, LIST_AND_TABLE_TAGS);
        const target = lastTopItem || items[items.length - 1];
        if (pVal && target) {
          // The entry's own trailing number ("…November 21, 1963") was not its page (A2).
          const g = guessedPages.get(target);
          if (g && g.text.endsWith(target.page || '')) {
            target.text = g.text;
            if (target.segments) target.segments = g.segs;
            guessedPages.delete(target);
          }
          target.page = pVal;
        }
        emitTables(liTables.before);
        for (const cl of childLists) {
          addSubItems(parseSingleList(cl, effLevel + 1, null));
        }
        emitTables(liTables.after);
        for (const b of liPn.after) emitPagenum(b);
        continue;
      }

      if (isLiToc) {
        detectedKind = isIndex ? 'index' : 'toc';
        let itemText = '';
        let pageVal = null;
        let guessed = null;                                   // page read from the end of the text
        let textTargetNode = li;
        let textEl = null;
        let pageEl = null;
        const TOC_EXCLUDE = new Set(['list', 'ul', 'ol', 'pagenum', 'print-page', 'sidebar', 'table', 'prodnote']);

        if (hasLics) {
          textEl = lics.find(l => {
            const cls = ((l.getAttribute && l.getAttribute('class')) || '').toLowerCase();
            return cls.includes('toc-text') || cls.includes('bai-toc-text') || cls.includes('entry') || cls.includes('title');
          });
          pageEl = lics.find(l => {
            const cls = ((l.getAttribute && l.getAttribute('class')) || '').toLowerCase();
            const hasPageTag = l.getElementsByTagName ? (l.getElementsByTagName('pagenum').length > 0 || l.getElementsByTagName('print-page').length > 0) : false;
            return cls.includes('toc-page') || cls.includes('bai-toc-page') || cls.includes('page') || cls.includes('pagenum') || PAGE_CLASS.test(cls) || hasPageTag;
          });
          if (!textEl && !pageEl) {
            if (lics.length >= 2) {
              textEl = lics[0];
              pageEl = lics[lics.length - 1];
            } else if (lics.length === 1) {
              textEl = lics[0];
            }
          } else if (!textEl && lics.length >= 2 && pageEl) {
            textEl = lics.find(l => l !== pageEl);
          } else if (!pageEl && lics.length >= 2 && textEl) {
            pageEl = lics.find(l => l !== textEl);
          }

          if (textEl) {
            itemText = getCleanText(textEl, TOC_EXCLUDE);
            textTargetNode = textEl;
          }
          if (pageEl) {
            pageVal = pageColumnText(pageEl, TOC_EXCLUDE);
          }
        }

        // A <pagenum> inside a contents entry is a print page turn, not the entry's page
        // column (that is <lic class="pagenum">); it is hoisted around the item like any other.
        const segs = inlineSegments(textTargetNode, true, TOC_EXCLUDE);
        
        if (!itemText) {
          const directText = segs.map(s => s.text || '').join('').replace(/\s+/g, ' ').trim();
          const pageMatch = directText.match(/\s+(\d+|[ivxlcdm]+)$/i);
          if (pageMatch) {
            itemText = directText.slice(0, pageMatch.index).trim();
            if (!pageVal) { pageVal = pageMatch[1]; guessed = { text: directText, segs: segs.map((g) => ({ ...g })) }; }
          } else {
            itemText = directText || getCleanText(li, TOC_EXCLUDE);
          }
        }

        if (!textEl && pageVal && segs.length > 0) {
          const lastSeg = segs[segs.length - 1];
          if (lastSeg.type === 'text' && lastSeg.text) {
            const re = new RegExp(`\\s*${pageVal}\\s*$`);
            lastSeg.text = lastSeg.text.replace(re, '');
            if (!lastSeg.text) {
              segs.pop();
            }
          }
        }
        const hasEmphOrMath = segs.some(s => s.tf || s.uncontracted || s.type === 'math' || s.type === 'noteref' || s.type === 'linenum' || s.type === 'linenum' || (s.text && s.text.includes('\n')));
        const item = { text: itemText };
        if (pageVal) item.page = pageVal;
        if (effLevel > 0) item.level = effLevel;
        if (segs.length && hasEmphOrMath) item.segments = segs;
        if (guessed) guessedPages.set(item, guessed);
        items.push(item);
        lastTopItem = item;

        emitTables(liTables.before);
        for (const cl of childLists) {
          addSubItems(parseSingleList(cl, effLevel + 1, null));
        }
        emitTables(liTables.after);
        for (const b of liPn.after) emitPagenum(b);
        continue;
      }

      if (liClass.includes('bai-exercise')) {
        detectedKind = 'exercise';
        const segs = segsWithoutPagenums(inlineSegments(li, true, LI_SPLIT_TAGS));
        const t = segs.map(s => s.text || '').join('').replace(/\s+/g, ' ').trim() || getCleanText(li, LIST_AND_TABLE_TAGS);
        const item = { text: t };
        if (effLevel > 0) item.level = effLevel;
        if (segs.length && segs.some(s => s.tf || s.uncontracted || s.type === 'math' || s.type === 'noteref' || s.type === 'linenum' || s.type === 'linenum' || (s.text && s.text.includes('\n')))) item.segments = segs;
        items.push(item);
        lastTopItem = item;

        emitTables(liTables.before);
        for (const cl of childLists) {
          addSubItems(parseSingleList(cl, effLevel + 1, null));
        }
        emitTables(liTables.after);
        for (const b of liPn.after) emitPagenum(b);
        continue;
      }

      if (liClass.includes('bai-index')) {
        detectedKind = 'index';
        const segs = segsWithoutPagenums(inlineSegments(li, true, LI_SPLIT_TAGS));
        const t = segs.map(s => s.text || '').join('').replace(/\s+/g, ' ').trim() || getCleanText(li, LIST_AND_TABLE_TAGS);
        const item = { text: t };
        if (effLevel > 0) item.level = effLevel;
        if (segs.length && segs.some(s => s.tf || s.uncontracted || s.type === 'math' || s.type === 'noteref' || s.type === 'linenum' || s.type === 'linenum' || (s.text && s.text.includes('\n')))) item.segments = segs;
        items.push(item);
        lastTopItem = item;

        emitTables(liTables.before);
        for (const cl of childLists) {
          addSubItems(parseSingleList(cl, effLevel + 1, null));
        }
        emitTables(liTables.after);
        for (const b of liPn.after) emitPagenum(b);
        continue;
      }

      const segs = segsWithoutPagenums(inlineSegments(li, true, LI_SPLIT_TAGS));
      let directText = segs.map(s => s.text || (s.latex ? s.latex : (s.mathml ? s.mathml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : ''))).join('').replace(/\s+/g, ' ').trim();
      if (!directText) directText = getCleanText(li, LIST_AND_TABLE_TAGS);

      let itemMarker = null;
      if (isOl) {
        const match = directText.match(NUMBER_PREFIX_RE);
        if (match) {
          itemMarker = match[0].trim();
          directText = directText.slice(match[0].length).trim();
          if (segs.length && segs[0].text) {
            segs[0].text = segs[0].text.replace(NUMBER_PREFIX_RE, '');
          }
        } else {
          itemMarker = synthesizeOrderedMarker(counter, enumAttr);
        }
        counter++;
      } else if (detectedKind !== 'plain' && !isToc) {
        const match = directText.match(BULLET_PREFIX_RE);
        if (match) {
          itemMarker = '•';
          directText = directText.slice(match[0].length).trim();
          if (segs.length && segs[0].text) {
            segs[0].text = segs[0].text.replace(BULLET_PREFIX_RE, '');
          }
        }
      }

      const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || s.type === 'noteref' || s.type === 'linenum' || (s.text && s.text.includes('\n')));
      if (directText) {
        // segs already excludes nested lists (inlineSegments(li, true, …)), so an item that has
        // a sub-list keeps its own emphasis and maths too (they were dropped before).
        const item = (hasEmphOrMath && segs.length > 0) ? { segments: segs, text: directText } : { text: directText };
        if (itemMarker) item.marker = itemMarker;
        if (effLevel > 0) item.level = effLevel;
        items.push(item);
        lastTopItem = item;
      }

      emitTables(liTables.before);
      for (const cl of childLists) {
        addSubItems(parseSingleList(cl, effLevel + 1, null));
      }
      emitTables(liTables.after);
      for (const b of liPn.after) emitPagenum(b);
    }

    emitListBlock();
    return items;
  }

  function parseDefinitionList(dlEl, targetBlocks = blocks) {
    let items = [];
    // A table inside a definition becomes its own block after that definition, splitting
    // the glossary around it (it was folded into the definition's text before).
    // Tables and images inside a definition are split out after it (A28/A29: the Coyotes
    // glossary's pictures were dropped and their captions folded into the definition).
    const SPLIT = new Set(['table', 'imggroup', 'img', 'image']);
    const tablesIn = (el) => {
      const out = [];
      (function walk(n) {
        for (let k = n.firstChild; k; k = k.nextSibling) {
          if (k.nodeType !== 1) continue;
          if (SPLIT.has((k.localName || k.tagName || '').toLowerCase())) out.push(k); else walk(k);
        }
      })(el);
      return out;
    };
    const flushGlossary = () => {
      if (items.length && targetBlocks) targetBlocks.push({ type: 'list', kind: 'glossary', style: 'glossary', items });
      items = [];
    };
    let curTerm = null;
    let curTermSegs = null;
    for (let c = dlEl.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const cTag = (c.localName || c.tagName || '').toLowerCase();
      if (cTag === 'brl') continue;
      if (cTag === 'dt' || cTag === 'dfn') {
        if (curTerm) {
          const item = {
            term: curTerm,
            def: '',
            text: curTerm
          };
          if (curTermSegs?.length) {
            item.termSegments = curTermSegs;
            item.segments = curTermSegs;
          }
          items.push(item);
        }
        curTerm = getCleanText(c);
        curTermSegs = segsWithoutPagenums(inlineSegments(c));
      } else if (cTag === 'dd') {
        const defText = getCleanText(c, SPLIT);
        const defSegs = segsWithoutPagenums(inlineSegments(c, false, SPLIT));
        if (curTerm || defText) {
          const item = {
            term: curTerm || '',
            def: defText || '',
            text: curTerm ? `${curTerm} — ${defText}` : defText
          };
          if (curTermSegs?.length) item.termSegments = curTermSegs;
          if (defSegs?.length) item.defSegments = defSegs;
          if (curTermSegs?.length || defSegs?.length) {
            item.segments = [...(curTermSegs || [{ type: 'text', text: curTerm || '' }]), { type: 'text', text: ' — ' }, ...(defSegs || [{ type: 'text', text: defText || '' }])];
          }
          items.push(item);
          curTerm = null;
          curTermSegs = null;
        }
        const ddTables = targetBlocks ? tablesIn(c) : [];
        if (ddTables.length) {
          flushGlossary();
          for (const t of ddTables) {
            const tag = (t.localName || t.tagName || '').toLowerCase();
            if (tag === 'table') parseTable(t, targetBlocks);
            else if (tag === 'imggroup') parseImgGroup(t, targetBlocks);
            else {
              const src = (t.getAttribute && t.getAttribute('src')) || '';
              const g = { type: 'graphic', src, alt: (t.getAttribute && t.getAttribute('alt')) || '' };
              const svg = svgFromDataUri(src);
              if (svg) g.svg = svg;
              targetBlocks.push(g);
            }
          }
        }
      }
    }
    if (curTerm) {
      const item = {
        term: curTerm,
        def: '',
        text: curTerm
      };
      if (curTermSegs?.length) {
        item.termSegments = curTermSegs;
        item.segments = curTermSegs;
      }
      items.push(item);
    }
    const pn = targetBlocks ? collectPagenums(dlEl, SPLIT) : { before: [], after: [] };
    if (targetBlocks) targetBlocks.push(...pn.before);
    flushGlossary();
    if (targetBlocks) targetBlocks.push(...pn.after);
  }

  function parsePoem(poemEl, targetBlocks = blocks) {
    let pendingLinenum = '';
    for (let c = poemEl.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const cTag = (c.localName || c.tagName || '').toLowerCase();
      const cCls = (c.getAttribute ? (c.getAttribute('class') || '') : '').toLowerCase();

      if (cTag === 'title' || cTag === 'hd' || /^h[1-6]$/.test(cTag)) {
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : (/^h[1-6]$/.test(cTag) ? parseInt(cTag.slice(1), 10) : 2);
        if (targetBlocks) pushAtomic(targetBlocks, c, (t, segs) => (t ? (segs ? { type: 'heading', level: lvl, text: t, segments: segs } : { type: 'heading', level: lvl, text: t }) : null));
      } else if (PAGENUM_TAGS.has(cTag)) {
        const pn = pagenumBlock(c);
        if (pn && targetBlocks) targetBlocks.push(pn);
      } else if (cTag === 'byline' || cTag === 'author' || cTag === 'cite' || cTag === 'attrib') {
        if (targetBlocks) pushAtomic(targetBlocks, c, (t, segs) => (t ? (segs ? { type: 'attribution', text: t, segments: segs } : { type: 'attribution', text: t }) : null));
      } else if (cTag === 'linegroup' || cTag === 'stanza' || (cTag === 'div' && (cCls.includes('stanza') || cCls.includes('linegroup') || cCls.includes('line-group') || cCls.includes('verse') || cCls.includes('poem')))) {
        let stanzaLinenum = '';
        let hasLinesInGroup = false;
        for (let ln = c.firstChild; ln; ln = ln.nextSibling) {
          if (ln.nodeType !== 1) continue;
          const lnTag = (ln.localName || ln.tagName || '').toLowerCase();
          const lnCls = (ln.getAttribute ? (ln.getAttribute('class') || '') : '').toLowerCase();
          if (PAGENUM_TAGS.has(lnTag)) {
            const pn = pagenumBlock(ln);
            if (pn && targetBlocks) targetBlocks.push(pn);
          } else if (lnTag === 'linenum' || lnCls.includes('linenum')) {
            stanzaLinenum = (ln.textContent || '').trim();
          } else if (lnTag === 'title' || lnTag === 'hd' || /^h[1-6]$/.test(lnTag)) {
            if (targetBlocks) pushTextOnly(targetBlocks, ln, (t) => (t ? { type: 'heading', level: 3, text: t } : null));
          } else if (lnTag === 'line' || lnTag === 'ln' || lnTag === 'p') {
            if (lnCls.includes('bai-stanza-break') || lnCls.includes('stanza-break')) {
              if (targetBlocks) targetBlocks.push({ type: 'indicator', kind: 'line' });
            } else {
              const lvlAttr = ln.getAttribute ? ln.getAttribute('level') : null;
              const lnLvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
              const pn = hoistPagenums(inlineSegments(ln));
              let segs = pn.segs;
              let t = getCleanText(ln);
              let innerLinenum = '';
              if (ln.getElementsByTagName) {
                const numNode = findLinenum(ln);
                if (numNode) innerLinenum = (numNode.textContent || '').trim();
              }
              if (innerLinenum || stanzaLinenum) {
                const numPrefix = (innerLinenum || stanzaLinenum) + ' ';
                t = numPrefix + t;
                if (segs.length > 0) {
                  segs = [{ type: 'text', text: numPrefix }, ...segs];
                }
                stanzaLinenum = '';
              }
              if (targetBlocks) targetBlocks.push(...pn.before);
              if (t && targetBlocks) {
                const blk = segsHaveEmphOrMath(segs) && segs.length
                  ? { type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segs }
                  : { type: 'play', subtype: 'verse', style: 'verse', text: t };
                if (lnLvl > 0) blk.level = lnLvl;
                targetBlocks.push(blk);
                hasLinesInGroup = true;
              }
              if (targetBlocks) targetBlocks.push(...pn.after);
            }
          } else if (lnTag === 'byline' || lnTag === 'author' || lnTag === 'cite' || lnTag === 'attrib' || lnCls.includes('attribution') || lnCls.includes('byline')) {
            if (targetBlocks) pushAtomic(targetBlocks, ln, (t, segs) => (t ? (segs ? { type: 'attribution', text: t, segments: segs } : { type: 'attribution', text: t }) : null));
          } else if (lnTag === 'note') {
            if (targetBlocks) pushNote(targetBlocks, ln);
          } else if (lnTag === 'prodnote') {
            if (targetBlocks) pushTextOnly(targetBlocks, ln, (t) => (t ? { type: 'note', text: t } : null));
          } else if (targetBlocks && !INLINE_TAGS.has(lnTag) && lnTag !== 'brl') {
            // Any other child keeps its content (A2): a container is read like a poem, text as a line.
            if (hasBlockChild(ln)) parsePoem(ln, targetBlocks);
            else pushAtomic(targetBlocks, ln, (t, segs) => (t ? (segs ? { type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segs } : { type: 'play', subtype: 'verse', style: 'verse', text: t }) : null));
          }
        }
        let nextSibling = c.nextSibling;
        let hasMoreStanzas = false;
        while (nextSibling) {
          if (nextSibling.nodeType === 1) {
            const nsTag = (nextSibling.localName || nextSibling.tagName || '').toLowerCase();
            const nsCls = (nextSibling.getAttribute ? (nextSibling.getAttribute('class') || '') : '').toLowerCase();
            if (nsTag === 'linegroup' || nsTag === 'stanza' || (nsTag === 'div' && (nsCls.includes('stanza') || nsCls.includes('linegroup') || nsCls.includes('verse')))) {
              hasMoreStanzas = true;
              break;
            }
          }
          nextSibling = nextSibling.nextSibling;
        }
        if (hasLinesInGroup && hasMoreStanzas && targetBlocks) {
          targetBlocks.push({ type: 'indicator', kind: 'line' });
        }
      } else if (cTag === 'line' || cTag === 'ln') {
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lnLvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        const pn = hoistPagenums(inlineSegments(c));
        let segs = pn.segs;
        let t = getCleanText(c);
        let innerLinenum = '';
        if (c.getElementsByTagName) {
          const numNode = findLinenum(c);
          if (numNode) innerLinenum = (numNode.textContent || '').trim();
        }
        if (innerLinenum || pendingLinenum) {
          const numPrefix = (innerLinenum || pendingLinenum) + ' ';
          t = numPrefix + t;
          if (segs.length > 0) {
            segs = [{ type: 'text', text: numPrefix }, ...segs];
          }
          pendingLinenum = '';
        }
        if (targetBlocks) targetBlocks.push(...pn.before);
        if (t && targetBlocks) {
          const blk = segsHaveEmphOrMath(segs) && segs.length
            ? { type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segs }
            : { type: 'play', subtype: 'verse', style: 'verse', text: t };
          if (lnLvl > 0) blk.level = lnLvl;
          targetBlocks.push(blk);
        }
        if (targetBlocks) targetBlocks.push(...pn.after);
      } else if (cTag === 'linenum' || cCls.includes('linenum')) {
        pendingLinenum = (c.textContent || '').trim();
      } else if (cTag === 'p') {
        if (cCls.includes('bai-stanza-break') || cCls.includes('stanza-break')) {
          if (targetBlocks) targetBlocks.push({ type: 'indicator', kind: 'line' });
        } else if (targetBlocks) {
          const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
          const pLvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
          pushAtomic(targetBlocks, c, (t, segs) => {
            if (!t) return null;
            const blk = segs
              ? { type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segs }
              : { type: 'play', subtype: 'verse', style: 'verse', text: t };
            if (pLvl > 0) blk.level = pLvl;
            return blk;
          });
        }
      } else if (cTag === 'sidebar') {
        parseSidebar(c, targetBlocks);
      } else if (!targetBlocks) {
        // (nothing to emit into)
      } else if (cTag === 'imggroup') {                     // other block content a poem may hold (A28)
        parseImgGroup(c, targetBlocks);
      } else if (cTag === 'img' || cTag === 'image') {
        const src = (c.getAttribute && c.getAttribute('src')) || '';
        const alt = (c.getAttribute && c.getAttribute('alt')) || '';
        const g = { type: 'graphic', src, alt };
        const svg = svgFromDataUri(src);
        if (svg) g.svg = svg;
        targetBlocks.push(g);
      } else if (cTag === 'note') {
        pushNote(targetBlocks, c);
      } else if (cTag === 'prodnote' || cTag === 'annotation') {
        pushTextOnly(targetBlocks, c, (t) => (t ? { type: 'note', text: t } : null));
      } else if (cTag === 'list') {
        parseSingleList(c, 0, targetBlocks);
      } else if (cTag === 'table') {
        parseTable(c, targetBlocks);
      } else if (cTag === 'epigraph' || cTag === 'blockquote') {
        pushAtomic(targetBlocks, c, (t, segs) => (t ? (segs ? { type: 'para', style: 'quote', text: t, segments: segs } : { type: 'para', style: 'quote', text: t }) : null));
      } else if (c.textContent && c.textContent.trim()) {     // dateline and anything else with text
        pushAtomic(targetBlocks, c, (t, segs) => (t ? (segs ? { type: 'para', text: t, segments: segs } : { type: 'para', text: t }) : null));
      }
    }
  }

  function parseSidebar(sidebarEl, targetBlocks = blocks) {
    let boxTitle = null;
    const innerBlocks = [];
    const id = sidebarEl.getAttribute ? sidebarEl.getAttribute('id') : null;
    const render = sidebarEl.getAttribute ? sidebarEl.getAttribute('render') : null;

    for (let c = sidebarEl.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const cTag = (c.localName || c.tagName || '').toLowerCase();
      if (cTag === 'hd' || /^h[1-6]$/.test(cTag)) {
        const hdText = getCleanText(c);
        if (!boxTitle) {
          boxTitle = hdText;
        }
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : (/^h[1-6]$/.test(cTag) ? parseInt(cTag.slice(1), 10) : 2);
        pushAtomic(innerBlocks, c, (t, segs) => (segs ? { type: 'heading', level: lvl, text: t, segments: segs } : { type: 'heading', level: lvl, text: t }), { excludeTags: IMAGE_TAGS });
        innerBlocks.push(...imagesWithin(c));
      } else if (cTag === 'p') {
        const cls = (c.getAttribute ? (c.getAttribute('class') || '') : '').toLowerCase();
        const pLevel = getElementLevel(c);
        for (const im of (c.getElementsByTagName ? [...c.getElementsByTagName('img'), ...c.getElementsByTagName('image')] : [])) {
          innerBlocks.push({ type: 'graphic', src: (im.getAttribute && im.getAttribute('src')) || '', alt: (im.getAttribute && im.getAttribute('alt')) || '' });
        }
        const rawSegs = inlineSegments(c);
        const makeP = (t, segs) => {
          if (cls.includes('bai-play') || cls.includes('play-speaker') || cls.includes('speaker')) {
            return { type: 'play', subtype: 'prose', style: 'play-speaker', level: pLevel, text: t, segments: segs };
          } else if (cls.includes('bai-verse') || cls.includes('play-verse') || cls.includes('verse') || cls.includes('poem')) {
            return { type: 'play', subtype: 'verse', style: 'verse', level: pLevel, text: t, segments: segs };
          } else if (cls.includes('bai-stage') || cls.includes('play-stage') || cls.includes('stage')) {
            return { type: 'stage', style: 'play-stage', level: pLevel, text: t, segments: segs };
          } else if (cls.includes('bai-stanza-break') || cls.includes('stanza-break')) {
            return { type: 'indicator', kind: 'line' };
          } else if (cls.includes('bana-break-asterisks')) {
            return { type: 'break', kind: 'asterisks' };
          } else if (cls.includes('bana-break-dot2s')) {
            return { type: 'break', kind: 'dot2s' };
          } else if (t) {
            return segs ? { type: 'para', segments: segs, text: t } : { type: 'para', text: t };
          }
          return null;
        };
        const t = getCleanText(c);
        if (rawSegs.length === 1 && rawSegs[0].type === 'math') {   // displayed equation in its own <p>
          const mathBlock = { type: 'math', mathml: rawSegs[0].mathml };
          if (rawSegs[0].latex) mathBlock.latex = rawSegs[0].latex;
          innerBlocks.push(mathBlock);
          continue;
        }
        if (segsHavePagenum(rawSegs)) {
          const probe = makeP(t, undefined);
          if (probe && probe.type === 'para') {
            pushParaParts(rawSegs, innerBlocks, makeP);
          } else {
            const pn = hoistPagenums(rawSegs);
            innerBlocks.push(...pn.before);
            const blk = makeP(t, segsHaveEmphOrMath(pn.segs) && pn.segs.length ? pn.segs : undefined);
            if (blk) innerBlocks.push(blk);
            innerBlocks.push(...pn.after);
          }
        } else {
          const blk = makeP(t, segsHaveEmphOrMath(rawSegs) && rawSegs.length ? rawSegs : undefined);
          if (blk) innerBlocks.push(blk);
        }
      } else if (cTag === 'speaker') {
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        pushAtomic(innerBlocks, c, (t, segs) => {
          if (!t) return null;
          const blk = segs
            ? { type: 'play', subtype: 'prose', style: 'play-speaker', text: t, segments: segs }
            : { type: 'play', subtype: 'prose', style: 'play-speaker', text: t };
          if (lvl > 0) blk.level = lvl;
          return blk;
        });
      } else if (cTag === 'stage') {
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        pushAtomic(innerBlocks, c, (t, segs) => {
          if (!t) return null;
          const blk = segs
            ? { type: 'stage', style: 'play-stage', text: t, segments: segs }
            : { type: 'stage', style: 'play-stage', text: t };
          if (lvl > 0) blk.level = lvl;
          return blk;
        });
      } else if (cTag === 'poem' || cTag === 'linegroup') {
        parsePoem(c, innerBlocks);
      } else if (cTag === 'line' || cTag === 'ln') {
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        pushAtomic(innerBlocks, c, (t, segs) => {
          if (!t) return null;
          const blk = segs
            ? { type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segs }
            : { type: 'play', subtype: 'verse', style: 'verse', text: t };
          if (lvl > 0) blk.level = lvl;
          return blk;
        });
      } else if (cTag === 'list' || cTag === 'ul' || cTag === 'ol') {
        parseSingleList(c, 0, innerBlocks);
      } else if (cTag === 'dl') {
        parseDefinitionList(c, innerBlocks);
      } else if (cTag === 'table') {
        parseTable(c, innerBlocks);
      } else if (cTag === 'caption') {
        pushTextOnly(innerBlocks, c, (t) => (t ? { type: 'caption', text: t } : null));
      } else if (cTag === 'note') {
        pushNote(innerBlocks, c);
      } else if (cTag === 'prodnote' || cTag === 'annotation') {
        const cls = (c.getAttribute ? (c.getAttribute('class') || '') : '').toLowerCase();
        pushTextOnly(innerBlocks, c, (t) => {
          if (!t) return null;
          if (cls.includes('tabletn')) return { type: 'note', kind: 'tabletn', text: t };
          return { type: 'note', text: t };
        });
      } else if (cTag === 'byline' || cTag === 'author' || cTag === 'cite' || cTag === 'attrib') {
        pushAtomic(innerBlocks, c, (t, segs) => (t ? (segs ? { type: 'attribution', text: t, segments: segs } : { type: 'attribution', text: t }) : null));
      } else if (cTag === 'sidebar' || (cTag === 'div' && (c.getAttribute ? (c.getAttribute('class') || '') : '').toLowerCase().includes('sidebar'))) {
        parseSidebar(c, innerBlocks);
      } else if (cTag === 'math' || cTag.endsWith(':math')) {
        const mathml = mathOuterXml(c);
        const alttext = c.getAttribute ? c.getAttribute('alttext') : null;
        let latex = alttext || null;
        const ann = c.getElementsByTagName ? [...c.getElementsByTagName('annotation'), ...c.getElementsByTagName('m:annotation')] : [];
        const texAnn = ann.find(a => (a.getAttribute ? (a.getAttribute('encoding') || '') : '').includes('tex'));
        if (texAnn && texAnn.textContent) latex = texAnn.textContent.trim();
        if (!latex && mathml) latex = mathmlToLatex(mathml);
        const mathBlock = { type: 'math', mathml };
        if (latex) mathBlock.latex = latex;
        innerBlocks.push(mathBlock);
      } else if (cTag === 'imggroup') {
        parseImgGroup(c, innerBlocks);
      } else if (cTag === 'img' || cTag === 'image' || cTag === 'graphic') {
        const src = (c.getAttribute ? c.getAttribute('src') : '') || '';
        const alt = (c.getAttribute ? c.getAttribute('alt') : '') || '';
        const graphic = { type: 'graphic', src, alt };
        const svg = svgFromDataUri(src);
        if (svg) graphic.svg = svg;
        innerBlocks.push(graphic);
      } else if (cTag === 'blockquote') {
        const hasElements = Array.from(c.childNodes || []).some((childNode) => childNode.nodeType === 1);
        if (hasElements) {
          for (let bcn = c.firstChild; bcn; bcn = bcn.nextSibling) {
            if (bcn.nodeType !== 1) continue;
            const bcnTag = (bcn.localName || bcn.tagName || '').toLowerCase();
            if (PAGENUM_TAGS.has(bcnTag)) {
              const pn = pagenumBlock(bcn);
              if (pn) innerBlocks.push(pn);
              continue;
            }
            if (bcnTag === 'byline' || bcnTag === 'author' || bcnTag === 'cite' || bcnTag === 'attrib') {
              pushAtomic(innerBlocks, bcn, (t, segs) => (t ? (segs ? { type: 'attribution', text: t, segments: segs } : { type: 'attribution', text: t }) : null));
            } else {
              pushParaParts(inlineSegments(bcn), innerBlocks, (t, segs) => (segs ? { type: 'para', style: 'quote', text: t, segments: segs } : { type: 'para', style: 'quote', text: t }));
            }
          }
        } else {
          pushParaParts(inlineSegments(c), innerBlocks, (t, segs) => (segs ? { type: 'para', style: 'quote', text: t, segments: segs } : { type: 'para', style: 'quote', text: t }));
        }
      } else if (PAGENUM_TAGS.has(cTag)) {
        const pn = pagenumBlock(c);
        if (pn) innerBlocks.push(pn);
      } else if (cTag === 'hr' || cTag === 'break') {
        const cls = (c.getAttribute ? (c.getAttribute('class') || '') : '').toLowerCase();
        if (cls.includes('stanza')) innerBlocks.push({ type: 'indicator', kind: 'line' });
        else if (cls.includes('asterisks')) innerBlocks.push({ type: 'break', kind: 'asterisks' });
        else if (cls.includes('dot2s')) innerBlocks.push({ type: 'break', kind: 'dot2s' });
        else innerBlocks.push({ type: 'break', kind: 'line' });
      } else if (!INLINE_TAGS.has(cTag) && cTag !== 'brl') {
        // Any other child (<div>, <epigraph>, <address>…) keeps its content (A2): a container
        // is read like a sidebar body, anything else is a paragraph.
        if (hasBlockChild(c)) {
          const tmp = [];
          parseSidebar(c, tmp);
          innerBlocks.push(...(tmp[0].blocks || []));
        } else {
          pushParaParts(inlineSegments(c), innerBlocks, (t, segs) => (t ? (segs ? { type: 'para', text: t, segments: segs } : { type: 'para', text: t }) : null));
        }
      }
    }

    const box = { type: 'box' };
    if (id) box.id = id;
    if (render) box.render = render;
    if (boxTitle) box.title = boxTitle;
    if (innerBlocks.length) box.blocks = innerBlocks;
    else {
      const fullText = getCleanText(sidebarEl);
      if (fullText) box.blocks = [{ type: 'para', text: fullText }];
    }
    targetBlocks.push(box);
  }

  function parseTable(tableEl, targetBlocks = blocks) {
    let tabletnText = null;
    let captionText = null;

    for (let c = tableEl.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const cTag = (c.localName || c.tagName || '').toLowerCase();
      if (cTag === 'tabletn' || cTag.includes('tabletn')) {
        tabletnText = getCleanText(c);
      } else if (cTag === 'caption' || cTag === 'figcaption') {
        captionText = getCleanText(c);
      }
    }

    if (tabletnText) {
      targetBlocks.push({ type: 'note', kind: 'tabletn', text: tabletnText });
    }
    if (captionText) {
      targetBlocks.push({ type: 'caption', text: captionText });
    }

    // A cell keeps its emphasis and maths (A25): plain text stays a string, anything
    // richer becomes { text, segments } (see format/cell-markup.mjs).
    const cellValue = (el) => {
      const segs = segsWithoutPagenums(inlineSegments(el, false, new Set(['pagenum'])))
        .map((g) => (g.type === 'text' ? { ...g, text: g.text.replace(/\s+/g, ' ') } : g))
        .filter((g) => g.type !== 'text' || g.text);
      if (segs.length && segs[0].type === 'text') segs[0] = { ...segs[0], text: segs[0].text.replace(/^\s+/, '') };
      const last = segs.length - 1;
      if (last >= 0 && segs[last].type === 'text') segs[last] = { ...segs[last], text: segs[last].text.replace(/\s+$/, '') };
      const kept = [];
      for (const g of segs) {
        if (g.type === 'text' && !g.text) continue;
        const last = kept[kept.length - 1];
        if (g.type === 'text' && last && last.type === 'text' && (last.tf || 0) === (g.tf || 0) && !!last.uncontracted === !!g.uncontracted) {
          kept[kept.length - 1] = { ...last, text: (last.text + g.text).replace(/\s+/g, ' ') };
        } else kept.push(g);
      }
      if (!kept.some((g) => g.type === 'math')) {
        const plain = getCleanText(el);
        return cellFromSegments(plain, kept.some((g) => g.tf || g.uncontracted || g.type === 'noteref') ? kept : null);
      }
      const plain = kept.map((g) => (g.type === 'math' ? (g.latex || '') : g.text)).join('');
      return cellFromSegments(plain, kept);
    };

    const cls = tableEl.getAttribute ? (tableEl.getAttribute('class') || '') : '';
    let format = null;
    if (cls.includes('bana-listed') || cls.includes('listed')) format = 'listed';
    else if (cls.includes('bana-spatial') || cls.includes('spatial')) format = 'spatial';

    const trs = tableEl.getElementsByTagName ? [...tableEl.getElementsByTagName('tr')] : [];
    const headers = [];
    const rows = [];

    const thead = tableEl.getElementsByTagName ? tableEl.getElementsByTagName('thead')[0] : null;
    let headerRowFound = false;

    const extraHeadRows = [];                                // further <thead> rows lead the body (A28)
    if (thead) {
      const theadTrs = [...thead.getElementsByTagName('tr')];
      for (const tr of theadTrs.slice(1)) {
        const rowCells = [];
        for (let c = tr.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          const tag = (c.localName || c.tagName || '').toLowerCase();
          if (tag !== 'th' && tag !== 'td') continue;
          rowCells.push(cellValue(c));
          const colspan = parseInt(c.getAttribute ? (c.getAttribute('colspan') || '1') : '1', 10) || 1;
          for (let k = 1; k < colspan; k++) rowCells.push('');
        }
        if (rowCells.some((v) => (typeof v === 'string' ? v : v.text))) extraHeadRows.push(rowCells);
      }
      if (theadTrs.length) {
        for (let c = theadTrs[0].firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          const tag = (c.localName || c.tagName || '').toLowerCase();
          if (tag === 'th' || tag === 'td') {
            headers.push(cellValue(c));
          }
        }
        headerRowFound = true;
      }
    }

    rows.push(...extraHeadRows);
    for (let i = 0; i < trs.length; i++) {
      const tr = trs[i];
      if (thead && tr.parentNode === thead) continue;
      const cells = [];
      for (let c = tr.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        const tag = (c.localName || c.tagName || '').toLowerCase();
        if (tag === 'th' || tag === 'td') {
          cells.push(c);
        }
      }

      if (!headerRowFound && cells.length && cells.every(c => (c.localName || c.tagName || '').toLowerCase() === 'th')) {
        headers.push(...cells.map(cellValue));
        headerRowFound = true;
      } else {
        const rowCells = [];
        for (const cell of cells) {
          const cellText = cellValue(cell);
          const colspan = parseInt(cell.getAttribute ? (cell.getAttribute('colspan') || '1') : '1', 10) || 1;
          rowCells.push(cellText);
          for (let k = 1; k < colspan; k++) rowCells.push('');
        }
        if (rowCells.some((v) => (typeof v === 'string' ? v : v.text))) rows.push(rowCells);
      }
    }

    // Cells cannot be split: page turns inside the table are placed before/after it.
    const pn = collectPagenums(tableEl);
    targetBlocks.push(...pn.before);
    if (headers.length || rows.length) {
      const tblBlock = { type: 'table', headers, rows };
      if (format) {
        tblBlock.format = format;
        tblBlock.style = `table-${format}`;
      }
      targetBlocks.push(tblBlock);
    }
    targetBlocks.push(...imagesWithin(tableEl));           // a cell holds text only: its images follow the table (A2)
    targetBlocks.push(...pn.after);
  }

  // <hd> (a DTBook "generic heading", used inside <level1>...<level6> containers,
  // <sidebar>, <list>, etc.) carries no level of its own — its level is implied by
  // how deep its nearest <levelN> ancestor nests. Walk up to the first level1..level6
  // and use N; if <hd> isn't inside any <levelN> (e.g. a bare <sidebar>/<list> box),
  // keep the pre-existing default of 2.
  function nearestLevelDepth(node, fallback) {
    for (let p = node.parentNode; p && p.nodeType === 1; p = p.parentNode) {
      const pTag = (p.localName || p.tagName || '').toLowerCase();
      const m = pTag.match(/^level([1-6])$/);
      if (m) return parseInt(m[1], 10);
    }
    return fallback;
  }

  function walk(node) {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      const tag = (child.localName || child.tagName || '').toLowerCase();
      const cls = (child.getAttribute ? (child.getAttribute('class') || '') : '').toLowerCase();
      if (tag === 'doctitle' || tag === 'docauthor' || tag === 'head') continue;

      if (/^h[1-6]$/.test(tag) || tag === 'hd' || tag === 'bridgehead') {
        const lvl = tag === 'bridgehead' ? 2 : (tag === 'hd' ? nearestLevelDepth(child, 2) : (parseInt(tag.slice(1), 10) || 1));
        pushAtomic(blocks, child, (t, segs) => (t ? (segs ? { type: 'heading', level: lvl, segments: segs, text: t } : { type: 'heading', level: lvl, text: t }) : null), { excludeTags: IMAGE_TAGS });
        blocks.push(...imagesWithin(child));                 // an image in a heading follows it (A29)
      } else if (tag === 'caption' || tag === 'figcaption') {
        pushTextOnly(blocks, child, (t) => (t ? { type: 'caption', text: t } : null));
      } else if (tag === 'tabletn' || tag === 'bai-tabletn') {
        pushTextOnly(blocks, child, (t) => (t ? { type: 'note', kind: 'tabletn', text: t } : null));
      } else if (tag === 'sidebar') {
        parseSidebar(child);
      } else if (tag === 'table') {
        parseTable(child);
      } else if (tag === 'dl') {
        parseDefinitionList(child);
      } else if (tag === 'poem' || tag === 'linegroup' || tag === 'stanza' || (tag === 'div' && (cls.includes('poem') || cls.includes('verse') || cls.includes('stanza')))) {
        parsePoem(child);
      } else if (tag === 'speaker') {
        const lvlAttr = child.getAttribute ? child.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        pushAtomic(blocks, child, (t, segs) => {
          if (!t) return null;
          const blk = segs
            ? { type: 'play', subtype: 'prose', style: 'play-speaker', text: t, segments: segs }
            : { type: 'play', subtype: 'prose', style: 'play-speaker', text: t };
          if (lvl > 0) blk.level = lvl;
          return blk;
        });
      } else if (tag === 'stage') {
        const lvlAttr = child.getAttribute ? child.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        pushAtomic(blocks, child, (t, segs) => {
          if (!t) return null;
          const blk = segs
            ? { type: 'stage', style: 'play-stage', text: t, segments: segs }
            : { type: 'stage', style: 'play-stage', text: t };
          if (lvl > 0) blk.level = lvl;
          return blk;
        });
      } else if (tag === 'blockquote') {
        const hasElements = Array.from(child.childNodes || []).some((c) => c.nodeType === 1 && !PAGENUM_TAGS.has((c.localName || c.tagName || '').toLowerCase()));
        if (hasElements) {
          walk(child);
        } else {
          const segs = inlineSegments(child);
          pushParaParts(segs, blocks, (t, partSegs) => (partSegs ? { type: 'para', style: 'quote', segments: partSegs, text: t } : { type: 'para', style: 'quote', text: t }));
        }
      } else if (tag === 'dt' || tag === 'dfn') {
        pushTextOnly(blocks, child, (t) => (t ? { type: 'para', style: 'dt', text: t } : null));
      } else if (tag === 'dd') {
        pushTextOnly(blocks, child, (t) => (t ? { type: 'para', style: 'dd', text: t } : null));
      } else if (tag === 'byline' || tag === 'author' || tag === 'cite' || tag === 'attrib') {
        pushAtomic(blocks, child, (t, segs) => (t ? (segs ? { type: 'attribution', text: t, segments: segs } : { type: 'attribution', text: t }) : null));
      } else if (tag === 'math' || tag.endsWith(':math')) {
        const mathml = mathOuterXml(child);
        const alttext = child.getAttribute ? child.getAttribute('alttext') : null;
        let latex = alttext || null;
        const ann = child.getElementsByTagName ? [...child.getElementsByTagName('annotation'), ...child.getElementsByTagName('m:annotation')] : [];
        const texAnn = ann.find(a => (a.getAttribute ? (a.getAttribute('encoding') || '') : '').includes('tex'));
        if (texAnn && texAnn.textContent) latex = texAnn.textContent.trim();
        if (!latex && mathml) latex = mathmlToLatex(mathml);
        const mathBlock = { type: 'math', mathml };
        if (latex) mathBlock.latex = latex;
        blocks.push(mathBlock);
      } else if (tag === 'line' || tag === 'ln') {
        const lvlAttr = child.getAttribute ? child.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        pushAtomic(blocks, child, (t, segs) => {
          if (!t) return null;
          const blk = segs
            ? { type: 'play', subtype: 'verse', style: 'verse', segments: segs, text: t }
            : { type: 'play', subtype: 'verse', style: 'verse', text: t };
          if (lvl > 0) blk.level = lvl;
          return blk;
        });
      } else if (tag === 'imggroup') {
        parseImgGroup(child, blocks);
      } else if (tag === 'img' || tag === 'image') {
        const src = (child.getAttribute ? child.getAttribute('src') : '') || '';
        const alt = (child.getAttribute ? child.getAttribute('alt') : '') || '';
        const graphic = { type: 'graphic', src, alt };
        const svg = svgFromDataUri(src);
        if (svg) graphic.svg = svg;
        blocks.push(graphic);
      } else if (tag === 'p') {
        const cls = (child.getAttribute ? (child.getAttribute('class') || '') : '').toLowerCase();
        const pLevel = getElementLevel(child);
        const isInsideQuote = child.parentNode && (child.parentNode.localName || child.parentNode.tagName || '').toLowerCase() === 'blockquote';
        
        const imgs = child.getElementsByTagName ? [...child.getElementsByTagName('img'), ...child.getElementsByTagName('image')] : [];
        for (const im of imgs) {
          const src = (im.getAttribute ? im.getAttribute('src') : '') || '';
          const alt = (im.getAttribute ? im.getAttribute('alt') : '') || '';
          blocks.push({ type: 'graphic', src, alt });
        }

        const directPText = getCleanText(child);

        const rawSegs = inlineSegments(child);
        const hasSpeakerChild = (child.getElementsByTagName ? child.getElementsByTagName('speaker').length > 0 : false) || (child.getElementsByClassName ? child.getElementsByClassName('speaker').length > 0 : false);
        const hasStageChild = (child.getElementsByTagName ? child.getElementsByTagName('stage').length > 0 : false) || (child.getElementsByClassName ? child.getElementsByClassName('stage').length > 0 : false);
        // Builds the block for this <p> from (text, segments-or-undefined); null = nothing.
        const makeP = (t, segs) => {
          if (cls.includes('bai-play') || cls.includes('play-speaker') || cls.includes('speaker') || hasSpeakerChild) {
            return { type: 'play', subtype: 'prose', style: 'play-speaker', level: pLevel, text: t, segments: segs };
          } else if (cls.includes('bai-verse') || cls.includes('play-verse') || cls.includes('verse') || cls.includes('poem') || cls.includes('line')) {
            return { type: 'play', subtype: 'verse', style: 'verse', level: pLevel, text: t, segments: segs };
          } else if (cls.includes('bai-stage') || cls.includes('play-stage') || cls.includes('stage') || hasStageChild) {
            return { type: 'stage', style: 'play-stage', level: pLevel, text: t, segments: segs };
          } else if (cls.includes('byline') || cls.includes('attribution') || cls.includes('author')) {
            return { type: 'attribution', text: t, segments: segs };
          } else if (cls.includes('quote') || cls.includes('blockquote') || cls.includes('extract') || isInsideQuote) {
            return { type: 'para', style: 'quote', level: pLevel, text: t, segments: segs };
          } else if (cls.includes('bai-stanza-break') || cls.includes('stanza-break')) {
            return { type: 'indicator', kind: 'line' };
          } else if (cls.includes('bana-break-asterism') || ((cls.includes('doc-break') || cls === 'break') && /^[⁂\s]+$/.test(t || '') && t.includes('⁂')) || /^⁂(\s+⁂)*$/.test(t || '')) {
            // A print asterism (⁂) is kept as its own kind: BANA Formats §1.9.5 follows the
            // print symbol (a transcriber-defined symbol in braille); UKAAF uses asterisks.
            return { type: 'break', kind: 'asterism' };
          } else if (cls.includes('bana-break-asterisks') || cls.includes('doc-break') || cls === 'break' || t === '* * *' || t === '∗ ∗ ∗') {
            return { type: 'break', kind: 'asterisks' };
          } else if (cls.includes('bana-break-dot2s')) {
            return { type: 'break', kind: 'dot2s' };
          } else if (t) {
            return segs ? { type: 'para', segments: segs, text: t } : { type: 'para', text: t };
          }
          return null;
        };
        // Display maths: DTBook only allows <m:math> inline, so the exporter (and many
        // producers) wrap a displayed equation in a <p> of its own. Keep it a math block.
        if (rawSegs.length === 1 && rawSegs[0].type === 'math') {
          const mathBlock = { type: 'math', mathml: rawSegs[0].mathml };
          if (rawSegs[0].latex) mathBlock.latex = rawSegs[0].latex;
          blocks.push(mathBlock);
          continue;
        }
        if (segsHavePagenum(rawSegs)) {
          const probe = makeP(directPText, undefined);
          if (probe && probe.type === 'para') {
            // Ordinary paragraph: split around the page turn(s), text resumes in cell 1.
            pushParaParts(rawSegs, blocks, makeP);
          } else {
            const pn = hoistPagenums(rawSegs);
            blocks.push(...pn.before);
            const blk = makeP(directPText, segsHaveEmphOrMath(pn.segs) && pn.segs.length ? pn.segs : undefined);
            if (blk) blocks.push(blk);
            blocks.push(...pn.after);
          }
        } else {
          const blk = makeP(directPText, segsHaveEmphOrMath(rawSegs) && rawSegs.length ? rawSegs : undefined);
          if (blk) blocks.push(blk);
        }
      } else if (tag === 'hr' || tag === 'break') {
        const cls = (child.getAttribute ? (child.getAttribute('class') || '') : '').toLowerCase();
        if (cls.includes('stanza')) blocks.push({ type: 'indicator', kind: 'line' });
        else if (cls.includes('asterisks')) blocks.push({ type: 'break', kind: 'asterisks' });
        else if (cls.includes('dot2s')) blocks.push({ type: 'break', kind: 'dot2s' });
        else blocks.push({ type: 'break', kind: 'line' });
      } else if (tag === 'list') {
        parseSingleList(child);
      } else if (tag === 'note') {
        pushNote(blocks, child);
      } else if (tag === 'annotation' || tag === 'prodnote') {
        const cls = (child.getAttribute ? (child.getAttribute('class') || '') : '').toLowerCase();
        pushTextOnly(blocks, child, (t) => (t ? (cls.includes('tabletn') ? { type: 'note', kind: 'tabletn', text: t } : { type: 'note', text: t }) : null));
      } else if (PAGENUM_TAGS.has(tag)) {
        const pn = pagenumBlock(child);
        if (pn) blocks.push(pn);
      } else if (tag === 'page') {
        pushTextOnly(blocks, child, (t) => (t ? { type: 'para', text: t } : null));
      } else {
        const hasElementChild = Array.from(child.childNodes || []).some((c) => c.nodeType === 1);
        if (hasElementChild) {
          wrapInlineRuns(child);
          walk(child);
        } else {
          const t = getCleanText(child);
          if (t) blocks.push({ type: 'para', text: t });
        }
      }
    }
  }

  // A container the walker does not know (div, a, span, sent…) may hold running text next to
  // (or instead of) block elements — "<div><a> Part A <code>…</code> Part B</a></div>". The
  // walker only visits elements, so each run of inline content is wrapped in a synthetic <p>
  // first; block children are left for the walker as before.
  // DTBook 2005-3 inline elements (%inline; minus the ones the walker handles itself) and
  // their common HTML equivalents.
  const INLINE_CHILD = new Set(['a', 'abbr', 'acronym', 'bdo', 'cite', 'code', 'dfn', 'em', 'i', 'b', 'u', 'strong', 'kbd', 'q', 'samp', 'span', 'sub', 'sup', 'sent', 'w', 'noteref', 'annoref', 'br', 'linenum', 'small', 'big', 'tt', 'var', 'mark', 'ins', 'del', 's', 'time', 'label']);
  function wrapInlineRuns(el) {
    const kids = Array.from(el.childNodes || []);
    const isInline = (n) => n.nodeType === 3 || (n.nodeType === 1 && INLINE_CHILD.has((n.localName || n.tagName || '').toLowerCase()));
    const hasText = (run) => run.some((n) => (n.nodeType === 3 ? n.nodeValue : n.textContent || '').trim());
    // Only when some inline content carries text: plain element-only containers keep the old path.
    if (!kids.some((n) => isInline(n) && hasText([n]))) return;
    let run = [];
    const flush = () => {
      if (run.length && hasText(run) && el.ownerDocument && el.ownerDocument.createElementNS) {
        const p = el.ownerDocument.createElementNS(el.namespaceURI || null, 'p');
        el.insertBefore(p, run[0]);
        for (const n of run) p.appendChild(n);
      }
      run = [];
    };
    for (const n of kids) {
      if (isInline(n)) run.push(n); else flush();
    }
    flush();
  }

  const book = doc.getElementsByTagName('book')[0] || doc.documentElement;
  walk(book);
  if (!title && blocks.length && blocks[0].type === 'heading') {
    title = blocks[0].text;
  }
  const result = { title, blocks };
  if (Object.keys(metadata).length > 0) result.metadata = metadata;
  // Nothing is dropped silently (A2): anything the model lacks is reported to the user.
  if (rootTag === 'dtbook') {
    try {
      const warnings = loadWarnings(doc, result);
      if (warnings.length) result.warnings = warnings;
    } catch { /* the check never stops a load */ }
  }
  return result;
}

export const parseNimasXml = parseDtbook;

// ---------- NIMAS package (zip of OPF + DTBook + images; A3) ----------

// Decode a possibly percent-encoded href, drop any #fragment, and collapse "./" / "../"
// segments *within the href itself* — the "folder-relative" form used for model.resources
// paths and the graphic's own src (A3d).
function normalizeHref(href) {
  let raw = String(href || '').split('#')[0];
  try { raw = decodeURIComponent(raw); } catch { /* keep literal % sequences that aren't valid escapes */ }
  const out = [];
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else out.push('..'); }
    else out.push(part);
  }
  return out.join('/');
}

// Resolve an href against a zip-internal base folder (no trailing slash) into the zip entry
// name that actually holds it.
function resolveZipPath(baseDir, href) {
  const rel = normalizeHref(href);
  if (!rel) return '';
  return baseDir ? normalizeHref(`${baseDir}/${rel}`) : rel;
}

// Every descendant element (any depth, any namespace) whose local name matches, case-
// insensitively: OPF metadata mixes OEB 1.2's <dc:Title> with OPF 2's lowercase <dc:title>,
// and the manifest's <item> needs the same tolerance for stray casing (A3a/c).
function elementsByLocalName(root, name) {
  const out = [];
  const ln = name.toLowerCase();
  (function walk(n) {
    for (let c = n && n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) {
        if ((c.localName || c.tagName || '').toLowerCase() === ln) out.push(c);
        walk(c);
      }
    }
  })(root);
  return out;
}

// dc-metadata / x-metadata from an OEB/OPF package document: dc: fields (creators joined
// with "; "), nimas-* metas, and any other named meta kept for reference (A3c); plus a few
// simple dc: attributes NIMAS's own package-doc-common.sch checks for structurally
// (dc:Date/@event="DCTERMS.created", dc:Creator/@role, dc:Identifier/@scheme — A4).
function readOpfMetadata(opfDoc) {
  const textOf = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const byLocal = (name) => elementsByLocalName(opfDoc.documentElement, name);
  const first = (name) => textOf(byLocal(name)[0]);
  const attrOf = (name, attr) => { const el = byLocal(name)[0]; return (el && el.getAttribute && el.getAttribute(attr)) || ''; };
  const dc = {
    title: first('title'),
    creator: byLocal('creator').map(textOf).filter(Boolean).join('; '),
    publisher: first('publisher'),
    date: first('date'),
    identifier: first('identifier'),
    language: first('language'),
    rights: first('rights'),
    source: first('source'),
    subject: first('subject'),
    format: first('format'),
  };
  const dcAttrs = {};
  const dateEvent = attrOf('date', 'event'); if (dateEvent) dcAttrs.dateEvent = dateEvent;
  const creatorRole = attrOf('creator', 'role'); if (creatorRole) dcAttrs.creatorRole = creatorRole;
  const identifierScheme = attrOf('identifier', 'scheme'); if (identifierScheme) dcAttrs.identifierScheme = identifierScheme;

  // x-metadata metas (nimas-* and everything else, e.g. DCTERMS.*): a name that repeats
  // (the CAST corpus has two DCTERMS.description.note) becomes an array, in source order;
  // empty content (nimas-SourceEdition="" in the CAST corpus) is kept, not dropped, so A4's
  // save can write the same, structurally-complete x-metadata back out.
  const nimas = {}, opfMeta = {};
  const addMeta = (bucket, name, content) => {
    if (Object.prototype.hasOwnProperty.call(bucket, name)) {
      bucket[name] = Array.isArray(bucket[name]) ? [...bucket[name], content] : [bucket[name], content];
    } else {
      bucket[name] = content;
    }
  };
  for (const m of byLocal('meta')) {
    const name = m.getAttribute ? m.getAttribute('name') : null;
    if (!name) continue;
    const content = m.getAttribute ? (m.getAttribute('content') || '').trim() : '';
    addMeta(name.toLowerCase().startsWith('nimas-') ? nimas : opfMeta, name, content);
  }
  return { dc, dcAttrs, nimas, opfMeta };
}

const IMAGE_MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
};
function mimeForPath(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] || 'application/octet-stream';
}

// Every graphic block anywhere in the model — nested in a box/sidebar's `blocks`, a list
// item, a table cell, wherever — via the same generic object walk load-audit.mjs uses to
// count images, rather than duplicating the block tree's shape here (A3d).
function collectGraphics(blocks) {
  const out = [];
  const seen = new Set();
  (function deep(v) {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v.type === 'graphic') out.push(v);
    for (const k in v) if (v[k] && typeof v[k] === 'object') deep(v[k]);
  })(blocks);
  return out;
}

export async function parseNimasZip(arrayBuffer) {
  const entries = listZipEntries(arrayBuffer);
  const entryByName = new Map(entries.filter((e) => !e.name.endsWith('/')).map((e) => [e.name, e]));
  const dec = new TextDecoder();

  // The OPF (there should be exactly one; NIMAS/DAISY packages don't carry more).
  const opfEntry = entries.find((e) => /\.opf$/i.test(e.name));
  let opfDoc = null, opfPath = null, opfDir = '';
  if (opfEntry) {
    opfPath = opfEntry.name;
    opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
    try { opfDoc = parseXml(dec.decode(await extractZipEntry(arrayBuffer, opfEntry))); }
    catch { /* a broken .opf still leaves the <dtbook> fallback below */ }
  }

  // Choose the book: the manifest's DTBook item (by media-type, else its first plain-XML
  // item), resolved against the OPF's folder and checked against what's actually in the zip
  // — a package can *claim* a book file it doesn't include (the opf-exemplar test package).
  let bookPath = null;
  if (opfDoc) {
    const items = elementsByLocalName(opfDoc.documentElement, 'item')
      .map((it) => ({ href: it.getAttribute('href') || '', mediaType: (it.getAttribute('media-type') || '').toLowerCase() }))
      .filter((it) => it.href);
    const dtbookItem = items.find((it) => it.mediaType.includes('dtbook'))
      || items.find((it) => /\.xml$/i.test(it.href) && !/\.(opf|ncx|smil)$/i.test(it.href));
    if (dtbookItem) {
      const resolved = resolveZipPath(opfDir, dtbookItem.href);
      if (entryByName.has(resolved)) bookPath = resolved;
    }
  }
  if (!bookPath) {
    // No usable OPF, or its manifest entry is missing from the zip: fall back to whichever
    // .xml entry actually has a <dtbook> root (a package can carry other XML — an NCX, a
    // math exemplar fragment — that isn't the book itself).
    for (const e of entries) {
      if (!/\.xml$/i.test(e.name) || e.name.toLowerCase().endsWith('container.xml')) continue;
      try {
        const root = parseXml(dec.decode(await extractZipEntry(arrayBuffer, e))).documentElement;
        if (root && (root.localName || root.tagName || '').toLowerCase() === 'dtbook') { bookPath = e.name; break; }
      } catch { /* not well-formed XML: not the book */ }
    }
  }
  if (!bookPath) {
    const names = entries.filter((e) => !e.name.endsWith('/')).map((e) => e.name.split('/').pop()).slice(0, 6);
    throw new Error(`This package has no DTBook book file (it contains: ${names.join(', ')}). A NIMAS package must include the book's .xml file.`);
  }

  const bookDir = bookPath.includes('/') ? bookPath.slice(0, bookPath.lastIndexOf('/')) : '';
  const model = parseDtbook(dec.decode(await extractZipEntry(arrayBuffer, entryByName.get(bookPath))));

  // OPF metadata fills in whatever the DTBook <head> left empty — the DTBook always wins.
  const metadata = model.metadata || (model.metadata = {});
  if (opfDoc) {
    const { dc, dcAttrs, nimas, opfMeta } = readOpfMetadata(opfDoc);
    for (const [k, v] of Object.entries(dc)) if (v && !metadata[k]) metadata[k] = v;
    if (Object.keys(dcAttrs).length) metadata.dcAttrs = { ...dcAttrs, ...(metadata.dcAttrs || {}) };
    if (Object.keys(nimas).length) metadata.nimas = { ...nimas, ...(metadata.nimas || {}) };
    if (Object.keys(opfMeta).length) metadata.opfMeta = opfMeta;
    if (!metadata.lang && metadata.language) metadata.lang = metadata.language;
    if (!model.title && dc.title) model.title = dc.title;
  }
  metadata.package = { opf: opfPath, book: bookPath };

  // Images: pull every graphic's bytes out of the zip and point its src at a package-
  // relative path; saving the package back out is A4.
  const resources = [];
  const resourceByPath = new Map();
  let missingImages = 0;
  for (const g of collectGraphics(model.blocks)) {
    const src = g.src || '';
    if (!src || /^(data:|https?:|blob:)/i.test(src)) continue;
    const relPath = normalizeHref(src);
    if (!relPath) continue;
    if (resourceByPath.has(relPath)) { g.src = relPath; continue; }
    const entry = entryByName.get(resolveZipPath(bookDir, src));
    if (!entry) { missingImages++; continue; }
    const bytes = new Uint8Array(await extractZipEntry(arrayBuffer, entry));
    const resource = { path: relPath, mime: mimeForPath(relPath), bytes };
    resources.push(resource);
    resourceByPath.set(relPath, resource);
    g.src = relPath;
  }
  // The package's own source PDF(s) (A4 writes them back out on save): the OPF manifest's
  // application/pdf item(s), resolved against the OPF's folder like any other manifest href;
  // failing that (no usable OPF), any .pdf entry that sits in the book's own folder. Kept
  // with a package-relative path (like an image's), so save can put it back at the same spot.
  const pdfZipPaths = new Set();
  if (opfDoc) {
    const pdfItems = elementsByLocalName(opfDoc.documentElement, 'item')
      .map((it) => ({ href: it.getAttribute('href') || '', mediaType: (it.getAttribute('media-type') || '').toLowerCase() }))
      .filter((it) => it.href && it.mediaType.includes('pdf'));
    for (const it of pdfItems) {
      const resolved = resolveZipPath(opfDir, it.href);
      if (entryByName.has(resolved)) pdfZipPaths.add(resolved);
    }
  }
  if (!pdfZipPaths.size) {
    for (const e of entries) {
      if (!/\.pdf$/i.test(e.name)) continue;
      const dir = e.name.includes('/') ? e.name.slice(0, e.name.lastIndexOf('/')) : '';
      if (dir === bookDir) pdfZipPaths.add(e.name);
    }
  }
  for (const zipPath of pdfZipPaths) {
    const entry = entryByName.get(zipPath);
    if (!entry) continue;
    const bookPrefix = bookDir ? `${bookDir}/` : '';
    const relPath = bookPrefix && zipPath.startsWith(bookPrefix) ? zipPath.slice(bookPrefix.length) : zipPath;
    const bytes = new Uint8Array(await extractZipEntry(arrayBuffer, entry));
    resources.push({ path: relPath, mime: 'application/pdf', bytes, role: 'source-pdf' });
  }

  if (resources.length) model.resources = resources;
  if (missingImages) {
    (model.warnings || (model.warnings = [])).push(
      `${missingImages} image${missingImages === 1 ? '' : 's'} referenced by the book ${missingImages === 1 ? 'is' : 'are'} missing from the package`);
  }
  return model;
}

// Formats that need the raw bytes (ArrayBuffer) rather than text.
export const BINARY_EXTS = new Set(['docx', 'odt', 'epub', 'zip', 'ebrl', 'ebraille']);

// dispatch by filename / extension
export async function parseFile(name, dataOrText) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'xml' || ext === 'nimas' || ext === 'dtbook' || (typeof dataOrText === 'string' && (dataOrText.includes('<dtbook') || dataOrText.includes('xmlns="http://www.daisy.org/z3986/2005/dtbook/')))) {
    return parseDtbook(dataOrText);
  }
  switch (ext) {
    case 'docx': return parseDocx(dataOrText);
    case 'odt':  return parseOdt(dataOrText);
    case 'epub':
    case 'ebrl':
    case 'ebraille': return parseEpub(dataOrText);
    case 'zip':  return parseNimasZip(dataOrText);
    case 'html': case 'htm': case 'xhtml': return parseHtml(dataOrText);
    case 'md': case 'markdown': return parseMarkdown(dataOrText);
    case 'rtf':  return parseRtf(dataOrText);
    default:     return parseText(dataOrText);                   // txt / fallback
  }
}

