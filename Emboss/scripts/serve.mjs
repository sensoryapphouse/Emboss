// Minimal static file server for local dev / webview host.
// Serves the project root so the PWA under /web can import ../engine, ../format,
// ../input and fetch ../liblouis/tables. Sets the MIME types that matter for ES
// modules (.mjs) and WebAssembly (.wasm).
//
// S1 security batch (ChatGPT audit of 15 Oct 2026, Paul's decision F2: security first):
//  #25  a file is served only if its real path lies inside the root (path.relative, not a string prefix: a sibling folder
//       "<root>-private" used to pass), and the server listens on 127.0.0.1 only. HOST=0.0.0.0 (or a LAN address) is the deliberate
//       way to reach it from another machine. Symlinks: the real path must stay inside the root, with ONE exception — a symlink that
//       is itself a top-level entry of the root and points at a directory (this repo's Emboss/liblouis -> ../liblouis) may lead to its own target, and only
//       inside that target.
//  #27  the print bridge (/api/print, /api/emboss-usb) answers only a same-origin page on this server's own address: Host and Origin
//       must name localhost / 127.0.0.1 / [::1] on this port (any IP address in LAN mode — an IP literal cannot be DNS-rebound),
//       no CORS headers are sent, the body is capped (BRIDGE_MAX_BYTES, 16 MB) and one job runs at a time (429 while busy).
//  #28  the USB fallback imports spawn (it used require() in an ES module and crashed), handles spawn, stdin and exit errors, and
//       reports success only when the backend exited 0. Commands run without a shell.
//  Test seams (env, only the person starting the server sets them): EMBOSS_LPSTAT, EMBOSS_LP, EMBOSS_USB_BACKEND replace the
//  lpstat / lp / CUPS usb backend programs; EMBOSS_BRIDGE_TIMEOUT_MS the backend time limit.
import http from 'http';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFile, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || process.argv[2] || 8137);
const HOST = process.env.HOST || '127.0.0.1';
const LAN_MODE = !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(HOST);
const BRIDGE_MAX_BYTES = 16 * 1024 * 1024;
const BRIDGE_TIMEOUT_MS = Number(process.env.EMBOSS_BRIDGE_TIMEOUT_MS || 60000);
const LPSTAT = process.env.EMBOSS_LPSTAT || 'lpstat';
const LP = process.env.EMBOSS_LP || 'lp';
const USB_BACKEND = process.env.EMBOSS_USB_BACKEND || '/usr/libexec/cups/backend/usb';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.brf': 'text/plain; charset=utf-8',
  // BrlDuet's sampled instrument notes (#102). decodeAudioData sniffs the bytes
  // and would accept these as octet-stream, but a dev server that types them
  // differently from the host serving them is one less thing that matches.
  '.mp3': 'audio/mpeg',
};
// liblouis table extensions -> plain text
for (const e of ['.cti', '.ctb', '.uti', '.dis', '.tbl', '.utb', '.uti', '.dic', '.cti']) MIME[e] = 'text/plain; charset=utf-8';

// ---- path containment (#25) ----
// True when `target` is `base` itself or lies below it — by path.relative, so "/a/root-private" is not inside "/a/root".
function isInside(base, target) {
  const r = path.relative(base, target);
  return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r));
}
let rootRealP = null;
async function rootReal() { return (rootRealP ||= fs.realpath(ROOT)); }
// The absolute file for URL path `rel` ("/web/x.js"), or null when it is not inside the root. `rel` is already percent-decoded.
async function resolveInside(rel) {
  if (rel.includes('\0')) return null;
  const abs = path.join(ROOT, rel);
  if (!isInside(ROOT, abs)) return null;
  let real;
  try { real = await fs.realpath(abs); } catch { return abs; }            // not there: the caller's read says 404
  const rr = await rootReal();
  if (isInside(rr, real)) return abs;
  // A top-level symlink of the root (Emboss/liblouis -> ../liblouis) may lead to its own target — and only inside that target.
  const seg = path.relative(ROOT, abs).split(path.sep)[0];
  if (seg) {
    try {
      const top = path.join(ROOT, seg);
      if ((await fs.lstat(top)).isSymbolicLink() && (await fs.stat(top)).isDirectory() && isInside(await fs.realpath(top), real)) return abs;
    } catch { /* not a link */ }
  }
  return null;
}

