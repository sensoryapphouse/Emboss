// A89 step 1 (found running every browser suite in WebKit): "A new version of Emboss is available" on a FIRST visit. The pages
// offered an update whenever a new service worker installed while one controlled the page — but Emboss's own service worker
// takes control as soon as it installs (clients.claim() in sw.js), and in WebKit that can come before the check, so a first
// install looked like an update. A timing race (about 3 loads in 8 under load; tests/test-sw-first-visit.mjs checks the
// browsers), so this test also holds the rule in the source: both pages note whether a service worker controlled the page when
// it LOADED, and offer an update only then.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const page of ['web/index.html', 'web/editor/index.html']) {
  test(`${page}: an update is offered only to a page that was controlled when it loaded`, () => {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const script = html.slice(html.indexOf("navigator.serviceWorker.register('/web/sw.js'") - 3000, html.indexOf("navigator.serviceWorker.register('/web/sw.js'") + 2000);
    assert.match(script, /var controlledAtLoad = !!navigator\.serviceWorker\.controller;/, 'noted before registering');
    assert.ok(!/state === 'installed' && navigator\.serviceWorker\.controller\)/.test(script), 'not the controller at install time');
    assert.match(script, /nw\.state === 'installed' && controlledAtLoad/);
    assert.match(script, /reg\.waiting && controlledAtLoad/);
  });
}
