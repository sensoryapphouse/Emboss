// Document model for UKAAF corpus Sample 7 ("Simple Maths" / intermediate
// maths — fractions, squares/square roots), built from
// corpus/ukaaf/sample7-intermediate-maths-print.pdf.
//
// OUT-OF-SCOPE per the task brief (maths is a separate, later module per
// SETUP_AND_VALIDATION.md §2 scope boundary and BUILD_LOG's phased plan).
// pdftotext extraction shows the equations as blank gaps (they're OMML/
// image content, not extractable text), so a faithful text-only model would
// be mostly gaps; only the surrounding narrative sentences are included
// here, enough to exercise the pipeline (incl. the `math`-block code path
// via a couple of representative MathML fragments run through the Node
// maths helper) without asserting a line-for-line match against gold, which
// would require full OMML->MathML extraction from the original .docx (not
// available — only the print PDF and gold BRF are in the corpus).
export function sample7() {
  return {
    title: 'Simple Maths',
    blocks: [
      { type: 'title', text: 'Simple Maths' },
      { type: 'heading', level: 2, text: 'Fractions' },
      { type: 'para', text: 'In a fraction such as the top number, 3, is called the numerator and the bottom number, 5, is called the denominator.' },
      { type: 'para', text: 'In a proper fraction the numerator is smaller than the denominator, for example.' },
      { type: 'para', text: 'In an improper fraction the numerator is larger than the denominator, for example.' },
      { type: 'para', text: 'A mixed number is an integer plus a proper fraction, for example, which means.' },
      { type: 'heading', level: 2, text: 'Changing mixed numbers to improper fractions' },
      { type: 'heading', level: 2, text: 'Changing improper fractions to mixed numbers' },
      { type: 'heading', level: 1, text: 'Squares and square roots' },
      { type: 'para', text: '9, 49, 225 and 1156 are examples of perfect squares.' },
      // Representative inline equation exercised through the real
      // pipeline (OMML->MathML is done upstream by input/omml.mjs; here we
      // supply MathML directly since we only have the print PDF + gold BRF
      // for this sample, not the source .docx).
      { type: 'math', mathml: '<math><msup><mn>3</mn><mn>2</mn></msup></math>' },
    ],
  };
}