// ---- the print bridge's access control (#27) ----
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const isIpLiteral = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith('[');
function hostAllowed(hostname) {
  const h = String(hostname).toLowerCase();
  return LOOPBACK.has(h) || (LAN_MODE && isIpLiteral(h));
}
// A bridge request must come from a page this server itself served: Host and Origin both name this server, on this port.
function bridgeRequestAllowed(req) {
  let host, origin;
  try { host = new URL('http://' + (req.headers.host || '')); } catch { return false; }
  if (!hostAllowed(host.hostname) || (host.port || '80') !== String(PORT)) return false;
  const o = req.headers.origin;
  if (!o) return false;                                                    // a browser always sends Origin on a POST; a script that does not is not the page
  try { origin = new URL(o); } catch { return false; }
  if (origin.protocol !== 'http:' || origin.host.toLowerCase() !== host.host.toLowerCase()) return false;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') return false;
  return true;
}

const sendJson = (res, status, obj) => {
  if (res.headersSent) { try { res.end(); } catch { /* gone */ } return; }
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    try { execFile(file, args, { timeout: 30000, maxBuffer: 1 << 20, ...opts }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })); }
    catch (err) { resolve({ err, stdout: '', stderr: '' }); }
  });
}

// Reads the request body up to BRIDGE_MAX_BYTES; null (after answering 413) when it is larger.
async function readBody(req, res) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > BRIDGE_MAX_BYTES) { sendJson(res, 413, { success: false, error: 'Print job too large' }); req.resume(); return null; }
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BRIDGE_MAX_BYTES) { sendJson(res, 413, { success: false, error: 'Print job too large' }); req.resume(); return null; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Sends `payload` to the first embosser-looking print queue; otherwise straight to a USB printer through the CUPS usb backend.
async function printPayload(payload) {
  const st = await run(LPSTAT, ['-p']);
  let queue = null;
  for (const line of st.stdout.split('\n')) {
    const m = line.match(/^printer\s+([^\s]+)/i);
    if (m && /index|braille|emboss/i.test(m[1])) { queue = m[1]; break; }
  }
  if (queue) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'emboss_job_'));
    const tmpFile = path.join(dir, 'job.brf');
    try {
      await fs.writeFile(tmpFile, payload, { mode: 0o600 });
      const lp = await run(LP, ['-d', queue, '-o', 'raw', tmpFile]);
      if (lp.err) return { status: 500, body: { success: false, error: lp.stderr.trim() || lp.err.message } };
      return { status: 200, body: { success: true, message: `Successfully embossed to printer queue ${queue}` } };
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  // Direct backend fallback: with no arguments the CUPS usb backend lists the devices it can see.
  const disc = await run(USB_BACKEND, []);
  const match = disc.stdout.match(/direct\s+(usb:\/\/[^\s"]+)/);
  if (!match) return { status: 404, body: { success: false, error: 'No USB embosser found on macOS USB ports' } };
  const deviceUri = match[1];
  return await new Promise((resolve) => {
    let settled = false;
    const done = (status, body) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ status, body }); } };
    let proc;
    let stderr = '';
    const timer = setTimeout(() => { done(504, { success: false, error: 'The USB backend did not finish in time' }); try { proc && proc.kill('SIGKILL'); } catch { /* gone */ } }, BRIDGE_TIMEOUT_MS);
    try {
      proc = spawn(USB_BACKEND, ['1', 'Emboss', 'Braille Job', '1', 'usb-unidir=true'], { env: { ...process.env, DEVICE_URI: deviceUri } });
    } catch (e) { done(500, { success: false, error: String(e && e.message || e) }); return; }
    proc.on('error', (e) => done(500, { success: false, error: e.message }));
    proc.stderr && proc.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += d; });
    proc.stdout && proc.stdout.on('data', () => {});
    proc.stdin.on('error', (e) => done(500, { success: false, error: 'Could not send the job to the USB backend: ' + e.message }));
    proc.on('close', (code, signal) => {
      if (code === 0) done(200, { success: true, message: `Successfully embossed to ${deviceUri}` });
      else done(500, { success: false, error: stderr.trim() || (signal ? `The USB backend was stopped (${signal})` : `The USB backend failed (exit code ${code})`) });
    });
    try { proc.stdin.end(payload); } catch (e) { done(500, { success: false, error: e.message }); }
  });
}

let printing = false;
// Answer a refused bridge request only after its body has been read and thrown away: answering first can reset the connection while the
// page is still sending, and the page then sees a network error instead of the reason.
function refuse(req, res, status, body, headers = {}) {
  let done = false;
  const answer = () => { if (done) return; done = true; for (const [k, v] of Object.entries(headers)) res.setHeader(k, v); sendJson(res, status, body); };
  req.on('end', answer); req.on('error', answer); req.on('close', answer);
  req.resume();
}
async function handleBridge(req, res) {
  if (!bridgeRequestAllowed(req)) { refuse(req, res, 403, { success: false, error: 'The print bridge answers only the Emboss page served by this server' }); return; }
  if (printing) { refuse(req, res, 429, { success: false, error: 'Another print job is running' }, { 'Retry-After': '5' }); return; }
  printing = true;
  try {
    const payload = await readBody(req, res);
    if (payload === null) return;
    const out = await printPayload(payload);
    sendJson(res, out.status, out.body);
  } catch (e) {
    sendJson(res, 500, { success: false, error: String(e && e.message || e) });
  } finally {
    printing = false;
  }
}

