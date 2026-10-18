// Foreign-language passages (25 Sep 2026): every reader records the language of a passage that is not in the document's
// own language as `segment.lang` (BCP-47 primary subtag), the editor and the NIMAS save keep it, and — on Paul's
// instruction while the transcriber's answer is discussed — the braille does NOT change: the formatter must produce
// byte-identical output with or without `lang`. The rules and the noise heuristic are summarised in input/lang.mjs.
//
// Rulebook example used below (RUEB 2024 §13.1.2): "Her pirouette was lovely but her fouetté en tournant was spectacular."
// RUEB brailles the foreign phrase uncontracted (⠨⠶⠋⠕⠥⠑⠞⠞⠘⠌⠑ ⠑⠝ ⠞⠕⠥⠗⠝⠁⠝⠞⠨⠄, §13.2.1); BANA Formats §1.16.3 contracts
// foreign words in English context. Emboss today contracts (⠋⠳⠑⠞⠞⠘⠌⠑ … ⠞⠳⠗⠝⠁⠝⠞) and this test pins that it still does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
if (!globalThis.DOMParser) globalThis.DOMParser = DOMParser;
if (!globalThis.XMLSerializer) globalThis.XMLSerializer = XMLSerializer;

import { parseFile, parseDocx, parseDtbook } from '../input/parse.mjs';
import { exportToNimasXml } from '../input/nimas-export.mjs';
import { formatDocument } from '../format/document.mjs';
import { makeZip } from '../web/zip.mjs';
import { readCfb } from '../input/cfb.mjs';
import { readFib } from '../input/doc-fib.mjs';
import { readChpxRuns, forEachSprm } from '../input/doc-props.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EMBOSS = path.resolve(HERE, '..');
const ROOT = path.resolve(EMBOSS, '..');
const langMod = () => import('../input/lang.mjs');

// Every foreign span in a model, adjacent same-language runs joined: [{ lang, text }].
function spans(model) {
  const out = [];
  const walk = (v, key) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      let last = null;
      for (const x of v) {
        if (x && x.type === 'text' && x.lang) {
          if (last && last.lang === x.lang) last.text += x.text; else { last = { lang: x.lang, text: x.text }; out.push(last); }
        } else last = null;
        walk(x);
      }
      return;
    }
    for (const k of Object.keys(v)) if (k !== 'resources') walk(v[k], k);
  };
  walk(model.blocks);
  return out.map((s) => ({ lang: s.lang, text: s.text.trim() }));
}
const stripLang = (v) => JSON.parse(JSON.stringify(v, (k, x) => (k === 'lang' ? undefined : x)));
// Enough ordinary English that a few foreign words are clearly a minority of the document.
const ENGLISH = 'This is an ordinary English paragraph with plenty of plain words in it, written for the test. ';
const FILL = ENGLISH.repeat(6);

// ---------------------------------------------------------------------------------------------------------------------
test('lang.mjs: tags normalise to a primary subtag; noise and English variants mean nothing', async () => {
  const { primaryLang, foreignLangOf, lcidLang } = await langMod();
  assert.equal(primaryLang('fr-FR'), 'fr');
  assert.equal(primaryLang('En-US'), 'en');
  for (const t of ['x-none', 'zxx', 'und', 'mul', 'mis', '', null, 'x-klingon', 'qaa']) assert.equal(primaryLang(t), null, String(t));
  assert.equal(foreignLangOf('fr-CA', 'en-GB'), 'fr');
  assert.equal(foreignLangOf('en-US', 'en-GB'), null, 'English variants are all English');
  assert.equal(foreignLangOf('en', 'fr'), null, 'a document not in English is out of scope: nothing is tagged');
  assert.equal(foreignLangOf('de', null), 'de', 'no main language: English is assumed');
  assert.equal(lcidLang(1036), 'fr');
  assert.equal(lcidLang(2057), 'en');
  assert.equal(lcidLang(1024), null, 'LCID 1024 is "no proofing"');
  assert.equal(lcidLang(0x0C1A), 'sr');
  assert.equal(lcidLang(0x041A), 'hr');
});

