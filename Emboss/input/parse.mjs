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
          if (hasEmphOrMath) blocks.push({ type: 'heading', level: Math.min(3, Number(tag[1])), segments, text });
          else {
            const flat = segments.map((s) => s.text || '').join('').replace(/\s+/g, ' ').trim();
            blocks.push({ type: 'heading', level: Math.min(3, Number(tag[1])), text: flat || text });
          }
        } else {
          blocks.push({ type: 'heading', level: Math.min(3, Number(tag[1])), text });
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

// Minimal ZIP: read the central directory to locate & extract one entry.
async function unzipEntry(buf, wanted) {
  let ab = buf;
  if (buf && buf.buffer instanceof ArrayBuffer && !(buf instanceof ArrayBuffer)) {
    ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const dv = new DataView(ab);
  const u8 = new Uint8Array(ab);
  // find End Of Central Directory (sig 0x06054b50), scanning back
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (no EOCD)');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
    if (name === wanted) {
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = u8.subarray(dataStart, dataStart + compSize);
      return method === 0 ? data : inflateRaw(data);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`entry not found in zip: ${wanted}`);
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
      const level = Math.min(3, Number(style.match(/^heading([1-9])/)[1]));
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
        blocks.push(hasEmphOrMath && segs.length ? { type: 'heading', level: Math.min(3, level), segments: segs, text } : { type: 'heading', level: Math.min(3, level), text });
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
        blocks.push({ type: 'heading', level: Math.min(3, lvl || 1), text });
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
  let title = doctitle?.textContent?.replace(/\s+/g, ' ').trim() || null;
  if (doc.getElementsByTagName) {
    const metaTags = [...doc.getElementsByTagName('meta')];
    for (const m of metaTags) {
      const name = m.getAttribute ? m.getAttribute('name') : null;
      const content = m.getAttribute ? (m.getAttribute('content') || '').trim() : '';
      if (!name || !content) continue;
      if (name === 'dtb:uid') metadata.uid = content;
      else if (name === 'dc:Title') {
        metadata.title = content;
        if (!title) title = content;
      } else if (name === 'dc:Publisher') metadata.publisher = content;
      else if (name === 'dc:Date') metadata.date = content;
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
          if (hasExclude && excludeTags.has(tag)) continue;
          const cls = (child.getAttribute ? (child.getAttribute('class') || '') : '').toLowerCase();
          if (tag === 'brl' || tag === 'linenum' || cls.includes('linenum') || cls.includes('line-number')) continue;
          const isBlock = BLOCK_TAGS.has(tag);
          if (isBlock) text += ' ';
          collect(child);
          if (isBlock) text += ' ';
        }
      }
    }
    collect(el);
    return text.replace(/\s+/g, ' ').trim();
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

    function walkInline(node, parentTf, parentUnc) {
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
          if (hasExclude && excludeTags.has(tag)) continue;
          let nextTf = parentTf;
          let nextUnc = parentUnc;

          if (tag === 'linenum' || cls.includes('linenum') || cls.includes('line-number')) {
            continue;
          }

          if (tag === 'lic' && text && !text.endsWith(' ')) {
            flush();
            text += ' ';
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
          walkInline(child, nextTf, nextUnc);
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
    
    // Check for child <hd> / heading inside <list> and emit it as a preceding heading
    for (let c = child.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const cTag = (c.localName || c.tagName || '').toLowerCase();
      if (cTag === 'hd' || cTag === 'title' || /^h[1-6]$/.test(cTag)) {
        const t = getCleanText(c);
        if (t && targetBlocks) {
          const segs = inlineSegments(c);
          const hasEmph = segs.some(s => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
          targetBlocks.push(hasEmph && segs.length ? { type: 'heading', level: 3, text: t, segments: segs } : { type: 'heading', level: 3, text: t });
        }
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
              if (sTag === 'hd' || /^h[1-6]$/.test(sTag)) {
                const hdText = (sib.textContent || '').toLowerCase().trim();
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
    const items = [];
    let counter = 1;
    let detectedKind = isToc ? 'toc' : (isIndex ? 'index' : (listTypeAttr.toLowerCase() === 'pl' ? 'plain' : null));
    let lastTopItem = null;

    const NUMBER_PREFIX_RE = /^\s*(\d+|[a-zA-Z]|[ivxlcdm]+)[\.\)]\s+/;
    const BULLET_PREFIX_RE = /^\s*[•\-\*\u2022\u2023\u25E6\u2043\u2219\u25AA\u25AB\u25CF\u25CB\uF0B7\uF0A7\u00B7]+\s+/;

    for (let li = child.firstChild; li; li = li.nextSibling) {
      if (li.nodeType !== 1) continue;
      const liTag = (li.localName || li.tagName || '').toLowerCase();
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

      const lics = li.getElementsByTagName ? [...li.getElementsByTagName('lic')] : [];
      const hasLics = lics.length > 0;
      const isLiToc = isToc || liClass.includes('toc-entry') || liClass.includes('bai-toc-entry') || hasLics;

      if (liClass.includes('bai-toc-center')) {
        const t = getCleanText(li, LIST_TAGS);
        if (t && targetBlocks) targetBlocks.push({ type: 'heading', level: 1, text: t });
        continue;
      }

      if (liClass.includes('toc-page') || liClass.includes('bai-toc-page')) {
        detectedKind = 'toc';
        const pVal = getCleanText(li, LIST_TAGS);
        if (pVal) {
          if (lastTopItem) {
            lastTopItem.page = pVal;
          } else if (items.length > 0) {
            items[items.length - 1].page = pVal;
          }
        }
        for (const cl of childLists) {
          const subItems = parseSingleList(cl, effLevel + 1, null);
          items.push(...subItems);
        }
        continue;
      }

      if (isLiToc) {
        detectedKind = 'toc';
        let itemText = '';
        let pageVal = null;
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
            return cls.includes('toc-page') || cls.includes('bai-toc-page') || cls.includes('page') || cls.includes('pagenum') || hasPageTag;
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
            pageVal = getCleanText(pageEl, TOC_EXCLUDE);
          }
        }

        const directPageNode = li.getElementsByTagName ? (li.getElementsByTagName('pagenum')[0] || li.getElementsByTagName('print-page')[0]) : null;
        if (!pageVal && directPageNode) {
          pageVal = (directPageNode.textContent || '').trim();
          if (!textEl) {
            itemText = getCleanText(li, TOC_EXCLUDE);
          }
        }

        const segs = inlineSegments(textTargetNode, true, directPageNode && !textEl ? TOC_EXCLUDE : null);
        
        if (!itemText) {
          const directText = segs.map(s => s.text || '').join('').replace(/\s+/g, ' ').trim();
          const pageMatch = directText.match(/\s+(\d+|[ivxlcdm]+)$/i);
          if (pageMatch) {
            itemText = directText.slice(0, pageMatch.index).trim();
            if (!pageVal) pageVal = pageMatch[1];
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
        const hasEmphOrMath = segs.some(s => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
        const item = { text: itemText };
        if (pageVal) item.page = pageVal;
        if (effLevel > 0) item.level = effLevel;
        if (segs.length && hasEmphOrMath) item.segments = segs;
        items.push(item);
        lastTopItem = item;

        for (const cl of childLists) {
          const subItems = parseSingleList(cl, effLevel + 1, null);
          items.push(...subItems);
        }
        continue;
      }

      if (liClass.includes('bai-exercise')) {
        detectedKind = 'exercise';
        const segs = inlineSegments(li, true);
        const t = segs.map(s => s.text || '').join('').replace(/\s+/g, ' ').trim() || getCleanText(li, LIST_TAGS);
        const item = { text: t };
        if (effLevel > 0) item.level = effLevel;
        if (segs.length && segs.some(s => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')))) item.segments = segs;
        items.push(item);
        lastTopItem = item;

        for (const cl of childLists) {
          const subItems = parseSingleList(cl, effLevel + 1, null);
          items.push(...subItems);
        }
        continue;
      }

      if (liClass.includes('bai-index')) {
        detectedKind = 'index';
        const segs = inlineSegments(li, true);
        const t = segs.map(s => s.text || '').join('').replace(/\s+/g, ' ').trim() || getCleanText(li, LIST_TAGS);
        const item = { text: t };
        if (effLevel > 0) item.level = effLevel;
        if (segs.length && segs.some(s => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')))) item.segments = segs;
        items.push(item);
        lastTopItem = item;

        for (const cl of childLists) {
          const subItems = parseSingleList(cl, effLevel + 1, null);
          items.push(...subItems);
        }
        continue;
      }

      const segs = inlineSegments(li, true);
      let directText = segs.map(s => s.text || (s.latex ? s.latex : (s.mathml ? s.mathml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : ''))).join('').replace(/\s+/g, ' ').trim();
      if (!directText) directText = getCleanText(li);

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
          itemMarker = `${counter}.`;
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

      const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
      if (directText) {
        const item = (hasEmphOrMath && segs.length > 0 && childLists.length === 0) ? { segments: segs, text: directText } : { text: directText };
        if (itemMarker) item.marker = itemMarker;
        if (effLevel > 0) item.level = effLevel;
        items.push(item);
        lastTopItem = item;
      }

      for (const cl of childLists) {
        const subItems = parseSingleList(cl, effLevel + 1, null);
        items.push(...subItems);
      }
    }

    if (items.length && targetBlocks) {
      const listBlock = { type: 'list', items };
      if (detectedKind) {
        listBlock.kind = detectedKind;
        listBlock.style = detectedKind;
      }
      if (isOl) listBlock.ordered = true;
      targetBlocks.push(listBlock);
    }
    return items;
  }

  function parseDefinitionList(dlEl, targetBlocks = blocks) {
    const items = [];
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
        curTermSegs = inlineSegments(c);
      } else if (cTag === 'dd') {
        const defText = getCleanText(c);
        const defSegs = inlineSegments(c);
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
    if (items.length && targetBlocks) {
      targetBlocks.push({ type: 'list', kind: 'glossary', style: 'glossary', items });
    }
  }

  function parsePoem(poemEl, targetBlocks = blocks) {
    let pendingLinenum = '';
    for (let c = poemEl.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      const cTag = (c.localName || c.tagName || '').toLowerCase();
      const cCls = (c.getAttribute ? (c.getAttribute('class') || '') : '').toLowerCase();

      if (cTag === 'title' || cTag === 'hd' || /^h[1-6]$/.test(cTag)) {
        const t = getCleanText(c);
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : (/^h[1-6]$/.test(cTag) ? parseInt(cTag.slice(1), 10) : 2);
        const segs = inlineSegments(c);
        const hasEmph = segs.some(s => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
        if (t && targetBlocks) targetBlocks.push(hasEmph && segs.length ? { type: 'heading', level: lvl, text: t, segments: segs } : { type: 'heading', level: lvl, text: t });
      } else if (cTag === 'pagenum') {
        const pageVal = (c.textContent || '').trim();
        if (pageVal && targetBlocks) targetBlocks.push({ type: 'pagenum', text: pageVal });
      } else if (cTag === 'byline' || cTag === 'author' || cTag === 'cite' || cTag === 'attrib') {
        const segs = inlineSegments(c);
        const hasEmph = segs.some(s => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
        const t = getCleanText(c);
        if (t && targetBlocks) {
          targetBlocks.push(hasEmph && segs.length ? { type: 'attribution', text: t, segments: segs } : { type: 'attribution', text: t });
        }
      } else if (cTag === 'linegroup' || cTag === 'stanza' || (cTag === 'div' && (cCls.includes('stanza') || cCls.includes('linegroup') || cCls.includes('line-group') || cCls.includes('verse') || cCls.includes('poem')))) {
        let stanzaLinenum = '';
        let hasLinesInGroup = false;
        for (let ln = c.firstChild; ln; ln = ln.nextSibling) {
          if (ln.nodeType !== 1) continue;
          const lnTag = (ln.localName || ln.tagName || '').toLowerCase();
          const lnCls = (ln.getAttribute ? (ln.getAttribute('class') || '') : '').toLowerCase();
          if (lnTag === 'pagenum') {
            const pageVal = (ln.textContent || '').trim();
            if (pageVal && targetBlocks) targetBlocks.push({ type: 'pagenum', text: pageVal });
          } else if (lnTag === 'linenum' || lnCls.includes('linenum')) {
            stanzaLinenum = (ln.textContent || '').trim();
          } else if (lnTag === 'title' || lnTag === 'hd' || /^h[1-6]$/.test(lnTag)) {
            const t = getCleanText(ln);
            if (t && targetBlocks) targetBlocks.push({ type: 'heading', level: 3, text: t });
          } else if (lnTag === 'line' || lnTag === 'ln' || lnTag === 'p') {
            if (lnCls.includes('bai-stanza-break') || lnCls.includes('stanza-break')) {
              if (targetBlocks) targetBlocks.push({ type: 'indicator', kind: 'line' });
            } else {
              const lvlAttr = ln.getAttribute ? ln.getAttribute('level') : null;
              const lnLvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
              let segs = inlineSegments(ln);
              let t = getCleanText(ln);
              let innerLinenum = '';
              if (ln.getElementsByTagName) {
                const numNode = ln.getElementsByTagName('linenum')[0] || (ln.getElementsByClassName ? ln.getElementsByClassName('linenum')[0] : null);
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
              if (t && targetBlocks) {
                const hasEmph = segs.some(s => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
                const blk = hasEmph && segs.length
                  ? { type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segs }
                  : { type: 'play', subtype: 'verse', style: 'verse', text: t };
                if (lnLvl > 0) blk.level = lnLvl;
                targetBlocks.push(blk);
                hasLinesInGroup = true;
              }
            }
          } else if (lnTag === 'byline' || lnTag === 'author' || lnTag === 'cite' || lnTag === 'attrib' || lnCls.includes('attribution') || lnCls.includes('byline')) {
            const segs = inlineSegments(ln);
            const hasEmph = segs.some(s => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
            const t = getCleanText(ln);
            if (t && targetBlocks) {
              targetBlocks.push(hasEmph && segs.length ? { type: 'attribution', text: t, segments: segs } : { type: 'attribution', text: t });
            }
          } else if (lnTag === 'note' || lnTag === 'prodnote') {
            const t = getCleanText(ln);
            if (t && targetBlocks) targetBlocks.push({ type: 'note', text: t });
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
        let segs = inlineSegments(c);
        let t = getCleanText(c);
        let innerLinenum = '';
        if (c.getElementsByTagName) {
          const numNode = c.getElementsByTagName('linenum')[0] || (c.getElementsByClassName ? c.getElementsByClassName('linenum')[0] : null);
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
        if (t && targetBlocks) {
          const hasEmph = segs.some(s => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
          const blk = hasEmph && segs.length
            ? { type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segs }
            : { type: 'play', subtype: 'verse', style: 'verse', text: t };
          if (lnLvl > 0) blk.level = lnLvl;
          targetBlocks.push(blk);
        }
      } else if (cTag === 'linenum' || cCls.includes('linenum')) {
        pendingLinenum = (c.textContent || '').trim();
      } else if (cTag === 'p') {
        if (cCls.includes('bai-stanza-break') || cCls.includes('stanza-break')) {
          if (targetBlocks) targetBlocks.push({ type: 'indicator', kind: 'line' });
        } else {
          const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
          const pLvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
          const segs = inlineSegments(c);
          const hasEmph = segs.some(s => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
          const t = getCleanText(c);
          if (t && targetBlocks) {
            const blk = hasEmph && segs.length
              ? { type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segs }
              : { type: 'play', subtype: 'verse', style: 'verse', text: t };
            if (pLvl > 0) blk.level = pLvl;
            targetBlocks.push(blk);
          }
        }
      } else if (cTag === 'sidebar') {
        parseSidebar(c, targetBlocks);
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
        const segs = inlineSegments(c);
        const hasEmph = segs.some(s => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
        innerBlocks.push(hasEmph && segs.length ? { type: 'heading', level: lvl, text: hdText, segments: segs } : { type: 'heading', level: lvl, text: hdText });
      } else if (cTag === 'p') {
        const cls = (c.getAttribute ? (c.getAttribute('class') || '') : '').toLowerCase();
        const pLevel = getElementLevel(c);
        const segs = inlineSegments(c);
        const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
        const t = getCleanText(c);
        if (cls.includes('bai-play') || cls.includes('play-speaker') || cls.includes('speaker')) {
          innerBlocks.push({ type: 'play', subtype: 'prose', style: 'play-speaker', level: pLevel, text: t, segments: (hasEmphOrMath && segs.length ? segs : undefined) });
        } else if (cls.includes('bai-verse') || cls.includes('play-verse') || cls.includes('verse') || cls.includes('poem')) {
          innerBlocks.push({ type: 'play', subtype: 'verse', style: 'verse', level: pLevel, text: t, segments: (hasEmphOrMath && segs.length ? segs : undefined) });
        } else if (cls.includes('bai-stage') || cls.includes('play-stage') || cls.includes('stage')) {
          innerBlocks.push({ type: 'stage', style: 'play-stage', level: pLevel, text: t, segments: (hasEmphOrMath && segs.length ? segs : undefined) });
        } else if (cls.includes('bai-stanza-break') || cls.includes('stanza-break')) {
          innerBlocks.push({ type: 'indicator', kind: 'line' });
        } else if (cls.includes('bana-break-asterisks')) {
          innerBlocks.push({ type: 'break', kind: 'asterisks' });
        } else if (cls.includes('bana-break-dot2s')) {
          innerBlocks.push({ type: 'break', kind: 'dot2s' });
        } else if (t) {
          innerBlocks.push(hasEmphOrMath && segs.length ? { type: 'para', segments: segs, text: t } : { type: 'para', text: t });
        }
      } else if (cTag === 'speaker') {
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        const segs = inlineSegments(c);
        const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
        const t = getCleanText(c);
        if (t) {
          const blk = (hasEmphOrMath && segs.length)
            ? { type: 'play', subtype: 'prose', style: 'play-speaker', text: t, segments: segs }
            : { type: 'play', subtype: 'prose', style: 'play-speaker', text: t };
          if (lvl > 0) blk.level = lvl;
          innerBlocks.push(blk);
        }
      } else if (cTag === 'stage') {
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        const segs = inlineSegments(c);
        const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
        const t = getCleanText(c);
        if (t) {
          const blk = (hasEmphOrMath && segs.length)
            ? { type: 'stage', style: 'play-stage', text: t, segments: segs }
            : { type: 'stage', style: 'play-stage', text: t };
          if (lvl > 0) blk.level = lvl;
          innerBlocks.push(blk);
        }
      } else if (cTag === 'poem' || cTag === 'linegroup') {
        parsePoem(c, innerBlocks);
      } else if (cTag === 'line' || cTag === 'ln') {
        const lvlAttr = c.getAttribute ? c.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        const segs = inlineSegments(c);
        const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
        const t = getCleanText(c);
        if (t) {
          const blk = (hasEmphOrMath && segs.length)
            ? { type: 'play', subtype: 'verse', style: 'verse', text: t, segments: segs }
            : { type: 'play', subtype: 'verse', style: 'verse', text: t };
          if (lvl > 0) blk.level = lvl;
          innerBlocks.push(blk);
        }
      } else if (cTag === 'list' || cTag === 'ul' || cTag === 'ol') {
        parseSingleList(c, 0, innerBlocks);
      } else if (cTag === 'dl') {
        parseDefinitionList(c, innerBlocks);
      } else if (cTag === 'table') {
        parseTable(c, innerBlocks);
      } else if (cTag === 'caption') {
        const t = getCleanText(c);
        if (t) innerBlocks.push({ type: 'caption', text: t });
      } else if (cTag === 'note' || cTag === 'prodnote' || cTag === 'annotation') {
        const cls = (c.getAttribute ? (c.getAttribute('class') || '') : '').toLowerCase();
        const t = getCleanText(c);
        if (t) {
          if (cls.includes('footnote')) innerBlocks.push({ type: 'footnote', text: t });
          else if (cls.includes('tabletn')) innerBlocks.push({ type: 'note', kind: 'tabletn', text: t });
          else innerBlocks.push({ type: 'note', text: t });
        }
      } else if (cTag === 'byline' || cTag === 'author' || cTag === 'cite' || cTag === 'attrib') {
        const segs = inlineSegments(c);
        const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
        const t = getCleanText(c);
        if (t) {
          innerBlocks.push(hasEmphOrMath && segs.length ? { type: 'attribution', text: t, segments: segs } : { type: 'attribution', text: t });
        }
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
        const img = c.getElementsByTagName ? (c.getElementsByTagName('img')[0] || c.getElementsByTagName('image')[0]) : null;
        const alt = (img?.getAttribute ? img.getAttribute('alt') : '') || (c.getAttribute ? c.getAttribute('alt') : '') || '';
        const caption = c.getElementsByTagName ? (c.getElementsByTagName('caption')[0] || c.getElementsByTagName('prodnote')[0]) : null;
        const capText = caption ? getCleanText(caption) : '';
        const noteText = alt ? ('Image: ' + alt + (capText ? ' - ' + capText : '')) : (capText ? 'Image: ' + capText : 'Image');
        innerBlocks.push({ type: 'note', kind: 'image', text: noteText });
        if (img) {
          const src = (img.getAttribute ? img.getAttribute('src') : '') || '';
          innerBlocks.push({ type: 'graphic', src, alt });
        }
      } else if (cTag === 'img' || cTag === 'image' || cTag === 'graphic') {
        const src = (c.getAttribute ? c.getAttribute('src') : '') || '';
        const alt = (c.getAttribute ? c.getAttribute('alt') : '') || '';
        innerBlocks.push({ type: 'graphic', src, alt });
      } else if (cTag === 'blockquote') {
        const hasElements = Array.from(c.childNodes || []).some((childNode) => childNode.nodeType === 1);
        if (hasElements) {
          for (let bcn = c.firstChild; bcn; bcn = bcn.nextSibling) {
            if (bcn.nodeType !== 1) continue;
            const bcnTag = (bcn.localName || bcn.tagName || '').toLowerCase();
            const bcnText = getCleanText(bcn);
            if (!bcnText) continue;
            const bcnSegs = inlineSegments(bcn);
            const bcnHasEmph = bcnSegs.some((s) => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
            if (bcnTag === 'byline' || bcnTag === 'author' || bcnTag === 'cite' || bcnTag === 'attrib') {
              innerBlocks.push(bcnHasEmph && bcnSegs.length ? { type: 'attribution', text: bcnText, segments: bcnSegs } : { type: 'attribution', text: bcnText });
            } else {
              innerBlocks.push(bcnHasEmph && bcnSegs.length ? { type: 'para', style: 'quote', text: bcnText, segments: bcnSegs } : { type: 'para', style: 'quote', text: bcnText });
            }
          }
        } else {
          const segs = inlineSegments(c);
          const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
          const t = getCleanText(c);
          if (t) innerBlocks.push(hasEmphOrMath && segs.length ? { type: 'para', style: 'quote', text: t, segments: segs } : { type: 'para', style: 'quote', text: t });
        }
      } else if (cTag === 'pagenum' || cTag === 'print-page') {
        const pVal = getCleanText(c) || (c.getAttribute ? c.getAttribute('page') : '') || '';
        if (pVal) innerBlocks.push({ type: 'pagenum', text: pVal });
      } else if (cTag === 'hr' || cTag === 'break') {
        const cls = (c.getAttribute ? (c.getAttribute('class') || '') : '').toLowerCase();
        if (cls.includes('stanza')) innerBlocks.push({ type: 'indicator', kind: 'line' });
        else if (cls.includes('asterisks')) innerBlocks.push({ type: 'break', kind: 'asterisks' });
        else if (cls.includes('dot2s')) innerBlocks.push({ type: 'break', kind: 'dot2s' });
        else innerBlocks.push({ type: 'break', kind: 'line' });
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

    const cls = tableEl.getAttribute ? (tableEl.getAttribute('class') || '') : '';
    let format = null;
    if (cls.includes('bana-listed') || cls.includes('listed')) format = 'listed';
    else if (cls.includes('bana-spatial') || cls.includes('spatial')) format = 'spatial';

    const trs = tableEl.getElementsByTagName ? [...tableEl.getElementsByTagName('tr')] : [];
    const headers = [];
    const rows = [];

    const thead = tableEl.getElementsByTagName ? tableEl.getElementsByTagName('thead')[0] : null;
    let headerRowFound = false;

    if (thead) {
      const theadTrs = [...thead.getElementsByTagName('tr')];
      if (theadTrs.length) {
        for (let c = theadTrs[0].firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          const tag = (c.localName || c.tagName || '').toLowerCase();
          if (tag === 'th' || tag === 'td') {
            headers.push(getCleanText(c));
          }
        }
        headerRowFound = true;
      }
    }

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
        headers.push(...cells.map(getCleanText));
        headerRowFound = true;
      } else {
        const rowCells = [];
        for (const cell of cells) {
          const cellText = getCleanText(cell);
          const colspan = parseInt(cell.getAttribute ? (cell.getAttribute('colspan') || '1') : '1', 10) || 1;
          rowCells.push(cellText);
          for (let k = 1; k < colspan; k++) rowCells.push('');
        }
        if (rowCells.some(Boolean)) rows.push(rowCells);
      }
    }

    if (headers.length || rows.length) {
      const tblBlock = { type: 'table', headers, rows };
      if (format) {
        tblBlock.format = format;
        tblBlock.style = `table-${format}`;
      }
      targetBlocks.push(tblBlock);
    }
  }

  function walk(node) {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      const tag = (child.localName || child.tagName || '').toLowerCase();
      const cls = (child.getAttribute ? (child.getAttribute('class') || '') : '').toLowerCase();
      if (tag === 'doctitle' || tag === 'docauthor' || tag === 'head') continue;
      
      if (/^h[1-6]$/.test(tag) || tag === 'hd' || tag === 'bridgehead') {
        const lvl = tag === 'bridgehead' ? 2 : (tag === 'hd' ? 2 : Math.min(3, parseInt(tag.slice(1), 10) || 1));
        const segs = inlineSegments(child);
        const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
        const t = getCleanText(child);
        if (t) {
          if (hasEmphOrMath && segs.length > 0) blocks.push({ type: 'heading', level: lvl, segments: segs, text: t });
          else blocks.push({ type: 'heading', level: lvl, text: t });
        }
      } else if (tag === 'caption' || tag === 'figcaption') {
        const t = getCleanText(child);
        if (t) blocks.push({ type: 'caption', text: t });
      } else if (tag === 'tabletn' || tag === 'bai-tabletn') {
        const t = getCleanText(child);
        if (t) blocks.push({ type: 'note', kind: 'tabletn', text: t });
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
        const segs = inlineSegments(child);
        const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
        const t = getCleanText(child);
        if (t) {
          const blk = (hasEmphOrMath && segs.length > 0)
            ? { type: 'play', subtype: 'prose', style: 'play-speaker', text: t, segments: segs }
            : { type: 'play', subtype: 'prose', style: 'play-speaker', text: t };
          if (lvl > 0) blk.level = lvl;
          blocks.push(blk);
        }
      } else if (tag === 'stage') {
        const lvlAttr = child.getAttribute ? child.getAttribute('level') : null;
        const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
        const segs = inlineSegments(child);
        const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
        const t = getCleanText(child);
        if (t) {
          const blk = (hasEmphOrMath && segs.length > 0)
            ? { type: 'stage', style: 'play-stage', text: t, segments: segs }
            : { type: 'stage', style: 'play-stage', text: t };
          if (lvl > 0) blk.level = lvl;
          blocks.push(blk);
        }
      } else if (tag === 'blockquote') {
        const hasElements = Array.from(child.childNodes || []).some((c) => c.nodeType === 1);
        if (hasElements) {
          walk(child);
        } else {
          const segs = inlineSegments(child);
          const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
          const t = getCleanText(child);
          if (t) {
            if (hasEmphOrMath && segs.length > 0) blocks.push({ type: 'para', style: 'quote', segments: segs, text: t });
            else blocks.push({ type: 'para', style: 'quote', text: t });
          }
        }
      } else if (tag === 'dt' || tag === 'dfn') {
        const t = getCleanText(child);
        if (t) blocks.push({ type: 'para', style: 'dt', text: t });
      } else if (tag === 'dd') {
        const t = getCleanText(child);
        if (t) blocks.push({ type: 'para', style: 'dd', text: t });
      } else if (tag === 'byline' || tag === 'author' || tag === 'cite' || tag === 'attrib') {
        const segs = inlineSegments(child);
        const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
        const t = getCleanText(child);
        if (t) {
          if (hasEmphOrMath && segs.length > 0) blocks.push({ type: 'attribution', text: t, segments: segs });
          else blocks.push({ type: 'attribution', text: t });
        }
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
        const segs = inlineSegments(child);
        const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
        const t = getCleanText(child);
        if (t) {
          const blk = (hasEmphOrMath && segs.length > 0)
            ? { type: 'play', subtype: 'verse', style: 'verse', segments: segs, text: t }
            : { type: 'play', subtype: 'verse', style: 'verse', text: t };
          if (lvl > 0) blk.level = lvl;
          blocks.push(blk);
        }
      } else if (tag === 'imggroup') {
        const img = child.getElementsByTagName ? (child.getElementsByTagName('img')[0] || child.getElementsByTagName('image')[0]) : null;
        const alt = (img?.getAttribute ? img.getAttribute('alt') : '') || (child.getAttribute ? child.getAttribute('alt') : '') || '';
        const caption = child.getElementsByTagName ? (child.getElementsByTagName('caption')[0] || child.getElementsByTagName('prodnote')[0]) : null;
        const capText = caption ? getCleanText(caption) : '';
        const noteText = alt ? ('Image: ' + alt + (capText ? ' - ' + capText : '')) : (capText ? 'Image: ' + capText : 'Image');
        blocks.push({ type: 'note', kind: 'image', text: noteText });
        if (img) {
          const src = (img.getAttribute ? img.getAttribute('src') : '') || '';
          blocks.push({ type: 'graphic', src, alt });
        }
      } else if (tag === 'img' || tag === 'image') {
        const src = (child.getAttribute ? child.getAttribute('src') : '') || '';
        const alt = (child.getAttribute ? child.getAttribute('alt') : '') || '';
        blocks.push({ type: 'graphic', src, alt });
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

        const segs = inlineSegments(child);
        const hasEmphOrMath = segs.some((s) => s.tf || s.uncontracted || s.type === 'math' || (s.text && s.text.includes('\n')));
        const hasSpeakerChild = (child.getElementsByTagName ? child.getElementsByTagName('speaker').length > 0 : false) || (child.getElementsByClassName ? child.getElementsByClassName('speaker').length > 0 : false);
        const hasStageChild = (child.getElementsByTagName ? child.getElementsByTagName('stage').length > 0 : false) || (child.getElementsByClassName ? child.getElementsByClassName('stage').length > 0 : false);
        if (cls.includes('bai-play') || cls.includes('play-speaker') || cls.includes('speaker') || hasSpeakerChild) {
          blocks.push({ type: 'play', subtype: 'prose', style: 'play-speaker', level: pLevel, text: directPText, segments: (hasEmphOrMath && segs.length ? segs : undefined) });
        } else if (cls.includes('bai-verse') || cls.includes('play-verse') || cls.includes('verse') || cls.includes('poem') || cls.includes('line')) {
          blocks.push({ type: 'play', subtype: 'verse', style: 'verse', level: pLevel, text: directPText, segments: (hasEmphOrMath && segs.length ? segs : undefined) });
        } else if (cls.includes('bai-stage') || cls.includes('play-stage') || cls.includes('stage') || hasStageChild) {
          blocks.push({ type: 'stage', style: 'play-stage', level: pLevel, text: directPText, segments: (hasEmphOrMath && segs.length ? segs : undefined) });
        } else if (cls.includes('byline') || cls.includes('attribution') || cls.includes('author')) {
          blocks.push({ type: 'attribution', text: directPText, segments: (hasEmphOrMath && segs.length ? segs : undefined) });
        } else if (cls.includes('quote') || cls.includes('blockquote') || cls.includes('extract') || isInsideQuote) {
          blocks.push({ type: 'para', style: 'quote', level: pLevel, text: directPText, segments: (hasEmphOrMath && segs.length ? segs : undefined) });
        } else if (cls.includes('bai-stanza-break') || cls.includes('stanza-break')) {
          blocks.push({ type: 'indicator', kind: 'line' });
        } else if (cls.includes('bana-break-asterisks') || cls.includes('doc-break') || cls === 'break' || directPText === '⁂ ⁂ ⁂' || directPText === '* * *' || directPText === '∗ ∗ ∗') {
          blocks.push({ type: 'break', kind: 'asterisks' });
        } else if (cls.includes('bana-break-dot2s')) {
          blocks.push({ type: 'break', kind: 'dot2s' });
        } else if (directPText) {
          if (hasEmphOrMath && segs.length > 0) blocks.push({ type: 'para', segments: segs, text: directPText });
          else blocks.push({ type: 'para', text: directPText });
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
        const cls = (child.getAttribute ? (child.getAttribute('class') || '') : '').toLowerCase();
        const t = getCleanText(child);
        if (t) {
          if (cls.includes('footnote') || (child.getAttribute && child.getAttribute('role') === 'doc-footnote')) {
            blocks.push({ type: 'footnote', text: t });
          } else {
            blocks.push({ type: 'note', text: t });
          }
        }
      } else if (tag === 'annotation' || tag === 'prodnote') {
        const cls = (child.getAttribute ? (child.getAttribute('class') || '') : '').toLowerCase();
        const t = getCleanText(child);
        if (t) {
          if (cls.includes('tabletn')) {
            blocks.push({ type: 'note', kind: 'tabletn', text: t });
          } else {
            blocks.push({ type: 'note', text: t });
          }
        }
      } else if (tag === 'pagenum' || tag === 'print-page') {
        const pVal = getCleanText(child) || (child.getAttribute ? child.getAttribute('page') : '') || (child.getAttribute ? child.getAttribute('id') : '') || '';
        if (pVal) blocks.push({ type: 'pagenum', text: pVal });
      } else if (tag === 'page') {
        const t = getCleanText(child);
        if (t) blocks.push({ type: 'para', text: t });
      } else {
        const hasElementChild = Array.from(child.childNodes || []).some((c) => c.nodeType === 1);
        if (hasElementChild) {
          walk(child);
        } else {
          const t = getCleanText(child);
          if (t) blocks.push({ type: 'para', text: t });
        }
      }
    }
  }

  const book = doc.getElementsByTagName('book')[0] || doc.documentElement;
  walk(book);
  if (!title && blocks.length && blocks[0].type === 'heading') {
    title = blocks[0].text;
  }
  const result = { title, blocks };
  if (Object.keys(metadata).length > 0) result.metadata = metadata;
  return result;
}

export const parseNimasXml = parseDtbook;

export async function parseNimasZip(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const u8 = new Uint8Array(arrayBuffer);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (no EOCD)');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const xmlEntries = [];
  let opfEntry = null;
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
    if (name.endsWith('.opf')) opfEntry = name;
    else if (name.endsWith('.xml') && !name.includes('container.xml')) xmlEntries.push(name);
    off += 46 + nameLen + extraLen + commentLen;
  }
  let targetXml = xmlEntries[0];
  if (opfEntry) {
    try {
      const opfBytes = await unzipEntry(arrayBuffer, opfEntry);
      const opfDoc = parseXml(dec.decode(opfBytes));
      for (const it of opfDoc.getElementsByTagNameNS('*', 'item')) {
        const mediaType = (it.getAttribute('media-type') || '').toLowerCase();
        const href = it.getAttribute('href') || '';
        if (mediaType.includes('dtbook') || mediaType.includes('xml') || href.endsWith('.xml')) {
          const base = opfEntry.includes('/') ? opfEntry.slice(0, opfEntry.lastIndexOf('/') + 1) : '';
          targetXml = base + href;
          break;
        }
      }
    } catch { /* fallback to first xml entry */ }
  }
  if (!targetXml) throw new Error('nimas zip: no XML content document found');
  const xmlBytes = await unzipEntry(arrayBuffer, targetXml);
  return parseDtbook(dec.decode(xmlBytes));
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

