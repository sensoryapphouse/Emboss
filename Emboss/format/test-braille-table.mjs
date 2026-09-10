// Gate for web/braille-table.mjs + settings.effectiveMathCode: the one place that
// decides which liblouis table list is in force and normalises its output to BRF ASCII.
// Pins the 2026-09-02 audit findings: the 142 codes in Translate/braille-codes.mjs are
// listed with unicode.dis, so Quick Mode's .brf download carried Unicode braille
// (4,644 non-ASCII bytes in a 4,947-byte sample1.brf); the editor ignored the code
// entirely; and BANA+default maths code disagreed between render and rule-info.
import path from 'path';
import * as louis from '../engine/louis.mjs';
import { resolveTable, makeTranslators, UEB_TABLES, isUnicodeTable } from '../web/braille-table.mjs';
import { effectiveMathCode, sanitizeSettings } from '../web/settings.mjs';
import { CODES } from '../Translate/braille-codes.mjs';

await louis.init(path.join(process.cwd(), 'liblouis', 'tables'));
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('  ❌', msg); } };
const BRF_RE = /^[\x20-\x5f\r\n\f]*$/;   // NABCC printable range + line/page controls

// resolveTable
ok(resolveTable({ grade: 'g2' }) === UEB_TABLES.g2, 'no code + g2 → UEB g2');
ok(resolveTable({ grade: 'g1' }) === UEB_TABLES.g1, 'no code + g1 → UEB g1');
ok(resolveTable({ brailleCode: 'nonsense', grade: 'g1' }) === UEB_TABLES.g1, 'unknown code falls back by grade');
const fr = CODES.find((c) => c.id === 'fr-bfu-g2');
ok(fr && resolveTable({ brailleCode: 'fr-bfu-g2' }) === fr.table, 'known code → its own table list');
ok(isUnicodeTable(fr.table) && !isUnicodeTable(UEB_TABLES.g2), 'unicode.dis detection');

// makeTranslators: every CODES table yields BRF ASCII, identical dots to the raw output
const text = 'Knowledge is power. 12 dogs, "quoted" — José.';
const en = makeTranslators(louis, CODES.find((c) => c.id === 'en-ueb-g2').table);
const enBrf = en.translate(text);
ok(BRF_RE.test(enBrf), `en-ueb-g2 via unicode.dis is BRF ASCII: ${JSON.stringify(enBrf)}`);
ok(enBrf === louis.translate(text, UEB_TABLES.g2), 'unicode.dis + conversion == en-us-brf.dis output');
const frTr = makeTranslators(louis, fr.table);
const frBrf = frTr.translate('Le savoir est une force.');
ok(BRF_RE.test(frBrf) && frBrf.length > 5, `fr-bfu-g2 output is BRF ASCII: ${JSON.stringify(frBrf)}`);
ok(frBrf !== en.translate('Le savoir est une force.'), 'French table differs from English');
// translatePos keeps its map aligned (one cell per char)
const p = en.translatePos('hello world');
ok(p.braille === en.translate('hello world') && p.inputPos.length === p.braille.length, 'translatePos braille == translate, map aligned');
// backTranslate accepts the BRF we emit, for a unicode.dis table too
ok(/knowledge is power/i.test(en.backTranslate(en.translate('Knowledge is power.'))), 'round trip through unicode.dis table');
ok(/savoir/i.test(frTr.backTranslate(frBrf)), 'French round trip');
// 8-dot computer code: dots 7/8 masked, still ASCII
const ru = CODES.find((c) => /^ru-/.test(c.id));
if (ru) ok(BRF_RE.test(makeTranslators(louis, ru.table).translate('Знание сила')), `8-dot/other script (${ru.id}) still BRF ASCII`);

// effectiveMathCode: explicit choice wins, else follows the layout standard
ok(effectiveMathCode({ mathCode: 'auto', mode: 'bana' }) === 'nemeth', 'auto + BANA → Nemeth');
ok(effectiveMathCode({ mathCode: 'auto', mode: 'ukaaf' }) === 'ueb', 'auto + UKAAF → UEB');
ok(effectiveMathCode({ mathCode: 'ueb', mode: 'bana' }) === 'ueb', 'explicit UEB under BANA stays UEB');
ok(effectiveMathCode({ mathCode: 'nemeth', mode: 'ukaaf' }) === 'nemeth', 'explicit Nemeth under UKAAF stays Nemeth');
ok(sanitizeSettings({ mathCode: 'bogus' }).mathCode === 'auto', 'sanitize: unknown mathCode → auto');
ok(sanitizeSettings({}).mathCode === 'auto', 'sanitize: default mathCode is auto');
ok(sanitizeSettings({ statusScale: 9 }).statusScale === 2.5, 'sanitize: statusScale clamped');

console.log(`\nbraille-table gate: ${pass}/${pass + fail} checks pass`);
process.exit(fail ? 1 : 0);