// ---- DOCX ------------------------------------------------------------------------------------------------------------
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="en-GB" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="QuoteFR"><w:name w:val="Quote French"/><w:basedOn w:val="Normal"/><w:rPr><w:lang w:val="fr-FR"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Latin"><w:name w:val="Latin"/><w:rPr><w:lang w:val="la"/></w:rPr></w:style>
</w:styles>`;
const run = (t, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const para = (runs, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runs}</w:p>`;
async function docx(bodyXml, styles = STYLES) {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`;
  const parts = [{ name: 'word/document.xml', text: docXml }];
  if (styles) parts.push({ name: 'word/styles.xml', text: styles });
  return parseDocx(await makeZip(parts).arrayBuffer());
}

test('DOCX: a run, a character style and a paragraph style in another language are recorded; the script picks the slot', async () => {
  const m = await docx(para(run(FILL)) + para(run('He said ') + run('bonjour', '<w:lang w:val="fr-FR"/>') + run(' and read ') + run('De rerum natura', '<w:rStyle w:val="Latin"/>') + run(' today.'))
    + para(run('Prenons courage, Marguerite.'), '<w:pStyle w:val="QuoteFR"/>')
    + para(run('Tokyo: ') + run('東京', '<w:lang w:val="en-GB" w:eastAsia="ja-JP"/>') + run(' and ') + run('Paris', '<w:lang w:eastAsia="ja-JP"/>') + run('.')));
  assert.deepEqual(spans(m), [
    { lang: 'fr', text: 'bonjour' }, { lang: 'la', text: 'De rerum natura' }, { lang: 'fr', text: 'Prenons courage, Marguerite.' }, { lang: 'ja', text: '東京' },
  ]);
  const p2 = m.blocks[1];
  assert.deepEqual(p2.segments.map((s) => s.text), ['He said ', 'bonjour', ' and read ', 'De rerum natura', ' today.']);
});

test('DOCX noise: an en-GB/en-US mix, x-none, eastAsia/bidi-only tags, a stray proofing tag on English words or on part of a word change nothing', async () => {
  const body = (tagged) => para(run(FILL)) + para(
    run('The ') + run('colour', tagged ? '<w:lang w:val="en-US"/>' : '') + run(' of ') + run('this', tagged ? '<w:lang w:val="x-none"/>' : '')
    + run(' and ', tagged ? '<w:lang w:val="de-DE"/>' : '') + run('Attribute') + run('s', tagged ? '<w:lang w:val="de-DE"/>' : '') + run(' page')
    + run(' was ', tagged ? '<w:lang w:eastAsia="zh-CN" w:bidi="he-IL"/>' : '') + run('fine', tagged ? '<w:lang w:val="zxx"/>' : '') + run(' 2026', tagged ? '<w:lang w:val="fr-FR"/>' : '') + run('.'))
    + para(run('He said ') + run('bonjour', '<w:lang w:val="fr-FR"/>') + run('.'));   // the one genuine foreign word, in both
  const tagged = await docx(body(true)), plain = await docx(body(false));
  assert.deepEqual(spans(tagged), [{ lang: 'fr', text: 'bonjour' }]);
  assert.deepEqual(tagged, plain, 'the proofing tags leave the model exactly as it is without them');
});

test('DOCX: a document whose own language is not English records nothing (out of scope)', async () => {
  const fr = STYLES.replace('w:val="en-GB"', 'w:val="fr-FR"');
  const body = para(run('Il a dit ') + run('hello', '<w:lang w:val="en-GB"/>') + run(' et ') + run('Guten Tag', '<w:lang w:val="de-DE"/>'));
  assert.deepEqual(spans(await docx(body, fr)), []);
  assert.deepEqual(spans(await docx(body)), [{ lang: 'de', text: 'Guten Tag' }], 'the same paragraph in an English document');
});

test('DOCX: when tagged text is half the document or more, it is not a foreign passage and every tag is dropped', async () => {
  const m = await docx(para(run('Short English. ') + run('Un paragraphe entier en français, bien plus long que le reste.', '<w:lang w:val="fr-FR"/>')));
  assert.deepEqual(spans(m), []);
  assert.equal(m.blocks[0].text, 'Short English. Un paragraphe entier en français, bien plus long que le reste.');
  assert.equal(m.blocks[0].segments, undefined, 'the paragraph gets its plain text back, as the reader builds it without tags');
  const m2 = await docx(para(run(FILL)) + para(run('Short English. ') + run('Un paragraphe entier en français, bien plus long que le reste.', '<w:lang w:val="fr-FR"/>')));
  assert.deepEqual(spans(m2), [{ lang: 'fr', text: 'Un paragraphe entier en français, bien plus long que le reste.' }], 'a minority of the document: kept');
});

// ---- HTML / EPUB / Markdown ------------------------------------------------------------------------------------------
test('HTML: lang on inline elements, paragraphs, containers, headings, list items, cells and quotations', async () => {
  const html = `<html lang="en-GB"><body><p>${FILL}</p>
    <p>Her <i lang="fr">fouetté en tournant</i> was spectacular.</p>
    <p lang="es">Un momentito, por favor.</p>
    <div lang="de">Guten Tag</div>
    <h2>The <span xml:lang="la">Principia</span></h2>
    <ul><li>One <span lang="fr">deux</span></li></ul>
    <table><tr><th>A</th></tr><tr><td><span lang="fr">oui</span></td></tr></table>
    <blockquote lang="it"><p>Nel mezzo del cammin</p></blockquote></body></html>`;
  const m = await parseFile('t.html', html);
  assert.deepEqual(spans(m), [
    { lang: 'fr', text: 'fouetté en tournant' }, { lang: 'es', text: 'Un momentito, por favor.' }, { lang: 'de', text: 'Guten Tag' },
    { lang: 'la', text: 'Principia' }, { lang: 'fr', text: 'deux' }, { lang: 'fr', text: 'oui' }, { lang: 'it', text: 'Nel mezzo del cammin' },
  ]);
  const fouette = m.blocks[1].segments.find((s) => s.lang);
  assert.equal(fouette.tf, 1, 'emphasis kept alongside the language');
});

test('HTML noise: lang="en", zxx, a non-English page, and English words tagged foreign change nothing', async () => {
  const genuine = '<p>He said <span lang="fr">bonjour</span>.</p>';   // the one genuine foreign word, in both
  const tagged = await parseFile('t.html', `<html lang="en"><body><p>${FILL}</p><p>Say <span lang="en-US">color</span>, <span lang="zxx">x = 1</span>, <span lang="de">and then</span> Attribute<span lang="de">s</span>.</p>${genuine}</body></html>`);
  const plain = await parseFile('t.html', `<html lang="en"><body><p>${FILL}</p><p>Say <span>color</span>, <span>x = 1</span>, <span>and then</span> Attribute<span>s</span>.</p>${genuine}</body></html>`);
  assert.deepEqual(spans(tagged), [{ lang: 'fr', text: 'bonjour' }]);
  assert.deepEqual(tagged, plain);
  const fr = await parseFile('t.html', '<html lang="fr"><body><p>Il a dit <span lang="en">hello</span> et <span lang="de">Guten Tag</span>.</p></body></html>');
  assert.deepEqual(spans(fr), []);
});

async function epub(dcLang, chapter) {
  const parts = [
    { name: 'mimetype', text: 'application/epub+zip' },
    { name: 'META-INF/container.xml', text: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', text: `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title><dc:language>${dcLang}</dc:language></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>` },
    { name: 'OEBPS/c1.xhtml', text: `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en"><head><title>c</title></head><body>${chapter}</body></html>` },
  ];
  return parseFile('t.epub', await makeZip(parts).arrayBuffer());
}
test('EPUB: the book\'s dc:language is the main language (a French book with English boilerplate records nothing)', async () => {
  const chapter = `<p>${FILL}</p><p>He said <span xml:lang="fr" lang="fr">bonjour</span> today.</p>`;
  assert.deepEqual(spans(await epub('en', chapter)), [{ lang: 'fr', text: 'bonjour' }]);
  assert.deepEqual(spans(await epub('fr', chapter)), [], 'Gutenberg-style: dc:language fr, chapter markup lang="en" — out of scope');
});

