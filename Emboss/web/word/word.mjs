import * as louis from '/engine/louis-browser.mjs';
import { resolveTable, makeTranslators, UEB_TABLES } from '/web/braille-table.mjs';
import { styledTranslate } from '/format/text-style.mjs';
import { brfToUnicodeBraille } from '/engine/brf-ascii.mjs';
import * as maths from '/engine/maths.mjs';
import { initMaths, isMathsReady } from '/engine/maths.mjs';
import { formatDocument } from '/format/document.mjs';
import { parseHtml, parseText } from '/input/parse.mjs';
import { ommlElementToMathML, MATH_NS } from '/input/omml.mjs';
import { exportToPef } from '/format/pef.mjs';
import { exportToEbraille } from '/format/ebraille.mjs';
import { spoolToEmbosser } from '/format/spooler.mjs';
import { loadSettings, effectiveMathCode } from '/web/settings.mjs';

let lastFormattedDoc = null;
let lastBlockModel = null;
let activeBrailleCode = 'en-ueb-g2';
let isSyncing = false;
let syncDebounceTimer = null;
let louisReady = false;
let pollTimer = null;

// Page geometry / layout used only when the shared Emboss settings cannot be read
// (e.g. localStorage blocked in the add-in sandbox): BANA 40 x 25.
const FALLBACK_SETTINGS = Object.freeze({
  mode: 'bana', cells: 40, lines: 25,
  paragraphStyle: 'indented', listStyle: 'spaced', tableFormat: 'auto',
  connectionType: 'serial', embosser: 'generic', embosserDuplex: 'double',
  baudRate: 9600, networkHost: '192.168.1.150', networkPort: 9100,
});

// The same persisted settings the Emboss PWA uses (cells/lines/mode/embosser …),
// so the Word pane formats and spools exactly like the main app.
function getAddinSettings() {
  try {
    const s = loadSettings();
    if (s && Number(s.cells) > 0 && Number(s.lines) > 0) return s;
  } catch (e) {
    console.warn('Emboss settings unavailable, using BANA 40x25 fallback:', e);
  }
  return FALLBACK_SETTINGS;
}

const $ = (id) => document.getElementById(id);

// --- Initialization ---
async function initEngine() {
  updateStatus('Loading Engine...', 'syncing');
  try {
    await louis.init({ tablesBaseUrl: '/liblouis/tables' });
    louisReady = true;
  } catch (e) {
    console.error('Liblouis init error:', e);
  }
  try {
    await initMaths();
  } catch (e) {
    console.warn('Maths engine init warning:', e);
  }
}

if (typeof Office !== 'undefined' && Office.onReady) {
  Office.onReady(async (info) => {
    await initEngine();
    if (info.host === Office.HostType.Word) {
      updateStatus('Word Connected', 'connected');
      setupWordListeners();
      await syncFromWord();
    } else {
      updateStatus('Browser Preview Mode', 'syncing');
      await setupDemoContent();
    }
  });
} else {
  document.addEventListener('DOMContentLoaded', async () => {
    await initEngine();
    updateStatus('Browser Preview Mode', 'syncing');
    await setupDemoContent();
  });
}

function updateStatus(text, state) {
  const badge = $('statusBadge');
  const statusText = $('statusText');
  if (statusText) statusText.textContent = text;
  if (badge) {
    badge.className = 'status-badge ' + (state || '');
  }
}

function showError(msg) {
  const el = $('errorMsg');
  if (el) {
    if (msg) {
      el.textContent = msg;
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  }
}

// --- Office.js / Word Document Extraction ---
function setupWordListeners() {
  try {
    if (typeof Office !== 'undefined' && Office.context && Office.context.document) {
      Office.context.document.addHandlerAsync(
        Office.EventType.DocumentSelectionChanged,
        () => onWordSelectionChanged(),
        (result) => {
          if (result.status === Office.AsyncResultStatus.Failed) {
            console.warn('Selection listener registration:', result.error);
          }
        }
      );
    }
  } catch (err) {
    console.warn('Word listener setup warning:', err);
  }

  // Also listen for window focus and periodic sync. The poll only runs while the
  // task pane is actually visible; it is paused when hidden and resumed (with an
  // immediate catch-up sync) when the pane becomes visible again.
  window.addEventListener('focus', () => triggerSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      startPolling();
      triggerSync();
    } else {
      stopPolling();
    }
  });
  startPolling();
}

