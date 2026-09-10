import { makeZip } from '/web/zip.mjs';

function escapeXml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// `tf` is the liblouis typeform BITMASK the editor's model carries (italic=1,
// underline=2, bold=4 — see louis.TYPEFORM), not an object of booleans.
function tfRunProps(tf) {
  const n = Number(tf) || 0;
  return (n & 4 ? '<w:b/>' : '') + (n & 1 ? '<w:i/>' : '') + (n & 2 ? '<w:u w:val="single"/>' : '');
}

export function exportToDocxBlob(model, title = 'Document') {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet">
    <w:name w:val="List Bullet"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
  </w:style>
</w:styles>`;

  const pXmls = [];
  (model?.blocks || []).forEach((b) => {
    if (b.type === 'heading') {
      const style = b.level === 1 ? 'Heading1' : b.level === 2 ? 'Heading2' : 'Heading3';
      pXmls.push(`<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(b.text)}</w:t></w:r></w:p>`);
    } else if (b.type === 'para') {
      const rXmls = [];
      if (b.segments) {
        for (const s of b.segments) {
          if (s.type === 'math') {
            rXmls.push(`<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">$${escapeXml(s.latex || '')}$</w:t></w:r>`);
          } else {
            const tfPr = tfRunProps(s.tf);
            rXmls.push(`<w:r>${tfPr ? '<w:rPr>' + tfPr + '</w:rPr>' : ''}<w:t xml:space="preserve">${escapeXml(s.text || '')}</w:t></w:r>`);
          }
        }
      } else {
        rXmls.push(`<w:r><w:t xml:space="preserve">${escapeXml(b.text || '')}</w:t></w:r>`);
      }
      pXmls.push(`<w:p>${rXmls.join('')}</w:p>`);
    } else if (b.type === 'list') {
      for (const it of (b.items || [])) {
        const ordered = b.ordered || (b.items || []).some((x) => x && x.marker);   // numbering lives in item.marker
        const marker = ordered ? (it.marker || '1.') : '•';
        const rXmls = [];
        if (it.segments) {
          for (const s of it.segments) {
            if (s.type === 'math') {
              rXmls.push(`<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">$${escapeXml(s.latex || '')}$</w:t></w:r>`);
            } else {
              const tfPr = tfRunProps(s.tf);
              rXmls.push(`<w:r>${tfPr ? '<w:rPr>' + tfPr + '</w:rPr>' : ''}<w:t xml:space="preserve">${escapeXml(s.text || '')}</w:t></w:r>`);
            }
          }
        } else {
          rXmls.push(`<w:r><w:t xml:space="preserve">${escapeXml(it.text || '')}</w:t></w:r>`);
        }
        pXmls.push(`<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:t xml:space="preserve">${marker} </w:t></w:r>${rXmls.join('')}</w:p>`);
      }
    } else if (b.type === 'table') {
      const headers = b.headers || [];
      const rows = b.rows || [];
      const tblRows = [];
      if (headers.length) {
        const hCells = headers.map(h => `<w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(h)}</w:t></w:r></w:p></w:tc>`).join('');
        tblRows.push(`<w:tr><w:trPr><w:tblHeader/></w:trPr>${hCells}</w:tr>`);
      }
      for (const row of rows) {
        const rCells = (row || []).map(cell => `<w:tc><w:p><w:r><w:t xml:space="preserve">${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`).join('');
        tblRows.push(`<w:tr>${rCells}</w:tr>`);
      }
      pXmls.push(`<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="none"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="none"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="EEEEEE"/><w:insideV w:val="none"/></w:tblBorders></w:tblPr>${tblRows.join('')}</w:tbl>`);
    } else if (b.type === 'indicator') {            // buildModel's section break
      pXmls.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">∗ ∗ ∗</w:t></w:r></w:p>`);
    } else if (b.type === 'note') {
      pXmls.push(`<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${escapeXml(b.text || '')}</w:t></w:r></w:p>`);
    } else if (b.type === 'footnote') {
      pXmls.push(`<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${escapeXml(b.text || '')}</w:t></w:r></w:p>`);
    } else if (b.type === 'stage' || b.style === 'stage') {
      pXmls.push(`<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${escapeXml(b.text || '')}</w:t></w:r></w:p>`);
    } else if (b.type === 'caption' || b.style === 'caption') {
      pXmls.push(`<w:p><w:pPr><w:ind w:left="720"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/><w:i/></w:rPr><w:t xml:space="preserve">${escapeXml(b.text || '')}</w:t></w:r></w:p>`);
    } else if (b.type === 'attribution' || b.style === 'attribution') {
      pXmls.push(`<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${escapeXml(b.text || '')}</w:t></w:r></w:p>`);
    } else if (b.type === 'play' || b.style === 'dialogue' || b.style === 'poem') {
      if (b.subtype === 'verse' || b.style === 'poem') {
        pXmls.push(`<w:p><w:pPr><w:ind w:left="360"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(b.text || '')}</w:t></w:r></w:p>`);
      } else {
        pXmls.push(`<w:p><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(b.text || '')}</w:t></w:r></w:p>`);
      }
    } else if (b.style === 'quote') {
      pXmls.push(`<w:p><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${escapeXml(b.text || '')}</w:t></w:r></w:p>`);
    }
  });

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${pXmls.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const files = [
    { name: '[Content_Types].xml', text: contentTypes },
    { name: '_rels/.rels', text: rootRels },
    { name: 'word/_rels/document.xml.rels', text: docRels },
    { name: 'word/styles.xml', text: stylesXml },
    { name: 'word/document.xml', text: docXml }
  ];

  const zipBlob = makeZip(files);
  return new Blob([zipBlob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
