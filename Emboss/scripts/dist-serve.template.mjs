// Emboss local server. Run:  node serve.mjs
// (Emboss/scripts/dist-serve.template.mjs is copied to dist/serve.mjs by build-dist.mjs; tests/local_servers.test.mjs runs it.)
// It serves THIS directory and nothing else, to this computer only: it listens on 127.0.0.1 unless HOST says otherwise
// (HOST=0.0.0.0 is the deliberate way to reach it from another machine), a file is served only if its real path (symlinks
// resolved) lies inside this directory, and a request it cannot understand gets a 400, never a crash.
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.argv[2] || 8137);
const HOST = process.env.HOST || '127.0.0.1';
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.wasm':'application/wasm',
  '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8',
  '.svg':'image/svg+xml' };
for (const e of ['.cti','.ctb','.uti','.dis','.tbl','.utb','.dic','.txt','.md','.brf']) MIME[e]='text/plain; charset=utf-8';
// True when target is base or lies below it (path.relative, not a string prefix: "/a/root-private" is not inside "/a/root").
const isInside = (base, target) => { const r = path.relative(base, target); return r === '' || (r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r)); };
const rootReal = fs.realpath(ROOT);
http.createServer(async (req,res)=>{
  try{
    const target = req.url;
    if (typeof target !== 'string' || target[0] !== '/') { res.writeHead(400).end('bad request'); return; }
    let rel;
    try { rel = decodeURIComponent(target.split(/[?#]/, 1)[0]); } catch { res.writeHead(400).end('bad request'); return; }
    if (rel.includes('\0')) { res.writeHead(400).end('bad request'); return; }
    if(rel==='/')rel='/editor/index.html';
    else if(rel==='/favicon.ico')rel='/logo.svg';
    const abs=path.join(ROOT,rel);
    if(!isInside(ROOT,abs)){res.writeHead(403).end('forbidden');return;}
    let data;
    try{
      const real=await fs.realpath(abs);
      if(!isInside(await rootReal,real)){res.writeHead(403).end('forbidden');return;}
      data=await fs.readFile(abs);
    }catch{res.writeHead(404).end('not found: '+rel);return;}
    res.writeHead(200,{'Content-Type':MIME[path.extname(abs).toLowerCase()]||'application/octet-stream','Cache-Control':'no-cache'});
    res.end(data);
  }catch(e){ try{res.writeHead(500).end('error');}catch{} }
}).on('error',(e)=>{ console.error('Emboss cannot start on '+HOST+':'+PORT+': '+e.message); process.exit(1); })
.listen(PORT,HOST,()=>{
  const targetUrl = 'http://localhost:' + PORT + '/editor/index.html';
  console.log('Emboss running at ' + targetUrl + (HOST==='127.0.0.1' ? '' : '  [listening on '+HOST+': reachable from other machines]'));
  if (process.env.NO_OPEN !== '1') {
    if (process.platform === 'darwin') exec('open ' + targetUrl);
    else if (process.platform === 'win32') exec('start ' + targetUrl);
    else exec('xdg-open ' + targetUrl);
  }
});
