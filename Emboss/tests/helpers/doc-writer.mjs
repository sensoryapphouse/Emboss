// Test-only Word 97–2003 binary .doc WRITER, and a matching .docx writer for the same
// content, used to build the fixtures for the .doc reader (Emboss/input/doc.mjs) and its
// parity test against parseDocx. Written from [MS-DOC] / [MS-ODRAW]; not shipped in the app.
//
// No Word or LibreOffice is available to the test suite, so every structure the reader
// handles is written here from the specification, byte by byte. Real writers are covered
// separately by the textutil-made (Cocoa) and Word-made fixtures in tests/fixtures/doc/.
//
//   writeDoc(spec, opts)  -> Uint8Array   (.doc)
//   writeDocx(spec)       -> Promise<ArrayBuffer>   (.docx with the same content)
//
// spec = {
//   title?, author?,                          // \x05SummaryInformation
//   styles?: [{ name, type: 'para'|'char', sti?, basedOn?, outline?, bold?, italic?, underline?, caps?, superscript?, linked?,
//               list?: { id, level },          // this style's own default numbering (docx w:pPr/w:numPr; .doc PIlfo/PIlvl on the STD)
//               smallCaps?, strike?, vanish?, subscript? }],   // docx-parity item 3: also settable on a style, not just a direct run
//   lists?: { [id]: [{ fmt: 'decimal'|'bullet'|'lowerLetter'|'upperLetter'|'lowerRoman'|'upperRoman'|'none', text: '%1.', start: 1, legal?,
//                       font?: 'Symbol'|'Wingdings'|'Arial'|'Times New Roman' (the level's own font: a symbol bullet's) }, …]
//             | { like: <list id>, start: n } },   // a second numbering instance of that list (LFO / w:num) restarting level 0 at n
//   header?: 'running head text',             // a header story (the reader must ignore it)
//   footer?: 'running foot text',             // a footer story (likewise); with a header/footer the writer also writes the PlcfHdd
//   comments?: ['comment text', …],           // the annotation story, one entry per comment (PlcfandTxt); likewise ignored
//   body: [block],
// }
// block = { p: runs, style?, list?: { id, level }, outline?,
//           jc?,               // sprmPJc (K3, place_value_alignment.test.mjs): 0=left,1=center,2=right,3=justify
//           delMark?,          // this paragraph's OWN mark tracked deleted (joins with the next paragraph — docx-parity item 4)
//           moveFromMark? }    // this paragraph's OWN mark tracked moved-from (docx only — writeDocx, no writeDoc equivalent)
//       | { table: [[cell…]…] }  cell = runs | { blocks: [block], span?: n, vmerge?: 'restart'|'continue' }
//       | { textbox: [block] }    a floating text box anchored in an otherwise empty paragraph
//       | { floatImage: { png, alt } }
// runs = string | [run]
// run  = string | { text, b, i, u, strike, caps, smallCaps, sup, sub, vanish, del, ins, style, href, font }
//        font: this run's own direct ASCII font name (sprmCRgFtc0), added to the font table on
//        first use (K5, doc_reader / script_typeform tests) — distinct from `sym.font`, which
//        looks an EXISTING name up in the fixed `fonts` list below instead of adding one.
//      | { footnote: [block] } | { endnote: [block] } | { sym: { font, code } } | { br: true } | { tab: true }
//      | { image: { png, alt } } | { equation: mtefBytes | null (unreadable) } | { ole: 'Excel.Sheet.8' }
//      | { checkbox: { checked, res?, def?, separator?, bad? } } | { dropdown: { items, selected?, res?, def?, lo? } }   // .doc only: legacy form fields (FFData)
//      a block inside { footnote: [...] } / { endnote: [...] } may be { table: [[cell…]…] } (not the first block, which carries the mark)
//      | { field: code, result: runs } | { nbHyphen: true } | { softHyphen: true } | { pageBreak: true }

import { writeCfb } from './cfb-writer.mjs';
import { equationNative, oleEquationObject } from './mtef-writer.mjs';
import { makeZip } from '../../web/zip.mjs';

// ---------------------------------------------------------------------------------------
// byte helpers
// ---------------------------------------------------------------------------------------
class Bytes {
  constructor() { this.a = []; }
  get length() { return this.a.length; }
  u8(v) { this.a.push(v & 0xFF); return this; }
  u16(v) { this.a.push(v & 0xFF, (v >> 8) & 0xFF); return this; }
  u32(v) { this.a.push(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >>> 24) & 0xFF); return this; }
  bytes(b) { for (const x of b) this.a.push(x & 0xFF); return this; }
  pad(n, v = 0) { while (this.a.length < n) this.a.push(v); return this; }
  align(n) { while (this.a.length % n) this.a.push(0); return this; }
  utf16(s) { for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i)); return this; }
  out() { return Uint8Array.from(this.a); }
}
const le16 = (v) => [v & 0xFF, (v >> 8) & 0xFF];
const le32 = (v) => [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >>> 24) & 0xFF];

// SPRM encoders
const S = {
  b1: (sprm, v) => [...le16(sprm), v & 0xFF],
  b2: (sprm, v) => [...le16(sprm), ...le16(v)],
  b4: (sprm, v) => [...le16(sprm), ...le32(v)],
  var: (sprm, data) => [...le16(sprm), data.length, ...data],
};
const SPRM = {
  CFBold: 0x0835, CFItalic: 0x0836, CFStrike: 0x0837, CFSmallCaps: 0x083A, CFCaps: 0x083B, CFVanish: 0x083C, CKul: 0x2A3E,
  CIss: 0x2A48, CFRMarkDel: 0x0800, CFRMarkIns: 0x0801, CFSpec: 0x0855, CPicLocation: 0x6A03, CFOle2: 0x080A, CFObj: 0x0856,
  CSymbol: 0x6A09, CIstd: 0x4A30, CFData: 0x0806, CRgFtc0: 0x4A4F,   // sprmCRgFtc0 (ASCII font, K5 script-font detection)
  PIstd: 0x4600, PIlvl: 0x260A, PIlfo: 0x460B, POutLvl: 0x2640, PFInTable: 0x2416, PFTtp: 0x2417, PItap: 0x6649,
  PFInnerTableCell: 0x244B, PFInnerTtp: 0x244C, PDxaLeft: 0x845E, PJc: 0x2461,   // sprmPJc: 0=left,1=center,2=right,3=justify (K3, place_value_alignment.test.mjs)
  // K36d: paragraph border (doc-props.mjs's readBrc/applyPapSprm) — each a 4-byte BRC.
  PBrcTop: 0x6424, PBrcLeft: 0x6425, PBrcBottom: 0x6426, PBrcRight: 0x6427,
};
// K36d: a BRC (border code) as a single 32-bit value for S.b4 — little-endian, so byte 0 is
// the least-significant byte, matching readBrc's byte0=w/byte1=type/byte2=ico layout exactly.
const BRC = (w = 4, type = 1, ico = 1) => (w & 0xFF) | ((type & 0xFF) << 8) | ((ico & 0xFF) << 16);

// ---------------------------------------------------------------------------------------
// styles
// ---------------------------------------------------------------------------------------
const BUILTIN = [
  { istd: 0, name: 'Normal', type: 'para', sti: 0 },
  ...Array.from({ length: 9 }, (_, i) => ({ istd: i + 1, name: `heading ${i + 1}`, type: 'para', sti: i + 1, basedOn: 'Normal', bold: true })),
  { istd: 10, name: 'Default Paragraph Font', type: 'char', sti: 65 },
];
const EXTRA_BUILTIN = [
  { name: 'Title', type: 'para', sti: 62, basedOn: 'Normal' },
  { name: 'Subtitle', type: 'para', sti: 74, basedOn: 'Normal' },
  { name: 'caption', type: 'para', sti: 34, basedOn: 'Normal' },
  { name: 'footnote text', type: 'para', sti: 29, basedOn: 'Normal' },
  { name: 'endnote text', type: 'para', sti: 43, basedOn: 'Normal' },
  { name: 'footnote reference', type: 'char', sti: 38, superscript: true },
  { name: 'endnote reference', type: 'char', sti: 42, superscript: true },
  { name: 'Hyperlink', type: 'char', sti: 85, underline: true },
  { name: 'List Paragraph', type: 'para', sti: 179, basedOn: 'Normal' },
  { name: 'header', type: 'para', sti: 31, basedOn: 'Normal' },
  { name: 'toc 1', type: 'para', sti: 19, basedOn: 'Normal' },
  { name: 'toc 2', type: 'para', sti: 20, basedOn: 'Normal' },
];
function allStyles(spec) {
  const list = BUILTIN.map((s) => ({ ...s }));
  for (let i = 11; i < 15; i++) list.push(null);
  const extra = [...EXTRA_BUILTIN, ...(spec.styles || [])];
  for (const s of extra) {
    const at = list.findIndex((x) => x && x.name.toLowerCase() === s.name.toLowerCase());
    if (at >= 0) list[at] = { ...list[at], ...s, istd: at };
    else list.push({ ...s, istd: list.length });
  }
  return list;
}
const styleId = (name) => String(name).replace(/[^A-Za-z0-9]/g, '').replace(/^heading(\d)$/i, 'Heading$1');

