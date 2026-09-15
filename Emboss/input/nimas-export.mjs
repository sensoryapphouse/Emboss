// DTBook / NIMAS XML Serializer for Emboss.
// Provides pure, deterministic serialization from the internal Document Model AST
// ({ title, blocks, metadata }) into standard ANSI/NISO Z39.86-2005 (DTBook 2005-3) XML.

const TF_ITALIC = 1;
const TF_UNDERLINE = 2;
const TF_BOLD = 4;

/**
 * Deterministic ID allocator to guarantee uniqueness of XML ID attributes.
 */
export class IdAllocator {
  constructor() {
    this.usedIds = new Set();
  }
  getId(preferred, prefix = 'id') {
    if (preferred && !this.usedIds.has(preferred)) {
      this.usedIds.add(preferred);
      return preferred;
    }
    let base = preferred || prefix;
    let counter = 1;
    let candidate = preferred ? `${base}-${counter}` : `${base}-${counter}`;
    if (!preferred && !this.usedIds.has(base)) {
      this.usedIds.add(base);
      return base;
    }
    while (this.usedIds.has(candidate)) {
      counter++;
      candidate = `${base}-${counter}`;
    }
    this.usedIds.add(candidate);
    return candidate;
  }
}

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
        let m = seg.mathml;
        if (!m.includes('altimg=')) {
          m = m.replace(/<m:math|<math|<mml:math/, '$& altimg="math.png"');
        }
        if (!m.includes('alttext=')) {
          const alt = escapeXml(seg.latex || seg.text || 'math expression');
          m = m.replace(/<m:math|<math|<mml:math/, `$& alttext="${alt}"`);
        }
        if (/<([a-zA-Z0-9_:]*semantics[^>]*)>\s*<([a-zA-Z0-9_:]*annotation)/.test(m)) {
          m = m.replace(/<([a-zA-Z0-9_:]*semantics[^>]*)>\s*<([a-zA-Z0-9_:]*annotation)([^>]*)>([\s\S]*?)<\/\2>/g, (match, semTag, annTagName, annAttrs, innerText) => {
            const prefix = annTagName.includes(':') ? annTagName.split(':')[0] + ':' : '';
            return `<${semTag}><${prefix}mrow><${prefix}mtext>${innerText}</${prefix}mtext></${prefix}mrow><${annTagName}${annAttrs}>${innerText}</${annTagName}>`;
          });
        }
        out += m;
      } else if (seg.latex) {
        out += `<m:math alttext="${escapeXml(seg.latex)}" altimg="math.png"><m:semantics><m:mrow><m:mtext>${escapeXml(seg.latex)}</m:mtext></m:mrow><m:annotation encoding="application/x-tex">${escapeXml(seg.latex)}</m:annotation></m:semantics></m:math>`;
      }
      continue;
    }

    let text = escapeXml(seg.text ?? '');
    if (text.includes('\n')) {
      text = text.split('\n').join('<br/>');
    }
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
      text = `<span class="underline">${text}</span>`;
    }
    out += text;
  }
  return out;
}

/**
 * Serializes an individual AST block into DTBook XML element(s).
 * @param {object} block
 * @param {number} indentLevel
 * @param {IdAllocator|null} idAlloc
 * @returns {string}
 */
