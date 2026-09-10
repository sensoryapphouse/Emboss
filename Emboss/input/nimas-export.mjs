// DTBook / NIMAS XML Serializer for Emboss.
// Provides pure, deterministic serialization from the internal Document Model AST
// ({ title, blocks, metadata }) into standard ANSI/NISO Z39.86-2005 (DTBook 2005-3) XML.

const TF_ITALIC = 1;
const TF_UNDERLINE = 2;
const TF_BOLD = 4;

/**
 * Escapes characters with special meaning in XML.
 * @param {string} str
 * @returns {string}
 */
export function escapeXml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Serializes an array of inline segments into XML markup.
 * @param {Array<object>} segments
 * @param {string} fallbackText
 * @returns {string}
 */
export function serializeInlineSegments(segments, fallbackText = '') {
  if (!segments || !Array.isArray(segments) || segments.length === 0) {
    return escapeXml(fallbackText);
  }

  let out = '';
  for (const seg of segments) {
    if (!seg) continue;
    if (seg.type === 'math') {
      if (seg.mathml) {
        out += seg.mathml;
      } else if (seg.latex) {
        out += `<m:math alttext="${escapeXml(seg.latex)}"><m:semantics><m:annotation encoding="application/x-tex">${escapeXml(seg.latex)}</m:annotation></m:semantics></m:math>`;
      }
      continue;
    }

    let text = escapeXml(seg.text ?? '');
    if (seg.uncontracted) {
      text = `<code class="uncontracted">${text}</code>`;
    }
    const tf = seg.tf || 0;
    if (tf & TF_BOLD) {
      text = `<strong>${text}</strong>`;
    }
    if (tf & TF_ITALIC) {
      text = `<em>${text}</em>`;
    }
    if (tf & TF_UNDERLINE) {
      text = `<u>${text}</u>`;
    }
    out += text;
  }
  return out;
}

/**
 * Serializes an individual AST block into DTBook XML element(s).
 * @param {object} block
 * @param {number} indentLevel
 * @returns {string}
 */