function styleChpSprms(s) {
  const out = [];
  if (s.bold) out.push(...S.b1(SPRM.CFBold, 1));
  if (s.italic) out.push(...S.b1(SPRM.CFItalic, 1));
  if (s.underline) out.push(...S.b1(SPRM.CKul, 1));
  if (s.caps) out.push(...S.b1(SPRM.CFCaps, 1));
  if (s.superscript) out.push(...S.b1(SPRM.CIss, 1));
  // docx-parity item 3 test support: a style (paragraph OR character — this same function
  // already builds both, see writeStsh below) can also carry smallCaps/strike/vanish/
  // subscript, same convention as the existing bold/italic/caps/superscript fields.
  if (s.smallCaps) out.push(...S.b1(SPRM.CFSmallCaps, 1));
  if (s.strike) out.push(...S.b1(SPRM.CFStrike, 1));
  if (s.vanish) out.push(...S.b1(SPRM.CFVanish, 1));
  if (s.subscript) out.push(...S.b1(SPRM.CIss, 2));
  return out;
}

function writeStsh(styles, ilfoOf = () => 0, oldStsh = false) {
  const b = new Bytes();
  const byName = new Map(styles.filter(Boolean).map((s) => [s.name.toLowerCase(), s.istd]));
  b.u16(18);                                                  // cbStshi
  // doc_reader.test.mjs's LibreOffice-.doc-export repro: `oldStsh` writes cbSTDBaseInFile 10
  // (StdfBase only, no StdfPost2000 -- so no istdLink field at all), the shape real LibreOffice
  // 26.8 .doc export uses -- so a "linked" style (spec's `s.linked`, e.g. a Heading's auto
  // character-style twin) can ONLY be found by doc-props.mjs's readStylesheet name-based
  // fallback ("<paragraph style name> Char"), never by istdLink.
  b.u16(styles.length).u16(oldStsh ? 10 : 18).u16(1).u16(0x5B).u16(15).u16(0).u16(0).u16(0).u16(0);   // STSHI
  for (const s of styles) {
    if (!s) { b.u16(0); continue; }
    const std = new Bytes();
    const stk = s.type === 'char' ? 2 : s.type === 'table' ? 3 : 1;
    const base = s.basedOn != null ? (byName.get(String(s.basedOn).toLowerCase()) ?? 0x0FFF) : 0x0FFF;
    const cupx = stk === 1 ? 2 : stk === 3 ? 3 : 1;
    std.u16((s.sti ?? 0x0FFE) & 0x0FFF).u16(stk | (base << 4)).u16(cupx | ((stk === 1 ? s.istd : 0) << 4)).u16(0).u16(0);
    if (!oldStsh) {
      // StdfPost2000: istdLink, rsid, flags
      const link = s.linked ? (byName.get(String(s.linked).toLowerCase()) ?? 0) : 0;
      std.u16(link).u32(0).u16(0);
    }
    std.u16(s.name.length).utf16(s.name).u16(0);
    const upx = (bytes) => { std.u16(bytes.length).bytes(bytes); if (bytes.length & 1) std.u8(0); };
    if (stk === 1) {
      const pap = [...le16(s.istd)];
      if (s.outline != null) pap.push(...S.b1(SPRM.POutLvl, s.outline));
      if (s.list) pap.push(...S.b2(SPRM.PIlfo, ilfoOf(s.list.id)), ...S.b1(SPRM.PIlvl, s.list.level || 0));
      upx(pap);
      upx(styleChpSprms(s));
    } else if (stk === 3) { upx([]); upx([...le16(s.istd)]); upx([]); }
    else upx(styleChpSprms(s));
    b.u16(std.length).bytes(std.out());
  }
  return b.out();
}

// ---------------------------------------------------------------------------------------
// lists
// ---------------------------------------------------------------------------------------
const FIXED_FONTS = ['Times New Roman', 'Symbol', 'Wingdings', 'Arial'];   // the .doc's font table (writeDoc's `fonts`), which a list level's font names
const NFC = { decimal: 0, upperRoman: 1, lowerRoman: 2, upperLetter: 3, lowerLetter: 4, decimalZero: 22, bullet: 23, none: 255 };
function listIds(spec) { return Object.keys(spec.lists || {}); }
// A list entry that is not an array of levels but { like: <list id>, start: n } is a SECOND numbering instance of that list — a .doc LFO that
// shares the list's LST and carries one level-0 start-at override (.docx: a second w:num on the same abstractNum with a startOverride):
// what Word writes for "Restart at 1" / "Set numbering value".
const isLikeList = (spec, id) => !Array.isArray(spec.lists[id]);
const lstIdsOf = (spec) => listIds(spec).filter((id) => !isLikeList(spec, id));
function writeLists(spec) {
  const allIds = listIds(spec);
  const ids = lstIdsOf(spec);
  const lst = new Bytes();
  lst.u16(ids.length);
  for (const id of ids) {
    lst.u32(1000 + Number(id)).u32(0);
    for (let k = 0; k < 9; k++) lst.u16(0x0FFF);
    lst.u8(0).u8(0);                                         // not simple
  }
  const lstLen = lst.length;
  for (const id of ids) {
    const levels = spec.lists[id];
    for (let k = 0; k < 9; k++) {
      const lv = levels[Math.min(k, levels.length - 1)];
      const fmt = lv.fmt || 'decimal';
      let xst = '', nums = [];
      if (fmt === 'bullet') xst = lv.text || '';
      else {
        const t = lv.text != null ? lv.text : `%${k + 1}.`;
        for (let i = 0; i < t.length; i++) {
          if (t[i] === '%' && /[1-9]/.test(t[i + 1] || '')) { nums.push(xst.length + 1); xst += String.fromCharCode(Number(t[i + 1]) - 1); i++; }
          else xst += t[i];
        }
      }
      const rgbxch = [...nums, 0, 0, 0, 0, 0, 0, 0, 0, 0].slice(0, 9);
      const papx = [...S.b2(SPRM.PDxaLeft, 720 * (k + 1))];
      // a level's own font (import fix list #1 custom bullets, 1 Oct 2026): the level's CHPX, sprmCRgFtc0 = an index in the fixed font list
      const chpx = lv.font && FIXED_FONTS.includes(lv.font) ? [...S.b2(SPRM.CRgFtc0, FIXED_FONTS.indexOf(lv.font))] : [];
      lst.u32(lv.start ?? 1).u8(NFC[fmt] ?? 0).u8(lv.legal ? 0x04 : 0).bytes(rgbxch).u8(0).u32(0).u32(0).u8(chpx.length).u8(papx.length).u8(0).u8(0);
      lst.bytes(papx).bytes(chpx);
      lst.u16(xst.length).utf16(xst);
    }
  }
  const lfo = new Bytes();
  lfo.u32(allIds.length);
  for (const id of allIds) lfo.u32(1000 + Number(isLikeList(spec, id) ? spec.lists[id].like : id)).u32(0).u32(0).u8(isLikeList(spec, id) ? 1 : 0).u8(0).u8(0).u8(0);
  for (const id of allIds) {
    lfo.u32(0xFFFFFFFF);                                     // LFOData.cp
    if (isLikeList(spec, id)) lfo.u32(spec.lists[id].start ?? 1).u32(0x10);   // one LFOLVL: level 0, fStartAt, no own formatting
  }
  return { plfLst: lst.out(), lstLen, plfLfo: lfo.out(), ilfoOf: (id) => allIds.indexOf(String(id)) + 1 };
}

