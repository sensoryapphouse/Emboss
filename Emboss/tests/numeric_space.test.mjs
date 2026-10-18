// Import fix list #55 (b) (found 1 Oct 2026; Paul, 1 Oct: fix before the deploy): a number whose digit groups are separated by a
// no-break space (34 432 567, BANA 11.6.5 / UEB numeric space) was brailled #CD #DCB #EFG in the editor and Quick Mode — three
// numbers — because the text clean-up (normalizeTextAndTypeform) turned every no-break space into an ordinary space before
// liblouis saw it; liblouis on its own gives the numeric space, #CD"DCB"EFG. A no-break, narrow no-break, thin or figure space
// between two digits now reaches liblouis as a no-break space (the numeric space); anywhere else it is still an ordinary space.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { styledTranslate, styledTranslatePos, normalizeTextAndTypeform } from '../format/text-style.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const louis = await import('../engine/louis.mjs');
await louis.init(path.join(HERE, '..', 'liblouis', 'tables'));
const raw = (t, tf) => louis.translate(t, louis.TABLES.uebG2, tf || null);
const tr = styledTranslate(raw, 'faithful');
const trPos = styledTranslatePos((t, tf) => louis.translatePos(t, louis.TABLES.uebG2, tf || null), 'faithful');

test('digit groups separated by a no-break, narrow, thin or figure space keep the numeric space', () => {
  for (const sp of [' ', ' ', ' ', ' ']) {
    assert.equal(tr(`34${sp}432${sp}567`), '#CD"DCB"EFG', `U+${sp.codePointAt(0).toString(16)}`);
    assert.equal(tr(`1${sp}000${sp}000 people`), '#A"JJJ"JJJ P', `U+${sp.codePointAt(0).toString(16)}`);
  }
});

test('anywhere else those spaces are ordinary spaces, as before', () => {
  assert.equal(tr('page 1'), 'PAGE #A');
  assert.equal(tr('10 km'), '#AJ KM');
  assert.equal(tr('34 432 567'), '#CD #DCB #EFG', 'an ordinary space between numbers is not a numeric space');
  assert.equal(normalizeTextAndTypeform('a b').text, 'a b');
});

test('the editor\'s position trace gives the same braille, one position per cell', () => {
  const t = 'It costs 1 000 000 dollars.';
  const r = trPos(t);
  assert.equal(r.braille, tr(t));
  assert.equal(r.inputPos.length, r.braille.length);
});