// The decoded path of the request target, or null when it is not an origin-form path ("/…") or has a bad percent escape.
function requestPath(target) {
  if (typeof target !== 'string' || target[0] !== '/') return null;       // not "/path": never read a host out of the request line
  const raw = target.split(/[?#]/, 1)[0];
  try { return decodeURIComponent(raw); } catch { return null; }
}

const server = http.createServer(async (req, res) => {
  try {
    let rel = requestPath(req.url);
    if (rel === null) { res.writeHead(400, { 'Content-Type': 'text/plain' }).end('bad request'); return; }
    // The dev server serves unbuilt source: answer build-info.json (written only into dist/ by build-dist.mjs) with
    // "no build" so Help shows "development" without a 404 in the console.
    if (rel === '/build-info.json') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"hash":null}'); return; }

    // No CORS: the bridge is for the page this server serves (same origin), so a cross-origin preflight gets no permission.
    if (req.method === 'OPTIONS') { res.writeHead(204, { Allow: 'GET, POST' }); res.end(); return; }

    // Direct USB Embosser Print Bridge for native USB Printer Class devices (Index V5, ViewPlus, etc.)
    // Off unless the server was started with EMBOSS_PRINT_BRIDGE=1 (Paul, 15 Oct 2026, S3C-Q1: test runs against this server sent real
    // jobs to the Index embosser's queue). The editor and Quick Mode no longer use it; Word's spooler falls back to it only when it is on.
    if (req.method === 'POST' && (rel === '/api/emboss-usb' || rel === '/api/print')) {
      if (process.env.EMBOSS_PRINT_BRIDGE !== '1') { refuse(req, res, 403, { success: false, error: 'The print bridge is off. Start the server with EMBOSS_PRINT_BRIDGE=1 to print through it.' }); return; }
      await handleBridge(req, res); return;
    }
    // '/' is Emboss's app, which is what this server was originally written for.
    // ANY OTHER directory URL gets its index.html — /connector/ and /BrlDuet/
    // both rely on that, and so do their manifests (start_url) and service
    // workers (which precache the directory URL itself, not just index.html).
    //
    // Added after switching the dev launcher from `python3 -m http.server`,
    // which serves directory indexes for free, to this server, which sends the
    // no-store headers that stop a browser reusing a stale module. Without this
    // line the swap traded one silent failure for a loud one: /BrlDuet/ 404ed
    // and the app looked like it had vanished.
    if (rel === '/') rel = '/web/index.html';
    else if (rel === '/favicon.ico') rel = '/web/logo.svg';
    else if (rel.endsWith('/')) rel += 'index.html';
    let abs = await resolveInside(rel);
    if (!abs) { res.writeHead(403).end('forbidden'); return; }
    let data;
    try {
      data = await fs.readFile(abs);
    } catch {
      // Fallback: check ROOT/web/ (e.g. /tactile-assets/..., /fonts/..., /vendor/...)
      const webAbs = await resolveInside('/web' + (rel.startsWith('/') ? rel : '/' + rel));
      try {
        if (!webAbs) throw new Error('outside');
        data = await fs.readFile(webAbs);
        abs = webAbs;
      } catch {
        res.writeHead(404).end('not found: ' + rel);
        return;
      }
    }
    const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    // no-store (not just no-cache): dev server must never let a browser reuse a
    // stale module. no-cache still let Safari serve an old brf-ascii.mjs whose
    // exports didn't match a freshly-versioned editor.mjs → "binding not found".
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-store, must-revalidate' };
    // The service worker lives at /web/sw.js but claims scope '/' (it must cover
    // /engine, /format, /input and /liblouis too). A worker's default maximum scope
    // is its own directory, so without this header the browser rejects the
    // registration outright and the app is never available offline in this layout
    // (the dist layout has sw.js at the root, so it needs nothing).
    if (rel === '/web/sw.js') headers['Service-Worker-Allowed'] = '/';
    res.writeHead(200, headers);
    res.end(data);
  } catch (e) {
    try { res.writeHead(500).end(String(e)); } catch { /* the connection is gone */ }
  }
});
server.on('error', (e) => { console.error(`cannot listen on ${HOST}:${PORT}: ${e.message}`); process.exit(1); });
server.listen(PORT, HOST, () => console.log(`serving ${ROOT} at http://localhost:${PORT}/  (app: /web/index.html)` + (LAN_MODE ? `  [listening on ${HOST}: reachable from other machines]` : '')));
