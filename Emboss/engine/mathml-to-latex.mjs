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
  'log', 'ln', 'lg', 'exp', 'lim', 'liminf', 'limsup', 'max', 'min', 'sup', 'inf', 'Pr',
  'det', 'gcd', 'deg', 'dim', 'ker', 'hom', 'arg'
]);

// Function names that take their limit underneath (\lim_{x\to 0}, \max_{x}): a stacked <munder> over one of
// these is written as a subscript in LaTeX, like \sum_{i}.
const LIMIT_FUNCS_TEX = new Set(['\\lim', '\\liminf', '\\limsup', '\\max', '\\min', '\\sup', '\\inf', '\\Pr', '\\gcd', '\\det']);

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

// Accent character (over an <mover>) -> LaTeX accent command. Both the spacing characters MathML uses and the
// combining characters Word / MathType store are listed; omml.mjs turns the latter into the former.
const ACCENT_MAP = {
  '^': '\\hat', '\u0302': '\\hat', '\u02C6': '\\hat',
  '\u00AF': '\\bar', '\u02C9': '\\bar', '_': '\\bar', '\u0304': '\\bar', '\u0305': '\\bar', '\u203E': '\\bar',
  '\u2192': '\\vec', '\u20D7': '\\vec',
  '\u2190': '\\overleftarrow', '\u20D6': '\\overleftarrow',
  '\u2194': '\\overleftrightarrow', '\u20E1': '\\overleftrightarrow',
  '~': '\\tilde', '\u0303': '\\tilde',
  '\u02D9': '\\dot', '\u0307': '\\dot',
  '\u00A8': '\\ddot', '\u0308': '\\ddot', '..': '\\ddot',   // '..' is omml.mjs's form (MathCAT has no Nemeth entry for U+00A8)
  '\u02DA': '\\mathring', '\u030A': '\\mathring',
  '\u00B4': '\\acute', '\u0301': '\\acute',
  '`': '\\grave', '\u0300': '\\grave',
  '\u02C7': '\\check', '\u030C': '\\check',
  '\u02D8': '\\breve', '\u0306': '\\breve'
};

