// Quick smoke test that the --target web build's exports work when driven manually
// (bypassing `fetch`, which Node doesn't supply for local file:// URLs the same way
// a browser does). This just proves the wasm-bindgen glue + exports are sound;
// the real PWA will use the standard `await init()` / fetch() flow in-browser.
import { readFileSync } from 'node:fs';
import { initSync, mathml_to_braille, mathcat_version } from './pkg-web/emboss_mathcat.js';

const bytes = readFileSync(new URL('./pkg-web/emboss_mathcat_bg.wasm', import.meta.url));
initSync({ module: bytes });

console.log('web-target MathCAT version:', mathcat_version());
console.log('web-target x^2+1 Nemeth:', mathml_to_braille('<math><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn></math>', 'Nemeth'));
console.log('web-target x^2+1 UEB:', mathml_to_braille('<math><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn></math>', 'UEB'));
