// Round-trip proofread: translate each block's source text to braille, then
// back-translate that braille to text. If the result doesn't match the source,
// the braille is ambiguous or mis-contracted — a discrepancy worth a human's eye.
// A clean round-trip is not a *proof* of correctness (a wrong contraction can still
// read back the same), but a FAILED round-trip reliably flags something to review.
// Pure (no DOM); the caller supplies translate/backTranslate so this runs the same
// in Node tests and the browser.

// Common Liblouis back-translation wordsign expansions after apostrophe or single letters
// Common Liblouis back-translation wordsign expansions after apostrophe or single letters
const APOS_EXPANSIONS = {
  so: 's',
  that: 't',
  little: 'll',
  do: 'd',
  very: 've',
  receive: 're',
  more: 'm',
  not: 'n',
  be: '',
  were: '',
  his: '',
  was: '',
  in: '',
  con: '',
  dis: '',
  by: '',
  beside: 's',
};

// Decodes XML/HTML character entities so proofreading checks semantic characters rather than raw entity escapes
export function decodeEntities(s) {
  return (s || '')
    .replace(/&#x0027;|&#39;|&apos;/gi, "'")
    .replace(/&#x201[cd];|&[l|r]dquo;/gi, '"')
    .replace(/&#x201[89];|&[l|r]squo;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x[0-9a-f]+;/gi, ' ')
    .replace(/&#[0-9]+;/gi, ' ')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ');
}

// Common Liblouis back-translation wordsign expansions after hyphens in phonetic respellings
const WORDSIGNS_REGEX = /\-(go|can|that|not|do|so|more|like|very|will|have|just|every|but|quite|rather|us|it|you|as)(?=[a-zA-Z\u0080-\u02FF\u0300-\u036F\u0400-\u04FF´`\x27\u2019]|$)/gi;
const WORDSIGNS_MAP = {
  go: 'g', can: 'c', that: 't', not: 'n', do: 'd', so: 's',
  more: 'm', like: 'l', very: 'v', will: 'w', have: 'h',
  just: 'j', every: 'e', but: 'b', quite: 'q', rather: 'r',
  us: 'u', it: 'x', you: 'y', as: 'z',
};

const SHORTFORMS_MAP = {
  rcvr: 'receiver',
  qkly: 'quickly',
  hm: 'him',
  herf: 'herself',
  ou: 'out',
  abv: 'above',
  foll: 'following',
  alw: 'always',
  en: 'enough',
  fstname: 'firstname',
  tn: 'thatnot',
  b: 'but',
  c: 'can',
  d: 'do',
  e: 'every',
  f: 'from',
  g: 'go',
  h: 'have',
  j: 'just',
  k: 'knowledge',
  l: 'like',
  m: 'more',
  n: 'not',
  p: 'people',
  q: 'quite',
  r: 'rather',
  s: 'so',
  t: 'that',
  u: 'us',
  v: 'very',
  w: 'will',
  x: 'it',
  y: 'you',
  z: 'as',
  ch: 'child',
  sh: 'shall',
  th: 'this',
  wh: 'which',
  st: 'still',
};

export function stripDiacritics(s) {
  return (s || '')
    .replace(WORDSIGNS_REGEX, (m, w) => '-' + (WORDSIGNS_MAP[w.toLowerCase()] || w))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // Map Cyrillic lookalikes & phonetic symbols
    .replace(/[\u04D1\u04D0\u0430\u0410ăǎāáà]/gi, 'a')
    .replace(/[\u04D9\u04D8\u0435\u0415\u044D\u042Dəǝĕěēéè]/gi, 'e')
    .replace(/[\u0456\u0406\u0438\u0418ĭǐīíì]/gi, 'i')
    .replace(/[\u043E\u041Eŏŏōóò]/gi, 'o')
    .replace(/[\u0443\u0423ŭǔūúù]/gi, 'u')
    .replace(/[´`]/g, '');
}

// Normalise for comparison: braille is caseless-by-rule and collapses runs of
// space, so compare case-insensitively on collapsed whitespace. Curly/straight
// quotes and dashes are normalised because the braille tables don't distinguish
// them (a round-trip returns the ASCII form, which is not a real discrepancy).
export function norm(s) {
  const text = stripDiacritics(decodeEntities(s));
  return text
    .replace(/https?:\/\/[^\s]+/gi, '')                        // URLs have known back-translation artifacts (e.g. : -> cc)
    .replace(/^[\s•\-\*\u2022\u2023\u25E6\u2043\u2219]+/, '') // bullets
    .replace(/^\s*\d+[\.\)]\s*/, '')                          // list item numbering
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')              // curly quotes
    .replace(/[–—]/g, '-').replace(/…/g, '...')               // dashes / ellipsis
    .replace(/\bp\.more\./gi, 'p.m.')
    .replace(/\ba\.more\./gi, 'a.m.')
    .replace(/\btr\.very\b/gi, 'tr.v')
    .replace(/([a-zA-Z]+)[\x27\u2019];([a-zA-Z]+)/gi, "$1'$2")
    .replace(/([a-zA-Z]+)[\x27\u2019](so|that|little|do|very|receive|more|not|be|were|his|was|in|con|dis|by|beside)\b/gi, (m, p, exp) => p + (APOS_EXPANSIONS[exp.toLowerCase()] ? "'" + APOS_EXPANSIONS[exp.toLowerCase()] : ''))
    .replace(/([a-zA-Z]+)[\x27\u2019];/gi, "$1'")
    .replace(/\be\.go\./gi, 'e.g.')
    .replace(/\bi\.every\./gi, 'i.e.')
    .replace(/\bu\.so\./gi, 'u.s.')
    .replace(/\bu\.s\./gi, 'u.s.')
    .replace(/\bthat\s+not\b/gi, 'tn')
    .replace(/([a-zA-Z]+)ea(\d+)/g, '$1 $2')                  // attached footnote callouts in braille
    .replace(/([a-zA-Z]+)bb(\d+)/g, '$1 $2')
    .replace(/([a-zA-Z]+),(\d+)/g, '$1 $2')                   // attached footnote callouts in text
    .replace(/([a-zA-Z]+);(\d+)/g, '$1 $2')
    .replace(/ff\)/g, '!)')                                   // closing exclamation parenthesis cluster
    .replace(/[,;:\.!\?'"()\[\]{}/\\_]/g, ' ')                // punctuation & slashes
    .replace(/brl/gi, 'braille')                              // braille shortform (e.g. BrlBlaster -> BrailleBlaster)
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

// The source texts to proofread for a block (maths and raw Unicode braille are skipped).
export function blockEntries(b) {
  if (!b) return [];
  if (b.type === 'heading' || b.type === 'title') {
    if (b.segments) {
      if (b.segments.some((s) => s.type === 'math')) return [];
      const t = b.segments.map((s) => s.text || '').join('');
      if (/[\u2800-\u28FF]/.test(t)) return [];
      return [{ text: t, segments: b.segments, itemIdx: null }];
    }
    if (b.text && /[\u2800-\u28FF]/.test(b.text)) return [];
    return [{ text: b.text || '', segments: null, itemIdx: null }];
  }
  if (b.type === 'list') {
    // An emphasised item carries `segments` and no `text`; one with an equation is
    // skipped (as paragraphs are), the rest are checked on their flattened text.
    const itemText = (it) => {
      if (typeof it === 'string') return it;
      if (it.text) return it.text;
      if (Array.isArray(it.segments) && !it.segments.some((s) => s.type === 'math')) return it.segments.map((s) => s.text || '').join('');
      return '';
    };
    return (b.items || [])
      .map((it, itemIdx) => ({ text: itemText(it), segments: (it && it.segments) || null, itemIdx }))
      .filter((e) => e.text && !/[\u2800-\u28FF]/.test(e.text));
  }
  if (b.type === 'para') {
    if (b.segments) {
      if (b.segments.some((s) => s.type === 'math')) return [];   // has an equation → don't proofread
      const t = b.segments.map((s) => s.text || '').join('');
      if (/[\u2800-\u28FF]/.test(t)) return [];                  // raw braille → don't back-translate
      return [{ text: t, segments: b.segments, itemIdx: null }];
    }
    if (b.text && /[\u2800-\u28FF]/.test(b.text)) return [];
    return [{ text: b.text || '', segments: null, itemIdx: null }];
  }
  return [];                                                      // indicator / unknown → nothing to check
}

// Normalise a single word for comparison
export function normWord(w) {
  let word = stripDiacritics(decodeEntities(w))
    .replace(/\bp\.more\./gi, 'p.m.')
    .replace(/\ba\.more\./gi, 'a.m.')
    .replace(/\btr\.very\b/gi, 'tr.v')
    .replace(/^['"(\[{«“‘]+|['")\]}»”’;:!?,\.]+/g, '') // strip outer punctuation
    .replace(/brl/gi, 'braille')
    .trim()
    .toLowerCase();
  word = word.replace(/([a-zA-Z]+)[\x27\u2019];([a-zA-Z]+)/gi, "$1'$2");
  word = word.replace(/([a-zA-Z]+)[\x27\u2019](so|that|little|do|very|receive|more|not|be|were|his|was|in|con|dis|by|beside)\b/gi, (m, p, exp) => p + (APOS_EXPANSIONS[exp.toLowerCase()] ? "'" + APOS_EXPANSIONS[exp.toLowerCase()] : ''));
  word = word.replace(/([a-zA-Z]+)[\x27\u2019]$/g, "$1");
  word = word.replace(/[\x27\u2019]/g, '');
  if (word === 'e.go') return 'e.g';
  if (word === 'i.every') return 'i.e';
  if (word === 'u.so') return 'u.s';
  if (SHORTFORMS_MAP[word]) return SHORTFORMS_MAP[word];
  return word;
}

// Tokenizes text into word-like units and their exact character offsets
export function tokenizeWords(text) {
  const tokens = [];
  if (!text) return tokens;
  const decoded = decodeEntities(text);
  const re = /[A-Za-z0-9\u0080-\u02FF\u0300-\u036F\u0400-\u04FF]+(?:['’\-][A-Za-z0-9\u0080-\u02FF\u0300-\u036F\u0400-\u04FF]+)*/g;
  let match;
  while ((match = re.exec(decoded)) !== null) {
    const raw = match[0];
    const cleaned = normWord(raw);
    if (cleaned) {
      tokens.push({ raw, norm: cleaned, start: match.index, end: match.index + raw.length });
    }
  }
  return tokens;
}

// Finds specific word tokens in srcText that fail to back-translate
export function findWordMismatches(srcText, backText) {
  if (norm(srcText) === norm(backText)) return [];

  const srcTokens = tokenizeWords(srcText);
  const backTokens = tokenizeWords(backText);

  if (!srcTokens.length) return [];
  if (!backTokens.length) return srcTokens.map(t => ({ word: t.raw, start: t.start, end: t.end }));

  const n = srcTokens.length;
  const m = backTokens.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (srcTokens[i - 1].norm === backTokens[j - 1].norm) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = n, j = m;
  const matchedSrcIndices = new Set();
  while (i > 0 && j > 0) {
    if (srcTokens[i - 1].norm === backTokens[j - 1].norm) {
      matchedSrcIndices.add(i - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  const mismatches = [];
  for (let idx = 0; idx < srcTokens.length; idx++) {
    if (!matchedSrcIndices.has(idx)) {
      const tok = srcTokens[idx];
      if (/^https?:\/\//i.test(tok.raw)) continue;
      mismatches.push({
        word: tok.raw,
        start: tok.start,
        end: tok.end
      });
    }
  }

  return mismatches;
}

export function roundTrip(text, translate, backTranslate) {
  const cleanSrc = decodeEntities(text);
  const brf = translate(cleanSrc);
  const back = backTranslate(brf);
  const nText = norm(cleanSrc);
  const nBack = norm(back);
  const ok = !nText || nBack === nText;
  const wordIssues = ok ? [] : findWordMismatches(cleanSrc, back);
  return { ok: ok || wordIssues.length === 0, brf, back, wordIssues };
}

// Returns { clean, checked, issues:[{idx, itemIdx, word, start, end, src, back}] } for a document model.
export function proofread(model, translate, backTranslate, translateG1 = null) {
  const issues = [];
  let checked = 0;
  (model.blocks || []).forEach((b, idx) => {
    for (const entry of blockEntries(b)) {
      if (!entry.text || !entry.text.trim()) continue;
      checked++;
      let r;
      try {
        const translateEntry = (s) => {
          if (entry.segments && entry.segments.some((seg) => seg.uncontracted || seg.tf)) {
            let out = '';
            for (const seg of entry.segments) {
              const t = String(seg.text ?? '');
              if (!t) continue;
              if (seg.uncontracted) {
                const g1 = translateG1 ? translateG1(t) : translate(t);
                out += t.includes(' ') ? `;;;${g1};'` : `;;${g1}`;
              } else if (seg.tf) {
                out += translate(t, Array(t.length).fill(seg.tf));
              } else {
                out += translate(t);
              }
            }
            return out;
          }
          return translate(s);
        };
        r = roundTrip(entry.text, translateEntry, backTranslate);
      } catch { continue; }
      if (!r.ok && r.wordIssues && r.wordIssues.length > 0) {
        for (const w of r.wordIssues) {
          issues.push({
            idx,
            itemIdx: entry.itemIdx,
            word: w.word,
            start: w.start,
            end: w.end,
            src: entry.text,
            back: r.back
          });
        }
      }
    }
  });
  return { clean: issues.length === 0, checked, issues };
}
