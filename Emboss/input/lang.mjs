// The language of a passage: `segment.lang` (foreign-language material inside an English document).
//
// WHAT THE RULES SAY (read 25 Sep 2026; the June 2024 BANA changes read 26 Sep — see "Status" below):
//  - RUEB 2024 §13.1.1: any language other than English (Roman or non-Roman script) is foreign; §13.1.3: in doubtful cases
//    treat the word or phrase as foreign; §13.1.2: italics/bold/quotes often mark it; anglicised words are English.
//  - RUEB §13.2.1: do not use contractions in foreign words/phrases/passages, including English words inside the
//    expression — "Note: It is permissible to disregard this rule provided that there are appropriate braille authority
//    policies and guidelines in place". §13.2.2: no grade 1 indicators for foreign material in uncontracted braille.
//    §13.2.3: anglicised words are contracted. §13.5.1: occasional foreign words in English context use UEB accent
//    modifiers (§4.2), not foreign code signs; §13.5.3: no code switch indicators then.
//    Examples: "fouetté en tournant" ⠨⠶⠋⠕⠥⠑⠞⠞⠘⠌⠑ ⠑⠝ ⠞⠕⠥⠗⠝⠁⠝⠞⠨⠄ (13.1.2); "Prenons courage" ⠏⠗⠑⠝⠕⠝⠎ ⠉⠕⠥⠗⠁⠛⠑ (13.2.1).
//  - BANA Formats 2016 §1.2.3 / §1.16.2 (June 2024; was §1.16.3): BANA uses that §13.2.1 note — "Incidental foreign or
//    anglicized words ... are contracted, except for Old English which is uncontracted ... Use modified letter indicators
//    ... If a modification applies to a letter that would be part of a contraction, do not use the contraction."
//    §1.16.3 (new, June 2024): in foreign-language instructional texts and foreign literature, foreign material identified
//    by font attributes or print formatting is uncontracted, with foreign alphabet signs and UEB punctuation; §1.16.4:
//    unmarked foreign words in English context are contracted; the running head (t2 on) and page-1 title are foreign.
//    §21.6.3b: foreign glossary ENTRY words are uncontracted; §21.6.3c and Appendix G: foreign language symbols go on
//    the Special Symbols page. (references/_text/Changes_Foreign_Language_Sections_Braille_Formats_2016.txt.)
//  - UKAAF B004 says nothing about foreign material (so RUEB §13.2.1 applies in the UK unless UKAAF publishes a policy).
//
// Status (26 Sep 2026, K16): outside glossaries the formatter does not read `lang` by default: braille is byte-identical
// with or without it (1.16.2, and the transcriber's answer "usually contract normally unless doing so would obscure the
// non-English pronunciation"). The document option `foreignText` ("Foreign-language teaching text", BANA 1.16.3; off by
// default) reads it everywhere: format/document.mjs brails a segment with a non-English `lang` uncontracted, with the
// foreign alphabet signs of BANA Appendix D (Portuguese: World Braille Usage; see the K16 block there). Inside a glossary
// it is read even with the option off (BANA 21.6.3b, foreignRefSegments), and a foreign entry word's guide word follows
// (21.6.3d, 21.9.4). The readers RECORD it; the editor / NIMAS save keep it.
// EXCEPTION (K20, 25 Sep 2026): Old English (`lang` 'ang') is not part of that discussion — BANA 1.16.2 (June 2024)
// states unconditionally that it is uncontracted. finishLanguages (below) marks a surviving 'ang' segment
// `uncontracted: true`, which the formatter already treats specially (the existing grade-1 segment path); the
// default formatter never reads `lang`, so this is a reader-side decision, not an exception to the rule above.
//
// MODEL: `lang` lives on text SEGMENTS only (never on blocks): the BCP-47 primary subtag, lower case ('fr', 'es', 'la'),
// set only when it differs from the document's main language, and only when that main language is English (a whole
// document in another language is out of scope — the transcriber picks the braille code in Settings). A paragraph wholly
// in French is a paragraph whose every segment carries lang 'fr'. English variants (en-GB, en-US, …) are all English.
//
// NOISE (evidence from every real file in the repo, 25 Sep 2026): Word/LibreOffice tag runs with a PROOFING language, so
// most tags are not foreign passages: x-none / zxx ("no proofing", code, formulae), eastAsia/bidi slots on Latin text
// (en-GB / ar-SA / he-IL on English runs), en-GB vs en-US mixes, a German tag on the English word "and " and on a
// one-letter fragment "s" (custom-shape-tutorial.odt), Gutenberg's lang="en" boilerplate inside French/Spanish/German
// books. So: (1) only the tag matching the text's script is read (w:val / w:eastAsia / w:bidi, fo:language /
// style:language-asian / -complex, \lang / \langfe, lid / lidFE / lidBi); (2) x-none, zxx, und, mul, mis, private use
// and LCID 1024 ("no proofing") mean nothing; (3) inheriting the document default never makes text foreign; (4)
// finishLanguages (below) drops a tag on text with no letters, on part of a word, or on plainly English words, and drops
// every tag when tagged text is half the document or more (then the document is not mainly English).

