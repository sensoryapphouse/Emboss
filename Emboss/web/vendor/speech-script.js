// Equation-level speech highlighting — produces a wrapped LaTeX render
// alongside a word-indexed script that the speech controller consumes
// to flash the current grouping as TTS reads it.
//
// Returns { wrappedLatex, script } for a given (latex, spokenText) pair:
//
//   • wrappedLatex — same as the input LaTeX but with \htmlClass{eq-grp grp-N}{…}
//     around each major grouping. KaTeX (with trust:true) renders this
//     into HTML where each visible group span carries our class name, so
//     CSS can mark the current one with a red underline / outline.
//
//   • script — a sorted list of { wordIdx, action: 'enter' | 'exit', id }
//     events keyed to the spoken-text word index. The speech controller
//     advances through this list as TTS fires word-boundary callbacks,
//     toggling .speaking-group on each group's wrapper as the audio
//     enters and exits it.
//
// Pairing strategy:
//   1. Tokenise the LaTeX into a tree, assigning sequential group IDs in
//      source (reading) order.
//   2. Scan the prosody-processed spoken text for the structural anchor
//      phrases (\"the fraction\", \"End fraction\", \"the square root of\",
//      \"End square root\", \"Open paren\", \"Close paren\", \"Open bracket\",
//      \"Close bracket\", \"the root with index\", \"End root\").
//   3. MathLive reads left-to-right top-to-bottom, matching LaTeX source
//      order. So the Nth \"the fraction\" anchor in the spoken text pairs
//      with the Nth fraction in the tree, and similarly for each group type.
//   4. Emit ENTER at the wordIdx of the first anchor word and EXIT at
//      wordIdx + anchorLength so the highlight clears after the listener
//      hears the full close phrase.
//
// v0.2 scope:
//   • \frac, \tfrac, \dfrac
//   • \sqrt and \sqrt[n]{…}
//   • \left(…\right), \left[…\right], \left|…\right|
//   • Bare (…) and […]
//   • \sum, \int, \prod, \oint, \iint, \iiint, \oiint  (sum-style groups
//     that wrap their containing operand — body bounded by operand)
//   • Top-level operands (split on +, -, =, \pm, \mp, and relational
//     operators) with subtle background tint as TTS reads each one
//
// Out of scope (planned for v0.3+):
//   • Operand-level highlight INSIDE non-top-level groups
//   • Subscripts/superscripts as groups (\,^{n-1} as a sub-region)
//   • \ce{…} chemistry tokenisation

