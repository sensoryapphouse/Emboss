// Document model for UKAAF corpus Sample 4 ("Some Jokes"), built from
// corpus/ukaaf/sample4-print.pdf. The print source mixes “double” and
// ‘single’ curly quotes for different jokes' dialogue; gold uses the plain
// double-quote braille sign throughout (RUEB 7.6.4 permits exchanging the
// double/single assignment) — see test-corpus.mjs categorize for sample 1,
// confirmed systematically here across multiple jokes. Not modelled (would
// require quote-normalisation logic that isn't a formatting-engine rule).
// The "***" breaks between jokes use the 3-spaced-asterisks indicator line
// (B004 Glossary, R17) — this exposed a genuine gap (asterisks form wasn't
// implemented at all) fixed in format/document.mjs's indicatorLine().
export function sample4() {
  return {
    title: 'Some Jokes',
    blocks: [
      { type: 'title', text: 'Some Jokes' },
      { type: 'para', text: 'One day a student was taking a very difficult exam. At the end of the test, the invigilator asked all the students to stop writing and put their pens down. The young man kept writing furiously, although he was warned that if he did not stop immediately he would be disqualified. He ignored the warning and carried on writing for another ten minutes, while all the other papers were collected. Finally, he finished and went over to hand in his paper. The invigilator refused and again told the student that he was disqualified.' },
      { type: 'para', text: 'The student asked, “Do you know who I am?”' },
      { type: 'para', text: 'The invigilator said, “No and I don’t care.”' },
      { type: 'para', text: 'The student asked again, “Do you really not know who I am?” The invigilator again said no. So the student walked over to the pile of exam scripts, placed his in the middle of the pile and threw all the papers in the air.' },
      { type: 'para', text: '“Good,” said the student and walked out.' },
      { type: 'indicator', kind: 'asterisks' },
      { type: 'para', text: 'Mary came home from school in tears. She explained to her mother that she had been punished for something she did not do.' },
      { type: 'para', text: '‘That’s terrible,’ said her mother. ‘I’m going straight up to the school to have a word with your teacher. What was it you didn’t do?’' },
      { type: 'para', text: '‘My homework,’ said Mary.' },
      { type: 'indicator', kind: 'asterisks' },
      { type: 'para', text: 'Teacher: Why are you late, Sally?' },
      { type: 'para', text: 'Sally: Because of a sign down the road.' },
      { type: 'para', text: 'Teacher: How could a sign down the road make you late?' },
      { type: 'para', text: 'Sally: The sign said, “School Ahead, Go Slow!”' },
      { type: 'indicator', kind: 'asterisks' },
      { type: 'para', text: 'A playgroup went to an open day at the fire station. One of the firefighters gave a presentation on safety in the home and held up a smoke detector.' },
      { type: 'para', text: '‘Does anyone know what this is for?’ he asked.' },
      { type: 'para', text: '‘I do,’ said little Sam. ‘My Mummy uses one to tell when the dinner is cooked.’' },
      { type: 'indicator', kind: 'asterisks' },
      { type: 'para', text: 'Kate was the youngest in her family and got teased a lot by her big brothers and sisters. One of their favourite tricks was to offer her a fifty pence piece or a pound coin. Kate always chose the fifty pence piece and her brothers and sisters would have a good laugh at her stupidity in choosing the bigger coin. One day her friend Sunita asked her why she always went for the fifty pence piece instead of the pound.' },
      { type: 'para', text: '‘Well,’ said Kate, ‘If I chose the pound coin they would stop doing it. As it is, I have collected £12.50 so far!’' },
      { type: 'indicator', kind: 'asterisks' },
      { type: 'para', text: 'Late one night a student was showing off his new bedsit to a couple of his friends. One of his few possessions was a big brass gong. He proudly explained to his friends that this was, in fact, a talking clock. Not surprisingly they found this hard to believe and demanded a demonstration. The student picked up a hammer and banged on the gong as hard as he could. Immediately a voice from next door called angrily through the wall. ‘Keep the noise down, it’s 3 o’clock in the morning!’' },
    ],
  };
}
