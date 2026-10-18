// S1 security batch (ChatGPT audit of 15 Oct 2026, Paul's decision F2: security first) — the two local servers.
//   #25  containment: a sibling folder sharing the root's name as a prefix, encoded ../ and %2e%2e, and symlinks cannot be read;
//        both servers listen on 127.0.0.1 only unless HOST says otherwise.
//   #26  dist/serve.mjs answers a malformed percent escape with 400 and keeps serving.
//   #27  the developer server's print bridge answers only a same-origin page on its own address, caps the body, runs one job at a time.
//   #28  its USB fallback: no device, discovered device, spawn failure, stdin failure, non-zero exit, success — told truthfully.
// Each server runs as a child process on a free port, in a scratch tree under the OS temp dir (a copy of the server file, so its
// root is the scratch folder); the print programs (lpstat, lp, the CUPS usb backend) are small shell scripts that log what they
// were given — no printer is ever touched. Set S1_DEV_SERVER / S1_DIST_SERVER to a server file to run the tests against another
// copy (this is how the failing-first run against the pre-change servers was made).
// Usage: node --test Emboss/tests/local_servers.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEV_SRC = process.env.S1_DEV_SERVER || path.join(HERE, '../scripts/serve.mjs');
const DIST_SRC = process.env.S1_DIST_SERVER || path.join(HERE, '../scripts/dist-serve.template.mjs');
const MARKER = 'S1-PRIVATE-MARKER-' + process.pid;

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 's1-servers-'));
const children = new Set();
let counter = 0;

// ---- scratch trees ----
function write(p, text) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
// base/server-root (dev: scripts/serve.mjs below it; dist: serve.mjs in it) and the sibling base/server-root-private
function buildTree(kind) {
  const tag = `${kind}-${++counter}`;
  const base = path.join(BASE, tag);
  const root = path.join(base, kind === 'dev' ? 'server-root' : 'server-root');
  write(path.join(base, 'server-root-private', 'secret.txt'), MARKER);
  write(path.join(base, 'shared', 'shared.txt'), 'shared-ok');
  write(path.join(root, 'ok.txt'), 'ok-inside');
  if (kind === 'dev') {
    fs.copyFileSync(DEV_SRC, (fs.mkdirSync(path.join(root, 'scripts'), { recursive: true }), path.join(root, 'scripts', 'serve.mjs')));
    write(path.join(root, 'web', 'index.html'), '<title>dev</title>');
  } else {
    fs.copyFileSync(DIST_SRC, path.join(root, 'serve.mjs'));
    write(path.join(root, 'editor', 'index.html'), '<title>dist</title>');
  }
  fs.symlinkSync('ok.txt', path.join(root, 'link-in'));                                              // stays inside: fine
  fs.symlinkSync('../server-root-private/secret.txt', path.join(root, 'link-out'));                  // a file outside
  fs.symlinkSync('../shared', path.join(root, 'toplink'));                                           // a top-level directory link (like Emboss/liblouis)
  fs.mkdirSync(path.join(root, 'web'), { recursive: true });
  fs.symlinkSync('../../server-root-private', path.join(root, 'web', 'deeplink'));                   // nested directory link outside
  fs.symlinkSync('../../server-root-private/secret.txt', path.join(root, 'web', 'deepfile'));        // nested file link outside
  return { base, root, script: kind === 'dev' ? path.join(root, 'scripts', 'serve.mjs') : path.join(root, 'serve.mjs'), home: kind === 'dev' ? '/web/index.html' : '/editor/index.html' };
}

function freePort() {
  return new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}
