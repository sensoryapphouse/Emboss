// Word 97–2003 binary documents (.doc / .dot) → the Emboss document model.
//
// Produces the same model parseDocx (parse.mjs) builds for a .docx — title / heading / para /
// list / table / graphic / footnote / math blocks, with the same segment shapes (emphasis tf
// bits, sub/superscript markers, links, note references, equations) — so the formatter,
// editor, NIMAS export and braille see no difference between a .doc and its .docx twin.
// Where parseDocx makes a deliberate choice (headers/footers and comments ignored, first
// table row = column headings, list numbering restarted per list block, whole-paragraph
// bold from a paragraph style not read as emphasis, …) this reader makes the same one.
//
// Format: Microsoft's published [MS-DOC] specification (the Word 97–2003 binary format),
// with [MS-ODRAW] for pictures/shapes and [MS-OLEPS] for the summary information. The
// container is an OLE2 compound file, read with cfb.mjs. LibreOffice (sw/source/filter/ww8),
// Apache POI HWPF, antiword and wvWare were consulted for real-file behaviour, not copied.
//
// Files:
//   doc-fib.mjs    FIB, piece table, text, summary information, binary helpers
//   doc-props.mjs  SPRMs, stylesheet, formatting FKPs, list tables, font table
//   doc-art.mjs    pictures (PICF / OfficeArt BLIPs), floating shapes, text boxes, OLE objects
//   doc.mjs        this file: paragraphs, fields, notes, tables → model blocks
//
// API: parseDoc(arrayBuffer) → Promise<model>. Throws an Error with a user-facing message
// for a Word 6/95 file, an encrypted file, or a file that is not a Word document at all.

import { readCfb, isCfb } from './cfb.mjs';
import { DocError, readFib, readClx, buildText, makeCpMapper, subdocRanges, readSummaryInfo, readPlc, reader, MSG_ENCRYPTED, MSG_OLD_WORD } from './doc-fib.mjs';
import { forEachSprm, applyChpSprm, newChp, applyPapGrpprl, readTap, readStylesheet, makeStyleResolver, readChpxRuns, readPapxRuns, findRun, readLists, readFonts, brcVisible } from './doc-props.mjs';
import { readArt, inlinePicture, oleObjectInfo, textboxRanges } from './doc-art.mjs';
import { SCRIPT_MARKS } from '../format/text-style.mjs';
import { cellFromSegments } from '../format/cell-markup.mjs';
import { isNonDotBulletMarker, isCustomBulletMarker } from './nimas-export.mjs';
import { mathmlToLatex } from '../engine/mathml-to-latex.mjs';
import { classifyTable } from './table-kind.mjs';
import { equationNativeToMathML } from './mtef.mjs';
import { lcidLang, scriptSlot, foreignLangOf, finishLanguages } from './lang.mjs';
import { metafileToSvg, dibToPngBytes } from './metafile.mjs';
import * as parseMod from './parse.mjs';

const TF_ITALIC = 1, TF_UNDERLINE = 2, TF_BOLD = 4, TF_SCRIPT = 8;   // K5: TF_SCRIPT, matching parse.mjs/cell-markup.mjs/engine TYPEFORM.script=8

// ---------------------------------------------------------------------------------------
// Shared wording with parse.mjs's .docx reader (kept identical on purpose).
// ---------------------------------------------------------------------------------------
const LEGACY_EQUATION_PLACEHOLDER = 'equation not transcribed';
const LEGACY_EQUATION_PROGID_RE = /^equation(\.\d+|\.dsmt\d*)?$/i;

// Symbol-font glyphs → Unicode: parse.mjs's own tables and rules (wordSymGlyph, the .docx w:sym reader) — one copy, so a correction
// there (import fix list #36: the arrows, the whole Symbol table, an unmapped symbol = U+FFFD, named in the load warning) reaches
// the .doc reader too. A .doc may store the bare byte (< 0x100) of a Wingdings character; its slot is 0xF000 + byte.
function symGlyph(font, code) {
  const fontLower = String(font || '').trim().toLowerCase();
  const c = fontLower === 'wingdings' && code > 0 && code < 0x100 ? 0xF000 + code : code;
  return parseMod.wordSymGlyph(font, c > 0 ? c.toString(16) : '0');
}

// List markers: the same rules as parse.mjs's listMarker / wordBulletGlyph / formatCounter.
const WORD_BULLET_GLYPHS = { '': '■', '': '□', '': '✓', 'o': '○' };
// IMP-W7 (Paul, 30 Sep 2026; import fix list row 1, the same rules as parse.mjs's .docx wordBulletGlyph, which is not exported): the print
// bullet a level stands for. The bullets that already have a UEB sign (■ □ ✓ ○ ...) and any other single symbol that is not dot-like -
// an arrow, an en dash, a star ... - KEEP their glyph as the item's marker, so the formatter can give it a transcriber-defined symbol
// (BANA 8.6.2a) listed on the Special Symbols page. What stays the ordinary dot: the dot-like shapes (Symbol U+F0B7, the bullet, the
// middle dot, the black circle ...) and a symbol-font shape with no Unicode form in the Word reader's tables. A Wingdings character is
// written as U+F0xx in the level's number text (Word 2000 and later) or as the bare byte (older files): both are that font's shape,
// found through the Word reader's own Wingdings table (parseMod.wordSymGlyph, as every other .doc symbol is).
function wordBulletGlyph(ch, font) {
  let t = String(ch ?? '').trim();
  if (isNonDotBulletMarker(t)) return t;                       // a literal ■ □ ○ ▲ ✓ … in the numbering definition
  if (Object.prototype.hasOwnProperty.call(WORD_BULLET_GLYPHS, t)) return WORD_BULLET_GLYPHS[t];
  if (String(font || '').trim().toLowerCase() === 'wingdings' && t.length === 1) {
    let code = t.charCodeAt(0);
    if (code >= 0x20 && code < 0x100) code += 0xF000;
    if (code >= 0xF020 && code <= 0xF0FF) {
      // an unmapped bullet shape is the ordinary dot, silently: it must not be counted in the load warning about unknown symbols
      const prevLog = parseMod.setDocxSymbolLog(null);
      let g;
      try { g = parseMod.wordSymGlyph(font, code.toString(16)); } finally { parseMod.setDocxSymbolLog(prevLog); }
      if (g === '\uFFFD') return '•';
      t = g;
      if (isNonDotBulletMarker(t)) return t;
    }
  }
  t = t.replace(/\uFE0F/g, '');
  return isCustomBulletMarker(t) ? t : '•';
}
// A list level's own font (its CHPX: sprmCRgFtc0, or the font of a sprmCSymbol), by name — the font a symbol bullet is drawn in.
const lvlFontCache = new WeakMap();
function lvlFontName(ctx, lv) {
  if (!lv || !lv.chpx || !(lv.chpx.end > lv.chpx.start)) return null;
  if (lvlFontCache.has(lv.chpx)) return lvlFontCache.get(lv.chpx);
  const chp = newChp();
  try { forEachSprm(ctx.table, lv.chpx.start, lv.chpx.end, (sprm, o, len) => applyChpSprm(chp, sprm, ctx.table, o, len, chp)); } catch { /* a damaged level: no font */ }
  const idx = chp.symbol ? chp.symbol.ftc : chp.ftc;
  const name = idx != null && ctx.fonts[idx] ? ctx.fonts[idx] : null;
  lvlFontCache.set(lv.chpx, name);
  return name;
}
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
    default: return null;
  }
}
// level(ilfo, ilvl) → { numFmt, lvlText, startAt, fLegal } | null
// `counters` lives for the whole document (a list interrupted by a paragraph, table or
// picture carries on counting, as the .docx reader's docx-fix item 2b), keyed by list (ilfo)
// and level. Legal numbering (LVLF.fLegal) shows decimal numerals; a deeper level restarts
// when a shallower one advances unless LVLF.fNoRestart limits that to levels above
// ilvlRestartLim ([MS-DOC] 2.9.150).
function listMarker(level, counters, ilfo, ilvl, fontOf = null) {
  if (!level || !ilfo) return null;
  const lv = level(ilfo, ilvl);
  if (lv && lv.numFmt === 'bullet') return wordBulletGlyph(lv.lvlText, fontOf ? fontOf(lv) : null);
  if (!lv || formatCounter(1, lv.fLegal ? 'decimal' : lv.numFmt) == null) return null;
  const key = (i) => `${ilfo}:${i}`;
  counters.set(key(ilvl), counters.has(key(ilvl)) ? counters.get(key(ilvl)) + 1 : lv.startAt);
  for (let j = ilvl + 1; j <= 8; j++) {
    const jlv = level(ilfo, j);
    if (jlv && jlv.fNoRestart && ilvl >= (jlv.ilvlRestartLim || 0)) continue;
    counters.delete(key(j));
  }
  return (lv.lvlText || `%${ilvl + 1}.`).replace(/%([1-9])/g, (_, d) => {
    const li = Number(d) - 1;
    const llv = level(ilfo, li) || lv;
    const val = counters.has(key(li)) ? counters.get(key(li)) : (llv.startAt ?? 1);
    return formatCounter(val, lv.fLegal ? 'decimal' : llv.numFmt) ?? String(val);   // legal numbering: every number in THIS level's text is Arabic
  });
}

// The .docx writer's (web/docx-export.mjs) own paragraph/character styles, by NAME here
// (a .doc keeps style names, not WordprocessingML ids) — same table as parse.mjs.
const EMBOSS_PARA_STYLES = {
  embosscaption: { type: 'caption' },
  embossbyline: { type: 'attribution' },
  embossnote: { type: 'note' },
  embossnoterequired: { type: 'note', render: 'required' },
  embossnoteoptional: { type: 'note', render: 'optional' },
  embossnotetabletn: { type: 'note', kind: 'tabletn' },
  embossfootnote: { type: 'footnote' },
  embossverse: { type: 'play', subtype: 'verse', style: 'verse', fromPoem: true },
};
const EMBOSS_RUN_FLAGS = { embosslinenumber: 'linenum', embossuncontracted: 'uncontracted' };
const styleKey = (name) => String(name || '').toLowerCase().replace(/\s+/g, '');

// Built-in style identifiers ([MS-DOC] 2.9.260 sti): language-independent, so a German
// "Überschrift 1" or French "Titre 1" is still sti 1.
const STI_TITLE = 62, STI_SUBTITLE = 74, STI_CAPTION = 34, STI_HYPERLINK = 85, STI_FOLLOWED_HYPERLINK = 86;

// ---------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------
function toU8(buf) {
  if (buf instanceof Uint8Array) return buf;
  if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
  if (buf && buf.buffer instanceof ArrayBuffer) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  if (typeof buf === 'string') return new TextEncoder().encode(buf);
  throw new Error('This file could not be read as a Word document.');
}

