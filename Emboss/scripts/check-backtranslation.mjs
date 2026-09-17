#!/usr/bin/env node
// Compare blind back-translations of the interface strings with the English source.
//   node Emboss/scripts/check-backtranslation.mjs <dir-with-<code>.json> [--min 0.34] [--top 40]
// A back-translation file has en.json's keys with the string rendered back into English by
// an agent that never saw en.json, plus optional "_flags" (keys the agent found garbled or
// in the wrong language) and "_terminology". For every key the script scores the word
// overlap between the back-translation and the English (placeholders, names and punctuation
// ignored) and prints, per language, the flagged keys and the lowest-scoring strings with
// both texts, so a reviewer reads only the suspects. A low score is a prompt to look, not a
// verdict: short strings and legitimate rewordings score low too.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : Number(args[i + 1]); };
const MIN = opt('--min', 0.34), TOP = opt('--top', 40);
if (!dir) { console.error('usage: check-backtranslation.mjs <dir> [--min 0.34] [--top 40]'); process.exit(2); }

const flat = (d, p = '', o = {}) => {
  for (const [k, v] of Object.entries(d || {})) {
    if (k.startsWith('_')) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, `${p}${k}.`, o);
    else o[p + k] = v;
  }
  return o;
};
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'be', 'this', 'that', 'it', 'with', 'as', 'at', 'by', 'from', 'your', 'you', 'will', 'has', 'have', 'not', 'no']);
const NAMES = /\b(emboss|bana|ukaaf|ueb|nimas|daisy|dtbook|brf|pef|ebraille|mathml|latex|svg|nemeth|liblouis|mathlive|dotpad|monarch|braillo|viewplus|tiger|index|romeo|juliet|aph|webhid|webserial|ble|gatt|usb|hid|tcp|http|rest|ip|pdf|zip|xml|json)\b/g;
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');
const words = (s) => new Set(String(s).toLowerCase().replace(/\{\w+\}/g, ' ').replace(NAMES, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w && !STOP.has(w)).map(stem));
const score = (a, b) => {
  const A = words(a), B = words(b);
  if (!A.size && !B.size) return 1;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / Math.max(A.size, B.size);
};

const en = flat(JSON.parse(fs.readFileSync(path.join(ROOT, 'web/locales/en.json'), 'utf8')));
let totalLow = 0, totalFlag = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const code = f.replace(/\.json$/, '');
  const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const bt = flat(raw);
  const flags = Array.isArray(raw._flags) ? raw._flags : [];
  const rows = Object.keys(en).map((k) => ({ k, s: k in bt ? score(en[k], bt[k]) : -1, en: en[k], bt: bt[k] }));
  const missing = rows.filter((r) => r.s < 0);
  const low = rows.filter((r) => r.s >= 0 && r.s < MIN).sort((a, b) => a.s - b.s);
  totalLow += low.length; totalFlag += flags.length;
  console.log(`\n== ${code}: ${rows.length - missing.length} strings back-translated, ${missing.length} missing, ${flags.length} flagged by the agent, ${low.length} below ${MIN} overlap`);
  for (const fl of flags) console.log(`  FLAG ${typeof fl === 'string' ? fl : JSON.stringify(fl)}`);
  if (raw._terminology) console.log(`  terms: ${JSON.stringify(raw._terminology).slice(0, 400)}`);
  for (const r of low.slice(0, TOP)) console.log(`  ${r.s.toFixed(2)} ${r.k}\n       en: ${r.en}\n       bt: ${r.bt}`);
  if (low.length > TOP) console.log(`  … ${low.length - TOP} more below ${MIN}`);
}
console.log(`\ntotal: ${totalLow} low-overlap strings, ${totalFlag} agent flags`);
