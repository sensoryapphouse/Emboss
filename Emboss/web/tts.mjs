// Text-to-speech for the editor, built on the Web Speech API (speechSynthesis).
// DOM-free: the caller supplies the items to read and gets callbacks so it can do
// the "karaoke" highlighting (which block is being read, and which word within it).
// Speaking block-by-block — rather than one giant utterance — keeps the boundary
// char offsets local to a block so they map cleanly back to that block's DOM, and
// lets us highlight the current block via the same link machinery as feature A.

export function speechAvailable() {
  return typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance !== 'undefined';
}

export class Reader {
  // opts: { rate, voice, onBlock(item), onBoundary(item, charIndex, charLength), onEnd() }
  constructor(opts = {}) {
    this.rate = opts.rate || 1;
    this.voice = opts.voice || null;
    this.onBlock = opts.onBlock || (() => {});
    this.onBoundary = opts.onBoundary || (() => {});
    this.onEnd = opts.onEnd || (() => {});
    this.onStuck = opts.onStuck || null;
    this.items = [];
    this.i = 0;
    this.active = false;
    this.paused = false;
    this.gen = 0;         // bumped on every stop()/speak() so a late utterance or watchdog callback can bail
    this._timers = [];    // pending watchdog timeouts, cleared on stop()/speak() so they can't tear down a new read
  }

  get speaking() { return this.active; }

  _safe(fn) { try { fn(); } catch (e) { console.error('TTS callback:', e); } }   // a highlight bug must never wedge the read loop
  _reset() {            // invalidate any in-flight utterance + its watchdogs
    this.gen++;
    this._timers.forEach((t) => clearTimeout(t)); this._timers = [];
    try { speechSynthesis.cancel(); } catch { /* not supported */ }
  }

  // items: [{ blockIdx, text, plain }]. `plain` = word offsets map to the block's
  // DOM text (no maths substitution), so word-level highlight is safe.
  speak(items) {
    this._reset();
    this.items = (items || []).filter((it) => it.text && it.text.trim());
    this.i = 0;
    this.paused = false;
    this.active = this.items.length > 0;
    if (this.active) this._next(); else this._safe(this.onEnd);
  }

  _next() {
    if (!this.active) return;
    if (this.i >= this.items.length) { this.active = false; this._safe(this.onEnd); return; }
    const gen = this.gen;                              // this read's generation; a stop()/new speak() bumps it
    const stale = () => gen !== this.gen || !this.active;   // a leftover callback/timer from a cancelled read
    const item = this.items[this.i];
    const u = new SpeechSynthesisUtterance(item.text);
    u.rate = this.rate;
    if (this.voice) u.voice = this.voice;
    let started = false, done = false;
    u.onstart = () => { if (stale()) return; started = true; this._safe(() => this.onBlock(item)); };
    u.onboundary = (e) => { if (stale()) return; if (!e.name || e.name === 'word') this._safe(() => this.onBoundary(item, e.charIndex || 0, e.charLength || 0)); };
    u.onend = () => { if (stale() || done) return; done = true; this.i++; this._next(); };
    u.onerror = () => { if (stale() || done) return; done = true; this.i++; this._next(); };
    try { speechSynthesis.speak(u); speechSynthesis.resume(); } catch { /* */ }   // resume() counters Chrome queuing paused
    // Watchdog: Chrome's speechSynthesis sometimes wedges (queued but never fires
    // start). Nudge once, then give up gracefully + tell the caller rather than
    // sitting silent forever. Tracked + generation-guarded so a late timer from a
    // stopped read can never cancel or "stuck"-report a subsequent one.
    const t1 = setTimeout(() => {
      if (stale() || done || started) return;
      try { speechSynthesis.resume(); } catch { /* */ }
      const t2 = setTimeout(() => {
        if (stale() || done || started) return;
        this.active = false;
        try { speechSynthesis.cancel(); } catch { /* */ }
        if (this.onStuck) this._safe(this.onStuck);
        this._safe(this.onEnd);
      }, 1600);
      this._timers.push(t2);
    }, 1200);
    this._timers.push(t1);
  }

  pause() { if (this.active && !this.paused) { this.paused = true; try { speechSynthesis.pause(); } catch { /* */ } } }
  resume() { if (this.active && this.paused) { this.paused = false; try { speechSynthesis.resume(); } catch { /* */ } } }
  stop() {
    const was = this.active;
    this.active = false; this.paused = false;
    this._reset();                                     // bump gen + clear watchdogs so a late timer can't tear down a new read
    if (was) this._safe(this.onEnd);
  }
}

