// Gate for the TTS module (web/tts.mjs). speechSynthesis isn't in Node, so we mock
// it — this verifies the queue sequencing, callbacks, and spoken-item building
// (including maths → speakable substitution), independent of any real voice.
import { Reader, buildSpokenItems, speechAvailable, sliceItemsFrom } from '../web/tts.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

// ---- mock the Web Speech API: each utterance fires start → one word boundary → end ----
const spoken = [];
class MockUtter {
  constructor(text) { this.text = text; }
}
globalThis.SpeechSynthesisUtterance = MockUtter;
globalThis.speechSynthesis = {
  cancel() {},
  speak(u) {
    spoken.push(u.text);
    Promise.resolve().then(() => {
      u.onstart && u.onstart();
      u.onboundary && u.onboundary({ name: 'word', charIndex: 0, charLength: 0 });
      u.onend && u.onend();
    });
  },
};

ok(speechAvailable(), 'speechAvailable() true when the API is present');

// ---- buildSpokenItems ----
const speakMath = (latex) => `«${latex}»`;                 // stub: prove maths is substituted, not read as LaTeX
const model = { blocks: [
  { type: 'heading', level: 1, text: 'Chapter One' },
  { type: 'para', text: 'Plain paragraph.' },
  { type: 'para', segments: [{ type: 'text', text: 'area is ' }, { type: 'math', latex: 'x^2' }, { type: 'text', text: '.' }] },
  { type: 'list', items: [{ text: 'apples' }, { text: 'pears' }] },
  { type: 'indicator', kind: 'asterisks' },
] };
const items = buildSpokenItems(model, speakMath);
const heading = items.find((it) => it.text === 'Chapter One');
ok(heading && heading.map.length === 11 && heading.map[0] === 0, 'heading item + identity map');
const plain = items.find((it) => it.text === 'Plain paragraph.');
ok(plain && plain.map[4] === 4, 'plain para item + map');
// equation is now its OWN spoken item carrying the atomMap payload; the surrounding
// text runs are separate word-mapped items
const mathItem = items.find((it) => it.kind === 'math');
ok(mathItem && mathItem.text.includes('«x^2»'), 'equation is its own spoken item (maths via callback)');
ok(mathItem && mathItem.blockIdx === 2 && mathItem.mathIndex === 0, 'math item carries block + math index');
ok(mathItem && 'atomMap' in mathItem && 'wrappedLatex' in mathItem, 'math item carries atomMap + wrappedLatex');
const areaItem = items.find((it) => it.text && it.text.startsWith('area is'));
ok(areaItem && areaItem.map[0] === 0, 'equation text run ("area is") is a word-mapped item');
const listItems = items.filter((it) => it.blockIdx === 3);
ok(listItems.length === 2 && listItems[0].text === 'apples' && listItems[1].text === 'pears', 'each list item is its own utterance');
ok(listItems[0].unit === 0 && listItems[1].unit === 1, 'list items carry their unit index (0, 1)');
ok(items.some((it) => it.blockIdx === 4 && it.map && it.map.length === 0), 'indicator produces a (pause) item with no map');
ok(mathItem && mathItem.srcStart === 8, 'math item carries srcStart (flat offset "area is " = 8)');

