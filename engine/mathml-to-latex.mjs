// MathML to LaTeX converter for Emboss and Translate.
// Converts standard W3C MathML (with or without m: namespace prefixes)
// into clean LaTeX for MathLive (<math-field>) and Temml.

const GREEK_MAP = {
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\epsilon',
  'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta', 'ι': '\\iota', 'κ': '\\kappa',
  'λ': '\\lambda', 'μ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi',
  'ρ': '\\rho', 'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\phi',
  'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
  'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda', 'Ξ': '\\Xi',
  'Π': '\\Pi', 'Σ': '\\Sigma', 'Υ': '\\Upsilon', 'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega'
};

const MATH_FUNCS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'coth', 'sech', 'csch',
  'log', 'ln', 'exp', 'lim', 'max', 'min', 'det', 'gcd', 'deg', 'dim', 'ker', 'hom', 'arg'
]);

const OP_MAP = {
  '±': '\\pm ', '∓': '\\mp ', '×': '\\times ', '÷': '\\div ', '·': '\\cdot ',
  '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '≈': '\\approx ', '≡': '\\equiv ',
  '∈': '\\in ', '∉': '\\notin ', '⊂': '\\subset ', '⊆': '\\subseteq ',
  '∪': '\\cup ', '∩': '\\cap ', '∞': '\\infty ', '∂': '\\partial ',
  '∇': '\\nabla ', '→': '\\to ', '←': '\\gets ', '⇒': '\\implies ',
  '⇔': '\\iff ', '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ',
  '∬': '\\iint ', '∭': '\\iiint ', '∮': '\\oint ',
  '−': '-', '–': '-', '—': '-',
  '⁢': '', // &InvisibleTimes;
  '⁡': '', // &ApplyFunction;
  '⁣': ''  // &InvisibleComma;
};

const ACCENT_MAP = {
  '^': '\\hat', '̂': '\\hat', 'ˆ': '\\hat',
  '¯': '\\bar', 'ˉ': '\\bar', '_': '\\bar',
  '→': '\\vec', '⃗': '\\vec',
  '~': '\\tilde', '̃': '\\tilde',
  '˙': '\\dot', '̇': '\\dot',
  '¨': '\\ddot', '̈': '\\ddot',
  '˚': '\\mathring', '̊': '\\mathring'
};

function getLocalTagName(node) {
  if (!node) return '';
  return (node.localName || node.tagName || node.nodeName || '').toLowerCase().replace(/^[a-z0-9]+:/, '');
}

function getElementChildren(node) {
  if (!node || !node.childNodes) return [];
  const list = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const c = node.childNodes[i];
    if (c && c.nodeType === 1) list.push(c);
  }
  return list;
}

function parseXmlTree(xmlStr) {
  const Parser = typeof DOMParser !== 'undefined' ? DOMParser : globalThis.DOMParser;
  if (!Parser) return null;
  let cleanXml = (xmlStr ?? '').replace(/^\uFEFF/, '').trim();
  if (cleanXml.includes('m:') && !cleanXml.includes('xmlns:m')) {
    cleanXml = cleanXml.replace(/<(m:[a-zA-Z0-9]+)([\s>])/, '<$1 xmlns:m="http://www.w3.org/1998/Math/MathML"$2');
  }
  let doc = new Parser().parseFromString(cleanXml, 'application/xml');
  const err = (doc.getElementsByTagName && doc.getElementsByTagName('parsererror')[0])
    || (doc.documentElement && doc.documentElement.nodeName === 'parsererror' ? doc.documentElement : null);
  if (!err) return doc;
  
  if (typeof document !== 'undefined') {
    try {
      const htmlDoc = new Parser().parseFromString(cleanXml, 'text/html');
      return htmlDoc;
    } catch { /* fallback */ }
  }
  return doc;
}