const NOISE = new Set(['', 'x-none', 'zxx', 'und', 'mul', 'mis', 'none', 'qaa', 'xx']);

/** 'fr-FR' → 'fr'; noise / private use / malformed → null. */
export function primaryLang(tag) {
  if (tag == null) return null;
  const t = String(tag).trim().toLowerCase().replace(/_/g, '-');
  if (NOISE.has(t) || t.startsWith('x-') || t.startsWith('i-')) return null;
  const p = t.split('-')[0];
  if (!/^[a-z]{2,3}$/.test(p) || NOISE.has(p) || (p >= 'qaa' && p <= 'qtz')) return null;
  return p;
}

/** The foreign language of text tagged `tag` in a document whose main language is `main` (null main = English):
 *  null unless the document is English and the tag names another language. */
export function foreignLangOf(tag, main) {
  const p = primaryLang(tag);
  if (!p) return null;
  const m = primaryLang(main) || 'en';
  return m === 'en' && p !== 'en' ? p : null;
}

// ---- Windows LCIDs (Word .doc lid, RTF \lang) ----
const LCID_PRIMARY = {
  0x01: 'ar', 0x02: 'bg', 0x03: 'ca', 0x04: 'zh', 0x05: 'cs', 0x06: 'da', 0x07: 'de', 0x08: 'el', 0x09: 'en', 0x0A: 'es',
  0x0B: 'fi', 0x0C: 'fr', 0x0D: 'he', 0x0E: 'hu', 0x0F: 'is', 0x10: 'it', 0x11: 'ja', 0x12: 'ko', 0x13: 'nl', 0x14: 'no',
  0x15: 'pl', 0x16: 'pt', 0x17: 'rm', 0x18: 'ro', 0x19: 'ru', 0x1A: 'hr', 0x1B: 'sk', 0x1C: 'sq', 0x1D: 'sv', 0x1E: 'th',
  0x1F: 'tr', 0x20: 'ur', 0x21: 'id', 0x22: 'uk', 0x23: 'be', 0x24: 'sl', 0x25: 'et', 0x26: 'lv', 0x27: 'lt', 0x29: 'fa',
  0x2A: 'vi', 0x2B: 'hy', 0x2C: 'az', 0x2D: 'eu', 0x2F: 'mk', 0x32: 'tn', 0x34: 'xh', 0x35: 'zu', 0x36: 'af', 0x37: 'ka',
  0x38: 'fo', 0x39: 'hi', 0x3A: 'mt', 0x3C: 'ga', 0x3E: 'ms', 0x3F: 'kk', 0x41: 'sw', 0x43: 'uz', 0x45: 'bn', 0x46: 'pa',
  0x47: 'gu', 0x49: 'ta', 0x4A: 'te', 0x4B: 'kn', 0x4C: 'ml', 0x4E: 'mr', 0x52: 'cy', 0x56: 'gl', 0x5E: 'am', 0x61: 'ne',
  0x62: 'fy', 0x63: 'ps', 0x6E: 'lb', 0x76: 'la', 0x7E: 'br', 0x83: 'co', 0x91: 'gd',
};
const LCID_FULL = { 0x081A: 'sr', 0x0C1A: 'sr', 0x181A: 'sr', 0x1C1A: 'sr', 0x241A: 'sr', 0x281A: 'sr', 0x141A: 'bs', 0x201A: 'bs' };
/** A Windows language id → primary subtag; 0, 1024 (0x400, "no proofing") and the neutral/invariant ids → null. */
export function lcidLang(lcid) {
  const n = Number(lcid);
  if (!Number.isFinite(n) || n <= 0 || n === 0x400) return null;
  if (LCID_FULL[n]) return LCID_FULL[n];
  const prim = n & 0x3FF;
  if (!prim || prim === 0x7F) return null;
  return LCID_PRIMARY[prim] || null;
}