export function serializeBlock(block, indentLevel = 4, idAlloc = null) {
  if (!block || !block.type) return '';
  const indent = ' '.repeat(indentLevel);
  const lvlClass = block.level ? ` level-${block.level}` : '';

  switch (block.type) {
    case 'heading':
    case 'title': {
      const lvl = Math.max(1, Math.min(6, block.level || 1));
      const content = serializeInlineSegments(block.segments, block.text);
      return `${indent}<h${lvl}>${content}</h${lvl}>`;
    }

    case 'para': {
      if (block.style === 'quote' || block.style === 'blockquote') {
        const content = serializeInlineSegments(block.segments, block.text);
        const clsAttr = lvlClass ? ` class="quote${lvlClass}"` : ' class="quote"';
        return `${indent}<blockquote class="quote"><p${clsAttr}>${content}</p></blockquote>`;
      }
      if (block.style === 'attribution') {
        const content = serializeInlineSegments(block.segments, block.text);
        return `${indent}<byline>${content}</byline>`;
      }
      if (block.style === 'dialogue' || block.style === 'play' || block.style === 'play-speaker') {
        const content = serializeInlineSegments(block.segments, block.text);
        return `${indent}<p class="bai-play${lvlClass}">${content}</p>`;
      }
      if (block.style === 'verse' || block.style === 'poem' || block.style === 'play-verse') {
        const content = serializeInlineSegments(block.segments, block.text);
        return `${indent}<p class="bai-verse${lvlClass}">${content}</p>`;
      }
      if (block.style === 'stage' || block.style === 'play-stage') {
        const content = serializeInlineSegments(block.segments, block.text);
        return `${indent}<p class="bai-stage${lvlClass}">${content}</p>`;
      }
      if (block.style === 'caption') {
        const content = serializeInlineSegments(block.segments, block.text);
        return `${indent}<caption>${content}</caption>`;
      }
      if (block.style === 'footnote') {
        const content = serializeInlineSegments(block.segments, block.text);
        const noteId = idAlloc ? idAlloc.getId(block.id, 'note') : (block.id || 'note-1');
        return `${indent}<note id="${escapeXml(noteId)}" class="footnote"><p>${content}</p></note>`;
      }
      if (block.style === 'note') {
        const content = serializeInlineSegments(block.segments, block.text);
        const renderAttr = block.render ? ` render="${escapeXml(block.render)}"` : ' render="optional"';
        return `${indent}<prodnote${renderAttr}>${content}</prodnote>`;
      }
      const content = serializeInlineSegments(block.segments, block.text);
      if (lvlClass) {
        return `${indent}<p class="${lvlClass.trim()}">${content}</p>`;
      }
      return `${indent}<p>${content}</p>`;
    }

    case 'list': {
      const kind = block.kind || block.style || '';
      if (kind === 'glossary') {
        const lines = [`${indent}<dl>`];
        const itemIndent = ' '.repeat(indentLevel + 2);
        for (const item of block.items || []) {
          let termContent = '';
          let defContent = '';
          if (item.term != null && item.def != null && (item.term || item.def)) {
            termContent = item.termSegments ? serializeInlineSegments(item.termSegments, item.term) : escapeXml(item.term);
            defContent = item.defSegments ? serializeInlineSegments(item.defSegments, item.def) : escapeXml(item.def);
          } else if (item.text) {
            const sepIdx = item.text.indexOf(' — ');
            if (sepIdx !== -1) {
              termContent = escapeXml(item.text.slice(0, sepIdx));
              defContent = escapeXml(item.text.slice(sepIdx + 3));
            } else {
              termContent = serializeInlineSegments(item.segments, item.text);
            }
          }
          lines.push(`${itemIndent}<dt>${termContent}</dt>`);
          if (defContent) {
            lines.push(`${itemIndent}<dd>${defContent}</dd>`);
          }
        }
        lines.push(`${indent}</dl>`);
        return lines.join('\n');
      }

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
        const itemLvlClass = item.level ? ` level-${item.level}` : '';
        if (kind === 'toc') {
          const textContent = serializeInlineSegments(item.segments, item.text);
          if (item.page) {
            itemsXml.push(`${itemIndent}<li class="bai-toc-entry${itemLvlClass}"><lic class="bai-toc-text">${textContent}</lic><lic class="bai-toc-page">${escapeXml(item.page)}</lic></li>`);
          } else {
            itemsXml.push(`${itemIndent}<li class="bai-toc-entry${itemLvlClass}">${textContent}</li>`);
          }
        } else if (kind === 'exercise') {
          const textContent = serializeInlineSegments(item.segments, item.text);
          itemsXml.push(`${itemIndent}<li class="bai-exercise${itemLvlClass}">${textContent}</li>`);
        } else if (kind === 'index') {
          const textContent = serializeInlineSegments(item.segments, item.text);
          itemsXml.push(`${itemIndent}<li class="bai-index${itemLvlClass}">${textContent}</li>`);
        } else {
          const textContent = serializeInlineSegments(item.segments, item.text);
          if (itemLvlClass) {
            itemsXml.push(`${itemIndent}<li class="${itemLvlClass.trim()}">${textContent}</li>`);
          } else {
            itemsXml.push(`${itemIndent}<li>${textContent}</li>`);
          }
        }
      }

      return `${indent}${listTagOpen}\n${itemsXml.join('\n')}\n${indent}</list>`;
    }

    case 'box':
    case 'sidebar': {
      const sideId = block.id ? (idAlloc ? idAlloc.getId(block.id, 'sidebar') : block.id) : null;
      const idAttr = sideId ? ` id="${escapeXml(sideId)}"` : '';
      const renderAttr = block.render ? ` render="${escapeXml(block.render)}"` : '';
      const lines = [`${indent}<sidebar${idAttr}${renderAttr}>`];
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
          if (child.type === 'caption' && idx + 1 < block.blocks.length && block.blocks[idx + 1]?.type === 'table') {
            if (!block.blocks[idx + 1].caption && !block.blocks[idx + 1].title) {
              block.blocks[idx + 1].caption = child.text;
            }
            continue;
          }
          if (child.type === 'heading' || child.type === 'title') {
            const content = serializeInlineSegments(child.segments, child.text);
            lines.push(`${' '.repeat(indentLevel + 2)}<hd>${content}</hd>`);
            continue;
          }
          const childXml = serializeBlock(child, indentLevel + 2, idAlloc);
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
      const lines = [];
      const subIndent = ' '.repeat(indentLevel + 2);
      const rowIndent = ' '.repeat(indentLevel + 4);

      if (block.tabletn) {
        lines.push(`${indent}<prodnote render="optional" class="tabletn">${escapeXml(block.tabletn)}</prodnote>`);
      }

      lines.push(`${indent}<table${cls}>`);

      if (block.caption || block.title) {
        lines.push(`${subIndent}<caption>${escapeXml(block.caption || block.title)}</caption>`);
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
      } else if (block.headers && Array.isArray(block.headers) && block.headers.length) {
        // DTBook table content model requires tbody or tr rows following thead
        lines.push(`${subIndent}<tbody>`);
        lines.push(`${rowIndent}<tr>`);
        for (const h of block.headers) {
          lines.push(`${rowIndent}  <td></td>`);
        }
        lines.push(`${rowIndent}</tr>`);
        lines.push(`${subIndent}</tbody>`);
      }

      lines.push(`${indent}</table>`);
      return lines.join('\n');
    }

    case 'quote': {
      const content = serializeInlineSegments(block.segments, block.text);
      const clsAttr = lvlClass ? ` class="quote${lvlClass}"` : ' class="quote"';
      return `${indent}<blockquote class="quote"><p${clsAttr}>${content}</p></blockquote>`;
    }

    case 'glossary': {
      const lines = [`${indent}<dl>`];
      const itemIndent = ' '.repeat(indentLevel + 2);
      for (const item of block.items || []) {
        let termContent = '';
        let defContent = '';
        if (item.term != null && item.def != null && (item.term || item.def)) {
          termContent = item.termSegments ? serializeInlineSegments(item.termSegments, item.term) : escapeXml(item.term);
          defContent = item.defSegments ? serializeInlineSegments(item.defSegments, item.def) : escapeXml(item.def);
        } else if (item.text) {
          const sepIdx = item.text.indexOf(' — ');
          if (sepIdx !== -1) {
            termContent = escapeXml(item.text.slice(0, sepIdx));
            defContent = escapeXml(item.text.slice(sepIdx + 3));
          } else {
            termContent = serializeInlineSegments(item.segments, item.text);
          }
        }
        lines.push(`${itemIndent}<dt>${termContent}</dt>`);
        if (defContent) {
          lines.push(`${itemIndent}<dd>${defContent}</dd>`);
        }
      }
      lines.push(`${indent}</dl>`);
      return lines.join('\n');
    }

    case 'note': {
      const content = serializeInlineSegments(block.segments, block.text);
      const renderAttr = block.render ? ` render="${escapeXml(block.render)}"` : ' render="optional"';
      if (block.kind === 'tabletn') {
        return `${indent}<prodnote class="tabletn"${renderAttr}>${content}</prodnote>`;
      }
      return `${indent}<prodnote${renderAttr}>${content}</prodnote>`;
    }

    case 'footnote': {
      const content = serializeInlineSegments(block.segments, block.text);
      const noteId = idAlloc ? idAlloc.getId(block.id, 'note') : (block.id || 'note-1');
      return `${indent}<note id="${escapeXml(noteId)}" class="footnote"><p>${content}</p></note>`;
    }

    case 'caption': {
      const content = serializeInlineSegments(block.segments, block.text);
      return `${indent}<caption>${content}</caption>`;
    }

    case 'attribution': {
      const content = serializeInlineSegments(block.segments, block.text);
      return `${indent}<byline>${content}</byline>`;
    }

    case 'verse':
    case 'poem':
    case 'play': {
      const cls = (block.subtype === 'verse' || block.style === 'verse' || block.style === 'poem' || block.style === 'play-verse' || block.type === 'verse' || block.type === 'poem') ? 'bai-verse' : 'bai-play';
      const content = serializeInlineSegments(block.segments, block.text);
      return `${indent}<p class="${cls}${lvlClass}">${content}</p>`;
    }

    case 'stage': {
      const content = serializeInlineSegments(block.segments, block.text);
      return `${indent}<p class="bai-stage${lvlClass}">${content}</p>`;
    }

    case 'graphic': {
      return `${indent}<img src="${escapeXml(block.src || '')}" alt="${escapeXml(block.alt || '')}"/>`;
    }

    case 'pagenum': {
      const pageVal = block.page || block.text || '1';
      const cleanPage = String(pageVal).trim().replace(/[^a-zA-Z0-9_-]/g, '') || '1';
      const pageId = idAlloc ? idAlloc.getId(block.id, `p-${cleanPage}`) : (block.id || `p-${cleanPage}`);
      const trimmedVal = String(pageVal).trim();
      let pageType = 'normal';
      if (/^\d+$/.test(trimmedVal)) {
        pageType = 'normal';
      } else if (/^[ivxlcdm]+$/i.test(trimmedVal)) {
        pageType = 'front';
      } else {
        pageType = 'special';
      }
      return `${indent}<pagenum id="${escapeXml(pageId)}" page="${pageType}">${escapeXml(pageVal)}</pagenum>`;
    }

    case 'math': {
      if (block.mathml) {
        let m = block.mathml;
        if (!m.includes('altimg=')) {
          m = m.replace(/<m:math|<math|<mml:math/, '$& altimg="math.png"');
        }
        if (!m.includes('alttext=')) {
          const alt = escapeXml(block.latex || block.text || 'math expression');
          m = m.replace(/<m:math|<math|<mml:math/, `$& alttext="${alt}"`);
        }
        if (/<([a-zA-Z0-9_:]*semantics[^>]*)>\s*<([a-zA-Z0-9_:]*annotation)/.test(m)) {
          m = m.replace(/<([a-zA-Z0-9_:]*semantics[^>]*)>\s*<([a-zA-Z0-9_:]*annotation)([^>]*)>([\s\S]*?)<\/\2>/g, (match, semTag, annTagName, annAttrs, innerText) => {
            const prefix = annTagName.includes(':') ? annTagName.split(':')[0] + ':' : '';
            return `<${semTag}><${prefix}mrow><${prefix}mtext>${innerText}</${prefix}mtext></${prefix}mrow><${annTagName}${annAttrs}>${innerText}</${annTagName}>`;
          });
        }
        return `${indent}${m}`;
      }
      if (block.latex) {
        return `${indent}<m:math alttext="${escapeXml(block.latex)}" altimg="math.png"><m:semantics><m:mrow><m:mtext>${escapeXml(block.latex)}</m:mtext></m:mrow><m:annotation encoding="application/x-tex">${escapeXml(block.latex)}</m:annotation></m:semantics></m:math>`;
      }
      return '';
    }

    case 'indicator':
    case 'break': {
      if (block.kind === 'line' || block.kind === 'stanza') {
        return `${indent}<p class="bai-stanza-break"></p>`;
      }
      if (block.kind === 'asterisks') {
        return `${indent}<p class="bana-break-asterisks">***</p>`;
      }
      if (block.kind === 'dot2s') {
        return `${indent}<p class="bana-break-dot2s">&#x2802;&#x2802;&#x2802;</p>`;
      }
      return `${indent}<p class="bai-break"></p>`;
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
 * Builds hierarchical DTBook level1-level6 tree elements from flat AST blocks.
 * @param {Array<object>} blocks
 * @param {number} indentBase
 * @param {string} fallbackTitle
 * @param {IdAllocator|null} idAlloc
 * @returns {string} XML string
 */
export function buildDtbookHierarchy(blocks, indentBase = 6, fallbackTitle = 'Emboss Document', idAlloc = null) {
  if (!blocks || !Array.isArray(blocks) || blocks.length === 0) {
    const ind = ' '.repeat(indentBase);
    const pInd = ' '.repeat(indentBase + 2);
    return `${ind}<level1>\n${pInd}<p>${escapeXml(fallbackTitle)}</p>\n${ind}</level1>`;
  }

  const stack = []; // active level depths: [1, 2, ...]
  const levelHasChildren = []; // tracks if a level has child blocks or sublevels
  const lines = [];

  function openLevel(targetLvl, headingBlock = null) {
    // If targetLvl <= top of stack, close down to targetLvl - 1
    while (stack.length > 0 && stack[stack.length - 1] >= targetLvl) {
      const closedLvl = stack.pop();
      const hasChild = levelHasChildren.pop();
      if (!hasChild) {
        // DTBook DTD requires (%docblockorinline; | levelN+1)+ for every level container.
        lines.push(`${' '.repeat(closedLvl * 2 + indentBase)}<p></p>`);
      }
      const indent = ' '.repeat(closedLvl * 2 + indentBase - 2);
      lines.push(`${indent}</level${closedLvl}>`);
    }

    if (levelHasChildren.length > 0) {
      levelHasChildren[levelHasChildren.length - 1] = true;
    }

    // Open any missing ancestor levels
    const startFrom = stack.length > 0 ? stack[stack.length - 1] + 1 : 1;
    for (let l = startFrom; l <= targetLvl; l++) {
      stack.push(l);
      levelHasChildren.push(false);
      const indent = ' '.repeat(l * 2 + indentBase - 2);
      lines.push(`${indent}<level${l}>`);
      if (l === targetLvl && headingBlock) {
        const hIndent = ' '.repeat(l * 2 + indentBase);
        const content = serializeInlineSegments(headingBlock.segments, headingBlock.text);
        lines.push(`${hIndent}<h${l}>${content}</h${l}>`);
      }
    }
  }

  function ensureLevel1() {
    if (stack.length === 0) {
      openLevel(1, null);
    }
  }

  for (let idx = 0; idx < blocks.length; idx++) {
    const block = blocks[idx];
    if (!block) continue;
    if (block.type === 'caption' && idx + 1 < blocks.length && blocks[idx + 1]?.type === 'table') {
      if (!blocks[idx + 1].caption && !blocks[idx + 1].title) {
        blocks[idx + 1].caption = block.text;
      }
      continue;
    }
    if (block.type === 'heading' || block.type === 'title') {
      const lvl = Math.max(1, Math.min(6, block.level || 1));
      openLevel(lvl, block);
    } else {
      ensureLevel1();
      if (levelHasChildren.length > 0) {
        levelHasChildren[levelHasChildren.length - 1] = true;
      }
      const currentIndent = stack[stack.length - 1] * 2 + indentBase;
      const xml = serializeBlock(block, currentIndent, idAlloc);
      if (xml) lines.push(xml);
    }
  }

  // Close any remaining open levels
  while (stack.length > 0) {
    const closedLvl = stack.pop();
    const hasChild = levelHasChildren.pop();
    if (!hasChild) {
      lines.push(`${' '.repeat(closedLvl * 2 + indentBase)}<p></p>`);
    }
    const indent = ' '.repeat(closedLvl * 2 + indentBase - 2);
    lines.push(`${indent}</level${closedLvl}>`);
  }

  return lines.join('\n');
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
  const idAlloc = new IdAllocator();

  const bodyXml = buildDtbookHierarchy(blocks, 6, title, idAlloc);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE dtbook PUBLIC "-//NISO//DTD dtbook 2005-3//EN" "http://www.daisy.org/z3986/2005/dtbook-2005-3.dtd" [
  <!ENTITY % externalNamespaces "xmlns:m CDATA #IMPLIED xmlns:mml CDATA #IMPLIED xmlns:mathml CDATA #IMPLIED xmlns:dtbook CDATA #IMPLIED">
  <!ENTITY % externalFlow "| m:math | math | mml:math">
  <!ATTLIST prodnote render (required | optional) #IMPLIED>
  <!ATTLIST sidebar render (required | optional) #IMPLIED>
  <!ELEMENT tabletn ANY>
  <!ELEMENT m:math ANY>
  <!ATTLIST m:math xmlns:m CDATA #IMPLIED xmlns:mml CDATA #IMPLIED xmlns:mathml CDATA #IMPLIED xmlns:dtbook CDATA #IMPLIED alttext CDATA #IMPLIED altimg CDATA #IMPLIED display CDATA #IMPLIED id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:math ANY>
  <!ATTLIST mml:math xmlns:mml CDATA #IMPLIED xmlns:m CDATA #IMPLIED xmlns:mathml CDATA #IMPLIED xmlns:dtbook CDATA #IMPLIED alttext CDATA #IMPLIED altimg CDATA #IMPLIED display CDATA #IMPLIED id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT math ANY>
  <!ATTLIST math xmlns CDATA #IMPLIED xmlns:m CDATA #IMPLIED xmlns:mml CDATA #IMPLIED xmlns:mathml CDATA #IMPLIED xmlns:dtbook CDATA #IMPLIED alttext CDATA #IMPLIED altimg CDATA #IMPLIED display CDATA #IMPLIED id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:semantics ANY>
  <!ATTLIST m:semantics id ID #IMPLIED class CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:annotation ANY>
  <!ATTLIST m:annotation encoding CDATA #IMPLIED id ID #IMPLIED class CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:mstyle ANY>
  <!ATTLIST m:mstyle id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED mathsize CDATA #IMPLIED mathcolor CDATA #IMPLIED mathbackground CDATA #IMPLIED mathvariant CDATA #IMPLIED displaystyle CDATA #IMPLIED scriptlevel CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:ms ANY>
  <!ATTLIST m:ms id ID #IMPLIED class CDATA #IMPLIED lquote CDATA #IMPLIED rquote CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:mrow ANY>
  <!ATTLIST m:mrow id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:mi ANY>
  <!ATTLIST m:mi id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED mathsize CDATA #IMPLIED mathcolor CDATA #IMPLIED mathbackground CDATA #IMPLIED mathvariant CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:mn ANY>
  <!ATTLIST m:mn id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED mathsize CDATA #IMPLIED mathcolor CDATA #IMPLIED mathbackground CDATA #IMPLIED mathvariant CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:mo ANY>
  <!ATTLIST m:mo id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED mathsize CDATA #IMPLIED mathcolor CDATA #IMPLIED mathbackground CDATA #IMPLIED mathvariant CDATA #IMPLIED lspace CDATA #IMPLIED rspace CDATA #IMPLIED fence CDATA #IMPLIED separator CDATA #IMPLIED stretchy CDATA #IMPLIED symmetric CDATA #IMPLIED largeop CDATA #IMPLIED movablelimits CDATA #IMPLIED accent CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:msup ANY>
  <!ATTLIST m:msup id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:msub ANY>
  <!ATTLIST m:msub id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:msubsup ANY>
  <!ATTLIST m:msubsup id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:mover ANY>
  <!ATTLIST m:mover id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED accent CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:munder ANY>
  <!ATTLIST m:munder id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED accentunder CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:munderover ANY>
  <!ATTLIST m:munderover id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED accent CDATA #IMPLIED accentunder CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:menclose ANY>
  <!ATTLIST m:menclose id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED notation CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:mpadded ANY>
  <!ATTLIST m:mpadded id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED height CDATA #IMPLIED depth CDATA #IMPLIED voffset CDATA #IMPLIED width CDATA #IMPLIED lspace CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:mphantom ANY>
  <!ATTLIST m:mphantom id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:mfrac ANY>
  <!ATTLIST m:mfrac id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED linethickness CDATA #IMPLIED bevelled CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:msqrt ANY>
  <!ATTLIST m:msqrt id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:mroot ANY>
  <!ATTLIST m:mroot id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:mtable ANY>
  <!ATTLIST m:mtable id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED rowalign CDATA #IMPLIED columnalign CDATA #IMPLIED rowspacing CDATA #IMPLIED columnspacing CDATA #IMPLIED displaystyle CDATA #IMPLIED equalrows CDATA #IMPLIED equalcolumns CDATA #IMPLIED width CDATA #IMPLIED frame CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:mtr ANY>
  <!ATTLIST m:mtr id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED rowalign CDATA #IMPLIED columnalign CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:mtd ANY>
  <!ATTLIST m:mtd id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED rowalign CDATA #IMPLIED columnalign CDATA #IMPLIED columnspan CDATA #IMPLIED rowspan CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:mtext ANY>
  <!ATTLIST m:mtext id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED mathsize CDATA #IMPLIED mathcolor CDATA #IMPLIED mathbackground CDATA #IMPLIED mathvariant CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT m:mspace ANY>
  <!ATTLIST m:mspace id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED width CDATA #IMPLIED height CDATA #IMPLIED depth CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:mstyle ANY>
  <!ATTLIST mml:mstyle id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED mathsize CDATA #IMPLIED mathcolor CDATA #IMPLIED mathbackground CDATA #IMPLIED mathvariant CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:ms ANY>
  <!ATTLIST mml:ms id ID #IMPLIED class CDATA #IMPLIED lquote CDATA #IMPLIED rquote CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:semantics ANY>
  <!ATTLIST mml:semantics id ID #IMPLIED class CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:annotation ANY>
  <!ATTLIST mml:annotation encoding CDATA #IMPLIED id ID #IMPLIED class CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:mrow ANY>
  <!ATTLIST mml:mrow id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:mi ANY>
  <!ATTLIST mml:mi id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED mathsize CDATA #IMPLIED mathcolor CDATA #IMPLIED mathbackground CDATA #IMPLIED mathvariant CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:mn ANY>
  <!ATTLIST mml:mn id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED mathsize CDATA #IMPLIED mathcolor CDATA #IMPLIED mathbackground CDATA #IMPLIED mathvariant CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:mo ANY>
  <!ATTLIST mml:mo id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED mathsize CDATA #IMPLIED mathcolor CDATA #IMPLIED mathbackground CDATA #IMPLIED mathvariant CDATA #IMPLIED lspace CDATA #IMPLIED rspace CDATA #IMPLIED fence CDATA #IMPLIED separator CDATA #IMPLIED stretchy CDATA #IMPLIED symmetric CDATA #IMPLIED largeop CDATA #IMPLIED movablelimits CDATA #IMPLIED accent CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:msup ANY>
  <!ATTLIST mml:msup id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:msub ANY>
  <!ATTLIST mml:msub id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:msubsup ANY>
  <!ATTLIST mml:msubsup id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:mover ANY>
  <!ATTLIST mml:mover id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED accent CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:munder ANY>
  <!ATTLIST mml:munder id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED accentunder CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:munderover ANY>
  <!ATTLIST mml:munderover id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED accent CDATA #IMPLIED accentunder CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:menclose ANY>
  <!ATTLIST mml:menclose id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED notation CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:mpadded ANY>
  <!ATTLIST mml:mpadded id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED height CDATA #IMPLIED depth CDATA #IMPLIED voffset CDATA #IMPLIED width CDATA #IMPLIED lspace CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:mphantom ANY>
  <!ATTLIST mml:mphantom id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:mfrac ANY>
  <!ATTLIST mml:mfrac id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED linethickness CDATA #IMPLIED bevelled CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:msqrt ANY>
  <!ATTLIST mml:msqrt id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:mroot ANY>
  <!ATTLIST mml:mroot id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:mtable ANY>
  <!ATTLIST mml:mtable id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED rowalign CDATA #IMPLIED columnalign CDATA #IMPLIED rowspacing CDATA #IMPLIED columnspacing CDATA #IMPLIED displaystyle CDATA #IMPLIED equalrows CDATA #IMPLIED equalcolumns CDATA #IMPLIED width CDATA #IMPLIED frame CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:mtr ANY>
  <!ATTLIST mml:mtr id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED rowalign CDATA #IMPLIED columnalign CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:mtd ANY>
  <!ATTLIST mml:mtd id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED rowalign CDATA #IMPLIED columnalign CDATA #IMPLIED columnspan CDATA #IMPLIED rowspan CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:mtext ANY>
  <!ATTLIST mml:mtext id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED mathsize CDATA #IMPLIED mathcolor CDATA #IMPLIED mathbackground CDATA #IMPLIED mathvariant CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mml:mspace ANY>
  <!ATTLIST mml:mspace id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED width CDATA #IMPLIED height CDATA #IMPLIED depth CDATA #IMPLIED smilref CDATA #IMPLIED dtbook:smilref CDATA #IMPLIED>
  <!ELEMENT mstyle ANY>
  <!ATTLIST mstyle id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED mathsize CDATA #IMPLIED mathcolor CDATA #IMPLIED mathvariant CDATA #IMPLIED>
  <!ELEMENT ms ANY>
  <!ATTLIST ms id ID #IMPLIED class CDATA #IMPLIED lquote CDATA #IMPLIED rquote CDATA #IMPLIED>
  <!ELEMENT semantics ANY>
  <!ATTLIST semantics id ID #IMPLIED class CDATA #IMPLIED>
  <!ELEMENT mrow ANY>
  <!ATTLIST mrow id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED>
  <!ELEMENT mi ANY>
  <!ATTLIST mi id ID #IMPLIED class CDATA #IMPLIED mathvariant CDATA #IMPLIED>
  <!ELEMENT mn ANY>
  <!ATTLIST mn id ID #IMPLIED class CDATA #IMPLIED>
  <!ELEMENT mo ANY>
  <!ATTLIST mo id ID #IMPLIED class CDATA #IMPLIED style CDATA #IMPLIED lspace CDATA #IMPLIED rspace CDATA #IMPLIED fence CDATA #IMPLIED separator CDATA #IMPLIED stretchy CDATA #IMPLIED symmetric CDATA #IMPLIED largeop CDATA #IMPLIED movablelimits CDATA #IMPLIED accent CDATA #IMPLIED>
  <!ELEMENT msup ANY>
  <!ATTLIST msup id ID #IMPLIED class CDATA #IMPLIED>
  <!ELEMENT msub ANY>
  <!ATTLIST msub id ID #IMPLIED class CDATA #IMPLIED>
  <!ELEMENT msubsup ANY>
  <!ATTLIST msubsup id ID #IMPLIED class CDATA #IMPLIED>
  <!ELEMENT mover ANY>
  <!ATTLIST mover id ID #IMPLIED class CDATA #IMPLIED accent CDATA #IMPLIED>
  <!ELEMENT munder ANY>
  <!ATTLIST munder id ID #IMPLIED class CDATA #IMPLIED accentunder CDATA #IMPLIED>
  <!ELEMENT munderover ANY>
  <!ATTLIST munderover id ID #IMPLIED class CDATA #IMPLIED accent CDATA #IMPLIED accentunder CDATA #IMPLIED>
  <!ELEMENT menclose ANY>
  <!ATTLIST menclose id ID #IMPLIED class CDATA #IMPLIED notation CDATA #IMPLIED>
  <!ELEMENT mpadded ANY>
  <!ATTLIST mpadded id ID #IMPLIED class CDATA #IMPLIED height CDATA #IMPLIED depth CDATA #IMPLIED voffset CDATA #IMPLIED width CDATA #IMPLIED lspace CDATA #IMPLIED>
  <!ELEMENT mphantom ANY>
  <!ATTLIST mphantom id ID #IMPLIED class CDATA #IMPLIED>
  <!ELEMENT mfrac ANY>
  <!ATTLIST mfrac id ID #IMPLIED class CDATA #IMPLIED linethickness CDATA #IMPLIED bevelled CDATA #IMPLIED>
  <!ELEMENT msqrt ANY>
  <!ATTLIST msqrt id ID #IMPLIED class CDATA #IMPLIED>
  <!ELEMENT mroot ANY>
  <!ATTLIST mroot id ID #IMPLIED class CDATA #IMPLIED>
  <!ELEMENT mtable ANY>
  <!ATTLIST mtable id ID #IMPLIED class CDATA #IMPLIED rowalign CDATA #IMPLIED columnalign CDATA #IMPLIED rowspacing CDATA #IMPLIED columnspacing CDATA #IMPLIED>
  <!ELEMENT mtr ANY>
  <!ATTLIST mtr id ID #IMPLIED class CDATA #IMPLIED rowalign CDATA #IMPLIED columnalign CDATA #IMPLIED>
  <!ELEMENT mtd ANY>
  <!ATTLIST mtd id ID #IMPLIED class CDATA #IMPLIED rowalign CDATA #IMPLIED columnalign CDATA #IMPLIED columnspan CDATA #IMPLIED rowspan CDATA #IMPLIED>
  <!ELEMENT mtext ANY>
  <!ATTLIST mtext id ID #IMPLIED class CDATA #IMPLIED>
  <!ELEMENT mspace ANY>
  <!ATTLIST mspace id ID #IMPLIED class CDATA #IMPLIED width CDATA #IMPLIED height CDATA #IMPLIED depth CDATA #IMPLIED>
]>
<dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" xmlns:m="http://www.w3.org/1998/Math/MathML" xmlns:mml="http://www.w3.org/1998/Math/MathML" xmlns:mathml="http://www.w3.org/1998/Math/MathML" version="2005-3" xml:lang="${escapeXml(lang)}">
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
${bodyXml}
    </bodymatter>
  </book>
</dtbook>
`;
}

export const exportToNimas = exportToNimasXml;
