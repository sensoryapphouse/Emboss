#!/usr/bin/env node
// Compare the editor's document model (window.lastModel, saved as JSON from Chrome) with the
// parser's model of the same source file, ignoring representation-only differences (text copies
// beside segments, tf:0, MathML attribute order/whitespace, pagenum text, list kind "number").
// Any remaining difference means the editor changes what gets brailled or saved (A26).
//
//   node Emboss/scripts/compare-editor-model.mjs <source.xml> <editor-model.json>
import fs from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;
const { parseDtbook } = await import('../input/parse.mjs');
const [srcPath, edPath] = process.argv.slice(2);
if (!srcPath || !edPath) { console.error('usage: compare-editor-model.mjs <source.xml> <editor-model.json>'); process.exit(2); }
const src = parseDtbook(fs.readFileSync(srcPath, 'utf8')).blocks;
const ed = JSON.parse(fs.readFileSync(edPath, 'utf8'));
const mm = (x) => (x || '').replace(/\s+/g, ' ').replace(/<([\w:]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g, (m, t, a, sl) => `<${t}${(a.match(/[\w:-]+="[^"]*"/g) || []).sort().map((z) => ` ${z}`).join('')}${sl}>`);
const segN = (s) => {                                   // adjacent runs of the same form merge; line breaks (\n) are content
  const out = [];
  for (const g of s || []) {
    const x = g.type === 'text' ? { t: g.text.replace(/[^\S\n]+/g, ' '), f: g.tf || 0, u: !!g.uncontracted } : g.type === 'math' ? { m: mm(g.mathml) } : g;
    const last = out[out.length - 1];
    if (x.t != null && last && last.t != null && last.f === x.f && last.u === x.u) last.t = (last.t + x.t).replace(/ ?\n ?/g, '\n').replace(/ +/g, ' ');
    else out.push(x.t != null ? { ...x, t: x.t.replace(/ ?\n ?/g, '\n') } : x);
  }
  if (out.length && out[0].t != null) out[0].t = out[0].t.replace(/^ +/, '');
  if (out.length && out[out.length - 1].t != null) out[out.length - 1].t = out[out.length - 1].t.replace(/ +$/, '');
  return out.filter((x) => x.t == null || x.t !== '');
};
const cellN = (c) => (c && typeof c === 'object' ? { segments: segN(c.segments) } : c);
const norm = (b) => {
  if (!b) return b;
  const c = { ...b };
  if (c.kind === 'number') { delete c.kind; delete c.style; }
  // The same style under two names, or a style that only repeats the block type.
  if (c.style === 'play-speaker') c.style = 'dialogue';
  if (c.style === 'verse') c.style = 'poem';
  if (c.style && c.style === c.type) delete c.style;
  if (c.style === 'play-stage' && c.type === 'stage') delete c.style;
  if (c.type === 'indicator') c.type = 'break';                          // the formatter treats both alike
  if (c.level === 0) delete c.level;
  if (c.type === 'pagenum') delete c.text;
  if (c.segments) { c.segments = segN(c.segments); delete c.text; }
  if (c.captionSegments) c.captionSegments = segN(c.captionSegments);
  if (c.items) c.items = c.items.map((it) => {
    const x = { ...it };
    if (x.term != null || x.def != null) {                           // glossary entry: term and definition are the content
      x.termSegments = segN(x.termSegments || [{ type: 'text', text: x.term || '' }]);
      x.defSegments = segN(x.defSegments || [{ type: 'text', text: x.def || '' }]);
      delete x.segments; delete x.text;
    }
    for (const k of ['termSegments', 'defSegments']) if (x[k] && x[k][0] && x[k][0].type) x[k] = segN(x[k]);
    if (x.segments) { x.segments = segN(x.segments); delete x.text; } else if (x.text) x.text = x.text.replace(/\s+/g, ' ').trim();
    if (x.termSegments && !x.segments) delete x.text;
    return x;
  });
  if (c.headers) c.headers = c.headers.map(cellN);
  if (c.rows) c.rows = c.rows.map((r) => r.map(cellN));
  if (c.blocks) c.blocks = c.blocks.map(norm);
  if (c.type === 'math') { c.mathml = mm(c.mathml); delete c.latex; }
  if (c.text) c.text = c.text.replace(/\s+/g, ' ').trim();
  return c;
};
// Stable stringify: object key order is not content.
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const kinds = {};
let shown = 0;
if (src.length !== ed.length) console.log(`block count: parser ${src.length}, editor ${ed.length}`);
for (let i = 0; i < Math.max(src.length, ed.length); i++) {
  const a = stable(norm(src[i])); const b = stable(norm(ed[i]));
  if (a === b) continue;
  const k = src[i] ? src[i].type : '(none)';
  kinds[k] = (kinds[k] || 0) + 1;
  if (kinds[k] === 1 && shown++ < 12) { let j = 0; while (a && b && a[j] === b[j]) j++; console.log(`#${i}\n  parser ${String(a).slice(Math.max(0, j - 120), j + 160)}\n  editor ${String(b).slice(Math.max(0, j - 120), j + 160)}`); }
}
console.log(Object.keys(kinds).length ? `differences by block type: ${JSON.stringify(kinds)}` : `identical (${src.length} blocks)`);
process.exit(Object.keys(kinds).length ? 1 : 0);