test('Markdown: inline HTML with lang (a non-foreign span is just its text)', async () => {
  const m = await parseFile('t.md', `${FILL}\n\nHe said <span lang="fr">bonjour</span> and *<span lang="es">hola</span>* today.\n\n- item <span lang="de">Guten Tag</span>\n\nSay <span lang="en">hi</span> there.\n`);
  assert.deepEqual(spans(m), [{ lang: 'fr', text: 'bonjour' }, { lang: 'es', text: 'hola' }, { lang: 'de', text: 'Guten Tag' }]);
  const item = m.blocks.find((b) => b.type === 'list').items[0];
  assert.equal(item.text, 'item Guten Tag', 'the tags are not left in the item\'s plain text');
  // 30 Sep 2026 (Markdown import fix list #28; docs/expectation-changes.md): inline HTML is never printed as literal tags, so a span that is
  // not foreign (lang="en") is just its text. It was "Say <span lang="en">hi</span> there." (the tags left in the braille).
  assert.equal(m.blocks[m.blocks.length - 1].text, 'Say hi there.', 'a non-foreign span is just its text');
  const frDoc = await parseFile('t.md', '---\nlang: fr\n---\nIl a dit <span lang="en">hello</span>.\n');
  assert.deepEqual(spans(frDoc), []);
});