// A free port can be taken by another process between freePort() and the server's listen (seen in a release check on a machine
// loaded at 100+): then try a new port, up to four times. The start wait is generous for the same reason.
async function start(tree, env = {}) {
  let srv;
  for (let attempt = 1; attempt <= 4; attempt++) {
    srv = await startOnce(tree, env);
    if (srv.started || !/EADDRINUSE/.test(srv.out + srv.err)) break;
  }
  assert.ok(srv.started, 'server did not start: ' + srv.out + srv.err);
  return srv;
}
async function startOnce(tree, env) {
  const port = await freePort();
  const child = spawn(process.execPath, [tree.script], { env: { ...process.env, PORT: String(port), NO_OPEN: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  const srv = { child, port, out: '', err: '', exited: null };
  child.stdout.on('data', (d) => { srv.out += d; });
  child.stderr.on('data', (d) => { srv.err += d; });
  child.on('exit', (code) => { srv.exited = code; });
  for (let i = 0; i < 400 && !/serving|running/.test(srv.out) && srv.exited === null; i++) await new Promise((r) => setTimeout(r, 50));
  srv.started = /serving|running/.test(srv.out);
  srv.stop = () => new Promise((r) => { if (srv.exited !== null) return r(); child.once('exit', r); child.kill('SIGTERM'); });
  return srv;
}

// A request written by hand, so the request target reaches the server exactly as given (no client-side normalising).
function raw(port, method, target, { headers = {}, body = null, host = `127.0.0.1:${port}`, connectHost = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, connectHost);
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => { buf = Buffer.concat([buf, d]); });
    sock.on('error', reject);
    sock.on('close', () => {
      const text = buf.toString('latin1');
      const i = text.indexOf('\r\n\r\n');
      const head = i < 0 ? text : text.slice(0, i);
      const m = /^HTTP\/1\.\d (\d+)/.exec(head);
      const hdrs = {};
      for (const l of head.split('\r\n').slice(1)) { const k = l.indexOf(':'); if (k > 0) hdrs[l.slice(0, k).toLowerCase()] = l.slice(k + 1).trim(); }
      resolve({ status: m ? Number(m[1]) : 0, headers: hdrs, body: i < 0 ? '' : buf.subarray(buf.indexOf('\r\n\r\n') + 4).toString() });
    });
    const b = body == null ? null : Buffer.from(body);
    const lines = [`${method} ${target} HTTP/1.0`, `Host: ${host}`, 'Connection: close', ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)];
    if (b && !('Content-Length' in headers)) lines.push(`Content-Length: ${b.length}`);
    sock.write(lines.join('\r\n') + '\r\n\r\n');
    if (b) sock.write(b);
  });
}
const get = (srv, target, o) => raw(srv.port, 'GET', target, o);
const sameOrigin = (srv) => ({ Origin: `http://127.0.0.1:${srv.port}` });

after(() => { for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } } fs.rmSync(BASE, { recursive: true, force: true }); });

// =========================== #25 containment and binding, both servers ===========================
for (const kind of ['dev', 'dist']) {
  test(`#25 ${kind}: a file inside the root is served`, async () => {
    const tree = buildTree(kind); const srv = await start(tree);
    try {
      assert.equal((await get(srv, '/ok.txt')).body, 'ok-inside');
      assert.equal((await get(srv, tree.home)).status, 200);
      assert.equal((await get(srv, '/link-in')).body, 'ok-inside', 'a symlink that stays inside the root is served');
    } finally { await srv.stop(); }
  });

  test(`#25 ${kind}: a sibling folder sharing the root's name as a prefix cannot be read`, async () => {
    const tree = buildTree(kind); const srv = await start(tree);
    try {
      for (const target of ['/../server-root-private/secret.txt', '/%2e%2e/server-root-private/secret.txt', '/..%2Fserver-root-private%2Fsecret.txt',
        '/%2e%2e%2fserver-root-private/secret.txt', '/web/../../server-root-private/secret.txt', '/%2E%2E/server-root-private/secret.txt',
        '//..//server-root-private/secret.txt', '/./../server-root-private/secret.txt']) {
        const r = await get(srv, target);
        assert.notEqual(r.status, 200, `${target} answered 200`);
        assert.ok(!r.body.includes(MARKER), `${target} leaked the sibling's file`);
      }
      assert.equal((await get(srv, '/ok.txt')).status, 200, 'still serving afterwards');
    } finally { await srv.stop(); }
  });

  test(`#25 ${kind}: a symlink whose real path is outside the root is refused`, async () => {
    const tree = buildTree(kind); const srv = await start(tree);
    try {
      for (const target of ['/link-out', '/web/deeplink/secret.txt', '/web/deepfile']) {
        const r = await get(srv, target);
        assert.notEqual(r.status, 200, `${target} answered 200`);
        assert.ok(!r.body.includes(MARKER), `${target} leaked the file behind the link`);
      }
    } finally { await srv.stop(); }
  });

  test(`#25 ${kind}: listens on loopback only by default`, async () => {
    const tree = buildTree(kind); const srv = await start(tree);
    try {
      assert.equal((await get(srv, '/ok.txt')).status, 200);
      const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
      if (!lan) return;                                          // no network interface: nothing to test through
      const refused = await new Promise((resolve) => { const s = net.connect(srv.port, lan.address); s.setTimeout(3000, () => { s.destroy(); resolve(true); }); s.on('connect', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(true)); });   // refused, or silently dropped: not answered
      assert.ok(refused, `the server answered on ${lan.address}`);
    } finally { await srv.stop(); }
  });

  test(`#25 ${kind}: HOST=0.0.0.0 is the deliberate way to listen on every interface`, async () => {
    const tree = buildTree(kind); const srv = await start(tree, { HOST: '0.0.0.0' });
    try {
      const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
      if (!lan) return;
      const r = await get(srv, '/ok.txt', { connectHost: lan.address, host: `${lan.address}:${srv.port}` });
      assert.equal(r.status, 200);
      assert.ok(/reachable from other machines/.test(srv.out), 'says so on the console');
    } finally { await srv.stop(); }
  });
}