// ---- script of a run: which of the three language slots applies ----
const CJK_RE = /[ᄀ-ᇿ⺀-⿿぀-ヿ㄀-鿿가-힯豈-﫿ｦ-ﾟ]/;
const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
/** 'ea' (East Asian), 'bidi' (Hebrew/Arabic script, or a run marked right-to-left / complex script) or 'latin'. */
export function scriptSlot(text, rtl = false) {
  const t = String(text ?? '');
  if (CJK_RE.test(t)) return 'ea';
  if (rtl || RTL_RE.test(t)) return 'bidi';
  return 'latin';
}

// ---- DOCX (w:lang w:val / w:eastAsia / w:bidi on rPr, character styles, paragraph styles, docDefaults) ----
const kids = (el, W, ln) => [...(el?.childNodes || [])].filter((c) => c.nodeType === 1 && c.namespaceURI === W && c.localName === ln);
const kid = (el, W, ln) => kids(el, W, ln)[0] || null;
const wAttr = (el, W, name) => (el && el.getAttributeNS ? (el.getAttributeNS(W, name) ?? null) : null) || null;
const onToggle = (el, W) => !!el && !/^(0|false|off)$/i.test(wAttr(el, W, 'val') || '');
function docxLangAttrs(rPr, W) {
  const l = kid(rPr, W, 'lang');
  return l ? { latin: wAttr(l, W, 'val'), ea: wAttr(l, W, 'eastAsia'), bidi: wAttr(l, W, 'bidi') } : {};
}
/** Built once per .docx from styles.xml (null when there is none). */
export function docxLangContext(stylesDoc, W) {
  const ctx = { main: null, defaults: {}, styles: new Map(), defaultPara: null };
  if (stylesDoc && stylesDoc.getElementsByTagNameNS) {
    const dd = stylesDoc.getElementsByTagNameNS(W, 'docDefaults')[0];
    ctx.defaults = docxLangAttrs(kid(kid(dd, W, 'rPrDefault'), W, 'rPr'), W);
    for (const st of stylesDoc.getElementsByTagNameNS(W, 'style')) {
      const id = wAttr(st, W, 'styleId');
      if (!id) continue;
      const type = wAttr(st, W, 'type') || 'paragraph';
      ctx.styles.set(id.toLowerCase(), { type, basedOn: wAttr(kid(st, W, 'basedOn'), W, 'val'), lang: docxLangAttrs(kid(st, W, 'rPr'), W) });
      if (type === 'paragraph' && /^(1|true|on)$/i.test(wAttr(st, W, 'default') || '')) ctx.defaultPara = id.toLowerCase();
    }
  }
  ctx.main = docxStyleSlot(ctx, ctx.defaultPara, 'latin') || ctx.defaults.latin || null;
  return ctx;
}
function docxStyleSlot(ctx, id, slot) {
  const seen = new Set();
  for (let cur = id ? String(id).toLowerCase() : null; cur && !seen.has(cur) && seen.size < 20; ) {
    seen.add(cur);
    const st = ctx.styles.get(cur);
    if (!st) break;
    if (st.lang[slot]) return st.lang[slot];
    cur = st.basedOn ? String(st.basedOn).toLowerCase() : null;
  }
  return null;
}
/** The foreign language of one w:r (null when English, untagged, noise, or the document is not English). */
export function docxRunLang(ctx, r, p, W, text) {
  if (!ctx) return null;
  const rPr = kid(r, W, 'rPr');
  const slot = scriptSlot(text, onToggle(kid(rPr, W, 'rtl'), W) || onToggle(kid(rPr, W, 'cs'), W));
  const direct = docxLangAttrs(rPr, W)[slot];
  if (direct) return foreignLangOf(direct, ctx.main);
  const cs = docxStyleSlot(ctx, wAttr(kid(rPr, W, 'rStyle'), W, 'val'), slot);
  if (cs) return foreignLangOf(cs, ctx.main);
  const pPr = kid(p, W, 'pPr');
  const ps = docxStyleSlot(ctx, wAttr(kid(pPr, W, 'pStyle'), W, 'val') || ctx.defaultPara, slot);
  return ps ? foreignLangOf(ps, ctx.main) : null;           // docDefaults: the document's own language, never foreign
}

