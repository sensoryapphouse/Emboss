// Emitters for the extreme-document test set (A89 step 4; see ../check-extreme-documents.mjs): the neutral IR built by
// ./content.mjs written out as NIMAS/DTBook XML, HTML, Markdown, plain text, DOCX, RTF, ODT and EPUB. Each emitter takes an
// iterable of IR blocks and returns a Buffer. They write what a real exporter would write, except that spans are printed raw
// (so the "span chaos" tables carry 0, -1, 99999 and 'abc' exactly as given) and text is NOT stripped of characters XML forbids
// (the Unicode cases want the reader to meet them). DOCX/ODT/EPUB are zipped with the repo's own web/zip.mjs makeZip.
import { makeZip } from '../../web/zip.mjs';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MML_NS = 'http://www.w3.org/1998/Math/MathML';
const zipBuf = async (files) => Buffer.from(await makeZip(files).arrayBuffer());
const attr = (name, v) => (v === undefined ? '' : ` ${name}="${esc(v)}"`);

// ---------------------------------------------------------------- NIMAS (DTBook 2005-3)
function nimasInline(parts) {
  let s = '';
  for (const p of parts) {
    if (typeof p === 'string') s += esc(p);
    else if (p.m) s += `<m:math>${p.m.mml}</m:math>`;
    else if (p.ref) s += `<noteref idref="#${p.ref}" id="r_${p.ref}">*</noteref>`;
  }
  return s;
}
function nimasList(l) {
  let s = `<list type="${l.ordered ? 'ol' : 'ul'}">`;
  for (const it of l.items) s += `<li>${nimasInline(it.parts)}${it.sub ? nimasList(it.sub) : ''}</li>`;
  return s + '</list>';
}
function nimasTable(t) {
  let s = '<table border="1"><tbody>';
  for (const row of t.rows) {
    s += '<tr>';
    for (const c of row) {
      s += `<${c.header ? 'th' : 'td'}${attr('colspan', c.colspan)}${attr('rowspan', c.rowspan)}>${esc(c.text ?? '')}${c.table ? nimasTable(c.table) : ''}</${c.header ? 'th' : 'td'}>`;
    }
    s += '</tr>';
  }
  return s + '</tbody></table>';
}
export function emitNimas(blocks, { title = 'Extreme test book' } = {}) {
  const out = [`<?xml version="1.0" encoding="UTF-8"?>\n<dtbook version="2005-3" xml:lang="en" xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="${MML_NS}">\n<head><meta name="dc:Title" content="${esc(title)}"/><meta name="dc:Identifier" content="extreme-test"/><meta name="dtb:uid" content="extreme-test"/></head>\n<book>\n<frontmatter><doctitle>${esc(title)}</doctitle><docauthor>Emboss extreme test</docauthor></frontmatter>\n<bodymatter>\n`];
  let depth = 0;
  const closeTo = (d) => { while (depth > d) { out.push(`</level${depth}>\n`); depth--; } };
  const openTo = (d) => { while (depth < d) { depth++; out.push(`<level${depth}>\n`); } };
  for (const b of blocks) {
    switch (b.t) {
      case 'h': closeTo(b.level - 1); openTo(b.level); out.push(`<h${b.level}>${esc(b.text)}</h${b.level}>\n`); break;
      case 'p': openTo(Math.max(depth, 1)); out.push(`<p>${nimasInline(b.parts)}</p>\n`); break;
      case 'list': openTo(Math.max(depth, 1)); out.push(nimasList(b) + '\n'); break;
      case 'table': openTo(Math.max(depth, 1)); out.push(nimasTable(b) + '\n'); break;
      case 'pagenum': openTo(Math.max(depth, 1)); out.push(`<pagenum id="p${b.n}" page="normal">${b.n}</pagenum>\n`); break;
      case 'note': openTo(Math.max(depth, 1)); out.push(`<note id="${b.id}"><p>${esc(b.text)}</p></note>\n`); break;
      case 'math': openTo(Math.max(depth, 1)); out.push(`<p><m:math display="block">${b.m.mml}</m:math></p>\n`); break;
    }
  }
  closeTo(0);
  out.push('</bodymatter>\n</book>\n</dtbook>\n');
  return Buffer.from(out.join(''), 'utf8');
}

