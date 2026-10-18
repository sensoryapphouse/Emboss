// Feedback 30 Sep 2026, item 8 (Paul, 1 Oct): a Word picture with no alt text was described in braille by its object name — for
// the tester's logo "ACMA_LOGO_BLACK_55mm" (the image file's name), so the note read "Illustration: ACMA_LOGO_BLACK_55mm". A name
// that looks like a file name (no spaces, with an underscore or an image file extension) is no more a description than Word's
// automatic "Picture 3": the picture is undescribed, and the editor asks for a description. A real name an author gave stays.
// One rule for the .docx reader (parse.mjs docxParagraphImages) and the .doc reader (doc-art.mjs makeImage).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pictureNameAsAlt } from '../input/doc-art.mjs';

test('Word\'s automatic names and file-like names are not descriptions', () => {
  for (const n of ['Picture 3', 'Image 2', 'Graphic 1', 'Grafik 4', 'ACMA_LOGO_BLACK_55mm', 'logo.png', 'IMG_2041.JPG', 'scan_page_3', 'diagram.svg', 'photo.jpeg', '']) assert.equal(pictureNameAsAlt(n), '', n);
});
test('a name an author gave is kept', () => {
  for (const n of ['Company logo', 'Map of the river', 'Diagram', 'Figure 2 water cycle']) assert.equal(pictureNameAsAlt(n), n, n);
});
