# Standards-based testing of Emboss

Paul's decisions (17 Sep 2026): test Emboss against **BANA Braille Formats 2016**, **UKAAF B004**
(as held) and **NIMAS 1.1 / DTBook 2005-3 (+ MathML)**. BrailleBlaster is a comparison only, not
a reference. No transcriber checks are available; concise questions for a transcriber are
collected in `standards-questions.md` and sent when the other checks are done. Keep costs
reasonable without compromising quality. The rule texts are in `references/_text/`.

## Outputs (all in the repository, never only in chat)

- `Emboss/docs/standards-map.md` — one row per rule: id, the rule **quoted verbatim** with its
  section, what it requires, Emboss's status (done / partial / not done / out of scope / unclear),
  the tests that prove it, open questions.
- `Emboss/tests/gold/<standard>/<section>/…` — gold examples transcribed from the rulebooks:
  the print input as a model or DTBook, and the expected braille, compared character by
  character.
- `Emboss/docs/standards-findings.md` — every finding: rule quote, input, expected, actual,
  classification (bug / standard unclear / deliberate choice), status.
- `Emboss/docs/standards-questions.md` — questions for a transcriber.

## Stages, each with completion criteria

1. **Extract** the rules of a section into map rows. Two independent Sonnet runs; a third
   compares them and resolves differences by re-reading the text; unresolved differences go to
   a stronger model or Paul. Complete when every numbered rule and every example in the
   section has a row.
2. **Assess** each row against the code (with file/function references) and the existing tests.
   Complete when every row has a status and either a proving test or a gap noted.
3. **Gold examples**: transcribe every worked example of the section (two independent runs
   compared), build the input, record the expected braille. Complete when each example has a
   test and the two transcriptions agree.
4. **Test books and round trips**: a small book covering the section's constructs, saved and
   reloaded across every route; broken inputs for the checkers.
5. **Run and sort**: run everything; classify each failure; fixes go to Paul's task list.
6. **Verify**: a second agent re-runs a sample of everything marked done.

## Rules

- A test's expected result comes from the standard, never from Emboss's current output. A test
  changes only when a quoted rule shows the old expectation was wrong; say which rule.
- Every checker is first proven on a deliberately broken input it must fail.
- Report evidence (commands, inputs, expected, actual), not summaries. "Done" without
  evidence is not done.
- Findings are never fixed silently: bugs go to the task list; "unclear" and "deliberate"
  go to Paul.
- Models: Sonnet for extraction, transcription, tests and fixes (two independent runs
  compared where accuracy matters); Fable/Opus only for method, disputed readings and
  sign-off; Haiku only for trivial steps. Each agent works in its own scratch subfolder.

## Pilot

BANA Formats §11 (Tables and Related Columns; `braille-formats-2016.txt` lines 8236–9994) and
UKAAF B004 §12 (Basic tables; `B004.txt` from line 327 to the next numbered section). Reviewed
with Paul before the method is extended chapter by chapter: BANA → B004 → NIMAS/DTBook →
translation and accessibility checks.