// ---------------------------------------------------------------- HTML / XHTML
function htmlInline(parts, xhtml) {
  let s = '';
  for (const p of parts) {
    if (typeof p === 'string') s += esc(p);
    else if (p.m) s += `<math xmlns="${MML_NS}">${p.m.mml}</math>`;
    else if (p.ref) s += `<a href="#${p.ref}" id="r_${p.ref}" epub:type="noteref">*</a>`;
  }
  return s;
}
function htmlList(l) {
  const tag = l.ordered ? 'ol' : 'ul';
  let s = `<${tag}>`;
  for (const it of l.items) s += `<li>${htmlInline(it.parts)}${it.sub ? htmlList(it.sub) : ''}</li>`;
  return s + `</${tag}>`;
}
function htmlTable(t) {
  let s = '<table border="1"><tbody>';
  for (const row of t.rows) {
    s += '<tr>';
    for (const c of row) {
      const tag = c.header ? 'th' : 'td';
      s += `<${tag}${attr('colspan', c.colspan)}${attr('rowspan', c.rowspan)}>${esc(c.text ?? '')}${c.table ? htmlTable(c.table) : ''}</${tag}>`;
    }
    s += '</tr>';
  }
  return s + '</tbody></table>';
}
export function htmlBody(blocks) {
  const out = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'h': out.push(`<h${b.level}>${esc(b.text)}</h${b.level}>\n`); break;
      case 'p': out.push(`<p>${htmlInline(b.parts)}</p>\n`); break;
      case 'list': out.push(htmlList(b) + '\n'); break;
      case 'table': out.push(htmlTable(b) + '\n'); break;
      case 'pagenum': out.push(`<span id="pg${b.n}" epub:type="pagebreak" role="doc-pagebreak" title="${b.n}"></span>\n`); break;
      case 'note': out.push(`<aside id="${b.id}" epub:type="footnote"><p>${esc(b.text)}</p></aside>\n`); break;
      case 'math': out.push(`<p><math xmlns="${MML_NS}" display="block">${b.m.mml}</math></p>\n`); break;
    }
  }
  return out.join('');
}
export function emitHtml(blocks, { title = 'Extreme test book' } = {}) {
  return Buffer.from(`<!DOCTYPE html>\n<html lang="en" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>\n${htmlBody(blocks)}</body></html>\n`, 'utf8');
}

// ---------------------------------------------------------------- Markdown
function mdInline(parts) {
  let s = '';
  for (const p of parts) {
    if (typeof p === 'string') s += p.replace(/\n/g, ' ');
    else if (p.m) s += `$${p.m.latex}$`;
    else if (p.ref) s += `[^${p.ref}]`;
  }
  return s;
}
function mdList(l, depth, out) {
  l.items.forEach((it, i) => {
    out.push(`${'  '.repeat(depth)}${l.ordered ? `${i + 1}.` : '-'} ${mdInline(it.parts)}\n`);
    if (it.sub) mdList(it.sub, depth + 1, out);
  });
}
export function emitMarkdown(blocks) {
  const out = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'h': out.push(`${'#'.repeat(b.level)} ${b.text.replace(/\n/g, ' ')}\n\n`); break;
      case 'p': out.push(`${mdInline(b.parts)}\n\n`); break;
      case 'list': mdList(b, 0, out); out.push('\n'); break;
      case 'table': {
        const rows = b.rows.filter((r) => r.length);
        if (!rows.length) break;
        const cols = Math.max(...rows.map((r) => r.length));
        const line = (r) => `| ${Array.from({ length: cols }, (_, j) => String((r[j] && r[j].text) ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |\n`;
        out.push(line(rows[0]), `|${' --- |'.repeat(cols)}\n`);
        for (const r of rows.slice(1)) out.push(line(r));
        out.push('\n');
        break;
      }
      case 'note': out.push(`[^${b.id}]: ${b.text}\n\n`); break;
      case 'math': out.push(`$$\n${b.m.latex}\n$$\n\n`); break;
      default: break;                                  // page numbers have no Markdown form
    }
  }
  return Buffer.from(out.join(''), 'utf8');
}

