// Document model for UKAAF corpus Sample 7a ("UEB: Example of Mathematics
// Notation (with UK Maths Code Version for Comparison)"), built from
// corpus/ukaaf/sample7a-simple-maths-print.pdf. 38x27 geometry (the one
// sample with a non-standard page depth), and — unlike every other sample —
// has NO "Sample N"/Note front-matter block at all; it starts directly with
// its own title.
//
// OUT-OF-SCOPE per the task brief (maths module gated separately). This
// sample is a derivation of the quadratic formula shown twice: once in UEB
// technical notation, once in UK Maths Code, for direct comparison — a
// significantly different, dual-notation presentation this pipeline's
// `math` block (single notation per mode) doesn't attempt to reproduce.
// Included only to exercise the pipeline without crashing at 38x27.
export function sample7a() {
  return {
    title: 'UEB: Example of Mathematics',
    blocks: [
      { type: 'title', text: 'UEB: Example of Mathematics' },
      { type: 'title', text: 'Notation (with UK Maths Code Version for Comparison)' },
      { type: 'heading', level: 2, text: 'UEB Brl Version:' },
      { type: 'para', text: 'Deriving the Quadratic Formula' },
      { type: 'para', text: 'This is the original equation.' },
      { type: 'math', mathml: '<math><mrow><mi>a</mi><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mi>b</mi><mi>x</mi><mo>+</mo><mi>c</mi><mo>=</mo><mn>0</mn></mrow></math>' },
      { type: 'para', text: 'Move the loose number to the other side.' },
      { type: 'para', text: 'Taken from http://www.purplemath.com/modules/sqrquad2.htm' },
    ],
  };
}
