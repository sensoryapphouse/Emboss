// Document model for UKAAF corpus Sample 1 ("The Three Wishes"), built by
// hand from corpus/ukaaf/sample1-print.pdf (pdftotext -layout). The gold BRF
// (corpus/ukaaf/sample1.brf) additionally carries UKAAF-sample-series front
// matter ("Sample 1" cover label + "Note: the new UEB signs..." explanation)
// that is not present in the print source at all — see test-corpus.mjs for
// why that's skipped rather than modelled.
export function sample1() {
  return {
    title: 'The Three Wishes',
    blocks: [
      { type: 'title', text: 'The Three Wishes' },
      { type: 'para', text: 'Once upon a time a poor woodman lived with his wife in the middle of a forest. Every day he went out to cut down trees and sold the timber to a local carpenter.' },
      { type: 'para', text: 'One day he set off as usual and found a big old oak tree which would provide lots of wood. But as he swung his axe to strike the first blow, he heard a little voice begging him not to fell the tree. He looked down and there was a tiny fairy, pleading with him to stop what he was doing.' },
      { type: 'para', text: 'The woodcutter was so surprised that he laid down his axe and promised to spare the tree.' },
      { type: 'para', text: 'The fairy was so grateful that she granted him three wishes.' },
      { type: 'para', text: '‘The next three things you or your wife wish for will be given to you, whatever they are,’ she promised him.' },
      { type: 'para', text: 'The woodman set off on the long walk home, to tell his wife what had happened. But by the time he got home he was famished.' },
      { type: 'para', text: '‘I’d love a big plate of sausages ...,’ said the woodman. No sooner had the words left his lips than a plate of tasty sausages came tumbling down the chimney.' },
      { type: 'para', text: 'Then the woodman remembered what the fairy had promised. He told his wife the whole story and she was not pleased.' },
      { type: 'para', text: '‘You mean we could have had anything in this world and you asked for a plate of sausages?’ she raged. ‘I wish a sausage would stick to the end of your nose!’' },
      { type: 'para', text: 'As soon as the words were out of her mouth, a sausage rose off the plate and attached itself to the end of the woodman’s nose.' },
      { type: 'para', text: 'The woodman pulled at the sausage. His wife pulled at the sausage. Then they both pulled together, but it was completely stuck.' },
      { type: 'para', text: 'The woodman’s wife tried to pretend that the sausage looked quite good at the end of her husband’s nose. But the woodman knew what he had to do.' },
      { type: 'para', text: '‘I wish my nose was back to normal,’ he said. And his wish was instantly granted.' },
      { type: 'para', text: 'The woodman and his wife never did get a fine house, or smart clothes, or a horse and carriage. But they did, at least, have a wonderful meal of sausages.' },
    ],
  };
}