// ---- ODT (fo:language / style:language-asian / style:language-complex, through style:parent-style-name) ----
const ODT_STYLE_NS = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
const ODT_FO_NS = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0';
const ODT_TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
function odtLangAttrs(styleEl) {
  for (const c of styleEl.childNodes || []) {
    if (c.nodeType !== 1 || c.localName !== 'text-properties') continue;
    return { latin: c.getAttributeNS(ODT_FO_NS, 'language') || null, ea: c.getAttributeNS(ODT_STYLE_NS, 'language-asian') || null, bidi: c.getAttributeNS(ODT_STYLE_NS, 'language-complex') || null };
  }
  return {};
}
export function odtLangContext(contentDoc, stylesDoc) {
  const ctx = { main: null, defaults: {}, styles: new Map() };
  for (const d of [contentDoc, stylesDoc]) {
    if (!d || !d.getElementsByTagNameNS) continue;
    for (const st of d.getElementsByTagNameNS(ODT_STYLE_NS, 'style')) {
      const name = st.getAttributeNS(ODT_STYLE_NS, 'name');
      if (name && !ctx.styles.has(name)) ctx.styles.set(name, { parent: st.getAttributeNS(ODT_STYLE_NS, 'parent-style-name') || null, lang: odtLangAttrs(st) });
    }
    for (const ds of d.getElementsByTagNameNS(ODT_STYLE_NS, 'default-style')) {
      if (ds.getAttributeNS(ODT_STYLE_NS, 'family') === 'paragraph') ctx.defaults = odtLangAttrs(ds);
    }
  }
  ctx.main = ctx.defaults.latin || null;
  return ctx;
}
function odtStyleSlot(ctx, name, slot) {
  const seen = new Set();
  for (let cur = name; cur && !seen.has(cur) && seen.size < 20; ) {
    seen.add(cur);
    const st = ctx.styles.get(cur);
    if (!st) break;
    if (st.lang[slot]) return st.lang[slot];
    cur = st.parent;
  }
  return null;
}
/** The foreign language of a text node inside an ODT paragraph/heading: the nearest text:span / text:p / text:h whose
 *  style (or a parent style) names a language for the text's script. */
export function odtTextLang(ctx, textNode, stopAt = null) {
  if (!ctx) return null;
  const slot = scriptSlot(textNode.nodeValue);
  for (let el = textNode.parentNode; el && el.nodeType === 1; el = el.parentNode) {
    const name = el.getAttributeNS ? el.getAttributeNS(ODT_TEXT_NS, 'style-name') : null;
    const v = name ? odtStyleSlot(ctx, name, slot) : null;
    if (v) return foreignLangOf(v, ctx.main);
    if (el === stopAt || el.localName === 'p' || el.localName === 'h') break;
  }
  return null;
}