// A ".doc" is very often not a Word 97 binary file at all: Word's own "Save as Web Page"/RTF,
// a renamed .docx, or plain text. Route those to the reader that understands them.
async function sniffNonCfb(u8) {
  const head = new TextDecoder('latin1').decode(u8.subarray(0, 512)).replace(/^﻿|^\xEF\xBB\xBF/, '');
  const t = head.trimStart();
  if (/^\{\\rtf/i.test(t)) return parseMod.parseRtf(decodeText(u8));
  if (u8[0] === 0x50 && u8[1] === 0x4B) return parseMod.parseDocx(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
  if (/^<(\?xml|!doctype html|html|head|body|meta)/i.test(t) || /<html[\s>]/i.test(head)) return parseMod.parseHtml(decodeText(u8));
  // These are hard failures — the file cannot be read at all — like every other throw in this
  // module (see parseDoc's own doc comment above); userError()'s `.userFacing` flag is defined
  // below but hoisted, so it's callable here.
  if ((u8[0] === 0xDB || u8[0] === 0x9B) && u8[1] === 0xA5) throw userError(MSG_OLD_WORD);   // Word 2.0 / Word for DOS-era binary
  if (u8[0] === 0x31 && u8[1] === 0xBE) throw userError(MSG_OLD_WORD);                      // Word for DOS / Write
  // Anything that decodes as text is read as plain text; binary junk is refused.
  const sample = u8.subarray(0, 4096);
  let bad = 0;
  for (const b of sample) if (b < 9 || (b > 13 && b < 32)) bad++;
  if (sample.length && bad / sample.length < 0.02) return parseMod.parseText(decodeText(u8));
  throw userError('This file is not a Word document that Emboss can read (it is not a Word 97–2003 .doc file).');
}
function decodeText(u8) {
  if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch { return new TextDecoder('windows-1252').decode(u8); }
}

// True when `bytes` is a Word 97–2003 binary document (a compound file with a WordDocument
// stream) — e.g. a .doc that was renamed or saved with a .docx name. Never throws.
export function isWordBinary(bytes) {
  try {
    const u8 = toU8(bytes);
    return isCfb(u8) && !!readCfb(u8).getStream('WordDocument');
  } catch { return false; }
}

export async function parseDoc(arrayBuffer) {
  const u8 = toU8(arrayBuffer);
  if (!isCfb(u8)) return sniffNonCfb(u8);
  try {
    return await parseCfbDoc(u8);
  } catch (e) {
    if (e && e.userFacing) throw e;
    if (e instanceof DocError && (e.code === 'old-word' || e.code === 'encrypted')) throw userError(e.message);
    throw userError('This Word document is damaged and could not be read (' + (e && e.message ? e.message : String(e)) + ').');
  }
}
function userError(message) { const e = new Error(message); e.userFacing = true; return e; }

async function parseCfbDoc(u8) {
  const cfb = readCfb(u8);
  const wd = cfb.getStream('WordDocument');
  if (!wd) {
    const has = (p) => { try { return !!cfb.getStream(p); } catch { return false; } };
    if (has('EncryptionInfo') || has('EncryptedPackage')) throw userError(MSG_ENCRYPTED);
    if (has('Workbook') || has('Book')) throw userError('This file is an Excel workbook, not a Word document.');
    if (has('PowerPoint Document')) throw userError('This file is a PowerPoint presentation, not a Word document.');
    throw userError('This file is not a Word document that Emboss can read (it has no Word text stream).');
  }
  return buildModel(cfb, wd);
}

// ---------------------------------------------------------------------------------------
// Document context
// ---------------------------------------------------------------------------------------
function openDoc(cfb, wd) {
  const fib = readFib(wd);
  const tableName = fib.fWhichTblStm ? '1Table' : '0Table';
  const table = cfb.getStream(tableName);
  if (!table) throw new DocError(`the ${tableName} stream is missing`);
  const data = cfb.getStream('Data') || null;
  const clx = fib.fcLcb.Clx;
  if (!clx || !clx.lcb) throw new DocError('the piece table is missing');
  const { prcs, pieces } = readClx(table, clx.fc, clx.lcb);
  const { text } = buildText(wd, pieces);
  const mapper = makeCpMapper(pieces);
  const stsh = fib.fcLcb.Stshf ? readStylesheet(table, fib.fcLcb.Stshf.fc, fib.fcLcb.Stshf.lcb) : { styles: [], bytes: table };
  const styles = makeStyleResolver(stsh, data);
  const chpxRuns = fib.fcLcb.PlcfBteChpx ? readChpxRuns(wd, table, fib.fcLcb.PlcfBteChpx.fc, fib.fcLcb.PlcfBteChpx.lcb) : [];
  const papxRuns = fib.fcLcb.PlcfBtePapx ? readPapxRuns(wd, table, fib.fcLcb.PlcfBtePapx.fc, fib.fcLcb.PlcfBtePapx.lcb) : [];
  const lists = readLists(table, fib);
  const fonts = readFonts(table, fib);
  const subs = subdocRanges(fib, text.length);
  const ctx = { cfb, wd, table, data, fib, prcs, pieces, text, mapper, styles, chpxRuns, papxRuns, lists, fonts, subs, chpCache: new Map(), oleCache: new Map(), picCache: new Map(), warnings: [] };
  ctx.art = readArt(ctx);
  return ctx;
}

// The grpprl a piece's Prm points at (Prm1 → the CLX's Prc array). A Prm0 (a single
// one-byte SPRM from a fast save) is not applied — Word 2000 and later never write one.
function prmGrpprl(ctx, piece) {
  if (!piece || !(piece.prm & 1)) return null;
  const g = ctx.prcs[piece.prm >> 1];
  return g && g.length ? g : null;
}

// ---- paragraphs of a CP range ----
// Returns [{ cpStart, cpEnd (exclusive, includes the mark), mark, pap, papx, piece }].
function paragraphsIn(ctx, start, end) {
  const out = [];
  const { text, mapper } = ctx;
  let s = start;
  for (let cp = start; cp < end; cp++) {
    const c = text.charCodeAt(cp);
    let isEnd = c === 0x0D || c === 0x07;
    if (!isEnd && c === 0x0C) {                                // a section break ends a paragraph; a page break does not
      const m = mapper.fcOf(cp);
      const run = m && findRun(ctx.papxRuns, m.fc);
      isEnd = !!(run && run.fcEnd === m.fc + (m.piece.compressed ? 1 : 2));
    }
    // A paragraph mark deleted as a tracked change joins the paragraph to the next one (as
    // accepting the change would); the last paragraph of the range always ends.
    if (isEnd && c === 0x0D && cp !== end - 1 && markDeleted(ctx, cp)) isEnd = false;
    if (!isEnd && cp !== end - 1) continue;
    out.push(makePara(ctx, s, cp + 1));
    s = cp + 1;
  }
  return out;
}

// True when the character at `cp` carries a tracked deletion (sprmCFRMarkDel) directly.
function markDeleted(ctx, cp) {
  const m = ctx.mapper.fcOf(cp);
  if (!m) return false;
  let del = false;
  const r = findRun(ctx.chpxRuns, m.fc);
  if (r && r.end > r.start) forEachSprm(ctx.wd, r.start, r.end, (sprm, o) => { if (sprm === 0x0800) del = !!ctx.wd[o]; });
  const g = prmGrpprl(ctx, m.piece);
  if (g) forEachSprm(g, 0, g.length, (sprm, o) => { if (sprm === 0x0800) del = !!g[o]; });
  return del;
}

function makePara(ctx, cpStart, cpEnd) {
  const markCp = cpEnd - 1;
  const m = ctx.mapper.fcOf(markCp);
  const run = m ? findRun(ctx.papxRuns, m.fc) : null;
  const istd = run ? run.istd : 0;
  const pap = { ...ctx.styles.pap(istd) };
  pap.istd = istd;
  let directOutLvl = null;
  // A paragraph's OWN direct formatting carrying an explicit sprmPIlfo record at all -- even
  // one that sets it to 0 -- cancels its style's list numbering for THIS paragraph but (parity
  // with parse.mjs's directNumPr: a `<w:numPr>` element is itself enough to keep a paragraph "in"
  // a list, whatever its own w:numId says) still leaves it a list item with no marker, not a
  // plain paragraph. Style-inherited numbering alone (no direct override) is unaffected: the
  // cascade into `pap.ilfo` below already carries it, same as ever.
  let hasDirectIlfo = false;
  if (run && run.end > run.start) {
    applyPapGrpprl(pap, ctx.wd, run.start, run.end, ctx.data);
    forEachSprm(ctx.wd, run.start, run.end, (sprm, o) => { if (sprm === 0x2640) directOutLvl = ctx.wd[o]; else if (sprm === 0x460B) hasDirectIlfo = true; });
  }
  const g = m && prmGrpprl(ctx, m.piece);
  if (g) {
    applyPapGrpprl(pap, g, 0, g.length, ctx.data);
    forEachSprm(g, 0, g.length, (sprm, o) => { if (sprm === 0x2640) directOutLvl = g[o]; else if (sprm === 0x460B) hasDirectIlfo = true; });
  }
  const mark = ctx.text[markCp];
  // Table nesting: itap is the paragraph's table depth (0 = body text). A cell's last
  // paragraph ends with 0x07 at depth 1 but with an ordinary mark + fInnerTableCell deeper;
  // likewise the row-end (TTP) paragraph is fTtp at depth 1 and fInnerTtp deeper.
  const itap = pap.itap || (pap.fInTable ? 1 : 0);
  const rowEnd = itap <= 1 ? !!pap.fTtp : !!pap.fInnerTtp;
  const cellEnd = !rowEnd && (itap <= 1 ? mark === '\x07' : !!pap.fInnerCell);
  return { cpStart, cpEnd, mark, pap, papx: run, piece: m ? m.piece : null, directOutLvl, hasDirectIlfo, itap, rowEnd, cellEnd };
}

// ---- character runs of a CP range: [{cpStart, cpEnd, chpx:{start,end}|null, piece}] ----
function charRunsIn(ctx, start, end) {
  const out = [];
  const { pieces, chpxRuns } = ctx;
  let pi = ctx.mapper.pieceAt(start);
  if (pi < 0) return [{ cpStart: start, cpEnd: end, chpx: null, piece: null }];
  for (; pi < pieces.length && pieces[pi].cpStart < end; pi++) {
    const p = pieces[pi];
    const bpc = p.compressed ? 1 : 2;
    const cs = Math.max(start, p.cpStart), ce = Math.min(end, p.cpEnd);
    let fc = p.fc + (cs - p.cpStart) * bpc;
    const fcEnd = p.fc + (ce - p.cpStart) * bpc;
    // first CHPX run that ends after fc
    let lo = 0, hi = chpxRuns.length - 1, k = chpxRuns.length;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (chpxRuns[mid].fcEnd > fc) { k = mid; hi = mid - 1; } else lo = mid + 1; }
    while (fc < fcEnd) {
      const r = k < chpxRuns.length ? chpxRuns[k] : null;
      if (!r || r.fcStart >= fcEnd) {                          // no formatting recorded: defaults
        out.push({ cpStart: p.cpStart + (fc - p.fc) / bpc, cpEnd: ce, chpx: null, piece: p });
        break;
      }
      if (r.fcStart > fc) {
        const gapEnd = Math.min(r.fcStart, fcEnd);
        out.push({ cpStart: p.cpStart + Math.floor((fc - p.fc) / bpc), cpEnd: p.cpStart + Math.ceil((gapEnd - p.fc) / bpc), chpx: null, piece: p });
        fc = gapEnd;
        continue;
      }
      const segEnd = Math.min(r.fcEnd, fcEnd);
      const a = p.cpStart + Math.floor((fc - p.fc) / bpc), b = p.cpStart + Math.ceil((segEnd - p.fc) / bpc);
      if (b > a) out.push({ cpStart: a, cpEnd: b, chpx: r.end > r.start ? r : null, piece: p });
      fc = segEnd;
      k++;
    }
  }
  return out;
}

// Import fix list #34: is the run's paragraph (style `paraIstd`) of the partner paragraph style of the linked character style `cst`
// (named "<paragraph style name> Char"), or of a style based on it? Without a partner found, the twin is always paragraph look.
function docTwinIsParagraphLook(ctx, cst, paraIstd) {
  const m = /^(.+?)\s+char$/i.exec(cst.name || '');
  if (!m) return true;
  const partner = ctx.styles.styles.find((x) => x && x.stk === 1 && String(x.name || '').toLowerCase() === m[1].toLowerCase());
  if (!partner) return true;
  const seen = new Set();
  let i = paraIstd;
  while (i != null && i !== 0x0FFF && !seen.has(i) && seen.size < 20) {
    if (i === partner.istd) return true;
    seen.add(i);
    const st = ctx.styles.get(i);
    if (!st || st.istdBase === i) break;
    i = st.istdBase;
  }
  return false;
}

// Resolve a run's character properties against its paragraph style.
// Returns { chp (fully resolved), tf, caps, iss, flag, hyperlinkStyle }.
function resolveChp(ctx, paraIstd, run) {
  const key = `${paraIstd}|${run.chpx ? run.chpx.start : 0}|${run.chpx ? run.chpx.end : 0}|${run.piece ? run.piece.prm : 0}`;
  const hit = ctx.chpCache.get(key);
  if (hit) return hit;
  const { styles } = ctx;
  const grpprls = [];
  if (run.chpx) grpprls.push([ctx.wd, run.chpx.start, run.chpx.end]);
  const g = prmGrpprl(ctx, run.piece);
  if (g) grpprls.push([g, 0, g.length]);
  // character style (sprmCIstd) first, then everything else
  let charIstd = 10;
  for (const [b, s, e] of grpprls) forEachSprm(b, s, e, (sprm, o) => { if (sprm === 0x4A30) charIstd = b[o] | (b[o + 1] << 8); });
  const paraChp = styles.chp(paraIstd);
  const cst = charIstd !== 10 ? styles.get(charIstd) : null;
  const csChain = [];
  for (let i = charIstd, n = 0; cst && i !== 0x0FFF && n < 20; n++) {
    const st = styles.get(i);
    if (!st || st.stk !== 2) break;
    csChain.unshift(st);
    if (st.istdBase === i) break;
    i = st.istdBase;
  }
  const merged = { ...paraChp };
  const csOnly = newChp();
  const TOG = { 0x0835: 'bold', 0x0836: 'italic', 0x2A3E: 'kul', 0x083A: 'smallCaps', 0x083B: 'caps', 0x2A48: 'iss', 0x0837: 'strike', 0x2A53: 'dstrike' };
  // docx-parity item 3: which of TOG's properties the character style CHAIN itself actually
  // set (as opposed to `csOnly` simply carrying newChp()'s all-off/zero defaults for
  // anything the chain never touched) — see `pick`, below, which needs to tell "the style
  // chain explicitly set this" from "the style chain never mentioned this at all".
  const csTouch = new Set();
  for (const st of csChain) {
    if (!st.chpx) continue;
    const baseM = { ...merged }, baseC = { ...csOnly };
    forEachSprm(ctx.table, st.chpx.start, st.chpx.end, (sprm, o, len) => {
      applyChpSprm(merged, sprm, ctx.table, o, len, baseM);
      applyChpSprm(csOnly, sprm, ctx.table, o, len, baseC);
      if (TOG[sprm]) csTouch.add(TOG[sprm]);
    });
  }
  const full = { ...merged };
  const direct = new Set();
  for (const [b, s, e] of grpprls) {
    forEachSprm(b, s, e, (sprm, o, len) => {
      if (sprm === 0x4A30) return;
      if (sprm === 0x2A33) { Object.assign(full, paraChp); direct.clear(); return; }   // sprmCPlain
      applyChpSprm(full, sprm, b, o, len, merged);
      if (TOG[sprm]) direct.add(TOG[sprm]);
    });
  }
  // .docx rule (parse.mjs runEmphasis/charStyleEmphasis): emphasis is the run's own direct
  // formatting, else its character style's — never a hyperlink style's underline, never a
  // "linked" (paragraph-style twin) character style, never the paragraph style's own look.
  // docx-parity item 3 (parse.mjs runCapsSmallCaps/runStrike/runScript/runVanish): unlike
  // bold/italic/underline, caps/smallCaps/strike/dstrike/iss (vertAlign) are NOT
  // direct-or-character-style-only — when neither sets one of THOSE five, it still falls
  // back to `merged` (the paragraph style's own chp, i.e. `paraChp` cascaded through its own
  // basedOn chain — see `styles.chp`), same precedence the .docx reader now uses.
  // Import fix list #34 (Paul, 30 Sep 2026; .docx: linkedTwinIsParagraphLook): the linked twin's OWN bold/italic/underline is ignored
  // only inside a paragraph of its partner paragraph style (or one based on it), where it is just the paragraph's look; the same style
  // on words in another kind of paragraph is an author's inline emphasis. Its caps, strike and raised/lowered settings stay skipped.
  const twinIsParaLook = !!(cst && cst.linked && docTwinIsParagraphLook(ctx, cst, paraIstd));
  const csUsable = csChain.length && !(cst && (cst.linked || cst.sti === STI_HYPERLINK || cst.sti === STI_FOLLOWED_HYPERLINK));
  const csUsableEmph = csChain.length && !(cst && (twinIsParaLook || cst.sti === STI_HYPERLINK || cst.sti === STI_FOLLOWED_HYPERLINK));
  const STYLE_FALLBACK = { caps: 1, smallCaps: 1, strike: 1, dstrike: 1, iss: 1 };
  const pick = (name) => {
    if (direct.has(name)) return full[name];
    if ((name === 'bold' || name === 'italic' || name === 'kul' ? csUsableEmph : csUsable) && csTouch.has(name)) return csOnly[name];
    if (STYLE_FALLBACK[name]) return merged[name];
    return name === 'kul' || name === 'iss' ? 0 : false;
  };
  let tf = 0;
  if (pick('bold')) tf |= TF_BOLD;
  if (pick('italic')) tf |= TF_ITALIC;
  // LINK-2 (Paul, 28 Sep 2026, KD round-2 Q1): mirrors parse.mjs's docx reader
  // (charStyleLinkUnderline) — unlike ordinary emphasis (which deliberately treats the
  // Hyperlink/FollowedHyperlink character style's own formatting as "this is a link", not
  // emphasis, and excludes it via csUsable above), that style's underline specifically means
  // "print showed this link underlined" (KD, round-2 Q1), so it is read here from the style
  // chain even when csUsable is false for everything else — same direct-wins precedence (a
  // run's own kul toggle, checked first via `direct.has('kul')`/`pick('kul')`, always wins).
  const linkUnderline = !direct.has('kul') && cst && (cst.sti === STI_HYPERLINK || cst.sti === STI_FOLLOWED_HYPERLINK) && csChain.length && csTouch.has('kul') && !!csOnly.kul;
  if (pick('kul') || linkUnderline) tf |= TF_UNDERLINE;
  // K5 / UEB §9: a script/handwriting run font (parseMod.SCRIPT_FONT_RE, the same rule
  // parse.mjs's .docx reader applies to w:rFonts). `full.ftc` (sprmCRgFtc0's ASCII font,
  // cascaded from the paragraph/character style the same way the rest of `full` already is —
  // .doc's binary SPRM stream has no separate "direct toggle" record for a font name the way
  // TOG's bold/italic/underline toggles do, so unlike those three this is not direct-run-only)
  // indexes ctx.fonts, the document's own font table (readFonts, used elsewhere for symbol
  // glyphs). Not `runScript`/`chp.symbol` — an unrelated existing name for super/subscript.
  const runFontName = full.ftc != null ? ctx.fonts[full.ftc] : null;
  if (runFontName && parseMod.SCRIPT_FONT_RE.test(runFontName)) tf |= TF_SCRIPT;
  const csName = cst ? styleKey(cst.name) : '';
  const res = {
    chp: full,
    tf,
    caps: !!(pick('caps') || pick('smallCaps')),
    iss: pick('iss') || 0,
    strike: !!(pick('strike') || pick('dstrike')),
    flag: EMBOSS_RUN_FLAGS[csName] || null,
  };
  ctx.chpCache.set(key, res);
  return res;
}

// ---------------------------------------------------------------------------------------
// Notes (footnotes / endnotes): reference CP → index, and each note's text range.
// ---------------------------------------------------------------------------------------
function readNotes(ctx, refName, txtName, sub) {
  const refs = new Map();                                     // cp of the reference mark → note index
  const custom = new Set();                                   // indexes whose mark is the author's own text (FRD nAuto 0)
  const texts = [];                                           // index → { start, end } (absolute CPs)
  const r = ctx.fib.fcLcb[refName], t = ctx.fib.fcLcb[txtName];
  if (!r || !r.lcb || !t || !t.lcb) return { refs, texts, custom };
  try {
    const plc = readPlc(ctx.table, r.fc, r.lcb, 2);
    const r0 = reader(ctx.table);
    for (let i = 0; i < plc.n; i++) { refs.set(plc.cps[i], i); if (r0.i16(plc.dataOff(i)) === 0) custom.add(i); }
    const tp = readPlc(ctx.table, t.fc, t.lcb, 0);
    for (let i = 0; i < plc.n && i + 1 < tp.cps.length; i++) texts.push({ start: sub.start + tp.cps[i], end: Math.min(sub.end, sub.start + tp.cps[i + 1]) });
  } catch { /* notes unreadable: references still show as marks */ }
  return { refs, texts, custom };
}

// ---------------------------------------------------------------------------------------
// Inline walk: a paragraph's characters → tokens. The field stack is shared across the
// paragraphs of one story (a TOC field's result spans many paragraphs).
// ---------------------------------------------------------------------------------------
function fieldHref(code) {
  // LibreOffice's .doc writer leaves a stray control character (seen: 0x01) right at the end
  // of every field's instruction text, after the closing quote and before the field-result
  // delimiter (0x14) — not part of the field syntax. Left in, it tokenizes as a bare `\S+`
  // argument and (for an internal `\l "bookmark"`-only link, which is meant to give no href at
  // all) is wrongly picked up as the URL once the bookmark argument has already been consumed,
  // producing a "href" that is literally that one control character. Strip control characters
  // before parsing so only the real instruction text is tokenized.
  const m = /^\s*HYPERLINK\s+(.*)$/i.exec(code.replace(/[\x00-\x1F]/g, ''));
  if (!m) return null;
  const args = m[1];
  // \l "bookmark" alone is an internal link (like a .docx w:anchor): no href.
  const q = /"([^"]*)"|(\S+)/g;
  let url = null, anchor = null, x, sawL = false;
  while ((x = q.exec(args))) {
    const v = x[1] != null ? x[1] : x[2];
    if (x[2] && /^\\l$/i.test(x[2])) { sawL = true; continue; }
    if (x[2] && /^\\[a-z]$/i.test(x[2])) { q.exec(args); continue; }   // another switch and its argument
    if (sawL && anchor == null) { anchor = v; sawL = false; continue; }
    if (url == null) url = v;
  }
  return url ? url.replace(/\\\\/g, '\\') : null;
}