// ---------------------------------------------------------------------------------------
// OfficeArt
// ---------------------------------------------------------------------------------------
function rec(ver, inst, type, body) { return [...le16((ver & 0xF) | (inst << 4)), ...le16(type), ...le32(body.length), ...body]; }
function fopt(props) {                                       // props: [{pid, value} | {pid, complex: bytes}]
  const fixed = [], complex = [];
  for (const p of props) {
    if (p.complex) { fixed.push(...le16(p.pid | 0x8000), ...le32(p.complex.length)); complex.push(...p.complex); }
    else fixed.push(...le16(p.pid), ...le32(p.value));
  }
  return rec(3, props.length, 0xF00B, [...fixed, ...complex]);
}
const utf16z = (s) => { const b = new Bytes(); b.utf16(s).u16(0); return b.a; };
function pngBlip(png) { return rec(0, 0x6E0, 0xF01E, [...new Array(16).fill(7), 0xFF, ...png]); }
// A WMF blip: the metafile without its 22-byte placeable header, behind an
// OfficeArtMetafileHeader; img.deflate(bytes) (a zlib deflate) compresses it when given.
function wmfBlip(img) {
  const bare = img.wmf.subarray(22);
  const data = img.deflate ? img.deflate(bare) : bare;
  const hdr = [...le32(bare.length), ...le32(0), ...le32(0), ...le32(100), ...le32(100), ...le32(1270), ...le32(1270), ...le32(data.length), img.deflate ? 0 : 0xFE, 0xFE];
  return rec(0, 0x216, 0xF01B, [...new Array(16).fill(7), ...hdr, ...data]);
}
function blipFor(img) { return img.wmf ? wmfBlip(img) : pngBlip(img.png); }
function fbse(img, embedded = true) {
  const blip = blipFor(img);
  const hdr = [6, 6, ...new Array(16).fill(7), 0, 0, ...le32(blip.length), ...le32(1), ...le32(embedded ? 0 : 0xFFFFFFFF), 0, 0, 0, 0];
  return rec(2, 6, 0xF007, embedded ? [...hdr, ...blip] : hdr);
}
function spContainer(spid, props) {
  const fsp = rec(2, 75, 0xF00A, [...le32(spid), ...le32(0x0A00)]);
  return rec(0xF, 0, 0xF004, [...fsp, ...fopt(props)]);
}

