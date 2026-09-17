#!/usr/bin/env node
// Check interface translations against web/locales/en.json.
//   node scripts/check-locale.mjs fr de …     (no codes: every file in web/locales)
// A translation passes when
//   - it is valid JSON with exactly the English keys (none missing, none extra);
//   - every value is a non-empty string;
//   - every value keeps the English value's {placeholders}, and its leading/trailing spaces;
//   - fewer than 10% of values are identical to English (names such as "BANA" may be).
// Exit 1 if any file fails. `_meta` is ignored (gen-all-locales.mjs --stamp-only writes it).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'locales');
const flat = (d, p = '', o = {}) => {
  for (const [k, v] of Object.entries(d || {})) {
    if (k === '_meta') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, `${p}${k}.`, o);
    else o[p + k] = v;
  }
  return o;
};
const placeholders = (s) => [...String(s).matchAll(/\{[a-zA-Z_]+\}/g)].map((m) => m[0]).sort().join(' ');
const edges = (s) => `${/^\s/.test(s) ? 'lead' : ''}|${/\s$/.test(s) ? 'trail' : ''}`;

const en = flat(JSON.parse(fs.readFileSync(path.join(DIR, 'en.json'), 'utf8')));
const keys = Object.keys(en);
const codes = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'en.json').map((f) => f.slice(0, -5));
let failed = 0;
for (const code of codes) {
  const problems = [];
  let d;
  try { d = flat(JSON.parse(fs.readFileSync(path.join(DIR, `${code}.json`), 'utf8'))); } catch (e) { problems.push(`not readable JSON: ${e.message}`); }
  if (d) {
    const missing = keys.filter((k) => !(k in d));
    const extra = Object.keys(d).filter((k) => !(k in en));
    if (missing.length) problems.push(`${missing.length} missing keys (e.g. ${missing.slice(0, 5).join(', ')})`);
    if (extra.length) problems.push(`${extra.length} extra keys (e.g. ${extra.slice(0, 5).join(', ')})`);
    for (const k of keys) {
      if (!(k in d)) continue;
      const v = d[k];
      if (typeof v !== 'string' || !v.trim()) { problems.push(`${k}: empty or not a string`); continue; }
      if (placeholders(v) !== placeholders(en[k])) problems.push(`${k}: placeholders ${placeholders(v) || '(none)'} ≠ ${placeholders(en[k]) || '(none)'}`);
      if (edges(v) !== edges(en[k])) problems.push(`${k}: leading/trailing space differs from English`);
    }
    const same = keys.filter((k) => d[k] === en[k]);
    if (same.length >= keys.length * 0.1) problems.push(`${same.length} of ${keys.length} values are still English (e.g. ${same.slice(0, 5).join(', ')})`);
    if (!problems.length) console.log(`ok    ${code}  (${keys.length} strings, ${same.length} same as English)`);
  }
  if (problems.length) {
    failed++;
    console.log(`FAIL  ${code}`);
    for (const p of problems.slice(0, 20)) console.log(`      ${p}`);
    if (problems.length > 20) console.log(`      … ${problems.length - 20} more`);
  }
}
process.exit(failed ? 1 : 0);