// The bracket characters a fenced group can carry, and their LaTeX form after \left / \right. '' (an empty
// fence: no bracket on that side) is written "."; a character not listed is not something LaTeX can size,
// so the group is left as ordinary characters. A command ends in a space so the next letter is not read
// as part of its name (\left\langle x).
const FENCE_LATEX = {
  '': '.', '(': '(', ')': ')', '[': '[', ']': ']', '|': '|', '{': '\\{', '}': '\\}',
  '\u27E8': '\\langle ', '\u2329': '\\langle ', '\u3008': '\\langle ',
  '\u27E9': '\\rangle ', '\u232A': '\\rangle ', '\u3009': '\\rangle ',
  '\u230A': '\\lfloor ', '\u230B': '\\rfloor ', '\u2308': '\\lceil ', '\u2309': '\\rceil ',
  '\u2016': '\\|', '\u2225': '\\|', '/': '/'
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
  const raw = latex || '';
  // Protect \text{...} spans before the generic "trim whitespace touching a brace" cleanup
  // below: every OTHER {...} group this converter builds (a sup/sub argument, \frac{}{},
  // \left(...\right)) only ever picks up leading/trailing whitespace as incidental
  // formatting noise, so trimming it is safe — but \text{...}'s own interior spacing is
  // semantic (real words, e.g. omml.mjs's plain-text-run fix, "AGENTS.md" fix 2, builds
  // "\text{ if }" specifically so "if" reads as its own word): trimming it back out here
  // would silently undo that fix and mash the words together again in the print pane.
  const texts = [];
  const masked = raw.replace(/\\text\{[^{}]*\}/g, (m) => { texts.push(m); return `\u0000${texts.length - 1}\u0000`; });
  const cleaned = masked
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
  return cleaned.replace(/\u0000(\d+)\u0000/g, (m, i) => texts[Number(i)] ?? m);
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
    case 'mrow': {
      const fenced = convertFencedRow(node);
      return fenced !== null ? fenced : convertChildren();
    }

    case 'math':
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
      // A multi-letter name that is applied as a function (U+2061 follows it: Word's m:func, MathML from
      // MathType or MathLive) but has no LaTeX command of its own (sgn, cosec ...).
      if (txt.length > 1 && /^[a-zA-Z]+$/.test(txt) && isAppliedFunction(node)) return `\\operatorname{${txt}} `;
      if (txt.length > 1 && /^[a-zA-Z]+$/.test(txt)) return `\\mathrm{${txt}}`;
      // A single upright letter (omml.mjs's plainTextToMathML: Word's "Normal Text" style
      // on e.g. the "d" in "dx", or a one-letter unit) is still italic by default here
      // (the length>1 branch above is the only other place this print renderer asks for
      // upright) — match it so the print pane shows the same upright glyph the braille
      // already reflects, instead of a "d" indistinguishable from a variable.
      if (node.getAttribute && node.getAttribute('mathvariant') === 'normal') return `\\mathrm{${txt}}`;
      return txt;
    }

    case 'mn':
      return (node.textContent || (node.firstChild && node.firstChild.nodeValue) || '').trim();

    case 'mo': {
      const txt = (node.textContent || (node.firstChild && node.firstChild.nodeValue) || '').trim();
      if (!txt) return '';
      return operatorToLatex(txt);
    }

    case 'mtext': {
      const txt = (node.textContent || '').replace(/\s+/g, ' ');
      const word = txt.trim();
      // LibreOffice (ODT/ODF MathML) and MathType (.doc) write operators and function names as <mtext>:
      // "+", "=", "-" and "sin", "log". As \text{} they showed as upright prose in the print view ("a\text{+}b")
      // and lost the function. An mtext that is only a mathematical operator is the operator; one that is a
      // known function name is the function.
      if (word && word.length <= 3 && !/[\p{L}\p{N}\s]/u.test(word) && (OP_MAP[word] !== undefined || /^[-+=<>*\/,;:!?.|()[\]{}]+$/.test(word))) return operatorToLatex(word);
      if (MATH_FUNCS.has(word)) return `\\${word} `;
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
      if (bTxt === '\\sum' || bTxt === '\\prod' || bTxt === '\\int' || LIMIT_FUNCS_TEX.has(bTxt)) {
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
      // Three dots above (Word's U+20DB, omml.mjs writes "..."): LaTeX's \dddot is not in MathLive.
      if (oRaw === '\u20DB' || oRaw === '...') return `\\overset{\\cdot\\cdot\\cdot}{${wrapBase(base)}}`;
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
      // open/close default to ( ) only when the attribute is ABSENT; open="" means no bracket ("\left.").
      const has = (a) => !!(node.hasAttribute && node.hasAttribute(a));
      const open = has('open') ? node.getAttribute('open') : '(';
      const close = has('close') ? node.getAttribute('close') : ')';
      const openTex = FENCE_LATEX[open.trim()] ?? open;
      const closeTex = FENCE_LATEX[close.trim()] ?? close;
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

// The LaTeX for one operator character (what an <mo> holds; also an <mtext> that is only an operator).
function operatorToLatex(txt) {
  if (OP_MAP[txt] !== undefined) return OP_MAP[txt];
  if (txt === '{' || txt === '}') return `\\${txt}`;
  if (/^[a-zA-Z0-9]$/.test(txt)) return txt;
  if (txt === '(' || txt === ')' || txt === '[' || txt === ']' || txt === '|') return txt;
  return ` ${txt} `;
}

// True when the element is directly followed by U+2061 (function application) - the marker that a multi-letter
// <mi> is a function name and not a product of variables.
function isAppliedFunction(node) {
  let next = node.nextSibling;
  while (next && next.nodeType !== 1 && !(next.nodeType === 3 && (next.nodeValue || '').trim())) next = next.nextSibling;
  return !!next && next.nodeType === 1 && getLocalTagName(next) === 'mo' && (next.textContent || '').trim() === '\u2061';
}

// <mrow> whose first and last children are stretchy fences (<mo fence="true">, as Word's brackets, LibreOffice's
// scalable brackets and MathLive write them) -> \left( ... \right). Returns null when the row is not a fenced
// group (so it is written as ordinary characters): no fence flags, a non-stretchy bracket (stretchy="false":
// Word with "stretch brackets" off, LibreOffice's plain brackets), or a bracket LaTeX cannot size.
function convertFencedRow(node) {
  const kids = getElementChildren(node);
  if (kids.length < 2) return null;
  const first = kids[0];
  const last = kids[kids.length - 1];
  const isFence = (k) => getLocalTagName(k) === 'mo' && k.getAttribute && k.getAttribute('fence') === 'true' && k.getAttribute('stretchy') !== 'false';
  if (!isFence(first) || !isFence(last)) return null;
  const open = FENCE_LATEX[(first.textContent || '').trim()];
  const close = FENCE_LATEX[(last.textContent || '').trim()];
  if (open === undefined || close === undefined) return null;
  let body = '';
  for (let i = 1; i < kids.length - 1; i++) body += convertNode(kids[i]);
  return `\\left${open}${body.trim()}\\right${close}`;
}

function wrapBase(baseNode) {
  if (!baseNode) return '';
  const tag = getLocalTagName(baseNode);
  const latex = convertNode(baseNode).trim();
  if (tag === 'mi' || tag === 'mn') return latex;
  if (latex.length === 1) return latex;
  return `{${latex}}`;
}
