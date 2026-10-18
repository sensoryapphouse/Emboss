// Audit batch S2a #4 (ChatGPT audit of 15 Oct 2026): every Quick Mode <-> editor transfer has its own id, carried in the address
// as '#handoff=<id>'. The pure helpers: id creation, the hash a destination page gets, and reading an id back out of a hash.
// (The storage itself is IndexedDB and is tested in a browser by tests/test-s2a-output.mjs.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { newHandoffId, handoffHash, handoffIdFromHash } from '../web/handoff-db.mjs';

test('ids are distinct, URL-safe and long enough to read back', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i++) ids.add(newHandoffId());
  assert.equal(ids.size, 500, 'no two transfers share an id');
  for (const id of ids) assert.match(id, /^[\w-]{8,80}$/);
});

test('an id survives the trip through the address', () => {
  const id = newHandoffId();
  assert.equal(handoffHash(id), '#handoff=' + id);
  assert.equal(handoffIdFromHash(handoffHash(id)), id);
  assert.equal(handoffIdFromHash('#other=1&handoff=' + id + '&x=2'), id, 'among other parameters');
});

test('no hash, another hash or a malformed id reads as "no transfer" (the old shared key is then used once)', () => {
  for (const h of ['', '#', '#top', undefined, null, '#handoff=', '#handoff=short', '#handoff=' + 'x'.repeat(81), '#handoff=bad id here', '#xhandoff=abcdefghij', '#handoff=abc/../../etc/passwd']) {
    assert.equal(handoffIdFromHash(h), null, String(h));
  }
});