// ---- ODT -------------------------------------------------------------------------------------------------------------
const ODT_NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';
async function odt(body, autoStyles) {
  const content = `<?xml version="1.0"?><office:document-content ${ODT_NS}><office:automatic-styles>${autoStyles}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const styles = `<?xml version="1.0"?><office:document-styles ${ODT_NS}><office:styles><style:default-style style:family="paragraph"><style:text-properties fo:language="en" fo:country="GB" style:language-asian="zh" style:language-complex="ar"/></style:default-style></office:styles></office:document-styles>`;
  return parseFile('t.odt', await makeZip([{ name: 'content.xml', text: content }, { name: 'styles.xml', text: styles }]).arrayBuffer());
}
const tp = (name, attrs) => `<style:style style:name="${name}" style:family="text"><style:text-properties ${attrs}/></style:style>`;
test('ODT: fo:language on a span or paragraph style is recorded; zxx and a German tag on "and"/part of a word are not', async () => {
  const autos = tp('T1', 'fo:language="fr" fo:country="FR"') + tp('T2', 'fo:language="de" fo:country="DE"') + tp('T3', 'fo:language="zxx" fo:country="none"')
    + tp('T4', 'fo:language="en" fo:country="US"') + '<style:style style:name="P1" style:family="paragraph"><style:text-properties fo:language="es" fo:country="ES"/></style:style>';
  const m = await odt(`<text:p>${FILL}</text:p><text:p>He said <text:span text:style-name="T1">bonjour</text:span> today.</text:p>`
    + '<text:p text:style-name="P1">Un momentito, por favor.</text:p>'
    + '<text:p>Attribute<text:span text:style-name="T2">s</text:span> <text:span text:style-name="T2">and </text:span><text:span text:style-name="T3">10800</text:span> <text:span text:style-name="T4">color</text:span>.</text:p>', autos);
  assert.deepEqual(spans(m), [{ lang: 'fr', text: 'bonjour' }, { lang: 'es', text: 'Un momentito, por favor.' }]);
  assert.deepEqual(m.blocks[3], { type: 'para', text: 'Attributes and 10800 color.' }, 'noise leaves the paragraph exactly as before');
});

// ---- RTF -------------------------------------------------------------------------------------------------------------
test('RTF: \\lang against \\deflang; 1024 (no proofing) and English variants are nothing', async () => {
  const r = String.raw`{\rtf1\ansi\deflang2057{\fonttbl{\f0 Times;}}\pard\lang2057 ${FILL}\par\pard He said {\lang1036 bonjour} and {\i\lang1034 hasta la vista} today, {\lang1033 color} {\lang1024 zzz}.\par}`;
  const m = await parseFile('t.rtf', r);
  assert.deepEqual(spans(m), [{ lang: 'fr', text: 'bonjour' }, { lang: 'es', text: 'hasta la vista' }]);
  const plain = await parseFile('t.rtf', String.raw`{\rtf1\ansi\deflang2057{\fonttbl{\f0 Times;}}\pard\lang1033 ${FILL}\par\pard He said {\lang2057 colour} {\lang1024 zzz}.\par}`);
  assert.deepEqual(spans(plain), []);
  assert.ok(plain.blocks.every((b) => !b.segments), 'no paragraph grew segments from language noise');
});

// ---- Word 97-2003 .doc -----------------------------------------------------------------------------------------------
// cocoa-features.doc patched in memory: its "Apple" list item becomes "Pomme" set in French (lid 1036), "One" gets en-GB
// (2057) and "Two" "no proofing" (1024). Each run's font-size SPRM (sprmCHps, 0x4A43, 2-byte operand) is overwritten
// with sprmCRgLid0_80 (0x486D) — same length, so the FKP stays valid. The stream's 512-byte blocks are found in the file.
function patchDoc(file, edits) {
  const raw = new Uint8Array(fs.readFileSync(file));
  const cfb = readCfb(raw);
  const wd = cfb.getStream('WordDocument');
  const fib = readFib(wd);
  const table = cfb.getStream(fib.fWhichTblStm ? '1Table' : '0Table');
  const runs = readChpxRuns(wd, table, fib.fcLcb.PlcfBteChpx.fc, fib.fcLcb.PlcfBteChpx.lcb);
  const fileOffset = (streamOff) => {                        // the file position of a WordDocument stream byte
    for (const size of [512, 64]) {                           // a regular sector, or a mini-stream sector (small files)
      const base = streamOff - (streamOff % size);
      const block = wd.slice(base, base + size);
      for (let i = 0; i + size <= raw.length; i += 64) {
        let ok = true;
        for (let k = 0; k < size && ok; k++) if (raw[i + k] !== block[k]) ok = false;
        if (ok) return i + (streamOff - base);
      }
    }
    throw new Error('stream block not found');
  };
  for (const { text, newText, lid } of edits) {
    const r = runs.find((x) => Buffer.from(wd.slice(x.fcStart, x.fcEnd)).toString('utf16le').startsWith(text));
    assert.ok(r, 'run ' + text);
    let sprmAt = -1;
    forEachSprm(wd, r.start, r.end, (sp, o) => { if (sp === 0x4A43) sprmAt = o - 2; });
    assert.ok(sprmAt >= 0, 'font-size sprm in run ' + text);
    const at = fileOffset(sprmAt);
    raw.set([0x6D, 0x48, lid & 0xFF, lid >> 8], at);
    if (newText) { const t = fileOffset(r.fcStart); raw.set(Buffer.from(newText, 'utf16le'), t); }
  }
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
}
test('.doc: sprmCRgLid0 on a run is recorded; en-GB and "no proofing" are not', async () => {
  const buf = patchDoc(path.join(EMBOSS, 'tests/fixtures/doc/cocoa-features.doc'), [
    { text: 'Apple', newText: 'Pomme', lid: 1036 }, { text: 'One', lid: 2057 }, { text: 'Two', lid: 1024 },
  ]);
  const m = await parseFile('t.doc', buf);
  assert.deepEqual(spans(m), [{ lang: 'fr', text: 'Pomme' }]);
  const unpatched = await parseFile('t.doc', fs.readFileSync(path.join(EMBOSS, 'tests/fixtures/doc/cocoa-features.doc')).buffer);
  assert.deepEqual(spans(unpatched), []);
});

// ---- DTBook / NIMAS round trip ---------------------------------------------------------------------------------------
const DTB = (body, lang = 'en-US') => `<?xml version="1.0" encoding="UTF-8"?><dtbook xmlns="http://www.daisy.org/z3986/2005/dtbook/" version="2005-3" xml:lang="${lang}"><head><meta name="dtb:uid" content="x"/><meta name="dc:Title" content="T"/></head><book><bodymatter><level1>${body}</level1></bodymatter></book></dtbook>`;
const DTB_BODY = `<h1>The <span xml:lang="la">Principia</span></h1><p>${FILL}</p><p>Her <em xml:lang="fr">fouetté en tournant</em> was spectacular.</p>`
  + '<p xml:lang="es">Un momentito, por favor.</p><list type="ul"><li>One <span xml:lang="fr">deux</span></li></list>'
  + '<table><tr><th>A</th></tr><tr><td><span xml:lang="fr">oui</span></td></tr></table><p>Plain <span xml:lang="en-GB">colour</span>.</p>';
test('DTBook: xml:lang is read; the NIMAS save writes it back and re-reads to the same model', () => {
  const m = parseDtbook(DTB(DTB_BODY));
  assert.deepEqual(spans(m), [
    { lang: 'la', text: 'Principia' }, { lang: 'fr', text: 'fouetté en tournant' }, { lang: 'es', text: 'Un momentito, por favor.' },
    { lang: 'fr', text: 'deux' }, { lang: 'fr', text: 'oui' },
  ]);
  const xml = exportToNimasXml(m);
  for (const s of ['<span xml:lang="la">Principia</span>', '<span xml:lang="fr"><em>fouetté en tournant</em></span>', '<span xml:lang="es">Un momentito, por favor.</span>', '<span xml:lang="fr">deux</span>', '<span xml:lang="fr">oui</span>']) assert.ok(xml.includes(s), s);
  assert.ok(!/xml:lang="en/.test(xml.replace(/<dtbook[^>]*>/, '')), 'no English run is marked');
  const again = parseDtbook(xml);
  assert.deepEqual(again.blocks, m.blocks);
  assert.equal(exportToNimasXml(again).replace(/name="dtb:uid" content="[^"]*"/, ''), xml.replace(/name="dtb:uid" content="[^"]*"/, ''));
});

test('NIMAS export with foreign runs is valid against the official DTBook DTD (xmllint, offline)', (t) => {
  try { execFileSync('xmllint', ['--version'], { stdio: 'ignore' }); } catch { t.skip('xmllint not installed'); return; }
  const DTD_DIR = path.join(ROOT, 'references', 'dtd');
  const tmp = path.join(os.tmpdir(), `emboss_foreign_lang_${process.pid}.xml`);
  const xml = exportToNimasXml(parseDtbook(DTB(DTB_BODY)));
  assert.equal((xml.match(/<span xml:lang="/g) || []).length, 5, 'the export carries the foreign runs');
  fs.writeFileSync(tmp, xml);
  if (process.env.EMBOSS_FOREIGN_LANG_OUT) fs.copyFileSync(tmp, process.env.EMBOSS_FOREIGN_LANG_OUT);   // for daisy-validate
  const catalog = path.join(DTD_DIR, 'catalog.xml');
  const env = { ...process.env, XML_CATALOG_FILES: `file://${catalog.split(path.sep).map(encodeURIComponent).join('/')}` };
  const wrapper = path.relative(ROOT, path.join(DTD_DIR, 'dtbook-2005-3-mathml.dtd'));
  try { execFileSync('xmllint', ['--noout', '--nonet', '--dtdvalid', wrapper, tmp], { cwd: ROOT, env, stdio: 'pipe' }); }
  catch (e) { assert.fail(String(e.stderr || e.message).split('\n').slice(0, 12).join('\n')); }
  finally { fs.rmSync(tmp, { force: true }); }
});

