// Document model for UKAAF corpus Sample 8 ("Computer Program Extract (using
// the C language)"), built from corpus/ukaaf/sample8-computer-code-print.pdf.
//
// OUT-OF-SCOPE per the task brief: this sample's whole point is BANA/UKAAF
// "computer code" layout — a literal, UNCONTRACTED (grade 1), cell-1
// transcription of the code block set off by grade-1-passage indicators
// (";;;" ... ";'" — B004/RUEB 10.12.3: "Use uncontracted braille for
// computer material...displayed on separate lines"). There is no `code`
// block type in the document model and none is added here — this model
// only exercises the surrounding title/paragraph prose so the harness can
// confirm the pipeline runs end-to-end without crashing; the code block
// itself is or deliberately NOT modelled/diffed (would need a new block
// type + grade-1 passage support, a real feature, not a bug fix).
export function sample8() {
  return {
    title: 'Computer Program Extract',
    blocks: [
      { type: 'title', text: 'Computer Program Extract' },
      { type: 'title', text: '(using the C language)' },
      { type: 'para', text: 'The “for” loop:' },
      { type: 'para', text: 'Sometimes, it is useful to have sequences of statements as parts of the control section. We can do this by separating the statements by commas; thus:' },
      // The literal code block (/* ... */ comment + for-loop) is
      // deliberately omitted — see the OUT-OF-SCOPE note above.
      { type: 'para', text: 'In this case, the initialization section comprises two assignment-expressions, separated by a comma, to perform two initializations.' },
    ],
  };
}