function inlineTokens(ctx, para, story) {
  const tokens = [];
  const { text } = ctx;
  const runs = charRunsIn(ctx, para.cpStart, para.cpEnd - 1);
  const fstack = story.fields;
  for (const run of runs) {
    const props = resolveChp(ctx, para.pap.istd, run);
    const chp = props.chp;
    for (let cp = run.cpStart; cp < run.cpEnd; cp++) {
      const c = text.charCodeAt(cp);
      if (c === 0x13) { fstack.push({ code: '', phase: 'code', href: null, cp }); continue; }
      if (c === 0x14) {
        const f = fstack[fstack.length - 1];
        if (f && f.phase === 'code') {
          f.phase = 'result'; f.href = fieldHref(f.code);
          // An EMBED field whose field SEPARATOR carries the object's properties — sprmCFOle2 +
          // sprmCFObj + sprmCPicLocation, the last being the object's ObjectPool storage id
          // ([MS-DOC] 2.6.1: with fOle2 set and fData clear, sprmCPicLocation names the storage
          // "_<id>" inside ObjectPool). LibreOffice's .doc export writes every embedded object
          // (its Math formulas, as MathType "Equation Native" objects) this way; the result's
          // 0x01 is then only the object's preview picture (its own sprmCPicLocation is a PICF
          // offset in the Data stream). The object is read at that 0x01, or at the field end.
          if (chp.fOle2 && !chp.fData && chp.picLocation != null) f.ole = { t: 'ole', chp, code: f.code, cp };
        }
        continue;
      }
      if (c === 0x15) {
        const f = fstack.pop();
        if (f && f.ole && !f.oleUsed && !f.ole.chp.rmarkDel && !f.ole.chp.vanish) tokens.push(f.ole);
        // A field with no result part shows nothing (XE, TC, EQ …), except Word's ruby
        // (phonetic guide) EQ field, whose base text is print (.docx: w:ruby → rubyBase).
        if (f && f.phase === 'code') {
          const base = rubyBase(f.code);
          if (base) pushText(tokens, base, props, linkOf(fstack));
        }
        // A check-box form field is its state where it stands in the text, [x] or [ ]; a drop-down form field is its selected item
        // (as the HTML reader writes an <input type=checkbox> and a <select>)
        if (f && f.formText) pushText(tokens, f.formText, props, linkOf(fstack));
        continue;
      }
      const top = fstack[fstack.length - 1];
      if (top && top.phase === 'code') {
        // An embedded object's picture sits in the field CODE when it has no result part.
        if (c === 0x01 && chp.fOle2 && chp.picLocation != null) tokens.push({ t: 'ole', chp, code: top.code, cp });
        // A legacy form field (FORMCHECKBOX ...): the form data (FFData) of the field is the special character 0x01 in its code.
        else if (c === 0x01 && chp.fData && chp.picLocation != null) { const ft = readFormField(ctx, chp.picLocation); if (ft && !chp.rmarkDel && !chp.vanish) top.formText = ft; }
        else top.code += text[cp];
        continue;
      }
      if (chp.rmarkDel) continue;                             // tracked deletion: not part of the document
      // A note reference with the author's own mark ("*", "†") is that text itself, not 0x02.
      if (story.notes && c !== 0x02) {
        const kind = story.notes.ftn.refs.has(cp) ? 'ftn' : story.notes.edn.refs.has(cp) ? 'edn' : null;
        const idx = kind && story.notes[kind].refs.get(cp);
        if (kind && story.notes[kind].custom.has(idx)) { tokens.push({ t: 'noteref', kind, index: idx, mark: text[cp] }); continue; }
      }
      if (chp.vanish || chp.specVanish) continue;             // hidden text is never transcribed
      const href = linkOf(fstack);
      if (chp.fSpec || c < 0x20) {
        let tok = specialToken(ctx, c, chp, cp, story, fstack);
        // The result picture of an EMBED field whose separator named the object (above): the
        // object itself, with this picture kept as its preview. A result 0x01 that is itself
        // the object (Word's own sprmCFOle2 on it) is used as it is.
        if (tok && (tok.t === 'pic' || tok.t === 'ole') && top && top.ole && !top.oleUsed) {
          top.oleUsed = true;
          if (tok.t === 'pic') tok = { ...top.ole, preview: tok.chp.picLocation };
        }
        if (tok) { if (tok.t === 'text') Object.assign(tok, { props, href }); tokens.push(tok); }
        continue;
      }
      let ch = text[cp];
      if (chp.symbol) ch = symGlyph(ctx.fonts[chp.symbol.ftc], chp.symbol.xchar);
      else if (c >= 0xF020 && c <= 0xF0FF && chp.ftc != null) ch = symGlyph(ctx.fonts[chp.ftc], c);
      // An ordinary character set in the Symbol or Wingdings font (Format > Font on typed "ab") is that font's shape in print (Symbol:
      // αβ): its font position is the character's code. Only the ASCII characters the run's ASCII font (sprmCRgFtc0) covers; a space
      // or control character has no shape.
      else if (c > 0x20 && c < 0x7F && chp.ftc != null && /^(?:symbol|wingdings)$/i.test(String(ctx.fonts[chp.ftc] || '').trim())) ch = symGlyph(ctx.fonts[chp.ftc], c);
      else if (c === 0x00AD) continue;                        // soft hyphen: invisible
      pushText(tokens, ch, props, href);
    }
  }
  return tokens;
}

// A legacy form field's value as text ([MS-DOC] 2.9.76 FFData, in the Data stream at the special character's sprmCPicLocation: a PICF
// header of cbHeader bytes, then version 0xFFFFFFFF, FFDataBits (iType bits 0-1: 0 text, 1 check box, 2 drop-down; iRes bits 2-6: the
// check box's result - 0 clear, 1 ticked, 25 = never toggled so the default wDef applies - or a drop-down's selected item; bit 15
// fHasListBox), cch, hps, xstzName, xstzTextDef, wDef, then xstzTextFormat, xstzHelpText, xstzStatText, xstzEntryMcr, xstzExitMcr
// (LibreOffice leaves out the last) and, for a drop-down, hsttbDropList: an STTB (0xFFFF, count, extra size, then each string as a
// u16 length and its characters)). A check box is "[x]" or "[ ]" (the HTML reader's form for <input type=checkbox>), a drop-down its
// selected item ("" when none); a text field (its result part is the text) and anything unreadable give null.
function readFormField(ctx, fc) {
  const d = ctx.data;
  try {
    if (!d || fc == null || fc + 10 > d.length) return null;
    const r = reader(d);
    const lcb = r.i32(fc), cbHeader = r.u16(fc + 4);
    const o = fc + cbHeader;
    const end = Math.min(d.length, fc + lcb);
    if (cbHeader < 6 || lcb < cbHeader + 6 || o + 10 > end || r.u32(o) !== 0xFFFFFFFF) return null;
    const bits = r.u16(o + 4);
    const iType = bits & 3, iRes = (bits >> 2) & 0x1F;
    if (iType !== 1 && iType !== 2) return null;
    if (iType === 1 && (iRes === 0 || iRes === 1)) return iRes === 1 ? '[x]' : '[ ]';
    // the strings and wDef after the fixed part
    const xstz = (q, terminated = true) => {
      const n = r.u16(q);
      if (q + 2 + n * 2 + (terminated ? 2 : 0) > end) throw new Error('past the end');
      return { s: String.fromCharCode(...Array.from({ length: n }, (_, i) => r.u16(q + 2 + i * 2))), next: q + 2 + n * 2 + (terminated ? 2 : 0) };
    };
    let q = o + 10;
    q = xstz(q).next;                                         // xstzName
    q = xstz(q).next;                                         // xstzTextDef
    const wDef = r.u16(q); q += 2;
    if (iType === 1) return (iRes === 25 ? wDef === 1 : iRes === 1) ? '[x]' : '[ ]';   // never toggled: the default
    for (let k = 0; k < 4; k++) q = xstz(q).next;             // format, help text, status text, entry macro
    if (r.u16(q) !== 0xFFFF) q = xstz(q).next;                // exit macro (absent in LibreOffice's files)
    if (r.u16(q) !== 0xFFFF) return null;
    const count = r.u16(q + 2);
    q += 6;                                                   // fExtend, cData, cbExtra
    const items = [];
    for (let k = 0; k < count && k < 1000; k++) { const it = xstz(q, false); items.push(it.s); q = it.next; }
    const sel = iRes === 25 ? wDef : iRes;
    return sel < items.length ? items[sel] : '';
  } catch { return null; }
}

// EQ \* jc2 \* "Font:…" \o\ad(\s\up 9(ruby),base) → base, then the guide in brackets (IMP-W11, Paul, 30 Sep 2026)
function rubyBase(code) {
  const m = /^\s*EQ\b[\s\S]*?\\o\s*\\a[dlrc]?\s*\(\s*\\s\s*\\up\s*-?\d+\s*\(([^)]*)\)\s*,([^)]*)\)/i.exec(code || '');
  if (!m) return '';
  return m[1].trim() ? `${m[2]} (${m[1].trim()})` : m[2];
}

function linkOf(fstack) {
  for (let i = fstack.length - 1; i >= 0; i--) if (fstack[i].phase === 'result' && fstack[i].href) return fstack[i].href;
  return null;
}

function pushText(tokens, s, props, href) {
  const last = tokens[tokens.length - 1];
  if (last && last.t === 'text' && last.props === props && last.href === href) last.s += s;
  else tokens.push({ t: 'text', s, props, href });
}