test('a DOCX foreign run survives DOCX -> NIMAS -> DTBook', async () => {
  const m = await docx(para(run(FILL)) + para(run('He said ') + run('bonjour', '<w:lang w:val="fr-FR"/>') + run(' today.')));
  assert.deepEqual(spans(parseDtbook(exportToNimasXml(m))), [{ lang: 'fr', text: 'bonjour' }]);
});

// ---- the braille does not change -------------------------------------------------------------------------------------
const louis = await import('../engine/louis.mjs');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
const brf = (model, mode, pos) => formatDocument(structuredClone(model), { mode, standard: mode, width: 40, depth: 25, translate, translateG1, ...(pos ? { translatePos } : {}), suppressHeader: true });

test('the formatter ignores lang: byte-identical braille with or without it (BANA and UKAAF, format and trace paths)', async () => {
  const models = [
    parseDtbook(DTB(DTB_BODY)),
    await parseFile('t.html', `<html lang="en"><body><h1>Title <span lang="fr">Château</span></h1><p>${FILL}</p><p>Her pirouette was lovely but her <i lang="fr">fouetté en tournant</i> was spectacular.</p><p>"<span lang="es">Un momentito, por favor,</span>" said Carlos.</p><p>The Spanish word <span lang="es">y</span> means and; <span lang="fr">il y a deux ans</span>.</p><ol><li><span lang="de">Schwiegervater</span> is the German word for father-in-law.</li></ol></body></html>`),
  ];
  let checked = 0;
  for (const model of models) {
    assert.ok(spans(model).length >= 4, 'the model has foreign runs to ignore');
    for (const mode of ['bana', 'ukaaf']) for (const pos of [false, true]) {
      assert.equal(brf(model, mode, pos), brf(stripLang(model), mode, pos), `${mode} ${pos ? 'trace' : 'format'} path`);
      checked++;
    }
  }
  assert.equal(checked, 8);
});