// ---------------------------------------------------------------- plain text
function txtList(l, depth, out) {
  l.items.forEach((it, i) => {
    out.push(`${'  '.repeat(depth)}${l.ordered ? `${i + 1}.` : '-'} ${mdInline(it.parts)}\n`);
    if (it.sub) txtList(it.sub, depth + 1, out);
  });
}
export function emitText(blocks) {
  const out = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'h': out.push(`${b.text.replace(/\n/g, ' ')}\n\n`); break;
      case 'p': out.push(`${mdInline(b.parts).replace(/\[\^[^\]]*\]/g, '*')}\n\n`); break;
      case 'list': txtList(b, 0, out); out.push('\n'); break;
      case 'table': for (const r of b.rows) out.push(r.map((c) => String(c.text ?? '')).join('\t') + '\n'); out.push('\n'); break;
      case 'note': out.push(`Note: ${b.text}\n\n`); break;
      case 'math': out.push(`$${b.m.latex}$\n\n`); break;
      default: break;
    }
  }
  return Buffer.from(out.join(''), 'utf8');
}

// ---------------------------------------------------------------- DOCX
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const wRun = (t) => `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
export async function emitDocx(blocks, { title = 'Extreme test book' } = {}) {
  const body = [];
  const notes = new Map();                 // ref id -> numeric footnote id (assigned at the reference)
  const noteText = new Map();
  let maxDepth = 0;
  const inline = (parts) => {
    let s = '';
    for (const p of parts) {
      if (typeof p === 'string') s += wRun(p);
      else if (p.m) s += `<m:oMath>${p.m.omml}</m:oMath>`;
      else if (p.ref) { const n = notes.size + 1; notes.set(p.ref, n); s += `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${n}"/></w:r>`; }
    }
    return s;
  };
  const list = (l, d) => {
    maxDepth = Math.max(maxDepth, d);
    for (const it of l.items) {
      body.push(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${d}"/><w:numId w:val="${l.ordered ? 2 : 1}"/></w:numPr></w:pPr>${inline(it.parts)}</w:p>`);
      if (it.sub) list(it.sub, d + 1);
    }
  };
  const table = (t) => {
    const cols = Math.max(1, ...t.rows.map((r) => r.length));
    let s = `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${'<w:gridCol w:w="1000"/>'.repeat(cols)}</w:tblGrid>`;
    t.rows.forEach((row, ri) => {
      s += `<w:tr>${ri === 0 && row.some((c) => c.header) ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}`;
      for (const c of row) {
        s += `<w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/>${c.colspan !== undefined ? `<w:gridSpan w:val="${esc(c.colspan)}"/>` : ''}${c.rowspan !== undefined && Number(c.rowspan) > 1 ? '<w:vMerge w:val="restart"/>' : ''}</w:tcPr>${c.table ? table(c.table) : ''}<w:p>${wRun(c.text ?? '')}</w:p></w:tc>`;
      }
      s += '</w:tr>';
    });
    return s + '</w:tbl>';
  };
  for (const b of blocks) {
    switch (b.t) {
      case 'h': body.push(`<w:p><w:pPr><w:pStyle w:val="Heading${b.level}"/></w:pPr>${wRun(b.text)}</w:p>`); break;
      case 'p': body.push(`<w:p>${inline(b.parts)}</w:p>`); break;
      case 'list': list(b, 0); break;
      case 'table': body.push(table(b), '<w:p/>'); break;
      case 'note': noteText.set(b.id, b.text); break;
      case 'math': body.push(`<w:p><m:oMathPara><m:oMath>${b.m.omml}</m:oMath></m:oMathPara></w:p>`); break;
      default: break;
    }
  }
  const ns = `xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:m="${M_NS}"`;
  const lvls = (fmt, txt) => Array.from({ length: maxDepth + 1 }, (_, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${fmt === 'bullet' ? '\u2022' : `%${i + 1}.`}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
  const heads = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<w:style w:type="paragraph" w:styleId="Heading${i}"><w:name w:val="heading ${i}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="${i - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.max(24, 40 - i * 3)}"/></w:rPr></w:style>`).join('');
  const files = [
    { name: '[Content_Types].xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>` },
    { name: '_rels/.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/_rels/document.xml.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${R_NS}/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="${R_NS}/footnotes" Target="footnotes.xml"/></Relationships>` },
    { name: 'word/document.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${ns}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>` },
    { name: 'word/styles.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles ${ns}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${heads}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style></w:styles>` },
    { name: 'word/numbering.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering ${ns}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>${lvls('bullet')}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="multilevel"/>${lvls('decimal')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>` },
    { name: 'word/footnotes.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes ${ns}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${[...notes].map(([id, n]) => `<w:footnote w:id="${n}"><w:p><w:r><w:footnoteRef/></w:r>${wRun(' ' + (noteText.get(id) ?? ''))}</w:p></w:footnote>`).join('')}</w:footnotes>` },
    { name: 'docProps/core.xml', text: `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title></cp:coreProperties>` },
  ];
  return zipBuf(files);
}

// ---------------------------------------------------------------- RTF
function rtfText(s) {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x5c || c === 0x7b || c === 0x7d) o += '\\' + s[i];
    else if (c === 10) o += '\\line ';
    else if (c < 32) o += `\\'${c.toString(16).padStart(2, '0')}`;
    else if (c < 127) o += s[i];
    else o += `\\u${c > 32767 ? c - 65536 : c}?`;
  }
  return o;
}
export function emitRtf(blocks) {
  const out = ['{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Times New Roman;}}\\viewkind4\\uc1\n'];
  const inline = (parts) => parts.map((p) => (typeof p === 'string' ? rtfText(p) : p.m ? rtfText(p.m.text) : '*')).join('');
  const list = (l, d) => l.items.forEach((it, i) => { out.push(`\\pard\\li${360 * (d + 1)}\\fi-360 ${l.ordered ? `${i + 1}.` : '\\bullet'}\\tab ${inline(it.parts)}\\par\n`); if (it.sub) list(it.sub, d + 1); });
  for (const b of blocks) {
    switch (b.t) {
      case 'h': out.push(`\\pard\\s${b.level}\\outlinelevel${b.level - 1}\\b\\fs${Math.max(24, 44 - b.level * 4)} ${rtfText(b.text)}\\b0\\fs24\\par\n`); break;
      case 'p': out.push(`\\pard ${inline(b.parts)}\\par\n`); break;
      case 'list': list(b, 0); break;
      case 'table':
        for (const r of b.rows) {
          if (!r.length) continue;
          out.push('\\trowd\\trgaph108' + r.map((_, j) => `\\clbrdrt\\brdrs\\clbrdrl\\brdrs\\clbrdrb\\brdrs\\clbrdrr\\brdrs\\cellx${1500 * (j + 1)}`).join('') + '\n');
          out.push(r.map((c) => `\\pard\\intbl ${rtfText(String(c.text ?? ''))}\\cell`).join('') + '\\row\n');
        }
        out.push('\\pard\\par\n');
        break;
      case 'note': out.push(`\\pard Note: ${rtfText(b.text)}\\par\n`); break;
      case 'math': out.push(`\\pard ${rtfText(b.m.text)}\\par\n`); break;
      default: break;
    }
  }
  out.push('}');
  return Buffer.from(out.join(''), 'latin1');
}

// ---------------------------------------------------------------- ODT
const ODT_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';
export async function emitOdt(blocks) {
  const out = [];
  const inline = (parts) => parts.map((p) => (typeof p === 'string' ? esc(p) : p.m ? esc(p.m.text) : '*')).join('');
  const list = (l) => `<text:list>${l.items.map((it) => `<text:list-item><text:p>${l.ordered ? '' : ''}${inline(it.parts)}</text:p>${it.sub ? list(it.sub) : ''}</text:list-item>`).join('')}</text:list>`;
  let tn = 0;
  const table = (t) => {
    const cols = Math.max(1, ...t.rows.map((r) => r.length));
    let s = `<table:table table:name="T${++tn}"><table:table-column table:number-columns-repeated="${cols}"/>`;
    for (const row of t.rows) {
      s += '<table:table-row>';
      for (const c of row) s += `<table:table-cell office:value-type="string"${attr('table:number-columns-spanned', c.colspan)}${attr('table:number-rows-spanned', c.rowspan)}>${c.table ? table(c.table) : ''}<text:p>${esc(c.text ?? '')}</text:p></table:table-cell>`;
      s += '</table:table-row>';
    }
    return s + '</table:table>';
  };
  for (const b of blocks) {
    switch (b.t) {
      case 'h': out.push(`<text:h text:outline-level="${b.level}">${esc(b.text)}</text:h>`); break;
      case 'p': out.push(`<text:p>${inline(b.parts)}</text:p>`); break;
      case 'list': out.push(list(b)); break;
      case 'table': out.push(table(b)); break;
      case 'note': out.push(`<text:p>Note: ${esc(b.text)}</text:p>`); break;
      case 'math': out.push(`<text:p>${esc(b.m.text)}</text:p>`); break;
      default: break;
    }
  }
  const files = [
    { name: 'mimetype', text: 'application/vnd.oasis.opendocument.text' },
    { name: 'META-INF/manifest.xml', text: `<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>` },
    { name: 'styles.xml', text: `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ${ODT_NS} office:version="1.2"><office:styles/></office:document-styles>` },
    { name: 'content.xml', text: `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ${ODT_NS} office:version="1.2"><office:body><office:text>${out.join('')}</office:text></office:body></office:document-content>` },
  ];
  return zipBuf(files);
}

// ---------------------------------------------------------------- EPUB
export async function emitEpub(blocks, { title = 'Extreme test book' } = {}) {
  const chapters = [];
  let cur = null;
  for (const b of blocks) {
    if (!cur || (b.t === 'h' && b.level === 1 && cur.length)) { cur = []; chapters.push(cur); }
    cur.push(b);
  }
  if (!chapters.length) chapters.push([]);
  const xhtml = (inner, t) => `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><meta charset="utf-8"/><title>${esc(t)}</title></head><body>\n${inner}</body></html>\n`;
  const files = [
    { name: 'mimetype', text: 'application/epub+zip' },
    { name: 'META-INF/container.xml', text: `<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
  ];
  const ids = chapters.map((_, i) => `c${i + 1}`);
  files.push({ name: 'OEBPS/content.opf', text: `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">extreme-epub</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>en</dc:language></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${ids.map((id, i) => `<item id="${id}" href="chap-${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${ids.map((id) => `<itemref idref="${id}"/>`).join('')}</spine></package>` });
  files.push({ name: 'OEBPS/nav.xhtml', text: xhtml(`<nav epub:type="toc"><ol>${ids.map((_, i) => `<li><a href="chap-${i + 1}.xhtml">Chapter ${i + 1}</a></li>`).join('')}</ol></nav>`, 'Contents') });
  chapters.forEach((ch, i) => files.push({ name: `OEBPS/chap-${i + 1}.xhtml`, text: xhtml(htmlBody(ch), `Chapter ${i + 1}`) }));
  return zipBuf(files);
}

// name of the emitter for each file extension
export const EMITTERS = {
  xml: emitNimas, html: emitHtml, md: emitMarkdown, txt: emitText, docx: emitDocx, rtf: emitRtf, odt: emitOdt, epub: emitEpub,
};