function specialToken(ctx, c, chp, cp, story, fstack) {
  switch (c) {
    case 0x09: return { t: 'tab' };                           // tab: a space (as the .docx reader), kept for contents entries
    case 0x0B: return { t: 'lb' };                            // Shift+Enter line break (a verse line break in a plain paragraph, else a space — as the .docx reader)
    case 0x0C: case 0x0E: return { t: 'text', s: ' ' };       // page / column break inside a paragraph
    case 0x1E: return { t: 'text', s: '-' };                  // non-breaking hyphen
    case 0x1F: return null;                                   // optional (soft) hyphen: invisible
    case 0x02: {                                              // auto-numbered footnote / endnote reference
      if (!chp.fSpec) return null;
      const fn = story.notes && story.notes.ftn.refs.get(cp);
      if (fn != null) return { t: 'noteref', kind: 'ftn', index: fn };
      const en = story.notes && story.notes.edn.refs.get(cp);
      if (en != null) return { t: 'noteref', kind: 'edn', index: en };
      return null;                                            // the mark at the start of a note's own text
    }
    case 0x01: {                                              // picture or embedded object
      if (!chp.fSpec && chp.picLocation == null) return null;
      if (chp.fData && !chp.fOle2) {                          // form-field data, not a picture: a check box in the field's result part is [x] / [ ]
        const ft = chp.picLocation != null ? readFormField(ctx, chp.picLocation) : null;
        return ft ? { t: 'text', s: ft } : null;
      }
      const f = fstack.length ? fstack[fstack.length - 1] : null;
      if (chp.fOle2) return { t: 'ole', chp, code: f ? f.code : '', cp };
      return { t: 'pic', chp, cp };
    }
    case 0x08: return chp.fSpec ? { t: 'anchor', cp } : null; // floating shape / text box anchor
    case 0x28: if (chp.symbol) return { t: 'text', s: symGlyph(ctx.fonts[chp.symbol.ftc], chp.symbol.xchar) }; return chp.fSpec ? null : { t: 'text', s: '(' };
    default: return null;                                     // separators, annotation marks, other controls
  }
}

// ---------------------------------------------------------------------------------------
// Tokens → segments (the .docx reader's paragraphSegments shape) and plain text.
// ---------------------------------------------------------------------------------------
// The foreign language of a run (input/lang.mjs): the language id for the run's script (lid / lidFE / lidBi, style
// inheritance already applied by resolveChp) against the document's own language (the Normal style's lid, else the
// FIB's). LCID 1024 is "no proofing" and means nothing. Recorded as seg.lang only; braille is unchanged.
function docRunLang(ctx, chp, s) {
  if (ctx.mainLang === undefined) {
    let normal = null;
    try { normal = ctx.styles && typeof ctx.styles.chp === 'function' ? ctx.styles.chp(0) : null; } catch { normal = null; }
    ctx.mainLang = lcidLang(normal && normal.lid) || lcidLang(ctx.fib && ctx.fib.lid) || null;
  }
  const slot = scriptSlot(s);
  return foreignLangOf(lcidLang(slot === 'ea' ? chp.lidFE : slot === 'bidi' ? chp.lidBi : chp.lid), ctx.mainLang);
}

function tokensToSegments(ctx, tokens, story) {
  const { subOpen, supOpen, end } = SCRIPT_MARKS;
  const segments = [];
  const images = [];
  const anchors = [];
  let text = '';
  let plain = '';
  let curScript = null, curTf = 0, curFlag = null, curHref = null, curStrike = false, curLang = null;
  let plainScript = null;
  const flush = () => {
    if (curScript) { text += end; curScript = null; }
    if (text) {
      if (curFlag === 'linenum') segments.push({ type: 'linenum', text });
      else {
        const seg = curTf ? { type: 'text', text, tf: curTf } : { type: 'text', text };
        if (curFlag === 'uncontracted') seg.uncontracted = true;
        if (curHref) seg.href = curHref;
        if (curStrike) seg.transcriberTypeform = 'strike';   // UEB 9.5.1 crossed-out print: single or double strikethrough (the formatter's strike typeform)
        if (curLang) seg.lang = curLang;                      // foreign language (lid, input/lang.mjs) — recorded only
        segments.push(seg);
      }
    }
    text = '';
  };
  let plainTabs = '';                                          // plain text with tabs kept (contents entries)
  for (const tok0 of tokens) {
    // IMP-W2: a Shift+Enter break is kept in the segments as U+2028 (paraContent turns it into a forced line break '\n' for an ordinary
    // paragraph, and back into a space everywhere else); in the plain text it is a space, as before.
    const tok = tok0.t === 'lb' ? { t: 'text', s: '\u2028', lb: true } : tok0.t === 'tab' ? { t: 'text', s: ' ' } : tok0;
    if (tok.t === 'text') {
      const p = tok.props || null;
      const tf = p ? p.tf : curTf;
      const flag = p ? p.flag : curFlag;
      const strike = p ? p.strike : curStrike;
      const href = tok.href !== undefined ? tok.href : curHref;
      const lang = p && p.chp ? docRunLang(ctx, p.chp, tok.s) : curLang;
      if (tf !== curTf || flag !== curFlag || href !== curHref || strike !== curStrike || lang !== curLang) { flush(); curTf = tf; curFlag = flag; curHref = href; curStrike = strike; curLang = lang; }
      let s = tok.s;
      if (p && p.caps) s = s.toUpperCase();
      const script = p ? (p.iss === 1 ? 'sup' : p.iss === 2 ? 'sub' : null) : curScript;
      if (script !== curScript) {
        if (curScript) text += end;
        if (script) text += script === 'sub' ? subOpen : supOpen;
        curScript = script;
      }
      if (script !== plainScript) {
        if (plainScript) plain += end;
        if (script) plain += script === 'sub' ? subOpen : supOpen;
        plainScript = script;
      }
      text += s;
      plain += tok.lb ? ' ' : s;
      plainTabs += tok0.t === 'tab' ? '\t' : (tok.lb ? ' ' : s);
      continue;
    }
    if (tok.t === 'noteref') {
      flush();
      const marks = tok.kind === 'edn' ? story.noteMarks.enMarks : story.noteMarks.fnMarks;
      if (!marks.has(tok.index)) marks.set(tok.index, tok.mark != null ? tok.mark : String(tok.kind === 'edn' ? ++story.noteMarks.en : ++story.noteMarks.fn));
      segments.push({ type: 'noteref', text: marks.get(tok.index), idref: (tok.kind === 'edn' ? 'doc-en-' : 'doc-fn-') + (tok.index + 1) });
      continue;
    }
    // An embedded object (inline, or a floating shape's — 'anchor' below) in place: an
    // equation's math, a placeholder, or (an object that names nothing readable) its picture.
    const pushOle = (eq, previewImg) => {
      if (eq.kind === 'math') {
        flush(); curTf = 0; curFlag = null;
        const seg = { type: 'math', mathml: eq.mathml };
        const latex = safeLatex(eq.mathml);
        if (latex) seg.latex = latex;
        segments.push(seg);
        story.readSegs.add(seg);
      } else if (eq.kind === 'placeholder' || eq.kind === 'object') {
        flush(); curTf = 0; curFlag = null;
        segments.push({ type: 'imgnote', text: eq.text, prodnote: true, render: 'required' });
        // A non-equation object keeps its preview picture, if it has one, for the transcriber.
        if (eq.kind === 'object' && previewImg) images.push(previewImg);
      } else if (previewImg) images.push(previewImg);
    };
    if (tok.t === 'ole') {
      const eq = oleToken(ctx, tok, story);
      let preview = null;
      if (tok.preview != null && eq.kind !== 'math' && eq.kind !== 'placeholder') {
        const img = inlinePicture(ctx, tok.preview);
        if (img && (img._res || img.alt)) preview = img;
      }
      pushOle(eq, preview);
      continue;
    }
    if (tok.t === 'pic') {
      const img = inlinePicture(ctx, tok.chp.picLocation);
      // A floating shape/text box anchor (0x08, handled below as 'anchor') is written by
      // LibreOffice's .doc export with a companion 0x01 picture-run character right next to
      // it — [MS-DOC]'s backward-compatible "if you can't draw the shape, show this instead"
      // fallback picture — but for a plain (non-picture-filled) shape that fallback PICF
      // resolves to no blip at all: `inlinePicture` still returns an object (never null), just
      // one with neither real image bytes (`_res`) nor a name/description (`alt`). Pushing it
      // produced an extra empty `{type:'graphic', src:'', alt:''}` block with nothing to show,
      // right where the shape's own content (its image, or its text box's paragraphs) already
      // renders via the anchor. Only keep pictures that resolved to something.
      if (img && (img._res || img.alt)) images.push(img);
      continue;
    }
    if (tok.t === 'anchor') {
      // A floating shape that is an embedded object (an equation LibreOffice or Word anchored
      // as a floating frame): read in place, at its anchor, like an inline one.
      const fo = floatingOle(ctx, tok.cp, story);
      if (fo) { pushOle(fo.eq, fo.eq.kind === 'object' ? fo.image : null); continue; }
      anchors.push(tok.cp);
      continue;
    }
  }
  flush();
  if (plainScript) plain += end;
  return { segments, plain, images, anchors, plainTabs };
}

function safeLatex(mathml) { try { return mathmlToLatex(mathml); } catch { return ''; } }

// An embedded OLE object: an Equation Editor 3.0 / MathType equation → MathML (mtef.mjs), a
// placeholder when it cannot be read, or (any other object) its preview picture.
// Each object is converted (and counted for the load warning) once, however often its
// paragraph is re-read (a caption look-ahead, a verse-line split).
function oleToken(ctx, tok, story) {
  const key = tok.cp;
  if (ctx.oleCache.has(key)) return ctx.oleCache.get(key);
  const res = oleTokenUncached(ctx, tok);
  if (res.kind === 'placeholder') story.legacyEq.count++;
  else if (res.kind === 'object') story.legacyEq.oleCount++;
  ctx.oleCache.set(key, res);
  return res;
}
// A floating shape that is an embedded object: OfficeArtFSP.fOleShape ([MS-ODRAW] 2.2.40).
// Its object is not named by the shape itself: the shape's pictureId property (0x010B,
// [MS-ODRAW] 2.3.23) holds the 1-based text-box story index in its high word (as lTxid
// does), and that story in the text-box subdocument holds the object's own EMBED field,
// whose sprmCPicLocation names the ObjectPool storage (both Word and LibreOffice write it
// this way; LibreOffice's reader finds it so too, SwMSDffManager::GetOLEStorageName). So
// the object is read from the first embedded-object token of the shape's story. Returns
// { eq, image } (image: the shape's own preview picture), or null — not an object, or one
// that names nothing readable (the shape then shows its picture as any floating shape does).
function floatingOle(ctx, cp, story) {
  const shape = ctx.art.shapeAt(cp);
  if (!shape || !shape.ole) return null;
  if (!ctx.floatOle) ctx.floatOle = new Map();
  if (ctx.floatOle.has(cp)) return ctx.floatOle.get(cp);
  ctx.floatOle.set(cp, null);                                 // guards a self-referencing story
  let res = null;
  const sub = { ...story, fields: [] };
  outer: for (const range of textboxesOf(ctx).get(shape.spid) || []) {
    for (const p of paragraphsIn(ctx, range.start, range.end)) {
      let toks;
      try { toks = inlineTokens(ctx, p, sub); } catch { continue; }
      const t = toks.find((x) => x.t === 'ole');
      if (!t) continue;
      const eq = oleToken(ctx, t, story);
      if (eq.kind !== 'none') res = { eq, image: shape.image || null };
      break outer;
    }
  }
  ctx.floatOle.set(cp, res);
  return res;
}
function textboxesOf(ctx) {
  if (!ctx.textboxes) ctx.textboxes = textboxRanges(ctx);
  return ctx.textboxes;
}
function oleTokenUncached(ctx, tok) {
  const info = oleObjectInfo(ctx, tok.chp.picLocation);
  const codeProg = (/^\s*EMBED\s+(\S+)/i.exec(tok.code || '') || [])[1] || '';
  const progId = ((info && info.progId) || codeProg).trim();
  if (LEGACY_EQUATION_PROGID_RE.test(progId) || /^equation\./i.test(codeProg)) {
    if (info && info.equationNative) {
      try {
        const mathml = equationNativeToMathML(info.equationNative);
        if (mathml) return { kind: 'math', mathml };
      } catch { /* fall through to the placeholder */ }
    }
    return { kind: 'placeholder', text: LEGACY_EQUATION_PLACEHOLDER };
  }
  // Any other embedded object (a spreadsheet, a document, a package …): the .docx reader's
  // docx-fix item 8 placeholder, with the same friendly name.
  if (!progId) return { kind: 'none' };
  return { kind: 'object', text: `embedded object not transcribed (${oleFriendlyName(progId)})` };
}
const OLE_FRIENDLY_NAME_RULES = [
  [/^excel\.sheet/i, 'Excel spreadsheet'],
  [/^word\.document/i, 'Word document'],
  [/^powerpoint\.(show|slide)/i, 'PowerPoint presentation'],
  [/^visio\.drawing/i, 'Visio drawing'],
  [/^acroexch\./i, 'PDF document'],
  [/^mspublisher/i, 'Publisher document'],
  [/^msprojectdocument/i, 'Project file'],
  // docx-parity item 5: same addition as parse.mjs's own copy of this table — the old
  // Microsoft Graph chart applet (MSGraph.Chart*) and an embedded Excel chart sheet
  // (Excel.Chart*, distinct from Excel.Sheet*) both read as "a chart".
  [/^msgraph\.chart/i, 'chart'],
  [/^excel\.chart/i, 'chart'],
  [/^package$/i, 'embedded file'],
];
function oleFriendlyName(progId) {
  for (const [re, name] of OLE_FRIENDLY_NAME_RULES) if (re.test(progId)) return name;
  return 'embedded object';
}

// ---------------------------------------------------------------------------------------
// Style classification (the .docx reader's classifyDocxStyle, by sti instead of style id).
// ---------------------------------------------------------------------------------------
function styleOutLvl(ctx, st) {
  if (!st || !st.papx) return null;
  let v = null;
  forEachSprm(ctx.table, st.papx.start, st.papx.end, (sprm, o) => { if (sprm === 0x2640) v = ctx.table[o]; });
  return v;
}
// IMP-W2: a paragraph style that is a poem / verse style (its name, or a style it is based on, contains poem, poetry, verse or lyric).
function docIsVerseStyle(ctx, istd) {
  const seen = new Set();
  let i = istd;
  while (i != null && i !== 0x0FFF && !seen.has(i) && seen.size < 20) {
    seen.add(i);
    const st = ctx.styles.get(i);
    if (!st) break;
    if (/poem|poetry|verse|lyric/i.test(st.name || '')) return true;
    if (st.istdBase === i) break;
    i = st.istdBase;
  }
  return false;
}
function classifyStyle(ctx, istd) {
  const { styles } = ctx;
  const seen = new Set();
  let first = true;
  let i = istd;
  while (i != null && i !== 0x0FFF && !seen.has(i) && seen.size < 20) {
    seen.add(i);
    const st = styles.get(i);
    if (!st) break;
    const ol = styleOutLvl(ctx, st);
    if (ol != null && ol >= 0 && ol <= 8) return { kind: 'heading', level: ol + 1 };
    if (st.sti >= 1 && st.sti <= 9) return { kind: 'heading', level: st.sti };
    if (st.sti === STI_TITLE || st.sti === STI_SUBTITLE) return { kind: 'title', subtitle: st.sti === STI_SUBTITLE };   // IMP-W1
    if (first) {
      const nameHm = /^heading\s*([1-9])\b/i.exec(st.name || '');
      if (nameHm) return { kind: 'heading', level: Number(nameHm[1]) };
      if (/^(title|subtitle)$/i.test(st.name || '')) return { kind: 'title', subtitle: /^subtitle$/i.test(st.name || '') };
    }
    first = false;
    if (st.istdBase === i) break;
    i = st.istdBase;
  }
  const st0 = styles.get(istd);
  if (st0 && /\btitle\b/i.test(st0.name || '')) return { kind: 'title' };
  return null;
}
// "toc 1"–"toc 9" (sti 19–27, or the name) → contents level 0–8, else null.
function tocStyleLevel(ctx, istd) {
  const st = ctx.styles.get(istd);
  if (!st) return null;
  if (st.sti >= 19 && st.sti <= 27) return st.sti - 19;
  const m = /^toc\s*([1-9])$/i.exec(st.name || '');
  return m ? Number(m[1]) - 1 : null;
}
function styleNameOf(ctx, istd) { const st = ctx.styles.get(istd); return st ? st.name || '' : ''; }
function isCaptionPara(ctx, para) {
  const st = ctx.styles.get(para.pap.istd);
  return !!st && (st.sti === STI_CAPTION || /caption/i.test(st.name || ''));
}

