// Minimal static file server for local dev / webview host.
// Serves the project root so the PWA under /web can import ../engine, ../format,
// ../input and fetch ../liblouis/tables. Sets the MIME types that matter for ES
// modules (.mjs) and WebAssembly (.wasm).
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || process.argv[2] || 8137);

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

http.createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    
    // CORS headers for local bridge calls
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    // Direct USB Embosser Print Bridge for native USB Printer Class devices (Index V5, ViewPlus, etc.)
    if (req.method === 'POST' && (rel === '/api/emboss-usb' || rel === '/api/print')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = Buffer.concat(chunks);

      const { execFile, exec } = await import('child_process');
      const { writeFileSync, unlinkSync } = await import('fs');
      const { tmpdir } = await import('os');
      const { join } = await import('path');

      // Check if a registered embosser print queue exists on the system
      exec('lpstat -p', (err, stdout, stderr) => {
        let queue = null;
        if (stdout) {
          const lines = stdout.split('\n');
          for (const line of lines) {
            const m = line.match(/^printer\s+([^\s]+)/i);
            if (m && (m[1].toLowerCase().includes('index') || m[1].toLowerCase().includes('braille') || m[1].toLowerCase().includes('emboss'))) {
              queue = m[1];
              break;
            }
          }
        }

        if (queue) {
          const tmpFile = join(tmpdir(), `emboss_job_${Date.now()}.brf`);
          writeFileSync(tmpFile, payload);
          exec(`lp -d "${queue}" -o raw "${tmpFile}"`, (lpErr, lpOut, lpStderr) => {
            try { unlinkSync(tmpFile); } catch {}
            if (lpErr) {
              res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ success: false, error: lpStderr || lpErr.message }));
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ success: true, message: `Successfully embossed to printer queue ${queue}` }));
            }
          });
        } else {
          // Direct backend fallback
          execFile('/usr/libexec/cups/backend/usb', (bErr, bStdout, bStderr) => {
            const match = bStdout && bStdout.match(/direct\s+(usb:\/\/[^\s\"]+)/);
            if (match) {
              const deviceUri = match[1];
              const { spawn } = require('child_process');
              const proc = spawn('/usr/libexec/cups/backend/usb', ['1', 'Emboss', 'Braille Job', '1', 'usb-unidir=true'], {
                env: { ...process.env, DEVICE_URI: deviceUri }
              });
              proc.stdin.write(payload);
              proc.stdin.end();
              proc.on('close', (code) => {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ success: true, message: `Successfully embossed to ${deviceUri}` }));
              });
              proc.on('error', (err) => {
                res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ success: false, error: err.message }));
              });
            } else {
              res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ success: false, error: 'No USB embosser found on macOS USB ports' }));
            }
          });
        }
      });
      return;
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
    let abs = path.join(ROOT, rel);
    if (!abs.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    let data;
    try { 
      data = await fs.readFile(abs); 
    } catch { 
      // Fallback: check ROOT/web/ (e.g. /tactile-assets/..., /fonts/..., /vendor/...)
      const webAbs = path.join(ROOT, 'web', rel);
      try {
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
    res.writeHead(500).end(String(e));
  }
}).listen(PORT, () => console.log(`serving ${ROOT} at http://localhost:${PORT}/  (app: /web/index.html)`));