// ---- sliceItemsFrom: read from the caret WORD, not the line start ----
// Whole doc from the very start is unchanged.
ok(sliceItemsFrom(items, { block: 0, unit: 0, offset: 0 }).length === items.length, 'caret at very start → all items');
// Caret in block 1 ("Plain paragraph.") at offset 6 (start of "paragraph") → drop earlier blocks, keep from "paragraph"
const fromWord = sliceItemsFrom(items, { block: 1, unit: 0, offset: 6 });
ok(fromWord[0] && fromWord[0].text === 'paragraph.', `first item sliced to the caret word (got "${fromWord[0] && fromWord[0].text}")`);
ok(fromWord[0].map[0] === 6, 'sliced item map still points at the right source char (6)');
ok(!fromWord.some((it) => it.blockIdx === 0), 'blocks before the caret are dropped');
// Caret mid-word ("pa|ragraph", offset 8) snaps back to the start of "paragraph"
const midWord = sliceItemsFrom(items, { block: 1, unit: 0, offset: 8 });
ok(midWord[0] && midWord[0].text === 'paragraph.', `mid-word caret snaps back to word start (got "${midWord[0] && midWord[0].text}")`);
// Caret in the equation paragraph BEFORE the equation keeps the equation item
const eqPara = sliceItemsFrom(items, { block: 2, unit: 0, offset: 0 });
ok(eqPara.some((it) => it.kind === 'math'), 'caret before the equation still reads the equation');
// Caret AFTER the equation (offset past "area is ") drops the earlier text run
const afterEqText = sliceItemsFrom(items, { block: 2, unit: 0, offset: 8 });
ok(!afterEqText.some((it) => it.text && it.text.startsWith('area')), 'caret after a run drops that run');
// Caret on the 2nd list item reads from there, not the 1st
const fromList2 = sliceItemsFrom(items, { block: 3, unit: 1, offset: 0 });
ok(fromList2[0] && fromList2[0].text === 'pears', 'caret on 2nd list item starts at that item');
ok(!fromList2.some((it) => it.text === 'apples'), 'earlier list items are dropped');

// ---- Reader sequencing ----
const started = [];
const ended = { n: 0 };
await new Promise((resolve) => {
  const reader = new Reader({
    onBlock: (it) => started.push(it.text),
    onEnd: () => { ended.n++; resolve(); },
  });
  reader.speak(items);
});
ok(started.length === items.length, `onBlock fired for every item (${started.length}/${items.length})`);
ok(started[0] === 'Chapter One' && started[started.length - 1] !== undefined, 'items read in order');
ok(ended.n === 1, 'onEnd fired exactly once at completion');

// stop() before speaking is a no-op that doesn't fire onEnd
let endedEarly = 0;
const r2 = new Reader({ onEnd: () => endedEarly++ });
r2.stop();
ok(endedEarly === 0, 'stop() when idle does not fire onEnd');

// stop() must cancel pending watchdog timers + bump the generation, so a late timer
// from a stopped read can never tear down a subsequent one (rapid Stop→Play).
const r3 = new Reader({ onEnd: () => {} });
r3.speak([{ blockIdx: 0, text: 'hello world', map: [0] }]);
const genAfterSpeak = r3.gen;
ok(r3._timers.length > 0, 'a read schedules watchdog timer(s)');
r3.stop();
ok(r3._timers.length === 0, 'stop() clears pending watchdog timers');
ok(r3.gen > genAfterSpeak, 'stop() bumps the generation token');
// a fresh speak() also bumps the generation (invalidating any prior in-flight read)
r3.speak([{ blockIdx: 0, text: 'again', map: [0] }]);
ok(r3.gen > genAfterSpeak + 1, 'speak() bumps the generation token');
r3.stop();

// a throwing callback must not break the read loop (onEnd still fires, items still advance)
const seen = [];
let ended4 = 0;
const realErr = console.error; console.error = () => {};   // the callback throws on purpose; keep the gate output clean
await new Promise((resolve) => {
  const r4 = new Reader({
    onBlock: (it) => { seen.push(it.text); if (it.text === 'boom') throw new Error('callback blew up'); },
    onEnd: () => { ended4++; resolve(); },
  });
  r4.speak([{ blockIdx: 0, text: 'boom', map: [] }, { blockIdx: 1, text: 'after', map: [] }]);
});
console.error = realErr;
ok(seen.includes('after'), 'a throwing onBlock does not stop later items being read');
ok(ended4 === 1, 'onEnd still fires exactly once despite a throwing callback');

console.log(`\ntts gate: ${pass}/${pass + fail} checks pass`);
process.exit(fail ? 1 : 0);
