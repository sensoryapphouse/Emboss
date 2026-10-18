// A89 step 2 (robustness programme; Paul, 2 Oct): "Report a problem" saves one file a tester can email — the document (unless
// they leave it out), its braille, the settings, the version and browser, and every error since the page opened — so a strange
// bug can be reproduced instead of guessed from a screenshot. Offline: the file is saved on their computer; nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recordProblem, problemLog, clearProblemLog, reportFiles, reportFileName } from '../web/problem-report.mjs';

test('errors are recorded with their time, kind and message, newest last, at most 200, long ones trimmed', () => {
  clearProblemLog();
  recordProblem('error', 'Boom', { source: 'editor.mjs:12', stack: 'Error: Boom\n    at x (editor.mjs:12:3)' });
  const log = problemLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].kind, 'error');
  assert.equal(log[0].message, 'Boom');
  assert.equal(log[0].source, 'editor.mjs:12');
  assert.match(log[0].time, /^\d{4}-\d{2}-\d{2}T/);
  for (let i = 0; i < 250; i++) recordProblem('console', `message ${i}`);
  assert.equal(problemLog().length, 200, 'a ring of the last 200');
  assert.equal(problemLog().at(-1).message, 'message 249');
  recordProblem('error', 'x'.repeat(20000));
  assert.ok(problemLog().at(-1).message.length <= 4000, 'a huge message is trimmed');
});

test('the report: README, report.json, and the document files only when included', () => {
  clearProblemLog();
  recordProblem('error', 'Cannot read properties of undefined');
  const base = {
    page: 'editor', description: 'The caret stuck after an equation.', buildInfo: { hash: 'ee4d9883', date: '2026-10-02', beta: true },
    settings: { mode: 'bana', grade: 'g2' }, environment: { userAgent: 'UA', language: 'en-US' }, extra: { blocks: 42 },
    documentFiles: [{ name: 'document.xml', text: '<dtbook/>' }, { name: 'braille.brf', text: ',TE/' }],
  };
  const files = reportFiles({ ...base, includeDocument: true });
  const names = files.map((f) => f.name);
  assert.deepEqual(names.slice(0, 2), ['README.txt', 'report.json']);
  assert.ok(names.includes('document.xml') && names.includes('braille.brf'));
  const rep = JSON.parse(files.find((f) => f.name === 'report.json').text);
  assert.equal(rep.app, 'Emboss');
  assert.equal(rep.page, 'editor');
  assert.equal(rep.description, 'The caret stuck after an equation.');
  assert.equal(rep.version.hash, 'ee4d9883');
  assert.equal(rep.version.beta, true);
  assert.equal(rep.settings.mode, 'bana');
  assert.equal(rep.environment.userAgent, 'UA');
  assert.equal(rep.extra.blocks, 42);
  assert.equal(rep.includedDocument, true);
  assert.deepEqual(rep.files, ['document.xml', 'braille.brf']);
  assert.equal(rep.errors.length, 1);
  assert.match(rep.errors[0].message, /undefined/);
  assert.match(files[0].text, /nothing was sent/i);

  const without = reportFiles({ ...base, includeDocument: false });
  assert.deepEqual(without.map((f) => f.name), ['README.txt', 'report.json'], 'left out: no document, no braille');
  assert.equal(JSON.parse(without[1].text).includedDocument, false);
  assert.equal(JSON.parse(without[1].text).version.hash, 'ee4d9883');
  // in the development server there is no build-info.json
  assert.equal(JSON.parse(reportFiles({ ...base, buildInfo: null, includeDocument: false })[1].text).version, 'development');
});

test('the file name says what it is and when', () => {
  assert.equal(reportFileName(new Date(2026, 9, 2, 8, 5)), 'emboss-problem-report-2026-10-02-0805.zip');
});

test('nothing is sent anywhere: the module makes no network request', () => {
  const src = readFileSync(new URL('../web/problem-report.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  for (const api of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource']) assert.ok(!src.includes(api), api);
});