test('#25 dev: a top-level symlink to a directory (Emboss/liblouis -> ../liblouis) still works, and only inside its target', async () => {
  const tree = buildTree('dev'); const srv = await start(tree);
  try {
    assert.equal((await get(srv, '/toplink/shared.txt')).body, 'shared-ok');
    const r = await get(srv, '/toplink/../server-root-private/secret.txt');
    assert.ok(r.status !== 200 && !r.body.includes(MARKER));
  } finally { await srv.stop(); }
});
test('#25 dev: the fallback to ROOT/web/ is contained too', async () => {
  const tree = buildTree('dev'); const srv = await start(tree);
  try {
    write(path.join(tree.root, 'web', 'only-in-web.txt'), 'web-fallback');
    assert.equal((await get(srv, '/only-in-web.txt')).body, 'web-fallback');
    const r = await get(srv, '/%2e%2e/%2e%2e/server-root-private/secret.txt');
    assert.ok(r.status !== 200 && !r.body.includes(MARKER));
  } finally { await srv.stop(); }
});
test('#25 dist: a top-level symlink out of the distribution is refused (the dist copy has none)', async () => {
  const tree = buildTree('dist'); const srv = await start(tree);
  try { assert.notEqual((await get(srv, '/toplink/shared.txt')).status, 200); } finally { await srv.stop(); }
});

// =========================== #26 malformed requests ===========================
for (const kind of ['dev', 'dist']) {
  test(`#26 ${kind}: a malformed percent escape gets 400 and the server keeps serving`, async () => {
    const tree = buildTree(kind); const srv = await start(tree);
    try {
      for (const target of ['/%zz', '/%E0%A4%A', '/%', '/ok%2', '/a/%c0%ae/../b%']) {
        const r = await get(srv, target);
        assert.ok(r.status === 400, `${target} -> ${r.status}`);
      }
      assert.equal(srv.exited, null, 'the server is still running');
      const good = await get(srv, '/ok.txt');
      assert.equal(good.status, 200); assert.equal(good.body, 'ok-inside');
    } finally { await srv.stop(); }
  });
  test(`#26 ${kind}: odd request targets get a controlled answer and the server keeps serving`, async () => {
    const tree = buildTree(kind); const srv = await start(tree);
    try {
      for (const target of ['*', 'http://evil.example/ok.txt', 'ok.txt', '/ok.txt%00', '/' + 'a'.repeat(20000)]) {
        const r = await get(srv, target);
        assert.ok(r.status === 0 || (r.status >= 400 && r.status < 500), `${target.slice(0, 40)} -> ${r.status}`);
      }
      assert.equal(srv.exited, null);
      assert.equal((await get(srv, '/ok.txt')).status, 200);
    } finally { await srv.stop(); }
  });
}

