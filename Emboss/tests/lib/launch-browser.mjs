// A89 step 1 (Paul, 2 Oct 2026): every Playwright browser suite launches its browser through here, so that one environment
// variable runs any suite in Chrome, WebKit (Safari's engine) or Firefox. 44 of 45 browser suites only ever ran in Chrome, and a
// Safari-only fault (the Down key stuck on lines with equations) reached a tester.
//
//   EMBOSS_ENGINE=chrome|webkit|firefox node Emboss/tests/test-one-menu-open.mjs 8291     (default: chrome)
//   node Emboss/scripts/run-browser-suites.mjs --port 8291                                   (every suite, every engine)
//
//   ENGINE        'chrome' | 'webkit' | 'firefox' (anything else throws)
//   ENGINE_LABEL  'Chrome' | 'WebKit' | 'Firefox', for messages and each suite's final summary line
//   ENGINE_SET    true when EMBOSS_ENGINE was given. The two suites that loop over engines on purpose (test-arrow-past-equations,
//                 scripts/test-e2e-suite) run every engine when it is not given, and only that one when it is.
//   launchBrowser(extra, engine)  launches the engine (default: ENGINE), headless unless the command line has --show. `extra` is merged into the launch
//                         options; the Chrome-only ones (channel, and args such as --no-sandbox) are dropped for WebKit and Firefox,
//                         which would refuse or ignore them. In Chrome the installed Chrome is used (channel 'chrome');
//                         PW_CHANNEL=chromium (or another channel) overrides that, as test-ebraille-browser.mjs documents.
import { chromium, webkit, firefox } from 'playwright';

const KNOWN = { chrome: 'Chrome', webkit: 'WebKit', firefox: 'Firefox' };
export const ENGINE = String(process.env.EMBOSS_ENGINE || 'chrome').trim().toLowerCase();
if (!Object.hasOwn(KNOWN, ENGINE)) {
  throw new Error(`EMBOSS_ENGINE must be one of chrome, webkit or firefox (got "${process.env.EMBOSS_ENGINE}")`);
}
export const ENGINE_LABEL = KNOWN[ENGINE];
export const ENGINE_SET = Boolean(process.env.EMBOSS_ENGINE);
export const ENGINES = Object.keys(KNOWN);
export const LABELS = KNOWN;

export async function launchBrowser(extra = {}, engine = ENGINE) {
  const headless = !process.argv.includes('--show');
  if (engine === 'chrome') {
    return chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless, ...extra });
  }
  // eslint-disable-next-line no-unused-vars
  const { channel, args, ...portable } = extra;   // Chromium-only launch options
  return (engine === 'webkit' ? webkit : firefox).launch({ headless, ...portable });
}