// ---------------------------------------------------------------------------------------
// the .doc writer
// ---------------------------------------------------------------------------------------
export function writeDoc(spec, opts = {}) {
  const styles = allStyles(spec);
  const istdOf = (name, fallback = 0) => { if (!name) return fallback; const s = styles.find((x) => x && x.name.toLowerCase() === String(name).toLowerCase()); return s ? s.istd : fallback; };
  const lists = writeLists(spec);
  const data = new Bytes();                                  // the Data stream (pictures)
  data.pad(8);
  const objects = [];                                        // ObjectPool entries
  const shapes = [];                                         // floating shapes { cp, spid, png?, alt?, txbxIndex? }
  const fonts = ['Times New Roman', 'Symbol', 'Wingdings', 'Arial'];

  // stories: each a list of chars { c, chp: bytes } and paragraph ends { cpEnd, istd, sprms }
  const newStory = () => ({ chars: [], paras: [] });
  const main = newStory(), ftn = newStory(), edn = newStory(), hdd = newStory(), txbx = newStory(), atn = newStory();
  const ftnRefs = [], ftnStarts = [], ednRefs = [], ednStarts = [], txbxStarts = [], ftnAuto = [], ednAuto = [];
  let nextSpid = 1025;

  const pushChar = (story, c, chp) => story.chars.push({ c, chp });
  const endPara = (story, mark, istd, sprms, markChp = []) => { pushChar(story, mark, markChp); story.paras.push({ cpEnd: story.chars.length, istd, sprms }); };

  const runChp = (r) => {
    const out = [];
    if (r.style) out.push(...S.b2(SPRM.CIstd, istdOf(r.style, 10)));
    if (r.b) out.push(...S.b1(SPRM.CFBold, 1));
    if (r.i) out.push(...S.b1(SPRM.CFItalic, 1));
    if (r.u) out.push(...S.b1(SPRM.CKul, 1));
    if (r.strike) out.push(...S.b1(SPRM.CFStrike, 1));
    if (r.caps) out.push(...S.b1(SPRM.CFCaps, 1));
    if (r.smallCaps) out.push(...S.b1(SPRM.CFSmallCaps, 1));
    if (r.sup) out.push(...S.b1(SPRM.CIss, 1));
    if (r.sub) out.push(...S.b1(SPRM.CIss, 2));
    // docx-parity item 3 test support: `vanish: false` is a real, explicit "un-hide" direct
    // override (distinct from the field simply being absent) — same tri-state convention
    // rPr's own `r.vanish === false` handles for the .docx side, below.
    if (r.vanish === true) out.push(...S.b1(SPRM.CFVanish, 1));
    else if (r.vanish === false) out.push(...S.b1(SPRM.CFVanish, 0));
    if (r.del) out.push(...S.b1(SPRM.CFRMarkDel, 1));
    if (r.ins) out.push(...S.b1(SPRM.CFRMarkIns, 1));
    if (r.font) {
      let idx = fonts.indexOf(r.font);
      if (idx < 0) { idx = fonts.length; fonts.push(r.font); }
      out.push(...S.b2(SPRM.CRgFtc0, idx));
    }
    return out;
  };
  const spec1 = S.b1(SPRM.CFSpec, 1);

  const writeRuns = (story, runs, baseChp = []) => {
    for (const r0 of Array.isArray(runs) ? runs : [runs]) {
      const r = typeof r0 === 'string' ? { text: r0 } : r0;
      if (r.text != null) {
        const chp = [...baseChp, ...runChp(r)];
        if (r.href) {
          const code = ` HYPERLINK "${r.href}" `;
          pushChar(story, '\x13', spec1);
          for (const c of code) pushChar(story, c, []);
          pushChar(story, '\x14', spec1);
          for (const c of r.text) pushChar(story, c, [...chp, ...S.b2(SPRM.CIstd, istdOf('Hyperlink', 10))]);
          pushChar(story, '\x15', spec1);
        } else for (const c of r.text) pushChar(story, c, chp);
      } else if (r.tab) pushChar(story, '\t', baseChp);
      else if (r.br) pushChar(story, '\x0B', baseChp);
      else if (r.pageBreak) pushChar(story, '\x0C', baseChp);
      else if (r.nbHyphen) pushChar(story, '\x1E', baseChp);
      else if (r.softHyphen) pushChar(story, '\x1F', baseChp);
      else if (r.sym) pushChar(story, '\x28', [...spec1, ...S.b4(SPRM.CSymbol, (fonts.indexOf(r.sym.font) & 0xFFFF) | (r.sym.code << 16))]);
      else if (r.field != null) {
        pushChar(story, '\x13', spec1);
        for (const c of ` ${r.field} `) pushChar(story, c, []);
        if (r.result != null) { pushChar(story, '\x14', spec1); writeRuns(story, r.result, baseChp); }
        pushChar(story, '\x15', spec1);
      } else if (r.footnote || r.endnote) {
        const isEn = !!r.endnote;
        (isEn ? ednRefs : ftnRefs).push(story.chars.length);
        (isEn ? ednAuto : ftnAuto).push(r.mark ? 0 : 1);
        if (r.mark) pushChar(story, r.mark, S.b2(SPRM.CIstd, istdOf(isEn ? 'endnote reference' : 'footnote reference', 10)));   // a custom mark is ordinary text
        else pushChar(story, '\x02', [...spec1, ...S.b2(SPRM.CIstd, istdOf(isEn ? 'endnote reference' : 'footnote reference', 10))]);
        const ns = isEn ? edn : ftn;
        (isEn ? ednStarts : ftnStarts).push(ns.chars.length);
        const blocks = r.footnote || r.endnote;
        blocks.forEach((blk, bi) => {
          if (bi === 0) { if (r.mark) pushChar(ns, r.mark, S.b2(SPRM.CIstd, istdOf(isEn ? 'endnote reference' : 'footnote reference', 10))); else pushChar(ns, '\x02', [...spec1, ...S.b2(SPRM.CIstd, istdOf(isEn ? 'endnote reference' : 'footnote reference', 10))]); pushChar(ns, ' ', []); }
          if (blk.table) { writeTable(ns, blk.table, 1, blk); return; }   // a table inside a note (doc_import_30sep.test.mjs; not the first block, which carries the mark)
          writeRuns(ns, blk.p ?? blk, []);
          endPara(ns, '\r', istdOf(isEn ? 'endnote text' : 'footnote text'), []);
        });
      } else if (r.checkbox) {
        // a legacy check-box form field ([MS-DOC] 2.9.76 FFData): FORMCHECKBOX field whose code holds the form-data character 0x01
        // (sprmCFData + sprmCPicLocation -> the Data stream: a PICF header, then the FFData: version, FFDataBits, cch, hps, xstzName,
        // xstzTextDef, wDef). r.checkbox = { checked, res? (the raw iRes: 25 = not toggled, wDef applies), def?, separator? }
        const cb = r.checkbox === true ? { checked: false } : r.checkbox;
        const fc = data.length;
        const iRes = cb.res != null ? cb.res : cb.checked ? 1 : 0;
        const ff = [...le32(0xFFFFFFFF), ...le16(1 | (iRes << 2)), ...le16(0), ...le16(0), ...le16(6), ...Array.from('Check1').flatMap((ch) => le16(ch.charCodeAt(0))), 0, 0, ...le16(0), 0, 0, ...le16(cb.def ? 1 : 0)];
        data.u32(0x44 + ff.length).u16(0x44).u16(0x64).u16(0).u16(0).u16(0);
        data.pad(fc + 0x44);
        data.bytes(ff);
        pushChar(story, '\x13', spec1);
        for (const c of ' FORMCHECKBOX ') pushChar(story, c, []);
        pushChar(story, '\x01', [...spec1, ...S.b1(SPRM.CFData, 1), ...S.b4(SPRM.CPicLocation, cb.bad ? 0x7FFFFFF0 : fc)]);
        if (cb.separator) pushChar(story, '\x14', spec1);        // LibreOffice writes an (empty) result part; Word does not
        pushChar(story, '\x15', spec1);
      } else if (r.dropdown) {
        // a legacy drop-down form field: FFData with iType 2, iRes = the selected item (25 = none chosen: wDef), fHasListBox, then the item
        // list as an STTB after the macro names. r.dropdown = { items: [...], selected?: n, res?, def?, lo? (LibreOffice's layout: no exit macro) }
        const dd = r.dropdown;
        const fc = data.length;
        const iRes = dd.res != null ? dd.res : (dd.selected || 0);
        const xs = (s) => [...le16(s.length), ...Array.from(s).flatMap((ch) => le16(ch.charCodeAt(0))), 0, 0];
        const ff = [...le32(0xFFFFFFFF), ...le16(2 | (iRes << 2) | 0x8000), ...le16(0), ...le16(0), ...xs('Drop1'), ...xs(''), ...le16(dd.def || 0),
          ...xs(''), ...xs(''), ...xs(''), ...xs(''), ...(dd.lo ? [] : xs('')),
          ...le16(0xFFFF), ...le16(dd.items.length), ...le16(0), ...dd.items.flatMap((s) => [...le16(s.length), ...Array.from(s).flatMap((ch) => le16(ch.charCodeAt(0)))])];
        data.u32(0x44 + ff.length).u16(0x44).u16(0x64).u16(0).u16(0).u16(0);
        data.pad(fc + 0x44);
        data.bytes(ff);
        pushChar(story, '\x13', spec1);
        for (const c of ' FORMDROPDOWN ') pushChar(story, c, []);
        pushChar(story, '\x01', [...spec1, ...S.b1(SPRM.CFData, 1), ...S.b4(SPRM.CPicLocation, fc)]);
        pushChar(story, '\x14', spec1);
        pushChar(story, '\x15', spec1);
      } else if (r.image) {
        const fc = data.length;
        const inner = [...spContainer(nextSpid++, [{ pid: 0x0104, value: 1 }, ...(r.image.alt ? [{ pid: 0x0381, complex: utf16z(r.image.alt) }] : [])]), ...fbse(r.image)];
        const lcb = 0x44 + inner.length;
        data.u32(lcb).u16(0x44).u16(0x64).u16(1000).u16(1000).u16(0);
        data.pad(fc + 0x44);
        data.bytes(inner);
        pushChar(story, '\x01', [...spec1, ...S.b4(SPRM.CPicLocation, fc)]);
      } else if ('equation' in r || r.ole) {
        const id = 1000 + objects.length;
        const progId = r.ole || 'Equation.3';
        objects.push({ id, progId, native: r.equation ? equationNative(r.equation) : ('equation' in r ? new Uint8Array([28, 0, 0, 0]) : null) });
        pushChar(story, '\x13', spec1);
        for (const c of ` EMBED ${progId} `) pushChar(story, c, []);
        pushChar(story, '\x14', spec1);
        pushChar(story, '\x01', [...spec1, ...S.b1(SPRM.CFOle2, 1), ...S.b1(SPRM.CFObj, 1), ...S.b4(SPRM.CPicLocation, id)]);
        pushChar(story, '\x15', spec1);
      }
    }
  };

  const paraSprms = (blk) => {
    const out = [];
    if (blk.list) { out.push(...S.b2(SPRM.PIlfo, lists.ilfoOf(blk.list.id)), ...S.b1(SPRM.PIlvl, blk.list.level || 0)); }
    if (blk.outline != null) out.push(...S.b1(SPRM.POutLvl, blk.outline));
    if (blk.jc != null) out.push(...S.b1(SPRM.PJc, blk.jc));   // K3: sprmPJc (justification) — 2 = right
    if (blk.dropCap) out.push(...S.b2(0x442C, 1 | (3 << 3)));   // sprmPDcs: dropped, 3 lines
    // K36d (box/sidebar detection, doc_box_borders.test.mjs): blk.border true -> all four sides
    // bordered (Format > Borders and Shading's own "Box" preset); an object overrides
    // width/type/colour-index. All four sides always match here — a partial border (e.g.
    // bottom rule only) is exercised directly at the doc-props.mjs unit level instead.
    if (blk.border) {
      const o = blk.border === true ? {} : blk.border;
      const brc = BRC(o.w, o.type, o.ico);
      out.push(...S.b4(SPRM.PBrcTop, brc), ...S.b4(SPRM.PBrcLeft, brc), ...S.b4(SPRM.PBrcBottom, brc), ...S.b4(SPRM.PBrcRight, brc));
    }
    // list_item_blocks-style continuation tests (doc_reader.test.mjs): a plain paragraph's own
    // indent (sprmPDxaLeft), matching the .docx writer's blk.ind -> w:ind w:left below.
    if (blk.ind != null) out.push(...S.b2(SPRM.PDxaLeft, blk.ind));
    if (blk.tabs) {                                              // sprmPChgTabsPapx: add tab stops
      const d = [0, blk.tabs.length, ...blk.tabs.flatMap((t) => le16(t.pos)), ...blk.tabs.map((t) => (t.leader === 'dot' ? 1 : 0) << 3)];
      out.push(...le16(0xC60D), d.length, ...d);
    }
    return out;
  };

  const tdefTable = (cells, ind = 0) => {
    const itc = cells.length;
    const d = [itc];
    let x = ind;   // rgdxaCenter[0]: the table's own left edge / indent (doc_reader.test.mjs list-item table tests)
    d.push(...le16(x));
    for (const c of cells) { x += 2000 * (c && c.span ? c.span : 1); d.push(...le16(x)); }
    for (const c of cells) {
      const vm = c && c.vmerge === 'restart' ? 3 : c && c.vmerge === 'continue' ? 1 : 0;
      // K36d: the TC record's own 16 border bytes ([MS-DOC] 2.9.339 TC — brcTop/Left/Bottom/
      // Right, each a 4-byte BRC right after rgf/wWidth, read back by doc-props.mjs's
      // readTap) — all four sides bordered when the cell spec carries `border: true`
      // (doc_box_borders.test.mjs's one-cell boxed table), otherwise left zero (no border) exactly
      // as before.
      const brcBytes = c && c.border ? [...le32(BRC()), ...le32(BRC()), ...le32(BRC()), ...le32(BRC())] : new Array(16).fill(0);
      d.push(...le16(vm << 5), ...le16(2000), ...brcBytes);
    }
    return [...le16(0xD608), ...le16(d.length + 1), ...d];
  };

  const writeBlocks = (story, blocks, itap = 0) => {
    for (const blk of blocks) {
      if (blk.table) { writeTable(story, blk.table, itap + 1, blk); continue; }
      if (blk.textbox) {
        const spid = nextSpid++;
        shapes.push({ cp: story.chars.length, spid, txbxIndex: txbxStarts.length });
        pushChar(story, '\x08', spec1);
        endPara(story, '\r', 0, itap ? [...S.b1(SPRM.PFInTable, 1), ...(itap > 1 ? S.b4(SPRM.PItap, itap) : [])] : []);
        txbxStarts.push(txbx.chars.length);
        writeBlocks(txbx, blk.textbox, 0);
        continue;
      }
      if (blk.floatImage) {
        const spid = nextSpid++;
        shapes.push({ cp: story.chars.length, spid, img: blk.floatImage, png: true, alt: blk.floatImage.alt });
        pushChar(story, '\x08', spec1);
        endPara(story, '\r', 0, []);
        continue;
      }
      writeRuns(story, blk.p ?? '', []);
      const extra = itap ? [...S.b1(SPRM.PFInTable, 1), ...(itap > 1 ? S.b4(SPRM.PItap, itap) : [])] : [];
      endPara(story, '\r', istdOf(blk.style), [...paraSprms(blk), ...extra], blk.delMark ? S.b1(SPRM.CFRMarkDel, 1) : []);
    }
  };

  function writeTable(story, rows, itap, topts = {}) {
    const inTable = [...S.b1(SPRM.PFInTable, 1), ...(itap > 1 ? S.b4(SPRM.PItap, itap) : [])];
    const tapExtra = (ri) => [...(topts.header && ri === 0 ? S.b1(0x3404, 1) : []), ...(topts.tstyle ? S.b2(0x563A, istdOf(topts.tstyle)) : [])];
    for (const [ri, row] of rows.entries()) {
      const cells = row.map((c) => (c && typeof c === 'object' && !Array.isArray(c) && c.blocks ? c : { blocks: [{ p: c }] }));
      for (const cell of cells) {
        const blocks = cell.blocks.length ? cell.blocks : [{ p: '' }];
        blocks.forEach((blk, bi) => {
          const last = bi === blocks.length - 1;
          if (blk.table) { writeTable(story, blk.table, itap + 1, blk); if (!last) return; writeRuns(story, '', []); }
          else writeRuns(story, blk.p ?? '', []);
          if (last) {
            if (itap === 1) endPara(story, '\x07', istdOf(blk.style), [...paraSprms(blk), ...inTable]);
            else endPara(story, '\r', istdOf(blk.style), [...paraSprms(blk), ...inTable, ...S.b1(SPRM.PFInnerTableCell, 1)]);
          } else endPara(story, '\r', istdOf(blk.style), [...paraSprms(blk), ...inTable]);
        });
      }
      if (itap === 1) endPara(story, '\x07', 0, [...inTable, ...S.b1(SPRM.PFTtp, 1), ...tdefTable(cells, topts.ind || 0), ...tapExtra(ri)]);
      else endPara(story, '\r', 0, [...inTable, ...S.b1(SPRM.PFInnerTableCell, 1), ...S.b1(SPRM.PFInnerTtp, 1), ...tdefTable(cells, topts.ind || 0), ...tapExtra(ri)]);
    }
  }

  writeBlocks(main, spec.body);
  if (spec.header) { writeRuns(hdd, spec.header, []); endPara(hdd, '\r', istdOf('header'), []); }
  const hddHeaderLen = hdd.chars.length;
  if (spec.footer) { writeRuns(hdd, spec.footer, []); endPara(hdd, '\r', istdOf('header'), []); }
  const hddFooterLen = hdd.chars.length - hddHeaderLen;
  const commentStarts = [];
  for (const c of spec.comments || []) { commentStarts.push(atn.chars.length); writeRuns(atn, c, []); endPara(atn, '\r', 0, []); }

  // ---- assemble the CP stream: main, ftn, hdd, (mcr, atn), edn, txbx ----
  const order = [main, ftn, hdd, atn, edn, txbx];
  const offs = [];
  let total = 0;
  for (const s of order) { offs.push(total); total += s.chars.length; }
  const anySub = ftn.chars.length + hdd.chars.length + atn.chars.length + edn.chars.length + txbx.chars.length > 0;
  const allChars = order.flatMap((s) => s.chars);
  const allParas = order.flatMap((s, i) => s.paras.map((p) => ({ ...p, cpEnd: p.cpEnd + offs[i] })));
  if (anySub) { allChars.push({ c: '\r', chp: [] }); allParas.push({ cpEnd: allChars.length, istd: 0, sprms: [] }); }
  const text = allChars.map((x) => x.c).join('');

  // ---- pieces: one piece (UTF-16 or 8-bit), or two pieces stored in reverse order ----
  const compressed = !!opts.compressed;
  const bpc = compressed ? 1 : 2;
  const fcText = 1024;
  const pieces = [];
  if (opts.splitAt && opts.splitAt > 0 && opts.splitAt < text.length) {
    const k = opts.splitAt;
    const len2 = (text.length - k) * bpc;
    pieces.push({ cpStart: 0, cpEnd: k, fc: fcText + len2, prm: 0 });
    pieces.push({ cpStart: k, cpEnd: text.length, fc: fcText, prm: opts.secondPiecePrm ? 1 : 0 });
  } else pieces.push({ cpStart: 0, cpEnd: text.length, fc: fcText, prm: 0 });
  const cpToFc = (cp) => { for (const p of pieces) if (cp >= p.cpStart && cp < p.cpEnd) return p.fc + (cp - p.cpStart) * bpc; const l = pieces[pieces.length - 1]; return l.fc + (cp - l.cpStart) * bpc; };

  const wd = new Bytes();
  wd.pad(fcText);
  const textBytes = new Uint8Array(text.length * bpc);
  for (const p of pieces) {
    for (let cp = p.cpStart; cp < p.cpEnd; cp++) {
      const o = p.fc - fcText + (cp - p.cpStart) * bpc;
      const c = text.charCodeAt(cp);
      if (compressed) textBytes[o] = c & 0xFF; else { textBytes[o] = c & 0xFF; textBytes[o + 1] = c >> 8; }
    }
  }
  wd.bytes(textBytes);
  wd.align(512);

  // CP-space runs split at piece boundaries, mapped to FC and sorted by FC.
  const toFcRuns = (cpRuns) => {
    const out = [];
    for (const r of cpRuns) {
      for (const p of pieces) {
        const a = Math.max(r.cpStart, p.cpStart), b = Math.min(r.cpEnd, p.cpEnd);
        if (b > a) out.push({ ...r, fcStart: p.fc + (a - p.cpStart) * bpc, fcEnd: p.fc + (b - p.cpStart) * bpc });
      }
    }
    return out.sort((x, y) => x.fcStart - y.fcStart);
  };
  // character runs
  const chRuns = [];
  for (let i = 0; i < allChars.length; i++) {
    const key = allChars[i].chp.join(',');
    const last = chRuns[chRuns.length - 1];
    if (last && last.key === key) last.cpEnd = i + 1;
    else chRuns.push({ key, cpStart: i, cpEnd: i + 1, grpprl: allChars[i].chp });
  }
  // paragraph runs
  const paRuns = [];
  let ps = 0;
  for (const p of allParas) { paRuns.push({ cpStart: ps, cpEnd: p.cpEnd, istd: p.istd, grpprl: p.sprms }); ps = p.cpEnd; }

  const chpxFkps = [], papxFkps = [];
  const writeChpxPages = (runs) => {
    let i = 0;
    while (i < runs.length) {
      const page = new Uint8Array(512);
      let top = 511;
      const entries = [];
      while (i < runs.length) {
        const g = runs[i].grpprl;
        const need = g.length ? g.length + 1 + ((511 - g.length - 1) & 1 ? 0 : 0) : 0;
        const n = entries.length + 1;
        let newTop = top;
        if (g.length) { newTop = (top - (g.length + 1)) & ~1; }
        if (4 * (n + 1) + n > newTop) break;
        void need;
        let off = 0;
        if (g.length) { page[newTop] = g.length; page.set(g, newTop + 1); off = newTop / 2; top = newTop; }
        entries.push({ r: runs[i], off });
        i++;
      }
      const crun = entries.length;
      const dv = new DataView(page.buffer);
      entries.forEach((e, k) => { dv.setUint32(k * 4, e.r.fcStart, true); page[4 * (crun + 1) + k] = e.off; });
      dv.setUint32(crun * 4, entries[crun - 1].r.fcEnd, true);
      page[511] = crun;
      chpxFkps.push({ page, fcFirst: entries[0].r.fcStart, fcLast: entries[crun - 1].r.fcEnd });
    }
  };
  const writePapxPages = (runs) => {
    let i = 0;
    while (i < runs.length) {
      const page = new Uint8Array(512);
      let top = 511;
      const entries = [];
      while (i < runs.length) {
        const g = [...le16(runs[i].istd), ...runs[i].grpprl];
        if (g.length & 1) g.push(0);
        const size = 2 + g.length;
        const n = entries.length + 1;
        const newTop = (top - size) & ~1;
        if (4 * (n + 1) + 13 * n > newTop) break;
        page[newTop] = 0; page[newTop + 1] = g.length / 2; page.set(g, newTop + 2);
        top = newTop;
        entries.push({ r: runs[i], off: newTop / 2 });
        i++;
      }
      const cpara = entries.length;
      const dv = new DataView(page.buffer);
      entries.forEach((e, k) => { dv.setUint32(k * 4, e.r.fcStart, true); page[4 * (cpara + 1) + k * 13] = e.off; });
      dv.setUint32(cpara * 4, entries[cpara - 1].r.fcEnd, true);
      page[511] = cpara;
      papxFkps.push({ page, fcFirst: entries[0].r.fcStart, fcLast: entries[cpara - 1].r.fcEnd });
    }
  };
  writeChpxPages(toFcRuns(chRuns));
  writePapxPages(toFcRuns(paRuns));
  const pnOf = [];
  for (const f of [...chpxFkps, ...papxFkps]) { pnOf.push(wd.length / 512); wd.bytes(f.page); }

  // ---- table stream ----
  const tbl = new Bytes();
  const fc = {};
  const put = (name, bytes) => { fc[name] = { fc: tbl.length, lcb: bytes.length }; tbl.bytes(bytes); };
  put('Stshf', writeStsh(styles, lists.ilfoOf, !!opts.oldStsh));
  // footnotes / endnotes
  const notePlcs = (refs, starts, story, auto, refName, txtName) => {
    if (!refs.length) return;
    const r = new Bytes();
    for (const cp of refs) r.u32(cp);
    r.u32(offs[0] + main.chars.length);
    for (let i = 0; i < refs.length; i++) r.u16(auto[i]);
    put(refName, r.out());
    const t = new Bytes();
    for (const s of starts) t.u32(s);
    t.u32(story.chars.length);
    t.u32(story.chars.length + 1);
    put(txtName, t.out());
  };
  notePlcs(ftnRefs, ftnStarts, ftn, ftnAuto, 'PlcffndRef', 'PlcffndTxt');
  notePlcs(ednRefs, ednStarts, edn, ednAuto, 'PlcfendRef', 'PlcfendTxt');
  // running header / footer stories: PlcfHdd = six note-separator stories (empty), then the section's six (even header, ODD HEADER, even
  // footer, ODD FOOTER, first header, first footer); the comments' text table
  if (spec.header || spec.footer) {
    const lens = new Array(12).fill(0);
    lens[7] = hddHeaderLen; lens[9] = hddFooterLen;
    const h = new Bytes();
    let acc = 0;
    for (const l of lens) { h.u32(acc); acc += l; }
    h.u32(acc);
    put('PlcfHdd', h.out());
  }
  if (commentStarts.length) {
    const t = new Bytes();
    for (const st of commentStarts) t.u32(st);
    t.u32(atn.chars.length);
    put('PlcfandTxt', t.out());
  }
  // section table: one section
  { const s = new Bytes(); s.u32(0).u32(main.chars.length).u16(0).u32(0xFFFFFFFF).u16(0).u32(0xFFFFFFFF); put('PlcfSed', s.out()); }
  // bin tables
  { const b = new Bytes(); chpxFkps.forEach((f) => b.u32(f.fcFirst)); b.u32(chpxFkps[chpxFkps.length - 1].fcLast); chpxFkps.forEach((_, k) => b.u32(pnOf[k])); put('PlcfBteChpx', b.out()); }
  { const b = new Bytes(); papxFkps.forEach((f) => b.u32(f.fcFirst)); b.u32(papxFkps[papxFkps.length - 1].fcLast); papxFkps.forEach((_, k) => b.u32(pnOf[chpxFkps.length + k])); put('PlcfBtePapx', b.out()); }
  // fonts
  {
    const b = new Bytes(); b.u16(fonts.length).u16(0);
    for (const f of fonts) { const ffn = new Bytes(); ffn.u8(0x16).u16(400).u8(0).u8(0).pad(15).pad(39); ffn.utf16(f).u16(0); b.u8(ffn.length).bytes(ffn.out()); }
    put('SttbfFfn', b.out());
  }
  put('Dop', new Uint8Array(0x220));
  // CLX
  {
    const b = new Bytes();
    if (opts.secondPiecePrm) { const g = S.b1(SPRM.CFBold, 1); b.u8(1).u16(g.length).bytes(g); }
    const plc = new Bytes();
    for (const p of pieces) plc.u32(p.cpStart);
    plc.u32(pieces[pieces.length - 1].cpEnd);
    for (const p of pieces) plc.u16(0).u32(compressed ? ((p.fc * 2) | 0x40000000) >>> 0 : p.fc).u16(p.prm ? 1 : 0);
    b.u8(2).u32(plc.length).bytes(plc.out());
    put('Clx', b.out());
  }
  if (listIds(spec).length) { fc.PlfLst = { fc: tbl.length, lcb: lists.lstLen }; tbl.bytes(lists.plfLst); put('PlfLfo', lists.plfLfo); }
  // floating shapes and text boxes
  if (shapes.length) {
    const spa = new Bytes();
    for (const s of shapes) spa.u32(s.cp);
    spa.u32(main.chars.length);
    for (const s of shapes) spa.u32(s.spid).u32(0).u32(0).u32(1440).u32(1440).u16(0).u32(0);
    put('PlcSpaMom', spa.out());
    const imgs = shapes.filter((s) => s.png);
    const bstore = rec(0xF, imgs.length, 0xF001, imgs.flatMap((s) => fbse(s.img)));
    const dgg = rec(0xF, 0, 0xF000, [...rec(0, 0, 0xF006, [...le32(2048), ...le32(2), ...le32(shapes.length), ...le32(1)]), ...bstore]);
    let pib = 0;
    const sps = shapes.map((s) => {
      const props = [];
      if (s.png) { props.push({ pid: 0x0104, value: ++pib }); if (s.alt) props.push({ pid: 0x0381, complex: utf16z(s.alt) }); }
      if (s.txbxIndex != null) props.push({ pid: 0x0080, value: ((s.txbxIndex + 1) << 16) >>> 0 });
      return spContainer(s.spid, props);
    });
    const groupSp = rec(0xF, 0, 0xF004, [...rec(1, 0, 0xF009, new Array(16).fill(0)), ...rec(2, 0, 0xF00A, [...le32(1024), ...le32(0x05)])]);
    const spgr = rec(0xF, 0, 0xF003, [...groupSp, ...sps.flat()]);
    const dg = rec(0xF, 0, 0xF002, [...rec(0, 1, 0xF008, [...le32(shapes.length + 1), ...le32(nextSpid)]), ...spgr]);
    put('DggInfo', [...dgg, 0, ...dg]);
    const tbxShapes = shapes.filter((s) => s.txbxIndex != null);
    if (tbxShapes.length) {
      const t = new Bytes();
      txbxStarts.forEach((s) => t.u32(s));
      t.u32(txbx.chars.length);
      tbxShapes.forEach((s) => t.u32(1).u32(0).u16(0).u32(0).u32(opts.textboxLidZero ? 0 : s.spid).u32(0));
      put('PlcftxbxTxt', t.out());
    }
  }

  // ---- FIB ----
  const fib = new Bytes();
  const flags = 0x0200 | (opts.encrypted ? 0x0100 : 0) | (opts.obfuscated ? 0x8000 : 0);
  fib.u16(0xA5EC).u16(opts.nFib ?? 0x00C1).u16(0).u16(0x0409).u16(0).u16(flags).u16(0x00BF).u32(0).u8(0).u8(0).u16(0).u16(0).u32(0).u32(0);
  fib.u16(14).pad(fib.length + 28);
  const ccp = [main.chars.length, ftn.chars.length, hdd.chars.length, 0, atn.chars.length, edn.chars.length, txbx.chars.length, 0];
  fib.u16(22);
  const lw = [0, 0, 0, ...ccp, ...new Array(22 - 11).fill(0)];
  lw.forEach((v) => fib.u32(v));
  const names = ['StshfOrig', 'Stshf', 'PlcffndRef', 'PlcffndTxt', 'PlcfandRef', 'PlcfandTxt', 'PlcfSed', 'PlcPad', 'PlcfPhe', 'SttbfGlsy', 'PlcfGlsy', 'PlcfHdd', 'PlcfBteChpx', 'PlcfBtePapx', 'PlcfSea', 'SttbfFfn', 'PlcfFldMom', 'PlcfFldHdr', 'PlcfFldFtn', 'PlcfFldAtn', 'PlcfFldMcr', 'SttbfBkmk', 'PlcfBkf', 'PlcfBkl', 'Cmds', 'Unused1', 'SttbfMcr', 'PrDrvr', 'PrEnvPort', 'PrEnvLand', 'Wss', 'Dop', 'SttbfAssoc', 'Clx', 'PlcfPgdFtn', 'AutosaveSource', 'GrpXstAtnOwners', 'SttbfAtnBkmk', 'Unused2', 'Unused3', 'PlcSpaMom', 'PlcSpaHdr', 'PlcfAtnBkf', 'PlcfAtnBkl', 'Pms', 'FormFldSttbs', 'PlcfendRef', 'PlcfendTxt', 'PlcfFldEdn', 'Unused4', 'DggInfo', 'SttbfRMark', 'SttbCaption', 'SttbAutoCaption', 'PlcfWkb', 'PlcfSpl', 'PlcftxbxTxt', 'PlcfFldTxbx', 'PlcfHdrtxbxTxt', 'PlcffldHdrTxbx', 'StwUser', 'SttbTtmbd', 'CookieData', 'PgdMotherOldOld', 'BkdMotherOldOld', 'PgdFtnOldOld', 'BkdFtnOldOld', 'PgdEdnOldOld', 'BkdEdnOldOld', 'SttbfIntlFld', 'RouteSlip', 'SttbSavedBy', 'SttbFnm', 'PlfLst', 'PlfLfo'];
  fib.u16(0x5D);
  fc.StshfOrig = fc.Stshf;
  for (let i = 0; i < 0x5D; i++) { const e = fc[names[i]]; fib.u32(e ? e.fc : 0).u32(e ? e.lcb : 0); }
  fib.u16(0);
  const wdBytes = wd.out();
  const fibBytes = fib.out();
  wdBytes.set(fibBytes, 0);
  new DataView(wdBytes.buffer).setUint32(0x40, wdBytes.length, true);   // cbMac

  const streams = [
    { path: 'WordDocument', data: wdBytes },
    { path: '1Table', data: tbl.out() },
  ];
  if (data.length > 8) streams.push({ path: 'Data', data: data.out() });
  if (spec.title || spec.author) streams.push({ path: '\x05SummaryInformation', data: summaryInfo(spec) });
  for (const o of objects) {
    streams.push({ path: `ObjectPool/_${o.id}/\x01CompObj`, data: compObj(o.progId) });
    streams.push({ path: `ObjectPool/_${o.id}/\x03ObjInfo`, data: new Uint8Array(6) });
    if (o.native) streams.push({ path: `ObjectPool/_${o.id}/Equation Native`, data: o.native });
  }
  return writeCfb(streams);
}