function startPolling() {
  if (pollTimer) return;
  if (document.visibilityState !== 'visible') return;
  pollTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') { stopPolling(); return; }
    if (!isSyncing && louisReady) {
      syncFromWord(true); // silent background poll
    }
  }, 1500);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function triggerSync() {
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => syncFromWord(false), 300);
}

function parseOoxmlString(ooxml) {
  if (!ooxml) return [];
  const Parser = typeof DOMParser !== 'undefined' ? DOMParser : globalThis.DOMParser;
  if (!Parser) return [];
  const doc = new Parser().parseFromString(ooxml, 'application/xml');
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0] || doc.documentElement;
  if (!body) return [];

  const blocks = [];

  function processParagraph(p) {
    const pStyleEl = p.getElementsByTagNameNS(W_NS, 'pStyle')[0];
    const styleVal = (pStyleEl?.getAttributeNS(W_NS, 'val') || pStyleEl?.getAttribute('w:val') || '').toLowerCase();

    // Check if paragraph contains oMath
    const mathEls = p.getElementsByTagNameNS(M_NS, 'oMath');
    if (mathEls.length > 0) {
      const segments = [];
      for (const node of p.childNodes) {
        if (node.nodeType !== 1) continue;
        if (node.namespaceURI === M_NS && (node.localName === 'oMath' || node.localName === 'oMathPara')) {
          const mTargets = node.localName === 'oMath' ? [node] : [...node.getElementsByTagNameNS(M_NS, 'oMath')];
          for (const mTarget of mTargets) {
            const mathml = ommlElementToMathML(mTarget);
            if (mathml) segments.push({ type: 'math', mathml });
          }
        } else if (node.namespaceURI === W_NS && node.localName === 'r') {
          const t = node.textContent;
          if (t) segments.push({ type: 'text', text: t });
        }
      }
      if (segments.length > 0) {
        if (styleVal.includes('heading1') || styleVal.includes('heading 1')) {
          blocks.push({ type: 'heading', level: 1, segments });
        } else {
          blocks.push({ type: 'para', segments });
        }
        return;
      }
    }

    const text = p.textContent.replace(/\s+/g, ' ').trim();
    if (!text) return;

    if (styleVal.includes('heading1') || styleVal.includes('heading 1')) {
      blocks.push({ type: 'heading', level: 1, text });
    } else if (styleVal.includes('heading2') || styleVal.includes('heading 2')) {
      blocks.push({ type: 'heading', level: 2, text });
    } else if (styleVal.includes('heading3') || styleVal.includes('heading 3')) {
      blocks.push({ type: 'heading', level: 3, text });
    } else {
      const parsed = parseText(text);
      if (parsed.blocks && parsed.blocks.length > 0) {
        blocks.push(...parsed.blocks);
      } else {
        blocks.push({ type: 'para', text });
      }
    }
  }

  const paras = body.getElementsByTagNameNS(W_NS, 'p');
  for (let i = 0; i < paras.length; i++) {
    processParagraph(paras[i]);
  }

  return blocks;
}

// Decide whether a Word paragraph is a maths equation rather than prose.
// A paragraph is treated as an equation only when:
//   (a) its Word paragraph style is a maths/equation style, or
//   (b) it carries an explicit maths marker — an OMML (<m:oMath>) fragment, a
//       $…$ / $$…$$ pair, or \(…\) / \[…\] LaTeX delimiters, or
//   (c) at least 60% of its non-space characters are maths-like (digits,
//       operators/relations, ^ _ \ { } ( ) [ ], super/subscripts, Greek letters,
//       and short 1–2 letter variable names such as x, dx, mc), it contains at
//       least one operator/relation, and it has no sentence punctuation
//       (", ; : ! ?" or a full stop that ends a sentence).
// Anything else — including "1. Solve for x when x = 3." — is prose.
const MATH_STYLE_RE = /math|equation|formula/;
const MATH_MARKER_RE = /<m:oMath|\$[^$\n]+\$|\\\(.+?\\\)|\\\[.+?\\\]/;
const MATH_OPERATOR_RE = /[=+\-−±×÷*\/^_\\<>≤≥≠≈√∫∑∏→²³ⁿ⁴₁₂ₖ]/;
const SENTENCE_PUNCT_RE = /[,;:!?]|\.(?=\s|$)/;
const MATH_FUNCTION_NAMES = new Set(['sin', 'cos', 'tan', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'sec', 'csc', 'cot', 'det', 'mod', 'sqrt', 'frac', 'int', 'sum']);

