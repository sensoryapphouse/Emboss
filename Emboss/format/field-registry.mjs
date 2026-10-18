// One registry for the optional formatting fields (F-fields and BANA/UKAAF options added 23-24 Sep 2026 and
// the older ones they sit beside). Plain data plus a few small helpers; no imports, so the formatter, the
// parser/exporter (Node and browser) and the editor can all load it.
//
// Every field is described ONCE here and four places derive from it:
//   1. the save format   - input/nimas-export.mjs builds BANA_FLAG_FIELDS / BANA_TEXT_FIELDS / BANA_DOC_OPTIONS
//                          from `save` (parse.mjs reads through the same tables via readBanaFlags / docOptionValue);
//   2. the editor carry  - web/editor/editor.mjs's FMT_*_KEYS come from `carry` (fmtKeysFor);
//   3. the UI            - the "Braille formatting" dialog and the Settings "Braille formatting options" group are
//                          generated from `ui` + GROUPS (labels, help, control type, grouping, audience);
//   4. the formatter     - `affectsBraille` + `cache` say whether getBlockSignature (format/document.mjs) must key it;
//                          tests/field_registry.test.mjs checks every such field changes the signature.
//
// Entry shape:
//   key          model field name (block.<key>, item.<key>, segment.<key> or doc.<key>)
//   where        block types it applies to, plus 'item' (a list item), 'segment' (an inline run), 'doc' (model top level)
//   type         'bool' | 'string' | 'number' | 'enum' (values) | 'list' (of) | 'tri' (default/on/off) | 'object' | 'bool|string' ...
//   values / of  for enum / list
//   default      the value an unset field means
//   save         how it is written to DTBook, COPIED from what nimas-export.mjs wrote before the registry (saved files are
//                byte-identical):  { class, types?, value?, when? } a class token (flag), written in REGISTRY ORDER;
//                { class, title: n, types?, enc?, dec? } a class token + a part of the shared `title` (parts in title order n);
//                { meta, off?, text? } a <meta name> in <head>; { special: '...', class?/tokens? } written by its own code.
//                An empty list = not saved in the file yet (see `note`).
//   carry        editor buckets that keep it on a node's `fmt` (editor.mjs FMT_*_KEYS); editorKey when the node's name differs
//   audience     'everyone' | 'transcriber' (the "Transcriber tools" setting hides transcriber controls; never the braille)
//   ui           dialog / settings controls (see GROUPS for their order); codec names are defined in CODECS below
//   provisional  true where the wording or rule reading waits for a transcriber answer
//   affectsBraille  true when the braille output depends on it
//   cache        'key'     : formatBlock reads it -> it must be in getBlockSignature's key (tested)
//                'page'    : read only by the page builder / a pre-pass, not by formatBlock (tested: formatBlock unchanged)
//                'nested'  : reaches formatBlock only inside items/segments/blocks, which the key holds as JSON
//                'doc'     : a document option on `o`
//   rule, finding  where it comes from
//   sample       a minimal host (block, or { doc }) carrying the field, for the round-trip test
//
// ORDER MATTERS: class tokens are written in the order of this list (flag forms), title parts in `title` order.

export const FMT_OFF = '__off';   // the editor's marker for an explicit "off" (fmt drops false values)
export const FONT_BLOCK_TYPES = ['heading', 'para', 'note', 'play', 'list', 'footnote'];
export const PAGE_BREAK_TYPES = ['heading', 'para', 'note', 'play', 'list', 'footnote', 'table', 'box', 'sidebar', 'glossary', 'xref', 'graphic'];
export function isGlossaryBlock(b) { return !!b && (b.type === 'glossary' || b.kind === 'glossary' || b.style === 'glossary'); }

// Array values ride in the same `title` as one string: enc() joins them with ARR_SEP, dec() splits them again.
// Several text fields on one element share the single `title`, values in title order joined with TITLE_SEP.
export const ARR_SEP = '¦';
export const TITLE_SEP = '‖';
const encStrings = (v) => { const a = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; return a.length ? a.join(ARR_SEP) : null; };
const encSymbols = (v) => { const a = Array.isArray(v) ? v.map(String).filter(Boolean) : []; return a.length ? a.join(ARR_SEP) : null; };
const decStrings = (t) => String(t).split(ARR_SEP);
const encString = (v) => (typeof v === 'string' && v.trim() ? v : null);   // a boolean `true` is written by the flag token instead
// K8 / BANA 11.8: a table's key list, [{ symbol, meaning, group? }] (group 'row' or unset/'column'). Each item is
// "group¤symbol¤meaning" (¤ = KEY_SYM_SEP, a plain character so it survives XML attribute text); items join with ARR_SEP.
const KEY_SYM_SEP = '¤';
const encKeyItems = (v) => {
  const a = Array.isArray(v) ? v.filter((it) => it && typeof it === 'object' && String(it.symbol || '').trim() && String(it.meaning || '').trim()) : [];
  if (!a.length) return null;
  return a.map((it) => `${it.group === 'row' ? 'row' : 'col'}${KEY_SYM_SEP}${String(it.symbol).trim()}${KEY_SYM_SEP}${String(it.meaning).trim()}`).join(ARR_SEP);
};
const decKeyItems = (t) => String(t).split(ARR_SEP).map((s) => {
  const [group, symbol, ...rest] = s.split(KEY_SYM_SEP);
  const meaning = rest.join(KEY_SYM_SEP);
  return symbol && meaning ? { symbol, meaning, ...(group === 'row' ? { group: 'row' } : {}) } : null;
}).filter(Boolean);

// ---- shared UI strings (en.json app.braille_fmt.*) ----
const OPT_DEFAULT = { value: '', key: 'app.braille_fmt.opt_default', text: 'Default' };
const TRI_OPTIONS = [OPT_DEFAULT, { value: 'on', key: 'app.braille_fmt.opt_on', text: 'On' }, { value: 'off', key: 'app.braille_fmt.opt_off', text: 'Off' }];
const SYM_OPTIONS = [
  { value: '', key: 'app.braille_fmt.bullet_default', text: 'Default' },
  { value: '•', key: 'app.braille_fmt.sym_dot', text: '• dot' },
  { value: '◦', key: 'app.braille_fmt.sym_ring', text: '◦ small ring' },
  { value: '▪', key: 'app.braille_fmt.sym_small_square', text: '▪ small square' },
  { value: '□', key: 'app.braille_fmt.bullet_hollow_square', text: 'Hollow square' },
  { value: '■', key: 'app.braille_fmt.bullet_solid_square', text: 'Solid square' },
  { value: '○', key: 'app.braille_fmt.bullet_hollow_circle', text: 'Hollow circle' },
  { value: '▲', key: 'app.braille_fmt.bullet_triangle', text: 'Triangle' },
  { value: '✓', key: 'app.braille_fmt.bullet_checkmark', text: 'Checkmark' },
];
const L = (k) => `app.braille_fmt.${k}`;
// A checkbox / field control. `label` and `help` are the English text of en.json's `labelKey` / `helpKey` (the test
// checks they match); the page is built with data-i18n so other languages come from their own dictionaries.
const check = (id, group, k, label, help, more = {}) => ({ id, group, control: 'check', codec: 'bool', labelKey: L(k), label, ...(help != null ? { helpKey: L(`${k}_help`), help } : {}), ...more });
const field = (control, id, group, k, label, help, more = {}) => ({ id, group, control, codec: 'text', labelKey: L(k), label, ...(help != null ? { helpKey: L(`${k}_help`), help } : {}), ...more });
const docCheck = (id, k, label, help, codec = 'docBool') => ({ id, group: 'doc', control: 'check', codec, labelKey: L(`doc_${k}`), label, helpKey: L(`doc_${k}_help`), help });
const docText = (id, k, label, help, more = {}) => ({ id, group: 'doc', control: 'text', codec: 'docText', labelKey: L(`doc_${k}`), label, helpKey: L(`doc_${k}_help`), help, ...more });

// Help texts shared by several controls.
const H = {
  wordGaps: 'Every run of two or more spaces becomes a gap of two or three blank cells (BANA 19.4.1c).',
  pbbFonts: 'This block opens a fresh braille page; ignored when nothing precedes it (BANA 2.10.2b). Provisional: the print-page-number rule (2.10.2c) is a transcriber question.',
};

const T = 'transcriber', E = 'everyone';
const PARA_PLAY = ['para', 'play'];
const GLOSSARY_TYPES = ['list', 'glossary'];

