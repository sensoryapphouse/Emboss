// Document model for UKAAF corpus Sample 2 ("Traditional English Trifle"),
// built from corpus/ukaaf/sample2-print.pdf. Notes on things deliberately
// NOT modelled (see test-corpus.mjs categorize + the final report):
//  - The byline "by Rick Stein" and source line "from Food Heroes" (the
//    latter italicised in gold, book-title style) are modelled as plain
//    paragraph-ish lines; italic typeform is OUT-OF-SCOPE (R15: UEB typeform
//    indicators are a nice-to-have, not a formatting-correctness rule, and
//    B004 §5 explicitly says not to slavishly reproduce print emphasis).
//  - "For the madeira cake:" / "For the topping:" sub-headers are rendered
//    in gold with italic-passage indicators (.7 ... .'); modelled here as
//    heading level 3 (cell 3) text, since that's the closest structural
//    equivalent without inventing an "italic passage" block type.
export function sample2() {
  return {
    title: 'Traditional English Trifle',
    blocks: [
      { type: 'title', text: 'Traditional English Trifle' },
      { type: 'title', text: 'by Rick Stein' },
      { type: 'title', text: 'from Food Heroes' },
      { type: 'para', text: 'Serves 8' },
      { type: 'para', text: 'Preparation time 30 mins to 1 hour' },
      { type: 'para', text: 'Cooking time 30 mins to 1 hour' },
      { type: 'heading', level: 1, text: 'Ingredients' },
      { type: 'heading', level: 3, text: 'For the madeira cake:' },
      {
        type: 'list', items: [
          { text: '85 g/3 oz butter, at room temperature' },
          { text: '85 g/3 oz caster sugar' },
          { text: '2 medium eggs' },
          { text: '125 g/4½ oz self-raising flour' },
          { text: '3 tbsp full-cream milk' },
          { text: '½ lemon, finely grated zest only' },
        ],
      },
      { type: 'heading', level: 3, text: 'For the topping:' },
      {
        type: 'list', items: [
          { text: '330 ml/10 fl oz full cream milk' },
          { text: '750 ml/1¼ pints double cream' },
          { text: '6 large egg yolks' },
          { text: '1 rounded tbsp cornflour' },
          { text: '4 tbsp caster sugar' },
          { text: '4 tbsp good-quality raspberry jam' },
          { text: '6 tbsp Oloroso (sweet) sherry' },
        ],
      },
      { type: 'heading', level: 1, text: 'Method' },
      // Gold renders each numbered step as an ordinary 3-1 paragraph (the
      // print numeral kept as literal text), NOT as a `list` block — unlike
      // the plain ingredient lists above, these are full sentences/steps in
      // running prose, matching B004 §9's guidance that numbered steps in
      // continuous text are paragraphs, while true lists are short items.
      // NB "180°C/350°F": the print PDF's text layer has lost the degree
      // sign (pdftotext extraction shows plain "180C/350F", no non-ASCII
      // char at all), but gold's braille clearly has the degree sign (^J)
      // before both C and F -- the original transcriber's source evidently
      // had proper "180°C/350°F". Restored here for a faithful model; see
      // the final report (print-source fidelity gap, not an engine bug).
      { type: 'para', text: '1. Preheat the oven to 180°C/350°F/Gas 4. Grease a 450 g/1 lb loaf tin, line the base with greaseproof paper and grease the paper.' },
      { type: 'para', text: '2. Cream the butter and sugar together in a bowl until pale and fluffy. Beat in the eggs one at a time, beating the mixture well between each one and adding a tablespoon of the flour with the last egg to prevent the mixture curdling.' },
      { type: 'para', text: '3. Sift over the flour and gently fold it in, with enough milk to give a mixture that falls reluctantly from the spoon. Fold in the lemon zest.' },
      { type: 'para', text: '4. Spoon the mixture into the prepared tin, level the top and bake for 30-45 minutes until a skewer inserted in the centre comes out clean.' },
      { type: 'para', text: '5. Cool in the tin for ten minutes then turn out on to a wire rack and leave to cool completely. The cake can be made up to four days in advance and kept tightly wrapped in clingfilm.' },
      { type: 'para', text: '6. For the custard, bring the milk and 300 ml/10 fl oz of the cream to the boil in a non-stick pan. Beat the egg yolks, cornflour and sugar together in a bowl, then gradually whisk in the hot milk and cream.' },
      { type: 'para', text: '7. Return the mixture to the pan and cook over a low heat, stirring constantly, for about ten minutes, until the mixture has thickened enough to coat the back of a spoon. Take care not to let it boil as it will curdle.' },
      { type: 'para', text: '8. Transfer the custard to a bowl and leave to cool.' },
      { type: 'para', text: '9. Cut the madeira cake into slices one centimetre (half an inch) thick and arrange a single layer over the base of the bowl. Spread the layer with two tablespoons of raspberry jam and lay another layer of cake on top (you might not need to use all the cake).' },
      { type: 'para', text: '10. Spread the second layer with another two tablespoons of raspberry jam and sprinkle over the sherry.' },
      { type: 'para', text: '11. Pour the custard over the cake, cover with clingfilm and chill for at least three hours.' },
      { type: 'para', text: '12. Whip the remaining cream into soft peaks. Uncover the trifle, spoon over the cream and return it to the fridge until you are ready to serve.' },
    ],
  };
}
