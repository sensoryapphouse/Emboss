// K16: foreign-language material per BANA's June 2024 "Changes to Foreign Language Sections of Braille Formats"
// (references/_text/Changes_Foreign_Language_Sections_Braille_Formats_2016.txt, BRF in references/bana/).
//   1.16.2  incidental foreign words: contracted, UEB modified-letter indicators, and no contraction where a
//           modification falls (liblouis with NFC input, K20) - checked here as a regression guard.
//   1.16.3  the document option `foreignText` ("Foreign-language teaching text"): text marked with a language
//           (`seg.lang`) is uncontracted, with the foreign alphabet signs of BANA Formats Appendix D and UEB punctuation
//           (inverted marks included); RUEB 13.2.2: no grade 1 indicators in it.
//   1.16.4  optional `foreignTitle`: the running head and the page-1 title are foreign.
//   5.4.4   foreign letters and word parts keep their font attributes, uncontracted, foreign alphabet.
//   8.10 / 10.1.6c  all itemized lists foreign: no grade 1 indicator on identifying letters; mixed: English letters + TN.
//   21.6.3c / Appendix G  foreign alphabet signs on the Special Symbols page (PROVISIONAL wording).
// Real liblouis engine (as k13_symbols.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDocument, formatBlock, traceBlock, getBlockSignature, collectSpecialSymbols, suggestTranscriberNotes } from '../format/document.mjs';
import * as R from '../format/field-registry.mjs';
import * as louis from '../engine/louis.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const translate = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const translateG1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const translatePos = (t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null);
const OPTS = { mode: 'bana', standard: 'bana', width: 40, depth: 25, translate, translateG1, suppressHeader: true };

// Pages -> non-blank lines (upper-case BRF, as liblouis writes it).
const pages = (doc, extra = {}) => formatDocument(doc, { ...OPTS, ...extra }).split('\f').map((pg) => pg.split('\r\n').filter((l) => l.trim()));
const lines = (doc, extra = {}) => pages(doc, extra).flat();
const on = (doc) => ({ ...doc, foreignText: true });
const txt = (text, x = {}) => ({ type: 'text', text, ...x });
const es = (text, x = {}) => txt(text, { lang: 'es', ...x });
const fr = (text, x = {}) => txt(text, { lang: 'fr', ...x });
const de = (text, x = {}) => txt(text, { lang: 'de', ...x });
const it_ = (text, x = {}) => txt(text, { lang: 'it', ...x });
const para = (segs) => ({ type: 'para', blocked: true, segments: segs });
const doc1 = (...segs) => ({ blocks: [para(segs)] });