// ---- HTML / XHTML / EPUB / DTBook (lang, xml:lang) ----
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
/** The element's own lang / xml:lang attribute, or null. */
export function langAttrOf(el) {
  if (!el || el.nodeType !== 1 || !el.getAttribute) return null;
  const v = el.getAttribute('xml:lang') || el.getAttribute('lang') || (el.getAttributeNS ? el.getAttributeNS(XML_NS, 'lang') : null);
  return v || null;
}
/** The nearest lang/xml:lang at or above `el`, or null. */
export function inheritedLangAttr(el) {
  for (let n = el; n && n.nodeType === 1; n = n.parentNode) { const v = langAttrOf(n); if (v) return v; }
  return null;
}
// parseHtml / parseDtbook are synchronous: the document's main language for the parse in progress.
const markupState = { main: null };
export function setMarkupMainLang(main) { markupState.main = main || null; return markupState.main; }
/** The foreign language of text inside element `el` (the parse in progress). */
export function markupForeignLang(el) {
  if (primaryLang(markupState.main) && primaryLang(markupState.main) !== 'en') return null;
  return foreignLangOf(inheritedLangAttr(el), markupState.main);
}
/** True if `node` or anything inside it is in a foreign language (it must then keep its segments). */
export function markupHasForeignLang(node) {
  if (!node || node.nodeType !== 1 || (primaryLang(markupState.main) && primaryLang(markupState.main) !== 'en')) return false;
  if (markupForeignLang(node)) return true;
  const all = node.getElementsByTagName ? node.getElementsByTagName('*') : [];
  for (let i = 0; i < all.length; i++) if (foreignLangOf(langAttrOf(all[i]), markupState.main)) return true;
  return false;
}
/** A synthetic wrapper built from clones of `source`'s children keeps `source`'s language. */
export function keepLangOn(wrapper, source) {
  const v = inheritedLangAttr(source);
  if (v && wrapper && wrapper.setAttribute && !langAttrOf(wrapper)) wrapper.setAttribute('lang', v);
  return wrapper;
}