export function serializeBlock(block, indentLevel = 4) {
  if (!block || !block.type) return '';
  const indent = ' '.repeat(indentLevel);

  switch (block.type) {
    case 'heading':
    case 'title': {
      const lvl = Math.max(1, Math.min(6, block.level || 1));
      const content = serializeInlineSegments(block.segments, block.text);
      return `${indent}<h${lvl}>${content}</h${lvl}>`;
    }

    case 'para': {
      if (block.style === 'dialogue' || block.style === 'play') {
        const lvlAttr = block.level ? ` level="${block.level}"` : '';
        const content = serializeInlineSegments(block.segments, block.text);
        return `${indent}<p class="bai-play"${lvlAttr}>${content}</p>`;
      }
      if (block.style === 'verse' || block.style === 'poem') {
        const lvlAttr = block.level ? ` level="${block.level}"` : '';
        const content = serializeInlineSegments(block.segments, block.text);
        return `${indent}<p class="bai-verse"${lvlAttr}>${content}</p>`;
      }
      if (block.style === 'stage') {
        const lvlAttr = block.level ? ` level="${block.level}"` : '';
        const content = serializeInlineSegments(block.segments, block.text);
        return `${indent}<p class="bai-stage"${lvlAttr}>${content}</p>`;
      }
      if (block.style === 'caption') {
        return `${indent}<caption>${escapeXml(block.text || '')}</caption>`;
      }
      if (block.style === 'attribution') {
        return `${indent}<byline>${escapeXml(block.text || '')}</byline>`;
      }
      if (block.style === 'footnote') {
        return `${indent}<note class="footnote">${escapeXml(block.text || '')}</note>`;
      }
      if (block.style === 'note') {
        return `${indent}<prodnote>${escapeXml(block.text || '')}</prodnote>`;
      }
      const content = serializeInlineSegments(block.segments, block.text);
      return `${indent}<p>${content}</p>`;
    }

    case 'list': {
      const kind = block.kind || '';
      let listTagOpen = '<list>';
      if (kind === 'toc') {
        listTagOpen = '<list type="pl" class="toc">';
      } else if (kind === 'exercise') {
        listTagOpen = '<list type="ol" class="bai-exercise">';
      } else if (kind === 'index') {
        listTagOpen = '<list type="pl" class="bai-index">';
      } else if (kind === 'plain') {
        listTagOpen = '<list type="pl">';
      } else {
        const isOl = block.ordered || block.style === 'ordered' || (block.items || []).some((it) => it.marker && /^\d+/.test(it.marker));
        listTagOpen = isOl ? '<list type="ol">' : '<list type="ul">';
      }

      const itemsXml = [];
      const itemIndent = ' '.repeat(indentLevel + 2);
      for (const item of block.items || []) {
        const lvlAttr = item.level ? ` level="${item.level}"` : '';
        if (kind === 'toc') {
          const textContent = serializeInlineSegments(item.segments, item.text);
          if (item.page) {
            itemsXml.push(`${itemIndent}<li class="bai-toc-entry"${lvlAttr}><lic class="bai-toc-text">${textContent}</lic><lic class="bai-toc-page">${escapeXml(item.page)}</lic></li>`);
          } else {
            itemsXml.push(`${itemIndent}<li class="bai-toc-entry"${lvlAttr}>${textContent}</li>`);
          }
        } else if (kind === 'exercise') {
          const textContent = serializeInlineSegments(item.segments, item.text);
          itemsXml.push(`${itemIndent}<li class="bai-exercise"${lvlAttr}>${textContent}</li>`);
        } else if (kind === 'index') {
          const textContent = serializeInlineSegments(item.segments, item.text);
          itemsXml.push(`${itemIndent}<li class="bai-index"${lvlAttr}>${textContent}</li>`);
        } else {
          const textContent = serializeInlineSegments(item.segments, item.text);
          itemsXml.push(`${itemIndent}<li${lvlAttr}>${textContent}</li>`);
        }
      }

      return `${indent}${listTagOpen}\n${itemsXml.join('\n')}\n${indent}</list>`;
    }

    case 'box': {
      const lines = [`${indent}<sidebar>`];
      let titleBlockHandled = false;

      // When the first child block is a heading, serialize its full formatted content into <hd>
      if (block.blocks && Array.isArray(block.blocks) && block.blocks.length > 0 && block.blocks[0]?.type === 'heading') {
        const firstHead = block.blocks[0];
        const content = serializeInlineSegments(firstHead.segments, firstHead.text || block.title);
        lines.push(`${' '.repeat(indentLevel + 2)}<hd>${content}</hd>`);
        titleBlockHandled = true;
      } else if (block.title) {
        lines.push(`${' '.repeat(indentLevel + 2)}<hd>${escapeXml(block.title)}</hd>`);
      }

      if (block.blocks && Array.isArray(block.blocks)) {
        for (let idx = 0; idx < block.blocks.length; idx++) {
          if (idx === 0 && titleBlockHandled) continue;
          const child = block.blocks[idx];
          const childXml = serializeBlock(child, indentLevel + 2);
          if (childXml) lines.push(childXml);
        }
      }
      lines.push(`${indent}</sidebar>`);
      return lines.join('\n');
    }

    case 'table': {
      const isListed = block.format === 'listed' || block.style === 'table-listed';
      const isSpatial = block.format === 'spatial' || block.format === 'columnar' || block.style === 'table-spatial';
      const cls = isListed ? ' class="bana-listed"' : (isSpatial ? ' class="bana-spatial"' : '');
      const lines = [`${indent}<table${cls}>`];
      const subIndent = ' '.repeat(indentLevel + 2);
      const rowIndent = ' '.repeat(indentLevel + 4);

      if (block.caption || block.title) {
        lines.push(`${subIndent}<caption>${escapeXml(block.caption || block.title)}</caption>`);
      }
      if (block.tabletn) {
        lines.push(`${subIndent}<tabletn>${escapeXml(block.tabletn)}</tabletn>`);
      }

      if (block.headers && Array.isArray(block.headers) && block.headers.length) {
        lines.push(`${subIndent}<thead>`);
        lines.push(`${rowIndent}<tr>`);
        for (const h of block.headers) {
          lines.push(`${rowIndent}  <th>${escapeXml(h)}</th>`);
        }
        lines.push(`${rowIndent}</tr>`);
        lines.push(`${subIndent}</thead>`);
      }

      if (block.rows && Array.isArray(block.rows) && block.rows.length) {
        lines.push(`${subIndent}<tbody>`);
        for (const row of block.rows) {
          lines.push(`${rowIndent}<tr>`);
          for (const cell of row) {
            lines.push(`${rowIndent}  <td>${escapeXml(cell)}</td>`);
          }
          lines.push(`${rowIndent}</tr>`);
        }
        lines.push(`${subIndent}</tbody>`);
      }

      lines.push(`${indent}</table>`);
      return lines.join('\n');
    }

    case 'note': {
      if (block.kind === 'tabletn') {
        return `${indent}<prodnote class="tabletn">${escapeXml(block.text)}</prodnote>`;
      }
      if (block.kind === 'image') {
        return `${indent}<prodnote render="optional">${escapeXml(block.text)}</prodnote>`;
      }
      return `${indent}<prodnote>${escapeXml(block.text)}</prodnote>`;
    }

    case 'footnote': {
      return `${indent}<note class="footnote">${escapeXml(block.text)}</note>`;
    }

    case 'caption': {
      return `${indent}<caption>${escapeXml(block.text)}</caption>`;
    }

    case 'attribution': {
      return `${indent}<byline>${escapeXml(block.text)}</byline>`;
    }

    case 'play': {
      const cls = block.subtype === 'verse' ? 'bai-verse' : 'bai-play';
      const lvlAttr = block.level ? ` level="${block.level}"` : '';
      const content = serializeInlineSegments(block.segments, block.text);
      return `${indent}<p class="${cls}"${lvlAttr}>${content}</p>`;
    }

    case 'stage': {
      const lvlAttr = block.level ? ` level="${block.level}"` : '';
      const content = serializeInlineSegments(block.segments, block.text);
      return `${indent}<p class="bai-stage"${lvlAttr}>${content}</p>`;
    }

    case 'graphic': {
      return `${indent}<img src="${escapeXml(block.src || '')}" alt="${escapeXml(block.alt || '')}"/>`;
    }

    case 'pagenum': {
      const pageVal = block.page || block.text || '1';
      const cleanId = String(pageVal).replace(/\s+/g, '_');
      return `${indent}<pagenum id="p_${escapeXml(cleanId)}" page="normal">${escapeXml(pageVal)}</pagenum>`;
    }

    case 'math': {
      if (block.mathml) {
        return `${indent}${block.mathml}`;
      }
      if (block.latex) {
        return `${indent}<m:math alttext="${escapeXml(block.latex)}"><m:semantics><m:annotation encoding="application/x-tex">${escapeXml(block.latex)}</m:annotation></m:semantics></m:math>`;
      }
      return '';
    }

    case 'break': {
      return `${indent}<hr/>`;
    }

    default: {
      if (block.text) {
        return `${indent}<p>${escapeXml(block.text)}</p>`;
      }
      return '';
    }
  }
}