export const FIELDS = [
  // ---- first batch (headings, directions, speaker, line-number notes) ----
  { key: 'notConnected', where: ['heading'], type: 'bool', default: false, save: [{ class: 'bana-not-connected' }], carry: ['heading'], audience: E,
    ui: [check('fmtNotConnected', 'heading', 'not_connected', 'Do not join to the heading above', 'Keeps this heading separate instead of running it on from the previous one.')],
    affectsBraille: true, cache: 'page', finding: 'F-84', rule: 'BANA 4.4', sample: { type: 'heading', level: 3, text: 'Part two', notConnected: true } },
  { key: 'accompaniesBox', where: ['heading'], type: 'bool', default: false, save: [{ class: 'bana-accompanies-box' }], carry: ['heading'], audience: T,
    ui: [check('fmtAccompaniesBox', 'heading', 'accompanies_box', 'Heading accompanies a box', 'The heading belongs with the box that follows it.')],
    affectsBraille: true, cache: 'page', rule: 'BANA 7.2.1e', sample: { type: 'heading', level: 3, text: 'Box heading', accompaniesBox: true } },
  // UK-1 (docs/decisions.md "UKAAF"; diagnosis-ukaaf-and-page-count-26sep.md cause 1): B004's Glossary calls
  // the end marker (indicator line) OPTIONAL ("can be placed after a section is complete"), but
  // formatHeading previously emitted it before every non-first level-1 UKAAF heading unconditionally — over-
  // applying it wherever a document has more than one L1 heading, even when there's no real "section" break
  // (samples 2 and 5 of the UKAAF gold corpus have none of these leaflets' several L1 headings marked at
  // all). Off by default; this per-heading opt-in turns it on for just the one chosen heading (the document-
  // wide `endMarkers` option, below, turns it on everywhere). UKAAF only — ignored in BANA (formatHeading's
  // BANA branch never reads it). UK-6 (28 Sep, James): the marker itself is now the COLONS form (closing a
  // chapter/major section), not dot-2s — UK-1's original dot-2s choice is superseded; dot-2s is now UK-6's
  // own after-table / after-subsection marker.
  { key: 'endMarkerBefore', where: ['heading'], type: 'bool', default: false, save: [{ class: 'bana-end-marker-before' }], carry: ['heading'], audience: T,
    ui: [check('fmtEndMarkerBefore', 'heading', 'end_marker_before', 'End marker before this heading', 'UKAAF only: a colons indicator line closing the previous section before this level-1 heading (B004 Glossary; James, UK-6). Off by default (UK-1).')],
    affectsBraille: true, cache: 'key', rule: 'B004 Glossary (indicator line / end marker); UK-1/UK-6', sample: { type: 'heading', level: 1, text: 'Method', endMarkerBefore: true } },
  { key: 'directions', where: ['para'], type: 'bool', default: false, save: [{ class: 'bana-directions' }], carry: ['para'], audience: E,
    ui: [], toolbar: 'btnDirectionsPara', affectsBraille: true, cache: 'key', rule: 'BANA 10.3.2', sample: { type: 'para', text: 'Read the passage.', directions: true } },
  { key: 'directionsContinued', where: ['para'], type: 'bool', default: false, save: [{ class: 'bana-directions-continued' }], carry: ['para'], audience: E,
    ui: [check('fmtDirectionsContinued', 'directions', 'directions_continued', 'Directions continued from the previous paragraph', null)],
    affectsBraille: true, cache: 'key', rule: 'BANA 10.3.3', sample: { type: 'para', text: 'Then answer.', directions: true, directionsContinued: true } },
  { key: 'directionsLabelled', where: ['para'], type: 'bool', default: false, save: [{ class: 'bana-directions-labelled' }], carry: ['para'], audience: E,
    ui: [check('fmtDirectionsLabelled', 'directions', 'directions_labelled', 'Directions with a letter or number label', null)],
    affectsBraille: true, cache: 'key', rule: 'BANA 10.3.2', sample: { type: 'para', text: 'A. Read.', directions: true, directionsLabelled: true } },
  { key: 'speakerGap', where: ['play'], type: 'bool', default: false, save: [{ class: 'bana-speaker-gap' }], carry: ['para'], audience: E,
    ui: [check('fmtSpeakerGap', 'speaker', 'speaker_gap', 'Three-cell gap after the speaker name', 'Off follows print: two cells when print leaves two spaces after the name (BANA 14.10.5a), one when punctuation or capitals already set it off.')],
    affectsBraille: true, cache: 'key', finding: 'F-206', sample: { type: 'play', subtype: 'prose', speaker: 'HAMLET', text: 'To be.', speakerGap: true } },
  { key: 'lnNoteOff', where: PARA_PLAY, type: 'bool', default: false, save: [{ class: 'bana-ln-note-off' }], carry: ['para'], audience: T,
    ui: [check('fmtLnNoteOff', 'verse', 'ln_note_off', 'No line-number note here', 'Suppresses the automatic note at this line.')],
    affectsBraille: true, cache: 'page', rule: 'BANA 15.3', sample: { type: 'para', text: 'A line.', lnNoteOff: true } },
  { key: 'lnMargin', where: PARA_PLAY, type: 'bool', default: false, save: [{ class: 'bana-ln-margin' }], carry: ['para'], audience: T,
    ui: [], affectsBraille: true, cache: 'key', rule: 'BANA 15.3', note: 'set by import only; no editor control', sample: { type: 'para', text: 'A line.', lnMargin: true } },
  // ---- second batch ----
  { key: 'paraNumber', where: ['para'], type: 'bool', default: false, save: [{ class: 'bana-para-number' }], carry: ['para'], audience: T,
    ui: [check('fmtParaNumber', 'para', 'paraNumber', 'Paragraph number written inline', "The paragraph must start with a line number. The number is written before the text at the paragraph's own indent and wraps with it (BANA 15.2.1b).")],
    affectsBraille: true, cache: 'key', rule: 'BANA 15.2.1b', finding: 'F-205', sample: { type: 'para', text: 'Text.', paraNumber: true } },
  { key: 'countedWords', where: PARA_PLAY, type: 'bool', default: false, save: [{ class: 'bana-counted-words' }], carry: ['para'], audience: T,
    ui: [check('fmtCountedWords', 'verse', 'countedWords', 'Counted words', 'Each line number follows the print line it counts, on the braille row where that line ends (BANA 15.8.1a).')],
    affectsBraille: true, cache: 'key', rule: 'BANA 15.8.1', sample: { type: 'para', text: 'Text.', countedWords: true } },
  { key: 'lnNoteBeforeHeading', where: PARA_PLAY, type: 'bool', default: false, save: [{ class: 'bana-ln-note-before-heading' }], carry: ['para'], audience: T,
    ui: [check('fmtLnNoteBeforeHeading', 'verse', 'lnNoteBeforeHeading', 'Line-number note before the heading', 'Set on the first line-numbered block: the automatic note goes before the heading just above it, with a blank line between (Sample 15-9). Default: after the heading.')],
    affectsBraille: true, cache: 'page', finding: 'F-234', rule: 'Sample 15-9', sample: { type: 'para', text: 'Text.', lnNoteBeforeHeading: true } },
  { key: 'songInfo', where: ['para'], type: 'bool', default: false, save: [{ class: 'bana-song-info' }], carry: ['para'], audience: T,
    ui: [check('fmtSongInfo', 'para', 'songInfo', 'Song information item', 'Items under a song title take 7-5 margins with no blank lines between them (BANA 13.11.2b). BANA only.')],
    affectsBraille: true, cache: 'key', rule: 'BANA 13.11.2b', sample: { type: 'para', text: 'Words by X.', songInfo: true } },
  { key: 'wordGaps', where: PARA_PLAY, type: 'bool', default: false, save: [{ class: 'bana-word-gaps' }], carry: ['para'], audience: T,
    ui: [check('fmtWordGaps', 'verse', 'wordGaps', 'Wide gaps between words', H.wordGaps), check('fmtParaWordGaps', 'para', 'wordGaps', 'Wide gaps between words', H.wordGaps)],
    affectsBraille: true, cache: 'key', rule: 'BANA 19.4.1c', sample: { type: 'para', text: 'a  b', wordGaps: true } },
  { key: 'rhymeLetters', where: ['play'], type: 'bool', default: false, save: [{ class: 'bana-rhyme-letters' }], carry: ['para'], audience: T,
    ui: [check('fmtRhymeLetters', 'verse', 'rhymeLetters', 'Rhyme letters', 'A poem with a rhyme scheme and line numbers: the rhyme letter is written with the line and is not read as a line number (BANA 15.7.3d).')],
    affectsBraille: true, cache: 'key', rule: 'BANA 15.7.3d', sample: { type: 'play', subtype: 'verse', style: 'verse', text: 'A line', rhymeLetters: true } },
  { key: 'wideSpaces', where: ['play', 'para'], type: 'bool', default: false, save: [{ class: 'bana-wide-spaces', types: ['play', 'para'] }], carry: ['para'], audience: T,
    ui: [check('fmtWideSpaces', 'verse', 'wideSpaces', 'Three blank cells for wide spaces', 'Each run of two or more spaces becomes three blank cells, for widely spaced words or phrases (BANA 13.6.3).')],
    affectsBraille: true, cache: 'key', rule: 'BANA 13.6.3', sample: { type: 'play', subtype: 'verse', style: 'verse', text: 'wide  apart', wideSpaces: true } },
  { key: 'uncontractedPoem', where: ['play'], type: 'bool', default: false, save: [{ class: 'bana-uncontracted-poem' }], carry: ['para'], audience: T,
    ui: [check('fmtUncontractedPoem', 'verse', 'uncontractedPoem', 'Uncontracted poem', 'The whole poem is written uncontracted, with one grade 1 passage indicator before its first line and one terminator after its last (BANA 13.6.4a).')],
    affectsBraille: true, cache: 'key', rule: 'BANA 13.6.4a', sample: { type: 'play', subtype: 'verse', style: 'verse', text: 'A line', uncontractedPoem: true } },
  { key: 'displayedPoem', where: ['play'], type: 'bool', default: false, save: [{ class: 'bana-displayed-poem' }], carry: ['para'], audience: T,
    ui: [check('fmtDisplayedPoem', 'verse', 'displayedPoem', 'Displayed poem (BANA)', 'A poem centred in print is displayed material: two cells in from the poem margins (BANA 13.3.1c). BANA only.')],
    affectsBraille: true, cache: 'key', rule: 'BANA 13.3.1c', sample: { type: 'play', subtype: 'verse', style: 'verse', text: 'A line', displayedPoem: true } },
  { key: 'noteMarkPlacement', where: ['footnote'], type: 'enum', values: ['none', 'inline'], default: null,
    save: [{ class: 'bana-note-mark-none', value: 'none' }, { class: 'bana-note-mark-inline', value: 'inline' }], carry: ['para'], audience: T,
    ui: [{ id: 'fmtNoteMarkPlacement', group: 'footnote', control: 'select', codec: 'enum', labelKey: L('noteMarkPlacement'), label: 'Note mark', helpKey: L('noteMarkPlacement_help'), help: 'Where the footnote mark goes (BANA 16.5.1d).',
      options: [OPT_DEFAULT, { value: 'none', key: L('noteMark_none'), text: 'No mark' }, { value: 'inline', key: L('noteMark_inline'), text: 'Inline, in the text' }] }],
    affectsBraille: true, cache: 'key', rule: 'BANA 16.5.1d', samples: [{ type: 'footnote', id: 'fn1', text: 'A note.', noteMarkPlacement: 'none' }, { type: 'footnote', id: 'fn1', text: 'A note.', noteMarkPlacement: 'inline' }] },
  { key: 'afterNote', where: ['list', 'caption'], type: 'bool', default: false, save: [{ class: 'bana-after-note' }], carry: ['list'], audience: T,
    ui: [check('fmtAfterNote', 'list', 'after_note', 'Note explaining a symbol sits above', 'The note that explains a symbol used in the list is placed directly above it (BANA 17.9.2a, Sample 17-11).')],
    // K11 / BANA 14.10.4b: the same flag, now also valid on a caption block — a single-frame
    // cartoon's caption runs on from its own scene-setting note with no blank line (Example
    // 14-10). Only the `list` bucket has an editor UI/carry entry so far; a caption set this
    // way today comes from import/round-trip, not (yet) the editor's own dialog.
    affectsBraille: true, cache: 'key', rule: 'BANA 17.9.2a, 14.10.4b',
    samples: [{ type: 'list', items: [{ text: 'a' }, { text: 'b' }], afterNote: true }, { type: 'caption', text: 'Caption text', afterNote: true }] },
  { key: 'wordList', where: ['list'], type: 'bool', default: false, save: [{ class: 'bana-word-list' }], carry: ['list'], audience: E, provisional: true,
    ui: [check('fmtWordList', 'list', 'word_list', 'Word list', 'Keeps the blank line after the directions (BANA 10.7.2b). Provisional: moving the list before the first question (10.7.2e) is a transcriber question.')],
    affectsBraille: true, cache: 'key', rule: 'BANA 10.7.2b', finding: 'F-227', sample: { type: 'list', items: [{ text: 'cat' }, { text: 'dog' }], wordList: true } },
  { key: 'thesaurus', where: GLOSSARY_TYPES, type: 'bool', default: false, save: [{ class: 'bana-thesaurus', when: isGlossaryBlock }], carry: ['list'], audience: T,
    ui: [check('fmtThesaurus', 'list', 'thesaurus', 'Thesaurus', 'Sets the entries as a thesaurus (BANA 21.7.2).', { wrap: 'fmtListGlossaryWrap' })],
    affectsBraille: true, cache: 'key', rule: 'BANA 21.7.2', sample: { type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'big', def: 'large' }], thesaurus: true } },
  { key: 'dictionary', where: GLOSSARY_TYPES, type: 'bool', default: false, save: [{ class: 'bana-dictionary', when: isGlossaryBlock }], carry: ['list'], audience: T,
    ui: [check('fmtDictionary', 'list', 'dictionary', 'Dictionary', 'Sets the entries as dictionary entries (BANA 21.7.3a and 21.8.5).', { wrap: 'fmtListGlossaryWrap' })],
    affectsBraille: true, cache: 'key', rule: 'BANA 21.7.3a', sample: { type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'big', def: 'large' }], dictionary: true } },
  // K25 (June 2024 changes): a definition list (17.6.1b-c; also 17.7.1c word lists) or a bilingual reference (21.9.2c) follows
  // print punctuation only - one blank cell after a punctuated entry, two after an unpunctuated one, with no capital-letter,
  // enclosure or mixed-style test (those stay with 21.5 glossaries). No editor control yet: set by the model (gold builder).
  { key: 'definitionList', where: GLOSSARY_TYPES, type: 'bool', default: false, save: [{ class: 'bana-definition-list', when: isGlossaryBlock }], carry: ['list'], audience: T,
    ui: [], affectsBraille: true, cache: 'key', rule: 'BANA 17.6.1b-c (June 2024)', note: 'set by the model only; no editor control yet', sample: { type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'heart', def: 'The organ that pumps blood' }], definitionList: true } },
  { key: 'bilingual', where: GLOSSARY_TYPES, type: 'bool', default: false, save: [{ class: 'bana-bilingual', when: isGlossaryBlock }], carry: ['list'], audience: T,
    ui: [], affectsBraille: true, cache: 'key', rule: 'BANA 21.9.2c (June 2024)', note: 'set by the model only; no editor control yet', sample: { type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'la casa', def: 'House' }], bilingual: true } },
  { key: 'alphabeticMargins', where: GLOSSARY_TYPES, type: 'bool', default: false, save: [{ class: 'bana-alphabetic-margins', when: isGlossaryBlock }], carry: ['list'], audience: T,
    ui: [check('fmtAlphabeticMargins', 'list', 'alphabetic_margins', 'Alphabetic margins', 'Main entries take the margins used for an alphabetic list (BANA 21.2.1b).', { wrap: 'fmtListGlossaryWrap' })],
    affectsBraille: true, cache: 'key', rule: 'BANA 21.2.1b', sample: { type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'big', def: 'large' }], alphabeticMargins: true } },
  { key: 'sharedMargin', where: GLOSSARY_TYPES, type: 'bool', default: false, save: [{ class: 'bana-shared-margin', when: isGlossaryBlock }], carry: ['list'], audience: T,
    ui: [check('fmtSharedMargin', 'list', 'shared_margin', 'Shared margin', 'The longest lead word already in an entry sits in cell 1 and the entry words line up after it (BANA 17.7.3).', { wrap: 'fmtListGlossaryWrap' })],
    affectsBraille: true, cache: 'key', rule: 'BANA 17.7.3', sample: { type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'big', def: 'large' }], sharedMargin: true } },
  { key: 'entryWord', where: ['heading'], type: 'bool', default: false, save: [{ class: 'bana-entry-word' }], carry: ['heading'], audience: T,
    ui: [check('fmtEntryWord', 'heading', 'entry_word', 'Entry word heading', 'The entry word is a cell-5 heading and the illustration under it follows with no blank line (BANA 21.6.5f).')],
    affectsBraille: true, cache: 'page', rule: 'BANA 21.6.5c/f', sample: { type: 'heading', level: 3, text: 'apple', entryWord: true } },
  { key: 'guideDots', where: ['table'], type: 'bool', default: true, save: [{ class: 'bana-no-guide-dots', value: false }], carry: [], editorKey: 'TableNode.noGuideDots', audience: E,
    ui: [check('fmtGuideDots', 'table', 'guideDots', 'Guide dots in blank entries', 'On (the default): a short entry is filled with guide dots. Off: plain blank cells, for matching columns (BANA 10.9.1d).', { codec: 'special' })],
    affectsBraille: true, cache: 'key', rule: 'BANA 10.9.1d', sample: { type: 'table', headers: ['A', 'B'], rows: [['1', '2']], guideDots: false } },
  { key: 'dotLocator', where: ['code'], type: 'bool', default: false, save: [{ class: 'bana-dot-locator' }], carry: ['para', 'code'], audience: T,
    ui: [], affectsBraille: true, cache: 'key', rule: 'BANA 19.2.2a', note: 'set by import only; no editor control', sample: { type: 'code', text: 'x = 1', dotLocator: true } },
  { key: 'keepSpaces', where: ['code'], type: 'bool', default: false, save: [{ class: 'bana-keep-spaces' }], carry: ['para', 'code'], audience: T,
    ui: [], affectsBraille: true, cache: 'key', note: 'set by import only; no editor control', sample: { type: 'code', text: 'x  = 1', keepSpaces: true } },
  { key: 'spaceLetters', where: ['code'], type: 'bool', default: false, save: [{ class: 'bana-space-letters' }], carry: ['para', 'code'], audience: T,
    ui: [], affectsBraille: true, cache: 'key', note: 'set by import only; no editor control', sample: { type: 'code', text: 'abc', spaceLetters: true } },
  // ---- third batch ----
  { key: 'diagram', where: ['para'], type: 'bool', default: false, save: [{ class: 'bana-diagram' }], carry: ['para'], audience: T,
    ui: [check('fmtDiagram', 'para', 'diagram', 'Diagrammed sentence', 'Sets the paragraph in 1-3 margins, as a diagrammed sentence needs (BANA 18.7.1). BANA only.')],
    affectsBraille: true, cache: 'key', rule: 'BANA 18.7.1', sample: { type: 'para', text: 'The dog ran.', diagram: true } },
  { key: 'hangingMargins', where: ['para'], type: 'bool', default: false, save: [{ class: 'bana-hanging-margins' }], carry: ['para'], audience: T, provisional: true,
    ui: [check('fmtHangingMargins', 'para', 'hangingMargins', 'Hanging margins (1-3)', 'Sets the paragraph in 1-3 margins instead of the usual paragraph margins. Provisional: taken from BANA example 3-2, not stated directly by rule 3.2.3.')],
    affectsBraille: true, cache: 'key', finding: 'F-107', sample: { type: 'para', text: 'Text.', hangingMargins: true } },
  { key: 'keyList', where: ['note'], type: 'bool', default: false, save: [{ class: 'bana-key-list' }], carry: ['para', 'note'], audience: T,
    ui: [check('fmtKeyList', 'note', 'keyList', 'Key list', 'A plain-text note whose first line introduces the list and whose further lines (two or more) are the items, at 1-3 margins between blank lines (BANA 3.3.2, Example 3-3).')],
    affectsBraille: true, cache: 'key', finding: 'F-15', rule: 'BANA 3.3.2', sample: { type: 'note', render: 'required', text: 'Key:', keyList: true } },
  { key: 'keyLocator', where: ['note'], type: 'bool', default: false, save: [{ class: 'bana-key-locator' }], carry: ['para', 'note'], audience: T,
    ui: [check('fmtKeyLocator', 'note', 'keyLocator', 'Dot locator in the key list', 'Puts the dot locator before each symbol in the key list (BANA 2.5.2c). Use together with Key list.')],
    affectsBraille: true, cache: 'key', rule: 'BANA 2.5.2c', requires: { keyList: true }, sample: { type: 'note', render: 'required', text: 'Key:', keyList: true, keyLocator: true } },
  { key: 'cell5', where: ['note'], type: 'bool', default: false, save: [{ class: 'bana-cell5' }], carry: ['para', 'note'], audience: T, provisional: true,
    ui: [check('fmtCell5', 'note', 'cell5', 'Heading note in cell 5', 'A short note that heads the list below it: 5-5 margins, a blank line before, the list directly under (BANA 10.9.2b). Provisional: the rule for a continuation note is a transcriber question.')],
    affectsBraille: true, cache: 'key', rule: 'BANA 10.9.2b', sample: { type: 'note', render: 'required', text: 'Match.', cell5: true } },
  { key: 'boxLines', where: ['box', 'sidebar'], type: 'bool', default: true, save: [{ class: 'bana-no-box-lines', value: false }], carry: [], fmtKey: 'noBoxLines', audience: E,
    ui: [check('fmtBoxLines', 'box', 'boxLines', 'Draw the box lines', 'On (the default): the sidebar has box lines. Off: a border-less sidebar (BANA 12.3.1e-g).', { codec: 'invert' })],
    affectsBraille: true, cache: 'key', finding: 'F-230', rule: 'BANA 12.3.1e-g', sample: { type: 'box', render: 'required', blocks: [{ type: 'para', text: 'Inside.' }], boxLines: false } },
  // K7 / BANA 7.5.1-7.5.2: the box's own colour (or "screened"/shading description), named in transcriber's-note
  // brackets at the start of the opening box line — but only when the document's boxes are not all the same
  // colour (a document-wide check: o._boxColorsUniform, computed once per format pass and folded into this
  // block's own signature below, since a box's rendering depends on every OTHER box's colour too).
  { key: 'boxColor', where: ['box', 'sidebar'], type: 'string', default: '', save: [{ class: 'bana-box-color', title: 12 }], carry: [], fmtKey: 'boxColor', audience: T,
    ui: [field('text', 'fmtBoxColor', 'box', 'boxColor', "Box colour", "Names the box's colour (or \"shaded\"/\"screened\") at the start of the opening box line, in transcriber's-note brackets. Only printed when the document's boxes are not all the same colour (BANA 7.5.1-7.5.2).")],
    affectsBraille: true, cache: 'key', finding: 'K7', rule: 'BANA 7.5.1-7.5.2', sample: { type: 'box', render: 'required', blocks: [{ type: 'para', text: 'Inside.' }], boxColor: 'blue' } },
  { key: 'implied', where: ['pagenum'], type: 'bool', default: false, save: [{ class: 'bana-implied' }], carry: ['pagenum'], audience: T,
    ui: [check('fmtImplied', 'pagenum', 'implied', 'Implied page number', 'The page number is implied, not printed (BANA 1.11.5).')],
    affectsBraille: true, cache: 'page', finding: 'F-45', rule: 'BANA 1.11.5', sample: { type: 'pagenum', page: '4', text: '4', implied: true } },
  { key: 'combineWithNext', where: ['pagenum'], type: 'bool', default: false, save: [{ class: 'bana-combine-with-next' }], carry: ['pagenum'], audience: T,
    ui: [check('fmtCombineWithNext', 'pagenum', 'combineWithNext', 'Combine with the next page', 'A blank or uncaptioned-picture print page is merged with the next print page that has text, with no indicator of its own (BANA 1.11.8d).')],
    affectsBraille: true, cache: 'page', finding: 'F-46', rule: 'BANA 1.11.8d', sample: { type: 'pagenum', page: '4', text: '4', combineWithNext: true } },
  // ---- fourth batch (findings batches A and B) ----
  { key: 'ignoreFont', where: [...FONT_BLOCK_TYPES, 'item', 'segment'], type: 'bool', default: false,
    save: [{ class: 'bana-ignore-font', types: FONT_BLOCK_TYPES }, { special: 'item-class', class: 'bana-ignore-font' }, { special: 'segment-span', class: 'bana-ignore-font' }],
    carry: ['heading', 'list', 'item', 'para', 'note'], audience: T,
    ui: [check('fmtIgnoreFont', 'fonts', 'ignoreFont', 'Ignore print fonts', 'Drops every font attribute (bold, italic, underline) from this block (BANA 2.9.1f and 5.3).'),
      check('fmtItemIgnoreFont', 'list', 'item_ignore_font', 'Ignore font in the selected item(s)', 'Print typeforms in the item with the caret, or every item selected, are ignored (BANA 2.9.1f).', { codec: 'special', target: 'items' })],
    textRun: 'IGNORE_FONT_STYLE', affectsBraille: true, cache: 'key', rule: 'BANA 2.9.1f / 5.3', finding: 'F-212',
    samples: [{ type: 'para', text: 'To my mother.', ignoreFont: true }, { item: { type: 'list', items: [{ text: 'one', ignoreFont: true }, { text: 'two' }] } },
      { segment: { type: 'para', text: 'a x b', segments: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'x', tf: 1, ignoreFont: true }, { type: 'text', text: ' b' }] } }] },
  { key: 'diacriticNotation', where: FONT_BLOCK_TYPES, type: 'bool', default: false, save: [{ class: 'bana-diacritic-notation', types: FONT_BLOCK_TYPES }], carry: ['heading', 'list', 'para', 'note'], audience: T,
    ui: [check('fmtDiacriticNotation', 'fonts', 'diacriticNotation', 'Diacritic notation', 'Drops the font attribute of each run that carries a combining mark, a stress mark or a prime; other runs keep theirs (BANA 20.4.2).')],
    affectsBraille: true, cache: 'key', rule: 'BANA 20.4.2', sample: { type: 'para', text: 'The word café.', diacriticNotation: true } },
  { key: 'omitFullEmphasis', where: FONT_BLOCK_TYPES, type: 'bool', default: false, save: [{ class: 'bana-omit-full-emphasis', types: FONT_BLOCK_TYPES }], carry: ['heading', 'list', 'para', 'note'], audience: T,
    ui: [check('fmtOmitFullEmphasis', 'fonts', 'omitFullEmphasis', 'Omit full emphasis', 'Drops font attributes when every text run of the block has the same emphasis; partial emphasis is kept (BANA 9.2.3b).')],
    affectsBraille: true, cache: 'key', finding: 'F-99', rule: 'BANA 9.2.3b', sample: { type: 'para', text: 'All italic.', omitFullEmphasis: true } },
  { key: 'omitEmphasis', where: FONT_BLOCK_TYPES, type: 'bool', default: false, save: [{ class: 'bana-omit-emphasis', types: FONT_BLOCK_TYPES }], carry: ['heading', 'list', 'para', 'note'], audience: T,
    ui: [check('fmtOmitEmphasis', 'fonts', 'omitEmphasis', 'Omit all emphasis', 'Drops all font attributes from the block, where you judge they are not needed to tell things apart (BANA 14.3.1d).')],
    affectsBraille: true, cache: 'key', finding: 'F-215', rule: 'BANA 14.3.1d', sample: { type: 'para', text: 'Some bold here.', omitEmphasis: true } },
  { key: 'pageBreakBefore', where: PAGE_BREAK_TYPES, type: 'bool', default: false, save: [{ class: 'bana-page-break-before', types: PAGE_BREAK_TYPES }],
    carry: ['heading', 'list', 'para', 'note', 'table', 'pbb'], audience: E,
    ui: [check('fmtPageBreakBefore', 'fonts', 'pageBreakBefore', 'Start on a new braille page', H.pbbFonts),
      check('fmtTablePageBreakBefore', 'table', 'pageBreakBefore', 'Start on a new braille page', H.pbbFonts),
      check('fmtBoxPageBreakBefore', 'box', 'boxPageBreak', 'Start the box on a new braille page', 'The whole sidebar opens a fresh braille page; ignored when nothing precedes it (BANA 2.10.2b).')],
    affectsBraille: true, cache: 'key', finding: 'F-147', rule: 'BANA 2.10.2b', provisional: true, sample: { type: 'para', text: 'Starts a new page.', pageBreakBefore: true } },
  { key: 'unnumbered', where: ['pagenum'], type: 'bool', default: false, save: [{ class: 'bana-unnumbered' }], carry: ['pagenum'], audience: T,
    ui: [check('fmtUnnumbered', 'pagenum', 'unnumbered', 'Unnumbered page change', 'A page change with no print number: a full-width row of dots 36 (BANA 1.11.6a).')],
    affectsBraille: true, cache: 'key', finding: 'F-51', rule: 'BANA 1.11.6a', sample: { type: 'pagenum', page: '5', text: '5', unnumbered: true } },
  { key: 'guideDotNote', where: ['table'], type: 'bool|string', default: false,
    save: [{ class: 'bana-guide-dot-note' }, { class: 'bana-guide-dot-note-text', title: 8, enc: encString }], carry: ['table'], audience: T,
    ui: [check('fmtGuideDotNote', 'table', 'guideDotNote', 'Guide-dot note', "Adds the explanation of guide dots as the table's opening note when a blank entry occurs (UKAAF B004 12b). Columnar layout.", { codec: 'guideDotNote', part: 'on' }),
      field('text', 'fmtGuideDotNoteText', 'table', 'guideDotNoteText', 'Own wording for the guide-dot note', null, { codec: 'guideDotNote', part: 'text' })],
    affectsBraille: true, cache: 'key', finding: 'F-20', rule: 'UKAAF B004 12b',
    samples: [{ type: 'table', headers: ['A', 'B'], rows: [['1', '2']], guideDotNote: true }, { type: 'table', headers: ['A', 'B'], rows: [['1', '2']], guideDotNote: 'Own words' }] },
  { key: 'repeatHeadings', where: ['table'], type: 'tri', default: null,
    save: [{ class: 'bana-repeat-headings', value: true }, { class: 'bana-no-repeat-headings', value: false }], carry: ['table'], offMarker: true, audience: T,
    ui: [{ id: 'fmtRepeatHeadings', group: 'table', control: 'select', codec: 'tri', labelKey: L('repeatHeadings'), label: 'Repeat column headings on each page', helpKey: L('repeatHeadings_help'), help: 'On repeats the column headings and separation line on each following braille page (BANA 11.4.4a). Columnar layout.', options: TRI_OPTIONS }],
    affectsBraille: true, cache: 'key', rule: 'BANA 11.4.4a',
    samples: [{ type: 'table', headers: ['A', 'B'], rows: [['1', '2']], repeatHeadings: true }, { type: 'table', headers: ['A', 'B'], rows: [['1', '2']], repeatHeadings: false }] },
  { key: 'continuedNote', where: ['table'], type: 'tri|string', default: null,
    save: [{ class: 'bana-continued-note', value: true }, { class: 'bana-no-continued-note', value: false }, { class: 'bana-continued-note-text', title: 9, enc: encString }], carry: ['table'], offMarker: true, audience: T,
    ui: [{ id: 'fmtContinuedNote', group: 'table', control: 'select', codec: 'continuedNote', part: 'mode', labelKey: L('continuedNote'), label: 'Continued note', helpKey: L('continuedNote_help'), help: 'On (BANA default) adds a "Table n (cont.)" note beside the page number (BANA 11.3.2b).', options: TRI_OPTIONS },
      field('text', 'fmtContinuedNoteText', 'table', 'continuedNoteText', 'Own wording for the continued note', 'Needs the continued note set to On. Leave empty for the standard wording.', { codec: 'continuedNote', part: 'text' })],
    affectsBraille: true, cache: 'page', rule: 'BANA 11.3.2b',
    samples: [{ type: 'table', headers: ['A', 'B'], rows: [['1', '2']], continuedNote: true }, { type: 'table', headers: ['A', 'B'], rows: [['1', '2']], continuedNote: false }, { type: 'table', headers: ['A', 'B'], rows: [['1', '2']], continuedNote: 'Cont.' }] },
  { key: 'stripContinuation', where: ['list'], type: 'bool', default: false, save: [{ class: 'bana-strip-continuation' }], carry: ['list'], audience: T,
    ui: [check('fmtStripContinuation', 'list', 'strip_continuation', 'Strip continuation letters', 'On a contents list: a trailing continuation letter is dropped from each page number (BANA 2.10.7a).')],
    affectsBraille: true, cache: 'key', finding: 'F-151', rule: 'BANA 2.10.7a', sample: { type: 'list', kind: 'toc', items: [{ text: 'Chapter one', page: '12a' }, { text: 'Chapter two', page: '14' }], stripContinuation: true } },
  { key: 'poemMethod', where: ['play'], type: 'enum', values: ['line-indicator', 'stanza-cell3'], default: null,
    save: [{ class: 'bana-poem-line-indicator', value: 'line-indicator' }, { class: 'bana-poem-stanza-cell3', value: 'stanza-cell3' }], carry: ['para'], audience: T, provisional: true,
    ui: [{ id: 'fmtPoemMethod', group: 'verse', control: 'select', codec: 'enum', labelKey: L('poemMethod'), label: 'Poem method (UKAAF)', helpKey: L('poemMethod_help'), help: 'UKAAF B004 Appendix J only: write the poem continuously. Provisional: the transcriber questions on the indicator dots and where it goes are still open.',
      options: [OPT_DEFAULT, { value: 'line-indicator', key: L('poemMethod_line'), text: 'Line indicator' }, { value: 'stanza-cell3', key: L('poemMethod_stanza'), text: 'Stanza in cell 3' }] }],
    affectsBraille: true, cache: 'page', finding: 'F-128 / F-129', rule: 'UKAAF B004 Appendix J',
    samples: [{ type: 'play', subtype: 'verse', style: 'verse', text: 'A line', poemMethod: 'line-indicator' }, { type: 'play', subtype: 'verse', style: 'verse', text: 'A line', poemMethod: 'stanza-cell3' }] },
  // ---- fifth batch (K30 / K27, 26 Sep 2026) ----
  // K30 / BANA 8.1.4b (Example 8-6): the transcriber's override for K1's decorative-emphasis
  // rule (see document.mjs's decorativeEmphasisOf/headingEmphasisOf) — the whole list, table
  // or dedication shares one typeform, but it is judged NOT decorative, so print emphasis is
  // kept. `block.keepEmphasis` and `block.dedication` already drive the formatter (K1); this
  // registers them for save/load and the dialog.
  { key: 'keepEmphasis', where: ['list', 'table'], type: 'bool', default: false, save: [{ class: 'bana-keep-emphasis', types: ['list', 'table'] }], carry: ['list', 'table'], audience: T,
    ui: [check('fmtKeepEmphasis', 'list', 'keep_emphasis', 'Keep print emphasis (titles)', 'Keeps print emphasis (bold, italic…) even though the whole structure shares it — judged not decorative (BANA 8.1.4b, Example 8-6).'),
      check('fmtTableKeepEmphasis', 'table', 'keep_emphasis', 'Keep print emphasis (titles)', 'Keeps print emphasis (bold, italic…) even though the whole structure shares it — judged not decorative (BANA 8.1.4b, Example 8-6).')],
    affectsBraille: true, cache: 'key', rule: 'BANA 8.1.4b', finding: 'K1',
    samples: [{ type: 'list', items: [{ text: 'one' }, { text: 'two' }], keepEmphasis: true }, { type: 'table', headers: ['A', 'B'], rows: [['1', '2']], keepEmphasis: true }] },
  // K30 / BANA 2.9.1f: marks a paragraph as (part of) a dedication or acknowledgement — K1's
  // emphasisContext (document.mjs, buildDocPages) groups consecutive `dedication` blocks and
  // judges their emphasis together, the same way a contents list is grouped.
  { key: 'dedication', where: ['para'], type: 'bool', default: false, save: [{ class: 'bana-dedication' }], carry: ['para'], audience: T,
    ui: [check('fmtDedication', 'para', 'dedication', 'Part of a dedication', 'Groups this paragraph with the ones next to it that are also part of a dedication, judged together for decorative emphasis (BANA 2.9.1f).')],
    affectsBraille: true, cache: 'key', rule: 'BANA 2.9.1f', finding: 'K1',
    sample: { type: 'para', text: 'To my mother.', dedication: true } },
  // K27 / BANA June 2024 9.2.6: displayed foreign text paired with its English translation —
  // format as a nested list (no columns), the appropriate displayed-material margins, and
  // print emphasis that only distinguishes the two languages omitted (document.mjs's
  // columnedListPlan / formatList / decorativeEmphasisOf).
  { key: 'translationPairs', where: ['list'], type: 'bool', default: false, save: [{ class: 'bana-translation-pairs' }], carry: ['list'], audience: T,
    ui: [check('fmtTranslationPairs', 'list', 'translation_pairs', 'Translation pairs (BANA 9.2.6)', 'Displayed foreign text paired with its translation: formats the list as a nested list, no columns, and omits print emphasis that only distinguishes the two languages (BANA June 2024 9.2.6).')],
    affectsBraille: true, cache: 'key', rule: 'BANA 9.2.6',
    sample: { type: 'list', items: [{ text: 'Bonjour' }, { text: 'Hello', level: 1 }], translationPairs: true } },
  // ---- sixth batch (K6, 26 Sep 2026): displayed material (BANA §9.2) ----
  // K6 / BANA §9.1.2: "Lists within displayed material are part of that displayed material
  // and must use adjusted margins" (formatList's own `displayed`-driven offset, F-79) and
  // BANA §9.2.2c: a cell-5/cell-7 heading nested in displayed material shifts outward by the
  // same 2 cells the adjusted margin itself is offset by (formatHeading). One flag serves
  // both block types; the reader sets it from the source's own nesting inside a displayed
  // passage (a <blockquote>'s child heading/list) — never a transcriber's own choice, so
  // there is no dialog control (compare `lnMargin`, `dotLocator`: "set by import only").
  { key: 'displayed', where: ['heading', 'list'], type: 'bool', default: false,
    save: [{ class: 'bana-displayed', types: ['heading', 'list'] }], carry: ['heading', 'list'], audience: T, ui: [],
    affectsBraille: true, cache: 'key', rule: 'BANA 9.1.2 / 9.2.2c', finding: 'K6', note: 'set by import only; no editor control',
    samples: [{ type: 'heading', level: 3, text: 'Inside a quotation', displayed: true }, { type: 'list', items: [{ text: 'one' }, { text: 'two' }], displayed: true }] },
  // K6 / BANA §9.2.2d: "Blocked paragraphs are blocked at the adjusted left margin; indented
  // paragraphs begin 2 cells to the right of the adjusted left margin." KD: "Both! Fully
  // dependent upon what print has" — set per displayed paragraph from print's own first-line
  // indent (DOCX w:ind firstLine, HTML/EPUB CSS text-indent, ODT fo:text-indent, .doc
  // dxaLeft1), each read by its own reader; see quoteMargins (document.mjs).
  { key: 'displayIndent', where: ['para'], type: 'bool', default: false, save: [{ class: 'bana-display-indent' }], carry: ['para'], audience: T,
    ui: [check('fmtDisplayIndent', 'para', 'display_indent', 'Indented displayed paragraph', "The first line begins 2 cells right of the rest of the displayed passage, following print's own indent (BANA 9.2.2d). Off (blocked): the first line lines up with the rest of the passage. Only applies to a displayed quotation paragraph.")],
    affectsBraille: true, cache: 'key', rule: 'BANA 9.2.2d', finding: 'K6', sample: { type: 'para', style: 'quote', text: 'Quoted text.', displayIndent: true } },

  // ---- text fields (a class token plus a part of the shared `title`; title order = `title`) ----
  { key: 'enclosePrefix', where: ['note'], type: 'string', default: '', save: [{ class: 'bana-enclose-prefix', title: 1 }], carry: ['para', 'note'], audience: T,
    ui: [field('text', 'fmtEnclosePrefix', 'note', 'enclose_prefix', 'Enclosed prefix text', 'Only this opening text is enclosed in the note indicators. Leave empty to enclose the whole note.')],
    affectsBraille: true, cache: 'key', finding: 'F-241', sample: { type: 'note', render: 'required', text: 'Cartoon: a cat.', enclosePrefix: 'Cartoon' } },
  { key: 'arrowLines', where: ['para'], type: 'list', of: 'string', default: null, save: [{ class: 'bana-arrows', title: 2, enc: encStrings, dec: decStrings }], carry: ['para'], audience: T,
    ui: [field('textarea', 'fmtArrowLines', 'para', 'arrowLines', 'Arrow lines, one per line', 'Your own arrow and shaft cells, one braille line per line here (BANA 18.8.1: a blank line goes before and after each arrow and sentence pair). A line wider than the page is cut to the page width.',
      { codec: 'lines', maxLen: 60, errKey: L('err_arrow'), attrs: { rows: '3' } })],
    affectsBraille: true, cache: 'key', finding: 'F-189', rule: 'BANA 18.8.1', sample: { type: 'para', text: 'The dog ran.', arrowLines: ['33o', '  3'] } },
  { key: 'mentionSymbols', where: ['note'], type: 'list', of: 'string', default: null, save: [{ class: 'bana-mention-symbols', title: 3, enc: encSymbols, dec: decStrings }], carry: ['para', 'note'], audience: T,
    ui: [field('text', 'fmtMentionSymbols', 'note', 'mentionSymbols', 'Mentioned symbols', 'The print symbols this note mentions, separated by commas. The dot locator for mention goes before the first use of each in the note (BANA 2.5.2).', { codec: 'csv', errKey: L('err_csv') })],
    affectsBraille: true, cache: 'key', finding: 'F-138', rule: 'BANA 2.5.2', sample: { type: 'note', render: 'required', text: 'The * marks.', mentionSymbols: ['*'] } },
  { key: 'through', where: ['pagenum'], type: 'string', default: '', save: [{ class: 'bana-through', title: 4 }], carry: ['pagenum'], audience: T,
    ui: [field('text', 'fmtThrough', 'pagenum', 'through', 'Through (end of a page range)', 'The last page of a combined, omitted or facing range: 25 with through 29 gives 25-29 (BANA 1.11.8 and 1.12.1).')],
    affectsBraille: true, cache: 'key', rule: 'BANA 1.11.8 / 1.12.1', sample: { type: 'pagenum', page: '25', text: '25', through: '29' } },
  { key: 'spelled', where: ['pagenum'], type: 'string', default: '', save: [{ class: 'bana-spelled', title: 5 }], carry: ['pagenum'], audience: T,
    ui: [field('text', 'fmtSpelled', 'pagenum', 'spelled', 'Spelled-out page number', 'The print page number in words, when print spells it out as well as giving the number (BANA 1.13.1).')],
    affectsBraille: true, cache: 'key', rule: 'BANA 1.14.1', sample: { type: 'pagenum', page: '5', text: '5', spelled: 'five' } },
  { key: 'lnNoteText', where: PARA_PLAY, type: 'string', default: '', save: [{ class: 'bana-ln-note', title: 6 }], carry: ['para'], audience: T,
    ui: [field('text', 'fmtLnNoteText', 'verse', 'ln_note_text', 'Line-number note wording', 'Your own wording for the note that explains line numbers. Leave empty for the standard sentence.')],
    affectsBraille: true, cache: 'key', finding: 'F-234', requires: { lnNote: true }, note: 'takes effect with the lnNote flag the page builder sets on the first line-numbered block', sample: { type: 'para', text: 'A line.', lnNoteText: 'Line numbers are at the right.' } },
  { key: 'citation', where: ['graphic', 'table'], type: 'string|object', default: null,
    save: [{ class: 'bana-citation', title: 7, types: ['graphic'] }, { special: 'table-tfoot', tokens: ['bana-table-citation', 'bana-citation-inside'], types: ['table'] }],
    carry: ['table'], editorKey: 'ImageNode.__image.citation (graphic)', audience: E,
    ui: [field('text', 'fmtCitationText', 'table', 'citationText', 'Source citation', 'The source of the table, set at 5-5 margins (BANA 11.2.5g). Leave empty for none.', { codec: 'citation', part: 'text' }),
      { id: 'fmtCitationPos', group: 'table', control: 'select', codec: 'citation', part: 'position', audience: T, labelKey: L('citationPos'), label: 'Citation position', helpKey: L('citationPos_help'), help: 'Default: after the bottom box line with a blank line after it. Inside the box: the last line inside the box (Sample 11-20).',
        options: [OPT_DEFAULT, { value: 'inside-box', key: L('citPos_inside'), text: 'Inside the box' }] }],
    affectsBraille: true, cache: 'key', rule: 'BANA 6.2.2c / 11.2.5g', finding: 'F-7 / F-14',
    samples: [{ type: 'graphic', src: 'a.png', alt: 'A map', citation: 'Source: atlas' }, { type: 'table', headers: ['A', 'B'], rows: [['1', '2']], citation: 'Source: X' }, { type: 'table', headers: ['A', 'B'], rows: [['1', '2']], citation: { text: 'Source: X', position: 'inside-box' } }] },
  // K8 / BANA 11.8.1-11.8.2: a key of devised symbols for condensed column/row headings, [{ symbol, meaning,
  // group? }] (group 'row', else column). Rendered as one transcriber's note below the table title or top box
  // line: 7-5 intro, cell-5 "Column headings"/"Row headings" only when both groups are used, 1-3 key items
  // alphabetised by symbol. Combined with an ordinary table note (block.tabletn/note) and F-20's guideDotNote
  // into a single note, the key list always last (11.8.2i) — see tableKeyNoteLines/document.mjs.
  { key: 'key', where: ['table'], type: 'list', of: 'object', default: null, save: [{ class: 'bana-key', title: 13, enc: encKeyItems, dec: decKeyItems }], carry: ['table'], audience: T,
    ui: [field('textarea', 'fmtTableKey', 'table', 'key', 'Key of devised symbols', 'One item per line, as "code: meaning" for a column-heading key or "row code: meaning" for a row-heading key, for example "nf: Number of employees" or "row aam: African American" (BANA 11.8.1-11.8.2).',
      { codec: 'tableKey', errKey: L('err_table_key'), attrs: { rows: '4' } })],
    affectsBraille: true, cache: 'key', finding: 'K8', rule: 'BANA 11.8.1-11.8.2',
    sample: { type: 'table', headers: ['A', 'B'], rows: [['1', '2']], key: [{ symbol: 'nf', meaning: 'Number of items' }, { symbol: 'aam', meaning: 'African American', group: 'row' }] } },
  { key: 'keyIntro', where: ['table'], type: 'string', default: '', save: [{ class: 'bana-key-intro', title: 14 }], carry: ['table'], audience: T,
    ui: [field('text', 'fmtTableKeyIntro', 'table', 'keyIntro', 'Key introduction wording', 'Your own wording for the key list’s opening line. Leave empty for the standard "Key to column headings:" / "Key to row headings:" / "Key to column and row headings:" (BANA 11.8.2a).')],
    affectsBraille: true, cache: 'key', rule: 'BANA 11.8.2a', requires: { key: [{ symbol: 'nf', meaning: 'Number of items' }] },
    sample: { type: 'table', headers: ['A', 'B'], rows: [['1', '2']], key: [{ symbol: 'nf', meaning: 'Number of items' }], keyIntro: 'Key to the abbreviations:' } },

  // ---- lists: list-level and item-level fields with their own save code ----
  { key: 'columns', where: ['list'], type: 'number', default: 1, save: [{ special: 'class-pattern', pattern: 'bana-columns-N' }], carry: ['list'], audience: E,
    ui: [field('number', 'fmtColumns', 'list', 'columns', 'Columns', 'Print columns the list is set in. Leave empty or 1 for a normal list.', { codec: 'int', min: 1, max: 9, storeMin: 2, errKey: L('err_columns'), attrs: { min: '1', max: '9', step: '1', inputmode: 'numeric' } })],
    affectsBraille: true, cache: 'key', finding: 'F-34', sample: { type: 'list', items: [{ text: 'a' }, { text: 'b' }, { text: 'c' }], columns: 2 } },
  { key: 'symbols', where: ['list'], type: 'list', of: 'string', default: null, save: [{ special: 'class-pattern', pattern: 'bana-symbols-*' }], carry: ['list'], audience: E,
    ui: [{ id: 'fmtSym0', group: 'list', control: 'select', codec: 'special', labelKey: L('sym0'), label: 'Bullet for level 1 items', describedBy: 'fmtSymHelp', options: SYM_OPTIONS },
      { id: 'fmtSym1', group: 'list', control: 'select', codec: 'special', labelKey: L('sym1'), label: 'Bullet for level 2 items', describedBy: 'fmtSymHelp', options: SYM_OPTIONS },
      { id: 'fmtSym2', group: 'list', control: 'select', codec: 'special', labelKey: L('sym2'), label: 'Bullet for level 3 items (and deeper)', helpId: 'fmtSymHelp', helpKey: L('sym_help'), help: 'The bullet symbol used at each level of the whole list, in print and in braille. Leave all three on Default to keep the plain dot everywhere in braille.', options: SYM_OPTIONS }],
    affectsBraille: true, cache: 'key', finding: 'G8 stage 2', sample: { type: 'list', items: [{ text: 'a', marker: '•' }, { text: 'b', level: 1, marker: '•' }], symbols: ['•', '□'] } },
  { key: 'bullet', where: ['item'], type: 'enum', values: ['dot', 'hollow square', 'solid square', 'hollow circle', 'triangle', 'checkmark'], default: null,
    save: [{ special: 'item-class', pattern: 'bana-bullet-*' }], carry: ['item'], audience: E,
    ui: [{ id: 'fmtBullet', group: 'list', control: 'select', codec: 'special', target: 'items', labelKey: L('bullet'), label: 'Bullet symbol for the selected item(s)', helpKey: L('bullet_help'), help: 'The symbol printed before the item. Applies to the item with the caret, or every item in the selection.',
      options: [{ value: '', key: L('bullet_default'), text: 'Default' }, { value: 'dot', key: L('bullet_dot'), text: 'Dot' }, { value: 'hollow square', key: L('bullet_hollow_square'), text: 'Hollow square' }, { value: 'solid square', key: L('bullet_solid_square'), text: 'Solid square' },
        { value: 'hollow circle', key: L('bullet_hollow_circle'), text: 'Hollow circle' }, { value: 'triangle', key: L('bullet_triangle'), text: 'Triangle' }, { value: 'checkmark', key: L('bullet_checkmark'), text: 'Checkmark' }] }],
    affectsBraille: true, cache: 'nested', rule: 'BANA 8.6.2a', sample: { item: { type: 'list', items: [{ text: 'one', marker: '1.', bullet: 'triangle' }, { text: 'two', marker: '2.' }] } } },
  { key: 'enum', where: ['item'], type: 'enum', values: ['1', 'a', 'A', 'i', 'I'], default: null, save: [{ special: 'list-attr', attr: 'enum' }], carry: ['item'], audience: E,
    note: 'held on the first item of a sibling group (editor: applyGroupNumbering)',
    ui: [{ id: 'fmtEnum', group: 'list', control: 'select', codec: 'special', target: 'group', labelKey: L('enum'), label: 'Numbering for this level', labelExtraId: 'fmtEnumLevel', helpKey: L('enum_help'), help: "Applies to every item at this level in the same run (the caret's sub-list), in one step. Choosing a number style makes bullets there numbers.",
      options: [{ value: '', key: L('enum_default'), text: 'Default for this level' }, { value: '1', key: L('enum_1'), text: '1, 2, 3' }, { value: 'a', key: L('enum_a'), text: 'a, b, c' }, { value: 'A', key: L('enum_A'), text: 'A, B, C' },
        { value: 'i', key: L('enum_i'), text: 'i, ii, iii' }, { value: 'I', key: L('enum_I'), text: 'I, II, III' }, { value: 'bullet', key: L('enum_bullet'), text: 'Bullets' }] }],
    affectsBraille: true, cache: 'nested', finding: 'G8 stage 3', sample: { item: { type: 'list', ordered: true, items: [{ text: 'one', marker: 'a.', enum: 'a' }, { text: 'two', marker: 'b.' }] } } },
  { key: 'start', where: ['item'], type: 'number', default: 1, save: [{ special: 'list-attr', attr: 'start' }], carry: ['item'], audience: E,
    ui: [field('number', 'fmtStart', 'list', 'start', 'Start at', 'The first number or letter of this run: 3 gives 3, 4, 5 or c, d, e. Leave empty for 1.', { codec: 'special', target: 'group', errKey: L('err_start'), attrs: { min: '1', max: '9999', step: '1', inputmode: 'numeric' } })],
    affectsBraille: true, cache: 'nested', finding: 'G8 stage 3', sample: { item: { type: 'list', ordered: true, items: [{ text: 'one', marker: '3.', start: 3 }, { text: 'two', marker: '4.' }] } } },
  { key: 'example', where: ['item'], type: 'bool', default: false, save: [{ special: 'item-class', class: 'bana-example' }], carry: ['item'], audience: E, ui: [],
    affectsBraille: true, cache: 'nested', rule: 'BANA 10.8', note: 'K31: set explicitly by import/editor when available (always honoured as given); otherwise the formatter derives it itself from a conservative text pattern (document.mjs deriveExerciseLabels) - no editor control either way', sample: { item: { type: 'list', items: [{ text: 'An example.', example: true }, { text: 'two' }] } } },
  { key: 'label', where: ['item'], type: 'string', default: '', save: [{ special: 'item-span', class: 'bana-label' }], carry: ['item'], audience: E, ui: [],
    affectsBraille: true, cache: 'nested', rule: 'BANA 10.8', note: 'labelSegments is the same label with formatting; see example above (K31: derived automatically when not set explicitly)', sample: { item: { type: 'list', items: [{ text: 'Answer.', label: 'Ex.' }, { text: 'two' }] } } },
  { key: 'labelSegments', where: ['item'], type: 'list', of: 'segment', default: null, save: [{ special: 'item-span', class: 'bana-label' }], carry: ['item'], audience: E, ui: [],
    affectsBraille: true, cache: 'nested', rule: 'BANA 10.8', roundTrip: false, note: 'read back as label/labelSegments from the same span' },
  { key: 'lead', where: ['item'], type: 'string', default: '', save: [{ special: 'dt-class', class: 'bana-lead' }], carry: ['item'], audience: T, ui: [],
    affectsBraille: true, cache: 'nested', rule: 'BANA 17.7.3', sample: { item: { type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'big', def: 'large', lead: 'adj.' }] } } },
  { key: 'termSup', where: ['item'], type: 'string', default: '', save: [{ special: 'dt-class', class: 'bana-term-sup' }], carry: ['item'], audience: T, ui: [],
    affectsBraille: true, cache: 'nested', rule: 'BANA 21.6', sample: { item: { type: 'list', kind: 'glossary', style: 'glossary', items: [{ term: 'bank', def: 'river side', termSup: '1' }] } } },

  // ---- tables: fields with their own save code ----
  { key: 'totalRows', where: ['table'], type: 'list', of: 'number', default: null, save: [{ special: 'table-row-class', class: 'bana-total' }], carry: ['table'], audience: E,
    ui: [field('text', 'fmtTotalRows', 'table', 'totalRows', 'Total rows', 'Row numbers, counting from 1, separated by commas, for example 4, 9. A separation line goes above each total row (BANA 11.6.2b). Columnar layout only.', { codec: 'rows1', errKey: L('err_total_rows'), attrs: { inputmode: 'numeric' } })],
    affectsBraille: true, cache: 'key', finding: 'F-17', rule: 'BANA 11.6.2b', sample: { type: 'table', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']], totalRows: [1] } },
  { key: 'rowSubheadings', where: ['table'], type: 'list', of: 'object', default: null, save: [{ special: 'table-row-class', class: 'bana-subheading' }], carry: ['table'], audience: E,
    ui: [field('textarea', 'fmtRowSubheadings', 'table', 'rowSubheadings', 'Row subheadings', 'One per line as "row number: text", for example 3: Vegetables. The subheading is written above that row (BANA 11.5.1b). Columnar layout only.', { codec: 'rowText', errKey: L('err_row_subheadings'), attrs: { rows: '3' } })],
    affectsBraille: true, cache: 'key', finding: 'F-12', rule: 'BANA 11.5.1b', sample: { type: 'table', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']], rowSubheadings: [{ row: 1, text: 'Group' }] } },
  { key: 'subdivisionRows', where: ['table'], type: 'list', of: 'number', default: null, save: [{ special: 'table-row-class', class: 'bana-subdivision' }], carry: [], editorKey: 'TableNode.subdivisionRows', audience: T,
    ui: [field('text', 'fmtSubRows', 'table', 'sub_rows', 'Subdivision rows', 'Body row numbers, counting from 1, separated by commas, for example 3, 6. Leave empty for none.', { codec: 'special', errKey: L('err_rows'), attrs: { inputmode: 'numeric' } })],
    affectsBraille: true, cache: 'key', rule: 'BANA 11.18.1j', sample: { type: 'table', format: 'stairstep', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']], subdivisionRows: [1], subdivisionHeading: 'Part' } },
  { key: 'subdivisionHeading', where: ['table'], type: 'string', default: '', save: [{ special: 'table-title' }], carry: [], editorKey: 'TableNode.subdivisionHeading', audience: T,
    ui: [field('text', 'fmtSubHeading', 'table', 'sub_heading', 'Subdivision heading', null, { codec: 'special' })],
    affectsBraille: true, cache: 'key', rule: 'BANA 11.18.1j', roundTrip: false, note: 'written only with subdivisionRows (see its sample)' },
  { key: 'dittoMarks', where: ['table'], type: 'bool', default: false, save: [{ class: 'bana-ditto-marks' }], carry: ['table'], audience: T,
    ui: [check('fmtDittoMarks', 'table', 'dittoMarks', 'Ditto marks for repeated cells', 'A cell holding only a ditto or quote mark is written as the plain repeat symbol instead of being translated (BANA 11.6.6).')],
    affectsBraille: true, cache: 'key', finding: 'F-16', rule: 'BANA 11.6.6',
    sample: { type: 'table', headers: ['A', 'B'], rows: [['1', 'x'], ['2', '"']], dittoMarks: true } },
  // TBL-NUM-1 (Paul, 28 Sep 2026; KD round-2 Q4): BANA §11.7.1j-l / UEB §6.9 — a table
  // whose row headings and column entries are all numbers may use the numeric passage
  // indicator instead of a numeral sign before every number, off by default. Ignored (with
  // a table-fallback warning) when the table is not all-numeric, or combines a two-tier
  // header/secondary row heading/subdivision heading with the option — see document.mjs's
  // numericPassageEligible for the full eligibility rule and Example 11-9's own gold note.
  { key: 'numericPassage', where: ['table'], type: 'bool', default: false, save: [{ class: 'bana-numeric-passage' }], carry: ['table'], audience: T,
    ui: [check('fmtNumericPassage', 'table', 'numericPassage', 'Numeric passage indicator', 'For a table whose row headings and column entries are all numbers: uses the numeric passage indicator instead of a numeral sign before every number, with a one-cell gap between columns where needed to keep the table on one page (BANA 11.7.1j-l). Columnar layout; ignored (with a warning) if the table is not all-numeric.')],
    affectsBraille: true, cache: 'key', rule: 'BANA 11.7.1j-l',
    sample: { type: 'table', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']], numericPassage: true } },
  // K35 (BANA 11.6.1c/d, transcriber KD): the transcriber's own per-column place-value
  // override, block.columnAlign[c] ('left' | 'right' | 'decimal' | undefined) — see
  // document.mjs's numericAlignApplies, which it always wins over printAlign either way.
  // Saved on the same DTBook <col> print's own alignment already round-trips through
  // (nimas-export.mjs/parse.mjs), as a class token identified by the <col>'s position, not a
  // fmt key: TableNode carries it as its own field (K3, editor.mjs), same as guideDots/
  // subdivisionRows above.
  { key: 'columnAlign', where: ['table'], type: 'list', of: 'string', default: null,
    save: [{ special: 'table-col-class', tokens: ['bana-col-align-left', 'bana-col-align-right', 'bana-col-align-decimal'] }], carry: [], editorKey: 'TableNode.columnAlign', audience: T,
    ui: [field('textarea', 'fmtColumnAlign', 'table', 'column_align', 'Column alignment override',
      'One line per column that should not simply follow print’s own alignment, as "2: right" (column numbers count from 1). Right and decimal both place-value-align the column, worked out from its own entries (BANA 11.6.1c/d); left keeps it flush left even where print aligned it. Leave a column out to follow print.',
      { codec: 'special', errKey: L('err_column_align'), attrs: { rows: '3' } })],
    affectsBraille: true, cache: 'key', finding: 'K35', rule: 'BANA 11.6.1c/d',
    sample: { type: 'table', headers: ['A', 'B', 'C'], rows: [['1', '2', '3']], columnAlign: ['left', 'right', 'decimal'] } },

  // ---- other block fields with their own save code ----
  { key: 'blocked', where: ['para'], type: 'bool', default: false, save: [{ special: 'p-class', class: 'blocked' }], carry: [], editorKey: 'ParagraphNode.__blocked', audience: E,
    ui: [], toolbar: 'btnBlockedPara', affectsBraille: true, cache: 'key', finding: 'F-39', rule: 'BANA 1.9.3', sample: { type: 'para', text: 'A blocked paragraph.', blocked: true } },
  { key: 'continued', where: ['para'], type: 'bool', default: false, save: [{ special: 'page-turn', note: 'this <p> and the next run on over an inline <pagenum>' }], carry: [],
    editorKey: "ParagraphNode.__pageTurn ('continued' | 'both')", audience: E, ui: [], affectsBraille: true, cache: 'key', rule: 'BANA 1.11.3', roundTrip: false,
    note: 'a paragraph that runs on over a print page change (page-turn node); its round trip is in nimas_inline_pagenum.test.mjs' },
  { key: 'continuation', where: ['para'], type: 'bool', default: false, save: [{ special: 'page-turn', note: 'the part after the inline <pagenum>' }], carry: [],
    editorKey: "ParagraphNode.__pageTurn ('continuation' | 'both')", audience: E, ui: [], affectsBraille: true, cache: 'key', rule: 'BANA 1.11.3', roundTrip: false,
    note: 'the paragraph that resumes after a print page change (formatted from cell 1); round trip in nimas_inline_pagenum.test.mjs' },
  { key: 'xref', where: ['note'], type: 'bool', default: false, modelForm: 'block type xref', save: [{ special: 'block-type', class: 'bana-xref', becomes: 'xref' }], carry: [], editorKey: 'fmt.xref (paragraph)', audience: T,
    note: 'editor-only key: a note paragraph with fmt.xref is a block of type xref in the model (editor paraBlock / blocksToNodes)',
    ui: [check('fmtXref', 'note', 'xref', 'Cross-reference note', 'Formats this as a cross-reference to another place in the book.')],
    affectsBraille: true, cache: 'key', finding: 'F-104', roundTrip: false },
  { key: 'xrefHeading', where: ['xref'], modelKey: 'heading', type: 'string', default: '', save: [{ special: 'block-title', class: 'bana-xref' }], carry: [], editorKey: 'fmt.xrefHeading (paragraph)', audience: T,
    ui: [field('text', 'fmtXrefHeading', 'note', 'xref_heading', 'Cross-reference heading', null, { requires: 'fmtXref' })],
    affectsBraille: true, cache: 'key', finding: 'F-104', sample: { type: 'xref', text: 'See page 4.', heading: 'See also' } },
  { key: 'figureType', where: ['graphic'], type: 'string', default: '', save: [{ class: 'bana-figure-type', title: 10 }], carry: [], editorKey: 'ImageNode.__image.figureType', audience: E, ui: [],
    affectsBraille: true, cache: 'key', finding: 'F-231', rule: 'BANA 6.2.2b', note: 'set from the editor picture-type control on the image card (no Braille formatting dialog control)',
    sample: { type: 'graphic', src: 'a.png', alt: 'A map', figureType: 'Map' } },
  { key: 'identifier', where: ['caption'], type: 'bool|string', default: null,
    save: [{ class: 'bana-identifier' }, { class: 'bana-identifier-text', title: 11, enc: encString }], carry: ['para'], audience: T,
    ui: [check('fmtIdentifier', 'caption', 'identifier', 'Insert an identifier before the caption', "When the table or image has no title or heading of its own, adds a word (Table, Figure, Chart …) before the caption, enclosed in transcriber's note indicators (BANA 11.2.8b).", { codec: 'guideDotNote', part: 'on' }),
      field('text', 'fmtIdentifierText', 'caption', 'identifierText', 'Own wording for the identifier', 'Leave empty for the standard word (Illustration).', { codec: 'guideDotNote', part: 'text' })],
    affectsBraille: true, cache: 'key', finding: 'F-4', rule: 'BANA 11.2.8b',
    samples: [{ type: 'caption', text: 'A table', identifier: true }, { type: 'caption', text: 'A table', identifier: 'Table' }] },

  // ---- inline runs (segments) ----
  { key: 'uncontracted', where: ['segment'], type: 'bool', default: false, save: [{ special: 'segment-code', class: 'uncontracted' }, { special: 'imgnote-class', class: 'bana-uncontracted' }], carry: [], audience: E, ui: [],
    affectsBraille: true, cache: 'nested', rule: 'BANA 17.11.2b', note: 'a run property; the editor keeps it on the text run',
    samples: [{ segment: { type: 'para', text: 'a xyz b', segments: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'xyz', uncontracted: true }, { type: 'text', text: ' b' }] } },
      { segment: { type: 'para', text: 'See A note', segments: [{ type: 'text', text: 'See ' }, { type: 'imgnote', text: 'A note', prodnote: true, render: 'optional', uncontracted: true }] } }] },
  { key: 'spanTypeform', where: ['segment'], type: 'bool', default: false, save: [{ special: 'imgnote-class', class: 'bana-span-typeform' }], carry: [], audience: T, ui: [],
    affectsBraille: true, cache: 'nested', rule: 'BANA 18.3.3c', sample: { segment: { type: 'para', text: 'See A note', segments: [{ type: 'text', text: 'See ' }, { type: 'imgnote', text: 'A note', prodnote: true, render: 'optional', spanTypeform: true }] } } },
  { key: 'brl', where: ['segment'], type: 'string', default: '', save: [{ special: 'segment-span', class: 'bana-brl' }], carry: [], editorKey: 'BrlNode', audience: T, ui: [],
    affectsBraille: true, cache: 'nested', note: 'a literal-cells run (type brl): the editor keeps it as a BrlNode',
    sample: { segment: { type: 'para', text: 'Mark • here', segments: [{ type: 'text', text: 'Mark ' }, { type: 'brl', brl: '_4', text: '•' }, { type: 'text', text: ' here' }] } } },
  { key: 'hyperlink', where: ['segment'], type: 'bool', default: false, save: [{ special: 'segment-span', class: 'bana-hyperlink' }], carry: [], audience: T, ui: [],
    textRun: 'HYPERLINK_STYLE', affectsBraille: true, cache: 'nested', finding: 'F-233', rule: 'BANA 6.12.3b', note: 'a run property (like ignoreFont); no editor control to set it manually yet',
    sample: { segment: { type: 'para', text: 'a x b', segments: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'x', hyperlink: true }, { type: 'text', text: ' b' }] } } },

  // ---- document options (model top level; read by document.mjs as doc.<name> / o.<name>) ----
  // Order = the <meta> order in <head>.
  // UK-7 (28 Sep, James / decisions.md "UKAAF"): James answered Q-17 — the print page number is shown on
  // EVERY page, whenever print pages are shown at all — so this is now on by DEFAULT in UKAAF (document.mjs's
  // buildDocPages/buildDocPagesAsync default it true whenever the mode isn't BANA, unless explicitly turned
  // off here or on the loaded doc); no longer provisional. BANA never reads this flag.
  { key: 'pilPrintPage', where: ['doc'], type: 'bool', default: true, save: [{ meta: 'bana-pil-print-page', off: true }], audience: T,
    ui: [docCheck('docPilPrintPage', 'pilPrintPage', 'Print page number on the page-information line', 'UKAAF: the print page number sits at cell 1 of the page information line, on every page (B004 7; James, UK-7). On by default; irrelevant in BANA.', 'docOff')],
    affectsBraille: true, cache: 'doc', rule: 'UKAAF B004 7; UK-7', sample: { doc: { pilPrintPage: false } } },
  { key: 'spacedEllipsis', where: ['doc'], type: 'bool', default: false, save: [{ meta: 'bana-spaced-ellipsis' }], audience: T,
    ui: [docCheck('docSpacedEllipsis', 'spacedEllipsis', 'Spaced ellipsis', 'Print typed as spaced periods (". . .") is written as the ellipsis symbol (UEB 7.3.1, Sample 15-4).')],
    affectsBraille: true, cache: 'doc', rule: 'UEB 7.3.1', sample: { doc: { spacedEllipsis: true } } },
  { key: 'elisionApostrophe', where: ['doc'], type: 'bool', default: false, save: [{ meta: 'bana-elision-apostrophe' }], audience: T,
    ui: [docCheck('docElisionApostrophe', 'elisionApostrophe', 'Elision apostrophe', "A closing quote mark after a letter, as in comin', is written as an apostrophe (Sample 13-14).")],
    affectsBraille: true, cache: 'doc', rule: 'Sample 13-14', sample: { doc: { elisionApostrophe: true } } },
  { key: 'typeformWordPunct', where: ['doc'], type: 'bool', default: false, save: [{ meta: 'bana-typeform-word-punct' }], audience: T,
    ui: [docCheck('docTypeformWordPunct', 'typeformWordPunct', 'Typeform word indicator covers punctuation', 'An emphasised word followed directly by punctuation needs no terminator (UEB 9.3.1 and 9.3.2, BANA Example 1-18).')],
    affectsBraille: true, cache: 'doc', rule: 'UEB 9.3.1', sample: { doc: { typeformWordPunct: true } } },
  { key: 'verseKeep', where: ['doc'], type: 'bool', default: true, save: [{ meta: 'bana-verse-keep', off: true }], audience: T,
    ui: [docCheck('docVerseKeep', 'verseKeep', 'Keep verse lines and stanzas together', 'On (the default in BANA): a verse line is never split across braille pages, and a stanza whose first line would end the page moves whole to the next (BANA 13.3.1b and 13.4.2).', 'docOff')],
    affectsBraille: true, cache: 'doc', finding: 'F-126', rule: 'BANA 13.3.1b', sample: { doc: { verseKeep: false } } },
  { key: 'listPageRules', where: ['doc'], type: 'bool', default: true, save: [{ meta: 'bana-list-page-rules', off: true }], audience: T,
    ui: [docCheck('docListPageRules', 'listPageRules', 'List page rules', 'On (the default in BANA): a list never starts on the last line of a page, and a multi-line first item never starts on the next-to-last (BANA 8.3.5b-c).', 'docOff')],
    affectsBraille: true, cache: 'doc', finding: 'F-35', rule: 'BANA 8.3.5b-c', sample: { doc: { listPageRules: false } } },
  { key: 'interpointOmitEven', where: ['doc'], type: 'bool', default: false, save: [{ meta: 'bana-interpoint-omit-even' }], audience: T,
    ui: [docCheck('docInterpointOmitEven', 'interpointOmitEven', 'Omit even braille page numbers', 'BANA only: for interpoint braille, every even braille page loses its page number (BANA 1.15.1f).')],
    affectsBraille: true, cache: 'doc', finding: 'F-64', rule: 'BANA 1.15.1f', sample: { doc: { interpointOmitEven: true } } },
  { key: 'endOfVolume', where: ['doc'], type: 'bool', default: false, save: [{ meta: 'bana-end-of-volume' }], audience: T,
    ui: [docCheck('docEndOfVolume', 'endOfVolume', 'End-of-volume statement', 'BANA, with volumes: "End of Volume n" on each volume\'s last page and "The End" after the last (BANA 1.6.5).')],
    affectsBraille: true, cache: 'doc', finding: 'F-54', rule: 'BANA 1.6.5', sample: { doc: { endOfVolume: true } } },
  { key: 'tocRightBuffer', where: ['doc'], type: 'bool', default: false, save: [{ meta: 'bana-toc-right-buffer' }], audience: T,
    ui: [docCheck('docTocRightBuffer', 'tocRightBuffer', 'Contents right buffer', 'BANA: keeps the generated contents heading and every entry with no page number away from the right margin (BANA 2.10.7b).')],
    affectsBraille: true, cache: 'doc', finding: 'F-150', rule: 'BANA 2.10.7b', sample: { doc: { tocRightBuffer: true } } },
  { key: 'nestedBullets', where: ['doc'], type: 'bool', default: false, save: [{ meta: 'bana-nested-bullets' }], audience: T,
    ui: [docCheck('docNestedBullets', 'nestedBullets', 'Different bullets at each list level', 'Uses a dot, a ring, then a small square for list levels 1, 2 and 3 (BANA 8.6.2 bullets).')],
    affectsBraille: true, cache: 'doc', rule: 'BANA 8.6.2', sample: { doc: { nestedBullets: true } } },
  // UK-1: the document-wide switch for the chapter-end marker — see endMarkerBefore's comment above for why
  // it defaults off. On turns it on before every level-1 UKAAF heading after the first (the pre-UK-1
  // behaviour); a single heading's own endMarkerBefore field still works independently of this document
  // option. UKAAF only. UK-6 (28 Sep, James): the marker is now the COLONS form (B004/RNIB: closes a chapter
  // or the whole book), not dot-2s.
  { key: 'endMarkers', where: ['doc'], type: 'bool', default: false, save: [{ meta: 'bana-end-markers' }], audience: T,
    ui: [docCheck('docEndMarkers', 'endMarkers', 'End markers before every section heading', 'UKAAF only: a colons indicator line before every level-1 heading after the first, closing the section before it (B004 Glossary; James, UK-6). Off by default (UK-1) — turn on here for the whole document, or on one heading with its own "End marker before this heading" option.')],
    affectsBraille: true, cache: 'doc', rule: 'B004 Glossary (indicator line / end marker); UK-1/UK-6', sample: { doc: { endMarkers: true } } },
  // UK-6 (28 Sep, James / decisions.md "UKAAF"): the dot-2s marker "before resuming normal text" after each
  // table — on by DEFAULT in UKAAF (withTableCitation/withTableCitationTrace, document.mjs). No BANA equivalent.
  { key: 'tableEndMarker', where: ['doc'], type: 'bool', default: true, save: [{ meta: 'bana-table-end-marker', off: true }], audience: T,
    ui: [docCheck('docTableEndMarker', 'tableEndMarker', 'End marker after every table', 'UKAAF only: a dot-2s indicator line after each table (and its citation, if any) before text resumes (B004 Glossary; James, UK-6). On by default.', 'docOff')],
    affectsBraille: true, cache: 'doc', rule: 'B004 Glossary (indicator line / end marker); UK-6', sample: { doc: { tableEndMarker: false } } },
  // UK-6 (28 Sep, James): a colons marker as the very last line of the document (the last volume only, in a
  // multi-volume book) — on by DEFAULT in UKAAF (buildDocPages/buildDocPagesAsync, document.mjs).
  { key: 'docEndMarker', where: ['doc'], type: 'bool', default: true, save: [{ meta: 'bana-doc-end-marker', off: true }], audience: T,
    ui: [docCheck('docDocEndMarker', 'docEndMarker', 'End marker at the end of the document', 'UKAAF only: a colons indicator line as the last line of the document — the last volume only, in a multi-volume book (B004 Glossary; James, UK-6). On by default.', 'docOff')],
    affectsBraille: true, cache: 'doc', rule: 'B004 Glossary (indicator line / end marker); UK-6', sample: { doc: { docEndMarker: false } } },
  // UK-10 (28 Sep, James / decisions.md "UKAAF"): "UKAAF transcribers may leave bullets out and show the list
  // by layout" — on by default (bullets shown, today's behaviour); off drops an UNORDERED bullet cell entirely
  // (numbered/lettered markers are unaffected). Both modes — see the traceBlock 'list' case, document.mjs.
  { key: 'showBullets', where: ['doc'], type: 'bool', default: true, save: [{ meta: 'bana-show-bullets', off: true }], audience: T,
    ui: [docCheck('docShowBullets', 'showBullets', 'Show bullets', 'Off leaves unordered-list bullets out, showing the list by its layout instead (UKAAF convention; James, UK-10). Numbered and lettered items are unaffected. On by default.', 'docOff')],
    affectsBraille: true, cache: 'doc', rule: 'UK-10', sample: { doc: { showBullets: false } } },
  { key: 'tocHeading', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-toc-heading', text: true }], audience: T,
    ui: [docText('docTocHeading', 'tocHeading', 'Contents page heading', 'Your own wording for the generated contents page heading. Empty gives "Contents" (finding F-149).')],
    affectsBraille: true, cache: 'doc', finding: 'F-149', rule: 'BANA 2.10.3a', sample: { doc: { tocHeading: 'What You Will Study' } } },
  { key: 'lineIndicator', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-line-indicator', text: true }], audience: T, provisional: true,
    ui: [docText('docLineIndicator', 'lineIndicator', 'Line indicator (braille ASCII)', 'UKAAF poem line indicator, in braille ASCII. Empty gives the default underscore. Provisional: the dots (456 or 456-34) are a transcriber question (B004 Appendix J).',
      { attrs: { maxlength: '3' }, pattern: '^[!-~]{1,3}$', errKey: L('doc_err_line_indicator'), statusId: 'docLineIndicatorStatus' })],
    affectsBraille: true, cache: 'doc', finding: 'F-128', rule: 'UKAAF B004 Appendix J', sample: { doc: { lineIndicator: '_' } } },
  { key: 'runningHeadKeyWords', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-running-head-key-words', text: true }], audience: T,
    ui: [docText('docRunningHeadKeyWords', 'runningHeadKeyWords', 'Running head key words', 'Your own key words for the running head, tried when the title does not fit (BANA 1.8.2e). You choose the words.')],
    affectsBraille: true, cache: 'doc', finding: 'F-61', rule: 'BANA 1.8.2e', sample: { doc: { runningHeadKeyWords: 'Birds' } } },
  // K13: some agencies want every symbol explained, not only the ones BANA Appendix G requires. On, the Special
  // Symbols page also lists the ordinary UEB indicators/punctuation the document uses that Appendix G does not
  // require (grade 1, numeric and capitals indicators, the standard typeform indicators, modified-letter
  // indicators, and punctuation with a multi-cell braille form) — collectSpecialSymbols/document.mjs.
  { key: 'exhaustiveSymbols', where: ['doc'], type: 'bool', default: false, save: [{ meta: 'bana-exhaustive-symbols' }], audience: T,
    ui: [docCheck('docExhaustiveSymbols', 'exhaustiveSymbols', 'List every braille symbol used',
      'On: the Special Symbols page also lists the ordinary UEB symbols the document uses that BANA does not require listing — for example typeform, capitals and grade 1 indicators, the numeric indicator, the letter sign, accented-letter modifiers, and punctuation with a multi-cell braille form (BANA Appendix G).')],
    affectsBraille: true, cache: 'doc', rule: 'BANA Appendix G', sample: { doc: { exhaustiveSymbols: true } } },
  // K16: BANA Formats 1.16.3 (June 2024 changes) — in foreign-language instructional texts and foreign literature, the
  // foreign material (text marked with a language, `seg.lang`) is uncontracted, with the foreign alphabet signs of BANA
  // Appendix D for accented letters and UEB punctuation; 8.10 / 10.1.6c: no grade 1 indicator on the identifying
  // letters when every itemized list is foreign. Off: incidental foreign words are contracted with UEB modifiers (1.16.2).
  { key: 'foreignText', where: ['doc'], type: 'bool', default: false, save: [{ meta: 'bana-foreign-text' }], audience: T,
    ui: [docCheck('docForeignText', 'foreignText', 'Foreign-language teaching text (BANA 1.16.3)',
      'On: text marked as another language is brailled uncontracted, with the foreign alphabet signs for accented letters (French, German, Italian and Spanish from BANA Appendix D; Portuguese from World Braille Usage; other languages keep UEB accent signs) and UEB punctuation. Foreign words in a glossary are brailled this way even when this is off (BANA 21.6.3). If every numbered or lettered list is in the foreign language, the item letters have no grade 1 indicator (BANA 8.10). Off: foreign words are contracted, with UEB accent signs (BANA 1.16.2).')],
    affectsBraille: true, cache: 'doc', rule: 'BANA 1.16.3', sample: { doc: { foreignText: true } } },
  // K16: BANA 1.16.4 — "A running head which begins on page t2 is considered foreign ... The full title which appears
  // on page 1 of the body would be considered foreign." Only with foreignText; the language is the document's own
  // commonest foreign language.
  { key: 'foreignTitle', where: ['doc'], type: 'bool', default: false, save: [{ meta: 'bana-foreign-title' }], audience: T,
    ui: [docCheck('docForeignTitle', 'foreignTitle', 'The book title is in the foreign language (BANA 1.16.4)',
      'With "Foreign-language teaching text" on: the running head and the title on the first braille page are brailled as foreign material. The title page stays English.')],
    affectsBraille: true, cache: 'doc', rule: 'BANA 1.16.4', sample: { doc: { foreignText: true, foreignTitle: true } } },
  // K12 / BANA 21.3.2: "Add braille page guide words to all alphabetic references except bibliographies. An agency may
  // choose to omit the guide words in certain alphabetic references, such as indexes." Both default on (the rule says
  // "add"); written to the file only when turned off. Page-level (applyGuideWords, document.mjs), never formatBlock.
  { key: 'guideWords', where: ['doc'], type: 'bool', default: true, save: [{ meta: 'bana-guide-words', off: true }], audience: T,
    ui: [docCheck('docGuideWords', 'guideWords', 'Guide words in glossaries and indexes',
      'On (the default in BANA): the last line of each braille page of a glossary, index, dictionary or other alphabetic reference longer than one page shows its first and last main entry words, joined by a dash, beside the braille page number (BANA 21.3.2). UKAAF has no guide words.', 'docOff')],
    affectsBraille: true, cache: 'doc', finding: 'F-192', rule: 'BANA 21.3.2', sample: { doc: { guideWords: false } } },
  { key: 'indexGuideWords', where: ['doc'], type: 'bool', default: true, save: [{ meta: 'bana-index-guide-words', off: true }], audience: T,
    ui: [docCheck('docIndexGuideWords', 'indexGuideWords', 'Guide words in indexes',
      'On (the default): indexes get guide words too. Turn off to omit them from indexes only, which BANA 21.3.2 allows an agency to do.', 'docOff')],
    affectsBraille: true, cache: 'doc', finding: 'F-192', rule: 'BANA 21.3.2', sample: { doc: { indexGuideWords: false } } },

  // ---- K29 Stage 1a (26 Sep 2026, design doc transcriber-pages-customisation-design.md §3.1/§4, decisions TP-5..TP-10) ----
  // Document-level "Book details" for the Title Page. Stage 1a builds ONLY the registry entries, the bana-tp-* save
  // form, and the editor's "Book details…" dialog (design §4) — NOT the titlepage block or its formatter (stage 1b),
  // so none of these fields affect braille output yet (affectsBraille: false; no cache-key test runs for them).
  // `title`, `authors`, `publisher` are NOT new fields here: the design (§3.1) has them read from the document's own
  // existing `doc.title` / `metadata.docauthors` / `metadata.publisher` (dc:Title/dc:Creator/dc:Publisher), which the
  // dialog edits directly. The per-volume fields (volume, totalVolumes, volumesWord, volumeLabel, customBraille,
  // braillePages, printPages) are computed by the Stage 1b formatter after pagination and are not stored here either.
  // `ui: []`: this is a bespoke dialog (design §4), not the generic "Braille formatting" dialog GROUPS drive, so
  // there is no dialog control for field_registry.test.mjs to find in R.ALL_CONTROLS — the Book details dialog
  // markup in index.html is hand-built and reads/writes these fields through loadedDocInfo.options, the same store
  // the generic doc-options group already uses (editor.mjs).
  { key: 'tpSeries', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-series', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.4a', sample: { doc: { tpSeries: 'Prentice Hall Literature' } } },
  { key: 'tpGradeLevel', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-grade-level', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.4a/g', sample: { doc: { tpGradeLevel: 'Grade 9' } } },
  { key: 'tpSubtitle', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-subtitle', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.4a', sample: { doc: { tpSubtitle: 'The British Tradition' } } },
  { key: 'tpEdition', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-edition', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.4a', sample: { doc: { tpEdition: '2010 Edition' } } },
  { key: 'tpTranslator', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-translator', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.5g', sample: { doc: { tpTranslator: 'Jane Translator' } } },
  { key: 'tpEditors', where: ['doc'], type: 'list', of: 'string', default: null, save: [{ meta: 'bana-tp-editors', enc: encStrings, dec: decStrings }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.5f', sample: { doc: { tpEditors: ['Ann Editor', 'Bob Editor'] } } },
  { key: 'tpPublishedBy', where: ['doc'], type: 'enum', values: ['published', 'permission'], default: null, save: [{ meta: 'bana-tp-published-by', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.6a', sample: { doc: { tpPublishedBy: 'published' } } },
  { key: 'tpPublisherCity', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-publisher-city', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.6b', sample: { doc: { tpPublisherCity: 'Boston, Massachusetts' } } },
  { key: 'tpPublisherUrl', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-publisher-url', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.6c', sample: { doc: { tpPublisherUrl: 'https://example.com' } } },
  { key: 'tpCopyright', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-copyright', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.6d', sample: { doc: { tpCopyright: 'Copyright © 2010 by Pearson' } } },
  // The reproduction-notice country. Not itself a title-page line: it selects which default wording
  // titlepageBookDetails() offers for tpReproductionNotice (US: the 2020 addendum wording, confirmed against the
  // errata BRF, bana-2024-changes-review.md D2; UK: the draft accessible-copy statement, TP-8/P4, UNVERIFIED — see
  // docs/ukaaf-title-page-draft.md). A full agency-profile "reproduction-notice country" setting is Stage 3 (design
  // §3.2); this per-book field is what Stage 1a and the UKAAF default (Stage 5) need in the meantime.
  { key: 'tpCountry', where: ['doc'], type: 'enum', values: ['US', 'UK', 'Canada'], default: null, save: [{ meta: 'bana-tp-country', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'addendum 2.3.6e / B004 §4 / CDPA 1988 s31A-31F', sample: { doc: { tpCountry: 'US' } } },
  // TP-7 / P3 (26 Sep, against advice): editable, with a warning that the wording is set by law (US) — never locked.
  { key: 'tpReproductionNotice', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-reproduction-notice', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: '2020 Addendum 2.3.6e', sample: { doc: { tpReproductionNotice: 'Any further reproduction or distribution other than in an accessible format is an infringement.' } } },
  { key: 'tpIsbn', where: ['doc'], type: 'list', of: 'string', default: null, save: [{ meta: 'bana-tp-isbn', enc: encStrings, dec: decStrings }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.6f', sample: { doc: { tpIsbn: ['978-0-13-123456-7', '978-0-13-123457-4'] } } },
  { key: 'tpPrintingHistory', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-printing-history', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.6g', sample: { doc: { tpPrintingHistory: 'First printing 2010' } } },
  { key: 'tpYear', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-year', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.7', sample: { doc: { tpYear: '2026' } } },
  // Braille code (e.g. "Unified English Braille") is computed from the document's own existing braille-code
  // setting, not stored again here — no bana-tp-* meta of its own, shown read-only in the dialog ("from the
  // document", design §4). Kept in the registry (with a note, no save) so it is documented once, like other
  // computed-only fields (`lnMargin`, `dotLocator`: "set by import only; no editor control").
  { key: 'tpBrailleCode', where: ['doc'], type: 'string', default: '', save: [], audience: T, roundTrip: false,
    note: "computed from the document's own braille code (currently always Unified English Braille); not stored separately, shown read-only in the Book details dialog",
    ui: [], affectsBraille: false, cache: 'doc', rule: 'design §3.1' },
  // Stored per book once the page is created (23 Sep decision, carried into design §3.1): these start as an agency
  // profile's defaults in Stage 3, but Stage 1a has no profile system yet, so they are typed directly.
  { key: 'tpTranscriber', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-transcriber', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.7', sample: { doc: { tpTranscriber: 'Pat Transcriber' } } },
  { key: 'tpProofreader', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-proofreader', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.7', sample: { doc: { tpProofreader: 'Sam Proofreader' } } },
  { key: 'tpTactileSpecialist', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-tactile-specialist', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.7', sample: { doc: { tpTactileSpecialist: 'Robin Tactile' } } },
  { key: 'tpAgency', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-agency', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.7', sample: { doc: { tpAgency: 'Example Braille Agency' } } },
  { key: 'tpAgencyLocation', where: ['doc'], type: 'string', default: '', save: [{ meta: 'bana-tp-agency-location', text: true }], audience: T,
    ui: [], affectsBraille: false, cache: 'doc', rule: 'BANA 2.3.7', sample: { doc: { tpAgencyLocation: 'Boston, Massachusetts' } } },
];

// ---- K29 Stage 1a: Book details pre-fill helper ("values computed from the document", design §4) ----
// Pure (no imports) so the editor's "Book details…" dialog and a Node test can compute the same pre-fills.
// Each segment returns { value, computed }: computed true means the value shown comes from elsewhere in the
// document (the existing dc:* metadata, or a default wording for the reproduction notice), not a bana-tp-* field
// the transcriber has actually set — matching "computed values marked 'from the document'" (design §4).
const ISBN_RE = /^(97[89][- ]?)?(\d[- ]?){9}[\dXx]$/;
/** A dc:Source value that looks like an ISBN (loose: BANA/ISBN check digit is not verified here). */
export const looksLikeIsbn = (s) => typeof s === 'string' && ISBN_RE.test(String(s).replace(/\s+/g, ' ').trim());
const EMBOSS_PUBLISHER_FALLBACK = 'Emboss Braille Editor';   // nimas-export.mjs buildHeadMetadata's own dc:Publisher default
export function titlepageBookDetails(model) {
  const m = model && typeof model === 'object' ? model : {};
  const meta = (m.metadata && typeof m.metadata === 'object') ? m.metadata : {};
  const publisher = m.publisher !== undefined ? m.publisher : meta.publisher;
  const authors = Array.isArray(meta.docauthors) && meta.docauthors.length ? meta.docauthors : (meta.docauthor ? [meta.docauthor] : []);
  const isbnSet = Array.isArray(m.tpIsbn) && m.tpIsbn.length;
  const source = meta.source;
  const copyrightSet = typeof m.tpCopyright === 'string' && m.tpCopyright.trim();
  return {
    title: { value: m.title || '', computed: false },
    authors: { value: authors, computed: false },
    publisher: { value: (publisher && publisher !== EMBOSS_PUBLISHER_FALLBACK) ? publisher : '', computed: false },
    copyright: copyrightSet ? { value: m.tpCopyright, computed: false } : (meta.rights ? { value: meta.rights, computed: true } : { value: '', computed: false }),
    isbn: isbnSet ? { value: m.tpIsbn, computed: false } : (looksLikeIsbn(source) ? { value: [String(source).trim()], computed: true } : { value: [], computed: false }),
    brailleCode: { value: 'Unified English Braille', computed: true },
  };
}

// TP-7 / P3: the US reproduction notice is editable, with a warning that the wording is set by law (not locked).
// Confirmed against the 2020 addendum BRF (bana-2024-changes-review.md D2). Canada's statement is a second-title-
// page matter (2.3.6e(2)), out of Stage 1a's scope (no second title page yet). UK: see ukAccessibleCopyStatement
// below and docs/ukaaf-title-page-draft.md — UNVERIFIED, to be confirmed by a UK producer.
export const REPRODUCTION_NOTICES = {
  US: 'Any further reproduction or distribution other than in an accessible format is an infringement.',
};
/**
 * TP-8 / P4 (26 Sep 2026): a DRAFT UK accessible-copy notice under CDPA 1988 s31B (as amended 2014 and 2018), for the
 * reproduction-notice line of a UKAAF title page. UNVERIFIED — see docs/ukaaf-title-page-draft.md. The wording
 * itself carries no "draft"/"unverified" marking (it is meant to be brailled as a real legal statement); the
 * Book details dialog shows the draft warning as a separate note beside the field, not inside the text.
 * @param {{title?:string, authors?:string[]}} book
 */
export function ukAccessibleCopyStatement(book) {
  const b = book && typeof book === 'object' ? book : {};
  const title = (b.title || '').trim();
  const authors = Array.isArray(b.authors) ? b.authors.filter(Boolean) : [];
  const work = [title, authors.length ? `by ${authors.join(', ')}` : ''].filter(Boolean).join(' ');
  const identify = work ? ` of ${work}` : '';
  // Follows s31B(1)'s own words ("for the personal use of disabled persons"); the notice is one of the "steps to
  // discourage unauthorised reproduction or distribution" s31B(1A) requires of an authorised body (checked 26 Sep 2026).
  return `This accessible copy${identify} has been made under section 31B of the Copyright, Designs and Patents Act 1988 for the personal use of disabled persons. It must not be copied, distributed or sold except as that Act allows.`;
}

// ---- UK-9 (28 Sep 2026, James via Paul): numbers in words, for the UKAAF title page's volume notice ----
// "In three volumes" / "Volume one" — B004/James give no digit form for this line, only words (unlike
// BANA's Arabic "In 3 Volumes", TP-11). Small and self-contained on purpose (design §3.1's "each rule
// simple enough to explain in one line of help text"): 0-99 covers every volume count Emboss has real
// evidence for; beyond that this falls back to the plain digit string rather than guessing at hundreds/
// compound wording no test or sample exercises.
const TP_NUM_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TP_NUM_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
/** @param {number} n -> 'one', 'twenty-one', ... (0-99); outside that range, the plain digit string. */
export function tpNumberWords(n) {
  const v = Math.trunc(Number(n));
  if (!Number.isFinite(v) || v < 0 || v > 99) return String(n);
  if (v < 20) return TP_NUM_ONES[v];
  const tens = TP_NUM_TENS[Math.floor(v / 10)];
  const ones = v % 10;
  return ones ? `${tens}-${TP_NUM_ONES[ones]}` : tens;
}

// ---- K29 Stage 1c rework (Fable review): the Title Page's ONE shared template ----
// This is now the SINGLE source of truth for the Title Page's WORDING — which lines exist, in what
// order, with what fixed text and which field goes where (BANA 2.3.4a/2.3.5/2.3.6/2.3.7/2.3.8). Both
// the editor card (chips) and format/document.mjs's traceTitlePage (braille) consume this SAME
// function; document.mjs no longer has its own copy of these rules (tpAuthorSegLines/
// tpPublisherSegLines/tpTranscriberSegLines/tpVolumeSegLines are gone — see traceTitlePage's own
// comment). Only page-fit LAYOUT (1-3 margins/wrapping, blank-line spreading, the Title segment's
// errata-2.3.4d packing and 2.3.4g grade-level joining, the t1 page number) stays document.mjs's job
// alone — this template has no notion of a physical page width or depth.
// Fields are computed once by format/document.mjs's titlePageFieldsFrom(doc) (the SAME values
// traceTitlePage braille-formats) and passed in already-resolved: this module stays import-free (see
// file header), so the caller does the titlePageFieldsFrom call.
// Each segment is { name, lines: [ { parts: [...], etAl?:true, cell3?:true } ] }. A part is either
// fixed template wording ({lit}) or one field's CURRENT value as an atomic chip ({fld, idx?, value})
// — `idx` identifies which entry of a LIST field (authors, isbn) a line refers to, so a later refresh
// (refreshTitlePageValues, below) can find the right value again even if the list has since grown or
// shrunk, rather than assuming lines stay in the same position (TP-6 "fields stay live"). `etAl`/
// `cell3` are LAYOUT HINTS the template still decides (2.3.5e's uncontracted "et al." tail, 2.3.6f's
// cell-3 indent for a second-or-later ISBN) because they are BANA WORDING/kind decisions, not fitting
// decisions — traceTitlePage still does the actual uncontracted-braille/indent work with them.
// `vol` (per-volume fields: volumeOf/volumeLabel/customBraille/braillePages/printPages) is optional;
// callers that have already paginated (document.mjs) pass the real ones; the editor card (no
// pagination available) defaults to the single-volume case (TP_DEFAULT_VOL) — see this stage's report.
const TP_DEFAULT_VOL = { volumeOf: 1, volumeLabel: '', braillePages: '', printPages: '', customBraille: '' };
const TP_ISBN_RE_PREFIX = /^isbn\b/i;
// One place both titlePageTemplateSegments (below) and refreshTitlePageValues share: the CURRENT
// value of one field (or, for a list field, one INDEXED entry of it), with any display transform the
// wording itself needs (2.3.6f: "ISBN " prefixed unless already there). `fields`/`vol` are flattened
// into one lookup table once per call; `field-registry.mjs`'s own "no imports" rule means this stays
// plain data-shape juggling, no formatter/engine code involved.
// NOT filtered for blank entries here (matches document.mjs's OLD tpAuthorSegLines/tpPublisherSegLines
// exactly — titlepage_format.test.mjs's gold Sample 2-9 passes a deliberately blank isbn:[''] straight
// to formatBlock, bypassing titlePageFieldsFrom's own upstream filtering, and still expects "Transcription
// of ISBN" with nothing after it): `authors.length`/`isbn.length` count every entry, blank or not; an
// individual blank AUTHOR line is skipped when the lines are actually built (titlePageTemplateSegments),
// the same way the old code's per-item `if (String(a||'').trim())` did.
function tpFieldLookup(fields, vol) {
  const f = fields && typeof fields === 'object' ? fields : {};
  const v = { ...TP_DEFAULT_VOL, ...(vol && typeof vol === 'object' ? vol : {}) };
  const authorNames = (Array.isArray(f.authors) && f.authors.length) ? f.authors : (Array.isArray(f.editors) ? f.editors : []);
  return {
    ...f,
    authors: authorNames, isbn: Array.isArray(f.isbn) ? f.isbn : [],
    totalVolumes: String(Number(v.volumeOf) || 1),
    volumeLabel: v.volumeLabel, customBraille: v.customBraille, braillePages: v.braillePages, printPages: v.printPages,
    // UK-9: the SAME volume counts BANA shows as digits ("In 3 Volumes"), in words, for UKAAF's own
    // "In three volumes" / "Volume one" lines (ukTitlePageSegments, below) — kept as ordinary `fld`
    // chips (not baked-in literal text) so TP-6 "fields stay live" still applies to an edited UKAAF page.
    totalVolumesWords: tpNumberWords(Number(v.volumeOf) || 1),
    volumeWords: tpNumberWords(Number(v.volume) || 1),
  };
}
function tpFieldValue(lookup, fld, idx) {
  let raw = idx != null ? (Array.isArray(lookup[fld]) ? lookup[fld][idx] : undefined) : lookup[fld];
  raw = raw == null ? '' : String(raw);
  if (fld === 'isbn' && !TP_ISBN_RE_PREFIX.test(raw)) raw = `ISBN ${raw}`;   // 2.3.6f(6); even a blank isbn gets the bare word (gold Sample 2-9)
  return raw;
}
// UK-9 (28 Sep 2026, James via Paul — PROVISIONAL, no RNIB Braillists' Manual seen): the UKAAF title
// page's own, much shorter, template. Four segments only (no Transcriber segment at all — James: the
// UK title page does not show "transcriber name, braille code and print page range"). Content: title
// (+ subtitle); author; publisher (+ year, when the document's own date — dc:Date/metadata.date — is
// known: neither BANA's Book details dialog nor NIMAS import has a dedicated "publication year" field
// today, so this is the one date Emboss already captures, read via document.mjs's titlePageFieldsFrom
// — see that function's own comment); the volume notice IN WORDS ("In three volumes" / "Volume one",
// tpNumberWords — B004/James give no digit form here, unlike BANA's "In 3 Volumes"). A single volume
// says "In one volume" and has no "Volume one" line, mirroring TP-11's BANA rule for the same case.
// The accessible-copy notice is deliberately NOT a line here: UK-9 "supersedes TP-8's placement" —
// it goes on its own page straight after the title page (document.mjs's assembleUkTitleNoticePage),
// not in the Publisher segment the way BANA's US/UK reproductionNotice line used to be (TP-8 draft).
function ukTitlePageSegments(f, text, fld, line, seg) {
  const titleLines = [];
  if (String(f.title || '').trim()) titleLines.push(line([fld('title')]));
  if (String(f.subtitle || '').trim()) titleLines.push(line([fld('subtitle')]));

  const authorLines = [];
  f.authors.forEach((a, i) => { if (String(a || '').trim()) authorLines.push(line([fld('authors', i)])); });

  const pubLines = [];
  if (String(f.publisher || '').trim()) {
    pubLines.push(String(f.publicationYear || '').trim()
      ? line([fld('publisher'), text(', '), fld('publicationYear')])
      : line([fld('publisher')]));
  }

  const of = Number(f.totalVolumes) || 1;
  const volLines = [line([text('In '), fld('totalVolumesWords'), text(` ${of === 1 ? 'volume' : 'volumes'}`)])];
  if (of > 1) volLines.push(line([text('Volume '), fld('volumeWords')]));

  return [seg('Title', titleLines), seg('Author', authorLines), seg('Publisher', pubLines), seg('Volume', volLines)];
}
export function titlePageTemplateSegments(fields, vol, mode = 'bana') {
  const lookup = tpFieldLookup(fields, vol);
  const f = lookup;
  const val = (fldName, idx) => tpFieldValue(lookup, fldName, idx);
  const seg = (name, lines) => ({ name, lines: lines.filter(Boolean) });
  const text = (s) => ({ lit: s });
  const fld = (name, idx) => (idx != null ? { fld: name, idx, value: val(name, idx) } : { fld: name, value: val(name) });
  const line = (parts, extra) => ({ parts, ...(extra || {}) });

  if (mode === 'ukaaf') return ukTitlePageSegments(f, text, fld, line, seg);

  // Title segment (2.3.4a errata order: title, series, grade level, subtitle, edition; 2.3.4c each own line).
  const titleLines = [['title'], ['series'], ['gradeLevel'], ['subtitle'], ['edition']]
    .filter(([key]) => String(f[key] || '').trim()).map(([key]) => line([fld(key)]));

  // Author segment (2.3.5).
  const authorLines = [];
  if (f.authors.length > 3) authorLines.push(line([fld('authors', 0), text(' et al.')], { etAl: true }));   // 2.3.5e (full list: second title page, out of Stage 1's scope)
  else f.authors.forEach((a, i) => { if (String(a || '').trim()) authorLines.push(line([fld('authors', i)])); });
  if (String(f.translator || '').trim()) authorLines.push(line([fld('translator')]));   // 2.3.5g

  // Publisher and copyright segment (2.3.6, addendum 2.3.6e).
  const pubLines = [];
  if (f.publishedBy && String(f.publisher || '').trim()) pubLines.push(line([text(`${f.publishedBy} `), fld('publisher')]));
  if (String(f.publisherCity || '').trim()) pubLines.push(line([fld('publisherCity')]));
  if (String(f.publisherUrl || '').trim()) pubLines.push(line([fld('publisherUrl')]));
  if (String(f.copyright || '').trim()) pubLines.push(line([fld('copyright')]));
  if (String(f.reproductionNotice || '').trim()) pubLines.push(line([fld('reproductionNotice')]));
  if (f.isbn.length === 1) pubLines.push(line([text('Transcription of '), fld('isbn', 0)]));
  else if (f.isbn.length > 1) {
    pubLines.push(line([text('Transcription of')]));
    f.isbn.forEach((_, i) => pubLines.push(line([fld('isbn', i)], { cell3: true })));   // 2.3.6f(6): each starts in cell 3
  }
  if (String(f.printingHistory || '').trim()) pubLines.push(line([text('Printing history: '), fld('printingHistory')]));

  // Transcriber/Transcription segment (2.3.7).
  const transLines = [];
  if (String(f.transcriber || '').trim()) transLines.push(line([text('Transcribed '), fld('transcriptionYear'), text(' into '), fld('brailleCode'), text(' by '), fld('transcriber')]));
  if (String(f.proofreader || '').trim()) transLines.push(line([text('Proofread by '), fld('proofreader')]));
  if (String(f.tactileSpecialist || '').trim()) transLines.push(line([text('Tactile graphics by '), fld('tactileSpecialist')]));
  if (String(f.agency || '').trim()) transLines.push(line([fld('agency')]));
  if (String(f.agencyLocation || '').trim()) transLines.push(line([fld('agencyLocation')]));

  // Volume Information segment (2.3.8; TP-11: "In 1 Volume" unconditional, no "Volume 1" line for a single volume).
  const of = Number(f.totalVolumes) || 1;
  const volLines = [line([text('In '), fld('totalVolumes'), text(` ${of === 1 ? 'Volume' : 'Volumes'}`)])];
  if (of > 1 && String(f.volumeLabel || '').trim()) volLines.push(line([fld('volumeLabel')]));
  if (String(f.customBraille || '').trim()) volLines.push(line([fld('customBraille')]));
  if (String(f.braillePages || '').trim()) volLines.push(line([text('Braille pages '), fld('braillePages')]));
  if (String(f.printPages || '').trim()) volLines.push(line([text('Print pages '), fld('printPages')]));

  return [
    seg('Title', titleLines), seg('Author', authorLines), seg('Publisher and copyright', pubLines),
    seg('Transcriber', transLines), seg('Volume', volLines),
  ];
}
// K29 Stage 1c rework, TP-6 "fields stay live": recompute every field part's value from the CURRENT
// fields/vol, keeping an already-saved (edited) page's own segments/lines/wording exactly as they
// are — used by both the editor (an edited page's card) and document.mjs's traceTitlePage (an edited
// page's braille). A part's `idx` (see titlePageTemplateSegments) is what makes this safe even if a
// list field has grown or shrunk since the page was last saved: a now-missing index resolves to ''
// (the chip goes empty, matching "empty, line not brailled") rather than showing stale text or
// guessing which entry a line meant.
export function refreshTitlePageValues(segments, fields, vol) {
  const lookup = tpFieldLookup(fields, vol);
  return (Array.isArray(segments) ? segments : []).map((s) => ({
    name: s.name,
    lines: (Array.isArray(s.lines) ? s.lines : []).map((l) => ({
      ...l,
      parts: (Array.isArray(l.parts) ? l.parts : []).map((p) => ('fld' in p ? { ...p, value: tpFieldValue(lookup, p.fld, p.idx) } : p)),
    })),
  }));
}
// A field's accessible label (design §4: "A screen reader announces a chip as, for example, 'Print
// pages, field, i-x and 1-44'"). Also usable as the Insert-field combobox's item text (design §4).
export const TP_FIELD_LABELS = {
  title: 'Title', series: 'Series', gradeLevel: 'Grade level', subtitle: 'Subtitle', edition: 'Edition',
  authors: 'Author', translator: 'Translator', publisher: 'Publisher', publisherCity: "Publisher's city",
  publisherUrl: "Publisher's URL", copyright: 'Copyright notice', reproductionNotice: 'Reproduction notice',
  isbn: 'ISBN', printingHistory: 'Printing history', transcriptionYear: 'Year transcribed', brailleCode: 'Braille code',
  transcriber: 'Transcriber', proofreader: 'Proofreader', tactileSpecialist: 'Tactile graphics specialist',
  agency: 'Agency', agencyLocation: 'Agency location', totalVolumes: 'Total volumes', volumeLabel: 'Volume',
  customBraille: 'Grade', braillePages: 'Braille pages', printPages: 'Print pages',
  // UK-9: UKAAF-only fields (ukTitlePageSegments).
  totalVolumesWords: 'Number of volumes, in words', volumeWords: 'Volume number, in words', publicationYear: 'Publication year',
};
// K29 Stage 1d "Insert field": the fields the combobox offers, in BANA 2.3.3a segment order (design §4
// mockup order), for each mode — a plain, curated subset of TP_FIELD_LABELS' keys rather than every key,
// so the menu matches what that mode's own template (titlePageTemplateSegments, above) actually uses.
export const TP_INSERT_FIELDS_BANA = ['title', 'series', 'gradeLevel', 'subtitle', 'edition', 'authors', 'translator',
  'publisher', 'publisherCity', 'publisherUrl', 'copyright', 'reproductionNotice', 'isbn', 'printingHistory',
  'transcriptionYear', 'brailleCode', 'transcriber', 'proofreader', 'tactileSpecialist', 'agency', 'agencyLocation',
  'totalVolumes', 'volumeLabel', 'customBraille', 'braillePages', 'printPages'];
export const TP_INSERT_FIELDS_UKAAF = ['title', 'subtitle', 'authors', 'publisher', 'publicationYear', 'totalVolumesWords', 'volumeWords'];
export const tpInsertableFields = (mode) => (mode === 'ukaaf' ? TP_INSERT_FIELDS_UKAAF : TP_INSERT_FIELDS_BANA);
// List fields (authors/isbn) default to their FIRST entry when "Insert field" has no particular index in
// mind (the combobox offers one chip per field name, not one per list entry) — the common single-author/
// single-ISBN case reads naturally; a book with several still gets a live, correct value (TP-6), just the
// first one, and the transcriber can retype/duplicate the chip for the rest.
const TP_LIST_FIELDS = new Set(['authors', 'isbn']);
/**
 * The CURRENT value of one field, for "Insert field" — the same value titlePageTemplateSegments would give
 * that field wherever it appears in the template, computed directly (not read off an existing line) so a
 * field can be inserted even where the default template has no line for it (design §4: "puts a field chip
 * at the cursor" — cursor position, not template position, decides where it lands).
 * @param {object} fields titlePageFieldsFrom(doc)'s result @param {object} [vol] per-volume fields (optional)
 * @param {string} fld a TP_FIELD_LABELS key @param {number} [idx] list-field entry index
 */
export function tpFieldCurrentValue(fields, vol, fld, idx) {
  const lookup = tpFieldLookup(fields, vol);
  const i = idx != null ? idx : (TP_LIST_FIELDS.has(fld) ? 0 : null);
  return tpFieldValue(lookup, fld, i);
}
// The structural signature of a titlePageTemplateSegments() result: field-name/index/literal-text
// POSITIONS only, values stripped out (design §3.3/TP-6: field VALUES must never count as an "edit"
// — only a change to which lines/fields exist, or to typed wording, does). Comparing this before/
// after tells an untouched ("auto") page from one the transcriber has actually edited.
export function titlePageStructureSig(segments) {
  // A segment with no lines (e.g. "Publisher and copyright" with nothing set) is never actually
  // rendered — editor.mjs's $fillTitlePage skips it — so it must be filtered out here too, or an
  // untouched page would always mismatch its own signature (every empty segment counted once too
  // many) and immediately show as "edited" the instant it is created.
  return JSON.stringify((segments || []).filter((s) => s && Array.isArray(s.lines) && s.lines.length)
    .map((s) => ({
      name: s.name,
      lines: s.lines.map((l) => ({
        parts: (l.parts || []).map((p) => ('fld' in p ? { fld: p.fld, idx: p.idx ?? null } : { lit: p.lit })),
        ...(l.etAl ? { etAl: true } : {}), ...(l.cell3 ? { cell3: true } : {}),
      })),
    })));
}

// Block styles (the editor's BLOCK_STYLES) that are transcriber tools: hidden from the style dropdown and the slash
// menu while "Transcriber tools" is off. A document that already has such a page keeps it.
// K29 Stage 1c: 'titlepage' joins them (design §4 "Transcriber tools only; hidden when the setting is off").
export const TRANSCRIBER_STYLES = ['tnpage', 'sympage', 'titlepage'];
// The everyday block styles (Paul, 26 Sep 2026): with Transcriber tools off, the style dropdown and the slash menu
// offer only these — body text, headings, bulleted and numbered lists, and tables. Every other style (sidebar,
// poem, play, exercise, caption, index/contents entries, plain and listed lists, quotations, notes, the transcriber
// pages) is a transcriber style. A block that already has one keeps it, and the dropdown still shows it while the
// caret is in that block, so the user can see what it is and change it.
export const EVERYDAY_STYLES = ['p', 'h1', 'h2', 'h3', 'bullet', 'number', 'table-spatial'];
// Toolbar buttons that are transcriber tools (shown only with the setting on). The Blocked (1-1) and Directions (5-5)
// paragraph toggles are BANA margin conventions (Paul, 24 Sep): hidden, not removed, so a paragraph already set that
// way keeps its format, and an ordinary user sets block paragraphs for the whole document in Settings. Layout (the
// Braille formatting dialog) is a transcriber tool too (Paul, 25 Sep): its shortcut and slash-menu entry go with it.
// btnStrike (UEB 9.5.1 crossed-out text, the first transcriber-defined typeform) is a
// transcriber tool the same way: hidden while the setting is off, but the run it already
// marked keeps that marking, and the Ctrl/⌘+Shift+X shortcut still works either way.
// btnScript (K5, UEB §9 script typeform — RUEB 3rd ed. §9.1.2: script does not need a
// transcriber-defined typeform of its own, but Emboss still gates ITS control the same way
// btnStrike's is gated, since both mark up print typeforms a plain reader does not need to
// set) is a transcriber tool for the same reason: hidden while the setting is off, but a run
// already marked script keeps that marking, and the Ctrl/⌘+Shift+S shortcut still works.
// btnSidebar: inserting a sidebar box is a transcriber tool too (Paul, 26 Sep); "Remove box" stays available to everyone.
// K29 Stage 1c: btnTitlepageRegen (the Title Page's "Regenerate" toolbar button, same pattern as btnSymRegen)
// joins them. btnTitlepageDetails ("Book details…") is NOT here: it already lives inside the Settings dialog
// behind its own `fmt-transcriber` wrapper (index.html), the same CSS gate this list drives for toolbar buttons.
export const TRANSCRIBER_BUTTONS = ['btnTnSuggest', 'btnSymRegen', 'btnTitlepageRegen', 'btnBlockedPara', 'btnDirectionsPara', 'btnBrailleFmt', 'btnStrike', 'btnScript', 'btnSidebar'];

// Class tokens the exporter writes that are structure, not optional formatting fields (so the test can tell a
// missing registry entry from a structural token). A trailing * is a prefix.
export const STRUCTURAL_TOKENS = ['bana-title', 'bana-code', 'bana-level-*', 'bana-no-marker', 'bana-transcriber-notes', 'bana-tn-continued', 'bana-special-symbols', 'bana-symbols-auto', 'bana-symbol',
  'bana-break-asterisks', 'bana-break-asterism', 'bana-break-dot2s', 'bana-stairstep', 'bana-linear', 'bana-facing', 'bana-interchange', 'bana-listed', 'bana-vertical', 'bana-spatial', 'bana-heading', 'bana-heading-before-box'];

// ---- UI layout: the dialog's fieldsets (in DOM order) and the Settings group, each listing its controls in order ----
// `kinds`: the focused-block kinds (editor bfResolveTarget) that show the group. `first`: the control focused on open.
export const GROUPS = [
  { id: 'fmtGroupList', group: 'list', kinds: ['list'], legendKey: L('g_list'), legend: 'List', first: 'fmtEnum',
    controls: ['fmtBullet', 'fmtColumns', 'fmtEnum', 'fmtStart', 'fmtSym0', 'fmtSym1', 'fmtSym2', 'fmtAfterNote', 'fmtWordList', 'fmtStripContinuation', 'fmtItemIgnoreFont', 'fmtKeepEmphasis', 'fmtTranslationPairs',
      { wrap: 'fmtListGlossaryWrap', controls: ['fmtThesaurus', 'fmtDictionary', 'fmtAlphabeticMargins', 'fmtSharedMargin'] }] },
  { id: 'fmtGroupHeading', group: 'heading', kinds: ['heading'], legendKey: L('g_heading'), legend: 'Heading', controls: ['fmtNotConnected', 'fmtAccompaniesBox', 'fmtEntryWord', 'fmtEndMarkerBefore'] },
  { id: 'fmtGroupSpeaker', group: 'speaker', kinds: ['speaker'], legendKey: L('g_speaker'), legend: 'Play speaker', controls: ['fmtSpeakerGap'] },
  { id: 'fmtGroupVerse', group: 'verse', kinds: ['verse'], legendKey: L('g_verse'), legend: 'Line numbers',
    controls: ['fmtLnNoteText', 'fmtLnNoteOff', 'fmtLnNoteBeforeHeading', 'fmtCountedWords', 'fmtWordGaps', 'fmtWideSpaces', 'fmtRhymeLetters', 'fmtUncontractedPoem', 'fmtDisplayedPoem', 'fmtPoemMethod'] },
  { id: 'fmtGroupNote', group: 'note', kinds: ['note'], legendKey: L('g_note'), legend: 'Note',
    controls: ['fmtEnclosePrefix', 'fmtXref', 'fmtXrefHeading', 'fmtKeyList', 'fmtKeyLocator', 'fmtCell5', 'fmtMentionSymbols'] },
  { id: 'fmtGroupDirections', group: 'directions', kinds: ['directions'], legendKey: L('g_directions'), legend: 'Directions', controls: ['fmtDirectionsContinued', 'fmtDirectionsLabelled'] },
  { id: 'fmtGroupTable', group: 'table', kinds: ['table'], legendKey: L('g_table'), legend: 'Table',
    controls: [{ note: 'fmtTableNote', key: L('table_not_stairstep'), text: 'The subdivision rows and heading below only take effect when the table format is Stairstep.', audience: T },
      'fmtSubRows', 'fmtSubHeading', 'fmtGuideDots', 'fmtColumnAlign', 'fmtCitationText', 'fmtCitationPos', 'fmtTotalRows', 'fmtRowSubheadings', 'fmtGuideDotNote', 'fmtGuideDotNoteText', 'fmtRepeatHeadings', 'fmtContinuedNote', 'fmtContinuedNoteText', 'fmtTablePageBreakBefore', 'fmtDittoMarks', 'fmtNumericPassage', 'fmtTableKey', 'fmtTableKeyIntro', 'fmtTableKeepEmphasis'] },
  { id: 'fmtGroupPara', group: 'para', kinds: ['para'], legendKey: L('g_para'), legend: 'Paragraph layout', controls: ['fmtDiagram', 'fmtHangingMargins', 'fmtArrowLines', 'fmtParaNumber', 'fmtSongInfo', 'fmtParaWordGaps', 'fmtDedication', 'fmtDisplayIndent'] },
  { id: 'fmtGroupFootnote', group: 'footnote', kinds: ['footnote'], legendKey: L('g_footnote'), legend: 'Footnote', controls: ['fmtNoteMarkPlacement'] },
  { id: 'fmtGroupBox', group: 'box', kinds: ['box'], legendKey: L('g_box'), legend: 'Box (sidebar)', controls: ['fmtBoxLines', 'fmtBoxColor', 'fmtBoxPageBreakBefore'] },
  { id: 'fmtGroupPagenum', group: 'pagenum', kinds: ['pagenum'], legendKey: L('g_pagenum'), legend: 'Print page change', controls: ['fmtImplied', 'fmtThrough', 'fmtSpelled', 'fmtCombineWithNext', 'fmtUnnumbered'] },
  { id: 'fmtGroupCaption', group: 'caption', kinds: ['caption'], legendKey: L('g_caption'), legend: 'Caption', controls: ['fmtIdentifier', 'fmtIdentifierText'] },
  { id: 'fmtGroupFonts', group: 'fonts', kinds: ['heading', 'speaker', 'verse', 'note', 'directions', 'para', 'footnote', 'list'], legendKey: L('g_fonts'), legend: 'Fonts and page break',
    controls: ['fmtIgnoreFont', 'fmtDiacriticNotation', 'fmtOmitFullEmphasis', 'fmtOmitEmphasis', 'fmtPageBreakBefore'] },
  { id: 'docOptionsGroup', group: 'doc', settings: true,
    controls: ['docVerseKeep', 'docListPageRules', 'docInterpointOmitEven', 'docEndOfVolume', 'docTocHeading', 'docTocRightBuffer', 'docLineIndicator', 'docNestedBullets', 'docEndMarkers', 'docRunningHeadKeyWords',
      'docSpacedEllipsis', 'docElisionApostrophe', 'docTypeformWordPunct', 'docPilPrintPage', 'docExhaustiveSymbols', 'docForeignText', 'docForeignTitle', 'docGuideWords', 'docIndexGuideWords',
      'docTableEndMarker', 'docDocEndMarker', 'docShowBullets'] },   // UK-6 / UK-10
];

// ---- codecs: a field's stored value (the editor node's fmt value, or the doc option) <-> its control value(s) ----
// read(v, ctl)            -> control value (boolean for a checkbox, string otherwise); a composite returns { part: value }
// write(c, ctl, ctx)      -> { value } (null / false / '' = unset) or { err: i18n key, params? }
// 'special' controls are handled by explicit editor code (list numbering, bullets, symbols, item fonts, table node fields).
const csvList = (raw) => {
  if (!raw) return { list: null };
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.some((s) => !s)) return { err: true };
  return { list: parts };
};
export const CODECS = {
  bool: { read: (v) => !!v, write: (c) => ({ value: !!c }) },
  text: { read: (v) => (v ? String(v) : ''), write: (c) => ({ value: c }) },
  enum: { read: (v, ctl) => (ctl.options.some((o) => o.value && o.value === v) ? v : ''), write: (c) => ({ value: c || null }) },
  tri: { read: (v) => (v === FMT_OFF ? 'off' : (v === true ? 'on' : '')), write: (c) => ({ value: c === 'off' ? FMT_OFF : (c === 'on' ? true : null) }) },
  invert: { read: (v) => v !== true, write: (c) => ({ value: c ? null : true }) },
  int: {
    read: (v) => (v ? String(v) : ''),
    write: (c, ctl) => {
      if (!c) return { value: null };
      const n = Number(c);
      if (!Number.isInteger(n) || n < ctl.min || n > ctl.max) return { err: ctl.errKey };
      return { value: n >= (ctl.storeMin ?? ctl.min) ? n : null };
    },
  },
  csv: { read: (v) => (Array.isArray(v) ? v.join(', ') : ''), write: (c, ctl) => { const r = csvList(c); return r.err ? { err: ctl.errKey } : { value: r.list }; } },
  lines: {
    read: (v) => (Array.isArray(v) ? v.join('\n') : ''),
    write: (c, ctl) => {
      if (!c) return { value: null };
      const lines = c.split(/\r?\n/).filter((l) => l.length);
      return lines.some((l) => l.length > ctl.maxLen) ? { err: ctl.errKey } : { value: lines };
    },
  },
  rows1: {
    read: (v) => (Array.isArray(v) ? v.map((i) => i + 1).join(', ') : ''),
    write: (c, ctl, ctx) => {
      if (!c) return { value: null };
      const rows = ctx.rowCount;
      const parts = c.split(',').map((s) => s.trim());
      if (!parts.every((x) => /^\d+$/.test(x) && Number(x) >= 1 && Number(x) <= rows)) return { err: ctl.errKey, params: { rows } };
      return { value: [...new Set(parts.map((x) => Number(x) - 1))].sort((a, b) => a - b) };
    },
  },
  rowText: {
    read: (v) => (Array.isArray(v) ? v.map((e) => `${e.row + 1}: ${e.text}`).join('\n') : ''),
    write: (c, ctl, ctx) => {
      if (!c) return { value: null };
      const rows = ctx.rowCount;
      const entries = [];
      const seen = new Set();
      for (const line of c.split(/\r?\n/).filter((l) => l.trim())) {
        const m = /^(\d+)\s*:\s*(.+)$/.exec(line.trim());
        const n = m && Number(m[1]);
        if (!m || n < 1 || n > rows || seen.has(n) || !m[2].trim()) return { err: ctl.errKey, params: { rows } };
        seen.add(n);
        entries.push({ row: n - 1, text: m[2].trim() });
      }
      return { value: entries };
    },
  },
  // K8: a table's key list, one item per line: "code: meaning" (column heading) or "row code: meaning" (row heading).
  tableKey: {
    read: (v) => (Array.isArray(v) ? v.map((it) => `${it && it.group === 'row' ? 'row ' : ''}${(it && it.symbol) || ''}: ${(it && it.meaning) || ''}`).join('\n') : ''),
    write: (c, ctl) => {
      if (!c) return { value: null };
      const items = [];
      for (const raw of c.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        const m = /^(row\s+)?(\S+)\s*:\s*(.+)$/i.exec(line);
        if (!m || !m[3].trim()) return { err: ctl.errKey };
        items.push({ symbol: m[2], meaning: m[3].trim(), ...(m[1] ? { group: 'row' } : {}) });
      }
      return { value: items.length ? items : null };
    },
  },
  // Composites (two controls, one value).
  citation: {
    read: (v) => ({ text: typeof v === 'string' ? v : (v && v.text) || '', position: v && typeof v === 'object' && v.position === 'inside-box' ? 'inside-box' : '' }),
    write: (c) => {
      if (c.position && !c.text) return { err: 'app.braille_fmt.err_citation_text', part: 'text' };
      return { value: c.text ? (c.position ? { text: c.text, position: c.position } : c.text) : null };
    },
  },
  guideDotNote: {
    read: (v) => ({ on: !!v, text: typeof v === 'string' ? v : '' }),
    write: (c) => (c.text && !c.on ? { err: 'app.braille_fmt.err_guide_note', part: 'text' } : { value: c.on ? (c.text || true) : null }),
  },
  continuedNote: {
    read: (v) => ({ mode: v === FMT_OFF ? 'off' : (v ? 'on' : ''), text: typeof v === 'string' ? v : '' }),
    write: (c) => (c.text && c.mode !== 'on' ? { err: 'app.braille_fmt.err_continued_text', part: 'text' } : { value: c.mode === 'off' ? FMT_OFF : (c.mode === 'on' ? (c.text || true) : null) }),
  },
  // Settings (document options on loadedDocInfo.options; `undefined` = delete the key).
  docBool: { read: (v) => !!v, write: (c) => ({ value: c ? true : undefined }) },
  docOff: { read: (v) => v !== false, write: (c) => ({ value: c ? undefined : false }) },
  docText: { read: (v) => v || '', write: (c, ctl) => (c && ctl.pattern && !new RegExp(ctl.pattern).test(c) ? { err: ctl.errKey } : { value: c || undefined }) },
};

// ---- helpers ----
const byKey = new Map(FIELDS.map((f) => [f.key, f]));
export const fieldByKey = (k) => byKey.get(k) || null;
/** Every control of every field, with its field key: [{ ...control, field }]. */
export const ALL_CONTROLS = FIELDS.flatMap((f) => (f.ui || []).map((c) => ({ audience: f.audience, ...c, field: f.key })));
const ctlById = new Map(ALL_CONTROLS.map((c) => [c.id, c]));
export const controlById = (id) => ctlById.get(id) || null;
/** The control ids of a GROUPS entry, flattened (wrap members included), in order. */
export const groupControlIds = (g) => g.controls.flatMap((c) => (typeof c === 'string' ? [c] : (c.wrap ? c.controls : [])));
/** The fieldsets a focused-block kind shows, in order. */
export const groupsForKind = (kind) => GROUPS.filter((g) => !g.settings && g.kinds.includes(kind));
/** Editor carry keys for one bucket ('heading' | 'list' | 'item' | 'para' | 'note' | 'code' | 'pagenum' | 'table' | 'pbb'), in registry order. */
export const fmtKeysFor = (bucket) => FIELDS.filter((f) => (f.carry || []).includes(bucket)).map((f) => f.key);
/** Keys whose explicit "off" (false) is stored as FMT_OFF on the node. */
export const fmtOffKeys = () => FIELDS.filter((f) => f.offMarker).map((f) => f.key);
/** Document-option keys: all, the booleans, the default-on opt-outs, the text ones. */
export const docOptionFields = () => FIELDS.filter((f) => (f.save || []).some((s) => s.meta));

/** nimas-export.mjs's BANA_FLAG_FIELDS: { field, token, types, value?, when? } in registry order. */
export function flagFieldTable() {
  const out = [];
  for (const f of FIELDS) for (const s of f.save || []) {
    if (!s.class || s.title != null || s.special) continue;
    const e = { field: f.key, token: s.class, types: s.types || f.where };
    if ('value' in s) e.value = s.value;
    if (s.when) e.when = s.when;
    out.push(e);
  }
  return out;
}
/** nimas-export.mjs's BANA_TEXT_FIELDS: { field, token, types, enc?, dec? } in title order. */
export function textFieldTable() {
  const rows = [];
  for (const f of FIELDS) for (const s of f.save || []) {
    if (!s.class || s.title == null) continue;
    const e = { field: f.key, token: s.class, types: s.types || f.where };
    if (s.enc) e.enc = s.enc;
    if (s.dec) e.dec = s.dec;
    rows.push([s.title, e]);
  }
  return rows.sort((a, b) => a[0] - b[0]).map((r) => r[1]);
}
/** nimas-export.mjs's BANA_DOC_OPTIONS: { field, meta, off?, text?, enc?, dec? } in registry order. `enc`/`dec`
 *  (K29 Stage 1a, tpEditors/tpIsbn): a list-valued document option, encoded the same way a text-field array is
 *  (ARR_SEP-joined string); everything else keeps the plain text/off/bool forms unchanged. */
export function docOptionTable() {
  const out = [];
  for (const f of FIELDS) for (const s of f.save || []) {
    if (!s.meta) continue;
    const e = { field: f.key, meta: s.meta };
    if (s.off) e.off = true;
    if (s.text) e.text = true;
    if (s.enc) e.enc = s.enc;
    if (s.dec) e.dec = s.dec;
    out.push(e);
  }
  return out;
}
/** Every class token / <meta> name the registry says the exporter can write (patterns end in *). */
export function registryTokens() {
  const toks = new Set();
  for (const f of FIELDS) for (const s of f.save || []) {
    if (s.class) toks.add(s.class);
    if (s.meta) toks.add(s.meta);
    for (const t of s.tokens || []) toks.add(t);
    if (s.pattern) toks.add(s.pattern.replace(/N$|\*$/, '*'));
  }
  return toks;
}