// ---------------------------------------------------------------------------------------
// Paragraph → { segments, text, hasSeg, images, anchors }
// ---------------------------------------------------------------------------------------
function paraContent(ctx, para, story) {
  let tokens;
  try {
    tokens = inlineTokens(ctx, para, story);
  } catch (e) {
    // A damaged formatting record costs this paragraph its formatting, not the document:
    // keep its plain characters (field codes and control characters dropped).
    if (!ctx.damagedParas) ctx.damagedParas = new Set();
    ctx.damagedParas.add(para.cpStart);
    tokens = [{ t: 'text', s: plainChars(ctx, para), props: null, href: null }];
  }
  const { segments: rawSegments, plain, images, anchors, plainTabs } = tokensToSegments(ctx, tokens, story);
  // IMP-W2: `segments` have a Shift+Enter break as a space (as always); `breakSegments` (only when the paragraph has a break) as a
  // forced line break '\n', tidied (parse.mjs tidyForcedBreakSegments), for an ordinary paragraph to use.
  const hasLb = rawSegments.some((s) => s.type === 'text' && typeof s.text === 'string' && s.text.includes('\u2028'));
  const segments = hasLb ? rawSegments.map((s) => (s.type === 'text' && typeof s.text === 'string' && s.text.includes('\u2028') ? { ...s, text: s.text.replace(/\u2028/g, ' ') } : s)) : rawSegments;
  const breakSegments = hasLb ? parseMod.tidyForcedBreakSegments(rawSegments.map((s) => (s.type === 'text' && typeof s.text === 'string' && s.text.includes('\u2028') ? { ...s, text: s.text.replace(/\u2028/g, '\n') } : s))) : null;
  const hasMath = segments.some((s) => s.type === 'math');
  const hasSeg = !!(segments.length && (hasMath || segments.some((s) => s.tf || s.href || s.type === 'noteref' || s.type === 'linenum' || s.type === 'imgnote' || s.uncontracted || s.transcriberTypeform || s.lang)));
  let text = plain.replace(/\s+/g, ' ').trim();
  if (segments.some((s) => s.type === 'linenum')) text = segments.map((s) => (s.type === 'linenum' ? ` ${s.text} ` : (s.text || ''))).join('').replace(/\s+/g, ' ').trim();
  return { segments, text, hasSeg, images, anchors, tokens, plainTabs, breakSegments };
}

function plainChars(ctx, para) {
  let out = '', depth = 0, inCode = false;
  for (let cp = para.cpStart; cp < para.cpEnd - 1; cp++) {
    const c = ctx.text.charCodeAt(cp);
    if (c === 0x13) { depth++; inCode = true; continue; }
    if (c === 0x14) { inCode = false; continue; }
    if (c === 0x15) { depth = Math.max(0, depth - 1); inCode = false; continue; }
    if (inCode) continue;
    out += c === 0x09 || c === 0x0B ? ' ' : c < 0x20 ? '' : ctx.text[cp];
  }
  return out;
}

// A note's own paragraphs → the .docx reader's note entry ({text, segments?} or {blocks}).
function noteEntry(ctx, range, story) {
  const paras = paragraphsIn(ctx, range.start, range.end);
  const sub = { ...story, fields: [] };
  const paraBlock = (p) => {
    const c = paraContent(ctx, p, sub);
    const hasSeg = !!(c.segments.length && c.segments.some((s) => s.tf || s.href || s.type === 'imgnote' || s.type === 'linenum' || s.uncontracted || s.type === 'math' || s.transcriberTypeform || s.lang));
    if (!c.text && !hasSeg) return null;
    return hasSeg ? { type: 'para', text: c.text, segments: c.segments } : { type: 'para', text: c.text };
  };
  if (paras.length > 1) {
    const blocks = paras.map(paraBlock).filter(Boolean);
    return blocks.length ? (blocks.length === 1 ? (blocks[0].segments ? { text: blocks[0].text, segments: blocks[0].segments } : { text: blocks[0].text }) : { blocks }) : null;
  }
  if (paras.length === 1) {
    const blk = paraBlock(paras[0]);
    return blk ? (blk.segments ? { text: blk.text, segments: blk.segments } : { text: blk.text }) : null;
  }
  return null;
}