/**
 * Serializes a full Document Model AST into complete, valid DTBook/NIMAS XML.
 * @param {object|Array<object>} docModel
 * @param {object} options
 * @returns {string} XML string
 */
export function exportToNimasXml(docModel, options = {}) {
  const blocks = Array.isArray(docModel) ? docModel : (docModel?.blocks || []);
  const title = (typeof docModel === 'object' && !Array.isArray(docModel) ? docModel.title : null) || 'Emboss Document';
  const lang = options.lang || docModel?.metadata?.lang || 'en-US';
  const uid = options.uid || docModel?.metadata?.uid || `emboss-${Date.now()}`;
  const date = options.date || new Date().toISOString().slice(0, 10);

  const blockXmlStrings = [];
  for (const block of blocks) {
    const xml = serializeBlock(block, 8);
    if (xml) blockXmlStrings.push(xml);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd">
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML" version="2005-3" xml:lang="${escapeXml(lang)}">
  <head>
    <meta name="dtb:uid" content="${escapeXml(uid)}" />
    <meta name="dc:Title" content="${escapeXml(title)}" />
    <meta name="dc:Publisher" content="Emboss Braille Editor" />
    <meta name="dc:Date" content="${escapeXml(date)}" />
    <meta name="dc:Format" content="ANSI/NISO Z39.86-2005" />
  </head>
  <book>
    <frontmatter>
      <doctitle>${escapeXml(title)}</doctitle>
    </frontmatter>
    <bodymatter>
      <level1>
${blockXmlStrings.join('\n')}
      </level1>
    </bodymatter>
  </book>
</dtbook>
`;
}
