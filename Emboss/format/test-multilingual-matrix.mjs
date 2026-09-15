// Multi-Lingual & Non-Latin 142-Code Matrix Test Suite
// Validates Liblouis translation across Cyrillic, Greek, Hebrew, Arabic, Devanagari,
// East Asian, and European accented languages with BANA and UKAAF layouts.

import path from 'path';
import { fileURLToPath } from 'url';
import * as louis from '../engine/louis.mjs';
import { formatDocument } from './document.mjs';
import { styledTranslate } from './text-style.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

let pass = 0, fail = 0;
const errors = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  ❌ FAIL: ${name} ${detail ? '— ' + detail : ''}`);
    errors.push({ name, detail });
  }
}

console.log('='.repeat(80));
console.log('MULTI-LINGUAL & NON-LATIN BRAILLE CODE MATRIX TEST SUITE');
console.log('='.repeat(80) + '\n');

await louis.init(path.join(projectRoot, 'liblouis', 'tables'));

// Helper to clean line of CR and FF
const maxLineLen = (brf) => Math.max(...brf.split(/\r?\n/).map(l => l.replace(/[\r\x0c]/g, '').length));

// ----------------------------------------------------------------------------
// 1. Non-Latin Scripts: Cyrillic, Greek, Arabic, Hebrew, Hindi, Chinese
// ----------------------------------------------------------------------------
console.log('1. Testing Non-Latin Scripts...');

// Russian Cyrillic
const ruTranslate = (t) => louis.translate(t, '/tables/en-us-brf.dis,/tables/ru-litbrl.ctb');
const ruDoc = {
  title: 'Война и мир',
  blocks: [
    { type: 'heading', level: 1, text: 'Лев Толстой: Война и мир' },
    { type: 'para', text: 'Все счастливые семьи похожи друг на друга, каждая несчастливая семья несчастлива по-своему.' },
    { type: 'para', text: '— Здравствуй, князь! Как ваше здоровье? — спросила Анна Павловна.' }
  ]
};
const ruBrf = formatDocument(ruDoc, { mode: 'bana', width: 38, depth: 25, translate: ruTranslate });
check('Russian Cyrillic generates non-empty BRF', ruBrf.length > 0 && !ruBrf.includes('undefined'));
check('Russian Cyrillic line lengths <= 38', maxLineLen(ruBrf) <= 38, `Max: ${maxLineLen(ruBrf)}`);

// Modern & Ancient Greek
const elTranslate = (t) => louis.translate(t, '/tables/en-us-brf.dis,/tables/el.ctb');
const elDoc = {
  title: 'Ομήρου Οδύσσεια',
  blocks: [
    { type: 'heading', level: 1, text: 'Ομήρου Οδύσσεια' },
    { type: 'para', text: 'Ἄνδρα μοι ἔννεπε, Μοῦσα, πολύτροπον, ὃς μάλα πολλὰ πλάγχθη.' },
    { type: 'para', text: 'Καλημέρα κόσμε! Η φιλοσοφία και η επιστήμη είναι θεμέλια του πολιτισμού.' }
  ]
};
const elBrf = formatDocument(elDoc, { mode: 'bana', width: 38, depth: 25, translate: elTranslate });
check('Greek generates non-empty BRF', elBrf.length > 0 && !elBrf.includes('undefined'));
check('Greek line lengths <= 38', maxLineLen(elBrf) <= 38, `Max: ${maxLineLen(elBrf)}`);

// Arabic
const arTranslate = (t) => louis.translate(t, '/tables/en-us-brf.dis,/tables/ar-ar-g1.utb');
const arDoc = {
  title: 'الأدب العربي',
  blocks: [
    { type: 'heading', level: 1, text: 'مقدمة في الأدب العربي' },
    { type: 'para', text: 'العلم نور والجهل ظلام. المعرفة قوة لا يستهان بها في بناء المجتمعات.' },
    { type: 'para', text: 'قال الحكيم: من جد وجد ومن زرع حصد ومن سار على الدرب وصل.' }
  ]
};
const arBrf = formatDocument(arDoc, { mode: 'bana', width: 38, depth: 25, translate: arTranslate });
check('Arabic generates non-empty BRF', arBrf.length > 0 && !arBrf.includes('undefined'));
check('Arabic line lengths <= 38', maxLineLen(arBrf) <= 38, `Max: ${maxLineLen(arBrf)}`);

// Hebrew
const heTranslate = (t) => louis.translate(t, '/tables/en-us-brf.dis,/tables/he-IL.utb');
const heDoc = {
  title: 'ספר בראשית',
  blocks: [
    { type: 'heading', level: 1, text: 'בראשית פרק א' },
    { type: 'para', text: 'בְּרֵאשִׁית בָּרָא אֱלֹהִים אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ׃' },
    { type: 'para', text: 'וְהָאָרֶץ הָיְתָה תֹהוּ וָבֹהוּ וְחֹשֶׁךְ עַל־פְּנֵי תְהוֹם׃' }
  ]
};
const heBrf = formatDocument(heDoc, { mode: 'bana', width: 38, depth: 25, translate: heTranslate });
check('Hebrew generates non-empty BRF', heBrf.length > 0 && !heBrf.includes('undefined'));
check('Hebrew line lengths <= 38', maxLineLen(heBrf) <= 38, `Max: ${maxLineLen(heBrf)}`);

// Hindi Devanagari
const hiTranslate = (t) => louis.translate(t, '/tables/en-us-brf.dis,/tables/hi-in-g1.utb');
const hiDoc = {
  title: 'हिंदी साहित्य',
  blocks: [
    { type: 'heading', level: 1, text: 'प्रेमचंद की प्रसिद्ध कहानियाँ' },
    { type: 'para', text: 'सत्य और अहिंसा हमारे जीवन के दो महत्वपूर्ण आधार स्तंभ हैं।' },
    { type: 'para', text: 'विद्या ददाति विनयं, विनयाद्याति पात्रताम्।' }
  ]
};
const hiBrf = formatDocument(hiDoc, { mode: 'bana', width: 38, depth: 25, translate: hiTranslate });
check('Hindi Devanagari generates non-empty BRF', hiBrf.length > 0 && !hiBrf.includes('undefined'));
check('Hindi line lengths <= 38', maxLineLen(hiBrf) <= 38, `Max: ${maxLineLen(hiBrf)}`);

// Chinese Mandarin
const zhTranslate = (t) => louis.translate(t, '/tables/en-us-brf.dis,/tables/zh-tw.ctb');
const zhDoc = {
  title: '唐詩三百首',
  blocks: [
    { type: 'heading', level: 1, text: '李白：靜夜思' },
    { type: 'para', text: '床前明月光，疑是地上霜。舉頭望明月，低頭思故鄉。' }
  ]
};
const zhBrf = formatDocument(zhDoc, { mode: 'bana', width: 38, depth: 25, translate: zhTranslate });
check('Chinese Mandarin generates non-empty BRF', zhBrf.length > 0 && !zhBrf.includes('undefined'));
check('Chinese line lengths <= 38', maxLineLen(zhBrf) <= 38, `Max: ${maxLineLen(zhBrf)}`);

// ----------------------------------------------------------------------------
// 2. European Accented Languages: Spanish, French, German, Italian, Portuguese
// ----------------------------------------------------------------------------
console.log('2. Testing European Contracted & Accented Languages...');

// Spanish Grade 2
const esTranslate = (t) => louis.translate(t, '/tables/en-us-brf.dis,/tables/es-g2.ctb');
const esDoc = {
  title: 'Don Quijote',
  blocks: [
    { type: 'heading', level: 1, text: 'Don Quijote de la Mancha' },
    { type: 'para', text: 'En un lugar de la Mancha, de cuyo nombre no quiero acordarme, no ha mucho tiempo que vivía un hidalgo.' },
    { type: 'para', text: '¿Qué gigantes? —dijo Sancho Panza—. ¡Mire vuestra merced que aquellos no son gigantes, sino molinos de viento!' }
  ]
};
const esBrf = formatDocument(esDoc, { mode: 'bana', width: 38, depth: 25, translate: esTranslate });
check('Spanish G2 generates non-empty BRF', esBrf.length > 0);
check('Spanish G2 line lengths <= 38', maxLineLen(esBrf) <= 38, `Max: ${maxLineLen(esBrf)}`);

// French Grade 2
const frTranslate = (t) => louis.translate(t, '/tables/en-us-brf.dis,/tables/fr-bfu-g2.ctb');
const frDoc = {
  title: 'Les Misérables',
  blocks: [
    { type: 'heading', level: 1, text: 'Victor Hugo: Les Misérables' },
    { type: 'para', text: 'Tant qu’il existera, par le fait des lois et des mœurs, une damnation sociale créant artificiellement des enfers...' },
    { type: 'para', text: 'Où vont tous ces enfants dont pas un seul ne rit? Ces doux êtres pensifs que la fièvre maigrit?' }
  ]
};
const frBrf = formatDocument(frDoc, { mode: 'bana', width: 38, depth: 25, translate: frTranslate });
check('French G2 generates non-empty BRF', frBrf.length > 0);
check('French G2 line lengths <= 38', maxLineLen(frBrf) <= 38, `Max: ${maxLineLen(frBrf)}`);

// German Grade 2
const deTranslate = (t) => louis.translate(t, '/tables/en-us-brf.dis,/tables/de-g2.ctb');
const deDoc = {
  title: 'Faust',
  blocks: [
    { type: 'heading', level: 1, text: 'Johann Wolfgang von Goethe: Faust' },
    { type: 'para', text: 'Habe nun, ach! Philosophie, Juristerei und Medizin, und leider auch Theologie durchaus studiert, mit heißem Bemühn.' },
    { type: 'para', text: 'Zwei Seelen wohnen, ach! in meiner Brust, die eine will sich von der andern trennen.' }
  ]
};
const deBrf = formatDocument(deDoc, { mode: 'bana', width: 38, depth: 25, translate: deTranslate });
check('German G2 generates non-empty BRF', deBrf.length > 0);
check('German G2 line lengths <= 38', maxLineLen(deBrf) <= 38, `Max: ${maxLineLen(deBrf)}`);

// ----------------------------------------------------------------------------
// 3. Multi-Lingual Mixed-Script Foreign Language Textbook Passages
// ----------------------------------------------------------------------------
console.log('3. Testing Multi-Lingual Mixed Passages in UEB Grade 2...');

const uebG2Translate = styledTranslate((t, tf) => louis.translate(t, louis.TABLES.uebG2, tf), 'faithful');

const mixedLangDoc = {
  title: 'Comparative Linguistics & World Literature Textbook',
  blocks: [
    { type: 'heading', level: 1, text: 'Chapter 5: World Idioms & Polyglot Literature' },
    { type: 'para', text: 'English translation of famous proverbs around the globe:' },
    { type: 'list', items: [
      { text: 'French: "C\'est la vie" (That is life) and "L\'habit ne fait pas le moine" (Clothes do not make the monk).' },
      { text: 'Spanish: "A caballo regalado no se le mira el diente" and "Más vale pájaro en mano que ciento volando".' },
      { text: 'German: "Aller Anfang ist schwer" and "Übung macht den Meister".' },
      { text: 'Italian: "La speranza è l\'ultima a morire" and "Chi dorme non piglia pesci".' },
      { text: 'Latin: "Carpe diem, quam minimum credula postero" (Horace, Odes 1.11).' },
      { text: 'Greek phrase: Gnosis seauton (Know thyself, Delphic maxim).' }
    ]},
    { type: 'sidebar', text: 'Polyglot Note: Accents such as acute (é), grave (è), circumflex (ê), umlaut (ü/ö), cedilla (ç), and tilde (ñ) are preserved across all language modes.' }
  ]
};

const mixedBrf = formatDocument(mixedLangDoc, { mode: 'bana', width: 38, depth: 25, translate: uebG2Translate, braillePageNumbers: true });
check('Mixed multi-lingual textbook formats successfully', mixedBrf.length > 0);
check('Mixed multi-lingual line lengths <= 38', maxLineLen(mixedBrf) <= 38, `Max: ${maxLineLen(mixedBrf)}`);

// Summary
console.log('\n' + '='.repeat(80));
console.log(`MULTI-LINGUAL MATRIX RESULTS: ${pass} PASSED, ${fail} FAILED`);
console.log('='.repeat(80));

if (fail > 0) {
  console.error('Errors:', errors);
  process.exit(1);
}