// =========================== #27 / #28 the developer print bridge ===========================
const SH = '#!/bin/sh\n';
function stubs(dir, o = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const q = (n) => JSON.stringify(path.join(dir, n));
  const lpstat = path.join(dir, 'lpstat'); const lp = path.join(dir, 'lp'); const usb = path.join(dir, 'usb');
  fs.writeFileSync(lpstat, SH + `echo "lpstat $@" >> ${q('lpstat.log')}\n[ -f ${q('lpstat.out')} ] && cat ${q('lpstat.out')}\nexit 0\n`);
  fs.writeFileSync(lp, SH + `echo "$@" > ${q('lp-args.log')}\nfor a; do f="$a"; done\necho "$f" > ${q('lp-file.log')}\ncat "$f" > ${q('lp-payload.bin')}\n[ -f ${q('lp-sleep')} ] && sleep "$(cat ${q('lp-sleep')})"\n[ -f ${q('lp-fail')} ] && { echo "lp: printer offline" >&2; exit 1; }\nexit 0\n`);
  fs.writeFileSync(usb, SH + `if [ $# -eq 0 ]; then\n  echo "usb discovery" >> ${q('usb-discover.log')}\n  [ -f ${q('usb-discover.out')} ] && cat ${q('usb-discover.out')}\n  [ -f ${q('usb-selfdelete')} ] && rm -f "$0"\n  exit 0\nfi\necho "$DEVICE_URI" > ${q('usb-uri.log')}\necho "$@" > ${q('usb-args.log')}\nif [ -f ${q('usb-exit-early')} ]; then echo "backend gave up" >&2; exit "$(cat ${q('usb-exit-early')})"; fi\ncat > ${q('usb-stdin.bin')}\nif [ -f ${q('usb-exit')} ]; then echo "device offline" >&2; exit "$(cat ${q('usb-exit')})"; fi\nexit 0\n`);
  for (const f of [lpstat, lp, usb]) fs.chmodSync(f, 0o755);
  return { dir, env: { EMBOSS_PRINT_BRIDGE: '1', EMBOSS_LPSTAT: lpstat, EMBOSS_LP: lp, EMBOSS_USB_BACKEND: usb }, set: (n, v = '1') => fs.writeFileSync(path.join(dir, n), v), has: (n) => fs.existsSync(path.join(dir, n)), read: (n) => fs.readFileSync(path.join(dir, n)) };
}
async function bridge(kind = 'dev', scenario = {}, envExtra = {}) {
  const tree = buildTree(kind);
  const st = stubs(path.join(tree.base, 'stubs'));
  scenario(st);
  const srv = await start(tree, { ...st.env, ...envExtra });
  return { tree, st, srv };
}
const post = (srv, target, body, o = {}) => raw(srv.port, 'POST', target, { body, headers: { 'Content-Type': 'application/octet-stream', ...sameOrigin(srv), ...(o.headers || {}) }, ...o, });
const json = (r) => { try { return JSON.parse(r.body); } catch { return null; } };

test('S3C-Q1 the print bridge is off unless the server is started with EMBOSS_PRINT_BRIDGE=1: nothing reaches lp or the USB backend', async () => {
  const { st, srv } = await bridge('dev', (s) => { s.set('lpstat.out', 'printer Index_Test is idle.\n'); }, { EMBOSS_PRINT_BRIDGE: '' });
  try {
    for (const target of ['/api/print', '/api/emboss-usb']) {
      const r = await post(srv, target, Buffer.from('ABC'));
      assert.equal(r.status, 403, target);
      assert.match(json(r)?.error || '', /print bridge is off/);
    }
    assert.ok(!st.has('lp-payload.bin') && !st.has('usb-stdin.bin') && !st.has('lpstat.log'), 'no print program was run');
  } finally { await srv.stop(); }
});

