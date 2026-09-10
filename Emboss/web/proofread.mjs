// Round-trip proofread: translate each block's source text to braille, then
// back-translate that braille to text. If the result doesn't match the source,
// the braille is ambiguous or mis-contracted — a discrepancy worth a human's eye.
// A clean round-trip is not a *proof* of correctness (a wrong contraction can still
// read back the same), but a FAILED round-trip reliably flags something to review.
// Pure (no DOM); the caller supplies translate/backTranslate so this runs the same
// in Node tests and the browser.

// Normalise for comparison: braille is caseless-by-rule and collapses runs of
// space, so compare case-insensitively on collapsed whitespace. Curly/straight
// quotes and dashes are normalised because the braille tables don't distinguish
// them (a round-trip returns the ASCII form, which is not a real discrepancy).
export function norm(s) {
  return (s || '')
    .replace(/https?:\/\/[^\s]+/gi, '')                        // URLs have known back-translation artifacts (e.g. : -> cc)
    .replace(/^[\s•\-\*\u2022\u2023\u25E6\u2043\u2219]+/, '') // bullets
    .replace(/^\s*\d+[\.\)]\s*/, '')                          // list item numbering
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')              // curly quotes
    .replace(/[–—]/g, '-').replace(/…/g, '...')               // dashes / ellipsis
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
      return [{ text: t, itemIdx: null }];
    }
    if (b.text && /[\u2800-\u28FF]/.test(b.text)) return [];
    return [{ text: b.text || '', itemIdx: null }];
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
      .map((it, itemIdx) => ({ text: itemText(it), itemIdx }))
      .filter((e) => e.text && !/[\u2800-\u28FF]/.test(e.text));
  }
  if (b.type === 'para') {
    if (b.segments) {
      if (b.segments.some((s) => s.type === 'math')) return [];   // has an equation → don't proofread
      const t = b.segments.map((s) => s.text || '').join('');
      if (/[\u2800-\u28FF]/.test(t)) return [];                  // raw braille → don't back-translate
      return [{ text: t, itemIdx: null }];
    }
    if (b.text && /[\u2800-\u28FF]/.test(b.text)) return [];
    return [{ text: b.text || '', itemIdx: null }];
  }
  return [];                                                      // indicator / unknown → nothing to check
}

// Normalise a single word for comparison
export function normWord(w) {
  return (w || '')
    .replace(/^['"(\[{«“‘]+|['")\]}»”’;:!?,\.]+/g, '') // strip outer punctuation
    .replace(/brl/gi, 'braille')
    .trim()
    .toLowerCase();
}

// Tokenizes text into word-like units and their exact character offsets
export function tokenizeWords(text) {
  const tokens = [];
  if (!text) return tokens;
  const re = /[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g;
  let match;
  while ((match = re.exec(text)) !== null) {
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
  const brf = translate(text);
  const back = backTranslate(brf);
  const nText = norm(text);
  const nBack = norm(back);
  const ok = !nText || nBack === nText;
  const wordIssues = ok ? [] : findWordMismatches(text, back);
  return { ok: ok || wordIssues.length === 0, brf, back, wordIssues };
}

// Returns { clean, checked, issues:[{idx, itemIdx, word, start, end, src, back}] } for a document model.
export function proofread(model, translate, backTranslate) {
  const issues = [];
  let checked = 0;
  (model.blocks || []).forEach((b, idx) => {
    for (const entry of blockEntries(b)) {
      if (!entry.text || !entry.text.trim()) continue;
      checked++;
      let r;
      try { r = roundTrip(entry.text, translate, backTranslate); } catch { continue; }
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