(function () {
  "use strict";

  // ── Helpers: balanced-delimiter matching ───────────────────────────

  function matchBrace(s, start) {
    if (s[start] !== "{") return start;
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      // Skip escaped braces \{  \}
      if (s[i] === "\\" && (s[i + 1] === "{" || s[i + 1] === "}")) { i++; continue; }
      if (s[i] === "{") depth++;
      else if (s[i] === "}") { depth--; if (depth === 0) return i; }
    }
    return s.length;
  }

  function matchBracket(s, start) {
    if (s[start] !== "[") return start;
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      if (s[i] === "[") depth++;
      else if (s[i] === "]") { depth--; if (depth === 0) return i; }
    }
    return s.length;
  }

  function matchParen(s, start, open, close) {
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      if (s[i] === open) depth++;
      else if (s[i] === close) { depth--; if (depth === 0) return i; }
    }
    return s.length;
  }

  // Find the closing delimiter for an absolute-value or norm pair starting
  // at `start`. `delim` is either "|" (bare) or "\\|" (norm).
  // Returns the index of the matching close, or -1 if no clean match.
  //
  // Tracks paren/brace/bracket depth so we don't pair `|` across them.
  // For "|", also stops at certain separator chars that would never
  // appear inside a clean |...| absolute-value pair.
  function findMatchingAbsBar(s, start, delim) {
    let parenDepth = 0, braceDepth = 0, brackDepth = 0;
    const delimLen = delim.length;
    for (let i = start + delimLen; i < s.length; i++) {
      const c = s[i];
      if (c === "\\") {
        // Norm delimiter is `\|` — check before treating `\` as a
        // generic command.
        if (delim === "\\|" && s[i + 1] === "|" &&
            parenDepth === 0 && braceDepth === 0 && brackDepth === 0) {
          return i;
        }
        // Skip a command (so `|\sin x|` and `|\frac{a}{b}|` don't trip up).
        let k = i + 1;
        while (k < s.length && /[a-zA-Z]/.test(s[k])) k++;
        if (k === i + 1 && k < s.length) k = i + 2;
        i = k - 1;
        continue;
      }
      if (c === "(") parenDepth++;
      else if (c === ")") parenDepth--;
      else if (c === "{") braceDepth++;
      else if (c === "}") braceDepth--;
      else if (c === "[") brackDepth++;
      else if (c === "]") brackDepth--;
      else if (parenDepth === 0 && braceDepth === 0 && brackDepth === 0) {
        if (delim === "|" && c === "|") return i;
        // Hard stops for bare |...| — these never appear inside a
        // clean absolute-value argument. (Norm |...| is more permissive
        // because explicit \| pairs are typed deliberately and won't
        // wrap across these boundaries.)
        if (delim === "|" && (c === "=" || c === ";" || c === ",")) return -1;
      }
      if (parenDepth < 0 || braceDepth < 0 || brackDepth < 0) return -1;
    }
    return -1;
  }

  // Find the matching `\rangle` for a `\langle` at the start. Returns
  // the index of `\` in `\rangle`, or -1 if no clean match.
  function findMatchingRangle(s, start) {
    let depth = 0;
    let i = start;
    while (i < s.length) {
      if (s.startsWith("\\langle", i)) { depth++; i += 7; continue; }
      if (s.startsWith("\\rangle", i)) {
        if (depth === 0) return i;
        depth--; i += 7; continue;
      }
      i++;
    }
    return -1;
  }

  function matchLeftRight(s, start) {
    // s[start..] starts with "\left". Find matching "\right" at the same
    // depth, accounting for nested \left/\right pairs.
    let depth = 0;
    let i = start;
    while (i < s.length) {
      if (s.startsWith("\\left", i))  { depth++; i += 5; continue; }
      if (s.startsWith("\\right", i)) { depth--; if (depth === 0) return i; i += 6; continue; }
      i++;
    }
    return s.length;
  }

  // ── Constants ──────────────────────────────────────────────────────

  // Sum-style commands. When one of these appears as the LEADING atom of an
  // operand, the operand reads as "the summation/integral/product from …
  // to … of <body>" and we treat the whole operand as a sum-group: the
  // outline tracks both the bound symbols and the body. Bound by the
  // operand's natural end (next +, -, =, etc.) so we don't need an explicit
  // close marker.
  const SUM_TYPE_COMMANDS = new Set([
    "\\sum", "\\prod", "\\coprod",
    "\\int", "\\oint", "\\iint", "\\iiint", "\\iiiint", "\\oiint", "\\oiiint",
    "\\bigcup", "\\bigcap", "\\bigvee", "\\bigwedge",
    "\\bigoplus", "\\bigotimes", "\\bigodot", "\\biguplus", "\\bigsqcup",
    "\\lim",
  ]);

  // Operand-separator LaTeX commands. When these appear at the top level
  // of a token list, they split the surrounding atoms into separate
  // operands so the per-operand highlight tracks the spoken cadence
  // ("X squared. Plus. 2 X."  — three operand-spans, three switches).
  const SEPARATOR_COMMANDS = new Set([
    "\\pm", "\\mp",
    "\\le", "\\leq", "\\ge", "\\geq",
    "\\ne", "\\neq",
    "\\equiv", "\\approx", "\\sim", "\\propto", "\\cong",
    "\\to", "\\mapsto", "\\implies", "\\iff",
    "\\Rightarrow", "\\Leftarrow", "\\Leftrightarrow",
    "\\Longrightarrow", "\\Longleftarrow", "\\Longleftrightarrow",
  ]);

  function isOperandSeparator(tok) {
    if (!tok) return false;
    if (tok.type === "op") return tok.op === "+" || tok.op === "-" || tok.op === "=";
    if (tok.type === "atom") return SEPARATOR_COMMANDS.has(tok.latex);
    // Chemistry arrows: "->", "<=>", "<->" are operand separators (each
    // reactant / product set is its own operand). Treated like + between
    // species in a reaction.
    if (tok.type === "ce-arrow") return true;
    return false;
  }

  function isSumType(tok) {
    return tok && tok.type === "atom" && SUM_TYPE_COMMANDS.has(tok.latex);
  }

  // Commands whose brace argument should be captured VERBATIM (no recursion
  // into the contents). Text-mode commands and font commands fall here —
  // their contents are display text, not math expression. Recursing in
  // would mis-tokenise things like `\text{J/(mol}` (the `(` is part of a
  // unit label, not a paren group).
  const OPAQUE_COMMANDS = new Set([
    "\\text", "\\textnormal", "\\textbf", "\\textit", "\\textrm", "\\texttt", "\\textsf",
    "\\mathrm", "\\mathbf", "\\mathit", "\\mathcal", "\\mathsf", "\\mathfrak",
    "\\mathscr", "\\mathbb", "\\boldsymbol", "\\operatorname", "\\rm", "\\bf", "\\it",
    "\\href", "\\hbox", "\\mbox", "\\vbox",
  ]);

  // Accent commands: \vec{x} → "x vector", \hat{i} → "i hat", \bar{X} → "X
  // bar", \dot{q} → "q dot", \tilde{n} → "n tilde". The walker emits the
  // inner content first then the accent word (matches natural English).
  const ACCENT_COMMANDS = {
    "\\vec":    "vector",
    "\\hat":    "hat",
    "\\widehat":"hat",
    "\\bar":    "bar",
    "\\overline":"bar",
    "\\overrightarrow": "vector",
    "\\dot":    "dot",
    "\\ddot":   "double dot",
    "\\tilde":  "tilde",
    "\\widetilde": "tilde",
    "\\check":  "check",
    "\\breve":  "breve",
  };

  // Multi-line equation environments — each line is its own math
  // expression. Lines are separated by `\\` in the body.
  const MULTILINE_EQ_ENVS = new Set([
    "align", "align*", "aligned",
    "gather", "gather*", "gathered",
    "multline", "multline*",
    "eqnarray", "eqnarray*",
    "equation*", "split",
  ]);

  // Split a multi-line environment body on top-level "\\" line breaks.
  // Respects brace depth so a "\\" inside a nested {…} doesn't terminate
  // the line.
  function splitTopLevelLines(body) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (depth === 0 && ch === "\\" && body[i + 1] === "\\") {
        out.push(body.slice(start, i));
        // Skip the "\\" plus any trailing whitespace.
        i += 2;
        while (i < body.length && /\s/.test(body[i])) i++;
        start = i;
        i--; // loop will i++
      }
    }
    if (start < body.length) out.push(body.slice(start));
    return out.map(s => s.trim()).filter(s => s.length > 0);
  }

  // Sized-delimiter commands. `\bigl`/`\bigr` etc. should be treated like
  // `\left`/`\right` — a paired bracket group. Same for `\Big`/`\Bigg`.
  const BIG_LEFT_COMMANDS = new Set([
    "\\bigl", "\\Bigl", "\\biggl", "\\Biggl",
  ]);
  const BIG_RIGHT_COMMANDS = new Set([
    "\\bigr", "\\Bigr", "\\biggr", "\\Biggr",
  ]);
  // \big, \Big without l/r are also delimiter-sizing but don't pair —
  // they apply to the next delimiter glyph in either direction.

  function matchBigLeftRight(s, start, leftCmd) {
    // s[start..] begins with leftCmd (e.g. "\\bigl"). Find the matching
    // right command at the same nesting depth, accounting for nested
    // \bigl…\bigr pairs (also \left…\right).
    let depth = 0;
    let i = start;
    const rightCmd = leftCmd.replace(/l$/, "r");
    while (i < s.length) {
      if (s.startsWith(leftCmd, i)) { depth++; i += leftCmd.length; continue; }
      if (s.startsWith(rightCmd, i)) { depth--; if (depth === 0) return i; i += rightCmd.length; continue; }
      // Also balance \left/\right so they don't confuse the count
      if (s.startsWith("\\left", i)) { i += 5; if (i < s.length) i++; continue; }
      if (s.startsWith("\\right", i)) { i += 6; if (i < s.length) i++; continue; }
      i++;
    }
    return s.length;
  }

  // ── Tokeniser ──────────────────────────────────────────────────────

  function tokenize(latex, ctx) {
    if (!ctx) ctx = { nextGroupId: 1, nextOperandId: 1 };
    const tokens = [];
    let i = 0;
    while (i < latex.length) {
      const ch = latex[i];

      // Backslash command
      if (ch === "\\") {
        // `\|x\|` — norm pair (must be detected BEFORE the generic
        // command reader, otherwise `\|` is captured as a single-symbol
        // command atom and the matching `\|` is never paired with it).
        // Reads as "the norm of X".
        if (latex[i + 1] === "|") {
          const matchEnd = findMatchingAbsBar(latex, i, "\\|");
          if (matchEnd > i) {
            const inner = tokenize(latex.slice(i + 2, matchEnd), ctx);
            const id = `grp-${ctx.nextGroupId++}`;
            tokens.push({ type: "paren", kind: "||", id, bare: true, content: inner });
            i = matchEnd + 2; // past the closing \|
            continue;
          }
        }

        // `\langle X \rangle` — angle brackets. Conventionally read as
        // "the expectation of X" in physics / probability (the use case
        // in our library — e.g. expectation values, inner products).
        // Detected before generic command parsing so we can pair the
        // open and close as one group.
        if (latex.startsWith("\\langle", i)) {
          const matchEnd = findMatchingRangle(latex, i + 7);
          if (matchEnd > 0) {
            const inner = tokenize(latex.slice(i + 7, matchEnd), ctx);
            const id = `grp-${ctx.nextGroupId++}`;
            tokens.push({ type: "paren", kind: "<>", id, content: inner });
            i = matchEnd + 7; // past "\rangle"
            continue;
          }
        }

        // \left( … \right) — a paired bracket group with sizing
        if (latex.startsWith("\\left", i)) {
          const delimCh = latex[i + 5];
          let kind = "(";
          if (delimCh === "[") kind = "[";
          else if (delimCh === "|") kind = "|";
          // Find matching \right at this depth.
          const rightStart = matchLeftRight(latex, i);
          const innerStart = i + 6; // past "\\left" + delimiter
          const inner = tokenize(latex.slice(innerStart, rightStart), ctx);
          const id = `grp-${ctx.nextGroupId++}`;
          tokens.push({ type: "paren", kind, id, content: inner });
          // Skip "\right" + its delimiter character.
          i = rightStart + 6;
          if (latex[i] && latex[i] !== " ") i++;
          continue;
        }
        if (latex.startsWith("\\right", i)) {
          // Stray \right — shouldn't normally happen in well-balanced input.
          // Skip it plus the following delimiter.
          i += 6;
          if (latex[i] && latex[i] !== " ") i++;
          continue;
        }

        // Read full command name.
        // LaTeX commands are either `\` + one-or-more letters
        // (\frac, \alpha, \sin, …) OR `\` + exactly one non-letter
        // symbol (\!, \,, \;, \:, \>, \{, \}, \%, etc.) — the latter
        // are mostly spacing commands. We must NOT treat a bare `\`
        // as a complete command — that would orphan the following
        // symbol and break KaTeX parsing (`\` followed by `}` is read
        // by KaTeX as an escaped right brace).
        let j = i + 1;
        while (j < latex.length && /[a-zA-Z]/.test(latex[j])) j++;
        if (j === i + 1 && j < latex.length && !/\s/.test(latex[j])) {
          // No letters after \ — capture the single symbol following it.
          j = i + 2;
        }
        const cmd = latex.slice(i, j);

        // \begin{X} … \end{X} environments. Two flavours:
        //
        //   • Matrix-like (pmatrix, bmatrix, vmatrix, smallmatrix, …) and
        //     tabular environments — captured verbatim because their `&`
        //     and `\\` delimiters aren't operand separators and the
        //     entries are display-cells, not math sub-expressions.
        //
        //   • Multi-line equation environments (align, align*, aligned,
        //     gather, gather*, equation, multline, eqnarray) — each line
        //     between `\\` is itself a top-level math expression. We
        //     parse the body, recurse into each line for normal
        //     operand/group treatment, and re-emit the environment with
        //     wrapped lines so the listener hears AND sees each line
        //     highlighted as TTS reads it.
        if (cmd === "\\begin" && latex[j] === "{") {
          const nameEnd = matchBrace(latex, j);
          const envName = latex.slice(j + 1, nameEnd);
          const endMarker = `\\end{${envName}}`;
          let depth = 1;
          let k = nameEnd + 1;
          while (k < latex.length) {
            if (latex.startsWith(`\\begin{${envName}}`, k)) { depth++; k += (`\\begin{${envName}}`).length; continue; }
            if (latex.startsWith(endMarker, k)) {
              depth--;
              if (depth === 0) { k += endMarker.length; break; }
              k += endMarker.length;
              continue;
            }
            k++;
          }
          // Multi-line equation environments — recurse into each line.
          // Each line is parsed AND operand-grouped here so the rendered
          // output and the script both have the right structure ready to
          // emit. We share ctx so group / operand IDs continue the same
          // sequence as the outer expression.
          if (MULTILINE_EQ_ENVS.has(envName)) {
            const bodyStart = nameEnd + 1;
            const bodyEnd   = k - endMarker.length;
            const body      = latex.slice(bodyStart, bodyEnd);
            const lineLatexes = splitTopLevelLines(body);
            const lines = lineLatexes.map(lineLatex => {
              const lineTokens = tokenize(lineLatex, ctx);
              const lineItems  = buildOperands(lineTokens, ctx);
              return { type: "align-line", items: lineItems };
            });
            tokens.push({ type: "align-env", envName, lines });
            i = k;
            continue;
          }
          // Other environments (matrices, tabular, etc.) — opaque atom.
          // For matrices we record the env type so the walker can emit a
          // spoken summary like "the matrix" rather than reading the
          // literal LaTeX (begin{pmatrix} ... end{pmatrix}). The body is
          // captured verbatim for KaTeX to render.
          const fullLatex = latex.slice(i, k);
          let speech = "";
          if (/^(p|b|B|v|V|small)?matrix\*?$/.test(envName)) {
            speech = envName.startsWith("v") || envName.startsWith("V")
              ? "the determinant matrix" : "the matrix";
          } else if (envName === "cases") {
            speech = "the cases";
          } else if (envName === "array") {
            speech = "the array";
          }
          tokens.push({ type: "atom", latex: fullLatex, opaque: true, speech });
          i = k;
          continue;
        }

        // \bigl( … \bigr) and friends — paired sized brackets. Treat
        // exactly like \left…\right.
        if (BIG_LEFT_COMMANDS.has(cmd)) {
          const delimCh = latex[j];
          let kind = "(";
          if (delimCh === "[") kind = "[";
          else if (delimCh === "|") kind = "|";
          else if (delimCh === "\\") {
            // \bigl\{  — escape + delimiter command; keep as paren-ish but
            // we don't recognise it specially. Skip to the next char.
          }
          const rightStart = matchBigLeftRight(latex, i, cmd);
          const innerStart = j + 1;
          const inner = tokenize(latex.slice(innerStart, rightStart), ctx);
          const id = `grp-${ctx.nextGroupId++}`;
          tokens.push({ type: "paren", kind, id, content: inner, sizedLeft: cmd });
          // Skip past the matching right command + its delimiter.
          const rightCmd = cmd.replace(/l$/, "r");
          i = rightStart + rightCmd.length;
          if (latex[i] && latex[i] !== " ") i++;
          continue;
        }

        // Opaque commands like \text{...}, \mathrm{...} — capture the
        // command + its brace argument verbatim. The argument can contain
        // any characters (parens, slashes, etc.) and we must not recurse.
        if (OPAQUE_COMMANDS.has(cmd) && latex[j] === "{") {
          const argEnd = matchBrace(latex, j);
          tokens.push({ type: "atom", latex: latex.slice(i, argEnd + 1), opaque: true });
          i = argEnd + 1;
          continue;
        }

        // Accent commands: \vec{X}, \hat{i}, \bar{X}, etc. AND the
        // unbraced forms \vec a, \hat\imath. LaTeX lets accent commands
        // take a single token argument without braces — we must
        // recognise both forms or the rendered LaTeX will orphan the
        // argument (KaTeX would consume the closing `}` of our
        // \htmlClass wrapper as the accent's body).
        if (ACCENT_COMMANDS[cmd]) {
          // Skip whitespace between command and argument.
          let aj = j;
          while (aj < latex.length && /\s/.test(latex[aj])) aj++;
          if (latex[aj] === "{") {
            const argEnd = matchBrace(latex, aj);
            const inner = tokenize(latex.slice(aj + 1, argEnd), ctx);
            const id = `grp-${ctx.nextGroupId++}`;
            tokens.push({ type: "accent", id, cmd, word: ACCENT_COMMANDS[cmd], content: inner });
            i = argEnd + 1;
            continue;
          }
          if (aj < latex.length) {
            // Single-token argument. If it starts with `\`, consume the
            // full LaTeX command name (letters or single symbol).
            let argEnd;
            if (latex[aj] === "\\") {
              let k = aj + 1;
              while (k < latex.length && /[a-zA-Z]/.test(latex[k])) k++;
              if (k === aj + 1 && k < latex.length) k = aj + 2;
              argEnd = k;
            } else {
              argEnd = aj + 1;
            }
            const inner = tokenize(latex.slice(aj, argEnd), ctx);
            const id = `grp-${ctx.nextGroupId++}`;
            tokens.push({ type: "accent", id, cmd, word: ACCENT_COMMANDS[cmd], content: inner });
            i = argEnd;
            continue;
          }
        }

        // \ce{…} chemistry expressions — keep the WHOLE block opaque.
        //
        // mhchem renders `\ce{… -> …}` with a stretched arrow and
        // special spacing that doesn't survive being decomposed into
        // separate `\ce{species}` calls joined by inline `\to`. To
        // preserve the visual rendering EXACTLY, we emit the whole
        // \ce{…} verbatim and let mhchem handle it. The atomMap loses
        // per-species highlighting (one big atom spans the whole
        // reaction); speech still goes through the rich
        // spokenForChemistry pipeline via the chemistry-dispatch in
        // generateMathSpeech.
        if (cmd === "\\ce" && latex[j] === "{") {
          const bodyEnd = matchBrace(latex, j);
          const fullCe = latex.slice(i, bodyEnd + 1);
          tokens.push({ type: "atom", latex: fullCe, opaque: true, isChemistry: true });
          i = bodyEnd + 1;
          continue;
        }

        // \frac / \tfrac / \dfrac / \cfrac — {num}{den}.
        // \cfrac is KaTeX's continued-fraction frac variant — same {num}{den}
        // shape, AMSmath-defined. Reads identically to \frac for speech.
        if (cmd === "\\frac" || cmd === "\\tfrac" || cmd === "\\dfrac" || cmd === "\\cfrac") {
          while (j < latex.length && /\s/.test(latex[j])) j++;
          if (latex[j] === "{") {
            const numEnd = matchBrace(latex, j);
            const num = tokenize(latex.slice(j + 1, numEnd), ctx);
            let k = numEnd + 1;
            while (k < latex.length && /\s/.test(latex[k])) k++;
            if (latex[k] === "{") {
              const denEnd = matchBrace(latex, k);
              const den = tokenize(latex.slice(k + 1, denEnd), ctx);
              const id = `grp-${ctx.nextGroupId++}`;
              tokens.push({ type: "frac", id, num, den, kind: cmd });
              i = denEnd + 1;
              continue;
            }
          }
        }

        // n-ary commands that take {a}{b} arguments — \binom, \dbinom,
        // \tbinom, \overset, \underset, \stackrel. KaTeX needs the
        // command and its braces to stay together; if we wrap just the
        // command in \htmlClass the args become orphan brace groups and
        // rendering breaks. Capture command + both args verbatim into an
        // opaque atom that the wrapped-LaTeX emitter passes through.
        // Speech for these is derived from the verbatim LaTeX in
        // atomToSpeech (e.g. \binom{n}{k} → "n choose k").
        if (cmd === "\\binom" || cmd === "\\dbinom" || cmd === "\\tbinom" ||
            cmd === "\\overset" || cmd === "\\underset" || cmd === "\\stackrel") {
          while (j < latex.length && /\s/.test(latex[j])) j++;
          if (latex[j] === "{") {
            const arg1End = matchBrace(latex, j);
            let k = arg1End + 1;
            while (k < latex.length && /\s/.test(latex[k])) k++;
            if (latex[k] === "{") {
              const arg2End = matchBrace(latex, k);
              // Tokenise the two arg bodies so they can render with
              // wrappers and contribute to the atomMap. Emit a special
              // "nary" node the renderer knows how to reassemble.
              const arg1 = tokenize(latex.slice(j + 1, arg1End), ctx);
              const arg2 = tokenize(latex.slice(k + 1, arg2End), ctx);
              const id = `grp-${ctx.nextGroupId++}`;
              tokens.push({ type: "nary", cmd, id, arg1, arg2 });
              i = arg2End + 1;
              continue;
            }
          }
        }

        // \sqrt — optional [n] index, then {radicand} or a single
        // non-braced argument like `\sqrt 5`.
        if (cmd === "\\sqrt") {
          while (j < latex.length && /\s/.test(latex[j])) j++;
          let index = null;
          if (latex[j] === "[") {
            const indexEnd = matchBracket(latex, j);
            index = tokenize(latex.slice(j + 1, indexEnd), ctx);
            j = indexEnd + 1;
            while (j < latex.length && /\s/.test(latex[j])) j++;
          }
          if (latex[j] === "{") {
            const radEnd = matchBrace(latex, j);
            const rad = tokenize(latex.slice(j + 1, radEnd), ctx);
            const id = `grp-${ctx.nextGroupId++}`;
            tokens.push({ type: "sqrt", id, index, rad });
            i = radEnd + 1;
            continue;
          }
          // Single-token radicand: `\sqrt 5`, `\sqrt N`, `\sqrt\pi`.
          if (j < latex.length && !/[\s\\]/.test(latex[j])) {
            const rad = [{ type: "atom", latex: latex[j] }];
            const id = `grp-${ctx.nextGroupId++}`;
            tokens.push({ type: "sqrt", id, index, rad });
            i = j + 1;
            continue;
          }
          if (latex[j] === "\\") {
            let k = j + 1;
            while (k < latex.length && /[a-zA-Z]/.test(latex[k])) k++;
            if (k === j + 1 && k < latex.length) k = j + 2;
            const rad = [{ type: "atom", latex: latex.slice(j, k) }];
            const id = `grp-${ctx.nextGroupId++}`;
            tokens.push({ type: "sqrt", id, index, rad });
            i = k;
            continue;
          }
        }

        // \pmod{n} / \pod{n} — parenthesised modulo, takes a brace arg.
        // \mathring{r} — ring accent, takes a brace arg.
        // (\bmod and \mod without braces are handled below as bare
        // operator atoms via COMMAND_SPEECH.)
        if (cmd === "\\pmod" || cmd === "\\pod" || cmd === "\\mathring") {
          while (j < latex.length && /\s/.test(latex[j])) j++;
          if (latex[j] === "{") {
            const argEnd = matchBrace(latex, j);
            const arg = tokenize(latex.slice(j + 1, argEnd), ctx);
            const id = `grp-${ctx.nextGroupId++}`;
            let speech = "modulo";
            if (cmd === "\\mathring") speech = "ring";
            tokens.push({ type: "modcmd", id, cmd, speech, content: arg });
            i = argEnd + 1;
            continue;
          }
        }

        // Generic command — treat as a leaf atom. Preserves things like
        // \pi, \theta, \sin, \cdot, \pm, \infty for the wrapped-LaTeX
        // renderer to pass through to KaTeX unchanged.
        tokens.push({ type: "atom", latex: cmd });
        i = j;
        continue;
      }

      // Anonymous brace group {…} — not a "visible" group, just LaTeX
      // syntax for grouping. Recurse without assigning a group ID.
      if (ch === "{") {
        const end = matchBrace(latex, i);
        const inner = tokenize(latex.slice(i + 1, end), ctx);
        tokens.push({ type: "brace", content: inner });
        i = end + 1;
        continue;
      }

      // Bare parens / brackets — visible group. The `bare` flag tells the
      // emitter to render with raw `(...)` rather than `\left(...\right)`,
      // matching the original rendering. (Tokens originally typed with
      // `\left/\right` set bare=false.) Without this, KaTeX renders the
      // wrapped version with adaptive-height parens which differ from
      // the user's original.
      if (ch === "(") {
        const end = matchParen(latex, i, "(", ")");
        const inner = tokenize(latex.slice(i + 1, end), ctx);
        const id = `grp-${ctx.nextGroupId++}`;
        tokens.push({ type: "paren", kind: "(", id, bare: true, content: inner });
        i = end + 1;
        continue;
      }
      if (ch === "[") {
        const end = matchParen(latex, i, "[", "]");
        const inner = tokenize(latex.slice(i + 1, end), ctx);
        const id = `grp-${ctx.nextGroupId++}`;
        tokens.push({ type: "paren", kind: "[", id, bare: true, content: inner });
        i = end + 1;
        continue;
      }

      // Bare "|" — detect matched absolute-value pairs.
      //
      // A bare `|x|` reads as "the absolute value of X". The same
      // character also serves as "given" (conditional probability,
      // set-builder) or "divides" — so we have to be careful when to
      // treat it as a bracket pair.
      //
      // Heuristic: scan forward from this `|` looking for the matching
      // `|` such that the content between them parses cleanly without
      // any unmatched paren / brace / brackets, AND we haven't crossed
      // a separator (`,`, `=`, `+`) that would suggest this is two
      // bare bars rather than a pair.
      //
      // If no clean match is found, fall through to atom-level (reads
      // as "given").
      if (ch === "|") {
        const matchEnd = findMatchingAbsBar(latex, i, "|");
        if (matchEnd > i) {
          const inner = tokenize(latex.slice(i + 1, matchEnd), ctx);
          const id = `grp-${ctx.nextGroupId++}`;
          tokens.push({ type: "paren", kind: "|", id, bare: true, content: inner });
          i = matchEnd + 1;
          continue;
        }
      }


      // Operators (separator candidates — used for operand split in v0.2)
      if (/[+\-=]/.test(ch)) {
        tokens.push({ type: "op", op: ch });
        i++;
        continue;
      }

      // Whitespace — preserve so the emitted wrapped LaTeX matches spacing.
      if (/\s/.test(ch)) {
        tokens.push({ type: "space", char: ch });
        i++;
        continue;
      }

      // ^{…} / _{…} with brace content → sup/sub group with a parsed
      // inner content. Bare ^X / _X (single token) → sup/sub group with
      // a one-element content (the next char or LaTeX command). The
      // walker needs the structured sup/sub node to emit "squared",
      // "cubed", "raised to the …" properly. (The older buildSpeechScript
      // path treats single-char sup/sub as anchor-less; no script events
      // are generated for them, so it doesn't false-fire.)
      if ((ch === "^" || ch === "_") && i + 1 < latex.length) {
        let inner, advance;
        if (latex[i + 1] === "{") {
          const braceEnd = matchBrace(latex, i + 1);
          inner = tokenize(latex.slice(i + 2, braceEnd), ctx);
          advance = braceEnd + 1;
        } else if (latex[i + 1] === "\\") {
          // LaTeX command — read the command name.
          let k = i + 2;
          while (k < latex.length && /[a-zA-Z]/.test(latex[k])) k++;
          inner = [{ type: "atom", latex: latex.slice(i + 1, k) }];
          advance = k;
        } else {
          // Single-char content
          inner = [{ type: "atom", latex: latex[i + 1] }];
          advance = i + 2;
        }
        const id = `grp-${ctx.nextGroupId++}`;
        tokens.push({
          type: ch === "^" ? "sup" : "sub",
          id, content: inner,
        });
        i = advance;
        continue;
      }

      // Consecutive digits → single multi-digit atom. So "180" becomes
      // one atom that reads naturally ("one hundred and eighty") rather
      // than three separate atoms read digit-by-digit ("one, eight, oh").
      // Stops at any non-digit, non-period; decimals like "3.14" stay
      // together too. Trailing periods (sentence-ending) are excluded by
      // peeking at the next char.
      if (/\d/.test(ch)) {
        let k = i;
        while (k < latex.length && /\d/.test(latex[k])) k++;
        // Decimal point ONLY if followed by another digit.
        if (latex[k] === "." && /\d/.test(latex[k + 1])) {
          k++;
          while (k < latex.length && /\d/.test(latex[k])) k++;
        }
        tokens.push({ type: "atom", latex: latex.slice(i, k) });
        i = k;
        continue;
      }

      // `&` — column-separator inside align / array environments. Emit
      // it as its own token so buildOperands keeps it OUTSIDE operand
      // wrappers: KaTeX rejects `&` inside an \htmlClass{…}{…} group
      // and the whole align fails to parse. Outside an align env `&` is
      // invalid LaTeX anyway, so a per-token emit is harmless either way.
      if (ch === "&") {
        tokens.push({ type: "align-sep", char: "&" });
        i++;
        continue;
      }

      // Anything else (letters, ^, _, etc.) is a single-char atom.
      tokens.push({ type: "atom", latex: ch });
      i++;
    }
    return tokens;
  }

  // ── Chemistry body parser ──────────────────────────────────────────
  //
  // Splits a `\ce{...}` body on the chemistry separators (`+`, `->`,
  // `<=>`, `<->`) and emits a flat token list of species + separator
  // tokens that flow through the rest of the pipeline as if they were
  // top-level atoms. Each species becomes a `ce-species` atom that
  // renders as its own `\ce{species}` call so KaTeX/mhchem treats each
  // species independently and our \htmlClass wrappers don't confuse
  // the mhchem parser.
  function parseCeBody(body) {
    const out = [];
    // Scan for separators in order: longest-first matters because `<=>`
    // and `<->` would otherwise be partially eaten by `<` / `>`.
    const SEPS = [
      { match: "<=>",  emit: { type: "ce-arrow", op: "<=>",  latex: " \\rightleftharpoons " } },
      { match: "<->",  emit: { type: "ce-arrow", op: "<->",  latex: " \\rightleftarrows " } },
      { match: "->",   emit: { type: "ce-arrow", op: "->",   latex: " \\to " } },
      { match: "+",    emit: { type: "op",       op: "+" } },
    ];
    let i = 0;
    let species = "";
    function flushSpecies() {
      const s = species.trim();
      species = "";
      if (s) out.push({ type: "ce-species", text: s });
    }
    while (i < body.length) {
      let matched = false;
      for (const sep of SEPS) {
        if (body.startsWith(sep.match, i)) {
          flushSpecies();
          out.push({ ...sep.emit });
          i += sep.match.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      species += body[i];
      i++;
    }
    flushSpecies();
    return out;
  }

  // ── Operand builder ────────────────────────────────────────────────
  //
  // Walks a flat token list at one level and groups consecutive non-
  // separator tokens into `operand` nodes. Separators stay between them
  // as plain tokens. Handles unary minus: a "-" at the start of an
  // operand (or right after another separator) is treated as part of
  // the next operand rather than a separator on its own.
  function buildOperands(tokens, ctx) {
    const result = [];
    let cur = [];
    let unary = true; // at start, a leading "-" is unary
    function flush() {
      // Drop leading/trailing space tokens so the operand's outer span
      // hugs the rendered content (avoids the highlight running into a
      // following operator).
      while (cur.length && cur[0].type === "space") cur.shift();
      while (cur.length && cur[cur.length - 1].type === "space") cur.pop();
      if (cur.length === 0) return;
      const id = `opd-${ctx.nextOperandId++}`;
      // Detect sum-style operand: if first non-space content is \sum /
      // \int / \prod / etc., also assign a group id so the operand's
      // outline tracks the spoken "the summation"/"the integral"/etc.
      // anchor in addition to the operand background.
      const sumGroupId = isSumType(cur[0]) ? `grp-${ctx.nextGroupId++}` : null;
      result.push({ type: "operand", id, sumGroupId, content: cur.slice() });
      cur = [];
    }
    for (const tok of tokens) {
      // align-env is a block-level construct (multi-line equation) and
      // must NOT sit inside an operand wrapper — KaTeX requires \begin{align}
      // at the outermost level. Flush whatever's pending and emit the
      // align-env directly. Its internal lines have their own operands.
      if (tok.type === "align-env") {
        flush();
        result.push(tok);
        unary = true;
        continue;
      }
      // `&` column-separator inside an align line — flush the current
      // operand so its wrapper closes BEFORE the `&`, then emit the `&`
      // at the top level. (See tokenize: KaTeX rejects `&` inside
      // \htmlClass{…}{…}, so it MUST stay outside any operand wrap.)
      if (tok.type === "align-sep") {
        flush();
        result.push(tok);
        unary = true;
        continue;
      }
      // Pass spaces through but keep them in the current operand if one
      // is in progress (so the rendered operand keeps internal spacing).
      if (tok.type === "space") {
        if (cur.length > 0) cur.push(tok);
        else result.push(tok);
        continue;
      }
      if (isOperandSeparator(tok)) {
        // Unary minus: keep with the upcoming operand, don't split.
        if (tok.type === "op" && tok.op === "-" && unary) {
          cur.push(tok);
          unary = false;
          continue;
        }
        flush();
        result.push(tok);
        unary = true;
        continue;
      }
      cur.push(tok);
      unary = false;
    }
    flush();
    return result;
  }

  // ── Wrapped LaTeX emitter ──────────────────────────────────────────

  function renderTokens(tokens) {
    return tokens.map(renderNode).join("");
  }
  function renderOperandLevel(items) {
    // items is a buildOperands() output — operands + separator tokens.
    return items.map(item => {
      if (item.type === "operand") {
        const inner = renderTokens(item.content);
        const opdWrap = `\\htmlClass{eq-opd ${item.id}}{${inner}}`;
        if (item.sumGroupId) {
          return `\\htmlClass{eq-grp ${item.sumGroupId}}{${opdWrap}}`;
        }
        return opdWrap;
      }
      return renderNode(item);
    }).join("");
  }
  function renderNode(node) {
    if (node.type === "frac") {
      const cmd = node.kind || "\\frac";
      return `\\htmlClass{eq-grp ${node.id}}{${cmd}{${renderTokens(node.num)}}{${renderTokens(node.den)}}}`;
    }
    if (node.type === "sqrt") {
      const idx = node.index ? `[${renderTokens(node.index)}]` : "";
      return `\\htmlClass{eq-grp ${node.id}}{\\sqrt${idx}{${renderTokens(node.rad)}}}`;
    }
    if (node.type === "paren") {
      if (node.kind === "(") return `\\htmlClass{eq-grp ${node.id}}{\\left(${renderTokens(node.content)}\\right)}`;
      if (node.kind === "[") return `\\htmlClass{eq-grp ${node.id}}{\\left[${renderTokens(node.content)}\\right]}`;
      if (node.kind === "|") return `\\htmlClass{eq-grp ${node.id}}{\\left|${renderTokens(node.content)}\\right|}`;
    }
    if (node.type === "sup") {
      return `^{\\htmlClass{eq-grp ${node.id}}{${renderTokens(node.content)}}}`;
    }
    if (node.type === "sub") {
      return `_{\\htmlClass{eq-grp ${node.id}}{${renderTokens(node.content)}}}`;
    }
    if (node.type === "brace") return `{${renderTokens(node.content)}}`;
    if (node.type === "op") return node.op;
    if (node.type === "space") return node.char;
    if (node.type === "align-sep") return node.char;
    if (node.type === "atom") return node.latex;
    // Chemistry species: render each as its own \ce{species} call so
    // KaTeX/mhchem parses them independently. The operand wrapper around
    // this provides the visual highlight container.
    if (node.type === "ce-species") return `\\ce{${node.text}}`;
    // Chemistry separator arrow rendered in math mode (we're outside the
    // \ce body now). Pre-defined LaTeX equivalents in parseCeBody.
    if (node.type === "ce-arrow") return node.latex;
    // Multi-line equation environment. Each line's operand-level items
    // were prepared during tokenisation; just emit them with KaTeX's
    // \\ line break between lines.
    if (node.type === "align-env") {
      const lineBodies = node.lines.map(line => renderOperandLevel(line.items));
      return `\\begin{${node.envName}}${lineBodies.join(" \\\\ ")}\\end{${node.envName}}`;
    }
    return "";
  }

  // ── Tree walk for group ordering ───────────────────────────────────

  function collectGroupsInOrder(tokens) {
    const out = [];
    function walk(nodes) {
      for (const n of nodes) {
        if (n.type === "frac")  { out.push(n); walk(n.num); walk(n.den); }
        else if (n.type === "sqrt")  { out.push(n); if (n.index) walk(n.index); walk(n.rad); }
        else if (n.type === "paren") { out.push(n); walk(n.content); }
        else if (n.type === "brace") { walk(n.content); }
      }
    }
    walk(tokens);
    return out;
  }

  // ── Spoken-text anchor scanner ─────────────────────────────────────

  function findAnchors(spokenText) {
    // Word-tokenise the same way renderSpokenView does — split on
    // whitespace, keep punctuation attached to the preceding word.
    const parts = (spokenText || "").match(/\S+|\s+/g) || [];
    const words = parts.filter(p => !/^\s+$/.test(p));

    const anchors = [];
    // Lowercase + strip trailing punctuation for matching keywords.
    function lc(w) { return (w || "").toLowerCase().replace(/[.,;:]+$/, ""); }
    // Detect a trailing period — used to distinguish a top-level relational
    // operator (gets a major pause from _insertRelationalPauses) from the
    // same word appearing inside an integral bound or sum limit (no period).
    function hasPeriod(w) { return /\.$/.test(w || ""); }

    // Multi-word relational phrases to recognise as operand splits. Longer
    // ones must be tried first so "is less than or equal to" doesn't get
    // truncated to "is less than". Each entry has its word count.
    const RELATIONAL_PHRASES = [
      // Longest first
      ["is", "less", "than", "or", "equal", "to"],
      ["is", "greater", "than", "or", "equal", "to"],
      ["less", "than", "or", "equal", "to"],
      ["greater", "than", "or", "equal", "to"],
      ["is", "approximately", "equal", "to"],
      ["approximately", "equal", "to"],
      ["if", "and", "only", "if"],
      ["is", "proportional", "to"],
      ["is", "perpendicular", "to"],
      ["is", "not", "equal", "to"],
      ["is", "congruent", "to"],
      ["is", "similar", "to"],
      ["is", "less", "than"],
      ["is", "greater", "than"],
      ["congruent", "to"],
      ["less", "than"],
      ["greater", "than"],
      ["maps", "to"],
      ["equals"],
      ["equal"], // bare (rare; from \equal command if any)
      ["implies"],
    ];

    function matchPhrase(i, phrase) {
      for (let j = 0; j < phrase.length; j++) {
        if (lc(words[i + j] || "") !== phrase[j]) return false;
      }
      return true;
    }
    // A relational phrase qualifies as an operand-split only if it ends
    // with a period — that's how _insertRelationalPauses marks a major
    // pause at a TOP-LEVEL relational. Bound-internal "equals" (inside
    // \\sum_{i=1}^n or \\int_a^b) is left period-less by
    // _fixEqualsInSumBounds, so this check excludes it cleanly.
    function relationalIsTopLevel(i, phrase) {
      const lastWord = words[i + phrase.length - 1] || "";
      return /\.$/.test(lastWord);
    }

    for (let i = 0; i < words.length; i++) {
      const w0 = lc(words[i]);
      const w1 = lc(words[i + 1] || "");
      const w2 = lc(words[i + 2] || "");
      const w3 = lc(words[i + 3] || "");

      // Group enter/exit — same as v0.1
      if (w0 === "the" && w1 === "fraction") {
        anchors.push({ wordIdx: i, type: "enter-frac", len: 2 });
        continue;
      }
      if (w0 === "end" && w1 === "fraction") {
        anchors.push({ wordIdx: i, type: "exit-frac", len: 2 });
        continue;
      }
      if (w0 === "the" && w1 === "square" && w2 === "root") {
        anchors.push({ wordIdx: i, type: "enter-sqrt", len: 3 });
        continue;
      }
      if (w0 === "end" && w1 === "square" && w2 === "root") {
        anchors.push({ wordIdx: i, type: "exit-sqrt", len: 3 });
        continue;
      }
      if (w0 === "the" && w1 === "root" && w2 === "with" && w3 === "index") {
        anchors.push({ wordIdx: i, type: "enter-sqrt", len: 4 });
        continue;
      }
      if (w0 === "end" && w1 === "root") {
        anchors.push({ wordIdx: i, type: "exit-sqrt", len: 2 });
        continue;
      }
      if (w0 === "open" && (w1 === "paren" || w1 === "parenthesis")) {
        anchors.push({ wordIdx: i, type: "enter-paren", len: 2 });
        continue;
      }
      if (w0 === "close" && (w1 === "paren" || w1 === "parenthesis")) {
        anchors.push({ wordIdx: i, type: "exit-paren", len: 2 });
        continue;
      }
      if (w0 === "open" && w1 === "bracket") {
        anchors.push({ wordIdx: i, type: "enter-paren", len: 2 });
        continue;
      }
      if (w0 === "close" && w1 === "bracket") {
        anchors.push({ wordIdx: i, type: "exit-paren", len: 2 });
        continue;
      }

      // Superscript "raised to the …" — MathLive emits this whenever the
      // exponent has more than one token. The body has no explicit close;
      // the exit timing is bound by the containing operand (handled below).
      if (w0 === "raised" && w1 === "to" && w2 === "the") {
        anchors.push({ wordIdx: i, type: "enter-sup", len: 3 });
        continue;
      }
      // Subscript "sub …" — multi-letter subscripts get a "sub" prefix.
      // Only match when followed by a letter / capital so single-letter
      // subscripts on plain atoms don't accidentally fire.
      if (w0 === "sub" && /^[A-Za-z]/.test(words[i + 1] || "")) {
        anchors.push({ wordIdx: i, type: "enter-sub", len: 1 });
        continue;
      }

      // Sum-style ENTER anchors. "The summation/integral/product/etc."
      // — pair these with sum-style operand groups in the tree.
      if (w0 === "the" && w1 === "summation") {
        anchors.push({ wordIdx: i, type: "enter-sum", len: 2 });
        continue;
      }
      if (w0 === "the" && w1 === "integral") {
        anchors.push({ wordIdx: i, type: "enter-sum", len: 2 });
        continue;
      }
      if (w0 === "the" && w1 === "product") {
        anchors.push({ wordIdx: i, type: "enter-sum", len: 2 });
        continue;
      }
      if (w0 === "the" && (w1 === "contour" || w1 === "double" || w1 === "triple") && w2 === "integral") {
        anchors.push({ wordIdx: i, type: "enter-sum", len: 3 });
        continue;
      }
      if (w0 === "the" && w1 === "closed" && w2 === "surface" && w3 === "integral") {
        anchors.push({ wordIdx: i, type: "enter-sum", len: 4 });
        continue;
      }
      // "Limit as X approaches A" — \lim_{x \to a}
      if (w0 === "limit" && w1 === "as") {
        anchors.push({ wordIdx: i, type: "enter-sum", len: 2 });
        continue;
      }

      // Operand-separator anchors: spoken markers between top-level
      // operands. We register every candidate (will be filtered by
      // depth in buildScript so only top-level ones split operands).

      // Additive: plus / minus (single word, no special punctuation)
      if (w0 === "plus" || w0 === "minus") {
        anchors.push({ wordIdx: i, type: "operand-split", len: 1 });
        continue;
      }
      // \pm / \mp render as "plus or minus" / "minus or plus" (3 words)
      if ((w0 === "plus" || w0 === "minus") && w1 === "or" &&
          (w2 === "minus" || w2 === "plus")) {
        anchors.push({ wordIdx: i, type: "operand-split", len: 3 });
        continue;
      }

      // Chemistry arrows. \ce{...->...} reads as "yields"; \ce{...<=>...}
      // reads as "in equilibrium with". Each marks a reactants/products
      // boundary, i.e. a top-level operand split. (No trailing-period
      // requirement — chemistry arrows aren't subject to
      // _insertRelationalPauses since they're not in its alternation.)
      if (w0 === "yields") {
        anchors.push({ wordIdx: i, type: "operand-split", len: 1 });
        continue;
      }
      if (w0 === "in" && w1 === "equilibrium" && w2 === "with") {
        anchors.push({ wordIdx: i, type: "operand-split", len: 3 });
        continue;
      }

      // Relational phrases (try longest first, take greedy match)
      let matched = false;
      for (const phrase of RELATIONAL_PHRASES) {
        if (matchPhrase(i, phrase) && relationalIsTopLevel(i, phrase)) {
          anchors.push({ wordIdx: i, type: "operand-split", len: phrase.length });
          i += phrase.length - 1;
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }
    return anchors;
  }

  // Walk the operand-level tree to collect everything in reading order:
  //   • Every group node (frac / sqrt / paren) — for ENTER/EXIT pairing
  //   • Every operand node — for OPERAND_SWITCH pairing
  //   • Every sum-style group attached to an operand — for sum ENTER pairing
  function collectAllInOrder(items) {
    const operands = [];   // operand nodes in source order
    const sumGroups = [];  // operands with sumGroupId (in source order)
    const fracs = [], sqrts = [], parens = [], sups = [], subs = [];
    function walkTokens(nodes) {
      for (const n of nodes) {
        if (n.type === "frac")  { fracs.push(n);  walkTokens(n.num); walkTokens(n.den); }
        else if (n.type === "sqrt")  { sqrts.push(n); if (n.index) walkTokens(n.index); walkTokens(n.rad); }
        else if (n.type === "paren") { parens.push(n); walkTokens(n.content); }
        else if (n.type === "brace") { walkTokens(n.content); }
        else if (n.type === "sup")   { sups.push(n);   walkTokens(n.content); }
        else if (n.type === "sub")   { subs.push(n);   walkTokens(n.content); }
        else if (n.type === "align-env") {
          // Each align line has its own operand-level items; walk them
          // exactly like the top-level item list so per-line operands
          // and groups land in the script in source order.
          for (const line of n.lines) walkItems(line.items);
        }
      }
    }
    function walkItems(itemList) {
      for (const item of itemList) {
        if (item.type === "operand") {
          operands.push(item);
          if (item.sumGroupId) sumGroups.push(item);
          walkTokens(item.content);
        } else {
          // Non-operand item at this level (align-env block, raw operator
          // token, whitespace). walkTokens knows how to recurse into
          // align-env's per-line items; other types are skipped.
          walkTokens([item]);
        }
      }
    }
    walkItems(items);
    return { operands, sumGroups, fracs, sqrts, parens, sups, subs };
  }

  // ── Script builder: pair anchors with tree elements in order ───────

  function buildScript(items, spokenText) {
    const { operands, sumGroups, fracs, sqrts, parens, sups, subs } = collectAllInOrder(items);
    const anchors = findAnchors(spokenText);

    // Bucket anchors by type.
    const A = (t) => anchors.filter(a => a.type === t);
    const enterFracs  = A("enter-frac");
    const exitFracs   = A("exit-frac");
    const enterSqrts  = A("enter-sqrt");
    const exitSqrts   = A("exit-sqrt");
    const enterParens = A("enter-paren");
    const exitParens  = A("exit-paren");
    const enterSums   = A("enter-sum");
    const opSplits    = A("operand-split");

    // Group pairings: ENTER at anchor head, EXIT at anchor end.
    const events = [];
    function pairGroup(groupList, enterList, exitList) {
      const n = Math.min(groupList.length, enterList.length);
      for (let i = 0; i < n; i++) {
        events.push({ wordIdx: enterList[i].wordIdx, action: "enter", id: groupList[i].id });
      }
      const m = Math.min(groupList.length, exitList.length);
      for (let i = 0; i < m; i++) {
        events.push({ wordIdx: exitList[i].wordIdx + exitList[i].len, action: "exit", id: groupList[i].id });
      }
    }
    pairGroup(fracs,  enterFracs,  exitFracs);
    pairGroup(sqrts,  enterSqrts,  exitSqrts);
    pairGroup(parens, enterParens, exitParens);

    // Sup / sub groups: ENTER at the anchor, EXIT just before the NEXT
    // sup/sub anchor of the same kind (or end of speech if last). This
    // gives each multi-token exponent / subscript its own brief flash as
    // MathLive reads it. Implicit (no "End superscript" marker exists).
    const enterSups = A("enter-sup");
    const enterSubs = A("enter-sub");
    function pairImplicit(groupList, enterList) {
      const n = Math.min(groupList.length, enterList.length);
      for (let i = 0; i < n; i++) {
        events.push({ wordIdx: enterList[i].wordIdx, action: "enter", id: groupList[i].id });
        const exitAt = i + 1 < enterList.length ? enterList[i + 1].wordIdx : 1e9;
        events.push({ wordIdx: exitAt, action: "exit", id: groupList[i].id });
      }
    }
    pairImplicit(sups, enterSups);
    pairImplicit(subs, enterSubs);

    // Sum-groups: ENTER at anchor; EXIT is bound by the operand the sum
    // lives in (handled below in the operand pass — the same wordIdx as
    // the operand's exit).
    for (let i = 0; i < Math.min(sumGroups.length, enterSums.length); i++) {
      const operand = sumGroups[i];
      const anchor = enterSums[i];
      events.push({ wordIdx: anchor.wordIdx, action: "enter", id: operand.sumGroupId });
    }

    // Operand events. The first operand enters at word 0 (or whenever
    // the first non-separator content starts being spoken). Subsequent
    // ones enter at each top-level operand-split anchor; the previous
    // operand exits at the same wordIdx (and its sum-group, if any,
    // exits there too).
    //
    // Filter operand-split anchors to top-level only by simulating depth
    // through the group enter/exit events alongside the splits.
    const topLevelSplits = filterTopLevelSplits(events, opSplits);
    if (operands.length > 0) {
      // First operand enters at word 0 (start of speech).
      events.push({ wordIdx: 0, action: "enter", id: operands[0].id });
      for (let i = 0; i < topLevelSplits.length && i + 1 < operands.length; i++) {
        const split = topLevelSplits[i];
        // Exit current operand at the split's wordIdx, before the separator
        // word is spoken. Enter the next operand AFTER the separator phrase
        // (split.len words) so the split phrase itself sits between
        // operand highlights — gives an audible gap with no operand-tint.
        events.push({ wordIdx: split.wordIdx, action: "exit", id: operands[i].id });
        // If this operand had a sum-group, exit it too at the split.
        if (operands[i].sumGroupId) {
          events.push({ wordIdx: split.wordIdx, action: "exit", id: operands[i].sumGroupId });
        }
        events.push({ wordIdx: split.wordIdx + split.len, action: "enter", id: operands[i + 1].id });
      }
      // Final operand exit — at end of script. We compute "end" as the
      // total word count of the spoken text (one past the last word) so the
      // operand highlight stays lit while the LAST word is being read, then
      // clears immediately after. Using max(eventWordIdx)+1 is wrong when
      // an operand has no internal group anchors (e.g. a single \ce{…}
      // chemistry block, or a plain "a+b+c" expression with no
      // frac/sqrt/sup/paren): the exit would fire after the first word and
      // the user would see the highlight ring flash off mid-utterance.
      const totalWords = (typeof spokenText === "string")
        ? (spokenText.match(/\S+/g) || []).length
        : 0;
      const maxIdx = events.length ? Math.max(...events.map(e => e.wordIdx)) : 0;
      const finalIdx = Math.max(totalWords, maxIdx + 1);
      events.push({ wordIdx: finalIdx, action: "exit", id: operands[operands.length - 1].id });
      const lastOperand = operands[operands.length - 1];
      if (lastOperand.sumGroupId) {
        events.push({ wordIdx: finalIdx, action: "exit", id: lastOperand.sumGroupId });
      }
    }

    events.sort((a, b) => {
      if (a.wordIdx !== b.wordIdx) return a.wordIdx - b.wordIdx;
      // At the same wordIdx, exits should fire BEFORE enters so the old
      // operand's tint clears before the new one's lights up.
      const order = (e) => e.action === "exit" ? 0 : 1;
      return order(a) - order(b);
    });
    return events;
  }

  // Simulate group depth through anchor sequence to identify which
  // operand-split anchors are at the top level (depth 0).
  //
  // Only count groups that have a MATCHED enter/exit pair — sum-style
  // groups have an ENTER but their EXIT is supplied later (the operand
  // boundary is the EXIT). Including them here would create a chicken-
  // and-egg: the split we're trying to detect IS the sum's exit.
  //
  // At the same wordIdx, fire EXITs first, then check the split's depth,
  // then fire ENTERs. So a paren that closes at the same word as a
  // relational operator-split (common pattern: "...Close paren. Equals.")
  // exits BEFORE we check whether the split is top-level.
  function filterTopLevelSplits(groupEvents, opSplits) {
    const enters = new Set();
    const exits  = new Set();
    for (const e of groupEvents) {
      if (e.action === "enter") enters.add(e.id);
      else if (e.action === "exit") exits.add(e.id);
    }
    const matched = new Set();
    for (const id of enters) if (exits.has(id)) matched.add(id);

    const merged = [];
    for (const e of groupEvents) {
      if (!matched.has(e.id)) continue;
      merged.push({
        wordIdx: e.wordIdx,
        kind:    e.action === "enter" ? "g-enter" : "g-exit",
      });
    }
    for (const s of opSplits) {
      merged.push({ wordIdx: s.wordIdx, kind: "split", anchor: s });
    }
    // Sort by wordIdx; at same wordIdx, exit < split < enter so depth
    // updates settle correctly around shared boundaries.
    const orderKey = { "g-exit": 0, "split": 1, "g-enter": 2 };
    merged.sort((a, b) =>
      a.wordIdx !== b.wordIdx
        ? a.wordIdx - b.wordIdx
        : orderKey[a.kind] - orderKey[b.kind]);

    const topLevel = [];
    let depth = 0;
    for (const ev of merged) {
      if (ev.kind === "g-enter") depth++;
      else if (ev.kind === "g-exit") depth--;
      else if (ev.kind === "split" && depth === 0) topLevel.push(ev.anchor);
    }
    return topLevel;
  }

  // ── Public entry ──────────────────────────────────────────────────

  // ── Phase-1 math-tree walker (the C path) ──────────────────────────
  //
  // Owns BOTH the speech text AND the visual mapping. A single walk over
  // the tokenize tree emits:
  //   • spokenText  — read-aloud text (same shape as MathLive's output
  //                   so the existing improveSpokenProsody pipeline can
  //                   still apply if we want; we use the same anchor
  //                   words like "the fraction", "End fraction", etc.)
  //   • wrappedLatex — LaTeX with \htmlClass{eq-grp grp-N}{…} and
  //                    \htmlClass{eq-atom atom-N}{…} around each group
  //                    and each terminal atom respectively.
  //   • atomMap     — sorted list of { id, kind, start, end } char ranges
  //                   in the spoken text. At each onboundary event the
  //                   controller looks up the SMALLEST range containing
  //                   the char index → that's the atom to underline;
  //                   any larger ranges with kind=group containing the
  //                   index are the boxes that should be surrounded.
  //
  // The walker covers the same atom types as buildSpeechScript (frac,
  // sqrt, paren, sup, sub, ce-species, etc.) but generates the speech
  // text itself rather than relying on MathLive.

  // Greek-letter command → spoken form. Match the prosody pipeline's
  // expectations so existing rules (Greek-IPA, hyperbolic spellings)
  // continue to apply.
  const GREEK_NAMES = {
    "\\alpha": "alpha", "\\beta": "beta", "\\gamma": "gamma", "\\delta": "delta",
    "\\epsilon": "epsilon", "\\zeta": "zeta", "\\eta": "eta", "\\theta": "theta",
    "\\iota": "iota", "\\kappa": "kappa", "\\lambda": "lambda", "\\mu": "mu",
    "\\nu": "nu", "\\xi": "xi", "\\omicron": "omicron", "\\pi": "pi",
    "\\rho": "rho", "\\sigma": "sigma", "\\tau": "tau", "\\upsilon": "upsilon",
    "\\phi": "phi", "\\chi": "chi", "\\psi": "psi", "\\omega": "omega",
    "\\Gamma": "Gamma", "\\Delta": "Delta", "\\Theta": "Theta", "\\Lambda": "Lambda",
    "\\Xi": "Xi", "\\Pi": "Pi", "\\Sigma": "Sigma", "\\Upsilon": "Upsilon",
    "\\Phi": "Phi", "\\Psi": "Psi", "\\Omega": "Omega",
    // Greek var-forms — emit base names directly so the prosody
    // pipeline doesn't substitute later (which would shift atomMap
    // positions). "\\varepsilon" → "epsilon", not "varepsilon".
    "\\varepsilon": "epsilon", "\\varphi": "phi", "\\vartheta": "theta",
    "\\varsigma": "sigma", "\\varkappa": "kappa", "\\varrho": "rho",
    "\\varpi": "pi",
  };

  // Single-symbol commands and their spoken forms. Anything not in
  // GREEK_NAMES or this map falls back to the bare command name (with
  // backslash stripped) which is often the right thing.
  const COMMAND_SPEECH = {
    "\\sin": "sine", "\\cos": "cosine", "\\tan": "tan",
    "\\sec": "sec", "\\csc": "csc", "\\cot": "cot",
    "\\arcsin": "arcsin", "\\arccos": "arccos", "\\arctan": "arctan",
    // Hyperbolic — emit the post-respelled forms directly so the
    // remap-after-prosody step can align raw and final words. Otherwise
    // _respellHyperbolic in app.js rewrites "sinh"→"shine" and the
    // word-equality alignment can't pair "sinh" with "shine", dropping
    // the atom from the final atomMap.
    "\\sinh": "shine", "\\cosh": "kosh", "\\tanh": "tanch",
    "\\log": "log", "\\ln": "ln", "\\exp": "exp",
    "\\infty": "infinity",
    "\\to": "to", "\\mapsto": "maps to",
    "\\cdot": "times", "\\times": "times", "\\div": "divided by",
    "\\pm": "plus or minus", "\\mp": "minus or plus",
    "\\le": "less than or equal to", "\\leq": "less than or equal to",
    "\\ge": "greater than or equal to", "\\geq": "greater than or equal to",
    "\\ne": "is not equal to", "\\neq": "is not equal to",
    "\\equiv": "is congruent to", "\\approx": "is approximately equal to",
    "\\sim": "is similar to", "\\propto": "is proportional to",
    "\\perp": "is perpendicular to", "\\cong": "is congruent to",
    "\\implies": "implies", "\\iff": "if and only if",
    "\\partial": "partial",
    "\\bmod": "mod", "\\mod": "mod",
    "\\mid": "divides",
    // Multi-word readings — emit them at the walker so atomMap ranges
    // cover all of them (otherwise the prosody pipeline expands these
    // after-the-fact and the atom range no longer encloses the words).
    "\\otimes": "tensor product",
    "\\oplus": "direct sum",
    "\\odot": "circle dot",
    "\\supset": "superset",
    "\\supseteq": "is a superset of or equal to",
    "\\nsubseteq": "is not a subset of",
    "\\setminus": "set minus",
    "\\sqcap": "square intersection",
    "\\sqcup": "square union",
    "\\bowtie": "bowtie",
    "\\star": "star", "\\bullet": "bullet",
    "\\circ": "circle",
    "\\sphericalangle": "spherical angle",
    "\\measuredangle": "measured angle",
    "\\square": "square", "\\blacksquare": "filled square",
    "\\diamond": "diamond", "\\triangle": "triangle",
    // Greek var-forms — emit the base name directly so prosody doesn't
    // have to substitute and shift atomMap ranges.
    "\\varphi": "phi", "\\vartheta": "theta", "\\varepsilon": "epsilon",
    "\\varsigma": "sigma", "\\varkappa": "kappa", "\\varrho": "rho",
    "\\varpi": "pi",
    "\\nabla": "nabla", "\\Delta": "Delta",
    "\\hbar": "h-bar",
    "\\angle": "angle", "\\triangle": "triangle",
    "\\in": "is an element of", "\\notin": "is not an element of",
    "\\subset": "is a subset of", "\\subseteq": "is a subset of or equal to",
    "\\supset": "superset", "\\cup": "union", "\\cap": "intersection",
    "\\emptyset": "the empty set",
    // Quantifiers: the trailing colon gives a brief pause before the
    // bound variable / predicate. "For all: X, P open paren X close
    // paren" reads more clearly than "For all X, P open paren X close
    // paren" because the listener gets a beat to register the quantifier.
    "\\forall": "for all:", "\\exists": "there exists:",
    "\\nexists": "there does not exist:",
    "\\dots": "dot dot dot", "\\ldots": "dot dot dot", "\\cdots": "dot dot dot",
    "\\vdots": "vertical dots", "\\ddots": "diagonal dots",
    "\\prime": "prime",
    "\\Rightarrow": "implies", "\\Leftarrow": "is implied by",
    "\\Leftrightarrow": "if and only if",
    "\\Longrightarrow": "implies",
    "\\Longleftarrow": "is implied by",
    "\\Longleftrightarrow": "if and only if",
  };

  // Sum-style commands → spoken header. The header is whatever leads
  // before bound limits ("the summation from … to … of"). For limits and
  // products the structure is the same; only the head verb differs.
  const SUM_SPEECH = {
    "\\sum": "the summation",
    "\\prod": "the product",
    "\\coprod": "the coproduct",
    "\\int": "the integral",
    "\\oint": "the contour integral",
    "\\iint": "the double integral",
    "\\iiint": "the triple integral",
    "\\iiiint": "the quadruple integral",
    "\\oiint": "the closed surface integral",
    "\\oiiint": "the closed volume integral",
    "\\lim": "limit",
    "\\bigcup": "the union",
    "\\bigcap": "the intersection",
    "\\bigvee": "the maximum",
    "\\bigwedge": "the minimum",
    "\\bigoplus": "the direct sum",
    "\\bigotimes": "the tensor product",
  };

  // Blackboard-bold number-set names. \mathbb{X} where X is one of these
  // letters reads as the named set; any other letter reads as itself
  // (mathematicians use \mathbb{F}, \mathbb{K}, \mathbb{X} etc. as
  // generic field / sample-space names where the letter IS the name).
  const MATHBB_NAMES = {
    R: "the real numbers",
    Z: "the integers",
    C: "the complex numbers",
    N: "the natural numbers",
    Q: "the rational numbers",
    H: "the quaternions",
    P: "the prime numbers",
  };

  // Produce the spoken word for a leaf atom. Single-char Latin letters
  // get uppercased (MathLive convention — TTS pronounces letter names);
  // digits stay as-is; commands look up the table.
  function atomToSpeech(latexStr) {
    if (latexStr == null) return "";
    // Backslash command
    if (latexStr.startsWith("\\")) {
      if (GREEK_NAMES[latexStr]) return GREEK_NAMES[latexStr];
      if (COMMAND_SPEECH[latexStr]) return COMMAND_SPEECH[latexStr];

      // Blackboard-bold number-set symbols: \mathbb{R} → "the real
      // numbers", \mathbb{Z} → "the integers", etc. Unknown letters
      // (e.g. \mathbb{F} for a generic field, \mathbb{K} for a generic
      // field, \mathbb{X} for a sample space) speak as just the letter
      // — that's how a mathematician reads them aloud in context.
      // Multi-letter bodies (rare, e.g. \mathbb{RP} for real projective
      // space) read letter-by-letter.
      const mathbbMatch = latexStr.match(/^\\mathbb\{(.+)\}$/s);
      if (mathbbMatch) {
        const body = mathbbMatch[1].trim();
        const named = MATHBB_NAMES[body];
        if (named) return named;
        // Multi-letter: letter-space so TTS pronounces each letter name.
        if (body.length > 1) return [...body].join(" ");
        return body;
      }

      // Other font-modifier commands: \mathcal{L}, \mathfrak{g},
      // \mathscr{S}, \mathsf{A}, \boldsymbol{v}. The font is a visual
      // cue; the spoken form is the bare identifier. Multi-letter
      // bodies (e.g. \mathcal{LA} for some operator) letter-space.
      const fontMatch = latexStr.match(/^\\(?:mathcal|mathfrak|mathscr|mathsf|boldsymbol)\{(.+)\}$/s);
      if (fontMatch) {
        const body = fontMatch[1].trim();
        if (body.length > 1) return [...body].join(" ");
        return body;
      }

      // Opaque text-mode \text{…} — read the inner text. Apply the same
      // transformations the prosody pipeline would otherwise apply
      // AFTER the walker — so the walker's atomMap range covers the
      // final word count (otherwise the remap can't align).
      //  • `pH` / `pOH` / `pKa` → "p H" / "p O H" / "p K a" letter-spaced
      //  • `m/s` / `J/K` / `mol/L` / etc — slash → " over "
      //  • Single uppercase letter standalone reads naturally
      const textMatch = latexStr.match(/^\\text\{(.*)\}$/s);
      const mathrmMatch = latexStr.match(/^\\(?:mathrm|mathbf|mathit|operatorname)\{(.*)\}$/s);
      const inner = (textMatch || mathrmMatch);
      if (inner) {
        // Trim leading/trailing whitespace — emitAtom already inserts a
        // space before this atom when needed; double spaces in raw
        // ctx.text trigger the `replace(/\s+/g, " ")` collapse which
        // invalidates atomMap range positions recorded earlier.
        let t = inner[1].trim();
        // p<UPPER> abbreviations (pH, pOH, pKa, pKb, pKw): split letters.
        t = t.replace(/\bp([A-Z][a-zA-Z]*)\b/g, (m, tail) => "p " + [...tail].join(" "));
        // Slash → over (so `m/s` reads as "m over s").
        t = t.replace(/\s*\/\s*/g, " over ");
        // Literal parens in unit text (e.g. `\text{J/(mol}\cdot\text{K)}`
        // → "J over (mol times K)") read out the paren names.
        t = t.replace(/\(/g, "open paren ").replace(/\)/g, " close paren");
        return t;
      }
      // \! / \, / \; / \: / \> — thin/medium/thick spaces: silent.
      if (/^\\[!,;:>]$/.test(latexStr)) return "";
      // \quad, \qquad — explicit spacing commands, silent.
      if (latexStr === "\\quad" || latexStr === "\\qquad") return "";
      // \\ — line break, silent (alignments handled separately).
      if (latexStr === "\\\\") return "";
      // \{ \} — literal braces, read as "open brace" / "close brace".
      if (latexStr === "\\{") return "open brace";
      if (latexStr === "\\}") return "close brace";
      // \% — percent sign.
      if (latexStr === "\\%") return "percent";
      // \$ — dollar sign.
      if (latexStr === "\\$") return "dollar";
      // \# — hash.
      if (latexStr === "\\#") return "hash";
      // \_ — literal underscore (no speech).
      if (latexStr === "\\_") return "";
      // Fallback: strip backslash. Useful for unknown but readable
      // commands (\Re → "Re", \Im → "Im").
      return latexStr.slice(1);
    }
    // Single Latin letter — uppercase for letter-name pronunciation
    if (/^[a-z]$/.test(latexStr)) return latexStr.toUpperCase();
    if (/^[A-Z]$/.test(latexStr)) return latexStr;
    // Comma — emit "comma" so lists and tuples read clearly. MathLive does
    // the same for `(x, y, z)` → "Open paren, X, comma, Y, comma, Z, close
    // paren". The prosody pipeline's _cleanupPunctuation would otherwise
    // strip raw "," characters that aren't between identifiers.
    if (latexStr === ",") return "comma";
    // Inequality operators — `<` and `>` are bare ASCII chars that read
    // as themselves unless we substitute.
    if (latexStr === "<") return "less than";
    if (latexStr === ">") return "greater than";
    // Bare arithmetic operators reaching atomToSpeech happen when the
    // tokenizer creates an atom (e.g. inside a sup/sub: `^+`, `_-`,
    // `^{2+}`). The walker's op-node branch handles top-level operators;
    // these atom-style entries need the same word mapping.
    if (latexStr === "+") return "plus";
    if (latexStr === "-") return "minus";
    if (latexStr === "=") return "equals";
    // `*` as a standalone atom — convolution / multiplication. Reads
    // as "times" inline (e.g. `f * g` → "F times G"). When `*` appears
    // as a SUPERSCRIPT (`\psi^*`) the walker's SUP_WORDS map handles
    // it specially and emits "conjugate" instead.
    if (latexStr === "*") return "times";
    // Bare apostrophe `'` in LaTeX renders as a prime (`f'`, `x'`).
    if (latexStr === "'") return "prime";
    // Bare "|" — by default reads as "given" (conditional probability
    // and set-builder context). When the tokenizer detects a matched
    // pair acting as absolute-value brackets it emits a paren kind="|"
    // node instead, which the walker handles separately, so this
    // fallthrough only fires for the conditional/separator case.
    if (latexStr === "|") return "given";
    // Factorial.
    if (latexStr === "!") return "factorial";
    // Align-column markers and TeX-internal punctuation should be silent.
    if (latexStr === "&") return "";
    // Digits / multi-char / punctuation
    return latexStr;
  }

  // The walker context — accumulators for text and the wrapped LaTeX,
  // a running atomMap, and counters for assigning fresh ids during walk.
  // The nextGroupId counter is SEEDED with the tokenize counter so any
  // new groups the walker creates (e.g. sum-with-bounds wrapper) don't
  // collide with the existing tokenizer-assigned ids on paren/frac/sqrt
  // nodes. nextAtomId can start at 1 because the tokenizer doesn't
  // assign atom ids — the walker is the sole source of those.
  function makeWalkCtx(initialGroupId) {
    return {
      text: "",
      latex: "",
      atomMap: [],
      nextAtomId: 1,
      nextGroupId: initialGroupId || 1,
    };
  }

  // Append a string to both the accumulated speech text and the visible
  // LaTeX, recording the atom-map entry for it. `latex` defaults to the
  // wrappedLatex segment being added — pass an explicit value when the
  // KaTeX-side string differs (e.g. for sum headers we want \sum_{a}^{b}
  // in LaTeX but "the summation from A to B" in speech).
  function emitAtom(ctx, spoken, latex, id) {
    const start = ctx.text.length;
    // Always add a leading space if the previous text didn't end with one,
    // unless the new text is empty or starts with a punctuation that
    // shouldn't be space-separated.
    if (spoken && ctx.text.length > 0 && !/\s$/.test(ctx.text) && !/^[.,;]/.test(spoken)) {
      ctx.text += " ";
    }
    ctx.text += spoken;
    const end = ctx.text.length;
    ctx.latex += latex;
    if (id) {
      ctx.atomMap.push({ id, kind: "atom", start, end });
    }
    return { start, end };
  }

  // Start tracking a group: stamps the start position now, returns a
  // closer that, when called, records the final range. The wrappedLatex
  // string is provided in two pieces (open + close) so the walk can emit
  // child content between them.
  function startGroup(ctx, id) {
    const start = ctx.text.length;
    return function close() {
      const end = ctx.text.length;
      ctx.atomMap.push({ id, kind: "group", start, end });
    };
  }

  function walkNode(node, ctx) {
    if (node.type === "atom") {
      const speech = node.speech != null ? node.speech : atomToSpeech(node.latex);
      // KaTeX's `align`/`aligned`/`array`/matrix environments use `&` and
      // `\\` as cell/row separators. Both MUST stay at the top level — if
      // we wrap them in `\htmlClass{eq-atom ...}{&}` KaTeX rejects the
      // input with "Expected 'EOF', got '&'" because the parser only
      // accepts a column break at the syntactic top level of an env body.
      // Same goes for `\\` inside a wrapped span. Emit these as raw LaTeX
      // with no class wrapping and no atomMap entry (they're inaudible).
      if (node.latex === "&" || node.latex === "\\\\") {
        ctx.latex += node.latex;
        return;
      }
      const id = `atom-${ctx.nextAtomId++}`;
      // Opaque atoms (matrix envs, \text{…}, \mathrm{…}) carry an
      // optional `speech` field set at tokenize time. Use it when
      // present; otherwise fall back to atomToSpeech which is right
      // for normal commands / letters / digits.
      const latexOut = `\\htmlClass{eq-atom ${id}}{${node.latex}}`;
      emitAtom(ctx, speech, latexOut, id);
      return;
    }
    if (node.type === "op") {
      const id = `atom-${ctx.nextAtomId++}`;
      const speech =
        node.op === "+" ? "plus" :
        node.op === "-" ? "minus" :
        node.op === "=" ? "equals" :
        node.op;
      emitAtom(ctx, speech, `\\htmlClass{eq-atom ${id}}{${node.op}}`, id);
      return;
    }
    if (node.type === "space") { ctx.latex += node.char; return; }
    if (node.type === "brace") {
      ctx.latex += "{";
      walkNodes(node.content, ctx);
      ctx.latex += "}";
      return;
    }
    if (node.type === "frac") {
      const id = node.id || `grp-${ctx.nextGroupId++}`;
      const close = startGroup(ctx, id);
      // Colon (~150ms TTS pause) after "the fraction" and before "end
      // fraction" — matches MathLive's own design which uses
      // <break time="150ms"/> at the same points. Keeps fraction flow
      // integrated when nested inside larger expressions (the prior
      // period at "End fraction" caused the listener to think the whole
      // formula had ended).
      ctx.text += (ctx.text && !/\s$/.test(ctx.text) ? " " : "") + "the fraction:";
      const cmd = node.kind || "\\frac";
      ctx.latex += `\\htmlClass{eq-grp ${id}}{${cmd}{`;
      walkNodes(node.num, ctx);
      ctx.latex += "}{";
      ctx.text += " over";
      walkNodes(node.den, ctx);
      ctx.latex += "}}";
      ctx.text += ": end fraction.";
      close();
      return;
    }
    if (node.type === "sqrt") {
      const id = node.id || `grp-${ctx.nextGroupId++}`;
      const close = startGroup(ctx, id);
      const isIndexed = !!(node.index && node.index.length);
      if (isIndexed) {
        ctx.text += (ctx.text && !/\s$/.test(ctx.text) ? " " : "") + "the root with index";
        ctx.latex += `\\htmlClass{eq-grp ${id}}{\\sqrt[`;
        walkNodes(node.index, ctx);
        ctx.latex += "]{";
        ctx.text += " of:";
      } else {
        ctx.text += (ctx.text && !/\s$/.test(ctx.text) ? " " : "") + "the square root of:";
        ctx.latex += `\\htmlClass{eq-grp ${id}}{\\sqrt{`;
      }
      walkNodes(node.rad, ctx);
      ctx.latex += "}}";
      ctx.text += isIndexed ? ": end root." : ": end square root.";
      close();
      return;
    }
    if (node.type === "paren") {
      const id = node.id || `grp-${ctx.nextGroupId++}`;
      const close = startGroup(ctx, id);
      const openWord =
        node.kind === "[" ? "open bracket" :
        node.kind === "|" ? "the absolute value of" :
        node.kind === "||" ? "the norm of" :
        node.kind === "<>" ? "the expectation of" :
                            "open paren";
      // Closing words for `|...|`, `\|...\|`, `\langle...\rangle` —
      // without them, expressions like `|x|^2` ("absolute value of X
      // squared") are AMBIGUOUS (`|x²|` vs `(|x|)²`). Mirroring the
      // open phrase with an explicit close phrase removes the
      // ambiguity ("absolute value of X, end absolute value, squared").
      const closeWord =
        node.kind === "[" ? "close bracket" :
        node.kind === "|" ? "end absolute value" :
        node.kind === "||" ? "end norm" :
        node.kind === "<>" ? "end expectation" :
                            "close paren";
      // KaTeX needs the matching pair; norm uses `\|`, expectation uses
      // `\langle\rangle`. When `bare` is true, emit raw delimiters
      // without `\left/\right` so the rendered output exactly matches
      // the source (e.g. `(a-b)` stays as static-size parens, not the
      // adaptive `\left(...\right)` that KaTeX would otherwise size to
      // its content).
      const useBare = node.bare === true;
      const lDelim = node.kind === "[" ? "[" :
                     node.kind === "|" ? "|" :
                     node.kind === "||" ? "\\|" :
                     node.kind === "<>" ? "\\langle " :
                                         "(";
      const rDelim = node.kind === "[" ? "]" :
                     node.kind === "|" ? "|" :
                     node.kind === "||" ? "\\|" :
                     node.kind === "<>" ? " \\rangle" :
                                         ")";
      ctx.text += (ctx.text && !/\s$/.test(ctx.text) ? " " : "") + openWord;
      const openDelim = useBare ? lDelim : `\\left${lDelim}`;
      const closeDelim = useBare ? rDelim : `\\right${rDelim}`;
      ctx.latex += `\\htmlClass{eq-grp ${id}}{${openDelim}`;
      walkNodes(node.content, ctx);
      ctx.latex += `${closeDelim}}`;
      if (closeWord) ctx.text += " " + closeWord;
      close();
      return;
    }
    if (node.type === "sup") {
      const id = node.id || `grp-${ctx.nextGroupId++}`;
      const close = startGroup(ctx, id);
      // Power-of-2/3 use the natural English forms ("squared", "cubed");
      // single-symbol marker superscripts (* prime dagger T) read as
      // their accent name directly ("X conjugate", "f prime", etc.). The
      // inner LaTeX is emitted raw so we don't pollute the atomMap with
      // phantom entries pointing into text that's never spoken. For
      // multi-token exponents we fall through to "raised to the …" and
      // walk normally so each inner atom gets its own underline target.
      //
      // `innerVisible` strips silent spacing atoms (\!, \,, \;) so we
      // detect "squared"/"cubed" for `^{\!2}` correctly; `innerRaw`
      // preserves everything so the KaTeX render gets the exact source.
      const innerVisible = renderInline(node.content);
      const innerRaw = renderInlineRaw(node.content);
      const innerText = innerVisible.trim();
      const SUP_WORDS = {
        "2": "squared",
        "3": "cubed",
        "*": "conjugate",
        "\\ast": "conjugate",
        "\\prime": "prime",
        "'": "prime",
        "\\dagger": "dagger",
        "\\dag": "dagger",
        "T": "transpose",
        "\\top": "transpose",
        "-1": "inverse",
        // E^\circ → "E naught" (standard-state notation). Also handles
        // the `°` notation seen as `^\circ`.
        "\\circ": "naught",
      };
      const supWord = SUP_WORDS[innerText];
      ctx.latex += `^{\\htmlClass{eq-grp ${id}}{`;
      let wasCompound = false;
      if (supWord) {
        ctx.text += " " + supWord;
        // Emit the RAW inner LaTeX (incl. silent spacing) so KaTeX
        // renders the exponent EXACTLY as the source had it.
        ctx.latex += innerRaw;
      } else {
        ctx.text += " raised to the";
        walkNodes(node.content, ctx);
        wasCompound = true;
      }
      ctx.latex += "}}";
      close();
      // After a compound exponent (`x^{n-k}` reading "X raised to the
      // N minus K"), append a comma to disambiguate from the next
      // factor — without it, "raised to the N Y" could be misheard as
      // `x^{NY}` rather than `x^N * y`. The comma will be elided by
      // _cleanupPunctuation if the next emission already starts with
      // punctuation (e.g. a period from a following relational op).
      if (wasCompound) ctx.text += ",";
      return;
    }
    if (node.type === "sub") {
      const id = node.id || `grp-${ctx.nextGroupId++}`;
      const close = startGroup(ctx, id);
      ctx.text += " sub";
      ctx.latex += `_{\\htmlClass{eq-grp ${id}}{`;
      walkNodes(node.content, ctx);
      ctx.latex += "}}";
      close();
      return;
    }
    // Single-brace-arg commands like \pmod{p}, \mathring{r}. The walker
    // emits the spoken word for the command followed by the arg content;
    // the LaTeX side keeps the original command with its brace argument
    // so KaTeX renders correctly.
    if (node.type === "modcmd") {
      const id = node.id || `grp-${ctx.nextGroupId++}`;
      const close = startGroup(ctx, id);
      ctx.text += (ctx.text && !/\s$/.test(ctx.text) ? " " : "") + node.speech;
      ctx.latex += `\\htmlClass{eq-grp ${id}}{${node.cmd}{`;
      walkNodes(node.content, ctx);
      ctx.latex += "}}";
      close();
      return;
    }
    // n-ary commands captured by the tokenizer (\binom{n}{k},
    // \overset{*}{=}, etc.) — emit the command + braces VERBATIM in
    // the wrapped LaTeX so KaTeX parses it correctly, and speak both
    // arguments separated by the appropriate connective.
    if (node.type === "nary") {
      const id = node.id || `grp-${ctx.nextGroupId++}`;
      const close = startGroup(ctx, id);
      // Speech connective per command kind. Binomial reads as "N choose
      // K"; the over/under variants read as "X over Y" / "X under Y";
      // \stackrel as "X on top of Y".
      let leadWord = "", joinWord = " ";
      if (node.cmd === "\\binom" || node.cmd === "\\dbinom" || node.cmd === "\\tbinom") {
        joinWord = " choose ";
      } else if (node.cmd === "\\overset") {
        leadWord = "the symbol";
        joinWord = " on top of ";
      } else if (node.cmd === "\\underset") {
        leadWord = "the symbol";
        joinWord = " under ";
      } else if (node.cmd === "\\stackrel") {
        joinWord = " on top of ";
      }
      // LaTeX side: open the wrapper and the cmd's brace structure.
      ctx.latex += `\\htmlClass{eq-grp ${id}}{${node.cmd}{`;
      // For binom, the conventional spoken order is "n choose k" — n
      // first then k. For overset, the SYMBOL on top is arg1 and the
      // base is arg2. We say "the symbol arg1 on top of arg2" to keep
      // the visual reading order intact.
      if (leadWord) ctx.text += (ctx.text && !/\s$/.test(ctx.text) ? " " : "") + leadWord;
      walkNodes(node.arg1, ctx);
      ctx.latex += "}{";
      ctx.text += joinWord;
      walkNodes(node.arg2, ctx);
      ctx.latex += "}}";
      close();
      return;
    }
    // Accent commands: \vec{X}, \hat{X}, \bar{X}, \dot{X}, \tilde{X}.
    // Speech: inner content + space + accent word. We do NOT prefix
    // the accent word with a colon — that read awkwardly for adjacent
    // letters (e.g. `z\bar{z}` rendered as "Z Z: bar" which sounds like
    // three separate items rather than "Z, Z-bar"). A plain space lets
    // TTS flow naturally: "Z Z bar", "E vector", "I hat".
    if (node.type === "accent") {
      const id = node.id || `grp-${ctx.nextGroupId++}`;
      const close = startGroup(ctx, id);
      ctx.latex += `\\htmlClass{eq-grp ${id}}{${node.cmd}{`;
      walkNodes(node.content, ctx);
      ctx.latex += "}}";
      ctx.text += " " + node.word;
      close();
      return;
    }
    // Multi-line equation environment. Each line is read as its own
    // utterance unit, separated by a period so the listener hears them
    // distinctly. The KaTeX-side LaTeX is re-emitted in
    // `\begin{envName} … \\ … \end{envName}` form so the renderer treats
    // it correctly as block-level math.
    if (node.type === "align-env") {
      const lineLatexes = [];
      for (let i = 0; i < node.lines.length; i++) {
        const line = node.lines[i];
        if (i > 0) ctx.text += ". ";
        // Walk the line's operand items just like top-level items.
        const before = ctx.latex;
        ctx.latex = "";
        for (const item of line.items) {
          if (item && item.type === "operand") walkNodes(item.content, ctx);
          else walkNode(item, ctx);
        }
        lineLatexes.push(ctx.latex);
        ctx.latex = before;
      }
      ctx.latex += `\\begin{${node.envName}}${lineLatexes.join(" \\\\ ")}\\end{${node.envName}}`;
      return;
    }
    // Chemistry passes through to existing path (Phase 5 will refine).
    if (node.type === "ce-species") {
      const id = `atom-${ctx.nextAtomId++}`;
      // For walker phase 1, simply emit element letters split by space
      // (matching spokenForChemistry approach). The wrappedLatex keeps
      // the \ce{} call so KaTeX/mhchem still renders correctly.
      const spoken = node.text.split("").join(" ").replace(/(\d) /g, "$1 ").trim();
      emitAtom(ctx, spoken, `\\htmlClass{eq-atom ${id}}{\\ce{${node.text}}}`, id);
      return;
    }
    if (node.type === "ce-arrow") {
      const id = `atom-${ctx.nextAtomId++}`;
      const speech = node.op === "->" ? "yields" :
                     (node.op === "<=>" || node.op === "<->") ? "in equilibrium with" :
                     node.op;
      emitAtom(ctx, speech, node.latex, id);
      return;
    }
  }

  // Function-like commands that read as named functions. When followed
  // immediately by a parenthesised argument, the walker inserts a colon
  // between the function name and the opening paren so the listener
  // hears "sine: open paren X close paren" rather than "sine open paren
  // X close paren" (which can sound like one mushed word).
  const FUNCTION_LIKE_COMMANDS = new Set([
    "\\sin", "\\cos", "\\tan", "\\sec", "\\csc", "\\cot",
    "\\arcsin", "\\arccos", "\\arctan",
    "\\sinh", "\\cosh", "\\tanh",
    "\\log", "\\ln", "\\exp",
    "\\det", "\\dim", "\\ker", "\\deg",
    "\\min", "\\max", "\\gcd", "\\lcm",
    "\\Pr", "\\Re", "\\Im",
  ]);

  // Walk a node list. Most nodes pass straight through to walkNode, but
  // sum-style commands (\sum, \int, \prod, \lim, \bigcup, …) consume any
  // immediately-following sub/sup limits and emit them as a natural
  // bound phrase ("the summation from I equals 1 to N of …"). Limits
  // for \lim read as "as X approaches A" instead. Bounds are also folded
  // into the same htmlClass group so the visual highlight covers the
  // entire sum-with-limits unit while it's being read.
  //
  // Also handles the function-name + paren-arg case: when a function-like
  // atom (\sin, \log, etc.) is followed by a paren, a colon is appended
  // to the function's spoken form so TTS pauses briefly before reading
  // the argument ("sine: open paren X close paren").
  //
  // PRE-PASS: rewrite `\dots` based on its surrounding context. KaTeX's
  // smart-context detection breaks when the adjacent atoms are wrapped
  // in `\htmlClass`. We do the same heuristic ourselves: if both sides
  // are operators (+, -, =, \cdot, etc.) → `\cdots` (centre dots);
  // if both sides are commas → `\ldots` (lower dots); otherwise leave
  // as `\dots`.
  function walkNodes(nodes, ctx) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n && n.type === "atom" && (n.latex === "\\dots" || n.latex === "\\ldots")) {
        // Find previous and next non-space atoms.
        function nearby(start, dir) {
          let k = start;
          while (k >= 0 && k < nodes.length) {
            const t = nodes[k];
            if (t && t.type !== "space") return t;
            k += dir;
          }
          return null;
        }
        const prev = nearby(i - 1, -1);
        const next = nearby(i + 1, 1);
        const isOp = (t) => t && (
          (t.type === "op" && /[+\-]/.test(t.op)) ||
          (t.type === "atom" && (t.latex === "\\cdot" || t.latex === "\\times" || t.latex === "\\pm" || t.latex === "\\mp"))
        );
        const isComma = (t) => t && t.type === "atom" && t.latex === ",";
        if (isOp(prev) && isOp(next)) {
          n.latex = "\\cdots";
        } else if (isComma(prev) || isComma(next)) {
          n.latex = "\\ldots";
        }
        // else: leave as-is.
      }
      // Function name immediately followed by a paren-arg → colon.
      // Skip silent spacing atoms (\!, \,, \;, \quad) between the
      // function name and the paren — they're invisible to the listener
      // but a naive "next sibling" check would miss the paren.
      if (n && n.type === "atom" && FUNCTION_LIKE_COMMANDS.has(n.latex)) {
        let k = i + 1;
        while (k < nodes.length) {
          const t = nodes[k];
          if (t.type === "space") { k++; continue; }
          if (t.type === "atom" && atomToSpeech(t.latex) === "") { k++; continue; }
          break;
        }
        if (k < nodes.length && nodes[k].type === "paren") {
          const id = `atom-${ctx.nextAtomId++}`;
          const speech = (COMMAND_SPEECH[n.latex] || n.latex.slice(1)) + ":";
          const latexOut = `\\htmlClass{eq-atom ${id}}{${n.latex}}`;
          emitAtom(ctx, speech, latexOut, id);
          continue;
        }
      }
      if (n && n.type === "atom" && SUM_TYPE_COMMANDS.has(n.latex)) {
        // Peek at next 1–2 tokens for sub and/or sup limits.
        let subNode = null, supNode = null;
        let consumed = 0;
        for (let k = i + 1; k < nodes.length && consumed < 2; k++) {
          const t = nodes[k];
          if (!t) break;
          if (t.type === "space") { consumed++; continue; }
          if (t.type === "sub" && !subNode) { subNode = t; consumed++; continue; }
          if (t.type === "sup" && !supNode) { supNode = t; consumed++; continue; }
          break;
        }
        // Where to stop the lookahead — last consumed token's index.
        let stopAt = i;
        let count = 0;
        for (let k = i + 1; k < nodes.length && count < consumed; k++) {
          if (nodes[k].type === "space") { count++; stopAt = k; continue; }
          if ((nodes[k].type === "sub" || nodes[k].type === "sup")) { count++; stopAt = k; continue; }
          break;
        }
        emitSumWithBounds(n, subNode, supNode, ctx);
        i = stopAt;
        continue;
      }
      walkNode(n, ctx);
    }
  }

  // Emit a sum/integral/product/limit with optional sub/sup limits as a
  // natural bound phrase. The whole construct is wrapped in a single
  // grp-N class so the visual highlight tracks the symbol + its bounds
  // as one unit.
  function emitSumWithBounds(sumAtom, subNode, supNode, ctx) {
    const id = `grp-${ctx.nextGroupId++}`;
    const close = startGroup(ctx, id);
    const header = SUM_SPEECH[sumAtom.latex] || sumAtom.latex.slice(1);
    const isLim  = sumAtom.latex === "\\lim";
    // Speech: header (e.g. "the summation"), then bounds, then "of …" is
    // implicit — the next operand reads as the body.
    ctx.text += (ctx.text && !/\s$/.test(ctx.text) ? " " : "") + header;
    // LaTeX side: wrap the symbol + its sub/sup in the group span.
    ctx.latex += `\\htmlClass{eq-grp ${id}}{${sumAtom.latex}`;
    if (subNode) {
      ctx.latex += `_{\\htmlClass{eq-grp ${subNode.id}}{`;
      if (isLim) {
        // \lim_{x \to a}: walk the bound content normally for atomMap
        // accuracy, but rewrite any `\to` atom on-the-fly so the speech
        // reads "approaches" rather than "to". We walk a SHALLOW COPY of
        // the content where matching atoms have `.speech` overridden.
        ctx.text += " as";
        const rewritten = subNode.content.map(n => {
          if (n.type === "atom" && (n.latex === "\\to" || n.latex === "\\rightarrow")) {
            return { ...n, speech: "approaches" };
          }
          return n;
        });
        walkNodes(rewritten, ctx);
      } else {
        // \sum_{i=1}: read as "from I equals 1"
        ctx.text += " from";
        walkNodes(subNode.content, ctx);
      }
      ctx.latex += "}}";
    }
    if (supNode) {
      ctx.latex += `^{\\htmlClass{eq-grp ${supNode.id}}{`;
      ctx.text += " to";
      walkNodes(supNode.content, ctx);
      ctx.latex += "}}";
    }
    ctx.latex += "}";
    // Trailing ": of" if we had bounds — colon BEFORE "of" separates
    // the bounds clause from the "of body" unit. The prosody pipeline's
    // _insertBoundsPauses will also normalise MathLive output to the
    // same shape ("to N of body" → "to N: of body") so the listener
    // hears the same beat regardless of which path generated the speech.
    if (subNode || supNode) ctx.text += ": of";
    close();
  }

  // Quick speech rendering of a raw LaTeX inline (for sub-of-lim where we
  // already have the inline LaTeX string). Just runs each atom through
  // atomToSpeech with a space between.
  function speechFromInline(latex) {
    if (!latex) return "";
    const inner = tokenize(latex, { nextGroupId: 0, nextOperandId: 0 });
    let out = "";
    for (const t of inner) {
      if (t.type === "atom") out += " " + atomToSpeech(t.latex);
      else if (t.type === "op") out += " " + (t.op === "+" ? "plus" : t.op === "-" ? "minus" : t.op === "=" ? "equals" : t.op);
      else if (t.type === "space") continue;
    }
    return out.trim();
  }

  // Inline-render the LaTeX for a node list without recording into atom
  // map — used to peek at sup/sub content for the "squared"/"cubed"
  // detection above. Silent spacing atoms (\!, \,, \;) are skipped so
  // an exponent like `^{\!2}` still detects as "2" → "squared".
  function renderInline(nodes) {
    let s = "";
    function r(n) {
      if (n.type === "atom") {
        if (/^\\[!,;:>]$/.test(n.latex)) return; // silent space
        s += n.latex;
      }
      else if (n.type === "op") s += n.op;
      else if (n.type === "space") s += n.char;
      else if (n.type === "brace") { s += "{"; n.content.forEach(r); s += "}"; }
    }
    nodes.forEach(r);
    return s;
  }

  // Like renderInline but PRESERVES silent spacing atoms so the LaTeX
  // emission to KaTeX matches the original source exactly.
  function renderInlineRaw(nodes) {
    let s = "";
    function r(n) {
      if (n.type === "atom") s += n.latex;
      else if (n.type === "op") s += n.op;
      else if (n.type === "space") s += n.char;
      else if (n.type === "brace") { s += "{"; n.content.forEach(r); s += "}"; }
    }
    nodes.forEach(r);
    return s;
  }

  // Public entry — the new C-style speech generator.
  //
  // Pipeline:
  //   1. Tokenise the LaTeX into a structured tree.
  //   2. Walk it, emitting (a) raw spoken text, (b) wrapped LaTeX (with
  //      \htmlClass{eq-grp} / {eq-atom} around groups and atoms), and
  //      (c) a char-offset atomMap pointing into the raw text.
  //   3. Apply the existing improveSpokenProsody pipeline (sentence case,
  //      relational/structural pauses, hyperbolic respelling, etc.) to
  //      the raw text — it inserts periods/commas BETWEEN words but
  //      preserves the words themselves. The atomMap word boundaries
  //      survive; we recompute char offsets against the prosody output by
  //      walking word-by-word and matching against original word offsets.
  //
  // If improveSpokenProsody isn't yet on window (extremely early call), we
  // return the raw text — it'll be re-attempted on the next call.
  //
  // Chemistry (\ce{...}) is currently delegated to the existing
  // buildSpeechFor pipeline (which has rich chemistry-specific
  // pronunciation) — Phase 5 will rewrite chemistry inside the walker.
  // When delegating, we return an empty atomMap so the caller falls back
  // to the script-based highlight path.
  window.generateMathSpeech = function generateMathSpeech(latex) {
    if (typeof latex !== "string" || !latex) {
      return { spokenText: "", wrappedLatex: "", atomMap: [] };
    }
    // Chemistry: fall back to existing pipeline for now.
    if (/\\ce\{/.test(latex) && typeof window.buildSpeechFor === "function") {
      const text = window.buildSpeechFor(latex);
      let wrapped = "";
      let script = [];
      if (typeof window.buildSpeechScript === "function") {
        const r = window.buildSpeechScript(latex, text);
        wrapped = r.wrappedLatex;
        script = r.script;
      }
      return { spokenText: text, wrappedLatex: wrapped, atomMap: [], script };
    }
    try {
      const ctx0 = { nextGroupId: 1, nextOperandId: 1 };
      const tokens = tokenize(latex, ctx0);
      const items = buildOperands(tokens, ctx0);
      // Flatten operand-level items back into a token list for the walker.
      // The walker treats operand nodes as transparent (it walks their
      // content) because operand classification is for the heuristic
      // pipeline, not the C-path mapping.
      const flatForWalk = [];
      for (const item of items) {
        if (item.type === "operand") flatForWalk.push(...item.content);
        else flatForWalk.push(item);
      }
      // Seed walker's nextGroupId with the tokenize counter so any new
      // group ids the walker creates (e.g. sum-with-bounds wrapper)
      // continue the same sequence — no collisions with tokenizer
      // ids on paren/frac/sqrt nodes.
      const ctx = makeWalkCtx(ctx0.nextGroupId);
      walkNodes(flatForWalk, ctx);
      const rawText = ctx.text.replace(/\s+/g, " ").trim();
      // Apply the prosody pipeline. It mostly inserts punctuation between
      // existing words — we re-derive the atomMap by mapping words.
      const prosody = typeof window.improveSpokenProsody === "function"
        ? window.improveSpokenProsody
        : null;
      let finalText = rawText;
      let finalAtomMap = ctx.atomMap;
      if (prosody) {
        finalText = prosody(rawText) || rawText;
        finalAtomMap = remapAtomMapAfterProsody(rawText, finalText, ctx.atomMap);
      }
      return {
        spokenText:   finalText,
        wrappedLatex: ctx.latex,
        atomMap:      finalAtomMap,
      };
    } catch (err) {
      console.warn("[generateMathSpeech] failed:", err);
      return { spokenText: "", wrappedLatex: latex, atomMap: [] };
    }
  };

  // Re-derive char offsets for the atomMap after prosody insertion.
  //
  // Prosody mostly inserts punctuation between existing words, but it can
  // also DROP a word (e.g. _respellMathliveQuirks: "comma" → ","), so a
  // naive raw[i]==fin[j] alignment that only advances fin would never
  // recover after a dropped word. We use a bidirectional walk: at each
  // step, if both pointers' words match, pair them and advance both;
  // otherwise advance whichever side has fewer remaining matches with
  // the other side's current word, then retry.
  //
  // For each atomMap entry, find its raw word-index range, then map to
  // the equivalent final word-index range via rawToFin. Entries whose
  // raw words all got dropped are excluded from the result map (the
  // speech controller falls back to its previous highlight state).
  function remapAtomMapAfterProsody(rawText, finalText, atomMap) {
    if (!atomMap || !atomMap.length) return atomMap;
    function wordsWithPos(text) {
      const out = [];
      const re = /\S+/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        out.push({ word: m[0].toLowerCase().replace(/[.,;:!?]+$/, ""), start: m.index, end: m.index + m[0].length });
      }
      return out;
    }
    const rawWords = wordsWithPos(rawText);
    const finWords = wordsWithPos(finalText);

    // Greedy bidirectional alignment. We walk both sequences. At each
    // step we look up to LOOKAHEAD words ahead in fin for raw[i] and up
    // to LOOKAHEAD words ahead in raw for fin[j]; whichever finds a
    // match first wins, and we advance both pointers past the matched
    // pair (skipped raw words are marked -1).
    const LOOKAHEAD = 4;
    const rawToFin = new Array(rawWords.length).fill(-1);
    let i = 0, j = 0;
    while (i < rawWords.length && j < finWords.length) {
      if (rawWords[i].word === finWords[j].word) {
        rawToFin[i] = j;
        i++; j++;
        continue;
      }
      // Look ahead in fin for raw[i].
      let dFin = -1;
      for (let k = 1; k < LOOKAHEAD && j + k < finWords.length; k++) {
        if (finWords[j + k].word === rawWords[i].word) { dFin = k; break; }
      }
      // Look ahead in raw for fin[j].
      let dRaw = -1;
      for (let k = 1; k < LOOKAHEAD && i + k < rawWords.length; k++) {
        if (rawWords[i + k].word === finWords[j].word) { dRaw = k; break; }
      }
      if (dFin < 0 && dRaw < 0) {
        // Neither side has the other's current word nearby — give up
        // on this position and skip a raw word to try the next.
        i++;
        continue;
      }
      if (dFin >= 0 && (dRaw < 0 || dFin <= dRaw)) {
        // Prosody inserted dFin extra fin words before raw[i] — skip them.
        j += dFin;
      } else {
        // Prosody dropped dRaw raw words — skip them (rawToFin stays -1).
        i += dRaw;
      }
    }

    function rawCharToWordIdx(charPos, side) {
      if (side === "start") {
        for (let i = 0; i < rawWords.length; i++) {
          if (rawWords[i].start >= charPos) return i;
          if (rawWords[i].end > charPos) return i;
        }
        return rawWords.length;
      }
      let last = -1;
      for (let i = 0; i < rawWords.length; i++) {
        if (rawWords[i].start < charPos) last = i;
        else break;
      }
      return last;
    }

    const result = [];
    for (const entry of atomMap) {
      const rawStartIdx = rawCharToWordIdx(entry.start, "start");
      const rawEndIdx   = rawCharToWordIdx(entry.end, "end");
      if (rawStartIdx >= rawWords.length || rawEndIdx < 0 || rawStartIdx > rawEndIdx) continue;
      // Walk forward from rawStartIdx until we find a mapped word.
      let finStart = -1;
      for (let i = rawStartIdx; i <= rawEndIdx && i < rawWords.length; i++) {
        if (rawToFin[i] >= 0) { finStart = rawToFin[i]; break; }
      }
      // Walk backward from rawEndIdx until we find a mapped word.
      let finEnd = -1;
      for (let i = rawEndIdx; i >= rawStartIdx && i >= 0; i--) {
        if (rawToFin[i] >= 0) { finEnd = rawToFin[i]; break; }
      }
      if (finStart < 0 || finEnd < 0 || finStart > finEnd) continue;
      result.push({
        id: entry.id, kind: entry.kind,
        start: finWords[finStart].start,
        end:   finWords[finEnd].end,
      });
    }
    return result;
  }

  window.buildSpeechScript = function buildSpeechScript(latex, spokenText) {
    if (typeof latex !== "string" || !latex) return { wrappedLatex: "", script: [] };
    try {
      const ctx = { nextGroupId: 1, nextOperandId: 1 };
      const flatTokens = tokenize(latex, ctx);
      const items = buildOperands(flatTokens, ctx);
      const wrappedLatex = renderOperandLevel(items);
      const script = buildScript(items, spokenText || "");
      return { wrappedLatex, script };
    } catch (err) {
      // Don't let a bad input break the speech path — fall back to the
      // original LaTeX with an empty script (no highlights).
      console.warn("[buildSpeechScript] failed:", err);
      return { wrappedLatex: latex, script: [] };
    }
  };
})();