test('#27 the bridge refuses a request that is not the page: no Origin, another origin, another Host, cross-site fetch', async () => {
  const { st, srv } = await bridge('dev', (s) => s.set('lpstat.out', 'printer index_basic is idle.\n'));
  try {
    const cases = [
      ['no Origin', { headers: { 'Content-Type': 'text/plain' } }, { noOrigin: true }],
      ['another site', { headers: { Origin: 'https://evil.example' } }],
      ['another port on localhost', { headers: { Origin: 'http://127.0.0.1:1' } }],
      ['null origin', { headers: { Origin: 'null' } }],
      ['DNS rebinding (Host and Origin both the attacker\'s name)', { host: `evil.example:${srv.port}`, headers: { Origin: `http://evil.example:${srv.port}` } }],
      ['Host rebound, Origin local', { host: `evil.example:${srv.port}`, headers: { Origin: `http://127.0.0.1:${srv.port}` } }],
      ['cross-site Fetch metadata', { headers: { Origin: `http://127.0.0.1:${srv.port}`, 'Sec-Fetch-Site': 'cross-site' } }],
    ];
    for (const [name, o, flags] of cases) {
      const r = flags && flags.noOrigin ? await raw(srv.port, 'POST', '/api/print', { body: 'x', headers: o.headers }) : await post(srv, '/api/print', 'x', o);
      assert.equal(r.status, 403, name);
      assert.equal(json(r)?.success, false, name);
    }
    const r2 = await post(srv, '/api/emboss-usb', 'x', { headers: { Origin: 'https://evil.example' } });
    assert.equal(r2.status, 403, 'the other bridge path too');
    assert.ok(!st.has('lp-args.log') && !st.has('lpstat.log'), 'no print program was even asked');
  } finally { await srv.stop(); }
});

test('#27 a preflight gets no cross-origin permission', async () => {
  const { srv } = await bridge('dev', () => {});
  try {
    const r = await raw(srv.port, 'OPTIONS', '/api/print', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    assert.ok(!('access-control-allow-origin' in r.headers), JSON.stringify(r.headers));
    const p = await post(srv, '/api/print', 'x', { headers: { Origin: `http://127.0.0.1:${srv.port}` } });
    assert.ok(!('access-control-allow-origin' in p.headers), 'no CORS header on the answer either');
  } finally { await srv.stop(); }
});

test('#27 the page itself (same origin, localhost or 127.0.0.1) may print; LAN mode accepts an IP address but not a name', async () => {
  const { srv, st } = await bridge('dev', (s) => s.set('lpstat.out', 'printer index_basic is idle.\n'));
  try {
    assert.equal((await post(srv, '/api/print', 'BRF1')).status, 200);
    const viaName = await raw(srv.port, 'POST', '/api/print', { body: 'BRF2', host: `localhost:${srv.port}`, headers: { Origin: `http://localhost:${srv.port}` } });
    assert.equal(viaName.status, 200);
    assert.equal(st.read('lp-payload.bin').toString(), 'BRF2');
  } finally { await srv.stop(); }
  const lan = await bridge('dev', (s) => s.set('lpstat.out', 'printer index_basic is idle.\n'), { HOST: '0.0.0.0' });
  try {
    const ip = '192.168.7.7';
    const ok = await raw(lan.srv.port, 'POST', '/api/print', { body: 'x', host: `${ip}:${lan.srv.port}`, headers: { Origin: `http://${ip}:${lan.srv.port}` } });
    assert.equal(ok.status, 200, 'an IP address on the LAN');
    const bad = await raw(lan.srv.port, 'POST', '/api/print', { body: 'x', host: `evil.example:${lan.srv.port}`, headers: { Origin: `http://evil.example:${lan.srv.port}` } });
    assert.equal(bad.status, 403, 'a DNS name is refused even in LAN mode (rebinding)');
  } finally { await lan.srv.stop(); }
});

test('#27 the body is capped: a declared size over 16 MB and a streamed one are both refused with 413', async () => {
  const { srv, st } = await bridge('dev', (s) => s.set('lpstat.out', 'printer index_basic is idle.\n'));
  try {
    const declared = await raw(srv.port, 'POST', '/api/print', { body: 'tiny', headers: { ...sameOrigin(srv), 'Content-Length': String(17 * 1024 * 1024) } });
    assert.equal(declared.status, 413);
    // streamed with no Content-Length (chunked)
    const status = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: srv.port, method: 'POST', path: '/api/print', headers: { ...sameOrigin(srv), 'Transfer-Encoding': 'chunked' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', () => resolve(-1));
      const chunk = Buffer.alloc(1024 * 1024, 65);
      let n = 0;
      const pump = () => { while (n < 20) { n++; if (!req.write(chunk)) { req.once('drain', pump); return; } } req.end(); };
      pump();
    });
    assert.ok(status === 413 || status === -1, 'streamed oversize -> ' + status);
    assert.ok(!st.has('lp-args.log'), 'nothing was printed');
    assert.equal((await get(srv, '/ok.txt')).status, 200, 'the server is fine afterwards');
    assert.equal((await post(srv, '/api/print', 'small')).status, 200, 'and the next normal job prints');
  } finally { await srv.stop(); }
});

