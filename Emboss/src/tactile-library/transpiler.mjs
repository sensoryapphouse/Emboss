// Transpiler Engine for Multi-Target Tactile Production (Swell Paper, ViewPlus Tiger 3D, Index Braille 1-Bit)

export function ensureXmlns(svgStr) {
  if (!svgStr) return svgStr;
  if (!svgStr.includes('xmlns=')) {
    return svgStr.replace(/<svg\b([^>]*)>/i, '<svg xmlns="http://www.w3.org/2000/svg" $1>');
  }
  return svgStr;
}

export function transpileToSwell(svgStr) {
  if (!svgStr) return svgStr;
  let isFirst = true;

  let res = svgStr.replace(/<(path|polygon|polyline|circle|ellipse|rect|line)([^>]*?)(\/?>)/gi, (match, tag, attrs, closing) => {
    const swMatch = attrs.match(/stroke-width="([^"]+)"/i);
    let sw = swMatch ? swMatch[1] : '4.5';
    if (isNaN(parseFloat(sw)) || parseFloat(sw) < 2.0) {
      sw = '4.5';
    }

    // Completely strip duplicate/conflicting presentation attributes
    let clean = attrs
      .replace(/\s*fill="[^"]*"/gi, '')
      .replace(/\s*stroke="[^"]*"/gi, '')
      .replace(/\s*stroke-width="[^"]*"/gi, '')
      .replace(/\s*stroke-linejoin="[^"]*"/gi, '')
      .replace(/\s*stroke-linecap="[^"]*"/gi, '')
      .replace(/\s*vector-effect="[^"]*"/gi, '')
      .trim();

    const cleanStr = clean.length > 0 ? ` ${clean}` : '';
    const isLine = tag.toLowerCase() === 'line';

    let fillAttr = 'fill="none"';
    if (!isLine) {
      if (isFirst) {
        fillAttr = 'fill="#ffffff"';
        isFirst = false;
      }
    }

    return `<${tag} ${fillAttr} stroke="#000000" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"${cleanStr}${closing}`;
  });

  return ensureXmlns(res);
}

export function transpileToTiger(svgStr) {
  if (!svgStr) return svgStr;
  const fillMatches = [...svgStr.matchAll(/fill="([^"]+)"/gi)].map(m => m[1].trim());
  const uniqueFills = [...new Set(fillMatches)].filter(f => f !== 'none' && f !== '#ffffff' && f !== '#000000' && f !== 'white' && f !== 'black');

  const tigerElevations = ['#2563eb', '#059669', '#d97706', '#9333ea', '#dc2626'];

  let res = svgStr;
  uniqueFills.forEach((origFill, idx) => {
    const tigerColor = tigerElevations[idx % tigerElevations.length];
    res = res.replaceAll(`fill="${origFill}"`, `fill="${tigerColor}"`);
  });
  return ensureXmlns(res);
}

export function transpileToIndex(svgStr, symIndex = 0) {
  if (!svgStr) return svgStr;
  const diagId = `diag-dots-idx-${symIndex}`;
  const stippleId = `stipple-dots-idx-${symIndex}`;
  const denseId = `dense-dots-idx-${symIndex}`;

  const patternDefs = `
    <defs>
      <pattern id="${diagId}" width="8" height="8" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r="1.4" fill="#000000"/>
        <circle cx="6" cy="6" r="1.4" fill="#000000"/>
      </pattern>
      <pattern id="${stippleId}" width="10" height="10" patternUnits="userSpaceOnUse">
        <circle cx="5" cy="5" r="1.4" fill="#000000"/>
      </pattern>
      <pattern id="${denseId}" width="6" height="6" patternUnits="userSpaceOnUse">
        <circle cx="3" cy="3" r="1.5" fill="#000000"/>
      </pattern>
    </defs>
  `;

  const fillMatches = [...svgStr.matchAll(/fill="([^"]+)"/gi)].map(m => m[1].trim());
  const uniqueFills = [...new Set(fillMatches)].filter(f => f !== 'none' && f !== '#ffffff' && f !== '#000000' && f !== 'white' && f !== 'black');

  const patternRefs = [`url(#${diagId})`, `url(#${stippleId})`, `url(#${denseId})`];

  let res = svgStr.replace(/<svg([^>]*)>/, `<svg$1>${patternDefs}`);
  uniqueFills.forEach((origFill, idx) => {
    const patRef = patternRefs[idx % patternRefs.length];
    res = res.replaceAll(`fill="${origFill}"`, `fill="${patRef}"`);
  });
  return ensureXmlns(res);
}
