// RTF title guess (AGENTS.md task, 26 Sep 2026): parseRtf used to make the first short
// paragraph (<=60 chars, no style/outline info of its own) the document's `title` whenever
// the document had more than one block — verified against
// tests/fixtures/libreoffice/lo-math-char.rtf, where the very first paragraph is just the
// label "Fraction:" (a formula follows it), and that label was becoming model.title even
// though it plainly isn't one. The same guess also silently overwrote the FIRST paragraph's
// block type from 'para' to 'title', discarding whatever it actually was.
//
// Fixed to use only real signals — the same kind DOCX (a Title-style paragraph, else
// docProps/core.xml's dc:title, parseDocx above) and HTML (<title>, else <h1>, parseHtml
// above) already use, never a guess based on the text itself:
//   1. a stylesheet "Title"/"Subtitle" paragraph style (classifyRtfStyle; unchanged by this
//      fix — already a real, typographic signal) — the paragraph itself becomes a `title`
//      block, same as before;
//   2. \info{\title …}, RTF's own document-properties destination (DOCX's dc:title / HTML's
//      <title> counterpart) — pure metadata; never creates or touches a body block;
//   3. the document's first Heading-1-level ( outline level 0, or a "heading 1"-named style)
//      paragraph — RTF/Word's structural counterpart of HTML's own <title>-else-<h1>
//      fallback; the paragraph stays a `heading` block, only `model.title` is filled in.
// Priority: 1, then 2, then 3 — matching parseDocx's "a real style wins over metadata"
// ordering, with the structural heading fallback (parseRtf's own addition, no DOCX/HTML
// equivalent) tried last, exactly as HTML tries <h1> only once <title> has failed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRtf } from '../input/parse.mjs';

const doc = (body) => `{\\rtf1\\ansi\\ansicpg1252\\deff0 ${body}}`;

test('a short, unstyled first paragraph is never guessed as the title (the lo-math-char.rtf "Fraction:" bug)', () => {
  const model = parseRtf(doc('{\\pard Fraction:\\par}{\\pard One half.\\par}{\\pard Root:\\par}{\\pard The square root of two.\\par}'));
  assert.equal(model.title, null, JSON.stringify(model));
  assert.equal(model.blocks[0].type, 'para');
  assert.equal(model.blocks[0].text, 'Fraction:');
});

test('\\info{\\title …} sets the document title as pure metadata, without touching the body', () => {
  const body = `{\\info{\\title My Report}{\\author Someone}{\\operator Someone}}{\\pard Short label.\\par}{\\pard More text follows here.\\par}`;
  const model = parseRtf(doc(body));
  assert.equal(model.title, 'My Report');
  // the body's own first paragraph is untouched — no title block was manufactured from it
  assert.equal(model.blocks[0].type, 'para');
  assert.equal(model.blocks[0].text, 'Short label.');
  assert.equal(model.blocks.length, 2);
});

test('\\info{\\title …} is read even when \\info is not the very first group in the document', () => {
  const body = `{\\pard Opening paragraph.\\par}{\\info{\\title Document Metadata Title}}{\\pard Second paragraph.\\par}`;
  const model = parseRtf(doc(body));
  assert.equal(model.title, 'Document Metadata Title');
  assert.equal(model.blocks.length, 2, JSON.stringify(model.blocks));
});

test('a stylesheet Title style still wins outright (unchanged) — no \\info needed', () => {
  const stylesheet = '{\\stylesheet{\\s0 Normal;}{\\s17 Title;}}';
  const withStyle = (body) => `{\\rtf1\\ansi\\ansicpg1252\\deff0${stylesheet} ${body}}`;
  const model = parseRtf(withStyle('{\\pard\\s17 Report Title\\par}{\\pard\\s0 Body text.\\par}'));
  assert.equal(model.title, 'Report Title');
  assert.equal(model.blocks[0].type, 'title');
});

test('the first Heading-1-level (\\outlinelevel0) paragraph is a title fallback when nothing else gives one', () => {
  const model = parseRtf(doc('{\\pard\\outlinelevel0 Chapter One\\par}{\\pard Body text.\\par}'));
  assert.equal(model.title, 'Chapter One', JSON.stringify(model));
  // the paragraph itself stays a real heading block — the fallback only fills model.title
  assert.equal(model.blocks[0].type, 'heading');
  assert.equal(model.blocks[0].level, 1);
});

test('the Heading-1 fallback only ever uses the FIRST such heading', () => {
  const body = `{\\pard\\outlinelevel0 First Chapter\\par}{\\pard Body.\\par}{\\pard\\outlinelevel0 Second Chapter\\par}`;
  const model = parseRtf(doc(body));
  assert.equal(model.title, 'First Chapter');
});

test('a heading at level 2 (\\outlinelevel1) is never used for the title fallback', () => {
  const model = parseRtf(doc('{\\pard\\outlinelevel1 Section One\\par}{\\pard Body.\\par}'));
  assert.equal(model.title, null, JSON.stringify(model));
  assert.equal(model.blocks[0].type, 'heading');
  assert.equal(model.blocks[0].level, 2);
});

test('\\info{\\title …} takes priority over the Heading-1 fallback', () => {
  const body = `{\\info{\\title The Real Title}}{\\pard\\outlinelevel0 Chapter One\\par}{\\pard Body.\\par}`;
  const model = parseRtf(doc(body));
  assert.equal(model.title, 'The Real Title');
  // the heading block is unaffected either way
  assert.equal(model.blocks[0].type, 'heading');
  assert.equal(model.blocks[0].level, 1);
});

test('a stylesheet Title style takes priority over both \\info and the Heading-1 fallback', () => {
  const stylesheet = '{\\stylesheet{\\s0 Normal;}{\\s17 Title;}}';
  const withStyle = (body) => `{\\rtf1\\ansi\\ansicpg1252\\deff0${stylesheet} ${body}}`;
  const body = `{\\info{\\title Metadata Title}}{\\pard\\s17 Styled Title\\par}{\\pard\\outlinelevel0 Chapter One\\par}`;
  const model = parseRtf(withStyle(body));
  assert.equal(model.title, 'Styled Title');
  assert.equal(model.blocks[0].type, 'title');
});

test('a document with no title signal at all stays untitled, even with several short paragraphs', () => {
  const model = parseRtf(doc('{\\pard Short.\\par}{\\pard Also short.\\par}{\\pard Still short.\\par}'));
  assert.equal(model.title, null);
  assert.equal(model.blocks.every((b) => b.type === 'para'), true, JSON.stringify(model.blocks));
});
