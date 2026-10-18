// A86 (found 30 Sep 2026): the letters next to a subscript or superscript were translated as a word standing alone.
// "H" of H₂O got a grade-1 sign (;,H;5#B,O) and "SO" of H₂SO₄ became the wordsign for "so" (,H;5#B,,S;5#D: the O lost);
// a level sign after a number kept its grade-1 indicator although the numeric indicator had already set grade 1 mode
// (3² brailled #C;9#B, the UKAAF gold has #C9#B), and a letter a-j after a numeric script read as a further digit.
// Expected braille below is copied from the Rules of Unified English Braille 2024 (3.24.1, 5.6, 6.5, 11.4.2, 11.4.3)
// and the UKAAF gold corpus (corpus/ukaaf/sample3.brf, sample7-intermediate-maths.brf).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { styledTranslate, SCRIPT_MARKS as M } from '../format/text-style.mjs';

const EMBOSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const louis = await import(path.join(EMBOSS, 'engine', 'louis.mjs'));
await louis.init(path.join(EMBOSS, 'liblouis', 'tables'));
const g2 = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const g1 = (t, tf) => louis.translate(t, louis.TABLES.uebG1, tf || null);
const tr = styledTranslate(g2, 'faithful', g1);
// "_x" / "_{..}" subscript, "^x" / "^{..}" superscript
const S = (s) => s.replace(/_\{([^}]*)\}/g, M.subOpen + '$1' + M.end).replace(/\^\{([^}]*)\}/g, M.supOpen + '$1' + M.end)
  .replace(/_(\w)/g, M.subOpen + '$1' + M.end).replace(/\^(\w)/g, M.supOpen + '$1' + M.end);

test('RUEB 3.24.1 examples', () => {
  assert.equal(tr(S('W^m')), ',W;9M');                       // a letter as the script is not standing alone either
  assert.equal(tr(S('H_2O')), ',H;5#B,O');
  assert.equal(tr(S('3 yd^3')), '#C YD;9#C');
  assert.equal(tr(S('4m^2')), '#DM9#B');                     // grade 1 mode from the number: no grade-1 indicator
  assert.equal(tr(S('vitamin B_{12}')), 'VITAM9 ,B;5#AB');
  assert.equal(tr(S('born in 1682.^3')), 'BORN 9 #AFHB49#C');
  assert.equal(tr(S('born in 1982.^c')), 'BORN 9 #AIHB49C');
  assert.equal(tr(S('America^3')), ',AM]ICA;9#C');
  assert.equal(tr(S('an earthquake measuring 6.5M_W')), 'AN E>?QUAKE M1SUR+ #F4E,M5,W');
  assert.equal(tr(S('the clarion^1 horn')), '! CL>ION;9#A HORN');
});

test('RUEB 11.4.2 and 11.4.3 examples', () => {
  assert.equal(tr(S('The area is 6 m^2')), ',! >EA IS #F M;9#B');
  assert.equal(tr(S('The points P_1 and P_2')), ',! PO9TS ,P;5#A & ,P;5#B');
  assert.equal(tr(S('Smith wrote a paper^{56} which says')), ',SMI? WROTE A PAP];9#EF : SAYS');
  assert.equal(tr(S('The formula for water is H_2O')), ',! =MULA = WAT] IS ,H;5#B,O');
  assert.equal(tr(S('x^2y')), 'X;9#BY');
  assert.equal(tr(S('x^{2y}')), ';;X9<#BY>');
});

test('UKAAF gold', () => {
  assert.equal(tr(S('limiting CO_2 emissions')), 'LIMIT+ ,,CO;5#B EMIS.NS');   // sample3.brf
  assert.equal(tr(S('3^2')), '#C9#B');                                          // sample7-intermediate-maths.brf
});

test('letters are never read as a wordsign or a digit next to a script', () => {
  assert.equal(tr(S('H_2SO_4')), ',H;5#B,,SO5#D');           // SO, not the wordsign "so"; grade 1 mode from the 2 (6.5.1)
  assert.equal(tr(S('Fe_2O_3')), ',FE;5#B,O5#C');
  assert.equal(tr(S('x_2a')), 'X;5#B;A');                    // a-j after a digit takes the grade-1 indicator (6.5.2)
  assert.equal(tr(S('so_4 so')), 'SO;5#D S');                // the second "so" does stand alone
  assert.equal(tr(S('x^2 + y^2')), 'X;9#B "6 Y;9#B');         // a space ends grade 1 mode
});

test('text with no script markers is translated exactly as before', () => {
  for (const t of ['The H is here', 'so it goes', '3 men', 'x + y']) assert.equal(tr(t), g2(t));
});
