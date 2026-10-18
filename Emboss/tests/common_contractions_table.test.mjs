// The editor's status bar names a word's contractions from COMMON_CONTRACTIONS (web/editor/editor.mjs) when it cannot split the word
// into signs. Every entry must be the cells liblouis's UEB grade 2 table actually uses for that contraction: three were wrong
// (gg as ⠛ = the letter g, character as ⠐⠉, ought as ⠐⠪), so the bar could call any g "gg" (Paul, 3 Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as louis from '../engine/louis.mjs';
import { brfToUnicodeBraille } from '../engine/brf-ascii.mjs';

const EMBOSS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const g2 = (t) => brfToUnicodeBraille(louis.translate(t, louis.TABLES.uebG2));
const g1 = (t) => brfToUnicodeBraille(louis.translate(t, louis.TABLES.uebG1));

const src = fs.readFileSync(path.join(EMBOSS, 'web', 'editor', 'editor.mjs'), 'utf8');
const body = src.match(/const COMMON_CONTRACTIONS = \{([\s\S]*?)\};/)[1];
const entries = [...body.matchAll(/'([^']+)': '([^']+)'/g)].map(([, cell, name]) => ({ cell, name }));

// A word in which the table uses the contraction (the print alone, where it is a word that is brailled with it).
const IN_A_WORD = {
  ch: 'chin', sh: 'ship', th: 'thin', wh: 'whip', ou: 'loud', st: 'stop', ar: 'star', ed: 'red', er: 'her', in: 'tin', en: 'ten',
  ing: 'sing', ow: 'cow', con: 'concern', dis: 'dismiss', ea: 'teach', bb: 'rabbit', ff: 'differ', gg: 'baggage', tion: 'nation',
};

test('COMMON_CONTRACTIONS has its entries', () => assert.ok(entries.length >= 40, `${entries.length} entries`));

for (const { cell, name } of entries) {
  test(`COMMON_CONTRACTIONS: ${cell} = ${name}`, () => {
    const word = IN_A_WORD[name] || name;
    assert.ok(g2(word).includes(cell), `"${word}" is ${g2(word)} in UEB grade 2, which has no ${cell} for ${name}`);
    // and the cells are a contraction, not the letters spelled out (⠛ is just the letter g, not gg)
    assert.ok(!g1(name).includes(cell), `${cell} is part of "${name}" spelled out (${g1(name)}), not its contraction`);
  });
}