test('#27 one job at a time: a second job while one runs gets 429, then the next prints', async () => {
  const { srv, st } = await bridge('dev', (s) => { s.set('lpstat.out', 'printer index_basic is idle.\n'); s.set('lp-sleep', '1'); });
  try {
    const first = post(srv, '/api/print', 'JOB-ONE');
    await new Promise((r) => setTimeout(r, 400));
    const second = await post(srv, '/api/print', 'JOB-TWO');
    assert.equal(second.status, 429);
    assert.equal(json(second)?.success, false);
    const f = await first;
    assert.equal(f.status, 200);
    fs.rmSync(path.join(st.dir, 'lp-sleep'));
    assert.equal((await post(srv, '/api/print', 'JOB-THREE')).status, 200);
    assert.equal(st.read('lp-payload.bin').toString(), 'JOB-THREE');
  } finally { await srv.stop(); }
});

test('#28 a print queue: the job reaches lp as an argument (no shell), from a temporary file that is removed', async () => {
  const { srv, st } = await bridge('dev', (s) => s.set('lpstat.out', 'printer office is idle.\nprinter braille;touch_PWNED is idle.\n'));
  try {
    const r = await post(srv, '/api/print', 'BRF-DATA');
    assert.equal(r.status, 200); assert.equal(json(r).success, true);
    assert.match(json(r).message, /braille;touch_PWNED/);
    assert.equal(st.read('lp-args.log').toString().trim().split(' ').slice(0, 4).join(' '), '-d braille;touch_PWNED -o raw');
    assert.equal(st.read('lp-payload.bin').toString(), 'BRF-DATA');
    assert.ok(!fs.existsSync(st.read('lp-file.log').toString().trim()), 'the temporary job file was removed');
    assert.ok(!fs.existsSync(path.join(process.cwd(), 'touch_PWNED')) && !fs.existsSync(path.join(st.dir, 'touch_PWNED')), 'nothing was run by a shell');
  } finally { await srv.stop(); }
});
test('#28 a print queue: lp failing is reported as a failure, with its message, and the file is removed', async () => {
  const { srv, st } = await bridge('dev', (s) => { s.set('lpstat.out', 'printer index_basic is idle.\n'); s.set('lp-fail'); });
  try {
    const r = await post(srv, '/api/print', 'BRF');
    assert.equal(r.status, 500); assert.equal(json(r).success, false); assert.match(json(r).error, /printer offline/);
    assert.ok(!fs.existsSync(st.read('lp-file.log').toString().trim()));
  } finally { await srv.stop(); }
});
test('#28 no queue and no USB device: 404 with the reason, and nothing is printed', async () => {
  const { srv, st } = await bridge('dev', (s) => s.set('lpstat.out', 'printer office is idle.\n'));
  try {
    const r = await post(srv, '/api/emboss-usb', 'BRF');
    assert.equal(r.status, 404); assert.equal(json(r).success, false); assert.match(json(r).error, /No USB embosser/);
    assert.ok(st.has('usb-discover.log') && !st.has('usb-args.log') && !st.has('lp-args.log'));
  } finally { await srv.stop(); }
});
test('#28 no lpstat at all (not installed): the USB discovery is still tried', async () => {
  const { srv, st } = await bridge('dev', (s) => s.set('usb-discover.out', 'direct usb://Index/Everest-D?serial=1 "Index Everest-D" "USB"\n'), { EMBOSS_LPSTAT: '/nonexistent/lpstat' });
  try {
    const r = await post(srv, '/api/print', 'FROM-USB');
    assert.equal(r.status, 200, r.body); assert.equal(st.read('usb-stdin.bin').toString(), 'FROM-USB');
  } finally { await srv.stop(); }
});
test('#28 a discovered USB device: the job is written to the backend and success is reported only for exit 0', async () => {
  const { srv, st } = await bridge('dev', (s) => s.set('usb-discover.out', 'direct usb://Index/Everest-D?serial=1 "Index Everest-D" "USB"\n'));
  try {
    const r = await post(srv, '/api/emboss-usb', 'USB-JOB');
    assert.equal(r.status, 200, r.body); assert.equal(json(r).success, true);
    assert.equal(st.read('usb-stdin.bin').toString(), 'USB-JOB');
    assert.equal(st.read('usb-uri.log').toString().trim(), 'usb://Index/Everest-D?serial=1');
    assert.match(st.read('usb-args.log').toString(), /usb-unidir=true/);
  } finally { await srv.stop(); }
});
test('#28 a USB backend that exits non-zero is a failure, not "Successfully embossed"', async () => {
  const { srv, st } = await bridge('dev', (s) => { s.set('usb-discover.out', 'direct usb://Index/Everest-D "x" "y"\n'); s.set('usb-exit', '2'); });
  try {
    const r = await post(srv, '/api/emboss-usb', 'USB-JOB');
    assert.equal(r.status, 500, r.body); assert.equal(json(r).success, false); assert.match(json(r).error, /device offline/);
    assert.ok(!/Successfully/.test(r.body));
    assert.equal(srv.exited, null);
    assert.equal((await get(srv, '/ok.txt')).status, 200);
  } finally { await srv.stop(); }
});
test('#28 a USB backend that cannot be started (spawn failure) is a failure and the server survives', async () => {
  const { srv } = await bridge('dev', (s) => { s.set('usb-discover.out', 'direct usb://Index/Everest-D "x" "y"\n'); s.set('usb-selfdelete'); });
  try {
    const r = await post(srv, '/api/emboss-usb', 'USB-JOB');
    assert.equal(r.status, 500, r.body); assert.equal(json(r).success, false); assert.match(json(r).error, /ENOENT|spawn|not found/i);
    assert.equal(srv.exited, null, 'the server did not crash');
    assert.equal((await get(srv, '/ok.txt')).status, 200);
  } finally { await srv.stop(); }
});
test('#28 a USB backend that stops reading (stdin failure) is a failure, answered once, and the server survives', async () => {
  const { srv } = await bridge('dev', (s) => { s.set('usb-discover.out', 'direct usb://Index/Everest-D "x" "y"\n'); s.set('usb-exit-early', '3'); });
  try {
    const r = await post(srv, '/api/emboss-usb', Buffer.alloc(8 * 1024 * 1024, 66));
    assert.equal(r.status, 500, r.body); assert.equal(json(r).success, false);
    assert.equal(srv.exited, null, 'the server did not crash');
    assert.equal((await get(srv, '/ok.txt')).status, 200);
  } finally { await srv.stop(); }
});
test('#28 a USB backend that never finishes is stopped at the time limit (504)', async () => {
  const { srv, st } = await bridge('dev', (s) => { s.set('usb-discover.out', 'direct usb://Index/Everest-D "x" "y"\n'); }, { EMBOSS_BRIDGE_TIMEOUT_MS: '600' });
  try {
    fs.writeFileSync(st.env.EMBOSS_USB_BACKEND, SH + `if [ $# -eq 0 ]; then echo 'direct usb://Index/Everest-D "x" "y"'; exit 0; fi\nsleep 5\n`);
    const r = await post(srv, '/api/emboss-usb', 'USB-JOB');
    assert.equal(r.status, 504, r.body); assert.equal(json(r).success, false);
    assert.equal((await post(srv, '/api/emboss-usb', 'again')).status, 504, 'and the next job is accepted (the busy flag was released)');
  } finally { await srv.stop(); }
});