function compObj(progId) {
  const enc = new TextEncoder();
  const lp = (s) => { const b = enc.encode(s + '\0'); return [...le32(b.length), ...b]; };
  return Uint8Array.from([1, 0, 0xFE, 0xFF, 3, 0x0A, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF, ...new Array(16).fill(0),
    ...lp(progId.startsWith('Equation') ? 'Microsoft Equation 3.0' : 'Embedded object'), ...le32(0), ...lp(progId)]);
}

function summaryInfo(spec) {
  const props = [[1, 'i2', 1252]];
  if (spec.title) props.push([2, 'str', spec.title]);
  if (spec.author) props.push([4, 'str', spec.author]);
  const body = new Bytes();
  const entries = [];
  let off = 8 + props.length * 8;
  const vals = [];
  for (const [pid, type, v] of props) {
    const b = new Bytes();
    if (type === 'i2') b.u16(2).u16(0).u16(v).u16(0);
    else { const s = new TextEncoder().encode(v + '\0'); b.u16(0x1E).u16(0).u32(s.length).bytes(s).align(4); }
    entries.push([pid, off]); vals.push(b.out()); off += b.length;
  }
  body.u32(off).u32(props.length);
  for (const [pid, o] of entries) body.u32(pid).u32(o);
  for (const v of vals) body.bytes(v);
  const out = new Bytes();
  out.u16(0xFFFE).u16(0).u32(0x00020006).pad(24).u32(1);
  out.bytes([0xE0, 0x85, 0x9F, 0xF2, 0xF9, 0x4F, 0x68, 0x10, 0xAB, 0x91, 0x08, 0x00, 0x2B, 0x27, 0xB3, 0xD9]).u32(48);
  out.bytes(body.out());
  return out.out();
}