export function mathmlToLatex(mathmlStr) {
  if (!mathmlStr || typeof mathmlStr !== 'string') return '';
  const trimmed = mathmlStr.trim();
  if (!trimmed) return '';

  let doc;
  try {
    doc = parseXmlTree(trimmed);
  } catch {
    doc = null;
  }

  if (!doc) {
    return trimmed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  let root = doc.documentElement;
  if (root && doc.getElementsByTagName) {
    const tag = getLocalTagName(root);
    if (tag !== 'math') {
      const mathEl = doc.getElementsByTagName('math')[0] || doc.getElementsByTagName('m:math')[0];
      if (mathEl) root = mathEl;
    }
  }
  if (!root) return '';

  return postProcessLatex(convertNode(root));
}

function postProcessLatex(latex) {
  return (latex || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;:])/g, '$1')
    .replace(/\\left\s*([(\[{|])/g, '\\left$1')
    .replace(/\\right\s*([)\]}|])/g, '\\right$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\[\s+/g, '[')
    .replace(/\s+\]/g, ']')
    .replace(/\{\s+/g, '{')
    .replace(/\s+\}/g, '}')
    .trim();
}

function convertNode(node) {
  if (!node) return '';
  if (node.nodeType === 3) {
    return node.nodeValue || '';
  }
  if (node.nodeType !== 1) return '';

  const tag = getLocalTagName(node);
  const convertChildren = () => {
    let s = '';
    if (node.childNodes) {
      for (let i = 0; i < node.childNodes.length; i++) {
        s += convertNode(node.childNodes[i]);
      }
    }
    return s;
  };

  switch (tag) {
    case 'math':
    case 'mrow':
    case 'mstyle':
    case 'merror':
    case 'mphantom':
    case 'mpadded':
      return convertChildren();

    case 'mi': {
      const txt = (node.textContent || (node.firstChild && node.firstChild.nodeValue) || '').trim();
      if (!txt) return '';
      if (GREEK_MAP[txt]) return GREEK_MAP[txt] + ' ';
      if (MATH_FUNCS.has(txt)) return `\\${txt} `;
      if (txt.length > 1 && /^[a-zA-Z]+$/.test(txt)) return `\\mathrm{${txt}}`;
      return txt;
    }

    case 'mn':
      return (node.textContent || (node.firstChild && node.firstChild.nodeValue) || '').trim();

    case 'mo': {
      const txt = (node.textContent || (node.firstChild && node.firstChild.nodeValue) || '').trim();
      if (!txt) return '';
      if (OP_MAP[txt] !== undefined) return OP_MAP[txt];
      if (txt === '{' || txt === '}') return `\\${txt}`;
      if (/^[a-zA-Z0-9]$/.test(txt)) return txt;
      if (txt === '(' || txt === ')' || txt === '[' || txt === ']' || txt === '|') return txt;
      return ` ${txt} `;
    }

    case 'mtext': {
      const txt = (node.textContent || '').replace(/\s+/g, ' ');
      return `\\text{${txt}}`;
    }

    case 'ms': {
      const txt = (node.textContent || '').replace(/\s+/g, ' ');
      return `\\text{"${txt}"}`;
    }

    case 'mspace':
      return ' ';

    case 'mfrac': {
      const [num, den] = getElementChildren(node);
      const numLatex = convertNode(num) || '1';
      const denLatex = convertNode(den) || '1';
      return `\\frac{${numLatex.trim()}}{${denLatex.trim()}}`;
    }

    case 'msqrt':
      return `\\sqrt{${convertChildren().trim()}}`;

    case 'mroot': {
      const [base, idx] = getElementChildren(node);
      const baseLatex = convertNode(base) || '';
      const idxLatex = convertNode(idx) || '2';
      return `\\sqrt[${idxLatex.trim()}]{${baseLatex.trim()}}`;
    }

    case 'msup': {
      const [base, sup] = getElementChildren(node);
      const baseLatex = wrapBase(base);
      const supLatex = convertNode(sup) || '';
      return `${baseLatex}^{${supLatex.trim()}}`;
    }

    case 'msub': {
      const [base, sub] = getElementChildren(node);
      const baseLatex = wrapBase(base);
      const subLatex = convertNode(sub) || '';
      return `${baseLatex}_{${subLatex.trim()}}`;
    }

    case 'msubsup': {
      const [base, sub, sup] = getElementChildren(node);
      const baseLatex = wrapBase(base);
      const subLatex = convertNode(sub) || '';
      const supLatex = convertNode(sup) || '';
      return `${baseLatex}_{${subLatex.trim()}}^{${supLatex.trim()}}`;
    }

    case 'munder': {
      const [base, under] = getElementChildren(node);
      const bTxt = convertNode(base).trim();
      const uTxt = convertNode(under).trim();
      if (bTxt === '\\sum' || bTxt === '\\prod' || bTxt === '\\lim' || bTxt === '\\int') {
        return `${bTxt}_{${uTxt}} `;
      }
      return `\\underset{${uTxt}}{${wrapBase(base)}}`;
    }

    case 'mover': {
      const [base, over] = getElementChildren(node);
      const oRaw = (over?.textContent || '').trim();
      const bLatex = convertNode(base).trim();
      if (ACCENT_MAP[oRaw]) {
        return `${ACCENT_MAP[oRaw]}{${bLatex}}`;
      }
      const oTxt = convertNode(over).trim();
      return `\\overset{${oTxt}}{${wrapBase(base)}}`;
    }

    case 'munderover': {
      const [base, under, over] = getElementChildren(node);
      const bTxt = convertNode(base).trim();
      const uTxt = convertNode(under).trim();
      const oTxt = convertNode(over).trim();
      if (bTxt === '\\sum' || bTxt === '\\prod' || bTxt === '\\int' || bTxt === '\\iint' || bTxt === '\\oint') {
        return `${bTxt}_{${uTxt}}^{${oTxt}} `;
      }
      return `\\munderover{${wrapBase(base)}}{${uTxt}}{${oTxt}}`;
    }

    case 'mfenced': {
      const open = node.getAttribute ? (node.getAttribute('open') || '(') : '(';
      const close = node.getAttribute ? (node.getAttribute('close') || ')') : ')';
      const openTex = open === '{' ? '\\{' : open;
      const closeTex = close === '}' ? '\\}' : close;
      return `\\left${openTex}${convertChildren().trim()}\\right${closeTex}`;
    }

    case 'mtable': {
      const rows = getElementChildren(node).filter((n) => getLocalTagName(n) === 'mtr');
      const rowLatex = rows.map((r) => {
        const cells = getElementChildren(r).filter((n) => getLocalTagName(n) === 'mtd');
        return cells.map((c) => convertNode(c).trim()).join(' & ');
      }).join(' \\\\ ');
      return `\\begin{matrix} ${rowLatex} \\end{matrix}`;
    }

    case 'menclose': {
      const notation = node.getAttribute ? (node.getAttribute('notation') || '') : '';
      const body = convertChildren().trim();
      if (notation.includes('box') || notation.includes('roundedbox')) return `\\boxed{${body}}`;
      if (notation.includes('top') || notation.includes('actuarial')) return `\\overline{${body}}`;
      if (notation.includes('radical')) return `\\sqrt{${body}}`;
      if (notation.includes('horizontalstrike') || notation.includes('updiagonalstrike')) return `\\cancel{${body}}`;
      return body;
    }

    default:
      return convertChildren();
  }
}

function wrapBase(baseNode) {
  if (!baseNode) return '';
  const tag = getLocalTagName(baseNode);
  const latex = convertNode(baseNode).trim();
  if (tag === 'mi' || tag === 'mn') return latex;
  if (latex.length === 1) return latex;
  return `{${latex}}`;
}
