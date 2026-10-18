// Node-only helper: the translators the Node test tools hand to the formatter, built EXACTLY the way the editor
// (web/editor/editor.mjs currentFormatOpts) and Quick Mode (web/app.mjs transcribe) build theirs (import fix list #55,
// Paul approved 1 Oct 2026).
//
// Until now gold-run, test-corpus, check-layout-parity and the corpus scripts passed a plain liblouis call as
// `translate`. The app never does: it wraps liblouis in styledTranslate (format/text-style.mjs), which resolves the
// sub/superscript markers (U+E000-U+E002) into UEB level signs by RUEB's grade-1 rules (A86), applies the quote
// exchange (UKAAF UK-3 / RUEB 7.6.4) when asked, and normalises invisible characters. A change to any of that was
// invisible to the tools that measure the standards. This is the one place that wiring is written down for Node.
//
// What the app does, copied (editor.mjs ~6205-6214, app.mjs ~395-398):
//   tr          = makeTranslators(louis, table)                       (BRF ASCII out, whatever the display table)
//   translateG1 = /en-ueb/.test(table) ? (s, tf) => makeTranslators(louis, UEB_TABLES.g1).translate(s, tf) : undefined
//   translate   = styledTranslate((s, tf) => tr.translate(s, tf), quoteStyle, /en-ueb-g2/.test(table) ? translateG1 : null)
//   translatePos= styledTranslatePos((s, tf) => tr.translatePos(s, tf || null), quoteStyle, /en-ueb-g2/.test(table) ? translateG1 : null)   (editor only)
// and formatDocument gets the RAW `translateG1` (the one the app puts in its options), the styled `translate`, and (editor)
// the styled `translatePos`. quoteStyle is the persisted setting: 'faithful' unless the transcriber chose 'exchange'
// (web/settings.mjs DEFAULTS.quoteStyle, UK-3 "off by default") - the same default for every standard.
//
// NOT part of the shipped browser pipeline (build-dist.mjs lists its files one by one; this is not among them).
import { makeTranslators, UEB_TABLES } from '../web/braille-table.mjs';
import { styledTranslate, styledTranslatePos } from './text-style.mjs';

// louis: the initialised Node engine (engine/louis.mjs). table: 'g2' | 'g1' (the UEB lists the app uses by default) or
// any liblouis table list string (what resolveTable returns for another braille code).
// Returns { translate, translatePos, translateG1, table }; spread the first three into the formatter options
// (leave translatePos out for the classic, no-position path that gold-run and the headless tests use).
export function editorTranslators(louis, { table = 'g2', quoteStyle = 'faithful' } = {}) {
  const tableList = UEB_TABLES[table] || table;
  const tr = makeTranslators(louis, tableList);
  const translateG1 = /en-ueb/.test(tableList)
    ? (s, tf) => makeTranslators(louis, UEB_TABLES.g1).translate(s, tf)
    : undefined;
  const translate = styledTranslate((s, tf) => tr.translate(s, tf), quoteStyle, /en-ueb-g2/.test(tableList) ? translateG1 : null);
  const translatePos = styledTranslatePos((s, tf) => tr.translatePos(s, tf || null), quoteStyle, /en-ueb-g2/.test(tableList) ? translateG1 : null);
  return { translate, translatePos, translateG1, table: tableList };
}
