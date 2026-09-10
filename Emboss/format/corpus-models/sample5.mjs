// Document model for UKAAF corpus Sample 5 ("Reflexite Ankle/Arm Bands
// MP45", RNIB product instructions), built from corpus/ukaaf/sample5-print.pdf.
// Notes:
//  - "General Description" / "Terms and Conditions of Sale" are centred
//    headings (level 1), matching sample 2's "Ingredients"/"Method".
//  - The roman-numeral sub-list (i)/ii)/iii)/iv)) and the address/contact
//    blocks are each rendered in gold as plain 3-1 paragraphs (the numeral
//    or label kept as literal text) — modelled the same way here, matching
//    the pattern already confirmed in sample 2's numbered Method steps.
//    Gold's address lines actually use a cell-5/runover-1 list style (same
//    B004 §10 Ex2 pattern as sample 2's ingredient list); not modelled for
//    the same reason (transcriber's free choice between two valid list
//    forms, not a rule our formatList needs to default to).
//  - Registered/trademark signs (Reflexite®, Visibly Better™) are UEB
//    symbols handled by liblouis directly from the ® / ™ characters.
export function sample5() {
  return {
    title: 'Reflexite Ankle/Arm Bands',
    blocks: [
      { type: 'title', text: 'Reflexite Ankle/Arm Bands' },
      { type: 'title', text: 'MP45' },
      { type: 'para', text: 'Please retain these instructions for future reference.' },
      { type: 'heading', level: 1, text: 'General Description' },
      { type: 'para', text: 'Fully adjustable by hook and loop for a snug fit. This pack contains 1 pair.' },
      // NB gold has "Reflexite ®" / "Better ™" with a space before the
      // symbol (verified: liblouis only produces the gold's "^R"/"^T" WITH
      // a preceding space when the input has one — a bare "Reflexite®" with
      // no space translates as "REFLEXITE^R", not gold's "REFLEXITE ^R").
      // The rendered PDF shows the symbols kerned tight with no visible
      // gap, but the source evidently had a real space (or non-break
      // space) before each. Print-source spacing restored for fidelity.
      { type: 'para', text: 'This product is made from Reflexite ® Visibly Better ™.' },
      { type: 'para', text: 'This product has a CE mark, which means that it complies with all relevant safety legislation.' },
      { type: 'para', text: 'Reflexite ® is widely used in high visibility garments worn by the police, ambulance and fire services.' },
      { type: 'para', text: 'Nowadays more and more people are becoming safety conscious and aware of the need to protect themselves and their families by being clearly visible to on-coming traffic. Whether they are pedestrians, cyclists, motorcyclists or even joggers, the need to be seen is vital.' },
      // NB: print PDF extraction shows "430mm x 3omm (17\" x 1 1/4\")" (a
      // literal "x" for multiplication, an OCR/typo "3omm" for 30mm, and a
      // decomposed "1 1/4" fraction). Gold's own front-matter documents "8
      // as the UEB multiplication sign, and the fraction cell matches
      // liblouis's translation of the precomposed ¼ character exactly
      // (verified: "1¼" -> "#A#A/D", matching gold's "#A#A/D" fraction
      // cell). Restored × and ¼ for fidelity to the evident original;
      // "3omm" corrected to "30mm" (clear print/OCR typo). The exact inch
      // (″) quote-mark rendering is NOT fully reproduced even with the
      // straight-quote char restored — liblouis's directional/nondirectional
      // quote inference depends on surrounding context in a way not worth
      // reverse-engineering further; left as a residual, understood,
      // OUT-OF-SCOPE difference (see test-corpus.mjs categorize).
      { type: 'para', text: 'Each band measures 430mm × 30mm (17" × 1¼").' },
      { type: 'para', text: 'To find out more about our extensive range of products, please visit our on line shop:' },
      { type: 'para', text: 'http://onlineshop.rnib.org.uk' },
      { type: 'para', text: 'Or alternatively, you can contact a member of our friendly professional Customer Services Team, details are listed under Terms and Conditions.' },
      { type: 'heading', level: 1, text: 'Terms and Conditions of Sale' },
      { type: 'para', text: 'All goods are guaranteed against faults for 12 months from date of invoice. Faults should be notified to RNIB Customer Services prior to return, who will issue a returns authorisation number (RMA).' },
      { type: 'para', text: 'Goods can be returned as ‘unsuitable’ within 30 days of delivery, as follows:–' },
      { type: 'para', text: 'i) Customer must contact RNIB Customer Services to obtain a returns authorisation number (RMA).' },
      { type: 'para', text: 'ii) Items must be returned in original packaging and condition.' },
      { type: 'para', text: 'iii) Goods must be marked ‘Returns’ and must show the authorisation number.' },
      { type: 'para', text: 'iv) Goods lost in transit will only be refunded on proof of postage.' },
      { type: 'para', text: 'Goods marked as ‘non returnable’ in the RNIB catalogues cannot be returned for hygiene reasons – unless faulty, and software products whose seal have been broken cannot be returned unless faulty.' },
      { type: 'para', text: 'Where goods are sold to organisations, who then sell on the goods, the guarantee will commence from the date of original purchase from RNIB.' },
      { type: 'para', text: 'None of the above terms and conditions affect your statutory rights.' },
      { type: 'para', text: 'If you require further information or clarification of these terms and conditions please contact:–' },
      { type: 'para', text: 'RNIB Customer Services' },
      { type: 'para', text: 'PO Box 173' },
      { type: 'para', text: 'Peterborough PE2 6WS' },
      { type: 'para', text: 'U.K.' },
      { type: 'para', text: 'Telephone 0845 702 3153' },
      { type: 'para', text: 'Textphone: 0845 758 5691' },
      { type: 'para', text: 'Email: Cservices@rnib.org.uk' },
      { type: 'para', text: 'RNIB website: www.rnib.org.uk' },
      { type: 'para', text: 'Registered charity No. 226227' },
      { type: 'para', text: 'Overseas customers should contact RNIB Export Department at the above address or call:' },
      { type: 'para', text: 'Telephone: +44 (0) 1733 375400' },
      { type: 'para', text: 'Export direct fax: +44 (0) 1733 238541' },
      { type: 'para', text: 'Email: exports@rnib.org.uk' },
      { type: 'para', text: 'Revised November 2004' },
    ],
  };
}