// ---------------------------------------------------------------------------------------
// the .docx twin
// ---------------------------------------------------------------------------------------
const xe = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DOCX_FMT = { decimal: 'decimal', bullet: 'bullet', lowerLetter: 'lowerLetter', upperLetter: 'upperLetter', lowerRoman: 'lowerRoman', upperRoman: 'upperRoman', decimalZero: 'decimalZero', none: 'none' };

export async function writeDocx(spec) {
  const styles = allStyles(spec).filter(Boolean);
  const rels = [];
  const media = [];
  const footnotes = [], endnotes = [];
  let relN = 10, picN = 0, oleN = 0;
  const addRel = (type, target, ext = '') => { const id = `rId${relN++}`; rels.push(`<Relationship Id="${id}" Type="${type}" Target="${xe(target)}"${ext}/>`); return id; };
  const ilfoOf = (id) => listIds(spec).indexOf(String(id)) + 1;
  const rPr = (r) => {
    let s = '';
    if (r.style) s += `<w:rStyle w:val="${styleId(r.style)}"/>`;
    if (r.b) s += '<w:b/>';
    if (r.i) s += '<w:i/>';
    if (r.caps) s += '<w:caps/>';
    if (r.smallCaps) s += '<w:smallCaps/>';
    if (r.strike) s += '<w:strike/>';
    // docx-parity item 3 test support: `vanish: false` writes an explicit un-hide override
    // (`<w:vanish w:val="false"/>`), distinct from the field being absent altogether (which
    // writes nothing at all, falling through to the style/docDefaults cascade instead).
    if (r.vanish === true) s += '<w:vanish/>';
    else if (r.vanish === false) s += '<w:vanish w:val="false"/>';
    // LINK-2 test support: `u: false` writes an explicit direct override (`<w:u w:val="none"/>`),
    // distinct from the field being absent (nothing written, falling through to the run's
    // character style — e.g. a href run's own forced rStyle="Hyperlink", below) — same
    // true/false-vs-absent convention `vanish` already uses just above.
    if (r.u === true) s += '<w:u w:val="single"/>';
    else if (r.u === false) s += '<w:u w:val="none"/>';
    if (r.sup) s += '<w:vertAlign w:val="superscript"/>';
    if (r.sub) s += '<w:vertAlign w:val="subscript"/>';
    return s ? `<w:rPr>${s}</w:rPr>` : '';
  };
  const runsXml = (runs) => {
    let x = '';
    for (const r0 of Array.isArray(runs) ? runs : [runs]) {
      const r = typeof r0 === 'string' ? { text: r0 } : r0;
      if (r.text != null) {
        let run = `<w:r>${rPr(r)}${r.del ? `<w:delText xml:space="preserve">${xe(r.text)}</w:delText>` : `<w:t xml:space="preserve">${xe(r.text)}</w:t>`}</w:r>`;
        if (r.del) run = `<w:del w:id="1" w:author="a">${run}</w:del>`;
        else if (r.ins) run = `<w:ins w:id="1" w:author="a">${run}</w:ins>`;
        if (r.href) run = `<w:hyperlink r:id="${addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', r.href, ' TargetMode="External"')}"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/>${rPr(r).replace(/^<w:rPr>|<\/w:rPr>$/g, '')}</w:rPr><w:t xml:space="preserve">${xe(r.text)}</w:t></w:r></w:hyperlink>`;
        x += run;
      } else if (r.tab) x += '<w:r><w:tab/></w:r>';
      else if (r.br) x += '<w:r><w:br/></w:r>';
      else if (r.pageBreak) x += '<w:r><w:br w:type="page"/></w:r>';
      else if (r.nbHyphen) x += '<w:r><w:noBreakHyphen/></w:r>';
      else if (r.softHyphen) x += '<w:r><w:softHyphen/></w:r>';
      else if (r.sym) x += `<w:r><w:sym w:font="${xe(r.sym.font)}" w:char="${r.sym.code.toString(16).toUpperCase()}"/></w:r>`;
      else if (r.field != null) {
        x += `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${xe(r.field)} </w:instrText></w:r>`;
        if (r.result != null) x += `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${runsXml(r.result)}`;
        x += '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
      } else if (r.footnote || r.endnote) {
        const isEn = !!r.endnote;
        const list = isEn ? endnotes : footnotes;
        const id = list.length + 1;
        const tag = isEn ? 'endnote' : 'footnote';
        const paras = (r.footnote || r.endnote).map((b, bi) => b.table ? tableXml(b.table, b) : `<w:p><w:pPr><w:pStyle w:val="${isEn ? 'EndnoteText' : 'FootnoteText'}"/></w:pPr>${bi === 0 ? `<w:r><w:rPr><w:rStyle w:val="${isEn ? 'EndnoteReference' : 'FootnoteReference'}"/></w:rPr><w:${tag}Ref/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>` : ''}${runsXml(b.p ?? b)}</w:p>`).join('');
        list.push(`<w:${tag} w:id="${id}">${paras}</w:${tag}>`);
        x += `<w:r><w:rPr><w:rStyle w:val="${isEn ? 'EndnoteReference' : 'FootnoteReference'}"/></w:rPr><w:${tag}Reference w:id="${id}"/></w:r>`;
      } else if (r.image) {
        const name = `media/image${++picN}.png`;
        media.push({ name: `word/${name}`, data: r.image.png });
        const rid = addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', name);
        x += `<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="${picN}" name="Picture ${picN}" descr="${xe(r.image.alt || '')}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
      } else if ('equation' in r || r.ole) {
        const progId = r.ole || 'Equation.3';
        const name = `embeddings/oleObject${++oleN}.bin`;
        const bin = r.equation ? oleEquationObject(r.equation) : writeCfb([{ path: '\x01CompObj', data: compObj(progId) }]);
        media.push({ name: `word/${name}`, data: bin });
        const rid = addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject', name);
        x += `<w:r><w:object><v:shape id="s${oleN}"/><o:OLEObject Type="Embed" ProgID="${xe(progId)}" ObjectID="_${oleN}" r:id="${rid}"/></w:object></w:r>`;
      }
    }
    return x;
  };
  const pXml = (blk, extraPPr = '') => {
    let ppr = '';
    if (blk.style) ppr += `<w:pStyle w:val="${styleId(blk.style)}"/>`;
    if (blk.list) ppr += `<w:numPr><w:ilvl w:val="${blk.list.level || 0}"/><w:numId w:val="${ilfoOf(blk.list.id)}"/></w:numPr>`;
    if (blk.tabs) ppr += `<w:tabs>${blk.tabs.map((t) => `<w:tab w:val="right" w:pos="${t.pos}"${t.leader ? ` w:leader="${t.leader}"` : ''}/>`).join('')}</w:tabs>`;
    if (blk.outline != null) ppr += `<w:outlineLvl w:val="${blk.outline}"/>`;
    // list_item_blocks-style continuation tests: this paragraph's own indent (matches the .doc
    // writer's blk.ind -> sprmPDxaLeft above), read back by docxParaIndentLeft/continuesItem.
    if (blk.ind != null) ppr += `<w:ind w:left="${blk.ind}"/>`;
    // docx-parity item 4 test support: this paragraph's OWN mark tracked as deleted
    // (blk.delMark, the same field writeDoc's endPara already honours via sprmCFRMarkDel —
    // see specs.mjs's extras fixture) or moved-from (blk.moveFromMark — docx-only, .doc has
    // no move-tracking concept at all, so writeDoc has no equivalent field).
    if (blk.delMark || blk.moveFromMark) ppr += `<w:rPr>${blk.delMark ? '<w:del w:id="9" w:author="a"/>' : ''}${blk.moveFromMark ? '<w:moveFrom w:id="9" w:author="a"/>' : ''}</w:rPr>`;
    ppr += extraPPr;
    return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runsXml(blk.p ?? '')}</w:p>`;
  };
  const blocksXml = (blocks) => blocks.map((blk) => {
    if (blk.table) return tableXml(blk.table, blk);
    if (blk.textbox) return `<w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent>${blocksXml(blk.textbox)}</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
    if (blk.floatImage) {
      const name = `media/image${++picN}.png`;
      media.push({ name: `word/${name}`, data: blk.floatImage.png });
      const rid = addRel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', name);
      return `<w:p><w:r><w:drawing><wp:anchor><wp:docPr id="${picN}" name="Picture ${picN}" descr="${xe(blk.floatImage.alt || '')}"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`;
    }
    return pXml(blk);
  }).join('');
  const tableXml = (rows, topts = {}) => {
    const cols = Math.max(...rows.map((row) => row.reduce((n, c) => n + (c && c.span ? c.span : 1), 0)));
    const tblPr = [topts.tstyle ? `<w:tblStyle w:val="${styleId(topts.tstyle)}"/>` : '', topts.ind ? `<w:tblInd w:w="${topts.ind}" w:type="dxa"/>` : ''].join('');
    let x = `<w:tbl>${tblPr ? `<w:tblPr>${tblPr}</w:tblPr>` : ''}<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(cols)}</w:tblGrid>`;
    for (const [ri, row] of rows.entries()) {
      x += `<w:tr>${topts.header && ri === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}`;
      for (const c of row) {
        const cell = c && typeof c === 'object' && !Array.isArray(c) && c.blocks ? c : { blocks: [{ p: c }] };
        let tcPr = '';
        if (cell.span > 1) tcPr += `<w:gridSpan w:val="${cell.span}"/>`;
        if (cell.vmerge) tcPr += `<w:vMerge${cell.vmerge === 'restart' ? ' w:val="restart"' : ''}/>`;
        x += `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}${blocksXml(cell.blocks.length ? cell.blocks : [{ p: '' }])}</w:tc>`;
      }
      x += '</w:tr>';
    }
    return x + '</w:tbl>';
  };
  const body = blocksXml(spec.body);
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';
  const parts = [];
  parts.push({ name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' });
  parts.push({ name: 'word/document.xml', text: `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${body}</w:body></w:document>` });
  const styleXml = styles.map((s) => {
    const t = s.type === 'char' ? 'character' : s.type === 'table' ? 'table' : 'paragraph';
    // Word writes the English built-in name in w:name whatever the UI language (the styleId is localised).
    const wname = s.sti >= 1 && s.sti <= 9 ? `heading ${s.sti}` : s.name;
    let x = `<w:style w:type="${t}" w:styleId="${styleId(s.name)}"><w:name w:val="${xe(wname)}"/>`;
    if (s.basedOn) x += `<w:basedOn w:val="${styleId(s.basedOn)}"/>`;
    if (s.linked) x += `<w:link w:val="${styleId(s.linked)}"/>`;
    if (s.outline != null || s.list) x += `<w:pPr>${s.list ? `<w:numPr><w:ilvl w:val="${s.list.level || 0}"/><w:numId w:val="${ilfoOf(s.list.id)}"/></w:numPr>` : ''}${s.outline != null ? `<w:outlineLvl w:val="${s.outline}"/>` : ''}</w:pPr>`;
    // docx-parity item 3 test support: same smallCaps/strike/vanish/subscript fields as
    // styleChpSprms (the .doc side, above) now also forward into the style's own <w:rPr>.
    const r = rPr({ b: s.bold, i: s.italic, u: s.underline, caps: s.caps, sup: s.superscript, smallCaps: s.smallCaps, strike: s.strike, vanish: s.vanish, sub: s.subscript });
    return x + r + '</w:style>';
  }).join('');
  parts.push({ name: 'word/styles.xml', text: `<?xml version="1.0" encoding="UTF-8"?><w:styles ${NS}>${styleXml}</w:styles>` });
  if (listIds(spec).length) {
    let x = '';
    lstIdsOf(spec).forEach((id, i) => {
      x += `<w:abstractNum w:abstractNumId="${i}">`;
      spec.lists[id].forEach((lv, k) => {
        const fmt = lv.fmt || 'decimal';
        x += `<w:lvl w:ilvl="${k}"><w:start w:val="${lv.start ?? 1}"/><w:numFmt w:val="${DOCX_FMT[fmt]}"/>${lv.legal ? '<w:isLgl/>' : ''}<w:lvlText w:val="${xe(fmt === 'bullet' ? (lv.text || '') : (lv.text != null ? lv.text : `%${k + 1}.`))}"/>${lv.font ? `<w:rPr><w:rFonts w:ascii="${xe(lv.font)}" w:hAnsi="${xe(lv.font)}"/></w:rPr>` : ''}</w:lvl>`;
      });
      for (let k = spec.lists[id].length; k < 9; k++) {
        const lv = spec.lists[id][spec.lists[id].length - 1];
        const fmt = lv.fmt || 'decimal';
        x += `<w:lvl w:ilvl="${k}"><w:start w:val="${lv.start ?? 1}"/><w:numFmt w:val="${DOCX_FMT[fmt]}"/>${lv.legal ? '<w:isLgl/>' : ''}<w:lvlText w:val="${xe(fmt === 'bullet' ? (lv.text || '') : (lv.text != null ? lv.text : `%${k + 1}.`))}"/>${lv.font ? `<w:rPr><w:rFonts w:ascii="${xe(lv.font)}" w:hAnsi="${xe(lv.font)}"/></w:rPr>` : ''}</w:lvl>`;
      }
      x += '</w:abstractNum>';
    });
    listIds(spec).forEach((id, i) => {
      if (isLikeList(spec, id)) x += `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${lstIdsOf(spec).indexOf(String(spec.lists[id].like))}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${spec.lists[id].start ?? 1}"/></w:lvlOverride></w:num>`;
      else x += `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${lstIdsOf(spec).indexOf(String(id))}"/></w:num>`;
    });
    parts.push({ name: 'word/numbering.xml', text: `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${NS}>${x}</w:numbering>` });
  }
  const sep = (tag) => `<w:${tag} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${tag}><w:${tag} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:${tag}>`;
  if (footnotes.length) parts.push({ name: 'word/footnotes.xml', text: `<?xml version="1.0" encoding="UTF-8"?><w:footnotes ${NS}>${sep('footnote')}${footnotes.join('')}</w:footnotes>` });
  if (endnotes.length) parts.push({ name: 'word/endnotes.xml', text: `<?xml version="1.0" encoding="UTF-8"?><w:endnotes ${NS}>${sep('endnote')}${endnotes.join('')}</w:endnotes>` });
  if (spec.title || spec.author) {
    parts.push({ name: 'docProps/core.xml', text: `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${spec.title ? `<dc:title>${xe(spec.title)}</dc:title>` : ''}${spec.author ? `<dc:creator>${xe(spec.author)}</dc:creator>` : ''}</cp:coreProperties>` });
  }
  parts.push({ name: 'word/_rels/document.xml.rels', text: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>` });
  parts.push(...media);
  return makeZip(parts).arrayBuffer();
}