function collectNoteBlocks(ctx, segs, story) {
  const out = [];
  for (const s of segs || []) {
    if (!s || s.type !== 'noteref' || !s.idref || story.seenNotes.has(s.idref)) continue;
    story.seenNotes.add(s.idref);
    const isEndnote = s.idref.startsWith('doc-en-');
    const index = Number(s.idref.slice(7)) - 1;
    const notes = isEndnote ? story.notes.edn : story.notes.ftn;
    const range = notes.texts[index];
    if (!range) continue;
    const entry = noteEntry(ctx, range, story);
    if (!entry) continue;
    const blk = Array.isArray(entry.blocks) ? { type: 'footnote', blocks: entry.blocks } : { type: 'footnote', text: entry.text, ...(entry.segments ? { segments: entry.segments } : {}) };
    blk.id = s.idref;
    if (isEndnote) blk.kind = 'endnote';
    out.push(blk);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------------------
// D8 (parse.mjs richCellFromSegments): a cell keeps emphasis/links/notes/maths as segments.
function richCellFromSegments(segs) {
  if (!segs.some((g) => g.tf || g.href || g.type === 'noteref' || g.type === 'math' || g.type === 'imgnote' || g.transcriberTypeform || g.lang)) return null;
  const norm = segs
    .map((g) => (g.type === 'text' ? { ...g, text: g.text.replace(/\s+/g, ' ') } : g))
    .filter((g) => g.type !== 'text' || g.text);
  if (norm.length && norm[0].type === 'text') norm[0] = { ...norm[0], text: norm[0].text.replace(/^\s+/, '') };
  const last = norm.length - 1;
  if (last >= 0 && norm[last].type === 'text') norm[last] = { ...norm[last], text: norm[last].text.replace(/\s+$/, '') };
  const kept = [];
  for (const g of norm) {
    if (g.type === 'text' && !g.text) continue;
    const prev = kept[kept.length - 1];
    if (g.type === 'text' && prev && prev.type === 'text' && (prev.tf || 0) === (g.tf || 0) && !!prev.uncontracted === !!g.uncontracted && !prev.href && !g.href && (prev.transcriberTypeform || null) === (g.transcriberTypeform || null) && (prev.lang || null) === (g.lang || null)) {
      kept[kept.length - 1] = { ...prev, text: (prev.text + g.text).replace(/\s+/g, ' ') };
    } else kept.push(g);
  }
  if (!kept.length) return null;
  const plain = kept.map((g) => (g.type === 'math' ? (g.latex || '') : g.text)).join('');
  return cellFromSegments(plain, kept);
}

// Group a run of in-table paragraphs (depth >= 1) into rows of cells at depth 1; a nested
// table's paragraphs (depth >= 2) stay inside the depth-1 cell they belong to.
function tableRows(ctx, paras, depth = 1) {
  const rows = [];
  let cells = [], cell = [];
  for (const p of paras) {
    if (p.itap === depth && p.rowEnd) {
      if (cell.length) { cells.push(cell); cell = []; }
      const tap = p.papx && p.papx.end > p.papx.start ? readTap(ctx.wd, p.papx.start, p.papx.end, ctx.data) : { itcMac: cells.length, centers: [], tcs: [] };
      const g = prmGrpprl(ctx, p.piece);
      if (g) { const t2 = readTap(g, 0, g.length, ctx.data); if (t2.itcMac) Object.assign(tap, t2); }
      rows.push({ cells, tap, ttp: p });
      cells = [];
      continue;
    }
    cell.push(p);
    if (p.itap === depth && p.cellEnd) { cells.push(cell); cell = []; }
  }
  if (cell.length) cells.push(cell);
  if (cells.length) rows.push({ cells, tap: { itcMac: cells.length, centers: [], tcs: [] } });
  return rows;
}

// Column grid for the whole table (the union of every row's cell edges — what Word itself
// writes as a .docx's w:tblGrid), then each cell's span across it (≙ w:gridSpan).
function cellSpans(rows) {
  const edges = new Set();
  for (const r of rows) for (const c of r.tap.centers || []) edges.add(Math.round(c / 10));
  const grid = [...edges].sort((a, b) => a - b);
  return (row) => {
    const cs = row.tap.centers || [];
    return row.cells.map((_, i) => {
      if (cs.length < i + 2) return 1;
      const a = grid.indexOf(Math.round(cs[i] / 10)), b = grid.indexOf(Math.round(cs[i + 1] / 10));
      return a >= 0 && b > a ? b - a : 1;
    });
  };
}

// ---------------------------------------------------------------------------------------
// K36d (BANA §7 box/sidebar detection): a bordered paragraph run — parity with parse.mjs's
// docxParaBorderInfo (see the file comment above it for the three ways Word fakes a sidebar
// with no native box element; this is way 1, "a paragraph 'box' border"). All FOUR sides
// must be a real, visible line (brcVisible, doc-props.mjs) — a bottom-only rule under a
// running head must not be misread as a box, the same reason docxParaBorderInfo requires all
// four. Returns a signature string two paragraphs share only when every side matches
// (width+type+colour index), or null when the paragraph has no border at all.
function docParaBoxKey(pap) {
  const sides = [pap.brcTop, pap.brcLeft, pap.brcBottom, pap.brcRight];
  if (!sides.every(brcVisible)) return null;
  return sides.map((s) => `${s.type}|${s.w}|${s.ico}`).join(';');
}
// A coarse ico (BRC colour index, [MS-DOC] 2.9.20's 17-entry legacy palette) → the same small
// vocabulary hexToColorName (parse.mjs) uses. Used only for the K7 transcriber's-note colour
// word, never for "is this a box" — a border's own colour is a LINE colour, not a fill, the
// same distinction parse.mjs's docxParaShadeFill comment draws (.doc paragraph shading is not
// read at all, so a .doc box gets a colour only when its OWN border line carries one).
const ICO_COLOR_NAME = [null, 'black', 'blue', 'cyan', 'green', 'purple', 'red', 'yellow', null, 'blue', 'cyan', 'green', 'purple', 'red', 'yellow', 'grey', 'grey'];
function docBrcColorName(pap) {
  const ico = pap.brcTop && pap.brcTop.ico;
  return ico ? (ICO_COLOR_NAME[ico] || null) : null;
}

// ---------------------------------------------------------------------------------------
// Build the model
// ---------------------------------------------------------------------------------------
async function buildModel(cfb, wd) {
  const symLog = new Map();                                    // import fix list #36: symbols with no Unicode equivalent, named in the load warning
  const prevSymLog = parseMod.setDocxSymbolLog(symLog);
  try { return await buildModelRead(cfb, wd, symLog); } finally { parseMod.setDocxSymbolLog(prevSymLog); }
}
async function buildModelRead(cfb, wd, symLog) {
  const ctx = openDoc(cfb, wd);
  const { subs } = ctx;
  const notes = { ftn: readNotes(ctx, 'PlcffndRef', 'PlcffndTxt', subs.ftn), edn: readNotes(ctx, 'PlcfendRef', 'PlcfendTxt', subs.edn) };
  const story = {
    fields: [], notes, legacyEq: { count: 0, oleCount: 0 }, readSegs: new Set(), cellPictures: [],
    noteMarks: { fn: 0, en: 0, fnMarks: new Map(), enMarks: new Map() },
    seenNotes: new Set(),
  };
  const textboxes = textboxesOf(ctx);                          // anchor CP → [{start,end}] text box stories
  const paras = paragraphsIn(ctx, subs.main.start, subs.main.end);
  // K36d (BANA §7 box/sidebar detection, "a paragraph 'box' border" — see docParaBoxKey,
  // above): a run of consecutive top-level (itap 0) paragraphs sharing the identical border
  // is boxed, exactly like parse.mjs's own docxParaBorderInfo pre-pass over `children` — done
  // here, before the main walk below ever sees `paras`, by splicing BOX_START/BOX_END around
  // the run (the main walk then lays out the run's paragraphs completely unchanged, headings/
  // lists/tables/pictures and all; only the sentinels mark where to cut the result out into
  // one box). A table's own paragraphs (itap>0) always break a run, so this never reaches
  // into a cell.
  {
    let i = 0;
    while (i < paras.length) {
      const p0 = paras[i];
      if (p0.itap > 0) { i++; continue; }
      const key = docParaBoxKey(p0.pap);
      if (!key) { i++; continue; }
      let j = i + 1;
      while (j < paras.length && paras[j].itap === 0 && docParaBoxKey(paras[j].pap) === key) j++;
      const boxColor = docBrcColorName(p0.pap);
      paras.splice(j, 0, BOX_END);
      paras.splice(i, 0, makeBoxStart(boxColor));
      i = j + 2;                       // resume right after the run and both sentinels just inserted
    }
  }
  const blocks = [];
  let title = null;
  let pendingList = null;
  let listCounters = new Map();
  const pendingBoxWraps = [];          // K36d: a stack of { start, boxColor } — see BOX_START/BOX_END, above
  const flushList = () => {
    if (pendingList) {
      blocks.push(pendingList);
      for (const item of pendingList.items) {
        blocks.push(...collectNoteBlocks(ctx, item.segments, story));
        for (const b of item.blocks || []) if (b && Array.isArray(b.segments)) blocks.push(...collectNoteBlocks(ctx, b.segments, story));
      }
      pendingList = null;
    }
  };
  // List items with more than one paragraph, or with a table inside them (item.blocks; document.mjs
  // formatItemBlocks) -- the same continuation rule parse.mjs's docxContinuesItem/docxAddItemPara apply.
  const lastItem = () => (pendingList && pendingList.items.length ? pendingList.items[pendingList.items.length - 1] : null);
  // An un-numbered paragraph (ilfoHere falsy) right after a numbered item continues that item.
  const continuesItem = (ilfoHere) => {
    const last = lastItem();
    if (!last || !last._numbered) return false;
    return !ilfoHere;
  };
  const addItemPara = (b) => { (lastItem().blocks ||= []).push(b); };
  // A data table directly after a numbered item and indented like the list (>=360 twips, the same
  // threshold docxTblIndent/docxParaIndentLeft use) is inside that item: settled one loop turn later,
  // once the blocks the table run produced are all in `blocks` (mirrors parse.mjs's
  // pendingInItemTable/settleInItemTable).
  let pendingInItemTable = null;
  const settleInItemTable = () => {
    const t = pendingInItemTable;
    pendingInItemTable = null;
    if (!t) return;
    const added = blocks.slice(t.start);
    if (!added.some((b) => b && b.type === 'table') || added.some((b) => !b || !['table', 'footnote', 'note'].includes(b.type))) return;
    blocks.splice(t.start);
    const last = t.list.items[t.list.items.length - 1];
    (last.blocks ||= []).push(...added);
    if (!pendingList && blocks[blocks.length - 1] === t.list) { blocks.pop(); pendingList = t.list; }   // the list goes on after the table
  };
  const graphicBlock = (img) => {
    const g = { type: 'graphic', src: img.src || '', alt: img.alt || '' };
    if (img._res) g._res = img._res;
    return g;
  };
  // A text box's own paragraphs, in place (parse.mjs pushDocxTxbxParagraph): heading/title/para only.
  const pushTextbox = (range, target) => {
    const tparas = paragraphsIn(ctx, range.start, range.end);
    const sub = { ...story, fields: [] };
    for (const tp of tparas) {
      if ((tp.pap.itap || 0) > 0 && tp.pap.fTtp) continue;
      const c = paraContent(ctx, tp, sub);
      if (!c.text && !c.hasSeg) continue;
      const cls = tp.directOutLvl != null && tp.directOutLvl <= 8 ? { kind: 'heading', level: tp.directOutLvl + 1 } : classifyStyle(ctx, tp.pap.istd);
      if (cls && cls.kind === 'title') target.push({ type: 'title', text: c.text });
      else if (cls && cls.kind === 'heading') target.push(c.hasSeg ? { type: 'heading', level: Math.min(6, cls.level), segments: c.segments, text: c.text } : { type: 'heading', level: Math.min(6, cls.level), text: c.text });
      else target.push(c.hasSeg ? { type: 'para', segments: c.segments } : { type: 'para', text: c.text });
      if (c.hasSeg) target.push(...collectNoteBlocks(ctx, c.segments, story));
    }
  };
  // K7/BANA §7 (box/sidebar detection — matches parse.mjs's docxTxbxBoxInfo, the .docx text-box
  // check): a text box whose OfficeArt shape has an EXPLICIT fill and/or line (doc-art.mjs's
  // shapeAt: shape.hasFill/hasLine, from [MS-ODRAW]'s FillStyleBooleanProperties/
  // LineStyleBooleanProperties, never an unset default) is a box, exactly like its DrawingML/
  // VML counterpart in a .docx saved from the same source — real-file parity, found comparing
  // this LibreOffice .doc fixture against its own .docx export (Emboss/tests/doc_reader.test.mjs,
  // "LibreOffice .doc: a plain text box…", fixtures lo-textbox.doc/.docx). An undecorated text
  // box (no explicit fill or line at all — the common case: a running head/title box) is read
  // exactly as before, flat paragraphs in reading order.
  const anchoredContent = (anchors, target) => {
    for (const cp of anchors) {
      const shape = ctx.art.shapeAt(cp);
      if (!shape) continue;
      if (shape.image) target.push(graphicBlock(shape.image));
      // An embedded object's story holds only its EMBED field (read by floatingOle), never text.
      if (shape.ole) continue;
      for (const range of textboxes.get(shape.spid) || []) {
        if (shape.hasFill || shape.hasLine) {
          const start = target.length;
          pushTextbox(range, target);
          const inner = target.splice(start, target.length - start);
          if (inner.length) {
            const box = { type: 'box', render: 'required' };
            const boxTitle = parseMod.extractBoxTitle(inner);
            if (boxTitle) box.title = boxTitle;
            if (shape.hasFill && shape.fillColorHex) {
              const name = parseMod.hexToColorName(shape.fillColorHex);
              if (name) box.boxColor = name;
            }
            box.blocks = inner;
            target.push(box);
          }
        } else {
          pushTextbox(range, target);
        }
      }
    }
  };

  const pushBreakLines = (tokens, target) => {
    const lines = [[]];
    for (const t of tokens) { if (t.t === 'lb') lines.push([]); else lines[lines.length - 1].push(t); }
    const contents = lines.map((lt) => {
      const r = tokensToSegments(ctx, lt, story);
      const segs = r.segments;
      const hasSegL = !!(segs.length && segs.some((s) => s.tf || s.href || s.type === 'noteref' || s.type === 'imgnote' || s.type === 'math' || s.type === 'linenum' || s.uncontracted || s.transcriberTypeform || s.lang));
      return { text: r.plain.replace(/\s+/g, ' ').trim(), segs, hasSegL };
    });
    const nonEmpty = contents.map((x, i) => (x.text ? i : -1)).filter((i) => i >= 0);
    if (!nonEmpty.length) return false;
    for (let i = nonEmpty[0]; i <= nonEmpty[nonEmpty.length - 1]; i++) {
      const x = contents[i];
      // #50: poem-style lines are a poem's lines (fromPoem, as parse.mjs's docxPushShiftBreakLines), so a save writes a <poem>
      if (!x.text) { target.push({ type: 'indicator', kind: 'line', fromPoem: true }); continue; }
      target.push(x.hasSegL ? { type: 'play', subtype: 'verse', style: 'verse', text: x.text, segments: x.segs, fromPoem: true } : { type: 'play', subtype: 'verse', style: 'verse', text: x.text, fromPoem: true });
      if (x.hasSegL) target.push(...collectNoteBlocks(ctx, x.segs, story));
    }
    return true;
  };
  // ---- tables: layout or data (table-kind.mjs, as parseDocx), and table captions ----
  const tableCache = new Map();                                // first paragraph of a table run → { rows, desc, kind }
  const tableRunEnd = (i) => { let j = i; while (j < paras.length && paras[j] !== LAYOUT_CELL_BREAK && paras[j].itap > 0) j++; return j; };
  const tableAt = (i) => {
    const first = paras[i];
    if (!tableCache.has(first)) {
      const rows = tableRows(ctx, paras.slice(i, tableRunEnd(i)));
      const desc = tableDescription(ctx, rows, story);
      tableCache.set(first, { rows, desc, kind: classifyTable(desc) });
    }
    return tableCache.get(first);
  };
  const tableLog = [];
  let pendingTableCaption = null;                              // a caption paragraph just before a table
  let unwrapCount = 0;
  let skipTableCaption = null;                                 // the caption paragraph just after a table, already used

  let pendingDropCap = null;
  let skipCaption = null;
  for (let idx = 0; idx < paras.length; idx++) {
    settleInItemTable();                                        // the table just read belongs inside the list item before it?
    const p = paras[idx];
    // The boundary between two cells of an unwrapped layout table: a list never runs on.
    if (p === LAYOUT_CELL_BREAK) { flushList(); continue; }
    // K36d box/sidebar sentinels — see makeBoxStart/BOX_END, above.
    if (isBoxStart(p)) { flushList(); pendingBoxWraps.push({ start: blocks.length, boxColor: p.boxColor }); continue; }
    if (p === BOX_END) {
      flushList();
      const pend = pendingBoxWraps.pop();
      if (pend) {
        const inner = blocks.splice(pend.start, blocks.length - pend.start);
        if (inner.length) {
          const box = { type: 'box', render: 'required' };
          const boxTitle = parseMod.extractBoxTitle(inner);
          if (boxTitle) box.title = boxTitle;
          if (pend.boxColor) box.boxColor = pend.boxColor;
          box.blocks = inner;
          blocks.push(box);
        }
      }
      continue;
    }
    // ---- tables ----
    if (p.itap > 0) {
      const j = tableRunEnd(idx);
      const info = tableAt(idx);
      // A data table directly after a numbered item and indented like the list (rgdxaCenter[0]
      // >= 360 twips, the same threshold docxTblIndent uses on w:tblInd) belongs inside that item.
      const tblIndent = info.rows[0] ? (info.rows[0].tap.centers[0] || 0) : 0;
      const itemList = lastItem() && lastItem()._numbered && tblIndent >= 360 ? pendingList : null;
      flushList();
      if (itemList) pendingInItemTable = { list: itemList, start: blocks.length };   // settled at the next turn (settleInItemTable)
      let tblCaption = pendingTableCaption;
      pendingTableCaption = null;
      const nextCap = tableCaptionInfo(ctx, paras[j], story);
      let kind = (tblCaption && tblCaption.label) || (nextCap && nextCap.label) ? { kind: 'data', reason: 'table caption' } : info.kind;
      if (kind.kind === 'layout' && info.rows.length) kind = docNestedTableKeeps(ctx, info.rows, kind, story);   // IMP-W6: a small table holding a nested table is kept as a table
      if (kind.kind === 'layout' && info.rows.length && ++unwrapCount > 10000) kind = { kind: 'data', reason: 'too deeply nested to unwrap' };   // damaged file: always make progress
      tableLog.push({ kind: info.rows.length ? kind.kind : 'none', reason: info.rows.length ? kind.reason : 'no rows' });
      if (!info.rows.length || kind.kind === 'layout') {
        // A layout table is not a table (BANA §11.1.1, §11.2.3): its cells' own content is read
        // in reading order — row by row, cell by cell — spliced into the body walk in the
        // table's place, one table level shallower (a nested table is classified in its turn).
        const pieces = [];
        if (tblCaption) pieces.push(tblCaption.para);
        // K36d/K7: a TRUE 1x1 table (one row, one cell — table-kind.mjs already classifies it
        // "layout", the same "single column" rule a wider single-column table gets) whose one
        // cell is bordered (readTap's tap.tcs[0].bordered, doc-props.mjs) and holds several
        // (>=2) non-blank paragraphs becomes a box, not plain flattened paragraphs — parity
        // with parse.mjs's docxTcBoxInfo (K7/BANA §7; unlike docx, cell shading is not read
        // here, so a .doc table box never carries a colour). Checked only for a genuinely
        // single-row, single-cell table, matching docxTcBoxInfo's own "singleTc" restriction.
        // pendingBoxWraps is pushed directly (not via a BOX_START sentinel) since nothing else
        // can run before the matching BOX_END, spliced in below, closes it — see
        // makeBoxStart's own comment.
        const singleCell = info.rows.length === 1 && info.rows[0].cells.length === 1 ? info.rows[0].cells[0] : null;
        const singleTc = singleCell ? (info.rows[0].tap.tcs[0] || null) : null;
        const nonBlankParas = singleCell ? singleCell.filter((pp) => plainChars(ctx, pp).trim()).length : 0;
        const boxWorthy = !!(singleTc && singleTc.bordered && nonBlankParas >= 2);
        if (boxWorthy) pendingBoxWraps.push({ start: blocks.length });
        for (const row of info.rows) for (const cell of row.cells) pieces.push(...cell.map((q) => ({ ...q, itap: q.itap - 1 })), boxWorthy ? BOX_END : LAYOUT_CELL_BREAK);
        paras.splice(idx, j - idx, ...pieces);
        idx--;
        continue;
      }
      // A label ("Table 3: …") is the table's heading (block.title); any other caption is a
      // standalone caption block before the table (BANA §11.2.8a).
      let titleCap = tblCaption && tblCaption.label ? tblCaption : null;
      const plainCap = tblCaption && !tblCaption.label ? tblCaption : (nextCap && !nextCap.label ? nextCap : null);
      if (nextCap && nextCap.label && !titleCap) titleCap = nextCap;
      if (nextCap && (nextCap === titleCap || nextCap === plainCap)) skipTableCaption = paras[j];
      if (plainCap) blocks.push({ type: 'caption', text: plainCap.text });
      pushTable(ctx, info.rows, story, blocks, titleCap ? titleCap.text : null, tableLog);
      idx = j - 1;
      continue;
    }
    if (p === skipCaption) continue;
    if (p === skipTableCaption) continue;
    // A caption paragraph just before a data table is held for that table.
    if (paras[idx + 1] && paras[idx + 1] !== LAYOUT_CELL_BREAK && paras[idx + 1].itap > 0) {
      const cap = tableCaptionInfo(ctx, p, story);
      if (cap && (cap.label || tableAt(idx + 1).kind.kind === 'data')) {
        flushList();
        pendingTableCaption = { ...cap, para: p };
        continue;
      }
    }
    const c = paraContent(ctx, p, story);
    // pictures (inline and floating) come before the paragraph's own text, as in parseDocx
    const imgs = c.images.slice();
    const floating = [];
    anchoredContent(c.anchors, floating);
    const floatingImgs = floating.filter((b) => b.type === 'graphic');
    if (imgs.length || floatingImgs.length) {
      flushList();
      const next = paras[idx + 1];
      const nextIsCaption = next && next !== LAYOUT_CELL_BREAK && !(next.itap > 0) && isCaptionPara(ctx, next);
      const captionText = nextIsCaption ? paraContent(ctx, next, sandbox(story)).text : '';
      const all = [...imgs.map(graphicBlock), ...floatingImgs];
      all.forEach((g, i) => { if (captionText && i === all.length - 1) g.caption = captionText; blocks.push(g); });
      if (nextIsCaption) skipCaption = next;
    }
    const tbx = floating.filter((b) => b.type !== 'graphic');
    if (tbx.length) { flushList(); blocks.push(...tbx); }

    let { segments, text, hasSeg } = c;
    // A drop cap (sprmPDcs) is its own tiny paragraph holding the dropped letter(s); print
    // shows one paragraph, so it joins the start of the next one (.docx: docx-fix item 9).
    if (pendingDropCap) {
      const dc = pendingDropCap;
      if (dc.hasSeg || hasSeg) {
        const dcSegs = dc.hasSeg ? dc.segments : (dc.text ? [{ type: 'text', text: dc.text }] : []);
        const curSegs = hasSeg ? segments : (text ? [{ type: 'text', text }] : []);
        segments = [...dcSegs, ...curSegs];
        hasSeg = true;
      }
      text = dc.text + text;
      pendingDropCap = null;
    }
    const sname = styleKey(styleNameOf(ctx, p.pap.istd));
    const isPlainListItem = sname === 'embossplainlist';
    const isDedicationStyle = /dedication/.test(sname);   // K30 / BANA 2.9.1f: a paragraph styled "Dedication"
    const ilfo = p.pap.ilfo > 0 && p.pap.ilfo < 0x7FF && ctx.lists.lfos[p.pap.ilfo - 1] ? p.pap.ilfo : 0;
    const cls = p.directOutLvl != null && p.directOutLvl <= 8 ? { kind: 'heading', level: p.directOutLvl + 1 } : classifyStyle(ctx, p.pap.istd);
    // A numbered heading (a list linked to the Heading styles) is a heading with its number,
    // not a list item (.docx: docx-fix item 1).
    const headingNum = cls && cls.kind === 'heading' && ilfo > 0;
    // parity with parse.mjs's `!!directNumPr`: a paragraph whose OWN direct formatting carries an
    // explicit sprmPIlfo record (p.hasDirectIlfo) is a list item -- with a marker when it resolves
    // to a real list (ilfo > 0), without one when the direct record cancels the style's list (ilfo
    // resolves to 0 here even though the style itself has a real one) -- not a plain paragraph.
    const isList = !headingNum && (isPlainListItem || ilfo > 0 || sname.includes('listparagraph') || p.hasDirectIlfo);
    // Contents entries: the "toc 1"–"toc 9" styles Word's Insert › Table of Contents applies,
    // or a line whose dot-leader tab stop is followed by a page number (.docx: docx-fix items
    // 4/5). Entry text and page number split at the last tab.
    const tocLevel = tocStyleLevel(ctx, p.pap.istd);
    const tocSplit = () => {
      const t = c.plainTabs;
      const i = t.lastIndexOf('\t');
      return i < 0 ? { before: t.replace(/\s+/g, ' ').trim(), after: null } : { before: t.slice(0, i).replace(/\s+/g, ' ').trim(), after: t.slice(i + 1).replace(/\s+/g, ' ').trim() };
    };
    const pushTocItem = (item) => {
      let last = blocks[blocks.length - 1];
      if (!last || last.type !== 'list' || last.kind !== 'toc') { last = { type: 'list', kind: 'toc', style: 'toc', items: [] }; blocks.push(last); }
      last.items.push(item);
    };
    if (tocLevel != null) {
      flushList();
      const { before, after } = tocSplit();
      if (before || after) {
        const item = { text: before };
        if (after) item.page = after;
        if (tocLevel > 0) item.level = tocLevel;
        pushTocItem(item);
      }
      continue;
    }
    if (p.pap.tabs && [...p.pap.tabs.values()].includes(1)) {
      const { before, after } = tocSplit();
      if (before && after && /^(?:\d+|[ivxlcdm]+)$/i.test(after)) { flushList(); pushTocItem({ text: before, page: after }); continue; }
    }
    if (p.pap.dcs) { pendingDropCap = { text, hasSeg, segments }; continue; }
    if (!text && !hasSeg) { flushList(); continue; }
    // An old-style equation standing alone in an ordinary paragraph is a display equation
    // (.docx: the same `math` block a body-level m:oMathPara gives).
    const alone = segments.filter((s) => !(s.type === 'text' && !String(s.text || '').trim()));
    if (!isList && !text && alone.length === 1 && story.readSegs.has(alone[0]) && p.directOutLvl == null
      && !(classifyStyle(ctx, p.pap.istd)) && !Object.prototype.hasOwnProperty.call(EMBOSS_PARA_STYLES, sname)) {
      flushList();
      blocks.push({ ...alone[0] });
      continue;
    }
    if (isList) {
      // A list-styled paragraph with no numbering of its own (ilfo 0 -- e.g. a "List Paragraph"
      // paragraph right after a numbered item, with only its indent carried over) is that item's
      // further paragraph (Word: "indent to the list text" continuation), kept in item.blocks --
      // not a new, unmarked item flush left (document.mjs formatItemBlocks, BANA §10.3.3).
      if (!isPlainListItem && continuesItem(ilfo)) { addItemPara(hasSeg ? { type: 'para', text, segments } : { type: 'para', text }); continue; }
      if (!pendingList) pendingList = { type: 'list', items: [] };
      let ilvl = Math.max(0, Math.min(8, p.pap.ilvl || 0));
      if (isPlainListItem) ilvl = Math.max(0, Math.min(8, Math.round(((p.pap.dxaLeft || 0) - 720) / 360)));
      const marker = ilfo ? listMarker(ctx.lists.level, listCounters, ilfo, ilvl, (lv) => lvlFontName(ctx, lv)) : null;
      const item = hasSeg ? { segments } : { text };
      if (marker) item.marker = marker;
      if (ilvl) item.level = ilvl;
      if (ilfo) Object.defineProperty(item, '_numbered', { value: true });   // may take further paragraphs (continuesItem)
      pendingList.items.push(item);
      continue;
    }
    // An ordinary paragraph indented at least as far as a list's text (dxaLeft >= 360 twips), with no
    // numbering, directly after a numbered item: that item's further paragraph too. A paragraph that
    // is not indented ends the list.
    if (!(cls && (cls.kind === 'heading' || cls.kind === 'title')) && !Object.prototype.hasOwnProperty.call(EMBOSS_PARA_STYLES, sname)
      && (p.pap.dxaLeft || 0) >= 360 && continuesItem(ilfo)) {
      addItemPara(hasSeg ? { type: 'para', text, segments } : { type: 'para', text });
      continue;
    }
    flushList();
    const embKind = Object.prototype.hasOwnProperty.call(EMBOSS_PARA_STYLES, sname) ? EMBOSS_PARA_STYLES[sname] : null;
    if (embKind) {
      const b = { ...embKind, text };
      if (hasSeg) b.segments = segments;
      blocks.push(b);
      if (hasSeg) blocks.push(...collectNoteBlocks(ctx, segments, story));
      continue;
    }
    // IMP-W2 (Paul, 30 Sep 2026): Shift+Enter in an ordinary paragraph is a forced line break inside that ONE paragraph ('\n' in the
    // segment text); the verse-line split is kept only for a poem / verse style (as the .docx reader).
    let shiftBreakHandled = false;
    if (!cls && c.tokens.some((t) => t.t === 'lb')) {
      if (docIsVerseStyle(ctx, p.pap.istd)) shiftBreakHandled = pushBreakLines(c.tokens, blocks);
      else if (c.breakSegments && c.breakSegments.some((sg) => sg.type === 'text' && sg.text === '\n')) { segments = c.breakSegments; hasSeg = true; }
    }
    if (cls && cls.kind === 'title') {
      // IMP-W1: a Subtitle goes with the Title just before it (the second line of the same heading); with no Title before it, it is an
      // ordinary paragraph, never a chapter of its own.
      const prevB = blocks[blocks.length - 1];
      if (cls.subtitle && parseMod.titleTakesSubtitle(prevB) && text) parseMod.mergeSubtitleIntoTitle(prevB, text);
      else if (cls.subtitle && blocks.length) blocks.push(hasSeg ? { type: 'para', segments } : { type: 'para', text });
      else { title = title || text; blocks.push({ type: 'title', text }); }
    }
    else if (cls && cls.kind === 'heading') {
      const level = Math.min(6, cls.level);
      let headingText = text, headingSegments = segments;
      if (headingNum) {
        const marker = listMarker(ctx.lists.level, listCounters, ilfo, Math.max(0, Math.min(8, p.pap.ilvl || 0)));
        if (marker) {
          headingText = `${marker} ${text}`;
          if (hasSeg) headingSegments = [{ type: 'text', text: `${marker} ` }, ...segments];
        }
      }
      blocks.push(hasSeg ? { type: 'heading', level, segments: headingSegments, text: headingText } : { type: 'heading', level, text: headingText });
    } else if (!shiftBreakHandled) {
      blocks.push(hasSeg ? (segments.some((s) => s.type === 'linenum') ? { type: 'para', segments, text } : { type: 'para', segments }) : { type: 'para', text });
      if (isDedicationStyle) blocks[blocks.length - 1].dedication = true;   // K30
    }
    if (hasSeg && !shiftBreakHandled) blocks.push(...collectNoteBlocks(ctx, segments, story));
  }
  settleInItemTable();                                          // a table that was the very last body element
  flushList();
  if (pendingDropCap) {
    const dc = pendingDropCap;
    if (dc.text || dc.hasSeg) blocks.push(dc.hasSeg ? { type: 'para', segments: dc.segments, text: dc.text } : { type: 'para', text: dc.text });
    pendingDropCap = null;
  }

  const result = { title, blocks };
  const resources = await collectResources(blocks, story.cellPictures);
  if (resources.length) result.resources = resources;
  Object.defineProperty(result, 'tableKinds', { value: tableLog, enumerable: false, configurable: true, writable: true });   // table-kind.mjs decisions, for tests and audits
  // The summary information's title/author, as parseDocx uses docProps/core.xml (docx-fix
  // item 10): the title only as a fallback for a document with no Title paragraph.
  const meta = readSummaryInfo(cfb.getStream('\x05SummaryInformation'));
  if (!result.title && meta.title) result.title = meta.title;
  if (meta.author) (result.metadata || (result.metadata = {})).creator = meta.author;
  const warnings = [...ctx.warnings];
  if (story.legacyEq.count) {
    warnings.push(`${story.legacyEq.count} old-style equation${story.legacyEq.count === 1 ? '' : 's'} (Equation Editor 3.0 / MathType) could not be read; ` +
      `${story.legacyEq.count === 1 ? 'it has' : 'they have'} been replaced with a placeholder and must be re-entered with the equation editor`);
  }
  if (story.legacyEq.oleCount) {
    const n = story.legacyEq.oleCount;
    warnings.push(`${n} embedded object${n === 1 ? '' : 's'} (e.g. a spreadsheet, another document, or another embedded file) could not be read; ` +
      `${n === 1 ? 'it has' : 'they have'} been replaced with a placeholder.`);
  }
  if (ctx.damagedParas && ctx.damagedParas.size) {
    const n = ctx.damagedParas.size;
    warnings.push(`${n} paragraph${n === 1 ? '' : 's'} of this Word document ${n === 1 ? 'has' : 'have'} damaged formatting; ${n === 1 ? 'its' : 'their'} text was kept without formatting.`);
  }
  const symWarning = parseMod.symbolLogWarning(symLog);      // import fix list #36
  if (symWarning) warnings.push(symWarning);
  const leftOut = parseMod.leftOutNotice(docLeftOut(ctx));   // IMP-W9
  if (leftOut) warnings.push(leftOut);
  if (warnings.length) result.warnings = warnings;
  return finishLanguages(result);                          // foreign-language runs: noise dropped (input/lang.mjs)
}

// IMP-W9 (Paul, 30 Sep 2026): the comments, running headers and running footers of a .doc, which are not transcribed — counted for the
// load notice. A story's text has its field codes dropped and the results of page-number / date fields left out (a footer of only
// "Page {PAGE} of {NUMPAGES}" holds no text).
const DOC_FURNITURE_FIELD_RE = /^\s*(?:PAGE|NUMPAGES|SECTIONPAGES|SECTION|DATE|TIME|SAVEDATE|PRINTDATE|CREATEDATE)\b/i;
function docStoryText(ctx, start, end) {
  let out = '', code = '';
  const stack = [];
  for (let cp = start; cp < end && cp < ctx.text.length; cp++) {
    const c = ctx.text.charCodeAt(cp);
    if (c === 0x13) { stack.push({ code: '', result: false }); continue; }
    if (c === 0x14) { if (stack.length) stack[stack.length - 1].result = true; continue; }
    if (c === 0x15) { stack.pop(); continue; }
    const top = stack[stack.length - 1];
    if (top && !top.result) { top.code += ctx.text[cp]; continue; }                // a field's instruction text
    if (stack.some((f) => f.result && DOC_FURNITURE_FIELD_RE.test(f.code))) continue;
    out += c === 0x0D || c === 0x07 ? ' ' : c < 0x20 ? '' : ctx.text[cp];
  }
  return out;
}
function docLeftOut(ctx) {
  const n = { comments: 0, headers: 0, footers: 0 };
  const { subs } = ctx;
  try {
    // comments: the annotation story, one per PlcfandTxt entry (the whole story as one when that table is missing)
    if (subs.atn.end > subs.atn.start) {
      const texts = [];
      const t = ctx.fib.fcLcb.PlcfandTxt;
      if (t && t.lcb) {
        const tp = readPlc(ctx.table, t.fc, t.lcb, 0);
        for (let i = 0; i + 1 < tp.cps.length; i++) texts.push(docStoryText(ctx, subs.atn.start + tp.cps[i], Math.min(subs.atn.end, subs.atn.start + tp.cps[i + 1])));
      }
      if (!texts.length) texts.push(docStoryText(ctx, subs.atn.start, subs.atn.end));
      n.comments = texts.filter(parseMod.isRealLeftOutText).length;
    }
  } catch { /* unreadable comments: no count */ }
  try {
    // headers and footers: PlcfHdd — stories 0-5 are the note separators; then six per section: even header, odd header, even footer,
    // odd footer, first-page header, first-page footer. Without the table, the whole header story counts as one header.
    if (subs.hdd.end > subs.hdd.start) {
      const hdr = [], ftr = [];
      const h = ctx.fib.fcLcb.PlcfHdd;
      if (h && h.lcb) {
        const hp = readPlc(ctx.table, h.fc, h.lcb, 0);
        for (let i = 6; i + 1 < hp.cps.length; i++) {
          const role = (i - 6) % 6;
          (role === 2 || role === 3 || role === 5 ? ftr : hdr).push(docStoryText(ctx, subs.hdd.start + hp.cps[i], Math.min(subs.hdd.end, subs.hdd.start + hp.cps[i + 1])));
        }
      } else hdr.push(docStoryText(ctx, subs.hdd.start, subs.hdd.end));
      n.headers = parseMod.countDistinctRealTexts(hdr);
      n.footers = parseMod.countDistinctRealTexts(ftr);
    }
  } catch { /* unreadable headers/footers: no count */ }
  return n;
}

// IMP-W6 (Paul, 30 Sep 2026; parse.mjs docxNestedTableKeeps): table-kind.mjs calls a one-row / one-column table, or one with a
// nested-table cell and no heading-like first row, page layout — which would flatten both tables to paragraphs. A SMALL table (cells of
// a few words, no heading, list or picture) holding a nested table is kept as a table instead; the nested table follows it.
function docNestedTableKeeps(ctx, rows, kind, story) {
  if (!/^(single row|single column|a cell holds a nested table)$/.test(kind.reason || '')) return kind;
  const sb = sandbox(story);
  let cells = 0, nested = 0;
  for (const row of rows) {
    for (const cellParas of row.cells) {
      cells++;
      if (cellParas.some((q) => q.itap > 1)) nested++;
      const own = cellParas.filter((q) => q.itap <= 1 && !q.rowEnd);
      let len = 0, n = 0;
      for (const q of own) {
        const c = paraContent(ctx, q, sb);
        if (c.images.length || c.anchors.some((a) => { const sh = ctx.art.shapeAt(a); return sh && sh.image; })) return kind;
        if (!c.text) continue;
        n++; len += c.text.length;
        if ((q.directOutLvl != null && q.directOutLvl <= 8) || classifyStyle(ctx, q.pap.istd)) return kind;
        const ilfo = q.pap.ilfo > 0 && q.pap.ilfo < 0x7FF && ctx.lists.lfos[q.pap.ilfo - 1];
        if (ilfo || /listparagraph/.test(styleKey(styleNameOf(ctx, q.pap.istd)))) return kind;
      }
      if (n > 2 || len > 120) return kind;
    }
  }
  return nested && cells >= 2 ? { kind: 'data', reason: 'holds a nested table (IMP-W6)' } : kind;
}

function pushTable(ctx, rows, story, blocks, title, tableLog = null, depth = 1) {
  const spanOf = cellSpans(rows);
  const afterTable = [];
  const nestedBlocks = [];                                     // IMP-W6: the tables nested in this one, to follow it
  const cellValue = (cellParas) => {
    const segs = [];
    const paraTexts = [];
    // IMP-W6: a run of paragraphs deeper than this table is a nested table: a placeholder stands in the cell and the table follows.
    const items = [];
    for (const cp of cellParas) {
      const last = items[items.length - 1];
      if (cp.itap > depth) { if (last && last.run) last.run.push(cp); else items.push({ run: [cp] }); } else items.push({ cp });
    }
    for (const item of items) {
      if (item.run) {
        const nrows = tableRows(ctx, item.run, depth + 1);
        if (nrows.length) {
          if (tableLog) tableLog.push({ kind: 'data', reason: 'nested table (IMP-W6)' });
          pushTable(ctx, nrows, story, nestedBlocks, null, tableLog, depth + 1);
          paraTexts.push(parseMod.NESTED_TABLE_PLACEHOLDER);
          if (segs.length) segs.push({ type: 'text', text: ' ' });
          segs.push({ type: 'text', text: parseMod.NESTED_TABLE_PLACEHOLDER });
          continue;
        }
      }
      for (const cp of item.run || [item.cp]) {
        if (cp.itap > depth && cp.rowEnd) continue;              // a nested table's row-end mark
        const c = paraContent(ctx, cp, story);
        paraTexts.push(c.text);
        const ps = c.segments.slice();
        // A picture in a data table's cell stays in its cell: an embedded transcriber's note with
        // its description (BANA §10.11.1), exported as the cell's own <img> (parse.mjs, DOCX).
        const pics = [...c.images];
        for (const shapeCp of c.anchors) { const sh = ctx.art.shapeAt(shapeCp); if (sh && sh.image) pics.push(sh.image); }
        for (const img of pics) {
          const seg = { type: 'imgnote', text: img.alt || 'picture' };
          if (img._res) { seg._res = img._res; story.cellPictures.push(seg); } else { seg.prodnote = true; seg.render = 'optional'; }
          if (ps.length && !(ps[ps.length - 1].type === 'text' && /\s$/.test(ps[ps.length - 1].text || ''))) ps.push({ type: 'text', text: ' ' });
          ps.push(seg);
        }
        if (segs.length && ps.length) segs.push({ type: 'text', text: ' ' });
        segs.push(...ps);
      }
    }
    const t = paraTexts.filter(Boolean).join(' ');
    const rich = richCellFromSegments(segs);
    if (!rich) return t;
    afterTable.push(...collectNoteBlocks(ctx, segs, story));
    return rich;
  };
  // IMP-W5 (Paul, 30 Sep 2026): a merged cell (across: a cell spanning grid columns; down: the TC's vertical-merge flags, 3 = first,
  // 1 = continued) repeats its content in every cell it covers, so no column is left empty. vCarry: grid column -> the value of the
  // vertically merged cell covering it.
  const vCarry = [];
  const copyCell = (v) => (v && typeof v === 'object' ? { ...v } : v);
  const rowValues = (row) => {
    const spans = spanOf(row);
    const out = [];
    let col = 0;
    row.cells.forEach((cellParas, i) => {
      const tc = row.tap && row.tap.tcs ? row.tap.tcs[i] : null;
      const vert = tc ? tc.vert || 0 : 0;
      const own = cellValue(cellParas);
      const value = (vert & 1) && !(vert & 2) && vCarry[col] !== undefined ? vCarry[col] : own;
      const span = spans[i] || 1;
      for (let k = 0; k < span; k++) {
        out.push(k === 0 ? value : copyCell(value));
        vCarry[col + k] = vert ? value : undefined;
      }
      col += span;
    });
    return out;
  };
  // K3 (BANA 11.6.1d, transcriber KD): print's own column alignment, read from a data cell's
  // own paragraph justification — sprmPJc80/sprmPJc (doc-props.mjs's `pap.jc`), jc===2 is
  // Word's right-justified (§11.6.1c's "print text shows column entries... right-adjusted");
  // never from the digits themselves (superseded punctuation guess, F-7). Voted per column
  // across the data rows only, same convention as every other K3 reader; a column whose
  // cells disagree (or a nested table's own paragraph, itap>1) is left undetected.
  const cellAlign = (cellParas) => {
    for (const cp of cellParas) {
      if (cp.itap > depth) continue;
      if (cp.pap && cp.pap.jc === 2) return 'right';
    }
    return null;
  };
  const headers = rowValues(rows[0]);
  const bodyRows = [];
  const colAlignVotes = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rowValues(rows[i]);
    if (cells.some(Boolean)) bodyRows.push(cells);
    const spans = spanOf(rows[i]);
    let col = 0;
    rows[i].cells.forEach((cellParas, ci) => {
      const al = cellAlign(cellParas);
      if (al) (colAlignVotes[col] ||= new Set()).add(al);
      col += spans[ci] || 1;
    });
  }
  if (headers.some(Boolean) || bodyRows.length) {
    const tbl = { type: 'table', headers, rows: bodyRows };
    if (title) tbl.title = title;                               // BANA §11.3.1a/§11.3.2: the table heading
    const printAlign = colAlignVotes.map((s) => (s && s.size === 1 ? [...s][0] : undefined));
    if (printAlign.some(Boolean)) tbl.printAlign = printAlign;
    blocks.push(tbl);
  } else if (title) blocks.push({ type: 'para', text: title });
  blocks.push(...afterTable);
  blocks.push(...nestedBlocks);                                 // IMP-W6: the tables nested in this one follow it
}

// table-kind.mjs's neutral description of a table (see that file): per cell its text,
// non-empty paragraphs, pictures, headings, lists, nested tables and column span.
function tableDescription(ctx, rows, story) {
  const spanOf = cellSpans(rows);
  const sb = sandbox(story);
  const descRows = rows.map((row) => {
    const spans = spanOf(row);
    return row.cells.map((cellParas, i) => {
      const cell = { text: '', paragraphs: 0, images: 0, headings: 0, lists: 0, tables: 0, span: spans[i] || 1 };
      const texts = [];
      let prevDepth = 1;
      for (const q of cellParas) {
        if (q.itap > 1 && prevDepth <= 1) cell.tables++;
        prevDepth = q.itap;
        if (q.itap > 1 && q.rowEnd) continue;
        const c = paraContent(ctx, q, sb);
        cell.images += c.images.length + c.anchors.filter((a) => { const sh = ctx.art.shapeAt(a); return sh && sh.image; }).length;
        if (!c.text) continue;
        texts.push(c.text);
        cell.paragraphs++;
        const cls = q.directOutLvl != null && q.directOutLvl <= 8 ? { kind: 'heading' } : classifyStyle(ctx, q.pap.istd);
        if (cls) cell.headings++;
        const ilfo = q.pap.ilfo > 0 && q.pap.ilfo < 0x7FF && ctx.lists.lfos[q.pap.ilfo - 1];
        if (ilfo || /listparagraph/.test(styleKey(styleNameOf(ctx, q.pap.istd)))) cell.lists++;
      }
      cell.text = texts.join(' ');
      return cell;
    });
  });
  const tap0 = rows[0] ? rows[0].tap : null;
  return {
    rows: descRows,
    headerRow: !!(tap0 && tap0.header),
    altText: false,
    styleName: tap0 && tap0.istd != null ? (styleNameOf(ctx, tap0.istd) || null) : null,
    role: null,
  };
}

// A table caption (parse.mjs docxTableCaptionInfo): the Caption style (not Emboss's own
// EmbossCaption) or a paragraph holding a SEQ Table field. `label` = it names the table.
function tableCaptionInfo(ctx, p, story) {
  if (!p || p === LAYOUT_CELL_BREAK || p.itap > 0) return null;
  const st = ctx.styles.get(p.pap.istd);
  const name = st ? st.name || '' : '';
  const captionStyle = !!st && (st.sti === STI_CAPTION || /caption/i.test(name)) && styleKey(name) !== 'embosscaption';
  const seqTable = fieldCodesIn(ctx, p).some((code) => /\bSEQ\s+Table\b/i.test(code));
  if (!seqTable && !captionStyle) return null;
  const text = paraContent(ctx, p, sandbox(story)).text;
  if (!text || /^sources?\b/i.test(text)) return null;
  return { text, label: seqTable || /^table\s+[0-9A-Za-z]/i.test(text) };
}

// The field codes in a paragraph (outermost and nested), read straight from the text.
function fieldCodesIn(ctx, p) {
  const codes = [];
  const stack = [];
  for (let cp = p.cpStart; cp < p.cpEnd; cp++) {
    const c = ctx.text.charCodeAt(cp);
    if (c === 0x13) stack.push({ code: '', open: true });
    else if (c === 0x14 || c === 0x15) {
      const f = c === 0x15 ? stack.pop() : stack[stack.length - 1];
      if (f && f.open) { codes.push(f.code); f.open = false; }
    } else if (stack.length && stack[stack.length - 1].open) stack[stack.length - 1].code += ctx.text[cp];
  }
  return codes;
}

// A throwaway reading context: a look-ahead (caption text, table classification) must not
// number notes or mark them seen; equations still count once (the conversion is cached).
function sandbox(story) {
  return { ...story, fields: [], seenNotes: new Set(), noteMarks: { fn: 0, en: 0, fnMarks: new Map(), enMarks: new Map() } };
}

// The boundary between two cells of an unwrapped layout table (not a paragraph).
const LAYOUT_CELL_BREAK = Object.freeze({ layoutCellBreak: true, itap: 0 });
// K36d box/sidebar sentinels (parity with parse.mjs's DOCX_LAYOUT_CELL_BREAK-style trick,
// used the same way for its own '#box-start'/'#box-end'): a BOX_START (one per run — it
// carries that run's own boxColor, so, unlike LAYOUT_CELL_BREAK, it cannot be a shared
// singleton; makeBoxStart/isBoxStart below stand in for `===` identity) marks where a
// bordered paragraph run begins (spliced into `paras` by buildModel's own pre-pass, below,
// before the main walk ever sees them) and BOX_END closes it, wrapping whatever ordinary
// paragraph/heading/list/table/picture processing produced in between into one
// `{type:'box'}` block. A bordered one-cell table (also below) needs only BOX_END: nothing
// else can run between it pushing directly onto `pendingBoxWraps` and splicing in the box's
// own single cell, so no BOX_START sentinel is needed there either — see parse.mjs's
// DOCX_BOX_END comment for the identical reasoning.
const makeBoxStart = (boxColor) => Object.freeze({ boxStart: true, itap: 0, boxColor: boxColor || null });
const isBoxStart = (p) => !!(p && p.boxStart === true);
const BOX_END = Object.freeze({ boxEnd: true, itap: 0 });

// A picture's bytes → a displayable resource: PNG/JPEG/GIF/TIFF as they are, a Windows
// metafile (EMF/WMF) → SVG and a bare DIB → PNG through metafile.mjs (as the RTF reader does).
// Mac PICT, or a metafile/DIB that cannot be converted, gives no resource.
const RES_MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', tiff: 'image/tiff', svg: 'image/svg+xml' };
async function finishResource(r) {
  let bytes;
  try { bytes = await r.bytes; } catch { bytes = null; }
  if (!bytes || !bytes.length) return null;
  let ext = r.ext;
  if (ext === 'emf' || ext === 'wmf') {
    const svg = metafileToSvg(bytes);
    if (!svg) return null;
    ext = 'svg'; bytes = new TextEncoder().encode(svg);
  } else if (ext === 'dib') {
    const png = dibToPngBytes(bytes);
    if (!png) return null;
    ext = 'png'; bytes = png;
  }
  if (!RES_MIME[ext]) return null;
  return { path: `${r.name}.${ext}`, mime: RES_MIME[ext], bytes };
}

// Images carry their bytes in `_res` until here; move them to model.resources (the shape
// parseDocx's embedGraphicResources builds: { path, mime, bytes }, graphic.src = path).
async function collectResources(blocks, cellPictures = []) {
  const resources = [];
  const seen = new Map();
  const graphics = [];
  const visit = (list) => {
    for (const b of list || []) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'graphic' && b._res) graphics.push(b);
      if (Array.isArray(b.blocks)) visit(b.blocks);
      if (Array.isArray(b.items)) visit(b.items);
    }
  };
  visit(blocks);
  for (const b of graphics) {
    const r = b._res;
    delete b._res;
    if (!seen.has(r.name)) seen.set(r.name, await finishResource(r));
    const res = seen.get(r.name);
    if (!res) continue;                                       // undecodable: keep the block (alt text and all), no resource
    if (!resources.includes(res)) resources.push(res);
    b.src = res.path;
  }
  for (const seg of cellPictures) {                            // pictures kept in data-table cells (imgnote segments)
    const r = seg._res;
    delete seg._res;
    if (!r) continue;
    if (!seen.has(r.name)) seen.set(r.name, await finishResource(r));
    const res = seen.get(r.name);
    if (!res) { seg.prodnote = true; seg.render = 'optional'; continue; }
    if (!resources.includes(res)) resources.push(res);
    seg.src = res.path;
  }
  return resources;
}