function mathLikeRatio(text) {
  const compact = text.replace(/\s+/g, '');
  if (!compact) return 0;
  let mathChars = 0;
  // Count letter runs as maths-like only when they look like variables (1–2
  // letters) or a known function name; longer runs are words.
  const withoutLetters = compact.replace(/[A-Za-z]+/g, (run) => {
    if (run.length <= 2 || MATH_FUNCTION_NAMES.has(run.toLowerCase())) mathChars += run.length;
    return '';
  });
  for (const ch of withoutLetters) {
    if (/[0-9=+\-−±×÷*\/^_\\{}()\[\]<>≤≥≠≈√∫∑∏π∞θαβγδλμσωΔΩ→²³ⁿ⁴₁₂ₖ½¼¾.,']/.test(ch)) mathChars += 1;
  }
  return mathChars / compact.length;
}

export function looksLikeEquation(text, style = '') {
  if (!text) return false;
  if (MATH_STYLE_RE.test(String(style || '').toLowerCase())) return true;
  if (MATH_MARKER_RE.test(text)) return true;
  if (SENTENCE_PUNCT_RE.test(text)) return false;
  if (!MATH_OPERATOR_RE.test(text)) return false;
  return mathLikeRatio(text) >= 0.6;
}

function mathEquationToSegments(text, style = '') {
  if (/\$[^$\n]+\$/.test(text)) {
    const p = parseText(text);
    if (p.blocks && p.blocks.length > 0) return p.blocks;
  }
  if (looksLikeEquation(text, style)) {
    const latex = text
      .trim()
      .replace(/^\\\((.*)\\\)$/s, '$1')
      .replace(/^\\\[(.*)\\\]$/s, '$1')
      .replace(/^[\s\d.]+\s*/, '')
      .replace(/²/g, '^2')
      .replace(/³/g, '^3')
      .replace(/⁴/g, '^4')
      .replace(/ⁿ/g, '^n')
      .replace(/₁/g, '_1')
      .replace(/₂/g, '_2')
      .replace(/ₖ/g, '_k')
      .replace(/±/g, '\\pm ')
      .replace(/√\(([^)]+)\)/g, '\\sqrt{$1}')
      .replace(/√([a-zA-Z0-9]+)/g, '\\sqrt{$1}')
      .replace(/∫\[([a-zA-Z0-9]+)\s+to\s+([a-zA-Z0-9]+)\]/g, '\\int_{$1}^{$2}')
      .replace(/∫/g, '\\int ')
      .replace(/∑/g, '\\sum ')
      .replace(/π/g, '\\pi ')
      .replace(/θ/g, '\\theta ')
      .replace(/α/g, '\\alpha ')
      .replace(/β/g, '\\beta ')
      .replace(/½/g, '\\frac{1}{2}')
      .replace(/¼/g, '\\frac{1}{4}')
      .replace(/¾/g, '\\frac{3}{4}')
      .replace(/−/g, '-')
      .replace(/×/g, '\\times ')
      .replace(/÷/g, '\\div ')
      .replace(/≠/g, '\\neq ')
      .replace(/≤/g, '\\leq ')
      .replace(/≥/g, '\\geq ')
      .replace(/→/g, '\\to ');

    return [{
      type: 'para',
      segments: [
        { type: 'math', latex }
      ]
    }];
  }
  const parsed = parseText(text);
  if (parsed.blocks && parsed.blocks.length > 0) return parsed.blocks;
  return [{ type: 'para', text }];
}

let lastExtractedSignature = '';

async function syncFromWord(isSilent = false) {
  if (isSyncing || !louisReady) return;
  isSyncing = true;
  if (!isSilent) updateStatus('Syncing...', 'syncing');

  try {
    let extractedBlocks = [];
    let rawTextFallback = '';

    let rawParagraphs = null; // [{ text, style }] straight from Word, before any parsing

    if (typeof Word !== 'undefined' && Word.run) {
      try {
        await Word.run(async (context) => {
          const pars = context.document.body.paragraphs;
          pars.load('items/text, items/style');
          await context.sync();

          rawParagraphs = [];
          if (pars.items && pars.items.length > 0) {
            for (const p of pars.items) {
              const text = (p.text || '').trim();
              if (!text) continue;
              rawParagraphs.push({ text, style: (p.style || '').toLowerCase() });
            }
          }
        });
      } catch (wordErr) {
        console.warn('Paragraph extraction attempt failed, trying body text:', wordErr);
        try {
          await Word.run(async (context) => {
            const body = context.document.body;
            body.load('text');
            await context.sync();
            rawTextFallback = body.text || '';
          });
        } catch (bodyErr) {
          console.warn('Body text extraction failed:', bodyErr);
        }
      }
    }

    // Signature of the raw paragraph text + style. A silent background poll whose
    // signature is unchanged exits here, before any parsing, translation or
    // formatting work is done.
    let currentSignature = '';
    if (rawParagraphs && rawParagraphs.length > 0) currentSignature = JSON.stringify(rawParagraphs);
    else if (rawTextFallback.trim()) currentSignature = rawTextFallback;
    else currentSignature = '__empty_doc__';

    if (isSilent && currentSignature === lastExtractedSignature) {
      return;
    }

    if (rawParagraphs && rawParagraphs.length > 0) {
      for (const { text, style } of rawParagraphs) {
        if (style.includes('heading 1')) {
          extractedBlocks.push({ type: 'heading', level: 1, text });
        } else if (style.includes('heading 2')) {
          extractedBlocks.push({ type: 'heading', level: 2, text });
        } else if (style.includes('heading 3')) {
          extractedBlocks.push({ type: 'heading', level: 3, text });
        } else {
          extractedBlocks.push(...mathEquationToSegments(text, style));
        }
      }
    }

    if (extractedBlocks.length > 0) {
      lastBlockModel = { title: 'Word Document', blocks: extractedBlocks };
    } else if (rawTextFallback.trim()) {
      lastBlockModel = parseText(rawTextFallback);
    } else {
      // Empty document state
      lastBlockModel = {
        title: 'Word Document',
        blocks: [
          { type: 'para', text: 'Start typing in your Word document to generate live Braille.' }
        ]
      };
    }

    lastExtractedSignature = currentSignature;
    await renderBraille();

    updateStatus('Word Connected', 'connected');
    showError('');
  } catch (err) {
    console.error('Failed to extract Word content:', err);
    if (!isSilent) {
      showError('Sync: ' + (err.message || String(err)));
      updateStatus('Sync Notice', 'offline');
    }
  } finally {
    isSyncing = false;
  }
}

async function onWordSelectionChanged() {
  try {
    if (typeof Word === 'undefined' || !Word.run) return;
    await Word.run(async (context) => {
      const selection = context.document.getSelection();
      selection.load('text');
      await context.sync();
      const text = (selection.text || '').trim();
      if (text) {
        highlightBrailleForText(text);
      }
    });
    triggerSync();
  } catch (e) {
    // Non-fatal selection sync error
  }
}

// --- Braille Rendering ---
async function renderBraille() {
  if (!lastBlockModel) return;

  const tableCode = $('selBrailleCode')?.value || activeBrailleCode;
  const table = resolveTable({ brailleCode: tableCode });
  await louis.ensureTables(table);

  const tr = makeTranslators(louis, table);
  const translate = styledTranslate((t, tf) => tr.translate(t, tf), 'faithful');
  const translateG1 = /en-ueb/.test(table) ? (t) => makeTranslators(louis, UEB_TABLES.g1).translate(t) : undefined;

  // Page geometry, layout standard and list/paragraph style come from the shared
  // Emboss settings (the same ones the PWA and editor use); BANA 40x25 fallback.
  const s = getAddinSettings();
  const mode = s.mode === 'bana' ? 'bana' : 'ukaaf';
  const width = Number(s.cells) || 40;
  const depth = Number(s.lines) || 25;
  // A Nemeth table chosen in the pane forces Nemeth maths; otherwise follow the
  // saved maths-code preference (explicit choice, else BANA→Nemeth / UKAAF→UEB).
  const isNemeth = tableCode.includes('nemeth') || tableCode.includes('us') || effectiveMathCode(s) === 'nemeth';

  const formatOpts = {
    mode,
    width,
    depth,
    paragraphStyle: s.paragraphStyle || 'indented',
    listStyle: s.listStyle || 'spaced',
    tableFormat: s.tableFormat || 'auto',
    translate,
    translateG1,
    mathToBrf: isMathsReady() ? (seg) => maths.mathToBrf(seg, isNemeth ? 'nemeth' : 'ueb') : null,
    generateVolCover: false,
    generateToc: false
  };

  try {
    const brf = formatDocument(lastBlockModel, formatOpts);
    lastFormattedDoc = { brf, opts: formatOpts };

    const viewport = $('brailleView');
    if (!viewport) return;

    viewport.innerHTML = '';

    const lines = brf.split('\n');
    let totalCells = 0;
    const mode = $('selDisplayMode')?.value || 'aph';

    lines.forEach((lineText, idx) => {
      totalCells += lineText.trim().length;
      const lineEl = document.createElement('div');
      lineEl.className = 'braille-line';
      lineEl.dataset.lineIdx = String(idx);
      const formatted = mode === 'aph' ? (brfToUnicodeBraille(lineText) || ' ') : (lineText || ' ');
      lineEl.textContent = formatted;
      
      lineEl.addEventListener('click', () => {
        document.querySelectorAll('.braille-line').forEach(l => l.classList.remove('active'));
        lineEl.classList.add('active');
        scrollWordToLine(idx, lineText);
      });

      viewport.appendChild(lineEl);
    });

    $('pageStats').textContent = `${totalCells} cells · ${lines.length} lines`;
    $('styleInspector').textContent = `Style: ${mode === 'bana' ? 'BANA' : 'UKAAF'} · ${width}×${depth} · Table: ${tableCode}`;
    showError('');
  } catch (err) {
    console.error('Braille render error:', err);
    showError('Braille translation error: ' + err.message);
  }
}

function highlightBrailleForText(wordText) {
  if (!wordText || !lastFormattedDoc) return;
  const lines = $('brailleView')?.querySelectorAll('.braille-line');
  if (!lines) return;

  const firstWord = wordText.split(/\s+/)[0];
  lines.forEach(l => {
    if (firstWord.length > 2 && l.textContent.toLowerCase().includes(firstWord.toLowerCase())) {
      l.classList.add('active');
    } else {
      l.classList.remove('active');
    }
  });
}

async function scrollWordToLine(lineIdx, lineText) {
  try {
    if (typeof Word === 'undefined' || !Word.run) return;
    const trimmed = lineText.trim();
    if (!trimmed) return;

    await Word.run(async (context) => {
      const pars = context.document.body.paragraphs;
      pars.load('items/text');
      await context.sync();
      if (pars.items.length > 0) {
        pars.items[Math.min(lineIdx, pars.items.length - 1)].select();
        await context.sync();
      }
    });
  } catch (e) {
    console.warn('Word selection scroll skipped:', e);
  }
}

// --- Standalone Browser Demo Setup ---
async function setupDemoContent() {
  lastBlockModel = {
    title: 'Word Document Example',
    blocks: [
      { type: 'heading', level: 1, text: 'Emboss for Microsoft Word' },
      { type: 'para', text: 'This task pane connects directly to Microsoft Word via Office.js to provide real-time BANA and UEB braille formatting.' },
      {
        type: 'list',
        style: 'exercise',
        items: [
          { text: 'First exercise item with 1-5 BANA margins' },
          { text: 'Sub-question with 3-5 BANA margins', level: 1 },
          { text: 'Sub-part with 5-7 BANA margins', level: 2 }
        ]
      },
      { type: 'para', text: 'Click any braille line to jump to the corresponding paragraph in Word.' }
    ]
  };
  await renderBraille();
}

// --- Toolbar & Deliverables Event Handlers ---
$('selBrailleCode')?.addEventListener('change', (e) => {
  activeBrailleCode = e.target.value;
  renderBraille();
});

$('selDisplayMode')?.addEventListener('change', (e) => {
  const isAscii = e.target.value === 'ascii';
  $('brailleView')?.classList.toggle('mode-ascii', isAscii);
  renderBraille();
});

$('btnInsertSample')?.addEventListener('click', async () => {
  try {
    if (typeof Word !== 'undefined' && Word.run) {
      await Word.run(async (context) => {
        const body = context.document.body;
        const p1 = body.insertParagraph('Introduction to Physics & Chemistry', Word.InsertLocation.start);
        p1.font.bold = true;
        p1.font.size = 18;
        p1.font.color = '#2b579a';

        body.insertParagraph('Welcome to this accessible science document prepared in Microsoft Word.', Word.InsertLocation.end);
        const p3 = body.insertParagraph('Practice Questions (BANA §10 Format)', Word.InsertLocation.end);
        p3.font.bold = true;
        p3.font.size = 14;

        body.insertParagraph('1. What is the chemical formula for water?', Word.InsertLocation.end);
        body.insertParagraph('2. Describe how hydrogen bonds form between polar water molecules.', Word.InsertLocation.end);
        body.insertParagraph('3. Calculate the gravitational force between two 5 kg objects placed 2 meters apart.', Word.InsertLocation.end);
        body.insertParagraph('As you type or modify this Word document, the Emboss Task Pane on the right instantly re-translates and formats the Braille preview in real time.', Word.InsertLocation.end);
        p1.select();
        await context.sync();
      });
      await syncFromWord();
    } else {
      await setupDemoContent();
    }
  } catch (err) {
    console.error('Insert sample error:', err);
    showError('Sample insert error: ' + err.message);
  }
});

$('btnInsertMath')?.addEventListener('click', async () => {
  try {
    if (typeof Word !== 'undefined' && Word.run) {
      await Word.run(async (context) => {
        // Never clear or overwrite the user's document: append the sample at the end,
        // exactly like the Sample button does.
        const body = context.document.body;

        const pTitle = body.insertParagraph('Advanced Mathematics & Science Equations', Word.InsertLocation.end);
        pTitle.font.bold = true;
        pTitle.font.size = 18;
        pTitle.font.color = '#1f4e79';

        const pSub = body.insertParagraph('Live Translation into Nemeth Code & UEB Technical Math', Word.InsertLocation.end);
        pSub.font.italic = true;
        pSub.font.size = 11;
        pSub.font.color = '#595959';

        const p1h = body.insertParagraph('1. Quadratic Formula', Word.InsertLocation.end);
        p1h.font.bold = true;
        p1h.font.size = 13;
        p1h.font.color = '#1f4e79';

        const p1 = body.insertParagraph('   x = (-b ± √(b² - 4ac)) / (2a)', Word.InsertLocation.end);
        p1.font.name = 'Cambria Math';
        p1.font.size = 15;
        p1.font.italic = true;
        p1.font.color = '#002060';

        const p2h = body.insertParagraph('2. Calculus Definite Integral', Word.InsertLocation.end);
        p2h.font.bold = true;
        p2h.font.size = 13;
        p2h.font.color = '#1f4e79';

        const p2 = body.insertParagraph('   ∫[a to b] f(x) dx = F(b) - F(a)', Word.InsertLocation.end);
        p2.font.name = 'Cambria Math';
        p2.font.size = 15;
        p2.font.italic = true;
        p2.font.color = '#002060';

        const p3h = body.insertParagraph('3. Einstein Mass-Energy Equivalence', Word.InsertLocation.end);
        p3h.font.bold = true;
        p3h.font.size = 13;
        p3h.font.color = '#1f4e79';

        const p3 = body.insertParagraph('   E = mc²', Word.InsertLocation.end);
        p3.font.name = 'Cambria Math';
        p3.font.size = 15;
        p3.font.italic = true;
        p3.font.color = '#002060';

        const p4h = body.insertParagraph('4. Pythagorean Theorem', Word.InsertLocation.end);
        p4h.font.bold = true;
        p4h.font.size = 13;
        p4h.font.color = '#1f4e79';

        const p4 = body.insertParagraph('   a² + b² = c²', Word.InsertLocation.end);
        p4.font.name = 'Cambria Math';
        p4.font.size = 15;
        p4.font.italic = true;
        p4.font.color = '#002060';

        pTitle.select();
        await context.sync();
      });
      await syncFromWord();
    } else {
      lastBlockModel = {
        title: 'Advanced Mathematics & Science Equations',
        blocks: [
          { type: 'heading', level: 1, text: 'Advanced Mathematics & Science Equations' },
          { type: 'para', text: 'Live Translation into Nemeth Code & UEB Technical Math' },
          { type: 'heading', level: 2, text: '1. Quadratic Formula' },
          {
            type: 'para',
            segments: [
              { type: 'math', latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' }
            ]
          },
          { type: 'heading', level: 2, text: '2. Calculus Definite Integral' },
          {
            type: 'para',
            segments: [
              { type: 'math', latex: '\\int_{a}^{b} f(x) dx = F(b) - F(a)' }
            ]
          },
          { type: 'heading', level: 2, text: '3. Einstein Mass-Energy Equivalence' },
          {
            type: 'para',
            segments: [
              { type: 'math', latex: 'E = mc^2' }
            ]
          },
          { type: 'heading', level: 2, text: '4. Pythagorean Theorem' },
          {
            type: 'para',
            segments: [
              { type: 'math', latex: 'a^2 + b^2 = c^2' }
            ]
          }
        ]
      };
      await renderBraille();
    }
  } catch (err) {
    console.error('Insert math error:', err);
    showError('Math insert error: ' + err.message);
  }
});

$('btnRefresh')?.addEventListener('click', () => {
  syncFromWord();
});

$('btnCopyBraille')?.addEventListener('click', async () => {
  if (!lastFormattedDoc?.brf) return;
  try {
    await navigator.clipboard.writeText(lastFormattedDoc.brf);
    const btn = $('btnCopyBraille');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch (e) {
    showError('Clipboard write failed: ' + e.message);
  }
});

$('btnDownloadBrf')?.addEventListener('click', () => {
  if (!lastFormattedDoc?.brf) return;
  downloadFile(lastFormattedDoc.brf, 'document.brf', 'text/plain');
});

$('btnDownloadPef')?.addEventListener('click', async () => {
  if (!lastFormattedDoc) return;
  try {
    const pefXml = exportToPef(lastBlockModel, lastFormattedDoc.opts || {});
    downloadFile(pefXml, 'document.pef', 'application/x-pef+xml');
  } catch (e) {
    showError('PEF generation failed: ' + e.message);
  }
});

$('btnDownloadEbraille')?.addEventListener('click', async () => {
  if (!lastFormattedDoc) return;
  try {
    const ebrlContent = exportToEbraille(lastBlockModel, {
      ...(lastFormattedDoc.opts || {}),
      brailleSystem: 'UEB',
      language: navigator.language || 'en'
    });
    downloadBlob(new Blob([ebrlContent], { type: 'application/epub+zip' }), 'document.ebrl');
  } catch (e) {
    showError('eBraille package generation failed: ' + e.message);
  }
});

$('btnEmboss')?.addEventListener('click', async () => {
  if (!lastFormattedDoc?.brf) return;
  try {
    updateStatus('Connecting to Embosser...', 'syncing');
    const s = getAddinSettings();
    const opts = lastFormattedDoc.opts || {};
    await spoolToEmbosser(lastFormattedDoc.brf, {
      title: 'Word Document',
      copies: 1,
      connectionType: s.connectionType || 'serial',
      embosser: s.embosser || 'generic',
      duplex: s.embosserDuplex || 'double',
      width: Number(opts.width) || Number(s.cells) || 40,
      depth: Number(opts.depth) || Number(s.lines) || 25,
      baudRate: Number(s.baudRate) || 9600,
      networkHost: s.networkHost || '192.168.1.150',
      networkPort: Number(s.networkPort) || 9100,
      onStatus: (msg) => updateStatus(msg, 'syncing'),
    });
    updateStatus('Embossed Successfully', 'connected');
  } catch (e) {
    showError('Embosser Spool Error: ' + e.message);
    updateStatus('Spool Failed', 'offline');
  }
});

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