test('a paragraph whose language gave it segments brailles exactly as its plain text did', async () => {
  const read = await parseFile('t.html', `<html lang="en"><body><p>${FILL}</p><p>Her pirouette was lovely but her <span lang="fr">fouetté en tournant</span> was spectacular.</p></body></html>`);
  assert.ok(read.blocks[1].segments && read.blocks[1].segments.some((s) => s.lang === 'fr'), 'the reader gave the paragraph segments for its French phrase');
  assert.equal(brf({ title: null, blocks: [read.blocks[1]] }, 'ukaaf', false), brf({ title: null, blocks: [{ type: 'para', text: 'Her pirouette was lovely but her fouetté en tournant was spectacular.' }] }, 'ukaaf', false));
  const asText = { title: null, blocks: [{ type: 'para', text: 'Her pirouette was lovely but her fouetté en tournant was spectacular.' }, { type: 'heading', level: 2, text: 'Un momentito, por favor.' }, { type: 'list', items: [{ text: 'One deux' }] }] };
  const asSegs = { title: null, blocks: [
    { type: 'para', segments: [{ type: 'text', text: 'Her pirouette was lovely but her ' }, { type: 'text', text: 'fouetté en tournant', lang: 'fr' }, { type: 'text', text: ' was spectacular.' }] },
    { type: 'heading', level: 2, text: 'Un momentito, por favor.', segments: [{ type: 'text', text: 'Un momentito, por favor.', lang: 'es' }] },
    { type: 'list', items: [{ text: 'One deux', segments: [{ type: 'text', text: 'One ' }, { type: 'text', text: 'deux', lang: 'fr' }] }] }] };
  for (const mode of ['bana', 'ukaaf']) for (const pos of [false, true]) assert.equal(brf(asSegs, mode, pos), brf(asText, mode, pos), `${mode} ${pos}`);
  // RUEB 13.1.2's own sentence is still contracted (the rule is not applied yet — see the header comment).
  assert.match(brf(asSegs, 'ukaaf', false), /F\\ETT\^\/E EN\s+T\\RNANT/);
});