// ---- Markdown: inline HTML `<span lang="fr">…</span>` (and <i>/<em>/<b>/<strong>/<u>/<q>/<cite> with lang) ----
const MD_LANG_OPEN_RE = /<(span|i|em|b|strong|u|q|cite|bdi|bdo)\b([^<>]*?)\blang\s*=\s*(["'])([^"'<>]*)\3([^<>]*)>/i;
const MD_TF = { i: 1, em: 1, u: 2, b: 4, strong: 4 };
/** Apply lang-bearing inline HTML tags in Markdown text segments (other HTML is left as it was). `main` is the
 *  document language (YAML `lang:`), null = English. Returns a new segments array. */
export function markdownInlineLang(segments, main = null) {
  if (!Array.isArray(segments) || !segments.some((s) => s && s.type === 'text' && /<[a-z][^<>]*\blang\s*=|<\//i.test(s.text || ''))) return segments;
  const out = [];
  const stack = [];                                          // [{ tag, lang, tf }]
  const cur = () => stack.reduce((a, e) => ({ lang: e.lang !== undefined ? e.lang : a.lang, tf: a.tf | e.tf }), { lang: null, tf: 0 });
  const push = (seg, text) => {
    if (!text) return;
    const c = cur();
    const n = { ...seg, text };
    if (c.tf) n.tf = (n.tf || 0) | c.tf;
    if (c.lang) n.lang = c.lang;
    out.push(n);
  };
  for (const seg of segments) {
    if (!seg || seg.type !== 'text' || typeof seg.text !== 'string') { out.push(seg); continue; }
    let rest = seg.text;
    while (rest) {
      const open = MD_LANG_OPEN_RE.exec(rest);
      const top = stack[stack.length - 1];
      const closeRe = top ? new RegExp(`</${top.tag}\\s*>`, 'i') : null;
      const close = closeRe ? closeRe.exec(rest) : null;
      if (close && (!open || close.index < open.index)) {
        // a literal (non-foreign) element's closing tag stays in the text, exactly as Markdown left it before
        push(seg, rest.slice(0, close.index) + (top.literal ? close[0] : ''));
        stack.pop();
        rest = rest.slice(close.index + close[0].length);
      } else if (open) {
        const tag = open[1].toLowerCase();
        const lang = foreignLangOf(open[4], main);
        push(seg, rest.slice(0, open.index) + (lang ? '' : open[0]));   // lang="en" (or noise): the tags are left as they were
        stack.push(lang ? { tag, lang, tf: MD_TF[tag] || 0 } : { tag, literal: true, tf: 0 });
        rest = rest.slice(open.index + open[0].length);
      } else { push(seg, rest); rest = ''; }
    }
  }
  return out;
}

// ---- after a reader: drop noise, keep genuine foreign passages ----
// Distinctively English function words: a "foreign" tag on nothing but these is a proofing-language accident ("and " tagged
// German in custom-shape-tutorial.odt). Words that are also common words in French, Spanish, Italian, Portuguese, German,
// Dutch, Latin, the Scandinavian languages or Polish (a, i, in, on, no, me, an, as, so, do, is, was, will, of, to, for, by,
// at, or, he, her, my, also, over, under, most, …) are deliberately NOT listed: dropping a tag is the safe direction, but
// a genuine "no me gusta" must survive.
const ENGLISH_ONLY = new Set(('the and with that this these those which from have has had were been being would could should they their them there '
  + 'what when where who why how you your she his him our not but are it its be if we can does did all one up out about into than then only just '
  + 'very some any more other such each every because while after before').split(' '));
const WORD_RE = /\p{L}+(?:['’]\p{L}+)*/gu;
const LETTER_RE = /\p{L}/u;
function plainlyEnglish(text) {
  const toks = String(text).toLowerCase().match(WORD_RE) || [];
  if (!toks.length) return false;
  const en = toks.filter((t) => ENGLISH_ONLY.has(t)).length;
  return en === toks.length || (en >= 2 && en / toks.length >= 0.25);
}
const isTextSeg = (s) => !!s && typeof s === 'object' && (s.type === 'text' || s.type === undefined) && typeof s.text === 'string';
const letters = (s) => (String(s ?? '').match(/\p{L}/gu) || []).length;
const SKIP_KEYS = new Set(['resources', 'bytes', 'data', 'mathml']);

/** Visit every segments-like array in the model: fn(owner, key, array). */
function eachSegmentArray(root, fn) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (!v || typeof v !== 'object' || seen.has(v) || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    for (const k of Object.keys(v)) {
      if (SKIP_KEYS.has(k)) continue;
      const val = v[k];
      if (Array.isArray(val) && val.some((x) => isTextSeg(x) && 'lang' in x)) fn(v, k, val);
      walk(val);
    }
  };
  walk(root);
}
function countLetters(root) {
  let total = 0;
  const seen = new WeakSet();
  const walk = (v) => {
    if (!v || typeof v !== 'object' || seen.has(v) || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) { if (typeof x === 'string') total += letters(x); else walk(x); } return; }   // plain table cells, verse lines
    if (typeof v.text === 'string' && !Array.isArray(v.segments) && !Array.isArray(v.items)) total += letters(v.text);
    for (const k of Object.keys(v)) if (!SKIP_KEYS.has(k) && k !== 'text') walk(v[k]);
  };
  walk(root);
  return total;
}
const sameProps = (a, b) => {
  const ka = Object.keys(a).filter((k) => k !== 'text'), kb = Object.keys(b).filter((k) => k !== 'text');
  return ka.length === kb.length && ka.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
};

/** Finish a reader's language tags in place (and return the model): normalise each `lang` to a primary subtag, drop
 *  English/noise tags, drop tags on letterless text, on part of a word, or on plainly English words, drop them all
 *  when tagged text is half the document or more, then re-join the runs a dropped tag had split (and give a paragraph
 *  or heading left with one plain run its plain `text` back, as the reader would have built it). */
export function finishLanguages(model) {
  if (!model || typeof model !== 'object') return model;
  const found = [];
  eachSegmentArray(model.blocks || model, (owner, key, arr) => found.push({ owner, key, arr }));
  if (!found.length) return model;
  let tagged = 0;
  const touched = new WeakSet();
  const drop = (s) => { if (s && 'lang' in s) { delete s.lang; touched.add(s); } };
  for (const { arr } of found) {
    for (const s of arr) if (isTextSeg(s) && 'lang' in s) { const p = primaryLang(s.lang); if (!p || p === 'en') drop(s); else s.lang = p; }
    // one "span" = consecutive text segments with the same language
    for (let i = 0; i < arr.length; ) {
      const s = arr[i];
      if (!isTextSeg(s) || !s.lang) { i++; continue; }
      let j = i; while (j + 1 < arr.length && isTextSeg(arr[j + 1]) && arr[j + 1].lang === s.lang) j++;
      const text = arr.slice(i, j + 1).map((x) => x.text).join('');
      const prev = i > 0 && isTextSeg(arr[i - 1]) ? arr[i - 1].text : '';
      const next = j + 1 < arr.length && isTextSeg(arr[j + 1]) ? arr[j + 1].text : '';
      const midWord = (LETTER_RE.test(prev.slice(-1)) && LETTER_RE.test(text[0] || '')) || (LETTER_RE.test(text.slice(-1)) && LETTER_RE.test(next[0] || ''));
      if (!LETTER_RE.test(text) || midWord || plainlyEnglish(text)) for (let k = i; k <= j; k++) drop(arr[k]);
      else tagged += letters(text);
      i = j + 1;
    }
  }
  if (tagged && tagged * 2 >= countLetters(model.blocks || model)) for (const { arr } of found) for (const s of arr) if (isTextSeg(s)) drop(s);
  // K20 / BANA 1.16.2 (June 2024): "any language other than modern English ... Old English and Middle
  // English" is foreign, "except for Old English which is uncontracted". Unlike the general
  // foreign-language contraction question (still under discussion — see the file header above), BANA
  // is explicit and unconditional about Old English, so it is the one language this reader-finishing
  // step acts on: any segment that survived tagging as 'ang' (ISO 639-2 Old English) also gets
  // `uncontracted: true`, reusing the formatter's EXISTING grade-1 segment path (document.mjs
  // groupSegments / segmentsToBraille) rather than teaching the formatter to read `lang` itself — the
  // formatter still never looks at `lang`, so the "byte-identical" invariant above is unaffected for
  // every OTHER language.
  for (const { arr } of found) for (const s of arr) if (isTextSeg(s) && s.lang === 'ang') s.uncontracted = true;
  for (const { owner, key, arr } of found) {
    let changed = false;
    for (let i = arr.length - 1; i > 0; i--) {
      const a = arr[i - 1], b = arr[i];
      if (isTextSeg(a) && isTextSeg(b) && (touched.has(a) || touched.has(b)) && !a.lang && !b.lang && sameProps(a, b)) {
        arr.splice(i - 1, 2, { ...a, text: a.text + b.text });
        touched.add(arr[i - 1]);
        changed = true;
      }
    }
    if (key === 'segments' && (owner.type === 'para' || owner.type === 'heading' || (owner.type === undefined && typeof owner.text === 'string')) && arr.length === 1 && isTextSeg(arr[0]) && touched.has(arr[0])
      && Object.keys(arr[0]).every((k) => k === 'type' || k === 'text')) {
      const t = arr[0].text;
      if (typeof owner.text !== 'string') owner.text = t.includes('\n') ? t : t.replace(/\s+/g, ' ').trim();
      delete owner.segments;
    } else if (changed) owner[key] = arr;
  }
  return model;
}

/** Every foreign-language span in a model: [{ lang, text }] (for tests, audits and reports). */
export function foreignSpans(model) {
  const out = [];
  eachSegmentArray(model && (model.blocks || model), (owner, key, arr) => {
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      if (!isTextSeg(s) || !s.lang) continue;
      const last = out[out.length - 1];
      if (last && last.arr === arr && last.end === i && last.lang === s.lang) { last.text += s.text; last.end = i + 1; }
      else out.push({ lang: s.lang, text: s.text, arr, end: i + 1 });
    }
  });
  return out.map(({ lang, text }) => ({ lang, text }));
}
