// Document model for UKAAF corpus Sample 6 ("Extract from French Glossary /
// Les Oeufs"), built from corpus/ukaaf/sample6-print.pdf. Each "term: gloss"
// entry is a flat cell-1 line with no wrap/indent/blank lines in gold — this
// isn't any of our existing block types (title/heading/para/list/note), so
// it's modelled as `para` blocks; each one happens to fit on a single line
// at 38 cells so formatPara's 3-1 wrap behaviour never triggers a runover,
// but the FIRST-LINE indent (cell 3) is still applied by formatPara, which
// gold's flush-left glossary format does NOT use — see test-corpus.mjs
// categorize (OUT-OF-SCOPE: no dedicated "glossary/definition list" block
// type exists; each entry's own indent is the only expected diff).
//
// NB the print PDF typesets "term : gloss" (space before the colon too),
// but liblouis only reproduces gold's tight "TERM3GLOSS" cell when there is
// NO space before the colon (verified: "brouillés : scrambled" ->
// "BR\ILL^/ES 3 SCRAMBL$" with an extra cell; "brouillés: scrambled" ->
// "BR\ILL^/ES3 SCRAMBL$", matching gold). Restored the tighter "term:
// gloss" spacing here as the likely original-source form (print-source
// typesetting artifact, same class as the degree-sign/×-sign restorations
// in samples 2/5).
export function sample6() {
  return {
    title: 'Extract from French Glossary',
    blocks: [
      { type: 'title', text: 'Extract from French Glossary' },
      // Print renders this heading "Les Oeufs" (English-style title case),
      // but every one of the 12 body entries below has "Les oeufs" (proper
      // French sentence case, only the first word capitalised) and gold's
      // braille for the heading itself is ",LES OEUFS" (only "Les"
      // capitalised, matching French case) rather than ",LES ,OEUFS" (which
      // is what liblouis produces for a literal "Les Oeufs" — verified
      // against the native oracle). Modelled as proper French case for
      // fidelity; the print PDF's capital O looks like a title-case
      // rendering choice rather than the master text.
      { type: 'title', text: 'Les oeufs' },
      { type: 'para', text: 'Les oeufs brouillés: scrambled eggs' },
      { type: 'para', text: 'Les oeufs cocotte: coddled eggs' },
      { type: 'para', text: 'Les oeufs à la coque: soft-boiled eggs' },
      { type: 'para', text: 'Les oeufs crus: raw eggs' },
      { type: 'para', text: 'Les oeufs durs: hard boiled eggs' },
      { type: 'para', text: 'Les oeufs farcis: stuffed eggs' },
      { type: 'para', text: 'Les oeufs mollets: soft boiled eggs' },
      { type: 'para', text: 'Les oeufs au plat: fried eggs' },
      { type: 'para', text: 'Les oeufs pochés: poached eggs' },
      { type: 'para', text: 'Le blanc d’oeuf: egg white' },
      { type: 'para', text: 'Le jaune d’oeuf: egg yolk' },
      { type: 'para', text: 'L’omelette: omelette' },
    ],
  };
}