// ---- editor ----------------------------------------------------------------------------------------------------------
test('editor: lang rides a CSS custom property on the text node and comes back out as seg.lang', async () => {
  const src = fs.readFileSync(path.join(EMBOSS, 'web/editor/editor.mjs'), 'utf8');
  assert.match(src, /const LANG_STYLE_RE = \/--bana-lang/);
  const body = src.slice(src.indexOf('function nodeToRuns('), src.indexOf('function paraBlock('));
  assert.equal((body.match(/langOfNode\(child\)/g) || []).length >= 3, true, 'link, cite and plain runs read it');
  assert.match(body, /\(last\.lang \|\| null\) === lg/, 'a run never merges across a language change');
  // 30 Sep 2026: the import now builds each text node through $appendScriptAware (sub/superscript runs), so the node
  // is made by `(x) => applyEmphasis($createTextNode(x), ...)` — the same call, only the variable is named x.
  assert.match(src, /applyEmphasis\(\$createTextNode\(x\), [^\n]*s\.transcriberTypeform, s\.lang\)/, 'import puts it on the text node');
  // The channel itself, in a real (headless) Lexical editor: the style survives an editor-state JSON round trip and a
  // French run does not merge into its plain English neighbour.
  const lex = await import('../web/editor/vendor-lexical.mjs');
  const pick = (name) => { const i = src.indexOf(name); return src.slice(i, src.indexOf('\n', i)); };
  const LANG_STYLE_RE = new RegExp(pick('const LANG_STYLE_RE = ').match(/\/(.*)\/;$/)[1]);
  const langStyle = (lang) => `--bana-lang: ${lang};`;
  const langOfNode = (n) => { const m = LANG_STYLE_RE.exec(n.getStyle() || ''); return m ? m[1] : null; };
  const editor = lex.createEditor({ namespace: 't', nodes: [], onError: (e) => { throw e; } });
  editor.update(() => {
    const p = lex.$createParagraphNode();
    const fr = lex.$createTextNode('bonjour'); fr.setStyle(langStyle('fr'));
    p.append(lex.$createTextNode('He said '), fr, lex.$createTextNode(' today.'));
    lex.$getRoot().append(p);
  }, { discrete: true });
  const json = JSON.stringify(editor.getEditorState().toJSON());
  const editor2 = lex.createEditor({ namespace: 't2', nodes: [], onError: (e) => { throw e; } });
  editor2.setEditorState(editor2.parseEditorState(json));
  editor2.read(() => {
    const kids = lex.$getRoot().getFirstChild().getChildren();
    assert.deepEqual(kids.map((n) => [n.getTextContent(), langOfNode(n)]), [['He said ', null], ['bonjour', 'fr'], [' today.', null]]);
  });
});
