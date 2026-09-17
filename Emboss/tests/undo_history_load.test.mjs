// Undo after loading a document (G7). Two faults made undo show an empty "Table of
// Contents": (1) the wrappers around Lexical's static importJSON called the inherited
// LexicalNode.importJSON (nodes declared with $config() have none of their own), which
// throws — so every undo/redo snapshot lost the document from the first list onwards;
// (2) a load did not reset the history, so undo stepped back into the previous document.
// editor.mjs cannot be imported headless, so this checks the source (verified in Chrome).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ed = fs.readFileSync(path.join(here, '..', 'web', 'editor', 'editor.mjs'), 'utf8');

test('importJSON wrappers only call a class\'s own importJSON', () => {
  assert.match(ed, /const ownImportJSON = \(Klass\) => \(Object\.prototype\.hasOwnProperty\.call\(Klass, 'importJSON'\)/);
  for (const [v, K] of [['Para', 'ParagraphNode'], ['List', 'ListNode'], ['Item', 'ListItemNode'], ['Heading', 'HeadingNode']]) {
    assert.match(ed, new RegExp(`const orig${v}ImportJSON = ownImportJSON\\(${K}\\);`), `${K} capture`);
    assert.match(ed, new RegExp(`orig${v}ImportJSON \\? orig${v}ImportJSON\\.call\\(this, serializedNode\\)`), `${K} call is bound`);
  }
  assert.doesNotMatch(ed, /= [A-Za-z]+Node\.importJSON;/, 'no raw capture of an inherited importJSON');
});

test('loading a document makes it the undo floor', () => {
  assert.match(ed, /resetUndoHistory = \(\) => \{[\s\S]{0,300}historyStack\.length = 0;[\s\S]{0,80}historyIndex = -1;[\s\S]{0,120}recordHistoryState\('loaded document'\)/);
  assert.match(ed, /markDocumentClean\(\);\n\s*resetUndoHistory\(\);\n\s*announce\(t\('app\.import\.done', \{ name: file\.name \}\)\);/, 'file import');
  assert.match(ed, /refreshToolbar\(\);\n\s*markDocumentClean\(\);\n\s*resetUndoHistory\(\);/, 'start-up document');
});