// Spoken text for a document model. Equations are spoken via MathLive
// (convertLatexToSpeakableText → e.g. "x squared") rather than read as LaTeX.
// Each item carries { blockIdx, unit, text, map }: `unit` is the source unit
// (0 for a block, item index for a list) that matches the formatter's cell
// coordinate; `map` is parallel to `text` — map[i] = the source char index in that
// unit's flat text, or -1 for a maths span (and for the * * * pause). This lets the
// caller highlight the right print word + braille cells for EVERY block type
// (headings, plain + emphasis paragraphs, equations, and lists), not just plain text.
export function buildSpokenItems(model, mathSpeech) {
  const items = [];
  const collapse = (t) => (t || '').replace(/\s+/g, ' ');            // match the formatter's flat text
  // `srcStart` = the item's first char offset in its unit's flat text, so a caret
  // can start reading mid-block from the right word (see sliceItemsFrom).
  const ident = (idx, text, unit) => ({ blockIdx: idx, unit, text, map: text.split('').map((_, i) => i), srcStart: 0 });
  (model.blocks || []).forEach((b, idx) => {
    if (!b) return;
    if (b.type === 'heading' || b.type === 'title') {
      const t = collapse(b.text || (b.segments ? b.segments.map(s => s.text || (s.latex ? ' ' + s.latex + ' ' : '')).join('') : ''));
      items.push(ident(idx, t, 0));
      return;
    }
    if (b.type === 'indicator') { items.push({ blockIdx: idx, unit: 0, text: ', , ,', map: [], srcStart: 0 }); return; }   // pause; nothing to highlight
    // An emphasised or maths-bearing item carries `segments` and no `text`.
    const itemText = (it) => (typeof it === 'string' ? it : (it.text ?? (it.segments || []).map((s) => s.text || (s.latex ? ' ' + s.latex + ' ' : '')).join('')));
    if (b.type === 'list') { (b.items || []).forEach((it, li) => items.push(ident(idx, collapse(itemText(it)), li))); return; }
    if (b.type === 'para' || b.type === 'note') {
      if (b.segments) {
        // Equations are spoken as their OWN item (like SumIt reads a single equation),
        // carrying { spokenText, atomMap, wrappedLatex } so the reader can light up each
        // term. Text runs stay word-mapped for the print/braille word karaoke.
        let text = '', map = [], flat = 0, mathIdx = 0, textStart = 0;
        const flushText = () => { if (text.trim()) items.push({ blockIdx: idx, unit: 0, text, map, srcStart: textStart }); text = ''; map = []; };
        for (const s of b.segments) {
          if (s.type === 'math') {
            flushText();
            const r = mathSpeech(s.latex || '');
            const ms = (typeof r === 'string') ? { spokenText: r, atomMap: [], wrappedLatex: '' } : (r || {});
            items.push({ blockIdx: idx, unit: 0, kind: 'math', mathIndex: mathIdx, srcStart: flat, latex: s.latex || '', text: ms.spokenText || '', atomMap: ms.atomMap || [], wrappedLatex: ms.wrappedLatex || '' });
            mathIdx++;
          } else {
            const t = collapse(s.text); if (text === '') textStart = flat; text += t; for (let i = 0; i < t.length; i++) map.push(flat + i); flat += t.length;
          }
        }
        flushText();
      } else { const t = collapse(b.text); items.push(ident(idx, t, 0)); }
    }
  });
  return items;
}

// Trim spoken items so reading starts at the caret WORD, not the start of its line.
// pos = { block, unit, offset } — offset is the caret's char index in that unit's
// flat text (the same frame as each item's `map`). Blocks/units before the caret
// are dropped; the item straddling the caret is sliced back to the word boundary so
// we begin on a whole word; everything after is kept intact.
function sliceItemFromOffset(item, offset) {
  const map = item.map;
  if (!map || !map.length) return item;
  let i0 = -1;
  for (let i = 0; i < map.length; i++) { if (map[i] >= offset) { i0 = i; break; } }
  if (i0 === -1) return null;                                    // the whole item is before the caret
  while (i0 > 0 && !/\s/.test(item.text[i0 - 1])) i0--;          // snap back to the start of the caret's word
  if (i0 <= 0) return item;
  return { ...item, text: item.text.slice(i0), map: map.slice(i0) };
}
export function sliceItemsFrom(items, pos) {
  const block = pos && pos.block != null ? pos.block : 0;
  const unit = pos && pos.unit != null ? pos.unit : 0;
  const offset = pos && pos.offset != null ? pos.offset : 0;
  if (block <= 0 && unit <= 0 && offset <= 0) return items.slice();
  const out = [];
  for (const it of items) {
    if (it.blockIdx < block) continue;
    if (it.blockIdx > block) { out.push(it); continue; }
    const iu = it.unit != null ? it.unit : 0;
    if (iu < unit) continue;                                     // an earlier list item on the caret's line
    if (iu > unit) { out.push(it); continue; }                  // a later list item — read it whole
    if (it.kind === 'math' || !it.map) { if ((it.srcStart || 0) >= offset) out.push(it); continue; }
    const sliced = sliceItemFromOffset(it, offset);
    if (sliced) out.push(sliced);
  }
  return out;
}