// ---------------------------------------------------------------------------------------------------------------
// 1.16.2 (June 2024): "If a modification applies to a letter that would be part of a contraction, do not use the
// contraction." Incidental words, option off. (Already so since K20; these must stay so.)
test('1.16.2: no contraction across a modified letter; the rest of the word stays contracted', () => {
  const cases = [
    ['Märchen', ',M^3AR*5'],          // ar not contracted over ä; ch and en still are
    ['Händel', ',H^3ANDEL'],          // and not contracted over ä
    ['Général', ',G^/EN^/ERAL'],      // en, er not contracted over é
    ['blessèd', 'B.S^*ED'],           // ed not contracted over è; "less" still is
    ['Bärenstark', ',B^3AR5/>K'],     // the first ar is modified (not contracted), the second is contracted
    ['señor', 'SE^]NOR'],
    ['théâtre', '?^/E^%ATRE'],
  ];
  for (const [w, brl] of cases) {
    assert.deepEqual(lines(doc1(txt(w))), [brl], w);
    assert.deepEqual(lines(doc1(txt(w.normalize('NFD')))), [brl], `${w} (decomposed)`);
    assert.deepEqual(lines(doc1(txt(w, { lang: 'de' }))), [brl], `${w}: lang alone changes nothing while the option is off`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 1.16.3: the same document with the option off and on.
const LESSON = {
  title: 'Lesson',
  blocks: [
    { type: 'heading', level: 1, text: 'Lesson' },
    para([txt('The word '), es('canción', { tf: 1 }), txt(' means song. Read: '), es('¿Cuáles pantalones cuestan más?')]),
    para([fr('Il y a deux crèches en ville.')]),
  ],
};
test('1.16.3: option off - foreign text contracted with UEB modifiers (1.16.2)', () => {
  assert.deepEqual(lines(LESSON), [
    '                ,LESSON',
    ',! ^W .1CANCI^/ON M1NS S;G4 ,R1D3',
    '^;8,CU^/ALES PANTAL"OS CUE/AN M^/AS8',
    ',IL ;Y A DEUX CR^*E*ES EN VILLE4',
  ]);
});
test('1.16.3: option on - foreign text uncontracted, foreign alphabet signs, UEB punctuation, English contracted', () => {
  assert.deepEqual(lines(on(LESSON)), [
    '                ,LESSON',
    ',! ^W .1CANCI+N M1NS S;G4 ,R1D3',       // Spanish ó = + (Appendix D.4); italic kept (5.4.4 / print)
    '^;8,CU(LES PANTALONES CUESTAN M(S8',     // UEB inverted question mark ^;8 (1.16.3), á = (
    ',IL Y A DEUX CR!CHES EN VILLE4',         // French è = !; no grade 1 indicator before "y" (RUEB 13.2.2)
  ]);
});
test('1.16.3: option on, but no text marked foreign - byte-identical braille', () => {
  const plain = { blocks: [para([txt('A café in Zürich, then the Märchen.')]), { type: 'list', items: [{ marker: 'b.', text: 'one' }] }] };
  assert.equal(formatDocument(on(plain), OPTS), formatDocument(plain, OPTS));
});
test('1.16.3: formatBlock / traceBlock and the translatePos page builder give the same braille (A39)', () => {
  assert.equal(formatDocument(on(LESSON), { ...OPTS, translatePos }), formatDocument(on(LESSON), OPTS));
  assert.match(formatDocument(on(LESSON), { ...OPTS, translatePos }), /CANCI\+N/);
  const o = { ...OPTS, translatePos, foreignText: true };
  for (const b of [LESSON.blocks[1], LESSON.blocks[2], { type: 'table', headers: ['Spanish', 'English'], rows: [[{ segments: [es('el niño')] }, 'the child']] }]) {
    const f = formatBlock(b, o, false).filter((l) => l !== '');
    const t = traceBlock(b, o, false).map((l) => l.s).filter((l) => l !== '');
    assert.deepEqual(t, f);
  }
});
test('1.16.3: decomposed input gets the foreign signs too', () => {
  assert.deepEqual(lines(on(doc1(es('más números'.normalize('NFD'))))), ['M(S N)MEROS']);
});
test('1.16.3: a table cell that is one foreign run', () => {
  const t = { blocks: [{ type: 'table', headers: ['Spanish', 'English'], rows: [[{ segments: [es('el niño')] }, 'the child'], [{ segments: [es('la canción')] }, 'the song']] }] };
  // Two blank cells between the columns (BANA 11.2.5b; K33 - was one where an entry or its guide dots filled the column).
  assert.deepEqual(lines(on(t)).slice(2), ['EL NI]O ""  ! *', 'LA CANCI+N  ! S;G']);
  assert.deepEqual(lines(t).slice(2), ['EL NI^]NO ""  ! *', 'LA CANCI^/ON  ! S;G']);
});

// ---------------------------------------------------------------------------------------------------------------
// BANA Formats 2016 Appendix D, the foreign alphabet signs the option uses (Examples D-1 to D-4).
test('Appendix D Example D-1 (French) with the option on', () => {
  assert.deepEqual(lines(on(doc1(fr('Maël, issu d’une famille royale de Cambrie, fut envoyé dès sa neuvième année dans l’abbaye d’Yvern, pour y étudier les lettres sacrées et profanes.')))), [
    ",MA$L1 ISSU D'UNE FAMILLE ROYALE DE",
    ',CAMBRIE1 FUT ENVOY= D!S SA NEUVI!ME',
    "ANN=E DANS L'ABBAYE D',YVERN1 POUR Y",
    '=TUDIER LES LETTRES SACR=ES ET PROFANES4',
  ]);
});
test('Appendix D Example D-2 (German) with the option on', () => {
  assert.deepEqual(lines(on(doc1(de('Die Pflanzenschöpfung dagegen wirkt durch stetige Größe auf unsere Einbildungskraft.')))), [
    ',DIE ,PFLANZENSCH[PFUNG DAGEGEN WIRKT',
    'DURCH STETIGE ,GR[!E AUF UNSERE',
    ',EINBILDUNGSKRAFT4',
  ]);
});
test('Appendix D Example D-3 (Italian) with the option on', () => {
  assert.deepEqual(lines(on(doc1(it_('Un tratto importante, che caratterizza il grande movimento della civiltà italiana risorgente e che risulta, non pure dalla poesia e filosofia di quel tempo, …')))), [
    ',UN TRATTO IMPORTANTE1 CHE CARATTERIZZA',
    'IL GRANDE MOVIMENTO DELLA CIVILT(',
    'ITALIANA RISORGENTE E CHE RISULTA1 NON',
    'PURE DALLA POESIA E FILOSOFIA DI QUEL',
    'TEMPO1 444',
  ]);
});
test('Appendix D Example D-4 (Spanish): letters as Appendix D, question marks UEB as 1.16.3 (June 2024) requires', () => {
  // Appendix D (2016) shows the Spanish-code question mark `5`; 1.16.3 now says "UEB punctuation, including inverted
  // punctuation marks", so ¿ ? are ^;8 and 8. The letters are D-4's own: á ( , é !.
  assert.deepEqual(lines(on(doc1(es('¿Cuáles pantalones cuestan más, los de él o los de ella?')))), [
    '^;8,CU(LES PANTALONES CUESTAN M(S1 LOS',
    'DE !L O LOS DE ELLA8',
  ]);
});
test('RUEB 13.7.2 and 13.6.4 examples (foreign code letters inside UEB)', () => {
  assert.deepEqual(lines(on(doc1(es('¡qué lástima!')))), ['^;6QU! L(STIMA6']);                  // ⠘⠰⠖⠟⠥⠮ ⠇⠷⠎⠞⠊⠍⠁⠖
  assert.deepEqual(lines(on(doc1(es('Yo '), es('soy', { tf: 4 }), es(' músico.')))), [',YO ^1SOY M)SICO4']);   // ⠠⠽⠕ ⠘⠂⠎⠕⠽ ⠍⠾⠎⠊⠉⠕⠲
});

// ---------------------------------------------------------------------------------------------------------------
// The June 2024 document's only BRF example: Example 21-38 (21.9.3, variant forms of foreign entries).
test('June 2024 Example 21-38: dessus, là-∝ / exacto, -a / exacto, a (BRF lines 1-3)', () => {
  const ex = { blocks: [{ type: 'list', kind: 'index', items: [
    { segments: [fr('dessus, là-∝')] }, { segments: [es('exacto, -a')] }, { segments: [es('exacto, a')] }, { segments: [fr('arbre, l\'—')] },
  ] }] };
  const got = lines(on(ex));
  assert.deepEqual(got.slice(0, 3), ['DESSUS1 L(-_"7', 'EXACTO1 -A', 'EXACTO1 A']);   // BRF: DESSUS1 L(-_"7 / EXACTO1 -A / EXACTO1 A
  // BRF line 4 is >BRE1 L',- ("arbre" contracted, although "là" on line 1 has the French sign) - an open question to
  // the transcribers (review doc round 2, question 4). Uncontracted French gives ARBRE; the l'— part matches.
  assert.equal(got[3], "ARBRE1 L',-");
});
test('gold Example 21-39 (corrected for June 2024 21.9.3): no grade 1 indicator in the German, modifier before the hyphen', () => {
  const ex = { blocks: [{ type: 'list', kind: 'index', items: [
    { segments: [fr('dessus, là-∝')] }, { segments: [de('der Tisch, —e')] }, { segments: [de('der Spass, -̈e or -̈sse')] }, { segments: [es('exacto, -a')] }, { segments: [fr('tu —ses, il-̂t')] },
  ] }] };
  assert.deepEqual(lines(on(ex)), ['DESSUS1 L(-_"7', 'DER ,TISCH1 ,-E', 'DER ,SPASS1 ^3-E OR ^3-SSE', 'EXACTO1 -A', 'TU ,-SES1 IL^%-T']);
});
test('gold Examples 17-1 (17.7) and 21-22 (21.6.3b): Spanish entry words uncontracted, English contracted', () => {
  const g171 = { blocks: [{ type: 'glossary', kind: 'glossary', definitionList: true, items: [
    { term: 'el medio ambiente', def: 'environment', termSegments: [es('el medio ambiente')] }, { term: 'el mundo', def: 'world', termSegments: [es('el mundo')] }] }] };
  assert.deepEqual(lines(on(g171)), ['EL MEDIO AMBIENTE  5VIRON;T', 'EL MUNDO  _W']);
  assert.deepEqual(lines(g171), ['EL M$IO AMBI5TE  5VIRON;T', 'EL MUNDO  _W']);
  const g2122 = { blocks: [{ type: 'list', kind: 'glossary', style: 'glossary', items: [
    { term: 'bacteria/bacterías', def: 'Pequeñísimos microorganismos unicelulares. (B59)', termSegments: [txt('bacteria/'), es('bacterías')], defSegments: [es('Pequeñísimos microorganismos unicelulares. (B59)')] },
  ] }] };
  assert.deepEqual(lines(on(g2122)), ['BACT]IA_/BACTER/AS ,PEQUE]/SIMOS', '  MICROORGANISMOS UNICELULARES4', '  "<,B#EI">']);
});

// ---------------------------------------------------------------------------------------------------------------
// BANA 21.6.3 "English and Foreign Language Glossaries" - automatic in every glossary, WITHOUT the document option:
// "a. Use contracted braille for English entry words. b. Use uncontracted braille for foreign language entry words, using
// the appropriate accented letters and symbols for the language. c. List foreign language symbols on the Special Symbols
// page." Example 21-22 (whole example, BRF from Formats 2016 p. 21-11) in an ordinary English book.
const G2122 = { type: 'list', kind: 'glossary', style: 'glossary', items: [
  { term: 'bacteria/bacterías', def: 'Pequeñísimos microorganismos unicelulares. (B59)', termSegments: [txt('bacteria/'), es('bacterías')], defSegments: [es('Pequeñísimos microorganismos unicelulares. (B59)')] },
  { term: 'balance/equilibrio', def: 'La habilidad de no caer. (C25)', termSegments: [txt('balance/'), es('equilibrio')], defSegments: [es('La habilidad de no caer. (C25)')] },
  { term: 'benign/benigno', def: 'Que no es canceroso. (D64)', termSegments: [txt('benign/'), es('benigno')], defSegments: [es('Que no es canceroso. (D64)')] },
] };
const EX_2122 = ['BACT]IA_/BACTER/AS ,PEQUE]/SIMOS', '  MICROORGANISMOS UNICELULARES4', '  "<,B#EI">', 'BAL.E_/EQUILIBRIO ,LA HABILIDAD DE NO', '  CAER4 "<,C#BE">', '2NIGN_/BENIGNO ,QUE NO ES CANCEROSO4', '  "<,D#FD">'];
test('21.6.3b: Example 21-22 with the option OFF - Spanish entry words (and the Spanish definitions) uncontracted, Spanish signs; English contracted', () => {
  assert.deepEqual(lines({ blocks: [G2122] }), EX_2122);
  assert.deepEqual(lines(on({ blocks: [G2122] })), EX_2122);                 // the option changes nothing here
  // the same words outside a glossary are incidental foreign words: contracted, UEB modifiers (1.16.2)
  assert.deepEqual(lines(doc1(es('La habilidad de no caer.'))), [',LA HABILIDAD DE NO CA]4']);   // caer: CA] (er)
  // 21.6.3 does not reach a 17.6 definition list ("Entry words are contracted only", 17.6.1) or an index
  const dl = { type: 'glossary', kind: 'glossary', definitionList: true, items: [{ term: 'el medio ambiente', def: 'environment', termSegments: [es('el medio ambiente')] }] };
  assert.deepEqual(lines({ blocks: [dl] }), ['EL M$IO AMBI5TE  5VIRON;T']);
  const idx = { type: 'list', kind: 'index', items: [{ segments: [es('canción, 12')] }] };
  assert.deepEqual(lines({ blocks: [idx] }), ['CANCI^/ON1 #AB']);
});
test('21.6.3b: glossary entries of every shape (type glossary, bilingual, French and Portuguese entries, untagged = English)', () => {
  const g = { type: 'glossary', bilingual: true, items: [
    { term: 'la canción', def: 'song', termSegments: [es('la canción')] },
    { term: 'le théâtre', def: 'theater', termSegments: [fr('le théâtre')] },
    { term: 'a ação', def: 'action', termSegments: [txt('a ação', { lang: 'pt' })] },
    { term: 'the station', def: 'la estación', defSegments: [es('la estación')] },   // English entry (no lang): contracted
    { term: 'la canción', def: 'song' },                                              // no lang recorded: English, as before
  ] };
  assert.deepEqual(lines({ blocks: [g] }), ['LA CANCI+N  S;G', 'LE TH=*TRE  !AT]', 'A A&>O  AC;N', '! /A;N  LA ESTACI+N', 'LA CANCI^/ON  S;G']);
});
test('21.6.3b: formatBlock and traceBlock give the same braille (A39); the translatePos page builder too', () => {
  const o = { ...OPTS, translatePos };
  const f = formatBlock(G2122, o, false).filter((l) => l !== '');
  const t = traceBlock(G2122, o, false).map((l) => l.s).filter((l) => l !== '');
  assert.deepEqual(f, EX_2122);
  assert.deepEqual(t, f);
  assert.equal(formatDocument({ blocks: [G2122] }, { ...OPTS, translatePos }), formatDocument({ blocks: [G2122] }, OPTS));
});
test('21.6.3c: the glossary\'s foreign alphabet signs go on the Special Symbols page with the option off; other foreign text does not', () => {
  const blocks = [para([fr('très')]), G2122];
  const got = collectSpecialSymbols(blocks, OPTS).map((e) => [e.braille, e.description, e.kind]);
  assert.deepEqual(got, [[']', 'n tilde (Spanish)', 'foreign'], ['/', 'i acute (Spanish)', 'foreign']]);   // not French è (a paragraph, 1.16.2)
  const brf = formatDocument({ blocks: [...blocks, { type: 'sympage', matter: 'transcriber', auto: true }] }, OPTS);
  assert.match(brf, /\.=\/ I ACUTE "<,SPANI%">/);
  assert.match(brf, /\.=\] ;N TILDE "<,SPANI%">/);
});

// ---------------------------------------------------------------------------------------------------------------
test('RUEB 13.2.2: no grade 1 indicators in foreign material; numeric mode keeps its own', () => {
  assert.deepEqual(lines(on(doc1(fr('Y a-t-il')))), [',Y A-T-IL']);
  assert.deepEqual(lines(doc1(fr('Y a-t-il'))), [';,Y A-;T-IL']);
  assert.deepEqual(lines(on(doc1(es('y los jinetes')))), ['Y LOS JINETES']);
  assert.deepEqual(lines(on(doc1(de('am 12e')))), ['AM #AB;E']);            // the ; after a number is not a grade 1 indicator for a letter
});
test('an ASCII quote next to a foreign word is the ordinary quotation mark (not the nonspecific ,7)', () => {
  assert.deepEqual(lines(on(doc1(txt('He said "'), es('hola'), txt('".')))), [',HE SD 8HOLA04']);
  assert.deepEqual(lines(on(doc1(txt('He said "'), es('tenemos'), txt('".')))), [',HE SD 8TENEMOS04']);   // uncontracted, and 8 ... 0 not ,7
});
test('5.4.4: a foreign word part and a lone foreign letter keep their font attributes, uncontracted, foreign alphabet', () => {
  assert.deepEqual(lines(on(doc1(txt('The suffix '), es('-ción', { tf: 1 }), txt(' and the letter '), es('ñ', { tf: 4 }), txt('.')))),
    [',! SU6IX .1-CI+N & ! LR ^2]4']);
  assert.deepEqual(lines(doc1(txt('The suffix '), es('-ción', { tf: 1 }), txt(' and the letter '), es('ñ', { tf: 4 }), txt('.'))),
    [',! SU6IX .1-CI^/ON & ! LR ^2^]N4']);
});
// A language Appendix D does not cover. BANA's "Provisional Guidance for Transcribing Foreign Language Material in UEB"
// (May 2015; the guidance Appendix D's heading names) Method 3 - foreign signs for accented letters in foreign-language
// textbooks and bilingual dictionaries - takes the signs from World Braille Usage (3rd ed., 2013; RUEB 13.6.2).
test('Portuguese (World Braille Usage 3rd ed. p. 197): the Portuguese alphabet signs, uncontracted; Latin: UEB modifiers', () => {
  // WBU: ç 12346 & | á 12356 ( | é 123456 = | í 34 / | ó 346 + | ú 23456 ) | à 1246 $ | â 16 * | ê 126 < | ô 1456 ? | ã 345 > | õ 246 [ | ü 1256 \
  assert.deepEqual(lines(on(doc1(txt('Você não está ótimo à mão; ação, põe, avô, céu, índio, açúcar, cinqüenta, pâncreas.', { lang: 'pt' })))), [
    ',VOC< N>O EST( +TIMO $ M>O2 A&>O1 P[E1',
    'AV?1 C=U1 /NDIO1 A&)CAR1 CINQ\\ENTA1',
    'P*NCREAS4',
  ]);
  // option off, outside a glossary: incidental words, contracted with UEB modifiers (1.16.2) - unchanged
  assert.deepEqual(lines(doc1(txt('você e ele', { lang: 'pt-BR' }))), ['VOC^%E ;E ELE']);
  // A language with no braille code of its own in World Braille Usage (Latin: RUEB 13.4.1's "foreign code signs used in
  // braille production in the country where the language is spoken" cannot apply): uncontracted, UEB modifiers (RUEB
  // 13.5; the Guidance's Method 2). Macron = @- (UEB 4.2).
  assert.deepEqual(lines(on(doc1(txt('rosā amīcus et puella', { lang: 'la' })))), ['ROS@-A AM@-ICUS ET PUELLA']);
});

// ---------------------------------------------------------------------------------------------------------------
// 8.10 / 10.1.6c
const FOREIGN_EX = { type: 'list', kind: 'exercise', items: [{ marker: 'a.', segments: [es('el perro')] }, { marker: 'b.', segments: [es('la casa')] }] };
const ENGLISH_LIST = { type: 'list', items: [{ marker: 'a.', text: 'the dog' }, { marker: 'b.', text: 'the house' }] };
test('8.10 / 10.1.6c: every itemized list foreign - no grade 1 indicator on the identifying letters', () => {
  assert.deepEqual(lines(on({ blocks: [FOREIGN_EX] })), ['A4 EL PERRO', 'B4 LA CASA']);
  assert.deepEqual(lines({ blocks: [FOREIGN_EX] }), ['A4 EL P]RO', ';B4 LA CASA']);
});
test('8.10 / 10.1.6c: English and foreign lists mixed - all identifying letters English, and a transcriber\'s note is offered', () => {
  const d = { blocks: [FOREIGN_EX, ENGLISH_LIST] };
  assert.deepEqual(lines(on(d)), ['A4 EL PERRO', ';B4 LA CASA', 'A4 ! DOG', ';B4 ! H\\SE']);
  assert.ok(suggestTranscriberNotes(d.blocks, { ...OPTS, foreignText: true }).some((s) => s.id === 'foreign-list-letters' && s.provisional));
  assert.ok(!suggestTranscriberNotes(d.blocks, OPTS).some((s) => s.id === 'foreign-list-letters'));
  assert.ok(!suggestTranscriberNotes([FOREIGN_EX], { ...OPTS, foreignText: true }).some((s) => s.id === 'foreign-list-letters'));
});

// ---------------------------------------------------------------------------------------------------------------
test('Special Symbols page: the foreign alphabet signs used, in braille order, PROVISIONAL wording', () => {
  const blocks = [para([es('más')]), para([fr('très')]), para([de('Größe')]), para([txt('você', { lang: 'pt' })])];
  const got = collectSpecialSymbols(blocks, { ...OPTS, foreignText: true }).map((e) => [e.braille, e.description, e.kind]);
  assert.deepEqual(got, [['(', 'a acute (Spanish)', 'foreign'], ['!', 'e grave (French); ess-tsett (German)', 'foreign'], ['<', 'e circumflex (Portuguese)', 'foreign'], ['[', 'o umlaut (German)', 'foreign']]);
  assert.deepEqual(collectSpecialSymbols(blocks, OPTS), []);
  const brf = formatDocument({ foreignText: true, blocks: [...blocks, { type: 'sympage', matter: 'transcriber', auto: true }] }, OPTS);
  assert.match(brf, /\.=\( A ACUTE "<,SPANI%">/);
  assert.match(brf, /\.=\[ O UMLAUT "<,G]MAN">/);
});

// ---------------------------------------------------------------------------------------------------------------
test('1.16.4: with foreignTitle the running head and the page-1 title are foreign; without, English', () => {
  const body = Array.from({ length: 30 }, (_, i) => para([txt('Line ' + i)]));
  const d = { title: 'Así se dice', blocks: [para([es('¿Cómo estás?')]), ...body] };
  const heads = (doc) => pages(doc, { suppressHeader: false }).map((pg) => pg[0].trim());
  assert.deepEqual(heads({ ...on(d), foreignTitle: true }).slice(0, 2), [',AS/ SE DICE', ',AS/ SE DICE']);
  assert.deepEqual(heads(on(d)).slice(0, 2), [',AS^/I SE DICE', ',AS^/I SE DICE']);
  assert.deepEqual(heads({ ...d, foreignTitle: true }).slice(0, 2), [',AS^/I SE DICE', ',AS^/I SE DICE']);   // needs foreignText too
});

// ---------------------------------------------------------------------------------------------------------------
test('field registry: foreignText / foreignTitle are transcriber document options, off by default, saved as <meta>', () => {
  for (const [key, meta] of [['foreignText', 'bana-foreign-text'], ['foreignTitle', 'bana-foreign-title']]) {
    const f = R.FIELDS.find((x) => x.key === key);
    assert.ok(f, key);
    assert.deepEqual(f.where, ['doc']);
    assert.equal(f.default, false);
    assert.equal(f.audience, 'transcriber');
    assert.equal(f.save[0].meta, meta);
  }
});
test('cache key: the option is part of getBlockSignature', () => {
  const b = LESSON.blocks[1];
  assert.notEqual(getBlockSignature(b, { ...OPTS, foreignText: true }, false), getBlockSignature(b, OPTS, false));
});
